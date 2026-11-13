// Tests for hooks/transcript-check.mjs. Run: node test-transcript-check.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HOOK = fileURLToPath(new URL("../hooks/transcript-check.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "transcript-check-"));
const STATE = join(dir, "state.json");
let n = 0;
const entry = (o) => JSON.stringify({ version: "9.9.9", timestamp: "2026-11-02T10:00:00.000Z", ...o });
const GOOD = [
  entry({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }] } }),
  entry({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
];
// Each case gets its own folder of transcripts: an older one to look at and the session's own
const run = (lines, env = {}) => {
  const folder = mkdtempSync(join(dir, "p"));
  const older = join(folder, `old${++n}.jsonl`), current = join(folder, "now.jsonl");
  writeFileSync(older, lines.join("\n") + "\n");
  writeFileSync(current, "");
  utimesSync(older, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: "SessionStart", transcript_path: current }), env: { ...process.env, TRANSCRIPT_CHECK: "", TRANSCRIPT_CHECK_STATE: STATE, HOOK_CRASH_ALARM: "off", ...env }, encoding: "utf8" }).stdout;
};
let fail = 0, total = 0;
const report = (ok, name) => { total++; if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

report(run(GOOD) === "" && existsSync(STATE), "the format as it is today: silent, and this version is remembered");
const renamed = [GOOD[0].replace('"tool_use"', '"call"'), entry({ type: "assistant", message: { content: [{ type: "tool_use", id: "t2", name: "Bash" }] } })];
rmSync(STATE, { force: true });
report(/input on tool_use/.test(run(renamed)), "a tool call with a missing field is named");
const noResults = [GOOD[0], GOOD[0]];
report(/tool_result blocks/.test(run(noResults)), "tool results gone is said out loud");
const out = run(noResults);
report(/"systemMessage"/.test(out) && /additionalContext/.test(out), "it tells both the user and the session");
report(run(["not json at all", "still not"]).includes("any readable line"), "a file nothing can read is said out loud");
report(run([entry({ type: "user", message: { content: "hello" } })]) === "", "a chat with no tool call shows nothing either way");
report(run(["x".repeat(600 * 1024)]) === "", "one line longer than the tail shows nothing either way");
report(run([GOOD[0]]) === "", "a run killed on its first tool call shows nothing either way");
report(run(noResults, { TRANSCRIPT_CHECK: "off" }) === "", "TRANSCRIPT_CHECK=off disables it");
writeFileSync(STATE, JSON.stringify({ ok: "9.9.9" }));
report(run(noResults) === "", "a version already checked is not read again");

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} of ${total} failed` : `all ${total} passed`);
process.exit(fail ? 1 : 0);
