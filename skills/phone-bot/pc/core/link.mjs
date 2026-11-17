// The relay socket. The PC dials out (Node 24's built-in WebSocket), proves itself with pc-auth (or pc-join the
// first time) and pings every 20 s (phone steady design, section 2). A socket with no pong 10 s after a ping, or not
// accepted 10 s after it was made, is given up at once, without waiting for its close. Retries wait a random time
// between 0.25 s and 2^n s (at most 60 s); n goes back to 0 only after a link stayed up 30 s.
import { PROTOCOL } from "../../../../phone/shared/seal.mjs";
import { log } from "./log.mjs";
import { TEST } from "./mode.mjs";

// Tests pass shorter times, a WebSocket stand-in and their own random.
export const TIMING = {
  pingMs: 20_000,
  pongMs: 10_000,
  connectMs: 10_000,
  healthyMs: 30_000,
  floorMs: 250,
  baseMs: 1000,
  capMs: 60_000,
  random: (lo, hi) => lo + Math.random() * (hi - lo),
};
// The `ping` field of the first frame: the relay closes this socket after 2 x 20 s + 10 s of silence.
const PING_EVERY = 20;

// https://host -> wss://host/ws. Plain http only in test mode, for the stand-in relay on 127.0.0.1.
export function socketUrl(relay) {
  const u = new URL(relay);
  if (u.protocol === "https:") u.protocol = "wss:";
  else if (u.protocol === "http:" && TEST) u.protocol = "ws:";
  else throw new Error(`the relay address must start with https://`);
  u.pathname = "/ws";
  return u.href;
}

// keys: the key file's content (joined, pcId, token, inbox.pub). onFrame(frame) gets every frame but pong.
// onReady(frame) runs when the relay has accepted the PC. Returns { send, stop, start, drop, timers }.
export function openLink({
  keys,
  version,
  onFrame,
  onReady,
  saveKeys,
  timing = TIMING,
  Socket = WebSocket,
}) {
  let ws = null;
  let attempt = 0;
  let stopped = false;
  let timer = null;
  let watch = []; // the current socket's timers: attempt limit, ping, pong wait, healthy mark

  const send = (obj) => {
    if (!ws || ws.readyState !== Socket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  };

  const quiet = () => {
    for (const t of watch) clearTimeout(t);
    watch = [];
  };

  function later() {
    if (stopped) return;
    const hi = Math.min(
      timing.capMs,
      timing.baseMs * 2 ** Math.min(attempt, 30),
    );
    attempt++;
    timer = setTimeout(connect, timing.random(timing.floorMs, hi));
  }

  // Gives up the current socket after a check found it dead: it is closed, but its close is not waited for (a
  // half-open link may never send one) and is ignored when it comes.
  function giveUp(sock, why) {
    if (ws !== sock) return;
    ws = null;
    quiet();
    log("lost", why);
    try {
      sock.close(4000, "dead-link");
    } catch (e) {
      log("lost", `close failed: ${e.message}`);
    }
    later();
  }

  function connect() {
    timer = null;
    if (stopped) return;
    const sock = new Socket(socketUrl(keys.relay));
    ws = sock;
    let pong = null;
    let accepted = false;
    const limit = setTimeout(
      () => giveUp(sock, `not accepted in ${timing.connectMs / 1000} s`),
      timing.connectMs,
    );
    watch.push(limit);
    sock.onopen = () => {
      if (ws !== sock) return;
      const first = keys.joined
        ? {
            v: PROTOCOL,
            t: "pc-auth",
            pcId: keys.pcId,
            token: keys.token,
            ping: PING_EVERY,
          }
        : {
            v: PROTOCOL,
            t: "pc-join",
            pcId: keys.pcId,
            token: keys.token,
            inboxPub: keys.inbox.pub,
            pcVersion: version,
            ping: PING_EVERY,
          };
      sock.send(JSON.stringify(first));
      watch.push(
        setInterval(() => {
          if (ws !== sock) return;
          sock.send('{"t":"ping"}');
          if (pong) return;
          pong = setTimeout(
            () => giveUp(sock, `no pong in ${timing.pongMs / 1000} s`),
            timing.pongMs,
          );
          watch.push(pong);
        }, timing.pingMs),
      );
      log("connect", keys.joined ? "pc-auth" : "pc-join");
    };
    sock.onmessage = (ev) => {
      if (ws !== sock || typeof ev.data !== "string") return;
      let f;
      try {
        f = JSON.parse(ev.data);
      } catch {
        log("drop", "relay frame is not JSON");
        return;
      }
      if (f.t === "pong") {
        // A link up for days answers thousands of pings: each answered wait leaves the list, so it never grows.
        clearTimeout(pong);
        watch = watch.filter((t) => t !== pong);
        pong = null;
        return;
      }
      // The relay accepts the PC by answering its first frame's type with ok: true.
      if ((f.t === "pc-auth" || f.t === "pc-join") && f.ok === true) {
        if (accepted) return; // a repeated ok (a broken or hostile relay) adds nothing
        accepted = true;
        clearTimeout(limit);
        // A link that drops right after it is accepted keeps its wait growing: no tight loop.
        watch.push(
          setTimeout(() => {
            attempt = 0;
          }, timing.healthyMs),
        );
        if (!keys.joined) {
          keys.joined = true;
          saveKeys(keys);
        }
        onReady(f);
        return;
      }
      onFrame(f);
    };
    sock.onclose = (ev) => {
      if (ws !== sock) return;
      ws = null;
      quiet();
      log("closed", `${ev.code} ${String(ev.reason).slice(0, 40)}`);
      if (ev.code === 4409 && ev.reason === "pc-exists" && !keys.joined) {
        // Only the holder of the token can name this pcId, so the record is this PC's own.
        keys.joined = true;
        saveKeys(keys);
      } else if (ev.code === 4401 || ev.code === 4409) {
        stopped = true;
        log("stopped", "the relay refused this PC: run setup.mjs join again");
        return;
      } else if (ev.code === 4408) {
        // Unpaired for 15 minutes: the relay dropped the record. `pair` starts again with pc-join.
        keys.joined = false;
        saveKeys(keys);
        stopped = true;
        log("stopped", "no phone paired in 15 minutes: run setup.mjs pair");
        return;
      }
      later();
    };
    sock.onerror = () => {};
  }

  return {
    send,
    start() {
      if (ws || timer) return;
      stopped = false;
      attempt = 0;
      connect();
    },
    stop() {
      stopped = true;
      clearTimeout(timer);
      timer = null;
      quiet();
      ws?.close(1000, "stop");
      ws = null;
    },
    // Closes the socket so the next connect starts fresh (used by tests and after join).
    drop: () => ws?.close(4000, "drop"),
    // How many timers the current socket holds (tests check a long link does not pile them up).
    timers: () => watch.length,
  };
}
