#!/usr/bin/env node
// form-answer: PostToolUse hook on the question forms (Nimbalyst's PromptForUserInput and AskUserQuestion, and the
// built-in AskUserQuestion). The user's answer comes back as the form tool's result, so this is the moment to say how
// to read it: what they typed outweighs what they ticked, a tick against their words is not a decision yet, and a
// tick is reported in full with what it would undo. The rule lives here instead of in CLAUDE.md, where it sat in
// every turn of every session. Main session only: a helper gets no forms. FORM_ANSWER=off disables it.
import { emit, runHook } from "./lib/hook-io.mjs";

const FORMS = [
  "mcp__nimbalyst__PromptForUserInput",
  "mcp__nimbalyst__AskUserQuestion",
  "AskUserQuestion",
];
const FORM_ANSWER_NOTE =
  "[form-answer] Read the whole answer: what the user typed outweighs what they ticked. A tick that goes against their " +
  "typed text, their last message or an earlier decision is not a decision yet: put the two side by side and ask which " +
  'they mean. Report a tick as "you ticked: <the option\'s full text>"; anything it would undo is named in the same ' +
  "question, before it counts as decided.";

runHook("form-answer", (event) => {
  if (event.agent_id || !FORMS.includes(event.tool_name)) return;
  emit.context("PostToolUse", FORM_ANSWER_NOTE);
});
