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
export async function pendingPrompt(projectPath, sessionId) {
  const r = jsonResult('get_session_result', await callTool(projectPath, 'get_session_result', { sessionId, includeFullResponse: false }));
  if (r.status !== 'waiting_for_input' || !r.pendingPrompt) return null;
  const { promptId, promptType, content: c } = r.pendingPrompt;
  if (promptType === 'ask_user_question_request') {
    const questions = c && Array.isArray(c.questions) ? c.questions : [];
    if (!questions.length) return null;
    return {
      promptId, promptType,
      questions: questions.map((q) => ({
        question: q.question, header: q.header,
        options: q.options.map((o) => ({ label: o.label, description: o.description })),
        multiSelect: q.multiSelect === true,
      })),
    };
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
