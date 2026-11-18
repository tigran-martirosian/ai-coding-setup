// The page's side of the pipe (pipe design, sections 2 and 4): the relay socket, pairing with a code and the
// sealed app channel. No DOM here: the same file runs in the phone's web view and in Node for the tests, so the
// caller passes the socket class, the relay's socket address and Telegram's signed initData.
import {
  checkJoinMac,
  checkPairMac2,
  fromB64u,
  joinCommit,
  joinKey,
  joinWord,
  KINDS,
  newX25519,
  openBox,
  openFrame,
  openHello,
  PROTOCOL,
  pairKey,
  pairMac1,
  randomBytes,
  readPairCode,
  sealFrame,
  sealHello,
  sessionKeys,
  sha256,
  toB64u,
  toHex,
} from "../../shared/seal.mjs";

const PAIR_MS = 30_000;
// A join request lives 3 minutes on the PC; the page waits a little longer for the PC's own "expired".
const JOIN_MS = 200_000;
const HELLO_MS = 10_000;
// The link's own checks (phone steady design, section 2): a ping every 20 s, which the relay answers by itself
// (its auto-response matches this exact text); no pong in 10 s drops the socket. A socket not open in 10 s is stuck.
const PING_S = 20;
const PING = '{"t":"ping"}';
const PONG_MS = 10_000;
const OPEN_MS = 10_000;
const ANSWER_MS = 30_000;
// Large payloads in pieces (pipe design, section 4).
const PIECE_BYTES = 192 * 1024;
export const STREAM_MAX = 25 * 1024 * 1024; // a stream whose caller names no limit (message attachments)
export const FILES_STREAM_MAX = 50 * 1024 * 1024; // the limit a caller passes for files and voice notes
const STREAMS_OPEN = 2;
// The PC holds at most 50 MB of one session's streams not yet taken (core/channel.mjs STREAMS_HELD_MAX), and drops
// a whole stream no action took in 60 s (its STREAM_KEEP_MS).
const STREAMS_HELD_MAX = 50 * 1024 * 1024;
const STREAM_KEEP_MS = 60_000;
const BUFFERED_MAX = 1024 * 1024;

// A failure the page shows: `code` is the relay's or the PC's one word (pair-fail reasons, close reasons,
// "pc-offline", "pc-online", "protocol", "timeout", "closed", "counter-gap"), `extra` what came with it.
export class ChannelError extends Error {
  constructor(code, extra = {}) {
    super(`channel: ${code}`);
    this.code = code;
    this.extra = extra;
  }
}

// The relay's socket address for a page served at `pageUrl`: same host, /ws, wss for https.
export function socketUrl(pageUrl) {
  const u = new URL("/ws", pageUrl);
  if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol === "http:") u.protocol = "ws:";
  else throw new Error(`the page address ${u.origin} is not http or https`);
  return u.href;
}

// Opens the relay socket and signs in with `auth { initData, ping }`. The Hub does not answer a good sign-in; a bad
// one closes the socket with 4401 and one word. Resolves once the socket is open and `auth` is sent; a socket not
// open in 10 s rejects with "stuck". While open it pings; a missing pong drops it (`closed` says "no-pong").
export function openLink({ url, initData, WebSocket: Socket }) {
  if (typeof initData !== "string" || !initData)
    throw new ChannelError("no-init-data");
  const ws = new Socket(url);
  const listeners = new Set();
  let closed = null;
  let markClosed;
  const whenClosed = new Promise((r) => {
    markClosed = r;
  });
  let pinger = null;
  let pongWait = null;
  // Timers that never keep a Node test run alive (a browser's timer ids have no unref).
  const unref = (t) => {
    t?.unref?.();
    return t;
  };
  function shut(c) {
    if (closed) return;
    closed = c;
    clearInterval(pinger);
    clearTimeout(pongWait);
    markClosed(closed);
  }

  const link = {
    send(frame) {
      if (closed) throw new ChannelError("closed", closed);
      ws.send(JSON.stringify(frame));
    },
    // Every frame but pong goes to each listener; returns a function that removes it.
    listen(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    // The first frame `match` accepts, or ChannelError "timeout" / the close reason.
    next(match, ms) {
      return new Promise((resolve, reject) => {
        if (closed) return reject(new ChannelError(closeCode(closed), closed));
        const stop = () => {
          clearTimeout(timer);
          off();
          offClose();
        };
        const timer = setTimeout(() => {
          stop();
          reject(new ChannelError("timeout"));
        }, ms);
        const off = link.listen((f) => {
          if (!match(f)) return;
          stop();
          resolve(f);
        });
        const offClose = link.onClose((c) => {
          stop();
          reject(new ChannelError(closeCode(c), c));
        });
      });
    },
    onClose(fn) {
      let on = true;
      whenClosed.then((c) => on && fn(c));
      return () => {
        on = false;
      };
    },
    close(code = 1000, reason = "bye") {
      if (!closed) ws.close(code, reason);
    },
    // Ends the link at once, whatever the socket's state: a socket that went dead may never fire its close.
    drop(reason) {
      if (closed) return;
      shut({ code: 4000, reason });
      try {
        ws.close(4000, reason);
      } catch {
        // a socket still connecting or already gone: nothing more to close
      }
    },
    get closed() {
      return closed;
    },
    // Bytes the socket has not sent yet: a stream waits for this to fall before its next piece.
    get buffered() {
      return ws.bufferedAmount ?? 0;
    },
  };

  ws.onmessage = (ev) => {
    if (typeof ev.data !== "string") return;
    let f;
    try {
      f = JSON.parse(ev.data);
    } catch {
      return;
    }
    if (!f || typeof f !== "object") return;
    if (f.t === "pong") {
      clearTimeout(pongWait);
      pongWait = null;
      return;
    }
    for (const fn of [...listeners]) fn(f);
  };
  ws.onclose = (ev) => shut({ code: ev.code, reason: String(ev.reason || "") });

  return new Promise((resolve, reject) => {
    const stuck = unref(
      setTimeout(() => {
        reject(new ChannelError("stuck"));
        link.drop("stuck");
      }, OPEN_MS),
    );
    ws.onopen = () => {
      clearTimeout(stuck);
      ws.send(
        JSON.stringify({ v: PROTOCOL, t: "auth", initData, ping: PING_S }),
      );
      pinger = unref(
        setInterval(() => {
          if (closed) return;
          ws.send(PING);
          pongWait ??= unref(setTimeout(() => link.drop("no-pong"), PONG_MS));
        }, PING_S * 1000),
      );
      resolve(link);
    };
    ws.onerror = () => {
      if (ws.readyState === 1) return;
      clearTimeout(stuck);
      reject(new ChannelError("unreachable"));
    };
  });
}

// 4401 carries "not-invited" or "bad-sign"; other closes are "closed".
const closeCode = (c) => (c.code === 4401 && c.reason ? c.reason : "closed");

const checkKind = (kind) => {
  if (!Object.hasOwn(KINDS, kind))
    throw new Error(`channel: "${kind}" is not a device kind`);
};

// The answer to a pair, join-ask or the PC's last join frame: offline and error frames become ChannelErrors.
function failOf(r) {
  if (r.t === "offline")
    return new ChannelError("pc-offline", { lastSeen: r.lastSeen ?? null });
  if (r.t === "error") return new ChannelError(String(r.e));
  if (r.t === "pair-fail" || r.t === "join-fail")
    return new ChannelError(String(r.reason));
  return null;
}

// Pairs this page with the PC that shows `code` (pipe section 2, steps 3 to 7); `kind` is the device's kind
// (KINDS in seal.mjs). Resolves with { K, pcId, dev }; the caller stores K and drops nothing else, the device key
// never leaves this function.
export async function pair(link, { code, initData, kind }) {
  checkKind(kind);
  const { pcId, secret } = readPairCode(code);
  const dev = toB64u(randomBytes(16));
  const own = await newX25519();
  const mac1 = await pairMac1(secret, pcId, own.publicRaw, initData);
  const answer = link.next(
    (f) =>
      ((f.t === "pair-ok" || f.t === "pair-fail") && f.dev === dev) ||
      f.t === "offline" ||
      f.t === "error",
    PAIR_MS,
  );
  link.send({
    v: PROTOCOL,
    t: "pair",
    dev,
    pcId,
    DP: toB64u(own.publicRaw),
    kind,
    initData,
    mac1: toB64u(mac1),
  });
  const r = await answer;
  const failed = failOf(r);
  if (failed) throw failed;
  let pcPub;
  let mac2;
  try {
    pcPub = fromB64u(r.PCP);
    mac2 = fromB64u(r.mac2);
  } catch {
    throw new ChannelError("bad-answer");
  }
  // A relay that swapped DP or PCP fails here: it never saw S.
  if (!(await checkPairMac2(secret, mac2, pcId, own.publicRaw, pcPub)))
    throw new ChannelError("bad-mac2");
  const K = await pairKey(
    own.privateKey,
    pcPub,
    secret,
    pcId,
    own.publicRaw,
    pcPub,
  );
  return { K, pcId, dev };
}

// Asks to join the PC by an OK on a paired device (pipe design, section 15, steps 1 to 8). Resolves after the
// PC's join-wait with { dev, pcId, word, open, done, cancel() }: `word` is the six-digit check number, `open` how
// many paired devices have the app open, `done` resolves with { K, pcId, dev } after an OK whose mac3 checks
// and whose box opens, or rejects with the PC's reason ("refused", "expired", "bad-mac3", ...). The device key
// and the nonce stay inside this function; nothing is kept before mac3 checks.
export async function join(link, { kind, initData }) {
  checkKind(kind);
  const dev = toB64u(randomBytes(16));
  const own = await newX25519();
  const Nn = randomBytes(16);
  const commit = await joinCommit(dev, own.publicRaw, Nn);
  const mine = (f) =>
    ((f.t === "join-wait" || f.t === "join-ok" || f.t === "join-fail") &&
      f.dev === dev) ||
    f.t === "offline" ||
    f.t === "error";
  const waiting = link.next(mine, PAIR_MS);
  link.send({
    v: PROTOCOL,
    t: "join-ask",
    dev,
    DN: toB64u(own.publicRaw),
    kind,
    commit: toB64u(commit),
    initData,
  });
  const w = await waiting;
  const failed = failOf(w);
  if (failed) throw failed;
  if (w.t !== "join-wait") throw new ChannelError("bad-answer");
  let pcPub;
  let Npc;
  try {
    pcPub = fromB64u(w.PCP);
    Npc = fromB64u(w.Npc);
  } catch {
    throw new ChannelError("bad-answer");
  }
  if (typeof w.pcId !== "string" || !Number.isInteger(w.open))
    throw new ChannelError("bad-answer");
  const pcId = w.pcId;
  const answer = link.next(mine, JOIN_MS);
  link.send({ v: PROTOCOL, t: "join-reveal", dev, Nn: toB64u(Nn) });
  const word = await joinWord(pcId, dev, own.publicRaw, pcPub, Nn, Npc);
  const done = answer.then(async (r) => {
    const failed = failOf(r);
    if (failed) throw failed;
    if (r.t !== "join-ok") throw new ChannelError("bad-answer");
    let box;
    let mac3;
    try {
      box = fromB64u(r.box);
      mac3 = fromB64u(r.mac3);
    } catch {
      throw new ChannelError("bad-answer");
    }
    const J = await joinKey(
      own.privateKey,
      pcPub,
      Nn,
      Npc,
      pcId,
      dev,
      own.publicRaw,
      pcPub,
    );
    // A box the relay sealed to DN itself fails here: it cannot compute J.
    if (!(await checkJoinMac(J, mac3, dev, box)))
      throw new ChannelError("bad-mac3");
    let K;
    try {
      K = await openBox(own.privateKey, own.publicRaw, box);
    } catch {
      throw new ChannelError("bad-mac3");
    }
    if (K.length !== 32) throw new ChannelError("bad-mac3");
    return { K, pcId, dev };
  });
  // A caller that leaves before the answer still must not see an unhandled rejection.
  done.catch(() => {});
  return {
    dev,
    pcId,
    word,
    open: w.open,
    done,
    cancel: () => link.send({ v: PROTOCOL, t: "join-cancel", dev }),
  };
}

// Sends the hello and checks the PC's answer; resolves with the answer and the session keys. A PC that no longer
// holds this device answers `app-fail` outside the seal: its word ("unknown-device") ends the hello.
async function sayHello(link, { K, dev, sid, np, h0, pageVersion }) {
  const answer = link.next(
    (f) =>
      (f.t === "app" && f.dev === dev && f.sid === sid && f.n === 0) ||
      (f.t === "app-fail" && f.dev === dev) ||
      f.t === "offline" ||
      f.t === "error",
    HELLO_MS,
  );
  // A link that closes while the hello is sealed rejects `answer` before it is awaited; the send then throws, and
  // that is the error the caller gets.
  answer.catch(() => {});
  link.send({
    ...h0,
    c: await sealHello(K, h0, {
      k: "hello",
      np: toB64u(np),
      pageVersion,
      protocol: PROTOCOL,
    }),
  });
  const r = await answer;
  if (r.t === "offline")
    throw new ChannelError("pc-offline", { lastSeen: r.lastSeen ?? null });
  if (r.t === "error") throw new ChannelError(String(r.e));
  if (r.t === "app-fail") throw new ChannelError(String(r.reason));
  const hello = await openHello(K, h0, r.c);
  if (!hello || hello.k !== "hello") throw new ChannelError("bad-hello");
  if (hello.protocol !== PROTOCOL)
    throw new ChannelError("protocol", {
      page: PROTOCOL,
      pc: hello.protocol,
    });
  let npc;
  try {
    npc = fromB64u(hello.npc);
  } catch {
    throw new ChannelError("bad-hello");
  }
  return { hello, keys: await sessionKeys(K, np, npc) };
}

// Starts a channel session: `hello` sealed with K, then one session key per direction. Resolves with
// { hello, ask(action, data, ms), sendStream(bytes, mime, onProgress, max, onWait), bye(), ended } where `hello` is
// the PC's answer ({ pcVersion, protocol, page }) and `ended` resolves with the reason the session stopped. onEvent
// gets every `evt` body the PC pushes.
export async function openSession(link, { K, dev, pageVersion, onEvent }) {
  const sid = toB64u(randomBytes(12));
  const np = randomBytes(16);
  const header = (n) => ({ v: PROTOCOL, t: "app", dev, sid, n });
  const h0 = header(0);
  // The PC may send frames of this session right behind its hello answer (pairing's device.joined at hello). They
  // can come before the session keys are made, so they wait here and are taken in order once the keys are ready.
  const early = [];
  const offEarly = link.listen((f) => {
    if (f.t === "app" && f.dev === dev && f.sid === sid && f.n > 0)
      early.push(f);
  });
  let hello;
  let keys;
  try {
    ({ hello, keys } = await sayHello(link, {
      K,
      dev,
      sid,
      np,
      h0,
      pageVersion,
    }));
  } catch (e) {
    offEarly();
    throw e;
  }

  let nOut = 0;
  let nIn = 0;
  let seq = 0;
  let streamsOpen = 0;
  // The stream line (files design, section 4.1). `held` is the bytes of this session's streams the PC may still
  // hold: a stream counts from its turn until its answer is not ok, an ask naming it is answered, or 60 s after its
  // ok. A stream waits its turn, first in first out, while `held` would pass 50 MB or 2 streams are open. A new
  // hello is a new session, so `held` starts at 0 (the PC ended the old session and its streams).
  let held = 0;
  const holding = new Map(); // stream id -> { size, timer }: counted in `held`
  const line = []; // { size, go, fail }: streams waiting their turn, oldest first
  const fits = (size) =>
    streamsOpen < STREAMS_OPEN && held + size <= STREAMS_HELD_MAX;
  // Gives the oldest waiting streams their turn while they fit; counts them at once, so no later stream passes them.
  function pump() {
    while (!endedWith && line.length && fits(line[0].size)) {
      const w = line.shift();
      streamsOpen++;
      held += w.size;
      w.go();
    }
  }
  function release(id) {
    const h = holding.get(id);
    if (!h) return;
    holding.delete(id);
    clearTimeout(h.timer);
    held -= h.size;
    pump();
  }
  let outQueue = Promise.resolve();
  let inQueue = Promise.resolve();
  let endedWith = null;
  let markEnded;
  const ended = new Promise((r) => {
    markEnded = r;
  });
  const pending = new Map(); // id -> { resolve, reject, timer }

  function end(code, extra = {}) {
    if (endedWith) return;
    endedWith = new ChannelError(code, extra);
    off();
    offClose();
    for (const p of pending.values()) {
      clearTimeout(p.timer);
      p.reject(endedWith);
    }
    pending.clear();
    for (const w of line.splice(0)) w.fail(endedWith);
    for (const h of holding.values()) clearTimeout(h.timer);
    holding.clear();
    held = 0;
    markEnded(endedWith);
  }

  // Frames leave in counter order, one seal at a time.
  function sendSealed(body) {
    outQueue = outQueue.then(async () => {
      if (endedWith) throw endedWith;
      nOut++;
      const h = header(nOut);
      link.send({ ...h, c: await sealFrame(keys.p2pc, h, body) });
    });
    return outQueue;
  }

  async function take(f) {
    if (endedWith) return;
    // A counter that is not exactly one more than the last ends the session (a replay or a reordering).
    if (f.n !== nIn + 1) return end("counter-gap");
    const body = await openFrame(keys.pc2p, header(f.n), f.c);
    if (!body) return end("bad-frame");
    nIn = f.n;
    if (body.k === "res") {
      const p = pending.get(body.id);
      if (!p) return;
      pending.delete(body.id);
      clearTimeout(p.timer);
      p.resolve(body);
    } else if (body.k === "evt" && onEvent) onEvent(body);
  }

  offEarly();
  for (const f of early) inQueue = inQueue.then(() => take(f));
  const off = link.listen((f) => {
    if (f.t === "app" && f.dev === dev && f.sid === sid && f.n > 0)
      inQueue = inQueue.then(() => take(f));
    else if (f.t === "offline")
      end("pc-offline", { lastSeen: f.lastSeen ?? null });
    // The PC linked again: a restarted PC program no longer knows this session and drops its frames unanswered.
    else if (f.t === "pc-online") end("pc-online");
  });
  const offClose = link.onClose((c) => end(closeCode(c), c));

  return {
    hello: {
      pcVersion: hello.pcVersion,
      protocol: hello.protocol,
      page: hello.page,
      // The PC's action names, or null from a PC of 26.3.3 or older, which sends no list.
      actions: Array.isArray(hello.actions) ? hello.actions : null,
    },
    ended,
    // Resolves with the PC's answer body: { k: "res", id, ok: true, d } or { ok: false, err }.
    // No answer in time ends the session too: a PC that restarted, or lost the session, drops this session's
    // frames without a word, so only a new hello (the app reconnects on `ended`) gets an answer again.
    ask(action, data, ms = ANSWER_MS) {
      if (endedWith) return Promise.reject(endedWith);
      const id = `r-${++seq}`;
      const result = new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ChannelError("timeout", { action }));
          end("timeout", { action });
        }, ms);
        pending.set(id, { resolve, reject, timer });
      });
      // An ask naming a held stream: once answered, the PC took the stream or dropped it.
      const named = data?.stream;
      if (holding.has(named))
        result.then(
          () => release(named),
          () => {},
        );
      const body = { k: "req", id, a: action };
      if (data !== undefined) body.d = data;
      sendSealed(body).catch((e) => end("closed", { message: e.message }));
      return result;
    },
    // Sends `bytes` as a stream of pieces of 192 KB, each its own sealed frame, waiting for the socket to drain
    // under 1 MB before each piece. Resolves with the PC's answer for the stream id ({ ok: true, d: { stream,
    // bytes } } or { ok: false, err: "stream-broken", why }); the caller keeps the bytes until it is ok.
    // onProgress(part) gets 0 to 1 after each piece. Over `max` bytes is refused before anything is sent: the
    // caller's limit (FILES_STREAM_MAX for files and voice notes), 25 MB (STREAM_MAX) when it names none.
    // A stream that must wait its turn in the stream line calls onWait(true), and onWait(false) when the wait ends,
    // so the calling screen can say it waits.
    async sendStream(bytes, mime, onProgress, max = STREAM_MAX, onWait) {
      if (endedWith) throw endedWith;
      if (max > STREAMS_HELD_MAX)
        throw new Error(
          `channel: a stream limit of ${max} bytes is over the ${STREAMS_HELD_MAX} the PC holds`,
        );
      if (!(bytes instanceof Uint8Array) || !bytes.length)
        throw new ChannelError("no-bytes");
      if (bytes.length > max)
        throw new ChannelError("too-big", { bytes: bytes.length });
      const size = bytes.length;
      if (line.length || !fits(size)) {
        onWait?.(true);
        try {
          await new Promise((go, fail) => line.push({ size, go, fail }));
        } finally {
          onWait?.(false);
        }
      } else {
        streamsOpen++;
        held += size;
      }
      const id = `s-${++seq}`;
      const kept = { size, timer: null };
      holding.set(id, kept);
      let answered = false;
      let r = null;
      try {
        const sum = toHex(await sha256(bytes));
        const result = new Promise((resolve, reject) => {
          pending.set(id, { resolve, reject, timer: null });
        }).finally(() => {
          answered = true;
        });
        result.catch(() => {});
        const of = Math.ceil(bytes.length / PIECE_BYTES);
        for (let i = 0; i < of && !answered; i++) {
          while (link.buffered > BUFFERED_MAX && !endedWith)
            await new Promise((r) => setTimeout(r, 50));
          if (endedWith) throw endedWith;
          const d = toB64u(
            bytes.subarray(i * PIECE_BYTES, (i + 1) * PIECE_BYTES),
          );
          const head = i
            ? {}
            : { of, total: bytes.length, sha256: sum, mime: String(mime) };
          await sendSealed({ k: "chunk", stream: id, i, ...head, d });
          onProgress?.((i + 1) / of);
        }
        // The answer comes after the last piece; none in time ends the session, as for ask.
        const p = pending.get(id);
        if (p)
          p.timer = setTimeout(() => {
            pending.delete(id);
            p.reject(new ChannelError("timeout", { action: "stream" }));
            end("timeout", { action: "stream" });
          }, ANSWER_MS);
        r = await result;
        return r;
      } finally {
        pending.delete(id);
        streamsOpen--;
        // A whole stream stays held until an ask names it or the PC drops it; any other end frees its bytes now.
        if (r?.ok && holding.get(id) === kept) {
          kept.timer = setTimeout(() => release(id), STREAM_KEEP_MS);
          kept.timer.unref?.(); // never keeps a Node test run alive
          pump();
        } else release(id);
      }
    },
    // Ends the session on both sides; the link stays open.
    async bye() {
      if (endedWith) return;
      await sendSealed({ k: "bye" }).catch(() => {});
      end("bye");
    },
  };
}
