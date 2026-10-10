// Every call to Nimbalyst's local MCP endpoint lives here, nowhere else.
// The endpoint file is read on each call (Nimbalyst restarts change port and token); the token
// stays in memory and is never written, logged or put in an error message.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TIMEOUT_MS = 30000;

function endpointFile() {
  if (process.env.NIMBALYST_ENDPOINT_FILE) return process.env.NIMBALYST_ENDPOINT_FILE;
  if (process.platform === 'win32') return path.join(process.env.APPDATA || '', '@nimbalyst', 'electron', 'mcp-endpoint.json');
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Application Support', '@nimbalyst', 'electron', 'mcp-endpoint.json');
  return path.join(os.homedir(), '.config', '@nimbalyst', 'electron', 'mcp-endpoint.json');
}

function notRunning(why) {
  const e = new Error(`Nimbalyst is not running on the PC (${why})`);
  e.code = 'NOT_RUNNING';
  return e;
}

function pidAlive(pid) {
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

function readEndpoint() {
  let raw;
  try { raw = fs.readFileSync(endpointFile(), 'utf8'); } catch { throw notRunning('no endpoint file'); }
  let d;
  try { d = JSON.parse(raw); } catch { throw new Error('Nimbalyst endpoint file is not valid JSON'); }
  if (!d.port || !d.token) throw new Error('Nimbalyst endpoint file has no port or token');
  if (!d.pid || !pidAlive(d.pid)) throw notRunning('its process is gone');
  return d;
}

// The reply is plain JSON or an SSE body with "data:" lines.
function parseRpc(text) {
  const t = text.trim();
  if (t.startsWith('{')) return JSON.parse(t);
  for (const line of t.split('\n')) {
    if (!line.startsWith('data:')) continue;
    try { return JSON.parse(line.slice(5).trim()); } catch { /* next line */ }
  }
  throw new Error('unreadable reply from the endpoint');
}

// One short MCP conversation: initialize, then the tool call. `caller` adds &sessionId=.
async function callTool(projectPath, tool, args, caller) {
  const d = readEndpoint();
  const q = new URLSearchParams({ workspacePath: projectPath });
  if (caller) q.set('sessionId', caller);
  const url = `http://127.0.0.1:${d.port}/mcp/host?${q}`;
  let mcpSession = null;
  let nextId = 1;
  const scrub = (s) => String(s).split(d.token).join('***');

  async function post(body) {
    const headers = {
      Authorization: `Bearer ${d.token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    };
    if (mcpSession) headers['mcp-session-id'] = mcpSession;
    let res;
    try {
      res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (e) {
      if (e.cause && e.cause.code === 'ECONNREFUSED') throw notRunning('connection refused');
      throw new Error(`${tool}: ${scrub(e.message)}`);
    }
    mcpSession = res.headers.get('mcp-session-id') || mcpSession;
    return { status: res.status, text: await res.text() };
  }

  const init = await post({
    jsonrpc: '2.0', id: nextId++, method: 'initialize',
    params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'telegram-inbox-bot', version: '1' } },
  });
  if (init.status !== 200) throw new Error(`${tool}: endpoint refused the connection (HTTP ${init.status}) ${scrub(init.text).slice(0, 200)}`);
  await post({ jsonrpc: '2.0', method: 'notifications/initialized' });

  const r = await post({ jsonrpc: '2.0', id: nextId++, method: 'tools/call', params: { name: tool, arguments: args } });
  if (r.status !== 200) throw new Error(`${tool}: HTTP ${r.status} ${scrub(r.text).slice(0, 200)}`);
  const msg = parseRpc(r.text);
  if (msg.error) throw new Error(`${tool}: ${scrub(msg.error.message || JSON.stringify(msg.error))}`);
  const content = msg.result && msg.result.content;
  const text = Array.isArray(content) ? content.map((p) => p.text || '').join('\n') : '';
  if (msg.result && msg.result.isError) throw new Error(`${tool}: ${scrub(text).slice(0, 300)}`);
  return text;
}

function jsonResult(tool, text) {
  try { return JSON.parse(text); } catch { throw new Error(`${tool}: the answer was not JSON`); }
}

export function listProjects() {
  const d = readEndpoint();
  return (d.workspaces || []).map((w) => ({ name: w.name || path.basename(w.path), path: w.path }));
}

// list_recent_sessions answers with text: `1. "Title" (id) - 5h ago [RUNNING]`. Status and
// updatedAt come from get_session_status, which is JSON.
async function rawSessions(projectPath, limit) {
  const text = await callTool(projectPath, 'list_recent_sessions', { limit });
  const out = [];
  for (const m of text.matchAll(/^\d+\.\s+"(.*)"\s+\(([0-9a-f-]{36})\)/gm)) out.push({ id: m[2], title: m[1] });
  return out;
}

function mapState(s) {
  if (s.waitingForInput === true || /wait/i.test(s.status || '')) return 'waiting';
  if (s.status === 'running') return 'running';
  return 'idle';
}

export async function listSessions(projectPath, limit = 5) {
  const list = await rawSessions(projectPath, limit);
  return Promise.all(list.map(async (s) => {
    const st = await sessionStatus(projectPath, s.id);
    return { id: s.id, title: s.title, status: st.state, updatedAt: st.raw.updatedAt };
  }));
}

export async function sessionStatus(projectPath, sessionId) {
  const raw = jsonResult('get_session_status', await callTool(projectPath, 'get_session_status', { sessionId }));
  return { state: mapState(raw), raw };
}

export async function lastAnswer(projectPath, sessionId) {
  const r = jsonResult('get_session_result', await callTool(projectPath, 'get_session_result', { sessionId }));
  return r.fullResponse || r.lastResponse || '';
}

export function waitingQuestion(projectPath, sessionId) {
  return callTool(projectPath, 'get_session_summary', { sessionId });
}

// A prompt for a project whose window is closed stays queued and never runs (seen 2026-10-10), so the
// window is opened first. Opening one that is already open only brings it to the front.
async function openProject(projectPath) {
  await callTool(projectPath, 'workspace_open', { workspacePath: projectPath });
}

// Added to every prompt the bot sends, so the session asks in a way the phone can answer.
export const PHONE_NOTE = '(Sent from the phone. If you need to ask something, use AskUserQuestion with plain options rather than a form: only that can be answered from the phone.)';

export async function sendPrompt(projectPath, sessionId, text) {
  await openProject(projectPath);
  await callTool(projectPath, 'send_prompt', { sessionId, prompt: `${text}\n\n${PHONE_NOTE}` });
}

// null unless the session waits on something that can be answered through the endpoint.
// The endpoint keeps pendingPrompt filled after it was answered, so only status waiting_for_input counts.
function mapQuestions(questions) {
  return questions.map((q) => ({
    question: q.question, header: q.header,
    options: (q.options || []).map((o) => ({ label: o.label, description: o.description })),
    multiSelect: q.multiSelect === true,
  }));
}

const HEAD_BYTES = 200 * 1024;
const TAIL_BYTES = 400 * 1024;
const MAX_FILES = 8;
const MAX_AGE_MS = 24 * 3600 * 1000;

function readPart(fd, pos, len) {
  const buf = Buffer.alloc(len);
  const n = fs.readSync(fd, buf, 0, len, pos);
  return buf.subarray(0, n).toString('utf8');
}

// Complete JSON lines of a chunk; a first line (when the chunk starts mid-file) or last line (when it
// ends mid-file) that does not parse is dropped.
function parseLines(chunk) {
  const out = [];
  for (const line of chunk.split('\n')) {
    if (!line.trim()) continue;
    try { out.push(JSON.parse(line)); } catch { /* cut line */ }
  }
  return out;
}

function firstUserText(lines) {
  for (const l of lines) {
    if (l.type !== 'user' || !l.message) continue;
    const c = l.message.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) {
      const t = c.find((p) => p && p.type === 'text' && typeof p.text === 'string');
      if (t) return t.text;
    }
  }
  return null;
}

// Nimbalyst reports only the built-in AskUserQuestion as pending. A question asked through its own
// tool (mcp__nimbalyst__AskUserQuestion) is found in the session's Claude Code transcript: the last
// tool call, unanswered. The session is told apart by its first user text; two matches give null.
export function transcriptQuestion(projectPath, originalPrompt) {
  const want = String(originalPrompt || '').trim();
  if (!want) return null;
  const base = process.env.CLAUDE_PROJECTS_DIR || path.join(os.homedir(), '.claude', 'projects');
  const folder = path.join(base, String(projectPath).replace(/[^A-Za-z0-9]/g, '-'));
  let names;
  try { names = fs.readdirSync(folder, { withFileTypes: true }); } catch { return null; }
  const now = Date.now();
  const files = [];
  for (const e of names) {
    if (!e.isFile() || !e.name.endsWith('.jsonl')) continue;
    const p = path.join(folder, e.name);
    try {
      const st = fs.statSync(p);
      if (now - st.mtimeMs <= MAX_AGE_MS) files.push({ p, mtime: st.mtimeMs, size: st.size });
    } catch { /* gone */ }
  }
  files.sort((a, b) => b.mtime - a.mtime);
  const found = [];
  for (const f of files.slice(0, MAX_FILES)) {
    let head, tail;
    try {
      const fd = fs.openSync(f.p, 'r');
      try {
        head = readPart(fd, 0, Math.min(HEAD_BYTES, f.size));
        const tailStart = Math.max(0, f.size - TAIL_BYTES);
        tail = readPart(fd, tailStart, f.size - tailStart);
        if (f.size > HEAD_BYTES) head = head.slice(0, head.lastIndexOf('\n') + 1);
        if (tailStart > 0) tail = tail.slice(tail.indexOf('\n') + 1);
      } finally { fs.closeSync(fd); }
    } catch { continue; }
    const text = firstUserText(parseLines(head));
    if (!text || !text.includes(want)) continue;
    let last = null;
    const answered = new Set();
    for (const l of parseLines(tail)) {
      const c = l.message && l.message.content;
      if (!Array.isArray(c)) continue;
      for (const part of c) {
        if (!part) continue;
        if (part.type === 'tool_use') last = part;
        else if (part.type === 'tool_result') answered.add(part.tool_use_id);
      }
    }
    if (!last || answered.has(last.id)) continue;
    const name = String(last.name || '');
    if (name !== 'AskUserQuestion' && !name.endsWith('__AskUserQuestion')) continue;
    const qs = last.input && last.input.questions;
    if (!Array.isArray(qs) || !qs.length) continue;
    found.push({ promptId: last.id, promptType: 'ask_user_question_request', questions: mapQuestions(qs) });
  }
  return found.length === 1 ? found[0] : null;
}

export async function pendingPrompt(projectPath, sessionId) {
  const r = jsonResult('get_session_result', await callTool(projectPath, 'get_session_result', { sessionId, includeFullResponse: false }));
  if (r.status !== 'waiting_for_input') return null;
  if (!r.pendingPrompt) return transcriptQuestion(projectPath, r.originalPrompt);
  const { promptId, promptType, content: c } = r.pendingPrompt;
  if (promptType === 'ask_user_question_request') {
    const questions = c && Array.isArray(c.questions) ? c.questions : [];
    if (!questions.length) return null;
    return { promptId, promptType, questions: mapQuestions(questions) };
  }
  if (promptType === 'permission_request') {
    return { promptId, promptType, toolName: c.toolName, rawCommand: c.rawCommand, isDestructive: c.isDestructive === true, warnings: Array.isArray(c.warnings) ? c.warnings : [] };
  }
  return null;
}

export async function respondToPrompt(projectPath, sessionId, promptId, promptType, response) {
  await callTool(projectPath, 'respond_to_prompt', { sessionId, promptId, promptType, response });
}

// spawn_session needs a caller session, so the newest existing session of the project is used.
export async function startSession(projectPath, text) {
  await openProject(projectPath);
  const existing = await rawSessions(projectPath, 1);
  if (!existing.length) {
    throw new Error(`${path.basename(projectPath)} has no session yet: a first session has to be started at the PC`);
  }
  const out = await callTool(projectPath, 'spawn_session', { prompt: `${text}\n\n${PHONE_NOTE}`, isolated: true }, existing[0].id);
  let id = null;
  try { id = JSON.parse(out).sessionId || JSON.parse(out).id; } catch { /* text answer */ }
  if (!id) id = (out.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/) || [])[0];
  if (!id) throw new Error('spawn_session: no session id in the answer');
  return { id };
}
