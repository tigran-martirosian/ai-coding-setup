// The TTS folder holds the venv whose python.exe the backend runs, with its site-packages and DLLs: whoever can
// change that folder runs code as this user at the next Read aloud. The default is therefore in the user's own
// %LOCALAPPDATA% (not C:\LocalTTS, which inherits Modify for every account from the root of C:), and the backend
// refuses a folder that a group of other accounts (Everyone, Authenticated Users, Users, Interactive, Anonymous,
// Guests) can write to, or that someone other than this user, SYSTEM or Administrators owns (an owner can change
// the permissions), by SIDs, so the check does not depend on the Windows language.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The default TTS folder before it moved to %LOCALAPPDATA%\LocalTTS */
export const OLD_DEFAULT = "C:\\LocalTTS";

/** The TTS folder for a setting: the setting when given, else %LOCALAPPDATA%\LocalTTS */
export function ttsDir(dir: unknown): string {
  if (typeof dir === "string" && dir.trim()) return path.resolve(dir.trim());
  const local = process.env.LOCALAPPDATA;
  if (!local)
    throw new Error(
      "LOCALAPPDATA is not set, so the default TTS folder (%LOCALAPPDATA%\\LocalTTS) cannot be found: set the TTS folder in Read aloud's settings",
    );
  return path.join(local, "LocalTTS");
}

// A PowerShell string that holds s as it is: single quotes expand nothing; a ' inside is doubled
const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * The PowerShell line that locks dir to this user, SYSTEM and Administrators. SYSTEM and Administrators go by
 * SID and the user by the real account name, so it works on Windows in any language.
 */
export function lockCommand(dir: string): string {
  const name = os.userInfo().username;
  const domain = process.env.USERDOMAIN;
  const user = domain ? `${domain}\\${name}` : name;
  return `icacls ${psQuote(dir)} /inheritance:r /grant:r ${psQuote(`${user}:(OI)(CI)F`)} '*S-1-5-18:(OI)(CI)F' '*S-1-5-32-544:(OI)(CI)F'`;
}

/**
 * When dir is the default TTS folder, it does not exist and the old default (C:\LocalTTS) does: what to run to
 * move it there and lock it. Otherwise null. Nothing is moved here.
 */
export function movedDefault(dir: string, old = OLD_DEFAULT): string | null {
  const local = process.env.LOCALAPPDATA;
  if (!local || dir !== path.join(local, "LocalTTS")) return null;
  if (existsSync(dir) || !existsSync(old)) return null;
  return `The default TTS folder moved from ${old} to ${dir}, where other accounts cannot change it; Read aloud does not move it for you. In PowerShell, move it: Move-Item -LiteralPath ${psQuote(old)} -Destination ${psQuote(dir)}  Then lock it to you: ${lockCommand(dir)}`;
}

/**
 * The paths other accounts must not change: the folder, the venv parts python.exe loads code from, python.exe,
 * and the base Python folder that the venv's pyvenv.cfg names by home (its python.exe runs too).
 */
export function pathsToCheck(dir: string): string[] {
  const venv = path.join(dir, "venv");
  const scripts = path.join(venv, "Scripts");
  const cfg = path.join(venv, "pyvenv.cfg");
  const home = readFileSync(cfg, "utf8").match(
    /^\s*home\s*=\s*(.*?)\s*$/m,
  )?.[1];
  if (!home)
    throw new Error(
      `${cfg} names no base Python folder (no "home =" line), so it cannot be checked`,
    );
  return [
    dir,
    venv,
    scripts,
    path.join(scripts, "python.exe"),
    cfg,
    path.join(venv, "Lib", "site-packages"),
    path.resolve(home),
  ];
}

const WIDE_SIDS = new Set([
  "S-1-1-0", // Everyone
  "S-1-5-11", // Authenticated Users
  "S-1-5-32-545", // Users
  "S-1-5-4", // Interactive
  "S-1-5-7", // Anonymous
  "S-1-5-32-546", // Guests
]);

// Owners besides this user: SYSTEM and Administrators
const OWNER_SIDS = new Set(["S-1-5-18", "S-1-5-32-544"]);

// Write data / add file, append data / add folder, delete children, delete, change permissions, take ownership,
// generic all, generic write
const WRITE_RIGHTS =
  0x2 | 0x4 | 0x40 | 0x10000 | 0x40000 | 0x80000 | 0x10000000 | 0x40000000;

// First "U\t<this user's SID>"; then per path that exists "O\t<index>\t<owner SID>\t<owner name>" and one line
// per Allow entry that applies to the path itself (InheritOnly ones only reach what is inside):
// "A\t<index>\t<SID>\t<name>\t<rights>".
const ACL_SCRIPT = `$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
"U\`t$([Security.Principal.WindowsIdentity]::GetCurrent().User.Value)"
$paths = $env:TTS_ACL_PATHS -split "\`n"
for ($i = 0; $i -lt $paths.Count; $i++) {
  if (-not (Test-Path -LiteralPath $paths[$i])) { continue }
  $acl = Get-Acl -LiteralPath $paths[$i]
  "O\`t$i\`t$($acl.GetOwner([Security.Principal.SecurityIdentifier]).Value)\`t$($acl.Owner)"
  foreach ($a in $acl.Access) {
    if ($a.AccessControlType -ne 'Allow') { continue }
    if ($a.PropagationFlags -band [Security.AccessControl.PropagationFlags]::InheritOnly) { continue }
    try { $sid = $a.IdentityReference.Translate([Security.Principal.SecurityIdentifier]).Value } catch { $sid = '' }
    "A\`t$i\`t$sid\`t$($a.IdentityReference.Value)\`t$($a.FileSystemRights.value__)"
  }
}`;

// PowerShell's output; it runs while the host goes on
function readAcls(paths: string[]): Promise<string> {
  const root = process.env.SystemRoot;
  if (!root)
    throw new Error("SystemRoot is not set, so PowerShell cannot be found");
  const fail = (why: string) =>
    new Error(`cannot read the TTS folder's permissions: ${why}`);
  return new Promise((resolve, reject) => {
    const child = spawn(
      path.join(
        root,
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      ["-NoProfile", "-NonInteractive", "-Command", ACL_SCRIPT],
      {
        windowsHide: true,
        timeout: 30_000,
        env: { ...process.env, TTS_ACL_PATHS: paths.join("\n") },
      },
    );
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => (out += d));
    child.stderr.setEncoding("utf8").on("data", (d: string) => (err += d));
    child.on("error", (e) => reject(fail(e.message)));
    child.on("close", (code, signal) => {
      if (code === 0) resolve(out);
      else
        reject(
          fail(
            err.trim() || (signal ? `stopped by ${signal}` : `exit ${code}`),
          ),
        );
    });
  });
}

// A set of paths found safe is not read again for this long; one found open is read again at once, so a
// folder locked after a refusal works at the next try
const SAFE_FOR_MS = 60_000;
const safeUntil = new Map<string, number>();

/**
 * For each path that a group of other accounts can write to: "<path>: <group> (<SID>) can change it"; for each
 * path owned by someone other than this user, SYSTEM or Administrators: "<path>: owned by <name> (<SID>)".
 * Empty when there are none. Windows only (the backend runs venv\Scripts\python.exe): elsewhere empty.
 * Rejects when the ACLs cannot be read.
 */
export async function othersCanWrite(paths: string[]): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const key = paths.join("\n");
  if ((safeUntil.get(key) ?? 0) > Date.now()) return [];
  const out = await readAcls(paths);
  const found: string[] = [];
  let me = "";
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const [kind, ...f] = line.split("\t");
    let text = "";
    if (kind === "U") me = f[0];
    else if (kind === "O") {
      const [i, sid, name] = f;
      if (sid !== me && !OWNER_SIDS.has(sid))
        text = `${paths[Number(i)]}: owned by ${name} (${sid}), not by you, SYSTEM or Administrators, so it can change the permissions`;
    } else if (kind === "A") {
      const [i, sid, name, rights] = f;
      if (WIDE_SIDS.has(sid) && Number(rights) & WRITE_RIGHTS)
        text = `${paths[Number(i)]}: ${name} (${sid}) can change it`;
    }
    if (text && !found.includes(text)) found.push(text);
  }
  if (!me)
    throw new Error(
      "cannot read the TTS folder's permissions: PowerShell did not give the current user",
    );
  if (!found.length) safeUntil.set(key, Date.now() + SAFE_FOR_MS);
  return found;
}
