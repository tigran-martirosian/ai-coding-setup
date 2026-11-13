// Agents Panel: makes Nimbalyst's "Agents & commands" list (.teammate-panel) readable.
//   - running items on top (style.css, from the app's own data-status)
//   - finished items folded behind a "N finished" line at the bottom of the list (open/closed is remembered)
//   - each row titled in plain words: the "# WHAT THIS DOES:" line of a shell command, else its first
//     line; the full text stays in the tooltip
// React owns the rows and rewrites their class names, so this only adds data-ap-* attributes and
// its own .ap-* elements, never changes the app's ones. Styles are in style.css.

const DONE = new Set(['completed', 'failed', 'stopped']);
const FOLD_KEY = 'agentsPanel.folded';
const EXPLAIN = /#\s*WHAT THIS DOES:\s*([\s\S]+)$/i;

let observer;
let pending = false;

const isFolded = () => localStorage.getItem(FOLD_KEY) !== '0';

/** Plain title for a task description, or null when the description is already short and plain. */
function plainTitle(text) {
  const explained = text.match(EXPLAIN);
  if (explained) return explained[1].trim().replace(/\s+/g, ' ');
  const lines = text.trim().split('\n');
  if (lines.length > 1 || text.length > 120) return lines[0].trim();
  return null;
}

function titleRow(item) {
  const body = item.querySelector(':scope > .flex-1');
  const original = body?.firstElementChild;
  if (!original || original.classList.contains('ap-title')) return;
  const text = original.textContent;
  if (item.dataset.apSource === text) return;
  item.dataset.apSource = text;
  body.querySelector(':scope > .ap-title')?.remove();
  const title = plainTitle(text);
  if (!title) {
    delete item.dataset.apTitle;
    return;
  }
  const node = document.createElement('div');
  node.className = 'ap-title';
  node.textContent = title;
  node.title = text.trim();
  body.append(node);
  item.dataset.apTitle = '1';
}

function foldList(scroller) {
  const items = [...scroller.querySelectorAll('.task-item')];
  if (!items.length) return;
  const done = items.filter((i) => DONE.has(i.dataset.status)).length;
  const folded = isFolded() ? '1' : '0';
  if (scroller.dataset.apFolded !== folded) scroller.dataset.apFolded = folded;

  let fold = scroller.querySelector(':scope > .ap-fold');
  if (!done) {
    fold?.remove();
  } else {
    if (!fold) {
      fold = document.createElement('button');
      fold.type = 'button';
      fold.className = 'ap-fold';
      fold.innerHTML = '<span class="ap-fold-arrow" aria-hidden="true">▸</span><span class="ap-fold-text"></span>';
      fold.onclick = () => {
        localStorage.setItem(FOLD_KEY, isFolded() ? '0' : '1');
        queue();
      };
      scroller.append(fold);
    }
    const label = `${done} finished`;
    const text = fold.querySelector('.ap-fold-text');
    if (text.textContent !== label) text.textContent = label;
    fold.setAttribute('aria-expanded', folded === '0' ? 'true' : 'false');
  }

  // When everything is finished and folded, say so instead of showing an empty box
  const nothingRunning = done === items.length && folded === '1';
  let empty = scroller.querySelector(':scope > .ap-empty');
  if (nothingRunning && !empty) {
    empty = document.createElement('div');
    empty.className = 'ap-empty';
    empty.textContent = 'Nothing running';
    scroller.prepend(empty);
  } else if (!nothingRunning && empty) {
    empty.remove();
  }
}

function sync() {
  pending = false;
  try {
    for (const item of document.querySelectorAll('.teammate-panel .task-item')) titleRow(item);
    const scrollers = new Set();
    for (const item of document.querySelectorAll('.teammate-panel .task-item')) {
      const scroller = item.closest('.overflow-y-auto');
      if (scroller) scrollers.add(scroller);
    }
    for (const scroller of scrollers) foldList(scroller);
  } catch (e) {
    console.error('[agents-panel] could not update the agents list:', e);
  }
}

function queue() {
  if (pending) return;
  pending = true;
  requestAnimationFrame(sync);
}

function removeAll() {
  document.querySelectorAll('.ap-fold, .ap-empty, .ap-title').forEach((n) => n.remove());
  document.querySelectorAll('[data-ap-folded]').forEach((n) => delete n.dataset.apFolded);
  document.querySelectorAll('[data-ap-title], [data-ap-source]').forEach((n) => {
    delete n.dataset.apTitle;
    delete n.dataset.apSource;
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
  queue();
}

function deactivate() {
  observer?.disconnect();
  observer = undefined;
  removeAll();
}

export { activate, deactivate };
