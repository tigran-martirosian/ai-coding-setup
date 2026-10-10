# AI coding setup for Claude Code, Codex and Gemini

The rules, checks and skills I run AI coding agents with for all my development. The checks compare what an agent says with the log of what it did: a reply that links a page it never opened is rejected, and so is "checked" with no lookup behind it. Claude Code writes the code; Codex (GPT) and Gemini do the searching and long reading.

Professionals in finance, data engineering and government IT installed it and use it at work.

https://github.com/user-attachments/assets/c92219e6-4d94-405c-bcb3-92eec42a687b

## What's new

**October 10, 2026** (versions 1.0.23 to 1.0.32). The setup now comes in Russian as well as English. `/update-setup` asks once which language you want, and `/update-setup russian` switches later; with Russian, Claude answers in Russian in every chat and the command buttons, the usage panel and the read-aloud controls show Russian text after one restart of Nimbalyst. Three rules came out of a week's `/full-review`. Tests and automation the agent runs to check its own work stay off your screen. Before it describes how one of your own projects or tools works, it opens that project's files. A helper that has used up its 25 turns is no longer sent on with a follow-up message, which had let one run reach 49 requests; a fresh helper gets what is left. The free Gemini worker now answers when a task names several files to read; it used to come back empty because it tried a shell command it is not allowed to run. An update is quiet now: `/update-setup` updates the files and stops there. It used to open the four project folders again and ask about a theme and voice typing on computers where those were set up long ago; only the first install does that now, and it leaves a Handy that is already installed alone. Three small additions that came from reading Matt Pocock's [skills](https://github.com/mattpocock/skills). The reviewer that `/lead` starts now reports what was asked for apart from quality: what is missing, what was built that nobody asked for and what looks wrong go under one heading, the build and layout checks under another. A handoff brief no longer carries a key, token or password, and it names the skills the next session should use. `/full-review` offers a correction you made twice as a hook when a script can check it, and as a rule only when it needs judgment. `/plan-first`, `/ask` and `/btw` now start only when you type them, so their descriptions no longer sit in every session. A new `/shared-usage` command is for a subscription that more than one person works on: it sets up [ccpool](https://github.com/hexxt-git/ccpool) on each person's computer and shows who used how much of the limits. Once it is set up, the pop-up behind the usage ring lists each person's share of the 5-hour and the weekly limit. A new `/phone-bot` command sets up a Telegram bot of your own on your computer. What you send it from the phone is saved in one folder that `/phone` reads in any session, a request you type can be handed to a Nimbalyst session after a tap on Send, and when a session asks a question with options the options arrive as buttons you can tap.

**October 8, 2026** (versions 1.0.18 to 1.0.22). A call that keeps failing the same way is now stopped: after three identical errors, a fourth try of the same call is refused and the agent has to change its approach or ask. The message for a shell command that is too long says what to do instead (save the script to a file, then run it with one short command). A new `/plan-first` command shows the plan for a big or vague request in a form and starts only after your yes. `/usage-report` gains a "Wasted requests" section, and `/project-scan` and `/new-project` check that a project says where its data lives and how to read it. The strong model now plans and a cheaper one builds: when a session on Opus or Fable starts a job of three or more edit steps, a new check, `build-nudge`, sends the next edit back once and has the agent write the plan as a brief for a Sonnet or Haiku helper, then check the result itself. In a week of measured use, turns like that were two thirds of the cost. A new `/full-review` command measures a week of work (usage, which model did what, slow and rushed turns, failed calls) and ends in a short list of options to tick. The move to a fresh chat now happens at 200k tokens instead of 250k. `/btw` no longer needs a second try when several sessions are open: it sends the note to the busy one, else the most recently active. `/full-review` run twice in one day keeps both sets of numbers, and says up front when the last review is too recent to measure anything. Before any design work the agent now opens one real reference (Component Gallery, Refero Styles or DESIGNmd) and says which one it used.

**October 7, 2026** (version 1.0.17). A hard plan can now be written by the strongest model without running the whole session on it. A new `planner` agent runs on Fable, reads the files and changes nothing; the main session asks it for the plan of a big or hard-to-undo piece of work and then carries the plan out with the cheaper helpers. The brief it gets holds your request in your own words, the situation and the decisions you made, and leaves out the main session's own idea of the answer, so the plan is a second view. The main session tells you where the two differ.

Earlier changes are in [CHANGELOG.md](CHANGELOG.md).


## Install

Needs Claude Code, installed and signed in. Download the ZIP or clone the repository, then in its folder:

```
claude "Read docs/full-install.md and carry out every step in it."
```

Claude Code asks which subscriptions you have (ChatGPT for Codex, Google AI for Gemini; both optional), then installs what is missing: Nimbalyst, Node.js, Git, uv, Handy, the Codex and Antigravity CLIs, the files below, the plugins and a few settings. The steps are in [docs/full-install.md](docs/full-install.md).

Without the programs, with Node.js 18 or newer:

```
node install.mjs --dry-run
node install.mjs
```

This copies `hooks`, `agents` and `skills` into `~/.claude`, wires the hooks into `~/.claude/settings.json`, writes `~/.claude/CLAUDE.md` if there is none, and creates four project folders under `~/Projects`. When Nimbalyst is installed it also builds the editor extensions (the themes, the usage ring, the command buttons) and puts them into Nimbalyst; `--extensions no` leaves them out. It installs four plugins when the `claude` command and Git are there (`claude-hud` on; `claude-code-setup`, `superpowers` and `context7` switched off until a project needs one; `--plugins no` leaves them out), sets the model to Sonnet if you never set one, and adds permission rules so the agent can't read saved sign-ins or SSH keys and asks before it reads a `.env` file. The settings inside Nimbalyst and voice typing need a chat: the run names them, and `/update-setup` carries them out once. A file it replaces is kept as `<name>.before-install-<date>`.

If you already have a Claude Code setup, yours stays. A hook or skill of yours with the same name as one of these is left as it is, and the run ends with the list of those files. `--replace <name>` takes my version of one, and `--replace-all` takes all of them and the rules, for when you want to start over. A run that changed something saves what it printed in `~/.claude/setup-logs`.

- **Without Nimbalyst:** the rules, hooks and skills work in plain Claude Code. The extensions, the session board and `/lead` need Nimbalyst, the editor I run Claude Code in. `question-other`, `command-explain` and `picture-in-project` are written for it too.
- **Mac:** I run the setup on Windows. The tests also run on macOS, but the full install has not been run on a real Mac, and Read Aloud is Windows only.
- **Afterwards:** [docs/HOW-TO.md](docs/HOW-TO.md) says what to type and what you should see.

## Updating

Every 12 hours the setup asks GitHub whether a newer version is released ([hooks/update-check.mjs](hooks/update-check.mjs)) and says so in one line. Nothing is downloaded until you type `/update-setup`. That runs [update.mjs](skills/update-setup/update.mjs): it downloads the release to `~/.claude/setup-source` and runs its installer with the answers you gave the first time.

![An update announced in one line, then installed with one command](docs/img/clip-update.gif)

- **Yours stays yours.** The installer only writes the setup's own files. Skills, hooks, settings and notes you added are not touched, and every replaced file is kept as `<name>.before-install-<date>`.
- **Rules.** A `~/.claude/CLAUDE.md` you never changed is brought up to date. One you changed is replaced only after you say yes.
- **Files of mine that you changed.** The same goes for a hook or a skill from this setup that you edited: it stays as you have it, the update lists it, and `/update-setup` asks whether you want the new version.
- **Without a chat:** `node ~/.claude/skills/update-setup/update.mjs`, or `--check` to only look.
- **Installed before version 1.0.0?** Download the repository once more and run the install again; from then on it updates itself.
- **Off switch:** set `UPDATE_CHECK=off` to stop the check.

## What's inside

| Part | What it does | Where |
|---|---|---|
| Rules | How the agent replies, asks, delegates and finishes work | [rules](rules) |
| Hooks | Scripts that check each step and can send it back | [hooks](hooks) |
| Skills | Commands for repeated jobs: `/court`, `/lead`, `/handoff`, `/btw`, `/setup-audit` and others | [skills](skills) |
| Starter projects | Four folders, each with its own rules and tools | [projects](projects) |
| Editor extensions | Usage pop-up, Read Aloud, a commands button and eleven colour themes for Nimbalyst | [extensions](extensions) |
| Worker agent | A cheaper subagent for routine edits | [agents](agents) |
| Planner agent | The strongest model writes the plan for big or hard-to-undo work, and changes nothing | [agents](agents) |
| Worker command | One short command for searching and long reading. It uses the first free worker that is set up and working (Codex, then Gemini through Antigravity), says which one answered, and hands the job back to Claude when none can | [workers](workers) |
| Installer | Puts the files in place and keeps a copy of what it replaces | [install.mjs](install.mjs) |
| Updater | Says when a newer version is out; `/update-setup` installs it and keeps your own files | [skills/update-setup](skills/update-setup) |
| Phone bot | `/phone-bot` sets up a Telegram bot of your own: it saves what you send from the phone, passes requests to sessions and shows their questions as buttons | [skills/phone-bot](skills/phone-bot) |
| Tour video | The Remotion source of the video above | [promo](promo) |

## Checks

![A command explained in plain words, a reply sent back, and two claims checked against the log](docs/img/clip-checks.gif)

Each check is a Node.js hook: a script Claude Code runs around a step, and that can send the step back. Claude Code logs every tool call in a session, and the first two hooks compare a reply with that log. If you read one file, read [hooks/link-gate.mjs](hooks/link-gate.mjs).

| Hook | What it sends back |
|---|---|
| `link-gate` | A reply with a link the agent remembered or saw in search results but never opened |
| `question-other` | A recommended option that says "Checked:" when no file read or search in the log matches it |
| `command-explain` | A shell command that doesn't end with a line in plain words saying what it does |
| `picture-in-project` | A picture shown in the chat from outside the open project, which Nimbalyst can't open enlarged |
| `run-yourself` | A reply that ends with "now open a terminal and run this"; the agent runs it itself |
| `opencli-readonly` | Posting, liking or following from my logged-in accounts through OpenCLI |

The other hooks keep sessions cheap and safe:

| Hook | What it does |
|---|---|
| `big-read-gate` | Large files are read in parts, not whole |
| `worker-nudge` | Sends searching to the first free worker that is ready (Codex, Gemini) |
| `loop-warn` | Tells the agent when it repeats the same call |
| `repeat-guard` | Refuses a retry of the same call after the same error came back three times, and reminds once when one file is edited six times or read four times in a turn |
| `build-nudge` | Reminds a main session on Opus or Fable, once per turn, to hand the building to a cheaper helper after three edit steps, and the gathering after four lookups in a row |
| `sql-guard` | Asks before DROP, TRUNCATE, or DELETE and UPDATE without WHERE |
| `context-guard` | Warns when a session gets long, and past 200k tokens moves the work to a fresh session |
| `handoff-brief` | Rewrites a brief after every reply, so a fresh session can continue |
| `board-nudge` | Offers a board cleanup when many sessions have piled up |
| `update-check` | Says, at most every 12 hours, when a newer version of the setup is released |
| `usage-dashboard-hook` | Typing just `usage` opens the usage dashboard |
| `plan-usage-logger` | Saves the plan percentages every 5 minutes for the forecast |

A hook that hits an error lets the call through. `link-gate` knows that a page was opened, not what it said.

## Three models

![A search handed to the first free worker, the court of three models, and a lead session with child sessions](docs/img/clip-models.gif)

Searching and long reading go to GPT and Gemini through their command-line tools, which run on my other subscriptions. Design and code stay with Claude. `worker-nudge` holds the agent to that: the first try at a search subagent is blocked and pointed at one command, [workers/ask.mjs](workers/ask.mjs). That command tries the workers in order (Codex, then Antigravity for local files; Codex for the web), skips one that is not installed, switched off or out of usage, prints which one answered and why another was skipped, and tells the agent to do the job itself when none can. So the setup works with either subscription, both or neither. I added it after `scripts/usage-scan.mjs`, which reads the session logs, showed single search subagents using 0.6 to 4.3 million tokens.

```mermaid
flowchart TD
  me["Me<br>task, rules, review"]
  hooks["Hooks<br>check each tool call"]
  main["Claude Code<br>main session"]
  ext["GPT (Codex CLI) and Gemini (Antigravity CLI)<br>search, long reading"]
  worker["worker subagent<br>routine edits"]
  me --> main
  hooks -.-> main
  main --> ext
  main --> worker
```

- **The court.** For a hard question I ask all three with [skills/court](skills/court/SKILL.md). Claude, GPT and Gemini each answer on their own, GPT and Gemini review the answers without knowing who wrote which, and a Claude chair writes the verdict. I read it and decide. For a piece of writing there is the reader court (`/court readers <file>`): a few readers with different jobs, say a recruiter, an engineer and an outsider, each read it alone and say how it lands with them.
- **The lead.** For a big task, [skills/lead](skills/lead/SKILL.md) splits the work across child sessions in Nimbalyst that run side by side, has a separate session review the result, sends the fixes back and reports what it checked.

The rules I give the models are described in [docs/setup.md](docs/setup.md).

## Sessions

![A note sent to a busy session, then an automatic handoff and a board cleanup](docs/img/clip-sessions.gif)

- **A note to a busy session.** Nimbalyst holds a new message until the running reply ends. With [skills/steer](skills/steer/steer.mjs), `/btw <note>` in a second chat leaves a note that the busy session reads before its next step, and `/ask <question>` answers a question about that session without touching its work.
- **Handoff.** Every step re-sends the whole conversation, so a long session gets expensive. `handoff-brief` rewrites a short brief after every reply, and `context-guard` warns at 150k tokens. When a reply ends past 200k, it has the agent move the work to a fresh session that starts from that brief, without asking, so the next message doesn't re-send the long history. `/handoff` does the same on request. The brief also lets the work go on in a GPT or Gemini session when the Claude plan runs out.
- **The board.** Nimbalyst shows every conversation as a card on a board, and Claude moves its own card from Planning to Complete as the work goes. `/board-cleanup` moves the finished ones that were left behind.

<details>
<summary>Screenshot of the board</summary>

![The session board in Nimbalyst](docs/img/board.png)

</details>

## Usage

![The usage pop-up with its forecast, then the dashboard with projects, models, days and chats](docs/img/clip-usage.gif)

- **The forecast.** [extensions/usage-plan](extensions/usage-plan/README.md) puts a ring on the editor's side bar with the week's usage. Its pop-up shows the weekly and 5-hour limits, the day and hour the week runs out at the current pace, and the daily budget that would make it last.
- **The dashboard.** Typing `usage` opens one HTML file built by [skills/usage-report](skills/usage-report/SKILL.md) from the logs on the computer, so opening it uses no tokens. It shows tokens by project, model, day and chat, the main chat apart from its subagents, the Codex and Gemini runs each chat started, what the same work would cost at API prices, and this computer's use apart from other use of the same account.

For the forecast, `plan-usage-logger` reads your saved Claude login, `~/.claude/.credentials.json`, and asks api.anthropic.com for the plan percentages.

<details>
<summary>Screenshot of the pop-up</summary>

<img src="docs/img/usage-panel.png" alt="The usage pop-up" width="274">

</details>

## Starter projects

![Four projects, a request sent to the right one, the picture skill, and the rule files](docs/img/clip-projects.gif)

The installer creates four project folders ([projects](projects)). A request that has nothing to do with the open project isn't worked on there: the agent names the project it belongs to and opens it.

| Project | For | Its own tools |
|---|---|---|
| `claude-settings` | Changing and checking the setup itself | `/setup-audit`, `/usage-report`, `/chat-review`, `/full-review` |
| `ask-anything` | General questions | The court, the picture skill, reading web pages and videos |
| `internet-search` | Finding things online | A finder skill with a fixed order, and its own link gate that accepts only pages that were opened |
| `quick-tasks` | One-off file jobs | A dated folder per job, work on copies, the picture skill |

With Codex installed, `ask-anything` and `quick-tasks` get the picture skill. It has Codex draw an illustration of how something looks or works from a reference photo and a few sourced facts, for example a flat front view of a workbench with its clamps in the right places. A hook shows the result only after it passes a written checklist.

## Rules

[rules/CLAUDE.md](rules/CLAUDE.md) is read in every session: lead with the answer, do the work yourself, ask one question with options when the choice matters, fix a repeated mistake in the rule that caused it. `/new-project` gives a folder its own `CLAUDE.md`, a `HANDOFF.md` (where the work stands) and a `DECISIONS.md`, and a decision I confirm is written there at once.

## Editor extensions

![The commands button starting a setup audit, and Read Aloud speaking a reply](docs/img/clip-commands.gif)

Four extensions for Nimbalyst. The first three are written in TypeScript and React; the themes are plain CSS and a small script.

- [usage-plan](extensions/usage-plan/README.md) is the ring and the pop-up from the usage section.
- [read-aloud](extensions/read-aloud/README.md) reads replies aloud with Kokoro, a voice model that runs on the computer. It cleans a reply for speech (no code, no Markdown), and a Python worker speaks it sentence by sentence.
- [commands](extensions/commands/README.md) puts seven commands behind one button on the side bar: board cleanup, next move, project scan, setup audit, usage report, new project and update setup. In the `claude-settings` folder it also shows chat review. A press starts a new session in the open project with that command.
- [ink-themes](extensions/ink-themes/README.md) adds eleven colour themes with their own fonts and rounder shapes, eight dark and three light, under one **Ink themes** row of the Theme menu.

![The eleven themes, one after another on the same window](docs/img/clip-themes.gif)

## Voice typing

![A key held while speaking, then the words typed into the chat box](docs/img/clip-voice.gif)

I speak most of my prompts. [Handy](https://handy.computer) types what I say where the cursor is: hold a key, talk, release. The speech model runs on the computer.

```
winget install --id cjpais.Handy -e
```

On a Mac: `brew install --cask handy`. The settings I use (on Windows the full install sets them):

| Setting | Value |
|---|---|
| Model | Parakeet V3 (`parakeet-tdt-0.6b-v3`, the 8-bit file), kept loaded |
| Shortcut | Hold Right Alt to talk |
| Output | Typed directly, with a space after it; the clipboard is left alone |
| Clean-up | Filler words removed, silence cut |
| Custom words | Names the model gets wrong: Nimbalyst, Claude, Codex, Gemini, handoff |
| Start | With Windows, hidden in the tray |

## Tests

```
node tests/run-all.mjs
```

Each hook runs as a separate process on made-up session logs. The court script runs without calling a model, the installer runs twice on an empty home folder, and `scripts/privacy-check.mjs` scans the repository for home folder paths, email addresses and API keys. GitHub Actions runs all of it on every push, on Windows and on macOS.

## License

All rights reserved. You may download it, use it and change your own installed copy, but not publish, distribute or sell it, and not present a changed version as mine. See [LICENSE](LICENSE).
