#!/usr/bin/env node
// worker-nudge: a PreToolUse hook that routes search/research subagents (Explore, general-purpose,
// research types) to the free external workers (Codex, Antigravity) instead of Claude. Measured
// 2026-09-30: such subagents processed 0.6-4.3M tokens per run; one worker call costs Claude a few
// hundred. WebSearch/WebFetch are left alone: they add ~700 tokens, less than the extra turn a
// block costs. The first try is denied with the worker commands; retrying the identical call goes
// through, so Claude can still use a subagent when it has a reason (e.g. it must edit files).
// It fails open, so any error or odd input lets the call through. WORKER_NUDGE=off disables it.
import { readFileSync, writeFileSync, mkdirSync, existsSync, writeSync } from "node:fs";
import { join, delimiter } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";

const AGY_MODEL = process.env.BIG_READ_AGY_MODEL || "gemini-3.8-flash-medium";
const AGY = `agy -p "<task; name the files to read>" --mode plan --model ${AGY_MODEL}`;
const CODEX = `~/.claude/workers/ask-codex.sh "<task, or the path of a text file holding a longer task>"`;
const GATHER_AGENTS = new Set(["", "explore", "general-purpose"]);

function onPath(name) {
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
  if (hasCodex) {
    workers.push(`- Codex (local files and code): ${CODEX}`);
    workers.push(`- Codex with web research: the same command with --web before the task (ask-codex.sh --web ...)`);
  }
  if (hasAgy) workers.push(`- Antigravity (Gemini, very large files; not for the web): ${AGY}`);
  const reason = [
    `[worker-nudge] Search/research subagents cost 0.6-4M Claude tokens per run. Do this gathering with one free external worker call instead (no Claude usage). Run it with Bash, in the background if you have other work meanwhile, and ask for a short answer with paths/lines:`,
    ...workers,
    `Keep the reasoning and the final answer yourself, and verify anything the answer depends on.`,
    `If this really needs a Claude subagent (it edits files, needs this conversation's context, or the worker failed), retry the identical call and it will go through.`,
  ].join("\n");
  writeSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
} catch {
  // Fail open
}
process.exit(0);
