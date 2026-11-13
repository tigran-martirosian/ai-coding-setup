---
name: btw
description: Add to or correct the task of a Claude session busy in this same folder without stopping it, or ask what it is doing. Use when the user types /btw <note or question>.
disable-model-invocation: true
---

# Add to or correct the busy session's task, or ask about it

**A question about the busy session's work** (its progress, what it did, why) sends nothing, so its work is not touched:

`node ~/.claude/skills/steer/steer.mjs btw "<question>"`

Answer from its output in a few lines. When the user names the session, add `--to <that id>` after `btw`.

**Anything else is a note.** Run this once, with the user's note exactly as written:

`node ~/.claude/skills/steer/steer.mjs send --user - <<'EOF'`
`<note>`
`EOF`

- When the user names the session (a Nimbalyst session id), add `--to <that id>` after `send`; Nimbalyst ids work, in any folder.
- If it prints `Delivered to …`, `Queued for …` or `Left for …`, reply with that line. Only `Delivered` means the session has the note. The
  name in it is the name on that session's tab: it tells the user where the note went.
  With several sessions active the script picks one itself (a busy one, else the most recently
  active): never ask the user which.
- If it prints `NOT SENT`, no session is active: say so in one line.
- If the note also asks something else, answer it under that line in a few lines, from what you know or one quick check; forwarding it is not
  an answer (the no-response-gate hook blocks a reply that only forwards).

No other tools beyond these. Don't comment on the note, and don't describe what you ran, tried or picked.
