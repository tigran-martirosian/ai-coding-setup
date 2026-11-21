#!/usr/bin/env node
// Moves a whole project folder and fixes what names it by its path. Windows only. Plain Node, no npm dependencies.
//   node move-project.mjs <from> <to> [--dry] [--queue] [--home <folder>]   move <from> to <to> (which must not exist)
//   node move-project.mjs --run-queued     carry out the moves queued while Nimbalyst ran, then empty the queue
//   node move-project.mjs --tasks <path>   list the scheduled tasks naming one file or folder
//   --dry      lists every change and changes nothing (allowed while Nimbalyst runs)
//   --queue    with Nimbalyst running, queue the move for its next close (see "the queue" below); closed, move now
//   --home     work as if <folder> were the home folder (tests); else USERPROFILE
// The places fixed, in this order: the folder itself (and its sibling <name>_worktrees, which goes to
// <to>_worktrees), git worktrees (`git worktree repair` from the moved repo fixes both link files), Nimbalyst's
// records (app-settings.json, workspace-settings.json and its database's path columns, all in one transaction;
// see "Nimbalyst's records" below), the live text
// files under ~/.claude naming the path (C:\x, C:\\x inside JSON, C:/x, /c/x, the history folder's name), ~/.claude.json (its `projects` entry
// is keyed by the forward-slash path), the Claude Code history folder ~/.claude/projects/<slug> (every character
// that is not a letter or digit becomes "-"; those of folders inside it too, and memory files naming them), and the
// scheduled tasks naming the path (read through the Task Scheduler's own interface, so no character is lost to the
// console code page; created again with schtasks /create /xml /f). A path matches only as a whole name:
// C:\P\fam-port never matches C:\P\fam-portal, nor C:\P\fam-port (2) when that folder exists beside it. Both paths
// are first spelt as the disk spells them, so a source typed in another case still finds its history folder.
// Text files keep their encoding: UTF-8, UTF-16 with a BOM, or a one-byte code page (cp1251 ...) rewritten byte for
// byte when both paths are plain ASCII; else the file is listed as "not fixed, edit it by hand".
// Refused before anything is touched (exit 1, the message says why): a missing source, an existing target, Nimbalyst
// running without --queue (a half move orphans its sessions), --queue when the app has no quit listener, a source
// Windows won't rename because something has it open, two ~/.claude.json or workspace-settings.json entries that
// would get the same key, a unique key of Nimbalyst's database the new values would break, a scheduled task
// schtasks cannot create again (a stored password, another account, highest privileges without an elevated
// terminal, characters lost when read), a log that cannot be written.
// A failure after the folder moved stops there (exit 2); the log ~/.claude/setup-logs/move-project-<day>-<name>.log
// names each step done, written as it goes. A folder that could not be moved back is exit 2 too, saying where it is.
// An open Claude Code session in the project keeps its own copy of ~/.claude.json and may write the old place back:
// every run prints that warning, and ~/.claude.json is read again right before it is written.
// Environment overrides (tests): MOVE_PROJECT_RUNNING=1|0 (Nimbalyst running or not, in place of tasklist; or
// @<file> holding answers such as "0 1", one taken per check),
// MOVE_PROJECT_SCHTASKS (a .mjs file run with Node in place of schtasks, for /query /xml and /create),
// MOVE_PROJECT_NIMBALYST_DATA (Nimbalyst's data folder; else %APPDATA%\@nimbalyst\electron), and deliver.mjs's own
// (NIMBALYST_DELIVER_DATA, the queue's folder, and the rest).
// Exit codes: 0 done (or queued); 1 refused; 2 failed midway.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
const cleanups = [];
class Refused extends Error {}
class Failed extends Error {}
const refuse = (why) => {
  throw new Refused(why);
};
const flagValue = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const v = args[at + 1];
  return v && !v.startsWith("--") ? v : null;
};
const fwd = (p) => p.replace(/\\/g, "/");
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
const isWin = process.platform === "win32";
// how Claude Code files a project's history: every character that is not a letter or digit becomes "-"
const slug = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
const inside = (p, dir) => {
  const r = path.relative(dir, p);
  return r === "" || (!r.startsWith("..") && !path.isAbsolute(r));
};
const localStamp = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
};

// The path as the disk spells it, the drive letter upper case: each existing part is looked up in its folder's
// listing (so a junction is not followed, as realpath would); the parts that do not exist yet stay as typed.
function realCase(p) {
  const full = path.resolve(p),
    { root } = path.parse(full);
  let out = /^[a-z]:/i.test(root) ? root.toUpperCase() : root,
    found = true;
  for (const part of full.slice(root.length).split(path.sep).filter(Boolean)) {
    if (found && fs.existsSync(out) && fs.statSync(out).isDirectory()) {
      const list = fs.readdirSync(out);
      const hit =
        list.find((n) => n === part) ??
        list.find((n) => n.toLowerCase() === part.toLowerCase());
      found = hit !== undefined;
      out = path.join(out, hit ?? part);
    } else {
      found = false;
      out = path.join(out, part);
    }
  }
  return out;
}

// ---- path matching ----
// One regex per written form of a path. The separator is captured, so the new path is written the same way.
// After the path comes the end, a separator, a quote, a space or another character no name ends on, or a full
// stop that ends a sentence: "fam-port" never matches "fam-portal", "fam-port_worktrees" or "fam-port.bak".
const AFTER = "(?=$|[\\\\/\"'`\\s<>)\\]},;:|&]|\\.(?:\\s|$))";
const BEFORE = "(?<![A-Za-z0-9])";
// A space or a punctuation mark after the path ends it only when the longer name is not a real neighbour: with a
// folder "fam-port - Copy" or "fam-port (2)" beside it, "C:\P\fam-port - Copy\x" names that folder, not the project.
// The tails are those neighbours' names past the path's own name, lower case, read once before the move.
function neighbourTails(p) {
  const dir = path.dirname(p),
    base = path.basename(p).toLowerCase();
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .map((n) => n.toLowerCase())
    .filter(
      (n) =>
        n.length > base.length &&
        n.startsWith(base) &&
        new RegExp(`^${AFTER}`).test(n.slice(base.length)),
    )
    .map((n) => n.slice(base.length));
}
// true when the text right after a match goes on into a neighbour's name
const intoNeighbour = (tails, rest) => {
  const r = rest.toLowerCase();
  return tails.some(
    (x) => r.startsWith(x) && !/[A-Za-z0-9]/.test(r[x.length] ?? ""),
  );
};
function pathForms(from, to) {
  const a = path
      .resolve(from)
      .split(/[\\/]+/)
      .filter(Boolean),
    b = path
      .resolve(to)
      .split(/[\\/]+/)
      .filter(Boolean),
    tails = neighbourTails(path.resolve(from));
  const forms = [
    {
      re: new RegExp(
        `${BEFORE}${esc(a[0])}(\\\\\\\\|\\\\|/)${a
          .slice(1)
          .map(esc)
          .join("(?:\\\\\\\\|\\\\|/)")}${AFTER}`,
        "gi",
      ),
      to: (sep) => [b[0], ...b.slice(1)].join(sep),
      tails,
    },
  ];
  // Git Bash's form /c/x
  if (/^[A-Za-z]:$/.test(a[0]) && /^[A-Za-z]:$/.test(b[0]))
    forms.push({
      re: new RegExp(
        `(?<![\\w.~])/${a[0][0]}/${a.slice(1).map(esc).join("/")}()${AFTER}`,
        "gi",
      ),
      to: () => `/${b[0][0].toLowerCase()}/${b.slice(1).join("/")}`,
      tails,
    });
  // the Claude Code history folder's name, as memory files write it
  if (slug(path.resolve(from)) !== slug(path.resolve(to)))
    forms.push(slugForm(slug(path.resolve(from)), slug(path.resolve(to))));
  return forms;
}
// a history folder's name, renamed: matched in any case, as Claude Code may have filed it under a typed case
const slugForm = (from, to) => ({
  re: new RegExp(`(?<![A-Za-z0-9-])${esc(from)}()(?![A-Za-z0-9-])`, "gi"),
  to: () => to,
  tails: [],
});
// A rewriter for every (from, to) pair of the move and every renamed history folder (slugPairs): text in, text out.
function rewriter(pairs, slugPairs = []) {
  const forms = [
    ...pairs.flatMap(([f, t]) => pathForms(f, t)),
    ...slugPairs.map(([f, t]) => slugForm(f, t)),
  ];
  return (text) =>
    forms.reduce(
      (s, f) =>
        s.replace(f.re, (match, sep, offset, whole) =>
          intoNeighbour(f.tails, whole.slice(offset + match.length))
            ? match
            : f.to(sep),
        ),
      text,
    );
}
const names = (pairs) => {
  const forms = pairs.flatMap(([f, t]) => pathForms(f, t));
  return (text) =>
    forms.some((f) =>
      [...text.matchAll(f.re)].some(
        (h) => !intoNeighbour(f.tails, text.slice(h.index + h[0].length)),
      ),
    );
};

// ---- outside programs ----
function run(cmd, cmdArgs, what) {
  const r = spawnSync(cmd, cmdArgs, {
    encoding: "buffer",
    windowsHide: true,
    maxBuffer: 1 << 28,
  });
  if (r.error) throw new Error(`${what}: ${r.error.message}`);
  const out = decode(r.stdout),
    err = decode(r.stderr);
  if (r.status !== 0)
    throw new Error(`${what} exited ${r.status}: ${(err || out).trim()}`);
  return out;
}
// schtasks writes UTF-16 to a file and may to a pipe: read either
function decode(b) {
  if (!b?.length) return "";
  if (b[0] === 0xff && b[1] === 0xfe) return b.subarray(2).toString("utf16le");
  if (b.length > 1 && b[1] === 0 && b[0] !== 0) return b.toString("utf16le");
  return b.toString("utf8").replace(/^\uFEFF/, "");
}
const git = (cwd, ...a) => run("git", ["-C", cwd, ...a], `git ${a.join(" ")}`);
function schtasks(...a) {
  const fake = process.env.MOVE_PROJECT_SCHTASKS;
  return fake
    ? run(process.execPath, [fake, ...a], `schtasks ${a.join(" ")}`)
    : run("schtasks", a, `schtasks ${a.join(" ")}`);
}
function nimbalystRunning() {
  const v = process.env.MOVE_PROJECT_RUNNING;
  if (v === "1") return true;
  if (v === "0") return false;
  // @<file>: the answers in the file, one per check by any process, the last one kept (tests of a close and a start)
  if (v?.startsWith("@")) {
    const f = v.slice(1),
      answers = fs.readFileSync(f, "utf8").trim().split(/\s+/);
    if (answers.length > 1) fs.writeFileSync(f, answers.slice(1).join(" "));
    return answers[0] === "1";
  }
  const out = run(
    "tasklist",
    ["/fi", "imagename eq Nimbalyst.exe", "/fo", "csv", "/nh"],
    "tasklist",
  );
  return /"Nimbalyst\.exe"/i.test(out);
}

// ---- scheduled tasks ----
// Every task as { name, xml }. The fake answers `schtasks /query /xml` (each task follows a <!-- \name -->
// comment). The real schtasks writes that through the console code page (437 here), which turns any other
// character into "?" or U+FFFD, and the task would be written back so; the Task Scheduler's own interface, through
// PowerShell, gives each task's XML whole, written to a UTF-8 file.
const TASKS_PS = (file) => `$ErrorActionPreference = 'Stop'
$s = New-Object -ComObject Schedule.Service
$s.Connect()
$out = New-Object System.Collections.Generic.List[object]
function Walk($f) {
  foreach ($t in $f.GetTasks(1)) { $out.Add([pscustomobject]@{ name = $t.Path; xml = $t.Xml }) }
  foreach ($c in $f.GetFolders(0)) { Walk $c }
}
Walk ($s.GetFolder('\\'))
[IO.File]::WriteAllText('${file.replace(/'/g, "''")}', (ConvertTo-Json -InputObject $out.ToArray() -Compress -Depth 3), (New-Object System.Text.UTF8Encoding $false))`;
function allTasks() {
  if (process.env.MOVE_PROJECT_SCHTASKS) {
    const out = schtasks("/query", "/xml");
    return [
      ...out.matchAll(/<!--\s*(\\[^>]*?)\s*-->\s*([\s\S]*?<\/Task>)/g),
    ].map((m) => ({ name: m[1], xml: m[2] }));
  }
  const file = path.join(
    os.tmpdir(),
    `move-project-tasks-${process.pid}-${Date.now()}.json`,
  );
  try {
    run(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-EncodedCommand",
        Buffer.from(TASKS_PS(file), "utf16le").toString("base64"),
      ],
      "reading the scheduled tasks (PowerShell, Schedule.Service)",
    );
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } finally {
    fs.rmSync(file, { force: true });
  }
}
// one task's definition as it is now
function taskXmlNow(name) {
  if (process.env.MOVE_PROJECT_SCHTASKS)
    return schtasks("/query", "/tn", name, "/xml");
  const t = allTasks().find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (!t) throw new Error(`the scheduled task "${name}" is gone`);
  return t.xml;
}
const tag = (xml, t) =>
  [...xml.matchAll(new RegExp(`<${t}>([^<]*)</${t}>`, "g"))].map((m) => m[1]);
const taskLine = (t) =>
  `"${t.name.replace(/^\\/, "")}": runs ${[...tag(t.xml, "Command"), ...tag(t.xml, "Arguments")].join(" ")}${tag(t.xml, "WorkingDirectory").length ? `, starts in ${tag(t.xml, "WorkingDirectory").join(" ")}` : ""}`;

// The account this runs as (whoami: its name and SID) and whether it runs elevated (the High or System mandatory
// level). Git Bash has its own whoami, so Windows' is named by its full path.
let account;
function who() {
  if (account) return account;
  if (!process.env.SystemRoot)
    throw new Error("SystemRoot is not set, so whoami.exe cannot be found");
  const exe = path.join(process.env.SystemRoot, "System32", "whoami.exe");
  const user = run(exe, ["/user", "/fo", "csv", "/nh"], "whoami /user")
    .trim()
    .match(/^"([^"]*)","([^"]*)"/);
  if (!user) throw new Error("whoami /user gave no name and SID");
  const groups = run(exe, ["/groups", "/fo", "csv", "/nh"], "whoami /groups");
  account = {
    name: user[1].toLowerCase(),
    sid: user[2].toLowerCase(),
    elevated: /"S-1-16-(12288|16384)"/.test(groups),
  };
  return account;
}
// Why `schtasks /create /xml /f` could not make this task again as it is, or null when it can.
function cannotRecreate(xml) {
  if (xml.includes("�"))
    return "its definition was read with characters lost (U+FFFD); written back, it would keep the damage";
  if (tag(xml, "LogonType").includes("Password"))
    return "it runs whether the user is logged on or not, with a stored password, and schtasks /create /xml cannot create it again without that password";
  const ids = tag(xml, "UserId");
  if (ids.length) {
    const me = who();
    const other = ids.find((id) => {
      const i = id.toLowerCase();
      return i !== me.sid && i !== me.name && i !== me.name.split("\\").pop();
    });
    if (other)
      return `it runs as another account (${other}), and creating it again needs that account`;
  }
  if (tag(xml, "RunLevel").includes("HighestAvailable") && !who().elevated)
    return "it runs with highest privileges, and creating it again needs a terminal opened with Run as administrator";
  return null;
}
// The task's full definition, rewritten, created again under the same name.
function rewriteTask(name, rewrite) {
  const now = taskXmlNow(name),
    why = cannotRecreate(now);
  if (why)
    throw new Error(
      `the scheduled task "${name}" cannot be created again: ${why}`,
    );
  const xml = rewrite(now);
  const file = path.join(
    os.tmpdir(),
    `move-project-task-${process.pid}-${Date.now()}.xml`,
  );
  fs.writeFileSync(
    file,
    Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(xml, "utf16le")]),
  );
  try {
    schtasks("/create", "/tn", name, "/xml", file, "/f");
  } finally {
    fs.rmSync(file, { force: true });
  }
}

// ---- --tasks <path> ----
if (args.includes("--tasks")) {
  const p = flagValue("--tasks");
  if (!p) {
    console.log("move-project refused: --tasks needs a path.");
    process.exit(1);
  }
  const full = path.resolve(p);
  try {
    const hit = names([[full, full]]);
    const found = allTasks().filter((t) => hit(t.xml));
    if (!found.length) console.log(`no scheduled task names ${full}`);
    else {
      console.log(`scheduled tasks naming ${full}:`);
      for (const t of found) console.log(`  ${taskLine(t)}`);
    }
  } catch (e) {
    console.log(`move-project refused: ${e.message}`);
    process.exit(1);
  }
  process.exit(0);
}

// ---- the places a move fixes ----
// Each place gives a list of changes { say, apply }, worked out before anything is touched: --dry prints the
// `say` lines, a real move runs `apply` in order.

// ---- Nimbalyst's records ----
// Nimbalyst's data folder holds app-settings.json, workspace-settings.json and sqlite-db\nimbalyst.sqlite. The
// running app holds all three, so they are changed only with it closed (m.write); a dry run or a queued move reads.
function nimbalystData() {
  if (process.env.MOVE_PROJECT_NIMBALYST_DATA)
    return path.resolve(process.env.MOVE_PROJECT_NIMBALYST_DATA);
  if (!process.env.APPDATA)
    throw new Refused(
      "APPDATA is not set, so Nimbalyst's data folder is unknown.",
    );
  return path.join(process.env.APPDATA, "@nimbalyst", "electron");
}
// workspace-settings.json keys a workspace "ws:" + base64 of its path (UTF-8), without the "=" padding
const wsKey = (p) =>
  "ws:" + Buffer.from(p, "utf8").toString("base64").replace(/=+$/, "");
function rewriteKey(k, m) {
  if (k.startsWith("ws:")) {
    const p = Buffer.from(k.slice(3), "base64").toString("utf8");
    if (wsKey(p) === k) {
      const n = m.rewrite(p);
      return n === p ? k : wsKey(n);
    }
  }
  return m.rewrite(k);
}
// Every string and key of a JSON value, rewritten; an entry { path, name } whose name was the old folder's name
// gets the new one. Two keys that would end the same call `stop`. Gives { value, changed } (strings and keys).
function rewriteJson(v, m, stop, where) {
  let changed = 0;
  const walk = (x, at) => {
    if (typeof x === "string") {
      const n = m.rewrite(x);
      if (n !== x) changed++;
      return n;
    }
    if (Array.isArray(x)) return x.map((y, i) => walk(y, `${at}[${i}]`));
    if (!x || typeof x !== "object") return x;
    // no prototype: a key such as "constructor" or "__proto__" is a plain entry like any other
    const out = Object.create(null),
      from = new Map();
    for (const k of Object.keys(x)) {
      const nk = rewriteKey(k, m);
      if (Object.hasOwn(out, nk))
        stop(
          `${where}${at} has the entries ${from.get(nk)} and ${k}, which would both become ${nk}, and one would be lost. Merge them by hand (Nimbalyst closed), then run again.`,
        );
      if (nk !== k) changed++;
      out[nk] = walk(x[k], `${at}.${k}`);
      from.set(nk, k);
    }
    if (
      typeof x.path === "string" &&
      typeof x.name === "string" &&
      out.path !== x.path &&
      x.name.toLowerCase() === path.win32.basename(x.path).toLowerCase()
    ) {
      out.name = path.win32.basename(out.path);
      changed++;
    }
    return out;
  };
  return { value: walk(v, ""), changed };
}
// A JSON file read with its layout (the indent of its first key, its last newline), so it is written back alike.
function readJsonFile(f, stop) {
  const text = fs.readFileSync(f, "utf8").replace(/^﻿/, "");
  try {
    return {
      value: JSON.parse(text),
      indent: text.match(/^[{[]\r?\n([ \t]+)/)?.[1] ?? "",
      end: text.match(/\r?\n$/)?.[0] ?? "",
      eol: text.includes("\r\n") ? "\r\n" : "\n",
    };
  } catch (e) {
    stop(`${f} is not valid JSON (${e.message}); it was left as it is.`);
  }
}
function nimbalystJsonPlace(file) {
  return (m) => {
    const f = path.join(m.nim, file);
    if (!fs.existsSync(f)) return [];
    const { changed } = rewriteJson(
      readJsonFile(f, refuse).value,
      m,
      refuse,
      f,
    );
    if (!changed) return [];
    return [
      {
        say: `Nimbalyst: ${f}: ${changed} value${changed > 1 ? "s" : ""} or key${changed > 1 ? "s" : ""} name the new place`,
        // read again right before the write
        apply: () => {
          const stop = (why) => {
            throw new Error(why);
          };
          const r = readJsonFile(f, stop),
            n = rewriteJson(r.value, m, stop, f);
          if (!n.changed) return;
          const text = JSON.stringify(n.value, null, r.indent).replace(
            /\n/g,
            r.eol,
          );
          JSON.parse(text);
          writeSafely(f, text + r.end);
        },
      },
    ];
  };
}

// Nimbalyst's database (SQLite, WAL mode). The path columns are found in the schema, not listed: a text column
// named workspace, workspace_id, path or <something>_path. collab_local_origins keeps a hash of the path
// (workspace_path_hash) and is left alone. Each distinct old value is rewritten as text by m.rewrite, so a file path
// inside the project and a history folder's name (external_session_cursors.file_path) follow too.
// The values are found with one query per column: a LIKE prefilter on the words any changed value holds, then
// m.rewrite in JS decides. LIKE ignores case for ASCII letters only, so every other character of a word is "_"
// (any one character) in the prefilter: a folder named in Cyrillic capitals is still found in any case.
// A real move (m.write) opens the database for writing in the plan, starts one transaction and rewrites each column
// with one UPDATE through a temporary table of old -> new values: a unique key the new values would break refuses
// the move before anything is touched, and the change itself is the COMMIT. Until then any stop rolls it back. A
// dry run or a queued move reads only, and checks the unique keys made of plain columns itself; one on an
// expression is checked by the transaction when the move runs.
const PATH_COLUMN = /^(workspace(_id|_path)?|path|\w+_path)$/i;
const NOT_PATHS = new Set(["collab_local_origins"]);
const qi = (n) => `"${n.replace(/"/g, '""')}"`;
const likeEsc = (s) => s.replace(/[\^%_]/g, "^$&");
const likeWord = (s) =>
  // biome-ignore lint/suspicious/noControlCharactersInRegex: the range \x00-\x7f means "any ASCII character", on purpose
  `%${[...s].map((ch) => (/[\x00-\x7f]/.test(ch) ? likeEsc(ch) : "_")).join("")}%`;
function dbPlace(m) {
  const f = path.join(m.nim, "sqlite-db", "nimbalyst.sqlite");
  if (!fs.existsSync(f)) return [];
  const sqlite = process.getBuiltinModule?.("node:sqlite");
  if (!sqlite)
    refuse(
      `Node.js ${process.version} has no node:sqlite, which fixing Nimbalyst's database needs: install Node.js 22.5 or newer.`,
    );
  const db = new sqlite.DatabaseSync(f, { readOnly: !m.write });
  let open = true,
    inTx = false;
  const close = () => {
    if (!open) return;
    try {
      if (inTx) db.exec("ROLLBACK");
    } finally {
      open = false;
      db.close();
    }
  };
  m.cleanup.push(close);
  db.exec("PRAGMA busy_timeout = 5000");
  // the text that any changed value holds: the old folders' names and the renamed history folders' names
  const likes = [
    ...new Set(
      [
        ...m.pairs.flatMap(([from]) => [
          path.basename(from),
          slug(path.basename(from)),
        ]),
        ...m.renamed.map(([n]) => n),
      ].map(likeWord),
    ),
  ];
  const where = (c) =>
    likes.map(() => `${qi(c)} LIKE ? ESCAPE '^'`).join(" OR ");
  const tables = db
    .prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    )
    .all()
    .map((t) => t.name)
    .filter((t) => !NOT_PATHS.has(t));
  const changes = [],
    exprKeys = new Set();
  for (const t of tables) {
    const cols = db
      .prepare(`PRAGMA table_info(${qi(t)})`)
      .all()
      .filter(
        (c) =>
          PATH_COLUMN.test(c.name) &&
          (c.type === "" || /TEXT|CHAR|CLOB/i.test(c.type)),
      );
    // column -> Map(old value -> new value)
    const changed = new Map();
    for (const c of cols) {
      const found = db
        .prepare(
          `SELECT ${qi(c.name)} AS v, count(*) AS n FROM ${qi(t)} WHERE ${where(c.name)} GROUP BY ${qi(c.name)} COLLATE BINARY`,
        )
        .all(...likes)
        .filter((r) => typeof r.v === "string" && m.rewrite(r.v) !== r.v);
      if (!found.length) continue;
      changed.set(c.name, new Map(found.map((r) => [r.v, m.rewrite(r.v)])));
      changes.push({
        t,
        c: c.name,
        values: found.map((r) => r.v),
        rows: found.reduce((s, r) => s + r.n, 0),
      });
    }
    if (changed.size && !m.write) checkUnique(db, t, changed, exprKeys);
  }
  if (!changes.length) {
    close();
    return [];
  }
  if (m.write) {
    db.exec("BEGIN IMMEDIATE");
    inTx = true;
    db.exec(
      "CREATE TEMP TABLE move_project_map (old TEXT PRIMARY KEY, new TEXT NOT NULL)",
    );
    const put = db.prepare(
      "INSERT OR IGNORE INTO temp.move_project_map VALUES (?, ?)",
    );
    for (const x of changes) for (const v of x.values) put.run(v, m.rewrite(v));
    for (const x of changes) {
      const col = `${qi(x.t)}.${qi(x.c)}`;
      try {
        x.rows = Number(
          db
            .prepare(
              `UPDATE ${qi(x.t)} SET ${qi(x.c)} = (SELECT new FROM temp.move_project_map WHERE old = ${col}) WHERE ${col} COLLATE BINARY IN (SELECT old FROM temp.move_project_map)`,
            )
            .run().changes,
        );
      } catch (e) {
        close();
        refuse(
          /constraint/i.test(e.message)
            ? `Nimbalyst's database: moving ${x.t}.${x.c} to the new place breaks a unique key (${e.message}): a record for the new place is already there. Nothing has changed.`
            : `Nimbalyst's database ${f} could not be changed (${e.message}); is Nimbalyst still running? Nothing has changed.`,
        );
      }
    }
  }
  const list = changes
    .map((x) => `${x.t}.${x.c} (${x.rows} row${x.rows > 1 ? "s" : ""})`)
    .join(", ");
  return [
    {
      say: `Nimbalyst database ${f}: ${list} name the new place, in one transaction${exprKeys.size ? `; the unique keys on an expression in ${[...exprKeys].join(", ")} are checked when the move runs` : ""}`,
      apply: () => {
        db.exec("COMMIT");
        inTx = false;
        close();
      },
    },
  ];
}
// The unique keys (and primary keys) of table t that hold a rewritten column (changed: column -> Map(old -> new)):
// after the change no two rows may share one. Each row that could share a key afterwards (it holds an old or a new
// value in a rewritten column of the key) gets its key as it will be, every rewritten column of it at once; a
// partial key counts only its own rows (its WHERE), a NOCASE or RTRIM column compares as SQLite does. A key on an
// expression goes to exprKeys.
function checkUnique(db, t, changed, exprKeys) {
  const fold = (v, coll) =>
    typeof v !== "string"
      ? v
      : /^nocase$/i.test(coll)
        ? v.replace(/[A-Z]/g, (ch) => ch.toLowerCase())
        : /^rtrim$/i.test(coll)
          ? v.replace(/ +$/, "")
          : v;
  for (const idx of db
    .prepare(`PRAGMA index_list(${qi(t)})`)
    .all()
    .filter((i) => i.unique)) {
    const parts = db
      .prepare(`PRAGMA index_xinfo(${qi(idx.name)})`)
      .all()
      .filter((p) => p.key);
    if (!parts.some((p) => changed.has(p.name))) continue;
    if (parts.some((p) => p.cid === -2)) {
      exprKeys.add(t);
      continue;
    }
    const moving = parts.filter((p) => changed.has(p.name)).map((p) => p.name);
    const partial = idx.partial
      ? db
          .prepare("SELECT sql FROM sqlite_master WHERE name = ?")
          .get(idx.name)
          ?.sql?.match(/\bWHERE\b([\s\S]*)$/i)?.[1]
      : null;
    const sql = `SELECT ${parts.map((p) => qi(p.name)).join(", ")} FROM ${qi(t)} WHERE (${moving.map((c) => `${qi(c)} IN (SELECT value FROM json_each(?))`).join(" OR ")})${partial ? ` AND (${partial})` : ""}`;
    const sets = moving.map((c) =>
      JSON.stringify([
        ...new Set([...changed.get(c).keys(), ...changed.get(c).values()]),
      ]),
    );
    const seen = new Map();
    for (const row of db.prepare(sql).all(...sets)) {
      const after = parts.map(
        (p) => changed.get(p.name)?.get(row[p.name]) ?? row[p.name],
      );
      if (after.some((v) => v === null)) continue;
      const k = JSON.stringify(after.map((v, i) => fold(v, parts[i].coll)));
      const show = (r) => `(${parts.map((p) => r[p.name]).join(", ")})`;
      if (seen.has(k))
        refuse(
          `Nimbalyst's database: two records of ${t} would get the same unique key ${idx.name} (${parts.map((p) => p.name).join(", ")}) after the move: ${show(seen.get(k))} and ${show(row)} both become (${after.join(", ")}). A record for the new place is already there. Merge or delete one in Nimbalyst, then run again.`,
        );
      seen.set(k, row);
    }
  }
}

const NIMBALYST_PLACES = [
  { name: "app-settings.json", plan: nimbalystJsonPlace("app-settings.json") },
  {
    name: "workspace-settings.json",
    plan: nimbalystJsonPlace("workspace-settings.json"),
  },
  { name: "database", plan: dbPlace },
];

// git: the worktrees as `git worktree list` names them before the move, and where each is after it.
function gitPlace(m) {
  const dotGit = path.join(m.from, ".git");
  if (!fs.existsSync(dotGit)) return [];
  if (!fs.statSync(dotGit).isDirectory())
    // the moved folder is itself a linked worktree: repair from it fixes the main repo's link to it
    return [
      {
        say: `git: ${m.to} is a linked worktree: git worktree repair fixes the main repo's link to it`,
        apply: () => git(m.to, "worktree", "repair"),
      },
    ];
  const list = git(m.from, "worktree", "list", "--porcelain");
  const wts = list
    .split(/\r?\n/)
    .filter((l) => l.startsWith("worktree "))
    .map((l) => path.resolve(l.slice(9)))
    .slice(1) // the first is the repo itself
    .filter((p) => fs.existsSync(p));
  if (!wts.length) return [];
  const after = wts.map((p) => {
    const pair = m.pairs.find(([f]) => inside(p, f));
    return pair ? path.join(pair[1], path.relative(pair[0], p)) : p;
  });
  return [
    {
      say: `git: worktree repair, links fixed both ways for ${wts.map((p, i) => (p === after[i] ? p : `${p} (now ${after[i]})`)).join(", ")}`,
      apply: () => git(m.to, "worktree", "repair", ...after),
    },
  ];
}

// The live text files under ~/.claude: its own top-level files, the folders it runs from and the projects' memory.
// Session logs, backups, caches and run logs are history and stay as they were; so is a hooks/state/<hook>/ folder
// whose hook is gone (no hooks/<hook>.mjs: the retired code-review-gate, context-guard ...), that hook's leftovers.
// A live hook's state keyed by a project's path (hooks/state/map-nudge/projects.json, map-drift/said.json) follows
// the project like any other text file.
const TEXT = /\.(md|mjs|cjs|js|json|py|txt|toml|ps1|sh|cmd|bat|vbs|ya?ml)$/i;
const SKIP = /^(node_modules|\.git|backups?|logs?|cache|setup-logs)$|\.bak/i;
const LIVE_DIRS = [
  ["hooks", 4],
  ["skills", 4],
  ["shared-skills", 4],
  ["agents", 4],
  ["commands", 4],
  ["rules", 4],
  ["workers", 4],
  ["output-styles", 2],
  ["tools", 4],
  ["usage-log", 3],
  ["plugins", 1],
];
function textFiles(p, depth) {
  if (!fs.existsSync(p) || SKIP.test(path.basename(p))) return [];
  const st = fs.statSync(p);
  if (st.isFile()) return TEXT.test(p) && st.size < 4e6 ? [p] : [];
  if (depth === 0) return [];
  return fs
    .readdirSync(p)
    .sort()
    .flatMap((n) => textFiles(path.join(p, n), depth - 1));
}
function leftover(m, f) {
  const state = path.join(m.claude, "hooks", "state");
  if (!inside(f, state)) return false;
  const [hook, ...rest] = path.relative(state, f).split(path.sep);
  return (
    rest.length > 0 &&
    !fs.existsSync(path.join(m.claude, "hooks", `${hook}.mjs`))
  );
}
function textPlace(m) {
  const projects = path.join(m.claude, "projects");
  const files = [
    ...(fs.existsSync(m.claude)
      ? fs
          .readdirSync(m.claude)
          .sort()
          .map((n) => path.join(m.claude, n))
          .filter((f) => {
            const st = fs.statSync(f);
            return st.isFile() && TEXT.test(f) && st.size < 4e6;
          })
      : []),
    ...LIVE_DIRS.flatMap(([d, depth]) =>
      textFiles(path.join(m.claude, d), depth),
    ).filter((f) => !leftover(m, f)),
    ...(fs.existsSync(projects)
      ? fs
          .readdirSync(projects)
          .sort()
          .flatMap((n) => textFiles(path.join(projects, n, "memory"), 2))
      : []),
  ];
  return files
    .filter((f) => {
      const t = readText(f, m.ascii).text;
      return m.rewrite(t) !== t;
    })
    .map((f) =>
      readText(f, m.ascii).encode
        ? {
            say: `text: ${f} names the old place`,
            // read again at apply time, so a change made since the plan is kept
            apply: () => {
              const r = readText(f, m.ascii),
                n = m.rewrite(r.text);
              if (n !== r.text) writeSafely(f, r.encode(n));
            },
            file: f,
          }
        : {
            say: `text: ${f} names the old place, but it is not UTF-8 and the new place is not plain ASCII: not fixed, edit it by hand`,
            apply: () => {},
            file: f,
          },
    );
}
// A text file in its own encoding: { text, encode } where encode(text) gives the bytes to write back the same way.
// UTF-8 (a BOM kept), UTF-16 with its BOM, else a one-byte code page (cp1251, cp437 ...): read byte for byte as
// latin1, and written back so only when every path of the move is plain ASCII (encode null otherwise).
const UTF8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
function readText(f, ascii) {
  const b = fs.readFileSync(f);
  if (b[0] === 0xff && b[1] === 0xfe)
    return {
      text: b.subarray(2).toString("utf16le"),
      encode: (t) =>
        Buffer.concat([b.subarray(0, 2), Buffer.from(t, "utf16le")]),
    };
  try {
    return { text: UTF8.decode(b), encode: (t) => Buffer.from(t, "utf8") };
  } catch {
    return {
      text: b.toString("latin1"),
      encode: ascii ? (t) => Buffer.from(t, "latin1") : null,
    };
  }
}
// a whole new file next to the old one, then a rename over it: a stop midway leaves the old file whole
function writeSafely(f, text) {
  const tmp = `${f}.move-project-${process.pid}.tmp`;
  fs.writeFileSync(tmp, text);
  fs.renameSync(tmp, f);
}

// ~/.claude.json: the `projects` entries (keyed by forward-slash path) and any other value naming the place.
function claudeJsonPlace(m) {
  const f = path.join(m.home, ".claude.json");
  if (!fs.existsSync(f)) return [];
  const t = fs.readFileSync(f, "utf8");
  if (m.rewrite(t) === t) return [];
  const moved = movedKeys(f, t, m, refuse);
  return [
    {
      say: `${f}: ${moved.length ? `the projects entr${moved.length > 1 ? "ies" : "y"} ${moved.join(", ")} keyed by the new place` : "values name the new place"}`,
      // read again right before the write: an open Claude Code session may have written it since the plan
      apply: () => {
        const now = fs.readFileSync(f, "utf8"),
          n = m.rewrite(now);
        movedKeys(f, now, m, (why) => {
          throw new Error(why);
        });
        JSON.parse(n); // never write a broken .claude.json
        if (n !== now) writeSafely(f, n);
      },
    },
  ];
}
// The `projects` keys the move renames. Two keys that would end the same (C:/P/x and c:/p/x both become C:/P/y), or
// one that would land on a key already there, would lose an entry: `stop` is called with why.
function movedKeys(f, text, m, stop) {
  const projects = Object.keys(JSON.parse(text).projects ?? {});
  const moved = projects.filter((k) => m.rewrite(k) !== k);
  for (const k of moved) {
    const same = moved.filter((o) => o !== k && m.rewrite(o) === m.rewrite(k));
    if (same.length)
      stop(
        `${f} has the projects entries ${[k, ...same].join(" and ")}, which differ only in case: both would become ${m.rewrite(k)}, and one would be lost. Merge them by hand into one entry (Claude Code closed), then run again.`,
      );
  }
  const clash = moved.find((k) =>
    projects.some(
      (o) =>
        !moved.includes(o) &&
        fwd(o).toLowerCase() === fwd(m.rewrite(k)).toLowerCase(),
    ),
  );
  if (clash)
    stop(
      `${f} already has a projects entry for ${m.rewrite(clash)}; the entry for ${clash} would replace it.`,
    );
  return moved;
}

// The Claude Code history folders: ~/.claude/projects/<slug of the place> and those of folders inside it. A folder
// whose name only starts like the slug is read for the `cwd` its sessions name, so a sister project's stays.
function cwdOf(dir) {
  for (const n of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl"))) {
    const fd = fs.openSync(path.join(dir, n), "r");
    try {
      const b = Buffer.alloc(65536);
      const s = b
        .subarray(0, fs.readSync(fd, b, 0, b.length, 0))
        .toString("utf8");
      const c = s.match(/"cwd"\s*:\s*("(?:[^"\\]|\\.)*")/);
      if (c) return JSON.parse(c[1]);
    } finally {
      fs.closeSync(fd);
    }
  }
  return null;
}
// Names are compared ignoring case: Claude Code files the history under the cwd as it was typed. Gives the changes
// and the renamed folders' names ([old, new]), which the text rewrite then fixes in memory files as well.
function historyPlace(m) {
  const projects = path.join(m.claude, "projects");
  if (!fs.existsSync(projects)) return { changes: [], renamed: [] };
  const out = [],
    renamed = [];
  const is = (a, b) => a.toLowerCase() === b.toLowerCase();
  for (const n of fs.readdirSync(projects).sort()) {
    const dir = path.join(projects, n);
    if (!fs.statSync(dir).isDirectory()) continue;
    let target = null,
      unread = false;
    for (const [f, t] of m.pairs) {
      if (is(n, slug(f))) target = slug(t);
      else if (n.toLowerCase().startsWith(slug(f).toLowerCase() + "-")) {
        const cwd = cwdOf(dir);
        if (!cwd) unread = true;
        else if (inside(path.resolve(cwd), f) && is(slug(path.resolve(cwd)), n))
          target = slug(path.join(t, path.relative(f, path.resolve(cwd))));
      }
      if (target) break;
    }
    if (!target) {
      if (unread)
        out.push({
          say: `Claude Code history: ${dir} starts like the project's history folder, but no session in it says which folder it belongs to: left as it is, check it by hand`,
          apply: () => {},
        });
      continue;
    }
    if (target === n) {
      out.push({
        say: `Claude Code history: ${dir} keeps its name (the new place has the same folder name)`,
        apply: () => {},
      });
      continue;
    }
    const to = path.join(projects, target);
    // the same folder in another case is not "already there"
    if (fs.existsSync(to) && !is(target, n))
      refuse(
        `the Claude Code history folder ${to} already exists; ${dir} cannot become it.`,
      );
    renamed.push([n, target]);
    out.push({
      say: `Claude Code history: ${dir} becomes ${to}`,
      apply: () => fs.renameSync(dir, to),
    });
  }
  return { changes: out, renamed };
}

// The scheduled tasks naming the place (in Task To Run or Start In): created again naming the new place. One that
// schtasks could not create again as it is refuses the whole move, before anything is touched.
function tasksPlace(m) {
  const hit = names(m.pairs);
  const found = allTasks().filter((t) => hit(t.xml));
  for (const t of found) {
    const why = cannotRecreate(t.xml);
    if (why)
      refuse(
        `the scheduled task "${t.name.replace(/^\\/, "")}" names the project, but ${why}. Change its paths by hand in Task Scheduler (or make it a task this tool can create again), then run again.`,
      );
  }
  return found.map((t) => ({
    say: `scheduled task ${taskLine(t)}`,
    apply: () => rewriteTask(t.name, m.rewrite),
  }));
}

// ---- the queue: moves asked for while Nimbalyst ran, carried out when it closes ----
// <deliver data>\moves.json { moves: [{ from, to, at }], refused?: [{ from, to, at, when, exit, why }] }, in the
// data folder of tools/nimbalyst-patch/deliver.mjs, whose --after-quit (started by the patched app's quit listener)
// and --install-now run --run-queued. `refused` keeps the queued moves that were refused or failed when they ran,
// so deliver.mjs --status says them; a record goes when that project is queued again or moved.
// Every read-change-write of moves.json holds moves.json.lock (made only when it is not there); a lock whose
// process is gone, or older than a minute, is stale and taken over.
const SELF = fileURLToPath(import.meta.url);
const DELIVER = path.join(
  path.dirname(SELF),
  "..",
  "..",
  "tools",
  "nimbalyst-patch",
  "deliver.mjs",
);
const deliver = () => import(pathToFileURL(DELIVER).href);
const NODE_ARGS = ["--disable-warning=ExperimentalWarning"];
// the start of the refusal a move gives while Nimbalyst runs: --run-queued puts such a move back in the queue
const NIMBALYST_OPEN = "Nimbalyst is running (open)";
const LOCK_WAIT_MS = 10 * 1000,
  LOCK_STALE_MS = 60 * 1000;
const sameCase = (a, b) => a.toLowerCase() === b.toLowerCase();
async function movesFile() {
  return path.join((await deliver()).dataDir(), "moves.json");
}
function readQueue(f) {
  if (!fs.existsSync(f)) return { moves: [], refused: [] };
  let q;
  try {
    q = JSON.parse(fs.readFileSync(f, "utf8"));
  } catch (e) {
    throw new Refused(
      `${f} is not valid JSON (${e.message}): fix or delete it, then run again.`,
    );
  }
  if (!Array.isArray(q?.moves))
    throw new Refused(
      `${f} has no "moves" list: fix or delete it, then run again.`,
    );
  if (q.refused !== undefined && !Array.isArray(q.refused))
    throw new Refused(
      `${f}: its "refused" entry is not a list: fix or delete it, then run again.`,
    );
  return { moves: q.moves, refused: q.refused ?? [] };
}
function writeQueue(f, q) {
  if (!q.moves.length && !q.refused.length)
    return fs.rmSync(f, { force: true });
  fs.mkdirSync(path.dirname(f), { recursive: true });
  writeSafely(
    f,
    JSON.stringify(
      { moves: q.moves, ...(q.refused.length ? { refused: q.refused } : {}) },
      null,
      2,
    ) + "\n",
  );
}
const pause = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
// Reads the queue, lets change(q) change it in place, writes it back; all under moves.json.lock. Gives change's result.
function changeQueue(f, change) {
  const lock = `${f}.lock`,
    end = Date.now() + LOCK_WAIT_MS;
  fs.mkdirSync(path.dirname(f), { recursive: true });
  for (;;) {
    try {
      fs.writeFileSync(
        lock,
        JSON.stringify({ pid: process.pid, at: new Date().toISOString() }),
        { flag: "wx" },
      );
      break;
    } catch (e) {
      if (e.code !== "EEXIST")
        throw new Refused(
          `the queue's lock ${lock} cannot be made (${e.code ?? e.message}).`,
        );
    }
    let held = null,
      age = 0;
    try {
      age = Date.now() - fs.statSync(lock).mtimeMs;
      held = JSON.parse(fs.readFileSync(lock, "utf8"));
    } catch {}
    if (age > LOCK_STALE_MS || (held?.pid && !alive(held.pid))) {
      fs.rmSync(lock, { force: true });
      continue;
    }
    if (Date.now() >= end)
      throw new Refused(
        `${lock} is held by process ${held?.pid ?? "?"} since ${held?.at ?? "?"}: another move-project run is changing the queue. Run again when it has ended.`,
      );
    pause(50);
  }
  try {
    const q = readQueue(f);
    const result = change(q);
    writeQueue(f, q);
    return result;
  } finally {
    fs.rmSync(lock, { force: true });
  }
}
// a refused record of this project goes: it is queued again, or it has been moved
async function forgetRefused(from) {
  const f = await movesFile();
  if (!fs.existsSync(f)) return;
  changeQueue(f, (q) => {
    q.refused = q.refused.filter((x) => !sameCase(x.from, from));
  });
}

// --run-queued: every queued move, in order, each by a run of this script (home from USERPROFILE). Before each move
// Nimbalyst is checked: running, it keeps that move and the rest. A move leaves the queue before it starts, so a
// stop midway never starts it twice. One refused because Nimbalyst opened goes back to the head of the queue; one
// refused for any other reason, or failed, goes to `refused` and is said here (deliver.mjs writes it to deliver.log).
if (args.includes("--run-queued")) {
  let code = 0;
  try {
    if (args.length !== 1) refuse("--run-queued takes no other argument.");
    if (!isWin) refuse("move-project is Windows only.");
    const f = await movesFile();
    if (!readQueue(f).moves.length) {
      console.log("move-project --run-queued: no move is queued");
      process.exit(0);
    }
    for (;;) {
      const left = readQueue(f).moves.length;
      if (!left) break;
      if (nimbalystRunning()) {
        console.log(
          `move-project refused: Nimbalyst is running, so the ${left} queued move${left > 1 ? "s" : ""} wait in ${f} for it to close.`,
        );
        code = Math.max(code, 1);
        break;
      }
      const mv = changeQueue(f, (q) => q.moves.shift());
      if (!mv) break;
      console.log(`queued move (asked ${mv.at}): ${mv.from} -> ${mv.to}`);
      const r = spawnSync(
        process.execPath,
        [...NODE_ARGS, SELF, mv.from, mv.to],
        {
          encoding: "utf8",
          windowsHide: true,
        },
      );
      const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
      process.stdout.write(out);
      if (r.error)
        console.log(`move-project could not run: ${r.error.message}`);
      const status = r.error ? 2 : (r.status ?? 2);
      code = Math.max(code, status);
      if (status === 0) continue;
      if (
        status === 1 &&
        out.includes(`move-project refused: ${NIMBALYST_OPEN}`)
      ) {
        changeQueue(f, (q) => {
          q.moves.unshift(mv);
        });
        console.log(
          `Nimbalyst opened: ${mv.from} -> ${mv.to} and the moves after it wait in ${f} for its next close.`,
        );
        break;
      }
      const why =
        out
          .split(/\r?\n/)
          .find((l) => /^move-project (refused|failed)/.test(l)) ??
        (r.error
          ? `move-project could not run: ${r.error.message}`
          : out.trim().split(/\r?\n/).at(-1) || `exit ${status}`);
      changeQueue(f, (q) => {
        q.refused.push({
          ...mv,
          when: new Date().toISOString(),
          exit: status,
          why: why.slice(0, 600),
        });
      });
      console.log(
        `${mv.from} -> ${mv.to} is not tried again; it is kept under "refused" in ${f} until it is queued again or moved.`,
      );
    }
  } catch (e) {
    console.log(`move-project refused: ${e.message}`);
    process.exit(1);
  }
  process.exit(code);
}

// ---- the move ----
const DRY = args.includes("--dry");
const QUEUE = args.includes("--queue");
const homeArg = flagValue("--home");
const positional = args.filter(
  (a, i) => !a.startsWith("--") && args[i - 1] !== "--home",
);
const unknown = args.filter(
  (a) => a.startsWith("--") && !["--dry", "--queue", "--home"].includes(a),
);

function plan(write) {
  if (!isWin) refuse("move-project is Windows only.");
  if (unknown.length) refuse(`unknown option ${unknown.join(" ")}.`);
  if (homeArg === null) refuse("--home needs a folder.");
  if (positional.length !== 2)
    refuse(
      "usage: move-project.mjs <from> <to> [--dry] [--queue] [--home <folder>], or --run-queued, or --tasks <path>.",
    );
  const home = homeArg ? path.resolve(homeArg) : process.env.USERPROFILE;
  if (!home)
    refuse(
      "USERPROFILE is not set, so the home folder is unknown; give --home.",
    );
  // spelt as the disk spells them: the history folder's name and the keys follow the real case
  const from = realCase(positional[0]),
    to = realCase(positional[1]);
  if (!fs.existsSync(from) || !fs.statSync(from).isDirectory())
    refuse(`${from} is not a folder.`);
  if (fs.existsSync(to))
    refuse(`${to} already exists: pick a target that does not exist.`);
  if (inside(to, from)) refuse(`${to} is inside ${from}.`);
  if (path.parse(from).root.toLowerCase() !== path.parse(to).root.toLowerCase())
    refuse(
      `${from} and ${to} are on different drives: a move here only renames within one drive.`,
    );
  if (inside(process.cwd(), from))
    refuse(`this command runs inside ${from}; run it from another folder.`);
  // the sibling <name>_worktrees goes with it, to <to>_worktrees
  const pairs = [[from, to]];
  const wtFrom = `${from}_worktrees`,
    wtTo = `${to}_worktrees`;
  if (fs.existsSync(wtFrom)) {
    if (fs.existsSync(wtTo))
      refuse(`${wtTo} already exists, so ${wtFrom} cannot go there.`);
    pairs.push([wtFrom, wtTo]);
  }
  const m = {
    from,
    to,
    pairs,
    home,
    claude: path.join(home, ".claude"),
    // a one-byte code page file can be rewritten byte for byte only when every path is plain ASCII
    ascii: pairs.flat().every((p) => /^[\x20-\x7e]*$/.test(p)),
    nim: nimbalystData(),
    // Nimbalyst closed and a real move: its records are opened for writing
    write,
    cleanup: cleanups,
  };
  // the history folders first: their new names are rewritten in the memory files too
  const history = historyPlace(m);
  m.renamed = history.renamed;
  m.rewrite = rewriter(pairs, history.renamed);
  const text = textPlace(m),
    claudeJson = claudeJsonPlace(m),
    tasks = tasksPlace(m);
  // Nimbalyst's last: a real move's database transaction starts there and is held until the move is done
  const nimbalyst = NIMBALYST_PLACES.map((p) => ({
    name: p.name,
    changes: p.plan(m),
  }));
  const places = [
    {
      name: "folder",
      changes: pairs.map(([f, t]) => ({ say: `folder: ${f} moves to ${t}` })),
    },
    { name: "git", changes: gitPlace(m) },
    ...nimbalyst,
    { name: "text", changes: text },
    { name: ".claude.json", changes: claudeJson },
    { name: "history", changes: history.changes },
    { name: "tasks", changes: tasks },
  ];
  return { m, places };
}

// --queue with Nimbalyst running: the move goes into the queue, and deliver.mjs --stage makes sure a job is
// staged, so the next close starts --after-quit (a marker job when nothing else waits). Refused when the app has
// no quit listener (not patched, or the delivery off): nothing would carry the move out.
async function queueMove(m) {
  const d = await deliver();
  const why = await d.closeListener();
  if (why)
    refuse(
      `Nimbalyst is running, and ${why}, so nothing would carry the move out when it closes. The move needs Nimbalyst closed: close Nimbalyst, then run again without --queue.`,
    );
  const f = await movesFile();
  const entry = { from: m.from, to: m.to, at: new Date().toISOString() };
  changeQueue(f, (q) => {
    const clash = q.moves.find((x) =>
      [x.from, x.to].some((p) => sameCase(p, m.from) || sameCase(p, m.to)),
    );
    if (clash)
      refuse(
        `${f} already queues the move ${clash.from} -> ${clash.to}; let it run first (it runs when Nimbalyst closes).`,
      );
    q.moves.push(entry);
  });
  const r = spawnSync(process.execPath, [...NODE_ARGS, DELIVER, "--stage"], {
    encoding: "utf8",
    windowsHide: true,
  });
  const job = fs.existsSync(path.join(path.dirname(f), "staged.json"))
    ? JSON.parse(
        fs.readFileSync(path.join(path.dirname(f), "staged.json"), "utf8"),
      )
    : null;
  if (
    r.error ||
    r.status !== 0 ||
    !(job?.atClose === true || d.downloadRunning())
  ) {
    changeQueue(f, (q) => {
      q.moves = q.moves.filter(
        (x) => !(sameCase(x.from, entry.from) && x.at === entry.at),
      );
    });
    refuse(
      `deliver.mjs --stage ${r.error ? `could not run (${r.error.message})` : r.status !== 0 ? `exited ${r.status}` : "staged no job that Nimbalyst's close starts"}${(r.stdout + r.stderr).trim() ? `: ${(r.stdout + r.stderr).trim()}` : ""}. The move is not queued; it needs Nimbalyst closed: close Nimbalyst, then run again without --queue.`,
    );
  }
  await forgetRefused(m.from);
  return f;
}

// Moves each (from, to) pair. When one fails, those already moved go back, each on its own, and the folders made
// for the move are removed when empty: all back is Refused (nothing changed), anything left is Failed, saying where.
function moveFolders(pairs, note) {
  const done = [],
    made = [];
  try {
    for (const [f, t] of pairs) {
      const missing = [];
      for (let d = path.dirname(t); !fs.existsSync(d); d = path.dirname(d))
        missing.push(d);
      for (const d of missing.reverse()) {
        fs.mkdirSync(d);
        made.push(d);
      }
      fs.renameSync(f, t);
      done.push([f, t]);
      note(`done: folder: ${f} moves to ${t}`);
    }
  } catch (e) {
    const left = [];
    for (const [f, t] of done.reverse())
      try {
        fs.renameSync(t, f);
      } catch (back) {
        left.push(
          `${f} is now at ${t} (moving it back failed: ${back.code ?? back.message})`,
        );
      }
    // never recursive: a folder made for the move may now hold a folder that could not go back
    for (const d of made.reverse())
      try {
        fs.rmdirSync(d);
      } catch (gone) {
        left.push(
          `the folder ${d}, made for the move, is still there (${gone.code ?? gone.message})`,
        );
      }
    const why = `Windows would not move the folder (${e.code ?? e.message}): a window, an editor, a terminal or a session still has something in it open`;
    if (left.length)
      throw new Failed(
        `${why}, and the move could not be undone:\n${left.map((l) => `  ${l}`).join("\n")}\nNothing else was changed. Move those folders back by hand.`,
      );
    refuse(`${why}. Close it, then run again.`);
  }
}

function logFile(m) {
  const dir = path.join(m.claude, "setup-logs");
  fs.mkdirSync(dir, { recursive: true });
  for (let n = 1; ; n++) {
    const f = path.join(
      dir,
      `move-project-${localStamp()}-${path.basename(m.from)}${n > 1 ? `-${n}` : ""}.log`,
    );
    if (!fs.existsSync(f)) return f;
  }
}

// a database transaction not committed is rolled back on every exit
process.on("exit", () => {
  for (const c of cleanups)
    try {
      c();
    } catch {}
});
let m, places, running;
try {
  running = !DRY && nimbalystRunning();
  ({ m, places } = plan(!DRY && !running));
  if (running && !QUEUE)
    refuse(
      `${NIMBALYST_OPEN}: it holds the project's records, and a half move orphans its sessions. Close Nimbalyst, then run again, or add --queue to have the move carried out when Nimbalyst next closes.`,
    );
} catch (e) {
  console.log(`move-project refused: ${e.message}`);
  process.exit(1);
}

const lines = places.flatMap((p) => p.changes.map((c) => c.say));
// This tool runs inside Claude Code itself, so an open session is no reason to refuse; the risk is named instead.
const sessionsWarning = `warning: another open Claude Code session in ${m.from} keeps its own copy of ~/.claude.json and may write the old place back into it, and adds its new sessions to the old history folder. Close the other Claude Code sessions in that project first, and start new ones in ${m.to}.`;
if (DRY) {
  console.log(
    `move-project --dry: ${m.from} -> ${m.to}; nothing is changed. The move would:`,
  );
  for (const l of lines) console.log(`  ${l}`);
  console.log(sessionsWarning);
  process.exit(0);
}
if (running) {
  try {
    const f = await queueMove(m);
    console.log(
      `move-project --queue: Nimbalyst is running, so ${m.from} -> ${m.to} is queued in ${f}; it is carried out when Nimbalyst next closes. Nothing has moved yet. The move will:`,
    );
    for (const l of lines) console.log(`  ${l}`);
    console.log(sessionsWarning);
    process.exit(0);
  } catch (e) {
    console.log(`move-project refused: ${e.message}`);
    process.exit(1);
  }
}

// The log is made and written once before anything moves: a move that cannot keep its log does not start.
let log;
try {
  log = logFile(m);
  fs.writeFileSync(
    log,
    `move-project ${m.from} -> ${m.to}, started ${new Date().toISOString()}\nplanned:\n${lines.map((l) => `  ${l}`).join("\n")}\n`,
  );
} catch (e) {
  console.log(
    `move-project refused: the log ${log ?? `in ${path.join(m.claude, "setup-logs")}`} cannot be written (${e.code ?? e.message}), and a move is not started without it; nothing has moved.`,
  );
  process.exit(1);
}
const note = (l) => fs.appendFileSync(log, `${l}\n`);
console.log(sessionsWarning);
try {
  moveFolders(m.pairs, note);
} catch (e) {
  if (e instanceof Failed) {
    note(`FAILED: moving the folders: ${e.message}`);
    console.log(`move-project failed midway: ${e.message}\nThe log is ${log}`);
    process.exit(2);
  }
  // all moved back: nothing changed, so the log goes too
  fs.rmSync(log, { force: true });
  console.log(`move-project refused: ${e.message}`);
  process.exit(1);
}
for (const p of places.filter((p) => p.name !== "folder"))
  for (const c of p.changes) {
    try {
      c.apply();
      note(`done: ${c.say}`);
    } catch (e) {
      note(
        `FAILED: ${c.say}: ${e.message}\nnot done: every planned line after this one`,
      );
      console.log(
        `move-project failed midway at "${c.say}": ${e.message}\nThe folder has moved. What was done and what was not is in ${log}`,
      );
      process.exit(2);
    }
  }
note(`finished ${new Date().toISOString()}`);
console.log(`moved ${m.from} -> ${m.to}:`);
for (const l of lines) console.log(`  ${l}`);
console.log(`log: ${log}`);
// a refused queued move of this project is done now
try {
  await forgetRefused(m.from);
} catch (e) {
  console.log(`note: ${e.message}`);
}
