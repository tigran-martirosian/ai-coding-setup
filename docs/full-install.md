# Full install: the whole setup on a new Windows computer or Mac

<!-- For the human: install Claude Code and sign in. Download this repository and unzip it to a folder
     that stays (the setup keeps using it). Open a terminal in that folder and run this one command:
       claude "Read docs/full-install.md and carry out every step in it."
     Claude installs the programs and sets everything up. Everything below is written for Claude. -->

For Claude: the user ran one command and expects the rest to happen by itself. Do every step yourself and hand the user only what nobody else can do: the answers in step 1, a click in a browser sign-in, a system prompt, on a Mac the password for Homebrew. Do the steps in order. Every step is safe to run twice: check first, and skip what is already there.

`<repo>` is the folder this repository was unzipped to. `<projects>` is the projects folder from step 1; it may contain spaces, so put it in double quotes. `<extensions>` is `%APPDATA%\@nimbalyst\electron\extensions` on Windows and `~/Library/Application Support/@nimbalyst/electron/extensions` on a Mac.

## Rules for you

1. **Ask only what step 1 asks.** Its form names the programs step 2 installs, so the answer covers them.
2. **Never lose the user's own config.** `install.mjs` and `scripts/app-settings.mjs` merge and keep dated copies. Where you edit a file by hand, keep a copy too.
3. **If something fails,** try once more with an obvious fix, then note it for step 10 and go on. The one exception is Node in step 2: without it nothing here works.
4. **One short line to the user per step**, in the language they write in. No long explanations until step 10.
5. From step 3 on, a hook wants every shell command to end with an empty line and then a last line that starts with `# WHAT THIS DOES: ` and says in plain words what the command does. In Nimbalyst it also wants commands short (about 7 lines) and run with the Bash tool. Write your commands that way from the start.
6. **No git in the user's projects.** Git is installed only because the plugin installer downloads with it.
7. On a Mac, **never use `sudo` yourself**: your shell can't show a password prompt.

## 1. Ask: the subscriptions and the projects folder

One form, three questions (in Nimbalyst `mcp__nimbalyst__PromptForUserInput`, in a terminal AskUserQuestion):

| Question | What a yes adds |
|---|---|
| Do you have a paid **ChatGPT** subscription? | The **Codex** worker: long reading, folder sweeps, web research; a GPT seat in the court; generated pictures. |
| Do you have a **Google AI** subscription (Gemini)? | The **Antigravity** worker (`agy`): very large files, second opinions; a Gemini seat in the court. |
| Where should the projects folder go? | Four small project folders are made in it. The default is `Projects` in the home folder; any folder works. |

Say that "no" is fine: everything works on Claude alone. In the form's intro, name what step 2 installs if it is missing (Nimbalyst, Node.js, Git, uv, Handy for voice typing, a worker's program for each yes, ffmpeg with the ChatGPT yes; on a Mac also Homebrew, which asks once for the Mac password) and that it takes about ten to twenty minutes. Remember the answers as CODEX, AGY and PROJECTS.

## 2. Programs

Check each program first and install only what is missing and applies, one command at a time, without asking again. Give each install up to 10 minutes (tool timeout 600000 ms).

### On Windows

Checks: `node --version`, `git --version`, `uvx --version`, `winget list --id Nimbalyst.Nimbalyst -e --accept-source-agreements`, `winget list --id cjpais.Handy -e --accept-source-agreements`, and with a yes `codex --version`, `agy --version`, `ffmpeg -version`. Add `--silent --accept-package-agreements --accept-source-agreements` to each `winget install`. If Windows asks to allow an app to make changes, tell the user to click Yes.

| Program | Applies | Install |
|---|---|---|
| Nimbalyst | always | `winget install --id Nimbalyst.Nimbalyst -e --source winget` |
| Node.js 18 or newer | always, required | `winget install --id OpenJS.NodeJS.LTS -e --source winget` |
| Git | always | `winget install --id Git.Git -e --source winget` |
| uv | always | `winget install --id astral-sh.uv -e --source winget` |
| Handy | always | `winget install --id cjpais.Handy -e --source winget` |
| Codex CLI | CODEX yes | `npm i -g @openai/codex` |
| Antigravity CLI | AGY yes | `winget install --id Google.AntigravityCLI -e --source winget`, or if that finds nothing `powershell -NoProfile -Command "irm https://antigravity.google/cli/install.ps1 \| iex"` |
| ffmpeg | CODEX yes | `winget install --id Gyan.FFmpeg -e --source winget` |

A program installed just now is not on the PATH of your running shell. Don't restart anything: call it by its full path or put its folder in front of the PATH for that command (the usual folders: `C:\Program Files\nodejs`, `%APPDATA%\npm`, `C:\Program Files\Git\cmd`, `%LOCALAPPDATA%\Microsoft\WinGet\Links`, `%USERPROFILE%\.local\bin`). If Nimbalyst was installed just now, start it once so that its settings folder exists: `powershell -NoProfile -Command 'Start-Process "$env:LOCALAPPDATA\Programs\Nimbalyst\Nimbalyst.exe"'`, and wait until `%APPDATA%\@nimbalyst\electron` is there.

### On a Mac

Start every command from here on that names `brew`, `node`, `npm`, `npx`, `git`, `uvx`, `codex`, `agy` or `ffmpeg` with `PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.local/bin:$PATH"`.

**Homebrew first.** If `brew --version` fails, open a Terminal window that runs its installer: `osascript -e 'tell application "Terminal" to do script "/bin/bash -c \"$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)\""' -e 'tell application "Terminal" to activate'`. Tell the user: "A Terminal window opened. Type your Mac password there when it asks (nothing shows while you type), press Return, and Return once more to continue. When it prints 'Installation successful', come back and say done." Then add Homebrew to the shell files, once: for `~/.zprofile` and `~/.zshrc`, if the file has no `brew shellenv`, append `eval "$(<the brew path> shellenv)"`; if `~/.zshrc` has no `.local/bin`, append `export PATH="$HOME/.local/bin:$PATH"`.

Checks: `xcode-select -p` (Git is there when it prints a folder; don't run `git --version`, it opens a dialog), `node --version`, `uvx --version`, `ls -d /Applications/Nimbalyst.app`, `ls -d /Applications/Handy.app`, and with a yes `codex --version`, `agy --version`, `ffmpeg -version`.

| Program | Applies | Install |
|---|---|---|
| Nimbalyst | always | `brew install --cask nimbalyst` |
| Node.js 18 or newer | always, required | `brew install node` |
| Git | only if `xcode-select -p` fails | `brew install git` |
| uv | always | `brew install uv` |
| Handy | always | `brew install --cask handy` |
| Codex CLI | CODEX yes | `npm i -g @openai/codex` |
| Antigravity CLI | AGY yes | `curl -fsSL https://antigravity.google/cli/install.sh \| bash` |
| ffmpeg | CODEX yes | `brew install ffmpeg` |

If Nimbalyst was installed just now, run `open -a Nimbalyst` and wait until `~/Library/Application Support/@nimbalyst/electron` is there. macOS may ask whether to open a downloaded app: the user clicks Open.

### On both

If Node can't be installed, stop and tell the user. If a worker's program can't be installed, set its answer to no for the rest of this file. Anything else that fails: note it for step 10 with its install command and go on. Only the Antigravity CLI is needed, not its desktop app.

## 3. The files: rules, hooks, skills and the four projects

From `<repo>`:

```
node install.mjs --projects "<projects>" --codex <yes|no> --agy <yes|no>
```

On a Mac add `--node "$(command -v node)"` (with the PATH prefix): the hooks are then started with Node by its full path, which an app opened from the Dock needs. The run prints one line per file and ends with `Done.` If it says `rules: left alone`, the user already has a `~/.claude/CLAUDE.md`: show in a few lines what `rules/CLAUDE.md` adds, ask whether to replace theirs (a dated copy is kept), and on yes run the same command with `--replace-rules`.

## 4. Plugins and skills

First run `claude plugin list` and note which plugins are already installed. Then run these one at a time, skipping what is there:

```
claude plugin marketplace add anthropics/claude-plugins-official
claude plugin marketplace add mksglu/context-mode
claude plugin marketplace add jarrodwatts/claude-hud
claude plugin install context-mode@context-mode
claude plugin install claude-hud@claude-hud
claude plugin install claude-code-setup@claude-plugins-official
claude plugin install superpowers@claude-plugins-official
claude plugin install context7@claude-plugins-official
claude plugin install typescript-lsp@claude-plugins-official
claude plugin install pyright-lsp@claude-plugins-official
npx -y skills add vercel-labs/skills --skill find-skills -g -y
npx -y repomix --version
```

`context-mode` and `claude-hud` stay on everywhere. The other five load into every session when they are on, so turn each one **that this run installed** off again with `claude plugin disable <name>@claude-plugins-official`; `/new-project` turns them on for the project that needs them. One the user already had stays as they had it. If `uvx` is there, warm up the document converter: `uvx --from "markitdown[all]" markitdown --help`.

## 5. Claude Code settings

```
node scripts/app-settings.mjs
```

It sets `"model": "sonnet"` in `~/.claude/settings.json` if no model is set, and adds permission rules: the agent can't read the saved sign-ins of Claude, Codex and Gemini or the SSH keys, and asks before it reads a `.env` file. It ends with `settings done`.

## 6. Sign in to the workers

Skip a worker whose answer is no. Searching and long reading then go through one command, `~/.claude/workers/ask.mjs`, which uses the first worker that is set up and working; `~/.claude/workers/ask.mjs --status` lists them.

- **Codex:** `codex login status`. If it is not signed in, run `codex login` in the background; a browser page opens and the user finishes there. Check from `<projects>`: `codex exec --skip-git-repo-check -s read-only -c model_reasoning_effort="low" "Reply with the single word: ready" < /dev/null` (on Windows add `-c 'windows.sandbox="unelevated"'` after `read-only`). The output must contain `ready`.
- **Antigravity:** `agy models`. If it is not signed in, the sign-in runs in the program's own window: the user opens a new terminal, types `agy`, signs in with Google and closes it (on a Mac open it for them: `osascript -e 'tell application "Terminal" to do script "$HOME/.local/bin/agy"' -e 'tell application "Terminal" to activate'`). If `agy models` doesn't list `gemini-3.8-flash-medium`, set `env.BIG_READ_AGY_MODEL` in `~/.claude/settings.json` to the newest `*-flash-medium` model it lists: the worker command reads it from there.

A sign-in that isn't finished now is noted for step 10. Nothing else waits on it.

## 7. The Nimbalyst extensions

For `usage-plan` and `commands`, in `<repo>/extensions/<name>`: `npm install`, `npm run build`, `npm run install-ext`. The last one copies the build to `<extensions>` and prints `installed to` and the folder. `read-aloud` is optional and Windows only: it needs a voice model and Python, see [its README](../extensions/read-aloud/README.md). Nimbalyst loads extensions when it starts; don't close it yourself, step 10 tells the user.

## 8. Nimbalyst settings

Only if this session runs inside Nimbalyst (ToolSearch finds tools named `mcp__nimbalyst-host__...`). Otherwise skip to step 9; step 10 gives the user a prompt for it.

1. `workspace_open` once for each of the four folders under `<projects>`, so each shows up as a project.
2. `settings_get_overview`, then `ai_set_default_model` with `providerModel: "claude-code:sonnet"`.
3. Turn on **worktrees** and **terminal** if they are off: `features_toggle` with `bucket: "alpha"`, the feature's tag from the overview, `enabled: true`. If the call answers `requiresUserAction: "developer-mode"`, tell the user: "Turn on Developer Mode in Nimbalyst: Settings > Advanced. Then say done." and call it again.
4. Leave the theme, the sounds, the permission mode and everything else as the user has them. If a tool is missing or a call fails, change nothing and note it for step 10.

## 9. Handy, for voice typing

Handy writes its settings file on first start, so tell the user: "Open Handy, follow its first-start setup (allow the microphone, pick the model Parakeet V3), then quit it from its tray or menu bar icon and say done." On a Mac it also needs System Settings > Privacy & Security > Accessibility.

- **Windows:** after their "done", run `node scripts/app-settings.mjs --handy`. It sets push to talk on Right Alt, text typed directly with a space after it, the clipboard left alone, filler words removed, the model kept loaded, and a hidden start with Windows. A dated copy of the old file is kept.
- **Mac:** show the user the table under "Voice typing" in the [README](../README.md) and let them set those in Handy's own window; the key to hold is theirs to pick.

If the user doesn't want to do it now, note it for step 10.

## 10. Test, then tell the user

Run each check once; fix an obvious failure, report any other with its output. Build the JSON in a file or a small Node script, a shell can mangle the quotes.

1. `node install.mjs --projects "<projects>" --codex <yes|no> --agy <yes|no> --dry-run` prints no line starting with `[dry run] copied`, `replaced`, `wrote` or `hook added`.
2. Pipe `{"tool_name":"Bash","tool_input":{"command":"ls -la"}}` into `node ~/.claude/hooks/command-explain.mjs`: the output contains `"deny"`.
3. Write a temp text file of 400 lines and pipe `{"tool_name":"Read","tool_input":{"file_path":"<that file>"}}` into `node ~/.claude/hooks/big-read-gate.mjs`: the output contains `"deny"`. Delete the file.
4. Pipe `{"session_id":"install-test","tool_name":"Agent","tool_input":{"subagent_type":"Explore","prompt":"find x"}}` into `node ~/.claude/hooks/worker-nudge.mjs`: with a worker, the output contains `"deny"`; with none, no output.
5. `node ~/.claude/skills/usage-report/usage-scan.mjs --days 1` prints a report that starts with `# Usage`.
6. `node "<projects>/internet-search/tools/test-finder.mjs"` ends with `all passed`.
7. `node "<projects>/ask-anything/.claude/skills/court/court.mjs"` with no arguments prints a line starting with `Usage: node court.mjs`.
8. `<extensions>/usageplan/manifest.json` and `<extensions>/commandbuttons/manifest.json` parse as JSON.
9. On a Mac: `zsh -lic 'command -v node uvx'` prints two paths, and every hook command in `~/.claude/settings.json` starts with a Node that exists.

Then reply in the user's language, in short lines:

- **What is set up now**, one line each, done / already there / failed with the error: the rules, the hooks, the skills, the worker agent, the plugins, each outside worker, the two extensions, the four folders with their full path, voice typing.
- **Do this once.** Quit Nimbalyst and open it again: the two new buttons then sit in the side bar and every chat finds the programs installed today. Start a new chat for the next task, because rules and hooks load when a chat starts. In each project folder you work in, type `/new-project` once. Any sign-in still open, with the exact command. If step 8 was skipped: open `<projects>/claude-settings` in Nimbalyst, turn on Developer Mode under Settings > Advanced, and paste in a new chat: `Open these four folders as projects: <the four full paths>. Set the default model for new chats to claude-code:sonnet. Turn on the alpha features worktrees and terminal if they are off. Then show me the settings overview.`
- **What was left out** and how to add it: a missing worker (run `node install.mjs --codex yes` or `--agy yes` from `<repo>` after installing and signing in), a program that could not be installed with its install command.
- **How to use it:** `<projects>/claude-settings/HOW-TO.md` has an example for each feature; typing the single word `usage` shows how much of the plan is used.
