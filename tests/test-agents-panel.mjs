// Builds the Agents Panel extension and runs its checks (script loads, both style fixes there, Russian labels).
// Run: node tests/test-agents-panel.mjs
import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

const cwd = fileURLToPath(new URL("../extensions/agents-panel/", import.meta.url));
const r = spawnSync(process.execPath, ["test.mjs"], { cwd, encoding: "utf8" });
const failed = r.status !== 0;
console.log(`${failed ? "FAIL" : "PASS"} agents-panel/test.mjs: ${(failed ? (r.stderr || r.stdout).trim().slice(-600) : r.stdout.trim().split("\n").pop())}`);
// The build is not kept: people build it themselves
rmSync(new URL("../extensions/agents-panel/dist/", import.meta.url), { recursive: true, force: true });
console.log(failed ? "1 failed" : "all passed");
process.exit(failed ? 1 : 0);
