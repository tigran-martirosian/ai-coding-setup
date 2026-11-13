// worker-size: a PostToolUse hook for subagents. worker and worker-full set autoCompactWindow 200000;
// nothing warns a helper before its compact line, and every call re-sends the whole context. On real transcripts
// a large share of all subagent tokens went to runs past 150k context, and single workers kept going far beyond it.
// Only events with agent_id are looked at (a main-session event exits at once, no file read). The hook gets the
// PARENT's transcript_path (see repeat-guard), so the helper's own transcript is
// <dir of transcript_path>/<session_id>/subagents/agent-<agent_id>.jsonl; if transcript_path already is an
// agent-*.jsonl file, that is used. The size is the last assistant usage line (input + cache creation + cache read).
// From WORKER_SIZE_K (150) thousand tokens it tells the helper to finish the step in hand and report; again only
// after a further 100k (state in os.tmpdir()/worker-size/<agent_id>.json). WORKER_SIZE_DEBUG=1 prints the size found
// on stderr. Fails open. WORKER_SIZE=off disables it.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT_K = Number(process.env.WORKER_SIZE_K) || 150;
const STEP_K = 100;
const TAIL_BYTES = 1024 * 1024;

// Reads the file backwards in 1 MB chunks (single lines with pictures reach MBs) and returns the context size of the
// last assistant line that has usage, or 0. A partial line at a chunk start is carried as a Buffer.
function lastContext(file) {
	const fd = fs.openSync(file, "r");
	try {
		let pos = fs.fstatSync(fd).size;
		let carry = Buffer.alloc(0);
		while (pos > 0 || carry.length) {
			const len = Math.min(pos, TAIL_BYTES);
			pos -= len;
			const chunk = Buffer.alloc(len);
			if (len) fs.readSync(fd, chunk, 0, len, pos);
			let buf = Buffer.concat([chunk, carry]);
			carry = Buffer.alloc(0);
			if (pos > 0) {
				const nl = buf.indexOf(10);
				if (nl < 0) { carry = buf; continue; }
				carry = buf.subarray(0, nl);
				buf = buf.subarray(nl + 1);
			}
			const lines = buf.toString("utf8").split("\n");
			for (let i = lines.length - 1; i >= 0; i--) {
				if (!lines[i].includes('"usage"')) continue;
				let j;
				try { j = JSON.parse(lines[i]); } catch { continue; }
				const u = j.message?.usage;
				if (j.type !== "assistant" || !u || j.message.model === "<synthetic>") continue;
				return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
			}
			if (pos === 0) break;
		}
		return 0;
	} finally { fs.closeSync(fd); }
}

try {
	if ((process.env.WORKER_SIZE || "").toLowerCase() === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8"));
	if (!event.agent_id) process.exit(0);
	const given = event.transcript_path;
	if (!given) process.exit(0);
	const agentId = String(event.agent_id);
	let file = given;
	if (!/^agent-.*\.jsonl$/.test(path.basename(given))) {
		const session = event.session_id || path.basename(given, ".jsonl");
		file = path.join(path.dirname(given), session, "subagents", `agent-${agentId}.jsonl`);
	}
	if (!fs.existsSync(file)) process.exit(0);
	const context = lastContext(file);
	const k = Math.round(context / 1000);
	if (process.env.WORKER_SIZE_DEBUG) process.stderr.write(`[worker-size] agent ${agentId}: ${k}k tokens (${file})\n`);
	const dir = path.join(os.tmpdir(), "worker-size");
	const state = path.join(dir, `${agentId.replace(/[^\w-]/g, "")}.json`);
	// Back under the line (a worker compacted at its autoCompactWindow): forget the warning, so the next climb warns again
	if (!k || k < LIMIT_K) { fs.rmSync(state, { force: true }); process.exit(0); }
	let warnedAt = 0;
	try { warnedAt = JSON.parse(fs.readFileSync(state, "utf8")).warnedAt || 0; } catch {}
	if (warnedAt && k < warnedAt + STEP_K) process.exit(0);
	fs.mkdirSync(dir, { recursive: true });
	fs.writeFileSync(state, JSON.stringify({ warnedAt: k }));
	process.stdout.write(JSON.stringify({
		hookSpecificOutput: {
			hookEventName: "PostToolUse",
			additionalContext: `[worker-size] This helper's context is ~${k}k tokens and every call re-sends it. Finish the step in hand and report what is done and what is left; start nothing new.`,
		},
	}));
} catch (err) {
	crashLog("worker-size", err);
	// Fail open
}
process.exit(0);
