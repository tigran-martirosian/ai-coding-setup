#!/usr/bin/env node
// command-explain: a PreToolUse hook for Bash and PowerShell. Nimbalyst's permission popup shows
// only the raw command (the tool's description field is dropped), so a long command is unreadable
// to the user who has to allow it. Every command must therefore end with one comment line that says
// in plain words what it does. The note goes last, never first: Nimbalyst builds its "Always allow"
// rule from the command's first word, and a leading "#" would turn that into "allow everything".
// Inside Nimbalyst the popup shows only the word "PowerShell" for the PowerShell tool, so the installer
// turns that tool off where Git Bash exists (CLAUDE_CODE_USE_POWERSHELL_TOOL=0 in settings.json, see
// scripts/claude-code-settings.mjs) instead of this hook refusing it. A PowerShell call that still
// comes gets the same note check as Bash.
// The popup draws the note in the same font and colour as the command, so it read as more code.
// It therefore has to follow an empty line and start with "# WHAT THIS DOES:".
// There is no limit on a command's length. A command without the note is not refused:
// the hook appends a stand-in note, "(no note given)" plus the command's start, through updatedInput.
// No permissionDecision goes with it, so the normal permission prompt still decides; "allow" would
// skip the prompt. A line of additionalContext tells Claude to write the note itself next time.
// A helper gets the stand-in without that line: its own rules already ask for the note.
// It fails open, so any error or odd input lets the call through. COMMAND_EXPLAIN=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { COMMAND_EXPLAIN, NOTE_LINE_RE, NO_NOTE, WHAT_THIS_DOES } from "./lib/texts.mjs";

runHook("command-explain", (event) => {
  if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
  const command = (event.tool_input || {}).command;
  if (typeof command !== "string" || !command.trim()) return;

  const lines = command.trim().split(/\r?\n/);
  const last = lines[lines.length - 1].trim();
  const note = (last.match(NOTE_LINE_RE) || [])[1] || "";
  const words = note.split(/\s+/).filter((w) => /\p{L}/u.test(w));
  const afterBlank = lines.length > 1 && lines[lines.length - 2].trim() === "";
  if (words.length < 3 || !afterBlank) {
    const start = command.replace(/\s+/g, " ").trim().slice(0, 60);
    const output = {
      hookEventName: "PreToolUse",
      updatedInput: { ...event.tool_input, command: `${command.trimEnd()}\n\n${WHAT_THIS_DOES} ${NO_NOTE} ${start}` },
    };
    if (!event.agent_id) output.additionalContext = `${COMMAND_EXPLAIN} that command had no "${WHAT_THIS_DOES}" last line, so a stand-in was added and the user's permission popup explained nothing. Write the line yourself on every command.`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: output }));
    return;
  }
  // Soft check: the note is a row title in Nimbalyst's agents panel, so it should start
  // with a capital and stay under 70 characters. Never refuses; the stand-in note is exempt.
  if (!event.agent_id && !note.startsWith(NO_NOTE) && (/^\p{Ll}/u.test(note) || note.length >= 70)) {
    emit.context("PreToolUse", `${COMMAND_EXPLAIN} the "${WHAT_THIS_DOES}" text is a row title in the agents panel, so next time start it with a capital letter and keep it under 70 characters.`);
  }
});
