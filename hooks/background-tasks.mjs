// background-tasks: UserPromptSubmit and PreToolUse hook. Every wake-up of the main session re-sends the whole
// conversation: on real transcripts a long session had dozens of task-notification turns plus Nimbalyst
// "[System: background task(s) you launched have settled: ...]" prompts, each re-sending the full context.
//   UserPromptSubmit: when every task in the settled prompt already had its task-notification, lets it through
//     with a note: one line while work still runs, one complete answer to the user's message when it is done. One unknown or
//     unnotified task lets it through with no note. It used to block it, but a blocked prompt shows in
//     Nimbalyst as a warning quoting the whole raw list, and that warning, not a reply, was what the user read.
//     Settled turns do real work: most of them carried on the job (next
//     launch, edits, re-boot) because the task-notification turn before each had been answered "No response
//     requested." (Claude Code's wake-up marks it "NOT USER INPUT"), and Nimbalyst resumed the session for the
//     settled prompt. Their requests are the job's next steps, moved there, so no wording of the note cuts them.
//   PreToolUse (main session only; the user, 2026-11-05: refuse unless it runs beside something): refuses a
//     background launch, which costs a notification turn plus a settled turn. Agent/Task are background unless
//     `run_in_background: false` (the default is background: 53 no-flag launches in S1's scan came back "Async
//     agent launched"); Bash/PowerShell only with `run_in_background: true`. A launch passes when
//     - its description has the word `beside` (the caller says another step runs meanwhile; this is also how two
//       launches in one message pass: they arrive as separate PreToolUse calls, and whether the message's later
//       tool_use blocks are on disk when the first one's hook runs is not known, so the transcript is not asked),
//     - another background task of the session is still running: a launch result with a task id ("agentId: X",
//       "Command running in background with ID: X", "moved to the background (ID: X)") with no task-notification
//       or TaskStop after it; a server or watcher doesn't count, it never ends,
//     - or it is a Bash/PowerShell server or watcher (SERVER below), which is what background is for.
//     Subagents (agent_id) pass: worker.md tells workers to run long builds in the background, and that
//     notification wakes the worker, not the main session. BACKGROUND_TASKS=warn gives the old note instead of
//     each refusal.
// How a settled item maps to its notification, worked out on real transcripts:
// an item is `- "<text>" <status>\n  Summary: ...`, where <text> is the Agent `description`, or the Bash
// `description` when the call has one, else its `command`. The notification carries `<task-id>`
// and only sometimes `<tool-use-id>` (a resumed agent's notice had none), so the key is the
// task id: text -> the latest main-chain Bash/Agent call with that text -> the task id in its tool result
// ("agentId: X", "Command running in background with ID: X", or "moved to the background (ID: X)" for a
// foreground Bash past its timeout) -> a task-notification with that id after the launch or after a
// SendMessage that resumed the agent. The notification is a turn of its own (origin task-notification) or,
// when it lands mid-turn, a queued_command attachment (some prompts depended on one).
// Background Bash does get its own notification: every main-chain Bash item had one before the
// settled prompt. Many items are no main-session task at all: Nimbalyst also lists every
// Bash call a background agent made (foreground ones too). Such an item is found in
// <session>/subagents/agent-<id>.jsonl and counts as handled once that agent's own notification came.
// Result on the real prompts, each with the transcript cut just before it: every one blocked, every Agent and
// Bash item matched to a notification, every agent step matched to its agent's.
// A "<task-notification>" without a task id (Stop hook feedback) is not a task's.
// Subagent prompts pass. Fails open. BACKGROUND_TASKS=off disables it, BACKGROUND_TASKS=warn turns refusals into notes.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import path from "node:path";

const SETTLED = /^\[System: background task\(s\)[^\n]*settled/;
const ITEM_END = /" [a-z][a-z ()0-9-]{0,30}\n  Summary:/g;
// A whole item header on one line with no Summary line under it: this parser can't check that item
const BARE_ITEM = /^- "[^\n]*" [a-z][a-z ()0-9-]{0,30}$(?!\n  Summary:)/m;
// command-explain.mjs appends this to a command without a note; the transcript keeps the command without it
const STAND_IN = /\n\n# WHAT THIS DOES: \(no note given\) [\s\S]*$/;
// A command that doesn't end by itself: dev server, game server, watcher, follow-mode log read, endless loop
const SERVER = /\b(runServer|runClient|nodemon|http-server|live-server|webpack-dev-server|http\.server|uvicorn|gunicorn)\b|\bflask\s+run\b|\bmanage\.py\s+runserver\b|\bnode\s[^|;&\n]*server|\bnpx\s+(serve|vite)\b|\bserve\s+-s\b|\bdocker[ -]compose\s+up\b(?![^|;&\n]*\s-\w*d)|\b(npm|pnpm|yarn)\s+run\s+preview\b|\bstreamlit\s+run\b|\brails\s+(s|server)\b|--watch\b|\btsc\b[^|;&\n]*\s-w\b|-Wait\b|\btail\b[^|;&\n]*\s-\w*[fF]\b|(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b|(^|[\s;&|(])(vite|next|nuxt|astro)(\s+dev)?\s*$|(^|[\s;&|(])watch\s|\bwhile\s+(true|:)/im;
const BESIDE = /\bbeside\b/i;
const NUDGE = "[background-tasks] Background costs two extra full-context turns (the notification and the settled notice) plus every check-in read. Use it only when another step runs beside this one; otherwise run it in the foreground (Bash: `timeout` up to 600000 ms; Agent: no `run_in_background`) and read the result once. When its notification comes while other work for the same ask still runs, write no reply for it: carry on, and answer once, completely, when everything has finished (a server or watcher that never ends doesn't count) (a string of small updates doesn't read like an answer).";
const REFUSE_AGENT = "[background-tasks] Refused: this launch runs in the background (the default unless run_in_background is false), and nothing else of this session runs meanwhile, so its finish only wakes the main session again, re-sending the whole conversation twice (notification and settled notice). Re-send the same call with run_in_background: false and use its result when it returns. If another step does run meanwhile (a second launch in this same message, or work you do yourself before reading this one), re-send it with the word `beside` in the description, e.g. \"S3 beside S1: ...\".";
const REFUSE_SHELL = "[background-tasks] Refused: nothing else of this session runs meanwhile, so this background command only wakes the main session again when it ends, re-sending the whole conversation twice (notification and settled notice). Run it in the foreground with `timeout` up to 600000 (10 minutes) and read its output once. If it is a server or watcher that never ends, re-send it with `beside` in its description. Background is also for when another step runs meanwhile: then put the word `beside` in the description.";

const DUPLICATE = "[background-tasks] This settled notice repeats results you already had in their task-notifications, and the user sees it as a raw list. Don't re-read or redo anything: no status snippet (a string of small updates doesn't read like an answer). If work for the user's last message still runs, reply with one line naming what still runs. When it is all finished, reply with one complete answer to that whole message, readable alone: every ask and its outcome, what was checked, what is left, any decision last. Never answer it with \"No response requested\".";

const texts = (c) => typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text || "") : [];
const resultText = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b.text || "").join("\n") : "";
const key = (text) => text.replace(STAND_IN, "").trimEnd();

// What the main chain of the transcript says about background tasks
function readMain(file) {
	const launches = new Map(); // key of a command or description -> tool_use ids, oldest first
	const taskOf = new Map(); // tool_use id -> task id
	const servers = new Set(); // tool_use ids of Bash/PowerShell calls that look like a server or watcher
	const startedAt = new Map(); // task id -> line of its launch result or of a SendMessage that resumed it
	const notified = new Map(); // task id -> lines of its task-notifications (or of a TaskStop that ended it)
	const later = (map, k, line) => map.set(k, Math.max(map.get(k) ?? -1, line));
	const note = (task, line) => { if (!notified.has(task)) notified.set(task, []); notified.get(task).push(line); };
	fs.readFileSync(file, "utf8").split("\n").forEach((raw, line) => {
		if (!raw.trim()) return;
		let e;
		try { e = JSON.parse(raw); } catch { return; }
		if (e.isSidechain) return;
		const c = e.message?.content;
		if (e.type === "assistant") {
			for (const b of Array.isArray(c) ? c : []) {
				if (b.type !== "tool_use" || !b.input) continue;
				if (b.name === "SendMessage" && b.input.to) later(startedAt, b.input.to, line);
				if (b.name === "TaskStop" && b.input.task_id) note(b.input.task_id, line);
				if (!["Bash", "PowerShell", "Agent", "Task"].includes(b.name)) continue;
				if (typeof b.input.command === "string" && SERVER.test(b.input.command)) servers.add(b.id);
				// Nimbalyst quotes a Bash call's description when it has one, else its command
				for (const t of [b.input.command, b.input.description]) {
					if (typeof t !== "string" || !t.trim()) continue;
					if (!launches.has(key(t))) launches.set(key(t), []);
					launches.get(key(t)).push(b.id);
				}
			}
			return;
		}
		// A notification comes as its own turn, or as a queued_command attachment when it lands mid-turn
		const notices = e.type === "user" ? texts(c) : e.type === "attachment" && e.attachment?.type === "queued_command" ? texts(e.attachment.prompt) : [];
		for (const t of notices) {
			if (!t.trimStart().startsWith("<task-notification>")) continue;
			const task = t.match(/<task-id>([^<\s]+)<\/task-id>/)?.[1];
			if (task) note(task, line);
		}
		if (e.type !== "user") return;
		for (const b of Array.isArray(c) ? c : []) {
			if (b.type !== "tool_result") continue;
			const m = resultText(b.content).match(/agentId: (\w+)|Command running in background with ID: (\w+)|moved to the background \(ID: (\w+)\)/);
			if (!m) continue;
			const task = m[1] || m[2] || m[3];
			taskOf.set(b.tool_use_id, task);
			later(startedAt, task, line);
		}
	});
	return { launches, taskOf, servers, startedAt, notified };
}

// Whether a task had a task-notification after its launch or last resume
const handledIn = (main) => (task) => {
	const start = main.startedAt.get(task);
	return start !== undefined && (main.notified.get(task) || []).some((l) => l > start);
};

// Whether another background task of the session still runs (a server or watcher doesn't count)
function othersRunning(transcript) {
	const main = readMain(transcript);
	const handled = handledIn(main);
	return [...main.taskOf].some(([use, task]) => !main.servers.has(use) && !handled(task));
}

// Task ids of this session's agents whose own transcript holds a call with this text (a prefix match, so a
// command quoted with the stand-in note still matches; more owners only make the check stricter)
function ownersInSubagents(dir, text, cache) {
	if (!cache.files) cache.files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^agent-\w+\.jsonl$/.test(f)).map((f) => ({ id: f.slice(6, -6), raw: fs.readFileSync(path.join(dir, f), "utf8") })) : [];
	const q = JSON.stringify(key(text)).slice(0, -1);
	return cache.files.filter((f) => f.raw.includes(`"command":${q}`) || f.raw.includes(`"description":${q}`)).map((f) => f.id);
}

// Whether every task in the settled prompt already had a task-notification after its launch
function allNotified(prompt, transcript, sessionId) {
	const main = readMain(transcript);
	const subDir = path.join(path.dirname(transcript), String(sessionId || path.basename(transcript, ".jsonl")), "subagents");
	const cache = {};
	const handled = handledIn(main);
	const ends = [...prompt.matchAll(ITEM_END)].map((m) => m.index);
	if (!ends.length) return false;
	// An item this parser does not see (no Summary line) must not be blocked along with the rest
	if (BARE_ITEM.test(prompt)) return false;
	let prevEnd = 0;
	for (const end of ends) {
		// The item's text starts after a `- "` at a line start: try the nearest first, back to the last item
		let found = false;
		for (let s = prompt.lastIndexOf('\n- "', end); s >= prevEnd && !found; s = s > 0 ? prompt.lastIndexOf('\n- "', s - 1) : -1) {
			const text = prompt.slice(s + 4, end);
			const own = main.launches.get(key(text));
			let tasks;
			if (own) {
				const task = main.taskOf.get(own[own.length - 1]);
				if (!task) return false;
				tasks = [task];
			} else tasks = ownersInSubagents(subDir, text, cache);
			if (!tasks.length) continue;
			if (!tasks.every(handled)) return false;
			found = true;
		}
		if (!found) return false;
		prevEnd = end;
	}
	return true;
}

try {
	const mode = (process.env.BACKGROUND_TASKS || "").toLowerCase();
	if (mode === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8"));
	if (event.hook_event_name === "PreToolUse") {
		const input = event.tool_input || {};
		const agentCall = ["Agent", "Task"].includes(event.tool_name);
		const shellCall = ["Bash", "PowerShell"].includes(event.tool_name);
		const background = agentCall ? input.run_in_background !== false : shellCall && input.run_in_background === true;
		if (!background || event.agent_id) process.exit(0);
		if (BESIDE.test(String(input.description ?? ""))) process.exit(0);
		if (shellCall && SERVER.test(String(input.command ?? ""))) process.exit(0);
		if (event.transcript_path && fs.existsSync(event.transcript_path) && othersRunning(event.transcript_path)) process.exit(0);
		// The desktop app and VS Code always run the main conversation's helpers in the background (Claude Code
		// 2.1.302), so a refusal there could never be met: a note only.
		const alwaysBackground = agentCall && /^claude-(desktop|vscode)/.test(process.env.CLAUDE_CODE_ENTRYPOINT || "");
		const out = mode === "warn" || alwaysBackground
			? { hookEventName: "PreToolUse", additionalContext: NUDGE }
			: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: agentCall ? REFUSE_AGENT : REFUSE_SHELL };
		process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
		process.exit(0);
	}
	if (event.agent_id) process.exit(0);
	const prompt = String(event.prompt ?? "");
	if (!SETTLED.test(prompt)) process.exit(0);
	if (!event.transcript_path || !fs.existsSync(event.transcript_path)) process.exit(0);
	if (allNotified(prompt, event.transcript_path, event.session_id)) {
		process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: DUPLICATE } }));
	}
} catch (err) {
	crashLog("background-tasks", err);
	// Fail open
}
process.exit(0);
