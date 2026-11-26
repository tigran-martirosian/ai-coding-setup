// Tests for the phone page's session view (phone/page/screens/session.js, session-cards.js, frame/markdown.js),
// the Projects screens' files, and their part of page.css. The page's screens run in Node on a DOM stand-in and
// ask the real PC registry, which reads a fixture nimbalyst.sqlite in a temp home and talks to a fake door (a
// local MCP server answering from fixtures and recording every call).
// Run: node tests/test-phone-page-session.mjs
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
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Waits for `fn` to give something true; null after `ms`.
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(20);
  }
}

// A temp home for this whole run; the PC program reads it through os.homedir() and APPDATA.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-page-session-"));
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
fs.mkdirSync(path.join(NIM, "sqlite-db"), { recursive: true });

// Real folders: projects.list leaves out a project whose folder is gone.
const P = {
  alpha: path.join(tmp, "projects", "alpha"),
  beta: path.join(tmp, "projects", "beta"),
};
for (const p of Object.values(P)) fs.mkdirSync(p, { recursive: true });

// ---- the fixture database: the columns the reads use
const fx = new DatabaseSync(path.join(NIM, "sqlite-db", "nimbalyst.sqlite"));
fx.exec(`
  CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
    provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
    is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'claude-code', direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
  CREATE TABLE queued_prompts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
`);
let idn = 0;
const newId = () =>
  `00000000-0000-4000-8000-${(++idn).toString(16).padStart(12, "0")}`;
const addSession = (title, status, provider = null) => {
  const id = newId();
  const now = new Date().toISOString();
  fx.prepare(
    `INSERT INTO ai_sessions (id, workspace_id, title, status, provider_session_id, model, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 'claude-code:opus', ?, ?)`,
  ).run(id, P.beta, title, status, provider, now, now);
  return id;
};
const S = {
  question: addSession("Asks a question", "waiting_for_input"),
  multi: addSession("Asks for several picks", "waiting_for_input"),
  three: addSession("Asks three questions", "waiting_for_input"),
  form: addSession("Waits on a form", "waiting_for_input"),
  running: addSession(
    "Works",
    "running",
    "11111111-2222-4333-8444-555555555555",
  ),
};
// The form: the newest PromptForUserInput tool call of the session, with no result yet.
fx.prepare(
  "INSERT INTO ai_agent_messages (session_id, created_at, direction, content, message_kind) VALUES (?, ?, 'output', ?, 'tool')",
).run(
  S.form,
  new Date().toISOString(),
  JSON.stringify({
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_form_1",
          name: "mcp__nimbalyst__PromptForUserInput",
          input: {
            title: "Release details",
            fields: [{ id: "name", type: "text", label: "Name" }],
          },
        },
      ],
    },
  }),
);
// The working session's transcript: a question, a reply in Markdown, and a tool call.
const talkDir = path.join(
  home,
  ".claude",
  "projects",
  P.beta.replace(/[^A-Za-z0-9]/g, "-"),
);
fs.mkdirSync(talkDir, { recursive: true });
fs.writeFileSync(
  path.join(talkDir, "11111111-2222-4333-8444-555555555555.jsonl"),
  `${[
    { type: "user", message: { content: "Tidy the tests" }, timestamp: "t1" },
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "Done with **two** files, see `a.mjs`." },
          { type: "tool_use", name: "Read" },
        ],
      },
    },
  ]
    .map((l) => JSON.stringify(l))
    .join("\n")}\n`,
);

// ---- the fake door: what each session waits on, and its queue
const door = {
  [S.question]: {
    status: "waiting_for_input",
    pendingPrompt: {
      promptId: "prompt-q-1",
      promptType: "ask_user_question_request",
      content: {
        questions: [
          {
            question: "Which colour?",
            options: [{ label: "Red" }, { label: "Blue (Recommended)" }],
          },
        ],
      },
    },
  },
  [S.multi]: {
    status: "waiting_for_input",
    pendingPrompt: {
      promptId: "prompt-m-1",
      promptType: "ask_user_question_request",
      content: {
        questions: [
          {
            question: "Which parts?",
            multiSelect: true,
            options: [{ label: "Page" }, { label: "Relay" }, { label: "PC" }],
          },
        ],
      },
    },
  },
  [S.three]: {
    status: "waiting_for_input",
    pendingPrompt: {
      promptId: "prompt-3-1",
      promptType: "ask_user_question_request",
      content: {
        questions: [
          {
            question: "Which colour?",
            options: [{ label: "Red" }, { label: "Blue" }, { label: "Green" }],
          },
          {
            question: "Which size?",
            options: [{ label: "Small" }, { label: "Large" }],
          },
          {
            question: "Which extras?",
            multiSelect: true,
            options: [
              { label: "Lid" },
              { label: "Handle" },
              { label: "Strap" },
            ],
          },
        ],
      },
    },
  },
  [S.form]: { status: "waiting_for_input", pendingPrompt: null },
  [S.running]: { status: "running", pendingPrompt: null },
};
const queue = [];
function handle(name, a) {
  const s = door[a.sessionId];
  switch (name) {
    case "workspace_open":
      return "opened";
    case "get_session_status":
      return {
        status: s.status,
        waitingForInput: s.status === "waiting_for_input",
      };
    case "get_session_result":
      return { status: s.status, pendingPrompt: s.pendingPrompt };
    case "list_queued_prompts": {
      const prompts = queue.filter((q) => q.sessionId === a.sessionId);
      return { sessionId: a.sessionId, count: prompts.length, prompts };
    }
    case "send_prompt":
      if (s.status === "idle") {
        s.status = "running";
        return { statusBeforeQueue: "idle", processingTriggered: true };
      }
      queue.push({
        sessionId: a.sessionId,
        id: `queued-${queue.length + 1}`,
        promptPreview: a.prompt.slice(0, 80),
        status: "pending",
        createdAt: Date.now(),
      });
      return { statusBeforeQueue: s.status, processingTriggered: false };
    case "respond_to_prompt":
      s.status = "running";
      s.pendingPrompt = null;
      return { promptId: a.promptId, promptType: a.promptType, success: true };
    default:
      throw new Error(`the fake door has no ${name}`);
  }
}

const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const fake = await startFakeDoor({
  endpointFile: path.join(NIM, "mcp-endpoint.json"),
  workspaces: Object.entries(P).map(([name, p]) => ({ name, path: p })),
  tools: [
    "workspace_open",
    "get_session_status",
    "get_session_result",
    "list_queued_prompts",
    "send_prompt",
    "respond_to_prompt",
  ],
  handle,
});
const callsOf = (name, session) =>
  fake.calls.filter((c) => c.name === name && c.args.sessionId === session);

// ---- the real registry with every action module
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const pcCtx = {
  page: "ok",
  device: "dev-test",
  setupVersion: "0.0.0",
  push: () => {},
};
let rn = 0;
const ask = (a, d) =>
  registry.handle({ k: "req", id: `r-${++rn}`, a, d }, pcCtx);

// ---- the page side: a DOM stand-in with what frame/dom.js and the session files use
class FakeNode {
  constructor() {
    this.childNodes = [];
  }
  append(...kids) {
    for (const k of kids) {
      const n = k instanceof FakeNode ? k : new FakeText(String(k));
      n.parentNode = this;
      this.childNodes.push(n);
    }
  }
  replaceChildren(...kids) {
    this.childNodes = [];
    this.append(...kids);
  }
  // after() and remove(), for the message menu that opens under a held message
  after(n) {
    const kids = this.parentNode.childNodes;
    kids.splice(kids.indexOf(this) + 1, 0, n);
    n.parentNode = this.parentNode;
  }
  remove() {
    const kids = this.parentNode?.childNodes;
    if (kids?.includes(this)) kids.splice(kids.indexOf(this), 1);
    this.parentNode = null;
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
// Layout for the typing box: a line holds 40 characters and is 22 px high. A textarea's height is what the page
// set (its --lines, or the rows attribute the old box wrote); writes counts each height the page set.
const LINE = 22;
const linesOf = (text) =>
  text
    .split("\n")
    .reduce((n, l) => n + Math.max(1, Math.ceil(l.length / 40)), 0);
const heightOf = (f) =>
  (Number(f.style["--lines"]) || Number(f.attrs.rows) || 1) * LINE;
let intoView = 0;
class FakeStyle {
  constructor(owner) {
    this.owner = owner;
  }
  setProperty(k, v) {
    this[k] = String(v);
    this.owner.writes++;
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
    this.value = "";
    this.isConnected = true;
    this.focused = false;
    this.style = new FakeStyle(this);
    this.writes = 0;
    this.scrollTop = 0;
    this.caretMoves = 0;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
    if (k === "rows") this.writes++;
  }
  get scrollHeight() {
    return (
      linesOf(this.tagName === "textarea" ? this.value : this.textContent) *
      LINE
    );
  }
  get clientHeight() {
    return heightOf(this);
  }
  get selectionEnd() {
    return this.value.length;
  }
  set selectionEnd(_) {
    this.caretMoves++;
  }
  set selectionStart(_) {
    this.caretMoves++;
  }
  setSelectionRange() {
    this.caretMoves++;
  }
  scrollIntoView() {
    intoView++;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  fire(type, e = {}) {
    for (const fn of this.listeners[type] || []) fn({ target: this, ...e });
  }
  click() {
    this.fire("click");
  }
  focus() {
    this.focused = true;
    document.activeElement = this;
  }
  blur() {
    this.focused = false;
    if (document.activeElement === this) document.activeElement = null;
  }
}
// The page's own events (pagehide on the window, visibilitychange on the document), fired by the tests.
const pageEvents = {};
const onPage = (type, fn) => (pageEvents[type] ||= []).push(fn);
const firePage = (type) => {
  for (const fn of pageEvents[type] || []) fn({ type });
};
Object.assign(globalThis, {
  Node: FakeNode,
  addEventListener: onPage,
  document: {
    addEventListener: onPage,
    activeElement: null,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
  },
  IntersectionObserver: class {
    observe() {}
    disconnect() {}
  },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
});
// The webview's localStorage, where the message box's drafts and the kept session (frame/cache.js) outlive a
// reopen of the mini app.
const stored = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => stored.set(k, String(v)),
    removeItem: (k) => stored.delete(k),
    get length() {
      return stored.size;
    },
    key: (i) => [...stored.keys()][i] ?? null,
  },
});
// The frame's scroll box with what the session's jump button and scroll place use: 2000 px of chat in an 800 px
// view; scroll events are fired by the tests.
function scrollStandIn(scrollTop = 0) {
  const fns = [];
  return {
    scrollTop,
    scrollHeight: 2000,
    clientHeight: 800,
    addEventListener: (type, fn) => type === "scroll" && fns.push(fn),
    removeEventListener: () => {},
    scrollTo({ top }) {
      this.scrollTop = Math.min(top, this.scrollHeight - this.clientHeight);
    },
    scrolled(y) {
      this.scrollTop = y;
      for (const fn of fns) fn();
    },
  };
}

const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
const hasClass = (n, c) => n.className?.split(" ").includes(c);
const byClass = (root, c) => walk(root).filter((n) => hasClass(n, c));
const byTag = (root, t) => walk(root).filter((n) => n.tagName === t);
const button = (root, test) =>
  byTag(root, "button").find((b) => !b.hidden && test(b));

const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
// The build-only screens.generated.js: only its STORE_SUFFIX is read here, "" as in a plain build; useStoreSuffix
// plays a test-copy build.
const GENERATED = pageUrl("screens.generated.js");
const GENERATED_JS = `export let STORE_SUFFIX = "";
export const useStoreSuffix = (s) => { STORE_SUFFIX = s; };`;
registerHooks({
  resolve(specifier, context, next) {
    if (
      specifier.endsWith("screens.generated.js") &&
      new URL(specifier, context.parentURL).href === GENERATED
    )
      return {
        url: `data:text/javascript,${encodeURIComponent(GENERATED_JS)}`,
        shortCircuit: true,
      };
    return next(specifier, context);
  },
});
const screens = await import(pageUrl("frame/screens.js"));
const { turnsView, drafts, why, newAtEnd, linkWait } = await import(
  pageUrl("screens/session.js")
);
const { timing } = await import(pageUrl("screens/session-cards.js"));
timing.undoMs = 100;

const projects = await ask("projects.list");
const beta = projects.d?.find((p) => p.name === "beta")?.project;

// Draws the session view for `session` with the PC answering through the registry; `root` holds the view and dock.
const drawn = [];
function drawSession(session, title, more = {}) {
  const c = {
    connected: true,
    params: { session, project: beta, title },
    tg: { platform: "ios" },
    offered: () => true,
    ask,
    go: () => {},
    onEvent: () => {},
    beforeSleep: () => () => {},
    haptic: () => {},
    mainButton: () => {},
    // The frame's scroll box (#content), the one thing that scrolls.
    scrollBox: { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 },
    ...more,
  };
  const out = screens.screen("session").render(c);
  drawn.push(out.content);
  const root = new FakeElement("div");
  root.append(out.content, out.bottom);
  return { root, dock: out.bottom, view: out.content };
}

let failure = null;
try {
  check(
    "projects.list names the fixture project",
    projects.ok && Boolean(beta),
    show(projects),
  );

  // ---- a waiting session's card sends the picked answer, after the Undo
  const q = drawSession(S.question, "Asks a question");
  const card = await until(() => byClass(q.dock, "qcard")[0]);
  check(
    "a session waiting on a question shows its card in the dock, the typing box gone",
    card?.attrs["data-kind"] === "question" &&
      card.textContent.includes("Which colour?") &&
      card.textContent.includes("Recommended") &&
      byTag(q.dock, "textarea").length === 0,
    q.dock.textContent,
  );
  button(
    q.dock,
    (b) => b.attrs["data-label"] === "Blue (Recommended)",
  )?.click();
  const undo = q.dock.textContent;
  const qSent = await until(() => callsOf("respond_to_prompt", S.question)[0]);
  check(
    "one tap shows Undo, then sends the picked label unchanged to the door",
    /Undo/.test(undo) &&
      qSent?.args.promptId === "prompt-q-1" &&
      qSent.args.response.answers["Which colour?"] === "Blue (Recommended)",
    show({ undo, qSent }),
  );
  check(
    "once answered, the session works again and the typing box takes the card's place",
    Boolean(
      await until(
        () =>
          byTag(q.dock, "textarea").length === 1 &&
          byClass(q.dock, "qcard").length === 0,
      ),
    ),
    q.dock.textContent,
  );

  // ---- the phone locks during the Undo: the answer goes out before the link closes, once
  door[S.question].status = "waiting_for_input";
  door[S.question].pendingPrompt = {
    ...structuredClone(door[S.multi].pendingPrompt),
    promptId: "prompt-q-2",
  };
  door[S.question].pendingPrompt.content.questions[0].multiSelect = false;
  const hooks = new Set();
  let asleep = false;
  const locked = drawSession(S.question, "Asks a question", {
    ask: (a, d) =>
      asleep ? Promise.reject(new Error("not-connected")) : ask(a, d),
    beforeSleep: (fn) => {
      hooks.add(fn);
      return () => hooks.delete(fn);
    },
  });
  await until(() => byClass(locked.dock, "qcard")[0]);
  timing.undoMs = 400;
  button(locked.dock, (b) => b.attrs["data-label"] === "Relay")?.click();
  timing.undoMs = 100;
  // What app.js does on hide: the waiting sends first, then the link is gone.
  await Promise.allSettled([...hooks].map((fn) => fn()));
  asleep = true;
  await sleep(600);
  const lockedSent = callsOf("respond_to_prompt", S.question).filter(
    (c) => c.args.promptId === "prompt-q-2",
  );
  check(
    "a tapped answer still in its Undo is sent when the phone locks, and only once",
    lockedSent.length === 1 &&
      lockedSent[0].args.response.answers["Which parts?"] === "Relay",
    show(lockedSent),
  );
  asleep = false;

  // ---- a multi-pick question sends every pick
  const m = drawSession(S.multi, "Asks for several picks");
  await until(() => byClass(m.dock, "qcard")[0]);
  button(m.dock, (b) => b.attrs["data-label"] === "Page")?.click();
  button(m.dock, (b) => b.attrs["data-label"] === "PC")?.click();
  const picks = button(m.dock, (b) => b.attrs["data-action"] === "send-picks");
  check(
    "a multi-pick question marks both picks and offers Send 2 picks",
    byClass(m.dock, "sel").length === 2 &&
      picks?.textContent === "Send 2 picks" &&
      !picks.disabled,
    m.dock.textContent,
  );
  picks?.click();
  const mSent = await until(() => callsOf("respond_to_prompt", S.multi)[0]);
  check(
    "Send 2 picks sends both picks at once",
    mSent?.args.promptId === "prompt-m-1" &&
      mSent.args.response.answers["Which parts?"] === "Page, PC",
    show(mSent),
  );

  // ---- a card with three questions is one form: all at once, picks can change, one Send (FQ1)
  const t = drawSession(S.three, "Asks three questions");
  await until(() => byClass(t.dock, "qcard")[0]);
  const inItem = (question, label) =>
    button(
      byClass(t.dock, "qitem").find(
        (i) => i.attrs["data-question"] === question,
      ),
      (b) => b.attrs["data-label"] === label,
    );
  const sendAll = () =>
    button(t.dock, (b) => b.attrs["data-action"] === "send-answers");
  check(
    "a card with three questions shows all three at once, with one Send",
    byClass(t.dock, "qitem").length === 3 &&
      ["Which colour?", "Which size?", "Which extras?"].every((w) =>
        t.dock.textContent.includes(w),
      ) &&
      !t.dock.textContent.includes("1 of 3") &&
      Boolean(sendAll()),
    t.dock.textContent,
  );
  inItem("Which colour?", "Red")?.click();
  inItem("Which size?", "Small")?.click();
  inItem("Which colour?", "Blue")?.click();
  inItem("Which size?", "Small")?.click();
  const sizeItem = () =>
    byClass(t.dock, "qitem").find(
      (i) => i.attrs["data-question"] === "Which size?",
    );
  check(
    "a second tap on a picked option takes the pick back",
    byClass(sizeItem(), "sel").length === 0,
    sizeItem()?.textContent,
  );
  inItem("Which size?", "Large")?.click();
  const colourSel = byClass(
    byClass(t.dock, "qitem").find(
      (i) => i.attrs["data-question"] === "Which colour?",
    ),
    "sel",
  ).map((b) => b.attrs["data-label"]);
  check(
    "an earlier pick can be moved to another option and taken back, and nothing is sent yet",
    colourSel.length === 1 &&
      colourSel[0] === "Blue" &&
      callsOf("respond_to_prompt", S.three).length === 0,
    show({ colourSel, text: t.dock.textContent }),
  );
  check(
    "with one question open, Send is off and reads 2 of 3 answered",
    sendAll()?.disabled === true &&
      sendAll()?.textContent === "2 of 3 answered",
    show({ disabled: sendAll()?.disabled, text: sendAll()?.textContent }),
  );
  // "Type instead" on the colour question, then back: the size pick stays.
  button(
    byClass(t.dock, "qitem").find(
      (i) => i.attrs["data-question"] === "Which colour?",
    ),
    (b) => b.textContent === "Type instead",
  )?.click();
  const typeBox = await until(() => byTag(t.dock, "textarea")[0]);
  typeBox.value = "Teal, please";
  typeBox.fire("input");
  button(t.dock, (b) => b.textContent.includes("Use this answer"))?.click();
  await until(() => byClass(t.dock, "qitem").length === 3);
  const sizeSel = byClass(t.dock, "sel")
    .map((b) => b.attrs["data-label"])
    .filter(Boolean);
  check(
    "a typed answer shows for its own question, and the picks made before Type instead are still there",
    t.dock.textContent.includes("Teal, please") &&
      sizeSel.length === 1 &&
      sizeSel[0] === "Large",
    show({ sizeSel, text: t.dock.textContent }),
  );
  button(
    byClass(t.dock, "qitem").find(
      (i) => i.attrs["data-question"] === "Which size?",
    ),
    (b) => b.textContent === "Type instead",
  )?.click();
  await until(() => byTag(t.dock, "textarea")[0]);
  button(t.dock, (b) => b.textContent === "Back")?.click();
  await until(() => byClass(t.dock, "qitem").length === 3);
  check(
    "Back to the card keeps every answer given so far",
    t.dock.textContent.includes("Teal, please") &&
      byClass(t.dock, "sel").some((b) => b.attrs["data-label"] === "Large"),
    t.dock.textContent,
  );
  // Hide folds the card to its head row so the chat can be read; Show opens it again with every answer kept.
  const tCard = () => byClass(t.dock, "qcard")[0];
  const foldBtn = () =>
    button(t.dock, (b) => b.attrs["data-action"] === "fold");
  const openHead = foldBtn()?.textContent;
  foldBtn()?.click();
  const folded = {
    card: hasClass(tCard(), "folded"),
    words: foldBtn()?.textContent,
    expanded: foldBtn()?.attrs["aria-expanded"],
  };
  foldBtn()?.click();
  check(
    "Hide in the card's head folds it to that row; Show opens it again with the answers kept",
    openHead === "Hide" &&
      folded.card &&
      folded.words === "Show" &&
      folded.expanded === "false" &&
      byClass(tCard().childNodes[0], "qfold").length === 1 &&
      !hasClass(tCard(), "folded") &&
      foldBtn()?.attrs["aria-expanded"] === "true" &&
      t.dock.textContent.includes("Teal, please") &&
      byClass(t.dock, "sel").some((b) => b.attrs["data-label"] === "Large"),
    show({ openHead, folded, text: t.dock.textContent }),
  );
  button(t.dock, (b) => b.attrs["data-action"] === "unset-typed")?.click();
  check(
    "a tap on the typed answer takes it back, and that question is open again",
    !t.dock.textContent.includes("Teal, please") &&
      sendAll()?.textContent === "1 of 3 answered",
    t.dock.textContent,
  );
  button(
    byClass(t.dock, "qitem").find(
      (i) => i.attrs["data-question"] === "Which colour?",
    ),
    (b) => b.textContent === "Type instead",
  )?.click();
  const again = await until(() => byTag(t.dock, "textarea")[0]);
  again.value = "Teal, please";
  again.fire("input");
  button(t.dock, (b) => b.textContent.includes("Use this answer"))?.click();
  await until(() => t.dock.textContent.includes("Teal, please"));
  inItem("Which extras?", "Lid")?.click();
  inItem("Which extras?", "Handle")?.click();
  inItem("Which extras?", "Handle")?.click();
  inItem("Which extras?", "Strap")?.click();
  check(
    "with every question answered, Send reads Send answers and is on",
    sendAll()?.disabled === false && sendAll()?.textContent === "Send answers",
    show({ text: sendAll()?.textContent }),
  );
  sendAll()?.click();
  const tSent = await until(() => callsOf("respond_to_prompt", S.three)[0]);
  check(
    "one Send makes one answer with all three: the typed words, the moved pick and both extras",
    callsOf("respond_to_prompt", S.three).length === 1 &&
      tSent?.args.promptId === "prompt-3-1" &&
      tSent.args.response.answers["Which colour?"] === "Teal, please" &&
      tSent.args.response.answers["Which size?"] === "Large" &&
      tSent.args.response.answers["Which extras?"] === "Lid, Strap",
    show(tSent),
  );

  // ---- a form: answer on the PC, no input
  const f = drawSession(S.form, "Waits on a form");
  const pcCard = await until(() => byClass(f.dock, "pc-card")[0]);
  check(
    "a session waiting on a form shows the answer-on-the-PC card with no input",
    pcCard?.attrs["data-kind"] === "form" &&
      /Answer on the PC/.test(pcCard.textContent) &&
      pcCard.textContent.includes("Release details") &&
      byTag(f.root, "textarea").length === 0 &&
      byTag(f.root, "input").length === 0 &&
      byClass(f.dock, "opt").length === 0 &&
      // Hide only folds the card; it answers nothing.
      byTag(f.dock, "button").every(
        (b) => !b.attrs["data-action"] || b.attrs["data-action"] === "fold",
      ),
    f.dock.textContent,
  );

  // ---- a working session: the conversation, and a typed message goes as Queue
  const r = drawSession(S.running, "Works");
  const field = await until(() => byTag(r.dock, "textarea")[0]);
  await until(() => byClass(r.view, "reply").length);
  check(
    "a working session shows its conversation with the reply in Markdown, its tool row and Stop",
    byClass(r.view, "you")[0]?.textContent === "Tidy the tests" &&
      byTag(byClass(r.view, "reply")[0] ?? r.view, "strong")[0]?.textContent ===
        "two" &&
      byClass(r.view, "md-code")[0]?.textContent === "a.mjs" &&
      byClass(r.view, "work-line")[0]?.textContent === "Read a file" &&
      Boolean(button(r.view, (b) => b.attrs["data-action"] === "session.stop")),
    r.view.textContent,
  );
  // Steps in a row, across turns with no text, fold into one line that says what they did and opens on tap.
  const [work] = turnsView([
    { role: "assistant", text: "", tools: ["Read", "Bash", "Read"] },
    { role: "assistant", text: "", tools: ["Grep", "mcp__gh__pr_view"] },
  ]);
  const sum = byClass(work, "work-sum")[0];
  const shut = sum?.textContent;
  sum?.click();
  check(
    "steps in a row fold into one summary line that opens the list of what each did",
    shut ===
      "5 steps: read 2 files, ran 1 command, searched once, used 1 other tool" &&
      byTag(work, "li")
        .map((li) => li.textContent)
        .join("|") ===
        "Read a file|Ran a command|Read a file|Searched the files|Used gh · pr_view",
    show([shut, byTag(work, "li").map((li) => li.textContent)]),
  );
  field.value = "Also run the linter";
  field.fire("input");
  const send = button(r.dock, (b) => hasClass(b, "send"));
  check(
    "while the session works the send button is Queue",
    send?.attrs["data-action"] === "session.queue" &&
      send.textContent === "Queue" &&
      !send.disabled,
    show(send?.attrs),
  );
  send?.click();
  const queued = await until(() => callsOf("send_prompt", S.running)[0]);
  const held = await until(() => byClass(r.view, "held")[0]);
  check(
    "the typed message goes as Queue: the door gets it, the box empties and the message shows as Queued",
    queued?.args.prompt.startsWith("Also run the linter") &&
      !queued.args.interrupt &&
      queue.length === 1 &&
      field.value === "" &&
      held?.textContent === "QueuedAlso run the linter",
    show({ queued, held: held?.textContent }),
  );
  // ---- drafts: the userText words outlive a redraw and a reopen, never go into a field the user is in, leave after
  // a send
  const d1 = drawSession(S.running, "Works");
  const df1 = await until(() => byTag(d1.dock, "textarea")[0]);
  df1.focus();
  df1.value = "half a thought";
  df1.fire("input");
  // The frame draws the view again (a new link to the PC) while the user is in the field.
  const d2 = drawSession(S.running, "Works");
  const df2 = await until(() => byTag(d2.dock, "textarea")[0]);
  await sleep(50);
  check(
    "a redraw while the user types keeps the words in the new field, with the focus and the caret at the end",
    df2 !== df1 &&
      df2.value === "half a thought" &&
      df2.focused &&
      df2.caretMoves > 0,
    show({ value: df2?.value, focused: df2?.focused, caret: df2?.caretMoves }),
  );
  // From here every write the page makes into the field is counted; the user's own typing goes past it.
  let userText = df2.value;
  let pageWrites = 0;
  Object.defineProperty(df2, "value", {
    get: () => userText,
    set: (x) => {
      pageWrites++;
      userText = x;
    },
  });
  userText = "half a thought, and more";
  df2.fire("input");
  const draftKey = `phone.draft:${S.running}`;
  const early = stored.get(draftKey);
  await sleep(1200);
  check(
    "the draft is saved from the field at most once a second, and the page never writes into the field the user is in",
    early === undefined &&
      stored.get(draftKey) === "half a thought, and more" &&
      pageWrites === 0 &&
      userText === "half a thought, and more",
    show({ early, saved: stored.get(draftKey), pageWrites }),
  );
  // A reopen of the mini app: the page's memory and its old views are gone, localStorage stays.
  df1.isConnected = false;
  df2.isConnected = false;
  drafts.clear();
  const d3 = drawSession(S.running, "Works");
  const df3 = await until(() => byTag(d3.dock, "textarea")[0]);
  check(
    "a reopen of the mini app puts the draft into the new field",
    df3.value === "half a thought, and more" && !df3.focused,
    show(df3?.value),
  );
  const sends = callsOf("send_prompt", S.running).length;
  button(d3.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => callsOf("send_prompt", S.running).length > sends);
  await until(() => df3.value === "");
  df3.isConnected = false;
  const d4 = drawSession(S.running, "Works");
  const df4 = await until(() => byTag(d4.dock, "textarea")[0]);
  check(
    "a sent message leaves the draft: the store is empty and the next field starts empty",
    !stored.has(draftKey) && df4.value === "",
    show({ saved: stored.get(draftKey), next: df4?.value }),
  );
  // Type, leave the session within 1 s (before the timed save), come back: nothing typed is lost.
  df4.focus();
  df4.value = "first words";
  df4.fire("input");
  await sleep(50);
  df4.value = "first words, then the rest";
  df4.fire("input");
  df4.isConnected = false;
  const d5 = drawSession(S.running, "Works");
  const df5 = await until(() => byTag(d5.dock, "textarea")[0]);
  check(
    "type, leave within 1 s, return: the whole text is in the box (the draft in memory follows every keystroke)",
    df5.value === "first words, then the rest",
    show(df5?.value),
  );
  // The stored copy is written at once on pagehide, on visibilitychange and on leaving the field.
  const storedNow = [];
  for (const [i, act] of [
    () => firePage("pagehide"),
    () => firePage("visibilitychange"),
    () => df5.fire("blur"),
  ].entries()) {
    const text = `stored at once ${i}`;
    df5.value = text;
    df5.fire("input");
    act();
    storedNow.push(stored.get(draftKey) === text);
  }
  check(
    "pagehide, visibilitychange and leaving the field each store the draft at once, before the 1 s save",
    storedNow.every(Boolean),
    show(storedNow),
  );
  df5.value = "";
  df5.fire("input");
  df5.fire("blur");
  df5.isConnected = false;

  // ---- the test copy's own store: a test-copy build ends the keys of the saved screens, the outbox and the drafts
  // with its STORE_SUFFIX, so the test copy and the real app on one phone never read or change each other's.
  // Each run starts from a store holding only the other build's things, and puts the store back after.
  const { useStoreSuffix } = await import(GENERATED);
  const cache = await import(pageUrl("frame/cache.js"));
  const { createOutbox } = await import(pageUrl("frame/outbox.js"));
  async function storeRun(suffix) {
    const before = new Map(stored);
    stored.clear();
    useStoreSuffix(suffix);
    const other = suffix ? "" : "-test";
    stored.set(
      `phone.kept${other}:probe`,
      JSON.stringify({ data: "other", at: 1 }),
    );
    stored.set(
      `phone.outbox${other}`,
      JSON.stringify([
        { mid: "m-other", key: S.running, a: "send", d: {}, at: Date.now() },
      ]),
    );
    stored.set(`phone.draft${other}:${S.running}`, "other words");
    const others = new Map(stored);
    const read = {
      kept: cache.kept("probe"),
      outbox: createOutbox({ storage: localStorage }).list(S.running).length,
    };
    cache.keep("probe", "mine");
    createOutbox({ storage: localStorage }).add({
      key: S.running,
      a: "send",
      d: {},
    });
    drafts.clear();
    const v = drawSession(S.running, "Works");
    const field = await until(() => byTag(v.dock, "textarea")[0]);
    read.draft = field.value;
    field.value = "my words";
    field.fire("input");
    field.fire("blur");
    const written = [...stored.keys()].filter((k) => !others.has(k)).sort();
    cache.forgetAll();
    const keptAfterForget = stored.has(`phone.kept${suffix}:probe`);
    const othersKept = [...others].every(([k, x]) => stored.get(k) === x);
    field.value = "";
    field.fire("input");
    field.fire("blur");
    field.isConnected = false;
    useStoreSuffix("");
    stored.clear();
    for (const [k, x] of before) stored.set(k, x);
    return { read, written, keptAfterForget, othersKept };
  }
  // The keys a run wrote: its draft, its kept probe and its outbox, and besides them only kept screens (the drawn
  // session keeps itself), all under the run's suffix.
  const wroteOnly = (written, suffix) => {
    const mine = [
      `phone.draft${suffix}:${S.running}`,
      `phone.kept${suffix}:probe`,
      `phone.outbox${suffix}`,
    ];
    return (
      mine.every((k) => written.includes(k)) &&
      written.every(
        (k) => mine.includes(k) || k.startsWith(`phone.kept${suffix}:`),
      )
    );
  };
  const testRun = await storeRun("-test");
  check(
    "a test-copy build (STORE_SUFFIX -test) keeps its saved screens, outbox and drafts under -test keys and never reads or changes the real app's (FAIL: the test copy shows or overwrites the real app's screens, messages or words)",
    testRun.read.kept === null &&
      testRun.read.outbox === 0 &&
      testRun.read.draft === "" &&
      wroteOnly(testRun.written, "-test") &&
      !testRun.keptAfterForget &&
      testRun.othersKept,
    show(testRun),
  );
  const plainRun = await storeRun("");
  check(
    "a plain build (STORE_SUFFIX empty) keeps its saved screens, outbox and drafts under today's keys and leaves a test copy's alone (FAIL: the real app loses what it kept before the update)",
    plainRun.read.kept === null &&
      plainRun.read.outbox === 0 &&
      plainRun.read.draft === "" &&
      wroteOnly(plainRun.written, "") &&
      !plainRun.keptAfterForget &&
      plainRun.othersKept,
    show(plainRun),
  );
  const failed = why({ ok: false, err: "door-error", message: "x" });
  check(
    "a failed send shows the answer's message once: { err: door-error, message: x } shows x",
    failed.split("(x)").length === 2,
    show(failed),
  );
  const offWords = [
    why({ ok: false, err: "pc-offline" }),
    why({ ok: false, err: "closed" }),
  ];
  check(
    "a send while the PC is off says so in plain words, not the code word (FAIL: 'the PC answered \"pc-offline\"')",
    offWords[0] === "the PC is off or asleep" &&
      offWords[1] === "the link to the PC closed",
    show(offWords),
  );
  // A known word that comes with the PC's message keeps its plain words; the child-limit refusal of a New session
  // has its own. The PC sends it only after a start with no calling session failed too, and Nimbalyst's limit is
  // either 4 helpers at once or a lifetime count, so the words name no number and no single helper to wait for.
  const knownWords = [
    why({ ok: false, err: "timeout", message: "after 30 s" }),
    why({ ok: false, err: "not-running", message: "idle" }),
    why({ ok: false, err: "session-limit" }),
    why({
      ok: false,
      err: "session-limit",
      message: "Maximum 4 child sessions",
    }),
  ];
  check(
    "a known error word with a message shows its plain words, and session-limit says Nimbalyst refused it for too many helper sessions, with what to do (FAIL: 'the PC answered \"timeout (after 30 s)\"', or one of 4 helpers must finish)",
    knownWords[0] === "the PC did not answer in time" &&
      knownWords[1] === "the session is not working" &&
      knownWords[2] ===
        "Nimbalyst refused a new session: too many helper sessions from the project's newest session. Finish or close some, or start one on the PC" &&
      knownWords[3] === knownWords[2],
    show(knownWords),
  );

  // ---- a sent message shows at once (comfort design, section 5): with "Sending…" before the PC answers, once
  // after, and back in the box when the PC refuses it
  let release = null;
  const held1 = drawSession(S.running, "Works", {
    ask: (a, d) =>
      a === "session.queue" || a === "session.send"
        ? new Promise((res) => (release = res))
        : ask(a, d),
  });
  const sf = await until(() => byTag(held1.dock, "textarea")[0]);
  await until(() => byClass(held1.view, "reply").length);
  const bubbles = (root, text) =>
    byClass(root, "you").filter((b) => b.textContent === text);
  sf.value = "Check the mark";
  sf.fire("input");
  button(held1.dock, (b) => hasClass(b, "send"))?.click();
  const before = {
    bubbles: bubbles(held1.view, "Check the mark").length,
    mark: byClass(held1.view, "sent-mark")[0]?.textContent,
    box: sf.value,
  };
  check(
    "a sent message is in the chat with its Sending… mark before the PC answers, and the box is empty",
    before.bubbles === 1 && before.mark === "Sending…" && before.box === "",
    show(before),
  );
  release({ ok: true, d: { queued: false } });
  await until(() => byClass(held1.view, "sent-mark").length === 0);
  await sleep(100);
  const after = {
    bubbles: bubbles(held1.view, "Check the mark").length,
    marks: byClass(held1.view, "sent-mark").length,
  };
  check(
    "once the PC took it the message shows once, without its Sending… mark",
    after.bubbles === 1 && after.marks === 0,
    show(after),
  );
  sf.value = "This one fails";
  sf.fire("input");
  button(held1.dock, (b) => hasClass(b, "send"))?.click();
  release({ ok: false, err: "timeout" });
  await until(() => sf.value === "This one fails");
  await sleep(250);
  const refused = {
    box: sf.value,
    line: byClass(held1.dock, "dock-line").find((p) => !p.hidden)?.textContent,
    bubbles: bubbles(held1.view, "This one fails").length,
  };
  check(
    "a refused message leaves the chat and is back in the box, with the Not sent line",
    refused.box === "This one fails" &&
      refused.line ===
        "Not sent: the PC did not answer in time. Your message is back in the box." &&
      refused.bubbles === 0,
    show(refused),
  );
  sf.value = "";
  sf.fire("input");
  sf.fire("blur");
  held1.view.isConnected = false;

  // ---- the same words sent again: the transcript's earlier "Tidy the tests" does not stand for the new one
  const talkFile = path.join(
    talkDir,
    "11111111-2222-4333-8444-555555555555.jsonl",
  );
  const talkBefore = fs.readFileSync(talkFile, "utf8");
  const twice = drawSession(S.running, "Works", {
    ask: (a, d) =>
      a === "session.queue" || a === "session.send"
        ? Promise.resolve({ ok: true, d: { queued: false } })
        : ask(a, d),
  });
  const tf = await until(() => byTag(twice.dock, "textarea")[0]);
  await until(() => byClass(twice.view, "reply").length);
  const sendWords = async (text) => {
    tf.value = text;
    tf.fire("input");
    button(twice.dock, (b) => hasClass(b, "send"))?.click();
    await until(() => !byClass(twice.view, "sent-mark").length);
    await sleep(150);
  };
  await sendWords("Tidy the tests");
  const twiceShown = bubbles(twice.view, "Tidy the tests").length;
  check(
    "the same words sent twice keep both bubbles while the transcript holds only the first (FAIL: the new message vanishes, matched to the old one)",
    twiceShown === 2,
    show({ twiceShown }),
  );
  // The session writes the new message: it shows once, from the transcript.
  fs.appendFileSync(
    talkFile,
    `${JSON.stringify({ type: "user", message: { content: "Tidy the tests" }, timestamp: "t9" })}\n`,
  );
  await sendWords("Something else");
  await until(() => byClass(twice.view, "you").length >= 3);
  const twiceLater = bubbles(twice.view, "Tidy the tests").length;
  check(
    "once the transcript holds the second one too, the words show twice, not three times",
    twiceLater === 2,
    show({ twiceLater }),
  );
  twice.view.isConnected = false;
  fs.writeFileSync(talkFile, talkBefore);

  // ---- the outbox (phone/README.md, "Sends that survive a dropped link"), with a PC whose hello says ids
  const { outbox, RETRY_MS } = await import(pageUrl("frame/outbox.js"));
  const { ChannelError } = await import(pageUrl("frame/channel.js"));
  const IDS = { ids: true };
  const posted = (text) =>
    callsOf("send_prompt", S.running).filter((c) =>
      c.args.prompt.startsWith(text),
    ).length;
  const redLine = (dock) =>
    byClass(dock, "dock-line").find((p) => !p.hidden && hasClass(p, "bad"))
      ?.textContent ?? null;
  // The link drops after the frame left: the PC runs the send, the page never gets its answer.
  let dropNext = true;
  const seenMids = [];
  const ob1 = drawSession(S.running, "Works", {
    hello: IDS,
    ask: async (a, d) => {
      if (a === "session.send" || a === "session.queue") {
        seenMids.push(d.mid);
        if (dropNext) {
          dropNext = false;
          await ask(a, d);
          throw new ChannelError("bye");
        }
      }
      return ask(a, d);
    },
  });
  const of1 = await until(() => byTag(ob1.dock, "textarea")[0]);
  await until(() => byClass(ob1.view, "reply").length);
  of1.value = "Once only";
  of1.fire("input");
  button(ob1.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => posted("Once only") === 1);
  await sleep(50);
  const dropped = {
    box: of1.value,
    mark: byClass(ob1.view, "sent-mark")[0]?.textContent,
    red: redLine(ob1.dock),
    waiting: outbox.list(S.running).length,
    mid: seenMids[0],
  };
  check(
    "outbox: a send whose link drops after it left keeps its clock, shows no red, stays out of the box and waits in the outbox with an id",
    dropped.box === "" &&
      dropped.mark === "Sending…" &&
      dropped.red === null &&
      dropped.waiting === 1 &&
      /^m-[0-9a-f]{32}$/.test(dropped.mid ?? ""),
    show(dropped),
  );
  check(
    "outbox: the waiting message is kept in localStorage, so a reopen of the mini app keeps it",
    (stored.get("phone.outbox") ?? "").includes("Once only"),
    show(stored.get("phone.outbox")),
  );
  // The frame sends the outbox again on the next channel session.
  await outbox.flush((a, d) => {
    seenMids.push(d.mid);
    return ask(a, d);
  });
  await until(() => byClass(ob1.view, "sent-mark").length === 0);
  const resent = {
    posted: posted("Once only"),
    waiting: outbox.list(S.running).length,
    marks: byClass(ob1.view, "sent-mark").length,
    sameId: seenMids[1] === seenMids[0],
  };
  check(
    "outbox: the resend on the next link carries the same id, the session gets the message exactly once, and the clock leaves",
    resent.posted === 1 &&
      resent.waiting === 0 &&
      resent.marks === 0 &&
      resent.sameId,
    show(resent),
  );

  // A real refusal: red, the words back in the box, out of the outbox.
  const ob2 = drawSession(S.running, "Works", {
    hello: IDS,
    ask: (a, d) =>
      a === "session.send" || a === "session.queue"
        ? Promise.resolve({ ok: false, err: "no-session" })
        : ask(a, d),
  });
  const of2 = await until(() => byTag(ob2.dock, "textarea")[0]);
  await until(() => byClass(ob2.view, "reply").length);
  of2.value = "Refused one";
  of2.fire("input");
  button(ob2.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => of2.value === "Refused one");
  await sleep(250);
  const refusedOb = {
    box: of2.value,
    red: redLine(ob2.dock),
    waiting: outbox.list(S.running).length,
    bubbles: bubbles(ob2.view, "Refused one").length,
  };
  check(
    "outbox: a refusal from the PC shows red, puts the words back in the box and leaves the outbox",
    refusedOb.box === "Refused one" &&
      /^Not sent: .*Your message is back in the box\.$/.test(
        refusedOb.red ?? "",
      ) &&
      refusedOb.waiting === 0 &&
      refusedOb.bubbles === 0,
    show(refusedOb),
  );
  of2.value = "";
  of2.fire("input");
  of2.fire("blur");
  ob1.view.isConnected = false;
  ob2.view.isConnected = false;

  // A refusal that came while no view of the session was open: shown when the session is opened. The views drawn
  // so far are left behind, as the page's are once the user moves on.
  for (const vw of drawn) vw.isConnected = false;
  const late = outbox.add({
    key: S.running,
    a: "session.send",
    d: { session: S.running, text: "Came back later" },
    text: "Came back later",
    how: "send",
  });
  await outbox.send(late, async () => ({ ok: false, err: "no-session" }));
  const ob3 = drawSession(S.running, "Works", { hello: IDS });
  const of3 = await until(() => byTag(ob3.dock, "textarea")[0]);
  await until(() => byClass(ob3.view, "reply").length);
  await sleep(50);
  const lateShown = {
    box: of3.value,
    red: redLine(ob3.dock),
    waiting: outbox.list(S.running).length,
  };
  check(
    "outbox: a refusal that came while the session was closed shows when it opens, its words back in the box",
    lateShown.box === "Came back later" &&
      /^Not sent: /.test(lateShown.red ?? "") &&
      lateShown.waiting === 0,
    show(lateShown),
  );
  of3.value = "";
  of3.fire("input");
  of3.fire("blur");
  ob3.view.isConnected = false;

  // Past the hour of silent retries: "Not sent yet" with Send now and Discard; the frame's flush leaves it.
  const oldOne = outbox.add({
    key: S.running,
    a: "session.send",
    d: { session: S.running, text: "From last night" },
    text: "From last night",
    how: "send",
  });
  const goneOne = outbox.add({
    key: S.running,
    a: "session.send",
    d: { session: S.running, text: "Drop this" },
    text: "Drop this",
    how: "send",
  });
  outbox.get(oldOne.mid).at = Date.now() - RETRY_MS - 1000;
  outbox.get(goneOne.mid).at = Date.now() - RETRY_MS - 1000;
  const flushed = [];
  await outbox.flush(async (_a, d) => {
    flushed.push(d.mid);
    return { ok: true, d: {} };
  });
  check(
    "outbox: a message older than the hour of silent retries never goes out by itself",
    flushed.length === 0 && outbox.list(S.running).length === 2,
    show({ flushed, waiting: outbox.list(S.running).length }),
  );
  const nowSent = [];
  const ob4 = drawSession(S.running, "Works", {
    hello: IDS,
    ask: (a, d) => {
      if (a === "session.send" || a === "session.queue") {
        nowSent.push(d);
        return ask(a, d);
      }
      return ask(a, d);
    },
  });
  await until(() => byClass(ob4.view, "reply").length);
  const staleRows = await until(() =>
    byClass(ob4.view, "sent-stale").length === 2
      ? byClass(ob4.view, "sent-stale")
      : null,
  );
  check(
    'outbox: each old message shows "Not sent yet" with Send now and Discard',
    staleRows?.every(
      (r) =>
        r.textContent.startsWith("Not sent yet") &&
        button(r, (b) => b.textContent === "Send now") &&
        button(r, (b) => b.textContent === "Discard"),
    ) === true,
    show(staleRows?.map((r) => r.textContent)),
  );
  const rowOf = (mid) =>
    byClass(ob4.view, "sent-stale").find((r) => r.attrs["data-mid"] === mid);
  button(rowOf(goneOne.mid), (b) => b.textContent === "Discard")?.click();
  await sleep(50);
  check(
    "outbox: Discard drops the message from the chat and the outbox, sending nothing",
    !outbox.get(goneOne.mid) &&
      bubbles(ob4.view, "Drop this").length === 0 &&
      nowSent.length === 0,
    show({ waiting: outbox.list(S.running).map((e) => e.text), nowSent }),
  );
  button(rowOf(oldOne.mid), (b) => b.textContent === "Send now")?.click();
  await until(() => posted("From last night") === 1);
  await until(() => !outbox.get(oldOne.mid));
  check(
    "outbox: Send now sends the old message once, with its own id, and it leaves the outbox",
    nowSent.length === 1 &&
      nowSent[0].mid === oldOne.mid &&
      posted("From last night") === 1 &&
      !outbox.get(oldOne.mid),
    show({ nowSent, posted: posted("From last night") }),
  );
  ob4.view.isConnected = false;

  // A PC that says nothing of ids (older than this page): today's path, and a lost link says what it means.
  const ob5 = drawSession(S.running, "Works", {
    ask: (a, d) =>
      a === "session.send" || a === "session.queue"
        ? Promise.reject(new ChannelError("bye"))
        : ask(a, d),
  });
  const of5 = await until(() => byTag(ob5.dock, "textarea")[0]);
  await until(() => byClass(ob5.view, "reply").length);
  of5.value = "Old PC";
  of5.fire("input");
  button(ob5.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => of5.value === "Old PC");
  await sleep(250);
  const oldPc = {
    box: of5.value,
    line: byClass(ob5.dock, "dock-line").find((p) => !p.hidden)?.textContent,
    waiting: outbox.list(S.running).length,
  };
  check(
    'outbox: with a PC without ids a lost link says "the link dropped before the PC confirmed" and the words go back in the box (FAIL: the PC answered "bye")',
    oldPc.box === "Old PC" &&
      oldPc.line ===
        "The link dropped before the PC confirmed it: check the session before you send it again. Your message is back in the box." &&
      oldPc.waiting === 0,
    show(oldPc),
  );
  of5.value = "";
  of5.fire("input");
  of5.fire("blur");
  ob5.view.isConnected = false;

  // New session goes through the outbox too: its data carries an id.
  const newAsked = [];
  const ob6 = drawSession(null, undefined, {
    hello: IDS,
    ask: async (a, d) => {
      if (a === "session.new") {
        newAsked.push(d);
        return { ok: true, d: { session: S.running } };
      }
      return ask(a, d);
    },
  });
  const of6 = await until(() => byTag(ob6.dock, "textarea")[0]);
  of6.value = "Start something";
  of6.fire("input");
  button(ob6.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => newAsked.length);
  await sleep(50);
  check(
    "outbox: New session goes through the outbox with an id and leaves it once the PC answers",
    /^m-/.test(newAsked[0]?.mid ?? "") &&
      newAsked[0]?.project === beta &&
      outbox.list(`new:${beta}`).length === 0,
    show(newAsked),
  );
  ob6.view.isConnected = false;

  // A first message to a new session held by a dropped link: a second one must not start a second session.
  const newHeld = [];
  const ob7 = drawSession(null, undefined, {
    hello: IDS,
    ask: async (a, d) => {
      if (a === "session.new") {
        newHeld.push(d);
        throw new ChannelError("bye");
      }
      return ask(a, d);
    },
  });
  const of7 = await until(() => byTag(ob7.dock, "textarea")[0]);
  of7.value = "Start X";
  of7.fire("input");
  button(ob7.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => newHeld.length === 1);
  await sleep(50);
  of7.value = "Also do Y";
  of7.fire("input");
  button(ob7.dock, (b) => hasClass(b, "send"))?.click();
  await sleep(100);
  const second = {
    asked: newHeld.length,
    waiting: outbox.list(`new:${beta}`).map((e) => e.text),
    box: of7.value,
    line: byClass(ob7.dock, "dock-line").find((p) => !p.hidden)?.textContent,
  };
  check(
    "outbox: while a new session's first message waits, a second message starts no second session and stays in the box",
    second.asked === 1 &&
      second.waiting.join() === "Start X" &&
      second.box === "Also do Y" &&
      /starts once the PC gets your first message/.test(second.line ?? ""),
    show(second),
  );
  for (const e of outbox.list(`new:${beta}`)) outbox.take(e.mid);
  ob7.view.isConnected = false;

  // ---- a sent message never stays pinned at the chat's end (reported 2026-11-18)
  // With files: the transcript holds the words and the block naming the saved files after them.
  let withFiles = false;
  const att1 = drawSession(S.running, "Works", {
    ask: async (a, d) => {
      if (a === "session.queue" || a === "session.send") {
        withFiles = true;
        return { ok: true, d: { queued: false } };
      }
      const r = await ask(a, d);
      if (a === "session.open" && withFiles && r.ok)
        r.d.items = [
          ...r.d.items,
          {
            role: "user",
            text: "Look at this\n\nAttached files (open each with your read tool):\n- C:/p/shot.png",
            at: new Date().toISOString(),
            pos: 999999,
          },
        ];
      return r;
    },
  });
  const af = await until(() => byTag(att1.dock, "textarea")[0]);
  await until(() => byClass(att1.view, "reply").length);
  af.value = "Look at this";
  af.fire("input");
  button(att1.dock, (b) => hasClass(b, "send"))?.click();
  await until(() =>
    byClass(att1.view, "you").some((b) => /Attached files/.test(b.textContent)),
  );
  await sleep(100);
  const files1 = {
    waiting: bubbles(att1.view, "Look at this").length,
    you: byClass(att1.view, "you").map((b) => b.textContent.slice(0, 30)),
  };
  check(
    "a message sent with files leaves its waiting bubble once the transcript holds it with its files block",
    files1.waiting === 0,
    show(files1),
  );
  af.value = "";
  af.fire("input");
  af.fire("blur");
  att1.view.isConnected = false;

  // To a session that handed its work on: the message goes on to the next session, which the bubble names and opens.
  const opened = [];
  const mv1 = drawSession(S.running, "Works", {
    go: (screen, p) => opened.push({ screen, ...p }),
    ask: (a, d) =>
      a === "session.queue" || a === "session.send"
        ? Promise.resolve({
            ok: true,
            d: {
              queued: false,
              movedTo: { session: "next-id", title: "Works (cont.)" },
            },
          })
        : ask(a, d),
  });
  const mf = await until(() => byTag(mv1.dock, "textarea")[0]);
  await until(() => byClass(mv1.view, "reply").length);
  mf.value = "And now?";
  mf.fire("input");
  button(mv1.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => byClass(mv1.view, "sent-moved").length);
  const line = byClass(mv1.view, "sent-moved")[0];
  button(line, () => true)?.click();
  const moved1 = { line: line.textContent, opened };
  check(
    "a message to a session that handed its work on says which session took it, and Open goes there",
    moved1.line.includes("Works (cont.)") &&
      opened.length === 1 &&
      opened[0].screen === "session" &&
      opened[0].session === "next-id",
    show(moved1),
  );
  mf.value = "";
  mf.fire("input");
  mf.fire("blur");
  mv1.view.isConnected = false;

  // ---- jump to latest and the scroll place (comfort design, section 5)
  // The views drawn so far are left, as the frame leaves a screen: from here the newest view is the one shown.
  for (const d of drawn) d.isConnected = false;
  const box1 = scrollStandIn();
  const j1 = drawSession(S.running, "Works", { scrollBox: box1 });
  await until(() => byClass(j1.view, "reply").length);
  await until(() => box1.scrollTop > 0);
  const jumpBtn = () => byClass(j1.dock, "jump")[0];
  const atEnd = hasClass(jumpBtn(), "on");
  box1.scrolled(400); // one screen up: the end is 800 px below the view
  const upShown = hasClass(jumpBtn(), "on");
  jumpBtn()?.click();
  box1.scrolled(box1.scrollTop);
  const landed = box1.scrollTop + box1.clientHeight >= box1.scrollHeight;
  check(
    "scrolled up one screen shows Jump to latest, and a tap lands on the last message",
    !atEnd && upShown && landed && !hasClass(jumpBtn(), "on"),
    show({ atEnd, upShown, landed, top: box1.scrollTop }),
  );
  box1.scrolled(400);
  j1.view.isConnected = false;
  // The badge counts the messages new at the end: not the earlier ones loaded at the top, never below zero.
  const turn = (pos) => ({ role: "assistant", text: "x", pos });
  const shownWithEarlier = [10, 20, 30, 40, 50, 60].map(turn); // 10-30 loaded by Earlier messages
  const newCounts = {
    readAfterEarlier: newAtEnd(shownWithEarlier, [40, 50, 60, 70].map(turn)),
    sameRead: newAtEnd(shownWithEarlier, [40, 50, 60].map(turn)),
    shorterWindow: newAtEnd(shownWithEarlier, [60, 70, 80].map(turn)),
    nothingShown: newAtEnd([], [10, 20].map(turn)),
  };
  check(
    "Jump to latest counts only messages new at the end, never earlier ones loaded at the top, never below zero",
    newCounts.readAfterEarlier === 1 &&
      newCounts.sameRead === 0 &&
      newCounts.shorterWindow === 2 &&
      newCounts.nothingShown === 2,
    show(newCounts),
  );
  const box2 = scrollStandIn();
  const j2 = drawSession(S.running, "Works", { scrollBox: box2 });
  await until(() => byClass(j2.view, "reply").length);
  await sleep(100);
  check(
    "leave a session and return: it opens where it was left, not at the end",
    box2.scrollTop === 400,
    show(box2.scrollTop),
  );
  j2.view.isConnected = false;

  // ---- the last session opened is kept on the phone and drawn before the first hello (comfort design, section 3)
  const k1 = drawSession(S.running, "Works", {
    connected: false,
    ask: () => Promise.reject(new Error("not-connected")),
  });
  const keptNow = {
    stored: stored.has("phone.kept:session"),
    you: byClass(k1.view, "you")[0]?.textContent,
    line: byClass(k1.view, "s-kept")[0]?.textContent,
    box: byTag(k1.dock, "textarea").length,
  };
  check(
    "a kept session is drawn before the hello, marked Updating, with its typing box",
    keptNow.stored &&
      keptNow.you === "Tidy the tests" &&
      /^Updating · as of \d\d:\d\d( [AP]M)?$/.test(keptNow.line ?? "") &&
      keptNow.box === 1,
    show(keptNow),
  );
  k1.view.isConnected = false;

  // ---- Send on a kept session before the PC connects: the message waits for the link instead of failing with
  // "no link"; once the hello comes it goes through the outbox (hello says ids) or as a plain ask (no ids)
  const beforeLink = async (hello, text) => {
    let linkUp = false;
    let up;
    const linkP = new Promise((r) => {
      up = r;
    });
    const sentAs = [];
    const k = drawSession(S.running, "Works", {
      connected: false,
      hello: null,
      linked: () => linkP,
      ask: (a, d) => {
        if (!linkUp) return Promise.reject(new ChannelError("not-connected"));
        if (a === "session.queue" || a === "session.send") {
          sentAs.push({ a, d });
          return Promise.resolve({ ok: true, d: { queued: false } });
        }
        return ask(a, d);
      },
    });
    const kf = byTag(k.dock, "textarea")[0];
    kf.value = text;
    kf.fire("input");
    button(k.dock, (b) => hasClass(b, "send"))?.click();
    await sleep(100);
    const waiting = {
      line: redLine(k.dock),
      mark: byClass(k.view, "sent-mark")[0]?.textContent ?? null,
      sent: sentAs.length,
    };
    linkUp = true;
    up(hello);
    await until(() => sentAs.length);
    await sleep(100);
    k.view.isConnected = false;
    return { waiting, sentAs, after: redLine(k.dock) };
  };
  const withIds = await beforeLink(IDS, "Sent before the link");
  check(
    "a Send on a kept session before the PC connects waits with Sending…, then goes through the outbox with its id once the hello says ids (FAIL: 'Not sent: no link to the PC right now')",
    withIds.waiting.line === null &&
      withIds.waiting.mark === "Sending…" &&
      withIds.waiting.sent === 0 &&
      withIds.sentAs.length === 1 &&
      /^m-[0-9a-f]{32}$/.test(withIds.sentAs[0].d.mid ?? "") &&
      withIds.after === null &&
      outbox.list(S.running).length === 0,
    show(withIds),
  );
  const noIds = await beforeLink({}, "Sent before an older PC");
  check(
    "to a PC whose hello has no ids, the waiting message goes as a plain send without an id",
    noIds.waiting.line === null &&
      noIds.sentAs.length === 1 &&
      noIds.sentAs[0].d.mid === undefined &&
      noIds.sentAs[0].d.text === "Sent before an older PC",
    show(noIds),
  );

  // ---- a Send before the first hello survives the frame's redraw at the hello: the frame leaves the view it drew
  // from what it kept, draws the screen again, then sends the outbox (app.js connect)
  for (const vw of drawn) vw.isConnected = false;
  const NEW_KEY = `new:${beta}`;
  for (const e of outbox.list(NEW_KEY)) outbox.take(e.mid);
  let upA;
  const linkA = new Promise((r) => {
    upA = r;
  });
  let linkUpA = false;
  const startAsked = [];
  const askA = async (a, d) => {
    if (!linkUpA) throw new ChannelError("not-connected");
    if (a === "session.new") {
      startAsked.push(d);
      return { ok: true, d: { session: S.running } };
    }
    return ask(a, d);
  };
  const early1 = drawSession(null, undefined, {
    connected: false,
    hello: null,
    linked: () => linkA,
    ask: askA,
  });
  const earlyF1 = byTag(early1.dock, "textarea")[0];
  earlyF1.value = "Start before the link";
  earlyF1.fire("input");
  button(early1.dock, (b) => hasClass(b, "send"))?.click();
  await sleep(50);
  early1.view.isConnected = false;
  linkUpA = true;
  const early2 = drawSession(null, undefined, {
    hello: IDS,
    linked: () => Promise.resolve(IDS),
    ask: askA,
  });
  await sleep(20);
  const redrawn = bubbles(early2.view, "Start before the link").length;
  upA(IDS);
  await outbox.flush(askA);
  const startedTo = await until(() =>
    byClass(early2.view, "reply").length
      ? button(early2.dock, (b) => hasClass(b, "send"))?.attrs["data-action"]
      : null,
  );
  check(
    "a New session sent before the first hello still shows its bubble in the view drawn at the hello, starts once with its id, and that view moves to the started session (FAIL: the message was held only by the left view)",
    redrawn === 1 &&
      startAsked.length === 1 &&
      /^m-[0-9a-f]{32}$/.test(startAsked[0].mid ?? "") &&
      startedTo !== undefined &&
      startedTo !== null &&
      startedTo !== "session.new" &&
      outbox.list(NEW_KEY).length === 0,
    show({ redrawn, startAsked, startedTo, left: outbox.list(NEW_KEY) }),
  );
  early2.view.isConnected = false;

  // The page is closed before the hello: the words are kept on the phone.
  const early3 = drawSession(null, undefined, {
    connected: false,
    hello: null,
    linked: () => new Promise(() => {}),
    ask: () => Promise.reject(new ChannelError("not-connected")),
  });
  const earlyF3 = byTag(early3.dock, "textarea")[0];
  earlyF3.value = "Kept through a close";
  earlyF3.fire("input");
  button(early3.dock, (b) => hasClass(b, "send"))?.click();
  await sleep(50);
  const keptWords = {
    outbox: (stored.get("phone.outbox") ?? "").includes("Kept through a close"),
    draft: (stored.get(`phone.draft:${NEW_KEY}`) ?? "").includes(
      "Kept through a close",
    ),
  };
  check(
    "a Send before the first hello is kept on the phone, so a close of the page before the hello keeps the words (FAIL: held in memory only)",
    keptWords.outbox || keptWords.draft,
    show(keptWords),
  );
  for (const e of outbox.list(NEW_KEY)) outbox.take(e.mid);
  early3.view.isConnected = false;

  // A PC without ids refuses the waiting message after the redraw: the words go back in the box shown then.
  let upC;
  const linkC = new Promise((r) => {
    upC = r;
  });
  let linkUpC = false;
  const oldSent = [];
  const askC = async (a, d) => {
    if (!linkUpC) throw new ChannelError("not-connected");
    if (a === "session.send" || a === "session.queue") {
      oldSent.push(d);
      return { ok: false, err: "no-session" };
    }
    return ask(a, d);
  };
  const early4 = drawSession(S.running, "Works", {
    connected: false,
    hello: null,
    linked: () => linkC,
    ask: askC,
  });
  const earlyF4 = byTag(early4.dock, "textarea")[0];
  earlyF4.value = "Refused by an older PC";
  earlyF4.fire("input");
  button(early4.dock, (b) => hasClass(b, "send"))?.click();
  await sleep(50);
  early4.view.isConnected = false;
  linkUpC = true;
  const early5 = drawSession(S.running, "Works", {
    hello: {},
    linked: () => Promise.resolve({}),
    ask: askC,
  });
  const earlyF5 = await until(() => byTag(early5.dock, "textarea")[0]);
  upC({});
  await until(() => earlyF5.value === "Refused by an older PC", 2000);
  await sleep(50);
  const liveBack = {
    live: earlyF5.value,
    left: earlyF4.value,
    red: redLine(early5.dock),
    sent: oldSent.length,
    mid: oldSent[0]?.mid,
    waiting: outbox.list(S.running).length,
  };
  check(
    "an older PC's refusal of a message sent before the hello puts the words back in the box shown now, sent once without an id (FAIL: written into the left view's box)",
    liveBack.live === "Refused by an older PC" &&
      liveBack.left === "" &&
      /^Not sent: .*Your message is back in the box\.$/.test(
        liveBack.red ?? "",
      ) &&
      liveBack.sent === 1 &&
      liveBack.mid === undefined &&
      liveBack.waiting === 0,
    show(liveBack),
  );
  earlyF5.value = "";
  earlyF5.fire("input");
  earlyF5.fire("blur");
  early5.view.isConnected = false;

  // A dropped link to a PC without ids that does not come back in time: the words go back with a clear line.
  linkWait.ms = 100;
  const early6 = drawSession(S.running, "Works", {
    connected: false,
    hello: {},
    linked: () => new Promise(() => {}),
    ask: () => Promise.reject(new ChannelError("not-connected")),
  });
  const earlyF6 = byTag(early6.dock, "textarea")[0];
  earlyF6.value = "No link came";
  earlyF6.fire("input");
  button(early6.dock, (b) => hasClass(b, "send"))?.click();
  await until(() => earlyF6.value === "No link came", 2000);
  await sleep(50);
  linkWait.ms = 60_000;
  const timedOut = {
    box: earlyF6.value,
    red: redLine(early6.dock),
    waiting: outbox.list(S.running).length,
  };
  check(
    "a message to a PC without ids whose link does not come back in time goes back in the box with a clear line (FAIL: it waited for ever with Sending…)",
    timedOut.box === "No link came" &&
      timedOut.red ===
        "Not sent: no link to the PC right now. Your message is back in the box." &&
      timedOut.waiting === 0,
    show(timedOut),
  );
  earlyF6.value = "";
  earlyF6.fire("input");
  earlyF6.fire("blur");
  early6.view.isConnected = false;

  // ---- New session while a session is kept on the phone: the empty new-session view draws (reported
  // 2026-11-18: the button did nothing, the view threw before it was drawn)
  let newView = null;
  try {
    const n1 = drawSession(undefined, undefined);
    newView = {
      hint: byClass(n1.view, "newhint").length,
      box: byTag(n1.dock, "textarea").length,
    };
    n1.view.isConnected = false;
  } catch (e) {
    newView = { threw: String(e) };
  }
  check(
    "New session opens its empty view even with a session kept on the phone",
    stored.has("phone.kept:session") && newView.hint === 1 && newView.box === 1,
    show(newView),
  );

  // A browser writes an empty slot handed to replaceChildren as the text "null"; the stand-in does the same.
  const nulls = [q, m, f, r].filter((x) => /null/.test(x.root.textContent));
  check(
    "no drawn session view or dock shows the word null",
    nulls.length === 0,
    show(nulls.map((x) => x.root.textContent)),
  );

  // ---- the look: the new styles use tokens only, nothing under 12 px
  const css = fs.readFileSync(path.join(PAGE, "page.css"), "utf8");
  const from = css.indexOf("/* ---- Projects");
  const to = css.indexOf("/* ---- Checks screen");
  const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const newCss = noComments(css.slice(from, to));
  check(
    "page.css has a Projects and a Session view section after the bottom area",
    from >= 0 && to > from && newCss.includes(".session-view"),
  );
  const RAW =
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklch|color)\(|(?<![-\w])(?:white|black|red|green|blue|gr[ae]y|orange|yellow)(?![-\w])/;
  const FILES = [
    "screens/projects.js",
    "screens/session.js",
    "screens/session-cards.js",
    "frame/markdown.js",
  ];
  const js = FILES.map((f) => fs.readFileSync(path.join(PAGE, f), "utf8"));
  const jsCode = (s) => noComments(s).replace(/^\s*\/\/.*$/gm, "");
  const rawIn = [newCss, ...js.map(jsCode)]
    .map((s) => s.match(RAW)?.[0])
    .filter(Boolean);
  check(
    "no raw colour value in the new styles or the new page files",
    rawIn.length === 0,
    show(rawIn),
  );
  const sizes = [
    ...newCss.matchAll(/(?:font-size:\s*|\b\d{3}\s+)(\d+(?:\.\d+)?)px/g),
  ].map((m) => Number(m[1]));
  check(
    "no text under 12 px in the new styles, and no sizes set in the new page files",
    sizes.length > 0 &&
      sizes.every((n) => n >= 12) &&
      js.every((s) => !/\d+px|style:/.test(s)),
    show(sizes),
  );
  const cardRule = newCss.match(/\.qcard,\s*\.pc-card\s*\{([^}]*)\}/)?.[1];
  const foldBtnRule = newCss.match(/\.qfold\s*\{([^}]*)\}/)?.[1];
  check(
    "a docked card is at most 60 % of the screen, scrolls inside, folds to its head row, and Hide is 44 px",
    /max-height: calc\(var\(--tg-viewport-stable-height, 100vh\) \* 0\.6\)/.test(
      cardRule ?? "",
    ) &&
      /overflow-y: auto/.test(cardRule ?? "") &&
      /\.qcard\.folded > :not\(\.qhead, \.undo\),\s*\.pc-card\.folded > :not\(\.qhead, \.undo\)\s*\{\s*display: none;/.test(
        newCss,
      ) &&
      /min-height: 44px/.test(foldBtnRule ?? "") &&
      /min-width: 44px/.test(foldBtnRule ?? ""),
    show({ cardRule, foldBtnRule }),
  );
  check(
    "inside the session view the large title and the tab bar are hidden",
    /\.content:has\(\.session-view\) \.large-title,\s*\.app:has\(\.session-view\) \.tabbar\s*\{\s*display: none;/.test(
      newCss,
    ),
  );

  // ---- the typing box: grows by whole lines up to 9, scrolls inside, and stays calm while iOS dictates
  const rules = [...noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (m) => ({ sel: m[1].trim(), body: m[2] }),
  );
  const fieldRules = rules.filter((x) =>
    /\.compose[^,]*\.field|textarea/.test(x.sel),
  );
  const lines = (n) =>
    Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n");
  const c = drawSession(S.running, "Works");
  const cf = await until(() => byTag(c.dock, "textarea")[0]);
  // Counts the page's own writes to the field's text; the test's typing does not count.
  let typed = cf.value;
  let typing = false;
  let rewrites = 0;
  Object.defineProperty(cf, "value", {
    get: () => typed,
    set: (x) => {
      if (!typing) rewrites++;
      typed = x;
    },
  });
  const type = (text) => {
    typing = true;
    cf.value = text;
    typing = false;
    cf.fire("input");
  };
  intoView = 0;
  type(lines(60));
  check(
    "a 60-line prompt leaves the field at its largest height, 9 lines (198 px), and the field scrolls inside",
    heightOf(cf) === 198 &&
      cf.scrollHeight > cf.clientHeight &&
      fieldRules.some((x) => /overflow-y:\s*auto/.test(x.body)) &&
      fieldRules.some((x) => /overscroll-behavior:\s*contain/.test(x.body)),
    show({ height: heightOf(cf), fieldRules }),
  );
  type("Short");
  await sleep(1100);
  const shrunk = heightOf(cf);
  const writes = cf.writes;
  type("Short.");
  check(
    "after 1 s with no input the field is one line, and a character that adds no line sets no height",
    shrunk === LINE && cf.writes === writes && heightOf(cf) === LINE,
    show({ shrunk, writes, after: cf.writes }),
  );
  type(lines(4));
  const h4 = heightOf(cf);
  await sleep(300);
  type(lines(2));
  const h2 = heightOf(cf);
  await sleep(300);
  type(lines(3));
  const h3 = heightOf(cf);
  await sleep(1100);
  const quiet = heightOf(cf);
  check(
    "while inputs come less than 1 s apart the field only grows; it shrinks after 1 s with no input",
    h4 === 88 && h2 === 88 && h3 === 88 && quiet === 66,
    show({ h4, h2, h3, quiet }),
  );
  check(
    "nothing on input rewrites the field's text or moves its caret, and nothing calls scrollIntoView",
    rewrites === 0 && cf.caretMoves === 0 && intoView === 0,
    show({ rewrites, caretMoves: cf.caretMoves, intoView }),
  );
  check(
    "no text-transform on the field or the typing box (iOS dictation fails in such a field)",
    fieldRules.length > 0 &&
      rules
        .filter((x) => /\.compose|\.field|textarea/.test(x.sel))
        .every((x) => !/text-transform/.test(x.body)),
    show(fieldRules),
  );
  const hint = rules.find((x) => x.sel === ".compose .field::placeholder");
  check(
    "the field's hint stays on one line and ends in an ellipsis when it does not fit",
    /white-space:\s*nowrap/.test(hint?.body) &&
      /overflow:\s*hidden/.test(hint?.body) &&
      /text-overflow:\s*ellipsis/.test(hint?.body),
    show(hint),
  );
  // Keyboard up: the conversation's box has 200 px less the field; the field stops where 44 px of it stay in view.
  let kf = null;
  const k = drawSession(S.running, "Works", {
    scrollBox: {
      scrollTop: 0,
      scrollHeight: 2000,
      get clientHeight() {
        return 200 - (kf ? heightOf(kf) : LINE);
      },
    },
  });
  kf = await until(() => byTag(k.dock, "textarea")[0]);
  kf.value = lines(60);
  kf.fire("input");
  check(
    "with little room the field stops at the most lines that leave 44 px of the conversation (7 lines here)",
    heightOf(kf) === 154,
    show(heightOf(kf)),
  );

  // ---- copy and the long press (comfort design, section 7, branch A: the iPhone selects text in place)
  const clip = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: {
      clipboard: {
        writeText: (t) => {
          clip.push(t);
          return Promise.resolve();
        },
      },
    },
  });
  const ANSWER = "Done with **two** files, see `a.mjs`.";
  for (const d of drawn) d.isConnected = false;
  const cp = drawSession(S.running, "Works", { scrollBox: scrollStandIn() });
  await until(() => byClass(cp.view, "reply").length);
  const answer = byClass(cp.view, "reply")[0];
  const mine = byClass(cp.view, "you-row")[0];
  clip.length = 0;
  byClass(answer, "msg-copy")[0]?.click();
  const tookAnswer = clip.slice();
  byClass(mine, "msg-copy")[0]?.click();
  const tookMine = clip.slice();
  check(
    "a tap on a message's copy icon puts the message as written on the clipboard inside the tap (answer in its Markdown source, your message as typed)",
    tookAnswer.length === 1 &&
      tookAnswer[0] === ANSWER &&
      tookMine[1] === "Tidy the tests",
    show({ tookAnswer, tookMine }),
  );
  await sleep(0);
  const done = byClass(answer, "msg-copy")[0];
  check(
    "after the copy the icon shows Copied in the success colour",
    hasClass(done, "ok") &&
      done.textContent === "Copied" &&
      done.attrs["aria-label"] === "Copied",
    show({ cls: done?.className, text: done?.textContent }),
  );

  // A press goes to the node and every element around it, as an event bubbles in the page.
  async function press(
    node,
    { ms = 350, pointerType = "touch", move = 0 } = {},
  ) {
    let prevented = 0;
    const ev = (x) => ({
      pointerType,
      clientX: 10 + x,
      clientY: 10,
      preventDefault: () => prevented++,
    });
    const up = [];
    for (let n = node; n; n = n.parentNode) if (n.fire) up.push(n);
    const fireUp = (type, x = 0) => {
      for (const n of up) n.fire(type, ev(x));
    };
    fireUp("touchstart");
    fireUp("pointerdown");
    if (move) fireUp("pointermove", move);
    await sleep(ms);
    fireUp("contextmenu");
    fireUp("pointerup");
    fireUp("touchend");
    return prevented;
  }
  const menus = () => byClass(cp.view, "msg-menu");
  const onText = [
    byClass(mine, "you")[0],
    byTag(answer, "strong")[0],
    byClass(answer, "md-code")[0],
    byTag(answer, "p")[0],
  ];
  let textPrevented = 0;
  for (const n of onText) textPrevented += await press(n);
  check(
    "a 300 ms press on message text (your bubble, the answer, its code) opens no menu and prevents no default",
    onText.every(Boolean) &&
      menus().length === 0 &&
      byClass(cp.view, "msg-scrim").length === 0 &&
      textPrevented === 0,
    show({ found: onText.map(Boolean), menus: menus().length, textPrevented }),
  );
  await press(byClass(answer, "acts-gap")[0], { ms: 150 });
  const short = menus().length;
  await press(byClass(answer, "acts-gap")[0], { move: 30 });
  const moved = menus().length;
  await press(byClass(answer, "acts-gap")[0], { pointerType: "mouse" });
  const mouse = menus().length;
  check(
    "off the text, a shorter press, a press that moves over 10 px, or a mouse press opens no menu",
    short === 0 && moved === 0 && mouse === 0,
    show({ short, moved, mouse }),
  );
  byClass(cp.view, "msg-scrim")[0]?.click();
  await press(byClass(answer, "acts-gap")[0]);
  const underAnswer = menus()[0];
  check(
    "a 300 ms press on the action row under an answer opens the menu with Copy only, under the lit answer, over a dim",
    menus().length === 1 &&
      underAnswer.textContent === "Copy" &&
      underAnswer.parentNode?.childNodes.indexOf(underAnswer) ===
        underAnswer.parentNode?.childNodes.indexOf(answer) + 1 &&
      hasClass(answer, "lifted") &&
      byClass(cp.view, "msg-scrim").length === 1,
    show({ menus: menus().map((m) => m.textContent), cls: answer.className }),
  );
  clip.length = 0;
  if (underAnswer) byTag(underAnswer, "button")[0].click();
  const fromMenu = clip.slice();
  await sleep(0);
  const pill = byClass(cp.dock, "copied-pill")[0];
  check(
    "Copy in the menu copies the answer inside the tap, closes the menu and the dim, and shows Copied above the dock",
    fromMenu.length === 1 &&
      fromMenu[0] === ANSWER &&
      menus().length === 0 &&
      byClass(cp.view, "msg-scrim").length === 0 &&
      !hasClass(answer, "lifted") &&
      pill?.hidden === false &&
      pill.textContent === "Copied",
    show({ fromMenu, menus: menus().length, pill: pill?.textContent }),
  );
  await press(byClass(mine, "you-gap")[0]);
  const besideMine = menus()[0];
  byClass(cp.view, "msg-scrim")[0]?.click();
  check(
    "a 300 ms press in the space left of your bubble opens Copy at the bubble's side; a tap on the dim closes it",
    besideMine !== undefined &&
      hasClass(besideMine, "mine") &&
      besideMine.textContent === "Copy" &&
      menus().length === 0 &&
      !hasClass(mine, "lifted"),
    show({ cls: besideMine?.className, menus: menus().length }),
  );

  const cssRules = [...noComments(css).matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(
    (m) => ({ sel: m[1].trim(), body: m[2] }),
  );
  const onMessage = (sel) =>
    sel
      .split(",")
      .some((s) => /\.(you|reply|md)(?![-\w])/.test(s) && !/\.md-/.test(s));
  const selectNone = cssRules.filter(
    (x) => onMessage(x.sel) && /user-select:\s*none/.test(x.body),
  );
  const selectText = cssRules.find(
    (x) =>
      /(^|,)\s*\.you\s*(,|$)/.test(x.sel) &&
      /(^|,)\s*\.md\s+\*\s*(,|$)/.test(x.sel),
  );
  check(
    "message bubbles and answers carry no user-select: none, and their text is selectable over Telegram's own rule",
    selectNone.length === 0 &&
      /-webkit-user-select:\s*text !important/.test(selectText?.body) &&
      /(^|[^-])user-select:\s*text !important/.test(selectText?.body),
    show({ selectNone, selectText }),
  );

  // ---- text size (comfort design, section 6): three steps in Settings, kept on the phone
  await import(pageUrl("screens/settings.js"));
  const settings = screens.screen("settings").render({
    connected: false,
    tg: { platform: "ios" },
    haptic: () => {},
    ask,
  });
  const sizeSeg = () =>
    walk(settings).find((n) => n.attrs?.["aria-label"] === "Text size");
  const sample = () => byClass(settings, "text-sample")[0];
  const steps = byTag(sizeSeg() ?? settings, "button").map(
    (b) => b.textContent,
  );
  const wasDefault =
    byTag(sizeSeg(), "button").find((b) => b.attrs["aria-checked"] === "true")
      ?.textContent === "Default";
  byTag(sizeSeg(), "button")
    .find((b) => b.textContent === "Large")
    .click();
  const big = drawSession(S.running, "Works");
  check(
    "Settings' Text size has Small, Default and Large; picking Large is kept on the phone and sets the session view and the sample",
    show(steps) === show(["Small", "Default", "Large"]) &&
      wasDefault &&
      stored.get("phone.text-size") === "large" &&
      sample()?.attrs["data-text"] === "large" &&
      big.view.attrs["data-text"] === "large" &&
      byTag(sizeSeg(), "button").find((b) => b.attrs["aria-checked"] === "true")
        ?.textContent === "Large",
    show({ steps, kept: stored.get("phone.text-size"), view: big.view.attrs }),
  );
  big.view.isConnected = false;
  byTag(sizeSeg(), "button")
    .find((b) => b.textContent === "Default")
    .click();
  // Every rule with exactly this selector, joined (:root has several).
  const ruleOf = (sel) =>
    cssRules
      .filter((x) => x.sel === sel)
      .map((x) => x.body)
      .join("");
  const sizeOk = (sel, body, answer, code) =>
    ruleOf(sel).includes(`--p-read: 400 ${body} var(--p-font)`) &&
    ruleOf(sel).includes(`--p-read-answer: ${answer}`) &&
    ruleOf(sel).includes(`--p-read-code: 500 ${code} var(--x-font-mono)`);
  check(
    "each text size changes your messages, the answers and code: Small 15/21 (23) code 12/18, Default 16/22 (25) code 13/20, Large 18/25 (28) code 15/22",
    sizeOk('[data-text="small"]', "15px/21px", "23px", "12px/18px") &&
      sizeOk(":root", "16px/22px", "25px", "13px/20px") &&
      sizeOk('[data-text="large"]', "18px/25px", "28px", "15px/22px") &&
      /font: var\(--p-read\)/.test(ruleOf(".you")) &&
      /font: var\(--p-read\)/.test(ruleOf(".reply")) &&
      /line-height: var\(--p-read-answer\)/.test(ruleOf(".reply")) &&
      /font: var\(--p-read-code\)/.test(ruleOf(".md-pre")),
    show({
      you: ruleOf(".you"),
      reply: ruleOf(".reply"),
      pre: ruleOf(".md-pre"),
    }),
  );

  // ---- code blocks: a head with the language, Wrap lines and Copy code
  const { markdown } = await import(pageUrl("frame/markdown.js"));
  const md = markdown("Run it:\n\n```bash\necho hi\n```\n\n```\nplain\n```");
  const [b1, b2] = byClass(md, "md-block");
  const tools = (b) => byClass(b, "md-tool");
  check(
    "a code block's head shows its language (Code when none) and starts wrapped",
    byClass(b1, "md-lang")[0]?.textContent === "bash" &&
      byClass(b2, "md-lang")[0]?.textContent === "Code" &&
      hasClass(b1, "wrap") &&
      tools(b1)[0]?.attrs["aria-label"] === "Wrap lines" &&
      tools(b1)[0]?.attrs["aria-pressed"] === "true",
    show({ cls: b1?.className }),
  );
  tools(b1)[0].click();
  const later = markdown("```js\nlet a\n```");
  check(
    "the wrap switch unwraps its block and the choice is kept for code blocks drawn after it",
    !hasClass(b1, "wrap") &&
      tools(b1)[0].attrs["aria-pressed"] === "false" &&
      hasClass(b2, "wrap") &&
      stored.get("phone.code-wrap") === "scroll" &&
      !hasClass(byClass(later, "md-block")[0], "wrap"),
    show({ b1: b1.className, kept: stored.get("phone.code-wrap") }),
  );
  tools(b1)[0].click();
  check(
    "wrapped code breaks its lines at the block's width; unwrapped it scrolls sideways",
    /white-space: pre-wrap/.test(ruleOf(".md-block.wrap .md-pre")) &&
      /white-space: pre;/.test(ruleOf(".md-pre")) &&
      /overflow-x: auto/.test(ruleOf(".md-pre")) &&
      stored.get("phone.code-wrap") === "wrap",
  );
  clip.length = 0;
  tools(b1)[1].click();
  const code = clip.slice();
  await sleep(0);
  check(
    "Copy code copies the code only, without the fence, inside the tap; the language word turns to Copied",
    tools(b1)[1].attrs["aria-label"] === "Copy code" &&
      show(code) === show(["echo hi"]) &&
      byClass(b1, "md-lang")[0]?.textContent === "Copied" &&
      hasClass(tools(b1)[1], "ok"),
    show({ code, word: byClass(b1, "md-lang")[0]?.textContent }),
  );
} catch (e) {
  failure = e;
} finally {
  for (const v of drawn) v.isConnected = false;
  await fake.close();
  fx.close();
  (await import("../skills/phone-bot/pc/core/db.mjs")).closeDb();
}
if (failure) {
  console.log(`FAIL the run stopped: ${failure.stack}`);
  failed++;
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
