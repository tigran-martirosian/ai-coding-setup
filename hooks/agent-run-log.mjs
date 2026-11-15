#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// agent-run-log: PreToolUse hook on the Agent tool. Writes one line per helper to ~/.claude/state/agent-runs.jsonl:
// {ts, session, cwd, description, type, model, effort}, so the Agents Panel can show which model and effort a helper runs on (the app's
// own row carries neither). model = tool_input.model, else the `model:` of <project>/.claude/agents/<type>.md, else of
// ~/.claude/agents/<type>.md, else the session's own model, read from the last assistant entry of transcript_path (message.model).
// effort = the level the helper really runs at, in Claude Code's order: a CLAUDE_CODE_EFFORT_LEVEL this hook inherits (the
// session's own environment, after its settings env; Nimbalyst sets it from its effort picker, and it beats everything below),
// else tool_input.effort, else the agent file's `effort:`, else the session's (the same entry's `effort`). The variable set to
// auto or unset sends no level, so effort is null then. What none of these name stays null. The line also keeps toolUseId
// (the call's tool_use_id), so the result below finds it.
// The result: on PostToolUse and PostToolUseFailure of the same tools, the helper's line gets {result, why, endedAt}, result being
// success, partial or fail (sortResult), plus the helper's own totals from its tool result when they are numbers there:
// totalTokens, totalDurationMs and totalToolUseCount (the Agents Panel's helper card shows them; a missing one stays off the line). The line is found by toolUseId, else as the newest one of the same session and description
// with no result yet; with none (trimmed away, or the hook was off at the start) a line with no description is added, which the
// Agents Panel skips (it shows lines with a description), so a result never shows as a helper of its own.
// The sorting is done on the report the hook sees, after the app's "[harness: ...]" lines are dropped:
//   - fail: the call failed (PostToolUseFailure, its error), an empty report, or one that starts with "API Error" (the helper's
//     model call broke and the app returned the error as its report);
//   - partial: the app's turn-limit note first (TURN_LIMIT_RE), a line that starts with BLOCKED, or a "what is left" / "left to
//     do" / "not done" line that is not followed by nothing or none: the helper stopped with work open;
//   - success: any other report. Words in the middle of a line don't count, so a report that quotes "BLOCKED" is still success.
// A background launch (a status other than completed) has no report yet, and its end comes as a task notification no hook sees,
// so it gets no result; neither does a helper resumed by SendMessage.
// Writes no stdout, so it never touches the input map-brief rewrites. Keeps the file at its last 500 lines. Fails open: any error is one
// line on stderr, exit 0. AGENT_RUN_LOG=off disables it; AGENT_RUN_LOG_FILE moves the log (tests); AGENT_RUN_LOG_AGENTS replaces the
// ~/.claude/agents folder (tests).
import { runHook } from "./lib/hook-io.mjs";
import { TURN_LIMIT_RE } from "./lib/texts.mjs";
import { entries, tail } from "./lib/transcript.mjs";

const KEEP = 500;
const TAIL_BYTES = 512 * 1024;
const LOG =
  process.env.AGENT_RUN_LOG_FILE ||
  path.join(os.homedir(), ".claude", "state", "agent-runs.jsonl");
const LEVELS = ["low", "medium", "high", "xhigh", "max", "ultra"];
const HOME_AGENTS =
  process.env.AGENT_RUN_LOG_AGENTS ||
  path.join(os.homedir(), ".claude", "agents");

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

// The report's text: a string, or the blocks of tool_response.content (as helper-stopped.mjs reads it)
function reportText(response) {
  if (typeof response === "string") return response;
  const blocks = Array.isArray(response?.content)
    ? response.content
    : Array.isArray(response)
      ? response
      : [];
  return blocks
    .map((b) =>
      typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "",
    )
    .join("\n");
}

const NOTHING_RE = /^[\s*>-]*(nothing|none|n\/a)\b/i;
const LEFT_RE =
  /^[\s#*>-]*(?:what(?:'s| is) (?:still )?left|left to do|still to do|not done(?: yet)?)\b[\s*:.-]*(.*)$/i;
const short = (text) => String(text).trim().split("\n")[0].slice(0, 200);

// success, partial or fail, and why; null for a background launch
function sortResult(event) {
  if (event.hook_event_name === "PostToolUseFailure")
    return {
      result: "fail",
      why: `error: ${short(event.error ?? "no error text")}`,
    };
  const response = event.tool_response;
  const status =
    response && typeof response === "object" && !Array.isArray(response)
      ? response.status
      : undefined;
  if (status !== undefined && status !== "completed") return null;
  const lines = reportText(response)
    .split("\n")
    .filter((line) => !/^\s*\[harness:/.test(line));
  const report = lines.join("\n").trim();
  if (!report) return { result: "fail", why: "empty report" };
  const first = lines.find((line) => line.trim());
  if (/^\s*API Error\b/.test(first))
    return { result: "fail", why: short(first) };
  if (TURN_LIMIT_RE.test(first))
    return { result: "partial", why: "turn limit" };
  const blocked = lines.find((line) => /^\s*\**BLOCKED\b/.test(line));
  if (blocked)
    return { result: "partial", why: short(blocked.replace(/^\s*\**/, "")) };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(LEFT_RE);
    if (!m) continue;
    const what =
      m[1].trim() || lines.slice(i + 1).find((line) => line.trim()) || "";
    if (what && !NOTHING_RE.test(what))
      return { result: "partial", why: short(lines[i]) };
  }
  return { result: "success", why: null };
}

const TOTALS = ["totalTokens", "totalDurationMs", "totalToolUseCount"];

// The helper's totals from its tool result: only the ones that are numbers
function totals(response) {
  const out = {};
  if (!response || typeof response !== "object" || Array.isArray(response))
    return out;
  for (const key of TOTALS)
    if (Number.isFinite(response[key])) out[key] = response[key];
  return out;
}

function readLog() {
  try {
    return fs.readFileSync(LOG, "utf8").split("\n").filter(Boolean);
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    return [];
  }
}

function writeLog(lines) {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.writeFileSync(LOG, lines.slice(-KEEP).join("\n") + "\n");
}

// The result onto the helper's start line, newest first
function logResult(event) {
  const sorted = sortResult(event);
  if (!sorted) return;
  const input =
    event.tool_input && typeof event.tool_input === "object"
      ? event.tool_input
      : {};
  const description =
    typeof input.description === "string" ? input.description : "";
  const id = event.tool_use_id || null;
  const done = {
    ...sorted,
    ...totals(event.tool_response),
    endedAt: new Date().toISOString(),
  };
  const lines = readLog();
  for (let i = lines.length - 1; i >= 0; i--) {
    let run;
    try {
      run = JSON.parse(lines[i]);
    } catch {
      continue; // a cut line is left as it is
    }
    if (!run || typeof run !== "object") continue;
    const same =
      id && run.toolUseId
        ? run.toolUseId === id
        : !run.result &&
          run.session === (event.session_id || null) &&
          run.description === description;
    if (!same) continue;
    lines[i] = JSON.stringify({ ...run, ...done });
    return writeLog(lines);
  }
  // no start line: a line with no description, so the Agents Panel doesn't show it as a helper
  writeLog([
    ...lines,
    JSON.stringify({
      ts: done.endedAt,
      session: event.session_id || null,
      cwd: event.cwd || null,
      toolUseId: id,
      ...done,
    }),
  ]);
}

runHook("agent-run-log", (event) => {
  const input = event.tool_input;
  if (!["Agent", "Task"].includes(event.tool_name)) return;
  if (["PostToolUse", "PostToolUseFailure"].includes(event.hook_event_name))
    return logResult(event);
  if (!input || typeof input !== "object") return;

  const type =
    typeof input.subagent_type === "string" && input.subagent_type
      ? input.subagent_type
      : "general-purpose";
  const project = process.env.CLAUDE_PROJECT_DIR || event.cwd;
  const file =
    (project && frontmatter(path.join(project, ".claude", "agents"), type)) ||
    frontmatter(HOME_AGENTS, type) ||
    {};
  let model =
    (typeof input.model === "string" && input.model) || file.model || null;
  const forced = (process.env.CLAUDE_CODE_EFFORT_LEVEL || "")
    .trim()
    .toLowerCase();
  const noLevel = ["auto", "unset"].includes(forced);
  let effort = LEVELS.includes(forced)
    ? forced
    : noLevel
      ? null
      : (typeof input.effort === "string" && input.effort) ||
        file.effort ||
        null;
  if (!model || (!effort && !noLevel)) {
    const session = sessionRun(event.transcript_path);
    model = model || session.model || null;
    if (!noLevel) effort = effort || session.effort || null;
  }

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    session: event.session_id || null,
    cwd: event.cwd || null,
    description: typeof input.description === "string" ? input.description : "",
    type,
    model,
    effort,
    toolUseId: event.tool_use_id || null,
  });
  writeLog([...readLog(), line]);
});
