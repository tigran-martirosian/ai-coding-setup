// Tests for the PC program's sessions part (skills/phone-bot/pc: core/door.mjs, core/db.mjs,
// core/transcripts.mjs and the projects, sessions, session, questions and queue actions).
// A fake door (a local MCP server answering from fixtures and recording every call) and a fixture
// nimbalyst.sqlite in a temp home stand in for Nimbalyst. The actions run through the real registry.
// Run: node tests/test-phone-pc-sessions.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 400);

// A temp home for this whole run; the files library reads it through os.homedir() and APPDATA.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-pc-sessions-"));
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

// The project folders exist (projects.list leaves out one whose folder is gone); GONE is one that does not.
const inTmp = (name) => path.join(tmp, "projects", name);
const P = {
  alpha: inTmp("alpha"),
  beta: inTmp("beta"),
  empty1: inTmp("empty-one"),
  empty2: inTmp("empty-two"),
  empty3: inTmp("empty-three"),
  old: inTmp("old"),
};
for (const p of Object.values(P)) fs.mkdirSync(p, { recursive: true });
const GONE = inTmp("moved-away");

// ---- the fixture database: the columns the reads use
const DB_FILE = path.join(NIM, "sqlite-db", "nimbalyst.sqlite");
const fx = new DatabaseSync(DB_FILE);
fx.exec(`
  CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
    provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
    is_archived INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL);
  CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'claude-code', direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
  CREATE TABLE queued_prompts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL,
    status TEXT NOT NULL, created_at TEXT NOT NULL);
  CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
`);
let idn = 0;
const newId = () => {
  idn++;
  const h = idn.toString(16).padStart(12, "0");
  return `00000000-0000-4000-8000-${h}`;
};
const addSession = (o) => {
  const now = new Date().toISOString();
  const s = {
    id: newId(),
    status: "idle",
    provider_session_id: null,
    worktree_id: null,
    model: "claude-code:opus",
    metadata: "{}",
    created_at: now,
    updated_at: now,
    ...o,
  };
  fx.prepare(
    `INSERT INTO ai_sessions (id, workspace_id, title, status, provider_session_id, worktree_id, model, metadata,
       created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    s.id,
    s.workspace_id,
    s.title,
    s.status,
    s.provider_session_id,
    s.worktree_id,
    s.model,
    s.metadata,
    s.created_at,
    s.updated_at,
  );
  return s.id;
};
const addMessage = (sessionId, kind, content) =>
  fx
    .prepare(
      "INSERT INTO ai_agent_messages (session_id, created_at, direction, content, message_kind) VALUES (?, ?, 'output', ?, ?)",
    )
    .run(sessionId, new Date().toISOString(), JSON.stringify(content), kind);

// 45 sessions in alpha, an hour apart, the newest "Alpha 45".
const t0 = Date.now() - 50 * 3600 * 1000;
const alphaIds = [];
for (let i = 1; i <= 45; i++) {
  const at = new Date(t0 + i * 3600 * 1000).toISOString();
  alphaIds.push(
    addSession({
      workspace_id: P.alpha,
      title: `Alpha ${i}`,
      created_at: at,
      updated_at: at,
    }),
  );
}
const S = {
  question: addSession({
    workspace_id: P.beta,
    title: "Asks a question",
    status: "waiting_for_input",
  }),
  form: addSession({
    workspace_id: P.beta,
    title: "Waits on a form",
    status: "waiting_for_input",
  }),
  nothing: addSession({
    workspace_id: P.beta,
    title: "Waits on something else",
    status: "waiting_for_input",
  }),
  mcpQuestion: addSession({
    workspace_id: P.beta,
    title: "Asks with Nimbalyst's own question tool",
    status: "waiting_for_input",
  }),
  running: addSession({
    workspace_id: P.beta,
    title: "Works",
    status: "running",
  }),
  busyQueue: addSession({
    workspace_id: P.beta,
    title: "Works with a queue",
    status: "running",
  }),
  talk: addSession({
    workspace_id: P.beta,
    title: "Has a transcript",
    provider_session_id: "11111111-2222-4333-8444-555555555555",
  }),
  gone: addSession({
    workspace_id: P.beta,
    title: "Transcript gone",
    provider_session_id: "66666666-2222-4333-8444-555555555555",
  }),
  stranger: addSession({
    workspace_id: "C:\\Projects\\not-listed",
    title: "Other",
  }),
  // Waits for the user since 3 days ago: past 48 hours, so only Projects counts it, Home leaves it off.
  old: addSession({
    workspace_id: P.old,
    title: "Waits since 3 days",
    status: "waiting_for_input",
    created_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 72 * 3600 * 1000).toISOString(),
  }),
  // Waits since 30 hours ago: inside 48 hours, so Home and Projects both count it.
  dayOld: addSession({
    workspace_id: P.old,
    title: "Waits since 30 hours",
    status: "waiting_for_input",
    created_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
    updated_at: new Date(Date.now() - 30 * 3600 * 1000).toISOString(),
  }),
};
// The form: the newest PromptForUserInput tool call of the session, with no result yet.
addMessage(S.form, "tool", {
  type: "assistant",
  message: {
    content: [
      {
        type: "tool_use",
        id: "toolu_form_1",
        name: "mcp__nimbalyst__PromptForUserInput",
        input: {
          title: "Pick",
          intro: "Fill in",
          fields: [{ id: "name", type: "text" }],
          submitLabel: "Go",
        },
      },
    ],
  },
});

// Nimbalyst's own question tool (mcp__nimbalyst__AskUserQuestion) leaves only the raw tool call in the database,
// no nimbalyst_tool_use row, so the door's pendingPrompt stays empty. The shape of a real card: three single-pick
// questions with descriptions. An older card of the same session was answered (response row, then tool result).
const mcpCard = (id, questions) =>
  addMessage(S.mcpQuestion, "tool", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id,
          name: "mcp__nimbalyst__AskUserQuestion",
          input: { questions },
        },
      ],
    },
  });
const pick2 = (header, question, a, b) => ({
  header,
  question,
  options: [
    { label: a, description: `${a}, said longer.` },
    { label: b, description: `${b}, said longer.` },
  ],
  multiSelect: false,
});
mcpCard("toolu_mcp_old", [pick2("Old", "An old question?", "Yes", "No")]);
addMessage(S.mcpQuestion, null, {
  type: "ask_user_question_response",
  questionId: "toolu_mcp_old",
  answers: { "An old question?": "Yes" },
  cancelled: false,
});
addMessage(S.mcpQuestion, "tool", {
  type: "user",
  message: {
    content: [{ type: "tool_result", tool_use_id: "toolu_mcp_old" }],
  },
});
const MCP_QS = [
  pick2(
    "New steps",
    "Can the new steps start?",
    "Yes, start",
    "Change something",
  ),
  pick2(
    "File preview",
    "Which files may the phone open?",
    "Any file",
    "Project folder only",
  ),
  pick2("Alerts", "Is this the right way to tidy alerts?", "Yes", "Change it"),
];
mcpCard("toolu_mcp_new", MCP_QS);

// A transcript for S.talk: five turns, plus lines that are not turns. Questions 2 and 3 were sent from the phone,
// so they end with the door's note (the long one as a string, the short one in a text part).
const talkDir = path.join(
  home,
  ".claude",
  "projects",
  P.beta.replace(/[^A-Za-z0-9]/g, "-"),
);
fs.mkdirSync(talkDir, { recursive: true });
const tLines = [{ type: "system", subtype: "init" }];
const LONG_NOTE =
  "(Sent from the phone. If you need to ask something, use AskUserQuestion with plain options rather than a form: only that can be answered from the phone.)";
for (let i = 1; i <= 5; i++) {
  const q = `question ${i}`;
  tLines.push({
    type: "user",
    message: {
      content:
        i === 2
          ? `${q}\n\n${LONG_NOTE}`
          : i === 3
            ? [{ type: "text", text: `${q}\n\n(Sent from the phone.)` }]
            : q,
    },
    timestamp: `t${i}`,
  });
  tLines.push({
    type: "assistant",
    message: {
      content: [
        { type: "text", text: `answer ${i}` },
        { type: "tool_use", name: "Read" },
      ],
    },
  });
  tLines.push({
    type: "user",
    message: { content: [{ type: "tool_result", tool_use_id: "x" }] },
  });
}
// Then user lines the system wrote, as Claude Code writes them: a helper's notice (one short row), a system reminder
// alone, a Stop hook's note and a command's wrapper (none shown), a message that quotes a tag (shown whole) and a
// message with a reminder in its own text part (shown without it).
const NOTICE =
  '<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>toolu_x</tool-use-id>\n<status>completed</status>\n<summary>Agent "build" completed</summary>\n<result>long report <usage>tokens</usage></result>\n</task-notification>';
const QUOTE = "why does the report end with <usage>total_tokens: 5</usage>?";
tLines.push(
  { type: "user", message: { content: NOTICE }, timestamp: "t6" },
  {
    type: "user",
    message: {
      content: [
        {
          type: "text",
          text: "<system-reminder>\nfiles changed\n</system-reminder>",
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: "Stop hook feedback:\n[node gate.mjs]: finish the step",
    },
  },
  {
    type: "user",
    message: {
      content:
        "<command-name>/clear</command-name>\n<command-message>clear</command-message>",
    },
  },
  { type: "user", message: { content: QUOTE } },
  {
    type: "user",
    message: {
      content: [
        { type: "text", text: "question 6" },
        { type: "text", text: "<system-reminder>todo list</system-reminder>" },
      ],
    },
  },
);
fs.writeFileSync(
  path.join(talkDir, "11111111-2222-4333-8444-555555555555.jsonl"),
  `${tLines.map((l) => JSON.stringify(l)).join("\n")}\n`,
);

// ---- the fake door's state: what each session reports, its queue, and what create_session leaves behind
const ENDPOINT = path.join(NIM, "mcp-endpoint.json");
const WORKSPACES = Object.entries(P).map(([name, p]) => ({ name, path: p }));
const doorState = new Map(); // session -> { status, pendingPrompt, clearOnAnswer }
const queues = new Map(); // session -> [{ id, prompt, createdAt, status? }] (status "pending" when not set)
const madeOnCreate = new Map(); // project path -> how many sessions create_session leaves
let qn = 0;
const st = (id) => {
  if (!doorState.has(id)) {
    const row = fx
      .prepare("SELECT status FROM ai_sessions WHERE id = ?")
      .get(id);
    doorState.set(id, {
      status: row.status,
      pendingPrompt: null,
      clearOnAnswer: true,
    });
  }
  return doorState.get(id);
};
const queueOf = (id) => {
  if (!queues.has(id)) queues.set(id, []);
  return queues.get(id);
};
st(S.question).pendingPrompt = {
  promptId: "prompt-q-1",
  promptType: "ask_user_question_request",
  content: {
    questions: [
      {
        question: "Which colour?",
        header: "Colour",
        options: [{ label: "Red" }, { label: "Blue" }],
      },
    ],
  },
};

function handle(name, a, call) {
  switch (name) {
    case "workspace_open":
      return "opened";
    case "get_session_status": {
      const s = st(a.sessionId);
      return {
        status: s.status,
        waitingForInput: s.status === "waiting_for_input",
      };
    }
    case "get_session_result": {
      const s = st(a.sessionId);
      return {
        status: s.status,
        pendingPrompt: s.pendingPrompt,
        originalPrompt: "x",
      };
    }
    case "list_queued_prompts": {
      // As Nimbalyst answers: a 300-character preview, the whole text only on includePromptText.
      const prompts = queueOf(a.sessionId).map((q) => ({
        id: q.id,
        status: q.status ?? "pending",
        createdAt: q.createdAt,
        promptPreview:
          q.prompt.length > 300 ? `${q.prompt.slice(0, 300)}...` : q.prompt,
        ...(a.includePromptText === true ? { prompt: q.prompt } : {}),
      }));
      return { sessionId: a.sessionId, count: prompts.length, prompts };
    }
    case "send_prompt": {
      const s = st(a.sessionId);
      const before = s.status;
      if (a.interrupt)
        return {
          statusBeforeQueue: before,
          processingTriggered: false,
          interrupted: true,
        };
      if (a.messageKind === "status" || before !== "idle") {
        queueOf(a.sessionId).push({
          id: `queued-${++qn}`,
          prompt: a.prompt,
          createdAt: Date.now(),
        });
        return a.messageKind === "status"
          ? {
              statusBeforeQueue: before,
              processingTriggered: false,
              heldForNextTurn: true,
            }
          : { statusBeforeQueue: before, processingTriggered: false };
      }
      s.status = "running";
      return {
        statusBeforeQueue: before,
        processingTriggered: true,
        interrupted: false,
      };
    }
    case "respond_to_prompt": {
      const s = st(a.sessionId);
      // Nimbalyst stores every question answer as this row, whichever tool asked.
      if (a.promptType === "ask_user_question_request")
        addMessage(a.sessionId, null, {
          type: "ask_user_question_response",
          questionId: a.promptId,
          answers: a.response.answers,
          cancelled: false,
        });
      if (s.clearOnAnswer) {
        s.status = "running";
        s.pendingPrompt = null;
      }
      return { promptId: a.promptId, promptType: a.promptType, success: true };
    }
    case "answer_form":
      addMessage(a.sessionId, "tool", {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: a.promptId }],
        },
      });
      st(a.sessionId).status = "running";
      return { sessionId: a.sessionId, promptId: a.promptId, closed: true };
    case "stop_session":
      st(a.sessionId).status = "idle";
      return { stopped: true };
    case "remove_queued_prompt": {
      const q = queueOf(a.sessionId);
      q.splice(
        q.findIndex((x) => x.id === a.promptId),
        1,
      );
      return { removed: true };
    }
    case "list_recent_sessions": {
      const rows = fx
        .prepare(
          "SELECT id, title FROM ai_sessions WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?",
        )
        .all(call.workspacePath, a.limit);
      return rows
        .map((r, i) => `${i + 1}. "${r.title}" (${r.id}) - now`)
        .join("\n");
    }
    case "spawn_session":
      return {
        sessionId: addSession({
          workspace_id: call.workspacePath,
          title: "Spawned",
        }),
      };
    case "create_session": {
      const n = madeOnCreate.get(call.workspacePath) ?? 0;
      for (let i = 0; i < n; i++)
        addSession({ workspace_id: call.workspacePath, title: "New Session" });
      throw { rpc: "FOREIGN KEY constraint failed" };
    }
    case "set_session_pinned":
      if (a.sessionId === alphaIds[5])
        throw { rpc: "no such session in this window" };
      return { success: true, pinned: a.pinned };
    default:
      throw new Error(`the fake door has no ${name}`);
  }
}

const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const BASE_TOOLS = [
  "workspace_open",
  "get_session_status",
  "get_session_result",
  "list_queued_prompts",
  "send_prompt",
  "respond_to_prompt",
  "list_recent_sessions",
  "spawn_session",
  "create_session",
];
let door = await startFakeDoor({
  endpointFile: ENDPOINT,
  workspaces: [...WORKSPACES, { name: "moved", path: GONE }],
  tools: BASE_TOOLS,
  handle,
});

// ---- the real registry with every action module
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const ctx = {
  page: "ok",
  device: "dev-test",
  setupVersion: "0.0.0",
  push: () => {},
};
let rn = 0;
const ask = (a, d) => registry.handle({ k: "req", id: `r-${++rn}`, a, d }, ctx);
const callsOf = (name, from = 0) =>
  door.calls.slice(from).filter((c) => c.name === name);

let failure = null;
try {
  // ---- projects and paging
  const projects = await ask("projects.list");
  const handleOf = Object.fromEntries(
    (projects.d || []).map((p) => [p.name, p.project]),
  );
  check(
    "projects.list gives a 12-character handle per project and no path",
    projects.ok &&
      projects.d.length === WORKSPACES.length &&
      projects.d.every((p) => /^[A-Z2-7]{12}$/.test(p.project)) &&
      !JSON.stringify(projects.d).includes("Projects"),
    show(projects),
  );
  const beta = projects.d.find((p) => p.name === "beta");
  check(
    "projects.list counts the sessions that need you and that work",
    beta.needsYou === 4 && beta.working === 2,
    show(beta),
  );
  check(
    "projects.list leaves out a project whose folder is gone",
    !projects.d.some((p) => p.name === "moved"),
    show(projects.d.map((p) => p.name)),
  );
  const oldHome = await ask("home.sessions");
  check(
    "a session waiting 3 days is left off Home but counts in Projects; one waiting 30 hours shows on both",
    oldHome.ok &&
      !oldHome.d.needsYou.some((s) => s.session === S.old) &&
      oldHome.d.needsYou.some((s) => s.session === S.dayOld) &&
      projects.d.find((p) => p.name === "old")?.needsYou === 2,
    show({ home: oldHome.d?.needsYou, projects: projects.d }),
  );

  const p1 = await ask("sessions.list", { project: handleOf.alpha, page: 1 });
  const p3 = await ask("sessions.list", { project: handleOf.alpha, page: 3 });
  check(
    "45 sessions come in pages of 20: page 1 has 20, newest first, total 45",
    p1.ok &&
      p1.d.items.length === 20 &&
      p1.d.total === 45 &&
      p1.d.items[0].title === "Alpha 45",
    show(p1),
  );
  check(
    "page 3 has the last 5, oldest last",
    p3.ok &&
      p3.d.items.length === 5 &&
      p3.d.items[4].title === "Alpha 1" &&
      p3.d.page === 3,
    show(p3),
  );
  const unknown = await ask("sessions.list", {
    project: "AAAAAAAAAAAA",
    page: 1,
  });
  check(
    "an unknown project handle answers no-project",
    unknown.err === "no-project",
    show(unknown),
  );
  const badHandle = await ask("sessions.list", {
    project: "C:/Projects/x",
    page: 1,
  });
  check(
    "a path in place of a handle answers bad-input",
    badHandle.err === "bad-input" && badHandle.field === "project",
  );

  // ---- session pins: Nimbalyst's is_pinned, read on every list
  const PINNED = [3, 10, 22, 30].map((n) => alphaIds[n - 1]);
  const setPins = (ids, on) => {
    for (const id of ids)
      fx.prepare("UPDATE ai_sessions SET is_pinned = ? WHERE id = ?").run(
        on ? 1 : 0,
        id,
      );
  };
  check(
    "no pin in the database: every row says pinned false",
    p1.d.items.every((s) => s.pinned === false),
    show(p1.d.items.map((s) => s.pinned)),
  );
  setPins(PINNED, true);
  const pinP1 = await ask("sessions.list", {
    project: handleOf.alpha,
    page: 1,
  });
  const pinP3 = await ask("sessions.list", {
    project: handleOf.alpha,
    page: 3,
  });
  check(
    "a pin set on the PC shows on the next read: the 4 pinned come first, newest first, then the rest",
    pinP1.ok &&
      show(pinP1.d.items.slice(0, 4).map((s) => [s.title, s.pinned])) ===
        show([
          ["Alpha 30", true],
          ["Alpha 22", true],
          ["Alpha 10", true],
          ["Alpha 3", true],
        ]) &&
      pinP1.d.items[4].title === "Alpha 45" &&
      pinP1.d.items.slice(4).every((s) => s.pinned === false) &&
      pinP1.d.total === 45,
    show(pinP1.d?.items.map((s) => s.title)),
  );
  check(
    "the 20-a-page count runs over the pinned-first order: page 3 holds the last 5 unpinned, oldest last",
    pinP3.ok &&
      pinP3.d.items.length === 5 &&
      pinP3.d.items[4].title === "Alpha 1" &&
      !pinP3.d.items.some((s) => s.pinned),
    show(pinP3.d?.items.map((s) => s.title)),
  );
  setPins(PINNED, false);
  const unpinned = await ask("sessions.list", {
    project: handleOf.alpha,
    page: 1,
  });
  check(
    "a pin taken off on the PC is gone on the next read",
    unpinned.ok &&
      unpinned.d.items[0].title === "Alpha 45" &&
      !unpinned.d.items.some((s) => s.pinned),
    show(unpinned.d?.items.slice(0, 3)),
  );
  const pinNoPatch = await ask("sessions.pin", {
    session: alphaIds[0],
    pinned: true,
  });
  check(
    "without set_session_pinned sessions.pin answers needs-door-patch with the tool's name and calls nothing",
    pinNoPatch.err === "needs-door-patch" &&
      show(pinNoPatch).includes("set_session_pinned") &&
      callsOf("set_session_pinned").length === 0,
    show(pinNoPatch),
  );
  const badPins = await Promise.all(
    ["yes", 1, null, undefined].map((pinned) =>
      ask("sessions.pin", { session: alphaIds[0], pinned }),
    ),
  );
  const badPinSession = await ask("sessions.pin", {
    session: "not-a-session",
    pinned: true,
  });
  check(
    "sessions.pin refuses a pinned that is not true or false, and a bad session id, as bad-input",
    badPins.every((r) => r.err === "bad-input" && r.field === "pinned") &&
      badPinSession.err === "bad-input" &&
      badPinSession.field === "session",
    show({ badPins, badPinSession }),
  );
  const other = await ask("session.open", { session: S.stranger });
  check(
    "a session of a project the door does not list answers no-session",
    other.err === "no-session",
    show(other),
  );

  // ---- what a session waits on
  const q = await ask("session.pending", { session: S.question });
  check(
    "a waiting session shows its question",
    q.ok &&
      q.d.kind === "question" &&
      q.d.promptId === "prompt-q-1" &&
      q.d.body.questions[0].question === "Which colour?" &&
      q.d.body.questions[0].options.map((o) => o.label).join() === "Red,Blue",
    show(q),
  );
  const f = await ask("session.pending", { session: S.form });
  check(
    'a session waiting on a form the door does not report shows kind "form" with the tool call id (design row 11)',
    f.ok &&
      f.d.kind === "form" &&
      f.d.promptId === "toolu_form_1" &&
      f.d.body.fields[0].id === "name",
    show(f),
  );
  const none = await ask("session.pending", { session: S.nothing });
  check(
    'a waiting session with nothing the phone can read shows kind "on-pc"',
    none.ok && none.d.kind === "on-pc" && none.d.promptId === null,
    show(none),
  );
  const mq = await ask("session.pending", { session: S.mcpQuestion });
  check(
    "a three-question card of Nimbalyst's own question tool, which the door does not report, shows as a question with the newest open call's id",
    mq.ok &&
      mq.d.kind === "question" &&
      mq.d.promptId === "toolu_mcp_new" &&
      mq.d.body.questions.length === 3 &&
      mq.d.body.questions[2].header === "Alerts" &&
      mq.d.body.questions[1].options[1].description ===
        "Project folder only, said longer." &&
      mq.d.body.questions.every((q) => q.multiSelect === false),
    show(mq),
  );
  const mqMark = door.calls.length;
  const mqAns = await ask("session.answer", {
    session: S.mcpQuestion,
    promptId: "toolu_mcp_new",
    kind: "question",
    answer: JSON.stringify({
      [MCP_QS[0].question]: "Yes, start",
      [MCP_QS[1].question]: "Project folder only",
      [MCP_QS[2].question]: "Yes",
    }),
  });
  const mqSent = callsOf("respond_to_prompt", mqMark)[0];
  check(
    "its answer goes to the door as a question answer on the tool call id, with all three answers, and is re-read as cleared",
    mqAns.ok &&
      mqAns.d.cleared === true &&
      mqSent?.args.promptType === "ask_user_question_request" &&
      mqSent.args.promptId === "toolu_mcp_new" &&
      Object.keys(mqSent.args.response.answers).length === 3 &&
      mqSent.args.response.answers[MCP_QS[1].question] ===
        "Project folder only",
    show({ mqAns, mqSent }),
  );
  // A multi-pick card of the same tool: two labels picked, sent as a list.
  const multiQ = {
    header: "Parts",
    question: "Which parts?",
    options: [{ label: "A" }, { label: "B" }, { label: "C" }],
    multiSelect: true,
  };
  mcpCard("toolu_mcp_multi", [multiQ]);
  const mm = await ask("session.pending", { session: S.mcpQuestion });
  const mmMark = door.calls.length;
  const mmAns = await ask("session.answer", {
    session: S.mcpQuestion,
    promptId: "toolu_mcp_multi",
    kind: "question",
    answer: JSON.stringify({ "Which parts?": ["A", "C"] }),
  });
  const mmSent = callsOf("respond_to_prompt", mmMark)[0];
  check(
    "a multi-pick card of that tool shows as multi-pick, and two picked labels reach the door",
    mm.ok &&
      mm.d.promptId === "toolu_mcp_multi" &&
      mm.d.body.questions[0].multiSelect === true &&
      mmAns.ok &&
      mmAns.d.cleared === true &&
      mmSent?.args.response.answers["Which parts?"] === "A, C",
    show({ mm, mmAns, mmSent }),
  );
  // Answers from Nimbalyst's own mobile path may name the call in rawQuestionId or waiterIds only.
  for (const [id, ids] of [
    [
      "toolu_mcp_raw",
      { questionId: "q-other-1", rawQuestionId: "toolu_mcp_raw" },
    ],
    [
      "toolu_mcp_waiter",
      { questionId: "q-other-2", waiterIds: ["x", "toolu_mcp_waiter"] },
    ],
  ]) {
    mcpCard(id, [pick2("Again", "Again?", "Yes", "No")]);
    addMessage(S.mcpQuestion, null, {
      type: "ask_user_question_response",
      ...ids,
      answers: { "Again?": "Yes" },
      cancelled: false,
    });
    const r = await ask("session.pending", { session: S.mcpQuestion });
    check(
      `a card answered with its id in ${Object.keys(ids)[1]} is not shown again`,
      r.ok && r.d === null,
      show(r),
    );
  }
  // A card left open when the user sent a new message instead: Nimbalyst writes no answer and no tool result.
  st(S.mcpQuestion).status = "waiting_for_input";
  mcpCard("toolu_mcp_gone", [pick2("Gone", "Still there?", "Yes", "No")]);
  fx.prepare(
    "INSERT INTO ai_agent_messages (session_id, created_at, direction, content, message_kind) VALUES (?, ?, 'input', ?, 'user')",
  ).run(
    S.mcpQuestion,
    new Date().toISOString(),
    JSON.stringify({ prompt: "Never mind, do this instead." }),
  );
  const left = await ask("session.pending", { session: S.mcpQuestion });
  check(
    "a card followed by a new user message is not shown as a question",
    left.ok && left.d.kind === "on-pc",
    show(left),
  );
  addMessage(S.mcpQuestion, "tool", {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_form_after",
          name: "mcp__nimbalyst__PromptForUserInput",
          input: { title: "Then", fields: [{ id: "n", type: "text" }] },
        },
      ],
    },
  });
  const after = await ask("session.pending", { session: S.mcpQuestion });
  check(
    "a form opened after that abandoned card still shows",
    after.ok &&
      after.d.kind === "form" &&
      after.d.promptId === "toolu_form_after",
    show(after),
  );
  st(S.mcpQuestion).status = "running";
  const listed = await ask("sessions.list", {
    project: handleOf.beta,
    page: 1,
  });
  const kindOf = (id) => listed.d.items.find((i) => i.session === id);
  check(
    "sessions.list gives the waiting ones their kind and the others none",
    kindOf(S.question).kind === "question" &&
      kindOf(S.form).kind === "form" &&
      kindOf(S.nothing).kind === "on-pc" &&
      kindOf(S.running).state === "running" &&
      kindOf(S.running).kind === null,
    show(listed),
  );
  const homeList = await ask("home.sessions");
  check(
    "home.sessions lists the waiting ones under needsYou and the running ones under working",
    homeList.ok &&
      homeList.d.needsYou.some(
        (s) => s.session === S.question && s.kind === "question",
      ) &&
      homeList.d.working.some((s) => s.session === S.running),
    show(homeList),
  );

  // ---- answers
  const formNoPatch = await ask("session.answer", {
    session: S.form,
    promptId: "toolu_form_1",
    kind: "form",
    answer: JSON.stringify({ name: "x" }),
  });
  check(
    "answering a form without answer_form gives needs-door-patch (the page shows answer on the PC)",
    formNoPatch.err === "needs-door-patch" &&
      formNoPatch.tool === "answer_form",
    show(formNoPatch),
  );
  const mark = door.calls.length;
  const ans = await ask("session.answer", {
    session: S.question,
    promptId: "prompt-q-1",
    kind: "question",
    answer: JSON.stringify({ "Which colour?": "Blue" }),
  });
  const sent = callsOf("respond_to_prompt", mark)[0];
  check(
    "an answer reaches the door with the right prompt type and is re-read as cleared",
    ans.ok &&
      ans.d.cleared === true &&
      sent?.args.promptType === "ask_user_question_request" &&
      sent.args.promptId === "prompt-q-1" &&
      sent.args.response.answers["Which colour?"] === "Blue",
    show({ ans, sent }),
  );
  const stale = await ask("session.answer", {
    session: S.question,
    promptId: "prompt-q-1",
    kind: "question",
    answer: JSON.stringify({ "Which colour?": "Red" }),
  });
  check(
    "an answer to a prompt that is gone answers no-prompt",
    stale.err === "no-prompt",
    show(stale),
  );

  const perm = addSession({
    workspace_id: P.beta,
    title: "Asks to run",
    status: "waiting_for_input",
  });
  Object.assign(st(perm), {
    clearOnAnswer: false,
    pendingPrompt: {
      promptId: "prompt-p-1",
      promptType: "permission_request",
      content: { toolName: "Bash", rawCommand: "ls" },
    },
  });
  const m2 = door.calls.length;
  const permAns = await ask("session.answer", {
    session: perm,
    promptId: "prompt-p-1",
    kind: "permission",
    answer: '"allow"',
  });
  const permSent = callsOf("respond_to_prompt", m2)[0];
  check(
    "a permission answer uses the door's type; still waiting after 3 s answers cleared: false",
    permAns.ok &&
      permAns.d.cleared === false &&
      permSent?.args.promptType === "permission_request" &&
      permSent.args.response.decision === "allow",
    show({ permAns, permSent }),
  );

  // ---- sending
  const m3 = door.calls.length;
  const queued = await ask("session.queue", {
    session: S.running,
    text: "after this, run the tests",
  });
  const qSend = callsOf("send_prompt", m3);
  check(
    "a message to a running session is queued and gets its queue id",
    queued.ok &&
      queued.d.queued === true &&
      /^queued-\d+$/.test(queued.d.queueId) &&
      qSend.length === 1 &&
      qSend[0].args.messageKind === undefined &&
      !qSend[0].args.interrupt &&
      qSend[0].args.prompt.startsWith("after this, run the tests"),
    show({ queued, qSend }),
  );
  const qList = await ask("queue.list", { session: S.running });
  check(
    "queue.list shows it",
    qList.ok && qList.d.some((x) => x.queueId === queued.d.queueId),
    show(qList),
  );
  const rm = await ask("queue.remove", {
    session: S.running,
    queueId: queued.d.queueId,
  });
  check(
    "queue.remove without remove_queued_prompt answers needs-door-patch",
    rm.err === "needs-door-patch" && rm.tool === "remove_queued_prompt",
    show(rm),
  );

  const idle = addSession({
    workspace_id: P.beta,
    title: "Idle",
    status: "idle",
  });
  const m4 = door.calls.length;
  const note = await ask("session.note", { session: idle, text: "for later" });
  const nSend = callsOf("send_prompt", m4);
  check(
    'a Note uses messageKind "status" and starts no turn',
    note.ok &&
      note.d.held === true &&
      nSend.length === 1 &&
      nSend[0].args.messageKind === "status" &&
      st(idle).status === "idle",
    show({ note, nSend }),
  );
  const m5 = door.calls.length;
  const send = await ask("session.send", { session: idle, text: "go on" });
  check(
    "session.send to an idle session opens the project window, then starts it",
    send.ok &&
      send.d.started === true &&
      door.calls
        .slice(m5)
        .map((c) => c.name)
        .join() === "workspace_open,send_prompt",
    show({ send, calls: door.calls.slice(m5) }),
  );
  const empty = await ask("session.send", { session: idle, text: "" });
  check(
    "an empty text answers bad-input",
    empty.err === "bad-input" && empty.field === "text",
  );

  // ---- Stop without the patch
  const busy = addSession({
    workspace_id: P.beta,
    title: "Works, no queue",
    status: "running",
  });
  const m6 = door.calls.length;
  const stop = await ask("session.stop", { session: busy });
  const stopSend = callsOf("send_prompt", m6);
  check(
    "session.stop without stop_session sends an interrupting prompt",
    stop.ok &&
      stop.d.method === "interrupt-turn" &&
      stopSend.length === 1 &&
      stopSend[0].args.interrupt === true,
    show({ stop, stopSend }),
  );
  queueOf(S.busyQueue).push({
    id: "queued-held",
    prompt: "x",
    createdAt: Date.now(),
  });
  const stopQ = await ask("session.stop", { session: S.busyQueue });
  check(
    "session.stop without stop_session and with a queued message answers needs-door-patch",
    stopQ.err === "needs-door-patch" && stopQ.tool === "stop_session",
    show(stopQ),
  );

  // ---- a new session
  const m7 = door.calls.length;
  const spawned = await ask("session.new", {
    project: handleOf.alpha,
    text: "start something",
  });
  const spawn = callsOf("spawn_session", m7)[0];
  check(
    "session.new in a project with sessions spawns from its newest one",
    spawned.ok &&
      /^[0-9a-f-]{36}$/.test(spawned.d.session) &&
      spawn?.caller === alphaIds[44] &&
      spawn.args.prompt.startsWith("start something"),
    show({ spawned, spawn }),
  );
  madeOnCreate.set(P.empty1, 1);
  const m8 = door.calls.length;
  const first = await ask("session.new", {
    project: handleOf.empty1,
    text: "first one",
  });
  const madeId = fx
    .prepare("SELECT id FROM ai_sessions WHERE workspace_id = ?")
    .get(P.empty1)?.id;
  const firstSend = callsOf("send_prompt", m8);
  check(
    "a new session in an empty project: create_session fails with the foreign key error, the one new session is found and sent the text",
    first.ok &&
      first.d.session === madeId &&
      callsOf("create_session", m8).length === 1 &&
      firstSend.length === 1 &&
      firstSend[0].args.sessionId === madeId &&
      firstSend[0].args.prompt.startsWith("first one"),
    show({ first, firstSend }),
  );
  madeOnCreate.set(P.empty2, 0);
  const noneMade = await ask("session.new", {
    project: handleOf.empty2,
    text: "x",
  });
  check(
    "no new session found answers new-session-unclear with the door's message",
    noneMade.err === "new-session-unclear" &&
      /FOREIGN KEY/.test(noneMade.message) &&
      noneMade.found === 0,
    show(noneMade),
  );
  madeOnCreate.set(P.empty3, 2);
  const m9 = door.calls.length;
  const twoMade = await ask("session.new", {
    project: handleOf.empty3,
    text: "x",
  });
  check(
    "two new sessions found answers new-session-unclear and sends nothing",
    twoMade.err === "new-session-unclear" &&
      twoMade.found === 2 &&
      callsOf("send_prompt", m9).length === 0,
    show(twoMade),
  );
  const newUnknown = await ask("session.new", {
    project: "BBBBBBBBBBBB",
    text: "x",
  });
  check(
    "session.new with an unknown project handle answers no-project",
    newUnknown.err === "no-project",
  );

  // ---- the conversation
  const open = await ask("session.open", { session: S.talk });
  check(
    "session.open reads the transcript of provider_session_id: turns in order, tool results left out",
    open.ok &&
      open.d.items.length === 13 &&
      open.d.items[0].text === "question 1" &&
      open.d.items[9].text === "answer 5" &&
      open.d.items[9].tools[0] === "Read" &&
      open.d.before === null &&
      open.d.state === "idle" &&
      open.d.project === handleOf.beta,
    show(open),
  );
  check(
    "session.open shows a prompt sent from the phone without the door's note",
    open.ok &&
      open.d.items[2].text === "question 2" &&
      open.d.items[4].text === "question 3",
    show(open),
  );
  const sys = open.ok ? open.d.items.slice(10) : [];
  check(
    "a helper's notice is one row marked helper, with its summary and status and none of its tags",
    sys[0]?.system === "helper" &&
      sys[0].text === 'Agent "build" completed' &&
      sys[0].status === "completed" &&
      !JSON.stringify(sys[0]).includes("<"),
    show(sys[0]),
  );
  check(
    "a system reminder alone, a hook's note and a command's wrapper are not shown; a quoted tag shows whole",
    sys.length === 3 &&
      sys[1].text === QUOTE &&
      !sys[1].system &&
      sys[2].text === "question 6",
    show(sys),
  );
  const gone = await ask("session.open", { session: S.gone });
  check(
    "a missing transcript answers transcript-gone",
    gone.err === "transcript-gone",
    show(gone),
  );

  // ---- the database is opened read only
  const { openDb } = await import("../skills/phone-bot/pc/core/db.mjs");
  let writeErr = null;
  try {
    openDb().exec(
      "INSERT INTO worktrees (id, workspace_id, path) VALUES ('w', 'x', 'y')",
    );
  } catch (e) {
    writeErr = e;
  }
  check(
    "the database is opened read only: a write fails",
    writeErr !== null && /readonly|read-only|read only/i.test(writeErr.message),
    writeErr?.message,
  );

  // ---- with the door patch's tools
  await door.close();
  door = await startFakeDoor({
    endpointFile: ENDPOINT,
    workspaces: WORKSPACES,
    tools: [
      ...BASE_TOOLS,
      "answer_form",
      "stop_session",
      "remove_queued_prompt",
      "set_session_pinned",
    ],
    handle,
  });
  const pinOn = await ask("sessions.pin", {
    session: alphaIds[4],
    pinned: true,
  });
  const pinOff = await ask("sessions.pin", {
    session: alphaIds[4],
    pinned: false,
  });
  const pinCalls = callsOf("set_session_pinned");
  check(
    "with set_session_pinned sessions.pin sends sessionId and pinned to the door and answers { pinned } after it",
    pinOn.ok &&
      pinOn.d.pinned === true &&
      pinOff.ok &&
      pinOff.d.pinned === false &&
      show(pinCalls.map((c) => c.args)) ===
        show([
          { sessionId: alphaIds[4], pinned: true },
          { sessionId: alphaIds[4], pinned: false },
        ]),
    show({ pinOn, pinOff, pinCalls }),
  );
  const pinRefused = await ask("sessions.pin", {
    session: alphaIds[5],
    pinned: true,
  });
  check(
    "a door refusal of set_session_pinned answers door-error with the door's message",
    pinRefused.err === "door-error" &&
      show(pinRefused).includes("no such session in this window"),
    show(pinRefused),
  );
  const formAns = await ask("session.answer", {
    session: S.form,
    promptId: "toolu_form_1",
    kind: "form",
    answer: JSON.stringify({ name: "x" }),
  });
  const formCall = callsOf("answer_form")[0];
  check(
    "with answer_form the form's answer goes to the door with the form's tool call id and clears it",
    formAns.ok &&
      formAns.d.cleared === true &&
      formCall?.args.promptId === "toolu_form_1" &&
      formCall.args.answers.name === "x",
    show({ formAns, formCall }),
  );
  const stop2 = await ask("session.stop", { session: S.busyQueue });
  check(
    "with stop_session session.stop calls it",
    stop2.ok &&
      stop2.d.method === "stop" &&
      callsOf("stop_session").length === 1,
    show(stop2),
  );
  const rm2 = await ask("queue.remove", {
    session: S.busyQueue,
    queueId: "queued-held",
  });
  check(
    "with remove_queued_prompt queue.remove removes a listed message",
    rm2.ok &&
      rm2.d.removed === true &&
      callsOf("remove_queued_prompt")[0]?.args.promptId === "queued-held",
    show(rm2),
  );
  // A 2,000-character message waits in the queue: the list shows 300 characters, the removal answers it whole.
  st(S.busyQueue).status = "running";
  const LONG = `${"word ".repeat(399)}words`;
  const longQ = await ask("session.queue", {
    session: S.busyQueue,
    text: LONG,
  });
  const longList = await ask("queue.list", { session: S.busyQueue });
  const longRm = await ask("queue.remove", {
    session: S.busyQueue,
    queueId: longQ.d?.queueId,
  });
  check(
    "queue.list shows a 2,000-character message cut to 300 characters; queue.remove asks for the whole text, removes it and answers it without the phone's note",
    LONG.length === 2000 &&
      longQ.d?.queued === true &&
      callsOf("send_prompt").pop()?.args.prompt ===
        `${LONG}

(Sent from the phone.)` &&
      longList.ok &&
      longList.d.length === 1 &&
      longList.d[0].text.length === 300 &&
      longList.d[0].whole === undefined &&
      longRm.ok &&
      longRm.d.text === LONG &&
      callsOf("list_queued_prompts").pop()?.args.includePromptText === true &&
      callsOf("remove_queued_prompt").pop()?.args.promptId ===
        longQ.d.queueId &&
      queueOf(S.busyQueue).length === 0,
    show({
      longQ,
      longList: longList.d?.[0]?.text.length,
      longRm: longRm.d?.text?.slice(-40),
    }),
  );
  // Nimbalyst also lists a message it already handed to the session (status executing): the phone must not.
  queueOf(S.busyQueue).push(
    {
      id: "queued-sent",
      prompt: "already sent",
      createdAt: Date.now(),
      status: "executing",
    },
    { id: "queued-wait", prompt: "still waiting", createdAt: Date.now() },
  );
  const sentList = await ask("queue.list", { session: S.busyQueue });
  const sentRm = await ask("queue.remove", {
    session: S.busyQueue,
    queueId: "queued-sent",
  });
  check(
    "a message already handed to the session must leave the phone queue: queue.list shows only the pending one and queue.remove of the executing one answers no-queued",
    sentList.ok &&
      sentList.d.length === 1 &&
      sentList.d[0].queueId === "queued-wait" &&
      sentRm.err === "no-queued" &&
      queueOf(S.busyQueue).length === 2,
    show({ sentList, sentRm }),
  );
  queueOf(S.busyQueue).length = 0;
  const note2Send = await ask("session.note", { session: idle, text: "y" });
  const lastNote = callsOf("send_prompt").pop();
  check(
    'with answer_form the phone note is only "(Sent from the phone.)"',
    note2Send.ok && lastNote.args.prompt.endsWith("(Sent from the phone.)"),
    lastNote?.args.prompt,
  );
} catch (e) {
  failure = e;
} finally {
  await door.close();
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
