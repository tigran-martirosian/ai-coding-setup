// Tests for hooks/turn-cap.mjs on made-up transcripts. Run: node tests/test-turn-cap.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/turn-cap.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "turn-cap-"));
let failed = 0;
let n = 0;

const user = (text) => JSON.stringify({ type: "user", uuid: "u" + ++n, message: { role: "user", content: text } });
// One assistant request with one tool call; ctx is the context size of the request in tokens
const step = (ctx, tool = "Read", input = { file_path: "/a/b.txt" }) => JSON.stringify({
	type: "assistant", uuid: "a" + ++n,
	message: { id: "m" + n, model: "claude-x", content: [{ type: "tool_use", id: "t" + n, name: tool, input }],
		usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0 } },
});
const steps = (count, ctx, tool, input) => Array.from({ length: count }, () => step(ctx, tool, input));

// The hook sees the transcript with the current call as its last request
function run(name, lines, expect, { event = {}, env = {} } = {}) {
	const file = path.join(dir, name.replace(/\W+/g, "-") + ".jsonl");
	fs.writeFileSync(file, lines.join("\n") + "\n");
	const e = { tool_name: "Read", tool_input: { file_path: "/a/b.txt" }, transcript_path: file, session_id: "s", ...event };
	const childEnv = { ...process.env, ...env };
	for (const k of Object.keys(childEnv)) if (k.startsWith("TURN_CAP") && !(k in env)) delete childEnv[k];
	const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(e), encoding: "utf8", env: childEnv });
	const out = r.stdout.trim();
	let denied = false, reason = "";
	if (out) {
		const j = JSON.parse(out).hookSpecificOutput;
		denied = j.permissionDecision === "deny";
		reason = j.permissionDecisionReason;
	}
	const ok = r.status === 0 && denied === (expect !== false) && (typeof expect !== "string" || reason.includes(expect));
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `  -> denied=${denied} ${reason.slice(0, 120)}`}`);
}

const CHILD = "CHILD JOB: do one small thing";
const K = 120000; // a context over the 100k turn limit
// Talking session: at most 10 tool steps per message once the context is 100k or more
run("talking: 9 steps at 120k are fine", [user("hi"), ...steps(9, K)], false);
run("talking: 10 steps at 120k are refused", [user("hi"), ...steps(10, K)], "[turn-cap]");
run("talking: 12 steps at 50k are fine (cheap steps)", [user("hi"), ...steps(12, 50000)], false);
run("talking: a new message starts the count again", [user("hi"), ...steps(12, K), user("again"), ...steps(2, K)], false);
run("talking: a background notification is not a new message", [user("hi"), ...steps(6, K), user("<task-notification>done</task-notification>"), ...steps(4, K)], "[turn-cap]");
// Child session: 20 steps
run("child: 19 steps at 120k are fine", [user(CHILD), ...steps(19, K)], false, { env: { TURN_CAP_SESSION_STEPS: "100" } });
run("child: 20 steps at 120k are refused", [user(CHILD), ...steps(20, K)], "This child job");
// Edits
const edit = (file = "/a/b.txt") => step(K, "Edit", { file_path: file });
run("talking: a third edit step is refused", [user("hi"), edit(), edit(), edit()], "does not build", { event: { tool_name: "Edit", tool_input: { file_path: "/a/b.txt" } } });
run("talking: the first edit step is fine", [user("hi"), edit()], false, { event: { tool_name: "Edit", tool_input: { file_path: "/a/b.txt" } } });
run("talking: edits of HANDOFF.md are not counted", [user("hi"), edit("/p/HANDOFF.md"), edit("/p/HANDOFF.md"), edit("/p/HANDOFF.md")], false, { event: { tool_name: "Edit", tool_input: { file_path: "/p/HANDOFF.md" } } });
// Always allowed
run("handing work on is allowed past the cap", [user("hi"), ...steps(14, K, "Agent", { prompt: "x" })], false, { event: { tool_name: "Agent", tool_input: { prompt: "x" } } });
run("spawn_session is allowed past the cap", [user("hi"), ...steps(14, K)], false, { event: { tool_name: "mcp__host__spawn_session", tool_input: {} } });
run("handoff-brief.mjs alone is allowed", [user("hi"), ...steps(14, K)], false, { event: { tool_name: "Bash", tool_input: { command: "node ~/.claude/hooks/handoff-brief.mjs --hook" } } });
run("another shell command is refused", [user("hi"), ...steps(14, K)], "[turn-cap]", { event: { tool_name: "Bash", tool_input: { command: "ls" } } });
run("subagent calls are left alone", [user("hi"), ...steps(14, K)], false, { event: { agent_id: "abc" } });
run("TURN_CAP=off switches it off", [user("hi"), ...steps(14, K)], false, { env: { TURN_CAP: "off" } });
// Session rule: 15 tool steps at over 100k tokens anywhere in the session, then restart in a fresh one
run("session: 16 earlier big steps are refused", [user("one"), ...steps(16, K), user("two"), step(K)], "restart in a fresh session");
run("session: 14 earlier big steps are fine", [user("one"), ...steps(14, K), user("two"), step(K)], false);
run("session: small steps do not count", [user("one"), ...steps(30, 60000), user("two"), step(K)], false);
run("session: HANDOFF.md can still be written", [user("one"), ...steps(16, K), user("two"), step(K, "Write", { file_path: "/p/HANDOFF.md" })], false, { event: { tool_name: "Write", tool_input: { file_path: "/p/HANDOFF.md" } } });
// Failing safe
run("missing transcript lets the call through", [], false, { event: { transcript_path: path.join(dir, "nope.jsonl") } });
run("empty transcript lets the call through", [""], false);

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
