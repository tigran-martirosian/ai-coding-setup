// turn-cap: a PreToolUse hook that keeps the session the user talks in from building.
// Every request re-sends the whole conversation, so a long run of steps in a big session is where most
// tokens go: in measured use 94% of all tokens were the same context read again, and 91% of main-session
// tokens sat in sessions that had reached 100k+. The older reminders (build-nudge, context-guard) only
// nudge and let a repeated call through; this one refuses.
// Two kinds of session, told apart by the first message: a CHILD starts with "CHILD JOB" or "You are a
// child session" (written by the session that spawned it); anything else is TALKING (the user's chat,
// also a handoff session).
//   TALKING: at most TURN_CAP_TALK_EDITS (2) edit steps and TURN_CAP_TALK_STEPS (10) tool steps per
//     message. Past that every further tool call is refused, except handing work on (Agent,
//     spawn_session, send_prompt) and asking the user. Building goes to a child, one small job each.
//   CHILD: TURN_CAP_STEPS (20) tool steps; past that everything is refused and it reports.
//   BOTH: over TURN_CAP_CONTEXT_K (150) thousand tokens and 3 edit steps this turn: edits are refused.
// Edits to record files (HANDOFF.md, DECISIONS.md, memory, handoffs) are not counted.
// A Bash call that only runs handoff-brief.mjs (the handoff skill's brief step) is always allowed, in the
// per-turn caps and the session rule; any other Bash command is not.
// The per-turn caps (steps and edits, TALKING and CHILD) apply only when the context is at or over
// TURN_CAP_TURN_K (100) thousand tokens: below that a step is cheap, and a refusal costs more than it saves
// (a worker subagent re-reads about 0.7M tokens; 3 steps at 98k are about 0.3M). The session rule and the
// 150k edit rule are separate and unchanged. Tools that ask the user or propose a commit are never refused.
// Subagents are left alone. Fails open. TURN_CAP=off disables it.
// Helper model lock (any context size, TALKING and CHILD): refused unless planner or an "OPUS BECAUSE:" line.
//   TURN_CAP_MODEL_LOCK=off disables it.
// Restart hold: once the session rule has refused (a flag file in the OS temp folder, keyed by session id,
// written at that refusal), it holds on later messages too: only the always-allowed tools, record files and
// TURN_CAP_HOLD_READS (5) Read/Grep/Glob calls per message. TURN_CAP_RESTART_HOLD=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STEPS = Number(process.env.TURN_CAP_STEPS) || 20;
const TALK_STEPS = Number(process.env.TURN_CAP_TALK_STEPS) || 10;
const TALK_EDITS = Number(process.env.TURN_CAP_TALK_EDITS) || 2;
const CONTEXT_K = Number(process.env.TURN_CAP_CONTEXT_K) || 150;
const TURN_K = process.env.TURN_CAP_TURN_K === undefined ? 100 : Number(process.env.TURN_CAP_TURN_K);
const SESSION_STEPS = Number(process.env.TURN_CAP_SESSION_STEPS) || 15;
const SESSION_K = Number(process.env.TURN_CAP_SESSION_K) || 100;
const HOLD_READS = Number(process.env.TURN_CAP_HOLD_READS) || 5;
const BIG_EDITS = 3;
const TAIL_BYTES = 2 * 1024 * 1024;
const HEAD_BYTES = 256 * 1024;
const EDIT_TOOLS = ["Edit", "MultiEdit", "Write", "NotebookEdit"];
const RECORD_FILE = /(HANDOFF|DECISIONS|MEMORY)\.md$|[\\/](memory|handoffs)[\\/]/i;
const CHILD = /^\s*(CHILD JOB\b|You are a child session)/i;
// Tools that hand work on or talk to the user: always allowed
const ALWAYS = /^Agent$|spawn_session|create_session|send_prompt|update_session|AskUserQuestion|PromptForUserInput|ToolSearch|commit_proposal/;

// Reads the file backwards in 2 MB chunks until the last real user message is found (or the file start),
// and returns the parsed lines from that message on. A partial line at a chunk start is carried as a Buffer.
function readTurn(file) {
	const fd = fs.openSync(file, "r");
	try {
		let pos = fs.fstatSync(fd).size;
		let carry = Buffer.alloc(0);
		let later = []; // parsed lines after the chunk being scanned, in file order
		while (pos > 0 || carry.length) {
			const len = Math.min(pos, TAIL_BYTES);
			pos -= len;
			const chunk = Buffer.alloc(len);
			if (len) fs.readSync(fd, chunk, 0, len, pos);
			let buf = Buffer.concat([chunk, carry]);
			carry = Buffer.alloc(0);
			if (pos > 0) {
				const nl = buf.indexOf(10);
				if (nl < 0) { carry = buf; continue; }
				carry = buf.subarray(0, nl);
				buf = buf.subarray(nl + 1);
			}
			const parsed = [];
			for (const line of buf.toString("utf8").split("\n")) {
				if (!line.trim()) continue;
				try { parsed.push(JSON.parse(line)); } catch { /* skip */ }
			}
			for (let i = parsed.length - 1; i >= 0; i--) {
				if (!parsed[i].isSidechain && isRealUser(parsed[i])) return parsed.slice(i).concat(later);
			}
			later = parsed.concat(later);
			if (pos === 0) break;
		}
		return later;
	} finally { fs.closeSync(fd); }
}
const parts = (c) => (Array.isArray(c) ? c : []);
const textOf = (j) => {
	const c = j.message?.content;
	if (typeof c === "string") return c;
	return parts(c).filter((p) => p.type === "text").map((p) => p.text).join("\n");
};
// Background-task notifications arrive as user messages but are not a new turn
const NOTIFICATION = /^(<task-notification>|\[System: background task)/;
const isRealUser = (j) =>
	j.type === "user" && !j.isMeta &&
	(typeof j.message?.content === "string" || parts(j.message?.content).some((p) => p.type === "text")) &&
	!NOTIFICATION.test(textOf(j).trimStart());
const isBuildEdit = (name, input) => EDIT_TOOLS.includes(name) && !RECORD_FILE.test(String(input?.file_path ?? ""));
// The session's first real user message decides what kind of session this is
function isChild(file) {
	const fd = fs.openSync(file, "r");
	try {
		const buf = Buffer.alloc(Math.min(HEAD_BYTES, fs.fstatSync(fd).size));
		fs.readSync(fd, buf, 0, buf.length, 0);
		for (const line of buf.toString("utf8").split("\n")) {
			let j;
			try { j = JSON.parse(line); } catch { continue; }
			if (j.isSidechain || !isRealUser(j)) continue;
			return CHILD.test(textOf(j));
		}
	} finally { fs.closeSync(fd); }
	return false;
}
// Whole-transcript count for the session rule: tool steps (one per assistant request with a tool_use, main
// chain) whose request context is over SESSION_K thousand tokens, not counting the request that is making
// the current call (the last tool_use line). Streams the file in chunks and only parses lines that can hold
// a tool_use (files reach 20 MB with base64 pictures).
function bigContextSteps(file) {
	const fd = fs.openSync(file, "r");
	const ctxById = new Map();
	let lastId = null;
	const needle = Buffer.from('"tool_use"');
	const take = (buf) => {
		if (!buf.length || buf.indexOf(needle) < 0) return;
		let j;
		try { j = JSON.parse(buf.toString("utf8")); } catch { return; }
		if (j.isSidechain || j.type !== "assistant" || !j.message || j.message.model === "<synthetic>") return;
		if (!parts(j.message.content).some((p) => p.type === "tool_use")) return;
		const id = j.message.id ?? j.uuid;
		const u = j.message.usage;
		if (u) ctxById.set(id, (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0));
		else if (!ctxById.has(id)) ctxById.set(id, 0);
		lastId = id;
	};
	try {
		const size = fs.fstatSync(fd).size;
		const CHUNK = 4 * 1024 * 1024;
		let pos = 0;
		let carry = Buffer.alloc(0);
		while (pos < size) {
			const len = Math.min(CHUNK, size - pos);
			const chunk = Buffer.alloc(len);
			fs.readSync(fd, chunk, 0, len, pos);
			pos += len;
			const buf = carry.length ? Buffer.concat([carry, chunk]) : chunk;
			let start = 0;
			let nl;
			while ((nl = buf.indexOf(10, start)) >= 0) {
				take(buf.subarray(start, nl));
				start = nl + 1;
			}
			carry = Buffer.from(buf.subarray(start));
		}
		take(carry);
	} finally { fs.closeSync(fd); }
	let n = 0;
	for (const [id, c] of ctxById) if (id !== lastId && c > SESSION_K * 1000) n++;
	return n;
}
// Helper model lock: an Agent or spawn_session call may not pick Opus or Fable unless it is the planner agent
// or the prompt has a line "OPUS BECAUSE: <reason of 20+ characters>". A worker with no model runs on Sonnet; a
// spawned session with no model takes the app default (Opus), so it must name one and an effortLevel below high.
const HEAVY_MODEL = /opus|fable/i;
const OPUS_REASON = /^[ \t]*OPUS BECAUSE:[ \t]*\S.{18,}\S/m;
const SPAWNS = /spawn_session|create_session/;
const HEAVY_EFFORT = /^(high|xhigh|max)$/i;
const READ_ONLY = /^(Read|Grep|Glob)$/;
function lastAssistantModel(file) {
	let model = null;
	for (const j of readTurn(file)) {
		if (j.isSidechain || j.type !== "assistant" || !j.message?.model || j.message.model === "<synthetic>") continue;
		model = j.message.model;
	}
	return model;
}
// Returns the refusal text, or null when the call is allowed
function modelLockRefusal(event) {
	const name = String(event.tool_name);
	const input = event.tool_input ?? {};
	const isAgent = name === "Agent";
	if (!isAgent && !SPAWNS.test(name)) return null;
	if (isAgent && input.subagent_type === "planner") return null;
	if (OPUS_REASON.test(String(input.prompt ?? ""))) return null;
	// A handoff (isolated top-level session that inherits this session's model) continues the user's own choice
	if (!isAgent && input.isolated === true && input.inheritModel === true) return null;
	let heavy = null;
	if (input.model !== undefined && input.model !== null && input.model !== "") {
		if (HEAVY_MODEL.test(String(input.model))) heavy = String(input.model);
	} else if (!isAgent && input.inheritModel === true && event.transcript_path && fs.existsSync(event.transcript_path)) {
		const own = lastAssistantModel(event.transcript_path);
		if (own && HEAVY_MODEL.test(own)) heavy = `${own} (inherited from this session)`;
	}
	const noModel = input.model === undefined || input.model === null || input.model === "";
	if (!heavy && !isAgent && noModel && input.inheritModel !== true) {
		return [
			"[turn-cap] A spawned session with no model takes the app default, which is Opus.",
			"Name the model: model \"claude-code:sonnet\" (or \"claude-code:haiku\" for commit, copy, rename and other mechanical jobs), with effortLevel \"medium\" (\"low\" for mechanical ones). If the job really needs Opus, add a line to the prompt that starts `OPUS BECAUSE:` followed by the reason in a sentence, and call again.",
		].join("\n");
	}
	if (!heavy && !isAgent && HEAVY_EFFORT.test(String(input.effortLevel ?? ""))) {
		return [
			`[turn-cap] A helper session at effort ${input.effortLevel} is refused: most of the output at high effort is thinking.`,
			"Use effortLevel \"medium\" (\"low\" for mechanical jobs). If the job needs judgment (a 3D model, an animation, fight rules), add a line to the prompt that starts `OPUS BECAUSE:` followed by the reason, and call again.",
		].join("\n");
	}
	if (!heavy) return null;
	return [
		`[turn-cap] Helpers do not run on Opus or Fable by default; this call asked for ${heavy}.`,
		isAgent
			? `Leave the model out (a worker runs on Sonnet), or use \`model: "haiku"\` for commit, copy, rename and other mechanical jobs.`
			: `Name model "claude-code:sonnet" with effortLevel "medium" (a session with no model takes the app default, Opus), or "claude-code:haiku" with effortLevel "low" for commit, copy, rename and other mechanical jobs.`,
		`If the job really needs hard reasoning (judging a 3D model or an animation, for example), add a line to the prompt that starts \`OPUS BECAUSE:\` followed by the reason in a sentence, and call again. The user picks the model of the session they talk in themselves.`,
	].join("\n");
}
const restartFlag = (id) => path.join(os.tmpdir(), `turn-cap-restart-${String(id).replace(/[^\w.-]/g, "_")}.flag`);

// One helper at a time (any context size): an Agent, spawn_session or create_session call is refused while an
// earlier helper of this session is still running. Limit TURN_CAP_HELPERS (default 1, "off" disables); a
// helper that never reports counts as ended after TURN_CAP_HELPER_MINUTES (20).
// A helper is running from the launch result (background Agent: "Async agent launched" + agentId; spawned
// session: JSON with sessionId) until its end message: a user message starting <task-notification> with the
// task-id, or one starting [Child Session Update] with the session id and "Event: session:completed" (only
// sent when notifyOnComplete was true, else the timeout ends it). A foreground Agent has ended when its result
// is there. Launches in the same assistant message: the transcript holds all their tool_use lines, so a call
// counts the launches written before it that have no result yet (the current call is found by tool_use_id,
// else by tool name and input).
const HELPERS_OFF = (process.env.TURN_CAP_HELPERS || "").toLowerCase() === "off";
const HELPERS_MAX = Number(process.env.TURN_CAP_HELPERS) || 1;
const HELPER_MINUTES = Number(process.env.TURN_CAP_HELPER_MINUTES) || 20;
function eachLine(file, fn) {
	const fd = fs.openSync(file, "r");
	try {
		const size = fs.fstatSync(fd).size;
		const CHUNK = 4 * 1024 * 1024;
		let pos = 0;
		let carry = Buffer.alloc(0);
		while (pos < size) {
			const len = Math.min(CHUNK, size - pos);
			const chunk = Buffer.alloc(len);
			fs.readSync(fd, chunk, 0, len, pos);
			pos += len;
			const buf = Buffer.concat([carry, chunk]);
			let start = 0;
			let nl;
			while ((nl = buf.indexOf(10, start)) >= 0) { fn(buf.subarray(start, nl)); start = nl + 1; }
			carry = buf.subarray(start);
		}
		if (carry.length) fn(carry);
	} finally { fs.closeSync(fd); }
}
const LAUNCH_NEEDLES = ['"Agent"', "spawn_session", "create_session", "task-notification", "Child Session Update"].map((s) => Buffer.from(s));
function helperRefusal(event) {
	const name = String(event.tool_name);
	if (name !== "Agent" && !SPAWNS.test(name)) return null;
	const launches = [];
	const byUse = new Map();
	const endBy = (token) => { if (token) for (const L of launches) if (L.token === token) L.state = "ended"; };
	eachLine(event.transcript_path, (b) => {
		const isResult = b.indexOf('"tool_result"') >= 0 && [...byUse.keys()].some((id) => b.indexOf(id) >= 0);
		if (!isResult && !LAUNCH_NEEDLES.some((n) => b.indexOf(n) >= 0)) return;
		let j;
		try { j = JSON.parse(b.toString("utf8")); } catch { return; }
		if (j.isSidechain) return;
		const arr = parts(j.message?.content);
		if (j.type === "assistant") {
			for (const p of arr) {
				if (p.type !== "tool_use" || (p.name !== "Agent" && !SPAWNS.test(p.name))) continue;
				const L = { useId: p.id, name: p.name, sig: p.name + JSON.stringify(p.input ?? {}), ts: Date.parse(j.timestamp) || Date.now(), state: "pending", token: null };
				launches.push(L);
				if (p.id) byUse.set(p.id, L);
			}
			return;
		}
		// An end that arrives while the session is working is not a user message: it is written as a
		// queue-operation line (content) and an attachment line (attachment.prompt).
		const queued = j.type === "queue-operation" ? j.content : j.type === "attachment" ? j.attachment?.prompt : null;
		if (typeof queued === "string") { endIn(queued.trimStart()); return; }
		if (j.type !== "user") return;
		for (const p of arr) {
			const L = p.type === "tool_result" ? byUse.get(p.tool_use_id) : null;
			if (!L) continue;
			const text = typeof p.content === "string" ? p.content : parts(p.content).map((x) => x.text ?? "").join("\n");
			if (L.name === "Agent") {
				const tr = j.toolUseResult;
				if (!p.is_error && (tr?.isAsync || tr?.status === "async_launched" || /Async agent launched/.test(text))) {
					L.state = "running";
					L.token = tr?.agentId ?? (text.match(/agentId:\s*([\w-]+)/) || [])[1] ?? null;
				} else L.state = "ended";
			} else {
				const sid = (text.match(/"sessionId"\s*:\s*"([^"]+)"/) || [])[1];
				if (sid && !p.is_error) { L.state = "running"; L.token = sid; } else L.state = "ended";
			}
		}
		endIn(textOf(j).trimStart());
	});
	function endIn(text) {
		if (text.startsWith("<task-notification>")) endBy((text.match(/<task-id>\s*([^<\s]+)\s*<\/task-id>/) || [])[1]);
		else if (text.startsWith("[Child Session Update]") && /Event:\s*session:completed/.test(text)) endBy((text.match(/\(([0-9a-f-]{36})\)/) || [])[1]);
	}
	const sig = name + JSON.stringify(event.tool_input ?? {});
	const me = (event.tool_use_id && byUse.get(event.tool_use_id)) || launches.find((L) => L.state === "pending" && L.sig === sig);
	const meIdx = me ? launches.indexOf(me) : launches.length;
	const now = Date.now();
	const live = launches.filter((L, i) => L !== me && now - L.ts < HELPER_MINUTES * 60000 && (L.state === "running" || (L.state === "pending" && i < meIdx)));
	if (live.length < HELPERS_MAX) return null;
	const mins = Math.max(0, Math.round((now - Math.min(...live.map((L) => L.ts))) / 60000));
	return [
		`[turn-cap] A helper started ${mins} min ago is still running (${live.length} of ${HELPERS_MAX} allowed at a time). Wait for its report, then start the next one: its end arrives here as a message.`,
		`Helpers side by side each pay a full start and re-read the same files, so one after the other costs less. If you are waiting, answer the user or do something small yourself.`,
	].join("\n");
}

// Helper stopped near 100k: a child session (or a subagent) at TURN_CAP_CHILD_K (100) thousand tokens or more
// gets 5 more tool steps (counted in a flag file in the temp folder, keyed by session or agent id), then every
// tool except the always-allowed ones is refused. TURN_CAP_CHILD_K=off disables it.
// Subagents: the hook runs in them with agent_id set; the transcript is taken from transcript_path when that is
// already agent-<id>.jsonl, else <session file without .jsonl>/subagents/agent-<agent_id>.jsonl next to it.
const CHILD_OFF = (process.env.TURN_CAP_CHILD_K || "").toLowerCase() === "off";
const CHILD_K = Number(process.env.TURN_CAP_CHILD_K) || 100;
const WRAP_STEPS = 5;
function wrapUpRefusal(key, k) {
	if (CHILD_OFF || k < CHILD_K) return null;
	const f = path.join(os.tmpdir(), `turn-cap-wrap-${String(key).replace(/[^\w.-]/g, "_")}.count`);
	let n = 0;
	try { n = Number(fs.readFileSync(f, "utf8")) || 0; } catch { /* first step over the line */ }
	if (n < WRAP_STEPS) { fs.writeFileSync(f, String(n + 1)); return null; }
	return [
		`[turn-cap] This helper is at ~${k}k tokens and has used its ${WRAP_STEPS} wrap-up steps; every further step re-sends all of it. No further tool calls.`,
		`Reply now with the report: what is done, what is left and the files touched (name them, with line ranges where it matters). A fresh helper continues from that report.`,
	].join("\n");
}
function subagentTranscript(event) {
	const p = String(event.transcript_path ?? "");
	if (!p) return null;
	const cand = /^agent-.*\.jsonl$/.test(path.basename(p)) ? p
		: path.join(path.dirname(p), path.basename(p, ".jsonl"), "subagents", `agent-${event.agent_id}.jsonl`);
	return fs.existsSync(cand) ? cand : null;
}
function lastContextK(file) {
	const fd = fs.openSync(file, "r");
	try {
		const len = Math.min(TAIL_BYTES, fs.fstatSync(fd).size);
		const buf = Buffer.alloc(len);
		fs.readSync(fd, buf, 0, len, fs.fstatSync(fd).size - len);
		let ctx = 0;
		for (const line of buf.toString("utf8").split("\n")) {
			let j;
			try { j = JSON.parse(line); } catch { continue; }
			const u = j.type === "assistant" && j.message?.model !== "<synthetic>" ? j.message?.usage : null;
			if (u) ctx = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
		}
		return Math.round(ctx / 1000);
	} finally { fs.closeSync(fd); }
}
const deny = (reason) => {
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
	}));
	process.exit(0);
};

try {
	if ((process.env.TURN_CAP || "").toLowerCase() === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8"));
	if (event.agent_id) {
		if (!CHILD_OFF && !ALWAYS.test(String(event.tool_name))) {
			const file = subagentTranscript(event);
			const refusal = file ? wrapUpRefusal(`agent-${event.agent_id}`, lastContextK(file)) : null;
			if (refusal) deny(refusal);
		}
		process.exit(0);
	}
	if ((process.env.TURN_CAP_MODEL_LOCK || "").toLowerCase() !== "off") {
		const refusal = modelLockRefusal(event);
		if (refusal) deny(refusal);
	}
		// A session held by the restart rule may always spawn its handoff session, even while a helper runs
	const heldNow = (process.env.TURN_CAP_RESTART_HOLD || "").toLowerCase() !== "off" && event.session_id && fs.existsSync(restartFlag(event.session_id));
	if (!HELPERS_OFF && !(heldNow && SPAWNS.test(String(event.tool_name))) && event.transcript_path && fs.existsSync(event.transcript_path)) {
		const refusal = helperRefusal(event);
		if (refusal) deny(refusal);
	}
	if (ALWAYS.test(String(event.tool_name))) process.exit(0);
		// One command, "node <path>/handoff-brief.mjs [args]", and nothing chained to it (notes and blank lines aside)
		const onlyHandoffBrief = (cmd) => {
			const cmds = String(cmd ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
			return cmds.length === 1 && /^node\s+("[^"`$]*|'[^']*|[^\s"'`$;&|<>]*)handoff-brief\.mjs["']?(\s+[^;&|<>`$()]*)?$/.test(cmds[0]);
		};
		if (event.tool_name === "Bash" && onlyHandoffBrief(event.tool_input?.command)) process.exit(0);
	if (!event.transcript_path || !fs.existsSync(event.transcript_path)) process.exit(0);

	const steps = new Map(); // message id -> tool calls of that reply
	let context = 0;
	for (const j of readTurn(event.transcript_path)) {
		if (j.isSidechain) continue;
		if (isRealUser(j)) { steps.clear(); continue; }
		if (j.type !== "assistant" || !j.message || j.message.model === "<synthetic>") continue;
		const u = j.message.usage;
		if (u) context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
		const id = j.message.id ?? j.uuid;
		const step = steps.get(id) ?? steps.set(id, []).get(id);
		for (const p of parts(j.message.content)) if (p.type === "tool_use") step.push({ name: p.name, input: p.input });
	}
	const all = [...steps.values()].filter((s) => s.length);
	const k = Math.round(context / 1000);
	const child = isChild(event.transcript_path);
	const edits = all.filter((s) => s.some((t) => isBuildEdit(t.name, t.input))).length;
	const editing = isBuildEdit(event.tool_name, event.tool_input);
	const SPAWN = `Hand it to ONE helper: a child session (spawn_session with model: "claude-code:sonnet" and effortLevel: "medium", brief starting with the line "CHILD JOB:", one small thing, the one check, about 10 steps) or a "worker" subagent (leave its model out). The brief names the files and line ranges, so the helper does not re-read what is already known. Wait for its report before starting another, then read it and reply.`;

	// Restart hold: the session was already told to restart (flag written at that refusal); it holds on later messages
	const held = (process.env.TURN_CAP_RESTART_HOLD || "").toLowerCase() !== "off" && event.session_id && fs.existsSync(restartFlag(event.session_id));
	if (held
		&& !(EDIT_TOOLS.includes(event.tool_name) && RECORD_FILE.test(String(event.tool_input?.file_path ?? "")))) {
		const reads = all.flat().filter((t) => READ_ONLY.test(t.name)).length; // this call is the last line, counted
		if (!(READ_ONLY.test(String(event.tool_name)) && reads <= HOLD_READS)) {
			deny(`[turn-cap] This session was told to restart: write the handoff into ~/.claude/handoffs/ and continue in the new session (ONE helper via spawn_session with model: "claude-code:sonnet" and effortLevel: "medium", prompt starting \`CHILD JOB:\`, naming the files and line ranges so it does not re-read what is known). Only the handoff, asking the user and ${HOLD_READS} Read/Grep/Glob calls per message are allowed here.`);
		}
	}
	const perTurn = context >= TURN_K * 1000; // the per-turn caps only count when a step is already expensive
	if (perTurn && all.length >= (child ? STEPS : TALK_STEPS)) {
		deny([
			`[turn-cap] ${child ? "This child job" : "This session, the one the user talks in,"} has already taken ${all.length} steps on this message (~${k}k tokens re-sent each time). No further tool calls this turn.`,
			child
				? `Reply now: what is done and what is left. The session that spawned you decides what happens next.`
				: `Reply to the user now: what is done, what is left. The rest is not done here. ${SPAWN}`,
			`Only handing work on (Agent, spawn_session, send_prompt) and asking the user are still allowed.`,
		].join("\n"));
	}
	if (perTurn && editing && !child && edits >= TALK_EDITS) {
		deny([
			`[turn-cap] This is the session the user talks in: it answers and plans, it does not build. ${edits} edit steps are done this turn; more are refused.`,
			SPAWN,
		].join("\n"));
	}
	if (editing && k >= CONTEXT_K && edits >= BIG_EDITS) {
		deny([
			`[turn-cap] This session holds ~${k}k tokens and has made ${edits} edit steps this turn; each further edit re-sends all of it.`,
			`Stop editing here. ${SPAWN}`,
		].join("\n"));
	}
	// Session rule: over SESSION_STEPS tool steps at over SESSION_K tokens of context, in the whole session
	if (!held && context > SESSION_K * 1000 && !(EDIT_TOOLS.includes(event.tool_name) && RECORD_FILE.test(String(event.tool_input?.file_path ?? "")))) {
		const big = bigContextSteps(event.transcript_path);
		if (big >= SESSION_STEPS) {
			if (event.session_id) { try { fs.writeFileSync(restartFlag(event.session_id), new Date().toISOString()); } catch { /* the refusal itself still goes out */ } }
			deny([
				`[turn-cap] This session has run ${big} tool steps at over ${SESSION_K}k tokens of context; every further step re-sends all of it.`,
				`Stop here and restart in a fresh session from this point: write what is done, what is left, the next step and the files by name into a file in ~/.claude/handoffs/ (allowed), then spawn_session ONE helper (model: "claude-code:sonnet", effortLevel: "medium") with a prompt that starts \`CHILD JOB: <title>\`, points to that file and names the files and line ranges it needs so it does not re-read what is known, one small job, about 10 steps. Then tell the user what you handed over.`,
			].join("\n"));
		}
	}
	// Helper stopped near 100k: child sessions only (the talking session has the session rule)
	if (child && event.session_id) {
		const refusal = wrapUpRefusal(event.session_id, k);
		if (refusal) deny(refusal);
	}
} catch {
	// Fail open
}
process.exit(0);
