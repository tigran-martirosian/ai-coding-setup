// Test for hooks/cold-cache.mjs: made-up small transcripts, hook run as a child process.
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/cold-cache.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cold-cache-"));
let failed = 0;

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const asst = (min, ctx, extra = {}) => JSON.stringify({
	type: "assistant", timestamp: ago(min),
	message: { id: "m" + Math.random(), model: "claude-x", content: [{ type: "text", text: "hi" }],
		usage: { input_tokens: 10, cache_read_input_tokens: ctx - 10, cache_creation_input_tokens: 0 } },
	...extra,
});
const user = (min) => JSON.stringify({ type: "user", timestamp: ago(min), message: { role: "user", content: "next" } });

function run(name, lines, expectWarn, { event = {}, env = {} } = {}) {
	const file = path.join(dir, name + ".jsonl");
	if (Array.isArray(lines)) fs.writeFileSync(file, lines.join("\n") + "\n");
	const input = lines === "broken-event" ? "{not json" : JSON.stringify({ transcript_path: file, ...event });
	const r = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...process.env, ...env } });
	const out = r.stdout.trim();
	let ok = r.status === 0;
	if (expectWarn) {
		try {
			const j = JSON.parse(out);
			ok = ok && j.hookSpecificOutput.hookEventName === "UserPromptSubmit" &&
				j.hookSpecificOutput.additionalContext.startsWith("[cold-cache]") && !("decision" in j);
		} catch { ok = false; }
	} else ok = ok && out === "";
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`);
	return out;
}

const warn = run("idle-and-big", [user(200), asst(120, 300000), user(0)], true);
console.log("      " + JSON.parse(warn).hookSpecificOutput.additionalContext.slice(0, 120) + "...");
run("idle-and-small", [asst(120, 40000), user(0)], false);
run("fresh-and-big", [asst(3, 300000), user(0)], false);
run("just-under-gap", [asst(50, 300000), user(0)], false);
run("just-over-size-limit-small", [asst(120, 99000), user(0)], false);
run("broken-lines", ["not json", "{\"type\":", ""], false);
run("empty-file", [""], false);
run("missing-file", null, false);
run("broken-event", "broken-event", false);
run("subagent-skipped", [asst(120, 300000), user(0)], false, { event: { agent_id: "abc" } });
run("sidechain-ignored", [asst(120, 300000), asst(1, 300000, { isSidechain: true }), user(0)], true);
run("synthetic-ignored", [asst(120, 300000), JSON.stringify({ type: "assistant", timestamp: ago(1), message: { model: "<synthetic>", usage: { input_tokens: 1 }, content: [] } })], true);
run("off-switch", [asst(120, 300000), user(0)], false, { env: { COLD_CACHE: "off" } });

fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
