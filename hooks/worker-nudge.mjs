#!/usr/bin/env node
// worker-nudge: a PreToolUse hook that routes search/research subagents (Explore, general-purpose,
// research types) to the free external workers (~/.claude/workers/ask.mjs) instead of Claude. Measured
// 2026-09-30: such subagents processed 0.6-4.3M tokens per run; one worker call costs Claude a few
// hundred. WebSearch/WebFetch are left alone: they add ~700 tokens, less than the extra turn a
// block costs. The first try is denied with the worker commands; retrying the identical call goes
// through, so Claude can still use a subagent when it has a reason (e.g. it must edit files).
// It fails open, so any error or odd input lets the call through. WORKER_NUDGE=off disables it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, writeSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const ASK = `~/.claude/workers/ask.mjs`;
const TASK = `"<task, or the path of a text file holding a longer task>"`;
// "claude" is the catch-all type: no turn cap, the session's own model (28 runs at 1.09M each, 2026-10-08)
const GATHER_AGENTS = new Set(["", "explore", "general-purpose", "claude"]);

// ask.mjs picks the worker. A worker is off when <name>.off exists in this folder (no subscription)
const WORKERS = join(process.env.USERPROFILE || process.env.HOME || "", ".claude", "workers");

function onPath(name) {
  if (existsSync(join(WORKERS, `${name}.off`))) return false;
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe", ".ps1"] : [""];
  return (process.env.PATH || "").split(delimiter).some((d) => d && exts.some((e) => existsSync(join(d, name + e))));
}

function isGatherAgent(event) {
  if (!["Agent", "Task"].includes(event.tool_name)) return false;
  const type = String((event.tool_input || {}).subagent_type || "").toLowerCase();
  return GATHER_AGENTS.has(type) || type.startsWith("voltagent-research:");
}

try {
  if ((process.env.WORKER_NUDGE || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!isGatherAgent(event)) process.exit(0);
  const hasAgy = onPath("agy");
  const hasCodex = onPath("codex");
  if (!hasAgy && !hasCodex) process.exit(0);

  // Let an identical retry through
  const dir = join(tmpdir(), "worker-nudge");
  mkdirSync(dir, { recursive: true });
  const file = join(dir, `${String(event.session_id || "none").replace(/[^\w-]/g, "")}.json`);
  const key = createHash("sha1").update(event.tool_name + JSON.stringify(event.tool_input || {})).digest("hex");
  let seen = [];
  try { seen = JSON.parse(readFileSync(file, "utf8")); } catch {}
  if (seen.includes(key)) process.exit(0);
  writeFileSync(file, JSON.stringify([...seen, key].slice(-200)));

  const workers = [];
  workers.push(`- Local files and code: ${ASK} ${TASK} (name the files to read in the task)`);
  if (hasCodex) workers.push(`- Web research: ${ASK} --web ${TASK}`);
  else workers.push(`- Web research: not a worker call. Use a "worker" subagent (Sonnet, capped) with a budget of about 15 tool calls, or WebSearch yourself for one quick fact.`);
  workers.push(`The script uses the first worker that is set up and working (Codex, then Gemini for local files) and says which one answered. If it ends with "no free worker could answer", do what its last line says.`);
  const reason = [
    `[worker-nudge] Search/research subagents cost 0.6-4M Claude tokens per run. Do this gathering with one free external worker call instead (no Claude usage). Run it with Bash, in the background if you have other work meanwhile, and ask for a short answer with paths/lines:`,
    ...workers,
    `Keep the reasoning and the final answer yourself, and verify anything the answer depends on.`,
    `A job that is not gathering (a review, a build, a check) goes to subagent_type "worker" (Sonnet, capped at 25 turns) with a budget in its prompt, not to an uncapped agent type.`,
    `If this really needs a Claude subagent (it edits files, needs this conversation's context, or the worker failed), retry the identical call and it will go through.`,
  ].join("\n");
  writeSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
} catch {
  // Fail open
}
process.exit(0);
