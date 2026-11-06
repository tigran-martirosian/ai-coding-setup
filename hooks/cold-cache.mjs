// cold-cache: a UserPromptSubmit hook that warns when the prompt cache has gone cold on a big session.
// After the cache lifetime the next message pays the whole context at full price. This adds a warning to the prompt
// (it does not block) so the maker or Claude can restart from a short note in a fresh session.
// Warns when the last assistant request is over COLD_CACHE_MINUTES (55) old AND its context is over
// COLD_CACHE_K (100) thousand tokens. From 190k to 300k (CONTEXT_K) it stays silent: Claude Code compacts such a session
// before it answers (autoCompactWindow), so the size would be out of date by then.
// Subagent events are skipped. Fails open. COLD_CACHE=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { backEntries, lastUsage, CONTEXT_K as COMPACT } from "./lib/transcript.mjs";
import fs from "node:fs";

const MINUTES = Number(process.env.COLD_CACHE_MINUTES) || 55;
const CONTEXT_K = Number(process.env.COLD_CACHE_K) || 100;

runHook("cold-cache", (event) => {
	if (event.agent_id) return;
	if (!event.transcript_path || !fs.existsSync(event.transcript_path)) return;
	// The last main-chain reply with usage and a timestamp (read backwards: single lines with pictures reach MBs)
	const last = lastUsage(backEntries(event.transcript_path), { timed: true });
	if (!last) return;
	const at = Date.parse(last.entry.timestamp);
	if (!Number.isFinite(at)) return;
	const context = last.tokens;
	const idle = Math.round((Date.now() - at) / 60000);
	const compactsFirst = context >= COMPACT.compact * 1000 && context < COMPACT.run * 1000;
	if (idle > MINUTES && context > CONTEXT_K * 1000 && !compactsFirst) {
		const k = Math.round(context / 1000);
		const text = `[cold-cache] The prompt cache expired: this session is ~${k}k tokens and was idle ${idle} minutes; the next request re-creates all of it at full price. If the job is not nearly done, say so to the maker and offer to continue from a short restart note in a fresh session (write it into ~/.claude/handoffs/).`;
		emit.context("UserPromptSubmit", text);
	}
});
