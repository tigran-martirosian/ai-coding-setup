// Our own change, not an upstream PR: after switching projects, the agent view's right panel sometimes has no
// mode menu (Edited Files / Review / Chat with Session / File viewer) until another session is opened.
// Cause (renderer index chunk): the window resets agentPanelState to { available: false } in an effect keyed
// on the workspace path, and AgentMode reports its real state from a child effect. React runs child effects
// before parent effects in the same commit, so when the new project's selected session is known in the same
// render as the new path, the child's report lands first and the reset then overwrites it; the child's deps
// don't change again, so the menu stays gone until the selected session changes. AgentMode stays mounted
// across a project switch and reports on every change of session, role, visibility and mode, so the reset
// adds nothing: this drops it. Never retires: no upstream fix to wait for yet.
export default {
  id: "right-panel-menu",
  files: /^out\/renderer\/assets\/index-[A-Za-z0-9_-]+\.js$/,
  upstream: null,
  edits: [
    {
      anchor: `    setPrPanelState({ chatCollapsed: false });
    setAgentPanelState({ available: false, visible: false, mode: "edited-files" });
`,
      replace: `    setPrPanelState({ chatCollapsed: false });
    // right-panel-menu patch: AgentMode reports its own panel state; a reset here ran after that report.
`,
    },
  ],
};
