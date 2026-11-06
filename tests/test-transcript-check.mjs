// Tests for hooks/transcript-check.mjs. Run: node test-transcript-check.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HOOK = fileURLToPath(new URL("../hooks/transcript-check.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "transcript-check-"));
const STATE = join(dir, "state.json");
let n = 0;
const entry = (o) => JSON.stringify({ version: "9.9.9", timestamp: "2026-11-02T10:00:00.000Z", ...o });
const USAGE = { input_tokens: 3, cache_read_input_tokens: 41000, cache_creation_input_tokens: 900, output_tokens: 120 };
const reply = (content) => entry({ type: "assistant", isSidechain: false, message: { model: "claude-opus-4-8", content, usage: USAGE } });
const GOOD = [
  reply([{ type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } }]),
  entry({ type: "user", isSidechain: false, message: { content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] } }),
  entry({ type: "system", subtype: "compact_boundary", compactMetadata: { trigger: "auto", preTokens: 190000, postTokens: 12000 } }),
  entry({ type: "user", isSidechain: false, promptSource: "system", origin: { kind: "task-notification" }, message: { content: "<task-notification>\n<task-id>a1</task-id>\n</task-notification>" } }),
  reply([{ type: "tool_use", id: "t2", name: "Agent", input: { description: "x", prompt: "y" } }]),
  entry({ type: "user", isSidechain: false, toolUseResult: { status: "async_launched", agentId: "a2" }, message: { content: [{ type: "tool_result", tool_use_id: "t2", content: [{ type: "text", text: "Async agent launched successfully.\nagentId: a2" }] }] } }),
];
// Each case gets its own folder of transcripts: an older one to look at and the session's own. `helpers`: the
// .meta.json texts of the older one's helpers
const run = (lines, env = {}, helpers = []) => {
  const folder = mkdtempSync(join(dir, "p"));
  const older = join(folder, `old${++n}.jsonl`), current = join(folder, "now.jsonl");
  writeFileSync(older, lines.join("\n") + "\n");
  if (helpers.length) {
    const sub = join(folder, `old${n}`, "subagents");
    mkdirSync(sub, { recursive: true });
    helpers.forEach((meta, i) => { writeFileSync(join(sub, `agent-a${i}.jsonl`), ""); writeFileSync(join(sub, `agent-a${i}.meta.json`), meta); });
  }
  writeFileSync(current, "");
  utimesSync(older, new Date(Date.now() - 60000), new Date(Date.now() - 60000));
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: "SessionStart", transcript_path: current }), env: { ...process.env, TRANSCRIPT_CHECK: "", TRANSCRIPT_CHECK_STATE: STATE, HOOK_CRASH_ALARM: "off", ...env }, encoding: "utf8" }).stdout;
};
let fail = 0, total = 0;
const report = (ok, name) => { total++; if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

report(run(GOOD, {}, [JSON.stringify({ agentType: "worker" })]) === "" && existsSync(STATE), "the format as it is today: silent, and this version is remembered");
rmSync(STATE, { force: true });
const bare = GOOD.map((l) => l.replace(/"isSidechain":false,/g, "").replace(/"model":"claude-opus-4-8",/g, "").replace(/"postTokens":12000/, '"post":12000').replace(/,"origin":\{"kind":"task-notification"\}/, "").replace(/,"agentId":"a2"/, ""));
const said = run(bare, {}, [JSON.stringify({ type: "worker" })]);
report(["isSidechain", "message.model", "compactMetadata.postTokens", "origin.kind", "toolUseResult.agentId", "agentType"].every((f) => said.includes(f)) && !said.includes("token counts"), "each field the transcript lib reads is named when it is gone");
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

const first = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ hook_event_name: "SessionStart", transcript_path: join(dir, "no-such-project", "now.jsonl") }), env: { ...process.env, TRANSCRIPT_CHECK: "", TRANSCRIPT_CHECK_STATE: join(dir, "fresh-state.json"), HOOK_CRASH_ALARM: "off", HOOK_ERRORS_LOG: join(dir, "errors.log") }, encoding: "utf8" });
report(first.status === 0 && first.stdout === "" && first.stderr === "" && !existsSync(join(dir, "errors.log")), "a project's first session (no transcript folder yet) is silent, not a crash");

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} of ${total} failed` : `all ${total} passed`);
process.exit(fail ? 1 : 0);
