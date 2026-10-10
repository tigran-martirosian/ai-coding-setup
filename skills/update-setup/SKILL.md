---
name: update-setup
description: Update this Claude Code setup (the rules, hooks, skills and project folders it installed) to the newest released version, keeping the user's own files and settings. Use when the user types /update-setup, says "update the setup", "install the update", "is there a newer version", or says yes after the update-check reminder.
---

# Update the setup

The update is one script; your part is to run it, deal with the few things it can't do alone, and say what changed. It only writes the setup's own files. Skills, hooks, settings and notes the user added themselves are never touched, one of the setup's files that the user changed stays as they have it, and every file it replaces is kept next to the new one as `<name>.before-install-<date>`.

1. **Run it:** `node ~/.claude/skills/update-setup/update.mjs` (allow up to 10 minutes: a changed extension is rebuilt). If it prints `Already on the newest version`, say so in one line and stop. If it prints `Update stopped:`, give the reason as it is and stop; nothing was changed.
2. **Rules.** Only if the output has the line `rules: new in this version, yours were kept`: the user changed `~/.claude/CLAUDE.md` themselves, so it was not replaced. Ask once whether to take the new rules (their file is kept as a dated copy, and they can copy their own lines back) or keep theirs. On yes: `node ~/.claude/skills/update-setup/update.mjs --replace-rules`.
3. **Files they changed.** Only if the output has the line `Kept as yours`: the files listed under it are the setup's, but the user changed them (or had their own under that name), so they were not replaced and are now behind this version. Show the list and ask once: take this version's copy of all of them, of some (which ones), or keep theirs. A dated copy of theirs is kept either way. All: `node ~/.claude/skills/update-setup/update.mjs --replace-all` (this takes the rules too, so leave step 2's question out). Some: the same command with `--replace <name>` for each, the name as the list has it.
4. **Extensions.** The installer rebuilds a changed Nimbalyst extension itself: `extension installed: <name>` means it is in place, `extension unchanged` that nothing was needed. For a line `extension failed: <name> (...)`, give the reason and try once by hand in the folder the `extension changed:` line names: `npm install`, `npm run build`, `npm run install-ext` (`ink-themes` without `npm install`).
5. **Plugins.** `plugin installed:` and `plugin already there:` need nothing. For a line `plugin failed`, `skill failed` or `plugins not installed`, give the reason it names; the next update tries again.
6. **Nothing else.** An update changes files only. Open no project folder or window, and ask about nothing the first install covered (the look of the editor, dictation, the default model): the user has those as they want them.
7. **Reply**, short, in the language the user writes in:
   - the version it is on now and the `What is new` line the script printed;
   - what the run listed at its end: the files it replaced, the ones kept as theirs, any hook in the settings whose script is not there (name it, change nothing), and the file under `~/.claude/setup-logs` that has the whole run;
   - **start a new chat** for the next task: rules load when a chat starts. If an extension was installed: quit Nimbalyst and open it again;
   - anything that failed, with its output;
   - one offer: in a project they work in, `/project-scan` checks that project's own `CLAUDE.md` and settings against the updated setup.

Budget: about 10 tool calls.
