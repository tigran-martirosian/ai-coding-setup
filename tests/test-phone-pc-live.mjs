// Tests for the PC program's live view (skills/phone-bot/pc/actions/live.mjs) and the channel's end hooks
// (core/channel.mjs: pushHere and onEnd). A fixture nimbalyst.sqlite, fixture transcripts with two helpers in a
// temp home and a fake door stand in for Nimbalyst; a stand-in page speaks the sealed channel to the real
// createChannel, so live events travel the same way they reach the phone.
// Run: node tests/test-phone-pc-live.mjs
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
const show = (v) => JSON.stringify(v)?.slice(0, 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(20);
  }
}

// A temp home for this whole run; the files library reads it through os.homedir() and APPDATA.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-pc-live-"));
const home = path.join(tmp, "home");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
});
const NIM = path.join(process.env.APPDATA, "@nimbalyst", "electron");
fs.mkdirSync(path.join(NIM, "sqlite-db"), { recursive: true });
const PROJECT = "C:\\Projects\\beta";

// ---- the fixture database: the columns the reads use
const DB_FILE = path.join(NIM, "sqlite-db", "nimbalyst.sqlite");
const fx = new DatabaseSync(DB_FILE);
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
const addSession = (id, title, o = {}) => {
  const now = new Date().toISOString();
  fx.prepare(
    `INSERT INTO ai_sessions (id, workspace_id, title, status, provider_session_id, model, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    PROJECT,
    title,
    o.status ?? "running",
    o.provider ?? null,
    o.model ?? "claude-code:opus-1m",
    now,
    now,
  );
  return id;
};
const setSession = (id, col, v) =>
  fx.prepare(`UPDATE ai_sessions SET ${col} = ? WHERE id = ?`).run(v, id);

const T1 = "11111111-aaaa-4bbb-8ccc-000000000001";
const T2 = "11111111-aaaa-4bbb-8ccc-000000000002";
const TGONE = "11111111-aaaa-4bbb-8ccc-000000000003";
const S = {
  live: addSession("00000000-0000-4000-8000-000000000001", "Live", {
    provider: T1,
  }),
  gone: addSession("00000000-0000-4000-8000-000000000002", "Gone", {
    provider: TGONE,
  }),
  fresh: addSession("00000000-0000-4000-8000-000000000003", "Not run yet", {
    status: "idle",
    model: "claude-code:opus",
  }),
};

// ---- the fixture transcript: a prompt, an answer with 98,000 tokens of context and two helper calls; the first
// helper finished, the second runs and has its own transcript and meta file.
const DIR = path.join(home, ".claude", "projects", "C--Projects-beta");
fs.mkdirSync(DIR, { recursive: true });
const FILE1 = path.join(DIR, `${T1}.jsonl`);
const FILE2 = path.join(DIR, `${T2}.jsonl`);
const line = (o) => `${JSON.stringify(o)}\n`;
const append = (file, o) => fs.appendFileSync(file, line(o));
const at = () => new Date().toISOString();
const usage = (cacheRead, extra = {}) => ({
  input_tokens: 2,
  cache_creation_input_tokens: 998,
  cache_read_input_tokens: cacheRead,
  output_tokens: 400,
  ...extra,
});
const toolUse = (id, name, input) => ({
  type: "assistant",
  timestamp: at(),
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id, name, input }],
    usage: usage(97000),
  },
});
const toolResult = (id, extra = {}) => ({
  type: "user",
  timestamp: at(),
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: id, content: "ok" }],
  },
  ...extra,
});
const PROMPT_AT = "2026-11-14T09:59:00.000Z"; // the turn's start
const HELP_DONE_AT = "2026-11-14T10:05:00.000Z"; // the newest work row before the watch
fs.writeFileSync(
  FILE1,
  [
    { type: "system", subtype: "init" },
    {
      type: "user",
      timestamp: PROMPT_AT,
      message: { role: "user", content: "Build the thing" },
    },
    {
      type: "assistant",
      timestamp: "2026-11-14T10:00:00.000Z",
      message: {
        role: "assistant",
        content: [
          { type: "text", text: "Starting two helpers." },
          {
            type: "tool_use",
            id: "toolu_help_1",
            name: "Agent",
            input: {
              description: "S1: the first part",
              subagent_type: "worker-code",
              prompt: "x",
            },
          },
          {
            type: "tool_use",
            id: "toolu_help_2",
            name: "Agent",
            input: {
              description: "S2: the second part",
              subagent_type: "worker",
              prompt: "y",
            },
          },
        ],
        usage: usage(97000),
      },
    },
    toolResult("toolu_help_1", {
      timestamp: HELP_DONE_AT,
      toolUseResult: {
        status: "completed",
        agentId: "a0000000000000001",
        agentType: "worker-code",
        totalDurationMs: 623500,
        totalTokens: 164149,
        totalToolUseCount: 70,
      },
    }),
    // A helper's own line in the main file (older Claude Code): its bigger count is not the session's context.
    {
      type: "assistant",
      isSidechain: true,
      timestamp: at(),
      message: { role: "assistant", content: [], usage: usage(500000) },
    },
  ]
    .map(line)
    .join(""),
);
const SUB = path.join(DIR, T1, "subagents");
fs.mkdirSync(SUB, { recursive: true });
fs.writeFileSync(
  path.join(SUB, "agent-a0000000000000002.meta.json"),
  JSON.stringify({
    agentType: "worker",
    description: "S2: the second part",
    toolUseId: "toolu_help_2",
  }),
);
fs.writeFileSync(
  path.join(SUB, "agent-a0000000000000002.jsonl"),
  line({
    type: "assistant",
    isSidechain: true,
    agentId: "a0000000000000002",
    message: {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: "toolu_sub_1",
          name: "Bash",
          input: { command: "node x.mjs", description: "Run the tests" },
        },
      ],
      usage: usage(50000), // 2 + 998 + 50000 + 400 = 51400
    },
  }),
);
fs.writeFileSync(FILE2, line({ type: "system", subtype: "init" }));

// ---- the fake door: only the project list is read (knownSession)
const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const door = await startFakeDoor({
  endpointFile: path.join(NIM, "mcp-endpoint.json"),
  workspaces: [{ name: "beta", path: PROJECT }],
  tools: [],
  handle: (name) => {
    throw new Error(`the fake door has no ${name}`);
  },
});

// ---- the real channel and registry, and a stand-in page per device
const seal = await import("../phone/shared/seal.mjs");
const { createChannel } = await import(
  "../skills/phone-bot/pc/core/channel.mjs"
);
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const live = await import("../skills/phone-bot/pc/actions/live.mjs");
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const ends = []; // { dev, why } from the test action's onEnd hook
registry.add({
  name: "test.hook",
  run: (_d, ctx) => {
    ctx.onEnd((why) => ends.push({ dev: ctx.device, why }));
    return { hooked: true };
  },
});

const DEVICES = ["dev-phone-a", "dev-phone-b"].map((device) => ({
  device,
  key: seal.randomBytes(32),
}));
const keys = {
  devices: DEVICES.map((d) => ({ device: d.device, K: seal.toB64u(d.key) })),
};
const pages = new Map(); // dev -> stand-in page
const channel = createChannel({
  keys,
  registry,
  pcVersion: "0.0.0",
  context: () => ({ page: "ok", setupVersion: "0.0.0" }),
  send: (f) => pages.get(f.dev)?.receive(f),
});

// The page's half of the channel: hello, sealed requests, answers by id and every event in arrival order.
function standInPage({ device, key }) {
  const page = { dev: device, events: [], answers: new Map() };
  let sid;
  let n;
  let k;
  let np;
  let helloDone;
  let inbound = Promise.resolve();
  page.receive = (f) => {
    inbound = inbound.then(async () => {
      if (f.sid !== sid) return;
      if (f.n === 0) {
        const body = await seal.openHello(key, f, f.c);
        k = await seal.sessionKeys(key, np, seal.fromB64u(body.npc));
        return helloDone(body);
      }
      const body = await seal.openFrame(k.pc2p, f, f.c);
      if (body.k === "evt") page.events.push({ ...body, got: Date.now() });
      if (body.k === "res") page.answers.set(body.id, body);
    });
  };
  page.hello = () => {
    sid = seal.toB64u(seal.randomBytes(9));
    n = 0;
    np = seal.randomBytes(16);
    const h = { v: seal.PROTOCOL, t: "app", dev: device, sid, n: 0 };
    const done = new Promise((r) => {
      helloDone = r;
    });
    return seal
      .sealHello(key, h, {
        k: "hello",
        np: seal.toB64u(np),
        protocol: seal.PROTOCOL,
        pageVersion: "0.0.0",
      })
      .then((c) => channel.onApp({ ...h, c }))
      .then(() => done);
  };
  // Sends a sealed body with the next counter (or `skip` counters further: a gap).
  page.send = async (body, { skip = 0, wrongKey = false } = {}) => {
    n += 1 + skip;
    const h = { v: seal.PROTOCOL, t: "app", dev: device, sid, n };
    // The wrong key: the PC-to-page key, which the PC cannot open a page frame with.
    const c = await seal.sealFrame(wrongKey ? k.pc2p : k.p2pc, h, body);
    await channel.onApp({ ...h, c });
  };
  let rid = 0;
  page.ask = async (a, d) => {
    const id = `r-${++rid}`;
    await page.send({ k: "req", id, a, d });
    return until(() => page.answers.get(id), 3000);
  };
  page.liveAfter = (from, test) =>
    page.events.slice(from).find((e) => e.e === "live" && test(e.d));
  pages.set(device, page);
  return page;
}
const [A, B] = DEVICES.map(standInPage);

let failure = null;
try {
  await A.hello();
  await B.hello();

  // ---- context and helpers on their own
  const ctxRes = await A.ask("session.context", { session: S.live });
  check(
    "context reads 98k of 1M from the fixture (input plus both cache counts, the helper's line left out)",
    ctxRes?.ok &&
      ctxRes.d.used === 98000 &&
      ctxRes.d.window === 1000000 &&
      ctxRes.d.percent === 10,
    show(ctxRes),
  );
  const fresh = await A.ask("session.context", { session: S.fresh });
  check(
    "a session that has not run has no count yet and a 200,000 window (not a -1m model)",
    fresh?.ok && fresh.d.used === null && fresh.d.window === 200000,
    show(fresh),
  );
  const helpers = await A.ask("session.helpers", { session: S.live });
  const [h1, h2] = helpers?.d ?? [];
  check(
    "two helpers show with their token counts: the finished one from its result, the running one from its own transcript",
    helpers?.ok &&
      helpers.d.length === 2 &&
      h1.name === "S1: the first part" &&
      h1.type === "worker-code" &&
      h1.state === "done" &&
      h1.tokens === 164149 &&
      h1.ms === 623500 &&
      h1.tools === 70 &&
      h2.name === "S2: the second part" &&
      h2.state === "running" &&
      h2.tokens === 51400 &&
      h2.since === "2026-11-14T10:00:00.000Z",
    show(helpers),
  );
  check(
    "the running helper shows its current step",
    h2?.step?.tool === "Bash" && h2.step.label === "Run the tests",
    show(h2),
  );
  const gone = await A.ask("session.watch", { session: S.gone });
  check(
    "watching a session whose transcript is missing answers transcript-gone",
    gone?.err === "transcript-gone",
    show(gone),
  );
  const stranger = await A.ask("session.helpers", {
    session: "00000000-0000-4000-8000-0000000000ff",
  });
  check(
    "an unknown session answers no-session",
    stranger?.err === "no-session",
    show(stranger),
  );

  // ---- the database is opened read only
  const { openDb } = await import("../skills/phone-bot/pc/core/db.mjs");
  let writeErr = null;
  try {
    openDb().exec("UPDATE ai_sessions SET title = 'changed'");
  } catch (e) {
    writeErr = e.message;
  }
  check(
    "the database is opened read only: a write attempt fails",
    /readonly/i.test(writeErr || "") &&
      fx.prepare("SELECT title FROM ai_sessions WHERE id = ?").get(S.live)
        .title === "Live",
    String(writeErr),
  );

  // ---- watching: tool calls reach the page as they happen
  const w = await A.ask("session.watch", { session: S.live });
  check(
    "session.watch answers the start: state, queue, the two helpers, context and the check interval",
    w?.ok &&
      w.d.watching === true &&
      w.d.state === "running" &&
      w.d.queue.length === 0 &&
      w.d.helpers.length === 2 &&
      w.d.context.used === 98000 &&
      w.d.checkMs === 1000,
    show(w),
  );
  check(
    "session.watch answers the turn's start (the newest prompt) and the newest work row, not open",
    w?.ok &&
      w.d.turnAt === PROMPT_AT &&
      w.d.tail?.at === HELP_DONE_AT &&
      w.d.tail.open === false,
    show({ turnAt: w?.d.turnAt, tail: w?.d.tail }),
  );
  let from = A.events.length;
  const fromB = B.events.length;
  const sent = Date.now();
  append(
    FILE1,
    toolUse("toolu_read_1", "Read", { file_path: "C:\\Projects\\beta\\a.md" }),
  );
  const got = await until(
    () => A.liveAfter(from, (d) => d.rows.some((r) => r.id === "toolu_read_1")),
    2000,
  );
  const row = got?.d.rows.find((r) => r.id === "toolu_read_1");
  check(
    "a tool call appended to the transcript reaches the stand-in page within 2 seconds",
    got &&
      got.got - sent < 2000 &&
      got.d.session === S.live &&
      row.kind === "tool" &&
      row.tool === "Read" &&
      row.label === "C:\\Projects\\beta\\a.md",
    `${got ? got.got - sent : "none"} ms ${show(got?.d)}`,
  );
  console.log(
    `     | tool call reached the page in ${got ? got.got - sent : "-"} ms`,
  );
  await sleep(300);
  check(
    "the other paired device gets no live event (pushHere goes to the asking device only)",
    B.events.length === fromB,
    show(B.events.slice(fromB)),
  );

  from = A.events.length;
  const half = line(toolUse("toolu_half", "Grep", { pattern: "x" }));
  fs.appendFileSync(FILE1, half.slice(0, 40));
  await sleep(1300);
  const early = A.liveAfter(from, (d) =>
    d.rows.some((r) => r.id === "toolu_half"),
  );
  fs.appendFileSync(FILE1, half.slice(40));
  const late = await until(
    () => A.liveAfter(from, (d) => d.rows.some((r) => r.id === "toolu_half")),
    2500,
  );
  check(
    "a line still being written is sent once it is whole",
    !early && late,
    show({ early, late: late?.d }),
  );

  // ---- user lines the system wrote: a helper's notice is one short row; a reminder, a hook's note, a wrapper none
  from = A.events.length;
  const QUOTE = "why does the report end with <usage>total_tokens: 5</usage>?";
  const said = (content) => ({
    type: "user",
    timestamp: at(),
    message: { role: "user", content },
  });
  append(
    FILE1,
    said(
      '<task-notification>\n<task-id>a9</task-id>\n<status>failed</status>\n<summary>Agent "check" failed</summary>\n<result>raw report</result>\n</task-notification>',
    ),
  );
  append(FILE1, said("<system-reminder>\nfiles changed\n</system-reminder>"));
  append(FILE1, said("Stop hook feedback:\n[node gate.mjs]: finish the step"));
  append(FILE1, said("<local-command-stdout>cleared</local-command-stdout>"));
  append(FILE1, said(QUOTE));
  const texts = await until(() => {
    const rows = A.events
      .slice(from)
      .filter((e) => e.e === "live")
      .flatMap((e) => e.d.rows)
      .filter((r) => r.kind === "text");
    return rows.some((r) => r.text === QUOTE) ? rows : null;
  }, 2500);
  check(
    "a live helper's notice is one row with its summary and status, the reminder, hook note and wrapper none, a quote whole",
    texts?.length === 2 &&
      texts[0].system === "helper" &&
      texts[0].text === 'Agent "check" failed' &&
      texts[0].status === "failed" &&
      !JSON.stringify(texts[0]).includes("<") &&
      texts[1].text === QUOTE &&
      !texts[1].system,
    show(texts),
  );

  // ---- thinking: its text, cut at 4,000 characters; a block with only a signature has none
  from = A.events.length;
  const thought = (thinking) => ({
    type: "assistant",
    timestamp: at(),
    message: {
      role: "assistant",
      content: [{ type: "thinking", thinking, signature: "sig" }],
    },
  });
  append(FILE1, thought(`Weighing the two ways. ${"x".repeat(5000)}`));
  append(FILE1, thought(""));
  append(FILE1, thought("A short thought."));
  const thinks = await until(() => {
    const rows = A.events
      .slice(from)
      .filter((e) => e.e === "live")
      .flatMap((e) => e.d.rows)
      .filter((r) => r.kind === "thinking");
    return rows.length === 3 ? rows : null;
  }, 2500);
  check(
    "thinking rows carry their text, a long one cut at 4,000 characters, a signed-only one none",
    thinks?.[0].text.length === 4000 &&
      thinks[0].text.startsWith("Weighing the two ways.") &&
      thinks[0].cut === true &&
      !("text" in thinks[1]) &&
      thinks[2].text === "A short thought." &&
      !("cut" in thinks[2]) &&
      thinks.every((r) => typeof r.at === "string"),
    show(thinks?.map((r) => ({ ...r, text: r.text?.length }))),
  );

  // ---- the turn's start: a new prompt moves it; a tool result does not
  from = A.events.length;
  const promptAt = at();
  append(FILE1, {
    type: "user",
    timestamp: promptAt,
    message: { role: "user", content: "Now the next part" },
  });
  const turn = await until(() => A.liveAfter(from, (d) => "turnAt" in d), 2500);
  check(
    "a new prompt pushes the turn's new start (turnAt)",
    turn?.d.turnAt === promptAt,
    show(turn?.d),
  );

  from = A.events.length;
  append(
    FILE1,
    toolResult("toolu_help_2", {
      toolUseResult: {
        status: "completed",
        totalDurationMs: 90000,
        totalTokens: 51400,
        totalToolUseCount: 3,
      },
    }),
  );
  const helperDone = await until(
    () => A.liveAfter(from, (d) => d.helpers?.[1]?.state === "done"),
    2500,
  );
  check(
    "a helper's result is pushed as a helpers change, with the result row",
    helperDone?.d.helpers[1].tokens === 51400 &&
      helperDone.d.rows.some(
        (r) => r.kind === "result" && r.id === "toolu_help_2",
      ),
    show(helperDone?.d),
  );

  from = A.events.length;
  fx.prepare(
    "INSERT INTO queued_prompts (id, session_id, prompt, status, created_at) VALUES (?, ?, ?, 'pending', ?)",
  ).run("queued-1", S.live, "and then this", at());
  setSession(S.live, "status", "waiting_for_input");
  const changed = await until(
    () =>
      A.liveAfter(from, (d) => d.state === "waiting") &&
      A.liveAfter(from, (d) => d.queue?.length === 1),
    2500,
  );
  const qEvt = A.liveAfter(from, (d) => d.queue);
  check(
    "a new state and a queued message from the database are pushed",
    changed &&
      qEvt.d.queue[0].queueId === "queued-1" &&
      qEvt.d.queue[0].text === "and then this",
    show(A.events.slice(from).map((e) => e.d)),
  );
  await sleep(1200);
  const quiet = A.events.length;
  await sleep(1200);
  check(
    "nothing is pushed while nothing changes",
    A.events.length === quiet,
    show(A.events.slice(quiet).map((e) => e.d)),
  );

  // ---- a new transcript file: the page reopens, the watch follows the new file
  from = A.events.length;
  setSession(S.live, "provider_session_id", T2);
  const reopen = await until(() => A.liveAfter(from, (d) => d.reopen), 2500);
  append(FILE2, toolUse("toolu_new_1", "Edit", { file_path: "b.md" }));
  const onNew = await until(
    () => A.liveAfter(from, (d) => d.rows.some((r) => r.id === "toolu_new_1")),
    2500,
  );
  check(
    "after the transcript changes (provider_session_id) the page is told to reopen and tool calls of the new file arrive",
    reopen && onNew,
    show(A.events.slice(from).map((e) => e.d)),
  );
  from = A.events.length;
  fs.writeFileSync(FILE2, line({ type: "system", subtype: "init" }));
  const shrunk = await until(() => A.liveAfter(from, (d) => d.reopen), 2500);
  append(FILE2, toolUse("toolu_new_2", "Read", { file_path: "c.md" }));
  const afterShrink = await until(
    () => A.liveAfter(from, (d) => d.rows.some((r) => r.id === "toolu_new_2")),
    2500,
  );
  check(
    "a transcript written anew (shorter than before) is a reopen too, and is followed on",
    shrunk && afterShrink,
    show(A.events.slice(from).map((e) => e.d)),
  );

  // ---- one position: the watch goes on from where session.open's read stopped
  const { readTurns } = await import(
    "../skills/phone-bot/pc/core/transcripts.mjs"
  );
  const { knownSession } = await import("../skills/phone-bot/pc/core/db.mjs");
  const { sessionPlace } = await import(
    "../skills/phone-bot/pc/core/files.mjs"
  );
  const read = readTurns(
    FILE2,
    null,
    50,
    sessionPlace(knownSession(S.live).row),
  );
  append(FILE2, toolUse("toolu_between", "Read", { file_path: "e.md" }));
  from = A.events.length;
  const w2 = await A.ask("session.watch", { session: S.live, start: read.end });
  await until(
    () =>
      A.liveAfter(from, (d) => d.rows.some((r) => r.id === "toolu_between")),
    2500,
  );
  await sleep(1200);
  const between = A.events
    .slice(from)
    .flatMap((e) => e.d?.rows ?? [])
    .filter((r) => r.id === "toolu_between");
  check(
    "a row written after session.open's read and before session.watch is pushed once, with its line's offset",
    w2?.ok &&
      Number.isInteger(read.end) &&
      between.length === 1 &&
      between[0].pos >= read.end,
    show({ w2, end: read.end, between }),
  );
  const past = await A.ask("session.watch", {
    session: S.live,
    start: fs.statSync(FILE2).size + 1,
  });
  const minus = await A.ask("session.watch", { session: S.live, start: -1 });
  check(
    "session.watch refuses a start past the transcript's end or below 0",
    past?.err === "bad-input" && minus?.err === "bad-input",
    show({ past, minus }),
  );
  await A.ask("session.unwatch", { session: S.live });

  // ---- ending a watch
  const un = await A.ask("session.unwatch", { session: S.live });
  from = A.events.length;
  append(FILE2, toolUse("toolu_after_unwatch", "Read", { file_path: "d.md" }));
  await sleep(1500);
  check(
    "session.unwatch stops the watch: nothing more arrives",
    un?.ok &&
      un.d.watching === false &&
      live.watchCount() === 0 &&
      A.events.length === from,
    show({ un, count: live.watchCount() }),
  );
  await A.ask("session.watch", { session: S.live });
  const watching = live.watchCount();
  await A.send({ k: "bye" });
  check(
    "closing the page (bye) ends its watch",
    watching === 1 && live.watchCount() === 0,
    `${watching} then ${live.watchCount()}`,
  );

  // ---- the channel's end hooks: every way a device's channel session ends calls onEnd once
  const endsBy = async (why, act) => {
    await A.hello();
    await A.ask("test.hook");
    const before = ends.length;
    await act();
    await sleep(50);
    const mine = ends.slice(before);
    check(
      `onEnd is called once when the channel session ends by ${why}`,
      mine.length === 1 && mine[0].why === why && mine[0].dev === A.dev,
      show(mine),
    );
  };
  await endsBy("bye", () => A.send({ k: "bye" }));
  await endsBy("counter-gap", () =>
    A.send({ k: "req", id: "x", a: "pc.status" }, { skip: 1 }),
  );
  await endsBy("bad-frame", () =>
    A.send({ k: "req", id: "x", a: "pc.status" }, { wrongKey: true }),
  );
  await endsBy("hello", () => A.hello());
  await endsBy("removed", () => channel.closeDevice(A.dev));
  await A.hello();
  await A.ask("session.watch", { session: S.live });
  channel.closeDevice(A.dev);
  check(
    "removing the device ends its watch",
    live.watchCount() === 0,
    String(live.watchCount()),
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
