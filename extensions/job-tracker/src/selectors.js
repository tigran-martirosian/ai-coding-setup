// Where the job tracker finds the app's tracker screen (Nimbalyst 0.83.0, tracker design "Build proofs",
// point 7: seen live). Only data attributes, test ids and the table's own class; never the app's styling classes.
const SEL = {
  // The tracker page; it gets the class `hidden` outside Tracker mode
  page: '[data-layout="tracker-mode-wrapper"]',
  // The app's list of rows; our page goes right above it and hides it
  table: ".tracker-table-container",
  // The tracker's sidebar (the project header, its type list and saved views), hidden while our page is on
  sidebar: ".tracker-sidebar",
  // With no Sessions column to show, the parts of that sidebar that stay: the colour line and the project header
  sidebarKeep: ".workspace-color-accent, .workspace-summary-header",
  // Sessions mode's left column (header, tabs, search, the Sessions list), shown in the tracker in place of the
  // sidebar; the column is the child of this panel that holds the list
  sessionsHome: ".agent-mode .resizable-panel-left",
  sessionsList: ".session-history-list",
  // The tracker's flex row (tracker chat proofs, point 3); the chat column goes in as its last child
  trackerRow: ".tracker-mode",
  // The Sessions view's chat column (session tabs, transcript, input) and its home, a grid (tracker chat proofs,
  // point 4: seen live)
  chatHome: ".agent-mode .agent-workstream-panel",
  chatColumn:
    ".agent-mode .agent-workstream-panel > .agent-workstream-session-area",
  // The open session's row in the Sessions list (tracker chat proofs, point 1: seen live)
  currentSession: '[data-testid="session-list-item"][aria-current="page"]',
  // Our own elements, so a second sync finds them again
  root: "section.rt-root",
};

/** The tracker page when it is on screen, else null. */
function trackerPage(doc) {
  const page = doc.querySelector(SEL.page);
  return page && !page.classList.contains("hidden") ? page : null;
}

export { SEL, trackerPage };
