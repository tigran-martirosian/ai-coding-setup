// One step's row in the folds (tracker one-page design 3.8, second and third pass, which win): one line, the mark, the
// title on the left (14/400, 500 in Needs you), and on the right the "Bug" tag, the plan chip (the step's `stage`),
// what it waits on or does, and the session link where a session is linked. A Needs you step the user can close, and a
// started step whose session ended, have a "Mark done" button. A step with a `file` gets a second line: a small
// button "Open <file>" that opens it in the editor. A click on the row opens the item view.
//   mark: Needs you = a filled dot in the needs tone, the listening orb for a step whose session waits on the user
//         (its action is "Open session"); Running = a thinking orb whose shape says what the session does (its last
//         tool, through the agents panel's own map, stage.js); To do = a grey ring, half filled when the step is
//         marked in progress with no session on it; Done = a grey tick
//   session state words (close approach, Proofs): "needs you" (since it began to wait, when the app says), "no change
//         since <time>" for a running session with no change for a day, "session ended <time>, step not done" for a
//         started step whose session no longer runs. No error word: the app keeps no lasting record of a session's
//         error. A step for the user that waits on an open step says "your turn after <step>", in To do.
// The session facts come from build proofs point 6 and the one-page proofs: sessions:list (linkedTrackerItemIds), the
// running ids, and the last tool call of the session's transcript.

import { stageOf } from "../../agents-panel/src/stage.js";
import { waitsOnSteps } from "./model.js";

const fieldOf = (s, name) => (s.customFields ? s.customFields[name] : null);

const fillIn = (text, values) =>
  text.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in values)) throw new Error(`job-tracker: no value for {${k}}`);
    return values[k];
  });

/**
 * The titles of the open steps this step waits on (its waits-on text and its `dependsOn` links): the plain words the
 * user reads, never a step code (close approach, point 3).
 */
function waitsOn(step, open) {
  return waitsOnSteps(step, open).map((o) => String(o.title));
}

/** When the step got its current status: the activity line that set it, else null. */
function sinceOf(step) {
  const activity = fieldOf(step, "activity");
  const set = (Array.isArray(activity) ? activity : []).filter(
    (a) => a && a.action === "status_changed" && a.newValue === step.status,
  );
  const last = set[set.length - 1];
  return last && last.timestamp ? new Date(last.timestamp) : null;
}

/** "17:20" on the day of `now`, else "13 Nov". */
function when(strings, date, now) {
  const sameDay = date.toDateString() === now.toDateString();
  return sameDay
    ? date.toLocaleTimeString(strings.dateLocale, {
        hour: "2-digit",
        minute: "2-digit",
      })
    : date.toLocaleDateString(strings.dateLocale, {
        day: "numeric",
        month: "short",
      });
}

/** "17:20" on the day of `now`, else "13 Nov 09:10": a session's last change, where the hour matters too. */
function whenAt(strings, date, now) {
  const time = date.toLocaleTimeString(strings.dateLocale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  if (date.toDateString() === now.toDateString()) return time;
  const day = date.toLocaleDateString(strings.dateLocale, {
    day: "numeric",
    month: "short",
  });
  return `${day} ${time}`;
}

// A running session with no change for this long is shown as "no change since <time>"
const QUIET_MS = 24 * 60 * 60 * 1000;

/**
 * The state of a running step's running session (close approach, Proofs, Session states): `quiet` (no change for a
 * day) or `working`; one that waits on the user puts its step in Needs you (model.js rowOf). Only these have a source
 * in the app: an error leaves no lasting record (the app ends the session at once), so no row ever says a session
 * failed.
 */
function sessionStateOf(session, now) {
  if (+now - session.updatedAt >= QUIET_MS) return "quiet";
  return "working";
}

/**
 * What a running session does, from its last tool call ({ toolName, arguments }): the orb's shape from the agents
 * panel's map (a shell command is a "Command", so a test run shows the `solving` orb) and the tool's plain words.
 */
function doingOf(strings, call) {
  const tool = call.toolName;
  const args = call.arguments || {};
  const shell = tool === "Bash" || tool === "PowerShell";
  const text = shell ? `${args.description || ""} ${args.command || ""}` : "";
  const orb = stageOf({ kind: shell ? "Command" : "", tool, text });
  let words = strings.doing[tool];
  if (shell && orb === "solving") words = strings.doingCheck;
  if (!words) words = fillIn(strings.doingOther, { tool });
  return { orb, words };
}

/** The file's name and the folder it sits in ("" at the project's top), from a path with / or \. */
function fileParts(path) {
  const parts = String(path)
    .split(/[\\/]+/)
    .filter(Boolean);
  return { name: parts.pop() || String(path), folder: parts.join("/") };
}

const WINDOWS =
  typeof navigator !== "undefined" && /^win/i.test(navigator.platform ?? "");
/** A Windows device name (COM1, aux.md): opening it reaches a device, not a file. */
const DEVICE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

/**
 * A step's file the Open link may open: a local drive path, or a project path that stays inside the project once
 * `..` is resolved. Anything else (//host, \\host, \\?\, \??\, \\.\, /root, C:name) can reach a network host, whose
 * open makes Windows send the user's sign-in there, or a device.
 */
export function openable(file, windows = WINDOWS) {
  const f = String(file);
  if (/^[\\/]{2}/.test(f)) return false;
  const parts = f.split(/[\\/]+/);
  if (parts.some((p) => DEVICE.test(p))) return false;
  if (/^[a-zA-Z]:[\\/]/.test(f)) return true;
  // an absolute path is a local file on macOS and Linux; on Windows a single / is the drive root, not checked
  if (f.startsWith("/")) return !windows;
  if (/^\\|^[a-zA-Z]:/.test(f)) return false;
  let depth = 0;
  for (const part of parts) {
    if (part === "..") depth--;
    else if (part && part !== ".") depth++;
    if (depth < 0) return false;
  }
  return true;
}

/**
 * The session link: its word and hover. A session the Sessions column lists opens in the chat beside the page; one it
 * does not list opens in the Sessions view, and the hover says so (tracker chat design, section 5).
 */
function sessionLink(S, session, listed) {
  const named = session.title
    ? fillIn(S.openSessionNamed, { title: session.title })
    : S.openSessionLinked;
  return {
    id: session.id,
    word: S.openSession,
    tip: listed ? named : `${named}\n${S.opensInSessions}`,
  };
}

/**
 * The row's view for `row` (model.js rowOf). `ctx`: open (the shown steps that are open, model.js openSteps), now,
 * session: null, or { id, title, running, waiting, waitingSince, updatedAt, call } for the session linked to the step
 * (waiting: it waits on the user; waitingSince: since when in ms, or null when the app does not say; updatedAt: its
 * last change in ms; call: its last tool call or null, read only for a session that runs), listed(session id):
 * whether the Sessions column lists that session, and failed: a Map of step id -> what failed when its Mark done
 * button's write did not go through (left out: none failed). A row the user can close gets `done`, its button's word
 * and hover; a failed write shows in its words instead.
 */
function rowView(strings, row, ctx) {
  const step = row.item;
  const S = strings;
  const since = sinceOf(step);
  const waits = waitsOn(step, ctx.open);
  const waitWords = waits.length
    ? fillIn(S.waitsOn, { steps: waits.join(S.waitsSep) })
    : null;
  const session = ctx.session;
  let mark;
  let wait;
  let waitTone = null;
  let tip = step.title;
  let done = null;
  if (row.fold === "needs" && row.asks) {
    // A started step whose session waits on the user: the agents panel's and the phone app's words and orb. The user
    // answers in the session, so its action is the session link, not Mark done. The time is when it began to wait,
    // only when the app says
    mark = { kind: "orb", orb: "listening" };
    const at =
      session && session.waitingSince != null
        ? fillIn(S.since, {
            date: whenAt(S, new Date(session.waitingSince), ctx.now),
          })
        : null;
    wait = [S.sessionWaiting, at].filter(Boolean).join(S.sep);
    waitTone = "attention";
  } else if (row.fold === "needs") {
    mark = { kind: "dot" };
    wait = S.readyForYou;
    waitTone = "ready";
    done = { word: S.doneButton, tip: S.doneTip };
  } else if (row.fold === "running") {
    const live = session && session.running ? session : null;
    const doing = live && live.call ? doingOf(S, live.call) : null;
    const sessionState = live ? sessionStateOf(live, ctx.now) : "working";
    mark = { kind: "orb", orb: doing ? doing.orb : "working" };
    let words = doing ? doing.words : S.working;
    let at = since ? fillIn(S.since, { date: when(S, since, ctx.now) }) : null;
    waitTone = "running";
    if (sessionState === "quiet") {
      words = fillIn(S.noChangeSince, {
        date: whenAt(S, new Date(live.updatedAt), ctx.now),
      });
      at = null;
      waitTone = "attention";
    }
    wait = [words, at].filter(Boolean).join(S.sep);
  } else if (row.fold === "todo") {
    mark = { kind: "ring", half: row.started };
    if (row.started && session && !session.running && !session.waiting) {
      // Marked in progress, but its session no longer runs: stopped or finished look the same in the app, so the
      // user may close the step
      wait = fillIn(S.sessionEnded, {
        date: whenAt(S, new Date(session.updatedAt), ctx.now),
      });
      waitTone = "attention";
      tip = `${step.title}\n${S.startedTip}`;
      done = { word: S.doneButton, tip: S.doneTip };
    } else if (row.blocked) {
      // The user's step, but an open step comes first: not the user's move yet, so no Mark done
      wait = fillIn(S.yourTurnAfter, { steps: waits.join(S.waitsSep) });
    } else if (row.started) {
      wait = since
        ? fillIn(S.startedOn, { date: when(S, since, ctx.now) })
        : S.startedNoSession;
      tip = `${step.title}\n${S.startedTip}`;
    } else {
      wait = waitWords || S.ready;
      if (!waitWords) waitTone = "ready";
    }
  } else {
    mark = { kind: "tick" };
    wait = row.dropped
      ? S.dropped
      : when(S, since || new Date(step.updated), ctx.now);
  }
  const failed = done && ctx.failed ? ctx.failed.get(step.id) : null;
  if (failed) {
    wait = fillIn(S.doneFailed, { error: failed });
    waitTone = "failed";
  }
  const plan = String(fieldOf(step, "stage") || "").trim();
  // The file comes from sessions and file frontmatter: a network path gets no Open link
  const file = row.file && openable(row.file) ? fileParts(row.file) : null;
  return {
    id: step.id,
    fold: row.fold,
    dropped: row.dropped,
    mark,
    title: step.title,
    tip,
    bug: row.bug ? S.bug : null,
    plan: plan || null,
    wait,
    waitTone,
    file: file
      ? {
          path: row.file,
          word: fillIn(S.openFile, { name: file.name }),
          note: file.folder ? fillIn(S.fileIn, { folder: file.folder }) : null,
          tip: `${row.file}\n${S.openInEditor}`,
        }
      : null,
    session: session ? sessionLink(S, session, ctx.listed(session.id)) : null,
    done,
  };
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * The row for `view`. `on`: item(id) on a click on the row, file(path) and session(id) on their links, done(id) on
 * the Done button; a link's or button's click does not reach the row.
 */
function renderRow(doc, view, on) {
  const row = el(doc, "div", `rt-row rt-row-${view.fold}`);
  if (view.dropped) row.classList.add("rt-row-dropped");
  row.dataset.step = view.id;
  row.title = view.tip;
  const mark = el(doc, "span", "rt-mark");
  if (view.mark.kind === "orb") {
    const orb = doc.createElement("canvas");
    orb.dataset.orb = view.mark.orb;
    orb.dataset.orbPx = "20";
    orb.setAttribute("aria-hidden", "true");
    mark.append(orb);
  } else {
    mark.append(
      el(
        doc,
        "span",
        `rt-${view.mark.kind}${view.mark.half ? " rt-half" : ""}`,
      ),
    );
  }
  const main = el(doc, "div", "rt-row-main");
  // The title is the row's button, so the keyboard reaches the item too
  const title = el(doc, "button", "rt-row-title", view.title);
  title.type = "button";
  main.append(title);
  // The second line: the file link, then the Done button
  const line = view.file || view.done ? el(doc, "div", "rt-file-line") : null;
  if (view.file) {
    const link = el(doc, "button", "rt-file");
    link.type = "button";
    link.title = view.file.tip;
    link.dataset.file = view.file.path;
    link.append(el(doc, "span", "rt-file-icon"), view.file.word);
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      on.file(view.file.path);
    });
    line.append(link);
    if (view.file.note)
      line.append(el(doc, "span", "rt-file-note", view.file.note));
  }
  if (view.done) {
    const b = el(doc, "button", "rt-done-button", view.done.word);
    b.type = "button";
    b.title = view.done.tip;
    b.dataset.done = view.id;
    b.addEventListener("click", (e) => {
      e.stopPropagation();
      on.done(view.id);
    });
    line.append(b);
  }
  if (line) main.append(line);
  // Three fixed slots (chips, words, link), present on every row, so each one lines up down the page
  const right = el(doc, "div", "rt-row-right");
  const chips = el(doc, "span", "rt-chips");
  if (view.bug) chips.append(el(doc, "span", "rt-chip rt-chip-bug", view.bug));
  if (view.plan) chips.append(el(doc, "span", "rt-chip", view.plan));
  const wait = el(
    doc,
    "span",
    `rt-wait${view.waitTone ? ` rt-wait-${view.waitTone}` : ""}`,
    view.wait,
  );
  wait.title = view.wait;
  right.append(chips, wait);
  if (!view.session) right.append(el(doc, "span", "rt-session-slot"));
  if (view.session) {
    const s = el(doc, "button", "rt-session", view.session.word);
    s.type = "button";
    s.title = view.session.tip;
    s.dataset.session = view.session.id;
    s.addEventListener("click", (e) => {
      e.stopPropagation();
      on.session(view.session.id);
    });
    right.append(s);
  }
  row.append(mark, main, right);
  row.addEventListener("click", () => on.item(view.id));
  return row;
}

export { doingOf, fillIn, renderRow, rowView, waitsOn };
