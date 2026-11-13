// Runs every test file in this folder. Run: node tests/run-all.mjs
// Each file runs with an empty home folder, as on GitHub's runners: a test that leans on files installed in
// ~/.claude passes on a set-up computer and fails there, so it fails here too.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = fileURLToPath(new URL(".", import.meta.url));
const failed = [];
for (const name of readdirSync(dir).filter((n) => /^test-.*\.mjs$/.test(n)).sort()) {
  console.log(`\n== ${name}`);
  const home = mkdtempSync(join(tmpdir(), "run-all-home-"));
  const env = { ...process.env, HOME: home, USERPROFILE: home };
  delete env.CLAUDE_PROJECT_DIR;
  if (spawnSync(process.execPath, [join(dir, name)], { stdio: "inherit", env }).status !== 0) failed.push(name);
  rmSync(home, { recursive: true, force: true });
}
console.log(failed.length ? `\n${failed.length} test file(s) failed: ${failed.join(", ")}` : "\nall test files passed");
process.exit(failed.length ? 1 : 0);
