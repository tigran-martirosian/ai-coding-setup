// Tests for hooks/skill-pointer.mjs. Run: node tests/test-skill-pointer.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(new URL("../hooks/skill-pointer.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "skill-pointer-test-"));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`); };

const proj = path.join(tmp, "proj").replace(/\\/g, "/");
const put = (rel, text) => { fs.mkdirSync(path.dirname(`${proj}/${rel}`), { recursive: true }); fs.writeFileSync(`${proj}/${rel}`, text); };
put("CLAUDE.md", "# Proj\n- A deploy or hotfix → `.claude/skills/deploy-it`.\n- Tools: `lonely.py`, lonely word.\n");
put(".claude/skills/deploy-it/SKILL.md", "x");
put(".claude/skills/lonely/SKILL.md", "x");
put("src/a.js", "x");

const run = (file, env = {}, raw) => spawnSync("node", [HOOK], {
  input: raw ?? JSON.stringify({ hook_event_name: "PostToolUse", tool_name: "Write", tool_input: { file_path: file } }),
  encoding: "utf8", env: { ...process.env, SKILL_POINTER: "", ...env },
});
const ctx = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ""; } };

let r = run(`${proj}/.claude/skills/deploy-it/SKILL.md`);
check("skill named in CLAUDE.md: silent", r.stdout === "" && r.status === 0, r.stdout + r.stderr);

r = run(`${proj}/.claude/skills/lonely/SKILL.md`);
check("skill not named: the line", ctx(r) === `[skill-pointer] Skill \`lonely\` is named nowhere in ${proj}/CLAUDE.md; add one line there saying when to call it (the ask in the user's words), or it will rarely run.`, r.stdout + r.stderr);
check("the output is a PostToolUse context", JSON.parse(r.stdout).hookSpecificOutput.hookEventName === "PostToolUse");

check("non-skill path: silent", run(`${proj}/src/a.js`).stdout === "");
check("a file in a skill folder that is not SKILL.md: silent", run(`${proj}/.claude/skills/lonely/notes.md`).stdout === "");
check("SKILL_POINTER=off: silent", run(`${proj}/.claude/skills/lonely/SKILL.md`, { SKILL_POINTER: "off" }).stdout === "");
check("Windows backslash path works", ctx(run(`${proj}/.claude/skills/lonely/SKILL.md`.replace(/\//g, "\\"))).includes("`lonely`"));

fs.rmSync(`${proj}/CLAUDE.md`);
check("CLAUDE.md missing: the line", ctx(run(`${proj}/.claude/skills/deploy-it/SKILL.md`)).includes(`${proj}/CLAUDE.md`));

const home = os.homedir().replace(/\\/g, "/");
check("global skill: silent (its pointer lines go in the projects)", run(`${home}/.claude/skills/zz-no-such-skill-xyz/SKILL.md`).stdout === "");
check("bad hook input: silent", run("", {}, "not json").stdout === "");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
