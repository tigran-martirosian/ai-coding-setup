// The data behind the tracker page (tracker one-page design, sections 1 and 2). A job is a `release` item (any name,
// no kind word); its steps are the tasks, plans and bugs whose built-in `collection` link holds the job's id. Each
// step falls in one of four folds:
//   Needs you  what the user can do now: waits-for-you (only where the project's patch adds it) and in-review, when
//              no open step comes first; and a started step whose session waits on the user (close approach review)
//   Running    started (in-progress and the like) with a session working on it now
//   To do      to-do; started with no session working on it ("started, no session on it"); and a step for the user
//              that waits on an open step ("your turn after …")
//   Done       done, newest first, then the dropped steps (cancelled, wont-do, duplicate), shown but never counted
// A job is finished when every step is done or dropped; one that ships as a version (its `version` field is set)
// also needs its `gitTag`. Works on plain items: { id, type, title, status, archived, owner, updated,
// customFields: { step, stage, waitsOn, collection, file, version, gitTag } }, the shape
// window.documentService.listTrackerItems gives (the app's rowToTrackerItem keeps owner and updated on the item).

// Task, bug and plan statuses of Nimbalyst 0.83.0 (tracker facts) plus the added one, by category. "running" is the
// category of a started step; it is in the Running fold only while a session works on it. "cancelled" is in the
// live data (26.2 has three cancelled steps): a cancelled step is dropped like wont-do. No prototype, so a status
// such as "constructor" is unknown instead of an inherited member.
const CATEGORY = {
  __proto__: null,
  cancelled: "dropped",
  "to-do": "todo",
  "in-progress": "running",
  "in-review": "needs",
  "changes-requested": "running",
  approved: "running",
  "waits-for-you": "needs",
  done: "done",
  "wont-do": "dropped",
  duplicate: "dropped",
  draft: "todo",
  "ready-for-development": "todo",
  "in-development": "running",
  blocked: "running",
  completed: "done",
  rejected: "dropped",
};

/** The step's category; a clear error naming the step when its status is not in the list. */
function categoryOf(step) {
  const c = CATEGORY[step.status];
  if (!c)
    throw new Error(
      `job-tracker: unknown step status "${step.status}" on "${step.title}"`,
    );
  return c;
}

// The item types that are a job's steps; a bug shows among them with its "Bug" tag (design, third pass)
const STEP_TYPES = new Set(["task", "plan", "bug"]);

// Each step type's own done status (tracker facts): a plan is done as "completed", a task or bug as "done"
const DONE_STATUS = { task: "done", bug: "done", plan: "completed" };

/** The status that marks the step done for its type; a clear error for a type that is not a step. */
function doneStatusOf(step) {
  const s = DONE_STATUS[step.type];
  if (!s)
    throw new Error(
      `job-tracker: no done status for type "${step.type}" of "${step.title}"`,
    );
  return s;
}

// A job's stored status that closes it whatever its steps say
const CLOSED_JOB = new Set(["released", "cancelled"]);

/** True when the item's built-in `collection` link (an array of { itemId }) holds the release. */
function inRelease(item, releaseId) {
  const links = item.customFields && item.customFields.collection;
  return Array.isArray(links) && links.some((l) => l && l.itemId === releaseId);
}

/** The job's steps (tasks, plans and bugs, not archived), in the order given. */
function releaseSteps(items, releaseId) {
  return items.filter(
    (i) => STEP_TYPES.has(i.type) && !i.archived && inRelease(i, releaseId),
  );
}

/** The steps not done and not dropped, in the order given. */
function openSteps(steps) {
  return steps.filter((s) => !["done", "dropped"].includes(categoryOf(s)));
}

const escaped = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * The open steps `step` waits on, in the order of `open`: those its `dependsOn` links ([{ itemId }], the app's
 * built-in link) point to, and those whose code (`step` field) its `waitsOn` text names. Codes hold spaces
 * ("look W4"), so a code is matched whole, between the text's ends, spaces, commas or semicolons.
 */
function waitsOnSteps(step, open) {
  const f = step.customFields || {};
  const links = new Set(
    (Array.isArray(f.dependsOn) ? f.dependsOn : [])
      .map((l) => l && l.itemId)
      .filter(Boolean),
  );
  const text = String(f.waitsOn || "");
  const named = (code) =>
    new RegExp(`(^|[\\s,;])${escaped(code)}(?=$|[\\s,;])`).test(text);
  return open.filter((o) => {
    if (o.id === step.id) return false;
    const code = o.customFields && o.customFields.step;
    return links.has(o.id) || (code ? named(String(code)) : false);
  });
}

/** The item's last change in ms, from its `updated` (a Date, ms or an ISO text); a clear error when it has none. */
function updatedOf(item) {
  const u = item.updated;
  const t =
    u instanceof Date
      ? u.getTime()
      : typeof u === "number"
        ? u
        : Date.parse(String(u));
  if (!Number.isFinite(t))
    throw new Error(`job-tracker: item ${item.id} has no "updated" time`);
  return t;
}

/** A custom field as trimmed text; "" when it is not set. */
function fieldText(item, name) {
  const v = item.customFields && item.customFields[name];
  return v == null ? "" : String(v).trim();
}

// A step is the user's when its owner is "user" (what the sessions write on the user's steps, as in the live 26.2
// data) or its title starts "Your OK" or "Your word" (the workflow's names for the user's steps)
const YOUR_TITLE = /^your (ok|word)\b/i;

function isForYou(step) {
  return (
    String(step.owner || "")
      .trim()
      .toLowerCase() === "user" || YOUR_TITLE.test(String(step.title).trim())
  );
}

/**
 * The ids of the items a session works on now: the tracker links (`linkedTrackerItemIds` of sessions:list) of the
 * sessions that run (`getRunningSessionIds`).
 */
function workingItemIds(sessions, runningIds) {
  const running = new Set(runningIds);
  const out = new Set();
  for (const s of sessions)
    if (running.has(s.id))
      for (const id of s.linkedTrackerItemIds || []) out.add(id);
  return out;
}

/**
 * One step's row: `fold` (needs, running, todo or done), `started` (in To do but marked in progress: "started, no
 * session on it"), `asks` (in Needs you: a started step whose session waits on the user), `blocked` (in To do: a step
 * for the user that waits on an open step, "your turn after …"), `dropped` (in Done, muted, never counted), `bug` (the
 * row's "Bug" tag), `forYou` (a To do step that is the user's), `file` (the step's `file` field, a path, or null).
 * `working` and `waiting` are sets of item ids: a session works on it now, a session waits on the user about it.
 * `open` holds the open steps it may wait on (openSteps).
 */
function rowOf(step, working, waiting, open) {
  const cat = categoryOf(step);
  const asks = cat === "running" && waiting.has(step.id);
  const stalled = cat === "running" && !asks && !working.has(step.id);
  const blocked = cat === "needs" && waitsOnSteps(step, open).length > 0;
  let fold = cat;
  if (asks) fold = "needs";
  else if (stalled || blocked) fold = "todo";
  else if (cat === "dropped") fold = "done";
  return {
    item: step,
    fold,
    started: stalled,
    asks,
    blocked,
    dropped: cat === "dropped",
    bug: step.type === "bug",
    forYou: fold === "todo" && (blocked || isForYou(step)),
    file: fieldText(step, "file") || null,
  };
}

/** The first number in a stage name ("2. Fix", "Part 2 · design" -> 2); Infinity for no stage or no number. */
function stageRank(step) {
  const m = /(\d+)/.exec(fieldText(step, "stage"));
  return m ? Number(m[1]) : Infinity;
}

/**
 * `rows` in the order the work runs (user, 2026-11-23: "put the jobs in order"): by stage number first (the
 * `stage` field), then by how many open steps stand before the step (the longest chain of what it waits on), then
 * in the order given. A wait loop counts as no wait, so a loop in the data never hangs the page.
 */
function inRunOrder(rows, open) {
  const depth = new Map();
  const depthOf = (step, seen) => {
    if (depth.has(step.id)) return depth.get(step.id);
    if (seen.has(step.id)) return 0;
    seen.add(step.id);
    const before = waitsOnSteps(step, open).map((s) => depthOf(s, seen));
    seen.delete(step.id);
    const d = before.length ? 1 + Math.max(...before) : 0;
    depth.set(step.id, d);
    return d;
  };
  const key = (r) => [stageRank(r.item), depthOf(r.item, new Set())];
  return rows
    .map((r, i) => ({ r, i, k: key(r) }))
    .sort((a, b) => a.k[0] - b.k[0] || a.k[1] - b.k[1] || a.i - b.i)
    .map((x) => x.r);
}

/**
 * The four folds of `steps` and their counts. Needs you and Running keep the order given; To do is in run order
 * (inRunOrder); Done holds the done
 * steps newest first, then the dropped ones newest first. "of N" (`total`) counts every step not dropped. `working`
 * and `waiting` as rowOf takes them (index.js readSessions; none waiting when left out).
 */
function foldsOf(steps, working, waiting = new Set()) {
  const open = openSteps(steps);
  const rows = steps.map((s) => rowOf(s, working, waiting, open));
  const of = (fold, dropped) =>
    rows.filter((r) => r.fold === fold && r.dropped === dropped);
  const newest = (a, b) => updatedOf(b.item) - updatedOf(a.item);
  const done = of("done", false).sort(newest);
  const dropped = of("done", true).sort(newest);
  const folds = {
    needs: of("needs", false),
    running: of("running", false),
    todo: inRunOrder(of("todo", false), open),
    done: [...done, ...dropped],
  };
  const total = rows.length - dropped.length;
  const forYou = folds.todo.filter((r) => r.forYou).length;
  return {
    rows,
    folds,
    counts: {
      total,
      done: done.length,
      needs: folds.needs.length,
      running: folds.running.length,
      todo: folds.todo.length,
      forYou,
      forClaude: folds.todo.length - forYou,
      dropped: dropped.length,
      percent: total ? Math.round((done.length / total) * 100) : 0,
    },
  };
}

/**
 * A job: its steps, folds and counts; `version` and `tag` (null when not set); `finished`; `closedAs`, the stored
 * status (released or cancelled) that finished it whatever its steps say, else null; `activity`, the newest `updated`
 * of the job and its steps. A job whose stored status is released or cancelled is finished; so is one with steps
 * that are all done or dropped, and, when it ships as a version, a `gitTag` set. A job with no steps yet is open.
 */
function jobOf(job, items, working, waiting = new Set()) {
  const steps = releaseSteps(items, job.id);
  const { rows, folds, counts } = foldsOf(steps, working, waiting);
  const version = fieldText(job, "version") || null;
  const tag = fieldText(job, "gitTag") || null;
  const stepsClosed = steps.length > 0 && counts.done === counts.total;
  const closedAs = CLOSED_JOB.has(job.status) ? job.status : null;
  return {
    job,
    steps,
    rows,
    folds,
    counts,
    version,
    tag,
    finished: !!closedAs || (stepsClosed && (!version || !!tag)),
    closedAs,
    activity: new Date(Math.max(updatedOf(job), ...steps.map(updatedOf))),
  };
}

// A released or cancelled job stays in the picker this long, then the page archives it (close approach, point 2: "a
// few days"); Nimbalyst's own tracker can bring it back
const CLOSED_KEPT_MS = 3 * 24 * 60 * 60 * 1000;

/**
 * When the job got its stored status: the activity line that set it, else its last change (`updated`). The app stamps
 * an activity line with Date.now() (ms); an ISO text is read too.
 */
function closedAt(job) {
  const activity = job.customFields && job.customFields.activity;
  const set = (Array.isArray(activity) ? activity : []).filter(
    (a) => a && a.action === "status_changed" && a.newValue === job.status,
  );
  const last = set[set.length - 1];
  const t = last && last.timestamp ? new Date(last.timestamp).getTime() : NaN;
  return Number.isFinite(t) ? t : updatedOf(job);
}

/** The jobs (not archived) released or cancelled at least CLOSED_KEPT_MS before `now` (ms): the page archives them. */
function oldClosedJobs(items, now) {
  return items.filter(
    (i) =>
      i.type === "release" &&
      !i.archived &&
      CLOSED_JOB.has(i.status) &&
      now - closedAt(i) >= CLOSED_KEPT_MS,
  );
}

/** The picker: the open jobs, newest activity first, then the finished ones, newest first. Archived jobs are out. */
function pickerJobs(items, working, waiting = new Set()) {
  const jobs = items
    .filter((i) => i.type === "release" && !i.archived)
    .map((j) => jobOf(j, items, working, waiting));
  const newest = (a, b) => b.activity - a.activity;
  return {
    open: jobs.filter((j) => !j.finished).sort(newest),
    finished: jobs.filter((j) => j.finished).sort(newest),
  };
}

/**
 * The tasks, plans and bugs (not archived) no job holds, in the order given: the "Not in a job" page. A step of an
 * archived job is here too while it is open: the page archives a released or cancelled job (oldClosedJobs), and its
 * open steps must stay in view; its done and dropped steps leave with it.
 */
function notInJob(items) {
  const jobs = items.filter((i) => i.type === "release");
  const live = jobs.filter((j) => !j.archived).map((j) => j.id);
  const gone = jobs.filter((j) => j.archived).map((j) => j.id);
  return items.filter(
    (i) =>
      STEP_TYPES.has(i.type) &&
      !i.archived &&
      !live.some((id) => inRelease(i, id)) &&
      (!gone.some((id) => inRelease(i, id)) ||
        !["done", "dropped"].includes(categoryOf(i))),
  );
}

export {
  CATEGORY,
  CLOSED_KEPT_MS,
  categoryOf,
  doneStatusOf,
  foldsOf,
  inRelease,
  isForYou,
  jobOf,
  notInJob,
  oldClosedJobs,
  openSteps,
  pickerJobs,
  releaseSteps,
  rowOf,
  STEP_TYPES,
  waitsOnSteps,
  workingItemIds,
};
