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

fs.rmSync(dir, { recursive: true, force: true });
for (const s of sessions) fs.rmSync(path.join(stateDir, s + ".json"), { force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
