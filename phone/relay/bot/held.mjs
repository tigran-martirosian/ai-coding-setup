// Forwards held sealed (pipe design, section 5). A message from an invited user is sealed to the inbox key of the
// PC that user paired, kept under `held:<pcId>:<time>:<n>` until that PC answers `held-ack`, and sent to it as
// `held { id, c }` at once or at its next sign-in. The plain message is never written. A file of at most 20 MB
// gets `file:<pcId>:<fileId>` so the PC may fetch it once with `fetch { fileId }`; the bytes go back unsealed in
// `file { fileId, i, of, d }` pieces of 192 KB (they came from Telegram through the Hub, over TLS). A fetch that
// cannot be served is answered `file { fileId, err }`. Items and file keys older than 30 days are deleted inside
// normal requests, with a one-line note to the user's chat.
import { fromB64u, sealBox, toB64u, utf8 } from "../../shared/seal.mjs";

const DAY = 24 * 60 * 60_000;
export const HELD_LIFE = 30 * DAY;
export const MAX_HELD = 1000;
export const MAX_HELD_BYTES = 50 * 1024 * 1024;
export const FILE_LIMIT = 20 * 1024 * 1024;
export const PIECE = 192 * 1024;

const HELD_ID = /^\d{1,16}:\d{12}$/;
const FILE_ID = /^[A-Za-z0-9_-]{1,200}$/;

// Message fields that carry a file. The PC program's saved.mjs keeps the same list.
const FILE_FIELDS = [
  "document",
  "video",
  "animation",
  "voice",
  "audio",
  "video_note",
  "sticker",
];

// The one file a message carries, or null: { fileId, size } (size null when Telegram gave none).
export function fileOf(msg) {
  const f = msg.photo
    ? msg.photo.at(-1)
    : FILE_FIELDS.map((k) => msg[k]).find(Boolean);
  if (!f || typeof f.file_id !== "string") return null;
  return {
    fileId: f.file_id,
    size: Number.isSafeInteger(f.file_size) ? f.file_size : null,
  };
}

// ctx is the Hub's bot context (hub.mjs header).
export function createHeld(ctx) {
  const { store, telegram, download, now, log, sendToPc } = ctx;
  const say = (chatId, text) =>
    telegram("sendMessage", { chat_id: chatId, text });
  // The short reply to a forward goes into the forward's topic (files contract, section 7); with no topic, today's.
  const answer = (msg, text) =>
    Number.isSafeInteger(msg.message_thread_id)
      ? telegram("sendMessage", {
          chat_id: msg.chat.id,
          text,
          message_thread_id: msg.message_thread_id,
        })
      : say(msg.chat.id, text);
  const heldFrame = (id, c) => JSON.stringify({ v: 1, t: "held", id, c });
  const fileFrame = (fields) => JSON.stringify({ v: 1, t: "file", ...fields });

  // A forward from an invited user. user is that user's `user:` record.
  async function forward(msg, user) {
    const chatId = msg.chat.id;
    const pc = user.pcId ? await store.get(`pc:${user.pcId}`) : null;
    if (!pc || pc.tgId !== msg.from.id) {
      await answer(msg, "Not saved: pair your PC first");
      return;
    }
    const pcId = user.pcId;
    const sealed = await sealBox(
      fromB64u(pc.inboxPub),
      utf8(JSON.stringify(msg)),
    );
    const held = await store.list(`held:${pcId}:`);
    const bytes = held.reduce(
      (n, [, c]) => n + Math.floor((c.length * 3) / 4),
      0,
    );
    if (held.length >= MAX_HELD || bytes + sealed.length > MAX_HELD_BYTES) {
      log("forward refused: held limit");
      await answer(
        msg,
        "Not saved: your PC has been away too long and 1,000 items are waiting.",
      );
      return;
    }
    const t = now();
    const id = `${t}:${String(msg.message_id).padStart(12, "0")}`;
    const c = toB64u(sealed);
    await store.put(`held:${pcId}:${id}`, c);
    const file = fileOf(msg);
    if (file && file.size !== null && file.size > FILE_LIMIT) {
      await answer(
        msg,
        "Saved as a note. The file is over 20 MB, so it stays here; open it from this chat.",
      );
    } else {
      if (file && FILE_ID.test(file.fileId))
        await store.put(`file:${pcId}:${file.fileId}`, {
          size: file.size,
          expiresAt: t + HELD_LIFE,
        });
      await telegram("setMessageReaction", {
        chat_id: chatId,
        message_id: msg.message_id,
        reaction: [{ type: "emoji", emoji: "\u{1F44D}" }],
      });
    }
    log("forward held");
    sendToPc(pcId, heldFrame(id, c));
  }

  // The 30-day clean-up of `held:` and `file:` keys.
  async function cleanUp() {
    const t = now();
    const gone = new Map();
    for (const [key] of await store.list("held:")) {
      const [, pcId, at] = key.split(":");
      if (t - Number(at) < HELD_LIFE) continue;
      await store.delete(key);
      gone.set(pcId, (gone.get(pcId) || 0) + 1);
    }
    for (const [key, rec] of await store.list("file:")) {
      if (t >= rec.expiresAt) await store.delete(key);
    }
    for (const [pcId, n] of gone) {
      log(`held items deleted after 30 days: ${n}`);
      const pc = await store.get(`pc:${pcId}`);
      if (pc && pc.tgId !== null)
        await say(
          pc.tgId,
          `${n} saved ${n === 1 ? "item" : "items"} waited over 30 days for your PC and ${n === 1 ? "was" : "were"} deleted.`,
        );
    }
  }

  // On each good pc-auth: every held item of that PC, oldest first.
  async function pcConnected(pcId) {
    await cleanUp();
    const held = await store.list(`held:${pcId}:`);
    for (const [key, c] of held) {
      if (!sendToPc(pcId, heldFrame(key.slice(`held:${pcId}:`.length), c)))
        return;
    }
    if (held.length) log(`held items sent: ${held.length}`);
  }

  async function ack(pcId, f) {
    if (typeof f.id !== "string" || !HELD_ID.test(f.id)) return;
    await store.delete(`held:${pcId}:${f.id}`);
  }

  async function fetchFile(pcId, f) {
    if (typeof f.fileId !== "string" || !FILE_ID.test(f.fileId)) {
      sendToPc(pcId, fileFrame({ fileId: null, err: "bad-file" }));
      return;
    }
    const { fileId } = f;
    const key = `file:${pcId}:${fileId}`;
    const rec = await store.get(key);
    if (!rec || now() >= rec.expiresAt) {
      sendToPc(pcId, fileFrame({ fileId, err: "no-file" }));
      return;
    }
    let bytes;
    try {
      const info = await telegram("getFile", { file_id: fileId });
      bytes = await download(info.file_path);
    } catch (e) {
      log(`file fetch failed: ${e.message}`);
      sendToPc(pcId, fileFrame({ fileId, err: "fetch-failed" }));
      return;
    }
    const of = Math.max(1, Math.ceil(bytes.length / PIECE));
    for (let i = 0; i < of; i++) {
      const d = toB64u(bytes.subarray(i * PIECE, (i + 1) * PIECE));
      if (!sendToPc(pcId, fileFrame({ fileId, i, of, d }))) return;
    }
    await store.delete(key);
    log("file sent to pc");
  }

  async function pcFrame(pcId, f) {
    if (f.t === "held-ack") return ack(pcId, f);
    if (f.t === "fetch") return fetchFile(pcId, f);
    throw new Error(`bot: pcFrame got ${String(f.t)}`);
  }

  // A removed user's PC: its record, held items and file keys go.
  async function dropPc(pcId) {
    await store.delete(`pc:${pcId}`);
    for (const prefix of [`held:${pcId}:`, `file:${pcId}:`]) {
      for (const [key] of await store.list(prefix)) await store.delete(key);
    }
  }

  return { forward, cleanUp, pcConnected, pcFrame, dropPc };
}
