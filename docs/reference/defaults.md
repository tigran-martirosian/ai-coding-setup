# Schedules and limits

This page lists the main schedules and limits that Stratus's code sets, in one place. The page for each part can
give more of its own limits.

## Schedules

| What | When |
|---|---|
| Check for a new setup release (`update-check`) | Every 12 hours. After a failed check, again after 1 hour. |
| Offer of `/new-project` (`update-check`) | At most once a day for a folder that is not a project yet, until you answer "Never here" or "Never in any folder". |
| Reminder of an important release | A grey line about every 8 hours, and a short "What the update brings you" section about every 24 hours. |
| Reminder of other releases | A grey line at most once a day. |
| Plan usage saved (`plan-usage-logger`) | When a reply ends, at most every 5 minutes; every 30 seconds once the 5-hour or the weekly use is at 70% or more. |
| Chat archive | Off until you turn it on with `/disk-tidy`. When on, chats older than 60 days move, compressed, to `~/.claude-archive/chats` at the end of each `/update-setup`. An archived chat is deleted when it is older than `cleanupPeriodDays` (120 days, see [install changes](install-changes.md)). |
| Board Tidy archives old sessions | A minute after Nimbalyst starts, then every hour. The ages per board phase are on the [extensions page](extensions.md). |
| `session-cleanup` looks for idle sessions | At most every 10 minutes, when you send a message. A session counts as idle after 3 hours with no change to its transcript. |
| `map-nudge` offers to build a systems map | Once per project, ever. |
| `map-nudge` refreshes a stale systems map | At most once a week. |
| `map-drift` names a broken map link | Once an hour for each file and link. |

## Limits

| What | Limit |
|---|---|
| A project's `CLAUDE.md` | `/update-project` asks you to move lines to a `.claude/rules/` file when it has more than 60 lines. |
| `HANDOFF.md` | `/update-project` asks you to cut it when it has more than 120 lines or more than 12,000 bytes. |
| `DECISIONS.md` | `/update-project` asks you to split it when it has more than 200 lines or more than 25,000 bytes. |
| A download that `download-guard` speeds up | Over 50 MB. |
| A search from a drive root or the home folder (`find-guard`) | At most 3 folder levels deep. |
| `link-gate` sends one reply back | At most 3 times. |
| `repeat-guard` | Tells a helper to finish and report from about 90% of its turn limit. |
| `map-nudge` offers a systems map | In a project with 100 or more code files and 10,000 or more lines of code. |
| Node.js | 18 or newer to install; 22.5 or newer for the features that read Nimbalyst's database (see [dependencies](dependencies.md)). |
