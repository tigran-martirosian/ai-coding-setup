// job-done: a UserPromptSubmit hook that nudges when a committed job's session gets an unrelated next ask.
// Once a session's job is committed, the next ask often rides on a large context, so every call costs
// several times what a fresh ~40k session costs.
// Adds context (does not block) when the context of the last main-chain request is over JOB_DONE_K (100)
// thousand tokens AND the entries since the previous typed user message hold a Bash `git commit`, `git tag`,
// `git push` or `repo-push.sh` call, or a Skill call of release-setup or deploy. One commit nudges once:
// state in ~/.claude/hooks/state/job-done/<session_id>.json (swept after 2 days) holds the id of the commit call already nudged about.
// Silent for subagents (agent_id), prompts starting with "/", and injected prompts (<task-notification>,
// [System: ...). Sidechain entries are ignored. Fails open. JOB_DONE=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { stateFile, readJson, writeJson, sweep } from "./lib/state.mjs";
import { backEntries, lastUsage, typedByUser, userText, INJECTED } from "./lib/transcript.mjs";
import fs from "node:fs";

const CONTEXT_K = Number(process.env.JOB_DONE_K) || 100;

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

// Id of the last job-ending call since the previous typed user message, or null. The transcript is read backwards
// until that message, however far back. The prompt being submitted may already be in the transcript as the last
// entry: it is skipped, not taken as the previous message.
function commitSincePrevTyped(file, prompt) {
	let found = null;
	let sawAssistant = false;
	let skippedPrompt = false;
	for (const e of backEntries(file)) {
		if (e.type === "assistant") sawAssistant = true;
		if (typedByUser(e)) {
			if (!sawAssistant && !skippedPrompt && userText(e).trim() === prompt) { skippedPrompt = true; continue; }
			return found;
		}
		if (found === null) found = doneCallId(e);
	}
	return null; // no typed message in the file: cannot tell where the turn began
}

runHook("job-done", (event) => {
	if (event.agent_id) return;
	const prompt = String(event.prompt ?? "").trim();
	if (prompt.startsWith("/") || INJECTED.test(prompt)) return;
	if (!event.transcript_path || !fs.existsSync(event.transcript_path)) return;
	// Context size of the last main-conversation API call, or what a later compact left
	const context = lastUsage(backEntries(event.transcript_path), { compact: true })?.tokens ?? 0;
	if (context <= CONTEXT_K * 1000) return;
	const commitId = commitSincePrevTyped(event.transcript_path, prompt);
	if (!commitId) return;
	sweep("job-done", 2);
	const file = stateFile("job-done", sessionKey(event.session_id));
	if (readJson(file, { missing: {} }).commitId === commitId) return;
	writeJson(file, { commitId });
	const k = Math.round(context / 1000);
	const text = `[job-done] The job in this session is committed at ~${k}k tokens. If this message starts a new job rather than a question about the finished one, move it to a fresh session first (handoff skill): a fresh session starts at ~40k and every call there costs a third.`;
	emit.context("UserPromptSubmit", text);
});
