# Changelog

What changed, newest first, and what it gives you.

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
