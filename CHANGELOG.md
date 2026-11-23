# Changelog

Versions are year.release.fix: 26.1 is the first big release of 2026, 26.1.1 a small fix after it, 26.2 the next big release, and 27.1 the first of 2027. Versions 1.0.0 to 1.0.114 came before this scheme.

## [Unreleased]

## [26.5.2] - 2026-11-22

- Nimbalyst: Claude knows the commit tool from the start of a chat, so a commit no longer shows a red "Commit Failed" card above the one that worked. Takes effect after Nimbalyst restarts.

## [26.5.1] - 2026-11-22

- Commits and pull requests Claude makes no longer carry a Claude credit line or link. A credit setting you set yourself stays.

## [26.5] - 2026-11-20

The setup, rebuilt: fewer moving parts, one clear path for a big job, and a check you can press. How it all works now, on one page: `docs/whats-new.md` in the repo. After this update Claude offers a short tour of it in the chat; ask "what's new" any time.

### How work runs
- Claude sizes each ask first (small, medium or big). A medium or big job starts with questions in rounds (`grilling`, replacing `grill-me`), then what done looks like, each line with the check that proves it.
- The main session writes a big job's plan itself and runs it (`/lead`); the separate planner helper is gone. Plans count steps and sessions, never hours. The plan check runs once; the end review checks correctness against the spec, not style.
- A Try it button beside Note runs the project's `verify` check on the last change. When the change has a local page, it opens in a Nimbalyst tab beside the chat. Any local dev page can open there: `node ~/.claude/workers/try-page.mjs <url> --session <id>`.
- In a session's Review panel you can comment on lines of the diff ("+" by a line, Shift+click for a range) and send them all as one message, each with its file and line.
- Notes sent with `/btw` while Claude works are listed back once, show the time you sent them, and a note for after the current work waits as the next turn.
- Say "wait what" (or "не понял") and Claude re-explains its last reply plainly.
- When the same error keeps coming back, Claude is stopped from retrying the same call a third time and asks you what to do, with the error text.
- Helpers: `worker` runs on Sonnet and `blind-reviewer` on Opus, both at medium effort; `stuck-advisor` is gone (Claude Code's `/advisor` does the same). Every helper names its effort.

### Safety
- Every project gets its own local git history, so any change can be undone (`/new-project`, `/update-project`). Secrets, keys and big files stay out.
- One check for every push and deploy (`node ~/.claude/workers/ship-check.mjs init`): gitleaks scans pushes for many more key kinds, key files are kept out of git, and a plain deploy runs through `ship-check deploy`, which lists the upload, stops on env files, source maps and baked-in keys, and checks afterwards that the site serves no `/.env` or `/.git/HEAD`.
- `delete-guard` no longer asks before deleting what Claude made in the session or a path you typed in full. It still asks for recursive deletes of your own files, `git clean`, `git reset --hard`, force pushes and database files.
- The guards fail closed: a guard that crashes or times out blocks the call and names its off switch.
- Claude can click, fill and upload in your signed-in Chrome for a job you asked for, and waits for your yes before anything that sends or publishes in your name.
- A new project's `.gitignore` keeps `settings.local.json` out of git in every folder.

### Faster and quieter
- 23 hooks are gone and the rest run in one process per tool call (a shell call starts one Node process for its hooks instead of one per hook). An update unwires the cut hooks and removes their files; a file you changed stays and is named.
- With Nimbalyst's auto mode on, the setup's notes no longer change a call after its review, so Nimbalyst stops asking about calls the review passed.
- Nimbalyst's chat scrolls smoothly while a turn runs, and a long chat no longer bounces after it opens.
- `/next-move` and `/board-cleanup` start only when typed, so their descriptions no longer take room in every session.

### Files and projects
- Every project has a place for each kind of file: code, `tests/`, `docs/`, `shown/` for pictures to look at, `assets/` for the product's own files.
- `/file-upkeep` catches names that say when a file was made instead of what it does; `file-check.mjs --root` reports the projects folder itself; a new file with a bad name or place gets a one-line note.
- `move-project.mjs <from> <to>` moves or renames a whole project and fixes its worktrees, records and scheduled tasks (`--dry` first).
- `/new-project` no longer hands out a `REVIEW.md`, and `/update-project` no longer offers one.

### Web and video
- `node ~/.claude/workers/read-page.mjs <url>` saves a page word for word as markdown (Firecrawl Local when installed, defuddle otherwise).
- `/deep-research` is refused in SDK runs, where it can't be stopped; run it in the terminal. Obscura is no longer installed, and an update removes it.
- `/watch` says before it downloads its 488 MB speech model; `WATCH_STT=off` skips it.

### Install and README
- The README has a Russian translation (`README.ru.md`), a diagram of how a job runs and a link to the tour.
- The uninstall also removes the downloaded versions in `~/.claude/setup-source`, keeping any file of yours there.

### Gone or moved
- The 23 removed hooks:
  - Reply checks: `code-review-gate` (the automatic reviewer after enough code changes), `next-step-gate`, `run-yourself`, `web-answer-gate`.
  - Helper checks: `budget-gate`, `decided-quote`, `serves-brief`, `worker-size`.
  - Command and read checks: `long-sleep-guard`, `slow-output-gate`, `big-read-gate` (a Read of a big file now gets Claude Code's own answer).
  - Session cost: `context-guard`, `cold-cache`, `background-tasks`, `job-done` and `handoff-brief`'s automatic brief.
  - Nimbalyst: `form-answer`. Systems map: `map-prompt` (a project with a map has one line in its CLAUDE.md on how to look a part up).
  - Reminders: `upkeep-note`, `recheck-dates`, `patch-next`, `pc-tidy-nudge`, `experiment-alert`.
- What you lose: the handoff brief rewritten after each reply (`/handoff` still writes one when you ask), the daily reminder of a stale backup, and the list of worktrees other sessions left. Their off switches no longer do anything.
- `/setup-audit usage` points to Claude Code's `/usage`; the dashboard and the forecast stay.

## [26.4.4] - 2026-11-18

- The phone app's Projects tab lists every project that has sessions. It used to show only the projects open in a Nimbalyst window when Nimbalyst started.

## [26.4.3] - 2026-11-18

- The phone app no longer says Nimbalyst is closed while it is running. Opening Nimbalyst a second time (its icon, or Start on the phone) used to cut the phone off from it; the fix takes effect the next time Nimbalyst is closed and opened.

## [26.4.2] - 2026-11-18

- The phone app's New session button works again (it did nothing when a session had been opened before).
- A message you send from the phone no longer stays at the bottom of the chat: one sent with files clears once the session has it, and one sent to a session that handed its work on says which session took it, with an Open button.

## [26.4.1] - 2026-11-18

- The bot chat has three topics, Inbox, Alerts and Files, made at the PC's sign-in; a topic you delete is made again. Each topic has a pinned Open button, since Telegram on iPhone shows the bot's own Open button only in the All view. A thread Telegram opens without a name ("New Chat") is named after its first item, such as "Photo" or "Link: example.com".
- Notes reach a session sooner. A note that comes while a helper runs reaches the helper too: about its job, it adapts; anything else, it stops early and reports, so the session answers you instead of after the whole helper run. A note sent just as a reply ends wakes the session within seconds, instead of waiting in the message queue while the app finishes the turn (often half a minute or more). The Note button only queues a message when nothing can wake the session, and then says it starts when the reply ends.

## [26.4] - 2026-11-18

- The phone app has a Files tab: folders you make, files added by picking or dropping them (up to 50 MB; secret files such as `.env` are refused), and for each file Download, Send to chat, Copy, Move, Rename and Remove (removed files are kept in a `.removed` folder). Newest files show first, and each folder shows how many files it holds. Files your home PC puts there can be downloaded on another computer through Telegram Desktop.
- The bot chat gets two topics, Alerts and Files; Send to chat puts a file in Files.
- The phone app opens at once: the last Home shows straight away with an "Updating" line while fresh data comes in, and a screen with nothing saved yet shows its outline while it loads.
- On a desktop the app uses the width: two or three columns of sessions and wider Files cards at 1920 and 2560 pixels, and a full-screen button that follows Telegram's own state.
- Code in the chat is easier to read: each block names its language and has a wrap switch and a Copy button that copies the code without its fences; a Text size setting makes chat text and code larger.
- A message you send shows at once with "Sending…", a Jump to latest button brings you back down, and the chat keeps your scroll place when you come back to it.
- Voice notes set themselves up: the install and the update download the speech model in the background when the phone add-on is in place.
- Connection fixes: a phone removed from the PC goes back to pairing with a plain message, retries back off properly, and errors say in plain words what happened (for example "the PC is off or asleep").
- Two guards no longer cost a retry. A Read of a file too big to read at once now returns a 120-line preview (or the asked range, cut to what fits) with a note on the rest, instead of being refused. A helper started from the main session without `run_in_background: false` now simply runs in the foreground instead of being refused.
- When a job is already OK'd, a reply that ends "say go and I'll start the next step" is sent back once to carry on; releases, deploys, payments, messages and deletes still ask.
- A reply that asks you to restart the app or click something so Claude can see whether a change works is sent back once: Claude runs the check itself, and a change that loads only after a restart waits for your own next restart instead of a request. Checks only you can do, such as on a phone, still ask.
- The read-only browser-account guard no longer refuses a command that only mentions its program in a folder path or a longer name, or asks for its help with the output redirected; writes are still caught.
- Each project can have a verify skill that says how to start its app, what to do in it and what proof to show. `/new-project` writes one from four templates (web app, Godot game, command-line or Node tool, data or video pipeline), and `/update-project` offers one to a project with code and none (pass level 5).
- A starter `REVIEW.md` holds a project's rules for the reviewer: what counts as Important, paths to skip, rules to check and past bugs. `/new-project` writes it in a git project and `/update-project` offers it. The reviewer reads it as it was at the commit the change started from, so a change cannot loosen its own review, and it quotes any line a change loosens.
- The verify gate counts a run of the project's verify skill as the turn's check. In a project with a verify skill it also checks each code commit with no verify run since the last code edit; for now it only logs it (`VERIFY_GATE_COMMIT=enforce` refuses it once, and a `Verify: skipped — <reason>` line in the message lets it through). `node ~/.claude/workers/observe-log.mjs` prints the log (`--all` for every line).
- Helpers never edit, weaken or skip a test to get green. A flaky test with no cause found may be deleted, with the reason in the project's `docs/known-failures.md`, never patched with sleeps or retries.
- The reviewer keeps at most 5 Nits and hands a command that shows each Important finding; the lead runs it first, and a finding that does not reproduce goes to you instead of costing a fix round.

## [26.3.3] - 2026-11-17

- The job hook no longer asks you to hand off after every commit once your plan row is done: it counts only the rows of the plan's job table, not a list of your own checks or an old reference table, and a session note written in another row is no longer read as that session claiming the row.

## [26.3.2] - 2026-11-16

- The phone app holds its connection through a workday: the PC program and the page notice a dead link within seconds (the phone sleeping, a Wi-Fi drop, a switch to mobile data) and reconnect on their own, the relay closes links that went silent, and after a reconnect the page gets only what it missed.
- While the phone reconnects, the page stays on one calm connecting screen and says the PC is off only once the relay says so, instead of flipping between "Reconnecting" and "PC off". When the PC program restarts, an open phone is back within seconds, and a newer page shows "Update ready".
- The PC no longer checks the page it is talking to, so a page update can no longer turn the phone read-only. One time only: a PC still on 26.3 or 26.3.1 shows the phone read-only until it runs `/update-setup`.
- A message you sent from the phone no longer stays in the session's queue after Nimbalyst has handed it over.
- A message you send from the phone shows once in the chat, in its place, instead of a second grey copy and a waiting bubble stuck at the bottom.
- A Note from the phone reaches a working session before its next step, as the desktop Note button does, and the photos and files you picked go with it.
- On a Mac or Linux, a Note (from Nimbalyst or the phone) finds the session again; it used to say the session was not active.
- The phone app's screens stay put under your fingers: no pinch zoom, double-tap zoom or dragging the page around, except in a session's chat, which you can still zoom into.
- `setup.mjs join` and `remove` stop the phone app's PC program whichever copy of it is running, and an error that stops the program at start-up is written to `pc.log`.
- In Nimbalyst's Job Tracker, each Needs you row has a Done button that closes the step in one click; a failed write keeps the row and says so.
- Jobs released or cancelled more than 3 days ago archive themselves and leave the job picker.
- Each step row in the Job Tracker shows its session's state (waiting on you, no change since a time, session ended), and "waits on" names the step by its title.
- `/where-are-we` never lists a helper's review under Needs you, and titles each step that waits on you as the exact thing to do.
- Claude sorts each request first: a fix with a clear cause is built straight away, new behaviour or an unclear cause gets a one-page approach for your OK first, and only a big job goes to the planner.
- The planner writes a one-page approach first, starting from the plainest way that works, and writes the job list only after your OK.
- A handoff to a new session keeps your own chores out of its questions.
- Every new test names the behaviour it guards in its failure message, and the helper that writes it breaks that code once to see the test fail.
- Claude Code saves each command you approve with "don't ask again" in `.claude/settings.local.json`, word for word, so a token typed into one ends up in that file. New projects now list it in `.gitignore`, and `/update-project` points out any project where it is missing or already committed, with how to clean it up (pass level 4).
- Every update that asks you nothing now installs itself in the background, Nimbalyst panel rebuilds included; changed panels show the next time Nimbalyst starts (on a Mac, once you type `/update-setup` when the grey line asks), and a panel whose build fails stays queued for the next try. Only an update with a question for you waits for `/update-setup`.
- `/update-project` offers a CI speed pass when a GitHub project's CI takes over 5 minutes at the median: it times each step first, fixes the slowest, and never makes CI faster by hiding failures (the full suite still runs before main; no retries, longer timeouts or skipped tests). New projects name two test commands: a quick one for what changed while you work and the full suite at the end.

## [26.3.1] - 2026-11-16

- The setup's Nimbalyst panels now stay in English, like Nimbalyst itself, whatever language Claude answers you in; with Russian answers they used to come out half-translated.
- With Russian answers, the chat's thinking line no longer goes blank while Claude works.
- Signed out of Nimbalyst, the Account button in the side bar shows its icon again instead of the word "no_accounts".

## [26.3] - 2026-11-16

- 26.3 (Nov 16, 2026): A phone app in Telegram to follow and drive your Nimbalyst sessions (answer questions, stop, queue, pin, attach files, voice), monthly package upkeep without pull requests, tracker notes that reach the work, and wakeups that reach a busy session.
- The phone app replaces the old Telegram inbox bot: a page in Telegram shows your Nimbalyst sessions and lets you follow and drive them from the phone, through a relay that cannot read what the page and the PC send each other. Alerts are the exception: their text (project name and session title) passes the relay unsealed. The `phone-bot` skill now joins your PC with an invite from the bot's owner and pairs the phone with a QR code; it is an add-on, `install.mjs --with phone-bot` adds it. The old bot, its Haiku chat and its `/phone` skill are gone, and joining removes the old bot's start entries.
- The PC tidy-up never stops the phone app's PC program, which is meant to run all the time.
- On the phone, a question card can be folded to its top line (Hide, then Show) so you can read the chat behind it, and an open card never covers more than about 60% of the screen.
- The phone's Home leaves off sessions that have waited on you for over two days; they still show inside their project.
- With the setup's Nimbalyst patch, the phone can answer forms, stop a running turn, remove a queued message and pin sessions (restart Nimbalyst after the update).
- New GitHub projects no longer get a Dependabot file, and the project check stops asking for one: its weekly version pull requests (one per package) are noise for a small team; Claude bumps packages as part of the work.
- Your projects keep their packages fresh without pull requests: once a month, after a commit, Claude updates the small versions silently (kept only when the tests pass), asks once about big version jumps, and tells you about security problems right away.
- Notes you type on a tracker step now reach the work: when a session starts a step or finishes a piece of it, Claude first reads that step's comments and acts on yours (or says why not), without any session watching the tracker in between.
- A wakeup a session scheduled for itself (schedule_wakeup) that fires while the session is still working now reaches it as a note at its next step, the way the Note button does, instead of waiting in the queue until the turn ends. An idle session still gets it as a new message. Takes effect after the next Nimbalyst restart.

## [26.2] - 2026-11-15

- 26.2 (Nov 15, 2026): A new Job Tracker page shows each job's steps with the session you are in open beside it; new `writing`, `grill-me` and `/where-are-we` skills; your project's records tidy themselves; new projects get a git and GitHub preset (pass level 3); and smoother Nimbalyst: no chat lag or jumps when helpers start, question cards stay put, Files mode shows your session, and Read Aloud reads the whole last turn.
- In Nimbalyst's Job Tracker, the session you are in stays open on the right of the tracker page: pick another session on the left to change it, drag its edge to resize it smoothly (300 to 640 px), and hide or show it with the Chat button. Its phase and prompts buttons sit in a band of their own there, so no reply is hidden under them.
- In Nimbalyst, Files mode's chat now shows the session you are in each time you open Files mode, instead of an older chat of the project (restart Nimbalyst after the update).
- In Nimbalyst, an open question card stays put while the session keeps working above it, and still moves when you open a row above it yourself (restart Nimbalyst after the update).
- In Nimbalyst, starting several helpers at once no longer makes the chat lag, jump or go blank: each helper card shows at its final size straight away, the Agents panel extension stops redrawing itself many times a second while helper cards are on screen, and tool and helper cards stay where they first showed when the reply text arrives (it comes in below them) instead of all moving into the text at once (restart Nimbalyst after the update).
- In Nimbalyst's right panel, the Trackers and Agents & commands sections can be resized by dragging the line between them (or with the arrow keys once it has focus); the split is kept after a restart, shrinks to fit a smaller window, and the Trackers list always ends on a whole row.
- New `writing` skill: emails, posts, READMEs, profiles, resumes and other text people will read now start from your facts and your own voice, and get checked for current signs of machine-written text (with a small checker script that marks phrases to look at and rewrites nothing).
- Your project's records now stay tidy on their own: after a commit or an edit of `HANDOFF.md`, at most once a day per project, Claude trims a `HANDOFF.md` over 120 lines to the current state, fixes or drops paths in its notes that no longer exist, and moves a decision that a new entry replaces to the archive, without asking you and with one "Upkeep:" line in its reply (the new `upkeep-note` hook; `UPKEEP_NOTE=off` turns it off).
- A project's `DECISIONS.md` no longer grows without end: once it passes 200 lines or 25 KB, Claude moves its sections word for word into topic and dated files in `docs/decisions/` and keeps a short index at the root. The new script checks that no line is lost or doubled and changes nothing when that check fails; sessions, hooks and the Systems map read both places.
- In Nimbalyst, the file viewer's close cross stays at the end of its row when the full-screen button is shown (the Ink themes extension).
- Two new Nimbalyst fixes: the chat no longer pulls you back to the end while a reply comes in, and "Jump to question" goes to the newest question card, once (restart Nimbalyst after the update).
- In Nimbalyst's agent view, the right pane's "Edited Files" is now called "Files & agents", and its close cross on Review, Chat with Session or the file viewer goes back to it instead of closing the pane.
- The Ink themes menu lists the dark themes first, then the light ones, each marked "(dark)" or "(light)".
- In the Agents & commands list, a long "what it's doing now" line is cut with "…" instead of running past the panel's edge.
- A helper that has been on one step for over 2 minutes now shows that step and how long ("running a command (Bash) for 4m") instead of "quiet for 4m", which read as stuck.
- A new Job Tracker extension turns Nimbalyst's tracker into one page per project for the job in hand (a job is any work over more than one session): its name and goal, how many steps are left with a bar, then what needs you, what is running and what is left, each in its own fold. A picker switches between open jobs or shows them all at once. A step that asks you to read a file opens it in one click, and a step with a session opens that session. A step's own view is calmer too: one main button that opens its session, the rarely used fields and the history folded away.
- The Commands button now holds fourteen commands in four groups, most-used first: lead, grill me (a new skill that questions a plan until it holds), next move, where are we and board cleanup; new project, update project, systems map and untangle; setup audit, update setup and backup; PC tidy and disk tidy. Setup audit opens its checks in place (health, usage report, prompt audit, project scan, and chat review and full review in the setup folder), and `/setup-audit prompt` is the new prompt audit.
- The whole Nimbalyst window reads as one design under the Ink themes: no text under 12 px, one size per kind of text, helper and question cards in two sizes, no coloured edge stripes, and the accent colour only on the main button, the selected item and a bar's fill. Error pop-ups are readable in the dark themes, with a quiet "Copy Details" button, and the usage rings in the side bar start at 12 o'clock and fill clockwise again.
- The Agents & commands list shows a new thinking word each turn and its dots stay in step, and the "Needs you" bar sits in line with the chat box. In the usage pop-up the hour chart shows only the current plan, the day chart is in % of the weekly limit, and Fable's share reads as a cap inside the week; the Sonnet 5.5 and Haiku 5.5 prices are corrected.
- The Systems map draws part names larger and keeps its zoom when a part's card opens. `/where-are-we` writes tracker steps in plain words, checked by a text check, and a session that runs a release step links itself to that step.
- Replies stay contained: results and your choices, not the work behind them, and things named by what they are instead of by ids you haven't seen.
- The Systems map gives sessions less and better: a helper's brief gets only the parts it names by file, name or folder, in at most 2,000 characters instead of 7,000; your message now gets the code parts it names, but no longer a how-to note that only repeats a skill or rule the session already has; a match word that is one common word ("release") is ignored and flagged by `--check`; and planners and reviewers look a part up only when their brief's map lines miss it.
- The usage pop-up is smaller and drops the long note under a model's cap row.
- The right side bar wraps its text on a narrow panel instead of cutting it at the edge, and a helper row keeps its time and model until they really don't fit (the fit check measured in the wrong type size and left a wide empty gap).
- The blind reviewer loads again: its description is now valid YAML, so Claude Code no longer drops it, and a test checks every agent's frontmatter.
- Fewer needless refusals: the commit check reads commits made with Nimbalyst's commit tool correctly, and no longer takes a commit message word after "add" for a file; planners and reviewers may run read-only git listings (`git branch --show-current`, `--merged`, `git tag -l`, `merge-base`, `rev-list`, `for-each-ref`) while anything that creates, moves or deletes stays refused; the background-tasks hint now says to pass `run_in_background: false`; and the big-read check names the real reason when a ranged read asks for too many lines.
- New `/where-are-we` skill: how much of a job is left, read from the Nimbalyst tracker, with the tracker brought up to date.
- Read Aloud is simpler: one Read aloud button at the end of the last finished turn, and it reads the whole turn. Hands-free mode and the `/voice` command are gone.
- The number on a project's icon in Nimbalyst's left rail now counts only sessions that finished since you last had that project open, and sits on the icon's corner instead of on its ring.
- In Nimbalyst, Claude no longer gets a repeated "background tasks have settled" prompt for results it already has (restart Nimbalyst after the update).
- The upkeep check now also catches a HANDOFF.md that is too big in size, and tells every session that leaves it too big, not just the first one each day.
- `/new-project` asks where the project's history lives (local git by default) and sets up git, branches, pull requests, CI and Dependabot to fit the project; `/update-project` checks the same things (pass level 3).
- Commit messages stay clear: the commit check refuses a subject over 72 characters or one that names an internal plan step or a session (`COMMIT_SUBJECT=off` turns it off).
- Each finished reply gets a copy row under it, and a Note button shows while a reply streams.
- `/backup` setup explains how to turn on cloud storage first and can read its keys from a file when pasting fails; `/update-project` works with organisation repos and with project folders inside a bigger repo.

## [26.1] - 2026-11-13

Each project's Systems map now holds its topics and how-to things, and a new `map-prompt` hook adds the matching ones to your message so Claude starts from the right files; `/update-project` brings an older project folder up to the current setup (pass level 2); a new `/backup` copies your setup and the projects you pick to your own Backblaze B2 storage, locked with a password only you keep; `ask-anything` and `internet-search` become one `quick-tasks` folder; Nimbalyst updates through the setup with its fixes; sessions close the servers and browsers they started; question cards that ask no decision are refused; new `blind-reviewer` and `stuck-advisor` helpers; `worker-high` is now `worker-refactor`; and on the $20 Pro plan the Fable helpers run on Opus instead of failing.

## [1.0.114] - 2026-11-12

When you tell Claude to stop, it no longer carries on after the turn is cut off until you say go, notes you send while it works are listed back in its reply, long waits run in the background so your messages still get through, the tests run quietly side by side, and `/disk-tidy` starts correctly through linked folders.

## [1.0.113] - 2026-11-11

`/disk-tidy`, the file check and the version check now work when the temp folder has a short Windows name or sits behind a linked folder on macOS, and version lookups no longer hit GitHub's rate limit.

## [1.0.112] - 2026-11-10

`/disk-tidy` finds what fills the disk and clears it item by item with your yes, `/file-upkeep` checks a project's file names and places against one standard and new projects, reports and notes are created by it from the start, helpers run at their own effort level instead of the session's, a guard that crashes now stops the action instead of letting it through, skills whose headers were silently dropped load again, replies use short paragraphs with one idea each, and helpers write their reports for a reader who did not see the work.

## [1.0.111] - 2026-11-10

Helpers that write code now run Opus at high effort through a new `worker-code` helper, since public coding tests score it as well as Fable at medium for less usage; Fable keeps the planner, the reviewers, long refactors, deep research, charts and maths.

## [1.0.110] - 2026-11-10

In Nimbalyst 0.83 the Theme button opens its menu again under the Ink themes, the side buttons line up in rows with one icon size, a long refactor goes to a new `worker-high` helper on Fable at high effort, `/pc-tidy` also stops the shells, watchers, headless browsers and scripts that finished sessions left behind and names ports a closed program still holds, and screen reviews zoom in on small parts and catch icons of different sizes side by side (restart Nimbalyst after the update).

## [1.0.109] - 2026-11-09

The planner and reviewers run Fable at high effort and helpers that write code or do deep research run Fable at medium (Claude Code 2.1.321 or newer and a Max plan are needed; the Fable advisor the last update turned on is off again, and `/advisor fable` turns it back on), your own rules move to their own file on an update instead of being lost, small fixes install themselves (`AUTO_UPDATE=off` stops that), a `git push` that would send a key or token asks you first, Word, PowerPoint and Excel files are read as Markdown, and the size reminders in a long session go to Claude instead of to you.

## [1.0.108] - 2026-11-08

In Nimbalyst, a chat you scroll up in now stays where you put it while Claude keeps writing, instead of jumping back to the end on every new line (the Agents Panel extension; restart Nimbalyst after the update). The planner also lists what needs your OK, and a forwarded message shows as one short line.

## [1.0.107] - 2026-11-08

Screen reviews catch the look of AI-made design, a new screen starts from a short design plan, web pages can be read word for word, a refused large Markdown file shows its headings, `/setup-audit memory` checks saved memories against the code, Claude drops a suggestion that something earlier in the chat made pointless and names what it skipped, and after a finished piece of a bigger job it hands the next one to a fresh session it opens itself, so long builds stop piling up compactions.

## [1.0.106] - 2026-11-07

Sessions no longer stall after a background notice: a tool call the app turned down on its own is sent again instead of being read as your refusal, and helpers that run side by side now run in the foreground, so they can no longer die half done when the reply ends.

## [1.0.105] - 2026-11-07

The planner now sizes each step by what it has to decide instead of by tool calls: a design gets its own step before anything is built, pieces that belong together stay with one helper, and you see the whole plan (how many helpers, on which model, what each designs or builds) and can cut or split steps before any helper starts. A design you will look at waits for your OK, the 64k cap on one reply from 1.0.104 is taken out again, and the board cleanup reminder is gone.

## [1.0.104] - 2026-11-07

Helpers put their file on disk early and in parts, the planner splits a big design into parts, a helper near its context limit can still save its work, and one reply was cut at 64k output tokens (taken out again in 1.0.105).

## [1.0.103] - 2026-11-06

/watch works on Instagram links, the usage report shows how much of the input came from the prompt cache and what made it start over, and helpers now run Opus by default, with Sonnet only for mechanical bulk work.

## [1.0.102] - 2026-11-06

A question form that names a file without its folder no longer gets a link to a file that is not there, and the usage dashboard ships with its design file (DESIGN.md) for anyone restyling it.

## [1.0.101] - 2026-11-06

On macOS the check that an edited script was run reads Windows-style file paths correctly, and the tests pass there again.

## [1.0.100] - 2026-11-06

The whole setup is rebuilt from shared parts so it breaks less, a new /untangle-codebase command does the same for your own projects, and a security pass closes holes: the OpenCLI read-only check can no longer be talked around, a claude.exe placed in a project folder is never run or handed to Nimbalyst, Git runs without a shell, and updates never drop to plain http. The chat and usage reports now cover 14 days, project settings in settings.local.json and parent folders count, extension installs stop with a clear message when Nimbalyst is missing, helpers handle background jobs and finished-job notices better, question forms are repaired instead of refused, and the homepage has a new film.

## [1.0.99] - 2026-11-06

The usage dashboard shows plan use and token use by plan week (this week, last week, the weeks before) with this computer's part of each, opens as a full panel from the Usage icon in Nimbalyst, and builds in seconds instead of half a minute.

## [1.0.98] - 2026-11-05

The review-gate test builds file names the way the hook does, so it passes on macOS too (1.0.97's fix was not enough).

## [1.0.97] - 2026-11-05

The tests pass on macOS again (one review-gate test assumed Windows file names).

## [1.0.96] - 2026-11-05

An update moves Nimbalyst to the Ink Cobalt theme once if you were on another one, sign-ins open a real browser window you can see, a new /design-system skill keeps a project's look in one DESIGN.md, and the rules ask you for a file or link when you could hand it over faster. Small rule edits no longer need a reviewer, and the plan logger checks every 30 seconds once you pass 70% of your week.

## [1.0.95] - 2026-11-05

Tests now pass on a fresh machine and on macOS, and on a Mac a big file you name in a message gets its one read, a hook crash is logged, and links and forms know which project a file is in.

## [1.0.94] - 2026-11-05

The systems map's hand-edit check no longer flags a script's own rerun that came in through a merged branch, and it names a listed script that has no commit yet.

## [1.0.93] - 2026-11-05

A file a script writes is listed in the project's systems map: a hand edit of it is refused with the script to change instead, and the map's check names one already edited by hand, so the next run can't bring old text back.

## [1.0.92] - 2026-11-05

Nimbalyst's chats now run your own Claude Code instead of the copy Nimbalyst bundles, so they get Claude Code fixes the day they ship rather than days later with a Nimbalyst release.

## [1.0.91] - 2026-11-05

Claude no longer stops after one finished step when you asked for the whole job, catches a reply that says a helper is running when none is, notes each helper's model, explains every shell command in a short capitalised line, and shows a project's next-release notes when a session starts.

## [1.0.90] - 2026-11-05

Every button in the Nimbalyst side bar has a short name under its icon, the extensions' too; the theme menu stays open while you try themes; a question form missing a box to type in gets one added instead of showing up twice.

## [1.0.89] - 2026-11-05

A Systems map panel in Nimbalyst shows your project's parts and links and marks the links whose code changed; Board Tidy archives finished sessions by itself; the Usage Plan pop-up is easier to read; Read Aloud shows one play strip per reply instead of one per paragraph; Commands asks before starting the same command twice; the Ink themes are refreshed.

## [1.0.88] - 2026-11-05

Updating Claude Code from inside a Nimbalyst session works: Nimbalyst's own no-update setting no longer blocks the setup's update step.

## [1.0.87] - 2026-11-05

Fewer wasted tokens: helpers run in the foreground unless they really run beside other work, a helper near its context limit finishes and reports instead of compacting, the installer and /update-setup keep Claude Code itself up to date, notes from the Note button or /btw interrupt a busy session only where it matters, and the usage report shows where wake-ups and big helpers spend.

## [1.0.86] - 2026-11-05

Replies arrive in one piece: while background jobs still run, a finished job no longer gets its own small status update, and you get one complete answer when everything is done.

## [1.0.85] - 2026-11-04

The update reminder now says how many releases you are behind and what they bring, so an update you skipped for weeks shows what you are missing. A short reply for you to type back is no longer taken for a shell command, and a starting planner says how long a plan takes.

## [1.0.84] - 2026-11-03

The "background task settled" prompt for work already reported now gets a short plain status reply instead of being refused, so Nimbalyst no longer shows a raw warning where the reply should be.

## [1.0.83] - 2026-11-03

Fewer wasted turns after background jobs: the "background task settled" prompt is refused when the work was already reported, and helpers now run in the foreground unless a step really runs beside another. A session that just finished a job is told to start the next one fresh, a helper that has grown large is told to finish and report, and the usage report counts these.

## [1.0.82] - 2026-11-03

The review-gate fix of 1.0.81 now also works where the temp folder has two names (macOS, short Windows paths).

## [1.0.81] - 2026-11-03

The review gate no longer asks for a review of files another open session edited, so running several sessions at once stops costing a reviewer for work this one never touched.

## [1.0.80] - 2026-11-03

A procedure done a third time now becomes a skill with one line in the project's CLAUDE.md saying when to call it, and a new hook reminds the agent to add that line whenever a skill is written.

## [1.0.79] - 2026-11-03

The rules file is about a quarter shorter, Nimbalyst-only notes now load only in Nimbalyst, and a helper job over 50 tool calls is refused and has to be split.

## [1.0.78] - 2026-11-02

Voice typing now tells you to pick Whisper Large v3 Turbo in Handy, which transcribes more accurately at about the same speed and handles Russian as well as English.

## [1.0.77] - 2026-11-02

Long reading now goes to Claude's own capped Sonnet helpers instead of outside workers that often failed, and an update removes those workers and the Antigravity hook they needed; the planner writes the job list with each step's helper, the reviewer names what triggers each Important finding, and blind-review is now blind-screen-review, for screens only.

## [1.0.76] - 2026-11-02

/court is gone and an update removes it, a hook that crashes now leaves a trace and the next session tells you, and the rules file is a little shorter.

## [1.0.75] - 2026-11-02

Code edited with no build or test after it now stops the session once, a big change is reviewed before a push, one /setup-audit replaces the five audit skills and can show how your questions and reviews really went, the rules are shorter, hooks that watch your wording now hear Russian too, an update moves a Sonnet install to Opus medium with a one-line undo, the installer checks Git Bash and Node, and the free worker reads a .env file only when you ask for it.

## [1.0.74] - 2026-11-02

A build or design request now goes to a planner first in every project, however loosely it's worded, a helper cut off at its limit no longer counts as finished, the review gate closes its gaps and keeps work due across a question, the free worker can't reach your login or the web, new installs start on Opus at medium effort and keep logs 120 days, and the phone bot, shared usage and read-aloud are now add-ons.

## [1.0.73] - 2026-11-02

Workers start lean and take the project's rules from their brief, every recommended option gets a second look before you see it, one reviewer runs by itself on bigger changes, a systems map tells helpers what their work connects to, and on Windows /pc-tidy and a new Commands button show what is holding the computer's memory and stop what finished sessions left behind, with a reminder to restart Nimbalyst after 12 hours open.

## [1.0.72] - 2026-10-31

A note sent to a session waiting on a background job now reaches it within seconds, and the job keeps running.

## [1.0.71] - 2026-10-31

Long chats now compact themselves while they work and leave finished chats alone, the Note button shows a press at once and says when the note arrives, and a file you name in a prompt can be read whole once past the size guard.

## [1.0.70] - 2026-10-30

A new tour film and a rewritten README show the whole setup, node install.mjs --uninstall takes it out again, the licence now allows use at work, /blind-review checks any big piece of work and not only pictures, and /btw can name the session a note goes to.

## [1.0.69] - 2026-10-30

A long-running session past 300k tokens is now told to finish the step it is on and stop, and another session can no longer pile new work onto it, so one job can't quietly eat your usage.

## [1.0.68] - 2026-10-30

Long lines in chat tool cards now wrap instead of running off the card, and the Note button sends pasted images and files along with the note, works in a new tab, and says Sent only once the note has arrived. The free worker takes a long task as a file, so it no longer fails to start on Windows, and tries once more when a run ends on a tool it may not use. The web-answer and run-yourself checks raise far fewer false alarms, and voice typing now pastes the dictation with Ctrl+V instead of typing it key by key, so a dictation that lands in the wrong place no longer fires a shortcut for every letter.

## [1.0.67] - 2026-10-30

The Usage Plan panel no longer shows a "Command failed" line on a long chat history: it gets its numbers in under a second, and a refresh that does fail says so in a plain sentence.

## [1.0.66] - 2026-10-30

A note sent to a busy session now counts as delivered only when it is really in that session: one lost to a cancelled tool call is sent again, the sender's message says Delivered or Queued instead of Sent, and the sender is told about any note that didn't arrive. A picture shown in the chat stays there: it is shown from the project's `shown` folder, so cleaning up a scratch folder no longer leaves "File not found".

## [1.0.64] - 2026-10-29

The Note button now reaches a session that runs in a git worktree; it used to refuse it as not active.

## [1.0.63] - 2026-10-29

With several Nimbalyst windows open, a queued /compact or forwarded note now arrives once instead of once per window, and a lead session stops messaging finished helpers, so their reports no longer come back again.

## [1.0.62] - 2026-10-29

A session that compacts itself now says so at the end of its reply, so the /compact that follows is no surprise.

## [1.0.61] - 2026-10-29

The Note button now stays level with the Send button when the chat box grows, and the README tour video is a real player with a seek bar.

## [1.0.60] - 2026-10-29

A long session now compacts itself while its cache is warm, with a focus line that keeps your own messages, open asks and the next step, and moves to a fresh session only after an hour idle. After a handoff, a message you type in the old session and the reports of its helper sessions are forwarded to the new one, and the brief no longer copies those reports. The Commands extension gets a **Note** button next to Send that reaches a busy chat. A link to a file outside the open project is now written as a path in code, since Nimbalyst cannot open it. A new `blind-review` skill has reviewers who see only screenshots rank the flaws of a page or design before you call it done, `/chat-review` ranks eight kinds of incidents with quotes, and the rules gain a list-first reply to a message with several asks, a model and effort ladder, one rerun before a failure is real, and a known-failures list.

## [1.0.59] - 2026-10-27

Web research moves off the free Gemini worker, which over 30 days answered only 43 of the 72 questions it was asked and took nearly four minutes to do it. A version or "is X released" question is now a one-second lookup from the place that knows it (`workers/versions.mjs`: endoflife.date, GitHub releases, npm, PyPI, crates, Docker Hub, Maven, NuGet), a list of things from one site comes from that site's own catalogue, and two new checks hold a reply back when it claims something may not be available without having checked, or lists fewer things than you asked for. A status question is also answered by the one call that answers it instead of a full diff or dry run, and a new check stops a command that will run for minutes from piping its output straight into `head` or `tail`, where cutting off the wrong part means running the whole thing again. A fresh install that answers no to both outside workers no longer stops with an error. The usage dashboard also survives a plan change, and file links and question forms got the fixes from the last review.

## [1.0.58] - 2026-10-26

Two new checks before a reply ends: `file-link-gate` sends back file links that Nimbalyst's chat can't open, and `code-review-gate` asks for a `/code-review` after a turn that changed three or more code files. `question-other` also refuses a question with no box to type your own answer and a "look at this" question with no link, `command-explain` adds a stand-in line to a command that has none instead of refusing it, `worker-nudge` refuses uncapped helper types every time, an Antigravity answer that runs out of time is kept as a partial answer, and the rules ask for every question you typed to be answered first.

## [1.0.57] - 2026-10-16

A bigger code change gets a `/code-review` before Claude calls it done, the lead skill's reviewer runs on Opus and tags each finding Important, Nit or Pre-existing, small clear jobs with a check go to a Sonnet helper, and repeat-guard now watches a helper's own steps instead of the main session's.

## [1.0.56] - 2026-10-15

A new `agents-panel` extension makes the Agents & commands list readable and keeps the commit panel inside a narrow sidebar, the theme's New session button follows the Sessions / Files switch, and helpers are named after their job.

## [1.0.55] - 2026-10-15

The licence is shorter: personal, noncommercial use, and you may change your own copy but not publish, share or sell it.

## [1.0.54] - 2026-10-15

The how-to no longer lists find-skills and claude-code-setup as left out (the installer adds them), and the tour video is fixed.

## [1.0.53] - 2026-10-15

The two switched-off checks, `turn-cap` and `build-nudge`, are removed; the README and the changelog are shorter; Antigravity now does web research and no longer stops on files outside its folder.

## [1.0.52] - 2026-10-12

Shorter global rules.

## [1.0.51] - 2026-10-12

`turn-cap` and `build-nudge` are switched off, and `command-explain` has no length limit.

## [1.0.50] - 2026-10-11

A tick no longer counts as a decision against your own words.

## [1.0.49] - 2026-10-11

The phone bot copes with Nimbalyst's connection file going missing.

## [1.0.48] - 2026-10-11

`/full-review` counts rework by helpers.

## [1.0.47] - 2026-10-11

`chat-review` checks its earlier fixes.

## [1.0.46] - 2026-10-11

Two tests updated for the helper rule of 1.0.45.

## [1.0.45] - 2026-10-11

`turn-cap`: a helper session must name its model and keep effort low.

## [1.0.44] - 2026-10-11

`turn-cap`: one helper at a time.

## [1.0.43] - 2026-10-11

`turn-cap`: helpers stay on the cheaper model.

## [1.0.42] - 2026-10-11

A big session is cut instead of reminded, and `cold-cache` warns when the prompt cache has expired.

## [1.0.41] - 2026-10-10

`/watch` on a Mac.

## [1.0.40] - 2026-10-10

The tests pass on GitHub again and the tour video caught up.

## [1.0.39] - 2026-10-10

`build-nudge` counts a session's requests.

## [1.0.38] - 2026-10-10

The session you talk in leads; it does not build.

## [1.0.37] - 2026-10-10

The global rules are half as long.

## [1.0.36] - 2026-10-10

The phone bot's assistant finds Claude Code by itself on Windows.

## [1.0.35] - 2026-10-10

`/watch` starts by itself more often.

## [1.0.34] - 2026-10-10

`/watch`: give Claude a YouTube link or a video file and a question.

## [1.0.33] - 2026-10-10

On a Mac the `/shared-usage` background program starts again after a restart.

## [1.0.32] - 2026-10-10

The phone bot shows buttons for every question with options.

## [1.0.31] - 2026-10-10

`/phone-bot`: your own Telegram bot that saves what you send from the phone and talks to your sessions.

## [1.0.30] - 2026-10-10

The usage pop-up shows who used how much.

## [1.0.29] - 2026-10-10

`/shared-usage`: who used how much of a shared subscription.

## [1.0.28] - 2026-10-10

A language choice, English or Russian.

## [1.0.27] - 2026-10-10

Tests and automation run out of your sight.

## [1.0.26] - 2026-10-10

The free Gemini worker answers when asked to read files.

## [1.0.25] - 2026-10-10

An update is quiet.

## [1.0.24] - 2026-10-10

Commands you always type no longer take up room in every session.

## [1.0.23] - 2026-10-10

The reviewer in `/lead` reports under two headings.

## [1.0.22] - 2026-10-08

A real reference before design work.

## [1.0.21] - 2026-10-08

`/btw` no longer needs a second try when several sessions are open.

## [1.0.20] - 2026-10-08

`/full-review`: one review that ends in choices.

## [1.0.19] - 2026-10-08

The strong model plans, a cheaper one builds.

## [1.0.18] - 2026-10-08

A retry that cannot work is refused, and `/plan-first` handles a big or vague request.

## [1.0.17] - 2026-10-07

A planner on the strongest model.

## [1.0.16] - 2026-10-05

A picture in the chat opens when you click it.

## [1.0.15] - 2026-10-05

Six more colour themes.

## [1.0.14] - 2026-10-05

A handoff brief always has its summary.

## [1.0.13] - 2026-10-05

The plugins and the settings come with the install and with an update.

## [1.0.12] - 2026-10-05

The extensions install themselves.

## [1.0.11] - 2026-10-05

A hook wired by an older copy is moved to the new one.

## [1.0.10] - 2026-10-05

The update check runs every 12 hours.

## [1.0.9] - 2026-10-05

A file you changed stays yours.

## [1.0.8] - 2026-10-05

The tour video shows the new handoff.

## [1.0.7] - 2026-10-05

A long session moves to a fresh one by itself.

## [1.0.6] - 2026-10-05

The tour video is up to date.

## [1.0.5] - 2026-10-05

Five colour themes for Nimbalyst.

## [1.0.4] - 2026-10-04

`/setup-audit` finds what you load but don't use.

## [1.0.3] - 2026-10-04

The reader court.

## [1.0.2] - 2026-10-04

You stay on the model you picked.

## [1.0.1] - 2026-10-04

The update check no longer ends with a Node error on Windows.

## [1.0.0] - 2026-10-04

The setup updates itself, with a version number, a tag for each release and a lighter install.

## Before 1.0.0 - 2026-10-02 to 2026-10-04

the first public setup: rules, checks, skills, workers, starter projects, voice typing and a full install for Windows and Mac.
