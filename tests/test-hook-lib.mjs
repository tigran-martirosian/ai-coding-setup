// Tests for hooks/lib: hook-io (runHook, isMain, inNimbalyst, emit, log-only mode), paths, state, settings-env,
// and workers/observe-log.mjs, which prints the log-only mode's log.
// Run: node tests/test-hook-lib.mjs
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

process.env.HOOK_ERRORS_LOG = "off"; // only the cases that test the log turn it on
const LIB = fileURLToPath(new URL("../hooks/lib", import.meta.url));
const url = (name) => pathToFileURL(join(LIB, name)).href;
const dir = mkdtempSync(join(tmpdir(), "hook-lib-"));
const home = join(dir, "home");
mkdirSync(home);
const LOG = join(dir, "hook-errors.log");
let fail = 0,
  total = 0;
const report = (ok, name) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
const lines = () =>
  existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : [];

// Runs a script in the temp folder with the temp home
let n = 0;
function run(body, { input = "", env = {} } = {}) {
  const file = join(dir, `script-${++n}.mjs`);
  writeFileSync(file, body);
  return spawnSync(process.execPath, [file], {
    input,
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOOK_ERRORS_LOG: "off",
      ...env,
    },
  });
}
const frame = (fn, opts = "") =>
  `import { runHook } from ${JSON.stringify(url("hook-io.mjs"))};\nawait runHook("demo-hook", ${fn}${opts});\n`;
const event = JSON.stringify({ session_id: "s1", cwd: dir });

// runHook: normal run, off switch in three cases
const ran = run(frame(`(e) => { console.log("ran " + e.session_id); }`), {
  input: event,
});
report(
  ran.status === 0 && ran.stdout.trim() === "ran s1",
  "runHook hands the parsed event to the hook",
);
for (const v of ["off", "OFF", "Off"]) {
  const r = run(frame(`(e) => { console.log("ran"); }`), {
    input: event,
    env: { DEMO_HOOK: v },
  });
  report(
    r.status === 0 && r.stdout === "",
    `DEMO_HOOK=${v} switches the hook off`,
  );
}
const other = run(
  frame(`(e) => { console.log("ran"); }`, `, { off: "MY_SWITCH" }`),
  { input: event, env: { MY_SWITCH: "Off" } },
);
report(other.stdout === "", "an {off: name} option names another switch");

// Bad input
const badFalse = run(frame(`(e) => { console.log("ran"); }`), {
  input: "not json",
  env: { HOOK_ERRORS_LOG: LOG },
});
report(
  badFalse.status === 0 &&
    badFalse.stdout === "" &&
    lines().length === 1 &&
    /demo-hook: /.test(lines()[0]),
  "bad JSON: exit 0, logged, hook not run",
);
const badTrue = run(
  frame(`(e) => { console.log("ran"); }`, `, { exitOnBadInput: true }`),
  { input: "not json" },
);
report(
  badTrue.status === 2 &&
    /DEMO_HOOK=off/.test(badTrue.stderr) &&
    badTrue.stdout === "",
  "bad JSON with exitOnBadInput: exit 2 and says how to bypass",
);
const notObject = run(
  frame(`(e) => { console.log("ran"); }`, `, { exitOnBadInput: true }`),
  { input: "[1]" },
);
report(
  notObject.status === 2,
  "JSON that is not an object counts as bad input",
);

// A thrown error
const before = lines().length;
const thrown = run(
  frame(`async (e) => { throw new Error("boom\\nsecond"); }`),
  { input: event, env: { HOOK_ERRORS_LOG: LOG } },
);
report(
  thrown.status === 0 &&
    lines().length === before + 1 &&
    /demo-hook: boom second$/.test(lines().at(-1)),
  "a thrown error: exit 0 and one crash-log line",
);
const closedThrow = run(
  frame(`async (e) => { throw new Error("boom"); }`, `, { failClosed: true }`),
  { input: event, env: { HOOK_ERRORS_LOG: LOG } },
);
report(
  closedThrow.status === 1 &&
    /DEMO_HOOK=off/.test(closedThrow.stderr) &&
    lines().length === before + 2,
  "failClosed: a thrown error is logged and exits 1 (onFailure block stops the call)",
);
const closedBad = run(
  frame(`(e) => { console.log("ran"); }`, `, { failClosed: true }`),
  { input: "not json", env: { HOOK_ERRORS_LOG: LOG } },
);
report(
  closedBad.status === 1 && closedBad.stdout === "",
  "failClosed: bad input exits 1, hook not run",
);
const code = run(frame(`(e) => 2`), { input: event });
report(code.status === 2, "a number the hook returns is the exit code");

// isMain, inNimbalyst, emit
const main = join(dir, "ismain.mjs");
writeFileSync(
  main,
  `import { isMain, inNimbalyst, emit } from ${JSON.stringify(url("hook-io.mjs"))};\nexport const here = isMain(import.meta.url);\nif (here) { console.log("main " + inNimbalyst()); }\n`,
);
const asScript = spawnSync(process.execPath, [main], {
  encoding: "utf8",
  env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" },
});
report(
  asScript.stdout.trim() === "main true",
  "isMain is true for the script run, inNimbalyst reads sdk-...",
);
const asImport = run(
  `import { here } from ${JSON.stringify(pathToFileURL(main).href)};\nconsole.log("main " + here);\n`,
  { env: { CLAUDE_CODE_ENTRYPOINT: "cli" } },
);
report(
  asImport.stdout.trim() === "main false",
  "isMain is false when the file is imported",
);
const emitted = run(
  `import { emit } from ${JSON.stringify(url("hook-io.mjs"))};\nemit.deny("no"); console.log(); emit.block("stop"); console.log(); emit.context("SessionStart", "hi");\n`,
);
const [d, b, c] = emitted.stdout.split("\n");
report(
  d ===
    '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}' &&
    b === '{"decision":"block","reason":"stop"}' &&
    c ===
      '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"hi"}}',
  "emit.deny / block / context write the JSON the hooks write",
);

// state: runs in a child with the temp home
const st = run(
  `
import fs from "node:fs";
import path from "node:path";
import { STATE_DIR, stateFile, readJson, writeJson, sweep } from ${JSON.stringify(url("state.mjs"))};
const out = {};
out.dir = STATE_DIR;
const f = stateFile("demo", "k1");
out.file = f;
out.missing = readJson(f, { missing: "gone" });
writeJson(f, { a: 1 });
out.read = readJson(f, { missing: "gone" });
out.part = fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith(".part"));
fs.writeFileSync(stateFile("demo", "bad"), "{ nope");
out.corrupt = readJson(stateFile("demo", "bad"), { missing: "gone" });
const old = stateFile("demo", "old"), fresh = stateFile("demo", "fresh");
writeJson(old, {}); writeJson(fresh, {});
const t = new Date(Date.now() - 5 * 86400000);
fs.utimesSync(old, t, t);
sweep("demo", 2);
out.left = fs.readdirSync(path.dirname(f)).sort();
sweep("never-existed", 2);
console.log(JSON.stringify(out));
`,
  { env: { HOOK_ERRORS_LOG: LOG } },
);
const s = JSON.parse(st.stdout || "{}");
report(
  s.dir === join(home, ".claude", "hooks", "state") &&
    s.file === join(s.dir, "demo", "k1.json"),
  "STATE_DIR follows the home folder; stateFile is <dir>/<hook>/<key>.json",
);
report(
  s.missing === "gone" && s.read?.a === 1,
  "readJson gives `missing` for an absent file and the JSON for a present one",
);
report(
  s.corrupt === "gone" &&
    lines().some((l) => /state: .*bad\.json is not valid JSON/.test(l)),
  "readJson on a corrupt file gives `missing` and logs it",
);
report(
  Array.isArray(s.part) && s.part.length === 0,
  "writeJson leaves no .part file",
);
report(
  JSON.stringify(s.left) ===
    JSON.stringify(["bad.json", "fresh.json", "k1.json"]),
  "sweep removes only files older than N days",
);

// state on Windows: a rename refused while another process holds the file, a .part gone before the sweep stats it
const race = run(`
import fs from "node:fs";
import path from "node:path";
import { stateFile, readJson, writeJson, sweep } from ${JSON.stringify(url("state.mjs"))};
const out = {};
const realRename = fs.renameSync, realStat = fs.statSync;
const refuse = (times, code) => { let left = times; fs.renameSync = (a, b) => { if (left-- > 0) throw Object.assign(new Error(code + ": rename"), { code }); return realRename(a, b); }; };
const f = stateFile("race", "k");
refuse(2, "EPERM");
writeJson(f, { b: 2 });
out.retried = readJson(f);
refuse(99, "EPERM");
try { writeJson(f, { b: 3 }); out.gaveUp = "no error"; } catch (err) { out.gaveUp = err.code; }
out.kept = readJson(f);
fs.renameSync = realRename;
out.part = fs.readdirSync(path.dirname(f)).filter((x) => x.endsWith(".part"));
fs.writeFileSync(f + ".999.part", "{}");
fs.statSync = (p, ...rest) => { if (String(p).endsWith(".999.part")) { fs.rmSync(p, { force: true }); throw Object.assign(new Error("ENOENT: stat"), { code: "ENOENT" }); } return realStat(p, ...rest); };
try { sweep("race", 2); out.swept = "ok"; } catch (err) { out.swept = err.message; }
console.log(JSON.stringify(out));
`);
const r2 = JSON.parse(race.stdout || "{}");
report(
  r2.retried?.b === 2,
  "writeJson retries a rename refused twice with EPERM and saves",
);
report(
  r2.gaveUp === "EPERM" &&
    r2.kept?.b === 2 &&
    Array.isArray(r2.part) &&
    r2.part.length === 0,
  "a rename refused every time throws, keeps the old file and removes its .part",
);
report(
  r2.swept === "ok",
  "sweep skips a .part that vanished before it was stat'ed",
);

// paths
mkdirSync(join(dir, "proj", "sub"), { recursive: true });
writeFileSync(join(dir, "proj", "CLAUDE.md"), "x");
const pr = run(
  `
import { gitBashToNative, projectRoot, fileKey, sessionKey } from ${JSON.stringify(url("paths.mjs"))};
console.log(JSON.stringify({ g: gitBashToNative("/c/work/x"), plain: gitBashToNative("/opt/x"), root: projectRoot({ cwd: ${JSON.stringify(join(dir, "proj", "sub"))} }), key: sessionKey("a/b:c-d_e"), none: sessionKey(), fk: fileKey("A/b") }));
`,
  { env: { CLAUDE_PROJECT_DIR: "" } },
);
const q = JSON.parse(pr.stdout || "{}");
report(
  q.g === (process.platform === "win32" ? "c:/work/x" : "/c/work/x") &&
    q.plain === "/opt/x",
  "gitBashToNative('/c/work/x') gives c:/work/x on Windows",
);
report(
  q.root?.replace(/\\/g, "/") === join(dir, "proj").replace(/\\/g, "/"),
  "projectRoot climbs from the event's cwd to the folder with CLAUDE.md",
);
report(
  q.key === "abc-d_e" && q.none === "none",
  "sessionKey keeps word characters and dashes",
);
report(
  q.fk ===
    (process.platform === "win32"
      ? join(process.cwd(), "A/b").replace(/\\/g, "/").toLowerCase()
      : join(process.cwd(), "A/b")),
  "fileKey is absolute with forward slashes",
);

// setting()
const proj = join(dir, "sproj");
mkdirSync(join(proj, ".claude"), { recursive: true });
mkdirSync(join(proj, "deep", "er"), { recursive: true });
writeFileSync(
  join(proj, ".claude", "settings.json"),
  JSON.stringify({ env: { DEMO_SETTING: "from-settings", BOTH: "plain" } }),
);
writeFileSync(
  join(proj, ".claude", "settings.local.json"),
  JSON.stringify({ env: { BOTH: "local" } }),
);
const se = run(
  `
import { setting } from ${JSON.stringify(url("settings-env.mjs"))};
console.log(JSON.stringify([setting("DEMO_SETTING"), setting("BOTH"), setting("ABSENT_ONE"), setting("DEMO_SETTING", ${JSON.stringify(join(proj, "deep", "er"))}), setting("FROM_ENV")]));
`,
  { env: { CLAUDE_PROJECT_DIR: proj, FROM_ENV: "env-wins" } },
);
report(
  se.stdout.trim() ===
    JSON.stringify(["from-settings", "local", "", "from-settings", "env-wins"]),
  "setting() reads env, then settings.local.json, then settings.json, walking up",
);

// a half-edited settings file is logged and skipped; the next file still answers
writeFileSync(
  join(proj, ".claude", "settings.local.json"),
  '{ "env": { "BOTH": ',
);
const badLog = join(dir, "bad-settings.log");
const bad = run(
  `
import { setting } from ${JSON.stringify(url("settings-env.mjs"))};
console.log(JSON.stringify([setting("BOTH"), setting("DEMO_SETTING")]));
`,
  { env: { CLAUDE_PROJECT_DIR: proj, HOOK_ERRORS_LOG: badLog } },
);
report(
  bad.status === 0 &&
    bad.stdout.trim() === JSON.stringify(["plain", "from-settings"]),
  "setting() skips a settings file that is not valid JSON",
);
report(
  existsSync(badLog) &&
    /settings-env[\s\S]*settings\.local\.json is not valid JSON/.test(
      readFileSync(badLog, "utf8"),
    ),
  "and logs which file it skipped",
);

// Log-only mode (observe): each run gets its own home, so its observe log is its own
let homes = 0;
const freshHome = () => {
  const h = join(dir, `obs-home-${++homes}`);
  mkdirSync(h);
  return h;
};
const stateOf = (h) => join(h, ".claude", "hooks", "state");
const obsLines = (h) => {
  const f = join(stateOf(h), "observe.jsonl");
  return existsSync(f) && statSync(f).isFile()
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null; // the cap case's filler line
          }
        })
    : [];
};
const obsEvent = JSON.stringify({
  session_id: "s1",
  cwd: "C:\\Projects\\demo",
  agent_id: "a7",
});
const obs = (call, { opts = "", env = {}, h = freshHome() } = {}) => {
  const r = run(
    `import { runHook, emit, hookMode } from ${JSON.stringify(url("hook-io.mjs"))};\nawait runHook("demo-hook", (e) => { ${call} }${opts});\n`,
    { input: obsEvent, env: { HOME: h, USERPROFILE: h, ...env } },
  );
  return { ...r, log: obsLines(h), home: h };
};
const BLOCKED = '{"decision":"block","reason":"stop it"}';
const block = `emit.block("stop it");`;

const o1 = obs(block, { env: { DEMO_HOOK: "observe" } });
const l1 = o1.log[0] || {};
report(
  o1.status === 0 &&
    o1.stdout === "" &&
    o1.log.length === 1 &&
    l1.hook === "demo-hook" &&
    l1.session === "s1" &&
    l1.agent === "a7" &&
    l1.cwd === "C:/Projects/demo" &&
    l1.arm === null &&
    l1.would === "block" &&
    l1.reason === "stop it" &&
    !Number.isNaN(Date.parse(l1.t)),
  "observe: emit.block writes nothing on stdout and logs one line with hook, session, would, reason",
);
const o1d = obs(`emit.deny("no");`, { env: { DEMO_HOOK: "Observe" } });
report(
  o1d.stdout === "" && o1d.log.length === 1 && o1d.log[0].would === "deny",
  "observe (any case): emit.deny is logged as would deny, not written",
);
const o2 = obs(block);
report(
  o2.stdout === BLOCKED && !existsSync(join(stateOf(o2.home), "observe.jsonl")),
  "variable unset: the block is written as before and no observe log is made",
);
const o3 = obs(block, { opts: `, { mode: "observe" }` });
const o3e = obs(block, {
  opts: `, { mode: "observe" }`,
  env: { DEMO_HOOK: "enforce" },
});
report(
  o3.stdout === "" &&
    o3.log.length === 1 &&
    o3e.stdout === BLOCKED &&
    o3e.log.length === 0,
  "runHook {mode: observe} makes observe the default; DEMO_HOOK=enforce refuses",
);
const armed = `emit.block("stop it", { arm: "commit", mode: "observe" });`;
const a4 = obs(armed);
const a4e = obs(armed, { env: { DEMO_HOOK_COMMIT: "enforce" } });
const a4off = obs(armed, { env: { DEMO_HOOK: "off" } });
const a4armOff = obs(armed, { env: { DEMO_HOOK_COMMIT: "off" } });
report(
  a4.stdout === "" &&
    a4.log.length === 1 &&
    a4.log[0].arm === "commit" &&
    a4e.stdout === BLOCKED &&
    a4e.log.length === 0 &&
    a4off.stdout === "" &&
    a4off.log.length === 0 &&
    a4armOff.stdout === "" &&
    a4armOff.log.length === 0,
  "an arm default observe logs with the arm; DEMO_HOOK_COMMIT=enforce refuses; hook or arm off: no output, no log",
);
const a4hook = obs(armed, { env: { DEMO_HOOK: "enforce" } });
const a4led = obs(armed, { env: { DEMO_HOOK: "led" } });
report(
  a4hook.stdout === BLOCKED && a4led.stdout === "" && a4led.log.length === 1,
  "for an arm, the hook variable counts before the arm default only when it is observe or enforce",
);
const o5 = obs(block, {
  opts: `, { mode: "observe" }`,
  env: { DEMO_HOOK: "led" },
});
report(
  o5.stdout === BLOCKED && o5.log.length === 0,
  "a value that is not a mode (DEMO_HOOK=led) is enforce, even over an observe default",
);
const o6 = obs(`emit.context("SessionStart", "hi");`, {
  env: { DEMO_HOOK: "observe" },
});
report(
  o6.stdout ===
    '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"hi"}}' &&
    o6.log.length === 0,
  "observe: emit.context still writes the note",
);
const hm = obs(
  `console.log(hookMode("demo-hook"), hookMode("demo-hook", { arm: "commit", mode: "observe" }), hookMode("other"));`,
  { opts: `, { mode: "observe" }`, env: { DEMO_HOOK_COMMIT: "ENFORCE" } },
);
report(
  hm.stdout.trim() === "observe enforce enforce",
  "hookMode returns the running hook's default, an arm's own variable, enforce for a hook with no settings",
);

const capHome = freshHome();
mkdirSync(stateOf(capHome), { recursive: true });
writeFileSync(
  join(stateOf(capHome), "observe.jsonl"),
  `${"x".repeat(1024 * 1024 - 1)}\n`,
);
const o7 = obs(block, { env: { DEMO_HOOK: "observe" }, h: capHome });
report(
  existsSync(join(stateOf(capHome), "observe.1.jsonl")) &&
    readFileSync(join(stateOf(capHome), "observe.1.jsonl")).length ===
      1024 * 1024 &&
    o7.log.length === 1,
  "a log of 1 MB is renamed to observe.1.jsonl before the append; observe.jsonl starts again with 1 line",
);
const failHome = freshHome();
mkdirSync(join(stateOf(failHome), "observe.jsonl"), { recursive: true });
const failLog = join(dir, "observe-fail.log");
const o7f = obs(block, {
  env: { DEMO_HOOK: "observe", HOOK_ERRORS_LOG: failLog },
  h: failHome,
});
report(
  o7f.status === 0 &&
    o7f.stdout === "" &&
    existsSync(failLog) &&
    /demo-hook: /.test(readFileSync(failLog, "utf8")),
  "a failed append is crash-logged and the hook still ends quietly (fail open)",
);

// observeLine: a line the hook chooses, with its own fields, in observe and enforce
report(
  JSON.stringify(Object.keys(l1)) ===
    '["t","hook","arm","session","agent","cwd","would","reason"]',
  "a refusal's log line keeps exactly the usual fields, in their order",
);
const logged = `observeLine("verified", "all good", { arm: "commit", mode: "observe", fields: { repo: "C:/x", files: ["a.mjs"] } });`;
const obsLine = (call, opts) =>
  obs(
    `return import(${JSON.stringify(url("hook-io.mjs"))}).then(({ observeLine }) => { ${call} });`,
    opts,
  );
const ol = obsLine(logged);
const olEnf = obsLine(logged, { env: { DEMO_HOOK_COMMIT: "enforce" } });
const olOff = obsLine(logged, { env: { DEMO_HOOK_COMMIT: "off" } });
report(
  ol.stdout === "" &&
    ol.log.length === 1 &&
    JSON.stringify(Object.keys(ol.log[0])) ===
      '["t","hook","arm","session","agent","cwd","would","reason","repo","files"]' &&
    ol.log[0].would === "verified" &&
    ol.log[0].arm === "commit" &&
    ol.log[0].files[0] === "a.mjs" &&
    olEnf.stdout === "" &&
    olEnf.log.length === 1 &&
    olOff.log.length === 0,
  "observeLine writes one line with its fields after the usual ones, in observe and in enforce, none when off",
);
const clashLog = join(dir, "observe-clash.log");
const olClash = obsLine(`observeLine("x", "y", { fields: { would: "z" } });`, {
  env: { HOOK_ERRORS_LOG: clashLog },
});
report(
  olClash.status === 0 &&
    olClash.log.length === 0 &&
    /usual field/.test(readFileSync(clashLog, "utf8")),
  "observeLine refuses a field with a usual name (crash-logged, no line)",
);

// workers/observe-log.mjs
const WORKER = fileURLToPath(
  new URL("../workers/observe-log.mjs", import.meta.url),
);
const printLog = (h, args = []) =>
  spawnSync(process.execPath, [WORKER, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: h, USERPROFILE: h },
  });
const noLog = printLog(freshHome());
report(
  noLog.status === 0 &&
    noLog.stdout.trim() ===
      "no observe log yet (~/.claude/hooks/state/observe.jsonl)",
  "observe-log with no log says so and exits 0",
);
const fixHome = freshHome();
mkdirSync(stateOf(fixHome), { recursive: true });
const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const entry = (hook, arm, session, would, min, cwd = "C:/Projects/one") =>
  JSON.stringify({
    t: ago(min),
    hook,
    arm,
    session,
    agent: null,
    cwd,
    would,
    reason: `${hook} says no`,
  });
writeFileSync(
  join(stateOf(fixHome), "observe.1.jsonl"),
  `${entry("sample-gate", "stop", "s1", "block", 30)}\n${entry("sample-gate", "stop", "s1", "block", 20 * 24 * 60)}\n`,
);
writeFileSync(
  join(stateOf(fixHome), "observe.jsonl"),
  [
    entry("sample-gate", "stop", "s2", "block", 20, "C:/Projects/two"),
    entry("verify-gate", "commit", "s3", "deny", 10),
    "not json",
    entry("sample-gate", "stop", "s2", "block", 5),
    entry("verify-gate", "commit", "s3", "deny", 1),
  ].join("\n"),
);
const printed = printLog(fixHome);
const heads = printed.stdout.split("\n").filter((l) => /^\S/.test(l));
report(
  printed.status === 0 &&
    heads[0] ===
      "verify-gate/commit  2 would-deny in 7 days, 1 session, 1 project" &&
    heads[1] ===
      "sample-gate/stop  3 would-block in 7 days, 2 sessions, 2 projects" &&
    heads[2] === "bad lines: 1" &&
    /^ {2}\d{4}-\d\d-\d\d \d\d:\d\d {2}one {2}verify-gate says no$/m.test(
      printed.stdout,
    ),
  "observe-log prints one block per hook, newest first, with counts in the window and bad lines",
);
const onlyOne = printLog(fixHome, ["--hook", "sample-gate"]);
report(
  /sample-gate\/stop/.test(onlyOne.stdout) &&
    !/verify-gate/.test(onlyOne.stdout),
  "observe-log --hook shows only that hook",
);
const ownHome = freshHome();
mkdirSync(stateOf(ownHome), { recursive: true });
const own = (would, min) =>
  JSON.stringify({
    ...JSON.parse(entry("verify-gate", "commit", "s4", would, min)),
    repo: "C:/r",
    files: ["a.mjs", "b.mjs"],
    lastVerify: "none",
  });
writeFileSync(
  join(stateOf(ownHome), "observe.jsonl"),
  `${own("would-refuse", 3)}\n${own("verified", 2)}\n`,
);
const ownPrinted = printLog(ownHome).stdout;
report(
  /^verify-gate\/commit {2}1 verified, 1 would-refuse in 7 days/m.test(
    ownPrinted,
  ) &&
    /^ {2}\S+ \S+ {2}one {2}verified {2}verify-gate says no$/m.test(
      ownPrinted,
    ) &&
    /^ {6}repo=C:\/r files=a\.mjs,b\.mjs lastVerify=none$/m.test(ownPrinted),
  "observe-log counts a hook's own verdicts as they are and shows each line's verdict and own fields",
);
const manyHome = freshHome();
mkdirSync(stateOf(manyHome), { recursive: true });
writeFileSync(
  join(stateOf(manyHome), "observe.jsonl"),
  Array.from({ length: 8 }, (_, i) =>
    entry("verify-gate", "commit", `m${i}`, "would-refuse", 10 + i),
  ).join("\n"),
);
const timeLines = (out) =>
  out.split("\n").filter((l) => /^ {2}\d{4}-/.test(l)).length;
report(
  timeLines(printLog(manyHome).stdout) === 5 &&
    timeLines(printLog(manyHome, ["--all"]).stdout) === 8,
  "observe-log shows the last 5 lines per hook, and every line in the window with --all",
);
report(
  (readFileSync(join(LIB, "hook-io.mjs"), "utf8").match(/observe/g) || [])
    .length > 0,
  "hook-io.mjs has the observe mode",
);

rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail ? `${fail} of ${total} FAILED` : `all ${total} passed`}`);
process.exit(fail ? 1 : 0);
