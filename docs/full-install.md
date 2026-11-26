# Full install: the whole setup on a new Windows computer or Mac

**If you are a person:** install Claude Code and sign in. Download this repository as a ZIP (or clone it) and unzip it to a folder you keep until the first update has run ([why](how-it-works/install.md#keep-the-folder-you-installed-from)). Open a terminal in that folder and run this one command:

```
claude "Read docs/full-install.md and carry out every step in it."
```

Claude installs the programs and sets everything up; it asks you a few questions first. This route always installs Nimbalyst, the editor; to use Stratus in a terminal only, run `node install.mjs` instead ([Install options](using/install-and-update.md#terminal-only-without-nimbalyst)). The rest of this page is written for Claude.

**What it does, at a glance:**

| | |
|---|---|
| Programs installed (only what is missing) | Nimbalyst, Node.js, Git, uv; with a ChatGPT yes also Codex and ffmpeg; with a voice typing yes also Handy; on a Mac also Homebrew |
| Files changed | `~/.claude` (rules, hooks, skills, agents, settings), the Nimbalyst extensions and theme, and two new folders, `claude-settings` and `quick-tasks`, in your projects folder. See [What the install changes](reference/install-changes.md) |
| Questions asked, once | ChatGPT subscription, projects folder, language, voice typing, encrypted backup; later, whether to turn on auto mode and which Ink theme |
| Needs you for | A browser sign-in for Codex, a system prompt, on a Mac your password for Homebrew, and one restart of Nimbalyst |
| Left alone | Your own hooks, skills and rules (kept, with dated copies), and any other folder in your projects folder |
| Runs later, without asking | Every 12 hours a check for a newer Stratus; a release that asks nothing installs itself (`AUTO_UPDATE=off` stops that). On Windows, Stratus also takes over Nimbalyst's updates and patches some of its app files (`NIMBALYST_FOLLOW=off` stops that). See [Updates](using/install-and-update.md#updates) |

For Claude: the user ran one command and expects the rest to happen by itself. Do every step yourself and hand the user only what nobody else can do: the answers in step 1, a click in a browser sign-in, a system prompt, on a Mac the password for Homebrew. Do the steps in order. Every step is safe to run twice: check first, and skip what is already there.

`<repo>` is the folder this repository was unzipped to. `<projects>` is the projects folder from step 1; it may contain spaces, so put it in double quotes. `<extensions>` is `%APPDATA%\@nimbalyst\electron\extensions` on Windows and `~/Library/Application Support/@nimbalyst/electron/extensions` on a Mac.

## Rules for you

1. **Ask only what step 1 asks.** Its form names the programs step 2 installs, so the answer covers them.
2. **Never lose the user's own config.** `install.mjs` and `scripts/app-settings.mjs` merge and keep dated copies. Where you edit a file by hand, keep a copy too.
3. **If something fails,** try once more with an obvious fix, then note it for step 10 and go on. The one exception is Node in step 2: without it nothing here works.
4. **One short line to the user per step**, in the language they write in. No long explanations until step 10.
5. From step 3 on, a hook wants every shell command to end with an empty line and then a last line that starts with `# WHAT THIS DOES: ` and says in plain words what the command does. Run commands with the Bash tool: on Windows with Git Bash, step 3 turns the PowerShell tool off. Write your commands that way from the start.
6. **Make no git repository during this install.** Git is installed for the plugin installer and for project history: `/new-project` gives each new project its own git later.
7. On a Mac, **never use `sudo` yourself**: your shell can't show a password prompt.

## 1. Ask: the subscriptions, the projects folder and the two opt-ins

First check whether Handy is installed: on Windows `winget list --id cjpais.Handy -e --accept-source-agreements`, on a Mac `ls -d /Applications/Handy.app`. If it is, leave the voice typing question out and take HANDY as yes.

Then one form, up to five questions (in Nimbalyst `mcp__nimbalyst__PromptForUserInput`, in a terminal AskUserQuestion):

| Question | What a yes adds |
|---|---|
| Do you have a paid **ChatGPT** subscription? | **Codex**, for the generated pictures and for the `finder` skill's web searches in `quick-tasks`; with a yes, step 2 also installs **ffmpeg**, which `/watch` needs. |
| Where should the projects folder go? | Two small project folders are made in it, `claude-settings` and `quick-tasks`. The default is `Projects` in the home folder; any folder works. |
| Which **language**: English or Русский? | With Русский, Claude answers in Russian in every chat; Nimbalyst and Stratus's extensions stay in English. |
| Do you want **voice typing**? Yes / No | **Handy**: hold a key, speak, and the words appear where you type. Installed in step 2, set up in step 9; it keeps itself up to date. On a Mac, Handy with Stratus is untested. |
| **Back up your Claude setup to the cloud, encrypted?** Yes, set it up / No | The backup, set up by `/backup` after the install (step 12). |

The backup question has this text, and neither answer is marked recommended (not everybody needs it): "Your settings, rules, skills, memory and any project folders you pick are copied to your own Backblaze B2 storage on the schedule you pick (daily, weekly or only when you ask); it is free up to 10 GB, then about $7 per TB a month. They are locked on this computer with a password only you keep, so Backblaze or anyone with the storage key sees only scrambled data. Setup takes about 10 minutes: you make a Backblaze account and keep one password. The backup has been tested against a folder on a computer, not yet against a live Backblaze account or a live schedule." With its No: "we won't ask again; `/backup` sets it up any time". Voice typing and the backup are asked only here, once: the answers are kept and no update asks again. How the user changes an answer later is in [What the install does](how-it-works/install.md#questions-asked-once).

Say that "no" is fine: everything works on Claude alone except the picture skill and the `finder` search skill, which need Codex, and `/watch`, which needs the ffmpeg that step 2 installs only with a yes. In the form's intro, name what step 2 installs if it is missing (Nimbalyst, Node.js, Git, uv, Codex and ffmpeg with the ChatGPT yes, Handy with the voice typing yes; on a Mac also Homebrew, which asks once for the Mac password) and that it takes about ten to twenty minutes. Remember the answers as CODEX, PROJECTS, LANGUAGE (`english` or `russian`), HANDY and BACKUP (`yes` or `no`).

## 2. Programs

Check each program first and install only what is missing and applies, one command at a time, without asking again. Give each install up to 10 minutes (tool timeout 600000 ms).

### On Windows

Checks: `node --version`, `git --version`, `uvx --version`, `winget list --id Nimbalyst.Nimbalyst -e --accept-source-agreements`, and with a yes `codex --version`, `ffmpeg -version` (Handy was checked in step 1). Add `--silent --accept-package-agreements --accept-source-agreements` to each `winget install`. If Windows asks to allow an app to make changes, tell the user to click Yes.

| Program | Applies | Install |
|---|---|---|
| Nimbalyst | always | `winget install --id Nimbalyst.Nimbalyst -e --source winget` |
| Node.js 18 or newer (22.5 or newer for the Nimbalyst features in [Dependencies](reference/dependencies.md)) | always, required | `winget install --id OpenJS.NodeJS.LTS -e --source winget` |
| Git | always | `winget install --id Git.Git -e --source winget` |
| uv | always | `winget install --id astral-sh.uv -e --source winget` |
| Handy | HANDY yes, not installed | `winget install --id cjpais.Handy -e --source winget` |
| Codex CLI | CODEX yes | `npm i -g @openai/codex` |
| ffmpeg | CODEX yes | `winget install --id Gyan.FFmpeg -e --source winget` |

A program installed just now is not on the PATH of your running shell. Don't restart anything: call it by its full path or put its folder in front of the PATH for that command (the usual folders: `C:\Program Files\nodejs`, `%APPDATA%\npm`, `C:\Program Files\Git\cmd`, `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%USERPROFILE%\.local\bin`). If Nimbalyst was installed just now, start it once so that its settings folder exists: `powershell -NoProfile -Command 'Start-Process "$env:LOCALAPPDATA\Programs\Nimbalyst\Nimbalyst.exe"'`, and wait until `%APPDATA%\@nimbalyst\electron` is there.

### On a Mac

On a Mac, read each step's result instead of assuming it worked.

Start every command from here on that names `brew`, `node`, `npm`, `npx`, `git`, `uvx`, `codex` or `ffmpeg` with `PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"`.

**Homebrew first.** If `brew --version` fails, open a Terminal window that runs its installer: `osascript -e 'tell application "Terminal" to do script "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""' -e 'tell application "Terminal" to activate'`. Tell the user: "A Terminal window opened. Type your Mac password there when it asks (nothing shows while you type), press Return, and Return once more to continue. When it prints 'Installation successful', come back and say done." Then add Homebrew to the shell files, once: for `~/.zprofile` and `~/.zshrc`, if the file has no `brew shellenv`, append `eval "$(<the brew path> shellenv)"`; if `~/.zshrc` has no `.local/bin`, append `export PATH="$HOME/.local/bin:$PATH"`.

Checks: `xcode-select -p` (Git is there when it prints a folder; don't run `git --version`, it opens a dialog), `node --version`, `uvx --version`, `ls -d /Applications/Nimbalyst.app`, and with a yes `codex --version`, `ffmpeg -version` (Handy was checked in step 1).

| Program | Applies | Install |
|---|---|---|
| Nimbalyst | always | `brew install --cask nimbalyst` |
| Node.js 18 or newer (22.5 or newer for the Nimbalyst features in [Dependencies](reference/dependencies.md)) | always, required | `brew install node` |
| Git | only if `xcode-select -p` fails | `brew install git` |
| uv | always | `brew install uv` |
| Handy (untested on a Mac) | HANDY yes, not installed | `brew install --cask handy` |
| Codex CLI | CODEX yes | `npm i -g @openai/codex` |
| ffmpeg | CODEX yes | `brew install ffmpeg ffmpeg-full` (`/watch` needs the full one to write the time on a still, and finds it in Homebrew's folder, off the PATH) |

If Nimbalyst was installed just now, run `open -a Nimbalyst` and wait until `~/Library/Application Support/@nimbalyst/electron` is there. macOS may ask whether to open a downloaded app: the user clicks Open.

### On both

If Node can't be installed, stop and tell the user. If Codex can't be installed, set its answer to no for the rest of this file. Anything else that fails: note it for step 10 with its install command and go on.

This step installs no other program. Python 3.10 or newer is handled in step 4. yt-dlp runs through `uvx` when it is missing. `/backup` downloads restic itself. gitleaks, Playwright and the GitHub CLI are not installed by Stratus; [Dependencies](reference/dependencies.md) lists each program and what needs it.

## 3. The files: rules, hooks, skills and the two projects

1. **Run the installer** from `<repo>`:

```
node install.mjs --projects "<projects>" --codex <yes|no> --language <english|russian> --handy <yes|no> --backup <yes|no>
```

2. **On a Mac** add `--node "$(command -v node)"` (with the PATH prefix): the hooks are then started with Node by its full path, which an app opened from the Dock needs. The run prints one line per file and ends with `Done.` It remembers these answers, so a later update asks nothing. `--handy` and `--backup` are only put on record: the run neither installs nor removes Handy or a backup. The rules file `~/.claude/CLAUDE.md` is written whole. If it says `rules: brought up to this version` with some `of yours moved to`, the user already had rules of their own: tell them in one line that those now sit in `~/.claude/rules/my-rules.md`, which every chat loads too, and that a dated copy of the old file is kept.

3. **Read what it reports.** When Nimbalyst is already installed, this run also builds the editor extensions and puts them into Nimbalyst (`extension installed: <name>`). While Nimbalyst is open it keeps them in a side folder until it closes (`extension waiting: <name>`); that is fine too. The extensions step further down is then only for one that says `extension failed` or `extension not built`. The same run adds the Claude Code settings of step 5 and installs the plugins of step 4 (`plugin installed: <name>`), so those two steps are only for what it reports as failed or not installed. Its line `Left for a chat, once` means steps 8 and 9 below: you are that chat. Only this first run prints it; a later run or an update does not, and never opens a folder or asks about a theme or voice typing.

4. **Kept files.** If the run ends with a list under `Kept as yours`, the user already had files with those names: their own hooks or skills, or an older copy of Stratus. They were left as they are. Show the list and ask once: take Stratus's version of all of them, of some (which ones), or keep theirs. A dated copy of theirs is kept either way. All: the same command with `--replace-all`. Some: with `--replace <name>` for each, the name as the list has it. If the run lists hooks whose script is not there, name them in the final reply and change nothing. A run that changed something saves what it printed under `~/.claude/setup-logs`.

## 4. Plugins: only what step 3 left out

Step 3's run installed the plugins `claude-hud`, `security-guidance`, `frontend-design` and `impeccable` and the `find-skills` skill, with a line `plugin installed:` or `plugin already there:` for each. Act only on these lines:

- `plugin left off: security-guidance`: there is no Python 3.10 or newer. Install it from python.org (on a Mac, `brew install python`) and run step 3 again.
- `plugin failed`, `marketplace ... could not be added`, `skill failed` or `plugins not installed`: run `claude plugin list`, note which plugins are already installed, then run these one at a time, skipping what is there:

```
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install claude-hud@claude-hud
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin install security-guidance@claude-plugins-official
claude plugin install frontend-design@claude-plugins-official
claude plugin marketplace add pbakaus/impeccable
claude plugin install impeccable@impeccable
npx -y skills add vercel-labs/skills --skill find-skills -g -y
```

These plugins stay on everywhere. In every case, if `uvx` is there, warm up the document converter: `uvx --from "markitdown[all]" markitdown --help`.

The `phone-bot` skill and the `read-aloud` extension are add-ons, left out of step 3's run. To add either, run step 3 again with `--with phone-bot,read-aloud` (either or both); a copy already in place stays and keeps being updated by a plain run.

## 5. Claude Code settings: only if step 3 did not make them

Step 3's run wrote the Claude Code settings. Run this from `<repo>` only when that run stopped before `Done.`, or when check 3 of step 10 fails:

```
node scripts/app-settings.mjs
```

It ends with `settings done`. It sets the default model, the permission rules, and the empty `CLAUDE_CODE_EFFORT_LEVEL` that lets each helper run at its own effort; every key is listed in [What the install changes](reference/install-changes.md). After it, Nimbalyst's effort picker no longer changes Claude Code's level: tell the user to use `/effort` in the chat.

## 6. Sign in to Codex

Skip this if the ChatGPT answer is no.

- **Codex:** `codex login status`. If it is not signed in, run `codex login` in the background; a browser page opens and the user finishes there. Check from `<projects>`: `codex exec --skip-git-repo-check -s read-only -c model_reasoning_effort="low" "Reply with the single word: ready" < /dev/null` (on Windows add `-c 'windows.sandbox="unelevated"'` after `read-only`). The output must contain `ready`.

A sign-in that isn't finished now is noted for step 10. Nothing else waits on it.

## 7. Nimbalyst extensions: only what step 3 left out

Step 3's run built and installed the extensions. Do this step only for an extension it reported as `extension failed` or `extension not built`.

For `usage-plan`, `commands` and `systems-map`, in `<repo>/extensions/<name>`: `npm install`, `npm run build`, `npm run install-ext`. The last one copies the build to `<extensions>` and prints `installed to` and the folder. For `agents-panel`, `board-tidy` and `job-tracker` (no npm needed): `node build.mjs --install` in each. For `ink-themes` (eleven colour themes; it only adds them to the theme list, step 3 sets Ink Cobalt once unless `--no-theme` was passed): `npm run build`, `npm run install-ext`, no `npm install`. `read-aloud` is optional and Windows only: it needs a voice model and Python, see [its README](../extensions/read-aloud/README.md). Nimbalyst loads extensions when it starts; don't close it yourself, step 10 tells the user.

## 8. Nimbalyst settings

Only if this session runs inside Nimbalyst (ToolSearch finds tools named `mcp__nimbalyst-host__...`). Otherwise skip to step 9; step 10 gives the user a prompt for it.

1. `workspace_open` once for each of the two folders under `<projects>`, so each shows up as a project.
2. `settings_get_overview`, then `ai_set_default_model` with `providerModel: "claude-code:opus"`. If LANGUAGE is `russian`, also `ai_set_preferred_language` with `ru`.
3. Turn on **worktrees** and **terminal** if they are off: `features_toggle` with `bucket: "alpha"`, the feature's tag from the overview, `enabled: true`. If the call answers `requiresUserAction: "developer-mode"`, tell the user: "Turn on Developer Mode in Nimbalyst: Settings > Advanced. Then say done." and call it again.
4. **The look.** Only if `<extensions>/inktheme/manifest.json` is there.
   1. Step 3's run set Ink Cobalt where no theme was picked yet, and also where a theme from outside the Ink set was picked (its line `theme: set to Ink Cobalt`). It does this once; a theme the user picks afterwards stays, and `--no-theme` leaves the theme alone.
   2. If the run printed a line starting `theme: set now:` instead (Nimbalyst is open, so it could not write the theme): call `appearance_set_theme` with `com.local.inktheme:ink-cobalt` and, only if the call succeeded, run `node <repo>/install.mjs --theme-done`. If it failed, the extension loads after a restart: tell the user to quit and reopen Nimbalyst and run `/update-setup` again.
   3. Ask once which theme they want: Ink Aurora, Ink Ivy, Ink Graphite, Ink Tide, Ink Ember, Ink Noir, Ink Cobalt, Ink Neon (dark), Ink Bone, Ink Frost, Ink Blossom (light), or the one they have now.
   4. For one of the eleven, call `appearance_set_theme` with `com.local.inktheme:<id>`, the id being the name in small letters with a dash (`ink-aurora`, `ink-frost` and so on).
   5. If that call fails, the extension was installed in this run and loads when Nimbalyst starts: tell them to quit Nimbalyst, open it again and pick the theme with the Theme button at the bottom of the left sidebar.
5. **Auto mode.** Ask one card: "Let Claude work without asking before each step? A second model checks every command and file change first: safe ones go ahead, risky ones are stopped and you are asked." Options: "Yes, turn on auto mode (Recommended)", because Stratus's notes and guards are built for it and it removes most permission pop-ups; and "No, keep asking me". Yes: `node ~/.claude/skills/update-setup/update.mjs --auto-mode yes`, then `workspace_set_trust` for each of the two folders from step 8.1 with `trusted: true`, `mode: "bypass-all"`, `allowAllUsesClassifier: true`; each result's after-values must read `bypass-all` and `true`, else note the failure for step 10. Tell the user it is set per project; another project gets it in Settings > Project > Agent Permissions, "Agent-verified". No: `node ~/.claude/skills/update-setup/update.mjs --auto-mode no` and change nothing else.
6. Leave the sounds and everything else as the user has them. If a tool is missing or a call fails, change nothing and note it for step 10.

## 9. Handy, for voice typing

Only with HANDY yes; with no, skip this step and change nothing (a Handy that is there stays). **If step 1's check found Handy already installed, skip this step too:** the user has it set up their way. Say in one line that voice typing was already there, and change nothing in it.

Otherwise: Handy writes its settings file on first start, so tell the user: "Open Handy, follow its first-start setup (allow the microphone, pick the model Whisper Large v3 Turbo), then quit it from its tray or menu bar icon and say done." On a Mac it also needs System Settings > Privacy & Security > Accessibility.

- **Windows:** after their "done", run `node scripts/app-settings.mjs --handy`. It sets push to talk on Right Alt, text pasted with Ctrl+V and a space after it, the clipboard left as it was, filler words removed, the model kept loaded, and a hidden start with Windows. A dated copy of the old file is kept. Right Alt is AltGr on many non-US keyboards, so typing letters and symbols breaks while it is bound: if the user's keyboard is one, tell them to pick another key to hold in Handy's own window (Right Ctrl, for one).
- **Mac** (untested; say so in one line): tell the user to set these in Handy's own window: push to talk (the key to hold is theirs to pick), text pasted rather than typed letter by letter, the clipboard left as it was, the model kept loaded.

If the user doesn't want to do it now, note it for step 10.

Steps 8, 9 and 12 belong to this first install only. The answers they need later are on record in `~/.claude/setup-state.json`: the backup answer (from step 3), and the theme and auto mode (step 8). A later run of the installer or an update asks about the backup or auto mode only when no answer is on record, and never repeats the rest of these steps.

## 10. Test, then tell the user

Run each check once; fix an obvious failure, report any other with its output. Build the JSON in a file or a small Node script, a shell can mangle the quotes.

1. `node install.mjs --projects "<projects>" --codex <yes|no> --dry-run` prints no line starting with `[dry run] copied`, `replaced`, `wrote` or `hook added`.
2. Pipe `{"tool_name":"Bash","tool_input":{"command":"ls -la"}}` into `node ~/.claude/hooks/command-explain.mjs`: the output contains `(no note given)`.
3. `permissions.deny` in `~/.claude/settings.json` holds `Agent(Explore)` and `Agent(general-purpose)`.
4. `node ~/.claude/skills/setup-audit/scripts/usage-scan.mjs --days 1` prints a report that starts with `# Usage`.
5. `node "<projects>/quick-tasks/tools/test-finder.mjs"` ends with `all passed`.
6. The manifests of the seven extensions step 3 builds parse as JSON: in `<extensions>` their folders are `agentspanel`, `boardtidy`, `commandbuttons`, `inktheme`, `jobtracker`, `systemsmap` and `usageplan` (`<extensions>/usageplan/manifest.json` and so on). One that said `extension waiting:` is not there yet: look for it under `extensions-pending/` beside `<extensions>` instead (same folder name).
7. `node ~/.claude/skills/update-setup/update.mjs --check` prints `Already on the newest version`.
8. On a Mac: `zsh -lic 'command -v node uvx'` prints two paths, and every hook command in `~/.claude/settings.json` starts with a Node that exists.

Then reply in the user's language, in short lines:

- **What is set up now**, one line each, done / already there / failed with the error: the rules, the hooks, the skills, the helper agents, the plugins, Codex, the extensions, the two folders with their full path, voice typing (or not wanted), the backup (set up next with `/backup`, or not wanted).
- **Memory:** one line: Stratus relies on Claude Code's built-in auto memory (on by default, `autoMemoryEnabled`; per project under `~/.claude/projects/<project>/memory/`), which it checks (`/setup-audit memory`) and backs up (`/backup`).
- **Do this once.** Tell the user, in this order:
  1. If any line said `extension waiting:`, first run `node ~/.claude/scripts/nimbalyst-patch/ext-swap.mjs --after-quit` (it returns at once, waits 2 minutes for Nimbalyst to close, then puts the panels in). Tell the person to quit Nimbalyst within those 2 minutes and open it again once it has closed; a later quit leaves the panels waiting until the next `/update-setup`. After the reopen, Stratus's buttons sit in the left sidebar and every chat finds the programs installed today.
  2. Start a new chat for the next task, because rules and hooks load when a chat starts.
  3. In a new project folder, the first message of the day offers `/new-project` on a card; in one that already has a `CLAUDE.md`, `/update-project` brings it up to date with Stratus.
  4. Any sign-in still open, with the exact command.
  5. If step 8 was skipped: open `<projects>/claude-settings` in Nimbalyst, turn on Developer Mode under Settings > Advanced, and paste this in a new chat (with LANGUAGE `russian`, add `Set the preferred language to ru.` before the last sentence):

     ```
     Open these two folders as projects: <the two full paths>. Set the default model for new chats to claude-code:opus. Turn on the alpha features worktrees and terminal if they are off. Ask me which Ink theme I want and set it. Ask me whether to turn on auto mode; on yes, run node ~/.claude/skills/update-setup/update.mjs --auto-mode yes and set both folders to trusted with mode bypass-all and the classifier on, and on no, run the same command with --auto-mode no. Then show me the settings overview.
     ```
- **What was already there:** the files kept as theirs and the files replaced (each old one is kept in `~/.claude/setup-logs/<YYYY-MM-DD>-install-backup/`), any hook whose script is not there, and the file under `~/.claude/setup-logs` that has the whole run. Leave this out on a computer that had no setup before.
- **What was left out** and how to add it: a missing Codex (run `node install.mjs --codex yes` from `<repo>` after installing and signing in), a program that could not be installed with its install command.
- **How to use it:** `<projects>/claude-settings/how-to.md` has an example for each feature; typing the single word `usage` shows how much of the plan is used.
- **Updates:** every 12 hours Stratus checks for a newer version; one that asks nothing installs itself in the background, and typing `/update-setup` installs one that needs their answer and keeps their own files, clears Stratus's own leftovers, and offers theirs and a file reorganize on one card. `/disk-tidy` shows what fills the disk and `/file-upkeep` puts a project's files in order, any time.

## 11. Project folders set up before Stratus

Run `node ~/.claude/skills/update-project/pass.mjs --list`. Only when its last line counts one or more `behind`: one question card (`AskUserQuestion`; in Nimbalyst `mcp__nimbalyst__AskUserQuestion`): `<n> project folders you worked in lately were set up before this version of Stratus. When you next work in one, offer to bring it up to date, so sessions there get the current rules, systems map and file layout (about 15 minutes each, every change shown first)?` Options `Yes, when I open each (recommended)` / `Now, starting with <newest folder>` (the first `behind` line) / `No, don't offer`.

- Yes: nothing to run; the install started the offer as on.
- Now: run `/update-project` on that folder by its path. Open no window.
- No: `node ~/.claude/skills/update-project/pass.mjs --skip-all`. `/update-project` in a project folder still works any time.

## 12. Backup, last

Only with BACKUP yes: after the reply of step 10 and the question of step 11, run `/backup`. It sets the backup up with the user. With no, nothing: `/backup` sets it up any time.
