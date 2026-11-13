// Tests for hooks/worker-nudge.mjs. Run: node test-worker-nudge.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
const hook = fileURLToPath(new URL("../hooks/worker-nudge.mjs", import.meta.url));
const sid = "test-" + Date.now();
// The hook only blocks when a worker is installed, so put a stand-in `codex` on PATH. The home folder is
// a made-up one too: the hook reads the worker switches (codex.off, agy.off) and the key file from it.
const fakeBin = mkdtempSync(join(tmpdir(), "worker-nudge-test-"));
writeFileSync(join(fakeBin, "codex"), "");
const PATH = fakeBin + delimiter + (process.env.PATH || "");
const run = (ev, env = {}) => spawnSync(process.execPath, [hook], { input: JSON.stringify({ session_id: sid, ...ev }), env: { ...process.env, PATH, USERPROFILE: fakeBin, HOME: fakeBin, ...env }, encoding: "utf8" }).stdout;
const cases = [
  ["Agent Explore first try: deny", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find" } }, true],
  ["Agent Explore identical retry: allow", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find" } }, false],
  ["Agent Explore new prompt: deny", { tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt: "find other" } }, true],
  ["Agent general-purpose: deny", { tool_name: "Agent", tool_input: { subagent_type: "general-purpose", prompt: "gp" } }, true],
  ["Agent claude (uncapped catch-all): deny", { tool_name: "Agent", tool_input: { subagent_type: "claude", prompt: "judge" } }, true],
  ["Agent worker: allow", { tool_name: "Agent", tool_input: { subagent_type: "worker", prompt: "judge" } }, false],
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
// A made-up home folder, so the worker switches and the key file are the test's own
const home = mkdtempSync(join(tmpdir(), "worker-nudge-test-"));
mkdirSync(join(home, ".claude", "workers"), { recursive: true });
const bin = join(home, "bin"); mkdirSync(bin);
const at = (extra = {}) => ({ USERPROFILE: home, HOME: home, PATH: "", ...extra });
const explore = (prompt) => ({ tool_name: "Agent", tool_input: { subagent_type: "Explore", prompt } });
const expect = (name, ok, out) => { console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${out}`}`); if (!ok) fail++; };

const noWorkers = run(explore("w"), at());
expect("no workers installed: allow", noWorkers === "", noWorkers);
writeFileSync(join(bin, "agy"), ""); writeFileSync(join(bin, "codex"), "");
let out = run(explore("a1"), at({ PATH: bin }));
expect("Codex and Antigravity: ask.mjs for local files and for the web",
  out.includes("Local files and code: ~/.claude/workers/ask.mjs") && out.includes("ask.mjs --web"), out);
writeFileSync(join(home, ".claude", "workers", "codex.off"), "off");
out = run(explore("a2"), at({ PATH: bin }));
expect("codex.off: local files to ask.mjs, the web is not a worker call",
  out.includes("Local files and code: ~/.claude/workers/ask.mjs") && out.includes("Web research: not a worker call"), out);
writeFileSync(join(home, ".claude", "workers", "agy.off"), "off");
expect("codex.off and agy.off: allow", run(explore("a3"), at({ PATH: bin })) === "", "denied");
rmSync(home, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
