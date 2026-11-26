# What the install changes

This page lists every change `node install.mjs` makes on your computer. A run is safe to repeat: it adds what is
missing, and a second run changes nothing. Before it replaces a file, the installer keeps the old copy in
`~/.claude/setup-logs/<date>-install-backup/`.

The last column says whether `node install.mjs --uninstall` takes the change out again.

## Claude Code settings

The installer writes these keys into `~/.claude/settings.json`. It sets a key only when you have not set it
yourself, and a value you set stays.

| Key | Value | Why | Removed by `--uninstall` |
|---|---|---|---|
| `hooks` | The hook entries from `settings.example.json` | Starts the [hooks](hooks.md) | Yes |
| `model` | `"opus"` | The default model, set only when no model is set | No |
| `modelSettings` | `effortLevel: "medium"` for `claude-opus-5` and `claude-opus-5-5` | The effort for the default model | No |
| `autoCompactWindow` | `230000` | Compacts the chat at about 200,000 tokens (Claude Code keeps about 33,000 tokens of the window free), during work, so a finished chat is left alone | No |
| `subagentPromptCacheTtl` | `"1h"` | A helper that waits on a long build or test keeps its context cached | No |
| `cleanupPeriodDays` | `120` | Keeps chat transcripts for 120 days instead of Claude Code's 30, because hooks and audits read them | No |
| `attribution` | `false` | Commits and pull requests carry no Claude credit line. Set only when neither `attribution` nor `includeCoAuthoredBy` is set | No |
| `env.CLAUDE_CODE_EFFORT_LEVEL` | `""` (empty) | Lets each helper run at the effort its agent file names (see [The effort picker](#the-effort-picker)) | Yes, when it is still empty |
| `env.CLAUDE_CODE_USE_POWERSHELL_TOOL` | `"0"` | Turns Claude Code's PowerShell tool off, because Nimbalyst's permission popup shows only the word "PowerShell" for it. Windows with Git Bash only | No |
| `permissions.deny` | The rules in the next section | Blocks two built-in helpers and the reading of saved sign-ins and SSH keys | Only the two helper rules |
| `permissions.ask` | Reading or naming a `.env` file | Claude asks you before it opens a `.env` file | No |
| `language` | `"russian"` | Only with `--language russian` | No |

## Denied built-in helpers and files

`permissions.deny` gets these rules:

- `Agent(Explore)` and `Agent(general-purpose)`. Claude Code's two built-in helpers run on the session's own model
  with no limit. Stratus's `worker` and `reviewer` agents do this work instead. `--uninstall` removes these two
  rules, because it removes the `worker` agent too.
- Reading the saved sign-ins of Claude Code, Codex and Gemini (`~/.claude/.credentials.json`, `~/.codex/auth.json`,
  `~/.gemini/oauth_creds.json`, `~/.gemini/google_accounts.json`) and the SSH keys (`~/.ssh/`). Each rule comes as a
  `Read(...)` rule and as `Bash(...)` and `PowerShell(...)` rules for shell commands that name the file. The
  `PowerShell(...)` rules are added on Windows only.

## The effort picker

Nimbalyst starts Claude Code with `CLAUDE_CODE_EFFORT_LEVEL` set from its effort picker. That variable overrides
the `effort:` line of every agent, so every helper would run at the picker's level. The installer sets the variable
to an empty value in `~/.claude/settings.json`, which replaces Nimbalyst's value.

The result:

- Each helper runs at the effort its agent file names.
- The main session runs at the level you set with `/effort` in the chat, or at `modelSettings`.
- Nimbalyst's effort picker no longer changes Claude Code's level. The installer does not change the picker's own
  setting; it only says which level the picker shows.

When you already set `CLAUDE_CODE_EFFORT_LEVEL` yourself, your value stays, and every helper runs at that level.
`--uninstall` removes the variable only when it is still empty, so the picker works again.

## Folders and files

| Place | What goes there | Removed by `--uninstall` |
|---|---|---|
| `~/.claude/hooks/`, `agents/`, `skills/`, `workers/` | Stratus's hooks, agents, skills and the scripts they run | Yes, each file you did not change |
| `~/.claude/scripts/nimbalyst-patch/` | The tools that update and patch Nimbalyst on Windows | Yes, each file you did not change |
| `~/.claude/shared-skills/picture/` | The `picture` skill, only when Codex is used | Yes, each file you did not change |
| `~/.claude/phone/shared/` | Code the phone app's PC program uses, only with `--with phone-bot` | Yes, each file you did not change |
| `~/.claude/CLAUDE.md` | The global rules from `rules/` | Yes, when you did not change it |
| `~/.claude/rules/my-rules.md` | Your own rules, moved out of an existing `~/.claude/CLAUDE.md` | No |
| `~/.claude/setup-state.json` | The record of the install: version, files, your answers | Yes |
| `~/.claude/project-pass.json` | The level `/update-project` brings project folders to | Yes |
| `~/.claude/board-tidy.json` | Board Tidy's keep list, with the `quick-tasks` folder on it | No |
| `~/.claude/setup-logs/` | What each run printed, and the old copies of replaced files | No |
| `~/.claude/setup-source/` | The release versions that `/update-setup` downloads | Yes |
| `~/.claude/hooks/state/`, `state/`, `usage-log/`, `reports/`, `handoffs/`, `video-cache/`, `update-check.json` | What the hooks and skills write while you work: logs, plan use, reports, `/handoff` briefs, `/watch` downloads, the last update check | No |
| `~/.claude/steer/`, `browser-profiles/`, `goals.md`, `disk-tidy.json`, `package-skips.json`, `my-rules-vault.md` | Also written while you work: notes sent to running sessions (`/btw`), the sign-ins `site-login` saves, your goals for `/next-move`, the `/disk-tidy` keep list, the package updates `/update-project` skipped, the rules a tidy moved out | No |
| `~/.claude-archive/` | Old chats that `/disk-tidy` archived | No |
| `~/.phone-app/` | The phone app's keys, log and voice setup, only with `--with phone-bot` | No |
| `~/Projects/quick-tasks/` | A side-work folder for work that belongs to no project: one-off file jobs, quick questions and finding things on the web | No |
| `~/Projects/claude-settings/` | A side-work folder for work on Stratus itself, with `how-to.md` | No |

`--projects <folder>` puts the two side-work folders somewhere other than `~/Projects`. The installer remembers the
folder for later runs. `--uninstall` removes the hook entries from the two folders' `.claude/settings.json` files and
the link to the `picture` skill, but keeps every other file there.

## Plugins and other programs

| Change | Turn it off | Removed by `--uninstall` |
|---|---|---|
| Installs the Claude Code plugins `claude-hud`, `security-guidance`, `frontend-design` and `impeccable`. `security-guidance` is left off until Python 3.10 or newer is on the PATH. | `--plugins no` | No: `claude plugin uninstall <id>`, with the four ids in [What `--uninstall` leaves](../how-it-works/install.md#what---uninstall-leaves) |
| Fetches the `find-skills` skill with `npx`. | `--plugins no` | No: `npx skills remove find-skills -g` |
| Builds the Nimbalyst extensions and puts them into Nimbalyst (see [Extensions](extensions.md)). | `--extensions no` | No: delete each folder under Nimbalyst's `@nimbalyst/electron/extensions` |
| Sets Nimbalyst's theme to Ink Cobalt when no theme was picked yet, or a theme from outside the Ink set was picked. | `--no-theme` or `SETUP_THEME=off` | No |
| Updates Claude Code when npm has a newer version. The install stops when Claude Code stays below the minimum Stratus needs (`claudeCodeMin` in `version.json`). | None | No |
| Points Nimbalyst's chats at your own Claude Code instead of the copy Nimbalyst bundles, so they get Claude Code fixes on the day they ship. It does this only for a version in the same line as the bundled one and not older than it, and never changes a path you set. | `SETUP_NIMBALYST_CLAUDE=off` | Yes, when the path is still the one Stratus set |
| With `--with phone-bot`, while `~/.phone-app/voice.json` is missing, starts the phone app's voice setup in the background: on Windows it installs uv with winget when uv is missing, then uv downloads the speech model (about 480 MB) and its Python packages. The output goes to `~/.phone-app/voice-setup.log`. | Leave out `--with phone-bot` | No |
| On Windows, when Stratus updates, it installs the Nimbalyst version it names and patches it, so Nimbalyst updates through Stratus instead of by itself. | `NIMBALYST_FOLLOW=off`; `node ~/.claude/scripts/nimbalyst-patch/deliver.mjs --off` gives updates back to Nimbalyst | Yes: the original app files go back |

## Auto mode

Step 8 of [the full install](../full-install.md), in a Nimbalyst chat, and `/update-setup` ask once whether to turn on Nimbalyst's auto mode for your projects. `node install.mjs` on its own does not ask. A yes sets the
project's permission in Nimbalyst, not a Claude Code setting. [Checks](../using/checks.md#auto-mode) explains what
it does and how to turn it off.

## On the Pro plan

Claude Code records your plan in `~/.claude.json`. When it says Pro, which has no Fable model, the installer writes
Opus wherever Stratus's agents, skills and rules name Fable.
