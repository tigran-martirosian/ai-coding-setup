# Memory check

Keeps each project's memory true and small. Notes go stale: a decision replaces them, a thing they
name is removed, two notes say the same, a note drops out of the index. You read, judge and list;
**change nothing until the user has ticked it.** Nothing here runs on a schedule; the run's file (step 5) is what
keeps it monthly.

Memory has one job, how to work with this user, since only the main session reads it: a fact
belongs in `docs/facts.md`, a decision in `DECISIONS.md`, a rule in `CLAUDE.md` or a rule file.

Work from your `claude-settings` project folder: `DECISIONS.md` lives there, and this check's report goes to its `docs/` (step 5).

## 1. Pick the projects

The projects the user named, or else the 4 with the newest files under `~/.claude/projects/*/memory/`.
A project's memory folder is `~/.claude/projects/<project>/memory/`, where `<project>` is the
project's path with `:`, `\` and `/` turned into `-` (`C:\Projects\app` is `C--Projects-app`).

## 2. Read, per project

- The link check: `node ~/.claude/skills/setup-audit/scripts/memory-links.mjs <memory folder>` prints one line per
  `[[link]]` to no note (`link`), index line with no file (`index`), note with no index line (`orphan`), absolute or
  `~/` path that does not exist (`path`) and note with no date (`undated`), then the counts. Each line is a finding
  in step 3: `link`, `index` and `orphan` lines are the orphan kind, `path` lines the removed kind, and an
  `undated` note gets a date.
- `MEMORY.md` (the index) and every note in the folder, `archive/` left out.
- The project's `docs/facts.md`, `CLAUDE.md` and `.claude/rules/*.md`, where they exist.
- The `DECISIONS.md` index and the job files of the newest date in `docs/decisions/` (the date in their names); with no `docs/decisions/`, the newest 30 entries of `DECISIONS.md`.
- The dated lines: `node ~/.claude/skills/update-project/recheck-dates.mjs --list "<project folder>"` prints each line of
  the notes and files above that ends with `(recheck YYYY-MM-DD)`, as `past` or `ok`.

## 3. Judge each note

A note is a **finding** when it is one of these, and every note is either a finding or passed:

| Kind | Test |
|---|---|
| contradicts | A newer entry of the decision files or a line of `facts.md` says otherwise. Quote both, with dates |
| removed | It names a file, hook, skill, script or setting that no longer exists. Check with Glob or Grep before you say so |
| fact | A fact about the machine, a tool or an account. It goes to `facts.md` |
| repeats | Another note, `facts.md`, the decision files (an entry in `docs/decisions/` too), `CLAUDE.md` or a rule says the same. Name the one to keep: a note and a decision entry never repeat each other |
| orphan | It is in the folder but not in `MEMORY.md`, or `MEMORY.md` links a note that is not there, or a `[[link]]` names no note |
| leftover | It sends work to a dropped store (`graphify-out`, `~/.claude-mem`, a removed plugin's cache) or to child sessions. Also name such folders found on disk |
| expired | Its `(recheck YYYY-MM-DD)` date has passed (`past` in the `--list` output): check the fact now (a file, a command or the web). Action: update the fact and the date, or delete the note |
| incident | It states only the incident (what went wrong once), not the general dislike behind it. Action: reword it to the dislike, the incident kept as its Why |
| stacked | Two notes, or two parts of one, say the same thing in turn. Action: merge in place, the newer wording wins |

Every note carries a date: the date on its Why line is enough. A note with none is given the date it was written
(its `modified` field, else the file's date). A fact-kind note also gets `(recheck YYYY-MM-DD)` at the end of the
fact's line in the note's body (not its frontmatter), 90 days out for versions, model names, prices, plan limits and how an app, CLI or
website behaves; 180 days for facts about this computer (paths, installed tools, accounts); none for a measurement
tied to a date, a decision or a rule. A recheck that confirms the fact sets a new date; one that disproves it fixes
the line and sets a new date.

A note about an approach that was dropped is kept as what was tried and why it went, not deleted: it stops the
approach from coming back. A note that is right but old is passed. A note you are unsure of is passed with one line
on why.

## 4. Propose

One action per finding, the smallest that fixes it: delete the note, merge it
into the note that stays, move a fact to `facts.md`, cut a restated part down to a pointer to its
line, fix the line that is wrong, or add or remove its `MEMORY.md` line. A leftover folder is only
listed: removing it is the user's own step.

## 5. Ask: one tick list

Write `docs/<yyyy-mm-dd>-memory-check.md` in the setup project: per project, the notes read and a
numbered list, each item the note's full path, what is wrong (kind and the evidence) and the
proposed action. This file is what makes the check monthly: the next check is due when the newest
`docs/<yyyy-mm-dd>-memory-check.md` is over 31 days old, so write it on every run, also when nothing was found. Then one `PromptForUserInput` with one `multiSelect`,
nothing ticked in advance, the same items, then right after it an optional `editText` "Anything else?"
(`minLength: 0`). Outside Nimbalyst: the same items as a numbered list in the reply, and ask which numbers to
do. If nothing was found, say so and ask nothing.

## 6. Do only what was ticked

A ticked note to retire is deleted, with no `archive/` folder (A1 of
`~/.claude/skills/file-upkeep/standard.md`); the tick is the user's yes, and the tick list keeps its path and
what was wrong. Keep `MEMORY.md` in step with each change. Add one line to the setup project's decision files
for the run. Reply short: what was deleted or changed, what was declined. Reply in the language the user writes in.

Budget: about 25 tool calls per project.
