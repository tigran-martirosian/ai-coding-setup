// Finds the chat composers in the app's page. Read from the app's renderer code (Nimbalyst 2026-10-29):
// the composer is a flex row holding `div.ai-chat-input-textarea-wrap > textarea.ai-chat-input-field`
// and then ONE button: `button.ai-chat-send-button` (aria-label "Send message"), or, while the session
// runs and the composer has a cancel handler, `button.ai-chat-cancel-button`. The session id is the
// `data-session-id` of the nearest ancestor (agent-session-panel, panel-session-transcript or
// chat-sidebar), and it is the Nimbalyst session id, the one steer.mjs and createQueuedPrompt take.

import { t } from './strings.ts';
import type { Attachment } from './note.ts';

export interface El {
  parentElement: El | null;
  closest(selector: string): El | null;
  getAttribute(name: string): string | null;
  querySelector(selector: string): El | null;
}

export interface Composer {
  button: El;
  row: El;
  sessionId: string | null;
}

export const SEND_BUTTON = 'button.ai-chat-send-button, button.ai-chat-cancel-button, button[aria-label="Send message"]';

export const CHIP = '.attachment-preview';
const REMOVE = '.attachment-preview-remove';

function chipFile(chip: Element): Attachment | undefined {
  const key = Object.keys(chip).find((k) => k.startsWith('__reactFiber$'));
  type Fiber = { memoizedProps?: { attachment?: Attachment }; return?: Fiber };
  for (let f = key ? (chip as unknown as Record<string, Fiber>)[key] : undefined; f; f = f.return) {
    const file = f.memoizedProps?.attachment;
    if (file?.filepath) return file;
  }
  return undefined;
}

/**
 * The files in a chat box. The app keeps them only in React state, so each chip's `attachment` prop
 * is read from the element's React fiber. A chip that gives no path is an error, never a note without
 * its file.
 */
export function readFiles(scope: Element, text: string): Attachment[] {
  const files = Array.from(scope.querySelectorAll(CHIP)).map((chip) => {
    if (chip.classList.contains('attachment-preview-processing')) throw new Error(t.note.fileBusy);
    const file = chipFile(chip);
    if (!file) throw new Error(t.note.fileNoPath);
    return file;
  });
  // The app writes @pasted-image-… into the text: with no chip beside it, the chip's markup has changed
  if (!files.length && /@pasted-image-\S/.test(text)) throw new Error(t.note.fileNoPath);
  return files;
}

/**
 * Takes the sent files out of the chat box with each chip's own remove button (the saved file stays);
 * a file added since keeps its chip. False if one of them could not be removed.
 */
export function removeFiles(scope: Element, sent: Attachment[]): boolean {
  const ids = new Set(sent.map((f) => f.id));
  const chips = Array.from(scope.querySelectorAll(CHIP)).filter((chip) => ids.has(chipFile(chip)?.id ?? ''));
  const buttons = chips.map((chip) => chip.querySelector<HTMLElement>(REMOVE));
  buttons.forEach((remove) => remove?.click());
  return chips.length === sent.length && buttons.every(Boolean);
}

export function findComposers(root: { querySelectorAll(selector: string): ArrayLike<El> }): Composer[] {
  const found: Composer[] = [];
  for (const button of Array.from(root.querySelectorAll(SEND_BUTTON))) {
    const row = button.parentElement;
    if (!row || !row.querySelector('textarea') || found.some((c) => c.row === row)) continue;
    found.push({ button, row, sessionId: button.closest('[data-session-id]')?.getAttribute('data-session-id') || null });
  }
  return found;
}
