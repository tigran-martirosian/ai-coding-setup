// The sealed app channel, one per paired device (pipe design, sections 2 and 4). A frame from a device id that is
// not in the key file is dropped. `hello` (n = 0) is sealed with K and starts a channel session; every later frame
// uses that session's key, and its counter n must be exactly one more than the last, else the session ends and the
// page has to say hello again.
// Large payloads come as a stream of `chunk` frames (pipe design, section 4): the pieces are joined in order, the
// length and SHA-256 checked, and the stream id answered with `res` ok ({ stream, bytes }) or `stream-broken`. A
// whole stream waits for an action to take it with ctx.takeStream(id) (voice.transcribe), at most a minute; the
// answer to a request that names it (`d.stream`) drops it when the action did not take it.
import { createHash } from "node:crypto";
import {
  fromB64u,
  openFrame,
  openHello,
  PROTOCOL,
  randomBytes,
  sealFrame,
  sealHello,
  sessionKeys,
  toB64u,
} from "../../../../phone/shared/seal.mjs";
import { log } from "./log.mjs";

const SID = /^[A-Za-z0-9_-]{1,64}$/;
const B64U = /^[A-Za-z0-9_-]*$/;
const SHA_HEX = /^[0-9a-f]{64}$/;
export const PIECE_BYTES = 192 * 1024;
// Every stream (a Files drop-in, a voice note, an attachment); attach.mjs keeps attachments to 25 MB per device.
export const STREAM_MAX = 50 * 1024 * 1024;
const STREAMS_OPEN = 2;
// Bytes one channel session holds: streams still arriving (their full size) and whole ones no action took yet.
export const STREAMS_HELD_MAX = 50 * 1024 * 1024;
const STREAM_IDLE_MS = 60_000;
const STREAM_KEEP_MS = 60_000;

// keys: the key file's content; send(frame) writes to the relay; registry handles requests;
// context() gives the fields every action sees besides `device`, `push`, `pushHere`, `onEnd` and `takeStream`
// ({ page, setupVersion }). `push` goes to every device, `pushHere` only to the asking device's channel session;
// `onEnd(fn)` calls fn(why) once when that channel session ends (bye, counter gap, bad frame, new hello, device
// removed) and returns a function that takes the hook back; `takeStream(id)` gives a whole stream of this channel
// session ({ bytes: Buffer, mime }) once, or null. onHello(dev), optional (main.mjs always passes it), is called once a device's channel session has
// started (the device join confirms an entry and sends its cards there). A hello from a device the key file does
// not hold (a removed one) gets `app-fail { dev, reason: "unknown-device" }` outside the seal. A device that removes
// itself (devices.remove of its own id, Settings' Unpair) still gets that one answer, sealed with the session that
// the removal ended, so the page knows the PC forgot it.
export function createChannel({
  keys,
  send,
  registry,
  context,
  pcVersion,
  onHello,
}) {
  const sessions = new Map(); // dev -> { sid, in, out, nIn, nOut, queue, ends, streams, whole }

  // Ends a device's channel session and tells everyone who asked with onEnd.
  function end(dev, why) {
    const s = sessions.get(dev);
    if (!s) return;
    sessions.delete(dev);
    s.endedBy = why;
    for (const st of [...s.streams.values(), ...s.whole.values()])
      clearTimeout(st.timer);
    for (const fn of s.ends.splice(0)) {
      try {
        fn(why);
      } catch (e) {
        log("error", `end hook: ${e.message}`);
      }
    }
  }

  const header = (dev, sid, n) => ({ v: PROTOCOL, t: "app", dev, sid, n });

  // Frames of one session leave in counter order, one seal at a time. `last`: the session has ended, and this is
  // the answer to the request that removed the device itself.
  function sendSealed(dev, s, body, last = false) {
    s.queue = s.queue.then(async () => {
      if (!last && sessions.get(dev) !== s) return;
      s.nOut++;
      const h = header(dev, s.sid, s.nOut);
      send({ ...h, c: await sealFrame(s.out, h, body) });
    });
    return s.queue;
  }

  function push(evt) {
    for (const [dev, s] of sessions) sendSealed(dev, s, { k: "evt", ...evt });
  }

  async function hello(f, device) {
    const K = fromB64u(device.K);
    const h = header(f.dev, f.sid, 0);
    const body = await openHello(K, h, f.c);
    if (!body || body.k !== "hello") return log("drop", "hello does not open");
    let np;
    try {
      np = fromB64u(body.np);
    } catch {
      np = null;
    }
    if (!np || np.length !== 16) return log("drop", "hello without nonce");
    const npc = randomBytes(16);
    const reply = {
      k: "hello",
      npc: toB64u(npc),
      pcVersion,
      protocol: PROTOCOL,
      page: context().page,
      // The action names this PC answers, so the page greys a screen whose actions are missing (26.3.3 sent none).
      actions: registry.names(),
      // Send, Queue, Note and New session take a message id: a repeat gets the first answer (core/sent-ids.mjs).
      ids: registry.takesIds === true,
    };
    send({ ...h, c: await sealHello(K, h, reply) });
    end(f.dev, "hello");
    if (body.protocol !== PROTOCOL)
      return log("protocol", `page ${body.protocol}, PC ${PROTOCOL}`);
    if (body.pageVersion !== pcVersion)
      log(
        "version",
        `page ${String(body.pageVersion).slice(0, 12)}, PC ${pcVersion}`,
      );
    const k = await sessionKeys(K, np, npc);
    sessions.set(f.dev, {
      sid: f.sid,
      in: k.p2pc,
      out: k.pc2p,
      nIn: 0,
      nOut: 0,
      queue: Promise.resolve(),
      ends: [],
      streams: new Map(), // id -> { of, total, sha256, mime, parts, got, timer } while pieces come
      whole: new Map(), // id -> { bytes, mime, timer } until an action takes it
    });
    device.lastSeen = new Date().toISOString();
    log("hello", "channel session started");
    onHello?.(f.dev);
  }

  // One frame of a device at a time: the counter check, the open and the new counter happen as one step, so a
  // frame sent twice runs once and two honest frames sent back to back are both taken. Resolves with the request
  // to run, if the frame is one; the request itself runs outside the line, so a slow action holds up no other.
  async function take(f, device) {
    // The device may have been removed while this frame waited in its line.
    if (!keys.devices.includes(device))
      return log("drop", "device removed while its frame waited");
    if (f.n === 0) return hello(f, device);
    const s = sessions.get(f.dev);
    if (!s || s.sid !== f.sid) return log("drop", "no channel session");
    // Anyone on the relay path can send a frame under this device's id: only a frame that opens changes the
    // session, so a forged frame or an old one sent again is dropped and the session stays.
    if (f.n <= s.nIn) return log("drop", "old counter");
    const body = await openFrame(s.in, header(f.dev, f.sid, f.n), f.c);
    if (!body) return log("drop", "frame does not open");
    if (f.n !== s.nIn + 1) {
      end(f.dev, "counter-gap");
      return log("drop", "counter gap: session ended");
    }
    s.nIn = f.n;
    if (body.k === "bye") return end(f.dev, "bye");
    if (body.k === "chunk") {
      const res = takeChunk(f.dev, s, body);
      if (res) await sendSealed(f.dev, s, res);
      return;
    }
    if (body.k !== "req")
      return log("drop", `unexpected ${String(body.k).slice(0, 12)}`);
    return { s, body };
  }

  // One piece of a stream. Pieces come in counter order (one frame of a device at a time), so a piece out of
  // order is a sender's mistake. Returns the answer to send once the stream is whole or broken, else null.
  function takeChunk(dev, s, c) {
    const id =
      typeof c.stream === "string" && SID.test(c.stream) ? c.stream : null;
    const broken = (why) => {
      const st = id && s.streams.get(id);
      if (st) {
        clearTimeout(st.timer);
        s.streams.delete(id);
      }
      log("stream", `broken: ${why}`);
      return { k: "res", id, ok: false, err: "stream-broken", why };
    };
    if (!id) return broken("no stream id");
    let st = s.streams.get(id);
    if (c.i === 0) {
      if (st || s.whole.has(id)) return broken("a stream id used twice");
      if (s.streams.size >= STREAMS_OPEN)
        return broken(`more than ${STREAMS_OPEN} streams open`);
      if (!Number.isSafeInteger(c.total) || c.total < 1)
        return broken("no size");
      if (c.total > STREAM_MAX)
        return broken(`${c.total} bytes is over the 50 MB limit`);
      let held = c.total;
      for (const o of s.streams.values()) held += o.total;
      for (const w of s.whole.values()) held += w.bytes.length;
      if (held > STREAMS_HELD_MAX)
        return broken(
          "the PC already holds 50 MB of this device's streams not yet used",
        );
      if (c.of !== Math.ceil(c.total / PIECE_BYTES))
        return broken("the piece count does not fit the size");
      if (typeof c.sha256 !== "string" || !SHA_HEX.test(c.sha256))
        return broken("no SHA-256");
      if (typeof c.mime !== "string" || !c.mime || c.mime.length > 100)
        return broken("no mime");
      st = {
        of: c.of,
        total: c.total,
        sha256: c.sha256,
        mime: c.mime,
        parts: [],
        got: 0,
        timer: null,
      };
      s.streams.set(id, st);
    } else if (!st) return broken("a piece of no open stream");
    if (c.i !== st.parts.length) return broken("a piece out of order");
    if (typeof c.d !== "string" || !B64U.test(c.d))
      return broken("a piece that is not base64url");
    const bytes = Buffer.from(c.d, "base64url");
    const last = st.parts.length === st.of - 1;
    if (bytes.length > PIECE_BYTES || (!last && bytes.length !== PIECE_BYTES))
      return broken("a piece of the wrong size");
    st.parts.push(bytes);
    st.got += bytes.length;
    clearTimeout(st.timer);
    if (!last) {
      st.timer = setTimeout(() => {
        if (s.streams.get(id) !== st) return;
        const res = broken("no piece for 60 seconds");
        sendSealed(dev, s, res).catch(() => {});
      }, STREAM_IDLE_MS);
      st.timer.unref?.();
      return null;
    }
    s.streams.delete(id);
    const all = Buffer.concat(st.parts);
    const sha = createHash("sha256").update(all).digest("hex");
    if (all.length !== st.total || sha !== st.sha256)
      return broken("the length or SHA-256 does not match");
    const kept = { bytes: all, mime: st.mime, timer: null };
    kept.timer = setTimeout(() => s.whole.delete(id), STREAM_KEEP_MS);
    kept.timer.unref?.();
    s.whole.set(id, kept);
    log("stream", `whole: ${all.length} bytes`);
    return { k: "res", id, ok: true, d: { stream: id, bytes: all.length } };
  }

  const lines = new Map(); // dev -> the last frame's turn in that device's line

  async function onApp(f) {
    if (
      typeof f.sid !== "string" ||
      !SID.test(f.sid) ||
      !Number.isSafeInteger(f.n)
    )
      return log("drop", "bad app header");
    const device = keys.devices.find((d) => d.device === f.dev);
    if (!device) {
      if (f.n === 0 && typeof f.dev === "string")
        send({
          v: PROTOCOL,
          t: "app-fail",
          dev: f.dev,
          reason: "unknown-device",
        });
      return log("drop", "unpaired device");
    }
    const turn = (lines.get(f.dev) ?? Promise.resolve()).then(() =>
      take(f, device),
    );
    const tail = turn.catch(() => {});
    lines.set(f.dev, tail);
    tail.then(() => lines.get(f.dev) === tail && lines.delete(f.dev));
    const req = await turn;
    if (!req) return;
    const { s } = req;
    // A device removed while its frame was opened: the request does not run.
    if (!keys.devices.includes(device))
      return log("drop", "device removed before its request ran");
    let took = false;
    const res = await registry.handle(req.body, {
      ...context(),
      device: f.dev,
      push,
      pushHere: (evt) => sendSealed(f.dev, s, { k: "evt", ...evt }),
      onEnd(fn) {
        // The session may have ended while the action ran.
        if (sessions.get(f.dev) !== s) {
          fn("ended");
          return () => {};
        }
        s.ends.push(fn);
        return () => {
          const i = s.ends.indexOf(fn);
          if (i >= 0) s.ends.splice(i, 1);
        };
      },
      takeStream(id) {
        took = true;
        const kept = s.whole.get(id);
        if (!kept) return null;
        clearTimeout(kept.timer);
        s.whole.delete(id);
        return { bytes: kept.bytes, mime: kept.mime };
      },
    });
    // A request of an action that takes a stream, refused before it took the stream it names, drops it: the page frees
    // the stream's bytes on any answer, so a kept one would hold off the next upload until its minute is up. Another
    // action's request naming the same id (bad-input) leaves the stream to the upload it belongs to.
    const named = req.body.d?.stream;
    const left =
      !took &&
      registry.takesStream(req.body.a) &&
      typeof named === "string" &&
      s.whole.get(named);
    if (left) {
      clearTimeout(left.timer);
      s.whole.delete(named);
      log("stream", "dropped: not taken by its request");
    }
    const unpaired =
      s.endedBy === "removed" &&
      res.ok &&
      req.body.a === "devices.remove" &&
      res.d?.removed === f.dev;
    await sendSealed(f.dev, s, res, unpaired);
  }

  return {
    onApp,
    push,
    // One event to one device's channel session; false when it has none open.
    sendTo(dev, evt) {
      const s = sessions.get(dev);
      if (!s) return false;
      sendSealed(dev, s, { k: "evt", ...evt }).catch((e) =>
        log("error", `send to device: ${e.message}`),
      );
      return true;
    },
    openDevices: () => [...sessions.keys()],
    // Ends a device's channel session (a removed device).
    closeDevice: (dev) => end(dev, "removed"),
  };
}
