#!/usr/bin/env node
// nimbalyst-notes: SessionStart hook (no matcher, so it also runs after a compact). Notes that only
// matter inside Nimbalyst (two tool quirks, the session board, helper names in the agents panel, the question-form tool) are
// sent here instead of living in CLAUDE.md for every session. No variable names Nimbalyst
// for a hook; CLAUDE_CODE_ENTRYPOINT is "sdk-..." when an app runs Claude and "cli" in the terminal
// (same test as command-explain). Silent in the terminal. NIMBALYST_NOTES=off disables it.
import { runHook, inNimbalyst, emit } from "./lib/hook-io.mjs";
import { WHAT_THIS_DOES } from "./lib/texts.mjs";

const NOTES = [
  "[nimbalyst-notes] Nimbalyst quirks:",
  "- The first `browser_screenshot` after a page load fails with `UnknownVizError`; the second works.",
  "- `display_to_user` shows a picture only from the `shown` folder of the open project: the card reloads the file every time it is drawn, and nothing cleans that folder up (the picture-in-project hook copies the picture there and gives the path to call again with).",
  "- **The Nimbalyst browser never shows a window**, not even with `headless: false` (the browser-visible-gate hook refuses that). Browser work stays headless; a sign-in the user must type goes through the `site-login` skill (a real window that closes itself once they are in).",
  "- **Keep the Nimbalyst board honest.** When the work is finished and verified, the session only answered a question, or it was handed off, set its phase to `complete`; `validating` only while something waits on the user's check. Send the board call in the same message as another tool call of the work (the last check, the commit), never alone before the final reply: alone it is one more full-context request. A side job of this project opens as its own session (`spawn_session` with `isolated: true`).",
  "- **Name each helper `Kind: what exactly`** in the Agent `description` (e.g. `Web search: library sign-in steps`, `Read files: invoice importer`, `S3: rename the config keys`): that text is its row in Nimbalyst's \"Agents & commands\" panel. A background command's row shows its `" + WHAT_THIS_DOES + "` line, so that line names the job, not the tool. Both texts start with a capital letter and stay under 70 characters.",
  "- **Question forms** go through `mcp__nimbalyst__PromptForUserInput`, with `allowOther: true` on every singleSelect; the question-other hook refuses Nimbalyst's `AskUserQuestion` (no box to type in) and a form that points at a file without its link, and each refusal is one more full-context request.",
].join("\n");

runHook("nimbalyst-notes", () => {
  if (!inNimbalyst()) return;
  emit.context("SessionStart", NOTES);
});
