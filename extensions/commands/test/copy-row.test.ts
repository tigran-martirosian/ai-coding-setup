// node --experimental-strip-types test/copy-row.test.ts
// The copy row: which block ends a turn, the whole reply as Markdown, Copied for a while, and a blocked clipboard.
// copy-row.tsx has JSX, so it is bundled once with esbuild (a dev dependency) into a temp file; the SDK's
// copyToClipboard is replaced by a stand-in this test controls.
import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "copy-row-test-"));
const out = path.join(dir, "copy-row.cjs");
await build({
  stdin: {
    contents: `export * from "./src/copy-row.tsx";
export { renderToStaticMarkup } from "react-dom/server";
export { createElement } from "react";`,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  platform: "node",
  format: "cjs",
  jsx: "automatic",
  outfile: out,
  logLevel: "error",
  plugins: [
    {
      name: "sdk-stand-in",
      setup(b) {
        b.onResolve({ filter: /^@nimbalyst\/extension-sdk$/ }, () => ({
          path: "sdk",
          namespace: "stand-in",
        }));
        b.onLoad({ filter: /.*/, namespace: "stand-in" }, () => ({
          contents:
            "export const copyToClipboard = (text) => globalThis.__clipboardWrite(text);",
          loader: "js",
        }));
      },
    },
  ],
});
const m = createRequire(import.meta.url)(out);
fs.rmSync(dir, { recursive: true, force: true });

type Node = {
  type: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: Node[];
};
const block = (markdown: string, extra: Node[] = []) => {
  const tree: Node = {
    type: "root",
    children: [{ type: "element", tagName: "p", children: [] }, ...extra],
  };
  m.rehypeCopyRow()(tree, { value: markdown });
  return tree;
};
const keyOf = (tree: Node) =>
  tree.children?.find((c) => c.tagName === m.COPY_TAG)?.properties
    ?.dataKey as string;

// the plugin adds one element per block, before Read Aloud's strip so Copy comes first on the line
{
  const plain = block("Some text");
  assert.equal(plain.children?.at(-1)?.tagName, m.COPY_TAG);
  const shared = block("Other text", [
    { type: "element", tagName: "readaloud-control", children: [] },
  ]);
  assert.deepEqual(
    shared.children?.map((c) => c.tagName),
    ["p", m.COPY_TAG, "readaloud-control"],
  );
  const empty: Node = { type: "root", children: [] };
  m.rehypeCopyRow()(empty, { value: "  \n" });
  assert.equal(empty.children?.length, 0);
  ok(
    "one copy element per block, placed before Read Aloud's strip; none on an empty block",
  );
}

// turn ends: the last block before a user message or the end; none while the Thinking line follows
{
  const items = [
    { kind: "user" },
    { kind: "copy", key: "a" },
    { kind: "copy", key: "b" },
    { kind: "user" },
    { kind: "copy", key: "c" },
    { kind: "waiting" },
  ];
  assert.deepEqual(m.turnEnds(items), [
    { end: false, last: false },
    { end: false, last: false },
    { end: true, last: false },
    { end: false, last: false },
    { end: false, last: false },
    { end: false, last: false },
  ]);
  assert.deepEqual(
    m.turnEnds([{ kind: "user" }, { kind: "copy", key: "a" }]).at(-1),
    { end: true, last: true },
  );
  ok(
    "only a finished turn's last block gets the row; the last turn is marked; a running turn has none",
  );
}

// the whole reply: every text block of the turn as Markdown, in order, and nothing from the turn before
const first = "## Plan\n\n- one\n- two\n";
const second = "Then run `npm test`:\n\n```sh\nnpm test\n```\n";
const third = "**Done.** See [the notes](notes.md).";
const earlier = "An earlier answer";
const items = [
  { kind: "user" },
  { kind: "copy", key: keyOf(block(earlier)) },
  { kind: "user" },
  { kind: "copy", key: keyOf(block(first)) },
  { kind: "copy", key: keyOf(block(second)) },
  { kind: "copy", key: keyOf(block(third)) },
];
const whole = `${first.trim()}\n\n${second.trim()}\n\n${third}`;
assert.equal(m.replyMarkdown(items, 5), whole);
assert.equal(
  m.replyMarkdown([...items.slice(0, 3), { kind: "copy", key: "gone" }], 3),
  null,
);
ok(
  "the reply is every text block of the turn joined as Markdown; a block no longer kept gives no text",
);

const states = (store: {
  subscribe: (f: () => void) => void;
  get: () => { kind: string };
}) => {
  const seen: string[] = [];
  store.subscribe(() => seen.push(store.get().kind));
  return seen;
};
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const html = (state: unknown) =>
  m.renderToStaticMarkup(
    m.createElement(m.CopyRowView, { state, onCopy() {}, onDismiss() {} }),
  );

// Copy writes the whole reply once through the SDK clipboard, shows Copied, and returns to rest after the hold
{
  const written: string[] = [];
  (globalThis as any).__clipboardWrite = async (text: string) =>
    void written.push(text);
  const store = m.createCopy(
    (text: string) => (globalThis as any).__clipboardWrite(text),
    30,
  );
  const seen = states(store);
  await store.copy(m.replyMarkdown(items, 5));
  assert.deepEqual(written, [whole]);
  assert.equal(store.get().kind, "copied");
  const copied = html(store.get());
  assert.match(copied, /data-copied/);
  assert.match(copied, />Copied</);
  assert.match(
    copied,
    />Copy</,
    "both faces stay drawn, so the width does not change",
  );
  await wait(60);
  assert.deepEqual(seen, ["copied", "rest"]);
  assert.doesNotMatch(html(store.get()), /data-copied/);
  assert.equal(m.COPIED_MS, 2000);
  ok(
    "Copy writes the whole reply once, shows Copied, and is back at rest after the hold (2 s in the app)",
  );
}

// a blocked clipboard: the plain error with Dismiss, no second try, never Copied
{
  let calls = 0;
  const store = m.createCopy(async () => {
    calls++;
    throw new Error("Write permission denied.");
  }, 30);
  const seen = states(store);
  await store.copy(whole);
  await wait(60);
  assert.equal(calls, 1, "nothing else is tried after a refusal");
  assert.deepEqual(
    seen,
    ["failed"],
    "a refusal never shows Copied and does not clear by itself",
  );
  const failed = html(store.get());
  assert.match(failed, /role="alert"/);
  assert.match(failed, /Couldn&#x27;t copy: clipboard blocked/);
  assert.match(failed, /title="Write permission denied."/);
  assert.match(
    failed,
    /<button type="button" class="cb-copy-dismiss">Dismiss<\/button>/,
  );
  store.dismiss();
  assert.equal(store.get().kind, "rest");
  assert.doesNotMatch(html(store.get()), /role="alert"/);
  ok(
    "a blocked clipboard shows the error and Dismiss; Dismiss returns to rest",
  );
}

// a reply whose text is gone says so instead of copying part of it
{
  let calls = 0;
  const store = m.createCopy(async () => void calls++, 30);
  await store.copy(null);
  assert.equal(calls, 0);
  assert.match(
    html(store.get()),
    /Couldn&#x27;t copy: the reply&#x27;s text is no longer loaded/,
  );
  ok("missing reply text shows its own error and copies nothing");
}

// the app's floating copy icon is hidden only on replies that carry the row
{
  const css = fs
    .readFileSync(path.join(root, "src/copy-row.css"), "utf8")
    .replace(/\r\n/g, "\n");
  const hides = (css.match(/[^{}]*\{\s*display:\s*none;\s*\}/g) ?? []).map(
    (r) => r.replace(/\/\*[\s\S]*?\*\//g, "").trim(),
  );
  const onApp = hides.filter((r) => r.includes("rich-transcript"));
  assert.deepEqual(onApp, [
    ".rich-transcript-message:not(.user):has(.cb-copy:not([hidden])) .rich-transcript-message-copy-action {\n  display: none;\n}",
  ]);
  ok(
    "the only app element hidden is the floating copy icon, on assistant messages with the row",
  );
}

console.log(`${n} passed`);
