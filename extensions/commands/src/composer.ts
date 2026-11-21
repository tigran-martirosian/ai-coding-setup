// Puts a Note button and a Try it button next to the Send button of every chat composer in the page,
// and runs the wake bridge. This reaches into the app's own markup (see find.ts), so an app update may
// break it; when it does the buttons just do not appear, and the reason is in the console.

import type { Invoke } from "../../shared/host.ts";
import { newState, POLL_MS, pollOutbox } from "./bridge.ts";
import type { El } from "./find.ts";
import { findComposers, readFiles, removeFiles } from "./find.ts";
import type { Pending } from "./note.ts";
import { endMessage, homeDir, noteEnds, sendNote } from "./note.ts";
import { t } from "./strings.ts";
import type { PageNews, PageWatch } from "./try-it.ts";
import { PAGE_POLL_MS, pollPages, pressTryIt, workspaceOf } from "./try-it.ts";

const TAG = "[commandbuttons]";
const WRAP = "data-note-wrap";
const NOTE_POLL_MS = 2000;
export const RESCAN_MS = 150;

type Say = (kind: "ok" | "bad" | "busy" | "held", message: string) => void;
/** One chat box's Note and Try it buttons, as the code outside them needs them. */
interface Handle {
  say: Say;
  /** Good news that must show even over a held message: it is added to that message. */
  news: (message: string) => void;
  dot: HTMLElement;
  button: HTMLElement;
  tryIt: HTMLElement;
}

function clearTextarea(row: Element) {
  const box = row.querySelector("textarea");
  if (!box) return;
  // the composer is a React controlled field: set the value the way the browser does, then tell it
  const set = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  set?.call(box, "");
  box.dispatchEvent(new Event("input", { bubbles: true }));
}

function build(
  invoke: Invoke,
  sent: (note: Pending) => void,
  tried: () => void,
  watches: Map<string, PageWatch>,
): { wrap: HTMLElement; handle: Handle } {
  const wrap = document.createElement("span");
  wrap.className = "cb-note-wrap";
  wrap.setAttribute(WRAP, "");
  // The message sits to the left of the button, inside the chat box (see note.css); it goes after a few
  // seconds, with its close button, or when the user types
  const status = document.createElement("div");
  status.className = "cb-note-bubble";
  status.setAttribute("role", "status");
  status.hidden = true;
  const state = document.createElement("span");
  state.className = "cb-note-state";
  const words = document.createElement("span");
  words.className = "cb-note-text";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "cb-note-close";
  close.textContent = "×";
  close.title = t.note.dismiss;
  close.setAttribute("aria-label", t.note.dismiss);
  status.append(state, words, close);
  // A note that was not confirmed can end hours after the press, so that message stays until it is
  // closed or the next press: typing, a timer or good news about another note must not clear it
  let held = false;
  const hide = () => (status.hidden = true);
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    held = false;
    hide();
  });
  const button = document.createElement("button");
  button.type = "button";
  button.className = "cb-note-btn";
  button.textContent = t.note.button;
  button.title = t.note.hint;
  // Lit while a note from this chat box is on its way: a message would have to stay on the chat box
  // for minutes, and it covers what is being typed
  const dot = document.createElement("span");
  dot.className = "cb-note-pending";
  dot.hidden = true;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say: Say = (kind, message) => {
    if (held && kind === "ok") return;
    words.textContent =
      held && kind === "held" ? `${words.textContent}\n${message}` : message;
    held = kind === "held";
    status.dataset.kind = kind;
    status.hidden = false;
    clearTimeout(timer);
    if (kind === "busy" || kind === "held") return;
    timer = setTimeout(hide, kind === "ok" ? 3000 : 6000);
    wrap.parentElement
      ?.querySelector("textarea")
      ?.addEventListener("input", () => held || hide(), { once: true });
  };
  button.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const row = wrap.parentElement;
    const panel = wrap.closest("[data-session-id]");
    const sessionId = panel?.getAttribute("data-session-id");
    const box = row?.querySelector("textarea");
    if (!row || !box) return say("bad", t.note.noBox);
    if (!panel || !sessionId) return say("bad", t.note.noSession);
    button.disabled = true;
    say("busy", t.note.sending);
    try {
      // Read together and before any wait: what is added while the note goes out stays in the box
      const text = box.value;
      const files = readFiles(panel, text);
      const home = await homeDir(invoke);
      const outcome = await sendNote(text, sessionId, home, invoke, files);
      if (outcome.ok) {
        if (outcome.noteId)
          sent({
            id: outcome.noteId,
            session: sessionId,
            home,
            ts: Date.now(),
            text: (text.trim() || files[0]?.filename || "").slice(0, 60),
          });
        if (box.value === text) clearTextarea(row);
        if (!removeFiles(panel, files)) return say("bad", t.note.fileLeft);
      }
      say(outcome.ok ? "ok" : "bad", outcome.message);
    } catch (err) {
      say("bad", t.note.notSent(String((err as Error)?.message ?? err)));
    } finally {
      button.disabled = false;
    }
  });
  const news = (message: string) => say(held ? "held" : "ok", message);
  // Try it sends its own fixed note: what is typed in the box and its files stay where they are. It is
  // not in Note's list of notes on their way: its own waiting is the page watch, named in its tooltip
  const tryIt = document.createElement("button");
  tryIt.type = "button";
  tryIt.className = "cb-note-btn cb-try-btn";
  tryIt.textContent = t.tryIt.button;
  tryIt.title = t.tryIt.hint;
  tryIt.addEventListener("click", async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const sessionId = wrap
      .closest("[data-session-id]")
      ?.getAttribute("data-session-id");
    if (!sessionId) return say("bad", t.note.noSession);
    tryIt.disabled = true;
    say("busy", t.note.sending);
    try {
      const { outcome } = await pressTryIt(sessionId, invoke, watches);
      if (outcome.ok) tried();
      // "Note on its way" promises a delivery message that a Try it press does not give
      say(
        outcome.ok ? "ok" : "bad",
        outcome.noteId ? t.tryIt.sent : outcome.message,
      );
    } catch (err) {
      say("bad", t.note.notSent(String((err as Error)?.message ?? err)));
    } finally {
      tryIt.disabled = false;
    }
  });
  wrap.append(status, tryIt, button, dot);
  return { wrap, handle: { say, news, dot, button, tryIt } };
}

/** Starts watching the page. Returns a function that stops it and removes the buttons. */
export function startNoteButtons(invoke: Invoke): () => void {
  const complained = new WeakSet<object>();
  // Kept here and not on the button: the app removes a chat box when its tab is left, and the note
  // is usually still on its way then
  const pending: Pending[] = [];
  const handles = new WeakMap<Element, Handle>();
  // What could not be said because the session's tab was shut: said when its chat box is back
  const unseen = new Map<string, string>();
  let stopped = false;
  // Try it presses whose page file is watched, by session; kept here for the same reason as `pending`
  const watches = new Map<string, PageWatch>();
  // The nearest session panel, the same way a press finds its session: panels can hold one another
  const live = (session: string) =>
    [...document.querySelectorAll(`[${WRAP}]`)].find(
      (w) =>
        w.closest("[data-session-id]")?.getAttribute("data-session-id") ===
        session,
    );
  const showDot = (wrap: Element, session: string) => {
    const h = handles.get(wrap);
    if (!h) return;
    const waiting = pending.filter((p) => p.session === session).length;
    h.dot.hidden = !waiting;
    h.button.title = waiting ? t.note.waitingTip(waiting) : t.note.hint;
    h.tryIt.title = watches.has(session) ? t.tryIt.watchingTip : t.tryIt.hint;
  };
  let pagePoll: ReturnType<typeof setInterval> | undefined;
  let pagePolling = false;
  const tell = ({ session, kind, url, why }: PageNews) => {
    const message =
      kind === "opened"
        ? t.tryIt.opened(url)
        : kind === "refused"
          ? t.tryIt.notLocal(url)
          : t.tryIt.openFailed(why ?? "");
    const wrap = live(session);
    const h = wrap && handles.get(wrap);
    if (wrap) showDot(wrap, session);
    if (h && kind === "opened") h.news(message);
    else if (h) h.say("held", message);
    else if (kind !== "opened")
      unseen.set(
        session,
        [unseen.get(session), message].filter(Boolean).join("\n"),
      );
  };
  const pollTried = async () => {
    if (pagePolling) return;
    pagePolling = true;
    try {
      const workspacePath = workspaceOf(
        window as unknown as Parameters<typeof workspaceOf>[0],
      );
      for (const news of await pollPages(watches, invoke, workspacePath))
        tell(news);
    } catch (err) {
      console.error(
        `${TAG} Try it page watch: ${String((err as Error)?.message ?? err)}`,
      );
    } finally {
      pagePolling = false;
      if (!watches.size) {
        clearInterval(pagePoll);
        pagePoll = undefined;
        showAll();
      }
    }
  };
  // Try it's tooltip says while its page is watched
  const showAll = () => {
    for (const wrap of document.querySelectorAll(`[${WRAP}]`)) {
      const session = wrap
        .closest("[data-session-id]")
        ?.getAttribute("data-session-id");
      if (session) showDot(wrap, session);
    }
  };
  const tried = () => {
    if (stopped) return;
    showAll();
    pagePoll ??= setInterval(pollTried, PAGE_POLL_MS);
  };
  let notePoll: ReturnType<typeof setInterval> | undefined;
  let polling = false;
  const pollNotes = async () => {
    if (polling) return;
    polling = true;
    try {
      for (const { note, state } of await noteEnds(pending, invoke)) {
        pending.splice(pending.indexOf(note), 1);
        const end = endMessage(state, note.text);
        const wrap = live(note.session);
        if (wrap) {
          showDot(wrap, note.session);
          handles.get(wrap)?.say(end.ok ? "ok" : "held", end.message);
        } else if (!end.ok) {
          unseen.set(
            note.session,
            [unseen.get(note.session), end.message].filter(Boolean).join("\n"),
          );
        }
      }
      if (!pending.length) {
        clearInterval(notePoll);
        notePoll = undefined;
      }
    } catch (err) {
      console.warn(
        `${TAG} note receipts: ${String((err as Error)?.message ?? err)}`,
      );
    } finally {
      polling = false;
    }
  };
  const track = (note: Pending) => {
    if (stopped) return;
    pending.push(note);
    const wrap = live(note.session);
    if (wrap) showDot(wrap, note.session);
    notePoll ??= setInterval(pollNotes, NOTE_POLL_MS);
  };
  const scan = () => {
    try {
      for (const c of findComposers(
        document as unknown as { querySelectorAll(s: string): ArrayLike<El> },
      )) {
        const row = c.row as unknown as HTMLElement;
        if (!c.sessionId) {
          if (!complained.has(row)) {
            complained.add(row);
            console.warn(
              `${TAG} no Note button: this chat box has no data-session-id ancestor, so the session is unknown`,
            );
          }
          continue;
        }
        const send = c.button as unknown as HTMLElement;
        let wrap = row.querySelector<HTMLElement>(`:scope > [${WRAP}]`);
        if (!wrap) {
          const built = build(invoke, track, tried, watches);
          wrap = row.insertBefore(built.wrap, send);
          handles.set(wrap, built.handle);
        }
        showDot(wrap, c.sessionId);
        const missed = unseen.get(c.sessionId);
        if (missed) {
          unseen.delete(c.sessionId);
          handles.get(wrap)?.say("held", missed);
        }
        // Sit where the Send button sits as the chat box grows: a fixed-height button in a stretched row
        // stays at the top, so a stretched wrapper would otherwise leave Note at the bottom
        const own = getComputedStyle(send).alignSelf;
        const align = own === "auto" ? getComputedStyle(row).alignItems : own;
        wrap.style.alignSelf = /stretch|normal/.test(align)
          ? "flex-start"
          : align;
      }
    } catch (err) {
      console.warn(
        `${TAG} Note button: ${String((err as Error)?.message ?? err)}`,
      );
    }
  };
  let rescan: ReturnType<typeof setTimeout> | undefined;
  // At most one scan per RESCAN_MS, never put off by new changes: a streaming reply changes the page
  // every few ms, so a timer restarted on each change never fired and a running chat box had no Note
  const observer = new MutationObserver(() => {
    rescan ??= setTimeout(() => {
      rescan = undefined;
      scan();
    }, RESCAN_MS);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  return () => {
    stopped = true;
    observer.disconnect();
    clearTimeout(rescan);
    clearInterval(notePoll);
    clearInterval(pagePoll);
    document.querySelectorAll(`[${WRAP}]`).forEach((n) => n.remove());
  };
}

/** Polls the outbox every few seconds. Returns a function that stops it. */
export function startBridge(invoke: Invoke): () => void {
  const state = newState();
  let home: string | undefined;
  const tick = async () => {
    try {
      home ??= await homeDir(invoke);
      await pollOutbox(invoke, home, state);
    } catch (err) {
      console.error(
        `${TAG} outbox bridge: ${String((err as Error)?.message ?? err)}`,
      );
    }
  };
  const timer = setInterval(tick, POLL_MS);
  void tick();
  return () => clearInterval(timer);
}
