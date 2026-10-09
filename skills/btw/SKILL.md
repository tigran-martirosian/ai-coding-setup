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
  With several sessions active the script picks one itself (a busy one, else the most recently
  active): never ask the user which.
- If it prints `NOT SENT`, no session is active: say so in one line.

Use no other tools. Don't comment on the note, and don't describe what you ran, tried or picked.
