# Project pass checks

One row per check id of `pass.mjs --check`. The base a folder should hold is the base table of
`~/.claude/skills/new-project/SKILL.md` (step 2); this file does not repeat it. Kinds: **fix** = a
mechanical change with one right answer; **ask** = a change that needs judgment or loses content;
**note** = shown, no change proposed. An id the folder's stamp lists as kept is left out of the check.

| Id | What it tests | Evidence to show | Smallest fix |
|---|---|---|---|
| P1 | `CLAUDE.md`, `HANDOFF.md`, `DECISIONS.md`, `docs/`, `.claude/rules/` exist | the missing names | create each from its new-project row; new files only, nothing overwritten |
| P2 | `CLAUDE.md` holds each base line of the new-project `CLAUDE.md` row: start with `HANDOFF.md`, designs in `docs/`, the file-standard line, a `Checks` section, `Tools in this project`, `docs/known-failures.md` named when the project has tests; at most 60 lines | the sub-id (`P2.handoff`, `P2.designs`, `P2.standard`, `P2.checks`, `P2.tools`, `P2.failures`, `P2.length`) and the line count | the base line to add, shown; over 60 lines, the lines that could move to a `.claude/rules/` file. Skipped in a folder whose `CLAUDE.md` the setup installed (a project home) |
| P3 | `HANDOFF.md` at most 120 lines | its line count | cut done work and old state; propose the cut lines |
| P4 | `DECISIONS.md` at most 300 lines and no entries the file marks replaced ("Replaces …", "replaced by") | line count, the line numbers of the marked entries | move replaced entries to `docs/decisions-archive.md` (a move, never a delete). Judge also which entries are no longer in force |
| P5 | `.claude/settings*.json` parse; each hook they register exists; each `.claude/skills/*/SKILL.md` and `.claude/agents/*.md` has `name` and `description`; each project skill is named in `CLAUDE.md` (a line naming `skills/<name>` or `/<name>` and the ask that calls it, as in `~/.claude/skills/setup-audit/scan.md`) | the file and the fault | fix the JSON or the hook path; add the missing field; add the `CLAUDE.md` line, shown |
| P6 | `file-check.mjs --report` on the folder | its `fix` and `ask` lines, as they are | `/file-upkeep`'s ledger, applied in step 4 of the pass |
| P7 | `git status --short` (git folders only) has no untracked entries | the untracked entries, grouped by top folder | per group, one of: commit, add to `.gitignore`, delete (scratch and test output, by the file standard) |
| P8 | each backticked path in `CLAUDE.md`, `HANDOFF.md`, `.claude/rules/*.md` exists under the folder or under `~`; the project's memory notes pass the memory check (`~/.claude/skills/setup-audit/memory.md`, for this one project) | the file, line and path; the memory check's findings | first look where the note says the path lives (a repo, another folder); then edit the path or drop the line |
| P9 | no fact is past its recheck date (`(recheck YYYY-MM-DD)` at the end of its line) | `<file>:<line>  <date>  <text>` | recheck the fact now (a file, a command or the web) and set a new date, or drop it |
| P10 | the tools this project uses: `.claude/settings.json` `enabledPlugins`, `claude plugin list` | the enabled plugins | none here: run step 3 of `/new-project` (tools for this project, one ask) |
| P11 | `docs/facts.md`, when it exists, has the recheck-date line in its header | the header lines | add the line of the new-project `docs/facts.md` row under the title |
| P12 | `.claude/systems-map.json` exists and has "how we do X" things (a thing that lists a `~/` file) | no map, or no how-to thing | on a tick, start one background `worker` (Agent, `run_in_background: true`, description `Systems map: build for this project` or `Systems map: add how-to things`) told to read `~/.claude/skills/systems-map/SKILL.md` and follow it for this folder; the pass does not wait for it |

P9 reads `node ~/.claude/hooks/recheck-dates.mjs --list "<folder>"`; on a setup without that hook the
check prints a `note` and is skipped.
