# Changelog

What changed, newest first, and what it gives you.

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
