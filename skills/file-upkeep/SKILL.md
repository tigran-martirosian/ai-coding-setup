---
name: file-upkeep
description: "Files: names, places and old copies in a project folder by the common standard. Use for /file-upkeep, when the person asks to tidy, rename or reorganize a project's files, or says yes to the reorganize offer."
---

# File upkeep

The standard, rule by rule with its source: [standard.md](standard.md). Read it when naming a new kind of file or
judging a finding. The checker below finds what breaks it; this skill is the reorganize, in order: report → ledger →
check → apply → after. Git history is the archive: an old version is in git, so a copy beside the file goes.

`FC` = `node ~/.claude/skills/file-upkeep/file-check.mjs`. It reads only what git shows (tracked, or untracked and
not ignored), so git-ignored data (run logs, databases, caches) stays exactly where it is, unread and untouched.

## 1. Before

- A git project with uncommitted changes in files the run touches: commit them with the person's yes, or stop. The
  clean start is the undo's base: one commit before, one after.
- Several projects (the update's offer): `FC --report --homes`; do each home in turn, steps 2-7.

## 2. Report

`FC --report <folder> --json`. Kinds: **fix** (a target is proposed), **ask** (a person decides: a delete with no
copy in git, or no clear target), **note** (listed only, nothing changes). Read every ask, and every fix whose target
looks wrong for this project. `refs` names the files whose text changes with a move.

## 3. Ledger

Write the ledger to a temp file outside `.claude` (shape in the header of `file-check.mjs`): one entry per fix and
ask finding, with its `id`, `path` and `sha` from the report and one action:

| Action | When |
|---|---|
| `move` + `to` | the proposed target, or a better one you name |
| `delete` | a copy or archive git holds; an untracked one only with the person's `"answer": "yes"` |
| `merge` + `to` | a dated decisions archive into `docs/decisions-archive.md` (R2) |
| `keep` + `reason` | the person's file stays as it is; the reason goes to `.claude/file-standard.json` |

Done when every fix and ask id has exactly one entry.

## 4. Asks

One question card, at most 3 questions, for the asks that delete or move the most. The rest are `keep` with the reason
"not asked this run", named in the summary. A note (R3, an old record nothing links to) is a question for the person
only when they ask for one: it is listed, never deleted by this run.

## 5. Check

`FC --check <ledger>` until it prints `check: ok`. Each fault names its finding; fix the ledger, or report again when a
file changed since the report.

## 6. Apply

`FC --apply <ledger>`. It runs the check again, then: `git mv` and `git rm` in git (plain renames otherwise; an
untracked delete goes to `~/.claude/setup-logs/file-moves-trash/<date>/`), the merges and keeps, and the reference fix
in the same pass: every live text file, `.claude/systems-map.json` and `.claude/settings*.json` that names a moved file
by its project path, absolute path or relative path. Dated records, `audits/` and `docs/decisions-archive.md` keep the
old paths: they describe what was true then. It saves the full ledger under `~/.claude/setup-logs/` and prints it. Then delete the temp ledger: the saved one stays.

Each `by hand:` line is a bare file name or a path built in code that names a moved file: fix each one, or tell the
person why it stays. Each `outside the project:` line is a file under `~/.claude` naming the old absolute path: fix it
on the person's yes.

## 7. After

- Run the project's test command when its `CLAUDE.md` names one; a failure from a moved path gets fixed now.
- In git, one commit: `File standard: <n> moves, <d> deletes (ledger <path>)`.
- Summary: the counts, every delete, the kept asks, and the undo: `FC --undo <saved ledger>` (in git, `git revert` of
  that commit does the same).

## The update's offer

The update runs `FC --status --homes` and shows its `offer:` line as one card; `offer: none` shows nothing. On yes,
this skill runs. On not now: `FC --skip --homes`, and the reply names `/file-upkeep` to run it later.
