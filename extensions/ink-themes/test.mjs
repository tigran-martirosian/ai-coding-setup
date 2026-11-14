// Checks the themes: every colour slot filled, text readable on its background, manifest.json in step
// with themes.mjs, and the built style sheet scoped to this extension's themes only.
// Run: node test.mjs   (after node build.mjs)
import fs from "node:fs";
import { createChecks } from "../shared/check.mjs";
import {
  atDefaultWidth,
  countFor,
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
} from "./shell.js";
import {
  colors,
  contrast,
  EXTENSION_ID,
  menuThemes,
  THEMES,
} from "./themes.mjs";

const counter = createChecks();
const check = (ok, what) => counter.check(what, ok);
const at = (t, a, b, min) => {
  const c = contrast(t[a], t[b]);
  check(c >= min, `${t.id}: ${a} on ${b} is ${c.toFixed(2)}, needs ${min}`);
};

const hsl = (hex) => {
  const [r, g, b] = [1, 3, 5].map(
    (i) => parseInt(hex.slice(i, i + 2), 16) / 255,
  );
  const mx = Math.max(r, g, b),
    mn = Math.min(r, g, b),
    d = mx - mn,
    l = (mx + mn) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  const h =
    d === 0
      ? 0
      : 60 *
        (mx === r
          ? ((g - b) / d + 6) % 6
          : mx === g
            ? (b - r) / d + 2
            : (r - g) / d + 4);
  return { h, s, l };
};
check(
  THEMES.every((t) => !/\.$/.test(t.about)),
  "theme descriptions have no trailing period",
);
check(
  new Set(THEMES.map((t) => t.id)).size === THEMES.length,
  "theme ids are unique",
);
const slots = Object.keys(colors(THEMES[0])).length;
for (const t of THEMES) {
  const c = colors(t);
  check(/^ink-[a-z]+$/.test(t.id), `${t.id}: id is ink-<word>`);
  check(
    Object.keys(c).length === slots &&
      Object.values(c).every((v) =>
        /^(#[0-9a-f]{6}|rgba\(\d+, \d+, \d+, 0\.\d+\))$/.test(v),
      ),
    `${t.id}: every slot is a colour`,
  );
  // Body text, on the page, the side bar and raised boxes
  for (const bg of ["bg", "side", "raised"]) {
    at(t, "text", bg, 10);
    at(t, "muted", bg, 6);
    at(t, "faint", bg, 4.5);
  }
  at(t, "onPrimary", "primary", 4.5);
  at(t, "onPrimary", "primaryHover", 3.3);
  // Calm backgrounds: HSL saturation of the page, side bar and raised boxes stays at 12% or less
  for (const k of ["bg", "side", "raised"])
    check(
      hsl(t[k]).s <= 0.12,
      `${t.id}: ${k} saturation is ${(hsl(t[k]).s * 100).toFixed(1)}%, needs 12% or less`,
    );
  // One accent: the link colour is a shade of it (a grey accent has no hue to match)
  if (hsl(t.primary).s > 0.1) {
    const d = Math.abs(hsl(t.link).h - hsl(t.primary).h);
    check(
      Math.min(d, 360 - d) <= 15,
      `${t.id}: link hue ${hsl(t.link).h.toFixed(0)} is not a shade of the accent hue ${hsl(t.primary).h.toFixed(0)}`,
    );
  }
  // A stop or delete button: white text on the error colour of a light theme
  if (!t.isDark) at({ ...t, white: "#ffffff" }, "white", "error", 4.5);
  for (const k of ["link", "success", "warning", "error", "info", "purple"])
    at(t, k, "bg", 4.5);
  at(t, "focus", "bg", 3);
  at(t, "primary", "bg", t.isDark ? 3 : 4.5);
  // The side bar must be told apart from the page, and disabled text must stay quieter than faint text
  check(
    contrast(t.bg, t.side) >= 1.03,
    `${t.id}: side bar differs from the page (${contrast(t.bg, t.side).toFixed(2)})`,
  );
  check(
    contrast(t.disabled, t.bg) < contrast(t.faint, t.bg),
    `${t.id}: disabled is quieter than faint`,
  );
  check(
    contrast(t.bg, "#000000") > 1 === true &&
      (t.isDark
        ? contrast(t.text, "#000000") > contrast(t.bg, "#000000")
        : contrast(t.bg, "#000000") > contrast(t.text, "#000000")),
    `${t.id}: isDark matches its colours`,
  );
}

const manifest = JSON.parse(
  fs.readFileSync(new URL("./manifest.json", import.meta.url), "utf8"),
);
check(manifest.id === EXTENSION_ID, "manifest id matches themes.mjs");
check(
  JSON.stringify(manifest.contributions.themes) ===
    JSON.stringify(
      menuThemes().map((t) => ({
        id: t.id,
        name: t.name,
        isDark: t.isDark,
        colors: colors(t),
      })),
    ),
  "manifest.json matches themes.mjs (run node build.mjs)",
);

{
  const listed = manifest.contributions.themes;
  const firstLight = listed.findIndex((t) => !t.isDark);
  check(
    listed.length === THEMES.length &&
      firstLight > 0 &&
      listed.slice(firstLight).every((t) => !t.isDark),
    "Theme menu lists the dark themes first, then the light ones",
  );
  check(
    listed.every((t) => t.name.endsWith(t.isDark ? " (dark)" : " (light)")),
    "each theme name ends with (dark) or (light)",
  );
  check(
    !/\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b colour themes/i.test(
      manifest.description,
    ),
    "manifest description names no theme count that can go stale",
  );
}

// The pane cross: back to the files view on Review, Chat or the file viewer; close on the files view
{
  const row = (cls, pane) => ({
    classList: { contains: (c) => c === cls },
    closest: () => pane,
  });
  const pane = (filesView) => ({
    querySelector: (q) =>
      filesView && q === ".files-edited-sidebar" ? {} : null,
  });
  check(
    goesBack(row("workstream-file-viewer-heading", null)),
    "cross on the file viewer goes back",
  );
  check(goesBack(row("x", pane(false))), "cross on Review or Chat goes back");
  check(
    !goesBack(row("x", pane(true))),
    "cross on the files view closes the pane",
  );
  check(!goesBack(row("x", null)), "cross outside the right pane closes");
}

// A small stand-in for the page, enough for the selectors shell.js uses below: ".class", "[attr]", '[attr="v"]',
// ":scope > " for direct children, and lists joined by commas.
class FakeEl {
  constructor(tag) {
    this.tagName = tag.toUpperCase();
    this.attrs = {};
    this.children = [];
    this.parent = null;
    this.text = "";
    this.className = "";
    this.events = [];
  }
  get textContent() {
    return this.children.length
      ? this.children.map((c) => c.textContent).join("")
      : this.text;
  }
  set textContent(v) {
    this.children = [];
    this.text = String(v);
  }
  get parentElement() {
    return this.parent;
  }
  getAttribute(n) {
    return n in this.attrs ? this.attrs[n] : null;
  }
  setAttribute(n, v) {
    this.attrs[n] = String(v);
  }
  removeAttribute(n) {
    delete this.attrs[n];
  }
  append(...nodes) {
    for (const n of nodes) {
      n.remove();
      n.parent = this;
      this.children.push(n);
    }
  }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
    this.parent = null;
  }
  matches(sel) {
    const cls = /^\.([\w-]+)$/.exec(sel);
    if (cls) return this.className.split(/\s+/).includes(cls[1]);
    const attr = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(sel);
    if (attr)
      return attr[2] === undefined
        ? attr[1] in this.attrs
        : this.attrs[attr[1]] === attr[2];
    if (/^[a-z]+$/.test(sel)) return this.tagName === sel.toUpperCase();
    throw new Error("the stand-in page does not know the selector " + sel);
  }
  all() {
    return this.children.flatMap((c) => [c, ...c.all()]);
  }
  querySelectorAll(list) {
    const found = new Set();
    for (const part of list.split(",").map((s) => s.trim())) {
      const direct = part.startsWith(":scope > ");
      const sel = direct ? part.slice(9) : part;
      for (const n of direct ? this.children : this.all())
        if (n.matches(sel)) found.add(n);
    }
    return [...found];
  }
  querySelector(sel) {
    return this.querySelectorAll(sel)[0] ?? null;
  }
  click() {
    clicks.push(this.attrs["data-testid"] ?? this.className);
    this.onclick?.();
  }
  dispatchEvent(e) {
    this.events.push(e);
    this.onEvent?.(e);
  }
  getBoundingClientRect() {
    return { left: 300, top: 40, width: 2, height: 800 };
  }
}
const clicks = [];
const make = (tag, attrs = {}, ...kids) => {
  const n = new FakeEl(tag);
  for (const [k, v] of Object.entries(attrs))
    k === "class" ? (n.className = v) : n.setAttribute(k, v);
  for (const k of kids)
    n.append(
      typeof k === "string"
        ? Object.assign(new FakeEl("span"), { text: k })
        : k,
    );
  return n;
};
const store = new Map();
const logged = [];
Object.assign(globalThis, {
  window: {},
  localStorage: {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  },
  requestAnimationFrame: () => {},
  PointerEvent: class {
    constructor(type, init) {
      Object.assign(this, init, { type });
    }
  },
});
Object.defineProperty(globalThis, "navigator", {
  value: { platform: "Win32" },
  configurable: true,
});
const page = (...kids) => {
  const root = make("html", {}, ...kids);
  root.createElement = (tag) => new FakeEl(tag);
  globalThis.document = root;
  return root;
};
const quietErrors = async (fn) => {
  const before = console.error;
  console.error = (...a) => logged.push(a.join(" "));
  try {
    return await fn();
  } finally {
    console.error = before;
  }
};

// The right panel's menu: each view marked from its words, a hide row with the app's shortcut at the end
{
  check(
    viewFor("Files & agents") === "files" &&
      viewFor("Edited Files") === "files" &&
      viewFor(" Review ") === "review" &&
      viewFor("Chat with Session") === "chat" &&
      viewFor("File viewer") === "viewer" &&
      viewFor("Hidden") === null,
    "menu: each view's words map to its description; other words to none",
  );
  check(
    shortcutText("Cmd+Shift+A", false) === "Ctrl+Shift+A" &&
      shortcutText("Cmd+Shift+A", true) === "⌘⇧A",
    "menu: the shortcut reads Ctrl+Shift+A off a Mac and ⌘⇧A on one (the app's own display rule)",
  );
  check(
    hideRowLabel("Hide Agent right panel: Files & agents") ===
      "Hide right panel" &&
      hideRowLabel("Show Agent right panel: Review") === "Show right panel" &&
      hideRowLabel("Choose Agent right panel: Review") === null &&
      hideRowLabel(null) === null,
    "menu: the hide row says Hide or Show as the panel toggle does, else nothing",
  );
  const item = (icon, words, selected) =>
    make(
      "button",
      {
        class: "window-top-bar__menu-item",
        role: "menuitem",
        "data-selected": String(selected),
      },
      icon,
      words,
      ...(selected ? ["check"] : []),
    );
  const menu = make(
    "div",
    {
      class: "window-top-bar__menu",
      "data-testid": "window-top-bar-right-pane-menu",
    },
    item("description", "Files & agents", true),
    item("rate_review", "Review", false),
    item("forum", "Chat with Session", false),
    item("tab", "File viewer", false),
    item("help", "Something new", false),
  );
  const toggle = make("button", {
    "data-testid": "window-top-bar-right-pane",
    "aria-label": "Hide Agent right panel: Files & agents",
  });
  page(
    toggle,
    make("button", { "data-testid": "window-top-bar-right-pane-menu-button" }),
    menu,
  );
  syncPaneMenu();
  syncPaneMenu();
  const views = menu.children
    .filter((c) => c.className.includes("window-top-bar__menu-item"))
    .map((c) => c.getAttribute("data-ink-view"));
  check(
    JSON.stringify(views) ===
      JSON.stringify(["files", "review", "chat", "viewer", null]),
    "menu: views tagged " + JSON.stringify(views),
  );
  const [sep, row] = menu.children.slice(-2);
  check(
    menu.querySelectorAll(".ink-menu-row").length === 1 &&
      sep.className === "ink-menu-sep" &&
      row.className === "ink-menu-row",
    "menu: one hairline and one hide row at the end, after two syncs",
  );
  check(
    row.querySelector(".ink-menu-label").textContent === "Hide right panel" &&
      row.querySelector(".ink-menu-keys").textContent === "Ctrl+Shift+A" &&
      row.querySelector(".ink-sym").textContent === "right_panel_close",
    "menu: hide row reads Hide right panel, Ctrl+Shift+A",
  );
  clicks.length = 0;
  row.click();
  check(
    JSON.stringify(clicks) ===
      JSON.stringify([
        "ink-menu-row",
        "window-top-bar-right-pane-menu-button",
        "window-top-bar-right-pane",
      ]),
    "menu: the hide row closes the menu with the app's arrow, then presses the app's toggle",
  );
  toggle.setAttribute("aria-label", "Show Agent right panel: Files & agents");
  syncPaneMenu();
  check(
    row.querySelector(".ink-menu-label").textContent === "Show right panel",
    "menu: hide row turns to Show while the panel is hidden",
  );
  toggle.setAttribute("aria-label", "Something else");
  syncPaneMenu();
  check(
    !menu.querySelector(".ink-menu-row") &&
      !menu.querySelector(".ink-menu-sep"),
    "menu: no hide row when the toggle's label is not understood",
  );
}

// The git button's count: shown from the app's list, hidden with several repos, at 0, or when the call fails
{
  check(
    countFor(68, false) === "68" &&
      countFor(0, false) === null &&
      countFor(68, true) === null &&
      countFor(null, false) === null,
    "git: a count only above 0 and with one repo",
  );
  const asked = [];
  let answer;
  window.electronAPI = {
    invoke: async (channel, path) => {
      asked.push([channel, path]);
      return answer;
    },
  };
  const dirty = make(
    "span",
    { class: "window-top-bar__git-detail window-top-bar__dirty" },
    "Modified",
  );
  const button = make(
    "button",
    { "data-testid": "window-top-bar-git-status" },
    make("span", { class: "window-top-bar__branch" }, "master"),
    dirty,
  );
  page(button);
  window.workspacePath = "/work/one";
  answer = {
    success: true,
    files: Array.from({ length: 68 }, (_, i) => `f${i}`),
  };
  await readCount();
  syncGitCount();
  check(
    dirty.getAttribute("data-ink-count") === "68" &&
      asked.at(-1)[0] === "git:get-uncommitted-files" &&
      asked.at(-1)[1] === "/work/one",
    "git: 68 files in the app's list show as 68",
  );
  const repo = make("span", { class: "window-top-bar__git-repo" }, "one");
  button.children.unshift(repo);
  repo.parent = button;
  syncGitCount();
  check(
    dirty.getAttribute("data-ink-count") === null,
    "git: no count while the button names one of several repos",
  );
  repo.remove();
  answer = { success: true, files: [] };
  await readCount();
  syncGitCount();
  check(dirty.getAttribute("data-ink-count") === null, "git: no count at 0");
  window.workspacePath = "/work/two";
  answer = { success: false, error: "not a repository", files: [] };
  const before = logged.length;
  await quietErrors(async () => {
    await readCount();
    await readCount();
  });
  syncGitCount();
  check(
    dirty.getAttribute("data-ink-count") === null &&
      logged.length - before === 1 &&
      logged.at(-1).includes("not a repository"),
    "git: a failed call logs one error and shows no count",
  );
}

// The session list width: dragged to 320 only from the app's 240 default, once per project, with the app's own handle
{
  check(
    atDefaultWidth(240, undefined) &&
      atDefaultWidth(240, 240) &&
      !atDefaultWidth(240, 300) &&
      !atDefaultWidth(300, undefined),
    "width: default only at 240 with no other saved width",
  );
  let saved;
  window.electronAPI = {
    invoke: async (channel) =>
      channel === "workspace:get-state" ? saved : null,
  };
  const setUp = (now) => {
    const handle = make("div", {
      "data-testid": "agent-history-resize-handle",
      "aria-valuenow": String(now),
    });
    const root = page(handle);
    const moves = [];
    // Like the app: a press on the handle puts its drag cover over the page, which takes the moves
    handle.onEvent = (e) => {
      if (e.type !== "pointerdown") return;
      const shield = make("div", { class: "resize-drag-shield" });
      shield.onEvent = (m) => moves.push([m.type, m.clientX - e.clientX]);
      root.append(shield);
    };
    return { handle, moves };
  };
  window.workspacePath = "/work/fresh";
  saved = { agenticCodingWindowState: {} };
  let s = setUp(240);
  await widenList();
  check(
    s.handle.events.length === 1 &&
      s.handle.events[0].button === 0 &&
      JSON.stringify(s.moves) ===
        JSON.stringify([
          ["pointermove", 80],
          ["pointerup", 80],
        ]),
    "width: at the default the handle is pressed and moved 80 to the right: " +
      JSON.stringify(s.moves),
  );
  s = setUp(240);
  await widenList();
  check(s.handle.events.length === 0, "width: once per project");
  window.workspacePath = "/work/set";
  s = setUp(300);
  await widenList();
  check(
    s.handle.events.length === 0,
    "width: a width the user set is left alone",
  );
  window.workspacePath = "/work/loading";
  saved = {
    agenticCodingWindowState: { sessionHistoryLayout: { width: 360 } },
  };
  s = setUp(240);
  await widenList();
  check(
    s.handle.events.length === 0,
    "width: a saved width not loaded yet (the app shows 240 first) is left alone",
  );
  delete window.electronAPI;
  delete globalThis.document;
}

// One left width in every mode: Sessions leads until the user drags another mode's handle
{
  const now = {
    sessions: { w: 292, min: 200, max: 500 },
    files: { w: 240, min: 200, max: 500 },
    tracker: { w: 220, min: 160, max: 350 },
  };
  const plan = (n, src) => JSON.stringify(leftPlan(n, src));
  check(
    plan(now, null) ===
      JSON.stringify([
        { key: "files", from: 240, to: 292 },
        { key: "tracker", from: 220, to: 292 },
      ]),
    "left: Files and Tracker are brought to the Sessions width: " +
      plan(now, null),
  );
  check(
    plan(now, "tracker") ===
      JSON.stringify([
        { key: "sessions", from: 292, to: 220 },
        { key: "files", from: 240, to: 220 },
      ]),
    "left: a drag in Tracker sets the width for the others: " +
      plan(now, "tracker"),
  );
  const wide = {
    sessions: { w: 420, min: 200, max: 500 },
    tracker: { w: 350, min: 160, max: 350 },
  };
  check(
    plan(wide, null) === "[]",
    "left: a mode at its own limit is left there, so nothing drags again and again",
  );
  check(
    plan(
      {
        sessions: { w: 300, min: 200, max: 500 },
        files: { w: 300, min: 200, max: 500 },
      },
      null,
    ) === "[]",
    "left: equal widths, no drag",
  );
  check(
    plan({ files: { w: 240, min: 200, max: 500 } }, null) === "[]",
    "left: without the Sessions column, nothing moves",
  );
  check(
    plan(
      {
        files: { w: 240, min: 200, max: 500 },
        tracker: { w: 220, min: 160, max: 350 },
      },
      "files",
    ) === JSON.stringify([{ key: "tracker", from: 220, to: 240 }]),
    "left: a drag in Files leads even when Sessions is not there",
  );
}

// The Needs you cell: the listening orb beside the app's bubble only while it counts waiting sessions (orange)
{
  const bubble = make(
    "button",
    { "data-testid": "agent-sessions-bubble", "data-state": "orange" },
    "2",
  );
  const wrapper = make(
    "div",
    { class: "nav-mode-button-wrapper relative" },
    make("button", { "data-testid": "agent-mode-button" }),
    bubble,
  );
  page(make("div", { "data-gutter-item": "agent" }, wrapper));
  syncNeedsYou();
  syncNeedsYou();
  const orbs = wrapper.querySelectorAll(".ink-needs-orb");
  check(
    orbs.length === 1 &&
      orbs[0].tagName === "CANVAS" &&
      orbs[0].getAttribute("data-orb") === "listening" &&
      orbs[0].getAttribute("data-orb-px") === "24",
    "needs you: one 24px listening orb in the bubble's wrapper, after two syncs",
  );
  for (const state of ["green", "blue"]) {
    bubble.setAttribute("data-state", state);
    syncNeedsYou();
    check(
      wrapper.querySelectorAll(".ink-needs-orb").length === 0,
      `needs you: no orb while the bubble counts ${state === "green" ? "running" : "unread"} sessions`,
    );
  }
  bubble.setAttribute("data-state", "orange");
  syncNeedsYou();
  bubble.remove();
  syncNeedsYou();
  check(
    wrapper.querySelectorAll(".ink-needs-orb").length === 0,
    "needs you: the orb goes with the bubble",
  );
  const loose = make(
    "button",
    { "data-testid": "agent-sessions-bubble", "data-state": "orange" },
    "1",
  );
  const root = page(make("div", { class: "somewhere-else" }, loose));
  const before = logged.length;
  await quietErrors(() => {
    syncNeedsYou();
    syncNeedsYou();
  });
  check(
    root.querySelectorAll(".ink-needs-orb").length === 0 &&
      logged.length - before === 1 &&
      logged.at(-1).includes("nav-mode-button-wrapper"),
    "needs you: a bubble outside its wrapper gets no orb and logs once",
  );
  delete globalThis.document;
}

// The built shell carries the shared orb library once, inside loadOrbs (so it runs at activate, not on import)
{
  const built = fs.readFileSync(
    new URL("./dist/index.js", import.meta.url),
    "utf8",
  );
  const copies = built.split("thinking-orbs 0.3.2").length - 1;
  check(
    copies === 1 &&
      !built.includes("ORBS-MOUNT") &&
      built.indexOf("thinking-orbs 0.3.2") >
        built.indexOf("function loadOrbs") &&
      /function activate\(\)[\s\S]*?loadOrbs\(\)/.test(built),
    `build: the orb library is in dist/index.js once (${copies}), inside loadOrbs, started at activate`,
  );
}

// The gutter: full names, Wiki first in the tools, the Needs you cell, nothing under 12px
{
  const src = fs
    .readFileSync(new URL("./theme.src.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const shellSrc = fs.readFileSync(
    new URL("./shell.js", import.meta.url),
    "utf8",
  );
  const name = (sel, word) =>
    src.includes(`${sel}::after { content: "${word}"; }`);
  check(
    name(
      '[data-testid="window-top-bar-right-pane"][aria-label$=": Files & agents"]',
      "Files & agents",
    ) &&
      name(
        '[data-testid="window-top-bar-right-pane"][aria-label$=": Edited Files"]',
        "Edited files",
      ),
    "top bar: the right-panel button named with and without the files-and-agents patch",
  );
  check(
    name('[data-testid="terminal-panel-button"]', "Terminal") &&
      name('.nav-button[data-panel-id*="systemsmap"]', "Map") &&
      name('.nav-button[data-panel-id*="commandbuttons"]', "Cmds") &&
      name('[data-testid="gutter-permissions-button"]', "Perm") &&
      name('[data-testid="collab-mode-button"]', "Wiki") &&
      !/content: "(Term|Systems map|Commands|Permissions|Rights)"/.test(src),
    "gutter: the short names Map, Cmds, Perm (user, 2026-11-14), the long ones gone",
  );
  check(
    /\.navigation-gutter \{ width: 64px !important;/.test(src) &&
      /\.project-rail \{ width: 58px !important;/.test(src) &&
      /\.nav-button::after, \[data-testid\$="-usage-indicator"\]::after \{ font: 400 12px\/16px/.test(
        src,
      ) &&
      /content: "Needs you"; grid-row: 2; font: 600 12px\/16px/.test(src),
    "gutter: 64 wide, rail 58, names at 12px",
  );
  check(
    /\[data-gutter-item="collab"\] \{ order: 2; \}/.test(src) &&
      /\.nav-extension-panels > \[data-gutter-item\] \{ order: 3; \}/.test(
        src,
      ) &&
      /\.nav-settings \{ order: 4; \}/.test(src) &&
      !src.includes('systemsmap"] ~'),
    "gutter: Wiki first in the tools, then the tools in their own order, then the bottom section",
  );
  check(
    /\[data-testid="collab-mode-button"\] > \[data-testid="alpha-badge"\] \{ display: none !important; \}/.test(
      src,
    ),
    "gutter: the α mark hidden",
  );
  check(
    src.includes('content: "Needs you"') &&
      /\[data-testid="agent-sessions-bubble"\]:not\(\[data-state="orange"\]\) \{ display: none !important; \}/.test(
        src,
      ) &&
      /\[data-state="orange"\] \{[^}]*background: var\(--x-state-needs\)/.test(
        src,
      ),
    "gutter: Needs you only on the orange bubble, its count in the warning tone; the other states hidden",
  );
  check(
    !src.includes("data-ink-used") &&
      !shellSrc.includes("data-ink-used") &&
      /-usage-indicator"\] > span \{ font: var\(--x-count\)/.test(src),
    "rings: the app's own number stays inside the ring, nothing copied under the name",
  );
  check(
    /-usage-indicator"\] > span \{ font: var\(--x-count\) !important; font-weight: 500 !important;/.test(
      src,
    ),
    "rings: the number one step lighter than a count (500), same size",
  );
  {
    const card =
      '.rich-transcript-tool-container > div:has(> div:first-child > span:first-child + span[style*="font-family: monospace"]:last-child)';
    const rule = (tail) =>
      (src.split(card + tail + " {")[1] || "").split("}")[0];
    check(
      /font: var\(--x-heading\) !important/.test(
        rule(" > div:first-child > span:first-child"),
      ) &&
        /font: 400 12px\/16px var\(--ink-mono\) !important; color: var\(--x-text-muted\)/.test(
          rule(' > div:first-child > span[style*="font-family: monospace"]'),
        ),
      "tracker created card: header on the heading type, the raw id muted at 12px",
    );
    check(
      /width: 64px; min-width: 64px !important/.test(
        rule(' span[style*="min-width: 50px"]'),
      ) &&
        /grid-template-columns: 64px auto/.test(
          rule(' > div:last-child > div:has(> span[style*="width: 12px"])'),
        ) &&
        /display: none !important/.test(rule(' span[style*="width: 12px"]')) &&
        /grid-column: 1;/.test(rule(' span[style*="width: 12px"] + span')),
      "tracker created card: one 64px label column, Priority on its own row under Status",
    );
    const pill = rule(' span[style*="border-radius: 10px"]');
    check(
      /background: var\(--x-overlay-hover\)/.test(pill) &&
        /border-radius: var\(--x-radius-control\)/.test(pill) &&
        /text-transform: none/.test(pill) &&
        /color: var\(--x-state-running\)/.test(
          rule(
            ' span[style*="border-radius: 10px"][style*="rgb(96, 165, 250)"]',
          ),
        ),
      "tracker created card: pills in the theme's tag style, in-progress in the running tone",
    );
  }
  check(
    /\.navigation-gutter \.nav-settings \{ padding: 0 !important; border-top: 0 !important; \}/.test(
      src,
    ),
    "gutter: no 1px divider above Permissions, so each gutter button is level with its rail neighbour",
  );
  check(
    /\.session-list-item\[style\*="border-left"\] \{ border-left: 0 !important; \}/.test(
      src,
    ),
    "rows: the app's inline edge stripe on a Needs you row is removed",
  );
  const small = [
    ...src.matchAll(/(?:font(?:-size)?:[^;]*?)\b(\d+(?:\.\d+)?)px/g),
  ]
    .map((m) => Number(m[1]))
    .filter((n) => n < 12);
  check(small.length === 0, "nothing under 12px: " + small.join(", "));
}

const cssFile = new URL("./dist/theme.css", import.meta.url);
if (!fs.existsSync(cssFile))
  check(false, "dist/theme.css is missing: run node build.mjs first");
else {
  const css = fs
    .readFileSync(cssFile, "utf8")
    .replace(/@font-face[^\n]*\n/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  check(
    css.includes(`html[data-theme^="${EXTENSION_ID}:"] {`),
    "shared rules are scoped to this extension",
  );
  check(!css.includes("__S__"), "no scope word left in the style sheet");
  for (const t of THEMES)
    check(
      css.includes(
        `html[data-theme="${EXTENSION_ID}:${t.id}"] { --nim-on-primary: ${t.onPrimary}`,
      ),
      `${t.id}: has its own rule`,
    );
  // Outside the two scopes there must be nothing, or the fonts and shapes would leak into other themes.
  // One exception, on purpose: the rail stops clipping while the theme menu is open (the way back from any theme).
  const MENU_FIX = ".project-rail:has(.theme-menu)";
  let depth = 0,
    outside = "";
  for (const ch of css) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    else if (depth === 0) outside += ch;
  }
  const selectors = outside
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const leaks = selectors.filter(
    (s) => !s.startsWith("html[data-theme") && s !== MENU_FIX,
  );
  check(
    leaks.length === 0,
    `nothing styled outside the themes: ${leaks.join(" | ").slice(0, 200)}`,
  );
  check(
    selectors.filter((s) => s === MENU_FIX).length === 1 &&
      /\.project-rail:has\(\.theme-menu\) \{ overflow: visible !important; \}/.test(
        css,
      ),
    "the theme menu fix is there once, outside the themes, and does only that",
  );
}
// shell.js, the pure part: the button label
check(
  labelFor("new session") === "New session" &&
    labelFor("New file") === "New file" &&
    labelFor(" Open folder ") === "Open folder",
  "shell: button label from the list, else the app label",
);
// The usage block and its tests were removed: weekly usage shows in one place only, the app's own Claude ring in the side bar.
// Tokens: the light-theme block must sit on the theme's own element (&:not), not as a nested "html:not(" that never matches
if (fs.existsSync(cssFile)) {
  const built = fs.readFileSync(cssFile, "utf8");
  const lightBlock = built.match(/&:not\(\.dark-theme\) \{([^}]*)\}/);
  check(
    !built.includes("html:not(") &&
      !!lightBlock &&
      lightBlock[1].includes(
        "--x-overlay-hover: color-mix(in oklab, var(--nim-text) 4%",
      ) &&
      lightBlock[1].includes(
        "--x-overlay-selected: color-mix(in oklab, var(--nim-text) 7%",
      ),
    "built css: light themes get the 4% / 7% overlays through &:not(.dark-theme), no nested html:not(",
  );
}
// Every app class, test id and label the shell touches is in selectors.json (the probe's list)
{
  const listed = fs.readFileSync(
    new URL("./selectors.json", import.meta.url),
    "utf8",
  );
  const css = fs
    .readFileSync(new URL("./theme.src.css", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "");
  const js = fs.readFileSync(new URL("./shell.js", import.meta.url), "utf8");
  const own = /^(ink-|dark-theme|light-theme|material-symbols|rounded|active$)/;
  const used = new Set();
  for (const m of css.matchAll(/([^{};]+)\{/g)) {
    const pre = m[1].trim();
    if (pre.startsWith("@") || pre.startsWith("--")) continue;
    const plain = pre
      .replace(/\[class[^\]]*\]/g, "")
      .replace(/\[data-panel-id[^\]]*\]/g, "");
    for (const c of plain.matchAll(/\.([a-z][\w-]*)/g))
      if (!own.test(c[1])) used.add("." + c[1]);
    for (const v of plain.matchAll(
      /\[(?:data-testid|aria-label)[\^$*]?="([^"]+)"\]/g,
    ))
      used.add(v[1]);
    for (const v of plain.matchAll(/\[data-gutter-item([\^$*]?)="([^"]+)"\]/g))
      used.add(`[data-gutter-item${v[1]}=\\"${v[2]}\\"]`);
  }
  for (const v of js.matchAll(/\[data-testid="([^"$]+)"\]/g)) used.add(v[1]);
  for (const m of js.matchAll(
    /(?:querySelector(?:All)?\(\s*['"`]|byTest\(['"]|closest\(['"]|matches\(['"])([^'"`)]*)/g,
  )) {
    for (const c of m[1].matchAll(/\.([a-z][\w-]*)/g))
      if (!own.test(c[1])) used.add("." + c[1]);
  }
  for (const m of js.matchAll(
    /['"]([a-z]+-(?:mode-button|usage-indicator))['"]/g,
  ))
    used.add(m[1]);
  const missing = [...used].filter((u) => !listed.includes(u));
  check(missing.length === 0, "selectors.json lacks: " + missing.join(", "));
}
check(
  fs
    .readFileSync(new URL("./shell.js", import.meta.url), "utf8")
    .includes("--ink-sans"),
  "shell.js tells from the style sheet whether a theme is on",
);

counter.finish();
