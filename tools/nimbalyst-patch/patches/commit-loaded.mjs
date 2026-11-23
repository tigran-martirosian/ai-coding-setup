// Our own change, not an upstream PR: the commit tool is loaded with the session, like the question card.
// Claude Code holds back most MCP tools until the agent looks them up (tool search); Nimbalyst marks a few of its
// core tools "anthropic/alwaysLoad" so their field names are in the prompt from the start (CORE_ALWAYS_LOAD_TOOLS
// in main). developer_git_commit_proposal was not among them, so an agent that committed without looking it up
// first guessed its fields, and Nimbalyst showed the refused call as a red "Commit Failed" card above the
// commit that then worked (14 of 268 commit calls in one week). Adding it to the list costs its schema in each
// prompt (a few hundred tokens). Retires when Nimbalyst's own list carries it.
export default {
  id: "commit-loaded",
  files: /^out\/main\/.+\.js$/,
  upstream: `const CORE_ALWAYS_LOAD_TOOLS = [
  "AskUserQuestion",
  "PromptForUserInput",
  "display_to_user",
  "update_session_meta",
  "developer_git_commit_proposal"`,
  edits: [
    {
      anchor: `const CORE_ALWAYS_LOAD_TOOLS = [
  "AskUserQuestion",
  "PromptForUserInput",
  "display_to_user",
  "update_session_meta"
];`,
      replace: `const CORE_ALWAYS_LOAD_TOOLS = [
  "AskUserQuestion",
  "PromptForUserInput",
  "display_to_user",
  "update_session_meta",
  // commit-loaded patch: the commit tool's fields are known from the start, no guessed call
  "developer_git_commit_proposal"
];`,
    },
  ],
};
