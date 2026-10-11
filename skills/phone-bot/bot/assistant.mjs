// The talking assistant: builds the context block and runs one `claude -p` call per message.
// The model has no tools; it only returns { reply, actions } and the bot decides what happens.
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';

// Tests swap the module for a stub; the real one is the default.
const nim = await import(process.env.INBOX_NIMBALYST_MODULE
  ? pathToFileURL(process.env.INBOX_NIMBALYST_MODULE).href
  : './nimbalyst.mjs');

const MAX_PROJECTS = 20;
const SESSIONS_PER_PROJECT = 3;
const CALL_TIMEOUT_MS = 4000;
const CLAUDE_TIMEOUT_MS = 120000;

export const SYSTEM_PROMPT = `You are a dispatcher between the user's phone (Telegram) and the Claude sessions on their own PC in Nimbalyst. The sessions can do nearly anything: edit files, run commands, search the web, tidy the Nimbalyst board, run slash commands. You cannot do any of that yourself, and you do not need to. Your job is to hand the work over.

So whatever the user asks to have done is, by default, work for a session. Hand it over as a prompt or as a new session. Never refuse and never say "I can't" about work a session could do. Never ask what a task means: the session will know it or will ask. Words starting with a slash (/board-cleanup) are commands the sessions know, so pass them on as they are.

Use "none" only for small talk, for questions you can answer from the context itself (which sessions exist, what state they are in, what was saved), and when it is unclear WHICH project the work belongs to. In that last case ask for the project in the reply and do not guess one from session titles. A message that names no project and does not point at a session (for example "fix the failing test") is that case: ask "Which project?" and use a single action none.

Answer in the language the user writes in. Keep it short enough for a phone screen. Plain text, no markdown.

Every answer has a reply (text for the phone) and a list of one to four actions, done in order. Usually it is one. Use several when the user asks for the same thing in several projects, or for several separate things.
The actions:
- none: just talk, nothing is sent anywhere.
- note: save "text" as a note in the user's inbox. Use it when the user wants to remember something.
- show: send the last answer of one session. Name it in "session" by its S-number from the context (for example S2).
- prompt: send "text" as a new prompt to an existing session. Name it in "session" by its S-number.
- new_session: start a new session in a project with "text" as its first prompt. Name the project in "project" by its name from the context.

Match project names in the user's message loosely to the names in the context: "my cool app" is my-cool-app, "web shop" is web-shop. Only use S-numbers and project names that appear in the context. Never invent one. The S-numbers are for the "session" field only: the user never sees them, so in the reply name a session by its title or its project, never by its number. Even when you list sessions, write "Audit report in web-shop is running", not "S5". A reply with an S followed by a digit is wrong.

When the user asks for something in a project without pointing at one of its sessions, start a new session in that project (new_session). Use prompt only when the user means a particular session. When the user names several projects, make one action for each.

The context may show the last session answer that was sent to the phone. A short message like "yes" or "do it", or an answer to what that session asked or offered, is meant for that session: send it there as a prompt (session S0), with the user's answer made clear enough to stand on its own.

For prompt and new_session, "text" is the user's own request made clear, so it stands on its own. Do not add ideas, steps or details of your own, not even a word like "the application". The user sees Send and Cancel buttons before anything reaches a session, so say in the reply, in one line, what you are about to send, never that it was sent.

A session whose state is "waiting" is waiting for the user's answer to a question. Never send it a prompt: use the action show for it, and the user gets its question with buttons to answer. Say in the reply that the question is coming, not that it has to be answered at the PC.`;

// Short id of the instructions: the bot starts a new conversation when it changes.
export const PROMPT_VERSION = createHash('sha256').update(SYSTEM_PROMPT).digest('hex').slice(0, 8);

const SCHEMA = {
  type: 'object',
  properties: {
    reply: { type: 'string' },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 4,
      items: {
        type: 'object',
        properties: {
          type: { type: 'string', enum: ['none', 'note', 'prompt', 'new_session', 'show'] },
          project: { type: 'string' },
          session: { type: 'string' },
          text: { type: 'string' },
        },
        required: ['type'],
      },
    },
  },
  required: ['reply', 'actions'],
};

function withTimeout(promise, label) {
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(`${label} took longer than 4 seconds`)), CALL_TIMEOUT_MS); });
  return Promise.race([promise, limit]).finally(() => clearTimeout(timer));
}

export async function gatherContext(inboxLines) {
  const refs = { projects: {} };
  const lines = [`Time: ${new Date().toString()}`];
  let note = null;
  try {
    const projects = nim.listProjects().slice(0, MAX_PROJECTS);
    for (const p of projects) refs.projects[p.name] = p.path;
    const results = await Promise.allSettled(projects.map((p) => withTimeout(Promise.resolve(nim.listSessions(p.path, SESSIONS_PER_PROJECT)), p.name)));
    const sessionLines = [];
    let n = 0;
    results.forEach((r, i) => {
      if (r.status === 'rejected') {
        if (r.reason && r.reason.code === 'NOT_RUNNING') throw r.reason;
        sessionLines.push(`(${projects[i].name}: sessions unavailable: ${r.reason.message})`);
        return;
      }
      for (const s of r.value) {
        n += 1;
        refs[`S${n}`] = { projectPath: projects[i].path, projectName: projects[i].name, sessionId: s.id, title: s.title };
        sessionLines.push(`S${n} | ${projects[i].name} | ${s.title} | ${s.status}`);
      }
    });
    lines.push(`Projects open in Nimbalyst: ${projects.map((p) => p.name).join(', ') || '(none)'}`);
    lines.push('Recent sessions (S-number | project | title | state):', ...(sessionLines.length ? sessionLines : ['(none)']));
  } catch (e) {
    for (const k of Object.keys(refs)) delete refs[k];
    refs.projects = {};
    note = e.code === 'NOT_RUNNING' ? 'Nimbalyst is not running on the PC' : `Nimbalyst could not be read: ${e.message}`;
  }
  if (note) lines.push(note);
  lines.push('Latest inbox entries:', ...(inboxLines && inboxLines.length ? inboxLines : ['(none)']));
  return { text: lines.join('\n'), refs: note ? {} : refs };
}

// Windows: spawn without a shell starts only a real program, and the bot's PATH may lack the install folder.
// Looks on the PATH, in the native install's folder, then inside an npm install (found by its claude.cmd).
export function findClaude(env = process.env, home = os.homedir()) {
  const dirs = (env.PATH || env.Path || '').split(path.delimiter).filter(Boolean);
  const exe = [...dirs, path.join(home, '.local', 'bin')].map((d) => path.join(d, 'claude.exe')).find((f) => fs.existsSync(f));
  if (exe) return [exe];
  for (const d of [...dirs, ...(env.APPDATA ? [path.join(env.APPDATA, 'npm')] : [])]) {
    const pkg = path.join(d, 'node_modules', '@anthropic-ai', 'claude-code');
    if (!fs.existsSync(path.join(d, 'claude.cmd')) || !fs.existsSync(path.join(pkg, 'package.json'))) continue;
    const { bin } = JSON.parse(fs.readFileSync(path.join(pkg, 'package.json'), 'utf8'));
    const file = path.join(pkg, typeof bin === 'string' ? bin : bin.claude);
    return /\.[cm]?js$/.test(file) ? [process.execPath, file] : [file];
  }
  return null;
}

function claudeCommand() {
  if (process.env.INBOX_CLAUDE_CMD) {
    const cmd = JSON.parse(process.env.INBOX_CLAUDE_CMD);
    if (!Array.isArray(cmd) || !cmd.length) throw new Error('INBOX_CLAUDE_CMD must be a JSON array');
    return cmd;
  }
  if (process.platform !== 'win32') return ['claude'];
  const found = findClaude();
  if (!found) throw new Error('could not start claude: Claude Code was not found on this PC (looked on the PATH, in .local\\bin of the home folder and in npm\'s folder). Install Claude Code, then send the message again');
  return found;
}

export function ask({ text, context, sessionId }) {
  const cwd = path.join(os.homedir(), '.telegram-control', 'assistant');
  fs.mkdirSync(cwd, { recursive: true });
  const [cmd, ...pre] = claudeCommand();
  const args = [...pre, '-p', '--model', 'haiku', '--system-prompt', SYSTEM_PROMPT,
    '--setting-sources', '', '--strict-mcp-config', '--tools', '',
    '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA)];
  if (sessionId) args.push('--resume', sessionId);

  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('the assistant took longer than 120 seconds')); }, CLAUDE_TIMEOUT_MS);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(e.code === 'ENOENT' ? `could not start claude: "${cmd}" was not found` : `could not start claude: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      let j = null;
      try { j = JSON.parse(out); } catch { /* handled below */ }
      if (j && j.is_error) return reject(new Error(`the assistant failed: ${j.result || 'unknown error'}`));
      if (code !== 0) return reject(new Error(`claude exited with ${code}: ${(j && j.result) || err.trim().slice(0, 300) || 'no message'}`));
      if (!j) return reject(new Error(`claude gave unreadable output: ${out.trim().slice(0, 200)}`));
      const so = j.structured_output;
      if (!so || typeof so.reply !== 'string') return reject(new Error(`the assistant answer has no reply${j.result ? `: ${j.result}` : ''}`));
      const u = j.usage || {};
      const tokens = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.output_tokens || 0);
      resolve({ reply: so.reply, actions: so.actions, sessionId: j.session_id, tokens });
    });
    child.stdin.on('error', () => { /* a dead child is reported by close */ });
    child.stdin.end(`${context}\n\nUser message:\n${text}\n`);
  });
}
