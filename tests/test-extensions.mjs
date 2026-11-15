// Runs the unit tests of the editor extensions that need no build and no editor.
// A test marked "packages" imports the extension's own packages (read-aloud bundles with esbuild): when its
// node_modules folder is missing (a fresh clone, a CI runner, a worktree) npm ci installs them from the lock first.
// Not in the list: usage-plan/test/command.test.ts runs a script of an installed setup in the real home folder
// (~/.claude/skills/setup-audit), which a clone or a CI runner does not have, so it runs on the PC only.
// Run: node tests/test-extensions.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const TESTS = [
  ["usage-plan", "test/format.test.ts"],
  ["usage-plan", "test/dashboard-data.test.ts"],
  ["read-aloud", "test.mjs", "packages"],
  ["commands", "test/commands.test.ts"],
  ["commands", "test/launcher.test.ts"],
  ["commands", "test/note.test.ts"],
  ["commands", "test/copy-row.test.ts", "packages"],
  ["systems-map", "test.mjs"],
  ["shared", "test.mjs"],
];
let failed = 0;
for (const [ext, file, needs] of TESTS) {
  const cwd = fileURLToPath(new URL(`../extensions/${ext}/`, import.meta.url));
  if (needs === "packages" && !fs.existsSync(path.join(cwd, "node_modules"))) {
    const ci = spawnSync("npm ci --no-audit --no-fund", {
      cwd,
      encoding: "utf8",
      shell: true,
      timeout: 600000,
    });
    if (ci.status !== 0) {
      failed++;
      console.log(
        `FAIL ${ext}/${file}: npm ci failed: ${(`${ci.stderr || ""}${ci.stdout || ""}`.trim() || String(ci.error || "no output")).slice(-400)}`,
      );
      continue;
    }
  }
  const r = spawnSync(
    process.execPath,
    ["--experimental-strip-types", "--no-warnings", file],
    { cwd, encoding: "utf8" },
  );
  const last = r.stdout.trim().split("\n").pop();
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${ext}/${file}: ${ok ? last : (r.stderr || r.stdout).trim().slice(-400)}`,
  );
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
