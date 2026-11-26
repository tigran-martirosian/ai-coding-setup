// Tests the phone relay's Hub through the local relay (phone/relay/local/server.mjs), with Node's own WebSocket
// client as the phone pages and the PC programs; dead links, the kept store and the cut proxy of the steady design
// (docs/2026-11-16-phone-steady-design.md, section 3) at the end. The sealed blobs are AES-GCM under a key only the test holds,
// so the Hub sees what it sees on Cloudflare: bytes it cannot open. Telegram's initData key is a key pair the
// test makes. Checks: pipe design section 12, row B1.   node tests/test-phone-relay.mjs
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  fixedLengthStream,
  mapStore,
  startLocalRelay,
} from "../phone/relay/local/server.mjs";
import {
  createHub,
  PING,
  PONG,
  pcIdOf,
  toB64url,
} from "../phone/relay/src/hub.mjs";
import * as seal from "../phone/shared/seal.mjs";
import { startCutProxy } from "./phone-bot/cut-proxy.mjs";

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const random = (n) => crypto.getRandomValues(new Uint8Array(n));

let passed = 0;
let failed = 0;
function check(name, ok, detail = "") {
  if (ok) passed += 1;
  else failed += 1;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${detail}`}`);
}
const same = (name, got, want) =>
  check(
    name,
    JSON.stringify(got) === JSON.stringify(want),
    `got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`,
  );

const BOT_ID = 4242;
const OWNER = 1001;
const FRIEND = 2002;
const THIRD = 3003;
const STRANGER = 9009;
// Plain text that travels only inside sealed blobs; the Hub's store and log must never hold it.
const MARKER = `plain-marker-${toB64url(random(9))}`;
const POLICY =
  "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; " +
  "media-src 'self' blob:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; " +
  "frame-ancestors https://web.telegram.org";
const SECOND = 1000;
const MINUTE = 60_000;

let clock = Date.UTC(2026, 10, 14, 12, 0, 0);
const logLines = [];
const telegramCalls = [];
let tgMessageId = 700;
let refuseTelegram = null;
const tgKey = await subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);
const otherKey = await subtle.generateKey({ name: "Ed25519" }, true, [
  "sign",
  "verify",
]);
const tgKeyHex = Buffer.from(
  await subtle.exportKey("raw", tgKey.publicKey),
).toString("hex");

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-relay-"));
fs.writeFileSync(path.join(tmp, "index.html"), "<!doctype html><p>page</p>");
fs.writeFileSync(path.join(tmp, "version.json"), '{"version":"0.0.0"}');

const relayOpts = {
  port: 0,
  pageDir: tmp,
  botId: BOT_ID,
  ownerTgId: OWNER,
  telegramKey: tgKeyHex,
  // Like Telegram: a sent message has an id; the method named in `refuseTelegram` fails as Telegram refuses it.
  // getMe (the topic mode read at a paired PC's sign-in) answers topic mode off and is not kept in telegramCalls.
  telegram: async (method, params) => {
    if (method === "getMe") return { id: BOT_ID, has_topics_enabled: false };
    telegramCalls.push({ method, params });
    if (method === refuseTelegram)
      throw new Error(
        `telegram ${method}: Bad Request: message can't be deleted`,
      );
    return method === "sendMessage" ? { message_id: ++tgMessageId } : {};
  },
  download: async () => {
    throw new Error("this test downloads nothing");
  },
  now: () => clock,
  log: (line) => logLines.push(line),
  bot: null,
};
let relay = await startLocalRelay(relayOpts);
const dump = () => JSON.stringify([...relay.map]);

// The invite list is the bot's to fill (row B5); here the test writes it as the bot would.
for (const id of [FRIEND, THIRD]) {
  relay.map.set(`user:${id}`, {
    invitedAt: clock,
    firstName: "Tester",
    pcId: null,
  });
}

// ---- helpers ----

async function initData(tgId, { key = tgKey, ageMs = 0 } = {}) {
  const fields = {
    auth_date: String(Math.floor((clock - ageMs) / 1000)),
    query_id: "AAqTest",
    user: JSON.stringify({ id: tgId, first_name: "Tester" }),
  };
  const lines = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const data = enc.encode(`${BOT_ID}:WebAppData\n${lines.join("\n")}`);
  const sig = await subtle.sign({ name: "Ed25519" }, key.privateKey, data);
  const params = new URLSearchParams(fields);
  params.set("hash", "00");
  params.set("signature", toB64url(new Uint8Array(sig)));
  return params.toString();
}

// Lets the frames cross the socket, then waits until the Hub has handled them.
async function settle() {
  await new Promise((done) => setTimeout(done, 40));
  await relay.idle();
  await new Promise((done) => setTimeout(done, 20));
}

async function connect(url = relay.url) {
  const ws = new WebSocket(`${url.replace("http", "ws")}/ws`);
  const c = { ws, inbox: [], closedWith: null };
  ws.addEventListener("message", (e) => c.inbox.push(e.data));
  ws.addEventListener("close", (e) => {
    c.closedWith = { code: e.code, reason: e.reason };
  });
  await new Promise((done, failure) => {
    ws.addEventListener("open", done);
    ws.addEventListener("error", failure);
  });
  c.send = (frame) =>
    ws.send(typeof frame === "string" ? frame : JSON.stringify(frame));
  c.take = () => c.inbox.splice(0);
  c.takeJson = () => c.take().map((t) => JSON.parse(t));
  await settle();
  return c;
}

// A ping as a PC or a page sends it; the relay's pong is taken from the inbox.
async function ping(c) {
  c.send(PING);
  await settle();
  const at = c.inbox.indexOf(PONG);
  if (at < 0) throw new Error("the relay answered a ping with no pong");
  c.inbox.splice(at, 1);
}

// Any new socket wakes the Hub, and the Hub looks for dead links then.
async function wake() {
  (await connect()).ws.close();
  await settle();
}

async function phone(tgId) {
  const c = await connect();
  c.send({ v: 1, t: "auth", initData: await initData(tgId) });
  await settle();
  return c;
}

async function newPc() {
  const token = random(32);
  const pc = await connect();
  pc.token = toB64url(token);
  pc.pcId = await pcIdOf(token);
  pc.send({
    v: 1,
    t: "pc-join",
    pcId: pc.pcId,
    token: pc.token,
    inboxPub: toB64url(random(32)),
    pcVersion: "26.3",
  });
  await settle();
  return pc;
}

async function pair(phoneSocket, tgId, pc) {
  phoneSocket.send({
    v: 1,
    t: "pair",
    pcId: pc.pcId,
    DP: toB64url(random(32)),
    initData: await initData(tgId),
    mac1: toB64url(random(32)),
  });
  await settle();
  const seen = pc.take();
  pc.send({
    v: 1,
    t: "pair-ok",
    PCP: toB64url(random(32)),
    mac2: toB64url(random(32)),
  });
  await settle();
  const back = phoneSocket.take();
  pc.send({ v: 1, t: "paired", tgId });
  await settle();
  return { seen, back, answer: pc.takeJson() };
}

// A sealed app frame: the body is AES-GCM under a key only the two test ends hold.
const channelKey = await subtle.generateKey(
  { name: "AES-GCM", length: 256 },
  true,
  ["encrypt", "decrypt"],
);
async function sealedFrame(dev, n, body) {
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setUint32(8, n);
  const head = { v: 1, t: "app", dev, sid: "s1", n };
  const sealed = await subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: enc.encode(JSON.stringify(head)) },
    channelKey,
    enc.encode(JSON.stringify(body)),
  );
  return JSON.stringify({ ...head, c: toB64url(new Uint8Array(sealed)) });
}
async function openFrame(text) {
  const { v, t, dev, sid, n, c } = JSON.parse(text);
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setUint32(8, n);
  const bytes = Buffer.from(c, "base64url");
  const plain = await subtle.decrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: enc.encode(JSON.stringify({ v, t, dev, sid, n })),
    },
    channelKey,
    bytes,
  );
  return JSON.parse(new TextDecoder().decode(plain));
}

// ---- page files carry the content policy (section 6) ----

for (const file of ["/", "/version.json"]) {
  const res = await fetch(relay.url + file);
  same(
    `${file} carries the content policy, nosniff and no-referrer`,
    [
      res.status,
      res.headers.get("content-security-policy"),
      res.headers.get("x-content-type-options"),
      res.headers.get("referrer-policy"),
    ],
    [200, POLICY, "nosniff", "no-referrer"],
  );
}

// ---- page files load fast: compressed when asked, an ETag, a 304 on a repeat, nothing kept as immutable ----
// node:http, not fetch: fetch unpacks the body and hides Content-Encoding.
{
  const http = await import("node:http");
  const zlib = await import("node:zlib");
  const script = `${"export const line = 'a page script line';\n".repeat(200)}`;
  fs.writeFileSync(path.join(tmp, "app.js"), script);
  const get = (file, headers = {}) =>
    new Promise((done, failed) => {
      http
        .get(relay.url + file, { headers }, (res) => {
          const chunks = [];
          res.on("data", (c) => chunks.push(c));
          res.on("end", () =>
            done({
              status: res.statusCode,
              headers: res.headers,
              body: Buffer.concat(chunks),
            }),
          );
        })
        .on("error", failed);
    });
  const br = await get("/app.js", { "accept-encoding": "gzip, deflate, br" });
  same(
    "a page file asked with br comes br-compressed and unpacks to the file (FAIL: the page goes uncompressed)",
    [
      br.status,
      br.headers["content-encoding"],
      br.body.length < script.length,
      br.headers["content-encoding"] === "br" &&
        zlib.brotliDecompressSync(br.body).toString() === script,
    ],
    [200, "br", true, true],
  );
  const gz = await get("/app.js", { "accept-encoding": "gzip" });
  same(
    "a page file asked with gzip only comes gzip-compressed and unpacks to the file",
    [
      gz.headers["content-encoding"],
      gz.headers["content-encoding"] === "gzip" &&
        zlib.gunzipSync(gz.body).toString() === script,
    ],
    ["gzip", true],
  );
  const plain = await get("/app.js");
  same(
    "a page file asked with no Accept-Encoding comes whole and plain",
    [plain.headers["content-encoding"], plain.body.toString() === script],
    [undefined, true],
  );
  // A stand-in when none came, so the checks below fail instead of the request.
  const etag = br.headers.etag ?? '"none"';
  check(
    "a page file carries an ETag and Vary: Accept-Encoding (FAIL: a phone cannot ask whether it changed)",
    typeof etag === "string" &&
      etag.length > 2 &&
      /accept-encoding/i.test(br.headers.vary ?? ""),
    JSON.stringify(br.headers),
  );
  const again = await get("/app.js", {
    "accept-encoding": "gzip, deflate, br",
    "if-none-match": etag,
  });
  same(
    "a repeat with If-None-Match answers 304 with no body, the content policy kept (FAIL: the phone loads it again)",
    [
      again.status,
      again.body.length,
      again.headers.etag,
      again.headers["content-security-policy"],
    ],
    [304, 0, etag, POLICY],
  );
  fs.writeFileSync(path.join(tmp, "app.js"), `${script}// changed\n`);
  const changed = await get("/app.js", {
    "accept-encoding": "gzip, deflate, br",
    "if-none-match": etag,
  });
  same(
    "a changed file answers 200 with a new ETag to the old one (FAIL: the phone keeps an old page)",
    [changed.status, changed.headers.etag !== etag],
    [200, true],
  );
  check(
    "no page file is marked immutable (FAIL: its name carries no hash, so a phone would keep an old copy)",
    ![br, gz, plain, changed].some((r) =>
      /immutable/.test(r.headers["cache-control"] ?? ""),
    ),
    JSON.stringify(br.headers["cache-control"]),
  );
  const picked = [];
  for (const asked of [
    "gzip;q=1.0, br;q=0.5",
    "*",
    "br;q=0, *",
    "gzip;q=0, *;q=0.1",
    "deflate",
  ])
    picked.push(
      (await get("/app.js", { "accept-encoding": asked })).headers[
        "content-encoding"
      ] ?? "plain",
    );
  same(
    "Accept-Encoding is followed by its q-values, and * allows br and gzip (FAIL: a client gets a form it " +
      "ranked lower, or none it allowed)",
    picked,
    ["gzip", "br", "gzip", "br", "plain"],
  );
  fs.rmSync(path.join(tmp, "app.js"));

  // A tool that writes the same number of bytes and puts the old modified time back (as a copy that keeps times
  // does): the file is still new.
  const same1 = path.join(tmp, "same.js");
  const keptTime = Math.floor(Date.now() / 1000) - 3600;
  fs.writeFileSync(same1, "export const word = 'aaaa';\n".repeat(50));
  fs.utimesSync(same1, keptTime, keptTime);
  const before = await get("/same.js");
  // a second write in the same clock tick keeps the change time on some Windows disks (GitHub runners): wait one
  await new Promise((r) => setTimeout(r, 1100));
  fs.writeFileSync(same1, "export const word = 'bbbb';\n".repeat(50));
  fs.utimesSync(same1, keptTime, keptTime);
  const after = await get("/same.js");
  same(
    "a page file rewritten with the same size and modified time comes new (FAIL: the relay keeps sending the " +
      "old page)",
    [
      before.body.toString().includes("aaaa"),
      after.body.toString().includes("bbbb"),
      after.headers.etag !== before.headers.etag,
    ],
    [true, true, true],
  );
  fs.rmSync(same1);
}

// ---- signing in (section 3) ----

{
  const c = await connect();
  c.send({
    v: 1,
    t: "auth",
    initData: await initData(OWNER, { key: otherKey }),
  });
  await settle();
  same("initData signed by another key: closed 4401 bad-sign", c.closedWith, {
    code: 4401,
    reason: "bad-sign",
  });
}
{
  const c = await connect();
  const good = await initData(FRIEND);
  c.send({ v: 1, t: "auth", initData: good.replace("Tester", "Tester2") });
  await settle();
  same("initData changed after signing: closed 4401 bad-sign", c.closedWith, {
    code: 4401,
    reason: "bad-sign",
  });
}
{
  const c = await connect();
  const old = await initData(FRIEND, { ageMs: 24 * 60 * MINUTE + 1000 });
  c.send({ v: 1, t: "auth", initData: old });
  await settle();
  same("initData older than 24 hours: closed 4401 bad-sign", c.closedWith, {
    code: 4401,
    reason: "bad-sign",
  });
}
{
  const c = await connect();
  const before = dump();
  c.send({ v: 1, t: "auth", initData: await initData(STRANGER) });
  await settle();
  same("an uninvited id: closed 4401 not-invited", c.closedWith, {
    code: 4401,
    reason: "not-invited",
  });
  check("an uninvited id writes nothing to the store", dump() === before);
}
{
  const c = await connect();
  c.send({ v: 1, t: "app", dev: "d", sid: "s", n: 0, c: "AA" });
  await settle();
  same("a first frame that is not a sign-in: closed 4400", c.closedWith, {
    code: 4400,
    reason: "auth-first",
  });
}

const owner = await phone(OWNER);
check(
  "the owner is let in without an invite, and gets a user record",
  owner.closedWith === null && relay.map.has(`user:${OWNER}`),
);
owner.send('{"t":"ping"}');
await settle();
same("ping is answered with pong", owner.take(), ['{"t":"pong"}']);
owner.send({ v: 2, t: "app" });
await settle();
same("an unknown protocol version is refused", owner.takeJson(), [
  { v: 1, t: "error", e: "protocol" },
]);

// ---- PC join (section 3) ----

const pc1 = await newPc();
same(
  "pc-join answers ok with the bot id and files: 1 (FAIL: a newly joined PC refuses Send to chat as relay-too-old)",
  pc1.takeJson(),
  [{ v: 1, t: "pc-join", ok: true, botId: BOT_ID, files: 1 }],
);
{
  const record = JSON.stringify(relay.map.get(`pc:${pc1.pcId}`));
  const c = await connect();
  c.send({
    v: 1,
    t: "pc-join",
    pcId: pc1.pcId,
    token: pc1.token,
    inboxPub: toB64url(random(32)),
    pcVersion: "26.9",
  });
  await settle();
  same("pc-join of an existing pcId: closed 4409 pc-exists", c.closedWith, {
    code: 4409,
    reason: "pc-exists",
  });
  check(
    "the existing record is unchanged",
    JSON.stringify(relay.map.get(`pc:${pc1.pcId}`)) === record,
  );
  const d = await connect();
  d.send({
    v: 1,
    t: "pc-join",
    pcId: await pcIdOf(random(32)),
    token: toB64url(random(32)),
    inboxPub: toB64url(random(32)),
    pcVersion: "26.3",
  });
  await settle();
  same(
    "pc-join whose pcId is not its token's: closed 4409 pc-id",
    d.closedWith,
    {
      code: 4409,
      reason: "pc-id",
    },
  );
}
{
  const c = await connect();
  c.send({ v: 1, t: "pc-auth", pcId: pc1.pcId, token: toB64url(random(32)) });
  await settle();
  same("pc-auth with a wrong token: closed 4401", c.closedWith, {
    code: 4401,
    reason: "bad-token",
  });
}

// ---- alerts from an unpaired PC (section 5) ----

pc1.send({
  v: 1,
  t: "alert",
  text: "demo: needs you",
  silent: false,
  open: "h1",
});
await settle();
same(
  "an alert from an unpaired PC is refused with not-paired",
  pc1.takeJson(),
  [{ v: 1, t: "error", e: "not-paired" }],
);
check("and the fake Telegram records no call", telegramCalls.length === 0);
relay.map.set(`alert:${FRIEND}:h1`, { msg: 1, at: clock });
pc1.send({ v: 1, t: "alert-done", open: "h1" });
await settle();
same(
  "a delete request from an unpaired PC is refused with not-paired",
  [pc1.takeJson(), telegramCalls.length, relay.map.has(`alert:${FRIEND}:h1`)],
  [[{ v: 1, t: "error", e: "not-paired" }], 0, true],
);
relay.map.delete(`alert:${FRIEND}:h1`);

// ---- pairing (section 2) ----

const friend = await phone(FRIEND);
{
  const r = await pair(friend, FRIEND, pc1);
  check(
    "pair reaches the PC as sent; pair-ok reaches the phone",
    r.seen.length === 1 &&
      JSON.parse(r.seen[0]).t === "pair" &&
      r.back.length === 1 &&
      JSON.parse(r.back[0]).t === "pair-ok",
  );
  same("paired is accepted", r.answer, [{ v: 1, t: "paired", ok: true }]);
  same(
    "the store links the user and the PC",
    [
      relay.map.get(`user:${FRIEND}`).pcId,
      relay.map.get(`pc:${pc1.pcId}`).tgId,
    ],
    [pc1.pcId, FRIEND],
  );
}
{
  const pc = await newPc();
  pc.take();
  pc.send({ v: 1, t: "paired", tgId: THIRD });
  await settle();
  same("paired with no pair seen is refused", pc.takeJson(), [
    { v: 1, t: "error", e: "no-pair" },
  ]);
  pc.ws.close();
}

// ---- sealed frames pass unchanged (sections 3 and 4) ----

const DEV = toB64url(random(16));
{
  const frame = await sealedFrame(DEV, 0, {
    k: "req",
    id: "r-1",
    a: "x",
    d: MARKER,
  });
  friend.send(frame);
  await settle();
  const got = pc1.take();
  check(
    "a sealed frame from the phone reaches its PC byte for byte",
    got[0] === frame,
  );
  const body = got.length === 1 ? await openFrame(got[0]) : null;
  check("and the PC opens it", body && body.d === MARKER);
  const answer = await sealedFrame(DEV, 0, {
    k: "res",
    id: "r-1",
    ok: true,
    d: MARKER,
  });
  pc1.send(answer);
  await settle();
  same(
    "the PC's sealed answer reaches that phone byte for byte",
    friend.take(),
    [answer],
  );
}

const third = await phone(THIRD);
const pc2 = await newPc();
pc2.take();
await pair(third, THIRD, pc2);
third.send(await sealedFrame(toB64url(random(16)), 0, { k: "req", d: "x" }));
await settle();
check(
  "a third user's frame goes to his own PC, never to the friend's",
  pc1.take().length === 0 && pc2.take().length === 1,
);
pc2.send(await sealedFrame(DEV, 0, { k: "res", d: "x" }));
await settle();
check(
  "his PC cannot reach the friend's phone, even by naming its device",
  friend.take().length === 0 && third.take().length === 0,
);
same("his PC is told that device is offline", pc2.takeJson(), [
  { v: 1, t: "offline", dev: DEV },
]);
{
  const record = JSON.stringify(relay.map.get(`pc:${pc1.pcId}`));
  const r = await pair(third, THIRD, pc1);
  same(
    "paired for a PC paired to another id is refused with pc-taken",
    r.answer,
    [{ v: 1, t: "error", e: "pc-taken" }],
  );
  check(
    "and its record is unchanged",
    JSON.stringify(relay.map.get(`pc:${pc1.pcId}`)) === record,
  );
}

// ---- alerts from a paired PC (section 5) ----

for (const [what, open] of [
  ["17 characters", "a".repeat(17)],
  ["a ?", "a?b"],
  ["a /", "a/b"],
]) {
  pc1.send({ v: 1, t: "alert", text: "demo: needs you", silent: false, open });
  await settle();
  same(`an alert whose open handle has ${what} is refused`, pc1.takeJson(), [
    { v: 1, t: "error", e: "alert-open" },
  ]);
}
pc1.send({
  v: 1,
  t: "alert",
  text: `demo: ${MARKER}`,
  silent: false,
  open: "h1",
});
await settle();
same("an alert with other text is refused", pc1.takeJson(), [
  { v: 1, t: "error", e: "alert-text" },
]);
for (const [what, text] of [
  ["an ending other than the three", "demo · Release notes draft: done"],
  ["a cut ending", "demo · Release notes draft: handed off"],
  ["an empty title", "demo · : finished"],
  ["a title of 61 characters", `demo · ${"x".repeat(61)}: finished`],
  ["a / in the title", "demo · a/b: finished"],
  ["a new line after the ending", "demo · Notes: finished\n"],
  ["a title with no project", "· Notes: finished"],
]) {
  pc1.send({ v: 1, t: "alert", text, silent: false, open: "h1" });
  await settle();
  same(`an alert with ${what} is refused`, pc1.takeJson(), [
    { v: 1, t: "error", e: "alert-text" },
  ]);
}
check(
  "none of the refused alerts reached Telegram",
  telegramCalls.length === 0,
);
pc1.send({
  v: 1,
  t: "alert",
  text: "demo: needs you",
  silent: true,
  open: "h1",
});
await settle();
same(
  "a good alert goes to the paired user's chat, silent, with its Open button",
  telegramCalls.map((c) => [
    c.method,
    c.params.chat_id,
    c.params.text,
    c.params.disable_notification,
    c.params.reply_markup.inline_keyboard[0][0].web_app.url,
  ]),
  [["sendMessage", FRIEND, "demo: needs you", true, `${relay.url}/?o=h1`]],
);
// A titled alert takes each of the three endings; the title may hold letters of any script.
const TITLED = [
  "demo · Release notes draft: finished",
  "demo · Release notes draft: handed off, continuing",
  "demo · Заметки 2.0_x-y: needs you",
];
for (const text of TITLED)
  pc1.send({ v: 1, t: "alert", text, silent: false, open: "h1" });
await settle();
same(
  "a titled alert with each of the three endings goes to the chat",
  [pc1.takeJson(), telegramCalls.slice(1).map((c) => c.params.text)],
  [[], TITLED],
);
// 1 + 3 alerts went out this hour; 26 more reach the limit of 30.
for (let i = 0; i < 26; i++)
  pc1.send({
    v: 1,
    t: "alert",
    text: "demo: finished",
    silent: false,
    open: "h1",
  });
await settle();
pc1.take();
pc1.send({
  v: 1,
  t: "alert",
  text: "demo: finished",
  silent: false,
  open: "h1",
});
await settle();
same("the 31st alert in an hour is refused", pc1.takeJson(), [
  { v: 1, t: "error", e: "alert-rate" },
]);

// ---- alerts leave the chat: the PC's alert-done deletes the kept message ----

const keptAlerts = () => [...relay.map].filter(([k]) => k.startsWith("alert:"));
const lastSent = telegramCalls.filter((c) => c.method === "sendMessage").length;
same(
  "the relay keeps each alert's message id under its chat and handle, and no text",
  [
    keptAlerts(),
    ["demo", "finished", "needs you", "Release notes", "Заметки"].filter((w) =>
      JSON.stringify(keptAlerts()).includes(w),
    ),
  ],
  [[[`alert:${FRIEND}:h1`, { msg: 700 + lastSent, at: clock }]], []],
);
let before = telegramCalls.length;
pc1.send({ v: 1, t: "alert-done", open: "h1" });
await settle();
same(
  "alert-done from the paired PC deletes that message in its user's chat and forgets it",
  [pc1.takeJson(), telegramCalls.slice(before), keptAlerts()],
  [
    [],
    [
      {
        method: "deleteMessage",
        params: { chat_id: FRIEND, message_id: 700 + lastSent },
      },
    ],
    [],
  ],
);
before = telegramCalls.length;
pc1.send({ v: 1, t: "alert-done", open: "h1" });
await settle();
same(
  "alert-done for a handle no longer kept calls Telegram for nothing",
  [pc1.takeJson(), telegramCalls.length - before],
  [[], 0],
);
relay.map.set(`alert:${FRIEND}:h2`, { msg: 42, at: clock });
refuseTelegram = "deleteMessage";
pc1.send({ v: 1, t: "alert-done", open: "h2" });
await settle();
await settle();
refuseTelegram = null;
same(
  "a delete Telegram refuses is tried once, logged, and the handle is forgotten",
  [
    telegramCalls.slice(before).map((c) => c.method),
    keptAlerts(),
    logLines.filter((l) => l.startsWith("alert delete refused")).length,
  ],
  [["deleteMessage"], [], 1],
);
relay.map.set(`alert:${FRIEND}:h3`, { msg: 43, at: clock - 48 * 3600_000 });
const sweeper = await connect();
await settle();
sweeper.ws.close();
await settle();
same(
  "a kept alert 48 hours old is dropped: Telegram no longer deletes it",
  keptAlerts(),
  [],
);

// ---- PC off (section 9) ----

pc1.ws.close();
await settle();
friend.send(await sealedFrame(DEV, 1, { k: "req", d: MARKER }));
await settle();
same(
  "with the PC off the phone is told offline since when",
  friend.takeJson(),
  [{ v: 1, t: "offline", lastSeen: clock }],
);
{
  const back = await connect();
  back.send({ v: 1, t: "pc-auth", pcId: pc1.pcId, token: pc1.token });
  await settle();
  same("the PC signs in again with its token", back.takeJson(), [
    { v: 1, t: "pc-auth", ok: true, botId: BOT_ID, paired: true, files: 1 },
  ]);
  same("a PC's sign-in tells its user's pages pc-online", friend.takeJson(), [
    { v: 1, t: "pc-online" },
  ]);
  back.ws.close();
}

// ---- limits (sections 3 and 9) ----

{
  const dayKey = `day:${new Date(clock).toISOString().slice(0, 10)}`;
  const day = relay.map.get(dayKey);
  relay.map.set(dayKey, { ...day, joins: 50 });
  const c = await newPc();
  same("pc-join beyond 50 a day: closed 4429 join-limit", c.closedWith, {
    code: 4429,
    reason: "join-limit",
  });
  check("and no record is made", !relay.map.has(`pc:${c.pcId}`));
  relay.map.set(dayKey, { ...relay.map.get(dayKey), joins: day.joins });

  relay.map.set(dayKey, { ...relay.map.get(dayKey), requests: 89_999 });
  const d = await connect();
  const limit = d.takeJson();
  check(
    "from 90,000 requests a day a new socket gets limit and is closed",
    limit.length === 1 &&
      limit[0].t === "limit" &&
      limit[0].resetAt === Date.UTC(2026, 10, 15) &&
      d.closedWith?.code === 4429,
    JSON.stringify([limit, d.closedWith]),
  );
  relay.map.set(dayKey, { ...relay.map.get(dayKey), requests: day.requests });
}

// ---- an unpaired record lives 15 minutes (section 3) ----

{
  const pc = await newPc();
  pc.take();
  clock += 14 * MINUTE;
  await ping(pc);
  (await connect()).ws.close();
  check(
    "after 14 minutes the unpaired record and its socket are still there",
    relay.map.has(`pc:${pc.pcId}`) && pc.closedWith === null,
  );
  clock += MINUTE;
  await ping(pc);
  friend.send({
    v: 1,
    t: "pair",
    pcId: pc.pcId,
    DP: "AA",
    initData: await initData(FRIEND),
    mac1: "AA",
  });
  await settle();
  same(
    "a pair after its 15 minutes does not reach it",
    [friend.takeJson(), pc.take()],
    [[{ v: 1, t: "error", e: "no-pc" }], []],
  );
  await connect();
  same("at the next request its socket is closed 4408", pc.closedWith, {
    code: 4408,
    reason: "pair-timeout",
  });
  check("and its record is gone", !relay.map.has(`pc:${pc.pcId}`));
}

// ---- a further device joins by an OK (section 15, checks 1 to 5) ----

const JOIN_LINE = (words) =>
  `A new device joined your PC: ${words}. Not you? Remove it in the app, Settings › Devices.`;
const joinSecrets = []; // every key, box and nonce of the joins below, for the leak check
{
  const ownerA = await phone(OWNER); // the paired device
  // The pair's kind, on a PC of its own so its pair attempts do not count below.
  const pcK = await newPc();
  pcK.take();
  for (const kind of ["toaster", "iphone"])
    ownerA.send({
      v: 1,
      t: "pair",
      pcId: pcK.pcId,
      DP: toB64url(random(32)),
      initData: await initData(OWNER),
      mac1: toB64url(random(32)),
      kind,
    });
  await settle();
  same(
    "a pair whose kind is off the list is refused; one on the list reaches the PC with its kind",
    [ownerA.takeJson(), pcK.takeJson().map((f) => f.kind)],
    [[{ v: 1, t: "error", e: "bad-kind" }], ["iphone"]],
  );
  pcK.ws.close();
  const pcJ = await newPc();
  pcJ.take();
  // The pair helper sends no kind, as a page before DV4 does: it still passes.
  const r = await pair(ownerA, OWNER, pcJ);
  same("a pair with no kind still passes and is recorded", r.answer, [
    { v: 1, t: "paired", ok: true },
  ]);
  const calls = telegramCalls.length;
  pcJ.send({ v: 1, t: "joined", tgId: OWNER, kind: "iphone" });
  await settle();
  same(
    "joined after a pair of this id in the pairing window sends the fixed line, with sound",
    [
      pcJ.takeJson(),
      telegramCalls
        .slice(calls)
        .map((c) => [
          c.params.chat_id,
          c.params.text,
          c.params.disable_notification,
        ]),
    ],
    [[], [[OWNER, JOIN_LINE("iPhone"), false]]],
  );
  pcJ.send({ v: 1, t: "joined", tgId: OWNER, kind: "iphone" });
  await settle();
  same(
    "joined with neither a join-ask nor an unused pair is refused (check 5)",
    [pcJ.takeJson(), telegramCalls.length],
    [[{ v: 1, t: "error", e: "no-join" }], calls + 1],
  );

  // Check 1: no PC, or a PC paired to another id.
  relay.map.set("user:4004", { invitedAt: clock, firstName: "T", pcId: null });
  relay.map.set("user:5005", {
    invitedAt: clock,
    firstName: "T",
    pcId: pcJ.pcId,
  });
  const dN = await seal.newX25519();
  const askOf = async (dev, tgId = OWNER, kind = "desktop") => {
    const Nn = random(16);
    const commit = await seal.joinCommit(dev, dN.publicRaw, Nn);
    joinSecrets.push(Nn, commit);
    return {
      Nn,
      frame: {
        v: 1,
        t: "join-ask",
        dev,
        DN: toB64url(dN.publicRaw),
        kind,
        commit: toB64url(commit),
        initData: await initData(tgId),
      },
    };
  };
  for (const id of [4004, 5005]) {
    const s = await phone(id);
    const dev = toB64url(random(16));
    s.send((await askOf(dev, id)).frame);
    await settle();
    same(
      `a join-ask from ${id === 4004 ? "an id with no PC" : "an id whose PC is paired to another id"} gets not-paired; the PC gets nothing`,
      [s.takeJson(), pcJ.take()],
      [[{ v: 1, t: "join-fail", dev, reason: "not-paired" }], []],
    );
    s.ws.close();
  }

  // Check 5: a kind off the list is refused at join-ask.
  const N = await phone(OWNER); // the new device
  const N2 = await phone(OWNER); // another socket of the same id
  {
    const bad = await askOf(toB64url(random(16)), OWNER, "toaster");
    N.send(bad.frame);
    await settle();
    same(
      "a join-ask whose kind is off the list is refused; the PC gets nothing",
      [N.takeJson(), pcJ.take()],
      [[{ v: 1, t: "error", e: "bad-kind" }], []],
    );
  }

  // Check 2: a full join through the Hub, with a known Kn.
  const devN = toB64url(random(16));
  const ask = await askOf(devN);
  const askText = JSON.stringify(ask.frame);
  N.send(askText);
  await settle();
  same(
    "a join-ask from the owner reaches the owner's PC unchanged",
    pcJ.take(),
    [askText],
  );
  const Npc = random(16);
  joinSecrets.push(Npc, dN.publicRaw);
  const toN = async (frame) => {
    pcJ.send(frame);
    await settle();
    return [N.takeJson(), N2.take(), ownerA.take()];
  };
  const wait = {
    v: 1,
    t: "join-wait",
    dev: devN,
    pcId: pcJ.pcId,
    PCP: toB64url(random(32)),
    Npc: toB64url(Npc),
    open: 1,
  };
  same("join-wait goes only to the socket that asked", await toN(wait), [
    [wait],
    [],
    [],
  ]);
  N2.send({ v: 1, t: "join-reveal", dev: devN, Nn: toB64url(ask.Nn) });
  await settle();
  same(
    "a join-reveal from another socket of the same id is dropped",
    pcJ.take(),
    [],
  );
  const revealText = JSON.stringify({
    v: 1,
    t: "join-reveal",
    dev: devN,
    Nn: toB64url(ask.Nn),
  });
  N.send(revealText);
  await settle();
  same("the asking socket's join-reveal reaches the PC", pcJ.take(), [
    revealText,
  ]);
  const Kn = random(32);
  const box = await seal.sealBox(dN.publicRaw, Kn);
  const mac3 = random(32);
  joinSecrets.push(Kn, box, mac3);
  const ok = {
    v: 1,
    t: "join-ok",
    dev: devN,
    box: toB64url(box),
    mac3: toB64url(mac3),
  };
  same("join-ok goes only to the socket that asked", await toN(ok), [
    [ok],
    [],
    [],
  ]);
  const failFrame = { v: 1, t: "join-fail", dev: devN, reason: "expired" };
  same("join-fail goes only to the socket that asked", await toN(failFrame), [
    [failFrame],
    [],
    [],
  ]);
  pcJ.send({ v: 1, t: "joined", tgId: OWNER, kind: "toaster" });
  await settle();
  same("joined with a kind off the list is refused", pcJ.takeJson(), [
    { v: 1, t: "error", e: "bad-kind" },
  ]);
  pcJ.send({ v: 1, t: "joined", tgId: OWNER, kind: "desktop" });
  await settle();
  same(
    "joined after the join-ask sends the fixed line with the kind's words",
    [pcJ.takeJson(), telegramCalls.at(-1).params.text],
    [[], JOIN_LINE("Telegram Desktop")],
  );

  // Check 4: past 4 minutes the frames are dropped; the sixth ask in an hour is refused.
  const devL = toB64url(random(16));
  const late = await askOf(devL);
  N.send(late.frame);
  await settle();
  pcJ.take();
  clock += 4 * MINUTE;
  await ping(pcJ);
  N.send({ v: 1, t: "join-reveal", dev: devL, Nn: toB64url(late.Nn) });
  await settle();
  same("a join-reveal after 4 minutes is dropped", pcJ.take(), []);
  pcJ.send({ ...ok, dev: devL });
  await settle();
  same("a join-ok after 4 minutes is dropped", N.take(), []);
  pcJ.send({ v: 1, t: "joined", tgId: OWNER, kind: "desktop" });
  await settle();
  same(
    "joined after 4 minutes with no new join-ask is refused",
    pcJ.takeJson(),
    [{ v: 1, t: "error", e: "no-join" }],
  );
  // Two asks so far this hour; three more reach the 5.
  for (let i = 0; i < 3; i++) N.send((await askOf(toB64url(random(16)))).frame);
  await settle();
  const passedAsks = pcJ.take().length;
  const sixth = await askOf(toB64url(random(16)));
  N.send(sixth.frame);
  await settle();
  same(
    "the sixth join-ask in an hour is refused and does not reach the PC",
    [passedAsks, N.takeJson(), pcJ.take()],
    [
      3,
      [{ v: 1, t: "join-fail", dev: sixth.frame.dev, reason: "too-many-asks" }],
      [],
    ],
  );

  // A removed device's hello is answered app-fail outside the seal, to that device's sockets only.
  const devR = toB64url(random(16));
  N.send(await sealedFrame(devR, 0, { k: "hello" }));
  await settle();
  pcJ.take();
  pcJ.send({ v: 1, t: "app-fail", dev: devR, reason: "unknown-device" });
  await settle();
  same(
    "app-fail reaches the device it names and no other socket",
    [N.takeJson(), N2.take(), ownerA.take()],
    [[{ v: 1, t: "app-fail", dev: devR, reason: "unknown-device" }], [], []],
  );

  // Check 3: the store and the log hold none of the join's keys, boxes or nonces, nor a device id in the log.
  await settle();
  const storeText = dump();
  const logText = logLines.join("\n");
  const forms = (b) => [
    toB64url(b),
    Buffer.from(b).toString("hex"),
    Buffer.from(b).toString("latin1"),
  ];
  check(
    "the store holds none of Kn in base64url, hex or raw bytes",
    !forms(Kn).some((f) => storeText.includes(f)),
  );
  check(
    "the log holds none of Kn, DN, the box, mac3, a nonce or a commit",
    !joinSecrets.flatMap(forms).some((f) => logText.includes(f)),
  );
  check(
    "the log names no device id of the joins",
    ![devN, devL, devR].some((d) => logText.includes(d)),
  );
  check(
    "the log names the join frames and outcomes",
    [
      "join ask",
      "join ok",
      "join line sent",
      "join refused: too-many-asks",
    ].every((w) => logText.includes(w)),
    logText,
  );
  for (const s of [ownerA, N, N2]) s.ws.close();
  pcJ.ws.close();
}

// ---- dead links (steady design, sections 2 and 3) ----

{
  const pcA = await connect();
  pcA.send({ v: 1, t: "pc-auth", pcId: pc1.pcId, token: pc1.token, ping: 20 });
  await settle();
  pcA.take();
  friend.take();
  await ping(pcA);
  const pinged = clock;
  clock += 50 * SECOND;
  await wake();
  check(
    "a PC that says ping 20 is kept 50 s after its last ping",
    pcA.closedWith === null,
    JSON.stringify(pcA.closedWith),
  );
  clock += SECOND;
  friend.send(await sealedFrame(DEV, 2, { k: "req", d: MARKER }));
  await settle();
  same(
    "a silent PC (ping 20, none for 51 s) is closed 4001 dead-link and its page is told offline since its last ping",
    [
      pcA.closedWith,
      friend.takeJson(),
      relay.map.get(`pc:${pc1.pcId}`).lastSeen,
    ],
    [
      { code: 4001, reason: "dead-link" },
      [{ v: 1, t: "offline", lastSeen: pinged }],
      pinged,
    ],
  );
}
{
  const quiet = await connect();
  quiet.send({
    v: 1,
    t: "pc-auth",
    pcId: pc2.pcId,
    token: pc2.token,
    ping: 20,
  });
  await settle();
  clock += 51 * SECOND;
  await wake();
  same(
    "a PC that never pinged is closed 4001 dead-link 51 s after it opened",
    quiet.closedWith,
    { code: 4001, reason: "dead-link" },
  );
}
{
  // A PC before 26.3.2: no ping field in pc-auth, a ping every 60 s.
  const old = await connect();
  old.send({ v: 1, t: "pc-auth", pcId: pc2.pcId, token: pc2.token });
  await settle();
  for (let i = 0; i < 3; i++) {
    clock += 60 * SECOND;
    await wake();
    if (old.closedWith) break;
    await ping(old);
  }
  clock += 130 * SECOND;
  await wake();
  check(
    "a PC before 26.3.2 pinging every 60 s is never closed, and is kept 130 s after its last ping",
    old.closedWith === null,
    JSON.stringify(old.closedWith),
  );
  clock += SECOND;
  await wake();
  same(
    "a PC that names no ping interval is closed 4001 dead-link after 131 s without a ping",
    old.closedWith,
    { code: 4001, reason: "dead-link" },
  );
}
{
  // A page before 26.3.2 never pings; the relay keeps it however long it is quiet.
  const page = await phone(FRIEND);
  clock += 30 * MINUTE;
  await wake();
  page.send(await sealedFrame(DEV, 3, { k: "req", d: MARKER }));
  await settle();
  check(
    "a page that never pings is never closed (a page before 26.3.2 never pings)",
    page.closedWith === null && page.takeJson()[0]?.t === "offline",
    JSON.stringify(page.closedWith),
  );
  page.ws.close();
}

// ---- what the Hub kept (sections 1 and 6) ----

await settle();
const store = dump();
check("the store holds none of the plain marker text", !store.includes(MARKER));
check(
  "the log holds none of the plain marker text",
  !logLines.join("\n").includes(MARKER),
);
check(
  "every store key is one of the design's",
  [...relay.map.keys()].every((k) =>
    /^(user:\d+|invite:[0-9a-f]+|pc:[A-Z2-7]{26}|held:.+|file:.+|tg:last-update|day:\d{4}-\d{2}-\d{2})$/.test(
      k,
    ),
  ),
  [...relay.map.keys()].join(" "),
);
check(
  "the Hub logged no error",
  !logLines.some((l) => l.startsWith("hub error")),
  logLines.join("\n"),
);

await relay.close();

// ---- the local relay keeps its store across a restart; the cut proxy (steady design, section 3) ----

{
  const storeFile = path.join(tmp, "store.bin");
  relay = await startLocalRelay({ ...relayOpts, storeFile });
  const pc = await newPc();
  await relay.close();
  relay = await startLocalRelay({ ...relayOpts, storeFile });
  const back = await connect();
  back.send({ v: 1, t: "pc-auth", pcId: pc.pcId, token: pc.token });
  await settle();
  same(
    "after a restart the local relay still knows the PC (its store is kept in its file)",
    back.takeJson(),
    [{ v: 1, t: "pc-auth", ok: true, botId: BOT_ID, paired: false, files: 1 }],
  );

  const proxy = await startCutProxy({ port: Number(new URL(relay.url).port) });
  const c = await connect(proxy.url);
  proxy.hold();
  c.send(PING);
  await settle();
  const whileHeld = [c.take(), c.closedWith];
  proxy.heal();
  await settle();
  const afterHeal = c.take();
  proxy.cut();
  await settle();
  const again = await connect(proxy.url).then(
    () => "opened",
    () => "refused",
  );
  same(
    "the cut proxy: hold passes nothing and closes nothing, heal passes what was held, cut closes and refuses",
    [whileHeld, afterHeal, c.closedWith !== null, again],
    [[[], null], [PONG], true, "refused"],
  );
  await proxy.close();
  await relay.close();
}

// A program killed on macOS or Linux leaves with a FIN and no close frame; the relay must drop its socket at once,
// or the next hello goes to the dead PC (the e2e restart timed out on macOS this way).
{
  const net = await import("node:net");
  relay = await startLocalRelay(relayOpts);
  let closed = 0;
  const realClosed = relay.hub.closed.bind(relay.hub);
  relay.hub.closed = (c) => {
    closed += 1;
    return realClosed(c);
  };
  const { port } = new URL(relay.url);
  const raw = net.connect(Number(port), "127.0.0.1");
  await new Promise((ok) => raw.once("connect", ok));
  raw.write(
    "GET /ws HTTP/1.1\r\nHost: 127.0.0.1\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n" +
      "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n",
  );
  await new Promise((ok) => raw.once("data", ok));
  raw.end(); // FIN only, as a killed program on macOS sends
  const t0 = Date.now();
  while (!closed && Date.now() - t0 < 2000)
    await new Promise((r) => setTimeout(r, 20));
  check(
    "a client that leaves with a FIN and no close frame is dropped by the relay within 2 s (FAIL: a killed PC stays online on macOS)",
    closed === 1,
    `closed ${closed} times`,
  );
  raw.destroy();
  await relay.close();
}

// ---- topics (files contract, section 7): the bot, a fake Telegram with topic mode, a kept store ----

{
  const { makeBot } = await import("../phone/relay/bot/bot.mjs");
  const HOOK_SECRET = toB64url(random(36));
  let topicsOn = true;
  let nextThread = 50;
  const gone = new Set(); // thread ids the "user" deleted: a call into one is refused as Telegram does
  const calls = [];
  // As Telegram answered live (2026-11-18): an edit of a deleted topic is TOPIC_ID_INVALID, a send into one is
  // "message thread not found", and a chat action into one succeeds.
  const topicTelegram = async (method, params) => {
    calls.push({ method, params });
    if (gone.has(params.message_thread_id) && method !== "sendChatAction")
      throw new Error(
        method === "editForumTopic"
          ? `telegram ${method}: Bad Request: TOPIC_ID_INVALID`
          : `telegram ${method}: Bad Request: message thread not found`,
      );
    if (method === "getMe")
      return { id: BOT_ID, username: "test_bot", has_topics_enabled: topicsOn };
    if (method === "createForumTopic")
      return { message_thread_id: ++nextThread, name: params.name };
    if (method === "sendMessage") return { message_id: ++tgMessageId };
    return true;
  };
  const opts = {
    ...relayOpts,
    telegram: topicTelegram,
    bot: makeBot({ webhookSecret: HOOK_SECRET }),
    storeFile: path.join(tmp, "topics.bin"),
  };
  const made = () =>
    calls.filter((c) => c.method === "createForumTopic").map((c) => c.params);
  const lastAlert = () =>
    calls.filter((c) => c.method === "sendMessage").at(-1)?.params;
  const signIn = async (pc) => {
    const c = await connect();
    c.send({ v: 1, t: "pc-auth", pcId: pc.pcId, token: pc.token });
    await settle();
    c.take();
    return c;
  };
  const alert = async (c, open) => {
    c.send({ v: 1, t: "alert", text: "proj: needs you", open, silent: false });
    await settle();
    return c.takeJson();
  };
  const hook = async (update) => {
    const r = await fetch(`${relay.url}/tg/hook`, {
      method: "POST",
      headers: { "x-telegram-bot-api-secret-token": HOOK_SECRET },
      body: JSON.stringify(update),
    });
    const text = await r.text();
    await settle();
    return [r.status, text];
  };

  relay = await startLocalRelay(opts);
  const pc = await newPc();
  // Paired as the pairing leaves it: the PC record names the owner and the owner's record names the PC.
  relay.map.set(`pc:${pc.pcId}`, {
    ...relay.map.get(`pc:${pc.pcId}`),
    tgId: OWNER,
  });
  relay.map.set(`user:${OWNER}`, {
    invitedAt: clock,
    firstName: "Owner",
    pcId: pc.pcId,
  });
  let pcA = await signIn(pc);
  same(
    "topic mode on: a paired PC's sign-in creates Inbox, Alerts and Files once in its chat (FAIL: no topics, or made twice)",
    made(),
    [
      { chat_id: OWNER, name: "Inbox" },
      { chat_id: OWNER, name: "Alerts" },
      { chat_id: OWNER, name: "Files" },
    ],
  );
  same(
    "the topic ids are kept as topics:<chat> (FAIL: a restart could not find them)",
    (({ inbox, alerts, files }) => ({ inbox, alerts, files }))(
      relay.map.get(`topics:${OWNER}`),
    ),
    { inbox: 51, alerts: 52, files: 53 },
  );
  const opens = () =>
    calls
      .filter(
        (c) => c.method === "sendMessage" && c.params.text === "Open the app",
      )
      .map((c) => [
        c.params.message_thread_id,
        c.params.reply_markup.inline_keyboard[0][0].web_app.url,
      ]);
  const pins = () => calls.filter((c) => c.method === "pinChatMessage").length;
  same(
    "each topic gets one pinned Open button at sign-in (FAIL: inside a topic on iPhone there is no way to open the app)",
    [opens(), pins()],
    [
      [
        [51, `${relay.url}/`],
        [52, `${relay.url}/`],
        [53, `${relay.url}/`],
      ],
      3,
    ],
  );
  await alert(pcA, "t1");
  same(
    "topic mode on: an alert carries the Alerts topic's id",
    lastAlert().message_thread_id,
    52,
  );

  await relay.close();
  relay = await startLocalRelay(opts);
  pcA = await signIn(pc);
  await alert(pcA, "t2");
  same(
    "after a relay restart nothing is created again and alerts still go to Alerts (FAIL: the kept ids were lost)",
    [made().length, lastAlert().message_thread_id],
    [3, 52],
  );

  // The bug seen 2026-11-18: a kept topic the user deleted stayed kept, so it was never made again.
  gone.add(53);
  await relay.close();
  relay = await startLocalRelay(opts);
  pcA = await signIn(pc);
  same(
    "a kept Files topic the user deleted is found at sign-in and made again (FAIL: the dead id is trusted and no Files topic exists)",
    [made().length, made().at(-1).name, relay.map.get(`topics:${OWNER}`).files],
    [4, "Files", 54],
  );
  same(
    "the Open button is not sent again on a later sign-in, only into the remade Files topic (FAIL: a new pin every sign-in, or none in the new topic)",
    [opens().length, opens().at(-1)[0], pins()],
    [4, 54, 4],
  );

  gone.add(52);
  const answer = await alert(pcA, "t3");
  same(
    "an Alerts topic the user deleted is made again once and the alert sent into the new one",
    [answer, made().length, made().at(-1).name, lastAlert().message_thread_id],
    [[], 5, "Alerts", 55],
  );

  const [, fwd] = await hook({
    update_id: 1,
    message: {
      message_id: 9,
      date: Math.floor(clock / 1000),
      from: { id: OWNER, first_name: "Owner" },
      chat: { id: OWNER, type: "private" },
      message_thread_id: 54,
      is_topic_message: true,
      document: { file_id: "FileIdF1", file_size: 10, file_name: "a.txt" },
    },
  });
  const held = pcA.takeJson().filter((f) => f.t === "held");
  check(
    "a file sent into the Files topic reaches the PC as a held item with its fetch key (FAIL: topic forwards are lost)",
    fwd === "ok" &&
      held.length === 1 &&
      relay.map.has(`file:${pc.pcId}:FileIdF1`),
    `${fwd} ${JSON.stringify(held)}`,
  );

  same(
    "a forward into a bot-made topic renames nothing (FAIL: the bot's own topic was taken for a stray one)",
    calls.filter(
      (c) =>
        c.method === "editForumTopic" &&
        c.params.message_thread_id === 54 &&
        c.params.name !== "Files",
    ).length,
    0,
  );

  // A stray topic Telegram opened for a message sent from the All view.
  const owner = { id: OWNER, first_name: "Owner" };
  const chat = { id: OWNER, type: "private" };
  const date = Math.floor(clock / 1000);
  const renames = () =>
    calls
      .filter(
        (c) =>
          c.method === "editForumTopic" && c.params.message_thread_id >= 70,
      )
      .map((c) => [c.params.message_thread_id, c.params.name]);
  await hook({
    update_id: 2,
    message: {
      message_id: 70,
      message_thread_id: 70,
      date,
      from: owner,
      chat,
      forum_topic_created: {
        name: "New Chat",
        icon_color: 1,
        is_name_implicit: true,
      },
    },
  });
  check(
    "Telegram's topic-made note is not sent to the PC (FAIL: a service note became a saved item)",
    pcA.takeJson().filter((f) => f.t === "held").length === 0,
  );
  await hook({
    update_id: 3,
    message: {
      message_id: 71,
      message_thread_id: 70,
      is_topic_message: true,
      date,
      from: owner,
      chat,
      photo: [{ file_id: "PhotoP1", file_size: 10 }],
    },
  });
  await hook({
    update_id: 4,
    message: {
      message_id: 72,
      message_thread_id: 70,
      is_topic_message: true,
      date,
      from: owner,
      chat,
      text: "second item",
    },
  });
  same(
    'a stray topic is renamed once after its first item, and that item still reaches the PC (FAIL: still "New Chat", renamed twice, or the item lost)',
    [renames(), pcA.takeJson().filter((f) => f.t === "held").length],
    [[[70, "Photo"]], 2],
  );
  await hook({
    update_id: 5,
    message: {
      message_id: 81,
      message_thread_id: 80,
      is_topic_message: true,
      date,
      from: owner,
      chat,
      reply_to_message: {
        message_id: 80,
        date,
        from: owner,
        chat,
        forum_topic_created: {
          name: "New Chat",
          icon_color: 1,
          is_name_implicit: true,
        },
      },
      text: "see https://www.example.com/a?b=1 later",
    },
  });
  await hook({
    update_id: 6,
    message: {
      message_id: 91,
      message_thread_id: 90,
      is_topic_message: true,
      date,
      from: owner,
      chat,
      reply_to_message: {
        message_id: 90,
        date,
        from: owner,
        chat,
        forum_topic_created: { name: "Receipts", icon_color: 1 },
      },
      text: "kept name",
    },
  });
  same(
    "a stray topic known only from its first message's reply is renamed after its link; a topic the user named is left alone",
    renames(),
    [
      [70, "Photo"],
      [80, "Link: example.com"],
    ],
  );

  const removed = await hook({ relay_command: "remove-topics" });
  const deleted = calls
    .filter((c) => c.method === "deleteForumTopic")
    .map((c) => c.params);
  same(
    "remove-topics deletes every kept topic at Telegram and forgets their ids",
    [removed, deleted, relay.map.has(`topics:${OWNER}`)],
    [
      [200, '{"removed":3}'],
      [
        { chat_id: OWNER, message_thread_id: 51 },
        { chat_id: OWNER, message_thread_id: 55 },
        { chat_id: OWNER, message_thread_id: 54 },
      ],
      false,
    ],
  );
  const again = await hook({ relay_command: "remove-topics" });
  same(
    "a second remove-topics changes nothing",
    [again, calls.filter((c) => c.method === "deleteForumTopic").length],
    [[200, '{"removed":0}'], 3],
  );
  await relay.close();

  // Topic mode off: the same alert as before topics existed.
  topicsOn = false;
  calls.length = 0;
  relay = await startLocalRelay({ ...opts, storeFile: undefined });
  const pc2 = await newPc();
  relay.map.set(`pc:${pc2.pcId}`, {
    ...relay.map.get(`pc:${pc2.pcId}`),
    tgId: OWNER,
  });
  const pcB = await signIn(pc2);
  await alert(pcB, "t1");
  same(
    "topic mode off: no topic is created and the alert's sendMessage is exactly today's",
    [made().length, lastAlert()],
    [
      0,
      {
        chat_id: OWNER,
        text: "proj: needs you",
        disable_notification: false,
        reply_markup: {
          inline_keyboard: [
            [{ text: "Open", web_app: { url: `${relay.url}/?o=t1` } }],
          ],
        },
      },
    ],
  );
  await relay.close();
}

// ---- Send to chat and the one-time download link (files contract, section 6): fakes only, nothing stored ----

{
  const MB = 1024 * 1024;
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  let topicsOn = true;
  let refuseUpload = null;
  let reading = null; // the PC body being sent, so the fake Telegram sees how much of it was read
  const uploads = [];
  const fileTelegram = async (method, params) => {
    if (method === "getMe") return { id: BOT_ID, has_topics_enabled: topicsOn };
    if (method === "createForumTopic")
      return {
        message_thread_id: { Inbox: 60, Alerts: 61 }[params.name] ?? 62,
      };
    if (method === "sendMessage") return { message_id: ++tgMessageId };
    return true;
  };
  let holdUpload = null; // (signal) -> a promise: the fake Telegram holds the upload instead of reading it
  // Like Telegram's sendDocument: reads the multipart body to its end, then answers.
  const fileUpload = async (method, { body, length, type, signal }) => {
    if (holdUpload) return holdUpload(signal);
    const boundary = /boundary=(\S+)$/.exec(type)[1];
    const chunks = [];
    let firstAt = null;
    for await (const chunk of body) {
      firstAt ??= reading?.pulled ?? 0;
      chunks.push(chunk);
    }
    const all = Buffer.concat(chunks);
    const start = all.indexOf("\r\n\r\n", all.indexOf('name="document"')) + 4;
    const tail = `\r\n--${boundary}--\r\n`;
    const end = all.length - tail.length;
    const head = all.subarray(0, start).toString();
    uploads.push({
      method,
      length,
      got: all.length,
      firstAt,
      fields: Object.fromEntries(
        [...head.matchAll(/name="(\w+)"\r\n\r\n([^\r]*)\r\n/g)].map((m) => [
          m[1],
          m[2],
        ]),
      ),
      filename: /filename="([^"]*)"/.exec(head)?.[1],
      fileType: /Content-Type: (\S+)\r\n\r\n$/.exec(head)?.[1],
      hash: sha(all.subarray(start, end)),
      tailOk: all.subarray(end).toString() === tail,
    });
    if (refuseUpload) throw new Error(`telegram ${method}: ${refuseUpload}`);
    return { message_id: ++tgMessageId };
  };
  // A file on the fake PC: random bytes made as they are read, hashed on the way.
  function pcFile(size) {
    const hash = createHash("sha256");
    const file = { size, pulled: 0, hash: null };
    file.body = new ReadableStream({
      pull(out) {
        const n = Math.min(size - file.pulled, MB);
        if (n === 0) {
          file.hash = hash.digest("hex");
          return out.close();
        }
        const bytes = randomBytes(n);
        hash.update(bytes);
        file.pulled += n;
        out.enqueue(bytes);
      },
    });
    return file;
  }
  const pcHeaders = (pc, size) => ({
    "X-Phone-Pc": pc.pcId,
    Authorization: `Bearer ${pc.token}`,
    "Content-Length": String(size),
  });
  const send = async (pc, body, size, name = "big.bin") => {
    const r = await fetch(`${relay.url}/pc/send`, {
      method: "POST",
      headers: {
        ...pcHeaders(pc, size),
        "Content-Type": "application/octet-stream",
        "X-File-Name": encodeURIComponent(name),
      },
      body,
      duplex: "half",
    });
    const text = await r.text();
    return [r.status, text ? JSON.parse(text) : text];
  };
  const signIn = async (pc) => {
    const c = await connect();
    c.send({ v: 1, t: "pc-auth", pcId: pc.pcId, token: pc.token });
    await settle();
    return [c, c.takeJson()];
  };
  const openLink = async (c, file) => {
    const ref = toB64url(random(9));
    c.send({ v: 1, t: "dl-open", ref, ...file });
    await settle();
    return [ref, c.takeJson()];
  };
  const keys = () => [...relay.map.keys()].sort();

  relay = await startLocalRelay({
    ...relayOpts,
    telegram: fileTelegram,
    upload: fileUpload,
  });
  const pc = await newPc();
  const loose = await newPc(); // stays unpaired, its socket open
  loose.take();
  relay.map.set(`pc:${pc.pcId}`, {
    ...relay.map.get(`pc:${pc.pcId}`),
    tgId: OWNER,
  });
  relay.map.set(`user:${OWNER}`, {
    invitedAt: clock,
    firstName: "Owner",
    pcId: pc.pcId,
  });
  let [pcA, auth] = await signIn(pc);
  same(
    "a paired PC's sign-in answer carries files: 1 (FAIL: the PC refuses Send to chat and links as relay-too-old)",
    auth,
    [{ v: 1, t: "pc-auth", ok: true, botId: BOT_ID, paired: true, files: 1 }],
  );
  const keysBefore = keys();
  let stored = dump();

  // 50,000,000 bytes, the most Send to chat takes: Telegram's 50 MiB counts the whole multipart body (live trial).
  const big = pcFile(50_000_000);
  reading = big;
  const sent = await send(pc, big.body, big.size);
  const up = uploads[0];
  check(
    "Send to chat: a 50,000,000-byte file from the PC reaches Telegram as one sendDocument into the Files topic, hash equal (FAIL: lost, split, changed or in the wrong place)",
    JSON.stringify(sent) ===
      JSON.stringify([200, { ok: true, message_id: tgMessageId }]) &&
      uploads.length === 1 &&
      up.method === "sendDocument" &&
      JSON.stringify(up.fields) ===
        JSON.stringify({ chat_id: String(OWNER), message_thread_id: "62" }) &&
      up.filename === "big.bin" &&
      up.hash === big.hash &&
      up.tailOk &&
      up.got === up.length,
    JSON.stringify({ sent, up }),
  );
  check(
    "Send to chat streams: Telegram's first bytes came before the PC's body was read whole (FAIL: the relay held the file in memory)",
    up.firstAt < big.size,
    `first bytes after ${up.firstAt} of ${big.size} bytes`,
  );
  reading = null;
  same(
    "Send to chat refuses a file over 50,000,000 bytes by name, and Telegram gets nothing (FAIL: too-big not checked, or a 50 MiB file reaches Telegram, which drops it with its multipart wrapping)",
    [await send(pc, Buffer.alloc(50_000_001), 50_000_001), uploads.length],
    [[413, { ok: false, e: "too-big" }], 1],
  );
  same(
    "Send to chat refuses a wrong token and an unpaired PC with a bare 401 (FAIL: anyone can post to the chat)",
    [
      await send({ ...pc, token: toB64url(random(32)) }, "abc", 3),
      await send(loose, "abc", 3),
      uploads.length,
    ],
    [[401, ""], [401, ""], 1],
  );
  refuseUpload = "Bad Request: file is too big";
  same(
    "Send to chat passes Telegram's refusal to the PC as telegram-refused with Telegram's words",
    await send(pc, "abc", 3),
    [
      502,
      { ok: false, e: "telegram-refused", why: "Bad Request: file is too big" },
    ],
  );
  refuseUpload = null;
  check(
    "Send to chat writes nothing to the store (FAIL: a file or its trace was kept)",
    dump() === stored,
    JSON.stringify(keys().filter((k) => !keysBefore.includes(k))),
  );

  // The PC breaks off a Send to chat while Telegram still holds the upload: the relay cancels the upload, and the
  // next send answers at once. Before, the upload took no abort and kept running.
  {
    const tick = () => new Promise((done) => setTimeout(done, 10));
    let held = "not yet";
    let cancelled = false;
    holdUpload = (signal) => {
      held = signal ?? null;
      return new Promise((_, no) =>
        signal?.addEventListener("abort", () => {
          cancelled = true;
          no(new Error("the upload was cancelled"));
        }),
      );
    };
    const pcStop = new AbortController();
    const first = fetch(`${relay.url}/pc/send`, {
      method: "POST",
      headers: {
        ...pcHeaders(pc, 100_000),
        "Content-Type": "application/octet-stream",
        "X-File-Name": "held.bin",
      },
      // 1,000 of the 100,000 bytes, then nothing: the PC is still sending when it breaks off.
      body: new ReadableStream({
        start(out) {
          out.enqueue(new Uint8Array(1000));
        },
      }),
      duplex: "half",
      signal: pcStop.signal,
    }).catch((e) => e.name);
    for (let i = 0; i < 200 && held === "not yet"; i++) await tick();
    pcStop.abort();
    for (let i = 0; i < 200 && !cancelled; i++) await tick();
    holdUpload = null;
    const startedAt = performance.now();
    const next = await send(pc, "abc", 3);
    const took = performance.now() - startedAt;
    same(
      "an aborted Send to chat cancels its Telegram upload, its reason logged (FAIL: the upload keeps running after the PC gave up)",
      [
        held !== "not yet",
        cancelled,
        await first,
        logLines.some((l) => l.startsWith("file send aborted")),
      ],
      [true, true, "AbortError", true],
    );
    same(
      "the next Send to chat after an aborted one answers at once (FAIL: it waits behind the held upload)",
      [next[0], took < 2000],
      [200, true],
    );
  }

  // Topic mode off: the plain chat, as before topics.
  topicsOn = false;
  [pcA] = await signIn(pc);
  stored = dump();
  await send(pc, "hello", 5, 'a "b".txt');
  same(
    "topic mode off: the document goes to the plain chat with no thread id, the quote in its name escaped",
    [uploads.at(-1).fields, uploads.at(-1).filename],
    [{ chat_id: String(OWNER) }, "a %22b%22.txt"],
  );

  const NAME = 'отчёт "1".txt';
  const data = randomBytes(300_000);
  const [ref, [made]] = await openLink(pcA, {
    name: NAME,
    size: data.length,
    mime: "text/plain",
  });
  check(
    "dl-open from the paired PC answers dl-made with a /dl/ link that ends in 2 minutes",
    made?.t === "dl-made" &&
      made.ref === ref &&
      made.url.startsWith(`${relay.url}/dl/`) &&
      made.until === new Date(clock + 2 * MINUTE).toISOString(),
    JSON.stringify(made),
  );
  const head = await fetch(made.url, { method: "HEAD" });
  const get = await fetch(made.url);
  await settle();
  const [pull] = pcA.takeJson();
  check(
    "a HEAD leaves the link unused: the GET after it still gets the file (FAIL: Telegram's look-ahead would use up the link)",
    head.status === 200 &&
      get.status === 200 &&
      pull?.t === "dl-pull" &&
      pull.ref === ref,
    `${head.status} ${get.status} ${JSON.stringify(pull)}`,
  );
  const shown = Object.fromEntries(
    [
      "content-type",
      "content-length",
      "content-disposition",
      "access-control-allow-origin",
      "cache-control",
    ].map((h) => [h, get.headers.get(h)]),
  );
  same(
    "the download carries the attachment and Telegram origin headers (FAIL: the download box cannot save it)",
    shown,
    {
      "content-type": "text/plain",
      "content-length": "300000",
      "content-disposition": `attachment; filename="_____ _1_.txt"; filename*=UTF-8''${encodeURIComponent(NAME)}`,
      "access-control-allow-origin": "https://web.telegram.org",
      "cache-control": "no-store",
    },
  );
  const [got, posted] = await Promise.all([
    get.arrayBuffer(),
    fetch(`${relay.url}/pc/dl/${pull.link}`, {
      method: "POST",
      headers: pcHeaders(pc, data.length),
      body: data,
    }),
  ]);
  check(
    "the download ends with the PC's bytes, hash equal, and the PC's post is answered 200",
    sha(Buffer.from(got)) === sha(data) && posted.status === 200,
    `${got.byteLength} bytes, post ${posted.status}`,
  );
  const again = await fetch(made.url);
  let againText = "a download started";
  if (again.status === 410) againText = await again.text();
  else await again.body.cancel();
  same(
    "a link is once-only: a second GET gets 410 with the words to make a new one",
    [again.status, againText],
    [410, "This link has expired. Make a new one in the app."],
  );

  // Telegram's download box fetches the link only after the user confirms it, and Cloudflare puts an idle object to
  // sleep within seconds: the link must outlive the Hub's memory.
  const [, [kept]] = await openLink(pcA, {
    name: "a.txt",
    size: 3,
    mime: "text/plain",
  });
  check(
    "a kept link is in the store by its hash only (FAIL: the link's token is readable in the store)",
    relay.map.has(`dl:${pc.pcId}`) && !dump().includes(kept.url.slice(-43)),
    dump(),
  );
  await relay.sleep();
  const woken = await fetch(kept.url);
  await settle();
  const [wokenPull] = pcA.takeJson();
  let wokenBody = "no download";
  if (wokenPull?.t === "dl-pull") {
    const [bytes] = await Promise.all([
      woken.arrayBuffer(),
      fetch(`${relay.url}/pc/dl/${wokenPull.link}`, {
        method: "POST",
        headers: pcHeaders(pc, 3),
        body: "abc",
      }),
    ]);
    wokenBody = Buffer.from(bytes).toString();
  } else await woken.body.cancel();
  same(
    "a link made before the relay slept still downloads the file after it wakes (FAIL: a Download press gets 410 once the relay slept)",
    [woken.status, wokenBody],
    [200, "abc"],
  );

  const [, [late]] = await openLink(pcA, {
    name: "a.txt",
    size: 3,
    mime: "text/plain",
  });
  clock += 2 * MINUTE;
  same(
    "a link opened after 2 minutes gets 410",
    (await fetch(late.url)).status,
    410,
  );

  const [looseRef, looseAnswer] = await openLink(loose, {
    name: "a.txt",
    size: 3,
    mime: "text/plain",
  });
  same(
    "dl-open from an unpaired PC is refused and makes no link (FAIL: a link without the paired user's ask)",
    looseAnswer,
    [{ v: 1, t: "dl-fail", ref: looseRef, e: "not-paired" }],
  );

  const [shortRef, [short]] = await openLink(pcA, {
    name: "a.txt",
    size: 10,
    mime: "text/plain",
  });
  const cut = await fetch(short.url);
  await settle();
  const [shortPull] = pcA.takeJson();
  const [cutBody, cutPost] = await Promise.all([
    cut.arrayBuffer().then(
      () => "whole",
      () => "broken off",
    ),
    fetch(`${relay.url}/pc/dl/${shortPull.link}`, {
      method: "POST",
      headers: pcHeaders(pc, 9),
      body: Buffer.alloc(9),
    }).then((r) => r.json()),
  ]);
  await settle();
  same(
    "a pull of the wrong length breaks the download off and tells the PC dl-fail aborted",
    [cutBody, cutPost, pcA.takeJson()],
    [
      "broken off",
      { ok: false, e: "aborted" },
      [{ v: 1, t: "dl-fail", ref: shortRef, e: "aborted" }],
    ],
  );
  check(
    "used and ended download links leave nothing in the store (FAIL: a link or its trace was kept)",
    dump() === stored,
    JSON.stringify(keys().filter((k) => !keysBefore.includes(k))),
  );

  // A fresh sign-in starts the hour's count at 0, as alerts do.
  [pcA] = await signIn(pc);
  const refs = [];
  for (let i = 0; i < 31; i++) {
    refs.push(toB64url(random(9)));
    pcA.send({
      v: 1,
      t: "dl-open",
      ref: refs[i],
      name: "a.txt",
      size: 3,
      mime: "text/plain",
    });
  }
  await settle();
  const answers = pcA.takeJson();
  const urls = answers.filter((f) => f.t === "dl-made").map((f) => f.url);
  same(
    "the 31st send or link in an hour is refused files-rate (FAIL: no limit on files)",
    [urls.length, answers.at(-1)],
    [30, { v: 1, t: "error", e: "files-rate" }],
  );
  same(
    "a PC keeps at most 4 links: the oldest goes",
    [
      (await fetch(urls[25], { method: "HEAD" })).status,
      (await fetch(urls[26], { method: "HEAD" })).status,
    ],
    [410, 200],
  );
  await relay.close();
}

// ---- two calls at once: the file routes run beside the socket frames, so a send can meet a frame or another send ----

{
  let topicsOn = null; // null: getMe is refused, as Telegram may refuse any call
  let topicsMade = 0;
  const calls = [];
  const raceTelegram = async (method, params) => {
    calls.push({ method, params });
    if (method === "getMe") {
      if (topicsOn === null)
        throw new Error("telegram getMe: Too Many Requests: retry after 1");
      return { id: BOT_ID, has_topics_enabled: topicsOn };
    }
    if (method === "createForumTopic") {
      // Slow, as Telegram is: a second maker has time to start before the first one's answer.
      await new Promise((done) => setTimeout(done, 30));
      return { message_thread_id: 80 + ++topicsMade };
    }
    if (method === "sendMessage") return { message_id: ++tgMessageId };
    return true;
  };
  const raceUpload = async (_method, { body }) => {
    await new Response(body).arrayBuffer();
    return { message_id: ++tgMessageId };
  };
  const sendFile = async (pc, text) => {
    const r = await fetch(`${relay.url}/pc/send`, {
      method: "POST",
      headers: {
        "X-Phone-Pc": pc.pcId,
        Authorization: `Bearer ${pc.token}`,
        "Content-Length": String(text.length),
        "Content-Type": "text/plain",
        "X-File-Name": "a.txt",
      },
      body: text,
    });
    return r.status;
  };

  relay = await startLocalRelay({
    ...relayOpts,
    telegram: raceTelegram,
    upload: raceUpload,
  });
  const pc = await newPc();
  relay.map.set(`pc:${pc.pcId}`, {
    ...relay.map.get(`pc:${pc.pcId}`),
    tgId: OWNER,
  });
  relay.map.set(`user:${OWNER}`, {
    invitedAt: clock,
    firstName: "Owner",
    pcId: pc.pcId,
  });
  // The sign-in's getMe is refused, so it makes no topics and the topic mode is read again at the next file.
  const pcA = await connect();
  pcA.send({ v: 1, t: "pc-auth", pcId: pc.pcId, token: pc.token });
  await settle();
  pcA.take();
  topicsOn = true;
  const statuses = await Promise.all([
    sendFile(pc, "one"),
    sendFile(pc, "two"),
  ]);
  same(
    "two sends at once into a chat with no Files topic make one Files topic and both go into it (FAIL: two Files topics)",
    [
      statuses,
      calls
        .filter((c) => c.method === "createForumTopic")
        .map((c) => c.params.name),
      relay.map.get(`topics:${OWNER}`).files,
    ],
    [[200, 200], ["Files"], 81],
  );
  await relay.close();
}

// An alert frame and a file send at once, on the Hub itself: its store may answer later (the Hub takes a sync or an
// async one), and this one holds a read of the PC's record until the test lets it go, so the send runs inside the
// alert. Both hour counters live in the PC socket's attachment.
{
  const map = new Map();
  const base = mapStore(map);
  let hold = null; // when set, the next read of a PC record waits for it
  const store = {
    ...base,
    get: async (key) => {
      if (hold && key.startsWith("pc:")) {
        const wait = hold;
        hold = null;
        await wait;
      }
      return base.get(key);
    },
  };
  const conns = new Set();
  const hub = createHub({
    store,
    sockets: {
      accept: (c) => void conns.add(c),
      all: () => [...conns],
      attachment: (c) => (c.attachment ? structuredClone(c.attachment) : null),
      setAttachment: (c, value) => void (c.attachment = structuredClone(value)),
      send: (c, text) => c.inbox.push(text),
      close: (c) => void conns.delete(c),
      lastPing: () => null,
    },
    telegram: async (method) => {
      if (method === "getMe") return { id: BOT_ID, has_topics_enabled: false };
      return { message_id: ++tgMessageId };
    },
    upload: async (_method, { body }) => {
      await new Response(body).arrayBuffer();
      return { message_id: ++tgMessageId };
    },
    fixedStream: fixedLengthStream,
    download: async () => {
      throw new Error("this test downloads nothing");
    },
    now: () => clock,
    log: () => {},
    botId: BOT_ID,
    ownerTgId: OWNER,
    telegramKey: tgKeyHex,
    topicSuffix: "",
    bot: null,
  });
  const token = random(32);
  const pcId = await pcIdOf(token);
  map.set(`pc:${pcId}`, {
    tokenHash: createHash("sha256").update(token).digest("hex"),
    tgId: OWNER,
    createdAt: clock,
    lastSeen: clock,
    pcVersion: "26.3",
    inboxPub: toB64url(random(32)),
  });
  const ws = { inbox: [] };
  await hub.open(ws, { origin: "http://127.0.0.1:1" });
  await hub.message(
    ws,
    JSON.stringify({ v: 1, t: "pc-auth", pcId, token: toB64url(token) }),
  );
  let letGo;
  hold = new Promise((done) => {
    letGo = done;
  });
  const alerting = hub.message(
    ws,
    JSON.stringify({
      v: 1,
      t: "alert",
      text: "proj: needs you",
      open: "r1",
      silent: false,
    }),
  );
  const sent = await hub.pcSend({
    headers: {
      "x-phone-pc": pcId,
      authorization: `Bearer ${toB64url(token)}`,
      "content-length": "3",
      "x-file-name": "a.txt",
    },
    body: new Response("abc").body,
  });
  letGo();
  await alerting;
  const { alerts, files } = ws.attachment;
  same(
    "an alert and a file send at once each count once in the hour (FAIL: the alert wrote back an old copy and the file count was lost)",
    [sent.status, alerts?.n, files?.n],
    [200, 1, 1],
  );
}

// ---- the webhook check (worker.mjs `scheduled`, the Hub's heal): a missing or moved webhook is set again, the
// owner is told only what it cannot fix, and the test copy makes no Bot API call (it shares the bot) ----
{
  const SECRET = "fake-webhook-secret-for-the-check";
  let hook = { url: "" }; // what the fake Telegram holds as the bot's webhook
  let reachable = true;
  let refuseSet = null;
  const calls = [];
  const healTelegram = async (method, params) => {
    if (!reachable) throw new TypeError("fetch failed");
    calls.push({ method, params });
    if (method === "getMe") return { id: BOT_ID, has_topics_enabled: true };
    if (method === "getWebhookInfo")
      return { ...hook, pending_update_count: 0 };
    if (method === "setWebhook") {
      if (refuseSet) throw new Error(`telegram setWebhook: ${refuseSet}`);
      hook = { url: params.url };
      return true;
    }
    if (method === "createForumTopic") return { message_thread_id: 61 };
    if (method === "sendMessage") {
      if (blocked)
        throw new Error(
          "telegram sendMessage: Forbidden: bot was blocked by the user",
        );
      return { message_id: ++tgMessageId };
    }
    return true;
  };
  let blocked = false; // the owner blocked the bot: every sendMessage is refused
  relay = await startLocalRelay({
    ...relayOpts,
    telegram: healTelegram,
    webhookSecret: SECRET,
  });
  const want = `${relay.url}/tg/hook`;
  // One scheduled run, 5 minutes after the last: what it answered and the Bot API calls it made.
  const run = async () => {
    clock += 5 * MINUTE;
    calls.length = 0;
    let done;
    try {
      done = await relay.heal?.();
    } catch (e) {
      done = `threw: ${e.message}`;
    }
    return [done, calls.map((c) => c.method)];
  };
  const sent = () => calls.filter((c) => c.method === "sendMessage");

  const missing = await run();
  const setCall = calls.find((c) => c.method === "setWebhook")?.params;
  same(
    "the webhook check sets a missing webhook again to this relay with its secret, and tells no one (FAIL: the bot stays deaf)",
    [
      missing,
      hook.url,
      setCall?.secret_token,
      setCall?.allowed_updates,
      setCall?.drop_pending_updates,
    ],
    [
      ["set", ["getWebhookInfo", "setWebhook"]],
      want,
      SECRET,
      ["message", "callback_query"],
      undefined,
    ],
  );
  // Changed on purpose: the check used to set a webhook at another address back to itself, so two relays with an
  // address (an old one left running, or the owner's own move) took the bot from each other every run.
  const away = "https://another-relay.example/tg/hook";
  hook = { url: away };
  const moved = await run();
  const movedTold = sent().map((c) => c.params.text);
  const movedAgain = await run();
  same(
    "a webhook at another address is left as it is and told to the owner once, not every run (FAIL: two relays " +
      "take the bot from each other every few minutes)",
    [
      moved[0],
      movedTold.length,
      movedTold[0]?.includes("another-relay.example"),
      movedAgain,
      hook.url,
    ],
    ["foreign", 1, true, ["foreign", ["getWebhookInfo"]], away],
  );
  hook = { url: want };
  same(
    "a webhook already right is only read (FAIL: the check sets it every run)",
    await run(),
    ["ok", ["getWebhookInfo"]],
  );
  reachable = false;
  const lostAt = clock + 5 * MINUTE;
  same(
    "Telegram not reached: the check logs it and sends nothing, twice over",
    [
      await run(),
      await run(),
      logLines.at(-1)?.startsWith("webhook check: Telegram not reached"),
    ],
    [["unreached", []], ["unreached", []], true],
  );
  reachable = true;
  const back = await run();
  same(
    "the first run that reaches Telegram again tells the owner once, in the Alerts topic, from when (FAIL: the outage goes unseen)",
    [
      back[0],
      sent().length,
      sent()[0]?.params.chat_id,
      sent()[0]?.params.message_thread_id,
      sent()[0]?.params.text.includes("could not reach Telegram from") &&
        sent()[0]?.params.text.includes(
          new Date(lostAt).toISOString().slice(0, 16).replace("T", " "),
        ),
    ],
    ["ok", 1, OWNER, 61, true],
  );
  same("the run after that tells no one again", await run(), [
    "ok",
    ["getWebhookInfo"],
  ]);
  hook = { url: "" };
  refuseSet = "Bad Request: bad webhook: Failed to resolve host";
  const refused = await run();
  same(
    "a refused setWebhook is told to the owner with Telegram's words (FAIL: the bot is deaf and no one knows)",
    [
      refused[0],
      sent().length,
      sent()[0]?.params.text.includes("Failed to resolve host"),
    ],
    ["refused", 1, true],
  );
  const refusedAgain = await run();
  const refusedAgainSent = sent().length;
  refuseSet = "Bad Request: bad webhook: HTTPS url must be provided";
  const refusedOther = await run();
  const refusedOtherSent = sent().length;
  refuseSet = null;
  await run();
  hook = { url: "" };
  refuseSet = "Bad Request: bad webhook: HTTPS url must be provided";
  const refusedAfterFix = await run();
  same(
    "a refused setWebhook is told once, again only when Telegram's words change or after the webhook was healthy " +
      "(FAIL: the owner gets the same alert every few minutes)",
    [
      refusedAgain[0],
      refusedAgainSent,
      refusedOther[0],
      refusedOtherSent,
      refusedAfterFix[0],
      sent().length,
    ],
    ["refused", 0, "refused", 1, "refused", 1],
  );
  refuseSet = null;
  await run();
  reachable = false;
  await run();
  reachable = true;
  hook = { url: "" };
  blocked = true;
  const blockedRun = await run();
  const blockedLogged = logLines.some((l) =>
    l.startsWith("webhook check: the alert to the owner failed"),
  );
  same(
    "an alert that fails (the owner blocked the bot) is logged, and what the run did is kept, so the next run " +
      "neither sets the webhook nor tries the alert again (FAIL: every run repeats both and fails)",
    [blockedRun[0], blockedLogged, await run()],
    ["set", true, ["ok", ["getWebhookInfo"]]],
  );
  blocked = false;
  // Changed on purpose: the check used to set the webhook again on the first run that saw one 401. A deploy's
  // own few seconds of 401s (its new secret is in, its setWebhook not yet) then let a check with the old secret
  // set the webhook back to that old secret. Now a 401 counts only when it goes on past a run that saw one.
  const at401 = (ms) => ({
    url: want,
    last_error_date: Math.floor(ms / 1000),
    last_error_message: "Wrong response from the webhook: 401 Unauthorized",
  });
  hook = at401(clock + 5 * MINUTE - 3000); // 3 s before the next run
  const lone = [await run(), await run()];
  clock += 2 * 60 * MINUTE; // a long quiet, then another deploy's 401 a few seconds old
  hook = at401(clock + 5 * MINUTE - 3000);
  lone.push(await run());
  same(
    "a 401 from a few seconds ago, seen by one run only, leaves the webhook as it is, also after a long quiet " +
      "(FAIL: a check holding the old secret undoes a deploy's new one)",
    lone,
    [
      ["ok", ["getWebhookInfo"]],
      ["ok", ["getWebhookInfo"]],
      ["ok", ["getWebhookInfo"]],
    ],
  );
  hook = at401(clock + MINUTE); // a newer 401, after the run that saw the first one
  const staleRun = await run();
  const staleSet = calls.find((c) => c.method === "setWebhook")?.params;
  same(
    "a 401 that goes on past the run that saw one is set again with this relay's secret, once (FAIL: an old " +
      "secret leaves the bot deaf)",
    [staleRun, staleSet?.secret_token, (await run())[0]],
    [["set", ["getWebhookInfo", "setWebhook"]], SECRET, "ok"],
  );
  // A real relay with no address (deployed before RELAY_ORIGIN, then a plain `wrangler deploy`): the Hub's check
  // as worker.mjs calls it, with origin null.
  const noAddress = [];
  for (let i = 0; i < 2; i++) {
    calls.length = 0;
    try {
      noAddress.push([
        await relay.hub.heal({ origin: null, webhookSecret: SECRET }),
        calls.length,
      ]);
    } catch (e) {
      noAddress.push(`threw: ${e.message}`);
    }
  }
  same(
    "a relay with no address answers not-configured, makes no Bot API call and logs it once, not every run " +
      "(FAIL: the cron fails every 5 minutes)",
    [
      noAddress,
      logLines.filter((l) => l.startsWith("webhook check: off")).length,
    ],
    [
      [
        ["not-configured", 0],
        ["not-configured", 0],
      ],
      1,
    ],
  );
  same(
    "the webhook check keeps one store key and logs no secret",
    [
      [...relay.map.keys()].filter((k) => k.startsWith("heal:")),
      logLines.some((l) => l.includes(SECRET)),
    ],
    [["heal:webhook"], false],
  );
  await relay.close();

  // The test copy: same bot token, its own topics. It must not touch the webhook.
  hook = { url: "" };
  relay = await startLocalRelay({
    ...relayOpts,
    telegram: healTelegram,
    webhookSecret: SECRET,
    topicSuffix: " (test)",
  });
  same(
    "the test copy's webhook check makes no Bot API call at all (FAIL: it would take the bot from the real relay)",
    [await run(), hook.url],
    [["test-copy", []], ""],
  );
  await relay.close();
}

// ---- the Worker's own file (Cloudflare loads it; no test above does) must at least parse
{
  const { spawnSync } = await import("node:child_process");
  const worker = path.join(
    import.meta.dirname,
    "..",
    "phone",
    "relay",
    "src",
    "worker.mjs",
  );
  const parsed = spawnSync(process.execPath, ["--check", worker], {
    encoding: "utf8",
  });
  check(
    "the relay's worker.mjs parses (FAIL: the deploy's build would stop on it)",
    parsed.status === 0,
    parsed.stderr.trim().split("\n").slice(0, 4).join(" "),
  );

  // Its cron handler, loaded with a stand-in for Cloudflare's own module. A first deploy whose probe failed has
  // no secrets at all: the Hub cannot start, so the handler must not call it, and must not fail every run.
  const { registerHooks } = await import("node:module");
  const { pathToFileURL } = await import("node:url");
  registerHooks({
    resolve: (specifier, context, nextResolve) =>
      specifier === "cloudflare:workers"
        ? {
            url: "data:text/javascript,export class DurableObject { constructor(ctx, env) { this.ctx = ctx; this.env = env; } }",
            shortCircuit: true,
          }
        : nextResolve(specifier, context),
  });
  const { default: entry } = await import(pathToFileURL(worker).href);
  let hubCalls = 0;
  const HUB = {
    idFromName: (name) => name,
    get: () => ({
      heal: async () => {
        hubCalls++;
        throw new Error("relay: the secret BOT_TOKEN is not set");
      },
    }),
  };
  const printed = [];
  const consoleLog = console.log;
  console.log = (line) => printed.push(String(line));
  let outcome = "ended well";
  try {
    await entry.scheduled?.({}, { HUB });
  } catch (e) {
    outcome = `threw: ${e.message}`;
  } finally {
    console.log = consoleLog;
  }
  same(
    "the cron on a relay with no secrets yet ends well, without starting the Hub, and logs not-configured (FAIL: " +
      "a first deploy whose probe failed fails its cron every 5 minutes)",
    [
      outcome,
      hubCalls,
      printed.some((l) => l.startsWith("webhook check: not-configured")),
    ],
    ["ended well", 0, true],
  );
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
