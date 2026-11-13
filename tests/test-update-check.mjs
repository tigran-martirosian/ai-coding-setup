// Tests for hooks/update-check.mjs against a small local server that stands in for GitHub.
// Run: node tests/test-update-check.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import { key } from "../scripts/blocks.mjs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/update-check.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "update-check-test-"));
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

// The server answers /version.json with whatever `released` holds and counts the requests
let released = { version: "1.2.0", summary: "A new thing." };
let asked = 0;
let changelog = null; // null: no CHANGELOG.md (404), as an old release had
const server = http.createServer((req, res) => {
  if (req.url === "/CHANGELOG.md") {
    if (changelog === null) { res.statusCode = 404; return res.end(); }
    return res.end(changelog);
  }
  asked++;
  if (req.url !== "/version.json") { res.statusCode = 404; return res.end(); }
  res.end(JSON.stringify(released));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;

// A home folder with this version installed (none: no setup-state.json version)
const home = (name, version) => {
  const dir = path.join(tmp, name, ".claude");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "setup-state.json"), JSON.stringify(version ? { version } : {}));
  return path.join(tmp, name);
};
// The server runs in this process, so the hook is started without blocking it
const run = (h, env = {}) => new Promise((resolve) => {
  const p = spawn(process.execPath, [HOOK], { env: { ...process.env, UPDATE_CHECK: "", SETUP_UPDATE_HOME: h, SETUP_UPDATE_BASE: BASE, ...env } });
  let out = "";
  p.stdout.on("data", (d) => (out += d));
  p.on("close", (code) => resolve({ code, out }));
  p.stdin.end(JSON.stringify({ prompt: "hello" }));
});
const kept = (h) => { try { return JSON.parse(fs.readFileSync(path.join(h, ".claude", "update-check.json"), "utf8")); } catch { return null; } };

const old = home("old", "1.0.0");
const first = await run(old);
const said = first.out ? JSON.parse(first.out) : {};
check("a newer release is announced in one line, with no version number", said.systemMessage === "Setup update ready: A new thing. Type /update-setup; your files are kept.");
check("Claude is told to mention /update-setup and not to install by itself",
  /\/update-setup/.test(said.hookSpecificOutput?.additionalContext || "") && /Don't install it unless the user asks/.test(said.hookSpecificOutput.additionalContext));
check("the event name is UserPromptSubmit", said.hookSpecificOutput?.hookEventName === "UserPromptSubmit");
check("the check is recorded", kept(old)?.latest === "1.2.0");
const before = asked;
const second = await run(old);
check("a second prompt within 12 hours is silent and asks nobody", second.out === "" && asked === before);

fs.writeFileSync(path.join(old, ".claude", "update-check.json"), JSON.stringify({ checkedAt: new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString(), latest: "1.2.0" }));
check("13 hours later it says it again", /1\.2\.0/.test((await run(old)).out));

check("the same version installed: silent", (await run(home("same", "1.2.0"))).out === "");
check("a newer version installed than released: silent", (await run(home("ahead", "1.3.0"))).out === "");
released = { version: "1.10.0" };
check("1.10.0 is newer than 1.9.2", /released: 1\.10\.0 \(installed: 1\.9\.2\)/.test((await run(home("nine", "1.9.2"))).out));
check("a setup with no version on record counts as older", /an older one/.test((await run(home("none"))).out));

// With the changelog: how far behind, and what came in since
released = { version: "1.0.5", summary: "Hotfix for one thing." };
changelog = ["# Changelog", "",
  "- 1.0.6 (Nov 5, 2026): Not released yet, must not be counted.",
  "- 1.0.5 (Nov 4, 2026): Hotfix for one thing.",
  "- 1.0.4 (Nov 3, 2026): Reviews cost half as much.",
  "- 1.0.3 (Nov 2, 2026): A new command that tidies the board.",
  "- 1.0.2 (Nov 1, 2026): Installed already.", ""].join("\n");
const behind = JSON.parse((await run(home("behind", "1.0.2"))).out || "{}");
const ctx = behind.hookSpecificOutput?.additionalContext || "";
// spec 6: the grey line names the installed version's date from the changelog, not "3 releases behind (on 1.0.2)"
check("three releases behind: the grey line names the installed version's date, no version number",
  behind.systemMessage === "Your setup is from Nov 1, 2026. New: 3 more releases. Type /update-setup.");
check("Claude gets the release notes since the installed version, and only those",
  /1\.0\.5: Hotfix/.test(ctx) && /1\.0\.4: Reviews cost half/.test(ctx) && /1\.0\.3: A new command/.test(ctx) && !/1\.0\.6/.test(ctx) && !/1\.0\.2:/.test(ctx));
check("Claude is asked for a short calm list of what the update brings, and still not to install it",
  /three to five plain bullets/.test(ctx) && /no alarm/.test(ctx) && /Don't install it unless the user asks/.test(ctx));
const one = JSON.parse((await run(home("onebehind", "1.0.4"))).out || "{}");
// a release with no `releases` entry counts as important, so Claude's section comes with its one line
check("one release behind: the grey line with the summary, and Claude's section with that release's line",
  one.systemMessage === "Setup update ready: Hotfix for one thing. Type /update-setup; your files are kept." && /1\.0\.5: Hotfix for one thing\./.test(one.hookSpecificOutput?.additionalContext || ""));
changelog = Array.from({ length: 20 }, (_, i) => `- 1.0.${20 - i} (Nov 1, 2026): Change ${20 - i}.`).join("\n");
released = { version: "1.0.20" };
const far = JSON.parse((await run(home("far", "1.0.0"))).out || "{}").hookSpecificOutput?.additionalContext || "";
check("twenty behind: all twenty notes reach Claude in full", Array.from({ length: 20 }, (_, i) => `  - 1.0.${i + 1}: Change ${i + 1}.`).every((l) => far.split(/\r?\n/).includes(l)));

// ---- spec section 7: labels from version.json `releases`, how often, and the self-install of `files` releases
const ago = (h) => new Date(Date.now() - h * 60 * 60 * 1000).toISOString();
const stored = (h) => kept(h) || {};
const restore = (h, extra) => fs.writeFileSync(path.join(h, ".claude", "update-check.json"), JSON.stringify({ ...stored(h), ...extra }));
const log = (lines) => ["# Changelog", "", ...lines.map(([v, text]) => `- ${v} (Nov ${v.split(".")[2]}, 2026): ${text}`), ""].join("\n");
changelog = log([["1.0.5", "Reviews cost half as much on long builds."], ["1.0.4", "Installed already."]]);
released = { version: "1.0.5", summary: "Long summary.", releases: { "1.0.5": { kind: "setup", important: true, headline: "Reviews cost half as much on long builds." } } };
const imp = home("important-one", "1.0.4");
const impSaid = JSON.parse((await run(imp)).out || "{}");
check("1. one behind, important: the grey line with the headline and no version number",
  impSaid.systemMessage === "Setup update ready: Reviews cost half as much on long builds. Type /update-setup; your files are kept." && !/\d+\.\d+\.\d+/.test(impSaid.systemMessage));
check("1. and Claude's section is asked for, with the closing line", /What the update brings you/.test(impSaid.hookSpecificOutput?.additionalContext || "")
  && /Type \/update-setup \(a few minutes, then a Nimbalyst restart\); your own files and skills are kept\./.test(impSaid.hookSpecificOutput.additionalContext));
check("3. right after: silent", (await run(imp)).out === "");
restore(imp, { noticeAt: ago(9), sectionAt: ago(9) });
const nine = JSON.parse((await run(imp)).out || "{}");
check("3. important pending, 9 hours after the last grey line: the grey line again, no section", /^Setup update ready:/.test(nine.systemMessage || "") && !nine.hookSpecificOutput?.additionalContext);
restore(imp, { noticeAt: ago(9), sectionAt: ago(25) });
check("3. 24 hours after the last section: the section again", /What the update brings you/.test(JSON.parse((await run(imp)).out || "{}").hookSpecificOutput?.additionalContext || ""));

released = { version: "1.0.5", releases: { "1.0.5": { kind: "setup", important: false, headline: "A colour fix" } } };
const small = home("unimportant-one", "1.0.4");
const smallSaid = JSON.parse((await run(small)).out || "{}");
check("2. one behind, unimportant: the grey line only", smallSaid.systemMessage === "Setup update ready: A colour fix. Type /update-setup; your files are kept." && !smallSaid.hookSpecificOutput?.additionalContext);
restore(small, { noticeAt: ago(20) });
check("2. a prompt within 24 hours of it is silent", (await run(small)).out === "");
restore(small, { noticeAt: ago(25) });
const dayLater = JSON.parse((await run(small)).out || "{}");
check("2. after 24 hours: the grey line again, still no section", /A colour fix/.test(dayLater.systemMessage || "") && !dayLater.hookSpecificOutput?.additionalContext);

// 4. twenty behind, each line 700 characters: over the 12,000 limit, unimportant lines shrink, oldest first
const long = (v) => `Change ${v}. ${"More words about it. ".repeat(33)}`.trim();
changelog = log(Array.from({ length: 21 }, (_, i) => [`1.0.${20 - i}`, long(`1.0.${20 - i}`)]));
released = { version: "1.0.20", releases: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`1.0.${i + 1}`, { kind: "setup", important: i % 2 === 1, headline: `Headline ${i + 1}` }])) };
const big = JSON.parse((await run(home("twenty-long", "1.0.0"))).out || "{}").hookSpecificOutput?.additionalContext || "";
const bigLines = big.split(/\r?\n/);
check("4. twenty behind: every important line reaches Claude in full", [2, 4, 6, 8, 10, 12, 14, 16, 18, 20].every((n) => bigLines.includes(`  - 1.0.${n}: ${long(`1.0.${n}`)}`)));
check("4. over the size limit the oldest unimportant ones shrink to their headline, the newest stay whole",
  bigLines.includes("  - 1.0.1: Headline 1") && bigLines.includes("  - 1.0.3: Headline 3") && bigLines.includes(`  - 1.0.19: ${long("1.0.19")}`) && /shortened to the headline/.test(big));
const mixed = JSON.parse((await run(home("twenty-mixed", "1.0.17"))).out || "{}");
check("6. the grey line for many behind names the installed version's date and the important headlines",
  mixed.systemMessage === "Your setup is from Nov 17, 2026. New: Headline 20, Headline 18; plus 1 smaller fix. Type /update-setup.");

// 5 and 9: the self-install. A stand-in for update.mjs in the home writes what it was started with and then, after a
// while, its result as update.mjs --files-only does (STUB_RESULT: ok or the error)
const stubHome = (name, version) => {
  const h = home(name, version);
  const stub = path.join(h, ".claude", "skills", "update-setup", "update.mjs");
  fs.mkdirSync(path.dirname(stub), { recursive: true });
  fs.writeFileSync(stub, `import fs from "node:fs";
import path from "node:path";
const claude = path.join(process.argv[process.argv.indexOf("--home") + 1], ".claude");
fs.writeFileSync(path.join(claude, "started.json"), JSON.stringify(process.argv.slice(2)));
setTimeout(() => {
  const file = path.join(claude, "update-check.json");
  const kept = JSON.parse(fs.readFileSync(file, "utf8"));
  const ok = process.env.STUB_RESULT === "ok";
  kept.auto = { version: kept.autoRun.version, from: kept.autoRun.from, headline: "A faster link check", at: new Date().toISOString(), ok, ...(ok ? {} : { error: process.env.STUB_RESULT }) };
  delete kept.autoRun;
  fs.writeFileSync(file, JSON.stringify(kept));
  if (ok) fs.writeFileSync(path.join(claude, "setup-state.json"), JSON.stringify({ version: kept.auto.version }));
  fs.writeFileSync(path.join(claude, "ended"), "");
}, 1500);
`);
  return h;
};
const at = (h, f) => path.join(h, ".claude", f);
const waitFor = async (file, ms) => { for (const end = Date.now() + ms; Date.now() < end; await new Promise((r) => setTimeout(r, 100))) if (fs.existsSync(file)) return true; return false; };
changelog = log([["1.0.7", "A faster link check."], ["1.0.6", "A clearer hook message."], ["1.0.5", "Installed already."]]);
const filesOnly = { "1.0.7": { kind: "files", important: false, headline: "A faster link check" }, "1.0.6": { kind: "files", important: true, headline: "A clearer hook message" } };
released = { version: "1.0.7", releases: filesOnly };
const autoOk = stubHome("auto-ok", "1.0.5");
const autoStart = Date.now();
const started = await run(autoOk, { STUB_RESULT: "ok" });
const startMs = Date.now() - autoStart;
check(`9. all missed releases are files: the prompt is not held up (${startMs} ms) and says nothing yet`, started.out === "" && !fs.existsSync(at(autoOk, "ended")) && startMs < 1500);
check("9. update.mjs --files-only was started on its own", await waitFor(at(autoOk, "started.json"), 5000) && JSON.parse(fs.readFileSync(at(autoOk, "started.json"), "utf8")).includes("--files-only"));
fs.rmSync(at(autoOk, "started.json"));
const during = await run(autoOk, { STUB_RESULT: "ok" });
check("9. while it runs, a prompt is silent and starts no second one", during.out === "" && !fs.existsSync(at(autoOk, "started.json")));
await waitFor(at(autoOk, "ended"), 5000);
const doneSaid = JSON.parse((await run(autoOk)).out || "{}");
check("9. the next prompt: one grey line that the setup updated itself, no section",
  doneSaid.systemMessage === "Setup updated itself to 1.0.7: A faster link check." && !doneSaid.hookSpecificOutput?.additionalContext);
check("9. said once", (await run(autoOk)).out === "");

// the stub's failure: said once with its error, not tried again for that version, the reminder takes over
const autoBad = stubHome("auto-fail", "1.0.5");
await run(autoBad, { STUB_RESULT: "could not download v1.0.7.tar.gz (HTTP 404)" });
await waitFor(at(autoBad, "ended"), 5000);
fs.rmSync(at(autoBad, "started.json"));
const failSaid = JSON.parse((await run(autoBad)).out || "{}");
check("9. a failed self-install: one grey line with the error", failSaid.systemMessage === "Setup could not update itself to 1.0.7: could not download v1.0.7.tar.gz (HTTP 404). Type /update-setup to install it.");
restore(autoBad, { noticeAt: ago(9), sectionAt: ago(25) });
const afterFail = JSON.parse((await run(autoBad)).out || "{}");
await new Promise((r) => setTimeout(r, 700));
check("9. it is not tried again for the same version; the reminder covers it",
  !fs.existsSync(at(autoBad, "started.json")) && /^Your setup is from Nov 5, 2026\. New: A clearer hook message; plus 1 smaller fix\./.test(afterFail.systemMessage || "") && !/could not update/.test(afterFail.systemMessage));

const stale = stubHome("auto-stale", "1.0.5");
await run(stale, { AUTO_UPDATE: "off" }); // the check is stored; a self-install started an hour ago never came back
restore(stale, { autoRun: { version: "1.0.7", from: "1.0.5", startedAt: ago(1) } });
check("9. a self-install that never wrote its result in 15 minutes counts as failed, said once",
  /^Setup could not update itself to 1\.0\.7: it did not finish within 15 minutes\./.test(JSON.parse((await run(stale)).out || "{}").systemMessage || ""));
// review fixes: the kept files are counted, a lock stops a second start, a broken settings.json still reminds,
// and an answer stored by 1.0.108 (no summary) still reminds
const keptHome = stubHome("auto-kept", "1.0.5");
await run(keptHome, { AUTO_UPDATE: "off" });
restore(keptHome, { auto: { version: "1.0.7", from: "1.0.5", headline: "A faster link check", at: ago(0), ok: true, kept: ["hooks/link-gate.mjs", "skills/x/SKILL.md"] } });
check("a self-install that left changed files names how many stayed theirs and /update-setup",
  JSON.parse((await run(keptHome)).out || "{}").systemMessage === "Setup updated itself to 1.0.7: A faster link check. 2 files you changed stayed as yours; /update-setup can take the new version of them.");
const locked = stubHome("auto-locked", "1.0.5");
fs.writeFileSync(at(locked, "update-auto.lock"), "");
await run(locked);
await new Promise((r) => setTimeout(r, 700));
check("a self-install lock held by another prompt: nothing started", !fs.existsSync(at(locked, "started.json")));
const staleLock = stubHome("auto-stale-lock", "1.0.5");
fs.writeFileSync(at(staleLock, "update-auto.lock"), "");
fs.utimesSync(at(staleLock, "update-auto.lock"), new Date(Date.now() - 3600000), new Date(Date.now() - 3600000));
await run(staleLock, { STUB_RESULT: "ok" });
check("a lock older than 15 minutes is taken over and the self-install starts", await waitFor(at(staleLock, "started.json"), 5000));
const badSettingsLog = path.join(tmp, "bad-settings-crash.log");
const badSettings = stubHome("auto-bad-settings", "1.0.5");
fs.writeFileSync(at(badSettings, "settings.json"), "{ not json");
const badOut = JSON.parse((await run(badSettings, { HOOK_ERRORS_LOG: badSettingsLog })).out || "{}");
await new Promise((r) => setTimeout(r, 700));
check("settings.json that is not JSON: crash-logged, nothing started, the reminder still shows",
  !fs.existsSync(at(badSettings, "started.json")) && /^Your setup is from/.test(badOut.systemMessage || "") && /not valid JSON/.test(fs.existsSync(badSettingsLog) ? fs.readFileSync(badSettingsLog, "utf8") : ""));
const oldShape = home("old-shape", "1.0.5");
fs.writeFileSync(at(oldShape, "update-check.json"), JSON.stringify({ checkedAt: ago(1), latest: "1.0.7" }));
check("an update-check.json from 1.0.108 (no summary): the reminder still shows",
  JSON.parse((await run(oldShape)).out || "{}").systemMessage === "Setup update ready. Type /update-setup; your files are kept.");
const noStart = async (name, env, extra) => {
  const h = stubHome(name, "1.0.5");
  extra?.(h);
  const out = JSON.parse((await run(h, env)).out || "{}");
  await new Promise((r) => setTimeout(r, 700));
  return { started: fs.existsSync(at(h, "started.json")), out };
};
const offEnv = await noStart("auto-off-env", { AUTO_UPDATE: "off" });
check("9. AUTO_UPDATE=off in the environment: nothing started, the reminder instead", !offEnv.started && /^Your setup is from/.test(offEnv.out.systemMessage || ""));
const offSet = await noStart("auto-off-settings", {}, (h) => fs.writeFileSync(at(h, "settings.json"), JSON.stringify({ env: { AUTO_UPDATE: "off" } })));
check("9. AUTO_UPDATE=off in settings.json env: nothing started", !offSet.started && /^Your setup is from/.test(offSet.out.systemMessage || ""));
released = { version: "1.0.7", releases: { ...filesOnly, "1.0.6": { kind: "setup", important: true, headline: "A new command" } } };
const oneSetup = await noStart("auto-one-setup", {});
check("9. one setup release among the missed: nothing started, the reminder covers all", !oneSetup.started && /New: A new command; plus 1 smaller fix/.test(oneSetup.out.systemMessage || ""));
released = { version: "1.0.7", releases: { "1.0.7": filesOnly["1.0.7"] } };
const noEntry = await noStart("auto-no-entry", {});
check("5. a missed release with no entry counts as setup and important: nothing started, Claude's section asked for",
  !noEntry.started && /What the update brings you/.test(noEntry.out.hookSpecificOutput?.additionalContext || ""));
released = { version: "1.0.7" };
const oldServer = await noStart("old-server", {});
check("7. version.json without releases (an old server): reminds as before, nothing started",
  !oldServer.started && /^Your setup is from Nov 5, 2026\. New: 2 more releases\./.test(oldServer.out.systemMessage || "") && /1\.0\.7: A faster link check\./.test(oldServer.out.hookSpecificOutput?.additionalContext || ""));

changelog = null;
released = { version: "1.10.0" };

const off = home("off", "1.0.0");
const askedBeforeOff = asked;
check("UPDATE_CHECK=off: silent, asks nobody", (await run(off, { UPDATE_CHECK: "off" })).out === "" && asked === askedBeforeOff && kept(off) === null);

const down = home("down", "1.0.0");
const offline = await run(down, { SETUP_UPDATE_BASE: "http://127.0.0.1:9" });
check("GitHub not reachable: silent, exits cleanly", offline.out === "" && offline.code === 0);
check("the failure and its reason are kept, no check is recorded", !!kept(down)?.failedAt && /\S/.test(kept(down)?.error || "") && !kept(down)?.checkedAt);
const missing = home("missing", "1.0.0");
const notFound = await run(missing, { SETUP_UPDATE_BASE: `${BASE}/nowhere` });
check("an address that answers 404: silent, and the reason (HTTP 404) is kept", notFound.out === "" && notFound.code === 0 && kept(missing)?.error === "HTTP 404");
// Offline, a refused connection and an HTTP error are the hourly retry's business, not crashes: they leave no line in the crash log
const crashLogFile = path.join(os.tmpdir(), `update-check-crash-${process.pid}.log`);
fs.rmSync(crashLogFile, { force: true });
await run(home("quiet404", "1.0.0"), { SETUP_UPDATE_BASE: `${BASE}/nowhere`, HOOK_ERRORS_LOG: crashLogFile });
await run(home("quietdown", "1.0.0"), { SETUP_UPDATE_BASE: "http://127.0.0.1:9", HOOK_ERRORS_LOG: crashLogFile });
check("a 404 and a refused connection leave no line in the crash log", !fs.existsSync(crashLogFile));

// An address that never answers (a dropped connection, as with no network): a prompt must not wait long
let hung = 0;
const hang = http.createServer((req) => { if (req.url === "/version.json") hung++; }); // the changelog is asked beside it
await new Promise((r) => hang.listen(0, "127.0.0.1", r));
const HANG = `http://127.0.0.1:${hang.address().port}`;
const stuck = home("stuck", "1.0.0");
let t0 = Date.now();
const slow = await run(stuck, { SETUP_UPDATE_BASE: HANG });
const firstMs = Date.now() - t0;
check(`no answer: the first prompt waits under a second (${firstMs} ms), silent, exit 0`, firstMs < 1000 && slow.out === "" && slow.code === 0);
check("no answer: the reason is kept", /no answer in time/.test(kept(stuck)?.error || ""));
const hungBefore = hung;
t0 = Date.now();
const again = await run(stuck, { SETUP_UPDATE_BASE: HANG });
const againMs = Date.now() - t0;
check(`the next prompts do not ask again for an hour (${againMs} ms, no request)`, again.out === "" && hung === hungBefore && againMs < 500);
fs.writeFileSync(path.join(stuck, ".claude", "update-check.json"), JSON.stringify({ failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), error: "no answer in time" }));
await run(stuck, { SETUP_UPDATE_BASE: HANG });
check("two hours after a failure it asks again", hung === hungBefore + 1);
fs.writeFileSync(path.join(stuck, ".claude", "update-check.json"), JSON.stringify({ failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), error: "no answer in time" }));
const back = await run(stuck);
check("a good answer after a failure announces the update and clears the failure", /1\.10\.0/.test(back.out) && kept(stuck)?.latest === "1.10.0" && !kept(stuck)?.failedAt);
hang.closeAllConnections?.();
hang.close();

// A slow line: an answer that takes 1.2 seconds is missed at the short wait and heard on the try after a timeout
const slowLine = http.createServer((req, res) => setTimeout(() => res.end(JSON.stringify({ version: "1.11.0" })), 1200));
await new Promise((r) => slowLine.listen(0, "127.0.0.1", r));
const SLOW = `http://127.0.0.1:${slowLine.address().port}`;
const late = home("late-line", "1.0.0");
fs.writeFileSync(path.join(late, ".claude", "update-check.json"), JSON.stringify({ failedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(), error: "no answer in time" }));
const heard = await run(late, { SETUP_UPDATE_BASE: SLOW });
check("after a timeout the next try waits longer, so a slow line still hears of an update", /1\.11\.0/.test(heard.out) && kept(late)?.latest === "1.11.0");
slowLine.closeAllConnections?.(); slowLine.close();

// ---- the tidy offer: own rules not tidied yet are noted once per change, outside the reminder chain
const OWN = fileURLToPath(new URL("../skills/update-setup/own-rules.mjs", import.meta.url));
const ownRun = (h, ...flags) => spawnSync(process.execPath, [OWN, "--home", h, ...flags], { encoding: "utf8" });
const MINE = "## Mine\n\n- Prices in cents.\n";
// a home on 1.2.0 with my-rules.md (none when text is null), a fresh check on record, and the given state and answer
const rulesHome = (name, { state = {}, answer = {}, text = MINE } = {}) => {
  const c = path.join(home(name, "1.2.0"), ".claude");
  if (text !== null) { fs.mkdirSync(path.join(c, "rules"), { recursive: true }); fs.writeFileSync(path.join(c, "rules", "my-rules.md"), text); }
  fs.writeFileSync(path.join(c, "setup-state.json"), JSON.stringify({ version: "1.2.0", ...state }));
  fs.writeFileSync(path.join(c, "update-check.json"), JSON.stringify({ checkedAt: new Date().toISOString(), latest: "1.2.0", installed: "1.2.0", ...answer }));
  return path.dirname(c);
};
const noteOf = (r) => { try { return JSON.parse(r.out).hookSpecificOutput?.additionalContext || ""; } catch { return ""; } };
// what an install, update or own-rules.mjs does to setup-state.json: a new modification time
const touch = (h) => { const t = new Date(Date.now() + 60000 * Math.random() + 1000); fs.utimesSync(path.join(h, ".claude", "setup-state.json"), t, t); };
const pendingOf = (h) => ownRun(h, "--status", "--homes").stdout.match(/^pending: (\w+)$/m)?.[1];

const carved = rulesHome("own-carve");
const n1 = noteOf(await run(carved));
check("own rules left by a carve: the next prompt asks Claude to offer the tidy, naming size, tidy.md and --skip --homes",
  /^\[update-check\] Rules this person wrote are not tidied yet: ~\/\.claude\/rules\/my-rules\.md \(3 lines, about \d+ tokens loaded in every chat\)/.test(n1)
  && /tidy\.md/.test(n1) && /own-rules\.mjs --skip --homes/.test(n1));
check("the hook's pending key is the one own-rules.mjs --status prints", !!kept(carved)?.ownNoted && kept(carved).ownNoted === pendingOf(carved));
const n2 = await run(carved);
touch(carved);
const n3 = await run(carved);
check("once per change: silent on the next prompt, and after another state write with the same files", n2.out === "" && n3.out === "");
fs.appendFileSync(path.join(carved, ".claude", "rules", "my-rules.md"), "- Metric units.\n");
touch(carved);
check("a changed file after the next state write is noted again", /not tidied yet/.test(noteOf(await run(carved))));

const staleOwn = rulesHome("own-stale", { answer: { latest: "1.2.0", installed: "1.0.0" } });
const staleOwnOut = await run(staleOwn);
check("a stale installed (updated since the check) doesn't swallow the note", /not tidied yet/.test(noteOf(staleOwnOut)) && kept(staleOwn)?.installed === "1.2.0");
const behindOwn = rulesHome("own-old-text", { state: { version: "1.0.0" }, answer: { latest: "1.2.0", installed: "1.0.0" } });
const both = JSON.parse((await run(behindOwn)).out || "{}");
check("an old-text updater with a version pending: the note comes merged after the release section, the grey line kept",
  /A newer version of the Claude Code setup is released[\s\S]*\n\n\[update-check\] Rules this person wrote are not tidied yet/.test(both.hookSpecificOutput?.additionalContext || "") && !!both.systemMessage);

const offeredHome = rulesHome("own-offered");
check("no note once /update-setup made the offer (own-rules.mjs --offered)", ownRun(offeredHome, "--offered").status === 0 && (await run(offeredHome)).out === "");
const skippedHome = rulesHome("own-skipped");
check("no note after --skip --homes", ownRun(skippedHome, "--skip", "--homes").status === 0 && (await run(skippedHome)).out === "");
const appliedHome = rulesHome("own-applied");
const ledgerOut = path.join(tmp, "own-applied.out.md");
fs.writeFileSync(ledgerOut, MINE);
const mineFile = path.join(appliedHome, ".claude", "rules", "my-rules.md").replace(/\\/g, "/");
fs.writeFileSync(path.join(tmp, "own-applied.json"), JSON.stringify({ ledger: 1, files: [{ file: mineFile, sha: crypto.createHash("sha256").update(MINE).digest("hex"), out: ledgerOut,
  blocks: [{ id: "B1", key: key("## Mine"), kind: "heading", verdict: "keep" }, { id: "B2", key: key("- Prices in cents."), kind: "own", verdict: "keep" }] }] }));
check("no note after --apply <ledger>", ownRun(appliedHome, "--apply", path.join(tmp, "own-applied.json")).status === 0 && (await run(appliedHome)).out === "");
const noRules = rulesHome("own-none", { text: null });
check("no my-rules.md: silent, nothing noted", (await run(noRules)).out === "" && !kept(noRules)?.ownNoted);

const projs = path.join(tmp, "own-projects");
const thesis = path.join(projs, "thesis");
fs.mkdirSync(path.join(thesis, ".claude", "rules"), { recursive: true });
fs.writeFileSync(path.join(thesis, ".claude", "rules", "my-rules.md"), "- Cite in APA 7.\n");
const homeOnly = rulesHome("own-home", { text: null, state: { projects: projs.replace(/\\/g, "/"), written: { [path.join(thesis, "CLAUDE.md").replace(/\\/g, "/")]: "0" } } });
const hn = noteOf(await run(homeOnly));
check("a project home's own rules alone are noted, and the key matches own-rules.mjs --status --homes",
  /not tidied yet: 1 project folder's own rules\./.test(hn) && kept(homeOnly)?.ownNoted === pendingOf(homeOnly));
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
