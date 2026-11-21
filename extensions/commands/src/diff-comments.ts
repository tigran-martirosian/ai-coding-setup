// Comments on the lines of the Agent view's Review panel, kept per session and sent to it as one
// message through the Note button's send (note.ts): a busy session reads them before its next step,
// an idle one starts its next turn with them.
//
// This reaches into the app's own markup (the panel's react-diff-view table), so an app update may
// break it; when it does the "+" just does not appear. The table is React's and nothing is put into it:
// the "+", the comment boxes and the bar live in a layer of their own in document.body, laid over the
// panel. The rows only get data attributes and a gap under them, put back from the store each time
// React draws them again. The file list is virtualised, so the count comes from the store, never the DOM.

import type { Invoke } from "../../shared/host.ts";
import { hostError } from "../../shared/host.ts";
import type { Outcome, Pending } from "./note.ts";
import { homeDir, noteEnds, sendNote } from "./note.ts";
import { t } from "./strings.ts";

/** Removed lines are counted on the old side, the rest on the new side. */
export type Side = "new" | "old";
/** One row of the diff, as read from its cells. */
export interface RowLine {
  /** react-diff-view's data-change-key (D1, I5, N3) */
  key: string;
  side: Side;
  n: number;
  code: string;
}
export interface DiffComment {
  id: string;
  /** the section's data-file-path */
  file: string;
  side: Side;
  start: number;
  end: number;
  /** every row it covers, in the diff's order */
  keys: string[];
  /** each covered row's code, as `keys`: the comment is shown only while all of them still read so */
  codes: string[];
  /** the row whose code is `code`, the one the message quotes */
  anchor: string;
  code: string;
  text: string;
  at: number;
}
/** The part of a table cell read here, so a test can pass plain objects. */
export interface CellLike {
  className: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
}

const has = (c: CellLike, cls: string) =>
  ` ${c.className} `.includes(` ${cls} `);

/** A diff row's line, or null for a row that is not a line (a hunk header, a widget). */
export function readRow(cells: ArrayLike<CellLike>): RowLine | null {
  const list = Array.from(cells);
  // first gutter: the old line number, second: the new one; empty when the line has none
  const gutters = list.filter((c) => has(c, "diff-gutter"));
  const code = list.find((c) => has(c, "diff-code"));
  const key = code?.getAttribute("data-change-key");
  if (gutters.length !== 2 || !code || !key) return null;
  const num = (c: CellLike) => {
    const s = (c.textContent ?? "").trim();
    return /^\d+$/.test(s) ? Number(s) : null;
  };
  const side: Side = has(code, "diff-code-delete") ? "old" : "new";
  const n = num(side === "old" ? gutters[0] : gutters[1]);
  if (n === null) return null;
  return { key, side, n, code: code.textContent ?? "" };
}

/** The rows from `a` to `b` (either order), or null when one of them is not among `rows`. */
export function rangeRows(rows: RowLine[], a: string, b: string) {
  const i = rows.findIndex((r) => r.key === a);
  const j = rows.findIndex((r) => r.key === b);
  if (i < 0 || j < 0) return null;
  return rows.slice(Math.min(i, j), Math.max(i, j) + 1);
}

/** Where a set of rows is: new line numbers when it holds any, else old ones (only removed lines). */
export function rangeOf(rows: RowLine[]) {
  if (!rows.length) throw new Error("a comment needs at least one line");
  const side: Side = rows.some((r) => r.side === "new") ? "new" : "old";
  const own = rows.filter((r) => r.side === side);
  const nums = own.map((r) => r.n);
  return {
    side,
    start: Math.min(...nums),
    end: Math.max(...nums),
    anchor: own[0].key,
    code: own[0].code,
  };
}

export const makeComment = (
  file: string,
  rows: RowLine[],
  text: string,
  id: string,
  at: number,
): DiffComment => ({
  id,
  file,
  ...rangeOf(rows),
  keys: rows.map((r) => r.key),
  codes: rows.map((r) => r.code),
  text: text.trim(),
  at,
});

export const lineLabel = (c: { side: Side; start: number; end: number }) =>
  c.side === "old"
    ? c.start === c.end
      ? t.diff.oldLine(c.start)
      : t.diff.oldLines(c.start, c.end)
    : c.start === c.end
      ? t.diff.line(c.start)
      : t.diff.lines(c.start, c.end);

export const CODE_MAX = 120;

/**
 * The line's code for the message: trimmed, cut past CODE_MAX characters, in backticks. A line that holds
 * backticks gets a fence one longer than its longest run of them, so the fence cannot end early.
 */
export function shortCode(code: string) {
  const s = code.trim();
  if (!s) return t.diff.blank;
  const cut = s.length > CODE_MAX ? `${s.slice(0, CODE_MAX)}…` : s;
  const run = Math.max(0, ...(cut.match(/`+/g) ?? []).map((m) => m.length));
  if (!run) return `\`${cut}\``;
  const fence = "`".repeat(run + 1);
  return `${fence} ${cut} ${fence}`;
}

/** The path relative to the project when it is inside it; the panel gives absolute paths. */
export function shownPath(file: string, root: string) {
  if (!root) return file;
  const norm = (p: string) => p.replace(/\\/g, "/").replace(/\/+$/, "");
  const f = norm(file);
  const r = norm(root);
  // Windows paths ignore case
  const inside = /^[A-Za-z]:/.test(f)
    ? f.toLowerCase().startsWith(`${r.toLowerCase()}/`)
    : f.startsWith(`${r}/`);
  return inside ? f.slice(r.length + 1) : file;
}

/** A path longer than this is shown on a comment's card by its file name only. */
export const PATH_MAX = 40;

/** A saved comment's card: its file as the message names it (only the file name when that is long), and its lines. */
export function cardLabel(
  c: { file: string; side: Side; start: number; end: number },
  root = "",
) {
  const path = shownPath(c.file, root);
  const name =
    path.length > PATH_MAX ? path.replace(/\\/g, "/").split("/").pop() : path;
  return `${name}, ${lineLabel(c)}`;
}

/** By file, then line. */
export const ordered = (list: DiffComment[]) =>
  [...list].sort(
    (a, b) =>
      (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) ||
      a.start - b.start ||
      (a.side === b.side ? 0 : a.side === "old" ? -1 : 1) ||
      a.at - b.at,
  );

/** The one message the agent gets; the comments in `moved` are labelled as on a line that changed. */
export function buildMessage(
  list: DiffComment[],
  root = "",
  moved: ReadonlySet<string> = new Set(),
) {
  const items = ordered(list).map((c, i) => {
    const text = c.text
      .split(/\r?\n/)
      .map((l) => `   ${l}`.trimEnd())
      .join("\n");
    const where = moved.has(c.id)
      ? `${lineLabel(c)} ${t.diff.movedLabel}`
      : lineLabel(c);
    return `${i + 1}. ${shownPath(c.file, root)}, ${where}: ${shortCode(c.code)}\n${text}`;
  });
  return [t.diff.header(list.length), ...items].join("\n\n");
}

/**
 * One file's comments against the rows drawn for it now. `placed`: every row a comment covers is there
 * and reads as when it was saved. `moved`: the rest, when the file's rows are drawn at all; a file with
 * no rows drawn (collapsed, or not loaded) says nothing about where its comments are.
 */
export function placeComments(list: DiffComment[], rows: RowLine[]) {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  const placed: { comment: DiffComment; keys: string[]; last: string }[] = [];
  const moved: DiffComment[] = [];
  for (const c of list) {
    if (c.keys.every((k, i) => byKey.get(k)?.code === c.codes[i]))
      placed.push({
        comment: c,
        keys: c.keys,
        last: c.keys[c.keys.length - 1],
      });
    else if (rows.length) moved.push(c);
  }
  return { placed, moved };
}

/** Whether a stored value has the shape of a comment: one bad entry must not hide the others. */
export function isComment(v: unknown): v is DiffComment {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  const str = (x: unknown) => typeof x === "string";
  const num = (x: unknown) => typeof x === "number" && Number.isFinite(x);
  const strs = (x: unknown): x is string[] => Array.isArray(x) && x.every(str);
  return (
    str(c.id) &&
    str(c.file) &&
    (c.side === "new" || c.side === "old") &&
    num(c.start) &&
    num(c.end) &&
    strs(c.keys) &&
    c.keys.length > 0 &&
    strs(c.codes) &&
    c.codes.length === c.keys.length &&
    str(c.anchor) &&
    str(c.code) &&
    str(c.text) &&
    num(c.at)
  );
}

/** A comment box needs this much room right of the code column, else it starts at the shown left edge. */
export const BOX_ROOM = 240;

/**
 * Where a comment box goes across, in page pixels: from the code column to the row's end, kept inside
 * `shown` (the part of the diff in view: its sideways scroll cut to the list's client area, without the
 * list's scrollbar), so its buttons are never cut off. With little room right of the code column the
 * box starts at the shown left edge instead.
 */
export function boxSpan(
  codeLeft: number,
  rowRight: number,
  shown: { left: number; right: number },
  air: number,
) {
  const right = Math.min(rowRight, shown.right);
  let left = Math.max(codeLeft, shown.left);
  if (right - left < BOX_ROOM) left = shown.left;
  return { left, width: Math.max(right - left - air, 0) };
}

/** The id the open comment box is drawn under, apart from the saved comments' ids. */
export const DRAFT_ID = "draft";

/**
 * The boxes under one row, stacked in the given order with the open box last: the row's gap holds them
 * all, each with `air` around it, and `tops` says how far below the gap's top each box starts.
 */
export function stackBoxes(
  boxes: { id: string; height: number }[],
  air: number,
) {
  const order = [
    ...boxes.filter((b) => b.id !== DRAFT_ID),
    ...boxes.filter((b) => b.id === DRAFT_ID),
  ];
  const tops = new Map<string, number>();
  let gap = 0;
  for (const b of order) {
    tops.set(b.id, gap + air / 2);
    gap += b.height + air;
  }
  return { gap, tops };
}

/**
 * Whether Send all must wait for the open comment box of `session`: it holds text not saved yet (a new
 * comment with text, or an edit that differs from its comment, or one whose comment is gone).
 */
export function draftUnsaved(
  draft: { session: string; editId?: string; text: string } | null,
  session: string,
  comments: DiffComment[],
) {
  if (!draft || draft.session !== session) return false;
  const text = draft.text.trim();
  const saved = draft.editId
    ? comments.find((c) => c.id === draft.editId)
    : undefined;
  return saved ? text !== saved.text : text !== "";
}

/** The list with the comments of `sent` added back at its end, except those whose id is still in it. */
export function withRestored(list: DiffComment[], sent: DiffComment[]) {
  const ids = new Set(list.map((c) => c.id));
  return [...list, ...sent.filter((c) => !ids.has(c.id))];
}

/** The part of localStorage the store uses, so a test can pass its own. */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}
export const storeKey = (session: string) => `diffComments:${session}`;

export type Store = ReturnType<typeof commentStore>;

/** The comments of each session, under `diffComments:<session id>`, until sent or cleared. */
export function commentStore(storage: KeyValue) {
  const listeners = new Set<() => void>();
  const list = (session: string): DiffComment[] => {
    const key = storeKey(session);
    const raw = storage.getItem(key);
    if (raw === null) return [];
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch (e) {
      throw new Error(`${key} is not valid JSON: ${(e as Error).message}`);
    }
    if (!Array.isArray(value))
      throw new Error(`${key} is not a list of comments`);
    return value.filter(isComment);
  };
  const write = (session: string, next: DiffComment[]) => {
    if (next.length) storage.setItem(storeKey(session), JSON.stringify(next));
    else storage.removeItem(storeKey(session));
    for (const f of listeners) f();
  };
  return {
    list,
    add: (session: string, c: DiffComment) =>
      write(session, [...list(session), c]),
    edit: (session: string, id: string, text: string) =>
      write(
        session,
        list(session).map((c) =>
          c.id === id ? { ...c, text: text.trim() } : c,
        ),
      ),
    remove: (session: string, ids: string[]) =>
      write(
        session,
        list(session).filter((c) => !ids.includes(c.id)),
      ),
    /** Drops the comments that went out: one edited since keeps its new text and stays. */
    removeSent: (session: string, sent: DiffComment[]) =>
      write(
        session,
        list(session).filter(
          (c) => !sent.some((s) => s.id === c.id && s.text === c.text),
        ),
      ),
    /** Puts back the comments of a batch that was not delivered: one still in the list stays as it is. */
    putBack: (session: string, sent: DiffComment[]) =>
      write(session, withRestored(list(session), sent)),
    clear: (session: string) => write(session, []),
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => void listeners.delete(f);
    },
  };
}

export interface Sent extends Outcome {
  count: number;
  /** the comments in the batch, as they went: put back when its note is not delivered */
  comments: DiffComment[];
  /** the home folder the note's receipt will be in */
  home?: string;
}

/** The start of the batch's note file name, apart from the Note button's. */
export const NOTE_TAG = "diff-note";

/**
 * Sends the session's comments as one message (those in `moved` labelled so). On success the comments
 * that went are removed (one written or edited during the send stays); on failure all stay and the
 * reason is the message.
 */
export async function sendBatch(
  session: string,
  store: Store,
  invoke: Invoke,
  root = "",
  moved: ReadonlySet<string> = new Set(),
  send: typeof sendNote = sendNote,
  home: typeof homeDir = homeDir,
): Promise<Sent> {
  const list = store.list(session);
  if (!list.length)
    return { ok: false, message: t.diff.none, count: 0, comments: [] };
  let folder: string;
  try {
    folder = await home(invoke);
  } catch (e) {
    return {
      ok: false,
      message: t.note.notSent(hostError(e)),
      count: list.length,
      comments: list,
    };
  }
  const out = await send(
    buildMessage(list, root, moved),
    session,
    folder,
    invoke,
    [],
    NOTE_TAG,
  );
  if (out.ok) store.removeSent(session, list);
  return {
    ...out,
    message: batchOutcome(out),
    count: list.length,
    comments: list,
    home: folder,
  };
}

/**
 * The batch's own words for what sendNote says, which speaks of a note. Outcome has no state field, so
 * the state is read from which of note.ts's lines it is; the queued lines and a failure's reason
 * ("Not sent: …") name no note and stay as they are.
 */
export function batchOutcome(out: Outcome) {
  if (out.ok && out.noteId) return t.diff.waiting;
  if (out.message === t.note.untracked) return t.diff.untracked;
  if (out.message === t.note.oddId) return t.diff.oddId;
  return out.message;
}

/**
 * The batch's words for how its note ended (noteEnds' state), as endMessage says it for the Note button.
 * A batch not delivered has its comments put back in the list (store.putBack).
 */
export const batchEnd = (state: string): Outcome =>
  state === "delivered"
    ? { ok: true, message: t.diff.delivered }
    : { ok: false, message: t.diff.notConfirmed };

/** The bar's line after a send went out: how many comments went, then what became of them. */
export const sentLine = (count: number, outcome: string) =>
  `${t.diff.sent(count)}. ${outcome}`;

// ---- the page: the "+", the boxes and the bar over every Review panel in view

const TAG = "[commandbuttons]";
const LAYER = "data-dc-layer";
const PANEL = ".agent-review-panel";
const FILE = "section.agent-review-panel__file[data-file-path]";
const NOTE_POLL_MS = 2000;
const SESSION_CHECK_MS = 1000;
// the gap under a row is its boxes' heights and this much air for each
const GAP_AIR = 8;

type Kind = "ok" | "bad" | "busy" | "held";
interface Status {
  kind: Kind;
  message: string;
}
/**
 * The comment being written: a new one on `rows` (read when its "+" was clicked, so Save works even
 * when React has drawn the rows again), or the saved one `editId`. `anchor` is the first row clicked.
 */
interface Draft {
  session: string;
  file: string;
  anchor: string;
  rows: RowLine[];
  editId?: string;
  text: string;
}
interface Box {
  el: HTMLElement;
  sig: string;
  where?: HTMLElement;
  input?: HTMLTextAreaElement;
  /** turns off the buttons that change a comment while the session's comments are being sent */
  lock: (busy: boolean) => void;
}
/** What is drawn over one Review panel. */
interface View {
  root: HTMLElement;
  clip: HTMLElement;
  plus: HTMLButtonElement;
  bar: HTMLElement;
  count: HTMLElement;
  state: HTMLElement;
  words: HTMLElement;
  status: HTMLElement;
  send: HTMLButtonElement;
  clear: HTMLButtonElement;
  dropMoved: HTMLButtonElement;
  /** Clear's question, and its two answers */
  ask: HTMLElement;
  clearYes: HTMLButtonElement;
  keep: HTMLButtonElement;
  boxes: Map<string, Box>;
  session: string;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls: string,
  text = "",
) => {
  const e = document.createElement(tag);
  e.className = cls;
  if (text) e.textContent = text;
  return e;
};
const button = (cls: string, text: string, title = "") => {
  const b = el("button", cls, text);
  b.type = "button";
  if (title) b.title = title;
  return b;
};

/**
 * The session shown in the Agent view the panel is in: the batch always goes there. With more than one
 * session shown it is "" (no "+", no bar): guessing could send the comments to the wrong one.
 */
function sessionOf(panel: Element) {
  const shown = [
    ...(panel
      .closest(".agent-mode")
      ?.querySelectorAll<HTMLElement>(
        ".agent-session-panel[data-session-id]",
      ) ?? []),
  ].filter((p) => p.offsetParent !== null);
  return shown.length === 1
    ? (shown[0].getAttribute("data-session-id") ?? "")
    : "";
}

// The open project, the same way the Commands popover reads it (index.tsx)
const openProject = () =>
  (window as unknown as { workspacePath?: string; __workspacePath?: string })
    .workspacePath ??
  (window as unknown as { __workspacePath?: string }).__workspacePath ??
  "";

const newId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Starts watching the page for Review panels. Returns a function that stops it and removes it all. */
export function startDiffComments(
  invoke: Invoke,
  storage: KeyValue = window.localStorage,
): () => void {
  const store = commentStore(storage);
  const views = new Map<Element, View>();
  const status = new Map<string, Status>();
  // a note that was not confirmed: kept above the other messages until its close is clicked
  const held = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const sending = new Set<string>();
  // per session, the comments whose file's rows are drawn but no longer read as saved; kept while the
  // file is out of view (the list is virtualised), dropped when the comment is placed again
  const movedIds = new Map<string, Set<string>>();
  const pending: Pending[] = [];
  // per batch on its way: how many comments went, the bar line that says so, and the comments themselves,
  // put back when the note is not delivered
  const batches = new Map<
    Pending,
    { count: number; shown: Status; comments: DiffComment[] }
  >();
  // the sessions whose bar asks whether to clear all their comments
  const asking = new Set<string>();
  const complained = new Set<string>();
  let draft: Draft | null = null;
  let focusDraft = false;
  let hover: { panel: Element; row: HTMLTableRowElement } | null = null;
  let frame: number | undefined;
  let lastSessions = "";
  let stopped = false;

  const warn = (what: string, err: unknown) => {
    const m = `${TAG} diff comments: ${what}: ${hostError(err)}`;
    if (complained.has(m)) return;
    complained.add(m);
    console.warn(m);
  };
  const schedule = () => {
    if (stopped) return;
    frame ??= requestAnimationFrame(() => {
      frame = undefined;
      // a frame already queued when stop ran must not draw the overlay back
      if (stopped) return;
      try {
        render();
      } catch (err) {
        warn("drawing", err);
      }
    });
  };

  // The same messages and times as the Note button. A note that was not confirmed ("held") stays until
  // its close is clicked: later messages show under it and a second one is added to it. A `keep` message
  // (a batch on its way) stays until its end is shown. Returns the status set, none for a held one.
  const say = (
    session: string,
    kind: Kind,
    message: string,
    keep = false,
  ): Status | undefined => {
    if (kind === "held") {
      const now = held.get(session);
      held.set(session, now ? `${now}\n${message}` : message);
      schedule();
      return undefined;
    }
    const shown = { kind, message };
    status.set(session, shown);
    clearTimeout(timers.get(session));
    if (!keep && (kind === "ok" || kind === "bad"))
      timers.set(
        session,
        setTimeout(
          () => {
            status.delete(session);
            schedule();
          },
          kind === "ok" ? 3000 : 6000,
        ),
      );
    schedule();
    return shown;
  };
  // A store write can fail (a full localStorage); the bar says so and the caller keeps what was typed
  const change = (session: string, f: () => void) => {
    try {
      f();
      return true;
    } catch (err) {
      say(session, "bad", hostError(err));
      return false;
    }
  };

  let notePoll: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  const pollNotes = async () => {
    if (polling) return;
    polling = true;
    try {
      for (const { note, state } of await noteEnds(pending, invoke)) {
        pending.splice(pending.indexOf(note), 1);
        const batch = batches.get(note);
        batches.delete(note);
        if (!batch) throw new Error(`note ${note.id} has no batch`);
        // the "on their way" line, while still shown, gives way to the end
        if (status.get(note.session) === batch.shown) {
          clearTimeout(timers.get(note.session));
          status.delete(note.session);
        }
        const end = batchEnd(state);
        let message = end.message;
        if (!end.ok)
          try {
            store.putBack(note.session, batch.comments);
          } catch (err) {
            message = t.diff.notBack(hostError(err));
          }
        say(
          note.session,
          end.ok ? "ok" : "held",
          sentLine(batch.count, message),
        );
      }
      if (!pending.length) {
        clearInterval(notePoll);
        notePoll = undefined;
      }
    } catch (err) {
      warn("note receipts", err);
    } finally {
      polling = false;
    }
  };

  const sendAll = async (session: string) => {
    if (!session || sending.has(session)) return;
    // the batch goes from the store: text typed in an open box would not go, and would be lost
    let unsaved = false;
    if (
      !change(session, () => {
        unsaved = draftUnsaved(draft, session, store.list(session));
      })
    )
      return;
    if (unsaved) {
      say(session, "bad", t.diff.saveFirst);
      return;
    }
    sending.add(session);
    say(session, "busy", t.note.sending);
    try {
      const out = await sendBatch(
        session,
        store,
        invoke,
        openProject(),
        new Set(movedIds.get(session)),
      );
      if (!out.ok) {
        say(session, "bad", out.message);
        return;
      }
      // the bar says how many went; a batch whose end is followed keeps its line until that end shows
      const followed = !!out.noteId && !!out.home && !stopped;
      const shown = say(
        session,
        "ok",
        sentLine(out.count, out.message),
        followed,
      );
      if (followed && out.noteId && out.home && shown) {
        const note: Pending = {
          id: out.noteId,
          session,
          home: out.home,
          ts: Date.now(),
          text: t.diff.pending(out.count),
        };
        pending.push(note);
        batches.set(note, { count: out.count, shown, comments: out.comments });
        notePoll ??= setInterval(pollNotes, NOTE_POLL_MS);
      }
    } catch (err) {
      say(session, "bad", t.note.notSent(hostError(err)));
    } finally {
      sending.delete(session);
      schedule();
    }
  };

  // Uses the rows read when the box was opened, so it works while React draws the rows again. When it
  // cannot save, the bar says why and the box keeps its text.
  const save = () => {
    const d = draft;
    if (!d || sending.has(d.session)) return;
    const text = d.text.trim();
    if (!text) return;
    const id = d.editId;
    if (id) {
      let there = false;
      if (
        !change(d.session, () => {
          there = store.list(d.session).some((c) => c.id === id);
        })
      )
        return;
      if (!there) {
        // removed in another window meanwhile: the box stays, and Save makes the text a new comment
        draft = { ...d, editId: undefined };
        say(d.session, "bad", t.diff.gone);
        return;
      }
      if (!change(d.session, () => store.edit(d.session, id, text))) return;
    } else if (
      !change(d.session, () =>
        store.add(
          d.session,
          makeComment(d.file, d.rows, text, newId(), Date.now()),
        ),
      )
    )
      return;
    draft = null;
    schedule();
  };
  const cancel = () => {
    draft = null;
    schedule();
  };

  // The "+" was clicked on `row`: a new comment there, or (Shift) the open one grows to it
  const open = (view: View, row: HTMLTableRowElement, shift: boolean) => {
    const section = row.closest(FILE);
    const file = section?.getAttribute("data-file-path");
    const line = readRow(row.cells);
    const session = view.session;
    if (!section || !file || !line || !session || sending.has(session)) return;
    if (
      shift &&
      draft &&
      !draft.editId &&
      draft.session === session &&
      draft.file === file
    ) {
      const span = rangeRows(sectionRows(section).rows, draft.anchor, line.key);
      if (!span) {
        say(session, "bad", t.diff.rangeGone);
        return;
      }
      draft = { ...draft, rows: span };
    } else
      draft = {
        session,
        file,
        anchor: line.key,
        rows: [line],
        // text typed for another line moves with the box
        text: draft && !draft.editId ? draft.text : "",
      };
    focusDraft = true;
    schedule();
  };

  /** A file section's diff rows as drawn now, and the row element of each change key. */
  const sectionRows = (section: Element) => {
    const trs = [
      ...section.querySelectorAll<HTMLTableRowElement>("tr.diff-line"),
    ];
    const rows: RowLine[] = [];
    const byKey = new Map<string, HTMLTableRowElement>();
    for (const tr of trs) {
      const line = readRow(tr.cells);
      if (!line) continue;
      rows.push(line);
      byKey.set(line.key, tr);
    }
    return { trs, rows, byKey };
  };

  const statusDrop = (session: string) => {
    clearTimeout(timers.get(session));
    status.delete(session);
    held.delete(session);
    schedule();
  };

  const makeView = (): View => {
    const root = el("div", "dc-layer");
    root.setAttribute(LAYER, "");
    const clip = el("div", "dc-clip");
    const plus = button("dc-plus", "+", t.diff.add);
    plus.setAttribute("aria-label", t.diff.add);
    plus.hidden = true;
    // keep the focus where it is, so a draft's text box does not lose it on a Shift+click
    plus.addEventListener("mousedown", (e) => e.preventDefault());
    plus.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (hover?.row.isConnected && views.get(hover.panel) === view)
        open(view, hover.row, e.shiftKey);
    });
    clip.append(plus);
    const bar = el("div", "dc-bar");
    bar.hidden = true;
    const count = el("span", "dc-count");
    const status = el("div", "dc-status");
    status.setAttribute("role", "status");
    const state = el("span", "dc-state");
    const words = el("span", "dc-status-text");
    const close = button("dc-close", "×", t.note.dismiss);
    close.setAttribute("aria-label", t.note.dismiss);
    close.addEventListener("click", () => {
      if (view.session) statusDrop(view.session);
    });
    status.append(state, words, close);
    // Clear asks on the bar first: "Clear N comments?" with Clear and Keep
    const clear = button("dc-btn", t.diff.clear, t.diff.clearHint);
    clear.addEventListener("click", () => {
      const s = view.session;
      if (!s || sending.has(s)) return;
      asking.add(s);
      schedule();
    });
    const ask = el("span", "dc-ask");
    const clearYes = button("dc-btn", t.diff.clear, t.diff.clearHint);
    clearYes.addEventListener("click", () => {
      const s = view.session;
      if (!s || sending.has(s)) return;
      asking.delete(s);
      if (draft?.session === s && draft.editId) draft = null;
      if (!change(s, () => store.clear(s))) schedule();
    });
    const keep = button("dc-btn", t.diff.keep);
    keep.addEventListener("click", () => {
      asking.delete(view.session);
      schedule();
    });
    const dropMoved = button(
      "dc-btn",
      t.diff.removeMoved,
      t.diff.removeMovedHint,
    );
    dropMoved.addEventListener("click", () => {
      const s = view.session;
      const ids = [...(movedIds.get(s) ?? [])];
      if (!s || !ids.length || sending.has(s)) return;
      if (draft?.session === s && draft.editId && ids.includes(draft.editId))
        draft = null;
      change(s, () => store.remove(s, ids));
    });
    const send = button("dc-btn primary", t.diff.sendAll, t.diff.sendHint);
    send.addEventListener("click", () => void sendAll(view.session));
    bar.append(count, status, dropMoved, clear, send, ask, clearYes, keep);
    root.append(clip, bar);
    // the app's keys must not act on what is typed in a box
    root.addEventListener("keydown", (e) => e.stopPropagation());
    document.body.append(root);
    const view: View = {
      root,
      clip,
      plus,
      bar,
      count,
      state,
      words,
      status,
      send,
      clear,
      dropMoved,
      ask,
      clearYes,
      keep,
      boxes: new Map(),
      session: "",
    };
    return view;
  };

  // `rows`: the rows the comment covers, as drawn (it is placed, so they read as saved)
  const savedBox = (session: string, c: DiffComment, rows: RowLine[]): Box => {
    const box = el("div", "dc-box");
    const text = el("div", "dc-text", c.text);
    const row = el("div", "dc-actions");
    const where = el("span", "dc-where", cardLabel(c, openProject()));
    where.title = c.file;
    const edit = button("dc-btn", t.diff.edit);
    edit.addEventListener("click", () => {
      if (sending.has(session)) return;
      draft = {
        session,
        file: c.file,
        anchor: c.anchor,
        rows,
        editId: c.id,
        text: c.text,
      };
      focusDraft = true;
      schedule();
    });
    const remove = button("dc-btn", t.diff.remove);
    remove.addEventListener("click", () => {
      if (!sending.has(session))
        change(session, () => store.remove(session, [c.id]));
    });
    row.append(where, edit, remove);
    box.append(text, row);
    return {
      el: box,
      sig: savedSig(c),
      lock: (busy) => {
        edit.disabled = remove.disabled = busy;
      },
    };
  };
  const savedSig = (c: DiffComment) => `${c.id}\n${c.text}`;

  const draftBox = (d: Draft): Box => {
    const box = el("div", "dc-box dc-draft");
    const where = el("div", "dc-where");
    const input = el("textarea", "dc-input");
    input.rows = 3;
    input.placeholder = t.diff.placeholder;
    input.value = d.text;
    const row = el("div", "dc-actions");
    const hint = el("span", "dc-hint", d.editId ? "" : t.diff.rangeHint);
    const no = button("dc-btn", t.diff.cancel);
    no.addEventListener("click", cancel);
    const ok = button("dc-btn primary", t.diff.save, t.diff.saveHint);
    // Save is also off while the session's comments are being sent (lock, below)
    ok.disabled = !d.text.trim();
    ok.addEventListener("click", save);
    input.addEventListener("input", () => {
      if (draft) draft.text = input.value;
      ok.disabled = !input.value.trim() || sending.has(d.session);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        save();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    row.append(hint, no, ok);
    box.append(where, input, row);
    return {
      el: box,
      sig: draftSig(d),
      where,
      input,
      lock: (busy) => {
        ok.disabled = busy || !input.value.trim();
      },
    };
  };
  const draftSig = (d: Draft) =>
    `draft\n${d.session}\n${d.file}\n${d.editId ?? ""}`;

  const setAttr = (e: Element, name: string, on: boolean) => {
    if (on !== e.hasAttribute(name)) e.toggleAttribute(name, on);
  };

  /** A box to draw under `row`; `label` is the draft's lines, written into the box on each draw. */
  interface Want {
    row: HTMLTableRowElement;
    sig: string;
    make: () => Box;
    label?: string;
  }

  const drawPanel = (panel: HTMLElement, view: View) => {
    const session = sessionOf(panel);
    view.session = session;
    const busy = !!session && sending.has(session);
    const pr = panel.getBoundingClientRect();
    Object.assign(view.root.style, {
      left: `${pr.left}px`,
      top: `${pr.top}px`,
      width: `${pr.width}px`,
      height: `${pr.height}px`,
    });
    let comments: DiffComment[] = [];
    if (session)
      try {
        comments = store.list(session);
      } catch (err) {
        warn("reading the saved comments", err);
      }

    // which box goes under which row, which rows are marked, and which comments moved
    const want = new Map<string, Want>();
    const marked = new Set<Element>();
    const inDraft = new Set<Element>();
    const d = draft?.session === session ? draft : null;
    const placedIds = new Set<string>();
    const goneIds = new Set<string>();
    for (const section of panel.querySelectorAll(FILE)) {
      const file = section.getAttribute("data-file-path") ?? "";
      const { trs, rows, byKey } = sectionRows(section);
      const at = (key: string) => byKey.get(key) as HTMLTableRowElement;
      const lineOf = new Map(rows.map((r) => [r.key, r]));
      const { placed, moved } = placeComments(
        comments.filter((c) => c.file === file),
        rows,
      );
      for (const c of moved) goneIds.add(c.id);
      for (const p of placed) {
        placedIds.add(p.comment.id);
        for (const k of p.keys) marked.add(at(k));
        if (d?.editId === p.comment.id) {
          for (const k of p.keys) inDraft.add(at(k));
          want.set(DRAFT_ID, {
            row: at(p.last),
            sig: draftSig(d),
            make: () => draftBox(d),
            label: lineLabel(p.comment),
          });
        } else {
          const c = p.comment;
          const covered = p.keys.map((k) => lineOf.get(k) as RowLine);
          want.set(c.id, {
            row: at(p.last),
            sig: savedSig(c),
            make: () => savedBox(session, c, covered),
          });
        }
      }
      if (d && !d.editId && d.file === file) {
        const shown = d.rows.filter((r) => byKey.has(r.key));
        if (shown.length) {
          for (const r of shown) inDraft.add(at(r.key));
          want.set(DRAFT_ID, {
            row: at(shown[shown.length - 1].key),
            sig: draftSig(d),
            make: () => draftBox(d),
            label: lineLabel(rangeOf(d.rows)),
          });
        }
      }
      for (const tr of trs) {
        setAttr(tr, "data-dc-mark", marked.has(tr));
        setAttr(tr, "data-dc-draft", inDraft.has(tr));
      }
    }
    // a file out of view keeps what was last seen of it; a file listed twice counts where it is placed
    let movedCount = 0;
    if (session) {
      const ids = new Set(comments.map((c) => c.id));
      const moved = movedIds.get(session) ?? new Set<string>();
      for (const id of goneIds) moved.add(id);
      for (const id of [...moved])
        if (placedIds.has(id) || !ids.has(id)) moved.delete(id);
      if (moved.size) movedIds.set(session, moved);
      else movedIds.delete(session);
      movedCount = moved.size;
    }

    // the bar, and room for it under the list
    const st = session ? status.get(session) : undefined;
    const hold = session ? held.get(session) : undefined;
    const showBar = !!session && (comments.length > 0 || !!st || !!hold);
    // Clear's question is gone once there is nothing to clear
    if (session && !comments.length) asking.delete(session);
    const ask = !!session && asking.has(session) && !busy;
    view.bar.hidden = !showBar;
    if (showBar) {
      view.count.hidden = !comments.length;
      view.count.textContent = movedCount
        ? t.diff.countMoved(comments.length, movedCount)
        : t.diff.count(comments.length);
      view.send.hidden = view.clear.hidden = !comments.length || ask;
      view.dropMoved.hidden = !movedCount || ask;
      view.ask.hidden = view.clearYes.hidden = view.keep.hidden = !ask;
      view.ask.textContent = t.diff.clearAsk(comments.length);
      view.send.disabled = view.clear.disabled = view.dropMoved.disabled = busy;
      view.status.hidden = !st && !hold;
      // a failure shows as one; otherwise a held warning keeps its colour
      view.status.dataset.kind =
        hold && st?.kind !== "bad" ? "held" : (st?.kind ?? "held");
      view.words.textContent = [hold, st?.message].filter(Boolean).join("\n");
      panel.style.setProperty("--dc-bar", `${view.bar.offsetHeight}px`);
    }
    setAttr(panel, "data-dc-bar", showBar);

    // the list, and the part of it in view: its client area leaves out its scrollbar
    const content = panel.querySelector(".agent-review-panel__content");
    const scroller = content?.firstElementChild ?? content ?? panel;
    const shownLeft =
      scroller.getBoundingClientRect().left + scroller.clientLeft;
    const shownRight = shownLeft + scroller.clientWidth;

    // the boxes: kept while their content is the same, so a text box keeps its focus and text. Each
    // gets its width before its height is taken for the gap under its row.
    for (const [id, box] of view.boxes)
      if (want.get(id)?.sig !== box.sig) {
        box.el.remove();
        view.boxes.delete(id);
      }
    const under = new Map<HTMLElement, { id: string; height: number }[]>();
    const across = new Map<string, { left: number; width: number }>();
    for (const [id, w] of want) {
      let box = view.boxes.get(id);
      if (!box) {
        box = w.make();
        view.clip.append(box.el);
        view.boxes.set(id, box);
      }
      if (box.where && w.label !== undefined) box.where.textContent = w.label;
      box.lock(busy);
      const rr = w.row.getBoundingClientRect();
      const code = (
        w.row.querySelector(".diff-code") ?? w.row
      ).getBoundingClientRect();
      // a wide diff scrolls sideways: the box stays in the part that shows
      const area = (
        w.row.closest(".agent-review-panel__diff") ?? w.row
      ).getBoundingClientRect();
      const span = boxSpan(
        code.left,
        rr.right,
        {
          left: Math.max(area.left, shownLeft),
          right: Math.min(area.right, shownRight),
        },
        GAP_AIR,
      );
      across.set(id, span);
      box.el.style.width = `${span.width}px`;
      const here = under.get(w.row) ?? [];
      here.push({ id, height: box.el.offsetHeight });
      under.set(w.row, here);
    }
    // two or more boxes under one row (comments ending on it, the open box) stack in its gap
    const gaps = new Map<HTMLElement, number>();
    const tops = new Map<string, number>();
    for (const [tr, boxes] of under) {
      const stack = stackBoxes(boxes, GAP_AIR);
      gaps.set(tr, stack.gap);
      for (const [id, top] of stack.tops) tops.set(id, top);
    }
    for (const tr of panel.querySelectorAll<HTMLElement>("tr[data-dc-gap]"))
      if (!gaps.has(tr)) {
        tr.removeAttribute("data-dc-gap");
        tr.style.removeProperty("--dc-gap");
      }
    for (const [tr, h] of gaps) {
      if (tr.style.getPropertyValue("--dc-gap") !== `${h}px`)
        tr.style.setProperty("--dc-gap", `${h}px`);
      setAttr(tr, "data-dc-gap", true);
    }

    // where things go, now that the gaps are in
    const sr = scroller.getBoundingClientRect();
    Object.assign(view.clip.style, {
      left: `${sr.left - pr.left}px`,
      top: `${sr.top - pr.top}px`,
      width: `${sr.width}px`,
      height: `${sr.height}px`,
    });
    for (const [id, w] of want) {
      const box = view.boxes.get(id) as Box;
      const rr = w.row.getBoundingClientRect();
      const span = across.get(id) as { left: number; width: number };
      Object.assign(box.el.style, {
        left: `${span.left - sr.left}px`,
        top: `${rr.bottom - (gaps.get(w.row) ?? 0) + (tops.get(id) as number) - sr.top}px`,
      });
      if (id === DRAFT_ID && focusDraft) {
        focusDraft = false;
        box.input?.focus();
      }
    }
    placePlus(view, panel, sr);
  };

  // At the left of the row under the mouse, where the line numbers (set right) leave room. None while
  // the session's comments are being sent.
  const placePlus = (view: View, panel: Element, sr: DOMRect) => {
    const row = hover?.panel === panel ? hover.row : null;
    const shown =
      !!row?.isConnected &&
      !!view.session &&
      !sending.has(view.session) &&
      !!readRow(row.cells);
    view.plus.hidden = !shown;
    if (!shown || !row) return;
    const rr = row.getBoundingClientRect();
    const area = (
      row.closest(".agent-review-panel__diff") ?? row
    ).getBoundingClientRect();
    Object.assign(view.plus.style, {
      left: `${Math.max(rr.left, area.left) - sr.left + 2}px`,
      top: `${rr.top - sr.top + 1}px`,
    });
  };

  const shownPanels = () =>
    [...document.querySelectorAll<HTMLElement>(PANEL)].filter(
      (p) => p.offsetParent !== null,
    );

  const render = () => {
    const panels = shownPanels();
    for (const [p, v] of views)
      if (!panels.includes(p as HTMLElement)) {
        v.root.remove();
        views.delete(p);
        sized.unobserve(p);
      }
    for (const p of panels) {
      let v = views.get(p);
      if (!v) {
        v = makeView();
        views.set(p, v);
        sized.observe(p);
      }
      drawPanel(p, v);
    }
    lastSessions = panels.map(sessionOf).join("\n");
  };

  const onOver = (e: MouseEvent) => {
    const target = e.target as Element | null;
    // over the "+" itself or a box: the "+" stays where it is
    if (!target?.closest || target.closest(`[${LAYER}]`)) return;
    const row = target.closest<HTMLTableRowElement>("tr.diff-line");
    const panel = row?.closest(PANEL);
    const next = row && panel && views.has(panel) ? { panel, row } : null;
    if (next?.row === hover?.row) return;
    hover = next;
    schedule();
  };
  const onStorage = (e: StorageEvent) => {
    if (e.key === null || e.key.startsWith("diffComments:")) schedule();
  };

  // A redraw, at most once a frame, for a change inside a Review panel or on a part of the page that
  // holds one (a panel added, removed or moved); the rest of the app (a chat reply streaming in) is left
  // out, and so are the layer's own changes. Style changes on the rows and the panel itself are set
  // here and left out too.
  const holdsPanel = (n: Node) =>
    n instanceof Element &&
    (n.matches(PANEL) || n.querySelector(PANEL) !== null);
  const touchesPanel = (r: MutationRecord) => {
    const target = r.target as Element;
    if (!target.closest || target.closest(`[${LAYER}]`)) return false;
    const near = target.closest(PANEL) !== null || holdsPanel(target);
    if (r.type === "childList")
      return near || [...r.removedNodes].some(holdsPanel);
    return near && !target.matches(`tr, ${PANEL}`);
  };
  const observer = new MutationObserver((records) => {
    if (records.some(touchesPanel)) schedule();
  });
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["style"],
  });
  // the panel's own size (the right panel dragged wider) changes nothing in the page tree
  const sized = new ResizeObserver(schedule);
  document.addEventListener("mouseover", onOver, true);
  document.addEventListener("scroll", schedule, true);
  window.addEventListener("resize", schedule);
  window.addEventListener("storage", onStorage);
  const unsubscribe = store.subscribe(schedule);
  // Switching sessions shows another panel without adding nodes, which the observer does not see
  const sessionCheck = setInterval(() => {
    if (shownPanels().map(sessionOf).join("\n") !== lastSessions) schedule();
  }, SESSION_CHECK_MS);
  schedule();

  return () => {
    stopped = true;
    observer.disconnect();
    sized.disconnect();
    document.removeEventListener("mouseover", onOver, true);
    document.removeEventListener("scroll", schedule, true);
    window.removeEventListener("resize", schedule);
    window.removeEventListener("storage", onStorage);
    unsubscribe();
    clearInterval(sessionCheck);
    clearInterval(notePoll);
    if (frame !== undefined) cancelAnimationFrame(frame);
    for (const id of timers.values()) clearTimeout(id);
    for (const v of views.values()) v.root.remove();
    views.clear();
    for (const tr of document.querySelectorAll<HTMLElement>(
      "[data-dc-mark], [data-dc-draft], [data-dc-gap]",
    )) {
      tr.removeAttribute("data-dc-mark");
      tr.removeAttribute("data-dc-draft");
      tr.removeAttribute("data-dc-gap");
      tr.style.removeProperty("--dc-gap");
    }
    for (const p of document.querySelectorAll<HTMLElement>("[data-dc-bar]")) {
      p.removeAttribute("data-dc-bar");
      p.style.removeProperty("--dc-bar");
    }
  };
}
