#!/usr/bin/env node
// backup: encrypted restic backup of the Claude folder and picked project folders, to Backblaze B2 or a local folder.
// restic 0.19.1 is downloaded from its GitHub release and checked against the SHA-256 pinned here. Windows, macOS, Linux.
//
//   backup.mjs get-restic [--file <archive>]       download (or take this file), check the hash, unpack into <home>/bin
//   backup.mjs setup [--window]                     B2: asks the master key (hidden), makes the bucket and a no-delete key,
//                                                   the password and the recovery sheet; --window opens it in its own terminal
//   backup.mjs setup --target local --repo <dir> [--password-stdin]   a restic repository in a local folder
//   backup.mjs folders [--projects <dir>] [--add <dir>] [--remove <dir>]   list project folders with sizes; change the list
//   backup.mjs run                                  back up now (+ weekly forget/prune/check, monthly restore test)
//   backup.mjs test                                 restore test: restore into a temp folder and compare with the source
//   backup.mjs status                               last run, size, snapshot count, schedule
//   backup.mjs restore <path> [--to <new dir>] [--snapshot <id>]   restore into a new folder, never over the original
//   backup.mjs off                                  remove the schedule; keeps the repository, the keys and this folder
//   backup.mjs schedule on --every day|week | off [--print] [--platform win32|darwin|linux]   daily or weekly (Sunday) run; --print shows it, registers nothing
//
// Paths: CLAUDE_BACKUP_HOME (default ~/.claude-backup: password, b2.env, config.json, bin/, logs/), CLAUDE_HOME (default
// ~/.claude, always backed up). The restic password reaches restic only as RESTIC_PASSWORD_FILE, the B2 key only as env
// vars; neither is ever put on a command line or printed (except the password once, on the recovery sheet in setup).
import { spawnSync, spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(import.meta.url);
const HOME = os.homedir();
const BK = path.resolve(
  process.env.CLAUDE_BACKUP_HOME || path.join(HOME, ".claude-backup"),
);
const CLAUDE = path.resolve(
  process.env.CLAUDE_HOME || path.join(HOME, ".claude"),
);
const F = {
  config: path.join(BK, "config.json"),
  password: path.join(BK, "password"),
  b2env: path.join(BK, "b2.env"),
  excludes: path.join(BK, "excludes.txt"),
  lastRun: path.join(BK, "last-run.json"),
  logs: path.join(BK, "logs"),
  bin: path.join(BK, "bin"),
  cache: path.join(BK, "cache"),
};
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const BIG = 100 * MB; // --exclude-larger-than 100M (restic: MiB)
const LOGS_KEPT = 30;

export const RESTIC_VERSION = "0.19.1";
// From the release's SHA256SUMS, its signature checked with gpg against restic's key CF8F18F2844575973F79D4E191A6868BD3F7A907
export const RESTIC_PINS = {
  "win32-x64": {
    file: "restic_0.19.1_windows_amd64.zip",
    sha256: "da948ad707ed690426473aaba2046cd61f8f90f6f0e7dab6be0d5796531de67d",
  },
  "darwin-arm64": {
    file: "restic_0.19.1_darwin_arm64.bz2",
    sha256: "7be0a144ccc377880f294204aa271d76e4b79554b42a751151d425ce6ebac143",
  },
  "darwin-x64": {
    file: "restic_0.19.1_darwin_amd64.bz2",
    sha256: "c38d579622cf602f665234c5a8c315030b6cf70656028fe6dc29a786b60e5f35",
  },
  "linux-x64": {
    file: "restic_0.19.1_linux_amd64.bz2",
    sha256: "f415415624dcc452f2a02b8c33641791a8c6d6d3b65bbb3543fcf9a25151585c",
  },
  "linux-arm64": {
    file: "restic_0.19.1_linux_arm64.bz2",
    sha256: "a5f64aaab53d51e311fa3829124c5b703f2d14cf187d8640b6be3b2b49376465",
  },
};
export const releaseUrl = (file) =>
  `https://github.com/restic/restic/releases/download/v${RESTIC_VERSION}/${file}`;

// What leaves the Claude folder out (design section 4). Each is a glob from the folder's root; "**/" matches any depth.
export const CLAUDE_EXCLUDES = [
  "projects/**/*.jsonl", // chat logs
  "scratch",
  "tmp",
  "cache",
  "shell-snapshots",
  "session-env",
  "context-mode",
  "video-cache",
  "reports/usage-scan-cache.jsonl",
  "**/browser-profiles", // login cookies never leave the PC
  "plugins/cache",
  "plugins/marketplaces",
  "plugins-md-backup",
  "**/node_modules",
  "**/.venv",
  "**/venv",
  "**/__pycache__",
  "security/agent-sdk-venv",
];
// Each project folder: what a build or install makes again. Any depth.
export const PROJECT_EXCLUDES = [
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  ".next",
  "target",
  ".cache",
].map((d) => "**/" + d);

class Stop extends Error {}
const stop = (msg) => {
  throw new Stop(msg);
};
const slash = (p) => p.replace(/\\/g, "/");
const tilde = (p) =>
  slash(path.resolve(p))
    .toLowerCase()
    .startsWith(slash(HOME).toLowerCase() + "/")
    ? "~/" + slash(path.relative(HOME, p))
    : slash(path.resolve(p));
const untilde = (p) => path.resolve(p.replace(/^~(?=$|[\\/])/, HOME));
const same = (a, b) =>
  process.platform === "win32"
    ? slash(path.resolve(a)).toLowerCase() ===
      slash(path.resolve(b)).toLowerCase()
    : path.resolve(a) === path.resolve(b);
const inside = (child, parent) => {
  const r = path.relative(parent, child);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};
export const human = (n) =>
  n >= 1024 ** 3
    ? (n / 1024 ** 3).toFixed(1) + " GB"
    : n >= MB
      ? (n / MB).toFixed(1) + " MB"
      : n >= 1024
        ? Math.round(n / 1024) + " KB"
        : n + " B";

function readJson(file, what) {
  let text;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    stop(`cannot read ${what} (${file}): ${e.message}`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    stop(`${what} (${file}) is not valid JSON: ${e.message}`);
  }
}
const writeJson = (file, obj) =>
  fs.writeFileSync(file, JSON.stringify(obj, null, 2) + "\n");

// ---- owner-only files ----
// The file is made empty, locked to the user, then filled, so the secret is never in a file others may read.
function ownerOnly(file) {
  if (process.platform === "win32") {
    const user = process.env.USERNAME || os.userInfo().username;
    const r = spawnSync(
      "icacls",
      [file, "/inheritance:r", "/grant:r", `${user}:F`],
      { encoding: "utf8" },
    );
    if (r.error || r.status !== 0)
      stop(
        `icacls could not make ${file} owner-only: ${r.error?.message || (r.stdout + r.stderr).trim()}`,
      );
    // /inheritance:r drops only inherited entries; a file can also start with explicit ones (SYSTEM, Administrators)
    const list = spawnSync("icacls", [file], { encoding: "utf8" });
    if (list.error || list.status !== 0)
      stop(
        `icacls could not list ${file}: ${list.error?.message || (list.stdout + list.stderr).trim()}`,
      );
    const others = list.stdout
      .split(/\r?\n/)
      .map((l) => (l.startsWith(file) ? l.slice(file.length) : l).trim())
      .map((l) => l.match(/^(.+?):\(/)?.[1])
      .filter(
        (p) =>
          p &&
          p.toLowerCase() !== user.toLowerCase() &&
          !p.toLowerCase().endsWith("\\" + user.toLowerCase()),
      );
    for (const p of others) {
      const rm = spawnSync("icacls", [file, "/remove", p], {
        encoding: "utf8",
      });
      if (rm.error || rm.status !== 0)
        stop(
          `icacls could not remove ${p} from ${file}: ${rm.error?.message || (rm.stdout + rm.stderr).trim()}`,
        );
    }
  } else {
    try {
      fs.chmodSync(file, 0o600);
    } catch (e) {
      stop(`chmod 600 failed on ${file}: ${e.message}`);
    }
  }
}
export function writeSecret(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "", { mode: 0o600 });
  ownerOnly(file);
  fs.writeFileSync(file, text, { mode: 0o600 });
}

// ---- config ----
export function loadConfig() {
  if (!fs.existsSync(F.config))
    stop(`not set up yet (no ${F.config}): run /backup to set it up`);
  const c = readJson(F.config, "backup config");
  if (!["b2", "local"].includes(c.target))
    stop(`config.json: target is "${c.target}", expected "b2" or "local"`);
  if (!Array.isArray(c.folders) || !c.folders.length)
    stop("config.json: folders is empty");
  return c;
}
export function newConfig(target, extra) {
  return {
    target,
    ...extra,
    folders: [{ path: tilde(CLAUDE), exclude: [] }],
    time: "21:00",
    keep: { daily: 7, weekly: 5, monthly: 12 },
    restic: RESTIC_VERSION,
    schedule: false,
  };
}
const saveConfig = (c) => {
  fs.mkdirSync(BK, { recursive: true });
  writeJson(F.config, c);
};

// Excludes of one folder, as globs from its root
export function folderExcludes(folder) {
  const own = (folder.exclude || []).map((e) => e.replace(/[\\/]+$/, ""));
  return [
    ...(same(untilde(folder.path), CLAUDE)
      ? CLAUDE_EXCLUDES
      : PROJECT_EXCLUDES),
    ...own,
  ];
}
// The restic exclude file: each glob made absolute (forward slashes; restic reads both on Windows)
export function excludeLines(cfg) {
  return cfg.folders.flatMap((f) =>
    folderExcludes(f).map((g) => slash(untilde(f.path)) + "/" + g),
  );
}

// Glob from a folder's root to a RegExp over the relative path (forward slashes). "**/" = any depth (also none),
// "*" = within one name. A match also covers everything below it.
function globRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const ch = glob[i];
    if (glob.startsWith("**/", i)) {
      re += "(?:.*/)?";
      i += 2;
    } else if (glob.startsWith("**", i)) {
      re += ".*";
      i += 1;
    } else if (ch === "*") re += "[^/]*";
    else if (ch === "?") re += "[^/]";
    else re += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(
    "^" + re + "(?:/.*)?$",
    process.platform === "win32" ? "i" : "",
  );
}
export function matcher(folder) {
  const res = folderExcludes(folder).map(globRe);
  return (rel) => res.some((r) => r.test(rel));
}

// Every file under the backed-up folders the excludes keep: { abs, rel, size, mtimeMs, birthtimeMs }; files over
// 100 MB go to big. Symlinks are not followed.
export function walk(cfg) {
  const files = [],
    big = [];
  for (const f of cfg.folders) {
    const root = untilde(f.path);
    if (!fs.existsSync(root))
      stop(
        `backed-up folder is missing: ${root} (remove it with /backup folders)`,
      );
    const excluded = matcher(f);
    const go = (dir, relDir) => {
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        const rel = relDir ? relDir + "/" + ent.name : ent.name;
        if (excluded(rel)) continue;
        const abs = path.join(dir, ent.name);
        if (ent.isDirectory()) go(abs, rel);
        else if (ent.isFile()) {
          const st = fs.statSync(abs);
          const item = {
            abs,
            rel,
            size: st.size,
            mtimeMs: st.mtimeMs,
            birthtimeMs: st.birthtimeMs,
          };
          (st.size > BIG ? big : files).push(item);
        }
      }
    };
    go(root, "");
  }
  return { files, big };
}

// The folder for a path and whether the excludes cover it (for the restore test's "excluded but in the backup")
function coveredByExcludes(cfg, abs) {
  for (const f of cfg.folders) {
    const root = untilde(f.path);
    if (inside(abs, root)) return matcher(f)(slash(path.relative(root, abs)));
  }
  return true; // not under any backed-up folder
}

// ---- restic ----
export const resticPath = () =>
  path.join(F.bin, process.platform === "win32" ? "restic.exe" : "restic");
const sha256File = (file) =>
  crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");

export function pinFor(platform = process.platform, arch = process.arch) {
  const pin = RESTIC_PINS[`${platform}-${arch}`];
  if (!pin)
    stop(
      `no pinned restic for ${platform} ${arch} (pinned: ${Object.keys(RESTIC_PINS).join(", ")})`,
    );
  return pin;
}

async function getRestic(args) {
  const pin = pinFor();
  fs.mkdirSync(F.bin, { recursive: true });
  const work = fs.mkdtempSync(path.join(F.bin, "get-"));
  try {
    const archive = path.join(work, pin.file);
    if (args.file) fs.copyFileSync(path.resolve(args.file), archive);
    else {
      const url = releaseUrl(pin.file);
      let res;
      try {
        res = await fetch(url);
      } catch (e) {
        stop(`download failed: ${url}: ${e.cause?.message || e.message}`);
      }
      if (!res.ok) stop(`download failed: ${url}: HTTP ${res.status}`);
      fs.writeFileSync(archive, Buffer.from(await res.arrayBuffer()));
    }
    const found = sha256File(archive);
    if (found !== pin.sha256)
      stop(
        `checksum mismatch for ${pin.file}: expected ${pin.sha256}, found ${found}. Nothing was installed.`,
      );
    const out = resticPath();
    if (pin.file.endsWith(".zip")) {
      // Windows' own bsdtar reads zip (Git's GNU tar does not), so it is called by full path
      const tar = path.join(
        process.env.SystemRoot || "C:\\Windows",
        "System32",
        "tar.exe",
      );
      const r = spawnSync(tar, ["-xf", archive, "-C", work], {
        encoding: "utf8",
      });
      if (r.error || r.status !== 0)
        stop(
          `unzip with ${tar} failed: ${r.error?.message || r.stderr.trim()}`,
        );
      const exe = fs.readdirSync(work).find((n) => /^restic.*\.exe$/i.test(n));
      if (!exe) stop(`no restic .exe inside ${pin.file}`);
      fs.rmSync(out, { force: true });
      fs.renameSync(path.join(work, exe), out);
    } else {
      const fd = fs.openSync(out + ".part", "w");
      let r;
      for (const tool of ["bzip2", "bunzip2"]) {
        r = spawnSync(
          tool,
          tool === "bzip2" ? ["-dc", archive] : ["-c", archive],
          { stdio: ["ignore", fd, "pipe"] },
        );
        if (!r.error) break;
      }
      fs.closeSync(fd);
      if (r.error)
        stop(
          "bzip2 is needed to unpack restic and was not found (macOS has it; on Linux install the bzip2 package)",
        );
      if (r.status !== 0)
        stop(
          `bzip2 could not unpack ${pin.file}: ${r.stderr.toString().trim()}`,
        );
      fs.renameSync(out + ".part", out);
      fs.chmodSync(out, 0o755);
    }
    const v = spawnSync(out, ["version"], { encoding: "utf8" });
    if (v.error || v.status !== 0 || !v.stdout.includes(RESTIC_VERSION))
      stop(
        `unpacked restic does not run: ${v.error?.message || v.stderr || v.stdout}`,
      );
    console.log(
      `restic ${RESTIC_VERSION} ready: ${out} (sha256 ${found.slice(0, 12)}... checked)`,
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }
}

// restic's environment: password file, cache in the backup home, repository and B2 key from config / b2.env
function resticEnv(cfg) {
  const env = {
    ...process.env,
    RESTIC_PASSWORD_FILE: F.password,
    RESTIC_CACHE_DIR: F.cache,
  };
  for (const k of [
    "RESTIC_PASSWORD",
    "RESTIC_PASSWORD_COMMAND",
    "RESTIC_REPOSITORY_FILE",
    "B2_ACCOUNT_ID",
    "B2_ACCOUNT_KEY",
  ])
    delete env[k];
  if (!fs.existsSync(F.password))
    stop(
      `password file missing: ${F.password} (setup not finished: run /backup)`,
    );
  if (cfg.target === "local") env.RESTIC_REPOSITORY = untilde(cfg.repo);
  else {
    let text;
    try {
      text = fs.readFileSync(F.b2env, "utf8");
    } catch (e) {
      stop(`cannot read the B2 key file ${F.b2env}: ${e.message}`);
    }
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
    for (const k of ["B2_ACCOUNT_ID", "B2_ACCOUNT_KEY", "RESTIC_REPOSITORY"])
      if (!env[k]) stop(`${F.b2env} has no ${k}`);
  }
  return env;
}
export function restic(cfg, args, { allowFail = false } = {}) {
  const exe = resticPath();
  if (!fs.existsSync(exe))
    stop(`restic is not installed at ${exe}: run backup.mjs get-restic`);
  const r = spawnSync(exe, args, {
    env: resticEnv(cfg),
    encoding: "utf8",
    maxBuffer: 1024 * MB,
  });
  if (r.error) stop(`restic ${args[0]} could not start: ${r.error.message}`);
  if (r.status !== 0 && !allowFail)
    stop(
      `restic ${args[0]} failed (exit ${r.status}): ${r.stderr.trim().split(/\r?\n/).slice(-5).join(" | ")}`,
    );
  return r;
}
const jsonLines = (text) =>
  text
    .split(/\r?\n/)
    .filter((l) => l.startsWith("{"))
    .map((l) => JSON.parse(l));

// A source path as restic stores it (Windows C:\x -> /C/x) and back
export const toSnap = (abs) => {
  const s = slash(path.resolve(abs));
  return process.platform === "win32" ? s.replace(/^([A-Za-z]):/, "/$1") : s;
};
export const fromSnap = (p) =>
  process.platform === "win32"
    ? path.resolve(p.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:"))
    : p;
// restic's times have up to 9 decimals; Date.parse wants 3
const snapTime = (t) => Date.parse(t.replace(/(\.\d{3})\d+/, "$1"));

export function latestSnapshot(cfg) {
  const list = JSON.parse(restic(cfg, ["snapshots", "--json"]).stdout || "[]");
  if (!list.length)
    stop("the repository has no snapshot yet: run /backup now first");
  return list.reduce((a, b) => (snapTime(b.time) > snapTime(a.time) ? b : a));
}

// ---- restore test (design section 8) ----
export function restoreTest(cfg) {
  const snap = latestSnapshot(cfg);
  const T = snapTime(snap.time);
  const target = fs.mkdtempSync(
    path.join(os.tmpdir(), `claude-backup-test-${Date.now()}-`),
  );
  const why = [];
  let compared = 0,
    changed = 0,
    bytes = 0;
  try {
    // Each backed-up folder is restored by itself (<snapshot>:<folder>): restoring the whole snapshot would also
    // make its parent folders (C:\Users ...) with their saved permissions, which the user may then not delete.
    const roots = snap.paths.map((p, i) => ({
      snap: toSnap(p),
      dir: path.join(target, String(i)),
    }));
    for (const r of roots) {
      const rr = restic(
        cfg,
        ["restore", `${snap.id}:${r.snap}`, "--target", r.dir, "--verify"],
        { allowFail: true },
      );
      if (rr.status !== 0)
        why.push(
          `restic restore --verify failed (exit ${rr.status}): ${rr.stderr.trim().split(/\r?\n/).slice(-3).join(" | ")}`,
        );
    }
    const nodes = jsonLines(
      restic(cfg, ["ls", snap.id, "--json"]).stdout,
    ).filter((n) => n.struct_type === "node" || n.message_type === "node");
    const key = (p) =>
      process.platform === "win32" ? slash(p).toLowerCase() : p;
    const listed = new Set();
    for (const n of nodes.filter((x) => x.type === "file")) {
      const src = fromSnap(n.path);
      listed.add(key(src));
      compared++;
      bytes += n.size || 0;
      const root = roots.find((r) => n.path.startsWith(r.snap + "/"));
      if (!root) {
        why.push(`outside every backed-up folder: ${src}`);
        continue;
      }
      const restored = path.join(
        root.dir,
        ...n.path.slice(root.snap.length).split("/").filter(Boolean),
      );
      let st;
      try {
        st = fs.statSync(restored);
      } catch {
        why.push(`missing from the restore: ${src}`);
        continue;
      }
      if (st.size !== (n.size || 0)) {
        why.push(`size ${st.size} instead of ${n.size}: ${src}`);
        continue;
      }
      if (coveredByExcludes(cfg, src))
        why.push(`in the backup though excluded: ${src}`);
      let s;
      try {
        s = fs.statSync(src);
      } catch {
        changed++;
        continue;
      } // deleted since the backup
      if (s.mtimeMs > T) {
        changed++;
        continue;
      }
      if (sha256File(src) !== sha256File(restored))
        why.push(`content differs: ${src}`);
    }
    for (const f of walk(cfg).files) {
      if (f.mtimeMs > T || (f.birthtimeMs && f.birthtimeMs > T)) continue; // made after the snapshot
      if (!listed.has(key(f.abs))) why.push(`not in the backup: ${f.abs}`);
    }
  } finally {
    try {
      fs.rmSync(target, { recursive: true, force: true });
    } catch (e) {
      stop(`could not delete the restore test folder ${target}: ${e.message}`);
    }
  }
  const ok = why.length === 0;
  const lines = ok
    ? [
        `restore test: matches (${compared} files, ${human(bytes)}; ${changed} changed since the backup, not compared)`,
      ]
    : [
        "restore test: differs",
        ...why.slice(0, 20).map((w) => "  " + w),
        ...(why.length > 20 ? [`  ... and ${why.length - 20} more`] : []),
      ];
  return { ok, lines, snapshot: snap.short_id || snap.id.slice(0, 8) };
}

// ---- run, test, status, restore ----
const readLastRun = () =>
  fs.existsSync(F.lastRun) ? readJson(F.lastRun, "last-run.json") : {};
const stamp = (d = new Date()) =>
  d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

// The password and key folder must never be inside a backup, and a local repository must not back up itself
function guardPaths(cfg) {
  for (const f of cfg.folders) {
    const root = untilde(f.path);
    if (inside(BK, root))
      stop(
        `${BK} (password and key) is inside the backed-up folder ${root}: move one of them`,
      );
    if (cfg.target === "local" && inside(untilde(cfg.repo), root))
      stop(`the repository ${cfg.repo} is inside the backed-up folder ${root}`);
  }
}

function runBackup() {
  const cfg = loadConfig();
  guardPaths(cfg);
  const prev = readLastRun();
  const log = [];
  const say = (l) => {
    console.log(l);
    log.push(l);
  };
  const now = new Date();
  const result = {
    time: now.toISOString(),
    ok: false,
    lastMaintenance: prev.lastMaintenance || null,
    lastTestOk: prev.lastTestOk || null,
  };
  try {
    fs.writeFileSync(F.excludes, excludeLines(cfg).join("\n") + "\n");
    const { big } = walk(cfg);
    const r = restic(
      cfg,
      [
        "backup",
        ...cfg.folders.map((f) => untilde(f.path)),
        "--exclude-file",
        F.excludes,
        "--exclude-larger-than",
        "100M",
        "--tag",
        "claude-backup",
        "--json",
      ],
      { allowFail: true },
    );
    const msgs = jsonLines(r.stdout);
    const sum = msgs.find((m) => m.message_type === "summary");
    const errs = msgs
      .filter((m) => m.message_type === "error")
      .map((m) => `${m.item || ""}: ${m.error?.message || ""}`);
    if (r.status !== 0 || !sum)
      stop(
        `restic backup failed (exit ${r.status})${errs.length ? `; ${errs.length} files unreadable, first: ${errs[0]}` : ""}: ${r.stderr.trim().split(/\r?\n/).slice(-3).join(" | ")}`,
      );
    Object.assign(result, {
      snapshot: sum.snapshot_id.slice(0, 8),
      files: sum.total_files_processed,
      size: sum.total_bytes_processed,
      added: sum.data_added,
    });
    say(
      `backup: snapshot ${result.snapshot}, ${sum.total_files_processed} files, ${human(sum.total_bytes_processed)}; ${human(sum.data_added)} added (${sum.files_new} new, ${sum.files_changed} changed)`,
    );
    for (const b of big)
      say(`skipped, over 100 MB: ${b.abs} (${human(b.size)})`);
    result.skipped = big.map((b) => b.abs);
    if (
      !prev.lastMaintenance ||
      now - Date.parse(prev.lastMaintenance) > 7 * DAY
    ) {
      const k = cfg.keep;
      restic(cfg, [
        "forget",
        "--keep-daily",
        String(k.daily),
        "--keep-weekly",
        String(k.weekly),
        "--keep-monthly",
        String(k.monthly),
        "--prune",
      ]);
      restic(cfg, ["check", "--read-data-subset=5%"]);
      result.lastMaintenance = now.toISOString();
      say(
        `weekly upkeep: old snapshots thinned (keep ${k.daily} daily, ${k.weekly} weekly, ${k.monthly} monthly); 5% of the data read back: ok`,
      );
    }
    if (!prev.lastTestOk || now - Date.parse(prev.lastTestOk) > 30 * DAY) {
      const t = restoreTest(cfg);
      t.lines.forEach(say);
      if (!t.ok) stop("the restore test differs (lines above)");
      result.lastTestOk = new Date().toISOString();
    }
    result.ok = true;
  } catch (e) {
    result.error = e.message;
    log.push(`failed: ${e.message}`);
    throw e;
  } finally {
    writeJson(F.lastRun, result);
    fs.mkdirSync(F.logs, { recursive: true });
    fs.writeFileSync(
      path.join(F.logs, `${stamp(now)}.log`),
      log.join("\n") + "\n",
    );
    const logs = fs
      .readdirSync(F.logs)
      .filter((n) => n.endsWith(".log"))
      .sort();
    for (const old of logs.slice(0, Math.max(0, logs.length - LOGS_KEPT)))
      fs.rmSync(path.join(F.logs, old));
  }
}

function runTest() {
  const cfg = loadConfig();
  const t = restoreTest(cfg);
  t.lines.forEach((l) => console.log(l));
  if (t.ok)
    writeJson(F.lastRun, {
      ...readLastRun(),
      lastTestOk: new Date().toISOString(),
    });
  return t.ok;
}

function status() {
  const cfg = loadConfig();
  console.log(
    `target: ${cfg.target === "b2" ? `Backblaze B2, bucket ${cfg.bucket}` : `local folder ${cfg.repo}`}`,
  );
  for (const f of cfg.folders)
    console.log(
      `folder: ${f.path}${f.exclude?.length ? ` (also leaves out ${f.exclude.join(", ")})` : ""}`,
    );
  const last = readLastRun();
  console.log(
    `last run: ${last.time ? `${new Date(last.time).toLocaleString()}, ${last.ok ? `ok, ${human(last.added || 0)} added` : `failed: ${last.error}`}` : "never"}`,
  );
  const snaps = JSON.parse(restic(cfg, ["snapshots", "--json"]).stdout || "[]");
  if (snaps.length) {
    const s = JSON.parse(restic(cfg, ["stats", "latest", "--json"]).stdout);
    console.log(
      `snapshots: ${snaps.length}; latest ${human(s.total_size)}, ${s.total_file_count} files`,
    );
  } else console.log("snapshots: 0");
  console.log(
    `last restore test that matched: ${last.lastTestOk ? new Date(last.lastTestOk).toLocaleString() : "none"}`,
  );
  console.log(
    `schedule: ${cfg.schedule ? `${cfg.every === "week" ? "every Sunday" : "daily"} at ${cfg.time}` : "off (backups run when you ask: /backup now)"}`,
  );
}

function restore(args) {
  const cfg = loadConfig();
  if (!args._[1])
    stop(
      "restore needs the path to bring back: backup.mjs restore <path> [--to <new folder>]",
    );
  const src = untilde(args._[1]);
  if (!cfg.folders.some((f) => inside(src, untilde(f.path))))
    stop(`${src} is not under a backed-up folder`);
  const to = args.to
    ? path.resolve(untilde(args.to))
    : path.join(HOME, `claude-restore-${stamp()}`);
  if (fs.existsSync(to))
    stop(`${to} already exists: a restore goes into a new folder`);
  if (inside(to, src) || inside(src, to))
    stop(`${to} overlaps ${src}: a restore never goes over the original`);
  const snap = args.snapshot || latestSnapshot(cfg).id;
  // From its parent folder (<snapshot>:<folder>), so no parent folders with saved permissions are made above it
  restic(cfg, [
    "restore",
    `${snap}:${toSnap(path.dirname(src))}`,
    "--target",
    to,
    "--include",
    "/" + path.basename(src),
  ]);
  const at = path.join(to, path.basename(src));
  let n = 0,
    size = 0;
  const count = (p) => {
    const s = fs.statSync(p);
    if (!s.isDirectory()) {
      n++;
      size += s.size;
      return;
    }
    for (const e of fs.readdirSync(p)) count(path.join(p, e));
  };
  if (fs.existsSync(at)) count(at);
  if (!n) stop(`nothing under ${src} is in snapshot ${snap.slice(0, 8)}`);
  console.log(`restored ${n} files (${human(size)}) into ${to}`);
  console.log(`it sits at ${at}`);
}

// ---- folders ----
function setupState() {
  const f = path.join(CLAUDE, "setup-state.json");
  return fs.existsSync(f) ? readJson(f, "setup-state.json") : {};
}
function folders(args) {
  const cfg = fs.existsSync(F.config) ? loadConfig() : null;
  if (args.add || args.remove) {
    if (!cfg) stop("not set up yet: run setup first");
    const p = untilde(args.add || args.remove);
    if (same(p, CLAUDE)) stop(`${tilde(CLAUDE)} is always backed up`);
    const at = cfg.folders.findIndex((f) => same(untilde(f.path), p));
    if (args.add) {
      if (!fs.existsSync(p) || !fs.statSync(p).isDirectory())
        stop(`not a folder: ${p}`);
      if (at >= 0) stop(`already backed up: ${p}`);
      cfg.folders.push({ path: tilde(p), exclude: [] });
      guardPaths(cfg);
    } else {
      if (at < 0) stop(`not in the backup: ${p}`);
      cfg.folders.splice(at, 1);
    }
    saveConfig(cfg);
    console.log(
      `${args.add ? "added" : "removed"}: ${tilde(p)} (from the next backup on)`,
    );
    return;
  }
  const projects = args.projects
    ? untilde(args.projects)
    : setupState().projects;
  if (!projects)
    stop(
      "no projects folder known (setup-state.json has none): pass --projects <dir>",
    );
  if (!fs.existsSync(projects)) stop(`projects folder not found: ${projects}`);
  const line = (f, mark) => {
    const { files, big } = walk({ folders: [f] });
    const size = files.reduce((a, x) => a + x.size, 0);
    return `  [${mark}] ${f.path}  ${human(size)}, ${files.length} files${big.length ? `; ${big.length} over 100 MB left out` : ""}`;
  };
  console.log(line({ path: tilde(CLAUDE), exclude: [] }, "x") + "  (always)");
  for (const e of fs
    .readdirSync(projects, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name))) {
    const p = path.join(projects, e.name);
    const have = cfg?.folders.find((f) => same(untilde(f.path), p));
    console.log(
      line(have || { path: tilde(p), exclude: [] }, have ? "x" : " "),
    );
  }
}

// ---- schedule (design section 5); off by default: backups run when the user asks ----
export function scheduleSpec(cfg, platform = process.platform) {
  const node = setupState().node || process.execPath;
  const [hh, mm] = (cfg.time || "21:00").split(":").map(Number);
  const time = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  const weekly = cfg.every === "week";
  const ps = (s) => s.replace(/'/g, "''");
  if (platform === "win32") {
    return {
      files: [],
      on: [
        [
          "powershell",
          "-NoProfile",
          "-Command",
          [
            `$a = New-ScheduledTaskAction -Execute '${ps(node)}' -Argument '"${ps(SCRIPT)}" run'`,
            `$t = New-ScheduledTaskTrigger ${weekly ? "-Weekly -DaysOfWeek Sunday" : "-Daily"} -At ${time}`,
            "$s = New-ScheduledTaskSettingsSet -StartWhenAvailable -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew",
            `Register-ScheduledTask -TaskName "Claude backup" -Action $a -Trigger $t -Settings $s -Force | Out-Null`,
          ].join("; "),
        ],
      ],
      off: [
        [
          "powershell",
          "-NoProfile",
          "-Command",
          `Unregister-ScheduledTask -TaskName "Claude backup" -Confirm:$false`,
        ],
      ],
    };
  }
  const home = slash(HOME);
  const x = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  if (platform === "darwin") {
    const plist = `${home}/Library/LaunchAgents/com.ai-coding-setup.backup.plist`;
    const uid =
      process.platform === "darwin" ? String(process.getuid()) : "$(id -u)";
    return {
      files: [
        {
          path: plist,
          text: `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>com.ai-coding-setup.backup</string>
  <key>ProgramArguments</key><array><string>${x(node)}</string><string>${x(SCRIPT)}</string><string>run</string></array>
  <key>StartCalendarInterval</key><dict>${weekly ? "<key>Weekday</key><integer>0</integer>" : ""}<key>Hour</key><integer>${hh}</integer><key>Minute</key><integer>${mm}</integer></dict>
</dict></plist>
`,
        },
      ],
      on: [["launchctl", "bootstrap", `gui/${uid}`, plist]],
      off: [["launchctl", "bootout", `gui/${uid}`, plist]],
    };
  }
  if (platform === "linux") {
    const dir = `${home}/.config/systemd/user`;
    return {
      files: [
        {
          path: `${dir}/claude-backup.service`,
          text: `[Unit]\nDescription=Claude backup\n\n[Service]\nType=oneshot\nExecStart="${node}" "${SCRIPT}" run\n`,
        },
        {
          path: `${dir}/claude-backup.timer`,
          text: `[Unit]\nDescription=Claude backup, ${weekly ? "weekly" : "daily"}\n\n[Timer]\nOnCalendar=${weekly ? "Sun " : ""}*-*-* ${time}:00\nPersistent=true\n\n[Install]\nWantedBy=timers.target\n`,
        },
      ],
      on: [
        ["systemctl", "--user", "daemon-reload"],
        ["systemctl", "--user", "enable", "--now", "claude-backup.timer"],
      ],
      off: [["systemctl", "--user", "disable", "--now", "claude-backup.timer"]],
    };
  }
  stop(`no schedule for platform ${platform}`);
}
const showCmd = (c) =>
  c
    .map((a) => (/[\s"';$]/.test(a) ? `"${a.replace(/"/g, '\\"')}"` : a))
    .join(" ");

function schedule(args) {
  const mode = args._[1];
  if (!["on", "off"].includes(mode))
    stop("schedule needs on or off: backup.mjs schedule on|off [--print]");
  const cfg = loadConfig();
  if (mode === "on") {
    if (!["day", "week"].includes(args.every))
      stop("schedule on needs --every day or --every week (the user picks)");
    cfg.every = args.every;
  }
  const platform = args.platform || process.platform;
  const spec = scheduleSpec(cfg, platform);
  if (args.print) {
    if (mode === "on")
      for (const f of spec.files) console.log(`file ${f.path}:\n${f.text}`);
    for (const c of spec[mode])
      console.log(
        c[0] === "powershell"
          ? `run in PowerShell:\n${c[3].split("; ").join("\n")}`
          : `run: ${showCmd(c)}`,
      );
    return;
  }
  if (platform !== process.platform) stop("--platform only works with --print");
  if (mode === "on" && !readLastRun().lastTestOk)
    stop(
      "no restore test has matched yet: run backup.mjs test first, the schedule waits for it",
    );
  if (mode === "on")
    for (const f of spec.files) {
      fs.mkdirSync(path.dirname(f.path), { recursive: true });
      fs.writeFileSync(f.path, f.text);
    }
  for (const c of spec[mode]) {
    const r = spawnSync(c[0], c.slice(1), { encoding: "utf8" });
    if (r.error || r.status !== 0)
      stop(
        `${c[0]} failed: ${r.error?.message || (r.stderr || r.stdout).trim()}`,
      );
  }
  if (mode === "off")
    for (const f of scheduleSpec(cfg, platform).files)
      fs.rmSync(f.path, { force: true });
  cfg.schedule = mode === "on";
  saveConfig(cfg);
  console.log(
    mode === "on"
      ? `schedule: on, ${cfg.every === "week" ? "every Sunday" : "daily"} at ${cfg.time} (a missed run runs at the next chance)`
      : "schedule: off",
  );
}

function off() {
  const cfg = loadConfig();
  if (cfg.schedule) schedule({ _: ["schedule", "off"] });
  console.log(
    "backup: off. Nothing was deleted: the backup, the password and the key are kept; /backup now still works.",
  );
  console.log(
    cfg.target === "b2"
      ? `To delete the backup itself: log in at backblaze.com, Buckets, delete bucket ${cfg.bucket}.`
      : `To delete the backup itself: delete the folder ${cfg.repo}.`,
  );
  console.log(`Then delete ${BK} (it holds the password and the key).`);
}

// ---- setup ----
// Hidden input: raw mode, nothing echoed
function ask(question, hidden = false) {
  if (!process.stdin.isTTY)
    stop(
      "setup asks for keys and needs its own terminal window: run backup.mjs setup --window",
    );
  return new Promise((resolve, reject) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (hidden) stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.resume();
    let buf = "";
    const end = (fn) => {
      stdin.removeListener("data", on);
      if (hidden) stdin.setRawMode(false);
      stdin.pause();
      process.stdout.write("\n");
      fn();
    };
    const on = (s) => {
      for (const ch of s) {
        if (ch === "\r" || ch === "\n") return end(() => resolve(buf.trim()));
        if (ch === "\u0003")
          return end(() =>
            reject(new Stop("stopped (Ctrl+C); nothing was written")),
          );
        if (ch === "\u007f" || ch === "\b") buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", on);
  });
}
// 6 made-up words of 5 letters (consonant-vowel-consonant-vowel-consonant): about 100 bits
export function sixWords() {
  const c = "bdfghjklmnprstvz",
    v = "aeiou";
  const pick = (s) => s[crypto.randomInt(s.length)];
  return Array.from(
    { length: 6 },
    () => pick(c) + pick(v) + pick(c) + pick(v) + pick(c),
  ).join("-");
}
const randomName = (n) =>
  Array.from(
    { length: n },
    () => "abcdefghijklmnopqrstuvwxyz0123456789"[crypto.randomInt(36)],
  ).join("");

async function b2(apiName, url, { token, basic, body }) {
  let res;
  try {
    res = await fetch(url, {
      method: body ? "POST" : "GET",
      body: body && JSON.stringify(body),
      headers: {
        Authorization: basic ? `Basic ${basic}` : token,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
    });
  } catch (e) {
    stop(`B2 ${apiName}: no connection: ${e.cause?.message || e.message}`);
  }
  const text = await res.text();
  let j;
  try {
    j = JSON.parse(text);
  } catch {
    stop(`B2 ${apiName}: HTTP ${res.status}, answer is not JSON`);
  }
  if (!res.ok)
    stop(`B2 ${apiName} failed: ${j.code || res.status}: ${j.message || ""}`);
  return j;
}

// B2 bucket (private, hidden versions kept 30 days) and a key for it that cannot delete. The master key stays in memory.
async function makeB2() {
  console.log(
    "Backblaze: Application Keys > Master Application Key. Typing is hidden; paste and press Enter.",
  );
  const masterId = await ask("Master key ID: ", true);
  const masterKey = await ask("Master application key: ", true);
  if (!masterId || !masterKey) stop("key ID and key are both needed");
  const auth = await b2(
    "b2_authorize_account",
    "https://api.backblazeb2.com/b2api/v2/b2_authorize_account",
    { basic: Buffer.from(`${masterId}:${masterKey}`).toString("base64") },
  );
  const bucketName = `claude-backup-${randomName(8)}`;
  const bucket = await b2(
    "b2_create_bucket",
    `${auth.apiUrl}/b2api/v2/b2_create_bucket`,
    {
      token: auth.authorizationToken,
      body: {
        accountId: auth.accountId,
        bucketName,
        bucketType: "allPrivate",
        lifecycleRules: [
          {
            fileNamePrefix: "",
            daysFromHidingToDeleting: 30,
            daysFromUploadingToHiding: null,
          },
        ],
      },
    },
  );
  const key = await b2(
    "b2_create_key",
    `${auth.apiUrl}/b2api/v2/b2_create_key`,
    {
      token: auth.authorizationToken,
      body: {
        accountId: auth.accountId,
        keyName: `claude-backup-${randomName(6)}`,
        bucketId: bucket.bucketId,
        capabilities: ["listBuckets", "listFiles", "readFiles", "writeFiles"],
      },
    },
  );
  console.log(
    `Bucket ${bucketName} made: private, hidden versions kept 30 days.`,
  );
  console.log(
    `Key ${key.applicationKeyId.slice(0, 6)}... made: this bucket only; list, read, write, no delete. The master key is forgotten.`,
  );
  return {
    bucket: bucketName,
    keyId: key.applicationKeyId,
    key: key.applicationKey,
  };
}

async function choosePassword() {
  const own = await ask(
    "Press Enter for a made-up password of 6 words, or type your own (16+ characters, hidden): ",
    true,
  );
  if (!own) return { pw: sixWords(), made: true };
  if (own.length < 16)
    stop(
      "a password of your own needs at least 16 characters; run setup again",
    );
  if ((await ask("Type it again: ", true)) !== own)
    stop("the two did not match; run setup again");
  return { pw: own, made: false };
}

function recoverySheet(pw, repo, cfg) {
  const login =
    cfg.target === "b2"
      ? `set B2_ACCOUNT_ID and B2_ACCOUNT_KEY (the key in ${F.b2env}, or a new key made at backblaze.com) and RESTIC_REPOSITORY=${repo}`
      : `set RESTIC_REPOSITORY=${repo}`;
  return [
    "",
    "==================== RECOVERY SHEET: keep it in a password manager or on paper ====================",
    `restic password: ${pw}`,
    ...(cfg.bucket ? [`Bucket:          ${cfg.bucket}`] : []),
    `Repository:      ${repo}`,
    "Restore on a new PC:",
    `  1. get restic ${RESTIC_VERSION}: https://github.com/restic/restic/releases`,
    `  2. ${login}`,
    "  3. restic restore latest --target <a new folder>   (it asks for this password)",
    "Without this password nobody can read the backup, not even you: restic has no reset.",
    "==================================================================================================",
    "",
  ].join("\n");
}

async function setup(args) {
  if (args.window)
    return openWindow(process.argv.slice(3).filter((a) => a !== "--window"));
  const target = args.target || "b2";
  if (!["b2", "local"].includes(target))
    stop(`--target is b2 or local, not ${target}`);
  if (target === "b2" && args["password-stdin"])
    stop("B2 setup asks for keys: run it in its own window (--window)");
  if (fs.existsSync(F.config))
    stop(`already set up (${F.config}); /backup status shows it`);
  if (!fs.existsSync(resticPath()))
    stop(
      `restic is not installed at ${resticPath()}: run backup.mjs get-restic first`,
    );
  let cfg,
    repo,
    pw,
    made = false,
    b2env;
  if (target === "local") {
    if (!args.repo) stop("--target local needs --repo <folder>");
    repo = path.resolve(untilde(args.repo));
    cfg = newConfig("local", { repo: tilde(repo) });
  } else {
    const k = await makeB2();
    repo = `b2:${k.bucket}:restic`;
    cfg = newConfig("b2", {
      bucket: k.bucket,
      keyId: k.keyId.slice(0, 6) + "...",
    });
    b2env = `B2_ACCOUNT_ID=${k.keyId}\nB2_ACCOUNT_KEY=${k.key}\nRESTIC_REPOSITORY=${repo}\n`;
  }
  guardPaths(cfg);
  if (args["password-stdin"]) {
    pw = fs.readFileSync(0, "utf8").replace(/\r?\n$/, "");
    if (pw.length < 16)
      stop("the password from stdin has fewer than 16 characters");
  } else ({ pw, made } = await choosePassword());
  if (!args["password-stdin"]) {
    console.log(recoverySheet(pw, repo, cfg));
    const last = made ? pw.split("-").pop() : null;
    for (let i = 0; made; i++) {
      if (
        (await ask(
          "Type the last word of the password, to show it is saved: ",
        )) === last
      )
        break;
      if (i === 2)
        stop(
          "the last word did not match three times; nothing was written. Run setup again.",
        );
    }
    process.stdout.write("\x1b[2J\x1b[3J\x1b[H"); // the password leaves the screen
  }
  writeSecret(F.password, pw + "\n");
  if (b2env) writeSecret(F.b2env, b2env);
  saveConfig(cfg);
  fs.writeFileSync(F.excludes, excludeLines(cfg).join("\n") + "\n");
  restic(cfg, ["init"]);
  console.log(
    `repository made: ${cfg.target === "b2" ? repo : cfg.repo}. Settings in ${F.config}.`,
  );
  if (!args["password-stdin"]) console.log("Back to the chat.");
}

function openWindow(rest) {
  const parts = [process.execPath, SCRIPT, "setup", ...rest];
  if (process.platform === "win32") {
    const line = parts.map((p) => `"${p}"`).join(" ");
    const r = spawn(
      "cmd.exe",
      ["/c", `start "Claude backup" cmd /k "${line}"`],
      { detached: true, stdio: "ignore", windowsVerbatimArguments: true },
    );
    r.unref();
  } else if (process.platform === "darwin") {
    const line = parts
      .map((p) => `'${p.replace(/'/g, "'\\''")}'`)
      .join(" ")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
    const r = spawnSync(
      "osascript",
      [
        "-e",
        `tell application "Terminal" to do script "${line}"`,
        "-e",
        'tell application "Terminal" to activate',
      ],
      { encoding: "utf8" },
    );
    if (r.error || r.status !== 0)
      stop(`could not open Terminal: ${r.error?.message || r.stderr.trim()}`);
  } else {
    const r = spawn("x-terminal-emulator", ["-e", ...parts], {
      detached: true,
      stdio: "ignore",
    });
    r.on("error", () =>
      console.log(
        `No terminal could be opened. Open one and run: ${showCmd(parts)}`,
      ),
    );
    r.unref();
  }
  console.log(
    'A window named "Claude backup" opened. Type the keys there, not in the chat. It ends with "Back to the chat".',
  );
}

// ---- main ----
function parseArgs(argv) {
  const flags = new Set(["window", "password-stdin", "print"]);
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([\w-]+)$/);
    if (!m) a._.push(argv[i]);
    else if (flags.has(m[1])) a[m[1]] = true;
    else if (i + 1 >= argv.length) stop(`--${m[1]} needs a value`);
    else a[m[1]] = argv[++i];
  }
  return a;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  switch (args._[0]) {
    case "get-restic":
      return getRestic(args);
    case "setup":
      return setup(args);
    case "folders":
      return folders(args);
    case "run":
    case "now":
      return runBackup();
    case "test":
      if (!runTest()) process.exitCode = 1;
      return;
    case "status":
      return status();
    case "restore":
      return restore(args);
    case "off":
      return off();
    case "schedule":
      return schedule(args);
    default:
      stop(
        `unknown command "${args._[0] ?? ""}": get-restic, setup, folders, run, test, status, restore, off, schedule`,
      );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === SCRIPT) {
  main().catch((e) => {
    console.error(e instanceof Stop ? `backup: ${e.message}` : e.stack);
    process.exit(1);
  });
}
