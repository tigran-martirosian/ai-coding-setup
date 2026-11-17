// The Nimbalyst door: Nimbalyst's local MCP endpoint, as bot/nimbalyst.mjs calls it, plus what the phone app
// adds (interrupt and messageKind on send, the queue, the four patch tools, tools/list, create_session).
// bot/nimbalyst.mjs stays, since the PC program still uses its PHONE_NOTE, project list and endpoint watch; its
// endpoint reading and call are not exported, so they are rebuilt here on the file rules (every read through files.mjs). The token stays in memory and is
// never written, logged or put in an error message.
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { toBase32 } from "../../../../phone/shared/seal.mjs";
import { PHONE_NOTE } from "../../bot/nimbalyst.mjs";
import { checkPath, nimbalystDir, readText } from "./files.mjs";
import { ActionError } from "./registry.mjs";

const TIMEOUT_MS = 30000;
// With answer_form present a form can be answered from the phone, so the note no longer asks for options.
const SHORT_NOTE = "(Sent from the phone.)";

// The prompt as the user typed it: a transcript holds it with one of the notes above after an empty line.
export function withoutNote(text) {
  for (const note of [SHORT_NOTE, PHONE_NOTE])
    if (text.endsWith(`\n\n${note}`)) return text.slice(0, -(note.length + 2));
  return text;
}

const endpointFile = () => path.join(nimbalystDir(), "mcp-endpoint.json");

const closed = (why) => new ActionError("nimbalyst-closed", { why });
const doorError = (message) =>
  new ActionError("door-error", {
    message: String(message).replace(/\s+/g, " ").slice(0, 300),
  });

function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// Nimbalyst writes the endpoint file once and its quit code deletes it, even when an app that keeps running
// wrote it. The last good descriptor is kept in memory only.
let remembered = null;

function readEndpoint() {
  let fileErr = null;
  let raw = null;
  try {
    raw = readText(endpointFile());
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    fileErr = closed("no-file");
  }
  if (raw !== null) {
    let d = null;
    try {
      d = JSON.parse(raw);
    } catch {
      fileErr = new Error("Nimbalyst's endpoint file is not valid JSON");
    }
    if (!fileErr && (!d || !d.port || !d.token))
      fileErr = new Error("Nimbalyst's endpoint file has no port or token");
    if (!fileErr) {
      if (d.pid && pidAlive(d.pid)) {
        remembered = d;
        return d;
      }
      fileErr = closed("process-gone");
    }
  }
  if (remembered) {
    if (pidAlive(remembered.pid)) return remembered;
    remembered = null;
    throw closed("process-gone");
  }
  throw fileErr;
}

let watching = false;

// Catches the endpoint file during the short time it exists. Started once; later calls do nothing.
export function watchDoor() {
  if (watching) return;
  watching = true;
  const file = endpointFile();
  const grab = () => {
    try {
      const d = JSON.parse(fs.readFileSync(checkPath(file), "utf8"));
      if (d?.port && d.token && d.pid && pidAlive(d.pid)) remembered = d;
    } catch {
      /* missing, half written or invalid: the next try may work */
    }
  };
  grab();
  try {
    const base = path.basename(file);
    const watcher = fs.watch(path.dirname(file), (_event, name) => {
      if (!name || name === base) grab();
    });
    watcher.on("error", () => {});
    watcher.unref();
  } catch {
    /* no folder yet: the timer alone carries on */
  }
  setInterval(grab, 3000).unref();
}

// The reply is plain JSON or an SSE body with "data:" lines.
function parseRpc(text) {
  const t = text.trim();
  if (t.startsWith("{")) return JSON.parse(t);
  for (const line of t.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      return JSON.parse(line.slice(5).trim());
    } catch {
      /* next line */
    }
  }
  throw doorError("unreadable reply from the door");
}

// One short MCP conversation: initialize, then one request. Returns the JSON-RPC result. `caller` adds
// &sessionId= (the calling session some tools need).
async function rpc(projectPath, method, params, what, caller) {
  const d = readEndpoint();
  const q = new URLSearchParams({ workspacePath: projectPath });
  if (caller) q.set("sessionId", caller);
  const url = `http://127.0.0.1:${d.port}/mcp/host?${q}`;
  let mcpSession = null;
  const scrub = (s) => String(s).split(d.token).join("***");

  async function post(body) {
    const headers = {
      Authorization: `Bearer ${d.token}`,
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    if (mcpSession) headers["mcp-session-id"] = mcpSession;
    let res;
    try {
      res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (e) {
      if (e.cause && e.cause.code === "ECONNREFUSED") {
        if (remembered === d) remembered = null;
        throw closed("refused");
      }
      throw doorError(`${what}: ${scrub(e.message)}`);
    }
    mcpSession = res.headers.get("mcp-session-id") || mcpSession;
    return { status: res.status, text: await res.text() };
  }

  const init = await post({
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "phone-app-pc", version: "1" },
    },
  });
  if (init.status !== 200)
    throw doorError(
      `${what}: the door refused the connection (HTTP ${init.status}) ${scrub(init.text).slice(0, 200)}`,
    );
  await post({ jsonrpc: "2.0", method: "notifications/initialized" });
  const r = await post({ jsonrpc: "2.0", id: 2, method, params });
  if (r.status !== 200)
    throw doorError(`${what}: HTTP ${r.status} ${scrub(r.text).slice(0, 200)}`);
  const msg = parseRpc(r.text);
  if (msg.error)
    throw doorError(
      `${what}: ${scrub(msg.error.message || JSON.stringify(msg.error))}`,
    );
  return { result: msg.result, scrub };
}

// A tool call; returns the text of its answer.
async function callTool(projectPath, tool, args, caller) {
  const { result, scrub } = await rpc(
    projectPath,
    "tools/call",
    { name: tool, arguments: args },
    tool,
    caller,
  );
  const content = result?.content;
  const text = Array.isArray(content)
    ? content.map((p) => p.text || "").join("\n")
    : "";
  if (result?.isError) throw doorError(`${tool}: ${scrub(text)}`);
  return text;
}

async function callJson(projectPath, tool, args) {
  const text = await callTool(projectPath, tool, args);
  try {
    return JSON.parse(text);
  } catch {
    throw doorError(`${tool}: the answer was not JSON`);
  }
}

// ---- which tools the door has: read once per Nimbalyst start (its pid and port)

let toolsSeen = null; // { key, names }

export async function doorTools() {
  const d = readEndpoint();
  const key = `${d.pid}:${d.port}`;
  if (toolsSeen?.key !== key) {
    const first = (d.workspaces || [])[0];
    if (!first) throw doorError("tools/list: the door lists no project");
    const { result } = await rpc(first.path, "tools/list", {}, "tools/list");
    if (!Array.isArray(result?.tools))
      throw doorError("tools/list: no tool list in the answer");
    toolsSeen = { key, names: new Set(result.tools.map((t) => t.name)) };
  }
  return toolsSeen.names;
}

// For pc.status: which patch tools are present.
export async function patchTools() {
  const n = await doorTools();
  return {
    answerForm: n.has("answer_form"),
    stopSession: n.has("stop_session"),
    removeQueuedPrompt: n.has("remove_queued_prompt"),
    answerPlan: n.has("answer_plan"),
    setSessionPinned: n.has("set_session_pinned"),
  };
}

export async function hasTool(name) {
  return (await doorTools()).has(name);
}

export async function needTool(name) {
  if (!(await hasTool(name)))
    throw new ActionError("needs-door-patch", { tool: name });
}

// ---- projects: the phone sees a handle, never a path

// Input rules for the ids the phone sends (PC program design, section 3).
export const PROJECT_INPUT = {
  type: "string",
  min: 12,
  max: 12,
  pattern: /^[A-Z2-7]{12}$/,
};
export const SESSION_INPUT = {
  type: "string",
  min: 36,
  max: 36,
  pattern: /^[0-9a-f-]{36}$/,
};

// The first 12 characters of base32 SHA-256 of the project's path.
export const projectHandle = (projectPath) =>
  toBase32(createHash("sha256").update(projectPath).digest()).slice(0, 12);

export function listProjects() {
  const d = readEndpoint();
  return (d.workspaces || []).map((w) => ({
    project: projectHandle(w.path),
    name: w.name || path.basename(w.path),
    path: w.path,
  }));
}

export function projectByHandle(handle) {
  const p = listProjects().find((x) => x.project === handle);
  if (!p) throw new ActionError("no-project");
  return p;
}

// ---- sessions

export function mapState(status, waitingForInput) {
  if (waitingForInput === true || /wait/i.test(status || "")) return "waiting";
  if (status === "running") return "running";
  return "idle";
}

export async function sessionState(projectPath, sessionId) {
  const raw = await callJson(projectPath, "get_session_status", { sessionId });
  return mapState(raw.status, raw.waitingForInput);
}

// get_session_result without the long answer: status and pendingPrompt.
export const sessionResult = (projectPath, sessionId) =>
  callJson(projectPath, "get_session_result", {
    sessionId,
    includeFullResponse: false,
  });

export function mapQuestions(questions) {
  return questions.map((q) => ({
    question: q.question,
    header: q.header,
    options: (q.options || []).map((o) => ({
      label: o.label,
      description: o.description,
    })),
    multiSelect: q.multiSelect === true,
  }));
}

const KINDS = {
  ask_user_question_request: "question",
  permission_request: "permission",
  exit_plan_mode_request: "plan",
};

// What the door reports as waiting: { status, prompt } where prompt is null or
// { kind, promptId, promptType, body }. The door keeps pendingPrompt filled after it was answered, so only
// status waiting_for_input counts. A prompt type the phone cannot answer is kind "on-pc".
export async function doorPending(projectPath, sessionId) {
  const r = await sessionResult(projectPath, sessionId);
  if (r.status !== "waiting_for_input" || !r.pendingPrompt)
    return { status: r.status, prompt: null };
  const { promptId, promptType, content: c } = r.pendingPrompt;
  const kind = KINDS[promptType] || "on-pc";
  let body = null;
  if (kind === "question") {
    const qs = Array.isArray(c?.questions) ? c.questions : [];
    if (!qs.length) return { status: r.status, prompt: null };
    body = { questions: mapQuestions(qs) };
  } else if (kind === "permission") {
    body = {
      toolName: c.toolName,
      rawCommand: c.rawCommand,
      isDestructive: c.isDestructive === true,
      warnings: Array.isArray(c.warnings) ? c.warnings : [],
    };
  } else if (kind === "plan") {
    body = { plan: typeof c?.plan === "string" ? c.plan : null };
  }
  return { status: r.status, prompt: { kind, promptId, promptType, body } };
}

export async function respondToPrompt(
  projectPath,
  sessionId,
  promptId,
  promptType,
  response,
) {
  await callTool(projectPath, "respond_to_prompt", {
    sessionId,
    promptId,
    promptType,
    response,
  });
}

// A prompt for a project whose window is closed stays queued and never runs, so the window is opened first.
const openProject = (projectPath) =>
  callTool(projectPath, "workspace_open", { workspacePath: projectPath });

// send_prompt with the phone's note. `messageKind` "status" is held for the next turn and never wakes the
// session; `interrupt` ends the running turn. Returns the door's answer ({ statusBeforeQueue, ... }).
export async function sendPrompt(projectPath, sessionId, text, opts = {}) {
  await openProject(projectPath);
  const note = (await hasTool("answer_form")) ? SHORT_NOTE : PHONE_NOTE;
  const args = { sessionId, prompt: `${text}\n\n${note}` };
  if (opts.messageKind) args.messageKind = opts.messageKind;
  if (opts.interrupt) args.interrupt = true;
  return callJson(projectPath, "send_prompt", args);
}

const isoTime = (v) =>
  typeof v === "number" ? new Date(v).toISOString() : (v ?? null);

// The session's waiting messages, oldest first: [{ queueId, text, createdAt }], text at most 300 characters.
// With `whole` each row also has `whole`: the message's whole text as the user typed it (the note sendPrompt
// added is taken off), which a queued message's Edit puts back in the typing box.
// Only `pending` rows wait: Nimbalyst also lists `executing` ones, already handed to the session.
export async function listQueued(projectPath, sessionId, { whole } = {}) {
  const r = await callJson(projectPath, "list_queued_prompts", {
    sessionId,
    ...(whole ? { includePromptText: true } : {}),
  });
  if (!Array.isArray(r.prompts))
    throw doorError("list_queued_prompts: no prompts list in the answer");
  if (r.prompts.some((p) => typeof p.status !== "string"))
    throw doorError("list_queued_prompts: a row has no status");
  const waiting = r.prompts.filter((p) => p.status === "pending");
  return waiting.map((p) => {
    const text = p.promptPreview ?? p.prompt;
    if (typeof p.id !== "string" || typeof text !== "string")
      throw doorError("list_queued_prompts: a row has no id or text");
    if (whole && typeof p.prompt !== "string")
      throw doorError("list_queued_prompts: a row has no whole text");
    return {
      queueId: p.id,
      text: text.slice(0, 300),
      ...(whole ? { whole: withoutNote(p.prompt) } : {}),
      createdAt: isoTime(p.createdAt),
    };
  });
}

// list_recent_sessions answers with text: `1. "Title" (id) - 5h ago [RUNNING]`.
export async function recentSessionIds(projectPath, limit) {
  const text = await callTool(projectPath, "list_recent_sessions", { limit });
  return [...text.matchAll(/^\d+\.\s+".*"\s+\(([0-9a-f-]{36})\)/gm)].map(
    (m) => m[1],
  );
}

const ID_IN_TEXT =
  /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/;

function sessionIdIn(tool, out) {
  let id = null;
  try {
    const j = JSON.parse(out);
    id = j.sessionId || j.id || null;
  } catch {
    /* text answer */
  }
  id = id || (out.match(ID_IN_TEXT) || [])[0];
  if (!id) throw doorError(`${tool}: no session id in the answer`);
  return id;
}

// spawn_session needs a calling session: `callerId` is an existing session of the project.
export async function spawnSession(projectPath, callerId, text) {
  await openProject(projectPath);
  const note = (await hasTool("answer_form")) ? SHORT_NOTE : PHONE_NOTE;
  const out = await callTool(
    projectPath,
    "spawn_session",
    { prompt: `${text}\n\n${note}`, isolated: true },
    callerId,
  );
  return sessionIdIn("spawn_session", out);
}

// create_session with no calling session. Today's door answers "FOREIGN KEY constraint failed" and still makes
// an empty session (PC program design, section 3); the caller handles that error. Returns the id on success.
export async function createSession(projectPath, text) {
  await openProject(projectPath);
  const note = (await hasTool("answer_form")) ? SHORT_NOTE : PHONE_NOTE;
  const out = await callTool(projectPath, "create_session", {
    prompt: `${text}\n\n${note}`,
  });
  return sessionIdIn("create_session", out);
}

// ---- the tracker (probe 5)

// Every tracker item of the project, closed ones too, with their custom fields and linked sessions. By default
// tracker_list gives open items only and at most 50; `limit: -1` lifts the cap (to 10,000 in Nimbalyst 0.83.0's
// code), so an answer that full is an error rather than a cut list.
const TRACKER_ALL = 10000;
export async function trackerItems(projectPath) {
  const out = await callJson(projectPath, "tracker_list", {
    full: true,
    includeClosed: true,
    limit: -1,
  });
  const items = out?.structured?.items;
  if (!Array.isArray(items))
    throw doorError("tracker_list: no structured.items in the answer");
  if (items.length >= TRACKER_ALL)
    throw doorError(`tracker_list: ${items.length} items, the list may be cut`);
  return items;
}

// ---- the patch tools (docs/2026-11-14-phone-door-patch-design.md); callers check hasTool first

export const stopSession = (projectPath, sessionId) =>
  callTool(projectPath, "stop_session", { sessionId });

export const removeQueued = (projectPath, sessionId, queueId) =>
  callTool(projectPath, "remove_queued_prompt", {
    sessionId,
    promptId: queueId,
  });

export const answerForm = (projectPath, sessionId, promptId, answer) =>
  callTool(projectPath, "answer_form", {
    sessionId,
    promptId,
    ...(answer === "cancelled"
      ? { cancelled: true }
      : { answers: answer, cancelled: false }),
  });

// Nimbalyst saves `is_pinned` and moves the row in its open windows (door patch design, part 5).
export const setSessionPinned = (projectPath, sessionId, pinned) =>
  callTool(projectPath, "set_session_pinned", { sessionId, pinned });

export const answerPlan = (projectPath, sessionId, promptId, answer) =>
  callTool(projectPath, "answer_plan", {
    sessionId,
    promptId,
    approved: answer.approved,
    ...(answer.feedback ? { feedback: answer.feedback } : {}),
  });
