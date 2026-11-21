#!/usr/bin/env node
// try-page: gives a local dev page a link that opens it in a visible Nimbalyst browser tab beside the chat. It
// checks the page answers, then writes a page file that Nimbalyst opens as a "Browser Session" tab, and prints a
// markdown link to that file: give the user the link, one click opens the tab. Only the Try it button's watcher
// (commands extension) opens the file by itself, after a press. One PC only: no tunnel, no port forwarding,
// nothing listens.
//
//   try-page.mjs <url> --session <id>
//
// <id>: the Nimbalyst session id when you know it (the Try it button's note gives it, and its watcher looks for
// that file), else any short name. It must match ^[A-Za-z0-9_-]+$ (it is part of the file name).
//
// The page file is <home>/.claude/state/try-it/<id>.browser.json, holding
// {"version":1,"url":"<url>","title":"Try it: <host:port>","ts":<ms written>}. <home> is TRY_PAGE_HOME when set
// (tests/test-try-page.mjs), else the user's home folder. <url> is written as parsed (a bare host gets its "/").
// The one stdout line: "<url> answers; this link opens it in a Nimbalyst browser tab beside the chat:
// [<title>](<file>)". <file> is the absolute path with forward slashes, a "/" before a drive letter ("/C:/..."),
// encoded with encodeURI plus ( ) # ? so any folder name keeps the link whole.
//
// Only http:// and https:// urls on the hosts localhost, 127.0.0.1 and [::1] are taken; 0.0.0.0 (what dev servers
// print) is taken as localhost. A url with a user name or password is refused, and the url is never echoed then.
// The page answers when a GET to it gets any HTTP status within TRY_PAGE_TIMEOUT_MS (default 5000); a refused
// connection or no answer in time is not answering. A local https page is checked without checking its
// certificate (dev servers sign their own). The file is written as <file>.<pid>.part and renamed into place; a
// rename that fails with EPERM or EBUSY (Windows, while the target is open) is tried 5 times, 100 ms apart.
//
// Exit codes: 0 file written; 1 the page does not answer, or the file cannot be written; 2 bad usage, a refused
// url or session id. Each failure is one stderr line, and leaves no page file and no .part file.
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const USAGE = "usage: try-page.mjs <url> --session <id>";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

const die = (code, why) => {
  process.stderr.write(`try-page: ${why}\n`);
  process.exit(code);
};

function parseArgs(argv) {
  const urls = [];
  let session;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") {
      if (i + 1 >= argv.length)
        die(2, `--session needs an id after it. ${USAGE}`);
      session = argv[++i];
    } else if (a.startsWith("--")) die(2, `unknown flag ${a}. ${USAGE}`);
    else urls.push(a);
  }
  if (urls.length === 0) die(2, `no url given. ${USAGE}`);
  if (urls.length > 1) die(2, `one url only, got ${urls.length}. ${USAGE}`);
  if (session === undefined)
    die(2, `no session id given (--session <id>). ${USAGE}`);
  if (!/^[A-Za-z0-9_-]+$/.test(session))
    die(
      2,
      `session id ${JSON.stringify(session)} is not letters, digits, _ and - only`,
    );
  let url;
  try {
    url = new URL(urls[0]);
  } catch {
    die(2, "the url given is not a url (an http:// or https:// address)");
  }
  // Checked first, and the url is not echoed from here on: a password in it must not reach a log
  if (url.username || url.password)
    die(2, "the url holds a user name or password; give it without them");
  if (url.protocol !== "http:" && url.protocol !== "https:")
    die(2, `${url.protocol} is not http: or https:`);
  // Dev servers print 0.0.0.0 (listening on every address); a browser reaches that server as localhost
  if (url.hostname === "0.0.0.0") url.hostname = "localhost";
  if (!LOCAL_HOSTS.has(url.hostname))
    die(
      2,
      `host ${url.hostname} is not local (only localhost, 127.0.0.1 and [::1])`,
    );
  return { url, session };
}

// The file's absolute path as a markdown link target: forward slashes, a "/" before a drive letter ("/C:/..."),
// and encoded so a space, ( ), # or % in a folder name does not end or bend the link.
function linkTarget(file) {
  let p = path.resolve(file).replaceAll("\\", "/");
  if (/^[A-Za-z]:/.test(p)) p = `/${p}`;
  return encodeURI(p).replace(
    /[()#?]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

// Resolves when the page gives any HTTP status; rejects with the reason it did not.
function answers(url, ms) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === "https:" ? https : http;
    const req = lib.get(url, { rejectUnauthorized: false }, (res) => {
      res.resume();
      req.destroy();
      resolve(res.statusCode);
    });
    req.setTimeout(ms, () => req.destroy(new Error(`no answer in ${ms} ms`)));
    req.on("error", (e) => reject(e));
  });
}

const { url, session } = parseArgs(process.argv.slice(2));
const ms = Number(process.env.TRY_PAGE_TIMEOUT_MS || 5000);
if (!(ms > 0))
  die(
    2,
    `TRY_PAGE_TIMEOUT_MS ${JSON.stringify(process.env.TRY_PAGE_TIMEOUT_MS)} is not a positive number`,
  );
try {
  await answers(url, ms);
} catch (e) {
  die(
    1,
    `${url.href} does not answer (${e.code || e.message}); start its server first`,
  );
}

const home = process.env.TRY_PAGE_HOME || os.homedir();
const dir = path.join(home, ".claude", "state", "try-it");
const file = path.join(dir, `${session}.browser.json`);
const port = url.port || (url.protocol === "https:" ? "443" : "80");
const title = `Try it: ${url.hostname}:${port}`;
// Written whole, then renamed into place, so the watcher never reads half a file. On Windows a rename fails
// with EPERM or EBUSY while another program (the watcher, a virus scanner) has the target open: retried.
const part = `${file}.${process.pid}.part`;
try {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    part,
    JSON.stringify({ version: 1, url: url.href, title, ts: Date.now() }),
  );
  for (let tries = 1; ; tries++) {
    try {
      fs.renameSync(part, file);
      break;
    } catch (e) {
      if (tries >= 5 || (e.code !== "EPERM" && e.code !== "EBUSY")) throw e;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
} catch (e) {
  fs.rmSync(part, { force: true });
  die(1, `cannot write ${file} (${e.code || e.message})`);
}
console.log(
  `${url.href} answers; this link opens it in a Nimbalyst browser tab beside the chat: [${title}](${linkTarget(file)})`,
);
