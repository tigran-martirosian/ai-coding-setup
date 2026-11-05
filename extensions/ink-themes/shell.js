// Ink themes: the parts of the mockup that Nimbalyst does not have, added to its window.
//   - a "New session" button and a Sessions / Files / Tracker switch (tabs) at the top of the side panel
//   - the project name for the empty chat heading, and the fold of the theme menu
//   - a close button on the agent view's right pane, which has none of its own
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

const LABELS = { 'new session': 'New session', 'new file': 'New file' };

/** The button's label from the app's aria-label: the two known ones in sentence case, anything else as the app says it. */
function labelFor(appLabel) {
  const label = (appLabel ?? '').trim();
  if (!label) throw new Error('the top-bar create button has no label');
  return LABELS[label.toLowerCase()] ?? label;
}

function createLabel() {
  return labelFor(document.querySelector('.window-top-bar__create-primary')?.getAttribute('aria-label'));
}

/** Write only when it differs, so the observer is not woken by our own writes. */
function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}
function setAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** The button and the tabs, inside the side panel's header (project name and path). */
function buildTop() {
  const top = el('div', 'ink-top');
  if (document.querySelector('.window-top-bar__create-primary')) {
    // Pressing it presses the app's top-bar create button, whose label follows the mode
    // (New session, New file, ...); sync() keeps this label the same as that one.
    const add = el('button', 'ink-new');
    const icon = el('span', 'material-symbols-outlined ink-sym', 'add');
    icon.setAttribute('aria-hidden', 'true');
    add.append(icon, el('span', 'ink-new-label', createLabel()));
    add.type = 'button';
    add.onclick = () => document.querySelector('.window-top-bar__create-primary')?.click();
    top.append(add);
  }
  const seg = el('div', 'ink-seg');
  seg.setAttribute('role', 'tablist');
  seg.setAttribute('aria-label', 'Sidebar view');
  for (const [label, testId] of MODES) {
    if (!byTest(testId)) continue;
    const b = el('button', 'ink-seg-btn', label);
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.mode = testId;
    b.onclick = () => {
      const real = byTest(testId);
      if (real && !real.classList.contains('active')) real.click();
    };
    b.onkeydown = (e) => {
      const tabs = [...seg.children];
      const at = tabs.indexOf(b);
      const target = { ArrowRight: at + 1, ArrowLeft: at - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (target === undefined) return;
      const next = tabs[(target + tabs.length) % tabs.length];
      e.preventDefault();
      next.focus();
      next.click();
    };
    seg.append(b);
  }
  if (seg.children.length) top.append(seg);
  return top;
}

/**
 * The app's theme menu lists every theme in one column. This extension's themes (all named "Ink ...")
 * fold into one "Ink themes" row there; a press on the row opens and closes them. It is done whichever
 * theme is on, since the long list is there either way. The menu is built anew each time it opens, so
 * it always starts folded.
 */
const isInk = (item) => /^Ink\s/.test(item.querySelector('.theme-name')?.textContent || '');
let foldOpen = false;

function foldMenu() {
  const menu = document.querySelector('.theme-menu');
  if (!menu) { foldOpen = false; return; }
  const items = [...menu.querySelectorAll('.theme-menu-item:not(.ink-fold)')].filter(isInk);
  let row = menu.querySelector('.ink-fold');
  if (items.length < 2) return row?.remove();
  if (!row) {
    // A copy of one of the app's own rows, so it looks right in every theme
    row = items[0].cloneNode(true);
    const name = row.querySelector('.theme-name');
    const icon = row.querySelector('.theme-icon > *');
    if (!name || !icon) return;
    while (name.nextSibling) name.nextSibling.remove();
    row.classList.add('ink-fold');
    row.tabIndex = 0;
    row.setAttribute('role', 'button');
    name.textContent = 'Ink themes';
    const arrow = icon.cloneNode(false);
    arrow.classList.add('ink-fold-arrow');
    arrow.setAttribute('aria-hidden', 'true');
    row.append(arrow);
    const toggle = (e) => {
      e.stopPropagation();
      foldOpen = !foldOpen;
      foldMenu();
    };
    row.onclick = toggle;
    row.onkeydown = (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(e); }
    };
    items[0].before(row);
  }
  const arrow = foldOpen ? 'expand_less' : 'expand_more';
  const mark = row.querySelector('.ink-fold-arrow');
  if (mark.textContent !== arrow) mark.textContent = arrow;
  row.setAttribute('aria-expanded', String(foldOpen));
  // The app puts a tick after the name of the theme that is on; the row names it while it is folded away
  const on = items.find((item) => item.querySelector('.theme-name')?.nextElementSibling);
  const label = on ? `Ink themes · ${on.querySelector('.theme-name').textContent.replace(/^Ink\s/, '')}` : 'Ink themes';
  const name = row.querySelector('.theme-name');
  if (name.textContent !== label) name.textContent = label;
  for (const item of items) {
    const display = foldOpen ? '' : 'none';
    if (item.style.display !== display) item.style.display = display;
    if (item.style.paddingLeft !== '24px') item.style.paddingLeft = '24px';
  }
}

/**
 * The app closes its theme menu on every pick, so trying themes one after another meant reopening it each
 * time. After a pick the menu opens again, with the Ink fold as it was; a click outside or Escape still closes it.
 */
function keepMenuOpen(e) {
  const item = e.target instanceof Element ? e.target.closest(".theme-menu-item") : null;
  if (!item || item.classList.contains("ink-fold")) return;
  const fold = foldOpen;
  setTimeout(() => {
    if (document.querySelector(".theme-menu")) return;
    const button = byTest("gutter-theme-button");
    if (!button) return;
    button.click();
    // React draws the menu during the click; the fold state is set after it, since a sync with no menu resets it
    foldOpen = fold;
    queue();
  }, 60);
}

function unfoldMenu() {
  document.querySelectorAll('.ink-fold').forEach((n) => n.remove());
  for (const item of document.querySelectorAll('.theme-menu-item')) {
    item.style.display = '';
    item.style.paddingLeft = '';
  }
}

/**
 * The agent view's right pane (edited files, review, chat, or the file viewer with no file open) has no close
 * button; the app closes it only by Ctrl+Shift+A or a top-bar toggle that is not always drawn. The close button
 * calls the app's own toggle, found on the agent view's ref (the same one the hotkey reaches).
 */
function paneToggle(from) {
  const key = Object.keys(from).find((k) => k.startsWith('__reactFiber'));
  for (let f = key && from[key]; f; f = f.return) {
    const handle = f.ref?.current;
    if (typeof handle?.toggleRightPanel === 'function') return () => handle.toggleRightPanel();
  }
  return null;
}

/** The header row of each open right pane: the file viewer's heading, else the first row of the pane's content. */
function paneHeaders() {
  const rows = [...document.querySelectorAll('.workstream-file-viewer-heading')];
  for (const pane of document.querySelectorAll('.agent-workstream-right-panel')) {
    const row = pane.firstElementChild?.firstElementChild;
    if (row && pane.offsetParent !== null) rows.push(row);
  }
  return rows.filter((row) => row.offsetParent !== null);
}

let toggleMissingSaid = false;

function addCloseButtons() {
  for (const row of paneHeaders()) {
    if (row.querySelector(':scope > .ink-close-pane')) continue;
    const toggle = paneToggle(row);
    if (!toggle) {
      if (!toggleMissingSaid) console.error('[ink-themes] the right pane has no close: the app\'s toggleRightPanel was not found');
      toggleMissingSaid = true;
      continue;
    }
    const close = el('button', 'ink-close-pane');
    const icon = el('span', 'material-symbols-outlined ink-sym', 'close');
    icon.setAttribute('aria-hidden', 'true');
    close.append(icon);
    close.type = 'button';
    close.title = 'Close panel (Ctrl+Shift+A)';
    close.setAttribute('aria-label', 'Close panel');
    close.onclick = toggle;
    row.append(close);
  }
}

function removeAll() {
  document.querySelectorAll('.ink-top, .ink-close-pane').forEach((n) => n.remove());
  document.querySelectorAll('[data-ink-project]').forEach((n) => n.removeAttribute('data-ink-project'));
  document.documentElement.classList.remove('ink-shell');
}

/** The project's name: the visible sidebar header's, else the top bar's. */
function projectName() {
  const visible = [...document.querySelectorAll('.workspace-summary-header-name')].find((n) => n.offsetParent !== null);
  return (visible ?? document.querySelector('.window-top-bar__workspace-name'))?.textContent.trim() ?? '';
}

function sync() {
  foldMenu();
  if (!themeOn()) return removeAll();

  for (const header of document.querySelectorAll('.workspace-summary-header')) {
    if (!header.querySelector(':scope > .ink-top')) header.append(buildTop());
  }

  for (const seg of document.querySelectorAll('.ink-seg')) {
    const tabs = [...seg.querySelectorAll('.ink-seg-btn')];
    const active = tabs.map((b) => !!byTest(b.dataset.mode)?.classList.contains('active'));
    // With no active mode the first tab stays reachable by keyboard
    const focusable = active.includes(true) ? active.indexOf(true) : 0;
    tabs.forEach((b, i) => {
      setAttr(b, 'aria-selected', String(active[i]));
      setAttr(b, 'tabindex', i === focusable ? '0' : '-1');
    });
  }
  const news = document.querySelectorAll('.ink-new');
  if (news.length) {
    const label = createLabel();
    for (const b of news) setText(b.querySelector('.ink-new-label'), label);
  }
  // The empty chat's heading is the project name; the style sheet draws it from this attribute
  const project = projectName();
  for (const empty of document.querySelectorAll('.rich-transcript-empty-extras')) {
    if (empty.dataset.inkProject !== project) empty.dataset.inkProject = project;
  }

  addCloseButtons();

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
  // Text edits count only inside the project name (a project switch rewrites it); other text, such as a streaming reply, does not wake the shell.
  observer = new MutationObserver((mutations) => {
    if (mutations.some((m) => m.type !== 'characterData' || m.target.parentElement?.closest('.workspace-summary-header-name, .window-top-bar__workspace-name'))) queue();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'data-theme'] });
  timer = setInterval(queue, 30_000);
  document.addEventListener("click", keepMenuOpen, true);
  queue();
}

function deactivate() {
  observer?.disconnect();
  observer = undefined;
  clearInterval(timer);
  document.removeEventListener("click", keepMenuOpen, true);
  removeAll();
  unfoldMenu();
}

export { activate, deactivate, labelFor };
