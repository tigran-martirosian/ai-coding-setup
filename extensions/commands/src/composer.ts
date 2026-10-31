// Puts a Note button next to the Send button of every chat composer in the page, and runs the wake
// bridge. This reaches into the app's own markup (see find.ts), so an app update may break it; when
// it does the button just does not appear, and the reason is in the console.
import { pollOutbox, newState, POLL_MS } from './bridge';
import { findComposers, readFiles, removeFiles } from './find';
import type { El } from './find';
import { endMessage, homeDir, noteEnds, sendNote } from './note';
import type { Invoke, Pending } from './note';
import { t } from './strings';

const TAG = '[commandbuttons]';
const WRAP = 'data-note-wrap';
const NOTE_POLL_MS = 2000;

type Say = (kind: 'ok' | 'bad' | 'busy' | 'held', message: string) => void;
/** One chat box's Note button, as the code outside it needs it. */
interface Handle {
  say: Say;
  dot: HTMLElement;
  button: HTMLElement;
}

export const bridge = (): Invoke => (channel, ...args) =>
  (window as unknown as { electronAPI: { invoke: Invoke } }).electronAPI.invoke(channel, ...args);

function clearTextarea(row: Element) {
  const box = row.querySelector('textarea');
  if (!box) return;
  // the composer is a React controlled field: set the value the way the browser does, then tell it
  const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set;
  set?.call(box, '');
  box.dispatchEvent(new Event('input', { bubbles: true }));
}

function build(invoke: Invoke, sent: (note: Pending) => void): { wrap: HTMLElement; handle: Handle } {
  const wrap = document.createElement('span');
  wrap.setAttribute(WRAP, '');
  wrap.style.cssText = 'position:relative;display:inline-flex;flex:none';
  // The message sits to the left of the button, inside the chat box, so it never covers the context
  // number above the box; it goes after a few seconds, on a click on it, or when the user types
  const status = document.createElement('span');
  status.style.cssText =
    'position:absolute;right:calc(100% + 6px);top:50%;transform:translateY(-50%);max-width:260px;width:max-content;padding:4px 8px;border-radius:6px;font-size:12px;line-height:1.3;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--nim-bg-secondary,#222);border:1px solid var(--nim-border,#444);z-index:10000;cursor:pointer;display:none';
  // A note that was not confirmed can end hours after the press, so that message stays until it is
  // clicked or the next press: typing, a timer or good news about another note must not clear it
  let held = false;
  const hide = () => (status.style.display = 'none');
  status.addEventListener('click', () => {
    held = false;
    hide();
  });
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t.note.button;
  button.title = t.note.hint;
  button.style.cssText =
    'height:36px;padding:0 10px;border:1px solid var(--nim-border,#444);border-radius:6px;background:transparent;color:var(--nim-text,inherit);font:inherit;font-size:12px;cursor:pointer';
  // Lit while a note from this chat box is on its way: a message would have to stay on the chat box
  // for minutes, and it covers what is being typed
  const dot = document.createElement('span');
  dot.style.cssText =
    'position:absolute;top:-3px;right:-3px;width:8px;height:8px;border-radius:50%;background:var(--nim-warning,#e0a800);pointer-events:none;display:none';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say: Say = (kind, message) => {
    if (held && kind === 'ok') return;
    status.textContent = held && kind === 'held' ? `${status.textContent}\n${message}` : message;
    held = kind === 'held';
    status.style.color = kind === 'ok' ? 'var(--nim-success,#4caf50)' : kind === 'busy' ? 'var(--nim-text,inherit)' : 'var(--nim-error,#f44336)';
    status.style.display = 'block';
    clearTimeout(timer);
    if (kind === 'busy' || kind === 'held') return;
    timer = setTimeout(hide, kind === 'ok' ? 3000 : 6000);
    wrap.parentElement?.querySelector('textarea')?.addEventListener('input', () => held || hide(), { once: true });
  };
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const row = wrap.parentElement;
    const panel = wrap.closest('[data-session-id]');
    const sessionId = panel?.getAttribute('data-session-id');
    const box = row?.querySelector('textarea');
    if (!row || !box) return say('bad', t.note.noBox);
    if (!panel || !sessionId) return say('bad', t.note.noSession);
    button.disabled = true;
    button.style.opacity = '0.5';
    button.style.cursor = 'progress';
    say('busy', t.note.sending);
    try {
      // Read together and before any wait: what is added while the note goes out stays in the box
      const text = box.value;
      const files = readFiles(panel, text);
      const home = await homeDir(invoke);
      const outcome = await sendNote(text, sessionId, home, invoke, files);
      if (outcome.ok) {
        if (outcome.noteId) sent({ id: outcome.noteId, session: sessionId, home, ts: Date.now(), text: (text.trim() || files[0]?.filename || '').slice(0, 60) });
        if (box.value === text) clearTextarea(row);
        if (!removeFiles(panel, files)) return say('bad', t.note.fileLeft);
      }
      say(outcome.ok ? 'ok' : 'bad', outcome.message);
    } catch (err) {
      say('bad', t.note.notSent(String((err as Error)?.message ?? err)));
    } finally {
      button.disabled = false;
      button.style.opacity = '';
      button.style.cursor = 'pointer';
    }
  });
  wrap.append(status, button, dot);
  return { wrap, handle: { say, dot, button } };
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
  // The nearest session panel, the same way a press finds its session: panels can hold one another
  const live = (session: string) =>
    [...document.querySelectorAll(`[${WRAP}]`)].find((w) => w.closest('[data-session-id]')?.getAttribute('data-session-id') === session);
  const showDot = (wrap: Element, session: string) => {
    const h = handles.get(wrap);
    if (!h) return;
    const waiting = pending.filter((p) => p.session === session).length;
    h.dot.style.display = waiting ? 'block' : 'none';
    h.button.title = waiting ? t.note.waitingTip(waiting) : t.note.hint;
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
          handles.get(wrap)?.say(end.ok ? 'ok' : 'held', end.message);
        } else if (!end.ok) {
          unseen.set(note.session, [unseen.get(note.session), end.message].filter(Boolean).join('\n'));
        }
      }
      if (!pending.length) {
        clearInterval(notePoll);
        notePoll = undefined;
      }
    } catch (err) {
      console.warn(`${TAG} note receipts: ${String((err as Error)?.message ?? err)}`);
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
      for (const c of findComposers(document as unknown as { querySelectorAll(s: string): ArrayLike<El> })) {
        const row = c.row as unknown as HTMLElement;
        if (!c.sessionId) {
          if (!complained.has(row)) {
            complained.add(row);
            console.warn(`${TAG} no Note button: this chat box has no data-session-id ancestor, so the session is unknown`);
          }
          continue;
        }
        const send = c.button as unknown as HTMLElement;
        let wrap = row.querySelector<HTMLElement>(`:scope > [${WRAP}]`);
        if (!wrap) {
          const built = build(invoke, track);
          wrap = row.insertBefore(built.wrap, send);
          handles.set(wrap, built.handle);
        }
        showDot(wrap, c.sessionId);
        const missed = unseen.get(c.sessionId);
        if (missed) {
          unseen.delete(c.sessionId);
          handles.get(wrap)?.say('held', missed);
        }
        // Sit where the Send button sits as the chat box grows: a fixed-height button in a stretched row
        // stays at the top, so a stretched wrapper would otherwise leave Note at the bottom
        const own = getComputedStyle(send).alignSelf;
        const align = own === 'auto' ? getComputedStyle(row).alignItems : own;
        wrap.style.alignSelf = /stretch|normal/.test(align) ? 'flex-start' : align;
      }
    } catch (err) {
      console.warn(`${TAG} Note button: ${String((err as Error)?.message ?? err)}`);
    }
  };
  let rescan: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(rescan);
    rescan = setTimeout(scan, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  return () => {
    stopped = true;
    observer.disconnect();
    clearTimeout(rescan);
    clearInterval(notePoll);
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
      console.error(`${TAG} outbox bridge: ${String((err as Error)?.message ?? err)}`);
    }
  };
  const timer = setInterval(tick, POLL_MS);
  void tick();
  return () => clearInterval(timer);
}
