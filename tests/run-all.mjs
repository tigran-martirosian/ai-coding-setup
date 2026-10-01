// Runs every test file in this folder. Run: node tests/run-all.mjs
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
let failed = 0;
for (const name of readdirSync(dir).filter((n) => /^test-.*\.mjs$/.test(n)).sort()) {
  console.log(`\n== ${name}`);
  if (spawnSync(process.execPath, [join(dir, name)], { stdio: "inherit" }).status !== 0) failed++;
}
console.log(failed ? `\n${failed} test file(s) failed` : "\nall test files passed");
process.exit(failed ? 1 : 0);
