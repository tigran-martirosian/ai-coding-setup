// End to end without Telegram: the built page served by the local relay, the real PC program against it, and the
// page's own channel code (phone/page/frame/channel.js, run in Node) pairing with a code and asking pc.status, then
// the Files path: drop in, Send to chat (to a Telegram stand-in) and the one-time download link.
// Everything lives in a temp folder; the real ~/.phone-app is never read or written.
//   node tests/test-phone-e2e.mjs
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes as nodeRandom } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");
const MAIN = path.join(PC, "main.mjs");
const SETUP = path.join(PC, "setup.mjs");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "version.json"), "utf8"),
).version;
const BOT_ID = 7000001;
const OWNER = 111;

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms) => {
  for (const end = Date.now() + ms; Date.now() < end; await sleep(100))
    if (fn()) return true;
  return false;
};

// ---- a DOM stand-in with what frame/dom.js and Settings use, so the real Settings screen renders in Node
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
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({});
  }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (_ns, tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
};
const stored = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => stored.get(k) ?? null,
    setItem: (k, v) => stored.set(k, String(v)),
    removeItem: (k) => stored.delete(k),
  },
});
const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
const byClass = (root, c) =>
  walk(root).filter((n) => n.className?.split(" ").includes(c));

// A temp home for the whole run, set before the PC code or the relay is loaded.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-e2e-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home);
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
});
const seal = await import("../phone/shared/seal.mjs");
const { buildPage, writePage } = await import("../phone/page/build.mjs");
const { startLocalRelay } = await import("../phone/relay/local/server.mjs");
const channel = await import("../phone/page/frame/channel.js");

// ---- Telegram stand-in: the test's own Ed25519 key signs initData; relay and PC get its public key.
const tg = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);
const tgPubHex = seal.toHex(
  new Uint8Array(await crypto.subtle.exportKey("raw", tg.publicKey)),
);

async function initDataFor(userId) {
  const fields = {
    auth_date: String(Math.floor(Date.now() / 1000)),
    query_id: "q1",
    user: JSON.stringify({ id: userId, first_name: "Test" }),
  };
  const lines = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const sig = await crypto.subtle.sign(
    "Ed25519",
    tg.privateKey,
    seal.utf8(`${BOT_ID}:WebAppData\n${lines.join("\n")}`),
  );
  const p = new URLSearchParams(fields);
  p.set("signature", seal.toB64u(new Uint8Array(sig)));
  return p.toString();
}

function startPc(pcEnv) {
  const child = spawn(process.execPath, [MAIN], {
    env: { ...process.env, ...pcEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.out = "";
  child.stdout.on("data", (d) => (child.out += d));
  child.stderr.on("data", (d) => (child.out += d));
  return child;
}

async function stopPc(child) {
  if (child.exitCode !== null) return;
  const gone = new Promise((r) => child.on("exit", r));
  child.kill();
  await gone;
}

async function getCode(pcEnv) {
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [SETUP, "pair"], {
      env: { ...process.env, ...pcEnv },
    });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("exit", (code) => resolve({ code, out }));
  });
  const m = /Pairing code[^\n]*\n\s*([A-Z2-7 .]+)/.exec(r.out);
  if (!m) throw new Error(`setup pair gave no code:\n${r.out}`);
  return m[1].trim();
}

// Opens the page's link and its sealed session, as the page does on start.
async function session(url, initData, p, onEvent = () => {}) {
  const link = await channel.openLink({
    url: channel.socketUrl(url),
    initData,
    WebSocket,
  });
  const s = await channel.openSession(link, {
    K: p.K,
    dev: p.dev,
    pageVersion: VERSION,
    onEvent,
  });
  return { link, s };
}

// A device with no key asks to join by an OK (pipe design, section 15), as the page's "OK it on my other device".
async function askToJoin(url, initData) {
  const link = await channel.openLink({
    url: channel.socketUrl(url),
    initData,
    WebSocket,
  });
  const j = await channel.join(link, { kind: "desktop", initData });
  return { link, j };
}

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

let relay = null;
const relayLog = [];
// What the Telegram stand-in got by sendDocument: { method, length, chatId, fileName, hash }.
const uploads = [];
// The step a crash happened in, named in the failure (a timeout's stack shows only the channel's timer).
let step = "the steps before Unpair";
let stepAt = Date.now();
let pc = null;
const botLines = [];
try {
  // ---- the build
  const a = buildPage();
  const b = buildPage();
  check(
    "two builds give the same files, byte for byte",
    JSON.stringify(a.files.map(([p, t]) => [p, seal.toHex(t)])) ===
      JSON.stringify(b.files.map(([p, t]) => [p, seal.toHex(t)])),
  );
  const served = a.files.map(([p]) => p);
  check(
    "the normal build leaves the Checks screen out",
    !served.includes("/page/checks/checks.js") &&
      buildPage({ checks: true })
        .files.map(([p]) => p)
        .includes("/page/checks/checks.js"),
  );
  const pageDir = path.join(tmp, "page");
  writePage(pageDir, a);

  // ---- the local relay and the PC program
  relay = await startLocalRelay({
    port: 0,
    pageDir,
    botId: BOT_ID,
    ownerTgId: OWNER,
    telegramKey: tgPubHex,
    // Only the bot line of a join is sent (and kept here); a throw would make the local relay close the PC's socket.
    // getMe says the bot chat has no topics, so Send to chat goes to the plain chat.
    telegram: async (method, body) => {
      if (method === "getMe") return { id: BOT_ID, has_topics_enabled: false };
      if (method !== "sendMessage")
        throw new Error("the test relay does not reach Telegram");
      botLines.push(body.text);
      return { message_id: botLines.length };
    },
    // Send to chat's sendDocument: the multipart body is read whole and its document part kept by hash.
    upload: async (method, { body, length, type }) => {
      const all = Buffer.from(await new Response(body).arrayBuffer());
      const boundary = /boundary=(.+)$/.exec(type)?.[1];
      const part = (name) => {
        const at = all.indexOf(`name="${name}"`);
        if (at < 0) return null;
        const start = all.indexOf("\r\n\r\n", at) + 4;
        return all.subarray(start, all.indexOf(`\r\n--${boundary}`, start));
      };
      const head = all
        .subarray(0, all.indexOf("\r\n\r\n", all.indexOf('name="document"')))
        .toString();
      uploads.push({
        method,
        length: length === all.length,
        chatId: part("chat_id")?.toString() ?? null,
        fileName: /filename="([^"]*)"/.exec(head)?.[1] ?? null,
        hash: part("document") ? sha256(part("document")) : null,
      });
      return { message_id: 900 + uploads.length };
    },
    download: async () => {
      throw new Error("the test relay downloads nothing");
    },
    now: Date.now,
    // Kept for the crash report below; a run that passes prints none of it.
    log: (line) => relayLog.push(`${new Date().toISOString()} ${line}`),
    bot: null,
  });
  // Every socket the relay opens and closes and each frame's type, for the same report (the server calls the hub
  // through these names, so the wrappers see every call).
  {
    const { hub } = relay;
    let socks = 0;
    const who = (c) => `#${(c.n ??= ++socks)} ${c.attachment?.role ?? "-"}`;
    for (const name of ["open", "message", "closed"]) {
      const real = hub[name].bind(hub);
      hub[name] = (c, x) => {
        let t = "";
        if (name === "message")
          try {
            t = ` ${JSON.parse(x).t}`;
          } catch {
            t = " (not JSON)";
          }
        relayLog.push(`${new Date().toISOString()} ${name} ${who(c)}${t}`);
        return real(c, x);
      };
    }
  }
  const index = await fetch(`${relay.url}/`);
  check(
    "the relay serves the built page with its content policy",
    index.ok &&
      (await index.text()).includes('src="page/frame/app.js"') &&
      /script-src 'self'/.test(index.headers.get("content-security-policy")),
  );

  const pcEnv = {
    PHONE_PC_DRY: "1",
    PHONE_PC_TEST: "1",
    PHONE_PC_PLATFORM: "win32",
    PHONE_PC_PIPE:
      process.platform === "win32"
        ? `\\\\.\\pipe\\phone-app-pc-test-${nodeRandom(6).toString("hex")}`
        : path.join(tmp, "pc.sock"),
    PHONE_PC_TG_KEY: tgPubHex,
    NIMBALYST_ENDPOINT_FILE: path.join(tmp, "no-endpoint.json"),
  };
  const join = spawnSync(process.execPath, [SETUP, "join", relay.url], {
    env: { ...process.env, ...pcEnv },
    encoding: "utf8",
  });
  check("setup join against the local relay", join.status === 0, join.stderr);
  const logFile = path.join(home, ".phone-app", "pc.log");
  const logText = () =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";

  pc = startPc(pcEnv);
  check(
    "the PC program connects to the relay",
    await until(() => /connect pc-/.test(logText()), 10000),
    pc.out + logText(),
  );

  // ---- the page pairs with a code and asks pc.status
  const initData = await initDataFor(OWNER);
  const code = await getCode(pcEnv);
  const link = await channel.openLink({
    url: channel.socketUrl(relay.url),
    initData,
    WebSocket,
  });
  const paired = await channel.pair(link, { code, initData, kind: "iphone" });
  link.close();
  check(
    "the page pairs with the code: a 32-byte key and a device id",
    paired.K?.length === 32 && /^[\w-]{22}$/.test(paired.dev),
    JSON.stringify(Object.keys(paired)),
  );
  const keyFile = path.join(home, ".phone-app", "pc-keys.json");
  const devices = () => JSON.parse(fs.readFileSync(keyFile, "utf8")).devices;
  check(
    "the page sends its kind with the code: the PC keeps it",
    devices()[0]?.kind === "iphone",
    JSON.stringify(devices()[0]?.kind),
  );
  {
    const again = await channel.openLink({
      url: channel.socketUrl(relay.url),
      initData,
      WebSocket,
    });
    const err = await channel
      .pair(again, { code, initData, kind: "iphone" })
      .then(
        () => null,
        (e) => e,
      );
    again.close();
    check(
      "the same code a second time is refused",
      err instanceof channel.ChannelError,
      String(err),
    );
  }

  {
    const { link: l, s } = await session(relay.url, initData, paired);
    check(
      'hello: the PC says page "ok"',
      s.hello.page === "ok",
      JSON.stringify(s.hello),
    );
    const st = await s.ask("pc.status", {});
    check(
      "pc.status comes back through the relay, sealed",
      st.ok === true &&
        st.d.setupVersion === VERSION &&
        st.d.nimbalyst === "closed",
      JSON.stringify(st),
    );
    await s.bye();
    l.close();
  }

  // ---- the Files path (files design, sections 4 and 6): a file dropped in from the page goes to the Files folder,
  // then out again by Send to chat (to the Telegram stand-in) and by a one-time download link (through the relay)
  step = "the Files path";
  stepAt = Date.now();
  {
    const { link: l, s } = await session(relay.url, initData, paired);
    const bytes = new Uint8Array(nodeRandom(3 * 1024 * 1024));
    const want = sha256(bytes);
    const sent = await s.sendStream(
      bytes,
      "application/pdf",
      () => {},
      channel.FILES_STREAM_MAX,
    );
    const put = await s.ask("folder.put", {
      dir: "",
      name: "report.pdf",
      stream: sent.d?.stream,
    });
    const onDisk = path.join(home, "phone-inbox", put.d?.name ?? "report.pdf");
    check(
      "drop in: a 3 MB file streamed from the page must land whole in the Files folder (folder.put)",
      sent.ok === true &&
        put.ok === true &&
        fs.existsSync(onDisk) &&
        sha256(fs.readFileSync(onDisk)) === want,
      JSON.stringify({ sent, put, there: fs.existsSync(onDisk) }),
    );
    const send = await s.ask("folder.send", { path: put.d?.name }, 30000);
    const doc = uploads.at(-1);
    check(
      "Send to chat: the file must reach Telegram's sendDocument as the document part, same SHA-256, to the owner",
      send.ok === true &&
        send.d?.sent === true &&
        uploads.length === 1 &&
        doc.method === "sendDocument" &&
        doc.length === true &&
        doc.chatId === String(OWNER) &&
        doc.fileName === "report.pdf" &&
        doc.hash === want,
      `${JSON.stringify({ send, uploads })}\nrelay log: ${relayLog
        .filter((x) => !/ (open|message|closed) #/.test(x))
        .slice(-6)
        .join("\n")}`,
    );
    const made = await s.ask("folder.link", { path: put.d?.name }, 30000);
    let got = null;
    if (made.ok) {
      const r = await fetch(made.d.url);
      got = {
        status: r.status,
        hash: sha256(new Uint8Array(await r.arrayBuffer())),
      };
    }
    check(
      "download link: the one-time link must give the file's bytes, same SHA-256",
      made.ok === true &&
        made.d.size === bytes.length &&
        got?.status === 200 &&
        got.hash === want,
      JSON.stringify({ made, got }),
    );
    const again = made.ok ? (await fetch(made.d.url)).status : null;
    check(
      "download link: a second use of the same link must answer 410",
      again === 410,
      String(again),
    );
    await s.bye();
    l.close();
  }
  step = "the steps before Unpair";
  stepAt = Date.now();

  // ---- a second device joins by an OK on the paired one (pipe design, section 15)
  {
    const { joinWords } = await import("../phone/page/screens/device-join.js");
    const events = [];
    const a = await session(relay.url, initData, paired, (b) => events.push(b));
    const asked = (n) => events.filter((b) => b.e === "device.ask")[n];
    const { link: nl, j } = await askToJoin(relay.url, initData);
    check(
      'a second device with no key gets "Waiting for OK" with a six-digit check number',
      /^\d{6}$/.test(j.word) &&
        j.open === 1 &&
        joinWords("waiting") === "Waiting for OK",
      JSON.stringify({ word: j.word, open: j.open }),
    );
    await until(() => asked(0), 5000);
    const ask = asked(0)?.d;
    check(
      "the paired device gets the request with the same number and the kind",
      ask?.word === j.word && ask?.kind === "desktop",
      JSON.stringify(ask),
    );
    const ok = await a.s.ask("device.answer", { rid: ask?.rid, ok: true });
    const got = await j.done;
    nl.close();
    check(
      "after OK the new device holds a 32-byte key for this PC",
      ok.ok === true && got.K.length === 32 && got.dev === j.dev,
      JSON.stringify(ok),
    );
    const n = await session(relay.url, initData, got);
    const st = await n.s.ask("pc.status", {});
    check(
      "the joined device gets PC status through the local relay",
      st.ok === true && st.d.setupVersion === VERSION,
      JSON.stringify(st),
    );
    await n.s.bye();
    n.link.close();
    await until(
      () => events.some((b) => b.e === "device.asked" && b.d.answer === "ok"),
      5000,
    );
    check(
      "the request card goes on the paired device after the OK",
      events.some((b) => b.e === "device.asked" && b.d.rid === ask?.rid),
    );

    const { link: nl2, j: j2 } = await askToJoin(relay.url, initData);
    await until(() => asked(1), 5000);
    const no = await a.s.ask("device.answer", {
      rid: asked(1)?.d.rid,
      ok: false,
    });
    const err = await j2.done.then(
      () => null,
      (e) => e,
    );
    nl2.close();
    check(
      "after No the new device shows the refusal and holds no key",
      no.ok === true &&
        err?.code === "refused" &&
        joinWords(err.code) ===
          "Your other device said No. Nothing was saved." &&
        devices().length === 2 &&
        !devices().some((d) => d.device === j2.dev),
      `${JSON.stringify(no)} ${err?.code} ${devices().length}`,
    );
    await a.s.bye();
    a.link.close();
  }

  {
    const stranger = await initDataFor(222);
    const err = await channel
      .openLink({
        url: channel.socketUrl(relay.url),
        initData: stranger,
        WebSocket,
      })
      .then((l) => l.next(() => false, 5000))
      .then(
        () => null,
        (e) => e,
      );
    check(
      "a Telegram account that is not invited is closed with not-invited",
      err?.code === "not-invited",
      String(err?.code ?? err),
    );
  }

  // ---- Settings' devices list, Remove and Unpair (UN1): the real Settings screen on the DOM stand-in, asking the
  // real PC through the page's own channel. Telegram's popup is a stand-in that answers with the button set below.
  {
    const screens = await import("../phone/page/frame/screens.js");
    await import("../phone/page/screens/settings.js");
    const settings = screens.screen("settings");
    const open = async (p) => {
      const { link, s } = await session(relay.url, initData, p);
      const seen = { popups: [], asks: [], unpaired: 0, answer: null };
      const root = settings.render({
        params: {},
        connected: true,
        pairing: p,
        hello: s.hello,
        tg: {
          initDataUnsafe: { user: { id: OWNER, first_name: "Owner" } },
          showPopup(params, cb) {
            seen.popups.push(params);
            setTimeout(() => cb(seen.answer), 0);
          },
        },
        ask(a, d) {
          seen.asks.push(a);
          return s.ask(a, d);
        },
        haptic() {},
        offered: () => true,
        // The frame's part (app.js): forget the stored key and show pairing; counted here.
        unpaired: async () => {
          seen.unpaired++;
        },
      });
      return { link, s, root, seen };
    };
    const rows = (root) => byClass(root, "dev");
    const rowOf = (root, dev) =>
      rows(root).find((r) => r.attrs["data-device"] === dev);

    const A = await open(paired);
    await until(() => rows(A.root).length === 2, 5000);
    const mine = rowOf(A.root, paired.dev);
    const otherDev = rows(A.root).find((r) => r !== mine)?.attrs["data-device"];
    const other = rowOf(A.root, otherDev);
    check(
      "Settings lists both devices: kind, paired date and last seen, This device on this one, Remove on the other",
      rows(A.root).length === 2 &&
        /^iPhoneThis devicepaired [^·]+ · last seen today /.test(
          mine.textContent,
        ) &&
        byClass(mine, "dev-remove").length === 0 &&
        /paired [^·]+ · (last seen today |not seen yet)/.test(
          other?.textContent,
        ) &&
        byClass(other, "dev-remove").length === 1,
      A.root.textContent,
    );
    byClass(other, "dev-remove")[0].click();
    const asked = byClass(A.root, "dev-ask")[0]?.textContent ?? "";
    byClass(A.root, "dev-cancel")[0].click();
    check(
      "Remove asks first in one line, and its Cancel changes nothing",
      asked.startsWith("Remove it?") &&
        byClass(A.root, "dev-ask").length === 0 &&
        !A.seen.asks.includes("devices.remove") &&
        devices().length === 2,
      asked,
    );
    byClass(rowOf(A.root, otherDev), "dev-remove")[0].click();
    byClass(A.root, "dev-yes")[0].click();
    await until(() => rows(A.root).length === 1, 5000);
    check(
      "Remove's yes removes the other device: the list and the key file lose it",
      rows(A.root).length === 1 &&
        devices().length === 1 &&
        devices()[0].device === paired.dev,
      JSON.stringify(devices().map((d) => d.device)),
    );
    await A.s.bye();
    A.link.close();

    // A further phone pairs by code, then unpairs itself; the first device stays for the parts below.
    const l3 = await channel.openLink({
      url: channel.socketUrl(relay.url),
      initData,
      WebSocket,
    });
    const third = await channel.pair(l3, {
      code: await getCode(pcEnv),
      initData,
      kind: "android",
    });
    l3.close();
    const C = await open(third);
    await until(
      () =>
        rows(C.root).length === 2 &&
        /Connected · paired/.test(C.root.textContent),
      5000,
    );
    C.seen.answer = "cancel";
    byClass(C.root, "unpair")[0].click();
    await sleep(500);
    const popup = C.seen.popups[0];
    check(
      "Unpair asks with Telegram's popup (Cancel and a destructive Unpair); Cancel changes nothing",
      C.seen.popups.length === 1 &&
        /^Unpair .+\?$/.test(popup.title) &&
        popup.buttons.map((b) => `${b.id}:${b.type}`).join() ===
          "cancel:cancel,unpair:destructive" &&
        !C.seen.asks.includes("devices.remove") &&
        C.seen.unpaired === 0 &&
        devices().length === 2,
      JSON.stringify(popup),
    );
    C.seen.answer = "unpair";
    byClass(C.root, "unpair")[0].click();
    await until(() => C.seen.unpaired === 1, 5000);
    check(
      "Unpair after the confirm: the PC drops this device's key, then the page forgets its own and shows pairing",
      C.seen.unpaired === 1 &&
        devices().length === 1 &&
        devices()[0].device === paired.dev,
      JSON.stringify(devices().map((d) => d.device)),
    );
    C.link.close();
  }

  // A session the restarted PC no longer knows: checked after the restart below.
  step = "opening a session after Unpair";
  const lost = await session(relay.url, initData, paired);

  // ---- a changed page: the PC no longer checks the page, so its hello says "ok" (pages before 26.3.2 grey
  // out otherwise) and an action that changes the PC still runs
  await stopPc(pc);
  const appFile = path.join(pageDir, "page", "frame", "app.js");
  fs.appendFileSync(appFile, "\n// changed\n");
  fs.writeFileSync(logFile, "");
  pc = startPc(pcEnv);
  step = "opening a session on the restarted PC";
  stepAt = Date.now();
  {
    let opened = null;
    for (const end = Date.now() + 10000; !opened && Date.now() < end; ) {
      opened = await session(relay.url, initData, paired).catch(async (e) => {
        if (e.code !== "pc-offline") throw e;
        await sleep(200);
        return null;
      });
    }
    const { link: l, s } = opened;
    check(
      'a changed page: the hello still says page "ok", so older pages do not grey out',
      s.hello.page === "ok",
      JSON.stringify(s.hello),
    );
    const start = await s.ask("nimbalyst.start", {});
    check(
      "a changed page: a write action (nimbalyst.start, dry) still runs",
      start.ok === true && start.d?.state === "starting",
      JSON.stringify(start),
    );
    await s.bye();
    l.close();
  }

  // The restarted PC no longer knows the old session; the relay's pc-online ends it, so the app says hello
  // again instead of timing out on every action.
  {
    const ended = await Promise.race([lost.s.ended, sleep(1000)]);
    const err = await lost.s.ask("pc.status", {}, 2000).then(
      () => null,
      (e) => e,
    );
    check(
      "a session the restarted PC no longer knows must end on its pc-online, and an ask on it must fail at once",
      ended?.code === "pc-online" && err?.code === "pc-online",
      `${err?.code} / ${ended?.code}`,
    );
    lost.link.close();
  }
} catch (e) {
  check(
    `the run finished (failed while ${step})`,
    false,
    `${e.stack}\n${((Date.now() - stepAt) / 1000).toFixed(1)} s into the step\nPC program output (last 1500 characters):\n${pc?.out?.slice(-1500) ?? "(no PC program)"}\npc.log (last 2500 characters):\n${(() => {
      const f = path.join(home, ".phone-app", "pc.log");
      return fs.existsSync(f)
        ? fs.readFileSync(f, "utf8").slice(-2500)
        : "(none)";
    })()}\nrelay log (last 60 lines):\n${relayLog.slice(-60).join("\n") || "(empty)"}\nrelay job queue: ${await (relay
      ? Promise.race([
          relay.idle().then(() => "idle"),
          sleep(500).then(() => "STUCK on a job for 500 ms"),
        ])
      : "(no relay)")}`,
  );
} finally {
  if (pc) await stopPc(pc);
  if (relay) await relay.close();
  fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
