// Builds the Ink themes extension and runs its checks (colours readable, styles scoped to the themes).
// Run: node tests/test-ink-themes.mjs
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../extensions/ink-themes/", import.meta.url));
let failed = false;
for (const file of ["build.mjs", "test.mjs"]) {
  const r = spawnSync(process.execPath, [file], { cwd, encoding: "utf8" });
  if (r.status !== 0) {
    console.log(`FAIL ink-themes/${file}: ${(r.stderr || r.stdout).trim().slice(-600)}`);
    failed = true;
    break;
  }
  console.log(`PASS ink-themes/${file}: ${r.stdout.trim().split("\n").pop()}`);
}
// The build is not kept: people build it themselves, and it holds the fonts as one long line of text
rmSync(new URL("../extensions/ink-themes/dist/", import.meta.url), { recursive: true, force: true });
console.log(failed ? "1 failed" : "all passed");
process.exit(failed ? 1 : 0);
