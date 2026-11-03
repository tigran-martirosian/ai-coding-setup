#!/usr/bin/env node
// nimbalyst-notes: SessionStart hook (no matcher, so it also runs after a compact). Notes that only
// matter inside Nimbalyst (two tool quirks, the session board, helper names in the agents panel) are
// sent here instead of living in CLAUDE.md for every session. No variable names Nimbalyst
// for a hook; CLAUDE_CODE_ENTRYPOINT is "sdk-..." when an app runs Claude and "cli" in the terminal
// (same test as command-explain). Silent in the terminal. NIMBALYST_NOTES=off disables it.
import { crashLog } from "./crash-log.mjs";
const NOTES = [
  "[nimbalyst-notes] Nimbalyst quirks:",
  "- The first `browser_screenshot` after a page load fails with `UnknownVizError`; the second works.",
  "- `display_to_user` shows a picture only from the `shown` folder of the open project: the card reloads the file every time it is drawn, and nothing cleans that folder up (the picture-in-project hook copies the picture there and gives the path to call again with).",
  "- **Keep the Nimbalyst board honest.** When the work is finished and verified, the session only answered a question, or it was handed off, set its phase to `complete`; `validating` only while something waits on the user's check. Send the board call with the last tool calls of the work. A side job of this project opens as its own session (`spawn_session` with `isolated: true`).",
  "- **Name each helper `Kind: what exactly`** in the Agent `description` (e.g. `Web search: library sign-in steps`, `Read files: invoice importer`, `S3: rename the config keys`): that text is its row in Nimbalyst's \"Agents & commands\" panel. A background command's row shows its `# WHAT THIS DOES:` line, so that line names the job, not the tool.",
].join("\n");

try {
  if ((process.env.NIMBALYST_NOTES || "").toLowerCase() === "off") process.exit(0);
  if (!/^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "")) process.exit(0);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: NOTES } }));
} catch (err) {
  crashLog("nimbalyst-notes", err);
  process.exit(0);
}
