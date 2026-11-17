// Runs every test file in this folder. Run: node tests/run-all.mjs [--only a,b] [--failed] [--changed [ref]] [--verbose]
// Each file runs with an empty home folder, as on GitHub's runners: a test that leans on files installed in
// ~/.claude passes on a set-up computer and fails there, so it fails here too.
// Files run side by side, one fewer at once than the computer has cores (at least 2, at most 8): each test file
// starts hooks of its own, and timing checks in some tests fail when every core is busy (a GitHub Windows runner,
// 4 cores: 4 at once failed a 1-second check, 3 at once passed and took 344 s against 471 s at 2). The slowest files of the last run start first. A green file prints one line, a failed file its
// earlier failure lines and its last 20 lines. --only a,b runs only those files; --failed reruns the files that
// failed in the last run (the list is kept in the OS temp folder, one file per repo folder; a run of some files
// updates only their entries); --verbose runs one file at a time with its full output (GitHub CI reruns failed files so).
// --changed [ref] runs the test files git sees changed since ref (default HEAD: uncommitted and new files) and the
// test files whose text names a changed file (by its file name); the full suite when none match or this runner
// changed. For a session's end-of-work run; CI runs the full suite.
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
const unknown = args.filter(
  (a, i) =>
    !["--verbose", "--failed", "--only", "--changed"].includes(a) &&
    !(onlyAt >= 0 && i === onlyAt + 1) &&
    !(changedAt >= 0 && i === changedAt + 1 && a === changedRef),
);
const picks = [onlyAt >= 0, args.includes("--failed"), changedAt >= 0].filter(
  Boolean,
).length;
if (unknown.length || (onlyAt >= 0 && !args[onlyAt + 1]) || picks > 1) {
  console.error(
    `${unknown.length ? `unknown argument: ${unknown.join(" ")}` : picks > 1 ? "--only, --failed and --changed go one at a time" : "--only needs a list of files"}; valid flags: --only a,b  --failed  --changed [ref]  --verbose`,
  );
  console.error(
    "usage: node tests/run-all.mjs [--only a,b] [--failed] [--changed [ref]] [--verbose]",
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
const queue = verbose
  ? [...files]
  : [...files].sort((a, b) => (known[b] ?? 1e9) - (known[a] ?? 1e9)); // unknown files count as slow
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
// A run of some files (--only, --failed, --changed) updates only those files' entries in the failed list.
const partial = onlyAt >= 0 || args.includes("--failed") || changedPick;
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
process.exit(failed.length ? 1 : 0);
