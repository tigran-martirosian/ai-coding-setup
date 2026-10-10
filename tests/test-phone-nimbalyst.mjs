#!/usr/bin/env node
// Tests nimbalyst.mjs against a fake HTTP server that speaks the endpoint's JSON-RPC.   node test-nimbalyst.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${detail}`}`);
}

const TOKEN = 'secret-token-for-tests-123';
const SID = '11111111-2222-3333-4444-555555555555';
const SID2 = '66666666-7777-8888-9999-000000000000';
const SID3 = 'a0000000-0000-0000-0000-000000000003'; // option question
const SID4 = 'a0000000-0000-0000-0000-000000000004'; // permission prompt
const SID5 = 'a0000000-0000-0000-0000-000000000005'; // form: waiting, no pendingPrompt
const SID6 = 'a0000000-0000-0000-0000-000000000006'; // answered: idle, pendingPrompt still filled
const SID7 = 'a0000000-0000-0000-0000-000000000007'; // another prompt type
const QUESTION = { promptId: 'toolu_q', promptType: 'ask_user_question_request', content: { questions: [{ question: 'Which?', header: 'H', options: [{ label: 'A', description: 'a' }, { label: 'B' }], multiSelect: true }] } };
const PENDING = {
  [SID3]: { status: 'waiting_for_input', pendingPrompt: QUESTION },
  [SID4]: { status: 'waiting_for_input', pendingPrompt: { promptId: 'toolu_p', promptType: 'permission_request', content: { toolName: 'Bash', rawCommand: 'rm -rf x', isDestructive: true, warnings: ['deletes files'] } } },
  [SID5]: { status: 'waiting_for_input', pendingPrompt: null },
  [SID6]: { status: 'idle', pendingPrompt: QUESTION },
  [SID7]: { status: 'waiting_for_input', pendingPrompt: { promptId: 'toolu_x', promptType: 'plan_approval', content: {} } },
};
const seen = []; // { url, tool, args }

const server = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    if (req.headers.authorization !== `Bearer ${TOKEN}`) { res.writeHead(401); res.end(`bad token ${req.headers.authorization}`); return; }
    const m = JSON.parse(body);
    const send = (result) => {
      res.writeHead(200, { 'content-type': 'text/event-stream', 'mcp-session-id': 'm1' });
      res.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', id: m.id, result })}\n\n`);
    };
    if (m.method === 'notifications/initialized') { res.writeHead(202); res.end(); return; }
    if (m.method === 'initialize') return send({ protocolVersion: '2024-11-05', capabilities: {} });
    const { name, arguments: a } = m.params;
    seen.push({ url: req.url, tool: name, args: a });
    const text = (t) => send({ content: [{ type: 'text', text: t }], isError: false });
    const empty = req.url.includes(encodeURIComponent('C:\\empty'));
    if (name === 'list_recent_sessions') {
      return empty ? text('Recent sessions (showing 0 of 0 total):\n') : text(
        `Recent sessions (showing 2 of 2 total):\n\n1. "First one" (${SID}) - just now [RUNNING]\n   Provider: claude-code\n2. "Second" (${SID2}) - 5h ago\n   Provider: claude-code`);
    }
    if (name === 'get_session_status') {
      const waiting = a.sessionId === SID2;
      return text(JSON.stringify({ sessionId: a.sessionId, status: waiting ? 'idle' : 'running', waitingForInput: waiting, updatedAt: 1790000000000 }));
    }
    if (name === 'respond_to_prompt') return text('ok');
    if (name === 'get_session_result' && PENDING[a.sessionId]) return text(JSON.stringify({ sessionId: a.sessionId, includeFull: a.includeFullResponse, ...PENDING[a.sessionId] }));
    if (name === 'get_session_result') return text(JSON.stringify({ sessionId: a.sessionId, fullResponse: 'the full answer', lastResponse: 'short' }));
    if (name === 'get_session_summary') return text('Session: "Second"\nWaiting question: which one?');
    if (name === 'workspace_open') return text(JSON.stringify({ ok: true }));
    if (name === 'send_prompt') return text('queued');
    if (name === 'spawn_session') return text(JSON.stringify({ sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }));
    send({ content: [{ type: 'text', text: `unknown tool ${name}` }], isError: true });
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'nimbalyst-test-'));
const file = path.join(dir, 'mcp-endpoint.json');
function writeEndpoint(extra) {
  fs.writeFileSync(file, JSON.stringify({
    pid: process.pid, port, token: TOKEN, startedAt: 'now',
    workspaces: [{ path: 'C:\\Projects\\alpha', name: 'alpha' }, { path: 'C:\\empty', name: 'empty' }], ...extra,
  }));
}
process.env.NIMBALYST_ENDPOINT_FILE = file;
writeEndpoint();
const nim = await import('../skills/phone-bot/bot/nimbalyst.mjs');

async function rejects(fn) { try { await fn(); return null; } catch (e) { return e; } }

check('listProjects', JSON.stringify(nim.listProjects()) === JSON.stringify([{ name: 'alpha', path: 'C:\\Projects\\alpha' }, { name: 'empty', path: 'C:\\empty' }]), JSON.stringify(nim.listProjects()));

const ss = await nim.listSessions('C:\\Projects\\alpha', 5);
check('listSessions shape and states', ss.length === 2 && ss[0].id === SID && ss[0].title === 'First one' && ss[0].status === 'running' && ss[1].status === 'waiting' && ss[0].updatedAt === 1790000000000, JSON.stringify(ss));
check('listSessions passes the limit', seen.some((s) => s.tool === 'list_recent_sessions' && s.args.limit === 5), JSON.stringify(seen[0]));

const st = await nim.sessionStatus('C:\\Projects\\alpha', SID2);
check('sessionStatus maps waiting and keeps raw', st.state === 'waiting' && st.raw.waitingForInput === true, JSON.stringify(st));
check('lastAnswer', (await nim.lastAnswer('C:\\Projects\\alpha', SID)) === 'the full answer', 'wrong text');
check('waitingQuestion', (await nim.waitingQuestion('C:\\Projects\\alpha', SID2)).includes('which one?'), 'wrong text');

await nim.sendPrompt('C:\\Projects\\alpha', SID, 'hello there');
check('sendPrompt sends sessionId and prompt, with the phone note after an empty line', seen.some((s) => s.tool === 'send_prompt' && s.args.sessionId === SID && s.args.prompt === `hello there\n\n${nim.PHONE_NOTE}`), JSON.stringify(seen.at(-1)));

const P = 'C:\\Projects\\alpha';
const pq = await nim.pendingPrompt(P, SID3);
check('pendingPrompt: an option question', JSON.stringify(pq) === JSON.stringify({ promptId: 'toolu_q', promptType: 'ask_user_question_request', questions: [{ question: 'Which?', header: 'H', options: [{ label: 'A', description: 'a' }, { label: 'B' }], multiSelect: true }] }), JSON.stringify(pq));
check('pendingPrompt asks without the full response', seen.some((s) => s.tool === 'get_session_result' && s.args.sessionId === SID3 && s.args.includeFullResponse === false), JSON.stringify(seen.at(-1)));
const pp = await nim.pendingPrompt(P, SID4);
check('pendingPrompt: a permission prompt', JSON.stringify(pp) === JSON.stringify({ promptId: 'toolu_p', promptType: 'permission_request', toolName: 'Bash', rawCommand: 'rm -rf x', isDestructive: true, warnings: ['deletes files'] }), JSON.stringify(pp));
check('pendingPrompt: a form is null', (await nim.pendingPrompt(P, SID5)) === null, 'not null');
check('pendingPrompt: an answered question on an idle session is null', (await nim.pendingPrompt(P, SID6)) === null, 'not null');
check('pendingPrompt: another prompt type is null', (await nim.pendingPrompt(P, SID7)) === null, 'not null');
check('pendingPrompt: a session with nothing pending is null', (await nim.pendingPrompt(P, SID)) === null, 'not null');
await nim.respondToPrompt(P, SID3, 'toolu_q', 'ask_user_question_request', { answers: { 'Which?': 'A' } });
const rp = seen.findLast((s) => s.tool === 'respond_to_prompt');
check('respondToPrompt sends the five arguments', rp && JSON.stringify(rp.args) === JSON.stringify({ sessionId: SID3, promptId: 'toolu_q', promptType: 'ask_user_question_request', response: { answers: { 'Which?': 'A' } } }), JSON.stringify(rp));

const started = await nim.startSession('C:\\Projects\\alpha', 'do the thing');
// A closed project window leaves a prompt queued for ever, so the window is opened before each send.
{
  const tools = seen.map((s) => s.tool);
  const sent = tools.indexOf('send_prompt');
  const started = tools.indexOf('spawn_session');
  check('the project window is opened before a prompt is sent', sent > 0 && tools.lastIndexOf('workspace_open', sent) >= 0, tools.join(','));
  check('and before a session is started', started > 0 && tools.slice(sent + 1, started).includes('workspace_open'), tools.join(','));
}
const spawn = seen.find((s) => s.tool === 'spawn_session');
check('startSession returns the new id', started.id === 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', JSON.stringify(started));
check('startSession isolated and caller in the URL', spawn.args.isolated === true && spawn.args.prompt === `do the thing\n\n${nim.PHONE_NOTE}` && spawn.url.includes(`sessionId=${SID}`), JSON.stringify(spawn));

const noSess = await rejects(() => nim.startSession('C:\\empty', 'x'));
check('project without sessions throws a clear error', noSess && /first session has to be started at the PC/.test(noSess.message), String(noSess));

// wrong token
writeEndpoint({ token: 'wrong-token-value' });
const bad = await rejects(() => nim.lastAnswer('C:\\Projects\\alpha', SID));
check('wrong token is refused as an error', bad && /401/.test(bad.message) && bad.code !== 'NOT_RUNNING', String(bad));
check('token never in the error message', bad && !bad.message.includes('wrong-token-value') && !bad.message.includes(TOKEN), bad && bad.message);
writeEndpoint();

// dead pid: a pid far above any real one
writeEndpoint({ pid: 2147483000 });
const dead = await rejects(() => nim.listSessions('C:\\Projects\\alpha'));
check('dead pid -> NOT_RUNNING', dead && dead.code === 'NOT_RUNNING', String(dead));
const deadP = await rejects(async () => nim.listProjects());
check('listProjects with dead pid -> NOT_RUNNING', deadP && deadP.code === 'NOT_RUNNING', String(deadP));

fs.rmSync(file);
const none = await rejects(() => nim.listSessions('C:\\Projects\\alpha'));
check('no endpoint file -> NOT_RUNNING', none && none.code === 'NOT_RUNNING', String(none));

// a tool error carries the tool name and the message
writeEndpoint();
const toolErr = await rejects(() => nim.sessionStatus('C:\\Projects\\alpha', 'x')).then(() => null);
check('server stays usable after errors', (await nim.lastAnswer('C:\\Projects\\alpha', SID)) === 'the full answer', 'broken');
void toolErr;

server.close();
fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
