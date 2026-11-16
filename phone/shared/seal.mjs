// The one seal library of the phone app: the page, the PC program and the relay's Hub all use it.
// WebCrypto only (globalThis.crypto.subtle), so it runs the same in Node 24, Workers and the phone's web view.
// Pairing, channel, box and device-join formats follow docs/2026-11-14-phone-app-pipe-design.md, sections 2, 4
// and 15.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();
const dec = new TextDecoder("utf-8", { fatal: true });

export const PROTOCOL = 1;
// Telegram's production key for checking initData without the bot token (Telegram "Validating data
// for Third-Party Use").
export const TELEGRAM_PUBLIC_KEY =
  "e7bf03a2fa4602af4580703d88dda5bb59f32ed8b02a56c187fe7d34caed242d";
export const PAD = 256;

// ---- bytes and text

export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

export function concat(...parts) {
  const all = parts.map((p) => (typeof p === "string" ? utf8(p) : p));
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

export function randomBytes(n) {
  return globalThis.crypto.getRandomValues(new Uint8Array(n));
}

export function toB64u(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromB64u(str) {
  if (typeof str !== "string" || !/^[A-Za-z0-9_-]*$/.test(str))
    throw new Error("not base64url text");
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export const toHex = (bytes) =>
  Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

export function fromHex(hex) {
  if (!/^([0-9a-f]{2})*$/i.test(hex)) throw new Error("not hex text");
  return new Uint8Array(hex.match(/../g)?.map((h) => parseInt(h, 16)) ?? []);
}

const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// RFC 4648 base32 without padding; 16 bytes give 26 characters.
export function toBase32(bytes) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(str, length) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of str) {
    const v = B32.indexOf(ch);
    if (v < 0) throw new Error(`not base32 text: "${ch}"`);
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  if (out.length !== length || (value & ((1 << bits) - 1)) !== 0)
    throw new Error(`base32 text does not hold exactly ${length} bytes`);
  return new Uint8Array(out);
}

export async function sha256(data) {
  const b = typeof data === "string" ? utf8(data) : data;
  return new Uint8Array(await subtle.digest("SHA-256", b));
}

// ---- primitives

export async function hkdf(ikm, salt, info, bytes = 32) {
  const key = await subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  const bits = await subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt, info: concat(info) },
    key,
    bytes * 8,
  );
  return new Uint8Array(bits);
}

async function hmacKey(secret, use) {
  return subtle.importKey(
    "raw",
    secret,
    { name: "HMAC", hash: "SHA-256" },
    false,
    [use],
  );
}

export async function hmac(secret, ...parts) {
  const key = await hmacKey(secret, "sign");
  return new Uint8Array(await subtle.sign("HMAC", key, concat(...parts)));
}

// Constant-time check (WebCrypto's own verify).
export async function hmacCheck(secret, mac, ...parts) {
  const key = await hmacKey(secret, "verify");
  return subtle.verify("HMAC", key, mac, concat(...parts));
}

// An X25519 key pair; `extractable` lets the PC keep its private key in its key file.
export async function newX25519(extractable = false) {
  const pair = await subtle.generateKey({ name: "X25519" }, extractable, [
    "deriveBits",
  ]);
  const publicRaw = new Uint8Array(
    await subtle.exportKey("raw", pair.publicKey),
  );
  return { privateKey: pair.privateKey, publicRaw };
}

export async function exportPrivate(privateKey) {
  return toB64u(new Uint8Array(await subtle.exportKey("pkcs8", privateKey)));
}

export async function importPrivate(b64u) {
  return subtle.importKey("pkcs8", fromB64u(b64u), { name: "X25519" }, false, [
    "deriveBits",
  ]);
}

export async function x25519(privateKey, publicRaw) {
  if (publicRaw.length !== 32) throw new Error("an X25519 key is 32 bytes");
  const pub = await subtle.importKey(
    "raw",
    publicRaw,
    { name: "X25519" },
    false,
    [],
  );
  return new Uint8Array(
    await subtle.deriveBits({ name: "X25519", public: pub }, privateKey, 256),
  );
}

async function aesKey(raw) {
  return subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

async function gcmSeal(key, iv, plain, ad) {
  return new Uint8Array(
    await subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: ad },
      key,
      plain,
    ),
  );
}

// Returns null when the tag does not match: the caller drops the frame.
async function gcmOpen(key, iv, sealed, ad) {
  try {
    return new Uint8Array(
      await subtle.decrypt(
        { name: "AES-GCM", iv, additionalData: ad },
        key,
        sealed,
      ),
    );
  } catch {
    return null;
  }
}

// ---- the PC's id and the pairing code

// pcId = base32 of the first 16 bytes of SHA-256("phone-app pcId v1" | token): only the token's holder can name it.
export async function pcIdFromToken(token) {
  const h = await sha256(concat("phone-app pcId v1", token));
  return toBase32(h.slice(0, 16));
}

// The code is "<pcId>.<S>", 26 + 26 base32 characters; groupCode spaces it by 4 for reading.
export const makePairCode = (pcId, secret) => `${pcId}.${toBase32(secret)}`;

export const groupCode = (code) =>
  code
    .split(".")
    .map((p) => p.match(/.{1,4}/g).join(" "))
    .join(" . ");

export function readPairCode(text) {
  const plain = String(text).replace(/[\s-]/g, "").toUpperCase();
  const m = plain.match(/^([A-Z2-7]{26})\.([A-Z2-7]{26})$/);
  if (!m) throw new Error("not a pairing code: it is 26 letters, a dot, 26");
  return { pcId: m[1], secret: fromBase32(m[2], 16) };
}

export const pairMac1 = (secret, pcId, devicePub, initData) =>
  hmac(secret, "pair1", pcId, devicePub, initData);

export const checkPairMac1 = (secret, mac, pcId, devicePub, initData) =>
  hmacCheck(secret, mac, "pair1", pcId, devicePub, initData);

export const pairMac2 = (secret, pcId, devicePub, pcPub) =>
  hmac(secret, "pair2", pcId, devicePub, pcPub);

export const checkPairMac2 = (secret, mac, pcId, devicePub, pcPub) =>
  hmacCheck(secret, mac, "pair2", pcId, devicePub, pcPub);

// K = HKDF(X25519(own private, other public), salt = S, info = "phone-app pair v1" | pcId | DP | PCP).
export async function pairKey(
  ownPrivate,
  otherPub,
  secret,
  pcId,
  devicePub,
  pcPub,
) {
  const shared = await x25519(ownPrivate, otherPub);
  return hkdf(
    shared,
    secret,
    concat("phone-app pair v1", pcId, devicePub, pcPub),
  );
}

// ---- a further device joins by an OK (pipe design, section 15)

// The kinds a device may name, from Telegram.WebApp.platform as the page maps it, with their words.
export const KINDS = {
  iphone: "iPhone",
  android: "Android phone",
  desktop: "Telegram Desktop",
  mac: "Telegram for Mac",
  web: "Telegram Web",
  other: "Another device",
};

// commit = SHA-256("phone-app join commit v1" | dev | DN | Nn): N binds its nonce before it sees the PC's.
export const joinCommit = (dev, devicePub, phoneNonce) =>
  sha256(concat("phone-app join commit v1", dev, devicePub, phoneNonce));

// The check number both ends show, as six digits (the page groups them by three):
// uint32(SHA-256("phone-app join word v1" | pcId | dev | DN | PCP | Nn | Npc)[0..4]) mod 1 000 000.
export async function joinWord(
  pcId,
  dev,
  devicePub,
  pcPub,
  phoneNonce,
  pcNonce,
) {
  const h = await sha256(
    concat(
      "phone-app join word v1",
      pcId,
      dev,
      devicePub,
      pcPub,
      phoneNonce,
      pcNonce,
    ),
  );
  const n = new DataView(h.buffer).getUint32(0) % 1_000_000;
  return String(n).padStart(6, "0");
}

// J = HKDF(X25519(own private, other public), salt = Nn | Npc, info = "phone-app join v1" | pcId | dev | DN | PCP).
export async function joinKey(
  ownPrivate,
  otherPub,
  phoneNonce,
  pcNonce,
  pcId,
  dev,
  devicePub,
  pcPub,
) {
  const shared = await x25519(ownPrivate, otherPub);
  return hkdf(
    shared,
    concat(phoneNonce, pcNonce),
    concat("phone-app join v1", pcId, dev, devicePub, pcPub),
  );
}

// mac3 = HMAC-SHA-256(J, "join3" | dev | box): only the PC and N know J.
export const joinMac = (J, dev, box) => hmac(J, "join3", dev, box);

export const checkJoinMac = (J, mac, dev, box) =>
  hmacCheck(J, mac, "join3", dev, box);

// ---- the app channel

// Both directions' keys of one channel session: Kp2pc, Kpc2p = HKDF(K, Np | Npc, "phone-app session v1" | dir).
export async function sessionKeys(channelKey, phoneNonce, pcNonce) {
  const salt = concat(phoneNonce, pcNonce);
  const info = (dir) => concat("phone-app session v1", dir);
  return {
    p2pc: await aesKey(await hkdf(channelKey, salt, info("p2pc"))),
    pc2p: await aesKey(await hkdf(channelKey, salt, info("pc2p"))),
  };
}

// The additional data: the outer header's JSON in the order v, t, dev, sid, n.
export const headerBytes = (h) =>
  utf8(JSON.stringify({ v: h.v, t: h.t, dev: h.dev, sid: h.sid, n: h.n }));

function counterIv(n) {
  if (!Number.isSafeInteger(n) || n < 0)
    throw new Error("a frame counter is a whole number from 0");
  const iv = new Uint8Array(12);
  new DataView(iv.buffer).setBigUint64(4, BigInt(n));
  return iv;
}

// Pads the JSON with spaces to the next multiple of 256 bytes, so sizes show only roughly.
function padBody(body) {
  const b = utf8(JSON.stringify(body));
  const out = new Uint8Array(Math.ceil((b.length + 1) / PAD) * PAD).fill(32);
  out.set(b);
  return out;
}

function readBody(bytes) {
  if (!bytes) return null;
  try {
    return JSON.parse(fromUtf8(bytes));
  } catch {
    return null;
  }
}

// A frame under a session key: the IV is the frame counter `header.n`. Returns the base64url ciphertext.
export async function sealFrame(key, header, body) {
  return toB64u(
    await gcmSeal(key, counterIv(header.n), padBody(body), headerBytes(header)),
  );
}

// The body, or null when the frame does not open.
export async function openFrame(key, header, c) {
  let sealed;
  try {
    sealed = fromB64u(c);
  } catch {
    return null;
  }
  return readBody(
    await gcmOpen(key, counterIv(header.n), sealed, headerBytes(header)),
  );
}

// `hello` is sealed with K itself and a random IV (put before the ciphertext), since no session key exists yet.
export async function sealHello(channelKey, header, body) {
  const iv = randomBytes(12);
  const ct = await gcmSeal(
    await aesKey(channelKey),
    iv,
    padBody(body),
    headerBytes(header),
  );
  return toB64u(concat(iv, ct));
}

export async function openHello(channelKey, header, c) {
  let all;
  try {
    all = fromB64u(c);
  } catch {
    return null;
  }
  if (all.length < 12 + 16) return null;
  return readBody(
    await gcmOpen(
      await aesKey(channelKey),
      all.slice(0, 12),
      all.slice(12),
      headerBytes(header),
    ),
  );
}

// ---- the sealed box (the Hub seals bot forwards to the PC's inbox key)

// Output: ephemeral public key (32) | IV (12) | ciphertext with tag.
export async function sealBox(recipientPub, bytes) {
  const eph = await newX25519();
  const key = await hkdf(
    await x25519(eph.privateKey, recipientPub),
    concat(eph.publicRaw, recipientPub),
    "phone-app box v1",
  );
  const iv = randomBytes(12);
  return concat(
    eph.publicRaw,
    iv,
    await gcmSeal(await aesKey(key), iv, bytes, new Uint8Array(0)),
  );
}

// The bytes, or null when the box does not open with this key.
export async function openBox(privateKey, ownPub, sealed) {
  if (sealed.length < 32 + 12 + 16) return null;
  const ephPub = sealed.slice(0, 32);
  const key = await hkdf(
    await x25519(privateKey, ephPub),
    concat(ephPub, ownPub),
    "phone-app box v1",
  );
  return gcmOpen(
    await aesKey(key),
    sealed.slice(32, 44),
    sealed.slice(44),
    new Uint8Array(0),
  );
}

// ---- Telegram's signed user (initData), checked without the bot token

// Returns { user, authDate } or throws an Error whose `code` is "bad-sign", "too-old" or "bad-data".
export async function checkInitData(initData, botId, publicKeyHex, nowMs) {
  const fail = (code, msg) =>
    Object.assign(new Error(`initData refused: ${msg}`), { code });
  if (typeof initData !== "string" || initData.length > 4096)
    throw fail("bad-data", "not text, or too long");
  const params = new URLSearchParams(initData);
  const signature = params.get("signature");
  if (!signature) throw fail("bad-sign", "no signature");
  const lines = [...params.entries()]
    .filter(([k]) => k !== "hash" && k !== "signature")
    .map(([k, v]) => `${k}=${v}`)
    .sort();
  const data = utf8(`${botId}:WebAppData\n${lines.join("\n")}`);
  const key = await subtle.importKey(
    "raw",
    fromHex(publicKeyHex),
    { name: "Ed25519" },
    false,
    ["verify"],
  );
  let sig;
  try {
    sig = fromB64u(signature);
  } catch {
    throw fail("bad-sign", "signature is not base64url");
  }
  if (!(await subtle.verify("Ed25519", key, sig, data)))
    throw fail("bad-sign", "signature does not match");
  const authDate = Number(params.get("auth_date"));
  if (!Number.isSafeInteger(authDate)) throw fail("bad-data", "no auth_date");
  const age = nowMs / 1000 - authDate;
  if (age > 24 * 3600 || age < -300)
    throw fail("too-old", "older than 24 hours or in the future");
  let user;
  try {
    user = JSON.parse(params.get("user"));
  } catch {
    throw fail("bad-data", "user is not JSON");
  }
  if (!user || !Number.isSafeInteger(user.id))
    throw fail("bad-data", "no user id");
  return { user, authDate };
}
