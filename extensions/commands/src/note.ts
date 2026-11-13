// Sends a note to a running session: steer.mjs puts it where the session reads it before its next
// step; an idle session is started with the text instead.

import { t } from './strings.ts';
export type Invoke = (channel: string, ...args: unknown[]) => Promise<unknown>;
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
}
type Exec = { success: boolean; stdout?: string; stderr?: string; exitCode?: number | string };

const fail = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

/** The user's home folder, with forward slashes (node and cmd.exe both take them). */
export async function homeDir(invoke: Invoke): Promise<string> {
  const r = (await invoke('extension:exec', { extensionId: EXT_ID, command: 'node -p "require(\'os\').homedir()"', timeout: 15000 })) as Exec;
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
  if (!/^[A-Za-z0-9_-]+$/.test(sessionId)) return { ok: false, message: t.note.oddId(sessionId.slice(0, 40)) };
  // one file per session: two chat boxes sending at once must not read each other's note
  const file = `${home}/.claude/steer/button-note-${sessionId}.txt`;
  try {
    await invoke('extensions:write-file', file, note);
    const r = (await invoke('extension:exec', {
      extensionId: EXT_ID,
      command: `node "${home}/.claude/skills/steer/steer.mjs" send --to ${sessionId} - < "${file}"`,
      timeout: 30000,
    })) as Exec;
    // exit 0 also means "queued, not delivered yet": only steer's Delivered line is a delivery
    if (r.success && Number(r.exitCode ?? 0) === 0) return { ok: true, message: /^Delivered/m.test(r.stdout ?? '') ? t.note.sent : t.note.waiting };
    if (Number(r.exitCode) === 3) {
      await invoke('ai:createQueuedPrompt', sessionId, text.trim() || note, files);
      return { ok: true, message: t.note.queued };
    }
    const why = (r.stdout || r.stderr || '').trim().replace(/\s+/g, ' ').slice(0, 240);
    return { ok: false, message: t.note.notSentCode(r.exitCode, why || 'no output') };
  } catch (e) {
    return { ok: false, message: t.note.notSent(fail(e)) };
  }
}
