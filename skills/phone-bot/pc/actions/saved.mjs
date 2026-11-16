// Saved: bot forwards held sealed on the relay (pipe design, section 5) are opened here with the inbox key and
// saved unsorted into ~/phone-inbox, one line per item in its index.md, with the old inbox bot's save code
// (now retired: file naming, the index line, albums by media_group_id as one item, links kept as links).
// Only then does the PC answer `held-ack`, so an item is never lost; a resent item that was already saved is
// acknowledged again, not saved twice. Files are fetched one at a time with `fetch { fileId }`.
//   register(registry)  adds saved.list (PC program design, action 34)
//   createIntake({ keys, send, dir, albumWaitMs })  -> { onFrame(frame) } for the relay's `held` and `file` frames;
//                       main.mjs passes inboxDir(), the tests a folder of their own
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  concat,
  fromB64u,
  fromUtf8,
  importPrivate,
  openBox,
} from "../../../../phone/shared/seal.mjs";
import { checkPath, readText, secretName } from "../core/files.mjs";
import { log } from "../core/log.mjs";

const PAGE_SIZE = 50;
const ALBUM_WAIT_MS = 1500;
const FETCH_WAIT_MS = 2 * 60 * 1000;
const FILE_LIMIT = 20 * 1024 * 1024; // the relay's limit: getFile cannot fetch bigger files

// Message fields that carry a file, with the extension used when the name gives none (the relay's held.mjs keeps
// the same list).
const FILE_KINDS = [
  ["document", ""],
  ["video", ".mp4"],
  ["animation", ".mp4"],
  ["voice", ".ogg"],
  ["audio", ".mp3"],
  ["video_note", ".mp4"],
  ["sticker", ".webp"],
];
// Kinds of message that carry nothing to save; they are kept as a note saying so.
const OTHER_KINDS = ["location", "venue", "contact", "poll", "dice", "story"];

export const inboxDir = () => path.join(os.homedir(), "phone-inbox");

// ---- the old bot's save code, with the folder passed in ----

function stamp(unixSeconds) {
  const d = new Date(unixSeconds * 1000);
  const p = (n) => String(n).padStart(2, "0");
  return {
    file: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`,
    shown: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`,
  };
}

// A name that is not taken yet (an album arrives as several messages in one second).
function freeName(dir, base, ext) {
  let name = base + ext;
  for (let n = 2; fs.existsSync(path.join(dir, name)); n++)
    name = `${base}_${n}${ext}`;
  return name;
}

function safe(name) {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are not allowed in Windows file names
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").slice(-80);
}

// Links hidden behind words ("read this") are not in the text itself.
function hiddenLinks(entities) {
  return (entities || [])
    .filter((e) => e.type === "text_link" && typeof e.url === "string")
    .map((e) => e.url);
}

const isLink = (w) => /^https?:\/\/\S+$/i.test(w);

// Every write goes through the file rules (core/files.mjs).
function write(dir, name, data) {
  const real = checkPath(path.join(dir, name), { write: true });
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, data);
}

function addToIndex(dir, time, kind, name, note) {
  const text = note ? ` | ${note.replace(/\s+/g, " ")}` : "";
  const real = checkPath(path.join(dir, "index.md"), { write: true });
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.appendFileSync(real, `- ${time} | ${kind} | ${name}${text}\n`);
}

// A text note: the text, then the hidden links. Only links: kept as a link item.
function saveText(dir, msg, time) {
  const text = msg.text;
  const links = hiddenLinks(msg.entities);
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length && words.every(isLink)) {
    const all = [...words, ...links];
    const name = freeName(dir, `${time.file}_link`, ".md");
    write(dir, name, `${all.join("\n")}\n`);
    return { kind: "link", name, note: all.join(" ") };
  }
  const name = freeName(dir, `${time.file}_text`, ".md");
  write(
    dir,
    name,
    `${text}${links.length ? `\n\nLinks:\n${links.join("\n")}` : ""}\n`,
  );
  return { kind: "text", name, note: text.slice(0, 120) };
}

// The file a message carries: { field, file, base, ext, renamed } (base and ext of the name it is saved under), or
// null. A name the file rules refuse (a .pem, "token" in it) is saved under the neutral `<time>_<field>` with no
// extension, `renamed` true: never written, it would be resent at every connect and never acknowledged.
function fileOf(msg, time) {
  if (msg.photo?.length) {
    const file = msg.photo.at(-1);
    return { field: "photo", file, base: `${time.file}_photo`, ext: ".jpg" };
  }
  const found = FILE_KINDS.find(([field]) => msg[field]);
  if (!found) return null;
  const [field, fallback] = found;
  const file = msg[field];
  const original = file.file_name ? `_${safe(file.file_name)}` : `_${field}`;
  const base = `${time.file}${original}`;
  if (secretName(base))
    return {
      field,
      file,
      base: `${time.file}_${field}`,
      ext: "",
      renamed: true,
    };
  const ext = path.extname(base);
  return ext
    ? { field, file, base: base.slice(0, -ext.length), ext }
    : { field, file, base, ext: fallback };
}

const kindOf = (field) => (field === "document" ? "file" : field);

const sizeText = (n) =>
  Number.isSafeInteger(n)
    ? `${(n / 1024 / 1024).toFixed(1)} MB`
    : "size unknown";

// ---- saved.list ----

// The index lines, newest first, 50 a page: { time, kind, name, caption }.
export function listSaved(dir, page) {
  const index = path.join(dir, "index.md");
  if (!fs.existsSync(index)) return { items: [], more: false };
  const lines = readText(index).split("\n").filter(Boolean).reverse();
  const items = [];
  for (const line of lines.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)) {
    const m = line.match(/^- (.+?) \| (.+?) \| (.+?)(?: \| (.*))?$/);
    if (!m) throw new Error(`${index} has a line that is not an index line`);
    items.push({ time: m[1], kind: m[2], name: m[3], caption: m[4] ?? "" });
  }
  return { items, more: lines.length > page * PAGE_SIZE };
}

export function register(registry) {
  registry.add({
    name: "saved.list",
    input: { page: { type: "integer", min: 1, max: 10000 } },
    run: (d) => listSaved(inboxDir(), d.page),
  });
}

// ---- held forwards ----

export function createIntake({ keys, send, dir, albumWaitMs = ALBUM_WAIT_MS }) {
  if (!keys?.inbox?.priv || !keys.inbox.pub)
    throw new Error("intake: the keys have no inbox key pair");
  if (typeof send !== "function") throw new Error("intake: send is missing");
  if (typeof dir !== "string" || !path.isAbsolute(dir))
    throw new Error(`intake: the folder must be an absolute path, got ${dir}`);

  const state = new Map(); // held id -> "queued" | "saved"
  const waiting = new Map(); // fileId -> one fetch in progress
  const albums = new Map(); // chat:media_group_id -> the parts saved so far
  let queue = Promise.resolve();
  let busy = 0;
  let inboxKey = null;

  const ack = (id) => send({ v: 1, t: "held-ack", id });

  async function open(c) {
    inboxKey ||= await importPrivate(keys.inbox.priv);
    const bytes = await openBox(
      inboxKey,
      fromB64u(keys.inbox.pub),
      fromB64u(c),
    );
    return bytes ? JSON.parse(fromUtf8(bytes)) : null;
  }

  function onFrame(f) {
    if (f.t === "file") return onFile(f);
    if (f.t !== "held") throw new Error(`intake: not a held frame: ${f.t}`);
    if (typeof f.id !== "string" || typeof f.c !== "string") {
      log("drop", "held frame without id or c");
      return;
    }
    const was = state.get(f.id);
    if (was === "saved") return void ack(f.id);
    if (was === "queued") return;
    state.set(f.id, "queued");
    busy += 1;
    queue = queue
      .then(() => saveHeld(f))
      .catch((e) => {
        state.delete(f.id);
        log("error", `held item not saved: ${e.message}`);
      })
      .finally(() => {
        busy -= 1;
      });
    return queue;
  }

  function saved(id) {
    state.set(id, "saved");
    ack(id);
  }

  async function saveHeld(f) {
    const msg = await open(f.c);
    if (!msg) {
      // Sealed to another key: no later try can open it either.
      log("drop", "held item does not open with this PC's inbox key");
      return saved(f.id);
    }
    const time = stamp(msg.date);
    if (msg.media_group_id) return addToAlbum(msg, time, f.id);
    const item =
      typeof msg.text === "string"
        ? saveText(dir, msg, time)
        : await saveCarried(msg, time);
    addToIndex(dir, time.shown, item.kind, item.name, item.note);
    log("saved", item.kind);
    saved(f.id);
  }

  // A message that is not text: its file, a note for a file too big or gone, or a note naming the kind.
  async function saveCarried(msg, time) {
    let caption = [msg.caption, ...hiddenLinks(msg.caption_entities)]
      .filter(Boolean)
      .join(" ");
    const found = fileOf(msg, time);
    if (!found) {
      const what = OTHER_KINDS.find((k) => msg[k]) || "other";
      const name = freeName(dir, `${time.file}_${what}`, ".md");
      write(
        dir,
        name,
        `A ${what} message was forwarded. This kind is not saved here; it stays in the Telegram chat.\n`,
      );
      return { kind: what, name, note: caption };
    }
    const { field, file, base, ext, renamed } = found;
    const shown = file.file_name ? safe(file.file_name) : field;
    if (renamed)
      caption = [`sent as ${shown}`, caption].filter(Boolean).join(": ");
    if (Number.isSafeInteger(file.file_size) && file.file_size > FILE_LIMIT) {
      const name = freeName(dir, `${base}_too-big`, ".md");
      write(
        dir,
        name,
        `${shown}, ${sizeText(file.file_size)}\nToo big for the bot (over 20 MB); it stays in the Telegram chat.\n${caption ? `\n${caption}\n` : ""}`,
      );
      return {
        kind: `${kindOf(field)}, too big`,
        name,
        note: [`${shown} ${sizeText(file.file_size)}`, caption]
          .filter(Boolean)
          .join(": "),
      };
    }
    let bytes;
    try {
      bytes = await fetchFile(file.file_id);
    } catch (e) {
      if (e.code !== "no-file") throw e;
      // The relay no longer holds this file's key (fetched before, or 30 days): only a note is possible.
      const name = freeName(dir, `${base}_gone`, ".md");
      write(
        dir,
        name,
        `${shown}\nThe relay could no longer fetch this file; it stays in the Telegram chat.\n`,
      );
      return { kind: `${kindOf(field)}, gone`, name, note: caption };
    }
    const name = freeName(dir, base, ext);
    write(dir, name, bytes);
    return { kind: kindOf(field), name, note: caption };
  }

  // Album parts are saved as they come; the one index line is written when no part has come for albumWaitMs
  // and nothing else waits in the queue. The parts are acknowledged only then.
  async function addToAlbum(msg, time, id) {
    const key = `${msg.chat.id}:${msg.media_group_id}`;
    const item = await saveCarried(msg, time);
    let album = albums.get(key);
    if (!album) {
      album = { time, items: [], ids: [], caption: "", timer: null };
      albums.set(key, album);
    }
    album.items.push(item.name);
    album.ids.push(id);
    if (!album.caption && item.note) album.caption = item.note;
    arm(key, album);
  }

  function arm(key, album) {
    clearTimeout(album.timer);
    album.timer = setTimeout(() => {
      if (busy > 0) return arm(key, album);
      albums.delete(key);
      queue = queue.then(() => {
        const n = album.items.length;
        addToIndex(
          dir,
          album.time.shown,
          `album (${n})`,
          album.items.join(", "),
          album.caption,
        );
        log("saved", `album of ${n}`);
        for (const id of album.ids) saved(id);
      });
    }, albumWaitMs);
  }

  // ---- files: `fetch { fileId }`, then `file { fileId, i, of, d }` pieces or `file { fileId, err }` ----

  function fetchFile(fileId) {
    return new Promise((resolve, reject) => {
      if (waiting.has(fileId))
        return reject(new Error("this file is already being fetched"));
      const w = { pieces: [], of: null, timer: null, resolve };
      w.fail = (code, text) => {
        clearTimeout(w.timer);
        waiting.delete(fileId);
        reject(Object.assign(new Error(text), { code }));
      };
      w.wait = () => {
        clearTimeout(w.timer);
        w.timer = setTimeout(
          () => w.fail("fetch-timeout", "no file piece came for 2 minutes"),
          FETCH_WAIT_MS,
        );
      };
      waiting.set(fileId, w);
      w.wait();
      if (!send({ v: 1, t: "fetch", fileId }))
        w.fail("offline", "the relay is not connected");
    });
  }

  function onFile(f) {
    const w = waiting.get(f.fileId);
    if (!w) return void log("drop", "file piece nobody asked for");
    if (typeof f.err === "string")
      return w.fail(f.err, `the relay could not send the file: ${f.err}`);
    if (
      !Number.isSafeInteger(f.of) ||
      f.of < 1 ||
      (w.of !== null && f.of !== w.of) ||
      f.i !== w.pieces.length ||
      typeof f.d !== "string"
    )
      return w.fail("file-broken", "file pieces came out of order");
    w.of = f.of;
    w.pieces.push(fromB64u(f.d));
    if (w.pieces.length < w.of) return w.wait();
    clearTimeout(w.timer);
    waiting.delete(f.fileId);
    w.resolve(concat(...w.pieces));
  }

  return { onFrame };
}
