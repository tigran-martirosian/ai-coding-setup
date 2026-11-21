// The local relay: the same Hub as on Cloudflare, run in plain Node for the tests and for trying the page on the
// PC. node:http serves the page files with the content policy of the pipe design (section 6), `/ws` goes to the
// Hub through ws.mjs, `POST /tg/hook` to the Hub's webhook, the file routes (`POST /pc/send`, `POST /pc/dl/<link>`,
// `GET` or `HEAD /dl/<token>`) to the Hub as streams. The store is a Map the caller can dump whole; with
// `storeFile` it is also kept in that file, so a stopped and started relay has its pairings, as on Cloudflare.
// Hub calls run one at a time, as a Cloudflare object takes its events. A PING is answered outside the Hub with
// its time kept, as Cloudflare's auto-response does. opts.upload (optional): the Hub's streamed Bot API call; without
// it a file send fails with a clear error, as every Bot API call of a relay run by hand does.
//   node phone/relay/local/server.mjs --page <dir> --port <n> --bot-id <n> --owner <tgId> --telegram-key <hex>
//     [--store <file>]
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline, Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";
import { createHub, PING, PONG } from "../src/hub.mjs";
import { upgrade } from "./ws.mjs";

export const CONTENT_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors https://web.telegram.org";

// Strict-Transport-Security: browsers keep to https for two years (the deploy's live probe checks it); over the
// local relay's plain http they ignore it.
export const PAGE_HEADERS = {
  "Content-Security-Policy": CONTENT_POLICY,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
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

// The Hub's store over a Map. Values are copied in and out, as a real store serializes them. save() runs after
// each change.
export function mapStore(map, save = () => {}) {
  const copy = (v) => (v === undefined ? undefined : structuredClone(v));
  return {
    get: (key) => copy(map.get(key)),
    put: (key, value) => {
      map.set(key, copy(value));
      save();
    },
    delete: (key) => {
      map.delete(key);
      save();
    },
    list: (prefix) =>
      [...map.keys()]
        .filter((k) => k.startsWith(prefix))
        .sort()
        .map((k) => [k, copy(map.get(k))]),
  };
}

// Cloudflare's FixedLengthStream in plain Node: passes exactly `length` bytes, errors on more or fewer.
export function fixedLengthStream(length) {
  let seen = 0;
  return new TransformStream({
    transform(chunk, out) {
      seen += chunk.byteLength;
      if (seen > length)
        throw new Error(`fixed-length stream: more than ${length} bytes`);
      out.enqueue(chunk);
    },
    flush() {
      if (seen !== length)
        throw new Error(`fixed-length stream: ${seen} of ${length} bytes`);
    },
  });
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

// The store file: the Map's entries in v8 serialization (the structured clone a Cloudflare store keeps), written
// whole to a side file and renamed over, so a stop mid-write leaves the last good copy.
function loadStore(file) {
  if (!fs.existsSync(file)) return new Map();
  return new Map(v8.deserialize(fs.readFileSync(file)));
}
function saveStore(file, map) {
  fs.writeFileSync(`${file}.part`, v8.serialize([...map]));
  fs.renameSync(`${file}.part`, file);
}

// Starts the local relay. Returns { url, map, hub, idle(), close() }: idle() waits until the Hub has handled
// everything received so far. opts.storeFile (optional): the file the store is read from at start and kept in.
export async function startLocalRelay(opts) {
  for (const name of REQUIRED) {
    if (opts[name] === undefined)
      throw new Error(`local relay: missing ${name}`);
  }
  const pageDir = path.resolve(opts.pageDir);
  if (!fs.statSync(pageDir).isDirectory())
    throw new Error(`local relay: ${pageDir} is not a folder`);

  const storeFile = opts.storeFile ? path.resolve(opts.storeFile) : null;
  const map = storeFile ? loadStore(storeFile) : new Map();
  const save = storeFile ? () => saveStore(storeFile, map) : () => {};
  const conns = new Set();
  const sockets = {
    accept: (c) => void conns.add(c),
    all: () => [...conns].filter((c) => !c.closed),
    attachment: (c) => (c.attachment ? structuredClone(c.attachment) : null),
    setAttachment: (c, value) => void (c.attachment = structuredClone(value)),
    send: (c, text) => c.send(text),
    close: (c, code, reason) => c.close(code, reason),
    lastPing: (c) => c.lastPing || null,
  };
  const hub = createHub({
    store: mapStore(map, save),
    sockets,
    telegram: opts.telegram,
    upload:
      opts.upload ??
      (async () => {
        throw new Error("the local relay was given no upload (file send)");
      }),
    fixedStream: fixedLengthStream,
    download: opts.download,
    now: opts.now,
    log: opts.log,
    botId: opts.botId,
    ownerTgId: opts.ownerTgId,
    telegramKey: opts.telegramKey,
    // Optional here, as on Cloudflare where only the test copy sets TOPIC_SUFFIX.
    topicSuffix: opts.topicSuffix ?? "",
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

  // The file routes wait on the network for minutes, so they run beside the queue, as a Cloudflare object takes
  // other events while it waits on a fetch. A request body becomes a stream only when the Hub reads it, so a refused
  // body is drained by node:http.
  async function fileRoute(req, res, pathname) {
    const fromPc = !pathname.startsWith("/dl/");
    if (fromPc && req.method !== "POST") return answer(res, 405, "POST only");
    if (!fromPc && req.method !== "GET" && req.method !== "HEAD")
      return answer(res, 405, "GET only");
    let body = null;
    const call = {
      headers: req.headers,
      get body() {
        body ??= Readable.toWeb(req);
        return body;
      },
    };
    let r;
    try {
      if (pathname === "/pc/send") r = await hub.pcSend(call);
      else if (fromPc) r = await hub.pcDl(pathname.slice(7), call);
      else r = await hub.download(pathname.slice(4), req.method);
    } catch (err) {
      opts.log(`hub error: ${err.message}`);
      return answer(res, 500, "hub error");
    }
    res.writeHead(r.status, r.headers);
    if (!(r.body instanceof ReadableStream))
      return res.end(r.body ?? undefined);
    // The headers go at once, as a Cloudflare Response's do: a download's bytes come only after its dl-pull.
    res.flushHeaders();
    pipeline(Readable.fromWeb(r.body), res, () => {});
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://local");
    const p = url.pathname;
    if (p === "/pc/send" || p.startsWith("/pc/dl/") || p.startsWith("/dl/"))
      return void fileRoute(req, res, p);
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
      onMessage: (text) => {
        if (text !== PING) return run(conn, () => hub.message(conn, text));
        conn.lastPing = new Date(opts.now());
        conn.send(PONG);
      },
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
      // The caller may have written the Map directly.
      save();
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
  const storeAt = args.indexOf("--store");
  const relay = await startLocalRelay({
    port: Number(arg("port")),
    pageDir: arg("page"),
    storeFile: storeAt < 0 ? null : arg("store"),
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
