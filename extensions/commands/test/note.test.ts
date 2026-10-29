// node --experimental-strip-types test/note.test.ts
import assert from 'node:assert/strict';
import { findComposers } from '../src/find.ts';
import { sendNote } from '../src/note.ts';
import { pollOutbox, newState as slowState, MAX_TRIES, LOCK_MS } from '../src/bridge.ts';

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);

// ---- finding the Send button: a sample modelled on the composer markup in the app's renderer code
// (no DOM library is installed, so this is a small stand-in tree that understands the selectors used)
class Node {
  parentElement: Node | null = null;
  children: Node[] = [];
  tag: string;
  attrs: Record<string, string>;
  constructor(tag: string, attrs: Record<string, string> = {}) {
    this.tag = tag;
    this.attrs = attrs;
  }
  add(...c: Node[]) {
    for (const x of c) (x.parentElement = this), this.children.push(x);
    return this;
  }
  matches(sel: string): boolean {
    return sel.split(',').some((part) => {
      const m = part.trim().match(/^([a-z]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
      if (!m) throw new Error(`selector not understood by the test: ${part}`);
      const [, tag, classes, attr, value] = m;
      if (tag && tag !== this.tag) return false;
      const have = (this.attrs.class ?? '').split(/\s+/);
      if (classes && !classes.slice(1).split('.').every((c) => have.includes(c))) return false;
      if (attr && (value === undefined ? !(attr in this.attrs) : this.attrs[attr] !== value)) return false;
      return true;
    });
  }
  closest(sel: string): Node | null {
    for (let e: Node | null = this; e; e = e.parentElement) if (e.matches(sel)) return e;
    return null;
  }
  getAttribute(name: string) {
    return this.attrs[name] ?? null;
  }
  all(): Node[] {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll(sel: string) {
    return this.all().filter((e) => e.matches(sel));
  }
  querySelector(sel: string) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
}
const el = (tag: string, attrs: Record<string, string>, ...kids: Node[]) => new Node(tag, attrs).add(...kids);
const composer = (button: Node, session?: string) =>
  el('div', session ? { class: 'agent-session-panel flex flex-col', 'data-session-id': session } : { class: 'no-id' },
    el('div', { class: 'transcript' }),
    el('div', { class: 'flex flex-row' },
      el('div', { class: 'ai-chat-input-textarea-wrap relative flex flex-1 min-w-0' }, el('textarea', { class: 'ai-chat-input-field nim-scrollbar-hidden' })),
      button));
const send = () => el('button', { class: 'ai-chat-send-button w-9 h-9', title: 'Send message (Enter)', 'aria-label': 'Send message' });
const cancel = () => el('button', { class: 'ai-chat-cancel-button w-9 h-9', 'aria-label': 'Cancel request' });

const page = el('body', {}, composer(send(), 'abc-123'), composer(cancel(), 'def_456'), composer(send()), el('div', {}, el('button', { class: 'other' })));
const found = findComposers(page as never);
assert.deepEqual(found.map((c) => c.sessionId), ['abc-123', 'def_456', null]);
assert.ok(found.every((c) => (c.row as never as Node).querySelector('textarea')));
assert.equal(found[0].button, (found[0].row as never as Node).children[1]);
ok('finds the Send (and the Cancel) button of each chat box, with its session id; none without an id');

// ---- sending
const run = async (execCode: number | null, throwOn?: string) => {
  const calls: unknown[][] = [];
  const invoke = async (channel: string, ...args: unknown[]) => {
    calls.push([channel, ...args]);
    if (throwOn === channel) throw new Error(`Error invoking remote method '${channel}': Error: boom`);
    if (channel === 'extension:exec') return execCode === 0 ? { success: true, stdout: 'Sent', stderr: '', exitCode: 0 } : { success: false, stdout: 'NOT SENT: idle', stderr: '', exitCode: execCode };
    return undefined;
  };
  return { calls, outcome: await sendNote('  look at X  ', 'sess-1', 'C:/Users/you', invoke) };
};
let r = await run(0);
assert.deepEqual(r.calls.map((c) => c[0]), ['extensions:write-file', 'extension:exec']);
assert.deepEqual(r.calls[0].slice(1), ['C:/Users/you/.claude/steer/button-note.txt', 'look at X']);
const exec = r.calls[1][1] as { extensionId: string; command: string };
assert.equal(exec.extensionId, 'com.local.commandbuttons');
assert.equal(exec.command, 'node "C:/Users/you/.claude/skills/steer/steer.mjs" send --to sess-1 - < "C:/Users/you/.claude/steer/button-note.txt"');
assert.deepEqual(r.outcome, { ok: true, message: 'Note sent' });
ok('a busy session (exit 0): the file is written, steer.mjs runs, nothing is queued');

r = await run(3);
assert.deepEqual(r.calls.map((c) => c[0]), ['extensions:write-file', 'extension:exec', 'ai:createQueuedPrompt']);
assert.deepEqual(r.calls[2].slice(1), ['sess-1', 'look at X']);
assert.deepEqual(r.outcome, { ok: true, message: 'Queued, it starts now' });
ok('an idle session (exit 3): steer.mjs, then createQueuedPrompt(sessionId, text)');

r = await run(2);
assert.equal(r.outcome.ok, false);
assert.match(r.outcome.message, /Not sent \(code 2\): NOT SENT: idle/);
assert.ok(!r.calls.some((c) => c[0] === 'ai:createQueuedPrompt'));
r = await run(3, 'ai:createQueuedPrompt');
assert.deepEqual(r.outcome, { ok: false, message: 'Not sent: boom' });
r = await run(0, 'extensions:write-file');
assert.equal(r.outcome.ok, false);
assert.equal((await sendNote('   ', 's', 'C:/h', async () => ({}))).ok, false);
assert.equal((await sendNote('x', 'a & del *', 'C:/h', async () => ({}))).ok, false);
ok('errors come back as text: unknown session, failed queue, failed write, empty note, unsafe id');

// ---- wake bridge
const NOW = 1_000_000_000_000;
const world = (files: Record<string, string>, failQueue = 0) => {
  const delivered: unknown[][] = [];
  let fails = failQueue;
  const invoke = async (channel: string, ...args: unknown[]) => {
    if (channel === 'extensions:read-file') {
      const f = files[args[0] as string];
      if (f === undefined) throw new Error(`Error invoking remote method 'extensions:read-file': Error: ENOENT: no such file or directory, open '${args[0]}'`);
      return f;
    }
    if (channel === 'extensions:write-file') return void (files[args[0] as string] = args[1] as string);
    if (channel === 'ai:createQueuedPrompt') {
      if (fails-- > 0) throw new Error('session busy');
      return void delivered.push(args);
    }
    throw new Error(`unexpected ${channel}`);
  };
  return { invoke, delivered, files };
};
const OUT = 'C:/h/.claude/steer/outbox.jsonl';
const DONE = 'C:/h/.claude/steer/outbox-done.json';
const line = (id: string, age: number, session = 's1') => JSON.stringify({ id, ts: NOW - age, session, prompt: `p-${id}` });
const quiet = () => {};
const newState = () => ({ ...slowState(), wait: async () => {} });

let w = world({});
assert.equal(await pollOutbox(w.invoke, 'C:/h', newState(), NOW, quiet), 0);
w = world({ [OUT]: [line('a', 1000), 'half-written {', line('old', 11 * 60_000)].join('\n') + '\n' });
const st = newState();
assert.equal(await pollOutbox(w.invoke, 'C:/h', st, NOW, quiet), 1);
assert.deepEqual(w.delivered, [['s1', 'p-a']]);
assert.deepEqual(JSON.parse(w.files[DONE]), ['a']);
assert.equal(await pollOutbox(w.invoke, 'C:/h', st, NOW + 3000, quiet), 0);
assert.equal(w.delivered.length, 1);
assert.equal(w.files[OUT].split('\n').length, 4, 'outbox.jsonl is never rewritten');
ok('a new entry is delivered once; one older than 10 minutes and a missing file are skipped');

w = world({ [OUT]: line('a', 1000) + '\n' + line('b', 2000) + '\n', [DONE]: '["a"]' });
assert.equal(await pollOutbox(w.invoke, 'C:/h', newState(), NOW, quiet), 1);
assert.deepEqual(w.delivered, [['s1', 'p-b']]);
assert.deepEqual(JSON.parse(w.files[DONE]).sort(), ['a', 'b']);
ok('an id in outbox-done.json is skipped after a restart');

const logs: unknown[] = [];
w = world({ [OUT]: line('c', 1000) + '\n' }, 99);
const st2 = newState();
for (let i = 0; i < 5; i++) await pollOutbox(w.invoke, 'C:/h', st2, NOW + i * 3000, (m) => logs.push(m));
assert.equal(logs.length, MAX_TRIES);
assert.match(String(logs[0]), /id c \(try 1 of 3\): session busy/);
assert.equal(w.delivered.length, 0);
w = world({ [OUT]: line('d', 1000) + '\n' }, 1);
const st3 = newState();
await pollOutbox(w.invoke, 'C:/h', st3, NOW, quiet);
assert.equal(await pollOutbox(w.invoke, 'C:/h', st3, NOW + 3000, quiet), 1);
ok('a failed delivery is logged with its id and retried, at most 3 times');

w = world({ [OUT]: line('e', 1000) + '\n' });
const winA = newState(), winB = newState();
const both = await Promise.all([pollOutbox(w.invoke, 'C:/h', winA, NOW, quiet), pollOutbox(w.invoke, 'C:/h', winB, NOW, quiet)]);
assert.deepEqual(w.delivered, [['s1', 'p-e']], 'two windows starting together: one delivery');
assert.equal(both[0] + both[1], 1);
const lead = both[0] ? winA : winB, other = both[0] ? winB : winA;
w.files[OUT] += line('f', 500) + '\n';
assert.equal(await pollOutbox(w.invoke, 'C:/h', other, NOW + 3000, quiet), 0, 'the other window leaves a fresh lock alone');
assert.equal(await pollOutbox(w.invoke, 'C:/h', lead, NOW + 3000, quiet), 1);
w.files[OUT] += line('g', 500) + '\n';
const later = NOW + 3000 + LOCK_MS + 1;
assert.equal(await pollOutbox(w.invoke, 'C:/h', other, later, quiet), 1, 'a lock not refreshed for LOCK_MS is taken over');
assert.deepEqual(w.delivered.map((d) => d[1]), ['p-e', 'p-f', 'p-g'], 'the new holder does not re-deliver what the old one sent');
ok('two windows: only the lock holder delivers; a stale lock is taken over without repeats');
