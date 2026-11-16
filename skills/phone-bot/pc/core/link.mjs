// The relay socket. The PC dials out (Node 24's built-in WebSocket), proves itself with pc-auth (or pc-join the
// first time), pings once a minute and reconnects after 1, 2, 5, 10, 30, then every 60 seconds.
import { PROTOCOL } from "../../../../phone/shared/seal.mjs";
import { log } from "./log.mjs";
import { TEST } from "./mode.mjs";

const DELAYS = [1, 2, 5, 10, 30, 60];
const PING_MS = 60_000;

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
// onReady(frame) runs when the relay has accepted the PC. Returns { send, stop, start }.
export function openLink({ keys, version, onFrame, onReady, saveKeys }) {
  let ws = null;
  let attempt = 0;
  let stopped = false;
  let timer = null;
  let ping = null;

  const send = (obj) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(obj));
    return true;
  };

  function later() {
    if (stopped) return;
    const s = DELAYS[Math.min(attempt, DELAYS.length - 1)];
    attempt++;
    timer = setTimeout(connect, s * 1000);
  }

  function connect() {
    timer = null;
    if (stopped) return;
    const sock = new WebSocket(socketUrl(keys.relay));
    ws = sock;
    sock.onopen = () => {
      const first = keys.joined
        ? { v: PROTOCOL, t: "pc-auth", pcId: keys.pcId, token: keys.token }
        : {
            v: PROTOCOL,
            t: "pc-join",
            pcId: keys.pcId,
            token: keys.token,
            inboxPub: keys.inbox.pub,
            pcVersion: version,
          };
      sock.send(JSON.stringify(first));
      ping = setInterval(() => sock.send('{"t":"ping"}'), PING_MS);
      log("connect", keys.joined ? "pc-auth" : "pc-join");
    };
    sock.onmessage = (ev) => {
      if (typeof ev.data !== "string") return;
      let f;
      try {
        f = JSON.parse(ev.data);
      } catch {
        log("drop", "relay frame is not JSON");
        return;
      }
      if (f.t === "pong") return;
      // The relay accepts the PC by answering its first frame's type with ok: true.
      if ((f.t === "pc-auth" || f.t === "pc-join") && f.ok === true) {
        attempt = 0;
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
      clearInterval(ping);
      if (ws === sock) ws = null;
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
      if (ws) ws.close(1000, "stop");
    },
    // Closes the socket so the next connect starts fresh (used by tests and after join).
    drop: () => ws?.close(4000, "drop"),
  };
}
