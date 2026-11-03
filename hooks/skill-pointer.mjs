// skill-pointer (PostToolUse on Write|Edit): a skill with no pointer line in CLAUDE.md is rarely called.
// When a SKILL.md is written, checks that the matching CLAUDE.md names the skill; if not, tells the model
// to add one line saying when to call it. Never blocks. Off: SKILL_POINTER=off
import fs from "node:fs";
import os from "node:os";

if (process.env.SKILL_POINTER === "off") process.exit(0);

let input;
try { input = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(0); }
const file = String(input?.tool_input?.file_path ?? "").replace(/\\/g, "/");
const m = file.match(/^(.*)\/\.claude\/skills\/([^/]+)\/SKILL\.md$/i);
if (!m) process.exit(0);

// A global skill's pointer lines go in the projects that use it (the global CLAUDE.md has a size cap).
const home = os.homedir().replace(/\\/g, "/");
if (m[1].toLowerCase() === home.toLowerCase()) process.exit(0);
const name = m[2];
const claudeMd = `${m[1]}/CLAUDE.md`;

let text = "";
try { text = fs.readFileSync(claudeMd, "utf8"); } catch (e) { if (e.code !== "ENOENT") throw e; }
// A pointer names the skill as `skills/<name>`, `/<name>` or `<name>`; a bare word (deploy in deploy.py) is not one.
const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
if (new RegExp(`(?:skills/|/|\`)${esc}(?![\\w.-])`).test(text)) process.exit(0);

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PostToolUse",
    additionalContext: `[skill-pointer] Skill \`${name}\` is named nowhere in ${claudeMd}; add one line there saying when to call it (the ask in the user's words), or it will rarely run.`,
  },
}));
