// Runs the unit tests of the two editor extensions that need no build and no editor.
// Run: node tests/test-extensions.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const TESTS = [
  ["usage-plan", "test/format.test.ts"],
  ["read-aloud", "test/cleanText.test.ts"],
];
let failed = 0;
for (const [ext, file] of TESTS) {
  const cwd = fileURLToPath(new URL(`../extensions/${ext}/`, import.meta.url));
  const r = spawnSync(process.execPath, ["--experimental-strip-types", "--no-warnings", file], { cwd, encoding: "utf8" });
  const last = r.stdout.trim().split("\n").pop();
  const ok = r.status === 0;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${ext}/${file}: ${ok ? last : (r.stderr || r.stdout).trim().slice(-400)}`);
}
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
