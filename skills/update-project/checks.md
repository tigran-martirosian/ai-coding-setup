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

## Git and GitHub checks

The preset per project kind is step 2b of `~/.claude/skills/new-project/SKILL.md`; template files are in
its `preset/` folder. The kind is read from the folder: not inside a git repo (`git rev-parse
--show-toplevel` fails) → no git; in a repo with no github.com remote → local git; a github.com remote →
GitHub, private or public by the `private` field of `gh api repos/<owner>/<repo>`. A folder inside a
bigger repo (a package with its own `CLAUDE.md`) is a git folder of that repo: P7 lists only its own
untracked entries, P15 and P17-P19 read `.gitattributes` and `.github/` at the repo's top folder, and
`git init` is never offered there. All are `ask`; each GitHub setting is one tick and is read back after it is set. A folder without git
gets only P13. `/update-project` never runs `git init` without the P13 tick.

| Id | Kind | Applies to | What it tests | Evidence to show | Smallest fix |
|---|---|---|---|---|---|
| P13 | ask | every folder | `CLAUDE.md` has a `Git:` line, and it matches the folder: inside a git repo ↔ the line is not `none`; a github.com remote ↔ the line names GitHub. A chat-style folder's line is `Git: none (chat-style folder).` | no line, or the line and the folder disagree (`Git: none` but the folder is in a git repo) | add the `Git:` line for the kind found (new-project step 2b). In a folder without git: one tick "start local git", which writes the local line, then runs `git init -b main` |
| P14 | ask | git folders | `CLAUDE.md` holds the `Commits:` line (`<type>: <what the person gains>` and the type list) | the line is missing | add the line word for word from new-project step 2b |
| P15 | ask | git folders | `.gitattributes` exists and has a `text=auto` rule | missing file or rule | copy `preset/gitattributes.txt` to `.gitattributes`; a second tick runs `git add --renormalize .`, committed on its own on the user's word, because it changes many files' line ends |
| P16 | ask | GitHub folders | the remote's default branch is `main` (`git symbolic-ref refs/remotes/origin/HEAD`), and the `Git:` line names the branch flow | the default branch name; the missing flow words | the GitHub `Git:` line. A default branch `master`: the rename as its own tick, `gh api -X POST repos/<owner>/<repo>/branches/master/rename -f new_name=main`, with its cost shown: GitHub moves open pull requests and protection, and each clone needs `git branch -m master main` and a fetch |
| P17 | ask | GitHub folders | `.github/pull_request_template.md` (or `.github/PULL_REQUEST_TEMPLATE/`) exists | missing | copy `preset/pull_request_template.md` |
| P18 | ask | GitHub folders | some `.github/workflows/*.yml` has a `pull_request` trigger | no workflow, or none on pull requests | copy the stack's template (new-project step 2b, "CI") to `.github/workflows/ci.yml` with the test command filled in, and add the `Checks` merge line. Private: the tick says each run spends the included minutes (about $12 a month on Free) and that runs stop, unbilled, when they are used up. No test command known: not offered, and the evidence says why |
| P19 | ask | GitHub folders | `.github/dependabot.yml` exists with a `github-actions` entry | missing file or entry | copy `preset/dependabot.yml` and turn on the stack's entry (`npm` or `pip`), weekly, `commit-message.prefix: build`. Private: the stack's entry is off by default |
| P20 | ask (note offline) | GitHub folders | `gh api repos/<owner>/<repo>`: `allow_squash_merge` true, `allow_merge_commit` false, `allow_rebase_merge` false, `squash_merge_commit_title` `PR_TITLE`, `delete_branch_on_merge` true | each field that differs, with its value | the merge-settings call of new-project step 2b, then the read-back |
| P21 | ask (note on Free private) | GitHub folders | `gh api repos/<owner>/<repo>/rulesets` lists a ruleset on the default branch with `pull_request`, `non_fast_forward` and `deletion`, and `required_status_checks` once CI has run green on GitHub | the missing rules; or the 403 "Upgrade to GitHub Pro" answer, shown as a `note`: "not possible on this plan for a private repo" | create or update the ruleset of new-project step 2b. Free private: no fix; the flow stays a written rule in `CLAUDE.md` |
| P22 | ask (note offline) | GitHub folders | public: `security_and_analysis` has secret scanning and push protection on, `GET .../vulnerability-alerts` answers 204, `GET .../private-vulnerability-reporting` gives `enabled: true`, `GET .../code-scanning/default-setup` gives `state: configured`. Private: only the vulnerability alerts and automated security fixes | each setting that is off | one call per setting (new-project step 2b, "Security settings"), then a read-back |
| P23 | ask | git folders with a `CHANGELOG.md` or a tag | the changelog has `## [Unreleased]` or version headings `## [x] - YYYY-MM-DD`; `git for-each-ref refs/tags --format=%(objecttype)` shows no `commit` (a plain tag) among tags made after the stamp's date | the old-form headings; the plain tags | the changelog headings in the new form (a judgment edit, shown); new tags annotated from now on. Old tags stay as they are, because moving a published tag breaks downloads |

P24 (a local push guard on private repos) is not used: a private repo on GitHub Free cannot protect
`main`, so P21 is a `note` there and the flow stays a written rule.

**Network.** P20-P22 call the GitHub API, read only. The token: the remote owner's
(`gh auth token -u <owner>`) when the owner is one of the accounts `gh auth status` lists (names compare
case-insensitively; a computer can have several); else, for an organisation's repo, the first listed
account whose token can read `repos/<owner>/<repo>`. Without `gh`, with no account signed in, or with
no account that can read the repo, each prints a `note` "not checked: …" and nothing else; the last
names the accounts tried and that one of them needs access to `<owner>/<repo>`. A GitHub HTTP error
after that (a 401 for a revoked token, a 404 for a deleted repo) keeps the other findings: one `note`
line with the id `GitHub` names the error and the checks that did not run, and the exit code is that of
a normal pass. In tests, `PASS_GH` points at a fake `gh`.

P9 reads `node ~/.claude/hooks/recheck-dates.mjs --list "<folder>"`; on a setup without that hook the
check prints a `note` and is skipped.

P3, P4 (only the older entry a newly added "Replaces" or "replaced by" line names) and P8's paths
also run on their own: `~/.claude/hooks/upkeep-note.mjs` checks them after a commit or a `HANDOFF.md`
edit and has Claude fix them without a tick; their limits live in
`~/.claude/hooks/lib/upkeep-checks.mjs`, shared with `pass.mjs`.
