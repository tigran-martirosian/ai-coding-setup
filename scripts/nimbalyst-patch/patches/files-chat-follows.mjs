// Our own change, not an upstream PR: Files mode's right chat shows the session the user is in. Files mode
// (EditorMode) draws ChatSidebar with no sessionId, so the panel picks its own: on its first showing in a project it
// waits 100 ms, then takes the first session of `sessions:list` with no worktree and no child sessions, and it never
// follows the Sessions view after that (tracker chat proofs, point 5; user's card answers 2026-11-14: "This
// session", "Every time"). With this patch, the panel loads the session open in the Sessions view
// (activeSessionIdAtom) through its own `loadSession` each time Files mode is shown and each time that session
// changes, so a start that restores Files mode, before the Sessions view has set the atom, still ends on it.
// A project switch on the rail: EditorMode's effect runs before AgentMode's, so the atom still holds the old
// project's session for one draw; that id is not loaded, and the next one AgentMode sets is. `loadSession` marks the
// pick as the user's (`explicitSelectionRef`), which stopped the panel's own pick in every later project: the second
// edit clears that mark when the panel starts on a new project, before its 100 ms wait. With no open session nothing
// is loaded and the panel picks its own; a pick made in the panel's own session menu stays until Files mode is left
// or the open session changes. Never retires: no upstream fix to wait for.
export default {
  id: "files-chat-follows",
  files: /^out\/renderer\/assets\/index-[A-Za-z0-9_-]+\.js$/,
  upstream: null,
  edits: [
    // In EditorMode, before the welcome screen's "focus the agent" callback: the open session and the effect
    {
      anchor: `  const handleWelcomeFocusAgent = reactExports.useCallback(`,
      replace: `  // files-chat-follows: Files mode's chat loads the session open in the Sessions view when shown and when it changes
  const filesChatOpenId = useAtomValue(activeSessionIdAtom);
  const filesChatSeenRef = reactExports.useRef({ workspace: workspacePath2, id: filesChatOpenId, ignore: null });
  reactExports.useEffect(() => {
    const seen = filesChatSeenRef.current;
    let ignore = seen.ignore === filesChatOpenId ? seen.ignore : null;
    if (seen.workspace !== workspacePath2 && seen.id === filesChatOpenId) ignore = filesChatOpenId;
    filesChatSeenRef.current = { workspace: workspacePath2, id: filesChatOpenId, ignore };
    if (!isActive || !filesChatOpenId || filesChatOpenId === ignore) return;
    chatSidebarRef.current?.loadSession(filesChatOpenId);
  }, [isActive, filesChatOpenId, workspacePath2]);
  const handleWelcomeFocusAgent = reactExports.useCallback(`,
    },
    // In ChatSidebar's first pick per project: a pick loaded in another project no longer stops this one
    {
      anchor: `    initializedWorkspaceRef.current = workspacePath2;
    const initSession = async () => {`,
      replace: `    initializedWorkspaceRef.current = workspacePath2;
    explicitSelectionRef.current = false;
    const initSession = async () => {`,
    },
  ],
};
