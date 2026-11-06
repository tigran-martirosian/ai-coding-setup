// Board Tidy's chooser: which Nimbalyst sessions are old enough to archive. It reads Nimbalyst's
// session database read-only (it never writes there; the extension archives through the app's own
// call) and keeps a log of every archive run so each one can be undone.
//   node pick.mjs [--force] [--dry] [--reason <word>] [--db <path>]
//                                             print {picked, counts, run} as JSON and log the run
//                                             before anything is archived; without --force, nothing
//                                             when the last run was under 50 minutes ago; --dry only
//                                             prints (no log, last-run time left alone)
//   node pick.mjs --last                      print the newest logged run that was not undone
//   node pick.mjs --undone <base64 JSON>      mark the run with that `at` as undone
// Env: BOARD_TIDY_DB (database file), BOARD_TIDY_STATE (folder for the log and last-run file).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DAY = 864e5;
// Days without activity before a session is archived, by its board phase.
// backlog is never archived: it is work not started yet.
export const RULES = { complete: 3, none: 14, planning: 30, validating: 30, implementing: 30 };
const BUSY = new Set(['running', 'waiting_for_input']);
const MIN_GAP_MS = 50 * 60 * 1000;

/** SQLite's CURRENT_TIMESTAMP ("YYYY-MM-DD HH:MM:SS", UTC) or an ISO string, as milliseconds. */
export function toMs(value) {
  if (value == null || value === '') return NaN;
  if (typeof value === 'number') return value;
  const s = String(value);
  return Date.parse(/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? s : s.replace(' ', 'T') + 'Z');
}

/** Why one session may go on its own (ignoring its children), or null when it must stay. */
export function ownReason(row, now, rules = RULES) {
  if (row.is_archived) return null;
  if (row.is_pinned) return null;
  if (BUSY.has(row.status)) return null;
  if (row.worktree_id) return null; // the app archives these with their worktree (git clean-up)
  if (row.bad_meta) return null; // metadata the app may not read either: leave it alone
  const phase = row.phase || 'none';
  const days = rules[phase];
  if (days == null) return null;
  const last = toMs(row.last_activity);
  const at = Number.isNaN(last) ? toMs(row.created_at) : last;
  if (Number.isNaN(at)) throw new Error(`session ${row.id} has no readable last_activity or created_at`);
  return now - at >= days * DAY ? phase : null;
}

/**
 * The sessions to archive. Archiving a session in Nimbalyst also archives everything under it, so a
 * session is picked only when it and every unarchived session under it may go. A picked session whose
 * parent is also picked is left out (the parent's archive covers it).
 */
export function pickSessions(rows, now, rules = RULES) {
  const byId = new Map(rows.map((r) => [r.id, r]));
  const children = new Map();
  for (const r of rows) {
    if (!r.parent_session_id || !byId.has(r.parent_session_id)) continue;
    if (!children.has(r.parent_session_id)) children.set(r.parent_session_id, []);
    children.get(r.parent_session_id).push(r);
  }
  const memo = new Map();
  const whole = (r, seen = new Set()) => {
    if (memo.has(r.id)) return memo.get(r.id);
    if (seen.has(r.id)) throw new Error(`session parent loop at ${r.id}`);
    seen.add(r.id);
    let ok = ownReason(r, now, rules) !== null;
    for (const c of children.get(r.id) || []) {
      if (c.is_archived) continue;
      if (!whole(c, seen)) ok = false;
    }
    memo.set(r.id, ok);
    return ok;
  };
  const picked = [];
  const counts = {};
  // Archived sessions under a picked one: the app unarchives a whole subtree, so an undo must archive these again
  const keepArchived = [];
  const collect = (r) => {
    for (const c of children.get(r.id) || []) {
      if (c.is_archived) keepArchived.push(c.id);
      collect(c);
    }
  };
  for (const r of rows) {
    if (r.is_archived || !whole(r)) continue;
    const parent = byId.get(r.parent_session_id);
    if (parent && !parent.is_archived && whole(parent)) continue;
    const reason = ownReason(r, now, rules);
    picked.push({ id: r.id, workspace: r.workspace_id, title: r.title, reason });
    counts[reason] = (counts[reason] || 0) + 1;
    collect(r);
  }
  return { picked, counts, keepArchived };
}

function defaultDb() {
  if (process.env.BOARD_TIDY_DB) return process.env.BOARD_TIDY_DB;
  const base = process.platform === 'win32'
    ? process.env.APPDATA
    : process.platform === 'darwin'
      ? path.join(os.homedir(), 'Library', 'Application Support')
      : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  if (!base) throw new Error('APPDATA is not set, so the Nimbalyst database cannot be found');
  return path.join(base, '@nimbalyst', 'electron', 'sqlite-db', 'nimbalyst.sqlite');
}

const stateDir = () => process.env.BOARD_TIDY_STATE || path.join(os.homedir(), '.claude', 'state');
const logFile = () => path.join(stateDir(), 'board-tidy.jsonl');
const lastFile = () => path.join(stateDir(), 'board-tidy-last.json');
const lockFile = () => path.join(stateDir(), 'board-tidy.lock');
const LOCK_STALE_MS = 2 * 60 * 1000;

/** Only one process at a time checks and sets the last-run time (two windows start together). */
function withLock(fn) {
  try {
    fs.closeSync(fs.openSync(lockFile(), 'wx'));
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    if (Date.now() - fs.statSync(lockFile()).mtimeMs < LOCK_STALE_MS) return { picked: [], counts: {}, skipped: 'another window is running it' };
    fs.rmSync(lockFile(), { force: true });
    return withLock(fn);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => fs.rmSync(lockFile(), { force: true }));
}

async function readRows(dbPath) {
  if (!fs.existsSync(dbPath)) throw new Error(`Nimbalyst database not found: ${dbPath}`);
  let sqlite;
  try {
    sqlite = await import('node:sqlite');
  } catch {
    throw new Error(`Board Tidy needs Node 22.5 or newer for node:sqlite (this is ${process.version})`);
  }
  const db = new sqlite.DatabaseSync(dbPath, { readOnly: true });
  try {
    return db.prepare(`SELECT id, workspace_id, title, status, last_activity, created_at, worktree_id,
      parent_session_id, is_pinned, is_archived, CASE WHEN metadata IS NULL OR metadata = '' THEN NULL WHEN json_valid(metadata) THEN json_extract(metadata, '$.phase') END AS phase,
      (metadata IS NOT NULL AND metadata <> '' AND NOT json_valid(metadata)) AS bad_meta FROM ai_sessions`).all();
  } finally {
    db.close();
  }
}

function readLog() {
  if (!fs.existsSync(logFile())) return [];
  return fs.readFileSync(logFile(), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
}

const decode = (b64) => JSON.parse(Buffer.from(b64, 'base64').toString('utf8'));

async function main(argv) {
  fs.mkdirSync(stateDir(), { recursive: true });
  const flag = argv[0];
  if (flag === '--last') {
    const undone = new Set(readLog().filter((r) => r.undoneAt).map((r) => r.undoes));
    const runs = readLog().filter((r) => Array.isArray(r.ids) && r.ids.length && !r.undoes && !undone.has(r.at));
    return { run: runs[runs.length - 1] || null };
  }
  if (flag === '--undone') {
    const { at } = decode(argv[1]);
    fs.appendFileSync(logFile(), JSON.stringify({ undoes: at, undoneAt: new Date().toISOString() }) + '\n');
    return { undone: at };
  }
  const force = argv.includes('--force');
  const dry = argv.includes('--dry');
  const dbAt = argv.indexOf('--db');
  const reasonAt = argv.indexOf('--reason');
  const db = dbAt >= 0 ? argv[dbAt + 1] : defaultDb();
  if (dry) return pickSessions(await readRows(db), Date.now());
  return withLock(async () => {
    const now = Date.now();
    if (!force && fs.existsSync(lastFile())) {
      const last = JSON.parse(fs.readFileSync(lastFile(), 'utf8'));
      if (now - toMs(last.at) < MIN_GAP_MS) return { picked: [], counts: {}, skipped: 'ran under 50 minutes ago' };
    }
    const out = pickSessions(await readRows(db), now);
    const at = new Date(now).toISOString();
    fs.writeFileSync(lastFile(), JSON.stringify({ at }));
    // Logged before the extension archives anything, so a run cut off half-way can still be undone
    // (unarchiving a session that was never archived changes nothing)
    if (out.picked.length) {
      const run = { at, reason: reasonAt >= 0 ? argv[reasonAt + 1] : 'run', ids: out.picked.map((p) => p.id), keepArchived: out.keepArchived };
      fs.appendFileSync(logFile(), JSON.stringify(run) + '\n');
    }
    return { ...out, run: at };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (out) => process.stdout.write(JSON.stringify(out)),
    (e) => {
      process.stderr.write(String(e && e.message ? e.message : e) + '\n');
      process.exit(1);
    },
  );
}
