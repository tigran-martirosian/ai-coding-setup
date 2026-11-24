// Our own change, not an upstream PR: the agent view's right-panel menu names its first view "Edited Files",
// but that view also holds the Agents & commands list under the files, so the name hides half of it.
// This renames the menu entry to "Files & agents", and the File viewer's empty-state button that opens that
// view to "Show files & agents", so both use the same name. It also puts "Chat with Session" in sentence case
// like the other entries. Only words change; the mode ids "edited-files" and "session-chat" stay,
// so saved panel state and every check on the ids keep working. Never retires: no upstream change to wait for.
export default {
  id: "files-and-agents",
  files: /^out\/renderer\/assets\/[A-Za-z0-9_-]+\.js$/,
  upstream: null,
  edits: [
    {
      anchor: `  { id: "edited-files", label: "Edited Files", icon: "description" },
`,
      replace: `  { id: "edited-files", label: "Files & agents", icon: "description" },
`,
    },
    {
      anchor: `  { id: "session-chat", label: "Chat with Session", icon: "forum" },
`,
      replace: `  { id: "session-chat", label: "Chat with session", icon: "forum" },
`,
    },
    {
      anchor: `mode: "edited-files" }), children: "Show edited files" })`,
      replace: `mode: "edited-files" }), children: "Show files & agents" })`,
    },
  ],
};
