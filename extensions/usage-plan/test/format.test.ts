// How the session pace is worked out, and how time spans are worded.
import assert from 'node:assert/strict';
import { sessionPace, span, weekTone } from '../src/format.ts';
import type { Pace, Plan } from '../src/format.ts';
import { gutterCss } from '../src/gutter.ts';

const plan = (_: unknown[], average: Pace | null = null): Plan => ({
  status: 'ok',
  week: { used: 30, resets: '2026-10-08T02:00:00.000Z', rolled: false, budget: 12, average, recent: null },
});

const cases: [string, () => void][] = [
  ['session pace: 40% left over 2 hours is 20% an hour, next to the pace now', () =>
    assert.deepEqual(
      sessionPace(
        { status: 'ok', five: { open: true, used: 60, resets: '2026-10-03T04:00:00.000Z', perHour: 31.26, atReset: 122.5, full: '2026-10-03T03:17:00.000Z' } },
        Date.parse('2026-10-03T02:00:00.000Z')
      ),
      { budget: 20, perHour: 31.3, atReset: 122.5, full: '2026-10-03T03:17:00.000Z' }
    )],
  ['session pace: nothing while no window is open', () => assert.equal(sessionPace({ status: 'ok', five: { open: false } }, 0), null)],
  ['spans', () => assert.deepEqual([span(130 * 3_600_000), span(125 * 60_000), span(12 * 60_000)], ['5d 10h', '2h 5m', '12m'])],
  ['tone', () =>
    assert.deepEqual(
      [
        weekTone(plan([], { perDay: 20, atReset: 150, full: '2026-10-05T00:00:00.000Z' })),
        weekTone(plan([], { perDay: 13, atReset: 95, full: null })),
        weekTone(plan([], { perDay: 8, atReset: 60, full: null })),
      ],
      ['error', 'warning', 'success']
    )],
  ['gutter ring: percent, colour and arc on the app\'s button', () => {
    const css = gutterCss(plan([], { perDay: 13, atReset: 95, full: null }));
    assert.match(css, /button\[data-panel-id\*="usageplan"\]::after \{ content: "30%"/);
    assert.match(css, /stroke%3D'%23eab308'/);
    // 30% of the ring drawn: 70% of its 75.40 length is left out
    assert.match(css, /stroke-dashoffset%3D'52\.78'/);
    assert.match(css, /> \.material-symbols-outlined \{ display: none; \}/);
  }],
  ['gutter ring: nothing without numbers, so the plain icon stays', () =>
    assert.deepEqual([gutterCss(null), gutterCss({ status: 'no-data' })], ['', ''])],
];

let failed = 0;
for (const [name, run] of cases) {
  try {
    run();
    console.log(`ok   ${name}`);
  } catch (e) {
    failed++;
    console.log(`FAIL ${name}: ${(e as Error).message}`);
  }
}
process.exitCode = failed ? 1 : 0;
