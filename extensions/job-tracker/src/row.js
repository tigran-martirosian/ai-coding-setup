// One step's row in the folds (tracker one-page design 3.8, second and third pass, which win): one line, the mark, the
// title on the left (14/400, 500 in Needs you), and on the right the "Bug" tag, the plan chip (the step's `stage`),
// what it waits on or does, and the session link where a session is linked. A step with a `file` gets a second line:
// a small button "Open <file>" that opens it in the editor. A click on the row opens the item view.
//   mark: Needs you = a filled dot in the needs tone; Running = a thinking orb whose shape says what the session does
//         (its last tool, through the agents panel's own map, stage.js); To do = a grey ring, half filled when the
//         step is marked in progress with no session on it; Done = a grey tick
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

/** The codes (else titles) of the open steps this step waits on: its waits-on text and its `dependsOn` links. */
function waitsOn(step, open) {
  return waitsOnSteps(step, open).map((o) =>
    String(fieldOf(o, "step") || o.title),
  );
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
 * session: null, or { id, title, running, call } for the session linked to the step (call: its last tool call or
 * null; read only for a session that runs), and listed(session id): whether the Sessions column lists that session.
 */
function rowView(strings, row, ctx) {
  const step = row.item;
  const S = strings;
  const since = sinceOf(step);
  const waits = waitsOn(step, ctx.open);
  const waitWords = waits.length
    ? fillIn(S.waitsOn, { codes: waits.join(", ") })
    : null;
  const session = ctx.session;
  let mark;
  let wait;
  let waitTone = null;
  let tip = step.title;
  if (row.fold === "needs") {
    mark = { kind: "dot" };
    wait = waitWords || S.readyForYou;
    if (!waitWords) waitTone = "ready";
  } else if (row.fold === "running") {
    const doing =
      session && session.running && session.call
        ? doingOf(S, session.call)
        : null;
    mark = { kind: "orb", orb: doing ? doing.orb : "working" };
    wait = [
      doing ? doing.words : S.working,
      since ? fillIn(S.since, { date: when(S, since, ctx.now) }) : null,
    ]
      .filter(Boolean)
      .join(S.sep);
    waitTone = "running";
  } else if (row.fold === "todo") {
    mark = { kind: "ring", half: row.started };
    if (row.started) {
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
  const plan = String(fieldOf(step, "stage") || "").trim();
  const file = row.file ? fileParts(row.file) : null;
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
  };
}

function el(doc, tag, cls, text) {
  const e = doc.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

/**
 * The row for `view`. `on`: item(id) on a click on the row, file(path) and session(id) on their links; a link's click
 * does not reach the row.
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
  if (view.file) {
    const line = el(doc, "div", "rt-file-line");
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
    main.append(line);
  }
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
