# Install options and updates

This page covers the installer's options, what happens to files you already have, and how updates reach you. The
exact settings and folders the install changes are listed in [Install changes](../reference/install-changes.md),
and the programs each feature needs in [Dependencies](../reference/dependencies.md).
[What the install does](../how-it-works/install.md) follows one run from start to end.

## Installing

You need Node.js 18 or newer and Claude Code. Download the repository as a zip from its GitHub page (the green
**Code** button, then **Download ZIP**) and unzip it, or clone it. Put it in a folder you keep until the first
update has run ([why](../how-it-works/install.md#keep-the-folder-you-installed-from)). Open a terminal in that
folder.

```
node install.mjs --dry-run
```

On a Mac, add `--node "$(command -v node)"` to this command and the next one, so the hooks also find Node.js when
you open Nimbalyst from the Dock.

You should see one line for every file it would copy, every hook it would add, the rules file, the two project
folders and their settings, and `Nothing was changed.` as the last line.

```
node install.mjs
```

You should see the same lines without `[dry run]`, ending with `Done. Restart Claude Code so it loads the hooks.`
Run it a second time and every file line says `unchanged`, `kept` or `already wired`.

To have Claude install the optional programs too (Nimbalyst, voice typing and the tools some skills use), on
Windows or a Mac, follow [the full install](../full-install.md) instead.

The features that read Nimbalyst's database, such as notes between Nimbalyst sessions (`/btw`) and Board Tidy,
need Node.js 22.5 or newer; [Dependencies](../reference/dependencies.md) lists them all. With an older Node.js the
installer names them and leaves them off; everything else runs on Node.js 18.

Codex (OpenAI's coding tool, part of a paid ChatGPT plan) is optional. Without it the `picture` skill is left out,
and product, shop and price searches in the `quick-tasks` folder use the `web-research` skill instead of the
`finder` skill, which runs its searches through Codex.

## Terminal only, without Nimbalyst

Nimbalyst is optional. `node install.mjs` already works without it: with no Nimbalyst on the computer, the installer
builds no extensions and sets no theme, and it asks nothing about them. If Nimbalyst is installed but you don't want
the extensions and the theme, run `node install.mjs --extensions no --no-theme`. [The full install](../full-install.md)
installs Nimbalyst, so for a terminal-only setup use the commands above instead. What differs in a terminal is in
[Windows and macOS](../reference/platforms.md#terminal-claude-code-and-nimbalyst).

## What the install sets up

- **Files.** The hooks, agents and skills go into `~/.claude`, and the hooks are added to
  `~/.claude/settings.json`.
- **Rules.** `~/.claude/CLAUDE.md` is written whole with Stratus's rules. Rules you had written there move to
  `~/.claude/rules/my-rules.md`, which Claude Code also loads in every session.
- **Two side-work folders** under your projects folder: `quick-tasks` and `claude-settings`
  ([The side-work folders](side-work-folders.md)). Other folders already there, such as your own projects, are not
  touched; `--projects <folder>` puts the two somewhere else.
- **Plugins**, when the `claude` command and Git are there: `claude-hud` (a status line), Anthropic's
  `security-guidance` (security reviews as Claude edits and commits), the design tools `frontend-design` and
  `impeccable`, and the `find-skills` skill. None of the five is Stratus's own: `security-guidance` and
  `frontend-design` come from Anthropic (`anthropics/claude-plugins-official`), the other three from third-party
  GitHub repositories (`jarrodwatts/claude-hud`, `pbakaus/impeccable`, and `vercel-labs/skills` through `npx`);
  `--plugins no` skips them all. `security-guidance` needs Python 3.10 or newer; without it the run says it was
  left off, and the next run or update tries again.
- **Nimbalyst extensions**, when Nimbalyst is installed ([Nimbalyst](nimbalyst.md)).
- **A model**, if you never set one: Opus at medium effort.
- **Permission rules**, so Claude can't read saved sign-ins or SSH keys and asks before it reads a `.env` file.

Some steps need a chat, such as Nimbalyst's own settings and voice typing. `node install.mjs` names them on the
first run. You don't need to read those steps yourself: open the `claude-settings` folder in Nimbalyst and, in a new
chat, type `Carry out steps 8 and 9 of <the folder you installed from>/docs/full-install.md.` Claude makes the
settings and asks you the few questions they need ([the full install](../full-install.md) has the steps). Later
updates never repeat them.

## Files you already have

Nothing of yours is lost:

- A file the installer replaces is kept, as it was, in `~/.claude/setup-logs/<YYYY-MM-DD>-install-backup/`, never
  next to the new one.
- A hook or skill of yours with the same name as one of Stratus's stays as it is. So does a Stratus file you
  changed after installing. The run ends with a `Kept as yours` list of those files.
- The notes files you fill in (`profile.md`, `finds/INDEX.md`) are written only when they are missing.
  `claude-settings/how-to.md` is renewed only while you have not edited it. The `CLAUDE.md` in `quick-tasks` and in
  `claude-settings` is brought up to the current version, with your own additions moved to `.claude/rules/my-rules.md`.
- A run that changed something saves what it printed in `~/.claude/setup-logs`, and names any hook in your
  settings whose script is not there.

The installer saves the folder you ran it from as `repo` in `~/.claude/setup-state.json`, so a chat can find it
again.

## Installer options

| Option | What it does |
|---|---|
| `--dry-run` | Prints what the run would do and changes nothing. |
| `--projects <folder>` | Where the two side-work folders go. The default is `Projects` in your home folder; a folder given once is remembered. |
| `--codex yes` or `no` | Whether Codex is used, for the picture skill and the `finder` searches in `quick-tasks`. Without the option, the installer uses the answer given before, or looks for `codex` on the PATH. |
| `--plugins no` | Leaves the plugins out. A plugin you removed stays removed on later runs. |
| `--extensions no` | Leaves the Nimbalyst extensions out. |
| `--with <names>` | Adds the add-ons a default install leaves out: `phone-bot`, `read-aloud`, or both, comma-separated. A copy already in place keeps being updated by a plain run. |
| `--leave-out "<lead>"` | Leaves one of Stratus's rules out of `~/.claude/CLAUDE.md`, on this run and later ones. The lead is the rule's bold opening. `--put-back "<lead>"` brings it back. |
| `--replace <file>` | Takes Stratus's version of one file from the `Kept as yours` list, for example `--replace hooks/sql-guard.mjs`. You can give it several times. |
| `--replace-all` | Takes Stratus's version of every file on that list, for a computer whose old setup you don't want to keep. |
| `--language english` or `russian` | The language Claude answers in. It is kept for later runs. |
| `--handy yes` or `no` | Records your answer about voice typing with Handy. The installer neither installs nor removes Handy; it keeps the answer for later runs. |
| `--backup yes` or `no` | Records your answer about the encrypted backup. A yes is set up by `/backup` afterwards; the installer sets up no backup itself. |
| `--no-theme` | Leaves Nimbalyst's theme alone. |
| `--node <file>` | Starts the hooks with this Node.js by its full path, for a Mac where an app opened from the Dock has no Node.js on its PATH. |
| `--uninstall` | Takes Stratus out again (see below). |

## Claude Code version and plan

The installer updates Claude Code to the newest version and stops if it stays below 2.1.321.

Three helpers run Fable, Anthropic's largest model: the plan reviewer, the end reviewer and the helper for long
refactors. Workers that read charts, do science or maths, or do web research that needs judgement run Fable too.
A Max plan or higher works best. The
installer reads your plan from Claude Code's account file (`~/.claude.json`): on the $20 Pro plan, which has no
Fable, it writes Opus wherever Stratus's agents and rules name Fable. When you move from Pro to a larger plan, run
`/update-setup` (or `node install.mjs` again) and the helpers go back to Fable.

Without a Claude plan, for example with an API key, Amazon Bedrock or Google Vertex AI, the installer finds no plan
in that file and leaves the helpers on Fable, so your account needs access to Fable. The plan usage forecast stays
empty, because it reads a Claude sign-in; with none, `plan-usage-logger` makes no call.

[Big jobs](big-jobs.md#which-helper-does-the-work) lists which helper runs on which model.

## Updates

Every 12 hours Stratus asks GitHub whether a newer version is released. When one is, a grey line in the chat
says so: about every 8 hours while an important release waits (with a few bullets on what it brings, about once a
day), and at most once a day for small ones.

- **A release that asks you nothing installs itself** in the background, keeping any file you changed. One grey
  line says so afterwards. Changed Nimbalyst panels go in only while Nimbalyst is closed, so they show the next
  time it starts; on a Mac, type `/update-setup` when the grey line asks.
- **A release that needs you** (a new question, a step only a chat can do, or a newer Claude Code) waits until you
  type `/update-setup`. It downloads the release to `~/.claude/setup-source` and runs its installer with the answers
  you gave the first time.
- **Without a chat:** `node ~/.claude/skills/update-setup/update.mjs`, or add `--check` to only look.
- **With no network**, the check waits under a second, writes why it failed into `~/.claude/update-check.json`, and
  tries again after an hour.
- **Claude Code itself** is not updated in the background.
- **What is checked.** An update is the release's source archive (`v<version>.tar.gz`), downloaded over HTTPS from
  the repository's GitHub page. Stratus checks no checksum or signature on it. To read each release before it runs,
  set `AUTO_UPDATE=off`; then every update waits for `/update-setup`.

![An update announced in one line, then installed with one command](../img/clip-update.gif)

### What an update keeps

- Skills, hooks, settings and notes you added are not touched.
- `~/.claude/CLAUDE.md` is written whole with the new rules, and a dated copy of the old file is kept. Your own
  rules stay in `~/.claude/rules/my-rules.md`; `/update-setup` can offer to tidy that file so it repeats nothing
  Stratus already does.
- A Stratus hook or skill that you edited stays as you have it. The update lists it and asks whether you want the
  new version.

### What an update also does

- It clears Stratus's own leftovers (worktrees and chat logs from its test runs, its cache and temp folders) and
  says how much it freed.
- It offers, on one question card (a small form in the chat with options to pick), to clear your own leftovers (`/disk-tidy`) and to reorganise your project files
  by the file standard (`/file-upkeep`). The first time, the card also offers the chat archive and asks whether you
  want the encrypted backup, with no answer marked as recommended. "Not now" leaves each for any time you type the
  command. See [Housekeeping](housekeeping.md).
- On Windows it also updates Nimbalyst (next section).

### Nimbalyst updates on Windows

On Windows, Nimbalyst updates through Stratus instead of by itself. Stratus delivers the Nimbalyst
version it names (its pinned version) with a few fixes applied to its app files, and switches off Nimbalyst's own updater so the fixes are not
overwritten. [Nimbalyst patches](../how-it-works/nimbalyst-patches.md) lists each fix and the scripts that deliver
them.

- After an update, `/update-setup` gets the new Nimbalyst version ready. It goes in when Nimbalyst closes, or at once
  when you pick the restart on the question card it shows.
- A failed delivery opens Nimbalyst again, and the next `/update-setup` tries again.
- `node ~/.claude/scripts/nimbalyst-patch/deliver.mjs --off` (or `NIMBALYST_FOLLOW=off`) stops the delivery, and
  `--on` starts it again. `--off` also puts Nimbalyst's original app files back (at once if Nimbalyst is closed,
  otherwise when it next closes), so Nimbalyst updates itself again.

Nimbalyst's chats are also pointed at your own Claude Code instead of the copy Nimbalyst bundles, so they get
Claude Code fixes on the day they ship. This happens only within the version series Nimbalyst ships (the same first
two numbers, for example 2.1.x). When your Claude Code is in a newer series, Nimbalyst keeps its own copy until a
Nimbalyst release ships that series.
`SETUP_NIMBALYST_CLAUDE=off` leaves Nimbalyst on its own copy.

### Turning updates off

| Setting | Effect |
|---|---|
| `UPDATE_CHECK=off` | Stops the check. `/update-setup` still works. |
| `AUTO_UPDATE=off` | Stops only the background install; every update waits for `/update-setup`. |
| `NIMBALYST_FOLLOW=off` | Neither the background install nor `/update-setup` updates Nimbalyst on Windows any more. |

Set them in your shell or system environment. `AUTO_UPDATE` and `NIMBALYST_FOLLOW` are also read from the `env`
section of `~/.claude/settings.json`.

## Removing Stratus

If you joined the phone app, first stop its program on your PC and remove its start at log-on:
`node ~/.claude/skills/phone-bot/pc/setup.mjs remove`. The uninstall does not do this. Then:

```
node install.mjs --uninstall
```

This takes Stratus's hooks out of `~/.claude/settings.json` and your project settings, removes its files (unless
you changed them), puts back any of your files it replaced, deletes the downloaded versions in
`~/.claude/setup-source`, and puts Nimbalyst's original app files back. With Nimbalyst open, it prints the command to
run after you close it. The side-work folders, plugins and extensions stay; the run says how to remove them. Add
`--dry-run` to see what it would do first. [What `--uninstall` leaves](../how-it-works/install.md#what---uninstall-leaves)
lists each kept item with its remove command.

## Upgrading from an older install

- **Installed before version 1.0.0?** Download the repository once more and run the install again. From then on it
  updates itself.
- **The `ask-anything` and `internet-search` folders.** Older installs had these two side-work folders. An update
  copies their profile, finds and saved answers into `quick-tasks` (where it has none yet) and leaves the old folders
  with all their files and chats. Delete them when you no longer need them.
- **`quick-tasks` on Sonnet.** An older install had `quick-tasks` on Sonnet; an update moves it to Opus once and says
  so. To keep Sonnet there, type `/update-setup --keep-home-model`; your global model is not touched.
