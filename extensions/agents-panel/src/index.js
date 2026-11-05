// Agents Panel: makes Nimbalyst's "Agents & commands" list (.teammate-panel) readable.
//   - running items on top, then failed, then stopped (style.css, from the app's own data-status)
//   - completed items folded behind a "N done" line (open/closed is remembered)
//   - each row titled in plain words (the "# WHAT THIS DOES:" line of a shell command, else its
//     first line; the full text stays in the tooltip) with a one-line meta: kind, state, time,
//     tools and, while running, what it is doing now (the time counts up every second from the task's
//     start; a helper silent for over 2 minutes reads "quiet for Nm")
//   - the header reads "2 running · 1 failed" / "1 failed" / "Nothing running" instead of the app's N/M
// React owns the rows and rewrites their class names, so this only adds data-ap-* attributes and
// its own .ap-* elements, never changes the app's ones. Styles are in style.css.

import { parseRuns, matchRun, readRuns } from './runs.js';

// Every visible word. {n} is replaced by a number. The Russian build swaps this whole object.
const STRINGS = {
  running: '{n} running',
  failed: '{n} failed',
  done: '{n} done',
  stopped: '{n} stopped',
  idle: 'Nothing running',
  doneWord: 'done',
  failedWord: 'failed',
  stoppedWord: 'stopped',
  // The app's kind words, the tool count and the time units ("2m 10s"), as shown
  kinds: { 'Sub-agent': 'Sub-agent', Command: 'Command', Workflow: 'Workflow', 'MCP task': 'MCP task', Task: 'Task' },
  tools: { one: '{n} tool', many: '{n} tools' },
  units: { h: 'h', m: 'm', s: 's' },
  // A running row with no report from its helper for over 2 minutes; {n} is the time, "4m"
  quiet: 'quiet for {n}',
  // Model families and effort levels of a helper, from the run log; anything else is shown as given (effort) or not at all (model)
  models: { sonnet: 'Sonnet', opus: 'Opus', haiku: 'Haiku', fable: 'Fable' },
  efforts: { low: 'low', medium: 'medium', high: 'high', xhigh: 'very high', max: 'maximum' },
  now: {
    WebFetch: 'reading a page',
    WebSearch: 'searching the web',
    Read: 'reading a file',
    Grep: 'searching files',
    Glob: 'searching files',
    Edit: 'editing a file',
    Write: 'editing a file',
    MultiEdit: 'editing a file',
    Bash: 'running a command',
    PowerShell: 'running a command',
    Agent: 'waiting on a sub-agent',
  },
};

const FOLD_KEY = 'agentsPanel.folded';
const EXPLAIN = /#\s*WHAT THIS DOES:\s*([^\n]+)/i;
const KINDS = new Set(['Sub-agent', 'Command', 'Workflow', 'MCP task', 'Task']);
const ELAPSED = /^(?:\d+s|\d+m \d+s|\d+h \d+m)$/;
const TOOLS = /^\d+ tools?$/;
const GROUPS = ['running', 'failed', 'stopped'];
const QUIET_MS = 2 * 60 * 1000;
const KIND_PREFIX = /^(?:worker|reviewer|sub-agent|helper)\s*:\s*/i;
const CLAUSE_END = / · | \| |;/;
const RUN_POLL_MS = 5000;

// The helper run log (src/runs.js, inlined by build.mjs): read when the set of rows changes and every 5 s while one runs
let runs = [];
let runsKey = null;
let runsAt = 0;
let runsBusy = false;

let observer;
let pending = false;
let frame;
let ticker;

const isFolded = () => localStorage.getItem(FOLD_KEY) !== '0';
const fill = (text, n) => text.replace('{n}', String(n));

/** Title of a row: the description (first character upper-cased); for a shell command the
 *  "# WHAT THIS DOES:" line, for a multi-line or very long text its first line. A leading "Worker:" /
 *  "Reviewer:" / "Sub-agent:" / "Helper:" is dropped (the meta line names the kind) and the title ends at
 *  the first " · ", " | " or ";" (the full text stays in the tooltip). */
function plainTitle(text) {
  const t = text.trim();
  if (!t) return '';
  const explained = t.match(EXPLAIN);
  let title;
  if (explained) title = explained[1].trim().replace(/\s+/g, ' ');
  else {
    const lines = t.split('\n');
    title = lines.length > 1 ? lines[0].trim() : t;
  }
  title = title.replace(KIND_PREFIX, '').split(CLAUSE_END)[0].trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The model family of a log value ("sonnet", "claude-opus-5-5") in the answer language; unknown or "inherited" gives ''. */
function modelWords(model) {
  const family = typeof model === 'string' ? model.toLowerCase().match(/sonnet|opus|haiku|fable/)?.[0] : undefined;
  return family ? STRINGS.models[family] : '';
}

/** The effort as given, "xhigh" in words; null gives ''. */
function effortWords(effort) {
  if (typeof effort !== 'string' || !effort.trim()) return '';
  const e = effort.trim().toLowerCase();
  return Object.hasOwn(STRINGS.efforts, e) ? STRINGS.efforts[e] : e;
}

/** "Sonnet, medium"; just the model without an effort; nothing without a model. */
function runWords(run) {
  const model = modelWords(run?.model);
  return model ? [model, effortWords(run.effort)].filter(Boolean).join(', ') : '';
}

/** What a running row is doing, from the app's last-tool name: "searching files (Grep)"; an unknown tool stays as is. */
function nowWords(tool) {
  return Object.hasOwn(STRINGS.now, tool) ? `${STRINGS.now[tool]} (${tool})` : tool;
}

/** Kind, elapsed and tool count in the answer language. */
const kindWord = (kind) => STRINGS.kinds[kind] ?? kind;
const elapsedWords = (e) => e.replace(/(\d+)([hms])/g, (_, n, u) => n + STRINGS.units[u]);
const toolsWords = (t) => {
  if (!t) return '';
  const n = parseInt(t, 10);
  return fill(n === 1 ? STRINGS.tools.one : STRINGS.tools.many, n);
};

/** Splits the app's meta string (Kind · elapsed? · N tools? · lastTool? · failed|stopped?) or returns null when it does not fit. */
function parseMeta(meta) {
  const parts = meta.split(' · ').map((p) => p.trim());
  const kind = parts.shift();
  if (!KINDS.has(kind)) return null;
  const out = { kind, elapsed: '', tools: '', last: '' };
  if (parts.length && ELAPSED.test(parts[0])) out.elapsed = parts.shift();
  if (parts.length && TOOLS.test(parts[0])) out.tools = parts.shift();
  if (parts.length && (parts[parts.length - 1] === 'failed' || parts[parts.length - 1] === 'stopped')) parts.pop();
  if (parts.length > 1) return null;
  if (parts.length) out.last = parts[0];
  return out;
}

/** A time in the app's format: "45s", "2m 10s", "1h 5m". */
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** The row's task object from the app's React props ({ startedAt, durationMs, ... }; depth 1, seen live
 *  2026-11-05), or null. */
function rowTask(item) {
  const key = Object.keys(item).find((k) => k.startsWith('__reactFiber'));
  for (let f = key && item[key], d = 0; f && d < 4; f = f.return, d++) {
    const t = f.memoizedProps?.task;
    if (!t || typeof t.startedAt !== 'number') continue;
    // The node keeps the fiber it was made with; after a re-render the newer task can be on its alternate
    const other = f.alternate?.memoizedProps?.task;
    return other && (other.durationMs || 0) > (t.durationMs || 0) ? other : t;
  }
  return null;
}

/** Our meta line for a row, or null when the app's meta does not parse (then the app's stays visible).
 *  The app's time on a running row is its durationMs, moved on only when the helper reports a tool call,
 *  so a helper that thinks for minutes looks frozen. With the row's task, a running row counts from
 *  task.startedAt to `now`, and one whose last report (startedAt + durationMs) is over QUIET_MS old
 *  says "quiet for Nm" in place of what it was last doing. With the helper's log line `run`
 *  ({ model, effort }) its "Sonnet, medium" follows the kind in every state. */
function metaWords(meta, status, task = null, now = Date.now(), run = null) {
  const m = parseMeta(meta);
  if (!m) return null;
  const live = status === 'running' && task;
  const kind = kindWord(m.kind), model = runWords(run), elapsed = elapsedWords(live ? clock(now - task.startedAt) : m.elapsed), tools = toolsWords(m.tools);
  let parts;
  if (status === 'running') {
    // Only a sub-agent reports tool calls; a command's durationMs stays 0 (seen live 2026-11-05)
    const silent = live && m.kind === 'Sub-agent' ? now - (task.startedAt + (task.durationMs || 0)) : 0;
    const doing = silent > QUIET_MS ? fill(STRINGS.quiet, elapsedWords(`${Math.floor(silent / 60000)}m`)) : m.last && nowWords(m.last);
    parts = [kind, model, elapsed, tools, doing];
  }
  else if (status === 'completed') parts = [kind, model, STRINGS.doneWord, elapsed, tools];
  else if (status === 'failed') parts = [kind, model, STRINGS.failedWord, elapsed, tools];
  else if (status === 'stopped') parts = [kind, model, STRINGS.stoppedWord, elapsed, tools];
  else return null;
  return parts.filter(Boolean).join(' · ');
}

/** Header reading in words, with whether it is the "running" one. A failure stays named while others run. */
function countWords(c) {
  if (c.running) {
    const text = fill(STRINGS.running, c.running) + (c.failed ? ` · ${fill(STRINGS.failed, c.failed)}` : '');
    return { text, running: true };
  }
  if (c.failed) return { text: fill(STRINGS.failed, c.failed), running: false };
  if (c.stopped) return { text: fill(STRINGS.stopped, c.stopped), running: false };
  // only finished rows: the fold line already counts them
  return { text: STRINGS.idle, running: false };
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** The meta line as one no-wrap span per part, so a narrow sidebar wraps it between parts and never cuts a word off. */
function setMeta(node, words) {
  if (node.textContent === words) return;
  node.replaceChildren(...words.split(' · ').flatMap((part, i) => {
    const span = document.createElement('span');
    span.textContent = part;
    return i ? [' · ', span] : [span];
  }));
}

function decorateRow(item, run) {
  const body = item.querySelector(':scope > .flex-1');
  if (!body) return;
  const appNodes = [...body.children].filter((c) => !c.classList.contains('ap-title') && !c.classList.contains('ap-meta'));
  const original = appNodes[0];
  if (!original) return;

  const text = original.textContent;
  if (item.dataset.apSource !== text) {
    item.dataset.apSource = text;
    body.querySelector(':scope > .ap-title')?.remove();
    const title = plainTitle(text);
    if (title) {
      const node = document.createElement('div');
      node.className = 'ap-title';
      node.textContent = title;
      node.title = text.trim();
      body.append(node);
      item.dataset.apTitle = '1';
    } else {
      delete item.dataset.apTitle;
    }
  }

  const appMeta = appNodes[1]?.textContent ?? '';
  const running = item.dataset.status === 'running';
  const key = `${item.dataset.status}|${appMeta}|${runWords(run)}`;
  // A running row's time moves every second, so it is worked out on every pass
  if (!running && item.dataset.apMetaSource === key) return;
  item.dataset.apMetaSource = key;
  const words = appMeta ? metaWords(appMeta, item.dataset.status, running ? rowTask(item) : null, Date.now(), run) : null;
  let node = body.querySelector(':scope > .ap-meta');
  if (words === null) {
    node?.remove();
    delete item.dataset.apMeta;
    return;
  }
  if (!node) {
    node = document.createElement('div');
    node.className = 'ap-meta';
    body.append(node);
  }
  setMeta(node, words);
  item.dataset.apMeta = '1';
}

function updateList(scroller) {
  const items = [...scroller.querySelectorAll('.task-item')];
  if (!items.length) return;
  const counts = { running: 0, failed: 0, stopped: 0, completed: 0 };
  for (const item of items) if (item.dataset.status in counts) counts[item.dataset.status]++;
  const folded = isFolded() ? '1' : '0';
  if (scroller.dataset.apFolded !== folded) scroller.dataset.apFolded = folded;

  // 8px above the first row of a group that has another group above it
  let seen = false;
  for (const group of GROUPS) {
    let first = true;
    for (const item of items) {
      if (item.dataset.status !== group) continue;
      if (first && seen) item.dataset.apFirst = '';
      else delete item.dataset.apFirst;
      first = false;
    }
    if (!first) seen = true;
  }
  for (const item of items) if (!GROUPS.includes(item.dataset.status)) delete item.dataset.apFirst;

  let fold = scroller.querySelector(':scope > .ap-fold');
  if (!counts.completed) {
    fold?.remove();
  } else {
    if (!fold) {
      fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'ap-fold';
      fold.innerHTML = '<span class="material-symbols-outlined ap-fold-icon" aria-hidden="true">expand_more</span><span class="ap-fold-text"></span>';
      fold.onclick = () => {
        localStorage.setItem(FOLD_KEY, isFolded() ? '0' : '1');
        queue();
      };
      scroller.append(fold);
    }
    setText(fold.querySelector('.ap-fold-text'), fill(STRINGS.done, counts.completed));
    fold.setAttribute('aria-expanded', folded === '0' ? 'true' : 'false');
  }

  // Header: our reading in words replaces the app's N/M (only while the list is open and we can count)
  const header = scroller.previousElementSibling;
  if (header?.tagName === 'BUTTON' && header.querySelector(':scope > .ml-auto.font-mono')) {
    header.dataset.apHeader = '';
    let count = header.querySelector(':scope > .ap-count');
    if (!count) {
      count = document.createElement('span');
      count.className = 'ap-count';
      header.append(count);
    }
    const reading = countWords(counts);
    setText(count, reading.text);
    if (reading.running) count.dataset.apState = 'running';
    else delete count.dataset.apState;
  }
}

/** The app's own description text of a row (what the title is made from). */
function rowText(item) {
  const body = item.querySelector(':scope > .flex-1');
  const original = body && [...body.children].find((c) => !c.classList.contains('ap-title') && !c.classList.contains('ap-meta'));
  return original?.textContent ?? '';
}

/** Reads the run log when the set of rows has changed, and every 5 s while a row runs; a new reading redraws. */
function refreshRuns(items) {
  const key = items.map(rowText).join('\n');
  const running = items.some((i) => i.dataset.status === 'running');
  if (runsBusy || (key === runsKey && !(running && Date.now() - runsAt >= RUN_POLL_MS))) return;
  runsKey = key;
  runsAt = Date.now();
  runsBusy = true;
  readRuns().then((read) => {
    runsBusy = false;
    if (read) runs = read;
    if (observer) queue();
  });
}

function sync() {
  pending = false;
  try {
    const scrollers = new Set();
    const items = [...document.querySelectorAll('.teammate-panel .task-item')];
    if (items.length) refreshRuns(items);
    const matched = matchRun(items.map(rowText), runs);
    for (const [n, item] of items.entries()) {
      decorateRow(item, matched[n]);
      const scroller = item.closest('.overflow-y-auto');
      if (scroller) scrollers.add(scroller);
    }
    for (const scroller of scrollers) updateList(scroller);
    // A collapsed list has no rows to count: give the header back to the app's N/M
    for (const header of document.querySelectorAll('.teammate-panel [data-ap-header]')) {
      if (scrollers.has(header.nextElementSibling)) continue;
      header.querySelector(':scope > .ap-count')?.remove();
      delete header.dataset.apHeader;
    }
  } catch (e) {
    console.error('[agents-panel] could not update the agents list:', e);
  }
}

function queue() {
  if (pending) return;
  pending = true;
  frame = requestAnimationFrame(sync);
}

function removeAll() {
  document.querySelectorAll('.ap-fold, .ap-title, .ap-meta, .ap-count').forEach((n) => n.remove());
  document.querySelectorAll('[data-ap-folded], [data-ap-title], [data-ap-source], [data-ap-meta], [data-ap-meta-source], [data-ap-first], [data-ap-header]').forEach((n) => {
    delete n.dataset.apFolded;
    delete n.dataset.apTitle;
    delete n.dataset.apSource;
    delete n.dataset.apMeta;
    delete n.dataset.apMetaSource;
    delete n.dataset.apFirst;
    delete n.dataset.apHeader;
  });
}

function activate() {
  if (observer) return;
  // One copy per window: a test copy injected by hand takes over from the installed one
  if (window.__agentsPanel && window.__agentsPanel.deactivate !== deactivate) {
    window.__agentsPanel.deactivate();
  }
  window.__agentsPanel = { deactivate };
  observer = new MutationObserver(queue);
  observer.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['data-status'] });
  // Running rows' time, once a second while any row runs
  ticker = setInterval(() => {
    if (document.querySelector('.teammate-panel .task-item[data-status="running"]')) queue();
  }, 1000);
  queue();
}

function deactivate() {
  observer?.disconnect();
  observer = undefined;
  clearInterval(ticker);
  ticker = undefined;
  cancelAnimationFrame(frame);
  pending = false;
  removeAll();
}

export { activate, deactivate, plainTitle, nowWords, parseMeta, metaWords, countWords, clock, rowTask, modelWords, effortWords, runWords, matchRun, parseRuns, STRINGS };
