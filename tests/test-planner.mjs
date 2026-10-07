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
check("description says when to use it", /hard-to-undo/.test(front.description || ""));
check("description says what stays out of the brief", /Keep out your own solution/.test(front.description || ""));
check("description asks for the user's own words", /in their own words/.test(front.description || ""));
check("description has no colon-space (would break the frontmatter)", !/: /.test(front.description || ""));
check("body asks for the alternatives", /other ways you weighed/.test(body));
check("body asks for pushback", /push back/.test(body));
check("body treats a steering brief as an opinion", /one opinion/.test(body));

const lead = fs.readFileSync(path.join(ROOT, "skills", "lead", "SKILL.md"), "utf8");
check("lead names the planner", /subagent_type: "planner"/.test(lead));
check("lead: request in the user's own words", /in the user's own words/.test(lead));
check("lead: only real decisions", /Only real ones/.test(lead));
check("lead: own solution stays out", /Keep out of the brief: your own idea of the solution/.test(lead));
check("lead: no rules or step lists in the brief", /step lists and "do X, not Y" rules/.test(lead));
check("lead: differences are told to the user", /tell the user where they differ/.test(lead));
check("lead: a failed call is said, not hidden", /say so and write the plan yourself/.test(lead));
check("lead: sections keep their numbers", /## 3\. Brief each child/.test(lead) && /## 6\. Finish/.test(lead));

const rulesFile = ["CLAUDE.md", path.join("rules", "CLAUDE.md")].map((f) => path.join(ROOT, f)).find((f) => fs.existsSync(f));
check("the rules file exists", !!rulesFile);
check("the rules name the planner exception", !!rulesFile && /`planner` agent \(Fable\)/.test(fs.readFileSync(rulesFile, "utf8")));

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
