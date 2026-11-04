// background-tasks: UserPromptSubmit and PreToolUse hook. Every wake-up of the main session re-sends the whole
// conversation: on real transcripts a long session had dozens of task-notification turns plus Nimbalyst
// "[System: background task(s) you launched have settled: ...]" prompts, each re-sending the full context.
//   UserPromptSubmit: when every task in the settled prompt already had its task-notification, lets it through
//     with a note to answer in a few plain lines instead of handling the results again. One unknown or
//     unnotified task lets it through with no note. It used to block it, but a blocked prompt shows in
//     Nimbalyst as a warning quoting the whole raw list, and that warning, not a reply, was what the user read.
//   PreToolUse (Bash, Agent, Task with run_in_background: true): adds a note on what background costs.
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
// Subagent prompts pass. Fails open. BACKGROUND_TASKS=off disables it.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import path from "node:path";

const SETTLED = /^\[System: background task\(s\)[^\n]*settled/;
const ITEM_END = /" [a-z][a-z ()0-9-]{0,30}\n  Summary:/g;
// A whole item header on one line with no Summary line under it: this parser can't check that item
const BARE_ITEM = /^- "[^\n]*" [a-z][a-z ()0-9-]{0,30}$(?!\n  Summary:)/m;
// command-explain.mjs appends this to a command without a note; the transcript keeps the command without it
const STAND_IN = /\n\n# WHAT THIS DOES: \(no note given\) [\s\S]*$/;
const NUDGE = "[background-tasks] Background costs two extra full-context turns (the notification and the settled notice) plus every check-in read. Use it only when another step runs beside this one; otherwise run it in the foreground (Bash: `timeout` up to 600000 ms; Agent: no `run_in_background`) and read the result once.";

const DUPLICATE = "[background-tasks] This settled notice repeats results you already had in their task-notifications, and the user sees it as a raw list. Don't re-read or redo anything: reply in two or three plain sentences with where the work stands now (what is done, what still runs, what they need to decide). Never answer it with \"No response requested\".";

const texts = (c) => typeof c === "string" ? [c] : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text || "") : [];
const resultText = (c) => typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b.text || "").join("\n") : "";
const key = (text) => text.replace(STAND_IN, "").trimEnd();

// What the main chain of the transcript says about background tasks
function readMain(file) {
	const launches = new Map(); // key of a command or description -> tool_use ids, oldest first
	const taskOf = new Map(); // tool_use id -> task id
	const startedAt = new Map(); // task id -> line of its launch result or of a SendMessage that resumed it
	const notified = new Map(); // task id -> lines of its task-notifications
	const later = (map, k, line) => map.set(k, Math.max(map.get(k) ?? -1, line));
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
				if (!["Bash", "Agent", "Task"].includes(b.name)) continue;
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
			if (!task) continue;
			if (!notified.has(task)) notified.set(task, []);
			notified.get(task).push(line);
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
	return { launches, taskOf, startedAt, notified };
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
	const handled = (task) => {
		const start = main.startedAt.get(task);
		return start !== undefined && (main.notified.get(task) || []).some((l) => l > start);
	};
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
	if ((process.env.BACKGROUND_TASKS || "").toLowerCase() === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8"));
	if (event.hook_event_name === "PreToolUse") {
		if (["Bash", "Agent", "Task"].includes(event.tool_name) && event.tool_input?.run_in_background === true) {
			process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: NUDGE } }));
		}
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
