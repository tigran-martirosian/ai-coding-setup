// The dispatcher (spec docs/2026-11-20-hooks-cut-spec.md D9, D10, D14): hooks/dispatch.mjs <group> runs a group of
// hooks/dispatch-groups.json in one Node process. DISPATCH_GROUPS=<file> points it at another groups file.
//   D9: fixture groups (a guard that throws, one that runs out of time, a non-guard that throws, two answers,
//       a hook that calls process.exit, download-guard's rewrite going on to command-explain).
//   D10: one canary per guard sent through the exact commands settings.example.json wires, read together with
//       hooks/dispatch-groups.json; every wired script exists.
//   D14: the guards are wired with onFailure "block" and fail closed.
// The fixture runs a copy of hooks/ in a temp folder, so the fixture hooks sit beside the real ones.
// Run: node tests/test-dispatch.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeChecker, tmpHome } from "./lib/kit.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const fwd = (p) => p.replace(/\\/g, "/");
const { check, summary } = makeChecker();
const GUARDS = [
  "delete-guard",
  "find-guard",
  "push-key-scan",
  "opencli-readonly",
  "sql-guard",
  "workflow-fence",
];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "dispatch-test-"));
const home = tmpHome("dispatch-home-");

// Runs a command line (shell) or a node script with a JSON event on stdin; { stdout, stderr, status, ms }
function run(command, event, { env = {}, timeoutMs = 60000, cwd } = {}) {
  return new Promise((done) => {
    const t = Date.now();
    const p = spawn(command, {
      shell: true,
      cwd,
      env: {
        ...process.env,
        HOME: home.dir,
        USERPROFILE: home.dir,
        HOOK_ERRORS_LOG: "off",
        ...env,
      },
    });
    let stdout = "",
      stderr = "",
      killed = false;
    const timer = setTimeout(() => {
      killed = true;
      p.kill();
    }, timeoutMs);
    p.stdout.on("data", (d) => (stdout += d));
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => {
      clearTimeout(timer);
      done({
        stdout,
        stderr,
        status: killed ? "killed" : status,
        ms: Date.now() - t,
      });
    });
    p.stdin.on("error", () => {}); // a hook that ends before reading all of stdin
    p.stdin.end(typeof event === "string" ? event : JSON.stringify(event));
  });
}
const parse = (s) => {
  if (!s.trim()) return {};
  try {
    return JSON.parse(s);
  } catch {
    return { unreadable: s };
  }
};
// What Claude Code does with one hook's result: stopped (deny, ask, block, exit 2, or a failure of an entry with
// onFailure "block"), and the reason
function verdict(r, onFailure) {
  const o = parse(r.stdout);
  const d = o.hookSpecificOutput?.permissionDecision;
  const reason = `${o.hookSpecificOutput?.permissionDecisionReason ?? ""}${o.reason ?? ""}`;
  if (d === "deny" || d === "ask" || o.decision === "block")
    return { stopped: d || "block", reason, o };
  if (r.status === 2) return { stopped: "exit 2", reason: r.stderr, o };
  if (r.status !== 0 && onFailure === "block")
    return { stopped: `failed (${r.status})`, reason: r.stderr, o };
  return { stopped: false, reason, o };
}
const show = (r) =>
  `exit ${r.status}, ${r.ms} ms, stdout ${r.stdout.slice(0, 300)} stderr ${r.stderr.slice(0, 300)}`;

// ---- D9: the fixture groups
const claude = path.join(tmp, "claude");
fs.cpSync(path.join(REPO, "hooks"), path.join(claude, "hooks"), {
  recursive: true,
});
const DISPATCH = path.join(claude, "hooks", "dispatch.mjs");
check(
  "hooks/dispatch.mjs exists",
  fs.existsSync(path.join(REPO, "hooks", "dispatch.mjs")),
  "missing: every case below runs it",
);
const FX = {
  "fx-throw-guard": `runHook("fx-throw-guard", () => { throw new Error("fx-throw-guard boom"); }, { failClosed: true });`,
  "fx-import-throw": `throw new Error("fx-import-throw boom");`,
  "fx-slow-guard": `runHook("fx-slow-guard", () => new Promise((r) => setTimeout(r, 120000)), { failClosed: true });`,
  "fx-throw-plain": `runHook("fx-throw-plain", () => { throw new Error("fx-throw-plain boom"); });`,
  "fx-ctx": `runHook("fx-ctx", (e) => emit.context("PreToolUse", "fx-ctx saw: " + e.tool_input?.command));`,
  "fx-allow": `runHook("fx-allow", () => { process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow", permissionDecisionReason: "fx-allow says yes" } })); });`,
  "fx-deny": `runHook("fx-deny", () => emit.deny("fx-deny says no"));`,
  "fx-exit-in": `runHook("fx-exit-in", () => { process.exit(0); });`,
  "fx-exit-top": `process.exit(0);`,
  // ends at once, and 100 ms later a timer of its own sets an exit code: by then another hook is running
  "fx-late": `setTimeout(() => runHook("fx-late", () => 1), 100);`,
  "fx-wait-guard": `runHook("fx-wait-guard", () => new Promise((r) => setTimeout(r, 500)), { failClosed: true });`,
  "fx-slow-1": `runHook("fx-slow-1", () => new Promise((r) => setTimeout(r, 120000)));`,
  "fx-slow-2": `runHook("fx-slow-2", () => new Promise((r) => setTimeout(r, 120000)));`,
  "fx-slow-3": `runHook("fx-slow-3", () => new Promise((r) => setTimeout(r, 120000)));`,
  // ends at once and leaves work that finishes 300 ms later (as fetch's socket is still closing after a HEAD), and
  // that sets an exit code of the whole process
  "fx-linger": `import fs from "node:fs";\nsetTimeout(() => { fs.writeFileSync(process.env.FX_MARK, "done"); process.exitCode = 3; }, 300);\nrunHook("fx-linger", () => {});`,
  // ends at once and leaves a timer of two minutes
  "fx-hold": `setTimeout(() => {}, 120000);\nrunHook("fx-hold", () => {});`,
};
for (const [n, body] of Object.entries(FX))
  fs.writeFileSync(
    path.join(claude, "hooks", `${n}.mjs`),
    `import { emit, runHook } from "./lib/hook-io.mjs";\n${body}\n`,
  );
const h = (n, extra = {}) => ({
  hook: `hooks/${n}.mjs`,
  args: [],
  guard: false,
  ...extra,
});
const FIXTURE = {
  "guard-throws": [h("fx-throw-guard", { guard: true }), h("fx-ctx")],
  "guard-import-throws": [h("fx-import-throw", { guard: true })],
  "guard-slow": [h("fx-slow-guard", { guard: true })],
  "guard-missing": [h("fx-missing", { guard: true })],
  "plain-throws": [h("fx-throw-plain"), h("fx-import-throw"), h("fx-ctx")],
  "allow-then-deny": [h("fx-allow"), h("fx-deny")],
  "deny-then-allow": [h("fx-deny"), h("fx-allow")],
  exits: [h("fx-exit-in"), h("fx-exit-top"), h("fx-ctx")],
  tools: [
    h("fx-deny", { tools: "Read" }),
    h("fx-ctx", { tools: "Bash|PowerShell" }),
  ],
  download: [h("download-guard"), h("command-explain"), h("fx-ctx")],
  "late-code": [h("fx-late"), h("fx-wait-guard", { guard: true }), h("fx-ctx")],
  "group-deadline": [
    h("fx-slow-1"),
    h("fx-slow-2"),
    h("fx-slow-3"),
    h("fx-wait-guard", { guard: true }),
  ],
  "deny-bad-tools": [
    h("fx-deny", { guard: true }),
    h("fx-ctx", { tools: "(" }),
  ],
  "deny-no-hook": [h("fx-deny", { guard: true }), { args: [], guard: false }],
  "one-file-twice": [
    h("fx-ctx"),
    h("fx-ctx"),
    h("fx-wait-guard", { guard: true }),
  ],
  "shell-guard": [
    h("fx-deny", { guard: true, tools: "Bash|PowerShell" }),
    h("fx-ctx"),
  ],
  linger: [h("fx-linger"), h("fx-ctx")],
  hold: [h("fx-hold"), h("fx-ctx")],
};
const groupsFile = path.join(tmp, "groups.json");
fs.writeFileSync(groupsFile, JSON.stringify(FIXTURE, null, 2));
const ECHO = "echo hi\n\n# WHAT THIS DOES: prints hi";
const bashEvent = (command) => ({
  session_id: "t",
  hook_event_name: "PreToolUse",
  cwd: tmp,
  tool_name: "Bash",
  tool_input: { command },
});
// The pre-tool entry has onFailure "block" (D9: synchronous work is bounded by the entry's timeout), so the
// fixture runs are judged as such an entry's
const seen = [];
const group = async (name, command = ECHO, timeoutMs = 60000) => {
  const r = await run(`node "${fwd(DISPATCH)}" ${name}`, bashEvent(command), {
    env: { DISPATCH_GROUPS: groupsFile },
    timeoutMs,
  });
  seen.push([name, r]);
  return r;
};
// Any event, any dispatch.mjs, any groups file
const groupWith = async (
  name,
  event,
  { dispatch = DISPATCH, env = {} } = {},
) => {
  const r = await run(`node "${fwd(dispatch)}" ${name}`, event, {
    env: { DISPATCH_GROUPS: groupsFile, ...env },
  });
  seen.push([name, r]);
  return r;
};
const readEvent = {
  session_id: "t",
  hook_event_name: "PreToolUse",
  cwd: tmp,
  tool_name: "Read",
  tool_input: { file_path: "a.txt" },
};
// Claude Code reads the JSON only on exit 0: a deny there, its reason holding `text`
const denied = (r, text) => {
  const o = parse(r.stdout).hookSpecificOutput ?? {};
  return (
    r.status === 0 &&
    o.permissionDecision === "deny" &&
    String(o.permissionDecisionReason).includes(text)
  );
};
const passed = (r) => r.status === 0 && !verdict(r, "block").stopped;
const ctx = (r) =>
  String(parse(r.stdout).hookSpecificOutput?.additionalContext ?? "");

// A block that names the failed guard: a dispatcher that cannot start at all fails too, but names no guard
const blockedBy = (r, guard) =>
  r.status !== "killed" &&
  verdict(r, "block").stopped &&
  `${r.stdout}${r.stderr}`.includes(guard);
for (const [name, guard] of [
  ["guard-throws", "fx-throw-guard"],
  ["guard-import-throws", "fx-import-throw"],
  ["guard-missing", "fx-missing"],
]) {
  const r = await group(name);
  check(
    `D9 ${name}: the guard's failure blocks the call and names ${guard}`,
    blockedBy(r, guard),
    show(r),
  );
}
// The group's whole time stays under the pre-tool entry's 60 s: three slow non-guards and then a guard. It runs
// beside the cases below, as it takes most of a minute.
const deadline = group("group-deadline", ECHO, 60000);
{
  const r = await group("guard-slow", ECHO, 45000);
  check(
    "D9 guard-slow: an async guard that runs out of time blocks the call, before the 120 s it would take",
    blockedBy(r, "fx-slow-guard"),
    show(r),
  );
}
{
  const r = await group("plain-throws");
  check(
    "D9 plain-throws: a non-guard that throws lets the call through, and the hooks after it still run",
    r.status === 0 &&
      !verdict(r, "block").stopped &&
      ctx(r).includes("fx-ctx saw"),
    show(r),
  );
}
for (const name of ["allow-then-deny", "deny-then-allow"]) {
  const r = await group(name);
  const v = verdict(r, "block");
  check(
    `D9 ${name}: when two hooks answer, the block wins`,
    v.stopped === "deny" && v.reason.includes("fx-deny says no"),
    show(r),
  );
}
{
  const r = await group("exits");
  check(
    "D9 exits: a hook that calls process.exit (inside runHook or at the top) does not cut off the hooks after it",
    r.status === 0 && ctx(r).includes("fx-ctx saw"),
    show(r),
  );
}
{
  const r = await group("tools");
  check(
    "D9 tools: a hook runs only for the tools its entry names",
    r.status === 0 &&
      !verdict(r, "block").stopped &&
      ctx(r).includes("fx-ctx saw"),
    show(r),
  );
}
{
  // A "big" file: a local server answers the HEAD request with 60 MB
  const server = http
    .createServer((q, s) => {
      s.writeHead(200, { "Content-Length": String(60e6) });
      s.end();
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/big.bin`;
  const r = await group("download", `curl -L -o big.bin ${url}`);
  server.close();
  const o = parse(r.stdout).hookSpecificOutput ?? {};
  const command = String(o.updatedInput?.command ?? "");
  check(
    "D9 download: download-guard's rewrite reaches command-explain (one rewrite, one note line) and the hooks after",
    command.includes("workers/download.mjs") &&
      (command.match(/# WHAT THIS DOES:/g) ?? []).length === 1 &&
      ctx(r).includes("workers/download.mjs"),
    show(r),
  );
}
{
  const r = await group("late-code");
  check(
    "D9 late-code: an exit code set by a hook's leftover timer is not charged to the guard running then",
    passed(r) && ctx(r).includes("fx-ctx saw"),
    show(r),
  );
}
{
  // The end: process.exit while Node still closes something a hook used (fetch's socket just after a HEAD to
  // raw.githubusercontent.com) aborts Node on Windows with "Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)"
  // (nodejs/node#56645), and the pre-tool entry's onFailure "block" stops the call. So the dispatcher lets the work
  // a hook left finish, and still ends soon when a hook left a long timer.
  const mark = path.join(tmp, "linger-mark.txt");
  const r = await run(`node "${fwd(DISPATCH)}" linger`, bashEvent(ECHO), {
    env: { DISPATCH_GROUPS: groupsFile, FX_MARK: mark },
  });
  seen.push(["linger", r]);
  // well under the dispatcher's 1 s fallback: the process ended by itself once the work was done
  check(
    "D9 linger: the dispatcher ends by letting a hook's leftover work finish (on its own, under 900 ms), not by process.exit in the middle of it, and the exit code that work sets is not the dispatcher's",
    passed(r) &&
      ctx(r).includes("fx-ctx saw") &&
      fs.existsSync(mark) &&
      r.ms < 900,
    `${show(r)}; leftover work ${fs.existsSync(mark) ? "finished" : "cut off"}`,
  );
  const held = await group("hold", ECHO, 30000);
  check(
    "D9 hold: a two-minute timer a hook left does not hold the call (it ends within 5 s, passing)",
    passed(held) && ctx(held).includes("fx-ctx saw") && held.ms < 5000,
    show(held),
  );
}
// A failure of the dispatcher itself (not of a hook) keeps the refusal it already has, or refuses for a guard's tool
for (const [name, why] of [
  ["deny-bad-tools", "an entry whose tools is no regex"],
  ["deny-no-hook", "an entry without hook"],
  ["one-file-twice", "one file listed twice"],
]) {
  const r = await group(name);
  check(
    `D9 ${name}: ${why} in the group ends in a deny, never in a pass`,
    denied(r, "dispatch"),
    show(r),
  );
}
{
  // stdout closed before the answer is written: the refusal goes out as exit 2 with its reason on stderr
  const r = await new Promise((done) => {
    const p = spawn(`node "${fwd(DISPATCH)}" deny-then-allow`, {
      shell: true,
      env: {
        ...process.env,
        HOME: home.dir,
        USERPROFILE: home.dir,
        HOOK_ERRORS_LOG: "off",
        DISPATCH_GROUPS: groupsFile,
      },
    });
    p.stdout.destroy();
    let stderr = "";
    p.stderr.on("data", (d) => (stderr += d));
    p.on("close", (status) => done({ status, stderr }));
    p.stdin.on("error", () => {});
    p.stdin.end(JSON.stringify(bashEvent(ECHO)));
  });
  check(
    "D9 a failed write of the answer turns a deny into exit 2 with the reason on stderr",
    r.status === 2 && r.stderr.includes("fx-deny says no"),
    `exit ${r.status}, stderr ${r.stderr.slice(0, 300)}`,
  );
}
{
  const r = await run(`node "${fwd(DISPATCH)}" guard-throws`, bashEvent(ECHO), {
    env: { DISPATCH_GROUPS: groupsFile, DISPATCH: "Off" },
  });
  check(
    "D9 DISPATCH=off (any case): the dispatcher ends at once, silent, and runs no hook",
    r.status === 0 && r.stdout === "",
    show(r),
  );
}
{
  // A dispatcher that cannot start: the groups file is missing, unreadable or lacks the group, or hook-io.mjs is
  // an older copy without the dispatcher's exports. It refuses only a tool one of the group's guards covers.
  const old = path.join(tmp, "claude-old");
  fs.cpSync(claude, old, { recursive: true });
  const io = path.join(old, "hooks", "lib", "hook-io.mjs");
  fs.writeFileSync(
    io,
    fs
      .readFileSync(io, "utf8")
      .replace("export const dispatch =", "const notDispatch =")
      .replace("export class HookExit", "class HookExit"),
  );
  const broken = path.join(tmp, "broken.json");
  fs.writeFileSync(broken, "{ not json");
  for (const [what, opts, name] of [
    [
      "an older hook-io.mjs",
      { dispatch: path.join(old, "hooks", "dispatch.mjs") },
      "shell-guard",
    ],
    [
      "a missing groups file",
      { env: { DISPATCH_GROUPS: path.join(tmp, "none.json") } },
      "pre-tool",
    ],
    [
      "a groups file that is not JSON",
      { env: { DISPATCH_GROUPS: broken } },
      "pre-tool",
    ],
  ]) {
    const read = await groupWith(name, readEvent, opts);
    check(
      `D9 ${what}: a Read call, which no guard covers, goes through`,
      passed(read),
      show(read),
    );
    const bash = await groupWith(name, bashEvent(ECHO), opts);
    check(
      `D9 ${what}: a Bash call is denied, naming the dispatcher`,
      denied(bash, "dispatch"),
      show(bash),
    );
  }
  const none = await groupWith("no-such-group", readEvent);
  check(
    "D9 a group the file lacks: a Read call goes through",
    passed(none),
    show(none),
  );
}
{
  const r = await deadline;
  check(
    "D9 group-deadline: a group whose hooks together run long ends well before the entry's 60 s and blocks for the guard it could not run",
    r.status !== "killed" &&
      r.ms < 55000 &&
      verdict(r, "block").stopped &&
      `${r.stdout}${r.stderr}`.includes("fx-wait-guard"),
    show(r),
  );
}
// Claude Code reads one JSON object on stdout; two written one after the other is unreadable
const unreadable = seen.filter(
  ([, r]) => parse(r.stdout).unreadable !== undefined,
);
check(
  "D9 every fixture run writes at most one JSON object on stdout",
  unreadable.length === 0,
  unreadable.map(([n, r]) => `${n}: ${show(r)}`).join("\n     "),
);

// ---- D10, D14: the example as wired, read together with hooks/dispatch-groups.json
const example = JSON.parse(
  fs.readFileSync(path.join(REPO, "settings.example.json"), "utf8"),
);
const groupsPath = path.join(REPO, "hooks", "dispatch-groups.json");
const groups = fs.existsSync(groupsPath)
  ? JSON.parse(fs.readFileSync(groupsPath, "utf8"))
  : null;
// Every entry: { event, matcher, entry (the settings hook), script, args, hooks: [{ script, args, guard, tools }] }
const entries = [];
for (const [event, list] of Object.entries(example.hooks))
  for (const g of list)
    for (const e of g.hooks) {
      const m = e.command.match(
        /^node ~\/\.claude\/(\S+\.mjs)((?:\s+\S+)*)\s*$/,
      );
      if (!m)
        throw new Error(
          `an example command not in the form node ~/.claude/<script>: ${e.command}`,
        );
      const args = m[2].trim() ? m[2].trim().split(/\s+/) : [];
      const inGroup =
        m[1] === "hooks/dispatch.mjs" ? (groups?.[args[0]] ?? []) : null;
      entries.push({
        event,
        matcher: g.matcher,
        entry: e,
        script: m[1],
        args,
        hooks: inGroup
          ? inGroup.map((x) => ({
              script: x.hook,
              args: x.args ?? [],
              guard: x.guard,
              tools: x.tools,
            }))
          : [{ script: m[1], args }],
      });
    }
const scripts = [
  ...new Set(
    entries.flatMap((e) => [e.script, ...e.hooks.map((x) => x.script)]),
  ),
];
const missing = scripts.filter((s) => !fs.existsSync(path.join(REPO, s)));
check(
  "D10 every script the example wires (groups included) exists",
  missing.length === 0,
  `missing: ${missing.join(", ")}`,
);

// Claude Code's matcher: none, "" or "*" is every tool, else a regex of tool names. An `if` is Tool(glob of the command).
const matches = (matcher, tool) =>
  !matcher || matcher === "*" || new RegExp(`^(?:${matcher})$`).test(tool);
const ifMatches = (cond, tool, command) => {
  if (!cond) return true;
  const m = cond.match(/^(\w+)\((.*)\)$/s);
  if (!m) throw new Error(`an if the test can't read: ${cond}`);
  const glob = new RegExp(
    `^${m[2].replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
    "s",
  );
  return m[1] === tool && glob.test(command);
};
// A PreToolUse call through every entry the example starts for it, as Claude Code runs them
async function throughExample(event, env = {}) {
  const started = entries.filter(
    (e) =>
      e.event === "PreToolUse" &&
      matches(e.matcher, event.tool_name) &&
      ifMatches(e.entry.if, event.tool_name, event.tool_input.command),
  );
  const results = [];
  for (const e of started) {
    const command = e.entry.command
      .replace("~/.claude/", `"${fwd(REPO)}/`)
      .replace(/\.mjs(?=\s|$)/, '.mjs"');
    const r = await run(
      command,
      { session_id: "t", hook_event_name: "PreToolUse", ...event },
      {
        env,
        timeoutMs: (e.entry.timeout ?? 60) * 1000,
      },
    );
    results.push({ e, r, v: verdict(r, e.entry.onFailure) });
  }
  return results;
}

// A fake opencli whose help marks `like` as a write (as tests/test-opencli-readonly.mjs does)
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(
  path.join(bin, "fake.mjs"),
  `const [site, flag] = process.argv.slice(2);
if (flag !== "--help" || site !== "twitter") process.exit(1);
console.log("Commands:\\n  like <url>                          [write] Like a post\\n  search <query>                      [read] Search posts");
`,
);
fs.writeFileSync(
  path.join(bin, "opencli.cmd"),
  `@"${process.execPath}" "%~dp0fake.mjs" %*\r\n`,
);
fs.writeFileSync(
  path.join(bin, "opencli"),
  `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/fake.mjs" "$@"\n`,
);
fs.chmodSync(path.join(bin, "opencli"), 0o755);
const withBin = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(([k]) => k.toUpperCase() !== "PATH"),
  ),
  PATH: bin + path.delimiter + process.env.PATH,
};
// A repo with an unpushed commit holding a GitHub-token-shaped string (as tests/test-push-key-scan.mjs does)
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${a.join(" ")} failed in ${cwd}: ${r.stderr}`);
};
const pushRepo = path.join(tmp, "push"),
  remote = path.join(tmp, "push.git");
fs.mkdirSync(pushRepo);
git(tmp, "init", "-q", "--bare", remote);
git(pushRepo, "init", "-q", "-b", "main");
for (const [k, v] of [
  ["user.email", "t@t"],
  ["user.name", "t"],
  ["commit.gpgsign", "false"],
])
  git(pushRepo, "config", k, v);
fs.writeFileSync(path.join(pushRepo, "README.md"), "hello\n");
git(pushRepo, "add", "-A");
git(pushRepo, "commit", "-qm", "base");
git(pushRepo, "remote", "add", "origin", remote);
git(pushRepo, "push", "-q", "-u", "origin", "main");
const GH = "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
fs.writeFileSync(path.join(pushRepo, "config.js"), `const token = "${GH}";\n`);
git(pushRepo, "add", "-A");
git(pushRepo, "commit", "-qm", "work");

const note = (c) =>
  `${c}\n\n# WHAT THIS DOES: a canary call the guard must stop`;
const CANARIES = {
  "delete-guard": {
    cwd: "C:\\Projects\\demo",
    tool_name: "Bash",
    tool_input: { command: note("rm -rf C:/Users/you/Documents/old") },
  },
  "find-guard": {
    cwd: tmp,
    tool_name: "Bash",
    tool_input: { command: note("find / -name foo") },
  },
  "sql-guard": {
    cwd: tmp,
    tool_name: "Bash",
    tool_input: { command: note('sqlite3 app.db "DROP TABLE users"') },
  },
  "push-key-scan": {
    cwd: pushRepo,
    tool_name: "Bash",
    tool_input: { command: note("git push") },
  },
  "opencli-readonly": {
    cwd: tmp,
    tool_name: "Bash",
    tool_input: {
      command: note("opencli twitter like https://x.com/a/status/1"),
    },
  },
  "workflow-fence": {
    cwd: tmp,
    tool_name: "Workflow",
    tool_input: { name: "deep-research", args: "a canary question" },
  },
};
// workflow-fence refuses only in an app or headless run (entry point sdk-*)
const CANARY_ENV = {
  "opencli-readonly": withBin,
  "workflow-fence": { CLAUDE_CODE_ENTRYPOINT: "sdk-cli", WORKFLOW_FENCE: "" },
};
for (const [guard, event] of Object.entries(CANARIES)) {
  const results = await throughExample(event, CANARY_ENV[guard] ?? {});
  const by = results.find((x) => x.v.stopped && x.v.reason.includes(guard));
  check(
    `D10 canary: ${guard} stops a bad call sent through the example's wiring`,
    Boolean(by),
    results
      .filter((x) => x.v.stopped || x.r.status !== 0)
      .map(
        (x) => `${x.e.entry.command}: ${x.v.stopped || "passed"} ${show(x.r)}`,
      )
      .join("\n     ") || `${results.length} entries ran, none stopped it`,
  );
  // job 9 D9: push-key-scan moved into the pre-tool dispatcher (it also sees deploy commands), so the dispatcher
  // entry is what stops the bad push, and no standalone push-key-scan entry runs
  if (guard === "push-key-scan")
    check(
      "job 9 D9 canary: the pre-tool dispatcher stops the bad push, and no standalone push-key-scan entry ran",
      results.some(
        (x) =>
          x.e.script === "hooks/dispatch.mjs" &&
          x.v.stopped &&
          x.v.reason.includes(guard),
      ) && !results.some((x) => x.e.script === "hooks/push-key-scan.mjs"),
      results
        .map((x) => `${x.e.entry.command}: ${x.v.stopped || "passed"}`)
        .join("\n     "),
    );
}
// job 9 D9: push-key-scan is a guard of the pre-tool group, for the shell tools, and has no entry of its own
{
  const member = (groups?.["pre-tool"] ?? []).find(
    (e) => e.hook === "hooks/push-key-scan.mjs",
  );
  check(
    'job 9 D9 push-key-scan is in the "pre-tool" group with "guard": true and tools Bash|PowerShell',
    member?.guard === true && member.tools === "Bash|PowerShell",
    JSON.stringify(member ?? "not in the group"),
  );
  const own = entries.filter((e) =>
    e.entry.command.includes("push-key-scan.mjs"),
  );
  check(
    "job 9 D9 settings.example.json holds no push-key-scan.mjs command",
    own.length === 0,
    own
      .map((e) => `${e.event} ${e.entry.if ?? ""} ${e.entry.command}`)
      .join("; "),
  );
}

// ---- D14: each guard's wiring blocks on failure, and the guard itself fails closed
for (const guard of GUARDS) {
  const wiredBy = entries.filter(
    (e) =>
      e.event === "PreToolUse" &&
      e.hooks.some((x) => path.basename(x.script, ".mjs") === guard),
  );
  const bad = wiredBy.filter(
    (e) =>
      e.entry.onFailure !== "block" ||
      (e.script === "hooks/dispatch.mjs" &&
        !e.hooks.find((x) => path.basename(x.script, ".mjs") === guard).guard),
  );
  check(
    `D14 ${guard}: every entry that runs it has onFailure "block" (in a group: guard true)`,
    wiredBy.length > 0 && bad.length === 0,
    wiredBy.length
      ? bad
          .map((e) => `${e.entry.command} onFailure ${e.entry.onFailure}`)
          .join("; ")
      : "not wired",
  );
  const r = spawnSync(
    process.execPath,
    [path.join(REPO, "hooks", `${guard}.mjs`)],
    {
      input: "not json",
      encoding: "utf8",
      env: { ...process.env, HOOK_ERRORS_LOG: "off" },
    },
  );
  check(
    `D14 ${guard} fails closed: bad input ends with an error exit`,
    r.status !== 0 && r.status !== null,
    `exit ${r.status}`,
  );
}
const preTool = entries.find(
  (e) => e.script === "hooks/dispatch.mjs" && e.args[0] === "pre-tool",
);
check(
  'D9 the pre-tool entry has onFailure "block" and its own timeout',
  preTool?.entry.onFailure === "block" && preTool.entry.timeout > 0,
  JSON.stringify(preTool?.entry ?? "no pre-tool entry"),
);

// ---- job 5 D4: in auto mode (permission_mode "auto") no hook of the real pre-tool group answers with updatedInput,
// which would void Nimbalyst's classifier review; each note comes as additionalContext. map-brief is added for the
// Agent call while the group does not list it (job 6 wires it there).
// map-brief acts only during its trial (memory-and-map spec D4): the trial file is set in the test home for every
// map-brief case below, and MAP_BRIEF_ARM=map fixes the arm that gives the map lines.
fs.mkdirSync(path.join(home.dir, ".claude", "state"), { recursive: true });
fs.writeFileSync(
  path.join(home.dir, ".claude", "state", "map-brief-trial.json"),
  JSON.stringify({
    until: new Date(Date.now() + 14 * 864e5).toISOString().slice(0, 10),
  }),
);
{
  const server = http
    .createServer((q, s) => {
      s.writeHead(200, { "Content-Length": String(60e6) });
      s.end();
    })
    .listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const url = `http://127.0.0.1:${server.address().port}/big.bin`;
  const pre = groups?.["pre-tool"] ?? [];
  const autoGroups = path.join(tmp, "auto-groups.json");
  fs.writeFileSync(
    autoGroups,
    JSON.stringify({
      "pre-tool": pre.some((e) => e.hook === "hooks/map-brief.mjs")
        ? pre
        : [
            ...pre,
            {
              hook: "hooks/map-brief.mjs",
              args: [],
              guard: false,
              tools: "Agent|Task",
            },
          ],
    }),
  );
  // a project with a systems map, so map-brief has lines to give
  const project = path.join(tmp, "auto-project");
  fs.mkdirSync(path.join(project, ".claude"), { recursive: true });
  fs.mkdirSync(path.join(project, "src"));
  fs.writeFileSync(path.join(project, "src", "invoice.js"), "x");
  fs.writeFileSync(
    path.join(project, ".claude", "systems-map.json"),
    JSON.stringify({
      // a rule, since --brief (job 6) prints only things with rules or links
      nodes: [
        {
          id: "billing",
          name: "Invoice billing",
          what: "Issues the invoice.",
          files: ["src/invoice.js"],
          rules: ["Never round an invoice total before tax."],
        },
      ],
      links: [],
    }),
  );
  const realDispatch = `node "${fwd(path.join(REPO, "hooks", "dispatch.mjs"))}" pre-tool`;
  const env = {
    DISPATCH_GROUPS: autoGroups,
    CLAUDE_PROJECT_DIR: project,
    MAP_BRIEF_ARM: "map",
  };
  const agentEvent = {
    session_id: "t",
    hook_event_name: "PreToolUse",
    cwd: project,
    tool_name: "Agent",
    tool_input: {
      description: "Test: x",
      prompt: "Fix src/invoice.js.",
      subagent_type: "worker",
    },
  };
  for (const [what, event, note] of [
    ["Bash with no note", bashEvent("echo hi"), "command-explain:"],
    [
      "Bash with a big curl",
      bashEvent(`curl -L -o big.bin ${url}`),
      "[download-guard]",
    ],
    ["an Agent call", agentEvent, "SYSTEMS MAP:"],
  ]) {
    const r = await run(
      realDispatch,
      { ...event, permission_mode: "auto" },
      { env },
    );
    const o = parse(r.stdout).hookSpecificOutput ?? {};
    check(
      `D4 auto: ${what} through the pre-tool group gets no updatedInput, and its note in additionalContext`,
      passed(r) && !("updatedInput" in o) && ctx(r).includes(note),
      show(r),
    );
  }
  // the same Agent call outside auto is rewritten, so the case above proves the auto rule, not a missing map
  const r = await run(realDispatch, agentEvent, { env });
  check(
    "D4 the same Agent call outside auto gets the map lines through updatedInput",
    String(
      parse(r.stdout).hookSpecificOutput?.updatedInput?.prompt ?? "",
    ).includes("SYSTEMS MAP:"),
    show(r),
  );
  server.close();
}

// ---- the map hooks through the example's wiring (plan 2.10: both come back through the dispatcher)
// map-brief: a worker's Agent call in a project with a map, in the map arm of the trial set above.
const mapped = path.join(tmp, "mapped");
fs.mkdirSync(path.join(mapped, "src", "auth"), { recursive: true });
fs.mkdirSync(path.join(mapped, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(mapped, "src", "auth", "login.js"),
  "export const login = 1;\n",
);
fs.writeFileSync(
  path.join(mapped, ".claude", "systems-map.json"),
  JSON.stringify({
    nodes: [
      {
        id: "auth",
        name: "User login",
        what: "Signs a user in.",
        files: ["src/auth/login.js"],
        rules: ["Login never stores the password in plain text."],
      },
    ],
    links: [],
  }),
);
const brief = "Fix the bug in src/auth/login.js.";
const agentCall = {
  cwd: mapped,
  tool_name: "Agent",
  tool_input: {
    description: "Fix: login",
    prompt: brief,
    subagent_type: "worker",
    run_in_background: false,
  },
};
const agentRuns = await throughExample(agentCall, {
  CLAUDE_PROJECT_DIR: mapped,
  MAP_BRIEF_ARM: "map",
});
const rewrites = agentRuns.filter(
  (x) => x.v.o.hookSpecificOutput?.updatedInput,
);
const rewritten = rewrites[0]?.v.o.hookSpecificOutput.updatedInput;
check(
  "map-brief: a worker's Agent call through the example gets its brief with the map lines once, from the pre-tool dispatcher",
  rewrites.length === 1 &&
    rewrites[0].e.entry.command ===
      "node ~/.claude/hooks/dispatch.mjs pre-tool" &&
    rewritten.prompt.startsWith(brief) &&
    rewritten.prompt.includes("SYSTEMS MAP:") &&
    rewritten.prompt.includes("## User login [auth]") &&
    rewritten.prompt.includes(
      "- Login never stores the password in plain text.",
    ) &&
    rewritten.subagent_type === "worker" &&
    agentRuns.every((x) => !x.v.stopped),
  agentRuns.map((x) => `${x.e.entry.command}: ${show(x.r)}`).join("\n     "),
);
// map-nudge: a prompt in a project of 100 code files of 100 lines, with no map, gets the one question
const big = path.join(tmp, "big-project");
for (let i = 0; i < 100; i++) {
  fs.mkdirSync(path.join(big, "src", `m${i % 10}`), { recursive: true });
  fs.writeFileSync(
    path.join(big, "src", `m${i % 10}`, `f${i}.js`),
    "x\n".repeat(100),
  );
}
git(big, "init", "-q");
git(big, "add", "-A");
const promptEntry = entries.find(
  (e) => e.event === "UserPromptSubmit" && e.script === "hooks/dispatch.mjs",
);
const promptRun = await run(
  promptEntry.entry.command
    .replace("~/.claude/", `"${fwd(REPO)}/`)
    .replace(/\.mjs(?=\s|$)/, '.mjs"'),
  {
    session_id: "t",
    hook_event_name: "UserPromptSubmit",
    cwd: big,
    prompt: "fix the login bug",
  },
  {
    env: { CLAUDE_PROJECT_DIR: big },
    timeoutMs: promptEntry.entry.timeout * 1000,
  },
);
check(
  "map-nudge: a prompt in a big project with no map gets the build question from the prompt dispatcher",
  promptRun.status === 0 &&
    /\[map-nudge\] This project has 100 tracked code files/.test(
      ctx(promptRun),
    ) &&
    /Ask the user once, on a question card/.test(ctx(promptRun)),
  show(promptRun),
);

home.remove();
fs.rmSync(tmp, { recursive: true, force: true });
summary();
