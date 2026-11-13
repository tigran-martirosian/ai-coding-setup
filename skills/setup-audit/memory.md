# Memory check

Keeps each project's memory true and small. Notes go stale: a decision replaces them, a thing they
name is removed, two notes say the same, a note drops out of the index. You read, judge and list;
**change nothing until the user has ticked it.** Nothing here runs on a schedule.

Memory has one job, how to work with this user, since only the main session reads it: a fact
belongs in `docs/facts.md`, a decision in `DECISIONS.md`, a rule in `CLAUDE.md` or a rule file.

Work from your `claude-settings` project folder: `DECISIONS.md` and `audits/` live there.

## 1. Pick the projects

The projects the user named, or else the 4 with the newest files under `~/.claude/projects/*/memory/`.
A project's memory folder is `~/.claude/projects/<project>/memory/`, where `<project>` is the
project's path with `:`, `\` and `/` turned into `-` (`C:\Projects\app` is `C--Projects-app`).

## 2. Read, per project

- `MEMORY.md` (the index) and every note in the folder, `archive/` left out.
- The project's `docs/facts.md`, `CLAUDE.md` and `.claude/rules/*.md`, where they exist.
- The newest 30 entries of the project's `DECISIONS.md`, if there is one.

## 3. Judge each note

A note is a **finding** when it is one of these, and every note is either a finding or passed:

| Kind | Test |
|---|---|
| contradicts | A newer `DECISIONS.md` entry or a line of `facts.md` says otherwise. Quote both, with dates |
| removed | It names a file, hook, skill, script or setting that no longer exists. Check with Glob or Grep before you say so |
| fact | A fact about the machine, a tool or an account. It goes to `facts.md` |
| restates | Another note, `facts.md`, `DECISIONS.md`, `CLAUDE.md` or a rule says the same. Name the one to keep |
| orphan | It is in the folder but not in `MEMORY.md`, or `MEMORY.md` links a note that is not there |
| leftover | It sends work to a dropped store (`graphify-out`, `~/.claude-mem`, a removed plugin's cache) or to child sessions. Also name such folders found on disk |

A note that is right but old is passed. A note you are unsure of is passed with one line on why.

## 4. Propose

One action per finding, the smallest that fixes it: move the note to `memory/archive/`, merge it
into the note that stays, move a fact to `facts.md`, cut a restated part down to a pointer to its
line, fix the line that is wrong, or add or remove its `MEMORY.md` line. A leftover folder is only
listed: removing it is the user's own step.

## 5. Ask: one tick list

Write `docs/<yyyy-mm-dd>-memory-check.md` in the setup project: per project, the notes read and a
numbered list, each item the note's full path, what is wrong (kind and the evidence) and the
proposed action. Then one `PromptForUserInput` with one `multiSelect`, nothing ticked in advance,
the same items, then right after it an optional `editText` "Anything else?" (`minLength: 0`). If nothing was found, say so and ask nothing.

## 6. Do only what was ticked

Create `memory/archive/` when a move needs it; move, never delete. Keep `MEMORY.md` in step with each
move. Add one line to the setup project's `DECISIONS.md` for the run. Reply short: what moved or
changed, what was declined. Reply in the language the user writes in.

Budget: about 25 tool calls per project.
