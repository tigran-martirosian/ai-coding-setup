// Checks the agent definitions in the agents folder of this repository that the rules depend on. Run: node tests/test-agents.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const AGENTS = fileURLToPath(new URL("../agents/", import.meta.url));
const read = (name) =>
  readFileSync(join(AGENTS, `${name}.md`), "utf8").replace(/\r\n/g, "\n");
const parts = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  return { head: m[1], body: m[2].trim() };
};
const has = (head, key, value) =>
  new RegExp(String.raw`^${key}:[ ]*${value}[ ]*$`, "m").test(head);
const tools = (head) =>
  (head.match(/^tools:\s*(.*)$/m)?.[1] || "").split(/,\s*/);

const worker = parts(read("worker")),
  full = parts(read("worker-full"));
const planRev = parts(read("plan-reviewer")),
  rev = parts(read("reviewer")),
  high = parts(read("worker-refactor"));
const code = parts(read("worker-code")),
  blind = parts(read("blind-reviewer")),
  advisor = parts(read("stuck-advisor"));
const desc = (head) => head.match(/^description:\s*(.*)$/m)?.[1] || "";
const rest = (head) =>
  head
    .split("\n")
    .filter((l) => !/^(name|description|model|effort):/.test(l))
    .join("\n");
const WRITE_TOOLS = ["Edit", "Write", "NotebookEdit", "Agent", "PowerShell"];
const PLAN_ITEMS = [
  "Agrees with the user's words and the decisions",
  "Does what the user said it is for",
  "One owning step per file",
  "Everything placed",
  "Sizes from facts",
  "Expect before is true now; Done when can run",
  "The right copy",
  "Order holds",
  "Nothing invented in a build row",
  "Reuse before new",
  "Scope",
  "Tests, risks, review lines",
  "The self-check is honest",
];
const numbered = (body, items) =>
  items.every((s, i) => body.includes(`${i + 1}. **${s}`));
const SLIM =
  /\n\nYou start without the CLAUDE\.md files[\s\S]*?in plain words>`\./;
// worker-refactor alone gets the shape line (user, 2026-11-13: it replaces the ownership line), the refactor section
// and Anthropic's "Finishing work" block (user, 2026-11-10); the rest is the worker's body
const OWN_OLD = /^- This codebase is yours:[^\n]*\n/m;
const OWN =
  /^- Inside your FILES the shape of the code is your call[^\n]*what the code does stays the same\.\n/m;
const REFACTOR = /\n# The refactor\n[\s\S]*?(?=\n# Communicating clearly)/;
const FINISH = /\n+# Finishing work\n[\s\S]*$/;
const highBody = high.body.replace(/\r\n/g, "\n");
const highCore = highBody
  .replace(OWN, "")
  .replace(REFACTOR, "")
  .replace(FINISH, "");
const newProject = readFileSync(
  fileURLToPath(new URL("../skills/new-project/SKILL.md", import.meta.url)),
  "utf8",
);
const checks = [
  [
    "worker is named worker and starts without CLAUDE.md",
    has(worker.head, "name", "worker") &&
      has(worker.head, "omitClaudeMd", "true"),
  ],
  [
    "worker has no Agent tool and keeps Edit, Write, Bash",
    !tools(worker.head).includes("Agent") &&
      ["Edit", "Write", "Bash"].every((t) => tools(worker.head).includes(t)),
  ],
  [
    "worker-full loads CLAUDE.md and has every tool",
    has(full.head, "name", "worker-full") &&
      !/omitClaudeMd/.test(full.head) &&
      !/^tools:/m.test(full.head),
  ],
  [
    "the two workers differ only by the block for starting without CLAUDE.md",
    SLIM.test(worker.body) && worker.body.replace(SLIM, "") === full.body,
  ],
  [
    "the worker's own block carries the rules it no longer loads",
    ["WHAT THIS DOES", "no made-up defaults", "Commit or push only"].every(
      (s) => worker.body.includes(s),
    ),
  ],
  [
    "worker-refactor is named worker-refactor, on fable at high effort",
    has(high.head, "name", "worker-refactor") &&
      has(high.head, "model", "fable") &&
      has(high.head, "effort", "high"),
  ],
  [
    "worker-refactor has the worker's body and the rest of its settings",
    highCore === worker.body.replace(/\r\n/g, "\n") &&
      rest(high.head) === rest(worker.head),
  ],
  [
    "worker-refactor swaps the ownership line for the shape line and adds Anthropic's Finishing work text",
    OWN.test(highBody) &&
      !OWN_OLD.test(highBody) &&
      FINISH.test(high.body) &&
      high.body.includes(
        "Please avoid stopping while you still owe work the user asked for.",
      ) &&
      high.body.includes(
        "This does not override the need for confirmation on risky or destructive actions.",
      ),
  ],
  [
    "every worker, the planner and both reviewers carry Anthropic's Communicating clearly text",
    [worker, code, full, high, planRev, rev].every(
      (a) =>
        a.body.includes("# Communicating clearly") &&
        a.body.includes("Write for an intelligent but low-context reader."),
    ) &&
      read("planner").includes(
        "Write for an intelligent but low-context reader.",
      ) &&
      [worker, code, full, high].every((a) =>
        a.body.includes(
          "the last `Outside the brief:` line, or the one `BLOCKED` line",
        ),
      ),
  ],
  [
    "every worker finishes the brief or ends with BLOCKED at a refused command",
    [worker, code, full, high].every((a) =>
      /Finish everything the brief asks\.[^\n]*BLOCKED/.test(a.body),
    ),
  ],
  [
    "worker-refactor has the refactor section: map first, every dependent in FILES, compiler and tests as judge, assertions kept, done when",
    REFACTOR.test(highBody) &&
      [
        "**Map first.**",
        "take its errors as the rest of the map",
        "**One decision, every dependent.**",
        "A dependent outside your FILES goes in your report",
        "**The compiler and the tests are the judge.**",
        "Tests keep their assertions",
        "Done when every dependent inside your FILES is ticked",
      ].every((s) => highBody.includes(s)),
  ],
  [
    "worker-refactor has its own description, which says a rename is never a reason",
    desc(high.head) !== "" &&
      desc(high.head) !== desc(worker.head) &&
      /rename[^.]*never a reason/i.test(desc(high.head)),
  ],
  [
    "worker-full is on opus at high effort",
    has(full.head, "model", "opus") && has(full.head, "effort", "high"),
  ],
  [
    "worker-code is named worker-code, on opus at high effort",
    has(code.head, "name", "worker-code") &&
      has(code.head, "model", "opus") &&
      has(code.head, "effort", "high"),
  ],
  [
    "worker-code has the worker's body and the rest of its settings",
    code.body === worker.body && rest(code.head) === rest(worker.head),
  ],
  [
    "worker-code has its own description, for code changes, sending a long refactor to worker-refactor",
    desc(code.head) !== desc(worker.head) &&
      /code changes/i.test(desc(code.head)) &&
      /refactor[^.]*worker-refactor/i.test(desc(code.head)),
  ],
  [
    "plan-reviewer is named, on fable, read-only",
    has(planRev.head, "name", "plan-reviewer") &&
      has(planRev.head, "model", "fable") &&
      ["Read", "Grep", "Glob", "Bash"].every((t) =>
        tools(planRev.head).includes(t),
      ) &&
      !tools(planRev.head).some((t) => WRITE_TOOLS.includes(t)),
  ],
  [
    "plan-reviewer has a turn cap of 40 or fewer",
    Number(planRev.head.match(/^maxTurns:\s*(\d+)/m)?.[1]) <= 40,
  ],
  [
    "plan-reviewer has the 13 checklist items in order",
    PLAN_ITEMS.length === 13 &&
      numbered(planRev.body, PLAN_ITEMS) &&
      PLAN_ITEMS.map((s) => planRev.body.indexOf(s)).every(
        (p, i, a) => i === 0 || p > a[i - 1],
      ) &&
      !/\n14\. \*\*/.test(planRev.body),
  ],
  // Intent-drift fix I2 (docs/2026-11-12-intent-drift-fix-plan.md): the user's purpose travels with each row and both gates check it
  [
    "plan-reviewer item 2 greps DECISIONS itself and flags narrower, safer or opposite rows, a missing or pointer-only Serves, a Done when that passes with the purpose unmet",
    /2\. \*\*Does what the user said it is for\.\*\*[^\n]*Grep `DECISIONS\.md` yourself[^\n]*whatever the brief quotes[^\n]*narrower than, safer than or opposite[^\n]*missing or only a pointer[^\n]*Done when that passes while the purpose is unmet[^\n]*user ticked[^\n]*no finding/.test(
      planRev.body,
    ),
  ],
  // Fix round (I5 missed R1, R3): the purpose of the tool or agent a row uses sits in another decision
  [
    "plan-reviewer item 2 goes one level up to what the row's tool or agent is for, and reports the line found",
    /2\. \*\*Does what the user said it is for\.\*\*[^\n]*each tool, agent or model it builds that for or runs it with[^\n]*asks you to focus on or budgets[^\n]*Go one level up[^\n]*different decision/.test(
      planRev.body,
    ) &&
      /\*\*Checks run:\*\*[^\n]*for item 2, each tool or agent[^\n]*none found/.test(
        planRev.body,
      ),
  ],
  [
    "reviewer item 4 goes one level up to what the build's tool or agent is for, and reports the line found",
    /4\. Does what the user said it is for\.[^\n]*each tool, agent or model it makes that for or runs it with[^\n]*Go one level up[^\n]*different decision/.test(
      rev.body,
    ) && /\*\*Purposes checked:\*\*[^\n]*none found/.test(rev.body),
  ],
  // Second fix round (R1, R3 missed again): the agent the row itself runs; a tick covers only the limit it names
  [
    "plan-reviewer item 2 checks the agent the row itself runs and lets a tick clear only the limit it names",
    /2\. \*\*Does what the user said it is for\.\*\*[^\n]*each agent, model or tool the row's own task runs[^\n]*besides the helper[^\n]*no finding for the limit the tick names; a cut of a decided purpose that no tick names stays Important/.test(
      planRev.body,
    ),
  ],
  [
    "reviewer item 4 checks the agent the build itself runs and lets a tick clear only the limit it names",
    /4\. Does what the user said it is for\.[^\n]*each agent, model or tool the build itself runs[^\n]*no finding for the limit the tick names; a cut of a decided purpose that no tick names stays Important/.test(
      rev.body,
    ),
  ],
  [
    "reviewer checks the build against the user's stated purpose and names each part of the quote it cannot do",
    /\*\*Against the request and the plan\*\*[\s\S]*Does what the user said it is for\.[^\n]*Grep `DECISIONS\.md` yourself[^\n]*name each part of the quote the build cannot do[\s\S]*\*\*Quality\*\*/.test(
      rev.body,
    ) &&
      /\*\*Against the request:\*\*[^\n]*each part of the user's stated purpose the build cannot do/.test(
        rev.body,
      ),
  ],
  [
    "the four workers carry the same SERVES stop line",
    [worker, code, full, high].every((a) =>
      a.body.includes(
        "When what you find contradicts the goal, SERVES or EXPECT:",
      ),
    ) &&
      [worker, code, full, high].every((a) =>
        /what it SERVES \(the user's words on what its result is for; a step that cannot do that stops and asks, and builds no safer stand-in\)/.test(
          a.body,
        ),
      ),
  ],
  [
    "plan-reviewer has the do-not-flag list and proves Important findings",
    /\*\*Do not flag:\*\*/.test(planRev.body) && /Unsure/.test(planRev.body),
  ],
  [
    "plan-reviewer runs only checks that read or test",
    /never run one that deploys, pushes or writes outside a scratch folder/i.test(
      planRev.body,
    ),
  ],
  [
    "plan-reviewer's Bash runs under the planner-readonly hook",
    /PreToolUse:[\s\S]*matcher: "Bash\|PowerShell"[\s\S]*planner-readonly\.mjs/.test(
      planRev.head,
    ),
  ],
  [
    "plan-reviewer reads DECISIONS by grep and the map",
    /never a whole read/.test(planRev.body) &&
      /map\.mjs --near/.test(planRev.body),
  ],
  [
    "reviewer tags a request item Important only when a realistic use fails, and a guard bypass always",
    /\*\*Against the request:\*\*[^\n]*Tag such an item Important when a realistic use fails[^\n]*stays listed here untagged/.test(
      rev.body,
    ) &&
      /\*\*Quality:\*\*[^\n]*A guard bypass the change brings in is Important whatever the input[^\n]*fail open/.test(
        rev.body,
      ),
  ],
  [
    "reviewer reads every changed file whole, no fixed small budget",
    /Read every changed file whole/i.test(rev.body) &&
      !/about 20 tool calls/.test(rev.body),
  ],
  [
    "reviewer is read-only with a turn cap of 60",
    !tools(rev.head).some((t) => WRITE_TOOLS.includes(t)) &&
      has(rev.head, "maxTurns", "60"),
  ],
  [
    "reviewer keeps its two headings and re-checks Important findings",
    /\*\*Against the request:\*\*/.test(rev.body) &&
      /\*\*Quality:\*\*/.test(rev.body) &&
      /Re-check each Important finding/i.test(rev.body) &&
      /\*\*Do not flag\*\*/.test(rev.body),
  ],
  [
    "reviewer reads DECISIONS by grep and the map",
    /never a whole read/.test(rev.body) && /map\.mjs --near/.test(rev.body),
  ],
  [
    "reviewer no longer says one is enough, and splits a big job into parts",
    !/one is enough/i.test(rev.head + rev.body) &&
      /each briefed with its own part/.test(desc(rev.head)),
  ],
  [
    "reviewer sends a newcomer's look to the blind-reviewer",
    /blind-reviewer/.test(desc(rev.head)) &&
      !/blind screen review/i.test(desc(rev.head)),
  ],
  [
    "blind-reviewer is named, on fable at high effort, starts without CLAUDE.md",
    has(blind.head, "name", "blind-reviewer") &&
      has(blind.head, "model", "fable") &&
      has(blind.head, "effort", "high") &&
      has(blind.head, "omitClaudeMd", "true"),
  ],
  [
    "blind-reviewer can only read what it is given: Read is its one tool",
    tools(blind.head).join(",") === "Read",
  ],
  [
    "blind-reviewer's brief ends with SYSTEMS MAP: none",
    /SYSTEMS MAP: none/.test(desc(blind.head)),
  ],
  [
    "blind-reviewer has the screen checks 1-39 in order, the text checks and the whole-setup look",
    Array.from({ length: 39 }, (_, i) =>
      blind.body.indexOf(`\n${i + 1}. [`),
    ).every((p, i, a) => p > 0 && (i === 0 || p > a[i - 1])) &&
      ["T1.", "T6."].every((s) => blind.body.includes(s)) &&
      /## The whole setup/.test(blind.body),
  ],
  [
    "blind-reviewer checks the screenshot set and names a missing state",
    /## Screens: is the set complete\?/.test(blind.body) &&
      /state X not shown/.test(blind.body),
  ],
  [
    "blind-reviewer reports the whole approach, findings and a follow-up round",
    /WHOLE APPROACH:/.test(blind.body) &&
      /FINDINGS \(worst first\)/.test(blind.body) &&
      /## A follow-up round/.test(blind.body),
  ],
  [
    "blind-reviewer carries Anthropic's Communicating clearly text",
    blind.body.includes("# Communicating clearly") &&
      blind.body.includes("Write for an intelligent but low-context reader."),
  ],
  [
    "stuck-advisor is named, on fable at high effort, starts without CLAUDE.md",
    has(advisor.head, "name", "stuck-advisor") &&
      has(advisor.head, "model", "fable") &&
      has(advisor.head, "effort", "high") &&
      has(advisor.head, "omitClaudeMd", "true"),
  ],
  [
    "stuck-advisor only reads: Read, Grep and Glob are its tools",
    tools(advisor.head).sort().join(",") === "Glob,Grep,Read",
  ],
  [
    "stuck-advisor's description has the tests-pass-but-wrong trigger, the 3-call budget and leaves a long refactor to worker-refactor",
    /tests pass but the behaviour is still wrong/.test(desc(advisor.head)) &&
      /At most 3 calls a session/.test(desc(advisor.head)) &&
      /long refactor[^.]*worker-refactor[^.]*never both/.test(desc(advisor.head)),
  ],
  [
    "stuck-advisor's brief is at most 300 words, its answer under 200, with one follow-up that names wrong advice",
    /at most 300 words/.test(desc(advisor.head)) &&
      /Under 200 words/.test(advisor.body) &&
      [
        "CAUSE:",
        "CONFIDENCE:",
        "STEPS:",
        "CHECK:",
        "RISK:",
        "EARLIER ADVICE WAS WRONG:",
      ].every((s) => advisor.body.includes(s)),
  ],
  [
    "worker-refactor's description does not name the stuck-advisor (each piece keeps its own job)",
    !/advisor/i.test(desc(high.head)),
  ],
  ...[
    ["plan-reviewer", planRev.body],
    ["reviewer", rev.body],
  ].map(([name, text]) => [
    `${name} reads the purpose record and the newest dated section, and holds a failing PURPOSE CHECK row Important as it stands`,
    /first section `## What each thing is for` \(the purpose record\) and its newest dated section below it/.test(text) &&
      !/the top section of the project's `DECISIONS\.md`/.test(text) &&
      text.includes(
        "The brief's `FOR` and `PURPOSE CHECK` lines are code results from the purpose record: a row they fail is Important as it stands",
      ),
  ]),
  [
    "new-project starts DECISIONS.md with the purpose record, then dated sections newest first",
    /\| `DECISIONS\.md` \| First the section `## What each thing is for` \(the purpose record, empty at the start\), then the decisions in force in dated sections, newest first/.test(
      newProject,
    ),
  ],
];
let fail = 0;
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
console.log(fail ? `${fail} failed` : `all ${checks.length} passed`);
process.exit(fail ? 1 : 0);
