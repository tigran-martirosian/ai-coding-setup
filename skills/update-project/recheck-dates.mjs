#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The dated facts of a project folder, for update-project's check P9 and setup-audit's memory part. A fact that can
// change carries the date at the end of its line or bullet, `(recheck YYYY-MM-DD)` (in a memory note: in the body); a
// line without it never expires. Read line by line, nothing else parsed: docs/facts.md, CLAUDE.md, HANDOFF.md,
// .claude/rules/*.md, the folder's memory notes (~/.claude/projects/<slug>/memory/*.md, archive/ left out), plus
// ~/.claude/CLAUDE.md and ~/.claude/rules/*.md. Files over 512 KB are skipped and counted.
// Run: node recheck-dates.mjs --list "<folder>" prints every dated line, `<file>:<line>  <date>  past|ok  <text>`,
// then `<n> past their recheck date, <m> within it`.
import { isMain } from "../../hooks/lib/hook-io.mjs";

const DATE = /\(recheck (\d{4}-\d{2}-\d{2})\)/;
const MAX_BYTES = 512 * 1024;

const fwd = (p) => p.replace(/\\/g, "/");
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};
const isDir = (p) => {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
};
const mdIn = (dir) =>
  isDir(dir)
    ? fs
        .readdirSync(dir)
        .filter((n) => n.endsWith(".md"))
        .sort()
        .map((n) => path.join(dir, n))
    : [];

// Today as YYYY-MM-DD in local time
function today() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// The folder's memory notes: Claude Code names the folder after the project path with every other character as "-";
// the drive letter's case can differ, so a folder that matches but for case counts too
function memoryDir(claude, folder) {
  const slug = path.resolve(folder).replace(/[^A-Za-z0-9]/g, "-");
  const projects = path.join(claude, "projects");
  if (isDir(path.join(projects, slug, "memory")))
    return path.join(projects, slug, "memory");
  if (!isDir(projects)) return null;
  const match = fs
    .readdirSync(projects)
    .find((n) => n.toLowerCase() === slug.toLowerCase());
  return match && isDir(path.join(projects, match, "memory"))
    ? path.join(projects, match, "memory")
    : null;
}

// The files read for a folder, each with the name it is shown by (relative to the folder, or ~/... outside it)
function filesFor(folder) {
  const home = os.homedir(),
    claude = path.join(home, ".claude");
  const memory = memoryDir(claude, folder);
  const all = [
    ...["docs/facts.md", "CLAUDE.md", "HANDOFF.md"].map((f) =>
      path.join(folder, f),
    ),
    ...mdIn(path.join(folder, ".claude", "rules")),
    ...(memory ? mdIn(memory) : []),
    path.join(claude, "CLAUDE.md"),
    ...mdIn(path.join(claude, "rules")),
  ];
  const seen = new Set(),
    out = [];
  for (const file of all) {
    const k = fwd(path.resolve(file)).toLowerCase();
    if (seen.has(k) || !isFile(file)) continue;
    seen.add(k);
    const rel = fwd(path.relative(folder, file));
    const name =
      !rel.startsWith("../") && !path.isAbsolute(rel)
        ? rel
        : fwd(path.relative(home, file)).startsWith("../")
          ? fwd(path.resolve(file))
          : `~/${fwd(path.relative(home, file))}`;
    out.push({ file, name });
  }
  return out;
}

// Every dated line in the folder's files: { at: "<name>:<line>", date, past, text }, and the count of files skipped
function scan(folder) {
  const now = today(),
    found = [];
  let skipped = 0;
  for (const { file, name } of filesFor(folder)) {
    if (fs.statSync(file).size > MAX_BYTES) {
      skipped++;
      continue;
    }
    fs.readFileSync(file, "utf8")
      .split(/\r?\n/)
      .forEach((line, i) => {
        const m = line.match(DATE);
        if (m)
          found.push({
            at: `${name}:${i + 1}`,
            date: m[1],
            past: m[1] < now,
            text: line.trim(),
          });
      });
  }
  return { found, skipped };
}

const skippedNote = (n) =>
  n ? `; ${n} file${n > 1 ? "s" : ""} over 512 KB not read` : "";

function list(folder) {
  if (!isDir(folder)) {
    process.stderr.write(`recheck-dates: no such folder: ${folder}\n`);
    process.exitCode = 1;
    return;
  }
  const { found, skipped } = scan(path.resolve(folder));
  for (const f of found)
    console.log(`${f.at}  ${f.date}  ${f.past ? "past" : "ok"}  ${f.text}`);
  const past = found.filter((f) => f.past).length;
  console.log(
    `${past} past their recheck date, ${found.length - past} within it${skippedNote(skipped)}`,
  );
}

if (isMain(import.meta.url)) {
  const at = process.argv.indexOf("--list");
  const folder = at === -1 ? undefined : process.argv[at + 1];
  if (!folder) {
    process.stderr.write('recheck-dates: run it as --list "<folder>".\n');
    process.exitCode = 1;
  } else list(folder);
}
