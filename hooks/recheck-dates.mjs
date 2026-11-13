#!/usr/bin/env node
// recheck-dates: SessionStart hook. Tells when a fact that can change is past its recheck date. A fact carries the
// date at the end of its line or bullet, `(recheck YYYY-MM-DD)` (in a memory note: in the body); a line without it
// never expires. Read line by line, nothing else parsed, for the session's folder: docs/facts.md, CLAUDE.md,
// HANDOFF.md, .claude/rules/*.md, the folder's memory notes (~/.claude/projects/<slug>/memory/*.md, archive/ left
// out), plus ~/.claude/CLAUDE.md and ~/.claude/rules/*.md. Files over 512 KB are skipped and counted.
// When a date is past (before today), once per folder per day (hooks/state/recheck-dates.json): a systemMessage to
// the user naming at most 3, and additionalContext to Claude with the whole list and how to offer the recheck.
// None past: silent.
// CLI: node recheck-dates.mjs --list "<folder>" prints every dated line, `<file>:<line>  <date>  past|ok  <text>`,
// then `<n> past their recheck date, <m> within it`. Used by setup-audit/memory.md and update-project's check P9.
// The stale-backup line (the backup opt-in design, docs/2026-11-12-backup-optin-design.md in the setup project) comes
// from here too, a date gone stale like the facts: only when the backup is set up (config.json in CLAUDE_BACKUP_HOME,
// else ~/.claude-backup), its last good run (last-run.json `ok: true`) is over 7 days old and a file the backup covers
// changed since. Covered: the folders in config.json less the backup's own excludes (workers/backup.mjs matcher(), so
// node_modules, chat logs and the like are never walked), walked only until the first file newer than that run. At most
// once a day, for every folder (hooks/state/recheck-dates-backup.json, written when the line is shown):
// `Backup: last good run <n> days ago and files changed since; /backup now runs one`. A last-run.json that can't be
// read, or a check that fails (a backed-up folder gone), gives one Backup: line naming why. No run yet, or a last run
// that failed: silent (it has no time of the last good run; /update-setup names a failed run).
// Fails open. RECHECK_DATES=off disables the hook (not the CLI), the backup line with it.
import { isMain, runHook } from "./lib/hook-io.mjs";
import { projectRoot } from "./lib/paths.mjs";
import { STATE_DIR, readJson, writeJson } from "./lib/state.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DATE = /\(recheck (\d{4}-\d{2}-\d{2})\)/;
const MAX_BYTES = 512 * 1024;
const NAMED = 3; // past lines named in the user's message; the rest are counted
const TEXT_CUT = 100; // characters of each line's text in Claude's list
const SHOWN = path.join(STATE_DIR, "recheck-dates.json");
const BACKUP_SHOWN = path.join(STATE_DIR, "recheck-dates-backup.json");
const DAY_MS = 24 * 60 * 60 * 1000;
const STALE_DAYS = 7;

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
export function today() {
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
export function scan(folder) {
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

// Is a file under the backed-up folders newer than `since` (ms)? Excluded paths are skipped whole; stops at the first.
function changedSince(folders, matcher, since) {
  const go = (dir, relDir, excluded) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${ent.name}` : ent.name;
      if (excluded(rel)) continue;
      const abs = path.join(dir, ent.name);
      if (
        ent.isDirectory()
          ? go(abs, rel, excluded)
          : ent.isFile() && fs.statSync(abs).mtimeMs > since
      )
        return true;
    }
    return false;
  };
  return folders.some((f) =>
    go(
      path.resolve(f.path.replace(/^~(?=$|[\\/])/, os.homedir())),
      "",
      matcher(f),
    ),
  );
}

// The stale-backup line (header), or null; once a day
async function backupLine() {
  const dir = process.env.CLAUDE_BACKUP_HOME
    ? path.resolve(process.env.CLAUDE_BACKUP_HOME)
    : path.join(os.homedir(), ".claude-backup");
  const lastFile = path.join(dir, "last-run.json");
  if (!isFile(path.join(dir, "config.json")) || !isFile(lastFile)) return null;
  const day = today();
  if (readJson(BACKUP_SHOWN, { missing: {} }).day === day) return null;
  const line = await (async () => {
    let last;
    try {
      last = JSON.parse(fs.readFileSync(lastFile, "utf8"));
    } catch (e) {
      return `Backup: ${fwd(lastFile)} could not be read (${e.message}); /backup shows why`;
    }
    const at = Date.parse(last?.time);
    if (typeof last?.ok !== "boolean" || Number.isNaN(at))
      return `Backup: ${fwd(lastFile)} has no ok (true or false) and time of the last run; /backup shows why`;
    if (!last.ok || Date.now() - at <= STALE_DAYS * DAY_MS) return null;
    try {
      const { loadConfig, matcher } = await import("../workers/backup.mjs");
      if (!changedSince(loadConfig().folders, matcher, at)) return null;
    } catch (e) {
      return `Backup: could not check for changes since the last good run (${e.message}); /backup shows why`;
    }
    return `Backup: last good run ${Math.floor((Date.now() - at) / DAY_MS)} days ago and files changed since; /backup now runs one`;
  })();
  if (line) writeJson(BACKUP_SHOWN, { day });
  return line;
}

// The past notes of the session's folder, once per folder per day: { message, context }, or null
function recheck(event) {
  const folder = path.resolve(projectRoot(event));
  const { found, skipped } = scan(folder);
  const past = found.filter((f) => f.past);
  if (!past.length) return null;
  const key = fwd(folder).toLowerCase(),
    day = today();
  const shown = readJson(SHOWN, { missing: {} });
  if (shown[key] === day) return null;
  writeJson(SHOWN, { ...shown, [key]: day });
  const named = past
    .slice(0, NAMED)
    .map((f) => `${f.at} (${f.date})`)
    .join(", ");
  const more = past.length > NAMED ? `, +${past.length - NAMED} more` : "";
  const notes =
    past.length > 1 ? `${past.length} notes here are` : "1 note here is";
  const context =
    `recheck-dates: ${notes} past their recheck date${skippedNote(skipped)}:\n` +
    past
      .map((f) => `- ${f.at} (${f.date}): ${f.text.slice(0, TEXT_CUT)}`)
      .join("\n") +
    "\nAnswer the user's request first. At the end of your first reply, add one line naming these and offering to " +
    "recheck them. Recheck one sooner only when the task relies on that fact. A recheck that confirms the fact sets a " +
    "new date (90 days out, 180 for facts about this computer); one that disproves it fixes the line and sets a new date.";
  return {
    message: `${notes} past their recheck date: ${named}${more}`,
    context,
  };
}

async function hook(event) {
  const notes = recheck(event);
  const backup = await backupLine();
  if (!notes && !backup) return;
  fs.writeSync(
    1,
    JSON.stringify({
      systemMessage: [notes?.message, backup].filter(Boolean).join("\n"),
      ...(notes
        ? {
            hookSpecificOutput: {
              hookEventName: "SessionStart",
              additionalContext: notes.context,
            },
          }
        : {}),
    }),
  );
}

if (isMain(import.meta.url)) {
  const at = process.argv.indexOf("--list");
  if (at !== -1) {
    const folder = process.argv[at + 1];
    if (!folder) {
      process.stderr.write("recheck-dates: --list needs a folder.\n");
      process.exitCode = 1;
    } else list(folder);
  } else runHook("recheck-dates", hook);
}
