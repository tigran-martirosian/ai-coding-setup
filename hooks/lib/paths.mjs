// Paths the hooks all work out: Git Bash's /c/x, the project folder, a file's comparison key, a session id as a file name.
import fs from "node:fs";
import path from "node:path";

// Git Bash on Windows writes C:\ as /c/: /c/x -> c:/x. Elsewhere /c/x is a real path and stays.
export const gitBashToNative = (p) => (process.platform === "win32" ? String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:") : String(p));

// The open project: CLAUDE_PROJECT_DIR, else the nearest folder at or above the event's cwd holding a CLAUDE.md or
// .git, else the cwd itself (the process's own folder when the event has none)
export function projectRoot(event) {
  const cwd = event?.cwd || process.cwd();
  // CLAUDE_PROJECT_DIR is the open project; the hook's cwd follows Bash `cd` and can sit elsewhere
  const envDir = process.env.CLAUDE_PROJECT_DIR;
  if (envDir && fs.existsSync(envDir)) return gitBashToNative(envDir.replace(/\\/g, "/"));
  // A C:/ path climbs with Windows rules everywhere: elsewhere dirname walks "C:" to "." (the process's own folder)
  const P = /^[A-Za-z]:[\\/]/.test(cwd) ? path.win32 : path;
  for (let d = cwd; ; ) {
    if (fs.existsSync(P.join(d, "CLAUDE.md")) || fs.existsSync(P.join(d, ".git"))) return d;
    const up = P.dirname(d);
    if (up === d) return cwd;
    d = up;
  }
}

// One key per file for comparing paths: absolute, forward slashes, lower case on Windows
export function fileKey(p) {
  const k = path.resolve(String(p)).replace(/\\/g, "/");
  return process.platform === "win32" ? k.toLowerCase() : k;
}

// A session id as a file name
export const sessionKey = (id) => String(id || "none").replace(/[^\w-]/g, "");
