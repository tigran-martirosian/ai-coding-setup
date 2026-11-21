#!/usr/bin/env node
// Checks of workers/read-page.mjs with no network: a stand-in Firecrawl Local (FIRECRAWL_LOCAL) and a stand-in
// npx (READ_PAGE_NPX) print what the real programs printed on 2026-11-20 (Firecrawl Local 0.1.1's JSON envelope
// for a local read of the npm defuddle page, a cloud read of G2's Slack reviews, a GitHub 404 page and a failed
// read; defuddle 0.19.7's markdown and its "Error: fetch failed"), and log the arguments, FIRECRAWL_CLOUD and the
// folder they ran in. The pages are on documentation addresses (203.0.113.x, 198.51.100.x): they need no DNS, and
// the stand-ins answer by the path (/reviews: a cloud read, /fail, /empty, /notfound, /slow).
// Run: node tests/test-read-page.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const WORKER = path.join(REPO, "workers", "read-page.mjs");

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-read-page-"));
const strays = []; // processes a stand-in started, ended at exit if the worker left them running
process.on("exit", () => {
  for (const pid of strays)
    try {
      process.kill(pid);
    } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});
const LOG = path.join(tmp, "calls.log");
const PIDFILE = path.join(tmp, "grandchild.pid");
const EMPTY_DIR = path.join(tmp, "empty");
fs.mkdirSync(EMPTY_DIR);

// Real excerpts (Firecrawl Local 0.1.1 and defuddle 0.19.7, 2026-11-20), cut short
const LOCAL_MD =
  "# defuddle\n\n0.19.13 • Public • Published 6 hours ago\n\n- [Readme](https://www.npmjs.com/package/defuddle?activeTab=readme)\n";
const CLOUD_MD =
  "Slack\n\nBy [Salesforce](https://www.g2.com/sellers/salesforce)\n\n4.5/5(40,575)\n\n###### 4.5 out of 5 stars\n";
const NOTFOUND_MD =
  "[Skip to content](https://github.com/this-user-does-not-exist-zq81x/nope-repo#start-of-content)\n\nYou signed in with another tab or window.\n";
const DEFUDDLE_MD =
  "This domain is for use in documentation examples without needing permission. This is not a service; avoid relying on it for testing and monitoring purposes.\n";
const envelope = (markdown, source, meta, statusCode = 200) =>
  JSON.stringify({
    success: true,
    data: { markdown, metadata: { ...meta, statusCode }, source },
  });
const FAILED = JSON.stringify({
  success: false,
  url: "URL",
  code: "FETCH_FAILED",
  error:
    "error sending request for url (URL): client error (Connect): dns error: error resolving DNS: No such host is known. (os error 11001)",
});

const fakeFirecrawl = path.join(tmp, "fake-firecrawl.mjs");
fs.writeFileSync(
  fakeFirecrawl,
  `import fs from "node:fs";
import { spawn } from "node:child_process";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ tool: "firecrawl", args, cloud: process.env.FIRECRAWL_CLOUD ?? null }) + "\\n");
const url = args[1];
if (url.includes("/fail")) { console.log(${JSON.stringify(FAILED)}.replaceAll("URL", url)); process.exit(1); }
if (url.includes("/empty")) { console.log(${JSON.stringify(envelope("", "local", { title: "" }))}); process.exit(0); }
if (url.includes("/notfound")) { console.log(${JSON.stringify(envelope(NOTFOUND_MD, "local", { title: "Page not found · GitHub · GitHub" }, 404))}); process.exit(0); }
if (url.includes("/reviews")) { console.log(${JSON.stringify(envelope(CLOUD_MD, "firecrawl-cloud", { title: "Slack Reviews November 2026: Details, Pricing, & Features | G2" }))}); process.exit(0); }
if (url.includes("/slow")) {
  // a page that hangs, with a process of its own below it (as a browser would be). On Windows node puts the
  // processes it starts in a job that ends them with their parent; a Rust program's browser is in none, so the
  // stand-in's child leaves the job (detached) to be like it.
  spawn(process.execPath, ["-e", "require('fs').writeFileSync(process.argv[1], String(process.pid)); setInterval(() => {}, 1000)", ${JSON.stringify(PIDFILE)}], { stdio: "ignore", detached: process.platform === "win32", cwd: ${JSON.stringify(os.tmpdir())} });
  setInterval(() => {}, 1000);
} else console.log(${JSON.stringify(envelope(LOCAL_MD, "local", { title: "defuddle - npm" }))});
`,
);
const fakeNpx = path.join(tmp, "fake-npx.mjs");
fs.writeFileSync(
  fakeNpx,
  `import fs from "node:fs";
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(LOG)}, JSON.stringify({ tool: "npx", args, cwd: process.cwd() }) + "\\n");
const url = args[3];
if (url.includes("/fail")) { console.error("Error: fetch failed"); process.exit(1); }
if (url.includes("/empty")) process.exit(0);
process.stdout.write(${JSON.stringify(DEFUDDLE_MD)});
`,
);

const calls = () =>
  fs.existsSync(LOG)
    ? fs
        .readFileSync(LOG, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
// Runs the worker; `firecrawl` false hides Firecrawl Local (no FIRECRAWL_LOCAL, an empty home folder and PATH);
// `node` is the node program that runs it (npx is looked for next to it)
function run(
  args,
  { firecrawl = true, env = {}, cwd = tmp, node = process.execPath } = {},
) {
  fs.rmSync(LOG, { force: true });
  const base = { ...process.env, READ_PAGE_NPX: fakeNpx };
  delete base.FIRECRAWL_LOCAL;
  delete base.FIRECRAWL_CLOUD;
  delete base.READ_PAGE_TIMEOUT_MS;
  if (firecrawl) base.FIRECRAWL_LOCAL = fakeFirecrawl;
  else
    Object.assign(base, {
      USERPROFILE: EMPTY_DIR,
      HOME: EMPTY_DIR,
      PATH: EMPTY_DIR,
      Path: EMPTY_DIR,
    });
  const r = spawnSync(node, [WORKER, ...args], {
    env: { ...base, ...env },
    cwd,
    encoding: "utf8",
    timeout: 30000,
  });
  return {
    code: r.status,
    out: r.stdout || "",
    err: r.stderr || "",
    calls: calls(),
  };
}
// "<file>  <n> chars  <where>" -> { file, chars, from }
const parse = (line) => {
  const m = /^(.+\.md)\s+(\d+) chars\s+(.+)$/.exec(line.trim());
  return m ? { file: m[1], chars: Number(m[2]), from: m[3] } : null;
};
const lines = (s) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const OUT = path.join(tmp, "out");
const saved = () => (fs.existsSync(OUT) ? fs.readdirSync(OUT).length : 0);
const NPM = "https://203.0.113.10/package/defuddle";
const G2 = "https://198.51.100.20/products/slack/reviews";

// ---------------- a local read ----------------
let r = run([NPM, "--out", OUT]);
let p = parse(lines(r.out)[0] || "");
ok("a local read exits 0", r.code === 0, `exit ${r.code}; ${r.err}`);
ok(
  "a local read prints the file, chars and 'firecrawl local'",
  p && p.from === "firecrawl local",
  r.out,
);
ok(
  "a local read saves the page's markdown whole in --out, in a file named read-page-<host and path>",
  p &&
    path.dirname(p.file) === OUT &&
    path
      .basename(p.file)
      .startsWith("read-page-203.0.113.10-package-defuddle") &&
    fs.readFileSync(p.file, "utf8") === LOCAL_MD,
  p && p.file,
);
ok(
  "a local read reports the saved text's length",
  p && p.chars === LOCAL_MD.length,
  p && `${p.chars}`,
);

// ---------------- what Firecrawl is always given ----------------
const fc = r.calls.find((c) => c.tool === "firecrawl");
ok(
  "Firecrawl runs scrape with --browser auto --public-only and the URL",
  fc &&
    JSON.stringify(fc.args) ===
      JSON.stringify(["scrape", NPM, "--browser", "auto", "--public-only"]),
  fc && JSON.stringify(fc.args),
);
ok(
  "Firecrawl gets FIRECRAWL_CLOUD=auto when the caller set nothing",
  fc && fc.cloud === "auto",
  fc && fc.cloud,
);
r = run([NPM, "--out", OUT], { env: { FIRECRAWL_CLOUD: "off" } });
ok(
  "a caller's FIRECRAWL_CLOUD=off is kept",
  r.calls[0]?.cloud === "off",
  JSON.stringify(r.calls),
);
r = run([NPM, "--out", OUT], { env: { FIRECRAWL_CLOUD: "yes" } });
ok(
  "any other FIRECRAWL_CLOUD from the caller becomes auto",
  r.calls[0]?.cloud === "auto",
  JSON.stringify(r.calls),
);
r = run([NPM, "--no-public-only", "--out", OUT]);
ok(
  "a flag the worker does not know (--no-public-only) is refused and nothing is read",
  r.code === 2 && r.calls.length === 0,
  `exit ${r.code}; calls ${JSON.stringify(r.calls)}`,
);

// ---------------- the readers get the parsed URL ----------------
r = run(["HTTPS://203.0.113.10/a b?q=1", "--out", OUT]);
ok(
  "the reader gets the parsed URL (new URL(u).href), not the raw text",
  r.calls[0] && r.calls[0].args[1] === "https://203.0.113.10/a%20b?q=1",
  JSON.stringify(r.calls),
);
r = run(["HTTPS://203.0.113.10/a b?q=1", "--out", OUT], { firecrawl: false });
ok(
  "defuddle gets the parsed URL too",
  r.calls[0] && r.calls[0].args[3] === "https://203.0.113.10/a%20b?q=1",
  JSON.stringify(r.calls),
);

// ---------------- a cloud read ----------------
r = run([G2, "--out", OUT]);
p = parse(lines(r.out)[0] || "");
ok(
  "a cloud read says 'firecrawl cloud'",
  r.code === 0 && p && p.from === "firecrawl cloud",
  `${r.out}${r.err}`,
);
ok(
  "a cloud read saves the cloud's markdown",
  p && fs.readFileSync(p.file, "utf8") === CLOUD_MD,
);

// ---------------- several pages: one file and one line each ----------------
r = run([NPM, G2, "--out", OUT]);
const two = lines(r.out).map(parse);
ok(
  "two pages give two lines and two different files",
  r.code === 0 &&
    two.length === 2 &&
    two.every(Boolean) &&
    two[0].file !== two[1].file,
  r.out,
);

// ---------------- the default folder is the OS temp folder; names do not collide across runs ----------------
const T = path.join(tmp, "os-temp");
fs.mkdirSync(T);
r = run([NPM], { env: { TEMP: T, TMP: T, TMPDIR: T } });
p = parse(lines(r.out)[0] || "");
ok(
  "with no --out the page is saved in the OS temp folder",
  p && path.dirname(p.file) === T,
  r.out + r.err,
);
const again = parse(
  lines(run([NPM], { env: { TEMP: T, TMP: T, TMPDIR: T } }).out)[0] || "",
);
ok(
  "the same page read twice into the shared temp folder gets two files (a random part in the name)",
  p &&
    again &&
    p.file !== again.file &&
    fs.existsSync(p.file) &&
    fs.existsSync(again.file),
  `${p && p.file} / ${again && again.file}`,
);

// ---------------- Firecrawl not found: defuddle 0.19.7 ----------------
const caller = path.join(tmp, "caller");
fs.mkdirSync(caller);
fs.writeFileSync(path.join(caller, ".npmrc"), "registry=http://127.0.0.1:9/\n");
r = run(["https://203.0.113.30/", "--out", OUT], {
  firecrawl: false,
  cwd: caller,
});
p = parse(lines(r.out)[0] || "");
const nx = r.calls.find((c) => c.tool === "npx");
ok(
  "with no Firecrawl Local the page is read by npx -y defuddle@0.19.7 parse <url> --md",
  nx &&
    JSON.stringify(nx.args) ===
      JSON.stringify([
        "-y",
        "defuddle@0.19.7",
        "parse",
        "https://203.0.113.30/",
        "--md",
      ]),
  nx ? JSON.stringify(nx.args) : `no npx call; exit ${r.code}; ${r.err}`,
);
ok(
  "a defuddle read says 'defuddle' and saves its text",
  r.code === 0 &&
    p &&
    p.from === "defuddle" &&
    fs.readFileSync(p.file, "utf8") === DEFUDDLE_MD,
  r.out + r.err,
);
ok(
  "with no Firecrawl Local, Firecrawl is not run",
  !r.calls.some((c) => c.tool === "firecrawl"),
);
ok(
  "npx runs in an empty folder of its own (not the caller's, with its .npmrc), removed afterwards",
  nx && path.resolve(nx.cwd) !== path.resolve(caller) && !fs.existsSync(nx.cwd),
  nx && nx.cwd,
);

// ---------------- the PATH search skips relative entries ----------------
fs.mkdirSync(path.join(caller, "bin"));
fs.writeFileSync(
  path.join(
    caller,
    "bin",
    process.platform === "win32" ? "firecrawl-local.exe" : "firecrawl-local",
  ),
  "not a program",
);
r = run(["https://203.0.113.30/", "--out", OUT], {
  firecrawl: false,
  cwd: caller,
  env: { PATH: "bin", Path: "bin" },
});
ok(
  "a firecrawl-local in a relative PATH entry is not used",
  r.code === 0 && /defuddle$/.test(lines(r.out)[0] || ""),
  `exit ${r.code}; ${r.out}${r.err}`,
);

// ---------------- npx found on the PATH, when the node that runs the worker has no npm next to it ----------------
// A node program alone in a folder (a hard link, or a copy across drives), and a PATH folder in npm's Windows
// layout: npx.cmd beside node_modules/npm/bin/npx-cli.js (here the stand-in npx)
{
  const lone = path.join(tmp, "lone-node");
  fs.mkdirSync(lone);
  const loneNode = path.join(lone, path.basename(process.execPath));
  try {
    fs.linkSync(process.execPath, loneNode);
  } catch {
    fs.copyFileSync(process.execPath, loneNode);
  }
  const npmHome = path.join(tmp, "npm-home");
  const npmBin = path.join(npmHome, "node_modules", "npm", "bin");
  fs.mkdirSync(npmBin, { recursive: true });
  fs.writeFileSync(
    path.join(npmHome, "node_modules", "npm", "package.json"),
    '{"type":"module"}',
  );
  fs.copyFileSync(fakeNpx, path.join(npmBin, "npx-cli.js"));
  fs.writeFileSync(path.join(npmHome, "npx.cmd"), "@echo not run\r\n");
  const PATHS = [EMPTY_DIR, npmHome].join(path.delimiter);
  r = run(["https://203.0.113.30/", "--out", OUT], {
    firecrawl: false,
    node: loneNode,
    env: { READ_PAGE_NPX: "", PATH: PATHS, Path: PATHS },
  });
  const fromPath = r.calls.find((c) => c.tool === "npx");
  ok(
    "with no npm next to node, the npx-cli.js next to an npx.cmd on the PATH reads the page with defuddle",
    r.code === 0 &&
      fromPath &&
      fromPath.args[1] === "defuddle@0.19.7" &&
      /defuddle$/.test(lines(r.out)[0] || ""),
    `exit ${r.code}; ${r.out}${r.err}`,
  );
  // the same folder named by a relative PATH entry is not used: there is no reader
  r = run(["https://203.0.113.30/", "--out", OUT], {
    firecrawl: false,
    node: loneNode,
    cwd: tmp,
    env: { READ_PAGE_NPX: "", PATH: "npm-home", Path: "npm-home" },
  });
  ok(
    "an npx in a relative PATH entry is not used: no reader, exit 2, nothing run",
    r.code === 2 && /no reader/.test(r.err) && r.calls.length === 0,
    `exit ${r.code}; ${r.out}${r.err}`,
  );
}

// ---------------- FIRECRAWL_LOCAL naming a missing file ----------------
r = run(["https://203.0.113.30/", "--out", OUT], {
  env: { FIRECRAWL_LOCAL: path.join(tmp, "nope.exe") },
});
ok(
  "FIRECRAWL_LOCAL naming a missing file is an error that names it, not a quiet switch to defuddle",
  r.code !== 0 && r.calls.length === 0 && r.err.includes("nope.exe"),
  `exit ${r.code}; ${r.err}`,
);

// ---------------- failures ----------------
const FAIL_URL = "https://203.0.113.40/fail";
const before = saved();
r = run([FAIL_URL, "--out", OUT]);
ok(
  "a page Firecrawl fails on exits non-zero",
  r.code !== 0 && r.code !== null,
  `exit ${r.code}`,
);
ok(
  "a failed page is an error line with Firecrawl's reason",
  /203\.0\.113\.40\/fail.*FETCH_FAILED/.test(r.err),
  r.err,
);
ok(
  "a failed page prints no read line and saves no file",
  r.out.trim() === "" && saved() === before,
  r.out,
);
r = run(["https://203.0.113.40/empty", "--out", OUT]);
ok(
  "an empty page is an error, never an empty file reported as read",
  r.code !== 0 &&
    /empty/i.test(r.err) &&
    r.out.trim() === "" &&
    saved() === before,
  `exit ${r.code}; out ${r.out}; err ${r.err}`,
);
r = run(["https://203.0.113.40/notfound", "--out", OUT]);
ok(
  "a page whose status is outside 200-299 (a 404) is an error that names the status, and no file",
  r.code !== 0 &&
    /404/.test(r.err) &&
    r.out.trim() === "" &&
    saved() === before,
  `exit ${r.code}; out ${r.out}; err ${r.err}`,
);
r = run([NPM, FAIL_URL, "--out", OUT]);
ok(
  "one failed page among good ones: the good one is read, the exit is non-zero",
  r.code !== 0 && lines(r.out).length === 1 && /FETCH_FAILED/.test(r.err),
  `exit ${r.code}; ${r.out}${r.err}`,
);
r = run([FAIL_URL, "--out", OUT], { firecrawl: false });
ok(
  "a page defuddle fails on is an error with its reason and a non-zero exit",
  r.code !== 0 && /fetch failed/.test(r.err) && r.out.trim() === "",
  `exit ${r.code}; ${r.err}`,
);
r = run(["https://203.0.113.40/empty", "--out", OUT], { firecrawl: false });
ok(
  "an empty defuddle read is an error",
  r.code !== 0 && /empty/i.test(r.err) && r.out.trim() === "",
  `exit ${r.code}; ${r.err}`,
);
r = run(["https://no-such-host-x9q.invalid/", NPM, "--out", OUT]);
ok(
  "a host that does not resolve is an error line for that page; the other pages are read",
  r.code === 1 &&
    /no-such-host-x9q\.invalid/.test(r.err) &&
    lines(r.out).length === 1 &&
    r.calls.length === 1,
  `exit ${r.code}; ${r.out}${r.err}; calls ${r.calls.length}`,
);

// ---------------- a page that hangs: the time limit ends its whole process tree ----------------
fs.rmSync(PIDFILE, { force: true });
r = run(["https://203.0.113.50/slow", "--out", OUT], {
  env: { READ_PAGE_TIMEOUT_MS: "1500" },
});
const gpid = fs.existsSync(PIDFILE)
  ? Number(fs.readFileSync(PIDFILE, "utf8"))
  : null;
if (gpid) strays.push(gpid);
ok(
  "a page past READ_PAGE_TIMEOUT_MS is an error that says it timed out",
  r.code === 1 && /timed out/.test(r.err),
  `exit ${r.code}; ${r.err}`,
);
ok(
  "the time limit ends the reader's child processes too, not just the reader",
  gpid !== null && !alive(gpid),
  `child process ${gpid}`,
);

// ---------------- private and local addresses are refused before any reader runs ----------------
for (const bad of [
  "http://127.0.0.1:18765/admin",
  "http://localhost/",
  "http://0.0.0.0/",
  "http://10.1.2.3/",
  "http://172.16.0.1/",
  "http://192.168.1.1/",
  "http://169.254.169.254/latest/meta-data/",
  "http://2130706433/",
  "http://[::1]/",
  "http://[::]/",
  "http://[fd00::1]/",
  "http://[fe80::1]/",
  "http://[::ffff:127.0.0.1]/",
]) {
  for (const firecrawl of [true, false]) {
    r = run([NPM, bad, "--out", OUT], { firecrawl });
    ok(
      `a private or local address is refused before anything runs (${firecrawl ? "Firecrawl" : "defuddle"}): ${bad}`,
      r.code === 2 && r.calls.length === 0 && /private or local/.test(r.err),
      `exit ${r.code}; ${r.err}; calls ${r.calls.length}`,
    );
  }
}

// ---------------- only http(s) ----------------
for (const bad of [
  "file:///C:/Windows/win.ini",
  "ftp://example.com/x",
  "javascript:alert(1)",
  "example.com",
  "https:/../secret.html",
  "https:203.0.113.10/x",
]) {
  for (const firecrawl of [true, false]) {
    r = run([bad, "--out", OUT], { firecrawl });
    ok(
      `a URL that does not start with http:// or https:// is refused before anything runs (${firecrawl ? "Firecrawl" : "defuddle"}): ${bad}`,
      r.code === 2 && r.calls.length === 0 && r.err.includes(bad),
      `exit ${r.code}; ${r.err}`,
    );
  }
}

// ---------------- usage ----------------
r = run([]);
ok(
  "no URL is a usage error",
  r.code === 2 && /usage/i.test(r.err),
  `exit ${r.code}; ${r.err}`,
);
for (const args of [
  [NPM, "--out"],
  [NPM, "--out", G2],
  [NPM, "--out", "--out"],
]) {
  r = run(args);
  ok(
    `--out with no folder after it is a usage error: ${args.join(" ")}`,
    r.code === 2 &&
      /usage/i.test(r.err) &&
      !/\n\s+at /.test(r.err) &&
      r.calls.length === 0,
    `exit ${r.code}; ${r.err}`,
  );
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
