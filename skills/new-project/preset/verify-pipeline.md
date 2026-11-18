---
name: verify
description: Start {{APP}} and use it the way a person does to prove a code change works, with proof a program can check. Use after the last code edit and before every commit that changes code, and when asked to verify, smoke test or try the app.
---

# Verify {{APP}}

For a data or video pipeline. Run after the last code edit, before the commit. Everything runs
headless and muted, in the background, with its output in `{{TMP}}` (a temp folder, not the project). Steps that repeat
live in `.claude/skills/verify/{{DRIVER}}`: write it on the first run, keep it, and fix it when the pipeline
changes, so later runs take one command.
Needs (video only): `ffprobe` on the path. If it is missing, stop and tell the user.

## 1. Start
Make `{{TMP}}/out/`. The input is the small fixed sample `{{SAMPLE}}` (a few rows, a clip of a few seconds),
never the full set.
Ready when: the sample is present and `{{RUNTIME}} --version` answers (video: `ffprobe -version` too).

## 2. Use it
Run the pipeline end to end on the sample as a user would, `{{PIPELINE_COMMAND}}`, into `{{TMP}}/out/`, with its
output and log saved. Then run the step next to the change that must still work.

## 3. Proof
Print one line per check: `PROOF <what>: expected <x>, got <y>`; exit non-zero when one differs.
Check that each output file exists and is not empty. Data: the row count and one known value per changed
column. Video: `ffprobe -v error -show_entries format=duration:stream=codec_type,width,height -of csv=p=0`
against the expected duration, size and streams. If the pipeline logs a count of items, it matches the sample.
Check side effects (files written, rows saved, requests sent) as well as the output. Use the real path, not a
test-only shortcut.

## 4. Clean up
Nothing stays running. Keep the proof files in `{{TMP}}`.

## 5. Report
    Verify: <the change, one line>
    Ran: <the commands>
    <the PROOF lines as printed>
    Result: pass | fail (<the failing line>)
On a fail, fix the code, not the proof, and run `{{DRIVER}}` again. After three failed rounds stop and show the
user the output. Never weaken a proof or a path to make it pass.
