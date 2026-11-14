---
name: new-project
description: Set up a new project folder so Claude can work in it efficiently from day one — a short CLAUDE.md, HANDOFF.md and DECISIONS.md, .claude/ rules/skills/agents folders, and a check of which installed tools (plugins, MCP servers, cheap workers) this project should use, turned on for this project only, and its git or GitHub preset (branches, pull requests, CI, repo settings). Use when the user starts a new project, says "set this project up", "bootstrap", "new-project", or opens a folder that has no CLAUDE.md.
---

# New project setup

Goal: any project gets the same solid base, so every future session starts with the right
context and uses the right tools without being told.

## 1. Understand the project (ask, don't guess)

Look at the folder first (a file listing, `package.json`/`pyproject.toml`/etc.).
Then ask in **one** AskUserQuestion/PromptForUserInput round, with sensible defaults filled in,
each as its own question (not a tick-list):
- What is it, and who is it for? (one sentence)
- What does "done" look like for the first milestone?
- Stack and key commands (build, test, run, lint), if not obvious from the files.
- Any hard rules: sources of truth, things never to touch, style or tone.
- If the project works with data (tables, reports, loads): where the data comes from, what reads
  the result (a report, a screen, another system), how often it refreshes, and how Claude can run
  queries here (which command or connection, whether it points at test or real data, or that only
  the user can run them).
- In Nimbalyst only: is it a project you build in, or a chat-style folder where each chat is its own task
  you may look up again months later? Chat-style: the Board Tidy keep tool (ToolSearch `board_tidy`)
  with this folder and `keep: true`, so its sessions are never archived on their own.
- Where does this project's history live? Not asked in a chat-style folder (it gets no git) or in a
  folder that already has `.git` (read its kind as `/update-project` does). Answers, with what each gives:
  **Git on this computer only (Recommended)**: history and undo from day one, no account, no cost, and
  it moves to GitHub later · **GitHub, private**: backup, pull requests and CI, which spends the
  account's included Actions minutes · **GitHub, public**: all of it free, with a protected `main` ·
  **No git**. A git answer is the user's go-ahead for `git init` in step 2b. For a GitHub answer with
  more than one account signed in (`gh auth status`), ask in the same round which account owns it.

## 2. Create the base (skip what already exists, never overwrite)

| File | Content |
|---|---|
| `CLAUDE.md` | **Under 60 lines.** What the project is (2–3 lines) · `Start with HANDOFF.md, then DECISIONS.md` · key commands · folder map · hard rules, each linking to a `.claude/rules/*.md` file for details · for a data project, the step 1 answers (sources, what reads the result, refresh, how to run queries) · for any project that keeps data (a database, a log, data files): where each one lives as a full path, and the exact command that reads it with a tool that is installed · `Designs and plans live in docs/ as dated markdown files, docs/YYYY-MM-DD-topic-design.md and -plan.md; reply with a short summary and a link, not the whole design in chat` · `New files follow ~/.claude/skills/file-upkeep/standard.md: dated notes in docs/, docs/research/, audits/; scratch and test output in the temp folder, deleted after the run; no copies beside a file` · which tools to use here (step 3) · a **Checks** section: which check runs when (build, tests, review, release), written once with the user; a check the user asks for once is a one-off until they say it is standing; on GitHub kinds also the CI merge line (step 2b) · under the hard rules, the `Git:` line, and in a git kind the `Commits:` line (step 2b) |
| `HANDOFF.md` | Current state only, under about 120 lines: what's next, open questions. Rewritten at the end of every working session so a fresh session can pick up cold. |
| `DECISIONS.md` | First the section `## What each thing is for` (the purpose record, empty at the start), then the decisions in force in dated sections, newest first, each as **decision** — why · *origin, date*. It wins over older docs. A new decision replaces the line it overrides; the old text moves to `docs/decisions-archive.md`. |
| `docs/` | Design documents and plans, one dated markdown file per topic: `YYYY-MM-DD-topic-design.md`, `-plan.md`. |
| `docs/research/` | Dated research notes, `YYYY-MM-DD-topic.md`. |
| `audits/` | Dated audit and test-run reports, `YYYY-MM-DD-topic.md`; one run's scripts and raw output in `audits/YYYY-MM-DD-topic/`. |
| `tests/`, `scripts/` | Tests, and scripts that run again; the root holds only the entry point. |
| `docs/facts.md` | Facts about the project and its tools, one per line, read before one is added. Its header, under the title: `A fact that can change (version, price, limit, how a tool behaves) ends with (recheck YYYY-MM-DD): 90 days out, 180 for facts about this computer.` and `A trap (learned the hard way) is one line: Trap: <what it seems to do>. Really: <what it does>. Cost: <what it cost>. Check: <how to check it>.` |
| `docs/known-failures.md` | Checks that fail for a known reason, each with that reason. A failure that stays after one rerun is added here. CLAUDE.md names the file: a failure listed there is expected. |
| `docs/speech-glossary.md` | Offered when the user dictates: misheard word → meant word, started with the project's own names. |
| `.claude/rules/` | One short file per rule area (e.g. `content-sources.md`, `code-style.md`) that is too long for CLAUDE.md |
| `.claude/skills/`, `.claude/agents/` | Project-only skills from step 3; otherwise empty for now. The project's CLAUDE.md names each skill in one line, with the ask in the user's words (example: "a deploy, hotfix or rollback → `.claude/skills/deploy`"). Add a read-only reviewer agent when output quality needs an independent check. When step 1 shows distinct kinds of sessions (for example building, answering questions, releasing), offer one skill per kind and a "Which skill" table in CLAUDE.md. |
| `.claude/settings.json` | `permissions.allow` for the project's safe, frequent commands (test, lint, build) so they don't prompt, and `enabledPlugins` from step 3 |
| `.gitattributes` | Git kinds: a copy of `preset/gitattributes.txt` (LF line ends, CRLF for Windows scripts, binaries marked), so a Windows clone does not break shell scripts. |
| `.github/pull_request_template.md` | GitHub kinds: a copy of `preset/pull_request_template.md` (What changes, Why, How it was checked). |
| `.github/workflows/ci.yml` | GitHub public: the stack's CI template (step 2b, "CI"). GitHub private: offered, because each run spends the account's included minutes. |
| `.github/dependabot.yml` | GitHub public: a copy of `preset/dependabot.yml` with the stack's entry turned on. GitHub private: offered, off by default, because each update pull request runs CI on the included minutes. |
| `CHANGELOG.md` | Offered in git kinds, because many projects (a script, a site) never publish versions: a copy of `preset/CHANGELOG.md`; each release gets a `## [<version>] - YYYY-MM-DD` heading and an annotated tag `v<version>` (step 2b, "Releases"). |

`preset/` is the folder next to this file; its files are stored without a leading dot so they do not
act on the setup's own repository.

Names and places follow `~/.claude/skills/file-upkeep/standard.md`. A folder that already has a
`CLAUDE.md`: run `/update-project` instead.

Keep everything short. CLAUDE.md is loaded into every session and every line costs tokens.

## 2b. Git and GitHub (the history answer of step 1)

What each kind gets. **set** = done as part of the answer; **offered** = one question; a dash names
why it is not possible. `/update-project` checks the same items (P13-P23 in its `checks.md`).

| Item | Git on this computer only | GitHub private | GitHub public |
|---|---|---|---|
| `git init -b main`, the `Git:` and `Commits:` lines, `.gitattributes` | set | set, plus `gh repo create --private` | set, plus `gh repo create --public` |
| Branch flow: `main` holds merged work, one branch `<type>/<topic>` per change | `main` only: with no remote there is nothing to review on | set | set |
| Pull-request template; merge settings (squash only, title as subject, branch deleted after merge) | - pull requests live on GitHub | set | set |
| CI workflow and its `Checks` merge line | - Actions runs only on GitHub; `Checks` names the local test command | offered | set |
| Dependabot file | - runs only on GitHub | offered, off by default | set |
| Protected `main` (ruleset) | - no GitHub repo | - GitHub Free has no rulesets or protection on private repos; the flow is a written rule and Claude checks CI before a merge | set |
| Security settings | - no GitHub repo | Dependabot alerts and security updates (secret scanning and CodeQL on a private repo are not in Free) | secret scanning with push protection, Dependabot alerts and security updates, CodeQL default setup, private vulnerability reporting |
| Release part: `CHANGELOG.md`, annotated tags | offered | offered, plus a GitHub Release | offered, plus a GitHub Release |

**No git** gets only the line `Git: none.`; a **chat-style folder** gets `Git: none (chat-style folder).`
Everything else in the table needs commits, so neither gets it.

**Order.** The `Git:` line comes first, because the global rule allows `git init` only where the
project's `CLAUDE.md` says so.

1. Into `CLAUDE.md`, under the hard rules:
   - local: `Git: on this computer only; git init allowed; work is committed on main.`
   - GitHub: `Git: GitHub (<private|public>); main holds merged work only; each change goes on a branch <type>/<topic> and reaches main as one squash-merged pull request whose title follows the commit rule.`
   - every git kind, word for word, so the rule travels with the project to a Claude without this setup:
     `Commits: subject "<type>: <what the person gains>", at most 72 characters; type is one of feat, fix, docs, test, ci, refactor, perf, build, chore; no plan-step or session ids.`
   - GitHub kinds with CI, in `Checks`: public `GitHub refuses a merge until CI is green.`; private
     `A pull request merges only when its CI is green. On this plan GitHub does not enforce it, so Claude checks it before merging.`
2. `git init -b main`, then the files of the base table for the kind.
3. GitHub kinds: `gh repo create <name> --private|--public --source .`, with no `--push`. With several
   accounts signed in, each `gh` call runs as `GH_TOKEN=$(gh auth token -u <owner>) gh ...`.
4. GitHub kinds: the settings below, each read back with a `GET` of the same path; a value that did not
   take is reported, not retried in a loop.
5. The first push, every later push, `gh pr create` and `gh pr merge --squash --delete-branch` each
   wait for the user's word, and a merge also waits for green CI.

**Merge settings** (both GitHub kinds): `gh api -X PATCH repos/<owner>/<repo> --input <file>` with

```json
{"allow_squash_merge": true, "allow_merge_commit": false, "allow_rebase_merge": false,
 "squash_merge_commit_title": "PR_TITLE", "squash_merge_commit_message": "PR_BODY",
 "delete_branch_on_merge": true}
```

**Ruleset** (public; private only on a paid plan): `gh api -X POST repos/<owner>/<repo>/rulesets --input <file>`
with the body below. It goes in without `required_status_checks`: a check name that never ran blocks
every merge. After CI's first green run on GitHub, add the rule with the job names
(`PUT repos/<owner>/<repo>/rulesets/<id>`), which `/update-project` offers as P21. Zero approvals,
because a one-person project cannot approve its own pull request.

```json
{"name": "main", "target": "branch", "enforcement": "active", "bypass_actors": [],
 "conditions": {"ref_name": {"include": ["~DEFAULT_BRANCH"], "exclude": []}},
 "rules": [{"type": "deletion"}, {"type": "non_fast_forward"}, {"type": "required_linear_history"},
  {"type": "pull_request", "parameters": {"required_approving_review_count": 0,
   "dismiss_stale_reviews_on_push": false, "require_code_owner_review": false,
   "require_last_push_approval": false, "required_review_thread_resolution": false}}]}
```

The rule added after the first green run:
`{"type": "required_status_checks", "parameters": {"strict_required_status_checks_policy": false, "required_status_checks": [{"context": "<job name>"}]}}`

**Security settings:** both kinds `gh api -X PUT repos/<owner>/<repo>/vulnerability-alerts` and
`gh api -X PUT repos/<owner>/<repo>/automated-security-fixes`. Public also: `PATCH repos/<owner>/<repo>`
with `{"security_and_analysis": {"secret_scanning": {"status": "enabled"}, "secret_scanning_push_protection": {"status": "enabled"}}}`,
`PUT repos/<owner>/<repo>/private-vulnerability-reporting`, and
`PATCH repos/<owner>/<repo>/code-scanning/default-setup` with `{"state": "configured"}`.

**CI.** The stack is read from the folder's root, first match wins: `package.json` → `preset/ci-node.yml`;
`pyproject.toml`, `requirements.txt` or `setup.py` → `preset/ci-python.yml`; anything else →
`preset/ci-generic.yml` with `{{TEST_COMMAND}}` set to the test command of `CLAUDE.md`'s `Checks`, plus the
setup step of GitHub's matching starter file (https://github.com/actions/starter-workflows/tree/main/ci),
pinned by commit SHA. With no test command known, CI is not offered, and the reply says why: a workflow
with nothing to run always passes and proves nothing. Each template says in its header what to adjust
before copying it to `.github/workflows/ci.yml`. Every template keeps its pinned SHAs, `permissions:
contents: read`, `concurrency` and the 15-minute limit; Dependabot's `github-actions` entry keeps the pins
fresh. For Dependabot, turn on the stack's commented entry (`npm` or `pip`) in the copy of `preset/dependabot.yml`.

**CI systems** (the `os` list of the template): public repos run on every system the project's
`CLAUDE.md` names as a target (`ubuntu-latest`, `windows-latest`, `macos-latest`), which costs nothing.
Private repos spend the account's included minutes, so: Linux on every push and pull request; Windows
added when the project targets Windows (a minute costs about 1.7 Linux minutes); macOS only as a second
job with `if: github.event_name == 'workflow_dispatch'`, run by hand, because a macOS minute costs about
ten. With no payment method on file, runs stop when the included amount is used, and nothing is billed.

**Releases** (when the release part was taken): the changelog heading `## [<version>] - YYYY-MM-DD`
with short bullets; `git tag -a v<version> -m "<version>: <headline>"`; on GitHub also
`gh release create v<version> --verify-tag --notes-file <that section>`. Each waits for the user's word.

## 3. Pick the tools this project should use, and turn them on here only

Check what's installed (`claude plugin list` shows each plugin as enabled or disabled,
`claude mcp list`) and what could be added (the
`find-skills` skill, if it is installed). Many plugins are off globally on purpose, so other sessions stay small.
List your picks for the user, one line each on what it helps with, and ask once before turning
anything on. Then, for each accepted pick:
- **Installed plugin that is off:** add `"<name>@<marketplace>": true` under `enabledPlugins` in
  the project's `.claude/settings.json` (create the file or key if missing; keep other keys).
  Don't run `claude plugin enable`: that turns it on in every folder.
- **Skill not installed yet** (needs Node's `npx`; `find-skills` is where you found it): from the
  project folder run `npx -y skills add <repo> --skill <name> -a claude-code -y` (no `-g`), then check it is under
  the project's `.claude/skills/`.
- **MCP server:** `claude mcp add -s local ...` from the project folder.

Tell the user to start a new session in the project so they load. Then add a **"Tools in this
project"** section to CLAUDE.md that names only the relevant ones and when to use them. Typical
picks:

| If the project… | Tell sessions to use |
|---|---|
| uses a library or framework | **Context7**, if it's set up, for current docs before writing code against it |
| has a web UI | Nimbalyst **Browser** to preview it and check it; if they are installed, **Playwright** to check it in a real browser and **Frontend Design** for the look; **Designeer** (https://www.designeer.xyz, a free list of design galleries, component libraries, and type and colour tools; nothing to install) for references before a new page or a redesign, with **Component Gallery** (https://component.gallery, how real design systems build one element), **Refero Styles** (https://styles.refero.design, the type and colour of real products) and **DESIGNmd** (https://designmd.ai, a design system as one `DESIGN.md` file to drop into the project); once the first screen exists, `/design-system write` makes the project's own `DESIGN.md` from its code |
| needs UI or architecture planning | Nimbalyst **MockupLM** mockups and **Excalidraw** diagrams before building |
| has a database or data model | Nimbalyst **DataModelLM** (`.datamodel`) for the schema, kept in step with the DDL, and the matching database best-practices skill |
| has large files or docs | The big-read gate is global. Name the biggest files here so sessions go straight to targeted reads or a `worker` subagent. |
| takes in PDFs, Word, PowerPoint or Excel | **MarkItDown**: convert to `.md` once, keep the `.md` next to the source, and read that |
| is research-heavy | **NotebookLM** if it's set up, and any installed research agents |
| has a plan and multiple steps | The `planner` agent, then `/lead`, and Nimbalyst **Planning** trackers, with the **task-type patch** applied now: one `tracker_define_type` patch on `task` adding the fields `step` (text), `stage` (select), `waitsOn` (text), `proof` (text), `budget` (number) and the status `waits-for-you` (label "Needs you", category started), so each plan row becomes a step and `/where-are-we` can read how much is left |

Also add any project-specific helper routing, for example "summaries of `logs/` go to
a `worker` subagent". A design or plan is a good thing to get a second opinion on from
a `worker` subagent before building.

## 4. Finish

- Start the project's Systems map: one background `worker` (Agent, `run_in_background: true`, description
  `Systems map: build for this project`) told to read `~/.claude/skills/systems-map/SKILL.md` and follow it for
  this folder. A folder with no code yet still gets its topics (from step 1) and how-to things (research, web
  research and the jobs step 1 named). Don't wait for it.
- Stamp the folder as on the current setup, so the next day's first message does not offer to bring it up to
  date: `node ~/.claude/skills/update-project/pass.mjs --done "<folder>"`, with the folder's full path.
- Tell the user what was created and turned on, in a short table, and what to fill in (open questions).
- Don't run `/init` on top of this. It tends to pad CLAUDE.md. Keep CLAUDE.md accurate and short
  by editing it when something changes.
