// Runs the internet-search folder's own tests (the link gate, links.mjs, limits.mjs) on an installed copy:
// install.mjs puts the folder into a temporary home, then that copy's tools/test-finder.mjs is run.
// No network and no browser are used. Run: node tests/test-finder.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "finder-test-"));
const installed = spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", home, "--codex", "no", "--agy", "no"], { encoding: "utf8" });
if (installed.status !== 0) {
  console.log(`FAIL install into a temporary home: exit ${installed.status}\n${installed.stdout}${installed.stderr}`);
  process.exit(1);
}
const test = path.join(home, "Projects", "internet-search", "tools", "test-finder.mjs");
const run = spawnSync(process.execPath, [test], { stdio: "inherit" });
fs.rmSync(home, { recursive: true, force: true });
process.exit(run.status === 0 ? 0 : 1);
