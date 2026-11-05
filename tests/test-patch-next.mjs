// test-patch-next: the SessionStart hook that shows docs/patches/next.md to every new session of a project.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/patch-next.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "patch-next-"));
const withList = path.join(tmp, "with");
const without = path.join(tmp, "without");
fs.mkdirSync(path.join(withList, "docs", "patches"), { recursive: true });
fs.mkdirSync(without);
fs.writeFileSync(path.join(withList, "docs", "patches", "next.md"),
	"# Next patch: 4.1.31\n\nIntro that stays out.\n\n## Items\n- XP cap removed — session 8cf44208 — tested\n");

let failed = 0;
function run(name, dir, check, extra = {}) {
	const r = spawnSync(process.execPath, [HOOK], {
		input: JSON.stringify({ hook_event_name: "SessionStart", cwd: dir, ...extra.event }),
		env: { ...process.env, CLAUDE_PROJECT_DIR: dir, ...extra.env },
		encoding: "utf8",
	});
	const ok = r.status === 0 && check(r.stdout);
	if (!ok) failed++;
	console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n  stdout: ${r.stdout}\n  stderr: ${r.stderr}`}`);
}
const ctx = (out) => { try { return JSON.parse(out).hookSpecificOutput.additionalContext; } catch { return null; } };

run("shows-items", withList, (o) => { const c = ctx(o); return c?.startsWith("[patch-next]") && c.includes("XP cap removed") && !c.includes("Intro that stays out"); });
fs.writeFileSync(path.join(withList, "docs", "patches", "next.md"), "## Items\n" + "- line\n".repeat(1000));
run("long-list-marked", withList, (o) => ctx(o)?.endsWith("[list cut here: read the whole file before shipping]"));
run("silent-without-list", without, (o) => o === "");
run("silent-for-subagent", withList, (o) => o === "", { event: { agent_id: "a1" } });
run("off-switch", withList, (o) => o === "", { env: { PATCH_NEXT: "off" } });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
