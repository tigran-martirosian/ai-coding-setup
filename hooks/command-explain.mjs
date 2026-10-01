#!/usr/bin/env node
// command-explain: a PreToolUse hook for Bash and PowerShell. Nimbalyst's permission popup shows
// only the raw command (the tool's description field is dropped), so a long command is unreadable
// to the user who has to allow it. Every command must therefore end with one comment line that says
// in plain words what it does. The note goes last, never first: Nimbalyst builds its "Always allow"
// rule from the command's first word, and a leading "#" would turn that into "allow everything".
// The hook only blocks; it never changes a command. Added 2026-09-30.
// It fails open, so any error or odd input lets the call through. COMMAND_EXPLAIN=off disables it.
import { readFileSync } from "node:fs";

try {
  if ((process.env.COMMAND_EXPLAIN || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!["Bash", "PowerShell"].includes(event.tool_name)) process.exit(0);
  const command = (event.tool_input || {}).command;
  if (typeof command !== "string" || !command.trim()) process.exit(0);
  const last = command.trim().split(/\r?\n/).pop().trim();
  const note = last.startsWith("#") && !last.startsWith("#!") ? last.replace(/^#+\s*/, "") : "";
  const words = note.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  if (words.length >= 3) process.exit(0);
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason:
        `command-explain: this command has no explanation line. The user sees only the raw command in the permission popup and can't read shell. ` +
        `Add one last line that starts with "# " and says in plain words what the command does and what it changes ` +
        `(files written or deleted, programs installed, anything sent out), then run it again. Keep it on its own line at the very end, never at the start. ` +
        `Example:\nnpm install && npm test\n# Installs the project's packages, then runs its tests. Changes only node_modules.`,
    },
  }));
} catch {
  process.exit(0);
}
