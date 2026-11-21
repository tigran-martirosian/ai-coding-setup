#!/usr/bin/env node
// read-page: saves the exact words of web pages to files, for a page a quote, a comparison or a decision rests
// on. WebFetch hands back a small model's summary; this hands back the page's own text, whole, in a file that
// Grep and Read can open. Firecrawl Local reads first (a local read takes well under a second; measured
// 2026-11-19/20), with its cloud hand-off on for pages that block it; where Firecrawl Local is not installed
// (the public install ships no Rust build) defuddle reads the page through npx.
//
//   read-page.mjs <url>... [--out <dir>]
//
// Each page goes to its own .md file in <dir> (default: the OS temp folder; delete the files after reading),
// named read-page-<host and path>-<random>.md, and one line per page tells where:
// "<file>  <chars> chars  <firecrawl local | firecrawl cloud | defuddle>". A page that fails or comes back empty
// is an error line on stderr with the reason, and no file. An HTTP status outside 200-299: this file checks the
// status Firecrawl's answer gives; defuddle's output gives none, but defuddle 0.19.7 itself fails such a page
// ("Failed to fetch: <status>", exit 1), which is then an error line like any failed read.
//
// Only addresses that start with http:// or https:// are read, and the readers get the parsed URL, never the raw
// text. A host you give that is, or resolves to, a private or local address (localhost, loopback, 10/8,
// 172.16/12, 192.168/16, 100.64/10, link-local and the cloud metadata address 169.254.169.254, 0.0.0.0, IPv6
// loopback, unique-local and link-local) is refused before any reader runs, for both readers. Only that host is
// checked here: a redirect the page answers with is followed by the reader. Firecrawl's --public-only refuses a
// local or private target itself; defuddle follows redirects with no such check.
//
// Firecrawl Local is found by FIRECRAWL_LOCAL, then ~/.cargo/bin/firecrawl-local(.exe), then the PATH (absolute
// entries only). It always runs as `scrape <url> --browser auto --public-only` with FIRECRAWL_CLOUD=auto: a page
// that blocks the local read goes to Firecrawl's cloud (the URL and the install's id leave this PC). A caller's
// FIRECRAWL_CLOUD=off is kept. No other flag can be passed. Never run its `init`.
// Not found: `npx -y defuddle@0.19.7 parse <url> --md`, run in an empty folder of its own so no .npmrc or
// node_modules of the caller's changes what runs. FIRECRAWL_LOCAL naming a missing file is an error, not a quiet
// switch to defuddle. FIRECRAWL_LOCAL and READ_PAGE_NPX (npx's own npx-cli.js) may name a .mjs or .js file, which
// runs with node: tests/test-read-page.mjs puts stand-ins there. This file builds no shell command line; npm
// itself starts defuddle through cmd on Windows, with its own quoting.
//
// READ_PAGE_TIMEOUT_MS: the time limit per page (default 120 s for Firecrawl, 300 s for defuddle, whose first run
// downloads it). A page past it ends with the reader's whole process tree.
//
// Exit codes: 0 every page read; 1 at least one page failed; 2 bad usage, a refused URL, or no reader.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import dns from "node:dns/promises";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { argv } from "node:process";

const USAGE = "usage: read-page.mjs <url>... [--out <dir>]";
const DEFUDDLE = "defuddle@0.19.7";
const FIRECRAWL_MS = 120000;
const DEFUDDLE_MS = 300000;
const AT_ONCE = 4;
const WIN = process.platform === "win32";

// Private, local and not-routable addresses: no reader is sent there
const BLOCKED = new net.BlockList();
for (const [a, n] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.168.0.0", 16],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
])
  BLOCKED.addSubnet(a, n, "ipv4");
for (const [a, n] of [
  // ::, ::1 and the old IPv4-compatible form. An IPv4-mapped address (::ffff:127.0.0.1) is checked against the
  // IPv4 rules by BlockList itself; a ::ffff:0:0/96 rule here would match every IPv4 address.
  ["::", 96],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
])
  BLOCKED.addSubnet(a, n, "ipv6");

class UsageError extends Error {}

function parseArgs(args) {
  const urls = [];
  let out = os.tmpdir();
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--out") {
      const dir = args[i + 1];
      if (!dir || dir.startsWith("-") || /^[a-z][a-z0-9+.-]*:\/\//i.test(dir))
        throw new UsageError(`--out needs a folder after it\n${USAGE}`);
      out = path.resolve(dir);
      i++;
    } else if (a.startsWith("-"))
      throw new UsageError(`unknown flag ${a}\n${USAGE}`);
    else urls.push(a);
  }
  if (!urls.length) throw new UsageError(USAGE);
  const parsed = urls.map((u) => {
    const refused = new UsageError(
      `refused: ${u} is not an http:// or https:// URL`,
    );
    if (!/^https?:\/\//i.test(u)) throw refused;
    let url;
    try {
      url = new URL(u);
    } catch {
      throw refused;
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw refused;
    return url;
  });
  const timeout = process.env.READ_PAGE_TIMEOUT_MS;
  if (timeout !== undefined && !/^[1-9]\d*$/.test(timeout))
    throw new UsageError(
      `READ_PAGE_TIMEOUT_MS must be a whole number of milliseconds, got ${JSON.stringify(timeout)}`,
    );
  return { urls: parsed, out, timeout: timeout && Number(timeout) };
}

// Every address the host resolves to; a private or local one refuses the run, a host that does not resolve
// fails its own page (null error = fine)
async function checkHost(url) {
  const host = url.hostname.replace(/^\[|\]$/g, "");
  let addrs;
  try {
    addrs = await dns.lookup(host, { all: true, verbatim: true });
  } catch (e) {
    return `cannot resolve ${host}: ${e.code || e.message}`;
  }
  const bad = addrs.find((a) =>
    BLOCKED.check(a.address, a.family === 6 ? "ipv6" : "ipv4"),
  );
  if (bad)
    throw new UsageError(
      `refused: ${url.href} points at a private or local address (${bad.address})`,
    );
  return null;
}

function findFirecrawl() {
  const set = process.env.FIRECRAWL_LOCAL;
  if (set) {
    if (!fs.existsSync(set))
      throw new UsageError(
        `FIRECRAWL_LOCAL names ${set}, which does not exist (unset it to read with defuddle)`,
      );
    return set;
  }
  const name = WIN ? "firecrawl-local.exe" : "firecrawl-local";
  // a relative PATH entry would pick a program from whatever folder the caller is in
  const dirs = [
    path.join(os.homedir(), ".cargo", "bin"),
    ...(process.env.PATH || "").split(path.delimiter),
  ];
  for (const d of dirs.filter((d) => d && path.isAbsolute(d)))
    if (fs.existsSync(path.join(d, name))) return path.join(d, name);
  return null;
}

// npx run through node itself (npm's npx-cli.js), so this file starts no shell: first the npm next to node, then
// the npm of each folder on the PATH (absolute entries only) that holds an npx or npx.cmd. npm's install layout
// puts npx-cli.js in <folder>/node_modules/npm/bin (Windows) or <folder>/../lib/node_modules/npm/bin (others),
// and a Unix npx is often a link to it. An npx.cmd is never run itself: that would need cmd.
function findNpx() {
  const set = process.env.READ_PAGE_NPX;
  if (set) {
    if (!fs.existsSync(set))
      throw new UsageError(`READ_PAGE_NPX names ${set}, which does not exist`);
    return set;
  }
  const npmOf = (d) => [
    path.join(d, "node_modules", "npm", "bin", "npx-cli.js"),
    path.join(d, "..", "lib", "node_modules", "npm", "bin", "npx-cli.js"),
  ];
  const nodeDir = path.dirname(process.execPath);
  const tries = npmOf(nodeDir);
  for (const d of (process.env.PATH || "")
    .split(path.delimiter)
    .filter((d) => d && path.isAbsolute(d))) {
    const npx = ["npx", "npx.cmd"]
      .map((n) => path.join(d, n))
      .filter((p) => fs.existsSync(p));
    if (!npx.length) continue;
    tries.push(...npmOf(d));
    if (npx[0].endsWith("npx")) tries.push(fs.realpathSync(npx[0]));
  }
  const found = tries.find((p) => /\.js$/.test(p) && fs.existsSync(p));
  if (!found)
    throw new UsageError(
      `no reader: Firecrawl Local is not installed and npx was not found (looked for npm's npx-cli.js next to ${nodeDir} and next to each npx or npx.cmd on the PATH)`,
    );
  return found;
}

// Ends a process and every process under it (a reader starts a browser or npm starts defuddle)
function killTree(child) {
  if (WIN) {
    if (process.env.SystemRoot)
      spawnSync(
        path.join(process.env.SystemRoot, "System32", "taskkill.exe"),
        ["/T", "/F", "/PID", String(child.pid)],
        {
          stdio: "ignore",
          windowsHide: true,
        },
      );
    else
      console.error(
        "read-page: SystemRoot is not set, so only the reader is ended, not the processes under it",
      );
  } else
    try {
      process.kill(-child.pid, "SIGKILL"); // its own process group (detached below)
    } catch {}
  child.kill("SIGKILL"); // in case the tree kill missed the reader itself
}

// Runs a program with an args array (a .mjs/.js file with node); resolves { code, out, err, timedOut }
function run(cmd, args, { env, cwd, ms }) {
  const [file, all] = /\.[cm]?js$/i.test(cmd)
    ? [process.execPath, [cmd, ...args]]
    : [cmd, args];
  return new Promise((resolve) => {
    const child = spawn(file, all, {
      env,
      cwd,
      windowsHide: true,
      detached: !WIN,
    });
    let out = "",
      err = "",
      timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      killTree(child);
    }, ms);
    child.stdout.setEncoding("utf8").on("data", (d) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d) => (err += d));
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({
        code: null,
        out,
        err: `cannot start ${cmd}: ${e.message}`,
        timedOut,
      });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, timedOut });
    });
  });
}

// The end of an error output, where the reason is: its last 3 lines on one line, at most 300 characters
const lastLine = (s) =>
  s
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-3)
    .join(" ")
    .slice(-300);

async function readFirecrawl(cmd, url, ms) {
  const env = {
    ...process.env,
    FIRECRAWL_CLOUD: process.env.FIRECRAWL_CLOUD === "off" ? "off" : "auto",
  };
  const r = await run(
    cmd,
    ["scrape", url, "--browser", "auto", "--public-only"],
    { env, ms },
  );
  if (r.timedOut)
    throw new Error(`Firecrawl Local timed out after ${ms / 1000} s`);
  let j;
  try {
    j = JSON.parse(r.out);
  } catch {
    throw new Error(
      `Firecrawl Local exit ${r.code}, no JSON answer: ${lastLine(r.err) || lastLine(r.out) || "no output"}`,
    );
  }
  if (!j.success)
    throw new Error(
      `Firecrawl Local: ${j.code || "failed"}: ${j.error || "no reason given"}`,
    );
  if (r.code !== 0)
    throw new Error(
      `Firecrawl Local exit ${r.code}: ${lastLine(r.err) || "no reason given"}`,
    );
  const status = j.data?.metadata?.statusCode;
  if (
    status != null &&
    !(Number.isInteger(status) && status >= 200 && status <= 299)
  )
    throw new Error(
      `Firecrawl Local: the page answered HTTP ${status}${j.data.metadata.title ? ` (${j.data.metadata.title})` : ""}`,
    );
  const text = j.data?.markdown;
  if (typeof text !== "string" || !text.trim())
    throw new Error("Firecrawl Local: the page came back empty");
  const from = {
    local: "firecrawl local",
    "firecrawl-cloud": "firecrawl cloud",
  }[j.data.source];
  if (!from)
    throw new Error(
      `Firecrawl Local gave an unknown source ${JSON.stringify(j.data.source)}`,
    );
  return { text, from };
}

async function readDefuddle(npx, url, ms, cwd) {
  const r = await run(npx, ["-y", DEFUDDLE, "parse", url, "--md"], {
    env: process.env,
    cwd,
    ms,
  });
  if (r.timedOut) throw new Error(`defuddle timed out after ${ms / 1000} s`);
  if (r.code !== 0)
    throw new Error(
      `defuddle exit ${r.code}: ${lastLine(r.err) || "no reason given"}`,
    );
  if (!r.out.trim()) throw new Error("defuddle: the page came back empty");
  return { text: r.out, from: "defuddle" };
}

// read-page-<host and path>-<random>.md: two runs into the shared temp folder never overwrite each other
function fileFor(url, out, taken) {
  const slug = `${url.host}${url.pathname}${url.search}`
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80)
    .replace(/-+$/, "");
  let name;
  do name = `read-page-${slug}-${crypto.randomBytes(3).toString("hex")}.md`;
  while (taken.has(name));
  taken.add(name);
  return path.join(out, name);
}

async function main() {
  const { urls, out, timeout } = parseArgs(argv.slice(2));
  const firecrawl = findFirecrawl();
  const npx = firecrawl ? null : findNpx();
  // every host is checked before any reader runs: one private address refuses the whole run
  const hostErrors = await Promise.all(urls.map(checkHost));
  fs.mkdirSync(out, { recursive: true });
  const taken = new Set();
  const files = urls.map((u) => fileFor(u, out, taken));
  const npxDir = npx
    ? fs.mkdtempSync(path.join(os.tmpdir(), "read-page-npx-"))
    : null;

  // Pages are read a few at a time; their lines come out in the order the URLs were given
  const done = hostErrors.map((e) => (e ? { error: e } : undefined));
  const todo = urls.map((_, i) => i).filter((i) => !done[i]);
  let shown = 0,
    failed = 0;
  const show = () => {
    while (shown < urls.length && done[shown]) {
      const d = done[shown];
      if (d.error) {
        failed++;
        console.error(`FAILED ${urls[shown].href}: ${d.error}`);
      } else console.log(`${files[shown]}  ${d.text.length} chars  ${d.from}`);
      shown++;
    }
  };
  show();
  const worker = async () => {
    while (todo.length) {
      const i = todo.shift();
      const href = urls[i].href;
      try {
        const page = firecrawl
          ? await readFirecrawl(firecrawl, href, timeout || FIRECRAWL_MS)
          : await readDefuddle(npx, href, timeout || DEFUDDLE_MS, npxDir);
        fs.writeFileSync(files[i], page.text);
        done[i] = page;
      } catch (e) {
        done[i] = { error: e.message };
      }
      show();
    }
  };
  try {
    await Promise.all(
      Array.from({ length: Math.min(AT_ONCE, todo.length) }, worker),
    );
  } finally {
    if (npxDir) fs.rmSync(npxDir, { recursive: true, force: true });
  }
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(
      e instanceof UsageError
        ? e.message
        : `read-page: ${e.stack || e.message}`,
    );
    process.exit(e instanceof UsageError ? 2 : 1);
  },
);
