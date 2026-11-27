// Alerts in the bot chat (PC program design, section 3 "Alerts", actions 18 to 20). The watcher reads every
// session's state from Nimbalyst's database every second; a session that turns waiting gives "needs you", one
// that goes from running to idle gives "finished", or "handed off, continuing" when its last turn ran the handoff
// skill's brief command. By the user's choice per kind (kept in the state file) it sends
// `alert { text, silent, open }` through the relay, or nothing. The text is only "<project> · <session title>: "
// and the kind's words ("<project>: " for an untitled session), never what the session wrote; `open` is a random
// handle mapped in the state file to the session for 7 days, so the bot's Open button carries no id. A new state
// must hold for 2 seconds before it is sent, so a waiting question alerts within 3 seconds and a session that
// turns waiting and back sends nothing; a state that did not hold does not count as a change, so a flicker never
// sends the same alert twice. main.mjs starts the watcher with createAlerts({ send: link.send }).
// A session has one alert in the chat at most: its handle is marked `shown` in the state file, and every change of
// that session that held removes it first (`alert-done { open }`; the relay deletes the message), so the next alert
// replaces it and an answered question's alert goes. A finished or handed-off alert also goes when the session is
// opened in the app (sessionOpened, from session.open) or read in Nimbalyst (its metadata's hasUnread turns false).
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import { PROTOCOL } from "../../../../phone/shared/seal.mjs";
import { openForm, sessionRow, sessionsUpdatedSince } from "../core/db.mjs";
import { listProjects, mapState } from "../core/door.mjs";
import { log } from "../core/log.mjs";
import { ActionError } from "../core/registry.mjs";
import { waitingAlerts } from "../core/script-alerts.mjs";
import { readState, updateState } from "../core/state.mjs";
import { lastTurnCommands, transcriptPath } from "../core/transcripts.mjs";

const EVERY_MS = 1000;
const SETTLE_MS = 2000;
const HANDLE_DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

// The kinds this build watches, with DS1's defaults. "job-needs-you" comes with the jobs list (part 2).
// A handoff is off until the user turns it on: most sessions end that way and nobody wants to be spammed.
export const KINDS = {
  "session-needs-you": { words: "needs you", mode: "buzz" },
  "session-finished": { words: "finished", mode: "silent" },
  "session-handed-off": { words: "handed off, continuing", mode: "off" },
};
export const MODES = ["buzz", "silent", "off"];

// The relay's pattern for a project name (pipe design, section 5): other characters become "-", 40 at most.
export const alertName = (name) =>
  String(name)
    .replace(/[^A-Za-z0-9 ._-]/g, "-")
    .slice(0, 40);

// The relay's pattern for a session title: letters and digits of any script, space, ".", "_" and "-"; other
// characters become "-", 60 at most (counted in characters, so a letter outside the BMP is never cut in half).
// A session sets its own title: a dot before a letter becomes "-", so nothing in it reads as a domain in the chat.
export const alertTitle = (title) =>
  Array.from(
    String(title ?? "")
      .trim()
      .replace(/[^\p{L}\p{N} ._-]/gu, "-")
      .replace(/\.(?=\p{L})/gu, "-"),
  )
    .slice(0, 60)
    .join("");

export function alertText(project, title, kind) {
  const t = alertTitle(title);
  return `${alertName(project)}${t ? ` · ${t}` : ""}: ${KINDS[kind].words}`;
}

// The words of each simple command in a shell line: split at ;, &, |, brackets and new lines outside quotes.
function shellCommands(line) {
  const out = [[]];
  let word = null;
  let quote = null;
  const end = () => {
    if (word !== null) out.at(-1).push(word);
    word = null;
  };
  for (const c of line) {
    if (quote) {
      if (c === quote) quote = null;
      else word += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      word ??= "";
    } else if (/[;&|()\n]/.test(c)) {
      end();
      if (out.at(-1).length) out.push([]);
    } else if (/\s/.test(c)) end();
    else word = (word ?? "") + c;
  }
  end();
  return out;
}

const NODE = /(^|[\\/])node(\.exe)?$/i;
const BRIEF = /(^|[\\/])handoff[\\/]brief\.mjs$/;
const ENV = /^[A-Za-z_][A-Za-z0-9_]*=/;

// True when a shell line runs node on the handoff skill's brief.mjs with --summary, as the skill does. A run
// without --summary and a command that only quotes the names, like a grep, do not count.
export function runsHandoffBrief(line) {
  return shellCommands(String(line)).some((all) => {
    const words = all.slice(all.findIndex((w) => !ENV.test(w)));
    const script = words.slice(1).find((w) => !w.startsWith("-"));
    return (
      NODE.test(words[0] ?? "") &&
      BRIEF.test(script ?? "") &&
      words.some((w) => w === "--summary" || w.startsWith("--summary="))
    );
  });
}

// "session-handed-off" when the session's last turn ran the handoff skill's brief command, else
// "session-finished". A session with no transcript, or one that cannot be read, is finished, with one log line.
function finishKind(sessionId) {
  try {
    const row = sessionRow(sessionId);
    const file = row ? transcriptPath(row) : null;
    if (!file) {
      log("alert", "finished: the session has no transcript");
      return "session-finished";
    }
    return lastTurnCommands(file).some(runsHandoffBrief)
      ? "session-handed-off"
      : "session-finished";
  } catch (e) {
    log(
      "error",
      `alerts: a finished session's transcript was not read: ${e.err ?? e.message}`,
    );
    return "session-finished";
  }
}

export function alertMode(kind) {
  const chosen = readState().alerts?.[kind];
  if (chosen === undefined) return KINDS[kind].mode;
  if (!MODES.includes(chosen))
    throw new Error(
      `pc-state.json: alert mode "${String(chosen).slice(0, 20)}" for ${kind} is not ${MODES.join(", ")}`,
    );
  return chosen;
}

// Keeps a sent alert's handle for the session 7 days, marked as shown in the chat; older handles are dropped on the
// same write.
function keepHandle(handle, project, session, kind, now) {
  updateState((s) => {
    const kept = {};
    for (const [h, v] of Object.entries(s.handles || {}))
      if (now - Date.parse(v.at) < HANDLE_DAYS * DAY_MS) kept[h] = v;
    kept[handle] = {
      project,
      session,
      at: new Date(now).toISOString(),
      shown: kind,
    };
    s.handles = kept;
  });
}

// Session id -> { open, kind } of the alert each session still shows in the chat.
function shownAlerts() {
  const out = new Map();
  for (const [open, h] of Object.entries(readState().handles || {}))
    if (h.shown) out.set(h.session, { open, kind: h.shown });
  return out;
}

// The alerts that go when their session is opened in the app or read in Nimbalyst.
const READ_KINDS = ["session-finished", "session-handed-off"];
const opened = new Set();

// session.open calls this; the watcher's next look removes that session's finished or handed-off alert.
export function sessionOpened(sessionId) {
  opened.add(sessionId);
}

// True when Nimbalyst marks the session read: its metadata's metadata.hasUnread is false once it was viewed there.
function readInNimbalyst(id, metadata) {
  let m;
  try {
    m = JSON.parse(metadata);
  } catch {
    throw new Error(`session ${id}: metadata is not valid JSON`);
  }
  return m?.metadata?.hasUnread === false;
}

// What a session reads as for alerts: a session on an unanswered form needs the user even while "running".
function stateOf(row) {
  const state = mapState(row.status);
  return state === "running" && openForm(row.id) ? "waiting" : state;
}

// The script door (core/script-alerts.mjs): each waiting ask goes out as "<project> · <title>: needs you" by the
// user's needs-you choice, and its file goes once the relay socket took it (it stays while the relay is away). Its
// Open handle is kept marked `script`, with no session, so the watcher never removes the alert and Open says
// from-a-script. A file that is not a valid ask moves to .bad with a log line, never retried. Returns how many went.
export function sendScriptAlerts(send, now = Date.now) {
  let sent = 0;
  for (const w of waitingAlerts()) {
    if (w.error) {
      fs.renameSync(w.file, `${w.file}.bad`);
      log(
        "error",
        `alerts: script ask ${w.file} is not valid (${w.error}): moved to .bad`,
      );
      continue;
    }
    const mode = alertMode("session-needs-you");
    if (mode === "off") {
      fs.rmSync(w.file, { force: true });
      log("alert", "script needs-you off");
      continue;
    }
    const open = randomBytes(9).toString("base64url");
    const ok = send({
      v: PROTOCOL,
      t: "alert",
      text: `${alertName(w.ask.project)} · ${alertTitle(w.ask.title) || "-"}: needs you`,
      silent: mode === "silent",
      open,
    });
    if (!ok) break;
    fs.rmSync(w.file, { force: true });
    log("alert", `script needs-you ${mode}`);
    try {
      updateState((s) => {
        s.handles = {
          ...(s.handles || {}),
          [open]: {
            project: null,
            session: null,
            at: new Date(now()).toISOString(),
            script: true,
          },
        };
      });
    } catch (e) {
      log(
        "error",
        `alerts: a sent script alert's handle was not kept: ${e.message}`,
      );
    }
    sent++;
  }
  return sent;
}

// send(frame) -> true when the relay socket took it. `now` and the timings are for tests.
export function createAlerts({
  send,
  now = Date.now,
  everyMs = EVERY_MS,
  settleMs = SETTLE_MS,
}) {
  let settled = null; // session id -> the last state that held; null until the first look (which sends nothing)
  const due = new Map(); // session id -> { state, since, kind? }: a new state not yet held for settleMs
  let timer = null;
  let lastError = null;

  function look() {
    const byPath = new Map(listProjects().map((p) => [p.path, p]));
    const since = new Date(now() - DAY_MS).toISOString();
    const seen = new Map();
    for (const r of sessionsUpdatedSince(since, [])) {
      const p = byPath.get(r.workspace_id);
      if (p)
        seen.set(r.id, {
          state: stateOf(r),
          project: p,
          title: r.title,
          metadata: r.metadata,
        });
    }
    return seen;
  }

  // Asks the relay to delete a shown alert; false while the relay is away (it is asked again at the next look).
  function removeAlert(a, why) {
    if (!send({ v: PROTOCOL, t: "alert-done", open: a.open })) return false;
    updateState((s) => {
      if (s.handles?.[a.open]) delete s.handles[a.open].shown;
    });
    log("alert", `${a.kind} removed: ${why}`);
    return true;
  }

  // A finished or handed-off alert goes once its session was opened in the app or read in Nimbalyst.
  function removeRead(seen, shown) {
    for (const [id, a] of shown) {
      if (!READ_KINDS.includes(a.kind)) continue;
      const why = opened.has(id)
        ? "opened in the app"
        : seen.has(id) && readInNimbalyst(id, seen.get(id).metadata)
          ? "read in Nimbalyst"
          : null;
      if (why && removeAlert(a, why)) {
        shown.delete(id);
        opened.delete(id);
      }
    }
    for (const id of opened)
      if (!READ_KINDS.includes(shown.get(id)?.kind)) opened.delete(id);
  }

  // The alert a change from `before` to `state` gives, or null.
  function kindOf(session, before, state) {
    if (state === "waiting") return "session-needs-you";
    if (state === "idle" && before === "running") return finishKind(session);
    return null;
  }

  function sendOne(session, kind, s) {
    const mode = alertMode(kind);
    if (mode === "off") {
      log("alert", `${kind} off`);
      return true;
    }
    // A fresh 12-character handle; kept only once the relay socket took the alert.
    const open = randomBytes(9).toString("base64url");
    const ok = send({
      v: PROTOCOL,
      t: "alert",
      text: alertText(s.project.name, s.title, kind),
      silent: mode === "silent",
      open,
    });
    if (!ok) return false;
    log("alert", `${kind} ${mode}`);
    // The alert is out: a handle that is not kept only loses its Open button and its removal, it never resends.
    try {
      keepHandle(open, s.project.project, session, kind, now());
    } catch (e) {
      log(
        "error",
        `alerts: a sent ${kind} alert's handle was not kept: ${e.message}`,
      );
    }
    return true;
  }

  // One look at the sessions; returns how many alerts went out (or were off).
  function tick() {
    const seen = look();
    const t = now();
    if (!settled) {
      settled = new Map([...seen].map(([id, s]) => [id, s.state]));
      return 0;
    }
    for (const id of settled.keys()) if (!seen.has(id)) settled.delete(id);
    for (const id of due.keys()) if (!seen.has(id)) due.delete(id);
    const shown = shownAlerts();
    removeRead(seen, shown);
    let done = 0;
    for (const [id, s] of seen) {
      const before = settled.get(id);
      // A change that went back before it held is dropped, so it never counts as a change.
      if (s.state === before) {
        due.delete(id);
        continue;
      }
      let d = due.get(id);
      if (d?.state !== s.state) {
        d = { state: s.state, since: t };
        due.set(id, d);
      }
      if (t - d.since < settleMs) continue;
      // Held: its kind is found once; it is sent once (kept while the relay is away).
      if (!("kind" in d)) d.kind = kindOf(id, before, s.state);
      // The session's alert still in the chat goes first: answered, running again, or replaced by the new one.
      const old = shown.get(id);
      if (old) {
        if (!removeAlert(old, "its session changed")) continue;
        shown.delete(id);
      }
      if (d.kind && !sendOne(id, d.kind, s)) continue;
      settled.set(id, s.state);
      due.delete(id);
      if (d.kind) done++;
    }
    return done;
  }

  function safeTick() {
    // The script door works with Nimbalyst closed too, so it runs apart from the session look.
    try {
      sendScriptAlerts(send, now);
    } catch (e) {
      log("error", `alerts: script door: ${e.message}`);
    }
    try {
      tick();
      lastError = null;
    } catch (e) {
      // With Nimbalyst closed nothing changes; the next open starts a fresh first look. Any other read error keeps
      // the known states, so a change made while the sessions could not be read still alerts at the next look.
      const why = e.err === "nimbalyst-closed" ? "nimbalyst-closed" : e.message;
      if (why === "nimbalyst-closed") {
        settled = null;
        due.clear();
      }
      if (why !== lastError && why !== "nimbalyst-closed")
        log("error", `alerts: ${why}`);
      lastError = why;
    }
  }

  return {
    tick,
    start() {
      if (timer) return;
      safeTick();
      timer = setInterval(safeTick, everyMs);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

const KIND_INPUT = {
  type: "string",
  max: 40,
  pattern: new RegExp(`^(${Object.keys(KINDS).join("|")})$`),
};

export function register(registry) {
  registry.add({
    name: "alerts.get",
    run: () =>
      Object.keys(KINDS).map((kind) => ({ kind, mode: alertMode(kind) })),
  });

  registry.add({
    name: "alerts.set",
    input: {
      kind: KIND_INPUT,
      mode: { type: "string", max: 6, pattern: /^(buzz|silent|off)$/ },
    },
    run: (d) => {
      updateState((s) => {
        s.alerts = { ...(s.alerts || {}), [d.kind]: d.mode };
      });
      return { kind: d.kind, mode: d.mode };
    },
  });

  registry.add({
    name: "alerts.resolve",
    input: {
      handle: { type: "string", min: 1, max: 16, pattern: /^[A-Za-z0-9_-]+$/ },
    },
    run: (d) => {
      // Own keys only: a name like "constructor" is not a handle.
      const handles = readState().handles || {};
      const h = Object.hasOwn(handles, d.handle) ? handles[d.handle] : null;
      if (!h || Date.now() - Date.parse(h.at) >= HANDLE_DAYS * DAY_MS)
        throw new ActionError("expired");
      if (h.script) throw new ActionError("from-a-script");
      return { project: h.project, session: h.session };
    },
  });
}
