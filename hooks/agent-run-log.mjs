#!/usr/bin/env node
// agent-run-log: PreToolUse hook on the Agent tool. Writes one line per helper to ~/.claude/state/agent-runs.jsonl:
// {ts, session, cwd, description, type, model, effort}, so the Agents Panel can show which model and effort a helper runs on (the app's
// own row carries neither). model = tool_input.model, else the `model:` of <project>/.claude/agents/<type>.md, else of
// ~/.claude/agents/<type>.md, else the session's own model, read from the last assistant entry of transcript_path (message.model).
// effort = the agent file's `effort:`, else the session's (the same entry's `effort`). What none of these name stays null.
// Writes no stdout, so it never touches the input map-brief rewrites. Keeps the file at its last 500 lines. Fails open: any error is one
// line on stderr, exit 0. AGENT_RUN_LOG=off disables it; AGENT_RUN_LOG_FILE moves the log (tests); AGENT_RUN_LOG_AGENTS replaces the
// ~/.claude/agents folder (tests).
import { runHook } from "./lib/hook-io.mjs";
import { entries, tail } from "./lib/transcript.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const KEEP = 500;
const TAIL_BYTES = 512 * 1024;
const LOG = process.env.AGENT_RUN_LOG_FILE || path.join(os.homedir(), ".claude", "state", "agent-runs.jsonl");
const HOME_AGENTS = process.env.AGENT_RUN_LOG_AGENTS || path.join(os.homedir(), ".claude", "agents");

function frontmatter(dir, type) {
  let text;
  try {
    text = fs.readFileSync(path.join(dir, `${type}.md`), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  const m = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^(model|effort):\s*(\S+)\s*$/);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

// The session's model and effort from the newest assistant entry in the transcript's last 512 KB.
function sessionRun(file) {
  if (!file) return {};
  const list = entries(tail(file, TAIL_BYTES), { sidechain: true });
  for (let i = list.length - 1; i >= 0; i--) {
    const entry = list[i];
    if (entry.type !== "assistant" || !entry.message?.model) continue;
    return { model: entry.message.model, effort: entry.effort || null };
  }
  return {};
}

runHook("agent-run-log", (event) => {
  const input = event.tool_input;
  if (!["Agent", "Task"].includes(event.tool_name) || !input || typeof input !== "object") return;

  const type = typeof input.subagent_type === "string" && input.subagent_type ? input.subagent_type : "general-purpose";
  const project = process.env.CLAUDE_PROJECT_DIR || event.cwd;
  const file = (project && frontmatter(path.join(project, ".claude", "agents"), type)) || frontmatter(HOME_AGENTS, type) || {};
  let model = (typeof input.model === "string" && input.model) || file.model || null;
  let effort = file.effort || null;
  if (!model || !effort) {
    const session = sessionRun(event.transcript_path);
    model = model || session.model || null;
    effort = effort || session.effort || null;
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    session: event.session_id || null,
    cwd: event.cwd || null,
    description: typeof input.description === "string" ? input.description : "",
    type,
    model,
    effort,
  });
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  let old = [];
  try {
    old = fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  const all = [...old, line].slice(-KEEP);
  fs.writeFileSync(LOG, all.join("\n") + "\n");
});
