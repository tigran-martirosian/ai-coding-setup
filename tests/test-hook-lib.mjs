// Tests for hooks/lib: hook-io (runHook, isMain, inNimbalyst, emit), paths, state, settings-env.
// Run: node tests/test-hook-lib.mjs
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
let fail = 0, total = 0;
const report = (ok, name) => { total++; if (!ok) fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const lines = () => (existsSync(LOG) ? readFileSync(LOG, "utf8").split("\n").filter(Boolean) : []);

// Runs a script in the temp folder with the temp home
let n = 0;
function run(body, { input = "", env = {} } = {}) {
  const file = join(dir, `script-${++n}.mjs`);
  writeFileSync(file, body);
  return spawnSync(process.execPath, [file], {
    input, encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home, HOOK_ERRORS_LOG: "off", ...env },
  });
}
const frame = (fn, opts = "") => `import { runHook } from ${JSON.stringify(url("hook-io.mjs"))};\nawait runHook("demo-hook", ${fn}${opts});\n`;
const event = JSON.stringify({ session_id: "s1", cwd: dir });

// runHook: normal run, off switch in three cases
const ran = run(frame(`(e) => { console.log("ran " + e.session_id); }`), { input: event });
report(ran.status === 0 && ran.stdout.trim() === "ran s1", "runHook hands the parsed event to the hook");
for (const v of ["off", "OFF", "Off"]) {
  const r = run(frame(`(e) => { console.log("ran"); }`), { input: event, env: { DEMO_HOOK: v } });
  report(r.status === 0 && r.stdout === "", `DEMO_HOOK=${v} switches the hook off`);
}
const other = run(frame(`(e) => { console.log("ran"); }`, `, { off: "MY_SWITCH" }`), { input: event, env: { MY_SWITCH: "Off" } });
report(other.stdout === "", "an {off: name} option names another switch");

// Bad input
const badFalse = run(frame(`(e) => { console.log("ran"); }`), { input: "not json", env: { HOOK_ERRORS_LOG: LOG } });
report(badFalse.status === 0 && badFalse.stdout === "" && lines().length === 1 && /demo-hook: /.test(lines()[0]), "bad JSON: exit 0, logged, hook not run");
const badTrue = run(frame(`(e) => { console.log("ran"); }`, `, { exitOnBadInput: true }`), { input: "not json" });
report(badTrue.status === 2 && /DEMO_HOOK=off/.test(badTrue.stderr) && badTrue.stdout === "", "bad JSON with exitOnBadInput: exit 2 and says how to bypass");
const notObject = run(frame(`(e) => { console.log("ran"); }`, `, { exitOnBadInput: true }`), { input: "[1]" });
report(notObject.status === 2, "JSON that is not an object counts as bad input");

// A thrown error
const before = lines().length;
const thrown = run(frame(`async (e) => { throw new Error("boom\\nsecond"); }`), { input: event, env: { HOOK_ERRORS_LOG: LOG } });
report(thrown.status === 0 && lines().length === before + 1 && /demo-hook: boom second$/.test(lines().at(-1)), "a thrown error: exit 0 and one crash-log line");
const code = run(frame(`(e) => 2`), { input: event });
report(code.status === 2, "a number the hook returns is the exit code");

// isMain, inNimbalyst, emit
const main = join(dir, "ismain.mjs");
writeFileSync(main, `import { isMain, inNimbalyst, emit } from ${JSON.stringify(url("hook-io.mjs"))};\nexport const here = isMain(import.meta.url);\nif (here) { console.log("main " + inNimbalyst()); }\n`);
const asScript = spawnSync(process.execPath, [main], { encoding: "utf8", env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts" } });
report(asScript.stdout.trim() === "main true", "isMain is true for the script run, inNimbalyst reads sdk-...");
const asImport = run(`import { here } from ${JSON.stringify(pathToFileURL(main).href)};\nconsole.log("main " + here);\n`, { env: { CLAUDE_CODE_ENTRYPOINT: "cli" } });
report(asImport.stdout.trim() === "main false", "isMain is false when the file is imported");
const emitted = run(`import { emit } from ${JSON.stringify(url("hook-io.mjs"))};\nemit.deny("no"); console.log(); emit.block("stop"); console.log(); emit.context("SessionStart", "hi");\n`);
const [d, b, c] = emitted.stdout.split("\n");
report(d === '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"no"}}'
  && b === '{"decision":"block","reason":"stop"}' && c === '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"hi"}}', "emit.deny / block / context write the JSON the hooks write");

// state: runs in a child with the temp home
const st = run(`
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
`, { env: { HOOK_ERRORS_LOG: LOG } });
const s = JSON.parse(st.stdout || "{}");
report(s.dir === join(home, ".claude", "hooks", "state") && s.file === join(s.dir, "demo", "k1.json"), "STATE_DIR follows the home folder; stateFile is <dir>/<hook>/<key>.json");
report(s.missing === "gone" && s.read?.a === 1, "readJson gives `missing` for an absent file and the JSON for a present one");
report(s.corrupt === "gone" && lines().some((l) => /state: .*bad\.json is not valid JSON/.test(l)), "readJson on a corrupt file gives `missing` and logs it");
report(Array.isArray(s.part) && s.part.length === 0, "writeJson leaves no .part file");
report(JSON.stringify(s.left) === JSON.stringify(["bad.json", "fresh.json", "k1.json"]), "sweep removes only files older than N days");

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
report(r2.retried?.b === 2, "writeJson retries a rename refused twice with EPERM and saves");
report(r2.gaveUp === "EPERM" && r2.kept?.b === 2 && Array.isArray(r2.part) && r2.part.length === 0, "a rename refused every time throws, keeps the old file and removes its .part");
report(r2.swept === "ok", "sweep skips a .part that vanished before it was stat'ed");

// paths
mkdirSync(join(dir, "proj", "sub"), { recursive: true });
writeFileSync(join(dir, "proj", "CLAUDE.md"), "x");
const pr = run(`
import { gitBashToNative, projectRoot, fileKey, sessionKey } from ${JSON.stringify(url("paths.mjs"))};
console.log(JSON.stringify({ g: gitBashToNative("/c/work/x"), plain: gitBashToNative("/opt/x"), root: projectRoot({ cwd: ${JSON.stringify(join(dir, "proj", "sub"))} }), key: sessionKey("a/b:c-d_e"), none: sessionKey(), fk: fileKey("A/b") }));
`, { env: { CLAUDE_PROJECT_DIR: "" } });
const q = JSON.parse(pr.stdout || "{}");
report(q.g === (process.platform === "win32" ? "c:/work/x" : "/c/work/x") && q.plain === "/opt/x", "gitBashToNative('/c/work/x') gives c:/work/x on Windows");
report(q.root?.replace(/\\/g, "/") === join(dir, "proj").replace(/\\/g, "/"), "projectRoot climbs from the event's cwd to the folder with CLAUDE.md");
report(q.key === "abc-d_e" && q.none === "none", "sessionKey keeps word characters and dashes");
report(q.fk === (process.platform === "win32" ? join(process.cwd(), "A/b").replace(/\\/g, "/").toLowerCase() : join(process.cwd(), "A/b")), "fileKey is absolute with forward slashes");

// setting()
const proj = join(dir, "sproj");
mkdirSync(join(proj, ".claude"), { recursive: true });
mkdirSync(join(proj, "deep", "er"), { recursive: true });
writeFileSync(join(proj, ".claude", "settings.json"), JSON.stringify({ env: { DEMO_SETTING: "from-settings", BOTH: "plain" } }));
writeFileSync(join(proj, ".claude", "settings.local.json"), JSON.stringify({ env: { BOTH: "local" } }));
const se = run(`
import { setting } from ${JSON.stringify(url("settings-env.mjs"))};
console.log(JSON.stringify([setting("DEMO_SETTING"), setting("BOTH"), setting("ABSENT_ONE"), setting("DEMO_SETTING", ${JSON.stringify(join(proj, "deep", "er"))}), setting("FROM_ENV")]));
`, { env: { CLAUDE_PROJECT_DIR: proj, FROM_ENV: "env-wins" } });
report(se.stdout.trim() === JSON.stringify(["from-settings", "local", "", "from-settings", "env-wins"]), "setting() reads env, then settings.local.json, then settings.json, walking up");

// a half-edited settings file is logged and skipped; the next file still answers
writeFileSync(join(proj, ".claude", "settings.local.json"), "{ \"env\": { \"BOTH\": ");
const badLog = join(dir, "bad-settings.log");
const bad = run(`
import { setting } from ${JSON.stringify(url("settings-env.mjs"))};
console.log(JSON.stringify([setting("BOTH"), setting("DEMO_SETTING")]));
`, { env: { CLAUDE_PROJECT_DIR: proj, HOOK_ERRORS_LOG: badLog } });
report(bad.status === 0 && bad.stdout.trim() === JSON.stringify(["plain", "from-settings"]), "setting() skips a settings file that is not valid JSON");
report(existsSync(badLog) && /settings-env[\s\S]*settings\.local\.json is not valid JSON/.test(readFileSync(badLog, "utf8")), "and logs which file it skipped");

rmSync(dir, { recursive: true, force: true });
console.log(`\n${fail ? `${fail} of ${total} FAILED` : `all ${total} passed`}`);
process.exit(fail ? 1 : 0);
