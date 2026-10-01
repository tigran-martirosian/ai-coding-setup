// Tests for hooks/worker-nudge.mjs. Run: node test-worker-nudge.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
const hook = fileURLToPath(new URL("../hooks/worker-nudge.mjs", import.meta.url));
const sid = "test-" + Date.now();
// The hook only blocks when a worker is installed, so put a stand-in `codex` on PATH.
const fakeBin = mkdtempSync(join(tmpdir(), "worker-nudge-test-"));
writeFileSync(join(fakeBin, "codex"), "");
const PATH = fakeBin + delimiter + (process.env.PATH || "");
const run = (ev, env = {}) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: sid, ...ev }), env: { ...process.env, PATH, ...env }, encoding: "utf8" }).stdout;
const cases = [
  ["Agent Explore first try: deny", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find" } }, true],
  ["Agent Explore identical retry: allow", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find" } }, false],
  ["Agent Explore new prompt: deny", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find other" } }, true],
  ["Agent general-purpose: deny", { tool_name: "Agent", tool_input: { subagent_type: "general-purpose", prompt: "gp" } }, true],
  ["Task Explore: deny", { tool_name: "Task", tool_input: { subagent_type: "Explore", prompt: "t" } }, true],
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
const noWorkers = run({ tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "w" } }, { PATH: "" });
console.log(`${noWorkers === "" ? "ok  " : "FAIL"} no workers installed: allow`); if (noWorkers !== "") fail++;
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
