---
name: verify
description: Start {{APP}} and use it the way a person does to prove a code change works, with proof a program can check. Use after the last code edit and before every commit that changes code, and when asked to verify, smoke test or try the app.
---

# Verify {{APP}}

For a command-line or Node tool. Run after the last code edit, before the commit. Everything runs
headless and muted, in the background, with its output in `{{TMP}}` (a temp folder, not the project). Steps that repeat
live in `.claude/skills/verify/{{DRIVER}}`: write it on the first run, keep it, and fix it when the tool
changes, so later runs take one command. Commands below are bash.

## 1. Start
Build if the tool has a build (`{{BUILD_COMMAND}}`), and make `{{TMP}}/run/` with the sample input
`{{SAMPLE_INPUT}}`.
Ready when: the build exits 0, or with no build, the tool prints its version or help.

## 2. Use it
Walk the path a user takes through what the change touches, then one path next to it that must still work.
Run the tool as a user would, from `{{TMP}}/run/`: `{{TOOL_COMMAND}} {{ARGS}} > out.txt 2> err.txt; echo "exit=$?"`.
Then run it once with a bad input (a missing file or a wrong argument).

## 3. Proof
Print one line per check: `PROOF <what>: expected <x>, got <y>`; exit non-zero when one differs.
Check the exit code, one stdout line the change should produce, and each file it writes (it exists, one known
value inside). On the bad input: a non-zero exit and an error message that names the problem.
Check side effects (files written, rows saved, requests sent) as well as what is printed. Use the real path,
not a test-only shortcut.

## 4. Clean up
Nothing stays running. If the tool started a server or a watcher, stop that process by its id, never by
process name. Keep the proof files in `{{TMP}}`.

## 5. Report
    Verify: <the change, one line>
    Ran: <the commands>
    <the PROOF lines as printed>
    Result: pass | fail (<the failing line>)
On a fail, fix the code, not the proof, and run `{{DRIVER}}` again. After three failed rounds stop and show the
user the output. Never weaken a proof or a path to make it pass.
