// Tests for hooks/budget-gate.mjs. Run: node test-budget-gate.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const hook = fileURLToPath(new URL("../hooks/budget-gate.mjs", import.meta.url));
const { statedBudget } = await import(new URL("../hooks/budget-gate.mjs", import.meta.url));
const run = (ev, env = {}) => spawnSync(process.execPath, [hook], { input: ev === null ? "not json" : JSON.stringify(ev), env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
const ev = (type, prompt, tool = "Agent") => ({ tool_name: tool, tool_input: { subagent_type: type, prompt } });
let fail = 0;
const check = (name, ok) => { if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
check("reads **Budget:** 55 tool calls", statedBudget("**Budget:** 55 tool calls.") === 55);
check("reads Budget: about 70", statedBudget("Budget: about 70 tool calls") === 70);
check("no number: null", statedBudget("no number here") === null);
check("reads Budget: around 70", statedBudget("Budget: around 70") === 70);
check("reads **Budget (tool calls):** 70", statedBudget("**Budget (tool calls):** 70") === 70);
check("range 40-60 counts as 60", statedBudget("Budget: 40-60 tool calls") === 60);
check("a pasted old budget does not count over the brief's own line", statedBudget("S6 used 115 calls on a budget of 70.\nNew step.\nBudget: 30") === 30);
check("a context budget of 150k is not a call budget", statedBudget("Keep the context budget of 150k in mind.") === null);
const cases = [
  ["worker over 50: deny", ev("worker", "do S6. Budget: 70 tool calls."), true],
  ["worker-full 51: deny", ev("worker-full", "Budget: 51"), true],
  ["Task tool, worker 60: deny", ev("worker", "Budget: 60", "Task"), true],
  ["worker 50: allow", ev("worker", "Budget: 50 tool calls"), false],
  ["worker with no budget line: allow", ev("worker", "a one-off with no budget line"), false],
  ["reviewer 90: allow", ev("reviewer", "Budget: 90"), false],
  ["not an agent call: allow", ev("worker", "Budget: 90", "Write"), false],
  ["bad input: allow", null, false],
];
for (const [name, e, want] of cases) check(name, run(e).includes('"deny"') === want);
check("BUDGET_GATE=off: allow", run(ev("worker", "Budget: 70"), { BUDGET_GATE: "off" }) === "");
check("deny text says split in two", /Split it into two steps/.test(run(ev("worker", "Budget: 70"))));
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
