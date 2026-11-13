// Tests for scripts/blocks.mjs (the carve's blocks, keys, unfit, carve, appendOwn) and the release guard
// in scripts/rules-history.mjs. Design checks 4, 5, 7, 8, 14 and unfit (docs/2026-11-09-b8b-design.md).
// Run: node tests/test-blocks.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  splitBlocks,
  normal,
  key,
  lead,
  unfit,
  carve,
  appendOwn,
} from "../scripts/blocks.mjs";
import { formKeys, missing } from "../scripts/rules-history.mjs";
import { fitter } from "../scripts/repo.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};
const keysOf = (text) => splitBlocks(text).map((b) => key(b.text));

const SHIPPED = [
  "# How to work",
  "",
  "- **Don't assume.** Ask when a requirement is unclear and the choice matters.",
  "- **Try it small first.** Run new scripts on a small slice before running them on everything,",
  "  then on the rest.",
  "",
  "# Delegating to cheaper models",
  "",
  "- Keep reasoning and final review in the main session.",
  "",
].join("\n");
const shippedKeys = keysOf(SHIPPED);

// Splitting
const blocks = splitBlocks(SHIPPED);
ok(
  "split: headings, items with continuation lines",
  blocks.map((b) => [b.heading, b.text.split("\n").length]),
  [
    ["How to work", 1],
    ["How to work", 1],
    ["How to work", 2],
    ["Delegating to cheaper models", 1],
    ["Delegating to cheaper models", 1],
  ],
);
ok(
  "split: a paragraph of two lines is one block",
  splitBlocks("One line\nand the next.\n\nOther.").map((b) => b.text),
  ["One line\nand the next.", "Other."],
);
ok(
  "split: a fence keeps its blank lines",
  splitBlocks("- Run:\n  ```\n  a\n\n  b\n  ```\n- Next.").length,
  2,
);
ok(
  "normal: CRLF, trimmed lines, one space",
  normal("- a  b\r\n   c\td\r\n"),
  "- a b c d",
);
ok("key: 16 hex", /^[0-9a-f]{16}$/.test(key("- x")), true);
ok(
  "lead: bold opening",
  lead("- **Don't assume.** Ask when unclear."),
  "Don't assume.",
);
ok(
  "lead: else first six words",
  lead("- Keep reasoning and final review in the main session."),
  "Keep reasoning and final review in",
);

// Check 4: an own bullet under # How to work, with continuation lines and a nested bullet, kept whole
const OWN4 =
  "- **My tables first.** Look in the reports schema before\n  asking where data lives.\n  - Nested: the archive schema is read-only.";
const person4 = SHIPPED.replace(
  "  then on the rest.\n",
  "  then on the rest.\n" + OWN4 + "\n",
);
const c4 = carve(person4, shippedKeys, []);
ok("check 4: one own block, under How to work, in full", c4.own, [
  { heading: "How to work", text: OWN4 },
]);
ok("check 4: shipped blocks counted", [c4.shippedCount, c4.oldCount], [5, 0]);
ok(
  "check 4: appended under ## How to work",
  appendOwn("", c4.own),
  `## How to work\n\n${OWN4}\n`,
);

// Check 5: an own section with three bullets moves intact and in order; old setup text counts as old
const OLD = "- **Old rule.** A rule the setup used to ship.";
const person5 =
  SHIPPED +
  "\n" +
  OLD +
  "\n\n# My field\n\n- One.\n- Two,\n  wrapped.\n- Three.\n";
const c5 = carve(person5, shippedKeys, keysOf(OLD));
ok(
  "check 5: three own bullets in order",
  c5.own.map((b) => [b.heading, b.text]),
  [
    ["My field", "- One."],
    ["My field", "- Two,\n  wrapped."],
    ["My field", "- Three."],
  ],
);
ok("check 5: old setup text counted, not own", c5.oldCount, 1);
ok(
  "check 5: one heading for the section",
  appendOwn("", c5.own),
  "## My field\n\n- One.\n- Two,\n  wrapped.\n- Three.\n",
);

// Check 7: CRLF and a re-wrapped shipped bullet still count as shipped
const rewrapped = SHIPPED.replace(
  "- **Try it small first.** Run new scripts on a small slice before running them on everything,\n  then on the rest.",
  "- **Try it small first.** Run new scripts on a\nsmall slice before running them on\n    everything, then on the rest.",
);
const c7 = carve(rewrapped.replace(/\n/g, "\r\n"), shippedKeys, []);
ok(
  "check 7: CRLF and re-wrapped give no own blocks",
  [c7.own.length, c7.shippedCount],
  [0, 5],
);

// Check 8: an existing my-rules.md is kept byte for byte; a block already there is not added again
const EXISTING =
  "# My rules\r\n\r\n## How to work\r\n\r\n" + OWN4.replace(/\n/g, "\r\n");
const appended = appendOwn(EXISTING, [
  ...c4.own,
  { heading: "How to work", text: "- New one." },
  { heading: "How to work", text: "- New one." },
]);
ok(
  "check 8: existing text kept as the start",
  appended.startsWith(EXISTING),
  true,
);
ok(
  "check 8: only the new block appended, once, under the same section, with the file's CRLF",
  appended.slice(EXISTING.length),
  "\r\n\r\n- New one.\r\n",
);
ok(
  "check 8: a new section in a CRLF file is all CRLF",
  appendOwn("## A\r\n\r\n- A.\r\n", [
    { heading: "B", text: "- B,\n  wrapped." },
  ]),
  "## A\r\n\r\n- A.\r\n\r\n## B\r\n\r\n- B,\r\n  wrapped.\r\n",
);
ok(
  "check 8: a different section gets its heading",
  appendOwn("## How to work\n\n- A.\n", [{ heading: "Data", text: "- B." }]),
  "## How to work\n\n- A.\n\n## Data\n\n- B.\n",
);
ok(
  "check 8: nothing new leaves the text as it was",
  appendOwn(EXISTING, c4.own),
  EXISTING,
);
ok(
  "blocks before any heading go under ## My rules",
  appendOwn("", carve("Mine, no heading.", [], []).own),
  "## My rules\n\nMine, no heading.\n",
);

// unfit: the real folder back to <projects>; the person's file keys like the history's form
const HOME =
  '- Finding things: `<projects>\\internet-search`. Codex: `codex exec -c \'windows.sandbox="unelevated"\' "task"`.';
const history = formKeys(HOME);
const nonWin = fitter(REPO, "/home/someone/Projects", false)
  .fit("CLAUDE.md", Buffer.from(HOME))
  .toString("utf8");
ok(
  "unfit win=false: the fitted text has the / path and the sandbox cut",
  [
    nonWin.includes("/home/someone/Projects/internet-search"),
    nonWin.includes("sandbox"),
  ],
  [true, false],
);
ok(
  "unfit win=false: back to <projects>\\ with the cut kept",
  unfit(nonWin, "/home/someone/Projects", false),
  HOME.replace(` -c 'windows.sandbox="unelevated"'`, ""),
);
ok(
  "unfit win=false: the block is old setup text",
  carve(unfit(nonWin, "/home/someone/Projects", false), [], history).oldCount,
  1,
);
const win = fitter(REPO, "C:\\Users\\someone\\Projects", true)
  .fit("CLAUDE.md", Buffer.from(HOME))
  .toString("utf8");
ok(
  "unfit win=true: the original back",
  unfit(win, "C:\\Users\\someone\\Projects", true),
  HOME,
);
const ownPath = "- Mine: `C:\\Users\\someone\\Projects\\notes`.";
ok(
  "carve keys the unfit form but an own block keeps the real folder",
  carve(win + "\n" + ownPath, [], history, (t) =>
    unfit(t, "C:\\Users\\someone\\Projects", true),
  ),
  { own: [{ heading: null, text: ownPath }], oldCount: 1, shippedCount: 0 },
);
ok(
  "unfit win=true: the block is old setup text",
  carve(unfit(win, "C:\\Users\\someone\\Projects", true), [], history).oldCount,
  1,
);

// Check 14: the release guard, on a copy with a block the history lacks, then on this repository
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "blocks-test-"));
fs.mkdirSync(path.join(tmp, "rules"));
fs.mkdirSync(path.join(tmp, "projects", "quick-tasks"), { recursive: true });
fs.writeFileSync(path.join(tmp, "rules", "CLAUDE.md"), SHIPPED);
fs.writeFileSync(
  path.join(tmp, "projects", "quick-tasks", "CLAUDE.md"),
  "# Quick tasks\n\n- **New home rule.** Not released yet.\n",
);
fs.writeFileSync(
  path.join(tmp, "rules", "history.json"),
  JSON.stringify({ shipped: [...formKeys(SHIPPED)], added: [] }),
);
ok(
  "check 14: a block missing from the history is named",
  missing(tmp).map((m) => m.lead),
  ["Quick tasks", "New home rule."],
);
fs.writeFileSync(
  path.join(tmp, "rules", "history.json"),
  JSON.stringify({
    shipped: [...formKeys(SHIPPED)],
    added: [
      ...formKeys("# Quick tasks\n\n- **New home rule.** Not released yet.\n"),
    ],
  }),
);
ok("check 14: added keys count", missing(tmp), []);
fs.rmSync(tmp, { recursive: true, force: true });
const r = spawnSync(
  process.execPath,
  [path.join(REPO, "scripts", "rules-history.mjs"), "--check"],
  { encoding: "utf8" },
);
ok(
  "check 14: this repository's history.json has every current block",
  [r.status, r.stdout.trim()],
  [0, "rules history: every current block is in rules/history.json"],
);

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
