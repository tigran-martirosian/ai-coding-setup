// The file rules: every file the PC program opens goes through here. The phone never names a file;
// the PC opens only the fixed places below, and never .env, secrets, keys or .git.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { log } from "./log.mjs";
import { appDir } from "./mode.mjs";
import { ActionError } from "./registry.mjs";
// A cycle (transcripts.mjs reads files through this file); only function declarations cross it.
import { writtenPaths } from "./transcripts.mjs";

const WIN = process.platform === "win32";

export class FileRefused extends Error {
  constructor(rule) {
    super(`file-refused: ${rule}`);
    this.code = "file-refused";
    this.rule = rule;
  }
}

// ~/.phone-app, or the second PC program's own folder (core/mode.mjs).
export { appDir };
export const keyFilePath = () => path.join(appDir(), "pc-keys.json");

export function nimbalystDir() {
  if (WIN) {
    if (!process.env.APPDATA)
      throw new Error("APPDATA is not set: cannot find Nimbalyst's files");
    return path.join(process.env.APPDATA, "@nimbalyst", "electron");
  }
  if (process.platform === "darwin")
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "@nimbalyst",
      "electron",
    );
  return path.join(os.homedir(), ".config", "@nimbalyst", "electron");
}

// Nimbalyst's installed program files (a per-user install, Windows only): where its version is read.
export function nimbalystResources() {
  if (!WIN)
    throw new Error("Nimbalyst's install folder is known on Windows only");
  if (!process.env.LOCALAPPDATA)
    throw new Error("LOCALAPPDATA is not set: cannot find Nimbalyst's install");
  return path.join(
    process.env.LOCALAPPDATA,
    "Programs",
    "Nimbalyst",
    "resources",
  );
}
export const NIMBALYST_MARKER = "ai-coding-setup-patched.json";

// The setup's stored update check (hooks/update-check.mjs): the newest released version.
export const updateCheckPath = () =>
  path.join(os.homedir(), ".claude", "update-check.json");

// The two files of Nimbalyst's install that hold its version; none when the install folder has no name here.
function nimbalystVersionFiles() {
  let res;
  try {
    res = nimbalystResources();
  } catch {
    return [];
  }
  return [NIMBALYST_MARKER, "package.json"].map((f) => ({
    at: path.join(res, f),
    file: true,
    write: false,
  }));
}

// The places of the PC program design, section 4. `file` places allow that one file, `dir` places what is inside.
export function places() {
  const home = os.homedir();
  return [
    {
      at: path.join(nimbalystDir(), "sqlite-db", "nimbalyst.sqlite"),
      file: true,
      write: false,
    },
    {
      at: path.join(nimbalystDir(), "mcp-endpoint.json"),
      file: true,
      write: false,
    },
    { at: path.join(home, ".claude", "projects"), file: false, write: false },
    {
      at: path.join(home, ".claude", "usage-log", "plan-usage.jsonl"),
      file: true,
      write: false,
    },
    { at: appDir(), file: false, write: true },
    { at: path.join(home, "phone-inbox"), file: false, write: true },
    { at: path.join(os.tmpdir(), "phone-app-voice"), file: false, write: true },
    { at: updateCheckPath(), file: true, write: false },
    ...nimbalystVersionFiles(),
  ];
}

export const SECRET_PARTS = new Set([
  ".git",
  ".ssh",
  ".gnupg",
  ".telegram-control",
]);
const SECRET_NAMES = new Set([
  ".env",
  ".credentials.json",
  ".npmrc",
  ".netrc",
  "owner-secrets.json",
]);
const SECRET_PATTERNS = [
  /^\.env\./,
  /^id_/,
  /\.pem$/,
  /\.key$/,
  /\.pfx$/,
  /\.p12$/,
  /secret/,
  /credential/,
  /token/,
];

// True for a file name the rules refuse wherever it is (a key, a token, a .env file).
export function secretName(name) {
  const n = name.toLowerCase();
  return SECRET_NAMES.has(n) || SECRET_PATTERNS.some((r) => r.test(n));
}

// The real path, following links; for a file not made yet, the real path of its nearest existing folder.
function realPath(p) {
  const abs = path.resolve(p);
  let head = abs;
  const rest = [];
  while (!fs.existsSync(head)) {
    const up = path.dirname(head);
    if (up === head) return abs;
    rest.unshift(path.basename(head));
    head = up;
  }
  return path.join(fs.realpathSync.native(head), ...rest);
}

const same = (a, b) => (WIN ? a.toLowerCase() === b.toLowerCase() : a === b);

function inside(place, real) {
  const at = realPath(place.at);
  if (place.file) return same(at, real);
  const rel = path.relative(at, real);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

let keyToken = null;

// keys.mjs takes this once at load; nothing else can open the key file.
export function takeKeyFileToken() {
  if (keyToken) throw new Error("the key file token is already taken");
  keyToken = Symbol("key file");
  return keyToken;
}

// Returns the real path, or throws FileRefused naming the rule (logged, never the content).
export function checkPath(p, { write = false, token = null } = {}) {
  const real = realPath(p);
  const refuse = (rule) => {
    log("file-refused", rule);
    throw new FileRefused(rule);
  };
  const parts = real.split(/[\\/]+/).map((s) => s.toLowerCase());
  if (parts.some((s) => SECRET_PARTS.has(s))) refuse("secret folder");
  if (secretName(parts[parts.length - 1])) refuse("secret file name");
  const place = places().find((pl) => inside(pl, real));
  if (!place) refuse("outside the places");
  if (write && !place.write) refuse("read-only place");
  if (same(real, realPath(keyFilePath())) && (!token || token !== keyToken))
    refuse("key file outside keys.mjs");
  return real;
}

// ---- a session's own files (files design, "File rule"): read only, inside the session's folders

// Real secret files only (user, 2026-11-15): the narrow list for project files and diffs. SECRET_NAMES above stays.
const REAL_SECRET_NAMES = new Set([
  ".env",
  ".npmrc",
  ".pypirc",
  ".netrc",
  ".git-credentials",
  ".mcp.json",
  ".dev.vars",
  ".envrc",
  ".credentials.json",
  "owner-secrets.json",
  "pc-keys.json",
]);
const REAL_SECRET_PATTERNS = [
  /^\.env\./,
  /^id_(?!.*\.pub$)/,
  /\.pem$/,
  /\.key$/,
  /\.p12$/,
  /\.pfx$/,
];
export const SESSION_SECRET_PARTS = new Set([...SECRET_PARTS, ".phone-app"]);
export const DEVICE = /^(con|nul|prn|aux|com[1-9]|lpt[1-9])(\..*)?$/i;
const MAX_HANDLES = 2000;
const hasControl = (s) =>
  [...s].some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127);

export function realSecretName(name) {
  const n = name.toLowerCase();
  return (
    REAL_SECRET_NAMES.has(n) || REAL_SECRET_PATTERNS.some((r) => r.test(n))
  );
}

const partsOf = (p) =>
  String(p)
    .split(/[\\/]+/)
    .filter(Boolean);
const fixDrive = (p) => (/^[\\/][A-Za-z]:[\\/]/.test(p) ? p.slice(1) : p);
const isUncOrDevice = (p) => /^[\\/]{2}/.test(p);

// The text checks before any disk call: true when the path is not a plain local file path.
export function badPathForm(p) {
  const s = fixDrive(String(p));
  if (hasControl(s) || isUncOrDevice(s)) return true;
  if (/^[A-Za-z]:(?![\\/])/.test(s)) return true; // drive-relative
  if (s.slice(/^[A-Za-z]:/.test(s) ? 2 : 0).includes(":")) return true; // a data stream
  return partsOf(s).some((part) => DEVICE.test(part));
}

// The secret rule a path names by its text (folder parts, file name, the app folder), or null. Wildcards in the
// last part are dropped first when `pattern` (a Glob pattern or Grep glob), so "**/.env*" names ".env".
export function secretRuleOf(p, { pattern = false } = {}) {
  let parts = partsOf(p).map((s) => s.toLowerCase());
  if (pattern)
    parts = parts.map((s) =>
      s.replace(/\[[^\]]*\]|\{[^}]*\}|[*?]/g, "").trim(),
    );
  if (parts.some((s) => SESSION_SECRET_PARTS.has(s))) return "secret folder";
  const name = parts[parts.length - 1];
  if (name && realSecretName(name)) return "secret file name";
  if (!pattern && path.isAbsolute(p) && insideDir(appDir(), path.resolve(p)))
    return "app folder";
  return null;
}

function insideDir(dir, p) {
  const rel = path.relative(dir, p);
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

// The session's folders from its database row: its worktree (when it has one) and its project folder. `base` is
// where a relative link starts. `written()` gives the paths this session's transcript shows it wrote or edited.
export function sessionPlace(row) {
  const folders = [row.worktree_path, row.workspace_id].filter(Boolean);
  if (!folders.length) throw new Error(`session ${row.id} has no folder`);
  const base = folders[0];
  return {
    session: row.id,
    folders,
    base,
    written: () => writtenPaths(row, base),
  };
}

const tooWide = (f) => {
  const abs = path.resolve(f);
  return (
    same(abs, os.homedir()) ||
    same(abs, path.parse(abs).root) ||
    insideDir(abs, appDir())
  );
};

// Before following links: a link on the way from the folder down whose target is a network or device path.
function linkOnTheWay(folder, p) {
  let at = path.resolve(folder);
  for (const part of partsOf(path.relative(at, p))) {
    at = path.join(at, part);
    let st;
    try {
      st = fs.lstatSync(at);
    } catch (e) {
      if (e.code === "ENOENT") return false;
      throw e;
    }
    if (!st.isSymbolicLink()) continue;
    // A target that does not read back as a plain local path (Node cannot read every junction) counts as one.
    let target;
    try {
      target = fs.readlinkSync(at);
    } catch {
      return true;
    }
    if (isUncOrDevice(fixDrive(target)) || /^(UNC[\\/]|\\\?\?\\)/i.test(target))
      return true;
  }
  return false;
}

// The file rule for a file of a session: returns the real path, or throws FileRefused naming the rule (logged,
// never the content). `p` is absolute; `folders` come from the database row, never from the phone. A file outside
// the folders passes only when `written()` (the session's own written paths, sessionPlace) holds a path of the same
// real path; every other rule runs first (files contract, section 8).
export function checkSessionFile(p, folders, written = null) {
  const refuse = (rule) => {
    log("file-refused", rule);
    throw new FileRefused(rule);
  };
  if (badPathForm(p)) refuse("path form");
  if (!path.isAbsolute(fixDrive(p)))
    throw new Error(`checkSessionFile needs an absolute path, got "${p}"`);
  const abs = path.resolve(fixDrive(p));
  if (folders.some(tooWide)) refuse("folder too wide");
  const textRule = secretRuleOf(abs);
  if (textRule) refuse(textRule);
  const home = folders.find((f) => insideDir(path.resolve(f), abs));
  if (!home && !written) refuse("outside the session's folders");
  // Outside the folders, links are checked from the drive's root down.
  if (linkOnTheWay(home ?? path.parse(abs).root, abs)) refuse("path form");
  const real = realPath(abs);
  const inside = folders.some((f) => insideDir(realPath(f), real));
  if (!inside && !written) refuse("outside the session's folders");
  if (insideDir(realPath(appDir()), real)) refuse("app folder");
  const realRule = secretRuleOf(real);
  if (realRule) refuse(realRule);
  if (fs.existsSync(real) && !fs.statSync(real).isFile()) refuse("not a file");
  if (!inside && ![...written()].some((w) => same(realPath(w), real)))
    refuse("outside the session's folders");
  return real;
}

// Handles: session -> handle -> the path as named (the rule runs again on it at every open). Same path, same handle.
const handles = new Map();

export function fileHandle(session, p) {
  let s = handles.get(session);
  if (!s) {
    s = { byHandle: new Map(), byPath: new Map() };
    handles.set(session, s);
  }
  const key = WIN ? p.toLowerCase() : p;
  const had = s.byPath.get(key);
  if (had) return had;
  const h = crypto.randomBytes(12).toString("base64url");
  s.byHandle.set(h, p);
  s.byPath.set(key, h);
  if (s.byHandle.size > MAX_HANDLES) {
    const [oldest, oldPath] = s.byHandle.entries().next().value;
    s.byHandle.delete(oldest);
    s.byPath.delete(WIN ? oldPath.toLowerCase() : oldPath);
  }
  return h;
}

// The path of a handle in this session, or null (unknown here, dropped, or another session's).
export const handlePath = (session, handle) =>
  handles.get(session)?.byHandle.get(handle) ?? null;

// A file a session names: { path, file: handle, why: null } when the rule passes, else file null and why the rule.
export function sessionFile(place, p) {
  const abs = badPathForm(p) ? p : path.resolve(place.base, fixDrive(p));
  try {
    checkSessionFile(abs, place.folders, place.written);
    return { path: abs, file: fileHandle(place.session, abs), why: null };
  } catch (e) {
    if (e.code !== "file-refused") throw e;
    return { path: abs, file: null, why: e.rule };
  }
}

// A Markdown link target as a path: `#part` and `?query` cut, a trailing `:42` as the line, `%XX` decoded once,
// `/C:/` read as `C:/`, `~/` as the home folder, a relative one from `dir`. { path, line } or { why }.
export function linkTarget(target, dir) {
  let t = target.replace(/[#?].*$/, "");
  let line = null;
  const m = t.match(/^(.*[^:]):(\d+)$/);
  if (m && !/^[A-Za-z]$/.test(m[1])) {
    t = m[1];
    line = Number(m[2]);
  }
  try {
    t = decodeURIComponent(t);
  } catch {
    return { why: "path form", line };
  }
  if (!t) return null;
  t = fixDrive(t);
  if (badPathForm(t)) return { path: t, why: "path form", line };
  if (/^~[\\/]/.test(t)) t = path.join(os.homedir(), t.slice(2));
  return { path: path.resolve(dir, t), why: null, line };
}

// Every Markdown link of a text whose target has no URL scheme: { target, file, line, why }.
export function linksOf(text, place, dir) {
  const out = [];
  for (const m of String(text).matchAll(/\]\(\s*<?([^)\s>]+)>?[^)]*\)/g)) {
    const target = m[1];
    if (/^[a-z][a-z0-9+.-]+:/i.test(target)) continue; // a URL scheme (one letter is a drive)
    const t = linkTarget(target, dir);
    if (!t) continue;
    if (t.why) {
      out.push({ target, file: null, line: t.line, why: t.why });
      continue;
    }
    const f = sessionFile(place, t.path);
    out.push({ target, file: f.file, line: t.line, why: f.why });
  }
  return out;
}

export const readText = (p, opts) =>
  fs.readFileSync(checkPath(p, opts), "utf8");

// Written whole to a temp name, then renamed.
export function writeText(p, text, opts = {}) {
  const real = checkPath(p, { ...opts, write: true });
  fs.mkdirSync(path.dirname(real), { recursive: true });
  const tmp = `${real}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, text, { mode: 0o600 });
  fs.renameSync(tmp, real);
}

// ---- the phone's attachments (screens 2 design, "Attach"): the one place the PC writes a file the phone sent,
// Nimbalyst's staging folder in its default "temp" mode, %TEMP%\nimbalyst-attachments\<key>\saved\phone.

export const attachRoot = () => path.join(os.tmpdir(), "nimbalyst-attachments");
const ATTACH_BELOW = ["saved", "phone"];

// Nimbalyst's key of a project folder: every \, / and : made -.
export const attachKey = (projectPath) => projectPath.replace(/[\\/:]/g, "-");

const refuseAttach = (why) => {
  log("file-refused", `attach place: ${why}`);
  throw new ActionError("attach-place");
};

// The lstat of `p`, or null when it does not exist.
function lstatOrNull(p) {
  try {
    return fs.lstatSync(p);
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

// The project's attach place, each missing part made one at a time (never through a link). No part below %TEMP%
// may be a link and the folder's real path must be inside the root's real path; else ActionError attach-place.
// Parts above %TEMP% (a moved profile folder) are the user's own and may be links. The project path comes from
// the PC's own project list, never from the phone.
export function attachPlace(projectPath) {
  const key = attachKey(projectPath);
  if (!key || key === "." || key === ".." || hasControl(key))
    refuseAttach("no usable key for the project folder");
  let at = os.tmpdir();
  for (const part of ["nimbalyst-attachments", key, ...ATTACH_BELOW]) {
    at = path.join(at, part);
    let st = lstatOrNull(at);
    if (!st) {
      try {
        fs.mkdirSync(at);
      } catch (e) {
        if (e.code !== "EEXIST") throw e;
      }
      st = fs.lstatSync(at);
    }
    if (st.isSymbolicLink()) refuseAttach(`a link below %TEMP%: ${part}`);
    if (!st.isDirectory()) refuseAttach(`not a folder: ${part}`);
  }
  const root = fs.realpathSync.native(attachRoot());
  const real = fs.realpathSync.native(at);
  const rel = path.relative(root, real);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel))
    refuseAttach("the real path is outside the root");
  return real;
}

// Every project's attach place that is there, for the disk sum and the clean-up; links are left out.
export function attachFolders() {
  const root = attachRoot();
  const st = lstatOrNull(root);
  if (!st) return [];
  if (st.isSymbolicLink() || !st.isDirectory())
    refuseAttach("the root is a link or not a folder");
  const out = [];
  for (const k of fs.readdirSync(root, { withFileTypes: true })) {
    if (!k.isDirectory()) continue;
    let at = path.join(root, k.name);
    let ok = true;
    for (const part of ATTACH_BELOW) {
      at = path.join(at, part);
      const s = lstatOrNull(at);
      if (!s || s.isSymbolicLink() || !s.isDirectory()) {
        ok = false;
        break;
      }
    }
    if (ok) out.push(at);
  }
  return out;
}

// Writes a new file `name` in an attach place: flag "wx", so an existing file is never replaced (not writeText,
// whose rename would replace it). A write that fails part-way deletes the half-written file. Returns the path.
export function writeAttachment(place, name, bytes) {
  if (!name || path.basename(name) !== name || /[\\/:]/.test(name))
    throw new Error(`not a plain file name: ${name}`);
  const file = path.join(place, name);
  const fd = fs.openSync(file, "wx", 0o600);
  let open = true;
  try {
    let off = 0;
    while (off < bytes.length)
      off += fs.writeSync(fd, bytes, off, bytes.length - off);
    open = false;
    fs.closeSync(fd);
  } catch (e) {
    if (open) fs.closeSync(fd);
    fs.rmSync(file, { force: true });
    throw e;
  }
  return file;
}
