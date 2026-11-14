// Board Tidy: archives finished and long-idle sessions so the Sessions board shows current work.
// pick.mjs (next to this file once installed) chooses them from Nimbalyst's database, read-only;
// this file archives each through the same call as the app's Archive button, so the board updates
// at once and Unarchive in the Archived view undoes it. Pinned sessions are never archived and
// nothing is deleted. Runs a minute after the app starts and then every hour; Claude can run it or
// undo the last run with the two tools below.

const EXTENSION_ID = "com.local.boardtidy";
const FIRST_RUN_MS = 60 * 1000;
const EVERY_MS = 60 * 60 * 1000;

const STRINGS = {
  archived:
    "Board Tidy archived {n} old sessions. Archived view → Unarchive brings one back.",
  failed: "Board Tidy could not archive sessions: {error}",
};

let extensionPath = null;
let ui = null;
let timers = [];
let running = false;
let errorShown = false;

const say = (text, n) => text.replace("{n}", String(n));
const b64 = (value) =>
  btoa(unescape(encodeURIComponent(JSON.stringify(value))));

async function exec(args) {
  if (!extensionPath) throw new Error("Board Tidy is not active yet");
  const script = `${extensionPath.replace(/\\/g, "/")}/pick.mjs`;
  const r = await window.electronAPI.invoke("extension:exec", {
    extensionId: EXTENSION_ID,
    command: `node "${script}" ${args}`,
    timeout: 30000,
  });
  if (!r.success)
    throw new Error(
      (r.stderr || "").trim().split("\n").pop() ||
        `pick.mjs exit code ${r.exitCode}`,
    );
  return JSON.parse(r.stdout);
}

/** Archive (or unarchive) each id through the app's own call; returns the ids that worked and the errors. */
async function setArchived(ids, isArchived) {
  const done = [];
  const errors = [];
  for (const id of ids) {
    try {
      const r = await window.electronAPI.invoke(
        "sessions:update-metadata",
        id,
        { isArchived },
      );
      if (r && r.success === false) errors.push(`${id}: ${r.error}`);
      else done.push(id);
    } catch (e) {
      errors.push(`${id}: ${e && e.message ? e.message : e}`);
    }
  }
  return { done, errors };
}

/** Quotes a folder for the pick.mjs command line. A trailing slash or backslash is dropped (a trailing
 * backslash would escape the closing quote on Windows); a folder holding a quote, backtick or $ is
 * refused, since a shell would read it. */
export const q = (s) => {
  const p = String(s).replace(/[\\/]+$/, "");
  if (/["`$]/.test(p))
    throw new Error(
      `a project folder may not contain " or a backtick or $: ${s}`,
    );
  return `"${p}"`;
};

/** One tidy run. `force` skips the 50-minute gap; `dryRun` only lists what would go; `project` +
 * `olderThanDays` is a run asked for in one project (kept or not). */
async function tidy({
  force = false,
  dryRun = false,
  reason = "timer",
  project = null,
  olderThanDays = null,
} = {}) {
  if (running) return { skipped: "a run is already going" };
  running = true;
  try {
    const scope = project
      ? ` --project ${q(project)} --older-than ${Number(olderThanDays)}`
      : "";
    // pick.mjs logs the run before anything is archived, so undo works even if this stops half-way
    const choice = await exec(
      (dryRun ? "--dry" : `${force ? "--force " : ""}--reason ${reason}`) +
        scope,
    );
    if (choice.skipped) return { skipped: choice.skipped };
    const ids = choice.picked.map((p) => p.id);
    if (dryRun)
      return {
        wouldArchive: ids.length,
        counts: choice.counts,
        sample: choice.picked.slice(0, 20),
      };
    if (!ids.length) return { archived: 0 };
    const { done, errors } = await setArchived(ids, true);
    if (done.length && ui) ui.showInfo(say(STRINGS.archived, done.length));
    if (errors.length)
      console.error("[board-tidy] some sessions were not archived:", errors);
    return {
      archived: done.length,
      counts: choice.counts,
      failed: errors,
      run: choice.run,
    };
  } finally {
    running = false;
  }
}

async function timedTidy() {
  try {
    await tidy();
  } catch (e) {
    console.error("[board-tidy]", e);
    if (errorShown) return; // once per app start, not every hour
    errorShown = true;
    if (ui)
      ui.showError(
        STRINGS.failed.replace(
          "{error}",
          e && e.message ? e.message : String(e),
        ),
      );
  }
}

const aiTools = [
  {
    name: "board_tidy.archive",
    description:
      'Archive old sessions on the Nimbalyst Sessions board, in every project but the kept ones (board_tidy.keep): Complete with no activity for 3 days, no phase for 14 days, planning/validating/implementing for 30 days. Never pinned, running or worktree sessions, never deletes. Board Tidy also does this hourly by itself. With project and olderThanDays it archives only in that project (kept or not), any phase but backlog idle that long: for "archive what is older than 6 months there". dryRun: true only lists what would go.',
    scope: "global",
    access: { kind: "filesystem" },
    inputSchema: {
      type: "object",
      properties: {
        dryRun: {
          type: "boolean",
          description: "List what would be archived, change nothing",
        },
        project: {
          type: "string",
          description: "Only this project folder (needs olderThanDays)",
        },
        olderThanDays: {
          type: "number",
          description: "With project: archive sessions idle this many days",
        },
      },
    },
    handler: async (args) => {
      try {
        const a = args || {};
        if (a.project && !(Number(a.olderThanDays) > 0))
          return {
            success: false,
            error: "project needs olderThanDays (days above 0)",
          };
        if (!a.project && a.olderThanDays != null)
          return {
            success: false,
            error: "olderThanDays needs project (the folder to archive in)",
          };
        return {
          success: true,
          data: await tidy({
            force: true,
            dryRun: !!a.dryRun,
            reason: "tool",
            project: a.project || null,
            olderThanDays: a.olderThanDays,
          }),
        };
      } catch (e) {
        return {
          success: false,
          error: String(e && e.message ? e.message : e),
        };
      }
    },
  },
  {
    name: "board_tidy.undo",
    description:
      "Unarchive every session that the last Board Tidy run archived (the newest run not undone yet).",
    scope: "global",
    access: { kind: "filesystem" },
    inputSchema: { type: "object", properties: {} },
    handler: async () => {
      try {
        const { run } = await exec("--last");
        if (!run)
          return {
            success: true,
            data: { unarchived: 0, note: "no Board Tidy run to undo" },
          };
        const { done, errors } = await setArchived(run.ids, false);
        // The app unarchives a whole subtree; sessions under them that were archived before the run go back
        const again = await setArchived(run.keepArchived || [], true);
        errors.push(...again.errors);
        if (!errors.length) await exec(`--undone ${b64({ at: run.at })}`);
        return {
          success: errors.length === 0,
          data: {
            unarchived: done.length,
            archivedAgain: again.done.length,
            run: run.at,
            failed: errors,
          },
        };
      } catch (e) {
        return {
          success: false,
          error: String(e && e.message ? e.message : e),
        };
      }
    },
  },
  {
    name: "board_tidy.unarchive",
    description:
      "Unarchive every archived session of one project folder (by Board Tidy or by hand), e.g. to bring back the old chats of a project that should keep them all.",
    scope: "global",
    access: { kind: "filesystem" },
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "The project folder" },
      },
      required: ["project"],
    },
    handler: async (args) => {
      try {
        if (!args || !args.project)
          return { success: false, error: "project is needed" };
        const { ids } = await exec(`--archived-in ${q(args.project)}`);
        const { done, errors } = await setArchived(ids, false);
        return {
          success: errors.length === 0,
          data: { unarchived: done.length, failed: errors },
        };
      } catch (e) {
        return {
          success: false,
          error: String(e && e.message ? e.message : e),
        };
      }
    },
  },
  {
    name: "board_tidy.keep",
    description:
      "Set whether Board Tidy leaves a project alone: keep: true means its sessions are never archived on their own (a chat-style project where every old chat stays findable); keep: false gives it the hourly tidy again. Without project it lists the kept projects.",
    scope: "global",
    access: { kind: "filesystem" },
    inputSchema: {
      type: "object",
      properties: {
        project: { type: "string", description: "The project folder" },
        keep: { type: "boolean" },
      },
    },
    handler: async (args) => {
      try {
        const a = args || {};
        if (!a.project)
          return { success: true, data: await exec("--keep-list") };
        return {
          success: true,
          data: await exec(
            `${a.keep === false ? "--unkeep" : "--keep"} ${q(a.project)}`,
          ),
        };
      } catch (e) {
        return {
          success: false,
          error: String(e && e.message ? e.message : e),
        };
      }
    },
  },
];

function activate(context) {
  if (window.__boardTidy && window.__boardTidy.deactivate !== deactivate)
    window.__boardTidy.deactivate();
  window.__boardTidy = { deactivate, tidy };
  extensionPath = context.extensionPath;
  ui = context.services && context.services.ui;
  timers = [
    setTimeout(timedTidy, FIRST_RUN_MS),
    setInterval(timedTidy, EVERY_MS),
  ];
}

function deactivate() {
  for (const t of timers) {
    clearTimeout(t);
    clearInterval(t);
  }
  timers = [];
}

export { activate, aiTools, deactivate, STRINGS };
