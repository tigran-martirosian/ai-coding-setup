// Files and photos from the phone (screens 2 design, "Attach"). The phone sends each picked file as a stream;
// attach.put checks its kind by its first bytes and its size, saves it in the project's attach place under a name
// the PC makes, and answers a random id. session.send, session.queue and session.new take up to 8 ids and append
// Nimbalyst's own block naming each saved file, so the session opens it with its Read tool, as Nimbalyst's box does.
// An id belongs to the device that uploaded it, is used once, and its file is deleted when it is not used in 24 h
// or when the channel session it came in ends. The chips live only in the page's memory, and the PC cannot tell a
// reopened page from a reconnect of the same one (the hello carries nothing that outlives a page), so every end of
// a channel session (bye, a new hello, a counter gap, the device removed) drops the device's unused files.
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { knownSession } from "../core/db.mjs";
import {
  PROJECT_INPUT,
  projectByHandle,
  SESSION_INPUT,
} from "../core/door.mjs";
import { attachFolders, attachPlace, writeAttachment } from "../core/files.mjs";
import { log } from "../core/log.mjs";
import { ActionError } from "../core/registry.mjs";

const MB = 1024 * 1024;
// The PC program has no settings file; these are the design's defaults.
export const ATTACH_ALL_MAX_BYTES = 500 * MB; // every project's attach place together
export const ATTACH_DISK_FREE_MIN_BYTES = 2 * 1024 * MB; // free disk left after a write
const DEVICE_MAX_FILES = 8; // unused attachments of one device
const DEVICE_MAX_BYTES = 25 * MB;
const UNUSED_MS = 24 * 3600 * 1000;
const KEEP_MS = 7 * 24 * 3600 * 1000;
const CLEAN_EVERY_MS = 24 * 3600 * 1000;
const STEM_MAX = 40;

const STREAM_ID = /^[A-Za-z0-9_-]{1,64}$/;
const ID = /^[0-9a-f]{16}$/;
export const ATTACHMENTS_INPUT = {
  type: "list",
  min: 1,
  max: 8,
  optional: true,
  item: { type: "string", min: 16, max: 16, pattern: ID },
};
export const BLOCK_HEAD = "Attached files (open each with your read tool):";

// Nimbalyst's text extensions less the kinds Windows runs or opens as a program.
const TEXT_EXT = new Set(
  (
    "log json yaml yml toml xml csv ini cfg conf env properties md markdown txt rst css ts tsx py rb rs go " +
    "java kt swift c cpp h hpp cs php lua r scala clj ex exs erl hs ml sql graphql gql proto sh bash zsh fish " +
    "dockerfile"
  ).split(" "),
);
const CAP = { picture: 20 * MB, pdf: 10 * MB, text: 10 * MB };

const starts = (b, bytes, at = 0) =>
  b.length >= at + bytes.length &&
  bytes.every(
    (x, i) => b[at + i] === (typeof x === "string" ? x.charCodeAt(0) : x),
  );
const utf8 = new TextDecoder("utf-8", { fatal: true });

// { kind, ext } by the first bytes; the phone's mime is never trusted. ext is null for text (from the name).
export function kindOf(b) {
  if (starts(b, [0x89, ..."PNG", 0x0d, 0x0a, 0x1a, 0x0a]))
    return { kind: "picture", ext: "png" };
  if (starts(b, [0xff, 0xd8, 0xff])) return { kind: "picture", ext: "jpg" };
  if (starts(b, [..."GIF87a"]) || starts(b, [..."GIF89a"]))
    return { kind: "picture", ext: "gif" };
  if (starts(b, [..."RIFF"]) && starts(b, [..."WEBP"], 8))
    return { kind: "picture", ext: "webp" };
  if (starts(b, [..."%PDF-"])) return { kind: "pdf", ext: "pdf" };
  if (b.includes(0)) return null;
  try {
    utf8.decode(b);
  } catch {
    return null;
  }
  return { kind: "text", ext: null };
}

const clean = (s) =>
  Array.from(s.replace(/[^\p{L}\p{Nd} _-]/gu, ""))
    .slice(0, STEM_MAX)
    .join("");

// The stem and extension of the saved name, from the phone's name without its folder part.
export function nameParts(phoneName, found) {
  const base = phoneName.split(/[\\/]/).pop();
  const dot = base.lastIndexOf(".");
  let stem = dot > 0 ? base.slice(0, dot) : base;
  let ext = found.ext;
  if (!ext) {
    const had = dot > 0 ? base.slice(dot + 1).toLowerCase() : "";
    if (TEXT_EXT.has(had)) ext = had;
    else {
      ext = "txt";
      if (had) stem = `${stem}-${had}`;
    }
  }
  return { stem: clean(stem) || "file", ext };
}

let lastSecond = "";
let inSecond = 0;
const pad = (n) => String(n).padStart(2, "0");

// Writes the file as <yyyymmdd-hhmmss>-<n>_<stem>.<ext>; <n> counts up within the second, and an existing name
// (flag "wx") moves on to the next <n>.
function save(place, stem, ext, bytes) {
  const d = new Date();
  const second = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  if (second !== lastSecond) {
    lastSecond = second;
    inSecond = 0;
  }
  for (;;) {
    const name = `${second}-${++inSecond}_${stem}.${ext}`;
    try {
      return { name, file: writeAttachment(place, name, bytes) };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
    }
  }
}

// ---- the ids: id -> { device, project, file, name, size, at, timer }; an id leaves the map when it is used

const ids = new Map();

function forget(id, entry) {
  clearTimeout(entry.timer);
  ids.delete(id);
}

function deleteFile(file) {
  try {
    fs.rmSync(file, { force: true });
  } catch (e) {
    log("error", `attach: cannot delete a file: ${e.message}`);
  }
}

function keep(id, entry) {
  ids.set(id, entry);
  entry.timer = setTimeout(
    () => {
      if (ids.get(id) !== entry) return;
      ids.delete(id);
      deleteFile(entry.file);
      log("attach", "an unused file deleted after 24 hours");
    },
    Math.max(0, entry.at + UNUSED_MS - Date.now()),
  );
  entry.timer.unref?.();
}

// The channel session the file came in has ended: an unused file goes; a file in a send gets `ended`, so a failed
// send does not give it back.
function dropOnEnd(id, entry) {
  entry.ended = true;
  if (ids.get(id) !== entry) return;
  forget(id, entry);
  deleteFile(entry.file);
  log("attach", "an unused file deleted: its channel session ended");
}

const unusedOf = (device) =>
  [...ids.values()].filter((e) => e.device === device);

function folderBytes(dir) {
  let sum = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true }))
    if (f.isFile()) sum += fs.statSync(path.join(dir, f.name)).size;
  return sum;
}

// disk-full when the new file takes every attach place over 500 MB or leaves the disk under 2 GB free.
function checkDisk(place, size) {
  const all = attachFolders().reduce((s, d) => s + folderBytes(d), 0);
  const disk = fs.statfsSync(place);
  const free = disk.bavail * disk.bsize;
  if (
    all + size > ATTACH_ALL_MAX_BYTES ||
    free - size < ATTACH_DISK_FREE_MIN_BYTES
  )
    throw new ActionError("disk-full");
}

// Deletes this PC's own files older than 7 days in every attach place (only the PC writes there).
export function cleanOld(now = Date.now()) {
  let n = 0;
  for (const dir of attachFolders())
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, f.name);
      if (f.isFile() && now - fs.statSync(file).mtimeMs > KEEP_MS) {
        fs.rmSync(file, { force: true });
        n++;
      }
    }
  if (n) log("attach", `${n} files older than 7 days deleted`);
}

// Takes the ids for one send: every id must be this device's, unused, saved for this project and listed once,
// else attachment-unknown and none is taken. They leave the map here, before the send's first wait, so two sends
// cannot both use one. Returns { text, giveBack }: the text with Nimbalyst's block, and giveBack() for a failed send.
export function takeAttachments(list, device, projectPath, text) {
  if (!list) return { text, giveBack: () => {} };
  const seen = new Set();
  const got = [];
  for (const id of list) {
    const e = ids.get(id);
    if (seen.has(id) || !e || e.device !== device || e.project !== projectPath)
      throw new ActionError("attachment-unknown");
    seen.add(id);
    got.push([id, e]);
  }
  for (const [id, e] of got) forget(id, e);
  const lines = got.map(([, e]) => `- ${e.name}: ${e.file}`);
  return {
    text: `${text}\n\n${BLOCK_HEAD}\n${lines.join("\n")}`,
    giveBack: () => {
      for (const [id, e] of got)
        if (e.ended) deleteFile(e.file);
        else keep(id, e);
    },
  };
}

export function register(registry) {
  // At start and once a day after. A clean-up that fails is logged; it does not stop the program.
  const clean = () => {
    try {
      cleanOld();
    } catch (e) {
      log("error", `attach clean-up: ${e.message}`);
    }
  };
  clean();
  setInterval(clean, CLEAN_EVERY_MS).unref?.();

  // Exactly one of session or project; `name` is the phone's file name, used only for the saved name's stem.
  registry.add({
    name: "attach.put",
    input: {
      stream: { type: "string", min: 1, max: 64, pattern: STREAM_ID },
      session: { ...SESSION_INPUT, optional: true },
      project: { ...PROJECT_INPUT, optional: true },
      name: { type: "string", min: 1, max: 255 },
    },
    run(d, ctx) {
      if ((d.session === undefined) === (d.project === undefined))
        throw new ActionError("bad-input", { field: "session" });
      const projectPath = d.session
        ? knownSession(d.session).project.path
        : projectByHandle(d.project).path;
      const got = ctx.takeStream(d.stream);
      if (!got) throw new ActionError("no-stream");
      const size = got.bytes.length;
      const found = kindOf(got.bytes);
      if (!found) throw new ActionError("kind-not-allowed");
      if (size > CAP[found.kind])
        throw new ActionError("too-big", {
          kind: found.kind,
          max: CAP[found.kind],
        });
      const mine = unusedOf(ctx.device);
      if (
        mine.length >= DEVICE_MAX_FILES ||
        mine.reduce((s, e) => s + e.size, 0) + size > DEVICE_MAX_BYTES
      )
        throw new ActionError("too-many");
      const place = attachPlace(projectPath);
      checkDisk(place, size);
      const { stem, ext } = nameParts(d.name, found);
      const { name, file } = save(place, stem, ext, got.bytes);
      const id = randomBytes(8).toString("hex");
      const entry = {
        device: ctx.device,
        project: projectPath,
        file,
        name,
        size,
        at: Date.now(),
        timer: null,
        ended: false,
      };
      keep(id, entry);
      log("attach", `saved: ${found.kind}, ${size} bytes`);
      // Called at once when the session already ended while this ran.
      ctx.onEnd(() => dropOnEnd(id, entry));
      return { id };
    },
  });

  // The chip's remove: deletes an unused file of this device.
  registry.add({
    name: "attach.drop",
    input: { id: { type: "string", min: 16, max: 16, pattern: ID } },
    run({ id }, ctx) {
      const e = ids.get(id);
      if (!e || e.device !== ctx.device)
        throw new ActionError("attachment-unknown");
      forget(id, e);
      fs.rmSync(e.file, { force: true });
      return { dropped: true };
    },
  });
}

// Runs send(text with the block) and gives the ids back when it fails.
export async function sendWithAttachments(
  list,
  device,
  projectPath,
  text,
  send,
) {
  const t = takeAttachments(list, device, projectPath, text);
  try {
    return await send(t.text);
  } catch (e) {
    t.giveBack();
    throw e;
  }
}
