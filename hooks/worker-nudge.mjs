#!/usr/bin/env node
// worker-nudge: a PreToolUse hook that routes search/research subagents (Explore, general-purpose,
// research types) to the capped "worker" subagent (Sonnet) instead of an uncapped agent type: such subagents
// process millions of tokens per run; a capped worker does the same gathering for a fraction. WebSearch/WebFetch
// are left alone: they add ~700 tokens, less than the extra turn a block costs. Every try is denied, retries too: the
// "worker" type (Sonnet, capped, all tools) does anything these types do, including editing files.
// It fails open, so any error or odd input lets the call through. WORKER_NUDGE=off disables it.
import { emit, runHook } from "./lib/hook-io.mjs";

// "claude" is the catch-all type: no turn cap, the session's own model
const GATHER_AGENTS = new Set(["", "explore", "general-purpose", "claude"]);

function isGatherAgent(event) {
  if (!["Agent", "Task"].includes(event.tool_name)) return false;
  const type = String((event.tool_input || {}).subagent_type || "").toLowerCase();
  return GATHER_AGENTS.has(type) || type.startsWith("voltagent-research:");
}

runHook("worker-nudge", (event) => {
  if (!isGatherAgent(event)) return;

  emit.deny([
    `[worker-nudge] Explore, general-purpose and "claude" subagents run uncapped on the session's model and cost 0.6-5M Claude tokens per run.`,
    `A job that is not gathering (a build, a check) goes to subagent_type "worker" (Sonnet, capped at 80 turns) with a budget in its prompt, and a review of a finished job to subagent_type "reviewer", not to an uncapped agent type.`,
    `If it really needs a Claude subagent (it edits files, or the worker failed), make the same call with subagent_type "worker" (it edits files; it starts without CLAUDE.md, so name the project commands in its prompt), or "worker-full" when it needs a skill or an MCP tool. Retrying this agent type is refused too.`,
  ].join("\n"));
});
