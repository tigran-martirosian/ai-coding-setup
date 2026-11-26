// Jobs on Home (PC program design, section 3, action 31; plan row C4). The PC sends each project's tracker items
// and the running sessions' links; the page groups them with the job tracker's own model.js (served with the page,
// phone/page/build.mjs), so the phone counts steps exactly as the tracker page does. Probe 5: tracker_list gives no
// `owner` (model.js then uses its title rule) and links a session the other way round, as `linkedSessions` on each
// item, so the PC turns those into model.js's { id, linkedTrackerItemIds } for the sessions that run now.
import { openDb } from "../core/db.mjs";
import { listProjects, trackerItems, watchDoor } from "../core/door.mjs";

// The item types model.js reads (a job is a release; its steps are tasks, plans and bugs)
const TYPES = new Set(["release", "task", "plan", "bug"]);
// The custom fields model.js and the job page read; the rest (comments, activity) stays on the PC
const FIELDS = [
  "step",
  "stage",
  "waitsOn",
  "collection",
  "dependsOn",
  "file",
  "version",
  "gitTag",
];

// A link list as [{ itemId }]; anything else is left out.
const links = (v) =>
  Array.isArray(v)
    ? v
        .filter((l) => l && typeof l.itemId === "string")
        .map((l) => ({ itemId: l.itemId }))
    : undefined;

// The phone draws these fields as text: text, finite numbers and true/false stay, anything else is left out.
const asText = (v) =>
  typeof v === "string" ||
  typeof v === "boolean" ||
  (typeof v === "number" && Number.isFinite(v))
    ? v
    : undefined;

// The item with only what model.js needs, in its shape.
export function slimItem(item) {
  const f = item.customFields || {};
  const customFields = {};
  for (const k of FIELDS) {
    const v =
      k === "collection" || k === "dependsOn" ? links(f[k]) : asText(f[k]);
    if (v !== undefined) customFields[k] = v;
  }
  return {
    id: asText(item.id),
    type: asText(item.type),
    title: asText(item.title),
    status: asText(item.status),
    archived: !!item.archived,
    ...(asText(item.owner) ? { owner: item.owner } : {}),
    updated: asText(item.updated),
    customFields,
  };
}

// model.js's sessions list for the sessions that run now: [{ id, linkedTrackerItemIds }], sorted by id.
export function runningLinks(items, runningIds) {
  const running = new Set(runningIds);
  const bySession = new Map();
  for (const item of items)
    for (const s of Array.isArray(item.linkedSessions)
      ? item.linkedSessions
      : [])
      if (running.has(s)) {
        if (!bySession.has(s)) bySession.set(s, []);
        bySession.get(s).push(item.id);
      }
  return [...bySession]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, linkedTrackerItemIds]) => ({ id, linkedTrackerItemIds }));
}

const runningSessionIds = () =>
  openDb()
    .prepare("SELECT id FROM ai_sessions WHERE status = 'running'")
    .all()
    .map((r) => r.id);

export function register(registry) {
  watchDoor();

  // { projects: [{ project, name, items, sessions } | { project, name, error }] }: the projects with at least one
  // job; one whose tracker could not be read says why instead of dropping out.
  registry.add({
    name: "jobs.list",
    run: async () => {
      const running = runningSessionIds();
      const projects = await Promise.all(
        listProjects().map(async (p) => {
          let all;
          try {
            all = await trackerItems(p.path);
          } catch (e) {
            if (e.err === "nimbalyst-closed") throw e;
            return {
              project: p.project,
              name: p.name,
              error: e.extra?.message ?? e.message,
            };
          }
          const items = all.filter((i) => TYPES.has(i.type));
          if (!items.some((i) => i.type === "release")) return null;
          return {
            project: p.project,
            name: p.name,
            items: items.map(slimItem),
            sessions: runningLinks(items, running),
          };
        }),
      );
      return { projects: projects.filter(Boolean) };
    },
  });
}
