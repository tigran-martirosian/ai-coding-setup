# The file standard

The one most projects use. `file-check.mjs` checks every rule marked with an id; its findings carry the same ids.
A project's own exception goes in `.claude/file-standard.json`: `{"ignore": ["<glob>"], "reason": {"<glob>": "<why>"}}`,
each glob with its reason.

## Names

| Id | Rule | Source |
|---|---|---|
| N1 | Folder and file names are lowercase, words joined by hyphens: `query-data.md`, `skills/disk-tidy/`. | Google developer docs style guide, "Filenames"; eslint, MADR, anthropics/skills in practice |
| N2 | Python files are lowercase with underscores (`tts_worker.py`); Python tests are `test_<thing>.py`. | PEP 8 (a hyphenated module can't be imported); pytest docs |
| N3 | JS and TS code files follow one style per folder; new folders use kebab-case. React component files may be PascalCase (`Voice.tsx`) when the folder already does. | Google JS Style Guide 2.1: "Follow the convention that your project uses" |
| N4 | ASCII letters, digits, `-`, `_`, `.` only. No spaces. | Google docs style: "only standard ASCII alphanumeric characters" |
| N5 | A fixed set keeps its upper-case name: `README.md`, `CHANGELOG.md`, `LICENSE`, `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `SKILL.md`, `MEMORY.md`, `CONTRIBUTING.md`, `SECURITY.md`, `HANDOFF.md`, `DECISIONS.md`, `DESIGN.md`. A name a tool dictates stays as the tool wants (`package.json`, `pyproject.toml`, `__init__.py`, `Makefile`, `Dockerfile`, dotfiles). | GitHub docs, Keep a Changelog, Claude Code docs, agents.md |
| N6 | Dates are `YYYY-MM-DD`, at the start of the name of anything that is a point in time: `2026-11-10-disk-inventory.md`. The checker splits it: N6a a compact or reversed date anywhere, N6b an ISO date not at the start in `docs/`, `docs/research/`, `audits/`, N6c an undated file directly in `docs/research/` or `audits/`. | ISO 8601 via the Wisconsin and Harvard data guides; Keep a Changelog |
| N7 | A name says what the file is: `untitled`, `document1`, `new-file`, `temp`, `misc`, `stuff`, `test2` say nothing. | Google docs style: "Don't use generic page names" |

## Places

| Id | Rule | Source |
|---|---|---|
| P1 | Top level: `docs/`, `tests/` (or `test/`), `scripts/` (or `tools/`), the source folder (`src/`, `lib/`, or the Python package), the N5 files and config. A code file at the root is the project's entry point only (`index.js`, `install.mjs`, `main.py`, a `main` or `bin` of `package.json`, a file its `scripts` run). | The top-level set of eslint, express, got, vite, flask, requests, fastapi |
| P2 | Tests live in `tests/`, or beside the code as `name.test.ext`: one of the two per project. | Node test runner patterns; pytest ("the failure mode is mixing them") |
| P3 | Designs, plans and notes are markdown under `docs/`, one file per topic; research notes in `docs/research/`. | GitHub docs and MADR use `docs/` |
| P4 | Audit and test-run records: `audits/YYYY-MM-DD-topic.md`; a run's scripts and raw output in `audits/YYYY-MM-DD-topic/`. A script that runs again goes in `scripts/`. | The dated-notes habit; reusable code kept apart as in P1 |
| P5 | `.claude/` holds `settings.json`, `settings.local.json`, `systems-map.json`, `rules/<topic>.md`, `skills/<kebab-name>/SKILL.md` (plus that skill's files), `agents/<name>.md`. | Claude Code docs: the `.claude` directory, memory, skills |
| P6 | `CLAUDE.md` stays under 200 lines; `/new-project` aims for 60. | Claude Code memory docs: "target under 200 lines" |
| P7 | A full path stays under 240 characters. Folders go as deep as the work needs; two or three levels below the top is usual. | Windows `MAX_PATH` 260; no guide gives a depth number |

## Records and their lifetime

| Kind | Name and place | Lifetime |
|---|---|---|
| Decisions in force | one `DECISIONS.md` at the root, by topic, newest first | each line stays until a new decision replaces it |
| Replaced decisions | one `docs/decisions-archive.md`, newest first, each with what replaced it | kept for good (ADR, Nygard and MADR: a reversed decision is kept, marked superseded) |
| Handoff | one `HANDOFF.md` at the root, current state only | rewritten each session; older states live in git history |
| Research notes | `docs/research/YYYY-MM-DD-topic.md` | kept while a decision, design or doc links to it |
| Designs and plans | `docs/YYYY-MM-DD-topic-design.md`, `-plan.md` | a design stays (the why behind built code); a plan stays while linked |
| Audits and run output | P4 | the `.md` record stays; a run folder stays while linked |
| Changelog | one `CHANGELOG.md` at the root | kept for good (Keep a Changelog) |

R1 flags a handoff or decisions copy (`docs/history-handoff-2026-11-06.md`), R2 a dated decisions archive (merged into
`docs/decisions-archive.md`), R3 a dated doc or audit run folder older than 90 days that nothing links to. R3 is a
note: the person decides to keep or delete it; nothing is deleted without their yes.

## Old text and copies

| Id | Rule | Source |
|---|---|---|
| A1 | Retired files are deleted with git: git history is the archive, and a tag marks the last commit that held a retired set. So a project holds no `archive/`, `old/`, `obsolete/`, `superseded/`, `old-versions*/` or `backup*/` folder. | None of nine popular repos has one; the person's own call: "we have commits saved, so we can go back to previous commits" |
| A2 | A changed file keeps its name: the newest version holds the plain name, older ones are in git. So `.bak`, `.orig`, `-old`, `-copy`, ` (1)`, `-backup`, or `-v2` beside the plain file, go. | As A1: git keeps every earlier version |
| A3 | A finished project moves out of the projects folder (to an archive folder or disk) with a README. Outside the checker: it works inside one project. | GitHub "Archiving repositories" |

A copy git does not hold (untracked, or a folder that is not a git project) is asked about, never deleted on its own.
Git-ignored data (run logs, databases, caches) is the project's working data: the checker never reads, moves or
deletes it.
