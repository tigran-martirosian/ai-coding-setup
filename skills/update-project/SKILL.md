---
name: update-project
description: 'Bring an existing project folder up to the current setup: its CLAUDE.md, HANDOFF.md and DECISIONS.md, the .claude/ rules, skills and settings, the file layout, stale notes and facts past their recheck date, and the tools turned on for this project only. Use when the user says "update this project", "project pass", "bring this folder up to the setup", or says yes to a project-pass offer.'
---

# Update a project to the setup

A **project pass** brings one existing folder to the base a new project gets from `/new-project`
(its base table in `~/.claude/skills/new-project/SKILL.md` is the single source), plus the checks
in [`checks.md`](checks.md). A folder with no `CLAUDE.md` yet is a new project: run `/new-project`.

Folder: the one the user names, else the current one. `PASS` below is
`node ~/.claude/skills/update-project/pass.mjs`.

## Steps

1. **Check.** `PASS --check "<folder>"`. It reads, never writes. Done when its summary line
   `project-pass <folder> · <a> to fix · <b> to ask · <c> notes · level <L>` is printed.
2. **Judge.** For each `ask` line, and for the judgment checks the script leaves to you (P4 decisions
   still in force, P8 stale lines and memory notes, P10 tools), read only the lines it names and
   write the proposed change. What each id means, its evidence and its smallest fix: `checks.md`.
   Done when every line of the check output has either a proposed change or "keep, because …".
3. **Show.** Write `audits/<yyyy-mm-dd>-project-pass.md` in the project: the check output, then a
   numbered list, each item the file, what is wrong with its evidence, and the change (for an edit,
   the exact old and new lines; for a delete, the full path). Then ask once. In Nimbalyst: one
   `mcp__nimbalyst__PromptForUserInput` form with one `multiSelect` of the same items, nothing ticked
   in advance, and an optional `editText` "Anything else?" (`mcp__nimbalyst__AskUserQuestion` is for
   one choice of 2-4 options, not this). Elsewhere: the numbered items in the reply, and ask which
   numbers to do.
   Nothing found: say so, run `PASS --done "<folder>"`, stop.
4. **Do what was ticked**, in this order: new files, edits to existing files, moves and renames
   (through `node ~/.claude/skills/file-upkeep/file-check.mjs --apply <ledger>`, which has its own
   undo), deletes last. Done when every ticked item is done or its failure is written down.
5. **Close.** `PASS --done "<folder>" --kept <ids>`, the ids of the unticked items (comma-separated,
   as the check printed them), so the next check leaves them out. One line in the project's
   `DECISIONS.md` only when a ticked item changed a rule; a line in `HANDOFF.md` only when the
   session's work is already in it. Reply: a short table of what changed and what was kept, the
   audit file's link, and "start a new chat here so the changes load".

## What needs the user's yes

- **Listed in the reply, no tick needed:** new files only (P1, a missing `docs/` folder), and the
  stamp `pass.mjs` writes in `~/.claude/project-pass.json`.
- **A tick:** every edit to an existing file, every move or rename, every `.gitignore` line, every
  `DECISIONS.md` archive move.
- **A tick per item, its full path shown:** every delete (untracked scratch, a stale memory note).
- **Outside a pass:** a git commit or push (only when the user asks), a change outside the folder
  (its memory folder under `~/.claude/projects/` and the stamp are the exceptions), a plugin turned
  on in every folder.

## The offer and "not now"

The update-check hook offers a pass once in a folder that is behind the setup's pass level. On
"not now": `PASS --skip "<folder>"` (offered again after a release raises the level). "Never, for
any folder": `PASS --skip-all`. `PASS --list` names the folders worked in lately and whether each is
behind, done or declined; `PASS --status` prints the stamp file.

Budget: about 30 tool calls for a folder with a 60-line `CLAUDE.md`. A big `DECISIONS.md` tidy (P4)
is its own `worker` step with that file in its Files.
