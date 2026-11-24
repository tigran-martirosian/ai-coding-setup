# How I work with coding agents

The hooks in this repository are one part of how I work with coding agents. I set the task and the rules, the tools do the work I hand them, and I review the result and approve anything risky. This page describes the rest of that setup.

I give the main Claude Code session the task and the rules and review what comes back; hooks check each of its tool calls; helpers, second Claude sessions it starts, each do one part of a job.

## How the setup works

`install.mjs` copies the hooks, agents, skills and workers into `~/.claude`, writes the rules into `~/.claude/CLAUDE.md` and adds the hook wiring from `settings.example.json` to `~/.claude/settings.json`. It also sets up the starter project folders, turns on the plugins the setup uses (the security and design ones among them) and, when Nimbalyst is there, builds the extensions and installs them.

After that, Claude Code does the work. It loads the rules into every session and runs the hooks on its own events: session start and end, your message, each tool call, the end of a reply. A hook reads the event and the session log, then lets the step through or sends a message back. Hooks run in groups, one Node process per group, so a shell command starts 3 Node processes for its checks and a file edit 4, not one per hook.

What each folder of the repository holds:

| Folder | What's in it |
|---|---|
| `agents/` | The 7 helpers, one file each: four `worker` helpers, the plan reviewer, the end reviewer and the blind reviewer |
| `docs/` | How to use it, feature details, the install steps and the test results ([index](README.md)); the promo video's source in `docs/promo/`, which renders into `docs/img/` |
| `extensions/` | The Nimbalyst extensions (agents list, job tracker, board tidying, command buttons, usage pop-up, systems map, Read Aloud, themes), built from source |
| `hooks/` | The scripts Claude Code runs on its events, with shared code in `hooks/lib` and the groups that run together in `hooks/dispatch-groups.json` |
| `rules/` | The rules file that becomes `~/.claude/CLAUDE.md`, which rules need Nimbalyst, and which versions shipped |
| `scripts/` | The installer's parts, the privacy scan, the commit title check and `nimbalyst-patch` (the setup's fixes to Nimbalyst's app files, and Nimbalyst updates on Windows) |
| `skills/` | The slash commands, such as `/grilling`, `/lead`, `/security` and `/update-setup`, one folder each |
| `templates/` | The starter project folders (`quick-tasks`, `claude-settings`) and the skills and hooks they share |
| `tests/` | One test file per part, run together by `tests/run-all.mjs` |
| `workers/` | Background scripts: backups, version lookups, big downloads, disk tidying, page reads |

## What I do myself

- **I set the task.** I say what I want, what must not change and how the result will be checked. If a requirement is unclear and the choice matters, the rules have the model ask me one question with options instead of guessing.
- **I make the decisions.** Each project has a `DECISIONS.md`. What I decide goes in there with the date, and later sessions read it first and don't reopen it.
- **I approve what's risky.** A shell command I haven't already allowed comes to me as a permission prompt. It has to end with a line in plain words saying what it does, so I know what I'm approving. `sql-guard` asks me before a DROP, a TRUNCATE, or a DELETE or UPDATE without WHERE.
- **I review the result.** The model has to show the check it ran and the output before it calls anything done, and I read both before I accept the work.

## What I hand to each tool

The rule: long reading of local files and second opinions go to a `worker` subagent, which runs Sonnet at medium effort (`worker-code` on Opus at high for code; Fable at medium for charts, science or maths) and has a budget of tool calls. A quick web lookup stays with the main session.

| Tool | What I use it for | Limits I set |
|---|---|---|
| Claude Code in the Nimbalyst editor (the main session) | Planning a change with me, writing and editing the code, running the checks | It does what I asked and nothing else: no unrelated refactoring, no extra features |
| `worker` subagent ([agents/worker.md](../agents/worker.md)) | Reading long files and logs, sweeping a project folder, a second opinion on a plan or a diff (about 15 tool calls, the answer is a lead that gets checked), one step of a bigger job, or routine edits that follow a clear plan | Sonnet at medium effort, no `CLAUDE.md` loaded, and it stops after 80 turns. Its brief has to name the goal of the job, the files and the project commands it needs |
| `worker-full` subagent ([agents/worker-full.md](../agents/worker-full.md)) | The same, for a step that needs a skill or an MCP tool | It loads every tool and the `CLAUDE.md` files, so it costs much more to start |
| `worker-code` subagent ([agents/worker-code.md](../agents/worker-code.md)) | The same as `worker`, for a step that writes or changes code; a long refactor goes to `worker-refactor` | Opus at high effort; otherwise the same limits as `worker` |
| `worker-refactor` subagent ([agents/worker-refactor.md](../agents/worker-refactor.md)) | The same as `worker`, for a long refactor that changes something code in other files depends on, or a long refactor step that failed its check on `worker-code`; a rename alone never counts | Fable at high effort, so each step costs far more; otherwise the same limits as `worker` |
| `reviewer` subagent ([agents/reviewer.md](../agents/reviewer.md)) | One independent check of a finished big job against its spec, for correctness only | It gets the spec, the diff and the end-check outputs, never the chat; it reads files and runs checks, changes nothing, stops after 60 turns; one per big job |
| `blind-reviewer` subagent ([agents/blind-reviewer.md](../agents/blind-reviewer.md)) | A newcomer's look at what a person will see, read or use: screenshots, a text, or a command's output | Opus at medium effort; it can only read the files it is handed, never sees the code, plan or chat, and stops after 30 turns |
| `plan-reviewer` subagent ([agents/plan-reviewer.md](../agents/plan-reviewer.md)) | One independent check of a big job's plan, written by the main session, before it reaches me | It reads files, runs only read-only commands and tests, changes no files, stops after 40 turns; one pass per job |

Long reading costs the most on the main model, which is why it goes to a `worker` subagent. A quick web lookup stays with Claude, which reads the page or the catalogue that knows the answer, and a page that a quote or a decision rests on is saved in full with `workers/read-page.mjs` (Firecrawl Local when it is installed, defuddle otherwise); deep research across many pages in a planned job goes to a `worker`. For a larger task I use a [skill](../skills/lead/SKILL.md) that runs it from the main session: the session writes the plan itself, a `plan-reviewer` checks it once, each step goes to a worker that knows the goal of the whole job, and one reviewer checks the result against the spec at the end (plus a `blind-reviewer` when a person will see it), so what comes back to me has already been checked once.

## The rules I wrote

A global instruction file holds the rules for every session. The file is [rules/CLAUDE.md](../rules/CLAUDE.md), and the installer puts it at `~/.claude/CLAUDE.md`. The main ones:

- Ask when a requirement is unclear and the choice matters. For a small, reversible choice, pick a default and say so.
- Do what was asked: no unrelated refactoring, no features nobody asked for.
- Nothing is called done without a real check and its output.
- Long reading of local files goes to a worker, and deep web research to a worker too. Planning and the decisions stay in the main session (the `lead` skill); the plan check goes to the plan-reviewer and the final check to the reviewer.
- Every subagent gets the inputs it needs and a budget of tool calls, and reports back when the budget runs out.
- Large files are read in parts, and big command output is processed outside the conversation.

## Rules that became hooks

Written rules were sometimes skipped: a large file was read whole, or a search subagent was started anyway. I saw it in the numbers. `scripts/usage-scan.mjs` reads the session transcripts and reports tokens per session and per subagent, and it showed search subagent runs using 0.6 to 4.3 million tokens each. So I turned each rule that mattered into a hook, a script that runs around a tool call and can block it.

Each switch in brackets, such as `DELETE_GUARD=off`, is an environment variable: set it in your shell or system environment and start a new chat ([Hook settings](features.md#hook-settings) lists them, with the ones a project can set for itself). A hook with no switch in brackets has no lasting off of its own. You can take its entry out of `~/.claude/hooks/dispatch-groups.json` or, if it is not there, out of `hooks` in `~/.claude/settings.json`, but the next update of the setup puts it back. The lasting ways are `DISPATCH=off`, which turns off every hook that `dispatch` runs at once, or the uninstall below.

To take a part out for good: a plugin it turned on (security-guidance, frontend-design, impeccable) with `claude plugin uninstall <name>`, and updates then leave it out. The whole setup goes with `node install.mjs --uninstall` in the folder you installed from: it takes the hooks out of `settings.json`, removes its files unless you changed them, puts back your files it replaced and Nimbalyst's original app files, and names how to remove the project folders, plugins and extensions it leaves.

| When | Hook | Rule it enforces |
|---|---|---|
| Before a shell command | `command-explain` | Explain the command in plain words; a command without that line runs with a stand-in line, and the agent is reminded |
| Before a shell command | `sql-guard` | Confirm destructive SQL with me |
| Before a shell command | `delete-guard` | Bulk deletes are refused, deleting a named file passes; temp and worktree folders pass (`DELETE_GUARD=off`) |
| Before a shell command | `find-guard` | A search through a whole drive or the home folder is refused unless its depth is 3 or less (`FIND_GUARD=off`) |
| Before a shell command | `download-guard` | Not a guard, a speed-up: a plain download of a file over 50 MB runs through `workers/download.mjs`: 32 byte ranges side by side, resume, sha256 (`DOWNLOAD_GUARD=off`) |
| Before a workflow starts | `workflow-fence` | `/deep-research` runs only from the terminal: in an app or a headless run (Nimbalyst included) it skips its approval stop and can't be stopped, so it is refused there; other workflows pass (`WORKFLOW_FENCE=off`) |
| Before a Nimbalyst setting changes | `settings-guard` | A session that wants to change one of your Nimbalyst settings (a project's permission mode, model, language, theme, extensions and the like) asks you first and says what it would set |
| Before a push or a deploy | `push-key-scan` | A push that would send a key or token (my 13 shapes and gitleaks' rules), or a key file such as `.env.production`, asks me first; in a project switched on with `ship-check init`, a raw deploy command is refused and runs through `ship-check deploy`, which checks what gets uploaded and probes the live address |
| Before a shell command | `opencli-readonly` | In my signed-in browser, site commands only read (never post, like, follow or log in); page steps such as click and fill run for a job I asked for, and a click that publishes waits for my yes |
| Before a picture is shown in the chat | `picture-in-project` | The picture is shown from the project's `shown` folder, so it still loads after a cleanup and a click opens it enlarged |
| Before a new file is written | `file-name-note` | A new file whose name or place breaks the file standard gets a note with the rule and the proposed name; the file is still written (`FILE_NAME_NOTE=off`) |
| Before a Nimbalyst browser session opens | `browser-visible-gate` | A `headless: false` session shows no window you can see, so it is refused and the `site-login` skill is named: it opens a real window to sign in, which closes by itself once you are in |
| Before a question to me | `question-other` | A card with a plan-row id such as B6 I didn't use, or one that asks no decision, is refused with what to write instead (at most twice in a row; labels listed in the project's `.claude/card-labels.txt` always pass). A question I can't type my own answer to, a missing link, a choice with two recommended options or with one option goes to the agent as a note to fix in its reply. In Nimbalyst a start note sends a quick yes/no or pick-one to its question card, which always has a typing box, and everything else into the reply |
| Before a file edit, read or shell command | `repeat-guard` | On the second identical error, a note to find what both tries took for granted; refuse a retry of the same call after the same error came back three times; both say that if no other approach is left, the agent asks you in a form with the error text (a helper reports BLOCKED instead); and remind once when one file is edited six times or read four times in a turn, or the same call is repeated |
| After a helper returns | `helper-stopped` | A helper cut off at its turn limit or with no report is asked once what is done and left, and the files are checked; a cut-off reviewer counts as not run (`HELPER_STOPPED=off`) |
| When I send a message | `update-check` | Say when a newer version of the setup is released (checked every 12 hours), and let a release that asks you nothing install itself in the background; a notice about a coming release is shown once (`UPDATE_CHECK=off`; `AUTO_UPDATE=off` stops only the self-install) |
| When I send a message | `usage-dashboard-hook` | Typing just `usage` opens the usage dashboard without a model call (inside Nimbalyst it refreshes the data and says where to click) |
| While a session runs | `plan-usage-logger` | Save the plan's 5-hour and weekly percentages every 5 minutes, for the usage forecast |
| Before a reply goes out | `link-gate` | No link that wasn't opened in this session |
| Before a reply goes out | `file-link-gate` | File links are written in the form Nimbalyst's chat can open (an absolute path with forward slashes); only inside Nimbalyst |
| Before a reply goes out | `verify-gate` | A turn that edited a code file ends only after a build or test ran following the last edit; the gate asks once per turn and never runs the command itself (`VERIFY_GATE=off` and `VERIFY_PATTERN` for a project's own commands). A run of the project's verify skill counts; in a project with one, a code commit with no verify run is logged, and refused once with `VERIFY_GATE_COMMIT=enforce` |
| When a session starts | `nimbalyst-notes` | Inside Nimbalyst, the agent is told two quirks of its tools; nothing in the terminal (`NIMBALYST_NOTES=off`) |
| Around a shell command and when a session ends | `session-cleanup` | A session closes what it started (dev servers, watchers, headless browsers, background shells). It never closes or records a process whose command line holds `scripts/nimbalyst-patch/`, the Nimbalyst update. Report mode first: it only logs what it would close until `SESSION_CLEANUP=on` (`=off` stops it; `SESSION_CLEANUP_IDLE_HOURS`, default 3, is when a silent session counts as ended) |
| Before a helper starts | `map-brief` | A trial: only while `~/.claude/state/map-brief-trial.json` has not expired, a random half of helper briefs get the lines of the project's systems map for the parts they touch, and only those; without the file it does nothing |
| When I send a message | `map-nudge` | In a project with 100 or more code files holding 10,000 or more lines and no systems map, I am asked once, on a question card, whether to build one; a background worker builds it only on yes |
| Before an edit | `map-generated` | A hand edit of a file a script writes is refused, with the script to change and rerun (`MAP_GENERATED=off`) |
| After an edit | `map-drift` | An edit that removes the code a map link rests on is named, so the agent checks that link (`MAP_DRIFT=off`) |
| Before a tool call, when I send a message, before a reply goes out | `dispatch` | Runs a group of hooks in one Node process (groups in `hooks/dispatch-groups.json`); when it fails itself, only a call one of its guards checks is stopped (`DISPATCH=off` turns off every hook it runs, the guards too) |

The uncapped search subagents are now stopped by the settings, not a hook: the installer puts `Agent(Explore)` and `Agent(general-purpose)` in `permissions.deny`. I use the scanner's counts to decide which rule needs a hook next. The wiring is in [settings.example.json](../settings.example.json).

## Long sessions

A long session sends its whole history again on every step, so every step costs more. The [handoff skill](../skills/handoff/SKILL.md) writes a short brief (goal, state, next step, files) and the new session starts from it.

Each project keeps three short files that a new session reads first: `CLAUDE.md` (rules and commands for the project), `HANDOFF.md` (current state and what's next) and `DECISIONS.md` (what I decided and when). A project with code also gets a verify skill (how to start it, what to do in it, what proof to show): `/new-project` writes it, and `/update-project` offers it to an older project.

## The systems map

A project with 100 or more code files holding 10,000 or more lines can get a map of itself: a dictionary of its parts and what connects to what, saved in the project as `.claude/systems-map.json`. You don't write it. `map-nudge` has the agent ask you once, on a question card, whether to build it now; on yes a background worker builds it from [skills/systems-map](../skills/systems-map/SKILL.md), on no nothing starts, and the question does not come back for that project. A map whose files are mostly gone or changed gets a background refresh, at most once a week, without a question. `map-brief` acts only during its trial: while `~/.claude/state/map-brief-trial.json` (`{"until": "YYYY-MM-DD"}`) has not expired. Without that file, or after its date, it does nothing. During the trial each eligible helper call gets one of two arms at random, `map` or `none`, logged to `~/.claude/state/map-brief-trial.jsonl`, so the runs with map lines can be compared with the runs without. In the `map` arm it adds to each helper's brief only the lines for the parts whose files the brief names: their rules and their links with the reason for each, at most 2,000 characters, so a helper knows what its change connects to without loading a whole graph. A part named only by its name, its folder or a word gets no lines, and no start files are listed. A project with fewer code files or lines gets no question, and the map file is yours to read, edit or delete. A brief that ends with the line `SYSTEMS MAP: none` is left without map lines. When an edit removes the code a link rests on, `map-drift` names the link, so the map is fixed in the same session. A `words` entry that is one common word ("release") is ignored, and `--check` fails on it. In Nimbalyst the systems-map extension draws the map. A file a script writes is listed under `generated` in the map: `map-generated` refuses a hand edit of it, and the map's `--check` names one edited by hand since its script last ran. `MAP_NUDGE=off`, `MAP_BRIEF=off`, `MAP_DRIFT=off` and `MAP_GENERATED=off` turn the four hooks off.

## Disk and files

The setup cleans up after itself: an update clears its own leftovers (worktrees and chat logs from its test runs, its cache and temp folders) and says how much it freed. What is yours it only offers, on one question card: your own leftovers go through [`/disk-tidy`](../skills/disk-tidy/SKILL.md), which reports first and removes only what you tick, and a reorganize of your project files goes through [`/file-upkeep`](../skills/file-upkeep/SKILL.md), which checks names and places against [a file standard](../skills/file-upkeep/standard.md) and keeps a ledger to undo it. If you pick "Not now", you can run both later. Once you say yes to the chat archive, chats older than 60 days move to `~/.claude-archive/chats` every 3 days; `--keep-forever` keeps a project's chats for good, and `--restore` brings one back.

## Nimbalyst updates

On Windows, Nimbalyst updates through the setup, not by itself. A patch turns Nimbalyst's own updater off, and every patch run applies it first: without it, no other patch goes in. The setup pins the Nimbalyst version it delivers in `scripts/nimbalyst-patch/pin.json`. After an update, `/update-setup` gets that version ready with `deliver.mjs`: it is installed and patched when I close Nimbalyst, or at once through one restart card, which runs `restart.mjs` (it closes Nimbalyst, installs, patches and opens it again). `node ~/.claude/scripts/nimbalyst-patch/deliver.mjs --off` or `NIMBALYST_FOLLOW=off` stops this. `/pc-tidy` and `session-cleanup` never stop a process whose command line holds `scripts/nimbalyst-patch/`, so an update that waits for Nimbalyst to close is left alone.

## Asked once at install

The full install ([full-install.md](full-install.md)) asks two questions once and keeps both answers in `~/.claude/setup-state.json`, so no update asks them again. A "no" is fine: everything works without them.

- **Voice typing.** A yes installs [Handy](https://handy.computer) and sets it up; a Handy already on the computer counts as a yes and is left as it is. The answer only stops the question: Handy itself is yours to add or remove any time (`winget install --id cjpais.Handy -e`, on a Mac `brew install --cask handy`). To change the answer on record, run `node install.mjs --handy yes` or `--handy no` in the setup's folder; that run neither installs nor removes Handy.
- **The encrypted backup.** A yes runs [`/backup`](../skills/backup/SKILL.md) as the last step of the install. After a no, `/backup` sets it up any time. `/backup off` stops the schedule and deletes nothing. `node ~/.claude/skills/update-setup/update.mjs --backup no` puts a no on record and runs nothing else. An install from before this question is asked about the backup once, on its next `/update-setup`.

## Security and design

Security comes in three levels, from [skills/security](../skills/security/SKILL.md). Always on: Anthropic's security-guidance plugin warns on risky code as each file is edited and reviews the change when a turn ends and on `git commit` and `git push`; install and update turn it on when Python 3.10 or newer is there, and leave it off with a message otherwise. Quick, before a commit, pull request or release: `/security`, which runs Claude Code's `/security-review` on the change and a gitleaks scan for secrets. Deep, once per project or when a big new part arrives: `/security deep`, a deepsec scan of the whole project. Each release of this setup names the level it ran.

For interfaces, install and update turn on Anthropic's frontend-design and Paul Bakaus's impeccable. [`/gridlines`](../skills/gridlines/SKILL.md) draws vertical guide lines down an interface, finds every item that misses its line and fixes the paddings so sidebars, toolbars, panels and tables share a few edges; it follows Karri Saarinen's redraw of Linear's sidebar.

## Add-ons

Two pieces are opt-in and left out of a default install: the `phone-bot` skill and the `read-aloud` extension. `node install.mjs --with phone-bot,read-aloud` adds either or both, and a copy already in place stays and keeps being updated by a plain run.

## Tests

```
node tests/run-all.mjs
```

Each hook runs as its own process on made-up session logs, the installer runs twice on an empty home folder, and `scripts/privacy-check.mjs` scans the repository for home folder paths, email addresses and API keys. `scripts/render-check.mjs` draws each page as GitHub shows it, light and dark, at desktop and phone width, and fails on cut-off text or a broken link. GitHub Actions runs all of it on Windows and macOS on every pull request to `main`, along with a lint, a type check of the TypeScript extensions, a key scan of the whole history and the privacy scan. `--only a,b`, `--failed`, `--changed` and `--verbose` are explained at the top of `tests/run-all.mjs`.
