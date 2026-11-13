// node tests/test-session-cleanup.mjs
// The hook runs as a child process with a temp home. Most cases use a made-up process list (SESSION_CLEANUP_TEST_PROCS)
// and only log what they would stop. The last case, on Windows, uses the real process list and taskkill, on two
// node processes this test starts itself: the one started during the call is closed, the one started before is kept.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = path.join(
  import.meta.dirname,
  "..",
  "hooks",
  "session-cleanup.mjs",
);
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "session-cleanup-"));
const STATE = path.join(DIR, ".claude", "hooks", "state", "session-cleanup");
const CLOSED_LOG = path.join(STATE, "closed.log");
const PROCS = path.join(DIR, "procs.json");
const PROJECT = path.join(DIR, "proj");
fs.mkdirSync(PROJECT, { recursive: true });
const ROOT = 1000; // this session's claude.exe in the made-up list
const OLD = Date.now() - 10 * 60 * 1000;
let failed = 0,
  passed = 0;

function check(name, ok) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const waitFor = (fn, ms = 20000) => {
  for (const end = Date.now() + ms; Date.now() < end; sleep(50))
    if (fn()) return true;
  return fn();
};
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : "");
const ledger = (sid) =>
  fs.existsSync(path.join(STATE, `${sid}.json`))
    ? JSON.parse(read(path.join(STATE, `${sid}.json`)))
    : null;
const pids = (sid) => (ledger(sid)?.processes ?? []).map((e) => e.pid);
const kills = () => read(`${PROCS}.kills`).split("\n").filter(Boolean);
const closedLog = () => read(CLOSED_LOG);
const reset = () => {
  for (const f of [STATE, `${PROCS}.kills`, `${PROCS}.calls`])
    fs.rmSync(f, { recursive: true, force: true });
};

function run(event, env = {}) {
  const base = {
    ...process.env,
    HOME: DIR,
    USERPROFILE: DIR,
    SESSION_CLEANUP: "on",
    SESSION_CLEANUP_TEST_PROCS: PROCS,
    CLAUDE_CODE_ENTRYPOINT: "cli",
  };
  delete base.SESSION_CLEANUP_TEST_ROOT;
  const full = { ...base, ...env };
  for (const k of Object.keys(full)) if (full[k] === undefined) delete full[k];
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ cwd: PROJECT, ...event }),
    encoding: "utf8",
    env: full,
  });
  if (r.status !== 0) console.log(r.stderr);
  return r.stdout;
}
// The made-up list: this test process under this session's claude.exe, whose parent is the host; another session's
// claude.exe beside it; the user's inbox bot with its parent gone
const base = (host = "bash.exe") => [
  { pid: 900, ppid: 4, name: host, created: OLD - 2000, cmd: host },
  {
    pid: ROOT,
    ppid: 900,
    name: "claude.exe",
    created: OLD - 1000,
    cmd: "claude",
  },
  {
    pid: 2000,
    ppid: 900,
    name: "claude.exe",
    created: OLD - 1000,
    cmd: "claude",
  },
  {
    pid: process.pid,
    ppid: ROOT,
    name: "node.exe",
    created: OLD,
    cmd: "node test",
  },
  {
    pid: 3000,
    ppid: 77,
    name: "node.exe",
    created: OLD,
    cmd: "node C:/bots/telegram-control/inbox/inbox-bot.mjs",
  },
];
const setProcs = (list) => fs.writeFileSync(PROCS, JSON.stringify(list));
// One Bash call: PreToolUse, then the processes `made(now)` appear, then PostToolUse
let calls = 0;
function launch(
  sid,
  command,
  made = () => [],
  { host, env, tool = "Bash", transcript } = {},
) {
  const id = `toolu_${++calls}`;
  const ev = {
    session_id: sid,
    tool_use_id: id,
    tool_name: tool,
    tool_input: { command },
    transcript_path: transcript,
  };
  setProcs(base(host));
  run({ ...ev, hook_event_name: "PreToolUse" }, env);
  setProcs([...base(host), ...made(Date.now() + 10)]);
  run({ ...ev, hook_event_name: "PostToolUse" }, env);
}
const end = (sid, reason, env) =>
  run({ hook_event_name: "SessionEnd", session_id: sid, reason }, env);
const ended = (sid) =>
  waitFor(
    () =>
      closedLog().includes(`${sid} session end`) &&
      !ledger(sid)?.processes?.length,
  );
const server = (now) => [
  {
    pid: 5000,
    ppid: ROOT,
    name: "bash.exe",
    created: now,
    cmd: "bash -c node server.js",
  },
  {
    pid: 5001,
    ppid: 5000,
    name: "node.exe",
    created: now + 1,
    cmd: "node server.js",
  },
  {
    pid: 4001,
    ppid: ROOT,
    name: "node.exe",
    created: OLD,
    cmd: "node server.js",
  }, // reused: made before the call
  {
    pid: 6001,
    ppid: 2000,
    name: "node.exe",
    created: now,
    cmd: "node server.js",
  }, // another session's, same moment
];

// 1, 2, 5: opened, reused, another session's
reset();
launch("s1", "node server.js > /dev/null 2>&1 &", server);
check(
  "1 a process made during the call under this claude.exe is recorded",
  pids("s1").includes(5001),
);
check(
  "2 a reused server made before the call is not recorded",
  !pids("s1").includes(4001),
);
check(
  "5 a process of another session's claude.exe made at the same moment is not recorded",
  !pids("s1").includes(6001),
);
check("the user's bot is not recorded", !pids("s1").includes(3000));
end("s1", "prompt_input_exit");
ended("s1");
check(
  "1 SessionEnd prompt_input_exit closes it",
  kills().includes("kill 5001"),
);
check(
  "2 the reused server is kept",
  !kills().includes("kill 4001") &&
    !kills().includes("kill 6001") &&
    !kills().includes("kill 3000"),
);
check("the closed ledger is removed", ledger("s1") === null);

// 3: PID reuse
reset();
launch("s3", "npm run dev", (now) => [
  { pid: 5101, ppid: ROOT, name: "node.exe", created: now, cmd: "vite" },
]);
setProcs([
  ...base(),
  {
    pid: 5101,
    ppid: ROOT,
    name: "node.exe",
    created: Date.now() + 99999,
    cmd: "vite",
  },
]);
end("s3", "prompt_input_exit");
ended("s3");
check(
  "3 a PID now made at another time is not closed",
  !kills().includes("kill 5101"),
);
check(
  "3 and its entry is dropped",
  /s3 dropped .*pid 5101/.test(closedLog()) && ledger("s3") === null,
);

// 4: a detached start
reset();
launch(
  "s4",
  'Start-Process llama-server -ArgumentList "-m", "model.gguf"',
  (now) => [
    {
      pid: 5201,
      ppid: 5200,
      name: "llama-server.exe",
      created: now,
      cmd: "llama-server -m model.gguf",
    },
    {
      pid: 5202,
      ppid: 5200,
      name: "python.exe",
      created: now,
      cmd: "python other.py",
    },
  ],
  { tool: "PowerShell" },
);
check(
  "4 a detached start (parent gone, program named) is recorded",
  ledger("s4")?.processes.some((e) => e.pid === 5201 && e.kind === "detached"),
);
check(
  "4 a parentless process the call did not name is not",
  !pids("s4").includes(5202),
);
end("s4", "logout");
ended("s4");
check("4 SessionEnd logout closes it", kills().includes("kill 5201"));

// 4b: a detached npm start: npm's node.exe, its cmd.exe and vite's node.exe, the shell that started npm gone.
// None of them is named npm; npm's command line holds it
reset();
launch("s4n", "npm run dev > /dev/null 2>&1 &", (now) => [
  {
    pid: 5251,
    ppid: 5250,
    name: "node.exe",
    created: now,
    cmd: '"C:\\Program Files\\nodejs\\node.exe" "C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js" run dev',
  },
  {
    pid: 5252,
    ppid: 5251,
    name: "cmd.exe",
    created: now + 1,
    cmd: "C:\\WINDOWS\\system32\\cmd.exe /d /s /c vite",
  },
  {
    pid: 5253,
    ppid: 5252,
    name: "node.exe",
    created: now + 2,
    cmd: 'node "C:\\proj\\node_modules\\vite\\bin\\vite.js"',
  },
  {
    pid: 5254,
    ppid: 5250,
    name: "node.exe",
    created: now,
    cmd: "node C:/tools/other-tool.js",
  },
]);
check(
  "4b a detached npm start records npm's node.exe, its cmd.exe and vite's node.exe",
  [5251, 5252, 5253].every((pid) =>
    ledger("s4n")?.processes.some(
      (e) => e.pid === pid && e.kind === "detached",
    ),
  ),
);
check(
  "4b an unrelated parentless node.exe made at the same moment is not recorded",
  !pids("s4n").includes(5254),
);

// 4d: the setup's Nimbalyst delivery started detached: restart.mjs outlives the session on purpose, and the
// Nimbalyst it starts is not the session's either
reset();
launch(
  "s4d",
  'node "C:/Users/someone/.claude/tools/nimbalyst-patch/restart.mjs" > /dev/null 2>&1 &',
  (now) => [
    {
      pid: 5281,
      ppid: 5280,
      name: "node.exe",
      created: now,
      cmd: 'node "C:/Users/someone/.claude/tools/nimbalyst-patch/restart.mjs"',
    },
    {
      pid: 5282,
      ppid: 5281,
      name: "node.exe",
      created: now + 1,
      cmd: "node C:\\Users\\someone\\.claude\\tools\\nimbalyst-patch\\deliver.mjs",
    },
  ],
);
check(
  "4d a detached restart.mjs of the Nimbalyst delivery, and what it starts, are not recorded",
  !pids("s4d").includes(5281) && !pids("s4d").includes(5282),
);

// 4c: Gradle daemons: one whose new chain breaks at a gone parent is the call's and is closed by its PID, never
// `gradlew --stop` (that stops every daemon of the version); one under an IDE is not recorded
reset();
launch("s4g", "./gradlew build", (now) => [
  {
    pid: 5261,
    ppid: 5260,
    name: "java.exe",
    created: now,
    cmd: "java -cp gradle-launcher.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.5",
  },
  { pid: 5270, ppid: 4, name: "idea64.exe", created: OLD, cmd: "idea64.exe" },
  {
    pid: 5271,
    ppid: 5270,
    name: "java.exe",
    created: now,
    cmd: "java -cp gradle-launcher.jar org.gradle.launcher.daemon.bootstrap.GradleDaemon 8.5",
  },
]);
check(
  "4c a Gradle daemon with its parent gone, made in a gradle call, is recorded",
  ledger("s4g")?.processes.some((e) => e.pid === 5261 && e.kind === "gradle"),
);
check(
  "4c a Gradle daemon an IDE started at the same moment is not",
  !pids("s4g").includes(5271),
);
end("s4g", "logout");
ended("s4g");
check("4c it is closed by its own PID only", kills().join(",") === "kill 5261");

// 6: SessionEnd other, inside Nimbalyst and outside
reset();
launch(
  "s6n",
  "npm run dev",
  (now) => [
    { pid: 5301, ppid: ROOT, name: "node.exe", created: now, cmd: "vite" },
  ],
  { host: "Nimbalyst.exe" },
);
end("s6n", "other", { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" });
waitFor(() => closedLog().includes("s6n session end"));
sleep(300);
check(
  "6 other inside Nimbalyst closes nothing",
  !kills().includes("kill 5301") && pids("s6n").includes(5301),
);
check(
  "6 the end line names the reason, entry point and host",
  /s6n session end: reason other, entry point sdk-cli, host Nimbalyst\.exe/.test(
    closedLog(),
  ),
);
reset();
launch("s6p", "npm run dev", (now) => [
  { pid: 5302, ppid: ROOT, name: "node.exe", created: now, cmd: "vite" },
]);
end("s6p", "other", { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" });
ended("s6p");
check(
  "6 other outside Nimbalyst (claude -p) closes it",
  kills().includes("kill 5302"),
);

// 7: the sweep closes idle ledgers only
reset();
const oldT = path.join(DIR, "old.jsonl"),
  newT = path.join(DIR, "new.jsonl");
for (const t of [oldT, newT]) fs.writeFileSync(t, "{}\n");
const fiveHoursAgo = (Date.now() - 5 * 60 * 60 * 1000) / 1000;
fs.utimesSync(oldT, fiveHoursAgo, fiveHoursAgo);
launch(
  "s7old",
  "npm run dev",
  (now) => [
    { pid: 5401, ppid: ROOT, name: "node.exe", created: now, cmd: "vite" },
  ],
  { transcript: oldT },
);
launch(
  "s7new",
  "npm run dev",
  (now) => [
    { pid: 5402, ppid: ROOT, name: "node.exe", created: now, cmd: "vite" },
  ],
  { transcript: newT },
);
setProcs([
  ...base(),
  {
    pid: 5401,
    ppid: ROOT,
    name: "node.exe",
    created: ledger("s7old").processes[0].created,
    cmd: "vite",
  },
  {
    pid: 5402,
    ppid: ROOT,
    name: "node.exe",
    created: ledger("s7new").processes[0].created,
    cmd: "vite",
  },
]);
run({ hook_event_name: "UserPromptSubmit", session_id: "s7x", prompt: "hi" });
waitFor(() => ledger("s7old") === null);
check(
  "7 the sweep closes a ledger idle past the hours",
  kills().includes("kill 5401"),
);
check(
  "7 and keeps a younger one",
  !kills().includes("kill 5402") && pids("s7new").includes(5402),
);
check(
  "7 the inbox bot in the list is never touched",
  !kills().some((k) => k.endsWith(" 3000")),
);
const sweptAt = read(path.join(STATE, "sweep.json"));
run({ hook_event_name: "SessionStart", session_id: "s7y", source: "startup" });
check(
  "7 a second sweep within 10 minutes does not start",
  read(path.join(STATE, "sweep.json")) === sweptAt,
);

// 8: report mode and off
reset();
launch(
  "s8",
  "npm run dev",
  (now) => [
    { pid: 5501, ppid: ROOT, name: "node.exe", created: now, cmd: "vite" },
  ],
  { env: { SESSION_CLEANUP: undefined } },
);
end("s8", "prompt_input_exit", { SESSION_CLEANUP: "report" });
ended("s8");
check(
  "8 report mode: closed.log names it",
  /s8 would close \(report mode\): pid 5501/.test(closedLog()),
);
check("8 report mode: nothing closed", kills().length === 0);
reset();
launch(
  "s8off",
  "npm run dev",
  (now) => [
    { pid: 5502, ppid: ROOT, name: "node.exe", created: now, cmd: "vite" },
  ],
  { env: { SESSION_CLEANUP: "off" } },
);
check(
  "8 off: no ledger written",
  ledger("s8off") === null && !fs.existsSync(STATE),
);

// 9: worktrees are listed, never removed
reset();
const WT = path.join(DIR, "wt-test");
fs.mkdirSync(WT);
spawnSync("git", ["init", "-q", WT]);
launch("s9", "git worktree add ../wt-test -b w26/t");
check(
  "9 git worktree add is recorded as a worktree",
  ledger("s9")?.worktrees[0]?.path === WT &&
    ledger("s9").worktrees[0].branch === "w26/t",
);
check("9 with no process list", !fs.existsSync(`${PROCS}.calls`));
const shown =
  JSON.parse(
    run({
      hook_event_name: "SessionStart",
      session_id: "s9b",
      source: "startup",
    }) || "{}",
  ).systemMessage ?? "";
check(
  "9 the next SessionStart in the project names it, clean, with the remove command",
  shown.includes(WT) &&
    shown.includes("branch w26/t, clean") &&
    shown.includes(`git worktree remove "${WT}"`),
);
check("9 and the worktree is still there", fs.existsSync(WT));
fs.rmSync(WT, { recursive: true, force: true });
check(
  "9 a removed worktree is not named again",
  run({
    hook_event_name: "SessionStart",
    session_id: "s9c",
    source: "startup",
  }) === "",
);

// 10: a call that starts nothing takes no process list
reset();
launch("s10", "ls -la");
check(
  "10 a non-launch call (ls) takes no process list",
  !fs.existsSync(`${PROCS}.calls`) && ledger("s10") === null,
);

// The real run: real process list and taskkill, on this test's own two node processes
if (process.platform === "win32") {
  reset();
  const idle = ["-e", "setInterval(() => {}, 1000)"];
  const alive = (pid) => {
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  };
  const real = {
    SESSION_CLEANUP_TEST_PROCS: undefined,
    SESSION_CLEANUP_TEST_ROOT: String(process.pid),
    SESSION_CLEANUP: "on",
  };
  const before = spawn(process.execPath, idle, { stdio: "ignore" });
  sleep(300);
  const ev = {
    session_id: "real",
    tool_use_id: "toolu_real",
    tool_name: "Bash",
    tool_input: { command: '"$SC_TEST_SERVER" > /dev/null 2>&1 &' },
  };
  run({ ...ev, hook_event_name: "PreToolUse" }, real);
  const opened = spawn(process.execPath, idle, { stdio: "ignore" });
  sleep(500);
  run({ ...ev, hook_event_name: "PostToolUse" }, real);
  const got = pids("real");
  // never let the closer near a process this test did not start
  const onlyOurs = got.length === 1 && got[0] === opened.pid;
  check(
    `real: the process started during the call is recorded, the one before is not (ledger: ${got.join(", ") || "none"})`,
    onlyOurs,
  );
  if (onlyOurs) {
    end("real", "prompt_input_exit", real);
    ended("real");
    check(
      "real: at SessionEnd the process the session opened is closed",
      waitFor(() => !alive(opened.pid), 10000),
    );
    check("real: the reused process is kept", alive(before.pid));
  } else fs.rmSync(path.join(STATE, "real.json"), { force: true });
  for (const p of [before, opened]) if (alive(p.pid)) p.kill();
}

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
