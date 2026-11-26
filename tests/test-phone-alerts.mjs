// Tests for the PC program's alerts (skills/phone-bot/pc/actions/alerts.mjs): the watcher that turns a session's
// change to "waiting", "finished" or "handed off" into one short alert frame for the relay, and the alerts.get,
// alerts.set and alerts.resolve actions. A fixture nimbalyst.sqlite, an endpoint file and transcripts in a temp home
// stand in for Nimbalyst and Claude Code; the clock is the test's, so the 2-second settle needs no waiting.
// Run: node tests/test-phone-alerts.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 400);

// A temp home for this whole run; the files library reads it through os.homedir() and APPDATA.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-alerts-"));
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

const PROJECT = { name: "alpha-web", path: "C:\\Projects\\alpha-web" };
const ODD = { name: "Café, déjà vu", path: "C:\\Projects\\cafe" };
const WEB = { name: "website", path: "C:\\Projects\\website" };
// The open endpoint file: listProjects reads the projects from it; the pid is this process, so it counts as open.
fs.writeFileSync(
  path.join(NIM, "mcp-endpoint.json"),
  JSON.stringify({
    port: 1,
    token: "test-token",
    pid: process.pid,
    workspaces: [PROJECT, ODD, WEB],
  }),
);

const fx = new DatabaseSync(path.join(NIM, "sqlite-db", "nimbalyst.sqlite"));
fx.exec(`
  CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
    provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
    is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
  CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
  CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
    direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
`);
let idn = 0;
const newId = () =>
  `00000000-0000-4000-8000-${(++idn).toString(16).padStart(12, "0")}`;
// lines: the session's Claude Code transcript, written under ~/.claude/projects; none for a session without one.
const addSession = (workspace, title, status, lines) => {
  const id = newId();
  const provider = lines ? newId() : null;
  const now = new Date().toISOString();
  fx.prepare(
    "INSERT INTO ai_sessions (id, workspace_id, title, status, provider_session_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(id, workspace.path, title, status, provider, now, now);
  if (lines?.length) {
    const dir = path.join(
      home,
      ".claude",
      "projects",
      workspace.path.replace(/[^A-Za-z0-9]/g, "-"),
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, `${provider}.jsonl`),
      `${lines.map((l) => JSON.stringify(l)).join("\n")}\n`,
    );
  }
  return id;
};

// Transcript lines as Claude Code writes them.
let tn = 0;
const said = (text) => ({
  type: "user",
  message: { role: "user", content: text },
});
const answered = (text) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});
const ran = (command) => {
  const id = `toolu_${++tn}`;
  return [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
      },
    },
    {
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: id, content: "done" }],
      },
    },
  ];
};
const BRIEF_RUN =
  'cd "C:/Projects/website" && node ~/.claude/skills/handoff/brief.mjs --summary C:/Users/you/AppData/Local/Temp/summary.md';
// The /handoff turn: the command wrapper, the skill's text (meta), the brief command, the closing words.
const handoffTurn = () => [
  said(
    "<command-message>handoff is running…</command-message>\n<command-name>/handoff</command-name>",
  ),
  {
    type: "user",
    isMeta: true,
    message: {
      role: "user",
      content: [{ type: "text", text: "Base directory for this skill" }],
    },
  },
  ...ran(BRIEF_RUN),
  answered("Handed off; the new session continues from the brief."),
];
const plainTurn = (words) => [
  said(words),
  ...ran("git status"),
  answered("Done."),
];
const setStatus = (id, status) =>
  fx
    .prepare("UPDATE ai_sessions SET status = ?, updated_at = ? WHERE id = ?")
    .run(status, new Date().toISOString(), id);

// The question the waiting session asks: none of its words may reach an alert.
const QUESTION =
  "Which colour should the checkout button use, crimson or teal?";
const QUESTION_WORDS = QUESTION.toLowerCase().match(/[a-z]{4,}/g);

const RELAY_TEXT =
  /^[A-Za-z0-9 ._-]{1,40}( · [\p{L}\p{N} ._-]{1,60})?: (needs you|finished|handed off, continuing)$/u;
const RELAY_OPEN = /^[A-Za-z0-9_-]{1,16}$/;

const {
  createAlerts,
  register,
  alertName,
  alertText,
  runsHandoffBrief,
  sessionOpened,
} = await import("../skills/phone-bot/pc/actions/alerts.mjs");
const logLines = (word) => {
  const file = path.join(home, ".phone-app", "pc.log");
  if (!fs.existsSync(file)) return 0;
  return fs
    .readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.includes(word)).length;
};
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
register(registry);
const ctx = { page: "ok", device: "dev-test", push: () => {} };
let rn = 0;
const ask = (a, d) => registry.handle({ k: "req", id: `r-${++rn}`, a, d }, ctx);

let clock = Date.now();
const sent = [];
let relayUp = true;
const send = (f) => {
  if (!relayUp) return false;
  sent.push(f);
  return true;
};
const alerts = createAlerts({ send, now: () => clock });
const later = (s) => {
  clock += s * 1000;
  return alerts.tick();
};
const since = (n) => sent.slice(n);

let failure = null;
try {
  const ask1 = addSession(PROJECT, "Design review", "running");
  const flicker = addSession(PROJECT, "Quick check", "running");
  const done1 = addSession(PROJECT, "Release notes", "running");
  const done2 = addSession(PROJECT, "Search speed-up", "running");
  const odd = addSession(ODD, "Menu", "running");
  const brief = () => [
    ...plainTurn("Write the release notes"),
    ...handoffTurn(),
  ];
  const web = {
    handoffAtDefault: addSession(
      WEB,
      "Release notes draft",
      "running",
      brief(),
    ),
    plain: addSession(WEB, "Release notes draft", "running", [
      ...plainTurn("Write the release notes"),
    ]),
    handoff: addSession(WEB, "Release notes draft", "running", brief()),
    stopHookOnly: addSession(WEB, "Release notes draft", "running", [
      ...plainTurn("Write the release notes"),
    ]),
    grepOnly: addSession(WEB, "Release notes draft", "running", [
      said("Where does the skill run its brief?"),
      ...ran(
        'grep -n "node ~/.claude/skills/handoff/brief.mjs --summary" ~/.claude/skills/handoff/SKILL.md',
      ),
      answered("In step 2."),
    ]),
    earlierHandoff: addSession(WEB, "Release notes draft", "running", [
      ...brief(),
      ...plainTurn("One more change to the notes"),
    ]),
    handoffFinishedOff: addSession(
      WEB,
      "Release notes draft",
      "running",
      brief(),
    ),
    plainFinishedOff: addSession(WEB, "Release notes draft", "running", [
      ...plainTurn("Write the release notes"),
    ]),
    unreadable: addSession(WEB, "Release notes draft", "running", []),
  };

  check("the first look sends nothing", alerts.tick() === 0 && !sent.length);

  // ---- a session that starts waiting: exactly one alert within 3 seconds, short, with no words of the question
  setStatus(ask1, "waiting_for_input");
  fx.prepare(
    "INSERT INTO ai_agent_messages (session_id, created_at, direction, content, message_kind) VALUES (?, ?, 'output', ?, 'text')",
  ).run(ask1, new Date().toISOString(), JSON.stringify({ text: QUESTION }));
  const firstTwo = later(1) + later(1);
  check(
    "a session that starts waiting alerts within 3 seconds, not before 2",
    firstTwo === 0 && later(1) === 1,
    show(sent),
  );
  later(5);
  later(60);
  const waitAlerts = sent.filter((f) => f.text?.endsWith("needs you"));
  check(
    "a session that starts waiting gives exactly one alert",
    waitAlerts.length === 1 && sent.length === 1,
    show(sent),
  );
  const a = waitAlerts[0];
  check(
    "its text is the project name, the session title and needs you",
    a?.text === "alpha-web · Design review: needs you" &&
      RELAY_TEXT.test(a.text),
    show(a),
  );
  check(
    "its text holds none of the question's words",
    a && !QUESTION_WORDS.some((w) => a.text.toLowerCase().includes(w)),
    show(a),
  );
  check(
    "it is an alert frame for the relay, buzzing by default, with an Open handle",
    a?.t === "alert" &&
      a.v === 1 &&
      a.silent === false &&
      RELAY_OPEN.test(a.open) &&
      a.open.length === 12 &&
      Object.keys(a).sort().join() === "open,silent,t,text,v",
    show(a),
  );
  const r = await ask("alerts.resolve", { handle: a.open });
  check(
    "alerts.resolve maps the handle to the session",
    r.ok && r.d.session === ask1 && /^[A-Z2-7]{12}$/.test(r.d.project),
    show(r),
  );
  const gone = await ask("alerts.resolve", { handle: "AAAAAAAAAAAA" });
  check(
    "an unknown handle is expired",
    !gone.ok && gone.err === "expired",
    show(gone),
  );
  const inherited = [];
  for (const handle of ["constructor", "toString"])
    inherited.push(await ask("alerts.resolve", { handle }));
  check(
    "a handle named like an inherited object key (constructor, toString) is expired",
    inherited.every((x) => !x.ok && x.err === "expired"),
    show(inherited),
  );

  // ---- waiting 1 second and working again sends nothing; a flicker back to waiting sends no second alert
  let n = sent.length;
  setStatus(flicker, "waiting_for_input");
  later(1);
  setStatus(flicker, "running");
  later(1);
  later(30);
  check(
    "a session that waits 1 second then works again sends nothing",
    since(n).length === 0,
    show(since(n)),
  );
  setStatus(ask1, "running");
  later(1);
  setStatus(ask1, "waiting_for_input");
  later(1);
  later(30);
  check(
    "a waiting session that works 1 second and waits again sends no second alert",
    since(n).length === 0,
    show(since(n)),
  );

  // ---- finished set to silent: its alert carries the silent flag
  const set = await ask("alerts.set", {
    kind: "session-finished",
    mode: "silent",
  });
  check("alerts.set keeps a choice", set.ok && set.d.mode === "silent");
  n = sent.length;
  setStatus(done1, "idle");
  later(1);
  later(11);
  later(11);
  check(
    "with finished set to silent its one alert carries the silent flag",
    since(n).length === 1 &&
      since(n)[0].text === "alpha-web · Release notes: finished" &&
      since(n)[0].silent === true,
    show(since(n)),
  );
  check(
    "a finished session with no transcript reads finished and logs one line",
    logLines("finished: the session has no transcript") === 1,
  );

  // ---- finished off: no alert
  await ask("alerts.set", { kind: "session-finished", mode: "off" });
  n = sent.length;
  setStatus(done2, "idle");
  later(1);
  later(11);
  later(11);
  check(
    "with finished off no alert is sent",
    since(n).length === 0,
    show(since(n)),
  );

  // ---- a session that handed off: its own alert, off by default; only the brief command in the last turn counts
  const finishWeb = (id) => {
    const m = sent.length;
    setStatus(id, "idle");
    later(1);
    later(1);
    later(1);
    later(30);
    return since(m).map((f) => [f.text, f.silent]);
  };
  const FINISHED = "website · Release notes draft: finished";
  const HANDED = "website · Release notes draft: handed off, continuing";
  await ask("alerts.set", { kind: "session-finished", mode: "silent" });
  let got = finishWeb(web.handoffAtDefault);
  check(
    "with Handed off at its default (off) a handoff sends no alert and no finished",
    got.length === 0,
    show(got),
  );
  got = finishWeb(web.plain);
  check(
    "a session that finishes gives exactly one alert with its title",
    show(got) === show([[FINISHED, true]]),
    show(got),
  );
  const on = await ask("alerts.set", {
    kind: "session-handed-off",
    mode: "buzz",
  });
  check("alerts.set takes the Handed off choice", on.ok, show(on));
  got = finishWeb(web.handoff);
  check(
    "a session whose last turn ran the brief command gives exactly one handed off alert and no finished",
    show(got) === show([[HANDED, false]]) && RELAY_TEXT.test(HANDED),
    show(got),
  );
  const handoffs = path.join(home, ".claude", "handoffs");
  fs.mkdirSync(handoffs, { recursive: true });
  fs.writeFileSync(
    path.join(handoffs, "C--Projects-website-latest.md"),
    `# Handoff\n\nFrom session ${web.stopHookOnly}\n`,
  );
  got = finishWeb(web.stopHookOnly);
  check(
    "a session with only the Stop hook's automatic brief on disk gives finished",
    show(got) === show([[FINISHED, true]]),
    show(got),
  );
  got = finishWeb(web.grepOnly);
  check(
    "a session whose last turn only greps for the brief command gives finished",
    show(got) === show([[FINISHED, true]]),
    show(got),
  );
  got = finishWeb(web.earlierHandoff);
  check(
    "a session that handed off in an earlier turn and finished a later one gives finished",
    show(got) === show([[FINISHED, true]]),
    show(got),
  );
  const notRead = logLines("transcript was not read");
  relayUp = false;
  n = sent.length;
  setStatus(web.unreadable, "idle");
  for (let i = 0; i < 8; i++) later(1);
  relayUp = true;
  later(1);
  check(
    "a session whose transcript cannot be read gives finished once and logs one line",
    show(since(n).map((f) => f.text)) === show([FINISHED]) &&
      logLines("transcript was not read") === notRead + 1,
    show(since(n)),
  );
  await ask("alerts.set", { kind: "session-finished", mode: "off" });
  got = [
    ...finishWeb(web.handoffFinishedOff),
    ...finishWeb(web.plainFinishedOff),
  ];
  check(
    "with Handed off on and Finished off only the handoff alert goes",
    show(got) === show([[HANDED, false]]),
    show(got),
  );

  // ---- the text: the title cleaned and cut at 60, an untitled session as before, the brief command's forms
  const long = `Fix: the «login» page/flow 🚀 ${"y".repeat(60)}`;
  const cleaned = alertText("website", long, "session-finished");
  check(
    "a title with other characters is cleaned and cut at 60",
    cleaned ===
      `website · Fix- the -login- page-flow - ${"y".repeat(31)}: finished` &&
      RELAY_TEXT.test(cleaned),
    cleaned,
  );
  const script = alertText("website", "Заметки 2.0", "session-needs-you");
  check(
    "a title keeps letters and digits of any script",
    script === "website · Заметки 2.0: needs you" && RELAY_TEXT.test(script),
    script,
  );
  const linky = alertText(
    "website",
    "sign in at tg-login.app or a1b2.example.com",
    "session-needs-you",
  );
  check(
    "a title shaped like a domain is broken, so the chat shows no link (FAIL: a session can put a link in the bot chat)",
    linky ===
      "website · sign in at tg-login-app or a1b2-example-com: needs you" &&
      RELAY_TEXT.test(linky),
    linky,
  );
  check(
    "an untitled session reads project: needs you",
    alertText("website", "", "session-needs-you") === "website: needs you",
  );
  const runs = [
    BRIEF_RUN,
    '"C:/Program Files/nodejs/node.exe" "C:/Users/you/.claude/skills/handoff/brief.mjs" --summary s.md',
  ];
  const notRuns = [
    "node ~/.claude/skills/handoff/brief.mjs",
    'grep -rn "node handoff/brief.mjs --summary" .',
    "echo node handoff/brief.mjs --summary",
    "node other.mjs handoff/brief.mjs --summary",
  ];
  check(
    "only node running the handoff skill's brief.mjs with --summary counts as a handoff",
    runs.every(runsHandoffBrief) && !notRuns.some(runsHandoffBrief),
    show([runs.map(runsHandoffBrief), notRuns.map(runsHandoffBrief)]),
  );

  got = await ask("alerts.get", {});
  check(
    "alerts.get answers each kind's choice",
    got.ok &&
      show(got.d) ===
        show([
          { kind: "session-needs-you", mode: "buzz" },
          { kind: "session-finished", mode: "off" },
          { kind: "session-handed-off", mode: "buzz" },
        ]),
    show(got),
  );
  const bad = await ask("alerts.set", {
    kind: "session-needs-you",
    mode: "loud",
  });
  check(
    "a mode other than buzz, silent or off is refused",
    !bad.ok && bad.err === "bad-input" && bad.field === "mode",
    show(bad),
  );
  const badKind = await ask("alerts.set", { kind: "anything", mode: "off" });
  check(
    "an unknown kind is refused",
    !badKind.ok && badKind.err === "bad-input" && badKind.field === "kind",
    show(badKind),
  );

  // ---- the relay away: the alert waits and goes once when it is back, while the session still waits
  n = sent.length;
  relayUp = false;
  setStatus(odd, "waiting_for_input");
  later(1);
  later(11);
  later(11);
  relayUp = true;
  later(5);
  later(5);
  check(
    "an alert held while the relay is away is sent once when it is back",
    since(n).length === 1,
    show(since(n)),
  );
  check(
    "a name with other characters fits the relay's pattern",
    since(n)[0]?.text === "Caf-- d-j- vu · Menu: needs you" &&
      RELAY_TEXT.test(since(n)[0].text),
    show(since(n)),
  );
  check(
    "a long name is cut to 40 characters",
    alertName("x".repeat(60)).length === 40,
  );

  // ---- the state file: a broken choice is a clear error, not a guess
  const stateFile = path.join(home, ".phone-app", "pc-state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  check(
    "the choices and one handle per sent alert are in the state file",
    state.alerts["session-finished"] === "off" &&
      Object.keys(state.handles).length === sent.length,
    show(state),
  );
  fs.writeFileSync(
    stateFile,
    JSON.stringify({ ...state, alerts: { "session-needs-you": "loud" } }),
  );
  const broken = await ask("alerts.get", {});
  check(
    "a stored mode that is not buzz, silent or off fails with a clear error",
    !broken.ok && /alert mode "loud"/.test(broken.message),
    show(broken),
  );

  // ---- one alert per session in the chat: a change that held removes the session's shown alert first
  fs.writeFileSync(stateFile, JSON.stringify(state));
  await ask("alerts.set", { kind: "session-finished", mode: "silent" });
  const hold = () => [later(1), later(1), later(1)];
  const frames = (m) => since(m).map((f) => [f.t, f.open]);
  const twice = addSession(PROJECT, "Twice asked", "running");
  const answeredQ = addSession(PROJECT, "Answered", "running");
  const openedS = addSession(PROJECT, "Opened", "running");
  const readS = addSession(PROJECT, "Read there", "running");
  hold();
  n = sent.length;
  setStatus(twice, "waiting_for_input");
  hold();
  const ask1st = sent.at(-1);
  setStatus(twice, "running");
  hold();
  setStatus(twice, "waiting_for_input");
  hold();
  const ask2nd = sent.at(-1);
  const chat = new Set();
  for (const f of since(n))
    if (f.t === "alert") chat.add(f.open);
    else if (f.t === "alert-done") chat.delete(f.open);
  check(
    "a session that needs you twice leaves one alert in the chat",
    show(frames(n)) ===
      show([
        ["alert", ask1st.open],
        ["alert-done", ask1st.open],
        ["alert", ask2nd.open],
      ]) && show([...chat]) === show([ask2nd.open]),
    show(since(n)),
  );
  n = sent.length;
  sessionOpened(twice);
  later(1);
  check(
    "opening a session in the app leaves its needs-you alert",
    since(n).length === 0,
    show(since(n)),
  );
  setStatus(twice, "idle");
  hold();
  check(
    "a session that stops waiting without running loses its needs-you alert and sends none",
    show(frames(n)) === show([["alert-done", ask2nd.open]]),
    show(since(n)),
  );

  setStatus(answeredQ, "waiting_for_input");
  hold();
  const q = sent.at(-1);
  n = sent.length;
  setStatus(answeredQ, "running");
  const ticks = hold().map(() => frames(n).length);
  check(
    "an answered question's alert is deleted within 3 seconds",
    show(frames(n)) === show([["alert-done", q.open]]) &&
      Object.keys(q).sort().join() === "open,silent,t,text,v",
    show([ticks, since(n)]),
  );

  setStatus(openedS, "idle");
  hold();
  const fin = sent.at(-1);
  n = sent.length;
  later(5);
  sessionOpened(openedS);
  later(1);
  check(
    "a finished alert is deleted when its session is opened in the app",
    show(frames(n)) === show([["alert-done", fin.open]]),
    show(since(n)),
  );
  n = sent.length;
  setStatus(openedS, "running");
  hold();
  check(
    "an alert already removed is not removed again when its session runs again",
    since(n).length === 0,
    show(since(n)),
  );

  setStatus(readS, "idle");
  hold();
  const finRead = sent.at(-1);
  n = sent.length;
  later(5);
  const unreadNothing = since(n).length;
  fx.prepare("UPDATE ai_sessions SET metadata = ? WHERE id = ?").run(
    JSON.stringify({ metadata: { hasUnread: false, lastReadAt: clock } }),
    readS,
  );
  later(1);
  check(
    "a finished alert is deleted once the session is read in Nimbalyst",
    unreadNothing === 0 &&
      show(frames(n)) === show([["alert-done", finRead.open]]),
    show(since(n)),
  );
  setStatus(readS, "running");
  hold();
  n = sent.length;
  setStatus(readS, "idle");
  hold();
  const finAgain = sent.at(-1);
  setStatus(readS, "running");
  hold();
  check(
    "a finished alert is deleted when its session runs again",
    show(frames(n)) ===
      show([
        ["alert", finAgain.open],
        ["alert-done", finAgain.open],
      ]),
    show(since(n)),
  );

  // ---- a read error keeps what the watcher knew: a change made while the sessions could not be read still alerts
  const badRead = addSession(PROJECT, "Bad metadata", "running");
  const meanwhile = addSession(PROJECT, "Changed meanwhile", "running");
  hold();
  setStatus(badRead, "idle");
  hold();
  // start() takes one guarded look (the timer's), stop() ends the timer before it fires.
  const guardedLook = () => {
    clock += 1000;
    alerts.start();
    alerts.stop();
  };
  n = sent.length;
  fx.prepare("UPDATE ai_sessions SET metadata = ? WHERE id = ?").run(
    "{not json",
    badRead,
  );
  guardedLook();
  setStatus(meanwhile, "waiting_for_input");
  guardedLook();
  fx.prepare("UPDATE ai_sessions SET metadata = ? WHERE id = ?").run(
    "{}",
    badRead,
  );
  hold();
  hold();
  check(
    "a session that turns waiting during a read error still alerts once the read works again",
    since(n).some((f) => f.text === "alpha-web · Changed meanwhile: needs you"),
    show(since(n)),
  );

  // ---- an alert the relay took but whose handle could not be kept (pc-state.json not written) goes out once
  const unkept = addSession(PROJECT, "Handle not kept", "running");
  hold();
  // The state file is written through this name first: a folder there makes every write fail, reads still work.
  const blocker = path.join(
    home,
    ".phone-app",
    `pc-state.json.${process.pid}.tmp`,
  );
  n = sent.length;
  setStatus(unkept, "waiting_for_input");
  fs.mkdirSync(blocker);
  try {
    for (let i = 0; i < 4; i++) guardedLook();
  } finally {
    fs.rmSync(blocker, { recursive: true, force: true });
  }
  hold();
  check(
    "an alert whose handle could not be kept is sent once and the failure logged (FAIL: the same alert goes out at every look while pc-state.json cannot be written)",
    since(n).filter((f) => f.text === "alpha-web · Handle not kept: needs you")
      .length === 1 && logLines("was not kept") >= 1,
    show({ sent: since(n), logged: logLines("was not kept") }),
  );
} catch (e) {
  failure = e;
} finally {
  fx.close();
  (await import("../skills/phone-bot/pc/core/db.mjs")).closeDb();
}
if (failure) {
  console.log(`FAIL the run stopped: ${failure.stack}`);
  failed++;
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });

// ---- the page's Settings screen: the choices show at once, and a tap marks before the PC answers.
// A DOM and local storage stand-in with what frame/dom.js and settings.js use.
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
const stored = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (stored.has(k) ? stored.get(k) : null),
    setItem: (k, v) => stored.set(k, String(v)),
    removeItem: (k) => stored.delete(k),
  },
});
const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
// The alert choices only: Settings also holds the Text size choices (Small, Default, Large), which are not alerts.
const radios = (root) =>
  walk(root)
    .filter(
      (n) =>
        n.attrs?.role === "radiogroup" && n.attrs["aria-label"] !== "Text size",
    )
    .flatMap((g) => walk(g).filter((n) => n.attrs?.role === "radio"));
const marked = (root) =>
  radios(root)
    .filter((n) => n.attrs["aria-checked"] === "true")
    .map((n) => n.textContent)
    .join();
const tick = () => new Promise((r) => setTimeout(r, 0));

// A stand-in PC whose answers the test releases one by one: held[action] is the list of waiting asks.
function heldPc() {
  const held = {};
  const ask = (a, d) => new Promise((res) => (held[a] ||= []).push({ d, res }));
  const answer = (a, body) => held[a].shift().res(body);
  return {
    held,
    answer,
    ctx: { connected: true, haptic: () => {}, tg: {}, ask },
  };
}
const CHOICES = [
  { kind: "session-needs-you", mode: "buzz" },
  { kind: "session-finished", mode: "silent" },
];

const pageDir = path.join(import.meta.dirname, "..", "phone", "page");
const pageUrl = (rel) => pathToFileURL(path.join(pageDir, rel)).href;
try {
  const screens = await import(pageUrl("frame/screens.js"));
  await import(pageUrl("screens/settings.js"));
  const settings = screens.screen("settings");

  // A first open, nothing kept: the choices draw when alerts.get answers, while pc.status is still held. The
  // screen has no timer, so the hold is the test's own: pc.status answers only when the test releases it.
  const first = heldPc();
  let box = settings.render(first.ctx);
  check("a first open with nothing kept asks the PC", radios(box).length === 0);
  first.answer("alerts.get", { ok: true, d: CHOICES });
  await tick();
  check(
    "a first open draws the choices when alerts.get answers, before pc.status",
    radios(box).length === 6 &&
      marked(box) === "Buzz,Silent" &&
      /asking the PC/.test(box.textContent),
    box.textContent,
  );
  first.answer("pc.status", { ok: true, d: { pcName: "test-pc" } });
  await tick();
  check(
    "pc.status answering later fills in the PC",
    /test-pc/.test(box.textContent),
  );

  // A second open draws the kept choices before any answer, then refreshes behind.
  const second = heldPc();
  box = settings.render(second.ctx);
  check(
    "a second open draws the choices before any answer",
    marked(box) === "Buzz,Silent" && second.held["alerts.get"]?.length === 1,
    box.textContent,
  );
  second.answer("alerts.get", {
    ok: true,
    d: [CHOICES[0], { kind: "session-finished", mode: "off" }],
  });
  await tick();
  check(
    "the refresh behind redraws with the PC's choices",
    marked(box) === "Buzz,Off",
  );

  // The PC's third kind draws as its own row, with the sample line.
  const third = heldPc();
  box = settings.render(third.ctx);
  third.answer("alerts.get", {
    ok: true,
    d: [...CHOICES, { kind: "session-handed-off", mode: "off" }],
  });
  await tick();
  check(
    "Handed off shows as its own choice, off, with its sample line",
    radios(box).length === 9 &&
      marked(box) === "Buzz,Silent,Off" &&
      box.textContent.includes("A session: Handed off") &&
      box.textContent.includes(
        "“my-project · Fix the login page: handed off, continuing”",
      ),
    box.textContent,
  );
  box = settings.render(second.ctx);
  second.answer("alerts.get", {
    ok: true,
    d: [CHOICES[0], { kind: "session-finished", mode: "off" }],
  });
  await tick();

  check(
    "local storage holds the last choices for the next page load",
    JSON.parse(stored.get("settings.alerts"))[1].mode === "off",
  );

  // A tap is marked before the PC answers; a refusal goes back and says why. Radio 4 is Finished: Silent.
  radios(box)[4].click();
  check(
    "a tap is marked before the PC answers",
    marked(box) === "Buzz,Silent" && second.held["alerts.set"]?.length === 1,
    `${marked(box)} ${show(second.held["alerts.set"]?.map((x) => x.d))}`,
  );
  second.answer("alerts.set", { ok: false, err: "busy" });
  await tick();
  check(
    "a refusal goes back and shows Could not change it",
    marked(box) === "Buzz,Off" &&
      /Could not change it: busy/.test(box.textContent),
    box.textContent,
  );
  radios(box)[4].click();
  second.answer("alerts.set", {
    ok: true,
    d: { kind: "session-finished", mode: "silent" },
  });
  await tick();
  check(
    "an accepted tap stays marked and is kept",
    marked(box) === "Buzz,Silent" &&
      !/Could not change it/.test(box.textContent) &&
      JSON.parse(stored.get("settings.alerts"))[1].mode === "silent",
    box.textContent,
  );
} catch (e) {
  console.log(`FAIL the page part stopped: ${e.stack}`);
  failed++;
}
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
