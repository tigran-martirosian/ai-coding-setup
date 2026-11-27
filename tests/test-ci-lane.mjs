// Tests scripts/ci-lane.mjs: which tests a pull request runs in CI. Run: node tests/test-ci-lane.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALWAYS, pickLane } from "../scripts/ci-lane.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let pass = 0;
let fail = 0;
const check = (ok, what) => {
  console.log(`${ok ? "ok  " : "FAIL"} ${what}`);
  ok ? pass++ : fail++;
};

const tests = {
  "test-install.mjs": "install.mjs",
  "test-update.mjs": "update.mjs",
  "test-update-check.mjs": "update-check",
  "test-docs-clean.mjs": "README.md",
  "test-update-project.mjs": "pass.mjs",
  "test-phone-relay.mjs": "phone/relay/relay.mjs worker.mjs",
  "test-read-aloud.mjs": "read-aloud/speak.mjs",
  "test-phone-pc.mjs": "pc/main.mjs",
  "test-watch.mjs": "watch.mjs",
};
const all = [
  "phone/relay/relay.mjs",
  "skills/read-aloud/speak.mjs",
  "skills/phone-bot/pc/main.mjs",
  "skills/other/main.mjs",
  "hooks/untested.mjs",
  "README.md",
];
const lane = (changed, over = {}) =>
  pickLane({
    event: "pull_request",
    changed,
    tests,
    all,
    versions: { base: "26.6.8", head: "26.6.9" },
    ...over,
  });

let r = lane(["README.md", "docs/img/banner.svg", "docs/guide.md"]);
check(r.lane === "docs", `pages and pictures only: docs lane (${r.lane})`);

r = lane(["README.md", "docs/promo/src/film/script.ts"]);
check(r.lane !== "docs", `the film's code is not a page (${r.lane})`);

r = lane(["phone/relay/relay.mjs", "CHANGELOG.md", "version.json"]);
check(
  r.lane === "small" && r.only.includes("test-phone-relay.mjs"),
  `a relay fix runs the relay test (${r.lane}: ${r.only})`,
);
check(
  r.lane === "small" && !r.only.includes("test-read-aloud.mjs"),
  "a relay fix does not run the Read Aloud test",
);
check(
  r.lane === "small" && ALWAYS.every((t) => r.only.includes(t)),
  "every small run has the update path tests",
);
check(
  r.lane === "small" && r.only.includes("test-docs-clean.mjs"),
  "the release notes bring the docs test",
);

r = lane(["skills/phone-bot/pc/main.mjs"]);
check(
  r.lane === "small" && r.only.includes("test-phone-pc.mjs"),
  `a file whose name is not unique is found by its folder too (${r.lane}: ${r.only})`,
);
r = lane(["skills/other/main.mjs"]);
check(
  r.lane === "full",
  `a main.mjs no test names by folder is a gap, so everything (${r.lane}: ${r.why})`,
);

r = lane(["hooks/untested.mjs", "phone/relay/relay.mjs"]);
check(
  r.lane === "full" && r.why.includes("hooks/untested.mjs"),
  `a code file no test names: everything (${r.why})`,
);

r = lane(["tests/run-all.mjs"]);
check(r.lane === "full", `the test runner changed: everything (${r.why})`);
r = lane([".github/workflows/tests.yml"]);
check(r.lane === "full", `the workflow changed: everything (${r.why})`);

r = lane(["phone/relay/relay.mjs"], {
  versions: { base: "26.6.9", head: "26.7" },
});
check(r.lane === "full", `a big release: everything (${r.why})`);

r = lane(["phone/relay/relay.mjs"], { event: "schedule" });
check(r.lane === "full", `the nightly run: everything (${r.why})`);

r = lane(["tests/test-read-aloud.mjs"]);
check(
  r.lane === "small" && r.only.includes("test-read-aloud.mjs"),
  "a changed test file runs itself",
);

// The command line: a run with no changes against HEAD tests everything and writes the workflow's outputs.
const dir = mkdtempSync(join(tmpdir(), "ci-lane-"));
try {
  const out = join(dir, "out.txt");
  const c = spawnSync(
    process.execPath,
    [join(root, "scripts/ci-lane.mjs"), "HEAD", "--github-output", out],
    { encoding: "utf8" },
  );
  const text = c.status === 0 ? readFileSync(out, "utf8") : "";
  check(
    c.status === 0 &&
      /^lane=full$/m.test(text) &&
      /^parts=\[1,2\]$/m.test(text) &&
      /^ffmpeg=true$/m.test(text) &&
      /^browser=true$/m.test(text),
    `the command writes lane, parts and ffmpeg (${(c.stdout + c.stderr).trim()})`,
  );
  const bad = spawnSync(process.execPath, [join(root, "scripts/ci-lane.mjs")], {
    encoding: "utf8",
  });
  check(bad.status !== 0, "a pull request run without a base ref stops");
} finally {
  rmSync(dir, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
