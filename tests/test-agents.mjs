// Checks the agent definitions in the agents folder of this repository that the rules depend on. Run: node tests/test-agents.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const AGENTS = fileURLToPath(new URL("../agents/", import.meta.url));
const read = (name) => readFileSync(join(AGENTS, `${name}.md`), "utf8").replace(/\r\n/g, "\n");
const parts = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  return { head: m[1], body: m[2].trim() };
};
const has = (head, key, value) => new RegExp(String.raw`^${key}:[ ]*${value}[ ]*$`, "m").test(head);
const tools = (head) => (head.match(/^tools:\s*(.*)$/m)?.[1] || "").split(/,\s*/);

const worker = parts(read("worker")), full = parts(read("worker-full")), rec = parts(read("rec-check"));
const planRev = parts(read("plan-reviewer")), rev = parts(read("reviewer")), high = parts(read("worker-high"));
const code = parts(read("worker-code"));
const desc = (head) => head.match(/^description:\s*(.*)$/m)?.[1] || "";
const rest = (head) => head.split("\n").filter((l) => !/^(name|description|model|effort):/.test(l)).join("\n");
const WRITE_TOOLS = ["Edit", "Write", "NotebookEdit", "Agent", "PowerShell"];
const PLAN_ITEMS = ["Agrees with the user's words and the decisions", "One owning step per file", "Everything placed", "Sizes from facts",
  "Expect before is true now; Done when can run", "The right copy", "Order holds", "Nothing invented in a build row",
  "Reuse before new", "Scope", "Tests, risks, review lines", "The self-check is honest"];
const numbered = (body, items) => items.every((s, i) => body.includes(`${i + 1}. **${s}`));
const firstItem = rec.body.match(/^\s*(\d+)\. \*\*([^*]+)\*\*/m);
const SLIM = /\n\nYou start without the CLAUDE\.md files[\s\S]*?Commit or push only when the brief says to\./;
const checks = [
  ["worker is named worker and starts without CLAUDE.md", has(worker.head, "name", "worker") && has(worker.head, "omitClaudeMd", "true")],
  ["worker has no Agent tool and keeps Edit, Write, Bash", !tools(worker.head).includes("Agent") && ["Edit", "Write", "Bash"].every((t) => tools(worker.head).includes(t))],
  ["worker-full loads CLAUDE.md and has every tool", has(full.head, "name", "worker-full") && !/omitClaudeMd/.test(full.head) && !/^tools:/m.test(full.head)],
  ["the two workers differ only by the block for starting without CLAUDE.md", SLIM.test(worker.body) && worker.body.replace(SLIM, "") === full.body],
  ["the worker's own block carries the rules it no longer loads", ["WHAT THIS DOES", "no made-up defaults", "Commit or push only"].every((s) => worker.body.includes(s))],
  ["worker-high is named worker-high, on fable at high effort", has(high.head, "name", "worker-high") && has(high.head, "model", "fable") && has(high.head, "effort", "high")],
  ["worker-high has the worker's body and the rest of its settings", high.body === worker.body && rest(high.head) === rest(worker.head)],
  ["worker-high has its own description, which says a rename is never a reason", desc(high.head) !== "" && desc(high.head) !== desc(worker.head)
    && /rename[^.]*never a reason/i.test(desc(high.head))],
  ["worker-code is named worker-code, on opus at high effort", has(code.head, "name", "worker-code") && has(code.head, "model", "opus") && has(code.head, "effort", "high")],
  ["worker-code has the worker's body and the rest of its settings", code.body === worker.body && rest(code.head) === rest(worker.head)],
  ["worker-code has its own description, for code changes, sending a long refactor to worker-high", desc(code.head) !== desc(worker.head)
    && /code changes/i.test(desc(code.head)) && /refactor[^.]*worker-high/i.test(desc(code.head))],
  ["rec-check starts small and cannot change files", has(rec.head, "omitClaudeMd", "true") && !tools(rec.head).some((t) => ["Edit", "Write"].includes(t))],
  ["rec-check starts its answer with keep or change", /`keep`/.test(rec.body) && /`change:/.test(rec.body)],
  ["rec-check's first item is Enough facts", firstItem?.[2] === "Enough facts." && firstItem[1] === "0"],
  ["rec-check offers research first as a change: value", /^- `change: [^\n]*research first/m.test(rec.body)],
  ["rec-check greps DECISIONS for earlier words", /DECISIONS\.md[^\n]*earlier words|earlier words[^\n]*DECISIONS\.md/.test(rec.body)],
  ["plan-reviewer is named, on fable, read-only", has(planRev.head, "name", "plan-reviewer") && has(planRev.head, "model", "fable")
    && ["Read", "Grep", "Glob", "Bash"].every((t) => tools(planRev.head).includes(t)) && !tools(planRev.head).some((t) => WRITE_TOOLS.includes(t))],
  ["plan-reviewer has a turn cap of 40 or fewer", Number(planRev.head.match(/^maxTurns:\s*(\d+)/m)?.[1]) <= 40],
  ["plan-reviewer has the 12 checklist items in order", numbered(planRev.body, PLAN_ITEMS)
    && PLAN_ITEMS.map((s) => planRev.body.indexOf(s)).every((p, i, a) => i === 0 || p > a[i - 1])],
  ["plan-reviewer has the do-not-flag list and proves Important findings", /\*\*Do not flag:\*\*/.test(planRev.body) && /Unsure/.test(planRev.body)],
  ["plan-reviewer runs only checks that read or test", /never run one that deploys, pushes or writes outside a scratch folder/i.test(planRev.body)],
  ["plan-reviewer's Bash runs under the planner-readonly hook", /PreToolUse:[\s\S]*matcher: "Bash\|PowerShell"[\s\S]*planner-readonly\.mjs/.test(planRev.head)],
  ["plan-reviewer reads DECISIONS by grep and the map", /never a whole read/.test(planRev.body) && /map\.mjs --near/.test(planRev.body)],
  ["reviewer reads every changed file whole, no fixed small budget", /Read every changed file whole/i.test(rev.body) && !/about 20 tool calls/.test(rev.body)],
  ["reviewer is read-only with a turn cap of 60", !tools(rev.head).some((t) => WRITE_TOOLS.includes(t)) && has(rev.head, "maxTurns", "60")],
  ["reviewer keeps its two headings and re-checks Important findings", /\*\*Against the request:\*\*/.test(rev.body) && /\*\*Quality:\*\*/.test(rev.body)
    && /Re-check each Important finding/i.test(rev.body) && /\*\*Do not flag\*\*/.test(rev.body)],
  ["reviewer reads DECISIONS by grep and the map", /never a whole read/.test(rev.body) && /map\.mjs --near/.test(rev.body)],
];
let fail = 0;
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
console.log(fail ? `${fail} failed` : `all ${checks.length} passed`);
process.exit(fail ? 1 : 0);
