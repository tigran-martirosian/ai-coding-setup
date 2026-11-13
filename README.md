# AI coding setup for Claude Code

I run all my development through Claude Code. These are the rules, checks and tools I built around it. The checks compare what the agent says with the log of what it did, and send the reply back to the agent when the two don't match.

Professionals in finance, data engineering and government IT installed it and use it at work.

https://github.com/user-attachments/assets/76e2dfca-ad85-480f-b1ab-b0b98fbc1a56

If the video doesn't show, for example in the GitHub app, [watch it here](https://github.com/user-attachments/assets/76e2dfca-ad85-480f-b1ab-b0b98fbc1a56).

## How it compares

Claude Code gives you hooks and skills. This is what I built with them.

| | Claude Code with a few skills | With this setup |
|---|---|---|
| Its claims | Nothing checks them | Hooks compare them with the log of what it did |
| Commands | It may ask you to run them | It runs them itself |
| Long chats | Compact when nearly full, or by hand | Compact themselves at about 200k, mid-work, and leave finished chats alone |
| Big jobs | Subagents you arrange | `/lead`: a plan in numbered steps, workers that know the goal, then one reviewer |
| Spending | `/usage`: the last 7 days | Per project, with a forecast of when the limit runs out |

## What it does

### Checks

Claude Code logs every tool call. A hook is a small script that runs before or after a step. It can read that log, compare it with the reply and stop the step. [hooks/link-gate.mjs](hooks/link-gate.mjs) is a good first example.

These go back to the agent:

- a reply with a link it never opened
- "now run this in a terminal", when it can run that itself
- a bigger change (10 or more code files over a session, a job of several helpers, or hooks, settings or CI files) that ends with no reviewer agent having looked at it
- a recommended answer in a question that no second agent has checked

`DROP`, `TRUNCATE`, and `DELETE` or `UPDATE` without `WHERE` ask you first.

In 30 days on my computer, 360 of 11,042 replies were sent back. All 28 hooks are listed in [docs/features.md](docs/features.md#hooks).

### Cost

- A hook refuses a read of a whole large file, so the agent reads the part it needs. It refused 607 in those 30 days.
- A long chat compacts itself at about 200k, while it works, and a finished chat is left alone. In one audit a compact cost about 44k tokens with a warm cache; after a long pause, when the cache has expired, about 590k.
- Typing `usage` opens a dashboard with this week's token use and a forecast for your plan limit. It makes no model call.

### Long work

- A hook rewrites a short handoff note after every reply, so a fresh session can start from it.
- I hand big jobs to `/lead`. It writes a numbered plan, hands each step to a worker agent that knows the goal of the whole job, and one reviewer agent checks the result.

### Systems map

In a project with 100 or more code files, the setup builds a map of it by itself, in the background. The map is a dictionary of the project's parts and what connects to what. A helper's brief gets only the lines for the parts it touches, so no session hunts for files or loads a whole graph.

## What changes on day one

- Replies lead with the answer, and shell commands end with a line saying what they do in plain words.
- The agent runs commands itself instead of asking you to paste them, except for passwords and decisions that are yours.
- Some replies are sent back, and the agent does the missing step first.
- In Nimbalyst, a choice question always has a box for your own answer.
- If you have set no model, it sets Opus at medium effort. A build or design request goes to the `planner` agent first, in every project.
- If you have set no time for keeping transcripts, it keeps them 120 days.
- Every 12 hours you may see one line saying a newer version is out. Nothing downloads until you type `/update-setup`.

## Install and undo

You need Claude Code, installed and signed in. Nimbalyst and other subscriptions are optional: without Nimbalyst the rules, hooks and skills still work, and the extensions and the session board don't. `/lead` runs its steps as subagents, but keeps its job card in Nimbalyst's tracker. Download the ZIP or clone the repository, then in its folder:

```
claude "Read docs/full-install.md and carry out every step in it."
```

It asks which subscriptions you have, then installs what is missing. For only the setup files, with Node.js 18 or newer (22.5 or newer for `steer --to` and `compact-self`; Claude Code's own compact needs nothing):

```
node install.mjs --dry-run
node install.mjs
```

`--dry-run` prints what would change and changes nothing. Your own hooks and skills stay as they are, and a file the installer replaces is kept as `<name>.before-install-<date>`. If your `CLAUDE.md` already has your own rules, it stays and the rules here are not added until you pass `--replace-rules`.

```
node install.mjs --uninstall
```

This takes the setup's hooks out of `settings.json` and the project folders' settings, removes its files unless you changed them, and restores files of yours that the installer replaced. Your work in the project folders stays, and so do the plugins, the extensions and the setup's permission, model and language settings. The run prints how to remove each.

Every hook in `hooks/` has an off switch, an environment variable set in your shell or system, such as `LINK_GATE=off`. [docs/HOW-TO.md](docs/HOW-TO.md) says what to type and what you should see.

## What leaves your computer

Claude Code itself sends your work to Anthropic, as it does without this setup. On top of that:

| What | Where it goes | When | Off switch |
|---|---|---|---|
| Your saved Claude sign-in, to read your plan percentages | api.anthropic.com | At most every 5 minutes, during a session | `PLAN_USAGE_LOGGER=off` |
| A request for the latest version number | GitHub | Every 12 hours | `UPDATE_CHECK=off` |
| Project and package names, when the agent looks up a version | endoflife.date, GitHub, npm, PyPI, crates.io, Docker Hub, Maven Central, NuGet | When it checks a version | None |
| Files the agent gives a free worker | Codex or Gemini | Only if you set them up | Don't set them up |
| Messages to and from your sessions | Telegram | Only if you add `/phone-bot` and run it | Don't run it |
| Your name, token counts, model and limit percentages | ccpool.hexxt.dev, someone else's server | Only if you add and set up `/shared-usage` | Don't set it up |

The tools in the starter projects that read web pages open the pages you ask for.

The installer adds rules that stop Claude Code reading saved sign-ins for Claude, Codex and Gemini, or SSH keys, through its own tools, and that ask before a `.env` file. A script that reaches a file without naming it is not stopped. These rules bind Claude Code only: if you set up Gemini, its own rules let it read your projects folder and the setup's hooks, skills and agents. It can't read web pages or the rest of `~/.claude`.

## Limits

- A check knows a page was opened, not what it said. An agent that opens the page and still gets it wrong passes.
- A hook that hits an error lets the call through, so a broken check stops nothing.
- Only some rules have a check behind them. "Lead with the answer" is text the model reads and can ignore. The rules file adds about 4,700 tokens to every session.
- Checks are sometimes wrong: a send-back can be a false alarm. I measure that and fix the checks that cause it.

## Everything else

Asking three models the same hard question (`/court`), four starter projects, a planner agent, capped worker agents, a reviewer, a checker for recommended answers, a map of big projects, reading videos (`/watch`), a phone bot, voice typing, Read Aloud and colour themes are in [docs/features.md](docs/features.md). Changes per version are in [CHANGELOG.md](CHANGELOG.md).

## Tests

```
node tests/run-all.mjs
```

Each hook runs as a separate process on made-up session logs, the installer runs twice on an empty home folder, and `scripts/privacy-check.mjs` scans the repository for home folder paths, email addresses and API keys. GitHub Actions runs all of it on every push, on Windows and on macOS.

## License

This is not open source. You may use this code and change your own copy, at home or at work. You may not publish, share or sell it, or present it as your own, without my written permission. See [LICENSE](LICENSE).
