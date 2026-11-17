// A session's transcript: ~/.claude/projects/<folder>/<provider_session_id>.jsonl (PC program design, section 4).
// <folder> is the worktree path when the session has one, else the project path, with every character that is not
// a letter or digit turned into "-". The file of provider_session_id is always the one followed (it stays the
// same after a /clear, probe 4). A missing file is "transcript-gone"; nothing is guessed.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { withoutNote } from "./door.mjs";
import { checkPath, linksOf, sessionFile } from "./files.mjs";
import { ActionError } from "./registry.mjs";

const ID = /^[0-9a-f-]{36}$/;
const CHUNK = 256 * 1024;

export const folderName = (p) => String(p).replace(/[^A-Za-z0-9]/g, "-");

// The transcript's path for a database row, or null when the session has not run yet (no Claude Code id).
export function transcriptPath(row) {
  const id = row.provider_session_id;
  if (id === null || id === undefined) return null;
  if (!ID.test(id))
    throw new Error(`session ${row.id}: provider_session_id is not an id`);
  const folder = folderName(row.worktree_path || row.workspace_id);
  return path.join(os.homedir(), ".claude", "projects", folder, `${id}.jsonl`);
}

// User text the system wrote, as Nimbalyst's chat treats it. Nimbalyst hides command wrappers, system reminders and
// its own system messages (isCliBookkeepingText, in its Claude Code transcript import), and hook and task notices
// (CLAUDE_CODE_TRANSIENT_SYSTEM_SUBTYPES, runtime/src/storage/nonRenderingFrames.ts); a finished helper reaches its
// chat only as a short note with the helper's summary (buildTaskResultContinuationMessage). Only a line that starts
// with a tag counts, so a message that quotes one still shows whole.
const HIDDEN =
  /^\s*(<(command-name|command-message|command-args|local-command-stdout|local-command-stderr|local-command-caveat|nimbalyst_system_message|user-prompt-submit-hook)>|Caveat: The messages below|Stop hook feedback:|\[Stop hook)/i;
const REMINDERS = /^\s*(<system-reminder>[\s\S]*?<\/system-reminder>\s*)+$/i;
const HELPER = /^\s*<task-notification>/;
const SUMMARY = 200;

const tagOf = (text, tag) =>
  text.match(new RegExp(`<${tag}>([\\s\\S]*?)</${tag}>`))?.[1].trim() ?? null;

// The text parts of a message, without parts that hold only system reminders.
function textOf(content) {
  const parts =
    typeof content === "string"
      ? [content]
      : Array.isArray(content)
        ? content
            .filter((p) => p?.type === "text" && typeof p.text === "string")
            .map((p) => p.text)
        : [];
  return parts.filter((t) => !REMINDERS.test(t)).join("\n");
}

// A helper's notice as a short row: its summary's first line and its status, never the notice's own text.
function helperTurn(text, at) {
  const summary = (tagOf(text, "summary") ?? "").split("\n")[0].trim();
  return {
    role: "user",
    system: "helper",
    text: summary.slice(0, SUMMARY),
    status: tagOf(text, "status"),
    at,
  };
}

// One transcript line as a turn the phone shows, or null for lines that are not one (tool results, meta, system).
// A prompt sent from the phone shows without the note the door added, so the page finds its own words again.
// A helper's notice is a turn marked `system: "helper"`; other text the system wrote is not a turn.
export function toTurn(line) {
  const m = line?.message;
  if (!m || line.isMeta) return null;
  if (line.type === "user") {
    const at = line.timestamp ?? null;
    const raw = textOf(m.content);
    if (HELPER.test(raw)) return helperTurn(raw, at);
    if (HIDDEN.test(raw)) return null;
    const text = withoutNote(raw);
    return text ? { role: "user", text, at } : null;
  }
  if (line.type === "assistant") {
    const text = textOf(m.content);
    const tools = Array.isArray(m.content)
      ? m.content
          .filter((p) => p?.type === "tool_use")
          .map((p) => String(p.name))
      : [];
    if (!text && !tools.length) return null;
    return { role: "assistant", text, tools, at: line.timestamp ?? null };
  }
  return null;
}

// The texts steer.mjs may have put notes in, by the way it delivered them: after a tool call (a hook's added context,
// an attachment line), as the session was finishing (Stop hook feedback, a user line) or by holding a tool call (the
// call's refused result).
function steerTexts(line) {
  if (line?.isSidechain) return [];
  const a = line?.attachment;
  if (line?.type === "attachment")
    return a?.type === "hook_additional_context"
      ? [a.content].flat().filter((p) => typeof p === "string")
      : [];
  const c = line?.message?.content;
  if (line?.type !== "user" || line.isMeta) return [];
  if (typeof c === "string") return /^Stop hook feedback:/.test(c) ? [c] : [];
  if (!Array.isArray(c)) return [];
  return c
    .filter((p) => p?.type === "tool_result")
    .flatMap((p) => [p.content].flat())
    .map((p) => (typeof p === "string" ? p : p?.text))
    .filter((p) => typeof p === "string");
}

// What steer writes after the last note: a report, a typed message, its own remarks, what to do next.
const AFTER_NOTES =
  /\n(?:\[[a-z]+\] |Now decide about the held call|Deal with it now, then finish)/;

// The notes steer.mjs handed the session (a Note from the desktop button or the phone, /btw):
// "[btw] <rules>\n- [note <id>] <text>", one "- [note" line per note, before what AFTER_NOTES names. Each note is a
// user turn marked `note: true`, without the line the phone adds, so the page finds its own words again.
export function notesOf(line) {
  const out = [];
  for (const part of steerTexts(line)) {
    const from = part.indexOf("[btw] ");
    if (from < 0) continue;
    const body = part.slice(from + 6).split(AFTER_NOTES)[0];
    for (const piece of body.split(/\n- \[note [a-z0-9]+\] /).slice(1)) {
      const text = withoutNote(piece.trim());
      if (text)
        out.push({
          role: "user",
          note: true,
          text,
          at: line.timestamp ?? null,
        });
    }
  }
  return out;
}

// The transcript's lines that end before byte `stop`, newest first, each as { at, line } with its byte offset and
// its parsed JSON. A line that does not parse (one still being written) is skipped.
function* linesBackward(fd, stop) {
  let pos = stop;
  let carry = Buffer.alloc(0); // the start of a line cut by the chunk edge
  while (pos > 0) {
    const from = Math.max(0, pos - CHUNK);
    const buf = Buffer.alloc(pos - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    const data = Buffer.concat([buf, carry]);
    // Whole lines only: the part before the first newline may continue in the chunk before.
    let cut = from === 0 ? 0 : data.indexOf(10) + 1;
    if (from > 0 && cut === 0) cut = data.length; // no newline: all of it is carried
    carry = data.subarray(0, cut);
    const lines = [];
    let start = cut;
    for (let i = cut; i <= data.length; i++) {
      if (i === data.length || data[i] === 10) {
        if (i > start)
          lines.push({ at: from + start, bytes: data.subarray(start, i) });
        start = i + 1;
      }
    }
    for (const l of lines.reverse()) {
      let line;
      try {
        line = JSON.parse(l.bytes.toString("utf8"));
      } catch {
        continue; /* a line still being written */
      }
      yield { at: l.at, line };
    }
    pos = from;
  }
}

function openTranscript(file) {
  const real = checkPath(file);
  if (!fs.existsSync(real)) throw new ActionError("transcript-gone");
  return fs.openSync(real, "r");
}

// ---- steps and the files they name (files design, "New fields on what exists")

const LABEL = 120;
export const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write"]);
// The most of a transcript read for one ask, each way.
export const MAX_REACH = 16 * 1024 * 1024;

const firstLine = (s) => String(s).split("\n")[0].trim();

// A tool call in a few words: the input field that says the most, first line, cut.
export function labelOf(input) {
  const i = input && typeof input === "object" ? input : {};
  for (const k of [
    "description",
    "command",
    "file_path",
    "path",
    "pattern",
    "url",
    "query",
    "prompt",
  ])
    if (typeof i[k] === "string" && i[k].trim())
      return firstLine(i[k]).slice(0, LABEL);
  return null;
}

const lineCount = (text) =>
  text === "" ? 0 : text.split("\n").length - (text.endsWith("\n") ? 1 : 0);

// Lines added and removed by an edit's result: { add, del, created }, or null when it holds no patch.
export function countsOf(result) {
  const patch = result?.structuredPatch;
  if (!Array.isArray(patch)) return null;
  if (!patch.length && result.type === "create")
    return {
      add: lineCount(String(result.content ?? "")),
      del: 0,
      created: true,
    };
  let add = 0;
  let del = 0;
  for (const h of patch)
    for (const l of h.lines ?? []) {
      if (l.startsWith("+")) add++;
      else if (l.startsWith("-")) del++;
    }
  return { add, del, created: result.type === "create" };
}

// The file a tool call names (file_path, notebook_path, or path), or null.
export const namedFile = (input) =>
  [input?.file_path, input?.notebook_path, input?.path].find(
    (v) => typeof v === "string" && v,
  ) ?? null;

// The tool results of a user line: id -> { counts, error }. A line's toolUseResult belongs to its only result.
export function resultsOf(line) {
  const out = new Map();
  if (line?.type !== "user" || !Array.isArray(line.message?.content))
    return out;
  const parts = line.message.content.filter((p) => p?.type === "tool_result");
  for (const p of parts)
    out.set(String(p.tool_use_id), {
      counts: parts.length === 1 ? countsOf(line.toolUseResult) : null,
      error: p.is_error === true,
    });
  return out;
}

// One entry per tool call of an assistant line: { id, tool, label, file, add, del, error }; `results` maps a call id
// to its result's counts (none yet: add, del and error are null).
export function stepsOf(line, place, results) {
  if (line?.type !== "assistant" || !Array.isArray(line.message?.content))
    return [];
  return line.message.content
    .filter((p) => p?.type === "tool_use")
    .map((p) => {
      const id = String(p.id);
      const r = results.get(id);
      const named = namedFile(p.input);
      const counts = EDIT_TOOLS.has(p.name) ? (r?.counts ?? null) : null;
      return {
        id,
        tool: String(p.name),
        label: labelOf(p.input),
        file: named ? sessionFile(place, named).file : null,
        add: counts ? counts.add : null,
        del: counts ? counts.del : null,
        error: r ? r.error : null,
      };
    });
}

// The lines from byte `from` on, oldest first, at most `reach` bytes: visit({ at, line }) returns true to stop.
// Returns { cut: true } when the reach ran out before the file's end.
export function readForward(fd, from, reach, visit) {
  const size = fs.fstatSync(fd).size;
  let carry = Buffer.alloc(0);
  let pos = from;
  while (pos < size) {
    if (pos - from >= reach) return { cut: true };
    const to = Math.min(size, pos + CHUNK);
    const buf = Buffer.alloc(to - pos);
    fs.readSync(fd, buf, 0, buf.length, pos);
    const data = Buffer.concat([carry, buf]);
    const base = pos - carry.length;
    let start = 0;
    for (let i = 0; i < data.length; i++)
      if (data[i] === 10) {
        if (i > start) {
          let line = null;
          try {
            line = JSON.parse(data.subarray(start, i).toString("utf8"));
          } catch {
            /* not JSON */
          }
          if (line && visit({ at: base + start, line })) return { cut: false };
        }
        start = i + 1;
      }
    carry = data.subarray(start);
    pos = to;
  }
  return { cut: false };
}

// An `at` the phone sent: a whole number from 0 up to the size that starts a line, else bad-input.
function checkAt(fd, at) {
  const size = fs.fstatSync(fd).size;
  if (!Number.isSafeInteger(at) || at < 0 || at > size)
    throw new ActionError("bad-input", { field: "at" });
  if (at > 0) {
    const b = Buffer.alloc(1);
    fs.readSync(fd, b, 0, 1, at - 1);
    if (b[0] !== 10) throw new ActionError("bad-input", { field: "at" });
  }
}

// The tool call `id` at or after byte `at` and its result: { input, tool, result: { part, line } | null }.
// Not found within reach: no-step.
export function findStep(file, at, id) {
  const fd = openTranscript(file);
  try {
    checkAt(fd, at);
    let use = null;
    let result = null;
    readForward(fd, at, MAX_REACH, ({ line }) => {
      if (!use) {
        const p = (
          line.type === "assistant" && Array.isArray(line.message?.content)
            ? line.message.content
            : []
        ).find((c) => c?.type === "tool_use" && String(c.id) === id);
        if (p) use = { tool: String(p.name), input: p.input ?? {} };
        return false;
      }
      const part = (
        line.type === "user" && Array.isArray(line.message?.content)
          ? line.message.content
          : []
      ).find((c) => c?.type === "tool_result" && String(c.tool_use_id) === id);
      if (part) result = { part, line };
      return !!part;
    });
    if (!use) throw new ActionError("no-step");
    return { ...use, result };
  } finally {
    fs.closeSync(fd);
  }
}

const isPrompt = (line) => toTurn(line)?.role === "user";

// The edit calls of the answer that holds byte `at`: back to the user prompt that opened it, forward to the next
// one. { edits: [{ id, tool, input, counts }], cut } in the order they were made.
export function answerEdits(file, at) {
  const fd = openTranscript(file);
  try {
    checkAt(fd, at);
    const lines = [];
    let cut = false;
    for (const l of linesBackward(fd, at)) {
      if (isPrompt(l.line)) break;
      if (at - l.at > MAX_REACH) {
        cut = true;
        break;
      }
      lines.push(l);
    }
    lines.reverse();
    const ahead = readForward(fd, at, MAX_REACH, (l) => {
      if (l.at > at && isPrompt(l.line)) return true;
      lines.push(l);
      return false;
    });
    const results = new Map();
    const edits = [];
    for (const { line } of lines) {
      if (line.isSidechain) continue;
      for (const [id, r] of resultsOf(line)) results.set(id, r);
      if (line.type === "assistant" && Array.isArray(line.message?.content))
        for (const p of line.message.content)
          if (p?.type === "tool_use" && EDIT_TOOLS.has(p.name))
            edits.push({
              id: String(p.id),
              tool: p.name,
              input: p.input ?? {},
            });
    }
    for (const e of edits) e.counts = results.get(e.id)?.counts ?? null;
    return { edits, cut: cut || ahead.cut };
  } finally {
    fs.closeSync(fd);
  }
}

// Where the whole lines of a file of `size` bytes end: `size`, or the start of a last line still being written
// (one that does not parse), so a reader that goes on from there gets that line whole.
function wholeEnd(fd, size) {
  let pos = size;
  let tail = Buffer.alloc(0);
  while (pos > 0) {
    const from = Math.max(0, pos - CHUNK);
    const buf = Buffer.alloc(pos - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    const nl = buf.lastIndexOf(10);
    tail = Buffer.concat([nl < 0 ? buf : buf.subarray(nl + 1), tail]);
    pos = nl < 0 ? from : from + nl + 1;
    if (nl >= 0) break;
  }
  if (!tail.length) return size;
  try {
    JSON.parse(tail.toString("utf8"));
    return size;
  } catch {
    return pos;
  }
}

// The `count` turns that end before byte `end` (the file's end when null), oldest first. Each turn carries its
// byte offset `pos`; an assistant turn its `steps`, and its `links` when it has text (files of the session `place`).
// `before` is the offset of the first turn returned, or null when the start of the file was reached before `count`
// turns were found. `end` is the byte the read stopped at: session.watch goes on from there, so a line written
// after this read is pushed once and none is missed.
export function readTurns(file, end, count, place) {
  if (!place) throw new Error("readTurns needs the session's place");
  const fd = openTranscript(file);
  try {
    const size = fs.fstatSync(fd).size;
    const stop = end === null ? wholeEnd(fd, size) : end;
    if (stop > size) throw new ActionError("bad-input", { field: "before" });
    const turns = [];
    const results = new Map(); // a result line comes before its call when reading backwards
    if (count > 0)
      for (const { at, line } of linesBackward(fd, stop)) {
        for (const [id, r] of resultsOf(line)) results.set(id, r);
        const t = toTurn(line);
        if (t?.role === "assistant") {
          t.steps = stepsOf(line, place, results);
          if (t.text) t.links = linksOf(t.text, place, place.base);
        }
        if (t) turns.push({ ...t, pos: at });
        // newest first here: a line's later note goes in first
        for (const n of notesOf(line).reverse()) turns.push({ ...n, pos: at });
        if (turns.length >= count) break;
      }
    turns.reverse();
    const first = turns[0];
    const more = turns.length >= count && first.pos > 0;
    return { turns, before: more ? first.pos : null, end: stop };
  } finally {
    fs.closeSync(fd);
  }
}

// The shell commands of the last turn, oldest first: every Bash call's command in the lines after the last
// message the user wrote (a turn without `system`; command wrappers, hook notices and helper notes are not one).
export function lastTurnCommands(file) {
  const fd = openTranscript(file);
  try {
    const commands = [];
    for (const { line } of linesBackward(fd, fs.fstatSync(fd).size)) {
      const t = toTurn(line);
      if (t?.role === "user" && !t.system) break;
      if (line.type !== "assistant" || !Array.isArray(line.message?.content))
        continue;
      for (const p of [...line.message.content].reverse())
        if (p?.type === "tool_use" && p.name === "Bash")
          commands.push(String(p.input?.command ?? ""));
    }
    return commands.reverse();
  } finally {
    fs.closeSync(fd);
  }
}
