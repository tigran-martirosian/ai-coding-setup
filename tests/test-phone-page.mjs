// Tests for the phone page's Home (phone/page/screens/home.js, home-sessions.js and its part of page.css) and the
// pc.status fields it shows (skills/phone-bot/pc/actions/pc.mjs). The PC side runs the real registry against
// fixtures in a temp home: an update check, Nimbalyst's patch marker, a database and a fake door. The page side
// renders the Home parts on a small DOM stand-in, fed with those answers, and reads the produced elements.
// Run: node tests/test-phone-page.mjs
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");
const PAGE = path.join(ROOT, "phone", "page");

let pass = 0;
let failed = 0;
// Cases of Windows-only behaviour (the installed Nimbalyst version is read from its per-user Windows
// install; drive-letter paths), skipped on other systems.
const WINDOWS_ONLY = [
  "pc.status with Nimbalyst closed",
  "pc.status has nimbalystVersion",
  "without a patch marker Nimbalyst",
  "the version line shows the version",
];
const check = (name, ok, extra = "") => {
  if (
    process.platform !== "win32" &&
    WINDOWS_ONLY.some((w) => name.startsWith(w))
  ) {
    console.log(`skip ${name} (Windows only)`);
    return;
  }
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 500);
const tick = () => new Promise((r) => setTimeout(r, 20));

// ---- a temp home: the files library finds everything through os.homedir(), APPDATA and LOCALAPPDATA
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-page-"));
const home = path.join(tmp, "home");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
});
// Where the PC program looks for Nimbalyst's data (core/files.mjs nimbalystDir), on each system.
const NIM =
  process.platform === "win32"
    ? path.join(process.env.APPDATA, "@nimbalyst", "electron")
    : path.join(
        os.homedir(),
        ...(process.platform === "darwin"
          ? ["Library", "Application Support"]
          : [".config"]),
        "@nimbalyst",
        "electron",
      );
const RES = path.join(
  process.env.LOCALAPPDATA,
  "Programs",
  "Nimbalyst",
  "resources",
);
const UPDATE_CHECK = path.join(home, ".claude", "update-check.json");
for (const d of [path.join(NIM, "sqlite-db"), RES, path.dirname(UPDATE_CHECK)])
  fs.mkdirSync(d, { recursive: true });
const writeJson = (file, v) => fs.writeFileSync(file, JSON.stringify(v));
writeJson(UPDATE_CHECK, { latest: "26.2", installed: "26.1" });
writeJson(path.join(RES, "ai-coding-setup-patched.json"), {
  version: "0.83.0",
  patches: ["updater-block"],
});

// ---- the fixture database: one session that needs the user, one working, one finished, one elsewhere
// The project folders exist: projects.list leaves out a project whose folder is gone.
const P = { alpha: path.join(tmp, "alpha"), beta: path.join(tmp, "beta") };
for (const p of Object.values(P)) fs.mkdirSync(p, { recursive: true });
const fx = new DatabaseSync(path.join(NIM, "sqlite-db", "nimbalyst.sqlite"));
fx.exec(`
  CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
    provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
    is_archived INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL);
  CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'claude-code', direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
  CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
`);
let idn = 0;
const addSession = (workspace, title, status, minutesAgo, metadata = "{}") => {
  idn++;
  const id = `00000000-0000-4000-8000-${idn.toString(16).padStart(12, "0")}`;
  const at = new Date(Date.now() - minutesAgo * 60000).toISOString();
  fx.prepare(
    `INSERT INTO ai_sessions (id, workspace_id, title, status, metadata, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, workspace, title, status, metadata, at, at);
  return id;
};
// The working one is the newer, so a list in database order would put it first.
const S = {
  waits: addSession(P.alpha, "Waits on a question", "waiting_for_input", 9),
  works: addSession(
    P.beta,
    "Runs a build",
    "running",
    2,
    JSON.stringify({ phase: "a command (Bash)", currentTasks: [] }),
  ),
  done: addSession(P.alpha, "Finished one", "idle", 1),
  elsewhere: addSession("C:\\Projects\\not-listed", "Not listed", "running", 1),
};
// Six older sessions of alpha (two days old, so Home leaves them out), four of them pinned in Nimbalyst.
const OLDER = [1, 2, 3, 4, 5, 6].map((i) =>
  addSession(P.alpha, `Older ${i}`, "idle", 3000 + i * 60),
);
const PINNED = [OLDER[0], OLDER[2], OLDER[3], OLDER[5]];
for (const id of PINNED)
  fx.prepare("UPDATE ai_sessions SET is_pinned = 1 WHERE id = ?").run(id);

function handle(name, a) {
  if (name === "get_session_status") {
    const waits = a.sessionId === S.waits;
    return {
      status: waits ? "waiting_for_input" : "running",
      waitingForInput: waits,
    };
  }
  if (name === "get_session_result")
    return {
      status: "waiting_for_input",
      pendingPrompt: {
        promptId: "prompt-1",
        promptType: "ask_user_question_request",
        content: { questions: [{ question: "Which?", options: [] }] },
      },
    };
  throw new Error(`the fake door has no ${name}`);
}

const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const ctx = {
  page: "ok",
  device: "dev-test",
  setupVersion: "26.1",
  push: () => {},
};
let rn = 0;
const ask = (a, d) => registry.handle({ k: "req", id: `r-${++rn}`, a, d }, ctx);

const answers = {};
let door = null;
let failure = null;
try {
  // ---- pc.status with Nimbalyst closed: the read-only fields, and null where Nimbalyst must be open
  const closed = await ask("pc.status");
  check(
    "pc.status with Nimbalyst closed: versions read, sessionsOpen and door null",
    closed.ok &&
      closed.d.nimbalyst === "closed" &&
      closed.d.nimbalystVersion === "0.83.0" &&
      closed.d.update?.version === "26.2" &&
      closed.d.sessionsOpen === null &&
      closed.d.door === null,
    show(closed),
  );
  const pcLog = fs.readFileSync(
    path.join(home, ".phone-app", "pc.log"),
    "utf8",
  );
  check(
    "a field that can't be read has its reason in the log",
    /sessionsOpen unread: Nimbalyst is closed/.test(pcLog) &&
      /door unread: Nimbalyst is closed/.test(pcLog),
    pcLog.slice(-400),
  );
  answers.closed = closed.d;

  // ---- open: the four fields from the fixtures
  door = await startFakeDoor({
    endpointFile: path.join(NIM, "mcp-endpoint.json"),
    workspaces: Object.entries(P).map(([name, p]) => ({ name, path: p })),
    tools: [
      "get_session_status",
      "get_session_result",
      "answer_form",
      "stop_session",
    ],
    handle,
  });
  const open = await ask("pc.status");
  check(
    "pc.status has nimbalystVersion, update, sessionsOpen and door from the fixtures",
    open.ok &&
      open.d.nimbalyst === "open" &&
      open.d.setupVersion === "26.1" &&
      open.d.nimbalystVersion === "0.83.0" &&
      open.d.update?.version === "26.2" &&
      open.d.sessionsOpen === 2 &&
      show(open.d.door) ===
        show({
          answerForm: true,
          stopSession: true,
          removeQueuedPrompt: false,
          answerPlan: false,
          setSessionPinned: false,
        }),
    show(open),
  );
  answers.open = open.d;

  writeJson(UPDATE_CHECK, { latest: "26.1" });
  const same = await ask("pc.status");
  writeJson(UPDATE_CHECK, { latest: "1.0.114" });
  const older = await ask("pc.status");
  check(
    "update is null when the newest released version is not newer",
    same.ok && same.d.update === null && older.ok && older.d.update === null,
    show({ same: same.d?.update, older: older.d?.update }),
  );
  answers.current = same.d;

  fs.rmSync(UPDATE_CHECK);
  const noCheck = await ask("pc.status");
  writeJson(UPDATE_CHECK, { latest: "not a version" });
  const badCheck = await ask("pc.status");
  check(
    "no stored update check, or one without a version: update null, not a guess",
    noCheck.ok &&
      noCheck.d.update === null &&
      badCheck.ok &&
      badCheck.d.update === null,
    show({ noCheck, badCheck }),
  );

  fs.rmSync(path.join(RES, "ai-coding-setup-patched.json"));
  writeJson(path.join(RES, "package.json"), {
    name: "@nimbalyst/electron",
    version: "0.84.1",
  });
  const unpatched = await ask("pc.status");
  writeJson(path.join(RES, "package.json"), { name: "other", version: "9.9" });
  const foreign = await ask("pc.status");
  check(
    "without a patch marker Nimbalyst's version comes from its own package.json, and only from Nimbalyst's",
    unpatched.d.nimbalystVersion === "0.84.1" &&
      foreign.ok &&
      foreign.d.nimbalystVersion === null,
    show({ unpatched: unpatched.d, foreign: foreign.d }),
  );

  const sessions = await ask("home.sessions");
  const projects = await ask("projects.list");
  check(
    "home.sessions and projects.list answer from the fixtures",
    sessions.ok && projects.ok && sessions.d.needsYou.length === 1,
    show({ sessions, projects }),
  );
  answers.sessions = sessions.d;
  answers.projects = projects.d;
  const pinList = await ask("sessions.list", {
    project: projects.d.find((p) => p.name === "alpha").project,
    page: 1,
  });
  check(
    "sessions.list from the fixture database: the 4 pinned sessions first, each with pinned true",
    pinList.ok &&
      show(pinList.d.items.slice(0, 4).map((s) => s.session)) ===
        show([PINNED[0], PINNED[1], PINNED[2], PINNED[3]]) &&
      pinList.d.items.slice(4).every((s) => s.pinned === false),
    show(pinList),
  );
  answers.pinList = pinList.d;
} catch (e) {
  failure = e;
} finally {
  await door?.close();
  fx.close();
  (await import("../skills/phone-bot/pc/core/db.mjs")).closeDb();
}

// ---- the page side: a DOM stand-in with what frame/dom.js and the Home files use
class FakeNode {
  constructor() {
    this.childNodes = [];
  }
  append(...kids) {
    for (const k of kids)
      this.childNodes.push(k instanceof FakeNode ? k : new FakeText(String(k)));
  }
  replaceChildren(...kids) {
    this.childNodes = [];
    this.append(...kids);
    FakeNode.changed?.();
  }
  get childElementCount() {
    return this.childNodes.filter((c) => c instanceof FakeElement).length;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
}
class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.className = "";
    this.attrs = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({});
  }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (_ns, tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
};

const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
const hasClass = (n, c) => n.className?.split(" ").includes(c);
const byClass = (root, c) => walk(root).filter((n) => hasClass(n, c));

const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
const screens = await import(pageUrl("frame/screens.js"));
await import(pageUrl("screens/home.js"));
await import(pageUrl("screens/home-sessions.js"));
// The session screen comes in a later step; a stand-in lets the rows open.
screens.registerScreen({
  id: "session",
  tab: null,
  title: "Session",
  render: () => new FakeElement("div"),
  actions: [],
});

// Draws Home with the PC answering from `fixed`; returns the drawn element, the asks and the go() calls.
async function drawHome(fixed, { connected = true } = {}) {
  const asked = [];
  const gone = [];
  const c = {
    connected,
    params: {},
    offered: () => true,
    ask: async (action) => {
      asked.push(action);
      if (!(action in fixed)) return { ok: false, err: "unknown-action" };
      return { ok: true, d: fixed[action] };
    },
    go: (id, params) => gone.push({ id, params }),
    onEvent: () => {},
    haptic: () => {},
    mainButton: () => {},
  };
  const root = screens.screen("home").render(c);
  await tick();
  return { root, asked, gone };
}

// ---- the frame (frame/app.js) on stand-ins for Telegram, the key store and the sealed channel, and on a scroll box
// (#content, the one thing that scrolls) whose layout is counted: a row is 60 px, the rest of a screen 400 px, the
// box 700 px high. As in a browser, the box's scroll never passes its end, so a short screen in between loses the
// place.
const ROW_PX = 60;
const frameFake = { events: {}, back: null, asked: [], pc: null };
globalThis.frameFake = frameFake;
const els = Object.fromEntries(
  [
    "app",
    "fatal",
    "content",
    "bottom",
    "bottom-extra",
    "tabbar",
    "main-btn",
  ].map((id) => [id, new FakeElement("div")]),
);
const shownRows = () => byClass(els.content, "row");
const pageEnd = () => Math.max(0, 400 + ROW_PX * shownRows().length - 700);
const box = els.content;
let boxY = 0;
Object.defineProperty(box, "scrollTop", {
  get: () => boxY,
  set: (y) => {
    boxY = Math.max(0, Math.min(y, pageEnd()));
  },
});
// Where a row sits in the box, in px from its top.
const rowTop = (row) => 200 + ROW_PX * shownRows().indexOf(row) - box.scrollTop;
const watchers = new Set();
class FakeObserver {
  constructor(cb) {
    this.cb = cb;
  }
  observe(node) {
    this.node = node;
    watchers.add(this);
  }
  disconnect() {
    watchers.delete(this);
  }
}
// The user scrolls to the list's end: the watched last line of the screen in view comes into sight.
async function scrollToEnd() {
  const inView = walk(els.content);
  for (const w of [...watchers])
    if (inView.includes(w.node)) w.cb([{ isIntersecting: true }]);
  await tick();
}

const APP_URL = pageUrl("frame/app.js");
const STAND_INS = {
  [pageUrl("screens.generated.js")]: 'export const PAGE_VERSION = "test";',
  [pageUrl("frame/telegram.js")]: `const f = globalThis.frameFake;
export const startTelegram = () => ({ initData: "signed", isVersionAtLeast: () => true,
  onEvent: (name, fn) => { f.events[name] = fn; } });
export const hasHost = () => true;
export const haptic = () => {};
export const setMainButton = () => {};
export const setBackButton = (_tg, onBack) => { f.back = onBack; };`,
  [pageUrl("frame/zoom.js")]: `const f = globalThis.frameFake;
export const setZoom = (on) => { f.zoom = on; };
export const lockGestures = () => { f.gesturesLocked = true; };`,
  [pageUrl("frame/keystore.js")]:
    `export const loadPairing = async () => ({ K: "key", pcId: "pc", dev: "dev" });
export const restorePairing = async () => null;
export const savePairing = async () => "test";
export const forgetPairing = async () => {};`,
  [pageUrl("frame/channel.js")]: `const f = globalThis.frameFake;
export class ChannelError extends Error {
  constructor(code, extra = {}) { super(code); this.code = code; this.extra = extra; }
}
export const socketUrl = () => "wss://relay.test/";
// f.linkFail (a code) fails the socket's opening, f.helloFail ({ code, extra }) the hello; f.link is the last
// link (its listeners get relay frames), f.end(code) ends the session up now. f.opens counts the sockets asked
// for; f.linkWait (a promise) holds each opening until it settles; f.helloPage is the page word in the hello.
export const openLink = async () => {
  f.opens = (f.opens ?? 0) + 1;
  if (f.linkWait) await f.linkWait;
  if (f.linkFail) throw new ChannelError(f.linkFail);
  const link = { listeners: new Set(), closed: null, listen(fn) { link.listeners.add(fn); },
    close() { link.closed = {}; }, drop() { link.closed = {}; } };
  f.link = link;
  return link;
};
export const pair = async () => { throw new Error("no pairing in this test"); };
export const join = async () => { throw new Error("no device join in this test"); };
export const openSession = async () => {
  if (f.helloFail) throw new ChannelError(f.helloFail.code, f.helloFail.extra);
  let end;
  const ended = new Promise((r) => { end = r; });
  f.end = (code) => end(new ChannelError(code));
  return { hello: { page: f.helloPage ?? "ok" }, ended, bye: async () => {}, ask: (a, d) => f.pc(a, d),
    sendStream: async () => { throw new Error("no recordings in this test"); } };
};`,
};
registerHooks({
  resolve(specifier, context, next) {
    const code =
      context.parentURL === APP_URL &&
      STAND_INS[new URL(specifier, APP_URL).href];
    if (code)
      return {
        url: `data:text/javascript,${encodeURIComponent(code)}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});

async function startFrame() {
  const ago = (i) => new Date(Date.now() - i * 60000).toISOString();
  const projects = Array.from({ length: 40 }, (_, i) => ({
    project: `p${i}`,
    name: `project ${i}`,
    lastUsed: ago(i),
    pinned: false,
    needsYou: 0,
    working: 0,
  }));
  const sessions = Array.from({ length: 70 }, (_, i) => ({
    session: `s${i}`,
    title: `session ${i}`,
    state: "idle",
    updatedAt: ago(i),
  }));
  frameFake.pc = async (a, d) => {
    frameFake.asked.push(a === "sessions.list" ? `${a} ${d.page}` : a);
    if (a === "projects.list") return { ok: true, d: projects };
    if (a === "sessions.list")
      return {
        ok: true,
        d: {
          items: sessions.slice((d.page - 1) * 20, d.page * 20),
          total: sessions.length,
        },
      };
    if (a === "pc.status") return { ok: true, d: answers.open };
    if (a === "home.sessions") return { ok: true, d: answers.sessions };
    return { ok: false, err: "unknown-action" };
  };
  els.fatal.hidden = true;
  Object.assign(globalThis.document, {
    hidden: false,
    getElementById: (id) => {
      if (!els[id]) throw new Error(`the test page has no #${id}`);
      return els[id];
    },
    addEventListener: () => {},
  });
  // The window's events: "online" and "pageshow" reconnect at once.
  frameFake.win = {};
  globalThis.addEventListener = (type, fn) => {
    frameFake.win[type] = fn;
  };
  globalThis.location = new URL("https://page.test/");
  globalThis.IntersectionObserver = FakeObserver;
  FakeNode.changed = () => {
    box.scrollTop = boxY;
  };
  await import(pageUrl("screens/projects.js"));
  await import(APP_URL);
  for (let i = 0; i < 5; i++) await tick();
  if (!els.fatal.hidden)
    throw new Error(`the frame stopped: ${els.fatal.textContent}`);
}

const PAGE_FILES = ["screens/home.js", "screens/home-sessions.js"];
try {
  if (failure) throw failure;
  // A door refusal as the PC's registry sends it: the reason rides beside the code word, not under `extra`.
  await import(pageUrl("screens/projects.js"));
  const refused = screens.screen("projects").render({
    connected: true,
    params: {},
    offered: () => true,
    ask: async () => ({
      ok: false,
      err: "door-error",
      message: "Workspace not found: C:\\gone",
    }),
    go: () => {},
    onEvent: () => {},
    haptic: () => {},
    mainButton: () => {},
  });
  await tick();
  check(
    "a door refusal shows its reason after the code word",
    refused.textContent.includes("door-error (Workspace not found: C:\\gone)"),
    refused.textContent,
  );
  check(
    "Home is the home tab's screen, its parts in DS1's order",
    screens.screen("home").tab === "home" &&
      show(screens.homeParts().map((p) => p.id)) ===
        show(["pc-status", "version", "needs-you", "working"]),
    show(screens.homeParts().map((p) => [p.id, p.order])),
  );

  const live = await drawHome({
    "pc.status": answers.open,
    "home.sessions": answers.sessions,
    "projects.list": answers.projects,
  });
  const text = live.root.textContent;
  const at = (s) => text.indexOf(s);
  check(
    "the PC line says the PC is on and Nimbalyst open, with the sessions open",
    text.includes("PC on · Nimbalyst open") && text.includes("2 sessions open"),
    text,
  );
  const version = byClass(live.root, "version")[0]?.textContent ?? "";
  check(
    "the version line shows the version the PC is on and the newer one available",
    version.includes("PC program: setup 26.1") &&
      version.includes("Nimbalyst 0.83.0") &&
      version.includes("PC program update: setup 26.2") &&
      version.includes("run /update-setup"),
    version,
  );
  check(
    "order: PC status, version line, Needs you, Working",
    at("PC on") < at("PC program:") &&
      at("PC program:") < at("Needs you") &&
      at("Needs you") < at("Working"),
    text,
  );
  check(
    "a session that needs the user is listed above a working one",
    at("Waits on a question") >= 0 &&
      at("Waits on a question") < at("Runs a build"),
    text,
  );
  check(
    "rows name their project, the waiting kind and what a working one does",
    text.includes("alpha · 1 question") && text.includes("a command (Bash)"),
    text,
  );
  const rows = byClass(live.root, "row");
  rows.find((r) => r.attrs["data-session"] === S.waits)?.click();
  rows.find((r) => r.attrs["data-session"] === S.works)?.click();
  check(
    "each row opens its session with go()",
    show(live.gone.map((g) => g.params.session)) === show([S.waits, S.works]) &&
      live.gone.every((g) => g.id === "session") &&
      live.gone[0].params.project === answers.sessions.needsYou[0].project,
    show(live.gone),
  );
  check(
    "no Start Nimbalyst while it is open",
    !walk(live.root).some(
      (n) => n.attrs?.["data-action"] === "nimbalyst.start",
    ),
  );

  const current = await drawHome({
    "pc.status": answers.current,
    "home.sessions": answers.sessions,
  });
  const v2 = byClass(current.root, "version")[0]?.textContent ?? "";
  check(
    "no update line when the PC is on the newest version",
    v2.includes("PC program: setup 26.1") && !v2.includes("update"),
    v2,
  );

  const shut = await drawHome({
    "pc.status": answers.closed,
    "nimbalyst.start": { state: "starting" },
  });
  const startBtn = walk(shut.root).find(
    (n) => n.attrs?.["data-action"] === "nimbalyst.start",
  );
  check(
    "with Nimbalyst closed: Start Nimbalyst, and the sessions as last known, opening nothing",
    shut.root.textContent.includes("PC on · Nimbalyst closed") &&
      startBtn?.textContent === "Start Nimbalyst" &&
      shut.root.textContent.includes("Last known") &&
      shut.root.textContent.includes("Waits on a question") &&
      !shut.asked.includes("home.sessions") &&
      !walk(shut.root).some((n) => n.attrs?.role === "button"),
    shut.root.textContent,
  );
  startBtn?.click();
  await tick();
  check(
    "Start sends nimbalyst.start, then the block says it is starting",
    shut.asked.includes("nimbalyst.start") &&
      shut.root.textContent.includes("PC on · Nimbalyst starting"),
    show(shut.asked) + shut.root.textContent,
  );

  const off = await drawHome({}, { connected: false });
  check(
    "with the PC out of reach: no question asked, the version line and last known sessions stay",
    off.asked.length === 0 &&
      off.root.textContent.includes("PC program: setup") &&
      off.root.textContent.includes("Last known") &&
      off.root.textContent.includes("Answers and new sessions need the PC on."),
    off.root.textContent,
  );

  // ---- Back and a reconnect return to the place the user left
  await startFrame();
  walk(els.tabbar)
    .find((n) => n.tagName === "button" && n.textContent === "Projects")
    .click();
  await tick();
  box.scrollTop = 800;
  const listedAt = box.scrollTop;
  shownRows()
    .find((r) => r.attrs["data-project"] === "p0")
    .click();
  await tick();
  const projectAt = box.scrollTop;
  frameFake.back();
  await tick();
  check(
    "Projects scrolled to 800 px, a project opened at the top, Back: Projects is at 800 px again",
    listedAt === 800 &&
      projectAt === 0 &&
      box.scrollTop === 800 &&
      shownRows()[0]?.attrs["data-project"] !== undefined,
    show({ listedAt, projectAt, back: box.scrollTop }),
  );

  shownRows()
    .find((r) => r.attrs["data-project"] === "p1")
    .click();
  await tick();
  await scrollToEnd();
  await scrollToEnd();
  const loaded = shownRows().length;
  const row55 = shownRows()[54];
  const id55 = row55.attrs["data-session"];
  box.scrollTop = 200 + ROW_PX * 54 - 300;
  const placeBefore = rowTop(row55);
  const placeNow = () => {
    const r = shownRows().find((n) => n.attrs["data-session"] === id55);
    return r ? rowTop(r) : null;
  };
  const near = (p) => p !== null && Math.abs(p - placeBefore) <= 2;
  const zoomInList = frameFake.zoom;
  row55.click();
  await tick();
  const zoomInChat = frameFake.zoom;
  let from = frameFake.asked.length;
  frameFake.back();
  const atOnce = { rows: shownRows().length, place: placeNow() };
  await tick();
  check(
    "pinch zoom: locked on a project's list, open on the session's chat, locked again after Back (FAIL: a screen besides the chat zooms, or the chat doesn't)",
    frameFake.gesturesLocked === true &&
      zoomInList === false &&
      zoomInChat === true &&
      frameFake.zoom === false,
    show({
      locked: frameFake.gesturesLocked,
      zoomInList,
      zoomInChat,
      afterBack: frameFake.zoom,
    }),
  );
  const afterBack = {
    rows: shownRows().length,
    place: placeNow(),
    asked: frameFake.asked.slice(from),
  };
  const PAGES_1_TO_3 = show([
    "sessions.list 1",
    "sessions.list 2",
    "sessions.list 3",
  ]);
  check(
    "a project with 60 sessions loaded, scrolled to its 55th row, a session opened, Back: the 60 rows at once and that row in its place",
    loaded === 60 &&
      atOnce.rows === 60 &&
      near(atOnce.place) &&
      afterBack.rows === 60 &&
      near(afterBack.place),
    show({ loaded, placeBefore, atOnce, afterBack }),
  );
  check(
    "on that return the project asks again for the three pages it holds, not page 1 only",
    show(afterBack.asked) === PAGES_1_TO_3,
    show(afterBack.asked),
  );

  from = frameFake.asked.length;
  frameFake.events.deactivated();
  await tick();
  frameFake.events.activated();
  for (let i = 0; i < 3; i++) await tick();
  const afterReconnect = {
    rows: shownRows().length,
    place: placeNow(),
    asked: frameFake.asked.slice(from),
  };
  check(
    "a reconnect redraws the project with its 60 rows, the three pages asked again and the 55th row in its place",
    afterReconnect.rows === 60 &&
      near(afterReconnect.place) &&
      show(afterReconnect.asked) === PAGES_1_TO_3,
    show({ placeBefore, afterReconnect }),
  );

  // ---- session and project pins: hold a row, Pin or Unpin, moved at once and back on a refusal
  const basePc = frameFake.pc;
  const pinAsks = [];
  const pin = { door: true, answer: null, release: null };
  frameFake.pc = async (a, d) => {
    if (a === "sessions.list" && d.project === "p2") {
      frameFake.asked.push(`${a} ${d.page}`);
      return { ok: true, d: { ...answers.pinList, page: d.page } };
    }
    if (a === "pc.status")
      return {
        ok: true,
        d: {
          ...answers.open,
          door: { ...answers.open.door, setSessionPinned: pin.door },
        },
      };
    if (a === "sessions.pin" || a === "projects.pin") {
      pinAsks.push({ a, d });
      // The PC answers once the test lets it, so the row's place before the answer can be seen.
      await new Promise((r) => {
        pin.release = r;
      });
      return pin.answer;
    }
    return basePc(a, d);
  };
  const HOLD_WAIT = () => new Promise((r) => setTimeout(r, 560));
  async function holdRow(attr, id) {
    const row = shownRows().find((r) => r.attrs[attr] === id);
    if (!row) throw new Error(`no row with ${attr} ${id}`);
    row.listeners.pointerdown[0]({ clientX: 5, clientY: 5 });
    await HOLD_WAIT();
    await tick();
  }
  const menuPick = () => byClass(els.content, "hold-pick")[0];
  // The heading of the group a row sits in.
  const groupOf = (attr, id) => {
    const g = byClass(els.content, "group").find((n) =>
      walk(n).some((k) => k.attrs?.[attr] === id),
    );
    return g ? byClass(g, "g-head")[0].childNodes[0].textContent : null;
  };
  const sessionGroup = (id) => groupOf("data-session", id);

  frameFake.back();
  await tick();
  shownRows()
    .find((r) => r.attrs["data-project"] === "p2")
    .click();
  for (let i = 0; i < 3; i++) await tick();
  const firstHead = byClass(els.content, "g-head")[0]?.childNodes[0]
    .textContent;
  check(
    "the 4 sessions pinned in the fixture database show under Pinned, the first group",
    firstHead === "Pinned" &&
      PINNED.every((id) => sessionGroup(id) === "Pinned") &&
      [S.waits, S.done, OLDER[1], OLDER[4]].every(
        (id) => sessionGroup(id) !== "Pinned",
      ),
    show({ firstHead, groups: PINNED.map(sessionGroup) }),
  );

  // Pin with the door tool: the row moves at once, and stays after the PC's answer.
  await holdRow("data-session", OLDER[1]);
  const pinWord = menuPick()?.textContent;
  pin.answer = { ok: true, d: { pinned: true } };
  menuPick().click();
  await tick();
  const movedAtOnce = sessionGroup(OLDER[1]);
  pin.release();
  for (let i = 0; i < 2; i++) await tick();
  check(
    "a hold opens Pin; Pin asks sessions.pin with the session and pinned true, and the row is in Pinned before the PC answers",
    pinWord === "Pin" &&
      show(pinAsks.at(-1)) ===
        show({
          a: "sessions.pin",
          d: { session: OLDER[1], pinned: true },
        }) &&
      movedAtOnce === "Pinned" &&
      sessionGroup(OLDER[1]) === "Pinned",
    show({ pinWord, asked: pinAsks.at(-1), movedAtOnce }),
  );

  // Unpin refused by the door: out of Pinned at once, back in with the reason line.
  await holdRow("data-session", PINNED[0]);
  const unpinWord = menuPick()?.textContent;
  pin.answer = {
    ok: false,
    err: "door-error",
    message: "set_session_pinned: no such session",
  };
  menuPick().click();
  await tick();
  const outAtOnce = sessionGroup(PINNED[0]);
  pin.release();
  for (let i = 0; i < 2; i++) await tick();
  const note = byClass(els.content, "pin-note")[0]?.textContent;
  check(
    "Unpin moves the row out at once; a door refusal moves it back with a line giving the reason",
    unpinWord === "Unpin" &&
      outAtOnce !== "Pinned" &&
      sessionGroup(PINNED[0]) === "Pinned" &&
      note ===
        "Could not unpin it: door-error (set_session_pinned: no such session)",
    show({ unpinWord, outAtOnce, note }),
  );

  // Without the door tool: Pin is greyed with the reason, and a tap on it moves and asks nothing.
  pin.door = false;
  const asksBefore = pinAsks.length;
  await holdRow("data-session", OLDER[4]);
  const greyed = menuPick();
  const why = byClass(els.content, "hold-why")[0]?.textContent;
  greyed.click();
  await tick();
  check(
    "without set_session_pinned Pin is greyed with the reason, and nothing moves or is asked",
    greyed.disabled === true &&
      why === "Pin needs the door patch on the PC" &&
      sessionGroup(OLDER[4]) !== "Pinned" &&
      pinAsks.length === asksBefore,
    show({ disabled: greyed.disabled, why, asked: pinAsks.slice(asksBefore) }),
  );

  // A project row: the hold pins it through projects.pin, into the Pinned group at once.
  frameFake.back();
  await tick();
  await holdRow("data-project", "p3");
  pin.answer = { ok: true, d: { pinned: true } };
  menuPick().click();
  await tick();
  const projectAtOnce = groupOf("data-project", "p3");
  pin.release();
  for (let i = 0; i < 2; i++) await tick();
  check(
    "a hold on a project row pins it through projects.pin, moved into Pinned at once",
    show(pinAsks.at(-1)) ===
      show({ a: "projects.pin", d: { project: "p3", pinned: true } }) &&
      projectAtOnce === "Pinned" &&
      groupOf("data-project", "p3") === "Pinned",
    show({ asked: pinAsks.at(-1), projectAtOnce }),
  );

  // ---- the look: tokens only, nothing under 12 px
  const css = fs.readFileSync(path.join(PAGE, "page.css"), "utf8");
  const mapStart = css.indexOf("/* ---- token mapping */");
  const mapEnd = css.indexOf("/* ---- type ladder");
  const homeCss = css.slice(css.indexOf("/* ---- Home"));
  check(
    "page.css has a token mapping section and a Home section",
    mapStart >= 0 && mapEnd > mapStart && homeCss.length > 0,
  );
  const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const outsideMap = noComments(css.slice(0, mapStart) + css.slice(mapEnd));
  // Colour names as values, not inside a longer name such as white-space.
  const RAW =
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklch|color)\(|(?<![-\w])(?:white|black|red|green|blue|gr[ae]y|orange|yellow)(?![-\w])/;
  const js = PAGE_FILES.map((f) => fs.readFileSync(path.join(PAGE, f), "utf8"));
  const jsCode = (s) => noComments(s).replace(/^\s*\/\/.*$/gm, "");
  const rawIn = [outsideMap, ...js.map(jsCode)]
    .map((s) => s.match(RAW)?.[0])
    .filter(Boolean);
  check(
    "no raw colour value in the Home files or page.css outside the token mapping",
    rawIn.length === 0,
    show(rawIn),
  );
  const sizes = [
    ...css.matchAll(/(?:font-size:\s*|\b\d{3}\s+)(\d+(?:\.\d+)?)px/g),
  ].map((m) => Number(m[1]));
  check(
    "no text under 12 px in page.css, and no sizes set in the Home files",
    sizes.length > 0 &&
      sizes.every((n) => n >= 12) &&
      js.every((s) => !/\d+px|style:/.test(s)),
    show(sizes),
  );

  // ---- the join request card: OK and No stay off for a moment after it shows
  const { askCard, ARM_MS } = await import(pageUrl("screens/device-join.js"));
  const answered = [];
  const joinCard = askCard(
    {
      ask: { rid: "r-arm", kind: "desktop", word: "123456", until: 0 },
      state: null,
      busy: false,
    },
    (ok) => answered.push(ok),
  );
  const joinButtons = () =>
    byClass(joinCard, "join-card-buttons")[0].childNodes.filter(
      (n) => n.tagName === "button",
    );
  const offAtFirst = joinButtons().map((n) => n.disabled);
  await new Promise((r) => setTimeout(r, ARM_MS + 100));
  check(
    "the join card's OK and No are off for a second after it shows, so a tap meant for the screen under it does nothing",
    show(offAtFirst) === show([true, true]) &&
      joinButtons().every((n) => n.disabled === false),
    show({ offAtFirst, after: joinButtons().map((n) => n.disabled) }),
  );

  // ---- the connecting view (phone steady design, section 4): one calm state while the link is down. The clock
  // is moved by hand; "online" (a network change) makes each attempt at once.
  const realNow = Date.now;
  let shift = 0;
  Date.now = () => realNow() + shift;
  const seen = [];
  const linkNow = () => {
    const w = `${byClass(els.content, "connect-view")[0]?.textContent ?? ""}${byClass(els.content, "link-state")[0]?.textContent ?? ""}`;
    const s = w.includes("PC off")
      ? "PC off"
      : w.includes("Connecting")
        ? "Connecting"
        : w
          ? w
          : "screen";
    if (seen.at(-1) !== s) seen.push(s);
    return s;
  };
  const attempt = async (ms, fail = {}) => {
    shift += ms;
    frameFake.linkFail = fail.link ?? null;
    frameFake.helloFail = fail.hello ?? null;
    frameFake.win.online();
    for (let i = 0; i < 4; i++) await tick();
    return linkNow();
  };
  const offline = {
    hello: {
      code: "pc-offline",
      extra: { lastSeen: new Date(realNow() - 3600_000).toISOString() },
    },
  };
  linkNow();
  frameFake.linkFail = "unreachable";
  frameFake.end("closed");
  for (let i = 0; i < 3; i++) await tick();
  const quiet = linkNow();
  const steps = [
    await attempt(2500, { link: "unreachable" }), // past the quiet 2 s
    await attempt(1000, offline), // the relay's first offline answer
    await attempt(8000, offline),
    await attempt(1000, { link: "closed" }), // a plain drop between the offline answers
    await attempt(8000, offline), // held 17 s
  ];
  const keptView = els.content.childNodes[0];
  const offAt = await attempt(4000, offline); // held 21 s
  const offKept = els.content.childNodes[0] === keptView;
  const afterOff = [
    await attempt(1000, { link: "closed" }),
    await attempt(60_000, { link: "unreachable" }),
    await attempt(1000, { hello: { code: "timeout" } }),
  ];
  const back = await attempt(1000);
  check(
    "the status never flips between Connecting and PC off: quiet first, then Connecting, then PC off once the relay said offline for 20 s, kept through drops until a good hello",
    quiet === "screen" &&
      show(seen) === show(["screen", "Connecting", "PC off", "screen"]) &&
      steps.every((s) => s === "Connecting") &&
      offAt === "PC off" &&
      afterOff.every((s) => s === "PC off") &&
      back === "screen",
    show({ quiet, steps, offAt, afterOff, back, seen }),
  );
  check(
    'from Connecting to "PC off" the kept screen stays as it was: only the card on top changes',
    offKept,
    show({ offKept }),
  );

  seen.length = 0;
  frameFake.linkFail = "unreachable";
  frameFake.end("closed");
  for (let i = 0; i < 3; i++) await tick();
  const noWord = [];
  for (const fail of [
    { link: "unreachable" },
    { link: "closed" },
    { hello: { code: "timeout" } },
    { hello: { code: "closed" } },
    { link: "unreachable" },
    { link: "unreachable" },
    { link: "unreachable" },
  ])
    noWord.push(await attempt(15_000, fail));
  const longLine = byClass(els.content, "link-state")[0]?.textContent ?? "";
  check(
    '"PC off" shows only on the relay\'s offline word: 105 s of failed sockets, closes and hello timeouts stay Connecting',
    noWord.every((s) => s === "Connecting") && !seen.includes("PC off"),
    show({ noWord, seen }),
  );
  check(
    "connecting 30 s without reaching the relay names both causes: the phone's internet or the connection service",
    longLine.includes(
      "This phone's internet or the connection service may be down.",
    ),
    longLine,
  );

  // ---- Try again under the long line: one new attempt at once, "Trying…" and off while it runs, so a second tap
  // asks for nothing more; afterwards it can be tapped again.
  const tryBtn = () =>
    walk(els.content).find(
      (n) => n.tagName === "button" && /Try again|Trying/.test(n.textContent),
    );
  let letGo;
  frameFake.linkWait = new Promise((r) => {
    letGo = r;
  });
  const opensBefore = frameFake.opens;
  tryBtn()?.click();
  await tick();
  tryBtn()?.click();
  await tick();
  const during = {
    opens: frameFake.opens - opensBefore,
    text: tryBtn()?.textContent,
    disabled: tryBtn()?.disabled,
  };
  frameFake.linkWait = null;
  letGo();
  shift += 2500;
  await new Promise((r) => setTimeout(r, 1100)); // the frame's 1 s status tick
  const after = { text: tryBtn()?.textContent, disabled: tryBtn()?.disabled };
  check(
    "Try again starts one attempt and is busy while it runs: a second tap does nothing extra",
    during.opens === 1 &&
      during.text === "Trying…" &&
      during.disabled === true &&
      after.text === "Try again" &&
      !after.disabled,
    show({ during, after }),
  );

  // ---- against a 26.3 PC (its hello calls the page unverified): the screen at full strength under the read-only
  // line, only its controls that act are off
  frameFake.helloPage = "unverified";
  await attempt(1000);
  walk(els.tabbar)
    .find((n) => n.tagName === "button" && n.textContent === "Projects")
    .click();
  await tick();
  const view = els.content.childNodes[0];
  const screenBody = view.childNodes.at(-1);
  const readOnlyCss = css.match(/\.read-only\s+:is\(([^)]*)\)\s*\{([^}]*)\}/);
  check(
    "read-only: the list is not dimmed (no kept or dimmed look on the screen) while its controls that act are off",
    screenBody.className === "read-only" &&
      els["bottom-extra"].className === "read-only" &&
      shownRows().length > 0 &&
      view.textContent.includes("You can look, not act") &&
      /button/.test(readOnlyCss?.[1] ?? "") &&
      /\[data-action\]/.test(readOnlyCss?.[1] ?? "") &&
      /pointer-events:\s*none/.test(readOnlyCss?.[2] ?? "") &&
      !/^\.read-only\s*\{/m.test(css),
    show({ cls: screenBody.className, rule: readOnlyCss?.[0] }),
  );
  frameFake.helloPage = null;
  await attempt(1000);
  Date.now = realNow;

  // ---- The zoom lock itself (frame/zoom.js) on a stand-in document, and the page's own start state
  const zoom = await import(pageUrl("frame/zoom.js"));
  const zoomDoc = {
    tag: { content: "" },
    classes: new Set(),
    listeners: {},
  };
  zoomDoc.tag.setAttribute = (k, v) => {
    zoomDoc.tag[k] = v;
  };
  const pageDoc = globalThis.document;
  globalThis.document = {
    querySelector: (q) => (q === 'meta[name="viewport"]' ? zoomDoc.tag : null),
    documentElement: {
      classList: {
        toggle: (c, on) =>
          on ? zoomDoc.classes.add(c) : zoomDoc.classes.delete(c),
      },
    },
    addEventListener: (type, fn, opts) => {
      zoomDoc.listeners[type] = { fn, passive: opts?.passive };
    },
  };
  zoom.lockGestures();
  const pinch = (type, touches) => {
    let stopped = false;
    zoomDoc.listeners[type].fn({
      touches: { length: touches },
      preventDefault: () => {
        stopped = true;
      },
    });
    return stopped;
  };
  zoom.setZoom(false);
  const locked = {
    content: zoomDoc.tag.content,
    zoomable: zoomDoc.classes.has("zoomable"),
    pinch: pinch("gesturestart", 2),
    twoFingers: pinch("touchmove", 2),
    oneFinger: pinch("touchmove", 1),
  };
  zoom.setZoom(true);
  const opened = {
    content: zoomDoc.tag.content,
    zoomable: zoomDoc.classes.has("zoomable"),
    pinch: pinch("gesturestart", 2),
    twoFingers: pinch("touchmove", 2),
  };
  globalThis.document = pageDoc;
  check(
    "zoom lock: locked = scale 1, no user scaling, pinch and two-finger moves cancelled, one-finger scroll kept; open = scale up to 5, nothing cancelled (FAIL: pages can be pinched or the chat can't)",
    locked.content.includes("maximum-scale=1") &&
      locked.content.includes("user-scalable=no") &&
      !locked.zoomable &&
      locked.pinch &&
      locked.twoFingers &&
      !locked.oneFinger &&
      opened.content.includes("maximum-scale=5") &&
      !opened.content.includes("user-scalable=no") &&
      opened.zoomable &&
      !opened.pinch &&
      !opened.twoFingers &&
      zoomDoc.listeners.touchmove.passive === false,
    show({ locked, opened }),
  );
  const indexHtml = fs.readFileSync(path.join(PAGE, "index.html"), "utf8");
  const pageCss = fs.readFileSync(path.join(PAGE, "page.css"), "utf8");
  check(
    "the page starts locked: index.html's viewport tag is zoom.js's LOCKED, page.css stops pinch outside html.zoomable (FAIL: the page zooms before the frame runs)",
    indexHtml.includes(`content="${zoom.LOCKED}"`) &&
      /html \{\s*touch-action: pan-x pan-y;/.test(pageCss) &&
      /html\.zoomable \{\s*touch-action: auto;/.test(pageCss),
  );
} catch (e) {
  failure = e;
}
if (failure) {
  console.log(`FAIL the run stopped: ${failure.stack}`);
  failed++;
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
