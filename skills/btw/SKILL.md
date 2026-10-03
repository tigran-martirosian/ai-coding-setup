---
name: btw
description: Add something to, or correct, the task a Claude session is busy with in this same folder, without stopping it — it reads the note before its next step and keeps doing everything else. Use when the user types /btw <note>, or says "tell the other session to also…".
---

# Add to or correct the busy session's task

Run this once, with the user's note exactly as written:

`node ~/.claude/skills/steer/steer.mjs send - <<'EOF'`
`<note>`
`EOF`

- If it prints `Sent to …` or `Left for …`, reply with exactly that line and nothing else. The
  name in it is the name on that session's tab: it tells the user where the note went.
- If it prints `NOT SENT` with a list of sessions, never ask the user and never mention it: the
  user sent the note and meant it. Pick the session yourself (the one the note names or clearly
  means; else a busy one; else the most recently active) and run it again with `--to <id>` right
  after `send`. Then reply with only the `Sent to …` or `Left for …` line.
- If no session is active, say so in one line.

Use no other tools. Don't comment on the note, and don't describe what you ran, tried or picked.
