// Tests for the phone page's session view (phone/page/screens/session.js, session-cards.js, frame/markdown.js),
// the Projects screens' files, and their part of page.css. The page's screens run in Node on a DOM stand-in and
// ask the real PC registry, which reads a fixture nimbalyst.sqlite in a temp home and talks to a fake door (a
// local MCP server answering from fixtures and recording every call).
// Run: node tests/test-phone-page-session.mjs
import fs from "node:fs";
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
const screens = await import(pageUrl("frame/screens.js"));
const { turnsView, drafts, why, newAtEnd } = await import(
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
