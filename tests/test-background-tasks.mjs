// Test for ~/.claude/hooks/background-tasks.mjs: made-up small transcripts, hook run as a child process.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/background-tasks.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "background-tasks-"));
let failed = 0;

const J = JSON.stringify;
const call = (name, id, input) => J({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const result = (id, text) => J({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content: [{ type: "text", text }] }] } });
const notice = (task, use) => `<task-notification>\n<task-id>${task}</task-id>\n<tool-use-id>${use}</tool-use-id>\n<status>completed</status>\n<summary>done</summary>\n</task-notification>`;
const notified = (task, use) => J({ type: "user", origin: { kind: "task-notification" }, message: { role: "user", content: notice(task, use) } });
const midTurn = (task, use) => J({ type: "attachment", attachment: { type: "queued_command", prompt: notice(task, use) } });
const typed = (text) => J({ type: "user", message: { role: "user", content: text } });
const settled = (...items) => "[System: background task(s) you launched have settled:\n" +
	items.map((t) => `- "${t}" completed\n  Summary: ${t.split("\n")[0]}\n`).join("\n");

const CMD = "python tools/deploy.py send\n\n# WHAT THIS DOES: sends the pack";
const bashBg = (id = "toolu_b", task = "bxyz1") => [call("Bash", id, { command: CMD, run_in_background: true }), result(id, `Command running in background with ID: ${task}. Output is being written to: C:\\tmp\\${task}.output`)];
const agentBg = (desc = "S3: build the shop", id = "toolu_a", task = "a1234") => [call("Agent", id, { description: desc, prompt: "do it", run_in_background: true }), result(id, `Async agent launched successfully.\nagentId: ${task} (internal ID)`)];

// expect: "recap" (pass with the reply-in-plain-lines note), "nudge", "refuse" or "" (no output)
function run(name, lines, expect, { event = {}, env = {}, subagents = null } = {}) {
	const file = path.join(dir, name + ".jsonl");
	if (Array.isArray(lines)) fs.writeFileSync(file, lines.join("\n") + "\n");
	if (subagents) {
		const sub = path.join(dir, name, "subagents");
		fs.mkdirSync(sub, { recursive: true });
		for (const [id, ls] of Object.entries(subagents)) fs.writeFileSync(path.join(sub, `agent-${id}.jsonl`), ls.join("\n") + "\n");
	}
	const input = lines === "broken-event" ? "{not json" : J({ hook_event_name: "UserPromptSubmit", transcript_path: file, session_id: name, ...event });
	const r = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...process.env, ...env } });
	const out = r.stdout.trim();
	let ok = r.status === 0;
	try {
		if (expect === "recap") {
			const o = JSON.parse(out), h = o.hookSpecificOutput;
			ok = ok && !("decision" in o) && h.hookEventName === "UserPromptSubmit" && h.additionalContext.startsWith("[background-tasks] This settled notice repeats");
		}
		else if (expect === "block") {
			const o = JSON.parse(out);
			ok = ok && o.decision === "block" && o.reason.startsWith("[background-tasks] Your reply says a helper still runs");
		} else if (expect === "nudge") {
			const h = JSON.parse(out).hookSpecificOutput;
			ok = ok && h.hookEventName === "PreToolUse" && h.additionalContext.startsWith("[background-tasks] Background costs two extra") && !("permissionDecision" in h);
		} else if (expect === "refuse") {
			const h = JSON.parse(out).hookSpecificOutput;
			ok = ok && h.hookEventName === "PreToolUse" && h.permissionDecision === "deny" && h.permissionDecisionReason.startsWith("[background-tasks] Refused") && !("additionalContext" in h);
		} else ok = ok && out === "";
	} catch { ok = false; }
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200) + r.stderr.slice(0, 200)}`);
}
const prompt = (p) => ({ event: { prompt: p } });
const tool = (tool_name, tool_input) => ({ event: { hook_event_name: "PreToolUse", tool_name, tool_input } });

// UserPromptSubmit
run("bash-duplicate-recapped", [...bashBg(), notified("bxyz1", "toolu_b")], "recap", prompt(settled(CMD)));
run("agent-duplicate-recapped", [...agentBg(), notified("a1234", "toolu_a")], "recap", prompt(settled("S3: build the shop")));
run("mixed-batch-recapped", [...bashBg(), ...agentBg(), notified("a1234", "toolu_a"), midTurn("bxyz1", "toolu_b")], "recap", prompt(settled(CMD, "S3: build the shop")));
run("bash-quoted-by-description", [call("Bash", "toolu_d", { command: "node research.mjs", description: "Web research: shop reviews", run_in_background: true }), result("toolu_d", "Command running in background with ID: bq1"), notified("bq1", "toolu_d")], "recap", prompt(settled("Web research: shop reviews")));
run("timed-out-foreground-bash", [call("Bash", "toolu_t", { command: CMD }), result("toolu_t", "Command did not complete within its 120s timeout and was moved to the background (ID: bt9). Output is being written to: x"), notified("bt9", "toolu_t")], "recap", prompt(settled(CMD)));
run("stand-in-note-quoted", [...bashBg("toolu_s", "bs1").map((l) => l.replace(J(CMD), J("ls tools"))), notified("bs1", "toolu_s")], "recap", prompt(settled("ls tools\n\n# WHAT THIS DOES: (no note given) ls tools")));
run("item-without-summary-passes", [...agentBg(), notified("a1234", "toolu_a")], "", prompt(settled("S3: build the shop") + '\n- "some other job" completed\n'));
run("odd-status-still-checked", [...agentBg(), notified("a1234", "toolu_a")], "recap", prompt(settled("S3: build the shop").replace('" completed', '" failed (exit 1)')));
run("summary-with-list-lines", [...agentBg(), notified("a1234", "toolu_a")], "recap", prompt(settled("S3: build the shop").replace("Summary: S3: build the shop", 'Summary: **Against the request:**\n- "kill counter": nothing was built.')));
run("agent-step-recapped", [...agentBg(), notified("a1234", "toolu_a")], "recap", { ...prompt(settled("grep -rn shop src", "S3: build the shop")), subagents: { a1234: [call("Bash", "toolu_x", { command: "grep -rn shop src" })] } });
run("agent-step-agent-unnotified", [...agentBg()], "", { ...prompt(settled("grep -rn shop src")), subagents: { a1234: [call("Bash", "toolu_x", { command: "grep -rn shop src" })] } });
run("one-task-unnotified-passes", [...bashBg(), ...agentBg(), notified("a1234", "toolu_a")], "", prompt(settled(CMD, "S3: build the shop")));
run("resumed-agent-not-renotified", [...agentBg(), notified("a1234", "toolu_a"), call("SendMessage", "toolu_m", { to: "a1234", message: "go on" })], "", prompt(settled("S3: build the shop")));
run("relaunched-command-not-renotified", [...bashBg("toolu_1", "b1"), notified("b1", "toolu_1"), ...bashBg("toolu_2", "b2")], "", prompt(settled(CMD)));
run("unknown-task-passes", [...bashBg(), notified("bxyz1", "toolu_b")], "", prompt(settled("make deploy")));
run("stop-feedback-is-no-notification", [...bashBg(), J({ type: "user", message: { role: "user", content: "<task-notification>\n<summary>Stop hook feedback</summary>\n</task-notification>" } })], "", prompt(settled(CMD)));
run("sidechain-notification-ignored", [...bashBg(), J({ ...JSON.parse(notified("bxyz1", "toolu_b")), isSidechain: true })], "", prompt(settled(CMD)));
run("typed-message-passes", [...bashBg(), notified("bxyz1", "toolu_b")], "", prompt("is the deploy done?"));
run("subagent-passes", [...bashBg(), notified("bxyz1", "toolu_b")], "", { event: { prompt: settled(CMD), agent_id: "a99" } });
run("off-switch", [...bashBg(), notified("bxyz1", "toolu_b")], "", { ...prompt(settled(CMD)), env: { BACKGROUND_TASKS: "off" } });
run("missing-transcript", null, "", prompt(settled(CMD)));
run("broken-lines", ["not json", "{\"type\":", ""], "", prompt(settled(CMD)));
run("broken-event", "broken-event", "");

// PreToolUse
run("refuse-bash-background", null, "refuse", tool("Bash", { command: "sleep 60", run_in_background: true }));
run("refuse-agent-background", null, "refuse", tool("Agent", { description: "S2", prompt: "x", run_in_background: true }));
run("refuse-task-background", null, "refuse", tool("Task", { description: "S2", prompt: "x", run_in_background: true }));
run("silent-bash-foreground", null, "", tool("Bash", { command: "sleep 60", timeout: 600000 }));
run("silent-agent-foreground", null, "", tool("Agent", { description: "S2", prompt: "x", run_in_background: false }));
run("silent-other-tool", null, "", tool("Read", { file_path: "x", run_in_background: true }));
run("nudge-off-switch", null, "", { ...tool("Bash", { command: "sleep 60", run_in_background: true }), env: { BACKGROUND_TASKS: "off" } });

const SERVE = [call("Bash", "toolu_v", { command: "npm run dev", run_in_background: true }), result("toolu_v", "Command running in background with ID: bsv1")];
run("refuse-agent-no-flag", null, "refuse", tool("Agent", { description: "S2", prompt: "x" }));
run("allow-agent-beside", null, "", tool("Agent", { description: "S3 beside S1: shop", prompt: "x" }));
run("allow-agent-other-running", [...agentBg()], "", tool("Agent", { description: "S4", prompt: "x" }));
run("refuse-agent-other-finished", [...agentBg(), notified("a1234", "toolu_a")], "refuse", tool("Agent", { description: "S4", prompt: "x" }));
run("refuse-agent-other-stopped", [...agentBg(), call("TaskStop", "toolu_k", { task_id: "a1234" })], "refuse", tool("Agent", { description: "S4", prompt: "x" }));
run("allow-bash-other-running", [...agentBg()], "", tool("Bash", { command: "npm test", run_in_background: true }));
run("allow-bash-game-server", null, "", tool("Bash", { command: "cd mdk && ./gradlew runServer --args nogui > boot.txt 2>&1", run_in_background: true }));
run("allow-bash-dev-server", null, "", tool("Bash", { command: "npm run dev", run_in_background: true }));
run("allow-bash-tail-follow", null, "", tool("Bash", { command: "tail -n 50 -f run/logs/latest.log", run_in_background: true }));
run("allow-bash-beside", null, "", tool("Bash", { command: "npm test", description: "tests beside the build", run_in_background: true }));
run("refuse-bash-plain", null, "refuse", tool("Bash", { command: "node build.mjs > /dev/null 2>&1", run_in_background: true }));
run("refuse-bash-plain-node-build-js", null, "refuse", tool("Bash", { command: "node build.js", run_in_background: true }));
run("refuse-bash-docker-compose-detached", null, "refuse", tool("Bash", { command: "docker compose up -d", run_in_background: true }));
run("refuse-bash-tsc-without-watch", null, "refuse", tool("Bash", { command: "npx tsc -p .", run_in_background: true }));
run("refuse-bash-w-flag-not-tsc", null, "refuse", tool("Bash", { command: "wc -w notes.txt", run_in_background: true }));
for (const [name, command] of [
	["manage-runserver", "python manage.py runserver 0.0.0.0:8000"],
	["node-server-file", "node server.js"],
	["node-path-server", "node dist/api-server.mjs --port 3000"],
	["npx-serve", "npx serve dist"],
	["serve-s", "serve -s build"],
	["docker-compose-up", "docker compose up"],
	["docker-dash-compose-up", "docker-compose up web"],
	["npm-run-preview", "npm run preview"],
	["pnpm-run-preview", "pnpm run preview"],
	["yarn-run-preview", "yarn run preview"],
	["streamlit", "streamlit run app.py"],
	["npx-vite", "npx vite --port 5173"],
	["flask-run", "flask run --port 5000"],
	["rails-s", "rails s"],
	["rails-server", "bin/rails server -p 3001"],
	["http-server", "http-server ./public"],
	["live-server", "live-server ."],
	["python-http-server", "python -m http.server 8080"],
	["uvicorn", "uvicorn app:app --reload"],
	["gunicorn", "gunicorn app:app"],
	["watch-flag", "jest --watch"],
	["tsc-w", "tsc -w"],
	["tsc-w-npx", "npx tsc -p . -w"],
	["upper-case", "NPM RUN DEV"],
	["upper-case-uvicorn", "UVICORN app:app"],
]) run("allow-bash-" + name, null, "", tool("Bash", { command, run_in_background: true }));
{
	const r = spawnSync(process.execPath, [HOOK], { input: J({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test", run_in_background: true } }), encoding: "utf8" });
	const ok = r.stdout.includes("If it is a server or watcher that never ends, re-send it with `beside` in its description.");
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  shell-refusal-offers-beside-for-servers`);
}
run("refuse-bash-only-server-running", [...SERVE], "refuse", tool("Bash", { command: "npm test", run_in_background: true }));
run("refuse-powershell-background", null, "refuse", tool("PowerShell", { command: "Start-Sleep 60", run_in_background: true }));
run("allow-powershell-watcher", null, "", tool("PowerShell", { command: "Get-Content log.txt -Wait", run_in_background: true }));
run("allow-subagent-bash-background", null, "", { event: { hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "npm test", run_in_background: true }, agent_id: "a99" } });
run("warn-mode-bash-note", null, "nudge", { ...tool("Bash", { command: "npm test", run_in_background: true }), env: { BACKGROUND_TASKS: "warn" } });
run("warn-mode-agent-no-flag-note", null, "nudge", { ...tool("Agent", { description: "S2", prompt: "x" }), env: { BACKGROUND_TASKS: "warn" } });
run("off-switch-agent-no-flag", null, "", { ...tool("Agent", { description: "S2", prompt: "x" }), env: { BACKGROUND_TASKS: "off" } });
run("desktop-app-agent-note", null, "nudge", { ...tool("Agent", { description: "S2", prompt: "x" }), env: { CLAUDE_CODE_ENTRYPOINT: "claude-desktop" } });
run("vscode-agent-note", null, "nudge", { ...tool("Agent", { description: "S2", prompt: "x" }), env: { CLAUDE_CODE_ENTRYPOINT: "claude-vscode" } });
run("vscode-bash-still-refused", null, "refuse", { ...tool("Bash", { command: "npm test", run_in_background: true }), env: { CLAUDE_CODE_ENTRYPOINT: "claude-vscode" } });
run("sdk-agent-still-refused", null, "refuse", { ...tool("Agent", { description: "S2", prompt: "x" }), env: { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" } });

// Stop: a reply that waits on a helper while nothing of the session runs
const say = (text) => J({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const stop = (msg, extra = {}) => ({ event: { hook_event_name: "Stop", last_assistant_message: msg, ...extra } });
const LATE = "It's now adding your two late requests to the plan. I'll save the plan once it's done.";
const finished = [...agentBg("Plan: whole look"), notified("a1234", "toolu_a"), typed("[System: background task(s) you launched have settled:"), say(LATE)];
run("stop-blocks-waiting-on-finished-agent", finished, "block", stop(LATE));
run("stop-blocks-waiting-no-tasks-at-all", [typed("do it"), say("x")], "block", stop("The reviewer is still running; I'll report when it finishes."));
run("stop-blocks-standing-by", [...finished], "block", stop("I'm waiting for the planner to come back."));
run("stop-passes-agent-live", [...agentBg(), say(LATE)], "", stop(LATE));
run("stop-passes-resumed-agent", [...agentBg(), notified("a1234", "toolu_a"), call("SendMessage", "toolu_m", { to: "a1234", message: "add two items" }), result("toolu_m", "sent")], "", stop(LATE));
run("stop-passes-server-live", [...SERVE], "", stop("The dev server is still running at :5173."));
run("stop-passes-plain-reply", finished, "", stop("Done: the plan is saved to docs/plan.md."));
run("stop-passes-wakeup-this-turn", [...finished, call("ScheduleWakeup", "toolu_w", { delaySeconds: 600 })], "", stop("CI is still running; I'll check once it's done."));
run("stop-passes-child-session", [...finished, call("mcp__nimbalyst-host__send_prompt", "toolu_p", { prompt: "x" })], "", stop("I'll report once it's done."));
run("stop-old-wakeup-does-not-count", [call("ScheduleWakeup", "toolu_w", { delaySeconds: 600 }), typed("next ask"), ...finished], "block", stop(LATE));
run("stop-wakeup-before-settled-notice-counts", [typed("watch CI"), call("ScheduleWakeup", "toolu_w", { delaySeconds: 600 }), ...finished], "", stop(LATE));
run("stop-blocks-with-dev-server-up", [...SERVE, ...finished], "block", stop(LATE));
run("stop-blocks-curly-apostrophe", finished, "block", stop("It’s now adding your two late requests."));
run("stop-blocks-bare-waiting", finished, "block", stop("Waiting for the reviewer."));
run("stop-blocks-resumed-will-notify", finished, "block", stop("The agent was resumed and will notify again."));
run("stop-passes-resumed-by-name", [call("Agent", "toolu_a", { description: "Plan", prompt: "x", name: "planner" }), result("toolu_a", "agentId: a1234"), notified("a1234", "toolu_a"), call("SendMessage", "toolu_m", { to: "planner", message: "two more" })], "", stop(LATE));
for (const [name, text] of [
	["description-when-finished", "The hook blocks the stop when the task is finished."],
	["needs-you-once-done", "Needs you: reload the window once the build is done."],
	["nothing-still-running", "Nothing is still running."],
	["while-still-running", "The row shows elapsed time while the agent is still running."],
	["question-still-running", "Is it still running? No, it finished at 14:02."],
]) run("stop-passes-" + name, finished, "", stop(text));
run("stop-hook-active-passes", finished, "", stop(LATE, { stop_hook_active: true }));
run("stop-subagent-passes", finished, "", stop(LATE, { agent_id: "a99" }));
run("stop-off-switch", finished, "", { ...stop(LATE), env: { BACKGROUND_TASKS: "off" } });

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
