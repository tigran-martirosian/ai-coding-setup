// Tests for skills/file-upkeep/decisions.mjs, cases T1-T17: a by-date and a by-topic file split word for word, a
// second run that changes nothing, every fault hook leaving the folder byte-identical, a cut-off run and its
// recovery, the lasting-failure record, a ledger applied and undone, the lock, file names from headings, stray index
// lines, line ends, BOM, raw bytes and fences, --verify, git gating, real DECISIONS.md files (DECISIONS_REAL_FILES,
// ";"-separated paths) split, verified and rejoined by this test's own parser, a folder argument that is not a
// folder, a git-ignored docs/decisions/, a project in a subfolder of a repository, and a heading ending in "à".
// Everything happens in made-up git projects under the system temp folder.
// Run: node tests/test-decisions.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT = path.join(REPO, "skills", "file-upkeep", "decisions.mjs");
const tmp = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), "decisions-test-")),
);
const home = path.join(tmp, "home");
const temp = path.join(tmp, "temp");
fs.mkdirSync(temp, { recursive: true });
// the lasting-failure record goes under the home folder, the lock under the temp folder: both made up here
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  TEMP: temp,
  TMP: temp,
  TMPDIR: temp,
});
const { failureFile, lastingFailure, INDEX_HEAD, INDEX_TEXT } = await import(
  new URL("../hooks/lib/decisions.mjs", import.meta.url)
);
const { fileKey } = await import(
  new URL("../hooks/lib/paths.mjs", import.meta.url)
);

let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`,
  );
};
const run = (dir, args, fault = "") => {
  const r = spawnSync(process.execPath, [SCRIPT, ...args, dir], {
    encoding: "utf8",
    env: { ...process.env, DECISIONS_TEST_FAULT: fault },
  });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
const sh = (dir, ...args) => {
  const r = spawnSync("git", ["-C", dir, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const D = "DECISIONS.md";
let made = 0;
// A git project holding the files (rel -> string, latin1 bytes), committed once.
function project(files, { git = true, commit = true } = {}) {
  const dir = path.join(tmp, `p${++made}`);
  fs.mkdirSync(dir);
  for (const [rel, s] of Object.entries(files)) put(dir, rel, s);
  if (git) {
    sh(dir, "init", "-q");
    sh(dir, "config", "core.autocrlf", "false");
    sh(dir, "config", "user.email", "test@example.com");
    sh(dir, "config", "user.name", "test");
    if (commit) {
      sh(dir, "add", "-A");
      sh(dir, "commit", "-qm", "start");
    }
  }
  return dir;
}
const commitAll = (dir) => {
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "step");
};
const put = (dir, rel, s) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(
    path.join(dir, rel),
    Buffer.isBuffer(s) ? s : Buffer.from(s, "utf8"),
  );
};
// a file as text (UTF-8), or as raw bytes in a latin1 string (enc "latin1")
const read = (dir, rel, enc = "utf8") => {
  const f = path.join(dir, rel);
  return fs.existsSync(f) ? fs.readFileSync(f, enc) : null;
};
// rel -> sha1 of every file in the folder but .git
function snap(dir) {
  const out = {};
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      if (e.name === ".git") continue;
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else
        out[path.relative(dir, p).replace(/\\/g, "/")] = crypto
          .createHash("sha1")
          .update(fs.readFileSync(p))
          .digest("hex");
    }
  };
  walk(dir);
  return out;
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const diff = (a, b) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])]
    .filter((k) => a[k] !== b[k])
    .join(", ");
const lockDir = (dir) =>
  path.join(
    temp,
    "claude-decisions-lock",
    crypto.createHash("sha1").update(fileKey(dir)).digest("hex").slice(0, 16),
  );

// ---- this test's own parser (the rejoin does not use the script's) ----
const linesOf = (s) => {
  const out = s.split("\n").map((l) => (l.endsWith("\r") ? l.slice(0, -1) : l));
  if (out.at(-1) === "") out.pop();
  return out;
};
const blank = (t) => !/[^ \t]/.test(t);
function headIdx(lines) {
  const out = [];
  let fence = null;
  lines.forEach((t, i) => {
    const m = t.startsWith("```") ? "```" : t.startsWith("~~~") ? "~~~" : null;
    if (fence) {
      if (m === fence) fence = null;
    } else if (m) fence = m;
    else if (t.startsWith("## ")) out.push(i);
  });
  return out;
}
// The original's pieces: the header and each section, to their last non-blank line.
function pieces(s) {
  const L = linesOf(s);
  const heads = headIdx(L);
  const cut = (a, b) => {
    let e = b;
    while (e > a && blank(L[e - 1])) e--;
    return L.slice(a, e);
  };
  const out = [];
  const header = cut(0, heads[0] ?? L.length);
  if (header.length) out.push({ name: "header", texts: header, root: true });
  heads.forEach((h, k) =>
    out.push({
      name: L[h],
      texts: cut(h, heads[k + 1] ?? L.length),
      root: L[h].trimEnd() === "## What each thing is for",
    }),
  );
  return out;
}
const findRun = (hay, needle, from) => {
  for (let i = from; i + needle.length <= hay.length; i++) {
    let k = 0;
    while (k < needle.length && hay[i + k] === needle[k]) k++;
    if (k === needle.length) return i;
  }
  return -1;
};
// Rejoin: each piece found whole in exactly one after-file (header and purpose record in the root, a section in
// docs/decisions/), in original order within a file; what is left of each file is generated or blank.
// earlier: rel -> text of a docs/decisions/ file before the split; its lines below the title are one more piece.
function rejoin(original, after, earlier = {}) {
  const errs = [];
  const old = Object.entries(earlier).map(([rel, s]) => {
    const L = linesOf(s).slice(1);
    while (L.length && blank(L[0])) L.shift();
    while (L.length && blank(L.at(-1))) L.pop();
    return { name: rel, texts: L, in: rel };
  });
  const files = new Map(
    [...Object.entries(after)].map(([rel, s]) => [rel, linesOf(s)]),
  );
  const cursor = new Map();
  const used = new Map([...files.keys()].map((rel) => [rel, new Set()]));
  for (const p of [...pieces(original), ...old.filter((p) => p.texts.length)]) {
    const hits = [...files].filter(
      ([rel, L]) => findRun(L, p.texts, cursor.get(rel) ?? 0) >= 0,
    );
    if (hits.length !== 1) {
      errs.push(`${p.name}: found in ${hits.length} files`);
      continue;
    }
    const [rel, L] = hits[0];
    if (p.in ? p.in !== rel : p.root !== (rel === D))
      errs.push(`${p.name}: in ${rel}`);
    const at = findRun(L, p.texts, cursor.get(rel) ?? 0);
    for (let i = at; i < at + p.texts.length; i++) used.get(rel).add(i);
    cursor.set(rel, at + p.texts.length);
  }
  for (const [rel, L] of files)
    L.forEach((t, i) => {
      if (used.get(rel).has(i) || blank(t)) return;
      const gen =
        rel === D
          ? t === INDEX_HEAD ||
            t === INDEX_TEXT ||
            /^- `docs\/decisions\/[^`]+\.md`: /.test(t)
          : i === 0 && t.startsWith("# ");
      if (!gen) errs.push(`left over: ${rel}:${i + 1}`);
    });
  return errs;
}
// The record set after a run: rel -> latin1 string.
function afterOf(dir, enc = "utf8") {
  const out = { [D]: read(dir, D, enc) };
  const dd = path.join(dir, "docs", "decisions");
  if (fs.existsSync(dd))
    for (const n of fs.readdirSync(dd).filter((x) => x.endsWith(".md")))
      out[`docs/decisions/${n}`] = read(dir, `docs/decisions/${n}`, enc);
  return out;
}
// "- **" lines as a sorted list, outside the index lines.
const entryLines = (texts) =>
  texts.flatMap((s) => linesOf(s).filter((t) => t.startsWith("- **"))).sort();
const headCount = (texts) =>
  texts.reduce((n, s) => {
    const L = linesOf(s);
    return n + headIdx(L).filter((i) => L[i] !== INDEX_HEAD).length;
  }, 0);
// Split, then the proofs every split gets: exit 0, verify against git, rejoin, each "- **" line once, headings kept.
function splitAndProve(name, dir, { root = true } = {}) {
  const original = read(dir, D, "latin1");
  const { [D]: _, ...earlier } = afterOf(dir, "latin1");
  const r = run(dir, ["--split"]);
  check(
    `${name}: split exits 0`,
    r.code === 0 && r.out.startsWith("split: "),
    r.out,
  );
  const v = run(dir, ["--verify", "HEAD"]);
  check(
    `${name}: verify HEAD passes`,
    v.code === 0 && / 0 lost, 0 doubled/.test(v.out),
    v.out,
  );
  const after = afterOf(dir, "latin1");
  const errs = rejoin(original, after, earlier);
  check(
    `${name}: rejoin rebuilds the original`,
    !errs.length,
    errs.slice(0, 5).join("; "),
  );
  check(
    `${name}: every "- **" line once, byte for byte`,
    same(
      entryLines([original, ...Object.values(earlier)]),
      entryLines(Object.values(after)),
    ),
  );
  check(
    `${name}: headings kept`,
    headCount([original]) === headCount(Object.values(after)),
  );
  if (root)
    check(
      `${name}: root under 200 lines and 25,000 bytes`,
      linesOf(after[D]).length < 200 && after[D].length < 25000,
      `${linesOf(after[D]).length} lines, ${after[D].length} bytes`,
    );
  return { r, after: afterOf(dir), original };
}

// ---- inputs ----
const T1 = `# Decisions

Every user decision as **decision** — why · *origin, date*. This file wins over older docs.

## What each thing is for

- **thing** (also: t): "Does x" · *2026-11-01* · from "x"

## 2026-11-12: Third job

- **Entry twelve** keep it · *user, 2026-11-12*
- **No date entry** keeps no date · *user*

## 2026-11-11: Second job

- **Entry eleven** why · *user, 2026-11-11*

## 2026-11-10: First job

- **Entry ten** with a list · *user, 2026-11-10*

  - sub a
  - sub b
- **Entry ten b** plain · *user, 2026-11-10*
`;
const T2 = `# Decisions in force

## Combat

- **Swords cut** · *user*
- **Shields block** · *user*

## Crafting

- **Wood burns**

## Map

- **North is up**
`;
// T1 with the same heading again far below (T7), so one target holds two sections
const T7 = `${T1}
## 2026-11-12: Third job

- **Twelve again** later · *user, 2026-11-12*
`;

// T1, T2: by date and by topic
{
  const dir = project({ [D]: T1 });
  const { after } = splitAndProve("T1 by date", dir);
  const files = Object.keys(after).filter((k) => k !== D);
  check(
    "T1: 3 job files",
    same(files.sort(), [
      "docs/decisions/2026-11-10-first-job.md",
      "docs/decisions/2026-11-11-second-job.md",
      "docs/decisions/2026-11-12-third-job.md",
    ]),
    files.join(", "),
  );
  check(
    "T1: root = header + purpose record + index",
    after[D].startsWith(T1.slice(0, T1.indexOf("## 2026-11-12"))) &&
      after[D].endsWith(`${INDEX_HEAD}\n\n${INDEX_TEXT}\n`),
    after[D],
  );
  check(
    "T1: job file is title, blank, section",
    after["docs/decisions/2026-11-11-second-job.md"] ===
      "# 2026-11-11: Second job\n\n## 2026-11-11: Second job\n\n- **Entry eleven** why · *user, 2026-11-11*\n\n",
    JSON.stringify(after["docs/decisions/2026-11-11-second-job.md"]),
  );
  // T3: a second run changes nothing
  const before = snap(dir);
  const r = run(dir, ["--split"]);
  check(
    "T3: second split has nothing to move",
    r.code === 0 && r.out.startsWith("split: nothing to move;"),
    r.out,
  );
  check(
    "T3: every file unchanged",
    same(before, snap(dir)),
    diff(before, snap(dir)),
  );
  check("T3: lock freed", !fs.existsSync(lockDir(dir)));
}
{
  const dir = project({ [D]: T2 });
  const { after } = splitAndProve("T2 by topic", dir);
  check(
    "T2: 3 topic files, 3 index lines",
    same(Object.keys(after).sort(), [
      D,
      "docs/decisions/combat.md",
      "docs/decisions/crafting.md",
      "docs/decisions/map.md",
    ]) &&
      linesOf(after[D]).filter((t) => t.startsWith("- `docs/decisions/"))
        .length === 3,
    after[D],
  );
  check(
    "T2: root keeps its header",
    after[D].startsWith("# Decisions in force\n\n## Decision files\n"),
    after[D],
  );
}

// T7: the same heading twice, far apart
{
  const dir = project({ [D]: T7 });
  const { after } = splitAndProve("T7 same heading twice", dir);
  const f = after["docs/decisions/2026-11-12-third-job.md"];
  check(
    "T7: one file, both sections in file order",
    f.indexOf("Entry twelve") < f.indexOf("Twelve again") &&
      f.indexOf("Entry twelve") > 0,
    f,
  );
}

// T4: each fault leaves every file as it was
const existingX =
  "# 2026-11-11: Second job\n\n- **Older eleven** · *user, 2026-11-11*\n";
for (const fault of [
  "drop-line",
  "dup-line",
  "swap-sections",
  "wrong-file",
  "change-byte",
  "drop-inner-blank",
  "fail-after-files",
  "fail-root-write",
  "root-changed",
  "target-changed",
  "target-created",
]) {
  const withTarget = fault === "target-changed";
  const dir = project(
    withTarget
      ? { [D]: T7, "docs/decisions/2026-11-11-second-job.md": existingX }
      : { [D]: T7 },
  );
  const before = snap(dir);
  const r = run(dir, ["--split"], fault);
  const now = snap(dir);
  const expect = { ...before };
  if (fault === "root-changed")
    expect[D] = crypto
      .createHash("sha1")
      .update(`${T7}- other session\n`)
      .digest("hex");
  if (fault === "target-changed")
    expect["docs/decisions/2026-11-11-second-job.md"] = crypto
      .createHash("sha1")
      .update(`${existingX}- other session\n`)
      .digest("hex");
  if (fault === "target-created") {
    const made = Object.keys(now).find((k) => !(k in before));
    check(
      `T4 ${fault}: the other session's file stays`,
      read(dir, made) === "# other session\n",
      made,
    );
    delete now[made];
  }
  check(
    `T4 ${fault}: exit 1, FAILED line`,
    r.code === 1 && r.out.startsWith("split FAILED, nothing changed: "),
    r.out,
  );
  check(
    `T4 ${fault}: every file as before`,
    same(expect, now),
    diff(expect, now),
  );
  if (!withTarget && fault !== "target-created")
    check(
      `T4 ${fault}: docs/decisions/ still absent`,
      !fs.existsSync(path.join(dir, "docs", "decisions")),
    );
  check(`T4 ${fault}: lock freed`, !fs.existsSync(lockDir(dir)));
  if (fault === "root-changed")
    check(
      "T4c: root-changed writes no failure record",
      !fs.existsSync(failureFile(dir)),
    );
}

// T4b: a cut-off run, and what the next run does with it
const age = (dir, minutes) => {
  const f = path.join(lockDir(dir), "owner.json");
  const o = JSON.parse(fs.readFileSync(f, "utf8"));
  o.started = new Date(Date.now() - minutes * 60000).toISOString();
  fs.writeFileSync(f, JSON.stringify(o));
};
const restoreKept = (dir) =>
  fs.existsSync(path.join(lockDir(dir), "restore.json"));
{
  const dir = project({ [D]: T7 });
  const before = snap(dir);
  const r1 = run(dir, ["--split"], "cut-off");
  check(
    "T4b cut-off: the run stops, lock and restore.json stay",
    r1.code === 9 && restoreKept(dir),
    r1.out,
  );
  age(dir, 11);
  const r2 = run(dir, ["--split"]);
  check(
    "T4b cut-off: next run restores, then splits",
    r2.code === 0 && r2.out.includes("; restored a cut-off run from "),
    r2.out,
  );
  const v = run(dir, ["--verify", "HEAD"]);
  check(
    "T4b cut-off: after the restore and split, verify passes",
    v.code === 0,
    v.out,
  );
  check("T4b cut-off: lock freed", !fs.existsSync(lockDir(dir)));
  check(
    "T4b cut-off: files changed only by the split",
    !same(before, snap(dir)),
  );
}
{
  // the first file written is an existing target with an uncommitted line, so "put back to committed" matches neither side
  const x = "docs/decisions/2026-11-11-second-job.md";
  const dir = project({ [D]: T7, [x]: existingX });
  put(dir, x, `${existingX}- **Uncommitted** · *user, 2026-11-13*\n`);
  run(dir, ["--split"], "cut-off");
  put(dir, x, `${read(dir, x)}- edited by hand\n`);
  age(dir, 11);
  const before = snap(dir);
  const a = run(dir, ["--split"]);
  check(
    "T4b variant A: exit 1, the changed-since line, nothing changed",
    a.code === 1 &&
      a.out.includes(`left files and ${x} changed since`) &&
      same(before, snap(dir)),
    a.out,
  );
  check("T4b variant A: lock and restore.json kept", restoreKept(dir));
  put(dir, x, existingX);
  const b = run(dir, ["--split"]);
  check(
    "T4b variant B: drops the restore data, then splits",
    b.code === 0 &&
      b.out.includes(
        "; dropped a cut-off run's restore data, the files match git",
      ),
    b.out,
  );
}
{
  const dir = project({ [D]: T7 });
  const before = snap(dir);
  const r1 = run(dir, ["--split"], "fail-after-files,fail-restore");
  check(
    "T4b fail-restore: exit 1, restore failed line",
    r1.code === 1 && r1.out.includes("restore failed at "),
    r1.out,
  );
  check("T4b fail-restore: lock and restore.json kept", restoreKept(dir));
  const r2 = run(dir, ["--split", "--dry-run"]);
  check(
    "T4b fail-restore: dry run reads without the lock",
    r2.code === 0,
    r2.out,
  );
  const r3 = run(dir, ["--split"]);
  check(
    "T4b fail-restore: the rerun restores and splits",
    r3.code === 0 && r3.out.includes("restored a cut-off run"),
    r3.out,
  );
  check(
    "T4b fail-restore: split result verifies",
    run(dir, ["--verify", "HEAD"]).code === 0 && !same(before, snap(dir)),
  );
}
{
  const dir = project({
    [D]: T1,
    "docs/decisions/2026-11-11-second-job.md": existingX,
  });
  const dead = spawnSync(process.execPath, ["-e", ""]).pid;
  put(dir, `docs/decisions/x.md.tmp-${dead}`, "left");
  put(dir, `docs/decisions/x.md.tmp-${process.pid}`, "live");
  run(dir, ["--split"]);
  check(
    "T4b temp files: the dead run's removed",
    !fs.existsSync(path.join(dir, `docs/decisions/x.md.tmp-${dead}`)),
  );
  check(
    "T4b temp files: the live one kept",
    fs.existsSync(path.join(dir, `docs/decisions/x.md.tmp-${process.pid}`)),
  );
}

// T4c: a lasting failure (mixed line ends in the root)
{
  const mixed =
    "# Decisions\r\n\n## 2026-11-10: a\n\n- **x** · *user, 2026-11-10*\n";
  const dir = project({ [D]: mixed });
  const before = snap(dir);
  const r = run(dir, ["--split"]);
  check(
    "T4c: exit 1, mixed line ends, nothing changed",
    r.code === 1 &&
      r.out.includes("mixed line ends in DECISIONS.md") &&
      same(before, snap(dir)),
    r.out,
  );
  const rec = fs.existsSync(failureFile(dir))
    ? JSON.parse(fs.readFileSync(failureFile(dir), "utf8"))
    : {};
  check(
    "T4c: record holds reason and both sha1s",
    rec.reason?.includes("mixed line ends") &&
      rec.rootSha1 &&
      rec.fileSha1 &&
      rec.file === D,
    JSON.stringify(rec),
  );
  check(
    "T4c: lastingFailure returns it",
    lastingFailure(dir)?.reason === rec.reason,
  );
  put(dir, D, mixed.replace("x**", "y**"));
  check(
    "T4c: one byte changed: lastingFailure returns null",
    lastingFailure(dir) === null,
  );
  put(dir, D, mixed.replace("\r\n", "\n"));
  commitAll(dir);
  const ok = run(dir, ["--split"]);
  check(
    "T4c: a passing run deletes the record",
    ok.code === 0 && !fs.existsSync(failureFile(dir)),
    ok.out,
  );
}

// T5: a ledger over T1's job files
{
  const dir = project({ [D]: T1 });
  run(dir, ["--split"]);
  put(
    dir,
    "docs/decisions/rules.md",
    "# Rules\n\n- **Old rule** · *user, 2026-11-01*\n",
  );
  commitAll(dir);
  const listed = run(dir, ["--list"]).out.split("\n");
  const entry = (start) => {
    const l = listed.find((x) => x.includes(start));
    const m = /^ {2}(\S+):\d+ ([0-9a-f]{12}) (.*)$/.exec(l ?? "");
    return { file: m[1], sha: m[2], start: m[3] };
  };
  const to = "docs/decisions/rules.md";
  const entries = [
    { ...entry("Entry ten**"), verdict: "binds", to },
    { ...entry("Entry twelve"), verdict: "binds", to },
    { ...entry("Entry eleven"), verdict: "history" },
    { ...entry("Entry ten b"), verdict: "unsure" },
    { ...entry("No date entry"), verdict: "binds", to },
  ];
  const ledger = path.join(tmp, "ledger-1.json");
  fs.writeFileSync(
    ledger,
    JSON.stringify({
      ledger: 1,
      entries: [
        ...entries,
        {
          file: entries[0].file,
          sha: "000000000000",
          start: "x",
          verdict: "history",
        },
      ],
    }),
  );
  const before = snap(dir);
  const bad = run(dir, ["--apply", ledger]);
  check(
    "T5: a sha that matches nothing aborts the apply",
    bad.code === 1 &&
      bad.out.includes("ledger entry 000000000000 not found in") &&
      same(before, snap(dir)),
    bad.out,
  );
  fs.writeFileSync(ledger, JSON.stringify({ ledger: 1, entries }));
  const dry = run(dir, ["--apply", ledger, "--dry-run"]);
  check(
    "T5: dry run gives coverage, writes nothing",
    dry.code === 0 &&
      dry.out.includes(
        "  coverage: 5 entries in the named files, 5 in the ledgers, 0 missing, 0 twice",
      ) &&
      same(before, snap(dir)),
    dry.out,
  );
  const a = run(dir, ["--apply", ledger]);
  check(
    "T5: 2 moved, 3 stay",
    a.code === 0 &&
      a.out.startsWith(
        "apply: 2 entries moved to 1 topic files (0 new); 1 stay; 1 unsure stay; 1 not moved (no date of their own); check: 0 lost, 0 doubled, 0 added",
      ),
    a.out,
  );
  const rules = read(dir, to);
  check(
    "T5: under the title, 2026-11-12 entry, then 2026-11-10, then the earlier text",
    rules ===
      "# Rules\n\n- **Entry twelve** keep it · *user, 2026-11-12*\n- **Entry ten** with a list · *user, 2026-11-10*\n\n  - sub a\n  - sub b\n\n- **Old rule** · *user, 2026-11-01*\n",
    JSON.stringify(rules),
  );
  check("T5: undo file written", fs.existsSync(`${ledger}.undo.json`));
  const again = run(dir, ["--apply", ledger]);
  check(
    "T5: a second apply: exit 1, exists",
    again.code === 1 && again.out.includes("exists: --undo first"),
    again.out,
  );
  const u = run(dir, ["--undo", ledger]);
  check(
    "T5: undo puts every file back",
    u.code === 0 && u.out.startsWith("undo: ") && same(before, snap(dir)),
    `${u.out} ${diff(before, snap(dir))}`,
  );
  run(dir, ["--apply", ledger]);
  put(dir, to, `${read(dir, to)}x`);
  const mid = snap(dir);
  const ref = run(dir, ["--undo", ledger]);
  check(
    "T5: undo refused after a topic file changed",
    ref.code === 1 &&
      ref.out.includes(
        `undo FAILED, nothing changed: ${to} changed since the apply (use git)`,
      ) &&
      same(mid, snap(dir)),
    ref.out,
  );
}

// T6: the lock
{
  const dir = project({ [D]: T1 });
  fs.mkdirSync(lockDir(dir), { recursive: true });
  const owner = (min) =>
    fs.writeFileSync(
      path.join(lockDir(dir), "owner.json"),
      JSON.stringify({
        pid: process.pid,
        started: new Date(Date.now() - min * 60000).toISOString(),
        command: "split",
      }),
    );
  owner(1);
  const before = snap(dir);
  const busy = run(dir, ["--split"]);
  check(
    "T6: lock 1 minute old: exit 2, nothing written",
    busy.code === 2 &&
      busy.out.startsWith("decisions: busy") &&
      same(before, snap(dir)),
    busy.out,
  );
  owner(11);
  const took = run(dir, ["--split"]);
  check(
    "T6: lock 11 minutes old: runs, took over",
    took.code === 0 && took.out.includes("; took over a lock from "),
    took.out,
  );
}

// T8: file names from headings
{
  const heads = [
    "2026-11-05: Size cap on `~/.claude/CLAUDE.md`",
    "Café (notes)",
    "2026-11-05",
    "2026-11-14 — x",
    "決定",
    "決め事",
  ];
  const dir = project({
    [D]: `# Decisions\n\n${heads.map((h, k) => `## ${h}\n\n- **e${k}** · *user, 2026-11-05*\n`).join("\n")}`,
  });
  splitAndProve("T8 names", dir);
  const names = fs.readdirSync(path.join(dir, "docs", "decisions")).sort();
  const hashed = names.filter((n) => /^h-[0-9a-f]{8}\.md$/.test(n));
  check(
    "T8: names from the naming rule",
    [
      "2026-11-05-size-cap-on-claude-claude-md.md",
      "cafe.md",
      "2026-11-05-entries.md",
      "2026-11-14-x.md",
    ].every((n) => names.includes(n)) && hashed.length === 2,
    names.join(", "),
  );
}

// T9: stray lines in the index
{
  const dir = project({ [D]: T2 });
  run(dir, ["--split"]);
  let root = read(dir, D);
  root = root.replace(
    "- `docs/decisions/map.md`: Map",
    "- `docs/decisions/map.md`: Maps by hand",
  );
  put(
    dir,
    D,
    `${root}- **x**\n\n## 2026-11-14: new job\n\n- **New** · *user, 2026-11-14*\n`,
  );
  commitAll(dir);
  const r = run(dir, ["--split"]);
  const L = linesOf(read(dir, D));
  const a = L.indexOf("- `docs/decisions/map.md`: Maps by hand") + 1;
  const b = L.indexOf("- **x**") + 1;
  check("T9: both stay in the root", a > 0 && b > 0, read(dir, D));
  check(
    "T9: output names 2 stray lines",
    r.code === 0 &&
      r.out.includes(`2 stray lines in the index (line ${a}, ${b})`),
    r.out,
  );
  const c = run(dir, ["--check"]);
  check(
    "T9: --check gives D6 and D4",
    /D6 DECISIONS\.md: 2 stray lines/.test(c.out) &&
      /D4 DECISIONS\.md: line \d+: title differs/.test(c.out),
    c.out,
  );
}

// T10: line ends, BOM, a last line with no line end, a raw \xff byte, a fenced ## line, an unclosed fence, no title
{
  const root = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from(
      "# Decisions\r\n\r\n## Notes\r\n\r\n- **Note** · *user, 2026-11-10*\r\n\r\n## 2026-11-10: job\r\n\r\n```\r\n## x\r\n```\r\n- **Raw ",
      "utf8",
    ),
    Buffer.from([0xff]),
    Buffer.from("** · *user, 2026-11-10*\r\n- **Last** no line end", "utf8"),
  ]);
  const dir = project({
    [D]: root,
    "docs/decisions/notes.md": "# Notes\n\n- **Old note**\n",
  });
  splitAndProve("T10 bytes", dir);
  const notes = read(dir, "docs/decisions/notes.md", "latin1");
  const job = fs.readFileSync(
    path.join(dir, "docs/decisions/2026-11-10-job.md"),
  );
  check(
    "T10: moved lines LF in the LF file",
    !notes.includes("\r") && notes.includes("## Notes\n\n- **Note**"),
    JSON.stringify(notes),
  );
  check(
    "T10: new file takes the root's CRLF",
    job
      .toString("latin1")
      .split("\n")
      .slice(0, -1)
      .every((l) => l.endsWith("\r")),
    JSON.stringify(job.toString("latin1")),
  );
  check(
    "T10: BOM stays on the root's first line",
    read(dir, D, "latin1").startsWith("\xef\xbb\xbf# Decisions\r\n"),
  );
  check(
    "T10: last line gets the target's line end",
    job.toString("latin1").includes("- **Last** no line end\r\n"),
  );
  check(
    "T10: \xff moved byte for byte",
    job.includes(Buffer.from([0x52, 0x61, 0x77, 0x20, 0xff])),
  );
  check(
    "T10: the fenced ## x moves with its section",
    job.toString("latin1").includes("```\r\n## x\r\n```") &&
      !fs.existsSync(path.join(dir, "docs/decisions/x.md")),
  );
  for (const [name, files, says] of [
    [
      "unclosed fence",
      { [D]: "# D\n\n## 2026-11-10: a\n\n```\n- **x**\n" },
      "unclosed code fence at DECISIONS.md:5",
    ],
    [
      "target with no title",
      {
        [D]: "# D\n\n## Notes\n\n- **x**\n",
        "docs/decisions/notes.md": "- **old**\n",
      },
      "docs/decisions/notes.md has no title line",
    ],
  ]) {
    const d = project(files);
    const before = snap(d);
    const r = run(d, ["--split"]);
    check(
      `T10 ${name}: exit 1, nothing changed`,
      r.code === 1 && r.out.includes(says) && same(before, snap(d)),
      r.out,
    );
  }
}

// T11: a split onto an existing job file goes on top, right under the title
{
  const x = "docs/decisions/2026-11-14-x.md";
  const dir = project({
    [D]: "# D\n\n## 2026-11-14 — x\n\n- **New x** · *user, 2026-11-14*\n",
    [x]: "# 2026-11-14 — x\n\n- **Old x** · *user, 2026-11-14*\n",
  });
  splitAndProve("T11 existing target", dir);
  check(
    "T11: moved section right under the title",
    read(dir, x) ===
      "# 2026-11-14 — x\n\n## 2026-11-14 — x\n\n- **New x** · *user, 2026-11-14*\n\n- **Old x** · *user, 2026-11-14*\n",
    JSON.stringify(read(dir, x)),
  );
}

// T12: --verify, and the git gate
{
  const dir = project({ [D]: T1 });
  run(dir, ["--split"]);
  const v = run(dir, ["--verify", "HEAD"]);
  check(
    "T12: verify after a split: 0 lost, 0 doubled",
    v.code === 0 && v.out.includes("0 lost, 0 doubled"),
    v.out,
  );
  const f = "docs/decisions/2026-11-11-second-job.md";
  const kept = read(dir, f);
  put(
    dir,
    f,
    kept.replace("- **Entry eleven** why · *user, 2026-11-11*\n", ""),
  );
  const lost = run(dir, ["--verify"]);
  check(
    "T12: one line deleted: 1 lost, named",
    lost.code === 1 &&
      lost.out.startsWith("verify FAILED: 1 lost") &&
      lost.out.includes("lost: DECISIONS.md:16: - **Entry eleven**"),
    lost.out,
  );
  put(dir, f, kept);
  const g = "docs/decisions/2026-11-10-first-job.md";
  put(
    dir,
    g,
    read(dir, g).replace(
      "list · *user, 2026-11-10*\n\n  - sub a",
      "list · *user, 2026-11-10*\n  - sub a",
    ),
  );
  const ch = run(dir, ["--verify"]);
  check(
    "T12: inner blank removed: changed line",
    ch.code === 1 && ch.out.includes("changed: DECISIONS.md:20"),
    ch.out,
  );
  for (const [name, d] of [
    ["no git", project({ [D]: T1 }, { git: false })],
    ["untracked", project({ [D]: T1 }, { commit: false })],
  ]) {
    const codes = ["--verify", "--split"].map((c) => run(d, [c]).code);
    fs.writeFileSync(
      path.join(tmp, "empty-ledger.json"),
      JSON.stringify({ ledger: 1, entries: [] }),
    );
    codes.push(run(d, ["--apply", path.join(tmp, "empty-ledger.json")]).code);
    check(
      `T12 ${name}: --verify, --split, --apply exit 3`,
      same(codes, [3, 3, 3]),
      codes.join(","),
    );
    check(
      `T12 ${name}: --check and --split --dry-run run`,
      run(d, ["--check"]).code === 0 &&
        run(d, ["--split", "--dry-run"]).code === 0,
    );
  }
}

// The rejoin itself fails on spoiled after-states
{
  const dir = project({ [D]: T7 });
  const { original } = splitAndProve("rejoin spoil base", dir);
  const after = afterOf(dir, "latin1");
  const t = "docs/decisions/2026-11-12-third-job.md";
  const swapped = {
    ...after,
    [t]: after[t].replace(
      /(## 2026-11-12: Third job\n\n- \*\*Entry twelve[\s\S]*?\n\n)(## 2026-11-12: Third job\n\n- \*\*Twelve again[\s\S]*?\n\n)/,
      "$2$1",
    ),
  };
  const wrong = { ...after };
  const moved =
    "## 2026-11-11: Second job\n\n- **Entry eleven** why · *user, 2026-11-11*\n\n";
  wrong["docs/decisions/2026-11-11-second-job.md"] = after[
    "docs/decisions/2026-11-11-second-job.md"
  ].replace(moved, "");
  wrong[t] = after[t] + moved;
  const byte = {
    ...after,
    [t]: after[t].replace("Entry twelve", "Entry twelvf"),
  };
  for (const [name, a] of [
    ["swapped", swapped],
    ["wrong file", wrong],
    ["byte changed", byte],
  ])
    check(
      `rejoin fails: ${name}`,
      a[t] !== after[t] && rejoin(original, a).length > 0,
    );
}

// T13: the real files, on copies
const real = (process.env.DECISIONS_REAL_FILES ?? "")
  .split(";")
  .filter(Boolean);
if (!real.length) console.log("skipped (DECISIONS_REAL_FILES unset)");
for (const src of real) {
  if (!fs.existsSync(src)) {
    console.log(`SKIP real file missing: ${src}`);
    continue;
  }
  const bytes = fs.readFileSync(src);
  const name = `T13 ${path.basename(path.dirname(src))}`;
  const dir = project({ [D]: bytes });
  const L = linesOf(bytes.toString("latin1"));
  if (!headIdx(L).length) {
    const before = snap(dir);
    const r = run(dir, ["--split"]);
    check(
      `${name}: no ## sections: nothing to move, exit 0, unchanged`,
      r.code === 0 &&
        r.out.startsWith(
          "split: nothing to move: DECISIONS.md has no ## sections",
        ) &&
        same(before, snap(dir)),
      r.out,
    );
    continue;
  }
  const { r } = splitAndProve(name, dir);
  console.log(`     ${r.out.split("\n")[0]}`);
}

// T14: a folder argument that is not a folder is refused, never run on the current folder
{
  const dir = project({ [D]: T1 });
  const ledger = path.join(tmp, "t14-ledger.json");
  fs.writeFileSync(ledger, JSON.stringify({ ledger: 1, entries: [] }));
  const before = snap(dir);
  const inDir = (args) => {
    const r = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: dir,
      encoding: "utf8",
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const missing = path.join(tmp, "no-such-project");
  for (const args of [
    ["--split", missing],
    ["--split", "--dry-run", missing],
    ["--check", missing],
    ["--apply", ledger, missing],
    ["--verify", "HEAD", missing],
  ]) {
    const r = inDir(args);
    check(
      `T14 ${args.join(" ").replace(missing, "<missing>").replace(ledger, "<ledger>")}: exit 3, no folder, nothing changed`,
      r.code === 3 &&
        r.out.trim() === `decisions: no folder ${missing}` &&
        same(before, snap(dir)),
      r.out,
    );
  }
  check(
    "T14: --verify with one revision runs on the current folder",
    inDir(["--verify", "HEAD"]).code === 0,
  );
}

// T15: a git-ignored docs/decisions/ is refused before any write
{
  const dir = project({ [D]: T1, ".gitignore": "docs/decisions/\n" });
  const before = snap(dir);
  const r = run(dir, ["--split"]);
  check(
    "T15: ignored docs/decisions/: exit 3, named, nothing changed",
    r.code === 3 &&
      r.out.includes("git ignores docs/decisions/") &&
      same(before, snap(dir)) &&
      !fs.existsSync(path.join(dir, "docs")),
    r.out,
  );
  check("T15: lock freed", !fs.existsSync(lockDir(dir)));
}

// T16: a project in a subfolder of a repository, with another DECISIONS.md at the repository's top
{
  const top = project({ [D]: T2, [`sub/proj/${D}`]: T1 });
  const dir = path.join(top, "sub", "proj");
  splitAndProve("T16 project in a subfolder", dir);
  check(
    "T16: the top DECISIONS.md untouched",
    read(top, D) === T2 && !fs.existsSync(path.join(top, "docs")),
  );
}

// T17: a heading ending in "à" (UTF-8 C3 A0) keeps its last byte in the title and the index line
{
  const dir = project({ [D]: `${T2}\n## Qualità\n\n- **Tests first**\n` });
  const { after } = splitAndProve("T17 heading ending in à", dir);
  const f = "docs/decisions/qualita.md";
  check(
    "T17: title and index line end in à",
    after[f]?.startsWith("# Qualità\n\n## Qualità\n") &&
      after[D].includes(`- \`${f}\`: Qualità\n`),
    `${after[f]?.split("\n")[0]} | ${after[D]}`,
  );
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
