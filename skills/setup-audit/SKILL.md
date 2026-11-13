---
name: setup-audit
description: "Audit of the Claude Code setup, one entry for every review of it. Use when the user says \"setup audit\", \"audit my setup\", \"is my setup working\", \"usage report\", \"where did my tokens go\", \"will I run out\", \"chat review\", \"full review\", \"project scan\", \"outcomes\", \"memory check\", or runs /setup-audit [usage|chat|full|scan|outcomes|memory] (optional: days, a project, a session)."
---

# Setup audit

The first word of the arguments picks the sub-command; the rest are its options (days, a project folder, a session). With no word, take it from what the user asked for. Read only the file for that word, then follow it. Scripts are in `scripts/` next to this file (`~/.claude/skills/setup-audit/scripts/`).

| Word | What it gives | File |
|---|---|---|
| (none) | the health audit of the whole setup, saved and compared with the last one | `audit.md` |
| `usage` | token numbers per session and helper, the plan forecast, the dashboard | `usage.md` |
| `chat` | the recent chats reviewed, then a tick list of setup changes | `chat.md` |
| `full` | one review of how the work went, ending in measured options to tick | `full.md` |
| `scan` | one project's own Claude setup checked | `scan.md` |
| `outcomes` | what the checks led to, counted from the chats | `outcomes.md` |
| `memory` | each project's memory notes checked against its decisions, then a tick list of moves to `memory/archive/` | `memory.md` |

Analysis first: change nothing until the user picks fixes. Reply in the language the user writes in.
