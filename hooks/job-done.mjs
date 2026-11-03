// job-done: a UserPromptSubmit hook that nudges when a committed job's session gets an unrelated next ask.
// Once a session's job is committed, the next ask often rides on a large context, so every call costs
// several times what a fresh ~40k session costs.
// Adds context (does not block) when the context of the last main-chain request is over JOB_DONE_K (100)
// thousand tokens AND the entries since the previous typed user message hold a Bash `git commit`, `git tag`,
// `git push` or `repo-push.sh` call, or a Skill call of release-setup or deploy. One commit nudges once:
// state in os.tmpdir()/job-done/<session_id>.json holds the id of the commit call already nudged about.
// Silent for subagents (agent_id), prompts starting with "/", and injected prompts (<task-notification>,
// [System: ...). Sidechain entries are ignored. Fails open. JOB_DONE=off disables it.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CONTEXT_K = Number(process.env.JOB_DONE_K) || 100;
const TAIL_BYTES = 4 * 1024 * 1024;

// A message the user typed, not a tool result or text added on its own
const INJECTED = /^(\[(Request interrupted|System:|SYSTEM NOTIFICATION|Child Session Update\])|<task-notification>)/;
const userText = (e) => {
	const c = e.message?.content;
	return typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text || "").join("\n") : "";
};
const typedByUser = (e) => {
	if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.promptSource === "system" || e.origin?.kind === "task-notification") return false;
	const t = userText(e).trim();
	return !!t && !INJECTED.test(t);
};

// A call that ends a job: git commit/tag/push, repo-push.sh, or the release-setup / deploy skill
const GIT_DONE = /\bgit(\s+-C\s+("[^"]*"|\S+))?\s+(commit|tag|push)\b|\brepo-push\.sh\b/;
const DONE_SKILL = /^(release-setup|deploy)$/;
const doneCallId = (e) => {
	if (e.type !== "assistant" || !Array.isArray(e.message?.content)) return null;
	for (const b of e.message.content) {
		if (b.type !== "tool_use") continue;
		if (b.name === "Bash" && GIT_DONE.test(String(b.input?.command ?? ""))) return b.id || "bash";
		if (b.name === "Skill" && DONE_SKILL.test(String(b.input?.skill ?? "").replace(/^.*:/, ""))) return b.id || "skill";
	}
	return null;
};

// The last lines of the transcript (up to 4 MB)
function tail(file) {
	const size = fs.statSync(file).size;
	const len = Math.min(size, TAIL_BYTES);
	const buf = Buffer.alloc(len);
	const fd = fs.openSync(file, "r");
	try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
	return buf.toString("utf8").split("\n");
}
// Context size of the last main-conversation API call, or what a later compact left (as in context-guard)
function lastContext(lines) {
	for (let i = lines.length - 1; i >= 0; i--) {
		if (lines[i].includes('"compact_boundary"')) {
			let b;
			try { b = JSON.parse(lines[i]); } catch { continue; }
			if (b.type === "system" && b.subtype === "compact_boundary" && !b.isSidechain) return b.compactMetadata?.postTokens ?? 0;
		}
		if (!lines[i].includes('"usage"')) continue;
		let j;
		try { j = JSON.parse(lines[i]); } catch { continue; }
		const u = j.message?.usage;
		if (j.type !== "assistant" || j.isSidechain || !u || j.message.model === "<synthetic>") continue;
		return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
	}
	return 0;
}
// Id of the last job-ending call since the previous typed user message, or null. The prompt being submitted
// may already be in the transcript as the last entry: it is skipped, not taken as the previous message.
function commitSincePrevTyped(lines, prompt) {
	let found = null;
	let sawAssistant = false;
	let skippedPrompt = false;
	for (let i = lines.length - 1; i >= 0; i--) {
		if (!lines[i].trim()) continue;
		let e;
		try { e = JSON.parse(lines[i]); } catch { continue; }
		if (e.isSidechain) continue;
		if (e.type === "assistant") sawAssistant = true;
		if (typedByUser(e)) {
			if (!sawAssistant && !skippedPrompt && userText(e).trim() === prompt) { skippedPrompt = true; continue; }
			return found;
		}
		if (found === null) found = doneCallId(e);
	}
	return null; // no typed message in the tail: cannot tell where the turn began
}

try {
	if ((process.env.JOB_DONE || "").toLowerCase() === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8"));
	if (event.agent_id) process.exit(0);
	const prompt = String(event.prompt ?? "").trim();
	if (prompt.startsWith("/") || INJECTED.test(prompt)) process.exit(0);
	if (!event.transcript_path || !fs.existsSync(event.transcript_path)) process.exit(0);
	const lines = tail(event.transcript_path);
	const context = lastContext(lines);
	if (context <= CONTEXT_K * 1000) process.exit(0);
	const commitId = commitSincePrevTyped(lines, prompt);
	if (!commitId) process.exit(0);
	const dir = path.join(os.tmpdir(), "job-done");
	const stateFile = path.join(dir, `${String(event.session_id || "none").replace(/[^\w-]/g, "")}.json`);
	let nudged = null;
	try { nudged = JSON.parse(fs.readFileSync(stateFile, "utf8")).commitId; } catch {}
	if (nudged === commitId) process.exit(0);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(stateFile, JSON.stringify({ commitId }));
	const k = Math.round(context / 1000);
	const text = `[job-done] The job in this session is committed at ~${k}k tokens. If this message starts a new job rather than a question about the finished one, move it to a fresh session first (handoff skill): a fresh session starts at ~40k and every call there costs a third.`;
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
	}));
} catch (err) {
	crashLog("job-done", err);
	// Fail open
}
process.exit(0);
