// delete-guard: a PreToolUse hook (Bash|PowerShell) that stops deletes which can take many files at once.
//   Refused: rm with -r/-R/--recursive (rm -rf, rm -fr, rm -r ...), rm with an unquoted wildcard (* ? [),
//   rm fed by xargs, find ... -delete and find ... -exec rm, git clean with -f/--force, and Remove-Item (or
//   its aliases rm, del, rd, ri, rmdir, erase) with -Recurse, a wildcard, -Filter/-Include/-Exclude or no path
//   (fed by a pipe). The refusal tells the agent to name the files, or to ask the user (a helper reports it).
//   Passed without asking (user, 2026-11-12: unattended runs must not stall): rm or Remove-Item of named
//   files, no recursion, no wildcard. Also passed: every target inside a temp, cache or worktree folder: $TEMP/$TMP/$TMPDIR, %TEMP%, $env:TEMP,
//   AppData/Local/Temp, /tmp, a mktemp folder kept in a variable earlier in the command (strictly inside
//   these), node_modules, .cache, __pycache__ (the folder itself too), and worktrees under cch-wt/ or
//   .claude/worktrees/ (strictly inside). Relative paths resolve from the event's cwd and any cd before them.
//   Rescoped 2026-11-19 (setup review 2.8: no confirmation for what git brings back): a recursive or wildcard
//   delete also passes inside a git work tree when everything under it is tracked and unchanged, and build or
//   test output there (dist, build, coverage, target, ...) passes. Newly refused: deleting a database file
//   (.db, .sqlite) outside temp, git reset --hard, and a force push.
//   Rescoped 2026-11-20 (plan 2.8, delete-guard row): no ask for what Claude made this session or what the user named,
//   read from the session's transcript. Made: files written with the Write tool, a shell call's > redirect target,
//   the -o/--output value of a tool that writes it (curl, wget, pandoc, a compiler, sort ...), ffmpeg's output (its
//   last word, not an -i input or an option's value), Out-File/Set-Content; only by a call whose result is in and is
//   not an error, not the call being judged, and with no relative path after a cd. A recursive or wildcard delete
//   passes when every file under the target (the folder above the first wildcard) was made. Named: the target's full
//   path is a whole path in a message the user typed (not a summary, a helper's brief, a tool's output or a system
//   note; not the drive root, the home folder or a folder above it; a typed file does not name its folders). A link
//   or junction in the target's path or under it is neither made nor named. Case counts except on Windows. A named
//   file outside the project folders (the event's cwd and CLAUDE_PROJECT_DIR) is now refused unless it is in temp,
//   tracked and unchanged in a git repo, made or named; a path holding an unknown variable still passes.
// The command is split into simple commands on ; && || | & ( ) and new lines (PowerShell also { }), with quotes and
// comments read the shell way, and lead words (then, do, else, elif, if, while, until, !, { }) dropped from the front,
// so a delete inside quoted text (echo "rm -rf /", a grep pattern) is not a command and passes.
// bash/sh -c "..." and powershell/pwsh -Command "..." are read inside. Heredoc bodies are skipped.
// Not seen: deletes done by a script (node, python), a variable holding the command, eval. The setup's own
// cleanup (workers/disk-tidy.mjs, file-check.mjs) deletes from Node, so it passes.
// Helpers (agent_id set) get the same verdicts; their refusal says to report instead of asking.
// Fails closed (wired with onFailure "block"): if the check itself fails, the call is stopped. DELETE_GUARD=off
// disables it.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emit, runHook } from "./lib/hook-io.mjs";

// The texts, here and nowhere else
const TAG = "[delete-guard]";
const INSTEAD_MAIN =
  "If the user asked for this delete, ask them in a form to confirm the exact paths, or tell them the command to run themselves.";
const INSTEAD_HELPER =
  "You are a helper: leave the files in place, name them in your report and say why they should go; the user decides.";
const refuseText = (what, helper) =>
  `${TAG} Refused: ${what} can lose work that cannot be brought back. ` +
  `Delete only files you name one by one in the project (rm "path/a.txt" "path/b.txt"), files you made this session, what the user named, committed files in a git repo, or scratch work in the temp folder, where deletes pass. ` +
  (helper ? INSTEAD_HELPER : INSTEAD_MAIN);

// Split a command into simple commands (arrays of words) the shell way. A word is { text, glob }: glob when an
// unquoted * ? [ is in it. Redirections are dropped, heredoc bodies skipped, comments dropped. The inside of each
// $( ) or backtick substitution goes to subs, to be read as commands too. ps: PowerShell quoting (` escapes).
function closeParen(src, from) {
  let depth = 1;
  for (let k = from; k < src.length; k++) {
    const ch = src[k];
    if (ch === "'" || ch === '"') {
      const e = src.indexOf(ch, k + 1);
      if (e < 0) return src.length;
      k = e;
    } else if (ch === "(") depth++;
    else if (ch === ")" && --depth === 0) return k;
  }
  return src.length;
}

function lex(src, ps) {
  const cmds = [],
    subs = [],
    outs = []; // the files a > redirect writes
  let cur = [],
    tok = null,
    heredocs = [],
    redirect = false,
    i = 0;
  const add = (s, glob = false) => {
    tok ??= { text: "", glob: false };
    tok.text += s;
    if (glob) tok.glob = true;
  };
  const endTok = () => {
    if (tok && !redirect) cur.push(tok);
    else if (tok) {
      if (/^>&?$/.test(redirect) && !/^(\d+|-)$/.test(tok.text)) outs.push(tok);
      redirect = false;
    }
    tok = null;
  };
  const endCmd = () => {
    endTok();
    if (cur.length) cmds.push(cur);
    cur = [];
  };
  const sub = () => {
    const e = closeParen(src, i + 2);
    subs.push(src.slice(i + 2, e));
    add(src.slice(i, e + 1));
    i = e + 1;
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "\n") {
      endCmd();
      i++;
      for (const h of heredocs) {
        while (i < src.length) {
          const nl = src.indexOf("\n", i),
            end = nl < 0 ? src.length : nl;
          const line = src.slice(i, end).replace(/\r$/, "");
          i = end + 1;
          if ((h.dash ? line.replace(/^\t+/, "") : line) === h.word) break;
        }
      }
      heredocs = [];
    } else if (c === " " || c === "\t" || c === "\r") {
      endTok();
      i++;
    } else if (c === "#" && !tok) {
      const nl = src.indexOf("\n", i);
      i = nl < 0 ? src.length : nl;
    } else if (";|&()".includes(c) || (ps && !tok && "{}".includes(c))) {
      endCmd();
      i++;
    } // ${env:X} keeps its braces
    else if (c === "<" || c === ">") {
      if (!ps && src.startsWith("<<", i) && src[i + 2] !== "<") {
        endTok();
        i += 2;
        const dash = src[i] === "-";
        if (dash) i++;
        while (src[i] === " " || src[i] === "\t") i++;
        const m = /^(['"]?)([^\s;|&<>'"]+)\1/.exec(src.slice(i));
        if (m) {
          heredocs.push({ word: m[2], dash });
          i += m[0].length;
        }
        continue;
      }
      if (tok && /^\d*$/.test(tok.text)) tok = null;
      else endTok();
      const from = i;
      while (src[i] === "<" || src[i] === ">" || src[i] === "&") i++;
      redirect = src.slice(from, i); // the operator: > writes a file, >> appends, < reads
    } else if (c === "'") {
      let e = src.indexOf("'", i + 1);
      if (ps) while (e >= 0 && src[e + 1] === "'") e = src.indexOf("'", e + 2);
      if (e < 0) e = src.length;
      add(ps ? src.slice(i + 1, e).replace(/''/g, "'") : src.slice(i + 1, e));
      i = e + 1;
    } else if (c === '"') {
      add("");
      i++;
      while (i < src.length && src[i] !== '"') {
        if (
          ps
            ? src[i] === "`"
            : src[i] === "\\" && '$`"\\\n'.includes(src[i + 1])
        ) {
          add(src[i + 1] ?? "");
          i += 2;
        } else if (src[i] === "$" && src[i + 1] === "(") sub();
        else add(src[i++]);
      }
      i++;
    } else if (c === (ps ? "`" : "\\")) {
      if (src[i + 1] !== "\n") add(src[i + 1] ?? "");
      i += 2;
    } else if (c === "$" && src[i + 1] === "(") sub();
    else if (!ps && c === "`") {
      let e = src.indexOf("`", i + 1);
      if (e < 0) e = src.length;
      subs.push(src.slice(i + 1, e));
      add(src.slice(i, e + 1));
      i = e + 1;
    } else {
      add(c, "*?[".includes(c));
      i++;
    }
  }
  endCmd();
  return { cmds, subs, outs };
}

// Paths are compared with forward slashes, lower-case on Windows only (other systems tell a.txt from A.txt);
// Git Bash's /c/... is read as c:/...
const HOME = os.homedir();
const fold = (s) => (process.platform === "win32" ? s.toLowerCase() : s);
function norm(p, cwd) {
  let t = p.replace(/\\/g, "/").replace(/^\/([a-z])(?=\/|$)/i, "$1:");
  if (/^[a-z]:$/i.test(t)) t += "/";
  if (!t.startsWith("/") && !/^[a-z]:\//i.test(t)) {
    if (cwd == null) return null;
    t = `${cwd}/${t}`;
  }
  return fold(path.posix.normalize(t)).replace(/(.)\/+$/, "$1");
}
const TEMP_ROOTS = [
  "/tmp",
  ...[os.tmpdir(), process.env.TEMP, process.env.TMP, process.env.TMPDIR]
    .filter(Boolean)
    .map((p) => norm(p, null)),
];
const INSIDE = ["appdata/local/temp", "cch-wt", ".claude/worktrees"]; // strictly inside these
const CACHES = ["node_modules", ".cache", "__pycache__"]; // these themselves too
// build and test output, safe inside a git work tree (it is made again by a build or a test run)
const BUILT = [
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  "target",
  "test-results",
  "playwright-report",
  ".pytest_cache",
  ".turbo",
];
function safe(p) {
  if (!p) return false;
  if (p.split("/").some((s) => CACHES.includes(s))) return true;
  return (
    TEMP_ROOTS.some((r) => p.startsWith(`${r}/`)) ||
    INSIDE.some((m) => p.includes(`/${m}/`))
  );
}
const DB = /\.(db|sqlite|sqlite3)$/i;

// Inside a git repo, a delete git can undo passes: every file under the target is tracked and unchanged (no
// untracked, ignored or modified file there). raw: the path in its own case (git on macOS and Linux needs it).
// A glob is judged by the folder above its first wildcard. A target that does not exist is not judged undoable.
const gitOut = (dir, args) => {
  const r = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    timeout: 3000,
    windowsHide: true,
  });
  return r.status === 0 ? r.stdout : null;
};
function undoable(raw, glob) {
  try {
    return undoableAt(raw, glob);
  } catch {
    return false;
  }
}
// a glob's folder above its first wildcard; any other path itself
function base(raw, glob) {
  if (!glob) return raw;
  const segs = raw.split("/");
  return (
    segs
      .slice(
        0,
        segs.findIndex((s) => /[*?[]/.test(s)),
      )
      .join("/") || "/"
  );
}
function undoableAt(raw, glob) {
  if (!raw) return false;
  const t = base(raw, glob);
  if (!fs.existsSync(t)) return false;
  const dir = fs.statSync(t).isDirectory() ? t : path.dirname(t);
  if (gitOut(dir, ["rev-parse", "--is-inside-work-tree"])?.trim() !== "true")
    return false;
  if (
    t
      .toLowerCase()
      .split("/")
      .some((s) => BUILT.includes(s))
  )
    return true;
  const tracked = gitOut(dir, ["ls-files", "--", t]);
  const dirty = gitOut(dir, [
    "status",
    "--porcelain",
    "--ignored",
    "--untracked-files=all",
    "--",
    t,
  ]);
  return Boolean(tracked?.trim()) && dirty === "";
}

// What the session made and what the user typed, read once from the transcript and only when a delete would be
// refused. No transcript_path: nothing is made or named. An unreadable transcript throws (the guard fails closed).
// A call made its files only when its result is in and is not an error; the call being judged (judged) never counts.
function readSession(file, cwd, judged) {
  const made = new Set(),
    calls = new Map(),
    done = new Set();
  let said = "";
  if (!file) return { made, said };
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.includes('"user"') && !line.includes('"tool_use"')) continue;
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue; // a line cut short while the session writes it
    }
    const content = e?.message?.content;
    if (e?.type === "user") {
      if (Array.isArray(content))
        for (const b of content)
          if (b?.type === "tool_result" && b.is_error !== true)
            done.add(b.tool_use_id);
      if (!typed(e)) continue;
      const texts =
        typeof content === "string"
          ? [content]
          : Array.isArray(content)
            ? content.filter((b) => b?.type === "text").map((b) => b.text)
            : [];
      for (const t of texts)
        if (typeof t === "string" && !NOT_TYPED.test(t)) said += `\n${t}`;
    } else if (e?.type === "assistant" && Array.isArray(content))
      for (const b of content)
        if (b?.type === "tool_use" && b.id !== judged)
          calls.set(b.id, madeBy(b.name, b.input ?? {}, e.cwd ?? cwd));
  }
  for (const [id, paths] of calls)
    if (done.has(id)) for (const p of paths) if (p) made.add(p);
  return {
    made,
    said: fold(said.replace(/\\/g, "/"))
      .replace(/(^|[\s"'`(])~(?=\/)/g, `$1${norm(HOME, null)}`)
      .replace(/(^|[\s"'`(])\/([a-z])\//gi, "$1$2:/"),
  };
}
// A "user" entry the user typed: not a compaction summary, a helper's brief (sidechain), a tool's result or
// message, a transcript-only or meta entry, nor text the app adds (task notices, slash command output, system notes)
const typed = (e) =>
  !e.isMeta &&
  !e.isCompactSummary &&
  !e.isSidechain &&
  !e.isVisibleInTranscriptOnly &&
  e.toolUseResult === undefined &&
  e.sourceToolUseID === undefined;
const NOT_TYPED =
  /^\s*<(task-notification>|local-command-|command-|system-reminder>)/;
const MOVES = [
  "cd",
  "pushd",
  "popd",
  "chdir",
  "set-location",
  "sl",
  "push-location",
  "pop-location",
];
const OUT_FLAGS = new Set(["-o", "--output"]);
// the tools whose -o/--output names a file they write (unzip -o, ls -o, grep -o mean something else)
const OUT_WRITERS = new Set([
  "curl",
  "wget",
  "yt-dlp",
  "youtube-dl",
  "pandoc",
  "gcc",
  "g++",
  "cc",
  "c++",
  "clang",
  "clang++",
  "rustc",
  "go",
  "sort",
]);
// ffmpeg options that take no value; every other option takes the next word
const FFMPEG_FLAGS = new Set([
  "-y",
  "-n",
  "-an",
  "-vn",
  "-sn",
  "-dn",
  "-hide_banner",
  "-nostdin",
  "-stats",
  "-nostats",
  "-re",
  "-shortest",
  "-copyts",
  "-benchmark",
  "-report",
]);
// ffmpeg's output: its last word, when that is not an option, an option's value or an -i input
function ffmpegOut(args) {
  let out = null;
  for (let k = 0; k < args.length; k++) {
    out = args[k].text.startsWith("-") ? null : args[k];
    if (out == null && !FFMPEG_FLAGS.has(args[k].text)) k++;
  }
  return out;
}
// the files one tool call wrote, as normalized paths (null for a path that can't be known)
function madeBy(name, input, cwd) {
  if (name === "Write") return [norm(String(input.file_path ?? ""), cwd)];
  if (name !== "Bash" && name !== "PowerShell") return [];
  const ps = name === "PowerShell",
    st = { cwd: cwd == null ? null : norm(String(cwd), null), vars: {} };
  const { cmds, outs } = lex(String(input.command ?? ""), ps);
  const words = [...outs];
  const names = cmds.map((w) =>
    path.posix
      .basename((w[0]?.text ?? "").replace(/\\/g, "/"))
      .toLowerCase()
      .replace(/\.exe$/, ""),
  );
  // a command that changes folder: where its relative paths land is not guessed, they are dropped
  if (names.some((n) => MOVES.includes(n))) st.cwd = null;
  for (const [j, w] of cmds.entries()) {
    const cmd = names[j];
    const args = w.slice(1);
    if (OUT_WRITERS.has(cmd))
      args.forEach((a, k) => {
        if (OUT_FLAGS.has(a.text) && args[k + 1]) words.push(args[k + 1]);
        else if (a.text.startsWith("--output="))
          words.push({ text: a.text.slice(9) });
      });
    const plain = args.filter((a) => !a.text.startsWith("-"));
    if (cmd === "ffmpeg") words.push(ffmpegOut(args));
    else if (ps && ["out-file", "set-content"].includes(cmd)) {
      const k = args.findIndex((a) => /^-(filepath|path)$/i.test(a.text));
      words.push(k >= 0 ? args[k + 1] : plain[0]);
    }
  }
  return words.filter(Boolean).map((t) => where(t.text, st));
}

// Every file under a path; null when it does not exist, holds more than LIST_MAX entries, or holds a link or
// junction (or anything not a plain file or folder): what a link reaches is not judged
const LIST_MAX = 2000;
function filesUnder(raw) {
  if (!fs.existsSync(raw)) return null;
  const top = fs.lstatSync(raw);
  if (top.isSymbolicLink()) return null;
  if (!top.isDirectory()) return top.isFile() ? [raw] : null;
  const files = [],
    todo = [raw];
  let seen = 0;
  while (todo.length) {
    const d = todo.pop();
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      if (++seen > LIST_MAX) return null;
      const p = `${d}/${ent.name}`;
      if (ent.isSymbolicLink()) return null;
      if (ent.isDirectory()) todo.push(p);
      else if (ent.isFile()) files.push(p);
      else return null;
    }
  }
  return files;
}

// The path as written reaches the place its normalized form names: no part of it (.. parts included) is a link or
// junction, and the system's own name for it is the same (no short 8.3 name, no subst drive). A part that does not
// exist ends the walk: nothing past it can be a link.
function direct(loose) {
  const segs = loose.split("/");
  for (let k = 1; k <= segs.length; k++) {
    const p = segs.slice(0, k).join("/");
    if (!p || /^[a-z]:$/i.test(p)) continue; // the root
    let s;
    try {
      s = fs.lstatSync(p);
    } catch (e) {
      if (e.code === "ENOENT") return true;
      throw e;
    }
    if (s.isSymbolicLink()) return false;
  }
  return norm(fs.realpathSync.native(loose), null) === norm(loose, null);
}

// The user named this path in a message: its full path as a whole word, not inside a longer name and not the front
// of a longer path (a typed file does not name its folders). The drive root, the home folder and the folders above
// it never count, so a pasted home path does not free the whole home folder.
function named(p, said) {
  const home = norm(HOME, null);
  if (p === home || home.startsWith(`${p}/`) || /^([a-z]:)?\/?$/i.test(p))
    return false;
  for (let k = said.indexOf(p); k >= 0; k = said.indexOf(p, k + 1)) {
    const before = said[k - 1] ?? " ",
      after = said[k + p.length] ?? " ";
    if (!/[\w.:/-]/.test(before) && !/[\w./-]/.test(after)) return true;
  }
  return false;
}

// Claude made everything under the target this session, or the user named the target. A target reached through a
// link or junction is neither.
function chosen(t, st) {
  const p = where(t.text, st),
    loose = looseRaw(t.text, st);
  if (!p || !loose) return false;
  const s = st.session();
  let files;
  try {
    if (!direct(base(loose, t.glob))) return false;
    if (!t.glob && named(p, s.said)) return true;
    if (!s.made.size) return false;
    files = filesUnder(path.posix.normalize(base(loose, t.glob)));
  } catch {
    return false; // a folder it can't read is not judged made, as in undoable
  }
  return (
    Boolean(files?.length) && files.every((f) => s.made.has(norm(f, null)))
  );
}
const inProject = (p, st) =>
  st.projects.some((r) => p === r || p.startsWith(`${r}/`));

// A word as a path: ~, the temp and home variables, mktemp and variables set earlier in the command are filled in;
// any other variable or substitution leaves the path unknown (null), which is never safe
const KNOWN = {
  TEMP: "/tmp",
  TMP: "/tmp",
  TMPDIR: "/tmp",
  HOME,
  USERPROFILE: HOME,
  LOCALAPPDATA: `${HOME}/AppData/Local`,
};
function fill(text, st) {
  let unknown = false;
  const t = text
    .replace(/^~(?=[/\\]|$)/, HOME)
    .replace(/\$\(\s*mktemp\b[^)]*\)|`\s*mktemp\b[^`]*`/g, "/tmp/mktemp")
    .replace(
      /\$env:(\w+)|\$\{(\w+)(?::?[-=+?][^}]*)?\}|\$(\w+)|%(\w+)%/gi,
      (_, a, b, c, d) => {
        const name = a ?? b ?? c ?? d;
        const v =
          name in st.vars
            ? st.vars[name]
            : (KNOWN[name.toUpperCase()] ??
              (name.toUpperCase() === "PWD" ? st.cwd : undefined));
        if (v == null) unknown = true;
        return v ?? "";
      },
    );
  return unknown || /[$`]/.test(t) ? null : t;
}
const where = (text, st) => {
  const t = fill(text, st);
  return t == null ? null : norm(t, st.cwd);
};
// the same path in its own case, for git and the file system; looseRaw keeps its . and .. parts as written
const looseRaw = (text, st) => {
  const t = fill(text, st);
  if (t == null) return null;
  let p = t.replace(/\\/g, "/").replace(/^\/([a-z])(?=\/|$)/i, "$1:");
  if (/^[a-z]:$/i.test(p)) p += "/";
  if (!p.startsWith("/") && !/^[a-z]:\//i.test(p)) {
    if (st.rawCwd == null) return null;
    p = `${st.rawCwd}/${p}`;
  }
  return p.replace(/(.)\/+$/, "$1");
};
const whereRaw = (text, st) => {
  const p = looseRaw(text, st);
  return p == null ? null : path.posix.normalize(p);
};

const LEAD = new Set([
  "then",
  "do",
  "else",
  "elif",
  "if",
  "while",
  "until",
  "!",
  "{",
  "}",
]);
const PREFIX = new Set([
  "sudo",
  "doas",
  "command",
  "builtin",
  "exec",
  "nohup",
  "time",
  "nice",
  "env",
  "export",
  "local",
  "declare",
  "readonly",
]);
const PS_REMOVE = new Set([
  "remove-item",
  "rm",
  "del",
  "rd",
  "ri",
  "rmdir",
  "erase",
]);
const XARGS_VALUE = new Set(["-I", "-n", "-P", "-d", "-L", "-s", "-E", "-a"]);
const PS_SKIP_VALUE =
  /^(erroraction|ea|warningaction|wa|informationaction|ia|errorvariable|ev|outvariable|ov|credential|stream)$/;

// One verdict per delete: out.deny gets what is refused. A named file with no recursion or wildcard passes in the
// project folders, or when its path holds an unknown variable. many: recursive, or a bulk form (-Include, a pipe).
function free(t, st, many) {
  const p = where(t.text, st);
  if (safe(p)) return true;
  if (!many && !t.glob && (p == null || inProject(p, st))) return true;
  return undoable(whereRaw(t.text, st), t.glob) || chosen(t, st);
}
function judge(targets, st, out, { recursive, bulk, verb }) {
  const db = targets.find((t) => DB.test(t.text) && !safe(where(t.text, st)));
  if (db) out.deny.push(`deleting the database ${db.text}`);
  const unsafe = targets.filter((t) => !free(t, st, recursive || bulk));
  if (targets.length && !unsafe.length) return;
  if (bulk) out.deny.push(bulk);
  else if (!unsafe.length) return;
  else if (recursive) out.deny.push(`${verb} on ${unsafe[0].text}`);
  else if (unsafe.some((t) => t.glob))
    out.deny.push(
      `the wildcard delete ${verb.split(" ")[0]} ${unsafe.find((t) => t.glob).text}`,
    );
  else out.deny.push(`deleting ${unsafe[0].text} outside the project folders`);
}

function rm(args, piped, st, out) {
  let recursive = false,
    ends = false;
  const targets = [];
  for (const a of args) {
    if (!ends && a.text === "--") ends = true;
    else if (!ends && /^-./.test(a.text))
      recursive ||= a.text === "--recursive" || /^-[a-zA-Z]*[rR]/.test(a.text);
    else targets.push(a);
  }
  if (targets.length || piped)
    judge(targets, st, out, {
      recursive,
      bulk: piped && "rm fed by xargs",
      verb: "rm -r",
    });
}

function removeItem(args, st, out) {
  let recursive = false,
    bulk = "",
    whatIf = false;
  const targets = [];
  const push = (text, literal) => {
    for (const p of text.split(","))
      if (p) targets.push({ text: p, glob: !literal && /[*?[]/.test(p) });
  };
  for (let k = 0; k < args.length; k++) {
    const a = args[k].text;
    if (!/^-[a-z]/i.test(a)) {
      push(a, false);
      continue;
    }
    const colon = a.indexOf(":"),
      n = (colon < 0 ? a.slice(1) : a.slice(1, colon)).toLowerCase(),
      val = colon < 0 ? null : a.slice(colon + 1);
    if (/^(path|p|literalpath|lp|pspath)$/.test(n))
      push(val ?? args[++k]?.text ?? "", n.startsWith("l"));
    else if (
      n.length >= 2 &&
      ["filter", "include", "exclude"].some((f) => f.startsWith(n))
    ) {
      bulk = `Remove-Item ${a}`;
      if (val == null) k++;
    } else if (PS_SKIP_VALUE.test(n)) {
      if (val == null) k++;
    } else if (n.length >= 2 && "whatif".startsWith(n)) whatIf = true;
    else if (n.startsWith("r") || (n.length <= 3 && n.includes("r")))
      recursive = true;
  }
  if (whatIf) return;
  if (!targets.length) bulk ||= "Remove-Item fed by a pipe (no path named)";
  judge(targets, st, out, { recursive, bulk, verb: "Remove-Item -Recurse" });
}

function find(args, st, out) {
  let k = 0;
  while (["-H", "-L", "-P"].includes(args[k]?.text)) k++;
  const starts = [];
  for (; k < args.length && !/^[-(!]/.test(args[k].text); k++)
    starts.push(args[k]);
  const rest = args.slice(k).map((a) => a.text);
  const del =
    rest.includes("-delete") ||
    rest.some(
      (t, j) =>
        /^-(exec|execdir|ok|okdir)$/.test(t) &&
        /^(rm|unlink|shred)$/.test(path.basename(rest[j + 1] ?? "")),
    );
  if (!del) return;
  if (!starts.length) starts.push({ text: "." });
  if (
    !starts.every(
      (s) =>
        safe(where(s.text, st)) ||
        undoable(whereRaw(s.text, st), false) ||
        chosen({ text: s.text, glob: false }, st),
    )
  )
    out.deny.push(`find ${starts.map((s) => s.text).join(" ")} ... -delete`);
}

function git(args, st, out) {
  let dir = st.cwd,
    k = 0;
  for (; k < args.length && args[k].text.startsWith("-"); k++) {
    const t = args[k].text;
    if (t === "-C") dir = where(args[++k]?.text ?? "", { ...st, cwd: dir });
    else if (t === "-c") k++;
    else if (t.startsWith("--work-tree="))
      dir = where(t.slice(12), { ...st, cwd: dir });
  }
  const sub = args[k]?.text;
  const after = args.slice(k + 1).map((a) => a.text);
  if (sub === "reset" && after.includes("--hard"))
    return void out.deny.push("git reset --hard (drops uncommitted work)");
  if (
    sub === "push" &&
    after.some(
      (t) =>
        t === "--force" ||
        t.startsWith("--force-with-lease") ||
        /^-[a-zA-Z]*f/.test(t) ||
        /^\+[^+]/.test(t),
    )
  )
    return void out.deny.push("a force push (rewrites the remote's history)");
  if (sub !== "clean") return;
  const rest = after,
    flags = rest.filter((t) => t.startsWith("-"));
  if (flags.some((t) => t === "--dry-run" || /^-[a-zA-Z]*n/.test(t))) return;
  if (!flags.some((t) => t === "--force" || /^-[a-zA-Z]*f/.test(t))) return;
  const specs = rest.filter((t) => !t.startsWith("-"));
  const places = specs.length
    ? specs.map((t) => where(t, { ...st, cwd: dir }))
    : [dir];
  if (!places.every(safe)) out.deny.push(`git clean ${flags.join(" ")}`);
}

function one(words, ps, st, out) {
  let w = words,
    piped = false;
  for (;;) {
    const t = w[0]?.text ?? "";
    if (!ps && /^[A-Za-z_]\w*=/.test(t)) {
      const e = t.indexOf("=");
      st.vars[t.slice(0, e)] = fill(t.slice(e + 1), st);
      w = w.slice(1);
    } else if (!ps && LEAD.has(t)) w = w.slice(1);
    else if (PREFIX.has(t)) {
      w = w.slice(1);
      while (w[0]?.text.startsWith("-")) w = w.slice(1);
    } else if (t === "xargs") {
      piped = true;
      w = w.slice(1);
      while (w[0]?.text.startsWith("-"))
        w = w.slice(XARGS_VALUE.has(w[0].text) ? 2 : 1);
    } else break;
  }
  if (!w.length) return;
  const name = path.posix
    .basename(w[0].text.replace(/\\/g, "/"))
    .toLowerCase()
    .replace(/\.exe$/, "");
  const args = w.slice(1);
  if (["cd", "pushd", "chdir", "set-location", "sl"].includes(name)) {
    const to = args.find((a) => !a.text.startsWith("-"));
    const raw = to ? whereRaw(to.text, st) : HOME.replace(/\\/g, "/");
    st.cwd = to ? where(to.text, st) : norm(HOME, null);
    st.rawCwd = raw;
  } else if (["bash", "sh", "zsh", "dash"].includes(name)) {
    const k = args.findIndex((a) => /^-[a-z]*c$/.test(a.text));
    if (k >= 0 && args[k + 1])
      check(args[k + 1].text, false, { ...st, vars: { ...st.vars } }, out);
  } else if (["powershell", "pwsh"].includes(name)) {
    const k = args.findIndex((a) => /^-(c|command)$/i.test(a.text));
    if (k >= 0)
      check(
        args
          .slice(k + 1)
          .map((a) => a.text)
          .join(" "),
        true,
        { ...st, vars: {} },
        out,
      );
  } else if (ps ? PS_REMOVE.has(name) : name === "rm")
    ps ? removeItem(args, st, out) : rm(args, piped, st, out);
  else if (name === "find") find(args, st, out);
  else if (name === "git") git(args, st, out);
}

function check(src, ps, st, out) {
  const { cmds, subs } = lex(src, ps);
  for (const s of subs) check(s, ps, { ...st, vars: { ...st.vars } }, out);
  for (const words of cmds) one(words, ps, st, out);
}

runHook(
  "delete-guard",
  (event) => {
    if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
    const command = String(event.tool_input?.command ?? "");
    let session;
    const st = {
      cwd: event.cwd ? norm(String(event.cwd), null) : null,
      rawCwd: null,
      vars: {},
      projects: [event.cwd, process.env.CLAUDE_PROJECT_DIR]
        .filter(Boolean)
        .map((p) => norm(String(p), null)),
      session: () =>
        (session ??= readSession(
          event.transcript_path,
          event.cwd,
          event.tool_use_id,
        )),
    };
    st.rawCwd = event.cwd ? whereRaw(String(event.cwd), st) : null;
    const out = { deny: [] };
    check(command, event.tool_name === "PowerShell", st, out);
    if (out.deny.length) {
      emit.deny(
        refuseText([...new Set(out.deny)].join("; "), Boolean(event.agent_id)),
      );
      return;
    } // emit returns the bytes written, which runHook would take as the exit code
  },
  { failClosed: true },
);
