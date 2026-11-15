// Builds the Job Tracker extension and runs its checks (one script, the counts and the reading, the folds).
// Run: node tests/test-job-tracker.mjs
import { spawnSync } from "node:child_process";
import { existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(
  new URL("../extensions/job-tracker/", import.meta.url),
);
const dist = new URL("../extensions/job-tracker/dist/", import.meta.url);
const hadDist = existsSync(dist);
const r = spawnSync(process.execPath, ["test.mjs"], { cwd, encoding: "utf8" });
const failed = r.status !== 0;
console.log(
  `${failed ? "FAIL" : "PASS"} job-tracker/test.mjs: ${failed ? (r.stderr || r.stdout).trim().slice(-600) : r.stdout.trim().split("\n").pop()}`,
);
// The build is not kept: people build it themselves. A dist/ that was there before stays.
if (!hadDist) rmSync(dist, { recursive: true, force: true });
console.log(failed ? "1 failed" : "all passed");
process.exit(failed ? 1 : 0);
