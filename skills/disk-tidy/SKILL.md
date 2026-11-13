---
name: disk-tidy
description: Find what fills the disk (leftover worktrees, old chat logs, scratch and temp folders, old project copies, Nimbalyst backups) and clear it item by item with the user's yes; turn the chat archive on or off; bring back an archived chat. Use when the disk is full or low, the user asks what takes space, wants an old chat back, after an update offers it, or on /disk-tidy.
---

# Disk tidy

The tool reports first and acts only on ledger items, re-checking each one just before it acts. About 8 tool calls.

`T="node ~/.claude/workers/disk-tidy.mjs"`

1. **Report.** `$T --report`. It changes nothing and writes the ledger named in its first line. A big folder that hits the time cap shows `≥`; that number is a floor.
2. **Ask, one card.** One `AskUserQuestion` (or Nimbalyst form) with ticks:
   - **Setup leftovers** (the first block): one tick, recommended. These are the setup's own (replay worktrees, test-run chat logs, its cache, its temp folders); the update clears them anyway.
   - **Each `W`, `O`, `T` item** whose action is `remove` or `delete`: its own tick, with its size and reason.
   - **Scratch** (`S` items marked `delete`): one tick, the folder names listed in its text.
   - **Video cache** (`V`): one tick.
   - **The chat archive**, when the report shows the `Chats older than 60 days` line: its own question, yes recommended.
   Items marked `keep: ...` are not ticks. Name them once below the card with their reason; for one with files not committed, offer `git -C "<path>" status --short` so the user can look.
3. **Act.** `$T --apply "<ledger>" --only <ids>`, ids comma-separated (a category name such as `scratch` takes the whole group). Each line says `removed`, `deleted`, `archived` or `skipped: <reason>`; pass the skipped ones on as they are.
4. **Chat archive.** On yes: `$T --archive-on` (60 days). If it answers `not turned on`, Claude Code's own sweep comes first: give the user its line and the `--days` it offers. On no: `$T --archive-off`. Once on, the update and the pc-tidy-nudge hook (every 3 days) archive by themselves.
5. **Tell the user**: what was freed, the total, what was kept and why, and for a removed `_worktrees` item the reminder to archive it in Nimbalyst too. The `In other apps` lines are clicks only the user makes (Nimbalyst Settings > Application > Database): give them as text.

## The chat archive

Chats older than 60 days move to `~/.claude-archive/chats` (gzipped, each copy checked against the original first) and are deleted there past `cleanupPeriodDays` in `~/.claude/settings.json`, the age at which Claude Code deletes live chats too. `memory/` folders never move.

- **Keep a project's chats forever** (archived, never deleted): `$T --keep-forever "<project folder>"`. A `*` matches one folder level, `**` any depth; the project's subfolders are covered too. The list is `keepForever` in `~/.claude/disk-tidy.json`.
- **Find an archived chat**: `$T --archive-list --project <text>` (date, id, folder, first prompt).
- **Bring one back**: `$T --restore <id-prefix>` (or `--restore --project <text>`, `--restore --all`). Restore before resuming: `/resume` reads only the live folder.

When the report's first line says `scanner: node`, a faster one helps on big folders: `gdu` (Windows, macOS, Linux) or WizTree (Windows). Say so once; the tool installs nothing.
