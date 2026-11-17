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
//   download   async (filePath) -> bytes of a Telegram file (only the bot uses it)
//   now        () -> milliseconds since 1970
//   log        (line) -> void; never given a token, a key or a frame's contents
//   botId, ownerTgId   numbers; telegramKey   hex of Telegram's Ed25519 public key for initData
//   bot        null until the bot is built (row B5), else makeBot(ctx) -> { webhook, pcConnected, pcFrame }:
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
    "download",
    "now",
    "log",
    "botId",
    "ownerTgId",
    "telegramKey",
  ]) {
    if (env[name] === undefined || env[name] === null)
      throw new Error(`hub: missing ${name}`);
  }
  if (env.bot === undefined)
    throw new Error("hub: bot must be given, as null until it is built");
  if (typeof env.sockets.lastPing !== "function")
    throw new Error("hub: sockets.lastPing(ws) is missing");
  for (const name of ["botId", "ownerTgId"]) {
    if (!Number.isSafeInteger(env[name]) || env[name] <= 0)
      throw new Error(`hub: ${name} must be a positive whole number`);
  }
  const { store, sockets, telegram, now, log, botId, ownerTgId } = env;
  let telegramKey = null;

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
    const keep = [dayKey(t), dayKey(t - DAY)];
    for (const [key] of await store.list("day:")) {
      if (!keep.includes(key)) await store.delete(key);
    }
  }

  // ---- checks ----

  async function checkInitData(initData) {
    if (typeof initData !== "string" || !initData) return null;
    const params = new URLSearchParams(initData);
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
    if (f.t === "held-ack" || f.t === "fetch") {
      if (!bot) return fail(ws, "no-bot");
      return bot.pcFrame(a.pcId, f);
    }
    return fail(ws, "not-allowed");
  }

  // ---- signing in (section 3) ----

  async function phoneAuth(ws, a, f) {
    const who = await checkInitData(f.initData);
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
    });
    reply(ws, { t: "pc-auth", ok: true, botId, paired: pc.tgId !== null });
    // A page waiting on "PC off" says hello at once (steady design, section 1).
    if (pc.tgId !== null) {
      for (const p of live())
        if (att(p).role === "phone" && att(p).tgId === pc.tgId)
          reply(p, { t: "pc-online" });
    }
    if (bot) await bot.pcConnected(f.pcId);
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
    reply(ws, { t: "pc-join", ok: true, botId });
  }

  // ---- pairing (section 2): the Hub passes the messages and records a pair only when it saw it ----

  async function phonePair(ws, a, f, text) {
    const who = await checkInitData(f.initData);
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
    const who = await checkInitData(f.initData);
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
    const hour = Math.floor(t / HOUR);
    const sent = a.alerts && a.alerts.hour === hour ? a.alerts.n : 0;
    if (sent >= ALERTS_PER_HOUR) return fail(ws, "alert-rate");
    sockets.setAttachment(ws, {
      ...a,
      joins: a.joins.filter((x) => x !== j),
      pairs: a.pairs.map((x) => (x === p ? { ...x, lined: true } : x)),
      alerts: { hour, n: sent + 1 },
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
    const hour = Math.floor(now() / HOUR);
    const sent = a.alerts && a.alerts.hour === hour ? a.alerts.n : 0;
    if (sent >= ALERTS_PER_HOUR) return fail(ws, "alert-rate");
    sockets.setAttachment(ws, { ...a, alerts: { hour, n: sent + 1 } });
    const msg = await telegram("sendMessage", {
      chat_id: pc.tgId,
      text: f.text,
      disable_notification: f.silent,
      reply_markup: {
        inline_keyboard: [
          [{ text: "Open", web_app: { url: `${a.origin}/?o=${f.open}` } }],
        ],
      },
    });
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

  return { open, message, closed, webhook };
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
