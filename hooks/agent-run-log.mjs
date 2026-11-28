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
// A background launch (a status other than completed) has no report yet: its end comes as a task notification, which no
// tool hook sees but the session transcript keeps (a queue-operation line, later the user turn it became). So the hook also
// runs at the session's Stop (the dispatcher's stop group): with open lines of this session (no result, a toolUseId), it reads
// the transcript's last 2 MB for <task-notification> blocks and fills each open line its <tool-use-id> names. Of an id's
// notices then in the transcript the newest wins (a helper resumed by SendMessage notifies again); a filled line is not
// filled again, so a resume after that keeps the first result. A later copy of the same notice keeps the first's time.
// completed is sorted like a report (sortResult, on <result>); failed is fail and killed partial, both with the
// <summary> as why; <usage> gives totalTokens, totalToolUseCount and totalDurationMs (tags, or "name: N" lines in older
// transcripts); endedAt is the notice's timestamp, null when its line has none. Tag text is unescaped (&lt; &amp;).
//   node agent-run-log.mjs --backfill   fills every open line from its session's saved transcript (the projects folder,
//   AGENT_RUN_LOG_PROJECTS in tests, read whole) and prints "filled N of M".
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

const NOTE_RE = /<task-notification>([\s\S]*?)<\/task-notification>/g;
const SWEEP_BYTES = 2 * 1024 * 1024;
const PROJECTS =
  process.env.AGENT_RUN_LOG_PROJECTS ||
  path.join(os.homedir(), ".claude", "projects");
// A tag's text, its escapes undone (the transcript keeps "&lt;" and "&amp;")
const unescapeTag = (text) =>
  text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&");
const tag = (block, name) => {
  const text = block.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1];
  return text === undefined ? undefined : unescapeTag(text);
};
// A total in <usage>: a tag (<tool_uses>12</tool_uses>) or, in older transcripts, a "tool_uses: 12" line
const usageValue = (usage, name) =>
  tag(usage, name) ??
  usage.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*([\\d.]+)`))?.[1];

// The task notifications in a transcript's lines: tool-use id -> the newest notice
function notices(lines) {
  const out = new Map();
  for (const line of lines) {
    if (!line.includes("<task-notification>")) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue; // the tail's first line can be cut
    }
    const content =
      entry?.type === "queue-operation"
        ? entry.content
        : entry?.message?.content;
    const body =
      typeof content === "string"
        ? content
        : Array.isArray(content)
          ? content
              .map((b) => (typeof b?.text === "string" ? b.text : ""))
              .join("\n")
          : "";
    for (const m of body.matchAll(NOTE_RE)) {
      const id = tag(m[1], "tool-use-id")?.trim();
      if (!id) continue;
      const prev = out.get(id);
      if (prev?.block === m[1]) continue; // the same notice again: its first time stands
      out.set(id, { block: m[1], at: entry.timestamp || prev?.at || null });
    }
  }
  return out;
}

// A notice as the fields of a result
function noticeResult({ block, at }) {
  const status = tag(block, "status")?.trim();
  const summary = short(tag(block, "summary") ?? status ?? "no summary");
  const sorted =
    status === "completed"
      ? sortResult({
          hook_event_name: "PostToolUse",
          tool_response: tag(block, "result") ?? "",
        })
      : status === "failed"
        ? { result: "fail", why: summary }
        : { result: "partial", why: summary };
  const done = { ...sorted };
  // the raw <usage> text: unescaped, its inner tags would read the same, so match on the raw block
  const usage = block.match(/<usage>([\s\S]*?)<\/usage>/)?.[1] || "";
  for (const [key, name] of [
    ["totalTokens", "subagent_tokens"],
    ["totalToolUseCount", "tool_uses"],
    ["totalDurationMs", "duration_ms"],
  ]) {
    const value = usageValue(usage, name);
    const n = Number(value);
    if (value !== undefined && value !== "" && Number.isFinite(n))
      done[key] = n;
  }
  done.endedAt = at; // null when the transcript line has no timestamp: no end time is made up
  return done;
}

// Fills the open lines (no result, a toolUseId) that `pick` accepts from `found`; returns how many
function fill(lines, found, pick) {
  let filled = 0;
  for (let i = 0; i < lines.length; i++) {
    let run;
    try {
      run = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (!run || run.result || !run.toolUseId || !pick(run)) continue;
    const notice = found(run)?.get(run.toolUseId);
    if (!notice) continue;
    lines[i] = JSON.stringify({ ...run, ...noticeResult(notice) });
    filled++;
  }
  return filled;
}

const openRuns = (lines) =>
  lines
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((run) => run && !run.result && run.toolUseId);

// At Stop: this session's open lines from the end of its transcript
// The log is read again right before it is written, so lines other sessions add while the transcript is parsed stay.
function sweep(event) {
  const session = event.session_id || null;
  if (
    !event.transcript_path ||
    !openRuns(readLog()).some((r) => r.session === session)
  )
    return;
  const found = notices(tail(event.transcript_path, SWEEP_BYTES));
  const lines = readLog();
  if (
    fill(
      lines,
      () => found,
      (run) => run.session === session,
    )
  )
    writeLog(lines);
}

// By hand: every open line, from each session's whole saved transcript
function backfill() {
  const lines = readLog();
  const sessions = new Set(
    openRuns(lines)
      .map((r) => r.session)
      .filter(Boolean),
  );
  const files = new Map();
  for (const dir of fs.readdirSync(PROJECTS)) {
    for (const s of sessions) {
      const file = path.join(PROJECTS, dir, `${s}.jsonl`);
      if (!files.has(s) && fs.existsSync(file)) files.set(s, file);
    }
  }
  const cache = new Map();
  for (const [s, file] of files)
    cache.set(s, notices(fs.readFileSync(file, "utf8").split("\n")));
  const fresh = readLog(); // read again: lines added while the transcripts were read stay
  const total = openRuns(fresh).length;
  const filled = fill(
    fresh,
    (run) => cache.get(run.session),
    () => true,
  );
  if (filled) writeLog(fresh);
  console.log(`agent-run-log: filled ${filled} of ${total} open lines`);
}

if (process.argv.includes("--backfill")) {
  if ((process.env.AGENT_RUN_LOG || "").toLowerCase() !== "off") backfill();
  process.exit(0);
}

runHook("agent-run-log", (event) => {
  if (event.hook_event_name === "Stop") return sweep(event);
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
