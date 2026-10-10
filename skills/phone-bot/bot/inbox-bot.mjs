#!/usr/bin/env node
// Phone inbox: saves everything sent to the Telegram bot (photos, files, links, text)
// into C:\Users\<user>\phone-inbox and adds one line per item to index.md there.
// Uses no Claude usage. Answers only the owner (the first account that writes to it), in a private chat.
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const HOME_DIR = path.join(os.homedir(), '.telegram-control');
const SECRETS = path.join(HOME_DIR, 'secrets.json');
const STATE = path.join(HOME_DIR, 'inbox-state.json');
// The lock name: a named pipe on Windows, a socket file in the home folder elsewhere (tests use their own name).
const PIPE = process.platform === 'win32'
  ? `\\\\.\\pipe\\${process.env.INBOX_BOT_PIPE || 'phone-inbox-bot'}`
  : path.join(os.homedir(), '.telegram-control', `${process.env.INBOX_BOT_PIPE || 'bot'}.sock`);
const LOG = path.join(HOME_DIR, 'inbox-bot.log');
const INBOX = path.join(os.homedir(), 'phone-inbox');
const INDEX = path.join(INBOX, 'index.md');
const TRASH = path.join(INBOX, '.trash');
const TRANSCRIBE_PY = path.join(HERE, 'transcribe.py');
const ALBUM_WAIT_MS = Number(process.env.INBOX_ALBUM_WAIT_MS || 1500);
const WATCH_MS = Number(process.env.INBOX_WATCH_MS || 10000);
const WATCH_GRACE_MS = Number(process.env.INBOX_WATCH_GRACE_MS || 30000);
const WATCH_MAX_MS = 2 * 60 * 60 * 1000;
const NEW_CONVERSATION_AFTER_MS = 6 * 60 * 60 * 1000;
const NEW_CONVERSATION_AFTER_COUNT = 40;
const MESSAGE_MAX = 4000;
const DOCUMENT_ABOVE = 12000;
// The tests point these at stand-ins so no real model or Nimbalyst is touched.
const assistantMod = await import(pathToFileURL(process.env.INBOX_ASSISTANT_MODULE || path.join(HERE, 'assistant.mjs')).href);
const nim = await import(pathToFileURL(process.env.INBOX_NIMBALYST_MODULE || path.join(HERE, 'nimbalyst.mjs')).href);

// Message fields that carry a file, with the extension used when Telegram gives none.
const FILE_KINDS = [
  ['document', ''], ['video', '.mp4'], ['animation', '.mp4'], ['voice', '.ogg'],
  ['audio', '.mp3'], ['video_note', '.mp4'], ['sticker', '.webp'],
];

const HELP = [
  'Send photos, files, videos, voice notes, links or text and they are saved on your PC.',
  'Voice notes are also turned into text.',
  '',
  '/last [n] - the last n saved items (5 if no number, at most 20)',
  '/undo - move the newest saved item to the trash',
  'Plain text goes to the assistant when chat is on. It can answer, save a note, show a session\'s last answer, or',
  'propose a prompt for a session (nothing is sent until you tap Send).',
  '',
  '/chat on | off - on: texts go to the assistant; off: the assistant is not used and every text is saved as a note',
  '/new - start a new conversation with the assistant',
  '/help - this text',
].join('\n');

function log(text) {
  const line = `${new Date().toISOString()} ${text}`;
  console.log(line);
  fs.appendFileSync(LOG, line + '\n');
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

if (!fs.existsSync(SECRETS)) {
  console.error(`No bot token: ${SECRETS} is missing (it needs {"token": "..."}).`);
  process.exit(1);
}
const secrets = readJson(SECRETS);
if (!secrets.token) {
  console.error(`No bot token: ${SECRETS} has no "token".`);
  process.exit(1);
}

// The bot runs hidden, so whatever ends it has to be in the log.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (err) => {
    log(`stopping: ${(err && err.stack) || err}`);
    process.exit(1);
  });
}

// One instance only: two pollers on one token make Telegram refuse both. The lock is a named pipe,
// which Windows frees the moment the process is gone. (A file holding the process number stayed
// behind when the bot was killed, and after a restart that number can belong to another program.)
// A second start leaves quietly: the watchdog task starts the bot every few minutes.
// Off Windows a socket file left by a crashed bot blocks listen; a refused connection means it is stale.
const lock = net.createServer();
function listenOnce() {
  return new Promise((resolve, reject) => {
    lock.once('error', reject);
    lock.listen(PIPE, () => { lock.removeListener('error', reject); resolve(); });
  });
}
function otherBotRuns() {
  return new Promise((resolve) => {
    const probe = net.connect(PIPE);
    probe.once('connect', () => { probe.destroy(); resolve(true); });
    probe.once('error', () => resolve(false));
  });
}
try {
  await listenOnce();
} catch (err) {
  if (err.code !== 'EADDRINUSE') throw err;
  if (process.platform === 'win32' || await otherBotRuns()) process.exit(0);
  fs.rmSync(PIPE, { force: true });
  try {
    await listenOnce();
  } catch (err2) {
    if (err2.code === 'EADDRINUSE') process.exit(0);
    throw err2;
  }
}
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(0));
log(`starting (process ${process.pid})`);

fs.mkdirSync(INBOX, { recursive: true });
const state = fs.existsSync(STATE) ? readJson(STATE) : { offset: 0 };

function saveState() {
  fs.writeFileSync(STATE, JSON.stringify(state) + '\n');
}

async function call(method, init) {
  const res = await fetch(`https://api.telegram.org/bot${secrets.token}/${method}`, {
    method: 'POST',
    signal: AbortSignal.timeout(70000),
    ...init,
  });
  const body = await res.json();
  if (!body.ok) {
    const err = new Error(`${method}: ${body.description}`);
    err.code = body.error_code;
    throw err;
  }
  return body.result;
}

function api(method, params) {
  return call(method, { headers: { 'content-type': 'application/json' }, body: JSON.stringify(params) });
}

function reply(msg, text, extra = {}) {
  return api('sendMessage', { chat_id: msg.chat.id, text, reply_parameters: { message_id: msg.message_id }, ...extra });
}

const keyboard = (id, yes, no) => ({ inline_keyboard: [[{ text: yes, callback_data: `go:${id}` }, { text: no, callback_data: `no:${id}` }]] });

function stamp(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const p = (n) => String(n).padStart(2, '0');
  return {
    file: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
    shown: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

// A name that is not taken yet (an album arrives as several messages in one second).
function freeName(base, ext, dir = INBOX) {
  let name = base + ext;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++) name = `${base}_${n}${ext}`;
  return name;
}

function safe(name) {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(-80);
}

// Links hidden behind words ("read this") are not in the text itself.
function hiddenLinks(entities) {
  return (entities || []).filter((e) => e.type === 'text_link').map((e) => e.url);
}

async function download(fileId, base, fallbackExt) {
  const info = await api('getFile', { file_id: fileId });
  const ext = path.extname(base) ? '' : (path.extname(info.file_path) || fallbackExt);
  const name = freeName(path.extname(base) ? base.slice(0, -path.extname(base).length) : base,
    path.extname(base) || ext);
  const res = await fetch(`https://api.telegram.org/file/bot${secrets.token}/${info.file_path}`,
    { signal: AbortSignal.timeout(300000) });
  if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
  fs.writeFileSync(path.join(INBOX, name), Buffer.from(await res.arrayBuffer()));
  return name;
}

function addToIndex(time, kind, name, note) {
  const text = note ? ` | ${note.replace(/\s+/g, ' ')}` : '';
  fs.appendFileSync(INDEX, `- ${time} | ${kind} | ${name}${text}\n`);
}

function indexLines() {
  return fs.existsSync(INDEX) ? fs.readFileSync(INDEX, 'utf8').split('\n').filter(Boolean) : [];
}

// Saves the file a message carries and returns its kind and file name (nothing is added to the index).
async function saveFile(msg, time) {
  if (msg.photo) return { kind: 'photo', name: await download(msg.photo.at(-1).file_id, `${time.file}_photo`, '.jpg') };
  const found = FILE_KINDS.find(([field]) => msg[field]);
  if (!found) throw new Error('this kind of message is not saved (only photos, files, video, audio and text)');
  const [field, ext] = found;
  const original = msg[field].file_name ? `_${safe(msg[field].file_name)}` : `_${field}`;
  const name = await download(msg[field].file_id, `${time.file}${original}`, ext);
  return { kind: field === 'document' ? 'file' : field, name };
}

// Writes a text note and its index line; returns the file name. The assistant step reuses it.
function saveNote(time, text, links) {
  const name = freeName(`${time.file}_text`, '.md');
  fs.writeFileSync(path.join(INBOX, name), text + (links.length ? '\n\nLinks:\n' + links.join('\n') : '') + '\n');
  addToIndex(time.shown, 'text', name, text.slice(0, 120));
  return name;
}

async function noteAndAnswer(msg, text) {
  const name = saveNote(stamp(msg.date), text, hiddenLinks(msg.entities));
  log(`saved ${name}`);
  await reply(msg, `Saved: ${name}`);
}

// ---- sending session answers ----

// Splits at line breaks into parts of at most `max` characters (a single longer line is cut).
function splitText(text, max) {
  const parts = [];
  let cur = '';
  for (let line of text.split('\n')) {
    while (line.length > max) {
      if (cur) parts.push(cur);
      cur = '';
      parts.push(line.slice(0, max));
      line = line.slice(max);
    }
    const next = cur ? `${cur}\n${line}` : line;
    if (next.length > max) {
      parts.push(cur);
      cur = line;
    } else {
      cur = next;
    }
  }
  if (cur) parts.push(cur);
  return parts;
}

// The one way every session answer goes out: one message, several, or a .md file when very long.
async function sendSessionText(chatId, heading, text) {
  const answer = text && text.trim() ? text : '(the session has no answer text)';
  if (answer.length > DOCUMENT_ABOVE) {
    const form = new FormData();
    form.append('chat_id', String(chatId));
    form.append('caption', heading.slice(0, 1000));
    form.append('document', new Blob([answer], { type: 'text/markdown' }), 'answer.md');
    await call('sendDocument', { body: form });
    return;
  }
  for (const part of splitText(`${heading}\n\n${answer}`, MESSAGE_MAX)) {
    await api('sendMessage', { chat_id: chatId, text: part });
  }
}

// ---- answering a waiting session ----

const asked = new Map(); // id -> the question or permission message a button belongs to (memory only)
const answered = new Set(); // promptIds already answered from the phone
let askedCount = 0;
const BUTTON_MAX = 40;
const FORM_MARKER = 'This session is waiting for your input:';

function askText(entry) {
  const p = entry.pending;
  if (p.promptType === 'permission_request') {
    const warnings = p.warnings.length ? `\n\nWarnings:\n${p.warnings.map((w) => `- ${typeof w === 'string' ? w : JSON.stringify(w)}`).join('\n')}` : '';
    return `${entry.head} wants to run:\n\n${p.toolName}\n${String(p.rawCommand || '').slice(0, 1500)}${warnings}`;
  }
  const q = p.questions[entry.qi];
  const lines = q.options.map((o, i) => `${i + 1}. ${o.label}${o.description ? `: ${o.description}` : ''}`);
  return `${entry.head} asks:\n\n${q.question}\n\n${lines.join('\n')}\n\nOr reply to this message with your own answer.`;
}

function askKeyboard(entry) {
  const p = entry.pending;
  if (p.promptType === 'permission_request') {
    return { inline_keyboard: [[{ text: 'Allow once', callback_data: `p:${entry.id}:allow` }, { text: 'Deny', callback_data: `p:${entry.id}:deny` }]] };
  }
  const q = p.questions[entry.qi];
  const rows = q.options.map((o, i) => [{ text: `${q.multiSelect && entry.ticked.has(i) ? '✓ ' : ''}${o.label.slice(0, BUTTON_MAX)}`, callback_data: `q:${entry.id}:${i}` }]);
  if (q.multiSelect) rows.push([{ text: 'Done', callback_data: `q:${entry.id}:done` }]);
  return { inline_keyboard: rows };
}

// One message for a session that waits: the question with buttons, or the plain text for a form.
// `pending` is what nim.pendingPrompt gave (null = a form); left out, it is asked here.
async function showWaiting(chatId, ref, pending) {
  if (pending === undefined) pending = await nim.pendingPrompt(ref.projectPath, ref.sessionId);
  const head = `${ref.projectName} › ${ref.title}`;
  if (!pending) {
    const summary = await nim.waitingQuestion(ref.projectPath, ref.sessionId);
    const at = summary.indexOf(FORM_MARKER);
    const body = (at >= 0 ? summary.slice(at + FORM_MARKER.length) : summary).trim();
    await api('sendMessage', { chat_id: chatId, text: `${head} is waiting for an answer.\n\n${body}\n\nThis one is a form, so it has to be answered at the PC.` });
    return;
  }
  if (answered.has(pending.promptId)) {
    await api('sendMessage', { chat_id: chatId, text: `${head}: that question was already answered from the phone.` });
    return;
  }
  askedCount += 1;
  const entry = { id: `${ID_PREFIX}w${askedCount.toString(36)}`, chatId, ref, head, pending, qi: 0, answers: {}, ticked: new Set(), open: true, busy: false };
  entry.text = askText(entry);
  const sent = await api('sendMessage', { chat_id: chatId, text: entry.text, reply_markup: askKeyboard(entry) });
  entry.messageId = sent.message_id;
  asked.set(entry.id, entry);
}

// Sends the answer; on success the buttons go, the promptId is remembered and the session is watched again.
async function finish(entry, response, last) {
  const { promptId, promptType } = entry.pending;
  await nim.respondToPrompt(entry.ref.projectPath, entry.ref.sessionId, promptId, promptType, response);
  entry.open = false;
  answered.add(promptId);
  log('answered a waiting session from the phone');
  watch(entry.chatId, entry.ref);
  try {
    await api('editMessageText', { chat_id: entry.chatId, message_id: entry.messageId, text: `${entry.text}\n\n${last}`, reply_markup: { inline_keyboard: [] } });
  } catch (err) {
    log(`could not update the question message: ${err.message}`);
  }
}

// Stores the answer to the question shown now; shows the next question, or sends everything after the last.
async function answerQuestion(entry, value) {
  const p = entry.pending;
  entry.answers[p.questions[entry.qi].question] = value;
  if (entry.qi + 1 < p.questions.length) {
    entry.qi += 1;
    entry.ticked.clear();
    entry.text = askText(entry);
    await api('editMessageText', { chat_id: entry.chatId, message_id: entry.messageId, text: entry.text, reply_markup: askKeyboard(entry) });
    return;
  }
  await finish(entry, { answers: entry.answers }, `Answered: ${Object.values(entry.answers).join('; ')}`);
}

async function reportAnswerError(chatId, err) {
  log(`answer failed: ${err.message}`);
  await api('sendMessage', { chat_id: chatId, text: `Could not answer: ${err.message}` });
}

// A tap on a question option (q) or on Allow once / Deny (p). The owner check is done by the caller.
async function handleAnswerTap(cb, verb, id, arg) {
  const chatId = cb.message.chat.id;
  const entry = asked.get(id);
  if (!entry || !entry.open || (verb === 'p') !== (entry.pending.promptType === 'permission_request')) {
    await api('answerCallbackQuery', { callback_query_id: cb.id });
    await api('editMessageReplyMarkup', { chat_id: chatId, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } });
    return void await api('sendMessage', { chat_id: chatId, text: 'That button is too old. Send the request again.' });
  }
  if (verb === 'q' && arg === 'done' && !entry.ticked.size) {
    return void await api('answerCallbackQuery', { callback_query_id: cb.id, text: 'Tick at least one' });
  }
  await api('answerCallbackQuery', { callback_query_id: cb.id });
  if (entry.busy) return;
  entry.busy = true;
  try {
    if (verb === 'p') {
      if (arg !== 'allow' && arg !== 'deny') return;
      await finish(entry, { decision: arg, scope: 'once' }, arg === 'allow' ? 'Allowed once' : 'Denied');
      return;
    }
    const q = entry.pending.questions[entry.qi];
    if (arg === 'done') {
      await answerQuestion(entry, [...entry.ticked].sort((a, b) => a - b).map((i) => q.options[i].label).join(', '));
      return;
    }
    const option = q.options[Number(arg)];
    if (!option) throw new Error('that option does not exist');
    if (q.multiSelect) {
      const i = Number(arg);
      if (entry.ticked.has(i)) entry.ticked.delete(i); else entry.ticked.add(i);
      await api('editMessageReplyMarkup', { chat_id: chatId, message_id: entry.messageId, reply_markup: askKeyboard(entry) });
    } else {
      await answerQuestion(entry, option.label);
    }
  } catch (err) {
    await reportAnswerError(chatId, err);
  } finally {
    entry.busy = false;
  }
}

// A Telegram reply to an open question message is the user's own answer. Returns true when it was one.
async function typedAnswer(msg) {
  const to = msg.reply_to_message.message_id;
  const entry = [...asked.values()].find((e) => e.open && e.chatId === msg.chat.id && e.messageId === to && e.pending.promptType !== 'permission_request');
  if (!entry) return false;
  if (entry.busy) return true;
  entry.busy = true;
  try {
    await answerQuestion(entry, msg.text);
  } catch (err) {
    await reportAnswerError(msg.chat.id, err);
  } finally {
    entry.busy = false;
  }
  return true;
}

// ---- watching a session after a send ----

// The assistant gets the last answer that went to the phone, so "yes" to an offer in it can be understood.
function rememberAnswer(ref, answer) {
  state.lastSession = { projectPath: ref.projectPath, projectName: ref.projectName, sessionId: ref.sessionId, title: ref.title, answer: String(answer || '').slice(0, 1000) };
  saveState();
}

// Every WATCH_MS: the turn is over when the session is idle after it was seen running (or idle after
// the grace time, for a turn too short to catch). Timers, so the long poll neither delays nor is delayed.
const watchers = new Map(); // sessionId -> stop function: a session has one watcher at a time
function watch(chatId, ref) {
  const head = `${ref.projectName} › ${ref.title}`;
  const began = Date.now();
  let seenRunning = false;
  let told = null; // the promptId (or 'form') of the waiting question already sent
  let busy = false;
  let stopped = false;
  const stop = () => {
    stopped = true;
    clearInterval(timer);
    if (watchers.get(ref.sessionId) === stop) watchers.delete(ref.sessionId);
  };
  if (watchers.has(ref.sessionId)) watchers.get(ref.sessionId)();
  watchers.set(ref.sessionId, stop);
  const timer = setInterval(async () => {
    if (busy) return;
    busy = true;
    try {
      const { state: st, raw } = await nim.sessionStatus(ref.projectPath, ref.sessionId);
      if (stopped) return;
      if (st === 'running' || st === 'waiting') seenRunning = true;
      // Idle past the grace time with nothing done since the send: the prompt never ran. Its old
      // answer must not go out as if it were the new one.
      if (st === 'idle' && !seenRunning && Date.now() - began >= WATCH_GRACE_MS && raw && raw.updatedAt && raw.updatedAt < began) {
        stop();
        await api('sendMessage', { chat_id: chatId, text: `${head}\nIt has not started on this. Check at the PC that Nimbalyst is open and the session is not stuck.` });
        return;
      }
      if (st !== 'waiting') told = null;
      if (st === 'waiting') {
        // A new question is shown once; one answered from the phone is never shown again.
        const pending = await nim.pendingPrompt(ref.projectPath, ref.sessionId);
        const key = pending ? pending.promptId : 'form';
        if (key !== told && !answered.has(key)) {
          told = key;
          await showWaiting(chatId, ref, pending);
        }
      }
      if (st === 'idle' && (seenRunning || Date.now() - began >= WATCH_GRACE_MS)) {
        stop();
        const answer = await nim.lastAnswer(ref.projectPath, ref.sessionId);
        await sendSessionText(chatId, head, answer);
        rememberAnswer(ref, answer);
        log(`session answer sent (${head.length} chars heading)`);
      } else if (Date.now() - began >= WATCH_MAX_MS) {
        stop();
        await api('sendMessage', { chat_id: chatId, text: `${head}\nIt is still running. I stop watching it now.` });
      }
    } catch (err) {
      stop();
      log(`watcher stopped: ${err.message}`);
      try {
        await api('sendMessage', { chat_id: chatId, text: `Could not read the session: ${err.message}` });
      } catch (sendErr) {
        log(`could not report it: ${sendErr.message}`);
      }
    } finally {
      busy = false;
    }
  }, WATCH_MS);
}

// ---- the assistant ----

// What the buttons stand for. Only in memory: after a restart an old button gets "too old".
const proposals = new Map();
let proposalCount = 0;
const ID_PREFIX = process.env.INBOX_PROPOSAL_PREFIX || Math.random().toString(36).slice(2, 5);
function addProposal(proposal) {
  proposalCount += 1;
  const id = `${ID_PREFIX}${proposalCount.toString(36)}`;
  proposals.set(id, proposal);
  return id;
}

function findProject(refs, name) {
  const projects = refs.projects || {};
  const key = Object.keys(projects).find((k) => k.toLowerCase() === String(name || '').trim().toLowerCase());
  return key ? { name: key, path: projects[key] } : null;
}

function findSession(refs, key) {
  return /^S\d+$/.test(String(key)) ? refs[key] || null : null;
}

async function toAssistant(msg, text) {
  try {
    await api('sendChatAction', { chat_id: msg.chat.id, action: 'typing' });
    const now = Date.now();
    const old = state.assistant;
    const fresh = !old || !old.sessionId || old.prompt !== assistantMod.PROMPT_VERSION || now - old.lastAt > NEW_CONVERSATION_AFTER_MS || old.count >= NEW_CONVERSATION_AFTER_COUNT;
    const gathered = await assistantMod.gatherContext(indexLines().slice(-5));
    const refs = gathered.refs;
    let contextText = gathered.text;
    // S0 is the last session answer sent to the phone; only when Nimbalyst could be read (refs.projects).
    const last = state.lastSession;
    if (last && refs.projects) {
      refs.S0 = { projectPath: last.projectPath, projectName: last.projectName, sessionId: last.sessionId, title: last.title };
      contextText += `\n\nLast session answer sent to the phone (S0 | ${last.projectName} | ${last.title}):\n${last.answer}`;
    }
    const quoted = msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption);
    const askText = quoted ? `(The user is replying to this message: "${quoted.slice(0, 1000)}")\n${text}` : text;
    const out = await assistantMod.ask({ text: askText, context: contextText, sessionId: fresh ? undefined : old.sessionId });
    state.assistant = { sessionId: out.sessionId, count: fresh ? 1 : old.count + 1, lastAt: now, prompt: assistantMod.PROMPT_VERSION };
    saveState();
    log(`assistant answered (${out.tokens} tokens)`);
    // `[out.action]` only keeps the old single-action test stand-in working.
    await carryOut(msg, out.reply, out.actions || [out.action || { type: 'none' }], refs);
  } catch (err) {
    log(`assistant step failed: ${err.message}`);
    await reply(msg, `Could not do that: ${err.message}`);
  }
}

// One action: the reply is part of its message. Several: the reply goes out once on its own,
// then every action answers without repeating it, and a "none" among them is skipped.
async function carryOut(msg, answer, actions, refs) {
  const list = actions.length ? actions : [{ type: 'none' }];
  if (list.length === 1) return carryOne(msg, answer, list[0], refs, true);
  await reply(msg, answer);
  for (const action of list) {
    if (action.type !== 'none') await carryOne(msg, answer, action, refs, false);
  }
}

async function carryOne(msg, answer, action, refs, withReply) {
  const chatId = msg.chat.id;
  const say = (s) => (withReply ? `${answer}\n\n${s}` : s);
  const missing = (what) => reply(msg, say(what));
  if (action.type === 'none') return reply(msg, answer);
  if (action.type === 'note') {
    if (!action.text) return missing('I did not get the text to save, so nothing was saved.');
    const name = saveNote(stamp(msg.date), action.text, []);
    log(`saved ${name}`);
    return reply(msg, say(`Saved: ${name}`));
  }
  if (action.type === 'show') {
    const ref = findSession(refs, action.session);
    if (!ref) return missing(`I could not find the session ${action.session}.`);
    if ((await nim.sessionStatus(ref.projectPath, ref.sessionId)).state === 'waiting') return showWaiting(chatId, ref);
    const shown = await nim.lastAnswer(ref.projectPath, ref.sessionId);
    await sendSessionText(chatId, `${ref.projectName} › ${ref.title}`, shown);
    return rememberAnswer(ref, shown);
  }
  if (action.type === 'prompt' || action.type === 'new_session') {
    let proposal;
    if (action.type === 'prompt') {
      const ref = findSession(refs, action.session);
      if (!ref) return missing(`I could not find the session ${action.session}.`);
      // A prompt would queue behind the question and never run: the question is shown instead.
      if ((await nim.sessionStatus(ref.projectPath, ref.sessionId)).state === 'waiting') {
        await api('sendMessage', { chat_id: chatId, text: 'That session is waiting for an answer first.' });
        return showWaiting(chatId, ref);
      }
      proposal = { kind: 'prompt', ref };
    } else {
      const project = findProject(refs, action.project);
      if (!project) return missing(`I could not find the project ${action.project}.`);
      proposal = { kind: 'new_session', ref: { projectPath: project.path, projectName: project.name, title: 'new session' } };
    }
    if (!action.text) return missing('I did not get the text to send, so nothing was prepared.');
    proposal.text = action.text;
    const id = addProposal(proposal);
    const head = `${proposal.ref.projectName} › ${proposal.kind === 'prompt' ? proposal.ref.title : 'new session'}`;
    const body = withReply ? `${head}\n\n${answer}\n\nText to send:\n${action.text}` : `${head}\n\nText to send:\n${action.text}`;
    return reply(msg, body, { reply_markup: keyboard(id, 'Send', 'Cancel') });
  }
  return missing(`I did not understand the action "${action.type}", so nothing was done.`);
}

// ---- button taps ----

async function handleCallback(cb) {
  const m = cb.message;
  // Same first check as for messages: the locked owner, in a private chat. Anything else gets no answer.
  if (!secrets.ownerId || cb.from.id !== secrets.ownerId || !m || !m.chat || m.chat.type !== 'private') {
    log(`ignored a button tap from user ${cb.from.id}`);
    return;
  }
  const [verb, id, arg] = String(cb.data || '').split(':');
  if ((verb === 'q' || verb === 'p') && id) return handleAnswerTap(cb, verb, id, arg);
  await api('answerCallbackQuery', { callback_query_id: cb.id });
  if ((verb !== 'go' && verb !== 'no') || !id) return;
  const chatId = m.chat.id;
  await api('editMessageReplyMarkup', { chat_id: chatId, message_id: m.message_id, reply_markup: { inline_keyboard: [] } });
  const proposal = proposals.get(id);
  proposals.delete(id);
  if (!proposal) return void await api('sendMessage', { chat_id: chatId, text: 'That button is too old. Send the request again.' });
  if (verb === 'no') {
    if (proposal.kind !== 'voice') await api('sendMessage', { chat_id: chatId, text: 'Cancelled.' });
    return;
  }
  try {
    if (proposal.kind === 'voice') return await toAssistant(proposal.msg, proposal.text);
    const { ref, text } = proposal;
    let target = ref;
    if (proposal.kind === 'prompt') {
      await nim.sendPrompt(ref.projectPath, ref.sessionId, text);
    } else {
      const { id: sessionId } = await nim.startSession(ref.projectPath, text);
      target = { ...ref, sessionId };
    }
    log(`sent a prompt to ${proposal.kind === 'prompt' ? 'a session' : 'a new session'}`);
    await api('sendMessage', { chat_id: chatId, text: 'Sent.' });
    watch(chatId, target);
  } catch (err) {
    log(`send failed: ${err.message}`);
    await api('sendMessage', { chat_id: chatId, text: `Could not do that: ${err.message}` });
  }
}

// Decides where a plain text goes. Forwards and bare links never need a model.
async function routeText(msg) {
  const onlyLinks = msg.text.trim().split(/\s+/).every((w) => /^https?:\/\/\S+$/i.test(w));
  if (msg.forward_origin || onlyLinks || state.chat === false) return noteAndAnswer(msg, msg.text);
  return toAssistant(msg, msg.text);
}

// ---- voice notes ----

function txtName(audioName) {
  return audioName.slice(0, audioName.length - path.extname(audioName).length) + '.txt';
}

function runTranscribe(audioPath) {
  const cmd = process.env.INBOX_TRANSCRIBE_CMD
    ? JSON.parse(process.env.INBOX_TRANSCRIBE_CMD)
    : ['uv', 'run', '--no-project', '--with', 'faster-whisper', '--with', 'av<16', 'python', TRANSCRIBE_PY]; // av 19 breaks faster-whisper 1.2.1
  return new Promise((resolve, reject) => {
    execFile(cmd[0], [...cmd.slice(1), audioPath],
      { timeout: 600000, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, windowsHide: true },
      (err, stdout, stderr) => {
        if (err) {
          if (err.code === 'ENOENT') return reject(new Error(`${cmd[0]} is not installed`));
          if (err.killed) return reject(new Error('it took longer than 10 minutes'));
          const last = String(stderr).trim().split('\n').pop().trim();
          return reject(new Error((last || err.message).slice(0, 200)));
        }
        resolve(String(stdout).trim());
      });
  });
}

// Returns { answer, transcript } (transcript is null without text); the audio stays saved whatever happens here.
async function transcribeSaved(time, kind, name) {
  let text;
  try {
    text = await runTranscribe(path.join(INBOX, name));
    if (!text) throw new Error('no speech found in it');
  } catch (err) {
    addToIndex(time.shown, kind, name, '');
    log(`saved ${name}, not turned into text`);
    return { answer: `Saved: ${name}. Not turned into text: ${err.message}`, transcript: null };
  }
  fs.writeFileSync(path.join(INBOX, txtName(name)), text + '\n');
  addToIndex(time.shown, kind, name, text.slice(0, 120));
  log(`saved ${name} with text`);
  return { answer: `Saved: ${name}\n\n${text}`, transcript: text };
}

// ---- albums ----
// Photos of one album arrive as separate messages. Each file is saved at once; the index line and the
// answer come when no new item has arrived for ALBUM_WAIT_MS (a timer, so the long poll cannot delay it).

const albums = new Map();

async function collectAlbum(msg) {
  const time = stamp(msg.date);
  const { kind, name } = await saveFile(msg, time);
  const key = `${msg.chat.id}:${msg.media_group_id}`;
  let album = albums.get(key);
  if (!album) {
    album = { first: msg, time, items: [], caption: '', timer: null };
    albums.set(key, album);
  }
  album.items.push({ kind, name });
  if (!album.caption) album.caption = [msg.caption, ...hiddenLinks(msg.caption_entities)].filter(Boolean).join(' ');
  clearTimeout(album.timer);
  album.timer = setTimeout(() => finishAlbum(key), ALBUM_WAIT_MS);
}

async function finishAlbum(key) {
  const album = albums.get(key);
  albums.delete(key);
  try {
    const n = album.items.length;
    addToIndex(album.time.shown, `album (${n})`, album.items.map((i) => i.name).join(', '), album.caption);
    const photos = album.items.every((i) => i.kind === 'photo');
    log(`saved album of ${n}`);
    await reply(album.first, `Saved ${n} ${photos ? 'photos' : 'items'}`);
  } catch (err) {
    log(`album not reported: ${err.message}`);
  }
}

// ---- commands ----

async function undo(msg) {
  const lines = indexLines();
  if (!lines.length) return reply(msg, 'Nothing to remove.');
  const last = lines.pop();
  const [, kind, names] = last.replace(/^- /, '').split(' | ');
  const files = kind.startsWith('album') ? names.split(', ') : [names];
  if (kind === 'voice' || kind === 'audio') files.push(txtName(names));
  fs.mkdirSync(TRASH, { recursive: true });
  const moved = [];
  const missing = [];
  for (const file of files) {
    const from = path.join(INBOX, file);
    if (!fs.existsSync(from)) {
      if (!file.endsWith('.txt') || kind === 'text') missing.push(file); // a voice note may have no .txt
      continue;
    }
    const ext = path.extname(file);
    fs.renameSync(from, path.join(TRASH, freeName(file.slice(0, file.length - ext.length), ext, TRASH)));
    moved.push(file);
  }
  fs.writeFileSync(INDEX, lines.length ? lines.join('\n') + '\n' : '');
  log(`removed ${moved.length} file(s)`);
  const gone = missing.length ? ` (not found: ${missing.join(', ')})` : '';
  return reply(msg, `Removed: ${names}${gone}`);
}

// Returns true when the message was a command and has been answered.
async function command(msg) {
  if (typeof msg.text !== 'string' || !msg.text.startsWith('/') || msg.forward_origin) return false;
  const [first, ...rest] = msg.text.trim().split(/\s+/);
  const name = first.replace(/@\w+$/, '').toLowerCase();
  const arg = rest[0] ? rest[0].toLowerCase() : '';
  if (name === '/start' || name === '/help') {
    await reply(msg, HELP);
  } else if (name === '/last') {
    const asked = parseInt(arg, 10);
    const n = Number.isFinite(asked) ? Math.min(Math.max(asked, 1), 20) : 5;
    const lines = indexLines().slice(-n);
    await reply(msg, lines.length ? lines.join('\n') : 'Nothing saved yet.');
  } else if (name === '/undo') {
    await undo(msg);
  } else if (name === '/chat') {
    if (arg === 'on' || arg === 'off') {
      state.chat = arg === 'on';
      saveState();
    }
    await reply(msg, `Chat is ${state.chat === false ? 'off' : 'on'}.`);
  } else if (name === '/new') {
    delete state.assistant;
    saveState();
    await reply(msg, 'Started a new conversation.');
  } else {
    return false; // an unknown /word is just text
  }
  return true;
}

async function handle(msg) {
  if (!msg || !msg.from) return;
  // First check, before anything else: the owner, in a private chat.
  const isPrivate = msg.chat && msg.chat.type === 'private';
  if (!secrets.ownerId) {
    if (!isPrivate) {
      log(`ignored a message from user ${msg.from.id} (not a private chat)`);
      return;
    }
    secrets.ownerId = msg.from.id;
    fs.writeFileSync(SECRETS, JSON.stringify(secrets, null, 2) + '\n');
    log(`locked to Telegram user ${msg.from.id}`);
    await api('sendMessage', { chat_id: msg.chat.id, text: 'This bot now answers only you. Send photos, files, links or text and they are saved on your PC.' });
    if (msg.text === '/start') return;
  }
  if (msg.from.id !== secrets.ownerId || !isPrivate) {
    log(`ignored a message from user ${msg.from.id}${isPrivate ? '' : ' (not a private chat)'}`);
    return;
  }
  if (await command(msg)) return;
  if (typeof msg.text === 'string' && msg.reply_to_message && await typedAnswer(msg)) return;
  if (msg.media_group_id) return collectAlbum(msg);
  if (typeof msg.text === 'string') return routeText(msg);

  const time = stamp(msg.date);
  const note = [msg.caption, ...hiddenLinks(msg.caption_entities)].filter(Boolean).join(' ');
  const { kind, name } = await saveFile(msg, time);
  if (kind === 'voice' || kind === 'audio') {
    const { answer, transcript } = await transcribeSaved(time, kind, name);
    if (transcript && state.chat !== false) {
      // A mis-heard word must not run as a prompt, so the person decides.
      const id = addProposal({ kind: 'voice', msg, text: transcript });
      await reply(msg, answer, { reply_markup: keyboard(id, 'Send to Claude', 'Keep as a note') });
    } else {
      await reply(msg, answer);
    }
    return;
  }
  addToIndex(time.shown, kind, name, note);
  log(`saved ${name}`);
  await reply(msg, `Saved: ${name}`);
}

// The first call sits inside the retry too: at log-on the network is often not up yet.
let started = false;
let wait = 2000;
for (;;) {
  let updates;
  try {
    if (!started) {
      const me = await api('getMe', {});
      log(`started as @${me.username}, saving to ${INBOX}`);
      started = true;
    }
    updates = await api('getUpdates', { offset: state.offset, timeout: 50, allowed_updates: ['message', 'callback_query'] });
    wait = 2000;
  } catch (err) {
    // 401: the token is wrong. 409: another program is reading this bot. Neither fixes itself.
    if (err.code === 401 || err.code === 409) {
      log(`stopping: ${err.message}`);
      process.exit(1);
    }
    log(`no connection (${err.message}), trying again in ${wait / 1000}s`);
    await sleep(wait);
    wait = Math.min(wait * 2, 60000);
    continue;
  }
  for (const update of updates) {
    try {
      if (update.callback_query) await handleCallback(update.callback_query);
      else await handle(update.message);
    } catch (err) {
      const tap = Boolean(update.callback_query);
      log(`${tap ? 'button failed' : 'not saved'}: ${err.message}`);
      const origin = update.callback_query ? update.callback_query.message : update.message;
      try {
        if (origin && origin.chat) await api('sendMessage', { chat_id: origin.chat.id, text: `${tap ? 'Could not do that' : 'Not saved'}: ${err.message}` });
      } catch (sendErr) {
        log(`could not report it: ${sendErr.message}`);
      }
    }
    state.offset = update.update_id + 1;
    saveState();
  }
}
