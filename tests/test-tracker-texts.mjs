// Tests for the tracker writing rules (skills/where-are-we/tracker-texts.md) and their checker (text-check.mjs):
// every place in the skills and the job-done hook that tells a session to write a tracker title, body or comment names
// the rules file; every place that tells a session to make a step carries the rule on when a step may be made; the
// checker flags each kind of mark and each "before" text, and passes each "after" text. The before and after texts
// below are made-up look-alikes of real ones: they hold the same kinds of marks, with no real item in them.
// Run: node tests/test-tracker-texts.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "..");
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
const RULES = path.join(REPO, "skills", "where-are-we", "tracker-texts.md");
const CHECK = path.join(REPO, "skills", "where-are-we", "text-check.mjs");
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`,
  );
};

// The text of a paragraph or list item that starts with a marker, up to the next blank line or numbered step
const partOf = (text, marker) => {
  const at = text.indexOf(marker);
  if (at < 0) return "";
  const rest = text.slice(at + marker.length);
  const end = rest.search(/\n\s*\n|\n\d\. \*\*/);
  return marker + (end < 0 ? rest : rest.slice(0, end));
};
const lineOf = (text, marker) => {
  const at = text.indexOf(marker);
  if (at < 0) return "";
  const end = text.indexOf("\n", at);
  return text.slice(at, end < 0 ? text.length : end);
};
// A one-string constant of the job-done hook, read from its source: the quoted text after "const NAME =", with its
// escaped quotes and backslashes unescaped (the formatter picks the outer quote, so either kind may be escaped)
const hookConst = (src, name) =>
  (
    src.match(
      new RegExp(`const ${name} =\\s*(["'])([\\s\\S]*?)\\1;\\n`),
    )?.[2] ?? ""
  ).replace(/\\(["'\\])/g, "$1");

const where = read("skills", "where-are-we", "SKILL.md");
const lead = read("skills", "lead", "SKILL.md");
const handoff = read("skills", "handoff", "SKILL.md");
const hook = read("hooks", "job-done.mjs");
const handoffPrompt =
  handoff.match(/tracker step[^\n]*?names its key and adds: `([^`]+)`/)?.[1] ??
  "";
const linkText = hookConst(hook, "LINK_TEXT");
const pieceText = hookConst(hook, "PIECE_TEXT");

// 1. The rules file holds each part
check("the rules file exists", fs.existsSync(RULES));
const rules = fs.existsSync(RULES) ? fs.readFileSync(RULES, "utf8") : "";
for (const [name, re] of [
  ["a title's form", /\| \*\*Title\*\* \|[^\n]*70 characters/],
  ["a description's form", /\| \*\*Description of a step\*\* \|/],
  ["a comment's form", /\| \*\*Comment\*\* \|[^\n]*"Not checked yet:"/],
  ["the job's goal line", /\| \*\*The job's goal line\*\*/],
  [
    "the file a step asks the user to read as the `file` field",
    /\| A file the row asks the user to read, review or check \| the `file` field \|/,
  ],
  ["a stage name's form", /\| \*\*Stage name\*\* \|[^\n]*<phase>/],
  ["how a plan row becomes a step", /## From a plan row to a step/],
  ["when a new step may be made", /## When a new step may be made/],
  ["the marks a script can find", /## Marks a script can find/],
  ["the fields that keep their shape", /## Fields that keep their shape/],
  ["how to run the checker", /text-check\.mjs/],
])
  check(`the rules file holds ${name}`, re.test(rules));
const cases =
  rules.split(/\n(?=## )/).find((s) => s.startsWith("## When a new step")) ??
  "";
check(
  "the rules give exactly three cases for a new step, and work found mid-run is not one",
  (cases.match(/^\d\. /gm) || []).length === 3 &&
    /Work found mid-run is not a new step/.test(cases) &&
    /"Found: …"/.test(cases),
);

// 2. Every place that tells a session to write a tracker title, body or comment names the rules file
const NAMES = /tracker-texts\.md/;
const WRITES = [
  ["where-are-we: the words of every text", partOf(where, "**Words.**")],
  [
    "where-are-we: copying plan rows in (title, body, stage)",
    partOf(where, "2. **Copy new plan rows in.**"),
  ],
  [
    "where-are-we: the comment on a finished step",
    partOf(where, "4. **Settle what facts prove.**"),
  ],
  [
    "where-are-we: the not-plain list of the ready gate",
    partOf(where, "6. **Ready gate.**"),
  ],
  ["where-are-we: the groomed comment", partOf(where, "8. **The reading.**")],
  [
    "lead: the tracker as the job's record (job, steps, comments)",
    lineOf(lead, "5. **The tracker is the job's record:**"),
  ],
  ["handoff: the prompt for a tracker step", handoffPrompt],
  ["job-done: the note to create a missing step", linkText],
  ["job-done: the note at a committed piece", pieceText],
];
for (const [name, text] of WRITES)
  check(
    `${name} names the rules file`,
    text !== "" && NAMES.test(text),
    text ? "" : "the place was not found",
  );
check(
  "lead: a committed piece gets one plain comment, not the old handoff comment",
  /\*\*A piece committed:\*\*[^\n]*one plain comment/.test(lead) &&
    !/one handoff comment/.test(lead),
);
check(
  "job-done: the piece note asks for plain sentences with no ids, hashes, row codes or paths",
  /one comment of one to three plain sentences/.test(pieceText) &&
    /no ids, hashes, row codes or paths/.test(pieceText),
);
check(
  "job-done: a created step's title is the row's job in plain words",
  /title the row's job in plain words with no codes/.test(linkText),
);
check(
  "handoff: the step's comments are plain, the commit and session go in the proof field, not a Proof: line",
  /Comments on the step are plain sentences/.test(handoffPrompt) &&
    /the commit and session go in the step's proof field/.test(handoffPrompt) &&
    /never as a "Proof:" line in the comment/.test(handoffPrompt),
);
check(
  "where-are-we: the groomed comment keeps its prefix (step 3 reads it) and adds plain sentences",
  /`where-are-we: groomed <date and time>` to the job, followed by at most three plain sentences/.test(
    where,
  ),
);

// 2b. Jobs, not only releases: any work over several sessions is found or made as a job named after the work; the
// file a step asks the user to read travels in `file`, and the task-type patch adds that field
const newProject = read("skills", "new-project", "SKILL.md");
const updateProject = read("skills", "update-project", "SKILL.md");
check(
  "lead step 5: work over several sessions is a job named after it, taken if open, else made",
  /a job is work over several sessions \(not a one-session fix\), one `release` item named after it/.test(
    lineOf(lead, "5. **The tracker is the job's record:**"),
  ) &&
    /Take the open job the work belongs to \(the one the user named, or the one it ships in\), else create one/.test(
      lead,
    ),
);
check(
  "lead, handoff and the job-done note say job where they meant the tracker's release",
  !/the release's "Needs you"|the release's description|At the end of a release/.test(
    lead,
  ) &&
    /the job with its open steps/.test(handoff) &&
    /a job's step, with or without a plan row/.test(handoff) &&
    /`collection` the open job/.test(linkText) &&
    !/the release in progress/i.test(hook),
);
check(
  "the task-type patch adds the `file` field, and update-project offers it",
  /`budget` \(number\), `file` \(text: the path of the file a step asks the user to read, review or check\)/.test(
    newProject,
  ) && /lacks the step fields \(`file` among them\)/.test(updateProject),
);
check(
  "update-project offers the patch also before a project's first job, as lead step 5 sends it there",
  /A project with plan files \(`docs\/\*-plan\.md`\), or one `lead` is about to make its first job in, whose tracker/.test(
    updateProject,
  ),
);
check(
  "a job is named after the work itself, with no kind word, and lead's titles pointer reaches that rule",
  /\| \*\*Job name\*\*[^\n]*The work itself, as the user calls it: a version number, a working name, a title\.[^\n]*\| a kind word added to the name, such as "release", "project" or "video" \|/.test(
    rules,
  ) &&
    /titles, bodies and comments follow `where-are-we\/tracker-texts\.md`/.test(
      lead,
    ),
);
check(
  "lead says how many reviewers is counted by parts, not by the job's size",
  /Reviewers \(by parts, not size\): 1; 2 when the change has \*\*separate parts\*\*/.test(
    lead,
  ),
);
check(
  "a user step's title is the exact ask, never a step code, and a helper's review is never worded as an ask",
  /\| \*\*Title\*\* \|[^\n]*A user step's title is the exact ask in plain words[^\n]*never a step code\. A helper's step, a review the pipeline runs included, is never worded as an ask: it does not wait for the user\./.test(
    rules,
  ),
);
check(
  "the rules keep `file` among the fields the extension reads",
  /`step`, `stage`, `waitsOn`, `budget`, `file` and the job description's first line keep their shape/.test(
    rules,
  ),
);

// 3. Every place that tells a session to make a step carries the rule: only an OK'd plan's rows, a row the user OK'd
// as an addition, or the user's OK the plan names; work found mid-run is one "Found:" sentence, not a step
const MAKES = [
  [
    "lead: steps come from the plan rows after the user's OK",
    lineOf(lead, "5. **The tracker is the job's record:**"),
    [/after the user's OK one `task` item \(a \*\*step\*\*\) per plan row/],
  ],
  [
    "lead: new work found mid-run",
    lineOf(lead, "New work found →"),
    [/"Found:"/, /step's comment/, /row and step only on the user's OK/],
  ],
  [
    "where-are-we: copying plan rows in",
    partOf(where, "2. **Copy new plan rows in.**"),
    [
      /No other step is made/,
      /work found mid-run goes into the running step's comment and the plan's notes/,
      /only after the user OKs it as a plan row/,
    ],
  ],
  [
    "job-done: the note to create a missing step",
    linkText,
    [
      /and the user OK'd that row/,
      /Work found mid-run is never a new step/,
      /"Found:" sentence in the step's comment/,
      /only after the user OKs it as a plan row/,
    ],
  ],
];
for (const [name, text, needs] of MAKES) {
  const missing = needs.filter((n) => !n.test(text));
  check(
    `${name} carries the rule on new steps`,
    text !== "" && !missing.length,
    text ? `missing ${missing.join(", ")}` : "the place was not found",
  );
}

// 4. The checker
const run = (input, args = []) =>
  spawnSync(process.execPath, [CHECK, ...args], { input, encoding: "utf8" });
const MARK_CASES = [
  ["commit hash", "Fixed in 3f2a1b9 this morning."],
  ["session id", "It ran in session 1a2b3c4d."],
  ["session id", "Linked to 0f1e2d3c-4b5a-6978-8a9b-0c1d2e3f4a5b."],
  ["row code", "Row S3 is finished."],
  ["file path", "The notes are in docs/plan.md now."],
  ["file path", "See notes.txt for more."],
  ["command", "Run `npm test` first."],
  ["plan label", "**Serves:** the shop owner"],
  ["plan label", "Plan: the export plan"],
  ["plan label", "The export was fixed.\n\nProof: the new column shows."],
  ["plan label", "The export was fixed.\n\n**Proof:** the new column shows."],
  ["plan label", "The export was fixed.\n\n- Proof: the new column shows."],
  ["user prefix", "You: read the new page"],
  ["DECISIONS reference", 'The user said "go" (DECISIONS 2025-03-01).'],
];
for (const [mark, text] of MARK_CASES) {
  const r = run(text);
  check(
    `the checker flags a ${mark}: ${text}`,
    r.status === 1 && r.stdout.includes(`${mark}: `),
    `exit ${r.status}, output: ${r.stdout.trim()}`,
  );
}

// Made-up look-alikes of the design's nine real texts, each before with the same kinds of marks as its original
const PAIRS = [
  [
    "the release",
    'Everything worked on 2025-03-02/03 is 4.1 (user, 2025-03-03). Plan files: docs/2025-03-03-cleanup-plan.md (user OK 2025-03-03, all 12 rows); docs/2025-03-01-export-plan.md (user OK 2025-03-01; steps "exp <row>", copied 2025-03-03 by session 1a2b3c4d). The other 4.1 plans are copied in by the cleanup plan\'s row W4.',
    "4.1 brings recipe export, a cleaner shopping list and faster search. Two plans are in the list so far: the clean-up of the main screen and the export feature. One more plan joins the list later: the search rebuild.",
  ],
  [
    "a step that is the user's",
    "Your word: release 4.1\nPlan: docs/2025-03-01-export-plan.md, Needs the user's OK item 2 (before row R1). Question: \"Release 4.1 now?\" Done when: the user said release, after P5's green runs.",
    "Your word: send 4.1 out to users\nThis step is yours. When the other 4.1 work is finished and the checks have passed, say release and the release step starts. Nothing goes out before you say it.",
  ],
  [
    "a build step: the release",
    'Ship 4.1 through the new pull-request flow\nPlan: docs/2025-03-01-export-plan.md, row R1. Serves: "ship it the normal way" (DECISIONS 2025-03-01). Done when: `gh release view v4.1` exists; origin/main..dev shows only later work.',
    "Release 4.1 to the app store through a pull request\nSends the finished 4.1 work out as one pull request, then tags it and publishes the release notes. Done when the 4.1 release page exists and the main branch's checks are green. Waits on your word to release.",
  ],
  [
    "a build step: the nightly job",
    'Record the new flow and turn the nightly import back on\nPlan: docs/2025-03-01-export-plan.md, row R2. Done when: the dry run, made before `--on`, returned version `4.1.1`; `"off": false` in state.json.',
    "Turn the nightly recipe import back on\nAfter 4.1 is out, the nightly job that imports new recipes runs again. Done when a test run shows the next version number and the job is switched on. Waits on the release.",
  ],
  [
    "a build step: the write-up",
    "Record the work: changelog, docs, plans, handoff\n**Serves:** none (mechanics) **Done when:** `node tests/run-all.mjs` passes **Stage:** Part 7 · record **Helper:** worker **Runs:** after L4",
    "Write up the clean-up in the changelog and notes\nWrites down what the clean-up changed. Done when all tests pass apart from failures already known. Waits on the last review of the fixes.",
  ],
  [
    "an old plan item",
    "Slow search: one query took 9 seconds\nDone 2025-02-10: measured (audits/2025-02-10-slow-search.md), released as 1.0.18 (ab12cd3). Open: compare next week's numbers with the baseline in HANDOFF.md.",
    "Make search fast again after one query took 9 seconds\nFinished on 10 February and shipped in that week's update. The one check left, a week of timings against the old numbers, was replaced by the app's own timing report.",
  ],
  [
    "the groomed comment",
    "where-are-we: groomed 2025-03-03 09:30 UTC. Wave 2 (T7, T8, RW2) running in session 5e6f7a8b; RW2 has commit 3c4d5e6, State not marked done yet. 9 plan rows open, up to ~120 calls.",
    "where-are-we: groomed 2025-03-03 09:30 UTC. Checked the list against the plans. Two of your OKs were already given, so their steps are closed. Three steps are being built in one session; nine are left.",
  ],
  [
    "a progress comment",
    "Session 9a8b7c6d: plan review done (5 Important, all fixed). Done: P0 (no change needed), F1 commit 4d5e6f7 (tests 14/14). Not verified: F1 against real output. Next: H2 after the OK.",
    "The plan review is done and its five findings are fixed. The export script is rewritten and the tests that failed now pass. Not checked yet: the script against real replies. Next, after your OK: the history rewrite.",
  ],
  [
    "a finished-step comment",
    "Proof: commit 7a6b5c4, session 0d1e2f3a. Changed: squash-only, ruleset 27249123 on main. Worker 12 calls of 25.",
    "Done. The main branch is protected and pull requests merge as one commit. Each setting was read back after the change. Not checked yet: the branch rule against a real push.",
  ],
];
// The two examples the rules file shows: its before is flagged and its after passes too
const shown = [
  ...rules.matchAll(/^\*\*(.+?)\.\*\*\r?\nBefore: (.+)\r?\nAfter: (.+)$/gm),
];
check("the rules file shows two before-and-after examples", shown.length === 2);
for (const [, name, before, after] of shown)
  PAIRS.push([
    `the rules file's example: ${name.toLowerCase()}`,
    before,
    after,
  ]);
for (const [name, before, after] of PAIRS) {
  const b = run(before);
  check(
    `the checker flags the before text of ${name}`,
    b.status === 1,
    `exit ${b.status}`,
  );
  const a = run(after);
  check(
    `the checker passes the after text of ${name}`,
    a.status === 0 && a.stdout.trim() === "no marks",
    `exit ${a.status}, output: ${a.stdout.trim()}`,
  );
}
// A file as its argument works as stdin does; a file that can't be read stops it with exit 2
{
  const r = spawnSync(process.execPath, [CHECK, RULES], { encoding: "utf8" });
  check(
    "the checker reads a file given as its argument (the rules file is full of marks)",
    r.status === 1 && r.stdout.includes("command: "),
  );
  const m = run("", [path.join(REPO, "no-such-file.txt")]);
  check(
    "a file that can't be read stops the checker with exit 2",
    m.status === 2 && /cannot read/.test(m.stderr),
  );
}

// 4b. Fixes from the build review: no stray steps, the call count in Findings, names that pass, many texts at once
check(
  "lead: an unasked change a worker made is a Found: line, a row only on the user's OK",
  /one you would is a "Found:" line, a row only on the user's OK/.test(
    lineOf(lead, "**Compare every report with its brief.**"),
  ) && !/is added to the job list/.test(lead),
);
check(
  "lead: new work for a step is a row only on the user's OK",
  /a row only on the user's OK/.test(
    lineOf(lead, "**A step doesn't grow in its brief.**"),
  ),
);
check(
  "where-are-we: a row added after the plan's OK is copied only with the user's words in its Changed line",
  /`Changed <date>: <row>` line adds it\) is copied only when that line holds the user's words/.test(
    where,
  ) && /listed as "row without your OK"/.test(where),
);
check(
  "job-done: a step is made only for a row the user OK'd, otherwise none and the reply says so",
  /no step for the row yet \(the row is new\) and the user OK'd that row/.test(
    linkText,
  ) && /Otherwise make no step and say so in your reply/.test(linkText),
);
check(
  "lead: the calls a worker used go under the plan's Findings, not the State cell",
  /\(`tool_uses`\) under the plan's Findings/.test(lead) &&
    !/tool_uses`\) in the row's State cell/.test(lead),
);
check(
  "the rules put numbers in the plan's Findings, comments are one to three sentences",
  /numbers: the plan's Findings/.test(rules) &&
    /\| One to three sentences\./.test(rules),
);
check(
  "lead says Not checked yet, not Not verified, for a step's comment",
  !/Not verified/.test(lead) && /"Not checked yet"/.test(lead),
);
check(
  "the rules list the mark names, not a copy of the patterns, and say what no marks does not clear",
  !/\[0-9a-f\]/.test(rules) &&
    /does not clear what no pattern finds/.test(rules),
);
check(
  "the rules and where-are-we step 6 let a flagged real name or a needed link stay",
  /real name the checker still flags[^.]*may stay/.test(rules) &&
    /flagged real name[^.]*may stay/.test(partOf(where, "6. **Ready gate.**")),
);
check(
  "where-are-we step 6 checks all steps at once and gives the count and first three above five",
  /text-check\.mjs --json/.test(partOf(where, "6. **Ready gate.**")) &&
    /above five, give the count and the first three/.test(where),
);
for (const text of [
  "Export the clip as MP4 or MP3.",
  "Sales grew in Q3.",
  "Files sit in an S3 bucket.",
  "It runs on K8s.",
  "The CO2 sensor reads again.",
  "Saved as UTF8 text.",
  "Prints on A4 paper.",
  "The V2 screen is live.",
  "Runs on a Mac with an M1 chip.",
  "Works on PS5.",
  "Uses GPT4 for replies.",
  "I18n support is in.",
  "Built with Next.js and Node.js.",
  "The guide is at https://example.com/docs/page.html now.",
]) {
  const r = run(text);
  check(
    `the checker passes a real name or link: ${text}`,
    r.status === 0,
    r.stdout.trim(),
  );
}
for (const [text, mark] of [
  ["Done before row R1 started.", "row code: R1"],
  ["The look W4 copy waits.", "row code: W4"],
  ["T3: wire the cart", "row code: T3"],
  ["Three running (T7, T8, RW2).", "row code: RW2"],
  ["Edit app.js next.", "file path: app.js"],
]) {
  const r = run(text);
  check(
    `the checker still flags ${mark} in: ${text}`,
    r.status === 1 && r.stdout.includes(mark),
    r.stdout.trim(),
  );
}
{
  const many = run(
    JSON.stringify([
      { name: "Cart step", text: "Wire the cart, row R1." },
      { name: "Search step", text: "Make search fast again." },
      { name: "Export step", text: "Export fixed in 3f2a1b9." },
    ]),
    ["--json"],
  );
  check(
    "--json names the text each mark is in and counts the flagged texts",
    many.status === 1 &&
      many.stdout.includes("Cart step: row code: R1") &&
      many.stdout.includes("Export step: commit hash: 3f2a1b9") &&
      !many.stdout.includes("Search step") &&
      /2 of 3 texts have marks/.test(many.stdout),
    many.stdout.trim(),
  );
  const clean = run(JSON.stringify([{ name: "a", text: "Plain words." }]), [
    "--json",
  ]);
  check(
    "--json with clean texts exits 0",
    clean.status === 0 && /no marks in 1 texts/.test(clean.stdout),
  );
  const bad = run('{"name": "a"}', ["--json"]);
  check(
    "--json with no array stops with exit 2",
    bad.status === 2 && /JSON array/.test(bad.stderr),
  );
  const empty = run("  \n");
  check(
    "empty input stops with exit 2: no text given",
    empty.status === 2 && /no text given/.test(empty.stderr),
  );
}

// 5. Wording stays general: no word of the local .privacy-words list (git ignores it) and no home path
const WORDS = path.join(REPO, ".privacy-words");
const own = fs.existsSync(WORDS)
  ? fs
      .readFileSync(WORDS, "utf8")
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w && !w.startsWith("#") && !w.startsWith("allow "))
  : [];
if (!own.length)
  console.log("NOTE: no .privacy-words list here, so names are not checked");
for (const [name, text] of [
  ["the rules file", rules],
  ["the checker", fs.readFileSync(CHECK, "utf8")],
  ["this test", fs.readFileSync(import.meta.filename, "utf8")],
]) {
  const lower = text.toLowerCase();
  const hit = own.filter((w) => lower.includes(w));
  check(
    `${name} names no private word and no home path`,
    !hit.length && !/C:[/\\]|\/Users\/|\/home\//.test(text),
    `found ${hit.length} private word(s)`,
  );
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
