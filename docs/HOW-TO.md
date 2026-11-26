# Using Stratus

This page lists what to type for the common tasks and what you should see. Each section links to a page with the
details. For a first walk through Stratus, read [Getting started](getting-started.md).

A command that starts with `/` is typed as the first thing in a message. Everything else is plain words: say what
you need, and Claude picks the skill that fits. Five commands run only when you type them: `/btw`, `/next-move`,
`/board-cleanup`, `/design-system` and `/untangle-codebase`. Every command and skill is listed in the
[skills reference](reference/skills.md).

`<projects>` below stands for the folder your project folders are in (`Projects` in your home folder unless you
chose another). The copy of this page that the installer puts into `<projects>/claude-settings` names the real
folder.

A command marked **(Nimbalyst)** works only inside the Nimbalyst app, and one marked **(Windows)** only on Windows.
Everything else also works in Claude Code in a terminal. [Platforms](reference/platforms.md) lists the differences.

## Day to day

- **Ask in plain words.** Claude sizes the request (small, medium or big) in one line, then works. A big request
  gets questions and a plan first.
- **Read the `# WHAT THIS DOES:` line** in each permission popup before you allow a command.
- **Answer question cards.** Type your own answer in the **Other** box when no option fits.
- **Act on "Needs you"** at the end of a reply: it is your to-do list.
- **`/btw <note>`** in a second chat adds a note to a busy session without stopping it.
- **`/handoff`** moves a long chat to a fresh one that starts from a short brief. In Nimbalyst it opens the new
  session itself; in a terminal it gives you the prompt to paste into a new session.

More: [Everyday work](using/everyday-work.md).

## Big jobs

- **Describe the job.** Claude asks its questions, writes a spec and a plan, and asks for one OK.
- **`/lead`** starts that flow for a job you already know is big.
- **"Get a second opinion on this"** has a capped helper read a design or plan and answer.

More: [Big jobs](using/big-jobs.md).

## Your projects

- **`/new-project`** sets up a new project folder: notes, a decisions record and rules.
- **`/update-project`** brings a folder you set up earlier up to the current setup. Every change is shown first.
- **`/where-are-we`** (Nimbalyst) brings a job's steps up to date in Nimbalyst's tracker.
- **`/next-move`** names the one most useful thing to do next. It reads your goals from `~/.claude/goals.md`; the
  first time, it asks you for them and saves that file.
- **`/file-upkeep`** renames and moves misplaced files after your yes, and can undo it.
- **`/untangle-codebase`** reorganises a tangled codebase in one pass, so later changes need less reading.

More: [Projects](using/projects.md) and [The systems map](using/systems-map.md).

## Checks and security

- **Hooks** send a step back when, for example, a reply links a page Claude never opened, or a turn edits code
  and runs no test. A hook refuses dangerous deletes and asks before risky SQL.
- **`/security`** runs a quick check of a change; **`/security deep`** scans a whole project once.

- **A hook in your way** can be switched off: [Turn a hook off](#turn-a-hook-off), at the end of this page.

More: [Checks](using/checks.md) and [Security](using/security.md).

## Usage

- **`usage`** (the single word) opens the usage dashboard in your browser, at no token cost. Inside Nimbalyst it
  refreshes the data and says where to click.
- **"Will I run out?"** gives the forecast as a few lines in the chat.
- **`/usage`** is Claude Code's own command: where the tokens went in the last 24 hours and 7 days.

More: [Usage](using/usage.md).

## Side work

- **`<projects>/quick-tasks`** is for questions, finding things online and one-off file jobs.
- **`<projects>/claude-settings`** is for changing and checking Stratus itself, with `/setup-audit`.
- **`/watch <link or file> <question>`** answers a question about a video.

More: [The side-work folders](using/side-work-folders.md) and [Web pages and videos](using/web-and-video.md).

## Housekeeping

- **`/board-cleanup`** (Nimbalyst) tidies Nimbalyst's Sessions board: finished sessions move to Complete, old ones
  are archived.
- **`/disk-tidy`** reports what fills the disk and removes only what you tick.
- **`/pc-tidy`** (Windows) shows what holds the computer's memory and stops what finished sessions left behind.
- **`/backup`** keeps an encrypted copy of your setup and projects in your own cloud storage.

More: [Housekeeping](using/housekeeping.md).

## Nimbalyst, design, voice and phone

- **The Commands button** (Nimbalyst) in the left sidebar starts the common commands in a new chat.
- **`/gridlines`** lines up an interface's edges; **`/design-system`** keeps a project's look in one file.
- **Voice typing**: hold a key, speak, release.
- **The phone app** (Nimbalyst) shows your Nimbalyst sessions in Telegram.

More: [Nimbalyst](using/nimbalyst.md), [Design](using/design.md) and [Voice and phone](using/voice-and-phone.md).

## Install options and updates

- **`node install.mjs --dry-run`** shows what an install would change. The flags are on
  [Install options and updates](using/install-and-update.md).
- **Updates** install themselves when they ask you nothing. One that needs you waits for `/update-setup`.

## Turn a hook off

Each hook has an off switch: an environment variable named after the hook, set to `off`. `LINK_GATE=off` turns
off `link-gate`. The [hooks reference](reference/hooks.md) lists every switch. Set the variable where Claude Code
or Nimbalyst starts, then start a new session:

- **Git Bash, or a terminal on macOS or Linux, for one session:** run `export LINK_GATE=off`, then start `claude`
  in that same terminal. To keep it, add the same line to `~/.bashrc` (Git Bash) or `~/.zshrc` (macOS).
- **Windows, for every program you start from now on:** run `setx LINK_GATE off`, then close and reopen your
  terminal or Nimbalyst. To turn the hook on again: `reg delete HKCU\Environment /v LINK_GATE /f`.
- **Nimbalyst on macOS:** an app opened from the Dock does not read `~/.zshrc`. Run `launchctl setenv LINK_GATE off`
  and reopen Nimbalyst; the value lasts until you restart the Mac.
- **One project only:** add an `env` block to the project's `.claude/settings.local.json`, which stays out of the
  repository (`.claude/settings.json` works too, for a switch the whole team shares):

  ```json
  {
    "env": { "VERIFY_GATE": "off" }
  }
  ```

  Only a few switches are read from a settings file; the others work only from the environment. Which ones, and
  from which files: [Turning a hook off](reference/hooks.md#turning-a-hook-off).

  A switch is mostly the hook's name in capitals, but not always (`usage-dashboard-hook` uses `USAGE_DASHBOARD`).
  The [hooks reference](reference/hooks.md#all-hooks) gives each one.

## When something goes wrong

- **A hook crashed.** A hook that fails lets the call through and writes one line to
  `~/.claude/hooks/state/hook-errors.log`, and the next session names it. A guard refuses the calls it checks
  instead.
- **A hook gets in the way.** Turn that one hook off with its switch ([Turn a hook off](#turn-a-hook-off)).
  `DISPATCH=off`, set in the environment the same way, turns off at once the 18 hooks the dispatcher runs, the
  guards included. The other hooks keep running; the [hooks reference](reference/hooks.md#all-hooks) shows which.
- **Nimbalyst after a patch (Windows).** `node ~/.claude/scripts/nimbalyst-patch/deliver.mjs --off` stops Stratus
  from delivering Nimbalyst versions and puts the original app files back, so Nimbalyst updates itself again;
  `--on` turns the delivery on again. `node ~/.claude/scripts/nimbalyst-patch/patch.mjs --restore` only puts the
  original `app.asar` back. [Nimbalyst patches](how-it-works/nimbalyst-patches.md) says more.
- **An update says `Download <the repository> and run its install once.`** The folder you installed from is gone
  or moved. Download the repository again into a folder that stays and run `node install.mjs` there once; your
  answers are on record ([Keep the folder you installed from](how-it-works/install.md#keep-the-folder-you-installed-from)).
