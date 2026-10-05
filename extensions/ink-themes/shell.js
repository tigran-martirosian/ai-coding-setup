// Ink themes: the parts of the mockup that Nimbalyst does not have, added to its window.
//   - a "New session" button and a Sessions / Files / Tracker switch at the top of the side panel
//   - usage bars (this week, 5-hour window) at the bottom of the sessions panel
// Nothing of the app's own is changed or removed: every part presses or reads one of the app's own
// buttons. If the app renames one, that part simply does not appear and the app's button stays.
// Styles are in theme.src.css (.ink-*).

const MODES = [
  ['Sessions', 'agent-mode-button'],
  ['Files', 'files-mode-button'],
  ['Tracker', 'tracker-mode-button'],
];
const byTest = (id) => document.querySelector(`[data-testid="${id}"]`);
// The style sheet sets --ink-sans only while one of the themes is on (see theme.src.css)
const themeOn = () => getComputedStyle(document.documentElement).getPropertyValue('--ink-sans').trim() !== '';

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** The button and the switch, inside the side panel's header (project name and path). */
function buildTop() {
  const top = el('div', 'ink-top');
  if (document.querySelector('.window-top-bar__create-primary')) {
    const add = el('button', 'ink-new', '+  New session');
    add.type = 'button';
    add.onclick = () => document.querySelector('.window-top-bar__create-primary')?.click();
    top.append(add);
  }
  const seg = el('div', 'ink-seg');
  for (const [label, testId] of MODES) {
    if (!byTest(testId)) continue;
    const b = el('button', 'ink-seg-btn', label);
    b.type = 'button';
    b.dataset.mode = testId;
    b.onclick = () => {
      const real = byTest(testId);
      if (real && !real.classList.contains('active')) real.click();
    };
    seg.append(b);
  }
  if (seg.children.length) top.append(seg);
  return top;
}

function buildUsage() {
  const box = el('div', 'ink-usage');
  for (const [key, label] of [['week', 'This week'], ['five', '5-hour window']]) {
    const row = el('div', 'ink-usage-row');
    row.dataset.key = key;
    const head = el('div', 'ink-usage-head');
    head.append(el('span', '', label), el('b', 'ink-usage-pct'));
    const bar = el('div', 'ink-usage-bar');
    bar.append(el('i', 'ink-usage-fill'));
    row.append(head, bar);
    box.append(row);
  }
  return box;
}

/** The numbers the app's own side buttons already show: the Plan ring (week) and the Claude ring (5 hours). */
function readUsage() {
  const week = document.getElementById('usage-plan-gutter-ring')?.textContent.match(/content: "(\d+)%"/);
  const five = byTest('claude-usage-indicator')?.getAttribute('title')?.match(/Session: (\d+)%/);
  return { week: week ? Number(week[1]) : null, five: five ? Number(five[1]) : null };
}

function paintUsage(box) {
  const usage = readUsage();
  let shown = 0;
  for (const row of box.children) {
    const value = usage[row.dataset.key];
    row.hidden = value === null;
    if (value === null) continue;
    shown++;
    const text = `${value}%`;
    const pct = row.querySelector('.ink-usage-pct');
    if (pct.textContent !== text) {
      pct.textContent = text;
      row.querySelector('.ink-usage-fill').style.width = `${Math.min(100, value)}%`;
      row.dataset.tone = value >= 90 ? 'error' : value >= 70 ? 'warning' : 'ok';
    }
  }
  box.hidden = shown === 0;
}

function removeAll() {
  document.querySelectorAll('.ink-top, .ink-usage').forEach((n) => n.remove());
  document.documentElement.classList.remove('ink-shell');
}

function sync() {
  if (!themeOn()) return removeAll();

  for (const header of document.querySelectorAll('.workspace-summary-header')) {
    if (!header.querySelector(':scope > .ink-top')) header.append(buildTop());
  }
  for (const panel of document.querySelectorAll('.session-history')) {
    if (!panel.querySelector(':scope > .ink-usage')) panel.append(buildUsage());
  }

  for (const b of document.querySelectorAll('.ink-seg-btn')) {
    const on = !!byTest(b.dataset.mode)?.classList.contains('active');
    if (b.classList.contains('on') !== on) b.classList.toggle('on', on);
  }
  document.querySelectorAll('.ink-usage').forEach(paintUsage);

  // The three side icons are hidden only while a switch is really on screen, so there is always a way to change mode.
  const switchVisible = [...document.querySelectorAll('.ink-seg')].some((s) => s.offsetParent !== null);
  document.documentElement.classList.toggle('ink-shell', switchVisible);
}

let observer;
let timer;
let queued = false;
const queue = () => {
  if (queued) return;
  queued = true;
  requestAnimationFrame(() => {
    queued = false;
    try {
      sync();
    } catch (e) {
      console.error('[ink-themes] could not add the side panel parts:', e);
    }
  });
};

function activate() {
  if (observer) return;
  // Only one copy runs per window: a preview copy takes over from the installed one (see build.mjs --preview).
  if (window.__inkShell && window.__inkShell.deactivate !== deactivate) {
    window.__inkShell.deactivate();
    removeAll();
  }
  window.__inkShell = { deactivate };
  observer = new MutationObserver(queue);
  observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'data-theme', 'title'] });
  timer = setInterval(queue, 30_000);
  queue();
}

function deactivate() {
  observer?.disconnect();
  observer = undefined;
  clearInterval(timer);
  removeAll();
}

export { activate, deactivate };
