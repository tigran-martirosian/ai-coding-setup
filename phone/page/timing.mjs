// Load times of the phone page: first paint and first content (Home's first session row on screen), with a cold
// cache (a fresh browser profile) and a warm one (the same profile opened again), each the median of 5 runs.
//
//   node phone/page/timing.mjs              the page in this working tree
//   node phone/page/timing.mjs --ref <tag>  the page of a git tag (taken with git archive)
//
// It builds the page into a temp folder, serves it with the local relay as pictures.mjs does and opens it in the
// same headless Chromium over the DevTools protocol, with the network held to a 150 ms round trip, 1.6 Mbit/s
// down and 750 kbit/s up. A fake Telegram host is loaded before the shipped telegram-web-app.js (which loads at
// its real size), and a fake PC in the page answers Home, one round trip per call. No request leaves the PC: a
// request to any other host stops the run.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { startLocalRelay } from "../relay/local/server.mjs";

const PAGE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(PAGE, "..", "..");
const RUNS = 5;
const RTT_MS = 150;
const DOWN_BITS = 1_600_000;
const UP_BITS = 750_000;
const SIZE = { width: 390, height: 844, scale: 3 };
const WAIT_MS = 60000;
// What the page build reads: the page, the shared seal, two extension files and the version.
const BUILD_PATHS = [
  "phone/page",
  "phone/shared",
  "extensions/job-tracker/src/model.js",
  "extensions/shared/tokens.css",
  "version.json",
];

// The Telegram host the frame talks to; it takes every event and answers none. It is set in every document before
// the page's own scripts run (with the probe), so it adds no request and blocks nothing: the page's own script
// lines are measured as they are, whether Telegram's script blocks the first paint (v26.3.3) or not.
const FAKE_HOST = `globalThis.TelegramWebviewProxy = { postEvent() {} };
`;

// A stored pairing, so the frame skips pairing and connects.
const FAKE_KEYSTORE = `export * from "./keystore-real.js";
export async function loadPairing() {
  return { K: new Uint8Array(32), pcId: "pc", dev: "phone", where: "secure" };
}
`;

// A PC that answers Home. The link, the hello and each call wait one round trip, as they would over the relay.
const FAKE_CHANNEL = `import { ChannelError } from "./channel-real.js";
export * from "./channel-real.js";
const trip = () => new Promise((r) => setTimeout(r, ${RTT_MS}));
const ago = (m) => new Date(Date.now() - m * 60000).toISOString();
const status = { nimbalyst: "open", pcName: "Home PC", sessionsOpen: 3, setupVersion: "26.3", nimbalystVersion: "0.83.0", update: null };
const ANSWERS = {
  "pc.status": () => ({ ...status, asOf: new Date().toISOString() }),
  "home.sessions": () => ({
    needsYou: [{ session: "s1", project: "p1", title: "Sign-in page fix", kind: "question", since: ago(4) }],
    working: [
      { session: "s2", project: "p1", title: "Release notes draft", doing: "a command (Bash)", since: ago(3), helpers: 1 },
      { session: "s3", project: "p2", title: "Search speed-up", doing: "reading files", since: ago(1), helpers: 0 },
    ],
    finishedToday: 3,
  }),
  "projects.list": () => [
    { project: "p1", name: "website", pinned: true, lastUsed: ago(1), needsYou: 1, working: 1 },
    { project: "p2", name: "shop-api", pinned: false, lastUsed: ago(1), needsYou: 0, working: 1 },
  ],
  "alerts.get": () => [],
  "devices.list": () => [],
  "queue.list": () => [],
  "jobs.list": () => ({ projects: [] }),
  "usage.get": () => ({ weekPercent: 42, today: 6, resetsAt: new Date(Date.now() + 3 * 86400000).toISOString(), asOf: new Date().toISOString() }),
};
export const socketUrl = () => "ws://timing.invalid/";
export async function openLink() {
  await trip();
  const link = { closed: null, listen() {}, close() { link.closed = {}; }, drop() { link.closed = {}; } };
  return link;
}
export async function join() {
  throw new ChannelError("closed");
}
export async function openSession() {
  await trip();
  return {
    hello: { pcVersion: status.setupVersion, page: "ok" },
    ask: async (action, data) => {
      await trip();
      if (!ANSWERS[action]) throw new ChannelError("unknown-action");
      return { ok: true, d: ANSWERS[action](data) };
    },
    sendStream: async () => {
      throw new ChannelError("closed");
    },
    bye: async () => {},
    ended: new Promise(() => {}),
  };
}
`;

// Runs in every document: on the served page it reports first paint and the moment Home's first row is on screen
// (the frame after the row is in the page) through the timingDone binding.
const PROBE = `if (location.protocol === "http:") {
  const t = {};
  const done = () => t.paint !== undefined && t.content !== undefined && globalThis.timingDone(JSON.stringify(t));
  new PerformanceObserver((list) => {
    for (const e of list.getEntries()) if (e.name === "first-paint") { t.paint = e.startTime; done(); }
  }).observe({ type: "paint", buffered: true });
  const seen = () => {
    if (!document.querySelector("#content .row .name")) return false;
    requestAnimationFrame(() => setTimeout(() => { t.content = performance.now(); done(); }));
    return true;
  };
  const mo = new MutationObserver(() => seen() && mo.disconnect());
  mo.observe(document, { childList: true, subtree: true });
}
`;

function readArgs(argv) {
  const at = argv.indexOf("--ref");
  if (at === -1) {
    if (argv.length)
      throw new Error(`timing: unknown arguments: ${argv.join(" ")}`);
    return { ref: null };
  }
  const ref = argv[at + 1];
  if (!ref || argv.length !== 2)
    throw new Error("timing: usage: node phone/page/timing.mjs [--ref <tag>]");
  return { ref };
}

// The headless Chromium shell pictures.mjs uses: PHONE_PAGE_BROWSER, else the newest Playwright shell.
function findBrowser() {
  if (process.env.PHONE_PAGE_BROWSER) {
    if (!fs.existsSync(process.env.PHONE_PAGE_BROWSER))
      throw new Error(
        `PHONE_PAGE_BROWSER: ${process.env.PHONE_PAGE_BROWSER} does not exist`,
      );
    return process.env.PHONE_PAGE_BROWSER;
  }
  const base = path.join(
    process.env.LOCALAPPDATA || path.join(os.homedir(), ".cache"),
    "ms-playwright",
  );
  const found = (fs.existsSync(base) ? fs.readdirSync(base) : [])
    .filter((d) => d.startsWith("chromium_headless_shell-"))
    .sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]))
    .map((d) =>
      path.join(
        base,
        d,
        "chrome-headless-shell-win64",
        "chrome-headless-shell.exe",
      ),
    )
    .find((f) => fs.existsSync(f));
  if (!found)
    throw new Error(
      `no headless Chromium shell under ${base}: run "npx playwright install chromium-headless-shell" or set PHONE_PAGE_BROWSER`,
    );
  return found;
}

// The page build script of `ref` (its tree taken into `dir` with git archive), or of this working tree.
async function loadBuild(ref, dir) {
  if (!ref) return import(pathToFileURL(path.join(PAGE, "build.mjs")).href);
  const tar = spawnSync(
    "git",
    ["-C", ROOT, "archive", `${ref}^{commit}`, ...BUILD_PATHS],
    { maxBuffer: 1 << 28 },
  );
  if (tar.status !== 0)
    throw new Error(`timing: git archive ${ref} failed: ${tar.stderr}`);
  fs.mkdirSync(dir, { recursive: true });
  const x = spawnSync("tar", ["-x", "-f", "-"], {
    cwd: dir,
    input: tar.stdout,
  });
  if (x.status !== 0) throw new Error(`timing: tar failed: ${x.stderr}`);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
  return import(
    pathToFileURL(path.join(dir, "phone", "page", "build.mjs")).href
  );
}

// The fake PC and the stored pairing in place of the real ones.
function writeStandIns(pageDir) {
  const frame = path.join(pageDir, "page", "frame");
  for (const name of ["channel", "keystore"])
    fs.renameSync(
      path.join(frame, `${name}.js`),
      path.join(frame, `${name}-real.js`),
    );
  fs.writeFileSync(path.join(frame, "channel.js"), FAKE_CHANNEL);
  fs.writeFileSync(path.join(frame, "keystore.js"), FAKE_KEYSTORE);
}

// A DevTools link to the browser's page: send() answers a call, on() takes the events of one method.
async function connect(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = list.find((t) => t.type === "page");
  if (!target) throw new Error(`timing: no page in ${JSON.stringify(list)}`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => {
    ws.onopen = resolve;
    ws.onerror = () => reject(new Error("timing: no DevTools link"));
  });
  let next = 1;
  const waiting = new Map();
  const handlers = new Map();
  ws.onmessage = (m) => {
    const r = JSON.parse(m.data);
    if (r.id) {
      const w = waiting.get(r.id);
      waiting.delete(r.id);
      if (r.error)
        w.reject(new Error(`timing: ${w.method}: ${r.error.message}`));
      else w.resolve(r.result);
    } else handlers.get(r.method)?.(r.params);
  };
  return {
    send: (method, params = {}) =>
      new Promise((resolve, reject) => {
        const id = next++;
        waiting.set(id, { method, resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
      }),
    on: (method, fn) => handlers.set(method, fn),
    close: () => ws.close(),
  };
}

// One run in a fresh browser profile: the page opened once (cold cache), then about:blank, then the page again
// (warm cache). Answers { cold: { paint, content }, warm: { paint, content } } in ms from the navigation start.
async function oneRun(exe, profile, url, origin) {
  const c = spawn(
    exe,
    [
      "--mute-audio",
      "--hide-scrollbars",
      `--force-device-scale-factor=${SIZE.scale}`,
      `--window-size=${SIZE.width},${SIZE.height}`,
      `--user-data-dir=${profile}`,
      "--remote-debugging-port=0",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  let text = "";
  c.stdout.on("data", (d) => (text += d));
  let cdp = null;
  try {
    const port = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error(`timing: no DevTools port: ${text}`)),
        30000,
      );
      c.stderr.on("data", (d) => {
        text += d;
        const m = /DevTools listening on ws:\/\/[^:]+:(\d+)\//.exec(text);
        if (m) {
          clearTimeout(timer);
          resolve(m[1]);
        }
      });
      c.on("exit", () =>
        reject(new Error(`timing: the browser ended: ${text}`)),
      );
    });
    cdp = await connect(port);
    const away = [];
    cdp.on("Network.requestWillBeSent", ({ request }) => {
      if (
        !/^(data|blob|about):/.test(request.url) &&
        !request.url.startsWith(origin)
      )
        away.push(request.url);
    });
    let report = null;
    cdp.on("Runtime.bindingCalled", ({ name, payload }) => {
      if (name === "timingDone") report?.(JSON.parse(payload));
    });
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", {
      offline: false,
      latency: RTT_MS,
      downloadThroughput: DOWN_BITS / 8,
      uploadThroughput: UP_BITS / 8,
    });
    await cdp.send("Runtime.enable");
    await cdp.send("Runtime.addBinding", { name: "timingDone" });
    await cdp.send("Page.enable");
    await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
      source: FAKE_HOST + PROBE,
    });
    const open = async () => {
      const got = new Promise((resolve, reject) => {
        const timer = setTimeout(
          () =>
            reject(
              new Error(`timing: no first row on screen in ${WAIT_MS} ms`),
            ),
          WAIT_MS,
        );
        report = (t) => {
          clearTimeout(timer);
          resolve(t);
        };
      });
      await cdp.send("Page.navigate", { url });
      const t = await got;
      report = null;
      await cdp.send("Page.navigate", { url: "about:blank" });
      if (away.length)
        throw new Error(`timing: requests left the PC: ${away.join(", ")}`);
      return t;
    };
    const cold = await open();
    const warm = await open();
    return { cold, warm };
  } finally {
    cdp?.close();
    const ended = new Promise((r) =>
      c.exitCode === null ? c.on("exit", r) : r(),
    );
    c.kill();
    await ended;
  }
}

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const ms = (x) => `${Math.round(x)} ms`.padStart(8);

const { ref } = readArgs(process.argv.slice(2));
const exe = findBrowser();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-page-timing-"));
try {
  const { buildPage, writePage } = await loadBuild(ref, path.join(tmp, "ref"));
  const pageDir = path.join(tmp, "page");
  writePage(pageDir, buildPage());
  writeStandIns(pageDir);
  const offline = async () => {
    throw new Error("the timing relay does not reach Telegram");
  };
  const relay = await startLocalRelay({
    port: 0,
    pageDir,
    botId: 1,
    botToken: "1:local",
    ownerTgId: 1,
    telegramKey: "00".repeat(32),
    telegram: offline,
    download: offline,
    now: Date.now,
    log: () => {},
    bot: null,
  });
  try {
    const hash = new URLSearchParams({
      tgWebAppVersion: "9.1",
      tgWebAppPlatform: "ios",
      tgWebAppThemeParams: JSON.stringify({
        bg_color: "#ffffff",
        text_color: "#000000",
        hint_color: "#8e8e93",
        link_color: "#007aff",
        button_color: "#007aff",
        button_text_color: "#ffffff",
        secondary_bg_color: "#f2f2f7",
      }),
    });
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const r = await oneRun(
        exe,
        fs.mkdtempSync(path.join(tmp, "profile-")),
        `${relay.url}/#${hash}`,
        relay.url,
      );
      runs.push(r);
      console.log(
        `run ${i + 1}: cold paint ${ms(r.cold.paint)}, content ${ms(r.cold.content)}; warm paint ${ms(r.warm.paint)}, content ${ms(r.warm.content)}`,
      );
    }
    const m = (k, f) => ms(median(runs.map((r) => r[k][f])));
    console.log(
      `\n${ref ?? "working tree"}: ${RTT_MS} ms round trip, ${DOWN_BITS / 1e6} Mbit/s down, ${UP_BITS / 1e3} kbit/s up, median of ${RUNS} runs`,
    );
    console.log(
      `cold cache: first paint ${m("cold", "paint")}, first content ${m("cold", "content")}`,
    );
    console.log(
      `warm cache: first paint ${m("warm", "paint")}, first content ${m("warm", "content")}`,
    );
  } finally {
    await relay.close();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
