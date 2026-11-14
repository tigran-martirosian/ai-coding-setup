#!/usr/bin/env node
// nimbalyst-notes: SessionStart hook (no matcher, so it also runs after a compact). Notes that only
// matter inside Nimbalyst (two tool quirks, the browser, the session board, helper names in the agents panel, where
// an unrelated request goes, which question tool to use) are sent here instead of living in CLAUDE.md for every
// session. The question line comes before the form is written: Nimbalyst draws a form at once, so the question-other
// hook can only note a form without a typing box after the user sees it. No variable names Nimbalyst for a hook; CLAUDE_CODE_ENTRYPOINT is "sdk-..." when an app runs Claude and
// "cli" in the terminal (same test as command-explain). Silent in the terminal. NIMBALYST_NOTES=off disables it.
// The home folders' paths: the projects folder the installer recorded (~/.claude/setup-state.json "projects"), else
// the first folder holding one of the homes, from the session's folder upwards (a worktree sits inside its project);
// none found means the homes aren't installed, so the line is left out.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { emit, inNimbalyst, runHook } from "./lib/hook-io.mjs";
import { WHAT_THIS_DOES } from "./lib/texts.mjs";

const HOMES = ["quick-tasks"];

const holdsHome = (dir) =>
  HOMES.some((name) => fs.existsSync(path.join(dir, name)));

function projectsFolder(cwd) {
  const stateFile = path.join(os.homedir(), ".claude", "setup-state.json");
  if (fs.existsSync(stateFile)) {
    const recorded = JSON.parse(fs.readFileSync(stateFile, "utf8")).projects;
    if (recorded && holdsHome(recorded)) return recorded;
  }
  for (let dir = path.resolve(cwd); ; dir = path.dirname(dir)) {
    if (holdsHome(dir)) return dir;
    if (path.dirname(dir) === dir) return null;
  }
}

function homesNote(cwd) {
  const root = projectsFolder(cwd);
  if (!root) return "";
  return (
    "- **Unrelated requests go to Quick Tasks.** A request unrelated to the open project writes no files there: answer in a sentence if trivial, otherwise open " +
    "`" +
    path.join(root, "quick-tasks") +
    "` (`workspace_open`). General questions, finding things on the internet and one-off file jobs all go there. " +
    "Work that needs a session inside that project (a skill, hook or MCP server only there) gets a handoff in `~/.claude/handoffs/`, with the exact prompt to paste."
  );
}

const NOTES = [
  "[nimbalyst-notes] Nimbalyst quirks:",
  "- The first `browser_screenshot` after a page load fails with `UnknownVizError`; the second works.",
  "- `display_to_user` shows a picture only from the `shown` folder of the open project: the card reloads the file every time it is drawn, and nothing cleans that folder up (the picture-in-project hook copies the picture there and gives the path to call again with).",
  '- **The Nimbalyst browser never shows a window**, not even with `headless: false` (the browser-visible-gate hook refuses that), so never tell the user a page is open or shown after using it; to show them one, open it in their own browser (`cmd //c start "" "<url>"` on Windows, `open "<url>"` on macOS). Browser work stays headless; a sign-in the user must type goes through the `site-login` skill (a real window that closes itself once they are in).',
  "- **Questions.** A quick yes/no or pick-one goes on `mcp__nimbalyst__AskUserQuestion` (a typing box on every question). The big form, `PromptForUserInput`, only for a draft to edit, a reorder or many fields, each question with a typing box (`allowOther: true` on each singleSelect, an optional editText right after each multiSelect or when only confirm or reorder fields remain). Anything else is written in the reply. The question line is one short sentence; the context under it in two or three short sentences, never a wall of text (a card shows no line breaks or bullets).",
  "- **Keep the Nimbalyst board honest.** When the work is finished and verified, the session only answered a question, or it was handed off, set its phase to `complete`; `validating` only while something waits on the user's check. Send the board call in the same message as another tool call of the work (the last check, the commit), never alone before the final reply: alone it is one more full-context request. A side job of this project opens as its own session (`spawn_session` with `isolated: true`).",
  "- **Name each helper `Kind: what exactly`** in the Agent `description` (e.g. `Web search: library sign-in steps`, `Read files: invoice importer`, `S3: rename the config keys`): that text is its row in Nimbalyst's \"Agents & commands\" panel. A background command's row shows its `" +
    WHAT_THIS_DOES +
    "` line, so that line names the job, not the tool. Both texts start with a capital letter and stay under 70 characters.",
].join("\n");

runHook("nimbalyst-notes", (event) => {
  if (!inNimbalyst()) return;
  const homes = homesNote(event.cwd || process.cwd());
  emit.context("SessionStart", homes ? NOTES + "\n" + homes : NOTES);
});
