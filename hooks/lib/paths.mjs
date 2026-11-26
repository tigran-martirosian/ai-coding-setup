// Paths the hooks all work out: Git Bash's /c/x, the project folder, a file's comparison key, a session id as a file name,
// a Windows program's full path.
import fs from "node:fs";
import path from "node:path";

// Git Bash on Windows writes C:\ as /c/: /c/x -> c:/x. Elsewhere /c/x is a real path and stays.
export const gitBashToNative = (p) =>
  process.platform === "win32"
    ? String(p).replace(/^\/([A-Za-z])(?=\/|$)/, "$1:")
    : String(p);

// The open project: CLAUDE_PROJECT_DIR, else the nearest folder at or above the event's cwd holding a CLAUDE.md or
// .git, else the cwd itself (the process's own folder when the event has none)
export function projectRoot(event) {
  const cwd = event?.cwd || process.cwd();
  // CLAUDE_PROJECT_DIR is the open project; the hook's cwd follows Bash `cd` and can sit elsewhere
  const envDir = process.env.CLAUDE_PROJECT_DIR;
  if (envDir && fs.existsSync(envDir))
    return gitBashToNative(envDir.replace(/\\/g, "/"));
  // A C:/ path climbs with Windows rules everywhere: elsewhere dirname walks "C:" to "." (the process's own folder)
  const P = /^[A-Za-z]:[\\/]/.test(cwd) ? path.win32 : path;
  for (let d = cwd; ; ) {
    if (
      fs.existsSync(P.join(d, "CLAUDE.md")) ||
      fs.existsSync(P.join(d, ".git"))
    )
      return d;
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

// The tidy marks (setup-state.json ownTidied) are kept under fileKey; a mark written before that is under the path
// as written (absolute, forward slashes), so a lookup tries both and a new mark drops the old key
const writtenKey = (p) => path.resolve(String(p)).replace(/\\/g, "/");
export const markOf = (marks, file) =>
  marks[fileKey(file)] ?? marks[writtenKey(file)];
export function setMark(marks, file, sha) {
  delete marks[writtenKey(file)];
  marks[fileKey(file)] = sha;
}

// A session id as a file name
export const sessionKey = (id) => String(id || "none").replace(/[^\w-]/g, "");

// A Windows program by its full path under %SystemRoot%\System32 (rel: "taskkill.exe",
// "WindowsPowerShell/v1.0/powershell.exe"). A bare name is looked up in the working folder and on PATH first, so a
// planted program of that name would run instead, and a PATH without the folder fails with ENOENT. git stays a bare
// name in the setup: it has no fixed system folder.
export function system32Exe(rel) {
  if (!process.env.SystemRoot)
    throw new Error(`SystemRoot is not set, so ${rel} cannot be found`);
  return path.win32.join(process.env.SystemRoot, "System32", rel);
}
export const powershellExe = () =>
  system32Exe("WindowsPowerShell/v1.0/powershell.exe");
