// node --experimental-strip-types test/diff-comments.test.ts
import assert from "node:assert/strict";
import type { CellLike, DiffComment, KeyValue } from "../src/diff-comments.ts";
import {
  BOX_ROOM,
  batchEnd,
  batchOutcome,
  boxSpan,
  buildMessage,
  CODE_MAX,
  cardLabel,
  commentStore,
  DRAFT_ID,
  draftUnsaved,
  makeComment,
  placeComments,
  rangeRows,
  readRow,
  sendBatch,
  sentLine,
  shortCode,
  shownPath,
  stackBoxes,
  withRestored,
} from "../src/diff-comments.ts";
import { sendNote } from "../src/note.ts";

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);

// ---- reading a row: cells shaped like the Review panel's react-diff-view rows in Nimbalyst 0.83
const cell = (className: string, key: string, text: string): CellLike => ({
  className,
  textContent: text,
  getAttribute: (name) => (name === "data-change-key" ? key : null),
});
const row = (
  kind: "delete" | "insert" | "normal",
  key: string,
  old: string,
  now: string,
  code: string,
) => [
  cell(`diff-gutter diff-gutter-${kind}`, key, old),
  cell(`diff-gutter diff-gutter-${kind}`, key, now),
  cell(`diff-code diff-code-${kind}`, key, code),
];

assert.deepEqual(
  readRow(row("delete", "D1", "1", "", "# Notes")),
  { key: "D1", side: "old", n: 1, code: "# Notes" },
  "a removed line must be read with its old line number",
);
assert.deepEqual(
  readRow(row("insert", "I5", "", "5", "- third point")),
  { key: "I5", side: "new", n: 5, code: "- third point" },
  "an added line must be read with its new line number",
);
assert.deepEqual(
  readRow(row("normal", "N9", "9", "8", "    return total")),
  { key: "N9", side: "new", n: 8, code: "    return total" },
  "an unchanged line must be read with its new line number (the second gutter), not the old one",
);
assert.equal(
  readRow([cell("diff-code diff-code-normal", "N1", "x")]),
  null,
  "a row without the two line-number cells is not a line",
);
ok("a diff row is read as its side, line number, change key and code");

// ---- the message
const lines = [
  { key: "N3", side: "new" as const, n: 3, code: "- first point" },
  { key: "D4", side: "old" as const, n: 4, code: "- old point" },
  { key: "I4", side: "new" as const, n: 4, code: "- second point" },
  { key: "I5", side: "new" as const, n: 5, code: "- third point" },
];
const range = rangeRows(lines, "I5", "N3");
assert.deepEqual(
  range?.map((r) => r.key),
  ["N3", "D4", "I4", "I5"],
  "a Shift+click range must cover every row between the two, in either order",
);
const root = "C:\\work\\shop";
const notes = "C:\\work\\shop\\notes.md";
const prices = "C:\\work\\shop\\src\\prices.py";
const long = `total = ${"x + ".repeat(60)}1`;
const list: DiffComment[] = [
  makeComment(
    prices,
    [{ key: "I6", side: "new", n: 6, code: long }],
    "Too long.",
    "c1",
    1,
  ),
  makeComment(notes, range ?? [], "Merge these\ninto one point.", "c2", 2),
  makeComment(
    prices,
    [{ key: "D2", side: "old", n: 2, code: "    import os" }],
    "Why was this removed?",
    "c3",
    3,
  ),
];
const message = buildMessage(list, root);
const expected = [
  "Review comments on your changes (3), each on a line of the diff:",
  "1. notes.md, lines 3-5: `- first point`\n   Merge these\n   into one point.",
  "2. src/prices.py, old line 2: `import os`\n   Why was this removed?",
  `3. src/prices.py, line 6: \`${long.slice(0, CODE_MAX)}…\`\n   Too long.`,
].join("\n\n");
assert.equal(
  message,
  expected,
  "the message must hold every comment, ordered by file then line, with path, line or range, short code and indented text",
);
ok(
  "the message: several files, a range, a removed line and a long line, ordered by file then line",
);

assert.equal(
  shownPath("D:\\other\\a.ts", root),
  "D:\\other\\a.ts",
  "a file outside the project must keep its full path",
);
assert.equal(
  shownPath("c:\\WORK\\shop\\a.ts", root),
  "a.ts",
  "a Windows path inside the project must be relative whatever its case",
);
ok("paths are relative to the project only when inside it");

// ---- showing saved comments on the rows drawn now
const shown = placeComments(list, [
  ...lines,
  { key: "D2", side: "old", n: 2, code: "    import os (changed)" },
]);
assert.deepEqual(
  shown.placed.map((p) => [p.comment.id, p.keys, p.last]),
  [["c2", ["N3", "D4", "I4", "I5"], "I5"]],
  "a comment whose line reads differently now, or is not drawn, must not be marked",
);
assert.deepEqual(
  shown.moved.map((c) => c.id).sort(),
  ["c1", "c3"],
  "a comment whose rows are drawn but no longer read as saved must count as moved",
);
const middle = placeComments(
  [list[1]],
  lines.map((r) => (r.key === "D4" ? { ...r, code: "- changed" } : r)),
);
assert.deepEqual(
  [middle.placed.length, middle.moved.map((c) => c.id)],
  [0, ["c2"]],
  "a range must not be placed when any row it covers, not only its first, reads differently",
);
assert.deepEqual(
  placeComments(list, []).moved,
  [],
  "a file with no rows drawn (collapsed or out of view) must not make its comments moved",
);
ok(
  "a comment is marked only while every line it covers still reads as when it was saved",
);

// ---- a comment on a line that changed is labelled in the message
const movedMessage = buildMessage([list[2]], root, new Set(["c3"]));
assert.equal(
  movedMessage.split("\n\n")[1],
  "1. src/prices.py, old line 2 (line has changed since): `import os`\n   Why was this removed?",
  "a moved comment must be labelled in the message so the agent does not trust its line number",
);
assert.ok(
  !buildMessage([list[2]], root).includes("changed since"),
  "a comment that did not move must not be labelled",
);
ok("the message labels a moved comment");

// ---- backticks in the line's code
assert.equal(
  shortCode("a ``` b"),
  "```` a ``` b ````",
  "the code fence must be one longer than the longest run of backticks in the line",
);
assert.equal(
  shortCode("x = `y`"),
  "`` x = `y` ``",
  "one backtick in the line needs a fence of two",
);
assert.equal(
  shortCode("plain"),
  "`plain`",
  "a line without backticks keeps a single fence",
);
ok("the code fence is longer than any backtick run in the line");

// ---- where a comment box goes across a narrow panel
const narrow = boxSpan(150, 400, { left: 10, right: 330 }, 8);
assert.deepEqual(
  narrow,
  { left: 10, width: 312 },
  "with under BOX_ROOM px right of the code column the box must start at the shown left edge",
);
assert.ok(
  narrow.left + narrow.width <= 330,
  "the box must end inside the shown part, so Save and Remove are never cut off",
);
assert.ok(700 - 150 >= BOX_ROOM, "the wide case below must have room");
assert.deepEqual(
  boxSpan(150, 900, { left: 10, right: 700 }, 8),
  { left: 150, width: 700 - 150 - 8 },
  "with room the box must start at the code column and end at the list's client edge (not under its scrollbar)",
);
ok("a comment box always fits the shown part of the panel");

// ---- the store, keyed by session
const memory = (): KeyValue & { data: Map<string, string> } => {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
};
const storage = memory();
const store = commentStore(storage);
let changes = 0;
store.subscribe(() => changes++);
store.add("s-a", list[0]);
store.add("s-a", list[1]);
store.add("s-b", list[2]);
assert.deepEqual(
  store.list("s-a").map((c) => c.id),
  ["c1", "c2"],
  "a session must see the comments saved for it",
);
assert.deepEqual(
  store.list("s-b").map((c) => c.id),
  ["c3"],
  "one session's comments must never show in another's",
);
assert.ok(
  storage.data.has("diffComments:s-a"),
  "comments must be kept under diffComments:<session id>",
);
store.edit("s-a", "c2", "  New text  ");
assert.equal(
  store.list("s-a")[1].text,
  "New text",
  "an edit must change the comment's text",
);
store.remove("s-a", ["c1"]);
assert.deepEqual(
  store.list("s-a").map((c) => c.id),
  ["c2"],
  "remove must drop only that comment",
);
assert.equal(
  commentStore(storage).list("s-a").length,
  1,
  "comments must survive a new store (the panel closed and opened again)",
);
store.clear("s-a");
assert.deepEqual(
  store.list("s-a"),
  [],
  "clear must drop the session's comments",
);
assert.ok(
  !storage.data.has("diffComments:s-a"),
  "a cleared session must leave no key behind",
);
assert.equal(
  store.list("s-b").length,
  1,
  "clearing one session must keep another's",
);
assert.equal(changes, 6, "every change must tell the page to redraw");
storage.setItem("diffComments:s-x", "{oops");
assert.throws(
  () => store.list("s-x"),
  /diffComments:s-x is not valid JSON/,
  "a broken entry must fail with its key named",
);
storage.setItem(
  "diffComments:s-y",
  JSON.stringify([null, { ...list[0], id: "bad", keys: "I6" }, list[2]]),
);
assert.deepEqual(
  store.list("s-y").map((c) => c?.id),
  ["c3"],
  "one stored entry without a comment's shape must be dropped so the others still draw",
);
ok("the store keeps comments per session: save, edit, remove, clear");

// ---- sending: the Note button's send with a fake app
const calls: unknown[][] = [];
const app = (exec: { success: boolean; stdout?: string; exitCode?: number }) =>
  (async (channel: string, ...args: unknown[]) => {
    calls.push([channel, ...args]);
    if (channel === "extensions:write-file") return undefined;
    if (channel === "extension:exec") return exec;
    throw new Error(`unexpected call ${channel}`);
  }) as (channel: string, ...args: unknown[]) => Promise<unknown>;
const home = async () => "C:/Users/you";

const s2 = commentStore(memory());
s2.add("s-1", list[0]);
s2.add("s-1", list[2]);
const failed = await sendBatch(
  "s-1",
  s2,
  app({ success: false, stdout: "NOT SENT: no such session", exitCode: 1 }),
  root,
  undefined,
  undefined,
  home,
);
assert.equal(failed.ok, false, "a refused send must report a failure");
assert.equal(
  failed.message,
  "Not sent: no such session",
  "a failed send must show the reason",
);
assert.equal(s2.list("s-1").length, 2, "a failed send must keep the comments");
const written = calls.find((c) => c[0] === "extensions:write-file");
assert.equal(
  written?.[2],
  buildMessage(s2.list("s-1"), root),
  "the batch must go out as one message",
);
assert.equal(
  written?.[1],
  "C:/Users/you/.claude/steer/diff-note-s-1.txt",
  "the batch must write its own note file, not the Note button's",
);

const sent = await sendBatch(
  "s-1",
  s2,
  app({ success: true, stdout: "Note id: n-42\n", exitCode: 0 }),
  root,
  undefined,
  undefined,
  home,
);
assert.equal(sent.ok, true);
assert.equal(
  sent.noteId,
  "n-42",
  "a busy session's note id must come back so its end can be followed",
);
assert.equal(
  sent.message,
  "Comments on their way…",
  "a batch on its way must say so in its own words, not the Note button's",
);
assert.equal(sent.count, 2, "a sent batch must count the comments that went");
assert.deepEqual(
  sent.comments.map((c) => c.id),
  ["c1", "c3"],
  "a sent batch must hand back the comments that went, to put back if its note is not delivered",
);
assert.deepEqual(
  s2.list("s-1"),
  [],
  "a sent batch must clear the session's comments",
);

const lost = await sendBatch(
  "s-1",
  commentStore(memory()),
  app({ success: true }),
  root,
  undefined,
  undefined,
  async () => {
    throw new Error("no home");
  },
);
assert.equal(lost.ok, false, "nothing to send must not count as sent");
const noHome = commentStore(memory());
noHome.add("s-1", list[0]);
const r = await sendBatch(
  "s-1",
  noHome,
  app({ success: true }),
  root,
  undefined,
  undefined,
  async () => {
    throw new Error("could not find the home folder: no output");
  },
);
assert.equal(r.ok, false);
assert.equal(
  noHome.list("s-1").length,
  1,
  "a send that cannot find the home folder must keep the comments",
);
ok(
  "Send all: a failed send keeps the comments and says why; a sent one clears them",
);

// ---- a comment edited or added while the batch is on its way stays
const s3 = commentStore(memory());
s3.add("s-1", list[0]);
s3.add("s-1", list[1]);
const during = await sendBatch(
  "s-1",
  s3,
  app({ success: true, stdout: "Note id: n-43\n", exitCode: 0 }),
  root,
  undefined,
  async (...args) => {
    s3.edit("s-1", "c2", "Changed while sending");
    s3.add("s-1", list[2]);
    return sendNote(...args);
  },
  home,
);
assert.equal(during.ok, true);
assert.deepEqual(
  s3.list("s-1").map((c) => [c.id, c.text]),
  [
    ["c2", "Changed while sending"],
    ["c3", "Why was this removed?"],
  ],
  "after a send only comments whose id and text both went out may be removed",
);
ok("an edit or a new comment made during a send is kept");

// ---- the Note button and the batch write separate note files
const files: string[] = [];
const fileApp = (async (channel: string, ...args: unknown[]) => {
  if (channel === "extensions:write-file") files.push(String(args[0]));
  if (channel === "extension:exec") return { success: true, exitCode: 0 };
  return undefined;
}) as (channel: string, ...args: unknown[]) => Promise<unknown>;
await sendNote("one", "s-9", "C:/Users/you", fileApp);
await sendNote("two", "s-9", "C:/Users/you", fileApp, [], "diff-note");
assert.deepEqual(
  files,
  [
    "C:/Users/you/.claude/steer/button-note-s-9.txt",
    "C:/Users/you/.claude/steer/diff-note-s-9.txt",
  ],
  "two sends with different file tags must write different files, the Note button's name unchanged",
);
ok("sendNote's file tag keeps the Note button's file apart from the batch's");

// ---- the bar after a send: how many went, then the batch's own outcome words
assert.equal(
  sentLine(3, "Comments on their way…"),
  "3 comments sent. Comments on their way…",
  "the bar must say how many comments went before what became of them",
);
assert.equal(
  sentLine(1, "Queued, it starts now"),
  "1 comment sent. Queued, it starts now",
  "one sent comment must read in the singular",
);
assert.equal(
  batchOutcome({ ok: true, message: "Note on its way", noteId: "n-1" }),
  "Comments on their way…",
  "a followed batch must not say Note on its way",
);
assert.equal(
  batchOutcome({
    ok: true,
    message:
      "Note sent, but it cannot be followed to the end. Update the setup to see when it arrives",
  }),
  "They cannot be followed to the end. Update the setup to see when they arrive",
  "a batch that cannot be followed must not call itself a note",
);
assert.equal(
  batchOutcome({
    ok: false,
    message: "Not sent: this session cannot take a note",
  }),
  "Not sent: this session cannot take comments",
  "a session that refuses notes must be told in the batch's words",
);
for (const kept of [
  "Queued, it starts now",
  "Queued, it starts when its reply ends",
  "Not sent: no such session",
])
  assert.equal(
    batchOutcome({ ok: kept.startsWith("Queued"), message: kept }),
    kept,
    `a line that names no note must stay as it is: ${kept}`,
  );
assert.deepEqual(
  batchEnd("delivered"),
  {
    ok: true,
    message: "Comments delivered: the agent reads them at its next step",
  },
  "a delivered batch must say Comments delivered, not Note delivered",
);
for (const state of ["failed", "unconfirmed"])
  assert.deepEqual(
    batchEnd(state),
    {
      ok: false,
      message: "Not confirmed: your comments are back in the list",
    },
    `a batch that ${state} must be held as not confirmed and say its comments are back`,
  );
ok("after a send the bar counts what went and speaks of comments, not a note");

// ---- a saved comment's card names its file as the message does
assert.equal(
  cardLabel(list[0], root),
  "src/prices.py, line 6",
  "a card must name the file by its path in the project, then the line",
);
assert.equal(
  cardLabel(list[2], root),
  "src/prices.py, old line 2",
  "a removed line's card must name its file and old line",
);
assert.equal(
  cardLabel(
    {
      ...list[1],
      file: "C:\\work\\shop\\src\\billing\\rules\\regional_rates\\tax_tables.py",
    },
    root,
  ),
  "tax_tables.py, lines 3-5",
  "a card whose path is long must name only the file",
);
assert.equal(
  cardLabel(list[1], ""),
  "C:\\work\\shop\\notes.md, lines 3-5",
  "with no open project a short path must show as given",
);
ok("a saved comment's card names its file and its lines");

// ---- several boxes under one row stack, the open box last
const one = stackBoxes([{ id: "c1", height: 60 }], 8);
assert.equal(
  one.gap,
  68,
  "one box: the row's gap must be its height and the air",
);
assert.equal(
  one.tops.get("c1"),
  4,
  "one box must start half the air below the gap's top",
);
const three = stackBoxes(
  [
    { id: DRAFT_ID, height: 90 },
    { id: "c1", height: 60 },
    { id: "c2", height: 40 },
  ],
  8,
);
assert.equal(
  three.gap,
  60 + 40 + 90 + 3 * 8,
  "the row's gap must hold every box under it, each with its air",
);
assert.deepEqual(
  [...three.tops],
  [
    ["c1", 4],
    ["c2", 4 + 60 + 8],
    [DRAFT_ID, 4 + 60 + 8 + 40 + 8],
  ],
  "boxes under the same row must not overlap: each starts below the one before, the open box last",
);
ok("two comments and the open box under one row stack without overlapping");

// ---- Send all waits while a comment box holds text not saved
const saved = [
  makeComment(
    prices,
    [{ key: "I6", side: "new", n: 6, code: "x" }],
    "Old text",
    "c1",
    1,
  ),
];
assert.equal(
  draftUnsaved(null, "s-1", saved),
  false,
  "no open box: Send all goes",
);
assert.equal(
  draftUnsaved(
    { session: "s-1", editId: "c1", text: "Old text  " },
    "s-1",
    saved,
  ),
  false,
  "an Edit box whose text is still the comment's must not stop Send all",
);
assert.equal(
  draftUnsaved(
    { session: "s-1", editId: "c1", text: "New text" },
    "s-1",
    saved,
  ),
  true,
  "an Edit box with changed text not saved must stop Send all, or the old text goes and the new is lost",
);
assert.equal(
  draftUnsaved({ session: "s-1", text: "A new comment" }, "s-1", saved),
  true,
  "a new comment box with text must stop Send all",
);
assert.equal(
  draftUnsaved({ session: "s-1", text: "   " }, "s-1", saved),
  false,
  "an empty new comment box must not stop Send all",
);
assert.equal(
  draftUnsaved(
    { session: "s-1", editId: "gone", text: "Kept text" },
    "s-1",
    saved,
  ),
  true,
  "an Edit box whose comment is gone holds the only copy of its text and must stop Send all",
);
assert.equal(
  draftUnsaved({ session: "s-2", text: "Elsewhere" }, "s-1", saved),
  false,
  "an open box in another session must not stop this session's Send all",
);
ok("Send all waits for an open box with unsaved text");

// ---- a batch not delivered comes back to the list
const back = commentStore(memory());
back.add("s-1", { ...list[1], text: "Changed while sending" });
back.add("s-2", list[2]);
back.putBack("s-1", [list[0], list[1]]);
assert.deepEqual(
  back.list("s-1").map((c) => [c.id, c.text]),
  [
    ["c2", "Changed while sending"],
    ["c1", "Too long."],
  ],
  "a batch not delivered must put its comments back, keeping one still in the list as it is",
);
assert.deepEqual(
  back.list("s-2").map((c) => c.id),
  ["c3"],
  "putting a batch back must not touch another session",
);
assert.deepEqual(
  withRestored([list[0]], [list[0], list[2]]).map((c) => c.id),
  ["c1", "c3"],
  "a comment whose id is in the list must not be added twice",
);
ok("the comments of a batch not delivered are back in the list");

console.log(`all ${n} passed`);
