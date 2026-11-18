// Where the page keeps the channel key K (pipe design, section 2, "Where the page keeps K"). First choice
// Telegram's SecureStorage (the iPhone Keychain), DeviceStorage only when SecureStorage answers "not supported";
// any other error stops and nothing is stored. Never CloudStorage, never localStorage.
// K is stored wrapped: a non-extractable AES-KW key made at pairing lives in this page's own IndexedDB (bound to
// the relay's address), and only K wrapped with it goes to Telegram's store. Another page that reads the store
// gets bytes it cannot unwrap.
// Every storage key name ends in the build's STORE_SUFFIX ("-test" in a test copy, empty in a plain build), so a
// test copy opened from the same bot keeps its own pairing beside the real one. The names are read at call time:
// screens.generated.js may still be loading when this file is first evaluated.
import { fromB64u, toB64u } from "../../shared/seal.mjs";
import { STORE_SUFFIX } from "../screens.generated.js";

const itemName = () => `phone-app-pairing${STORE_SUFFIX}`;
const dbName = () => `phone-app${STORE_SUFFIX}`;
const DB_STORE = "keys";
const WRAP_ID = "wrap";
const ANSWER_MS = 8000;

export const WHERE_WORDS = {
  secure: "in the device's key store (the iPhone Keychain)",
  device: "on this device, not in a key store",
};

export class KeyStoreError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

const unsupported = () => new KeyStoreError("unsupported", "not supported");

// One Telegram store call as a promise. "Not supported" is told apart from every other failure.
function call(store, method, ...args) {
  return new Promise((resolve, reject) => {
    if (!store || typeof store[method] !== "function")
      return reject(unsupported());
    const timer = setTimeout(
      () => reject(new KeyStoreError("failed", "the key store did not answer")),
      ANSWER_MS,
    );
    try {
      store[method](...args, (err, value, canRestore) => {
        clearTimeout(timer);
        if (err === "UNSUPPORTED") return reject(unsupported());
        if (err) return reject(new KeyStoreError("failed", String(err)));
        resolve({ value, canRestore: canRestore === true });
      });
    } catch (e) {
      clearTimeout(timer);
      if (e.message === "WebAppMethodUnsupported") return reject(unsupported());
      reject(new KeyStoreError("failed", e.message));
    }
  });
}

// ---- the wrapping key in IndexedDB

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName(), 1);
    req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () =>
      reject(new KeyStoreError("failed", `IndexedDB: ${req.error?.message}`));
  });
}

async function dbDo(mode, job) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(DB_STORE, mode);
      const req = job(tx.objectStore(DB_STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () =>
        reject(new KeyStoreError("failed", `IndexedDB: ${tx.error?.message}`));
    });
  } finally {
    db.close();
  }
}

const readWrapKey = () => dbDo("readonly", (s) => s.get(WRAP_ID));

async function newWrapKey() {
  const key = await crypto.subtle.generateKey(
    { name: "AES-KW", length: 256 },
    false,
    ["wrapKey", "unwrapKey"],
  );
  await dbDo("readwrite", (s) => s.put(key, WRAP_ID));
  return key;
}

async function wrap(wrapKey, K) {
  const k = await crypto.subtle.importKey(
    "raw",
    K,
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign"],
  );
  return new Uint8Array(
    await crypto.subtle.wrapKey("raw", k, wrapKey, "AES-KW"),
  );
}

async function unwrap(wrapKey, wrapped) {
  const k = await crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    wrapKey,
    "AES-KW",
    { name: "HMAC", hash: "SHA-256" },
    true,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.exportKey("raw", k));
}

// ---- the page's calls

// Stores { K, pcId, dev } wrapped. Returns "secure" or "device"; throws KeyStoreError otherwise.
export async function savePairing(tg, { K, pcId, dev }) {
  const wrapKey = await newWrapKey();
  const value = JSON.stringify({
    v: 1,
    pcId,
    dev,
    wrapped: toB64u(await wrap(wrapKey, K)),
  });
  try {
    await call(tg.SecureStorage, "setItem", itemName(), value);
    return "secure";
  } catch (e) {
    if (e.code !== "unsupported") throw e;
  }
  await call(tg.DeviceStorage, "setItem", itemName(), value);
  return "device";
}

// Returns { K, pcId, dev, where }, { restorable: true } when SecureStorage says the item can be restored, or
// null when nothing usable is stored (no item, or the wrapping key is gone: the page shows pairing).
export async function loadPairing(tg) {
  let got = null;
  let where = "secure";
  try {
    got = await call(tg.SecureStorage, "getItem", itemName());
  } catch (e) {
    if (e.code !== "unsupported") throw e;
    where = "device";
    got = await call(tg.DeviceStorage, "getItem", itemName());
  }
  if (!got.value) return got.canRestore ? { restorable: true } : null;
  let item;
  try {
    item = JSON.parse(got.value);
  } catch {
    throw new KeyStoreError("failed", "the stored pairing is not readable");
  }
  const wrapKey = await readWrapKey();
  if (!wrapKey) return null;
  let K;
  try {
    K = await unwrap(wrapKey, fromB64u(item.wrapped));
  } catch {
    return null;
  }
  return { K, pcId: item.pcId, dev: item.dev, where };
}

export async function restorePairing(tg) {
  await call(tg.SecureStorage, "restoreItem", itemName());
  return loadPairing(tg);
}

// Removes the stored pairing from both stores (each may not be supported) and the wrapping key.
export async function forgetPairing(tg) {
  for (const store of [tg.SecureStorage, tg.DeviceStorage]) {
    try {
      await call(store, "removeItem", itemName());
    } catch (e) {
      if (e.code !== "unsupported") throw e;
    }
  }
  await dbDo("readwrite", (s) => s.delete(WRAP_ID));
}
