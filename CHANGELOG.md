# Changelog

What changed, newest first, and what it gives you.

## Version 1.0.20, October 8, 2026

- **`/full-review`: one review that ends in choices.** New command in the `claude-settings` folder. It measures a week of work: where the usage went, which model did which kind of work and what another split would have cost, where the time of each turn went, the turns you pushed back on, failed tool calls and how big the chats grew. A free worker reads the chat digests for wrong assumptions and for answers that came too slow or too fast. The result is a short report and one form with options, each with its number; only what you tick is changed. A Full review button comes with the commands extension.
- **A fresh chat at 200k instead of 250k.** `context-guard` now warns at 150k and moves the work to a fresh session when a reply ends past 200k. Measured over a week, 31% of all usage sat in requests sent with more than 200k of context. `CONTEXT_GUARD_K` and `CONTEXT_GUARD_AUTO_K` set your own limits.
- **The catch-all agent type gets the same first-try block as the search agents.** A `claude`-type helper has no turn limit and runs on the session's own model; measured runs averaged over a million tokens each. `worker-nudge` now sends the first try back and points to the capped `worker` helper. Repeating the call goes through.
- **One rule added:** read a file outside the project before editing it. A refused edit is a request spent for nothing, and a week of chats held about a hundred of them.
- **`/chat-review` reads again with Antigravity.** The reader is started in the digest folder, because Antigravity only reads files under the folder it runs in; before, every digest failed. The reader also answers two more headings: where the reasoning went wrong, and where the pace was off. A failed read now prints the worker's own reason.

## Version 1.0.19, October 8, 2026

- **The strong model plans, a cheaper one builds.** New check `build-nudge`: in a main session on Opus or Fable, the edit that comes after three edit steps in one turn is sent back once, with how to brief a `worker` helper (Sonnet, or Haiku for mechanical edits): the files, the exact structure to write, what must not change and the check that proves it. Repeating the call goes through, so small jobs are not held up. Measured over a week, turns with three or more edit steps were two thirds of the cost, because every step re-sends the whole conversation at the strong model's price.
- **Lookups in a row go out in one go.** The same check sends back the read, search or page fetch that comes after four lookup steps in a row and points to the free worker or a Haiku helper. Once per turn as well.
- **It leaves the rest alone.** Helpers, sessions on Sonnet or Haiku, and edits to the project's record files (`HANDOFF.md`, `DECISIONS.md`, memory notes) are never held up. `BUILD_NUDGE=off` turns it off; `BUILD_NUDGE_EDITS` and `BUILD_NUDGE_LOOKUPS` change the two counts.
- **One rule added** in `rules/CLAUDE.md` saying the same in words.

## Version 1.0.18, October 8, 2026

- **A retry that cannot work is refused.** New check `repeat-guard`: when the same call has failed three times with the same error, a fourth try of that call is sent back, and the agent has to take a different approach or ask. It also reminds the agent once when a single file is edited six times or read four times in one turn. `REPEAT_GUARD=off` turns it off.
- **A clearer message for a command that is too long.** `command-explain` now says the command itself gets five lines in the permission popup and gives the two steps: save the script to a file first, then run it with one short command.
- **`/plan-first` for a big or vague request.** Claude says what it understood and why, names the shortest route and what could go wrong, shows the plan in a form and starts only after your yes.
- **A "Wasted requests" section in `/usage-report`.** It shows requests per message, the longest turns, streaks of failures, hook blocks by reason, requests that only set the session board or only loaded a tool, and cached re-reads shown apart.
- **`/project-scan` and `/new-project` check where the data lives.** A project that keeps a database, a log or data files should say where each one is, as a full path, and the command that reads it.
- **Three rules sharpened** in `rules/CLAUDE.md`: a fix that brings the same error back twice has failed and the third step is a different approach, the command in a permission popup gets five lines, and the board update goes together with the last tool calls instead of in a request of its own.

## Version 1.0.17, October 7, 2026

- **A planner on the strongest model.** New agent `planner` ([agents/planner.md](agents/planner.md)): it runs on Fable, reads files, changes nothing and stops after 15 turns. The main session asks it for the plan when the plan is the hard part (a big job split across child sessions, or a change that is hard to undo) and then does the work itself with the cheaper helpers. Only the plan runs on the expensive model, and it starts from a short brief instead of the whole chat. One real call on a small task cost about 25 cents at API prices.
- **Its brief gives the situation and leaves the approach open.** The `lead` skill says what goes in (your request in your own words, what exists, the decisions you really made, what is still open) and what stays out (the main session's own solution, guesses dressed up as constraints, step lists). When the plan comes back, the main session tells you where it differs from its own view.
- **Needs Fable on your plan.** Without it the call fails, the session says so and writes the plan itself.

## Version 1.0.16, October 5, 2026

- **A picture in the chat opens when you click it.** Nimbalyst shows a picture small from any folder, but the enlarged view only loads files inside the open project, so a picture from the temp folder opened as an empty box. A new check, `picture-in-project`, sends such a picture back and has the agent copy it into the project first. `PICTURE_IN_PROJECT=off` turns it off.
- **Two themes replaced.** Ink Saffron and Ink Slate looked too much like Ink Graphite. In their place: Ink Noir (black and white only, with a white button) and Ink Neon (plum black, hot magenta, electric cyan links). Still eleven themes. If you had picked Saffron or Slate, pick a theme again after the update.

## Version 1.0.15, October 5, 2026

- **Six more colour themes.** Ink Ember (dark wine and rose), Ink Frost (light, cool white and slate blue), Ink Saffron (charcoal and gold), Ink Cobalt (night blue), Ink Blossom (light, blush and berry) and Ink Slate (slate grey and tangerine) join the first five. That makes eleven, eight dark and three light, and each passes the same reading checks.
- **The theme menu stays short.** The Ink themes fold into one "Ink themes" row of Nimbalyst's Theme menu. Press the row to unfold them; it also names the theme that is on.
- **`/new-project` knows where to look for design references.** A project with a web UI gets Designeer (designeer.xyz) written into its tools: a free list of design galleries, component libraries, and type and colour tools, to look at before a new page or a redesign.
- **The tour video shows the eleven themes.**

## Version 1.0.14, October 5, 2026

- **A handoff brief always has its summary.** The brief was written first and the summary added in a second step, and that step could be skipped, which left the next session a brief with an empty "Where we are". Now the summary is written first and the brief script takes it in (`--summary <file>`); without one it writes nothing and says why.
- **`/chat-review` works with any worker.** Its reader called Codex directly, so without Codex every project came back as failed. It now goes through `ask.mjs` and uses whichever worker is set up, Codex or Gemini.
- **Two more command buttons.** Update setup starts `/update-setup`, and Chat review shows in the `claude-settings` folder and starts `/chat-review`. A button can now be hidden on one computer (`HIDE` in `src/own.ts`).

## Version 1.0.13, October 5, 2026

- **The plugins and the settings come with the install and with an update.** `node install.mjs` used to leave the plugins and the Claude Code settings to the full install, so a setup put in place with the installer alone never had them. Now the same run installs the four plugins (`claude-hud` on; `claude-code-setup`, `superpowers` and `context7` switched off until a project needs one) and the `find-skills` skill, sets the model to Sonnet if you never set one, and adds permission rules: the agent can't read saved sign-ins or SSH keys and asks before it reads a `.env` file. A plugin is handled once, so one you remove or switch on later stays as you have it. One that fails is named and the rest of the install goes on. `--plugins no` leaves them out.
- **`/update-setup` finishes what a script can't do.** The settings inside Nimbalyst (the four project folders opened, the default model, worktrees and the terminal) and voice typing need a chat. The installer now names them once, and `/update-setup` carries them out: it asks whether you want voice typing, and which of the five themes you want, and switches to it.

## Version 1.0.12, October 5, 2026

- **The extensions install themselves.** `node install.mjs` used to copy the files and leave the Nimbalyst extensions as three commands each. Now, when Nimbalyst is installed, the same run builds the themes, the usage ring and the command buttons and puts them into Nimbalyst, and an update rebuilds only the ones that changed. Quit Nimbalyst and open it again to see them; nothing looks different until you pick a theme. Read Aloud is rebuilt only where it is installed already. A build that fails is named with its last lines and the rest of the install goes on. `--extensions no` leaves them out.

## Version 1.0.11, October 5, 2026

- **A hook wired by an older copy is moved to the new one.** If your settings started one of the setup's hooks from another folder inside `~/.claude`, the installer saw the name, left the wiring alone and the new copy was never used. Now it points that wiring at the installed copy and says `hook repointed`. A script outside `~/.claude` is yours and is not touched.
- **A worker that is refused for your location is left alone for half an hour.** When Gemini or Codex answers that your location is not supported, `ask.mjs` now says so and skips that worker for 30 minutes, the same as when it is out of usage, so each call no longer waits for it to fail.

## Version 1.0.10, October 5, 2026

- **The update check runs every 12 hours.** It was once a day. A release now reaches you within half a day of using Claude Code, and the reminder comes at most that often.

## Version 1.0.9, October 5, 2026

- **A file you changed stays yours.** Until now an install or an update replaced every one of the setup's files, also a hook or a skill you had edited, and left yours only as a dated copy. Now the installer remembers what it wrote. A file that is no longer what it wrote is left alone, and so is a file you had under the same name before the first install. The run ends with the list `Kept as yours`. `--replace <name>` takes the setup's version of one file, `--replace-all` takes all of them and the rules, and `/update-setup` asks which you want. A setup installed with an earlier version is updated the old way one more time, then its files are on record.
- **Every run that changes something is saved.** What the installer printed goes to `~/.claude/setup-logs`, and its last lines count the files that are new, replaced, kept as yours and unchanged.
- **Leftover hooks are named.** A hook in `~/.claude/settings.json` that starts a script which is not there is listed at the end of the run. Nothing is removed.
- **The tour video shows it.** The update scene has a line for a file that was kept because you changed it.

## Version 1.0.8, October 5, 2026

- **The tour video shows the new handoff.** The handoff scene no longer has a Yes button: the session passes 250k tokens and the work moves to a fresh one by itself. The sessions clip in the README is re-rendered too.

## Version 1.0.7, October 5, 2026

- **A long session moves to a fresh one by itself.** Until now `context-guard` had the agent offer a handoff at 200k tokens, and one more message in a session that had grown in the meantime still re-sent all of it. Now, when a reply ends past 250k tokens, the agent writes the brief and opens the new session without asking, once, then again every further 100k if you stay. The warning at 200k stays. `CONTEXT_GUARD_AUTO_K` changes the limit and `CONTEXT_GUARD_AUTO=off` brings back warning only.
- **Used today.** The Usage Plan panel shows how much of the week went today, next to the weekly and 5-hour numbers.

## Version 1.0.6, October 5, 2026

- **The tour video is up to date.** A new scene shows the five colour themes one after another on the same window, the court scene now shows `/court readers`, and the end card counts four editor extensions. The README's extensions section has a clip of the themes.

## Version 1.0.5, October 5, 2026

- **Five colour themes for Nimbalyst.** A new extension, [ink-themes](extensions/ink-themes/README.md): Ink Aurora (dark violet), Ink Ivy (grey and ivy green), Ink Graphite (grey on near-black with brown), Ink Bone (light, ivory and bone) and Ink Tide (deep sea blue). They share fonts, rounder shapes, a name under every side button, a New session button and usage bars in the side panel, and usage rings big enough to read. It builds with Node alone. Nothing changes until you pick one with the Theme button, and a test checks that every text colour can be read on its background.

## Version 1.0.4, October 4, 2026

- **`/setup-audit` finds what you load but don't use.** It compares what each chat loads (plugins, global skills) with what was actually used and lists the dead weight. It also measures the open items from the last audit, checks the workers through `ask.mjs --status`, and asks which fixes to apply once, in one form. If that form gets lost, it applies only the small fixes that are easy to undo, says how to undo them, and lists the rest as text. See [skills/setup-audit](skills/setup-audit/SKILL.md).
- **`/new-project` suggests more tools.** For a project with a web UI: Playwright and Frontend Design, when they are installed. For a research-heavy project: NotebookLM, when it is set up.

## Version 1.0.3, October 4, 2026

- **The reader court.** `/court readers <file>` is for a piece instead of a question: a resume, a README, a post, a page. A few readers with different jobs each read it alone and say what works, what loses them and the one change they would make, and a chair sums up where they agree, where they differ and what to change first. It works with ChatGPT, Google, both or neither; a reader whose tool is missing reads on Claude. See [skills/court](skills/court/SKILL.md).

## Version 1.0.2, October 4, 2026

- **You stay on the model you picked.** The rules no longer expect new chats to start on Sonnet, and Claude no longer stops to ask whether hard work should move to Opus. The rules file is shorter by about 1,100 characters, which every chat loads. Routine jobs still go to a Sonnet helper and to the free workers. See "Models" in [docs/HOW-TO.md](docs/HOW-TO.md).

## Version 1.0.1, October 4, 2026

- **The update check no longer ends with a Node error on Windows.** The daily check and the updater now read from GitHub in a way that doesn't trip a crash in Node when the process ends.

## Version 1.0.0, October 4, 2026

- **The setup updates itself.** Once a day it checks whether a newer version is released and says so in one line. Typing `/update-setup` downloads it and runs the installer again. It asks nothing, because the installer now remembers your projects folder and which workers you use, and it keeps your own skills, hooks, settings and notes. A rules file you changed yourself is replaced only after you say yes; one you never touched is brought up to date. A dated copy of every replaced file is kept. See [skills/update-setup](skills/update-setup).
- **The tour video** has a new scene for the updater, and the README's Updating section has its own clip.
- **Versions.** The setup has a version number ([version.json](version.json)) and a tag for each release. A push that doesn't raise the number reaches nobody.
- **A lighter install.** The full install no longer sets up the context-mode and language-server plugins, and the rules no longer mention them.
- **`/new-project` asks about data projects**: where the data comes from, what reads the result, how often it refreshes and how queries are run.

## October 4, 2026

- **One command for the free workers.** Searching and long reading go through [workers/ask.mjs](workers/ask.mjs). It uses the first worker that is set up and working (Codex, then Gemini through Antigravity for local files; Codex for the web), moves on when one is missing, signed out or out of usage, and prints which one answered and why another was skipped. When none can answer it hands the job back to Claude. You no longer pick a worker, and a search doesn't stop because one of them is busy.
- **Any mix of subscriptions.** The rules have one worker section that fits ChatGPT, Google, both or neither. `ask.mjs --status` lists what is ready on your computer.
- **Shorter commands in the permission popup.** [workers/ask-codex.sh](workers/ask-codex.sh) holds the flags Codex needs, so the command you approve is one short line.
- **No silent fallbacks.** A new rule: when a call, a lookup or a file read fails, the code fails with a clear error and doesn't fill in made-up values.
- **The usage dashboard counts worker runs** under the worker that answered.
- **The tour video and the clips** show the worker command.

## October 3, 2026

- **A full install for Windows and Mac.** One prompt installs the programs, the files, the plugins and the settings: [docs/full-install.md](docs/full-install.md).
- **Voice typing** with Handy, with the settings I use.
- **Four starter projects**, each with its own rules and tools, and the picture skill.
- **A commands button** for Nimbalyst: six commands behind one button.
- **A tour video** and a short clip for each README section, drawn with Remotion.
- The README was rewritten: install first, shorter sections, the hooks as a table.
- The license is all rights reserved.

## October 2, 2026

- **Link gate and read-only checks**: a reply with a link that was never opened is sent back.
- **The court skill**: three models answer a hard question and a chair writes the verdict.
- **Two editor extensions**: the usage pop-up with its forecast, and Read Aloud.
- An installer and a privacy check.

## October 1, 2026

- The first hooks, the example settings, the usage scanner with its tests, the worker agent and the handoff skill.
