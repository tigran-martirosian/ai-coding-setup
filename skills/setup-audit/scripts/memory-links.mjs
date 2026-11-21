#!/usr/bin/env node
// memory-links: what rotted in a memory folder. For each folder it lists, one line per finding:
//   link     a `[[name]]` that matches no note (a note's name is its frontmatter `name:` or its file name)
//   index    a MEMORY.md line whose linked file is missing
//   orphan   a note with no MEMORY.md line
//   path     an absolute Windows path or a `~/` path named in a note that does not exist
//   undated  a note with no YYYY-MM-DD anywhere (frontmatter or body)
// Notes are the top-level .md files besides MEMORY.md; `archive/` is left out. URLs, repo-relative paths and
// paths with a placeholder or wildcard (`<name>`, `*`, `$VAR`, `...`) are not checked.
// Prints `<folder>  <kind>  <note>  <detail>` per finding and a last line with the counts; exit 1 on any
// finding, 0 when clean, 2 when a folder cannot be read.
//
// Usage: node memory-links.mjs [--json] [folder...]
//   no folder: every ~/.claude/projects/*/memory/ (the home follows HOME / USERPROFILE)
//   --json     one JSON object: { folders, findings: [{ folder, path, kind, note, detail }], counts }
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ARGS, positional } from "./lib/opt.mjs";

const KINDS = ["link", "index", "orphan", "path", "undated"];
const json = ARGS.includes("--json");
const home = os.homedir();

function fail(msg) {
  console.error(`memory-links: ${msg}`);
  process.exit(2);
}

let folders = positional();
if (!folders.length) {
  const projects = path.join(home, ".claude", "projects");
  if (!fs.existsSync(projects)) fail(`no projects folder at ${projects}`);
  folders = fs
    .readdirSync(projects, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => path.join(projects, d.name, "memory"))
    .filter((dir) => fs.existsSync(dir) && fs.statSync(dir).isDirectory());
} else
  for (const dir of folders)
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
      fail(`no folder at ${dir}`);

// A folder's label: the project folder's name for <project>/memory, else the path as given
const label = (dir) =>
  path.basename(path.resolve(dir)) === "memory"
    ? path.basename(path.dirname(path.resolve(dir)))
    : dir;

// The frontmatter `name:` of a note's text, or undefined
const frontName = (text) =>
  text
    .match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1]
    .match(/^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m)?.[1];

// The .md files directly in a folder: [{ file, text }]
const mdFiles = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isFile() && d.name.endsWith(".md"))
        .map((d) => ({
          file: d.name,
          text: fs.readFileSync(path.join(dir, d.name), "utf8"),
        }))
    : [];

// The names a set of notes answers to: file name without .md, and frontmatter name
const namesOf = (notes) =>
  new Set(
    notes.flatMap((n) =>
      [n.file.slice(0, -3), frontName(n.text)].filter(Boolean),
    ),
  );

// A path as written with a placeholder, wildcard or variable in it: not a real path
const PLACEHOLDER = /[<>*?{}$%]|\.\.\./;
// Where a checked path starts: a drive letter or `~` then a slash, not inside a word, URL or other path
const PATH_START = /(?<![\w/\\:.~-])(?:[A-Za-z]:[\\/](?=[\w.~-])|~[\\/])/g;

// The file a written path names: `~/` is the home; a trailing `:12` or `:12-30` line reference is cut
function resolvePath(p) {
  p = p.replace(/:\d+(-\d+)?$/, "");
  return p.startsWith("~") ? path.join(home, p.slice(2)) : p;
}
const exists = (p) => fs.existsSync(resolvePath(p));

// The absolute and `~/` paths a note names that do not exist
function missingPaths(text) {
  const missing = new Set();
  // A whole backtick span that starts with a path is the path, spaces and all (`C:\Projects\my project\x`)
  text = text.replace(/`([^`\n]+)`/g, (span, inner) => {
    const p = inner.trim();
    PATH_START.lastIndex = 0;
    const m = PATH_START.exec(p);
    if (!m || m.index !== 0) return span;
    const first = p.split(/\s/)[0];
    if (!PLACEHOLDER.test(first) && !exists(p) && !exists(first))
      missing.add(p);
    return " ".repeat(span.length);
  });
  // A bare path ends at a space or quote; when it does not exist, the next words may be part of it
  PATH_START.lastIndex = 0;
  for (let m; (m = PATH_START.exec(text)); ) {
    const rest = text.slice(m.index).split(/\r?\n/)[0];
    const words = rest.split(/ /);
    const trim = (s) => s.replace(/[\s"'.,;:!)\]]+$/, "").replace(/^\(/, "");
    const p = trim(words[0]);
    if (PLACEHOLDER.test(p) || p.length < 4) continue;
    let found = exists(p);
    for (let k = 2; !found && k <= 4 && k <= words.length; k++)
      found = exists(trim(words.slice(0, k).join(" ")));
    if (!found) missing.add(p);
  }
  return [...missing];
}

const findings = [];
let noteCount = 0;
for (const dir of folders) {
  const folder = label(dir);
  const add = (kind, note, detail) =>
    findings.push({ folder, path: path.resolve(dir), kind, note, detail });
  const files = mdFiles(dir);
  const index = files.find((f) => f.file === "MEMORY.md");
  const notes = files.filter((f) => f !== index);
  noteCount += notes.length;
  const names = namesOf(notes);
  const archived = namesOf(mdFiles(path.join(dir, "archive")));

  // link: per note (and the index), each [[target]] once; `[[name|text]]`, `[[name#part]]`, `[[name.md]]` allowed
  for (const f of files) {
    const seen = new Set();
    for (const [, raw] of f.text.matchAll(/\[\[([^\]\n]+)\]\]/g)) {
      const target = raw.split(/[|#]/)[0].trim().replace(/\.md$/, "");
      if (names.has(target) || seen.has(target)) continue;
      seen.add(target);
      add(
        "link",
        f.file.slice(0, -3),
        `[[${target}]] ${archived.has(target) ? "is only in archive/" : "matches no note"}`,
      );
    }
  }

  // index: each markdown link in MEMORY.md to a file, which must exist; the files it links are the indexed ones
  const indexed = new Set();
  if (index)
    for (const [, raw] of index.text.matchAll(/\]\(([^)\s]+)\)/g)) {
      if (/^[a-z][\w+.-]*:/i.test(raw) || raw.startsWith("#")) continue; // a URL or an anchor
      const target = decodeURI(raw.split("#")[0]);
      const file = path.resolve(dir, target);
      indexed.add(file);
      if (!fs.existsSync(file)) add("index", "MEMORY", `${target} is missing`);
    }

  for (const n of notes) {
    const name = n.file.slice(0, -3);
    if (!indexed.has(path.resolve(dir, n.file)))
      add(
        "orphan",
        name,
        index ? "no MEMORY.md line" : "no MEMORY.md in the folder",
      );
    for (const p of missingPaths(n.text))
      add("path", name, `${p} does not exist`);
    if (!/(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)/.test(n.text))
      add("undated", name, "no YYYY-MM-DD in the note");
  }
}

// Folder by folder as given, and in each folder by kind
const at = new Map(folders.map((d, i) => [path.resolve(d), i]));
findings.sort(
  (a, b) =>
    at.get(a.path) - at.get(b.path) ||
    KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind),
);
const counts = Object.fromEntries(
  KINDS.map((k) => [k, findings.filter((f) => f.kind === k).length]),
);
counts.total = findings.length;

if (json)
  console.log(
    JSON.stringify(
      { folders: folders.map((d) => path.resolve(d)), findings, counts },
      null,
      2,
    ),
  );
else {
  for (const f of findings)
    console.log(`${f.folder}  ${f.kind}  ${f.note}  ${f.detail}`);
  console.log(
    `${folders.length} folders, ${noteCount} notes: ` +
      KINDS.map((k) => `${counts[k]} ${k}`).join(", ") +
      ` (${counts.total} findings)`,
  );
}
process.exit(findings.length ? 1 : 0);
