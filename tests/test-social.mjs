// Tests for workers/social/: the stop at a captcha, rate limit or sign-in wall (walls.mjs, explain() in
// social.mjs), the usage line, and the clear FAILED line when OpenCLI is missing. No network, no browser.
// SOCIAL_LIVE=1 also reads the open routes live (fxtwitter for X posts, Arctic Shift for Reddit threads).
// Run: node tests/test-social.mjs     (SOCIAL_LIVE=1 node tests/test-social.mjs for the live reads)
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { threadId } from "../workers/social/reddit.mjs";
import { explain } from "../workers/social/social.mjs";
import { wall } from "../workers/social/walls.mjs";

const DIR = fileURLToPath(new URL("../workers/social/", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "social-test-"));
let pass = 0,
  fail = 0;
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
  return ok;
}

// Pages (the start of document.body.innerText) and error texts OpenCLI prints
const TEXTS = {
  redditCaptcha:
    "Prove your humanity\nVerify you are human by completing the action below.\nreddit.com needs to review the security of your connection before proceeding.",
  redditPardner:
    "whoa there, pardner!\n\nYour request has been blocked due to a network policy.\nTry logging in or creating an account here to get back to browsing.",
  redditSecurity:
    "You've been blocked by network security.\nTo continue, log in to your Reddit account or use your developer token",
  reddit403:
    "Error: Reddit post 1abcde is not accessible (HTTP 403). Hint: you may need to log in",
  xRate: "Something went wrong. Try reloading.\nRate limit exceeded",
  xAuth: "Error: AUTH_REQUIRED: twitter search needs a signed-in session",
  xRelogin: "Error: Twitter auth failed (HTTP 401), re-login required",
  emptySearch:
    "there doesn't seem to be anything here\nsearch results\nWant to join? Log in or sign up in seconds.",
  bridge: "Error: Browser Bridge not connected (ECONNREFUSED 127.0.0.1:19825)",
};

check(
  "a captcha page is named as a captcha, so the read stops instead of retrying",
  wall(TEXTS.redditCaptcha),
  "a captcha",
);
check(
  "the 'whoa there, pardner' block page is named as a rate limit or block",
  wall(TEXTS.redditPardner),
  "a rate limit or block page",
);
check(
  "Reddit's network-security block is named as a block, not a sign-in wall",
  wall(TEXTS.redditSecurity),
  "a rate limit or block page",
);
check(
  "a thread read refused with HTTP 403 is named as a block, so the next threads are not fetched",
  wall(TEXTS.reddit403),
  "a rate limit or block page",
);
check(
  "X's 'Rate limit exceeded' is named as a rate limit",
  wall(TEXTS.xRate),
  "a rate limit or block page",
);
check(
  "OpenCLI's AUTH_REQUIRED is named as a sign-in wall",
  wall(TEXTS.xAuth),
  "a sign-in wall",
);
check(
  "X's 're-login required' is named as a sign-in wall",
  wall(TEXTS.xRelogin),
  "a sign-in wall",
);
check(
  "an empty search page with the header's 'Log in or sign up' is no wall",
  wall(TEXTS.emptySearch),
  null,
);
check(
  "a browser-bridge error is no wall (it has its own fix message)",
  wall(TEXTS.bridge),
  null,
);

// What social.mjs prints: explain() turns a failed read into the FAILED line
const said = (err, site) => {
  try {
    explain({ out: "", err }, site);
  } catch (e) {
    return e.message;
  }
  return "(no stop)";
};
check(
  "a thread read refused with HTTP 403 prints 'Reddit showed a rate limit or block page ... do not retry'",
  /^Reddit showed a rate limit or block page .*do not retry/.test(
    said(TEXTS.reddit403, "Reddit"),
  ),
  true,
);
check(
  "a captcha answer prints 'X showed a captcha ... do not retry'",
  /^X showed a captcha .*do not retry/.test(said(TEXTS.redditCaptcha, "X")),
  true,
);
check(
  "a sign-in wall prints NOT SIGNED IN with 'do not retry'",
  /^NOT SIGNED IN to X.*do not retry/.test(said(TEXTS.xRelogin, "X")),
  true,
);
check(
  "a bridge error prints the fix: run opencli doctor",
  /bridge is not running.*opencli doctor/.test(said(TEXTS.bridge, "X")),
  true,
);

// reddit.mjs takes a thread's id from any link form or a bare id
check(
  "threadId reads the id from a /comments/ link",
  threadId("https://www.reddit.com/r/a/comments/1XTX4IK/heads_up/"),
  "1xtx4ik",
);
check(
  "threadId reads the id from a redd.it link",
  threadId("https://redd.it/1abcde"),
  "1abcde",
);
check(
  "threadId takes a bare id and refuses other text",
  `${threadId("1abcde")}|${threadId("https://example.com/x")}`,
  "1abcde|",
);

// Run as commands: importing them above started no read
const node = (file, args, opts = {}) =>
  spawnSync(process.execPath, [path.join(DIR, file), ...args], {
    encoding: "utf8",
    timeout: 60000,
    ...opts,
  });
const r = node("social.mjs", []);
check(
  "social.mjs run with no arguments prints FAILED: Usage and exits 1",
  `${r.status} ${/^FAILED: Usage/m.test(r.stdout)}`,
  "1 true",
);
const ru = node("reddit.mjs", []);
check(
  "reddit.mjs run with no arguments prints its usage and exits 2",
  `${ru.status} ${/^Usage: .*reddit\.mjs read/m.test(ru.stdout)}`,
  "2 true",
);

// OpenCLI missing: a read that needs it prints one FAILED line naming what to install, exit 1, no crash.
// No APPDATA and an empty PATH: neither %APPDATA%\npm nor `npm root -g` can find it.
const bare = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !/^(PATH|APPDATA|OPENCLI_MAIN)$/i.test(k),
  ),
);
const noOpenCli = node("social.mjs", ["search", "x", "claude code"], {
  env: { ...bare, PATH: tmp },
});
check(
  "without APPDATA and without npm, an X search prints FAILED: OpenCLI is not installed with the install command, exit 1",
  `${noOpenCli.status} ${/^FAILED: OpenCLI is not installed .*npm install -g @jackwener\/opencli.*opencli doctor/m.test(noOpenCli.stdout)} ${noOpenCli.stderr.includes("    at ")}`,
  "1 true false",
);
const wrongMain = node(
  "social.mjs",
  ["https://x.com/jack/status/20", "--replies"],
  {
    env: { ...process.env, OPENCLI_MAIN: path.join(tmp, "no-opencli-here.js") },
  },
);
check(
  "OPENCLI_MAIN at a missing file: X replies print FAILED: OpenCLI is not installed naming that file, exit 1",
  `${wrongMain.status} ${wrongMain.stdout.includes("FAILED: OpenCLI is not installed (not found at")} ${wrongMain.stdout.includes("no-opencli-here.js")}`,
  "1 true true",
);

// ---- the open routes, live (SOCIAL_LIVE=1, needs the network). Each read must work with OpenCLI unreachable, so a
// read that slips back to the signed-in Chrome fails here with "OpenCLI is not installed".
if (process.env.SOCIAL_LIVE === "1") {
  const noChrome = {
    ...process.env,
    OPENCLI_MAIN: path.join(tmp, "no-opencli-here.js"),
  };
  const live = (name, route, file, args, test, want, opts = {}) => {
    const r = node(file, args, { env: noChrome, timeout: 150000, ...opts });
    if (check(name, test(r.stdout), want)) return;
    if (r.error)
      console.log(
        `  ${route} gave no answer in 150 s (the API is slow or down): ${r.error.message}`,
      );
    else
      console.log(`  ${route} printed: ${(r.stdout + r.stderr).slice(0, 300)}`);
  };
  const status = (out) => (/^FAILED|^UNREAD/m.test(out) ? "stopped" : "read");
  live(
    "an X post is read through fxtwitter without Chrome: OPENED line and the post text",
    "fxtwitter (api.fxtwitter.com)",
    "social.mjs",
    ["https://x.com/jack/status/20"],
    (out) =>
      `${status(out)} ${out.includes("OPENED https://x.com/jack/status/20")} ${/@jack 2006-03-21 .*: just setting up my twttr/.test(out)}`,
    "read true true",
  );
  live(
    "an X article is read through fxtwitter without Chrome: its title and its text with headings",
    "fxtwitter (api.fxtwitter.com)",
    "social.mjs",
    ["https://x.com/eliakuratli/status/2124850779639181567"],
    (out) =>
      `${status(out)} ${out.includes("article: Unslop your UI")} ${/^ {2}## Why it happens$/m.test(out)}`,
    "read true true",
  );
  const heads = (out) =>
    `${status(out)} ${out.includes("OPENED https://www.reddit.com/r/ClaudeAI/comments/1xtx4ik/")} ${/^Heads up: .* \| r\/ClaudeAI \| 2026-11-11 \| \d+ points$/m.test(out)} ${(out.match(/^- \[\d+\] /gm) || []).length}`;
  live(
    "a Reddit thread is read through Arctic Shift without Chrome: OPENED line, title line and 3 top comments",
    "Arctic Shift (arctic-shift.photon-reddit.com)",
    "social.mjs",
    [
      "https://www.reddit.com/r/ClaudeAI/comments/1xtx4ik/heads_up/",
      "--comments",
      "3",
    ],
    heads,
    "read true true 3",
  );
  live(
    "reddit.mjs reads its threads through Arctic Shift without Chrome, and --save writes from the current folder",
    "Arctic Shift (arctic-shift.photon-reddit.com)",
    "reddit.mjs",
    ["read", "1xtx4ik", "--comments", "3", "--save", "saved"],
    (out) =>
      `${heads(out)} ${fs.existsSync(path.join(tmp, "saved", "reddit-1xtx4ik.json"))}`,
    "read true true 3 true",
    { cwd: tmp },
  );
} else
  console.log(
    "(live reads skipped: set SOCIAL_LIVE=1 to read fxtwitter and Arctic Shift)",
  );

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
