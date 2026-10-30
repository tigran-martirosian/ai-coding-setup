---
name: btw
description: Add something to, or correct, the task a Claude session is busy with in this same folder, without stopping it — it reads the note before its next step and keeps doing everything else. Use when the user types /btw <note>, or says "tell the other session to also…".
disable-model-invocation: true
---

# Add to or correct the busy session's task

Run this once, with the user's note exactly as written:

`node ~/.claude/skills/steer/steer.mjs send --user - <<'EOF'`
`<note>`
`EOF`

- If it prints `Delivered to …`, `Queued for …` or `Left for …`, reply with that line. Only `Delivered` means the session has the note. The
  name in it is the name on that session's tab: it tells the user where the note went.
  With several sessions active the script picks one itself (a busy one, else the most recently
  active): never ask the user which.
- When the user names the session (a Nimbalyst session id, or a child of this session), add
  `--to <that id>` after `send`; Nimbalyst ids work, in any folder.
- If it prints `NOT SENT`, no session is active: say so in one line.
- If the note asks a question, answer it under that line in a few lines; forwarding it is not
  an answer. A question about the busy session's work (its progress, what it did, why): run
  `node ~/.claude/skills/steer/steer.mjs btw "<question>"` and answer from its output. Any other
  question: from what you know, or one quick check.

No other tools beyond these. Don't comment on the note, and don't describe what you ran, tried or picked.
