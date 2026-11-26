// Tests for the page's stream line (files design, section 4.1) in phone/page/frame/channel.js: streams wait their
// turn, first in first out, while the PC would hold over 50 MB of them or 2 are open, and never fail with "busy".
// The real channel runs over a stand-in socket; a stand-in PC opens the sealed frames, answers each whole stream at
// once and holds each ask until the test answers it. It refuses, as core/channel.mjs does, a third open stream or
// one that takes it over 50 MB.
// Run: node tests/test-phone-page-stream.mjs
import { registerHooks } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
// The page's files are modules with no package.json saying so.
const PAGE = `${pathToFileURL(path.join(ROOT, "phone", "page")).href}/`;
registerHooks({
  load: (url, context, next) =>
    next(
      url,
      url.startsWith(PAGE) ? { ...context, format: "module" } : context,
    ),
});
const channel = await import(
  pathToFileURL(path.join(ROOT, "phone", "page", "frame", "channel.js")).href
);
const seal = await import(
  pathToFileURL(path.join(ROOT, "phone", "shared", "seal.mjs")).href
);

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 600);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 20_000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(10);
  }
}

const MB = 1024 * 1024;
const HELD_MAX = 50 * MB;
const K = seal.randomBytes(32);
const DEV = "dev-stream-test";

// The stand-in PC: one session per hello, as core/channel.mjs keeps them.
function standInPc(socket) {
  const log = []; // "hello", "first s-1", "whole s-1", "ask r-3 s-1", "answer r-3", "broken s-1: why"
  let s = null;
  let line = Promise.resolve();
  const header = (sid, n) => ({ v: seal.PROTOCOL, t: "app", dev: DEV, sid, n });
  async function sendSealed(body) {
    s.nOut++;
    const h = header(s.sid, s.nOut);
    socket.fromPc({ ...h, c: await seal.sealFrame(s.keys.pc2p, h, body) });
  }
  async function take(f) {
    if (f.n === 0) {
      const h = header(f.sid, 0);
      const hello = await seal.openHello(K, h, f.c);
      const npc = seal.randomBytes(16);
      socket.fromPc({
        ...h,
        c: await seal.sealHello(K, h, {
          k: "hello",
          npc: seal.toB64u(npc),
          pcVersion: "test",
          protocol: seal.PROTOCOL,
          page: {},
        }),
      });
      s = {
        sid: f.sid,
        nOut: 0,
        keys: await seal.sessionKeys(K, seal.fromB64u(hello.np), npc),
        open: new Map(), // id -> { total, of }, while pieces come
        whole: new Map(), // id -> total, until an ask names it
        asks: new Map(), // ask id -> its body, until the test answers it
      };
      log.push("hello");
      return;
    }
    if (!s || f.sid !== s.sid) return;
    const body = await seal.openFrame(s.keys.p2pc, header(f.sid, f.n), f.c);
    if (body.k === "chunk") {
      const broken = (why) => {
        s.open.delete(body.stream);
        log.push(`broken ${body.stream}: ${why}`);
        return sendSealed({
          k: "res",
          id: body.stream,
          ok: false,
          err: "stream-broken",
          why,
        });
      };
      if (body.i === 0) {
        if (s.open.size >= 2) return broken("more than 2 streams open");
        let held = body.total;
        for (const o of s.open.values()) held += o.total;
        for (const t of s.whole.values()) held += t;
        if (held > HELD_MAX) return broken("over 50 MB held");
        s.open.set(body.stream, { total: body.total, of: body.of });
        log.push(`first ${body.stream}`);
      } else if (!s.open.has(body.stream)) return;
      const { total, of } = s.open.get(body.stream);
      if (body.i === of - 1) {
        s.open.delete(body.stream);
        s.whole.set(body.stream, total);
        log.push(`whole ${body.stream}`);
        await sendSealed({
          k: "res",
          id: body.stream,
          ok: true,
          d: { stream: body.stream, bytes: total },
        });
      }
    } else if (body.k === "req") {
      s.asks.set(body.id, body);
      log.push(`ask ${body.id} ${body.d?.stream}`);
    }
  }
  return {
    log,
    take: (f) => {
      line = line.then(() => take(f));
    },
    // Answers every ask held so far; the stream it names is taken.
    async answerAsks() {
      for (const [id, body] of s.asks) {
        s.asks.delete(id);
        s.whole.delete(body.d?.stream);
        log.push(`answer ${id}`);
        await sendSealed({ k: "res", id, ok: true, d: {} });
      }
    },
  };
}

// A socket for openLink: open at once; what the page sends goes to the stand-in PC, in order.
let pc = null;
class StandInSocket {
  constructor() {
    this.readyState = 0;
    this.bufferedAmount = 0;
    pc = standInPc(this);
    setTimeout(() => {
      this.readyState = 1;
      this.onopen?.();
    });
  }
  send(text) {
    const f = JSON.parse(text);
    if (f.t === "ping") setTimeout(() => this.fromPc({ t: "pong" }));
    if (f.t === "app") pc.take(f);
  }
  fromPc(f) {
    this.onmessage?.({ data: JSON.stringify(f) });
  }
  close(code, reason) {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
}

async function session(link) {
  return channel.openSession(link, {
    K,
    dev: DEV,
    pageVersion: "test",
    onEvent: () => {},
  });
}
async function newLink() {
  return channel.openLink({
    url: "ws://stand-in/ws",
    initData: "test",
    WebSocket: StandInSocket,
  });
}

// One stream with what it saw: its answer, whether it waited, and its error.
function stream(s, mb) {
  const st = { waits: [], r: null, err: null, done: false };
  st.run = s
    .sendStream(
      new Uint8Array(mb * MB),
      "application/octet-stream",
      null,
      channel.FILES_STREAM_MAX,
      (w) => st.waits.push(w),
    )
    .then(
      (r) => (st.r = r),
      (e) => (st.err = e.code ?? e.message),
    )
    .finally(() => (st.done = true));
  return st;
}
const firsts = () => pc.log.filter((x) => x.startsWith("first "));
const brokenAny = () => pc.log.some((x) => x.startsWith("broken"));
const at = (prefix) => pc.log.findIndex((x) => x.startsWith(prefix));

// The page asks for the whole stream `st` as folder.put would; the stand-in PC holds the ask until answerAsks().
// Resolves with { asking } once the PC has the ask, `asking` the ask's own answer to come.
async function askFor(s, st) {
  const asking = s.ask("folder.put", { stream: st.r.d.stream });
  await until(() => at("ask ") >= 0, 5000);
  return { asking };
}

async function caseTwoFull() {
  const link = await newLink();
  const s = await session(link);
  const a = stream(s, 50);
  const b = stream(s, 50);
  await until(() => a.done);
  await sleep(100);
  const heldBack =
    !b.done && show(b.waits) === "[true]" && firsts().length === 1;
  const { asking } = await askFor(s, a);
  await pc.answerAsks();
  await asking;
  // The default 20 s, as for the first stream: this case checks order, not speed, and a busy CI runner took over 5 s.
  await until(() => b.done);
  check(
    "two 50 MB streams started together must go one after the other: the second calls onWait(true), never fails busy, and goes only once the ask naming the first is answered",
    a.r?.ok &&
      heldBack &&
      b.r?.ok &&
      b.err === null &&
      show(b.waits) === "[true,false]" &&
      at("answer ") < pc.log.lastIndexOf(firsts()[1]) &&
      !brokenAny(),
    show({
      a: a.r ?? a.err,
      b: b.r ?? b.err,
      heldBack,
      waits: b.waits,
      log: pc.log,
    }),
  );
  await s.bye();
  link.close();
}

async function caseSmallDuringBig() {
  const link = await newLink();
  const s = await session(link);
  const a = stream(s, 45);
  await until(() => firsts().length === 1);
  const b = stream(s, 10);
  const startedDuring = !a.done;
  await until(() => a.done);
  await sleep(100);
  const heldAfterOk = !b.done && firsts().length === 1;
  const { asking } = await askFor(s, a);
  await sleep(100);
  const heldWhileAsked = !b.done && firsts().length === 1;
  await pc.answerAsks();
  await asking;
  // The default 20 s, as for the first stream: this case checks order, not speed, and a busy CI runner took over 5 s.
  await until(() => b.done);
  check(
    "a 10 MB stream started during a 45 MB one must wait while the PC holds the 45 MB (after its ok and while the ask naming it is unanswered), then go once that ask is answered",
    startedDuring &&
      heldAfterOk &&
      heldWhileAsked &&
      b.r?.ok &&
      show(b.waits) === "[true,false]" &&
      at("answer ") < pc.log.lastIndexOf(firsts()[1]) &&
      !brokenAny(),
    show({
      startedDuring,
      heldAfterOk,
      heldWhileAsked,
      b: b.r ?? b.err,
      waits: b.waits,
      log: pc.log,
    }),
  );
  await s.bye();
  link.close();
}

async function caseSideBySide() {
  const link = await newLink();
  const s = await session(link);
  const a = stream(s, 20);
  const b = stream(s, 20);
  await until(() => a.done && b.done);
  check(
    "two 20 MB streams must go side by side: both first pieces before either is whole, and neither waits",
    a.r?.ok &&
      b.r?.ok &&
      a.waits.length === 0 &&
      b.waits.length === 0 &&
      firsts().length === 2 &&
      pc.log.indexOf(firsts()[1]) < at("whole ") &&
      !brokenAny(),
    show({
      a: a.r ?? a.err,
      b: b.r ?? b.err,
      waits: [a.waits, b.waits],
      log: pc.log,
    }),
  );
  await s.bye();
  link.close();
}

async function caseNewHello() {
  const link = await newLink();
  const s1 = await session(link);
  const a = stream(s1, 50);
  await until(() => a.done);
  const b = stream(s1, 10);
  await until(() => b.waits.length === 1, 5000);
  await s1.bye();
  await until(() => b.done, 5000);
  const s2 = await session(link);
  const c = stream(s2, 50);
  await until(() => c.done);
  check(
    "a new hello must set held to 0: a 50 MB stream goes at once in the new session although the old one held 50 MB, and the stream waiting in the old session fails with its end",
    a.r?.ok &&
      b.err === "bye" &&
      c.r?.ok &&
      c.waits.length === 0 &&
      !brokenAny(),
    show({
      a: a.r ?? a.err,
      b: b.err,
      c: c.r ?? c.err,
      waits: c.waits,
      log: pc.log,
    }),
  );
  await s2.bye();
  link.close();
}

await caseTwoFull();
await caseSmallDuringBig();
await caseSideBySide();
await caseNewHello();
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
