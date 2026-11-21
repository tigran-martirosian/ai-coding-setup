#!/usr/bin/env node
// Checks of workers/try-page.mjs against throwaway local http servers this test starts on port 0: a page that
// answers (any status; host 0.0.0.0 taken as localhost) gets its page file under TRY_PAGE_HOME (a temp folder whose
// path holds a space, ( ), # and %) and one stdout line with a markdown link to it that decodes back to the file;
// a refused port, a server that never answers (TRY_PAGE_TIMEOUT_MS cut short), a non-http(s) or non-local url, a
// url with a user name or password, a missing or odd session id, or no url gets a non-zero exit, one stderr line
// and no file. A page file that cannot be written (home is a file; a folder in the page file's place) is exit 1,
// one line, no .part file left. Run: node tests/test-try-page.mjs
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKER = path.join(REPO, "workers", "try-page.mjs");

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-try-page-"));
const HOME = path.join(tmp, "home dir (x) #1 %41");
const STATE = path.join(HOME, ".claude", "state", "try-it");
const servers = [];
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));

// A server on a free port; status: what it answers, null: it accepts and never answers.
const serve = (status, host = "127.0.0.1") =>
  new Promise((resolve, reject) => {
    const s = http.createServer((_req, res) => {
      if (status === null) return;
      res.writeHead(status, { "content-type": "text/plain" });
      res.end("hello");
    });
    s.on("error", reject);
    s.listen(0, host, () => {
      servers.push(s);
      resolve(s.address().port);
    });
  });

// The worker runs async: a spawnSync would block this process's servers from answering.
const run = (args, env = {}) =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, [WORKER, ...args], {
      env: { ...process.env, TRY_PAGE_HOME: HOME, ...env },
    });
    let out = "",
      err = "";
    c.stdout.on("data", (d) => {
      out += d;
    });
    c.stderr.on("data", (d) => {
      err += d;
    });
    c.on("close", (code) => resolve({ code, out, err }));
  });

const files = () => (fs.existsSync(STATE) ? fs.readdirSync(STATE) : []);
const clear = () =>
  fs.rmSync(path.join(HOME, ".claude"), { recursive: true, force: true });
const lines = (s) => s.split("\n").filter((l) => l.trim()).length;
// The file's absolute path as a link target: forward slashes, a "/" before a drive letter ("/C:/...").
const asLinkPath = (file) => {
  const p = path.resolve(file).replaceAll("\\", "/");
  return /^[A-Za-z]:/.test(p) ? `/${p}` : p;
};
const linkOf = (out) => out.match(/\]\((.*)\)\s*$/)?.[1] ?? "";

// ---------------- a page that answers ----------------
const port = await serve(200);
const url = `http://127.0.0.1:${port}/`;
let before = Date.now();
let r = await run([url, "--session", "abc_DEF-123"]);
let after = Date.now();
const file = path.join(STATE, "abc_DEF-123.browser.json");
ok("a page that answers exits 0", r.code === 0, `exit ${r.code}; ${r.err}`);
ok(
  "a page that answers writes <home>/.claude/state/try-it/<id>.browser.json",
  fs.existsSync(file),
  files().join(", "),
);
let page = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
ok(
  "the page file holds version, url, title, ts and nothing else",
  JSON.stringify(Object.keys(page)) ===
    JSON.stringify(["version", "url", "title", "ts"]) &&
    page.version === 1 &&
    page.url === url &&
    page.title === `Try it: 127.0.0.1:${port}`,
  JSON.stringify(page),
);
ok(
  "the page file's ts is the write time in ms",
  Number.isInteger(page.ts) && page.ts >= before && page.ts <= after,
  `ts ${page.ts}, run ${before}..${after}`,
);
const link = linkOf(r.out);
let decoded = "";
try {
  decoded = decodeURIComponent(link);
} catch {}
ok(
  "stdout is one line with a markdown link whose target decodes back to the file's path",
  lines(r.out) === 1 && decoded === asLinkPath(file),
  `link ${link}\n      want ${asLinkPath(file)}`,
);
ok(
  "the link target has no raw space, ( ) # or stray %, so the markdown link survives",
  link !== "" && !/[ ()#]|%(?![0-9A-F]{2})/.test(link),
  link,
);
ok(
  "on Windows the link target starts with /<drive>:/",
  process.platform !== "win32" || /^\/[A-Za-z]:\//.test(link),
  link,
);
ok(
  "stdout says the link opens the page in a tab beside the chat, not that it opened",
  /link opens it in a Nimbalyst browser tab beside the chat/.test(r.out),
  r.out,
);
ok("a page that answers prints nothing on stderr", r.err === "", r.err);

// The session flag before the url, the host by name, and a server error: a live server answers
r = await run(["--session", "s2", `http://localhost:${port}/app?x=1`]);
page = fs.existsSync(path.join(STATE, "s2.browser.json"))
  ? JSON.parse(fs.readFileSync(path.join(STATE, "s2.browser.json"), "utf8"))
  : {};
ok(
  "--session before the url, host localhost: written",
  r.code === 0 &&
    page.url === `http://localhost:${port}/app?x=1` &&
    page.title === `Try it: localhost:${port}`,
  `exit ${r.code}; ${r.err}; ${JSON.stringify(page)}`,
);
const port500 = await serve(500);
r = await run([`http://127.0.0.1:${port500}/`, "--session", "s3"]);
ok(
  "a server answering 500 counts as answering",
  r.code === 0 && fs.existsSync(path.join(STATE, "s3.browser.json")),
  `exit ${r.code}; ${r.err}`,
);

// 0.0.0.0, as dev servers print it, is opened as localhost
r = await run([`http://0.0.0.0:${port}/x`, "--session", "s0"]);
page = fs.existsSync(path.join(STATE, "s0.browser.json"))
  ? JSON.parse(fs.readFileSync(path.join(STATE, "s0.browser.json"), "utf8"))
  : {};
ok(
  "host 0.0.0.0 is written as localhost",
  r.code === 0 &&
    page.url === `http://localhost:${port}/x` &&
    page.title === `Try it: localhost:${port}`,
  `exit ${r.code}; ${r.err}; ${JSON.stringify(page)}`,
);

// IPv6 loopback, where this machine has it
const port6 = await serve(200, "::1").catch(() => null);
if (port6) {
  r = await run([`http://[::1]:${port6}/`, "--session", "s6"]);
  page = fs.existsSync(path.join(STATE, "s6.browser.json"))
    ? JSON.parse(fs.readFileSync(path.join(STATE, "s6.browser.json"), "utf8"))
    : {};
  ok(
    "host [::1] is local and written",
    r.code === 0 && page.title === `Try it: [::1]:${port6}`,
    `exit ${r.code}; ${r.err}; ${JSON.stringify(page)}`,
  );
} else console.log("skip  [::1]: this machine has no IPv6 loopback");

// ---------------- refusals: non-zero, one stderr line, no file ----------------
const refuses = async (name, args, code, env = {}) => {
  clear();
  const res = await run(args, env);
  ok(
    `${name}: exit ${code}`,
    res.code === code,
    `exit ${res.code}; ${res.err}`,
  );
  ok(
    `${name}: one stderr line naming the problem`,
    lines(res.err) === 1 &&
      res.err.startsWith("try-page:") &&
      !/\n\s+at /.test(res.err),
    res.err,
  );
  ok(`${name}: nothing on stdout`, res.out === "", res.out);
  ok(`${name}: no file written`, files().length === 0, files().join(", "));
  return res;
};

// A port that refuses: a server's port, closed again
const closed = await serve(200);
await new Promise((res) => servers.pop().close(res));
r = await refuses(
  "a refused connection",
  [`http://127.0.0.1:${closed}/`, "--session", "s"],
  1,
);
ok("a refused connection names it", /does not answer/.test(r.err), r.err);
const hang = await serve(null);
before = Date.now();
r = await refuses(
  "a server that never answers",
  [`http://127.0.0.1:${hang}/`, "--session", "s"],
  1,
  { TRY_PAGE_TIMEOUT_MS: "300" },
);
after = Date.now();
ok(
  "a server that never answers is cut at the time limit",
  /does not answer/.test(r.err) && after - before < 4000,
  `${after - before} ms; ${r.err}`,
);

r = await refuses("no url", ["--session", "s"], 2);
ok("no url says so", /url/i.test(r.err), r.err);
r = await refuses("no session", [url], 2);
ok("no session says so", /session/i.test(r.err), r.err);
r = await refuses("--session with no id after it", [url, "--session"], 2);
for (const id of ["../x", "a/b", "a b", "a.b", ""]) {
  r = await refuses(
    `odd session id ${JSON.stringify(id)}`,
    [url, "--session", id],
    2,
  );
  ok(
    `odd session id ${JSON.stringify(id)} names the session`,
    /session/i.test(r.err),
    r.err,
  );
}
for (const bad of [
  "ftp://127.0.0.1/",
  "file:///C:/x.html",
  "javascript:alert(1)",
  "127.0.0.1:3000",
  "not a url",
]) {
  r = await refuses(`non-http(s) url ${bad}`, [bad, "--session", "s"], 2);
}
for (const bad of [
  "http://example.com/",
  "http://10.0.0.1:3000/",
  "http://192.168.1.2/",
  "http://localhost.example.com/",
  "http://127.0.0.2/",
]) {
  r = await refuses(`non-local host ${bad}`, [bad, "--session", "s"], 2);
  ok(`non-local host ${bad} names the host`, /host/i.test(r.err), r.err);
}
r = await refuses("an unknown flag", [url, "--session", "s", "--open"], 2);
r = await refuses("two urls", [url, url, "--session", "s"], 2);
for (const cred of ["zuser:s3cretpw@", "zuser@", ":s3cretpw@"]) {
  const withCred = `http://${cred}127.0.0.1:${port}/`;
  r = await refuses(
    `a url with a user or password (${cred})`,
    [withCred, "--session", "s"],
    2,
  );
  ok(
    `a url with a user or password (${cred}) is named without echoing them`,
    /user name or password/.test(r.err) && !/zuser|s3cretpw/.test(r.err),
    r.err,
  );
}

// ---------------- the file cannot be written: exit 1, one line, no .part left ----------------
const NOTDIR = path.join(tmp, "a file");
fs.writeFileSync(NOTDIR, "");
r = await run([url, "--session", "s"], { TRY_PAGE_HOME: NOTDIR });
ok(
  "a home whose state folder cannot be made: exit 1 with one stderr line",
  r.code === 1 &&
    lines(r.err) === 1 &&
    r.err.startsWith("try-page:") &&
    r.out === "",
  `exit ${r.code}; ${r.err}`,
);
clear();
fs.mkdirSync(path.join(STATE, "blocked.browser.json", "inside"), {
  recursive: true,
});
before = Date.now();
r = await run([url, "--session", "blocked"]);
after = Date.now();
ok(
  "a page file that cannot be renamed into place: exit 1 with one stderr line",
  r.code === 1 &&
    lines(r.err) === 1 &&
    r.err.startsWith("try-page:") &&
    r.out === "",
  `exit ${r.code}; ${r.err}`,
);
ok(
  "a failed write leaves no .part file behind",
  !files().some((f) => f.endsWith(".part")),
  files().join(", "),
);
ok(
  "a failed rename on Windows is retried (about 5 x 100 ms) before giving up",
  process.platform !== "win32" || after - before >= 400,
  `${after - before} ms; ${r.err}`,
);

for (const s of servers) s.close();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
