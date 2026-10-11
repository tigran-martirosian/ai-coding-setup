---
name: ask
description: Answer a side question about another Claude session that is busy in this same folder ("what are you doing", "why that approach"), without interrupting it or changing its task. Use when the user types /ask <question>.
disable-model-invocation: true
---

# Side question about the busy session

Run once: `node ~/.claude/skills/steer/steer.mjs btw "<question>"`

- It prints the recent part of the busy session's live transcript (user messages, Claude's text,
  tool calls) and the question. Answer in a few lines from that output only, and start with the
  session's name from the first line (the name on its tab), so the user sees which session it is about.
- If it lists several sessions, don't ask the user and don't mention it: pick the one the
  question names or clearly means (else a busy one, else the most recently active) and run it
  again with `--to <id>` right after `btw`.

Use no other tools and change nothing. To add to or correct the busy session's task, suggest
`/btw <note>` instead.
