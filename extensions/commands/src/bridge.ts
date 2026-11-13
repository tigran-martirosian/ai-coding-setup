// Wake bridge: scripts outside the app (steer.mjs) append lines to ~/.claude/steer/outbox.jsonl,
//   {"id":"<unique>","ts":<ms>,"session":"<nimbalyst session id>","prompt":"<text>"}
// and this polls the file and hands each new one to ai:createQueuedPrompt, which starts an idle
// session at once. Delivered ids are kept in outbox-done.json (only written here) so a restart
// does not deliver twice. outbox.jsonl itself is never written here: steer.mjs prunes it.
import type { Invoke } from './note';

export interface OutboxEntry {
  id: string;
  ts: number;
  session: string;
  prompt: string;
}
export const MAX_AGE = 10 * 60_000;
export const KEEP = 2 * 3600_000;
export const MAX_TRIES = 3;
export const POLL_MS = 3000;

export interface BridgeState {
  done: Map<string, number>; // delivered id -> when (ms), for the 2 hour limit
  tries: Map<string, number>;
  loaded: boolean;
  busy: boolean;
}
export const newState = (): BridgeState => ({ done: new Map(), tries: new Map(), loaded: false, busy: false });

const missing = (e: unknown) => /ENOENT|no such file/i.test(String((e as Error)?.message ?? e));
const reason = (e: unknown) => String((e as Error)?.message ?? e);

export function parseOutbox(text: string): OutboxEntry[] {
  const out: OutboxEntry[] = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (typeof e?.id === 'string' && e.id && typeof e.ts === 'number' && typeof e.session === 'string' && e.session && typeof e.prompt === 'string' && e.prompt) out.push(e);
    } catch {
      /* a half-written line: the next poll sees it whole */
    }
  }
  return out;
}

/** The file's text, or null when it does not exist. Any other failure throws. */
async function readOrNull(invoke: Invoke, file: string): Promise<string | null> {
  try {
    return String(await invoke('extensions:read-file', file));
  } catch (e) {
    if (missing(e)) return null;
    throw e;
  }
}

/** One poll. Returns how many prompts were delivered. */
export async function pollOutbox(invoke: Invoke, home: string, state: BridgeState, now = Date.now(), log: (...a: unknown[]) => void = console.error): Promise<number> {
  if (state.busy) return 0;
  state.busy = true;
  const dir = `${home}/.claude/steer`;
  try {
    if (!state.loaded) {
      const saved = await readOrNull(invoke, `${dir}/outbox-done.json`);
      if (saved) {
        try {
          for (const id of JSON.parse(saved)) if (typeof id === 'string') state.done.set(id, now);
        } catch (e) {
          log(`[commandbuttons] outbox-done.json is not readable, starting empty: ${reason(e)}`);
        }
      }
      state.loaded = true;
    }
    const text = await readOrNull(invoke, `${dir}/outbox.jsonl`);
    if (!text) return 0;
    let delivered = 0;
    for (const entry of parseOutbox(text)) {
      if (state.done.has(entry.id) || now - entry.ts > MAX_AGE) continue;
      const tried = state.tries.get(entry.id) ?? 0;
      if (tried >= MAX_TRIES) continue;
      try {
        await invoke('ai:createQueuedPrompt', entry.session, entry.prompt);
      } catch (e) {
        state.tries.set(entry.id, tried + 1);
        log(`[commandbuttons] outbox delivery failed, id ${entry.id} (try ${tried + 1} of ${MAX_TRIES}): ${reason(e)}`);
        continue;
      }
      state.done.set(entry.id, now);
      delivered++;
      try {
        for (const [id, t] of state.done) if (now - t > KEEP) state.done.delete(id);
        await invoke('extensions:write-file', `${dir}/outbox-done.json`, JSON.stringify([...state.done.keys()]));
      } catch (e) {
        log(`[commandbuttons] could not save outbox-done.json, id ${entry.id} may be delivered again after a restart: ${reason(e)}`);
      }
    }
    return delivered;
  } catch (e) {
    log(`[commandbuttons] outbox poll failed: ${reason(e)}`);
    return 0;
  } finally {
    state.busy = false;
  }
}
