// Test for the planner agent (agents/planner.md) and the rule that calls it (lead skill).
// Run: node tests/test-planner.mjs
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

const agent = fs.readFileSync(path.join(ROOT, "agents", "planner.md"), "utf8");
const m = agent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
check("planner.md has frontmatter", !!m);
const front = Object.fromEntries(
  (m ? m[1] : "").split(/\r?\n/).map((l) => {
    const i = l.indexOf(":");
    return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
  }),
);
const body = m ? m[2] : "";

check("name is planner", front.name === "planner");
check(
  "runs on Fable at high",
  front.model === "fable" && front.effort === "high",
);
const turns = Number(front.maxTurns);
check(
  "has a turn cap of 40 or fewer",
  Number.isInteger(turns) && turns > 0 && turns <= 40,
);
const tools = (front.tools || "")
  .split(",")
  .map((t) => t.trim())
  .filter(Boolean);
check("has a tool list", tools.length > 0);
for (const t of ["Edit", "Write", "PowerShell", "NotebookEdit", "Agent"]) {
  check(`cannot use ${t}`, !tools.includes(t));
}
check(
  "Bash only with the planner-readonly hook",
  !tools.includes("Bash") ||
    /PreToolUse:[\s\S]*matcher: "Bash\|PowerShell"[\s\S]*planner-readonly\.mjs/.test(
      m ? m[1] : "",
    ),
);
check(
  "description says when to use it",
  /build or design request/.test(front.description || ""),
);
check(
  "description says what stays out of the brief",
  /Keep out your own solution/.test(front.description || ""),
);
check(
  "description asks for the user's own words",
  /in their own words/.test(front.description || ""),
);
check(
  "description has no colon-space (would break the frontmatter)",
  !/: /.test(front.description || ""),
);
check("body asks for the alternatives", /other ways you weighed/.test(body));
check("body asks for pushback", /push back/.test(body));
check("body treats a steering brief as an opinion", /one opinion/.test(body));
check(
  "body: reads only the folder the brief names",
  /Read code only in those folders/.test(body),
);
check(
  "body: looks up map parts the brief missed",
  /map\.mjs --near/.test(body),
);
check(
  "body: lists the helpers with model and effort",
  ["`worker`", "`worker-full`", "`reviewer`", "Sonnet", "Opus"].every((s) =>
    body.includes(s),
  ),
);
check(
  "body: a Fable-medium worker row for charts, science or maths, with deep web research kept off Fable (2026-11-10), without code",
  /\| `worker`, model `fable` \| Fable, medium \|[^\n]*charts[^\n]*science or maths[^\n]*deep web research stays on a plain `worker`/.test(
    body,
  ) && !/\| `worker`, model `fable` \|[^\n]*code/.test(body),
);
check(
  "body: a worker-code row on Opus at high for code changes",
  /\| `worker-code` \| Opus, high \|[^\n]*code changes/.test(body),
);
check(
  "body: a worker-refactor row on Fable at high for refactors",
  /\| `worker-refactor` \| Fable, high \|[^\n]*refactor/.test(body),
);
check(
  "body: security work stays off Fable",
  /Security work[^\n]*stays on Opus/.test(body),
);
check(
  "body: rows carry helper, runs and budget",
  /\| Helper \| Runs \| Budget \|/.test(body),
);
check(
  "body: says which folders and commits it read",
  /\*\*Read:\*\* the folders and commits/.test(body),
);
check(
  "body: names what the review gate forces",
  /2 or more workers edit code/.test(body) &&
    /10 or more code files/.test(body) &&
    /rule, agent, skill/.test(body),
);
check("body: makes the review call", /\*\*Review:\*\* yes or no/.test(body));
check(
  "description: brief names the folder and commit",
  /project folders and their commits/.test(front.description || ""),
);
check(
  "description: the plan is shown to the user before helpers start",
  /show the user its plan/.test(front.description || "") &&
    /before any helper starts/.test(front.description || ""),
);
check(
  "body: sizes by what a step decides, not by calls",
  /## Size a step by what it decides, holds and writes/.test(body) &&
    /Tool calls measure the doing, not the deciding/.test(body),
);
check(
  "body: lists what the request involves, decided or open",
  /what the request really involves/.test(body) && /mark it open/.test(body),
);
check(
  "body: open design is its own step that writes a design file",
  /Open design is its own step/.test(body) && /writes a design file/.test(body),
);
check(
  "body: repeated parts go blockout, one unit, copies, polish",
  /blockout, one unit, copies, polish/.test(body),
);
check(
  "body: no splitting below a real piece (page and its buttons)",
  /Not below a real piece/.test(body) &&
    /a page and its buttons are one step/.test(body),
);
check(
  "body: a part that can't be designed yet is a plan-this-part row",
  /"plan this part" row/.test(body),
);
check(
  "body: rows carry a Decides column",
  /\| Step \| Job \| Decides \|/.test(body),
);
check(
  "body: opens its reply with a plain part for the user",
  /\*\*For the user\*\*/.test(body) &&
    /how many helpers, on which model and effort/.test(body),
);
check(
  "body: a design the user looks at waits for their OK",
  /after S<n>, user OK/.test(body),
);
check("body: the old spend line is gone", !/every turn costs/.test(body));
check(
  "body: reading for a plan is not saved, the runs a plan starts are",
  /Reading for a plan is not saved/.test(body) &&
    /never the runs a plan starts/.test(body),
);
check(
  "body: a batch of model runs gives its count and cost",
  /batch/.test(body) && /cost at API prices/.test(body),
);
check(
  "body: reads the folder state with git status",
  /git -C <folder> status --short/.test(body),
);
check(
  "body: Read line names files listed but not opened",
  /\*\*Read:\*\*[^\n]*not opened/.test(body.split("## Send back")[1] || ""),
);
check(
  "body: template has Goal and non-goals",
  /\*\*Goal and non-goals:\*\*/.test(body),
);
check("body: template has Order", /\*\*Order:\*\*/.test(body));
check("body: template has Tests", /\*\*Tests:\*\*/.test(body));
check(
  "body: template has Risks and undo",
  /\*\*Risks and undo:\*\*/.test(body),
);
check(
  "body: template ends with a Self-check",
  /\*\*Self-check:\*\*/.test(body),
);
check(
  "body: unknowns marked NEEDS RESEARCH",
  /NEEDS RESEARCH: <what would settle it>/.test(body),
);
check(
  "body: plan-reviewer in the helpers table",
  /\| `plan-reviewer` \|/.test(body),
);
check(
  "body: not a reviewer of plans",
  /A review of a plan or a design goes to the `plan-reviewer`/.test(body),
);
check(
  "body: Needs the user's OK comes right after For the user",
  /1\. \*\*For the user\*\*[\s\S]*\n2\. \*\*Needs the user's OK:\*\*/.test(
    body,
  ),
);
// Plans that stay true when amended (docs/2026-11-12-questions-redo-plan.md, row P1)
const CHANGED_LINE = '`Changed <date>: <row>: <what>, user: "<quote>"`';
check(
  "body: a re-plan is rewritten in place with one Changed line at the end, no top block",
  /rewritten in place/.test(body) &&
    body.includes(CHANGED_LINE) &&
    /No top block that wins over the rest/.test(body),
);
check(
  "body: a reviewed plan is run as written; a conflict goes to the user with row, answer and evidence",
  /A reviewed plan is run as written/.test(body) &&
    /not re-reasoned into new questions/.test(body) &&
    /doesn't override a plan row/.test(body) &&
    /the row's text, the answer's text and the evidence/.test(body),
);
check(
  "body: self-check item 1 lists each decision quote with its row",
  /one line per decision quote with the row that carries it/.test(body),
);
const reviewer = fs.readFileSync(
  path.join(ROOT, "agents", "plan-reviewer.md"),
  "utf8",
);
// Intent-drift fix I2 (docs/2026-11-12-intent-drift-fix-plan.md): the user's purpose travels with each row
check(
  "body: rows carry a Serves column right after Decides",
  /\| Step \| Job \| Decides \| Serves \| Files \|/.test(body),
);
check(
  "body: Serves quotes the user's words with the DECISIONS date, never a pointer; mechanics rows say so",
  /- Serves: the user's words on what this row's result is for, with the DECISIONS date/.test(
    body,
  ) &&
    /a pointer \("decided, see DECISIONS"\) is never enough/.test(body) &&
    /`none \(mechanics\)`/.test(body),
);
check(
  "body: greps DECISIONS for each thing a row builds or runs",
  /Grep of it for each topic the plan touches and for each thing a row builds or runs/.test(
    body,
  ),
);
check(
  "body: Done when fails when the purpose is unmet",
  /- Done when:[^\n]*It fails when the Serves purpose is unmet/.test(body),
);
check(
  "body: a limit not in the user's words is NARROWED and goes to Needs-OK; a caution sets where, not what",
  /`NARROWED: <what>, because <why>` and listed under Needs the user's OK/.test(
    body,
  ) && /A caution sets where work runs[^\n]*never what the work is/.test(body),
);
check(
  "body: self-check has the Serves and NARROWED items",
  /\*\*Self-check:\*\*[^\n]*each row's Serves quotes the user's words[^\n]*Done when fails if that purpose is unmet[^\n]*marked `NARROWED` and on the Needs-OK list/.test(
    body,
  ),
);
check(
  "plan-reviewer: check 4 covers DECISIONS entries from the plan's date on",
  /4\. \*\*Everything placed\.\*\*[^\n]*dated on or after the plan's date/.test(
    reviewer,
  ) && /not carried into its row is Important/.test(reviewer),
);

const lead = fs.readFileSync(
  path.join(ROOT, "skills", "lead", "SKILL.md"),
  "utf8",
);
const leadRef = fs.readFileSync(
  path.join(ROOT, "skills", "lead", "reference.md"),
  "utf8",
); // holds the planner's brief
check("lead names the planner", /subagent_type: "planner"/.test(lead));
check(
  "lead: request in the user's own words",
  /in the user's own words/.test(lead),
);
check("lead: only real decisions", /Only real ones/.test(leadRef));
check(
  "lead: own solution stays out",
  /Keep out of the brief: your own idea of the solution/.test(leadRef),
);
check(
  "lead: no rules or step lists in the brief",
  /step lists and "do X, not Y" rules/.test(leadRef),
);
check(
  "lead: differences are told to the user",
  /tell the user where they differ/.test(lead),
);
check(
  "lead: a failed call is said, not hidden",
  /say so and write the plan yourself/.test(lead),
);
check(
  "lead: brief names the folder and commit",
  /rev-parse --short HEAD/.test(leadRef),
);
check(
  "lead: points to the planner's brief",
  /reference\.md section "The planner's brief"/.test(lead),
);
check("lead: rows are pasted unchanged", /Paste its rows unchanged/.test(lead));
check(
  "lead: a changed row is named to the user",
  /named to the user with the reason/.test(lead),
);
check(
  "lead: a wrong plan goes back to the planner",
  /goes back to the planner/.test(lead),
);
check(
  "lead: job list has the planner's columns",
  /\| Helper \| Runs \| Budget \| State \|/.test(lead),
);
check(
  "lead: the plan is shown and the helpers wait for the answer",
  /Show the user the plan before any helper starts, and wait/.test(lead) &&
    /The helpers start only on the answer/.test(lead),
);
check(
  "lead: the plan form ticks every step and has a box for changes",
  /`multiSelect` field `steps`/.test(lead) &&
    /`editText` field `changes`/.test(lead),
);
check(
  "lead: every column stays wherever the plan is saved",
  /Every column stays wherever the plan is saved/.test(lead),
);
check(
  "lead: a step doesn't grow in its brief",
  /A step doesn't grow in its brief/.test(lead),
);
check(
  "lead: a design the user looks at ends with their OK",
  /ends with the user's OK/.test(lead),
);
check(
  "lead: job list and brief carry Decides",
  /\| Step \| Job \| Decides \|/.test(lead) && /DECIDES:/.test(leadRef),
);
check(
  "lead: a changed plan is rewritten in place, decisions after it get a row, done means its checks ran",
  /A changed plan is rewritten in place/.test(lead) &&
    lead.includes(CHANGED_LINE) &&
    /`out, because <why>` line in the same turn it goes into DECISIONS/.test(
      lead,
    ) &&
    /a check not run stays named in the State cell/.test(lead),
);
check(
  "lead: a reviewed plan is run as written; a conflict goes to the user with row, answer and evidence",
  /A reviewed plan is run as written/.test(lead) &&
    /not re-reasoned into new questions/.test(lead) &&
    /doesn't override a plan row/.test(lead) &&
    /the row's text, the answer's text and the evidence, with your recommendation/.test(
      lead,
    ),
);
check(
  "lead: job list carries Serves, the brief a SERVES line pasted from the row",
  /\| Step \| Job \| Decides \| Serves \|/.test(lead) &&
    /SERVES: the row's Serves cell, pasted unchanged/.test(leadRef),
);
check(
  "lead: a row the session writes or changes carries Serves and gets the plan-reviewer on the changed rows",
  /A row you write or change yourself carries a Serves cell[^\n]*the `plan-reviewer` checks the changed rows before their helper starts, even a single row\. A limit not in the user's words is written `NARROWED: <what>, because <why>` and goes to the user/.test(
    lead,
  ) && /A side lane's state file opens with the Serves quotes/.test(lead),
);
check(
  "lead: a step that cannot do what the user decided stops and asks, no safer stand-in",
  /A step that cannot do what the user decided stops and asks\.\*\* It builds no safer stand-in/.test(
    lead,
  ),
);
check(
  "lead: card rule, one sentence",
  /A tick on a card approves only what that card asked\*\*; it never stands in for the purpose decision or approves the whole run\./.test(
    lead,
  ),
);
check(
  "lead: hold rule, one sentence",
  /A hold covers only what the user named as held\*\*; work outside it, such as the user's own use of a held thing, still gets its row\./.test(
    lead,
  ),
);
check(
  "lead: reviewer briefs quote the purposes; a focus list never replaces the checklist; a build review's request is purpose plus card",
  /quotes the Serves cell of each row it covers/.test(leadRef) &&
    /never replaces it/.test(leadRef) &&
    /the purpose decision plus the card the user ticked/.test(leadRef),
);
const handoff = fs.readFileSync(
  path.join(ROOT, "skills", "handoff", "SKILL.md"),
  "utf8",
);
check(
  "handoff: the summary carries the Serves quotes unchanged",
  /the Serves quote of each open row, unchanged/.test(handoff),
);
check(
  "planner: reads the purpose record and the newest dated section; a row naming a recorded thing quotes its entry and marks limits NARROWED",
  /`DECISIONS\.md`'s first section `## What each thing is for` \(the purpose record\) and its newest dated section below it/.test(
    body,
  ) &&
    !/the top section of `DECISIONS\.md`/.test(body) &&
    /names a thing in the purpose record quotes that entry's words in Serves, and marks any limit on it `NARROWED`/.test(
      body,
    ),
);
check(
  "lead: writes a purpose record entry in the record's format and shows it; quotes the record and the newest dated section",
  /\*\*The purpose record\.\*\* When the user says what a thing is for, write it into the first section of `DECISIONS\.md`, `## What each thing is for`/.test(
    leadRef,
  ) &&
    leadRef.includes(
      '`- **<thing>** (also: <name>, …): "<cleaned words>" · *<YYYY-MM-DD>* · from "<raw phrase>"`, and show the line to the user',
    ) &&
    /the purpose record's entries for the things the job names, the newest dated section below it/.test(
      leadRef,
    ) &&
    !/its top section plus a grep/.test(leadRef),
);
check(
  "lead: sections keep their numbers",
  /## 3\. The job list and the briefs/.test(lead) && /## 6\. Finish/.test(lead),
);

const rulesFile = ["CLAUDE.md", path.join("rules", "CLAUDE.md")]
  .map((f) => path.join(ROOT, f))
  .find((f) => fs.existsSync(f));
check("the rules file exists", !!rulesFile);
check(
  "the rules name the planner exception",
  !!rulesFile &&
    /`planner` agent first/.test(fs.readFileSync(rulesFile, "utf8")),
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
