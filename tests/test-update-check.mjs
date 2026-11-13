// Tests for hooks/update-check.mjs against a small local server that stands in for GitHub.
// Run: node tests/test-update-check.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawn } from "node:child_process";
import fs from "node:fs";
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
const server = http.createServer((req, res) => {
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
check("a newer release is announced in one line", /Setup update ready: version 1\.2\.0\. A new thing\. Type \/update-setup/.test(said.systemMessage || ""));
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
check("1.10.0 is newer than 1.9.2", /version 1\.10\.0\. Type/.test((await run(home("nine", "1.9.2"))).out));
check("a setup with no version on record counts as older", /an older one/.test((await run(home("none"))).out));

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
const hang = http.createServer(() => { hung++; });
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
server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
