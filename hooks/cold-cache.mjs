// cold-cache: a UserPromptSubmit hook that warns when the prompt cache has gone cold on a big session.
// Measured over two days: 33 requests re-created over half their context after an idle gap (median 74
// min). After the cache lifetime the next message pays the whole context at full price. This adds a
// warning to the prompt (it does not block) so the user or Claude can restart from a short note in a
// fresh session.
// Warns when the last assistant request is over COLD_CACHE_MINUTES (55) old AND its context is over
// COLD_CACHE_K (100) thousand tokens. Subagent events are skipped. Fails open. COLD_CACHE=off disables it.
import fs from "node:fs";

const MINUTES = Number(process.env.COLD_CACHE_MINUTES) || 55;
const CONTEXT_K = Number(process.env.COLD_CACHE_K) || 100;
const TAIL_BYTES = 2 * 1024 * 1024;

// Reads the file backwards in 2 MB chunks (single lines with pictures reach MBs) and returns the last main-chain
// assistant line that has usage and a timestamp, or null. A partial line at a chunk start is carried as a Buffer.
function lastAssistant(file) {
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
				if (!lines[i].trim()) continue;
				let j;
				try { j = JSON.parse(lines[i]); } catch { continue; }
				if (j.type !== "assistant" || j.isSidechain || !j.message || j.message.model === "<synthetic>") continue;
				if (!j.message.usage || !j.timestamp) continue;
				return j;
			}
			if (pos === 0) break;
		}
		return null;
	} finally { fs.closeSync(fd); }
}

try {
	if ((process.env.COLD_CACHE || "").toLowerCase() === "off") process.exit(0);
	const event = JSON.parse(fs.readFileSync(0, "utf8"));
	if (event.agent_id) process.exit(0);
	if (!event.transcript_path || !fs.existsSync(event.transcript_path)) process.exit(0);
	const last = lastAssistant(event.transcript_path);
	if (!last) process.exit(0);
	const at = Date.parse(last.timestamp);
	if (!Number.isFinite(at)) process.exit(0);
	const u = last.message.usage;
	const context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
	const idle = Math.round((Date.now() - at) / 60000);
	if (idle > MINUTES && context > CONTEXT_K * 1000) {
		const k = Math.round(context / 1000);
		const text = `[cold-cache] The prompt cache expired: this session is ~${k}k tokens and was idle ${idle} minutes; the next request re-creates all of it at full price. If the job is not nearly done, say so to the user and offer to continue from a short restart note in a fresh session (write it into ~/.claude/handoffs/).`;
		process.stdout.write(JSON.stringify({
			hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text },
		}));
	}
} catch {
	// Fail open
}
process.exit(0);
