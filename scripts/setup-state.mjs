// ~/.claude/setup-state.json: what the runs of install.mjs were told and wrote, read again by later runs
// and by skills/update-setup/update.mjs. Its fields (STATE_KEYS): version, repo, projects, files, written,
// rules, rulesUndo, rulesUndoBefore, rulesLeftOut, ownTidied, ownOffered, ownVaultNext, userCopies, model,
// language, node, codex, handy and backup (the two opt-ins asked once: voice typing with Handy, the encrypted
// backup; true or false, none until answered), extensions, plugins, themePending, themePendingFrom, inkSwitched,
// nimbalystClaude, obscura, done, oldCopiesMoved (the copies older versions left beside files are in setup-logs:
// install.mjs searches no more); agyAdded and agy only from older versions.
import fs from "node:fs";
import path from "node:path";

export const STATE_KEYS = [
  "version",
  "repo",
  "projects",
  "files",
  "written",
  "rules",
  "rulesUndo",
  "rulesUndoBefore",
  "rulesLeftOut",
  "ownTidied",
  "ownOffered",
  "ownVaultNext",
  "userCopies",
  "model",
  "language",
  "node",
  "codex",
  "handy",
  "backup",
  "extensions",
  "plugins",
  "themePending",
  "themePendingFrom",
  "inkSwitched",
  "nimbalystClaude",
  "obscura",
  "done",
  "oldCopiesMoved",
  "agyAdded",
  "agy",
];
export const stateFileIn = (claude) => path.join(claude, "setup-state.json");
// A plain write, for the small changes made outside a full run (--done, the updater)
export const writeState = (file, state) =>
  fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
// The Ink theme was set through Nimbalyst itself, so it is no longer pending
export function themeDone(state) {
  const { themePending, themePendingFrom, ...rest } = state;
  return { ...rest, inkSwitched: true };
}
