// The local relay: the same Hub as on Cloudflare, run in plain Node for the tests and for trying the page on the
// PC. node:http serves the page files with the content policy of the pipe design (section 6), `/ws` goes to the
// Hub through ws.mjs, `POST /tg/hook` to the Hub's webhook. The store is a Map the caller can dump whole.
// Hub calls run one at a time, as a Cloudflare object takes its events.
//   node phone/relay/local/server.mjs --page <dir> --port <n> --bot-id <n> --owner <tgId> --telegram-key <hex>
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHub } from "../src/hub.mjs";
import { upgrade } from "./ws.mjs";

export const CONTENT_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors https://web.telegram.org";

export const PAGE_HEADERS = {
  "Content-Security-Policy": CONTENT_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

// The Hub's store over a Map. Values are copied in and out, as a real store serializes them.
export function mapStore(map) {
  const copy = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    get: (key) => copy(map.get(key)),
    put: (key, value) => void map.set(key, copy(value)),
    delete: (key) => void map.delete(key),
    list: (prefix) =>
      [...map.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((k) => [k, copy(map.get(k))]),
  };
}

const REQUIRED = [
  "port",
  "pageDir",
  "botId",
  "ownerTgId",
  "telegramKey",
  "telegram",
  "download",
  "now",
  "log",
  "bot",
];

// Starts the local relay. Returns { url, map, hub, idle(), close() }: idle() waits until the Hub has handled
// everything received so far.
export async function startLocalRelay(opts) {
  for (const name of REQUIRED) {
    if (opts[name] === undefined)
      throw new Error(`local relay: missing ${name}`);
  }
  const pageDir = path.resolve(opts.pageDir);
  if (!fs.statSync(pageDir).isDirectory())
    throw new Error(`local relay: ${pageDir} is not a folder`);

  const map = new Map();
  const conns = new Set();
  const sockets = {
    accept: (c) => void conns.add(c),
    all: () => [...conns].filter((c) => !c.closed),
    attachment: (c) => (c.attachment ? structuredClone(c.attachment) : null),
    setAttachment: (c, value) => void (c.attachment = structuredClone(value)),
    send: (c, text) => c.send(text),
    close: (c, code, reason) => c.close(code, reason),
  };
  const hub = createHub({
    store: mapStore(map),
    sockets,
    telegram: opts.telegram,
    download: opts.download,
    now: opts.now,
    log: opts.log,
    botId: opts.botId,
    ownerTgId: opts.ownerTgId,
    telegramKey: opts.telegramKey,
    bot: opts.bot,
  });

  let queue = Promise.resolve();
  const run = (conn, job) => {
    queue = queue.then(job).catch((err) => {
      opts.log(`hub error: ${err.message}`);
      if (conn) conn.close(1011, "error");
    });
    return queue;
  };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://local");
    if (url.pathname === "/tg/hook") {
      if (req.method !== "POST") return answer(res, 405, "POST only");
      const chunks = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        run(null, async () => {
          const r = await hub.webhook({
            headers: req.headers,
            body,
            origin: `http://127.0.0.1:${server.address().port}`,
          });
          answer(res, r.status, r.body);
        }).then(() => res.headersSent || answer(res, 500, "hub error"));
      });
      return;
    }
    if (req.method !== "GET" && req.method !== "HEAD")
      return answer(res, 405, "GET only");
    const name = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.resolve(pageDir, decodeURIComponent(name));
    if (!file.startsWith(pageDir + path.sep) || !fs.existsSync(file))
      return answer(res, 404, "not found", PAGE_HEADERS);
    const type = TYPES[path.extname(file)];
    if (!type) return answer(res, 404, "unknown file type", PAGE_HEADERS);
    res.writeHead(200, { "Content-Type": type, ...PAGE_HEADERS });
    res.end(req.method === "HEAD" ? undefined : fs.readFileSync(file));
  });

  server.on("upgrade", (req, socket, head) => {
    if (new URL(req.url, "http://local").pathname !== "/ws") {
      socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      return;
    }
    const conn = upgrade(req, socket, head, {
      onMessage: (text) => run(conn, () => hub.message(conn, text)),
      onClose: () => {
        run(conn, () => hub.closed(conn));
        conns.delete(conn);
      },
    });
    if (conn) run(conn, () => hub.open(conn, { origin: url() }));
  });

  await new Promise((done, failed) => {
    server.once("error", failed);
    server.listen(opts.port, "127.0.0.1", done);
  });
  const url = () => `http://127.0.0.1:${server.address().port}`;

  return {
    url: url(),
    map,
    hub,
    idle: () => queue,
    close: async () => {
      for (const c of conns) c.close(1001, "going-away");
      await queue;
      await new Promise((done) => server.close(done));
    },
  };
}

function answer(res, status, text, headers = {}) {
  res.writeHead(status, {
    "Content-Type": "text/plain; charset=utf-8",
    ...headers,
  });
  res.end(text);
}

// ---- run by hand ----

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const args = process.argv.slice(2);
  const arg = (name) => {
    const i = args.indexOf(`--${name}`);
    if (i < 0 || !args[i + 1]) {
      console.error(
        `missing --${name}. Usage: node server.mjs --page <dir> --port <n> --bot-id <n> --owner <tgId> --telegram-key <hex>`,
      );
      process.exit(2);
    }
    return args[i + 1];
  };
  const offline = (what) => async () => {
    throw new Error(`the local relay does not reach Telegram (${what})`);
  };
  const relay = await startLocalRelay({
    port: Number(arg("port")),
    pageDir: arg("page"),
    botId: Number(arg("bot-id")),
    ownerTgId: Number(arg("owner")),
    telegramKey: arg("telegram-key"),
    telegram: offline("Bot API call"),
    download: offline("file download"),
    now: Date.now,
    log: (line) => console.log(line),
    bot: null,
  });
  console.log(`local relay at ${relay.url}`);
}
