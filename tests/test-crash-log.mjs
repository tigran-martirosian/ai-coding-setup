// Tests for hooks/crash-log.mjs (the shared crash trace) and the crash alarm in hooks/transcript-check.mjs.
// Run: node tests/test-crash-log.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, appendFileSync, copyFileSync, existsSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

process.env.HOOK_ERRORS_LOG = "off"; // this test sets the log itself, case by case
const HOOKS = fileURLToPath(new URL("../hooks", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "crash-log-"));
const LOG = join(dir, "hook-errors.log");
const STATE = join(dir, "crash-alarm.json");
let fail = 0, total = 0;
const report = (ok, name) => { total++; if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const lines = (file = LOG) => (existsSync(file) ? readFileSync(file, "utf8").split("\n").filter(Boolean) : []);

// A hook of our own beside a copy of the helper (the handlers are installed only for a script in the helper's folder)
const demo = join(dir, "demo");
mkdirSync(demo);
mkdirSync(join(dir, "none")); // the folder of the session's own transcript
copyFileSync(join(HOOKS, "crash-log.mjs"), join(demo, "crash-log.mjs"));
const hook = (name, body) => { const f = join(demo, `${name}.mjs`); writeFileSync(f, `import { crashLog } from "./crash-log.mjs";\n${body}\n`); return f; };
const runFile = (file, env = {}, input = "") => spawnSync(process.execPath, [file], { input, encoding: "utf8", env: { ...process.env, HOOK_ERRORS_LOG: LOG, ...env } });

// 1. A hook that throws logs one line and ends as before
const caught = runFile(hook("demo-caught", `try { throw new Error("boom\\nsecond line"); } catch (err) { crashLog("demo-caught", err); process.exit(0); }`));
report(caught.status === 0 && caught.stdout === "", "a crash in the outermost catch: exit 0, nothing printed");
report(lines().length === 1 && /^\d{4}-\d\d-\d\dT[\d:.]+Z demo-caught: boom second line$/.test(lines()[0]), "it left one line: time, hook name, message on one line");
const loose = runFile(hook("demo-loose", `throw new Error("outside any catch");`));
report(loose.status === 1 && /outside any catch/.test(loose.stderr) && lines().some((l) => /demo-loose: outside any catch/.test(l)), "a crash outside any catch: logged, stack on stderr, exit 1 as without the helper");
const rejected = runFile(hook("demo-rejected", `await Promise.reject(new Error("rejected"));`));
report(rejected.status === 1 && lines().some((l) => /demo-rejected: rejected/.test(l)), "an unhandled rejection: logged, exit 1");
const bad = runFile(hook("demo-badlog", `crashLog("demo-badlog", new Error("x")); console.log("still here");`), { HOOK_ERRORS_LOG: join(dir, "demo", "crash-log.mjs", "no", "log") });
report(bad.status === 0 && bad.stdout.trim() === "still here", "a log that can't be written never makes the hook throw");
const real = runFile(join(HOOKS, "big-read-gate.mjs"), {}, "not json");
report(real.status === 0 && real.stdout === "" && lines().some((l) => / big-read-gate: /.test(l)), "a real hook fed junk lets the call through (exit 0, no output) and leaves its line");

// 2. Junk input in a test leaves no trace, so it raises no alarm: HOOK_ERRORS_LOG=off, which every hook test sets
const home = join(dir, "home");
const homeLog = join(home, ".claude", "hooks", "state", "hook-errors.log");
const homeEnv = { HOME: home, USERPROFILE: home, HOOK_ERRORS_LOG: "off" };
runFile(join(HOOKS, "big-read-gate.mjs"), homeEnv, "not json");
runFile(join(HOOKS, "verify-gate.mjs"), homeEnv, "not json");
report(!existsSync(homeLog), "with HOOK_ERRORS_LOG=off a hook fed junk writes no log");

// 3. The alarm
const session = (env = {}) => spawnSync(process.execPath, [join(HOOKS, "transcript-check.mjs")], {
  input: JSON.stringify({ hook_event_name: "SessionStart", transcript_path: join(dir, "none", "now.jsonl") }), encoding: "utf8",
  env: { ...process.env, HOOK_ERRORS_LOG: LOG, CRASH_ALARM_STATE: STATE, TRANSCRIPT_CHECK_STATE: join(dir, "tc.json"), HOOK_CRASH_ALARM: "", ...env },
}).stdout;
const said = (out) => (out ? JSON.parse(out).systemMessage : "");
report(session() === "", "the first session only notes where the log ends: old lines raise nothing");
report(JSON.parse(readFileSync(STATE, "utf8")).offset === readFileSync(LOG).length, "the offset is kept in a file");
report(session() === "", "no new line: no alarm");
appendFileSync(LOG, `2026-11-02T10:00:00.000Z verify-gate: real crash\n`);
const alarm = session();
const msg = said(alarm);
report(/verify-gate/.test(msg) && /1 hook crash /.test(msg) && msg.includes(LOG) && !msg.includes("\n"), "a real line raises one short line naming the hook, the count and the log path");
report(JSON.parse(alarm).hookSpecificOutput.additionalContext === msg, "the session is told too, not only the user");
report(session() === "", "the same line raises nothing the second time");
appendFileSync(LOG, `2026-11-02T10:01:00.000Z repeat-guard: a\n2026-11-02T10:02:00.000Z repeat-guard: b\n2026-11-02T10:03:00.000Z verify-gate: c\n`);
const more = said(session());
report(/3 hook crashes/.test(more) && /repeat-guard x2/.test(more) && /verify-gate/.test(more), "later lines are counted per hook, the old one not again");
report(session() === "", "and once");
appendFileSync(LOG, `2026-11-02T10:04:00.000Z verify-gate: half a li`);
report(session() === "", "a line still being written waits");
appendFileSync(LOG, `ne\n`);
report(/verify-gate/.test(said(session())), "and is reported once it is complete");
appendFileSync(LOG, `2026-11-02T10:05:00.000Z big-read-gate: off switch\n`);
report(session({ HOOK_CRASH_ALARM: "off" }) === "", "HOOK_CRASH_ALARM=off raises nothing");
report(/big-read-gate/.test(said(session())), "and the line is still there to report when it is switched on again");
// More than the 256 KB the alarm reads at once, with two-byte characters, so the cap cuts a line and a character in half
const NL = String.fromCharCode(10);
session({ HOOK_CRASH_ALARM: "off" }); // (leaves the offset where it was)
appendFileSync(LOG, `2026-11-02T10:05:30.000Z bulk-hook: ${"é".repeat(100)}${NL}`.repeat(4000) + `2026-11-02T10:05:40.000Z verify-gate: after the bulk${NL}`);
const big = said(session());
report(/verify-gate/.test(big) && /bulk-hook/.test(big), "over 256 KB of new lines, starting mid-character, still gives a whole-line alarm");
report(JSON.parse(readFileSync(STATE, "utf8")).offset === readFileSync(LOG).length && session() === "", "and the offset lands exactly on the end of the log");
writeFileSync(LOG, "");
report(session() === "", "an emptied log raises nothing");
appendFileSync(LOG, `2026-11-02T10:06:00.000Z verify-gate: after the reset\n`);
report(/verify-gate/.test(said(session())), "and the next line after it is seen");

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `\n${fail} of ${total} failed` : `\nall ${total} passed`);
process.exit(fail ? 1 : 0);
