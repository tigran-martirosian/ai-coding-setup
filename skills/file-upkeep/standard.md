# The file standard

The one most projects use. `file-check.mjs` checks every rule marked with an id; its findings carry the same ids.
A project's own exception goes in `.claude/file-standard.json`: `{"ignore": ["<glob>"], "reason": {"<glob>": "<why>"}}` (in the projects folder also `"families": ["<name>"]`, names that make a P10 family),
each glob with its reason.

## Names

| Id | Rule | Source |
|---|---|---|
| N1 | Folder and file names are lowercase, words joined by hyphens: `query-data.md`, `skills/disk-tidy/`. Documents a person sends out (`.pdf`, `.docx`, `.xlsx`, `.pptx`) keep their case: people read those names (N4 still applies). | Google developer docs style guide, "Filenames"; eslint, MADR, anthropics/skills in practice; documents: own call |
| N2 | Python files are lowercase with underscores (`tts_worker.py`), only `[a-z0-9_]` before `.py`; Python tests are `test_<thing>.py`. A dated Python name (`a_b-2026-10-05.py`, `report_20261005.py`) is asked about: it cannot both import and keep its date. So is a dotted one (`a.b.py`), unless a tool names it (`gunicorn.conf.py`). | PEP 8 (a hyphenated module can't be imported); pytest docs |
| N3 | JS and TS code files follow one style per folder; new folders use kebab-case. React component files may be PascalCase (`Voice.tsx`) when the folder already does. | Google JS Style Guide 2.1: "Follow the convention that your project uses" |
| N4 | ASCII letters, digits, `-`, `_`, `.` only. No spaces. | Google docs style: "only standard ASCII alphanumeric characters" |
| N5 | A fixed set keeps its upper-case name: `README.md`, `CHANGELOG.md`, `LICENSE`, `CLAUDE.md`, `CLAUDE.local.md`, `AGENTS.md`, `SKILL.md`, `MEMORY.md`, `CONTRIBUTING.md`, `SECURITY.md`, `HANDOFF.md`, `DECISIONS.md`, `DESIGN.md`. A name a tool dictates stays as the tool wants (`package.json`, `pyproject.toml`, `__init__.py`, `Makefile`, `Dockerfile`, dotfiles). | GitHub docs, Keep a Changelog, Claude Code docs, agents.md |
| N6 | Dates are `YYYY-MM-DD`, at the start of the name of anything that is a point in time: `2026-11-10-disk-inventory.md`. The checker splits it: N6a a compact or reversed date anywhere, N6b an ISO date not at the start in `docs/`, `docs/research/`, `audits/`, N6c an undated file directly in `docs/research/` or `audits/`. | ISO 8601 via the Wisconsin and Harvard data guides; Keep a Changelog |
| N7 | A name says what the file is: `untitled`, `document1`, `new-file`, `temp`, `misc`, `stuff`, `test2` say nothing. | Google docs style: "Don't use generic page names" |
| N8 | A code file's name says what it does, not when or which try: no month word (a full month name but `may`, or `jan`, `feb`, `apr`, `jul`, `sept`, `nov`, as a whole word; the short forms that are common words, such as `dec` in `dec-to-hex`, don't count), no version word (`v2`), and no round word last (`rewrite`, `new`, `final`, `fix`, `try`, `attempt`, `draft`, `take`, `round`). `july_rewrite.py` breaks it; `fix-links.mjs` and `rewrite-history.mjs` don't (the word after the round word is the job). Dates are N6's. Asked about, with no new name proposed. | own call: the person's "how is somebody looking at my folder supposed to tell that's the thing that does the resume refresh?" |

## Places

| Id | Rule | Source |
|---|---|---|
| P1 | Top level: `docs/`, `tests/` (or `test/`), `scripts/` (or `tools/`), the source folder (`src/`, `lib/`, or the Python package), the N5 files and config. A code file at the root is the project's entry point only (`index.js`, `install.mjs`, `main.py`, a `main` or `bin` of `package.json`, a file its `scripts` run). | The top-level set of eslint, express, got, vite, flask, requests, fastapi |
| P2 | Tests live in `tests/`, or beside the code as `name.test.ext`: one of the two per project. | Node test runner patterns; pytest ("the failure mode is mixing them") |
| P3 | Designs, plans and notes are markdown under `docs/`, one file per topic, inside a topic folder (`docs/phone-app/`, `docs/releases/`); research notes in `docs/research/`. `docs/` itself holds `README.md` (the start page: what each folder holds) and a few standing files. | GitHub docs and MADR use `docs/`; the person: "how am I supposed to find the files" in one dated list of 232 |
| P11 | More than 20 loose files directly in `docs/` is asked about once, on `docs`, with no target: group them into topic folders and add the start page. | own call: the person browses `docs/` in a file window, where a long dated list hides the topics |
| P4 | Audit and test-run records: `audits/YYYY-MM-DD-topic.md`; a run's scripts and raw output in `audits/YYYY-MM-DD-topic/`. A script that runs again goes in `scripts/`. | The dated-notes habit; reusable code kept apart as in P1 |
| P5 | `.claude/` holds `settings.json`, `settings.local.json`, `systems-map.json`, `rules/<topic>.md`, `skills/<kebab-name>/SKILL.md` (plus that skill's files), `agents/<name>.md`. | Claude Code docs: the `.claude` directory, memory, skills |
| P6 | `CLAUDE.md` stays under 200 lines; `/new-project` aims for 60. | Claude Code memory docs: "target under 200 lines" |
| P7 | A full path stays under 240 characters. Folders go as deep as the work needs; two or three levels below the top is usual. | Windows `MAX_PATH` 260; no guide gives a depth number |
| P8 | Each folder has one role (the table below). A picture or preview (`.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`) in `docs/` that no file names (by path or by name, case aside, also in a big or UTF-16 file) goes to `shown/` (`docs/img/x.png` → `shown/img/x.png`): `shown/` is git-ignored, so the picture leaves git and its history stays. One a page or code names stays. When `docs/` is a site (`mkdocs.yml`, `_config.yml`, `docs/conf.py`, `.vitepress/`, a Docusaurus config) or code reads from `docs/`, the move is asked about: the site may use it by a built path or a fixed name (`favicon.png`). A code file in `docs/` is asked about, with no target; not a dot-folder's or a site's own (`docs/.vitepress/`, `conf.py`, `sidebars.js`, any code of a docs site). | the person's "this is my code, this is the folder for the user to check images and previews, this is music" |
| P9 | One run's output (`draft-*/`, `unpacked/`, `output/` or `outputs/` with no code in it, or a folder that holds an unpacked Office document, `[Content_Types].xml`) does not stay in the project: scratch goes to the temp folder. Not inside a dot-folder (`.claude/output-styles/`) or an audit run folder (P4 keeps a run's output there). The checker asks once for the whole folder, not for its files, and proposes no target. | own call; global CLAUDE.md: scratch goes to the temp folder |
| P10 | The projects folder holds one folder per project family, plus `archive/`. No loose files; no `<name>_worktrees`, `<name>-old` or `<name>-<part>` beside `<name>` (a family: `game-port`, `game-invite` and `Game.pdf` go in `game/`; case does not count, and files count). A family needs a `<name>` that is a project, a document or a folder of projects, or two or more parts; one part beside a plain folder or file (`tools/` and `tools-cli/`) is asked about. A folder there that is no project (no git, no `CLAUDE.md`) and holds none is asked about. `file-check.mjs --root` reports it; nothing is applied: a project folder moves with `move-project.mjs` (A3). | own call: a projects folder of one entry per family reads at a glance; loose entries of one family clutter it |

## Folder roles

| Folder | Holds |
|---|---|
| the source folder (`src/`, `lib/`, the package) | the code |
| `tests/` (or `test/`) | the tests |
| `scripts/` (or `tools/`) | code that is run by hand or by a command, not imported |
| `docs/` | text only: markdown, and diagrams as `.mmd`, `.excalidraw`, `.drawio`, `.svg` |
| `shown/` | what the person looks at: pictures, previews, renders. Git-ignored (`.gitignore` `*`) |
| `assets/` | media the product itself uses: images, music, fonts |
| `data/` | inputs the code reads |
| `audits/` | audit and test-run records (P4) |

Scratch (drafts, one run's output) goes to the temp folder, not the project (P9).

## Records and their lifetime

"Start" = read at every session start.

| Kind and place | Reader | Limit | Way out | Source |
|---|---|---|---|---|
| Decisions index, root `DECISIONS.md` | start (CLAUDE.md line) | 200 lines or 25,000 bytes | `decisions.mjs --split` moves its sections to `docs/decisions/`; the upkeep note runs it after a commit | Claude Code memory docs (MEMORY.md index: 200 lines / 25KB); using it here: own call |
| Topic file, `docs/decisions/<topic>.md` | on demand, named by the index; hooks through `hooks/lib/decisions.mjs` | 16,000 bytes | a "Replaces" line moves the old entry to the archive (upkeep note); over the limit, `--check` D3 and `/update-project` P4 ask for a split by sub-topic with a ledger | memory tool docs (`view` cuts at 16,000 characters); own call for this use |
| Job file, `docs/decisions/YYYY-MM-DD-<job>.md` | on demand: the job files of the newest date, or by grep; hooks as above | none | entries that bind later work move to a topic file (`--apply`); the rest stays as the job's history | common practice: on-demand stores have no cap; ADR keeps every record |
| Replaced decisions, `docs/decisions-archive.md` | on demand | none | none: kept for good, newest first, each with what replaced it | ADR (Nygard, MADR): keep, mark superseded |
| Handoff, root `HANDOFF.md` | start | 120 lines or 12,000 bytes | `/update-project` P3: trim; cut text in git or `docs/handoff-history.md` | own number (`upkeep-checks.mjs`); shape from Anthropic's harness post |
| Handoff history, `docs/handoff-history.md` | on demand | none | none: kept | own call |
| `/handoff` briefs, `~/.claude/handoffs/` | the session that is handed the path | none | none yet: no rule exists | own call: left as they are |
| Research notes, `docs/research/YYYY-MM-DD-topic.md` | on demand | none | R3 note after 90 days with no link | standard R3 |
| Designs and plans, `docs/YYYY-MM-DD-topic-design.md`, `-plan.md` | on demand | none | a design stays; a plan gets the R3 note at 90 days with no link | standard R3 |
| Audits, `audits/` | on demand | none | R3 note for run folders at 90 days | standard P4, R3 |
| Changelog, root `CHANGELOG.md`; a public changelog has one heading per version with short plain bullets; a README has no dated "What's new" paragraphs; a public branch gets one squashed commit per release or hotfix | at a release | none | none: kept | Keep a Changelog |
| Project `CLAUDE.md` | auto, every session | 200 lines (standard P6); `/new-project` aims for 60 | `/update-project` P2.length asks | Claude Code memory docs |
| `MEMORY.md` and memory topic files | auto (index), on demand (topics) | 200 lines or 25 KB, Claude Code's own | Claude Code's own: "merge or drop stale entries" | Claude Code memory docs |
| Hook state, `~/.claude/hooks/state/<hook>/` | the hook only | none | each hook's `sweep(hook, days)`, 1 to 90 days | `hooks/lib/state.mjs` |

R1 flags a handoff or decisions copy (`docs/history-handoff-2026-11-06.md`; `docs/decisions/` files are not copies), R2 a dated decisions archive (merged into
`docs/decisions-archive.md`), R3 a dated doc or audit run folder older than 90 days that nothing links to. R3 is a
note: the person decides to keep or delete it; nothing is deleted without their yes.

## Old text and copies

| Id | Rule | Source |
|---|---|---|
| A1 | Retired files are deleted with git: git history is the archive, and a tag marks the last commit that held a retired set. So a project holds no `archive/`, `old/`, `obsolete/`, `superseded/`, `old-versions*/`, `backup/` or `backups/` folder, and no `previous/` at the top or in `docs/`. Not a dot-folder's or a skill's own folder (`skills/backup/`). The checker reports such a folder as one finding, not its files, and asks about one that holds code. | None of nine popular repos has one; the person's own call: "we have commits saved, so we can go back to previous commits" |
| A2 | A changed file keeps its name: the newest version holds the plain name, older ones are in git. So `.bak`, `.orig`, `.before` (`x.before.py` beside `x.py`), `-old`, `-copy`, ` (1)`, `-backup`, or `-v2` beside the plain file, go. | As A1: git keeps every earlier version |
| A3 | A finished project moves out of the projects folder (to `archive/` or a disk) with a README. A whole project folder moves with `skills/file-upkeep/move-project.mjs <from> <to>`, never a plain move: it fixes what is keyed by the folder's path (git worktrees, Nimbalyst's workspace and sessions, Claude Code's project folder, scheduled tasks). `file-check.mjs --root` (P10) lists what should move. | GitHub "Archiving repositories" |

A copy git does not hold (untracked, or a folder that is not a git project) is asked about, never deleted on its own.
Git-ignored data (run logs, databases, caches) is the project's working data: the checker never reads, moves or
deletes it.
