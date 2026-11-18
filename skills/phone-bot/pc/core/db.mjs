// Nimbalyst's database, read only (node:sqlite, readOnly: true, probe 3). Opened on first use through the file
// rules; any write through this handle fails. Times in the database are ISO strings, so they compare as text.
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { listProjects, mapState } from "./door.mjs";
import { checkPath, nimbalystDir } from "./files.mjs";
import { ActionError } from "./registry.mjs";
import { readState } from "./state.mjs";

const dbPath = () => path.join(nimbalystDir(), "sqlite-db", "nimbalyst.sqlite");

let db = null;

export function openDb() {
  if (db) return db;
  const real = checkPath(dbPath());
  if (!fs.existsSync(real))
    throw new Error(`Nimbalyst's database is not at ${dbPath()}`);
  db = new DatabaseSync(real, { readOnly: true });
  return db;
}

export function closeDb() {
  if (db) db.close();
  db = null;
}

const all = (sql, ...args) =>
  openDb()
    .prepare(sql)
    .all(...args);
export const one = (sql, ...args) =>
  openDb()
    .prepare(sql)
    .get(...args);

// Hidden session ids go in as one JSON list.
const NOT_HIDDEN = "s.id NOT IN (SELECT value FROM json_each(?))";

export function sessionRow(sessionId) {
  return one(
    `SELECT s.id, s.workspace_id, s.title, s.status, s.provider_session_id, s.model, s.metadata,
            s.created_at, s.updated_at, w.path AS worktree_path
     FROM ai_sessions s LEFT JOIN worktrees w ON w.id = s.worktree_id WHERE s.id = ?`,
    sessionId,
  );
}

// The session and its project; a session of a project the door does not list is "no-session".
export function knownSession(sessionId) {
  const row = sessionRow(sessionId);
  const project =
    row && listProjects().find((p) => p.path === row.workspace_id);
  if (!project) throw new ActionError("no-session");
  return { row, project };
}

// Every session that needs the user, whatever its age, newest first: one that waits, or one that runs on an open
// form. Archived and hidden ones are left out. Home's Needs you and Projects' "needs you" both count these rows.
export function needsRows(hidden) {
  return all(
    `SELECT s.id, s.workspace_id, s.title, s.status, s.updated_at FROM ai_sessions s
     WHERE s.is_archived = 0 AND ${NOT_HIDDEN} AND (s.status LIKE '%wait%' OR s.status = 'running')
     ORDER BY s.updated_at DESC`,
    JSON.stringify(hidden),
  ).filter((r) => mapState(r.status) === "waiting" || openForm(r.id));
}

// Per project path: { needsYou, working, lastUsed }; needsYou counts needsRows, working the other running ones.
export function projectCounts() {
  const hidden = readState().hidden || [];
  const out = new Map();
  for (const r of all(
    `SELECT workspace_id, SUM(status = 'running') AS working, MAX(updated_at) AS last
     FROM ai_sessions WHERE is_archived = 0 GROUP BY workspace_id`,
  ))
    out.set(r.workspace_id, {
      needsYou: 0,
      working: r.working,
      lastUsed: r.last,
    });
  for (const r of needsRows(hidden)) {
    const c = out.get(r.workspace_id);
    c.needsYou++;
    if (r.status === "running") c.working--;
  }
  return out;
}

// One page of a project's sessions, archived and hidden ones left out: Nimbalyst's pinned sessions first
// (`is_pinned`, read on every call, so a pin set at the PC shows at once), newest first inside each group.
export function sessionsPage(projectPath, hidden, limit, offset) {
  const where = `s.workspace_id = ? AND s.is_archived = 0 AND ${NOT_HIDDEN}`;
  const h = JSON.stringify(hidden);
  return {
    rows: all(
      `SELECT s.id, s.title, s.status, s.updated_at, s.is_pinned FROM ai_sessions s WHERE ${where}
       ORDER BY s.is_pinned DESC, s.updated_at DESC LIMIT ? OFFSET ?`,
      projectPath,
      h,
      limit,
      offset,
    ),
    total: one(
      `SELECT COUNT(*) AS n FROM ai_sessions s WHERE ${where}`,
      projectPath,
      h,
    ).n,
  };
}

// Sessions of every project updated since `since` (ISO), newest first.
export function sessionsUpdatedSince(since, hidden) {
  return all(
    `SELECT s.id, s.workspace_id, s.title, s.status, s.metadata, s.updated_at FROM ai_sessions s
     WHERE s.updated_at >= ? AND s.is_archived = 0 AND ${NOT_HIDDEN} ORDER BY s.updated_at DESC`,
    since,
    JSON.stringify(hidden),
  );
}

export function sessionsCreatedSince(projectPath, since) {
  return all(
    "SELECT id FROM ai_sessions WHERE workspace_id = ? AND created_at >= ? ORDER BY created_at",
    projectPath,
    since,
  );
}

export const projectHasSessions = (projectPath) =>
  !!one(
    "SELECT 1 AS x FROM ai_sessions WHERE workspace_id = ? LIMIT 1",
    projectPath,
  );

const FORM_TOOL = /(^|__)(PromptForUserInput|RequestUserInput)$/;

function toolParts(content, type) {
  let c;
  try {
    c = JSON.parse(content);
  } catch {
    return [];
  }
  const parts = c?.message?.content;
  return Array.isArray(parts) ? parts.filter((p) => p?.type === type) : [];
}

// The newest form tool call of the session with no result yet: { promptId, body } or null.
export function openForm(sessionId) {
  const calls = all(
    `SELECT id, content FROM ai_agent_messages
     WHERE session_id = ? AND message_kind = 'tool' AND content LIKE '%UserInput%' ORDER BY id DESC`,
    sessionId,
  );
  for (const row of calls) {
    const use = toolParts(row.content, "tool_use")
      .filter((p) => FORM_TOOL.test(String(p.name)))
      .pop();
    if (!use) continue;
    const answered = all(
      `SELECT content FROM ai_agent_messages
       WHERE session_id = ? AND id > ? AND content LIKE '%tool_result%'`,
      sessionId,
      row.id,
    ).some((r) =>
      toolParts(r.content, "tool_result").some((p) => p.tool_use_id === use.id),
    );
    if (answered) return null;
    const i = use.input || {};
    return {
      promptId: use.id,
      body: {
        title: i.title ?? null,
        intro: i.intro ?? null,
        fields: Array.isArray(i.fields) ? i.fields : [],
        submitLabel: i.submitLabel ?? null,
      },
    };
  }
  return null;
}
