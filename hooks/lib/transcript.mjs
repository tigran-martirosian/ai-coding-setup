// Reading Claude Code's transcript (a private format, one JSON entry per line), once for every hook: the last part
// of the file, the main chain's entries, what the user typed, the current turn, the last reply and context size,
// helper launches and a helper's own transcript. transcript-check's missing() checks the fields read here on a
// real transcript, so a format change is said out loud instead of turning the hooks off.
import fs from "node:fs";
import path from "node:path";

// Where Claude Code compacts a session by itself (autoCompactWindow 230000 less the 33k it keeps free is 197k, and the
// size here leaves out the last reply and the next message), and the size past which that compact has failed to run
export const CONTEXT_K = { compact: 190, run: 300 };

// The last `bytes` of the file as lines. A line cut by the start of the read is dropped; [] when the file does not
// exist (none yet on a session's first prompt)
export function tail(file, bytes = 4 * 1024 * 1024) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch (e) { if (e.code === "ENOENT") return []; throw e; }
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - bytes);
    // one byte more before the start says whether the first line is whole
    const from = Math.max(0, start - 1);
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    if (start === 0) return buf.toString("utf8").split("\n");
    const nl = buf.indexOf(10);
    return nl < 0 ? [] : buf.subarray(nl + 1).toString("utf8").split("\n");
  } finally { fs.closeSync(fd); }
}

// The file's lines from the last to the first, read backwards in chunks (one line with pictures reaches MBs), so
// a caller stops reading where it found what it needs. A partial line at a chunk start is carried as a Buffer.
export function* backLines(file, chunk = 2 * 1024 * 1024) {
  let fd;
  try { fd = fs.openSync(file, "r"); } catch (e) { if (e.code === "ENOENT") return; throw e; }
  try {
    let pos = fs.fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    while (pos > 0) {
      const len = Math.min(pos, chunk);
      pos -= len;
      const part = Buffer.alloc(len);
      fs.readSync(fd, part, 0, len, pos);
      let buf = Buffer.concat([part, carry]);
      carry = Buffer.alloc(0);
      if (pos > 0) {
        const nl = buf.indexOf(10);
        if (nl < 0) { carry = buf; continue; }
        carry = buf.subarray(0, nl);
        buf = buf.subarray(nl + 1);
      }
      const lines = buf.toString("utf8").split("\n");
      for (let i = lines.length - 1; i >= 0; i--) yield lines[i];
    }
  } finally { fs.closeSync(fd); }
}

const parsed = (line) => {
  if (!line.trim()) return null;
  try { return JSON.parse(line); } catch { return null; }
};
// Entries of the main chain, in file order, from a file's text or lines; a line that doesn't parse is skipped.
// Sidechain lines (an old-format subagent's) are left out unless `sidechain` is set: every line of a subagent's
// own transcript is one.
export function entries(source, { sidechain = false } = {}) {
  const lines = typeof source === "string" ? source.split("\n") : source;
  const out = [];
  for (const l of lines) {
    const e = parsed(l);
    if (e && typeof e === "object" && (sidechain || !e.isSidechain)) out.push(e);
  }
  return out;
}
// The same entries from the last to the first, read backwards (see backLines)
export function* backEntries(file, { sidechain = false, chunk } = {}) {
  for (const l of backLines(file, chunk)) {
    const e = parsed(l);
    if (e && typeof e === "object" && (sidechain || !e.isSidechain)) yield e;
  }
}

// User text Claude Code, Nimbalyst or a hook adds on its own: an interrupt, a background task's notice, Nimbalyst's
// "[System: ...]" and "[Child Session Update]" prompts (they come with promptSource "sdk" like typed ones), a Stop
// hook's feedback, the synthetic "No response requested." and the note above a local command's output
export const INJECTED = /^\s*(\[(Request interrupted|System|SYSTEM NOTIFICATION|Child Session|Stop hook)|<task-notification>|<synthetic>|Stop hook feedback:|Caveat: The messages below)/;
export const INTERRUPTED = /^\[Request interrupted/;

const blocksText = (c) => c.filter((b) => b?.type === "text").map((b) => b.text || "").join("\n");
// A user entry's own text (a string, or its text blocks); "" for a tool result
export const userText = (e) => {
  const c = e.message?.content;
  return typeof c === "string" ? c : Array.isArray(c) ? blocksText(c) : "";
};
// An assistant entry's visible text
export const assistantText = (e) => (Array.isArray(e.message?.content) ? blocksText(e.message.content) : "");

// A message the user typed: not a tool result, a skill's text (isMeta), a compact's summary, a task notification or
// other injected text
export const typedByUser = (e) => {
  if (e.type !== "user" || e.isMeta || e.isCompactSummary || e.promptSource === "system" || e.origin?.kind === "task-notification") return false;
  const t = userText(e).trim();
  return !!t && !INJECTED.test(t);
};

// The current turn, from entries in file order. By default it starts at the last message that started a turn,
// typed or a system event (a task's notice, "[System: ...]"), and `start` is that message when the user typed it,
// else null; `opener` is that message either way. With `typed`, it starts at the user's last typed message, so
// system events after it stay in the turn.
export function currentTurn(list, { typed = false } = {}) {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (typed) {
      if (typedByUser(e)) return { start: e, opener: e, entries: list.slice(i + 1) };
      continue;
    }
    if (e.type !== "user" || e.isMeta || e.isCompactSummary) continue;
    const t = userText(e).trim();
    if (!t || INTERRUPTED.test(t)) continue;
    return { start: typedByUser(e) ? e : null, opener: e, entries: list.slice(i + 1) };
  }
  return { start: null, opener: null, entries: list };
}

// The text Claude wrote after its last tool call (the part the user reads as the reply)
export function lastReply(list) {
  const parts = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (e.type === "user") break;
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    if (e.message.content.some((b) => b.type === "tool_use")) break;
    const t = assistantText(e);
    if (t) parts.unshift(t);
  }
  return parts.join("\n");
}

export const SYNTHETIC = "<synthetic>";
// The context one API call sent: its input, cache read and cache creation tokens
export const contextTokens = (u) => (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
// The context size of the last API call, from entries in file order or what backEntries yields (newest first):
// { tokens, entry } of the last real assistant reply with usage, or null when there is none. With `compact`, a
// compact that came after it gives what the compact left (compactMetadata.postTokens). With `timed`, only a reply
// with a timestamp counts.
export function lastUsage(list, { compact = false, timed = false } = {}) {
  const newestFirst = Array.isArray(list) ? list.slice().reverse() : list;
  for (const e of newestFirst) {
    if (compact && e.type === "system" && e.subtype === "compact_boundary") return { tokens: e.compactMetadata?.postTokens ?? 0, entry: e };
    const u = e.message?.usage;
    if (e.type !== "assistant" || !u || e.message.model === SYNTHETIC || (timed && !e.timestamp)) continue;
    return { tokens: contextTokens(u), entry: e };
  }
  return null;
}

// The tools that put a question form in front of the user (built-in, Nimbalyst's or another server's)
export const QUESTION_TOOLS = /^(mcp__[\w-]+__)?(AskUserQuestion|PromptForUserInput|ExitPlanMode)$/;

// A helper's own transcript. A subagent's hook gets the PARENT's transcript_path: the helper's file is
// <dir>/<session>/subagents/agent-<id>.jsonl (session: the given id, else the parent file's name); a path that
// already is an agent-*.jsonl file is that file
export function subagentPath(transcriptPath, agentId, sessionId) {
  const given = String(transcriptPath);
  if (/^agent-.*\.jsonl$/.test(path.basename(given))) return given;
  return path.join(path.dirname(given), String(sessionId || path.basename(given, ".jsonl")), "subagents", `agent-${agentId}.jsonl`);
}
// A helper's type (worker, reviewer...) from the .meta.json beside its transcript, or null when there is none
export function agentType(subagentFile) {
  let text;
  try { text = fs.readFileSync(String(subagentFile).replace(/\.jsonl$/, ".meta.json"), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; }
  return JSON.parse(text).agentType ?? null;
}

// The background task a tool result started: an Agent's "agentId: X", a background command's "Command running in
// background with ID: X" or "moved to the background (ID: X)"
const LAUNCH = /agentId: (\w+)|Command running in background with ID: (\w+)|moved to the background \(ID: (\w+)\)/;
const resultText = (c) => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => b.text || "").join("\n") : "");
// Helper and background-command launches in entries (file order): { index, toolUseId, task, async }, async when it
// runs in the background (toolUseResult status "async_launched", or a background command)
export function agentLaunches(list) {
  const out = [];
  list.forEach((e, index) => {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) return;
    const r = e.toolUseResult;
    for (const b of e.message.content) {
      if (b.type !== "tool_result") continue;
      const m = LAUNCH.exec(resultText(b.content));
      if (m) out.push({ index, toolUseId: b.tool_use_id, task: m[1] || m[2] || m[3], async: !m[1] || r?.status === "async_launched" || /^Async agent launched/.test(resultText(b.content)) });
      else if (r?.status === "async_launched" && r.agentId) out.push({ index, toolUseId: b.tool_use_id, task: String(r.agentId), async: true });
    }
  });
  return out;
}
