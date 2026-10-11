// Tests the helper model lock and the restart hold of hooks/turn-cap.mjs on synthetic transcripts.
// Usage: node tests/test-turn-cap-lock.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/turn-cap.mjs", import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "turn-cap-lock-"));
const ln = (o) => JSON.stringify(o);
const usage = (ctx) => ({ input_tokens: 2, cache_read_input_tokens: ctx, cache_creation_input_tokens: 0, output_tokens: 10 });
const user = (text) => ln({ type: "user", message: { role: "user", content: text } });
let n = 0;
// One assistant request with one tool call, plus its result
const step = (name, input, ctx, model = "claude-opus-5-5") => {
	const id = `s${n++}`;
	return [
		ln({ type: "assistant", uuid: `a${id}`, message: { id: `m${id}`, role: "assistant", model, content: [{ type: "tool_use", id: `t${id}`, name, input }], usage: usage(ctx) } }),
		ln({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${id}`, content: "ok" }] } }),
	];
};
// The last line is the assistant request that makes the call being checked (no result yet)
const call = (name, input, ctx, model) => step(name, input, ctx, model)[0];
const write = (lines) => {
	const f = path.join(TMP, `t${n++}.jsonl`);
	fs.writeFileSync(f, lines.join("\n") + "\n");
	return f;
};
const OFF_TURN = { TURN_CAP_TALK_STEPS: "100000", TURN_CAP_STEPS: "100000", TURN_CAP_TALK_EDITS: "100000", TURN_CAP_CONTEXT_K: "100000000" };
const run = (event, env = {}) => {
	const r = spawnSync("node", [HOOK], { input: JSON.stringify(event), encoding: "utf8", env: { ...process.env, ...env } });
	return r.stdout.includes('"deny"') ? "REFUSED" : "allowed";
};
let failed = 0;
const check = (name, got, want) => {
	const ok = got === want;
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}: ${got}${ok ? "" : ` (wanted ${want})`}`);
};
const flagOf = (id) => path.join(os.tmpdir(), `turn-cap-restart-${id}.flag`);
const SPAWN = "mcp__nimbalyst-host__spawn_session";
const REASON = "OPUS BECAUSE: judging whether the 3D model animation looks right";

// ---- Fix A: helper model lock (a short sonnet session, 30k context) ----
{
	const mk = (name, input, model) => ({ tool_name: name, tool_input: input, transcript_path: write([user("hi"), call(name, input, 30000, model)]), session_id: `lock-${n}` });
	const agent = (input, env) => run(mk("Agent", { subagent_type: "worker", prompt: "do a thing", ...input }), env);
	check("Agent model opus: refused", agent({ model: "opus" }), "REFUSED");
	check("Agent model fable: refused", agent({ model: "fable" }), "REFUSED");
	check("Agent model claude-opus-5-5: refused", agent({ model: "claude-opus-5-5" }), "REFUSED");
	check("Agent planner with model opus: allowed", agent({ subagent_type: "planner", model: "opus" }), "allowed");
	check("Agent opus with OPUS BECAUSE line: allowed", agent({ model: "opus", prompt: `Judge the clip.\n${REASON}\nThen report.` }), "allowed");
	check("Agent opus with a short reason: refused", agent({ model: "opus", prompt: "OPUS BECAUSE: hard" }), "REFUSED");
	check("Agent opus, OPUS BECAUSE not at line start: refused", agent({ model: "opus", prompt: `note: ${REASON}` }), "REFUSED");
	check("Agent model haiku: allowed", agent({ model: "haiku" }), "allowed");
	check("Agent model sonnet: allowed", agent({ model: "sonnet" }), "allowed");
	check("Agent no model: allowed", agent({}), "allowed");
	check("Agent model opus, TURN_CAP_MODEL_LOCK=off: allowed", agent({ model: "opus" }, { TURN_CAP_MODEL_LOCK: "off" }), "allowed");
	check("Agent model opus, TURN_CAP=off: allowed", agent({ model: "opus" }, { TURN_CAP: "off" }), "allowed");
	const sp = (input, env, model) => run(mk(SPAWN, { prompt: "CHILD JOB: x", model: "claude-code:sonnet", effortLevel: "medium", ...input }, model), env);
	check("spawn_session model claude-code:opus: refused", sp({ model: "claude-code:opus" }), "REFUSED");
	check("spawn_session model claude-code:fable: refused", sp({ model: "claude-code:fable" }), "REFUSED");
	check("spawn_session model opus with OPUS BECAUSE: allowed", sp({ model: "claude-code:opus", prompt: `CHILD JOB: x\n${REASON}` }), "allowed");
	check("spawn_session no model: refused (the app default is Opus)", sp({ model: undefined }), "REFUSED");
	check("spawn_session claude-code:sonnet medium: allowed", sp({}), "allowed");
	check("spawn_session no model with OPUS BECAUSE: allowed", sp({ model: undefined, prompt: `CHILD JOB: x\n${REASON}` }), "allowed");
	check("spawn_session no model, off switch: allowed", sp({ model: undefined }, { TURN_CAP_MODEL_LOCK: "off" }), "allowed");
	check("spawn_session effort high: refused", sp({ effortLevel: "high" }), "REFUSED");
	check("spawn_session effort max: refused", sp({ effortLevel: "max" }), "REFUSED");
	check("spawn_session effort high with OPUS BECAUSE: allowed", sp({ effortLevel: "high", prompt: `CHILD JOB: x\n${REASON}` }), "allowed");
	check("spawn_session effort low: allowed", sp({ effortLevel: "low" }), "allowed");
	check("Agent worker has no effort rule: allowed", agent({ effortLevel: "high" }), "allowed");
	check("spawn_session model haiku: allowed", sp({ model: "claude-code:haiku" }), "allowed");
	check("spawn_session inheritModel on an opus session: refused", sp({ model: undefined, inheritModel: true }, {}, "claude-opus-5-5"), "REFUSED");
	check("spawn_session inheritModel on a fable session: refused", sp({ model: undefined, inheritModel: true }, {}, "claude-fable-5-1"), "REFUSED");
	check("handoff spawn (isolated + inheritModel) on an opus session: allowed", sp({ model: undefined, inheritModel: true, isolated: true }, {}, "claude-opus-5-5"), "allowed");
	check("spawn_session inheritModel on a sonnet session: allowed", sp({ model: undefined, inheritModel: true }, {}, "claude-sonnet-5-5"), "allowed");
	check("spawn_session inheritModel, explicit haiku wins: allowed", sp({ inheritModel: true, model: "claude-code:haiku" }, {}, "claude-opus-5-5"), "allowed");
	check("spawn_session inheritModel on opus, off switch: allowed", sp({ model: undefined, inheritModel: true }, { TURN_CAP_MODEL_LOCK: "off" }, "claude-opus-5-5"), "allowed");
	// A refusal says what to do
	const r = spawnSync("node", [HOOK], { input: JSON.stringify(mk("Agent", { subagent_type: "worker", model: "opus", prompt: "x" })), encoding: "utf8" });
	check("refusal text names OPUS BECAUSE, haiku and leaving the model out", ["OPUS BECAUSE:", "haiku", "Leave the model out"].every((s) => r.stdout.includes(s)) ? "yes" : "no", "yes");
	const rs = spawnSync("node", [HOOK], { input: JSON.stringify(mk(SPAWN, { prompt: "CHILD JOB: x", model: "claude-code:opus", effortLevel: "medium" })), encoding: "utf8" });
	check("spawn refusal names claude-code:sonnet and medium, not leaving the model out", ["OPUS BECAUSE:", "claude-code:sonnet", "medium"].every((s) => rs.stdout.includes(s)) && !rs.stdout.includes("Leave the model out") ? "yes" : "no", "yes");
	// A subagent is left alone
	check("call from a subagent (agent_id): allowed", run({ ...mk("Agent", { model: "opus", prompt: "x" }), agent_id: "sub1" }), "allowed");
}

// ---- Fix B: restart hold ----
{
	const sid = `hold-${process.pid}`;
	const SESSION_ONLY = OFF_TURN;
	try { fs.rmSync(flagOf(sid), { force: true }); } catch { /* none */ }
	// Message 1: 16 steps at 150k, the 16th being the call under test: the session rule refuses and sets the flag
	const first = [user("keep going")];
	for (let i = 0; i < 15; i++) first.push(...step("Grep", { pattern: "x" }, 150000));
	const fileA = write([...first, call("Bash", { command: "ls" }, 150000)]);
	check("message 1, 16th big step: Bash refused by the session rule", run({ tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: fileA, session_id: sid }, SESSION_ONLY), "REFUSED");
	check("the restart refusal wrote the flag file", fs.existsSync(flagOf(sid)) ? "yes" : "no", "yes");
	// Message 2 (a new user message): the hold applies
	const msg2 = (calls) => {
		const lines = [...first, user("one more question")];
		for (const c of calls) lines.push(...step(c.name, c.input, 150000));
		return lines;
	};
	const ev = (tool, input, calls, env, session = sid) => run({ tool_name: tool, tool_input: input, transcript_path: write([...msg2(calls), call(tool, input, 150000)]), session_id: session }, env ?? SESSION_ONLY);
	const reads = (k) => Array.from({ length: k }, () => ({ name: "Read", input: { file_path: "C:/x/a.md" } }));
	check("message 2: Bash refused", ev("Bash", { command: "ls" }, []), "REFUSED");
	check("message 2: Edit of a code file refused", ev("Edit", { file_path: "C:/x/a.gd" }, []), "REFUSED");
	check("message 2: 1st Read allowed", ev("Read", { file_path: "C:/x/a.md" }, []), "allowed");
	check("message 2: 5th Read allowed", ev("Read", { file_path: "C:/x/a.md" }, reads(4)), "allowed");
	check("message 2: 6th Read refused", ev("Read", { file_path: "C:/x/a.md" }, reads(5)), "REFUSED");
	check("message 2: 5th Grep after 4 Reads allowed", ev("Grep", { pattern: "x" }, reads(4)), "allowed");
	check("message 2: Write to ~/.claude/handoffs/ allowed", ev("Write", { file_path: "C:/Users/someone/.claude/handoffs/x.md" }, reads(8)), "allowed");
	check("message 2: Bash handoff-brief.mjs allowed", ev("Bash", { command: "node ~/.claude/skills/handoff/handoff-brief.mjs --summary x.md\n\n# WHAT THIS DOES: brief" }, reads(8)), "allowed");
	check("message 2: spawn_session allowed", ev(SPAWN, { prompt: "CHILD JOB: x", model: "claude-code:sonnet", effortLevel: "medium" }, reads(8)), "allowed");
	check("message 2: AskUserQuestion allowed", ev("AskUserQuestion", {}, reads(8)), "allowed");
	check("message 2: commit proposal allowed", ev("mcp__nimbalyst__developer_git_commit_proposal", {}, reads(8)), "allowed");
	check("message 2: Bash with TURN_CAP_RESTART_HOLD=off: still the session rule", ev("Bash", { command: "ls" }, [], { ...SESSION_ONLY, TURN_CAP_RESTART_HOLD: "off" }), "REFUSED");
	// The hold on its own: a session with the flag but fewer than 15 big steps (the session rule alone would allow)
	const fresh = `hold-only-${process.pid}`;
	fs.writeFileSync(flagOf(fresh), "test");
	const few = write([user("q"), ...step("Grep", { pattern: "x" }, 150000), call("Bash", { command: "ls" }, 150000)]);
	check("flag set, 1 big step: Bash refused by the hold", run({ tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: few, session_id: fresh }, SESSION_ONLY), "REFUSED");
	check("flag set, off switch: Bash allowed", run({ tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: few, session_id: fresh }, { ...SESSION_ONLY, TURN_CAP_RESTART_HOLD: "off" }), "allowed");
	check("no flag for the session: Bash allowed", run({ tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: few, session_id: `none-${process.pid}` }, SESSION_ONLY), "allowed");
	check("no session id: Bash allowed (nothing new)", run({ tool_name: "Bash", tool_input: { command: "ls" }, transcript_path: few }, SESSION_ONLY), "allowed");
	fs.rmSync(flagOf(fresh), { force: true });
	fs.rmSync(flagOf(sid), { force: true });
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `FAIL: ${failed} case(s)` : "all cases passed");
process.exit(failed ? 1 : 0);
