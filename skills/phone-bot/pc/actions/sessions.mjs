// Session lists (actions 5 to 8 and 35 of the PC program design): Home's "needs you" and "working", a project's
// sessions 20 a page with Nimbalyst's pinned ones first, today's finished ones, hiding a session from the
// phone's lists, and pinning one in Nimbalyst. Hidden session ids are kept in the state file, so every paired
// phone sees the same lists.
import {
  knownSession,
  needsRows,
  sessionsPage,
  sessionsUpdatedSince,
} from "../core/db.mjs";
import {
  listProjects,
  mapState,
  needTool,
  PROJECT_INPUT,
  projectByHandle,
  SESSION_INPUT,
  setSessionPinned,
  watchDoor,
} from "../core/door.mjs";
import { readState, updateState } from "../core/state.mjs";
import { pending } from "./questions.mjs";

const PAGE_SIZE = 20;
const DAY_MS = 24 * 3600 * 1000;
// A waiting session older than this leaves Home's "needs you".
const STALE_WAIT_MS = 2 * DAY_MS;

const hiddenIds = () => readState().hidden || [];

function localMidnight() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function metadataOf(row) {
  try {
    return JSON.parse(row.metadata);
  } catch {
    throw new Error(`session ${row.id}: metadata is not valid JSON`);
  }
}

// The rows of every project the door lists, with the project's handle.
function listedRows(rows) {
  const byPath = new Map(listProjects().map((p) => [p.path, p.project]));
  return rows
    .filter((r) => byPath.has(r.workspace_id))
    .map((r) => ({ ...r, project: byPath.get(r.workspace_id) }));
}

// The day's rows.
const recentRows = () =>
  listedRows(
    sessionsUpdatedSince(
      new Date(Date.now() - DAY_MS).toISOString(),
      hiddenIds(),
    ),
  );

const finishedRows = (rows) => {
  const midnight = localMidnight();
  return rows.filter(
    (r) => mapState(r.status) === "idle" && r.updated_at >= midnight,
  );
};

export function register(registry) {
  watchDoor();

  registry.add({
    name: "home.sessions",
    run: async () => {
      const rows = recentRows();
      // Needs you by the rule Projects counts by, less the ones waiting longer than 48 hours: those stay in
      // their project only. The wait counts from the session's last activity (updated_at).
      const needs = listedRows(needsRows(hiddenIds()));
      const staleBefore = new Date(Date.now() - STALE_WAIT_MS).toISOString();
      const needsYou = [];
      for (const r of needs) {
        if (r.updated_at < staleBefore) continue;
        const p = await pending(r.workspace_id, r.id);
        needsYou.push({
          session: r.id,
          project: r.project,
          title: r.title,
          kind: p ? p.kind : "on-pc",
          since: r.updated_at,
        });
      }
      const needIds = new Set(needs.map((r) => r.id));
      const working = [];
      for (const r of rows) {
        if (needIds.has(r.id)) continue;
        if (mapState(r.status) === "running") {
          const m = metadataOf(r);
          const tasks = Array.isArray(m.currentTasks) ? m.currentTasks : [];
          working.push({
            session: r.id,
            project: r.project,
            title: r.title,
            doing: typeof m.phase === "string" ? m.phase : null,
            since: r.updated_at,
            helpers: tasks.filter((t) => t?.status === "running").length,
          });
        }
      }
      return { needsYou, working, finishedToday: finishedRows(rows).length };
    },
  });

  registry.add({
    name: "sessions.list",
    input: {
      project: PROJECT_INPUT,
      page: { type: "integer", min: 1, max: 100000 },
    },
    run: async (d) => {
      const project = projectByHandle(d.project);
      const { rows, total } = sessionsPage(
        project.path,
        hiddenIds(),
        PAGE_SIZE,
        (d.page - 1) * PAGE_SIZE,
      );
      const items = [];
      for (const r of rows) {
        const state = mapState(r.status);
        const p =
          state === "waiting" ? await pending(project.path, r.id) : null;
        items.push({
          session: r.id,
          title: r.title,
          state,
          kind: state === "waiting" ? (p ? p.kind : "on-pc") : null,
          updatedAt: r.updated_at,
          pinned: r.is_pinned === 1,
        });
      }
      return { items, page: d.page, total };
    },
  });

  // A session pin is Nimbalyst's own (PN1): the door patch's set_session_pinned saves it, nothing is kept here.
  registry.add({
    name: "sessions.pin",
    input: { session: SESSION_INPUT, pinned: { type: "boolean" } },
    run: async (d) => {
      const { project } = knownSession(d.session);
      await needTool("set_session_pinned");
      await setSessionPinned(project.path, d.session, d.pinned);
      return { pinned: d.pinned };
    },
  });

  registry.add({
    name: "sessions.finished",
    run: () =>
      finishedRows(recentRows()).map((r) => ({
        session: r.id,
        project: r.project,
        title: r.title,
        kind: null,
        since: r.updated_at,
      })),
  });

  registry.add({
    name: "sessions.hide",
    input: { session: SESSION_INPUT, hidden: { type: "boolean" } },
    run: (d) => {
      knownSession(d.session);
      updateState((s) => {
        const set = new Set(s.hidden || []);
        if (d.hidden) set.add(d.session);
        else set.delete(d.session);
        s.hidden = [...set].sort();
      });
      return { hidden: d.hidden };
    },
  });
}
