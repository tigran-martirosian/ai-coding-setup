#!/usr/bin/env node
// nimbalyst-notes: SessionStart hook. Two quirks of Nimbalyst's tools only matter inside Nimbalyst, so
// they are sent here instead of living in CLAUDE.md for every session. No variable names Nimbalyst
// for a hook; CLAUDE_CODE_ENTRYPOINT is "sdk-..." when an app runs Claude and "cli" in the terminal
// (same test as command-explain). Silent in the terminal. NIMBALYST_NOTES=off disables it.
import { crashLog } from "./crash-log.mjs";
const NOTES = [
  "[nimbalyst-notes] Nimbalyst quirks:",
  "- The first `browser_screenshot` after a page load fails with `UnknownVizError`; the second works.",
  "- `display_to_user` shows a picture only from the `shown` folder of the open project: the card reloads the file every time it is drawn, and nothing cleans that folder up (the picture-in-project hook copies the picture there and gives the path to call again with).",
].join("\n");

try {
  if ((process.env.NIMBALYST_NOTES || "").toLowerCase() === "off") process.exit(0);
  if (!/^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "")) process.exit(0);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: NOTES } }));
} catch (err) {
  crashLog("nimbalyst-notes", err);
  process.exit(0);
}
