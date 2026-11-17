// Tests for the phone app's PC program core (skills/phone-bot/pc) and the seal library (phone/shared/seal.mjs).
// A small stand-in relay in this file passes frames between a test phone and the real main.mjs, recording every
// frame it sees. Dry mode throughout: no log-on entry, task or Nimbalyst start is made.
// Run: node tests/test-phone-pc.mjs
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes as nodeRandom } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");
const MAIN = path.join(PC, "main.mjs");
const SETUP = path.join(PC, "setup.mjs");
const KEEP = path.join(PC, "keep.mjs");
const VERSION = JSON.parse(
  fs.readFileSync(path.join(ROOT, "version.json"), "utf8"),
).version;
const BOT_ID = 7000001;

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A temp home for this whole run; the files library reads it through os.homedir().
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-pc-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home);
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
});
const seal = await import("../phone/shared/seal.mjs");
// The PC modules in this process run in test mode (the join checks read initData with the test's key); the
// programs the test starts get the mode only where their env says so.
process.env.PHONE_PC_TEST = "1";
const { STOP_CODE } = await import("../skills/phone-bot/pc/keep.mjs");
delete process.env.PHONE_PC_TEST;

// ---- a stand-in relay: WebSocket upgrade and text frames with node:http, routing by role

function wsAccept(key) {
  return createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
}

function wsFrame(op, payload) {
  const len = payload.length;
  const head =
    len < 126
      ? Buffer.from([0x80 | op, len])
      : len < 65536
        ? Buffer.from([0x80 | op, 126, len >> 8, len & 255])
        : Buffer.concat([
            Buffer.from([0x80 | op, 127]),
            (() => {
              const b = Buffer.alloc(8);
              b.writeBigUInt64BE(BigInt(len));
              return b;
            })(),
          ]);
  return Buffer.concat([head, payload]);
}

function wsWrap(sock, onText) {
  let buf = Buffer.alloc(0);
  const peer = {
    send: (text) => sock.write(wsFrame(1, Buffer.from(text))),
    close: (code, reason) => {
      const p = Buffer.alloc(2 + Buffer.byteLength(reason));
      p.writeUInt16BE(code);
      p.write(reason, 2);
      sock.write(wsFrame(8, p));
      sock.end();
    },
  };
  sock.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    for (;;) {
      if (buf.length < 2) return;
      const op = buf[0] & 15;
      let len = buf[1] & 127;
      let at = 2;
      if (len === 126) {
        if (buf.length < 4) return;
        len = buf.readUInt16BE(2);
        at = 4;
      } else if (len === 127) {
        if (buf.length < 10) return;
        len = Number(buf.readBigUInt64BE(2));
        at = 10;
      }
      const masked = buf[1] & 128;
      const mask = masked ? buf.subarray(at, at + 4) : null;
      if (masked) at += 4;
      if (buf.length < at + len) return;
      const payload = Buffer.from(buf.subarray(at, at + len));
      if (mask) for (let i = 0; i < len; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(at + len);
      if (op === 1) onText(payload.toString("utf8"), peer);
      else if (op === 8) sock.end();
    }
  });
  sock.on("error", () => {});
  return peer;
}

const PAGE_FILES = {
  "/": "<!doctype html><title>page</title>",
  "/app.js": "console.log('page');",
  "/version.json": JSON.stringify({ version: VERSION }),
};

function startRelay() {
  const seen = []; // every frame text, both directions
  const firsts = []; // the first frame type of each PC socket
  const phones = new Map(); // dev -> peer
  let pc = null;
  const server = http.createServer((req, res) => {
    const body = PAGE_FILES[req.url];
    if (body === undefined) return res.writeHead(404).end();
    res.writeHead(200).end(body);
  });
  server.on("upgrade", (req, sock) => {
    sock.write(
      "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
        `Sec-WebSocket-Accept: ${wsAccept(req.headers["sec-websocket-key"])}\r\n\r\n`,
    );
    let role = null;
    wsWrap(sock, (text, peer) => {
      seen.push(text);
      if (text === '{"t":"ping"}') return peer.send('{"t":"pong"}');
      const f = JSON.parse(text);
      if (!role) {
        if (f.t === "pc-join" || f.t === "pc-auth") {
          role = "pc";
          pc = peer;
          firsts.push(f.t);
          const ready = JSON.stringify({
            v: 1,
            t: f.t,
            ok: true,
            botId: BOT_ID,
          });
          seen.push(ready);
          peer.send(ready);
        } else if (f.t === "phone") {
          role = "phone";
          phones.set(f.dev, peer);
        }
        return;
      }
      if (role === "phone" && pc) pc.send(text);
      if (role === "pc" && f.dev && phones.has(f.dev))
        phones.get(f.dev).send(text);
    });
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}`,
        seen,
        firsts,
        dropPc: () => pc?.close(4000, "test drop"),
        close: () => server.close(),
      }),
    ),
  );
}

// ---- a test phone: speaks to the stand-in relay with the seal library, as the page will

async function testPhone(relayUrl, dev) {
  const ws = new WebSocket(`${relayUrl.replace("http", "ws")}/ws`);
  const inbox = [];
  const waiting = [];
  ws.onmessage = (ev) => {
    const f = JSON.parse(ev.data);
    const w = waiting.findIndex((x) => x.pred(f));
    if (w >= 0) waiting.splice(w, 1)[0].resolve(f);
    else inbox.push(f);
  };
  await new Promise((r) => (ws.onopen = r));
  ws.send(JSON.stringify({ t: "phone", dev }));
  return {
    send: (f) => ws.send(JSON.stringify(f)),
    next(pred, ms = 5000) {
      const i = inbox.findIndex(pred);
      if (i >= 0) return Promise.resolve(inbox.splice(i, 1)[0]);
      return new Promise((resolve) => {
        const w = { pred, resolve };
        waiting.push(w);
        setTimeout(() => {
          const j = waiting.indexOf(w);
          if (j >= 0) waiting.splice(j, 1) && resolve(null);
        }, ms);
      });
    },
    close: () => ws.close(),
  };
}

// A Telegram stand-in: the test's own Ed25519 key signs initData; the PC gets its public key in test mode.
const tg = await crypto.subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);
const tgPubHex = seal.toHex(
  new Uint8Array(await crypto.subtle.exportKey("raw", tg.publicKey)),
);
process.env.PHONE_PC_TG_KEY = tgPubHex;

async function initDataFor(userId, atMs = Date.now()) {
  const fields = {
    auth_date: String(Math.floor(atMs / 1000)),
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

const newDev = () => seal.toB64u(seal.randomBytes(16));

// kind: the device kind the page sends with the code; left out, the entry has none ("kind not recorded").
async function pairPhone(phone, dev, codeText, userId, kind) {
  const { pcId, secret } = seal.readPairCode(codeText);
  const d = await seal.newX25519();
  const initData = await initDataFor(userId);
  const mac1 = await seal.pairMac1(secret, pcId, d.publicRaw, initData);
  phone.send({
    v: 1,
    t: "pair",
    dev,
    pcId,
    DP: seal.toB64u(d.publicRaw),
    initData,
    mac1: seal.toB64u(mac1),
    ...(kind ? { kind } : {}),
  });
  const r = await phone.next((f) => f.t === "pair-ok" || f.t === "pair-fail");
  if (!r || r.t !== "pair-ok") return { fail: r ? r.reason : "no answer" };
  const PCP = seal.fromB64u(r.PCP);
  const macOk = await seal.checkPairMac2(
    secret,
    seal.fromB64u(r.mac2),
    pcId,
    d.publicRaw,
    PCP,
  );
  const K = await seal.pairKey(
    d.privateKey,
    PCP,
    secret,
    pcId,
    d.publicRaw,
    PCP,
  );
  return { K, macOk };
}

// Says hello with K, then sends sealed requests and opens the answers.
async function openChannel(phone, dev, K) {
  const sid = seal.toB64u(seal.randomBytes(9));
  const np = seal.randomBytes(16);
  const h = { v: 1, t: "app", dev, sid, n: 0 };
  const hello = { k: "hello", np: seal.toB64u(np), pageVersion: VERSION };
  phone.send({
    ...h,
    c: await seal.sealHello(K, h, { ...hello, protocol: 1 }),
  });
  const r = await phone.next((f) => f.t === "app" && f.sid === sid, 2000);
  if (!r) return null;
  const body = await seal.openHello(K, h, r.c);
  const keys = await seal.sessionKeys(K, np, seal.fromB64u(body.npc));
  let n = 0;
  let pcN = 0;
  return {
    hello: body,
    async ask(a, d, id = `r-${n + 1}`) {
      n++;
      const hh = { v: 1, t: "app", dev, sid, n };
      phone.send({
        ...hh,
        c: await seal.sealFrame(keys.p2pc, hh, { k: "req", id, a, d }),
      });
      for (;;) {
        const f = await phone.next((x) => x.t === "app" && x.sid === sid);
        if (!f) return null;
        if (f.n !== pcN + 1) return { k: "gap" };
        pcN = f.n;
        const got = await seal.openFrame(keys.pc2p, f, f.c);
        if (got && got.k === "res" && got.id === id) return got;
      }
    },
  };
}

const run = (file, args, env = {}) => {
  const r = spawnSync(process.execPath, [file, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 30_000,
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const OLD_NAMES = [
  "phone-inbox.vbs",
  "Phone inbox bot",
  "phone-bot.vbs",
  '"Phone bot"',
];

try {
  // ---- the seal library on its own
  {
    const token = seal.randomBytes(32);
    const pcId = await seal.pcIdFromToken(token);
    const code = seal.makePairCode(pcId, seal.randomBytes(16));
    const back = seal.readPairCode(seal.groupCode(code));
    check(
      "seal: pcId is 26 base32 characters and the grouped code reads back",
      /^[A-Z2-7]{26}$/.test(pcId) && back.pcId === pcId,
      code,
    );
    const inbox = await seal.newX25519();
    const box = await seal.sealBox(inbox.publicRaw, seal.utf8("held forward"));
    const opened = await seal.openBox(inbox.privateKey, inbox.publicRaw, box);
    const other = await seal.newX25519();
    check(
      "seal: a sealed box opens with its key only",
      opened &&
        seal.fromUtf8(opened) === "held forward" &&
        (await seal.openBox(other.privateKey, other.publicRaw, box)) === null,
    );
    const K = seal.randomBytes(32);
    const k = await seal.sessionKeys(
      K,
      seal.randomBytes(16),
      seal.randomBytes(16),
    );
    const h = { v: 1, t: "app", dev: "d", sid: "s", n: 4 };
    const c = await seal.sealFrame(k.p2pc, h, { k: "req", a: "x" });
    check(
      "seal: a frame opens under its header and not under a changed counter",
      (await seal.openFrame(k.p2pc, h, c))?.a === "x" &&
        (await seal.openFrame(k.p2pc, { ...h, n: 5 }, c)) === null &&
        seal.fromB64u(c).length % 256 === 16,
    );
  }

  // ---- the channel takes one frame of a device at a time
  {
    const { createChannel } = await import(
      "../skills/phone-bot/pc/core/channel.mjs"
    );
    const K = seal.randomBytes(32);
    const dev = newDev();
    const sent = [];
    let runs = 0;
    const channel = createChannel({
      keys: { devices: [{ device: dev, K: seal.toB64u(K) }] },
      send: (f) => sent.push(f),
      registry: {
        async handle(b) {
          runs++;
          await sleep(20);
          return { k: "res", id: b.id, ok: true, d: runs };
        },
      },
      context: () => ({ page: "ok", setupVersion: VERSION }),
      pcVersion: VERSION,
      onHello: () => {},
    });
    // Says hello straight to the channel; resolves with a sealer for requests and an opener for answers.
    const start = async () => {
      const sid = seal.toB64u(seal.randomBytes(9));
      const np = seal.randomBytes(16);
      const h = { v: 1, t: "app", dev, sid, n: 0 };
      await channel.onApp({
        ...h,
        c: await seal.sealHello(K, h, {
          k: "hello",
          np: seal.toB64u(np),
          pageVersion: VERSION,
          protocol: 1,
        }),
      });
      const back = await seal.openHello(K, h, sent.pop().c);
      const k = await seal.sessionKeys(K, np, seal.fromB64u(back.npc));
      return {
        frame: async (n, id) => {
          const hh = { ...h, n };
          const c = await seal.sealFrame(k.p2pc, hh, { k: "req", id, a: "x" });
          return { ...hh, c };
        },
        sealed: async (n, body) => {
          const hh = { ...h, n };
          return { ...hh, c: await seal.sealFrame(k.p2pc, hh, body) };
        },
        answers: () =>
          Promise.all(
            sent.splice(0).map((f) => seal.openFrame(k.pc2p, f, f.c)),
          ),
      };
    };
    let ch = await start();
    const twice = await ch.frame(1, "r-1");
    await Promise.all([channel.onApp(twice), channel.onApp({ ...twice })]);
    check("channel: one frame sent twice back to back runs once", runs === 1);
    sent.length = 0;
    runs = 0;
    ch = await start();
    const [a, b] = [await ch.frame(1, "r-1"), await ch.frame(2, "r-2")];
    await Promise.all([channel.onApp(a), channel.onApp(b)]);
    const got = (await ch.answers()).map((x) => x?.id).sort();
    check(
      "channel: two frames sent back to back are both answered",
      runs === 2 && got.join() === "r-1,r-2",
      JSON.stringify(got),
    );

    // Whole streams no action took count toward the bytes one channel session holds: two of 25 MB, then one byte.
    const { PIECE_BYTES } = await import(
      "../skills/phone-bot/pc/core/channel.mjs"
    );
    sent.length = 0;
    ch = await start();
    let n = 0;
    const stream = async (id, all) => {
      const of = Math.ceil(all.length / PIECE_BYTES);
      const sha256 = createHash("sha256").update(all).digest("hex");
      for (let i = 0; i < of; i++) {
        const d = all
          .subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES)
          .toString("base64url");
        const body = { k: "chunk", stream: id, i, of, total: all.length };
        await channel.onApp(
          await ch.sealed(++n, { ...body, sha256, mime: "audio/mp4", d }),
        );
      }
    };
    const big = Buffer.alloc(25 * 1024 * 1024, 7);
    await stream("held-a", big);
    await stream("held-b", big);
    await stream("held-c", Buffer.from([1]));
    const held = await ch.answers();
    const of = (id) => held.find((x) => x?.id === id);
    check(
      "channel: a stream that would take the held bytes over 50 MB is refused, whole ones counted",
      of("held-a")?.ok === true &&
        of("held-b")?.ok === true &&
        of("held-c")?.err === "stream-broken" &&
        /50 MB/.test(of("held-c")?.why),
      JSON.stringify(held.map((x) => [x?.id, x?.ok, x?.why])),
    );
  }

  // ---- the local pairing page: the code as a QR the phone scans, as text, and Copy
  {
    const { servePairPage } = await import(
      "../skills/phone-bot/pc/core/pairing.mjs"
    );
    const pcId = await seal.pcIdFromToken(seal.randomBytes(32));
    const text = seal.makePairCode(pcId, seal.randomBytes(16));
    const page = await servePairPage(text);
    const res = await fetch(page.url);
    const html = await res.text();
    page.close();
    // A 53-character code in alphanumeric mode at level M is a version 3 code: 29 modules and 4 light round it.
    const svg = /<svg [^>]*viewBox="0 0 37 37"[^>]*>.*?<\/svg>/s.exec(
      html,
    )?.[0];
    check(
      "the pairing page shows the code as an inline SVG QR of the right size",
      Boolean(svg) &&
        /<path d="(M\d+ \d+h1v1h-1z)+"/.test(svg) &&
        !/(src|href)=/.test(svg),
      html.slice(0, 400),
    );
    check(
      "the pairing page keeps the code text, Copy, and a policy that loads nothing",
      html.includes(seal.groupCode(text)) &&
        html.includes(`navigator.clipboard.writeText('${text}')`) &&
        res.headers
          .get("content-security-policy")
          .startsWith("default-src 'none';"),
    );
  }

  // ---- the file rules
  {
    const files = await import("../skills/phone-bot/pc/core/files.mjs");
    const refused = (p) => {
      try {
        files.checkPath(p);
        return false;
      } catch (e) {
        return e.code === "file-refused";
      }
    };
    const app = path.join(home, ".phone-app");
    const projects = path.join(home, ".claude", "projects");
    const transcript = path.join(projects, "C--x", `${"a".repeat(36)}.jsonl`);
    fs.mkdirSync(path.dirname(transcript), { recursive: true });
    fs.writeFileSync(transcript, "{}\n");
    const elsewhere = path.join(home, "elsewhere");
    fs.mkdirSync(elsewhere);
    fs.writeFileSync(path.join(elsewhere, "a.jsonl"), "{}\n");
    fs.symlinkSync(elsewhere, path.join(projects, "link"), "junction");
    for (const [name, p] of [
      [".env", path.join(app, ".env")],
      [".env.local", path.join(app, ".env.local")],
      [".git/config", path.join(projects, "C--x", ".git", "config")],
      ["id_ed25519", path.join(app, "id_ed25519")],
      ["x.pem", path.join(app, "x.pem")],
      ["owner-secrets.json", path.join(app, "owner-secrets.json")],
      ["a path outside the places", path.join(home, "Documents", "notes.txt")],
      [
        "a link inside a place that points outside",
        path.join(projects, "link", "a.jsonl"),
      ],
      ["the key file outside keys.mjs", path.join(app, "pc-keys.json")],
    ])
      check(`file rules refuse ${name}`, refused(p));
    check("file rules allow a transcript", !refused(transcript));
  }

  // ---- the action registry
  {
    const { createRegistry } = await import(
      "../skills/phone-bot/pc/core/registry.mjs"
    );
    const dir = path.join(tmp, "actions-two");
    fs.mkdirSync(dir);
    const mod = `export function register(r) { r.add({ name: "x.do", run: () => 1 }); }\n`;
    fs.writeFileSync(path.join(dir, "a.mjs"), mod);
    fs.writeFileSync(path.join(dir, "b.mjs"), mod);
    let msg = "";
    await createRegistry()
      .load(dir)
      .catch((e) => (msg = e.message));
    check(
      "two modules naming one action stop the start, naming both files",
      msg === 'action "x.do" is registered by both a.mjs and b.mjs',
      msg,
    );
    const dir2 = path.join(tmp, "actions-none");
    fs.mkdirSync(dir2);
    fs.writeFileSync(path.join(dir2, "c.mjs"), "export const x = 1;\n");
    msg = "";
    await createRegistry()
      .load(dir2)
      .catch((e) => (msg = e.message));
    check(
      "a module without register stops the start",
      msg.includes("c.mjs"),
      msg,
    );

    const r = createRegistry();
    r.add({
      name: "a.write",
      input: { text: { type: "string", min: 1, max: 5 } },
      run: (d) => d.text,
    });
    const ok = { page: "ok" };
    const a3 = await r.handle(
      { k: "req", id: "3", a: "a.write", d: { text: "toolong" } },
      ok,
    );
    const a4 = await r.handle(
      { k: "req", id: "4", a: "a.write", d: { text: "hi" } },
      ok,
    );
    check(
      "a wrong field answers bad-input naming it",
      a3.err === "bad-input" && a3.field === "text",
    );
    check("a good request runs", a4.ok && a4.d === "hi");
  }

  // ---- a further device joins by an OK (pipe design, section 15: checks 6 to 13 and 15 to 19), in process with a
  // fake clock: the real join, channel and registry, and test devices that seal with seal.mjs as the page will
  {
    const { createJoin, createPairing } = await import(
      "../skills/phone-bot/pc/core/pairing.mjs"
    );
    const { createChannel } = await import(
      "../skills/phone-bot/pc/core/channel.mjs"
    );
    const { createRegistry } = await import(
      "../skills/phone-bot/pc/core/registry.mjs"
    );
    const ME = 111;
    let clock = Date.now();
    const id = await seal.newX25519(true);
    const identity = {
      priv: await seal.exportPrivate(id.privateKey),
      pub: seal.toB64u(id.publicRaw),
    };
    const PCP = id.publicRaw;
    const pcId = await seal.pcIdFromToken(seal.randomBytes(32));
    const takeOut = (w, pred) => {
      const got = [];
      for (let i = w.out.length - 1; i >= 0; i--)
        if (pred(w.out[i])) got.unshift(...w.out.splice(i, 1));
      return got;
    };
    const entryOf = (kind, at = clock) => ({
      device: newDev(),
      K: seal.toB64u(seal.randomBytes(32)),
      kind,
      pairedAt: new Date(at).toISOString(),
      via: "code",
      confirmed: true,
    });
    function world(devices) {
      const w = { out: [], saves: 0 };
      w.keys = {
        pcId,
        identity,
        botId: BOT_ID,
        ownerTgId: devices.length ? ME : null,
        devices,
      };
      const registry = createRegistry();
      w.registry = registry;
      w.channel = createChannel({
        keys: w.keys,
        send: (f) => w.out.push(f),
        registry,
        context: () => ({ page: "ok", setupVersion: VERSION }),
        pcVersion: VERSION,
        onHello: (dev) => w.join.onHello(dev),
      });
      w.join = createJoin({
        keys: w.keys,
        saveKeys: () => w.saves++,
        send: (f) => w.out.push(f),
        channel: w.channel,
        now: () => clock,
      });
      w.join.register(registry);
      return w;
    }
    // A paired device with an open channel session: ask(a, d) answers; events(e) gives the sealed events it got.
    async function device(w, dev, Kb64) {
      const K = seal.fromB64u(Kb64);
      const sid = seal.toB64u(seal.randomBytes(9));
      const np = seal.randomBytes(16);
      const h = { v: 1, t: "app", dev, sid, n: 0 };
      await w.channel.onApp({
        ...h,
        c: await seal.sealHello(K, h, {
          k: "hello",
          np: seal.toB64u(np),
          pageVersion: VERSION,
          protocol: 1,
        }),
      });
      const back = takeOut(w, (f) => f.t === "app" && f.sid === sid);
      if (!back.length) return null;
      const hb = await seal.openHello(K, h, back[0].c);
      const k = await seal.sessionKeys(K, np, seal.fromB64u(hb.npc));
      const got = [];
      let n = 0;
      const pull = async () => {
        await sleep(15);
        for (const f of takeOut(w, (x) => x.t === "app" && x.sid === sid))
          got.push(await seal.openFrame(k.pc2p, f, f.c));
      };
      return {
        async ask(a, d) {
          n++;
          const hh = { ...h, n };
          await w.channel.onApp({
            ...hh,
            c: await seal.sealFrame(k.p2pc, hh, {
              k: "req",
              id: `r${n}`,
              a,
              d,
            }),
          });
          await pull();
          return got.find((b) => b?.k === "res" && b.id === `r${n}`) ?? null;
        },
        // The next request's frame, not sent.
        async frame(a, d) {
          n++;
          const hh = { ...h, n };
          return {
            ...hh,
            c: await seal.sealFrame(k.p2pc, hh, {
              k: "req",
              id: `r${n}`,
              a,
              d,
            }),
          };
        },
        async events(e) {
          await pull();
          return got.filter((b) => b?.k === "evt" && b.e === e);
        },
      };
    }
    // A new device N: its own key pair and nonce, as the page will make them.
    async function newcomer(
      w,
      { tgId = ME, dev = newDev(), kind = "desktop" } = {},
    ) {
      const dN = await seal.newX25519();
      const Nn = seal.randomBytes(16);
      const commit = await seal.joinCommit(dev, dN.publicRaw, Nn);
      const mine = (f) => f.dev === dev && /^join-/.test(f.t);
      return {
        dev,
        dN,
        Nn,
        async ask() {
          await w.join.onAsk({
            v: 1,
            t: "join-ask",
            dev,
            DN: seal.toB64u(dN.publicRaw),
            kind,
            commit: seal.toB64u(commit),
            initData: await initDataFor(tgId, clock),
          });
          return takeOut(w, mine).at(-1) ?? null;
        },
        async reveal(nonce = Nn) {
          await w.join.onReveal({
            v: 1,
            t: "join-reveal",
            dev,
            Nn: seal.toB64u(nonce),
          });
          return takeOut(w, mine).at(-1) ?? null;
        },
        async cancel() {
          await w.join.onCancel({ v: 1, t: "join-cancel", dev });
          return takeOut(w, mine).at(-1) ?? null;
        },
      };
    }
    const reason = (f) => (f?.t === "join-fail" ? f.reason : f?.t);

    // Checks 6, 7 and 16.
    {
      const empty = world([]);
      check(
        "join: with no devices a join-ask gets no-device",
        reason(await (await newcomer(empty)).ask()) === "no-device",
      );
      const four = world([1, 2, 3, 4].map(() => entryOf("iphone")));
      check(
        "join: with 4 devices a join-ask gets too-many-devices",
        reason(await (await newcomer(four)).ask()) === "too-many-devices",
      );
      const w = world([entryOf("iphone")]);
      check(
        "join: a join-ask from another Telegram id gets other-user",
        reason(await (await newcomer(w, { tgId: 222 })).ask()) === "other-user",
      );
      const n1 = await newcomer(w);
      const wait = await n1.ask();
      check(
        "join: while one request is open another join-ask gets busy",
        wait?.t === "join-wait" &&
          reason(await (await newcomer(w)).ask()) === "busy",
        JSON.stringify(wait),
      );
      const devicesBefore = JSON.stringify(w.keys.devices);
      const saves = w.saves;
      check(
        "join: a join-reveal that does not match the commit ends the request with bad-reveal; nothing is written",
        reason(await n1.reveal(seal.randomBytes(16))) === "bad-reveal" &&
          w.saves === saves &&
          JSON.stringify(w.keys.devices) === devicesBefore,
      );
      check(
        "join: a join-ask naming a paired device's id gets dev-taken; the key file is unchanged",
        reason(
          await (await newcomer(w, { dev: w.keys.devices[0].device })).ask(),
        ) === "dev-taken" && w.saves === saves,
      );
    }

    // Checks 8, 9, 10, 11 (a second answer, an unknown rid) and 18: a full join by OK.
    {
      const A = entryOf("iphone");
      const B = entryOf("android");
      const w = world([A, B]);
      const a = await device(w, A.device, A.K);
      const N = await newcomer(w, { kind: "desktop" });
      const wait = await N.ask();
      check(
        "join: join-wait names the PC, its key, its nonce and one open device",
        wait?.pcId === pcId && wait.PCP === identity.pub && wait.open === 1,
        JSON.stringify(wait),
      );
      const Npc = seal.fromB64u(wait.Npc);
      await N.reveal();
      const [card] = await a.events("device.ask");
      const word = await seal.joinWord(
        pcId,
        N.dev,
        N.dN.publicRaw,
        PCP,
        N.Nn,
        Npc,
      );
      check(
        "join: the open device gets the card with the same six-digit number N computes",
        card?.d.word === word &&
          /^\d{6}$/.test(word) &&
          card.d.kind === "desktop",
        JSON.stringify(card),
      );
      const other = await seal.newX25519();
      check(
        "join: a swapped DN or PCP gives another check number for the same nonces",
        (await seal.joinWord(pcId, N.dev, other.publicRaw, PCP, N.Nn, Npc)) !==
          word &&
          (await seal.joinWord(
            pcId,
            N.dev,
            N.dN.publicRaw,
            other.publicRaw,
            N.Nn,
            Npc,
          )) !== word,
      );
      const b = await device(w, B.device, B.K);
      check(
        "join: a device whose hello comes later gets the open card too",
        (await b.events("device.ask")).length === 1,
      );
      const res = await a.ask("device.answer", { rid: card.d.rid, ok: true });
      const okFrame = takeOut(w, (f) => f.t === "join-ok")[0];
      const joined = takeOut(w, (f) => f.t === "joined")[0];
      const entry = w.keys.devices.find((d) => d.device === N.dev);
      check(
        "join: OK writes { device, K, kind, pairedAt, via: ok, okBy, confirmed: false } (kind kept on the OK path)",
        res?.ok &&
          entry &&
          Object.keys(entry).join() ===
            "device,K,kind,pairedAt,via,okBy,confirmed" &&
          entry.kind === "desktop" &&
          entry.via === "ok" &&
          entry.okBy === A.device &&
          entry.confirmed === false,
        JSON.stringify([res, entry]),
      );
      const box = seal.fromB64u(okFrame.box);
      const opened = await seal.openBox(N.dN.privateKey, N.dN.publicRaw, box);
      const J = await seal.joinKey(
        N.dN.privateKey,
        PCP,
        N.Nn,
        Npc,
        pcId,
        N.dev,
        N.dN.publicRaw,
        PCP,
      );
      check(
        "join: N opens the box to the written K and mac3 checks with J",
        box.length === 92 &&
          opened &&
          seal.toB64u(opened) === entry.K &&
          (await seal.checkJoinMac(J, seal.fromB64u(okFrame.mac3), N.dev, box)),
      );
      const fake = await seal.sealBox(N.dN.publicRaw, seal.randomBytes(32));
      check(
        "join: a box sealed to DN by someone else fails mac3 on N's side",
        !(await seal.checkJoinMac(J, seal.fromB64u(okFrame.mac3), N.dev, fake)),
      );
      check(
        "join: the PC sends joined with the Telegram id and kind; the cards hear ok",
        joined?.tgId === ME &&
          joined.kind === "desktop" &&
          (await a.events("device.asked")).some((x) => x.d.answer === "ok"),
        JSON.stringify(joined),
      );
      const n = await device(w, N.dev, entry.K);
      check(
        "join: the first hello under the new K sets confirmed: true",
        n && entry.confirmed === true,
      );
      const aj = await a.events("device.joined");
      const bj = await b.events("device.joined");
      check(
        "join: every other device gets device.joined now; the joined device gets none",
        aj.length === 1 &&
          aj[0].d.dev === N.dev &&
          aj[0].d.via === "ok" &&
          bj.length === 1 &&
          (await n.events("device.joined")).length === 0,
      );
      // The page's own channel code (frame/channel.js) says hello as A: the relay hands it the PC's answer and the
      // device.joined right behind it together, before the page has made its session keys.
      {
        const page = await import("../phone/page/frame/channel.js");
        const listeners = new Set();
        let sid = null;
        const flush = () => {
          for (const f of takeOut(w, (x) => x.t === "app" && x.sid === sid))
            setImmediate(() => {
              for (const fn of [...listeners]) fn(f);
            });
        };
        const link = {
          send(f) {
            sid ??= f.sid;
            w.channel.onApp(f).then(() => setTimeout(flush, 20));
          },
          listen(fn) {
            listeners.add(fn);
            return () => listeners.delete(fn);
          },
          next(match, ms) {
            return new Promise((resolve, reject) => {
              const timer = setTimeout(() => {
                off();
                reject(new Error("no answer"));
              }, ms);
              const off = link.listen((f) => {
                if (!match(f)) return;
                clearTimeout(timer);
                off();
                resolve(f);
              });
            });
          },
          onClose: () => () => {},
          buffered: 0,
        };
        const events = [];
        const s = await page.openSession(link, {
          K: seal.fromB64u(A.K),
          dev: A.device,
          pageVersion: VERSION,
          onEvent: (b) => events.push(b.e),
        });
        const r = await s.ask("no.such.action", {}, 2000).catch((e) => e);
        check(
          "join: the page's session takes the device.joined that comes right behind the hello, then its first answer",
          events.includes("device.joined") && r?.k === "res",
          `events ${JSON.stringify(events)}, answer ${r?.code ?? JSON.stringify(r)}`,
        );
      }
      const a2 = await device(w, A.device, A.K);
      check(
        "join: device.joined again at the next hello",
        (await a2.events("device.joined")).length === 1,
      );
      const seen = await a2.ask("device.seen", { dev: N.dev });
      const a3 = await device(w, A.device, A.K);
      check(
        "join: after device.seen it gets none",
        seen?.ok && (await a3.events("device.joined")).length === 0,
        JSON.stringify(seen),
      );
      const savesBefore = w.saves;
      const again = await b.ask("device.answer", { rid: card.d.rid, ok: true });
      const unknown = await b.ask("device.answer", { rid: newDev(), ok: true });
      check(
        "join: a second answer gets answered, an unknown rid is refused; nothing is written",
        again?.err === "answered" &&
          unknown?.ok === false &&
          w.saves === savesBefore,
        JSON.stringify([again, unknown]),
      );
    }

    // Checks 19, 11 (No, expiry), 12 and 15.
    {
      const A = entryOf("iphone", clock - 2000);
      const w = world([A]);
      const a = await device(w, A.device, A.K);
      const P = await newcomer(w);
      await P.ask();
      await P.reveal();
      const [card] = await a.events("device.ask");
      const no = await a.ask("device.answer", { rid: card.d.rid, ok: false });
      const refusedFrame = takeOut(w, (f) => f.dev === P.dev).at(-1);
      check(
        "join: No sends refused to N, writes nothing, and the same dev asking again is refused",
        no?.ok &&
          reason(refusedFrame) === "refused" &&
          w.keys.devices.length === 1 &&
          reason(await P.ask()) === "refused",
        JSON.stringify([no, refusedFrame]),
      );
      const E = await newcomer(w);
      await E.ask();
      await E.reveal();
      const cardE = (await a.events("device.ask")).at(-1);
      clock += 3 * 60_000 + 1000;
      await w.join.tick();
      const late = await a.ask("device.answer", { rid: cardE.d.rid, ok: true });
      check(
        "join: past 3 minutes the request is dropped: expired to N and the cards; a late OK writes nothing",
        reason(takeOut(w, (f) => f.dev === E.dev).at(-1)) === "expired" &&
          (await a.events("device.asked")).some(
            (x) => x.d.answer === "expired",
          ) &&
          late?.ok === false &&
          w.keys.devices.length === 1,
        JSON.stringify(late),
      );
      // An entry no hello confirmed goes after 10 minutes; its later hello gets unknown-device.
      const U = await newcomer(w);
      await U.ask();
      await U.reveal();
      const cardU = (await a.events("device.ask")).at(-1);
      await a.ask("device.answer", { rid: cardU.d.rid, ok: true });
      const uEntry = w.keys.devices.find((d) => d.device === U.dev);
      clock += 9 * 60_000;
      await w.join.tick();
      const kept = w.keys.devices.some((d) => d.device === U.dev);
      clock += 61_000;
      await w.join.tick();
      const u = await device(w, U.dev, uEntry.K);
      const fail = takeOut(w, (f) => f.t === "app-fail");
      check(
        "join: an unconfirmed entry is kept 9 minutes and gone after 10; its hello gets unknown-device",
        kept &&
          !w.keys.devices.some((d) => d.device === U.dev) &&
          u === null &&
          fail.length === 1 &&
          fail[0].dev === U.dev &&
          fail[0].reason === "unknown-device",
        JSON.stringify(fail),
      );
      // A new hour: every join-ask counts.
      clock += 60 * 60_000;
      const R = await newcomer(w);
      const w1 = await R.ask(); // 1
      const restart = await R.ask(); // 2: the same dev after join-wait
      await R.reveal();
      const cardR = (await a.events("device.ask")).at(-1);
      const wordR = await seal.joinWord(
        pcId,
        R.dev,
        R.dN.publicRaw,
        PCP,
        R.Nn,
        seal.fromB64u(w1.Npc),
      );
      const busy = await (await newcomer(w)).ask(); // 3
      await R.cancel();
      const cancelled = (await a.events("device.asked")).some(
        (x) => x.d.answer === "cancelled",
      );
      const after = await R.ask(); // 4: after join-cancel
      await R.cancel();
      const fifth = await (await newcomer(w)).ask(); // 5
      await w.join.onCancel({ v: 1, t: "join-cancel", dev: fifth?.dev });
      const sixth = await (await newcomer(w)).ask(); // 6
      check(
        "join: a restart, a busy one and one after join-cancel all count; the sixth gets too-many-asks",
        reason(restart) === "busy" &&
          reason(busy) === "busy" &&
          cancelled &&
          after?.t === "join-wait" &&
          fifth?.t === "join-wait" &&
          reason(sixth) === "too-many-asks",
        JSON.stringify([restart, busy, after, fifth, sixth].map(reason)),
      );
      check(
        "join: the same dev asking after join-wait leaves the request's nonces unchanged",
        cardR?.d.word === wordR,
      );
    }

    // Check 17: a device may remove itself and later devices only.
    {
      const D1 = entryOf("iphone", clock - 3000);
      const D2 = entryOf("desktop", clock - 2000);
      const D3 = entryOf("web", clock - 1000);
      const w = world([D1, D2, D3]);
      let err = null;
      try {
        w.join.remove(D2.device, D1.device);
      } catch (e) {
        err = e.err;
      }
      const later = w.join.remove(D2.device, D3.device);
      const self = w.join.remove(D2.device, D2.device);
      check(
        "remove: the second-paired device removes a later one and itself, and gets not-allowed for the first",
        err === "not-allowed" &&
          later.removed === D3.device &&
          self.removed === D2.device &&
          w.keys.devices.map((d) => d.device).join() === D1.device,
        String(err),
      );
    }

    // Check 13: the PC's code path keeps the kind, via: code, confirmed: true; joined only from the second device.
    {
      const w = world([]);
      const pairing = createPairing({
        keys: w.keys,
        saveKeys: () => w.saves++,
        send: (f) => w.out.push(f),
        onAdded: (entry, tgId) => w.join.added(entry, tgId),
      });
      const byCode = async (kind) => {
        const { code } = await pairing.start();
        const { pcId: p, secret } = seal.readPairCode(code);
        const d = await seal.newX25519();
        const initData = await initDataFor(ME);
        const dev = newDev();
        await pairing.onPair({
          v: 1,
          t: "pair",
          dev,
          pcId: p,
          DP: seal.toB64u(d.publicRaw),
          initData,
          mac1: seal.toB64u(
            await seal.pairMac1(secret, p, d.publicRaw, initData),
          ),
          ...(kind === undefined ? {} : { kind }),
        });
        return { dev, out: takeOut(w, () => true) };
      };
      const first = await byCode("iphone");
      const e1 = w.keys.devices[0];
      check(
        "code: the first device pairs with its kind, via: code, confirmed: true, and sends no joined",
        e1?.kind === "iphone" &&
          e1.via === "code" &&
          e1.confirmed === true &&
          first.out.some((f) => f.t === "pair-ok") &&
          !first.out.some((f) => f.t === "joined"),
        JSON.stringify(first.out.map((f) => f.t)),
      );
      const second = await byCode("desktop");
      const e2 = w.keys.devices.find((d) => d.device === second.dev);
      check(
        "code: a second device pairs with its kind and sends joined; the first gets it in unseen",
        e2?.kind === "desktop" &&
          e2.via === "code" &&
          e2.confirmed === true &&
          second.out.some(
            (f) => f.t === "joined" && f.kind === "desktop" && f.tgId === ME,
          ) &&
          e1.unseen?.includes(second.dev),
        JSON.stringify(second.out.map((f) => f.t)),
      );
      const bad = await byCode("toaster");
      check(
        "code: a kind off the list is refused with bad-kind",
        bad.out.some((f) => f.t === "pair-fail" && f.reason === "bad-kind") &&
          !w.keys.devices.some((d) => d.device === bad.dev),
        JSON.stringify(bad.out.map((f) => [f.t, f.reason])),
      );
      const none = await byCode(undefined);
      const e3 = w.keys.devices.find((d) => d.device === none.dev);
      check(
        "code: a pair with no kind (a page from before DV4) pairs and writes no kind",
        e3 && !("kind" in e3) && none.out.some((f) => f.t === "pair-ok"),
        JSON.stringify(none.out.map((f) => [f.t, f.reason])),
      );
    }

    // A removal stops work already started: a request whose frame was being opened when its device was removed
    // does not run, and a hello waiting in the removed device's line starts no channel session.
    {
      const b = entryOf("iphone");
      const w = world([b]);
      let marks = 0;
      w.registry.add({
        name: "test.mark",
        run() {
          marks++;
          return { marked: true };
        },
      });
      const chB = await device(w, b.device, b.K);
      const req = await chB.frame("test.mark", {});
      const running = w.channel.onApp(req);
      for (let i = 0; i < 5; i++) await null; // the frame is in its turn, its open not done
      w.join.remove(b.device, b.device);
      await running;
      check(
        "removal: a request whose frame was opening when its device was removed does not run",
        marks === 0,
        `ran ${marks} times`,
      );
      const c = entryOf("desktop");
      const w2 = world([c]);
      const h = { v: 1, t: "app", dev: c.device, sid: "late-hello", n: 0 };
      const hello = {
        ...h,
        c: await seal.sealHello(seal.fromB64u(c.K), h, {
          k: "hello",
          np: seal.toB64u(seal.randomBytes(16)),
          pageVersion: VERSION,
          protocol: 1,
        }),
      };
      const late = w2.channel.onApp(hello);
      w2.join.remove(c.device, c.device);
      await late;
      check(
        "removal: a hello waiting in the line of a device removed meanwhile starts no channel session",
        !w2.channel.openDevices().includes(c.device),
        JSON.stringify(w2.channel.openDevices()),
      );
    }
  }

  // ---- no shell, no npm package
  {
    const allowed = new Set([
      "setup.mjs",
      "keep.mjs",
      path.join("actions", "pc.mjs"),
      path.join("actions", "voice.mjs"),
    ]);
    const bad = [];
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const p = path.join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith(".mjs")) {
          const rel = path.relative(PC, p);
          const text = fs.readFileSync(p, "utf8");
          if (
            !allowed.has(rel) &&
            /exec\(|execSync\(|shell: true|child_process/.test(text)
          )
            bad.push(`${rel}: runs a program`);
          if (/shell: true|exec\(|execSync\(/.test(text))
            bad.push(`${rel}: shell`);
          for (const m of text.matchAll(/(?:from|import)\s*\(?\s*"([^"]+)"/g))
            if (!m[1].startsWith("node:") && !m[1].startsWith("."))
              bad.push(`${rel}: imports ${m[1]}`);
        }
      }
    };
    walk(PC);
    walk(path.join(ROOT, "phone", "shared"));
    check(
      "no shell and no npm import in pc/ and phone/shared/",
      bad.length === 0,
      bad.join("; "),
    );
  }

  // ---- setup in dry mode: the log-on entry under the new names
  const dryEnv = {
    PHONE_PC_DRY: "1",
    PHONE_PC_TEST: "1",
    PHONE_PC_PLATFORM: "win32",
  };
  {
    const r = run(SETUP, ["start-logon"], dryEnv);
    const vbs = path.join(
      process.env.APPDATA,
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
      "phone-app-pc.vbs",
    );
    console.log(r.out.trim().replace(/^/gm, "     | "));
    check(
      "dry start-logon builds the Startup script phone-app-pc.vbs, which starts keep.mjs, and makes no task",
      r.code === 0 &&
        r.out.includes(`would write ${vbs}`) &&
        r.out.includes(KEEP) &&
        !r.out.includes("schtasks") &&
        !r.out.includes("would run:"),
      r.out,
    );
    check(
      "dry start-logon names none of the old bot's entries",
      !OLD_NAMES.some((n) => r.out.includes(n)),
    );
    check("dry start-logon writes no Startup script", !fs.existsSync(vbs));
    const st = run(SETUP, ["start"], dryEnv);
    check(
      "dry start runs the Startup script phone-app-pc.vbs through wscript and nothing else",
      st.code === 0 &&
        st.out.includes("would run: wscript") &&
        st.out.includes("phone-app-pc.vbs") &&
        st.out.trim().split("\n").length === 1,
      st.out,
    );
    const rm = run(SETUP, ["remove"], dryEnv);
    const oldBot = path.join(PC, "..", "bot", "inbox-bot.mjs");
    check(
      "dry remove deletes the old task where it is, stops keep.mjs and the program, and the retired bot's tasks and process",
      rm.code === 0 &&
        rm.out.includes('schtasks /delete /tn "Phone app PC" /f') &&
        rm.out.includes('schtasks /delete /tn "Phone bot" /f') &&
        rm.out.includes('schtasks /delete /tn "Phone inbox bot" /f') &&
        rm.out.includes(oldBot) &&
        !rm.out.includes("/create") &&
        rm.out.includes("would run: powershell") &&
        rm.out.includes(KEEP) &&
        rm.out.includes(MAIN),
      rm.out,
    );
    check(
      "with none of the old bot's files there, dry remove names no file of it",
      !/phone-bot\.vbs|phone-inbox\.vbs|skills[\\/]phone[\\/]|\.telegram-control/.test(
        rm.out,
      ),
      rm.out,
    );
    // The old bot's files in a second made-up home: dry join and dry remove name them and delete nothing
    const oldHome = path.join(tmp, "old-bot-home");
    const oldStartup = path.join(
      oldHome,
      "AppData",
      "Roaming",
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      "Startup",
    );
    const oldSkill = path.join(oldHome, ".claude", "skills", "phone");
    fs.mkdirSync(oldStartup, { recursive: true });
    fs.mkdirSync(oldSkill, { recursive: true });
    fs.mkdirSync(path.join(oldHome, ".telegram-control"));
    const oldFiles = [
      path.join(oldStartup, "phone-bot.vbs"),
      path.join(oldStartup, "phone-inbox.vbs"),
      path.join(oldSkill, "SKILL.md"),
    ];
    for (const f of oldFiles) fs.writeFileSync(f, "x");
    fs.writeFileSync(
      oldFiles[2],
      "<!-- phone-bot: installed by /phone-bot -->\n# Phone\n",
    );
    const oldEnv = {
      ...dryEnv,
      HOME: oldHome,
      USERPROFILE: oldHome,
      APPDATA: path.join(oldHome, "AppData", "Roaming"),
    };
    for (const [name, args] of [
      ["remove", ["remove"]],
      ["join", ["join", "https://relay.example.test"]],
    ]) {
      const o = run(SETUP, args, oldEnv);
      check(
        `dry ${name} would delete the old bot's two Startup scripts and its marked /phone skill, and names its secrets folder as kept`,
        o.code === 0 &&
          oldFiles.every((f) => o.out.includes(`would delete ${f}`)) &&
          o.out.includes(
            `secrets are kept in ${path.join(oldHome, ".telegram-control")}`,
          ) &&
          oldFiles.every((f) => fs.existsSync(f)),
        o.out,
      );
    }
    fs.writeFileSync(oldFiles[2], "# My own phone skill\n");
    const own = run(SETUP, ["remove"], oldEnv);
    check(
      "a /phone skill without the old bot's marker is left alone",
      own.code === 0 && !own.out.includes(oldFiles[2]),
      own.out,
    );
    // start, not dry, with no Startup script: refuses before it runs anything
    const noStart = run(SETUP, ["start"], {
      PHONE_PC_TEST: "1",
      PHONE_PC_PLATFORM: "win32",
      APPDATA: path.join(tmp, "no-startup"),
    });
    check(
      "start without a Startup script fails and says to run start-logon first",
      noStart.code === 1 &&
        noStart.out.includes("There is no start at log-on yet") &&
        !noStart.out.includes("wscript"),
      noStart.out,
    );
  }

  // ---- keep.mjs with a stand-in child that writes one line per run and ends with the code it is given
  {
    const child = path.join(tmp, "stand-in-child.mjs");
    fs.writeFileSync(
      child,
      `import fs from "node:fs";\nfs.appendFileSync(process.env.STAND_IN_FILE, \`\${Date.now()}\\n\`);\nprocess.exit(Number(process.env.STAND_IN_CODE));\n`,
    );
    const keepWith = (code) => {
      const file = path.join(tmp, `stand-in-${code}.txt`);
      const p = spawn(process.execPath, [KEEP], {
        env: {
          ...process.env,
          PHONE_PC_TEST: "1",
          PHONE_PC_KEEP_CHILD: child,
          STAND_IN_FILE: file,
          STAND_IN_CODE: String(code),
        },
        stdio: "ignore",
      });
      const runs = () =>
        fs.existsSync(file)
          ? fs.readFileSync(file, "utf8").trim().split("\n").map(Number)
          : [];
      const ended = new Promise((r) => p.on("exit", (c) => r(c)));
      return { p, runs, ended };
    };

    const one = keepWith(1);
    const t0 = Date.now();
    while (one.runs().length < 2 && Date.now() - t0 < 9000) await sleep(100);
    one.p.kill();
    await one.ended;
    const r1 = one.runs();
    check(
      "keep.mjs starts a child that ended with code 1 again within 6 s",
      r1.length >= 2 && r1[1] - r1[0] < 6000,
      JSON.stringify(r1),
    );

    const stop = keepWith(STOP_CODE);
    const code = await Promise.race([stop.ended, sleep(8000)]);
    if (code === undefined) stop.p.kill();
    check(
      `keep.mjs ends, and does not start the child again, when it ends with the stop code ${STOP_CODE}`,
      code === 0 && stop.runs().length === 1,
      `keep exit ${code}, runs ${stop.runs().length}`,
    );
  }

  // ---- the program against the stand-in relay
  const relay = await startRelay();
  const pcEnv = {
    ...dryEnv,
    PHONE_PC_PIPE:
      process.platform === "win32"
        ? `\\\\.\\pipe\\phone-app-pc-test-${nodeRandom(6).toString("hex")}`
        : path.join(tmp, "pc.sock"),
    PHONE_PC_TG_KEY: tgPubHex,
    NIMBALYST_ENDPOINT_FILE: path.join(tmp, "no-endpoint.json"),
  };
  const join = run(SETUP, ["join", relay.url], pcEnv);
  check(
    "dry join makes the keys and sets the start at log-on under the new names, and only deletes the retired bot's tasks",
    join.code === 0 &&
      fs.existsSync(path.join(home, ".phone-app", "pc-keys.json")) &&
      join.out.includes("would run: icacls") &&
      join.out.includes(KEEP) &&
      !join.out.includes("/create") &&
      join.out.includes('schtasks /delete /tn "Phone bot" /f') &&
      !/phone-bot\.vbs|phone-inbox\.vbs/.test(join.out),
    join.out,
  );

  const main = spawn(process.execPath, [MAIN], {
    env: { ...process.env, ...pcEnv },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let mainOut = "";
  main.stdout.on("data", (d) => (mainOut += d));
  main.stderr.on("data", (d) => (mainOut += d));
  const logFile = path.join(home, ".phone-app", "pc.log");
  const logText = () =>
    fs.existsSync(logFile) ? fs.readFileSync(logFile, "utf8") : "";
  const until = async (fn, ms) => {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(100))
      if (fn()) return true;
    return false;
  };
  try {
    check(
      "the program dials out with pc-join",
      await until(() => relay.firsts[0] === "pc-join", 8000),
      mainOut + logText(),
    );
    const second = spawn(process.execPath, [MAIN], {
      env: { ...process.env, ...pcEnv },
      stdio: "ignore",
    });
    const code2 = await new Promise((r) => {
      second.on("exit", r);
      setTimeout(() => {
        second.kill();
        r("still running");
      }, 8000);
    });
    check(
      `a second copy exits at once with the stop code ${STOP_CODE}, so its keep.mjs stops too`,
      code2 === STOP_CODE,
      String(code2),
    );

    const getCode = async () => {
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
      return m ? m[1].trim() : r.out;
    };

    const devA = newDev();
    const phoneA = await testPhone(relay.url, devA);
    const paired = await pairPhone(phoneA, devA, await getCode(), 111);
    check(
      "the phone pairs with the code and checks mac2",
      paired.K && paired.macOk,
      JSON.stringify(paired),
    );

    const ch = await openChannel(phoneA, devA, paired.K);
    check(
      "hello opens a channel session",
      ch && ch.hello.page === "ok",
      JSON.stringify(ch?.hello),
    );
    const MARKER = `MARKER-${nodeRandom(6).toString("hex")}`;
    const status = await ch.ask("pc.status", undefined, MARKER);
    check(
      "sealed round trip: pc.status answers through the relay",
      status?.ok &&
        status.d.setupVersion === VERSION &&
        status.d.nimbalyst === "closed" &&
        status.d.page === "ok",
      JSON.stringify(status),
    );
    const start = await ch.ask("nimbalyst.start");
    console.log(`     | nimbalyst.start (dry): ${JSON.stringify(start?.d)}`);
    check(
      "Start Nimbalyst builds the fixed command in dry mode",
      start?.ok &&
        start.d.state === "starting" &&
        /AppData[\\/]Local[\\/]Programs[\\/]Nimbalyst[\\/]Nimbalyst\.exe$/.test(
          start.d.dry.file,
        ) &&
        start.d.dry.args.length === 0,
      JSON.stringify(start),
    );
    const off = await ch.ask("shell.run", { cmd: "dir" });
    check(
      'an action off the list is answered "not-offered"',
      off?.ok === false && off.err === "not-offered",
      JSON.stringify(off),
    );
    const bad = await ch.ask("pc.status", { extra: 1 });
    check(
      "an unknown field answers bad-input naming it",
      bad?.err === "bad-input" && bad.field === "extra",
    );

    const devB = newDev();
    const phoneB = await testPhone(relay.url, devB);
    const stranger = await openChannel(phoneB, devB, seal.randomBytes(32));
    check(
      "a message from an unpaired key is dropped: no answer, one log line",
      stranger === null && logText().includes("drop unpaired device"),
    );

    const devC = newDev();
    const phoneC = await testPhone(relay.url, devC);
    const other = await pairPhone(phoneC, devC, await getCode(), 222);
    check(
      "a second Telegram id cannot pair: other-user",
      other.fail === "other-user",
      JSON.stringify(other),
    );

    const plain = relay.seen.join("\n");
    const appFrames = relay.seen
      .map((t) => JSON.parse(t))
      .filter((f) => f.t === "app");
    check(
      "the relay saw only sealed bytes: app frames hold v, t, dev, sid, n, c and no plain text",
      appFrames.length >= 8 &&
        appFrames.every((f) => Object.keys(f).join() === "v,t,dev,sid,n,c") &&
        ![
          MARKER,
          "pc.status",
          "nimbalyst.start",
          "Nimbalyst.exe",
          "not-offered",
          os.hostname(),
        ].some((w) => plain.includes(w)),
      `${appFrames.length} app frames`,
    );

    relay.dropPc();
    check(
      "after the relay drops it, the program reconnects with pc-auth",
      await until(
        () => relay.firsts.length === 2 && relay.firsts[1] === "pc-auth",
        5000,
      ),
      relay.firsts.join(),
    );
    const leak = [
      "MARKER-",
      "first_name",
      paired.K && seal.toB64u(paired.K),
    ].filter((w) => logText().includes(w));
    check(
      "the log holds no session text and no key",
      leak.length === 0,
      leak.join(),
    );

    // ---- the devices list and Remove (actions 21 and 22): a second device of the same account pairs by code
    const keyFileDevices = () =>
      JSON.parse(
        fs.readFileSync(path.join(home, ".phone-app", "pc-keys.json"), "utf8"),
      ).devices.map((d) => d.device);
    const devD = newDev();
    const phoneD = await testPhone(relay.url, devD);
    const pairedD = await pairPhone(
      phoneD,
      devD,
      await getCode(),
      111,
      "desktop",
    );
    const chA = await openChannel(phoneA, devA, paired.K);
    const chD = await openChannel(phoneD, devD, pairedD.K);
    const list = await chA.ask("devices.list", {});
    const [la, ld] = list?.d ?? [];
    check(
      "devices.list gives both devices, oldest first, with kind, paired date and last seen, and marks the asking one",
      list?.ok &&
        list.d.length === 2 &&
        la.device === devA &&
        la.client === null &&
        la.thisOne === true &&
        ld.device === devD &&
        ld.client === "desktop" &&
        ld.thisOne === false &&
        !Number.isNaN(Date.parse(la.pairedAt)) &&
        la.pairedAt < ld.pairedAt &&
        !Number.isNaN(Date.parse(la.lastSeen)) &&
        !Number.isNaN(Date.parse(ld.lastSeen)),
      JSON.stringify(list),
    );
    const older = await chD.ask("devices.remove", { device: devA });
    check(
      "a later device cannot remove an older one: not-allowed, and both keys stay",
      older?.ok === false &&
        older.err === "not-allowed" &&
        keyFileDevices().join() === [devA, devD].join(),
      JSON.stringify(older),
    );
    const drops = () => logText().split("drop unpaired device").length;
    const dropsBefore = drops();
    const removed = await chA.ask("devices.remove", { device: devD });
    check(
      "removing the other device takes its key out of the key file",
      removed?.ok &&
        removed.d.removed === devD &&
        keyFileDevices().join() === devA,
      JSON.stringify(removed),
    );
    const afterRemove = await chD.ask("pc.status", {});
    check(
      "the removed device's channel is over: its next frame is dropped with no answer",
      afterRemove === null && drops() === dropsBefore + 1,
      JSON.stringify(afterRemove),
    );
    const again = await openChannel(phoneD, devD, pairedD.K);
    const fail = await phoneD.next(
      (f) => f.t === "app-fail" && f.dev === devD,
      2000,
    );
    check(
      "a hello from the removed device gets app-fail unknown-device",
      again === null && fail?.reason === "unknown-device",
      JSON.stringify(fail),
    );
    const unpaired = await chA.ask("devices.remove", { device: devA });
    check(
      "Unpair: the asking device removes itself, still gets the answer, and the key file holds no device",
      unpaired?.ok &&
        unpaired.d.removed === devA &&
        keyFileDevices().length === 0,
      JSON.stringify(unpaired),
    );
    phoneD.close();
    for (const p of [phoneA, phoneB, phoneC]) p.close();

    // ---- the copy install.mjs --with phone-bot puts in ~/.claude reads its setup version there and dials out
    await new Promise((r) => {
      main.on("exit", r);
      main.kill();
    });
    const installed = path.join(tmp, "installed");
    const noTools = path.join(tmp, "empty-path");
    fs.mkdirSync(noTools);
    const inst = spawnSync(
      process.execPath,
      [
        path.join(ROOT, "install.mjs"),
        "--home",
        installed,
        "--with",
        "phone-bot",
      ],
      {
        encoding: "utf8",
        env: { ...process.env, PATH: noTools, Path: noTools },
      },
    );
    const socketsBefore = relay.firsts.length;
    const copy = spawn(
      process.execPath,
      [
        path.join(
          installed,
          ".claude",
          "skills",
          "phone-bot",
          "pc",
          "main.mjs",
        ),
      ],
      { env: { ...process.env, ...pcEnv }, stdio: ["ignore", "pipe", "pipe"] },
    );
    let copyOut = "";
    copy.stdout.on("data", (d) => (copyOut += d));
    copy.stderr.on("data", (d) => (copyOut += d));
    try {
      check(
        "the installed main.mjs reads ~/.claude/version.json and dials out to the relay",
        inst.status === 0 &&
          (await until(
            () => relay.firsts.length > socketsBefore || copy.exitCode !== null,
            8000,
          )) &&
          copy.exitCode === null,
        `install exit ${inst.status}; ${copyOut}`,
      );
    } finally {
      copy.kill();
    }
  } finally {
    main.kill();
    relay.close();
  }
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
