// Our own change, not an upstream PR: Nimbalyst's built-in system prompt (buildClaudeCodeSystemPrompt in
// out/main/index.js, the "## Interactive User Input" block) tells every session to put each question, list
// of options or draft on an interactive tool instead of in chat. This rewrites that block so a card is for a
// quick yes/no or pick-one on the user's own preference, the big form only for a draft to edit, a reorder or
// many fields, and anything that needs explaining is written in the reply. The block is the source of a
// template literal: `${askUserQuestionTool}` and `${promptForUserInputTool}` stay as they are, so sessions
// still get the tool names in their own reference style. A card shows its text without line breaks or
// bullets (WidgetBlock and OptionBody render plain text in a div/span with no white-space rule), so the
// new text says so. Never retires: upstream has no such fix to wait for.
const TOOLS =
  "Fields: multiSelect, singleSelect (set allowOther for an escape hatch), reorder (removable for drop), editText (seed initialText with your draft so the user edits in place), confirm.";

export default {
  id: "ask-line",
  files: /^out\/main\/index\.js$/,
  upstream: null,
  edits: [
    {
      anchor: `Before writing a question, list of options, or draft for the user to react to in chat, call an interactive tool instead:

- \${askUserQuestionTool} — single 2-3 option choice.
- \${promptForUserInputTool} — anything richer. ${TOOLS}

Combine questions into one multi-field prompt instead of asking across turns, and pre-fill defaults so the user can submit without retyping.`,
      replace: `Use an interactive tool only when the user can answer quickly from their own preference:

- \${askUserQuestionTool} — a quick yes/no or pick-one (2-3 options). A card shows no line breaks or bullets, so keep its text to short sentences.
- \${promptForUserInputTool} — only for a draft to edit, a reorder or many fields. ${TOOLS}

A question that needs explaining, thought or research goes in your reply as plain text, not on a card. Put several quick questions in one call instead of asking across turns, and pre-fill defaults so the user can submit without retyping.`,
    },
  ],
};
