// worker-size: a PostToolUse hook for subagents. worker and worker-full set autoCompactWindow 200000;
// nothing warns a helper before its compact line, and every call re-sends the whole context, so runs past 150k context cost most.
// Only events with agent_id are looked at (a main-session event exits at once, no file read). The hook gets the
// PARENT's transcript_path (see repeat-guard), so the helper's own transcript is
// <dir of transcript_path>/<session_id>/subagents/agent-<agent_id>.jsonl; if transcript_path already is an
// agent-*.jsonl file, that is used. The size is the last assistant usage line (input + cache creation + cache read).
// From WORKER_SIZE_K (150) thousand tokens it tells the helper to finish the step in hand and report; again only
// after a further 100k (state in ~/.claude/hooks/state/worker-size/<agent_id>.json, files untouched for 2 days are
// swept). WORKER_SIZE_DEBUG=1 prints the size found on stderr. Fails open. WORKER_SIZE=off disables it.
// Hard stop: on PreToolUse (same script, registered there too), only for agent_type worker and worker-full (the two
// with autoCompactWindow 200000; planner, reviewer and the rest pass untouched). A helper whose context is at
// WORKER_STOP_K (180) thousand or more gets WORKER_STOP_GRACE (3) more calls, each with a note to finish or undo
// the edit it is in and report within the calls left; from the next call on every call is refused, so it reports
// instead of reaching the 200k compact (which loses work). The count per agent_id is kept in
// ~/.claude/hooks/state/worker-size/<agent_id>.stop.json and is forgotten when the size falls back below the line (a
// compaction). After the grace nothing is exempt: the report is its last message and needs no tool.
import { emit, runHook } from "./lib/hook-io.mjs";
import { WORKER_SIZE_NOTE } from "./lib/texts.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { readJson, stateFile, sweep, writeJson } from "./lib/state.mjs";
import { backEntries, lastUsage, subagentPath } from "./lib/transcript.mjs";
import fs from "node:fs";

const LIMIT_K = Number(process.env.WORKER_SIZE_K) || 150;
const STOP_K = Number(process.env.WORKER_STOP_K) || 180;
const GRACE = process.env.WORKER_STOP_GRACE?.trim() && Number.isFinite(Number(process.env.WORKER_STOP_GRACE)) ? Number(process.env.WORKER_STOP_GRACE) : 3;
const STOP_TYPES = new Set(["worker", "worker-full"]);
const STEP_K = 100;

runHook("worker-size", (event) => {
	if (!event.agent_id) return;
	const given = event.transcript_path;
	if (!given) return;
	const agentId = String(event.agent_id);
	const file = subagentPath(given, agentId, event.session_id);
	if (!fs.existsSync(file)) return;
	const pre = event.hook_event_name === "PreToolUse";
	if (pre && !STOP_TYPES.has(event.agent_type)) return;
	// The last assistant usage line, read backwards in 1 MB chunks (single lines with pictures reach MBs)
	const context = lastUsage(backEntries(file, { sidechain: true, chunk: 1024 * 1024 }))?.tokens ?? 0;
	const k = Math.round(context / 1000);
	if (process.env.WORKER_SIZE_DEBUG) process.stderr.write(`[worker-size] agent ${agentId}: ${k}k tokens (${file})\n`);
	sweep("worker-size", 2);
	const key = sessionKey(agentId);
	if (pre) {
		const stopState = stateFile("worker-size", `${key}.stop`);
		if (k < STOP_K) { fs.rmSync(stopState, { force: true }); return; }
		const used = readJson(stopState)?.used || 0;
		if (used < GRACE) {
			writeJson(stopState, { used: used + 1 });
			emit.context("PreToolUse", `${WORKER_SIZE_NOTE} ~${k}k tokens (stop line ${STOP_K}k). Past ${STOP_K}k: finish or undo the edit you are in, in at most ${GRACE - used} more calls, then stop and report: files changed, the check run, what is left, any half-edited file.`);
		} else {
			emit.deny(`${WORKER_SIZE_NOTE} ~${k}k tokens (stop line ${STOP_K}k). Tool calls are refused: stop and report now: files changed, the check run, what is left, any half-edited file.`);
		}
		return;
	}
	const state = stateFile("worker-size", key);
	// Back under the line (a worker compacted at its autoCompactWindow): forget the warning, so the next climb warns again
	if (!k || k < LIMIT_K) { fs.rmSync(state, { force: true }); return; }
	const warnedAt = readJson(state)?.warnedAt || 0;
	if (warnedAt && k < warnedAt + STEP_K) return;
	writeJson(state, { warnedAt: k });
	emit.context("PostToolUse", `${WORKER_SIZE_NOTE} ~${k}k tokens and every call re-sends it. Finish the step in hand and report what is done and what is left; start nothing new.`);
});
