// Test for hooks/job-done.mjs: made-up small transcripts, hook run as a child process.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/job-done.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-done-test-"));
const runId = "t" + process.pid + "-" + Date.now();
const stateDir = path.join(os.homedir(), ".claude", "hooks", "state", "job-done");
const sessions = [];
let failed = 0;
let n = 0;

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const asst = (ctx, content, extra = {}) => JSON.stringify({
	type: "assistant", timestamp: ago(1),
	message: { id: "m" + Math.random(), model: "claude-x", content,
		usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0 } },
	...extra,
});
const text = (t = "ok") => [{ type: "text", text: t }];
const bash = (cmd, id = "tu_" + Math.random()) => [{ type: "tool_use", id, name: "Bash", input: { command: cmd } }];
const skill = (name) => [{ type: "tool_use", id: "tu_" + Math.random(), name: "Skill", input: { skill: name } }];
const user = (t) => JSON.stringify({ type: "user", timestamp: ago(2), message: { role: "user", content: t } });
const toolResult = () => JSON.stringify({ type: "user", timestamp: ago(1), message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "done" }] } });

function run(name, lines, expectNudge, { event = {}, env = {}, session } = {}) {
	const file = path.join(dir, name + ".jsonl");
	if (Array.isArray(lines)) fs.writeFileSync(file, lines.join("\n") + "\n");
	const sid = session ?? `${runId}-${++n}`;
	sessions.push(sid);
	const input = lines === "broken-event" ? "{not json" : JSON.stringify({ transcript_path: file, session_id: sid, prompt: "next job please", ...event });
	const r = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...process.env, ...env } });
	const out = r.stdout.trim();
	let ok = r.status === 0;
	if (expectNudge) {
		try {
			const j = JSON.parse(out);
			const c = j.hookSpecificOutput.additionalContext;
			ok = ok && j.hookSpecificOutput.hookEventName === "UserPromptSubmit" && !("decision" in j) &&
				c.includes("committed at ~" + expectNudge + "k tokens") && c.includes("handoff skill");
		} catch { ok = false; }
	} else ok = ok && out === "";
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`);
	return out;
}

const committed = (ctx, cmd = 'git commit -m "x"') => [user("build it"), asst(ctx, bash(cmd, "tu_commit")), toolResult(), asst(ctx, text("committed"))];

const out = run("commit-at-150k", committed(150000), 150);
console.log("      " + JSON.parse(out).hookSpecificOutput.additionalContext.slice(0, 120) + "...");
run("commit-at-60k-silent", committed(60000), false);
run("no-commit-silent", [user("build it"), asst(150000, bash("npm test")), toolResult(), asst(150000, text("tests pass"))], false);
run("git-push-nudges", committed(120000, "git push origin main"), 120);
run("git-tag-nudges", committed(120000, "git -C /x tag v1"), 120);
run("repo-push-sh-nudges", committed(120000, "bash audits/repo-push.sh"), 120);
run("release-skill-nudges", [user("ship"), asst(130000, skill("release-setup")), toolResult(), asst(130000, text("released"))], 130);
run("deploy-skill-nudges", [user("ship"), asst(130000, skill("deploy")), toolResult(), asst(130000, text("deployed"))], 130);
run("other-skill-silent", [user("ship"), asst(130000, skill("handoff")), toolResult(), asst(130000, text("done"))], false);
run("commit-before-previous-typed-silent", [user("build"), asst(150000, bash('git commit -m "x"')), toolResult(), asst(150000, text("done")), user("one more"), asst(150000, text("answer"))], false);
run("prompt-already-in-transcript", [...committed(150000), user("next job please")], 150);
run("commit-only-in-sidechain-ignored", [user("build it"), asst(150000, bash('git commit -m "x"'), { isSidechain: true }), toolResult(), asst(150000, text("done"))], false);
run("sidechain-context-ignored", [...committed(150000), asst(20000, text("sub"), { isSidechain: true })], 150);
run("compact-boundary-resets-context", [...committed(150000), JSON.stringify({ type: "system", subtype: "compact_boundary", compactMetadata: { postTokens: 30000 } })], false);
run("command-prompt-silent", committed(150000), false, { event: { prompt: "/clear" } });
run("task-notification-silent", committed(150000), false, { event: { prompt: "<task-notification>x</task-notification>" } });
run("system-prompt-silent", committed(150000), false, { event: { prompt: "[System: something]" } });
run("subagent-silent", committed(150000), false, { event: { agent_id: "abc" } });
run("off-switch", committed(150000), false, { env: { JOB_DONE: "off" } });

// One commit nudges once: same session, same transcript, second message is silent
const same = `${runId}-same`;
run("first-message-after-commit", committed(150000), 150, { session: same });
run("second-message-after-same-commit-silent", committed(150000), false, { session: same });
// A new commit in the same session nudges again
run("new-commit-nudges-again", committed(150000, 'git commit -m "y"').map((l) => l.replace("tu_commit", "tu_commit2")), 150, { session: same });

run("broken-lines", ["not json", "{\"type\":", ""], false);
run("empty-file", [""], false);
run("missing-file", null, false);
run("broken-event", "broken-event", false);

// PostToolUse: a main-session git commit that made a commit tells Claude to hand the next piece to a fresh session,
// only when the project has an open job: made-up projects (a .git folder each) with and without one
const project = (name, files) => {
	const root = path.join(dir, name);
	fs.mkdirSync(path.join(root, ".git"), { recursive: true });
	for (const [rel, text] of Object.entries(files)) { fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true }); fs.writeFileSync(path.join(root, rel), text); }
	return root;
};
const ROWS = "## Job list\n\n| Step | Job |\n|---|---|\n| S1 | build it |\n| S2 | test it |\n";
const OPEN = project("open", { "docs/2026-11-09-x-plan.md": ROWS });
const NONE = project("none", { "docs/notes.md": "| S1 | not a plan file |\n", "HANDOFF.md": "## Next\n- [x] done\n" });
const OLD = project("old", { "docs/old-plan.md": ROWS });
const old = new Date(Date.now() - 3 * 86400e3); fs.utimesSync(path.join(OLD, "docs/old-plan.md"), old, old);
const HANDOFF = project("handoff", { "HANDOFF.md": "## Next\n- [ ] step 3: the tests\n" });
const TICKED = project("ticked", { "docs/a-plan.md": "- [x] one\n- [x] two\n" });
function post(name, command, stdout, expectNote, extra = {}) {
	const ev = { hook_event_name: "PostToolUse", session_id: `${runId}-post`, tool_name: "Bash", cwd: path.join(OPEN, "docs"),
		tool_input: { command }, tool_response: { stdout, stderr: "", interrupted: false }, ...extra };
	const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(ev), encoding: "utf8", env: { ...process.env, ...(extra.env || {}) } });
	const out = r.stdout.trim();
	let ok = r.status === 0;
	if (expectNote) {
		try {
			const h = JSON.parse(out).hookSpecificOutput;
			ok = ok && h.hookEventName === "PostToolUse" && h.additionalContext.includes("A piece of work is committed") &&
				h.additionalContext.includes("handoff skill") && h.additionalContext.includes("spawn_session") && h.additionalContext.includes("nobody pastes") && h.additionalContext.includes("wins over a context-guard");
		} catch { ok = false; }
	} else ok = ok && out === "";
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`);
}
const made = "[main 1a2b3c4] Brewery hall roof\n 3 files changed, 40 insertions(+)";
post("post-commit-made-notes", 'git commit -m "roof"', made, true);
post("post-commit-with-C-notes", 'git -C "C:/x y" commit -am "x"', made, true);
post("post-root-commit-notes", 'git commit -m "first"', "[master (root-commit) 9f8e7d6] first", true);
post("post-commit-in-chain-notes", 'git add a && git commit -m "x" && git log -1', "[feat/x 0abcdef1] x\n1 file changed", true);
post("post-string-response-notes", 'git commit -m "x"', null, true, { tool_response: made });
post("post-detached-head-notes", 'git commit -m "x"', "[detached HEAD 1a2b3c4] x", true);
post("post-dash-c-config-notes", 'git -c user.name=x --no-pager commit -m "x"', made, true);
post("post-merge-notes", "git merge --no-ff step-3", "Merge made by the 'ort' strategy.\n a | 1 +", true);
post("post-fast-forward-merge-notes", "git merge step-3", "Updating 1a2b3c4..5d6e7f8\nFast-forward\n a | 1 +", true);
post("post-merge-conflict-silent", "git merge step-3", "Auto-merging a\nCONFLICT (content): Merge conflict in a", false);
post("post-amend-silent", 'git commit --amend --no-edit', made, false);
post("post-nothing-to-commit-silent", 'git commit -m "x"', "On branch main\nnothing to commit, working tree clean", false);
post("post-hook-refused-commit-silent", 'git commit -m "x"', "", false);
post("post-git-log-silent", "git log --oneline -3", "1a2b3c4 x", false);
post("post-commit-word-in-echo-silent", 'echo "[main 1a2b3c4] x"', made, false);
post("post-non-bash-silent", 'git commit -m "x"', made, false, { tool_name: "Edit" });
post("post-subagent-silent", 'git commit -m "x"', made, false, { agent_id: "abc" });
post("post-off-switch", 'git commit -m "x"', made, false, { env: { JOB_DONE: "off" } });
post("post-no-plan-silent", 'git commit -m "x"', made, false, { cwd: NONE });
post("post-plan-older-than-48h-silent", 'git commit -m "x"', made, false, { cwd: OLD });
post("post-only-ticked-boxes-silent", 'git commit -m "x"', made, false, { cwd: TICKED });
// A "docs" that is a file, not a folder: silent and no crash (a crash also exits 0, so the crash log is checked)
const docsCrashLog = path.join(dir, "docsfile-crash.log");
post("post-docs-is-a-file-silent", 'git commit -m "x"', made, false, { cwd: project("docsfile", { "docs": "not a folder\n" }), env: { HOOK_ERRORS_LOG: docsCrashLog } });
{ const ok = !fs.existsSync(docsCrashLog); if (!ok) failed++; console.log(`${ok ? "PASS" : "FAIL"}  post-docs-is-a-file-no-crash${ok ? "" : "  -> " + fs.readFileSync(docsCrashLog, "utf8").trim()}`); }
post("post-handoff-unticked-notes", 'git commit -m "x"', made, true, { cwd: HANDOFF });
post("post-dash-C-into-open-project-notes", `git -C "${OPEN.replace(/\\/g, "/")}" commit -m "x"`, made, true, { cwd: NONE });
post("post-dash-C-into-project-without-plan-silent", `git -C "${NONE.replace(/\\/g, "/")}" commit -m "x"`, made, false, { cwd: TICKED });
post("post-no-git-folder-silent", 'git commit -m "x"', made, false, { cwd: os.tmpdir() });

fs.rmSync(dir, { recursive: true, force: true });
for (const s of sessions) fs.rmSync(path.join(stateDir, s + ".json"), { force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
