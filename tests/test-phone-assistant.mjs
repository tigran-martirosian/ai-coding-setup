#!/usr/bin/env node
// Tests assistant.mjs with a fake claude (INBOX_CLAUDE_CMD) and a stub nimbalyst module.   node test-assistant.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${detail}`}`);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'assistant-test-'));
const record = path.join(tmp, 'record.json');
// The assistant folder lives under the home folder: keep the test out of the real one.
process.env.USERPROFILE = tmp;
process.env.HOME = tmp;
process.env.FAKE_RECORD = record;
process.env.INBOX_CLAUDE_CMD = JSON.stringify([process.execPath, path.join(HERE, 'phone-bot', 'fake-claude.mjs')]);
process.env.INBOX_NIMBALYST_MODULE = path.join(HERE, 'phone-bot', 'fake-nimbalyst.mjs');
const { ask, gatherContext } = await import('../skills/phone-bot/bot/assistant.mjs');

const rec = () => JSON.parse(fs.readFileSync(record, 'utf8'));
async function rejects(fn) { try { await fn(); return null; } catch (e) { return e; } }

process.env.FAKE_MODE = 'ok';
const r = await ask({ text: 'secret user words', context: 'CTX BLOCK' });
const { args, stdin } = rec();
check('reply, actions, session id and tokens', r.reply === 'ok then' && r.actions.length === 1 && r.actions[0].type === 'none' && r.sessionId === 'conv-123' && r.tokens === 65, JSON.stringify(r));
check('no --dangerously-skip-permissions', !args.includes('--dangerously-skip-permissions'), args.join(' '));
const ti = args.indexOf('--tools');
check('--tools has an empty value', ti >= 0 && args[ti + 1] === '', args.join(' | '));
check('lean flags present', args.includes('--strict-mcp-config') && args[args.indexOf('--setting-sources') + 1] === '' && args[args.indexOf('--model') + 1] === 'haiku' && args.includes('--json-schema') && args.includes('--system-prompt'), args.join(' | '));
check('message arrives on stdin, not in the arguments', stdin.includes('secret user words') && stdin.includes('CTX BLOCK') && !args.join(' ').includes('secret user words'), stdin);
check('no --resume without a session id', !args.includes('--resume'), args.join(' '));

await ask({ text: 'again', context: 'c', sessionId: 'conv-123' });
const a2 = rec().args;
check('--resume passed with the session id', a2[a2.indexOf('--resume') + 1] === 'conv-123', a2.join(' '));
check('assistant folder was created', fs.existsSync(path.join(tmp, '.telegram-control', 'assistant')), 'missing');

process.env.FAKE_MODE = 'iserror';
let e = await rejects(() => ask({ text: 'x', context: 'c' }));
check('is_error throws with the CLI text', e && /Not logged in/.test(e.message), String(e));
process.env.FAKE_MODE = 'badjson';
e = await rejects(() => ask({ text: 'x', context: 'c' }));
check('bad JSON throws', e && /unreadable/.test(e.message), String(e));
process.env.FAKE_MODE = 'noreply';
e = await rejects(() => ask({ text: 'x', context: 'c' }));
check('missing reply throws', e && /no reply/.test(e.message), String(e));
process.env.FAKE_MODE = 'exit1';
e = await rejects(() => ask({ text: 'x', context: 'c' }));
check('non-zero exit throws', e && /exited with 1/.test(e.message), String(e));

// gatherContext
delete process.env.STUB_MODE;
const g = await gatherContext(['- 10:00 | note | n1 | hi']);
check('sessions numbered across projects', /S1 \| alpha \| Alpha one \| running/.test(g.text) && /S2 \| alpha \| Alpha two/.test(g.text) && /S3 \| beta \| Beta one \| waiting/.test(g.text), g.text);
check('refs map S-numbers and projects', g.refs.S3.sessionId === 'b1' && g.refs.S3.projectName === 'beta' && g.refs.S3.projectPath === 'C:\\Projects\\beta' && g.refs.projects.alpha === 'C:\\Projects\\alpha' && g.refs.S1.title === 'Alpha one', JSON.stringify(g.refs));
check('inbox lines and time in the block', g.text.includes('- 10:00 | note | n1 | hi') && /^Time: /.test(g.text), g.text);

process.env.STUB_MODE = 'notrunning';
const n = await gatherContext([]);
check('NOT_RUNNING said in words, refs empty', /Nimbalyst is not running on the PC/.test(n.text) && Object.keys(n.refs).length === 0, JSON.stringify(n));
process.env.STUB_MODE = 'boom';
const b = await gatherContext([]);
check('other errors named in one line', /endpoint exploded/.test(b.text), b.text);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
