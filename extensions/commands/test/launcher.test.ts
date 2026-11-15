// node --experimental-strip-types test/launcher.test.ts
// The started state and the ask-first second press, apart from the drawing.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { COMMANDS, createLauncher } from "../src/commands.ts";

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);
const [first, second] = COMMANDS;

const calls: string[] = [];
let answer: "running" | "refuse" = "running";
const invoke = (_: string, args: unknown) => {
  calls.push((args as { prompt: string }).prompt);
  return answer === "refuse"
    ? Promise.reject(new Error("No workspace path available"))
    : new Promise<unknown>(() => {});
};
let clockNow = 1000;
const l = createLauncher(invoke, () => clockNow, 20);

// "Starting" shows while the app has not refused, and every other row waits
const pending = l.press(first);
assert.equal(l.get().starting, first.id);
assert.equal(await l.press(second), "ignored");
assert.equal(calls.length, 1);
assert.equal(await pending, "started");
assert.equal(l.get().starting, "");
assert.deepEqual(l.get().started, { [first.id]: 1000 });
ok(
  "a press shows Starting, other rows wait, then the command counts as started with its time",
);

// a second press asks first and starts nothing
clockNow = 2000;
assert.equal(await l.press(first), "asking");
assert.equal(l.get().asking, first.id);
assert.equal(calls.length, 1, "the question starts nothing");
ok("a second press of a started command only asks");

l.cancel();
assert.equal(l.get().asking, "");
assert.equal(calls.length, 1);
await l.press(first);
await l.confirm(first);
assert.equal(calls.length, 2);
assert.equal(l.get().asking, "");
assert.equal(l.get().started[first.id], 2000);
ok("cancel starts nothing; confirm starts it again and records the new time");

await l.confirm(second);
assert.equal(calls.length, 2, "confirm without a question does nothing");
ok("confirm only works for the command that was asked about");

// the state is the launcher's, so it survives a popover that is closed and opened again
let seen = 0;
const off = l.subscribe(() => seen++);
await l.press(second);
off();
assert.ok(seen >= 2);
assert.ok(l.get().started[second.id]);
ok("listeners hear every change; the started list lives outside any popover");

// a refusal is text and does not count as started
answer = "refuse";
const other = createLauncher(invoke, () => 5, 500);
assert.equal(await other.press(first), "started");
assert.equal(other.get().error, "No workspace path available");
assert.deepEqual(other.get().started, {});
assert.equal(
  await other.press(first),
  "started",
  "a refused command is pressed straight away, not asked about",
);
ok(
  "a refusal shows its text, is not marked started and can be pressed again at once",
);

// The Setup audit pick, drawn. index.tsx has JSX, so it is bundled once with esbuild into a temp file, with the
// host-only modules stood in and the CSS left out; the list is drawn as HTML for one state at a time.
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "launcher-test-"));
const out = path.join(dir, "panel.cjs");
await build({
  stdin: {
    contents: `export { CommandsPanel, CommandsView } from "./src/index.tsx";
export { LIST_TAKES_ESC } from "./src/popover.tsx";
export { COMMANDS, createLauncher, escCloses, togglePick } from "./src/commands.ts";
export { t } from "./src/strings.ts";
export { renderToStaticMarkup } from "react-dom/server";
export { createElement } from "react";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  loader: { ".css": "empty" },
  outfile: out,
  logLevel: "error",
  plugins: [
    {
      name: "host-stand-in",
      setup(b) {
        b.onResolve({ filter: /^@nimbalyst\// }, () => ({
          path: "host",
          namespace: "stand-in",
        }));
        b.onLoad({ filter: /.*/, namespace: "stand-in" }, () => ({
          contents: "module.exports = {};",
          loader: "js",
        }));
      },
    },
  ],
});
const m = createRequire(import.meta.url)(out);
fs.rmSync(dir, { recursive: true, force: true });

type Cmd = { id: string; label: string; pick?: Cmd[] };
type El = { props?: Record<string, unknown> };
const SETUP = "C:/x/claude-settings";
const audit: Cmd = m.COMMANDS.find((c: Cmd) => c.id === "setup-audit");
const [health, usage] = audit.pick as Cmd[];
const clock = (ms: number) =>
  new Date(ms).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
const count = (html: string, part: string) => html.split(part).length - 1;
// Every element of a drawn tree that `test` accepts
const all = (node: unknown, test: (p: Record<string, unknown>) => boolean) => {
  const found: Record<string, unknown>[] = [];
  const walk = (n: unknown) => {
    if (Array.isArray(n)) return n.forEach(walk);
    const p = (n as El)?.props;
    if (!p) return;
    if (test(p)) found.push(p);
    walk(p.children);
  };
  walk(node);
  return found;
};
// What popover.tsx's box.querySelector(LIST_TAKES_ESC) finds in the drawn HTML: [attr] and [attr="value"] parts
const popoverSkipsEsc = (html: string) =>
  (m.LIST_TAKES_ESC as string).split(",").some((part) => {
    const [, attr, value] =
      part.trim().match(/^\[([\w-]+)(?:="(.*)")?\]$/) ?? [];
    assert.ok(attr, `a selector part this test reads: ${part}`);
    return new RegExp(
      value === undefined ? `\\s${attr}[=\\s>]` : `\\s${attr}="${value}"`,
    ).test(html);
  });

const pl = m.createLauncher(invoke, () => clockNow, 20);
answer = "running";
let open = "";
const esc = () => {};
const act = {
  press: (c: Cmd) => void pl.press(c),
  toggle: (c: Cmd) => {
    open = m.togglePick(open, c.id, pl.get());
  },
  confirm: () => {},
  cancel: () => pl.cancel(),
  esc,
  hint: () => {},
  row: () => {},
  cancelRef: { current: null },
};
const props = () => ({ path: SETUP, s: pl.get(), open, hint: "", act });
// The drawn HTML without its <style>, whose selectors would count as rows
const draw = (component: unknown, p: unknown) =>
  m
    .renderToStaticMarkup(m.createElement(component, p))
    .replace(/<style>[\s\S]*?<\/style>/, "");
const html = () => draw(m.CommandsView, props());
const auditRow = () =>
  all(m.CommandsView(props()), (p) => p["aria-expanded"] !== undefined);

// 11. the real panel's first draw has the pick closed; one press opens it, a second closes it
const firstDraw = draw(m.CommandsPanel, { host: { workspacePath: SETUP } });
assert.ok(!firstDraw.includes(".cb-row"), "the style is left out");
assert.equal(count(firstDraw, 'aria-expanded="false"'), 1);
assert.equal(count(firstDraw, 'aria-expanded="true"'), 0);
assert.equal(count(firstDraw, "cb-option"), 0);
assert.equal(count(firstDraw, ">expand_more<"), 1, "one arrow, on Setup audit");
assert.equal(auditRow().length, 1);
(auditRow()[0].onClick as () => void)();
assert.equal(open, "setup-audit");
const opened = html();
assert.equal(count(opened, 'aria-expanded="true"'), 1);
assert.match(
  opened,
  /aria-expanded="true" aria-controls="cb-setup-audit-options"/,
);
assert.equal(count(opened, 'id="cb-setup-audit-options"'), 1);
assert.equal(count(opened, 'class="cb-row cb-option"'), 6);
(auditRow()[0].onClick as () => void)();
assert.equal(open, "");
assert.equal(count(html(), 'aria-expanded="false"'), 1);
ok(
  "Setup audit draws aria-expanded false, one press opens its 6 options, a second closes them",
);

// 13. starting an option disables every row and option; its Started mark shows on it, and on the closed row
open = "setup-audit";
clockNow = 3000;
const startingHealth = pl.press(health);
const busy = html();
assert.equal(count(busy, 'aria-disabled="false"'), 0);
assert.equal(count(busy, 'aria-disabled="true"'), 15 + 6);
assert.equal(count(busy, m.t.starting), 1);
assert.equal(
  open,
  m.togglePick(open, audit.id, pl.get()),
  "the pick waits too",
);
await startingHealth;
clockNow = 4000 + 3600_000;
await pl.press(usage);
const done = html();
assert.equal(count(done, 'aria-disabled="true"'), 0);
assert.equal(count(done, m.t.started(clock(3000))), 1, "Setup health");
assert.equal(count(done, m.t.started(clock(4000 + 3600_000))), 1, "Usage");
assert.equal(count(done, "cb-dot"), 2, "the open row shows no mark of its own");
open = "";
const closed = html();
assert.equal(count(closed, "cb-dot"), 1);
assert.ok(
  closed.includes(
    `title="${m.t.startedOption(usage.label, clock(4000 + 3600_000))}"`,
  ),
  "the closed row shows the newest option's start, named in its tooltip",
);
ok(
  "a starting option disables every row and option; Started shows on the option and on the closed Setup audit row",
);

// 12. three Esc presses, three steps: the question, then the pick, then the popover
open = "setup-audit";
assert.equal(await pl.press(health), "asking");
// One Esc handler, on the list itself, so Esc from any row (inside the pick or not) reaches the panel
const escKeys = all(m.CommandsView(props()), (p) => !!p.onKeyDown);
assert.equal(escKeys.length, 1);
assert.equal(escKeys[0].onKeyDown, esc);
assert.ok(
  "data-command-buttons" in escKeys[0],
  "the handler sits on the list root",
);
const escSteps: string[] = [];
for (let press = 0; press < 3; press++) {
  const drawn = html();
  const what = m.escCloses(pl.get(), open !== "");
  if (!popoverSkipsEsc(drawn)) {
    assert.equal(what, "", "the list has nothing left to close");
    escSteps.push("popover");
  } else if (what === "question") {
    assert.ok(drawn.includes("data-asking"));
    pl.cancel();
    escSteps.push("question");
  } else {
    assert.equal(what, "pick");
    open = "";
    escSteps.push("pick");
  }
}
assert.deepEqual(escSteps, ["question", "pick", "popover"]);
ok(
  "Esc in the open pick closes the question, then the pick, then the popover, one per press",
);
