# Memory check

Keeps each project's memory true and small. Notes go stale: a decision replaces them, a thing they
name is removed, two notes say the same, a note drops out of the index. You read, judge and list;
**change nothing until the user has ticked it.** Nothing here runs on a schedule.

Work from your `claude-settings` project folder: `DECISIONS.md` and `audits/` live there.

## 1. Pick the projects

The projects the user named, or else the 4 with the newest files under `~/.claude/projects/*/memory/`.
A project's memory folder is `~/.claude/projects/<project>/memory/`, where `<project>` is the
project's path with `:`, `\` and `/` turned into `-` (`C:\Projects\app` is `C--Projects-app`).

## 2. Read, per project

- `MEMORY.md` (the index) and every note in the folder, `archive/` left out.
- The project's `docs/facts.md`, if there is one.
- The newest 30 entries of the project's `DECISIONS.md`, if there is one.

## 3. Judge each note

A note is a **finding** when it is one of these, and every note is either a finding or passed:

| Kind | Test |
|---|---|
| contradicts | A newer `DECISIONS.md` entry or a line of `facts.md` says otherwise. Quote both, with dates |
| removed | It names a file, hook, skill, script or setting that no longer exists. Check with Glob or Grep before you say so |
| duplicate | Another note, `facts.md` or the project's `CLAUDE.md` says the same. Name the one to keep |
| orphan | It is in the folder but not in `MEMORY.md`, or `MEMORY.md` links a note that is not there |

A note that is right but old is passed. A note you are unsure of is passed with one line on why.

## 4. Propose

One action per finding, the smallest that fixes it: move the note to `memory/archive/`, merge it
into the note that stays, fix the line that is wrong, or add or remove its `MEMORY.md` line.

## 5. Ask: one tick list

Write `docs/<yyyy-mm-dd>-memory-check.md` in the setup project: per project, the notes read and a
numbered list, each item the note's full path, what is wrong (kind and the evidence) and the
proposed action. Then one `PromptForUserInput` with one `multiSelect`, nothing ticked in advance,
the same items. If nothing was found, say so and ask nothing.

## 6. Do only what was ticked

Create `memory/archive/` when a move needs it; move, never delete. Keep `MEMORY.md` in step with each
move. Add one line to the setup project's `DECISIONS.md` for the run. Reply short: what moved or
changed, what was declined. Reply in the language the user writes in.

Budget: about 25 tool calls per project.
