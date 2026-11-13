// Checks the Agents Panel build: manifest points at real files, the script loads and exports
// activate/deactivate, the stylesheet is well formed and carries both fixes, and the Russian
// build swaps both labels. Run: node test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildFor, createChecks } from '../shared/check.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const { check, finish } = createChecks();
const build = (lang) => buildFor(here, lang);

build('russian');
const ru = fs.readFileSync(path.join(here, 'dist', 'index.js'), 'utf8');
const ruMod = await import(pathToFileURL(path.join(here, 'dist', 'index.js')).href + `?ru=${Date.now()}`);
check('russian: done label', ruMod.STRINGS.done === 'Готово: {n}' && !ru.includes("'{n} done'"));
check('russian: idle label', ruMod.STRINGS.idle === 'Ничего не запущено' && !ru.includes("'Nothing running'"));
check('russian: kind, time and tool count in the meta line', ruMod.metaWords('Sub-agent · 2m 10s · 14 tools · stopped', 'stopped') === 'Субагент · остановлено · 2м 10с · инструментов: 14' && ruMod.metaWords('Command', 'completed') === 'Команда · готово');
check('russian: rest of the file untouched', ru.includes('function plainTitle') && ru.includes('export {'));

build('english');
const enMod = await import(pathToFileURL(path.join(here, 'src', 'index.js')).href);
const keys = (o) => Object.keys(o).sort().join();
check('russian: same keys as english', keys(ruMod.STRINGS) === keys(enMod.STRINGS) && keys(ruMod.STRINGS.now) === keys(enMod.STRINGS.now));
// Model names are product names and stay as they are in Russian
check('russian: every string differs', Object.entries(enMod.STRINGS).filter(([k]) => k !== 'models').every(([k, v]) => (typeof v === 'string' ? v !== ruMod.STRINGS[k] : Object.entries(v).every(([t, w]) => w !== ruMod.STRINGS[k][t]))));
const manifest = JSON.parse(fs.readFileSync(path.join(here, 'manifest.json'), 'utf8'));
check('manifest id', manifest.id === 'com.local.agentspanel');
check('manifest main exists', fs.existsSync(path.join(here, manifest.main)));
check('manifest styles exists', fs.existsSync(path.join(here, manifest.styles)));

const mod = await import(pathToFileURL(path.join(here, 'dist', 'index.js')).href + `?t=${Date.now()}`);
check('exports activate', typeof mod.activate === 'function');
check('exports deactivate', typeof mod.deactivate === 'function');

// Pure functions, on the app's real strings
const { plainTitle, metaWords, nowWords, parseMeta, countWords } = mod;
check('title: plain text only gets a capital', plainTitle('Web search: Acme login steps') === 'Web search: Acme login steps' && plainTitle('lists the windows') === 'Lists the windows');
check('title: WHAT THIS DOES line of a two-line command', plainTitle('Get-Process | Select -First 3\n# WHAT THIS DOES: lists the windows') === 'Lists the windows');
check('title: first line of a multi-line text', plainTitle('first line\nsecond line') === 'First line');
check('title: long text cut to its first line', plainTitle(`${'x'.repeat(130)}\nmore`) === `X${'x'.repeat(129)}`);
check('meta: running sub-agent', metaWords('Sub-agent · 1s · 1 tool · WebFetch', 'running') === 'Sub-agent · 1s · 1 tool · reading a page (WebFetch)');
check('meta: running with unknown tool', metaWords('Sub-agent · 5s · 2 tools · FooTool', 'running') === 'Sub-agent · 5s · 2 tools · FooTool');
check('meta: running, no elapsed', metaWords('Command', 'running') === 'Command');
check('meta: completed sub-agent', metaWords('Sub-agent · 4m 24s · 30 tools', 'completed') === 'Sub-agent · done · 4m 24s · 30 tools');
check('meta: completed command', metaWords('Command', 'completed') === 'Command · done');
check('meta: failed command', metaWords('Command · failed', 'failed') === 'Command · failed');
check('meta: stopped sub-agent', metaWords('Sub-agent · 2m 10s · 14 tools · stopped', 'stopped') === 'Sub-agent · stopped · 2m 10s · 14 tools');
check('meta: hours', metaWords('Workflow · 1h 5m', 'completed') === 'Workflow · done · 1h 5m');
check('meta: unparseable stays null', metaWords('something odd · here', 'running') === null && metaWords('Sub-agent · a · b · c', 'running') === null);
check('meta: parse outcome', parseMeta('Sub-agent · 2m 10s · 14 tools · stopped')?.last === '');
check('now: words and tool name', nowWords('Grep') === 'searching files (Grep)' && nowWords('Agent') === 'waiting on a sub-agent (Agent)' && nowWords('Bash') === 'running a command (Bash)');
// A frozen row: the app said 35s while the planner had run 2 minutes
const T0 = 1793864638072;
const planner = { startedAt: T0, durationMs: 35000 };
const seen = 'Sub-agent · 35s · 10 tools · Grep';
check('live time: counts from startedAt, not the app\'s durationMs', metaWords(seen, 'running', planner, T0 + 120000) === 'Sub-agent · 2m 0s · 10 tools · searching files (Grep)');
check('live time: moves each second', metaWords(seen, 'running', planner, T0 + 121000) === 'Sub-agent · 2m 1s · 10 tools · searching files (Grep)');
check('live time: no report for over 2 minutes reads quiet', metaWords(seen, 'running', planner, T0 + 35000 + 4 * 60000 + 5000) === 'Sub-agent · 4m 40s · 10 tools · quiet for 4m');
check('live time: exactly 2 minutes silent is not quiet yet', metaWords(seen, 'running', planner, T0 + 35000 + 120000).endsWith('searching files (Grep)'));
check('live time: hours', metaWords(seen, 'running', { startedAt: T0, durationMs: 3600000 + 300000 }, T0 + 3600000 + 330000) === 'Sub-agent · 1h 5m · 10 tools · searching files (Grep)');
check('live time: no task keeps the app\'s time', metaWords(seen, 'running') === 'Sub-agent · 35s · 10 tools · searching files (Grep)');
check('live time: a finished row keeps the app\'s time', metaWords('Sub-agent · 4m 24s · 30 tools', 'completed', planner, T0 + 999999) === 'Sub-agent · done · 4m 24s · 30 tools');
check('live time: a running command counts up and never reads quiet', metaWords('Command', 'running', { startedAt: T0, durationMs: 0 }, T0 + 667000) === 'Command · 11m 7s');
check('clock: app format', mod.clock(45000) === '45s' && mod.clock(130000) === '2m 10s' && mod.clock(3900000) === '1h 5m' && mod.clock(-5) === '0s');
{
  const task = { startedAt: 1, durationMs: 2 };
  const row = { __reactFiber$x: { memoizedProps: { className: 'task-item' }, return: { memoizedProps: { task } } } };
  check('rowTask: task prop one level up', mod.rowTask(row) === task && mod.rowTask({}) === null);
  const newer = { startedAt: 1, durationMs: 9 };
  row.__reactFiber$x.return.alternate = { memoizedProps: { task: newer } };
  check('rowTask: the newer task of the two fibers', mod.rowTask(row) === newer);
}
check('russian: quiet words', ruMod.metaWords(seen, 'running', planner, T0 + 35000 + 4 * 60000) === 'Субагент · 4м 35с · инструментов: 10 · тихо уже 4м');
check('count: running first, a failure stays named beside it, then failed, then done', countWords({ running: 2, failed: 1, completed: 5 }).text === '2 running · 1 failed' && countWords({ running: 2, failed: 0, completed: 5 }).text === '2 running' && countWords({ running: 0, failed: 1, completed: 5 }).text === '1 failed' && countWords({ running: 0, failed: 0, completed: 12 }).text === 'Nothing running');

// Model and effort of a helper, from the run log
const { modelWords, effortWords, runWords, matchRun, parseRuns } = mod;
check('model: short names', modelWords('sonnet') === 'Sonnet' && modelWords('opus') === 'Opus' && modelWords('haiku') === 'Haiku' && modelWords('fable') === 'Fable');
check('model: full ids by family', modelWords('claude-sonnet-4-5') === 'Sonnet' && modelWords('claude-opus-5-5') === 'Opus' && modelWords('Claude-Haiku-4') === 'Haiku');
check('model: null, unknown and inherited show nothing', modelWords(null) === '' && modelWords(undefined) === '' && modelWords('inherited') === '' && modelWords('gpt-9') === '');
check('effort: as given, xhigh in words, null nothing', effortWords('medium') === 'medium' && effortWords('xhigh') === 'very high' && effortWords('odd') === 'odd' && effortWords(null) === '');
check('run words: joined, model only, nothing without a model', runWords({ model: 'sonnet', effort: 'medium' }) === 'Sonnet, medium' && runWords({ model: 'opus', effort: null }) === 'Opus' && runWords({ model: null, effort: 'high' }) === '' && runWords(null) === '');
const log = [
  { description: 'Worker: panel', model: 'sonnet' },
  { description: ' Worker: panel ', model: 'opus' },
  { description: 'Other', model: 'haiku' },
  { description: 'Worker: panel', model: 'fable' },
];
const got = matchRun(['Worker: panel', 'Worker: panel', 'Command text', 'Other'], log);
check('match: same description claims two different lines, newest first', got[0] === log[3] && got[1] === log[1]);
check('match: no line gives null, others still match', got[2] === null && got[3] === log[2]);
const four = matchRun(['Worker: panel', 'Worker: panel', 'Worker: panel', 'Worker: panel'], log);
check('match: the oldest line goes to the third row, a fourth finds nothing left', four[2] === log[0] && four[3] === null);
check('match: trimmed on both sides', matchRun(['  Other\n'], log)[0] === log[2]);
check('parse runs: skips bad lines', parseRuns('{"description":"a","model":"opus"}\nnot json\n\n[1]\n{"model":"x"}\n{"description":"b"}').map((r) => r.description).join() === 'a,b');
check('title: kind word and colon stripped', plainTitle('Worker: fix the panel') === 'Fix the panel' && plainTitle('reviewer :  check it') === 'Check it' && plainTitle('Sub-agent: a') === 'A' && plainTitle('HELPER: b') === 'B');
check('title: other kinds and mid-text words stay', plainTitle('Read files: farmfind fetcher') === 'Read files: farmfind fetcher' && plainTitle('Ask the worker: now') === 'Ask the worker: now');
check('title: cut at the first " · ", " | " or ";"', plainTitle('Fix A · and B') === 'Fix A' && plainTitle('Fix A | and B') === 'Fix A' && plainTitle('Fix A; and B') === 'Fix A' && plainTitle('Worker: fix A; then B') === 'Fix A' && plainTitle('a|b') === 'A|b');
check('meta: model words follow the kind in every state', metaWords('Sub-agent · 4m 24s · 30 tools · Grep', 'running', null, 0, { model: 'sonnet', effort: 'medium' }) === 'Sub-agent · Sonnet, medium · 4m 24s · 30 tools · searching files (Grep)'
  && metaWords('Sub-agent · 4m 24s · 30 tools', 'completed', null, 0, { model: 'opus', effort: 'xhigh' }) === 'Sub-agent · Opus, very high · done · 4m 24s · 30 tools'
  && metaWords('Sub-agent · 2m 10s', 'stopped', null, 0, { model: 'haiku', effort: null }) === 'Sub-agent · Haiku · stopped · 2m 10s'
  && metaWords('Sub-agent · 1s', 'failed', null, 0, { model: 'fable', effort: 'high' }) === 'Sub-agent · Fable, high · failed · 1s');
check('meta: no run or an unknown model changes nothing', metaWords('Sub-agent · 4m 24s', 'completed', null, 0, null) === 'Sub-agent · done · 4m 24s' && metaWords('Sub-agent · 4m 24s', 'completed', null, 0, { model: 'inherited', effort: 'high' }) === 'Sub-agent · done · 4m 24s');
check('russian: model and effort', ruMod.metaWords('Sub-agent · 4m 24s', 'completed', null, 0, { model: 'sonnet', effort: 'xhigh' }) === 'Субагент · Sonnet, очень высокий · готово · 4м 24с');
check('manifest: filesystem permission', manifest.permissions?.filesystem === true && manifest.version === '0.4.0');
check('build: runs.js inlined, no import left', !ru.includes("from './runs.js'") && ru.includes('function matchRun') && fs.readFileSync(path.join(here, 'dist', 'index.js'), 'utf8').includes('function readRuns'));
check('build: scroll-hold.js inlined, no import left', !ru.includes("from './scroll-hold.js'") && ru.includes('function startScrollHold'));

// Scroll hold. The chat's end is at 5000; the app follows it by scrolling there after each update.
{
  const { createHold } = mod;
  const MAX = 5000;
  let h = createHold();
  check('hold: not reading, the app follows the bottom', h.allows(4990, MAX, MAX));
  // The bug: one small step up (20px, a touchpad or a smooth wheel) is still inside the app's 50px,
  // and the next update pulled the reader back down
  h.up();
  h.scrolled(1000, 20);
  check('hold: a small step up holds against the follow scroll', h.reading && !h.allows(4980, MAX, MAX));
  check('hold: a scroll near the end (list library estimate) is held too', !h.allows(4800, MAX - 60, MAX));
  check('hold: a jump to a message further up or in the middle goes through', h.allows(4980, 1200, MAX) && h.allows(2000, 3000, MAX));
  check('hold: scrolling up goes through', h.allows(4980, 4000, MAX));
  h.scrolled(2000, 10);
  check('hold: reaching the end without the user going down keeps reading', h.reading);
  h.down(3000, 400);
  h.scrolled(3200, 300);
  check('hold: on the way down, not yet at the end, still reading', h.reading);
  h.scrolled(3500, 30);
  check('hold: the user back at the end, following again', !h.reading && h.allows(4970, MAX, MAX));
  h = createHold();
  h.up();
  h.down(10000, 400);
  h.scrolled(11500, 0);
  check('hold: a down gesture over a second old does not end reading', h.reading);
  h.down(12000, 0);
  check('hold: a wheel down already at the end ends reading', !h.reading);
  h.up();
  h.stop();
  check('hold: stop (the scroll-to-bottom arrow, another session) ends reading', !h.reading && h.allows(0, MAX, MAX));

  // A tool's output box inside the chat with its own scrollbar
  const { holdInnerScrolls, holdEditable } = mod;
  const list = { scrollHeight: 9000, clientHeight: 800, scrollTop: 8200, parentElement: null };
  const box = { scrollHeight: 600, clientHeight: 256, scrollTop: 100, parentElement: list };
  const line = { scrollHeight: 20, clientHeight: 20, scrollTop: 0, parentElement: box };
  const auto = () => 'auto';
  check('inner box: a wheel inside a box that can still scroll moves the box, not the chat', holdInnerScrolls(line, list, -1, auto) && holdInnerScrolls(line, list, 1, auto));
  box.scrollTop = 0;
  check('inner box: at its top, a wheel up moves the chat', !holdInnerScrolls(line, list, -1, auto) && holdInnerScrolls(line, list, 1, auto));
  box.scrollTop = 344;
  check('inner box: at its end, a wheel down moves the chat', !holdInnerScrolls(line, list, 1, auto) && holdInnerScrolls(line, list, -1, auto));
  box.scrollTop = 100;
  check('inner box: overflow hidden or visible does not count', !holdInnerScrolls(line, list, -1, () => 'hidden') && !holdInnerScrolls(line, list, -1, () => 'visible'));
  check('inner box: the list itself is not an inner box', !holdInnerScrolls(list, list, -1, auto));
  check('editable: text fields and contenteditable, not a plain block', holdEditable({ tagName: 'TEXTAREA' }) && holdEditable({ tagName: 'INPUT' }) && holdEditable({ tagName: 'DIV', isContentEditable: true }) && !holdEditable({ tagName: 'DIV', isContentEditable: false }) && !holdEditable(null));
}

const rawCss =fs.readFileSync(path.join(here, 'dist', 'style.css'), 'utf8');
const tokens = fs.readFileSync(path.join(here, '..', 'shared', 'tokens.css'), 'utf8');
check('css: begins with tokens block', rawCss.startsWith(tokens));
check('css: has --x-surface-1', rawCss.includes('--x-surface-1'));
// A `font` shorthand without a family is invalid and the browser drops it
const typeTokens = [...tokens.matchAll(/--x-(?:title|body|caption|micro|figure):([^;]+);/g)].map((m) => m[1].trim());
check('tokens: every type token is a full font shorthand', typeTokens.length === 5 && typeTokens.every((v) => v.endsWith('var(--x-font-ui)')));
check('css: has --x-micro', rawCss.includes('--x-micro'));
check('css: has --x-motion-base', rawCss.includes('--x-motion-base'));

const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '');
check('css braces balanced', (css.match(/{/g) || []).length === (css.match(/}/g) || []).length);
check('css: agents list rules', ['.task-item[data-status="running"]', '.task-item[data-status="completed"]', '.task-item[data-ap-first]', '.ap-meta', '.ap-count', '.ap-fold:focus-visible', '[data-ap-header] > .ml-auto.font-mono', '[data-ap-folded="1"] .ap-fold-icon'].every((s) => css.includes(`.teammate-panel ${s}`)));
check('css: no accent bar, no transition all', !css.includes('inset 3px') && !/transition:\s*all/.test(css));
check('css: commit panel shrinks', /\.git-operations-panel\s*{\s*min-width:\s*0/.test(css));
check('css: commit switch wraps', css.includes('[data-testid="git-commit-mode-toggle"]'));

finish();
