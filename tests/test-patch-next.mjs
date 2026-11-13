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
	"# Next patch: 4.1.31\n\nIntro that stays out.\n\n## Items\n- XP cap removed — session 8cf44208 — tested\n"
	+ "- Old bench fix, shipped classes use SRG names. Status: deployed 4.1.30\n- Reforge refusal\n  (ReforgeBench.infuse). Status: not started.\n");

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

run("shows-open-lines-only", withList, (o) => { const c = ctx(o); return c?.startsWith("[patch-next]") && c.includes("3 line(s), 2 open") && c.includes("XP cap removed")
	&& c.includes("Reforge refusal (ReforgeBench.infuse)") && !c.includes("Old bench fix") && !c.includes("Intro that stays out") && c.includes("docs/patches/next.md"); });
fs.writeFileSync(path.join(withList, "docs", "patches", "next.md"), "## Items\n" + `- line ${"x".repeat(400)}\n`.repeat(1000));
run("long-list-capped", withList, (o) => { const c = ctx(o); return c?.includes("1000 line(s), 1000 open") && c.endsWith("- and 990 more") && c.length < 3000; });
fs.writeFileSync(path.join(withList, "docs", "patches", "next.md"), "## Items\n- a. Status: shipped 1.0\n");
run("all-closed-count-and-path-only", withList, (o) => { const c = ctx(o); return c?.includes("1 line(s), 0 open") && !c.includes("Open lines"); });
fs.writeFileSync(path.join(withList, "docs", "patches", "next.md"), "## Items\n- a. Status: tested, not deployed yet\n- b. Status: not done\n"
	+ "- c fixes the released build crash, session x, tested\n- [x] d, no status word\n- e. Status: undeployed\n- f. Status: done 1.2\n");
run("negated-or-no-status-stays-open", withList, (o) => { const c = ctx(o); return c?.includes("6 line(s), 4 open") && ["- a.", "- b.", "- c fixes", "- e."].every((s) => c.includes(s)) && !c.includes("[x] d") && !c.includes("- f."); });
run("silent-without-list", without, (o) => o === "");
run("silent-for-subagent", withList, (o) => o === "", { event: { agent_id: "a1" } });
run("off-switch", withList, (o) => o === "", { env: { PATCH_NEXT: "off" } });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(failed ? `\n${failed} failed` : "\nall passed");
process.exit(failed ? 1 : 0);
