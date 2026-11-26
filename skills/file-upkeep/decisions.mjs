#!/usr/bin/env node
// Splits a project's DECISIONS.md into docs/decisions/, word for word, and proves nothing was lost: each entry
// line ends up once in one file, unchanged. A <folder> must be an existing folder; any other leftover word is refused.
//   node decisions.mjs --split [--dry-run] [<folder>]     every ## section but the purpose record and the index moves
//                                                         to docs/decisions/<name>.md; the root keeps header, purpose
//                                                         record and the index of topic files
//   node decisions.mjs --apply <ledger>… [--dry-run] [<folder>]  moves the entries a ledger binds into topic files
//   node decisions.mjs --undo <ledger> [<folder>]          puts every file back as before that apply
//   node decisions.mjs --verify [<rev>] [<folder>]         the record set now against git <rev> (default HEAD)
//   node decisions.mjs --check [<folder>]                  findings D1-D7
//   node decisions.mjs --list [<file>…] [<folder>]         the entry blocks a ledger names: file:line, sha, start
// Files are read as raw bytes (latin1 strings, one char per byte), so every byte is compared as it is. A writing
// command takes a lock, checks the whole after-state in memory first, writes the files that gain lines before the
// ones that lose them (DECISIONS.md last), reads them back, and restores every file it wrote on any failure.
// Exit: 0 done, 1 failed and nothing changed, 2 busy, 3 bad input.
// DECISIONS_TEST_FAULT (tests only) spoils the after-state or disturbs the run, to prove the abort rule.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DECISIONS_DIR,
  failureFile,
  INDEX_HEAD,
  INDEX_TEXT,
  indexLine,
  movableSections,
  VALID_NAME,
} from "../../hooks/lib/decisions.mjs";
import { fileKey } from "../../hooks/lib/paths.mjs";
import { STATE_DIR, writeJson } from "../../hooks/lib/state.mjs";

const ROOT_FILE = "DECISIONS.md";
const ARCHIVE = "docs/decisions-archive.md";
const RECORD_HEAD = "## What each thing is for";
const ROOT_MAX_LINES = 200;
const ROOT_MAX_BYTES = 25000;
const TOPIC_MAX_BYTES = 16000;
const LOCK_MAX_MS = 10 * 60 * 1000;
const PATH_MAX = 240;
const DATE = /\d{4}-\d{2}-\d{2}/g;
const DATED = /^\d{4}-\d{2}-\d{2}-/;
const FAULT = process.env.DECISIONS_TEST_FAULT || "";
const faults = new Set(FAULT.split(",").filter(Boolean));

// A failure that leaves every file as it was: printed by main, exit 1 (or the code given).
class Fail extends Error {
  constructor(
    reason,
    { details = [], code = 1, lasting = null, raw = false } = {},
  ) {
    super(reason);
    Object.assign(this, { details, code, lasting, raw });
  }
}

const sha1 = (bytes) =>
  crypto.createHash("sha1").update(Buffer.from(bytes, "latin1")).digest("hex");
const shaOf = (s) => (s === null ? null : sha1(s));
const num = (n) => n.toLocaleString("en-US");
const utf8 = (s) => Buffer.from(s, "latin1").toString("utf8");
const latin1 = (s) => Buffer.from(s, "utf8").toString("latin1");
const isBlank = (t) => !/[^ \t]/.test(t);
const hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
const isTopic = (rel) =>
  rel.startsWith(`${DECISIONS_DIR}/`) &&
  !rel.slice(DECISIONS_DIR.length + 1).includes("/") &&
  VALID_NAME.test(path.posix.basename(rel)) &&
  !DATED.test(path.posix.basename(rel));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};

// ---- lines ----
// A line is the bytes between two "\n"; one "\r" before the "\n" is the line end. A last line with no "\n" is a line.
export function parseLines(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const j = s.indexOf("\n", i);
    if (j < 0) {
      out.push({ text: s.slice(i), end: "" });
      break;
    }
    const crlf = j > i && s[j - 1] === "\r";
    out.push({ text: s.slice(i, crlf ? j - 1 : j), end: crlf ? "\r\n" : "\n" });
    i = j + 1;
  }
  return out;
}
const joinLines = (lines) => lines.map((l) => l.text + l.end).join("");
const lineEnds = (lines) => new Set(lines.map((l) => l.end).filter(Boolean));
// The line end a file's new lines take: its own, else the fallback (DECISIONS.md's, else "\n").
const eolOf = (lines, fallback = "\n") => {
  const ends = lineEnds(lines);
  return ends.has("\r\n") ? "\r\n" : ends.has("\n") ? "\n" : fallback;
};
const withEnd = (texts, eol) => texts.map((text) => ({ text, end: eol }));

// `## ` headings outside code fences, 0-based indexes; fenceLine is the open fence's 1-based line or 0.
export function headingsOf(lines) {
  const found = [];
  let fence = null;
  lines.forEach((l, i) => {
    const t = l.text;
    const mark = t.startsWith("```")
      ? "```"
      : t.startsWith("~~~")
        ? "~~~"
        : null;
    if (fence) {
      if (mark === fence.mark) fence = null;
      return;
    }
    if (mark) fence = { mark, line: i + 1 };
    else if (t.startsWith("## ")) found.push(i);
  });
  return { found, fenceLine: fence ? fence.line : 0 };
}
const isHead = (t, head) => t.trimEnd() === head;
// The last non-blank index in [from, to), or from - 1.
const lastFilled = (lines, from, to) => {
  let k = to - 1;
  while (k >= from && isBlank(lines[k].text)) k--;
  return k;
};

// Sections of a file: { head, from, to, last } (to = next heading; last = last non-blank line), plus the header end.
function sectionsOf(lines) {
  const { found, fenceLine } = headingsOf(lines);
  const sections = found.map((from, k) => {
    const to = found[k + 1] ?? lines.length;
    return {
      head: lines[from].text,
      from,
      to,
      last: lastFilled(lines, from, to),
    };
  });
  return { sections, headerEnd: found[0] ?? lines.length, fenceLine };
}

// Entry blocks outside fences: [{ from, to }] 0-based, to exclusive, trailing blanks left out.
export function entryBlocks(lines) {
  const out = [];
  let fence = null;
  let i = 0;
  const fenceMark = (t) =>
    t.startsWith("```") ? "```" : t.startsWith("~~~") ? "~~~" : null;
  while (i < lines.length) {
    const t = lines[i].text;
    const mark = fenceMark(t);
    if (fence) {
      if (mark === fence) fence = null;
      i++;
      continue;
    }
    if (mark) {
      fence = mark;
      i++;
      continue;
    }
    if (!t.startsWith("- ")) {
      i++;
      continue;
    }
    let end = i + 1; // exclusive end of the block so far
    let j = i + 1;
    while (j < lines.length) {
      const u = lines[j].text;
      if (isBlank(u)) {
        let k = j;
        while (k < lines.length && isBlank(lines[k].text)) k++;
        if (k < lines.length && /^[ \t]/.test(lines[k].text)) {
          j = k;
          continue;
        }
        break;
      }
      if (/^[ \t]/.test(u)) {
        end = j + 1;
        j++;
        continue;
      }
      // a column-0 line straight after a block line that starts neither "- " nor "#": a wrapped line
      if (
        !isBlank(lines[j - 1].text) &&
        !u.startsWith("- ") &&
        !u.startsWith("#") &&
        !fenceMark(u)
      ) {
        end = j + 1;
        j++;
        continue;
      }
      break;
    }
    out.push({ from: i, to: end });
    i = end;
  }
  return out;
}
const blockSha = (lines, b) =>
  sha1(
    lines
      .slice(b.from, b.to)
      .filter((l) => !isBlank(l.text))
      .map((l) => l.text)
      .join("\n"),
  ).slice(0, 12);
const lastDate = (texts) => {
  const all = texts.join("\n").match(DATE);
  return all ? all.at(-1) : null;
};

// ---- file names ----
export function targetName(head) {
  const text = utf8(head.slice(3)).trim();
  const m = /^(\d{4}-\d{2}-\d{2})(?:\s*[:\-–—])?\s*(.*)$/s.exec(text);
  const slug = (s) => {
    let n = s
      .split(" (")[0]
      .normalize("NFKD")
      .replace(/\p{M}/gu, "")
      .toLowerCase();
    n = n.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (n.length > 50) {
      n = n.slice(0, 50);
      const k = n.lastIndexOf("-");
      if (k >= 20) n = n.slice(0, k);
      n = n.replace(/-+$/, "");
    }
    return n;
  };
  const hashed = () => `h-${sha1(head.slice(3)).slice(0, 8)}`;
  if (m) {
    const rest = m[2].trim();
    return `${DECISIONS_DIR}/${m[1]}-${rest ? slug(rest) || hashed() : "entries"}.md`;
  }
  return `${DECISIONS_DIR}/${slug(text) || hashed()}.md`;
}
// Only spaces and tabs come off: trimEnd() would also take byte 0xA0, the last byte of a UTF-8 "à".
const titleOf = (head) => `# ${head.slice(3).replace(/[ \t]+$/, "")}`;

// ---- the record set ----
// Map rel -> latin1 string, or null for a file that does not exist.
export function readSet(root) {
  const set = new Map();
  const read = (rel) => {
    try {
      return fs.readFileSync(path.join(root, rel), "latin1");
    } catch (e) {
      if (e.code === "ENOENT") return null;
      throw e;
    }
  };
  set.set(ROOT_FILE, read(ROOT_FILE));
  let names = [];
  try {
    names = fs
      .readdirSync(path.join(root, DECISIONS_DIR), { withFileTypes: true })
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => e.name)
      .sort();
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
  }
  for (const n of names)
    set.set(`${DECISIONS_DIR}/${n}`, read(`${DECISIONS_DIR}/${n}`));
  set.set(ARCHIVE, read(ARCHIVE));
  return set;
}
const linesOf = (set, rel) =>
  set.get(rel) == null ? [] : parseLines(set.get(rel));
// Topic files present on a side, sorted by name: [{ rel, title }] (title = line 1 without "# ").
function topicsOf(set) {
  const out = [];
  for (const [rel, s] of set) {
    if (s === null || !isTopic(rel)) continue;
    const first = parseLines(s)[0]?.text ?? "";
    if (first.startsWith("# ")) out.push({ rel, title: first.slice(2) });
  }
  return out.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
}
// The index section of the root lines: { from, to } 0-based, or null.
function indexSection(lines) {
  const { sections } = sectionsOf(lines);
  const s = sections.find((x) => isHead(x.head, INDEX_HEAD));
  return s ? { from: s.from, to: s.to } : null;
}
// Counted lines of a side: [{ file, line, text, head }] (line 1-based; head: a `## ` heading outside fences).
export function countedLines(set) {
  const generated = new Set([INDEX_HEAD, INDEX_TEXT]);
  for (const t of topicsOf(set)) generated.add(indexLine(t.rel, t.title));
  const out = [];
  for (const [file, s] of set) {
    if (s === null) continue;
    const lines = parseLines(s);
    const heads = new Set(headingsOf(lines).found);
    const idx = file === ROOT_FILE ? indexSection(lines) : null;
    lines.forEach((l, i) => {
      if (isBlank(l.text)) return;
      if (idx && i >= idx.from && i < idx.to && generated.has(l.text)) return;
      if (
        file !== ROOT_FILE &&
        file !== ARCHIVE &&
        i === 0 &&
        l.text.startsWith("# ")
      )
        return;
      out.push({ file, line: i + 1, text: l.text, head: heads.has(i) });
    });
  }
  return out;
}

// Before against after: lost, doubled, added (each { file, line, text }), heading counts.
export function compare(before, after) {
  const tally = (list) => {
    const m = new Map();
    for (const c of list) {
      const e = m.get(c.text) ?? { n: 0, at: [] };
      e.n++;
      e.at.push(c);
      m.set(c.text, e);
    }
    return m;
  };
  const cb = countedLines(before);
  const ca = countedLines(after);
  const b = tally(cb);
  const a = tally(ca);
  const lost = [];
  const doubled = [];
  const added = [];
  for (const [text, e] of b) {
    const n = a.get(text)?.n ?? 0;
    if (n < e.n) lost.push(...e.at.slice(n));
    if (n > e.n) doubled.push(...a.get(text).at.slice(e.n));
  }
  for (const [text, e] of a) if (!b.has(text)) added.push(...e.at);
  const hb = tally(cb.filter((c) => c.head));
  const ha = tally(ca.filter((c) => c.head));
  const headsMissing = [];
  for (const [text, e] of hb)
    if ((ha.get(text)?.n ?? 0) < e.n) headsMissing.push(e.at[0]);
  return {
    lost,
    doubled,
    added,
    before: cb.length,
    after: ca.length,
    heads: cb.filter((c) => c.head).length,
    headsMissing,
  };
}
const findRun = (hay, needle, from) => {
  for (let i = from; i + needle.length <= hay.length; i++) {
    let k = 0;
    while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
  }
  return -1;
};
// Each planned block (texts of its lines) once, whole, in its target, in the planned order; and no block's run of
// lines more often after than before (a block can also be the start of a longer one, so both sides are counted).
export function blocksWhole(before, after, plan) {
  const bad = [];
  const textsOn = (set) => {
    const texts = new Map();
    return (rel) => {
      if (!texts.has(rel))
        texts.set(
          rel,
          linesOf(set, rel).map((l) => l.text),
        );
      return texts.get(rel);
    };
  };
  const textsOf = textsOn(after);
  const textsBefore = textsOn(before);
  const count = (set, of, needle) => {
    let found = 0;
    for (const rel of set.keys()) {
      const hay = of(rel);
      for (
        let i = findRun(hay, needle, 0);
        i >= 0;
        i = findRun(hay, needle, i + 1)
      )
        found++;
    }
    return found;
  };
  const cursor = new Map();
  const keys = new Set();
  for (const p of plan) {
    const at = findRun(textsOf(p.target), p.texts, cursor.get(p.target) ?? 0);
    if (at < 0) bad.push(`${p.target}: ${utf8(p.texts[0]).slice(0, 80)}`);
    else cursor.set(p.target, at + p.texts.length);
    keys.add(p.texts.join("\n"));
  }
  for (const key of keys) {
    const needle = key.split("\n");
    if (count(after, textsOf, needle) > count(before, textsBefore, needle))
      bad.push(`twice: ${utf8(needle[0]).slice(0, 80)}`);
  }
  return bad;
}
// The internal check of a writing command: throws the fail line when anything is off.
function mustPass(before, after, plan) {
  const r = compare(before, after);
  const bad = blocksWhole(before, after, plan);
  if (r.lost.length || r.doubled.length || r.added.length)
    throw new Fail(
      `check found ${r.lost.length} lost, ${r.doubled.length} doubled, ${r.added.length} added`,
      { details: detailLines(r) },
    );
  if (r.headsMissing.length || bad.length)
    throw new Fail(`${bad.length + r.headsMissing.length} blocks not whole`, {
      details: [
        ...bad,
        ...r.headsMissing.map((h) => `heading: ${h.file}:${h.line}`),
      ]
        .slice(0, 10)
        .map((x) => `  ${x}`),
    });
  return r;
}
function detailLines(r) {
  const show = (kind, c) =>
    `  ${kind}: ${c.file}:${c.line}: ${utf8(c.text.slice(0, 100))}`;
  return [
    ...r.lost.map((c) => show("lost", c)),
    ...r.doubled.map((c) => show("doubled", c)),
    ...r.added.map((c) => show("added", c)),
  ].slice(0, 10);
}
const checkLine = (r) =>
  `check: ${num(r.lost.length)} lost, ${num(r.doubled.length)} doubled, ${num(r.added.length)} added`;

// ---- the root index ----
// Root lines with the index block written anew at the old block's place (else after the purpose record, else at
// the end). Stray lines (counted, not generated by the before side) stay, after the index lines.
function withIndex(lines, topics, beforeSet, eol) {
  const generated = new Set([INDEX_HEAD, INDEX_TEXT]);
  for (const t of topicsOf(beforeSet)) generated.add(indexLine(t.rel, t.title));
  const idx = indexSection(lines);
  const strays = idx
    ? lines
        .slice(idx.from, idx.to)
        .filter((l) => !isBlank(l.text) && !generated.has(l.text))
    : [];
  let at = lines.length;
  if (idx) at = idx.from;
  else {
    const rec = sectionsOf(lines).sections.find((s) =>
      isHead(s.head, RECORD_HEAD),
    );
    if (rec) at = rec.to;
  }
  const rest = lines.slice(idx ? idx.to : at);
  const head = lines.slice(0, at).map((l) => ({ ...l }));
  if (head.length && head.at(-1).end === "") head.at(-1).end = eol;
  if (head.length && !isBlank(head.at(-1).text))
    head.push({ text: "", end: eol });
  const listed = topics.map((t) => indexLine(t.rel, t.title));
  const block = withEnd(
    [
      INDEX_HEAD,
      "",
      INDEX_TEXT,
      ...(listed.length || strays.length ? ["", ...listed] : []),
    ],
    eol,
  );
  const strayAt = [];
  for (const s of strays) {
    block.push({ text: s.text, end: eol });
    strayAt.push(head.length + block.length);
  }
  if (rest.length) block.push({ text: "", end: eol });
  return { lines: [...head, ...block, ...rest], strayAt };
}
const strayNote = (strayAt) =>
  strayAt.length
    ? [
        `  ${strayAt.length} stray lines in the index (line ${strayAt.join(", ")})`,
      ]
    : [];
// A file's lines must share one line end before the run writes into it; else a lasting failure.
function oneEnd(rel, s) {
  const lines = parseLines(s ?? "");
  if (lineEnds(lines).size > 1)
    throw new Fail(`mixed line ends in ${rel}`, { lasting: rel });
  const open = headingsOf(lines).fenceLine;
  if (open)
    throw new Fail(`unclosed code fence at ${rel}:${open}`, { lasting: rel });
  return lines;
}
// An existing target's lines, checked: one line end, closed fences, a "# " line 1.
function targetLines(rel, s) {
  const lines = oneEnd(rel, s);
  if (!lines[0]?.text.startsWith("# "))
    throw new Fail(`${rel} has no title line; add "# <title>" as line 1`, {
      lasting: rel,
    });
  return lines;
}
const tooLong = (root, rel) => {
  if (path.join(root, rel).length > PATH_MAX)
    throw new Fail(`path too long: ${rel}`);
};
// A file with blocks put right under its title line, then its earlier text (leading blanks dropped).
// gap: a blank line after each block (split) or one after all of them (apply).
function underTitle(title, oldLines, blocks, eol, gap) {
  const out = [
    { text: title, end: eol },
    { text: "", end: eol },
  ];
  const ranges = [];
  for (const b of blocks) {
    const from = out.length;
    out.push(...b.map((l) => ({ text: l.text, end: eol })));
    ranges.push([from, out.length]);
    if (gap === "each") out.push({ text: "", end: eol });
  }
  let k = 1;
  while (k < oldLines.length && isBlank(oldLines[k].text)) k++;
  const rest = oldLines.slice(k);
  if (gap !== "each" && rest.length && blocks.length)
    out.push({ text: "", end: eol });
  return { lines: [...out, ...rest], ranges };
}

// ---- --split ----
const spoiled = new Set();
const spoilOnce = (name) =>
  faults.has(name) && !spoiled.has(name) && spoiled.add(name);
export function planSplit(root, set) {
  const rootStr = set.get(ROOT_FILE);
  const L = oneEnd(ROOT_FILE, rootStr);
  const { sections, headerEnd } = sectionsOf(L);
  const keep = (s) => isHead(s.head, RECORD_HEAD) || isHead(s.head, INDEX_HEAD);
  const moved = sections.filter((s) => !keep(s));
  const shared = movableSections(rootStr).sections.map((s) => s.line);
  if (shared.join() !== moved.map((s) => s.from + 1).join())
    throw new Error(
      "movableSections and the script disagree on the sections to move",
    );
  if (!moved.length) return { nothing: true, L, sections };
  const eol = eolOf(L);
  const targets = new Map();
  const plan = [];
  for (const s of moved) {
    const rel = targetName(s.head);
    if (!targets.has(rel)) targets.set(rel, []);
    const blk = L.slice(s.from, s.last + 1);
    targets.get(rel).push({ head: s.head, lines: blk });
    plan.push({ target: rel, texts: blk.map((l) => l.text) });
  }
  if (targets.size > 1 && spoilOnce("wrong-file")) {
    const [a, b] = [...targets.values()];
    b.push(a.shift());
  }
  const after = new Map(set);
  const stats = [];
  for (const [rel, blocks] of targets) {
    tooLong(root, rel);
    if (!blocks.length) continue;
    const old = set.get(rel) ?? null;
    const T = old === null ? [] : targetLines(rel, old);
    const tEol = old === null ? eol : eolOf(T, eol);
    const title = old === null ? titleOf(blocks[0].head) : T[0].text;
    let order = blocks.map((b) => b.lines);
    if (order.length > 1 && spoilOnce("swap-sections"))
      order = [order[1], order[0], ...order.slice(2)];
    const { lines, ranges } = underTitle(title, T, order, tEol, "each");
    spoilLines(lines, ranges);
    after.set(rel, joinLines(lines));
    stats.push({
      rel,
      n: blocks.length,
      bytes: after.get(rel).length,
      isNew: old === null,
    });
  }
  const rec = sections.find((s) => isHead(s.head, RECORD_HEAD));
  const idx = sections.find((s) => isHead(s.head, INDEX_HEAD));
  const base = [
    ...L.slice(0, headerEnd),
    ...(rec ? L.slice(rec.from, rec.to) : []),
    ...(idx ? L.slice(idx.from, idx.to) : []),
  ];
  const { lines: rootLines, strayAt } = withIndex(
    base,
    topicsOf(after),
    set,
    eol,
  );
  after.set(ROOT_FILE, joinLines(rootLines));
  return { after, plan, stats, moved, strayAt, heads: sections.length };
}
// Test faults that spoil a built file before the check (the fault tests leave every file as it was).
function spoilLines(lines, ranges) {
  if (!ranges.length) return;
  const [from] = ranges[0];
  if (spoilOnce("drop-line")) lines.splice(from + 1, 1);
  else if (spoilOnce("dup-line")) lines.splice(from, 0, { ...lines[from] });
  else if (spoilOnce("change-byte"))
    lines[from] = { ...lines[from], text: `${lines[from].text.slice(0, -1)}#` };
  else if (faults.has("drop-inner-blank") && !spoiled.has("drop-inner-blank")) {
    for (const [a, b] of ranges)
      for (let i = a + 1; i < b - 1; i++)
        if (isBlank(lines[i].text)) {
          lines.splice(i, 1);
          spoiled.add("drop-inner-blank");
          return;
        }
  }
}

// ---- --apply and --undo ----
// Entry blocks a ledger may name in a file: in DECISIONS.md, none in the purpose record or the index.
function blocksIn(rel, lines) {
  const all = entryBlocks(lines);
  if (rel !== ROOT_FILE) return all;
  const out = sectionsOf(lines).sections.filter(
    (s) => isHead(s.head, RECORD_HEAD) || isHead(s.head, INDEX_HEAD),
  );
  return all.filter((b) => !out.some((s) => b.from >= s.from && b.from < s.to));
}
const startOf = (lines, b) => utf8(lines[b.from].text.slice(0, 60));
export function readLedgers(files) {
  return files.map((f) => {
    try {
      return JSON.parse(fs.readFileSync(f, "utf8"));
    } catch (e) {
      throw new Fail(`decisions: cannot read ledger ${f}: ${e.message}`, {
        code: 3,
        raw: true,
      });
    }
  });
}
export function planApply(root, set, ledgers) {
  const create = new Map();
  const entries = [];
  for (const l of ledgers) {
    for (const [rel, title] of Object.entries(l.create ?? {})) {
      if (!isTopic(rel))
        throw new Fail(`ledger target ${rel} is not a topic file`);
      create.set(rel, title);
    }
    entries.push(...(l.entries ?? []));
  }
  const files = new Map();
  const fileOf = (rel) => {
    if (!files.has(rel)) {
      if (set.get(rel) == null) return null;
      const lines = oneEnd(rel, set.get(rel));
      files.set(rel, { lines, blocks: blocksIn(rel, lines) });
    }
    return files.get(rel);
  };
  const moves = [];
  const taken = new Set();
  const n = { history: 0, unsure: 0, noDate: 0 };
  entries.forEach((e, k) => {
    const f = fileOf(e.file);
    const hits = f
      ? f.blocks.filter((b) => blockSha(f.lines, b) === e.sha)
      : [];
    if (!hits.length)
      throw new Fail(`ledger entry ${e.sha} not found in ${e.file}`);
    if (hits.length > 1 || taken.has(`${e.file}:${e.sha}`))
      throw new Fail(`ledger entry ${e.sha} found twice in ${e.file}`);
    taken.add(`${e.file}:${e.sha}`);
    const b = hits[0];
    if (startOf(f.lines, b) !== e.start)
      throw new Fail(`ledger start text differs for ${e.sha}`);
    if (e.verdict === "history" || e.verdict === "unsure") n[e.verdict]++;
    else if (e.verdict !== "binds")
      throw new Fail(
        `ledger verdict "${e.verdict}" for ${e.sha} is not binds, history or unsure`,
      );
    else if (
      !isTopic(e.to ?? "") ||
      (set.get(e.to) == null && !create.has(e.to))
    )
      throw new Fail(`ledger target ${e.to} is not a topic file`);
    else {
      const texts = f.lines.slice(b.from, b.to).map((l) => l.text);
      const date = lastDate(texts);
      if (!date) n.noDate++;
      else moves.push({ file: e.file, b, to: e.to, date, k, texts });
    }
  });
  const rootLines = oneEnd(ROOT_FILE, set.get(ROOT_FILE));
  const eol = eolOf(rootLines);
  const after = new Map(set);
  // take the moved blocks out of their files (one blank line after a block goes too when one stands before it)
  const cut = new Map();
  for (const m of moves) {
    if (!cut.has(m.file)) cut.set(m.file, new Set());
    const drop = cut.get(m.file);
    const lines = files.get(m.file).lines;
    for (let i = m.b.from; i < m.b.to; i++) drop.add(i);
    if (
      m.b.to < lines.length &&
      isBlank(lines[m.b.to].text) &&
      (m.b.from === 0 || isBlank(lines[m.b.from - 1].text))
    )
      drop.add(m.b.to);
  }
  const now = new Map();
  for (const [rel, f] of files)
    now.set(
      rel,
      f.lines.filter((_, i) => !cut.get(rel)?.has(i)),
    );
  const byTarget = new Map();
  for (const m of moves) {
    if (!byTarget.has(m.to)) byTarget.set(m.to, []);
    byTarget.get(m.to).push(m);
  }
  const plan = [];
  let made = 0;
  for (const [rel, list] of byTarget) {
    tooLong(root, rel);
    list.sort((a, b) =>
      a.date < b.date ? 1 : a.date > b.date ? -1 : a.k - b.k,
    );
    const old = set.get(rel) ?? null;
    if (old === null) made++;
    const T = now.get(rel) ?? (old === null ? [] : targetLines(rel, old));
    if (old !== null && !T[0]?.text.startsWith("# "))
      throw new Fail(`${rel} has no title line; add "# <title>" as line 1`, {
        lasting: rel,
      });
    const tEol = old === null ? eol : eolOf(T, eol);
    const title = old === null ? `# ${latin1(create.get(rel))}` : T[0].text;
    const blocks = list.map((m) =>
      files.get(m.file).lines.slice(m.b.from, m.b.to),
    );
    const { lines } = underTitle(title, T, blocks, tEol, "after");
    now.set(rel, lines);
    for (const m of list) plan.push({ target: rel, texts: m.texts });
  }
  for (const [rel, lines] of now)
    if (rel !== ROOT_FILE) after.set(rel, joinLines(lines));
  const base = now.get(ROOT_FILE) ?? rootLines;
  const { lines: rl, strayAt } = withIndex(base, topicsOf(after), set, eol);
  after.set(ROOT_FILE, joinLines(rl));
  const named = new Set(entries.map((e) => e.file));
  return {
    after,
    plan,
    moves,
    n,
    made,
    targets: byTarget.size,
    strayAt,
    named,
    entries,
    fileOf,
  };
}
// Coverage of the named files by the ledgers (--apply --dry-run).
function coverage(p) {
  const seen = new Map();
  for (const e of p.entries)
    seen.set(`${e.file}:${e.sha}`, (seen.get(`${e.file}:${e.sha}`) ?? 0) + 1);
  let total = 0;
  let missing = 0;
  let twice = 0;
  for (const rel of p.named) {
    const f = p.fileOf(rel);
    for (const b of f.blocks) {
      total++;
      const c = seen.get(`${rel}:${blockSha(f.lines, b)}`) ?? 0;
      if (!c) missing++;
      if (c > 1) twice++;
    }
  }
  return `  coverage: ${num(total)} entries in the named files, ${num(p.entries.length)} in the ledgers, ${num(missing)} missing, ${num(twice)} twice`;
}

// ---- git and --verify ----
const git = (root, args, encoding = "utf8") =>
  spawnSync("git", ["-C", root, ...args], { encoding, maxBuffer: 1 << 28 });
function mustTrack(root, what) {
  const r = git(root, ["ls-files", "--error-unmatch", ROOT_FILE]);
  if (r.status !== 0)
    throw new Fail(`decisions: DECISIONS.md is not tracked by git; ${what}`, {
      code: 3,
      raw: true,
    });
}
// Files under docs/decisions/ that git ignores (a tracked file never is) would take entries out of git: refused
// before any write.
function mustNotIgnore(root, rels) {
  const r = spawnSync("git", ["-C", root, "check-ignore", "--stdin"], {
    input: rels.join("\n"),
    encoding: "utf8",
  });
  if (r.status === 1) return;
  if (r.status !== 0)
    throw new Fail(`decisions: git check-ignore failed: ${r.stderr.trim()}`, {
      code: 3,
      raw: true,
    });
  throw new Fail(
    `decisions: git ignores ${r.stdout.split("\n")[0].trim()}, so its entries would leave git; change .gitignore, then run this command again; nothing changed`,
    { code: 3, raw: true },
  );
}
// The record set at a git revision. "<rev>:./<rel>" reads the path from the project folder (git's -C), so a project
// in a subfolder of a repository reads its own files.
function setAt(root, rev) {
  const show = (rel) => {
    const r = git(root, ["show", `${rev}:./${rel}`], "latin1");
    return r.status === 0 ? r.stdout : null;
  };
  const set = new Map([[ROOT_FILE, show(ROOT_FILE)]]);
  const tree = git(root, ["ls-tree", "--name-only", rev, `${DECISIONS_DIR}/`]);
  if (tree.status !== 0)
    throw new Fail(
      `decisions: git ls-tree ${rev} failed: ${tree.stderr.trim()}`,
      { code: 3, raw: true },
    );
  for (const rel of tree.stdout
    .split("\n")
    .filter((x) => x.endsWith(".md"))
    .sort())
    set.set(rel, show(rel));
  set.set(ARCHIVE, show(ARCHIVE));
  return set;
}
// The record set now against <rev>: counts, headings, and each entry block of <rev> whole in one file now.
export function verifyAt(root, rev) {
  const before = setAt(root, rev);
  if (before.get(ROOT_FILE) === null)
    throw new Fail(`decisions: no DECISIONS.md at ${rev}`, {
      code: 3,
      raw: true,
    });
  const now = readSet(root);
  const r = compare(before, now);
  const hay = [...now.keys()].map((rel) =>
    linesOf(now, rel).map((l) => l.text),
  );
  const changed = [];
  for (const [rel, s] of before) {
    if (s === null) continue;
    const lines = parseLines(s);
    for (const b of entryBlocks(lines)) {
      const texts = lines.slice(b.from, b.to).map((l) => l.text);
      if (!hay.some((h) => findRun(h, texts, 0) >= 0))
        changed.push(`${rel}:${b.from + 1}`);
    }
  }
  const short = git(root, ["rev-parse", "--short", rev]).stdout.trim() || rev;
  return { ...r, changed, short };
}
function verify(root, rev) {
  mustTrack(root, "nothing to compare with");
  const v = verifyAt(root, rev);
  const kept = `${num(v.heads - v.headsMissing.length)} headings kept${v.headsMissing.length ? `, ${v.headsMissing.length} missing` : ""}`;
  const counts = `${num(v.lost.length)} lost, ${num(v.doubled.length)} doubled, ${num(v.added.length)} added`;
  const ok =
    !v.lost.length &&
    !v.doubled.length &&
    !v.headsMissing.length &&
    !v.changed.length;
  if (ok) {
    say(
      `verify: ${num(v.before)} counted lines at ${v.short}, ${num(v.after)} now; ${counts}; ${kept}`,
    );
    return 0;
  }
  say(
    `verify FAILED: ${counts}; ${kept}`,
    ...[...detailLines(v), ...v.changed.map((c) => `  changed: ${c}`)].slice(
      0,
      10,
    ),
  );
  return 1;
}

// ---- --check and --list ----
function check(root) {
  const set = readSet(root);
  const L = parseLines(set.get(ROOT_FILE));
  const out = [];
  const add = (d, file, what) => out.push(`  D${d} ${file}: ${what}`);
  const bytes = set.get(ROOT_FILE).length;
  const hasDir = fs.existsSync(path.join(root, DECISIONS_DIR));
  const movable = movableSections(set.get(ROOT_FILE)).sections;
  if (L.length > ROOT_MAX_LINES || bytes > ROOT_MAX_BYTES)
    add(
      1,
      ROOT_FILE,
      `${num(L.length)} lines, ${num(bytes)} bytes: ${movable.length ? "run --split" : "no movable section: sort its entries with a ledger"}`,
    );
  if (hasDir && movable.length)
    add(
      2,
      ROOT_FILE,
      `${movable.length} sections besides the purpose record and the index: the next split moves them`,
    );
  const topics = topicsOf(set);
  for (const t of topics)
    if (set.get(t.rel).length > TOPIC_MAX_BYTES)
      add(
        3,
        t.rel,
        `${num(set.get(t.rel).length)} bytes: split it by sub-topic with a ledger`,
      );
  const idx = indexSection(L);
  const listed = new Set();
  const generated = new Set([
    INDEX_HEAD,
    INDEX_TEXT,
    ...topics.map((t) => indexLine(t.rel, t.title)),
  ]);
  const strays = [];
  if (idx)
    for (let i = idx.from; i < idx.to; i++) {
      const t = L[i].text;
      const m = /^- `([^`]+)`: (.*)$/.exec(t);
      if (m) {
        listed.add(m[1]);
        const s = set.get(m[1]);
        if (s == null)
          add(4, ROOT_FILE, `line ${i + 1} names ${m[1]}, which is missing`);
        else if (parseLines(s)[0]?.text !== `# ${m[2]}`)
          add(4, ROOT_FILE, `line ${i + 1}: title differs from ${m[1]} line 1`);
      }
      if (!isBlank(t) && !generated.has(t)) strays.push(i + 1);
    }
  for (const t of topics)
    if (!listed.has(t.rel)) add(5, t.rel, "not in the index");
  if (strays.length)
    add(
      6,
      ROOT_FILE,
      `${strays.length} stray lines in the index (line ${strays.join(", ")})`,
    );
  for (const [rel, s] of set) {
    if (s === null || !rel.startsWith(`${DECISIONS_DIR}/`)) continue;
    if (!parseLines(s)[0]?.text.startsWith("# "))
      add(7, rel, 'line 1 is not "# <title>"');
    if (!VALID_NAME.test(path.posix.basename(rel)))
      add(7, rel, "name is not valid");
  }
  say(...out, `check: ${out.length} findings`);
  return 0;
}
function list(root, files) {
  const set = readSet(root);
  const names = files.length
    ? files
    : [...set.keys()].filter(
        (r) =>
          set.get(r) !== null &&
          DATED.test(path.posix.basename(r)) &&
          r.startsWith(`${DECISIONS_DIR}/`),
      );
  const out = [];
  for (const rel of names) {
    if (set.get(rel) == null && !fs.existsSync(path.join(root, rel)))
      throw new Fail(`decisions: no file ${rel}`, { code: 3, raw: true });
    const lines = parseLines(
      set.get(rel) ?? fs.readFileSync(path.join(root, rel), "latin1"),
    );
    for (const b of blocksIn(rel, lines))
      out.push(
        `  ${rel}:${b.from + 1} ${blockSha(lines, b)} ${startOf(lines, b)}`,
      );
  }
  say(...out, `list: ${num(out.length)} entries in ${num(names.length)} files`);
  return 0;
}

// ---- the lock and the write order ----
const say = (...lines) => {
  for (const l of lines) console.log(l);
};
const lockKey = (root) =>
  crypto.createHash("sha1").update(fileKey(root)).digest("hex").slice(0, 16);
const readRaw = (file) => {
  try {
    return fs.readFileSync(file, "latin1");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
// Writes bytes by a temp file and a rename; null deletes.
function put(root, rel, s) {
  const file = path.join(root, rel);
  if (s === null) return fs.rmSync(file, { force: true });
  const made = fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  fs.rmSync(tmp, { force: true });
  try {
    fs.writeFileSync(tmp, s, { encoding: "latin1", flag: "wx" }); // wx: a planted link at this name is refused
    fs.renameSync(tmp, file);
  } catch (e) {
    fs.rmSync(tmp, { force: true });
    if (made && !fs.readdirSync(made).length) fs.rmdirSync(made);
    throw e;
  }
}
const rmEmptyDir = (root) => {
  const dir = path.join(root, DECISIONS_DIR);
  if (fs.existsSync(dir) && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
};
// The lock is the user's own (under ~/.claude/hooks/state), not in the shared temp folder, where another account
// could plant a restore.json that this run would replay. Restore data still in the old temp-folder lock is not
// replayed either, but the run stops on it: it may be a real cut-off run's, for the user to check.
function takeLock(root, command) {
  const oldRestore = path.join(
    os.tmpdir(),
    "claude-decisions-lock",
    lockKey(root),
    "restore.json",
  );
  if (fs.existsSync(oldRestore))
    throw new Fail(
      `a cut-off run left restore data in the old lock folder, ${oldRestore}; it is not replayed and nothing changed. Check that the decisions files are whole (--verify HEAD names lost and doubled lines), then remove ${path.dirname(oldRestore)} and run this command again`,
    );
  const dir = path.join(STATE_DIR, "decisions-lock", lockKey(root));
  fs.mkdirSync(path.dirname(dir), { recursive: true, mode: 0o700 });
  const busy = (since) =>
    new Fail(
      `decisions: busy, another run holds the lock since ${hhmm(since)}; nothing changed`,
      { code: 2, raw: true },
    );
  const ownerFile = path.join(dir, "owner.json");
  let note = "";
  try {
    fs.mkdirSync(dir);
  } catch (e) {
    if (e.code !== "EEXIST") throw e;
    let owner = null;
    try {
      owner = JSON.parse(fs.readFileSync(path.join(dir, "owner.json"), "utf8"));
    } catch {}
    const started = owner?.started
      ? Date.parse(owner.started)
      : fs.statSync(dir).mtimeMs;
    const restoreFile = path.join(dir, "restore.json");
    const cutOff = fs.existsSync(restoreFile);
    if (
      Date.now() - started < LOCK_MAX_MS &&
      !(cutOff && owner && !alive(owner.pid))
    )
      throw busy(started);
    // The takeover is claimed by making a folder named for the stale owner: mkdir is atomic, so of two runs that
    // found the same stale lock only one takes it over; the other is told busy.
    const claim = path.join(dir, `taken-${Math.round(started)}`);
    if (faults.has("lock-race")) {
      fs.mkdirSync(claim);
      fs.writeFileSync(
        ownerFile,
        JSON.stringify({ pid: 999998, started: new Date().toISOString() }),
      );
    }
    try {
      fs.mkdirSync(claim);
    } catch (e) {
      if (e.code === "EEXIST") throw busy(started);
      throw e;
    }
    note = `; took over a lock from ${hhmm(started)}`;
    try {
      if (cutOff) note = recoverCutOff(root, dir, restoreFile, started);
    } catch (e) {
      fs.rmdirSync(claim); // the next run meets the same cut-off run and its message
      throw e;
    }
    fs.rmSync(ownerFile, { force: true });
  }
  try {
    fs.writeFileSync(
      ownerFile,
      JSON.stringify({
        pid: process.pid,
        started: new Date().toISOString(),
        command,
      }),
      { flag: "wx" },
    );
  } catch (e) {
    if (e.code === "EEXIST") throw busy(Date.now());
    throw e;
  }
  return { dir, note };
}
// A name a run may write: DECISIONS.md, the archive, or one file straight in docs/decisions/.
const isRecordFile = (rel) =>
  rel === ROOT_FILE ||
  rel === ARCHIVE ||
  (rel.startsWith(`${DECISIONS_DIR}/`) &&
    !rel.slice(DECISIONS_DIR.length + 1).includes("/") &&
    VALID_NAME.test(path.posix.basename(rel)));
// A lock holding restore.json: a run was cut off after it began to write.
function recoverCutOff(root, dir, restoreFile, started) {
  let rs = null;
  try {
    rs = JSON.parse(fs.readFileSync(restoreFile, "utf8"));
  } catch {}
  const plain = (v) => !!v && typeof v === "object" && !Array.isArray(v);
  const text = (v) => v === null || typeof v === "string";
  if (
    !plain(rs) ||
    !plain(rs.files) ||
    !Object.values(rs.files).every(
      (f) => plain(f) && text(f.before) && text(f.after),
    )
  )
    throw new Fail(
      `the cut-off run's restore data in ${restoreFile} is not readable or not in its expected shape; nothing changed. Look at it before you remove ${dir}`,
    );
  const odd = Object.keys(rs.files).find((rel) => !isRecordFile(rel));
  if (odd !== undefined)
    throw new Fail(
      `the cut-off run's restore data names ${odd}, which is not a decisions file; nothing changed. Look at ${restoreFile} before you remove ${dir}`,
    );
  const back = [];
  const neither = [];
  for (const [rel, f] of Object.entries(rs.files)) {
    const before =
      f.before === null
        ? null
        : Buffer.from(f.before, "base64").toString("latin1");
    const cur = shaOf(readRaw(path.join(root, rel)));
    if (cur === shaOf(before)) continue;
    if (cur === f.after) back.push([rel, before]);
    else neither.push(rel);
  }
  if (!neither.length) {
    for (const [rel, before] of back) put(root, rel, before);
    if (rs.dirMade) rmEmptyDir(root);
    fs.rmSync(restoreFile);
    return `; restored a cut-off run from ${hhmm(started)}`;
  }
  const v = verifyAt(root, "HEAD");
  if (!v.lost.length && !v.doubled.length) {
    fs.rmSync(restoreFile);
    return "; dropped a cut-off run's restore data, the files match git";
  }
  throw new Fail(
    `a cut-off run from ${hhmm(started)} left files and ${neither[0]} changed since; make the files match git (--verify HEAD names the lost and doubled lines), then run this command again; never remove ${dir}`,
  );
}
// Removes a killed run's temp files: <name>.tmp-<pid> whose pid is not running.
function sweepTmp(root) {
  for (const d of [root, path.join(root, DECISIONS_DIR)]) {
    let names = [];
    try {
      names = fs.readdirSync(d);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    for (const n of names) {
      const m = /\.tmp-(\d+)$/.exec(n);
      if (!m || (d === root && !n.startsWith(`${ROOT_FILE}.tmp-`))) continue;
      if (!alive(Number(m[1]))) fs.rmSync(path.join(d, n), { force: true });
    }
  }
}
function recordLasting(root, set, e) {
  writeJson(failureFile(root), {
    rootSha1: shaOf(set.get(ROOT_FILE)),
    file: e.lasting,
    fileSha1: shaOf(set.get(e.lasting)),
    reason: e.message,
    at: new Date().toISOString(),
  });
}
// A test fault that plays another session writing between the read and the write.
function disturb(root, set, changed) {
  if (faults.has("root-changed"))
    fs.appendFileSync(
      path.join(root, ROOT_FILE),
      "- other session\n",
      "latin1",
    );
  if (faults.has("target-changed")) {
    const rel = changed.find((r) => r !== ROOT_FILE && set.get(r) !== null);
    fs.appendFileSync(path.join(root, rel), "- other session\n", "latin1");
  }
  if (faults.has("target-created")) {
    const rel = changed.find((r) => set.get(r) == null);
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), "# other session\n");
  }
}
// Runs a writing command: lock, read, build and check in memory, write in order, read back, restore on failure.
// build(set) -> { nothing, lines } or { after, plan, lines(r), undo? }.
function transact(root, command, build) {
  mustTrack(root, "nothing changed");
  const lock = takeLock(root, command);
  const restoreFile = path.join(lock.dir, "restore.json");
  const written = [];
  let keep = false;
  let set = null;
  let dirMade = false;
  try {
    sweepTmp(root);
    set = readSet(root);
    let res;
    try {
      res = build(set);
    } catch (e) {
      if (e instanceof Fail && e.lasting) recordLasting(root, set, e);
      throw e;
    }
    if (res.nothing) {
      fs.rmSync(failureFile(root), { force: true });
      say(...res.lines(lock.note));
      return 0;
    }
    const r = mustPass(set, res.after, res.plan);
    const changed = [...res.after.keys()].filter(
      (rel) => res.after.get(rel) !== (set.get(rel) ?? null),
    );
    const counted = (s, rel) =>
      countedLines(new Map([[rel, s ?? null]])).length;
    const gains = (rel) =>
      counted(res.after.get(rel), rel) > counted(set.get(rel), rel);
    const order = [
      ...changed.filter((rel) => rel !== ROOT_FILE && gains(rel)),
      ...changed.filter((rel) => rel !== ROOT_FILE && !gains(rel)),
      ...changed.filter((rel) => rel === ROOT_FILE),
    ];
    const inDir = changed.filter((rel) => rel.startsWith(`${DECISIONS_DIR}/`));
    if (inDir.length) mustNotIgnore(root, inDir);
    dirMade =
      !fs.existsSync(path.join(root, DECISIONS_DIR)) &&
      changed.some((rel) => rel.startsWith(`${DECISIONS_DIR}/`));
    const files = {};
    for (const rel of changed)
      files[rel] = {
        before:
          set.get(rel) == null
            ? null
            : Buffer.from(set.get(rel), "latin1").toString("base64"),
        after: shaOf(res.after.get(rel)),
      };
    const restoreTmp = `${restoreFile}.tmp-${process.pid}`;
    fs.writeFileSync(restoreTmp, JSON.stringify({ dirMade, files }));
    fs.renameSync(restoreTmp, restoreFile);
    disturb(root, set, changed);
    for (const rel of order) {
      if (readRaw(path.join(root, rel)) !== (set.get(rel) ?? null))
        throw new Fail(`${rel} changed while the run ran`);
      if (faults.has("fail-root-write") && rel === ROOT_FILE)
        throw new Error("test fault: the root write fails");
      put(root, rel, res.after.get(rel));
      written.push(rel);
      if (faults.has("cut-off")) process.exit(9);
    }
    if (faults.has("fail-after-files"))
      throw new Error("test fault: a failure after the files");
    const back = readSet(root);
    for (const rel of changed)
      if ((back.get(rel) ?? null) !== res.after.get(rel))
        throw new Fail(`read back differs at ${rel}`);
    mustPass(set, back, res.plan);
    if (res.undo) {
      const tmp = `${res.undo}.tmp-${process.pid}`;
      fs.writeFileSync(
        tmp,
        JSON.stringify(
          { dirMade, files, applied: new Date().toISOString() },
          null,
          1,
        ),
      );
      fs.renameSync(tmp, res.undo);
    }
    if (res.done) res.done();
    fs.rmSync(failureFile(root), { force: true });
    say(...res.lines(r, lock.note));
    return 0;
  } catch (e) {
    if (written.length || dirMade) {
      let at = null;
      try {
        for (const rel of [...written].reverse()) {
          at = rel;
          if (faults.has("fail-restore"))
            throw new Error("test fault: the restore write fails");
          put(root, rel, set.get(rel) ?? null);
        }
        at = DECISIONS_DIR;
        if (dirMade) rmEmptyDir(root);
      } catch (re) {
        keep = true;
        say(
          `${command} FAILED: restore failed at ${at}: ${re.message}; run this command again to finish the restore (never remove ${lock.dir}: it holds the restore data)`,
        );
        return 1;
      }
    }
    throw e;
  } finally {
    if (!keep) fs.rmSync(lock.dir, { recursive: true, force: true });
  }
}

// ---- commands ----
function split(root, dry) {
  const word = dry ? "dry run, nothing written: split" : "split";
  const build = (set) => {
    const p = planSplit(root, set);
    const rootStr = set.get(ROOT_FILE);
    const size = `${num(rootStr.length)} bytes, ${num(parseLines(rootStr).length)} lines`;
    if (p.nothing) {
      const over =
        rootStr.length > ROOT_MAX_BYTES ||
        parseLines(rootStr).length > ROOT_MAX_LINES;
      return {
        nothing: true,
        lines: (note = "") => [
          over
            ? `${word}: nothing to move: DECISIONS.md has no ## sections (${size}); sort its entries into topic files with a ledger (--list DECISIONS.md, then --apply)${note}`
            : `${word}: nothing to move; DECISIONS.md ${size}${note}`,
        ],
      };
    }
    const after = p.after.get(ROOT_FILE);
    const topic = p.stats.filter((t) => isTopic(t.rel)).length;
    const made = p.stats.filter((t) => t.isNew).length;
    return {
      after: p.after,
      plan: p.plan,
      lines: (r, note = "") => [
        `${word}: ${num(p.moved.length)} sections moved to docs/decisions/ (${topic} topic files, ${p.stats.length - topic} job files, ${made} new); DECISIONS.md ${num(rootStr.length)} → ${num(after.length)} bytes, ${num(parseLines(rootStr).length)} → ${num(parseLines(after).length)} lines; ${checkLine(r)}, ${num(r.heads)} headings kept${note}`,
        ...strayNote(p.strayAt),
        ...(dry
          ? p.stats.map(
              (t) =>
                `  ${t.rel}  ${t.n} sections  ${num(t.bytes)} bytes  ${t.isNew ? "new" : "adds"}`,
            )
          : []),
      ],
    };
  };
  if (!dry) return transact(root, "split", build);
  const set = readSet(root);
  const res = build(set);
  say(
    ...(res.nothing
      ? res.lines()
      : res.lines(mustPass(set, res.after, res.plan))),
  );
  return 0;
}
function apply(root, ledgerFiles, dry) {
  if (!ledgerFiles.length)
    throw new Fail("decisions: --apply needs a ledger", { code: 3, raw: true });
  const ledgers = readLedgers(ledgerFiles);
  const undoFile = `${ledgerFiles[0]}.undo.json`;
  const word = dry ? "dry run, nothing written: apply" : "apply";
  const build = (set) => {
    if (!dry && fs.existsSync(undoFile))
      throw new Fail(`${undoFile} exists: --undo first, or remove it`);
    const p = planApply(root, set, ledgers);
    return {
      after: p.after,
      plan: p.plan,
      undo: dry ? null : undoFile,
      lines: (r, note = "") => [
        `${word}: ${num(p.moves.length)} entries moved to ${p.targets} topic files (${p.made} new); ${num(p.n.history)} stay; ${num(p.n.unsure)} unsure stay; ${num(p.n.noDate)} not moved (no date of their own); ${checkLine(r)}${dry ? "" : `; undo: ${undoFile}`}${note}`,
        ...strayNote(p.strayAt),
        ...(dry ? [coverage(p)] : []),
      ],
    };
  };
  if (!dry) return transact(root, "apply", build);
  const set = readSet(root);
  const res = build(set);
  say(...res.lines(mustPass(set, res.after, res.plan)));
  return 0;
}
function undo(root, ledger) {
  if (!ledger)
    throw new Fail("decisions: --undo needs the ledger of the apply", {
      code: 3,
      raw: true,
    });
  const file = `${ledger}.undo.json`;
  let u;
  try {
    u = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Fail(`decisions: cannot read ${file}: ${e.message}`, {
      code: 3,
      raw: true,
    });
  }
  return transact(root, "undo", (set) => {
    const after = new Map(set);
    for (const [rel, f] of Object.entries(u.files)) {
      if (shaOf(set.get(rel) ?? null) !== f.after)
        throw new Fail(`${rel} changed since the apply (use git)`);
      after.set(
        rel,
        f.before === null
          ? null
          : Buffer.from(f.before, "base64").toString("latin1"),
      );
    }
    return {
      after,
      plan: [],
      done: () => {
        if (u.dirMade) rmEmptyDir(root);
        fs.rmSync(file);
      },
      lines: (r, note = "") => [
        `undo: ${Object.keys(u.files).length} files back as before the apply of ${ledger}; ${checkLine(r)}${note}`,
      ],
    };
  });
}
const COMMANDS = [
  "--split",
  "--apply",
  "--undo",
  "--verify",
  "--check",
  "--list",
];
function main(args) {
  const cmds = args.filter((a) => COMMANDS.includes(a));
  const unknown = args.filter(
    (a) => a.startsWith("--") && a !== "--dry-run" && !COMMANDS.includes(a),
  );
  if (cmds.length !== 1 || unknown.length)
    throw new Fail(
      `decisions: unknown command ${unknown[0] ?? (cmds.join(" ") || "(none)")}; use ${COMMANDS.join(", ")}`,
      { code: 3, raw: true },
    );
  const dry = args.includes("--dry-run");
  let root = null;
  const rest = [];
  for (const a of args.filter((x) => !x.startsWith("--"))) {
    if (!root && fs.statSync(a, { throwIfNoEntry: false })?.isDirectory())
      root = path.resolve(a);
    else rest.push(a);
  }
  root ??= process.cwd();
  // A word that is not the folder and not the command's own argument (a ledger file for --apply, one revision for
  // --verify) is a mistyped folder: running on the current folder instead would split the wrong project.
  const stray =
    cmds[0] === "--split" || cmds[0] === "--check"
      ? rest
      : cmds[0] === "--apply"
        ? rest.filter(
            (a) => !fs.statSync(a, { throwIfNoEntry: false })?.isFile(),
          )
        : cmds[0] === "--verify"
          ? rest.slice(1)
          : [];
  if (stray.length)
    throw new Fail(`decisions: no folder ${stray[0]}`, { code: 3, raw: true });
  if (!fs.existsSync(path.join(root, ROOT_FILE)))
    throw new Fail(`decisions: no DECISIONS.md in ${root}`, {
      code: 3,
      raw: true,
    });
  if (cmds[0] === "--split") return split(root, dry);
  if (cmds[0] === "--apply") return apply(root, rest, dry);
  if (cmds[0] === "--undo") return undo(root, rest[0]);
  if (cmds[0] === "--verify") return verify(root, rest[0] ?? "HEAD");
  if (cmds[0] === "--check") return check(root);
  return list(root, rest);
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const word = (args.find((a) => COMMANDS.includes(a)) ?? "--decisions").slice(
    2,
  );
  try {
    process.exitCode = main(args);
  } catch (e) {
    if (e instanceof Fail && e.raw) say(e.message);
    else
      say(
        `${word} FAILED, nothing changed: ${e.message}`,
        ...(e.details ?? []),
      );
    process.exitCode = e instanceof Fail ? e.code : 1;
  }
}
