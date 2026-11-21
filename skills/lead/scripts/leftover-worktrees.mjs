// leftover-worktrees: lists the linked worktrees of a repository with their state, and with --remove takes away
// the merged, clean ones of one job (--prefix), or of every job once they are old enough (--min-age-hours).
//
//   node leftover-worktrees.mjs <repo> <base-branch>                                   list only, changes nothing
//   node leftover-worktrees.mjs <repo> <base-branch> --remove --prefix <branch-prefix>  list and remove one job's
//   node leftover-worktrees.mjs <repo> <base-branch> --remove --min-age-hours <n>      list and remove old ones
//
// One stdout line per linked worktree (the main checkout is never listed), tab-separated:
//   state, worktree path, branch ("(detached)" when it has none), last commit line (short hash and subject)
// and a fifth field "removed" when --remove took it away. States, checked in this order:
//   locked    git worktree lock is on it; never touched
//   missing   its folder is gone; under the prefix and merged, git forgets it and its branch is deleted (no
//             files to lose); unmerged, it is left as it is
//   base      it has <base-branch> checked out; never touched
//   dirty     changed or untracked files (git-ignored files do not count)
//   merged-clean / unmerged
//             merged means merging its commit into <base-branch> would change nothing: `git merge-tree
//             --write-tree` gives the base's own tree. So a squash-merged branch counts as merged. A branch whose
//             merge would conflict (the base changed the same lines again after the squash) counts as unmerged.
// --remove takes only merged-clean (and merged missing) worktrees on a branch other than <base-branch>, and of those:
//   --prefix <p>          only the ones whose branch starts with <p>, which ends in "/"
//   --min-age-hours <n>   only the ones whose last commit (committer date) AND folder (the newer mtime of the folder
//                         and its .git file) are both older than n hours. A slice worktree made a minute ago sits on
//                         the base's commit, so it is merged-clean too; its new folder keeps it. A missing one has no
//                         folder: its last commit alone decides. This lets a nightly run sweep every job's leftovers.
// With --min-age-hours, a folder whose .git file is gone stays (its age is unknown). With both, both apply;
// --remove with neither is an error. A young one is listed as usual, not removed.
// Removing is `git worktree remove` without --force (git refuses a worktree with changes), then `git branch -D` (-d
// refuses a squash-merged branch). Git's path variables (GIT_DIR and the like) set by a caller are ignored, so
// <repo> is always the repository looked at.
// Exit 0 when the run did what was asked, also when dirty or unmerged worktrees remain. Exit 1 with a message on
// stderr for a bad argument, a folder that is not a git repository, a missing base branch, git older than 2.38,
// or a git call that failed for one worktree (the others are still listed and swept first). Needs Node and git.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const USAGE =
  "usage: node leftover-worktrees.mjs <repo> <base-branch> [--remove [--prefix <branch-prefix>] [--min-age-hours <n>]]";
const MIN_GIT = [2, 38]; // merge-tree --write-tree

function die(msg) {
  process.stderr.write(`leftover-worktrees: ${msg}\n`);
  process.exit(1);
}
// a caller's GIT_DIR (a git hook, a git alias) would point every call at another repository than <repo>
const PATH_VARS = [
  "GIT_DIR",
  "GIT_WORK_TREE",
  "GIT_INDEX_FILE",
  "GIT_OBJECT_DIRECTORY",
  "GIT_COMMON_DIR",
  "GIT_ALTERNATE_OBJECT_DIRECTORIES",
];
const cleanEnv = Object.fromEntries(
  Object.entries(process.env).filter(
    ([k]) => !PATH_VARS.includes(k.toUpperCase()),
  ),
);
function gitWith(env, cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8", env });
  if (r.error) die(`cannot run git: ${r.error.message}`);
  return { code: r.status, out: r.stdout, err: r.stderr.trim() };
}
const git = (cwd, ...args) => gitWith(cleanEnv, cwd, ...args);
// a git call that must work: its message, never a guessed answer
function gitOk(cwd, ...args) {
  const r = git(cwd, ...args);
  if (r.code !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.err}`);
  return r.out;
}

// ---- arguments
const positional = [];
let remove = false,
  prefix = null,
  minAgeHours = null;
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--remove") remove = true;
  else if (a === "--prefix") {
    prefix = argv[++i];
    if (!prefix || prefix.startsWith("--"))
      die(`--prefix needs a branch prefix. ${USAGE}`);
  } else if (a === "--min-age-hours") {
    const v = argv[++i];
    if (!/^\d+(\.\d+)?$/.test(v ?? "") || Number(v) <= 0)
      die(
        `--min-age-hours needs a number of hours above 0, not "${v ?? ""}". ${USAGE}`,
      );
    minAgeHours = Number(v);
  } else if (a.startsWith("--")) die(`unknown option ${a}. ${USAGE}`);
  else positional.push(a);
}
if (positional.length < 2) die(`missing argument. ${USAGE}`);
if (positional.length > 2)
  die(`too many arguments: ${positional.slice(2).join(" ")}. ${USAGE}`);
if (remove && prefix === null && minAgeHours === null)
  die(
    `--remove needs --prefix <branch-prefix> (only this job's worktrees) or --min-age-hours <n> (only old ones), so a worktree in use is never removed. ${USAGE}`,
  );
if (remove && prefix !== null && !prefix.endsWith("/"))
  die(
    `--prefix must end in "/" (${prefix}/, not ${prefix}), so it cannot take branches of another job whose name only starts the same. ${USAGE}`,
  );
if (!remove && prefix !== null)
  die(`--prefix only goes with --remove. ${USAGE}`);
const [repo, base] = positional;

// ---- git, repository and base branch
const version = spawnSync("git", ["--version"], {
  encoding: "utf8",
  env: cleanEnv,
});
if (version.error) die(`cannot run git: ${version.error.message}`);
const vm = /(\d+)\.(\d+)/.exec(version.stdout || "");
if (!vm) die(`cannot read the git version from "${version.stdout.trim()}"`);
const [major, minor] = [Number(vm[1]), Number(vm[2])];
if (major < MIN_GIT[0] || (major === MIN_GIT[0] && minor < MIN_GIT[1]))
  die(
    `git ${vm[1]}.${vm[2]} is older than ${MIN_GIT.join(".")}, which this script needs (merge-tree --write-tree)`,
  );
const top = git(repo, "rev-parse", "--git-dir");
if (top.code !== 0) die(`${repo} is not a git repository: ${top.err}`);
const baseRef = `refs/heads/${base}`;
if (git(repo, "rev-parse", "--verify", "--quiet", baseRef).code !== 0)
  die(`base branch "${base}" does not exist in ${repo}`);
let baseTree, objectsDir;
try {
  baseTree = gitOk(repo, "rev-parse", `${baseRef}^{tree}`).trim();
  objectsDir = gitOk(
    repo,
    "rev-parse",
    "--path-format=absolute",
    "--git-path",
    "objects",
  ).trim();
} catch (e) {
  die(e.message);
}
// merge-tree writes the trees it builds. They go to a scratch object folder that reads the repository's own
// objects as an alternate, so the merged test writes nothing into the repository, in list mode too.
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "leftover-worktrees-"));
process.on("exit", () => fs.rmSync(scratch, { recursive: true, force: true }));
const mergeEnv = {
  ...cleanEnv,
  GIT_OBJECT_DIRECTORY: scratch,
  GIT_ALTERNATE_OBJECT_DIRECTORIES: objectsDir,
};

// ---- the linked worktrees, from git's own list (-z: a path may hold any character)
let listText;
try {
  listText = gitOk(repo, "worktree", "list", "--porcelain", "-z");
} catch (e) {
  die(e.message);
}
const records = [];
let cur = null;
for (const line of listText.split("\0")) {
  if (line === "") {
    if (cur) records.push(cur);
    cur = null;
    continue;
  }
  const sp = line.indexOf(" ");
  const key = sp === -1 ? line : line.slice(0, sp);
  const value = sp === -1 ? "" : line.slice(sp + 1);
  if (key === "worktree") cur = { path: value, head: null, branch: null };
  else if (!cur) die(`unexpected line in git worktree list: ${line}`);
  else if (key === "HEAD") cur.head = value;
  else if (key === "branch") cur.branch = value.replace(/^refs\/heads\//, "");
  else if (key === "locked") cur.locked = true;
  else if (key === "bare") cur.bare = true;
}
if (cur) records.push(cur);
const linked = records.slice(1).filter((w) => !w.bare); // the first one is the main checkout

function stateOf(w) {
  if (w.locked) return "locked";
  if (!fs.existsSync(w.path)) return "missing";
  if (w.branch === base) return "base";
  // --no-optional-locks: list mode does not even refresh the worktree's index
  const status = gitOk(
    w.path,
    "--no-optional-locks",
    "status",
    "--porcelain",
    "--untracked-files=all",
  );
  if (status.trim() !== "") return "dirty";
  return isMerged(w.head) ? "merged-clean" : "unmerged";
}
function isMerged(head) {
  const mt = gitWith(
    mergeEnv,
    repo,
    "merge-tree",
    "--write-tree",
    baseRef,
    head,
  );
  if (mt.code === 1) return false; // the merge would conflict
  if (mt.code !== 0)
    throw new Error(
      `git merge-tree --write-tree ${base} ${head} failed: ${mt.err}`,
    );
  return mt.out.split("\n")[0].trim() === baseTree;
}

// --min-age-hours: the last commit and the folder are both older than n hours
function isOld(w, commitSeconds) {
  if (!Number.isFinite(commitSeconds))
    throw new Error("git log gives no commit date");
  const limit = Date.now() - minAgeHours * 3600 * 1000;
  if (commitSeconds * 1000 >= limit) return false;
  if (!fs.existsSync(w.path)) return true; // missing: no folder, the commit decides
  // a folder without its .git file is not a worktree git can remove cleanly: its age is unknown, so it stays
  const gitFile = fs.statSync(path.join(w.path, ".git"), {
    throwIfNoEntry: false,
  });
  if (!gitFile) return false;
  return Math.max(fs.statSync(w.path).mtimeMs, gitFile.mtimeMs) < limit;
}

let failed = false;
for (const w of linked) {
  const branch = w.branch ?? "(detached)";
  const ours =
    remove &&
    w.branch !== null &&
    w.branch !== base &&
    (prefix === null || w.branch.startsWith(prefix));
  let state, last, take;
  try {
    if (!w.head) throw new Error("git lists no HEAD commit for it");
    state = stateOf(w);
    // a missing one has no files to lose: its branch alone decides
    take =
      ours &&
      (state === "merged-clean" || (state === "missing" && isMerged(w.head)));
    const log = gitOk(repo, "log", "-1", "--format=%ct %h %s", w.head).trim();
    const sp = log.indexOf(" ");
    last = log.slice(sp + 1).replace(/\t/g, " ");
    if (take && minAgeHours !== null) take = isOld(w, Number(log.slice(0, sp)));
  } catch (e) {
    process.stderr.write(`leftover-worktrees: ${w.path}: ${e.message}\n`);
    failed = true;
    continue;
  }
  const fields = [state, w.path, branch, last];
  if (take) {
    // never --force: git refuses a worktree with changed or untracked files
    const rm = git(repo, "worktree", "remove", w.path);
    if (rm.code !== 0) {
      process.stderr.write(
        `leftover-worktrees: git refused to remove ${w.path}: ${rm.err}\n`,
      );
      failed = true;
    } else {
      fields.push("removed");
      const del = git(repo, "branch", "-D", w.branch);
      if (del.code !== 0) {
        process.stderr.write(
          `leftover-worktrees: removed ${w.path} but could not delete branch ${w.branch}: ${del.err}\n`,
        );
        failed = true;
      }
    }
  }
  process.stdout.write(`${fields.join("\t")}\n`);
}
process.exit(failed ? 1 : 0);
