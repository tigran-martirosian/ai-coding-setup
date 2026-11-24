#!/usr/bin/env node
// The file standard's checker (skills/file-upkeep/standard.md): names, places and old copies in a project folder.
//   node file-check.mjs --report [<folder>] [--json]   the findings: fix (a target is proposed), ask (a person decides),
//                                                      note (listed only); folder defaults to the current one
//   node file-check.mjs --report --homes [--json]      the same for every project home the setup knows
//   node file-check.mjs --status --homes               one line per home, then "pending: <key>" and one "offer:" line
//                                                      (the update shows the reorganize card from it)
//   node file-check.mjs --skip --homes                 "not now": the current pending key is marked offered
//   node file-check.mjs --check <ledger>               the ledger against the folder; "check: ok" or the faults
//   node file-check.mjs --apply <ledger>               runs the check, then the moves, deletes, merges and keeps, then
//                                                      the reference fix; the saved ledger under ~/.claude/setup-logs is
//                                                      written first and after each action, so a stop midway is undone too
//   node file-check.mjs --undo [<saved ledger>]        reverses the last apply, or the named one
//   node file-check.mjs --root [<folder>] [--json]     the projects folder by P10, report only (nothing to apply: a
//                                                      project moves with move-project.mjs); folder defaults to the
//                                                      setup's projects folder (projectsRoot)
//   --home <folder>                                    work as if <folder> were the home folder (tests)
// Imported: newPathNotes(projectRoot, rel) checks one path about to be made (the creation-time note), projectsRoot(home)
// names the projects folder.
// Only files git shows (tracked, or untracked and not ignored) are read: git-ignored data (logs, databases, caches)
// is never flagged, moved or deleted. Not a git project: a walk that skips the usual build and package folders.
// A ledger: {"project": "<folder>", "entries": [{"id": "F1", "path": "<as reported>", "sha": "<as reported>",
//   "action": "move"|"delete"|"merge"|"keep", "to": "<target, for move and merge>", "answer": "yes" (an untracked
//   delete the person agreed to), "reason": "<why, for keep>"}]}. Every fix and ask finding needs exactly one entry.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let stopNote = ""; // set while an apply runs: where its journal is and how to undo it
const stop = (why) => {
  console.log(`file-check stopped: ${why}`);
  if (stopNote) console.log(stopNote);
  process.exit(1);
};
const flagValue = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const v = args[at + 1];
  return v && !v.startsWith("--") ? v : null;
};
const homeArg = flagValue("--home"); // null (no folder) stops the command line, at the end of this file
const home = homeArg ? path.resolve(homeArg) : os.homedir();
const HOMES = args.includes("--homes");
const JSON_OUT = args.includes("--json");
const CLAUDE = path.join(home, ".claude");
const STATE = path.join(CLAUDE, "setup-state.json");
const LOGS = path.join(CLAUDE, "setup-logs");
const fwd = (p) => p.replace(/\\/g, "/");
const tilde = (f) =>
  fwd(f).startsWith(fwd(home) + "/")
    ? "~/" + fwd(path.relative(home, f))
    : fwd(f);
const FC = `node ${tilde(path.join(CLAUDE, "skills", "file-upkeep", "file-check.mjs"))}`;
const sha = (data) => crypto.createHash("sha256").update(data).digest("hex");
// a file of any size, read 1 MiB at a time (readFileSync stops at 2 GiB)
const shaFile = (full) => {
  const h = crypto.createHash("sha256"),
    buf = Buffer.alloc(1 << 20),
    fd = fs.openSync(full, "r");
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; )
      h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest("hex");
};
// Dates are the person's local day, as git's %as gives them, so a run near midnight UTC agrees with git.
const localDay = (d) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
const today = () => localDay(new Date());
const read = (f) => fs.readFileSync(f, "utf8");

// The estimate's constants, one place: minutes = 2 + fix/15 + ask/3 + referencing files/10, rounded up.
// A first guess until the workshop run is timed.
const EST = { base: 2, perFix: 1 / 15, perAsk: 1 / 3, perRefFile: 1 / 10 };
const minutesFor = (fix, ask, refFiles) =>
  fix + ask
    ? Math.ceil(
        EST.base +
          fix * EST.perFix +
          ask * EST.perAsk +
          refFiles * EST.perRefFile,
      )
    : 0;
const OLD_DAYS = 90;
const BIG_TEXT = 1024 * 1024; // over this, a file is not searched or edited for references

const git = (root, ...a) => {
  const r = spawnSync("git", ["-C", root, ...a], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.error) stop(`git could not start: ${r.error.message}`);
  return r;
};
const gitOk = (root, ...a) => {
  const r = git(root, ...a);
  if (r.status !== 0)
    stop(
      `git ${a.join(" ")} failed in ${fwd(root)}: ${(r.stderr || r.stdout).trim()}`,
    );
  return r.stdout;
};
// git prints the long real path; the folder may be given with a Windows 8.3 short name in it (RUNNER~1 on the CI
// runner), through a link, or as /var for /private/var on macOS, so both sides are compared in their real form
const isGitRoot = (root) => {
  const r = git(root, "rev-parse", "--show-toplevel");
  return (
    r.status === 0 &&
    fs.realpathSync.native(r.stdout.trim()).toLowerCase() ===
      fs.realpathSync.native(root).toLowerCase()
  );
};
const zlist = (out) => out.split("\0").filter(Boolean);

// ---- the files of a project
const WALK_SKIP = new Set([
  "node_modules",
  ".git",
  ".venv",
  "venv",
  "__pycache__",
  "dist",
  "build",
  "out",
  "coverage",
  ".next",
  "target",
]);
const skipped = (rel) => /^\.claude\/worktrees\//.test(rel);
function walk(root, dir = root, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (
        WALK_SKIP.has(e.name) ||
        (full !== root && fs.existsSync(path.join(full, ".git")))
      )
        continue;
      walk(root, full, out);
    } else if (e.isFile()) out.push(fwd(path.relative(root, full)));
  }
  return out;
}
// {root, git, files: [rel], tracked: Set, ignoredDirs: [rel] (folders that hold git-ignored files), standard}
function project(root) {
  root = path.resolve(root);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
    stop(`${fwd(root)} is not a folder.`);
  const inGit = isGitRoot(root);
  let files,
    tracked = new Set(),
    ignored = [];
  if (inGit) {
    tracked = new Set(zlist(gitOk(root, "ls-files", "-z")));
    const others = zlist(
      gitOk(root, "ls-files", "-z", "--others", "--exclude-standard"),
    );
    // a nested repo shows as "<dir>/": it is its own project
    files = [...tracked, ...others.filter((f) => !f.endsWith("/"))].filter(
      (f) => fs.existsSync(path.join(root, f)),
    );
    ignored = zlist(
      gitOk(
        root,
        "ls-files",
        "-z",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
      ),
    );
  } else files = walk(root);
  files = files.filter((f) => !skipped(f)).sort();
  return {
    root,
    git: inGit,
    files,
    tracked,
    ignored,
    toolNamed: toolNamed(root, files),
    standard: standardFile(root),
  };
}
// .claude/file-standard.json: {"ignore": ["<glob>"], "reason": {"<glob>": "<why>"}}, and in the projects folder
// {"families": ["<name>"]} (P10); fail is stop, or a throw for newPathNotes (a hook must not exit)
function standardFile(root, fail = stop) {
  const f = path.join(root, ".claude", "file-standard.json");
  if (!fs.existsSync(f))
    return { ignore: [], reason: {}, families: [], text: null };
  let j;
  try {
    j = JSON.parse(read(f));
  } catch (e) {
    return fail(`${fwd(f)} is not valid JSON: ${e.message}`);
  }
  const ignore = j.ignore || [],
    reason = j.reason || {};
  const bare = ignore.filter((g) => !reason[g]);
  if (bare.length)
    return fail(
      `${fwd(f)}: every ignored glob needs a reason under "reason"; missing for ${bare.join(", ")}.`,
    );
  const families = j.families || [];
  if (
    !Array.isArray(families) ||
    !families.every((n) => typeof n === "string" && n.trim())
  )
    return fail(
      `${fwd(f)}: "families" is a list of names, as ["game"]; found ${JSON.stringify(j.families)}.`,
    );
  return { ignore, reason, families, text: read(f) };
}
const globRe = (g) =>
  new RegExp(
    "^" +
      g
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*\*\/?/g, "\0")
        .replace(/\*/g, "[^/]*")
        .replace(/\?/g, "[^/]")
        .replace(/\0/g, ".*") +
      "(/.*)?$",
  );
const ignoredBy = (std, rel) => std.ignore.some((g) => globRe(g).test(rel));
const holdsIgnored = (p, dir) =>
  p.ignored.some((i) => i === dir + "/" || i.startsWith(dir + "/"));

// ---- names
const CODE_JS = /\.(js|mjs|cjs|jsx|ts|mts|cts|tsx)$/;
const CODE_OTHER =
  /\.(java|kt|cs|swift|go|rs|c|cc|cpp|h|hpp|rb|php|gd|lua|dart|scala|m)$/; // their language's own naming
// a fixed name may carry a language before its extension: README.de.md, README.zh-CN.md
const FIXED =
  /^(README|CHANGELOG|LICENSE|LICENCE|NOTICE|AUTHORS|COPYING|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|CLAUDE|CLAUDE\.local|AGENTS|GEMINI|SKILL|MEMORY|HANDOFF|DECISIONS|DESIGN|HISTORY|NEWS|CODEOWNERS|INDEX)(\.[a-z]{2}(?:[-_][A-Za-z]{2,4})?)?(\.[A-Za-z]{1,4})?$/;
// names a build tool or platform looks for (Cargo, CMake, Android, Xcode, CocoaPods, Swift, .NET); a picture with a
// screen-scale suffix (Logo@2x.png), which the platform loads by its exact name; a style module named after its
// component (UserCard.module.css beside UserCard.tsx), which follows the code's case
const TOOL_NAMES =
  /\.(woff2?|ttf|otf|eot|csproj|fsproj|vbproj|vcxproj|sln)$|^(Makefile|Dockerfile|Gemfile|Gemfile\.lock|Procfile|Rakefile|Jenkinsfile|Vagrantfile|Brewfile|Podfile|Podfile\.lock|Pipfile|Pipfile\.lock|Cargo\.toml|Cargo\.lock|CMakeLists\.txt|AndroidManifest\.xml|Info\.plist|Package\.swift|Package\.resolved|Directory\.Build\.(props|targets)|__init__\.py|__main__\.py|conftest\.py|gunicorn\.conf\.py)$|^Dockerfile\.|@[23]x\.(png|jpe?g|gif|webp)$|\.module\.(css|scss|sass|less)$/;
// folders a tool names: Python and test runners, GitHub's templates, Next.js route folders ([slug], [...parts],
// (group), (.)intercepted), Xcode's bundles and asset folders
const TOOL_DIRS =
  /^(__pycache__|__tests__|__mocks__|__snapshots__|ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE|DISCUSSION_TEMPLATE)$|^\[{1,2}(\.\.\.)?[A-Za-z0-9_-]+\]{1,2}$|^\([^/)]+\)[^/]*$|\.(xcodeproj|xcworkspace|xcassets|appiconset|imageset|colorset|lproj)$/;
// a build file of the build-tool list above (CocoaPods, Swift, Cargo, CMake, .NET, Gradle): the tool, its other
// files and the project's scripts find the folder that holds it by its name, so that name stays as it is
const BUILD_FILE =
  /^(Podfile|Package\.swift|Cargo\.toml|CMakeLists\.txt|(build|settings)\.gradle(\.kts)?)$|\.(csproj|fsproj|vbproj|vcxproj|sln)$/;
const XCODE_PROJECT = /\.(xcodeproj|xcworkspace)$/;
// a build file that names the projects below it by path ([it, the build file of such a project]): a .sln its .NET
// projects, settings.gradle its Gradle modules, a Cargo workspace its crates, CMake add_subdirectory its folders
const BUILD_PARTS = [
  [/\.sln$/, /\.(csproj|fsproj|vbproj|vcxproj)$/],
  [/^settings\.gradle(\.kts)?$/, /^build\.gradle(\.kts)?$/],
  [/^Cargo\.toml$/, /^Cargo\.toml$/],
  [/^CMakeLists\.txt$/, /^CMakeLists\.txt$/],
];
// the files and folders whose own name a build tool reads, so that name stays: each folder that holds a build file or
// an Xcode project; each folder between a build file of BUILD_PARTS and a project of its tool below it (the build
// file is not read for which projects it names, so this may keep a folder it does not name); below the folder that
// holds an Xcode project, each file or folder its project.pbxproj names as a path (`path = <name>;`, and App/ beside
// App.xcodeproj), when every folder between it and the project folder is named too (a `name =` is a group or build
// setting such as Debug, not a file); a `../` path is resolved from the project folder, each folder and file it
// names there stays, and the named files below it as below the project folder; everything under an Android res/
// folder beside an AndroidManifest.xml (a resource's file name is its id, lowercase_underscore). Only those names
// stay: the other files and folders below them, and anything beside a build file at the top, are still checked.
function toolNamed(root, files) {
  const keep = new Set(),
    all = new Set(files),
    xcode = [], // [the folders its paths start from (the holder first), the names its project.pbxproj gives]
    parts = BUILD_PARTS.map(() => [[], []]); // per tool: [the folders of its top build files, of its projects]
  for (const f of files) {
    const segs = f.split("/");
    const name = segs.pop();
    if (BUILD_FILE.test(name) && segs.length) keep.add(segs.join("/"));
    BUILD_PARTS.forEach(([top, part], t) => {
      if (top.test(name)) parts[t][0].push(segs);
      if (part.test(name)) parts[t][1].push(segs);
    });
    const at = segs.findIndex((s) => XCODE_PROJECT.test(s));
    if (at < 0) continue;
    if (at) keep.add(segs.slice(0, at).join("/"));
    if (name !== "project.pbxproj" || at !== segs.length - 1) continue;
    const holder = segs.slice(0, at),
      bases = [holder],
      names = new Set([segs[at].replace(XCODE_PROJECT, "")]);
    for (const m of read(path.join(root, f)).matchAll(
      /\bpath = (?:"([^"]*)"|([^;\s"]+));/g,
    )) {
      const given = m[1] ?? m[2];
      if (!given.startsWith("../")) {
        for (const n of given.split("/")) names.add(n);
        continue;
      }
      const to = path.posix.join(holder.join("/") || ".", given).split("/");
      if (to[0] === "..") continue; // outside the project
      const up = given.match(/^(\.\.\/)+/)[0].length / 3;
      for (let i = Math.max(holder.length - up, 0); i < to.length; i++)
        keep.add(to.slice(0, i + 1).join("/"));
      bases.push(to);
    }
    xcode.push([bases, names]);
  }
  for (const [tops, projects] of parts)
    for (const top of tops)
      for (const below of projects)
        if (
          below.length > top.length + 1 &&
          top.every((s, i) => below[i] === s)
        )
          for (let i = top.length; i < below.length - 1; i++)
            keep.add(below.slice(0, i + 1).join("/"));
  for (const f of files) {
    const segs = f.split("/");
    for (const [bases, names] of xcode)
      for (const base of bases)
        if (base.every((s, i) => segs[i] === s))
          for (let i = base.length; i < segs.length && names.has(segs[i]); i++)
            keep.add(segs.slice(0, i + 1).join("/"));
    const res = segs.findIndex(
      (s, i) =>
        s === "res" &&
        i < segs.length - 1 &&
        all.has([...segs.slice(0, i), "AndroidManifest.xml"].join("/")),
    );
    if (res >= 0)
      for (let i = res; i < segs.length; i++)
        keep.add(segs.slice(0, i + 1).join("/"));
  }
  return keep;
}
const ISO = /(?<![0-9])(20\d\d)-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])(?![0-9])/;
const validDate = (y, m, d) => {
  const t = new Date(Date.UTC(+y, +m - 1, +d));
  return (
    +y >= 2000 &&
    +y <= 2099 &&
    t.getUTCMonth() === +m - 1 &&
    t.getUTCDate() === +d
  );
};
const splitExt = (name) => {
  if (name.startsWith(".")) return [name, ""];
  const m = /^(.*?)((?:\.[A-Za-z0-9]{1,8})+)$/.exec(name);
  return m && m[1] ? [m[1], m[2]] : [name, ""];
};
// words of a name: split on anything that is not a letter or digit, and at camel humps
const words = (stem) =>
  stem
    .normalize("NFKD")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: the range \x00-\x7f is all of ASCII; this drops every other character
    .replace(/[^\x00-\x7f]/g, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((w) => w.toLowerCase());
const joinWords = (stem, sep) => words(stem).join(sep) || stem;
const styleOf = (stem) =>
  /^[a-z0-9]+(-[a-z0-9]+)+$/.test(stem)
    ? "kebab"
    : /^[a-z0-9]+(_[a-z0-9]+)+$/.test(stem)
      ? "snake"
      : /^[a-z][a-z0-9]*([A-Z][a-z0-9]*)+$/.test(stem)
        ? "camel"
        : /^[A-Z][a-z0-9]*([A-Z][a-z0-9]*)*$/.test(stem)
          ? "pascal"
          : /^[a-z0-9]+$/.test(stem)
            ? "one"
            : "mixed";
const toStyle = (stem, style) => {
  const w = words(stem);
  if (style === "kebab") return w.join("-");
  if (style === "snake") return w.join("_");
  const cap = w.map((x) => x[0].toUpperCase() + x.slice(1)).join("");
  return style === "pascal" ? cap : cap[0].toLowerCase() + cap.slice(1);
};
// a date token in a stem that is not at its start: compact 8 digits, DD-MM-YYYY, or ISO; [token, iso] or null
function dateIn(stem) {
  const iso = ISO.exec(stem);
  if (iso && validDate(iso[1], iso[2], iso[3]))
    return { token: iso[0], iso: iso[0], at: iso.index, kind: "iso" };
  const compact = /(?<![0-9A-Za-z])(20\d\d)(\d\d)(\d\d)(?![0-9A-Za-z])/.exec(
    stem,
  );
  if (compact && validDate(compact[1], compact[2], compact[3]))
    return {
      token: compact[0],
      iso: `${compact[1]}-${compact[2]}-${compact[3]}`,
      at: compact.index,
      kind: "compact",
    };
  const rev =
    /(?<![0-9])(0[1-9]|[12]\d|3[01])-(0[1-9]|1[0-2])-(20\d\d)(?![0-9])/.exec(
      stem,
    );
  if (rev && validDate(rev[3], rev[2], rev[1]))
    return {
      token: rev[0],
      iso: `${rev[3]}-${rev[2]}-${rev[1]}`,
      at: rev.index,
      kind: "reversed",
    };
  return null;
}
const dateFirst = (stem, d) => {
  const rest = (stem.slice(0, d.at) + stem.slice(d.at + d.token.length))
    .replace(/^[-_ .]+|[-_ .]+$/g, "")
    .replace(/[-_ ]{2,}/g, "-");
  return rest ? `${d.iso}-${rest}` : d.iso;
};
const GENERIC =
  /^(untitled|document\d*|new-?file|temp|tmp|misc|stuff|test\d+|copy|new-?folder)$/;
const COPY_SUFFIX = /([-_](old|copy|backup|bak)|\s\(\d+\))$/i;
const COPY_EXT = /\.(bak|orig)(\.[^/]*)?$|~$/i;
// `x.before.py`: the plain name `x.py` it is a copy of, or null
const beforeOf = (name) => {
  const m = /^(.+)\.before(\.[^./]+)$/i.exec(name);
  return m ? m[1] + m[2] : null;
};
const ARCHIVE_DIR =
  /^(archive|archives|old|obsolete|superseded|old-versions.*|backup|backups)$/i;
// `previous` is also a plain word (a Next.js route `app/previous/`): an archive only at the top or right under docs/
const ARCHIVE_TOP = /^previous$/i;
// P9: a folder of one run's output (drafts, an unpacked document, output)
const RUN_DIR = /^(draft-.+|unpacked|outputs?)$/i;
// `draft-` is also a plain word (`src/draft-editor/`): run output only at the top or right under docs/ or a scratch
// folder
const DRAFT_DIR = /^draft-.+$/i;
const SCRATCH_DIR = /^_?(work|scratch|tmp|temp)$/i;
const unpackedDoc = (has, dir) => has.has(`${dir}/[Content_Types].xml`);
// P8: a picture or preview (a still, a video, a PDF render); diagrams (.svg, .mmd, .excalidraw, .drawio) belong in
// docs/ and are not pictures here, nor a docs site's .html page
const PREVIEW_EXT = "png|jpe?g|gif|webp|bmp|mp4|webm|mov";
const PICTURE = new RegExp(`\\.(${PREVIEW_EXT})$`, "i");
// documents a person sends out: their names are read by people, so N1 leaves their case alone
const DOCUMENT = /\.(pdf|docx|xlsx|pptx)$/;
// N8: words that say when or which try a code file was, not what it does. Full month names but `may`, and the
// short forms that are no common word or abbreviation (not mar, jun, aug, sep, oct, dec: dec-to-hex, aug-data)
const MONTHS =
  /^(january|february|march|april|june|july|august|september|october|november|december|jan|feb|apr|jul|sept|nov)$/;
const ROUND_WORDS = [
  "rewrite",
  "new",
  "final",
  "fix",
  "try",
  "attempt",
  "draft",
  "take",
  "round",
];
const ROUND_WORD = new RegExp(`^(${ROUND_WORDS.join("|")})\\d*$`);
// why a code file's stem does not say what it does ("" when it does)
function vagueName(stem) {
  const w = words(stem);
  const month = w.find((x) => MONTHS.test(x));
  if (month) return `"${month}" is a month`;
  const version = w.find((x) => /^v\d+$/.test(x));
  if (version) return `"${version}" is a version`;
  const last = w.filter((x) => !/^\d+$/.test(x)).at(-1);
  return last && ROUND_WORD.test(last) ? `"${last}" says which try` : "";
}

// ---- the text files the reference scan reads (and the apply edits)
const isBinary = (buf) => buf.subarray(0, 8000).includes(0);
function texts(p) {
  if (p._texts) return p._texts;
  const list = new Set(p.files);
  for (const f of [
    ".claude/systems-map.json",
    ".claude/settings.json",
    ".claude/settings.local.json",
  ])
    if (fs.existsSync(path.join(p.root, f))) list.add(f);
  const out = new Map();
  for (const f of list) {
    const full = path.join(p.root, f);
    const size = fs.statSync(full).size;
    if (size > BIG_TEXT) continue;
    const buf = fs.readFileSync(full);
    if (!isBinary(buf)) out.set(f, buf.toString("utf8"));
  }
  return (p._texts = out);
}
// a record describes what was true then: it keeps the old paths as written
const isRecord = (rel) =>
  /^20\d\d-\d\d-\d\d/.test(path.posix.basename(rel)) ||
  rel.startsWith("audits/") ||
  rel.startsWith("docs/decisions/") ||
  rel === "docs/decisions-archive.md" ||
  rel === "CHANGELOG.md";
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const sepRe = (rel) => rel.split("/").map(esc).join("[/\\\\]{1,2}");
const rootRe = (root) => {
  const r = fwd(root).replace(/\/$/, "");
  const m = /^([A-Za-z]):(.*)$/.exec(r);
  return m
    ? `[${m[1].toLowerCase()}${m[1].toUpperCase()}]:${sepRe(m[2].replace(/^\//, "/"))}`
    : sepRe(r);
};
const BEFORE = "(?:^|(?<=[^A-Za-z0-9_.\\-/\\\\]))";
// the path from folder dir ("" for the root) to rel, both project-relative
const relFrom = (dir, rel) => path.posix.relative("/" + dir, "/" + rel);
const dirOf = (rel) =>
  path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
// every place in text that names oldRel: root-relative (bare), absolute, or ./ and ../ relative to the citing file's
// own folder (a ./name in a subfolder is that folder's file, never a root file of the same name)
function refSpans(text, root, citing, oldRel) {
  const spans = [];
  const after = "(?![A-Za-z0-9_\\-/\\\\]|\\.[A-Za-z0-9])";
  const relForm = relFrom(dirOf(citing), oldRel);
  const forms = [
    {
      re: `(?<=${rootRe(root)}[/\\\\]{1,2})${sepRe(oldRel)}${after}`,
      kind: "abs",
    },
    { re: `${BEFORE}${sepRe(oldRel)}${after}`, kind: "root" },
    relForm.startsWith("../")
      ? { re: `${BEFORE}${sepRe(relForm)}${after}`, kind: "rel" }
      : {
          re: `(?<=^|[^A-Za-z0-9_.])\\.[/\\\\]{1,2}${sepRe(relForm)}${after}`,
          kind: "dot",
        },
  ];
  for (const f of forms) {
    const re = new RegExp(f.re, "g");
    let m;
    while ((m = re.exec(text)))
      if (
        !spans.some(
          (s) => m.index < s.at + s.len && s.at < m.index + m[0].length,
        )
      )
        spans.push({ at: m.index, len: m[0].length, kind: f.kind, text: m[0] });
  }
  return spans.sort((a, b) => a.at - b.at);
}
// which other text files name rel (a root file's bare name is its root-relative path)
function namedIn(p, rel) {
  const out = [];
  for (const [f, t] of texts(p))
    if (
      f !== rel &&
      !f.startsWith(rel + "/") &&
      refSpans(t, p.root, f, rel).length
    )
      out.push(f);
  return out;
}
const mentions = (p, rel) => {
  const base = path.posix.basename(rel);
  for (const [f, t] of texts(p))
    if (
      f !== rel &&
      !f.startsWith(rel + "/") &&
      (t.includes(base) || refSpans(t, p.root, f, rel).length)
    )
      return true;
  return false;
};
// P8: the picture names the listed files hold, in lower case, built once per scan. Every file is searched: the
// texts above, and also a file over BIG_TEXT or one in UTF-16 (read in parts); a binary file is not. A name is what
// stands before a picture's extension back to a character no file name holds (/ \ : " < > | ? * or a line break),
// and each tail of it after a character that is no letter or digit (`see my shot.png` gives `my shot.png`,
// `shot.png`); a URL-encoded one is also kept decoded.
const PIC_REF = new RegExp(`\\.(${PREVIEW_EXT})(?![A-Za-z0-9])`, "gi");
const NAME_STOP = new Set([...'/\\:"<>|?*\r\n\t`']);
const ALNUM = /[A-Za-z0-9]/;
function addPictureNames(text, names) {
  PIC_REF.lastIndex = 0;
  let m;
  while ((m = PIC_REF.exec(text))) {
    const end = m.index + m[0].length;
    let at = m.index;
    const limit = Math.max(0, m.index - 255);
    while (at > limit && !NAME_STOP.has(text[at - 1])) at--;
    const seg = text.slice(at, end).toLowerCase();
    let decoded = seg;
    if (seg.includes("%"))
      try {
        decoded = decodeURIComponent(seg);
      } catch {}
    for (const s of decoded === seg ? [seg] : [seg, decoded]) {
      const cut = Math.max(s.lastIndexOf("/"), s.lastIndexOf("\\"));
      const name = s.slice(cut + 1);
      names.add(name);
      for (let i = 0; i < name.length - m[0].length; i++)
        if (!ALNUM.test(name[i])) names.add(name.slice(i + 1));
    }
  }
}
// a file's text in parts of 1 MB, UTF-8 or UTF-16 (a byte-order mark, or NULs on one side of each byte pair); a
// binary file gives nothing. Each part starts with the last 300 characters of the one before, so no name is cut.
function eachTextPart(full, fn) {
  const fd = fs.openSync(full, "r");
  try {
    const buf = Buffer.alloc(1024 * 1024);
    let n = fs.readSync(fd, buf, 0, buf.length, null);
    if (!n) return;
    let enc = "utf8",
      swap = false,
      skip = 0;
    if (buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) skip = 3;
    else if (buf[0] === 0xff && buf[1] === 0xfe) [enc, skip] = ["utf16le", 2];
    else if (buf[0] === 0xfe && buf[1] === 0xff)
      [enc, swap, skip] = ["utf16le", true, 2];
    else if (isBinary(buf.subarray(0, n))) {
      let odd = 0,
        even = 0;
      const head = Math.min(n, 8000);
      for (let i = 0; i < head; i++) if (!buf[i]) i % 2 ? odd++ : even++;
      if (odd > head / 4 && even < odd / 10) enc = "utf16le";
      else if (even > head / 4 && odd < even / 10)
        [enc, swap] = ["utf16le", true];
      else return;
    }
    const dec = new StringDecoder(enc);
    let carry = "";
    for (let first = true; n; first = false) {
      let part = buf.subarray(first ? skip : 0, n);
      if (swap) part = Buffer.from(part.subarray(0, part.length & ~1)).swap16();
      const text = carry + dec.write(part);
      fn(text);
      carry = text.slice(-300);
      n = fs.readSync(fd, buf, 0, buf.length, null);
    }
  } finally {
    fs.closeSync(fd);
  }
}
function pictureNames(p) {
  if (p._pictureNames) return p._pictureNames;
  const names = new Set(),
    t = texts(p);
  for (const [, text] of t) addPictureNames(text, names);
  for (const f of p.files)
    if (!t.has(f) && !PICTURE.test(f))
      eachTextPart(path.join(p.root, f), (text) =>
        addPictureNames(text, names),
      );
  return (p._pictureNames = names);
}
// P8: some file names the picture, by any path or by its bare name, case aside, plain or URL-encoded (a space as %20)
const linked = (p, rel) => {
  const name = path.posix.basename(rel).toLowerCase();
  const names = pictureNames(p);
  return names.has(name) || names.has(encodeURI(name));
};
// P8: docs/ that is a site (MkDocs, Jekyll, Sphinx, VitePress, Docusaurus) may use a picture by a built path or by
// a fixed name (favicon.png), and so may code that reads from docs/: there a picture's move is an ask
const DOCS_SITE =
  /^(mkdocs\.ya?ml|_config\.ya?ml|docusaurus\.config\.[cm]?[jt]s|\.vitepress\/.+|docs\/(mkdocs\.ya?ml|_config\.ya?ml|conf\.py|docusaurus\.config\.[cm]?[jt]s|sidebars\.[cm]?[jt]s|\.vitepress\/.+))$/;
// the same configs as paths to look for, for newPathNotes (no listing of the project)
const DOCS_SITE_FILES = [
  ...["mkdocs.yml", "mkdocs.yaml", "_config.yml", "_config.yaml", ".vitepress"],
  ...["js", "ts", "mjs", "cjs"].map((x) => `docusaurus.config.${x}`),
]
  .flatMap((f) => [f, `docs/${f}`])
  .concat("docs/conf.py");
// a site's own config and scripts in docs/ are not code that belongs elsewhere
const SITE_CODE =
  /^(conf\.py|sidebars\.[cm]?[jt]s|docusaurus\.config\.[cm]?[jt]s)$/;
// a quoted path that starts at docs: "docs/x", 'docs', `./docs/`
const READS_DOCS = /["'`](\.{1,2}[/\\])*docs(["'`]|[/\\])/;

// ---- the rules
function firstCommitDate(p, rel) {
  if (p.git && p.tracked.has(rel)) {
    const out = gitOk(
      p.root,
      "log",
      "--diff-filter=A",
      "--format=%as",
      "--",
      rel,
    )
      .trim()
      .split("\n")
      .filter(Boolean);
    if (out.length) return out[out.length - 1];
  }
  return localDay(fs.statSync(path.join(p.root, rel)).mtime);
}
const isTestName = (name) => /^test[-_]|[._](test|spec)\.[a-z]+$/i.test(name);
const besideTest = (name) => /[._](test|spec)\.[a-z]+$/i.test(name);
const inTestDir = (rel) => /(^|\/)(tests?|__tests__|spec)\//.test(rel);
const SCRIPT_EXT = /\.(mjs|cjs|js|ts|mts|py|sh|ps1|bat|cmd)$/;
const isCodeFile = (f) =>
  SCRIPT_EXT.test(f) || CODE_JS.test(f) || CODE_OTHER.test(f);
function entryPoints(p) {
  const set = new Set(),
    pkgFile = path.join(p.root, "package.json");
  const named = [];
  if (fs.existsSync(pkgFile)) {
    let pkg;
    try {
      pkg = JSON.parse(read(pkgFile));
    } catch (e) {
      stop(`${fwd(pkgFile)} is not valid JSON: ${e.message}`);
    }
    const vals = (v) =>
      typeof v === "string"
        ? [v]
        : v && typeof v === "object"
          ? Object.values(v).flatMap(vals)
          : [];
    named.push(
      ...vals(pkg.main),
      ...vals(pkg.bin),
      ...vals(pkg.exports),
      ...vals(pkg.module),
      ...vals(pkg.files),
      ...vals(pkg.scripts),
    );
  }
  const py = path.join(p.root, "pyproject.toml");
  if (fs.existsSync(py)) named.push(read(py));
  for (const f of p.files)
    if (
      !f.includes("/") &&
      named.some((n) =>
        new RegExp(
          `(^|[^A-Za-z0-9_.-])(\\./)?${esc(f)}($|[^A-Za-z0-9_-])`,
        ).test(n),
      )
    )
      set.add(f);
  return set;
}
const ENTRY =
  /^(index|main|install|uninstall|setup|manage|conftest|app|server|cli|vite\.config|webpack\.config)\.|\.config\.[a-z]+$|^\./;
// Files a tool needs at the project root: never proposed to move (any other root script is an ask, not a fix).
//   gradlew, gradlew.bat: the Gradle wrapper (docs.gradle.org/current/userguide/gradle_wrapper.html)
//   next-env.d.ts, middleware.*, proxy.*, instrumentation.*: Next.js (nextjs.org/docs/app/api-reference/config/typescript,
//     nextjs.org/docs/app/api-reference/file-conventions/middleware, .../file-conventions/instrumentation)
//   manage.py, wsgi.py, asgi.py: Django (docs.djangoproject.com/en/stable/ref/django-admin/,
//     .../howto/deployment/wsgi/, .../howto/deployment/asgi/)
//   gunicorn.conf.py: Gunicorn's default config file, read from the folder it starts in
//     (docs.gunicorn.org/en/stable/configure.html)
const ROOT_TOOL =
  /^(gradlew|gradlew\.bat|next-env\.d\.ts|(middleware|proxy|instrumentation|instrumentation-client)\.(ts|js|mjs)|manage\.py|wsgi\.py|asgi\.py|gunicorn\.conf\.py)$/;
const CLAUDE_TOP =
  /^\.claude\/(settings\.json|settings\.local\.json|systems-map\.json|file-standard\.json|CLAUDE\.md|\.gitignore)$|^\.claude\/(rules|skills|agents|commands|hooks|output-styles|worktrees)\//;

// a name by N1, N2, N4, N6a and N8; [newName, rules, ask]: an ask ("" when none) means the name needs a person,
// so the finding gets no target
function fixName(name, dirRel) {
  if (FIXED.test(name) || TOOL_NAMES.test(name) || name.startsWith("."))
    return [name, [], ""];
  let [stem, ext] = splitExt(name);
  // a Python name's extension is its last one: `a.b.py` is the module `a.b`, never `a` with the extension `.b.py`
  if (/\.py$/i.test(ext)) [stem, ext] = [name.slice(0, -3), name.slice(-3)];
  const rules = [];
  let lowExt = ext.toLowerCase();
  const python = lowExt === ".py";
  const d = dateIn(stem);
  if (python && d)
    return [
      name,
      ["N2"],
      "a dated Python name: it cannot both import and keep its date",
    ];
  // a dotted Python name is a tool's file (those are TOOL_NAMES) or a copy (A2): a person says which
  if (python && stem.includes("."))
    return [
      name,
      ["N2"],
      "a dotted Python name cannot be imported: a tool's file, a copy, or a module to rename?",
    ];
  if (d && d.kind !== "iso" && !python) {
    stem = dateFirst(stem, d);
    rules.push("N6a");
  }
  if (python) {
    if (/[^a-z0-9_]/.test(stem)) {
      stem = joinWords(stem, "_");
      rules.push("N2");
    }
  } else if (CODE_JS.test(lowExt) || CODE_OTHER.test(lowExt)) {
    if (/[^A-Za-z0-9._-]/.test(stem)) {
      stem = stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
      rules.push("N4");
    }
  } else if (DOCUMENT.test(lowExt)) {
    lowExt = ext;
    if (/[^A-Za-z0-9._-]/.test(stem)) {
      stem = stem
        .normalize("NFKD")
        .replace(/\p{M}/gu, "")
        .replace(/[^A-Za-z0-9._-]+/g, "-")
        .replace(/^-|-$/g, "");
      rules.push("N4");
    }
  } else if (/[^a-z0-9.-]/.test(stem) || ext !== lowExt) {
    const n4 = /[^A-Za-z0-9._-]/.test(stem);
    stem = stem.replace(/^(20\d\d-\d\d-\d\d)/, "$1 ");
    stem = joinWords(stem, "-");
    rules.push(n4 ? "N4" : "N1");
  }
  const docsDir = /^(docs|docs\/research|audits)$/.test(dirRel);
  const d2 = dateIn(stem);
  if (docsDir && d2 && d2.kind === "iso" && d2.at > 0) {
    stem = dateFirst(stem, d2);
    rules.push("N6b");
  }
  const code =
    python ||
    CODE_JS.test(lowExt) ||
    CODE_OTHER.test(lowExt) ||
    SCRIPT_EXT.test(lowExt);
  const vague = code ? vagueName(stem) : "";
  if (vague) rules.push("N8");
  return [
    stem + lowExt,
    rules,
    vague
      ? `the name does not say what it does (${vague}): what does it do?`
      : "",
  ];
}
const fixDir = (seg, p, dirRel) => {
  if (
    seg.startsWith(".") ||
    TOOL_DIRS.test(seg) ||
    p.toolNamed.has(dirRel) ||
    holdsIgnored(p, dirRel)
  )
    return seg;
  const pyPackage =
    p.files.some((f) => f.startsWith(dirRel + "/") && f.endsWith(".py")) &&
    /^[a-z0-9_]+$/.test(seg);
  if (pyPackage || /^[a-z0-9.-]+$/.test(seg) || /^v\d+$/.test(seg)) return seg;
  return joinWords(seg, "-");
};

// ---- the scan: findings {id, rules, path, kind, action, target, sha, tracked, why, refs}
const fileSha = (p, rel) => {
  const full = path.join(p.root, rel);
  if (fs.statSync(full).isDirectory())
    return sha(
      p.files
        .filter((f) => f.startsWith(rel + "/"))
        .map((f) => `${f} ${shaFile(path.join(p.root, f))}`)
        .join("\n"),
    );
  return shaFile(full);
};
const unchangedInGit = (p, rel) =>
  p.git &&
  p.files
    .filter((f) => f === rel || f.startsWith(rel + "/"))
    .every((f) => p.tracked.has(f)) &&
  git(p.root, "diff", "--quiet", "HEAD", "--", rel).status === 0;
function scan(root) {
  const p = project(root);
  const found = [],
    notes = [];
  let ignoredCount = 0;
  const live = p.files.filter((f) => {
    if (!ignoredBy(p.standard, f)) return true;
    ignoredCount++;
    return false;
  });
  const has = new Set(live);
  const add = (f) => found.push(f);
  const del = (rel, rules, why) =>
    add({
      rules,
      path: rel,
      action: "delete",
      kind: unchangedInGit(p, rel) ? "fix" : "ask",
      why: unchangedInGit(p, rel)
        ? why
        : `${p.git ? "untracked or changed" : "not a git project"}, no copy in git`,
    });
  const entries = entryPoints(p);
  const hasTests = live.some((f) => /^tests?\//.test(f));
  const testDir = live.some((f) => f.startsWith("tests/")) ? "tests" : "test";
  const scriptsDir =
    !live.some((f) => f.startsWith("scripts/")) &&
    live.some((f) => f.startsWith("tools/"))
      ? "tools"
      : "scripts";
  // A1: archive folders, and P9: run-output folders, each whole (the outermost such folder of a path)
  // never a dot-folder (`.claude/output-styles/`) or what is under one, nor a skill's own folder (`skills/backup/`)
  const archiveAt = (segs, i) =>
    !segs.slice(0, i + 1).some((s) => s.startsWith(".")) &&
    !(segs[0] === "skills" && i === 1) &&
    (ARCHIVE_DIR.test(segs[i]) ||
      (ARCHIVE_TOP.test(segs[i]) &&
        (i === 0 || (i === 1 && segs[0] === "docs"))));
  // not inside an audit run folder (P4 keeps a run's output there), and an output folder of code is a module
  const runAt = (segs, i) => {
    const dir = segs.slice(0, i + 1).join("/");
    if (
      segs.slice(0, i + 1).some((s) => s.startsWith(".")) ||
      (segs[0] === "audits" && i >= 2 && /^20\d\d-\d\d-\d\d/.test(segs[1]))
    )
      return false;
    if (/^outputs?$/i.test(segs[i]))
      return !live.some((f) => f.startsWith(dir + "/") && isCodeFile(f));
    if (DRAFT_DIR.test(segs[i]))
      return (
        i === 0 ||
        (i === 1 && (segs[0] === "docs" || SCRATCH_DIR.test(segs[0])))
      );
    return RUN_DIR.test(segs[i]) || unpackedDoc(has, dir);
  };
  // an archive folder's code is imported when a code file outside it names it on an import line: `import … from
  // '…/previous/…'`, `import('…')`, `require('…')`, or in Python `from previous.x import y`, `import previous`
  const importsOf = (name) => {
    const b = esc(name),
      q = "[^\"'`\\n]*";
    const js = new RegExp(
      `\\bfrom\\s*["'\`]${q}\\b${b}\\b|\\b(import|require)\\s*\\(?\\s*["'\`]${q}\\b${b}\\b`,
    );
    const py = new RegExp(
      `^\\s*(from\\s+\\.*(\\w+\\.)*${b}(\\.\\w+)*\\s+import\\b|import\\s+(\\w+\\.)*${b}\\b)`,
      "m",
    );
    return (f, t) => (f.endsWith(".py") ? py : js).test(t);
  };
  const archives = new Set(),
    runs = new Set();
  for (const f of live) {
    const segs = f.split("/").slice(0, -1);
    const at = segs.findIndex((_s, i) => archiveAt(segs, i) || runAt(segs, i));
    if (at === -1) continue;
    const dir = segs.slice(0, at + 1).join("/");
    (archiveAt(segs, at) ? archives : runs).add(dir);
  }
  for (const dir of runs) {
    const n = live.filter((f) => f.startsWith(dir + "/")).length;
    add({
      rules: ["P9"],
      path: dir,
      action: null,
      kind: "ask",
      why: `one run's output, ${n} file${n === 1 ? "" : "s"}: keep it in the project?`,
    });
  }
  for (const dir of archives) {
    const inside = live.filter((f) => f.startsWith(dir + "/"));
    const code = inside.filter((f) => CODE_JS.test(f) || f.endsWith(".py"));
    const importer = importsOf(path.posix.basename(dir));
    const imported =
      code.length &&
      [...texts(p)].some(
        ([f, t]) => !f.startsWith(dir + "/") && isCodeFile(f) && importer(f, t),
      );
    // a folder of code may be a module with an archive's name: a person says, never a fix
    if (imported || inside.some(isCodeFile))
      add({
        rules: ["A1"],
        path: dir,
        action: "delete",
        kind: "ask",
        why: imported ? "holds code imported from outside it" : "holds code",
      });
    else del(dir, ["A1"], `${inside.length} files, all in git`);
  }
  const inArchive = (f) =>
    [...archives, ...runs].some((d) => f.startsWith(d + "/"));
  // P8: a docs site's config, and the first code file outside docs/ that names a path in docs/ (looked up once)
  const docsSite = live.find((f) => DOCS_SITE.test(f));
  let reader;
  const docsReader = () =>
    reader !== undefined
      ? reader
      : (reader =
          [...texts(p)].find(
            ([f, t]) =>
              !f.startsWith("docs/") && isCodeFile(f) && READS_DOCS.test(t),
          )?.[0] ?? null);
  const js = new Map(); // folder -> JS code files, for N3
  for (const rel of live) {
    if (inArchive(rel)) continue;
    const name = path.posix.basename(rel),
      dirRel = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    const [stem, ext] = splitExt(name);
    // A2: a versioned copy
    const plain = (s) => has.has((dirRel ? dirRel + "/" : "") + s + ext);
    const before = beforeOf(name);
    if (
      COPY_EXT.test(name) ||
      (before && has.has((dirRel ? dirRel + "/" : "") + before)) ||
      (COPY_SUFFIX.test(stem) && plain(stem.replace(COPY_SUFFIX, ""))) ||
      (/-v\d+$/.test(stem) && plain(stem.replace(/-v\d+$/, "")))
    ) {
      del(rel, ["A2"], "in git");
      continue;
    }
    // R2: a dated archive of decisions; R1: a handoff or decisions copy
    const low = name.toLowerCase(),
      record = /\.(md|txt)$/.test(low);
    if (/^decisions-archive-20\d\d-\d\d-\d\d\.md$/.test(low)) {
      add({
        rules: ["R2"],
        path: rel,
        action: "merge",
        target: "docs/decisions-archive.md",
        kind: "fix",
        why: "",
      });
      continue;
    }
    const handoffCopy =
      record &&
      name !== "HANDOFF.md" &&
      /handoff/.test(low) &&
      !rel.startsWith("docs/research/") &&
      !rel.startsWith("docs/decisions/") &&
      (/^(history-|handoff-)/.test(low) ||
        /-handoff\.[a-z]+$/.test(low) ||
        ISO.test(low));
    const decisionsCopy =
      record &&
      /decisions/.test(low) &&
      rel !== "DECISIONS.md" &&
      rel !== "docs/decisions-archive.md" &&
      !rel.startsWith("docs/research/") &&
      !rel.startsWith("docs/decisions/") &&
      (/^(history-|decisions-)/.test(low) ||
        ISO.test(low) ||
        /-decisions\.[a-z]+$/.test(low));
    if (handoffCopy || decisionsCopy) {
      del(rel, ["R1"], "in git");
      continue;
    }
    // names: each folder, then the file
    const segs = dirRel ? dirRel.split("/") : [];
    const newSegs = segs.map((s, i) =>
      fixDir(s, p, segs.slice(0, i + 1).join("/")),
    );
    const rules = newSegs.some((s, i) => s !== segs[i]) ? ["N1"] : [];
    let [newName, nameRules, nameAsk] = p.toolNamed.has(rel)
      ? [name, [], ""]
      : fixName(name, dirRel);
    rules.push(...nameRules);
    let newDir = newSegs.join("/"),
      kind = "fix",
      why = "";
    const bareStem = splitExt(newName)[0].replace(/^20\d\d-\d\d-\d\d-?/, "");
    if (GENERIC.test(bareStem) || newSegs.some((s) => GENERIC.test(s))) {
      rules.push("N7");
      kind = "ask";
      why = "a generic name: what is it?";
    }
    // N6c: an undated file directly in docs/research/ or audits/
    if (
      /^(docs\/research|audits)$/.test(dirRel) &&
      !FIXED.test(name) &&
      !/^20\d\d-\d\d-\d\d/.test(newName) &&
      !SCRIPT_EXT.test(name)
    ) {
      newName = `${firstCommitDate(p, rel)}-${newName}`;
      rules.push("N6c");
    }
    // places
    const isCode = SCRIPT_EXT.test(name) || CODE_JS.test(name);
    if (!dirRel) {
      if (isTestName(name) && isCode && hasTests) {
        newDir = testDir;
        rules.push("P2a");
      } else if (
        isCode &&
        !entries.has(rel) &&
        !ENTRY.test(name) &&
        !ROOT_TOOL.test(name)
      ) {
        newDir = scriptsDir;
        rules.push("P1");
        kind = "ask";
        why =
          why || "a root script: does a tool or a command need it at the root?";
      } else if (
        /\.md$/i.test(name) &&
        !FIXED.test(name) &&
        !entries.has(rel)
      ) {
        newDir = "docs";
        rules.push("P3");
      }
    } else if (
      segs.length === 1 &&
      isTestName(name) &&
      !besideTest(name) &&
      isCode &&
      hasTests &&
      !inTestDir(rel)
    ) {
      newDir = testDir;
      rules.push("P2a");
    }
    // P8: docs/ holds text and diagrams. A picture or preview no file names goes to shown/ (git-ignored, for the
    // person to look at): it leaves git, its history stays. One a page or code names stays, as moving it would break
    // the link; in a docs site, or with code that reads from docs/, the move is asked. Code is asked about, but not a
    // dot-folder's or a site's own (docs/.vitepress/, docs/conf.py, and any code of a docs site).
    let noTarget = false;
    if (segs[0] === "docs") {
      if (PICTURE.test(name) && !linked(p, rel)) {
        newDir = ["shown", ...newSegs.slice(1)].join("/");
        rules.push("P8");
        const reader = docsSite ? null : docsReader();
        if (docsSite || reader) {
          kind = "ask";
          why = [
            why,
            `no file names it, but ${docsSite ? `docs/ is a site (${docsSite})` : `${reader} reads from docs/`}, which may use it by a built path: move it to shown/?`,
          ]
            .filter(Boolean)
            .join("; ");
        } else if (p.tracked.has(rel))
          why = [why, "no file names it; it leaves git, its history stays"]
            .filter(Boolean)
            .join("; ");
      } else if (
        isCodeFile(name) &&
        !docsSite &&
        !segs.some((s) => s.startsWith(".")) &&
        !SITE_CODE.test(name)
      ) {
        rules.push("P8");
        kind = "ask";
        noTarget = true;
        why =
          why ||
          "code in docs/, which holds text and diagrams: where does it go (scripts/, the source folder)?";
      }
    }
    if (dirRel === "audits" && SCRIPT_EXT.test(name)) {
      rules.push("P4");
      kind = "ask";
      why = "runs again (scripts/) or one run's (audits/<date>-<topic>/)?";
    }
    if (rel.startsWith(".claude/") && !CLAUDE_TOP.test(rel)) {
      rules.push("P5");
      kind = "ask";
      why = "not a place Claude Code reads";
    }
    if (/^\.claude\/skills\/[^/]+\/./.test(rel)) {
      const skill = rel.split("/").slice(0, 3).join("/");
      if (!has.has(`${skill}/SKILL.md`) && !found.some((x) => x.path === skill))
        add({
          rules: ["P5"],
          path: skill,
          action: null,
          kind: "ask",
          why: "a skill folder without SKILL.md",
        });
    }
    if (CODE_JS.test(name)) js.set(dirRel, [...(js.get(dirRel) || []), rel]);
    if (path.posix.basename(rel) === "CLAUDE.md") {
      const n = texts(p).get(rel)?.split("\n").length ?? 0;
      if (n > 200)
        notes.push({
          rules: ["P6"],
          path: rel,
          why: `${n} lines (under 200 is the standard)`,
        });
    }
    const abs = fwd(path.join(p.root, rel));
    if (abs.length >= 240)
      notes.push({ rules: ["P7"], path: rel, why: `${abs.length} characters` });
    // N8 or a dated Python name: a person names it, so no target
    // N8 or a dated or dotted Python name: a person names it, so no target; the why keeps the rest of the fix
    const mechanical = (newDir ? newDir + "/" : "") + newName;
    if (nameAsk) {
      kind = "ask";
      why = [
        nameAsk,
        why,
        mechanical !== rel ? `the other rules give ${mechanical}` : "",
      ]
        .filter(Boolean)
        .join("; ");
    } else if (noTarget && mechanical !== rel)
      why = `${why}; the other rules give ${mechanical}`;
    const target = nameAsk || noTarget ? rel : mechanical;
    if (rules.length)
      add({
        rules,
        path: rel,
        action: target === rel ? null : "move",
        target: target === rel ? undefined : target,
        kind,
        why,
      });
  }
  // N3: a folder whose JS/TS code files mix styles; the minority goes to the majority
  for (const [dirRel, list] of js) {
    const styled = list
      .filter((rel) => !ENTRY.test(path.posix.basename(rel)))
      .map((rel) => {
        const [stem, ext] = splitExt(path.posix.basename(rel));
        let s = styleOf(stem);
        if (s === "pascal" && /\.(tsx|jsx)$/.test(ext)) s = "camel";
        return { rel, stem, ext, s };
      })
      .filter((x) => x.s !== "one" && x.s !== "mixed");
    const count = {};
    for (const x of styled) count[x.s] = (count[x.s] || 0) + 1;
    const styles = Object.keys(count).sort((a, b) => count[b] - count[a]);
    if (styles.length < 2) continue;
    const tie = count[styles[0]] === count[styles[1]];
    for (const x of styled.filter((y) => y.s !== styles[0])) {
      const to =
        (dirRel ? dirRel + "/" : "") +
        toStyle(
          x.stem,
          styles[0] === "camel" && /\.(tsx|jsx)$/.test(x.ext)
            ? "pascal"
            : styles[0],
        ) +
        x.ext;
      const prior = found.find((f) => f.path === x.rel);
      if (prior) {
        prior.rules.push("N3");
        continue;
      }
      add({
        rules: ["N3"],
        path: x.rel,
        action: "move",
        target: to,
        kind: tie ? "ask" : "fix",
        why: tie ? `as many ${styles[0]} as ${styles[1]} names here` : "",
      });
    }
  }
  // P2b: both test styles
  const besides = live.filter(
    (f) => besideTest(path.posix.basename(f)) && !inTestDir(f),
  ).length;
  const inTests = live.filter(
    (f) => inTestDir(f) && isTestName(path.posix.basename(f)),
  ).length;
  if (Math.min(besides, inTests) >= 3)
    notes.push({
      rules: ["P2b"],
      path: ".",
      why: `${inTests} tests in a tests folder, ${besides} beside the code: one style per project`,
    });
  // R3: an unlinked old record (a dated doc, or an audit run folder)
  const cutoff = new Date(Date.now() - OLD_DAYS * 864e5)
    .toISOString()
    .slice(0, 10);
  const units = new Set();
  for (const rel of live) {
    const parts = rel.split("/");
    const unit =
      parts[0] === "audits" && parts.length > 2
        ? parts.slice(0, 2).join("/")
        : (parts[0] === "docs" && parts.length === 2) ||
            (rel.startsWith("docs/research/") && parts.length === 3)
          ? rel
          : null;
    const d = unit && /^(20\d\d-\d\d-\d\d)/.exec(path.posix.basename(unit));
    if (d && d[1] < cutoff && !found.some((f) => f.path === unit))
      units.add(unit);
  }
  for (const unit of units)
    if (!mentions(p, unit))
      notes.push({
        rules: ["R3"],
        path: unit,
        why: `older than ${OLD_DAYS} days, nothing links to it: keep or delete?`,
      });
  // a target that clashes, or that still breaks a rule, becomes an ask
  const targets = new Map();
  for (const f of found.filter((x) => x.target))
    targets.set(
      f.target.toLowerCase(),
      (targets.get(f.target.toLowerCase()) || 0) + 1,
    );
  for (const f of found.filter(
    (x) => x.action === "move" && x.kind === "fix",
  )) {
    const taken =
      targets.get(f.target.toLowerCase()) > 1 ||
      (fs.existsSync(path.join(p.root, f.target)) &&
        f.target.toLowerCase() !== f.path.toLowerCase());
    const broken = breaks(f.target, p, f.path);
    if (taken || broken) {
      f.kind = "ask";
      f.why = taken
        ? `${f.target} is taken`
        : `${f.target} still breaks ${broken}`;
    }
  }
  const all = [
    ...found.sort((a, b) => a.path.localeCompare(b.path)),
    ...notes.map((n) => ({ ...n, kind: "note", action: null })),
  ];
  all.forEach((f, i) => {
    f.id = `F${i + 1}`;
    if (f.kind === "note") return;
    f.sha = fileSha(p, f.path);
    f.tracked =
      p.git &&
      (p.tracked.has(f.path) ||
        p.files.some((x) => x.startsWith(f.path + "/") && p.tracked.has(x)));
    // a P8 picture moves only when no file names it, so nothing refers to it (and 300 pictures need no 300 searches)
    if (f.action)
      f.refs =
        f.rules.includes("P8") && PICTURE.test(f.path)
          ? []
          : namedIn(p, f.path);
  });
  const fix = all.filter((f) => f.kind === "fix").length,
    ask = all.filter((f) => f.kind === "ask").length;
  const refFiles = new Set(all.flatMap((f) => f.refs || [])).size;
  return {
    project: fwd(p.root),
    git: p.git,
    files: live.length,
    ignored: ignoredCount,
    fix,
    ask,
    notes: all.length - fix - ask,
    moves: all.filter((f) => f.action === "move" && f.kind === "fix").length,
    refFiles,
    minutes: minutesFor(fix, ask, refFiles),
    findings: all,
    p,
  };
}
// the name rules a target path still breaks ("" when none). from: the path it moves from; a name a build tool reads
// there keeps its name at the same depth when only a folder above it is renamed, so p.toolNamed is looked up by the
// path it had. Without a project (an outside caller), only the name rules count.
function breaks(rel, p = { toolNamed: new Set() }, from = rel) {
  const all = rel.split("/"),
    old = from.split("/");
  const kept = (i) =>
    p.toolNamed.has(all.slice(0, i + 1).join("/")) ||
    (old.length === all.length &&
      old[i] === all[i] &&
      p.toolNamed.has(old.slice(0, i + 1).join("/")));
  if (all.some((s, i) => !kept(i) && /[^A-Za-z0-9._-]/.test(s))) return "N4";
  const segs = all.slice(0, -1),
    name = all.at(-1),
    dirRel = segs.join("/");
  const [fixed, r, ask] = kept(segs.length)
    ? [name, [], ""]
    : fixName(name, dirRel);
  if (fixed !== name || ask) return r.join("+");
  if (
    segs.some(
      (s, i) =>
        !s.startsWith(".") &&
        !TOOL_DIRS.test(s) &&
        !kept(i) &&
        !/^[a-z0-9._-]+$/.test(s),
    )
  )
    return "N1";
  return "";
}

// ---- report, status, skip
const what = (f) =>
  f.action === "move" && f.target
    ? `→ ${f.target}`
    : f.action === "delete"
      ? "→ delete"
      : f.action === "merge"
        ? `→ merged into ${f.target}`
        : "";
function printReport(r) {
  if (JSON_OUT) {
    const { p, ...rest } = r;
    return console.log(JSON.stringify(rest, null, 2));
  }
  console.log(
    `file-check ${r.project} · ${r.files} files · ${r.fix} to fix · ${r.ask} to ask · ${r.notes} notes · ${r.ignored} ignored (.claude/file-standard.json)`,
  );
  if (r.fix + r.ask)
    console.log(
      `Reorganize: about ${r.minutes} minutes (${r.moves} moves, ${r.refFiles} files whose references change)`,
    );
  for (const f of r.findings) printLine(f);
}
function printLine(f) {
  const tail = [
    f.why,
    f.refs?.length
      ? `named in ${f.refs.length > 3 ? `${f.refs.length} files` : f.refs.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("; ");
  console.log(
    `${f.id.padEnd(4)}${f.rules.join("+").padEnd(7)} ${f.kind.padEnd(6)}${f.path} ${what(f)}${tail ? `   (${tail})` : ""}`.replace(
      / {2,}\(/,
      "   (",
    ),
  );
}
const readState = () => {
  if (!fs.existsSync(STATE))
    stop(
      `${fwd(STATE)} is missing, so this setup was not put in place by install.mjs.`,
    );
  return JSON.parse(read(STATE));
};
const saveState = (change) => {
  const next = { ...readState(), ...change };
  fs.writeFileSync(`${STATE}.part`, JSON.stringify(next, null, 2) + "\n");
  fs.renameSync(`${STATE}.part`, STATE);
};
// a home is the folder of a state.written key that ends in /CLAUDE.md under state.projects (as own-rules.mjs --homes)
const homes = (state) => {
  if (!state.projects) return [];
  const root = fwd(state.projects).replace(/\/$/, "") + "/";
  return [
    ...new Set(
      Object.keys(state.written || {})
        .filter((k) => k.endsWith("/CLAUDE.md") && fwd(k).startsWith(root))
        .map((k) => fwd(path.dirname(k))),
    ),
  ]
    .filter((h) => fs.existsSync(h))
    .sort();
};
const dirty = (dir) =>
  isGitRoot(dir) && gitOk(dir, "status", "--porcelain").trim() !== "";
function statusOf(state) {
  const rows = homes(state).map((h) => {
    const r = scan(h);
    return { home: h, r, dirty: r.fix + r.ask > 0 && dirty(h) };
  });
  const open = rows.filter((x) => !x.dirty && x.r.fix + x.r.ask > 0);
  const key = open.length
    ? sha(
        open
          .map(
            (x) =>
              `${x.home} ${sha(
                x.r.findings
                  .filter((f) => f.kind !== "note")
                  .map((f) => `${f.rules.join("+")} ${f.path}`)
                  .join("\n"),
              )}`,
          )
          .sort()
          .join("\n"),
      ).slice(0, 16)
    : null;
  return { rows, open, key };
}
function status() {
  if (!HOMES) stop("--status works on the project homes: add --homes.");
  const state = readState();
  const { rows, open, key } = statusOf(state);
  console.log(`file-check status · ${rows.length} homes`);
  for (const { home: h, r, dirty: d } of rows) {
    const counts = `${r.fix} fix · ${r.ask} ask · ${r.notes} notes`;
    console.log(
      `  ${h}: ${d ? `skipped until its changes are committed (${counts})` : r.fix + r.ask ? `${counts} · about ${r.minutes} minutes` : r.notes ? `${r.notes} notes` : "clean"}`,
    );
  }
  if (key) console.log(`pending: ${key}`);
  const files = open.reduce((n, x) => n + x.r.fix + x.r.ask, 0),
    minutes = open.reduce((n, x) => n + x.r.minutes, 0);
  const skippedDirty = rows.filter((x) => x.dirty).map((x) => x.home);
  if (key && key !== state.fileOffered) {
    console.log(
      `offer: ${open.length} ${open.length === 1 ? "folder" : "folders"}, ${files} files to reorganize, about ${minutes} minutes` +
        `${skippedDirty.length ? `; skipped until committed: ${skippedDirty.join(", ")}` : ""} (yes: /file-upkeep; not now: ${FC} --skip --homes)`,
    );
  } else
    console.log(
      `offer: none${key ? " (offered before for this pending key)" : ""}`,
    );
}
function skip() {
  if (!HOMES) stop("--skip works on the project homes: add --homes.");
  const { key } = statusOf(readState());
  saveState({ fileOffered: key || undefined });
  console.log(
    key
      ? `skipped: pending ${key} marked offered; run /file-upkeep any time`
      : "skipped: nothing pending",
  );
}
function report() {
  if (HOMES) {
    const list = homes(readState());
    if (!list.length)
      console.log("file-check: no project homes in ~/.claude/setup-state.json");
    for (const h of list) printReport(scan(h));
    return;
  }
  const at = args.indexOf("--report"),
    folder =
      args[at + 1] && !args[at + 1].startsWith("--")
        ? args[at + 1]
        : process.cwd();
  printReport(scan(folder));
}

// ---- the projects folder (P10): one folder per project family, plus archive/
// The setup's projects folder: FILE_STANDARD_PROJECTS (tests), else setup-state.json's projects, else C:\Projects
// when it is there, else null.
function projectsRoot(homeDir) {
  if (process.env.FILE_STANDARD_PROJECTS)
    return path.resolve(process.env.FILE_STANDARD_PROJECTS);
  const f = path.join(homeDir, ".claude", "setup-state.json");
  if (fs.existsSync(f)) {
    let s;
    try {
      s = JSON.parse(read(f));
    } catch (e) {
      throw new Error(`${fwd(f)} is not valid JSON: ${e.message}`);
    }
    if (s.projects) return path.resolve(s.projects);
  }
  return process.platform === "win32" && fs.existsSync("C:\\Projects")
    ? "C:\\Projects"
    : null;
}
// Only the top level is listed. Of a folder, only whether it holds .git or CLAUDE.md is looked at (and, for one that
// does not, whether a folder in it does): nothing in it is read. Dot-entries, archive/ and the system's own files are
// not judged.
const ROOT_SKIP =
  /^[.$]|^(archive|desktop\.ini|thumbs\.db|system volume information)$/i;
const isProject = (dir) =>
  fs.existsSync(path.join(dir, ".git")) ||
  fs.existsSync(path.join(dir, "CLAUDE.md"));
const holdsProject = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .some((e) => e.isDirectory() && isProject(path.join(dir, e.name)));
const MOVE_TOOL = "move-project.mjs";
// a root entry's family name: a folder's name, a file's name without its extension, in lower case
const baseOf = (e) => (e.dir ? e.name : splitExt(e.name)[0]).toLowerCase();
// the P10 findings of a listing [{name, dir}]. only: judge that one name (the others still make up the families);
// made false: the entry is about to be made, so a new folder is not asked about for holding no project yet;
// families: the family names the root's .claude/file-standard.json sets
function rootFindings(
  root,
  entries,
  { only, made = true, families = [] } = {},
) {
  const proj = new Map();
  const project = (e) => {
    if (!e.dir) return false;
    if (!proj.has(e.name)) proj.set(e.name, isProject(path.join(root, e.name)));
    return proj.get(e.name);
  };
  const list = entries.filter((e) => !ROOT_SKIP.test(e.name));
  const names = new Set(list.map((e) => e.name.toLowerCase()));
  const out = [],
    done = new Set();
  const add = (e, target, why) => {
    done.add(e);
    out.push({
      rules: ["P10"],
      path: e.name,
      action: target ? "move" : null,
      target: target || undefined,
      kind: target ? "fix" : "ask",
      why,
    });
  };
  // a project's git worktrees beside it, and an old copy
  for (const e of list) {
    const wt = e.dir && /^(.+)_worktrees$/i.exec(e.name);
    const old = /^(.+)-old$/i.exec(e.dir ? e.name : splitExt(e.name)[0]);
    if (wt)
      add(
        e,
        null,
        `the git worktrees of ${wt[1]}${names.has(wt[1].toLowerCase()) ? ", beside it" : ""}: remove the finished ones (git worktree remove); ${MOVE_TOOL} moves the rest with their project`,
      );
    else if (old)
      add(
        e,
        `archive/${e.name}`,
        `an old copy${names.has(old[1].toLowerCase()) ? ` of ${old[1]}` : ""}: it goes under archive/${project(e) ? `, with ${MOVE_TOOL}` : ""}`,
      );
  }
  // a family: <name>-<part> (also _, a space or a dot) beside <name>, a folder or a file's name, case aside, with a
  // project among them; all go in one folder <name>/. A family's name is an entry's name, the name before the first
  // - or _ that two or more entries share (game-port and game-invite: game), or one the root's settings set.
  const SEP = /[-_ .]/;
  const set = new Set(families.map((n) => n.trim().toLowerCase()));
  const prefixes = new Map();
  for (const x of list.filter((y) => !done.has(y))) {
    const pre = baseOf(x).split(/[-_]/)[0];
    if (pre) prefixes.set(pre, (prefixes.get(pre) || 0) + 1);
  }
  const shortFirst = [
    ...new Set([
      ...list.filter((x) => !done.has(x)).map(baseOf),
      ...[...prefixes].filter(([, n]) => n > 1).map(([pre]) => pre),
      ...set,
    ]),
  ].sort((a, b) => a.length - b.length);
  for (const b of shortFirst) {
    const free = list.filter((x) => !done.has(x));
    const bare = free.filter((x) => baseOf(x) === b);
    const parts = free.filter(
      (x) => baseOf(x).startsWith(b) && SEP.test(baseOf(x)[b.length] || ""),
    );
    const all = [...bare, ...parts];
    if (!parts.length || !all.some(project)) continue;
    // a family needs a bare entry that is a project, a document or a folder that holds projects (the family's
    // folder), or two or more parts, or a set name; one part beside a plain folder or file (tools/ and tools-cli/)
    // is asked about
    const named =
      set.has(b) ||
      bare.some(
        (x) =>
          project(x) ||
          (!x.dir && DOCUMENT.test(x.name.toLowerCase())) ||
          (x.dir && holdsProject(path.join(root, x.name))),
      );
    if (!named && parts.length < 2) {
      if (!bare.length) continue;
      for (const x of parts)
        add(
          x,
          null,
          `beside ${bare.map((y) => y.name + (y.dir ? "/" : "")).join(", ")}, which is no project: the same family (one folder ${b}/), or apart?`,
        );
      continue;
    }
    const home = bare.find((x) => x.dir);
    if (home && project(home))
      for (const x of all)
        add(
          x,
          null,
          `the ${b} family, ${all.length} entries: one folder for them, but ${home.name} is a project itself; which folder name?`,
        );
    else {
      const to = home ? home.name : b;
      for (const x of all.filter((y) => y !== home))
        add(
          x,
          `${to}/${x.name}`,
          `the ${b} family, ${all.length} entries: one folder ${to}/${project(x) ? `; ${MOVE_TOOL} moves a project` : ""}`,
        );
      if (home) done.add(home);
    }
  }
  // the rest: a loose file, or a folder that is no project and holds none
  for (const e of list) {
    if (done.has(e)) continue;
    if (!e.dir)
      add(
        e,
        null,
        "a loose file in the projects folder: which project is it part of, or archive/?",
      );
    else if (
      made &&
      !project(e) &&
      (only === undefined || only === e.name) &&
      !holdsProject(path.join(root, e.name))
    )
      add(
        e,
        null,
        "no git and no CLAUDE.md: a project (/new-project), part of one, or archive/?",
      );
  }
  return out
    .filter((f) => only === undefined || f.path === only)
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((f, i) => ({ id: `F${i + 1}`, ...f }));
}
function rootReport() {
  const named = flagValue("--root");
  const folder = named || projectsRoot(home);
  if (!folder)
    stop(
      "no projects folder: name one (--root <folder>), or set projects in ~/.claude/setup-state.json.",
    );
  const root = path.resolve(folder);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory())
    stop(`${fwd(root)} is not a folder.`);
  const entries = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() || e.isFile())
    .map((e) => ({ name: e.name, dir: e.isDirectory() }));
  const findings = rootFindings(root, entries, {
    families: standardFile(root).families,
  });
  const fix = findings.filter((f) => f.kind === "fix").length;
  const r = {
    root: fwd(root),
    entries: entries.length,
    fix,
    ask: findings.length - fix,
    findings,
  };
  if (JSON_OUT) return console.log(JSON.stringify(r, null, 2));
  console.log(
    `file-check --root ${r.root} · ${r.entries} entries · ${r.fix} to fix · ${r.ask} to ask · report only`,
  );
  for (const f of findings) printLine(f);
  if (fix)
    console.log(
      `A project folder moves with node ${tilde(path.join(CLAUDE, "skills", "file-upkeep", MOVE_TOOL))} <from> <to>, which fixes what is keyed by its path.`,
    );
}

// ---- one path about to be made (the creation-time note)
const NOTE_WHY = {
  N1: "names are lowercase, words joined by hyphens",
  N2: "Python names are lowercase with underscores",
  N3: "JS and TS names follow the folder's style",
  N4: "names hold ASCII letters, digits, - _ . only",
  N6a: "a date is YYYY-MM-DD at the start",
  N6b: "a date is YYYY-MM-DD at the start",
  N6c: "a record here starts with its date",
  P3: "notes go in docs/",
};
const sameDir = (a, b) => {
  const real = (p) => {
    try {
      return fs.realpathSync.native(p);
    } catch {
      return path.resolve(p);
    }
  };
  return fwd(real(a)).toLowerCase() === fwd(real(b)).toLowerCase();
};
// newPathNotes(projectRoot, rel): what the file standard says about the path rel (project-relative) before it is
// made: [{rule, why, target}], target project-relative or null (a person names it). Checks that one path and a
// listing of its folder only: no project scan, no git call but one `git check-ignore` (the path, and the folder's
// entries so its git-ignored ones are left out). An existing path, a git-ignored one, one in a submodule or one
// .claude/file-standard.json ignores gives []. When projectRoot is the projects folder
// (projectsRoot), rel's first part is judged by P10. Throws on a fault (a broken file-standard.json), never exits.
function newPathNotes(projectRoot, rel) {
  const fail = (m) => {
    throw new Error(m);
  };
  const root = path.resolve(projectRoot);
  rel = fwd(rel).replace(/^\.\//, "");
  if (!rel || rel.startsWith("../") || path.isAbsolute(rel))
    fail(`${rel} is not a path inside ${fwd(root)}.`);
  if (fs.existsSync(path.join(root, rel))) return [];
  const segs = rel.split("/"),
    name = segs.pop(),
    dirRel = segs.join("/");
  const listing = (dir) =>
    fs.existsSync(path.join(root, dir))
      ? fs.readdirSync(path.join(root, dir), { withFileTypes: true })
      : [];
  const projects = projectsRoot(os.homedir());
  if (projects && sameDir(projects, root)) {
    const top = segs[0] ?? name;
    if (segs.length && fs.existsSync(path.join(root, top))) return [];
    const entries = listing("")
      .filter((e) => e.isDirectory() || e.isFile())
      .map((e) => ({ name: e.name, dir: e.isDirectory() }));
    entries.push({ name: top, dir: segs.length > 0 });
    return rootFindings(root, entries, {
      only: top,
      made: false,
      families: standardFile(root, fail).families,
    }).map((f) => ({ rule: "P10", why: f.why, target: f.target || null }));
  }
  if (
    segs.some((s) => WALK_SKIP.has(s)) ||
    skipped(rel) ||
    ignoredBy(standardFile(root, fail), rel)
  )
    return [];
  // git runs in the nearest folder of the path that exists, with the path from there: an inner repository's own
  // .gitignore counts, also under a folder that is no git project. A path in a submodule (below the project, a .git
  // file pointing into modules/) is another project's: []. The same one call sorts out the folder's git-ignored
  // entries, so the listing is what scan() sees.
  let base = path.dirname(path.join(root, rel));
  while (!fs.existsSync(base) && path.resolve(base) !== root)
    base = path.dirname(base);
  for (let d = base; path.resolve(d) !== root; d = path.dirname(d)) {
    const dotGit = path.join(d, ".git");
    if (
      fs.existsSync(dotGit) &&
      fs.statSync(dotGit).isFile() &&
      /[/\\]modules[/\\]/.test(read(dotGit))
    )
      return [];
    if (path.dirname(d) === d) break;
  }
  const fromBase = fwd(path.relative(base, path.join(root, rel)));
  const inFolder =
    path.resolve(base) === path.resolve(root, dirRel)
      ? listing(dirRel)
          .filter((e) => e.name !== ".git")
          .map((e) => ({ e, as: e.name + (e.isDirectory() ? "/" : "") }))
      : [];
  const ig = spawnSync("git", ["-C", base, "check-ignore", "--stdin", "-z"], {
    encoding: "utf8",
    input: [fromBase, ...inFolder.map((x) => x.as)].join("\0") + "\0",
  });
  if (ig.error) fail(`git could not start: ${ig.error.message}`);
  if (ig.status === 128 && /in submodule/i.test(ig.stderr)) return [];
  if (ig.status > 1 && !/not a git repository/i.test(ig.stderr))
    fail(`git check-ignore failed in ${fwd(base)}: ${ig.stderr.trim()}`);
  const ignored = new Set(ig.status > 1 ? [] : zlist(ig.stdout));
  if (ignored.has(fromBase)) return [];
  const seen = inFolder.filter((x) => !ignored.has(x.as)).map((x) => x.e);
  const here = new Set(seen.map((e) => e.name));
  // A2: a copy beside the plain file
  const [stem0, ext0] = splitExt(name);
  const before = beforeOf(name);
  const copyOf =
    (before && here.has(before) && before) ||
    (COPY_SUFFIX.test(stem0) &&
      here.has(stem0.replace(COPY_SUFFIX, "") + ext0) &&
      stem0.replace(COPY_SUFFIX, "") + ext0) ||
    (/-v\d+$/.test(stem0) &&
      here.has(stem0.replace(/-v\d+$/, "") + ext0) &&
      stem0.replace(/-v\d+$/, "") + ext0) ||
    (COPY_EXT.test(name) && name.replace(COPY_EXT, ""));
  if (copyOf)
    return [
      {
        rule: "A2",
        why: `a copy of ${copyOf}: git keeps the earlier version, so change ${copyOf} itself`,
        target: null,
      },
    ];
  // the new folders' names, then the file's
  const rules = [];
  const newSegs = segs.map((s, i) =>
    fs.existsSync(path.join(root, ...segs.slice(0, i + 1))) ||
    s.startsWith(".") ||
    TOOL_DIRS.test(s) ||
    /^[a-z0-9.-]+$/.test(s) ||
    /^v\d+$/.test(s) ||
    (/^[a-z0-9_]+$/.test(s) && name.endsWith(".py"))
      ? s
      : joinWords(s, "-"),
  );
  if (newSegs.some((s, i) => s !== segs[i])) rules.push("N1");
  let [newName, nameRules, ask] = fixName(name, dirRel);
  rules.push(...nameRules);
  const whys = [];
  const bareStem = splitExt(newName)[0].replace(/^20\d\d-\d\d-\d\d-?/, "");
  if (GENERIC.test(bareStem)) {
    rules.push("N7");
    ask = ask || "a generic name: what is it?";
  }
  if (
    /^(docs\/research|audits)$/.test(dirRel) &&
    !FIXED.test(name) &&
    !/^20\d\d-\d\d-\d\d/.test(newName) &&
    !SCRIPT_EXT.test(name)
  ) {
    newName = `${today()}-${newName}`;
    rules.push("N6c");
  }
  // N3: a JS or TS file against its folder's style, from the listing
  if (CODE_JS.test(newName) && !ENTRY.test(newName)) {
    const [stem, ext] = splitExt(newName);
    const count = {};
    for (const e of seen)
      if (e.isFile() && CODE_JS.test(e.name) && !ENTRY.test(e.name)) {
        let s = styleOf(splitExt(e.name)[0]);
        if (s === "pascal" && /\.(tsx|jsx)$/.test(e.name)) s = "camel";
        if (s !== "one" && s !== "mixed") count[s] = (count[s] || 0) + 1;
      }
    const styles = Object.keys(count).sort((a, b) => count[b] - count[a]);
    let mine = styleOf(stem);
    if (mine === "pascal" && /\.(tsx|jsx)$/.test(ext)) mine = "camel";
    if (
      styles.length &&
      (styles.length === 1 || count[styles[0]] > count[styles[1]]) &&
      mine !== styles[0] &&
      mine !== "one" &&
      mine !== "mixed"
    ) {
      newName =
        toStyle(
          stem,
          styles[0] === "camel" && /\.(tsx|jsx)$/.test(ext)
            ? "pascal"
            : styles[0],
        ) + ext;
      rules.push("N3");
    }
  }
  let newDir = newSegs.join("/");
  if (!dirRel && /\.md$/i.test(name) && !FIXED.test(name)) {
    newDir = "docs";
    rules.push("P3");
  }
  // P8, as in scan(): a docs site's docs/ holds its own pictures and code, and a dot-folder's or a site's own code
  // stays
  if (
    segs[0] === "docs" &&
    !DOCS_SITE_FILES.some((f) => fs.existsSync(path.join(root, f)))
  ) {
    if (PICTURE.test(name)) {
      newDir = ["shown", ...newSegs.slice(1)].join("/");
      rules.push("P8");
      whys.push(
        "docs/ holds text and diagrams; a picture or preview for the person to look at goes in shown/ (git-ignored), unless a page links it",
      );
    } else if (
      isCodeFile(name) &&
      !segs.some((s) => s.startsWith(".")) &&
      !SITE_CODE.test(name)
    ) {
      rules.push("P8");
      ask =
        ask ||
        "code in docs/, which holds text and diagrams: where does it go (scripts/, the source folder)?";
    }
  }
  if (!rules.length) return [];
  for (const r of rules) if (NOTE_WHY[r]) whys.push(NOTE_WHY[r]);
  const target = (newDir ? newDir + "/" : "") + newName;
  return [
    {
      rule: [...new Set(rules)].join("+"),
      why: [ask, ...new Set(whys)].filter(Boolean).join("; "),
      target: ask || target === rel ? null : target,
    },
  ];
}

// ---- the ledger check
function loadLedger(file) {
  if (!file) stop("name the ledger file.");
  if (!fs.existsSync(file)) stop(`${fwd(path.resolve(file))} is not there.`);
  let l;
  try {
    l = JSON.parse(read(file));
  } catch (e) {
    stop(`${fwd(file)} is not valid JSON: ${e.message}`);
  }
  if (!l.project || !Array.isArray(l.entries))
    stop(`${fwd(file)} needs "project" and "entries".`);
  return l;
}
const ACTIONS = new Set(["move", "delete", "merge", "keep"]);
function checkLedger(l) {
  const r = scan(l.project),
    p = r.p,
    faults = [];
  const byId = new Map(r.findings.map((f) => [f.id, f]));
  const tos = new Map();
  for (const e of l.entries) {
    const f = byId.get(e.id);
    if (!f || f.kind === "note") {
      faults.push(`${e.id}: no such fix or ask finding now (report again)`);
      continue;
    }
    if (f.path !== e.path) {
      faults.push(
        `${e.id}: is ${f.path} now, the ledger says ${e.path} (report again)`,
      );
      continue;
    }
    if (f.sha !== e.sha)
      faults.push(`${e.id}: ${f.path} changed since the report`);
    if (!ACTIONS.has(e.action)) {
      faults.push(
        `${e.id}: action "${e.action}" is not move, delete, merge or keep`,
      );
      continue;
    }
    if (e.action === "keep" && !e.reason)
      faults.push(`${e.id}: a keep needs a reason`);
    if (e.action === "merge" && (f.action !== "merge" || e.to !== f.target))
      faults.push(
        `${e.id}: only an R2 finding merges, into ${f.target || "its reported target"}`,
      );
    if (e.action === "move") {
      if (!e.to) {
        faults.push(`${e.id}: a move needs "to"`);
        continue;
      }
      const full = path.resolve(p.root, e.to);
      if (
        path.isAbsolute(e.to) ||
        !full
          .toLowerCase()
          .startsWith(path.resolve(p.root).toLowerCase() + path.sep)
      ) {
        faults.push(`${e.id}: ${e.to} is outside the project`);
        continue;
      }
      const to = fwd(path.relative(p.root, full));
      if (fs.existsSync(full) && to.toLowerCase() !== f.path.toLowerCase())
        faults.push(`${e.id}: ${to} exists`);
      const broken = breaks(to, p, f.path);
      if (broken) faults.push(`${e.id}: ${to} breaks ${broken}`);
      if (tos.has(to.toLowerCase()))
        faults.push(
          `${e.id}: ${to} is also the target of ${tos.get(to.toLowerCase())}`,
        );
      tos.set(to.toLowerCase(), e.id);
    }
    if (
      e.action === "delete" &&
      !unchangedInGit(p, f.path) &&
      e.answer !== "yes"
    )
      faults.push(
        `${e.id}: ${f.path} has no copy in git: a delete needs the person's answer ("answer": "yes")`,
      );
  }
  for (const f of r.findings.filter((x) => x.kind !== "note")) {
    const n = l.entries.filter((e) => e.id === f.id).length;
    if (n !== 1)
      faults.push(`${f.id}: ${n ? `${n} entries` : "no entry"} (${f.path})`);
  }
  if (p.git) {
    const touched = l.entries
      .filter((e) => e.action !== "keep")
      .map((e) => e.path);
    const changed = touched.length
      ? gitOk(p.root, "status", "--porcelain", "--", ...touched)
          .split("\n")
          .filter((x) => x && !x.startsWith("??"))
      : [];
    if (changed.length)
      faults.push(
        `uncommitted changes in files the run touches: commit them first (${changed.map((x) => x.slice(3)).join(", ")})`,
      );
  }
  return { r, faults };
}
function check() {
  const { faults } = checkLedger(loadLedger(flagValue("--check")));
  console.log(
    faults.length
      ? `check: ${faults.length} faults\n${faults.map((x) => `  ${x}`).join("\n")}`
      : "check: ok",
  );
  if (faults.length) process.exit(1);
}

// ---- apply
const mkParent = (full) =>
  fs.mkdirSync(path.dirname(full), { recursive: true });
const removeEmptyUp = (root, dir) => {
  for (
    let d = dir;
    path.resolve(d) !== path.resolve(root) &&
    fs.existsSync(d) &&
    !fs.readdirSync(d).length;
    d = path.dirname(d)
  )
    fs.rmdirSync(d);
};
// a move that survives a case-only rename on a case-blind disk
function moveFile(p, from, to, tracked) {
  const a = path.join(p.root, from),
    b = path.join(p.root, to);
  mkParent(b);
  const step = (x, y) =>
    tracked
      ? gitOk(
          p.root,
          "mv",
          "--",
          fwd(path.relative(p.root, x)),
          fwd(path.relative(p.root, y)),
        )
      : fs.renameSync(x, y);
  if (from.toLowerCase() === to.toLowerCase()) {
    const tmp = `${b}.file-check-${process.pid}`;
    step(a, tmp);
    step(tmp, b);
  } else step(a, b);
  removeEmptyUp(p.root, path.dirname(a));
}
// the SHA-256 of a file, kept in the journal so --undo can see a file changed after the apply; a folder has none
const journalSha = (full) =>
  fs.statSync(full).isFile() ? { sha: shaFile(full) } : {};
// a file move that may cross drives (the trash under ~/.claude): rename, or copy, check the copy, then delete
function moveAcross(a, b) {
  mkParent(b);
  try {
    fs.renameSync(a, b);
    return;
  } catch (e) {
    if (e.code !== "EXDEV") throw e;
  }
  fs.copyFileSync(a, b);
  if (shaFile(a) !== shaFile(b)) {
    fs.rmSync(b);
    throw new Error(
      `the copy of ${fwd(a)} to ${fwd(b)} differs from it; the file stays`,
    );
  }
  fs.rmSync(a);
}
// the edits of one text: every named old path to its new one; [newText, edits(at, old, new) in the new text, listed lines]
// A ./ or ../ path is matched from the citing file's old folder and rewritten from its new one.
function fixRefs(p, text, citing, citingNew, pairs) {
  const spans = [];
  for (const [from, to] of pairs)
    for (const s of refSpans(text, p.root, citing, from)) {
      if (spans.some((x) => s.at < x.at + x.len && x.at < s.at + s.len))
        continue;
      const sep = s.text.includes("\\\\")
        ? "\\\\"
        : s.text.includes("\\")
          ? "\\"
          : "/";
      const rel = relFrom(dirOf(citingNew), to);
      const nu =
        s.kind === "rel" || s.kind === "dot"
          ? rel.startsWith("../")
            ? rel
            : `./${rel}`
          : to;
      spans.push({ ...s, nu: nu.split("/").join(sep), follows: from });
    }
  spans.sort((a, b) => a.at - b.at);
  let out = "",
    last = 0;
  const edits = [];
  for (const s of spans) {
    out += text.slice(last, s.at);
    edits.push({ at: out.length, old: s.text, new: s.nu, follows: s.follows });
    out += s.nu;
    last = s.at + s.len;
  }
  out += text.slice(last);
  return [out, edits.filter((e) => e.old !== e.new)];
}
function apply() {
  const file = flagValue("--apply"),
    l = loadLedger(file);
  const { r, faults } = checkLedger(l);
  if (faults.length)
    stop(
      `the ledger check has ${faults.length} faults; run --check and fix them first.`,
    );
  const p = r.p,
    byId = new Map(r.findings.map((f) => [f.id, f]));
  const before = p.git ? gitOk(p.root, "rev-parse", "HEAD").trim() : null;
  const allTexts = new Map(texts(p)); // read before anything moves
  const ops = [],
    pairs = [],
    edits = [];
  const entries = l.entries.map((e) => ({ e, f: byId.get(e.id) }));
  const tracked = (rel) => p.git && p.tracked.has(rel);
  // The saved ledger is a journal: written before the first action and again after each one, so a run that stops
  // midway (a locked file, a git refusal) leaves a record of exactly what was done, and --undo reverses that.
  fs.mkdirSync(LOGS, { recursive: true });
  let saved;
  for (let n = 1; ; n++) {
    saved = path.join(
      LOGS,
      `file-moves-${today()}-${path.basename(p.root)}${n > 1 ? `-${n}` : ""}.json`,
    );
    if (!fs.existsSync(saved)) break;
  }
  const trashDir = path.join(
    LOGS,
    "file-moves-trash",
    path.basename(saved, ".json"),
  ); // one per run: names never clash
  const planned = entries
    .filter(({ e }) => e.action !== "keep")
    .map(({ e, f }) => ({
      op: e.action,
      path: f.path,
      ...(e.to ? { to: e.to } : {}),
    }));
  const record = {
    project: fwd(p.root),
    date: new Date().toISOString(),
    git: p.git,
    before,
    ledger: l.entries,
    state: "running",
    planned,
    ops,
    edits,
    listed: [],
    outside: [],
  };
  const save = () => {
    fs.writeFileSync(`${saved}.part`, JSON.stringify(record, null, 2) + "\n");
    fs.renameSync(`${saved}.part`, saved);
  };
  save();
  stopNote = `  the run stopped midway; what it did is in ${tilde(saved)}. Undo it: ${FC} --undo ${tilde(saved)}`;
  // a delete: git rm, or each listed file to this run's trash, recorded file by file
  const remove = (rel, op) => {
    if (unchangedInGit(p, rel)) {
      gitOk(p.root, "rm", "-r", "-q", "--", rel);
      op.git = true;
      save();
      return;
    }
    const list = p.files.filter((x) => x === rel || x.startsWith(rel + "/")); // listed files only: ignored data stays
    op.trash = fwd(trashDir);
    op.files = [];
    op.shas = {};
    for (const x of list) {
      const h = shaFile(path.join(p.root, x));
      moveAcross(path.join(p.root, x), path.join(trashDir, x));
      op.files.push(x);
      op.shas[x] = h;
      save();
    }
    removeEmptyUp(p.root, path.join(p.root, rel));
  };
  // P8: a picture to shown/, which is git-ignored: shown/.gitignore (`*`) is made when it is missing, the picture
  // leaves git (git rm --cached; its history stays) and moves on disk. A step that fails puts the earlier ones back,
  // so the op is recorded whole or not at all. --undo moves it back and tracks it again.
  const toShown = (from, to) => {
    const ignore = path.join(p.root, "shown", ".gitignore");
    const made = !fs.existsSync(ignore);
    if (made) {
      mkParent(ignore);
      fs.writeFileSync(ignore, "*\n");
    }
    const was = tracked(from);
    const gitOrThrow = (...a) => {
      const r = git(p.root, ...a);
      if (r.status !== 0)
        throw new Error(
          `git ${a.join(" ")} failed in ${fwd(p.root)}: ${(r.stderr || r.stdout).trim()}`,
        );
    };
    try {
      if (was) gitOrThrow("rm", "--cached", "-q", "--", from);
      try {
        moveFile(p, from, to, false);
      } catch (err) {
        if (was) gitOrThrow("reset", "-q", "--", from);
        throw err;
      }
    } catch (err) {
      if (made) {
        fs.rmSync(ignore);
        removeEmptyUp(p.root, path.dirname(ignore));
      }
      throw err;
    }
    return {
      op: "move",
      from,
      to,
      tracked: false,
      ...journalSha(path.join(p.root, to)),
      ...(was ? { untracked: true } : {}),
      ...(made ? { madeIgnore: "shown/.gitignore" } : {}),
    };
  };
  // keeps: into .claude/file-standard.json with their reasons
  const keeps = entries.filter(({ e }) => e.action === "keep");
  if (keeps.length) {
    const stdFile = path.join(p.root, ".claude", "file-standard.json");
    const prior = fs.existsSync(stdFile) ? read(stdFile) : null;
    const j = prior ? JSON.parse(prior) : { ignore: [], reason: {} };
    j.ignore = j.ignore || [];
    j.reason = j.reason || {};
    for (const { e, f } of keeps) {
      if (!j.ignore.includes(f.path)) j.ignore.push(f.path);
      j.reason[f.path] = e.reason;
    }
    mkParent(stdFile);
    const text = JSON.stringify(j, null, 2) + "\n";
    fs.writeFileSync(stdFile, text);
    ops.push({
      op: "keep",
      file: ".claude/file-standard.json",
      before: prior,
      sha: sha(text),
      paths: keeps.map(({ f }) => f.path),
    });
    save();
  }
  for (const { e, f } of entries.filter(({ e }) => e.action === "merge")) {
    const target = path.join(p.root, e.to),
      had = fs.existsSync(target);
    const add =
      (had && !read(target).endsWith("\n") ? "\n" : "") +
      `\n<!-- merged from ${f.path} -->\n` +
      read(path.join(p.root, f.path));
    mkParent(target);
    fs.appendFileSync(target, add);
    const op = {
      op: "merge",
      from: f.path,
      to: e.to,
      appended: add,
      created: !had,
    };
    ops.push(op);
    save();
    remove(f.path, op);
    pairs.push([f.path, e.to]);
  }
  for (const { e, f } of entries.filter(({ e }) => e.action === "move")) {
    const to = fwd(path.relative(p.root, path.resolve(p.root, e.to)));
    if (f.rules.includes("P8") && to.startsWith("shown/")) {
      ops.push(toShown(f.path, to));
      save();
      pairs.push([f.path, to]);
      continue;
    }
    moveFile(p, f.path, to, tracked(f.path));
    ops.push({
      op: "move",
      from: f.path,
      to,
      tracked: tracked(f.path),
      ...journalSha(path.join(p.root, to)),
    });
    save();
    pairs.push([f.path, to]);
  }
  for (const { f } of entries.filter(({ e }) => e.action === "delete")) {
    const op = { op: "delete", path: f.path };
    ops.push(op);
    save();
    remove(f.path, op);
  }
  // folders whose every listed file moved the same way are renamed as folders too, for references to the folder
  const dirPairs = new Map();
  for (const [from, to] of pairs.filter(([a]) => a.includes("/"))) {
    const a = from.split("/"),
      b = to.split("/");
    if (
      a.length !== b.length ||
      (a.at(-1).toLowerCase() !== b.at(-1).toLowerCase() &&
        a.at(-1) !== b.at(-1))
    )
      continue;
    for (let i = 1; i < a.length; i++) {
      const da = a.slice(0, i).join("/"),
        db = b.slice(0, i).join("/");
      if (
        da !== db &&
        p.files
          .filter((x) => x.startsWith(da + "/"))
          .every((x) =>
            pairs.some(([m, n]) => m === x && n.startsWith(db + "/")),
          )
      )
        dirPairs.set(da, db);
    }
  }
  const allPairs = [...pairs, ...dirPairs].sort(
    (a, b) => b[0].length - a[0].length,
  );
  const moved = new Map(
    ops.filter((o) => o.op === "move").map((o) => [o.from, o.to]),
  );
  const gone = new Set(
    ops
      .filter((o) => o.op !== "move" && o.op !== "keep")
      .flatMap((o) => [o.path || o.from]),
  );
  const { listed, outside } = record;
  // a moved file's ./ and ../ paths to files and folders that stay put still point at them from its new folder
  const fromSet = new Set(allPairs.map(([a]) => a));
  const stay = [
    ...new Set(
      p.files.flatMap((f) =>
        f.split("/").map((_, i, s) => s.slice(0, i + 1).join("/")),
      ),
    ),
  ].filter((x) => !fromSet.has(x));
  for (const [rel, text] of allTexts) {
    if (
      gone.has(rel) ||
      [...gone].some((g) => rel.startsWith(g + "/")) ||
      isRecord(rel)
    )
      continue;
    const now = moved.get(rel) || rel;
    const own =
      now === rel
        ? []
        : stay
            .filter((x) => x !== rel && text.includes(path.posix.basename(x)))
            .map((x) => [x, x]);
    const [out, list] = fixRefs(
      p,
      text,
      rel,
      now,
      [...allPairs, ...own].sort((a, b) => b[0].length - a[0].length),
    );
    if (list.length) {
      fs.writeFileSync(path.join(p.root, now), out);
      edits.push({ file: now, edits: list });
      save();
    }
    // bare names of moved files in subfolders, and paths built in code: named for a person to fix by hand
    out.split("\n").forEach((line, i) => {
      for (const [from, to] of pairs) {
        if (!from.includes("/") || from === rel) continue;
        const base = path.posix.basename(from);
        if (
          new RegExp(
            `(^|[^A-Za-z0-9_.\\-/\\\\])${esc(base)}($|[^A-Za-z0-9_-])`,
          ).test(line)
        )
          listed.push(`${now}:${i + 1} names ${base} (now ${to})`);
      }
    });
  }
  // a path outside the project (under ~/.claude) that names a moved file: listed for the person
  for (const dir of ["rules", "skills", "CLAUDE.md"]
    .map((d) => path.join(CLAUDE, d))
    .filter((d) => fs.existsSync(d))) {
    const list = fs.statSync(dir).isDirectory()
      ? fs
          .readdirSync(dir, { recursive: true })
          .map((x) => path.join(dir, x))
          .filter((x) => /\.(md|json|mjs|js)$/.test(x))
      : [dir];
    for (const f of list) {
      if (!fs.statSync(f).isFile()) continue;
      read(f)
        .split("\n")
        .forEach((line, i) => {
          for (const [from] of pairs)
            if (
              fwd(line)
                .toLowerCase()
                .includes(fwd(path.join(p.root, from)).toLowerCase())
            )
              outside.push(`${tilde(f)}:${i + 1} names ${from}`);
        });
    }
  }
  record.state = "done";
  save();
  stopNote = "";
  const count = (k) => ops.filter((o) => o.op === k).length;
  console.log(
    `applied: ${count("move")} moves, ${count("delete")} deletes, ${count("merge")} merges, ${keeps.length} kept; ${edits.length} files' references fixed (${edits.reduce((n, x) => n + x.edits.length, 0)} edits)`,
  );
  for (const o of ops.filter((x) => x.op === "delete"))
    console.log(
      `  deleted ${o.path}${o.git ? " (in git)" : ` (to ${o.trash})`}`,
    );
  for (const x of listed) console.log(`  by hand: ${x}`);
  for (const x of outside) console.log(`  outside the project: ${x}`);
  console.log(`ledger: ${tilde(saved)}`);
  console.log(
    `undo: ${FC} --undo ${tilde(saved)}${p.git ? " (or git revert the commit of this run)" : ""}`,
  );
}

// ---- undo
function undo() {
  let file = flagValue("--undo");
  if (file === null || file === undefined) {
    const list = fs.existsSync(LOGS)
      ? fs
          .readdirSync(LOGS)
          .filter((n) => /^file-moves-.*\.json$/.test(n))
          .map((n) => path.join(LOGS, n))
          .filter((f) => !JSON.parse(read(f)).undone)
          .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
      : [];
    if (!list.length) stop(`no ledger to undo in ${tilde(LOGS)}.`);
    file = list.at(-1);
  }
  file = /^~[\\/]/.test(file)
    ? path.join(home, file.slice(2))
    : path.resolve(file);
  if (!fs.existsSync(file)) stop(`${fwd(file)} is not there.`);
  let l;
  try {
    l = JSON.parse(read(file));
  } catch (e) {
    stop(`${fwd(file)} is not valid JSON: ${e.message}`);
  }
  if (!l.project || !Array.isArray(l.ops) || !Array.isArray(l.edits))
    stop(
      `${fwd(file)} is not a saved ledger of --apply (it needs "project", "ops" and "edits").`,
    );
  if (l.undone) stop(`${tilde(file)} was undone on ${l.undone}.`);
  const root = l.project,
    named = [];
  const p = { root },
    at = (rel) => path.join(root, rel);
  // A step never writes over a file that is there again, nor moves or deletes a file that changed after the apply
  // (its SHA-256 in the journal; journals from before the hashes have none). Such a step is left for a person, and
  // stays in the journal (only the part not done) so a later --undo finishes it.
  const left = new Map();
  const note = (why) => named.push(`${why}; the undo left it`);
  const skip = (o, why, rest = o) => {
    left.set(o, rest);
    note(why);
  };
  // the references fixed in a file, put back: in memory first, so a file is hashed and checked as the apply left it.
  // `hold`: edits that stay, because the move they follow was left (each edit names it in `follows`; journals from
  // before that name none). A held edit stays in the journal, its place shifted by the edits put back before it.
  const editsOf = new Map(l.edits.map((e) => [e.file, e.edits])),
    editsDone = new Set(),
    editsLeft = new Map();
  const revert = (rel, hold = () => false) => {
    let text = read(at(rel));
    const misses = [],
      held = [],
      done = [];
    for (const e of [...editsOf.get(rel)].sort((a, b) => b.at - a.at)) {
      if (text.slice(e.at, e.at + e.new.length) !== e.new)
        misses.push(
          `${rel}: "${e.new}" is no longer at ${e.at}; put back "${e.old}" by hand`,
        );
      else if (hold(e)) held.push({ ...e });
      else {
        text = text.slice(0, e.at) + e.old + text.slice(e.at + e.new.length);
        done.push(e);
      }
    }
    for (const h of held)
      for (const e of done)
        if (e.at < h.at) h.at += e.old.length - e.new.length;
    return { text, misses, held };
  };
  const putBack = (rel, r) => {
    fs.writeFileSync(at(rel), r.text);
    named.push(...r.misses);
    editsDone.add(rel);
    if (r.held.length) editsLeft.set(rel, r.held);
  };
  // an edit that follows a move left for a person (or a file in a folder whose file was left) stays
  const held = (e) =>
    !!e.follows &&
    [...left.keys()].some(
      (o) =>
        o.op === "move" &&
        (o.from === e.follows || o.from.startsWith(e.follows + "/")),
    );
  // a file with references fixed, as it was before them (the merge and keep checks compare with that). Moves are
  // undone before merges and keeps, so which moves were left is known here.
  const view = (rel) =>
    editsOf.has(rel) && !editsDone.has(rel)
      ? revert(rel, held)
      : { text: read(at(rel)), misses: [], held: [] };
  const restore = (o, rel, done = {}) => {
    if (o.git) {
      const there = gitOk(
        root,
        "ls-tree",
        "-r",
        "-z",
        "--name-only",
        l.before,
        "--",
        rel,
      )
        .split("\0")
        .filter((x) => x && fs.existsSync(at(x)));
      if (there.length)
        skip(
          o,
          `${rel} not taken back from git (${l.before.slice(0, 7)}): ${there.join(", ")} is there again`,
          { ...o, ...done },
        );
      else gitOk(root, "checkout", l.before, "--", rel);
      return;
    }
    const files = []; // none: stopped before the delete
    for (const x of o.files || []) {
      const from = path.join(o.trash, x);
      if (fs.existsSync(at(x)))
        note(`${x} not put back from ${o.trash}: ${x} is there again`);
      else if (!fs.existsSync(from))
        note(`${x} not put back: it is no longer in ${o.trash}`);
      else if (o.shas && shaFile(from) !== o.shas[x])
        note(
          `${x} not put back: its copy in ${o.trash} changed after the apply`,
        );
      else {
        moveAcross(from, at(x));
        continue;
      }
      files.push(x);
    }
    if (files.length) left.set(o, { ...o, ...done, files });
  };
  for (const o of [...l.ops].reverse()) {
    if (o.op === "move") {
      if (!fs.existsSync(at(o.to))) {
        skip(o, `${o.to} not moved back to ${o.from}: ${o.to} is gone`);
        continue;
      }
      // a case-only rename: on a case-blind disk the old name is the same file; on any other it is a new one
      const same =
        o.from.toLowerCase() === o.to.toLowerCase() &&
        fs.existsSync(at(o.from)) &&
        fs.statSync(at(o.from), { bigint: true }).ino ===
          fs.statSync(at(o.to), { bigint: true }).ino;
      if (!same && fs.existsSync(at(o.from))) {
        skip(o, `${o.to} not moved back: ${o.from} is there again`);
        continue;
      }
      const r = editsOf.has(o.to) ? revert(o.to) : null;
      if (o.sha && (r ? sha(r.text) : journalSha(at(o.to)).sha) !== o.sha) {
        skip(
          o,
          `${o.to} not moved back to ${o.from}: it changed after the apply`,
        );
        continue;
      }
      if (r) putBack(o.to, r);
      moveFile(p, o.to, o.from, o.tracked);
      // a P8 picture: tracked again at its old path, and the shown/.gitignore the apply made goes
      if (o.untracked) gitOk(root, "add", "-f", "--", o.from);
      if (o.madeIgnore) {
        const ignore = path.join(root, o.madeIgnore);
        if (fs.existsSync(ignore) && read(ignore) === "*\n") fs.rmSync(ignore);
        removeEmptyUp(root, path.dirname(ignore));
      }
    } else if (o.op === "delete") restore(o, o.path);
    else if (o.op === "merge") {
      // a target the merge made is deleted only when it holds nothing else; text added since (the archive is newest
      // first, so at the top) stays and only the merged part is cut. While the merged text is not cut, the source
      // does not come back either, so the text is never there twice. `cut`: done by an earlier --undo.
      if (!o.cut) {
        const t = at(o.to),
          r = fs.existsSync(t) ? view(o.to) : null,
          text = r && r.text;
        if (text === null || !text.endsWith(o.appended)) {
          skip(
            o,
            `${o.to}: the merged text of ${o.from} is no longer at its end; take it out by hand, then put back ${o.from}`,
          );
          continue;
        }
        if (o.created && text === o.appended) {
          fs.rmSync(t);
          editsDone.add(o.to);
        } else
          putBack(o.to, {
            ...r,
            text: text.slice(0, text.length - o.appended.length),
          });
      }
      restore(o, o.from, { cut: true });
    } else if (o.op === "keep") {
      // the old text goes back only over the very text the apply wrote (a journal without its hash: never over a file)
      const t = at(o.file),
        now = fs.existsSync(t) ? view(o.file).text : null;
      if (now === null) {
        if (o.before !== null) {
          mkParent(t);
          fs.writeFileSync(t, o.before);
        }
      } else if (sha(now) !== o.sha)
        skip(
          o,
          `${o.file} changed after the apply; take ${o.paths.join(", ")} out of it by hand`,
        );
      else {
        if (o.before === null) fs.rmSync(t);
        else fs.writeFileSync(t, o.before);
        editsDone.add(o.file);
      }
    }
  }
  // the other files' references, now that it is known which moves were left: an edit that follows one stays
  const movedTo = new Set(
    l.ops.filter((o) => o.op === "move").map((o) => o.to),
  );
  for (const rel of editsOf.keys())
    if (editsDone.has(rel) || movedTo.has(rel))
      continue; // a moved file's go back with it, above
    else if (!fs.existsSync(at(rel))) {
      note(`${rel} is gone, so its references are not put back`);
      editsDone.add(rel);
    } else putBack(rel, revert(rel, held));
  // a step left for a person keeps the journal open: it holds only what is left, and the next --undo takes it up
  const rest = l.ops.filter((o) => left.has(o)).map((o) => left.get(o));
  const now = new Date().toISOString();
  fs.writeFileSync(
    file,
    JSON.stringify(
      rest.length
        ? {
            ...l,
            ops: rest,
            edits: [
              ...l.edits.filter((e) => !editsDone.has(e.file)),
              ...[...editsLeft].map(([f, edits]) => ({ file: f, edits })),
            ],
            partlyUndone: now,
          }
        : { ...l, undone: now },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `undone: ${l.ops.length - rest.length} steps${rest.length ? ` (${rest.length} left for a person, below; ${FC} --undo ${tilde(file)} again takes them up)` : ""} and ${editsDone.size} files' references of ${tilde(file)}`,
  );
  for (const x of named) console.log(`  by hand: ${x}`);
}

export {
  breaks,
  dateIn,
  fixName,
  newPathNotes,
  projectsRoot,
  refSpans,
  shaFile,
};

const MODES = {
  "--report": report,
  "--root": rootReport,
  "--status": status,
  "--skip": skip,
  "--check": check,
  "--apply": apply,
  "--undo": undo,
};
// started as the script, not imported: by real path, as hooks/lib/hook-io.mjs isMain, because Node gives import.meta.url
// the real path while argv keeps a link's (macOS /var is /private/var; a linked ~/.claude)
const realOr = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
if (
  process.argv[1] &&
  realOr(process.argv[1]).toLowerCase() ===
    realOr(fileURLToPath(import.meta.url)).toLowerCase()
) {
  if (homeArg === null) stop("--home needs a folder.");
  const mode = Object.keys(MODES).filter((m) => args.includes(m));
  if (mode.length !== 1)
    stop(`give exactly one of ${Object.keys(MODES).join(", ")}.`);
  // a folder or ledger goes right after a mode that takes one, a folder after --home; any other word would be dropped
  // and the current folder (or every home) checked in its place. --status, --skip and --report --homes take none.
  const takes = (m) =>
    ["--root", "--check", "--apply", "--undo"].includes(m) ||
    (m === "--report" && !HOMES);
  const stray = args.filter(
    (a, i) =>
      !a.startsWith("--") && !takes(args[i - 1]) && args[i - 1] !== "--home",
  );
  if (stray.length)
    stop(
      `${stray.map((a) => `"${a}"`).join(", ")} is not right after a mode that takes a folder or ledger: ` +
        (takes(mode[0])
          ? "name it right after the mode, as `file-check.mjs --report <folder>`."
          : `${mode[0]}${HOMES ? " --homes" : ""} takes none.`),
    );
  try {
    MODES[mode[0]]();
  } catch (e) {
    stop(e.message);
  } // a throw midway in --apply still names its journal
}
