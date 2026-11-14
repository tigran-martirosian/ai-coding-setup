# Changelog

Versions are year.release.fix: 26.1 is the first big release of 2026, 26.1.1 a small fix after it, 26.2 the next big release, and 27.1 the first of 2027. Versions 1.0.0 to 1.0.114 came before this scheme.

## [Unreleased]

- Your project's records now stay tidy on their own: after a commit or an edit of `HANDOFF.md`, at most once a day per project, Claude trims a `HANDOFF.md` over 120 lines to the current state, fixes or drops paths in its notes that no longer exist, and moves a decision that a new entry replaces to the archive, without asking you and with one "Upkeep:" line in its reply (the new `upkeep-note` hook; `UPKEEP_NOTE=off` turns it off).
- In Nimbalyst, the file viewer's close cross stays at the end of its row when the full-screen button is shown (the Ink themes extension).
- Two new Nimbalyst fixes: the chat no longer pulls you back to the end while a reply comes in, and "Jump to question" goes to the newest question card, once (restart Nimbalyst after the update).
- In Nimbalyst's agent view, the right pane's "Edited Files" is now called "Files & agents", and its close cross on Review, Chat with Session or the file viewer goes back to it instead of closing the pane.
- The Ink themes menu lists the dark themes first, then the light ones, each marked "(dark)" or "(light)".
- In the Agents & commands list, a long "what it's doing now" line is cut with "…" instead of running past the panel's edge.
- A helper that has been on one step for over 2 minutes now shows that step and how long ("running a command (Bash) for 4m") instead of "quiet for 4m", which read as stuck.
- The Systems map gives sessions less and better: a helper's brief gets only the parts it names by file, name or folder, in at most 2,000 characters instead of 7,000; your message now gets the code parts it names, but no longer a how-to note that only repeats a skill or rule the session already has; a match word that is one common word ("release") is ignored and flagged by `--check`; and planners and reviewers look a part up only when their brief's map lines miss it.

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
