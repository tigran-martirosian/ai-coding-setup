// Tests for turn-cap.mjs: one helper at a time, helpers stopped near 100k. Inputs are built in Node.
// Usage: node tests/test-turn-cap-helpers.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/turn-cap.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tc-helpers-"));
const run = Date.now().toString(36);
let n = 0;
let failed = 0;
const SID = "11111111-2222-3333-4444-555555555555";
const iso = (minAgo) => new Date(Date.now() - minAgo * 60000).toISOString();

// transcript line builders
let seq = 0;
const user = (text, minAgo = 0) => ({ type: "user", timestamp: iso(minAgo), message: { role: "user", content: text } });
const asst = (content, ctx = 20000, minAgo = 0) => ({
	type: "assistant", timestamp: iso(minAgo),
	message: { id: `msg_${run}_${seq++}`, model: "claude-sonnet-5-5", usage: { input_tokens: 1, cache_read_input_tokens: ctx, cache_creation_input_tokens: 0 }, content },
});
const use = (id, name, input) => ({ type: "tool_use", id, name, input });
const result = (id, text, toolUseResult) => ({
	type: "user", timestamp: iso(0), ...(toolUseResult ? { toolUseResult } : {}),
	message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] },
});
const bgAgent = (id, agentId) => result(id, `Async agent launched successfully.\nagentId: ${agentId} (internal)`, { isAsync: true, status: "async_launched", agentId });
const spawned = (id, sid) => result(id, JSON.stringify({ sessionId: sid, notifyOnComplete: true }));
const notif = (taskId) => user(`<task-notification>\n<task-id>${taskId}</task-id>\n<status>completed</status>\n</task-notification>`);
const childDone = (sid) => user(`[Child Session Update]\nSession: "x" (${sid})\nStatus: idle\nEvent: session:completed\n`);

function transcript(name, lines) {
	const f = path.join(dir, `${name}.jsonl`);
	fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
	return f;
}
function call(file, tool, input, env = {}, extra = {}) {
	const event = { session_id: `s-${run}-${n++}`, transcript_path: file, tool_name: tool, tool_input: input, ...extra };
	const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), encoding: "utf8", env: { ...process.env, ...env } });
	const out = r.stdout.trim();
	return { event, denied: out.includes('"deny"'), text: out };
}
function check(name, ok, detail = "") {
	if (!ok) failed++;
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : "  " + detail}`);
}

const askAgent = { description: "d2", subagent_type: "worker", prompt: "second job" };
const spawn2 = { title: "t2", prompt: "CHILD JOB: second", model: "claude-code:sonnet", effortLevel: "medium", notifyOnComplete: true };
const first = (extra = []) => [user("do the thing"), asst([use("t1", "Agent", { description: "d1", subagent_type: "worker", prompt: "first job" })]), bgAgent("t1", "agent111"), ...extra];
const withCurrent = (lines, name = "Agent", input = askAgent) => [...lines, asst([use("cur", name, input)])];

// ---- Part 1: one helper at a time
let t = call(transcript("a1", withCurrent(first())), "Agent", askAgent);
check("second Agent launch refused while the first runs", t.denied && /still running/.test(t.text), t.text);
check("refusal says wait for the report", /report/.test(t.text) && /side by side/.test(t.text));

t = call(transcript("a2", withCurrent(first([notif("agent111")]))), "Agent", askAgent);
check("allowed after the task-notification", !t.denied, t.text);

// an end notice that arrives while the session is working is a queue-operation or an attachment line
const queued = (text) => ({ type: "queue-operation", operation: "enqueue", timestamp: iso(0), content: text });
const attached = (text) => ({ type: "attachment", isSidechain: false, timestamp: iso(0), attachment: { type: "queued_command", prompt: text } });
const notifText = (taskId) => notif(taskId).message.content;
t = call(transcript("a3", withCurrent(first([queued(notifText("agent111"))]))), "Agent", askAgent);
check("allowed after a task-notification queued as a queue-operation line", !t.denied, t.text);
t = call(transcript("a4", withCurrent(first([attached(notifText("agent111"))]))), "Agent", askAgent);
check("allowed after a task-notification in an attachment line", !t.denied, t.text);
t = call(transcript("a5", withCurrent(first([attached(notifText("someoneelse"))]))), "Agent", askAgent);
check("attachment for another task does not free it", t.denied, t.text);

t = call(transcript("a2b", withCurrent(first([notif("someoneelse")]))), "Agent", askAgent);
check("notification of another task does not free it", t.denied, t.text);

const sp = [user("go"), asst([use("s1", "mcp__nimbalyst-host__spawn_session", { title: "t", prompt: "CHILD JOB: x", notifyOnComplete: true })]), spawned("s1", "aaaaaaaa-1111-2222-3333-444444444444")];
t = call(transcript("b1", withCurrent(sp, "mcp__nimbalyst-host__spawn_session", spawn2)), "mcp__nimbalyst-host__spawn_session", spawn2);
check("spawn_session refused while the earlier child session runs", t.denied, t.text);
t = call(transcript("b1c", withCurrent(sp)), "Agent", askAgent);
check("an Agent launch is refused while a child session runs", t.denied, t.text);

t = call(transcript("b2", withCurrent([...sp, childDone("aaaaaaaa-1111-2222-3333-444444444444")], "mcp__nimbalyst-host__spawn_session", spawn2)), "mcp__nimbalyst-host__spawn_session", spawn2);
check("allowed after the child-session completed message", !t.denied, t.text);
t = call(transcript("b3", withCurrent([...sp, attached(childDone("aaaaaaaa-1111-2222-3333-444444444444").message.content)], "mcp__nimbalyst-host__spawn_session", spawn2)), "mcp__nimbalyst-host__spawn_session", spawn2);
check("allowed after the child-session completed message in an attachment line", !t.denied, t.text);

const old = [user("go", 30), asst([use("t1", "Agent", { description: "d1", subagent_type: "worker", prompt: "first job" })], 20000, 25), bgAgent("t1", "agent111")];
t = call(transcript("c1", withCurrent(old)), "Agent", askAgent);
check("allowed 20 minutes after the launch", !t.denied, t.text);
t = call(transcript("c2", withCurrent(old)), "Agent", askAgent, { TURN_CAP_HELPER_MINUTES: "40" });
check("TURN_CAP_HELPER_MINUTES=40 keeps it blocking", t.denied, t.text);

const fg = [user("go"), asst([use("f1", "Agent", { description: "fg", prompt: "x" })]), result("f1", "The agent finished. Report: done", { status: "completed", agentId: "fg1" })];
t = call(transcript("d1", withCurrent(fg)), "Agent", askAgent);
check("foreground Agent with a result does not block", !t.denied, t.text);

const two = [user("go"),
	asst([use("t1", "Agent", { description: "d1", prompt: "first" }), use("t2", "Agent", { description: "d2", prompt: "second" })]),
];
t = call(transcript("e1", two), "Agent", { description: "d2", prompt: "second" }, {}, { tool_use_id: "t2" });
check("same message: second launch refused (first line is in the transcript)", t.denied, t.text);
t = call(transcript("e2", two), "Agent", { description: "d1", prompt: "first" }, {}, { tool_use_id: "t1" });
check("same message: first launch allowed", !t.denied, t.text);
t = call(transcript("e3", two), "Agent", { description: "d2", prompt: "second" });
check("same message without tool_use_id: matched by name and input, second refused", t.denied, t.text);

t = call(transcript("f1", withCurrent(first())), "Agent", askAgent, { TURN_CAP_HELPERS: "2" });
check("TURN_CAP_HELPERS=2 allows a second helper", !t.denied, t.text);
const three = first([asst([use("t3", "Agent", { description: "d3", prompt: "third" })]), bgAgent("t3", "agent333")]);
t = call(transcript("f2", withCurrent(three)), "Agent", askAgent, { TURN_CAP_HELPERS: "2" });
check("TURN_CAP_HELPERS=2 refuses a third", t.denied, t.text);
t = call(transcript("f3", withCurrent(first())), "Agent", askAgent, { TURN_CAP_HELPERS: "off" });
check("TURN_CAP_HELPERS=off disables it", !t.denied, t.text);
t = call(transcript("f4", withCurrent(first())), "Agent", askAgent, { TURN_CAP: "off" });
check("TURN_CAP=off disables it", !t.denied, t.text);
t = call(transcript("f5", withCurrent(first(), "Read", { file_path: "x" })), "Read", { file_path: "x" });
check("a non-launch tool is not touched", !t.denied, t.text);
t = call(path.join(dir, "missing.jsonl"), "Agent", askAgent);
check("unreadable transcript fails open", !t.denied, t.text);

// ---- Part 2: child sessions stopped near 100k
const childLines = (ctx) => [user("CHILD JOB: do a small thing"), asst([use("r1", "Read", { file_path: "a" })], ctx), result("r1", "ok"), asst([use("cur", "Bash", { command: "ls" })], ctx)];
const seqCalls = (file, tool, input, count, env = {}, extra = {}) => {
	const sid = `s-${run}-seq${n++}`;
	return Array.from({ length: count }, () => {
		const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ session_id: sid, transcript_path: file, tool_name: tool, tool_input: input, ...extra }), encoding: "utf8", env: { ...process.env, ...env } });
		return r.stdout.includes('"deny"') ? r.stdout : null;
	});
};
let r = seqCalls(transcript("g1", childLines(90000)), "Bash", { command: "ls" }, 8);
check("child under 100k is untouched (8 steps)", r.every((x) => x === null), String(r));
r = seqCalls(transcript("g2", childLines(120000)), "Bash", { command: "ls" }, 7);
check("child over 100k: 5 steps allowed, then refused", r.slice(0, 5).every((x) => x === null) && r[5] && r[6], String(r));
check("refusal asks for a report with files", /done.*left.*files/s.test(r[5] ?? ""), r[5]);
r = seqCalls(transcript("g3", childLines(120000)), "ToolSearch", { query: "x" }, 8);
check("always-allowed tools still pass over 100k, uncounted", r.every((x) => x === null), String(r));
r = seqCalls(transcript("g4", childLines(120000)), "Bash", { command: "ls" }, 7, { TURN_CAP_CHILD_K: "off" });
check("TURN_CAP_CHILD_K=off disables it", r.every((x) => x === null), String(r));
r = seqCalls(transcript("g5", childLines(120000)), "Bash", { command: "ls" }, 7, { TURN_CAP_CHILD_K: "200" });
check("TURN_CAP_CHILD_K=200 moves the line", r.every((x) => x === null), String(r));
r = seqCalls(transcript("g6", [user("a normal talk"), asst([use("cur", "Bash", { command: "ls" })], 120000)]), "Bash", { command: "ls" }, 7);
check("talking session is not touched by the child rule", r.every((x) => x === null), String(r));

// subagents: hook runs there with agent_id; transcript derived from the session file
const parent = transcript("sess-h", [user("talk"), asst([use("p1", "Agent", { prompt: "x" })], 30000)]);
const subDir = path.join(dir, "sess-h", "subagents");
fs.mkdirSync(subDir, { recursive: true });
fs.writeFileSync(path.join(subDir, `agent-ab${run}.jsonl`), JSON.stringify({ ...asst([use("q", "Read", {})], 120000), isSidechain: true }) + "\n");
r = seqCalls(parent, "Bash", { command: "ls" }, 7, {}, { agent_id: `ab${run}` });
check("subagent over 100k: 5 steps, then refused", r.slice(0, 5).every((x) => x === null) && r[5] && r[6], String(r));
r = seqCalls(parent, "Bash", { command: "ls" }, 7, {}, { agent_id: "nofile" });
check("subagent with no transcript found fails open", r.every((x) => x === null), String(r));

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `FAILED: ${failed}` : "ALL PASSED");
process.exit(failed ? 1 : 0);
