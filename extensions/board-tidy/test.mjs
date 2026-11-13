// Checks Board Tidy: the chooser's rules (phases and days, pinned, running, worktree, whole subtree,
// parent covers child), the command line against a scratch database (read-only, 50-minute gap, dry
// run, log, undo), and the build (manifest, exports, Russian words). Run: node test.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { pickSessions, ownReason, toMs } from './pick.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
let pass = 0;
let fail = 0;
const check = (name, ok) => {
  if (ok) pass++;
  else { fail++; console.log(`FAIL ${name}`); }
};

const NOW = Date.parse('2026-11-05T12:00:00Z');
const ago = (days) => new Date(NOW - days * 864e5).toISOString();
const row = (id, o = {}) => ({ id, workspace_id: 'C:\\p', title: id, status: 'idle', last_activity: ago(10), created_at: ago(40),
  worktree_id: null, parent_session_id: null, is_pinned: 0, is_archived: 0, phase: 'complete', ...o });
const ids = (rows) => pickSessions(rows, NOW).picked.map((p) => p.id).sort().join(',');

// Rules by phase
check('complete after 3 days', ids([row('a', { last_activity: ago(3.1) })]) === 'a');
check('complete under 3 days stays', ids([row('a', { last_activity: ago(2.9) })]) === '');
check('no phase after 14 days', ids([row('a', { phase: null, last_activity: ago(15) }), row('b', { phase: null, last_activity: ago(13) })]) === 'a');
for (const p of ['planning', 'validating', 'implementing']) {
  check(`${p} after 30 days`, ids([row('a', { phase: p, last_activity: ago(31) }), row('b', { phase: p, last_activity: ago(29) })]) === 'a');
}
check('backlog never', ids([row('a', { phase: 'backlog', last_activity: ago(400) })]) === '');
check('unknown phase never', ids([row('a', { phase: 'someday', last_activity: ago(400) })]) === '');

// Never touched
check('pinned stays', ids([row('a', { is_pinned: 1 })]) === '');
check('running stays', ids([row('a', { status: 'running' })]) === '');
check('waiting for input stays', ids([row('a', { status: 'waiting_for_input' })]) === '');
check('worktree session stays', ids([row('a', { worktree_id: 'w1' })]) === '');
check('already archived is not picked again', ids([row('a', { is_archived: 1 })]) === '');

// Subtrees: archiving a parent archives its children
check('parent covers its old children', ids([row('p'), row('c1', { parent_session_id: 'p' }), row('c2', { parent_session_id: 'c1' })]) === 'p');
check('a pinned child keeps its parent', ids([row('p'), row('c', { parent_session_id: 'p', is_pinned: 1 })]) === '');
check('a fresh grandchild keeps the whole chain', ids([row('p'), row('c', { parent_session_id: 'p' }), row('g', { parent_session_id: 'c', last_activity: ago(1) })]) === '');
check('old child of a fresh parent goes alone', ids([row('p', { last_activity: ago(1) }), row('c', { parent_session_id: 'p' })]) === 'c');
check('archived child does not block the parent', ids([row('p'), row('c', { parent_session_id: 'p', is_archived: 1, is_pinned: 1 })]) === 'p');
check('archived grandchild is listed for undo', pickSessions([row('p'), row('c', { parent_session_id: 'p' }), row('g', { parent_session_id: 'c', is_archived: 1 })], NOW).keepArchived.join() === 'g');
check('broken metadata stays', ids([row('a', { bad_meta: 1 })]) === '');
check('child of a missing parent is judged alone', ids([row('c', { parent_session_id: 'gone' })]) === 'c');
check('parent loop is an error', (() => { try { pickSessions([row('a', { parent_session_id: 'b' }), row('b', { parent_session_id: 'a' })], NOW); return false; } catch (e) { return /loop/.test(e.message); } })());

// Timestamps
check('sqlite CURRENT_TIMESTAMP is UTC', toMs('2026-11-05 10:00:00') === Date.parse('2026-11-05T10:00:00Z'));
check('missing last_activity uses created_at', ownReason(row('a', { last_activity: null, created_at: ago(5) }), NOW) === 'complete');
check('no readable time is an error', (() => { try { ownReason(row('a', { last_activity: null, created_at: null }), NOW); return false; } catch { return true; } })());
const counts = pickSessions([row('a'), row('b', { phase: null, last_activity: ago(20) })], NOW).counts;
check('counts by reason', counts.complete === 1 && counts.none === 1);

// Command line against a scratch database
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'board-tidy-'));
const dbPath = path.join(tmp, 'nimbalyst.sqlite');
const db = new DatabaseSync(dbPath);
db.exec(`CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT, title TEXT, status TEXT, last_activity TEXT, created_at TEXT,
  worktree_id TEXT, parent_session_id TEXT, is_pinned INTEGER, is_archived INTEGER, metadata TEXT)`);
const ins = db.prepare('INSERT INTO ai_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?)');
const old = new Date(Date.now() - 10 * 864e5).toISOString();
ins.run('old', 'C:\\p', 'Old done', 'idle', old, old, null, null, 0, 0, JSON.stringify({ phase: 'complete' }));
ins.run('pin', 'C:\\p', 'Pinned', 'idle', old, old, null, null, 1, 0, JSON.stringify({ phase: 'complete' }));
ins.run('new', 'C:\\p', 'New done', 'idle', new Date().toISOString(), old, null, null, 0, 0, JSON.stringify({ phase: 'complete' }));
ins.run('kid', 'C:\\p', 'Archived by hand', 'idle', old, old, null, 'old', 0, 1, JSON.stringify({ phase: 'complete' }));
ins.run('bad', 'C:\\p', 'Broken metadata', 'idle', old, old, null, null, 0, 0, '{not json');
ins.run('bare', 'C:\\p', 'No metadata', 'idle', new Date(Date.now() - 20 * 864e5).toISOString(), old, null, null, 0, 0, null);
db.close();
const before = fs.readFileSync(dbPath);
const env = { ...process.env, BOARD_TIDY_DB: dbPath, BOARD_TIDY_STATE: path.join(tmp, 'state') };
const cli = (...args) => {
  const r = spawnSync(process.execPath, [path.join(here, 'pick.mjs'), ...args], { encoding: 'utf8', env });
  if (r.status !== 0) throw new Error(`pick.mjs ${args.join(' ')} failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
};
const b64 = (v) => Buffer.from(JSON.stringify(v)).toString('base64');
const state = (f) => path.join(tmp, 'state', f);
const dry = cli('--dry');
check('cli: picks the old unpinned one and the bare one, not broken metadata', dry.picked.map((p) => p.id).sort().join() === 'bare,old');
check('cli: no metadata counts as no phase', dry.counts.none === 1 && dry.counts.complete === 1);
check('cli: dry run leaves no last-run time and no log', !fs.existsSync(state('board-tidy-last.json')) && !fs.existsSync(state('board-tidy.jsonl')));
check('cli: no run to undo before a run', cli('--last').run === null);
const first = cli('--reason', 'test');
check('cli: first real run picks', first.picked.length === 2 && typeof first.run === 'string');
const logged = cli('--last').run;
check('cli: the run is logged before anything is archived', logged.at === first.run && logged.ids.sort().join() === 'bare,old' && logged.reason === 'test');
check('cli: a hand-archived child is kept for undo', logged.keepArchived.join() === 'kid');
check('cli: second run within 50 minutes skips', /50 minutes/.test(cli().skipped || ''));
fs.writeFileSync(state('board-tidy.lock'), '');
check('cli: a fresh lock from another window skips even with --force', /another window/.test(cli('--force').skipped || ''));
fs.utimesSync(state('board-tidy.lock'), new Date(Date.now() - 5 * 60e3), new Date(Date.now() - 5 * 60e3));
const forced = cli('--force');
check('cli: a stale lock is taken over, --force runs anyway', forced.picked.length === 2 && !fs.existsSync(state('board-tidy.lock')));
check('cli: database is not written', Buffer.compare(before, fs.readFileSync(dbPath)) === 0);
check('cli: last run is the newest', cli('--last').run.at === forced.run);
cli('--undone', b64({ at: forced.run }));
check('cli: after undo the run before it is last', cli('--last').run.at === first.run);
cli('--undone', b64({ at: first.run }));
check('cli: after both undos nothing is left', cli('--last').run === null);
const many = Array.from({ length: 1500 }, (_, i) => ['m' + i, 'C:\\p', 't', 'idle', old, old, null, null, 0, 0, JSON.stringify({ phase: 'complete' })]);
const db2 = new DatabaseSync(dbPath);
for (const r of many) db2.prepare('INSERT INTO ai_sessions VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(...r);
db2.close();
const big = cli('--force');
check('cli: a run of 1500 sessions is logged whole', big.picked.length === 1502 && cli('--last').run.ids.length === 1502);
const missing = spawnSync(process.execPath, [path.join(here, 'pick.mjs'), '--force'], { encoding: 'utf8', env: { ...env, BOARD_TIDY_DB: path.join(tmp, 'nope.sqlite') } });
check('cli: missing database is a clear error', missing.status === 1 && /database not found/.test(missing.stderr));
fs.rmSync(tmp, { recursive: true, force: true });

// Build
const build = (lang) => {
  const r = spawnSync(process.execPath, ['build.mjs'], { cwd: here, encoding: 'utf8', env: { ...process.env, SETUP_LANGUAGE: lang } });
  if (r.status !== 0) throw new Error(`build (${lang}) failed: ${r.stderr}`);
};
build('russian');
const ru = await import(pathToFileURL(path.join(here, 'dist', 'index.js')).href + `?ru=${Date.now()}`);
check('russian: words swapped', /архив/.test(ru.STRINGS.archived) && /архив/.test(ru.STRINGS.failed));
build('english');
const en = await import(pathToFileURL(path.join(here, 'dist', 'index.js')).href + `?en=${Date.now()}`);
check('russian: same keys and placeholders', Object.keys(ru.STRINGS).join() === Object.keys(en.STRINGS).join()
  && ru.STRINGS.archived.includes('{n}') && ru.STRINGS.failed.includes('{error}'));
check('exports activate, deactivate, aiTools', typeof en.activate === 'function' && typeof en.deactivate === 'function' && Array.isArray(en.aiTools));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
check('manifest id', manifest.id === 'com.local.boardtidy');
check('manifest main exists', fs.existsSync(path.join(here, manifest.main)));
check('manifest tools match the code', manifest.contributions.aiTools.join() === en.aiTools.map((t) => t.name).join());
check('manifest asks for filesystem and ai', manifest.permissions.filesystem === true && manifest.permissions.ai === true);
check('extension id in the code matches', fs.readFileSync(path.join(here, 'src', 'index.js'), 'utf8').includes(`'${manifest.id}'`));

console.log(`${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
