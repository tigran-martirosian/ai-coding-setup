// Stress test of the phone link end to end (phone steady design, section 7). The built page is served by the local
// relay; the real PC program runs against it; the page is the real frame (frame/app.js with frame/channel.js) on a
// DOM stand-in in Node. The page and the PC each reach the relay through a TCP proxy the test can cut or hold
// (tests/phone-bot/cut-proxy.mjs). Each case breaks the link one way and checks that the page has a working session
// again within a few seconds, with no reconnect loop: the page's sockets and the PC's connects are counted.
// Short timers: the page's and the relay's clock run 10 times as fast (the page's timers and Date, the relay's
// `now`), and the PC program gets its link's waits 10 times as short (core/link.mjs TIMING). Every time in a message
// is on that scaled clock: "within 5 s" is half a second of real time. The PC program's own start-up is not scaled.
// The old-with-new pairs use the released 26.3.3 page channel, PC program and relay from the git tag v26.3.3 (the
// user's own app until the next release); a clone without that tag (a shallow CI checkout) says so on a "skip" line
// and leaves those pairs out. A 30 MB recording goes from this page's channel through the PC program to
// voice.transcribe, with a stand-in transcriber.
//   node tests/test-phone-steady.mjs
import { spawn } from "node:child_process";
import { createHash, randomBytes as nodeRandom } from "node:crypto";
import fs from "node:fs";
import { registerHooks } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SELF = fileURLToPath(import.meta.url);
const PAGE = path.join(ROOT, "phone", "page");
const SETUP = path.join(ROOT, "skills", "phone-bot", "pc", "setup.mjs");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "version.json"), "utf8"),
).version;
const OLD_TAG = "v26.3.3";
const BOT_ID = 7000001;
const BOT_TOKEN = `${BOT_ID}:test-token`;
const OWNER = 111;
// The scale: the page's and the relay's clock run this many times as fast; the PC's link waits are this many times
// as short.
const K = 10;

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const timings = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Real milliseconds as seconds of the scaled clock, one decimal.
const secs = (ms) => Math.round((ms * K) / 100) / 10;
// Waits up to `s` seconds of the scaled clock for fn() to give something true; the time it took in real ms, or null.
async function within(fn, s) {
  const start = Date.now();
  const end = start + (s * 1000) / K;
  for (;;) {
    if (fn()) return Date.now() - start;
    if (Date.now() > end) return null;
    await sleep(5);
  }
}
// Sleeps `s` seconds of the scaled clock.
const wait = (s) => sleep((s * 1000) / K);

// ---- the scaled clock of the page and the relay
const T0 = Date.now();
const scaledNow = () => T0 + (Date.now() - T0) * K;
class ScaledDate extends Date {
  constructor(...a) {
    if (a.length) super(...a);
    else super(scaledNow());
  }
  static now() {
    return scaledNow();
  }
}
// The page's modules get these in place of the globals (the load hook below puts SCALED_PREFIX on top of them).
globalThis.steadyClock = {
  setTimeout: (fn, ms = 0, ...a) => setTimeout(fn, ms / K, ...a),
  setInterval: (fn, ms = 0, ...a) => setInterval(fn, ms / K, ...a),
  Date: ScaledDate,
};
const SCALED_PREFIX =
  "const { setTimeout, setInterval, Date } = globalThis.steadyClock;\n";

// ---- the PC program, as keep.mjs starts it, with its link's waits scaled (`node test-phone-steady.mjs --pc`)
// `--pc <dir>` runs the PC program in `dir` (the released one) the same way.
async function runPc(dir = path.join(ROOT, "skills", "phone-bot", "pc")) {
  const at = (rel) => pathToFileURL(path.join(dir, rel)).href;
  const { TIMING } = await import(at("core/link.mjs"));
  for (const k of Object.keys(TIMING)) if (k.endsWith("Ms")) TIMING[k] /= K;
  await import(at("main.mjs"));
}

// ---- a DOM stand-in with what frame/app.js and frame/dom.js use
class FakeNode {
  constructor() {
    this.childNodes = [];
  }
  append(...kids) {
    for (const k of kids)
      this.childNodes.push(k instanceof FakeNode ? k : new FakeText(String(k)));
  }
  replaceChildren(...kids) {
    this.childNodes = [];
    this.append(...kids);
  }
  get childElementCount() {
    return this.childNodes.filter((c) => c instanceof FakeElement).length;
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
}
class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.className = "";
    this.attrs = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.scrollTop = 0;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
}
const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
const byClass = (root, c) =>
  walk(root).filter((n) => n.className?.split(" ").includes(c));

// What the page's stand-ins read and record: its address, Telegram's signed initData, its pairing, the screen's
// context (ctx.connected is true while a session is up, ctx.ask asks the PC through it), window events and reloads.
const page = {
  url: null,
  initData: null,
  pairing: null,
  ctx: null,
  win: {},
  tgEvents: {},
  reloads: 0,
};
globalThis.steadyPage = page;
const els = Object.fromEntries(
  [
    "app",
    "fatal",
    "content",
    "bottom",
    "bottom-extra",
    "tabbar",
    "main-btn",
    "shell",
    "sk-home",
    "sk-projects",
    "sk-settings",
  ].map((id) => [id, new FakeElement("div")]),
);
// Each tab's shapes sit in their own section of the shell, as in index.html; the frame moves them back there.
for (const tab of ["home", "projects", "settings"])
  els[`sk-${tab}`].parentNode = new FakeElement("section");
const pageStore = new Map();

// Every socket the frame opens, with when (real ms) it was made, opened and closed: the reconnect count. `pongs`
// counts the relay's answers to the page's pings (phone/relay/src/hub.mjs PONG).
const RealSocket = globalThis.WebSocket;
const pageSockets = [];
class CountingSocket extends RealSocket {
  constructor(url) {
    super(url);
    const s = {
      at: Date.now(),
      url: String(url),
      openAt: null,
      closeAt: null,
      pongs: 0,
    };
    pageSockets.push(s);
    this.addEventListener("open", () => {
      s.openAt = Date.now();
    });
    this.addEventListener("message", (e) => {
      if (e.data === '{"t":"pong"}') s.pongs++;
    });
    this.addEventListener("close", () => {
      s.closeAt = Date.now();
    });
  }
}

const viewportTag = { setAttribute: () => {} };

function setPageGlobals() {
  globalThis.Node = FakeNode;
  globalThis.document = {
    hidden: false,
    createElement: (tag) => new FakeElement(tag),
    createElementNS: (_ns, tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    getElementById: (id) => {
      if (!els[id]) throw new Error(`the test page has no #${id}`);
      return els[id];
    },
    addEventListener: (type, fn) => {
      page.win[`document ${type}`] = fn;
    },
    // The real index.html's viewport tag and <html>, which the zoom lock (frame/zoom.js) sets on every screen.
    querySelector: (q) => (q === 'meta[name="viewport"]' ? viewportTag : null),
    documentElement: { classList: { toggle: () => {} } },
  };
  globalThis.addEventListener = (type, fn) => {
    page.win[type] = fn;
  };
  globalThis.location = {
    get href() {
      return page.url;
    },
    search: "",
    reload: () => {
      page.reloads++;
    },
  };
  globalThis.sessionStorage = {
    getItem: (k) => pageStore.get(k) ?? null,
    setItem: (k, v) => pageStore.set(k, String(v)),
  };
  globalThis.WebSocket = CountingSocket;
}

// The page's view of the link, from what the frame drew.
const pageView = () => ({
  up: Boolean(page.ctx?.connected),
  off: byClass(els.content, "off-line").length > 0,
  long:
    byClass(els.content, "link-bar-line").length > 0 ||
    walk(els.content).some((n) => n.data?.startsWith?.("No connection")),
  readOnly: byClass(els.content, "warn").length > 0,
  cards: byClass(els.app, "join-card").length,
});
const pageUp = () => pageView().up;
const pageAsk = (action = "pc.status") =>
  page.ctx
    .ask(action, {})
    .catch((e) => ({ ok: false, err: e.code ?? e.message }));

// What the page showed since the last reset, sampled every 10 ms: "PC off", the long line.
const seen = { off: false, long: false };
setInterval(() => {
  const v = pageView();
  seen.off ||= v.off;
  seen.long ||= v.long;
}, 10).unref();
const resetSeen = () => {
  seen.off = false;
  seen.long = false;
};

// ---- loading the page: the frame's Telegram, key store and generated version are stand-ins; the frame and the
// channel run on the scaled clock
const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
const APP_URL = pageUrl("frame/app.js");
const STAND_INS = {
  [pageUrl("screens.generated.js")]:
    `export const PAGE_VERSION = ${JSON.stringify(VERSION)};
export const LATER = [];
export const loadRest = async () => [];
export const STORE_SUFFIX = "";`,
  // index.html's own first module: the style files and Telegram's script are in at once.
  [pageUrl("frame/boot.js")]: `export const stylesLoaded = Promise.resolve();
export const telegramLoaded = Promise.resolve();
export const shellTab = () => "home";`,
  [pageUrl("frame/telegram.js")]: `const p = globalThis.steadyPage;
export const startTelegram = () => ({ initData: p.initData, platform: "ios", isVersionAtLeast: () => true,
  onEvent: (name, fn) => { p.tgEvents[name] = fn; } });
export const hasHost = () => true;
export const haptic = () => {};
export const setMainButton = () => {};
export const setBackButton = () => {};`,
  [pageUrl("frame/keystore.js")]: `const p = globalThis.steadyPage;
export const loadPairing = async () => p.pairing;
export const restorePairing = async () => null;
export const savePairing = async () => "test";
export const forgetPairing = async () => {};`,
};
const SCALED = new Set([APP_URL, pageUrl("frame/channel.js")]);
function hookPage() {
  registerHooks({
    resolve(specifier, context, next) {
      // The build-only screens.generated.js is stood in for every page file that imports it (cache.js, outbox.js).
      const code =
        (context.parentURL === APP_URL &&
          STAND_INS[new URL(specifier, APP_URL).href]) ||
        (specifier.endsWith("screens.generated.js") &&
          STAND_INS[new URL(specifier, context.parentURL).href]);
      if (code)
        return {
          url: `data:text/javascript,${encodeURIComponent(code)}`,
          shortCircuit: true,
        };
      return next(specifier, context);
    },
    load(url, context, next) {
      // The page's files are modules with no package.json saying so.
      const page = url.startsWith(pageUrl("")) || SCALED.has(url);
      if (!page) return next(url, context);
      const r = next(url, { ...context, format: "module" });
      if (!SCALED.has(url)) return r;
      const text =
        typeof r.source === "string"
          ? r.source
          : Buffer.from(r.source).toString("utf8");
      return { ...r, format: "module", source: SCALED_PREFIX + text };
    },
  });
}

// ---- the world: relay, proxies, PC program, paired devices
const w = {};

// Telegram's stand-in signs initData with the test's own Ed25519 key; relay and PC get its public key.
async function initDataFor(userId) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "q1",
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  };
  return w.signInitData({
    fields,
    botId: BOT_ID,
    botToken: BOT_TOKEN,
    privateKey: w.tg.privateKey,
  });
}

// The env of a PC program with its own home and control pipe.
function pcEnvFor(home) {
  return {
    HOME: home,
    USERPROFILE: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(home, "AppData", "Local"),
    PHONE_PC_DRY: "1",
    PHONE_PC_TEST: "1",
    PHONE_PC_PLATFORM: "win32",
    // setup only prints the Windows programs in this dry, pretend-Windows run; a Mac has no SystemRoot of its own
    SystemRoot: process.env.SystemRoot || "C:/Windows",
    PHONE_PC_PIPE:
      process.platform === "win32"
        ? `\\\\.\\pipe\\phone-app-pc-steady-${nodeRandom(6).toString("hex")}`
        : path.join(home, "pc.sock"),
    PHONE_PC_TG_KEY: w.tgPubHex,
    NIMBALYST_ENDPOINT_FILE: path.join(w.tmp, "no-endpoint.json"),
    // Voice: a stand-in uv on the PATH and the stand-in transcriber (the speech model's marker is in the home).
    PATH: `${w.bin}${path.delimiter}${process.env.PATH}`,
    PHONE_PC_TRANSCRIBER: w.transcriber,
  };
}

// What `setup.mjs voice` leaves once the speech model loads, so voice.transcribe runs the stand-in.
function markVoice(home) {
  fs.mkdirSync(path.join(home, ".phone-app"), { recursive: true });
  fs.writeFileSync(
    path.join(home, ".phone-app", "voice.json"),
    JSON.stringify({
      model: "small",
      lock: createHash("sha256")
        .update(
          fs.readFileSync(
            path.join(
              ROOT,
              "skills",
              "phone-bot",
              "pc",
              "voice",
              "transcribe-server.py.lock",
            ),
          ),
        )
        .digest("hex"),
    }),
  );
}

// A PC paired with a code from the PC program run with `env`, by the page channel `ch`, on the relay at `url`.
async function pairWith(ch, url, setup, env, kind) {
  const out = await setupRun(setup, ["pair"], env);
  const m = /Pairing code[^\n]*\n\s*([A-Z2-7 .]+)/.exec(out);
  if (!m) throw new Error(`setup pair gave no code:\n${out}`);
  // Right after its join the PC program connects again: a pair that finds it offline never reached it, so the
  // one-use code is still good.
  for (const end = Date.now() + 5000; ; await sleep(50)) {
    const link = await ch.openLink({
      url: ch.socketUrl(url),
      initData: w.initData,
      WebSocket: RealSocket,
    });
    const paired = await ch
      .pair(link, { code: m[1].trim(), initData: w.initData, kind })
      .catch((e) => {
        if (e.code !== "pc-offline" || Date.now() > end) throw e;
        return null;
      });
    link.close();
    if (paired) return paired;
  }
}

function startProgram(args, env) {
  const child = spawn(process.execPath, args, {
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.out = "";
  child.stdout.on("data", (d) => (child.out += d));
  child.stderr.on("data", (d) => (child.out += d));
  return child;
}
async function stopProgram(child) {
  if (!child || child.exitCode !== null) return;
  const gone = new Promise((r) => child.on("exit", r));
  child.kill();
  await gone;
}

const logText = (home) => {
  const file = path.join(home, ".phone-app", "pc.log");
  return fs.existsSync(file) ? fs.readFileSync(file, "utf8") : "";
};
const count = (text, re) => (text.match(re) || []).length;
// The PC program's connects (each new socket that opened) and its own dead-link finds.
const pcConnects = () => count(logText(w.home), / connect pc-/g);
const pcLost = () => count(logText(w.home), / lost no pong/g);

// Nothing in this process may wait in place: the relays, the proxies and the page live here, and the PC programs give
// a relay's pong 1 s of real time (10 s scaled). A spawnSync or a sqlite write here took up to half a second, more on
// a busy machine, and a PC took the stall for a dead link: it connected again, and the "connected once" and Send
// checks failed. So programs run with spawn and the stand-in Nimbalyst databases are written on a worker thread.
function runProgram(cmd, args, { env = {}, input = null } = {}) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, {
      env: { ...process.env, ...env },
      stdio: [input ? "pipe" : "ignore", "pipe", "pipe"],
    });
    const out = [];
    const err = [];
    p.stdout.on("data", (d) => out.push(d));
    p.stderr.on("data", (d) => err.push(d));
    p.on("error", reject);
    p.on("close", (status) =>
      resolve({
        status,
        stdout: Buffer.concat(out),
        stderr: Buffer.concat(err).toString(),
      }),
    );
    if (input) p.stdin.end(input);
  });
}

// Runs `sql` and then each [statement, ...values] of `rows` on the sqlite file, on a worker thread.
function dbWork(file, sql, rows = []) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      `const { DatabaseSync } = require("node:sqlite");
const { workerData: d } = require("node:worker_threads");
const db = new DatabaseSync(d.file);
if (d.sql) db.exec(d.sql);
for (const [q, ...a] of d.rows) db.prepare(q).run(...a);
db.close();`,
      { eval: true, workerData: { file, sql, rows } },
    );
    worker.on("error", reject);
    worker.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`the database work on ${file} ended with ${code}`)),
    );
  });
}

async function setupRun(setup, args, env) {
  const r = await runProgram(process.execPath, [setup, ...args], { env });
  const stdout = r.stdout.toString();
  if (r.status !== 0)
    throw new Error(`setup ${args[0]} failed:\n${stdout}${r.stderr}`);
  return stdout;
}

// A new device paired with a code from the running PC program.
const pairDevice = (kind) =>
  pairWith(w.channel, w.relay.url, SETUP, w.pcEnv, kind);

// A device's session through the page's channel code (`ch`: this page's or the old one), straight to the relay at
// `url` (the main one when none is given).
async function deviceSession(ch, p, onEvent = () => {}, url = w.relay.url) {
  const link = await ch.openLink({
    url: ch.socketUrl(url),
    initData: w.initData,
    WebSocket: RealSocket,
  });
  const s = await ch.openSession(link, {
    K: p.K,
    dev: p.dev,
    pageVersion: VERSION,
    onEvent,
  });
  return { link, s };
}

// A phone socket of the owner that only listens: it records when the relay says pc-online.
async function openWatcher() {
  const link = await w.channel.openLink({
    url: w.channel.socketUrl(w.relay.url),
    initData: w.initData,
    WebSocket: RealSocket,
  });
  link.listen((f) => f.t === "pc-online" && w.pcOnline.push(Date.now()));
  return link;
}

// The released PC program, page and relay of OLD_TAG in `dir`, or false when this clone has no such tag. The old PC
// runs through `--pc <dir>`, so its link's waits are scaled like the new one's.
async function extractOld(dir) {
  const has = await runProgram("git", [
    "-C",
    ROOT,
    "rev-parse",
    "--verify",
    "--quiet",
    `${OLD_TAG}^{commit}`,
  ]);
  if (has.status !== 0) return false;
  const tar = await runProgram("git", [
    "-C",
    ROOT,
    "archive",
    OLD_TAG,
    "skills/phone-bot",
    "phone/shared",
    "phone/page",
    "phone/relay",
    "version.json",
  ]);
  if (tar.status !== 0)
    throw new Error(`git archive ${OLD_TAG} failed: ${tar.stderr}`);
  fs.mkdirSync(dir, { recursive: true });
  const x = await runProgram("tar", ["-x", "-C", dir], { input: tar.stdout });
  if (x.status !== 0) throw new Error(`tar failed: ${x.stderr}`);
  fs.writeFileSync(path.join(dir, "package.json"), '{"type":"module"}\n');
  return true;
}

async function startWorld() {
  // The real path: on macOS the temp folder is a link (/var -> /private/var) and Node loads a module by its real
  // path, so a URL made from the link's path never matched SCALED and the old channel ran on the real clock.
  w.tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "phone-steady-")),
  );
  w.home = path.join(w.tmp, "home");
  fs.mkdirSync(w.home);
  // The real transcriber's lines: {"ready":true} once loaded, then {"text"} per {"file"}: here the file's size and
  // SHA-256, so the test sees the bytes that arrived.
  w.bin = path.join(w.tmp, "bin");
  fs.mkdirSync(w.bin);
  fs.writeFileSync(
    path.join(w.bin, process.platform === "win32" ? "uv.exe" : "uv"),
    "",
  );
  w.transcriber = path.join(w.tmp, "fake-transcriber.mjs");
  fs.writeFileSync(
    w.transcriber,
    `import fs from "node:fs";
import { createHash } from "node:crypto";
import readline from "node:readline";
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const bytes = fs.readFileSync(JSON.parse(line).file);
  const text = "heard " + bytes.length + " bytes " + createHash("sha256").update(bytes).digest("hex");
  process.stdout.write(JSON.stringify({ text }) + "\\n");
}
`,
  );
  markVoice(w.home);
  Object.assign(process.env, {
    HOME: w.home,
    USERPROFILE: w.home,
    APPDATA: path.join(w.home, "AppData", "Roaming"),
    LOCALAPPDATA: path.join(w.home, "AppData", "Local"),
  });
  hookPage();
  w.seal = await import("../phone/shared/seal.mjs");
  w.signInitData = (
    await import("./phone-bot/telegram-init-data.mjs")
  ).signInitData;
  const { buildPage, writePage } = await import("../phone/page/build.mjs");
  const { startLocalRelay } = await import("../phone/relay/local/server.mjs");
  const { startCutProxy } = await import("./phone-bot/cut-proxy.mjs");
  w.channel = await import(pageUrl("frame/channel.js"));
  w.tg = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
    "sign",
    "verify",
  ]);
  w.tgPubHex = w.seal.toHex(
    new Uint8Array(await crypto.subtle.exportKey("raw", w.tg.publicKey)),
  );
  w.initData = await initDataFor(OWNER);

  w.pageDir = path.join(w.tmp, "page");
  writePage(w.pageDir, buildPage());
  w.relayLog = [];
  w.relayOpts = {
    port: 0,
    pageDir: w.pageDir,
    storeFile: path.join(w.tmp, "relay-store.bin"),
    botId: BOT_ID,
    botToken: BOT_TOKEN,
    ownerTgId: OWNER,
    telegramKey: w.tgPubHex,
    telegram: async () => {
      throw new Error("the test relay does not reach Telegram");
    },
    download: async () => {
      throw new Error("the test relay downloads nothing");
    },
    now: scaledNow,
    log: (line) => w.relayLog.push(line),
    bot: null,
  };
  w.startRelay = startLocalRelay;
  w.relay = await startLocalRelay(w.relayOpts);
  w.relayOpts.port = Number(new URL(w.relay.url).port);
  // The page's way to the relay, a second way (another network), and the PC's way.
  w.pageProxy = await startCutProxy({ port: w.relayOpts.port });
  w.pageProxy2 = await startCutProxy({ port: w.relayOpts.port });
  w.pcProxy = await startCutProxy({ port: w.relayOpts.port });

  w.pcEnv = pcEnvFor(w.home);
  await setupRun(SETUP, ["join", w.pcProxy.url], w.pcEnv);
  w.pc = startProgram([SELF, "--pc"], w.pcEnv);
  // Accepted once the relay keeps a record of it (its first link is a pc-join).
  const known = () => [...w.relay.map.keys()].some((k) => k.startsWith("pc:"));
  if ((await within(known, 100)) === null)
    throw new Error(`the PC program did not join the relay:\n${w.pc.out}`);
  await w.relay.idle();
  w.A = await pairDevice("iphone");
  w.B = await pairDevice("android");
  w.O = await pairDevice("iphone");
  w.pcOnline = [];
  w.watcher = await openWatcher();
}

// The frame starts on a stand-in Home tab whose actions need the full set (a Read-only page would grey it); each
// render with a session up counts as one session drawn.
async function startPage() {
  setPageGlobals();
  page.url = `${w.pageProxy.url}/`;
  page.initData = w.initData;
  page.pairing = w.A;
  page.sessions = 0;
  const screens = await import(pageUrl("frame/screens.js"));
  screens.registerScreen({
    id: "steady-home",
    tab: "home",
    title: "Home",
    actions: ["pc.status", "sessions.list"],
    render: (c) => {
      page.ctx = c;
      if (c.connected) page.sessions++;
      return new FakeElement("div");
    },
  });
  // The pairing screen, drawn when the PC no longer holds the page's device: the time it was first drawn.
  screens.registerScreen({
    id: "pairing",
    title: "Pair",
    actions: [],
    render: () => {
      page.pairingAt ??= Date.now();
      return new FakeElement("div");
    },
  });
  await import(APP_URL);
  if ((await within(pageUp, 20)) === null)
    throw new Error(
      `the page did not connect: ${els.fatal.textContent} ${els.content.textContent}`,
    );
}

// After a case: 6 s with no new page socket and no new PC connect, the page's session up.
async function steady(what) {
  const p = pageSockets.length;
  const c = pcConnects();
  await wait(6);
  const dp = pageSockets.length - p;
  const dc = pcConnects() - c;
  check(
    `after ${what} the link must stay up with no further connects (no reconnect loop)`,
    dp === 0 && dc === 0 && pageUp(),
    `page sockets +${dp}, PC connects +${dc}, up ${pageUp()}`,
  );
}

async function askWorks(what) {
  const r = await pageAsk();
  check(
    `after ${what} the page's session must answer pc.status`,
    r?.ok === true,
    JSON.stringify(r)?.slice(0, 200),
  );
}

// Gaps between the page's connect attempts since index `from`, in scaled seconds.
const gaps = (from) =>
  pageSockets
    .slice(from)
    .map((s, i, a) => (i ? secs(s.at - a[i - 1].at) : null))
    .slice(1);

async function caseShortDrop() {
  resetSeen();
  const from = pageSockets.length;
  const t0 = Date.now();
  w.pageProxy.cut();
  await within(() => !pageUp(), 5);
  await sleep(Math.max(0, 1000 / K - (Date.now() - t0)));
  w.pageProxy.heal();
  const back = await within(pageUp, 5);
  const tries = pageSockets.length - from;
  check(
    "the phone must reconnect within 5 s after a 1 s drop",
    back !== null,
    `page sockets +${tries}`,
  );
  check(
    "a 1 s drop must cost at most 3 connect attempts",
    tries >= 1 && tries <= 3,
    `${tries} attempts`,
  );
  check('a 1 s drop must not show "PC off"', !seen.off);
  await askWorks("a 1 s drop");
  timings.push(
    `1 s drop: back ${secs(back)} s after the heal, ${tries} page attempts`,
  );
  await steady("a 1 s drop");
}

async function caseLongOutage() {
  resetSeen();
  const from = pageSockets.length;
  w.pageProxy.cut();
  await wait(40);
  const tries = pageSockets.length - from;
  const g = gaps(from);
  check(
    "during a 40 s outage the page must say there is no connection yet (the long line after 30 s)",
    seen.long,
  );
  check('a long outage of the page alone must not show "PC off"', !seen.off);
  check(
    "during a 40 s outage the page's waits must grow (at most 12 attempts, none closer than 0.25 s)",
    tries >= 2 && tries <= 12 && g.every((x) => x >= 0.2),
    `${tries} attempts, gaps ${g.join(" ")}`,
  );
  w.pageProxy.heal();
  const back = await within(pageUp, 35);
  check(
    "the phone must reconnect within one capped wait (30 s) after a long outage",
    back !== null,
  );
  await askWorks("a long outage");
  timings.push(
    `long outage (40 s): ${tries} attempts, gaps ${g.join(" ")} s; back ${secs(back)} s after the heal`,
  );
  await steady("a long outage");
}

// The page's socket is held only once its first ping (20 s after it opened) had its pong, so the dead link is found
// at the second ping, 50 s after the open: the session ended after more than the page's 45 s (UP_RESET_MS), and the
// retry waits the long outage grew start over (the first wait at most 1 s). Held earlier, the drop came 30 s after
// the open, the session's up time a few ms either side of 30 s, and on a slow machine the grown waits (up to 30 s)
// stayed. The hold waits for that pong itself (a busy computer can bring it after 28 s), then for 28 s after the
// open, so the drop is measured from well after the first ping.
async function caseHalfOpenPage() {
  resetSeen();
  const from = pageSockets.length;
  const sock = pageSockets.at(-1);
  const opened = sock.openAt;
  if (!opened) throw new Error("the page's socket never opened");
  if ((await within(() => sock.pongs > 0, 25)) === null)
    throw new Error("the page's socket had no pong 25 s after it opened");
  await sleep(Math.max(0, (28 * 1000) / K - (Date.now() - opened)));
  w.pageProxy.hold();
  const dropped = await within(() => !pageUp(), 32);
  w.pageProxy.heal();
  check(
    "the page must drop a half-open link within 30 s (ping 20 s + pong wait 10 s)",
    dropped !== null,
  );
  const back = await within(pageUp, 10);
  check(
    "after a session up over 45 s the phone must reconnect within 10 s once it dropped a half-open link (its retry waits start over)",
    back !== null,
    `page sockets +${pageSockets.length - from}`,
  );
  check(
    "a half-open link must not make the page reload",
    page.reloads === 0,
    `${page.reloads} reloads`,
  );
  await askWorks("a half-open page link");
  timings.push(
    `half-open, page side: dropped after ${secs(dropped)} s, back ${secs(back)} s later, ${pageSockets.length - from} page attempts`,
  );
  await steady("a half-open page link");
}

async function caseHalfOpenPc() {
  resetSeen();
  const drawn = page.sessions;
  const lost = pcLost();
  const connects = pcConnects();
  const t0 = Date.now();
  w.pcProxy.hold();
  const dropped = await within(() => pcLost() > lost, 32);
  check(
    "the PC must drop a half-open link within 30 s (ping 20 s + pong wait 10 s)",
    dropped !== null,
  );
  // The relay's own sweep: a PC silent 2 x 20 s + 10 s is closed at the next wake-up (here a phone's hello).
  await sleep(Math.max(0, (55 * 1000) / K - (Date.now() - t0)));
  const probe = await deviceSession(w.channel, w.B).then(
    (x) => {
      x.link.close();
      return "session";
    },
    (e) => e.code,
  );
  check(
    "the relay must close a silent PC after 50 s and then answer offline",
    probe === "pc-offline" &&
      w.relayLog.some((l) => l === "pc closed: dead-link"),
    `probe ${probe}, relay log ${w.relayLog.slice(-5).join(" | ")}`,
  );
  const healed = Date.now();
  w.pcProxy.heal();
  const back = await within(() => w.pcOnline.some((t) => t > healed), 65);
  check(
    "the PC must be back within one capped wait (60 s) after a half-open link heals",
    back !== null,
    `PC connects +${pcConnects() - connects}`,
  );
  // The page's session from before the PC came back is ended by the relay's pc-online, which may reach the page
  // after the watcher: a session drawn since is the new one.
  await within(() => page.sessions > drawn && pageUp(), 5);
  await askWorks("a half-open PC link");
  timings.push(
    `half-open, PC side: PC dropped after ${secs(dropped)} s, relay closed it by 55 s, PC back ${secs(back)} s after the heal (${pcConnects() - connects} PC connects)`,
  );
  await steady("a half-open PC link");
}

// The page is hidden and shown again (phone outbox approach, "The hang-up when hidden"): the socket and the session
// stay; on show one ping checks it.
function setHidden(hidden) {
  globalThis.document.hidden = hidden;
  page.win["document visibilitychange"]();
}
async function caseHideShow() {
  const from = pageSockets.length;
  const sock = pageSockets.at(-1);
  setHidden(true);
  await wait(3);
  check(
    "hiding the page must keep its socket open",
    sock.closeAt === null && pageSockets.length === from,
    `closed ${sock.closeAt !== null}, page sockets +${pageSockets.length - from}`,
  );
  setHidden(false);
  await wait(3);
  check(
    "showing the page again must keep the same socket and session (no new socket)",
    sock.closeAt === null && pageSockets.length === from && pageUp(),
    `closed ${sock.closeAt !== null}, page sockets +${pageSockets.length - from}, up ${pageUp()}`,
  );
  await askWorks("a hide and show");
}

// The socket died while the page was hidden (iOS froze it): the ping on show finds it and only then a new one opens.
async function caseHideDead() {
  const from = pageSockets.length;
  const sock = pageSockets.at(-1);
  setHidden(true);
  await wait(1);
  w.pageProxy.hold();
  setHidden(false);
  const dropped = await within(() => sock.closeAt !== null || !pageUp(), 5);
  w.pageProxy.heal();
  check(
    "a socket that went silent while hidden must be replaced within 5 s of the show (the ping on show)",
    dropped !== null,
  );
  const back = await within(() => pageUp() && pageSockets.length > from, 10);
  check(
    "after a dead socket on show the page must open a new one and its session must come back",
    back !== null,
    `page sockets +${pageSockets.length - from}`,
  );
  await askWorks("a socket dead on show");
  timings.push(
    `hidden, socket dead: replaced ${secs(dropped)} s after the show, back ${secs(back)} s`,
  );
  await steady("a socket dead on show");
}

// A Send while the link drops (phone README, "Sends that survive a dropped link"): the page's link is cut while
// Nimbalyst takes the message, so the PC's answer never reaches the page; the frame sends it again on its next link
// and the PC answers the repeat from its kept ids. Nimbalyst is a fake door over a fixture database with one session.
async function caseSendDropped() {
  // Where the PC looks for Nimbalyst on this system (core/files.mjs nimbalystDir), so the case runs on every CI runner.
  const nim =
    process.platform === "win32"
      ? path.join(w.home, "AppData", "Roaming", "@nimbalyst", "electron")
      : process.platform === "darwin"
        ? path.join(
            w.home,
            "Library",
            "Application Support",
            "@nimbalyst",
            "electron",
          )
        : path.join(w.home, ".config", "@nimbalyst", "electron");
  fs.mkdirSync(path.join(nim, "sqlite-db"), { recursive: true });
  const project = path.join(w.tmp, "projects", "beta");
  fs.mkdirSync(project, { recursive: true });
  const sid = "00000000-0000-4000-8000-00000000a001";
  const now = new Date().toISOString();
  await dbWork(
    path.join(nim, "sqlite-db", "nimbalyst.sqlite"),
    `
    CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
      provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
      is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'claude-code', direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
    CREATE TABLE queued_prompts (id TEXT PRIMARY KEY, session_id TEXT NOT NULL, prompt TEXT NOT NULL,
      status TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
  `,
    [
      [
        `INSERT INTO ai_sessions (id, workspace_id, title, status, model, created_at, updated_at)
       VALUES (?, ?, 'Waits for a message', 'waiting_for_input', 'claude-code:opus', ?, ?)`,
        sid,
        project,
        now,
        now,
      ],
    ],
  );
  const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
  let cutAt = null;
  const door = await startFakeDoor({
    endpointFile: path.join(nim, "mcp-endpoint.json"),
    workspaces: [{ name: "beta", path: project }],
    tools: ["workspace_open", "get_session_status", "send_prompt"],
    handle: async (name) => {
      if (name === "workspace_open") return "opened";
      if (name === "get_session_status")
        return { status: "waiting_for_input", waitingForInput: true };
      if (name !== "send_prompt") throw new Error(`no ${name} here`);
      if (cutAt === null) {
        cutAt = Date.now();
        w.pageProxy.cut();
        // The answer goes out only once the page knows its link is gone.
        if ((await within(() => !pageUp(), 5)) === null)
          throw new Error("the page did not see its cut link within 5 s");
      }
      return {
        statusBeforeQueue: "waiting_for_input",
        processingTriggered: true,
      };
    },
  });
  const sends = () => door.calls.filter((c) => c.name === "send_prompt");
  try {
    const { outbox } = await import(pageUrl("frame/outbox.js"));
    const from = pageSockets.length;
    const e = outbox.add({
      key: sid,
      a: "session.send",
      d: { session: sid, text: "posted once" },
      text: "posted once",
      how: "send",
    });
    const first = await outbox.send(e, page.ctx.ask);
    check(
      "a Send whose answer is lost to a cut link must wait in the outbox (not refused, not gone)",
      Boolean(first.held) && Boolean(outbox.get(e.mid)) && cutAt !== null,
      JSON.stringify({ first, cut: cutAt !== null, sends: sends().length }),
    );
    await sleep(1000 / K);
    w.pageProxy.heal();
    const done = await within(() => !outbox.get(e.mid), 10);
    check(
      "after the link comes back the frame must send it again and the PC's answer must clear it",
      done !== null && pageSockets.length > from,
      `in outbox ${Boolean(outbox.get(e.mid))}, page sockets +${pageSockets.length - from}`,
    );
    await wait(2);
    check(
      "Nimbalyst must get the message exactly once",
      sends().length === 1 &&
        sends()[0].args.prompt.startsWith("posted once\n"),
      JSON.stringify(sends().map((c) => c.args)),
    );
    timings.push(
      `send while the link drops: sent again and answered ${secs(done)} s after the heal, ${sends().length} send in Nimbalyst`,
    );
  } finally {
    await door.close();
  }
  await steady("a send while the link drops");
}

// The phone's network changes: the old socket goes silent, `online` fires, the page comes from a new address.
async function caseNetworkSwitch() {
  const from = pageSockets.length;
  const old = pageSockets.at(-1);
  w.pageProxy.hold();
  page.url = `${w.pageProxy2.url}/`;
  page.win.online();
  const back = await within(pageUp, 5);
  const fresh = pageSockets.slice(from);
  check(
    "after a network switch the page must open one new socket at once, on the new address",
    back !== null &&
      fresh.length === 1 &&
      fresh[0].url.includes(`:${w.pageProxy2.port}/`),
    fresh.map((s) => s.url).join(" "),
  );
  await askWorks("a network switch");
  w.pageProxy.heal();
  check(
    "after a network switch the old socket must be closed",
    (await within(() => old.closeAt !== null, 5)) !== null,
  );
  timings.push(
    `network switch: back ${secs(back)} s after "online", ${fresh.length} new socket`,
  );
  await steady("a network switch");
}

// A second device opens its session mid-session, then a third asks to join: both open devices get the ask.
async function caseSecondDevice() {
  const from = pageSockets.length;
  const drawn = page.sessions;
  const events = [];
  const b = await deviceSession(w.channel, w.B, (e) => events.push(e));
  const st = await b.s.ask("pc.status", {});
  check(
    "a second device must get its own session (pc.status) while the first is open",
    st.ok === true,
    JSON.stringify(st).slice(0, 200),
  );
  check(
    "a second device joining must leave the first page's session untouched",
    pageSockets.length === from && page.sessions === drawn && pageUp(),
    `page sockets +${pageSockets.length - from}, sessions +${page.sessions - drawn}`,
  );
  await askWorks("a second device joined");
  const nl = await w.channel.openLink({
    url: w.channel.socketUrl(w.relay.url),
    initData: w.initData,
    WebSocket: RealSocket,
  });
  const j = await w.channel.join(nl, { kind: "desktop", initData: w.initData });
  j.done.catch(() => {});
  const both = await within(
    () => pageView().cards > 0 && events.some((e) => e.e === "device.ask"),
    5,
  );
  check(
    "a device asking to join must reach both open devices (a card on the page, an event on the second)",
    both !== null,
    `cards ${pageView().cards}, events ${events.map((e) => e.e).join(" ")}`,
  );
  j.cancel();
  nl.close();
  await b.s.bye();
  b.link.close();
  await steady("a second device joined");
}

// A newer page is put on the relay while the page is open.
async function casePageUpdate() {
  const from = pageSockets.length;
  const drawn = page.sessions;
  const file = path.join(w.pageDir, "page", "frame", "app.js");
  fs.appendFileSync(file, "\n// steady: a newer page\n");
  const served = await (await fetch(`${w.relay.url}/page/frame/app.js`)).text();
  check(
    "after a page update a new open must get the new file",
    served.endsWith("// steady: a newer page\n"),
  );
  await askWorks("a page update");
  check(
    "a page update must leave the open page's session as it was, not Read-only",
    pageSockets.length === from &&
      page.sessions === drawn &&
      !pageView().readOnly,
    `page sockets +${pageSockets.length - from}, read-only ${pageView().readOnly}`,
  );
  const b = await deviceSession(w.channel, w.B);
  check(
    'a page opened after an update must get hello page "ok" (not Read-only)',
    b.s.hello.page === "ok",
    JSON.stringify(b.s.hello),
  );
  await b.s.bye();
  b.link.close();
}

async function casePcRestart() {
  resetSeen();
  const drawn = page.sessions;
  const from = pageSockets.length;
  const t0 = Date.now();
  await stopProgram(w.pc);
  w.pc = startProgram([SELF, "--pc"], w.pcEnv);
  const pcBack = await within(() => w.pcOnline.some((t) => t > t0), 200);
  check(
    "the PC program must be back after a restart",
    pcBack !== null,
    w.pc.out,
  );
  const back = await within(() => page.sessions > drawn && pageUp(), 5);
  check(
    "after a PC program restart the page must say hello again within 5 s of the PC being back (pc-online)",
    back !== null,
    `sessions +${page.sessions - drawn}, page sockets +${pageSockets.length - from}`,
  );
  await askWorks("a PC program restart");
  // The page shows "PC off" once the relay's offline answers held 20 s (OFFLINE_HOLD_MS), so after a slower start
  // "PC off" is right and the check cannot apply.
  if (secs(pcBack) < 20)
    check('a PC program back within 20 s must not show "PC off"', !seen.off);
  else
    console.log(
      `skip 'a PC program back within 20 s must not show "PC off"': the PC took ${secs(pcBack)} s to come back, so the page rightly showed "PC off" (seen ${seen.off})`,
    );
  timings.push(
    `PC restart: PC back ${secs(pcBack)} s after the stop (start-up not scaled), page session ${secs(back)} s later`,
  );
  await steady("a PC program restart");
}

async function caseRelayRestart() {
  resetSeen();
  const drawn = page.sessions;
  const connects = pcConnects();
  await w.relay.close();
  w.relay = await w.startRelay(w.relayOpts);
  const back = await within(() => page.sessions > drawn && pageUp(), 10);
  check(
    "after a relay restart the page must have a session again within 10 s",
    back !== null,
    `PC connects +${pcConnects() - connects}`,
  );
  check(
    "after a relay restart the PC must connect again",
    pcConnects() > connects,
  );
  check(
    'a relay restart must not show "PC off" while the PC is on its first retry',
    !seen.off,
  );
  await askWorks("a relay restart");
  timings.push(
    `relay restart: page session ${secs(back)} s after the relay was back, PC connects +${pcConnects() - connects}`,
  );
  await steady("a relay restart");
}

// ---- old with new (design section 6): the released 26.3.1 page channel and PC program
// The page's link is held right after each hello, so it dies at its first ping (20 s + pong wait 10 s), three times
// in a row. Each session was up under 45 s, so the retry waits keep growing: the third wait is longer than the first.
// Math.random is held near 1 here, so each wait is its full 2^n s and the two waits compare without chance.
async function caseDeadAtFirstPing() {
  const random = Math.random;
  Math.random = () => 0.999;
  const waits = [];
  try {
    // A wake starts the retry waits over, whatever the cases before left; the page goes back to its first way to the
    // relay (the network switch moved it to the second).
    w.pageProxy.heal();
    page.url = `${w.pageProxy.url}/`;
    page.win.online();
    if ((await within(pageUp, 10)) === null)
      throw new Error("the page did not connect after a wake");
    for (let i = 0; i < 3; i++) {
      w.pageProxy.hold();
      if ((await within(() => !pageUp(), 35)) === null)
        throw new Error(
          "the page did not drop a link held before its first ping",
        );
      const droppedAt = Date.now();
      const n = pageSockets.length;
      w.pageProxy.heal();
      if ((await within(pageUp, 20)) === null)
        throw new Error("the page did not reconnect after a held link");
      waits.push(secs(pageSockets[n].at - droppedAt));
    }
  } finally {
    Math.random = random;
  }
  check(
    "a link that dies at its first ping, again and again, must make the third retry wait longer than the first (a session up 30 s does not start the waits over)",
    waits[2] > waits[0],
    `waits ${waits.join(" ")} s`,
  );
  timings.push(`dead at first ping, 3 times: waits ${waits.join(" ")} s`);
  page.win.online();
  await within(pageUp, 10);
  await steady("links that died at their first ping");
}

// The link closes while the hello is being sealed: the caller gets the error, and no promise is left rejected with
// no one listening (in a browser, an "Uncaught (in promise)" line; in Node, a crash).
async function caseHelloClosed() {
  const unhandled = [];
  const record = (e) => unhandled.push(e?.message ?? String(e));
  process.on("unhandledRejection", record);
  try {
    const link = await w.channel.openLink({
      url: w.channel.socketUrl(w.relay.url),
      initData: w.initData,
      WebSocket: RealSocket,
    });
    const opening = w.channel.openSession(link, {
      K: w.B.K,
      dev: w.B.dev,
      pageVersion: VERSION,
      onEvent: () => {},
    });
    link.drop("test");
    const err = await opening.then(
      () => null,
      (e) => e,
    );
    await sleep(100);
    check(
      "a link closed during the hello must give the caller an error and leave no unhandled rejection",
      err !== null && unhandled.length === 0,
      `error ${err?.code}, unhandled: ${unhandled.join("; ")}`,
    );
  } finally {
    process.off("unhandledRejection", record);
  }
}

// sendStream's size limit: none given keeps 25 MB (message attachments), FILES_STREAM_MAX (50 MB) lets a bigger
// stream out. Device B's own session, straight to the relay; every frame it sends is counted.
async function caseStreamLimit() {
  const { link, s } = await deviceSession(w.channel, w.B);
  const sent = [];
  const send = link.send;
  link.send = (f) => {
    sent.push(f);
    return send(f);
  };
  const over = new Uint8Array(w.channel.STREAM_MAX + 1);
  const err = await s.sendStream(over, "application/octet-stream").then(
    () => null,
    (e) => e,
  );
  check(
    "a stream one byte over 25 MB with no limit given must be refused with too-big before any piece is sent",
    err?.code === "too-big" && sent.length === 0,
    `error ${err?.code}, frames sent ${sent.length}`,
  );
  let pieces = 0;
  const big = s
    .sendStream(
      over,
      "application/octet-stream",
      () => pieces++,
      w.channel.FILES_STREAM_MAX,
    )
    .catch((e) => e);
  const out = await within(() => pieces > 0, 50);
  check(
    "the same stream with FILES_STREAM_MAX (50 MB) must send its first piece",
    out !== null && w.channel.FILES_STREAM_MAX === 50 * 1024 * 1024,
    `pieces ${pieces}, FILES_STREAM_MAX ${w.channel.FILES_STREAM_MAX}`,
  );
  link.drop("test");
  await big;
}

// The page's own device is removed at the PC (as Settings' Remove on another device does). On the next hello the PC
// answers app-fail unknown-device: the page shows pairing with the reason within 2 s and tries no more.
async function caseUnknownDevice() {
  const removed = await page.ctx
    .ask("devices.remove", { device: w.A.dev })
    .catch((e) => ({ ok: false, err: e.code ?? e.message }));
  if (!removed.ok)
    throw new Error(`devices.remove failed: ${JSON.stringify(removed)}`);
  page.pairingAt = null;
  // A wake: the page says hello again at once.
  page.win.online();
  const shown = await within(
    () =>
      page.pairingAt !== null &&
      els.content.textContent.includes(
        "This device is no longer paired with your PC.",
      ),
    2,
  );
  check(
    'a device the PC no longer holds must show pairing with "This device is no longer paired with your PC." within 2 s of its hello',
    shown !== null,
    `pairing drawn ${page.pairingAt !== null}; the page shows: ${els.content.textContent.slice(0, 200)}`,
  );
  const n = pageSockets.length;
  await wait(6);
  check(
    "a device the PC no longer holds must make no further connect attempt",
    pageSockets.length === n,
    `page sockets +${pageSockets.length - n}`,
  );
}

async function startOld() {
  const dir = path.join(w.tmp, "old");
  if (!(await extractOld(dir))) {
    console.log(
      `skip old-with-new pairs: this clone has no tag ${OLD_TAG} (a shallow checkout)`,
    );
    return null;
  }
  const old = {};
  const oldChannel = pathToFileURL(
    path.join(dir, "phone", "page", "frame", "channel.js"),
  ).href;
  SCALED.add(oldChannel);
  old.channel = await import(oldChannel);
  old.page = await deviceSession(old.channel, w.O);
  old.openedAt = Date.now();
  check(
    'old page / new PC: the hello must say page "ok", so the old page does not grey',
    old.page.s.hello.page === "ok",
    JSON.stringify(old.page.s.hello),
  );
  const st = await old.page.s.ask("pc.status", {});
  check(
    "old page / new PC: pc.status must answer",
    st.ok === true,
    JSON.stringify(st).slice(0, 200),
  );
  // This page with an old PC: the old PC on a relay of its own (one PC per Telegram user), paired by this page's
  // channel.
  old.home = path.join(w.tmp, "old-home");
  fs.mkdirSync(old.home);
  old.env = pcEnvFor(old.home);
  const oldPc = path.join(dir, "skills", "phone-bot", "pc");
  const oldSetup = path.join(oldPc, "setup.mjs");
  old.relay = await w.startRelay({
    ...w.relayOpts,
    port: 0,
    storeFile: path.join(w.tmp, "old-pc-relay-store.bin"),
  });
  await setupRun(oldSetup, ["join", old.relay.url], old.env);
  old.pc = startProgram([SELF, "--pc", oldPc], old.env);
  if (
    (await within(() => / connect pc-/.test(logText(old.home)), 100)) === null
  )
    throw new Error(`the old PC program did not connect:\n${old.pc.out}`);
  old.pcAt = Date.now();
  const paired = await pairWith(
    w.channel,
    old.relay.url,
    oldSetup,
    old.env,
    "iphone",
  );
  const mine = await deviceSession(w.channel, paired, () => {}, old.relay.url);
  const st2 = await mine.s.ask("pc.status", {});
  check(
    `this page / ${OLD_TAG} PC: a session must open and pc.status must answer`,
    mine.s.hello.page === "ok" && st2.ok === true,
    JSON.stringify({ hello: mine.s.hello, st2 }).slice(0, 300),
  );
  const list = await mine.s.ask("folder.list", { dir: "" });
  check(
    `this page / ${OLD_TAG} PC: folder.list must be refused with not-offered (the PC has no Files actions)`,
    list.ok === false && list.err === "not-offered",
    JSON.stringify(list).slice(0, 200),
  );
  // The frame's rule (frame/app.js `offered`, through frame/offers.js): a screen whose actions are not all
  // offered is greyed with its update line.
  check(
    `this page / ${OLD_TAG} PC: the Files tab must be greyed with its update line (the frame must not offer folder.list to a PC without it, and must still offer its old actions)`,
    !(await offersRule())(mine.s.hello, "folder.list") &&
      (await offersRule())(mine.s.hello, "sessions.list"),
    JSON.stringify(mine.s.hello).slice(0, 300),
  );
  await mine.s.bye();
  mine.link.close();
  old.r = await startOldRelay(dir, old.channel);
  return old;
}

// This PC program with the old relay and page: the old relay (local/server.mjs of the tag) serving the old page,
// the old page channel paired with this PC program. The PC's home holds a stand-in Nimbalyst (endpoint file and
// database, as tests/test-phone-alerts.mjs) with one running session, so a finished session gives an alert.
async function startOldRelay(dir, oldChannel) {
  const r = { home: path.join(w.tmp, "old-relay-home"), tg: [] };
  fs.mkdirSync(r.home);
  const { startLocalRelay } = await import(
    pathToFileURL(path.join(dir, "phone", "relay", "local", "server.mjs")).href
  );
  r.relay = await startLocalRelay({
    ...w.relayOpts,
    port: 0,
    pageDir: path.join(dir, "phone", "page"),
    storeFile: path.join(w.tmp, "old-relay-store.bin"),
    telegram: async (method, params) => {
      r.tg.push({ method, params });
      if (method === "getMe") return { id: BOT_ID, has_topics_enabled: false };
      return method === "sendMessage" ? { message_id: r.tg.length } : true;
    },
  });
  const project = path.join(w.tmp, "alpha-web");
  r.env = pcEnvFor(r.home);
  // Where the PC looks for Nimbalyst (core/files.mjs nimbalystDir): APPDATA on Windows, else under the home. Both
  // get the fixture, so the case does not hang on which one PHONE_PC_PLATFORM picks.
  const nims = [
    path.join(r.env.APPDATA, "@nimbalyst", "electron"),
    process.platform === "darwin"
      ? path.join(
          r.home,
          "Library",
          "Application Support",
          "@nimbalyst",
          "electron",
        )
      : path.join(r.home, ".config", "@nimbalyst", "electron"),
  ];
  r.env.NIMBALYST_ENDPOINT_FILE = path.join(nims[0], "mcp-endpoint.json");
  const at = new Date().toISOString();
  r.dbFiles = nims.map((nim) =>
    path.join(nim, "sqlite-db", "nimbalyst.sqlite"),
  );
  for (const nim of nims) {
    fs.mkdirSync(path.join(nim, "sqlite-db"), { recursive: true });
    fs.writeFileSync(
      path.join(nim, "mcp-endpoint.json"),
      JSON.stringify({
        port: 1,
        token: "test-token",
        pid: process.pid,
        workspaces: [{ name: "alpha-web", path: project }],
      }),
    );
  }
  // WAL, as Nimbalyst's own database: the PC's read never waits on the test's write. With the default journal
  // the PC's look can land on the UPDATE below, fail with "database is locked", and start a fresh first look that
  // takes the finished state as known, so no alert goes.
  for (const db of r.dbFiles)
    await dbWork(
      db,
      `
      PRAGMA journal_mode = WAL;
      CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL, status TEXT,
        provider_session_id TEXT, worktree_id TEXT, model TEXT, metadata TEXT NOT NULL DEFAULT '{}',
        is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, path TEXT NOT NULL);
      CREATE TABLE ai_agent_messages (id INTEGER PRIMARY KEY, session_id TEXT NOT NULL, created_at TEXT NOT NULL,
        direction TEXT NOT NULL, content TEXT NOT NULL, message_kind TEXT);
    `,
      [
        [
          "INSERT INTO ai_sessions (id, workspace_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
          "00000000-0000-4000-8000-000000000001",
          project,
          "Fix the login page",
          "running",
          at,
          at,
        ],
      ],
    );
  await setupRun(SETUP, ["join", r.relay.url], r.env);
  r.pc = startProgram([SELF, "--pc"], r.env);
  if ((await within(() => / connect pc-/.test(logText(r.home)), 100)) === null)
    throw new Error(
      `the PC program did not connect to the old relay:\n${r.pc.out}`,
    );
  r.pcAt = Date.now();
  const paired = await pairWith(
    oldChannel,
    r.relay.url,
    SETUP,
    r.env,
    "iphone",
  );
  r.page = await deviceSession(oldChannel, paired, () => {}, r.relay.url);
  const st = await r.page.s.ask("pc.status", {});
  check(
    `${OLD_TAG} relay and page / this PC: a session must open and pc.status must answer`,
    r.page.s.hello.page === "ok" &&
      st.ok === true &&
      st.d?.setupVersion === VERSION,
    JSON.stringify({ hello: r.page.s.hello, st }).slice(0, 300),
  );
  // The watcher's first look (which sends nothing) saw the session running: main.mjs makes it at start, in the same
  // step as its first connect, so it is done once " connect pc-" is in the log. Now the session finishes.
  for (const db of r.dbFiles)
    await dbWork(db, "", [
      [
        "UPDATE ai_sessions SET status = ?, updated_at = ?",
        "completed",
        new Date().toISOString(),
      ],
    ]);
  const alert = () =>
    r.tg.find(
      (c) => c.method === "sendMessage" && /finished/.test(c.params?.text),
    );
  await within(alert, 150);
  check(
    `${OLD_TAG} relay and page / this PC: a finished session's alert must reach the bot chat through the old relay`,
    String(alert()?.params.chat_id) === String(OWNER) &&
      /Fix the login page/.test(alert()?.params.text),
    `${JSON.stringify(r.tg).slice(0, 300)}\npc.log: ${logText(r.home).slice(-600)}`,
  );
  return r;
}

// A 30 MB recording from this page's channel (its own copy on the real clock: the scaled one's waits are 10 times
// as short) through the real PC program to voice.transcribe and the stand-in transcriber.
// The frame's rule for which PC actions a screen may use (frame/offers.js, as the page serves it).
async function offersRule() {
  return (await import(pageUrl("frame/offers.js"))).offers;
}

async function caseVoice30() {
  const ch = await import(`${pageUrl("frame/channel.js")}?real-clock`);
  const { link, s } = await deviceSession(ch, w.B);
  check(
    "this page / this PC: the hello must name the PC's actions, so the frame offers the Files tab (folder.list)",
    Array.isArray(s.hello.actions) &&
      (await offersRule())(s.hello, "folder.list"),
    JSON.stringify(s.hello).slice(0, 300),
  );
  const bytes = new Uint8Array(nodeRandom(30 * 1024 * 1024));
  const want = createHash("sha256").update(bytes).digest("hex");
  const started = Date.now();
  const sent = await s
    .sendStream(bytes, "audio/mp4", () => {}, ch.FILES_STREAM_MAX)
    .catch((e) => ({ ok: false, err: e.code ?? e.message }));
  const job = sent.ok
    ? await s.ask("voice.transcribe", { stream: sent.d.stream })
    : null;
  let r = null;
  for (let i = 0; i < 3 && job?.ok && !r?.d?.done; i++)
    r = await s.ask("voice.result", { job: job.d.job });
  check(
    "a 30 MB recording must go from this page's channel through the PC program to voice.transcribe whole (size and SHA-256 at the transcriber)",
    r?.ok === true &&
      r.d.done &&
      r.d.text === `heard ${bytes.length} bytes ${want}`,
    JSON.stringify({ sent, job, r }).slice(0, 300),
  );
  timings.push(`30 MB recording to its text: ${Date.now() - started} ms real`);
  await s.bye();
  link.close();
}

// A Files drop-in of 50 MB (all the PC holds for one device) that folder.put refuses before it takes the stream (a
// folder that is not there), then a small one: the page frees the stream's bytes on the answer, so the PC must drop
// the refused stream then too, or it holds the small one off until its own minute is up. This page's channel on the
// real clock, as caseVoice30.
async function caseRefusedUpload() {
  const ch = await import(`${pageUrl("frame/channel.js")}?real-clock`);
  const { link, s } = await deviceSession(ch, w.B);
  const big = new Uint8Array(nodeRandom(ch.FILES_STREAM_MAX));
  const sentBig = await s
    .sendStream(big, "application/octet-stream", () => {}, ch.FILES_STREAM_MAX)
    .catch((e) => ({ ok: false, err: e.code ?? e.message }));
  const refused = sentBig.ok
    ? await s.ask("folder.put", {
        dir: "no-such-folder",
        name: "big.bin",
        stream: sentBig.d.stream,
      })
    : null;
  const started = Date.now();
  let waited = false; // the page's stream line held the small one back
  const sentSmall = await s
    .sendStream(
      new Uint8Array(nodeRandom(1024)),
      "text/plain",
      () => {},
      ch.FILES_STREAM_MAX,
      (on) => {
        if (on) waited = true;
      },
    )
    .catch((e) => ({ ok: false, err: e.code ?? e.message }));
  const put = sentSmall.ok
    ? await s.ask("folder.put", {
        dir: "",
        name: "small.txt",
        stream: sentSmall.d.stream,
      })
    : null;
  const took = Date.now() - started;
  // No clock bound: a PC that kept the refused stream answers the small one stream-broken at once (sentSmall not
  // ok, put null), and a page that kept its bytes makes the small one wait in its stream line (waited).
  check(
    "a refused 50 MB upload must not block the next file: after folder.put answers not-found, a 1 KB upload goes at once and is saved (FAIL: the PC kept the refused stream and refused the next as over its 50 MB)",
    refused?.ok === false &&
      refused.err === "not-found" &&
      !waited &&
      put?.ok === true,
    `${JSON.stringify({ sentBig, refused, sentSmall, put, waited }).slice(0, 400)} in ${took} ms`,
  );
  timings.push(`a 1 KB upload after a refused 50 MB one: ${took} ms real`);
  await s.bye();
  link.close();
}

// Checked once 135 s (more than the relay's 130 s for a socket that does not say `ping`) have passed.
async function checkOld(old) {
  const need = (135 * 1000) / K;
  await sleep(
    Math.max(0, need - (Date.now() - Math.min(old.openedAt, old.pcAt))),
  );
  // A phone socket opening wakes the relay, which then sweeps.
  (await openWatcher()).close();
  check(
    "old page / new relay: an idle old page's link must not be closed (and pc-online did not upset it)",
    !old.page.link.closed,
    JSON.stringify(old.page.link.closed),
  );
  // Since 26.3.2 the page's channel ends its session on the relay's pc-online (a restarted PC forgot it) and the
  // frame says hello again; the 26.3.1 channel kept the session, so this check asked the old session itself.
  const ended = await Promise.race([
    old.page.s.ended,
    sleep(2000).then(() => null),
  ]);
  const again = await old.channel
    .openSession(old.page.link, {
      K: w.O.K,
      dev: w.O.dev,
      pageVersion: VERSION,
      onEvent: () => {},
    })
    .catch((e) => e);
  const st = again?.ask
    ? await again.ask("pc.status", {}).catch((e) => e)
    : again;
  check(
    "old page / new relay: after 135 s and a PC reconnect, its session must end with pc-online and a new hello must answer",
    ended?.code === "pc-online" && st?.ok === true,
    JSON.stringify({ ended: ended?.code ?? ended, st: st?.code ?? st }).slice(
      0,
      200,
    ),
  );
  const text = logText(old.home);
  check(
    "old PC / new relay: the old PC must stay connected (one connect, no close)",
    count(text, / connect pc-/g) === 1 && count(text, / closed /g) === 0,
    text
      .split("\n")
      .filter((l) => / connect pc-| closed | lost | stopped | drop /.test(l))
      .join("\n")
      .slice(-1200),
  );
  const r = old.r;
  const st2 = await r.page.s.ask("pc.status", {}).catch((e) => e);
  const text2 = logText(r.home);
  check(
    `${OLD_TAG} relay and page / this PC: after 135 s the session must still answer and the PC must have connected once, with no close`,
    st2?.ok === true &&
      !r.page.link.closed &&
      count(text2, / connect pc-/g) === 1 &&
      count(text2, / closed /g) === 0,
    `${String(st2?.code ?? JSON.stringify(st2)).slice(0, 200)}\n${text2.slice(-600)}`,
  );
  timings.push(
    `old pairs: old page idle ${secs(Date.now() - old.openedAt)} s, old PC ${secs(Date.now() - old.pcAt)} s, this PC on the old relay ${secs(Date.now() - r.pcAt)} s, none closed`,
  );
  old.page.link.close();
  r.page.link.close();
}

async function runAll() {
  let old = null;
  try {
    await startWorld();
    await startPage();
    old = await startOld();
    await caseShortDrop();
    await caseLongOutage();
    await caseHalfOpenPage();
    await caseHalfOpenPc();
    await caseHideShow();
    await caseHideDead();
    await caseSendDropped();
    await caseNetworkSwitch();
    await caseSecondDevice();
    await casePageUpdate();
    if (old) await checkOld(old);
    await casePcRestart();
    await caseRelayRestart();
    await caseDeadAtFirstPing();
    await caseHelloClosed();
    await caseStreamLimit();
    await caseVoice30();
    await caseRefusedUpload();
    // Last: it removes the page's device at the PC.
    await caseUnknownDevice();
  } catch (e) {
    check("the run finished", false, e.stack);
  } finally {
    await stopProgram(w.pc);
    await stopProgram(old?.pc);
    await stopProgram(old?.r?.pc);
    for (const p of [w.pageProxy, w.pageProxy2, w.pcProxy]) await p?.close();
    await w.relay?.close();
    await old?.relay?.close();
    await old?.r?.relay?.close();
    if (w.tmp)
      fs.rmSync(w.tmp, { recursive: true, force: true, maxRetries: 5 });
  }
  console.log(`\nTimes on the scaled clock (1 s = ${1000 / K} ms real):`);
  for (const t of timings) console.log(`  ${t}`);
  console.log(`\n${pass} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
}

if (process.argv[2] === "--pc") await runPc(process.argv[3]);
else await runAll();
