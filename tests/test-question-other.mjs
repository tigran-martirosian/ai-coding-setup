// Tests for hooks/question-other.mjs. Run: node tests/test-question-other.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

let total = 0;
const log = console.log;
console.log = (s, ...rest) => {
  if (/^(PASS|FAIL) /.test(String(s))) total++;
  log(s, ...rest);
};
const HOOK = fileURLToPath(
  new URL("../hooks/question-other.mjs", import.meta.url),
);
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...process.env, CLAUDE_PROJECT_DIR: "", ...env },
    encoding: "utf8",
  }).stdout;
const P = (fields) => ({
  tool_name: "mcp__nimbalyst__PromptForUserInput",
  tool_input: { fields },
});
const single = (extra = {}) => ({
  type: "singleSelect",
  id: "a",
  label: "Which look?",
  options: [
    { id: "x", label: "X" },
    { id: "y", label: "Y" },
  ],
  ...extra,
});
const rec = (extra = {}) => ({ id: "x", label: "X (recommended)", ...extra });
// A reason in plain words: the hook no longer checks its wording (user, 2026-11-12: the rules carry it, not a hook)
const WHY =
  "engine.mjs already uses this one; Y is better only if speed matters more.";
const ELSE = {
  type: "editText",
  id: "else",
  label: "Anything else?",
  initialText: "",
};

const cases = [
  // A form with no typing box is no longer refused (user, 2026-11-12): a refusal never took it off the screen
  [
    "singleSelect without allowOther goes out with a note",
    P([single()]),
    "note",
  ],
  [
    "singleSelect with allowOther:false goes out with a note",
    P([single({ allowOther: false })]),
    "note",
  ],
  [
    "singleSelect with allowOther passes",
    P([single({ allowOther: true })]),
    false,
  ],
  [
    "confirm plus an editText passes",
    P([{ type: "confirm", id: "c", label: "Remove unused options?" }, ELSE]),
    false,
  ],
  [
    "confirm alone goes out with a note (nothing to type in)",
    P([{ type: "confirm", id: "c", label: "Remove unused options?" }]),
    "note",
  ],
  [
    "reorder alone goes out with a note (nothing to type in)",
    P([
      {
        type: "reorder",
        id: "r",
        label: "Order?",
        items: [{ id: "a", title: "A" }],
      },
    ]),
    "note",
  ],
  [
    "multiSelect alone goes out with a note (nothing to type in)",
    P([
      {
        type: "multiSelect",
        id: "m",
        label: "m",
        items: [{ id: "a", title: "A" }],
      },
    ]),
    "note",
  ],
  [
    "multiSelect with allowOther but no editText after it goes out with a note (Nimbalyst drops allowOther there)",
    P([
      { type: "multiSelect", id: "m", label: "m", allowOther: true, items: [] },
      single({ allowOther: true }),
    ]),
    "note",
  ],
  [
    "multiSelect whose editText comes later, not right after it, goes out with a note",
    P([
      { type: "multiSelect", id: "m", label: "m", items: [] },
      single({ allowOther: true }),
      ELSE,
    ]),
    "note",
  ],
  [
    "two multiSelects each followed by an editText pass",
    P([
      { type: "multiSelect", id: "m", label: "m", items: [] },
      ELSE,
      { type: "multiSelect", id: "n", label: "n", items: [] },
      { ...ELSE, id: "e2" },
    ]),
    false,
  ],
  [
    "two multiSelects, only the second followed by an editText, goes out with a note",
    P([
      { type: "multiSelect", id: "m", label: "m", items: [] },
      { type: "multiSelect", id: "n", label: "n", items: [] },
      ELSE,
    ]),
    "note",
  ],
  [
    "confirm with an editText elsewhere in the form passes",
    P([
      { type: "confirm", id: "c", label: "Keep it?" },
      { type: "multiSelect", id: "m", label: "m", items: [] },
      ELSE,
    ]),
    false,
  ],
  [
    "Nimbalyst's AskUserQuestion passes (its card has its own typing box)",
    {
      tool_name: "mcp__nimbalyst__AskUserQuestion",
      tool_input: {
        questions: [
          {
            header: "h",
            question: "Which?",
            options: [
              { label: "A", description: "a" },
              { label: "B", description: "b" },
            ],
          },
        ],
      },
    },
    false,
  ],
  [
    "the built-in AskUserQuestion passes",
    {
      tool_name: "AskUserQuestion",
      tool_input: {
        questions: [
          {
            header: "h",
            question: "Which?",
            options: [
              { label: "A", description: "a" },
              { label: "B", description: "b" },
            ],
          },
        ],
      },
    },
    false,
  ],
  [
    "a path in the form with no session record fails open",
    P([
      single({ allowOther: true }),
      {
        type: "editText",
        id: "e",
        label: "Full draft: docs/plan.md. Anything else?",
        initialText: "",
      },
    ]),
    false,
  ],
  [
    "mixed: one good, one bad singleSelect goes out with a note",
    P([
      single({ allowOther: true }),
      single({ id: "b", label: "Which photo?" }),
    ]),
    "note",
  ],
  [
    "multiSelect/editText pass",
    P([
      { type: "multiSelect", id: "m", label: "m", items: [] },
      { type: "editText", id: "e", label: "e", initialText: "" },
    ]),
    false,
  ],
  [
    "other tools pass",
    { tool_name: "Read", tool_input: { file_path: "x" } },
    false,
  ],
  ["bad JSON fails open", "not json", false],
  [
    "no fields fails open",
    { tool_name: "mcp__nimbalyst__PromptForUserInput", tool_input: {} },
    false,
  ],
  // The reason on a recommended option is the rules' job now: no "Checked:/Judgment:/Other wins if" labels (user, 2026-11-12)
  [
    "recommended option with a reason in plain words passes",
    P([
      single({
        allowOther: true,
        options: [rec({ description: WHY }), { id: "y", label: "Y" }],
      }),
    ]),
    false,
  ],
  [
    "recommended option with a reason in DECISIONS words passes (no label check any more)",
    P([
      single({
        allowOther: true,
        options: [
          rec({ description: "DECISIONS.md already picks this one." }),
          { id: "y", label: "Y" },
        ],
      }),
    ]),
    false,
  ],
  [
    "two recommended options in one singleSelect go out with a note",
    P([
      single({
        allowOther: true,
        options: [
          rec({ description: WHY }),
          rec({ id: "y", description: WHY }),
        ],
      }),
    ]),
    "note",
  ],
  [
    "multiSelect with several recommended items and reasons passes",
    P([
      {
        type: "multiSelect",
        id: "m",
        label: "m",
        items: [
          { id: "a", title: "A", badge: "recommended", subtitle: WHY },
          { id: "b", title: "B (recommended)", subtitle: WHY },
        ],
      },
      ELSE,
    ]),
    false,
  ],
  [
    "'not recommended' in a description is not a recommendation",
    P([
      single({
        allowOther: true,
        options: [
          { id: "x", label: "X", description: "not recommended" },
          { id: "y", label: "Y" },
        ],
      }),
    ]),
    false,
  ],
];
let fail = 0;
// Nimbalyst draws the form from Claude's own call, so nothing is changed in place and nothing is refused:
// "note" = sent unchanged with a note to Claude, false = no output
const hso = (o) => {
  try {
    return JSON.parse(o).hookSpecificOutput || null;
  } catch {
    return null;
  }
};
const check = (out, want) => {
  const h = hso(out);
  if (want === "note")
    return (
      !!h &&
      !h.permissionDecision &&
      !h.updatedInput &&
      /^question-other: .*went out as is/.test(h.additionalContext || "")
    );
  return out === "";
};
for (const [name, input, deny] of cases) {
  const out = run(input);
  const ok = check(out, deny);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const off = run(P([single()]), { QUESTION_OTHER: "off" }) === "";
if (!off) fail++;
console.log(`${off ? "PASS" : "FAIL"} QUESTION_OTHER=off disables it`);
// Never an in-place change (it never reaches the screen); a missing box goes out with a note: the fix for the next
// form, and a reply line naming the question so the user can still type their own answer
const reason = (o) => hso(o)?.additionalContext || "";
const one = run(P([single({ label: "Which photo?" })]));
const named =
  check(one, "note") &&
  reason(one).includes('"Which photo?" had no box to type in') &&
  reason(one).includes("mcp__nimbalyst__AskUserQuestion") &&
  reason(one).includes("allowOther: true");
if (!named) fail++;
console.log(
  `${named ? "PASS" : "FAIL"} the note names the question, the reply line, the question card and allowOther`,
);
const multiOut = run(
  P([{ type: "multiSelect", id: "m", label: "Which parts?", items: [] }]),
);
const multi = reason(multiOut);
const multiOk =
  check(multiOut, "note") &&
  multi.includes('"Which parts?" had no box to type in') &&
  multi.includes("right after each multiSelect");
if (!multiOk) fail++;
console.log(
  `${multiOk ? "PASS" : "FAIL"} the note on a multiSelect has the reply line and asks for an editText right after it`,
);
const nim = run({
  tool_name: "mcp__nimbalyst__AskUserQuestion",
  tool_input: { questions: [] },
});
const nimOk = nim === "";
if (!nimOk) fail++;
console.log(
  `${nimOk ? "PASS" : "FAIL"} Nimbalyst AskUserQuestion with no recommended pick is silent`,
);
const both = run(
  P([
    single({
      label: "Which engine?",
      options: [
        rec({ description: WHY }),
        rec({ id: "y", label: "Y (recommended)", description: WHY }),
      ],
    }),
  ]),
);
const bothOk =
  check(both, "note") &&
  reason(both).includes("allowOther") &&
  reason(both).includes("Recommend one, or none") &&
  reason(both).includes("tell the user");
if (!bothOk) fail++;
console.log(
  `${bothOk ? "PASS" : "FAIL"} a form with no typing box names its other faults in the same note and says to tell the user`,
);
const two = run(
  P([
    single({
      allowOther: true,
      options: [
        rec({ description: WHY }),
        rec({ id: "y", label: "Y (recommended)", description: WHY }),
      ],
    }),
  ]),
);
const twoOk = check(two, "note") && two.includes("Recommend one, or none");
if (!twoOk) fail++;
console.log(
  `${twoOk ? "PASS" : "FAIL"} two recommended options go out with a note saying to recommend one`,
);

// The full temp path: on GitHub Windows it is a short RUNNER~1 path, and a path with a ~ in it is not read as a file
const dir = mkdtempSync(join(realpathSync.native(tmpdir()), "question-other-"));
const user = (text) => ({
  type: "user",
  message: { role: "user", content: text },
});
const call = (name, input) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "tool_use", name, input }] },
});
const result = () => ({
  type: "user",
  message: { role: "user", content: [{ type: "tool_result", content: "ok" }] },
});
const form = (description) =>
  P([
    single({
      allowOther: true,
      label: "Which engine?",
      options: [rec({ description }), { id: "y", label: "Y" }],
    }),
  ]);
// pointing the user at something to look at needs a link this turn
const text = (s) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text: s }] },
});
const look = (extra = {}) => ({
  ...P([]),
  tool_input: {
    title: "Look through the wood page first",
    fields: [single({ allowOther: true, label: "Is it right?" }), ELSE],
    ...extra,
  },
});
const plain = (extra = {}) => ({
  ...P([]),
  tool_input: {
    fields: [single({ allowOther: true, label: "Which engine?" }), ELSE],
    ...extra,
  },
});
const withTurn = (entries, input, env = {}) => {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return run({ ...input, transcript_path: file }, env);
};
// A card sent right after a typed message with no labels in it: the hook refuses only with a readable session record
const card = (input, env = {}) => withTurn([user("go on")], input, env);
const LINKED =
  "Built the wood page: [wood.html](/C:/Projects/my-project/docs/wood.html). I think it reads well; I'd keep it.";
const linkCases = [
  [
    "'Look through the page' with no link anywhere goes out with a note",
    [user("make the wood page"), text("_Done: the wood page is built._")],
    look(),
    "note",
  ],
  [
    "'Look through the page' after a /C:/ link in the reply passes",
    [user("make the wood page"), text(LINKED)],
    look(),
    false,
  ],
  [
    "a Mac /Users/ link in the reply passes",
    [user("make it"), text("See [wood](/Users/you/x/wood.html).")],
    look(),
    false,
  ],
  [
    "a protocol-relative //host link is not a local link",
    [user("make it"), text("See [wood](//host/x/wood.html).")],
    look(),
    "note",
  ],
  [
    "a Git Bash /c/ link is not a local link",
    [user("make it"), text("See [wood](/c/Projects/x/wood.html).")],
    look(),
    "note",
  ],
  [
    "a board call after the link still leaves it in front of the user",
    [
      user("make it"),
      text(LINKED),
      call("mcp__nimbalyst__update_session_meta", { phase: "validating" }),
      result(),
    ],
    look(),
    false,
  ],
  [
    "a C:/ link without the leading slash passes",
    [user("make it"), text("See [wood](C:/Projects/x/wood.html).")],
    look(),
    false,
  ],
  [
    "a web link in the reply passes",
    [user("make it"), text("Live at https://example.com/wood")],
    look(),
    false,
  ],
  [
    "a link followed by another tool call before the form goes out with a note",
    [
      user("make it"),
      text(LINKED),
      call("Bash", { command: "git add ." }),
      result(),
      text("Saved."),
    ],
    look(),
    "note",
  ],
  [
    "an old research URL earlier in the turn does not count",
    [
      user("make it"),
      text("Found https://modrinth.com/mod/x/gallery"),
      call("Bash", { command: "python build.py" }),
      result(),
      text("The page works."),
    ],
    look(),
    "note",
  ],
  [
    "a picture shown before more tool calls does not count",
    [
      user("make it"),
      call("mcp__nimbalyst__display_to_user", { items: [] }),
      result(),
      call("Edit", { file_path: "a" }),
      result(),
    ],
    look(),
    "note",
  ],
  [
    "a link, then an earlier try of the form, still counts",
    [
      user("make it"),
      text(LINKED),
      call("mcp__nimbalyst__PromptForUserInput", look().tool_input),
    ],
    look(),
    false,
  ],
  [
    "'Scroll the wood page' with no link goes out with a note",
    [user("make it"), text("Opened it.")],
    plain({
      intro:
        "Scroll the wood page (open in your browser), then type the ones you want.",
    }),
    "note",
  ],
  [
    "a link only in an earlier turn goes out with a note",
    [user("hi"), text(LINKED), user("now ask me")],
    look(),
    "note",
  ],
  [
    "a backslash link (Nimbalyst can't open it) goes out with a note",
    [user("make it"), text("See [wood](C:\\Projects\\x\\wood.html).")],
    look(),
    "note",
  ],
  [
    "a link inside the form's intro passes",
    [user("make it")],
    look({ intro: "[wood.html](/C:/Projects/x/wood.html)" }),
    false,
  ],
  [
    "a picture shown inline this turn passes",
    [
      user("make it"),
      call("mcp__nimbalyst__display_to_user", { items: [] }),
      result(),
    ],
    look(),
    false,
  ],
  [
    "a link written by a subagent does not count",
    [user("make it"), { ...text(LINKED), isSidechain: true }],
    look(),
    "note",
  ],
  [
    "a file path in the intro with no link goes out with a note",
    [user("plan it")],
    plain({ intro: "Full draft: docs/boss-materials.md. Three choices." }),
    "note",
  ],
  [
    "'goes into DECISIONS.md' is not something to look at",
    [user("plan it")],
    plain({ intro: "Your answers go into DECISIONS.md." }),
    false,
  ],
  [
    "'look at the buyer' is not something to look at",
    [user("deals?")],
    plain({ intro: "A small deal panel while you look at the buyer." }),
    false,
  ],
  [
    "'make photos for you to look at' (not made yet) passes",
    [user("photos?")],
    plain({ intro: "Make AI photos as a trial for you to look at (~$1.50)?" }),
    false,
  ],
  [
    "RU: 'Откройте страницу про дерево' with no link goes out with a note",
    [user("make it"), text("Готово.")],
    plain({
      intro: "Откройте эту новую страницу про дерево и отметьте нужное.",
    }),
    "note",
  ],
  [
    "RU: 'посмотрите на него' with no link goes out with a note",
    [user("make it"), text("Готово.")],
    plain({ intro: "Посмотрите на него и скажите, подходит ли." }),
    "note",
  ],
  [
    "RU: 'то, что я собрал' with a link in the reply passes",
    [user("make it"), text(LINKED)],
    plain({ intro: "Проверьте то, что я собрал." }),
    false,
  ],
  [
    "RU: 'ответы попадут в DECISIONS.md' / 'из out/data.xlsx' are not something to look at",
    [user("plan it")],
    plain({
      intro:
        "Ответы попадут в docs/plan.md. Цифры взяты из out/inventory.xlsx.",
    }),
    false,
  ],
  [
    "RU: 'посмотрите на покупателя' is not something to look at",
    [user("deals?")],
    plain({
      intro: "Небольшая панель сделки, пока вы смотрите на покупателя.",
    }),
    false,
  ],
  [
    "a path under DECISIONS/ passes",
    [user("plan it")],
    plain({
      intro: "Conflict: DECISIONS/genetics.md says field crosses only.",
    }),
    false,
  ],
  [
    "'save it as x.png' and 'counts are from x.xlsx' pass",
    [user("hi")],
    plain({
      intro:
        "Save the picture as shots/brawl-2.png. Counts are from out/inventory.xlsx.",
    }),
    false,
  ],
  [
    "a draft held in the form's own editText passes",
    [user("hi")],
    plain({
      title: "Quick Start: proposed new version",
      fields: [
        {
          type: "editText",
          id: "d",
          label: "My draft (edit in place)",
          initialText: "...",
        },
      ],
    }),
    false,
  ],
  [
    "'check the new page' with no link goes out with a note",
    [user("make it"), text("Done.")],
    plain({ intro: "Check the new landing page before I push." }),
    "note",
  ],
  [
    "'Does this plan look right?' about a plan in the chat passes",
    [user("plan it"), text("Plan: 1. a 2. b")],
    plain({ title: "Does this plan look right?" }),
    false,
  ],
  [
    "'Open C:/Projects/x/wood.html' with no link goes out with a note",
    [user("make it"), text("Done.")],
    plain({ intro: "Open C:/Projects/x/wood.html and tell me." }),
    "note",
  ],
  [
    "a backslash path in the form with no link goes out with a note",
    [user("make it"), text("Done.")],
    plain({ intro: "Open C:\\Projects\\x\\wood.html and tell me." }),
    "note",
  ],
  [
    "a ~/ path in the form with no link goes out with a note",
    [user("make it"), text("Done.")],
    plain({ intro: "Report: ~/.claude/report.md" }),
    "note",
  ],
  [
    "a URL in an option's reason is not the link",
    [user("make it"), text("Done.")],
    plain({
      intro: "Check the new landing page first.",
      fields: [
        single({
          allowOther: true,
          label: "Tabs?",
          options: [
            rec({
              description:
                "https://component.gallery shows tabs; Y is better with few items.",
            }),
            { id: "y", label: "Y" },
          ],
        }),
        ELSE,
      ],
    }),
    "note",
  ],
  [
    "a file path with only a web link in the reply goes out with a note",
    [user("plan it"), text("Based on https://example.com/docs")],
    plain({ intro: "Full draft: docs/boss-materials.md." }),
    "note",
  ],
  [
    "a file path with its /C:/ link in the reply passes",
    [
      user("plan it"),
      text("Draft: [boss-materials.md](/C:/Projects/x/docs/boss-materials.md)"),
    ],
    plain({ intro: "Full draft: docs/boss-materials.md." }),
    false,
  ],
  [
    "'save it as `shot.png`' passes",
    [user("hi")],
    plain({ intro: "Save it as `shot.png`?" }),
    false,
  ],
  [
    "'Go to docs/report.html' with no link goes out with a note",
    [user("make it"), text("Done.")],
    plain({ intro: "Go to docs/report.html and tell me." }),
    "note",
  ],
  [
    "a decision form naming a shop's page passes",
    [user("price?")],
    plain({ intro: "Bloomingdale's page is gone for 48 items." }),
    false,
  ],
  [
    "a file named only in an option's reason passes",
    [
      user("hi"),
      call("Read", { file_path: "docs/engines.md" }),
      result(),
      user("which engine?"),
    ],
    plain({
      fields: [
        single({
          allowOther: true,
          label: "Which engine?",
          options: [
            rec({
              description:
                "docs/engines.md picks it; Y is better if speed matters.",
            }),
            { id: "y", label: "Y" },
          ],
        }),
        ELSE,
      ],
    }),
    false,
  ],
];
// A missing link goes out as is with a note (an added link would never reach the screen)
for (const [name, entries, input, deny] of linkCases) {
  const out = withTurn(entries, input);
  const ok = check(out, deny);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// a file outside the session's project is presented by its path in code; inside it needs a link
const PROJ = "C:\\Projects\\my project";
const at = (extra) => ({ ...plain(extra), cwd: PROJ });
const OUT_SKILL = "~/.claude/skills/x/SKILL.md";
// a real folder holding report.md, so a bare "report.md" is found there
const BARE = join(dir, "bare proj");
mkdirSync(BARE, { recursive: true });
writeFileSync(join(BARE, "report.md"), "x");
const outsideCases = [
  [
    "outside file, path in code in the reply text, passes",
    [user("do it"), text(`Wrote \`${OUT_SKILL}\`. I'd keep it.`)],
    at({ intro: `Report: ${OUT_SKILL}.` }),
    false,
  ],
  [
    "outside file, path in code in the form's intro, passes",
    [user("do it"), text("Done.")],
    at({ intro: "Report: `C:/Users/you/audits/report.md`." }),
    false,
  ],
  [
    "outside file, nothing presented goes out with a note",
    [user("do it"), text("Done.")],
    at({ intro: `Report: ${OUT_SKILL}.` }),
    "note",
  ],
  [
    "outside file with only a markdown link (does not open) goes out with a note",
    [
      user("do it"),
      text("See [SKILL.md](/C:/Users/you/.claude/skills/x/SKILL.md)."),
    ],
    at({ intro: "Report: C:/Users/you/.claude/skills/x/SKILL.md." }),
    "note",
  ],
  [
    "outside file, a code span of another file does not count",
    [user("do it"), text("Wrote `~/.claude/skills/y/OTHER.md`.")],
    at({ intro: `Report: ${OUT_SKILL}.` }),
    "note",
  ],
  [
    "inside file with only a path in code goes out with a note (needs a link)",
    [user("do it"), text("Wrote `docs/plan.md`.")],
    at({ intro: "Draft: docs/plan.md." }),
    "note",
  ],
  [
    "inside file with a /C: link passes",
    [
      user("do it"),
      text("Draft: [plan.md](/C:/Projects/my%20project/docs/plan.md)."),
    ],
    at({ intro: "Draft: docs/plan.md." }),
    false,
  ],
  [
    "a bare file name that is in the cwd counts as inside: a note, no link added",
    [user("do it"), text("Done.")],
    { ...plain({ intro: "Draft: report.md." }), cwd: BARE },
    "note",
  ],
  [
    "a bare file name that is not in the cwd gets no made-up link, only a note",
    [user("do it"), text("Done.")],
    at({ intro: "Ship DESIGN.md?" }),
    "note",
  ],
  [
    "no cwd: the old link rule applies to an absolute path",
    [user("do it"), text("Done.")],
    plain({ intro: `Report: ${OUT_SKILL}.` }),
    "note",
  ],
];
for (const [name, entries, input, deny] of outsideCases) {
  const out = withTurn(entries, input);
  const ok = check(out, deny);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// CLAUDE_PROJECT_DIR is the open project even when the hook's cwd moved (Bash cd) into another project
{
  const realProj = join(dir, "realproj"),
    other = join(dir, "otherproj");
  for (const p of [realProj, other]) {
    mkdirSync(p, { recursive: true });
    writeFileSync(join(p, "CLAUDE.md"), "x");
  }
  const f = join(realProj, "plan.md").replace(/\\/g, "/");
  const entries = [user("do it"), text(`Wrote \`${f}\`.`)];
  const input = { ...plain({ intro: `Report: ${f}.` }), cwd: other };
  const noEnv = withTurn(entries, input) === "";
  const file = join(dir, "envcase.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  const withEnv = run(
    { ...input, transcript_path: file },
    { CLAUDE_PROJECT_DIR: realProj },
  );
  const okEnv = check(withEnv, "note") && withEnv.includes("clickable link"); // inside the project: asks for a link, not a path in code
  const badEnv =
    run(
      { ...input, transcript_path: file },
      { CLAUDE_PROJECT_DIR: join(dir, "nope") },
    ) === "";
  for (const [name, ok] of [
    [
      "without CLAUDE_PROJECT_DIR the cwd's project decides: file in another project counts as outside, path in code passes",
      noEnv,
    ],
    [
      "CLAUDE_PROJECT_DIR wins over a moved cwd: the file is inside the project and needs a link",
      okEnv,
    ],
    [
      "CLAUDE_PROJECT_DIR that does not exist falls back to the cwd walk",
      badEnv,
    ],
  ]) {
    if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
}
// a prompt sent by the phone bot may use Nimbalyst's AskUserQuestion: the phone can answer nothing else
const ASK_NIM = {
  tool_name: "mcp__nimbalyst__AskUserQuestion",
  tool_input: {
    questions: [
      {
        header: "h",
        question: "Which?",
        options: [
          { label: "A", description: "a" },
          { label: "B", description: "b" },
        ],
      },
    ],
  },
};
const PHONE_PROMPT =
  "fix the header (Sent from the phone. If you need to ask something, use AskUserQuestion with plain options rather than a form: only that can be answered from the phone.)";
for (const [name, entries, deny] of [
  [
    "AskUserQuestion in a turn sent from the phone passes",
    [user(PHONE_PROMPT), text("Two ways to do it.")],
    false,
  ],
  [
    "a background task's notice in a phone turn keeps it a phone turn",
    [
      user(PHONE_PROMPT),
      text("Started."),
      user(
        "<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>",
      ),
      text("Two ways to do it."),
    ],
    false,
  ],
  [
    "AskUserQuestion after a phone turn, in a typed turn, passes too",
    [user(PHONE_PROMPT), text("Done."), user("now ask me")],
    false,
  ],
]) {
  const out = withTurn(entries, ASK_NIM);
  const ok = deny ? out.includes('"deny"') : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// a singleSelect needs 2 options
const lone = run(
  P([single({ allowOther: true, options: [{ id: "x", label: "X" }] })]),
);
const oneOk = check(lone, "note") && lone.includes("fewer than 2 options");
if (!oneOk) fail++;
console.log(
  `${oneOk ? "PASS" : "FAIL"} a one-option singleSelect goes out as is, with a note`,
);
// No second-look agent before a card any more (user, 2026-11-12): an Agent call is an ordinary tool call, and a card with
// no recommended option and no fault goes out with no note
const someAgent = withTurn(
  [
    user("make it"),
    text(LINKED),
    call("Agent", { subagent_type: "worker", prompt: "x" }),
    result(),
  ],
  look(),
);
const agentOk =
  check(someAgent, "note") && reason(someAgent).includes("clickable link");
if (!agentOk) fail++;
console.log(
  `${agentOk ? "PASS" : "FAIL"} an Agent call after the link takes it out of view, like any other tool call`,
);
const cardOk =
  withTurn([user("which?")], { ...ASK_NIM, tool_name: "AskUserQuestion" }) ===
    "" && withTurn([user("which?")], P([single({ allowOther: true })])) === "";
if (!cardOk) fail++;
console.log(
  `${cardOk ? "PASS" : "FAIL"} a plain card and a plain form with a session record go out with no note`,
);
const sent = (id, name, input = {}) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
  },
});
const back = (id, content = "ok", error = false) => ({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: id,
        content,
        ...(error ? { is_error: true } : {}),
      },
    ],
  },
});
const FORM_TOOL = "mcp__nimbalyst__PromptForUserInput";
// Plain words: a card showing a plan-row id the user didn't use is refused, so it is resent in plain words (user,
// 2026-11-13; these six cases got a note until then); no cap on questions per card (user, 2026-11-12)
const ask = (
  question,
  options = [
    { label: "A", description: "a" },
    { label: "B", description: "b" },
  ],
) => ({
  tool_name: "mcp__nimbalyst__AskUserQuestion",
  tool_input: { questions: [{ header: "h", question, options }] },
});
// Every card refusal starts with this fixed marker; the card-refused patch hides a card whose result contains it
const MARK = "[card-refused]";
const denied = (out) => hso(out)?.permissionDecisionReason || "";
const refusedFor = (want) => (out) =>
  hso(out)?.permissionDecision === "deny" &&
  denied(out).startsWith(MARK) &&
  denied(out).includes("labels the user never used") &&
  want.every((w) => denied(out).includes(w));
for (const [name, out, ok] of [
  [
    "a form question holding a range of plan-row ids is refused, the labels named",
    card(
      P([
        single({ allowOther: true, label: "Move WT2-WT4 to next week?" }),
        ELSE,
      ]),
    ),
    refusedFor(["WT2-WT4"]),
  ],
  [
    "a card question holding a plan-row id is refused, the labels named",
    card(ask("Fix it in S7?")),
    refusedFor(["S7"]),
  ],
  [
    "an option label holding a plan-row id is refused, the labels named",
    card(
      P([
        single({
          allowOther: true,
          options: [
            rec({ label: "Leave it for B6 (recommended)", description: WHY }),
            { id: "y", label: "Fix now" },
          ],
        }),
      ]),
    ),
    refusedFor(["B6"]),
  ],
  [
    "MP3, H264 and a version like 26.1 are no plan-row ids",
    card(
      ask("Save the video as H264 with MP3 sound for 26.1?", [
        { label: "A4 page", description: "a" },
        { label: "Q3 report", description: "b" },
      ]),
    ),
    (o) => o === "",
  ],
  [
    "an id the user used in their last message needs no explaining",
    withTurn([user("is S7 done?")], ask("Close S7 now?")),
    (o) => o === "",
  ],
  [
    "a card's recommended option whose reason names only DECISIONS.md gets no note (no label notes any more)",
    card(
      ask("Which?", [
        { label: "A (recommended)", description: "DECISIONS.md says so." },
        { label: "B", description: "b" },
      ]),
    ),
    (o) => o === "",
  ],
  [
    "a tick-box item titled with a hyphened id (C-2) is refused, the labels named",
    card(
      P([
        {
          type: "multiSelect",
          id: "m",
          label: "Hook messages",
          items: [
            {
              id: "c2",
              title: "C-2: shorten the long 'build finished' message",
              subtitle: "One action, two outcomes.",
            },
          ],
        },
        ELSE,
      ]),
    ),
    refusedFor(["C-2"]),
  ],
  [
    "an id only in the line under a tick box is refused, the labels named",
    card(
      P([
        {
          type: "multiSelect",
          id: "m",
          label: "m",
          items: [
            {
              id: "a",
              title: "Shorten the waiting message",
              subtitle: "Same as B13.",
            },
          ],
        },
        ELSE,
      ]),
    ),
    refusedFor(["B13"]),
  ],
  [
    "an id only in a card option's reason is refused, the labels named",
    card(
      ask("Which?", [
        { label: "A", description: "Like WT3." },
        { label: "B", description: "b" },
      ]),
    ),
    refusedFor(["WT3"]),
  ],
  [
    "UTF-8, SHA-256, AES-128 and GPT-5 are no plan-row ids",
    card(ask("Save it as UTF-8 with a SHA-256 sum, AES-128 or GPT-5?")),
    (o) => o === "",
  ],
  [
    "five questions on one form get no cap note",
    card(
      P(
        ["a", "b", "c", "d", "e"].map((id) =>
          single({ id, allowOther: true, label: `Question ${id}?` }),
        ),
      ),
    ),
    (o) => o === "",
  ],
]) {
  const passed = ok(out);
  if (!passed) fail++;
  console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
}
// Labels the user never used, single-letter names and status or nag cards are refused (user, 2026-11-13); at most 2
// refusals in a row, then the card goes through with a note and a log line
{
  const { MARKER } = await import(pathToFileURL(HOOK).href);
  const NAG = (out) =>
    hso(out)?.permissionDecision === "deny" &&
    denied(out).startsWith(MARK) &&
    denied(out).includes("it asks no decision") &&
    denied(out).includes("Do not send it again");
  const passes = (out) => out === "";
  const HANDOFF_PROMPT =
    "Read C:\\Users\\you\\.claude\\handoffs\\my-project-20260101-1200-abc.md and continue the work from the next row, S7.";
  const ASK_TOOL = "mcp__nimbalyst__AskUserQuestion";
  // The summary Claude Code writes when it compacts a session: a user entry, but not the user's words
  const summary = (s) => ({
    type: "user",
    isCompactSummary: true,
    message: {
      role: "user",
      content: `This session is being continued from a previous conversation that ran out of context. ${s}`,
    },
  });
  const REFUSED_RESULT = `PreToolUse:${ASK_TOOL} hook error: ${MARK} question-other refused this card: it shows labels the user never used (S7).`;
  // n refused cards (and an answered one when `answered`) since the user's last message
  const tries = (n, answered = false) => [
    user("fix the thing"),
    ...Array.from({ length: n }, (_, i) => [
      sent(`r${i}`, ASK_TOOL),
      back(`r${i}`, REFUSED_RESULT, true),
    ]).flat(),
    ...(answered ? [sent("ok", ASK_TOOL), back("ok", '{"answers":{}}')] : []),
  ];
  const home = mkdtempSync(join(dir, "home-"));
  const homeEnv = { HOME: home, USERPROFILE: home };
  const thirdFile = join(dir, "third.jsonl");
  writeFileSync(
    thirdFile,
    tries(2)
      .map((e) => JSON.stringify(e))
      .join("\n"),
  );
  const third = run(
    { ...ask("Fix it in S7?"), transcript_path: thirdFile, session_id: "s1" },
    homeEnv,
  );
  let logged = "";
  try {
    logged = readFileSync(
      join(
        home,
        ".claude",
        "hooks",
        "state",
        "question-other",
        "let-through.log",
      ),
      "utf8",
    );
  } catch {}
  for (const [name, out, ok] of [
    ["the marker is exactly [card-refused]", MARKER, (m) => m === MARK],
    [
      "a label only the handoff prompt named is not the user's, so it is refused",
      withTurn([user(HANDOFF_PROMPT)], ask("Close S7 now?")),
      refusedFor(["S7"]),
    ],
    [
      "a single-letter name (helper K) is refused, the name given",
      card(ask("Should the report from helper K go into the summary?")),
      refusedFor(["helper K"]),
    ],
    [
      "a letter that is an option's own label on the card passes (agent B, option B)",
      card(
        ask("Which draft should agent B start from?", [
          { label: "A: the short one", description: "a" },
          { label: "B", description: "b" },
        ]),
      ),
      passes,
    ],
    [
      "a letter the user typed passes (tab Q)",
      withTurn([user("what did tab Q show?")], ask("Should tab Q stay open?")),
      passes,
    ],
    [
      "versions, units, file names, common names, option letters, OK and AI pass",
      card(
        ask(
          "Print A4.pdf at 18 dB for 5 min on version 2.9.16 ($26, 2h50) with an M2, GPT-5 and UTF-8? Is that OK with the AI part?",
          [
            { label: "A", description: "v6 as before" },
            { label: "B", description: "1 as before, 2 a bit less hiss" },
          ],
        ),
      ),
      passes,
    ],
    [
      "a plural of a common name (MP3s) passes",
      card(ask("Pack the 500 MP3s into one zip?")),
      passes,
    ],
    [
      "a form numbering its own questions (Q8. …) passes, also where it refers back to them",
      card({
        tool_name: FORM_TOOL,
        tool_input: {
          intro: "Q8 decides the rest.",
          fields: [
            single({ allowOther: true, label: "Q8. How many releases?" }),
          ],
        },
      }),
      passes,
    ],
    [
      "a status question (are you still sorting them) is refused as asking no decision",
      card(
        ask(
          "The photo folder still shows 5 of 40 photos sorted. Are you still sorting them?",
        ),
      ),
      NAG,
    ],
    [
      "a judgement after 'still' passes (are you still happy with it)",
      card(ask("Are you still happy with the garden layout?")),
      passes,
    ],
    [
      "asking for a go-ahead passes (are you ready for me to …)",
      card(ask("Are you ready for me to post the newsletter?")),
      passes,
    ],
    [
      "a 'have you … yet' question is refused as asking no decision",
      card(ask("Have you had a chance to read the draft yet?")),
      NAG,
    ],
    [
      "a form whose title asks 'will you … now' is refused the same way",
      card({
        ...P([single({ allowOther: true, label: "Which sheet?" })]),
        tool_input: {
          title: "Will you fill in the sheet now?",
          fields: [single({ allowOther: true, label: "Which sheet?" })],
        },
      }),
      NAG,
    ],
    [
      "Claude's own action with 'now' passes (should I, run it, can I)",
      card(
        ask("Should I run the build script now?", [
          { label: "Run it now", description: "a" },
          { label: "Wait", description: "b" },
        ]),
      ) +
        card(ask("Bake the 3 sample cakes now, about $15?")) +
        card(ask("Can I open one more browser window to compare the prices?")),
      passes,
    ],
    [
      "real judgement questions pass (meant, sounds, happy, out of the game now)",
      card(ask("Is this the recipe you meant: the one with the lemon glaze?")) +
        card(ask("Does the slower voice sound warmer and less flat?")) +
        card(ask("Are you happy with the new layout?")) +
        card(
          ask(
            "Are you out of the castle level in your game right now? (Saving it fails while you are inside.)",
          ),
        ),
      passes,
    ],
    [
      "a card with both faults gets the nag text alone",
      card(ask("Will you sign the form now, so S7 can start?")),
      (o) => NAG(o) && !denied(o).includes("S7"),
    ],
    [
      "a compaction summary is not the user's words: a label only it names is refused",
      withTurn(
        [user("fix the thing"), summary("The next step is S7.")],
        ask("Fix it in S7?"),
      ),
      refusedFor(["S7"]),
    ],
    [
      "a compaction summary does not end the run of refusals",
      withTurn(
        [...tries(2), summary("Two cards were refused.")],
        ask("Fix it in S7?"),
        homeEnv,
      ),
      (o) =>
        check(o, "note") &&
        !o.includes(MARK) &&
        reason(o).includes("2 refusals in a row"),
    ],
    [
      "an answered card whose answer quotes the marker is no refusal, so it ends the run",
      withTurn(
        [
          ...tries(2),
          sent("q", ASK_TOOL),
          back("q", `{"answers":{"a":"what does ${MARK} mean?"}}`),
        ],
        ask("Fix it in S7?"),
      ),
      refusedFor(["S7"]),
    ],
    [
      "with no session record a faulty card goes through with a note, no marker",
      [
        run(ask("Fix it in S7?")),
        run({
          ...ask("Fix it in S7?"),
          transcript_path: join(dir, "gone.jsonl"),
        }),
      ],
      (outs) =>
        outs.every(
          (o) =>
            check(o, "note") &&
            !o.includes(MARK) &&
            reason(o).includes("no session record") &&
            reason(o).includes("S7"),
        ),
    ],
    [
      "a lowercase letter after a noun is no single-letter name (tab n)",
      card(ask("Should I close the tab n of the old prices?")),
      passes,
    ],
    [
      "a capitalised noun still finds a single-letter name (Helper K)",
      card(ask("Helper K finished; merge its report?")),
      refusedFor(["Helper K"]),
    ],
    [
      "after one refusal the next faulty card is still refused",
      withTurn(tries(1), ask("Fix it in S7?")),
      refusedFor(["S7"]),
    ],
    [
      "the third faulty card in a row goes through with a note and no marker",
      third,
      (o) =>
        check(o, "note") &&
        !o.includes(MARK) &&
        reason(o).includes("2 refusals in a row") &&
        reason(o).includes("S7"),
    ],
    [
      "the third faulty card is logged",
      logged,
      (l) =>
        /s1 mcp__nimbalyst__AskUserQuestion: let through after 2 refusals; labels: S7/.test(
          l,
        ),
    ],
    [
      "a card that went through ends the run of refusals",
      withTurn(tries(2, true), ask("Fix it in S7?")),
      refusedFor(["S7"]),
    ],
    [
      "a new typed message ends the run of refusals",
      withTurn([...tries(2), user("try again")], ask("Fix it in S7?")),
      refusedFor(["S7"]),
    ],
  ]) {
    const passed = ok(out);
    if (!passed) fail++;
    console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  }
}
// A project's own list of labels the user knows (.claude/card-labels.txt) lets them through (user, 2026-11-13)
{
  const project = (list) => {
    const p = mkdtempSync(join(dir, "proj-"));
    writeFileSync(join(p, "CLAUDE.md"), "");
    if (list !== null) {
      mkdirSync(join(p, ".claude"));
      writeFileSync(join(p, ".claude", "card-labels.txt"), list);
    }
    return p;
  };
  const good = project(
    "# made-up labels the users of this project know\r\nT3\n\n/K[1-5]/\n/W-\\d+/\nL\nZ9   # the jump key\n/WT\\d/ # weekly tasks\n",
  );
  const bad = project("/[unclosed/\nT3\n");
  const none = project(null);
  const inside = join(good, "src");
  mkdirSync(inside);
  const at = (cwd, input) => card({ ...input, cwd });
  const MARK = "[card-refused]";
  const denied = (o) => {
    try {
      return JSON.parse(o).hookSpecificOutput?.permissionDecisionReason || "";
    } catch {
      return "";
    }
  };
  for (const [name, out, ok] of [
    [
      "a label listed exactly (T3) passes",
      at(good, ask("Raise the drop rate at T3?")),
      (o) => o === "",
    ],
    [
      "labels of a listed family (/K[1-5]/, /W-\\d+/) pass",
      at(good, ask("Move K4 next to W-120?")),
      (o) => o === "",
    ],
    [
      "a listed letter lets its single-letter name through (worker L)",
      at(good, ask("Should the report from worker L go into the summary?")),
      (o) => o === "",
    ],
    [
      "a label with a trailing # comment is listed (Z9, /WT\\d/)",
      at(good, ask("Press Z9 to skip WT3?")),
      (o) => o === "",
    ],
    [
      "a range passes when each part is listed (WT2-WT4 with /WT\\d/)",
      at(good, ask("Move WT2-WT4 to next week?")),
      (o) => o === "",
    ],
    [
      "a range with an unlisted part is refused (WT2-S7)",
      at(good, ask("Move WT2-S7 to next week?")),
      (o) => denied(o).startsWith(MARK) && denied(o).includes("WT2-S7"),
    ],
    [
      "an exact line matches only that label (T3 does not cover T30)",
      at(good, ask("Move T30 up?")),
      (o) => denied(o).startsWith(MARK) && denied(o).includes("T30"),
    ],
    [
      "an unlisted label on the same card is still refused, the listed one not named",
      at(good, ask("Raise T3 and fix S7?")),
      (o) => denied(o).includes("(S7)"),
    ],
    [
      "the list is found from a folder inside the project",
      at(inside, ask("Raise the drop rate at T3?")),
      (o) => o === "",
    ],
    [
      "CLAUDE_PROJECT_DIR names the project when set",
      card(ask("Raise the drop rate at T3?"), { CLAUDE_PROJECT_DIR: good }),
      (o) => o === "",
    ],
    [
      "a project with no list is fine; its labels are refused as before",
      at(none, ask("Raise the drop rate at T3?")),
      (o) => denied(o).startsWith(MARK) && denied(o).includes("T3"),
    ],
    [
      "a bad regex line is named in the note and skipped; the rest of the list works",
      at(bad, ask("Raise the drop rate at T3?")),
      (o) =>
        !denied(o) &&
        o.includes('line 1 \\"/[unclosed/\\"') &&
        o.includes("card-labels.txt"),
    ],
    [
      "a bad regex line is named in a refusal too",
      at(bad, ask("Fix it in S7?")),
      (o) =>
        denied(o).startsWith(MARK) &&
        denied(o).includes('line 1 "/[unclosed/"'),
    ],
  ]) {
    const passed = ok(out);
    if (!passed) fail++;
    console.log(`${passed ? "PASS" : "FAIL"} ${name}`);
  }
}
// A /C:/ link must be read with its drive, or a file inside the project counts as outside and the form
// is refused with the link right there (in the form, or in the reply before it)
{
  const { pointer, outsideProject } = await import(pathToFileURL(HOOK).href);
  const CS = "C:\\Projects\\my-project";
  const GRILL =
    "[next-steps.md](/C:/Projects/my-project/docs/plan/next-steps.md)";
  const pt = pointer({ intro: `Plan: ${GRILL}.` }, []);
  const readOk =
    pt?.text === "/C:/Projects/my-project/docs/plan/next-steps.md" &&
    !outsideProject(pt.text, CS);
  const formOk =
    withTurn([user("grill me"), text("Round two.")], {
      ...plain({ intro: `From ${GRILL}. Questions 1 and 4 are yours.` }),
      cwd: CS,
    }) === "";
  const replyOk =
    withTurn(
      [
        user("grill me"),
        text(`From ${GRILL}.`),
        sent("g1", FORM_TOOL),
        back("g1", "refused", true),
      ],
      {
        ...plain({
          intro: "Answer from /C:/Projects/my-project/docs/plan/next-steps.md.",
        }),
        cwd: CS,
      },
    ) === "";
  const bare = withTurn([user("grill me"), text("Round two.")], {
    ...plain({
      intro:
        "Plan in docs/plan/next-steps.md (/C:/Projects/my-project/docs/plan/next-steps.md).",
    }),
    cwd: CS,
  });
  const bareOk = check(bare, "note") && !bare.includes("File:");
  for (const [name, ok] of [
    [
      "a /C:/ link in the form is read with its drive (inside the project)",
      readOk,
    ],
    ["a form holding its own /C:/ link to a project file passes", formOk],
    [
      "a /C:/ link in the reply, after a refused try of the form, still presents the file",
      replyOk,
    ],
    ["a bare path with no link goes out with a note, nothing added", bareOk],
  ]) {
    if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
}
const missing =
  run({ ...form(WHY), transcript_path: join(dir, "missing.jsonl") }) === "";
if (!missing) fail++;
console.log(`${missing ? "PASS" : "FAIL"} a missing session record fails open`);
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : `all ${total} passed`);
process.exit(fail ? 1 : 0);
