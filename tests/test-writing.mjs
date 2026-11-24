// Tests for the writing skill's checker (skills/writing/tell-check.mjs): each strong mark prints and its human
// sentence from the design does not; marks in code, quotes and quoted spans are left out; weak notes print only two
// or more to a paragraph; line numbers match the file; a bad path stops with exit 2.
// Run: node tests/test-writing.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "..");
const CHECK = path.join(REPO, "skills", "writing", "tell-check.mjs");
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`,
  );
};
const run = (input, ...args) =>
  spawnSync(process.execPath, [CHECK, ...(args.length ? args : ["-"])], {
    input,
    encoding: "utf8",
  });
const show = (r) => `exit ${r.status}: ${(r.stdout + r.stderr).trim()}`;
const NONE = "0 strong, 0 weak (in 0 paragraphs)";
const clean = (r) => r.status === 0 && r.stdout.trim() === NONE;

// One input per strong pattern, then the human sentence for each mark that must print nothing
const STRONG = {
  "Placeholder left in": [
    "Dear [Name of client], thanks for the call.",
    "Dear [Name], thanks for the call.",
    "Hi [Manager's name], can we talk?",
    "We start at [time] sharp.",
    "The launch is on [insert date].",
    "TODO: add the price.",
    "The venue is TBD.",
    "Call XXX about the van.",
  ],
  "Note to the user left in": ["Delete this section before publishing."],
  "Chat residue": [
    "I hope this helps!",
    "Let me know if you'd like a shorter one.",
    "As an AI language model, I cannot say.",
    "Great question, and a fair one.",
  ],
  "Process talk": [
    "I rewrote it while preserving the original meaning.",
    "Edited for clarity and flow.",
    "I ensured consistency across the sections.",
    "I kept it short, preserving the voice.",
  ],
  "Contrast forms": [
    "This is not just a tool, it's a partner.",
    "This isn't just a tool — it's a partner.",
    "It's not a bug — it's a feature.",
    "More than a shop, it's a meeting place.",
    "It feels less like a chore and more like a game.",
  ],
  "Corrective framing": [
    "The figure should be seen as a guide rather than a rule.",
    "Speed should not be confused with progress.",
    "The drop does not mean that the plan failed, which does not imply that it worked.",
  ],
  "Spelling out the meaning": [
    "This matters for every team.",
    "Why pricing matters to us.",
    "Here's why it matters.",
  ],
  "Staged run-up": [
    "Here's the thing: nobody reads the manual.",
    "Here's what nobody tells you about hiring.",
    "The result? A build twice as fast.",
    "Let that sink in.",
    "Stop guessing. Start measuring.",
  ],
  "Claude 2026 phrases": [
    "That test is the load-bearing part of the plan.",
    "The fix is genuinely simple.",
    "My honest take: wait a week.",
    "The honest answer is no.",
    "We ran both checks, belt and suspenders.",
  ],
};
const HUMAN = {
  "Placeholder left in":
    "Log in to [your account](https://example.com) and clear the todo list.",
  "Note to the user left in": "Check every answer before submitting the form.",
  "Chat residue": "I worked as an AI researcher; let me know if you can come.",
  "Process talk":
    "The town rebuilt the square while preserving the old fountain.",
  "Contrast forms": "Not only did it rain, but the road flooded too.",
  "Corrective framing":
    "The second test should be read as a check of the first.",
  "Spelling out the meaning": "It matters to me that you came.",
  "Staged run-up": "The thing is broken, and the result was a late train.",
  "Claude 2026 phrases": "She gave an honest answer; the gift was genuine.",
};
for (const [mark, inputs] of Object.entries(STRONG)) {
  for (const input of inputs) {
    const r = run(input);
    check(
      `strong mark "${mark}" found in: ${input}`,
      r.status === 1 && r.stdout.includes(`1: strong ${mark}: "`),
      show(r),
    );
  }
  const r = run(HUMAN[mark]);
  check(`no mark in the human sentence for "${mark}"`, clean(r), show(r));
}

// Ordinary prose that fired on the first patterns (build review): must print nothing
for (const input of [
  "More than a year later, it's still running.",
  "It's not finished, its tests still fail.",
  "None of this matters if the build fails.",
  "Not sure why that matters for the invoice.",
  "See [your account][1] for details.",
  "We shot the landscape at dawn, then the landscape again at dusk.",
]) {
  const r = run(input);
  check(`no mark in ordinary prose: ${input}`, clean(r), show(r));
}

// Left out: code fence, inline code, a ">" quote, quoted spans (straight and curly), a URL, a link target
const PHRASE = "I hope this helps";
for (const [where, input] of [
  ["a code fence", `Intro.\n\n\`\`\`\n${PHRASE}\n\`\`\`\n`],
  ["a ~~~ fence", `~~~md\n${PHRASE}\n~~~\n`],
  ["inline code", `Avoid \`${PHRASE}\` at the end.`],
  ["a > quote", `> ${PHRASE}\n> great question\n`],
  ["a straight-quoted span", `Never end with "${PHRASE}" in a letter.`],
  ["a curly-quoted span", `Never end with “${PHRASE}” in a letter.`],
  ["a URL", "See https://example.com/TODO/load-bearing for the list."],
  ["a link target", "See [the list](https://example.com/great-question)."],
]) {
  const r = run(input);
  check(`a marked phrase in ${where} is left out`, clean(r), show(r));
}
const linkText = run("See [I hope this helps](https://example.com).");
check(
  "link text is still checked",
  linkText.status === 1 && linkText.stdout.includes("strong Chat residue"),
  show(linkText),
);

// Line numbers and line wraps
const lined = run(
  "# Notes\n\n```\ncode\n```\n\nThe plan is fine.\nI hope\nthis helps.\n",
);
check(
  "a phrase broken by a line wrap is found, at the line where it starts",
  lined.status === 1 &&
    lined.stdout.startsWith('8: strong Chat residue: "I hope this helps"') &&
    lined.stdout.includes("1 strong, 0 weak (in 1 paragraphs)"),
  show(lined),
);
const twoParas = run("Let that sink in.\n\nGreat question.\n");
check(
  "the count line counts marks and paragraphs",
  /^1: strong .*\n3: strong .*\n2 strong, 0 weak \(in 2 paragraphs\)\n$/.test(
    twoParas.stdout,
  ),
  show(twoParas),
);

// Weak notes: one alone passes, two in one paragraph print, two in different paragraphs pass
const oneWeak = run("The tool quietly saves the file.");
check("one weak word alone prints nothing", clean(oneWeak), show(oneWeak));
const twoWeak = run("The tool quietly does the heavy lifting.");
check(
  "two weak words in one paragraph print",
  twoWeak.status === 1 &&
    twoWeak.stdout.includes('1: weak Agent words: "quietly"') &&
    twoWeak.stdout.includes('1: weak Agent words: "heavy lifting"') &&
    twoWeak.stdout.includes("0 strong, 2 weak (in 1 paragraphs)"),
  show(twoWeak),
);
const apart = run("The tool quietly saves.\n\nIt does the heavy lifting.");
check(
  "two weak words in different paragraphs print nothing",
  clean(apart),
  show(apart),
);
const human = run(
  "The bridge has a robust steel frame — it carried the test load without a crack.",
);
check(
  'a human paragraph with "robust" and one dash prints nothing',
  clean(human),
  show(human),
);
const dashes = run(
  "We met — late — and talked — at length — about the robust plan.",
);
check(
  "three or more dashes count as one weak note",
  dashes.status === 1 &&
    dashes.stdout.includes('weak Dash habit: "4 dashes"') &&
    dashes.stdout.includes('weak Older words: "robust"'),
  show(dashes),
);
const emoji = run("## 🚀 Launch notes\nWe delve into the plan.\n");
check(
  "an emoji heading is a weak note",
  emoji.status === 1 && emoji.stdout.includes("1: weak Emoji heading"),
  show(emoji),
);
const bullets = run(
  "- **Speed:** fast\n- **Cost:** low\n- **Risk:** small\n- leverage the plan\n",
);
check(
  "three bold-label bullets in a short text are a weak note",
  bullets.status === 1 &&
    bullets.stdout.includes(
      '1: weak Bold-label bullets in short text: "3 bold-label bullets"',
    ),
  show(bullets),
);

// Input from a file, a missing file, an empty file
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tell-check-test-"));
const draft = path.join(tmp, "draft.md");
fs.writeFileSync(draft, "Hello.\r\n\r\nGreat question.\r\n");
const fromFile = run("", draft);
check(
  "a file path is read, CRLF lines counted",
  fromFile.status === 1 && fromFile.stdout.startsWith("3: strong Chat residue"),
  show(fromFile),
);
const missing = run("", path.join(tmp, "nope.md"));
check(
  "a missing file stops with exit 2 and the error",
  missing.status === 2 && /cannot read .*nope\.md/.test(missing.stderr),
  show(missing),
);
fs.writeFileSync(draft, "\n\n");
const empty = run("", draft);
check("an empty file stops with exit 2", empty.status === 2, show(empty));
const noArg = spawnSync(process.execPath, [CHECK], { encoding: "utf8" });
check("no argument stops with exit 2", noArg.status === 2, show(noArg));
fs.rmSync(tmp, { recursive: true, force: true });

// The skill's text (release 26.6, D6 and D8): every text a person reads, reader first, the diagram rule, and the
// fresh reader whose answer is the page's verdict
const readRepo = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
const skill = readRepo("skills", "writing", "SKILL.md");
const kinds = readRepo("skills", "writing", "kinds.md");
const blind = readRepo("agents", "blind-reviewer.md");
const description = /^description: (.*)$/m.exec(skill)?.[1] ?? "";
// A line wrap inside a phrase is not a change: whitespace runs count as one space
const has = (name, src, list) => {
  const flat = src.replace(/\s+/g, " ");
  const absent = list.filter((re) => !re.test(flat)).join(", ");
  check(name, !absent, `not found: ${absent}`);
};
has(
  "the skill is reached for every text a person reads, files written for the user too",
  description,
  [
    /README/,
    /tour/,
    /guide/,
    /explainer/,
    /release notes/,
    /film script/,
    /wiki page/,
    /description of work done/,
  ],
);
check(
  "the skill no longer turns away files written for the user",
  !/files written for the user/.test(description),
  description,
);
const beforeDraft = /## Before the draft([\s\S]*?)\n## /.exec(skill)?.[1] ?? "";
has(
  "before drafting it names the reader and the one message, lists candidate points and cuts to what the reader came for",
  beforeDraft,
  [
    /\*\*The reader\.\*\*/,
    /\*\*The one message\.\*\*/,
    /candidate points/,
    /what the reader came for/,
    /nobody just needs to read stuff just to read stuff/,
  ],
);
has(
  "what was tried and removed stays out, and build details go to the changelog",
  beforeDraft,
  [/tried and removed/, /changelog/],
);
has(
  "the diagram rule: branching or structure only, at most 8 boxes, labels of 1-3 words, a straight sequence is a list",
  skill,
  [
    /only for branching or structure/,
    /at most 8 boxes/i,
    /1-3 words/,
    /straight sequence is a (numbered )?list/,
    /scripts\/diagram-rule\.mjs/,
  ],
);
has(
  "a page gets a fresh reader: the blind-reviewer with the rendered pages, the reader's questions and the user's marked examples",
  skill,
  [
    /`blind-reviewer`/,
    /rendered page/,
    /the reader's questions/,
    /the user's marked examples/,
  ],
);
has(
  "the fresh reader's answer is saved word for word as the page's .proof/<page name>/verdict.md",
  skill,
  [/word for word/, /`\.proof\/<page name>\/verdict\.md`/, /SYSTEMS MAP: none/],
);
const kindHeadings = kinds.match(/^## .*$/gm)?.join(" | ") ?? "";
has("kinds.md has a section for every new kind of text", kindHeadings, [
  /tour/i,
  /guides?/i,
  /wiki page/i,
  /description of work done/i,
  /film script/i,
]);
has(
  "the blind-reviewer answers the reader's questions from the page alone and judges by the user's marked examples",
  blind,
  [
    /The reader's questions/,
    /The user's marked examples/,
    /Questions: /,
    /not answered/,
  ],
);
// A run on the 26.6 pull request text opened with a summary paragraph, so the saved verdict's first line was not
// PASS or FAIL and verify-gate could never read it
has(
  "the blind-reviewer's answer starts on the PASS or FAIL line, with no summary before it",
  blind,
  [/no summary or title before it/],
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
