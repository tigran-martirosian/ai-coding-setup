---
name: verify
description: Start {{APP}} and use it the way a person does to prove a code change works, with proof a program can check. Use after the last code edit and before every commit that changes code, and when asked to verify, smoke test or try the app.
---

# Verify {{APP}}

For a web app that runs on a local port and is used in a browser. Run after the last code edit, before the
commit. Everything runs headless (no window) and muted, in the background, with its output in `{{TMP}}` (a temp
folder, not the project). Steps that repeat live in `.claude/skills/verify/drive.mjs`: write it on the first
run, keep it, and fix it when the app changes, so later runs take one command.
Needs: Node and Playwright with its Chromium (`npx playwright install chromium`). If one is missing, stop and
tell the user.

## 1. Start
Start `{{DEV_COMMAND}}` in the background, with its output in `{{TMP}}/server.log`, and save its process id. The
port is `{{PORT}}`. Reuse a server already up on that port only when this folder started it.
Ready when: `curl -sf http://localhost:{{PORT}}{{HEALTH_PATH}}` answers 200 and `drive.mjs` finds
`{{MAIN_ELEMENT}}` on the page. Ready means usable, not just a process that answers.

## 2. Use it
Walk the path a user takes through what the change touches, then one path next to it that must still work.
Reach things by role, label, visible text or route, never by screen position.
Run `node .claude/skills/verify/drive.mjs`: Playwright headless, Chromium with `--mute-audio`. It opens the
page, clicks and types by role and label, and waits for the response each action sends.

## 3. Proof
Print one line per check: `PROOF <what>: expected <x>, got <y>`; exit non-zero when one differs.
Check the changed element's text (`page.textContent`), the status and one body field of the request it sent
(`page.waitForResponse`), and the count of console errors (expected 0).
Check side effects (files written, rows saved, requests sent) as well as what is shown. Use the real path,
not a test-only shortcut.

## 4. Clean up
Stop the server this run started, by the process id it saved, never by process name. Keep the proof files in
`{{TMP}}`.

## 5. Report
    Verify: <the change, one line>
    Ran: <the commands>
    <the PROOF lines as printed>
    Result: pass | fail (<the failing line>)
On a fail, fix the code, not the proof, and run `drive.mjs` again. After three failed rounds stop and show the
user the output. Never weaken a proof or a path to make it pass.
