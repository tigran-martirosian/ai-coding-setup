// ~/.claude/setup-state.json: what the runs of install.mjs were told and wrote, read again by later runs
// and by skills/update-setup/update.mjs. Its fields (STATE_KEYS): version, repo, projects, files, written,
// rules, rulesOffered, userCopies, model, language, node, codex, extensions, plugins, themePending,
// themePendingFrom, inkSwitched, nimbalystClaude, done; agyAdded and agy only from older versions.
import fs from "node:fs";
import path from "node:path";

export const STATE_KEYS = ["version", "repo", "projects", "files", "written", "rules", "rulesOffered", "userCopies", "model", "language", "node", "codex",
  "extensions", "plugins", "themePending", "themePendingFrom", "inkSwitched", "nimbalystClaude", "done", "agyAdded", "agy"];
export const stateFileIn = (claude) => path.join(claude, "setup-state.json");
// A plain write, for the small changes made outside a full run (--done, the updater)
export const writeState = (file, state) => fs.writeFileSync(file, JSON.stringify(state, null, 2) + "\n");
// The Ink theme was set through Nimbalyst itself, so it is no longer pending
export function themeDone(state) {
  const { themePending, themePendingFrom, ...rest } = state;
  return { ...rest, inkSwitched: true };
}
