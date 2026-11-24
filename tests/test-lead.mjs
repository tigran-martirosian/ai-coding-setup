// Test for the lead skill (skills/lead), which plans and runs a big job, and the rules lines that send a big job to it.
// Run: node tests/test-lead.mjs
// 2026-11-20, decisions D1/D10 (the pipeline decisions for current models, 2026-11-19): the planner agent
// is retired and the lead writes the plan itself, so this file was tests/test-planner.mjs. The planner's own checks
// (frontmatter, tools, read-only hook) went with agents/planner.md; its plan-format checks now read the lead's
// reference.md, where the format moved, with the size as a count instead of minutes (D2).
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL  ${name}`);
  }
};

const lead = fs.readFileSync(
  path.join(ROOT, "skills", "lead", "SKILL.md"),
  "utf8",
);
const leadRef = fs.readFileSync(
  path.join(ROOT, "skills", "lead", "reference.md"),
  "utf8",
);
const planFormat =
  leadRef.match(
    /## The plan file\r?\n([\s\S]*?)\r?\n## A worker's brief/,
  )?.[1] || "";
const planReviewer = fs.readFileSync(
  path.join(ROOT, "agents", "plan-reviewer.md"),
  "utf8",
);
const specTemplate = fs.readFileSync(
  path.join(ROOT, "skills", "grilling", "spec-template.md"),
  "utf8",
);

// ---- D1: the lead plans in its own session; no planner agent
check(
  "D1: no planner agent ships (agents/planner.md is retired)",
  !fs.existsSync(path.join(ROOT, "agents", "planner.md")),
);
check(
  "D1: the lead writes the plan itself in this session and launches no planner",
  /\*\*Write the plan yourself,\*\* in this session, from the spec file and the project folder/.test(
    lead,
  ) && !/`planner`/.test(lead + leadRef),
);
check(
  "lead: the plan is written from the spec and the folder, with no DECISIONS read and no purpose quotes",
  /No DECISIONS read, no purpose quotes/.test(lead),
);
// ---- D3: split only at a clean interface
check(
  "D3: split only at a clean interface or for real parallel work; one session per coherent unit; a feature with its tests; sequential steps on the same files are one slice",
  /\*\*Split only at a clean interface or for real parallel work\.\*\* One session per coherent unit; a feature stays\s+with its tests; steps that run one after another on the same files are one slice/.test(
    lead,
  ),
);
// ---- D2: sizes as a count, never time
check(
  "D2: the lead sizes a plan as a count of slices and worker sessions, with no time estimates",
  /\*\*Size is a count of slices and worker sessions\.\*\* No time estimates/.test(
    lead,
  ),
);
check(
  "D2: the plan format names no minutes or hours anywhere",
  planFormat !== "" && !/minute|hour/i.test(planFormat),
);
check(
  "D2: a time limit the user names is a scope limit kept in the spec's Your words",
  /A time limit the\s+user names is a scope limit in the spec's "Your words"/.test(
    lead,
  ) &&
    /A time limit the user names is a\s+scope limit and goes here too/.test(
      specTemplate,
    ),
);
check(
  "D2: the one OK shows the plan's sessions, not its time",
  /the plan in a few \(slices, helpers, models, sessions\)/.test(lead),
);

// ---- release 26.6 D18: a job is built on what already exists before anything new is built
// Line wraps move when the text is rewrapped, so these checks read the text with its whitespace joined.
const flat = (s) => s.replace(/\s+/g, " ");
const grilling = flat(
  fs.readFileSync(path.join(ROOT, "skills", "grilling", "SKILL.md"), "utf8"),
);
check(
  "D18: grilling finds what already exists (own code, its packages, then a maintained package, template or repo) before the first round",
  grilling.includes(
    "**What already exists** is the first fact to find, before the first round: the project's own code and its packages, then a maintained package, template or repo",
  ),
);
check(
  'D18: the spec template has a "Built on" section in the search order, and a new package\'s name is checked before install',
  /^Built on: /m.test(specTemplate) &&
    flat(specTemplate).includes(
      "searched in this order: the project's own code, its packages, then a maintained package, template or repo",
    ) &&
    flat(specTemplate).includes(
      "A package new to the project is checked before install: its name exists on the registry and is the real one, not a lookalike",
    ),
);
check(
  "D18: the lead's plan reads Built on, and a slice builds only what Built on and the project's own code lack",
  flat(planFormat).includes(
    "**Built on** names what the slices use instead of building; a slice builds only what it and the project's own code lack",
  ),
);

// ---- the plan file format, moved from agents/planner.md into the lead's reference.md
check(
  "plan format: slice 0 for a new project sets up folder, branch, verify skill and one passing test",
  /\*\*Slice 0, for a new project only,\*\*/.test(planFormat) &&
    /`verify` skill[\s\S]*one passing test/.test(planFormat),
);
check(
  "plan format: the probe settles the riskiest unknown first and makes a real sample when quality is judged by eye",
  /\*\*Probe first\.\*\* Name the riskiest unknown/.test(planFormat) &&
    /the probe makes a real sample/.test(planFormat),
);
check(
  "plan format: the check slice comes right after the probe, before any build slice",
  /\*\*Check slice,\*\* right after the probe and before any build slice/.test(
    planFormat,
  ),
);
check(
  "plan format: a shared file or a shared new name is a blocking edge, and shared names are fixed word for word",
  /Two slices that share a file, or that name the same new thing, get\s+a blocking edge/.test(
    planFormat,
  ) && /fixed in the plan word for\s+word/.test(planFormat),
);
check(
  "plan format: says which slices run side by side in worktrees and which in one session",
  /each in its own worktree/.test(planFormat) &&
    /run in\s+one session/.test(planFormat),
);
check(
  "plan format: the helper table names the four workers with the 2.6 models",
  [
    "| `worker` | Sonnet at medium |",
    "| `worker-code` | Opus at high |",
    "| `worker-full` | Opus at high |",
    "| `worker-refactor` | Fable at high |",
  ].every((s) => planFormat.includes(s)),
);
check(
  "plan format: each slice carries goal, done-when lines, files, uses and gives, helper, size as a count, risky with reason, blocked by",
  [
    "Goal: <one sentence>.",
    "Proves: D2, D4.",
    "Files: <every file it creates or changes>.",
    "Uses: <what it takes from earlier slices and from Built on>. Gives:",
    "Helper: `worker-code`, Opus at high.",
    "Size: <worker sessions, a count>.",
    "Risky: yes, <reason> / no.",
    "Blocked by:",
  ].every((s) => planFormat.includes(s)) &&
    planFormat.includes("Size: <N slices, M worker sessions>."),
);
check(
  "plan format: no code in the plan; guessed causes and numbers go under Assumptions",
  /Write no code/.test(planFormat) &&
    /Guessed causes and numbers go under Assumptions/.test(planFormat),
);
check(
  "plan format: every done-when line has a Coverage entry",
  /## Coverage\r?\nD1: S3\./.test(planFormat),
);
check(
  "plan format: the plan ends with a Progress section the lead fills",
  /## Progress\r?\nThe lead fills this in/.test(planFormat) &&
    /\| Slice \| State \| Commit \| Worker sessions \| Surprises \|/.test(
      planFormat,
    ),
);
// D12 narrows "risky" to a guard, a delete path, secrets or the user's word
check(
  "plan format: risky means a guard, a delete path or secrets, or the user named it",
  /\*\*Risky: yes\*\* when a slice touches a guard, a delete path or secrets, or the user named it/.test(
    planFormat,
  ),
);
check(
  "plan format: no call budgets, two passes, self-check, Serves or NARROWED",
  !/budget|Pass 1|Pass 2|Self-check|Serves|NARROWED/i.test(planFormat),
);
check(
  "plan-reviewer: checks the plan's Coverage and the slice fields the lead writes",
  /under the plan's Coverage/.test(planReviewer) &&
    /All eight fields are there/.test(planReviewer),
);

// ---- the run (setup review 2.5)
check(
  "D11: plan-reviewer gets the user's own words, the spec and the plan, once; it does not run again",
  /Launch the `plan-reviewer` once with the user's ask in their own words, the spec and the plan/.test(
    lead,
  ) && /it does not run again/.test(lead),
);
check(
  "lead: one OK on spec and plan, and it names the plan-reviewer findings it did not take",
  lead.includes("**The one OK.**") &&
    /each plan-reviewer finding you did not take, with why/.test(lead),
);
check(
  "D11: a cut or dropped slice names its done-when line and gets no second plan review",
  /Each cut or dropped\s+slice names the done-when line it touches; it gets no second plan review/.test(
    lead,
  ) && !/back to the `plan-reviewer`/.test(lead),
);
check(
  "lead: a call that picks another model than the agent file's sets effort too",
  /a call that picks a model other than the agent\s+file's sets `effort` too/.test(
    lead,
  ),
);
check(
  "lead: a big job does not run under /goal",
  /A big job does not run under `\/goal`/.test(lead),
);
check(
  "lead: a returned slice is judged by its re-run checks with the lint, and code-review on risky slices; the lead's own diff read is cut (release 26.6 layer review)",
  /re-run its checks yourself in its worktree, the project's lint/.test(lead) &&
    /DONE WHEN: [^\n]*the project's lint/.test(leadRef) &&
    !/read(ing)? the (fix's )?diff/.test(lead) &&
    lead.includes("`/code-review` on its diff"),
);
check(
  "lead: merges one worktree at a time and removes it with its branch",
  lead.includes("**Merge** one worktree at a time") &&
    /git worktree remove <path>` without `--force`/.test(leadRef) &&
    /git branch -D <branch>/.test(leadRef),
);
check(
  "lead: three fix rounds; a spec change stops for the user",
  /Three fix rounds/.test(lead) &&
    /dropping the only slice that proves a line counts as one/.test(lead),
);
check(
  "lead: a limit stated mid-job goes into Your words at once",
  lead.includes(
    `**A limit the user states mid-job** goes into the spec's "Your words"`,
  ),
);
check(
  "D4: the reviewer gets spec, full diff and end-check outputs, never the chat, once, for correctness",
  /`reviewer` gets the spec, the full diff from the job's base commit, and the end-check outputs; never the chat/.test(
    lead,
  ) && /It reviews once, for correctness against the spec/.test(lead),
);
const leadEnd = lead.match(/## 4\. End\r?\n([\s\S]*)$/)?.[1] || "";
check(
  "lead: section 4 sweeps every repository the job made worktrees in with --remove and names the dirty and unmerged ones with their last commit",
  leadEnd.includes(
    "leftover-worktrees.mjs <repo> <base-branch> --remove --prefix",
  ) &&
    leadEnd.includes("every repository the job made worktrees in") &&
    ["dirty", "unmerged", "last commit"].every((w) => leadEnd.includes(w)),
);
check(
  "lead: every slice worktree is made on a <job>/s<N> branch, never by isolation, so the sweep finds it; the sweep runs again after the user's fix slices; the report names locked, detached and missing ones too",
  leadRef.includes("worktree add <path> -b <job>/s<N> <job branch>") &&
    /never `isolation: "worktree"`/.test(leadRef) &&
    /pass the job branch as `<base-branch>`/.test(leadEnd) &&
    /again after the last fix slice/.test(leadEnd) &&
    ["locked", "detached", "missing"].every((w) => leadEnd.includes(w)),
);
check(
  "lead: the user's try ends the job; the retro is lines at the end of the report, naming the plan review, code-review and blind look that caught nothing",
  leadEnd.includes("**The user tries it.**") &&
    !/retro/i.test(lead) &&
    /It ends with a few lines: each finding of the reviews/.test(leadEnd) &&
    /each of\s+the plan review, `\/code-review` on risky slices and the blind look that caught nothing/.test(
      leadEnd,
    ),
);
check(
  "lead: the blind look's answer is saved word for word as the page's verdict.md in .proof/<page name>/, and the three kinds of check are named once",
  /\*\*Save the answer\*\* word for word as `verdict\.md` beside the shots in `\.proof\/<page name>\/`/.test(
    leadRef,
  ) &&
    /\*\*Three kinds of check\*\*/.test(leadRef) &&
    /one gate,\s+verify-gate, on code and pages/.test(leadRef),
);
check(
  "lead: worker brief carries the slice's done-when lines and the user's words, no Serves",
  /DONE WHEN: the slice's done-when lines/.test(leadRef) &&
    /YOUR WORDS:/.test(leadRef) &&
    !/Serves|SERVES|NARROWED/.test(lead + leadRef),
);
const handoff = fs.readFileSync(
  path.join(ROOT, "skills", "handoff", "SKILL.md"),
  "utf8",
);
check(
  "handoff: the summary carries no Serves quotes (retired 2026-11-19)",
  !/Serves/.test(handoff),
);

// ---- the rules (setup review 2.3)
// 2026-11-20, decisions D1/D2/D11-D13: the three lanes (fix, talk, planner) became one size call (small, medium,
// big) with a big job sent to grilling and the lead, so the four lane checks were replaced by these.
const rulesFile = ["CLAUDE.md", path.join("rules", "CLAUDE.md")]
  .map((f) => path.join(ROOT, f))
  .find((f) => fs.existsSync(f));
check("the rules file exists", !!rulesFile);
const rules = rulesFile ? fs.readFileSync(rulesFile, "utf8") : "";
const sizeLine =
  rules
    .split(/\r?\n/)
    .find((l) => l.includes("**Size each ask in one line first**")) || "";
check(
  "rules: each ask is sized small, medium or big in one line, and the user can overrule it",
  /"Small: doing it now" \/ "Medium: 2 questions first" \/ "Big: questions, then a plan"\); the user can overrule it in a word/.test(
    sizeLine,
  ),
);
check(
  "rules: a medium job gets 1-3 clarifying questions with recommended answers and done-when lines in chat, built here",
  /\*\*Medium\*\* \(one session, a few parts\): 1-3 plain clarifying questions, each with a recommended answer, then done-when lines in chat[^.]*, then built here/.test(
    sizeLine,
  ),
);
check(
  "rules: a big job goes grilling, spec, then the lead, which writes the plan; one plan-reviewer pass and one OK before any helper",
  /\*\*Big\*\* \(any of: a new project, more than one session, several parts that must fit, quality judged by measuring or by eye\): `grilling`, its spec file, then the `lead` skill, which writes the plan in this session; one `plan-reviewer` pass, then the user's one OK on spec and plan; no helper starts before that OK/.test(
    sizeLine,
  ),
);
check(
  "rules: one end reviewer for correctness, /code-review only on a risky change, blind-reviewer only for what a person sees",
  /one `plan-reviewer` pass on its plan and one end `reviewer`, for correctness against the spec; `\/code-review` runs only on a risky change \(it touches a guard, a delete path or secrets, or the user names it\); a `blind-reviewer` only for screens or text a person reads, never code/.test(
    rules,
  ),
);
check(
  "rules: no planner, no lanes, and sizes never in time",
  !/planner|Name the lane/i.test(rules) &&
    rules.includes(
      "- Size work as a count of parts or sessions, never in time.",
    ),
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
