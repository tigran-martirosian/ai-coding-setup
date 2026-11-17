// The live view (actions 25 to 28 of the PC program design): tool calls as they happen, helpers and context use.
// A watch follows the session's transcript by reading only what was appended since the last check, and reads the
// database (read only) for the state, the queue and the transcript link. One check a second (CHECK_MS): the
// three database reads stay under 0.5 ms (probe 3) and the transcript costs one stat when nothing was added.
// A new transcript file (provider_session_id changed) or a shorter one tells the page to reopen the session.
// One watch per device; it ends on session.unwatch, when the device's channel session ends, or after
// WATCH_LIMIT_MS without the page renewing it (calling session.watch again).
import fs from "node:fs";
import path from "node:path";
import { knownSession, openDb, sessionRow } from "../core/db.mjs";
import { mapState, SESSION_INPUT, watchDoor } from "../core/door.mjs";
import {
  checkPath,
  linksOf,
  sessionFile,
  sessionPlace,
} from "../core/files.mjs";
import { log } from "../core/log.mjs";
import { ActionError } from "../core/registry.mjs";
import {
  labelOf,
  namedFile,
  resultsOf,
  toTurn,
  transcriptPath,
} from "../core/transcripts.mjs";

export const CHECK_MS = 1000;
const WATCH_LIMIT_MS = 10 * 60 * 1000;
const MAX_READ = 1024 * 1024; // the most of a transcript read in one check; the rest comes next check
const TAIL = 256 * 1024;
const MAX_TAIL = 8 * 1024 * 1024; // how far back the last token count is looked for
const MAX_TEXT = 100000;
const MAX_THINKING = 4000; // the most of one thinking block sent to the page
const SUMMARY = 200;
const HELPER_TOOL = new Set(["Agent", "Task"]);
const BIG_WINDOW = 1000000;
const WINDOW = 200000;

// ---- reading a transcript

const parse = (bytes) => {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    return null; // a line still being written, or not JSON
  }
};

// Whole lines of `data`; `rest` is the part after the last newline (a line not finished yet).
function splitLines(data) {
  const lines = [];
  let start = 0;
  for (let i = 0; i < data.length; i++)
    if (data[i] === 10) {
      if (i > start) lines.push(data.subarray(start, i));
      start = i + 1;
    }
  return { lines, rest: data.subarray(start) };
}

function readSpan(fd, from, to) {
  const buf = Buffer.alloc(to - from);
  fs.readSync(fd, buf, 0, buf.length, from);
  return buf;
}

// Every parsed line of a file that ends before byte `stop` (the file's end when left out), oldest first, in
// pieces of MAX_READ.
function allLines(file, stop) {
  const fd = fs.openSync(checkPath(file), "r");
  try {
    const size = stop ?? fs.fstatSync(fd).size;
    const out = [];
    let carry = Buffer.alloc(0);
    for (let pos = 0; pos < size; pos += MAX_READ) {
      const data = Buffer.concat([
        carry,
        readSpan(fd, pos, Math.min(size, pos + MAX_READ)),
      ]);
      const { lines, rest } = splitLines(data);
      for (const l of lines) out.push(parse(l));
      carry = rest;
    }
    if (carry.length) out.push(parse(carry));
    return out.filter(Boolean);
  } finally {
    fs.closeSync(fd);
  }
}

// The newest line `pick` accepts, read backwards from byte `stop` (the file's end when left out), at most
// MAX_TAIL bytes; null when none.
function lastLine(file, pick, stop) {
  const fd = fs.openSync(checkPath(file), "r");
  try {
    const size = stop ?? fs.fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    for (let pos = size; pos > 0 && size - pos < MAX_TAIL; ) {
      const from = Math.max(0, pos - TAIL);
      const data = Buffer.concat([readSpan(fd, from, pos), carry]);
      const cut = from === 0 ? 0 : data.indexOf(10) + 1;
      carry = data.subarray(0, cut);
      const { lines, rest } = splitLines(data.subarray(cut));
      if (rest.length) lines.push(rest);
      for (let i = lines.length - 1; i >= 0; i--) {
        const l = parse(lines[i]);
        if (l && pick(l)) return l;
      }
      pos = from;
    }
    return null;
  } finally {
    fs.closeSync(fd);
  }
}

const partsOf = (line, type) =>
  Array.isArray(line?.message?.content)
    ? line.message.content.filter((p) => p?.type === type)
    : [];

const mainAssistant = (l) =>
  l.type === "assistant" && !l.isSidechain && !!l.message?.usage;

const firstLine = (s) => String(s).split("\n")[0].trim();

// Tokens in the model's context for one usage block: the input and both cache counts.
const contextTokens = (u) =>
  (u.input_tokens ?? 0) +
  (u.cache_read_input_tokens ?? 0) +
  (u.cache_creation_input_tokens ?? 0);

// ---- context use (action 28)

export function windowOf(model) {
  if (typeof model !== "string" || !model)
    throw new Error("the session has no model in the database");
  return /-1m$/i.test(model) ? BIG_WINDOW : WINDOW;
}

function contextOf(usageLine, model) {
  const window = windowOf(model);
  if (!usageLine) return { used: null, window, percent: null };
  const used = contextTokens(usageLine.message.usage);
  return { used, window, percent: Math.round((used / window) * 100) };
}

// ---- live rows

// A thinking block: its time, and its text when the transcript holds one (most blocks hold only a signature).
function thinkingRow(p, at) {
  const text = typeof p.thinking === "string" ? p.thinking.trim() : "";
  if (!text) return { kind: "thinking", at };
  return text.length > MAX_THINKING
    ? { kind: "thinking", at, text: text.slice(0, MAX_THINKING), cut: true }
    : { kind: "thinking", at, text };
}

const cutText = (text, at, role) =>
  text.length > MAX_TEXT
    ? { kind: "text", role, text: text.slice(0, MAX_TEXT), cut: true, at }
    : { kind: "text", role, text, at };

// The rows one transcript line adds to the live view: tool calls, their results, thinking, and text turns.
// A thinking row's `at` is when the block was written, at the end of the thinking.
export function rowsOf(line) {
  if (!line?.message || line.isSidechain || line.isMeta) return [];
  const at = line.timestamp ?? null;
  const content = line.message.content;
  if (line.type === "assistant") {
    if (!Array.isArray(content)) return [];
    const rows = [];
    for (const p of content) {
      if (p?.type === "tool_use")
        rows.push({
          kind: "tool",
          id: String(p.id),
          tool: String(p.name),
          label: labelOf(p.input),
          at,
        });
      else if (p?.type === "thinking") rows.push(thinkingRow(p, at));
      else if (p?.type === "text" && typeof p.text === "string" && p.text)
        rows.push(cutText(p.text, at, "assistant"));
    }
    return rows;
  }
  if (line.type === "user") {
    const results = partsOf(line, "tool_result");
    if (results.length)
      return results.map((p) => ({
        kind: "result",
        id: String(p.tool_use_id),
        error: p.is_error === true,
        at,
      }));
    const turn = toTurn(line);
    if (!turn) return [];
    if (turn.system)
      return [
        {
          kind: "text",
          role: "user",
          system: turn.system,
          text: turn.text,
          status: turn.status,
          at,
        },
      ];
    return [cutText(turn.text, at, "user")];
  }
  return [];
}

// The file fields of the files design on a line's rows: a tool row's `file` and `pos` (the line's byte offset), a
// result row's `add` and `del`, an assistant text row's `links`. `place` is the session's (sessionPlace).
function withFiles(rows, line, pos, place) {
  const uses = new Map(
    partsOf(line, "tool_use").map((p) => [String(p.id), p.input]),
  );
  const results = resultsOf(line);
  return rows.map((r) => {
    if (r.kind === "tool") {
      const named = namedFile(uses.get(r.id));
      return {
        ...r,
        file: named ? sessionFile(place, named).file : null,
        pos,
      };
    }
    if (r.kind === "result") {
      const c = results.get(r.id)?.counts;
      return { ...r, add: c ? c.add : null, del: c ? c.del : null };
    }
    if (r.kind === "text" && r.role === "assistant")
      return { ...r, links: linksOf(r.text, place, place.base) };
    return r;
  });
}

// A prompt that starts a turn: a user line with words, not a tool's result.
const isPrompt = (l) =>
  l.type === "user" &&
  !l.isSidechain &&
  !partsOf(l, "tool_result").length &&
  toTurn(l) !== null;

// The newest work row before the watch began (before byte `stop`): { at, open } (open: a tool call still waiting
// for its result), or null when the transcript has none.
function tailOf(file, stop) {
  const line = lastLine(file, (l) => rowsOf(l).length > 0, stop);
  if (!line) return null;
  const last = rowsOf(line).pop();
  return { at: last.at, open: last.kind === "tool" };
}

// ---- helpers (action 27)

// Notes a line's helper calls and helper results in `index` (tool call id -> entry). True when it changed.
function noteHelpers(index, line) {
  if (!line?.message || line.isSidechain) return false;
  let changed = false;
  if (line.type === "assistant")
    for (const p of partsOf(line, "tool_use"))
      if (HELPER_TOOL.has(p.name)) {
        index.set(String(p.id), {
          id: String(p.id),
          name: labelOf({ description: p.input?.description }),
          type: p.input?.subagent_type ?? null,
          since: line.timestamp ?? null,
          result: null,
        });
        changed = true;
      }
  if (line.type === "user")
    for (const p of partsOf(line, "tool_result")) {
      const h = index.get(String(p.tool_use_id));
      if (!h) continue;
      h.result = {
        error: p.is_error === true,
        info:
          line.toolUseResult && typeof line.toolUseResult === "object"
            ? line.toolUseResult
            : null,
        text:
          typeof p.content === "string"
            ? p.content
            : Array.isArray(p.content)
              ? p.content
                  .filter((c) => c?.type === "text")
                  .map((c) => c.text)
                  .join("\n")
              : "",
      };
      changed = true;
    }
  return changed;
}

const helperIndex = (lines) => {
  const index = new Map();
  for (const l of lines) noteHelpers(index, l);
  return index;
};

// Each helper's own transcript: <transcript without .jsonl>/subagents/agent-<id>.jsonl, named by the .meta.json
// beside it, whose toolUseId is the helper call's id. Fills `agents` (tool call id -> file) for the ids asked.
function findAgentFiles(file, ids, agents) {
  const want = ids.filter((id) => !agents.has(id));
  if (!want.length) return;
  const dir = path.join(
    path.dirname(file),
    path.basename(file, ".jsonl"),
    "subagents",
  );
  const real = checkPath(dir);
  if (!fs.existsSync(real)) return;
  for (const name of fs.readdirSync(real)) {
    if (!name.endsWith(".meta.json")) continue;
    const meta = parse(fs.readFileSync(checkPath(path.join(real, name))));
    if (meta && want.includes(meta.toolUseId))
      agents.set(
        meta.toolUseId,
        path.join(real, name.replace(/\.meta\.json$/, ".jsonl")),
      );
  }
}

// A running helper's tokens and current step, from the last answer in its own transcript.
function agentNow(agentFile) {
  if (!agentFile || !fs.existsSync(checkPath(agentFile)))
    return { tokens: null, step: null };
  const last = lastLine(
    agentFile,
    (l) => l.type === "assistant" && !!l.message?.usage,
  );
  if (!last) return { tokens: null, step: null };
  const use = partsOf(last, "tool_use").pop();
  return {
    tokens:
      contextTokens(last.message.usage) +
      (last.message.usage.output_tokens ?? 0),
    step: use ? { tool: String(use.name), label: labelOf(use.input) } : null,
  };
}

// [{ id, name, type, state, since, ms, tokens, tools, step, summary }], oldest first. state: "running" (no result
// yet and the session runs or waits), "stopped" (no result and the session is idle), "done" or "failed".
// tokens: the result's totalTokens, or for a running helper its last answer's input, cache and output counts
// (the same sum Claude Code reports as totalTokens). step: a running helper's newest tool call { tool, label }.
function helperList(index, file, status, agents) {
  const all = [...index.values()];
  findAgentFiles(
    file,
    all.filter((h) => !h.result).map((h) => h.id),
    agents,
  );
  const sessionOn = mapState(status) !== "idle";
  return all.map((h) => {
    const base = { id: h.id, name: h.name, type: h.type, since: h.since };
    if (h.result) {
      const i = h.result.info;
      const ok = !h.result.error && i?.status === "completed";
      return {
        ...base,
        state: ok ? "done" : "failed",
        ms: i?.totalDurationMs ?? null,
        tokens: i?.totalTokens ?? null,
        tools: i?.totalToolUseCount ?? null,
        step: null,
        summary: firstLine(h.result.text).slice(0, SUMMARY) || null,
      };
    }
    const now = agentNow(agents.get(h.id));
    return {
      ...base,
      state: sessionOn ? "running" : "stopped",
      ms: null, // still running: the page counts from `since`, so the list does not change every check
      tokens: now.tokens,
      tools: null,
      step: now.step,
      summary: null,
    };
  });
}

// ---- the queue, from the database (probe 3's read)

// Only `pending` rows wait; an `executing` one was already handed to the session.
function queueOf(sessionId) {
  return openDb()
    .prepare(
      `SELECT id, prompt, created_at FROM queued_prompts
       WHERE session_id = ? AND status = 'pending' ORDER BY created_at`,
    )
    .all(sessionId)
    .map((q) => ({
      queueId: q.id,
      text: String(q.prompt).slice(0, 300),
      createdAt: q.created_at,
    }));
}

// ---- watching (actions 25 and 26)

const watches = new Map(); // device -> watch

// How many watches run now (for the tests: a watch that ended is gone).
export const watchCount = () => watches.size;

// Follows `file` from byte `at` (session.open's `end`; the file's end when null), or from its start when
// `fromStart`, with its helpers and last token count before that byte.
function follow(w, file, fromStart, at = null) {
  w.file = file;
  w.carry = Buffer.alloc(0);
  w.seen = !!file && fs.existsSync(checkPath(file));
  if (!w.seen) {
    w.pos = 0;
    w.helperIndex = new Map();
    w.usageLine = null;
    w.turnAt = null;
    w.tail = null;
    return;
  }
  w.pos = fromStart ? 0 : (at ?? fs.statSync(checkPath(file)).size);
  w.helperIndex = fromStart ? new Map() : helperIndex(allLines(file, w.pos));
  w.usageLine = fromStart ? null : lastLine(file, mainAssistant, w.pos);
  w.turnAt = fromStart
    ? null
    : (lastLine(file, isPrompt, w.pos)?.timestamp ?? null);
  w.tail = fromStart ? null : tailOf(file, w.pos);
}

// The lines appended since the last check, at most MAX_READ bytes of them, each as { pos, line } with its byte
// offset. null when the file got shorter.
function appended(w) {
  const fd = fs.openSync(checkPath(w.file), "r");
  try {
    const size = fs.fstatSync(fd).size;
    if (size < w.pos) return null;
    if (size === w.pos) return [];
    const to = Math.min(size, w.pos + MAX_READ);
    const data = Buffer.concat([w.carry, readSpan(fd, w.pos, to)]);
    const base = w.pos - w.carry.length;
    const { lines, rest } = splitLines(data);
    w.pos = to;
    w.carry = rest;
    return lines
      .map((l) => ({
        pos: base + l.byteOffset - data.byteOffset,
        line: parse(l),
      }))
      .filter((l) => l.line);
  } finally {
    fs.closeSync(fd);
  }
}

function stopWatch(w, why) {
  if (w.stopped) return;
  w.stopped = true;
  if (watches.get(w.device) === w) watches.delete(w.device);
  clearInterval(w.timer);
  w.offEnd?.();
  if (why) w.push({ e: "live", d: { session: w.session, ended: why } });
}

// One check: pushes evt live { session, rows, and only what changed of state, queue, helpers, context, turnAt }, or
// { session, rows: [], reopen: true } when the transcript was replaced (the page then calls session.open again).
function check(w) {
  if (Date.now() > w.until) return stopWatch(w, "timeout");
  const row = sessionRow(w.session);
  if (!row) return stopWatch(w, "no-session");
  const d = { session: w.session, rows: [] };
  const file = transcriptPath(row);
  if (file !== w.file) {
    // A session that had not run yet is read from its start; a new file for a session that had one is a reopen.
    const had = w.file !== null;
    follow(w, file, !had);
    if (had) d.reopen = true;
  }
  let helpersChanged = false;
  if (w.file) {
    const exists = fs.existsSync(checkPath(w.file));
    if (!exists && w.seen) return stopWatch(w, "transcript-gone");
    if (exists) {
      w.seen = true;
      const lines = appended(w);
      if (lines === null) {
        follow(w, w.file, false);
        d.reopen = true;
      } else
        for (const { pos, line: l } of lines) {
          // Every row carries its line's offset: the page drops the ones a later session.open already holds.
          for (const r of withFiles(rowsOf(l), l, pos, sessionPlace(row)))
            d.rows.push({ ...r, pos });
          if (noteHelpers(w.helperIndex, l)) helpersChanged = true;
          if (mainAssistant(l)) w.usageLine = l;
          if (isPrompt(l)) w.turnAt = l.timestamp ?? null;
        }
    }
  }
  const state = mapState(row.status);
  if (state !== w.last.state) d.state = state;
  const queue = queueOf(w.session);
  const context = contextOf(w.usageLine, row.model);
  const running = w.last.helpers?.some((h) => h.state === "running");
  const helpers =
    helpersChanged || running || d.state || d.reopen || !w.last.helpers
      ? helperList(w.helperIndex, w.file, row.status, w.agents)
      : w.last.helpers;
  const turnAt = w.turnAt;
  for (const [k, v] of Object.entries({ queue, context, helpers, turnAt }))
    if (JSON.stringify(v) !== JSON.stringify(w.last[k])) d[k] = v;
  w.last = { state, queue, context, helpers, turnAt };
  if (Object.keys(d).length > 2 || d.rows.length)
    w.push({ e: "live", d: { ...d, at: readTo(w) } });
}

// The transcript position up to which rows were read: the start of the line not yet whole. After a reconnect the
// page asks session.watch with this as `start` and gets only the rows it missed (phone steady design, section 5).
const readTo = (w) => w.pos - w.carry.length;

// turnAt: when the newest prompt was written (the turn's start; null when the transcript has none). tail: the
// newest work row before the watch began, so the page can count a Thinking row before the first push. at: readTo.
const snapshot = (w) => ({
  watching: true,
  checkMs: CHECK_MS,
  ...w.last,
  tail: w.tail,
  at: readTo(w),
});

function startWatch(d, ctx) {
  if (typeof ctx.pushHere !== "function" || typeof ctx.onEnd !== "function")
    throw new Error("the channel gives this action no pushHere or onEnd");
  const had = watches.get(ctx.device);
  // A renewal; a call with `start` (a view that just read session.open) starts the watch again from there.
  if (had && had.session === d.session && d.start === undefined) {
    had.until = Date.now() + WATCH_LIMIT_MS;
    return snapshot(had);
  }
  const { row } = knownSession(d.session);
  const file = transcriptPath(row);
  if (file && !fs.existsSync(checkPath(file)))
    throw new ActionError("transcript-gone");
  // `start` is never past the file's end (a session that has not run yet has none: 0 only).
  const size = file ? fs.statSync(checkPath(file)).size : 0;
  if (d.start !== undefined && d.start > size)
    throw new ActionError("bad-input", { field: "start" });
  if (had) stopWatch(had, null);
  const w = {
    device: ctx.device,
    session: d.session,
    push: ctx.pushHere,
    until: Date.now() + WATCH_LIMIT_MS,
    agents: new Map(),
    stopped: false,
  };
  follow(w, file, false, d.start ?? null);
  const state = mapState(row.status);
  w.last = {
    state,
    queue: queueOf(d.session),
    context: contextOf(w.usageLine, row.model),
    helpers: helperList(w.helperIndex, w.file, row.status, w.agents),
    turnAt: w.turnAt,
  };
  watches.set(ctx.device, w);
  w.timer = setInterval(() => {
    try {
      check(w);
    } catch (e) {
      log("error", `live: ${e.message}`);
      stopWatch(w, "failed");
    }
  }, CHECK_MS);
  w.timer.unref();
  w.offEnd = ctx.onEnd(() => stopWatch(w, null));
  return snapshot(w);
}

// The transcript of a session the door lists, or null when it has not run yet; a missing file is transcript-gone.
function fileOf(sessionId) {
  const { row } = knownSession(sessionId);
  const file = transcriptPath(row);
  if (file && !fs.existsSync(checkPath(file)))
    throw new ActionError("transcript-gone");
  return { row, file };
}

export function register(registry) {
  watchDoor();

  registry.add({
    name: "session.watch",
    input: {
      session: SESSION_INPUT,
      start: {
        type: "integer",
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        optional: true,
      },
    },
    run: (d, ctx) => startWatch(d, ctx),
  });

  registry.add({
    name: "session.unwatch",
    input: { session: SESSION_INPUT },
    run: (d, ctx) => {
      const w = watches.get(ctx.device);
      if (w && w.session === d.session) stopWatch(w, null);
      return { watching: false };
    },
  });

  registry.add({
    name: "session.helpers",
    input: { session: SESSION_INPUT },
    run: (d) => {
      const { row, file } = fileOf(d.session);
      if (!file) return [];
      return helperList(
        helperIndex(allLines(file)),
        file,
        row.status,
        new Map(),
      );
    },
  });

  registry.add({
    name: "session.context",
    input: { session: SESSION_INPUT },
    run: (d) => {
      const { row, file } = fileOf(d.session);
      return contextOf(file ? lastLine(file, mainAssistant) : null, row.model);
    },
  });
}
