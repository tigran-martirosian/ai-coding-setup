// node --experimental-strip-types test/commands.test.ts
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MODEL } from "../../shared/host.ts";
import type { Command } from "../src/commands.ts";
import { COMMANDS, grouped, ownFor, run, visible } from "../src/commands.ts";
import { OWN } from "../src/own.ts";
import { CSS } from "../src/styles.ts";

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);

// every button and pick option names a skill, and on a computer that has the skills, one that is installed;
// a button with a pick sends nothing itself
const skills = path.join(os.homedir(), ".claude", "skills");
const installed = fs.existsSync(path.join(skills, "board-cleanup"));
const sending = (cs: Command[]) => cs.flatMap((c) => c.pick ?? [c]);
for (const c of COMMANDS.filter((c) => c.pick)) {
  assert.equal(c.prompt, "", `${c.id} opens a pick and sends nothing`);
  assert.ok(c.pick?.length, c.id);
}
for (const c of sending(COMMANDS)) {
  assert.match(c.prompt, /^\/[a-z-]+( [a-z]+)?$/, c.id);
  // a button tied to one project may start a skill that lives in that project's own folder
  // inside the setup's repository, the skill may be one the repository ships and this computer doesn't have
  const places = [
    skills,
    path.join(import.meta.dirname, "..", "..", "..", "skills"),
  ];
  if (installed && !c.only)
    assert.ok(
      places.some((p) =>
        fs.existsSync(
          path.join(p, c.prompt.slice(1).split(" ")[0], "SKILL.md"),
        ),
      ),
      `no skill for ${c.prompt}`,
    );
}
ok(
  installed
    ? "every button has an installed skill"
    : "every button names a skill (the skills are not installed here, so that was not checked)",
);

const everyId = [...COMMANDS, ...COMMANDS.flatMap((c) => c.pick ?? [])].map(
  (c) => c.id,
);
assert.equal(new Set(everyId).size, everyId.length);
ok("ids are unique, options included");

// the merged list (the approved order); COMMANDS has the phone skill here
const SETUP = "C:/x/claude-settings";
const OTHER = "C:/x/some-project";
const noPhone = [
  ...COMMANDS.filter((c) => !OWN.includes(c)),
  ...ownFor(OWN, []),
];
const idsOf = (cs: Command[]) => cs.map((c) => c.id);
const ORDER = [
  ["lead", "grill-me", "next-move", "where-are-we", "board-cleanup"],
  ["new-project", "update-project", "systems-map", "untangle"],
  ["setup-audit", "update-setup", "backup"],
  ["pc-tidy", "disk-tidy", "phone"],
];
for (const folder of [SETUP, OTHER]) {
  // 1. 15 buttons in both folders, 14 with no phone skill
  assert.equal(visible(folder).length, 15, folder);
  assert.equal(visible(folder, noPhone).length, 14, folder);
  // 2. four groups of 5, 4, 3, 3 (5, 4, 3, 2 with no phone skill); 3. the order by id
  assert.deepEqual(
    grouped(visible(folder)).map((g) => g.length),
    [5, 4, 3, 3],
  );
  assert.deepEqual(
    grouped(visible(folder, noPhone)).map((g) => g.length),
    [5, 4, 3, 2],
  );
  assert.deepEqual(grouped(visible(folder)).map(idsOf), ORDER, folder);
  assert.deepEqual(grouped(visible(folder)).flat(), visible(folder));
}
assert.deepEqual(
  OWN.map((c) => c.prompt),
  ["/phone"],
  "Phone inbox is in the own build only",
);
ok(
  "15 buttons in both folders (14 with no phone skill), in four groups of 5, 4, 3, 3 and the approved order",
);

// 4, 5. the Setup audit pick: 6 options in the setup folder, the first 4 elsewhere
const audit = COMMANDS.find((c) => c.id === "setup-audit");
assert.ok(audit?.pick);
const options = (folder: string) =>
  visible(folder, audit.pick).map((c) => [c.label, c.prompt]);
const SIX = [
  ["Setup health", "/setup-audit"],
  ["Usage report", "/setup-audit usage"],
  ["Prompt audit", "/setup-audit prompt"],
  ["Project scan", "/setup-audit scan"],
  ["Chat review", "/setup-audit chat"],
  ["Full review", "/setup-audit full"],
];
assert.deepEqual(options(SETUP), SIX);
assert.deepEqual(options(OTHER), SIX.slice(0, 4));
const otherSent = options(OTHER).map(([, prompt]) => prompt);
assert.equal(
  otherSent.filter(
    (p) => p === "/setup-audit chat" || p === "/setup-audit full",
  ).length,
  0,
);
ok("Setup audit opens 6 checks in the setup folder and 4 elsewhere, in order");

// 6. no button sends /setup-audit with a word, and the Setup audit button sends nothing
for (const folder of [SETUP, OTHER]) {
  const prompts = visible(folder).map((c) => c.prompt);
  assert.equal(prompts.filter((p) => /^\/setup-audit /.test(p)).length, 0);
}
assert.equal(audit.prompt, "");
assert.throws(
  () => run(audit, () => Promise.resolve()),
  /opens a pick/,
  "a pick row cannot start a session",
);
// 7. six options written in commands.ts
const source = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "commands.ts"),
  "utf8",
);
assert.equal(source.match(/prompt: "\/setup-audit/g)?.length, 6);
ok(
  "the checks are options only: no button sends a check, Setup audit sends nothing",
);

// 8, 9. File upkeep's button is gone, Grill me is one button with its skill in the repo; PC and Disk tidy stay two
const buttonsSending = (prompt: string) =>
  visible(SETUP).filter((c) => c.prompt === prompt);
assert.equal(buttonsSending("/file-upkeep").length, 0);
// grill-me became grilling on 2026-11-19 (Pocock's newer text, with the spec step)
assert.equal(buttonsSending("/grilling").length, 1);
assert.equal(buttonsSending("/grilling")[0].icon, "quiz");
assert.ok(
  fs.existsSync(
    path.join(
      import.meta.dirname,
      "..",
      "..",
      "..",
      "skills",
      "grilling",
      "SKILL.md",
    ),
  ),
);
assert.equal(buttonsSending("/pc-tidy").length, 1);
assert.equal(buttonsSending("/disk-tidy").length, 1);
assert.notEqual(buttonsSending("/pc-tidy")[0], buttonsSending("/disk-tidy")[0]);
ok("no File upkeep button, one Grill me button, PC tidy and Disk tidy apart");

// 10. both text sets have the new keys and none has File upkeep (npm run typecheck holds russian to english's type)
const texts = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "strings.ts"),
  "utf8",
);
for (const key of ["grillMe", "setupHealth", "promptAudit", "startedOption"])
  assert.equal(
    texts.match(new RegExp(`^ +${key}: `, "gm"))?.length,
    2,
    `${key} in both sets`,
  );
assert.doesNotMatch(texts, /fileUpkeep/);
ok("both text sets have the new keys, and neither has File upkeep");

// 15. DESIGN.md names the pattern once
const design = fs.readFileSync(
  path.join(import.meta.dirname, "..", "..", "shared", "DESIGN.md"),
  "utf8",
);
assert.equal(design.match(/^- \*\*Disclosure row:\*\* /gm)?.length, 1);
ok("DESIGN.md has the disclosure row pattern once");

// an own button ships in the public repo too, so a build shows it only where its skill is installed
assert.deepEqual(ownFor(OWN, []), [], "no phone skill: no Phone inbox button");
assert.deepEqual(
  ownFor(OWN, ["phone", "lead"]).map((c) => c.id),
  ["phone"],
  "phone skill installed: the button shows",
);
assert.ok(
  fs
    .readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8")
    .includes("__SKILLS__: JSON.stringify(skills)"),
  "the build passes the installed skills in",
);
ok("own buttons only where their skill is installed");

// four groups draw three hairlines: one rule between two groups, and the list has no heading
const rules = (css: string) =>
  [
    ...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g),
  ].map((r) => ({ sel: r[1].trim(), body: r[2] }));
const body = (css: string, sel: string) => {
  const found = rules(css).filter((r) => r.sel === sel);
  assert.equal(found.length, 1, `one rule for ${sel}`);
  return found[0].body;
};
const divider = rules(CSS).filter((r) => /border-(top|bottom)/.test(r.body));
assert.deepEqual(
  divider.map((r) => r.sel),
  [".cb-group + .cb-group"],
);
for (const part of [
  "border-top: 1px solid var(--x-hairline);",
  "margin-top: var(--x-space-2);",
  "padding-top: var(--x-space-2);",
])
  assert.ok(divider[0].body.includes(part), part);
assert.equal(grouped(visible(SETUP)).length - 1, 3);
const view = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "index.tsx"),
  "utf8",
);
const listPart = view.slice(
  view.indexOf('className="cb-list"'),
  view.indexOf('className="cb-hint"'),
);
assert.ok(listPart.includes("grouped(commands).map"));
assert.doesNotMatch(listPart, /<h\d|heading|cb-group-(title|head)/);
ok(
  "groups are set apart by one hairline rule with 8 px above and below, and no heading",
);

// each text of the popover and the Note button on its shared level (DESIGN.md, the Commands and chat box rows)
const levels: [string, string][] = [
  [".cb-title", "var(--x-title)"],
  [".cb-label", "var(--x-row-title)"],
  [".cb-ask-text", "var(--x-row-title)"],
  [".cb-btn", "var(--x-row-title)"],
  [".cb-hint", "var(--x-meta)"],
  [".cb-status", "var(--x-meta)"],
  [".cb-ask-note", "var(--x-meta)"],
  [".cb-error", "var(--x-meta)"],
];
for (const [sel, token] of levels)
  assert.ok(body(CSS, sel).includes(`font: ${token};`), sel);
assert.match(body(CSS, ".cb-sym"), /font-size: 16px;/);
// 14. no new text size: the panel's type is only the Commands row of DESIGN.md (body is the base of .cb and .cb-row)
const typeTokens = new Set(
  rules(CSS).flatMap((r) =>
    [...r.body.matchAll(/(?:^|[;\s])font: ([^;]+);/g)].map((f) => f[1]),
  ),
);
assert.deepEqual([...typeTokens].sort(), [
  "var(--x-body)",
  "var(--x-meta)",
  "var(--x-row-title)",
  "var(--x-title)",
]);
assert.deepEqual(
  rules(CSS)
    .filter((r) => /font-size:/.test(r.body))
    .map((r) => r.sel),
  [".cb-sym"],
  "only the icons set a size",
);
const noteCss = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "note.css"),
  "utf8",
);
assert.ok(body(noteCss, ".cb-note-btn").includes("font: var(--x-row-title);"));
const diffCss = fs.readFileSync(
  path.join(import.meta.dirname, "..", "src", "diff-comments.css"),
  "utf8",
);
for (const css of [CSS, noteCss, diffCss]) {
  assert.doesNotMatch(css, /font-weight: *(7|8|9)00|font: *(7|8|9)00/);
  assert.doesNotMatch(css, /uppercase/);
  for (const size of css.matchAll(/(?:font-size:|font:[^;]*?) (\d+)px/g))
    assert.ok(Number(size[1]) >= 12, `a text of ${size[1]} px`);
}
ok(
  "the popover, the Note button and the diff comments use their levels: no text under 12 px, no bold 700, no capitals",
);

const list = [
  ...COMMANDS.slice(0, 2),
  { ...COMMANDS[0], id: "one-folder", only: ["my-project", "other-name"] },
];
const ids = (p: string) => visible(p, list).map((c) => c.id);
assert.ok(ids("C:\\Projects\\my-project").includes("one-folder"));
assert.ok(ids("C:/Projects/My-Project/").includes("one-folder"));
assert.ok(ids("C:\\Projects\\other-name").includes("one-folder"));
assert.ok(!ids("C:\\Projects\\another-project").includes("one-folder"));
assert.ok(!ids("").includes("one-folder"));
assert.equal(ids("C:\\Projects\\another-project").length, list.length - 1);
ok("a button tied to one project shows only in that project");

const pre = [{ ...COMMANDS[0], id: "prefix", only: ["claude-set*"] }];
assert.equal(visible("C:\\Projects\\claude-settings", pre).length, 1);
assert.equal(visible("C:/Projects/Claude-Settings-2/", pre).length, 1);
assert.equal(visible("C:\\Projects\\claude-code", pre).length, 0);
assert.equal(visible("C:\\Projects\\my-claude-settings", pre).length, 0);
ok("a name ending in * matches folders that start with it");

// the build for other people (npm run build:share), when it has been made
const shared = path.join(import.meta.dirname, "..", "dist-share", "index.js");
if (fs.existsSync(shared)) {
  const js = fs.readFileSync(shared, "utf8");
  const anywhere = sending(COMMANDS.filter((c) => !OWN.includes(c)));
  const everywhere = anywhere.map((c) => c.prompt);
  for (const c of OWN.filter((o) => !everywhere.includes(o.prompt)))
    assert.ok(
      !js.includes(c.prompt),
      `the shared build still has ${c.prompt}, which only works here`,
    );
  for (const c of anywhere) assert.ok(js.includes(c.prompt), c.prompt);
  ok(
    `the shared build has the ${COMMANDS.length - OWN.length} buttons that work anywhere and none from own.ts`,
  );
}

const calls: unknown[][] = [];
const never = new Promise(() => {});
assert.equal(
  await run(
    COMMANDS[0],
    (channel, args) => {
      calls.push([channel, args]);
      return never;
    },
    20,
  ),
  "",
);
assert.deepEqual(calls[0], [
  "extensions:ai-send-prompt",
  { prompt: "/lead", sessionName: "Lead", model: MODEL },
]);
ok(
  "a button sends its command, name and Sonnet, and does not wait for the reply",
);

assert.equal(
  await run(
    COMMANDS[0],
    () => Promise.reject(new Error("No workspace path available")),
    500,
  ),
  "No workspace path available",
);
ok("a refusal is returned as text");
