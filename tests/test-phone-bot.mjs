#!/usr/bin/env node
// Tests how inbox-bot.mjs starts and stops. Each case runs the real bot in a made-up home folder
// with fetch replaced (stub-fetch.mjs), so nothing reaches Telegram and the running bot is
// left alone.   node test-inbox-bot.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BOT = path.join(HERE, '..', 'skills', 'phone-bot', 'bot', 'inbox-bot.mjs');
const STUB = pathToFileURL(path.join(HERE, 'phone-bot', 'stub-fetch.mjs')).href;

let passed = 0, failed = 0;
function check(name, ok, detail) {
  if (ok) passed += 1; else failed += 1;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : `\n     ${detail}`}`);
}

function makeHome(name) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ib-'));
  fs.mkdirSync(path.join(home, '.telegram-control'));
  fs.writeFileSync(path.join(home, '.telegram-control', 'secrets.json'), '{"token":"TEST"}');
  return home;
}

// Off Windows the lock is a socket file inside the made-up home, and macOS refuses a socket path over
// 104 characters, so the folder and the name stay short there. A Windows pipe name is global: it is unique.
function envFor(home, name, extra) {
  const pipe = process.platform === 'win32' ? `inbox-bot-test-${process.pid}-${name}` : 't';
  return { ...process.env, USERPROFILE: home, HOME: home, INBOX_BOT_PIPE: pipe, ...extra };
}

function readLog(home) {
  const file = path.join(home, '.telegram-control', 'inbox-bot.log');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function run(home, name, extra) {
  const r = spawnSync(process.execPath, ['--import', STUB, BOT], { env: envFor(home, name, extra), encoding: 'utf8', timeout: 30000 });
  return { status: r.status, log: readLog(home), err: r.stderr };
}

// 1. The network is not up yet at log-on: the first calls fail, the bot must wait and start anyway.
{
  const home = makeHome('nonet');
  const r = run(home, 'nonet', { STUB_FAILS: '2' });
  check('starts when the first calls have no connection', /started as @testbot/.test(r.log),
    `exit ${r.status}, log: ${r.log.trim() || '(empty)'} | ${r.err.trim().split('\n').pop()}`);
  check('says in the log that it is waiting for a connection', /no connection \(fetch failed\)/.test(r.log), `log: ${r.log.trim() || '(empty)'}`);
}

// 2. A lock file left by a killed bot, holding the number of some other living program
//    (after a restart Windows gives old numbers to new programs): the bot must start anyway.
{
  const home = makeHome('stalelock');
  fs.writeFileSync(path.join(home, '.telegram-control', 'inbox-bot.pid'), String(process.pid));
  const r = run(home, 'stalelock', {});
  check('starts when an old lock file names another living program', /started as @testbot/.test(r.log),
    `exit ${r.status}, log: ${r.log.trim() || '(empty)'} | ${r.err.trim().split('\n').pop()}`);
}

// 3. A wrong token ends the bot, and the log says why.
{
  const home = makeHome('badtoken');
  const r = run(home, 'badtoken', { STUB_GETME: '401' });
  check('a wrong token stops it with exit 1', r.status === 1, `exit ${r.status}`);
  check('and the log says why it stopped', /stopping: getMe: Unauthorized/.test(r.log), `log: ${r.log.trim() || '(empty)'}`);
}

// 4. Every start leaves a line before any network call, so a start at log-on can be seen afterwards.
{
  const home = makeHome('startline');
  const r = run(home, 'startline', {});
  check('writes a "starting" line before it reaches Telegram', /starting \(process \d+\)[\s\S]*started as @testbot/.test(r.log), `log: ${r.log.trim() || '(empty)'}`);
}

// 5. A second bot while one runs leaves at once, without a log line (the watchdog tries every few minutes).
{
  const home = makeHome('second');
  const env = envFor(home, 'second', { STUB_HANG: '1' });
  const first = spawn(process.execPath, ['--import', STUB, BOT], { env, stdio: 'ignore' });
  const deadline = Date.now() + 10000;
  while (!/started as @testbot/.test(readLog(home)) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 100));
  const before = readLog(home);
  const second = spawnSync(process.execPath, ['--import', STUB, BOT], { env, encoding: 'utf8', timeout: 15000 });
  check('a second bot leaves with exit 0 while the first runs', second.status === 0 && /started as/.test(before), `exit ${second.status}, first log: ${before.trim() || '(empty)'}`);
  check('the second bot adds nothing to the log', readLog(home) === before, `log grew: ${readLog(home).slice(before.length).trim()}`);
  check('the first bot is still running', first.exitCode === null, `first exited with ${first.exitCode}`);
  first.kill();
}

// ---- messages: the bot gets scripted updates and the answers it sends are read back ----

const OWNER = 111;
const DATE = 1760000000;
let nextId = 1;
const privateMsg = (extra, from = OWNER) => ({ update_id: nextId, message: { message_id: nextId++, date: DATE, from: { id: from }, chat: { id: from, type: 'private' }, ...extra } });

// Runs the bot once over the updates. `seed` may fill the inbox first (it gets the inbox folder).
function talk(name, updates, { env = {}, seed, ownerId = OWNER, again } = {}) {
  const home = again || makeHome(name);
  if (again) for (const f of ['sent.jsonl', 'calls.jsonl', 'asked.jsonl', 'nim.jsonl']) fs.rmSync(path.join(home, f), { force: true });
  const inbox = path.join(home, 'phone-inbox');
  fs.writeFileSync(path.join(home, '.telegram-control', 'secrets.json'), JSON.stringify({ token: 'TEST', ownerId }));
  if (seed) { fs.mkdirSync(inbox, { recursive: true }); seed(inbox); }
  const updatesFile = path.join(home, 'updates.json');
  const sentFile = path.join(home, 'sent.jsonl');
  fs.writeFileSync(updatesFile, JSON.stringify(updates));
  const logs = { calls: 'calls.jsonl', asked: 'asked.jsonl', nim: 'nim.jsonl' };
  const r = run(home, name, {
    STUB_UPDATES: updatesFile, STUB_SENT: sentFile, STUB_END_AFTER_MS: '1200', INBOX_ALBUM_WAIT_MS: '200',
    STUB_CALLS: path.join(home, logs.calls), STUB_ASSISTANT_LOG: path.join(home, logs.asked), STUB_NIM_LOG: path.join(home, logs.nim),
    INBOX_ASSISTANT_MODULE: path.join(HERE, 'phone-bot', 'stub-assistant.mjs'), INBOX_NIMBALYST_MODULE: path.join(HERE, 'phone-bot', 'stub-nimbalyst.mjs'),
    INBOX_PROPOSAL_PREFIX: 'p', INBOX_WATCH_MS: '100', INBOX_WATCH_GRACE_MS: '300', ...env,
  });
  const lines = (file) => (fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
  const raw = lines(sentFile);
  const sent = raw.map((b) => b.text);
  const read = (f) => (fs.existsSync(path.join(inbox, f)) ? fs.readFileSync(path.join(inbox, f), 'utf8') : '');
  const [calls, asked, nim] = Object.values(logs).map((f) => lines(path.join(home, f)));
  return { home, inbox, sent, raw, calls, asked, nim, log: r.log, err: r.err, read, files: fs.existsSync(inbox) ? fs.readdirSync(inbox) : [] };
}

const seedIndex = (lines, extraFiles = []) => (inbox) => {
  fs.writeFileSync(path.join(inbox, 'index.md'), lines.join('\n') + '\n');
  for (const f of extraFiles) fs.writeFileSync(path.join(inbox, f), 'x');
};

// 6. Another user is ignored and nothing is saved.
{
  const t = talk('stranger', [privateMsg({ text: 'hello there' }, 222)]);
  check('a message from another user is ignored', t.sent.length === 0 && t.files.length === 0, `sent: ${JSON.stringify(t.sent)}, files: ${t.files}`);
}

// 7. The owner in a group chat is ignored too.
{
  const m = privateMsg({ text: 'hello group' });
  m.message.chat = { id: -5, type: 'group' };
  const t = talk('group', [m]);
  check('a group-chat message from the owner is ignored', t.sent.length === 0 && t.files.length === 0, `sent: ${JSON.stringify(t.sent)}, files: ${t.files}`);
}

// 8. /last gives the newest lines; an empty index says so.
{
  const lines = [1, 2, 3, 4, 5, 6, 7].map((n) => `- 2026-10-10 10:0${n} | text | n${n}.md | note ${n}`);
  const t = talk('last', [privateMsg({ text: '/last 3' })], { seed: seedIndex(lines) });
  check('/last 3 answers with the last three lines only', t.sent[0] === lines.slice(4).join('\n'), `sent: ${JSON.stringify(t.sent)}`);
  const e = talk('lastempty', [privateMsg({ text: '/last' })]);
  check('/last on an empty inbox says nothing is saved', e.sent[0] === 'Nothing saved yet.', `sent: ${JSON.stringify(e.sent)}`);
}

// 9. /undo moves the newest file to .trash and drops its line.
{
  const lines = ['- 2026-10-10 10:01 | text | first.md | one', '- 2026-10-10 10:02 | text | second.md | two'];
  const t = talk('undo', [privateMsg({ text: '/undo' })], { seed: seedIndex(lines, ['first.md', 'second.md']) });
  const trash = path.join(t.inbox, '.trash');
  check('/undo moves the newest file into .trash', fs.existsSync(path.join(trash, 'second.md')) && !t.files.includes('second.md') && t.files.includes('first.md'), `files: ${t.files}`);
  check('/undo removes the line and answers with the name', t.read('index.md') === lines[0] + '\n' && t.sent[0] === 'Removed: second.md', `index: ${JSON.stringify(t.read('index.md'))}, sent: ${JSON.stringify(t.sent)}`);
  const e = talk('undoempty', [privateMsg({ text: '/undo' })]);
  check('/undo on an empty inbox says so', e.sent[0] === 'Nothing to remove.', `sent: ${JSON.stringify(e.sent)}`);
}

// 10. An album of 3 photos: one index line, one answer.
{
  const photo = (id, extra) => privateMsg({ media_group_id: 'g1', photo: [{ file_id: `${id}.jpg` }], ...extra });
  const t = talk('album', [photo('a1', { caption: 'holiday' }), photo('a2'), photo('a3')]);
  const index = t.read('index.md').split('\n').filter(Boolean);
  check('an album gives one index line with all names and the caption',
    index.length === 1 && /^- \S+ \S+ \| album \(3\) \| [^|]+, [^|]+, [^|]+ \| holiday$/.test(index[0]), `index: ${JSON.stringify(index)}`);
  check('an album gets one answer, "Saved 3 photos"', t.sent.length === 1 && t.sent[0] === 'Saved 3 photos', `sent: ${JSON.stringify(t.sent)}`);
  check('every photo of the album is saved', t.files.filter((f) => f.endsWith('.jpg')).length === 3, `files: ${t.files}`);
}

// 11. Voice notes: a command that prints text gives a .txt and the text in the answer.
const scripts = fs.mkdtempSync(path.join(os.tmpdir(), 'inbox-bot-scripts-'));
fs.writeFileSync(path.join(scripts, 'ok.js'), "console.log('hello from the voice note');\n");
fs.writeFileSync(path.join(scripts, 'bad.js'), "process.stderr.write('boom');process.exit(1);\n");
const cmd = (script) => JSON.stringify([process.execPath, path.join(scripts, script)]);
{
  const t = talk('voice', [privateMsg({ voice: { file_id: 'v1.ogg' } })], { env: { INBOX_TRANSCRIBE_CMD: cmd('ok.js') } });
  const txt = t.files.find((f) => f.endsWith('.txt'));
  check('a voice note gets a .txt next to the audio', t.files.some((f) => f.endsWith('.ogg')) && txt && t.read(txt).trim() === 'hello from the voice note', `files: ${t.files}`);
  check('the answer holds the text and the index note starts with it', /^Saved: \S+\.ogg\n\nhello from the voice note$/.test(t.sent[0]) && /\| voice \| \S+\.ogg \| hello from the voice note\n$/.test(t.read('index.md')), `sent: ${JSON.stringify(t.sent)}, index: ${JSON.stringify(t.read('index.md'))}`);
}

// 12. A failing command: the audio stays, the answer says why, the index line has no note.
{
  const t = talk('voicefail', [privateMsg({ voice: { file_id: 'v2.ogg' } })], { env: { INBOX_TRANSCRIBE_CMD: cmd('bad.js') } });
  check('a failed transcription keeps the audio and says why', t.files.some((f) => f.endsWith('.ogg')) && !t.files.some((f) => f.endsWith('.txt')) && /^Saved: \S+\.ogg\. Not turned into text: boom$/.test(t.sent[0]), `files: ${t.files}, sent: ${JSON.stringify(t.sent)}`);
  check('and the index line has no note', /\| voice \| \S+\.ogg\n$/.test(t.read('index.md')), `index: ${JSON.stringify(t.read('index.md'))}`);
}

// 13. A text that is only links is saved as a note.
{
  const t = talk('links', [privateMsg({ text: 'https://example.com/a https://example.org/b' })]);
  const note = t.files.find((f) => f.endsWith('_text.md'));
  check('a links-only text is saved as a note', note && /^Saved: \S+_text\.md$/.test(t.sent[0]) && t.read(note).startsWith('https://example.com/a'), `files: ${t.files}, sent: ${JSON.stringify(t.sent)}`);
}

// 14. /chat off is stored in the state file.
{
  const t = talk('chatoff', [privateMsg({ text: '/chat off' })]);
  const state = JSON.parse(fs.readFileSync(path.join(t.home, '.telegram-control', 'inbox-state.json'), 'utf8'));
  check('/chat off is stored and answered', state.chat === false && t.sent[0] === 'Chat is off.', `state: ${JSON.stringify(state)}, sent: ${JSON.stringify(t.sent)}`);
}

// ---- the assistant, buttons and the session watcher (stand-in modules, see stub-*.mjs) ----

const tap = (data, { from = OWNER, chatType = 'private' } = {}) => ({
  update_id: nextId++,
  callback_query: { id: `cb${nextId}`, from: { id: from }, data, message: { message_id: 50, chat: { id: from, type: chatType } } },
});
const text = (t) => privateMsg({ text: t });
const act = (action) => text(`act:${JSON.stringify(action)}`);
const WATCH = { STUB_END_AFTER_MS: '2500' };
const J = (v) => JSON.stringify(v);
const buttons = (b) => (b.reply_markup ? b.reply_markup.inline_keyboard[0].map((x) => `${x.text}=${x.callback_data}`) : []);

// 15. Chat on: plain text goes to the assistant and the answer is sent; nothing is logged of the text.
{
  const t = talk('chaton', [text('hello secret-word')]);
  check('chat on: the text goes to the assistant and its reply is sent', t.sent[0] === 'echo: hello secret-word' && t.asked.length === 1 && t.asked[0].text === 'hello secret-word', `sent: ${J(t.sent)}, asked: ${J(t.asked)}`);
  check('it shows "typing" first and gives the assistant the context', t.calls.some((c) => c.method === 'sendChatAction' && c.action === 'typing') && t.asked[0].context === 'stub context', `calls: ${J(t.calls)}`);
  check('the log has the token count and never the text', /assistant answered \(7 tokens\)/.test(t.log) && !/secret-word/.test(t.log), `log: ${t.log}`);
}

// 16. Chat off: saved as a note, the assistant is not asked.
{
  const t = talk('chatoff2', [text('/chat off'), text('plain note')]);
  const note = t.files.find((f) => f.endsWith('_text.md'));
  check('chat off: the text is saved and the assistant is not called', note && t.asked.length === 0 && /^Saved: /.test(t.sent[1]), `files: ${t.files}, sent: ${J(t.sent)}, asked: ${t.asked.length}`);
}

// 17. Action note saves a file and an index line.
{
  const t = talk('actnote', [act({ type: 'note', text: 'buy milk' })]);
  const note = t.files.find((f) => f.endsWith('_text.md'));
  check('action note saves the file, the index line, and answers with the name', note && t.read(note).startsWith('buy milk') && /\| text \| \S+_text\.md \| buy milk\n$/.test(t.read('index.md')) && /^ok\n\nSaved: \S+_text\.md$/.test(t.sent[0]), `files: ${t.files}, sent: ${J(t.sent)}, index: ${J(t.read('index.md'))}`);
}

// 18. Action prompt: buttons, and nothing on Nimbalyst before a tap.
{
  const t = talk('actprompt', [act({ type: 'prompt', session: 'S1', text: 'run the tests' })]);
  check('action prompt shows project, session, reply and the exact text with Send / Cancel', t.sent[0] === 'Alpha › Fix login\n\nok\n\nText to send:\nrun the tests' && J(buttons(t.raw[0])) === J(['Send=go:p1', 'Cancel=no:p1']), `raw: ${J(t.raw)}`);
  check('nothing reaches Nimbalyst before a tap', t.nim.every((c) => c.fn === 'sessionStatus'), `nim: ${J(t.nim)}`);
}

// 19. Tap Send: one sendPrompt, buttons removed, "Sent.", then the watcher sends the last answer.
{
  const t = talk('tapsend', [act({ type: 'prompt', session: 'S1', text: 'run the tests' }), tap('go:p1')], { env: { ...WATCH, STUB_NIM_STATES: J(['running', 'idle']) } });
  const sends = t.nim.filter((c) => c.fn === 'sendPrompt');
  check('a tap on Send calls sendPrompt once with the right session and text', sends.length === 1 && sends[0].sessionId === 'sid-1' && sends[0].text === 'run the tests' && sends[0].projectPath === 'C:\\alpha', `nim: ${J(t.nim)}`);
  check('the tap is answered and the buttons are removed', t.calls.some((c) => c.method === 'answerCallbackQuery') && t.calls.some((c) => c.method === 'editMessageReplyMarkup' && c.reply_markup.inline_keyboard.length === 0), `calls: ${J(t.calls)}`);
  check('then "Sent." and the watcher sends the last answer', t.sent[1] === 'Sent.' && t.sent[2] === 'Alpha › Fix login\n\nThe fix is done.' && t.sent.length === 3, `sent: ${J(t.sent)}`);
}

// 20. Tap Cancel: nothing is sent to Nimbalyst.
{
  const t = talk('tapcancel', [act({ type: 'prompt', session: 'S1', text: 'run the tests' }), tap('no:p1')]);
  check('Cancel calls nothing on Nimbalyst and says Cancelled.', t.nim.every((c) => c.fn === 'sessionStatus') && t.sent[1] === 'Cancelled.', `nim: ${J(t.nim)}, sent: ${J(t.sent)}`);
}

// 21. A tap from another user, or from a group, is ignored without an answer.
{
  const t = talk('tapstranger', [act({ type: 'prompt', session: 'S1', text: 'run the tests' }), tap('go:p1', { from: 222 }), tap('go:p1', { chatType: 'group' })], { env: WATCH });
  check('taps from another user or a group chat do nothing and are not answered', t.nim.every((c) => c.fn === 'sessionStatus') && !t.calls.some((c) => c.method === 'answerCallbackQuery' || c.method === 'editMessageReplyMarkup') && t.sent.length === 1, `nim: ${J(t.nim)}, calls: ${J(t.calls)}, sent: ${J(t.sent)}`);
}

// 22. An old button (the bot restarted): buttons removed, a clear message, nothing sent.
{
  const t = talk('tapold', [tap('go:zzz')]);
  check('an unknown button id gets "too old" and sends nothing', t.sent[0] === 'That button is too old. Send the request again.' && t.nim.every((c) => c.fn === 'sessionStatus') && t.calls.some((c) => c.method === 'editMessageReplyMarkup'), `sent: ${J(t.sent)}, nim: ${J(t.nim)}`);
}

// 23. A session or project that is not known: the reply plus one line, nothing else.
{
  const t = talk('unknown', [act({ type: 'prompt', session: 'S9', text: 'x' }), act({ type: 'new_session', project: 'Nope', text: 'x' }), act({ type: 'prompt', session: 'S1' })]);
  check('an unknown session, unknown project and missing text only explain', t.sent[0] === 'ok\n\nI could not find the session S9.' && t.sent[1] === 'ok\n\nI could not find the project Nope.' && /^ok\n\nI did not get the text/.test(t.sent[2]) && t.raw.every((b) => !b.reply_markup) && t.nim.every((c) => c.fn === 'sessionStatus'), `sent: ${J(t.sent)}, nim: ${J(t.nim)}`);
}

// 24. New session: the project name is matched without regard to case; the tap starts it and the watcher follows it.
{
  const t = talk('newsession', [act({ type: 'new_session', project: 'beta', text: 'write the readme' }), tap('go:p1')], { env: { ...WATCH, STUB_NIM_STATES: J(['running', 'idle']) } });
  const starts = t.nim.filter((c) => c.fn === 'startSession');
  check('new_session proposes Beta › new session, and a tap starts it once', t.sent[0].startsWith('Beta › new session\n\n') && starts.length === 1 && starts[0].projectPath === 'C:\\beta' && starts[0].text === 'write the readme', `sent: ${J(t.sent)}, nim: ${J(t.nim)}`);
  check('the watcher follows the new session', t.nim.some((c) => c.fn === 'sessionStatus' && c.sessionId === 'new-sid') && t.sent.at(-1) === 'Beta › new session\n\nThe fix is done.', `sent: ${J(t.sent)}`);
}

// 25. A waiting session: one "at the PC" message with the question, then the answer after it finishes.
{
  const t = talk('waiting', [act({ type: 'prompt', session: 'S1', text: 'clean up' }), tap('go:p1')], { env: { ...WATCH, STUB_NIM_STATES: J(['running', 'waiting', 'waiting', 'running', 'idle']) } });
  const waits = t.sent.filter((s) => s.includes('has to be answered at the PC.'));
  check('a waiting form gives one "at the PC" message with its question', waits.length === 1 && waits[0] === 'Alpha › Fix login is waiting for an answer.\n\nAllow deleting the build folder?\n\nThis one is a form, so it has to be answered at the PC.', `sent: ${J(t.sent)}`);
  check('and the watcher keeps going until the answer', t.sent.at(-1) === 'Alpha › Fix login\n\nThe fix is done.', `sent: ${J(t.sent)}`);
}

// 26. Long answers: 13,000 characters as a .md file, 9,000 as several messages.
{
  const t = talk('longdoc', [act({ type: 'show', session: 'S1' })], { env: { STUB_NIM_ANSWER_LEN: '13000' } });
  const docs = t.calls.filter((c) => c.method === 'sendDocument');
  check('a 13,000-character answer goes out as one .md document with the heading as caption', docs.length === 1 && docs[0].chars === 13000 && docs[0].caption === 'Alpha › Fix login' && docs[0].name.endsWith('.md') && t.sent.length === 0, `docs: ${J(docs)}, sent: ${t.sent.length}`);
  const s = talk('longparts', [act({ type: 'show', session: 'S2' })], { env: { STUB_NIM_ANSWER_LEN: '9000' } });
  check('a 9,000-character answer goes out as 3 messages of at most 4,000 characters', s.sent.length === 3 && s.sent.every((p) => p.length <= 4000) && s.sent[0].startsWith('Beta › Write docs\n\n') && !s.calls.some((c) => c.method === 'sendDocument'), `lengths: ${J(s.sent.map((p) => p.length))}`);
}

// 27. Errors from the assistant or from Nimbalyst are answered as "Could not do that".
{
  const t = talk('asserr', [text('fail please')]);
  check('an assistant error is answered with "Could not do that: <reason>"', t.sent[0] === 'Could not do that: the model is not reachable', `sent: ${J(t.sent)}`);
  const n = talk('nimerr', [act({ type: 'prompt', session: 'S1', text: 'go' }), tap('go:p1')], { env: { STUB_NIM_FAIL: 'send' } });
  check('a Nimbalyst error on Send is answered with "Could not do that: <reason>"', n.sent.at(-1) === 'Could not do that: Nimbalyst is not running' && !n.sent.includes('Sent.'), `sent: ${J(n.sent)}`);
}

// 28. The conversation id is passed on the second message and dropped after /new.
{
  const t = talk('conv', [text('one'), text('two'), text('/new'), text('three')]);
  check('the second message carries the conversation id, the first and the one after /new do not', t.asked.length === 3 && t.asked[0].sessionId === undefined && t.asked[1].sessionId === 'conv-1' && t.asked[2].sessionId === undefined, `asked: ${J(t.asked.map((a) => a.sessionId))}`);
  const state = JSON.parse(fs.readFileSync(path.join(t.home, '.telegram-control', 'inbox-state.json'), 'utf8'));
  check('the conversation is kept in the state file', state.assistant && state.assistant.sessionId === 'conv-1' && state.assistant.count === 1, `state: ${J(state)}`);
}

// 28b. A conversation saved under other instructions is not resumed.
{
  const t = talk('convprompt', [text('one')]);
  const stateFile = path.join(t.home, '.telegram-control', 'inbox-state.json');
  const st = JSON.parse(fs.readFileSync(stateFile, 'utf8'));
  check('the prompt version is kept in the state file', st.assistant && st.assistant.prompt === 'stub-v1', `state: ${J(st)}`);
  st.assistant.prompt = 'old-one';
  fs.writeFileSync(stateFile, JSON.stringify(st));
  const u = talk('convprompt', [text('two')], { again: t.home });
  check('a saved conversation with another prompt version is not resumed', u.asked.length === 1 && u.asked[0].sessionId === undefined, `asked: ${J(u.asked.map((a) => a.sessionId))}`);
}

// 29. Voice notes with chat on get two buttons; "Send to Claude" reaches the assistant with the transcript.
{
  const t = talk('voicebtn', [privateMsg({ voice: { file_id: 'v3.ogg' } }), tap('go:p1')], { env: { INBOX_TRANSCRIBE_CMD: cmd('ok.js') } });
  check('a voice note with chat on gets "Send to Claude" and "Keep as a note"', J(buttons(t.raw[0])) === J(['Send to Claude=go:p1', 'Keep as a note=no:p1']) && /^Saved: \S+\.ogg\n\nhello from the voice note$/.test(t.sent[0]), `raw: ${J(t.raw)}`);
  check('"Send to Claude" asks the assistant with the transcript', t.asked.length === 1 && t.asked[0].text === 'hello from the voice note' && t.sent[1] === 'echo: hello from the voice note', `asked: ${J(t.asked)}, sent: ${J(t.sent)}`);
  const k = talk('voicekeep', [privateMsg({ voice: { file_id: 'v4.ogg' } }), tap('no:p1')], { env: { INBOX_TRANSCRIBE_CMD: cmd('ok.js') } });
  check('"Keep as a note" only removes the buttons', k.asked.length === 0 && k.sent.length === 1 && k.calls.some((c) => c.method === 'editMessageReplyMarkup'), `sent: ${J(k.sent)}, calls: ${J(k.calls)}`);
  const o = talk('voiceoff', [text('/chat off'), privateMsg({ voice: { file_id: 'v5.ogg' } })], { env: { INBOX_TRANSCRIBE_CMD: cmd('ok.js') } });
  const f = talk('voicefail2', [privateMsg({ voice: { file_id: 'v6.ogg' } })], { env: { INBOX_TRANSCRIBE_CMD: cmd('bad.js') } });
  check('chat off, or no transcript: no buttons', !o.raw[1].reply_markup && !f.raw[0].reply_markup, `off: ${J(o.raw)}, fail: ${J(f.raw)}`);
}

// 30. Several actions: one reply message, then one message with its own buttons per action.
{
  const t = talk('multi', [text(`acts:${J([{ type: 'new_session', project: 'Alpha', text: 'do A' }, { type: 'none' }, { type: 'new_session', project: 'Beta', text: 'do B' }])}`), tap('go:p1'), tap('go:p2')]);
  check('two new_session actions give the reply, then two messages with buttons', t.sent.length >= 3 && t.sent[0] === 'ok' && !t.raw[0].reply_markup
    && t.sent[1] === 'Alpha › new session\n\nText to send:\ndo A' && t.sent[2] === 'Beta › new session\n\nText to send:\ndo B'
    && J(buttons(t.raw[1])) === J(['Send=go:p1', 'Cancel=no:p1']) && J(buttons(t.raw[2])) === J(['Send=go:p2', 'Cancel=no:p2']), `sent: ${J(t.sent)}`);
  const starts = t.nim.filter((c) => c.fn === 'startSession');
  check('a tap on each sends to the right project', starts.length === 2 && starts[0].projectPath === 'C:\\alpha' && starts[0].text === 'do A' && starts[1].projectPath === 'C:\\beta' && starts[1].text === 'do B', `nim: ${J(t.nim)}`);
}

// 31. After a watched session's answer went out, the next message sees it as S0 and can prompt that session.
{
  const first = talk('lastans', [act({ type: 'prompt', session: 'S1', text: 'run the tests' }), tap('go:p1')], { env: { ...WATCH, STUB_NIM_STATES: J(['running', 'idle']) } });
  const state = JSON.parse(fs.readFileSync(path.join(first.home, '.telegram-control', 'inbox-state.json'), 'utf8'));
  check('the watched answer is kept in the state file', state.lastSession && state.lastSession.sessionId === 'sid-1' && state.lastSession.answer === 'The fix is done.', `state: ${J(state)}`);
  const t = talk('lastans', [act({ type: 'prompt', session: 'S0', text: 'yes, do it' }), tap('go:p1')], { again: first.home, env: { ...WATCH, STUB_NIM_STATES: J(['running', 'idle']) } });
  check('the next context holds the last session answer', /Last session answer sent to the phone \(S0 \| Alpha \| Fix login\):\nThe fix is done\./.test(t.asked[0].context), `context: ${J(t.asked[0] && t.asked[0].context)}`);
  const sends = t.nim.filter((c) => c.fn === 'sendPrompt');
  check('a prompt for S0 reaches that session after the tap', sends.length === 1 && sends[0].sessionId === 'sid-1' && sends[0].text === 'yes, do it', `nim: ${J(t.nim)}`);
  const s2 = talk('showkeeps', [act({ type: 'show', session: 'S2' })]);
  const st2 = JSON.parse(fs.readFileSync(path.join(s2.home, '.telegram-control', 'inbox-state.json'), 'utf8'));
  check('the show action keeps the answer too', st2.lastSession && st2.lastSession.sessionId === 'sid-2' && st2.lastSession.title === 'Write docs', `state: ${J(st2)}`);
}

// 32. A Telegram reply carries the quoted text in front of the user's text.
{
  const m = privateMsg({ text: 'yes please', reply_to_message: { message_id: 3, text: 'Say yes to tidy the board.' } });
  const c = privateMsg({ text: 'ok', reply_to_message: { message_id: 4, caption: 'a caption' } });
  const t = talk('quote', [m, c]);
  check('a reply to a message puts its text (or caption) before the user text', t.asked[0].text === '(The user is replying to this message: "Say yes to tidy the board.")\nyes please' && t.asked[1].text === '(The user is replying to this message: "a caption")\nok', `asked: ${J(t.asked.map((a) => a.text))}`);
}

// 33. Answering a waiting session from the phone. The first message the bot sends is id 101 (stub-fetch).
const pend = (p, extra = {}) => ({ STUB_NIM_STATES: J(['waiting']), STUB_NIM_PENDING: J(p), ...extra });
const QUESTION = (extra = {}) => ({ promptId: 'toolu_1', promptType: 'ask_user_question_request', questions: [{ question: 'Which colour?', header: 'Colour', options: [{ label: 'Red', description: 'warm' }, { label: 'Blue', description: '' }], multiSelect: false, ...extra }] });
const PERM = { promptId: 'toolu_p', promptType: 'permission_request', toolName: 'Bash', rawCommand: 'rm -rf build', isDestructive: true, warnings: ['deletes files'] };
const show = act({ type: 'show', session: 'S1' });
const rows = (b) => (b.reply_markup ? b.reply_markup.inline_keyboard.map((r) => r.map((x) => `${x.text}=${x.callback_data}`).join('|')) : []);
const responses = (t) => t.nim.filter((c) => c.fn === 'respondToPrompt');
const edits = (t) => t.calls.filter((c) => c.method === 'editMessageText');
const noButtons = (c) => c.reply_markup && c.reply_markup.inline_keyboard.length === 0;
{
  const t = talk('askq', [show], { env: pend(QUESTION()) });
  check('a waiting question is shown with its options and one button per option', t.sent[0] === 'Alpha › Fix login asks:\n\nWhich colour?\n\n1. Red: warm\n2. Blue\n\nOr reply to this message with your own answer.' && J(rows(t.raw[0])) === J(['Red=q:pw1:0', 'Blue=q:pw1:1']), `raw: ${J(t.raw)}`);
  check('the show action sends no session answer for it', !t.nim.some((c) => c.fn === 'lastAnswer'), `nim: ${J(t.nim)}`);
  const u = talk('askq2', [show, tap('q:pw1:1')], { env: pend(QUESTION()) });
  const r = responses(u);
  check('a tap sends respond_to_prompt with the question text and the label', r.length === 1 && r[0].sessionId === 'sid-1' && r[0].promptId === 'toolu_1' && r[0].promptType === 'ask_user_question_request' && J(r[0].response) === J({ answers: { 'Which colour?': 'Blue' } }), `nim: ${J(u.nim)}`);
  const e = edits(u);
  check('the message loses its buttons and ends with "Answered: Blue"', e.length === 1 && e[0].message_id === 101 && e[0].text.endsWith('\n\nAnswered: Blue') && noButtons(e[0]), `edits: ${J(e)}`);
  check('the session is watched again and the answered question is not shown twice', u.nim.filter((c) => c.fn === 'sessionStatus').length > 2 && u.sent.filter((s) => s.includes('asks:')).length === 1 && u.sent.length === 1, `sent: ${J(u.sent)}`);
}
{
  const two = { promptId: 'toolu_2', promptType: 'ask_user_question_request', questions: [
    { question: 'Colour?', header: 'C', options: [{ label: 'Red' }, { label: 'Blue' }], multiSelect: false },
    { question: 'Size?', header: 'S', options: [{ label: 'S' }, { label: 'L' }], multiSelect: false }] };
  const t = talk('askq3', [show, tap('q:pw1:0'), tap('q:pw1:1')], { env: pend(two) });
  const e = edits(t);
  check('two questions: the same message moves to the second, then the answer is sent once', e.length === 2 && e[0].message_id === 101 && e[0].text.startsWith('Alpha › Fix login asks:\n\nSize?') && J(rows(e[0])) === J(['S=q:pw1:0', 'L=q:pw1:1']) && responses(t).length === 1 && J(responses(t)[0].response) === J({ answers: { 'Colour?': 'Red', 'Size?': 'L' } }) && e[1].text.endsWith('Answered: Red; L') && noButtons(e[1]), `edits: ${J(e)}, nim: ${J(t.nim)}`);
}
{
  const multi = QUESTION({ question: 'Pick?', options: [{ label: 'A' }, { label: 'B' }, { label: 'C' }], multiSelect: true });
  const t = talk('askq4', [show, tap('q:pw1:done'), tap('q:pw1:0'), tap('q:pw1:2'), tap('q:pw1:done')], { env: pend(multi) });
  check('multiSelect: the first keyboard ends with a Done row', J(rows(t.raw[0])) === J(['A=q:pw1:0', 'B=q:pw1:1', 'C=q:pw1:2', 'Done=q:pw1:done']), `raw: ${J(t.raw[0])}`);
  check('Done with nothing ticked says "Tick at least one" and changes nothing', t.calls.some((c) => c.method === 'answerCallbackQuery' && c.text === 'Tick at least one'), `calls: ${J(t.calls)}`);
  const marks = t.calls.filter((c) => c.method === 'editMessageReplyMarkup').map((c) => c.reply_markup.inline_keyboard.map((r) => r[0].text));
  check('a tap toggles an option with a tick', J(marks[0]) === J(['✓ A', 'B', 'C', 'Done']) && J(marks[1]) === J(['✓ A', 'B', '✓ C', 'Done']), `marks: ${J(marks)}`);
  check('Done sends the ticked labels joined by ", "', responses(t).length === 1 && J(responses(t)[0].response) === J({ answers: { 'Pick?': 'A, C' } }), `nim: ${J(t.nim)}`);
}
{
  const t = talk('askreply', [show, privateMsg({ text: 'Purple', reply_to_message: { message_id: 101, text: 'q' } })], { env: pend(QUESTION()) });
  check('a reply to the open question is sent as the answer, not to the assistant or a note', responses(t).length === 1 && J(responses(t)[0].response) === J({ answers: { 'Which colour?': 'Purple' } }) && t.asked.length === 1 && !t.files.some((f) => f.endsWith('_text.md')), `nim: ${J(t.nim)}, asked: ${t.asked.length}, files: ${t.files}`);
  const o = talk('askreply2', [show, privateMsg({ text: 'Purple', reply_to_message: { message_id: 999, text: 'other' } })], { env: pend(QUESTION()) });
  check('a reply to anything else still goes to the assistant', responses(o).length === 0 && o.asked.length === 2, `asked: ${o.asked.length}`);
}
{
  const t = talk('perm', [show, tap('p:pw1:allow')], { env: pend(PERM) });
  check('a permission prompt shows the tool, the command, the warnings and two buttons', t.sent[0] === 'Alpha › Fix login wants to run:\n\nBash\nrm -rf build\n\nWarnings:\n- deletes files' && J(rows(t.raw[0])) === J(['Allow once=p:pw1:allow|Deny=p:pw1:deny']), `raw: ${J(t.raw[0])}`);
  check('Allow once answers allow/once and the message ends with "Allowed once"', responses(t).length === 1 && responses(t)[0].promptType === 'permission_request' && J(responses(t)[0].response) === J({ decision: 'allow', scope: 'once' }) && edits(t)[0].text.endsWith('\n\nAllowed once') && noButtons(edits(t)[0]), `nim: ${J(t.nim)}, edits: ${J(edits(t))}`);
  const d = talk('permdeny', [show, tap('p:pw1:deny')], { env: pend(PERM) });
  check('Deny answers deny/once and the message ends with "Denied"', responses(d).length === 1 && J(responses(d)[0].response) === J({ decision: 'deny', scope: 'once' }) && edits(d)[0].text.endsWith('\n\nDenied'), `nim: ${J(d.nim)}, edits: ${J(edits(d))}`);
}
{
  const t = talk('form', [show], { env: { STUB_NIM_STATES: J(['waiting']) } });
  check('a form is shown without buttons and says it is for the PC', t.sent[0] === 'Alpha › Fix login is waiting for an answer.\n\nAllow deleting the build folder?\n\nThis one is a form, so it has to be answered at the PC.' && !t.raw[0].reply_markup, `raw: ${J(t.raw)}`);
}
{
  const t = talk('promptwait', [act({ type: 'prompt', session: 'S1', text: 'go on' })], { env: pend(QUESTION()) });
  check('a prompt for a waiting session makes no Send proposal; the question is shown instead', t.sent[0] === 'That session is waiting for an answer first.' && t.sent[1].startsWith('Alpha › Fix login asks:') && t.raw.every((b) => !JSON.stringify(b.reply_markup || '').includes('go:')) && !t.nim.some((c) => c.fn === 'sendPrompt'), `sent: ${J(t.sent)}`);
}
{
  const t = talk('respfail', [show, tap('q:pw1:0')], { env: pend(QUESTION(), { STUB_NIM_FAIL: 'respond' }) });
  check('a failing respond_to_prompt keeps the buttons and reports the error', t.sent.at(-1) === 'Could not answer: Nimbalyst is not running' && edits(t).length === 0 && t.calls.some((c) => c.method === 'answerCallbackQuery'), `sent: ${J(t.sent)}, calls: ${J(t.calls)}`);
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
