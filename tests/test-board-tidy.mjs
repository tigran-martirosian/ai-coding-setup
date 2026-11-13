// Builds the Board Tidy extension and runs its checks (the archive rules, the chooser on a scratch database, the build).
// Run: node tests/test-board-tidy.mjs
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(
  new URL("../extensions/board-tidy/", import.meta.url),
);
const r = spawnSync(process.execPath, ["test.mjs"], { cwd, encoding: "utf8" });
const failed = r.status !== 0;
console.log(
  `${failed ? "FAIL" : "PASS"} board-tidy/test.mjs: ${failed ? (r.stderr || r.stdout).trim().slice(-600) : r.stdout.trim().split("\n").pop()}`,
);
// The build is not kept: people build it themselves
rmSync(new URL("../extensions/board-tidy/dist/", import.meta.url), {
  recursive: true,
  force: true,
});
console.log(failed ? "1 failed" : "all passed");
process.exit(failed ? 1 : 0);
