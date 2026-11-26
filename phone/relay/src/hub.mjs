// The relay's Hub: every rule of the relay in one place, with no Cloudflare import. It checks who connects (the
// Telegram user, the invite list, the PC's token) and passes sealed frames between a phone and its own PC without
// opening them. It writes only the store keys of the pipe design (section 1) and keeps socket state in each
// socket's attachment, because a Cloudflare object loses its memory when it sleeps between messages.
// worker.mjs runs it on Cloudflare, local/server.mjs in plain Node for the tests.
//
// createHub(env) takes, all required:
//   store      get(key), put(key, value), delete(key), list(prefix) -> [[key, value], ...]; sync or async
//   sockets    accept(ws), all() -> open sockets, attachment(ws), setAttachment(ws, value), send(ws, text),
//              close(ws, code, reason), lastPing(ws) -> Date of the last ping answered on it, or null
//   telegram   async (method, params) -> result of the Bot API call
//   upload     async (method, { body, length, type }) -> result of a Bot API call whose body is the stream `body` of
//              `length` bytes of Content-Type `type` (sendDocument's multipart); a refusal throws "telegram <method>: …"
//   fixedStream  (length) -> { readable, writable } that passes exactly `length` bytes and errors on more or fewer
//              (Cloudflare's FixedLengthStream)
//   download   async (filePath) -> bytes of a Telegram file (only the bot uses it)
//   now        () -> milliseconds since 1970
//   log        (line) -> void; never given a token, a key or a frame's contents
//   botId, ownerTgId   numbers; telegramKey   hex of Telegram's Ed25519 public key for initData
//   botToken   the bot's token: a sign-in's initData must carry Telegram's `hash`, the HMAC made with it
//   topicSuffix   text added to the topic names: "" on the real relay, " (test)" on the test copy (TOPIC_SUFFIX)
//   bot       null until the bot is built (row B5), else makeBot(ctx) -> { webhook, pcConnected, pcFrame }:
//              webhook({ headers, body }) -> { status, body }; pcConnected(pcId) on each good pc-auth (send the
//              held forwards); pcFrame(pcId, frame) for `held-ack` and `fetch`. ctx is { store, telegram,
//              download, now, log, botId, ownerTgId, sendToPc(pcId, text) -> bool, closeUser(tgId, code,
//              reason) }.
//
// Wire encodings: pcId is base32 (RFC 4648, upper case, no padding) of 16 bytes; the PC token and inboxPub are
// base64url (no padding) of 32 bytes; stored hashes are hex.

const subtle = globalThis.crypto.subtle;

export const PROTOCOL = 1;
export const PING = '{"t":"ping"}';
export const PONG = '{"t":"pong"}';

const MINUTE = 60_000;
// Dead links (steady design, sections 2 and 3): a socket's first frame may say `ping: 20`; any other socket is taken
// to ping every 60 s, as a PC before 26.3.2 does. Silent for 2 pings and 10 s more, it is closed.
const PING_FAST = 20;
const PING_SLOW = 60;
const DEAD_GRACE = 10_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const UNPAIRED_LIFE = 15 * MINUTE;
const PAIR_WINDOW = 10 * MINUTE;
const INIT_MAX_AGE = DAY;
const INIT_MAX_AHEAD = 5 * MINUTE;
const DAY_SOFT_LIMIT = 90_000;
const MESSAGES_PER_REQUEST = 20;
const JOINS_PER_DAY = 50;
const MAX_UNPAIRED = 20;
const ALERTS_PER_HOUR = 30;
// "<project>: <ending>" or "<project> · <session title>: <ending>"; the title keeps letters and digits of any script.
const ALERT_TEXT =
  /^[A-Za-z0-9 ._-]{1,40}( · [\p{L}\p{N} ._-]{1,60})?: (needs you|finished|handed off, continuing)$/u;
const ALERT_OPEN = /^[A-Za-z0-9_-]{1,16}$/;
// A sent alert is kept as `alert:<chat>:<open handle>` -> { msg, at }: the message id and when, no text. Telegram
// deletes a message only while it is under 48 hours old, so older ones are dropped. bot.mjs reads the same keys.
const ALERT_LIFE = 2 * DAY;
const alertKey = (tgId, open) => `alert:${tgId}:${open}`;
// Topics (files contract, section 7): with the bot's topic mode on, each chat gets an "📥 Inbox" topic for what the
// user sends to the PC, a "💬 Sessions" topic for session alerts and a "📎 Files" topic for documents, made in that order
// (the keys stay inbox, alerts, files; sign-in renames a kept topic to these names). Their
// thread ids are kept as `topics:<chat>` -> { inbox, alerts, files, at }; bot.mjs removes them on the
// `remove-topics` command. Telegram answers a send into a deleted topic "message thread not found" and an edit of
// one "TOPIC_ID_INVALID", but a chat action into one succeeds (checked live 2026-11-18), so a kept topic is checked
// with an edit of its own name.
export const TOPIC_NAMES = {
  inbox: "📥 Inbox",
  alerts: "💬 Sessions",
  files: "📎 Files",
};
const topicKey = (tgId) => `topics:${tgId}`;
const THREAD_GONE = /message thread not found|TOPIC_ID_INVALID/i;
// Files to Telegram and to a browser (files contract, section 6): kept in the Hub's memory and the PC socket's
// attachment, never in the store, except a download link's few fields for its 2 minutes (`dl:`, below).
const FILE_MAX = 50 * 1024 * 1024;
// Send to chat: Telegram caps the whole sendDocument body at 50 MiB, multipart wrapping included (a 52,428,800-byte
// file failed, 52,428,300 went; trial 2026-11-17), so the file itself stops at 50,000,000 bytes.
export const SEND_MAX = 50_000_000;
const FILES_PER_HOUR = 30; // sends and links together, per PC
const LINK_LIFE = 2 * MINUTE;
const LINKS_PER_PC = 4;
const PULL_WAIT = 20_000; // a link opened: the PC's bytes must start within this
// biome-ignore lint/suspicious/noControlCharactersInRegex: the class names control characters to refuse them in a file name
const FILE_NAME = /^[^\u0000-\u001f\u007f]{1,120}$/u;
const MIME = /^[\w.+-]{1,64}\/[\w.+-]{1,64}$/;
const SIZE = /^[1-9][0-9]{0,15}$/;
const REF = /^[A-Za-z0-9_-]{1,32}$/;
const LINK_TOKEN = /^[A-Za-z0-9_-]{43}$/; // 32 bytes
const EXPIRED = "This link has expired. Make a new one in the app.";
const TELEGRAM_REFUSED = /^telegram \w+: /;
// The webhook's settings besides its address and secret, shared by the deploy's pointBot and the webhook check.
export const WEBHOOK_SETTINGS = {
  allowed_updates: ["message", "callback_query"],
  max_connections: 1,
};
// The webhook check's one store key: { unreached: ms when Telegram was first not reached, or null; setAt: ms of
// the check's last setWebhook, or null; told: the problem the owner was last told of, or null once the webhook is
// healthy again; seen401: { at: ms of a 401 a run saw but did not count, seenAt: ms of that run }, or null; off:
// true once a run without the relay's address logged it }.
const HEAL_KEY = "heal:webhook";
const HEAL_START = {
  unreached: null,
  setAt: null,
  told: null,
  seen401: null,
  off: false,
};
// A 401 sets the webhook again only when it goes on past a run that saw one, at least this long ago (the cron runs
// every 5 minutes), and no longer than the fresh limit ago (an older sighting belongs to another time).
const STALE_SETTLE_MS = 3 * 60_000;
const STALE_FRESH_MS = 15 * 60_000;
const ORIGIN = /^https?:\/\/[^/\s]+$/;
const PC_ID = /^[A-Z2-7]{26}$/;
const B64URL = /^[A-Za-z0-9_-]+$/;
const VERSION = /^[0-9A-Za-z.+-]{1,32}$/;
// A device join by an OK (pipe design, section 15): the Hub routes it for 4 minutes, 5 asks per PC an hour.
const JOIN_WINDOW = 4 * MINUTE;
const JOIN_ASKS_PER_HOUR = 5;
const DEV = /^[A-Za-z0-9_-]{22}$/;
const NONCE = /^[A-Za-z0-9_-]{22}$/; // 16 bytes
const BOX = /^[A-Za-z0-9_-]{123}$/; // 92 bytes: sealBox of a 32-byte key
const REASON = /^[a-z-]{1,24}$/;
// The Hub's own copy of the kinds a device may name, with the words of the bot line.
const KINDS = {
  iphone: "iPhone",
  android: "Android phone",
  desktop: "Telegram Desktop",
  mac: "Telegram for Mac",
  web: "Telegram Web",
  other: "Another device",
};

// Close codes. 4401, 4408 and 4409 are the design's, 4001 the steady design's; the others are this file's.
const CLOSE = {
  dead: 4001,
  auth: 4401,
  timeout: 4408,
  exists: 4409,
  first: 4400,
  removed: 4403,
  limit: 4429,
  replaced: 4000,
};

const enc = new TextEncoder();

export function createHub(env) {
  for (const name of [
    "store",
    "sockets",
    "telegram",
    "upload",
    "fixedStream",
    "download",
    "now",
    "log",
    "botId",
    "ownerTgId",
    "telegramKey",
    "botToken",
  ]) {
    if (env[name] === undefined || env[name] === null)
      throw new Error(`hub: missing ${name}`);
  }
  if (env.bot === undefined)
    throw new Error("hub: bot must be given, as null until it is built");
  if (typeof env.sockets.lastPing !== "function")
    throw new Error("hub: sockets.lastPing(ws) is missing");
  if (typeof env.topicSuffix !== "string")
    throw new Error('hub: topicSuffix must be given, "" on the real relay');
  const { topicSuffix } = env;
  for (const name of ["botId", "ownerTgId"]) {
    if (!Number.isSafeInteger(env[name]) || env[name] <= 0)
      throw new Error(`hub: ${name} must be a positive whole number`);
  }
  const { store, sockets, telegram, now, log, botId, ownerTgId } = env;
  let telegramKey = null;
  let hashKey = null;

  const ctx = {
    store,
    telegram,
    download: env.download,
    now,
    log,
    botId,
    ownerTgId,
    sendToPc: (pcId, text) => {
      const ws = pcSocket(pcId);
      if (ws) sockets.send(ws, text);
      return Boolean(ws);
    },
    closeUser: (tgId, code, reason) =>
      closeWhere((a) => a.tgId === tgId, code, reason),
  };
  const bot = env.bot ? env.bot(ctx) : null;

  // ---- sockets ----

  const att = (ws) => sockets.attachment(ws);
  const live = () => sockets.all().filter((ws) => att(ws) && !att(ws).closed);
  const pcSocket = (pcId) =>
    live().find((ws) => att(ws).role === "pc" && att(ws).pcId === pcId);
  const reply = (ws, frame) =>
    sockets.send(ws, JSON.stringify({ v: PROTOCOL, ...frame }));
  const fail = (ws, e) => reply(ws, { t: "error", e });
  function shut(ws, code, reason) {
    sockets.setAttachment(ws, { ...att(ws), closed: true });
    sockets.close(ws, code, reason);
  }
  function closeWhere(match, code, reason) {
    for (const ws of live()) if (match(att(ws))) shut(ws, code, reason);
  }
  // Counts one in the hour counter `field` ("alerts" or "files") kept in the attachment of the PC on ws; false at
  // `limit`. It reads the attachment and writes it back with no wait between: a frame's copy read before a wait
  // would undo what a file route counted meanwhile.
  function hourCount(ws, field, limit) {
    const a = att(ws);
    const hour = Math.floor(now() / HOUR);
    const n = a[field] && a[field].hour === hour ? a[field].n : 0;
    if (n >= limit) return false;
    sockets.setAttachment(ws, { ...a, [field]: { hour, n: n + 1 } });
    return true;
  }

  // Closes every socket silent too long (steady design, section 3). The time is the last ping the relay answered;
  // a PC that never pinged counts from its open, a phone that never pinged is kept (a page before 26.3.2 never
  // pings). webSocketClose never runs for a peer that is gone, so a dead PC's lastSeen is its last ping.
  async function dropDead() {
    const t = now();
    for (const ws of live()) {
      const a = att(ws);
      const pinged = sockets.lastPing(ws);
      if (!pinged && a.role !== "pc") continue;
      const last = pinged ? pinged.getTime() : a.openedAt;
      if (t - last <= 2 * a.ping * 1000 + DEAD_GRACE) continue;
      shut(ws, CLOSE.dead, "dead-link");
      log(`${a.role || "socket"} closed: dead-link`);
      if (a.role !== "pc") continue;
      const pc = await store.get(`pc:${a.pcId}`);
      if (!pc) continue;
      pc.lastSeen = last;
      await store.put(`pc:${a.pcId}`, pc);
    }
  }

  // ---- the daily count (section 9) ----

  const dayKey = (t) => `day:${new Date(t).toISOString().slice(0, 10)}`;
  async function today() {
    return (await store.get(dayKey(now()))) || { requests: 0, joins: 0 };
  }
  async function count(field) {
    const day = await today();
    day[field] += 1;
    await store.put(dayKey(now()), day);
    return day;
  }
  const nextMidnight = () => (Math.floor(now() / DAY) + 1) * DAY;

  // ---- clean-up inside normal requests (sections 1 and 3) ----

  async function sweep() {
    const t = now();
    for (const [key, pc] of await store.list("pc:")) {
      if (pc.tgId === null && t >= pc.createdAt + UNPAIRED_LIFE) {
        await store.delete(key);
        const pcId = key.slice(3);
        closeWhere(
          (a) => a.role === "pc" && a.pcId === pcId,
          CLOSE.timeout,
          "pair-timeout",
        );
        log("pc unpaired too long: record deleted");
      }
    }
    for (const [key, invite] of await store.list("invite:")) {
      if (t >= invite.expiresAt) await store.delete(key);
    }
    for (const [key, sent] of await store.list("alert:")) {
      if (t >= sent.at + ALERT_LIFE) await store.delete(key);
    }
    for (const [key, list] of await store.list("dl:")) {
      const left = list.filter((l) => t < l.until);
      if (left.length < list.length) await keepLinks(key, left);
    }
    const keep = [dayKey(t), dayKey(t - DAY)];
    for (const [key] of await store.list("day:")) {
      if (!keep.includes(key)) await store.delete(key);
    }
  }

  // ---- checks ----

  // A sign-in (login true) needs Telegram's `hash`, the HMAC the relay checks with the bot token. A pair or join-ask
  // frame goes on to a PC, so its initData must not carry `hash`: a PC never holds text the relay takes as a login.
  async function checkInitData(initData, { login }) {
    if (typeof initData !== "string" || !initData) return null;
    const params = new URLSearchParams(initData);
    if (login ? !(await goodHash(params)) : params.has("hash")) return null;
    const signature = params.get("signature");
    if (!signature || !B64URL.test(signature)) return null;
    const lines = [...params]
      .filter(([k]) => k !== "hash" && k !== "signature")
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    const data = enc.encode(`${botId}:WebAppData\n${lines.join("\n")}`);
    if (!telegramKey) {
      telegramKey = await subtle.importKey(
        "raw",
        fromHex(env.telegramKey),
        { name: "Ed25519" },
        false,
        ["verify"],
      );
    }
    let good = false;
    try {
      good = await subtle.verify(
        { name: "Ed25519" },
        telegramKey,
        fromB64url(signature),
        data,
      );
    } catch {
      return null; // a signature that is not base64url of 64 bytes
    }
    if (!good) return null;
    const authDate = Number(params.get("auth_date")) * 1000;
    if (!Number.isFinite(authDate)) return null;
    if (now() - authDate > INIT_MAX_AGE || authDate - now() > INIT_MAX_AHEAD)
      return null;
    let user;
    try {
      user = JSON.parse(params.get("user"));
    } catch {
      return null;
    }
    if (!user || !Number.isSafeInteger(user.id) || user.id <= 0) return null;
    return { tgId: user.id, firstName: String(user.first_name || "") };
  }

  async function invited(who) {
    const user = await store.get(`user:${who.tgId}`);
    if (user) return user;
    if (who.tgId !== ownerTgId) return null;
    // The owner is always invited; his record is made at his first good sign-in, so pairing has one to fill.
    const owner = { invitedAt: now(), firstName: who.firstName, pcId: null };
    await store.put(`user:${who.tgId}`, owner);
    log("owner record made");
    return owner;
  }

  const isAppFrame = (f) =>
    typeof f.dev === "string" &&
    B64URL.test(f.dev) &&
    typeof f.sid === "string" &&
    B64URL.test(f.sid) &&
    Number.isSafeInteger(f.n) &&
    f.n >= 0 &&
    typeof f.c === "string" &&
    B64URL.test(f.c);

  // ---- a new socket ----

  async function open(ws, { origin }) {
    if (typeof origin !== "string" || !/^https?:\/\/[^/]+$/.test(origin))
      throw new Error(`hub: open needs the relay's origin, got ${origin}`);
    sockets.accept(ws);
    sockets.setAttachment(ws, {
      conn: randomB64url(9),
      origin,
      role: null,
      msgs: 0,
      openedAt: now(),
      ping: PING_SLOW,
    });
    const day = await count("requests");
    await sweep();
    await dropDead();
    if (day.requests >= DAY_SOFT_LIMIT) {
      reply(ws, { t: "limit", resetAt: nextMidnight() });
      shut(ws, CLOSE.limit, "limit");
    }
  }

  // ---- one incoming frame ----

  async function message(ws, text) {
    const a = att(ws);
    if (!a || a.closed) return;
    if (text === PING) return sockets.send(ws, PONG);
    a.msgs += 1;
    sockets.setAttachment(ws, a);
    if (a.msgs % MESSAGES_PER_REQUEST === 0) await count("requests");
    let f = null;
    try {
      if (typeof text === "string") f = JSON.parse(text);
    } catch {}
    if (!f || typeof f !== "object" || Array.isArray(f)) {
      if (!a.role) return shut(ws, CLOSE.first, "bad-frame");
      return fail(ws, "bad-frame");
    }
    if (f.v !== PROTOCOL) return fail(ws, "protocol");
    if (!a.role) {
      a.ping = f.ping === PING_FAST ? PING_FAST : PING_SLOW;
      if (f.t === "auth") return phoneAuth(ws, a, f);
      if (f.t === "pc-auth") return pcAuth(ws, a, f);
      if (f.t === "pc-join") return pcJoin(ws, a, f);
      return shut(ws, CLOSE.first, "auth-first");
    }
    if (a.role === "phone") {
      if (f.t === "pair") return phonePair(ws, a, f, text);
      if (f.t === "join-ask") return phoneJoinAsk(ws, a, f, text);
      if (f.t === "join-reveal" || f.t === "join-cancel")
        return phoneJoinNext(ws, a, f, text);
      if (f.t === "app") return phoneApp(ws, a, f, text);
      return fail(ws, "not-allowed");
    }
    if (f.t === "pair-ok" || f.t === "pair-fail")
      return pcPairAnswer(a, f, text);
    if (f.t === "paired") return pcPaired(ws, a, f);
    if (f.t === "join-wait" || f.t === "join-ok" || f.t === "join-fail")
      return pcJoinAnswer(ws, a, f, text);
    if (f.t === "joined") return pcJoined(ws, a, f);
    if (f.t === "app-fail") return pcAppFail(ws, a, f);
    if (f.t === "app") return pcApp(ws, a, f, text);
    if (f.t === "alert") return pcAlert(ws, a, f);
    if (f.t === "alert-done") return pcAlertDone(ws, f);
    if (f.t === "dl-open") return pcDlOpen(ws, a, f);
    if (f.t === "held-ack" || f.t === "fetch") {
      if (!bot) return fail(ws, "no-bot");
      return bot.pcFrame(a.pcId, f);
    }
    return fail(ws, "not-allowed");
  }

  // Telegram's `hash` (Mini Apps, "Validating data received via the Mini App"): hex HMAC-SHA-256 of the sorted
  // "key=value" lines of every field but hash, under the key HMAC_SHA256("WebAppData", botToken).
  async function goodHash(params) {
    const hash = params.get("hash");
    if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return false;
    if (!hashKey) {
      const webAppData = await subtle.importKey(
        "raw",
        enc.encode("WebAppData"),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
      );
      const secret = await subtle.sign(
        "HMAC",
        webAppData,
        enc.encode(env.botToken),
      );
      hashKey = await subtle.importKey(
        "raw",
        secret,
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["verify"],
      );
    }
    const lines = [...params]
      .filter(([k]) => k !== "hash")
      .map(([k, v]) => `${k}=${v}`)
      .sort();
    return subtle.verify(
      "HMAC",
      hashKey,
      fromHex(hash),
      enc.encode(lines.join("\n")),
    );
  }

  // ---- signing in (section 3) ----

  async function phoneAuth(ws, a, f) {
    const who = await checkInitData(f.initData, { login: true });
    if (!who) {
      log("phone refused: bad-sign");
      return shut(ws, CLOSE.auth, "bad-sign");
    }
    if (!(await invited(who))) {
      log("phone refused: not-invited");
      return shut(ws, CLOSE.auth, "not-invited");
    }
    sockets.setAttachment(ws, {
      ...a,
      role: "phone",
      tgId: who.tgId,
      dev: null,
    });
  }

  async function pcAuth(ws, a, f) {
    await dropDead();
    const pc = PC_ID.test(f.pcId) ? await store.get(`pc:${f.pcId}`) : null;
    const token = keyBytes(f.token);
    if (!pc || !token || !sameText(await sha256Hex(token), pc.tokenHash)) {
      log("pc refused: bad token");
      return shut(ws, CLOSE.auth, "bad-token");
    }
    const old = pcSocket(f.pcId);
    if (old) shut(old, CLOSE.replaced, "replaced");
    pc.lastSeen = now();
    await store.put(`pc:${f.pcId}`, pc);
    sockets.setAttachment(ws, {
      ...a,
      role: "pc",
      pcId: f.pcId,
      pairs: [],
      joins: [],
      asks: [],
      alerts: null,
      files: null,
      topics: null,
    });
    // files: 1 says this relay has Send to chat and the download link over one HTTP body (files contract, 6.2).
    reply(ws, {
      t: "pc-auth",
      ok: true,
      botId,
      paired: pc.tgId !== null,
      files: 1,
    });
    // A page waiting on "PC off" says hello at once (steady design, section 1).
    if (pc.tgId !== null) {
      for (const p of live())
        if (att(p).role === "phone" && att(p).tgId === pc.tgId)
          reply(p, { t: "pc-online" });
    }
    if (bot) await bot.pcConnected(f.pcId);
    // Topic mode and the topics, after the answer has gone: each kept topic is checked and a missing one made. An
    // unpaired PC has no chat: its mode is read at its first alert. A refusal here only costs the topics until the
    // next alert or file, so the PC stays signed in.
    if (pc.tgId === null) return;
    try {
      if (await topicMode(ws)) {
        // All topics first, so a refused Open button never stops a topic from being made.
        const threads = {};
        for (const which of Object.keys(TOPIC_NAMES))
          threads[which] = await liveTopic(pc.tgId, which);
        for (const which of Object.keys(TOPIC_NAMES))
          await openButton(pc.tgId, which, threads[which], a.origin);
      }
    } catch (e) {
      log(`topics at sign-in refused: ${e.message}`);
    }
  }

  // ---- topics (files contract, section 7) ----

  // The topic mode of the PC on ws: getMe's has_topics_enabled, read once per sign-in and kept in the attachment.
  async function topicMode(ws) {
    if (typeof att(ws).topics === "boolean") return att(ws).topics;
    const me = await telegram("getMe", {});
    const on = me?.has_topics_enabled === true;
    sockets.setAttachment(ws, { ...att(ws), topics: on });
    return on;
  }

  // One chat's topic record is read and written by one call at a time: a sign-in and an alert both making topics
  // would otherwise each write back the record they read, and the later write would drop the other's new topic.
  const topicTurns = new Map();
  function topicTurn(tgId, fn) {
    const run = (topicTurns.get(tgId) ?? Promise.resolve()).then(fn);
    const done = run.catch(() => {});
    topicTurns.set(tgId, done);
    done.then(() => {
      if (topicTurns.get(tgId) === done) topicTurns.delete(tgId);
    });
    return run;
  }
  const topicName = (which) => `${TOPIC_NAMES[which]}${topicSuffix}`;

  // The kept thread id of topic `which` (a TOPIC_NAMES key) in the chat tgId; made once when none is kept.
  function topicId(tgId, which) {
    return topicTurn(tgId, async () => {
      const kept = (await store.get(topicKey(tgId))) ?? { at: null };
      if (Number.isSafeInteger(kept[which])) return kept[which];
      const made = await telegram("createForumTopic", {
        chat_id: tgId,
        name: topicName(which),
      });
      if (!Number.isSafeInteger(made?.message_thread_id))
        throw new Error(
          "hub: Telegram's createForumTopic gave no message_thread_id",
        );
      await store.put(topicKey(tgId), {
        ...kept,
        [which]: made.message_thread_id,
        at: now(),
      });
      log(`topic made: ${which}`);
      return made.message_thread_id;
    });
  }

  // Forgets topic `which` of the chat tgId when its kept id is still `thread` (the user deleted it).
  function forgetTopic(tgId, which, thread) {
    return topicTurn(tgId, async () => {
      const kept = await store.get(topicKey(tgId));
      if (!kept || kept[which] !== thread) return;
      await store.put(topicKey(tgId), { ...kept, [which]: null });
      log(`topic gone: ${which}`);
    });
  }

  // Telegram for iPhone shows the chat's menu button (the bot's Open) only in the All view, never inside a topic
  // (user, 2026-11-18). So each topic gets one pinned message with an Open button, sent once per topic thread and
  // kept as `opens.<which>` = { thread, msg } in the topic record; a topic made again gets a new one.
  function openButton(tgId, which, thread, origin) {
    if (typeof origin !== "string")
      throw new Error("hub: the Open button needs the relay's origin");
    return topicTurn(tgId, async () => {
      const kept = (await store.get(topicKey(tgId))) ?? { at: null };
      if (kept.opens?.[which]?.thread === thread) return;
      const msg = await telegram("sendMessage", {
        chat_id: tgId,
        message_thread_id: thread,
        text: "Open the app",
        disable_notification: true,
        reply_markup: {
          inline_keyboard: [[{ text: "Open", web_app: { url: `${origin}/` } }]],
        },
      });
      if (!Number.isSafeInteger(msg?.message_id))
        throw new Error("hub: Telegram's sendMessage gave no message_id");
      await telegram("pinChatMessage", {
        chat_id: tgId,
        message_id: msg.message_id,
        disable_notification: true,
      });
      await store.put(topicKey(tgId), {
        ...kept,
        opens: { ...kept.opens, [which]: { thread, msg: msg.message_id } },
      });
      log(`open button pinned: ${which}`);
    });
  }

  // The thread id of topic `which`, checked at Telegram with an edit of its own name (which also undoes a rename by
  // the user); a topic the user deleted is forgotten and made again. Any other refusal is thrown.
  async function liveTopic(tgId, which) {
    const thread = await topicId(tgId, which);
    try {
      await telegram("editForumTopic", {
        chat_id: tgId,
        message_thread_id: thread,
        name: topicName(which),
      });
      return thread;
    } catch (e) {
      if (!THREAD_GONE.test(e.message)) throw e;
    }
    await forgetTopic(tgId, which, thread);
    return topicId(tgId, which);
  }

  // Calls `method` in topic `which` of the chat tgId. A topic the user deleted is forgotten, made again once and
  // the call sent again once; any other refusal, or a second one, is thrown.
  async function inTopic(tgId, which, method, params) {
    for (let again = false; ; again = true) {
      const thread = await topicId(tgId, which);
      try {
        return await telegram(method, { ...params, message_thread_id: thread });
      } catch (e) {
        if (again || !THREAD_GONE.test(e.message)) throw e;
        await forgetTopic(tgId, which, thread);
      }
    }
  }

  async function pcJoin(ws, a, f) {
    const token = keyBytes(f.token);
    if (
      !token ||
      typeof f.pcId !== "string" ||
      !keyBytes(f.inboxPub) ||
      typeof f.pcVersion !== "string" ||
      !VERSION.test(f.pcVersion)
    ) {
      return shut(ws, CLOSE.first, "bad-frame");
    }
    if ((await pcIdOf(token)) !== f.pcId) {
      log("pc-join refused: pc-id");
      return shut(ws, CLOSE.exists, "pc-id");
    }
    if (await store.get(`pc:${f.pcId}`)) {
      log("pc-join refused: pc-exists");
      return shut(ws, CLOSE.exists, "pc-exists");
    }
    const unpaired = (await store.list("pc:")).filter(
      ([, pc]) => pc.tgId === null,
    );
    if (
      (await today()).joins >= JOINS_PER_DAY ||
      unpaired.length >= MAX_UNPAIRED
    ) {
      log("pc-join refused: join-limit");
      return shut(ws, CLOSE.limit, "join-limit");
    }
    const t = now();
    await store.put(`pc:${f.pcId}`, {
      tokenHash: await sha256Hex(token),
      tgId: null,
      createdAt: t,
      lastSeen: t,
      pcVersion: f.pcVersion,
      inboxPub: f.inboxPub,
    });
    await count("joins");
    sockets.setAttachment(ws, {
      ...a,
      role: "pc",
      pcId: f.pcId,
      pairs: [],
      joins: [],
      asks: [],
      alerts: null,
    });
    log("pc joined");
    // files: 1 here too: a PC that just joined keeps this socket, so without it Send to chat stays off till a reconnect.
    reply(ws, { t: "pc-join", ok: true, botId, files: 1 });
  }

  // ---- pairing (section 2): the Hub passes the messages and records a pair only when it saw it ----

  async function phonePair(ws, a, f, text) {
    const who = await checkInitData(f.initData, { login: false });
    if (!who || who.tgId !== a.tgId) return fail(ws, "bad-sign");
    // A page before DV4 sends no kind; DV4 makes it send one. A kind that is there must be on the list.
    if (f.kind !== undefined && !Object.hasOwn(KINDS, f.kind))
      return fail(ws, "bad-kind");
    const pc = PC_ID.test(f.pcId) ? await store.get(`pc:${f.pcId}`) : null;
    if (!pc || (pc.tgId === null && now() >= pc.createdAt + UNPAIRED_LIFE))
      return fail(ws, "no-pc");
    const target = pcSocket(f.pcId);
    if (!target) return reply(ws, { t: "offline", lastSeen: pc.lastSeen });
    const ta = att(target);
    const t = now();
    ta.pairs = [
      ...ta.pairs.filter((p) => t - p.at < PAIR_WINDOW).slice(-3),
      { tgId: a.tgId, conn: a.conn, at: t },
    ];
    sockets.setAttachment(target, ta);
    sockets.send(target, text);
  }

  // `pair-ok` and `pair-fail` go back to the phone socket that sent the latest `pair` to this PC.
  function pcPairAnswer(a, f, text) {
    const latest = a.pairs.filter((p) => now() - p.at < PAIR_WINDOW).at(-1);
    const phone =
      latest &&
      live().find(
        (ws) => att(ws).role === "phone" && att(ws).conn === latest.conn,
      );
    if (!phone) return log(`${f.t} dropped: no phone waiting`);
    sockets.send(phone, text);
  }

  async function pcPaired(ws, a, f) {
    const tgId = f.tgId;
    if (!a.pairs.some((p) => p.tgId === tgId && now() - p.at < PAIR_WINDOW))
      return fail(ws, "no-pair");
    const pc = await store.get(`pc:${a.pcId}`);
    if (!pc) return shut(ws, CLOSE.removed, "removed");
    if (pc.tgId !== null && pc.tgId !== tgId) {
      log("paired refused: pc-taken");
      return fail(ws, "pc-taken");
    }
    const user = await store.get(`user:${tgId}`);
    if (!user) return fail(ws, "not-invited");
    if (user.pcId && user.pcId !== a.pcId) await dropPc(user.pcId);
    pc.tgId = tgId;
    await store.put(`pc:${a.pcId}`, pc);
    user.pcId = a.pcId;
    await store.put(`user:${tgId}`, user);
    log("pc paired");
    reply(ws, { t: "paired", ok: true });
  }

  // A user who pairs a new PC leaves the old one: its record and held forwards go, its socket is closed.
  async function dropPc(pcId) {
    await store.delete(`pc:${pcId}`);
    for (const prefix of [`held:${pcId}:`, `file:${pcId}:`]) {
      for (const [key] of await store.list(prefix)) await store.delete(key);
    }
    await store.delete(linksKey(pcId));
    closeWhere(
      (x) => x.role === "pc" && x.pcId === pcId,
      CLOSE.removed,
      "replaced-pc",
    );
    log("old pc dropped");
  }

  // ---- a further device joins by an OK (section 15): the Hub passes the frames between the asking socket and the
  // owner's PC for 4 minutes and sends the bot line; it stores nothing and logs no key, nonce or device id ----

  async function phoneJoinAsk(ws, a, f, text) {
    const who = await checkInitData(f.initData, { login: false });
    if (!who || who.tgId !== a.tgId) return fail(ws, "bad-sign");
    if (
      typeof f.dev !== "string" ||
      !DEV.test(f.dev) ||
      !keyBytes(f.DN) ||
      !keyBytes(f.commit)
    )
      return fail(ws, "bad-frame");
    if (!Object.hasOwn(KINDS, f.kind)) return fail(ws, "bad-kind");
    const user = await store.get(`user:${a.tgId}`);
    const pc = user?.pcId ? await store.get(`pc:${user.pcId}`) : null;
    if (!pc || pc.tgId !== a.tgId) {
      log("join refused: not-paired");
      return reply(ws, { t: "join-fail", dev: f.dev, reason: "not-paired" });
    }
    const target = pcSocket(user.pcId);
    if (!target) return reply(ws, { t: "offline", lastSeen: pc.lastSeen });
    const ta = att(target);
    const t = now();
    const asks = ta.asks.filter((x) => t - x < HOUR);
    if (asks.length >= JOIN_ASKS_PER_HOUR) {
      sockets.setAttachment(target, { ...ta, asks });
      log("join refused: too-many-asks");
      return reply(ws, { t: "join-fail", dev: f.dev, reason: "too-many-asks" });
    }
    const joins = ta.joins.filter(
      (j) => t - j.at < JOIN_WINDOW && j.dev !== f.dev,
    );
    sockets.setAttachment(target, {
      ...ta,
      asks: [...asks, t],
      joins: [
        ...joins.slice(-3),
        { tgId: a.tgId, conn: a.conn, dev: f.dev, at: t },
      ],
    });
    log("join ask");
    sockets.send(target, text);
  }

  // `join-reveal` and `join-cancel` come only from the socket that asked, within 4 minutes of its ask.
  async function phoneJoinNext(ws, a, f, text) {
    if (typeof f.dev !== "string" || !DEV.test(f.dev))
      return fail(ws, "bad-frame");
    if (
      f.t === "join-reveal" &&
      !(typeof f.Nn === "string" && NONCE.test(f.Nn))
    )
      return fail(ws, "bad-frame");
    const user = await store.get(`user:${a.tgId}`);
    const target = user?.pcId ? pcSocket(user.pcId) : null;
    const asked =
      target &&
      att(target).joins.some(
        (j) =>
          j.dev === f.dev && j.conn === a.conn && now() - j.at < JOIN_WINDOW,
      );
    if (!asked) return log(`${f.t} dropped: no join-ask`);
    sockets.send(target, text);
  }

  // `join-wait`, `join-ok` and `join-fail` go only to the socket whose join-ask had this dev, within 4 minutes.
  function pcJoinAnswer(ws, a, f, text) {
    if (typeof f.dev !== "string" || !DEV.test(f.dev))
      return fail(ws, "bad-frame");
    if (
      f.t === "join-ok" &&
      !(typeof f.box === "string" && BOX.test(f.box) && keyBytes(f.mac3))
    )
      return fail(ws, "bad-frame");
    if (
      f.t === "join-fail" &&
      !(typeof f.reason === "string" && REASON.test(f.reason))
    )
      return fail(ws, "bad-frame");
    const j = a.joins.find(
      (x) => x.dev === f.dev && now() - x.at < JOIN_WINDOW,
    );
    const phone =
      j &&
      live().find((p) => att(p).role === "phone" && att(p).conn === j.conn);
    if (!phone) return log(`${f.t} dropped: no phone waiting`);
    if (f.t === "join-ok") log("join ok");
    if (f.t === "join-fail") log(`join refused: ${f.reason}`);
    sockets.send(phone, text);
  }

  // The bot line, once per join: after a join-ask of this id in the last 4 minutes, or after a pair of this id in
  // the pairing window (a second device paired by the PC's code). It counts toward the alerts of the hour.
  async function pcJoined(ws, a, f) {
    if (!Object.hasOwn(KINDS, f.kind)) return fail(ws, "bad-kind");
    const t = now();
    const j = a.joins.find((x) => x.tgId === f.tgId && t - x.at < JOIN_WINDOW);
    const p =
      !j &&
      a.pairs.find(
        (x) => x.tgId === f.tgId && t - x.at < PAIR_WINDOW && !x.lined,
      );
    if (!j && !p) {
      log("joined refused: no-join");
      return fail(ws, "no-join");
    }
    const pc = await store.get(`pc:${a.pcId}`);
    if (!pc) return shut(ws, CLOSE.removed, "removed");
    if (pc.tgId !== f.tgId) return fail(ws, "not-paired");
    if (!hourCount(ws, "alerts", ALERTS_PER_HOUR))
      return fail(ws, "alert-rate");
    // The attachment as it is now: `a` was read before the waits above.
    const fresh = att(ws);
    const same = (x, y) => y && x.conn === y.conn && x.at === y.at;
    sockets.setAttachment(ws, {
      ...fresh,
      joins: fresh.joins.filter((x) => !same(x, j)),
      pairs: fresh.pairs.map((x) => (same(x, p) ? { ...x, lined: true } : x)),
    });
    await telegram("sendMessage", {
      chat_id: pc.tgId,
      text: `A new device joined your PC: ${KINDS[f.kind]}. Not you? Remove it in the app, Settings › Devices.`,
      disable_notification: false,
    });
    log("join line sent");
  }

  // A hello from a device the PC no longer knows: the answer goes outside the seal to that device's sockets.
  async function pcAppFail(ws, a, f) {
    if (
      typeof f.dev !== "string" ||
      !B64URL.test(f.dev) ||
      f.reason !== "unknown-device"
    )
      return fail(ws, "bad-frame");
    const pc = await store.get(`pc:${a.pcId}`);
    if (!pc) return shut(ws, CLOSE.removed, "removed");
    if (pc.tgId === null) return fail(ws, "not-paired");
    const frame = { t: "app-fail", dev: f.dev, reason: f.reason };
    for (const p of live())
      if (
        att(p).role === "phone" &&
        att(p).tgId === pc.tgId &&
        att(p).dev === f.dev
      )
        reply(p, frame);
  }

  // ---- the app channel (sections 3, 4, 9): the Hub fixes the route; the frame goes on as it came ----

  async function phoneApp(ws, a, f, text) {
    await dropDead();
    if (!isAppFrame(f)) return fail(ws, "bad-frame");
    const user = await store.get(`user:${a.tgId}`);
    if (!user) return shut(ws, CLOSE.auth, "not-invited");
    if (!user.pcId) return fail(ws, "not-paired");
    if (a.dev !== f.dev) sockets.setAttachment(ws, { ...a, dev: f.dev });
    const target = pcSocket(user.pcId);
    if (!target) {
      const pc = await store.get(`pc:${user.pcId}`);
      return reply(ws, { t: "offline", lastSeen: pc ? pc.lastSeen : null });
    }
    sockets.send(target, text);
  }

  async function pcApp(ws, a, f, text) {
    if (!isAppFrame(f)) return fail(ws, "bad-frame");
    const pc = await store.get(`pc:${a.pcId}`);
    if (!pc) return shut(ws, CLOSE.removed, "removed");
    if (pc.tgId === null) return fail(ws, "not-paired");
    const phones = live().filter(
      (p) =>
        att(p).role === "phone" &&
        att(p).tgId === pc.tgId &&
        att(p).dev === f.dev,
    );
    if (!phones.length) return reply(ws, { t: "offline", dev: f.dev });
    for (const p of phones) sockets.send(p, text);
  }

  // ---- alerts (section 5) ----

  async function pcAlert(ws, a, f) {
    const pc = await store.get(`pc:${a.pcId}`);
    if (!pc) return shut(ws, CLOSE.removed, "removed");
    if (pc.tgId === null) return fail(ws, "not-paired");
    if (typeof f.text !== "string" || !ALERT_TEXT.test(f.text))
      return fail(ws, "alert-text");
    if (typeof f.open !== "string" || !ALERT_OPEN.test(f.open))
      return fail(ws, "alert-open");
    if (typeof f.silent !== "boolean") return fail(ws, "alert-silent");
    if (!hourCount(ws, "alerts", ALERTS_PER_HOUR))
      return fail(ws, "alert-rate");
    // A session sets its own title, and an older PC program sends its dots: a dot before a letter becomes "-", so
    // nothing reads as a domain, and the message shows no link preview.
    const params = {
      chat_id: pc.tgId,
      text: f.text.replace(/\.(?=\p{L})/gu, "-"),
      disable_notification: f.silent,
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open", web_app: { url: `${a.origin}/?o=${f.open}` } }],
        ],
      },
    };
    let msg;
    if (await topicMode(ws)) {
      // Mode on: no fall-back to the plain chat; a refusal is the PC's `telegram-refused`.
      try {
        msg = await inTopic(pc.tgId, "alerts", "sendMessage", params);
      } catch (e) {
        log(`alert refused: ${e.message}`);
        return fail(ws, "telegram-refused");
      }
    } else msg = await telegram("sendMessage", params);
    if (!Number.isSafeInteger(msg?.message_id))
      throw new Error("hub: Telegram's sendMessage gave no message_id");
    await store.put(alertKey(pc.tgId, f.open), {
      msg: msg.message_id,
      at: now(),
    });
    log("alert sent");
  }

  // The PC's word that an alert is handled: its message leaves the paired user's chat. A delete Telegram refuses
  // (too old, already gone) is logged and not tried again; the kept id goes either way.
  async function pcAlertDone(ws, f) {
    const pc = await store.get(`pc:${att(ws).pcId}`);
    if (!pc) return shut(ws, CLOSE.removed, "removed");
    if (pc.tgId === null) return fail(ws, "not-paired");
    if (typeof f.open !== "string" || !ALERT_OPEN.test(f.open))
      return fail(ws, "alert-open");
    const key = alertKey(pc.tgId, f.open);
    const sent = await store.get(key);
    if (!sent) return log("alert done: not kept");
    await store.delete(key);
    try {
      await telegram("deleteMessage", {
        chat_id: pc.tgId,
        message_id: sent.msg,
      });
      log("alert deleted");
    } catch (e) {
      log(`alert delete refused: ${e.message}`);
    }
  }

  // ---- files to Telegram and to a browser (files contract, section 6): only a link's fields go to the store ----

  // Download links are kept in the store, since Telegram's download box fetches one only after the user confirms it
  // and an idle object sleeps within seconds: `dl:<pcId>` -> [{ hash, ref, name, size, mime, until }], oldest
  // first, hash the SHA-256 hex of the link's token (the token itself is never kept). A link goes when used, when
  // its 2 minutes are over (sweep, dl-open, its GET) and with its PC.
  const linksKey = (pcId) => `dl:${pcId}`;
  // Keeps the links of a PC's list, and drops the list when none is left.
  async function keepLinks(key, list) {
    if (list.length) await store.put(key, list);
    else await store.delete(key);
  }
  // The kept link of a token's hash: { key, list, l }, or null.
  async function findLink(hash) {
    for (const [key, list] of await store.list("dl:")) {
      const l = list.find((x) => x.hash === hash);
      if (l) return { key, list, l };
    }
    return null;
  }
  const pulls = new Map(); // pull id (the `link` of dl-pull) -> { pcId, ref, size, writable, timer }

  const json = (status, value) => ({
    status,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(value),
  });
  const refused = (status, e, why) =>
    json(status, why === undefined ? { ok: false, e } : { ok: false, e, why });
  const NOBODY = { status: 401, headers: {}, body: "" };

  // The PC behind an HTTP file call (section 6.1): its id and token checked as pcAuth checks them, paired, its
  // socket open. Returns { ws, pc, pcId }, or null for any miss.
  async function fileCaller(headers) {
    const pcId = headers["x-phone-pc"];
    const bearer = /^Bearer (\S+)$/.exec(headers.authorization ?? "");
    const pc = PC_ID.test(pcId ?? "") ? await store.get(`pc:${pcId}`) : null;
    const token = bearer ? keyBytes(bearer[1]) : null;
    if (!pc || !token || !sameText(await sha256Hex(token), pc.tokenHash))
      return null;
    if (pc.tgId === null) return null;
    const ws = pcSocket(pcId);
    return ws ? { ws, pc, pcId } : null;
  }

  // Counts one send or link in the hour of the PC on ws; false over the limit.
  const fileCount = (ws) => hourCount(ws, "files", FILES_PER_HOUR);

  // POST /pc/send (section 6.2): the PC's file, as the request's body, goes to the paired user's chat as one
  // sendDocument, into the Files topic in topic mode. The body is piped into a multipart body of fixed length,
  // never held whole. req is { headers (lower-case names), body, signal } and body is read only when the send starts.
  // signal (optional) fires when the PC breaks off the request; it cancels the upload to Telegram, which would
  // otherwise keep running with no one waiting for it.
  async function pcSend(req) {
    const caller = await fileCaller(req.headers);
    if (!caller) return NOBODY;
    const { ws, pc } = caller;
    let name = null;
    try {
      name = decodeURIComponent(req.headers["x-file-name"] ?? "");
    } catch {}
    if (name === null || !FILE_NAME.test(name)) return refused(400, "bad-name");
    const sizeText = req.headers["content-length"] ?? "";
    if (!SIZE.test(sizeText)) return refused(411, "bad-size");
    const size = Number(sizeText);
    if (size > SEND_MAX) return refused(413, "too-big");
    if (!fileCount(ws)) return refused(429, "rate");
    const given = req.headers["content-type"] ?? "";
    const type = MIME.test(given) ? given : "application/octet-stream";

    // Topic mode: the topic is checked first (liveTopic), so a topic the user deleted is made again before the body
    // starts; a streamed body cannot be sent twice. A chat action alone would not do: Telegram takes one into a
    // deleted topic.
    let thread = null;
    if (await topicMode(ws)) {
      try {
        thread = await liveTopic(pc.tgId, "files");
        await telegram("sendChatAction", {
          chat_id: pc.tgId,
          message_thread_id: thread,
          action: "upload_document",
        });
      } catch (e) {
        log(`file send refused: ${e.message}`);
        return refused(
          502,
          "telegram-refused",
          e.message.replace(TELEGRAM_REFUSED, ""),
        );
      }
    }

    const boundary = `relay-${randomB64url(18)}`;
    const field = (n, v) =>
      `--${boundary}\r\nContent-Disposition: form-data; name="${n}"\r\n\r\n${v}\r\n`;
    const head = enc.encode(
      field("chat_id", pc.tgId) +
        (thread === null ? "" : field("message_thread_id", thread)) +
        `--${boundary}\r\nContent-Disposition: form-data; name="document"; ` +
        `filename="${name.replace(/"/g, "%22")}"\r\nContent-Type: ${type}\r\n\r\n`,
    );
    const tail = enc.encode(`\r\n--${boundary}--\r\n`);
    const length = head.length + size + tail.length;
    const pipe = env.fixedStream(length);
    const stop = new AbortController();
    let brokeOff = false;
    const brokenOff = () => {
      brokeOff = true;
      stop.abort();
    };
    if (req.signal?.aborted) brokenOff();
    req.signal?.addEventListener("abort", brokenOff, { once: true });
    const copy = (async () => {
      let w = pipe.writable.getWriter();
      await w.write(head);
      w.releaseLock();
      await req.body.pipeTo(pipe.writable, {
        preventClose: true,
        signal: stop.signal,
      });
      w = pipe.writable.getWriter();
      await w.write(tail);
      await w.close();
    })();
    copy.catch(() => {}); // its failure shows as the upload's

    let msg;
    try {
      msg = await env.upload("sendDocument", {
        body: pipe.readable,
        length,
        type: `multipart/form-data; boundary=${boundary}`,
        signal: stop.signal,
      });
    } catch (e) {
      stop.abort();
      if (brokeOff) {
        log("file send aborted: the PC broke off the request");
        return refused(400, "aborted");
      }
      if (!TELEGRAM_REFUSED.test(e.message)) {
        // The PC's body ended early or failed, or the bytes did not reach Telegram.
        log(`file send aborted: ${e.message}`);
        return refused(400, "aborted");
      }
      log(`file send refused: ${e.message}`);
      if (thread !== null && THREAD_GONE.test(e.message))
        await forgetTopic(pc.tgId, "files", thread);
      return refused(
        502,
        "telegram-refused",
        e.message.replace(TELEGRAM_REFUSED, ""),
      );
    } finally {
      req.signal?.removeEventListener("abort", brokenOff);
    }
    await copy;
    if (!Number.isSafeInteger(msg?.message_id))
      throw new Error("hub: Telegram's sendDocument gave no message_id");
    log("file sent to chat");
    return json(200, { ok: true, message_id: msg.message_id });
  }

  // dl-open (section 6.3): a one-time link to the PC's file, made on the paired user's ask at the PC.
  async function pcDlOpen(ws, a, f) {
    if (typeof f.ref !== "string" || !REF.test(f.ref))
      return fail(ws, "bad-frame");
    const no = (e) => reply(ws, { t: "dl-fail", ref: f.ref, e });
    const pc = await store.get(`pc:${a.pcId}`);
    if (!pc) return shut(ws, CLOSE.removed, "removed");
    if (pc.tgId === null) return no("not-paired");
    if (typeof f.name !== "string" || !FILE_NAME.test(f.name))
      return no("bad-name");
    if (!Number.isSafeInteger(f.size) || f.size < 1 || f.size > FILE_MAX)
      return no("limit");
    if (typeof f.mime !== "string" || !MIME.test(f.mime)) return no("bad-mime");
    if (!fileCount(ws)) return fail(ws, "files-rate");
    const token = randomB64url(32);
    const hash = await sha256Hex(enc.encode(token));
    const t = now();
    const until = t + LINK_LIFE;
    const key = linksKey(a.pcId);
    // Read after the wait above, so a link used meanwhile is not written back.
    const mine = ((await store.get(key)) ?? []).filter((l) => t < l.until);
    await keepLinks(key, [
      ...mine.slice(-(LINKS_PER_PC - 1)), // the oldest goes
      { hash, ref: f.ref, name: f.name, size: f.size, mime: f.mime, until },
    ]);
    reply(ws, {
      t: "dl-made",
      ref: f.ref,
      url: `${a.origin}/dl/${token}`,
      until: new Date(until).toISOString(),
    });
    log("download link made");
  }

  // The headers of a download (section 6.3, step 4): an attachment, readable by Telegram's web page.
  function downloadHeaders(l) {
    const ascii = l.name.replace(/[^\x20-\x7e]|["\\]/g, "_");
    const utf8 = encodeURIComponent(l.name).replace(
      /['()*]/g,
      (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
    );
    return {
      "Content-Type": l.mime,
      "Content-Length": String(l.size),
      "Content-Disposition": `attachment; filename="${ascii}"; filename*=UTF-8''${utf8}`,
      "Access-Control-Allow-Origin": "https://web.telegram.org",
      "Cache-Control": "no-store",
    };
  }

  // GET or HEAD /dl/<token>. A HEAD leaves the link unused. A GET uses it, answers at once with a body of the
  // file's length, and asks the PC for the bytes (dl-pull); the token itself is never logged.
  async function download(token, method) {
    const plain = { "Content-Type": "text/plain; charset=utf-8" };
    const say = (status, text) => ({
      status,
      headers: plain,
      body: method === "HEAD" ? null : text,
    });
    if (typeof token !== "string" || !LINK_TOKEN.test(token))
      return say(410, EXPIRED);
    const found = await findLink(await sha256Hex(enc.encode(token)));
    if (!found) return say(410, EXPIRED);
    const { key, list, l } = found;
    const rest = list.filter((x) => x !== l);
    if (now() >= l.until) {
      await keepLinks(key, rest);
      return say(410, EXPIRED);
    }
    const pcId = key.slice(3);
    const ws = pcSocket(pcId);
    if (!ws) return say(503, "Your PC is offline.");
    const headers = downloadHeaders(l);
    if (method === "HEAD") return { status: 200, headers, body: null };
    await keepLinks(key, rest);
    const pipe = env.fixedStream(l.size);
    const link = randomB64url(16);
    pulls.set(link, {
      pcId,
      ref: l.ref,
      size: l.size,
      writable: pipe.writable,
      timer: setTimeout(() => endPull(link, null), PULL_WAIT),
    });
    reply(ws, { t: "dl-pull", ref: l.ref, link });
    log("download link used");
    return { status: 200, headers, body: pipe.readable };
  }

  // A pull that cannot finish: the browser's download is broken off and the PC told dl-fail aborted. `why` is the
  // error that broke the pipe, or null when the PC's bytes never came.
  function endPull(link, why) {
    const p = pulls.get(link);
    if (!p) return;
    pulls.delete(link);
    clearTimeout(p.timer);
    if (!why)
      p.writable.abort(new Error("no bytes from the PC")).catch(() => {});
    const ws = pcSocket(p.pcId);
    if (ws) reply(ws, { t: "dl-fail", ref: p.ref, e: "aborted" });
    log(`download aborted${why ? `: ${why.message}` : ""}`);
  }

  // POST /pc/dl/<link> (section 6.3, step 5): the PC's bytes for an opened link, piped into the waiting download.
  async function pcDl(link, req) {
    const caller = await fileCaller(req.headers);
    if (!caller) return NOBODY;
    const p = pulls.get(link);
    if (!p || p.pcId !== caller.pcId) return refused(410, "gone");
    clearTimeout(p.timer);
    if (req.headers["content-length"] !== String(p.size)) {
      endPull(link, null);
      return refused(400, "aborted");
    }
    p.timer = null;
    try {
      await req.body.pipeTo(p.writable);
    } catch (e) {
      endPull(link, e);
      return refused(400, "aborted");
    }
    pulls.delete(link);
    log("download sent");
    return json(200, { ok: true });
  }

  // ---- a socket gone; the bot's webhook ----

  // A socket the Hub closed itself keeps the lastSeen it set (a dead link's is its last ping, not now).
  async function closed(ws) {
    const a = att(ws);
    if (!a || a.role !== "pc" || a.closed) return;
    const pc = await store.get(`pc:${a.pcId}`);
    if (!pc) return;
    pc.lastSeen = now();
    await store.put(`pc:${a.pcId}`, pc);
  }

  async function webhook(req) {
    await count("requests");
    if (!bot) return { status: 404, body: "the bot is not built yet" };
    return bot.webhook(req);
  }

  // ---- the webhook check (worker.mjs's `scheduled`, every few minutes) ----

  // A message to the owner about what the check could not fix: into the owner's Sessions topic in topic mode, else
  // the plain chat.
  async function alertOwner(text) {
    const me = await telegram("getMe", {});
    const params = { chat_id: ownerTgId, text };
    const msg =
      me?.has_topics_enabled === true
        ? await inTopic(ownerTgId, "alerts", "sendMessage", params)
        : await telegram("sendMessage", params);
    if (!Number.isSafeInteger(msg?.message_id))
      throw new Error("hub: Telegram's sendMessage gave no message_id");
    log("webhook check: alert sent to the owner");
  }

  // Checks with getWebhookInfo that the bot's webhook is set and points at `origin`/tg/hook, and sets it again with
  // `webhookSecret` when it is empty, or when Telegram's last delivery got a 401 after the check last set it (the
  // relay's secret changed and the webhook kept the old one). A webhook at another address is left as it is (another
  // relay, or the owner's own move: setting it back would take the bot from that one every run) and told once. The
  // owner gets an alert only for what it cannot fix: that address, a refused setWebhook, or a time Telegram could
  // not be reached (logged, then told once by the next run that reaches it).
  // The test copy (a topicSuffix) shares the bot's token: it makes no Bot API call at all, as a setWebhook there
  // would take the bot from the real relay. Returns what it did: test-copy, not-configured (no address), ok, set,
  // foreign, refused or unreached.
  async function heal({ origin, webhookSecret }) {
    if (topicSuffix !== "") {
      log("webhook check: the test copy checks nothing (it shares the bot)");
      return "test-copy";
    }
    const kept = { ...HEAL_START, ...(await store.get(HEAL_KEY)) };
    // No address: a relay deployed before RELAY_ORIGIN existed, or a deploy that stopped before it put it. Not an
    // error each run: logged once, until a run has the address.
    if (typeof origin !== "string" || !ORIGIN.test(origin)) {
      if (!kept.off) {
        log(
          "webhook check: off, this relay has no address in the secret RELAY_ORIGIN (deploy.mjs puts it)",
        );
        await store.put(HEAL_KEY, { ...kept, off: true });
      }
      return "not-configured";
    }
    if (typeof webhookSecret !== "string" || !webhookSecret)
      throw new Error("hub: the webhook check needs the webhook secret");
    const unreached = async (e) => {
      log(`webhook check: Telegram not reached: ${e.message}`);
      if (kept.unreached === null)
        await store.put(HEAL_KEY, { ...kept, off: false, unreached: now() });
      return "unreached";
    };
    let info;
    try {
      info = await telegram("getWebhookInfo", {});
    } catch (e) {
      if (TELEGRAM_REFUSED.test(e.message)) throw e;
      return unreached(e);
    }
    const want = `${origin}/tg/hook`;
    const next = { ...kept, unreached: null, told: null, off: false };
    // A 401 from this relay after the check last set the webhook: maybe an old secret. A deploy gives a few
    // seconds of 401s itself (its new secret is in, its setWebhook not yet), and a check still holding the old
    // secret must not set that back. So a 401 counts only when a newer one came after a run that saw one, that
    // run between STALE_SETTLE_MS and STALE_FRESH_MS ago; a run that sees a 401 it did not count keeps it in seen401.
    const last401 =
      info?.url === want && /\b401\b/.test(info.last_error_message ?? "")
        ? Number(info.last_error_date) * 1000
        : Number.NaN;
    let staleSecret = false;
    if (last401 > (kept.setAt ?? 0)) {
      const seen = kept.seen401;
      const fresh = seen !== null && now() - seen.seenAt <= STALE_FRESH_MS;
      if (
        fresh &&
        last401 > seen.seenAt &&
        now() - seen.seenAt >= STALE_SETTLE_MS
      )
        staleSecret = true;
      else if (!fresh && seen?.at !== last401)
        next.seen401 = { at: last401, seenAt: now() };
    } else next.seen401 = null;
    const foreign = Boolean(info?.url) && info.url !== want;
    const problem = !info?.url
      ? "not set"
      : staleSecret
        ? "refused by the relay (an old secret)"
        : null;
    const told = [];
    if (kept.unreached !== null)
      told.push(
        `The relay could not reach Telegram from ${new Date(kept.unreached).toISOString().slice(0, 16).replace("T", " ")} UTC until now; the bot may have missed messages.`,
      );
    let result = "ok";
    if (foreign) {
      const host = URL.canParse(info.url)
        ? new URL(info.url).host
        : "an address that is not a URL";
      log(
        `webhook check: the webhook points at another address (${host}); left as it is`,
      );
      next.told = `foreign ${host}`;
      if (kept.told !== next.told)
        told.push(
          `The bot's webhook points at another address (${host}), not at this relay, so this relay gets no messages. The relay leaves it as it is, in case it was moved on purpose; to bring the bot back here, deploy the relay again.`,
        );
      result = "foreign";
    } else if (problem) {
      try {
        await telegram("setWebhook", {
          url: want,
          secret_token: webhookSecret,
          ...WEBHOOK_SETTINGS,
        });
        log(`webhook check: the webhook was ${problem}; set again`);
        result = "set";
        next.setAt = now();
        next.seen401 = null;
      } catch (e) {
        if (!TELEGRAM_REFUSED.test(e.message)) return unreached(e);
        log(`webhook check: setWebhook refused: ${e.message}`);
        const words = e.message.replace(TELEGRAM_REFUSED, "");
        next.told = `refused ${problem}: ${words}`;
        if (kept.told !== next.told)
          told.push(
            `The bot's webhook was ${problem} and Telegram refused to set it again (${words}). The bot gets no messages until it is set: deploy the relay again.`,
          );
        result = "refused";
      }
    }
    // Kept before the alert: an alert that fails (the owner blocked the bot, the Sessions topic is gone) must not
    // make every run set the webhook and alert again.
    if (JSON.stringify(next) !== JSON.stringify(kept))
      await store.put(HEAL_KEY, next);
    if (told.length) {
      try {
        await alertOwner(told.join("\n\n"));
      } catch (e) {
        log(`webhook check: the alert to the owner failed: ${e.message}`);
      }
    }
    return result;
  }

  return { open, message, closed, webhook, pcSend, pcDl, download, heal };
}

// ---- bytes ----

function fromHex(hex) {
  if (typeof hex !== "string" || !/^([0-9a-f]{2})+$/i.test(hex))
    throw new Error("hub: telegramKey is not hex");
  return Uint8Array.from(hex.match(/../g), (h) => Number.parseInt(h, 16));
}

const toHex = (bytes) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export function toB64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64url(text) {
  const s = atob(text.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function toBase32(bytes) {
  const abc = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = ((value << 8) | b) & 0xfff;
    bits += 8;
    while (bits >= 5) {
      out += abc[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += abc[(value << (5 - bits)) & 31];
  return out;
}

const randomB64url = (n) => toB64url(crypto.getRandomValues(new Uint8Array(n)));

// Base64url text that decodes to exactly 32 bytes, or null.
function keyBytes(text) {
  if (typeof text !== "string" || text.length !== 43 || !B64URL.test(text))
    return null;
  return fromB64url(text);
}

async function sha256Hex(bytes) {
  return toHex(new Uint8Array(await subtle.digest("SHA-256", bytes)));
}

// pcId = base32 of the first 16 bytes of SHA-256("phone-app pcId v1" | token) (section 3).
export async function pcIdOf(token) {
  const label = enc.encode("phone-app pcId v1");
  const data = new Uint8Array(label.length + token.length);
  data.set(label);
  data.set(token, label.length);
  const hash = new Uint8Array(await subtle.digest("SHA-256", data));
  return toBase32(hash.slice(0, 16));
}

// Compares two hex texts in a time that does not depend on where they differ.
function sameText(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length)
    return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
