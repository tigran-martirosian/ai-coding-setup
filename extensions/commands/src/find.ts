// Finds the chat composers in the app's page. Read from the app's renderer code (Nimbalyst 2026-10-29):
// the composer is a flex row holding `div.ai-chat-input-textarea-wrap > textarea.ai-chat-input-field`
// and then ONE button: `button.ai-chat-send-button` (aria-label "Send message"), or, while the session
// runs and the composer has a cancel handler, `button.ai-chat-cancel-button`. The session id is the
// `data-session-id` of the nearest ancestor (agent-session-panel, panel-session-transcript or
// chat-sidebar), and it is the Nimbalyst session id, the one steer.mjs and createQueuedPrompt take.

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

export function findComposers(root: { querySelectorAll(selector: string): ArrayLike<El> }): Composer[] {
  const found: Composer[] = [];
  for (const button of Array.from(root.querySelectorAll(SEND_BUTTON))) {
    const row = button.parentElement;
    if (!row || !row.querySelector('textarea') || found.some((c) => c.row === row)) continue;
    found.push({ button, row, sessionId: button.closest('[data-session-id]')?.getAttribute('data-session-id') || null });
  }
  return found;
}
