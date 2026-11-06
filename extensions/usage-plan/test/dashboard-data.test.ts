// The dashboard's data rules: the file check, the stale rule, the state moves, and the read command.
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildDashboard, readDashboardFile } from '../src/command.ts';
import { REQUIRED_KEYS, canStartBuild, initialState, isDataStale, isStale, needsBuildOnOpen, parseDashboard, progressFraction, reduce } from '../src/dashboard-data.ts';
import type { DashboardData } from '../src/dashboard-data.ts';

const now = Date.parse('2026-11-05T12:00:00.000Z');
const file = (over: Record<string, unknown> = {}) => ({
  generated: 'x', builtAt: '2026-11-05T11:30:00.000Z', computer: 'c', sessions: [], plan: {}, shared: {}, ahead: {}, codex: {}, gemini: {}, ...over,
});
const data = file() as DashboardData;

const cases: [string, () => void][] = [
  ['a file with every key parses', () => assert.equal(parseDashboard(JSON.stringify(file())).builtAt, data.builtAt)],
  ['null values still count as present keys', () => assert.doesNotThrow(() => parseDashboard(JSON.stringify(file({ codex: null, gemini: null }))))],
  ['each missing key is named', () => {
    for (const key of REQUIRED_KEYS) {
      const f: Record<string, unknown> = file();
      delete f[key];
      assert.throws(() => parseDashboard(JSON.stringify(f)), new RegExp(`misses ${key}$`));
    }
  }],
  ['several missing keys are all named', () => assert.throws(() => parseDashboard('{"builtAt":"2026-11-05T11:30:00.000Z"}'), /misses generated, computer/)],
  ['text that is not JSON is refused with the reason', () => assert.throws(() => parseDashboard('{"gener'), /not valid JSON/)],
  ['an array or a number is not a dashboard', () => {
    assert.throws(() => parseDashboard('[]'), /not a JSON object/);
    assert.throws(() => parseDashboard('5'), /not a JSON object/);
  }],
  ['an unreadable builtAt is refused', () => {
    assert.throws(() => parseDashboard(JSON.stringify(file({ builtAt: 'yesterday' }))), /builtAt/);
    assert.throws(() => parseDashboard(JSON.stringify(file({ builtAt: 5 }))), /builtAt/);
  }],
  ['stale after more than an hour, not at exactly an hour', () => {
    assert.equal(isStale('2026-11-05T11:00:00.000Z', now), false);
    assert.equal(isStale('2026-11-05T10:59:59.000Z', now), true);
    assert.equal(isStale('2026-11-05T11:59:00.000Z', now), false);
  }],
  ['a builtAt in the future is fresh', () => assert.equal(isStale('2026-11-05T13:00:00.000Z', now), false)],
  ['the reset rule: built before the newest week ended, and that moment has passed, is stale even within the hour', () => {
    const end = Date.parse('2026-11-05T11:45:00.000Z');
    const f = file({ plan: { weeks: [{ end }] } }) as DashboardData; // built 11:30, now 12:00
    assert.equal(isDataStale(f, now), true);
    assert.equal(isDataStale(f, Date.parse('2026-11-05T11:44:00.000Z')), false); // reset not reached yet
    assert.equal(isDataStale(f, end), true); // exactly at the reset
  }],
  ['the reset rule: built after the reset, no weeks, or a plan without weeks stays fresh', () => {
    assert.equal(isDataStale(file({ plan: { weeks: [{ end: Date.parse('2026-11-05T11:00:00.000Z') }] } }) as DashboardData, now), false);
    assert.equal(isDataStale(file({ plan: { weeks: [] } }) as DashboardData, now), false);
    assert.equal(isDataStale(file({ plan: null }) as DashboardData, now), false);
    assert.equal(isDataStale(file({ plan: {} }) as DashboardData, now), false);
  }],
  ['the reset rule keeps the one-hour rule', () => assert.equal(isDataStale(file({ builtAt: '2026-11-05T10:00:00.000Z', plan: {} }) as DashboardData, now), true)],
  ['on open: a build is due after the reset', () => assert.equal(needsBuildOnOpen(file({ plan: { weeks: [{ end: Date.parse('2026-11-05T11:45:00.000Z') }] } }) as DashboardData, now), true)],
  ['on open: no file builds, stale builds, fresh does not', () => {
    assert.equal(needsBuildOnOpen(null, now), true);
    assert.equal(needsBuildOnOpen(file({ builtAt: '2026-11-05T09:00:00.000Z' }) as DashboardData, now), true);
    assert.equal(needsBuildOnOpen(data, now), false);
  }],
  ['read ok shows the data at rest', () => assert.deepEqual(reduce(initialState, { type: 'read-ok', data }), { data, status: 'ready', error: '' })],
  ['no file leaves no data and no error', () => assert.deepEqual(reduce(initialState, { type: 'read-missing' }), { data: null, status: 'ready', error: '' })],
  ['a failed read keeps the reason', () => assert.deepEqual(reduce(initialState, { type: 'read-failed', reason: 'boom' }), { data: null, status: 'ready', error: 'boom' })],
  ['a build keeps the old data on screen and clears the error', () => {
    const s = reduce({ data, status: 'ready', error: 'old' }, { type: 'build-start' });
    assert.deepEqual(s, { data, status: 'rebuilding', error: '' });
  }],
  ['a failed build keeps the old data and shows the reason', () => {
    const s = reduce({ data, status: 'rebuilding', error: '' }, { type: 'build-failed', reason: 'timed out' });
    assert.deepEqual(s, { data, status: 'ready', error: 'timed out' });
  }],
  ['a finished build replaces the data', () => {
    const fresh = file({ builtAt: '2026-11-05T12:00:00.000Z' }) as DashboardData;
    assert.deepEqual(reduce({ data, status: 'rebuilding', error: '' }, { type: 'read-ok', data: fresh }), { data: fresh, status: 'ready', error: '' });
  }],
  ['a press while a build runs does nothing', () => {
    assert.equal(canStartBuild({ data, status: 'rebuilding', error: '' }), false);
    assert.equal(canStartBuild({ data, status: 'ready', error: '' }), true);
    assert.equal(canStartBuild({ data: null, status: 'ready', error: 'x' }), true);
  }],
  ['the build command runs the script without opening the browser', () => {
    assert.match(buildDashboard(), /usage-dashboard\.mjs/);
    assert.match(buildDashboard(), /--no-open/);
  }],
  ['the read command: exit 2 when the file is missing, the file text when it is there', () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), 'usage-plan-home-'));
    const env = { ...process.env, HOME: home, USERPROFILE: home };
    try {
      let code = 0;
      try {
        execSync(readDashboardFile(), { env, stdio: 'pipe' });
      } catch (e) {
        code = (e as { status: number }).status;
      }
      assert.equal(code, 2);
      fs.mkdirSync(path.join(home, '.claude', 'reports'), { recursive: true });
      fs.writeFileSync(path.join(home, '.claude', 'reports', 'usage-dashboard.json'), JSON.stringify(file()));
      assert.equal(parseDashboard(execSync(readDashboardFile(), { env, encoding: 'utf8' })).builtAt, data.builtAt);
    } finally {
      fs.rmSync(home, { recursive: true, force: true });
    }
  }],
  ['progress is elapsed over the last build time', () => assert.equal(progressFraction(30_000, 60_000), 0.5)],
  ['progress stops at 95% when the build runs long', () => assert.equal(progressFraction(300_000, 60_000), 0.95)],
  ['progress is unknown without a previous build time', () => {
    assert.equal(progressFraction(5_000, undefined), null);
    assert.equal(progressFraction(5_000, 0), null);
  }],
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
