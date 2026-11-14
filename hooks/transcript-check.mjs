#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
// transcript-check: SessionStart hook. About a dozen hooks read Claude Code's own transcript, a private format,
// and they fail open, so a change to it would turn them off with no sign. Their tests use made-up lines, so this
// one looks at a real one: the tail of the project's newest earlier transcript, once per Claude Code version.
// It says out loud what is missing; it never stops anything. TRANSCRIPT_CHECK=off disables it.
// It also reads hooks/state/hook-errors.log (see crash-log.mjs): when hooks have crashed since the last session saw the
// log, it says which ones, once. HOOK_CRASH_ALARM=off disables that part. The first run only notes where the log ends.
import { CRASH_LOG, crashLog } from "./lib/crash-log.mjs";
import { isMain } from "./lib/hook-io.mjs";
import { readJson, stateFile as stateFileOf, writeJson } from "./lib/state.mjs";
import { agentType, SYNTHETIC, tail, userText } from "./lib/transcript.mjs";

const TAIL = 512 * 1024;
const STATE =
  process.env.TRANSCRIPT_CHECK_STATE ||
  stateFileOf("transcript-check", "format");
const ALARM_STATE =
  process.env.CRASH_ALARM_STATE ||
  stateFileOf("transcript-check", "crash-alarm");
const ALARM_READ = 256 * 1024;

function newestOther(current) {
  const folder = path.dirname(current);
  if (!fs.existsSync(folder)) return undefined; // a project's first session: its folder is written later
  const found = fs
    .readdirSync(folder)
    .filter(
      (f) =>
        f.endsWith(".jsonl") &&
        path.join(folder, f) !== path.normalize(current),
    )
    .map((f) => {
      const p = path.join(folder, f),
        s = fs.statSync(p);
      return { p, size: s.size, time: s.mtimeMs };
    })
    .filter((f) => f.size > 0)
    .sort((a, b) => b.time - a.time);
  return found[0];
}

function tailEntries({ p }) {
  const out = { entries: [], bad: 0 };
  for (const l of tail(p, TAIL)) {
    if (!l.trim()) continue;
    try {
      out.entries.push(JSON.parse(l));
    } catch {
      out.bad++;
    }
  }
  return out;
}

// The agentType of each helper of this transcript that has a .meta.json (none: an empty list)
function helperTypes(p) {
  const dir = path.join(
    path.dirname(p),
    path.basename(p, ".jsonl"),
    "subagents",
  );
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter(
      (f) =>
        /^agent-.*\.jsonl$/.test(f) &&
        fs.existsSync(path.join(dir, f.replace(/\.jsonl$/, ".meta.json"))),
    )
    .map((f) => agentType(path.join(dir, f)));
}

const resultText = (c) =>
  typeof c === "string"
    ? c
    : Array.isArray(c)
      ? c.map((b) => b?.text || "").join("\n")
      : "";
const COUNTS = [
  "input_tokens",
  "cache_read_input_tokens",
  "cache_creation_input_tokens",
];

// What the hooks rely on (lib/transcript.mjs reads it). null = this transcript has no tool call, so it can't show
// anything either way. A field that shows only on some lines (a compact, a task's notice, a background helper) is
// asked for only when such a line is there. `types`: the agentType of each helper with a .meta.json.
export function missing(entries, types = []) {
  const blocks = entries.flatMap((e) =>
    Array.isArray(e.message?.content)
      ? e.message.content.map((b) => ({ e, b }))
      : [],
  );
  const uses = blocks.filter(
    ({ e, b }) => e.type === "assistant" && b?.type === "tool_use",
  );
  const results = blocks.filter(
    ({ e, b }) => e.type === "user" && b?.type === "tool_result",
  );
  if (!uses.length) return entries.length ? null : ["any readable line"];
  const gone = [];
  if (!results.length && uses.length > 1)
    gone.push("tool_result blocks in user lines"); // one call: a run killed on it
  if (
    !entries.some((e) => e.timestamp && !Number.isNaN(Date.parse(e.timestamp)))
  )
    gone.push("timestamp");
  if (!uses.every(({ b }) => b.id && b.name && b.input))
    gone.push("id, name and input on tool_use blocks");
  if (results.length && !results.some(({ b }) => b.tool_use_id))
    gone.push("tool_use_id on tool_result blocks");
  const said = entries.filter(
    (e) => e.type === "user" || e.type === "assistant",
  );
  if (!said.some((e) => typeof e.isSidechain === "boolean"))
    gone.push("isSidechain");
  const replies = entries.filter((e) => e.type === "assistant");
  if (!replies.some((e) => typeof e.message?.model === "string"))
    gone.push("message.model");
  const real = replies.filter((e) => e.message?.model !== SYNTHETIC);
  if (
    real.length &&
    !real.some((e) =>
      COUNTS.every((k) => typeof e.message?.usage?.[k] === "number"),
    )
  )
    gone.push("the token counts in message.usage");
  const compacts = entries.filter(
    (e) => e.type === "system" && e.subtype === "compact_boundary",
  );
  if (
    compacts.length &&
    !compacts.some((e) => typeof e.compactMetadata?.postTokens === "number")
  )
    gone.push("compactMetadata.postTokens");
  const notices = entries.filter(
    (e) => e.type === "user" && /^\s*<task-notification>/.test(userText(e)),
  );
  if (
    notices.length &&
    !notices.some((e) => e.origin?.kind === "task-notification")
  )
    gone.push("origin.kind on task notifications");
  const asyncs = results.filter(({ b }) =>
    /^Async agent launched/.test(resultText(b.content)),
  );
  if (
    asyncs.length &&
    !asyncs.some(
      ({ e }) =>
        e.toolUseResult?.status === "async_launched" && e.toolUseResult.agentId,
    )
  )
    gone.push("toolUseResult.agentId on background helper launches");
  if (types.length && !types.some(Boolean))
    gone.push("agentType in the helpers' .meta.json");
  return gone;
}

// The crash log's new lines since the last session saw it: one short line naming the hooks, or "" when there are none
export function crashAlarm(logFile = CRASH_LOG, stateFile = ALARM_STATE) {
  if ((process.env.HOOK_CRASH_ALARM || "").toLowerCase() === "off") return "";
  let size = 0;
  try {
    size = fs.statSync(logFile).size;
  } catch {} // no log yet: nothing has crashed
  let offset = size; // no record of an earlier look: what is in the log now counts as seen
  const o = readJson(stateFile)?.offset;
  if (Number.isInteger(o) && o >= 0) offset = o;
  if (offset > size) offset = 0; // the log was emptied or replaced
  const from = Math.max(offset, size - ALARM_READ);
  let buf = Buffer.alloc(0);
  if (size > from) {
    buf = Buffer.alloc(size - from);
    const fd = fs.openSync(logFile, "r");
    try {
      fs.readSync(fd, buf, 0, buf.length, from);
    } finally {
      fs.closeSync(fd);
    }
  }
  // Bytes, not characters: the cap above may have cut a line (or a character) in half, so then start after the first newline;
  // a line still being written (no newline yet) waits for the next session
  const firstNl = buf.indexOf(10);
  const begin = from > offset ? (firstNl < 0 ? buf.length : firstNl + 1) : 0;
  const end = buf.lastIndexOf(10) + 1;
  const counts = new Map();
  for (const line of (end > begin
    ? buf.subarray(begin, end).toString("utf8")
    : ""
  ).split("\n")) {
    const hook = /^\S+ ([\w.-]+): /.exec(line)?.[1];
    if (hook) counts.set(hook, (counts.get(hook) || 0) + 1);
  }
  const next = from + Math.max(begin, end);
  if (next !== offset || !fs.existsSync(stateFile))
    writeJson(stateFile, { offset: next });
  if (!counts.size) return "";
  const total = [...counts.values()].reduce((a, b) => a + b, 0);
  const names = [...counts]
    .map(([h, n]) => (n > 1 ? `${h} x${n}` : h))
    .join(", ");
  return `hook-crash: ${total} hook crash${total > 1 ? "es" : ""} since the last session (${names}). Each let its call through and did nothing. See ${logFile}. Tell the user.`;
}

// The format check: a sentence naming what is missing, or "" when all is well
function transcriptSay(input) {
  if (!input.transcript_path) return "";
  const newest = newestOther(input.transcript_path);
  if (!newest) return "";
  const { entries, bad } = tailEntries(newest);
  if (!entries.length && !bad) return ""; // one line longer than the tail, a pasted picture say: nothing to judge
  const version =
    [...entries].reverse().find((e) => e.version)?.version || "unknown";
  const state = readJson(STATE, { missing: {} });
  if (state.ok === version && version !== "unknown") return "";
  const gone = missing(entries, helperTypes(newest.p));
  if (gone === null) return "";
  if (!gone.length) {
    writeJson(STATE, { ok: version });
    return "";
  }
  return (
    `transcript-check: Claude Code ${version} changed its transcript: ${gone.join(", ")} not found in ${path.basename(newest.p)}${bad ? ` (${bad} lines did not parse)` : ""}. ` +
    `The hooks that read it (code-review-gate, repeat-guard, question-other and others) may be doing nothing. Tell the user before relying on them.`
  );
}

// Not runHook: the crash alarm must run when the input is bad or TRANSCRIPT_CHECK=off, and the two parts fail apart
if (isMain(import.meta.url)) {
  try {
    let alarm = "";
    try {
      alarm = crashAlarm();
    } catch (err) {
      crashLog("transcript-check", err);
    } // the alarm failing must not hide the format check
    let check = "";
    try {
      // a transcript that can't be read must not hide the alarm either
      const input = JSON.parse(fs.readFileSync(0, "utf8"));
      if ((process.env.TRANSCRIPT_CHECK || "").toLowerCase() !== "off")
        check = transcriptSay(input);
    } catch (err) {
      crashLog("transcript-check", err);
    }
    const say = [alarm, check].filter(Boolean).join("\n");
    if (say)
      process.stdout.write(
        JSON.stringify({
          systemMessage: say,
          hookSpecificOutput: {
            hookEventName: "SessionStart",
            additionalContext: say,
          },
        }),
      );
  } catch (err) {
    crashLog("transcript-check", err);
    // fail open
  }
}
