// The server side of a WebSocket for the local relay, in plain Node (RFC 6455): the upgrade answer and text
// frames in both directions. On Cloudflare the runtime does this; here it lets the tests and the PC program use
// Node's built-in WebSocket client against the same Hub.
import { createHash } from "node:crypto";

const GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const MAX_MESSAGE = 32 * 1024 * 1024; // Cloudflare's received-message limit
const utf8 = new TextDecoder("utf-8", { fatal: true });

// Answers an HTTP upgrade request. Returns the connection { send(text), close(code, reason), closed }, or null
// when the request is not a WebSocket upgrade (it is answered 400). onMessage(text) gets each whole text message;
// onClose(code, reason) runs once, however the socket ends.
export function upgrade(req, socket, head, { onMessage, onClose }) {
  const key = req.headers["sec-websocket-key"];
  if (
    String(req.headers.upgrade).toLowerCase() !== "websocket" ||
    req.headers["sec-websocket-version"] !== "13" ||
    !key
  ) {
    socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    return null;
  }
  const accept = createHash("sha1")
    .update(key + GUID)
    .digest("base64");
  socket.write(
    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\n" +
      `Connection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`,
  );
  socket.setNoDelay(true);

  const conn = { send, close, closed: false };
  let buf = Buffer.from(head || []);
  let parts = [];
  let partsLength = 0;
  let ended = false;

  function write(op, payload) {
    const n = payload.length;
    let header;
    if (n < 126) header = Buffer.from([0x80 | op, n]);
    else if (n < 65536) {
      header = Buffer.from([0x80 | op, 126, 0, 0]);
      header.writeUInt16BE(n, 2);
    } else {
      header = Buffer.alloc(10);
      header[0] = 0x80 | op;
      header[1] = 127;
      header.writeBigUInt64BE(BigInt(n), 2);
    }
    socket.write(Buffer.concat([header, payload]));
  }

  function send(text) {
    if (conn.closed) throw new Error("ws: send on a closed socket");
    write(1, Buffer.from(text, "utf8"));
  }

  function close(code, reason) {
    if (conn.closed) return;
    conn.closed = true;
    const r = Buffer.from(reason || "", "utf8");
    const payload = Buffer.alloc(2 + r.length);
    payload.writeUInt16BE(code, 0);
    r.copy(payload, 2);
    write(8, payload);
    socket.end();
    end(code, reason || "");
  }

  function end(code, reason) {
    if (ended) return;
    ended = true;
    onClose(code, reason);
  }

  function read() {
    while (!conn.closed && buf.length >= 2) {
      const fin = (buf[0] & 0x80) !== 0;
      const op = buf[0] & 0x0f;
      if ((buf[1] & 0x80) === 0) return close(1002, "unmasked");
      let n = buf[1] & 0x7f;
      let at = 2;
      if (n === 126) {
        if (buf.length < 4) return;
        n = buf.readUInt16BE(2);
        at = 4;
      } else if (n === 127) {
        if (buf.length < 10) return;
        const big = buf.readBigUInt64BE(2);
        if (big > BigInt(MAX_MESSAGE)) return close(1009, "too-big");
        n = Number(big);
        at = 10;
      }
      if (buf.length < at + 4 + n) return;
      const mask = buf.subarray(at, at + 4);
      const payload = Buffer.from(buf.subarray(at + 4, at + 4 + n));
      for (let i = 0; i < n; i++) payload[i] ^= mask[i & 3];
      buf = buf.subarray(at + 4 + n);

      if (op === 8) {
        const code = payload.length >= 2 ? payload.readUInt16BE(0) : 1000;
        const reason = payload.subarray(2).toString("utf8");
        conn.closed = true;
        write(8, payload.subarray(0, 2));
        socket.end();
        return end(code, reason);
      }
      if (op === 9) {
        write(10, payload);
        continue;
      }
      if (op === 10) continue;
      if (op === 2) return close(1003, "text-only");
      if (op !== 1 && op !== 0) return close(1002, "bad-opcode");
      partsLength += n;
      if (partsLength > MAX_MESSAGE) return close(1009, "too-big");
      parts.push(payload);
      if (!fin) continue;
      let text;
      try {
        text = utf8.decode(Buffer.concat(parts));
      } catch {
        return close(1007, "bad-utf8");
      }
      parts = [];
      partsLength = 0;
      onMessage(text);
    }
  }

  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    read();
  });
  socket.on("close", () => {
    conn.closed = true;
    end(1006, "");
  });
  socket.on("error", () => socket.destroy());
  // The caller gets the connection before the first message arrives.
  process.nextTick(read);
  return conn;
}
