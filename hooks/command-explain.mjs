#!/usr/bin/env node
// command-explain: a PreToolUse hook for Bash and PowerShell. Nimbalyst's permission popup shows
// only the raw command (the tool's description field is dropped), so a long command is unreadable
// to the user who has to allow it. Every command must therefore end with one comment line that says
// in plain words what it does. The note goes last, never first: Nimbalyst builds its "Always allow"
// rule from the command's first word, and a leading "#" would turn that into "allow everything".
// Inside Nimbalyst the popup shows only the word "PowerShell" for the PowerShell tool, so that tool
// is blocked when the Bash tool can be used instead (COMMAND_EXPLAIN_BASH=yes|no overrides the check
// for Git Bash) (2026-10-01).
// The popup draws the note in the same font and colour as the command, so it read as more code.
// It therefore has to follow an empty line and start with "# WHAT THIS DOES:" (2026-10-01).
// There is no limit on a command's length: the limit of 7 popup lines (2026-10-01) was taken out on
// 2026-10-12, after it made 295 of the hook's 335 refusals in 8 days.
// The hook only blocks; it never changes a command. Added 2026-09-30.
// It fails open, so any error or odd input lets the call through. COMMAND_EXPLAIN=off disables it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const deny = (reason) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `command-explain: ${reason}` },
}));

function hasBashTool() {
  const forced = (process.env.COMMAND_EXPLAIN_BASH || "").toLowerCase();
  if (forced === "yes" || forced === "no") return forced === "yes";
  if (process.platform !== "win32") return true;
  const roots = [process.env.ProgramFiles, process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs")];
  const paths = roots.filter(Boolean).map((root) => join(root, "Git", "bin", "bash.exe"));
  return [process.env.CLAUDE_CODE_GIT_BASH_PATH, ...paths].filter(Boolean).some((p) => existsSync(p));
}

try {
  if ((process.env.COMMAND_EXPLAIN || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!["Bash", "PowerShell"].includes(event.tool_name)) process.exit(0);
  const command = (event.tool_input || {}).command;
  if (typeof command !== "string" || !command.trim()) process.exit(0);
  // A hook gets no variable that names Nimbalyst (CLAUDE_CODE_EXECPATH reaches the Bash tool, not
  // hooks). CLAUDE_CODE_ENTRYPOINT is "sdk-..." when an app runs Claude and "cli" in the terminal.
  const inNimbalyst = /^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "");

  if (event.tool_name === "PowerShell" && inNimbalyst && hasBashTool()) {
    deny(
      `don't use the PowerShell tool here. Nimbalyst's permission popup shows only the word "PowerShell" for it, so the user can't see what they are allowing. ` +
      `Run it with the Bash tool instead, ending with the "# " explanation line. For something only PowerShell can do, call it from Bash ` +
      `(powershell -NoProfile -Command '...'), or write a .ps1 file and run it with powershell -NoProfile -File.`,
    );
    process.exit(0);
  }

  const lines = command.trim().split(/\r?\n/);
  const last = lines[lines.length - 1].trim();
  const note = (last.match(/^#\s*WHAT THIS DOES:\s*(.*)$/) || [])[1] || "";
  const words = note.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const afterBlank = lines.length > 1 && lines[lines.length - 2].trim() === "";
  if (words.length < 3 || !afterBlank) {
    deny(
      `this command has no explanation line in the required form. The user sees only the raw command in the permission popup and can't read shell. ` +
      `End the command with an empty line and then one last line that starts with "# WHAT THIS DOES: " and says in plain words what the command does ` +
      `and what it changes (files written or deleted, programs installed, anything sent out), then run it again. Never put it at the start. ` +
      `Example:\nnpm install && npm test\n\n# WHAT THIS DOES: Installs the project's packages, then runs its tests. Changes only node_modules.`,
    );
    process.exit(0);
  }
} catch {
  process.exit(0);
}
