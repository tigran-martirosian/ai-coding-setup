// node tests/test-run-all.mjs
// run-all.mjs --changed on a scratch git repo with a copy of the runner and three tiny test files: it runs the test
// files that changed or name a changed file, and the full suite when none match or the runner itself changed.
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
const runAll = (...a) => {
  const r = spawnSync(
    process.execPath,
    [path.join(tests, "run-all.mjs"), ...a],
    { encoding: "utf8" },
  );
  return { code: r.status, out: r.stdout + r.stderr, ran: ran(r.stdout) };
};

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
} finally {
  fs.rmSync(T, { recursive: true, force: true });
  // run-all keeps its last-run list in the temp folder, one file per tests folder
  const key = createHash("sha1")
    .update(`${tests}${path.sep}`.toLowerCase())
    .digest("hex")
    .slice(0, 10);
  fs.rmSync(path.join(os.tmpdir(), `run-all-last-${key}.json`), {
    force: true,
  });
}

console.log(
  failed ? `${failed} failed, ${passed} passed` : `all ${passed} passed`,
);
process.exit(failed ? 1 : 0);
