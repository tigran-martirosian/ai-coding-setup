// Tests for hooks/update-check.mjs against a small local server that stands in for GitHub.
// Run: node tests/test-update-check.mjs
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
check("GitHub not reachable: silent, exits cleanly, tries again next time", offline.out === "" && offline.code === 0 && kept(down) === null);
const missing = await run(down, { SETUP_UPDATE_BASE: `${BASE}/nowhere` });
check("an address that answers 404: silent and nothing recorded", missing.out === "" && missing.code === 0 && kept(down) === null);

server.close();
fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
