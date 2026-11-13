// Run: npm test   (Node 22.6+ strips the types)
import assert from 'node:assert/strict';
import { chunkForSpeech, cleanForSpeech, splitVoice } from '../src/cleanText.ts';

const opts = { skipCodeBlocks: true, skipTerminalOutput: true };
const clean = (md: string) => cleanForSpeech(md, opts);
let passed = 0;
function t(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

t('voice summary is split from the body', () => {
  assert.deepEqual(splitVoice('Did **X**.\n\n<!-- voice: All done, nothing needs you. -->\n'), {
    body: 'Did **X**.',
    summary: 'All done, nothing needs you.',
  });
  assert.deepEqual(splitVoice('No summary here.'), { body: 'No summary here.', summary: null });
  assert.equal(splitVoice('a <!-- voice:\nfirst --> b <!-- voice: second -->').summary, 'second');
});

t('heading + bold', () => {
  assert.equal(clean('### Result\n\n**Everything passed.**'), 'Result.\n\nEverything passed.');
});

t('numbered steps keep numbers', () => {
  assert.equal(clean('1. Open settings\n2. Pick **Read Aloud**'), '1, Open settings.\n2, Pick Read Aloud.');
});

t('list items stay together, paragraphs stay apart', () => {
  assert.equal(clean('Left:\n\n- update the notes\n- check the links\n\nDone.'), 'Left:\n\nupdate the notes.\ncheck the links.\n\nDone.');
});

t('links keep labels, bare URLs become host names', () => {
  assert.equal(clean('See [the docs](https://example.com/a/b?c=1) or https://www.github.com/x/y/z.'), 'See the docs or github.com.');
});

t('file links and paths shortened', () => {
  assert.equal(
    clean('Edited [backend.ts](/C:/Users/someone/proj/src/backend.ts:42) and C:\\Users\\someone\\proj\\src\\cleanText.ts'),
    'Edited backend.ts and cleanText.ts.'
  );
});

t('fenced code, diffs and output skipped', () => {
  const md = 'Before.\n\n```ts\nconst x = 1;\n```\n\n```diff\n- a\n+ b\n```\n\n```\n$ npm test\nok\n```\n\nAfter.';
  assert.equal(clean(md), 'Before.\n\nCode omitted.\n\nDiff omitted.\n\nOutput omitted.\n\nAfter.');
});

t('code read when not skipped', () => {
  const out = cleanForSpeech('```js\nfoo()\n```', { skipCodeBlocks: false, skipTerminalOutput: true });
  assert.equal(out, 'foo().');
});

t('short inline code kept, long dropped', () => {
  assert.equal(clean('Run `npm test` then `' + 'x'.repeat(60) + '` done'), 'Run npm test then done.');
});

t('stack traces collapsed', () => {
  const md = 'It failed:\nError: boom\n    at foo (C:\\a\\b.js:1:2)\n    at bar (C:\\a\\c.js:3:4)\nThat is all.';
  assert.match(clean(md), /Stack trace omitted\.\n\nThat is all\./);
});

t('snake_case survives, emphasis removed', () => {
  assert.equal(clean('Use *my_var* and _this_ now'), 'Use my_var and this now.');
});

t('tables read row by row', () => {
  assert.equal(clean('| A | B |\n|---|---|\n| 1 | 2 |'), 'A, B.\n1, 2.');
});

t('arrows read as words', () => {
  assert.equal(clean('Settings → Extensions'), 'Settings to Extensions.');
});

t('chunks respect sentences and limits', () => {
  const text = Array.from({ length: 30 }, (_, i) => `Sentence number ${i} is here.`).join(' ');
  const chunks = chunkForSpeech(text).map((c) => c.text);
  assert.ok(chunks[0].length <= 100);
  assert.ok(chunks.every((c) => c.length <= 360));
  assert.ok(chunks.every((c) => c.endsWith('.')));
  assert.equal(chunks.join('\n').replace(/\n/g, ' '), text);
});

t('very long sentence split on word boundaries', () => {
  const long = Array.from({ length: 120 }, () => 'word').join(' ') + '.';
  const chunks = chunkForSpeech(long).map((c) => c.text);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join(' '), long);
});

t('chunks keep one sentence per line and mark paragraph ends', () => {
  const chunks = chunkForSpeech('Result.\n\nIt passed. All of it is ready now.\n\nFirst item.\nSecond item.', 45, 60);
  assert.deepEqual(chunks, [
    { text: 'Result.\n\nIt passed.\nAll of it is ready now.', paragraphEnd: true },
    { text: 'First item.\nSecond item.', paragraphEnd: false },
  ]);
});

console.log(`\n${passed} passed`);
