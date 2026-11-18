---
name: verify
description: Start {{APP}} and use it the way a person does to prove a code change works, with proof a program can check. Use after the last code edit and before every commit that changes code, and when asked to verify, smoke test or try the app.
---

# Verify {{APP}}

For a Godot game. Run after the last code edit, before the commit. Everything runs headless (no window and no
sound), in the background, with its output in `{{TMP}}` (a temp folder, not the project). Steps that repeat
live in `.claude/skills/verify/verify.gd`: write it on the first run, keep it, and fix it when the game
changes, so later runs take one command.
Needs: `godot` on the path. If it is missing, stop and tell the user.

## 1. Start
On a fresh checkout, import once: `godot --headless --path . --editor --quit`. Then one command does steps 1
to 3: `godot --headless --path . --script res://.claude/skills/verify/verify.gd`.
Ready when: the first line the script prints is `VERIFY started` and no `ERROR` line comes before it. Ready
means the scene is loaded and takes input, not just a process that answers.

## 2. Use it
Walk the path a player takes through what the change touches, then one path next to it that must still work.
Reach nodes by name or path, never by screen position.
`verify.gd` extends `SceneTree`. It loads `{{MAIN_SCENE}}`, sends input as a player would
(`Input.action_press("{{ACTION}}")`, then release), waits a set number of frames, reads node state and ends
with `quit(code)`.

## 3. Proof
Print one line per check: `PROOF <what>: expected <x>, got <y>`; exit non-zero when one differs.
Check the node state the change touches (a label's text, a position, a score, a scene name), the count of
`ERROR` and `SCRIPT ERROR` lines in the output (expected 0), and the exit code.
Check side effects (files written, saves made) as well as what is shown. Use the real path, not a test-only
shortcut.

## 4. Clean up
The script quits itself. If it hangs, stop the process this run started, never by process name. Keep the
proof files in `{{TMP}}`.

## 5. Report
    Verify: <the change, one line>
    Ran: <the commands>
    <the PROOF lines as printed>
    Result: pass | fail (<the failing line>)
On a fail, fix the code, not the proof, and run `verify.gd` again. After three failed rounds stop and show the
user the output. Never weaken a proof or a path to make it pass.
