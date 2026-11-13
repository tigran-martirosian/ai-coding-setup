#!/usr/bin/env node
// next-step-gate: backs "a finished step is not a stopping point" (a session finished a step, wrote "Next: ..." and ended the turn).
// Stop: when the reply names a next step of Claude's own ("Next: ...", "### Next", "Next is ...", "**Next:** ...") and nothing
// in it waits on the user, block with that line: carry on now, or say which real reason stops the work. Each different step
// is pushed once per turn, at most MAX_BLOCKS times (state in ~/.claude/hooks/state/next-step-gate/<session>.json, files older than 2 days removed).
// Passes: a turn that ends in a question form; a reply with a "Needs you" heading; a next-step line (or the line under a
// "Next" heading) that names the user ("you", "your"), a fresh session or handoff, a later date, or work still running
// ("once the build finishes"); a "Next, I ran ..." narration; a turn with a handoff skill or a new session started; a turn
// with no tool calls (a plain answer: its "next" is a suggestion). Subagents (agent_id) are skipped.
// Fails open. NEXT_STEP_GATE=off disables it.
import { runHook, isMain, emit } from "./lib/hook-io.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { stateFile, readJson, writeJson, sweep } from "./lib/state.mjs";
import {
  entries as readEntries,
  assistantText,
  currentTurn,
  QUESTION_TOOLS,
  SYNTHETIC,
} from "./lib/transcript.mjs";
import fs from "node:fs";

const HANDOFF = (b) =>
  (b.name === "Skill" &&
    /^(handoff|planning:launch-new-session)$/.test(
      String(b.input?.skill || ""),
    )) ||
  /^mcp__nimbalyst-host__(spawn_session|create_session|workspace_open)$/.test(
    b.name,
  );
// "Next: x", "**Next steps:** x", "Next is x", "Next up, x", "Next I start x", "Next, I'll x", "### Next steps" (then the next line counts)
const NEXT_LINE =
  /^\s*(?:[-*]\s+)?(?:#{1,4}\s+)?(?:\*\*)?next(?:\s+steps?)?(?:\s+up)?(?:\*\*)?(?:\s*:\s*(?:\*\*)?|\s*,?\s+(?=(?:i|i'll|i will|i'm|we|we'll)\b)|,\s+(?:\*\*)?|\s+(?:is|are|comes?|will be)\b|\s*$)(.*)$/i;
// A "Next," sentence that tells what was done ("Next, I ran the suite") is narration, not a step
const PAST =
  /^(?:i|we)\s+(?:\w+ed|ran|wrote|did|made|found|built|saw|went|got|had|was|took|read|set|put|ran)\b/i;
const WAITS =
  /\b(you|your|you're|needs you|the user)\b|fresh session|new session|handoff|hand(?:ed)? off|\bafter \d{4}-\d{2}-\d{2}|\b(tomorrow|next week|on \d{4}-\d{2}-\d{2})\b|\b(once|when|after)\b.{0,60}\b(finishes|finished|lands|completes|completed|is done|returns|reports)\b/i;
const NEEDS_YOU = /^\s*(?:#{1,4}\s+|\*\*)needs you\b/im;
const MAX_BLOCKS = 3; // Anthropic: "stop after two or three automatic continuations"

/** The reply's own next step ("R1, research on ..."), or null when it has none or it waits on the user. */
export function ownNextStep(text) {
  const all = String(text || "");
  if (NEEDS_YOU.test(all)) return null; // the reply hands the user a step; what comes next waits on it
  const lines = all.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = NEXT_LINE.exec(lines[i]);
    if (!m) continue;
    let step = m[1].replace(/\*\*/g, "").trim();
    if (!step)
      step = (lines.slice(i + 1).find((l) => l.trim()) || "")
        .replace(/^\s*[-*]\s+/, "")
        .trim();
    if (!step || /^#/.test(step) || PAST.test(step)) continue;
    if (WAITS.test(step) || WAITS.test(lines[i])) continue;
    return step.length > 200 ? step.slice(0, 200) + " …" : step;
  }
  return null;
}

/** The block reason for this Stop, or null. */
export function stopVerdict(entries, lastMessage) {
  const { entries: turn } = currentTurn(entries);
  const replies = turn.filter(
    (e) => e.type === "assistant" && e.message?.model !== SYNTHETIC,
  );
  const uses = replies
    .filter((e) => Array.isArray(e.message?.content))
    .flatMap((e) => e.message.content.filter((b) => b.type === "tool_use"));
  if (!uses.length) return null;
  if (QUESTION_TOOLS.test(uses[uses.length - 1].name) || uses.some(HANDOFF))
    return null;
  // The final reply: the text after the last tool call (or the Stop input's last message)
  const last =
    typeof lastMessage === "string" && lastMessage.trim()
      ? lastMessage
      : assistantText(replies[replies.length - 1] || {});
  const step = ownNextStep(last);
  if (!step) return null;
  return (
    `next-step-gate: your reply ends on a next step of your own ("${step}") and nothing in it waits on the user. ` +
    "A finished step is not a stopping point: carry on with that step now, in this turn, and report once at the end. " +
    "Stop only for a decision that is the user's (ask it in a form), a design or summary the user has to read or review first (put it under Needs you), " +
    "a failure you could not fix, or a context-guard or job-done note " +
    "saying to move to a fresh session (then run the handoff skill); name which one in the reply."
  );
}

if (isMain(import.meta.url)) {
  runHook("next-step-gate", (input) => {
    if (
      input.agent_id ||
      !input.transcript_path ||
      !fs.existsSync(input.transcript_path)
    )
      return;
    const reason = stopVerdict(
      readEntries(fs.readFileSync(input.transcript_path, "utf8")),
      input.last_assistant_message,
    );
    if (!reason) return;
    // A plan with several steps left gets pushed at each new step: the steps already pushed this turn are kept in a
    // state file (the first Stop of a turn has stop_hook_active false and starts it again); the same step twice, or
    // more than MAX_BLOCKS pushes in one turn, passes, so it never loops.
    sweep("next-step-gate", 2);
    const file = stateFile("next-step-gate", sessionKey(input.session_id));
    const steps = input.stop_hook_active
      ? (readJson(file) ?? {}).steps || []
      : [];
    if (steps.includes(reason) || steps.length >= MAX_BLOCKS) return;
    writeJson(file, { steps: [...steps, reason] });
    emit.block(reason);
  });
}
