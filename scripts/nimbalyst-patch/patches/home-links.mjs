// Our own change, not an upstream PR: a chat link written with a home-folder tilde (~/.claude/CLAUDE.md) opens
// the real file. Nimbalyst took the tilde literally, so the File viewer opened a tab for a path that does not
// exist, showed an empty editor ("Enter some rich text...") and closed the tab within a fifth of a second.
// The preload hands the window the home folder (process.env works in a sandboxed preload; Node's os does not),
// and the chat's link code swaps a leading ~/ or ~\ for it. With no home folder known, the link stays as it was.
export default {
  id: "home-links",
  files:
    /^out\/(preload\/index\.js|renderer\/assets\/registerExtensionSystem-[^/]+\.js)$/,
  upstream: null,
  edits: [
    {
      anchor: `electron.contextBridge.exposeInMainWorld("electronAPI", {
  onFileNew: (callback) => {`,
      replace: `electron.contextBridge.exposeInMainWorld("electronAPI", {
  // home-links patch: the home folder, so a chat link written ~/... opens the real file
  homeDir: process.env.USERPROFILE || process.env.HOME || "",
  onFileNew: (callback) => {`,
    },
    {
      anchor: `const filePath = fileTarget?.path ?? null;`,
      replace: String.raw`const homeLinkDir = /^~[\\/]/.test(fileTarget?.path ?? "") ? window.electronAPI?.homeDir : "";
      const filePath = homeLinkDir ? homeLinkDir.replace(/\\/g, "/") + "/" + fileTarget.path.slice(2) : fileTarget?.path ?? null;`,
    },
  ],
};
