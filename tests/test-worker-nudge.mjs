// Tests for hooks/worker-nudge.mjs. Run: node test-worker-nudge.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
const hook = fileURLToPath(new URL("../hooks/worker-nudge.mjs", import.meta.url));
const sid = "test-" + Date.now();
const run = (ev, env = {}) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: sid, ...ev }), env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
const cases = [
  ["Agent Explore first try: deny", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find" } }, true],
  ["Agent Explore identical retry: still deny", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find" } }, true],
  ["Agent general-purpose identical retry: still deny", { tool_name: "Agent", tool_input: { subagent_type: "general-purpose", prompt: "gp" } }, true],
  ["Agent Explore new prompt: deny", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find other" } }, true],
  ["Agent general-purpose: deny", { tool_name: "Agent", tool_input: { subagent_type: "general-purpose", prompt: "gp" } }, true],
  ["Agent claude (uncapped catch-all): deny", { tool_name: "Agent", tool_input: { subagent_type: "claude", prompt: "judge" } }, true],
  ["Agent worker: allow", { tool_name: "Agent", tool_input: { subagent_type: "worker", prompt: "judge" } }, false],
  ["Task Explore: deny",{ tool_name: "Task", tool_input: { subagent_type: "Explore", prompt: "t" } }, true],
  ["WebSearch: allow", { tool_name: "WebSearch", tool_input: { query: "x" } }, false],
  ["WebFetch: allow", { tool_name: "WebFetch", tool_input: { url: "https://a.b" } }, false],
  ["Agent no type: deny", { tool_name: "Agent", tool_input: { prompt: "find2" } }, true],
  ["Agent research: deny", { tool_name: "Agent", tool_input: { subagent_type: "voltagent-research:search-specialist", prompt: "p" } }, true],
  ["Agent frontend-developer: allow", { tool_name: "Agent", tool_input: { subagent_type: "voltagent-core-dev:frontend-developer", prompt: "build" } }, false],
  ["Read: allow", { tool_name: "Read", tool_input: { file_path: "a" } }, false],
  ["Grep: allow", { tool_name: "Grep", tool_input: { pattern: "a" } }, false],
  ["bad input: allow", null, false],
];
let fail = 0;
for (const [name, ev, want] of cases) {
  const out = ev ? run(ev) : spawnSync(process.execPath, [hook], { input: "not json", encoding: "utf8" }).stdout;
  const ok = out.includes('"deny"') === want;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
const off = run({ tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "z" } }, { WORKER_NUDGE: "off" });
console.log(`${off === "" ? "ok  " : "FAIL"} WORKER_NUDGE=off: allow`); if (off !== "") fail++;
const denied = run({ tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "w" } });
const points = denied.includes('"deny"') && denied.includes('subagent_type \\"worker\\"') && !denied.includes("~/.claude/workers/");
console.log(`${points ? "ok  " : "FAIL"} deny text points to the worker subagent, no outside worker command`); if (!points) fail++;
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
