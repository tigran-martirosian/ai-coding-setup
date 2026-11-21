// node tests/test-leftover-worktrees.mjs
// Builds a repository with linked worktrees in every state under the system temp folder, runs
// skills/lead/scripts/leftover-worktrees.mjs on it in list mode, with --remove --prefix job/ and with --remove
// --min-age-hours (on a second repository), and checks what it lists, removes and leaves.
// Real git; its own identity and no machine git settings. Removes its folder at the end.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "lead",
  "scripts",
  "leftover-worktrees.mjs",
);
const T = fs.mkdtempSync(path.join(os.tmpdir(), "leftover-wt-test-"));
let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${String(detail).slice(0, 800)}`}`,
  );
}
const GITCONFIG = path.join(T, "gitconfig");
fs.writeFileSync(GITCONFIG, "");
const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_CONFIG_NOSYSTEM: "1",
};
function git(cwd, ...a) {
  const r = spawnSync("git", ["-C", cwd, ...a], { encoding: "utf8", env: ENV });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
}
const run = (...a) => runWith({}, ...a);
function runWith(extraEnv, ...a) {
  const r = spawnSync(process.execPath, [SCRIPT, ...a], {
    encoding: "utf8",
    env: { ...ENV, ...extraEnv },
  });
  return {
    code: r.status,
    out: r.stdout,
    err: r.stderr,
    all: r.stdout + r.stderr,
  };
}
function put(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
const ex = (p) => fs.existsSync(p);
// git prints C:/x/y on Windows; the temp folder can be a link (macOS) or a short name (Windows)
const real = (p) => (ex(p) ? fs.realpathSync.native(p) : path.resolve(p));
const norm = (p) => {
  const s = real(p).replace(/\\/g, "/").replace(/\/$/, "");
  return process.platform === "win32" ? s.toLowerCase() : s;
};
const samePath = (a, b) => norm(a) === norm(b);
const branches = () =>
  git(REPO, "branch", "--format=%(refname:short)").split("\n");
const listed = () =>
  git(REPO, "worktree", "list", "--porcelain")
    .split("\n")
    .filter((l) => l.startsWith("worktree "))
    .map((l) => l.slice(9));
// one stdout line per worktree: state, path, branch, last commit line [, removed]
const parse = (out) =>
  out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split("\t"));
const lineFor = (rows, p) => rows.find((r) => r[1] && samePath(r[1], p));

const REPO = path.join(T, "repo");
const W = path.join(T, "wt");
// the temp folder goes even when a step throws
try {
  // ---- the repository: main checkout on main, the base branch dev in its own linked worktree
  put(path.join(REPO, "README.md"), "repo\n");
  put(path.join(REPO, ".gitignore"), "*.log\n");
  git(REPO, "init", "-q", "-b", "main");
  git(REPO, "add", ".");
  git(REPO, "commit", "-q", "-m", "first");
  git(REPO, "branch", "dev");
  const WT = {
    base: path.join(W, "base"),
    merged: path.join(W, "merged"),
    foreign: path.join(W, "foreign"),
    dirty: path.join(W, "dirty"),
    unmerged: path.join(W, "unmerged"),
    locked: path.join(W, "locked"),
    detached: path.join(W, "detached"),
    missing: path.join(W, "missing"),
    missingForeign: path.join(W, "missing-foreign"),
    missingUnmerged: path.join(W, "missing-unmerged"),
  };
  git(REPO, "worktree", "add", "-q", WT.base, "dev");
  // a slice: a worktree on its own branch with one commit, squash-merged into dev when asked
  function slice(dir, branch, subject, { squash }) {
    git(REPO, "worktree", "add", "-q", "-b", branch, dir, "dev");
    const name = `${path.basename(dir)}.txt`;
    put(path.join(dir, name), `${subject}\n`);
    git(dir, "add", name);
    git(dir, "commit", "-q", "-m", subject);
    if (squash) {
      git(WT.base, "merge", "-q", "--squash", branch);
      git(WT.base, "commit", "-q", "-m", `squash ${branch}`);
    }
  }
  slice(WT.merged, "job/s1", "merged slice work", { squash: true });
  put(path.join(WT.merged, "run.log"), "a git-ignored file only"); // ignored files do not make it dirty
  slice(WT.foreign, "other/s1", "another session's work", { squash: true });
  slice(WT.dirty, "job/s2", "dirty slice work", { squash: true });
  put(path.join(WT.dirty, "notes.txt"), "never committed"); // the one untracked file
  slice(WT.unmerged, "job/s3", "unmerged slice work", { squash: false });
  slice(WT.locked, "job/s4", "locked slice work", { squash: true });
  git(REPO, "worktree", "lock", "--reason", "in use", WT.locked);
  slice(WT.missing, "job/s5", "missing slice work", { squash: true });
  slice(WT.missingForeign, "other/s2", "missing foreign work", {
    squash: true,
  });
  slice(WT.missingUnmerged, "job/s6", "missing unmerged work", {
    squash: false,
  });
  // the base moves on in another file after the merges, as it does while a job runs
  put(path.join(WT.base, "later.txt"), "later\n");
  git(WT.base, "add", "later.txt");
  git(WT.base, "commit", "-q", "-m", "base moves on");
  git(REPO, "worktree", "add", "-q", "--detach", WT.detached, "dev");
  fs.rmSync(WT.missing, { recursive: true, force: true });
  fs.rmSync(WT.missingForeign, { recursive: true, force: true });
  fs.rmSync(WT.missingUnmerged, { recursive: true, force: true });

  // ---- argument and repository errors: non-zero, one message that names the cause
  const noArgs = run();
  check(
    "with no arguments it exits non-zero and says an argument is missing",
    noArgs.code !== 0 && /missing|usage/i.test(noArgs.err),
    noArgs.all,
  );
  const notRepo = path.join(T, "not-a-repo");
  fs.mkdirSync(notRepo);
  const nr = run(notRepo, "dev");
  check(
    "a folder that is not a git repository: non-zero, and the message says so",
    nr.code !== 0 && /not a git repository/i.test(nr.err) && nr.out === "",
    nr.all,
  );
  const nb = run(REPO, "no-such-branch");
  check(
    "a base branch that does not exist: non-zero, and the message names the branch",
    nb.code !== 0 &&
      /no-such-branch/.test(nb.err) &&
      /does not exist|not found|no branch/i.test(nb.err) &&
      nb.out === "",
    nb.all,
  );
  const noPrefix = run(REPO, "dev", "--remove");
  check(
    "--remove without --prefix: non-zero, the message names --prefix, nothing removed",
    noPrefix.code !== 0 && /--prefix/.test(noPrefix.err) && ex(WT.merged),
    noPrefix.all,
  );
  const noSlash = run(REPO, "dev", "--remove", "--prefix", "job");
  check(
    "a --prefix that does not end in / (job would also take jobs/s1): non-zero, the message says it must end in /, nothing removed",
    noSlash.code !== 0 &&
      /--prefix/.test(noSlash.err) &&
      /end in "?\/"?/.test(noSlash.err) &&
      noSlash.out === "" &&
      ex(WT.merged),
    noSlash.all,
  );

  // ---- list mode: one line per linked worktree, four fields, nothing changed
  // every file under T with its size (names only inside .git, where git may refresh a file in place), every ref
  // with its commit, and git's worktree list: the same before and after means the run changed nothing
  function snapshot() {
    const files = [];
    const go = (d, inGit) => {
      for (const n of fs.readdirSync(d).sort()) {
        const p = path.join(d, n);
        const st = fs.lstatSync(p);
        const g = inGit || n === ".git";
        files.push(g ? p : `${p}|${st.size}`);
        if (st.isDirectory()) go(p, g);
      }
    };
    go(T, false);
    return [
      files.join("\n"),
      git(REPO, "for-each-ref", "--format=%(refname) %(objectname)"),
      git(REPO, "worktree", "list", "--porcelain"),
    ].join("\n--\n");
  }
  const before = snapshot();
  const ls = run(REPO, "dev");
  check(
    "list mode exits 0 with dirty and unmerged worktrees left",
    ls.code === 0,
    ls.all,
  );
  check(
    "list mode changes nothing on disk, in the refs or in git's worktree list",
    snapshot() === before,
  );
  const rows = parse(ls.out);
  const STATES = [
    "merged-clean",
    "dirty",
    "unmerged",
    "base",
    "locked",
    "missing",
  ];
  check(
    "list mode prints one line per linked worktree (ten), never the main checkout",
    rows.length === 10 && !lineFor(rows, REPO),
    ls.out,
  );
  check(
    "each line has four tab-separated fields: a state word, the path, the branch, the last commit line",
    rows.length > 0 &&
      rows.every(
        (r) =>
          r.length === 4 &&
          STATES.includes(r[0]) &&
          r[1] !== "" &&
          r[2] !== "" &&
          /^[0-9a-f]{7,} \S/.test(r[3]),
      ),
    ls.out,
  );
  const expectList = [
    [WT.base, "base", "dev", "base moves on"],
    [WT.merged, "merged-clean", "job/s1", "merged slice work"],
    [WT.foreign, "merged-clean", "other/s1", "another session's work"],
    [WT.dirty, "dirty", "job/s2", "dirty slice work"],
    [WT.unmerged, "unmerged", "job/s3", "unmerged slice work"],
    [WT.locked, "locked", "job/s4", "locked slice work"],
    [WT.detached, "merged-clean", "(detached)", "base moves on"],
    [WT.missing, "missing", "job/s5", "missing slice work"],
    [WT.missingForeign, "missing", "other/s2", "missing foreign work"],
    [WT.missingUnmerged, "missing", "job/s6", "missing unmerged work"],
  ];
  for (const [dir, state, branch, subject] of expectList) {
    const r = lineFor(rows, dir) || [];
    check(
      `list: ${path.basename(dir)} is ${state} on ${branch}, with its last commit "${subject}"`,
      r[0] === state && r[2] === branch && r[3]?.endsWith(` ${subject}`),
      `${r.join(" | ")}\n${ls.out}`,
    );
  }
  // git variables set by a caller (a hook, or a git command running this script) must not point it at another
  // repository
  const OTHER = path.join(T, "other-repo");
  put(path.join(OTHER, "x.txt"), "x\n");
  git(OTHER, "init", "-q", "-b", "main");
  git(OTHER, "add", ".");
  git(OTHER, "commit", "-q", "-m", "other");
  const otherGit = path.join(OTHER, ".git");
  const withVars = runWith(
    {
      GIT_DIR: otherGit,
      GIT_WORK_TREE: OTHER,
      GIT_INDEX_FILE: path.join(otherGit, "index"),
      GIT_OBJECT_DIRECTORY: path.join(otherGit, "objects"),
      GIT_COMMON_DIR: otherGit,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: path.join(otherGit, "objects"),
    },
    REPO,
    "dev",
  );
  check(
    "GIT_DIR and the other git path variables in the caller's environment are ignored: the same list as without them",
    withVars.code === 0 && withVars.out === ls.out,
    withVars.all,
  );

  // ---- --remove --prefix job/: only the merged-clean worktree under job/ and its branch go
  const rm = run(REPO, "dev", "--remove", "--prefix", "job/");
  const rr = parse(rm.out);
  check(
    "--remove exits 0 when dirty and unmerged worktrees remain",
    rm.code === 0,
    rm.all,
  );
  check(
    "the squash-merged clean worktree under job/ is removed, its branch deleted, its line marked removed",
    !ex(WT.merged) &&
      !branches().includes("job/s1") &&
      !listed().some((p) => samePath(p, WT.merged)) &&
      lineFor(rr, WT.merged)?.[0] === "merged-clean" &&
      lineFor(rr, WT.merged)?.[4] === "removed",
    `${branches()}\n${rm.all}`,
  );
  check(
    "a squash-merged clean worktree on a branch outside the prefix stays, with its branch",
    ex(WT.foreign) &&
      branches().includes("other/s1") &&
      lineFor(rr, WT.foreign)?.length === 4,
    rm.all,
  );
  check(
    "the dirty worktree stays on disk with its untracked file and branch, listed as dirty",
    ex(path.join(WT.dirty, "notes.txt")) &&
      branches().includes("job/s2") &&
      lineFor(rr, WT.dirty)?.[0] === "dirty" &&
      lineFor(rr, WT.dirty)?.length === 4,
    rm.all,
  );
  check(
    "the unmerged worktree stays on disk with its branch, listed as unmerged",
    ex(path.join(WT.unmerged, "unmerged.txt")) &&
      branches().includes("job/s3") &&
      lineFor(rr, WT.unmerged)?.[0] === "unmerged" &&
      lineFor(rr, WT.unmerged)?.length === 4,
    rm.all,
  );
  check(
    "the worktree on the base branch stays, listed as base, and the base branch is kept",
    ex(WT.base) &&
      branches().includes("dev") &&
      lineFor(rr, WT.base)?.[0] === "base",
    rm.all,
  );
  check(
    "the locked worktree under job/ stays, listed as locked, with its branch",
    ex(WT.locked) &&
      branches().includes("job/s4") &&
      lineFor(rr, WT.locked)?.[0] === "locked" &&
      listed().some((p) => samePath(p, WT.locked)),
    rm.all,
  );
  check(
    "the detached worktree stays: it has no branch under the prefix",
    ex(WT.detached) && lineFor(rr, WT.detached)?.length === 4,
    rm.all,
  );
  check(
    "a missing worktree under job/ whose branch is merged: git forgets it, its branch is deleted, its line marked removed",
    lineFor(rr, WT.missing)?.[0] === "missing" &&
      lineFor(rr, WT.missing)?.[4] === "removed" &&
      !listed().some((p) => samePath(p, WT.missing)) &&
      !branches().includes("job/s5"),
    `${listed()}\n${branches()}\n${rm.all}`,
  );
  check(
    "a missing worktree under job/ whose branch is unmerged stays in git's list with its branch, not marked removed",
    lineFor(rr, WT.missingUnmerged)?.[0] === "missing" &&
      lineFor(rr, WT.missingUnmerged)?.length === 4 &&
      listed().some((p) => samePath(p, WT.missingUnmerged)) &&
      branches().includes("job/s6"),
    `${listed()}\n${branches()}\n${rm.all}`,
  );
  check(
    "a missing worktree outside the prefix is left in git's worktree list",
    lineFor(rr, WT.missingForeign)?.[0] === "missing" &&
      listed().some((p) => samePath(p, WT.missingForeign)),
    `${listed()}\n${rm.all}`,
  );
  check(
    "the main checkout and its branch are never touched",
    ex(path.join(REPO, "README.md")) && branches().includes("main"),
  );
  const again = run(REPO, "dev");
  check(
    "a list run after the sweep no longer shows what was removed",
    again.code === 0 &&
      !lineFor(parse(again.out), WT.merged) &&
      !lineFor(parse(again.out), WT.missing) &&
      parse(again.out).length === 8,
    again.all,
  );

  // ---- --min-age-hours: a nightly sweep over every job takes only what is old in commit AND folder
  // "old" is made by commit dates (GIT_COMMITTER_DATE) and folder times (utimesSync), never by waiting
  const AREPO = path.join(T, "age-repo");
  const AW = path.join(T, "age-wt");
  const OLD = Math.floor(Date.now() / 1000) - 10 * 24 * 3600; // ten days ago
  const OLD_ENV = {
    GIT_AUTHOR_DATE: `@${OLD} +0000`,
    GIT_COMMITTER_DATE: `@${OLD} +0000`,
  };
  function gitEnv(extra, cwd, ...a) {
    const r = spawnSync("git", ["-C", cwd, ...a], {
      encoding: "utf8",
      env: { ...ENV, ...extra },
    });
    if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
    return r.stdout.trim();
  }
  const gitOld = (cwd, ...a) => gitEnv(OLD_ENV, cwd, ...a);
  const aBranches = () =>
    git(AREPO, "branch", "--format=%(refname:short)").split("\n");
  const aListed = () =>
    git(AREPO, "worktree", "list", "--porcelain")
      .split("\n")
      .filter((l) => l.startsWith("worktree "))
      .map((l) => l.slice(9));
  // the folder and its .git file get the time ten days ago
  function ageFolder(dir) {
    fs.utimesSync(dir, OLD, OLD);
    fs.utimesSync(path.join(dir, ".git"), OLD, OLD);
  }
  put(path.join(AREPO, "README.md"), "age repo\n");
  gitOld(AREPO, "init", "-q", "-b", "main");
  gitOld(AREPO, "add", ".");
  gitOld(AREPO, "commit", "-q", "-m", "first");
  gitOld(AREPO, "branch", "dev");
  const A = {
    base: path.join(AW, "base"),
    old: path.join(AW, "old"),
    fresh: path.join(AW, "fresh"),
    youngCommit: path.join(AW, "young-commit"),
    youngGitFile: path.join(AW, "young-git-file"),
    dirty: path.join(AW, "dirty"),
    unmerged: path.join(AW, "unmerged"),
    locked: path.join(AW, "locked"),
    missing: path.join(AW, "missing"),
    bothOld: path.join(AW, "both-old"),
    bothYoung: path.join(AW, "both-young"),
    bothOther: path.join(AW, "both-other"),
  };
  gitOld(AREPO, "worktree", "add", "-q", A.base, "dev");
  // a slice with one commit (old unless young), squash-merged into dev when asked; all base commits are old
  function ageSlice(dir, branch, subject, { squash, young = false }) {
    gitOld(AREPO, "worktree", "add", "-q", "-b", branch, dir, "dev");
    const name = `${path.basename(dir)}.txt`;
    put(path.join(dir, name), `${subject}\n`);
    gitOld(dir, "add", name);
    gitEnv(young ? {} : OLD_ENV, dir, "commit", "-q", "-m", subject);
    if (squash) {
      gitOld(A.base, "merge", "-q", "--squash", branch);
      gitOld(A.base, "commit", "-q", "-m", `squash ${branch}`);
    }
  }
  ageSlice(A.old, "a/s1", "old merged work", { squash: true });
  ageSlice(A.youngCommit, "a/s2", "young merged work", {
    squash: true,
    young: true,
  });
  ageSlice(A.youngGitFile, "a/s3", "merged work, new .git file", {
    squash: true,
  });
  ageSlice(A.dirty, "a/s4", "old dirty work", { squash: true });
  put(path.join(A.dirty, "notes.txt"), "never committed");
  ageSlice(A.unmerged, "a/s5", "old unmerged work", { squash: false });
  ageSlice(A.locked, "a/s6", "old locked work", { squash: true });
  gitOld(AREPO, "worktree", "lock", "--reason", "in use", A.locked);
  ageSlice(A.missing, "a/s7", "old missing work", { squash: true });
  ageSlice(A.bothOld, "c/s1", "old merged work under c/", { squash: true });
  ageSlice(A.bothYoung, "c/s2", "young merged work under c/", {
    squash: true,
    young: true,
  });
  ageSlice(A.bothOther, "d/s1", "old merged work under d/", {
    squash: true,
  });
  // a slice worktree made just now, no commit yet: it sits on dev's old tip, so it is merged-clean too
  gitOld(AREPO, "worktree", "add", "-q", "-b", "b/s1", A.fresh, "dev");
  fs.rmSync(A.missing, { recursive: true, force: true });
  for (const d of [
    A.base,
    A.old,
    A.youngCommit,
    A.youngGitFile,
    A.dirty,
    A.unmerged,
    A.locked,
    A.bothOld,
    A.bothYoung,
    A.bothOther,
  ])
    ageFolder(d);
  const nowS = Date.now() / 1000;
  fs.utimesSync(path.join(A.youngGitFile, ".git"), nowS, nowS); // only its .git file is new
  // an old merged worktree whose .git file is gone but whose folder remains, inside another clean repository
  // that ignores it: git status there answers for that repository, so the worktree reads as merged-clean
  const HOST = path.join(T, "host-repo");
  A.noGitFile = path.join(HOST, "inner");
  put(path.join(HOST, ".gitignore"), "inner/\n");
  gitOld(HOST, "init", "-q", "-b", "main");
  gitOld(HOST, "add", ".");
  gitOld(HOST, "commit", "-q", "-m", "host");
  ageSlice(A.noGitFile, "e/s1", "old merged work, .git file gone", {
    squash: true,
  });
  fs.rmSync(path.join(A.noGitFile, ".git"));
  fs.utimesSync(A.noGitFile, OLD, OLD);

  const aloneRemove = run(AREPO, "dev", "--remove");
  check(
    "--remove with neither --prefix nor --min-age-hours: non-zero, the message names both, nothing removed",
    aloneRemove.code !== 0 &&
      /--prefix/.test(aloneRemove.err) &&
      /--min-age-hours/.test(aloneRemove.err) &&
      aloneRemove.out === "" &&
      ex(A.old) &&
      aBranches().includes("a/s1"),
    aloneRemove.all,
  );
  for (const bad of ["abc", "0", "-3"]) {
    const r = run(AREPO, "dev", "--remove", "--min-age-hours", bad);
    check(
      `--min-age-hours ${bad}: non-zero, the message names --min-age-hours, nothing removed`,
      r.code !== 0 &&
        /--min-age-hours/.test(r.err) &&
        r.out === "" &&
        ex(A.old),
      r.all,
    );
  }
  const aList = run(AREPO, "dev");
  const aListAge = run(AREPO, "dev", "--min-age-hours", "24");
  check(
    "list mode with --min-age-hours prints the same list as without it and exits 0",
    aList.code === 0 && aListAge.code === 0 && aListAge.out === aList.out,
    `${aList.all}\n--\n${aListAge.all}`,
  );

  // --prefix c/ and --min-age-hours together: both apply
  const both = run(
    AREPO,
    "dev",
    "--remove",
    "--prefix",
    "c/",
    "--min-age-hours",
    "24",
  );
  const br = parse(both.out);
  check(
    "with --prefix c/ and --min-age-hours 24: the old merged-clean one under c/ is removed with its branch",
    both.code === 0 &&
      !ex(A.bothOld) &&
      !aBranches().includes("c/s1") &&
      lineFor(br, A.bothOld)?.[4] === "removed",
    `${aBranches()}\n${both.all}`,
  );
  check(
    "with --prefix c/ and --min-age-hours 24: a young merged-clean one under c/ stays, and an old one under d/ stays",
    ex(A.bothYoung) &&
      aBranches().includes("c/s2") &&
      lineFor(br, A.bothYoung)?.length === 4 &&
      ex(A.bothOther) &&
      aBranches().includes("d/s1") &&
      lineFor(br, A.bothOther)?.length === 4 &&
      ex(A.old) &&
      aBranches().includes("a/s1"),
    `${aBranches()}\n${both.all}`,
  );

  // --min-age-hours 24 alone: every job's old merged-clean worktrees go, nothing else
  const sweep = run(AREPO, "dev", "--remove", "--min-age-hours", "24");
  const sr = parse(sweep.out);
  check(
    "--remove --min-age-hours exits 0 when dirty, unmerged and young worktrees remain",
    sweep.code === 0,
    sweep.all,
  );
  check(
    "--min-age-hours 24 without --prefix: the old merged-clean worktree is removed, its branch deleted, its line marked removed",
    !ex(A.old) &&
      !aBranches().includes("a/s1") &&
      !aListed().some((p) => samePath(p, A.old)) &&
      lineFor(sr, A.old)?.[0] === "merged-clean" &&
      lineFor(sr, A.old)?.[4] === "removed",
    `${aBranches()}\n${sweep.all}`,
  );
  check(
    "--min-age-hours 24: an old merged-clean one on another job's branch (d/) goes too",
    !ex(A.bothOther) &&
      !aBranches().includes("d/s1") &&
      lineFor(sr, A.bothOther)?.[4] === "removed",
    `${aBranches()}\n${sweep.all}`,
  );
  check(
    "--min-age-hours 24: a missing worktree with an old merged commit is forgotten, its branch deleted, marked removed",
    lineFor(sr, A.missing)?.[0] === "missing" &&
      lineFor(sr, A.missing)?.[4] === "removed" &&
      !aListed().some((p) => samePath(p, A.missing)) &&
      !aBranches().includes("a/s7"),
    `${aListed()}\n${aBranches()}\n${sweep.all}`,
  );
  const kept = [
    [
      A.fresh,
      "merged-clean",
      "b/s1",
      "a slice worktree made just now (old commit, new folder)",
    ],
    [
      A.youngCommit,
      "merged-clean",
      "a/s2",
      "a merged-clean one with a new commit and an old folder",
    ],
    [
      A.youngGitFile,
      "merged-clean",
      "a/s3",
      "a merged-clean one with an old folder but a new .git file",
    ],
    [
      A.bothYoung,
      "merged-clean",
      "c/s2",
      "a merged-clean one with a new commit under c/",
    ],
    [A.dirty, "dirty", "a/s4", "an old dirty one"],
    [A.unmerged, "unmerged", "a/s5", "an old unmerged one"],
    [A.locked, "locked", "a/s6", "an old locked one"],
    [A.base, "base", "dev", "the base worktree"],
    [
      A.noGitFile,
      "merged-clean",
      "e/s1",
      "an old merged-clean one whose .git file is gone (its age cannot be read)",
    ],
  ];
  for (const [dir, state, branch, what] of kept) {
    const r = lineFor(sr, dir) || [];
    check(
      `--min-age-hours 24 keeps ${what}: on disk, branch ${branch} kept, listed as ${state} with four fields`,
      ex(dir) &&
        aBranches().includes(branch) &&
        aListed().some((p) => samePath(p, dir)) &&
        r[0] === state &&
        r[2] === branch &&
        r.length === 4 &&
        /^[0-9a-f]{7,} \S/.test(r[3]),
      `${r.join(" | ")}\n${sweep.all}`,
    );
  }
  check(
    "--min-age-hours: the dirty worktree keeps its untracked file",
    ex(path.join(A.dirty, "notes.txt")),
  );
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
