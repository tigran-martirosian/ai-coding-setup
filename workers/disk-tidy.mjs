#!/usr/bin/env node
// disk-tidy: finds what fills the disk that this setup, Claude Code and the person's own work leave behind,
// reports it first and acts only on what the report listed. Windows, macOS and Linux; no dependencies.
//
//   disk-tidy.mjs [--report]          scan, print the report, write the ledger (~/.claude/setup-logs/disk-tidy-<date>.json)
//   disk-tidy.mjs --json              the report as JSON on stdout
//   disk-tidy.mjs --auto              the setup's own leftovers (class S) go, chat folders of deleted projects are
//                                     archived, and the chat archive runs when it is on; prints a `disk: freed` line and
//                                     `offer:` lines for the person's own things. Nothing to do prints nothing.
//   disk-tidy.mjs --auto --archive-only [--note-file <f>]   only the chat archive (the pc-tidy-nudge hook, every 3 days)
//   disk-tidy.mjs --apply <ledger> --only <ids|categories>  acts on those ledger items, re-checking each first
//   disk-tidy.mjs --archive-on [--days 60] | --archive-off | --keep-forever <cwd glob>
//   disk-tidy.mjs --archive-list [--project <text>] | --restore <id-prefix> | --restore --project <text> | --restore --all
//   options: --roots <dir,dir>  --scratch-days 14  --scanner auto|gdu|dust|wiztree|node  --timeout-per-folder 60
//   test seams: --home --tmp --appdata --now <ISO> --ps-file <file> --git-wrapper <file.mjs> --platform win32|darwin|linux
//
// Classes: S = the setup's own leftover (--auto), P = the person's (only with their yes, per item), C = a click in
// another app (reported), K = kept (reported). It never passes --force to git, never removes a worktree that is dirty
// or has commits not on main, never removes ~/.claude/scratch itself, never writes a Nimbalyst file.
// Chats: live for archive.afterDays (60), then gzipped into ~/.claude-archive/chats, deleted from there past
// cleanupPeriodDays (Claude Code's own sweep age, settings.json), except projects on the keepForever list.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const DAY = 24 * 60 * 60 * 1000;
const MB = 1024 * 1024;
// mkdtemp prefixes of this repo's tests and workers (grep of mkdtempSync, 2026-11-10); only these are setup temp
export const TEMP_PREFIXES = ["agent-run-log-test-", "app-settings-test-", "background-tasks-", "big-read-allow-test-", "big-read-gate-test-",
  "blocks-test-", "carve-test-", "cold-cache-", "compact-self-", "context-guard-test-", "crash-log-", "disk-tidy-test-", "file-link-gate-test-",
  "finder-test-", "handoff-test-", "home-carve-test-", "hook-lib-", "install-test-", "job-done-test-", "language-test-", "link-gate-test-",
  "links-labels-", "map-brief-test-", "map-drift-test-", "map-file-", "map-generated-test-", "map-nudge-test-", "next-step-gate-test-",
  "nimbalyst-notes-", "opencli-fake-", "opencli-none-", "outcomes-test-", "own-rules-test-", "patch-next-", "pc-tidy-", "pc-tidy-nudge-",
  "phone-setup-", "picture-gate-test-", "picture-in-project-", "plan-ahead-test-", "plan-usage-test-", "privacy-test-", "pushscan-",
  "question-other-", "read-digests-test-", "repeat-guard-", "review-scan-", "run-all-home-", "run-yourself-test-", "shared-usage-logon-",
  "sqlguard-", "steer-test-", "test-code-review-gate-", "test-no-response-gate-", "test-verify-gate-", "transcript-check-", "transcript-lib-",
  "uninstall-test-", "update-check-test-", "update-test-", "usage-dash-test-", "usage-hook-", "usage-scan-test-", "watch-test-", "web-gate",
  "worker-size-test-"];
// files the setup's own scripts rebuild: deleted when big and unused
const CACHES = [{ rel: "reports/usage-scan-cache.jsonl", minBytes: 100 * MB, idleDays: 7, name: "usage-scan cache" }];
const KEEP_DIRS = ["browser-profiles", "security", "plugins", "context-mode", "hooks", "skills"];

// ---- paths: one comparison form for every path (6.2 of the design)
export function normPath(p, { platform = process.platform, home = os.homedir() } = {}) {
  let s = String(p).replace(/\\/g, "/");
  const h = String(home).replace(/\\/g, "/").replace(/\/+$/, "");
  s = s.replace(/^~(?=\/|$)/, h).replace(/^\$HOME(?=\/|$)/, h);
  if (platform === "darwin") s = s.replace(/^\/private\/(var|tmp)(?=\/|$)/, "/$1");
  s = s.replace(/(?<!^)\/{2,}/g, "/");
  if (s.length > 1) s = s.replace(/\/+$/, "");
  return platform === "win32" ? s.toLowerCase() : s;
}
export const under = (child, parent, o) => { const c = normPath(child, o), p = normPath(parent, o); return c === p || c.startsWith(`${p}/`); };
// a keepForever entry: a cwd glob (* one level, ** any depth); a match also covers the folders inside it
export function globMatch(glob, p, o) {
  const g = normPath(glob, o).replace(/[.+^${}()|[\]]/g, "\\$&").replace(/\*\*/g, "\u0000").replace(/\*/g, "[^/]*").replace(/\?/g, "[^/]").replace(/\u0000/g, ".*");
  return new RegExp(`^${g}(/.*)?$`).test(normPath(p, o));
}
export function fmtBytes(n) {
  if (n >= 1024 ** 3) return `${(n / 1024 ** 3).toFixed(n >= 10 * 1024 ** 3 ? 1 : 2)} GB`;
  if (n >= MB) return `${Math.round(n / MB)} MB`;
  if (n >= 1024) return `${Math.round(n / 1024)} KB`;
  return `${n} B`;
}
const fwd = (p) => String(p).replace(/\\/g, "/");
const day = (ms) => new Date(ms).toISOString().slice(0, 10);

// ---- options
const args = process.argv.slice(2);
const has = (n) => args.includes(n);
function opt(name, fallback) {
  const i = args.indexOf(name);
  if (i === -1) return fallback;
  const v = args[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`${name} needs a value`);
  return v;
}

function setup() {
  const HOME = path.resolve(opt("--home", os.homedir()));
  const PLATFORM = opt("--platform", process.platform);
  const appData = opt("--appdata", PLATFORM === "darwin" ? path.join(HOME, "Library", "Application Support") : process.env.APPDATA || "");
  const C = {
    HOME, PLATFORM,
    TMP: path.resolve(opt("--tmp", os.tmpdir())),
    NOW: opt("--now") ? Date.parse(opt("--now")) : Date.now(),
    CLAUDE: path.join(HOME, ".claude"),
    ARCHIVE: path.join(HOME, ".claude-archive", "chats"),
    // the same folder as the repo's scripts/nimbalyst-paths.mjs (not importable from ~/.claude/workers)
    NIMBALYST: appData ? path.join(appData, "@nimbalyst", "electron") : "",
    SCRATCH_DAYS: Number(opt("--scratch-days", "14")),
    CAP_MS: Number(opt("--timeout-per-folder", "60")) * 1000,
    SCANNER: opt("--scanner", "auto"),
    PS_FILE: opt("--ps-file", null),
    GIT_WRAPPER: opt("--git-wrapper", null),
  };
  if (Number.isNaN(C.NOW)) throw new Error(`--now is not a date: ${opt("--now")}`);
  C.PROJECTS = path.join(C.CLAUDE, "projects");
  C.CONFIG = path.join(C.CLAUDE, "disk-tidy.json");
  C.LOGS = path.join(C.CLAUDE, "setup-logs");
  C.REPLAY = path.join(C.TMP, "setup-replay-wt");
  const roots = opt("--roots", null);
  C.ROOTS = roots ? roots.split(",").map((r) => path.resolve(r))
    : [path.join(HOME, "Projects"), ...(PLATFORM === "win32" ? ["C:/Projects"] : [])].filter((r) => fs.existsSync(r));
  C.np = (p) => normPath(p, { platform: PLATFORM, home: HOME });
  C.under = (a, b) => under(a, b, { platform: PLATFORM, home: HOME });
  return C;
}

// ---- git: every call passes here, and none carries --force
function git(C, cwd, gitArgs, { input } = {}) {
  if (gitArgs.some((a) => a === "--force" || a === "-f" || a === "-ff")) throw new Error(`refusing git ${gitArgs.join(" ")}: disk-tidy never forces`);
  const full = ["-C", cwd, ...gitArgs];
  const r = C.GIT_WRAPPER
    ? spawnSync(process.execPath, [C.GIT_WRAPPER, ...full], { encoding: "utf8", windowsHide: true, input })
    : spawnSync("git", full, { encoding: "utf8", windowsHide: true, input });
  if (r.error) throw new Error(`git could not start: ${r.error.message}`);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr.trim() };
}
const gitOut = (C, cwd, a) => { const r = git(C, cwd, a); if (!r.ok) throw new Error(`git -C ${fwd(cwd)} ${a.join(" ")}: ${r.err}`); return r.out; };

// ---- the process list: a running replay.py owns its worktrees
function processLines(C) {
  if (C.PS_FILE) return fs.readFileSync(C.PS_FILE, "utf8").split(/\r?\n/);
  const r = process.platform === "win32"
    ? spawnSync("powershell", ["-NoProfile", "-Command", "Get-CimInstance Win32_Process | ForEach-Object { $_.CommandLine }"], { encoding: "utf8", windowsHide: true, timeout: 30000 })
    : spawnSync("ps", ["-axo", "command"], { encoding: "utf8", timeout: 30000 });
  if (r.status !== 0) return null;
  return r.stdout.split(/\r?\n/);
}
// a Python process running replay.py; a shell or grep whose text only names the script is not one
export function isReplayLine(line) {
  const m = /^\s*(?:"([^"]+)"|(\S+))(.*)$/.exec(String(line));
  if (!m) return false;
  const exe = (m[1] || m[2]).replace(/\\/g, "/").split("/").pop().toLowerCase();
  return /^(python[\d.]*w?|pyw?)(\.exe)?$/.test(exe) && /replay\.py/.test(m[3]);
}
function replayRunning(C) {
  const lines = processLines(C);
  if (!lines) return "the process list could not be read, so a running replay can't be ruled out";
  return lines.some(isReplayLine) ? "replay.py is running" : null;
}

// ---- sizes and ages. walk() never follows a symlink or junction; it stops at the time cap and says so.
async function walk(dir, deadline) {
  let bytes = 0, newest = 0, capped = false, files = 0;
  const queue = [dir];
  let st;
  try { st = fs.lstatSync(dir); } catch { return { bytes: 0, newest: 0, capped: false, files: 0, missing: true }; }
  if (!st.isDirectory()) return { bytes: st.size, newest: st.mtimeMs, capped: false, files: 1 };
  async function one(d) {
    let h;
    try { h = await fs.promises.opendir(d); } catch { return; } // a folder that went away or can't be read is not counted
    for await (const e of h) {
      if (Date.now() >= deadline) { capped = true; continue; }
      const p = path.join(d, e.name);
      let s;
      try { s = await fs.promises.lstat(p); } catch { continue; }
      if (s.isSymbolicLink()) continue;
      if (s.isDirectory()) queue.push(p);
      else { bytes += s.size; files++; if (s.mtimeMs > newest) newest = s.mtimeMs; }
    }
  }
  while (queue.length && !capped) await Promise.all(queue.splice(0, 16).map(one));
  if (Date.now() >= deadline && queue.length) capped = true;
  // a folder's age is its newest file's; a folder's own time moves whenever something inside is added or removed
  return { bytes, newest: files ? newest : st.mtimeMs, capped, files };
}
const age = async (C, p) => (await walk(p, Date.now() + C.CAP_MS));

function onPath(name) {
  for (const d of String(process.env.PATH || "").split(path.delimiter)) {
    for (const ext of process.platform === "win32" ? [".exe", ""] : [""]) {
      const f = path.join(d, name + ext);
      if (d && fs.existsSync(f)) return f;
    }
  }
  return null;
}
export function pickScanner(want = "auto") {
  if (want === "node") return { name: "node" };
  // DISK_TIDY_PROGRAM_DIRS: where to look instead of Program Files (tests: a child process on Windows keeps the real ProgramFiles)
  const programs = process.env.DISK_TIDY_PROGRAM_DIRS ? process.env.DISK_TIDY_PROGRAM_DIRS.split(path.delimiter) : [process.env.ProgramFiles, process.env["ProgramFiles(x86)"]];
  const wiz = () => onPath("WizTree64") || programs.filter(Boolean).map((d) => path.join(d, "WizTree", "WizTree64.exe")).find((f) => fs.existsSync(f));
  const found = {
    gdu: () => onPath("gdu") || onPath("gdu-go"),
    dust: () => onPath("dust"),
    wiztree: () => (process.platform === "win32" ? wiz() : null),
  };
  for (const name of want === "auto" ? ["gdu", "dust", "wiztree"] : [want]) {
    if (!found[name]) throw new Error(`--scanner ${want}: not one of auto, gdu, dust, wiztree, node`);
    const bin = found[name]();
    if (bin) return { name, bin };
    if (want !== "auto") throw new Error(`--scanner ${want}: not found on this computer`);
  }
  return { name: "node" };
}
const HUMAN = { B: 1, K: 1024, M: MB, G: 1024 ** 3, T: 1024 ** 4 };
// one folder's size with an outside scanner; null when it fails, so the Node walk answers instead
function outsideSize(scanner, dir, capMs) {
  const out = path.join(os.tmpdir(), `disk-tidy-scan-${process.pid}-${Math.random().toString(36).slice(2)}`);
  try {
    if (scanner.name === "gdu") { // ncdu-format JSON export: [1, 2, {meta}, [{dir}, ...children]]
      const r = spawnSync(scanner.bin, ["-n", "-p", "-o", out, dir], { timeout: capMs, windowsHide: true });
      if (r.status !== 0) return null;
      const sum = (node) => (Array.isArray(node) ? node.reduce((t, c, i) => t + (i === 0 ? 0 : sum(c)), 0) : Number(node.asize || 0));
      return sum(JSON.parse(fs.readFileSync(out, "utf8"))[3]);
    }
    if (scanner.name === "dust") { // dust -j prints {size: "1.2G", name, children}
      const r = spawnSync(scanner.bin, ["-j", "-d", "0", dir], { encoding: "utf8", timeout: capMs, windowsHide: true });
      if (r.status !== 0) return null;
      const m = /^([\d.]+)\s*([BKMGT])?/i.exec(String(JSON.parse(r.stdout).size));
      return m ? Math.round(Number(m[1]) * HUMAN[(m[2] || "B").toUpperCase()]) : null;
    }
    // WizTree 4.23, checked 2026-11-10: the CSV's first data row is the folder itself, column 2 its size;
    // given forward slashes (as git prints worktree paths) it reports 0 for the folder, so it gets the native form
    const r = spawnSync(scanner.bin, [path.resolve(dir), `/export=${out}`, "/admin=0", "/exportfolders=1", "/exportfiles=0"], { timeout: capMs, windowsHide: true });
    if (r.status !== 0 || !fs.existsSync(out)) return null;
    const row = fs.readFileSync(out, "utf8").split(/\r?\n/)[2] || "";
    const m = /^"[^"]*",(\d+),/.exec(row);
    return m ? Number(m[1]) : null;
  } catch { return null; } finally { fs.rmSync(out, { force: true }); }
}
// sizes for many folders, 8 at a time
async function sizeAll(C, scanner, dirs) {
  const result = new Map();
  const list = [...new Set(dirs)];
  while (list.length) {
    await Promise.all(list.splice(0, 8).map(async (d) => {
      const outside = scanner.name !== "node" ? outsideSize(scanner, d, C.CAP_MS) : null;
      result.set(d, outside !== null ? { bytes: outside, capped: false } : await walk(d, Date.now() + C.CAP_MS));
    }));
  }
  return result;
}

// ---- chats: a folder's project is the `cwd` inside its newest .jsonl, never the folder name (names lose _ . and spaces)
function readHead(file, n = 256 * 1024) {
  const fd = fs.openSync(file, "r");
  try { const b = Buffer.alloc(n); return b.subarray(0, fs.readSync(fd, b, 0, n, 0)).toString("utf8"); } finally { fs.closeSync(fd); }
}
export function cwdOf(text) {
  const m = /"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/.exec(text);
  return m ? JSON.parse(m[1]) : null;
}
function titleOf(text) {
  for (const line of text.split("\n")) {
    if (!line.includes('"user"')) continue;
    try {
      const j = JSON.parse(line);
      const c = j.message?.content;
      const t = typeof c === "string" ? c : Array.isArray(c) ? c.find((x) => x.type === "text")?.text : null;
      if (j.type === "user" && t) return t.replace(/\s+/g, " ").trim().slice(0, 80);
    } catch { /* a line cut at the read limit */ }
  }
  return "";
}
// every word in ~/.claude/sessions/*: a session id a running Claude Code names is one of them
function liveSessionIds(C) {
  const dir = path.join(C.CLAUDE, "sessions");
  if (!fs.existsSync(dir)) return new Set();
  const text = fs.readdirSync(dir).map((n) => { try { return fs.readFileSync(path.join(dir, n), "utf8"); } catch { return ""; } }).join("\n");
  return new Set(text.match(/[A-Za-z0-9_-]+/g) || []);
}
// every chat folder: its cwd, sessions (id, files, newest), memory/ present
async function chatFolders(C) {
  if (!fs.existsSync(C.PROJECTS)) return [];
  const live = liveSessionIds(C);
  const out = [];
  for (const folder of fs.readdirSync(C.PROJECTS)) {
    const dir = path.join(C.PROJECTS, folder);
    if (!fs.statSync(dir).isDirectory()) continue;
    const names = fs.readdirSync(dir);
    const sessions = [];
    for (const n of names.filter((x) => x.endsWith(".jsonl"))) {
      const id = n.slice(0, -6);
      const file = path.join(dir, n);
      const side = fs.existsSync(path.join(dir, id)) ? path.join(dir, id) : null;
      const main = fs.statSync(file);
      const sideW = side ? await walk(side, Infinity) : { bytes: 0, newest: 0 };
      sessions.push({ id, file, side, bytes: main.size + sideW.bytes, newest: Math.max(main.mtimeMs, sideW.newest), live: live.has(id) });
    }
    const all = await walk(dir, Infinity);
    const newestJsonl = sessions.slice().sort((a, b) => b.newest - a.newest)[0];
    out.push({ folder, dir, cwd: newestJsonl ? cwdOf(readHead(newestJsonl.file)) : null, sessions, bytes: all.bytes, newest: all.newest,
      memory: names.includes("memory"), live: sessions.some((s) => s.live) });
  }
  return out;
}

// ---- settings and the tool's own config
const readJson = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
function cleanupDays(C) {
  const f = path.join(C.CLAUDE, "settings.json");
  const v = fs.existsSync(f) ? readJson(f).cleanupPeriodDays : undefined;
  return { days: typeof v === "number" ? v : 30, set: typeof v === "number" }; // 30: Claude Code's own default when the key is unset
}
const readConfig = (C) => (fs.existsSync(C.CONFIG) ? readJson(C.CONFIG) : {});
function writeConfig(C, cfg) { fs.mkdirSync(path.dirname(C.CONFIG), { recursive: true }); fs.writeFileSync(C.CONFIG, `${JSON.stringify(cfg, null, 2)}\n`); }
const archiveOn = (cfg) => Boolean(cfg.archive && !cfg.archive.off && cfg.archive.afterDays);
// archive.afterDays must sit 7 days below Claude Code's sweep, else the sweep deletes before the archive runs
function archiveFits(C, afterDays) {
  const { days, set } = cleanupDays(C);
  if (afterDays <= days - 7) return null;
  return `Claude Code deletes chats after ${days} days (cleanupPeriodDays${set ? "" : " unset, its default"} in ~/.claude/settings.json), so an archive at ${afterDays} days comes too late. Use --days ${days - 7}, or raise cleanupPeriodDays.`;
}

// ---- the archive: ~/.claude-archive/chats/<folder>/<session>.jsonl.gz (+ the session's folder, each file .gz), index.jsonl
const indexFile = (C) => path.join(C.ARCHIVE, "index.jsonl");
const readRows = (C) => (fs.existsSync(indexFile(C)) ? fs.readFileSync(indexFile(C), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
function writeIndex(C, rows) {
  fs.mkdirSync(C.ARCHIVE, { recursive: true });
  fs.writeFileSync(`${indexFile(C)}.tmp`, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
  fs.renameSync(`${indexFile(C)}.tmp`, indexFile(C));
}
function appendIndex(C, row) {
  fs.mkdirSync(C.ARCHIVE, { recursive: true });
  const fd = fs.openSync(indexFile(C), "a");
  try { fs.writeSync(fd, `${JSON.stringify(row)}\n`); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
// the index, plus a row rebuilt from the archive for any chat that has none (a run stopped between its copy and
// its line, by an older version that wrote the index at the end). Only when the live original is gone: while it
// is there the copy is a leftover of an unfinished run, and the next run archives the chat again.
function readIndex(C) {
  const rows = readRows(C);
  if (!fs.existsSync(C.ARCHIVE)) return rows;
  const have = new Set(rows.map((r) => `${r.folder}/${r.id}`));
  for (const e of fs.readdirSync(C.ARCHIVE, { withFileTypes: true })) {
    if (!e.isDirectory()) continue;
    for (const n of fs.readdirSync(path.join(C.ARCHIVE, e.name))) {
      const m = /^(.+)\.jsonl\.gz$/.exec(n);
      if (!m || have.has(`${e.name}/${m[1]}`) || fs.existsSync(path.join(C.PROJECTS, e.name, `${m[1]}.jsonl`))) continue;
      const row = rowFromArchive(C, e.name, m[1]);
      appendIndex(C, row);
      rows.push(row);
    }
  }
  return rows;
}
function rowFromArchive(C, folder, id) {
  const dir = path.join(C.ARCHIVE, folder);
  const side = path.join(dir, id);
  const gzs = [path.join(dir, `${id}.jsonl.gz`), ...(fs.existsSync(side) ? filesUnder(side).filter((f) => f.endsWith(".gz")) : [])];
  const files = [];
  let bytes = 0, gzBytes = 0, text = null;
  for (const g of gzs) {
    const gz = fs.readFileSync(g);
    const buf = zlib.gunzipSync(gz);
    text ??= buf.toString("utf8");
    files.push({ rel: fwd(path.relative(dir, g)).replace(/\.gz$/, ""), sha256: sha(buf) });
    bytes += buf.length; gzBytes += gz.length;
  }
  const stamps = [...text.matchAll(/"timestamp"\s*:\s*"([^"]+)"/g)].map((x) => x[1]);
  const at = new Date(fs.statSync(gzs[0]).mtimeMs).toISOString();
  return { id, folder, cwd: cwdOf(text), title: titleOf(text), firstAt: stamps[0] || at, lastAt: stamps.at(-1) || at, bytes, gzBytes, sha256: files[0].sha256, archivedAt: at, files, rebuilt: true };
}
const sha = (buf) => crypto.createHash("sha256").update(buf).digest("hex");
function filesUnder(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...filesUnder(p)); else if (e.isFile()) out.push(p);
  }
  return out;
}
// one session into the archive; the originals go only after every copy reads back to the same sha256
function archiveSession(C, folder, s, cwd) {
  const base = path.join(C.PROJECTS, folder);
  const files = [s.file, ...(s.side ? filesUnder(s.side) : [])];
  const done = [];
  let bytes = 0, gzBytes = 0;
  for (const f of files) {
    const rel = fwd(path.relative(base, f));
    const buf = fs.readFileSync(f);
    const gz = zlib.gzipSync(buf, { level: 9 });
    const to = path.join(C.ARCHIVE, folder, `${rel}.gz`);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, gz);
    if (sha(zlib.gunzipSync(fs.readFileSync(to))) !== sha(buf)) throw new Error(`the archive copy of ${fwd(f)} does not read back the same; the original stays`);
    done.push({ rel, sha256: sha(buf) });
    bytes += buf.length; gzBytes += gz.length;
  }
  const text = readHead(s.file);
  const first = /"timestamp"\s*:\s*"([^"]+)"/.exec(text);
  const row = { id: s.id, folder, cwd, title: titleOf(text), firstAt: first ? first[1] : new Date(fs.statSync(s.file).birthtimeMs).toISOString(),
    lastAt: new Date(s.newest).toISOString(), bytes, gzBytes, sha256: done[0].sha256, archivedAt: new Date(C.NOW).toISOString(), files: done };
  appendIndex(C, row); // on disk before the originals go: a run stopped here leaves a chat that --restore finds
  for (const f of files) fs.rmSync(f, { force: true });
  if (s.side) fs.rmSync(s.side, { recursive: true, force: true });
  return row;
}
function restoreRow(C, row) {
  const t = new Date(C.NOW); // now: /resume shows it, and Claude Code's sweep does not take it at the next start
  for (const f of row.files) {
    const from = path.join(C.ARCHIVE, row.folder, `${f.rel}.gz`);
    const buf = zlib.gunzipSync(fs.readFileSync(from));
    if (sha(buf) !== f.sha256) throw new Error(`${fwd(from)} does not match its sha256 in the index; ${row.id} stays archived from there on`);
    const to = path.join(C.PROJECTS, row.folder, f.rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, buf);
    fs.utimesSync(to, t, t);
    if (sha(fs.readFileSync(to)) !== f.sha256) throw new Error(`${fwd(to)} does not read back the same after the restore; ${row.id} stays archived`);
  }
  // the originals are back and read back right: only now the index row goes, then the archive copy
  writeIndex(C, readRows(C).filter((r) => !(r.id === row.id && r.folder === row.folder)));
  dropArchived(C, row);
}
function dropArchived(C, row) {
  for (const f of row.files) fs.rmSync(path.join(C.ARCHIVE, row.folder, `${f.rel}.gz`), { force: true });
  fs.rmSync(path.join(C.ARCHIVE, row.folder, row.id), { recursive: true, force: true });
  const folder = path.join(C.ARCHIVE, row.folder);
  if (fs.existsSync(folder) && !fs.readdirSync(folder).length) fs.rmdirSync(folder);
}
const keptForever = (C, cfg, cwd) => Boolean(cwd) && (cfg.keepForever || []).some((g) => globMatch(g, cwd, { platform: C.PLATFORM, home: C.HOME }));
// archived chats past Claude Code's sweep age go, unless their project is on the keepForever list
function purgeArchive(C, cfg) {
  const { days } = cleanupDays(C);
  const gone = [], kept = [];
  for (const r of readIndex(C)) {
    if (Date.parse(r.lastAt) < C.NOW - days * DAY && !keptForever(C, cfg, r.cwd)) gone.push(r); else kept.push(r);
  }
  if (gone.length) writeIndex(C, kept);
  for (const r of gone) dropArchived(C, r);
  return gone;
}
// sessions old enough to archive: not named by a running Claude Code
function archivable(C, folders, afterDays) {
  const out = [];
  for (const f of folders) for (const s of f.sessions) if (!s.live && s.newest < C.NOW - afterDays * DAY) out.push({ f, s });
  return out;
}
function runArchive(C, list) {
  const rows = [], failed = [];
  for (const { f, s } of list) {
    try { rows.push(archiveSession(C, f.folder, s, f.cwd)); } catch (e) { failed.push(`${s.id}: ${e.message}`); }
  }
  return { rows, failed };
}

// ---- worktrees
function worktreeList(C, repo) {
  const r = git(C, repo, ["worktree", "list", "--porcelain"]);
  if (!r.ok) return [];
  return r.out.split(/\r?\n\r?\n/).map((block) => {
    const w = {};
    for (const line of block.split(/\r?\n/)) {
      const [k, ...rest] = line.split(" ");
      w[k] = rest.join(" ") || true;
    }
    return w;
  }).filter((w) => w.worktree).slice(1); // the first is the repo itself
}
const mainBranch = (C, repo) => ["main", "master"].find((b) => git(C, repo, ["rev-parse", "--verify", "--quiet", `refs/heads/${b}`]).ok) || null;
const dirtyCount = (C, wt) => { const r = git(C, wt, ["--no-optional-locks", "status", "--porcelain"]); if (!r.ok) throw new Error(`git status in ${fwd(wt)}: ${r.err}`); return r.out ? r.out.split(/\r?\n/).length : 0; };
// git-ignored folders that a build or an install makes again; any other ignored file may be data (a *.db, logs)
const REBUILDABLE = ["node_modules", "dist", "build", "out", ".next", ".nuxt", ".turbo", "target", "__pycache__", ".pytest_cache", ".venv", "venv", ".gradle", "coverage"];
const ignoredData = (C, wt) => {
  const r = git(C, wt, ["--no-optional-locks", "status", "--porcelain", "--ignored"]);
  if (!r.ok) throw new Error(`git status in ${fwd(wt)}: ${r.err}`);
  return r.out.split(/\r?\n/).filter((l) => l.startsWith("!! ")).map((l) => l.slice(3).replace(/^"|"$/g, ""))
    .filter((p) => !p.split("/").some((seg) => REBUILDABLE.includes(seg))).length;
};
const ignoredWhy = (n) => `keep: ${n} ignored file${n === 1 ? "" : "s"} (data?)`;
function worktreeState(C, repo, wt) {
  const head = gitOut(C, wt, ["rev-parse", "HEAD"]);
  const dirty = dirtyCount(C, wt);
  const ignored = ignoredData(C, wt);
  const main = mainBranch(C, repo);
  const ahead = main ? Number(gitOut(C, repo, ["rev-list", "--count", `${main}..${head}`])) : null;
  return { head, dirty, ignored, ahead, main };
}
const worktreeVerdict = (s) => (s.dirty ? `keep: ${s.dirty} file${s.dirty === 1 ? "" : "s"} not committed`
  : s.ignored ? ignoredWhy(s.ignored)
  : s.ahead === null ? "keep: the repo has no main or master to compare with"
    : s.ahead ? `keep: ${s.ahead} commit${s.ahead === 1 ? "" : "s"} not on ${s.main}` : null);
// replay worktrees: each `.git` file under <tmp>/setup-replay-wt names its repo
function replayWorktrees(C) {
  const out = [];
  const look = (d, depth) => {
    let names;
    try { names = fs.readdirSync(d); } catch { return; }
    if (names.includes(".git") && fs.statSync(path.join(d, ".git")).isFile()) {
      const m = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(path.join(d, ".git"), "utf8"));
      const repo = m && fwd(m[1].trim()).split("/.git/worktrees/")[0];
      if (repo) out.push({ path: d, repo });
      return;
    }
    if (depth < 6) for (const n of names) if (fs.statSync(path.join(d, n), { throwIfNoEntry: false })?.isDirectory()) look(path.join(d, n), depth + 1);
  };
  if (fs.existsSync(C.REPLAY)) look(C.REPLAY, 0);
  return out;
}
const reposUnder = (C) => [...C.ROOTS.flatMap((r) => (fs.existsSync(r) ? fs.readdirSync(r).map((n) => path.join(r, n)) : [])), C.CLAUDE]
  .filter((d) => fs.statSync(path.join(d, ".git"), { throwIfNoEntry: false })?.isDirectory());
// a chat's cwd is provably a setup test run when the temp subfolder it sits in is a replay worktree or has a
// setup mkdtemp prefix; any other cwd under temp may be the person's own work
const setupRun = (C, cwd) => {
  const top = C.np(cwd).slice(C.np(C.TMP).length).replace(/^\/+/, "").split("/")[0].toLowerCase();
  return top === "setup-replay-wt" || TEMP_PREFIXES.some((x) => top.startsWith(x));
};
const hookScratchNames = (C) => {
  const dir = path.join(C.CLAUDE, "hooks");
  const names = new Set();
  if (fs.existsSync(dir)) for (const f of filesUnder(dir).filter((x) => /\.(mjs|js|ps1|sh|py)$/.test(x))) {
    for (const m of fs.readFileSync(f, "utf8").matchAll(/scratch[\\/]+([A-Za-z0-9_.-]+)/g)) names.add(m[1]);
  }
  return names;
};

// ---- the scan: every item the report lists, with the action it proposes
async function scan(C, scanner) {
  const items = [], skipped = [], kept = [], clicks = [];
  const counters = {};
  const add = (prefix, item) => { counters[prefix] = (counters[prefix] || 0) + 1; items.push({ id: `${prefix}${counters[prefix]}`, ...item, path: fwd(item.path) }); };
  const old = (ms, days) => ms < C.NOW - days * DAY;
  const big = []; // folders sized by the scanner, after the walk

  // 1, 1b: replay worktrees
  const replays = replayWorktrees(C);
  const busy = replays.length ? replayRunning(C) : null;
  if (busy) skipped.push({ path: fwd(C.REPLAY), reason: `${replays.length} replay worktrees left alone: ${busy}` });
  else for (const w of replays) {
    let dirty;
    try { dirty = dirtyCount(C, w.path); } catch (e) { add("R", { category: "replay-worktree", repo: w.repo, path: w.path, class: "P", stamp: "git-error", action: "keep", reason: `keep: git error ${e.message.split(/\r?\n/)[0]}`, undo: "none needed" }); continue; }
    const item = { category: "replay-worktree", repo: w.repo, dirty, stamp: String(dirty) };
    if (dirty) add("R", { ...item, path: w.path, class: "P", action: "keep", reason: `keep: ${dirty} files not committed (look first: git -C "${fwd(w.path)}" status)`, undo: "none needed" });
    else add("R", { ...item, path: w.path, class: "S", action: "remove", reason: "replay leftover", undo: "re-run the replay" });
    big.push(w.path);
  }
  // 2, 3: chat folders of test runs and of deleted projects
  for (const f of await chatFolders(C)) {
    if (!f.cwd || f.live || !old(f.newest, 2)) continue;
    const base = { path: f.dir, cwd: f.cwd, bytes: f.bytes, stamp: String(f.newest), mtime: new Date(f.newest).toISOString() };
    if (C.under(f.cwd, C.TMP)) {
      if (!setupRun(C, f.cwd)) add("R", { ...base, category: "temp-chat", class: "P", action: "delete", reason: `chats of work in a temp folder, not a setup test run; last used ${day(f.newest)}`, undo: "none" });
      else if (f.memory) add("R", { ...base, category: "test-chat", class: "P", action: "delete", reason: "test-run chats with a memory/ folder", undo: "none" });
      else add("R", { ...base, category: "test-chat", class: "S", action: "delete", reason: "chats of a test run", undo: "none (nobody resumes a test run)" });
    } else if (!fs.existsSync(f.cwd)) add("R", { ...base, category: "gone-project-chat", class: "S", action: "archive", reason: "its project folder is gone", undo: "--restore --project <name>" });
  }
  // 4: rebuildable caches
  for (const c of CACHES) {
    const p = path.join(C.CLAUDE, c.rel);
    const st = fs.statSync(p, { throwIfNoEntry: false });
    if (st && st.size >= c.minBytes && old(st.mtimeMs, c.idleDays)) add("R", { category: "cache", class: "S", path: p, bytes: st.size, stamp: String(st.mtimeMs), action: "delete", reason: c.name, undo: "rebuilt by the next scan" });
  }
  // 5, 13, 16: the temp folder
  const tmpNames = fs.existsSync(C.TMP) ? fs.readdirSync(C.TMP) : [];
  const temps = [];
  for (const n of tmpNames) {
    const p = path.join(C.TMP, n);
    if (n === "setup-replay-wt" || n.startsWith("disk-tidy-scan-")) continue;
    if (n === "claude") { const w = await walk(p, Date.now() + C.CAP_MS); kept.push({ name: "Claude Code temp (cleared with its chats)", bytes: w.bytes, capped: w.capped }); continue; }
    if (n.startsWith("nimbalyst-")) continue;
    const w = await walk(p, Date.now() + C.CAP_MS);
    const base = { path: p, bytes: w.bytes, capped: w.capped, stamp: String(w.newest), mtime: new Date(w.newest).toISOString() };
    if (TEMP_PREFIXES.some((x) => n.startsWith(x))) { if (old(w.newest, 2)) add("R", { ...base, category: "setup-temp", class: "S", action: "delete", reason: "a test or worker temp folder", undo: "none needed" }); }
    else if (w.bytes >= 100 * MB && old(w.newest, 7)) temps.push(base);
  }
  for (const t of temps.sort((a, b) => b.bytes - a.bytes).slice(0, 10)) add("T", { ...t, category: "big-temp", class: "P", action: "delete", reason: `unused since ${t.mtime.slice(0, 10)}, maker unknown`, undo: "none" });
  // 6, 7, 8: worktrees of the repos under the roots
  // git prints a worktree's real path; the temp folder's path may hold a Windows 8.3 short name (RUNNER~1 on the CI runner)
  const replayReal = fs.existsSync(C.REPLAY) ? fs.realpathSync.native(C.REPLAY) : C.REPLAY;
  for (const repo of reposUnder(C)) {
    for (const w of worktreeList(C, repo)) {
      if (C.under(w.worktree, C.REPLAY) || C.under(w.worktree, replayReal)) continue;
      if (w.prunable || !fs.existsSync(w.worktree)) { skipped.push({ path: fwd(w.worktree), reason: `folder already gone; git -C "${fwd(repo)}" worktree prune clears its record` }); continue; }
      const branch = w.branch ? String(w.branch).replace(/^refs\/heads\//, "") : null;
      const nim = /_worktrees$/.test(path.basename(path.dirname(w.worktree)));
      const category = C.np(w.worktree).includes("/.claude/worktrees/") ? "agent-worktree" : nim ? "nimbalyst-worktree" : "other-worktree";
      let s, lastCommit;
      try { s = worktreeState(C, repo, w.worktree); lastCommit = gitOut(C, w.worktree, ["log", "-1", "--format=%cs"]); } catch (e) {
        add("W", { category, class: "P", path: w.worktree, repo: fwd(repo), branch, stamp: "git-error", action: "keep", reason: `keep: git error ${e.message.split(/\r?\n/)[0]}`, undo: "none needed" });
        continue;
      }
      // an agent worktree written to in the last 2 days is still in use
      const fresh = category === "agent-worktree" && !old((await walk(w.worktree, Date.now() + C.CAP_MS)).newest, 2);
      const verdict = worktreeVerdict(s) || (fresh ? "keep: in use in the last 2 days" : null);
      add("W", { category, class: "P", path: w.worktree, repo: fwd(repo), branch, dirty: s.dirty, ignored: s.ignored, ahead: s.ahead, stamp: `${s.head}:${s.dirty}`,
        lastCommit, action: verdict ? "keep" : "remove",
        reason: verdict || `clean, merged${nim ? "; then archive it in Nimbalyst too" : ""}`, undo: branch ? `git worktree add "${fwd(w.worktree)}" ${branch}` : `git worktree add --detach "${fwd(w.worktree)}" ${s.head}` });
      big.push(w.worktree);
    }
  }
  // 9: scratch subfolders
  const scratch = path.join(C.CLAUDE, "scratch");
  if (fs.existsSync(scratch)) {
    const named = hookScratchNames(C);
    for (const n of fs.readdirSync(scratch)) {
      const p = path.join(scratch, n);
      if (!fs.statSync(p).isDirectory()) continue;
      const w = await walk(p, Date.now() + C.CAP_MS);
      const why = named.has(n) ? "keep: a hook uses it" : !old(w.newest, C.SCRATCH_DAYS) ? `keep: used in the last ${C.SCRATCH_DAYS} days` : null;
      add("S", { category: "scratch", class: "P", path: p, bytes: w.bytes, capped: w.capped, stamp: String(w.newest), mtime: new Date(w.newest).toISOString(), action: why ? "keep" : "delete", reason: why || `last used ${day(w.newest)}`, undo: "none" });
    }
  }
  // 10, 19: old copies of a project, and folders named like an option (a script took --help as its output folder)
  for (const root of C.ROOTS.filter((r) => fs.existsSync(r))) {
    for (const n of fs.readdirSync(root)) {
      const p = path.join(root, n);
      if (!fs.statSync(p).isDirectory()) continue;
      if (n.startsWith("--")) { const w = await walk(p, Date.now() + C.CAP_MS); add("O", { category: "option-named", class: "P", path: p, bytes: w.bytes, stamp: String(w.newest), action: "delete", reason: "a folder named like a command option: a script took it as its output folder", undo: "run the script again" }); continue; }
      const m = /^(.+?)(?:-old|-backup|\.bak.*)$/.exec(n);
      if (!m || !fs.existsSync(path.join(root, m[1]))) continue;
      const dotgit = fs.statSync(path.join(p, ".git"), { throwIfNoEntry: false });
      if (dotgit?.isFile()) continue; // a worktree: listed with the worktrees
      // no git: nothing to compare with, so the person compares by hand; with git: uncommitted work, ignored data
      // and commits the project lacks each keep it
      let why = null;
      const look = dotgit ? null : "compare by hand: no git history";
      if (dotgit) try {
        const theirs = path.join(root, m[1]);
        const dirty = dirtyCount(C, p), ignored = ignoredData(C, p);
        const commits = gitOut(C, p, ["rev-list", "--all"]).split(/\r?\n/).filter(Boolean);
        if (dirty) why = `keep: ${dirty} file${dirty === 1 ? "" : "s"} not committed`;
        else if (ignored) why = ignoredWhy(ignored);
        else if (!fs.existsSync(path.join(theirs, ".git"))) why = `keep: has its own git history and ${m[1]} has none`;
        else if (commits.length) {
          const missing = git(C, theirs, ["cat-file", "--batch-check"], { input: `${commits.join("\n")}\n` }).out.split(/\r?\n/).filter((l) => / missing$/.test(l)).length;
          if (missing) why = `keep: ${missing} commit${missing === 1 ? "" : "s"} not in ${m[1]}`;
        }
      } catch (e) { why = `keep: git error ${e.message.split(/\r?\n/)[0]}`; }
      const w = await walk(p, Date.now() + C.CAP_MS);
      add("O", { category: "old-copy", class: "P", path: p, bytes: w.bytes, capped: w.capped, stamp: String(w.newest), action: why ? "keep" : look ? "look" : "delete", reason: why || look || `no commits missing from ${m[1]}`, undo: "none" });
    }
  }
  // 17: video cache entries unused for 30 days
  const video = path.join(C.CLAUDE, "video-cache");
  if (fs.existsSync(video)) for (const n of fs.readdirSync(video)) {
    const p = path.join(video, n);
    const w = await walk(p, Date.now() + C.CAP_MS);
    if (old(w.newest, 30)) add("V", { category: "video-cache", class: "P", path: p, bytes: w.bytes, stamp: String(w.newest), action: "delete", reason: `unused since ${day(w.newest)}`, undo: "rebuilt on use" });
  }
  // 18: kept, size only
  for (const n of KEEP_DIRS) { const p = path.join(C.CLAUDE, n); if (fs.existsSync(p)) big.push(p); }
  // 14, 15: Nimbalyst, read only
  const nim = C.NIMBALYST && fs.existsSync(C.NIMBALYST) ? C.NIMBALYST : null;
  if (nim) for (const n of ["sqlite-db.backups", "sqlite-db"]) if (fs.existsSync(path.join(nim, n))) big.push(path.join(nim, n));

  const sizes = await sizeAll(C, scanner, big);
  const byPath = new Map([...sizes].map(([k, v]) => [fwd(k), v]));
  for (const it of items) {
    const s = byPath.get(it.path);
    if (s) { it.bytes = s.bytes; it.capped = s.capped; }
    it.bytes ??= 0;
  }
  for (const n of KEEP_DIRS) { const s = sizes.get(path.join(C.CLAUDE, n)); if (s) kept.push({ name: n, bytes: s.bytes, capped: s.capped }); }
  if (nim) {
    const appFile = path.join(nim, "app-settings.json");
    const copies = fs.existsSync(appFile) ? readJson(appFile).databaseMaintenance?.backupCopiesKept ?? 2 : 2; // 2: Nimbalyst's default
    const b = sizes.get(path.join(nim, "sqlite-db.backups")), d = sizes.get(path.join(nim, "sqlite-db"));
    if (b) clicks.push({ id: "N1", what: "Nimbalyst backups", copies, bytes: b.bytes, text: `Nimbalyst backups: ${copies} copies, ${fmtBytes(b.bytes)}.${copies > 1 ? ` Settings > Application > Database > copies: 1 saves about ${fmtBytes(Math.round(b.bytes * (copies - 1) / copies))}` : ""}` });
    if (d) clicks.push({ id: "N2", what: "Nimbalyst database", bytes: d.bytes, text: `Nimbalyst database ${fmtBytes(d.bytes)}. Same page: Vacuum (needs about ${fmtBytes(d.bytes)} free while it runs)` });
  }
  return { items, skipped, kept, clicks };
}

// ---- the report and the ledger
const size = (it) => `${it.capped ? "≥ " : ""}${fmtBytes(it.bytes)}${it.capped ? ` (stopped at ${C_CAP_S} s)` : ""}`;
let C_CAP_S = 60;
const LABEL = { "replay-worktree": "replay worktrees", "test-chat": "test-run chat logs", "gone-project-chat": "chat logs of deleted folders", cache: "usage-scan cache", "setup-temp": "setup temp folders" };
const short = (C, p) => { const h = fwd(C.HOME); return p.startsWith(h) ? `~${p.slice(h.length)}` : p; };
function chatOffer(C, folders, cfg) {
  if (cfg.archive) return null; // asked before: on, or turned off
  const list = archivable(C, folders, 60);
  if (!list.length) return null;
  const bytes = list.reduce((t, x) => t + x.s.bytes, 0);
  const days = cleanupDays(C).days;
  return { count: list.length, bytes, line: `Chats older than 60 days: ${list.length}, ${fmtBytes(bytes)}. Archive them (compressed, restorable with one command) and delete them past ${days} days?` };
}
function printReport(C, rep) {
  const L = [];
  L.push(`Disk report, ${new Date(C.NOW).toISOString().slice(0, 16).replace("T", " ")} (scanner: ${rep.scanner}, ${rep.seconds} s). Ledger: ${short(C, rep.ledgerFile)}`, "");
  const S = rep.items.filter((i) => i.class === "S"), P = rep.items.filter((i) => i.class === "P");
  L.push(`Setup leftovers (cleaned by the update)  ${fmtBytes(S.reduce((t, i) => t + i.bytes, 0))}`);
  for (const [cat, label] of Object.entries(LABEL)) {
    const g = S.filter((i) => i.category === cat);
    if (g.length) L.push(`  ${label}, ${g.length}: ${fmtBytes(g.reduce((t, i) => t + i.bytes, 0))}, ${g[0].action} (ids ${g[0].id}-${g.at(-1).id})`);
  }
  if (rep.archive) L.push(`  chat archive: on at ${rep.archive.afterDays} days, ${rep.archive.due} chats due`);
  L.push("Yours, each only with your yes");
  for (const i of P) L.push(`  ${i.id.padEnd(4)} ${short(C, i.path)}  ${size(i)}  ${i.action === "keep" ? i.reason : `${i.action} (${i.reason})`}`);
  if (rep.offer) L.push(`  ${rep.offer.line}`);
  if (rep.clicks.length) { L.push("In other apps"); for (const c of rep.clicks) L.push(`  ${c.id}  ${c.text}`); }
  if (rep.kept.length) L.push(`Kept: ${rep.kept.map((k) => `${k.name} ${k.capped ? "≥ " : ""}${fmtBytes(k.bytes)}`).join(", ")}`);
  for (const s of rep.skipped) L.push(`Skipped: ${short(C, s.path)}: ${s.reason}`);
  console.log(L.join("\n"));
}
async function report(C) {
  const started = Date.now();
  const scanner = pickScanner(C.SCANNER);
  C_CAP_S = C.CAP_MS / 1000;
  const r = await scan(C, scanner);
  const cfg = readConfig(C);
  const folders = await chatFolders(C);
  const rep = { ledger: 1, at: new Date(C.NOW).toISOString(), scanner: scanner.name, seconds: Math.round((Date.now() - started) / 1000), home: fwd(C.HOME), ...r,
    offer: chatOffer(C, folders, cfg), archive: archiveOn(cfg) ? { afterDays: cfg.archive.afterDays, due: archivable(C, folders, cfg.archive.afterDays).length } : null };
  fs.mkdirSync(C.LOGS, { recursive: true });
  rep.ledgerFile = fwd(path.join(C.LOGS, `disk-tidy-${day(C.NOW)}.json`));
  fs.writeFileSync(rep.ledgerFile, `${JSON.stringify(rep, null, 2)}\n`);
  return rep;
}

// ---- acting on one ledger item: re-checked first, skipped with its reason when anything moved
async function stampNow(C, it) {
  if (/worktree$/.test(it.category) && it.category !== "replay-worktree") { const s = worktreeState(C, it.repo, it.path); return { stamp: `${s.head}:${s.dirty}`, s }; }
  if (it.category === "replay-worktree") return { stamp: String(dirtyCount(C, it.path)) };
  if (it.category === "cache") return { stamp: String(fs.statSync(it.path).mtimeMs) };
  return { stamp: String((await walk(it.path, Infinity)).newest) };
}
function removeEmptyUp(from, stop) {
  for (let d = from; d.length > stop.length && fs.existsSync(d) && !fs.readdirSync(d).length; d = path.dirname(d)) fs.rmdirSync(d);
}
async function applyItem(C, it) {
  if (!["remove", "delete", "archive"].includes(it.action)) return `skipped: ${it.reason}`;
  if (!fs.existsSync(it.path)) return "skipped: already gone";
  const now = await stampNow(C, it);
  if (now.stamp !== it.stamp) return "skipped: changed since the report; run the report again";
  if (/worktree$/.test(it.category)) {
    if (it.category === "replay-worktree") { const busy = replayRunning(C); if (busy) return `skipped: ${busy}`; }
    else { const v = worktreeVerdict(now.s); if (v) return `skipped: ${v}`; }
    const r = git(C, it.repo, ["worktree", "remove", it.path]);
    if (!r.ok) return `skipped: git worktree remove refused: ${r.err.split(/\r?\n/)[0]}`;
    git(C, it.repo, ["worktree", "prune"]);
    if (it.category === "replay-worktree") removeEmptyUp(path.dirname(path.resolve(it.path)), path.resolve(C.REPLAY));
    return "removed";
  }
  if (it.category === "scratch" && !C.under(path.dirname(it.path), path.join(C.CLAUDE, "scratch"))) return "skipped: not a subfolder of scratch";
  if (it.category === "gone-project-chat") {
    const f = (await chatFolders(C)).find((x) => fwd(x.dir) === it.path);
    const { rows, failed } = runArchive(C, f.sessions.filter((s) => !s.live).map((s) => ({ f, s })));
    if (!fs.readdirSync(f.dir).length) fs.rmdirSync(f.dir); // memory/ and anything not a session stay
    return failed.length ? `skipped: ${failed.join("; ")}` : `archived (${rows.length} chats)`;
  }
  fs.rmSync(it.path, { recursive: true, force: true });
  return "deleted";
}
async function applyLedger(C, file, only) {
  const ledger = readJson(file);
  if (ledger.ledger !== 1) throw new Error(`${fwd(file)} is not a disk-tidy ledger`);
  const want = new Set(only);
  const pick = ledger.items.filter((i) => want.has(i.id) || want.has(i.category));
  const unknown = only.filter((w) => !ledger.items.some((i) => i.id === w || i.category === w));
  if (unknown.length) throw new Error(`not in the ledger: ${unknown.join(", ")}`);
  const results = [];
  let freed = 0;
  for (const it of pick) {
    let r;
    try { r = await applyItem(C, it); } catch (e) { r = `skipped: ${e.message}`; }
    if (!r.startsWith("skipped")) freed += it.bytes;
    results.push({ id: it.id, path: it.path, result: r });
    console.log(`${it.id} ${short(C, it.path)}: ${r}`);
  }
  console.log(`freed ${fmtBytes(freed)}`);
  ledger.applied = [...(ledger.applied || []), { at: new Date().toISOString(), results }];
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
  return { results, freed };
}

// ---- the chat archive step alone: --auto runs it, and so does the pc-tidy-nudge hook every 3 days
async function archiveStep(C) {
  const cfg = readConfig(C);
  if (!archiveOn(cfg)) return { lines: [] };
  const lines = [];
  const late = archiveFits(C, cfg.archive.afterDays);
  if (late) return { lines: [`disk: chat archive paused: ${late}`] };
  const { rows, failed } = runArchive(C, archivable(C, await chatFolders(C), cfg.archive.afterDays));
  const gone = purgeArchive(C, cfg);
  const { days } = cleanupDays(C);
  if (rows.length) {
    const b = rows.reduce((t, r) => t + r.bytes, 0), g = rows.reduce((t, r) => t + r.gzBytes, 0);
    lines.push(`disk: archived ${rows.length} chat${rows.length === 1 ? "" : "s"} older than ${cfg.archive.afterDays} days (${fmtBytes(b)}, ${fmtBytes(g)} compressed); restore one with --restore <id>`);
  }
  if (gone.length) lines.push(`disk: deleted ${gone.length} archived chat${gone.length === 1 ? "" : "s"} past ${days} days`);
  for (const f of failed) lines.push(`disk: not archived: ${f}`);
  return { lines, archived: rows.length, deleted: gone.length };
}
async function auto(C) {
  const rep = await report(C);
  const parts = {};
  let freed = 0, archivedFolders = 0;
  const S = rep.items.filter((i) => i.class === "S");
  const results = [];
  for (const it of S) {
    let r;
    try { r = await applyItem(C, it); } catch (e) { r = `skipped: ${e.message}`; }
    results.push({ id: it.id, path: it.path, result: r });
    if (r.startsWith("archived")) archivedFolders++;
    else if (!r.startsWith("skipped")) { freed += it.bytes; parts[it.category] = (parts[it.category] || 0) + it.bytes; }
  }
  if (results.length) {
    const ledger = readJson(rep.ledgerFile);
    ledger.applied = [{ at: new Date().toISOString(), auto: true, results }];
    fs.writeFileSync(rep.ledgerFile, `${JSON.stringify(ledger, null, 2)}\n`);
  }
  const lines = [];
  const what = Object.entries(parts).map(([k, v]) => `${LABEL[k]} ${fmtBytes(v)}`).join(", ");
  const head = [freed ? `freed ${fmtBytes(freed)} of setup leftovers (${what})` : "", archivedFolders ? `${archivedFolders} chat folder${archivedFolders === 1 ? "" : "s"} of deleted projects archived` : ""].filter(Boolean);
  if (head.length) lines.push(`disk: ${head.join("; ")}. List: ${short(C, rep.ledgerFile)}`);
  for (const s of rep.skipped.filter((x) => C.under(x.path, C.REPLAY))) lines.push(`disk: ${s.reason}`);
  for (const r of results.filter((x) => x.result.startsWith("skipped") && !x.result.includes("already gone"))) lines.push(`disk: ${r.id} ${short(C, r.path)} ${r.result}`);
  lines.push(...(await archiveStep(C)).lines);
  const mine = rep.items.filter((i) => i.class === "P" && i.action !== "keep");
  if (mine.length) {
    const groups = {};
    for (const i of mine) { const g = groups[i.category] ||= { n: 0, bytes: 0 }; g.n++; g.bytes += i.bytes; }
    const NAMES = { "agent-worktree": "finished worktrees", "nimbalyst-worktree": "finished Nimbalyst worktrees", "other-worktree": "finished worktrees", scratch: `scratch folders unused for ${C.SCRATCH_DAYS}+ days`, "old-copy": "old project copies", "big-temp": "big temp entries", "video-cache": "unused video-cache entries", "option-named": "folders named like an option", "test-chat": "test-run chat folders with notes", "temp-chat": "chat folders of work in temp" };
    const total = mine.reduce((t, i) => t + i.bytes, 0);
    lines.push(`offer: your own leftovers: about ${fmtBytes(total)} (${Object.entries(groups).map(([k, g]) => `${g.n} ${NAMES[k] || k} ${fmtBytes(g.bytes)}`).join(", ")}). Look through them with /disk-tidy; nothing goes without your yes per item.`);
  }
  if (rep.offer) lines.push(`offer: ${rep.offer.line}`);
  if (lines.length) console.log(lines.join("\n"));
}

// ---- archive commands
function archiveSet(C) {
  const cfg = readConfig(C);
  if (has("--archive-off")) { cfg.archive = { off: true, since: day(C.NOW) }; writeConfig(C, cfg); console.log("Chat archive off: chats stay until Claude Code's own sweep. Turn it on any time: --archive-on"); return 0; }
  const days = Number(opt("--days", "60"));
  if (!(days > 0)) throw new Error(`--days must be a number of days, not ${opt("--days")}`);
  const late = archiveFits(C, days);
  if (late) { console.log(`Chat archive not turned on. ${late}`); return 3; }
  cfg.archive = { afterDays: days, since: day(C.NOW) };
  writeConfig(C, cfg);
  console.log(`Chat archive on: chats older than ${days} days go to ${short(C, fwd(C.ARCHIVE))} (compressed), and are deleted there past ${cleanupDays(C).days} days${cfg.keepForever?.length ? `, except ${cfg.keepForever.join(", ")}` : ""}.`);
  return 0;
}
function keepForeverAdd(C, glob) {
  const cfg = readConfig(C);
  cfg.keepForever = [...new Set([...(cfg.keepForever || []), fwd(glob)])];
  writeConfig(C, cfg);
  console.log(`Kept forever in the archive: ${cfg.keepForever.join(", ")}`);
}
function matchRows(C, rows, text) {
  const t = text.toLowerCase();
  return rows.filter((r) => [r.cwd, r.folder, r.title].some((x) => String(x || "").toLowerCase().includes(t)));
}
function archiveList(C) {
  const rows = has("--project") ? matchRows(C, readIndex(C), opt("--project")) : readIndex(C);
  if (!rows.length) { console.log("No archived chats" + (has("--project") ? ` for "${opt("--project")}"` : "") + "."); return; }
  for (const r of rows) console.log(`${r.lastAt.slice(0, 10)}  ${r.id.slice(0, 8)}  ${fwd(r.cwd || r.folder)}  ${r.title}`);
}
function restore(C) {
  const i = args.indexOf("--restore");
  const prefix = args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
  const rows = readIndex(C);
  const pick = has("--all") ? rows : has("--project") ? matchRows(C, rows, opt("--project")) : prefix ? rows.filter((r) => r.id.startsWith(prefix)) : null;
  if (!pick) throw new Error("--restore needs a session id prefix, --project <text> or --all");
  if (!pick.length) throw new Error("no archived chat matches; --archive-list shows them");
  for (const r of pick) { restoreRow(C, r); console.log(`restored ${r.id} (${fwd(r.cwd || r.folder)}): ${r.title}`); }
}

async function main() {
  const C = setup();
  if (has("--archive-on") || has("--archive-off")) return archiveSet(C);
  if (has("--keep-forever")) return keepForeverAdd(C, opt("--keep-forever"));
  if (has("--archive-list")) return archiveList(C);
  if (has("--restore")) return restore(C);
  if (has("--apply")) {
    if (!has("--only")) throw new Error("--apply needs --only <ids or categories>, comma-separated");
    return applyLedger(C, path.resolve(opt("--apply")), opt("--only").split(",").map((s) => s.trim()).filter(Boolean));
  }
  if (has("--auto") && has("--archive-only")) {
    const { lines } = await archiveStep(C);
    if (has("--note-file") && lines.length) { fs.mkdirSync(path.dirname(opt("--note-file")), { recursive: true }); fs.writeFileSync(opt("--note-file"), lines.join(" ")); }
    if (lines.length) console.log(lines.join("\n"));
    return 0;
  }
  if (has("--auto")) return auto(C);
  const rep = await report(C);
  if (has("--json")) console.log(JSON.stringify(rep, null, 2)); else printReport(C, rep);
  return 0;
}

// started as the script, not imported: by real path, as hooks/lib/hook-io.mjs isMain, because Node gives import.meta.url
// the real path while argv keeps a link's or a short name's (macOS /var is /private/var; RUNNER~1; a linked ~/.claude)
const realOr = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
if (process.argv[1] && realOr(process.argv[1]).toLowerCase() === realOr(fileURLToPath(import.meta.url)).toLowerCase()) {
  main().then((code) => process.exit(typeof code === "number" ? code : 0), (e) => { console.error(`disk-tidy: ${e.message}`); process.exit(1); });
}
