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
import fs from "node:fs";

const STEPS = Number(process.env.TURN_CAP_STEPS) || 20;
const TALK_STEPS = Number(process.env.TURN_CAP_TALK_STEPS) || 10;
const TALK_EDITS = Number(process.env.TURN_CAP_TALK_EDITS) || 2;
const CONTEXT_K = Number(process.env.TURN_CAP_CONTEXT_K) || 150;
const TURN_K = process.env.TURN_CAP_TURN_K === undefined ? 100 : Number(process.env.TURN_CAP_TURN_K);
const SESSION_STEPS = Number(process.env.TURN_CAP_SESSION_STEPS) || 15;
const SESSION_K = Number(process.env.TURN_CAP_SESSION_K) || 100;
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
const deny = (reason) => {
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
	}));
	process.exit(0);
};

try {
	if ((process.env.TURN_CAP || "").toLowerCase() === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8"));
	if (event.agent_id) process.exit(0);
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
	const SPAWN = `Hand it to a child session (spawn_session, brief starting with the line "CHILD JOB:", one small thing, files by name, the one check, about 10 steps) or a "worker" subagent. Then read its report and reply.`;

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
	if (context > SESSION_K * 1000 && !(EDIT_TOOLS.includes(event.tool_name) && RECORD_FILE.test(String(event.tool_input?.file_path ?? "")))) {
		const big = bigContextSteps(event.transcript_path);
		if (big >= SESSION_STEPS) {
			deny([
				`[turn-cap] This session has run ${big} tool steps at over ${SESSION_K}k tokens of context; every further step re-sends all of it.`,
				`Stop here and restart in a fresh session from this point: write what is done, what is left, the next step and the files by name into a file in ~/.claude/handoffs/ (allowed), then spawn_session with a prompt that starts \`CHILD JOB: <title>\` and points to that file, one small job, about 10 steps. Then tell the user what you handed over.`,
			].join("\n"));
		}
	}
} catch {
	// Fail open
}
process.exit(0);
