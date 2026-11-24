// Our own change, not an upstream PR: a question card or form that a PreToolUse hook refused stays in the
// transcript as a finished-looking "Question Blocked" / "Input Blocked" card, right above the corrected card
// the agent sends next, so the user sees two cards for one question. Our card hook puts the fixed marker
// [card-refused] in every refusal, and the tool result reads "PreToolUse:<tool> hook error: [card-refused] ...".
// In the renderer chunk registerExtensionSystem-*.js, erroredQuestionOutcome(toolCall) is the one decision
// both widgets use (AskUserQuestionWidget for AskUserQuestion, plain or mcp__nimbalyst__; RequestUserInputWidget
// for PromptForUserInput and the old name RequestUserInput): an errored call whose text is not a cancel, a
// denial or an answerable error is { kind: "blocked", reason: <text> }. This adds refusedQuestionCard(toolCall)
// beside it (blocked, and the text holds the marker), and TranscriptToolCard, the container that wraps every
// tool widget in a "rich-transcript-tool-container mb-2" div, returns null for such a call, so no card and no
// empty spaced div is left. It returns there after all its hooks, beside its own early returns. A card blocked
// or failed for any other reason still shows. Never retires: no upstream fix to wait for.
const MARKER = "[card-refused]";

export default {
  id: "card-refused",
  files: /^out\/renderer\/assets\/registerExtensionSystem-[A-Za-z0-9_-]+\.js$/,
  upstream: null,
  edits: [
    {
      anchor: `  return { kind: "blocked", reason: text2 };
}
const QuestionMarkIcon = `,
      replace: `  return { kind: "blocked", reason: text2 };
}
// card-refused patch: a question card or form our hook refused is not shown.
function refusedQuestionCard(toolCall) {
  if (!toolCall?.toolName) return false;
  if (!["AskUserQuestion", "PromptForUserInput", "RequestUserInput"].includes(stripMcpPrefix(toolCall.toolName))) return false;
  const outcome = erroredQuestionOutcome(toolCall);
  return outcome?.kind === "blocked" && outcome.reason.includes(${JSON.stringify("hook error: " + MARKER)});
}
const QuestionMarkIcon = `,
    },
    {
      anchor: `  const hasChildren = isSubAgent && toolMsg.subagent?.childEvents && toolMsg.subagent.childEvents.length > 0;
  if (CustomWidget) {
`,
      replace: `  const hasChildren = isSubAgent && toolMsg.subagent?.childEvents && toolMsg.subagent.childEvents.length > 0;
  if (refusedQuestionCard(tool)) return null;
  if (CustomWidget) {
`,
    },
  ],
};
