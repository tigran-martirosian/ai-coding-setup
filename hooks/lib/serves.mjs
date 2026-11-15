// The full helper brief that map-brief and serves-brief both build. Both hooks run on the same Agent call at the same
// time and each returns updatedInput from the brief Claude sent; Claude Code takes one whole input, so one hook's
// lines would be lost (the same case as download-guard and command-explain). So each hook builds the same brief:
// the original, then the systems map lines, then the Serves lines. Each part has its own off switch and its own
// "already added" marker; a part that fails is left out and its error returned, the other part still goes in.
//   map part: MAP_BRIEF=off; marker "SYSTEMS MAP:"; <project>/.claude/systems-map.json cut by skills/systems-map/map.mjs.
//   Serves part: SERVES_BRIEF=off (process env or a project's settings env); marker "SERVES (from".
// The Serves part keeps a decision's purpose with the step. A brief that names a plan file (a .md path that exists,
// absolute or relative to the hook's cwd or the project) and a step id of that plan's job-list table (first column
// "Step" or "Row", a "Serves" column) gets that row's Serves cell as it is written: "SERVES (from <plan> <step>): <cell>".
// A reviewer or plan-reviewer brief gets every row's cell. A row with no Serves column, an empty cell or a cell that
// quotes no words of the user ("decided, see DECISIONS") gets a visible "no quoted purpose" line instead, and a
// note for the lead. Struck-out rows (~~I9~~) are skipped. A brief naming no such plan gets no Serves part.
// The same rows get the purpose check (section below): FOR lines with the user's words for each recorded thing a row
// names, and one PURPOSE CHECK result line. A worker start on a failing row is refused by both hooks with the same
// text, so the refusal holds whichever runs last. The check runs under the Serves part's off switch.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { loadMap } from "./map-file.mjs";
import { setting } from "./settings-env.mjs";

export const TYPES = new Set([
  "worker",
  "worker-full",
  "worker-code",
  "worker-refactor",
  "reviewer",
  "planner",
  "plan-reviewer",
]);
const REVIEWERS = new Set(["reviewer", "plan-reviewer"]);
export const MAP_MARKER = "SYSTEMS MAP:";
export const SERVES_MARKER = "SERVES (from";
const MAP_JS = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "skills",
  "systems-map",
  "map.mjs",
);
const MAX_PLAN = 2e6;

const isOff = (v) => String(v || "").toLowerCase() === "off";

// ---- the map part (was map-brief's body)
async function mapPart(prompt) {
  if (isOff(process.env.MAP_BRIEF) || prompt.includes(MAP_MARKER)) return "";
  const project = process.env.CLAUDE_PROJECT_DIR;
  if (!project) return "";
  const map = loadMap(project);
  if (!Array.isArray(map?.nodes) || !map.nodes.length) return "";
  const { brief, CMD } = await import(pathToFileURL(MAP_JS).href);
  const head =
    "\n\nSYSTEMS MAP: the project's dictionary of what connects to what, cut to the things this brief touches. A change to one of these " +
    "links means checking the thing at the other end, or naming it under Outside the brief.\n";
  const tail = `\nMore: ${CMD} --near <thing>; --near alone lists every thing.`;
  const none = `\n\nSYSTEMS MAP: nothing in this brief matched (${CMD} --near <word> looks one up).`;
  const lines = brief(prompt, map, project).trim();
  return lines ? head + lines + tail : none;
}

// ---- the Serves part
// A table row's cells; a "|" inside `code` or written "\|" stays in its cell.
export function cells(line) {
  const out = [];
  let cur = "",
    code = false;
  const s = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" && s[i + 1] === "|") {
      cur += "|";
      i++;
      continue;
    }
    if (c === "`") code = !code;
    if (c === "|" && !code) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += c;
  }
  out.push(cur.trim());
  return out;
}
const bare = (cell) => cell.replace(/~~|\*\*|`/g, "").trim();

// The plan's Step tables: [{ serves: bool, rows: [{ id, cell, cells, head }] }]; struck-out rows are left out.
// head is the table's lower-cased header, cells the row's own cells (the purpose check reads them).
export function stepTables(text) {
  const lines = text.split(/\r?\n/),
    tables = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (
      !lines[i].trim().startsWith("|") ||
      !/^\s*\|?\s*:?-{3,}/.test(lines[i + 1])
    )
      continue;
    const head = cells(lines[i]).map((c) => bare(c).toLowerCase());
    let j = i + 2;
    const rows = [];
    for (; j < lines.length && lines[j].trim().startsWith("|"); j++) {
      const row = cells(lines[j]);
      if (row[0].startsWith("~~")) continue;
      const id = bare(row[0]).split(/[\s,]/)[0];
      if (id)
        rows.push({
          id,
          cell:
            head.indexOf("serves") >= 0
              ? (row[head.indexOf("serves")] ?? "")
              : null,
          cells: row,
          head,
        });
    }
    if (head[0] === "step" || head[0] === "row")
      tables.push({ serves: head.includes("serves"), rows });
    i = j - 1;
  }
  return tables;
}

// Why a cell carries no purpose, or "" when it quotes the user (or is the merge/record rows' "none (mechanics)").
export function noPurpose(cell) {
  if (cell === null) return "the plan's job list has no Serves column";
  if (!cell.trim()) return "the row's Serves cell is empty";
  if (
    /^none \(mechanics\)/i.test(cell.trim()) ||
    /["“][^"“”]*\p{L}[^"“”]*["”]/u.test(cell)
  )
    return "";
  return `the row's Serves cell ("${cell.trim()}") quotes no words of the user`;
}

// The .md paths the brief names that exist: [{ shown, file }]. Paths are taken from whitespace-split words, and also
// from an absolute path or a `code`/quoted span that holds spaces ("C:/Projects/my project/docs/plan.md").
export function planFiles(prompt, bases) {
  const seen = new Set(),
    out = [];
  const spaced = [
    // from every drive, ~ or (Mac, Linux) word-starting / start, so an earlier path mentioned in the same line doesn't swallow this one
    ...[
      ...prompt.matchAll(/(?<![\w])(?:[A-Za-z]:|~)[\\/]|(?<![^\s([])\/(?=\w)/g),
    ]
      .map(
        (m) =>
          /^[^\n`"'“”‘’<>|*?]*?\.md(?![\w.])/.exec(prompt.slice(m.index))?.[0],
      )
      .filter(Boolean),
    ...[...prompt.matchAll(/[`"“‘']([^`"”’'\n]+?\.md)(?::\d+)*[`"”’']/g)].map(
      (m) => m[1],
    ),
  ].filter((p) => /\s/.test(p));
  for (let tok of [...spaced, ...prompt.split(/[\s`"'“”‘’()[\]<>*|,;]+/)]) {
    tok = tok
      .replace(/#.*$/, "")
      .replace(/(?::\d+)+$/, "")
      .replace(/[.:!?]+$/, "")
      .replace(/(?::\d+)+$/, "");
    if (!/\.md$/i.test(tok)) continue;
    const t = tok.replace(/^~(?=[\\/])/, os.homedir());
    const tries =
      path.isAbsolute(t) || /^[A-Za-z]:[\\/]/.test(t)
        ? [t]
        : bases.map((b) => path.join(b, t));
    for (const f of tries) {
      const st = fs.statSync(f, { throwIfNoEntry: false });
      if (!st?.isFile() || st.size > MAX_PLAN) continue;
      const key = path.resolve(f).toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ shown: tok.replace(/\\/g, "/"), file: f });
      }
      break;
    }
  }
  return out;
}

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const named = (prompt, id) =>
  new RegExp(`(?<![\\w-])${esc(id)}(?![\\w-])`).test(prompt);
const pointed = (prompt, id) =>
  new RegExp(`\\b(?:step|row)\\s*:?\\s*${esc(id)}(?![\\w-])`, "i").test(prompt);

// ---- the purpose check
// The record is the section "## What each thing is for" at the top of the project's DECISIONS.md, one line per thing:
//   - **<thing>** (also: <name>, <name>): "<cleaned words>" · *<YYYY-MM-DD>* · from "<raw phrase>"
// A row names a thing when its Job, Files or Done when cell (a table with none of those: every cell but the id,
// Serves and Helper) holds one of the thing's names; names count in code spans and file paths too. Such a row fails
// when (a) its Serves cell holds neither the entry's words nor its raw phrase (a quote cut with "…" counts, see
// cutHolds), or (b) a limit word stands outside the Serves quotes, code spans and path-like words and no cell has
// "NARROWED: … because". A worker start on a failing row is refused; planner and reviewer briefs get FOR lines and
// a PURPOSE CHECK result line instead.
export const RECORD_HEAD = "## What each thing is for";
export const PURPOSE_MARKER = "PURPOSE CHECK";
const ENTRY =
  /^- \*\*(.+?)\*\*(?: \(also: (.+?)\))?: "(.+?)" · \*(\d{4}-\d{2}-\d{2})\* · from "(.+)"\s*$/;
const WORKERS = new Set([...TYPES].filter((t) => t.startsWith("worker")));
const LIMITS = [
  "read only",
  "readonly",
  "no shell",
  "without (?:a )?shell",
  "no grep",
  "no search",
  "no network",
  "no internet",
  "offline only",
  "no writes?",
  "no exploits?",
  "no attacks?",
  "report only",
  "review only",
  "dry run",
  "list only",
  "only reads?",
  "reads? only",
  "no tools?",
];
const LIMIT = new RegExp(
  `(?<![\\p{L}\\p{N}])(?:${LIMITS.map((l) => l.replace(/ /g, "[-_\\s]+")).join("|")})(?![\\p{L}\\p{N}])`,
  "iu",
);
const NARROWED = /NARROWED:[^|]*\bbecause\b/;
const FILE_DATE = /(?<![\p{L}\p{N}])\d{4}-\d{2}-\d{2}-/gu;

// "…" in a quote matches any text; case, double quote marks, curly apostrophes, -/_, runs of white space and
// . , ; : ! ? at the end of a word do not count ("engineering." matches "engineering").
const CUT = /\s*(?:…|\.\.\.)\s*/;
const norm = (s) =>
  s
    .toLowerCase()
    .replace(/[“”"]/g, "")
    .replace(/[‘’]/g, "'")
    .replace(/[-_]/g, " ")
    .replace(/[.,;:!?]+(?=\s|$)/g, "")
    .replace(/\s+/g, " ")
    .trim();
export function holds(text, quote) {
  const t = norm(text);
  let at = 0;
  for (const part of quote.split(CUT).map(norm).filter(Boolean)) {
    const i = t.indexOf(part, at);
    if (i < 0) return false;
    at = i + part.length;
  }
  return true;
}
// A Serves quote cut with "…" counts for an entry's words (or raw phrase) when its parts are found there in order
// and together hold at least half as many words.
const wordCount = (s) =>
  s
    .split(new RegExp(CUT.source, "g"))
    .map(norm)
    .join(" ")
    .split(" ")
    .filter(Boolean).length;
export const cutHolds = (text, quote) =>
  CUT.test(quote) &&
  holds(text, quote) &&
  2 * wordCount(quote) >= wordCount(text);
const quotes = (cell) =>
  [...cell.matchAll(/"([^"]*)"|“([^”]*)”/g)].map((m) => m[1] ?? m[2]);
// Code spans and path-like words (with / or \, or a file extension) set no limit: `--dry-run`, planner-readonly.mjs.
const plain = (c) =>
  c
    .replace(/`[^`]*`/g, " ")
    .replace(
      /[^\s|`]*(?:[\\/][^\s|`]*|\.\p{L}[\p{L}\p{N}]{0,4}(?![\p{L}\p{N}]))/gu,
      " ",
    );

// A name matches with no letter, digit, - or _ before it and no letter or digit after it (past an optional s or 's);
// inside it a space, - or _ match each other.
export const nameRe = (name) =>
  new RegExp(
    `(?<![\\p{L}\\p{N}_-])${name
      .trim()
      .split(/[-_\s]+/)
      .map(esc)
      .join("[-_\\s]+")}(?:'?s)?(?![\\p{L}\\p{N}])`,
    "iu",
  );

// Dated decision lines: [{ after, date }], "- **…**" lines with a date, the text after the bold summary.
function decisionLines(lines) {
  const out = [];
  for (const l of lines) {
    if (!l.startsWith("- **")) continue;
    const dates = l.match(/\d{4}-\d{2}-\d{2}/g);
    if (!dates) continue;
    const end = l.indexOf("**", 4);
    out.push({ after: end < 0 ? "" : l.slice(end + 2), date: dates.at(-1) });
  }
  return out;
}

// { file, entries, bad } or { none: why }. Each entry gets backing "backed", "stale" or "unbacked".
export function readRecord(dir) {
  if (!dir) return { none: "no project folder to read DECISIONS.md from" };
  const file = path.join(dir, "DECISIONS.md");
  if (!fs.statSync(file, { throwIfNoEntry: false })?.isFile())
    return { none: `no DECISIONS.md in ${dir.replace(/\\/g, "/")}` };
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const start = lines.findIndex((l) => l.trim() === RECORD_HEAD);
  if (start < 0)
    return { none: `DECISIONS.md has no "${RECORD_HEAD.slice(3)}" section` };
  let end = start + 1;
  while (end < lines.length && !/^#{1,2}\s/.test(lines[end])) end++;
  const entries = [],
    bad = [];
  // every line of the section is an entry: one that does not parse is named in the result line
  for (const l of lines.slice(start + 1, end)) {
    if (!l.trim()) continue;
    const m = ENTRY.exec(l.trim());
    if (!m) {
      bad.push(l.trim());
      continue;
    }
    const [, thing, also, words, date, from] = m;
    entries.push({
      thing,
      names: [thing, ...(also ? also.split(", ") : [])],
      words,
      date,
      from,
    });
  }
  const decided = decisionLines([
    ...lines.slice(0, start),
    ...lines.slice(end),
  ]);
  const archive = path.join(dir, "docs", "decisions-archive.md");
  const archived = fs.statSync(archive, { throwIfNoEntry: false })?.isFile()
    ? decisionLines(fs.readFileSync(archive, "utf8").split(/\r?\n/))
    : [];
  for (const e of entries)
    e.backing = decided.some((d) => d.date === e.date && holds(d.after, e.from))
      ? "backed"
      : archived.some((d) => holds(d.after, e.from))
        ? "stale"
        : "unbacked";
  return { file, entries, bad };
}

// The entries a row names and how it fails: { named: [entry], fails: [{ entry, a, b }] }.
export function checkRow(row, record) {
  const h = row.head;
  let cols = ["job", "files", "done when"]
    .map((n) => h.indexOf(n))
    .filter((i) => i >= 0);
  if (!cols.length)
    cols = h
      .map((_, i) => i)
      .filter((i) => i > 0 && h[i] !== "serves" && h[i] !== "helper");
  const text = cols
    .map((i) => row.cells[i] ?? "")
    .join(" | ")
    .replace(FILE_DATE, "");
  const named = record.entries.filter((e) =>
    e.names.some((n) => nameRe(n).test(text)),
  );
  if (!named.length) return { named, fails: [] };
  const si = h.indexOf("serves");
  const limitText = row.cells
    .map((c, i) => plain(i === si ? c.replace(/"[^"]*"|“[^”]*”/g, " ") : c))
    .join(" | ");
  const limit = LIMIT.exec(limitText)?.[0];
  const b = limit && !row.cells.some((c) => NARROWED.test(c)) ? limit : null;
  const hasWords = (cell, e) =>
    holds(cell, e.words) ||
    holds(cell, e.from) ||
    quotes(cell).some((q) => cutHolds(e.words, q) || cutHolds(e.from, q));
  const fails = named
    .map((entry) => ({
      entry,
      a: row.cell === null || !hasWords(row.cell, entry),
      b,
    }))
    .filter((f) => f.a || f.b);
  return { named, fails };
}

const why = (f) =>
  [
    f.a ? "the row's Serves cell lacks these words" : "",
    f.b ? `it says "${f.b}" without a NARROWED: … because … mark` : "",
  ]
    .filter(Boolean)
    .join("; ");
const said = (e) =>
  `"${e.words}" (${e.date}; the raw words "${e.from}" count too)`;

// The refusal text for a worker start on failing rows: [{ shown, id, fails }].
export function refusal(failing) {
  const parts = failing.flatMap(({ shown, id, fails }) =>
    fails.map(
      (f) =>
        `row ${id} of ${shown} names ${f.entry.thing}. DECISIONS.md says what it is for: ${said(f.entry)}. Here ${why(f)}.`,
    ),
  );
  return (
    `serves-brief refused this helper start: ${parts.join(" ")} ` +
    "Put the quote in Serves and make the Job do it, or write NARROWED: <what>, because <why> and ask the user. " +
    "Do not start a safer stand-in."
  );
}

// The FOR and PURPOSE CHECK lines for the checked rows ([{ shown, id, row }]): { lines, notes, failing }, notes
// being the lead's purpose-check notes.
export function purposeLines(checked, record) {
  if (record.none)
    return {
      lines: [`${PURPOSE_MARKER}: not run: ${record.none}.`],
      notes: [`not run: ${record.none}.`],
      failing: [],
    };
  const lines = [],
    notes = [],
    failing = [],
    named = new Map();
  for (const { shown, id, row } of checked) {
    const r = checkRow(row, record);
    for (const e of r.named) named.set(e, [...(named.get(e) ?? []), id]);
    if (r.fails.length) failing.push({ shown, id, fails: r.fails });
  }
  for (const [e, ids] of named)
    lines.push(`FOR ${e.thing} (named by ${ids.join(", ")}): ${said(e)}`);
  const n = record.entries.length;
  const faults = [];
  for (const kind of ["unbacked", "stale"]) {
    const list = record.entries.filter((e) => e.backing === kind);
    if (list.length)
      faults.push(`${kind}: ${list.map((e) => e.thing).join(", ")}`);
  }
  if (record.bad.length)
    faults.push(
      `lines that do not parse: ${record.bad.map((l) => `"${l}"`).join(", ")}`,
    );
  const rec = faults.length
    ? `Record: ${faults.join("; ")}.`
    : `Record: all ${n} entries backed by a dated decision.`;
  lines.push(
    `${PURPOSE_MARKER}: ${checked.length} row(s) checked against ${n} entries of DECISIONS.md; ` +
      (failing.length
        ? `${failing.length} fail (below). ${rec}`
        : `none fails. ${rec}`),
  );
  for (const { id, fails } of failing)
    lines.push(
      `- ${id}: ${fails.map((f) => `${f.entry.thing}: ${why(f)}; the row needs ${said(f.entry)}`).join(" / ")}`,
    );
  for (const { shown, id, fails } of failing)
    notes.push(
      `${shown} ${id} fails (${fails.map((f) => `${f.entry.thing}: ${why(f)}`).join("; ")}); fix the row before a worker starts on it.`,
    );
  if (faults.length) notes.push(`DECISIONS.md record: ${faults.join("; ")}.`);
  return { lines, notes, failing };
}

// { text, notes, purposeNotes, deny }: the lines to append, one note per row with no quoted purpose, the purpose
// check's notes for the lead, and the refusal text when a worker brief's row fails the purpose check. record() reads
// the purpose record (only when a row is checked). A brief can name several .md files that hold the same row id (a
// plan and its design): a file that holds the id in a table with a Serves column wins, the other files drop that id,
// and for a reviewer a file with no Serves table is dropped when one of its ids is won by another file.
export function servesPart(prompt, type, bases, record) {
  const lines = [],
    notes = [],
    checked = [];
  const plans = planFiles(prompt, bases)
    .map((p) => ({ ...p, tables: stepTables(fs.readFileSync(p.file, "utf8")) }))
    .filter((p) => p.tables.length);
  const servedBy = new Map(); // id -> the files that hold it in a Serves table
  for (const p of plans)
    for (const t of p.tables.filter((x) => x.serves))
      for (const r of t.rows)
        servedBy.set(r.id, new Set([...(servedBy.get(r.id) ?? []), p.file]));
  for (const { shown, file, tables } of plans) {
    const lost = (id) => servedBy.has(id) && !servedBy.get(id).has(file);
    const allIds = [...new Set(tables.flatMap((t) => t.rows.map((r) => r.id)))];
    const withServes = tables.filter((t) => t.serves);
    // the row an id stands for: the one in a Serves table first
    const rowOf = (id) =>
      [...withServes, ...tables.filter((x) => !x.serves)]
        .flatMap((t) => t.rows)
        .find((r) => r.id === id);
    if (REVIEWERS.has(type)) {
      if (!withServes.length && allIds.some(lost)) continue;
      for (const id of allIds.filter((id) => !lost(id)))
        checked.push({ shown, id, row: rowOf(id) });
      if (!withServes.length) {
        const why = noPurpose(null);
        lines.push(
          `${SERVES_MARKER} ${shown}): no quoted purpose: ${why}. Flag it as a finding.`,
        );
        notes.push(`the ${type} brief names ${shown}, but ${why}.`);
        continue;
      }
      // Rows of a Serves table first; a row only in a table without the column still gets its own line.
      const rows = new Map();
      for (const t of [...withServes, ...tables.filter((x) => !x.serves)])
        for (const r of t.rows)
          if (!rows.has(r.id) && !lost(r.id)) rows.set(r.id, r.cell);
      lines.push(
        `${SERVES_MARKER} ${shown}, every row): what the user said each row is for.`,
      );
      for (const [id, cell] of rows) {
        const why = noPurpose(cell);
        lines.push(
          why ? `${id}: no quoted purpose (${why})` : `${id}: ${cell.trim()}`,
        );
        if (why) notes.push(`${shown} ${id}: ${why}.`);
      }
      continue;
    }
    const ids = allIds.filter((id) => named(prompt, id) && !lost(id));
    const picked = ids.filter((id) => pointed(prompt, id));
    for (const id of picked.length ? picked : ids) {
      const row = rowOf(id);
      checked.push({ shown, id, row });
      const cell = row.cell;
      const why = noPurpose(cell);
      if (!why) {
        lines.push(`${SERVES_MARKER} ${shown} ${id}): ${cell.trim()}`);
        continue;
      }
      lines.push(
        `${SERVES_MARKER} ${shown} ${id}): no quoted purpose: ${why}. The lead adds the user's words to the row; name this gap in your report and do not guess the purpose.`,
      );
      notes.push(`the ${type} brief names ${shown} ${id}, but ${why}.`);
    }
  }
  let deny = null,
    purposeNotes = [];
  if (checked.length) {
    const p = purposeLines(checked, record());
    if (WORKERS.has(type) && p.failing.length) deny = refusal(p.failing);
    lines.push(...p.lines);
    purposeNotes = p.notes;
  }
  return {
    text: lines.length ? `\n\n${lines.join("\n")}` : "",
    notes,
    purposeNotes,
    deny,
  };
}

// The full brief: { input, notes, purposeNotes, errors, deny } with input the tool input to send, or null when
// nothing is added; deny is the refusal text when a worker brief's row fails the purpose check (both hooks then
// refuse the start). An error in the Serves part does not stop the helper (a hook bug must not block work): the
// brief gets "PURPOSE CHECK: not run: <error>" and the lead a note.
export async function fullBrief(event) {
  const input = event.tool_input;
  if (
    !["Agent", "Task"].includes(event.tool_name) ||
    !input ||
    typeof input !== "object"
  )
    return null;
  const prompt = input.prompt;
  if (!TYPES.has(input.subagent_type) || typeof prompt !== "string")
    return null;
  const errors = [];
  let map = "",
    serves = { text: "", notes: [], purposeNotes: [], deny: null };
  try {
    map = await mapPart(prompt);
  } catch (e) {
    errors.push({ part: "map", e });
  }
  try {
    if (!isOff(setting("SERVES_BRIEF"))) {
      const bases = [
        ...new Set([event.cwd, process.env.CLAUDE_PROJECT_DIR].filter(Boolean)),
      ];
      const dir = process.env.CLAUDE_PROJECT_DIR || event.cwd;
      serves = servesPart(prompt, input.subagent_type, bases, () =>
        readRecord(dir),
      );
      // a brief that holds the lines already gets no second copy, but its row is still checked
      if (prompt.includes(SERVES_MARKER))
        serves = { ...serves, text: "", notes: [], purposeNotes: [] };
    }
  } catch (e) {
    errors.push({ part: "serves", e });
    const err = `${e?.name}: ${String(e?.message).replace(/\s+/g, " ")}`;
    serves = {
      text: `\n\n${PURPOSE_MARKER}: not run: ${err}`,
      notes: [],
      purposeNotes: [`not run: ${err}`],
      deny: null,
    };
  }
  const none = { input: null, notes: [], purposeNotes: [], errors };
  if (serves.deny) return { ...none, deny: serves.deny };
  if (!map && !serves.text) return none;
  return {
    input: { ...input, prompt: prompt + map + serves.text },
    notes: serves.notes,
    purposeNotes: serves.purposeNotes,
    errors,
  };
}
