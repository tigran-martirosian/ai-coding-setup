# What the install does

This page follows one run of `node install.mjs` from start to end, and then one run of `node install.mjs
--uninstall`. Each settings key, folder and plugin the install changes is listed once, with what the uninstall
does to it, in [What the install changes](../reference/install-changes.md). The installer's options and how
updates reach you are in [Install options and updates](../using/install-and-update.md). The procedure Claude
follows to set up a whole new computer, programs included, is [the full install](../full-install.md).

The repository and its download are named `ai-coding-setup`; Stratus is the name of what it installs. The same
name marks Stratus's Nimbalyst data on Windows, in `%LOCALAPPDATA%\ai-coding-setup\nimbalyst`.

## Before anything is written

The installer first reads `~/.claude/setup-state.json`, the record an earlier run left. That record holds your
answers (the projects folder, Codex, the language, voice typing, the backup), so a second run and every update ask
nothing again.

Then it checks what it runs on:

- **Node.js.** Node.js 18 or newer runs everything. The features that read Nimbalyst's database need Node.js 22.5
  or newer ([Dependencies](../reference/dependencies.md) lists them); with an older Node.js the run names them and
  leaves them off.
- **Claude Code.** When npm has a newer Claude Code, the installer updates it. When Claude Code stays below the
  version Stratus needs, the run stops here and changes nothing.
- **Your settings.** When `~/.claude/settings.json` can't be read, the run stops before it copies a file.

## The files and the rules

The installer copies the hooks, agents, skills and helper scripts into `~/.claude`, and merges the hook entries
from `settings.example.json` into `~/.claude/settings.json`. It then writes the Claude Code settings it needs, such
as a default model when you have none. Each of these settings is a row on the reference page.

Next it writes the rules file, `~/.claude/CLAUDE.md`, whole. Rules you wrote there yourself are not lost: they move
to `~/.claude/rules/my-rules.md`, which Claude Code loads in every session too. On the $20 Pro plan, which has no
Fable model, the copied agents, skills and rules name Opus wherever they would name Fable.

Before the installer replaces any file, it keeps the old copy in
`~/.claude/setup-logs/<date>-install-backup/`. A file of yours with the same name as one of Stratus's stays as
it is, and so does a Stratus file you changed after an earlier run. The run lists those files at the end under
`Kept as yours`.

## The two side-work folders

In your projects folder (`Projects` in your home folder unless you give `--projects`), the installer sets up
`quick-tasks` and `claude-settings`, each with its own skills, hooks, tools and `.claude/settings.json`. The notes
files you fill in, such as `profile.md`, are written only when they are missing.
[The side-work folders](../using/side-work-folders.md) says what each folder is for.

## Nimbalyst and the plugins

When Nimbalyst is installed, the installer builds Stratus's extensions and puts them into Nimbalyst. A running
Nimbalyst keeps reading its extension folders, so while it is open each build waits in a side folder and goes in
when Nimbalyst closes. A Nimbalyst with no theme picked yet, or with a theme from outside the Ink set, is switched once to the
Ink Cobalt theme; a theme you pick after that stays, and `--no-theme` leaves the theme alone. Nimbalyst's chats
are pointed at your own Claude Code instead of the copy Nimbalyst bundles.

Then come the Claude Code plugins and the `find-skills` skill. Each plugin is handled once, so a plugin you
removed later stays removed.

The installer also copies the tools that update and patch Nimbalyst into `~/.claude/scripts/nimbalyst-patch/`.
Nimbalyst itself is not changed by this run. On Windows, the next update installs the Nimbalyst version Stratus names
and patches it; on a Mac, Nimbalyst keeps updating itself. [Nimbalyst patches](nimbalyst-patches.md) explains how, and what each
patch changes.

## The end of the run

When everything that can stop a run has run, the installer writes `~/.claude/setup-state.json`. A run that stops
earlier leaves the old record, so the next run starts from the same place.

The last lines say what is left:

- the `Kept as yours` list, with `--replace <file>` and `--replace-all` to take Stratus's version;
- any hook in your settings whose script is not there;
- on the first install only, the steps that need a chat: Nimbalyst's own settings and voice typing. These are
  steps 8 and 9 of [the full install](../full-install.md). An update never names them again.

A run that changed something saves what it printed in `~/.claude/setup-logs`.

## Keep the folder you installed from

The record in `~/.claude/setup-state.json` names the folder the installer ran from (`repo`). Updates read that
folder: they compare its extensions with the new version's to know which ones changed, and they load its theme
script while an Ink theme waits to be set. When the folder is gone, moved or no longer holds Stratus, an update
stops and says: `Download <the repository> and run its install once.`

After the first update, the record names the downloaded copy in `~/.claude/setup-source/v<version>` instead, and
updates no longer read the folder you installed from. Until then, keep it where it is.

If you deleted it, download the repository again into a folder that stays and run `node install.mjs` there once.
Your earlier answers are on record, so the run asks nothing again, and the next update works from the new folder.

## Questions asked once

The full install asks two questions once: whether you want voice typing with Handy, and whether you want the
encrypted backup. The answers go into `~/.claude/setup-state.json`, and no update asks voice typing again. An
update asks about the backup only while no answer is on record.

The answer only stops the question. To change it later:

- `node install.mjs --handy yes` or `--handy no` in Stratus's folder puts a new answer on record. It neither
  installs nor removes Handy, which is yours to add or remove any time.
- `node ~/.claude/skills/update-setup/update.mjs --backup no` puts a no on record and runs nothing else.
  `/backup` sets the backup up at any time, and `/backup off` stops its schedule and deletes nothing.

## What `--uninstall` takes out

`node install.mjs --uninstall`, run in the folder you installed from, works from the record in
`~/.claude/setup-state.json`. After the first update, that folder may be gone: run the same command from the newest
`v<version>` folder in `~/.claude/setup-source` (or from a fresh download). The run keeps the folder it runs from and
names it, so you delete it by hand afterwards. Without the record it removes nothing. With `--dry-run` it prints what it would do
and changes nothing.

The uninstall does not stop the phone app's program on your PC. If you joined the phone app, run
`node ~/.claude/skills/phone-bot/pc/setup.mjs remove` first, so no log-on entry is left to start a deleted script.

It goes in this order:

1. **The backup's schedule.** When the encrypted backup runs on a schedule, the uninstall turns the schedule off
   first, so no scheduled task is left to start a deleted script. If that fails, the run stops and changes
   nothing.
2. **The settings.** Stratus's hook entries leave `~/.claude/settings.json` and the two side-work folders'
   settings. The two rules that block Claude Code's built-in helpers go too, because the `worker` agent
   that replaces them goes. The empty effort variable goes, so Nimbalyst's effort picker sets the level again.
3. **The files.** Each file Stratus wrote is removed while it is still exactly what a run wrote. A file you
   changed stays, and so does the rules file when you edited it.
4. **Your old files.** A file of yours that the installer replaced comes back from `~/.claude/setup-logs` to its
   place, when nothing else is there now.
5. **Nimbalyst.** Its chats go back to the Claude Code it bundles, when the path is still the one Stratus set.
   Its original app files go back. While Nimbalyst is open it holds those files, so the run prints the command to
   run after you quit it.
6. **The downloads and the record.** The versions the updater downloaded into `~/.claude/setup-source` are
   deleted, and then `~/.claude/setup-state.json`.

The run ends with `Done. Restart Claude Code so it stops loading the hooks.`

## What `--uninstall` leaves

The run lists what it kept, each with how to remove it:

- **The side-work folders.** They may hold your work, so they stay as they are. Delete one by hand when you don't
  need it.
- **The rest of `~/.claude/settings.json`.** The model, the language and the other permission rules Stratus set
  stay. Edit them by hand.
- **The files you changed**, named one by one, and `~/.claude/rules/my-rules.md`, which holds your own rules.
- **The phone app's folder**, `~/.phone-app`, with this PC's pairing keys and logs, if you joined the phone app.
- **The backup's folder**, `~/.claude-backup`. It holds the backup's password and storage key, and the backups in your storage
  bucket stay. Save the password somewhere else before you delete the folder, or the backups can't be read.
- **`~/.claude/setup-logs`**, with what each run printed and the copies of replaced files.
- **What Stratus wrote while you worked.** The run does not name these; delete them by hand when you don't need
  them. In `~/.claude`: `board-tidy.json` (Board Tidy's keep list), `update-check.json`, `goals.md` (your goals for
  `/next-move`), `disk-tidy.json` (the `/disk-tidy` keep list), `package-skips.json` (the package updates
  `/update-project` skipped), `my-rules-vault.md` (the rules a tidy moved out), and the folders `hooks/state` (the
  hooks' logs), `state`, `usage-log` (plan use), `reports`, `handoffs` (`/handoff` briefs), `video-cache` (`/watch`
  downloads), `steer` (notes sent to running sessions) and `browser-profiles` (the sign-ins `site-login` saves).
  Outside it: `~/.claude-archive`, where `/disk-tidy` keeps old chats.
- **The plugins.** Remove each one you don't want:

  ```
  claude plugin uninstall claude-hud@claude-hud
  claude plugin uninstall security-guidance@claude-plugins-official
  claude plugin uninstall frontend-design@claude-plugins-official
  claude plugin uninstall impeccable@impeccable
  ```

- **The `find-skills` skill.** Remove it with `npx skills remove find-skills -g`.
- **The Nimbalyst extensions.** The run names the folders it put there. Delete each one from Nimbalyst's extensions
  folder (`%APPDATA%\@nimbalyst\electron\extensions` on Windows, `~/Library/Application Support/@nimbalyst/electron/extensions`
  on a Mac), then restart Nimbalyst. The folders are `agentspanel`, `boardtidy`, `commandbuttons`, `inktheme`,
  `jobtracker`, `systemsmap` and `usageplan`, plus `readaloud` if you added Read Aloud.
- **Auto mode.** If you turned it on, it stays on in each project you set it for. Turn it off in Nimbalyst under
  Settings > Project > Agent Permissions.
