// Test for hooks/background-tasks.mjs: made-up small transcripts, hook run as a child process.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

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

// expect: "block", "nudge" or "" (no output)
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
		if (expect === "block") ok = ok && J(JSON.parse(out)) === J({ decision: "block", reason: "[background-tasks] duplicate of the task notification already handled" });
		else if (expect === "nudge") {
			const h = JSON.parse(out).hookSpecificOutput;
			ok = ok && h.hookEventName === "PreToolUse" && h.additionalContext.startsWith("[background-tasks] Background costs two extra") && !("permissionDecision" in h);
		} else ok = ok && out === "";
	} catch { ok = false; }
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200) + r.stderr.slice(0, 200)}`);
}
const prompt = (p) => ({ event: { prompt: p } });
const tool = (tool_name, tool_input) => ({ event: { hook_event_name: "PreToolUse", tool_name, tool_input } });

// UserPromptSubmit
run("bash-duplicate-blocked", [...bashBg(), notified("bxyz1", "toolu_b")], "block", prompt(settled(CMD)));
run("agent-duplicate-blocked", [...agentBg(), notified("a1234", "toolu_a")], "block", prompt(settled("S3: build the shop")));
run("mixed-batch-blocked", [...bashBg(), ...agentBg(), notified("a1234", "toolu_a"), midTurn("bxyz1", "toolu_b")], "block", prompt(settled(CMD, "S3: build the shop")));
run("bash-quoted-by-description", [call("Bash", "toolu_d", { command: "node research.mjs", description: "Web research: shop reviews", run_in_background: true }), result("toolu_d", "Command running in background with ID: bq1"), notified("bq1", "toolu_d")], "block", prompt(settled("Web research: shop reviews")));
run("timed-out-foreground-bash", [call("Bash", "toolu_t", { command: CMD }), result("toolu_t", "Command did not complete within its 120s timeout and was moved to the background (ID: bt9). Output is being written to: x"), notified("bt9", "toolu_t")], "block", prompt(settled(CMD)));
run("stand-in-note-quoted", [...bashBg("toolu_s", "bs1").map((l) => l.replace(J(CMD), J("ls tools"))), notified("bs1", "toolu_s")], "block", prompt(settled("ls tools\n\n# WHAT THIS DOES: (no note given) ls tools")));
run("item-without-summary-passes", [...agentBg(), notified("a1234", "toolu_a")], "", prompt(settled("S3: build the shop") + '\n- "some other job" completed\n'));
run("odd-status-still-checked", [...agentBg(), notified("a1234", "toolu_a")], "block", prompt(settled("S3: build the shop").replace('" completed', '" failed (exit 1)')));
run("summary-with-list-lines", [...agentBg(), notified("a1234", "toolu_a")], "block", prompt(settled("S3: build the shop").replace("Summary: S3: build the shop", 'Summary: **Against the request:**\n- "kill counter": nothing was built.')));
run("agent-step-blocked", [...agentBg(), notified("a1234", "toolu_a")], "block", { ...prompt(settled("grep -rn shop src", "S3: build the shop")), subagents: { a1234: [call("Bash", "toolu_x", { command: "grep -rn shop src" })] } });
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
run("nudge-bash-background", null, "nudge", tool("Bash", { command: "sleep 60", run_in_background: true }));
run("nudge-agent-background", null, "nudge", tool("Agent", { description: "S2", prompt: "x", run_in_background: true }));
run("nudge-task-background", null, "nudge", tool("Task", { description: "S2", prompt: "x", run_in_background: true }));
run("silent-bash-foreground", null, "", tool("Bash", { command: "sleep 60", timeout: 600000 }));
run("silent-agent-foreground", null, "", tool("Agent", { description: "S2", prompt: "x", run_in_background: false }));
run("silent-other-tool", null, "", tool("Read", { file_path: "x", run_in_background: true }));
run("nudge-off-switch", null, "", { ...tool("Bash", { command: "sleep 60", run_in_background: true }), env: { BACKGROUND_TASKS: "off" } });

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
