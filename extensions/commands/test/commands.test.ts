// node --experimental-strip-types test/commands.test.ts
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { COMMANDS, MODEL, run, visible } from '../src/commands.ts';
import { OWN } from '../src/own.ts';

let n = 0;
const ok = (name: string) => console.log(`ok ${++n} ${name}`);

// every button names a skill, and on a computer that has the skills, one that is installed
const skills = path.join(os.homedir(), '.claude', 'skills');
const installed = fs.existsSync(path.join(skills, 'board-cleanup'));
for (const c of COMMANDS) {
  assert.match(c.prompt, /^\/[a-z-]+$/, c.id);
  // a button tied to one project may start a skill that lives in that project's own folder
  // inside the setup's repository, the skill may be one the repository ships and this computer doesn't have
  const places = [skills, path.join(import.meta.dirname, '..', '..', '..', 'skills')];
  if (installed && !c.only) assert.ok(places.some((p) => fs.existsSync(path.join(p, c.prompt.slice(1), 'SKILL.md'))), `no skill for ${c.prompt}`);
}
ok(installed ? 'every button has an installed skill' : 'every button names a skill (the skills are not installed here, so that was not checked)');

assert.equal(new Set(COMMANDS.map((c) => c.id)).size, COMMANDS.length);
ok('ids are unique');

const list = [...COMMANDS.slice(0, 2), { ...COMMANDS[0], id: 'one-folder', only: 'my-project' }];
const ids = (p: string) => visible(p, list).map((c) => c.id);
assert.ok(ids('C:\\Projects\\my-project').includes('one-folder'));
assert.ok(ids('C:/Projects/My-Project/').includes('one-folder'));
assert.ok(!ids('C:\\Projects\\another-project').includes('one-folder'));
assert.ok(!ids('').includes('one-folder'));
assert.equal(ids('C:\\Projects\\another-project').length, list.length - 1);
ok('a button tied to one project shows only in that project');

// the build for other people (npm run build:share), when it has been made
const shared = path.join(import.meta.dirname, '..', 'dist-share', 'index.js');
if (fs.existsSync(shared)) {
  const js = fs.readFileSync(shared, 'utf8');
  const everywhere = COMMANDS.filter((c) => !OWN.includes(c)).map((c) => c.prompt);
  for (const c of OWN.filter((o) => !everywhere.includes(o.prompt))) assert.ok(!js.includes(c.prompt), `the shared build still has ${c.prompt}, which only works here`);
  for (const c of COMMANDS.filter((c) => !OWN.includes(c))) assert.ok(js.includes(c.prompt), c.prompt);
  ok(`the shared build has the ${COMMANDS.length - OWN.length} buttons that work anywhere and none from own.ts`);
}

const calls: unknown[][] = [];
const never = new Promise(() => {});
assert.equal(await run(COMMANDS[0], (channel, args) => (calls.push([channel, args]), never), 20), '');
assert.deepEqual(calls[0], ['extensions:ai-send-prompt', { prompt: '/board-cleanup', sessionName: 'Board cleanup', model: MODEL }]);
ok('a button sends its command, name and Sonnet, and does not wait for the reply');

assert.equal(await run(COMMANDS[0], () => Promise.reject(new Error('No workspace path available')), 500), 'No workspace path available');
ok('a refusal is returned as text');
