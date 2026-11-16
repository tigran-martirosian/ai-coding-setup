// Pairing on the PC (pipe design, section 2). The PC makes the secret S, shows "<pcId>.<S>" on a local page,
// checks the phone's mac1 and Telegram's signature itself, binds to the first Telegram id that pairs, answers
// pair-ok with mac2 and keeps the channel key K per device. S lives in memory only: 10 minutes, one use,
// 5 wrong MACs end it.
// A further device also joins by an OK on a paired device (section 15, createJoin below): the PC checks the ask,
// shows the check number on the paired devices' cards, and on OK seals the new device's own K to its key.
import http from "node:http";
import {
  checkInitData,
  checkPairMac1,
  fromB64u,
  groupCode,
  joinCommit,
  joinKey,
  joinMac,
  joinWord,
  KINDS,
  makePairCode,
  PROTOCOL,
  pairKey,
  pairMac2,
  randomBytes,
  sealBox,
  TELEGRAM_PUBLIC_KEY,
  toB64u,
} from "../../../../phone/shared/seal.mjs";
import { identityPrivate, MAX_DEVICES } from "./keys.mjs";
import { log } from "./log.mjs";
import { testOverride } from "./mode.mjs";
import { qrSvg } from "./qr.mjs";
import { ActionError } from "./registry.mjs";

const LIFE_MS = 10 * 60 * 1000;
const MAX_TRIES = 5;
const DEV = /^[A-Za-z0-9_-]{22}$/;
const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ASK_LIFE_MS = 3 * MINUTE;
const REVEAL_MS = 30 * 1000;
const REFUSED_MS = 10 * MINUTE;
const UNCONFIRMED_MS = 10 * MINUTE;
const ASKS_PER_HOUR = 5;

// Bytes from base64url text of exactly `n` bytes, else null.
function bytesOf(text, n) {
  try {
    const b = fromB64u(text);
    return b.length === n ? b : null;
  } catch {
    return null;
  }
}

// The Telegram user of a signed initData, checked by the PC itself; throws an Error with `code`.
async function telegramUser(initData, keys, nowMs) {
  if (!keys.botId)
    throw Object.assign(new Error("no bot id yet"), { code: "no-bot-id" });
  const { user } = await checkInitData(
    initData,
    keys.botId,
    testOverride("PHONE_PC_TG_KEY") || TELEGRAM_PUBLIC_KEY,
    nowMs,
  );
  return user;
}

// onAdded(entry, tgId) is called after a code pairing that added a second or later device (createJoin's `added`).
export function createPairing({ keys, saveKeys, send, onAdded }) {
  let code = null; // { secret, until, tries, page }

  const fail = (dev, reason) => {
    log("pair-fail", reason);
    send({ v: PROTOCOL, t: "pair-fail", dev, reason });
  };

  function end() {
    if (code?.page) code.page.close();
    code = null;
  }

  return {
    // Makes a new S (an older code stops working) and the local page that shows it.
    async start() {
      end();
      const secret = randomBytes(16);
      const text = makePairCode(keys.pcId, secret);
      code = { secret, until: Date.now() + LIFE_MS, tries: 0, page: null };
      code.page = await servePairPage(text);
      const mine = code;
      setTimeout(() => code === mine && end(), LIFE_MS).unref();
      log("pair-code", "shown");
      return { code: text, grouped: groupCode(text), url: code.page.url };
    },

    async onPair(f) {
      const dev = typeof f.dev === "string" && DEV.test(f.dev) ? f.dev : null;
      if (!dev) return log("pair-fail", "bad device id");
      if (!code || Date.now() > code.until) return fail(dev, "no-code");
      if (f.pcId !== keys.pcId) return fail(dev, "other-pc");
      let devicePub;
      let mac1;
      try {
        devicePub = fromB64u(f.DP);
        mac1 = fromB64u(f.mac1);
      } catch {
        return fail(dev, "bad-input");
      }
      if (devicePub.length !== 32 || typeof f.initData !== "string")
        return fail(dev, "bad-input");
      // A page before DV4 sends no kind: its entry is written without one, as an old entry ("kind not recorded").
      // DV4 makes the page send its kind with `pair`; a kind that is there but off the list is refused.
      if (f.kind !== undefined && !Object.hasOwn(KINDS, f.kind))
        return fail(dev, "bad-kind");
      const s = code.secret;
      if (!(await checkPairMac1(s, mac1, keys.pcId, devicePub, f.initData))) {
        code.tries++;
        if (code.tries >= MAX_TRIES) end();
        return fail(dev, "bad-mac");
      }
      let user;
      try {
        user = await telegramUser(f.initData, keys, Date.now());
      } catch (e) {
        return fail(dev, e.code);
      }
      if (keys.ownerTgId !== null && keys.ownerTgId !== user.id)
        return fail(dev, "other-user");
      const others = keys.devices.filter((d) => d.device !== dev);
      if (others.length >= MAX_DEVICES) return fail(dev, "too-many-devices");
      const pcPub = fromB64u(keys.identity.pub);
      const K = await pairKey(
        await identityPrivate(keys),
        devicePub,
        s,
        keys.pcId,
        devicePub,
        pcPub,
      );
      const mac2 = await pairMac2(s, keys.pcId, devicePub, pcPub);
      end();
      keys.ownerTgId = user.id;
      const entry = {
        device: dev,
        K: toB64u(K),
        ...(f.kind === undefined ? {} : { kind: f.kind }),
        pairedAt: new Date().toISOString(),
        via: "code",
        confirmed: true,
      };
      keys.devices = [...others, entry];
      saveKeys(keys);
      send({
        v: PROTOCOL,
        t: "pair-ok",
        dev,
        PCP: keys.identity.pub,
        mac2: toB64u(mac2),
      });
      send({ v: PROTOCOL, t: "paired", tgId: user.id });
      log("paired", `device ${keys.devices.length} of ${MAX_DEVICES}`);
      // A second or later device leaves the bot line and the notice on the others, as a join by OK does.
      if (others.length) onAdded(entry, user.id);
    },
  };
}

// A further device joins by an OK on a paired device (pipe design, section 15). The request lives in memory only;
// timers are checked at each frame and at tick(), so a test can drive the clock with `now`.
// channel: sendTo(dev, evt) -> bool, openDevices() -> [dev], closeDevice(dev). Frames from the relay come to
// onAsk, onReveal and onCancel; the paired devices' answers come through the actions register() adds.
export function createJoin({ keys, saveKeys, send, channel, now }) {
  let req = null; // { rid, dev, DN, kind, commit, Npc, tgId, waitAt, until, Nn, word, answered }
  let asks = []; // the times of this hour's join-ask frames, every one counted
  const refused = new Map(); // dev -> until
  const ended = new Map(); // rid -> why, so a late answer gets "answered"
  const written = new Map(); // dev -> when lastSeen was last written to the key file
  let line = Promise.resolve();

  // Frames of the join are taken one at a time, so two asks cannot both pass the "one request" check.
  const inLine = (fn) => {
    const turn = line.then(fn);
    line = turn.catch(() => {});
    return turn;
  };
  const fail = (dev, reason) => {
    log("join-fail", reason);
    send({ v: PROTOCOL, t: "join-fail", dev, reason });
  };
  const toCards = (body) => {
    for (const dev of channel.openDevices())
      if (!req || dev !== req.dev) channel.sendTo(dev, body);
  };
  const asked = (rid, answer) =>
    toCards({ e: "device.asked", d: { rid, answer } });

  // Ends the open request: N gets join-fail (unless it cancelled), the cards go.
  function close(why, toN = why) {
    const r = req;
    req = null;
    ended.set(r.rid, why);
    if (ended.size > 20) ended.delete(ended.keys().next().value);
    if (toN) fail(r.dev, toN);
    if (r.word) asked(r.rid, why === "refused" ? "no" : why);
  }

  function expire() {
    if (!req) return;
    const t = now();
    if (t > req.until || (!req.Nn && t > req.waitAt + REVEAL_MS))
      close("expired");
  }

  // The others hear of a new device: `unseen` on each other entry, device.joined now if open, the bot line.
  function announce(entry, tgId) {
    for (const d of keys.devices)
      if (d.device !== entry.device)
        d.unseen = [...(d.unseen ?? []), entry.device];
    saveKeys(keys);
    for (const dev of channel.openDevices())
      if (dev !== entry.device) channel.sendTo(dev, joinedEvt(entry));
    // A code pairing from a page before DV4 has no kind: no bot line, since the Hub's line names the kind.
    if (entry.kind) send({ v: PROTOCOL, t: "joined", tgId, kind: entry.kind });
    else log("joined", "not sent: the new device named no kind");
  }
  const joinedEvt = (entry) => ({
    e: "device.joined",
    d: {
      dev: entry.device,
      kind: entry.kind ?? null,
      via: entry.via,
      at: entry.pairedAt,
    },
  });

  function removeEntry(dev, why) {
    keys.devices = keys.devices.filter((d) => d.device !== dev);
    for (const d of keys.devices)
      if (d.unseen) d.unseen = d.unseen.filter((u) => u !== dev);
    written.delete(dev);
    saveKeys(keys);
    channel.closeDevice(dev);
    log("device", `removed: ${why}`);
  }

  async function ask(f) {
    const dev = typeof f.dev === "string" && DEV.test(f.dev) ? f.dev : null;
    if (!dev) return log("join-fail", "bad device id");
    const t = now();
    asks = [...asks.filter((a) => t - a < HOUR), t];
    expire();
    const DN = bytesOf(f.DN, 32);
    const commit = bytesOf(f.commit, 32);
    if (!DN || !commit || typeof f.initData !== "string")
      return fail(dev, "bad-input");
    if (!Object.hasOwn(KINDS, f.kind)) return fail(dev, "bad-kind");
    let user;
    try {
      user = await telegramUser(f.initData, keys, t);
    } catch (e) {
      return fail(dev, e.code);
    }
    if (keys.ownerTgId === null || keys.devices.length === 0)
      return fail(dev, "no-device");
    if (user.id !== keys.ownerTgId) return fail(dev, "other-user");
    if (keys.devices.length >= MAX_DEVICES)
      return fail(dev, "too-many-devices");
    if (keys.devices.some((d) => d.device === dev))
      return fail(dev, "dev-taken");
    if (asks.length > ASKS_PER_HOUR) return fail(dev, "too-many-asks");
    if (req) return fail(dev, "busy");
    if ((refused.get(dev) ?? 0) > t) return fail(dev, "refused");
    const Npc = randomBytes(16);
    req = {
      rid: toB64u(randomBytes(16)),
      dev,
      DN,
      kind: f.kind,
      commit,
      Npc,
      tgId: user.id,
      waitAt: t,
      until: t + ASK_LIFE_MS,
      Nn: null,
      word: null,
      answered: false,
    };
    log("join", "asked");
    send({
      v: PROTOCOL,
      t: "join-wait",
      dev,
      pcId: keys.pcId,
      PCP: keys.identity.pub,
      Npc: toB64u(Npc),
      open: channel.openDevices().length,
    });
  }

  async function reveal(f) {
    expire();
    if (!req || f.dev !== req.dev || req.Nn)
      return log("drop", "join-reveal of no open request");
    const Nn = bytesOf(f.Nn, 16);
    const want = Nn && (await joinCommit(req.dev, req.DN, Nn));
    if (!want || toB64u(want) !== toB64u(req.commit))
      return close("bad-reveal");
    req.Nn = Nn;
    req.word = await joinWord(
      keys.pcId,
      req.dev,
      req.DN,
      fromB64u(keys.identity.pub),
      Nn,
      req.Npc,
    );
    toCards(askEvt());
  }
  const askEvt = () => ({
    e: "device.ask",
    d: { rid: req.rid, kind: req.kind, word: req.word, until: req.until },
  });

  // The first answer wins; the request is taken before any await, so a second answer finds it gone.
  async function answer({ rid, ok }, by) {
    expire();
    if (!req || req.rid !== rid || !req.word) {
      if (ended.has(rid)) throw new ActionError("answered");
      throw new ActionError("unknown-request");
    }
    const r = req;
    if (!ok) {
      refused.set(r.dev, now() + REFUSED_MS);
      close("refused");
      return { answer: "no" };
    }
    req = null;
    ended.set(r.rid, "ok");
    const Kn = randomBytes(32);
    const PCP = fromB64u(keys.identity.pub);
    const box = await sealBox(r.DN, Kn);
    const J = await joinKey(
      await identityPrivate(keys),
      r.DN,
      r.Nn,
      r.Npc,
      keys.pcId,
      r.dev,
      r.DN,
      PCP,
    );
    const mac3 = await joinMac(J, r.dev, box);
    const entry = {
      device: r.dev,
      K: toB64u(Kn),
      kind: r.kind,
      pairedAt: new Date(now()).toISOString(),
      via: "ok",
      okBy: by,
      confirmed: false,
    };
    const before = keys.devices;
    keys.devices = [...before, entry];
    try {
      saveKeys(keys);
    } catch (e) {
      keys.devices = before;
      log("error", `join: the key file was not written: ${e.message}`);
      fail(r.dev, "pc-error");
      asked(r.rid, "cancelled");
      throw new ActionError("pc-error");
    }
    send({
      v: PROTOCOL,
      t: "join-ok",
      dev: r.dev,
      box: toB64u(box),
      mac3: toB64u(mac3),
    });
    asked(r.rid, "ok");
    log("join", "ok");
    announce(entry, r.tgId);
    return { answer: "ok" };
  }

  return {
    onAsk: (f) => inLine(() => ask(f)),
    onReveal: (f) => inLine(() => reveal(f)),
    onCancel: (f) =>
      inLine(() => {
        expire();
        if (req && f.dev === req.dev) close("cancelled", null);
      }),

    // The request's timers, the refusals' and the 10-minute clean-up of entries no hello confirmed.
    tick: () =>
      inLine(() => {
        expire();
        const t = now();
        for (const [dev, until] of refused) if (until <= t) refused.delete(dev);
        for (const d of keys.devices)
          if (
            d.confirmed === false &&
            t - Date.parse(d.pairedAt) >= UNCONFIRMED_MS
          )
            removeEntry(d.device, "never confirmed");
      }),

    // Called by the channel once a device's channel session has started.
    onHello(dev) {
      const entry = keys.devices.find((d) => d.device === dev);
      if (!entry) return;
      const t = now();
      // lastSeen goes to the key file at most once an hour; the first hello after an OK confirms the entry.
      if (entry.confirmed === false || t - (written.get(dev) ?? 0) >= HOUR) {
        if (entry.confirmed === false) entry.confirmed = true;
        entry.lastSeen = new Date(t).toISOString();
        written.set(dev, t);
        saveKeys(keys);
      }
      expire();
      if (req?.word && dev !== req.dev) channel.sendTo(dev, askEvt());
      for (const u of entry.unseen ?? []) {
        const joined = keys.devices.find((d) => d.device === u);
        if (joined) channel.sendTo(dev, joinedEvt(joined));
      }
    },

    // A code pairing added a second or later device.
    added: (entry, tgId) => announce(entry, tgId),

    // A device may remove only itself and devices paired after it (UN1's devices.remove calls this).
    remove(by, dev) {
      const asker = keys.devices.find((d) => d.device === by);
      const target = keys.devices.find((d) => d.device === dev);
      if (!asker || !target) throw new ActionError("unknown-device");
      if (dev !== by && !(target.pairedAt > asker.pairedAt))
        throw new ActionError("not-allowed");
      removeEntry(dev, "asked");
      return { removed: dev };
    },

    register(registry) {
      registry.add({
        name: "device.answer",
        input: {
          rid: { type: "string", min: 22, max: 22, pattern: DEV },
          ok: { type: "boolean" },
        },
        run: (d, ctx) => inLine(() => answer(d, ctx.device)),
      });
      registry.add({
        name: "device.seen",
        input: { dev: { type: "string", min: 22, max: 22, pattern: DEV } },
        run(d, ctx) {
          const entry = keys.devices.find((x) => x.device === ctx.device);
          if (!entry) throw new ActionError("unknown-device");
          if (entry.unseen?.includes(d.dev)) {
            entry.unseen = entry.unseen.filter((u) => u !== d.dev);
            saveKeys(keys);
          }
          return { seen: d.dev };
        },
      });
    },
  };
}

const esc = (s) =>
  s.replace(
    /[&<>"]/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c],
  );

// The local page on 127.0.0.1 with the code as a QR (drawn here as inline SVG: the page loads nothing), as text and
// with a Copy button. The phone's pairing screen scans the QR with Telegram's scanner. Only a request whose Host is
// this address and port gets the code, so another web page cannot read it through a renamed address.
export function servePairPage(text) {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const host = `127.0.0.1:${server.address().port}`;
      if (req.headers.host !== host || req.url !== "/pair") {
        res.writeHead(404).end();
        return;
      }
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Content-Security-Policy":
          "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'",
        "Cache-Control": "no-store",
      });
      res.end(`<!doctype html><meta charset="utf-8"><title>Pair your phone</title>
<style>body{font:16px system-ui;margin:3em;max-width:40em}code{font-size:1.4em;word-break:break-all}svg{display:block}</style>
<h1>Pair your phone</h1>
<p>In the app, tap "Scan the code on your PC" and scan this. It works for 10 minutes, once.</p>
${qrSvg(text)}
<p>Or tap "Type the code instead" in the app and paste this code:</p>
<p><code id="c">${esc(groupCode(text))}</code></p>
<button onclick="navigator.clipboard.writeText('${esc(text)}')">Copy</button>`);
    });
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () =>
      resolve({
        url: `http://127.0.0.1:${server.address().port}/pair`,
        close: () => server.close(),
      }),
    );
  });
}
