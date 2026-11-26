// The Files tab's actions on the Files folder ~/phone-inbox (files contract docs/2026-11-17-phone-files-design.md,
// sections 3, 4 and 6). Every path from the page is relative to the Files folder and goes through folderPath, which
// names the rule it breaks, before any other disk call. folder.remove moves into .removed (emptied after 7 days);
// folder.put saves a whole sealed stream; folder.send and folder.link hand a file to the relay (Send to chat and the
// one-time download link), which needs a relay that said `files: 1`. main.mjs hands this file the keys and the
// relay socket's send with bindFolder, tells it the relay's pc-auth answer with relayReady, and passes it the relay
// frames dl-made, dl-pull, dl-fail and error files-rate with folderFrame. folder.copy and folder.show act on this
// PC's screen: the file goes on the Windows clipboard as a file (as Explorer's Copy), or Explorer opens with it
// selected; Telegram Desktop lets no file be dragged out of the page.
import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  checkPath,
  DEVICE,
  realSecretName,
  SESSION_SECRET_PARTS,
  secretName,
} from "../core/files.mjs";
import { relayUrl } from "../core/link.mjs";
import { log } from "../core/log.mjs";
import { TEST } from "../core/mode.mjs";
import { ActionError } from "../core/registry.mjs";
import { ATTACH_DISK_FREE_MIN_BYTES } from "./attach.mjs";
import { inboxDir } from "./saved.mjs";

const MB = 1024 * 1024;
export const FILE_MAX_BYTES = 50 * MB; // drop-in and the download link
// Send to chat: Telegram caps the whole upload at 50 MiB, the relay's multipart wrapping included, so the file stops
// at 50,000,000 bytes (the relay's SEND_MAX).
export const SEND_MAX_BYTES = 50_000_000;
export const FOLDER_MAX_BYTES = 5 * 1024 * MB; // the whole Files folder
export const LIST_MAX = 500;
const PATH_MAX = 400;
const PARTS_MAX = 5;
const NAME_MAX = 120;
const REMOVED = ".removed";
const REMOVED_KEEP_MS = 7 * 24 * 3600 * 1000;
const PART_KEEP_MS = 3600 * 1000;
const CLEAN_EVERY_MS = 24 * 3600 * 1000;
const PART = /\.part-[0-9a-f]+$/;
const SEND_WAIT_MS = 5 * 60 * 1000; // the page waits as long for folder.send
const MADE_WAIT_MS = 20_000; // dl-open until dl-made (the contract names no time)
const LINK_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MIME = {
  ".txt": "text/plain",
  ".md": "text/markdown",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".zip": "application/zip",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".mp4": "video/mp4",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};
const WIN = process.platform === "win32";
const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);

const refuse = (rule) => {
  log("folder-refused", rule);
  throw new ActionError("folder-refused", { rule });
};

// The Files folder, made when it is not there yet (bot forwards make it too).
function root() {
  const dir = inboxDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// The real path of a page path, or folder-refused with the rule (contract 3.1, rules in order). `write` is passed
// to core/files.mjs checkPath, which runs last for every path but the Files folder itself (it is the place, not
// inside it).
export function folderPath(rel, { write = false } = {}) {
  if (typeof rel !== "string" || rel.length > PATH_MAX) refuse("path form");
  const parts = rel === "" ? [] : rel.split("/");
  if (
    /^[/\\]/.test(rel) ||
    rel.includes("\\") ||
    rel.includes(":") ||
    [...rel].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127) ||
    parts.some((p) => p === "" || p === "." || p === "..") ||
    parts.length > PARTS_MAX
  )
    refuse("path form");
  if (
    parts.some(
      (p) =>
        p.length > NAME_MAX ||
        /[ .]$/.test(p) ||
        /[<>"|?*]/.test(p) ||
        DEVICE.test(p),
    )
  )
    refuse("bad name");
  const low = parts.map((p) => p.toLowerCase());
  if ((low.length === 1 && low[0] === "index.md") || low.includes(REMOVED))
    refuse("hidden");
  // Both lists: the wide one (secretName) and the real secret files (realSecretName, e.g. .dev.vars, pc-keys.json).
  const last = low[low.length - 1];
  if (last && (secretName(last) || realSecretName(last)))
    refuse("secret file name");
  if (low.some((p) => SESSION_SECRET_PARTS.has(p))) refuse("secret folder");
  const top = root();
  let at = top;
  for (const p of parts) {
    at = path.join(at, p);
    let st;
    try {
      st = fs.lstatSync(at);
    } catch (e) {
      if (e.code === "ENOENT") break;
      throw e;
    }
    if (st.isSymbolicLink()) refuse("link");
  }
  const real = realOf(path.join(top, ...parts));
  const topReal = fs.realpathSync.native(top);
  const inner = path.relative(topReal, real);
  if (
    !(rel === "" ? same(real, topReal) : inner && !inner.startsWith("..")) ||
    path.isAbsolute(inner)
  )
    refuse("outside the folder");
  return rel === "" ? real : checkPath(real, { write });
}

// The real path; for a path not made yet, the real path of its nearest existing folder and the rest.
function realOf(p) {
  let head = p;
  const rest = [];
  while (!fs.existsSync(head)) {
    rest.unshift(path.basename(head));
    head = path.dirname(head);
  }
  return path.join(fs.realpathSync.native(head), ...rest);
}

const join = (dir, name) => (dir === "" ? name : `${dir}/${name}`);
const parentOf = (rel) => rel.split("/").slice(0, -1).join("/");
const baseOf = (rel) => rel.split("/").pop();

function statOr(real, err) {
  try {
    return fs.statSync(real);
  } catch (e) {
    if (e.code === "ENOENT") throw new ActionError(err);
    throw e;
  }
}

const freeBytes = (dir) => {
  const disk = fs.statfsSync(dir);
  return disk.bavail * disk.bsize;
};

// Bytes of every file under dir, links not followed.
function treeBytes(dir) {
  let sum = 0;
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, f.name);
    if (f.isDirectory()) sum += treeBytes(p);
    else if (f.isFile()) sum += fs.statSync(p).size;
  }
  return sum;
}

// A name not taken yet in dir: "a.txt", then "a_2.txt", "a_3.txt" (as saved.mjs freeName).
function freeName(dir, name) {
  const ext = path.extname(name);
  const base = name.slice(0, name.length - ext.length);
  let n = name;
  for (let i = 2; fs.existsSync(path.join(dir, n)); i++)
    n = `${base}_${i}${ext}`;
  return n;
}

const fileCount = (real) =>
  fs
    .readdirSync(real, { withFileTypes: true })
    .filter((f) => f.isFile() && !PART.test(f.name.toLowerCase())).length;

function list(dir) {
  const real = folderPath(dir);
  if (!statOr(real, "not-found").isDirectory())
    throw new ActionError("not-found");
  const items = [];
  for (const f of fs.readdirSync(real, { withFileTypes: true })) {
    const low = f.name.toLowerCase();
    if (low === REMOVED || (dir === "" && low === "index.md")) continue;
    // An upload still being saved (<name>.part-<random>) is not a file yet.
    if (PART.test(low)) continue;
    // Links and other kinds are left out: every action refuses them.
    if (!f.isDirectory() && !f.isFile()) continue;
    let st;
    try {
      st = fs.statSync(path.join(real, f.name));
    } catch (e) {
      if (e.code === "ENOENT") continue; /* deleted while listed */
      throw e;
    }
    items.push({
      name: f.name,
      kind: f.isDirectory() ? "folder" : "file",
      size: f.isDirectory() ? 0 : st.size,
      at: st.mtime.toISOString(),
      // A folder's row reads "N files" or "Empty": its own files, not those of its subfolders.
      ...(f.isDirectory() && { count: fileCount(path.join(real, f.name)) }),
    });
  }
  items.sort(
    (a, b) =>
      (a.kind === "folder" ? 0 : 1) - (b.kind === "folder" ? 0 : 1) ||
      (b.at > a.at ? 1 : b.at < a.at ? -1 : 0),
  );
  return {
    dir,
    items: items.slice(0, LIST_MAX),
    more: items.length > LIST_MAX,
    free: freeBytes(real),
  };
}

// The real folder a new item goes into: it must exist and be a folder.
function folderOf(dir, write) {
  const real = folderPath(dir, { write });
  if (!statOr(real, "not-found").isDirectory())
    throw new ActionError("not-found");
  return real;
}

function make(dir, name) {
  folderOf(dir, true);
  const real = folderPath(join(dir, name), { write: true });
  if (fs.existsSync(real)) throw new ActionError("exists");
  fs.mkdirSync(real);
  return { name };
}

function rename(rel, name) {
  const from = folderPath(rel, { write: true });
  statOr(from, "not-found");
  const to = folderPath(join(parentOf(rel), name), { write: true });
  if (fs.existsSync(to)) throw new ActionError("exists");
  fs.renameSync(from, to);
  return { name };
}

function move(rel, to) {
  const from = folderPath(rel, { write: true });
  statOr(from, "not-found");
  const lowRel = rel.toLowerCase();
  const lowTo = to.toLowerCase();
  if (lowTo === lowRel || lowTo.startsWith(`${lowRel}/`))
    throw new ActionError("into-itself");
  folderOf(to, true);
  const next = join(to, baseOf(rel));
  const target = folderPath(next, { write: true });
  if (fs.existsSync(target)) throw new ActionError("exists");
  fs.renameSync(from, target);
  return { path: next };
}

// Moves the item into .removed/<ms>-<name>; cleanFolder empties entries over 7 days old.
function remove(rel) {
  const from = folderPath(rel, { write: true });
  statOr(from, "not-found");
  const bin = path.join(root(), REMOVED);
  fs.mkdirSync(bin, { recursive: true });
  fs.renameSync(from, path.join(bin, `${Date.now()}-${baseOf(rel)}`));
  log("folder", "removed one item into .removed");
  return { removed: rel };
}

// Saves a whole stream as <name>.part-<random>, then renames it to a free name.
function put(dir, name, stream, ctx) {
  const folder = folderOf(dir, true);
  folderPath(join(dir, name), { write: true });
  const got = ctx.takeStream(stream);
  if (!got) throw new ActionError("stream-gone");
  const size = got.bytes.length;
  if (size > FILE_MAX_BYTES)
    throw new ActionError("too-big", { max: FILE_MAX_BYTES });
  if (freeBytes(folder) - size < ATTACH_DISK_FREE_MIN_BYTES)
    throw new ActionError("disk-full");
  if (treeBytes(root()) + size > FOLDER_MAX_BYTES)
    throw new ActionError("folder-full");
  const part = path.join(
    folder,
    `${name}.part-${randomBytes(6).toString("hex")}`,
  );
  try {
    fs.writeFileSync(part, got.bytes, { flag: "wx" });
  } catch (e) {
    fs.rmSync(part, { force: true });
    if (e.code === "ENOSPC") throw new ActionError("disk-full");
    throw e;
  }
  const saved = freeName(folder, name);
  fs.renameSync(part, path.join(folder, saved));
  log("folder", `put: ${size} bytes`);
  return { name: saved, size };
}

// At start and once a day: empties .removed entries over 7 days old and drops .part files over 1 hour old.
export function cleanFolder(now = Date.now()) {
  const top = inboxDir();
  if (!fs.existsSync(top)) return;
  const bin = path.join(top, REMOVED);
  if (fs.existsSync(bin))
    for (const f of fs.readdirSync(bin)) {
      const at = Number(f.split("-")[0]);
      if (!Number.isSafeInteger(at) || now - at > REMOVED_KEEP_MS)
        fs.rmSync(path.join(bin, f), { recursive: true, force: true });
    }
  const parts = (dir, depth) => {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, f.name);
      if (f.isDirectory() && f.name !== REMOVED && depth < PARTS_MAX)
        parts(p, depth + 1);
      else if (
        f.isFile() &&
        PART.test(f.name) &&
        now - fs.statSync(p).mtimeMs > PART_KEEP_MS
      )
        fs.rmSync(p, { force: true });
    }
  };
  parts(top, 1);
}

// ---- Copy file and Show in folder, on this PC's screen

const COMMAND_WAIT_MS = 15_000;

// Runs a program with fixed arguments and no shell, no window. Answers { code, words }; rejects only when the
// program could not be started.
function runCommand(file, args, env, opts = {}) {
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      {
        encoding: "utf8",
        timeout: COMMAND_WAIT_MS,
        windowsHide: true,
        env,
        ...opts,
      },
      (error, stdout, stderr) => {
        if (error && typeof error.code === "string") return reject(error);
        const words = `${stderr || ""}${stdout || ""}`
          .trim()
          .replace(/\s+/g, " ")
          .slice(0, 240);
        resolve({ code: child.exitCode, words: words || error?.message || "" });
      },
    );
  });
}

let run = runCommand;

// Test mode only: a stand-in for runCommand, called as run(file, args, env, opts).
export function setCommandRunner(fn) {
  if (!TEST)
    throw new Error("folder: setCommandRunner works only in test mode");
  run = fn;
}

// The file goes on the clipboard as a file, so it pastes in Explorer, a chat or a mail. The path goes to PowerShell
// in an environment variable, never inside the command text.
async function copyFile(rel) {
  const real = folderPath(rel);
  if (!statOr(real, "not-found").isFile()) throw new ActionError("not-found");
  let r;
  try {
    r = await run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-STA",
        "-Command",
        "$ErrorActionPreference = 'Stop'; Set-Clipboard -LiteralPath $env:PHONE_PC_COPY_PATH",
      ],
      { ...process.env, PHONE_PC_COPY_PATH: real },
    );
  } catch (e) {
    throw new ActionError("copy-failed", { why: e.message });
  }
  if (r.code !== 0)
    throw new ActionError("copy-failed", {
      why: r.words || `PowerShell exit code ${r.code}`,
    });
  log("folder", "copied one file to the clipboard");
  return { copied: rel };
}

// Explorer opens with the item selected. explorer.exe answers exit code 1 even when it opened the window, so only a
// failed start is an error. The path is quoted and passed as written: explorer.exe reads /select, up to a comma, so an
// unquoted name with a comma would select the wrong item.
async function showFile(rel) {
  const real = folderPath(rel);
  statOr(real, "not-found");
  try {
    await run("explorer.exe", [`/select,"${real}"`], process.env, {
      windowsVerbatimArguments: true,
    });
  } catch (e) {
    throw new ActionError("show-failed", { why: e.message });
  }
  log("folder", "showed one item in Explorer");
  return { shown: rel };
}

// ---- Send to chat and the download link: the PC's part (contract sections 5 and 6)

let bound = null;
let relayFiles = false; // the relay's last pc-auth answer said files: 1
const opening = new Map(); // ref -> { resolve, reject, timer } from dl-open until dl-made or dl-fail
const links = new Map(); // ref -> { rel, size, timer } from dl-made until dl-pull, dl-fail or the link's end

export function bindFolder({ keys, send }) {
  if (typeof keys?.relay !== "string" || typeof keys.pcId !== "string")
    throw new Error("folder: bindFolder needs the keys with relay and pcId");
  if (typeof send !== "function")
    throw new Error("folder: bindFolder needs the relay socket's send");
  bound = { keys, send };
}

function held() {
  if (!bound)
    throw new Error("folder: an action ran before main.mjs called bindFolder");
  return bound;
}

// The relay accepted the PC: its answer says whether it has file moves. Only files: 1 is the transport built here.
export function relayReady(f) {
  relayFiles = f?.files === 1;
}

const relayHeaders = (size) => ({
  "X-Phone-Pc": held().keys.pcId,
  Authorization: `Bearer ${held().keys.token}`,
  "Content-Length": String(size),
});

const fileBody = (real) => Readable.toWeb(fs.createReadStream(real));

// A file the relay may take: a file of 50 MB at most, and a relay that said files: 1.
function sendable(rel) {
  const real = folderPath(rel);
  const st = statOr(real, "not-found");
  if (!st.isFile()) throw new ActionError("not-found");
  if (st.size > FILE_MAX_BYTES)
    throw new ActionError("too-big", { max: FILE_MAX_BYTES });
  held();
  if (!relayFiles) throw new ActionError("relay-too-old");
  const name = baseOf(rel);
  const mime =
    MIME[path.extname(name).toLowerCase()] || "application/octet-stream";
  return { real, size: st.size, name, mime };
}

const RELAY_REFUSED = { "too-big": "too-big", rate: "rate" };

async function sendToChat(rel) {
  const { real, size, name, mime } = sendable(rel);
  if (size > SEND_MAX_BYTES)
    throw new ActionError("too-big", { max: SEND_MAX_BYTES });
  let res;
  let body;
  try {
    res = await fetch(relayUrl(held().keys.relay, "/pc/send"), {
      method: "POST",
      headers: {
        ...relayHeaders(size),
        "Content-Type": mime,
        "X-File-Name": encodeURIComponent(name),
      },
      body: fileBody(real),
      duplex: "half",
      signal: AbortSignal.timeout(SEND_WAIT_MS),
    });
    body = await res.json().catch(() => null);
  } catch (e) {
    // fetch says only "fetch failed": its cause's code (ECONNRESET, UND_ERR_SOCKET) says why. The cause's message
    // is left out, as it can hold the relay's address.
    const code = typeof e.cause?.code === "string" ? ` (${e.cause.code})` : "";
    throw new ActionError("relay-failed", { why: `${e.message}${code}` });
  }
  if (body?.ok === true) {
    log("folder", `sent to chat: ${size} bytes`);
    return { sent: true };
  }
  const e = typeof body?.e === "string" ? body.e : `HTTP ${res.status}`;
  if (RELAY_REFUSED[e]) throw new ActionError(RELAY_REFUSED[e]);
  if (e === "telegram-refused")
    throw new ActionError("telegram-refused", { why: String(body.why ?? "") });
  throw new ActionError("relay-failed", { why: e });
}

// dl-open, then the relay's dl-made gives the link; the bytes go when dl-pull comes.
async function makeLink(rel) {
  const { size, name, mime } = sendable(rel);
  const ref = randomBytes(16).toString("base64url");
  const { url, until } = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      opening.delete(ref);
      reject(
        new ActionError("relay-failed", { why: "no answer from the relay" }),
      );
    }, MADE_WAIT_MS);
    opening.set(ref, { resolve, reject, timer });
    if (!held().send({ v: 1, t: "dl-open", ref, name, size, mime })) {
      clearTimeout(timer);
      opening.delete(ref);
      reject(
        new ActionError("relay-failed", { why: "the relay link is down" }),
      );
    }
  });
  // Kept a little past the link's end, for a dl-pull that was on its way.
  const timer = setTimeout(
    () => links.delete(ref),
    Math.max(Date.parse(until) - Date.now(), 0) + 30_000,
  );
  timer.unref?.();
  links.set(ref, { rel, size, timer });
  log("folder", "download link made");
  return { url, until, name, size };
}

// The link was opened: the path is checked again and the file posted, if it is still the same size.
async function pull(ref, link) {
  const l = links.get(ref);
  if (!l || typeof link !== "string" || !LINK_ID.test(link))
    return log("drop", "dl-pull of no link");
  clearTimeout(l.timer);
  links.delete(ref);
  const real = folderPath(l.rel);
  const st = statOr(real, "not-found");
  if (!st.isFile() || st.size !== l.size)
    return log("folder", "dl-pull: the file changed, nothing sent");
  const res = await fetch(relayUrl(held().keys.relay, `/pc/dl/${link}`), {
    method: "POST",
    headers: relayHeaders(st.size),
    body: fileBody(real),
    duplex: "half",
  });
  await res.body?.cancel();
  log("folder", `download link used: HTTP ${res.status}`);
}

// Relay frames for this file: dl-made, dl-pull, dl-fail, and error files-rate (it names no ref, so it answers the
// oldest dl-open still waiting). Returns the dl-pull's promise, for tests.
export function folderFrame(f) {
  const wait = typeof f.ref === "string" ? opening.get(f.ref) : null;
  const settle = (fn, v) => {
    clearTimeout(wait.timer);
    opening.delete(f.ref);
    fn(v);
  };
  if (f.t === "dl-made" && wait) {
    if (
      typeof f.url !== "string" ||
      !/^https?:\/\//.test(f.url) ||
      Number.isNaN(Date.parse(f.until))
    )
      return settle(
        wait.reject,
        new ActionError("relay-failed", { why: "a bad dl-made" }),
      );
    return settle(wait.resolve, { url: f.url, until: f.until });
  }
  if (f.t === "dl-fail") {
    const e = String(f.e).slice(0, 20);
    if (wait)
      return settle(wait.reject, new ActionError("relay-failed", { why: e }));
    const l = links.get(f.ref);
    if (l) {
      clearTimeout(l.timer);
      links.delete(f.ref);
    }
    return log("folder", `dl-fail ${e}`);
  }
  if (f.t === "dl-pull")
    return pull(f.ref, f.link).catch((e) =>
      log("error", `dl-pull: ${e.message}`),
    );
  if (f.t === "error" && f.e === "files-rate") {
    const [ref, first] = opening.entries().next().value ?? [];
    if (!first) return log("files-rate", "no link waiting");
    clearTimeout(first.timer);
    opening.delete(ref);
    return first.reject(new ActionError("rate"));
  }
  log("drop", `relay frame ${String(f.t).slice(0, 12)} of no link`);
}

const PATH_INPUT = { type: "string", min: 1, max: PATH_MAX };
const DIR_INPUT = { type: "string", min: 0, max: PATH_MAX };
// One name: a slash in it would make or move into another folder.
const NAME_INPUT = {
  type: "string",
  min: 1,
  max: NAME_MAX,
  pattern: /^[^/\\]+$/,
};
const STREAM_INPUT = {
  type: "string",
  min: 1,
  max: 64,
  pattern: /^[A-Za-z0-9_-]{1,64}$/,
};

export function register(registry) {
  const clean = () => {
    try {
      cleanFolder();
    } catch (e) {
      log("error", `folder clean: ${e.message}`);
    }
  };
  clean();
  setInterval(clean, CLEAN_EVERY_MS).unref?.();

  registry.add({
    name: "folder.list",
    input: { dir: DIR_INPUT },
    run: (d) => list(d.dir),
  });
  registry.add({
    name: "folder.make",
    input: { dir: DIR_INPUT, name: NAME_INPUT },
    run: (d) => make(d.dir, d.name),
  });
  registry.add({
    name: "folder.rename",
    input: { path: PATH_INPUT, name: NAME_INPUT },
    run: (d) => rename(d.path, d.name),
  });
  registry.add({
    name: "folder.move",
    input: { path: PATH_INPUT, to: DIR_INPUT },
    run: (d) => move(d.path, d.to),
  });
  registry.add({
    name: "folder.remove",
    input: { path: PATH_INPUT },
    run: (d) => remove(d.path),
  });
  registry.add({
    name: "folder.put",
    input: { dir: DIR_INPUT, name: NAME_INPUT, stream: STREAM_INPUT },
    run: (d, ctx) => put(d.dir, d.name, d.stream, ctx),
  });
  registry.add({
    name: "folder.send",
    input: { path: PATH_INPUT },
    run: (d) => sendToChat(d.path),
  });
  registry.add({
    name: "folder.link",
    input: { path: PATH_INPUT },
    run: (d) => makeLink(d.path),
  });
  registry.add({
    name: "folder.copy",
    input: { path: PATH_INPUT },
    run: (d) => copyFile(d.path),
  });
  registry.add({
    name: "folder.show",
    input: { path: PATH_INPUT },
    run: (d) => showFile(d.path),
  });
}
