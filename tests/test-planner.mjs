// Test for the planner agent (agents/planner.md) and the rule that calls it (lead skill).
// Run: node tests/test-planner.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : (fail++, console.log(`FAIL  ${name}`)); };

const agent = fs.readFileSync(path.join(ROOT, "agents", "planner.md"), "utf8");
const m = agent.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
check("planner.md has frontmatter", !!m);
const front = Object.fromEntries((m ? m[1] : "").split(/\r?\n/).map((l) => {
  const i = l.indexOf(":");
  return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
}));
const body = m ? m[2] : "";

check("name is planner", front.name === "planner");
check("runs on Fable", front.model === "fable");
const turns = Number(front.maxTurns);
check("has a turn cap of 20 or fewer", Number.isInteger(turns) && turns > 0 && turns <= 20);
const tools = (front.tools || "").split(",").map((t) => t.trim()).filter(Boolean);
check("has a tool list", tools.length > 0);
for (const t of ["Edit", "Write", "Bash", "PowerShell", "NotebookEdit", "Agent"]) {
  check(`cannot use ${t}`, !tools.includes(t));
}
check("description says when to use it", /build or design request/.test(front.description || ""));
check("description says what stays out of the brief", /Keep out your own solution/.test(front.description || ""));
check("description asks for the user's own words", /in their own words/.test(front.description || ""));
check("description has no colon-space (would break the frontmatter)", !/: /.test(front.description || ""));
check("body asks for the alternatives", /other ways you weighed/.test(body));
check("body asks for pushback", /push back/.test(body));
check("body treats a steering brief as an opinion", /one opinion/.test(body));
check("body: reads only the folder the brief names", /Read code only in those folders/.test(body));
check("body: looks up map parts the brief missed", /systems-map\.json/.test(body));
check("body: lists the helpers with model and effort", ["`worker`", "`worker-full`", "`reviewer`", "Sonnet", "Opus"].every((s) => body.includes(s)));
check("body: rows carry helper, runs and budget", /\| Helper \| Runs \| Budget \|/.test(body));
check("body: says which folders and commits it read", /\*\*Read:\*\* the folders and commits/.test(body));
check("body: names what the review gate forces", /2 or more workers edit code/.test(body) && /10 or more code files/.test(body) && /rule, agent, skill/.test(body));
check("body: makes the review call", /\*\*Review:\*\* yes or no/.test(body));
check("description: brief names the folder and commit", /project folders and their commits/.test(front.description || ""));

const lead = fs.readFileSync(path.join(ROOT, "skills", "lead", "SKILL.md"), "utf8");
check("lead names the planner", /subagent_type: "planner"/.test(lead));
check("lead: request in the user's own words", /in the user's own words/.test(lead));
check("lead: only real decisions", /Only real ones/.test(lead));
check("lead: own solution stays out", /Keep out of the brief: your own idea of the solution/.test(lead));
check("lead: no rules or step lists in the brief", /step lists and "do X, not Y" rules/.test(lead));
check("lead: differences are told to the user", /tell the user where they differ/.test(lead));
check("lead: a failed call is said, not hidden", /say so and write the plan yourself/.test(lead));
check("lead: brief names the folder and commit", /rev-parse --short HEAD/.test(lead));
check("lead: rows are pasted unchanged", /Paste its rows unchanged/.test(lead));
check("lead: a changed row is named to the user", /named to the user with the reason/.test(lead));
check("lead: a wrong plan goes back to the planner", /goes back to the planner/.test(lead));
check("lead: job list has the planner's columns", /\| Helper \| Runs \| Budget \| State \|/.test(lead));
check("lead: sections keep their numbers", /## 3\. The job list and the briefs/.test(lead) && /## 6\. Finish/.test(lead));

const rulesFile = ["CLAUDE.md", path.join("rules", "CLAUDE.md")].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
check("the rules file exists", !!rulesFile);
check("the rules name the planner exception", !!rulesFile && /`planner` agent first/.test(fs.readFileSync(rulesFile, "utf8")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
