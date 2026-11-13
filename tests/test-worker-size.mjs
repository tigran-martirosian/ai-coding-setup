// Test for hooks/worker-size.mjs: made-up subagent transcripts, hook run as a child process.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/worker-size.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-size-test-"));
const stateDir = path.join(os.tmpdir(), "worker-size");
const tag = "t" + process.pid;
let failed = 0;
let n = 0;

const asst = (ctx) => JSON.stringify({
	type: "assistant", isSidechain: true, agentId: "x", timestamp: new Date().toISOString(),
	message: { id: "m" + Math.random(), model: "claude-x", content: [{ type: "text", text: "hi" }],
		usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0 } },
});
const user = () => JSON.stringify({ type: "user", isSidechain: true, message: { role: "user", content: "next" } });

// A parent transcript path plus the subagent file under <session>/subagents/ for one made-up helper
function helper(agentId, ctxList) {
	const session = "sess-" + tag;
	const parent = path.join(dir, session + ".jsonl");
	fs.writeFileSync(parent, asst(500000) + "\n"); // the parent's own size must not be read
	const sub = path.join(dir, session, "subagents");
	fs.mkdirSync(sub, { recursive: true });
	const file = path.join(sub, `agent-${agentId}.jsonl`);
	fs.writeFileSync(file, ctxList.flatMap((c) => [asst(c), user()]).join("\n") + "\n");
	return { session, parent, file };
}

function run(name, expectNudge, { input, env = {} } = {}) {
	const r = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...process.env, ...env } });
	const out = r.stdout.trim();
	let ok = r.status === 0;
	if (expectNudge) {
		try {
			const j = JSON.parse(out);
			ok = ok && j.hookSpecificOutput.hookEventName === "PostToolUse" &&
				j.hookSpecificOutput.additionalContext.startsWith("[worker-size]") &&
				j.hookSpecificOutput.additionalContext.includes(`~${expectNudge}k tokens`);
		} catch { ok = false; }
	} else ok = ok && out === "";
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`);
	return out;
}
const ev = (h, id, extra = {}) => JSON.stringify({ hook_event_name: "PostToolUse", session_id: h.session, transcript_path: h.parent, agent_id: id, ...extra });

const ids = [];
const newId = () => { const id = `${tag}-${++n}`; ids.push(id); return id; };

// main session: no agent_id, even over the limit
{
	const id = newId(); const h = helper(id, [300000]);
	run("main-session-silent", 0, { input: ev(h, undefined) });
}
// one helper climbing: 120k silent, 160k nudges, 170k silent, 260k nudges
{
	const id = newId(); const h = helper(id, [120000]);
	run("subagent-120k-silent", 0, { input: ev(h, id) });
	fs.writeFileSync(h.file, [asst(120000), asst(160000), user()].join("\n") + "\n");
	run("subagent-160k-nudges", 160, { input: ev(h, id) });
	fs.writeFileSync(h.file, [asst(160000), asst(170000), user()].join("\n") + "\n");
	run("subagent-170k-silent-again", 0, { input: ev(h, id) });
	fs.writeFileSync(h.file, [asst(170000), asst(260000), user()].join("\n") + "\n");
	run("subagent-260k-nudges", 260, { input: ev(h, id) });
	// a compact drops it to 30k, then it climbs past the line again: warned again
	fs.writeFileSync(h.file, [asst(260000), asst(30000), user()].join("\n") + "\n");
	run("after-compact-30k-silent", 0, { input: ev(h, id) });
	fs.writeFileSync(h.file, [asst(30000), asst(155000), user()].join("\n") + "\n");
	run("after-compact-155k-nudges-again", 155, { input: ev(h, id) });
}
{
	const id = newId(); const h = helper(id, [300000]);
	run("off-switch", 0, { input: ev(h, id), env: { WORKER_SIZE: "off" } });
	run("nudges-after-off", 300, { input: ev(h, id) });
}
{
	const id = newId(); const h = helper("someone-else", [300000]);
	run("missing-subagent-file", 0, { input: ev(h, id) });
}
{
	const id = newId(); const h = helper(id, [300000]);
	run("transcript-path-is-agent-file", 300, { input: JSON.stringify({ session_id: "none", transcript_path: h.file, agent_id: id }) });
}
{
	const id = newId(); const h = helper(id, [1]);
	fs.writeFileSync(h.file, "not json\n{\"type\":\n\n");
	run("broken-lines", 0, { input: ev(h, id) });
	run("broken-event", 0, { input: "{not json" });
	run("empty-input", 0, { input: "" });
	run("no-transcript-path", 0, { input: JSON.stringify({ agent_id: id }) });
}

for (const id of ids) fs.rmSync(path.join(stateDir, id + ".json"), { force: true });
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
