// Job Tracker: makes Nimbalyst's own tracker page one page for one job, so the user reads where a piece of work
// stands instead of asking (tracker one-page design, 2026-11-14). A job is a `release` item with any name and no kind
// word; its steps are the items linked to it (model.js).
//   - the page top (reading.js): the job's name as the headline and the picker button, its goal, a state pill and one
//     meta line; the picker ("All open", the open jobs newest activity first, "Not in a job", "Finished"); one
//     progress line over a 10px bar with a needs-you part; the "All open" list; the no-job and empty states
//   - the page opens on the open job with the newest activity; a pick in the picker shows that one
//   - the app's left column (its Types list and the rest) is hidden while the page is on; its type rows stay in the
//     page and still answer clicks (one-page proofs point 8). It goes only once the page is drawn: when the data or a
//     call fails, the page says what failed in one line and the app's own column and list stay in view
//   - under it the four folds (groups.js, row.js): Needs you, Running, To do, Done, our own rows from the data, so
//     Done holds every finished step; the app's own list is hidden (its rows are only what its filter shows)
//   - a row's click opens the item view, its file link the file in the editor, its session link the session (the
//     three ways of the one-page proofs)
//   - the page's two writes (close approach, 2026-11-16, Proofs): a row's Mark done button (a Needs you step the
//     user can close, a started step whose session ended) sets the step to its type's done status
//     (window.electronAPI.documentService.updateTrackerItem), and each read archives the jobs released or cancelled
//     3 days ago (archiveTrackerItem), so they leave the picker; the item list holds archived items too, and the
//     page leaves them out (model.js)
//   - the item view: one status line, one filled button (the linked session, else "Launch Session"), the step's
//     text, and the rest behind "More fields" and "History and details" (item-view.js and style.css)
// The counts are in model.js, the words and drawing in reading.js, the app's selectors in selectors.js. The data
// comes from window.documentService.listTrackerItems (build proofs, point 3), read again every 30 seconds and on
// each change watchTrackerItems reports. React owns the app's elements, so this adds its own section.rt-root above
// the table and hides the table with a class.
//   - the session's chat on the right (chat.js): the Sessions view's own chat column, moved onto the page while it
//     stands, so the user keeps working in the session; a click on a Sessions row changes it, and so does a row's
//     "Open session" when the Sessions column lists that session; an opened item stands beside the list when the
//     list keeps 440 px, else in its place with a Back line

import {
  chatShown,
  leaveChat,
  leaveItem,
  listedSession,
  markItemChat,
  noteListScroll,
  placeItem,
  returnChat,
  setChatShown,
  showChat,
} from "./chat.js";
import { foldsView, renderFolds } from "./groups.js";
import { clearItemViews, drawItemViews } from "./item-view.js";
import {
  categoryOf,
  doneStatusOf,
  foldsOf,
  notInJob,
  oldClosedJobs,
  openSteps,
  releaseSteps,
  STEP_TYPES,
  workingItemIds,
} from "./model.js";
import { pageView, renderPage } from "./reading.js";
// biome-ignore lint/correctness/noUnusedImports: build.mjs puts row.js in place of this line (groups.js uses it)
import { rowView } from "./row.js";
import { SEL, trackerPage } from "./selectors.js";

// Every visible word. {x} is replaced by a value. No word "release" and no kind word (design section 4).
const STRINGS = {
  sep: " · ",
  dateLocale: "en-GB",
  // The page top (reading.js)
  pageLabel: "Job",
  pickerLabel: "Jobs",
  switchJob: "Switch job ({n} open)",
  inProgress: "In progress",
  finished: "Finished",
  inProgressTip: "In progress: {n} left",
  inProgressNoTag: "In progress: every step done, tag not set yet",
  inProgressNoSteps: "In progress: no steps yet",
  finishedTip: "Finished: every step done or dropped",
  finishedTagTip: "Finished: every step done or dropped, tag {tag} set",
  finishedMarkedTip: "Finished: marked finished",
  finishedCancelledTip: "Finished: marked cancelled",
  noGoal: "No goal written yet.",
  started: "Started {date}",
  version: "version {version}",
  tag: "tag {tag}",
  noTag: "no tag yet",
  step: "step",
  steps: "steps",
  item: "item",
  items: "items",
  job: "job",
  jobs: "jobs",
  ofDone: "of {total} done",
  noneYet: "No {unit} yet",
  updated: "Updated {time}",
  barLabel:
    "{done} of {total} done, {needs} need you, {running} running, {todo} to do",
  tipDone: "Done: {done} of {total}",
  tipNeeds: "Needs you: {n}",
  tipRunning: "Running: {n}, a session works on each",
  tipRunningOne: "Running: {n}, a session works on it",
  tipToDoBoth: "To do: {n}, {claude} for Claude, {you} for you",
  tipToDoClaude: "To do: {n} for Claude",
  tipToDoYou: "To do: {n} for you",
  needsOne: "{n} needs you",
  needsMany: "{n} need you",
  allOpen: "All open",
  allOpenTitle: "All open jobs",
  allMeta: "{n} open · as of {time}",
  noOpenJobs: "No open jobs",
  noOpenJobsLead: "No open jobs.",
  doneShort: "{done} of {total} done",
  ofShort: "{done} of {total}",
  openJob: "Open {name}",
  notInJob: "Not in a job",
  looseSub: "Items no job holds",
  looseGoal:
    "{n} items here are in no job. When a session plans work over more than one session, it makes a job and its steps move there.",
  looseGoalOne:
    "{n} item here is in no job. When a session plans work over more than one session, it makes a job and its steps move there.",
  finishedOn: "finished {date}",
  moreFinished: "{n} more finished",
  noJobs: "No jobs yet",
  emptyLead:
    "A job is any work that takes more than one session, whatever it is. A session that plans one adds it here, with its steps.",
  // The page could not be drawn (showError); {error} is what failed
  failed:
    "The job page could not be drawn. {error}. The tracker's own list is below.",
  // The four folds (groups.js) and their rows (row.js)
  folds: {
    needs: "Needs you",
    running: "Running",
    todo: "To do",
    done: "Done",
  },
  foldEmpty: {
    needs: "Nothing waits for you.",
    running: "Nothing running right now.",
    todo: "Nothing left to do.",
    done: "Nothing done yet.",
  },
  showMore: "Show {n} more",
  since: "since {date}",
  working: "working",
  waitsOn: "waits on {steps}",
  waitsSep: "; ",
  readyForYou: "ready for you",
  // A step for the user that waits on an open step: in To do, not the user's move yet
  yourTurnAfter: "your turn after {steps}",
  // The Mark done button, and its row's words when the tracker did not save the change; {error} is what failed
  doneButton: "Mark done",
  doneTip: "Mark this step done",
  doneFailed: "Not marked done: the tracker did not save it ({error})",
  ready: "ready",
  startedOn: "started {date}, no session on it",
  startedNoSession: "started, no session on it",
  startedTip: "Marked in progress, but no session is working on it now",
  // A linked session's state (close approach, Proofs, Session states), in the agents panel's and the phone app's
  // words; {date} is the session's last change. No error word: the app keeps no lasting record of one
  sessionWaiting: "needs you",
  noChangeSince: "no change since {date}",
  sessionEnded: "session ended {date}, step not done",
  dropped: "dropped",
  bug: "Bug",
  openFile: "Open {name}",
  fileIn: "in {folder}",
  openInEditor: "Open in the editor",
  openSession: "Open session",
  openSessionNamed: "Open the session “{title}”",
  openSessionLinked: "Open the linked session",
  // A session the Sessions column does not list opens there (chat.js)
  opensInSessions: "Opens in the Sessions view",
  // The line above an item that took the list's place (chat.js); with no job shown, the plain words
  backTo: "Back to {name}",
  backToList: "Back to the list",
  // The item view (item-view.js)
  foldDone: "{n} done",
  moreFields: "More fields",
  fewerFields: "Fewer fields",
  history: "History and details",
  historyCount: "History and details · {n}",
  // What the linked session does, by its last tool (an unknown tool is named as it is)
  doing: {
    Read: "reading files",
    LS: "reading files",
    NotebookRead: "reading files",
    Grep: "searching files",
    Glob: "searching files",
    WebFetch: "reading a page",
    WebSearch: "searching the web",
    Edit: "editing files",
    Write: "editing files",
    MultiEdit: "editing files",
    NotebookEdit: "editing files",
    Bash: "running a command",
    PowerShell: "running a command",
    Agent: "waiting on helpers",
    Task: "waiting on helpers",
    TodoWrite: "planning",
    EnterPlanMode: "planning",
    ExitPlanMode: "planning",
  },
  doingCheck: "running a check",
  doingOther: "using {tool}",
  // The chat column's place with no session open (chat.js)
  chatEmpty: "No session open",
  chatEmptyLead: "Pick a session on the left to chat with it here.",
  // The Chat button in the page header (reading.js) and the handle on the chat's left edge (chat.js)
  chatButton: "Chat",
  chatHide: "Hide the chat",
  chatShow: "Show the chat beside the tracker",
  chatHandle: "Chat width",
};

// How many of a running session's last transcript messages are read for its last tool call
const TAIL = 20;

const READ_EVERY_MS = 30000;

// The folds open when the page opens on a job; Done is closed (design 3.7)
const OPEN_AT_START = ["needs", "running", "todo"];

/** All tracker items of the open project, through the app's own document service. */
async function readItems() {
  const ds = window.documentService;
  if (!ds || typeof ds.listTrackerItems !== "function")
    throw new Error(
      "job-tracker: window.documentService.listTrackerItems is not there",
    );
  if (!window.workspacePath)
    throw new Error("job-tracker: window.workspacePath is not set");
  const items = await ds.listTrackerItems(window.workspacePath);
  if (!Array.isArray(items))
    throw new Error("job-tracker: listTrackerItems did not return a list");
  return items;
}

/**
 * What failed, in words, from a write's answer ({ success: false, error }) or a thrown error. An error that is an
 * object (an Error, or { message }) gives its message.
 */
function failure(r) {
  const e = r && (r.error || r.message);
  if (!e) return "no answer from the tracker";
  if (typeof e === "string") return e;
  if (typeof e.message === "string" && e.message) return e.message;
  return JSON.stringify(e);
}

/**
 * Sets the step to its type's done status (model.js doneStatusOf: a plan is "completed") through the app's own
 * tracker write (close approach, Proofs: it answers { success, item } or { success: false, error }). `itemsNow()`
 * gives the items as they stand when the write answers, so a read that landed meanwhile is kept. Returns those items
 * with the step done and its time now; on a failed write, the same items and `error`, the plain words of what failed.
 */
async function closeStep(api, itemsNow, itemId) {
  const step = itemsNow().find((i) => i.id === itemId);
  if (!step)
    return { items: itemsNow(), error: `no step ${itemId} in the list` };
  const status = doneStatusOf(step);
  let r;
  try {
    r = await api.documentService.updateTrackerItem({
      itemId,
      updates: { status },
    });
  } catch (e) {
    return { items: itemsNow(), error: failure(e) };
  }
  const items = itemsNow();
  if (!r || !r.success) return { items, error: failure(r) };
  const now = new Date();
  return {
    items: items.map((i) =>
      i.id === itemId ? { ...i, status, updated: now } : i,
    ),
    error: null,
  };
}

/**
 * Archives the jobs released or cancelled 3 days before `now` (ms; model.js oldClosedJobs) through the call the app's
 * own tracker uses; the ids in `skip` are not tried. Returns `items` with those the app archived marked archived, and
 * `failed`, [{ id, error }] for each it did not archive (they stay in the picker).
 */
async function archiveOldJobs(api, items, now, skip) {
  const archived = new Set();
  const failed = [];
  for (const job of oldClosedJobs(items, now)) {
    if (skip.has(job.id)) continue;
    let r;
    try {
      r = await api.documentService.archiveTrackerItem({
        itemId: job.id,
        archive: true,
      });
    } catch (e) {
      r = { success: false, error: failure(e) };
    }
    if (r && r.success) archived.add(job.id);
    else failed.push({ id: job.id, error: failure(r) });
  }
  return {
    items: items.map((i) =>
      archived.has(i.id) ? { ...i, archived: true } : i,
    ),
    failed,
  };
}

/** The project folder's name, for the "Not in a job" page's meta line. */
const projectName = () =>
  String(window.workspacePath)
    .split(/[\\/]+/)
    .filter(Boolean)
    .pop() || String(window.workspacePath);

let state = null;

/** The page's view for the last read data and the user's pick. */
const viewNow = () =>
  pageView(
    STRINGS,
    state.items,
    state.working,
    state.picked,
    state.readAt,
    projectName(),
    state.waiting,
  );

/** The folds of what the page shows (model.js foldsOf): a job's steps, the items no job holds, or null. */
function shownFolds(view) {
  if (view.kind === "job")
    return foldsOf(
      releaseSteps(state.items, view.current),
      state.working,
      state.waiting,
    );
  if (view.kind === "none")
    return foldsOf(notInJob(state.items), state.working, state.waiting);
  return null;
}

/**
 * The session linked to an item (one that waits on the user first, then a running one), or null: { id, title,
 * running, waiting, waitingSince, updatedAt, call }.
 */
const sessionOf = (id) => state.sessions.get(id) || null;

/**
 * Puts the page top for `view` and its folds above the table of `page`, and hides the table. `on` holds the clicks
 * (reading.js renderPage, groups.js renderFolds). Returns the section, or null when the page has no table yet.
 */
function mount(doc, page, view, ui, on) {
  const old = page.querySelector(SEL.root);
  const table = page.querySelector(SEL.table);
  if (!table) {
    if (old) old.remove();
    return null;
  }
  const focus = old && focusPath(old, doc.activeElement);
  const root = renderPage(doc, view, STRINGS, ui, on);
  const folds = shownFolds(view);
  if (folds) {
    const fv = foldsView(STRINGS, folds.folds, ui, {
      open: openSteps(folds.rows.map((r) => r.item)),
      now: state.readAt,
      sessionOf,
      listed: (id) => listedSession(doc, id) !== null,
      failed: state.doneFailed,
    });
    root.append(renderFolds(doc, fv, on));
  }
  if (old) old.replaceWith(root);
  else table.parentElement.insertBefore(root, table);
  // Our folds hold the rows; the app's list shows only what its filter lets through, so it is hidden
  table.classList.add("rt-table-hidden");
  anchorPicker(root);
  if (focus) keepFocus(root, focus);
  return root;
}

// The data marks that tell our controls apart (reading.js, groups.js, row.js): a job pick, a fold, a step's row and
// its file and session links and its Mark done button
const FOCUS_MARKS = ["pick", "fold", "step", "file", "session", "done"];

/**
 * A selector for `el` inside `root` that finds the same control in a redrawn section: its tag and first class with
 * its data marks, under the data marks of the parts around it. Null when `el` is not inside `root`.
 */
function focusPath(root, el) {
  if (!el || el === root || !root.contains(el) || !el.classList.length)
    return null;
  const marks = (e) =>
    FOCUS_MARKS.filter((k) => k in e.dataset)
      .map((k) => `[data-${k}="${CSS.escape(e.dataset[k])}"]`)
      .join("");
  const parts = [
    `${el.tagName.toLowerCase()}.${CSS.escape(el.classList[0])}${marks(el)}`,
  ];
  for (let e = el.parentElement; e && e !== root; e = e.parentElement)
    if (marks(e)) parts.unshift(marks(e));
  return parts.join(" ");
}

/**
 * Each draw makes a new section, so the control that had the focus is gone: the same control in the new one gets it
 * (design 3.3's keys work across redraws). When it is gone or hidden (a pick closed the picker), the name gets it.
 */
function keepFocus(root, path) {
  const again = root.querySelector(path);
  if (again) again.focus({ preventScroll: true });
  if (again && root.ownerDocument.activeElement === again) return;
  const name = root.querySelector(".rt-name");
  if (name) name.focus({ preventScroll: true });
}

/** The picker sits under the name's real bottom, which moves down when a long name wraps to two lines. */
function anchorPicker(root) {
  const head = root.querySelector(".rt-head");
  const name = root.querySelector(".rt-name");
  const picker = root.querySelector(".rt-picker");
  if (!head || !name || !picker) return;
  const top =
    name.getBoundingClientRect().bottom - head.getBoundingClientRect().top;
  picker.style.top = `${Math.round(top) + 6}px`;
}

/** A time the app gives as a Date, ms or an ISO text, in ms; null when it gives none. */
function msOf(t) {
  if (t == null) return null;
  const ms = new Date(t).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * The sessions of the project at `workspacePath`, for the tracker `items`, through the app's `api`
 * (window.electronAPI; build proofs point 6; one-page proofs point 6 for the archived ones). Returns `working`, the
 * ids of the items a session is on now (it runs, or it waits on the user), `waiting`, the ids of those whose session
 * waits on the user, and `sessions`, item id -> { id, title, running, waiting, waitingSince, updatedAt, call } for
 * each item a session is linked to (one that waits first, then a running one), where call is a running session's
 * last tool call ({ toolName, arguments }) on a started step, else null.
 * The state (close approach, Proofs, Session states): the app counts a session as running only while its turn runs
 * (status "running" or streaming), so a Claude CLI session that waits on the user is not in the running ids; its own
 * state (getSessionState) says "waiting_for_input", and its lastActivity is when it began to wait. sessions:list's
 * open question counts as waiting too, with no time. updatedAt is sessions:list's last change, in ms.
 */
async function readSessions(api, items, workspacePath) {
  // With the archived sessions too: a finished step's session is often archived (one-page proofs point 6)
  const list = await api.invoke("sessions:list", workspacePath, {
    includeArchived: true,
  });
  if (!list || !list.success || !Array.isArray(list.sessions))
    throw new Error("job-tracker: sessions:list did not return sessions");
  const run = await api.sessionState.getRunningSessionIds();
  if (!run || !run.success || !Array.isArray(run.sessionIds))
    throw new Error("job-tracker: getRunningSessionIds failed");
  const runningIds = new Set(run.sessionIds);
  const started = new Set(
    items
      .filter((i) => STEP_TYPES.has(i.type) && categoryOf(i) === "running")
      .map((i) => i.id),
  );
  // Session id -> since when it waits (ms, or null when the app does not say), for each session that waits on the
  // user and is linked to a started step, whether it runs or not
  const waitingSince = new Map();
  for (const s of list.sessions) {
    if (!(s.linkedTrackerItemIds || []).some((id) => started.has(id))) continue;
    const st = await api.sessionState.getSessionState(s.id);
    if (!st || typeof st !== "object" || !("state" in st))
      throw new Error(
        `job-tracker: getSessionState gave no state for session ${s.id}`,
      );
    if (st.state && st.state.status === "waiting_for_input")
      waitingSince.set(s.id, msOf(st.state.lastActivity));
    else if (s.hasPendingInteractivePrompt === true)
      waitingSince.set(s.id, null);
  }
  const working = workingItemIds(list.sessions, [
    ...runningIds,
    ...waitingSince.keys(),
  ]);
  const waiting = workingItemIds(list.sessions, [...waitingSince.keys()]);
  const rank = (s) =>
    waitingSince.has(s.id) ? 0 : runningIds.has(s.id) ? 1 : 2;
  const ordered = [...list.sessions].sort((a, b) => rank(a) - rank(b));
  const out = new Map();
  for (const s of ordered)
    for (const id of s.linkedTrackerItemIds || [])
      if (!out.has(id)) {
        if (!Number.isFinite(s.updatedAt))
          throw new Error(
            `job-tracker: sessions:list gave session ${s.id} no updatedAt`,
          );
        out.set(id, {
          id: s.id,
          title: typeof s.title === "string" ? s.title.trim() : "",
          running: runningIds.has(s.id),
          waiting: waitingSince.has(s.id),
          waitingSince: waitingSince.has(s.id) ? waitingSince.get(s.id) : null,
          updatedAt: s.updatedAt,
          call: null,
        });
      }
  for (const [itemId, s] of out) {
    if (!s.running || s.waiting || !started.has(itemId)) continue;
    const tail = await api.invoke("transcript:get-tail-messages", s.id, TAIL);
    if (!Array.isArray(tail))
      throw new Error(
        "job-tracker: transcript:get-tail-messages did not return a list",
      );
    const last = tail.filter((m) => m && m.type === "tool_call" && m.toolCall);
    s.call = last.length ? last[last.length - 1].toolCall : null;
  }
  return { working, waiting, sessions: out };
}

async function read() {
  state.stale = false;
  const items = await readItems();
  state.readAt = new Date();
  // A job the app did not archive is not tried again while the page is on: the console says why once
  const arch = await archiveOldJobs(
    window.electronAPI,
    items,
    +state.readAt,
    state.archiveFailed,
  );
  for (const f of arch.failed) {
    state.archiveFailed.add(f.id);
    console.error(`job-tracker: could not archive job ${f.id}: ${f.error}`);
  }
  state.items = arch.items;
  const linked = await readSessions(
    window.electronAPI,
    state.items,
    window.workspacePath,
  );
  state.working = linked.working;
  state.waiting = linked.waiting;
  state.sessions = linked.sessions;
}

/**
 * The page, drawn again after each read, a pick, a fold click, or when React dropped it. Returns its section, or null
 * when the page has no table to put it over.
 */
function drawPage(page) {
  const root = page.querySelector(SEL.root);
  const shown = chatShown(window);
  // Which linked sessions the Sessions column lists: a row's session hover says where it opens
  const listed = [...state.sessions.values()]
    .map((s) => (listedSession(document, s.id) ? 1 : 0))
    .join("");
  const key = `${+state.readAt} ${state.changes} ${state.picked} ${state.pickerOpen} ${state.moreFinished} ${[...state.open].sort()} ${state.doneAll} ${shown} ${listed}`;
  if (root && root.dataset.readAt === key) return root;
  const view = viewNow();
  state.back = view.head
    ? STRINGS.backTo.replace("{name}", view.head.name)
    : STRINGS.backToList;
  const made = mount(
    document,
    page,
    view,
    {
      pickerOpen: state.pickerOpen,
      pickerFade: state.pickerFade,
      moreFinished: state.moreFinished,
      open: state.open,
      doneAll: state.doneAll,
      chatShown: shown,
    },
    {
      pick,
      picker: setPicker,
      moreFinished: showMoreFinished,
      toggle: toggleFold,
      more: showAllDone,
      item: openItem,
      file: openFile,
      session: openSession,
      chat: toggleChat,
      done: markDone,
    },
  );
  if (made) {
    made.dataset.readAt = key;
    state.pickerFade = false;
  }
  return made;
}

/**
 * Pressing Tracker changes only the main area (user, 2026-11-14): while the page is on screen, the Sessions mode's
 * own left column (project header, tabs, search and the Sessions list) is moved into the tracker's column, in place
 * of the tracker sidebar, and moved back when the page leaves. React keeps drawing it where it stands. Its old parent
 * gets a guard: if React removes the column, or inserts next to it, while it is away, it is put back first, so React
 * never meets a missing child (that error would blank the window).
 */
function borrowSessions(sidebar) {
  const panel = sidebar.parentElement;
  const b = state.borrowed;
  if (b && b.column.parentElement === panel) return true;
  const home = document.querySelector(SEL.sessionsHome);
  let column =
    home && [...home.children].find((c) => c.querySelector(SEL.sessionsList));
  // The left panel was closed and opened again while the column was away: the app dropped the old tracker panel
  // with the column inside, so the column still held is the one to show (its home never got it back)
  if (
    !column &&
    b &&
    b.home === home &&
    b.column.querySelector(SEL.sessionsList)
  )
    column = b.column;
  if (!column) return false;
  guard(home, column);
  state.borrowed = { column, home };
  panel.appendChild(column);
  return true;
}

/** The guard on the column's own parent (see borrowSessions); set once per parent. */
function guard(home, column) {
  if (home.__jtGuard) {
    home.__jtGuard.column = column;
    return;
  }
  const g = { column };
  const back = (node) => {
    if (node === g.column && node.parentElement !== home)
      home.appendChild(node);
  };
  const remove = home.removeChild;
  const insert = home.insertBefore;
  home.removeChild = function (node) {
    back(node);
    return remove.call(this, node);
  };
  home.insertBefore = function (node, ref) {
    back(ref);
    return insert.call(this, node, ref);
  };
  home.__jtGuard = g;
}

/** The borrowed Sessions column back where it belongs (a no-op when it is home or nothing was borrowed). */
function returnSessions() {
  const b = state && state.borrowed;
  if (!b) return;
  if (b.column.parentElement !== b.home) {
    if (b.home.isConnected) b.home.appendChild(b.column);
    // The app drew its Sessions mode anew meanwhile: this old column is left over
    else b.column.remove();
  }
  state.borrowed = null;
}

/** The left column while the page is on screen: the Sessions column in place of the tracker sidebar; when the
 * Sessions column is not in the page, the tracker sidebar's project header stays and only its list goes. */
function hideLeft() {
  const sidebar = document.querySelector(SEL.sidebar);
  if (!sidebar) {
    if (!state.noSidebar) console.error("job-tracker: no tracker sidebar");
    state.noSidebar = true;
    return;
  }
  if (borrowSessions(sidebar)) {
    if (!sidebar.classList.contains("rt-left-hidden"))
      sidebar.classList.add("rt-left-hidden");
    return;
  }
  if (!state.noSessions)
    console.error(
      "job-tracker: no Sessions column to show in the tracker; the project header stays",
    );
  state.noSessions = true;
  for (const part of sidebar.children)
    if (
      !part.matches(SEL.sidebarKeep) &&
      !part.classList.contains("rt-left-hidden")
    )
      part.classList.add("rt-left-hidden");
}

/** The app's left column and list in view again (a class is only taken off where it is, so no needless DOM change). */
function showApp(page) {
  returnSessions();
  returnChat(document, state.chat);
  leaveItem(document, state.item);
  for (const el of document.querySelectorAll(".rt-left-hidden"))
    el.classList.remove("rt-left-hidden");
  for (const list of page.querySelectorAll(".rt-table-hidden"))
    list.classList.remove("rt-table-hidden");
}

/**
 * The page could not be drawn: one line over the app's own list says what failed, and the app's left column and list
 * are in view again, so the tracker stays usable. The same line is not drawn twice (the page watcher would loop).
 */
function showError(page, error) {
  showApp(page);
  const old = page.querySelector(SEL.root);
  const table = page.querySelector(SEL.table);
  if (!table) {
    if (old) old.remove();
    return;
  }
  const what = String(error && error.message ? error.message : error)
    .replace(/^job-tracker: /, "")
    .replace(/^./, (c) => c.toUpperCase());
  const text = STRINGS.failed.replace("{error}", what);
  if (old && old.classList.contains("rt-error") && old.textContent === text)
    return;
  const box = document.createElement("section");
  box.className = "rt-root rt-error";
  box.setAttribute("role", "alert");
  box.textContent = text;
  if (old) old.replaceWith(box);
  else table.parentElement.insertBefore(box, table);
}

/** A pick in the picker or the "All open" list: a job id, "all" or "none". The picker closes; the folds start over. */
function pick(id) {
  if (!state) return;
  state.picked = id;
  state.pickerOpen = false;
  state.open = new Set(OPEN_AT_START);
  state.doneAll = false;
  state.stale = true;
  drawNow();
}

function setPicker(open) {
  if (!state) return;
  state.pickerOpen = open;
  state.pickerFade = open;
  state.moreFinished = false;
  drawNow();
}

function showMoreFinished() {
  if (!state) return;
  state.moreFinished = true;
  drawNow();
}

/** A click on a fold's heading opens or closes it. */
function toggleFold(key) {
  if (!state) return;
  if (state.open.has(key)) state.open.delete(key);
  else state.open.add(key);
  drawNow();
}

function showAllDone() {
  if (!state) return;
  state.doneAll = true;
  drawNow();
}

/**
 * The Mark done button: the step is set done; the row moves to Done at once, and the next read brings the app's own
 * copy. On a failed write the row stays where it is and its words say the write failed; a read that landed during
 * the write is kept either way.
 */
async function markDone(itemId) {
  if (!state) return;
  // The page may be left during the write: then there is nothing to keep
  const r = await closeStep(
    window.electronAPI,
    () => (state ? state.items : []),
    itemId,
  );
  if (!state) return;
  state.items = r.items;
  if (r.error) {
    state.doneFailed.set(itemId, r.error);
    console.error(`job-tracker: could not mark ${itemId} done: ${r.error}`);
  } else {
    state.doneFailed.delete(itemId);
    state.stale = true;
  }
  state.changes += 1;
  drawNow();
}

/** Opens the item view (one-page proofs, "Opening an item"). */
function openItem(itemId) {
  if (state) noteListScroll(document, state.item);
  window.dispatchEvent(
    new CustomEvent("nimbalyst:navigate-tracker-item", { detail: { itemId } }),
  );
}

/** The step's `file` as a full path: as written when it is one, else under the project folder. */
function fullPath(file) {
  if (/^([a-zA-Z]:[\\/]|[\\/])/.test(file)) return file;
  const base = String(window.workspacePath);
  const sep = base.includes("\\") ? "\\" : "/";
  return `${base.replace(/[\\/]+$/, "")}${sep}${file.replace(/[\\/]+/g, sep)}`;
}

/** Opens the file in the editor (one-page proofs, "Opening a file"); a failed call is reported, not hidden. */
function openFile(file) {
  window.electronAPI
    .invoke("workspace:open-file", {
      workspacePath: window.workspacePath,
      filePath: fullPath(file),
    })
    .catch((e) => console.error("job-tracker: open-file failed", e));
}

/**
 * Opens the session (tracker chat design, section 5): one the Sessions column lists is picked there, the way the user
 * would, so it shows in the chat beside the page (shown first if hidden) and the page stays; one it does not list
 * opens in the Sessions view (one-page proofs, "Opening a session").
 */
function openSession(sessionId) {
  const row = listedSession(document, sessionId);
  if (row) {
    if (!chatShown(window)) setChatShown(true);
    row.click();
    drawNow();
    return;
  }
  window.dispatchEvent(
    new CustomEvent("open-ai-session", {
      detail: { sessionId, workspacePath: window.workspacePath },
    }),
  );
}

/** The Chat button: the user's choice is kept, and the next draw moves the column home or onto the page. */
function toggleChat(show) {
  setChatShown(show);
  drawNow();
}

async function sync() {
  drawItemViews(document, STRINGS, state.items || []);
  const page = trackerPage(document);
  if (!page) return;
  try {
    if (
      !state.items ||
      state.stale ||
      Date.now() - state.readAt >= READ_EVERY_MS
    )
      await read();
    // The tracker may have been left during the read: then nothing moves onto the hidden page
    if (!state || !trackerPage(document)) return;
    // The left column goes, and the chat comes in, only once our page stands in its place
    if (drawPage(page)) {
      hideLeft();
      showChat(document, page, state.chat, STRINGS);
      placeItem(document, page, state.item, state.back);
    } else showApp(page);
  } catch (e) {
    if (state) showError(page, e);
    throw e;
  }
}

/**
 * A click that changes only what the page shows (the picker, a pick, a fold, the chat, a Mark done) is drawn at once
 * from the data already read, not after the read under way: the app's session list can take 20 s, and running
 * sessions keep asking for new reads, so a click waited minutes and the page looked dead (2026-11-19). The read
 * under way runs on, and one more follows it.
 */
function drawNow() {
  if (!state) return;
  if (!state.busy || !state.items) {
    run();
    return;
  }
  state.again = true;
  const page = trackerPage(document);
  if (!page) return;
  try {
    if (drawPage(page)) {
      hideLeft();
      showChat(document, page, state.chat, STRINGS);
      placeItem(document, page, state.item, state.back);
    }
  } catch (e) {
    console.error(e);
  }
}

function run() {
  if (!state) return;
  // While the chat's handle is dragged the transcript reflows every frame; no page draw meanwhile. The drag's end
  // drops the class, and that change runs the sync
  if (document.querySelector(".rt-chat-handle.rt-chat-dragging")) return;
  if (state.busy) {
    state.again = true;
    return;
  }
  state.busy = true;
  state.again = false;
  sync()
    .catch((e) => console.error(e))
    .finally(() => {
      if (!state) return;
      state.busy = false;
      if (state.again) run();
    });
}

/** Starts the shared thinking-orbs mount (shared/orbs/orbs.js, which build.mjs puts in place of the marker line; it
 *  keeps one copy per window, so the agents panel's copy and this one share one loop). */
function loadOrbs() {
  // ORBS-MOUNT (build.mjs)
  if (!window.Orbs)
    throw new Error(
      "job-tracker: the thinking-orbs mount is missing: load dist/index.js built by build.mjs",
    );
}

function activate() {
  if (window.__jobTracker && window.__jobTracker.deactivate !== deactivate) {
    window.__jobTracker.deactivate();
  }
  const ds = window.documentService;
  if (!ds || typeof ds.watchTrackerItems !== "function")
    throw new Error(
      "job-tracker: window.documentService.watchTrackerItems is not there",
    );
  const api = window.electronAPI;
  if (!api || typeof api.invoke !== "function" || !api.sessionState)
    throw new Error(
      "job-tracker: window.electronAPI.sessionState is not there",
    );
  if (
    !api.documentService ||
    typeof api.documentService.updateTrackerItem !== "function" ||
    typeof api.documentService.archiveTrackerItem !== "function"
  )
    throw new Error(
      "job-tracker: window.electronAPI.documentService has no tracker writes",
    );
  loadOrbs();
  window.__jobTracker = { deactivate };
  state = {
    items: null,
    readAt: 0,
    stale: false,
    busy: false,
    again: false,
    // The open folds, and whether Done shows all its rows
    open: new Set(OPEN_AT_START),
    doneAll: false,
    sessions: new Map(),
    working: new Set(),
    waiting: new Set(),
    // Counts the page's own writes, so a Done click redraws before the next read
    changes: 0,
    // Step id -> what failed, for a Done click the tracker did not save; job ids the app did not archive
    doneFailed: new Map(),
    archiveFailed: new Set(),
    // What the user picked: a job id, "all", "none", or null for the open job with the newest activity
    picked: null,
    pickerOpen: false,
    // The picker fades in on the draw that opens it, not on each redraw while it is open
    pickerFade: false,
    moreFinished: false,
    noSidebar: false,
    noSessions: false,
    // The Sessions column moved into the tracker's left column: { column, home }, or null
    borrowed: null,
    // The chat column moved onto the page (chat.js): { moved, failed, watched, observer, again }; a change of the
    // tracker row's size runs a sync, which sizes the chat again
    chat: {
      moved: null,
      failed: false,
      watched: null,
      observer: null,
      again: () => run(),
    },
    // Where an opened item stands (chat.js placeItem): { wide, parent, region, observer, failed, again }; a change of
    // the item's row or the item's size runs a sync, which places it again
    item: {
      wide: null,
      parent: null,
      region: null,
      observer: null,
      failed: false,
      again: () => run(),
    },
    // The Back line's words, set with the page's view
    back: STRINGS.backToList,
  };
  // A session starts, works, waits or ends: read again, so Running and the orbs follow
  state.onSession = () => {
    if (!state) return;
    state.stale = true;
    run();
  };
  // No sessionState.subscribe: the app keeps one subscription per window, and ours would narrow it to this project
  api.sessionState.onStateChange(state.onSession);
  // A change to any tracker item: read again on the next run
  state.unwatch = ds.watchTrackerItems(() => {
    if (!state) return;
    state.stale = true;
    run();
  });
  // A click outside the open picker closes it
  state.onClick = (e) => {
    if (!state || !state.pickerOpen) return;
    if (e.target.closest && e.target.closest(".rt-picker")) return;
    setPicker(false);
  };
  document.addEventListener("click", state.onClick);
  // The page watcher: React redraws and drops our section
  let queued = false;
  state.observer = new MutationObserver(() => {
    if (document.querySelector(".rt-chat-handle.rt-chat-dragging")) return;
    // Leaving or reopening the tracker: the Sessions column and the chat column move at once, not a frame later, so
    // no column flashes empty. On reopening they move only when the last draw hid the tracker sidebar (the page
    // stood).
    if (state) {
      // The top bar's "Chat about this item" option is marked before it paints (style.css hides it while the chat
      // is on the page)
      markItemChat(document);
      const on = trackerPage(document);
      if (!on) {
        if (state.borrowed) returnSessions();
        if (state.chat.moved || state.chat.failed || state.chat.watched)
          leaveChat(document, state.chat);
        if (state.item.wide || state.item.observer)
          leaveItem(document, state.item);
      } else if (!state.borrowed) {
        const side = document.querySelector(SEL.sidebar);
        if (side && side.classList.contains("rt-left-hidden")) {
          hideLeft();
          showChat(document, on, state.chat, STRINGS);
        }
      }
    }
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      run();
    });
  });
  state.observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class"],
  });
  state.timer = setInterval(run, READ_EVERY_MS);
  run();
}

function deactivate() {
  if (!state) return;
  returnSessions();
  leaveChat(document, state.chat);
  leaveItem(document, state.item);
  state.observer.disconnect();
  state.unwatch();
  window.electronAPI.sessionState.removeStateChangeListener(state.onSession);
  document.removeEventListener("click", state.onClick);
  clearInterval(state.timer);
  state = null;
  for (const el of document.querySelectorAll(SEL.root)) el.remove();
  for (const el of document.querySelectorAll(".rt-left-hidden"))
    el.classList.remove("rt-left-hidden");
  clearItemViews(document);
  for (const el of document.querySelectorAll("[data-rt-item-chat]"))
    el.removeAttribute("data-rt-item-chat");
  for (const list of document.querySelectorAll(SEL.table))
    list.classList.remove("rt-table-hidden");
  if (window.__jobTracker && window.__jobTracker.deactivate === deactivate)
    delete window.__jobTracker;
}

export {
  activate,
  archiveOldJobs,
  closeStep,
  deactivate,
  failure,
  readSessions,
  STRINGS,
};
