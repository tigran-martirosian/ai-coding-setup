#!/usr/bin/env node
// worker-nudge: a PreToolUse hook that routes search/research subagents (Explore, general-purpose,
// research types) to the capped "worker" subagent (Sonnet) instead of an uncapped agent type. Measured
// 2026-09-30: such subagents processed 0.6-4.3M tokens per run; a capped worker does the same gathering
// for a fraction. WebSearch/WebFetch are left alone: they add ~700 tokens, less than the extra turn a
// block costs. Every try is denied, retries too: the "worker" type (Sonnet, capped, all tools)
// does anything these types do, including editing files. Until 2026-10-21 an identical retry went
// through; in 3 days of one project that let 14 general-purpose runs on Opus spend 21M tokens.
// It fails open, so any error or odd input lets the call through. WORKER_NUDGE=off disables it.
import { crashLog } from "./crash-log.mjs";
import { readFileSync, writeSync } from "node:fs";

// "claude" is the catch-all type: no turn cap, the session's own model (28 runs at 1.09M each, 2026-10-08)
const GATHER_AGENTS = new Set(["", "explore", "general-purpose", "claude"]);

function isGatherAgent(event) {
  if (!["Agent", "Task"].includes(event.tool_name)) return false;
  const type = String((event.tool_input || {}).subagent_type || "").toLowerCase();
  return GATHER_AGENTS.has(type) || type.startsWith("voltagent-research:");
}

try {
  if ((process.env.WORKER_NUDGE || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!isGatherAgent(event)) process.exit(0);

  const reason = [
    `[worker-nudge] Explore, general-purpose and "claude" subagents run uncapped on the session's model and cost 0.6-5M Claude tokens per run.`,
    `A job that is not gathering (a build, a check) goes to subagent_type "worker" (Sonnet, capped at 80 turns) with a budget in its prompt, and a review of a finished job to subagent_type "reviewer", not to an uncapped agent type.`,
    `If it really needs a Claude subagent (it edits files, or the worker failed), make the same call with subagent_type "worker" (it edits files; it starts without CLAUDE.md, so name the project commands in its prompt), or "worker-full" when it needs a skill or an MCP tool. Retrying this agent type is refused too.`,
  ].join("\n");
  writeSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
} catch (err) {
  crashLog("worker-nudge", err);
  // Fail open
}
process.exit(0);
