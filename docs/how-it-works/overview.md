# How the parts fit together

Most of Stratus is a set of files that Claude Code loads by itself: rules, hooks, agents and skills in `~/.claude`. There
is no service of its own that runs all the time, unless you add the phone app. This page says when each part acts, what each folder of the repository holds, what runs in the
background, and how Stratus is tested.

## When each part acts

- **The rules** load at the start of every session. They come from `~/.claude/CLAUDE.md`, which the installer
  writes from [rules/CLAUDE.md](../../rules/CLAUDE.md), and from your own `~/.claude/rules/my-rules.md`.
- **The hooks** run on Claude Code's events: a session starts or ends, you send a message, Claude calls a tool, a
  reply is about to go out. A hook reads the event and the session's log, then lets the step through or sends a
  message back to Claude. Most hooks run in groups, one Node.js process per group
  ([Checks and guards](../using/checks.md#when-a-hook-fails)). The [hooks reference](../reference/hooks.md) lists
  each hook with its off switch.
- **The skills** load when what you ask matches one, or when you type its name, such as `/lead`. The
  [skills reference](../reference/skills.md) lists them.
- **The helpers** are second Claude Code sessions that the main session starts for one part of a job: long
  reading, one step of a plan, a review. Each helper's file in `agents/` sets its model, its effort and its turn
  limit. [Big jobs](../using/big-jobs.md#which-helper-does-the-work) says which helper does what.
- **The extensions** run inside Nimbalyst, when you use it ([extensions reference](../reference/extensions.md)).

A few background scripts in `workers/` do long work outside the chat, such as backups, big downloads and saving a
web page in full.

## What each folder holds

| Folder | What is in it |
|---|---|
| `agents/` | The helpers, one file each: four workers, the plan reviewer, the end reviewer and the blind reviewer. |
| `docs/` | These pages. `docs/promo/` holds the source of the tour film, which renders into `docs/img/`. |
| `extensions/` | The Nimbalyst extensions, built from source by the installer. |
| `phone/` | The phone app: its page and the relay it talks to the PC through ([Phone app](../../phone/README.md)). |
| `hooks/` | The scripts Claude Code runs on its events. Shared code is in `hooks/lib/`, and the groups that run together are in `hooks/dispatch-groups.json`. |
| `rules/` | The rules file that becomes `~/.claude/CLAUDE.md`, the list of rules that need Nimbalyst, and a record of every rule Stratus has shipped, so the installer can tell its own rules from yours. |
| `scripts/` | The installer's parts, the privacy scan, the commit title check, and the Nimbalyst patch tools ([Nimbalyst patches](nimbalyst-patches.md)). |
| `skills/` | The skills, one folder each. |
| `templates/` | The two side-work folders the installer sets up (`quick-tasks`, `claude-settings`), and the skills and hooks they share. |
| `tests/` | One test file per part, run together by `tests/run-all.mjs`. |
| `workers/` | The background scripts, such as backups, version lookups, big downloads, disk and PC tidying, and page reads. |

`install.mjs` at the top runs the install ([What the install does](install.md)), and `settings.example.json` holds
the hook entries it adds to `~/.claude/settings.json`.

## What runs in the background

Some hooks start a short process that goes on after the hook returns, so the chat never waits for it. Each one
ends when its work is done:

- **The update check.** At most every 12 hours a hook asks GitHub for a newer release. A release that asks you
  nothing then installs itself in a separate process ([Install options and updates](../using/install-and-update.md#updates)).
- **The extension swap.** A new build of an extension waits in a side folder; a small process puts it into
  Nimbalyst when Nimbalyst closes. On Windows, a new Nimbalyst version is made ready the same way.
- **The plan usage reading.** At the end of a reply, at most every 5 minutes, a process asks Anthropic for your plan
  percentages ([Usage](../using/usage.md#where-the-percentages-come-from)).
- **The session cleanup** (Windows). When a session ends, a process lists what the session started, such as a dev
  server, and closes it when you set `SESSION_CLEANUP=on`.

Inside Nimbalyst, the Board Tidy extension archives old sessions a minute after Nimbalyst starts and then every hour.

Two add-ons that you turn on yourself run outside Claude Code:

- **The backup schedule.** `/backup schedule` adds a task to the system's scheduler (Task Scheduler, launchd or
  systemd) that backs up every day or every week.
- **The phone app's program.** On a Windows PC that joined the phone app, a program starts at log-on and stays
  running, so the phone can reach your sessions. `/phone-bot` stops it.

The [hooks reference](../reference/hooks.md) lists each hook's off switch, and `/backup off` stops the backup
schedule.

## One turn, step by step

Where a file lives decides what it affects: `~/.claude/` holds Stratus for every project, and
`<project>/.claude/` holds one project's own settings and rules.

1. **You send a message.** The `UserPromptSubmit` hooks run (`dispatch.mjs prompt`, which runs its group of hooks in one process, and the update check). Claude already has `~/.claude/CLAUDE.md`, `~/.claude/rules/my-rules.md` and the project's `CLAUDE.md` and `.claude/rules/`, which load when the session starts.
2. **Claude picks a skill.** A skill in `~/.claude/skills/` (or the project's `.claude/skills/`) loads when your message matches its description, or when you type its name.
3. **Claude calls a tool.** The `PreToolUse` hooks run first (`dispatch.mjs pre-tool` and a few hooks of their own); a guard refuses a risky call before it runs.
4. **The tool finishes.** The `PostToolUse` hooks run, and a note for the session can ride along with the result.
5. **Claude is about to end the reply.** The `Stop` hooks run (`dispatch.mjs stop`, then `link-gate`). Each gate that finds a problem, such as code edited with no test run, sends Claude back to fix it.

## Tests

```
node tests/run-all.mjs
```

Each test file runs with an empty home folder, as on GitHub's runners. The hook tests run each hook as its own
process on made-up session logs, and the install tests run the installer on an empty home folder.
`--only a,b`, `--failed`, `--changed` and `--verbose` are explained at the top of `tests/run-all.mjs`.

On every pull request, GitHub Actions runs the full suite on Windows and on macOS. It also runs a lint, a type check
of the TypeScript extensions, a key scan of the whole history, the privacy scan (home folder paths, email addresses
and keys), and a check that draws each changed page as GitHub shows it, light and dark, at desktop and phone width.

### Page proof in this repository

When you change your own copy of Stratus, an edited README, CHANGELOG or docs page needs fresh screenshots and a
PASS verdict from the `blind-reviewer` before the turn ends (`verify-gate`). The screenshots and the reviewer's
answer are saved in a `.proof/` folder, and the page gets one more fresh look after the fixes. The check exists
only in a repository that holds `scripts/render-check.mjs`; in your other projects, editing a page asks for
nothing.
