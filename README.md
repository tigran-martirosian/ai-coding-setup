# AI coding setup for Claude Code

Rules, hooks, agents and tools for Claude Code. I use it for all my development. Claude Code logs every action the agent takes; the hooks compare the agent's reply with that log and send the reply back when they don't match.

It's in use at work by people in finance, data engineering and government IT.

https://github.com/user-attachments/assets/afb359f9-9d7c-4a07-a691-b6efef3297c0

If the video doesn't load (the GitHub app sometimes won't play it), [watch it here](https://github.com/user-attachments/assets/afb359f9-9d7c-4a07-a691-b6efef3297c0).

## Test results

- **The reviewer agent finds as many planted bugs as a plain "review this change" prompt, with 40% fewer tokens, 16% lower cost and 22% less time.** Both ran the same model, effort, tools and 16 changes; only the instructions differed. It also raised fewer false alarms on clean code than the plain prompt did (2 of 7 against 3 of 7).
- **The hooks ran over 12,000 times on real past sessions and hard made-up cases with no crashes.** The delete, long-sleep and find guards were right on all 30 test commands: risky ones stopped, harmless look-alikes let through. "Tests pass" with no test run after the last edit was caught 4 times out of 4.
- False alarms: the hooks wrongly sent back work in 4 of 12 real sessions before these fixes, 1 of 13 after. That last case is still being worked on.

How each test ran: [docs/test-results.md](docs/test-results.md).

## How it compares

Claude Code gives you hooks and skills. Here's what I built with them:

| | Claude Code with a few skills | With this setup |
|---|---|---|
| Its claims | Nothing checks them | Hooks check them against the log of what it did |
| Commands | It may ask you to run them | It runs them itself |
| Long chats | Compact (summarise themselves to free room) when nearly full, or by hand | Compact themselves at about 200k tokens, mid-work, and leave finished chats alone |
| Big jobs | Helpers you arrange | `/lead`: a numbered plan, helpers that know the goal, then reviewers sized to the job |
| Spending | `/usage`: the last 14 days | Per project, with a forecast of when you'll hit your limit |

## What it does

### Checks

A hook is a small script Claude Code runs before or after a step. It can read the tool-call log, compare it with the reply and stop the step. [hooks/link-gate.mjs](hooks/link-gate.mjs) is a short example. A helper, on this page, is a second Claude session that the main one starts to do one part of a job.

Sent back to the agent:

- a reply with a link it never actually opened
- "now run this in a terminal", when it could have run it itself
- a bigger change (10+ code files in a session, a job split across several helpers, or edits to hooks, settings or CI) that nobody reviewed
- a multiple-choice question to you that doesn't actually ask you anything

`DROP`, `TRUNCATE`, and `DELETE` or `UPDATE` without a `WHERE` ask you first.

All 51 hooks are listed in [docs/features.md](docs/features.md#hooks).

### Cost

- Reading a whole large file gets refused, so the agent reads just the part it needs. On my machine that happened 1,072 times in the last 30 days.
- Long chats compact themselves at about 200k tokens while they're still working, and finished chats are left alone. In one audit a compact cost about 44k tokens right after a reply and about 590k after a long pause, once Anthropic's saved copy of the chat (the cache) had expired.
- `usage` opens a dashboard of your token and plan use, week by week, how much of it came from this computer, and when you'll hit your plan limit. In Nimbalyst it's under the Usage icon (Full dashboard). It doesn't make any model calls.

### Long work

- After every reply a hook updates a short handoff note, so a fresh session can pick up where the old one stopped.
- When a session ends, it closes whatever it started (dev servers, watchers, background shells). It starts out in report mode, only logging what it would close, until you set `SESSION_CLEANUP=on`.
- When you start a session, it tells you which facts in your notes are past their `(recheck YYYY-MM-DD)` date (`RECHECK_DATES=off` turns that off).
- `/update-project` brings an older project folder up to date with the setup, and shows you every change first.
- I hand big jobs to `/lead`. It writes a numbered plan, gives each step to a helper that knows what the whole job is for, and has a reviewer helper check the result (2 or 3 reviewers on a big job, each taking its own part). A `blind-reviewer` looks at anything a person will see, the way a newcomer would.

### Systems map

Sessions and helpers start with the right files instead of hunting for them. Each project gets a map, built in the background, of its parts, what connects to what and which files to read first. A helper's brief and your own message get only the entries they name, so no session loads the whole map.

## What changes on day one

- Replies start with the answer, and every shell command ends with a short line saying what it does.
- The agent runs commands itself instead of asking you to paste them. The exceptions are passwords and decisions that are yours to make.
- Some replies get sent back, and the agent does the step it skipped.
- In Nimbalyst, every multiple-choice question has a box to type your own answer.
- On Windows, Nimbalyst updates through the setup instead of by itself, and the setup changes some of Nimbalyst's app files to add its fixes, so an update can't wipe them out. `node ~/.claude/tools/nimbalyst-patch/deliver.mjs --off` puts the original files back and lets Nimbalyst update itself again ([details](docs/features.md#updating-details)).
- If you haven't picked a model, it sets Claude Opus at medium effort. The planner and both reviewers run Fable, a stronger Claude model, at high effort, and any build or design request goes to the planner first. Nimbalyst's effort picker stops changing the level, so use `/effort` in the chat instead ([why](docs/features.md#install-details)).
- If you haven't set how long to keep transcripts, it keeps them for 120 days.
- Every 12 hours you might see a line saying there's a new version. Small fixes install themselves in the background (`AUTO_UPDATE=off` stops that); anything bigger waits for you to type `/update-setup`.

## Install and undo

You need Claude Code installed and signed in. It works best on a Max plan or higher. On the $20 Pro plan there's no Fable, so the Fable helpers run on Opus instead and go less deep. Nimbalyst is optional: without it the rules, hooks and skills all work, but you won't get the extensions or the session board. More in [docs/features.md](docs/features.md#install-details).

You may use the code and change your own copy, at home or at work, but not publish, share or sell it, changed or unchanged ([LICENSE](LICENSE)).

Download the ZIP or clone the repo into a folder that stays, then pick one option and run it in that folder. Both put in the setup files and Obscura, a headless browser for reading web pages, about 70 MB (`--obscura no` skips it).

**Option 1: everything, on a new computer.** Claude asks which subscriptions you have, then installs the missing programs (Nimbalyst, Node.js, Git, uv; Codex, ffmpeg or Handy if you want them; Homebrew on a Mac) and the setup files. You need only Claude Code. Claude follows [docs/full-install.md](docs/full-install.md); read it first to see every step.

```
claude "Read docs/full-install.md and carry out every step in it."
```

**Option 2: only the setup files.** You need Node.js 18 or newer (22.5+ for `steer --to` and `compact-self`). `--dry-run` shows what would change without changing anything.

```
node install.mjs --dry-run
node install.mjs
```

Your own hooks and skills are left alone. Any file the installer replaces is backed up to `~/.claude/setup-logs/<YYYY-MM-DD>-install-backup/`. If your `CLAUDE.md` already has rules of your own, they move to `~/.claude/rules/my-rules.md`, which Claude Code also loads in every session, and a copy of the old file is kept.

I run this on Windows. The tests pass on macOS too, but I haven't run the installer on a real Mac yet. If you're on a Mac, pass `--node "$(command -v node)"` so the hooks find Node by its full path. Linux is untested: the tests don't run there and the full install has no Linux steps.

To remove it:

```
node install.mjs --uninstall
```

This takes the setup's hooks out of `settings.json` and your project settings, removes its files (unless you changed them) and puts back any of your files it replaced. Your project work stays, and so do the plugins, the extensions and the permission, model and language settings; it prints how to remove each of those. It also puts Nimbalyst's original app files back, or if Nimbalyst is open, tells you the command to run after you close it.

Every hook can be turned off with an environment variable, like `LINK_GATE=off`. [docs/HOW-TO.md](docs/HOW-TO.md) walks through what to type and what you should see.

## How it works

`install.mjs` copies the hooks, agents, skills and workers into `~/.claude`. It writes the rules into `~/.claude/CLAUDE.md` and adds the hook wiring from `settings.example.json` to `~/.claude/settings.json`. It also sets up the starter project folders and, when Nimbalyst is there, builds the extensions and installs them into it.

After that, Claude Code does the work. It loads the rules into every session. It runs the hooks on its own events: a session starting or ending, your message arriving, before and after each tool call, before a compact, and when the agent finishes a reply. A hook reads the event and the session log, then lets the step through or sends a message back. A skill loads when you type its `/name` or ask for what it does. An agent starts when a session hands it a job. Workers are plain scripts that hooks and skills call.

The installer saves your answers and the version in `~/.claude/setup-state.json`. `/update-setup` reads them and runs the installer of a newer release, so you aren't asked again. A file you changed stays yours.

| Folder | What's in it | Who it's for |
|---|---|---|
| `agents/` | The planner, workers, reviewers and the stuck advisor, one file each | Claude Code sessions |
| `docs/` | How to use it, feature details, the install steps and the test results ([index](docs/README.md)) | Readers |
| `extensions/` | The Nimbalyst extensions (the agents list, session board tidying, command buttons, usage pop-up, systems map, Read Aloud, themes), built from source | Nimbalyst users |
| `hooks/` | The scripts Claude Code runs on its events, with shared code in `hooks/lib` | Claude Code |
| `projects/` | The starter project folders (`quick-tasks`, `claude-settings`) and the skills and hooks they share | People who use the starter projects |
| `promo/` | The source of the tour video and the clips in `docs/img`, drawn with Remotion | Whoever remakes the video |
| `rules/` | The rules file that becomes `~/.claude/CLAUDE.md`, which rules need Nimbalyst, and which versions shipped | Every session |
| `scripts/` | The installer's parts, the privacy scan and the commit title check | The installer and CI |
| `skills/` | The slash commands, such as `/lead`, `/backup` and `/update-setup`, one folder each | Claude Code sessions |
| `tests/` | One test file per part, run together by `tests/run-all.mjs` | Anyone changing their copy, and CI |
| `tools/` | `nimbalyst-patch`: the setup's fixes to Nimbalyst's app files, and Nimbalyst updates on Windows | Nimbalyst users |
| `workers/` | Scripts for jobs that run on their own: backups, version lookups, big downloads, disk tidying | Hooks and skills |

## What leaves your computer

Claude Code sends your work to Anthropic either way. On top of that, this setup sends:

| What | Where it goes | When | Off switch |
|---|---|---|---|
| Your saved Claude sign-in, to read your plan percentages | api.anthropic.com | At most every 5 minutes, during a session | `PLAN_USAGE_LOGGER=off` |
| A request for the latest version number | GitHub | Every 12 hours; an hour after a failed try | `UPDATE_CHECK=off` |
| The download of a small release (hook, skill, agent or worker files only; no restart, no question), installed in the background. Files you changed stay yours | GitHub | When one comes out | `AUTO_UPDATE=off` |
| Your project's files, read by the systems map's background worker (a Claude helper, about 60 tool calls per build or refresh) | Anthropic, like any Claude work | In a project with 100+ code files and no map: at most three tries a week apart, then a refresh at most once a week | `MAP_NUDGE=off` |
| Project and package names, when the agent looks up a version | endoflife.date, GitHub, npm, PyPI, crates.io, Docker Hub, Maven Central, NuGet | When it checks a version | None |
| Messages to and from your sessions | Telegram | Only if you add `/phone-bot` and run it | Don't run it |
| Your Claude folder and the project folders you pick, encrypted on your computer with a password only you have | Your own Backblaze B2 storage | Only if you set up `/backup`: when you ask, or daily or weekly | `/backup off` stops the schedule |

The web-reading tools in the starter projects only open the pages you ask for.

The installer also adds rules that stop Claude Code from reading saved sign-ins for Claude, Codex and Gemini, or your SSH keys, through its own tools, and makes it ask before opening a `.env` file. A script that reaches a file without naming it won't be stopped, and the rules only apply to Claude Code.

## Limits

- A check knows a page was opened, not what was on it. If the agent opens the page and still gets it wrong, that passes.
- If a hook hits an error, it lets the call through, so a broken check doesn't block anything. The guards are the exception (the secret scan before a push, the OpenCLI and planner read-only checks): they block the call instead. Either way the crash goes into `~/.claude/hooks/state/hook-errors.log` and the next session tells you (`HOOK_CRASH_ALARM=off` silences that).
- Not every rule has a check behind it. "Lead with the answer" is just text the model reads, and it can ignore it. The rules file adds about 4,600 tokens to every session.
- Checks are sometimes wrong, and a send-back can be a false alarm. I track those and fix the checks behind them.

## Everything else

Two starter projects, a planner, helpers with a set budget, a reviewer, a blind reviewer, an advisor for when a session gets stuck, a plan reviewer, the map for big projects, reading web pages and videos (`/watch` transcribes the audio when a video has no subtitles), encrypted backups (`/backup`), a phone bot, voice typing, Read Aloud and color themes are all covered in [docs/features.md](docs/features.md). What changed in each version is in [CHANGELOG.md](CHANGELOG.md).

## Tests

```
node tests/run-all.mjs
```

Each hook runs as its own process on made-up session logs, the installer runs twice on an empty home folder, and `scripts/privacy-check.mjs` scans the repo for home folder paths, email addresses and API keys. GitHub Actions runs all of it on Windows and macOS for every change to `main`, along with a lint, a type check of the extensions and the privacy scan.

The test files run in parallel, and a passing file prints one line. `--only a,b` runs just those files, `--failed` reruns whatever failed last time, and `--verbose` runs one file at a time with full output (that's what GitHub Actions uses).

The replay of the hooks on real sessions and the reviewer-against-plain-prompt test are in [docs/test-results.md](docs/test-results.md).

## Problems and contributing

- A bug, or a send-back you think was wrong: open an issue and pick the Bug report form.
- A security problem: report it privately, as [SECURITY.md](SECURITY.md) explains.
- Pull requests aren't accepted, because the licence doesn't allow sharing changed code. Describe a fix in an issue instead. [CONTRIBUTING.md](CONTRIBUTING.md) has the details.

## License

This isn't open source. You can use the code and change your own copy, at home or at work. You can't publish, share or sell it, or present it as your own, without my written permission. See [LICENSE](LICENSE).
