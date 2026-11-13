// node --experimental-strip-types test/launcher.test.ts
// The started state and the ask-first second press, apart from the drawing.
import assert from 'node:assert/strict';
import { COMMANDS, createLauncher } from '../src/commands.ts';

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);
const [first, second] = COMMANDS;

const calls: string[] = [];
let answer: 'running' | 'refuse' = 'running';
const invoke = (_: string, args: unknown) => {
  calls.push((args as { prompt: string }).prompt);
  return answer === 'refuse' ? Promise.reject(new Error('No workspace path available')) : new Promise<unknown>(() => {});
};
let clockNow = 1000;
const l = createLauncher(invoke, () => clockNow, 20);

// "Starting" shows while the app has not refused, and every other row waits
const pending = l.press(first);
assert.equal(l.get().starting, first.id);
assert.equal(await l.press(second), 'ignored');
assert.equal(calls.length, 1);
assert.equal(await pending, 'started');
assert.equal(l.get().starting, '');
assert.deepEqual(l.get().started, { [first.id]: 1000 });
ok('a press shows Starting, other rows wait, then the command counts as started with its time');

// a second press asks first and starts nothing
clockNow = 2000;
assert.equal(await l.press(first), 'asking');
assert.equal(l.get().asking, first.id);
assert.equal(calls.length, 1, 'the question starts nothing');
ok('a second press of a started command only asks');

l.cancel();
assert.equal(l.get().asking, '');
assert.equal(calls.length, 1);
await l.press(first);
await l.confirm(first);
assert.equal(calls.length, 2);
assert.equal(l.get().asking, '');
assert.equal(l.get().started[first.id], 2000);
ok('cancel starts nothing; confirm starts it again and records the new time');

await l.confirm(second);
assert.equal(calls.length, 2, 'confirm without a question does nothing');
ok('confirm only works for the command that was asked about');

// the state is the launcher's, so it survives a popover that is closed and opened again
let seen = 0;
const off = l.subscribe(() => seen++);
await l.press(second);
off();
assert.ok(seen >= 2);
assert.ok(l.get().started[second.id]);
ok('listeners hear every change; the started list lives outside any popover');

// a refusal is text and does not count as started
answer = 'refuse';
const other = createLauncher(invoke, () => 5, 500);
assert.equal(await other.press(first), 'started');
assert.equal(other.get().error, 'No workspace path available');
assert.deepEqual(other.get().started, {});
assert.equal(await other.press(first), 'started', 'a refused command is pressed straight away, not asked about');
ok('a refusal shows its text, is not marked started and can be pressed again at once');
