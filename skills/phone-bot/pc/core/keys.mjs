// ~/.phone-app/pc-keys.json: the PC token, the identity and inbox keys, the relay address, pcId, the bot id,
// ownerTgId and up to 4 devices. The only module that opens the key file.
// A device entry (pipe design, section 15): { device, K, kind, pairedAt, lastSeen, via: "code" | "ok", okBy,
// confirmed, unseen }. An entry written before device join has no kind, via or confirmed; it is read as it is,
// with no made-up values: the clean-up deletes only `confirmed: false`, the devices list says "kind not recorded".
import fs from "node:fs";
import {
  exportPrivate,
  importPrivate,
  newX25519,
  pcIdFromToken,
  randomBytes,
  toB64u,
} from "../../../../phone/shared/seal.mjs";
import {
  checkPath,
  keyFilePath,
  takeKeyFileToken,
  writeText,
} from "./files.mjs";

const TOKEN = takeKeyFileToken();
export const MAX_DEVICES = 4;

async function keyPair() {
  const k = await newX25519(true);
  return { priv: await exportPrivate(k.privateKey), pub: toB64u(k.publicRaw) };
}

// A new PC identity: a new token, so a new pcId; any earlier owner and devices are gone.
export async function createKeys(relay) {
  const token = randomBytes(32);
  const keys = {
    relay,
    pcId: await pcIdFromToken(token),
    token: toB64u(token),
    identity: await keyPair(),
    inbox: await keyPair(),
    joined: false,
    botId: null,
    ownerTgId: null,
    devices: [],
  };
  saveKeys(keys);
  return keys;
}

export function keysExist() {
  return fs.existsSync(checkPath(keyFilePath(), { token: TOKEN }));
}

export function loadKeys() {
  const real = checkPath(keyFilePath(), { token: TOKEN });
  if (!fs.existsSync(real))
    throw new Error(
      `No key file at ${keyFilePath()}: run node setup.mjs join <relay address>`,
    );
  let keys;
  try {
    keys = JSON.parse(fs.readFileSync(real, "utf8"));
  } catch (e) {
    throw new Error(`${keyFilePath()} is not valid JSON: ${e.message}`);
  }
  for (const f of ["relay", "pcId", "token", "identity", "inbox", "devices"])
    if (keys[f] === undefined)
      throw new Error(`${keyFilePath()} has no "${f}": run setup.mjs join`);
  return keys;
}

export function saveKeys(keys) {
  writeText(keyFilePath(), `${JSON.stringify(keys, null, 2)}\n`, {
    token: TOKEN,
  });
}

let identityCache = null;

export async function identityPrivate(keys) {
  if (!identityCache || identityCache.pub !== keys.identity.pub)
    identityCache = {
      pub: keys.identity.pub,
      key: await importPrivate(keys.identity.priv),
    };
  return identityCache.key;
}
