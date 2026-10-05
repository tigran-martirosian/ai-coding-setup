# Changelog

What changed, newest first, and what it gives you.

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
