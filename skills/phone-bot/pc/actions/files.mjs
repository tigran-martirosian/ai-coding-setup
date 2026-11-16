// Files and diffs in a session (actions 35 to 37 of the PC program design; files design,
// docs/2026-11-15-phone-app-files-design.md): a step's detail, the files an answer changed, and a file opened by a
// handle the PC made. The phone never sends a path; every file goes through checkSessionFile in core/files.mjs.
import fs from "node:fs";
import path from "node:path";
import { knownSession } from "../core/db.mjs";
import { SESSION_INPUT } from "../core/door.mjs";
import {
  badPathForm,
  checkPath,
  checkSessionFile,
  FileRefused,
  handlePath,
  linksOf,
  secretRuleOf,
  sessionFile,
  sessionPlace,
} from "../core/files.mjs";
import { ActionError } from "../core/registry.mjs";
import {
  answerEdits,
  countsOf,
  EDIT_TOOLS,
  findStep,
  namedFile,
  transcriptPath,
} from "../core/transcripts.mjs";

const KB = 1024;
const MB = 1024 * KB;
const PIECE = 96 * KB;
const TEXT_CAP = MB;
const PICTURE_CAP = 8 * MB;
const DIFF_LINES = 2000;
const DIFF_BYTES = 120 * KB;
const OUTPUT_CAP = 64 * KB;
const COMMAND = 2000;
const MAX_COUNT = 400;
const SNIFF = 8 * KB;
const PICTURES = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};
const MARKDOWN = new Set([".md", ".markdown"]);
const AT_INPUT = { type: "integer", min: 0, max: Number.MAX_SAFE_INTEGER };
const HANDLE_INPUT = {
  type: "string",
  min: 16,
  max: 16,
  pattern: /^[A-Za-z0-9_-]{16}$/,
};
// Words of a command: split as the design says, so "--env-file=.env", "$(cat .env)" and ".env&&x" give ".env".
const WORD_SPLIT = /[\s"'|;><=()&`,]+/;

// The session's row, place and transcript; a session that has not run has no steps (bad-input on `at`).
function sessionOf(id) {
  const { row } = knownSession(id);
  const file = transcriptPath(row);
  if (!file) throw new ActionError("bad-input", { field: "at" });
  if (!fs.existsSync(checkPath(file))) throw new ActionError("transcript-gone");
  return { row, place: sessionPlace(row), file };
}

// The path as the sheet shows it: from the session's base folder when inside it, else as named.
function shownPath(place, p) {
  if (badPathForm(p)) return String(p);
  const abs = path.resolve(place.base, p);
  const rel = path.relative(place.base, abs);
  return rel && !rel.startsWith("..") && !path.isAbsolute(rel)
    ? rel.split(path.sep).join("/")
    : abs;
}

// The last `cap` bytes of a text, from a whole character: { out, bytes, cut }.
function tail(text, cap = OUTPUT_CAP) {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= cap) return { out: text, bytes: buf.length, cut: false };
  let from = buf.length - cap;
  while (from < buf.length && (buf[from] & 0xc0) === 0x80) from++;
  return {
    out: buf.subarray(from).toString("utf8"),
    bytes: buf.length,
    cut: true,
  };
}

const resultText = (part) =>
  typeof part.content === "string"
    ? part.content
    : Array.isArray(part.content)
      ? part.content
          .filter((c) => c?.type === "text" && typeof c.text === "string")
          .map((c) => c.text)
          .join("\n")
      : "";

// The output rule: the first secret a call names, { rule, name, inCommand }, or null.
function secretNamed(tool, input) {
  const hit = (word, opts) => {
    const rule = secretRuleOf(word, opts);
    return rule
      ? { rule, name: path.basename(word.replace(/[\\/]+$/, "")) }
      : null;
  };
  for (const k of ["file_path", "path", "notebook_path"])
    if (typeof input[k] === "string" && input[k]) {
      const h = hit(input[k]);
      if (h) return h;
    }
  for (const k of tool === "Glob"
    ? ["pattern"]
    : tool === "Grep"
      ? ["glob"]
      : [])
    if (typeof input[k] === "string" && input[k]) {
      const h = hit(input[k], { pattern: true });
      if (h) return { ...h, name: h.name.replace(/[*?]/g, "") };
    }
  if (tool === "Bash" && typeof input.command === "string")
    for (const word of input.command.split(WORD_SPLIT).filter(Boolean)) {
      const h = hit(word);
      if (h) return { ...h, inCommand: true };
    }
  return null;
}

// A diff's hunks within the caps: at most DIFF_LINES lines and DIFF_BYTES of line text in all.
function capHunks(hunks) {
  const out = [];
  let lines = 0;
  let bytes = 0;
  let more = 0;
  for (const h of hunks) {
    const kept = [];
    for (const l of h.lines) {
      const b = Buffer.byteLength(l);
      if (more || lines >= DIFF_LINES || bytes + b > DIFF_BYTES) {
        more++;
        continue;
      }
      kept.push(l);
      lines++;
      bytes += b;
    }
    if (kept.length)
      out.push({ oldStart: h.oldStart, newStart: h.newStart, lines: kept });
  }
  return more ? { hunks: out, cut: true, more } : { hunks: out, cut: false };
}

function diffDetail(place, input, result) {
  const named = namedFile(input);
  if (!named) throw new Error("an edit step names no file");
  const tur = result.line.toolUseResult;
  const counts = countsOf(tur) ?? { add: null, del: null, created: false };
  const name = path.basename(String(named));
  const base = { kind: "diff", name, path: shownPath(place, named) };
  const refused = badPathForm(named)
    ? "path form"
    : secretRuleOf(path.resolve(place.base, named));
  if (refused) return { ...base, refused, add: counts.add, del: counts.del };
  const f = sessionFile(place, named);
  if (
    f.why &&
    f.why !== "outside the session's folders" &&
    f.why !== "folder too wide"
  )
    return { ...base, refused: f.why, add: counts.add, del: counts.del };
  let hunks = Array.isArray(tur?.structuredPatch) ? tur.structuredPatch : [];
  if (!hunks.length && counts.created && typeof tur.content === "string") {
    const lines = tur.content.split("\n");
    if (tur.content.endsWith("\n")) lines.pop();
    hunks = [{ oldStart: 0, newStart: 1, lines: lines.map((l) => `+${l}`) }];
  }
  return {
    ...base,
    file: f.file,
    why: f.why,
    add: counts.add,
    del: counts.del,
    created: counts.created,
    ...capHunks(hunks),
  };
}

function stepDetail(place, step) {
  const { tool, input, result } = step;
  if (!result) return { kind: "running" };
  if (EDIT_TOOLS.has(tool)) return diffDetail(place, input, result);
  const tur = result.line.toolUseResult;
  if (tool === "Read") {
    const named = namedFile(input);
    if (!named) throw new Error("a Read step names no file");
    const f = sessionFile(place, named);
    const read = tur?.file ?? {};
    return {
      kind: "read",
      name: path.basename(String(named)),
      path: shownPath(place, named),
      file: f.file,
      why: f.why,
      startLine: read.startLine ?? null,
      numLines: read.numLines ?? null,
      totalLines: read.totalLines ?? null,
    };
  }
  const bash = tool === "Bash";
  const text =
    bash && tur && typeof tur.stdout === "string"
      ? [tur.stdout, tur.stderr].filter(Boolean).join("\n")
      : resultText(result.part);
  const command = bash
    ? String(input.command ?? "").slice(0, COMMAND)
    : undefined;
  const secret = secretNamed(tool, input);
  if (secret)
    return {
      kind: "output",
      hidden: secret.rule,
      name: secret.name,
      ...(bash && !secret.inCommand ? { command } : {}),
      bytes: Buffer.byteLength(text),
    };
  const shown = tail(text);
  if (!bash) return { kind: "output", ...shown };
  return {
    kind: "output",
    command,
    ...shown,
    interrupted: tur?.interrupted === true,
    background: !!tur?.backgroundTaskId,
  };
}

function changes(place, { edits, cut }) {
  const files = new Map();
  let add = 0;
  let del = 0;
  for (const e of edits) {
    const named = namedFile(e.input);
    if (!named) continue;
    const key = badPathForm(named) ? named : path.resolve(place.base, named);
    let entry = files.get(key.toLowerCase());
    if (!entry) {
      const refused = badPathForm(named) ? "path form" : secretRuleOf(key);
      const f = refused
        ? { file: null, why: refused }
        : sessionFile(place, named);
      entry = {
        name: path.basename(String(named)),
        path: shownPath(place, named),
        file: f.file,
        why: f.why,
        add: 0,
        del: 0,
        created: false,
        steps: [],
        ...(refused ? { refused } : {}),
      };
      files.set(key.toLowerCase(), entry);
    }
    const c = e.counts;
    if (c) {
      entry.add += c.add;
      entry.del += c.del;
      add += c.add;
      del += c.del;
      if (c.created) entry.created = true;
    }
    if (!entry.refused) entry.steps.push(e.id);
  }
  return { files: [...files.values()], add, del, cut };
}

const kindOf = (p) => {
  const ext = path.extname(p).toLowerCase();
  if (MARKDOWN.has(ext)) return "markdown";
  if (PICTURES[ext]) return "picture";
  return "text";
};

function readBytes(real, from, to) {
  const fd = fs.openSync(real, "r");
  try {
    const buf = Buffer.alloc(Math.max(0, to - from));
    fs.readSync(fd, buf, 0, buf.length, from);
    return buf;
  } finally {
    fs.closeSync(fd);
  }
}

// Lines `line` to `line + count - 1` of the first TEXT_CAP bytes, at most PIECE bytes of them.
function linePiece(real, size, line, count) {
  const head = readBytes(real, 0, Math.min(size, TEXT_CAP));
  let start = 0;
  for (let n = 1; n < line; n++) {
    const nl = head.indexOf(10, start);
    if (nl < 0) {
      start = head.length;
      break;
    }
    start = nl + 1;
  }
  let end = start;
  let got = 0;
  while (got < count && end < head.length) {
    const nl = head.indexOf(10, end);
    const next = nl < 0 ? head.length : nl + 1;
    if (next - start > PIECE) {
      if (got === 0) {
        end = start + PIECE;
        got = 1;
      }
      break;
    }
    end = next;
    got++;
  }
  let total = null;
  if (size <= TEXT_CAP) {
    total = 0;
    for (const b of head) if (b === 10) total++;
    if (head.length && head[head.length - 1] !== 10) total++;
  }
  return {
    offset: start,
    bytes: head.subarray(start, end).toString("base64"),
    firstLine: line,
    lineCount: got,
    lines: total,
    next: null,
  };
}

function openFile(d) {
  const { row } = knownSession(d.session);
  const place = sessionPlace(row);
  const t = transcriptPath(row);
  if (t && !fs.existsSync(checkPath(t)))
    throw new ActionError("transcript-gone");
  const byOffset = d.offset !== undefined;
  const byLine = d.line !== undefined || d.count !== undefined;
  if (byOffset === byLine)
    throw new ActionError("bad-input", { field: byOffset ? "line" : "offset" });
  if (byLine && (d.line === undefined || d.count === undefined))
    throw new ActionError("bad-input", {
      field: d.line === undefined ? "line" : "count",
    });
  const named = handlePath(place.session, d.file);
  if (!named) throw new ActionError("stale-handle");
  let real;
  try {
    real = checkSessionFile(named, place.folders);
  } catch (e) {
    if (e instanceof FileRefused)
      throw new ActionError("file-refused", { rule: e.rule });
    throw e;
  }
  if (!fs.existsSync(real)) throw new ActionError("file-gone");
  const st = fs.statSync(real);
  let kind = kindOf(real);
  const head = {
    name: path.basename(named),
    path: shownPath(place, named),
    size: st.size,
    modified: st.mtime.toISOString(),
  };
  if (
    kind !== "picture" &&
    readBytes(real, 0, Math.min(st.size, SNIFF)).includes(0)
  )
    kind = "binary";
  if (byOffset && d.offset > st.size)
    throw new ActionError("bad-input", { field: "offset" });
  if (kind === "binary") return { ...head, kind, offset: 0, next: null };
  if (kind === "picture") {
    if (byLine) throw new ActionError("bad-input", { field: "line" });
    const mime = PICTURES[path.extname(real).toLowerCase()];
    if (st.size > PICTURE_CAP)
      return { ...head, kind, mime, tooBig: true, offset: 0, next: null };
    const to = Math.min(st.size, d.offset + PIECE);
    return {
      ...head,
      kind,
      mime,
      offset: d.offset,
      bytes: readBytes(real, d.offset, to).toString("base64"),
      next: to < st.size ? to : null,
    };
  }
  const links = (first) =>
    kind === "markdown" && first
      ? {
          links: linksOf(
            readBytes(real, 0, Math.min(st.size, TEXT_CAP)).toString("utf8"),
            place,
            path.dirname(named),
          ),
        }
      : {};
  if (byLine) {
    if (d.line < 1) throw new ActionError("bad-input", { field: "line" });
    return {
      ...head,
      kind,
      ...linePiece(real, st.size, d.line, d.count),
      ...links(d.line === 1),
    };
  }
  const cap = Math.min(st.size, TEXT_CAP);
  const to = Math.min(cap, d.offset + PIECE);
  return {
    ...head,
    kind,
    offset: d.offset,
    bytes: readBytes(real, Math.min(d.offset, to), to).toString("base64"),
    next: to < cap ? to : null,
    ...links(d.offset === 0),
  };
}

export function register(registry) {
  registry.add({
    name: "step.detail",
    input: {
      session: SESSION_INPUT,
      step: {
        type: "string",
        min: 1,
        max: 64,
        pattern: /^[A-Za-z0-9_-]{1,64}$/,
      },
      at: AT_INPUT,
    },
    run: (d) => {
      const { place, file } = sessionOf(d.session);
      return stepDetail(place, findStep(file, d.at, d.step));
    },
  });

  registry.add({
    name: "session.changes",
    input: { session: SESSION_INPUT, at: AT_INPUT },
    run: (d) => {
      const { place, file } = sessionOf(d.session);
      return changes(place, answerEdits(file, d.at));
    },
  });

  registry.add({
    name: "file.open",
    input: {
      session: SESSION_INPUT,
      file: HANDLE_INPUT,
      offset: { ...AT_INPUT, optional: true },
      line: {
        type: "integer",
        min: 0,
        max: Number.MAX_SAFE_INTEGER,
        optional: true,
      },
      count: { type: "integer", min: 1, max: MAX_COUNT, optional: true },
    },
    run: openFile,
  });
}
