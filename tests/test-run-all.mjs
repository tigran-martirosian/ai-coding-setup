// node tests/test-run-all.mjs
// run-all.mjs --changed on a scratch git repo with a copy of the runner and three tiny test files: it runs the test
// files that changed or name a changed file, and the full suite when none match or the runner itself changed.
// run-all.mjs --shard i/n on a second scratch folder of tiny test files and a made-up timings file: the parts
// together run every file once, the split is the same on every run, the parts' recorded seconds are even, the
// ffmpeg files and the ffmpeg install are in part 1; --save-timings writes this system's times.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${String(detail).slice(0, 800)}`}`,
  );
}

const T = fs.mkdtempSync(path.join(os.tmpdir(), "run-all-test-"));
const tests = path.join(T, "tests");
const git = (...a) => {
  const r = spawnSync("git", ["-C", T, ...a], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
};
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(T, rel)), { recursive: true });
  fs.writeFileSync(path.join(T, rel), text);
};
// Each fake test prints its own name, so the output shows which ones ran.
const fake = (name, mentions = "") =>
  `// ${mentions}\nconsole.log("ran ${name}");\n`;
const runner = fs.readFileSync(
  path.join(import.meta.dirname, "run-all.mjs"),
  "utf8",
);
const ran = (out) =>
  [...out.matchAll(/^PASS (test-\S+\.mjs)/gm)].map((m) => m[1]).sort();
const runIn = (folder, ...a) => {
  const r = spawnSync(
    process.execPath,
    [path.join(folder, "run-all.mjs"), ...a],
    { encoding: "utf8" },
  );
  return { code: r.status, out: r.stdout + r.stderr, ran: ran(r.stdout) };
};
const runAll = (...a) => runIn(tests, ...a);
const shardTests = path.join(T, "shard", "tests");

try {
  write("tests/run-all.mjs", runner);
  write("tests/test-alpha.mjs", fake("alpha", "covers hooks/alpha.mjs"));
  write("tests/test-beta.mjs", fake("beta", "covers hooks/beta.mjs"));
  write("tests/test-gamma.mjs", fake("gamma"));
  write("hooks/alpha.mjs", "export default 1;\n");
  write("hooks/beta.mjs", "export default 2;\n");
  write("docs/notes.md", "nothing\n");
  git("init", "-q");
  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "base");

  let r = runAll("--changed");
  check(
    "nothing changed: the full suite runs",
    r.code === 0 &&
      r.ran.join() === "test-alpha.mjs,test-beta.mjs,test-gamma.mjs" &&
      /nothing changed since HEAD; the full suite/.test(r.out),
    r.out,
  );

  write("hooks/alpha.mjs", "export default 3;\n");
  r = runAll("--changed");
  check(
    "a changed source file: only the test that names it runs",
    r.code === 0 &&
      r.ran.join() === "test-alpha.mjs" &&
      /1 changed file\(s\) since HEAD; 1 test file\(s\) cover them/.test(r.out),
    r.out,
  );

  write("tests/test-delta.mjs", fake("delta"));
  r = runAll("--changed");
  check(
    "a new test file runs too",
    r.code === 0 && r.ran.join() === "test-alpha.mjs,test-delta.mjs",
    r.out,
  );

  git("add", "-A");
  git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "two");
  r = runAll("--changed", "HEAD~1");
  check(
    "--changed HEAD~1: changes already committed count from that ref",
    r.code === 0 && r.ran.join() === "test-alpha.mjs,test-delta.mjs",
    r.out,
  );

  write("docs/notes.md", "changed\n");
  r = runAll("--changed");
  check(
    "a changed file no test names: the full suite runs",
    r.code === 0 &&
      r.ran.length === 4 &&
      /no test file names the 1 changed file\(s\); the full suite/.test(r.out),
    r.out,
  );

  write("tests/run-all.mjs", `${runner}\n// edited\n`);
  write("hooks/beta.mjs", "export default 4;\n");
  r = runAll("--changed");
  check(
    "the runner itself changed: the full suite runs",
    r.code === 0 &&
      r.ran.length === 4 &&
      /the runner itself changed; the full suite/.test(r.out),
    r.out,
  );

  r = runAll("--changed", "--failed");
  check(
    "--changed with --failed: refused with exit 2",
    r.code === 2 && /go one at a time/.test(r.out),
    r.out,
  );
  r = runAll("--changed", "no-such-ref");
  check(
    "--changed with an unknown ref: git's error, no run",
    r.code !== 0 && /--changed: git diff/.test(r.out) && r.ran.length === 0,
    r.out,
  );

  // --shard. Recorded seconds per file; test-g has none, so it counts as the median (12.5). Run 2 at once, the
  // ffmpeg install's 10 s count as 20 in part 1. Split by name in two halves, part 1 would hold 120 of 147.5.
  const secs = {
    "test-watch.mjs": 4,
    "test-picture-gate.mjs": 6,
    "test-a.mjs": 30,
    "test-b.mjs": 25,
    "test-c.mjs": 20,
    "test-d.mjs": 15,
    "test-e.mjs": 10,
    "test-f.mjs": 5,
  };
  const names = [...Object.keys(secs), "test-g.mjs"].sort();
  const timingsAt = path.join(shardTests, "run-all-timings.json");
  const timings = (t) =>
    fs.writeFileSync(timingsAt, JSON.stringify({ [process.platform]: t }));
  fs.mkdirSync(shardTests, { recursive: true });
  fs.writeFileSync(path.join(shardTests, "run-all.mjs"), runner);
  for (const n of names) fs.writeFileSync(path.join(shardTests, n), fake(n));
  timings({ atOnce: 2, ffmpegInstall: 10, secs });
  const shardRun = (...a) => runIn(shardTests, ...a);
  const loadOf = (files, first) =>
    (first ? 20 : 0) + files.reduce((s, f) => s + (secs[f] ?? 12.5), 0);

  const one = shardRun("--shard", "1/2");
  const two = shardRun("--shard", "2/2");
  check(
    "--shard 1/2 and 2/2: every test file runs in exactly one part",
    one.code === 0 &&
      two.code === 0 &&
      one.ran.length + two.ran.length === names.length &&
      [...one.ran, ...two.ran].sort().join() === names.join(),
    `${one.out}\n${two.out}`,
  );
  const thirds = [1, 2, 3].map((i) => shardRun("--shard", `${i}/3`).ran);
  check(
    "--shard i/3: every test file runs in exactly one of three parts",
    thirds.flat().length === names.length &&
      thirds.flat().sort().join() === names.join(),
    thirds.map((t) => t.join()).join(" | "),
  );
  check(
    "--shard 1/n: the files that need ffmpeg run in part 1",
    ["test-picture-gate.mjs", "test-watch.mjs"].every(
      (f) => one.ran.includes(f) && thirds[0].includes(f),
    ),
    `1/2: ${one.ran.join()}; 1/3: ${thirds[0].join()}`,
  );
  const [l1, l2] = [loadOf(one.ran, true), loadOf(two.ran, false)];
  check(
    "--shard: the parts' recorded seconds (part 1 with the ffmpeg install) differ by at most the slowest file",
    Math.abs(l1 - l2) <= 30,
    `part 1: ${l1} s (${one.ran.join()}), part 2: ${l2} s (${two.ran.join()})`,
  );

  shardRun(); // a full run records new last-run times, which must not move a file to another part
  const again = shardRun("--shard", "1/2");
  timings({
    secs: Object.fromEntries(Object.entries(secs).reverse()),
    ffmpegInstall: 10,
    atOnce: 2,
  });
  const reordered = shardRun("--shard", "1/2");
  check(
    "--shard: the same file list and timings give the same split (not moved by the last run or the file's key order)",
    again.ran.join() === one.ran.join() &&
      reordered.ran.join() === one.ran.join(),
    `first: ${one.ran.join()}; after a full run: ${again.ran.join()}; keys reversed: ${reordered.ran.join()}`,
  );

  timings({ atOnce: 2, ffmpegInstall: 100, secs });
  r = shardRun("--shard", "1/2");
  check(
    "--shard: a long ffmpeg install counts in part 1, which then holds only the ffmpeg files",
    r.ran.join() === "test-picture-gate.mjs,test-watch.mjs",
    r.out,
  );

  for (const other of [["--only", "test-a"], ["--failed"], ["--changed"]]) {
    r = shardRun("--shard", "1/2", ...other);
    check(
      `--shard with ${other[0]}: refused with exit 2, nothing runs`,
      r.code === 2 && /does not combine/.test(r.out) && r.ran.length === 0,
      r.out,
    );
  }
  for (const bad of ["3/2", "0/2", "x"]) {
    r = shardRun("--shard", bad);
    check(
      `--shard ${bad}: refused with exit 2, nothing runs`,
      r.code === 2 && /--shard needs i\/n/.test(r.out) && r.ran.length === 0,
      r.out,
    );
  }
  fs.writeFileSync(timingsAt, JSON.stringify({ "no-such-os": {} }));
  r = shardRun("--shard", "1/2");
  check(
    "--shard with no times for this system: a clear error, nothing runs",
    r.code === 2 &&
      new RegExp(`has no times for ${process.platform}`).test(r.out) &&
      r.ran.length === 0,
    r.out,
  );

  timings({ atOnce: 2, ffmpegInstall: 10, secs: { "test-a.mjs": 99 } });
  r = shardRun("--save-timings");
  const saved = JSON.parse(fs.readFileSync(timingsAt, "utf8"))[
    process.platform
  ];
  check(
    "--save-timings after a full passing run: this system's times of every file, the ffmpeg install kept",
    r.code === 0 &&
      Object.keys(saved.secs).sort().join() === names.join() &&
      saved.secs["test-a.mjs"] < 99 &&
      saved.ffmpegInstall === 10 &&
      saved.atOnce >= 2,
    `${r.out}\n${JSON.stringify(saved)}`,
  );
  r = shardRun("--save-timings", "--shard", "1/2");
  check(
    "--save-timings with --shard: refused with exit 2 (it needs a full run)",
    r.code === 2 && /--save-timings needs a full run/.test(r.out),
    r.out,
  );
} finally {
  fs.rmSync(T, { recursive: true, force: true });
  // run-all keeps its last-run list in the temp folder, one file per tests folder
  for (const folder of [tests, shardTests]) {
    const key = createHash("sha1")
      .update(`${folder}${path.sep}`.toLowerCase())
      .digest("hex")
      .slice(0, 10);
    fs.rmSync(path.join(os.tmpdir(), `run-all-last-${key}.json`), {
      force: true,
    });
  }
}

console.log(
  failed ? `${failed} failed, ${passed} passed` : `all ${passed} passed`,
);
process.exit(failed ? 1 : 0);
