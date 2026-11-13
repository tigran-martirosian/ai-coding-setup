/**
 * Hands-free mode: when on, reads each finished reply and each question card.
 *
 * WORKAROUND, isolated here: the SDK gives transcript contributions no
 * message role or turn state, so this watches the transcript DOM for the
 * host's own markers. Every selector the feature depends on is listed below;
 * if a Nimbalyst update renames them, only hands-free mode stops working
 * (the per-message button keeps working).
 */

import { callBackend } from './bridge';
import { player } from './player';
import { getSettings, updateSetting } from './settings';
import { speechForKey } from './transcript';

const SEL = {
  transcript: '.rich-transcript-messages',
  session: '[data-session-id]',
  message: '.rich-transcript-message[data-message-index]',
  assistant: 'assistant',
  turnFinished: '.rich-transcript-turn-elapsed',
  question: '.ask-user-question-widget, .request-user-input-widget',
  control: '[data-readaloud-key]',
};

const SCAN_MS = 1500;
const SETTLE_MS = 900;
const POLL_MS = 3000;
const POLL_BACKOFF_MS = 30000;
const UI_WORDS = /^(submit|submitted|cancel|skip|other|confirm|recommended|yes|no|done|send)$/i;

interface Watch {
  sessionId: string | null;
  baseline: number;
  observer: MutationObserver;
  timer: ReturnType<typeof setTimeout> | null;
}

const AGENT_REQUEST_FRESH_MS = 15000;

interface AgentRequest {
  enabled: boolean;
  seq: number;
  at: number;
  instanceId: string;
}

const spoken = new Set<string>();
const seenSeq = new Map<string, number>();

function indexOf(el: Element): number {
  return Number(el.getAttribute('data-message-index') ?? -1);
}

function maxIndex(container: Element): number {
  let max = -1;
  container.querySelectorAll(SEL.message).forEach((m) => {
    max = Math.max(max, indexOf(m));
  });
  return max;
}

function sessionOf(container: Element): string | null {
  return container.closest(SEL.session)?.getAttribute('data-session-id') ?? null;
}

/** Plain text of a question card, read from text content (not innerText, which applies CSS uppercase). */
function questionText(widget: Element): string {
  const parts: string[] = [];
  widget.querySelectorAll('*').forEach((el) => {
    if (el.children.length) return;
    const t = (el.textContent ?? '').replace(/\s+/g, ' ').trim();
    if (!t || UI_WORDS.test(t) || /^[\W\d]+$/.test(t)) return;
    if (el.closest('button[type=submit]')) return;
    if (parts[parts.length - 1] !== t) parts.push(/[.!?:]$/.test(t) ? t : `${t}.`);
  });
  return parts.join('\n\n').slice(0, 1500);
}

/** Last assistant text block before `beforeIndex` that has not been read yet. */
function speakLastReply(container: Element, sessionId: string | null, beforeIndex: number, baseline: number) {
  const msgs = [...container.querySelectorAll(SEL.message)]
    .filter((m) => m.classList.contains(SEL.assistant) && indexOf(m) < beforeIndex && indexOf(m) > baseline)
    .sort((a, b) => indexOf(a) - indexOf(b));
  for (let i = msgs.length - 1; i >= 0; i--) {
    const controls = msgs[i].querySelectorAll(SEL.control);
    const key = controls[controls.length - 1]?.getAttribute('data-readaloud-key');
    const md = speechForKey(key)?.short;
    if (!key || !md) continue;
    const id = `${sessionId}:reply:${indexOf(msgs[i])}`;
    if (!spoken.has(id)) {
      spoken.add(id);
      player.enqueue(key, md);
    }
    return;
  }
}

function check(container: Element, w: Watch) {
  const sessionId = sessionOf(container);
  const settings = getSettings();
  // Session switched in a reused container: history of the new session is not "new".
  if (sessionId !== w.sessionId) {
    w.sessionId = sessionId;
    w.baseline = maxIndex(container);
    return;
  }
  // Hands-free off: keep the baseline current so turning it on never reads old messages.
  if (!settings.enabled || !settings.autoRead) {
    w.baseline = Math.max(w.baseline, maxIndex(container));
    return;
  }

  const fresh = [...container.querySelectorAll(SEL.message)]
    .filter((m) => indexOf(m) > w.baseline)
    .sort((a, b) => indexOf(a) - indexOf(b));

  for (const m of fresh) {
    const idx = indexOf(m);
    if (m.querySelector(SEL.turnFinished) && !spoken.has(`${sessionId}:end:${idx}`)) {
      spoken.add(`${sessionId}:end:${idx}`);
      speakLastReply(container, sessionId, idx, w.baseline);
    }
    const q = m.querySelector(SEL.question);
    if (q && !spoken.has(`${sessionId}:q:${idx}`)) {
      const text = questionText(q);
      if (text) {
        spoken.add(`${sessionId}:q:${idx}`);
        speakLastReply(container, sessionId, idx, w.baseline);
        player.enqueue(`q:${sessionId}:${idx}`, text);
      }
    }
  }
}

/** Sync the on/off state to the backend so the agent's /voice tool and the UI agree. */
/** Called after the user flips hands-free in the UI; preloads the model so the first reply is quick. */
export function setAutoRead(enabled: boolean) {
  if (enabled) callBackend('warmup', { dir: getSettings().ttsDirectory }).catch(() => undefined);
}

export function startAutoRead(): () => void {
  const watches = new Map<Element, Watch>();

  const scan = () => {
    for (const [c, w] of watches) {
      if (!c.isConnected) {
        w.observer.disconnect();
        if (w.timer) clearTimeout(w.timer);
        watches.delete(c);
      }
    }
    document.querySelectorAll(SEL.transcript).forEach((c) => {
      if (watches.has(c)) return;
      const w: Watch = { sessionId: sessionOf(c), baseline: maxIndex(c), observer: null as unknown as MutationObserver, timer: null };
      // Throttle, not debounce: a running session mutates the DOM every second
      // (elapsed timers), which would postpone a debounced check forever.
      w.observer = new MutationObserver(() => {
        if (w.timer) return;
        w.timer = setTimeout(() => {
          w.timer = null;
          check(c, w);
        }, SETTLE_MS);
      });
      w.observer.observe(c, { childList: true, subtree: true });
      watches.set(c, w);
    });
  };
  const scanTimer = setInterval(scan, SCAN_MS);
  scan();

  // Pick up /voice requests from the agent. The saved setting stays the source of
  // truth; each backend (one per open project) is tracked by its instance id.
  let pollTimer: ReturnType<typeof setTimeout>;
  let warmedUp = false;
  const poll = async () => {
    let delay = POLL_MS;
    try {
      const s = getSettings();
      const { autoRead: req } = await callBackend<{ autoRead: AgentRequest }>('status', {
        dir: s.ttsDirectory,
        uiAutoRead: s.autoRead,
      });
      const seen = seenSeq.get(req.instanceId);
      // A backend seen for the first time may carry a request made moments ago.
      const isNew = seen === undefined ? req.seq > 0 && Date.now() - req.at < AGENT_REQUEST_FRESH_MS : req.seq > seen;
      seenSeq.set(req.instanceId, req.seq);
      if (isNew && req.enabled !== s.autoRead) await updateSetting('autoRead', req.enabled);
      if (getSettings().autoRead && (isNew || !warmedUp)) {
        warmedUp = true;
        setAutoRead(true);
      }
    } catch {
      delay = POLL_BACKOFF_MS;
    }
    pollTimer = setTimeout(poll, delay);
  };
  pollTimer = setTimeout(poll, 1000);

  return () => {
    clearInterval(scanTimer);
    clearTimeout(pollTimer);
    for (const w of watches.values()) {
      w.observer.disconnect();
      if (w.timer) clearTimeout(w.timer);
    }
    watches.clear();
  };
}
