// Tests for hooks/loop-warn.mjs. Run: node tests/test-loop-warn.mjs
// The hook keeps its state under the temp folder; the tests point TEMP at a throwaway folder.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/loop-warn.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "loop-warn-test-"));
const baseEnv = { ...process.env, TEMP: tmp, TMP: tmp, TMPDIR: tmp, LOOP_WARN: "", LOOP_WARN_COUNT: "" };

// Runs one call through the hook; returns "warn", "silent", or the raw output when it is something else
function call(session, tool, input, env = {}, extra = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ session_id: session, tool_name: tool, tool_input: input, ...extra }),
    env: { ...baseEnv, ...env },
  });
  const out = r.stdout.toString();
  if (r.status !== 0) return `exit ${r.status}`;
  if (!out) return "silent";
  const j = JSON.parse(out).hookSpecificOutput;
  if (j.permissionDecision) return `decision ${j.permissionDecision}`; // it must never block
  return j.hookEventName === "PreToolUse" && j.additionalContext.includes("[loop-warn]") ? "warn" : out;
}
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i)).join(",");

let fails = 0;
const check = (name, got, want) => {
  const ok = got === want;
  if (!ok) fails++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${got}, want ${want}`}`);
};
const cmd = { command: "npm test" };

check("4 identical calls are silent, the 5th warns",
  many(5, () => call("s1", "Bash", cmd)), "silent,silent,silent,silent,warn");
check("the next 4 are silent, then it warns again",
  many(5, () => call("s1", "Bash", cmd)), "silent,silent,silent,silent,warn");
check("10 different inputs are silent",
  many(10, (i) => call("s2", "Bash", { command: `echo ${i}` })), many(10, () => "silent"));
check("same input, different tool is a different call",
  many(4, () => call("s3", "Read", { file_path: "a" })) + "," + call("s3", "Grep", { file_path: "a" }), "silent,silent,silent,silent,silent");
check("A,B,A,B... warns on the 5th A",
  many(9, (i) => call("s4", "Bash", { command: i % 2 ? "b" : "a" })), "silent,silent,silent,silent,silent,silent,silent,silent,warn");
check("repeats spread over more than 20 calls are silent",
  many(5, (i) => many(6, (k) => call("s5", "Bash", { command: k ? `other ${i}-${k}` : "same" }))), many(30, () => "silent"));
check("sessions don't share a count",
  many(4, () => call("s6", "Bash", cmd)) + "," + call("s7", "Bash", cmd), "silent,silent,silent,silent,silent");
check("a subagent has its own count",
  many(4, () => call("s8", "Bash", cmd)) + "," + call("s8", "Bash", cmd, {}, { agent_id: "sub1" }), "silent,silent,silent,silent,silent");
check("LOOP_WARN=off is silent",
  many(6, () => call("s9", "Bash", cmd, { LOOP_WARN: "off" })), many(6, () => "silent"));
check("LOOP_WARN_COUNT=3 warns on the 3rd",
  many(3, () => call("s10", "Bash", cmd, { LOOP_WARN_COUNT: "3" })), "silent,silent,warn");
// Browser tools: the same script on different pages is not a loop; on the same page it is
const NAV = "mcp__nimbalyst-browser__browser_navigate", EVAL = "mcp__nimbalyst-browser__browser_evaluate";
const script = { sessionId: "b1", script: "document.title" };
check("the same browser script on 6 different pages is silent",
  many(6, (i) => call("s12", NAV, { sessionId: "b1", url: `https://example.org/p/${i}` }) + "," + call("s12", EVAL, script)), many(12, () => "silent"));
check("the same browser script 5 times on one page warns",
  call("s13", NAV, { sessionId: "b1", url: "https://example.org/p/1" }) + "," + many(5, () => call("s13", EVAL, script)), "silent,silent,silent,silent,silent,warn");
check("two browser sessions keep their own page",
  call("s14", NAV, { sessionId: "b1", url: "https://example.org/a" }) + "," + call("s14", NAV, { sessionId: "b2", url: "https://example.org/b" }) + "," +
  many(5, () => call("s14", EVAL, script)), "silent,silent,silent,silent,silent,silent,warn");
check("a session opened without an id is found by its last page",
  many(5, (i) => call("s15", "mcp__nimbalyst-browser__browser_open_session", { url: `https://example.org/o/${i}` }) + "," + call("s15", EVAL, { sessionId: "agent-browser:1", script: "1" })), many(10, () => "silent"));
check("bad input is ignored",
  spawnSync(process.execPath, [HOOK], { input: "not json", env: baseEnv }).status, 0);
fs.writeFileSync(path.join(tmp, "loop-warn", "s11.json"), "{broken");
check("a broken state file is ignored", call("s11", "Bash", cmd), "silent");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
