// One session (actions 9, 10, 13, 16, 17 and 23 of the PC program design): its conversation, sending, a Note,
// a new session and Stop.
import { knownSession, sessionsCreatedSince } from "../core/db.mjs";
import {
  createSession,
  hasTool,
  listQueued,
  PROJECT_INPUT,
  phoneNote,
  projectByHandle,
  recentSessionIds,
  SESSION_INPUT,
  sendPrompt,
  sessionState,
  spawnSession,
  stopSession,
  watchDoor,
} from "../core/door.mjs";
import { sessionPlace } from "../core/files.mjs";
import { ActionError } from "../core/registry.mjs";
import { readTurns, transcriptPath } from "../core/transcripts.mjs";
import { sessionOpened } from "./alerts.mjs";
import { ATTACHMENTS_INPUT, sendWithAttachments } from "./attach.mjs";
import { steerNote } from "../core/steer-note.mjs";

const TURNS = 50;
// One answer stays within one stream piece (pipe design, section 4); older turns are left to session.older.
const MAX_ANSWER = 192 * 1024;
const MAX_TURN_TEXT = 100000;
const STOP_PROMPT = "Stop here and wait for my next message.";
const FK_FAILED = /FOREIGN KEY constraint failed/;

export const TEXT_INPUT = { type: "string", min: 1, max: 20000 };

// Turns as the phone gets them: a very long text is cut (cut: true), and the oldest turns are dropped until the
// answer fits; `before` then points at the first turn kept. Each turn keeps its `pos` (its line's byte offset): the
// page passes it back as `at` to step.detail and session.changes (files design).
function fit(turns, before, rest) {
  const items = turns.map((t) =>
    t.text.length > MAX_TURN_TEXT
      ? { ...t, text: t.text.slice(0, MAX_TURN_TEXT), cut: true }
      : t,
  );
  let from = 0;
  const size = () =>
    Buffer.byteLength(
      JSON.stringify({ ...rest, items: items.slice(from), before }),
    );
  while (from < items.length && size() > MAX_ANSWER) {
    from++;
    before = turns[from] ? turns[from].pos : before;
  }
  return { ...rest, items: items.slice(from), before };
}

function turnsOf(row, end) {
  const file = transcriptPath(row);
  if (!file) return { turns: [], before: null, end: 0 };
  return readTurns(file, end, TURNS, sessionPlace(row));
}

// A project with sessions: spawn_session from its newest one, as the old bot did. A project with none: today's
// create_session error path (PC program design, section 3, "A new session in a project with no sessions").
async function newSession(projectPath, text) {
  const callers = await recentSessionIds(projectPath, 1);
  if (callers.length) return spawnSession(projectPath, callers[0], text);
  const since = new Date().toISOString();
  try {
    return await createSession(projectPath, text);
  } catch (e) {
    if (e.err !== "door-error" || !FK_FAILED.test(e.extra.message)) throw e;
    const made = sessionsCreatedSince(projectPath, since);
    if (made.length !== 1)
      throw new ActionError("new-session-unclear", {
        message: e.extra.message,
        found: made.length,
      });
    await sendPrompt(projectPath, made[0].id, text);
    return made[0].id;
  }
}

export function register(registry) {
  watchDoor();

  registry.add({
    name: "session.open",
    input: { session: SESSION_INPUT },
    run: async (d) => {
      const { row, project } = knownSession(d.session);
      const state = await sessionState(project.path, d.session);
      const { turns, before, end } = turnsOf(row, null);
      // Opened on the phone: the session's finished alert leaves the bot chat.
      sessionOpened(d.session);
      // `end`: the transcript byte this read stopped at, the page's `start` for session.watch.
      return fit(turns, before, {
        title: row.title,
        project: project.project,
        state,
        model: row.model,
        end,
      });
    },
  });

  registry.add({
    name: "session.older",
    input: {
      session: SESSION_INPUT,
      before: { type: "integer", min: 1, max: Number.MAX_SAFE_INTEGER },
    },
    run: (d) => {
      const { row } = knownSession(d.session);
      if (!transcriptPath(row))
        throw new ActionError("bad-input", { field: "before" });
      const { turns, before } = turnsOf(row, d.before);
      return fit(turns, before, {});
    },
  });

  registry.add({
    name: "session.send",
    input: {
      session: SESSION_INPUT,
      text: TEXT_INPUT,
      attachments: ATTACHMENTS_INPUT,
    },
    run: async (d, ctx) => {
      const { project } = knownSession(d.session);
      const r = await sendWithAttachments(
        d.attachments,
        ctx.device,
        project.path,
        d.text,
        (text) => sendPrompt(project.path, d.session, text),
      );
      return { started: r.processingTriggered === true };
    },
  });

  registry.add({
    name: "session.note",
    input: { session: SESSION_INPUT, text: TEXT_INPUT },
    // The same path as the desktop Note button: steer.mjs puts the note where the busy session reads it before
    // its next step. A session that is not busy (steer's exit 3) gets it as a normal message, which starts it.
    run: async (d) => {
      const { project } = knownSession(d.session);
      const r = await steerNote(d.session, `${d.text}\n\n${await phoneNote()}`);
      if (r.code === 0) return { held: true };
      if (r.code === 3) {
        const s = await sendPrompt(project.path, d.session, d.text);
        return { started: s.processingTriggered === true };
      }
      throw new ActionError("note-failed", {
        why: r.words || `steer.mjs exited with ${r.code}`,
      });
    },
  });

  registry.add({
    name: "session.new",
    input: {
      project: PROJECT_INPUT,
      text: TEXT_INPUT,
      attachments: ATTACHMENTS_INPUT,
    },
    run: async (d, ctx) => {
      const project = projectByHandle(d.project);
      const session = await sendWithAttachments(
        d.attachments,
        ctx.device,
        project.path,
        d.text,
        (text) => newSession(project.path, text),
      );
      return { session };
    },
  });

  // Without the patch's stop_session: an interrupting prompt (probe 1), which costs one short turn. With messages
  // queued that would run the oldest of them instead, so it is refused. A session waiting on the user stops only
  // through stop_session (DS2: Stop shows while it works and while it needs you).
  registry.add({
    name: "session.stop",
    input: { session: SESSION_INPUT },
    run: async (d) => {
      const { project } = knownSession(d.session);
      const state = await sessionState(project.path, d.session);
      if (state === "idle") throw new ActionError("not-running");
      if (await hasTool("stop_session")) {
        await stopSession(project.path, d.session);
        return { method: "stop" };
      }
      if (
        state !== "running" ||
        (await listQueued(project.path, d.session)).length
      )
        throw new ActionError("needs-door-patch", { tool: "stop_session" });
      await sendPrompt(project.path, d.session, STOP_PROMPT, {
        interrupt: true,
      });
      return { method: "interrupt-turn" };
    },
  });
}
