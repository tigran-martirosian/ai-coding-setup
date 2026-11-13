// Tests for hooks/usage-dashboard-hook.mjs. The hook runs ~/.claude/skills/usage-report/usage-dashboard.mjs,
// so the test gives it a temp home with a stand-in script there (the real dashboard has its own test
// with the skill). Nothing here touches a real ~/.claude or opens a browser.
// Run: node tests/test-usage-dashboard-hook.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/usage-dashboard-hook.mjs", import.meta.url));
const home = fs.mkdtempSync(path.join(os.tmpdir(), "usage-hook-test-"));
const skillDir = path.join(home, ".claude", "skills", "usage-report");
fs.mkdirSync(skillDir, { recursive: true });
const marker = path.join(home, "ran.txt");
// Records its arguments, so the test can see the hook asked for a build without opening a browser
fs.writeFileSync(path.join(skillDir, "usage-dashboard.mjs"), `import fs from "node:fs"; fs.appendFileSync(${JSON.stringify(marker)}, process.argv.slice(2).join(" ") + "\\n");\n`);

const run = (prompt, h = home) => execFileSync(process.execPath, [HOOK], { input: JSON.stringify({ prompt }), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, HOME: h, USERPROFILE: h, USAGE_DASH_NO_OPEN: "1" } }).trim();
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };
const blocked = (out) => out && JSON.parse(out).decision === "block" && /opened/.test(JSON.parse(out).reason);
const builds = () => (fs.existsSync(marker) ? fs.readFileSync(marker, "utf8").trim().split("\n").length : 0);

check('"usage" opens the dashboard and stops the prompt', blocked(run("usage")));
check("the build was asked not to open a browser", fs.readFileSync(marker, "utf8").trim() === "--no-open");
check('"Usage dashboard" (any case, spaces around) does too', blocked(run("  Usage dashboard ")));
check("both prompts built it once each", builds() === 2);
check("a sentence that mentions usage passes through", run("show my usage for last week") === "");
check("the built-in /usage command is left alone", run("/usage") === "");
check("an empty prompt passes through", run("") === "");
check("none of those built anything", builds() === 2);

const empty = fs.mkdtempSync(path.join(os.tmpdir(), "usage-hook-empty-"));
const failed = run("usage", empty);
check("no dashboard script installed: still stops the prompt and says it could not be built", JSON.parse(failed).decision === "block" && /could not be built/.test(JSON.parse(failed).reason));

fs.rmSync(home, { recursive: true, force: true });
fs.rmSync(empty, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
