#!/usr/bin/env node
// social.mjs: read Reddit and X from any working folder, as plain text. Read only: it never posts, votes, likes,
// follows or signs in.
//   node ~/.claude/workers/social/social.mjs <url>... [--comments 12] [--full] [--replies]
//     a Reddit post (also /s/ share links, redd.it): the post and its top comments, uncut. --full: every comment
//       the archive holds (500 top-level, 6 deep).
//     an X post or article: the post with its quote, media links, poll and article text. --replies: the post and
//       its top replies (needs OpenCLI, below).
//   node ~/.claude/workers/social/social.mjs search reddit "<query>" [--sub <subreddit>] [--time year] [--limit 10] [--sort relevance]
//   node ~/.claude/workers/social/social.mjs search x "<query>" [--limit 10]     X search, "top" tab
// Reddit threads and X posts are read through open APIs, with no browser and no account: Arctic Shift's archive
// (arctic-shift.photon-reddit.com; scores as the archive last saw them) and fxtwitter (api.fxtwitter.com).
// X replies, X search and Reddit search have no open route. They need OpenCLI (`npm install -g @jackwener/opencli`
// plus its Browser Bridge Chrome extension; `opencli doctor` checks both) and a Chrome signed in to the site.
// Without it those reads print FAILED naming the missing piece; they never hang.
// One route per kind of read, no fallback: when a route fails, the run stops with FAILED naming that route.
// Every post it reads is printed as "OPENED <url>".
// OpenCLI is found by OPENCLI_MAIN (another install's dist/src/main.js), else in the global npm folder
// (%APPDATA%\npm on Windows, else `npm root -g`), and only when a read needs it. Tested with OpenCLI 1.8.8 and
// 2.0.3; after an upgrade, check once that no blank Chrome window is left after a run.
// Why not Reddit or X directly: Reddit answers .json and search with 403, and a headless Chrome gets "blocked by
// network security" on both sites. Reddit's own search.json is blocked even inside the signed-in Chrome, so Reddit
// search reads old.reddit.com's result page in a background tab that is closed afterwards. Nothing else (no
// existing tab) is touched.
// OpenCLI releases a finished tab but keeps its own window open as a blank placeholder (about:blank or its
// idle.html), so every run would leave a window on the user's screen. Each run ends by closing those.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { digest } from "./reddit.mjs"; // reddit.mjs imports redditThread from here: only functions cross, so the cycle is safe
import { wall, wallMessage } from "./walls.mjs";

const one = (s, n) => {
  const t = String(s ?? "")
    .replace(/\s+/g, " ")
    .trim();
  return t.length > n ? t.slice(0, n) + "…" : t;
};
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";

export class Stop extends Error {}
const stop = (msg) => {
  throw new Stop(msg);
};

const wallStop = (site, what, detail) => stop(wallMessage(site, what, detail));

// OpenCLI's dist/src/main.js, looked up once, on the first read that needs it. Not found: FAILED naming what to install.
const OPENCLI_SETUP =
  "X replies, X search and Reddit search need it: npm install -g @jackwener/opencli, add its Browser Bridge extension to Chrome, sign in to the site in that Chrome, then check with `opencli doctor`. Reddit threads and X posts read without it.";
let MAIN = "";
function openCli() {
  if (MAIN) return MAIN;
  const rel = ["@jackwener", "opencli", "dist", "src", "main.js"];
  const tried = [];
  if (process.env.OPENCLI_MAIN) tried.push(process.env.OPENCLI_MAIN);
  else {
    if (process.env.APPDATA)
      tried.push(path.join(process.env.APPDATA, "npm", "node_modules", ...rel));
    if (!tried.some((p) => fs.existsSync(p))) {
      const r = spawnSync("npm", ["root", "-g"], {
        encoding: "utf8",
        shell: process.platform === "win32",
        timeout: 15000,
        windowsHide: true,
      });
      const root = r.status === 0 ? (r.stdout || "").trim() : "";
      if (root) tried.push(path.join(root, ...rel));
    }
  }
  MAIN = tried.find((p) => fs.existsSync(p)) || "";
  if (!MAIN)
    stop(
      `OpenCLI is not installed (${tried.length ? `not found at ${tried.join(" or ")}` : "npm root -g named no global folder"}). ${OPENCLI_SETUP}`,
    );
  return MAIN;
}

// Runs one opencli command (no shell, so no quoting trouble) and returns { out, err }.
let usedBrowser = false;
let bridgeChecked = false;
function oc(args, ms = 90000) {
  const main = openCli();
  if (!bridgeChecked) {
    bridgeChecked = true;
    ensureBridge();
  }
  usedBrowser = true;
  const r = spawnSync(process.execPath, [main, ...args], {
    encoding: "utf8",
    timeout: ms,
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  }); // --full answers can pass 1 MB
  if (r.error) stop(`opencli did not run (${r.error.message})`);
  return { out: r.stdout || "", err: r.stderr || "", code: r.status };
}

// The bridge extension lives in one Chrome profile. Chrome closed, or started without a profile (it then shows
// its profile picker and loads no extension), leaves the bridge "not connected". So on Windows: when not
// connected, open Chrome minimized on the profile last used (Local State's profile.last_used) and wait up to
// 40 s for the extension. Elsewhere the read fails with the bridge message.
function bridgeUp() {
  const r = spawnSync(process.execPath, [openCli(), "doctor"], {
    encoding: "utf8",
    timeout: 30000,
    windowsHide: true,
  });
  const out = (r.stdout || "") + (r.stderr || "");
  // OpenCLI 1.x prints "[OK] Extension: connected"; 2.x prints JSON with "extensionConnected":true.
  return /\[OK\] Extension: connected|"extensionConnected":true/.test(out);
}
function ensureBridge() {
  if (process.platform !== "win32" || bridgeUp()) return;
  const data = path.join(
    process.env.LOCALAPPDATA || "",
    "Google",
    "Chrome",
    "User Data",
  );
  let profile;
  try {
    profile = JSON.parse(
      fs.readFileSync(path.join(data, "Local State"), "utf8"),
    ).profile?.last_used;
  } catch (e) {
    stop(
      `Bridge not connected, and Chrome's Local State could not be read to find the profile (${e.message}).`,
    );
  }
  if (!profile)
    stop(
      "Bridge not connected, and Chrome's Local State names no last-used profile.",
    );
  const chrome = ["PROGRAMFILES", "PROGRAMFILES(X86)", "LOCALAPPDATA"]
    .map((v) =>
      path.join(
        process.env[v] || "",
        "Google",
        "Chrome",
        "Application",
        "chrome.exe",
      ),
    )
    .find((p) => fs.existsSync(p));
  if (!chrome)
    stop("Bridge not connected, and chrome.exe was not found to start it.");
  spawnSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `Start-Process -FilePath '${chrome}' -ArgumentList '--profile-directory="${profile}"' -WindowStyle Minimized`,
    ],
    { windowsHide: true, timeout: 20000 },
  );
  for (let i = 0; i < 8; i++) {
    spawnSync(process.execPath, ["-e", "setTimeout(()=>{},5000)"]);
    if (bridgeUp()) {
      console.error(`(Started Chrome on profile "${profile}" for the bridge.)`);
      return;
    }
  }
  stop(
    `The OpenCLI bridge is still not connected 40 s after opening Chrome on profile "${profile}". Run \`opencli doctor\`; the Browser Bridge extension may be off in that profile.`,
  );
}
// The text of an opencli failure, without the "Update available" notice.
const failure = (r) =>
  one(
    (r.out + " " + r.err).replace(
      /Update available[\s\S]*?npm install -g @jackwener\/opencli/,
      "",
    ),
    300,
  );

// Turns a failed opencli answer into the FAILED line (throws Stop); exported for the test
export function explain(r, site) {
  const all = r.out + r.err;
  const w = wall(all);
  if (w && w !== "a sign-in wall") wallStop(site, w, failure(r));
  if (w === "a sign-in wall")
    stop(
      `NOT SIGNED IN to ${site} in the OpenCLI Chrome. The user must open ${site === "X" ? "https://x.com" : "https://www.reddit.com"} in their normal Chrome and sign in once; do not retry before that. (${failure(r)})`,
    );
  if (/daemon|extension|not connected|ECONNREFUSED|Browser Bridge/i.test(all))
    stop(
      `The OpenCLI browser bridge is not running (${failure(r)}). Run \`opencli doctor\`: it needs the daemon and the Chrome extension connected. The Chrome itself must be open.`,
    );
  stop(`${site} read failed (${failure(r)})`);
}

// JSON answer of an opencli site command, or a plain error.
function ocJson(site, args) {
  let r = oc([...args, "-f", "json", "--window", "background"]);
  if (/Browser Bridge|not connected/i.test(r.out + r.err)) {
    // the bridge dropped after the first check: start Chrome once, retry once
    ensureBridge();
    r = oc([...args, "-f", "json", "--window", "background"]);
  }
  const i = r.out.search(/[[{]/);
  let data;
  try {
    data = JSON.parse(r.out.slice(i));
  } catch {
    explain(r, site);
  }
  if (data?.ok === true && Array.isArray(data.data)) data = data.data; // 2.x wraps the rows as { ok, data }
  if (!Array.isArray(data)) explain(r, site);
  return data;
}

// The JSON answer of an open API (Arctic Shift, fxtwitter), or a FAILED line naming it. No fallback to Chrome.
async function openJson(route, url) {
  const failed = (why) =>
    stop(
      `${route} failed for ${url} (${why}). No other route is tried; read it in the browser yourself or retry later.`,
    );
  let res, body;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": UA },
      signal: AbortSignal.timeout(60000),
    });
    body = await res.text();
  } catch (e) {
    failed(
      e.name === "TimeoutError"
        ? "no answer in 60 s: the API is slow or down"
        : e.message,
    );
  }
  if (res.status === 429) failed("HTTP 429, rate limit: do not retry now");
  let data;
  try {
    data = JSON.parse(body);
  } catch {
    // fxtwitter answers a missing post with an HTML page that says why in og:description
    failed(
      `HTTP ${res.status}, not JSON: ${one(/og:description" content="([^"]*)"/.exec(body)?.[1] || body.replace(/<!--[\s\S]*?-->|<[^>]+>/g, " "), 160)}`,
    );
  }
  if (!res.ok)
    failed(
      `HTTP ${res.status}: ${one(data.error || data.message || body, 160)}`,
    );
  return data;
}

// ---- Reddit ----

const ARCTIC = "https://arctic-shift.photon-reddit.com/api";

// Arctic Shift's comment tree as the rows digest() prints: L0 top-level, L1 its replies...; each level by score.
// depth: levels kept; replies: answers kept under each comment (the top-level count is cut by digest()).
export function treeRows(children, { depth, replies }, level = 0) {
  const rows = [];
  const comments = children
    .filter((c) => c.kind === "t1")
    .sort((a, b) => (b.data.score ?? 0) - (a.data.score ?? 0));
  for (const c of level ? comments.slice(0, replies) : comments) {
    rows.push({
      type: `L${level}`,
      score: c.data.score ?? "",
      text: c.data.body || "",
    });
    if (level + 1 < depth)
      rows.push(
        ...treeRows(
          c.data.replies?.data?.children || [],
          { depth, replies },
          level + 1,
        ),
      );
  }
  return rows;
}

async function redditId(url) {
  let u = url;
  if (!/\/comments\/[a-z0-9]+/i.test(u)) {
    // /s/ share link, redd.it short link: follow the redirect
    let res;
    try {
      res = await fetch(u, {
        redirect: "follow",
        headers: { "User-Agent": UA },
      });
    } catch (e) {
      stop(`could not resolve ${url} (${e.message})`);
    }
    u = res.url;
    if (!/\/comments\/[a-z0-9]+/i.test(u))
      stop(`${url} did not lead to a Reddit post (ended at ${u})`);
  }
  const m = /\/comments\/([a-z0-9]+)/i.exec(u);
  return { id: m[1], url: u.split("?")[0] };
}

// One Reddit thread from Arctic Shift (also reddit.mjs's batch read): its link, the rows digest() takes, and the
// printed lines. Throws Stop with a message naming the route when it fails; no other route is tried.
export async function redditThread(id, { comments = 12, full = false } = {}) {
  const route =
    "Reddit read through Arctic Shift (arctic-shift.photon-reddit.com)";
  const post = (await openJson(route, `${ARCTIC}/posts/ids?ids=${id}`))
    .data?.[0];
  if (!post)
    stop(
      `${route}: the archive has no post ${id} (too new to be archived yet, or never archived). No other route is tried.`,
    );
  const tree = (
    await openJson(route, `${ARCTIC}/comments/tree?link_id=${id}&limit=9999`)
  ).data;
  if (!Array.isArray(tree))
    stop(
      `${route}: the comment answer for ${id} is not a list. No other route is tried.`,
    );
  const rows = [
    {
      type: "POST",
      score: post.score,
      text: `${post.title}\n${post.selftext || ""}${post.is_self ? "" : `\nlink: ${post.url}`}`,
    },
    ...treeRows(
      tree,
      full ? { depth: 6, replies: 50 } : { depth: 2, replies: 2 },
    ),
  ];
  const left = tree
    .filter((c) => c.kind === "more")
    .reduce((n, c) => n + (c.data.count || 0), 0);
  const meta = {
    title: post.title,
    sub: `r/${post.subreddit}`,
    created: post.created_utc,
  };
  const lines = digest(rows, {
    ...meta,
    comments: full ? 500 : comments,
    chars: 20000,
  });
  lines.push(
    `(${lines.filter((l) => /^\s*- \[/.test(l)).length} of ${post.num_comments ?? "?"} comments shown, from the archive${left ? `; it did not return ${left} more` : ""})`,
  );
  return {
    url: `https://www.reddit.com${post.permalink}`,
    ...meta,
    rows,
    lines,
  };
}

async function redditPost(url, comments, full) {
  const { id } = await redditId(url);
  const thread = await redditThread(id, { comments, full });
  console.log(`OPENED ${thread.url}`);
  console.log(thread.lines.join("\n"));
}

async function redditSearch(query, { sub, time, limit, sort }) {
  const base = sub
    ? `https://old.reddit.com/r/${sub.replace(/^r\//, "")}/search`
    : "https://old.reddit.com/search";
  const url = `${base}?q=${encodeURIComponent(query)}&sort=${sort}&t=${time}${sub ? "&restrict_sr=on" : ""}`;
  // Its own session, so searches run in parallel don't release each other's. The "adapter" surface is the one
  // OpenCLI's site commands use: an `opencli browser` session parks its tab in a window the extension
  // never lets go of, so that window stayed open after every search.
  const session = `site:social-read:${process.pid}`;
  const main = openCli();
  if (!bridgeChecked) {
    bridgeChecked = true;
    ensureBridge();
  } // this path drives the page directly, not through oc()
  usedBrowser = true;
  let Page;
  try {
    ({ Page } = await import(
      pathToFileURL(path.join(path.dirname(main), "browser", "page.js")).href
    ));
  } catch (e) {
    stop(
      `Reddit search could not load OpenCLI's browser/page.js beside ${main} (${one(e.message, 200)}): this OpenCLI version is laid out differently.`,
    );
  }
  const page0 = new Page(
    session,
    undefined,
    undefined,
    "background",
    "adapter",
  );
  const fail = (e) =>
    explain({ out: "", err: String(e?.message || e) }, "Reddit");
  try {
    try {
      await page0.goto(url);
    } catch (e) {
      fail(e);
    }
    const js = `(() => {
      const login = !!document.querySelector('#header-bottom-right form.login-form') || /^\\/login/.test(location.pathname);
      const rows = [...document.querySelectorAll('.search-result-link')].map((el) => {
        const a = el.querySelector('a.search-title'); const t = (s) => (el.querySelector(s)?.innerText || '').trim();
        return { title: a?.innerText || '', url: a?.href || '', sub: t('.search-subreddit-link'), score: t('.search-score'), comments: t('.search-comments'), when: el.querySelector('.search-time time')?.getAttribute('datetime') || '' };
      });
      return JSON.stringify({ login, path: location.pathname, rows, body: document.body.innerText.slice(0, 600) });
    })()`;
    let page;
    try {
      page = JSON.parse(await page0.evaluate(js));
    } catch (e) {
      fail(e);
    }
    if (page.login)
      stop(
        "NOT SIGNED IN to Reddit in the OpenCLI Chrome. The user must open https://www.reddit.com in their normal Chrome and sign in once; do not retry before that.",
      );
    if (!page.rows.length && wall(page.body))
      wallStop("Reddit", wall(page.body), one(page.body, 120));
    if (!page.rows.length)
      stop(
        `No Reddit threads found for "${query}" (page ${page.path}: ${one(page.body, 120)})`,
      );
    console.log(
      `OPENED ${url.replace("//old.reddit.com", "//www.reddit.com")}`,
    );
    page.rows.slice(0, limit).forEach((r, i) => {
      const num = (s) => (/[\d.,]+k?/i.exec(s) || ["?"])[0]; // the page may be in the user's language ("19 комментариев")
      console.log(
        `${i + 1}. ${r.when.slice(0, 10)} | ${num(r.score)} points | ${num(r.comments)} comments | ${r.sub} | ${one(r.title, 150)}\n   ${r.url.split("?")[0].replace("//old.reddit.com", "//www.reddit.com")}`,
      );
    });
    console.log(
      `\n${Math.min(limit, page.rows.length)} threads. Read one: node ~/.claude/workers/social/social.mjs <link>`,
    );
  } finally {
    // Releases this run's tab; the blank window left behind is closed at the end of the run
    await page0.closeWindow();
  }
}

// ---- X ----

// The main post is never cut; replies are cut at 2000 characters, search rows (a list) at 300.
const xLine = (t, n = Infinity) =>
  `@${t.author}${t.created_at ? ` ${String(t.created_at).slice(0, 10)}` : ""} [${t.likes ?? "?"} likes${t.retweets === undefined ? "" : `, ${t.retweets} reposts`}]: ${one(t.text, n)}`;

const xId = (url) =>
  /status(?:es)?\/(\d+)/.exec(url)?.[1] ||
  stop(`${url} is not an X post link (expected .../status/<number>)`);

// fxtwitter's post as the lines printed: the post uncut, then its quote, poll, media links and article text.
export function fxLines(t) {
  const day = t.created_timestamp
    ? new Date(t.created_timestamp * 1000).toISOString().slice(0, 10)
    : "";
  const lines = [
    xLine({
      author: t.author?.screen_name,
      created_at: day,
      likes: t.likes,
      retweets: t.retweets,
      text: t.text,
    }),
  ];
  if (t.replying_to) lines.push(`  (a reply to @${t.replying_to})`);
  if (t.quote)
    lines.push(
      `  quoting ${xLine({ author: t.quote.author?.screen_name, likes: t.quote.likes, text: t.quote.text })} ${t.quote.url || ""}`.trimEnd(),
    );
  if (t.poll)
    lines.push(
      `  poll: ${t.poll.choices.map((c) => `${c.label} ${c.percentage}%`).join(" | ")}`,
    );
  for (const m of t.media?.all || []) lines.push(`  ${m.type}: ${m.url}`);
  if (t.community_note)
    lines.push(`  community note: ${one(t.community_note.text, Infinity)}`);
  if (t.article) {
    lines.push(`  article: ${t.article.title || "(no title)"}`);
    const mark = (type) =>
      /^header/.test(type) ? "## " : /list-item$/.test(type) ? "- " : "";
    for (const b of t.article.content?.blocks || [])
      if (String(b.text || "").trim()) lines.push(`  ${mark(b.type)}${b.text}`);
  }
  lines.push(
    `  (${t.replies ?? "?"} replies, not read: add --replies to read them through the signed-in Chrome)`,
  );
  return lines;
}

async function xOpen(url) {
  const id = xId(url);
  const route = "X read through fxtwitter (api.fxtwitter.com)";
  const data = await openJson(route, `https://api.fxtwitter.com/status/${id}`);
  if (data.code !== 200 || !data.tweet)
    stop(
      `${route}: post ${id} answered ${data.code} ${data.message} (deleted, protected or private). No other route is tried.`,
    );
  console.log(
    `OPENED https://x.com/${data.tweet.author.screen_name}/status/${id}`,
  );
  console.log(fxLines(data.tweet).join("\n"));
}

function xPost(url, replies) {
  const id = xId(url);
  const rows = ocJson("X", ["twitter", "thread", id, "--limit", "60"]);
  if (!rows.length)
    stop(
      `X returned nothing for post ${id} (deleted, protected, or not visible to this account)`,
    );
  const main = rows.find((t) => String(t.id) === id) || rows[0];
  console.log(`OPENED https://x.com/${main.author}/status/${id}`);
  console.log(xLine(main));
  const rest = rows
    .filter((t) => t !== main)
    .sort((a, b) => (Number(b.likes) || 0) - (Number(a.likes) || 0))
    .slice(0, replies);
  if (!rest.length) console.log("(no replies shown)");
  for (const t of rest) console.log(`  - ${xLine(t, 2000)}`);
}

function xSearch(query, limit) {
  const rows = ocJson("X", [
    "twitter",
    "search",
    query,
    "--limit",
    String(limit),
  ]);
  if (!rows.length) stop(`No X posts found for "${query}"`);
  console.log(`OPENED https://x.com/search?q=${encodeURIComponent(query)}`);
  rows
    .slice(0, limit)
    .forEach((t, i) =>
      console.log(
        `${i + 1}. ${xLine({ ...t, text: one(t.text, 300) })}\n   ${t.url || `https://x.com/${t.author}/status/${t.id}`}`,
      ),
    );
  console.log(
    `\n${Math.min(limit, rows.length)} posts. Read one: node ~/.claude/workers/social/social.mjs <link> (add --replies for its replies)`,
  );
}

// ---- main ----

async function main() {
  const args = process.argv.slice(2);
  const opt = (name, fallback) => {
    const i = args.indexOf(name);
    return i >= 0 ? args.splice(i, 2)[1] : fallback;
  };
  const sub = opt("--sub", ""),
    time = opt("--time", "all"),
    sort = opt("--sort", "relevance");
  const limit = Number(opt("--limit", "10")) || 10,
    comments = Number(opt("--comments", "12")) || 12;
  const flag = (name) =>
    args.includes(name) && !!args.splice(args.indexOf(name), 1);
  const full = flag("--full"),
    withReplies = flag("--replies");
  if (!args.length)
    stop(
      'Usage: node ~/.claude/workers/social/social.mjs <reddit-or-x-url>... [--comments 12] [--full] [--replies]\n       node ~/.claude/workers/social/social.mjs search reddit "<query>" [--sub <subreddit>] [--time year] [--limit 10]\n       node ~/.claude/workers/social/social.mjs search x "<query>" [--limit 10]',
    );
  if (args[0] === "search") {
    const [, where, ...q] = args;
    const query = q.join(" ").trim();
    if (!query || !["reddit", "x"].includes(where))
      stop(
        'Usage: node ~/.claude/workers/social/social.mjs search reddit|x "<query>"',
      );
    if (where === "reddit")
      await redditSearch(query, { sub, time, limit, sort });
    else xSearch(query, limit);
    return;
  }
  let first = true;
  for (const url of args) {
    if (!first) console.log("");
    first = false;
    if (/(^|\/\/)([\w-]+\.)?(reddit\.com|redd\.it)\//i.test(url))
      await redditPost(url, comments, full);
    else if (/(^|\/\/)([\w-]+\.)?(x\.com|twitter\.com)\//i.test(url)) {
      if (withReplies) xPost(url, comments);
      else await xOpen(url);
    } else stop(`${url} is neither a Reddit nor an X link`);
  }
}

// Closes the windows OpenCLI left behind: every tab in them is its blank placeholder. The extension
// itself refuses to close a window a running OpenCLI session still uses (a parallel run), so that one stays.
async function closeLeftWindows() {
  const { sendCommand } = await import(
    pathToFileURL(path.join(path.dirname(MAIN), "browser", "daemon-client.js"))
      .href
  );
  const call = (chromeMethod, ...chromeArgs) =>
    sendCommand("chrome-call", { chromeMethod, chromeArgs });
  const placeholder = (u) =>
    u === "about:blank" ||
    /^chrome-extension:\/\/[a-z]+\/idle\.html/.test(u || "");
  const left = (await call("windows.getAll", { populate: true })).filter(
    (w) => w.tabs?.length && w.tabs.every((t) => placeholder(t.url)),
  );
  for (const w of left) {
    try {
      await call("windows.remove", w.id);
    } catch (e) {
      if (!/managed_resource_conflict|active OpenCLI session/.test(e.message))
        console.error(
          `WARNING: could not close the OpenCLI window ${w.id} (${one(e.message, 200)})`,
        );
    }
  }
}

// Run as a command only; an import (the test) gets wall() without starting a read
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  try {
    await main();
  } catch (e) {
    if (e instanceof Stop) {
      console.log(`FAILED: ${e.message}`);
      process.exitCode = 1;
    } else throw e;
  } finally {
    if (usedBrowser)
      await closeLeftWindows().catch((e) =>
        console.error(
          `WARNING: OpenCLI windows may still be open (${one(e.message, 200)})`,
        ),
      );
  }
