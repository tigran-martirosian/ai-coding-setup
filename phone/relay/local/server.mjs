// The local relay: the same Hub as on Cloudflare, run in plain Node for the tests and for trying the page on the
// PC. node:http serves the page files with the content policy of the pipe design (section 6), packed with br or gzip
// when asked, with an ETag and a 304 to a repeat (Cloudflare's static assets do the same), `/ws` goes to the
// Hub through ws.mjs, `POST /tg/hook` to the Hub's webhook, the file routes (`POST /pc/send`, `POST /pc/dl/<link>`,
// `GET` or `HEAD /dl/<token>`) to the Hub as streams. The store is a Map the caller can dump whole; with
// `storeFile` it is also kept in that file, so a stopped and started relay has its pairings, as on Cloudflare.
// Hub calls run one at a time, as a Cloudflare object takes its events. A PING is answered outside the Hub with
// its time kept, as Cloudflare's auto-response does. opts.upload (optional): the Hub's streamed Bot API call; without
// it a file send fails with a clear error, as every Bot API call of a relay run by hand does.
//   node phone/relay/local/server.mjs --page <dir> --port <n> --bot-id <n> --owner <tgId> --telegram-key <hex>
//     [--store <file>]
import { createHash } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { pipeline, Readable } from "node:stream";
import { pathToFileURL } from "node:url";
import v8 from "node:v8";
import zlib from "node:zlib";
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

// Starts the local relay. Returns { url, map, hub, idle(), heal(), sleep(), close() }: idle() waits until the Hub has
// handled everything received so far; heal() runs the scheduled webhook check; sleep() then drops the Hub's memory,
// as a Cloudflare object put to sleep. opts.storeFile (optional): the file the store is read from at start and kept
// in. opts.webhookSecret (optional): the secret heal() sets the webhook with.
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
  // Cloudflare builds the Hub again each time the object wakes from sleep: the store, the sockets and their
  // attachments are kept, the Hub's memory is not. sleep() does the same here.
  const makeHub = () =>
    createHub({
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
  let hub = makeHub();

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
    // Fires when the client breaks off before the answer is sent, as Cloudflare's request.signal does.
    const brokenOff = new AbortController();
    res.on("close", () => {
      if (!res.writableFinished) brokenOff.abort();
    });
    const call = {
      headers: req.headers,
      signal: brokenOff.signal,
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
    const { etag, body, encoding } = pageFile(
      file,
      req.headers["accept-encoding"],
    );
    // no-cache: the phone keeps the file but asks each time, as Cloudflare's assets answer; the names carry no
    // hash, so nothing may be kept as immutable.
    const headers = {
      "Content-Type": type,
      ETag: etag,
      Vary: "Accept-Encoding",
      "Cache-Control": "no-cache",
      ...PAGE_HEADERS,
    };
    if (matches(req.headers["if-none-match"], etag)) {
      res.writeHead(304, headers);
      return res.end();
    }
    if (encoding) headers["Content-Encoding"] = encoding;
    res.writeHead(200, { ...headers, "Content-Length": body.length });
    res.end(req.method === "HEAD" ? undefined : body);
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
    get hub() {
      return hub;
    },
    idle: () => queue,
    // The scheduled webhook check, as Cloudflare's cron runs it (worker.mjs `scheduled`): in the Hub's turn, with
    // this relay's address and opts.webhookSecret. Returns the Hub's answer; an error is thrown, not logged.
    heal: () => {
      const job = queue.then(() =>
        hub.heal({ origin: url(), webhookSecret: opts.webhookSecret }),
      );
      queue = job.catch(() => {});
      return job;
    },
    sleep: async () => {
      await queue;
      hub = makeHub();
    },
    close: async () => {
      for (const c of conns) c.close(1001, "going-away");
      await queue;
      // The caller may have written the Map directly.
      save();
      await new Promise((done) => server.close(done));
    },
  };
}

// A page file as sent: br or gzip when the client asks and the type packs well, with an ETag from its bytes and the
// encoding (one ETag per form, as each form is other bytes). Each form is made once and kept until the file changes:
// its size, modified time, change time or file number (a tool may write the same size and put the old modified
// time back; the change time then still moves, and a file put in by rename has a new number).
const PACKED = new Set([".html", ".js", ".mjs", ".css", ".json", ".svg"]);
const STAT_KEYS = ["size", "mtimeMs", "ctimeMs", "ino"];
const pageCache = new Map();
function pageFile(file, acceptEncoding) {
  const stat = fs.statSync(file);
  let entry = pageCache.get(file);
  if (!entry || STAT_KEYS.some((k) => entry.stat[k] !== stat[k])) {
    const raw = fs.readFileSync(file);
    entry = {
      stat: Object.fromEntries(STAT_KEYS.map((k) => [k, stat[k]])),
      raw,
      hash: createHash("sha256").update(raw).digest("base64url").slice(0, 22),
      packed: {},
    };
    pageCache.set(file, entry);
  }
  const encoding = PACKED.has(path.extname(file))
    ? pickEncoding(acceptEncoding)
    : null;
  if (!encoding)
    return { etag: `"${entry.hash}"`, body: entry.raw, encoding: null };
  // Brotli at level 5, not its default 11: 11 took 1.2 s for the page's files on a fast PC, all of it blocking, and
  // a slower CI runner stalled past the 5 s a scaled test gives a socket between pings.
  entry.packed[encoding] ??=
    encoding === "br"
      ? zlib.brotliCompressSync(entry.raw, {
          params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 },
        })
      : zlib.gzipSync(entry.raw);
  return {
    etag: `"${entry.hash}-${encoding}"`,
    body: entry.packed[encoding],
    encoding,
  };
}

// br or gzip, whichever Accept-Encoding ranks higher by its q-values (RFC 9110; no q is 1, `*` stands for any
// coding not named, q=0 refuses); br on a tie; null when it allows neither.
function pickEncoding(acceptEncoding) {
  const ranked = new Map();
  for (const part of String(acceptEncoding ?? "").split(",")) {
    const [name, ...params] = part.split(";").map((s) => s.trim());
    if (!name) continue;
    const q = params.find((p) => /^q=/i.test(p));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    ranked.set(name.toLowerCase(), Number.isFinite(weight) ? weight : 0);
  }
  const weight = (name) => ranked.get(name) ?? ranked.get("*") ?? 0;
  return (
    ["br", "gzip"]
      .filter((name) => weight(name) > 0)
      .sort((a, b) => weight(b) - weight(a))[0] ?? null
  );
}

// If-None-Match against an ETag: `*` or any listed tag, weak or strong (RFC 9110, weak comparison).
function matches(ifNoneMatch, etag) {
  if (!ifNoneMatch) return false;
  if (ifNoneMatch.trim() === "*") return true;
  return ifNoneMatch
    .split(",")
    .some((tag) => tag.trim().replace(/^W\//, "") === etag);
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
