#!/usr/bin/env node
// command-explain: a PreToolUse hook for Bash and PowerShell. Nimbalyst's permission popup shows
// only the raw command (the tool's description field is dropped), so a long command is unreadable
// to the user who has to allow it. Every command must therefore end with one comment line that says
// in plain words what it does. The note goes last, never first: Nimbalyst builds its "Always allow"
// rule from the command's first word, and a leading "#" would turn that into "allow everything".
// Inside Nimbalyst two more things would hide the note, so they are blocked as well (2026-10-01):
// - the popup's command box shows about 7 lines of about 120 characters and then scrolls (read off
//   a screenshot), so a longer Bash command pushes its last line out of sight
//   (COMMAND_EXPLAIN_LINES and COMMAND_EXPLAIN_WIDTH change the estimate);
// - for the PowerShell tool the popup shows only the word "PowerShell", so that tool is blocked when
//   the Bash tool can be used instead (COMMAND_EXPLAIN_BASH=yes|no overrides the check for Git Bash).
// The popup draws the note in the same font and colour as the command, so it read as more code.
// It therefore has to follow an empty line and start with "# WHAT THIS DOES:" (2026-10-01).
// The hook only blocks; it never changes a command. Added 2026-09-30.
// It fails open, so any error or odd input lets the call through. COMMAND_EXPLAIN=off disables it.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const MAX_LINES = Number(process.env.COMMAND_EXPLAIN_LINES) || 7;
const WIDTH = Number(process.env.COMMAND_EXPLAIN_WIDTH) || 120;

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

  if (event.tool_name === "Bash" && inNimbalyst) {
    const shown = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / WIDTH)), 0);
    if (shown > MAX_LINES) {
      deny(
        `this command is too long: it takes about ${shown} lines in the permission popup, which shows about ${MAX_LINES} before it scrolls, ` +
        `so the explanation on the last line would be hidden. The empty line and the note take 2 of the ${MAX_LINES}, so the command itself gets ${MAX_LINES - 2} ` +
        `(a line over ${WIDTH} characters counts as more than one). Do it in two steps: 1. save the script or the long text to a file with the Write tool; ` +
        `2. run that file with one short command, then the empty line and the "# WHAT THIS DOES: " line. Don't trim the command line by line and try again. ` +
        `Next time decide before the first try: a heredoc, a script with its own line breaks, or a python -c / node -e that spans more than one line goes into a file first. ` +
        `Example: Write tool: save the script as ~/.claude/tmp/job.mjs. Then Bash, two lines and the note:\nnode ~/.claude/tmp/job.mjs\n\n# WHAT THIS DOES: Runs the saved script that does X; changes only Y.`,
      );
    }
  }
} catch {
  process.exit(0);
}
