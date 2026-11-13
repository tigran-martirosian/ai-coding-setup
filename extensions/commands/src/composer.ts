// Puts a Note button next to the Send button of every chat composer in the page, and runs the wake
// bridge. This reaches into the app's own markup (see find.ts), so an app update may break it; when
// it does the button just does not appear, and the reason is in the console.
import { pollOutbox, newState, POLL_MS } from './bridge';
import { findComposers, readFiles, removeFiles } from './find';
import type { El } from './find';
import { homeDir, sendNote } from './note';
import { t } from './strings';
import type { Invoke } from './note';

const TAG = '[commandbuttons]';
const WRAP = 'data-note-wrap';

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

function build(invoke: Invoke): HTMLElement {
  const wrap = document.createElement('span');
  wrap.setAttribute(WRAP, '');
  wrap.style.cssText = 'position:relative;display:inline-flex;flex:none';
  // The message sits to the left of the button, inside the chat box, so it never covers the context
  // number above the box; it goes after a few seconds, on a click on it, or when the user types
  const status = document.createElement('span');
  status.style.cssText =
    'position:absolute;right:calc(100% + 6px);top:50%;transform:translateY(-50%);max-width:260px;width:max-content;padding:4px 8px;border-radius:6px;font-size:12px;line-height:1.3;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--nim-bg-secondary,#222);border:1px solid var(--nim-border,#444);z-index:10000;cursor:pointer;display:none';
  const hide = () => (status.style.display = 'none');
  status.addEventListener('click', hide);
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = t.note.button;
  button.title = t.note.hint;
  button.style.cssText =
    'height:36px;padding:0 10px;border:1px solid var(--nim-border,#444);border-radius:6px;background:transparent;color:var(--nim-text,inherit);font:inherit;font-size:12px;cursor:pointer';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const say = (ok: boolean, message: string) => {
    status.textContent = message;
    status.style.color = ok ? 'var(--nim-success,#4caf50)' : 'var(--nim-error,#f44336)';
    status.style.display = 'block';
    clearTimeout(timer);
    timer = setTimeout(hide, ok ? 3000 : 6000);
    wrap.parentElement?.querySelector('textarea')?.addEventListener('input', hide, { once: true });
  };
  button.addEventListener('click', async (e) => {
    e.preventDefault();
    e.stopPropagation();
    const row = wrap.parentElement;
    const panel = wrap.closest('[data-session-id]');
    const sessionId = panel?.getAttribute('data-session-id');
    const box = row?.querySelector('textarea');
    if (!row || !box) return say(false, t.note.noBox);
    if (!panel || !sessionId) return say(false, t.note.noSession);
    button.disabled = true;
    try {
      // Read together and before any wait: what is added while the note goes out stays in the box
      const text = box.value;
      const files = readFiles(panel, text);
      const outcome = await sendNote(text, sessionId, await homeDir(invoke), invoke, files);
      if (outcome.ok) {
        if (box.value === text) clearTextarea(row);
        if (!removeFiles(panel, files)) return say(false, t.note.fileLeft);
      }
      say(outcome.ok, outcome.message);
    } catch (err) {
      say(false, t.note.notSent(String((err as Error)?.message ?? err)));
    } finally {
      button.disabled = false;
    }
  });
  wrap.append(status, button);
  return wrap;
}

/** Starts watching the page. Returns a function that stops it and removes the buttons. */
export function startNoteButtons(invoke: Invoke): () => void {
  const complained = new WeakSet<object>();
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
        if (!wrap) wrap = row.insertBefore(build(invoke), send);
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
  let pending: ReturnType<typeof setTimeout> | undefined;
  const observer = new MutationObserver(() => {
    clearTimeout(pending);
    pending = setTimeout(scan, 150);
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  return () => {
    observer.disconnect();
    clearTimeout(pending);
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
