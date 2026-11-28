#!/usr/bin/env node
// compact-handoff: SessionStart hook, wired with matcher "compact", so it runs right after a chat's context was
// compressed. It tells the main session to finish the step it is on, commit and hand off with the `handoff`
// skill instead of starting the next step: a long session keeps re-sending its whole context, and compaction
// hides that cost (sessions over 100 turns were 65% of main-chat usage, 2026-11-19..26).
// Silent when the source is not "compact" (a matcher-less wiring still works) or a helper compacts (agent_id set,
// Claude Code sends it on a subagent's post-compaction SessionStart). The entrypoint can't tell a scripted
// `claude -p` run from a chat: Nimbalyst sessions are "sdk-cli" too (checked 2026-11-28), so a script that starts
// headless sessions sets COMPACT_HANDOFF=off in their environment.
// `lead` hands off at a merged slice when `handoff/brief.mjs --should` says so, and that answer is "hand off" once
// the chat has compacted, so the note names the slice as the step: the two agree.
// COMPACT_HANDOFF=off disables it.
import { emit, runHook } from "./lib/hook-io.mjs";

export const NOTE = [
  "[compact-handoff] This chat's context was just compressed, so every turn from here re-sends a long history.",
  "- Finish the step you are on and commit it; don't start the next step.",
  "- Then run the `handoff` skill, so a fresh session continues from its brief.",
  "- Running `lead`: the step is the slice in progress. Hand off at its merge as lead says; `brief.mjs --should` now answers `hand off`.",
  "- Nothing left after this step (a question answered, the job done): finish and report; no handoff is needed.",
].join("\n");

runHook("compact-handoff", (event) => {
  if (event.source !== "compact") return;
  if (event.agent_id) return;
  emit.context("SessionStart", NOTE);
});
