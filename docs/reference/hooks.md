# Hooks

Stratus installs 35 hooks into `~/.claude/hooks/`. A hook is a Node.js script that Claude Code runs at a fixed
point: before or after a tool call, when you send a message, before a reply ends, or when a session starts. A hook
can add a note for Claude, ask you first, or send a step back.

22 of the 35 hooks run inside a dispatcher, `hooks/dispatch.mjs`. For each of three events (before a tool call, when
you send a message, before a reply ends), one Node.js process runs every hook of that event's group in turn. The
other hooks each start their own process. A shell command therefore starts 3 Node.js processes and a file edit 4,
not one per hook. The groups are in `hooks/dispatch-groups.json`, and the table's "In the dispatcher" column shows
which hooks they hold. `DISPATCH=off` turns off every hook that the dispatcher runs, the guards included; the hooks
marked "No" keep running.

## Turning a hook off

Each hook has one off switch: an environment variable set to `off` (in any case). Set it in the environment that
starts Claude Code or Nimbalyst; [How to](../HOW-TO.md#turn-a-hook-off) shows the commands. Some switches are also
read from the `env` block of a settings file, because Claude Code may not pass that block on to a hook:

- `FILE_NAME_NOTE`, `VERIFY_GATE`, `VERIFY_GATE_COMMIT`, `VERIFY_GATE_CYCLES` and `VERIFY_PATTERN`: `.claude/settings.local.json`, then
  `.claude/settings.json`, in the project and in each folder above it (for a project inside your home folder, this
  includes `~/.claude`).
- `SETTINGS_GUARD` and `WORKFLOW_FENCE`: `~/.claude/settings.local.json`, then `~/.claude/settings.json`.
- `AUTO_UPDATE` and `NIMBALYST_FOLLOW`: `~/.claude/settings.json` only.

Every other switch is read only from the environment.

## Guards

A hook that fails with an error lets the call through and writes one line to `~/.claude/hooks/state/hook-errors.log`.
A guard is stricter: when it crashes or can't read its input, it refuses the calls it checks, and only those. The
table marks each guard with "A guard." There are 9: `brief-size-guard`, `delete-guard`, `find-guard`, `opencli-readonly`,
`planner-readonly`, `push-key-scan`, `settings-guard`, `sql-guard` and `workflow-fence`.

## All hooks

| Hook | What it does | Runs | In the dispatcher | Off switch |
|---|---|---|---|---|
| `agent-run-log` | Writes one line per helper to `~/.claude/state/agent-runs.jsonl` with its model, effort and result, for the Agents Panel. A helper sent to the background reports its end only into the chat, so its result is filled in before the reply ends. | Before and after a helper, before a reply ends | Partly: before a reply ends | `AGENT_RUN_LOG=off` |
| `brief-size-guard` | Refuses a worker brief too big for one helper's 80-turn limit: more than 8 files to change, 8 separate numbered items, 6 DONE WHEN cases or 6,000 characters. The message names each count and says to split the job into slices. A guard. | Before a helper starts | Yes | `BRIEF_SIZE_GUARD=off` |
| `browser-visible-gate` | Refuses a Nimbalyst browser session opened with `headless: false`, which shows no new window, and points to the `site-login` skill or your own browser. | Before a tool call | No | `BROWSER_VISIBLE_GATE=off` |
| `command-explain` | Makes every shell command end with a plain-words line that says what it does, so the permission popup is readable. It never refuses a command. | Before a shell command | Yes | `COMMAND_EXPLAIN=off` |
| `delete-guard` | Refuses deletes that can take many files at once (`rm -rf`, wildcard deletes, `find -delete`, `git clean -f`, `Remove-Item -Recurse`) outside temp, cache and worktree folders. A guard. | Before a shell command | Yes | `DELETE_GUARD=off` |
| `download-guard` | Sends a plain `curl`, `wget` or `Invoke-WebRequest` download over 50 MB through `workers/download.mjs`, which fetches 32 parts at once. It changes the command and does not refuse it. | Before a shell command | Yes | `DOWNLOAD_GUARD=off` |
| `file-link-gate` | Sends a reply back once when it links a local file in a form Nimbalyst's chat cannot open (a relative path, backslashes, `file:///`). Only inside Nimbalyst. | Before a reply ends | Yes | `FILE_LINK_GATE=off` |
| `file-name-note` | Adds a note when a new file's name or folder breaks the file standard (`skills/file-upkeep/standard.md`), with the proposed name. It never refuses the write. | Before a new file is written | Yes | `FILE_NAME_NOTE=off` |
| `find-guard` | Refuses a search through a whole drive or the whole home folder deeper than 3 levels. A guard. | Before a shell command | Yes | `FIND_GUARD=off` |
| `helper-stopped` | When a helper comes back cut off at its turn limit or with no report, tells Claude to ask it once what is done and to check the files. | After a helper | No | `HELPER_STOPPED=off` |
| `link-gate` | Sends a reply back when it gives a web link that was never opened in the session, at most 3 times for one reply. | Before a reply ends | No | `LINK_GATE=off` |
| `map-brief` | Experimental, and off by default: it acts only while `~/.claude/state/map-brief-trial.json` (`{"until":"YYYY-MM-DD"}`) exists and its date has not passed, and the installer does not write that file. During such a trial, each helper's brief gets at random either the systems map lines for the parts it touches (at most 3 parts, 2,000 characters) or nothing, so the two can be compared. | Before a helper starts | Yes | `MAP_BRIEF=off` |
| `map-drift` | After an edit to a file that backs a link in the project's systems map, says when that link's evidence is gone from the file. | After a file edit | No | `MAP_DRIFT=off` |
| `map-generated` | Refuses a hand edit of a file that a script writes (listed under `generated` in the systems map) and names the command that writes it. | Before a file edit | No | `MAP_GENERATED=off` |
| `map-nudge` | In a project with 100 or more code files and 10,000 or more lines and no systems map, has Claude ask you once whether to build one. Starts a background refresh of a stale map at most once a week. | When you send a message | Yes | `MAP_NUDGE=off` |
| `compact-handoff` | Right after a session's context is compressed, tells Claude to finish the step it is on, commit and hand off to a fresh session with `/handoff`, so a long chat stops re-sending its whole history. Silent in helpers and at other session starts. | At session start, after a compaction | No | `COMPACT_HANDOFF=off` |
| `nimbalyst-notes` | Gives Claude the notes that matter only inside Nimbalyst. Silent in the terminal. | At session start | No | `NIMBALYST_NOTES=off` |
| `no-response-gate` | Sends a reply back once when it has no answer to the message you typed, or when it only forwarded a `/btw` question. After you stop a turn, it tells Claude to answer and start no work. | Before a reply ends, and when you send a message | Yes | `NO_RESPONSE_GATE=off` |
| `opencli-readonly` | Lets only OpenCLI's read commands through, so Claude can search and read with your signed-in accounts but not post, like or follow. A guard. | Before a shell command | No | `OPENCLI_READONLY=off` |
| `picture-in-project` | Refuses a picture shown in the chat from outside the project's `shown/` folder, copies it there and gives the new path. | Before a picture is shown | No | `PICTURE_IN_PROJECT=off` |
| `plan-usage-logger` | Saves your plan's 5-hour and weekly percentages to `~/.claude/usage-log/plan-usage.jsonl` for the usage forecast. Makes no model call. | Before a reply ends | Yes | `PLAN_USAGE_LOGGER=off` |
| `planner-readonly` | Keeps the `reviewer` and `plan-reviewer` agents' shell to reading files and running tests. It runs from those agents' own files, not from `settings.json`. A guard. | Before a reviewer's shell command | No | `PLANNER_READONLY=off` |
| `push-key-scan` | Asks before a `git push` that sends something shaped like a key or adds a key file; gitleaks, when installed, scans the same changes. In a project set up with [`ship-check init`](../using/security.md#pushes-and-deploys), it also refuses a raw deploy command. A guard. | Before a shell command | Yes | `PUSH_KEY_SCAN=off` |
| `question-other` | Makes every question card leave room to type your own answer, and refuses a card with labels you never used or one that asks no decision. | Before a question card | No | `QUESTION_OTHER=off` |
| `repeat-guard` | Tells a helper close to its turn limit to finish and report. | Before a tool call | Yes | `REPEAT_GUARD=off` |
| `session-cleanup` | Records the processes and worktrees a session starts, and lists what it would close when the session ends. It closes them only with `SESSION_CLEANUP=on`. Windows only. | Around shell commands, when you send a message, and at session end | Partly: not after a shell command or at session end | `SESSION_CLEANUP=off` |
| `settings-guard` | Asks you before a session changes one of your Nimbalyst settings (permission mode, default model, theme, extensions and others) with Nimbalyst's own tools. A guard. | Before a Nimbalyst tool call | Yes | `SETTINGS_GUARD=off` |
| `social-route` | Sends a web fetch or search of Reddit or X to the shipped Reddit and X reader (`workers/social/social.mjs`), which reads the threads themselves; when that reader fails, the plain search goes on. | Before a WebFetch or WebSearch | Yes | `SOCIAL_ROUTE=off` |
| `sql-guard` | Asks you before destructive SQL runs through a database client: `DROP`, `TRUNCATE`, and `DELETE` or `UPDATE` without `WHERE`. A guard. | Before a shell command | Yes | `SQL_GUARD=off` |
| `transcript-check` | Says when a new Claude Code version changed the transcript format other hooks read, and names hooks that crashed since the last session. | At session start | No | `TRANSCRIPT_CHECK=off` |
| `update-check` | Checks every 12 hours whether a newer setup is released, says so, and installs a release that asks you nothing in the background. It also has Claude offer `/new-project` in a folder that is not a project (no `CLAUDE.md` or `.git` in it or above it), at most once a day, and `/update-project` in a project set up before the current setup, until you answer. [Other switches](#other-switches) says how to stop parts of it. | When you send a message | No | `UPDATE_CHECK=off` |
| `usage-dashboard-hook` | When your whole message is `usage`, opens the usage dashboard without a model call. | When you send a message | Yes | `USAGE_DASHBOARD=off` |
| `usage-report-hook` | At most once a day, sends an anonymous, content-free count of what the setup doesn't cover yet (missing commands, tools you added, friction, file types, which well-known programs the agent's commands start) — never your prompts, replies, code, file names, paths or project names. Runs in the background. | Before a reply ends | Yes | `USAGE_REPORT=off` |
| `verify-gate` | Sends a reply back once when the turn edited code and ran no build or test after the last edit, or whose JavaScript or TypeScript edits added an import cycle. In a project with a verify skill, it also logs code commits made with no verify run. In a repository that holds `scripts/render-check.mjs`, an edited `README.md`, `README.ru.md`, `CHANGELOG.md` or docs page (not `docs/promo/`) also needs fresh screenshots and a `verdict.md` that starts with PASS in `.proof/<page>/`. | Before a reply ends, and before a commit | Yes | `VERIFY_GATE=off` |
| `workflow-fence` | Refuses Claude Code's own `/deep-research` inside Nimbalyst or a headless run, where it cannot be stopped, and says to run it in the terminal. A guard. | Before a workflow starts | Yes | `WORKFLOW_FENCE=off` |

## Hooks in the side-work folders

Two more hooks run only in the `quick-tasks` folder, from its own settings:

- `finder-link-gate` sends a reply back when it gives a shop or product link that was never opened in the session,
  or a search or front page instead of the item's own page. Off switch: `LINK_GATE=off`, shared with `link-gate`.
- `picture-gate` stops Claude from showing a generated picture that has not passed its checklist. Off switch:
  `PICTURE_GATE=off`.

## Other switches

Some hooks have a second switch for one part of what they do.

- `AUTO_UPDATE=off` stops `update-check` from installing releases in the background. The reminder stays. It is
  read from the environment or from the `env` block of `~/.claude/settings.json`.
- `NIMBALYST_FOLLOW=off` stops Stratus from delivering new, patched Nimbalyst versions on Windows, both after a
  background install by `update-check` and in `/update-setup`. Patches already in place stay; [Nimbalyst updates on
  Windows](../using/install-and-update.md#nimbalyst-updates-on-windows) says how to take them out. It is read the
  same way as `AUTO_UPDATE`.
- The `/new-project` and `/update-project` offers of `update-check` stop in one folder when you answer "Never here"
  on the card, and everywhere with "Never in any folder". From a shell,
  `node ~/.claude/skills/update-project/pass.mjs --skip "<folder>"` or `--skip-all` does the same.
- `HOOK_CRASH_ALARM=off` stops `transcript-check` from naming hooks that crashed.
- `SESSION_CLEANUP=on` lets `session-cleanup` close what a session started. Without it, the hook only lists what it
  would close in `~/.claude/hooks/state/session-cleanup/closed.log`.
- `SESSION_CLEANUP_IDLE_HOURS` sets how long a session's transcript stays unchanged before `session-cleanup` closes
  what the session left. The default is 3 hours.
- `SHIP_CHECK=off` lets a raw deploy command through `push-key-scan`.
- `VERIFY_GATE_COMMIT=enforce` makes `verify-gate` refuse, once, a code commit that has no verify run after the last
  code edit. By default it only logs the commit.
- `VERIFY_GATE_CYCLES=off` turns off `verify-gate`'s import-cycle check alone.
- `VERIFY_PATTERN` is a regular expression that replaces `verify-gate`'s list of build and test commands.
