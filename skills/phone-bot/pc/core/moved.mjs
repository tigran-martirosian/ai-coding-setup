// A session that handed its work on (the handoff skill runs `steer.mjs moved`): steer.mjs's UserPromptSubmit hook
// stops a typed message there and forwards it to the session that continues the work, so the message never reaches
// the old session's transcript. The phone names that session, so the sent message is not left waiting in the old
// chat. The rules here are steer.mjs's own (skills/steer/steer.mjs, "A message the user types in the old session").
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { one } from "./db.mjs";

const DAY = 24 * 3600e3;
const HOPS = 10;

const movedFile = () =>
  path.join(os.homedir(), ".claude", "steer", "moved.json");

// No file, or one steer.mjs cannot read either (it writes it in place), means steer forwards nothing: the message
// stays in its own session, so the answer names no other.
function readMoved() {
  let raw;
  try {
    raw = fs.readFileSync(movedFile(), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return {};
    throw e;
  }
  try {
    const map = JSON.parse(raw);
    return map && typeof map === "object" ? map : {};
  } catch {
    return {};
  }
}

// steer.mjs's lookup: a row by its id or Claude id, only one that has run (a Claude id).
const rowOf = (id) =>
  one(
    `SELECT id, title, provider_session_id AS sid FROM ai_sessions
     WHERE (id LIKE ? OR provider_session_id LIKE ?) AND provider_session_id IS NOT NULL ORDER BY updated_at DESC`,
    `${id}%`,
    `${id}%`,
  );

// The session a message typed into `row` goes on to, as { session, title }, or null when it stays in `row`.
export function movedOn(row, text) {
  const t = String(text).trim();
  if (
    process.env.STEER_FORWARD === "off" ||
    !row.provider_session_id ||
    !t ||
    t.startsWith("/") ||
    t.startsWith("<") ||
    /^\[(system|report)\b/i.test(t)
  )
    return null;
  const map = readMoved();
  const first = map[row.provider_session_id];
  if (!first || !(Date.now() - first.ts <= DAY)) return null;
  let hop = first;
  let to = null;
  for (let n = 0; hop && n < HOPS; n++) {
    to = rowOf(hop.to);
    hop = to?.sid ? map[to.sid] : null;
  }
  return to ? { session: to.id, title: to.title ?? null } : null;
}
