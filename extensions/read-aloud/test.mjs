// Run: node test.mjs   (Node 22.6+ strips the types)
// Runs the cleanText tests, then the speed-format and voice-name tests.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const clean = spawnSync(process.execPath, ['--experimental-strip-types', '--no-warnings', 'test/cleanText.test.ts'], {
  stdio: 'inherit',
});
if (clean.status !== 0) process.exit(clean.status ?? 1);

const { formatSpeed, t } = await import('./src/strings.ts');
let passed = 0;
function check(name, fn) {
  fn();
  passed++;
  console.log(`ok - ${name}`);
}

check('speed uses the multiplication sign', () => {
  assert.equal(formatSpeed(1.2), '1.2×');
  assert.equal(formatSpeed(0.5), '0.5×');
});
check('whole speeds have no decimals', () => {
  assert.equal(formatSpeed(1), '1×');
  assert.equal(formatSpeed(2), '2×');
});
check('speed keeps two decimals at most', () => {
  assert.equal(formatSpeed(1.25), '1.25×');
  assert.equal(formatSpeed(0.7500000001), '0.75×');
  assert.equal(formatSpeed(1.1 + 0.1), '1.2×');
});
check('every voice has a human name', () => {
  for (const id of ['af_sky', 'af_heart', 'af_bella', 'af_nicole', 'af_sarah', 'af_river', 'af_nova', 'af_jessica', 'af_aoede']) {
    assert.ok(t.voiceNames[id] && !t.voiceNames[id].includes('_'), id);
  }
});

console.log(`\n${passed} passed (speed and voice names)`);
