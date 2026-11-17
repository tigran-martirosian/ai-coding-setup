// Runs every test file in this folder. Run: node tests/run-all.mjs [--only a,b] [--failed] [--changed [ref]]
// [--shard i/n] [--save-timings] [--verbose]
// Each file runs with an empty home folder, as on GitHub's runners: a test that leans on files installed in
// ~/.claude passes on a set-up computer and fails there, so it fails here too.
// Files run side by side, one fewer at once than the computer has cores (at least 2, at most 8): each test file
// starts hooks of its own, and timing checks in some tests fail when every core is busy (a GitHub Windows runner,
// 4 cores: 4 at once failed a 1-second check, 3 at once passed and took 344 s against 471 s at 2). The slowest
// files of the last run start first (in a --shard run, a file the last run did not time goes by the timings file,
// so a fresh CI runner starts its slow files first too). A green file prints one line, a failed file its earlier
// failure lines and its last 20 lines. --only a,b runs only those files; --failed reruns the files that failed in the last run (the list
// is kept in the OS temp folder, one file per repo folder; a run of some files updates only their entries);
// --verbose runs one file at a time with its full output (GitHub CI reruns failed files so).
// --changed [ref] runs the test files git sees changed since ref (default HEAD: uncommitted and new files) and the
// test files whose text names a changed file (by its file name); the full suite when none match or this runner
// changed. For a session's end-of-work run; CI runs the full suite.
// --shard i/n runs part i of n of the full suite; CI runs each part as its own job, so every file runs once per
// system. The split reads this system's times in run-all-timings.json: the files that need ffmpeg (NEEDS_FFMPEG)
// go to part 1 with the time of installing ffmpeg, then the rest, slowest first, each to the part with the fewest
// seconds so far. A file with no recorded time counts as the median. The same file list and timings file give the
// same split on any computer (the last run's times only set the order inside a part). Not with --only, --failed
// or --changed.
// --save-timings: after a full run in which every file passed, writes this system's times to run-all-timings.json
// (refresh it so when the split grows uneven: on Windows and on a Mac, then commit it). ffmpegInstall there is
// written by hand: the seconds of CI's ffmpeg install step on that system.
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const args = process.argv.slice(2);
const verbose = args.includes("--verbose");
const onlyAt = args.indexOf("--only");
const changedAt = args.indexOf("--changed");
const changedRef =
  changedAt >= 0 && args[changedAt + 1] && !args[changedAt + 1].startsWith("--")
    ? args[changedAt + 1]
    : changedAt >= 0
      ? "HEAD"
      : null;
const shardAt = args.indexOf("--shard");
const saveTimings = args.includes("--save-timings");
const unknown = args.filter(
  (a, i) =>
    ![
      "--verbose",
      "--failed",
      "--only",
      "--changed",
      "--shard",
      "--save-timings",
    ].includes(a) &&
    !(onlyAt >= 0 && i === onlyAt + 1) &&
    !(shardAt >= 0 && i === shardAt + 1) &&
    !(changedAt >= 0 && i === changedAt + 1 && a === changedRef),
);
const picks = [onlyAt >= 0, args.includes("--failed"), changedAt >= 0].filter(
  Boolean,
).length;
const shardMatch = /^(\d+)\/(\d+)$/.exec(
  shardAt >= 0 ? (args[shardAt + 1] ?? "") : "",
);
const shard = shardMatch && { i: +shardMatch[1], n: +shardMatch[2] };
const argError = unknown.length
  ? `unknown argument: ${unknown.join(" ")}`
  : picks > 1
    ? "--only, --failed and --changed go one at a time"
    : onlyAt >= 0 && !args[onlyAt + 1]
      ? "--only needs a list of files"
      : shardAt >= 0 && !(shard && shard.i >= 1 && shard.i <= shard.n)
        ? "--shard needs i/n with 1 <= i <= n, e.g. --shard 1/2"
        : shardAt >= 0 && picks
          ? "--shard runs its part of the full suite; it does not combine with --only, --failed or --changed"
          : saveTimings && (picks || shardAt >= 0)
            ? "--save-timings needs a full run: not with --only, --failed, --changed or --shard"
            : null;
if (argError) {
  console.error(
    `${argError}; valid flags: --only a,b  --failed  --changed [ref]  --shard i/n  --save-timings  --verbose`,
  );
  console.error(
    "usage: node tests/run-all.mjs [--only a,b] [--failed] [--changed [ref]] [--shard i/n] [--save-timings] [--verbose]",
  );
  process.exit(2);
}
const stateFile = join(
  tmpdir(),
  `run-all-last-${createHash("sha1").update(dir.toLowerCase()).digest("hex").slice(0, 10)}.json`,
);
const state = existsSync(stateFile)
  ? JSON.parse(readFileSync(stateFile, "utf8"))
  : null;

let files = readdirSync(dir)
  .filter((n) => /^test-.*\.mjs$/.test(n))
  .sort();
if (onlyAt >= 0) {
  const wanted = args[onlyAt + 1]
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const pick = (w) =>
    files.find(
      (n) =>
        n === w ||
        n === `${w}.mjs` ||
        n === `test-${w}.mjs` ||
        n === `test-${w}`,
    );
  const missing = wanted.filter((w) => !pick(w));
  if (missing.length) {
    console.error(`no test file named: ${missing.join(", ")}`);
    process.exit(2);
  }
  files = [...new Set(wanted.map(pick))];
}
if (args.includes("--failed")) {
  if (!state) {
    console.error(
      `no last run recorded (${stateFile}); run the tests once first`,
    );
    process.exit(2);
  }
  files = files.filter((n) => state.failed.includes(n));
  if (!files.length) {
    console.log("the last run had no failed test files");
    process.exit(0);
  }
}
let changedPick = false;
if (changedRef) {
  const git = (a) => {
    const r = spawnSync("git", ["-C", dir, ...a], { encoding: "utf8" });
    if (r.status !== 0)
      throw new Error(
        `--changed: git ${a.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`,
      );
    return r.stdout.split("\n").filter(Boolean);
  };
  const root = git(["rev-parse", "--show-toplevel"])[0];
  const changed = [
    ...git(["diff", "--name-only", changedRef, "--", root]),
    ...git(["ls-files", "--others", "--exclude-standard", "--full-name", root]),
  ];
  const names = [...new Set(changed.map((p) => p.split("/").pop()))];
  const picked = changed.includes("tests/run-all.mjs")
    ? []
    : files.filter((n) => {
        if (names.includes(n)) return true;
        const text = readFileSync(join(dir, n), "utf8");
        return names.some((c) => text.includes(c));
      });
  console.log(
    !changed.length
      ? `--changed: nothing changed since ${changedRef}; the full suite`
      : changed.includes("tests/run-all.mjs")
        ? "--changed: the runner itself changed; the full suite"
        : picked.length
          ? `--changed: ${changed.length} changed file(s) since ${changedRef}; ${picked.length} test file(s) cover them`
          : `--changed: no test file names the ${changed.length} changed file(s); the full suite`,
  );
  if (picked.length) {
    files = picked;
    changedPick = true;
  }
}

// The test files that draw with ffmpeg: CI installs ffmpeg in the job of shard 1 only.
const NEEDS_FFMPEG = ["test-picture-gate.mjs", "test-watch.mjs"];
const timingsFile = join(dir, "run-all-timings.json");

// This system's entry of run-all-timings.json: { atOnce, ffmpegInstall, secs: { file: seconds } }.
function readTimings() {
  const fail = (why) => {
    console.error(
      `--shard: ${why}; record the times with node tests/run-all.mjs --save-timings`,
    );
    process.exit(2);
  };
  if (!existsSync(timingsFile)) fail(`${timingsFile} does not exist`);
  const t = JSON.parse(readFileSync(timingsFile, "utf8"))[process.platform];
  if (!t) fail(`${timingsFile} has no times for ${process.platform}`);
  if (!Object.keys(t.secs ?? {}).length || !(t.atOnce >= 1))
    fail(`${timingsFile}: ${process.platform} has no file times or atOnce`);
  if (typeof t.ffmpegInstall !== "number") {
    console.error(
      `--shard: ${timingsFile}: ${process.platform} has no ffmpegInstall; write there the seconds of CI's ffmpeg install step on this system`,
    );
    process.exit(2);
  }
  return t;
}

// Splits `names` into n parts by recorded seconds. Part 1 holds the NEEDS_FFMPEG files and carries the ffmpeg
// install, which runs alone before the files: its seconds count atOnce times, as the files' seconds add up over
// atOnce files running side by side. Then the other files, slowest first (equal times by name), each go to the
// part with the fewest seconds so far (a tie to the lower part). Returns [{ files, load }].
function splitShards(names, t, n) {
  const all = Object.values(t.secs).sort((a, b) => a - b);
  const median =
    all.length % 2
      ? all[(all.length - 1) / 2]
      : (all[all.length / 2 - 1] + all[all.length / 2]) / 2;
  const secsOf = (f) => t.secs[f] ?? median;
  const parts = Array.from({ length: n }, () => ({ files: [], load: 0 }));
  parts[0].load = t.ffmpegInstall * t.atOnce;
  const rest = [];
  for (const f of names) {
    if (!NEEDS_FFMPEG.includes(f)) rest.push(f);
    else {
      parts[0].files.push(f);
      parts[0].load += secsOf(f);
    }
  }
  rest.sort((a, b) => secsOf(b) - secsOf(a) || (a < b ? -1 : 1));
  for (const f of rest) {
    const p = parts.reduce((min, q) => (q.load < min.load ? q : min));
    p.files.push(f);
    p.load += secsOf(f);
  }
  return parts;
}

let recorded = {}; // a --shard run's timings file times: the start order of files the last run did not time
if (shard) {
  const t = readTimings();
  recorded = t.secs;
  const parts = splitShards(files, t, shard.n);
  console.log(
    `--shard ${shard.i}/${shard.n}: ${parts[shard.i - 1].files.length} of ${files.length} files; recorded seconds per part (part 1 with the ffmpeg install): ${parts.map((p) => Math.round(p.load)).join(" / ")}`,
  );
  files = parts[shard.i - 1].files.sort();
}

function envFor(home) {
  const env = {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOOK_ERRORS_LOG: "off",
  }; // no test run leaves a line in a real crash log
  delete env.CLAUDE_PROJECT_DIR;
  return env;
}

// Runs one file; resolves to { ok, code, secs, out }. In verbose mode the output goes straight to the screen.
function runFile(name) {
  const home = mkdtempSync(join(tmpdir(), "run-all-home-"));
  const start = Date.now();
  const child = spawn(process.execPath, [join(dir, name)], {
    stdio: verbose ? "inherit" : ["ignore", "pipe", "pipe"],
    env: envFor(home),
  });
  const chunks = [];
  if (!verbose)
    for (const s of [child.stdout, child.stderr])
      s.on("data", (c) => chunks.push(c));
  return new Promise((resolve) =>
    child.on("close", (code, signal) => {
      rmSync(home, { recursive: true, force: true });
      resolve({
        ok: code === 0,
        code: code ?? signal,
        secs: (Date.now() - start) / 1000,
        out: Buffer.concat(chunks).toString("utf8"),
      });
    }),
  );
}

const known = state?.secs ?? {};
const order = { ...recorded, ...known };
const queue = verbose
  ? [...files]
  : [...files].sort((a, b) => (order[b] ?? 1e9) - (order[a] ?? 1e9)); // unknown files count as slow
const width = verbose
  ? 1
  : Math.min(files.length, 8, Math.max(2, availableParallelism() - 1));
const results = {};
const started = Date.now();
async function worker() {
  for (let name; (name = queue.shift()); ) {
    if (verbose) console.log(`\n== ${name}`);
    const r = (results[name] = await runFile(name));
    if (verbose) continue;
    if (r.ok) {
      console.log(`PASS ${name} (${r.secs.toFixed(1)}s)`);
      continue;
    }
    console.log(failReport(name, r));
  }
}

// A failed file's report: its failure lines from before the tail (a FAIL line printed early would be cut off),
// then its last 20 lines.
function failReport(name, r) {
  const lines = r.out.trimEnd().split(/\r?\n/);
  const tailAt = Math.max(0, lines.length - 20);
  const early = [
    ...new Set(
      lines
        .slice(0, tailAt)
        .filter((l) => /FAIL|✗|AssertionError|Error:/.test(l)),
    ),
  ].slice(0, 20);
  return [
    `FAIL ${name} (exit ${r.code}, ${r.secs.toFixed(1)}s)`,
    ...(early.length
      ? ["   failure lines before the tail:", ...early.map((l) => "     " + l)]
      : []),
    "   last 20 lines:",
    ...lines.slice(tailAt).map((l) => "     " + l),
  ].join("\n");
}
await Promise.all(Array.from({ length: width }, worker));

const failed = files.filter((n) => !results[n].ok);
const secs = { ...known };
for (const n of files) secs[n] = Math.round(results[n].secs * 10) / 10;
// A run of some files (--only, --failed, --changed, --shard) updates only those files' entries in the failed list.
const partial =
  onlyAt >= 0 || args.includes("--failed") || changedPick || shard;
const failedAll = partial
  ? [...(state?.failed ?? []).filter((n) => !files.includes(n)), ...failed]
  : failed;
writeFileSync(stateFile, JSON.stringify({ failed: failedAll, secs }, null, 1));
const took = `${Math.round((Date.now() - started) / 1000)}s, ${width} at once`;
console.log(
  failed.length
    ? `\n${failed.length} of ${files.length} test file(s) failed (${took}): ${failed.join(", ")}\nrerun only those: node tests/run-all.mjs --failed`
    : `\nall ${files.length} test files passed (${took})`,
);
if (saveTimings && failed.length)
  console.log("--save-timings: not saved, as not every file passed");
else if (saveTimings) {
  const all = existsSync(timingsFile)
    ? JSON.parse(readFileSync(timingsFile, "utf8"))
    : {};
  const ffmpegInstall = all[process.platform]?.ffmpegInstall ?? null;
  all[process.platform] = {
    atOnce: width,
    ffmpegInstall,
    secs: Object.fromEntries(files.map((n) => [n, secs[n]])),
  };
  writeFileSync(timingsFile, `${JSON.stringify(all, null, 2)}\n`);
  console.log(
    `--save-timings: ${files.length} files' times for ${process.platform} written to ${timingsFile}${ffmpegInstall === null ? "; write its ffmpegInstall by hand (CI's ffmpeg install step, in seconds) before --shard can use it" : ""}`,
  );
}
process.exit(failed.length ? 1 : 0);
