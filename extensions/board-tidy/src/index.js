// Board Tidy: archives finished and long-idle sessions so the Sessions board shows current work.
// pick.mjs (next to this file once installed) chooses them from Nimbalyst's database, read-only;
// this file archives each through the same call as the app's Archive button, so the board updates
// at once and Unarchive in the Archived view undoes it. Pinned sessions are never archived and
// nothing is deleted. Runs a minute after the app starts and then every hour; Claude can run it or
// undo the last run with the two tools below.

const EXTENSION_ID = 'com.local.boardtidy';
const FIRST_RUN_MS = 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;

const STRINGS = {
  archived: 'Board Tidy archived {n} old sessions. Archived view → Unarchive brings one back.',
  failed: 'Board Tidy could not archive sessions: {error}',
};

let extensionPath = null;
let ui = null;
let timers = [];
let running = false;
let errorShown = false;

const say = (text, n) => text.replace('{n}', String(n));
const b64 = (value) => btoa(unescape(encodeURIComponent(JSON.stringify(value))));

async function exec(args) {
  if (!extensionPath) throw new Error('Board Tidy is not active yet');
  const script = `${extensionPath.replace(/\\/g, '/')}/pick.mjs`;
  const r = await window.electronAPI.invoke('extension:exec', {
    extensionId: EXTENSION_ID,
    command: `node "${script}" ${args}`,
    timeout: 30000,
  });
  if (!r.success) throw new Error((r.stderr || '').trim().split('\n').pop() || `pick.mjs exit code ${r.exitCode}`);
  return JSON.parse(r.stdout);
}

/** Archive (or unarchive) each id through the app's own call; returns the ids that worked and the errors. */
async function setArchived(ids, isArchived) {
  const done = [];
  const errors = [];
  for (const id of ids) {
    try {
      const r = await window.electronAPI.invoke('sessions:update-metadata', id, { isArchived });
      if (r && r.success === false) errors.push(`${id}: ${r.error}`);
      else done.push(id);
    } catch (e) {
      errors.push(`${id}: ${e && e.message ? e.message : e}`);
    }
  }
  return { done, errors };
}

/** One tidy run. `force` skips the 50-minute gap; `dryRun` only lists what would go. */
async function tidy({ force = false, dryRun = false, reason = 'timer' } = {}) {
  if (running) return { skipped: 'a run is already going' };
  running = true;
  try {
    // pick.mjs logs the run before anything is archived, so undo works even if this stops half-way
    const choice = await exec(dryRun ? '--dry' : `${force ? '--force ' : ''}--reason ${reason}`);
    if (choice.skipped) return { skipped: choice.skipped };
    const ids = choice.picked.map((p) => p.id);
    if (dryRun) return { wouldArchive: ids.length, counts: choice.counts, sample: choice.picked.slice(0, 20) };
    if (!ids.length) return { archived: 0 };
    const { done, errors } = await setArchived(ids, true);
    if (done.length && ui) ui.showInfo(say(STRINGS.archived, done.length));
    if (errors.length) console.error('[board-tidy] some sessions were not archived:', errors);
    return { archived: done.length, counts: choice.counts, failed: errors, run: choice.run };
  } finally {
    running = false;
  }
}

async function timedTidy() {
  try {
    await tidy();
  } catch (e) {
    console.error('[board-tidy]', e);
    if (errorShown) return; // once per app start, not every hour
    errorShown = true;
    if (ui) ui.showError(STRINGS.failed.replace('{error}', e && e.message ? e.message : String(e)));
  }
}

const aiTools = [
  {
    name: 'board_tidy.archive',
    description:
      'Archive old sessions on the Nimbalyst Sessions board, in every project: Complete with no activity for 3 days, no phase for 14 days, planning/validating/implementing for 30 days. Never pinned, running or worktree sessions, never deletes. Board Tidy also does this hourly by itself. dryRun: true only lists what would go.',
    scope: 'global',
    access: { kind: 'filesystem' },
    inputSchema: {
      type: 'object',
      properties: { dryRun: { type: 'boolean', description: 'List what would be archived, change nothing' } },
    },
    handler: async (args) => {
      try {
        return { success: true, data: await tidy({ force: true, dryRun: !!(args && args.dryRun), reason: 'tool' }) };
      } catch (e) {
        return { success: false, error: String(e && e.message ? e.message : e) };
      }
    },
  },
  {
    name: 'board_tidy.undo',
    description: 'Unarchive every session that the last Board Tidy run archived (the newest run not undone yet).',
    scope: 'global',
    access: { kind: 'filesystem' },
    inputSchema: { type: 'object', properties: {} },
    handler: async () => {
      try {
        const { run } = await exec('--last');
        if (!run) return { success: true, data: { unarchived: 0, note: 'no Board Tidy run to undo' } };
        const { done, errors } = await setArchived(run.ids, false);
        // The app unarchives a whole subtree; sessions under them that were archived before the run go back
        const again = await setArchived(run.keepArchived || [], true);
        errors.push(...again.errors);
        if (!errors.length) await exec(`--undone ${b64({ at: run.at })}`);
        return { success: errors.length === 0, data: { unarchived: done.length, archivedAgain: again.done.length, run: run.at, failed: errors } };
      } catch (e) {
        return { success: false, error: String(e && e.message ? e.message : e) };
      }
    },
  },
];

function activate(context) {
  if (window.__boardTidy && window.__boardTidy.deactivate !== deactivate) window.__boardTidy.deactivate();
  window.__boardTidy = { deactivate, tidy };
  extensionPath = context.extensionPath;
  ui = context.services && context.services.ui;
  timers = [setTimeout(timedTidy, FIRST_RUN_MS), setInterval(timedTidy, EVERY_MS)];
}

function deactivate() {
  for (const t of timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  timers = [];
}

export { activate, deactivate, aiTools, STRINGS };
