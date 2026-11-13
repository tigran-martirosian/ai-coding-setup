// Sends a note to a running session: the steer script puts it where the session reads it before its
// next step; an idle session is started with the text instead.

import { hostError, hostExec } from '../../shared/host.ts';
import type { Invoke } from '../../shared/host.ts';
import { t } from './strings.ts';

import { readOrNull } from './bridge.ts';

/** A file in the chat box, as the app saved it (only the fields used here are named). */
export interface Attachment {
  id: string;
  filename: string;
  filepath: string;
}
export const EXT_ID = 'com.local.commandbuttons';
export interface Outcome {
  ok: boolean;
  message: string;
  /** steer's id for a note that is still on its way */
  noteId?: string;
}
/** A note on its way to a session: `home` is where its receipt will be. */
export interface Pending {
  id: string;
  session: string;
  home: string;
  ts: number;
  /** the start of the note, so a message about it can say which one */
  text: string;
}
// steer drops a note after 2 hours and a session's next hook writes "failed"; a session that never
// runs again writes nothing, so the button stops waiting a little after that.
export const GIVE_UP_MS = 130 * 60_000;
type Exec = { success: boolean; stdout?: string; stderr?: string; exitCode?: number | string };

/** The user's home folder, with forward slashes (node and cmd.exe both take them). */
export async function homeDir(invoke: Invoke): Promise<string> {
  const r = await hostExec<Exec>(invoke, EXT_ID, 'node -p "require(\'os\').homedir()"', 15000);
  const home = (r.stdout ?? '').trim().replace(/\\/g, '/');
  if (!r.success || !home) throw new Error(`could not find the home folder: ${(r.stderr || r.stdout || 'no output').trim()}`);
  return home;
}

/** The chat box's text holds only `@name` for a file, so the note carries each file's path. */
export const withFiles = (text: string, files: Attachment[]) =>
  [text.trim(), ...files.map((f) => `Attached file: ${f.filepath} (open it with the Read tool)`)].filter(Boolean).join('\n');

export async function sendNote(text: string, sessionId: string, home: string, invoke: Invoke, files: Attachment[] = []): Promise<Outcome> {
  const note = withFiles(text, files);
  if (!note) return { ok: false, message: t.note.typeFirst };
  // the id goes into a shell command line
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return { ok: false, message: t.note.oddId };
  // one file per session: two chat boxes sending at once must not read each other's note
  const file = `${home}/.claude/steer/button-note-${sessionId}.txt`;
  try {
    await invoke('extensions:write-file', file, note);
    // --nowait comes after the "-": a steer.mjs too old to know it must still read the note from the file
    const r = await hostExec<Exec>(invoke, EXT_ID, `node "${home}/.claude/skills/steer/steer.mjs" send --to ${sessionId} - --nowait < "${file}"`, 30000);
    // exit 0 means "in the inbox": the receipt that says it arrived is watched by noteEnds
    if (r.success && Number(r.exitCode ?? 0) === 0) {
      const noteId = /^Note id: (\S+)/m.exec(r.stdout ?? '')?.[1];
      return { ok: true, message: noteId ? t.note.waiting : t.note.untracked, noteId };
    }
    if (Number(r.exitCode) === 3) {
      await invoke('ai:createQueuedPrompt', sessionId, text.trim() || note, files);
      return { ok: true, message: t.note.queued };
    }
    const why = (r.stdout || r.stderr || '').trim().replace(/\s+/g, ' ').replace(/^NOT SENT:?\s*/i, '').slice(0, 240);
    return { ok: false, message: t.note.notSentWhy(why || 'no answer from the helper') };
  } catch (e) {
    return { ok: false, message: t.note.notSent(hostError(e)) };
  }
}

/**
 * The notes in `pending` that have an end, read from steer's receipts.json. A file that cannot be read
 * is logged and counts as no news, so the time limit still ends a note and the polling stops.
 */
export async function noteEnds(pending: Pending[], invoke: Invoke, now = Date.now(), log: (m: string) => void = console.warn) {
  if (!pending.length) return [];
  let receipts: { id: string; state: string }[] = [];
  try {
    const list = JSON.parse((await readOrNull(invoke, `${pending[0].home}/.claude/steer/receipts.json`)) ?? '[]');
    if (!Array.isArray(list)) throw new Error('receipts.json is not a list');
    receipts = list;
  } catch (e) {
    log(`[commandbuttons] note receipts: ${hostError(e)}`);
  }
  return pending.flatMap((note) => {
    const state = receipts.find((r) => r?.id === note.id)?.state;
    if (state === 'delivered' || state === 'failed') return [{ note, state }];
    return now - note.ts > GIVE_UP_MS ? [{ note, state: 'unconfirmed' }] : [];
  });
}

// "failed" can also mean the session read the note and went quiet before steer saw it there, so the
// message never says it was not read
export const endMessage = (state: string, text: string): Outcome =>
  state === 'delivered' ? { ok: true, message: t.note.delivered } : { ok: false, message: t.note.notConfirmed(text) };
