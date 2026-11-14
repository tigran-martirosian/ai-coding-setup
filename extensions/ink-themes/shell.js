// Ink themes: the parts of the mockup that Nimbalyst does not have, added to its window.
//   - a "New session" button and a Sessions / Files / Tracker switch (tabs) at the top of the side panel
//   - the project name for the empty chat heading, and the fold of the theme menu
//   - a close button on the agent view's right pane, which has none of its own (on Review, Chat or the file
//     viewer it goes back to the files view first)
//   - in the right panel's menu: each view marked for its description line, and a hide row with the app's shortcut
//   - the uncommitted file count on the git button, from the app's own file list
//   - once per project, the session list dragged from the app's 240 default to 320 with the app's own handle
//   - the listening orb in the gutter's "Needs you" cell, and each usage ring's percentage for its "53% used" line
// Nothing of the app's own is changed or removed: every part presses or reads one of the app's own
// buttons. If the app renames one, that part simply does not appear and the app's button stays.
// Styles are in theme.src.css (.ink-*).

const MODES = [
  ["Sessions", "agent-mode-button"],
  ["Files", "files-mode-button"],
  ["Tracker", "tracker-mode-button"],
];
const byTest = (id) => document.querySelector(`[data-testid="${id}"]`);
// The style sheet sets --ink-sans only while one of the themes is on (see theme.src.css)
const themeOn = () =>
  getComputedStyle(document.documentElement)
    .getPropertyValue("--ink-sans")
    .trim() !== "";

function el(tag, className, text) {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  return node;
}

const LABELS = { "new session": "New session", "new file": "New file" };

/** The button's label from the app's aria-label: the two known ones in sentence case, anything else as the app says it. */
function labelFor(appLabel) {
  const label = (appLabel ?? "").trim();
  if (!label) throw new Error("the top-bar create button has no label");
  return LABELS[label.toLowerCase()] ?? label;
}

function createLabel() {
  return labelFor(
    document
      .querySelector(".window-top-bar__create-primary")
      ?.getAttribute("aria-label"),
  );
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
  const top = el("div", "ink-top");
  if (document.querySelector(".window-top-bar__create-primary")) {
    // Pressing it presses the app's top-bar create button, whose label follows the mode
    // (New session, New file, ...); sync() keeps this label the same as that one.
    const add = el("button", "ink-new");
    const icon = el("span", "material-symbols-outlined ink-sym", "add");
    icon.setAttribute("aria-hidden", "true");
    add.append(icon, el("span", "ink-new-label", createLabel()));
    add.type = "button";
    add.onclick = () =>
      document.querySelector(".window-top-bar__create-primary")?.click();
    top.append(add);
  }
  const seg = el("div", "ink-seg");
  seg.setAttribute("role", "tablist");
  seg.setAttribute("aria-label", "Sidebar view");
  for (const [label, testId] of MODES) {
    if (!byTest(testId)) continue;
    const b = el("button", "ink-seg-btn", label);
    b.type = "button";
    b.setAttribute("role", "tab");
    b.dataset.mode = testId;
    b.onclick = () => {
      const real = byTest(testId);
      if (real && !real.classList.contains("active")) real.click();
    };
    b.onkeydown = (e) => {
      const tabs = [...seg.children];
      const at = tabs.indexOf(b);
      const target = {
        ArrowRight: at + 1,
        ArrowLeft: at - 1,
        Home: 0,
        End: tabs.length - 1,
      }[e.key];
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
const isInk = (item) =>
  /^Ink\s/.test(item.querySelector(".theme-name")?.textContent || "");
let foldOpen = false;

function foldMenu() {
  const menu = document.querySelector(".theme-menu");
  if (!menu) {
    foldOpen = false;
    return;
  }
  const items = [
    ...menu.querySelectorAll(".theme-menu-item:not(.ink-fold)"),
  ].filter(isInk);
  let row = menu.querySelector(".ink-fold");
  if (items.length < 2) return row?.remove();
  if (!row) {
    // A copy of one of the app's own rows, so it looks right in every theme
    row = items[0].cloneNode(true);
    const name = row.querySelector(".theme-name");
    const icon = row.querySelector(".theme-icon > *");
    if (!name || !icon) return;
    while (name.nextSibling) name.nextSibling.remove();
    row.classList.add("ink-fold");
    row.tabIndex = 0;
    row.setAttribute("role", "button");
    name.textContent = "Ink themes";
    const arrow = icon.cloneNode(false);
    arrow.classList.add("ink-fold-arrow");
    arrow.setAttribute("aria-hidden", "true");
    row.append(arrow);
    const toggle = (e) => {
      e.stopPropagation();
      foldOpen = !foldOpen;
      foldMenu();
    };
    row.onclick = toggle;
    row.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggle(e);
      }
    };
    items[0].before(row);
  }
  const arrow = foldOpen ? "expand_less" : "expand_more";
  const mark = row.querySelector(".ink-fold-arrow");
  if (mark.textContent !== arrow) mark.textContent = arrow;
  row.setAttribute("aria-expanded", String(foldOpen));
  // The app puts a tick after the name of the theme that is on; the row names it while it is folded away
  const on = items.find(
    (item) => item.querySelector(".theme-name")?.nextElementSibling,
  );
  const label = on
    ? `Ink themes · ${on.querySelector(".theme-name").textContent.replace(/^Ink\s/, "")}`
    : "Ink themes";
  const name = row.querySelector(".theme-name");
  if (name.textContent !== label) name.textContent = label;
  for (const item of items) {
    const display = foldOpen ? "" : "none";
    if (item.style.display !== display) item.style.display = display;
    if (item.style.paddingLeft !== "24px") item.style.paddingLeft = "24px";
  }
}

/**
 * The app closes its theme menu on every pick, so trying themes one after another meant reopening it each
 * time. After a pick the menu opens again, with the Ink fold as it was; a click outside or Escape still closes it.
 */
function keepMenuOpen(e) {
  const item =
    e.target instanceof Element ? e.target.closest(".theme-menu-item") : null;
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
  document.querySelectorAll(".ink-fold").forEach((n) => n.remove());
  for (const item of document.querySelectorAll(".theme-menu-item")) {
    item.style.display = "";
    item.style.paddingLeft = "";
  }
}

/**
 * The agent view's right pane (edited files, review, chat, or the file viewer with no file open) has no close
 * button; the app closes it only by Ctrl+Shift+A or a top-bar toggle that is not always drawn. The close button
 * calls the app's own toggle, found on the agent view's ref (the same one the hotkey reaches). On Review, Chat
 * with Session or the file viewer it goes back to the files view instead (the app's own showRightPanel, as its
 * mode menu does), since the panel toggle already closes the pane; only on the files view does it close.
 */
function paneHandle(from) {
  const key = Object.keys(from).find((k) => k.startsWith("__reactFiber"));
  for (let f = key && from[key]; f; f = f.return) {
    const handle = f.ref?.current;
    if (typeof handle?.toggleRightPanel === "function") return handle;
  }
  return null;
}

/** Whether the cross on this header row goes back to the files view (true) or closes the pane (false). The
 *  file viewer's heading is drawn only while the viewer sits in the right pane; any other pane is the files
 *  view when it holds the app's .files-edited-sidebar. */
function goesBack(row) {
  if (row.classList.contains("workstream-file-viewer-heading")) return true;
  const pane = row.closest(".agent-workstream-right-panel");
  return !!pane && !pane.querySelector(".files-edited-sidebar");
}

const BACK_TITLE = "Back to Files & agents";
const CLOSE_TITLE = "Close panel (Ctrl+Shift+A)";

/** The header row of each open right pane: the file viewer's heading, else the first row of the pane's content. */
function paneHeaders() {
  const rows = [
    ...document.querySelectorAll(".workstream-file-viewer-heading"),
  ];
  for (const pane of document.querySelectorAll(
    ".agent-workstream-right-panel",
  )) {
    const row = pane.firstElementChild?.firstElementChild;
    if (row && pane.offsetParent !== null) rows.push(row);
  }
  return rows.filter((row) => row.offsetParent !== null);
}

let toggleMissingSaid = false;
let showMissingSaid = false;

function addCloseButtons() {
  for (const row of paneHeaders()) {
    if (row.querySelector(":scope > .ink-close-pane")) continue;
    const handle = paneHandle(row);
    if (!handle) {
      if (!toggleMissingSaid)
        console.error(
          "[ink-themes] the right pane has no close: the app's toggleRightPanel was not found",
        );
      toggleMissingSaid = true;
      continue;
    }
    const close = el("button", "ink-close-pane");
    const icon = el("span", "material-symbols-outlined ink-sym", "close");
    icon.setAttribute("aria-hidden", "true");
    close.append(icon);
    close.type = "button";
    // The view under one header row can change, and the app rebuilds its handle whenever the pane opens or
    // closes or the session changes (an old copy would skip reopening a hidden pane), so the handle, the words
    // and the action are all read again on every hover, focus and click.
    const label = () => {
      const now = paneHandle(row) ?? handle;
      const canBack = typeof now.showRightPanel === "function";
      if (!canBack && !showMissingSaid) {
        console.error(
          "[ink-themes] the right pane's cross only closes: the app's showRightPanel was not found",
        );
        showMissingSaid = true;
      }
      const back = goesBack(row) && canBack;
      close.title = back ? BACK_TITLE : CLOSE_TITLE;
      close.setAttribute("aria-label", back ? BACK_TITLE : "Close panel");
      return { now, back };
    };
    label();
    close.onpointerenter = label;
    close.onfocus = label;
    close.onclick = () => {
      const { now, back } = label();
      if (back) now.showRightPanel("edited-files");
      else now.toggleRightPanel();
    };
    row.append(close);
  }
}

/**
 * The right panel's menu (the top bar's split arrow). The style sheet gives each view a description line by
 * data-ink-view, set here from the item's own words, so a description follows its view even if the app reorders
 * them. "Edited Files" is the app's name for the files view without the files-and-agents patch.
 */
const VIEWS = {
  "files & agents": "files",
  "edited files": "files",
  review: "review",
  "chat with session": "chat",
  "file viewer": "viewer",
};
function viewFor(words) {
  return VIEWS[(words ?? "").trim().toLowerCase()] ?? null;
}

// The app's key map (KeyboardShortcuts.view.toggleAIChat): in the agent view it shows and hides the right panel,
// the same call as the top-bar toggle. shortcutText is the app's own getShortcutDisplay.
const HIDE_PANEL_KEYS = "Cmd+Shift+A";
function shortcutText(shortcut, isMac) {
  if (!isMac) return shortcut.replace("Cmd", "Ctrl").replace("Option", "Alt");
  return shortcut
    .replace("Cmd", "⌘")
    .replace("Ctrl", "⌃")
    .replace("Option", "⌥")
    .replace("Alt", "⌥")
    .replace("Shift", "⇧")
    .replace(/\+/g, "");
}
const isMac = () => navigator.platform.startsWith("Mac");

/** "Hide right panel" or "Show right panel" from the toggle's label ("Hide Agent right panel: Files & agents"); null for any other label. */
function hideRowLabel(toggleLabel) {
  const action = /^(Hide|Show) /.exec(toggleLabel ?? "")?.[1];
  return action ? `${action} right panel` : null;
}

function buildHideRow() {
  const row = el("button", "ink-menu-row");
  row.type = "button";
  row.setAttribute("role", "menuitem");
  const icon = el("span", "material-symbols-outlined ink-sym");
  icon.setAttribute("aria-hidden", "true");
  row.append(
    icon,
    el("span", "ink-menu-label"),
    el("kbd", "ink-menu-keys", shortcutText(HIDE_PANEL_KEYS, isMac())),
  );
  // The app closes its menu when its own arrow is pressed again; then the toggle hides or shows the panel
  row.onclick = () => {
    const toggle = byTest("window-top-bar-right-pane");
    if (!toggle) throw new Error("[ink-themes] the right panel toggle is gone");
    byTest("window-top-bar-right-pane-menu-button")?.click();
    toggle.click();
  };
  return row;
}

function syncPaneMenu() {
  const menu = byTest("window-top-bar-right-pane-menu");
  if (!menu) return;
  for (const item of menu.querySelectorAll(
    ":scope > .window-top-bar__menu-item",
  )) {
    // The item is the view's icon, its name, and a tick on the current one
    const view = viewFor(item.children[1]?.textContent);
    if (view) setAttr(item, "data-ink-view", view);
    else item.removeAttribute("data-ink-view");
  }
  const label = hideRowLabel(
    byTest("window-top-bar-right-pane")?.getAttribute("aria-label"),
  );
  let row = menu.querySelector(":scope > .ink-menu-row");
  if (!label) {
    menu
      .querySelectorAll(":scope > .ink-menu-sep, :scope > .ink-menu-row")
      .forEach((n) => n.remove());
    return;
  }
  if (!row) {
    row = buildHideRow();
    menu.append(el("div", "ink-menu-sep"), row);
  }
  setText(row.querySelector(".ink-menu-label"), label);
  setText(
    row.querySelector(".ink-sym"),
    label.startsWith("Hide") ? "right_panel_close" : "right_panel_open",
  );
}

/**
 * The git button says "Modified"; with a count it reads "master · 68 uncommitted". The count is the length of the
 * app's own uncommitted-file list for the project (the list the files view shows), read again when the app reports a
 * git change and when the project changes. With several repos the button names one repo, so the project-wide count
 * would not match it and none is shown.
 */
const git = {
  path: null,
  count: null,
  failed: false,
  ask: 0,
  off: null,
  timer: null,
};

/** The words the git button gets, or null for none. */
function countFor(count, severalRepos) {
  return !severalRepos && Number.isInteger(count) && count > 0
    ? String(count)
    : null;
}

async function readCount() {
  const path = window.workspacePath;
  const ask = ++git.ask;
  // A new project drops the old count at once; a re-read of the same one keeps it until the answer comes
  if (path !== git.path) git.count = null;
  git.path = path;
  if (!path) return;
  try {
    const answer = await window.electronAPI.invoke(
      "git:get-uncommitted-files",
      path,
    );
    if (!answer?.success || !Array.isArray(answer.files))
      throw new Error(answer?.error ?? "the app gave no file list");
    if (ask !== git.ask) return;
    git.count = answer.files.length;
    git.failed = false;
  } catch (e) {
    if (ask !== git.ask) return;
    if (!git.failed)
      console.error(
        "[ink-themes] the uncommitted file count could not be read; the git button keeps its own word:",
        e,
      );
    git.failed = true;
    git.count = null;
  }
  queue();
}

function listenGit() {
  if (typeof window.electronAPI?.on !== "function") {
    console.error(
      "[ink-themes] the app's events are not reachable: the git button keeps its own word",
    );
    return;
  }
  git.off = window.electronAPI.on("git:status-changed", (data) => {
    const path = window.workspacePath;
    const changed = data?.repoPath ?? data?.workspacePath;
    if (!path || typeof changed !== "string" || !changed.startsWith(path))
      return;
    // A commit or a checkout sends several in a row; one read after the last
    clearTimeout(git.timer);
    git.timer = setTimeout(readCount, 400);
  });
}

function syncGitCount() {
  if (window.workspacePath !== git.path) readCount();
  const button = byTest("window-top-bar-git-status");
  const dirty = button?.querySelector(".window-top-bar__dirty");
  if (!dirty) return;
  const count =
    git.path === window.workspacePath
      ? countFor(git.count, !!button.querySelector(".window-top-bar__git-repo"))
      : null;
  if (count) setAttr(dirty, "data-ink-count", count);
  else dirty.removeAttribute("data-ink-count");
}

/**
 * The gutter's top cell, "Needs you", is the app's own sessions bubble restyled by the style sheet. The bubble counts
 * the sessions waiting on the user while there are any (data-state "orange"); otherwise it counts running or unread
 * ones, and the style sheet hides it. Here only the listening orb is added beside a waiting bubble, in its wrapper,
 * and taken away when nobody waits.
 */
const BUBBLE = '[data-testid="agent-sessions-bubble"]';
let bubbleMissingSaid = false;

function syncNeedsYou() {
  const bubble = document.querySelector(BUBBLE);
  const waiting = bubble?.getAttribute("data-state") === "orange";
  const wrapper = bubble?.parentElement;
  const home =
    waiting && wrapper?.matches(".nav-mode-button-wrapper") ? wrapper : null;
  if (waiting && !home && !bubbleMissingSaid) {
    bubbleMissingSaid = true;
    console.error(
      "[ink-themes] the sessions bubble is no longer inside .nav-mode-button-wrapper: the Needs you cell gets no orb",
    );
  }
  for (const orb of document.querySelectorAll(".ink-needs-orb"))
    if (orb.parentElement !== home) orb.remove();
  if (home && !home.querySelector(":scope > .ink-needs-orb")) {
    const orb = el("canvas", "ink-needs-orb");
    orb.setAttribute("data-orb", "listening");
    orb.setAttribute("data-orb-px", "24");
    orb.setAttribute("aria-hidden", "true");
    home.append(orb);
  }
}

/** Starts the shared thinking-orbs mount (shared/orbs/orbs.js, which build.mjs puts in place of the marker line;
 *  it keeps one copy per window, so a second extension or a second activate adds no second loop). */
function loadOrbs() {
  // ORBS-MOUNT (build.mjs)
  if (!window.Orbs)
    throw new Error(
      "[ink-themes] the thinking-orbs mount is missing: load dist/index.js built by build.mjs, not shell.js",
    );
}

/**
 * The session list opens 240 wide, too narrow for a two-line title. Once per project, while the list is still at
 * the app's default, it is dragged to 320 through the app's own handle, so the app saves the width itself. The app
 * shows 240 for a moment before it loads a saved width, so the saved one is read first; a width the user set is
 * left alone. The flag in localStorage keeps it to one try per project.
 */
const APP_LIST_WIDTH = 240;
const LIST_WIDTH = 320;
const widthKey = (path) => `ink-themes:list-width:${path}`;
let widening = false;

/** Whether the list is still at the app's default: the handle shows 240 and no other width is saved. */
function atDefaultWidth(handleWidth, savedWidth) {
  return (
    handleWidth === APP_LIST_WIDTH &&
    (savedWidth === undefined || savedWidth === APP_LIST_WIDTH)
  );
}

/** Press the app's resize handle, move the pointer by `by` px on the app's drag cover, and let go. */
function dragHandle(handle, by) {
  const box = handle.getBoundingClientRect();
  const at = (x) => ({
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    isPrimary: true,
    clientX: x,
    clientY: box.top + box.height / 2,
  });
  const x = box.left + box.width / 2;
  handle.dispatchEvent(new PointerEvent("pointerdown", at(x)));
  const shield = document.querySelector(".resize-drag-shield");
  if (!shield) throw new Error("the app's resize drag did not start");
  shield.dispatchEvent(new PointerEvent("pointermove", at(x + by)));
  shield.dispatchEvent(new PointerEvent("pointerup", at(x + by)));
}

async function widenList() {
  const path = window.workspacePath;
  const handle = byTest("agent-history-resize-handle");
  if (widening || !path || !handle || localStorage.getItem(widthKey(path)))
    return;
  if (Number(handle.getAttribute("aria-valuenow")) !== APP_LIST_WIDTH) {
    localStorage.setItem(widthKey(path), "left alone");
    return;
  }
  widening = true;
  // Set before the read: a project whose saved state cannot be read is left alone, not asked again on every change
  localStorage.setItem(widthKey(path), "tried");
  try {
    const state = await window.electronAPI.invoke("workspace:get-state", path);
    const saved = state?.agenticCodingWindowState?.sessionHistoryLayout?.width;
    const now = byTest("agent-history-resize-handle");
    if (window.workspacePath !== path || !now) return;
    if (!atDefaultWidth(Number(now.getAttribute("aria-valuenow")), saved))
      return;
    dragHandle(now, LIST_WIDTH - APP_LIST_WIDTH);
  } catch (e) {
    console.error("[ink-themes] the session list was not widened:", e);
  } finally {
    widening = false;
  }
}

// One width for the left column in every mode. The app keeps its own width per mode (Sessions, Files, Tracker),
// so the column and the Sessions / Files / Tracker switch jumped narrower on each switch. The width of the
// handle the user last dragged wins (Sessions until then); the other modes are dragged to it with their own
// handles, so each mode saves it as its own width. A mode whose limits are narrower keeps its nearest width.
const LEFT_HANDLES = {
  sessions:
    '.agent-mode > .resizable-panel-container > [data-testid="agent-history-resize-handle"]',
  tracker:
    '.tracker-mode > .resizable-panel-container > [data-testid="agent-history-resize-handle"]',
  files: '[data-testid="editor-mode-sidebar-resize-handle"]',
};
// The Files sidebar's limits are in the app's code, not on its handle
const FILES_LIMITS = { min: 200, max: 500 };
let leftSource = null;
let leftQuietUntil = 0;

/** The drags that bring every mode to the source's width: [{ key, from, to }]. `now` maps a mode to { w, min, max }. */
function leftPlan(now, source) {
  const from = now[source] ? source : "sessions";
  if (!now[from]) return [];
  const target = now[from].w;
  const moves = [];
  for (const [key, p] of Object.entries(now)) {
    if (key === from) continue;
    const to = Math.min(p.max, Math.max(p.min, target));
    if (p.w !== to) moves.push({ key, from: p.w, to });
  }
  return moves;
}

function leftNow() {
  const now = {};
  for (const [key, sel] of Object.entries(LEFT_HANDLES)) {
    const handle = document.querySelector(sel);
    if (!handle) continue;
    if (key === "files") {
      const w = parseFloat(
        document.querySelector(".workspace-sidebar")?.parentElement?.style
          .width,
      );
      if (Number.isFinite(w)) now.files = { w, ...FILES_LIMITS, handle };
    } else {
      const w = Number(handle.getAttribute("aria-valuenow"));
      const min = Number(handle.getAttribute("aria-valuemin"));
      const max = Number(handle.getAttribute("aria-valuemax"));
      if (w && min && max) now[key] = { w, min, max, handle };
    }
  }
  return now;
}

/** The Files sidebar takes the pointer's distance from the window's left edge as its width (the app's own rule). */
function dragTo(handle, x) {
  const at = (clientX) => ({
    bubbles: true,
    cancelable: true,
    button: 0,
    buttons: 1,
    pointerId: 1,
    isPrimary: true,
    clientX,
    clientY: 400,
  });
  handle.dispatchEvent(new PointerEvent("pointerdown", at(x)));
  const shield = document.querySelector(".resize-drag-shield");
  if (!shield) throw new Error("the app's resize drag did not start");
  shield.dispatchEvent(new PointerEvent("pointermove", at(x)));
  shield.dispatchEvent(new PointerEvent("pointerup", at(x)));
}

function matchLeftWidths() {
  // Not during a drag (the user's or ours), and not again before the app has drawn our last one
  if (
    document.querySelector(".resize-drag-shield") ||
    Date.now() < leftQuietUntil
  )
    return;
  const now = leftNow();
  const moves = leftPlan(now, leftSource);
  leftSource = null;
  if (!moves.length) return;
  leftQuietUntil = Date.now() + 400;
  setTimeout(queue, 450);
  for (const m of moves) {
    try {
      if (m.key === "files") dragTo(now.files.handle, m.to);
      else dragHandle(now[m.key].handle, m.to - m.from);
    } catch (e) {
      console.error(
        `[ink-themes] the ${m.key} column was not set to the shared width:`,
        e,
      );
    }
  }
}

/** A real press on one of the three handles makes that mode's width the one the others follow. */
function noteLeftDrag(e) {
  if (!e.isTrusted || !(e.target instanceof Element)) return;
  for (const [key, sel] of Object.entries(LEFT_HANDLES))
    if (e.target.closest(sel)) leftSource = key;
}
const afterDrag = () => setTimeout(queue, 50);

function removeAll() {
  document
    .querySelectorAll(
      ".ink-top, .ink-close-pane, .ink-menu-sep, .ink-menu-row, .ink-needs-orb",
    )
    .forEach((n) => n.remove());
  document
    .querySelectorAll("[data-ink-project]")
    .forEach((n) => n.removeAttribute("data-ink-project"));
  for (const name of ["data-ink-view", "data-ink-count"])
    document
      .querySelectorAll(`[${name}]`)
      .forEach((n) => n.removeAttribute(name));
  document.documentElement.classList.remove("ink-shell");
}

/** The project's name: the visible sidebar header's, else the top bar's. */
function projectName() {
  const visible = [
    ...document.querySelectorAll(".workspace-summary-header-name"),
  ].find((n) => n.offsetParent !== null);
  return (
    (
      visible ?? document.querySelector(".window-top-bar__workspace-name")
    )?.textContent.trim() ?? ""
  );
}

function sync() {
  foldMenu();
  if (!themeOn()) return removeAll();

  for (const header of document.querySelectorAll(".workspace-summary-header")) {
    if (!header.querySelector(":scope > .ink-top")) header.append(buildTop());
  }

  for (const seg of document.querySelectorAll(".ink-seg")) {
    const tabs = [...seg.querySelectorAll(".ink-seg-btn")];
    const active = tabs.map(
      (b) => !!byTest(b.dataset.mode)?.classList.contains("active"),
    );
    // With no active mode the first tab stays reachable by keyboard
    const focusable = active.includes(true) ? active.indexOf(true) : 0;
    tabs.forEach((b, i) => {
      setAttr(b, "aria-selected", String(active[i]));
      setAttr(b, "tabindex", i === focusable ? "0" : "-1");
    });
  }
  const news = document.querySelectorAll(".ink-new");
  if (news.length) {
    const label = createLabel();
    for (const b of news) setText(b.querySelector(".ink-new-label"), label);
  }
  // The empty chat's heading is the project name; the style sheet draws it from this attribute
  const project = projectName();
  for (const empty of document.querySelectorAll(
    ".rich-transcript-empty-extras",
  )) {
    if (empty.dataset.inkProject !== project)
      empty.dataset.inkProject = project;
  }

  addCloseButtons();
  syncPaneMenu();
  syncGitCount();
  syncNeedsYou();
  widenList();
  matchLeftWidths();

  // The three side icons are hidden only while a switch is really on screen, so there is always a way to change mode.
  const switchVisible = [...document.querySelectorAll(".ink-seg")].some(
    (s) => s.offsetParent !== null,
  );
  document.documentElement.classList.toggle("ink-shell", switchVisible);
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
      console.error("[ink-themes] could not add the side panel parts:", e);
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
  loadOrbs();
  // Text edits count only inside the project name (a project switch rewrites it); other
  // text, such as a streaming reply, does not wake the shell.
  observer = new MutationObserver((mutations) => {
    if (
      mutations.some(
        (m) =>
          m.type !== "characterData" ||
          m.target.parentElement?.closest(
            ".workspace-summary-header-name, .window-top-bar__workspace-name",
          ),
      )
    )
      queue();
  });
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    attributeFilter: ["class", "data-theme"],
  });
  timer = setInterval(queue, 30_000);
  document.addEventListener("click", keepMenuOpen, true);
  document.addEventListener("pointerdown", noteLeftDrag, true);
  document.addEventListener("pointerup", afterDrag, true);
  listenGit();
  queue();
}

function deactivate() {
  observer?.disconnect();
  observer = undefined;
  clearInterval(timer);
  document.removeEventListener("click", keepMenuOpen, true);
  document.removeEventListener("pointerdown", noteLeftDrag, true);
  document.removeEventListener("pointerup", afterDrag, true);
  git.off?.();
  clearTimeout(git.timer);
  Object.assign(git, {
    path: null,
    count: null,
    failed: false,
    ask: git.ask + 1,
    off: null,
    timer: null,
  });
  removeAll();
  unfoldMenu();
}

export {
  activate,
  atDefaultWidth,
  countFor,
  deactivate,
  goesBack,
  hideRowLabel,
  labelFor,
  leftPlan,
  readCount,
  shortcutText,
  syncGitCount,
  syncNeedsYou,
  syncPaneMenu,
  viewFor,
  widenList,
};
