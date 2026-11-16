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
const HELLO_MS = 15_000;
const ANSWER_MS = 30_000;
// Large payloads in pieces (pipe design, section 4).
const PIECE_BYTES = 192 * 1024;
export const STREAM_MAX = 25 * 1024 * 1024;
const STREAMS_OPEN = 2;
const BUFFERED_MAX = 1024 * 1024;

// A failure the page shows: `code` is the relay's or the PC's one word (pair-fail reasons, close reasons,
// "pc-offline", "protocol", "timeout", "closed", "counter-gap"), `extra` what came with it.
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

// Opens the relay socket and signs in with `auth { initData }`. The Hub does not answer a good sign-in; a bad one
// closes the socket with 4401 and one word. Resolves once the socket is open and `auth` is sent.
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
    if (!f || typeof f !== "object" || f.t === "pong") return;
    for (const fn of [...listeners]) fn(f);
  };
  ws.onclose = (ev) => {
    closed = { code: ev.code, reason: String(ev.reason || "") };
    markClosed(closed);
  };

  return new Promise((resolve, reject) => {
    ws.onopen = () => {
      ws.send(JSON.stringify({ v: PROTOCOL, t: "auth", initData }));
      resolve(link);
    };
    ws.onerror = () => {
      if (ws.readyState !== 1) reject(new ChannelError("unreachable"));
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

// Starts a channel session: `hello` sealed with K, then one session key per direction. Resolves with
// { hello, ask(action, data, ms), sendStream(bytes, mime, onProgress), bye(), ended } where `hello` is the PC's
// answer ({ pcVersion, protocol, page }) and `ended` resolves with the reason the session stopped. onEvent gets
// every `evt` body the PC pushes.
export async function openSession(link, { K, dev, pageVersion, onEvent }) {
  const sid = toB64u(randomBytes(12));
  const np = randomBytes(16);
  const header = (n) => ({ v: PROTOCOL, t: "app", dev, sid, n });
  const h0 = header(0);
  const answer = link.next(
    (f) =>
      (f.t === "app" && f.dev === dev && f.sid === sid && f.n === 0) ||
      f.t === "offline" ||
      f.t === "error",
    HELLO_MS,
  );
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
  const keys = await sessionKeys(K, np, npc);

  let nOut = 0;
  let nIn = 0;
  let seq = 0;
  let streamsOpen = 0;
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

  const off = link.listen((f) => {
    if (f.t === "app" && f.dev === dev && f.sid === sid && f.n > 0)
      inQueue = inQueue.then(() => take(f));
    else if (f.t === "offline")
      end("pc-offline", { lastSeen: f.lastSeen ?? null });
  });
  const offClose = link.onClose((c) => end(closeCode(c), c));

  return {
    hello: {
      pcVersion: hello.pcVersion,
      protocol: hello.protocol,
      page: hello.page,
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
      const body = { k: "req", id, a: action };
      if (data !== undefined) body.d = data;
      sendSealed(body).catch((e) => end("closed", { message: e.message }));
      return result;
    },
    // Sends `bytes` as a stream of pieces of 192 KB, each its own sealed frame, waiting for the socket to drain
    // under 1 MB before each piece. Resolves with the PC's answer for the stream id ({ ok: true, d: { stream,
    // bytes } } or { ok: false, err: "stream-broken", why }); the caller keeps the bytes until it is ok.
    // onProgress(part) gets 0 to 1 after each piece. Over 25 MB is refused before anything is sent.
    async sendStream(bytes, mime, onProgress) {
      if (endedWith) throw endedWith;
      if (!(bytes instanceof Uint8Array) || !bytes.length)
        throw new ChannelError("no-bytes");
      if (bytes.length > STREAM_MAX)
        throw new ChannelError("too-big", { bytes: bytes.length });
      if (streamsOpen >= STREAMS_OPEN) throw new ChannelError("busy");
      streamsOpen++;
      const id = `s-${++seq}`;
      let answered = false;
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
        return await result;
      } finally {
        pending.delete(id);
        streamsOpen--;
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
