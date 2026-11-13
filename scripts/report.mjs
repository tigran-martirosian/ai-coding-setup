// The end of an install run: what is left for a chat, what the run did to files that were already there,
// hooks whose script is missing, the closing list of the user's files on old versions, and the saved log
// of a run that changed something (~/.claude/setup-logs).
import fs from "node:fs";
import path from "node:path";
import { gitBashMissing } from "./claude-files.mjs";
import { fwd, SCRIPT_PATHS } from "./files.mjs";

export function report(ctx, { noGitBash }) {
  const { REPO, CLAUDE, home, WIN, DRY, LANG, state, settings, settingsFile, said, tally, say, selfRun } = ctx;
  // What a script can't do is named by the first install only: the settings inside Nimbalyst are
  // reached with tools only a chat there has, and voice typing is a program the person sets up.
  // A home with a version on record has been through that, so a later run (an update) stays quiet:
  // it opens no folder and asks about nothing the person has already set up or answered.
  const fullInstall = fwd(path.join(REPO, "docs", "full-install.md"));
  if (!state.version && !(state.done || []).includes("chat-steps")) {
    say(`Left for a chat, once: Nimbalyst's settings and voice typing. In a Claude chat (inside Nimbalyst where it is used) carry out steps 8 and 9 of ${fullInstall}. This is named now only; an update never asks for it.`);
  }
  say(`The programs (Nimbalyst, Git, uv, Codex) are the full install: ${fullInstall}`);

  // A hook in settings.json that starts a script by its full path, where that script is not there
  const lost = [];
  if (!DRY) for (const [event, groups] of Object.entries(settings.hooks || {})) {
    for (const hook of groups.flatMap((g) => g.hooks || [])) {
      for (const m of String(hook.command || "").matchAll(SCRIPT_PATHS)) {
        let script = (m[1] || m[2]).replace(/^~(?=[\\/])/, home);
        if (WIN) script = script.replace(/^\/([a-zA-Z])\//, "$1:/");
        if (path.isAbsolute(script) && !/[$%]/.test(script) && !fs.existsSync(script)) lost.push(`${event}: ${fwd(script)}`);
      }
    }
  }
  const did = said.some((l) => /^(rules: |notes: )?(copied|replaced|wrote|brought up|hook added|hook repointed|hook replaced|hook matcher updated|linked|removed|extension installed|plugin installed|skill installed|model: set|MODEL CHANGED|model: sonnet is back|permissions: )/.test(l));
  if (did || tally.yours.length) {
    const parts = [[tally.added, "new"], [tally.replaced.length, "replaced"], [tally.yours.length, "kept as yours"], [tally.same, "unchanged"]];
    say(`Files: ${parts.filter(([n]) => n).map(([n, what]) => `${n} ${what}`).join(", ")}.`);
  }
  if (tally.replaced.length) {
    say(`Replaced, the old one is next to each as <name>.before-install-<date>:`);
    for (const f of tally.replaced) say(`  ${f}`);
  }
  if (tally.yours.length) {
    say(`Kept as yours, because they differ from the setup's version (you changed them, or had them before):`);
    for (const f of tally.yours) say(`  ${f}`);
    say(`To take the setup's version, run this again with --replace <name> for one file or --replace-all for all of them. Yours is then kept as a dated copy.`);
  }
  if (lost.length) {
    say(`Hooks in ${fwd(settingsFile)} whose script is not there (left over from something else; nothing was done about them):`);
    for (const l of lost) say(`  ${l}`);
  }
  // What a run printed is saved when it changed something, so it can be read or sent later
  const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
  const logFile = path.join(CLAUDE, "setup-logs", `install-${stamp}.txt`);
  if (did && !DRY) say(`This run is saved in ${fwd(logFile)}`);
  say(`Language: ${LANG || "not chosen"}`);
  if (noGitBash) say(gitBashMissing(settingsFile));
  say(DRY ? "Nothing was changed." : `Done. Restart Claude Code so it loads the hooks. How to use the setup: ${fwd(path.join(REPO, "docs", "HOW-TO.md"))}`);
  // The closing list of an update: what is still on an older version because it is the user's, each with
  // the line that takes the setup's version. --replace <file> works on the names as the lists above give
  // them; --home is repeated so the line acts on the same folder. The rules are not on it: an update carves them.
  if (tally.yours.length) {
    const quote = (name) => (/\s/.test(name) ? `"${name}"` : name);
    say(`Yours, on old versions (they stay as they are, so they are behind this version); each line takes the setup's version, and yours stays as a dated copy:`);
    for (const f of tally.yours) say(`  ${f}: ${selfRun(`--replace ${quote(f)}`)}`);
    if (tally.yours.length > 1) say(`  all of them at once: ${selfRun("--replace-all")}`);
  }
  if (did && !DRY) {
    fs.mkdirSync(path.dirname(logFile), { recursive: true });
    fs.writeFileSync(logFile, said.join("\n") + "\n");
  }
}
