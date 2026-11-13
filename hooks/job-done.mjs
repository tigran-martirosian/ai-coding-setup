// job-done: a UserPromptSubmit and PostToolUse hook about what a session does once work is committed.
// PostToolUse (Bash): a main-session `git commit` or `git merge` that landed ("[branch abc1234]" in its output) tells Claude
// that a piece is done: with steps of the job still left, the next one starts in a fresh session that Claude opens
// itself (handoff skill, spawn_session with the prompt queued), so nothing waits on the user and compaction stays
// the safety net inside one piece (user decision 2026-11-08). Any context size; silent for subagents. Only when a job is
// open: the session's folder (cwd) or the commit's folder (git -C <dir>), each taken up to the folder holding .git, has
// a docs/*plan*.md changed in the last OPEN_HOURS (48) hours that holds a job-list row ("| S3 |", "| 2 |") or an
// unticked "- [ ]", or a HANDOFF.md with an unticked "- [ ]". A one-piece job has no such file and gets nothing.
// UserPromptSubmit: nudges when a committed job's session gets an unrelated next ask.
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
import path from "node:path";

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

// A git commit or merge call (also after -C <dir>, -c key=val, --no-pager), and output that shows one landed:
// "[main 1a2b3c4] msg", "[main (root-commit) 1a2b3c4]", "[detached HEAD 1a2b3c4]"; for a merge "Merge made by" or
// "Fast-forward". An --amend redoes a piece already noted, so it is skipped.
const GIT_PIECE = /\bgit(\s+(-C\s+("[^"]*"|\S+)|-c\s+\S+|--[\w-]+))*\s+(commit|merge)\b/;
const COMMIT_MADE = /^\[[^\]\n]*\s[0-9a-f]{7,}\]|^Merge made by |^Fast-forward\s*$/m;
const PIECE_TEXT = "[job-done] A piece of work is committed. If steps of this job are still left (job list, plan file or HANDOFF), don't start the next one in this session: bring the job list or plan up to date, then hand off with the handoff skill, which opens the fresh session itself with its prompt queued (spawn_session; in Nimbalyst nobody pastes anything, so a build that runs without check-ins keeps running); then end this turn. This wins over a context-guard note to compact. Compaction is only the safety net inside one piece (user decision 2026-11-08). If this was the job's last piece or a one-piece job, carry on with the report.";

const OPEN_HOURS = Number(process.env.JOB_DONE_OPEN_HOURS) || 48;
const STEP_ROW = /^\|\s*S?\d+[a-z]?\s*\|/m; // a job-list row: "| S3 |", "| 2 |", "| S4b |"
const UNTICKED = /^\s*[-*]\s+\[ \]\s/m;
const readText = (file) => { try { return fs.readFileSync(file, "utf8"); } catch (e) { if (e.code === "ENOENT") return ""; throw e; } };

// The folder holding .git (a folder, or a worktree's .git file) at or above dir, or null
function repoRoot(dir) {
	for (let d = path.resolve(dir); ; d = path.dirname(d)) {
		if (fs.existsSync(path.join(d, ".git"))) return d;
		if (path.dirname(d) === d) return null;
	}
}

// Whether a project root has an open job list or plan (the rule in the head comment)
function openJob(root) {
	if (UNTICKED.test(readText(path.join(root, "HANDOFF.md")))) return true;
	const docs = path.join(root, "docs");
	if (!fs.existsSync(docs) || !fs.statSync(docs).isDirectory()) return false;
	const since = Date.now() - OPEN_HOURS * 3600e3;
	return fs.readdirSync(docs).filter((n) => /(^|[-_])plans?([-_.][^/]*)?\.md$/i.test(n)).some((n) => {
		const file = path.join(docs, n);
		if (fs.statSync(file).mtimeMs < since) return false;
		const text = readText(file);
		return STEP_ROW.test(text) || UNTICKED.test(text);
	});
}

function pieceCommitted(event) {
	const command = String(event.tool_input?.command ?? "");
	if (event.tool_name !== "Bash" || !GIT_PIECE.test(command) || /\s--amend\b/.test(command)) return;
	const r = event.tool_response;
	const out = typeof r === "string" ? r : String(r?.stdout ?? "");
	if (!COMMIT_MADE.test(out)) return;
	const cwd = String(event.cwd || process.cwd());
	const dashC = command.match(/\bgit\b[^|;&\n]*?\s-C\s+("([^"]*)"|'([^']*)'|(\S+))/);
	const dirs = [cwd, dashC && path.resolve(cwd, dashC[2] ?? dashC[3] ?? dashC[4])].filter(Boolean);
	const roots = [...new Set(dirs.map(repoRoot).filter(Boolean))];
	if (!roots.some(openJob)) return;
	emit.context("PostToolUse", PIECE_TEXT);
}

runHook("job-done", (event) => {
	if (event.agent_id) return;
	if (event.hook_event_name === "PostToolUse") return pieceCommitted(event);
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
