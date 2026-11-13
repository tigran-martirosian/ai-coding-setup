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
//   --home <folder>                                    work as if <folder> were the home folder (tests)
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
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
let stopNote = ""; // set while an apply runs: where its journal is and how to undo it
const stop = (why) => {
  console.log(`file-check stopped: ${why}`);
  if (stopNote) console.log(stopNote);
  process.exit(1);
};
const valueOf = (flag) => {
  const at = args.indexOf(flag);
  if (at === -1) return undefined;
  const v = args[at + 1];
  return v && !v.startsWith("--") ? v : null;
};
const homeArg = valueOf("--home");
if (homeArg === null) stop("--home needs a folder.");
const home = homeArg === undefined ? os.homedir() : path.resolve(homeArg);
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
const BIG_REF = 50 * 1024 * 1024; // over this, a file is name-checked only
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
    standard: standardFile(root),
  };
}
// .claude/file-standard.json: {"ignore": ["<glob>"], "reason": {"<glob>": "<why>"}}
function standardFile(root) {
  const f = path.join(root, ".claude", "file-standard.json");
  if (!fs.existsSync(f)) return { ignore: [], reason: {}, text: null };
  let j;
  try {
    j = JSON.parse(read(f));
  } catch (e) {
    stop(`${fwd(f)} is not valid JSON: ${e.message}`);
  }
  const ignore = j.ignore || [],
    reason = j.reason || {};
  const bare = ignore.filter((g) => !reason[g]);
  if (bare.length)
    stop(
      `${fwd(f)}: every ignored glob needs a reason under "reason"; missing for ${bare.join(", ")}.`,
    );
  return { ignore, reason, text: read(f) };
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
const FIXED =
  /^(README|CHANGELOG|LICENSE|LICENCE|NOTICE|AUTHORS|COPYING|CONTRIBUTING|SECURITY|CODE_OF_CONDUCT|CLAUDE|CLAUDE\.local|AGENTS|SKILL|MEMORY|HANDOFF|DECISIONS|DESIGN|HISTORY|NEWS|CODEOWNERS|INDEX)(\.[A-Za-z]{1,4})?$/;
const TOOL_NAMES =
  /\.(woff2?|ttf|otf|eot)$|^(Makefile|Dockerfile|Gemfile|Gemfile\.lock|Procfile|Rakefile|Jenkinsfile|Vagrantfile|Brewfile|Podfile|Pipfile|Pipfile\.lock|__init__\.py|__main__\.py|conftest\.py)$|^Dockerfile\./;
const TOOL_DIRS =
  /^(__pycache__|__tests__|__mocks__|__snapshots__|ISSUE_TEMPLATE|PULL_REQUEST_TEMPLATE|DISCUSSION_TEMPLATE)$/;
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
const ARCHIVE_DIR =
  /^(archive|archives|old|obsolete|superseded|old-versions.*|backup.*|backups)$/i;

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
const ROOT_TOOL =
  /^(gradlew|gradlew\.bat|next-env\.d\.ts|(middleware|proxy|instrumentation|instrumentation-client)\.(ts|js|mjs)|manage\.py|wsgi\.py|asgi\.py)$/;
const CLAUDE_TOP =
  /^\.claude\/(settings\.json|settings\.local\.json|systems-map\.json|file-standard\.json|CLAUDE\.md|\.gitignore)$|^\.claude\/(rules|skills|agents|commands|hooks|output-styles|worktrees)\//;

// a name by N1, N2, N4 and N6a; [newName, rules]
function fixName(name, dirRel) {
  if (FIXED.test(name) || TOOL_NAMES.test(name) || name.startsWith("."))
    return [name, []];
  let [stem, ext] = splitExt(name);
  const rules = [];
  const d = dateIn(stem);
  if (d && d.kind !== "iso") {
    stem = dateFirst(stem, d);
    rules.push("N6a");
  }
  const lowExt = ext.toLowerCase();
  if (lowExt === ".py") {
    if (/[^a-z0-9_]/.test(stem)) {
      stem = joinWords(stem, "_");
      rules.push("N2");
    }
  } else if (CODE_JS.test(lowExt) || CODE_OTHER.test(lowExt)) {
    if (/[^A-Za-z0-9._-]/.test(stem)) {
      stem = stem.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "");
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
  return [stem + lowExt, rules];
}
const fixDir = (seg, p, dirRel) => {
  if (seg.startsWith(".") || TOOL_DIRS.test(seg) || holdsIgnored(p, dirRel))
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
        .map((f) => `${f} ${sha(fs.readFileSync(path.join(p.root, f)))}`)
        .join("\n"),
    );
  return sha(fs.readFileSync(full));
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
  const live = p.files.filter((f) =>
    ignoredBy(p.standard, f) ? (ignoredCount++, false) : true,
  );
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
  // A1: archive folders, whole (the outermost such folder of a path)
  const archives = new Set();
  for (const f of live) {
    const segs = f.split("/").slice(0, -1);
    const at = segs.findIndex((s) => ARCHIVE_DIR.test(s));
    if (at !== -1) archives.add(segs.slice(0, at + 1).join("/"));
  }
  for (const dir of archives) {
    const inside = live.filter((f) => f.startsWith(dir + "/"));
    const code = inside.filter((f) => CODE_JS.test(f) || f.endsWith(".py"));
    const imported =
      code.length &&
      [...texts(p)].some(
        ([f, t]) =>
          !f.startsWith(dir + "/") &&
          new RegExp(
            `(import|require|from)\\b[^\\n]*\\b${esc(path.posix.basename(dir))}\\b`,
          ).test(t),
      );
    if (imported)
      add({
        rules: ["A1"],
        path: dir,
        action: "delete",
        kind: "ask",
        why: "holds code imported from outside it",
      });
    else del(dir, ["A1"], `${inside.length} files, all in git`);
  }
  const inArchive = (f) => [...archives].some((d) => f.startsWith(d + "/"));
  const js = new Map(); // folder -> JS code files, for N3
  for (const rel of live) {
    if (inArchive(rel)) continue;
    const name = path.posix.basename(rel),
      dirRel = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);
    const [stem, ext] = splitExt(name);
    // A2: a versioned copy
    const plain = (s) => has.has((dirRel ? dirRel + "/" : "") + s + ext);
    if (
      COPY_EXT.test(name) ||
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
      (/^(history-|handoff-)/.test(low) ||
        /-handoff\.[a-z]+$/.test(low) ||
        ISO.test(low));
    const decisionsCopy =
      record &&
      /decisions/.test(low) &&
      rel !== "DECISIONS.md" &&
      rel !== "docs/decisions-archive.md" &&
      !rel.startsWith("docs/research/") &&
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
    let [newName, nameRules] = fixName(name, dirRel);
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
    const target = (newDir ? newDir + "/" : "") + newName;
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
    const broken = breaks(f.target);
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
    if (f.action) f.refs = namedIn(p, f.path);
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
// the name rules a target path still breaks ("" when none)
function breaks(rel) {
  const segs = rel.split("/"),
    name = segs.pop();
  if (rel.split("/").some((s) => /[^A-Za-z0-9._-]/.test(s))) return "N4";
  const dirRel = segs.join("/");
  const [fixed, r] = fixName(name, dirRel);
  if (fixed !== name) return r.join("+");
  if (
    segs.some(
      (s) =>
        !s.startsWith(".") && !TOOL_DIRS.test(s) && !/^[a-z0-9._-]+$/.test(s),
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
  for (const f of r.findings) {
    const tail = [
      f.why,
      f.refs?.length
        ? `named in ${f.refs.length > 3 ? `${f.refs.length} files` : f.refs.join(", ")}`
        : "",
    ]
      .filter(Boolean)
      .join("; ");
    console.log(
      `${f.id.padEnd(4)}${f.rules.join("+").padEnd(8)}${f.kind.padEnd(6)}${f.path} ${what(f)}${tail ? `   (${tail})` : ""}`.replace(
        / {2,}\(/,
        "   (",
      ),
    );
  }
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
      const broken = breaks(to);
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
  const { faults } = checkLedger(loadLedger(valueOf("--check")));
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
  if (sha(fs.readFileSync(a)) !== sha(fs.readFileSync(b))) {
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
      spans.push({ ...s, nu: nu.split("/").join(sep) });
    }
  spans.sort((a, b) => a.at - b.at);
  let out = "",
    last = 0;
  const edits = [];
  for (const s of spans) {
    out += text.slice(last, s.at);
    edits.push({ at: out.length, old: s.text, new: s.nu });
    out += s.nu;
    last = s.at + s.len;
  }
  out += text.slice(last);
  return [out, edits.filter((e) => e.old !== e.new)];
}
function apply() {
  const file = valueOf("--apply"),
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
    for (const x of list) {
      moveAcross(path.join(p.root, x), path.join(trashDir, x));
      op.files.push(x);
      save();
    }
    removeEmptyUp(p.root, path.join(p.root, rel));
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
    fs.writeFileSync(stdFile, JSON.stringify(j, null, 2) + "\n");
    ops.push({
      op: "keep",
      file: ".claude/file-standard.json",
      before: prior,
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
    moveFile(p, f.path, to, tracked(f.path));
    ops.push({ op: "move", from: f.path, to, tracked: tracked(f.path) });
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
  let file = valueOf("--undo");
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
  for (const { file: rel, edits } of l.edits) {
    const full = path.join(root, rel);
    let text = read(full);
    for (const e of [...edits].sort((a, b) => b.at - a.at)) {
      if (text.slice(e.at, e.at + e.new.length) === e.new)
        text = text.slice(0, e.at) + e.old + text.slice(e.at + e.new.length);
      else
        named.push(
          `${rel}: "${e.new}" is no longer at ${e.at}; put back "${e.old}" by hand`,
        );
    }
    fs.writeFileSync(full, text);
  }
  const p = { root };
  const restore = (o, rel) => {
    if (o.git) gitOk(root, "checkout", l.before, "--", rel);
    else
      for (const x of o.files || [])
        moveAcross(path.join(o.trash, x), path.join(root, x)); // none: stopped before the delete
  };
  for (const o of [...l.ops].reverse()) {
    if (o.op === "move") moveFile(p, o.to, o.from, o.tracked);
    else if (o.op === "delete") restore(o, o.path);
    else if (o.op === "merge") {
      const t = path.join(root, o.to),
        text = read(t);
      if (!text.endsWith(o.appended))
        named.push(
          `${o.to}: the merged text of ${o.from} is no longer at its end; take it out by hand`,
        );
      else if (o.created) fs.rmSync(t);
      else fs.writeFileSync(t, text.slice(0, text.length - o.appended.length));
      restore(o, o.from);
    } else if (o.op === "keep") {
      const t = path.join(root, o.file);
      if (o.before === null) fs.rmSync(t, { force: true });
      else fs.writeFileSync(t, o.before);
    }
  }
  fs.writeFileSync(
    file,
    JSON.stringify({ ...l, undone: new Date().toISOString() }, null, 2) + "\n",
  );
  console.log(
    `undone: ${l.ops.length} steps and ${l.edits.length} files' references of ${tilde(file)}`,
  );
  for (const x of named) console.log(`  by hand: ${x}`);
}

export { dateIn, fixName, refSpans, breaks };
const MODES = {
  "--report": report,
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
  const mode = Object.keys(MODES).filter((m) => args.includes(m));
  if (mode.length !== 1)
    stop(`give exactly one of ${Object.keys(MODES).join(", ")}.`);
  try {
    MODES[mode[0]]();
  } catch (e) {
    stop(e.message);
  } // a throw midway in --apply still names its journal
}
