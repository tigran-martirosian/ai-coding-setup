// Tests for the live part of the phone page's session view (phone/page/screens/session-live.js, session-form.js
// and their wiring in session.js and session-cards.js), and its part of page.css. The page's screens run in Node on
// a DOM stand-in and ask the real PC registry, which reads a fixture nimbalyst.sqlite and fixture transcripts in a
// temp home and talks to a fake door (a local MCP server with the door patch's tools, recording every call). The
// PC's pushes reach the page through a stand-in channel: pushHere hands them to the page's event listeners.
// Run: node tests/test-phone-page-live.mjs
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
const show = (v) => JSON.stringify(v)?.slice(0, 600);
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-page-live-"));
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

// The project folder exists: projects.list leaves out a project whose folder is gone.
const P = { beta: path.join(tmp, "projects", "beta") };
fs.mkdirSync(P.beta, { recursive: true });

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
const setStatus = (id, status) =>
  fx.prepare("UPDATE ai_sessions SET status = ? WHERE id = ?").run(status, id);
const LIVE_T = "22222222-3333-4444-8555-666666666666";
const LIVE_T2 = "33333333-4444-4555-8666-777777777777";
const THINK_T = "44444444-5555-4666-8777-888888888888";
const S = {
  form: addSession("Waits on a form", "waiting_for_input"),
  live: addSession("Works live", "running", LIVE_T),
  again: addSession("Works after a reconnect", "running", LIVE_T2),
  think: addSession("Thinks live", "running", THINK_T),
  plan: addSession("Waits on a plan", "waiting_for_input"),
};

// The form: the newest PromptForUserInput tool call of the session, with no result yet; three fields the phone draws.
const FORM_ID = "toolu_form_live_1";
const addMessage = (session, content) =>
  fx
    .prepare(
      "INSERT INTO ai_agent_messages (session_id, created_at, direction, content, message_kind) VALUES (?, ?, ?, ?, 'tool')",
    )
    .run(
      session,
      new Date().toISOString(),
      content.type === "user" ? "input" : "output",
      JSON.stringify(content),
    );
addMessage(S.form, {
  type: "assistant",
  message: {
    content: [
      {
        type: "tool_use",
        id: FORM_ID,
        name: "mcp__nimbalyst__PromptForUserInput",
        input: {
          title: "Release details",
          fields: [
            {
              id: "where",
              type: "singleSelect",
              label: "Where does it go?",
              allowOther: true,
              options: [
                { id: "stage", label: "Staging" },
                { id: "prod", label: "Production" },
              ],
            },
            {
              id: "parts",
              type: "multiSelect",
              label: "Which parts?",
              minSelected: 1,
              items: [
                { id: "page", title: "Page" },
                { id: "relay", title: "Relay" },
                { id: "pc", title: "PC program" },
              ],
            },
            {
              id: "note",
              type: "editText",
              label: "Release note",
              initialText: "Fixes",
              minLength: 1,
            },
          ],
        },
      },
    ],
  },
});

// The working sessions' transcripts: a question, a reply with its token count (170k of a 200k window: 85 %).
const talkDir = path.join(
  home,
  ".claude",
  "projects",
  P.beta.replace(/[^A-Za-z0-9]/g, "-"),
);
fs.mkdirSync(talkDir, { recursive: true });
const at = (s) => new Date(Date.UTC(2026, 10, 14, 9, 0, s)).toISOString();
const line = (o) => `${JSON.stringify(o)}\n`;
const reply = (text, s, input = 170000) => ({
  type: "assistant",
  timestamp: at(s),
  message: {
    usage: { input_tokens: input, output_tokens: 10 },
    content: [{ type: "text", text }],
  },
});
for (const t of [LIVE_T, LIVE_T2])
  fs.writeFileSync(
    path.join(talkDir, `${t}.jsonl`),
    line({ type: "user", timestamp: at(0), message: { content: "Ship it" } }) +
      line(reply("Starting on it.", 1)),
  );
const append = (t, ...lines) =>
  fs.appendFileSync(path.join(talkDir, `${t}.jsonl`), lines.map(line).join(""));

// The queue lives in the fixture database: the live watch reads it there, the fake door lists and removes it there.
const addQueued = (session, id, prompt) =>
  fx
    .prepare(
      "INSERT INTO queued_prompts (id, session_id, prompt, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
    )
    .run(id, session, prompt, new Date().toISOString());
addQueued(S.live, "q-1", "Also run the linter");

// ---- the fake door: the base tools and the door patch's four
const door = {
  [S.form]: { status: "waiting_for_input", pendingPrompt: null },
  [S.live]: { status: "running", pendingPrompt: null },
  [S.again]: { status: "running", pendingPrompt: null },
  [S.think]: { status: "running", pendingPrompt: null },
  [S.plan]: {
    status: "waiting_for_input",
    pendingPrompt: {
      promptId: "prompt-plan-1",
      promptType: "exit_plan_mode_request",
      content: { plan: "# Plan\n\n1. Read the tests\n2. Fix them" },
    },
  },
};
let refuseRemove = false; // the door refuses remove_queued_prompt while set
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
      const prompts = fx
        .prepare(
          "SELECT id, prompt, created_at FROM queued_prompts WHERE session_id = ? ORDER BY created_at",
        )
        .all(a.sessionId)
        .map((q) => ({
          id: q.id,
          status: "pending",
          createdAt: Date.parse(q.created_at),
          // As Nimbalyst answers: a 300-character preview, the whole text only on includePromptText.
          promptPreview:
            q.prompt.length > 300 ? `${q.prompt.slice(0, 300)}...` : q.prompt,
          ...(a.includePromptText === true ? { prompt: q.prompt } : {}),
        }));
      return { sessionId: a.sessionId, count: prompts.length, prompts };
    }
    case "remove_queued_prompt":
      if (refuseRemove)
        throw Object.assign(new Error("refused"), {
          rpc: "the prompt is no longer pending",
        });
      fx.prepare("DELETE FROM queued_prompts WHERE id = ?").run(a.promptId);
      return { removed: true };
    case "stop_session":
      s.status = "idle";
      setStatus(a.sessionId, "idle");
      return { success: true };
    case "answer_form":
      // Nimbalyst writes the form's result; the PC reads it to know the form is closed.
      addMessage(a.sessionId, {
        type: "user",
        message: {
          content: [
            { type: "tool_result", tool_use_id: a.promptId, content: "ok" },
          ],
        },
      });
      s.status = "running";
      return { success: true };
    case "answer_plan":
      s.status = "running";
      s.pendingPrompt = null;
      return { success: true };
    case "send_prompt":
      return { statusBeforeQueue: s.status, processingTriggered: false };
    default:
      throw new Error(`the fake door has no ${name}`);
  }
}

const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const TOOLS = [
  "workspace_open",
  "get_session_status",
  "get_session_result",
  "list_queued_prompts",
  "send_prompt",
  "remove_queued_prompt",
  "stop_session",
  "answer_form",
  "answer_plan",
];
// A new door has a new port, so the PC reads its tool list again.
const startDoor = (tools) =>
  startFakeDoor({
    endpointFile: path.join(NIM, "mcp-endpoint.json"),
    workspaces: Object.entries(P).map(([name, p]) => ({ name, path: p })),
    tools,
    handle,
  });
let fake = await startDoor(TOOLS);
const callsOf = (name, session) =>
  fake.calls.filter((c) => c.name === name && c.args.sessionId === session);

// ---- the real registry with every action module, behind stand-in channel sessions of one device
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const { watchCount } = await import("../skills/phone-bot/pc/actions/live.mjs");
let rn = 0;
// One channel session: pushHere hands an event to the page's listeners; end() ends it as a dropped link does.
// Without `push` the channel gives no pushHere, as in the session page's test.
function channel({ push = true } = {}) {
  const listeners = new Set();
  const ends = new Set();
  const pcCtx = {
    page: "ok",
    device: "dev-test",
    setupVersion: "0.0.0",
    push: () => {},
    ...(push
      ? {
          pushHere: (body) => {
            for (const fn of listeners) fn({ k: "evt", ...body });
          },
          onEnd: (fn) => {
            ends.add(fn);
            return () => ends.delete(fn);
          },
        }
      : {}),
  };
  return {
    listeners,
    ask: (a, d) => registry.handle({ k: "req", id: `r-${++rn}`, a, d }, pcCtx),
    end: () => {
      for (const fn of [...ends]) fn("closed");
    },
  };
}
const asked = channel({ push: false });

// ---- the page side: a DOM stand-in with what frame/dom.js and the session files use
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
    this.value = "";
    this.isConnected = true;
    this.focused = false;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
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
  }
  blur() {
    this.focused = false;
  }
  scrollIntoView() {}
}
Object.assign(globalThis, {
  Node: FakeNode,
  document: {
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
  },
  requestAnimationFrame: (fn) => setTimeout(fn, 0),
});

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
const action = (root, a) => button(root, (b) => b.attrs["data-action"] === a);
const texts = (root, c) => byClass(root, c).map((n) => n.textContent);

const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
const screens = await import(pageUrl("frame/screens.js"));
await import(pageUrl("screens/session.js")); // registers the session screen
const { timing } = await import(pageUrl("screens/session-cards.js"));
timing.undoMs = 300;

const projects = await asked.ask("projects.list");
const beta = projects.d?.find((p) => p.name === "beta")?.project;

// Draws the session view for `session` on channel `ch`; `root` holds the view and the dock.
const drawn = [];
function drawSession(session, title, ch) {
  const c = {
    connected: true,
    params: { session, project: beta, title },
    tg: { platform: "ios" },
    offered: () => true,
    ask: ch.ask,
    go: () => {},
    onEvent: (fn) => ch.listeners.add(fn),
    beforeSleep: () => () => {},
    haptic: () => {},
    mainButton: () => {},
    // The frame's scroll box (#content), the one thing that scrolls.
    scrollBox: { scrollTop: 0, scrollHeight: 2000, clientHeight: 800 },
  };
  const out = screens.screen("session").render(c);
  drawn.push(out.content);
  const root = new FakeElement("div");
  root.append(out.content, out.bottom);
  return { root, dock: out.bottom, view: out.content };
}
const gone = (x) => {
  x.view.isConnected = false;
};

let failure = null;
try {
  check(
    "projects.list names the fixture project",
    projects.ok && Boolean(beta),
    show(projects),
  );

  // ---- a three-field form: the app's own card and sheet, all three answers through answer_form
  const chForm = channel();
  const f = drawSession(S.form, "Waits on a form", chForm);
  const card = await until(() => byClass(f.dock, "qcard")[0]);
  check(
    "a form the phone can draw docks as the app's own card, not the answer-on-the-PC card",
    card?.attrs["data-kind"] === "form" &&
      card.textContent.includes("Needs you · Form") &&
      card.textContent.includes("Release details: 3 questions") &&
      byClass(f.dock, "pc-card").length === 0,
    f.dock.textContent,
  );
  action(f.dock, "open-form")?.click();
  const sendForm = () => action(f.dock, "form.answer");
  check(
    "Open the form shows the sheet with the three numbered questions; Send answers is off until each has its answer",
    byClass(f.dock, "fsheet").length === 1 &&
      byClass(f.dock, "fq").length === 3 &&
      sendForm()?.disabled === true &&
      byClass(f.dock, "fmeta")[0]?.textContent.includes("1 of 3 answered"),
    f.dock.textContent,
  );
  const pick = (field, option) =>
    button(
      byClass(f.dock, "fq").find((b) => b.attrs["data-field"] === field) ??
        f.dock,
      (b) => b.attrs["data-option"] === option,
    )?.click();
  pick("where", "prod");
  pick("where", "__other__");
  const otherBox = () =>
    byClass(f.dock, "ffield").find((n) => n.attrs["data-other"] === "where");
  check(
    "a pick-one field that allows other has an Other row; picking it opens its own-answer box, and it needs text",
    Boolean(otherBox()) &&
      byClass(f.dock, "fmeta")[0]?.textContent.includes("1 of 3 answered"),
    f.dock.textContent,
  );
  otherBox().value = "Canary first";
  otherBox().fire("input");
  pick("parts", "relay");
  pick("parts", "pc");
  const note = byClass(f.dock, "ffield").find((n) => !n.attrs["data-other"]);
  note.value = "Ships the live view";
  note.fire("input");
  check(
    "with every question answered, Send answers is on",
    sendForm()?.disabled === false &&
      byClass(f.dock, "fmeta")[0]?.textContent === "3 of 3 answered",
    byClass(f.dock, "fmeta")[0]?.textContent,
  );
  sendForm()?.click();
  const formCall = await until(() => callsOf("answer_form", S.form)[0]);
  const ans = formCall?.args.answers;
  check(
    "Send answers sends all three answers, the own answer as __other__ with its text, through the patch's answer_form on the fake door",
    formCall?.args.promptId === FORM_ID &&
      formCall.args.cancelled === false &&
      ans?.where?.selectedId === "__other__" &&
      ans.where.otherText === "Canary first" &&
      show(ans?.parts?.selectedIds) === show(["relay", "pc"]) &&
      ans?.note?.text === "Ships the live view" &&
      ans.note.edited === true &&
      Object.keys(ans).length === 3,
    show(formCall),
  );
  check(
    "once the form is answered, the typing box takes the card's place",
    Boolean(
      await until(
        () =>
          byTag(f.dock, "textarea").length === 1 &&
          byClass(f.dock, "qcard").length === 0,
      ),
    ),
    f.dock.textContent,
  );
  gone(f);

  // ---- a working session followed live: work rows, thinking, context, helpers, the queued row
  const ch = channel();
  const r = drawSession(S.live, "Works live", ch);
  const qrow = await until(() => byClass(r.dock, "queued")[0]);
  check(
    "the watch's first state shows the queued message as a row above the typing box, and context from 80 % in words",
    qrow?.textContent.startsWith("Queued 1Also run the linter") &&
      Boolean(button(qrow, (b) => b.textContent === "Edit")) &&
      byClass(r.view, "s-ctx")[0]?.textContent === "context 170k of 200k" &&
      byTag(r.view, "progress")[0]?.attrs.value === "85" &&
      watchCount() === 1,
    show({ dock: r.dock.textContent, bar: texts(r.view, "s-line") }),
  );
  append(
    LIVE_T,
    {
      type: "assistant",
      timestamp: at(5),
      message: { content: [{ type: "thinking", thinking: "x" }] },
    },
    {
      type: "assistant",
      timestamp: at(9),
      message: {
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "npm test" },
          },
        ],
      },
    },
  );
  await until(() => byClass(r.view, "wstep").length >= 2, 4000);
  check(
    "a tool call reaches the page as it happens; thinking is one line with its time",
    // The running step counts from its start in the fixture's past, so its time is any number.
    /^Thought4s\|Runnpm test\d+[smh]/.test(texts(r.view, "wstep").join("|")),
    show(texts(r.view, "wstep")),
  );
  const tool = (id, name, input, s) => ({
    type: "assistant",
    timestamp: at(s),
    message: { content: [{ type: "tool_use", id, name, input }] },
  });
  const result = (id, s, extra = {}) => ({
    type: "user",
    timestamp: at(s),
    message: {
      content: [{ type: "tool_result", tool_use_id: id, content: "done" }],
    },
    ...extra,
  });
  append(
    LIVE_T,
    result("t1", 12),
    tool("t2", "Read", { file_path: "a.mjs" }, 13),
    result("t2", 14),
    tool("t3", "Grep", { pattern: "watch" }, 14),
    result("t3", 15),
    tool(
      "h1",
      "Task",
      { description: "Check the relay", subagent_type: "general" },
      16,
    ),
  );
  const fold = await until(() => byClass(r.view, "fold")[0], 4000);
  check(
    "a run of more than 3 steps shows its last 3 and folds the earlier ones with their time",
    fold?.textContent === "2 earlier steps · 11s" &&
      byClass(r.view, "wstep").length === 4,
    show(texts(r.view, "wstep")),
  );
  fold?.click();
  check(
    "a tap on the fold shows every step in place",
    byClass(r.view, "wstep").length === 5 && !byClass(r.view, "fold").length,
    show(texts(r.view, "wstep")),
  );
  const hl = await until(() => action(r.dock, "session.helpers"), 4000);
  check(
    "a helper shows as one line above the dock",
    hl?.textContent === "1 helper working",
    r.dock.textContent,
  );
  hl?.click();
  check(
    "the helpers line opens its sheet: Working, the helper's name",
    byClass(r.dock, "hsheet")[0]?.textContent.includes(
      "WorkingCheck the relay",
    ),
    r.dock.textContent,
  );
  append(
    LIVE_T,
    result("h1", 76, {
      toolUseResult: {
        status: "completed",
        totalDurationMs: 60000,
        totalTokens: 41000,
        totalToolUseCount: 7,
      },
    }),
  );
  check(
    "a finished helper moves to Finished with its time, tokens and steps",
    Boolean(
      await until(
        () =>
          byClass(r.dock, "hsheet")[0]?.textContent.includes(
            "FinishedCheck the relayFinished · 1m 00s · 41k tokens · 7 steps",
          ),
        4000,
      ),
    ),
    r.dock.textContent,
  );

  // ---- removing a queued message: the row goes at once, the message leaves after the Undo
  button(qrow, (b) => b.attrs["data-action"] === "queue.remove")?.click();
  check(
    "Remove takes the row off at once and shows Removed with Undo",
    !byClass(r.dock, "queued").length &&
      /Removed.*Undo/.test(r.dock.textContent),
    r.dock.textContent,
  );
  const removed = await until(() => callsOf("remove_queued_prompt", S.live)[0]);
  const list = await asked.ask("queue.list", { session: S.live });
  await sleep(1500);
  check(
    "after the Undo the message is removed through remove_queued_prompt and is gone from the list",
    removed?.args.promptId === "q-1" &&
      list.ok &&
      list.d.length === 0 &&
      !byClass(r.dock, "queued").length &&
      !/Removed/.test(r.dock.textContent),
    show({ removed, list, dock: r.dock.textContent }),
  );
  addQueued(S.live, "q-2", "Then tidy up");
  const q2 = await until(() => byClass(r.dock, "queued")[0], 4000);
  button(
    q2 ?? r.dock,
    (b) => b.attrs["data-action"] === "queue.remove",
  )?.click();
  button(r.dock, (b) => b.textContent.startsWith("Undo"))?.click();
  await sleep(600);
  check(
    "Undo keeps a queued message: the row comes back and nothing is removed",
    byClass(r.dock, "queued")[0]?.textContent.includes("Then tidy up") &&
      callsOf("remove_queued_prompt", S.live).length === 1,
    r.dock.textContent,
  );

  // ---- Edit on a queued message: it leaves the queue first, then its whole text joins the typing box
  const field = () => byTag(r.dock, "textarea")[0];
  const type = (text) => {
    field().value = text;
    field().fire("input");
  };
  const editOf = (row) =>
    button(row ?? r.dock, (b) => b.textContent === "Edit");
  const rowOf = (id) =>
    byClass(r.dock, "queued").find((n) => n.attrs["data-queue"] === id);
  type("Draft above");
  refuseRemove = true;
  editOf(rowOf("q-2"))?.click();
  await until(() => /Not removed/.test(r.dock.textContent));
  check(
    "a refused remove leaves the row and the typing box as they were and shows the reason",
    callsOf("remove_queued_prompt", S.live).length === 2 &&
      rowOf("q-2")?.textContent.includes("Then tidy up") &&
      field()?.value === "Draft above" &&
      /Not removed: /.test(r.dock.textContent),
    show({ dock: r.dock.textContent, box: field()?.value }),
  );
  refuseRemove = false;
  const LONG = `${"word ".repeat(399)}words`;
  addQueued(
    S.live,
    "q-3",
    `${LONG}

(Sent from the phone.)`,
  );
  (
    await until(() => button(r.dock, (b) => hasClass(b, "many")), 4000)
  )?.click();
  const longRow = await until(() => rowOf("q-3"));
  check(
    "a queued message of 2,000 characters has Edit, and its row shows at most 300 characters",
    LONG.length === 2000 &&
      Boolean(editOf(longRow)) &&
      byClass(longRow, "tx")[0]?.textContent.length <= 300,
    show({ row: longRow?.textContent.length }),
  );
  editOf(longRow)?.click();
  await until(() => field()?.value !== "Draft above");
  check(
    "Edit calls remove_queued_prompt, then the whole text without the phone's note goes in the box below the text typed before and an empty line",
    callsOf("remove_queued_prompt", S.live)[2]?.args.promptId === "q-3" &&
      field()?.value ===
        `Draft above

${LONG}` &&
      !rowOf("q-3"),
    show({ box: field()?.value.slice(0, 80), dock: r.dock.textContent }),
  );
  type("");
  editOf(rowOf("q-2"))?.click();
  await until(() => field()?.value);
  check(
    "with an empty typing box, Edit puts just the message's text in it",
    field()?.value === "Then tidy up" && !byClass(r.dock, "queued").length,
    show({ box: field()?.value, dock: r.dock.textContent }),
  );

  // ---- Stop through the patch's stop_session
  action(r.view, "session.stop")?.click();
  const stopped = await until(() => callsOf("stop_session", S.live)[0]);
  check(
    "Stop calls the patch's stop_session, and the conversation ends with Stopped by you",
    Boolean(stopped) &&
      Boolean(await until(() => r.view.textContent.includes("Stopped by you"))),
    r.view.textContent,
  );
  gone(r);

  // ---- thinking: the bar's turn time, a live Thinking row, then "Thought" with its time and its text
  const ago = (sec) => new Date(Date.now() - sec * 1000).toISOString();
  const thought = (thinking) => ({
    type: "assistant",
    timestamp: new Date().toISOString(),
    message: { content: [{ type: "thinking", thinking, signature: "sig" }] },
  });
  fs.writeFileSync(
    path.join(talkDir, `${THINK_T}.jsonl`),
    [
      { type: "user", timestamp: ago(134), message: { content: "Find it" } },
      { ...tool("k1", "Read", { file_path: "c.mjs" }, 0), timestamp: ago(30) },
      { ...result("k1", 0), timestamp: ago(20) },
    ]
      .map(line)
      .join(""),
  );
  const k = drawSession(S.think, "Thinks live", channel());
  const clockOf = () => byClass(k.view, "s-time")[0]?.textContent;
  const liveThink = () =>
    texts(k.view, "wstep").find((t) => t.startsWith("Thinking"));
  const bar1 = await until(clockOf, 4000);
  const row1 = await until(liveThink, 4000);
  await sleep(2100);
  const bar2 = clockOf();
  const row2 = liveThink();
  const secs = (t) => Number(t?.match(/(\d+)s$/)?.[1]);
  check(
    "the bar's time counts each second from the turn's start while the session works",
    /^ · 2m 1\ds$/.test(bar1) &&
      /^ · 2m 1\ds$/.test(bar2) &&
      secs(bar2) > secs(bar1) &&
      texts(k.view, "s-word")[0] === `Working${bar2}`,
    show({ bar1, bar2, word: texts(k.view, "s-word") }),
  );
  check(
    "with no step open, a live Thinking row counts from the last row's time",
    /^Thinking2\ds$/.test(row1) && secs(row2) > secs(row1),
    show({ row1, row2, rows: texts(k.view, "wstep") }),
  );
  append(THINK_T, thought(`Two ways to look. ${"y".repeat(5000)}`));
  const done = await until(
    () => texts(k.view, "wstep").find((t) => t.startsWith("Thought")),
    4000,
  );
  const chev = byClass(k.view, "has-text")[0];
  check(
    "after the thinking row the live row reads Thought with its time, and no live Thinking row is left",
    /^Thought2\ds$/.test(done) &&
      !liveThink() &&
      chev?.tagName === "button" &&
      chev.attrs["aria-expanded"] === "false" &&
      !byClass(k.view, "wthink-text").length,
    show({ done, rows: texts(k.view, "wstep") }),
  );
  chev?.click();
  const opened = byClass(k.view, "wthink-text")[0];
  const cutNote = byClass(k.view, "wthink-cut")[0]?.textContent ?? "";
  await sleep(1100); // a tick draws the rows again: the text stays open
  check(
    "a tap on the Thought row opens its text in place, cut at 4,000 characters",
    opened?.textContent.startsWith("Two ways to look.") &&
      opened.textContent.length - cutNote.length === 4000 &&
      cutNote.includes("4,000") &&
      byClass(k.view, "wthink-text").length === 1 &&
      byClass(k.view, "has-text")[0]?.attrs["aria-expanded"] === "true",
    show({ len: opened?.textContent.length, cutNote }),
  );
  append(THINK_T, thought(""));
  await until(
    () =>
      texts(k.view, "wstep").filter((t) => t.startsWith("Thought")).length ===
      2,
    4000,
  );
  check(
    "a thinking row without text has no chevron and does not open",
    byClass(k.view, "has-text").length === 1 &&
      byClass(k.view, "think").filter((n) => n.tagName === "div").length === 1,
    show(texts(k.view, "wstep")),
  );
  gone(k);
  check(
    "the views that are gone stop their watches",
    Boolean(await until(() => watchCount() === 0, 4000)),
    String(watchCount()),
  );

  // ---- a reconnect: the view drawn again watches again; the old view does not stop the new watch
  const ch1 = channel();
  const a1 = drawSession(S.again, "Works after a reconnect", ch1);
  await until(() => byTag(a1.view, "progress")[0]?.attrs.value === "85");
  ch1.end();
  gone(a1);
  const ch2 = channel();
  const a2 = drawSession(S.again, "Works after a reconnect", ch2);
  await until(
    () =>
      watchCount() === 1 && byTag(a2.view, "progress")[0]?.attrs.value === "85",
  );
  await sleep(1500);
  append(LIVE_T2, tool("t9", "Edit", { file_path: "b.mjs" }, 30));
  check(
    "after a reconnect the new view gets pushes; the replaced view did not end its watch",
    Boolean(
      await until(
        () => texts(a2.view, "wstep")[0]?.startsWith("Editb.mjs"),
        4000,
      ),
    ) && watchCount() === 1,
    show({ rows: texts(a2.view, "wstep"), watches: watchCount() }),
  );
  gone(a2);
  check(
    "a view that is gone stops its watch (session.unwatch)",
    Boolean(await until(() => watchCount() === 0, 4000)),
    show(watchCount()),
  );

  // ---- one position: a row written between session.open and session.watch, or while the PC is asked again
  // mid-turn, shows exactly once (session.open answers where it read up to; the watch goes on from there)
  const hook = {};
  const ch3 = channel();
  const ask3 = ch3.ask;
  ch3.ask = async (a, d) => {
    const fn = hook[a];
    hook[a] = null;
    if (fn) fn();
    return ask3(a, d);
  };
  hook["session.watch"] = () =>
    append(LIVE_T2, tool("t10", "Edit", { file_path: "c.mjs" }, 31));
  const a3 = drawSession(S.again, "Works, rows between", ch3);
  const showsOf = (word) =>
    texts(a3.view, "wstep").filter((x) => x.startsWith(word)).length;
  await until(() => showsOf("Editc.mjs") > 0, 4000);
  await sleep(1500);
  check(
    "a row written after session.open read the transcript and before session.watch started shows once",
    showsOf("Editc.mjs") === 1,
    show(a3.view.textContent.slice(-700)),
  );
  hook["session.open"] = () =>
    append(LIVE_T2, tool("t11", "Edit", { file_path: "d.mjs" }, 32));
  for (const fn of ch3.listeners) fn({ k: "evt", e: "status", d: {} });
  await until(() => a3.view.textContent.includes("made 3 edits"), 4000);
  await sleep(1500);
  check(
    "a row written while the PC is asked again mid-turn shows once: in the conversation read again, not live",
    // The three edits (t9, t10, t11) are the conversation's now; none of them stays a live row.
    a3.view.textContent.includes("3 steps: made 3 edits") &&
      showsOf("Edit") === 0,
    show(a3.view.textContent.slice(-700)),
  );
  gone(a3);
  await until(() => watchCount() === 0, 4000);

  // ---- a channel with no push: a line says so and the view keeps working
  const n = drawSession(S.again, "Works after a reconnect", asked);
  check(
    "when session.watch fails, a line says live updates are off and the conversation still shows",
    Boolean(
      await until(() =>
        texts(n.view, "s-note")[0]?.startsWith("Live updates are off"),
      ),
    ) && byClass(n.view, "you").length > 0,
    n.view.textContent,
  );
  gone(n);

  // ---- user lines the system wrote: a helper's notice is one short row, never its text; the others are not shown
  const QUOTE = "why does the report end with <usage>total_tokens: 5</usage>?";
  const said = (content, s) => ({
    type: "user",
    timestamp: at(s),
    message: { content },
  });
  const notice = (status, summary, s) =>
    said(
      `<task-notification>\n<task-id>a1</task-id>\n<status>${status}</status>\n<summary>${summary}</summary>\n<result>raw report</result>\n</task-notification>`,
      s,
    );
  append(
    LIVE_T2,
    notice("completed", 'Agent "build" completed', 40),
    said("<system-reminder>\nfiles changed\n</system-reminder>", 41),
    said("Stop hook feedback:\n[node gate.mjs]: finish the step", 42),
    said(QUOTE, 43),
  );
  const sy = drawSession(S.again, "Works after a reconnect", channel());
  const rowsNow = (v) => texts(v, "system-row");
  const shown = await until(() => rowsNow(sy.view).length === 1);
  check(
    "an opened conversation shows a helper's notice as one row with its summary, the reminder and hook note not at all, a quote whole",
    Boolean(shown) &&
      rowsNow(sy.view)[0] === "Helper finished: build" &&
      !/task-notification|system-reminder|Stop hook|raw report/.test(
        sy.view.textContent,
      ) &&
      texts(sy.view, "you").includes(QUOTE),
    sy.view.textContent,
  );
  await sleep(1500);
  append(
    LIVE_T2,
    notice("failed", 'Agent "check" failed', 50),
    said("<system-reminder>todo list</system-reminder>", 51),
  );
  check(
    "a live helper's notice shows as one more row with its status, a failed one in the error colour; the live reminder does not show",
    Boolean(await until(() => rowsNow(sy.view).length === 2, 4000)) &&
      rowsNow(sy.view)[1] === "Helper failed: check" &&
      byClass(sy.view, "system-row")[1]?.className.includes("bad") &&
      !/system-reminder|todo list|raw report/.test(sy.view.textContent),
    show(rowsNow(sy.view)),
  );
  gone(sy);

  // ---- a plan: Stop also while it needs you; Approve through answer_plan
  const p = drawSession(S.plan, "Waits on a plan", channel());
  const approve = await until(() =>
    button(p.dock, (b) => b.attrs["data-action"] === "approve"),
  );
  check(
    "a session that needs you shows Stop too",
    Boolean(action(p.view, "session.stop")),
    p.view.textContent,
  );
  approve?.click();
  const planCall = await until(() => callsOf("answer_plan", S.plan)[0]);
  check(
    "Approve sends the plan approval through the patch's answer_plan",
    planCall?.args.promptId === "prompt-plan-1" &&
      planCall.args.approved === true,
    show(planCall),
  );
  gone(p);

  // ---- Edit without the door patch's remove_queued_prompt: the reason shows, the row and the box stay
  await fake.close();
  fake = await startDoor(TOOLS.filter((t) => t !== "remove_queued_prompt"));
  addQueued(S.again, "q-9", "Kept on the PC");
  const np = drawSession(S.again, "No patch", channel());
  const row9 = await until(() => byClass(np.dock, "queued")[0], 4000);
  const box9 = byTag(np.dock, "textarea")[0];
  box9.value = "Kept draft";
  box9.fire("input");
  button(row9 ?? np.dock, (b) => b.textContent === "Edit")?.click();
  await until(() => /Not removed/.test(np.dock.textContent));
  check(
    "without the door patch's remove_queued_prompt, Edit shows the reason and keeps the row and the box",
    /Not removed: this needs the door patch on the PC/.test(
      np.dock.textContent,
    ) &&
      byClass(np.dock, "queued")[0]?.textContent.includes("Kept on the PC") &&
      box9.value === "Kept draft" &&
      fake.calls.every((c) => c.name !== "remove_queued_prompt"),
    show({ dock: np.dock.textContent, box: box9.value }),
  );
  gone(np);

  // A browser writes an empty slot handed to replaceChildren as the text "null"; the stand-in does the same.
  check(
    "no drawn view shows the word null",
    drawn.every((v) => !/null/.test(v.textContent)),
  );

  // ---- the look: the live part's styles use tokens only, nothing under 12 px; no sizes in its page files
  const css = fs.readFileSync(path.join(PAGE, "page.css"), "utf8");
  const from = css.indexOf("/* ---- Session view, live part");
  const to = css.indexOf("/* ---- Checks screen");
  const noComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "");
  const newCss = noComments(css.slice(from, to));
  const RAW =
    /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklch|color)\(|(?<![-\w])(?:white|black|red|green|blue|gr[ae]y|orange|yellow)(?![-\w])/;
  const js = ["screens/session-live.js", "screens/session-form.js"].map((x) =>
    fs.readFileSync(path.join(PAGE, x), "utf8"),
  );
  const sizes = [
    ...newCss.matchAll(/(?:font-size:\s*|\b\d{3}\s+)(\d+(?:\.\d+)?)px/g),
  ].map((m) => Number(m[1]));
  check(
    "page.css has a live part section for the form sheet, work rows, helpers, context bar and queued row",
    from >= 0 &&
      to > from &&
      [".fsheet", ".wstep", ".helpers", ".ctxbar", ".queued"].every((c) =>
        newCss.includes(c),
      ),
  );
  check(
    "the live part's styles hold no raw colour and no text under 12 px; its page files set no sizes",
    !RAW.test(newCss) &&
      sizes.every((x) => x >= 12) &&
      js.every((s) => !/\d+px|style:/.test(s)),
    show({ raw: newCss.match(RAW)?.[0], sizes }),
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
