#!/usr/bin/env node
import fs from "node:fs";
// next-step-gate: backs "a finished step is not a stopping point" (a session finished a step, wrote "Next: ..." and ended the turn).
// Stop: when the reply names a next step of Claude's own ("Next: ...", "### Next", "Next is ...", "**Next:** ...") and nothing
// in it waits on the user, block with that line: carry on now, or say which real reason stops the work. Each different step
// is pushed once per turn, at most MAX_BLOCKS times (state in ~/.claude/hooks/state/next-step-gate/<session>.json, files older than 2 days removed).
// Passes: a turn that ends in a question form; a reply with a "Needs you" heading; a next-step line (or the line under a
// "Next" heading) that names the user ("you", "your"), a fresh session or handoff, a later date, or work still running
// ("once the build finishes"); a "Next, I ran ..." narration; a turn with a handoff skill or a new session started; a turn
// with no tool calls (a plain answer: its "next" is a suggestion). Subagents (agent_id) are skipped.
// Also blocks, once, a line asking the user to restart Nimbalyst or click something to test it (testAsk; a phone-only
// check passes). Also blocks, once, a reply asking the user to say go for Claude's own work ("Say go and I'll start step 2"), even under
// "Needs you": a yes already covers every step left. A release, deploy, payment, message or delete line still asks.
// Fails open. NEXT_STEP_GATE=off disables it.
import { emit, isMain, runHook } from "./lib/hook-io.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { readJson, stateFile, sweep, writeJson } from "./lib/state.mjs";
import {
  assistantText,
  currentTurn,
  QUESTION_TOOLS,
  entries as readEntries,
  SYNTHETIC,
} from "./lib/transcript.mjs";

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
// "Say go and I'll start step 2", "I'll start it when you say go", "Say the word": a go asked for Claude's own work.
// The 2026-11-17 chat review found it in 9 chats, most after the user had already OK'd the job.
const GO_ASK =
  /\b(?:say|give(?:\s+me)?|on|with|after|once|when\s+you\s+say)\s+(?:the\s+|your\s+)?["“*]*go(?:-ahead)?\b(?!\s+(?:to|through|back|on|out|over|in)\b)|\bsay the word\b/i;
// What still asks first: a release, a deploy, money, a message to a person, something hard to undo
const STILL_ASKS =
  /\b(releas|deploy|publish|push|send|messag|e-?mail|pay|buy|purchas|delet|remov|subscri)\w*/i;

// "Restart Nimbalyst so the fix loads", "At your next Nimbalyst restart, click Done ... and tell me whether it moved",
// "Say "restart" and I'll restart it": a restart or a click test asked of the user. The 2026-11-17 chat review found it
// in 14 chats; the user: "I can restart it whenever I want, you don't need it". A phone-only check still asks.
// A restart asked of the user: the verb as an ask (line start, after a label's colon, after "please", "then", "or",
// "you need to"...) aimed at Nimbalyst, or `say "restart"`.
const RESTART_ASK =
  /(?:^|[:;]\s*|\b(?:please|then|and|or|you(?:'ll)? (?:need|have) to|can you|could you|just)\s+)(?:quit and\s+)?(?:restart|reopen|relaunch)\s+(?:the app\b|nimbalyst\b)|\bsay\s+["“*]*restart\b/i;
// A click test: "click X ... and tell me / let me know whether it moved", or a click tied to "your next restart".
const CLICK_ASK =
  /\bclick\b[^\n]{0,100}\b(?:(?:tell|let)\s+(?:me|us|the new session)\b|say\s+(?:whether|if)\b)|\b(?:at|after)\s+(?:your|the)\s+next\b[^\n]{0,40}\brestart\b[^\n]{0,20}\bclick\b|\bclick\b[^\n]{0,100}\bnext time you restart\b/i;
const NOT_ASK =
  /\b(?:not|never|no need|don't|didn't|doesn't|isn't|won't)\b|^(?:i|we)\s/i;
const PHONE_ONLY = /\b(?:phone|iphone|android|ipad)\b/i;

const askLine = (line) =>
  line
    .replace(/\*\*/g, "")
    .replace(/^\s*(?:>\s*)?(?:[-*]|\d+\.)?\s*(?:\[[ x]\]\s*)?/i, "")
    .trim();

/** The reply's line asking the user to restart Nimbalyst or click something to test it, or null. */
export function testAsk(text) {
  for (const raw of String(text || "").split("\n")) {
    // A quoted phrase of two or more words or inline code is an example, not an ask; a one-word quote
    // (`say "restart"`) stays.
    const line = askLine(raw).replace(
      /"[^"\n]*\s[^"\n]*"|“[^”\n]*\s[^”\n]*”|`[^`\n]*`/g,
      '""',
    );
    if (NOT_ASK.test(line)) continue;
    const ask =
      RESTART_ASK.test(line) ||
      (CLICK_ASK.test(line) && !PHONE_ONLY.test(line));
    if (ask) return line.length > 200 ? line.slice(0, 200) + " …" : line;
  }
  return null;
}

/** The reply's line asking the user to say go for Claude's own work, or null. */
export function goAsk(text) {
  for (const line of String(text || "").split("\n")) {
    if (!GO_ASK.test(line) || STILL_ASKS.test(line)) continue;
    const t = line
      .replace(/\*\*/g, "")
      .replace(/^\s*[-*]\s+/, "")
      .trim();
    return t.length > 200 ? t.slice(0, 200) + " …" : t;
  }
  return null;
}

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
  const ask = goAsk(last);
  if (ask)
    return (
      `next-step-gate: your reply asks the user to say go for your own work ("${ask}"). ` +
      "A yes, a tick, \"do it\" or an OK'd plan already covers every step left: if the user OK'd this work, carry it out now, " +
      "in this turn (a fresh session goes through the handoff skill, which opens it itself). " +
      "Ask only for a release, a deploy, money, a message to a person, a plan or design page not yet OK'd, or work the user never asked for; " +
      "if this is one of those, send the same reply again: it passes."
    );
  const test = testAsk(last);
  if (test)
    return (
      `next-step-gate: your reply asks the user to restart the app or click something to test it ("${test}"). ` +
      "Run the check yourself (the app's inspector or a UI script; see the project's CLAUDE.md for its tools). " +
      "A change that loads only after a restart waits for the user's own next restart: write it under Check later in HANDOFF.md " +
      "with the command that checks it, never as an ask, and never hold a release for it. " +
      "If only the user can do this check (on a phone, or their own judgement of a look), send the same reply again: it passes."
    );
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
