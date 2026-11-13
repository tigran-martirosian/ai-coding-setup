# Board Tidy

Keeps Nimbalyst's Sessions board to current work. A minute after Nimbalyst starts, and then every hour, it archives old sessions in every project:

| Phase on the board | Archived after this long with no activity |
|---|---|
| Complete | 3 days |
| No phase | 14 days |
| Planning, validating, implementing | 30 days |
| Backlog | never |

**Kept projects are left alone.** A chat-style project, where each chat is its own task you may look up months later, keeps every session: the install puts `quick-tasks` on the list in `~/.claude/board-tidy.json` (`{"keep": ["<folder>"]}`), `/new-project` asks, and asking Claude "stop tidying this project" or "tidy it again" changes it (the `board_tidy.keep` tool). In a kept project nothing is archived unless asked, e.g. "archive what's older than 6 months there" (`board_tidy.archive` with `project` and `olderThanDays`). `board_tidy.unarchive` brings back every archived session of one project.

Pinned sessions, running sessions and worktree sessions are never archived; worktree sessions are archived with their worktree in the app. A session that has a child still in use stays, because archiving a session archives everything under it.

Nothing is deleted. An archived session stays in the Archived view, where **Unarchive** brings it back. Every run is written to `~/.claude/state/board-tidy.jsonl`, and Claude can undo the last run with the `board_tidy.undo` tool. `/board-cleanup` calls `board_tidy.archive` after it moves finished sessions to Complete; `board_tidy.archive` with `dryRun: true` only lists what would go.

## How it works

`pick.mjs` reads Nimbalyst's session database read-only (it needs Node 22.5 or newer for `node:sqlite`) and picks the sessions. The extension archives each one through the same call the app's Archive button makes, so the board updates at once. When several Nimbalyst windows are open, only one of them runs per hour.

## Install

No npm needed: `node build.mjs --install`, then restart Nimbalyst. To stop it, turn Board Tidy off in Nimbalyst's extension settings. `node test.mjs` runs its checks.
