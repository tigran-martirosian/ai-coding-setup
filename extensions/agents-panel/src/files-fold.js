// The right panel's file list and commit box, folded so "Agents & commands" gets the room (right-panel design 2-3,
// picks L1 and C2):
//   - the app's uncommitted list (.file-edits-sidebar__files) folds behind one summary line, "340 files in 9 folders",
//     under it the three biggest top folders and how many more ("audits 31 · docs 14 · tools 9 · 6 more folders").
//     The counts are the app's own (each top folder's __directory-count counts every file under it). Open or folded
//     is remembered; the app's Expand all / Collapse all are hidden while folded (style.css). Opened, the list leaves
//     at least half the column to the agents block (style.css).
//   - the commit box is folded to its branch line by pressing the app's own header once per mount (the app starts it
//     open every time); a user's open or close is remembered, so a redraw does not undo it. "Commit" in muted grey
//     follows the branch while folded.
// React owns the panel and may redraw it, so index.js calls syncFiles() on every change (its MutationObserver). A part
// the app should have and has not is logged once and left as the app draws it.
// build.mjs inlines this file into dist/index.js, so it must not import anything.

const FILES_KEY = "agentsPanel.filesOpen";
const COMMIT_KEY = "agentsPanel.commitOpen";
const TOP_FOLDERS = 3;

const missed = new Set();
let onToggle;

const plural = (forms, n) =>
  (n === 1 ? forms.one : forms.many).replace("{n}", String(n));

/** The summary line of the folded list. `folders` are the top folders in the app's order ({name, count}), `loose`
 *  the files outside any folder. The biggest folders come first; equal ones keep the app's order. */
function filesSummary(folders, loose, strings) {
  const total = folders.reduce((sum, f) => sum + f.count, 0) + loose;
  const files = plural(strings.files, total);
  const title = folders.length
    ? strings.filesLine
        .replace("{files}", files)
        .replace("{folders}", plural(strings.folders, folders.length))
    : files;
  const top = folders
    .map((f, i) => ({ ...f, i }))
    .sort((a, b) => b.count - a.count || a.i - b.i)
    .slice(0, TOP_FOLDERS);
  const parts = top.map((f) => `${f.name} ${f.count}`);
  const more = folders.length - top.length;
  if (more) parts.push(plural(strings.moreFolders, more));
  return { title, detail: parts.join(" · "), total };
}

/** Open or folded, kept in `storage` under `key` ("1" open, anything else folded: folded is the default). */
function createFold(storage, key) {
  const isOpen = () => storage.getItem(key) === "1";
  const setOpen = (open) => storage.setItem(key, open ? "1" : "0");
  return { isOpen, setOpen, toggle: () => setOpen(!isOpen()) };
}

/** Logs a missing part once per window, with what is left undone. */
function missing(what) {
  if (missed.has(what)) return;
  missed.add(what);
  console.error(
    `[agents-panel] ${what} not found: the app's markup has changed, so it is left as the app draws it`,
  );
}

function foldText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

function foldAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

const DIR = ".file-edits-sidebar__directory-node";
const parentDir = (node) => node.parentElement?.closest(DIR) ?? null;
const dirHeader = (node) =>
  node.querySelector(":scope > .file-edits-sidebar__directory-header");

/** The app draws a tree of several folders from a root folder node with no header (its own files are the loose
 *  ones); a tree of one folder starts at that folder. */
const isRootDir = (node) => !parentDir(node) && !dirHeader(node);

/** The top folders of the app's list ({name, count}) and the files outside any folder; null when a folder row lacks
 *  its name or count. A top folder sits right in the list or right in the root node. */
function readFolders(list) {
  const folders = [];
  for (const node of list.querySelectorAll(DIR)) {
    const parent = parentDir(node);
    if (isRootDir(node) || (parent && !isRootDir(parent))) continue;
    const header = dirHeader(node);
    const name = header?.querySelector(".file-edits-sidebar__directory-path");
    const count = header
      ?.querySelector(".file-edits-sidebar__directory-count")
      ?.textContent.match(/\d+/);
    if (!name || !count) {
      missing(
        "a folder's name or file count (.file-edits-sidebar__directory-path, __directory-count)",
      );
      return null;
    }
    folders.push({ name: name.textContent.trim(), count: Number(count[0]) });
  }
  const loose = [...list.querySelectorAll(".file-edits-sidebar__file")].filter(
    (f) => {
      const dir = f.closest(DIR);
      return !dir || isRootDir(dir);
    },
  ).length;
  return { folders, loose };
}

/** The uncommitted list: our summary line right above the app's list, the fold state on the panel for style.css. */
function syncList(sidebar, strings) {
  const content = sidebar.querySelector(
    ":scope > .files-edited-sidebar__content",
  );
  if (!content)
    return missing("the file list's box (.files-edited-sidebar__content)");
  const list = content.querySelector(".file-edits-sidebar__files");
  let line = content.querySelector(".ap-files");
  if (!list) {
    // The app's own empty state stays as it is
    if (!content.querySelector(".file-edits-sidebar__empty"))
      missing("the uncommitted list (.file-edits-sidebar__files)");
    line?.remove();
    delete sidebar.dataset.apFiles;
    return;
  }
  const read = readFolders(list);
  if (!read) {
    line?.remove();
    delete sidebar.dataset.apFiles;
    return;
  }
  const fold = createFold(localStorage, FILES_KEY);
  const open = fold.isOpen();
  if (!line) {
    line = document.createElement("button");
    line.type = "button";
    line.className = "ap-files";
    line.innerHTML =
      '<span class="material-symbols-outlined ap-files-icon" aria-hidden="true">expand_more</span><span class="ap-files-main"><span class="ap-files-title"></span><span class="ap-files-detail"></span></span>';
    line.onclick = () => {
      fold.toggle();
      onToggle?.();
    };
  }
  // React may put a redrawn list elsewhere: the line always sits right above it
  if (line.nextElementSibling !== list) list.before(line);
  const summary = filesSummary(read.folders, read.loose, strings);
  foldText(line.querySelector(".ap-files-title"), summary.title);
  foldText(line.querySelector(".ap-files-detail"), summary.detail);
  foldAttr(line, "aria-expanded", String(open));
  foldAttr(line, "title", open ? strings.filesFold : strings.filesOpen);
  const state = open ? "open" : "folded";
  if (sidebar.dataset.apFiles !== state) sidebar.dataset.apFiles = state;
}

/** The commit box: pressed folded once per mount unless the user last left it open; "Commit" after the branch. */
function syncCommit(sidebar, strings) {
  const panel = sidebar.querySelector(":scope > .git-operations-panel");
  // No commit box: the app draws none outside a git repository
  if (!panel) return;
  const left = panel.querySelector(".git-operations-panel__header-left");
  if (!left)
    return missing(
      "the commit box's header (.git-operations-panel__header-left)",
    );
  if (!panel.dataset.apCommit) {
    panel.dataset.apCommit = "seen";
    const open = !!panel.querySelector(
      ":scope > .git-operations-panel__content",
    );
    if (open && !createFold(localStorage, COMMIT_KEY).isOpen()) left.click();
  }
  let word = left.querySelector(":scope > .ap-commit");
  if (!word) {
    word = document.createElement("span");
    word.className = "ap-commit";
  }
  if (left.lastElementChild !== word) left.append(word);
  foldText(word, strings.commit);
}

/** A user's own click on the commit box's header (not ours: isTrusted) is remembered as open or folded. The capture
 *  listener runs before the app's, so the box's content still shows the state before the click. */
function onCommitClick(event) {
  const left =
    event.isTrusted &&
    event.target.closest?.(".git-operations-panel__header-left");
  if (!left) return;
  const panel = left.closest(".git-operations-panel");
  const wasOpen = !!panel.querySelector(
    ":scope > .git-operations-panel__content",
  );
  createFold(localStorage, COMMIT_KEY).setOpen(!wasOpen);
}

function syncFiles(strings) {
  for (const sidebar of document.querySelectorAll(".files-edited-sidebar")) {
    syncList(sidebar, strings);
    syncCommit(sidebar, strings);
  }
}

/** `changed` redraws after our own summary line is clicked. */
function startFilesFold(changed) {
  onToggle = changed;
  document.addEventListener("click", onCommitClick, true);
}

function stopFilesFold() {
  document.removeEventListener("click", onCommitClick, true);
  onToggle = undefined;
  document.querySelectorAll(".ap-files, .ap-commit").forEach((n) => n.remove());
  document
    .querySelectorAll("[data-ap-files], [data-ap-commit]")
    .forEach((n) => {
      delete n.dataset.apFiles;
      delete n.dataset.apCommit;
    });
}

export {
  createFold,
  filesSummary,
  readFolders,
  startFilesFold,
  stopFilesFold,
  syncFiles,
};
