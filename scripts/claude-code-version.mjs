// Keeps the Claude Code that runs this setup current. Used by install.mjs, which /update-setup runs too.
//   - reads the CLI version, compares it with npm's newest, updates it when behind
//   - below the minimum the setup needs (version.json: claudeCodeMin), after trying to update, the install stops
//   - finds the Claude Code that Nimbalyst ships with itself and says when it is behind
// A failed network check is said plainly and the install goes on. Commands go through `run`, so tests stub them.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const NIMBALYST_NOTE = (v) =>
  `Nimbalyst runs its own Claude Code (${v}). Install Nimbalyst updates as soon as they appear: its sessions get Claude Code fixes only through them.`;

const SELF_UPDATE_FAILED = "Claude Code could not update itself while it is running. Close Claude, run `claude update` (or `npm i -g @anthropic-ai/claude-code@latest`) in a plain terminal, then run the install again.";

// "2.1.312 (Claude Code)" -> "2.1.312"; anything else -> null
export const parseVersion = (text) => (String(text || "").match(/\b(\d+\.\d+\.\d+)\b/) || [])[1] || null;

// -1, 0 or 1
export function compareVersions(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0) ? -1 : 1;
  return 0;
}

// Where Nimbalyst keeps its Claude Code on the default install paths
export function nimbalystCandidates(platform, env, arch) {
  const exe = platform === "win32" ? "claude.exe" : "claude";
  const sub = path.posix.join("resources", "claude-runtime", `${platform}-${arch}`, exe);
  const bases = platform === "win32"
    ? (env.LOCALAPPDATA ? [path.join(env.LOCALAPPDATA, "Programs", "Nimbalyst")] : [])
    : platform === "darwin"
      ? ["/Applications/Nimbalyst.app/Contents", path.join(env.HOME || "", "Applications", "Nimbalyst.app", "Contents")]
      : ["/opt/Nimbalyst", "/opt/nimbalyst", path.join(env.HOME || "", ".local", "share", "nimbalyst")];
  return bases.map((b) => path.join(b, sub));
}

// The real command runner; a path with a folder is run directly, a plain name through the shell (claude.cmd on Windows)
// Nimbalyst sets DISABLE_UPDATES and DISABLE_AUTOUPDATER for its own bundled Claude Code; run from one of its sessions,
// `claude update` inherits them and refuses ("Updates are disabled by your administrator"), so they are left out here.
// cmd.exe looks in the current folder before the PATH; NoDefaultCurrentDirectoryInExePath turns that off, and the
// commands run from the home folder, so a claude.exe or npm.cmd inside a project folder is never the one run.
export function childEnv(env = process.env) {
  const out = { ...env, NoDefaultCurrentDirectoryInExePath: "1" };
  delete out.DISABLE_UPDATES;
  delete out.DISABLE_AUTOUPDATER;
  return out;
}

export function realRun(cmd, args, ms = 10 * 60 * 1000) {
  const direct = path.isAbsolute(cmd);
  const viaCmd = !direct && process.platform === "win32";
  const opts = { encoding: "utf8", timeout: ms, env: childEnv(), cwd: os.homedir() };
  const r = viaCmd ? spawnSync(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", cmd, ...args], opts)
    : spawnSync(cmd, args, opts);
  return { status: r.status, stdout: r.stdout || "", stderr: r.stderr || "", error: r.error };
}

// Which command updates this install: npm when `claude` sits in an npm folder, else Claude Code's own `claude update`
export function updateCommand(claudePath) {
  if (claudePath && /node_modules|[\/]npm[\/]|[\/]npm$/i.test(claudePath)) return ["npm", ["i", "-g", "@anthropic-ai/claude-code@latest"]];
  return ["claude", ["update"]];
}

// opts: { min, dry, run, exists, platform, arch, env, log }. Returns { stop: string|null }.
export function checkClaudeCode(opts) {
  const { min, dry = false, run = realRun, exists = fs.existsSync, platform = process.platform, arch = process.arch, env = process.env, log = console.log } = opts;
  // SETUP_CC_CHECK=off skips the whole check (tests, offline use) with one line; "done" skips it silently
  // (update.mjs sets it for an install.mjs it starts after it has checked itself).
  if (env.SETUP_CC_CHECK === "off") { log("Claude Code: version check skipped (SETUP_CC_CHECK=off)."); return { stop: null }; }
  if (env.SETUP_CC_CHECK === "done") return { stop: null };
  const versionOf = (cmd) => { const r = run(cmd, ["--version"], 30000); return r.status === 0 && !r.error ? parseVersion(r.stdout) : null; };

  let cur = versionOf("claude");
  const npmOut = run("npm", ["view", "@anthropic-ai/claude-code", "version"]);
  const latest = npmOut.status === 0 && !npmOut.error ? parseVersion(npmOut.stdout) : null;
  if (!latest) log("Claude Code: could not ask npm for the newest version (no network or no npm), so it was not compared. Going on.");

  if (!cur) {
    log("Claude Code: its version could not be read (not found on the PATH, or no answer within 30 seconds), so it was not checked. Install it and run this again if you use it in a terminal.");
  } else {
    const behind = latest ? compareVersions(cur, latest) < 0 : compareVersions(cur, min) < 0;
    if (!behind) {
      log(`Claude Code ${cur}${latest ? ", the newest" : ""}.`);
    } else if (dry) {
      log(`Claude Code ${cur} is behind ${latest || `the minimum ${min}`}; a real run updates it.`);
    } else {
      const where = run(platform === "win32" ? "where" : "which", ["claude"]);
      const [cmd, cargs] = updateCommand(where.status === 0 ? where.stdout.split(/\r?\n/)[0].trim() : "");
      log(`Claude Code ${cur} is behind ${latest || `the minimum ${min}`}: running ${cmd} ${cargs.join(" ")}`);
      const u = run(cmd, cargs);
      if (u.status !== 0 || u.error) log(`${SELF_UPDATE_FAILED} (${u.error ? u.error.message : (u.stderr || u.stdout).trim().split("\n").pop() || `exit ${u.status}`})`);
      cur = versionOf("claude") || cur;
      log(`Claude Code is now ${cur}.`);
    }
    if (!dry && compareVersions(cur, min) < 0) {
      return { stop: `Claude Code ${cur} is older than ${min}, which this setup needs (its agent files use autoCompactWindow). ${SELF_UPDATE_FAILED}` };
    }
    if (dry && compareVersions(cur, min) < 0) log(`Claude Code ${cur} is older than ${min}, which this setup needs; a real run stops until it is updated.`);
  }

  const bundled = nimbalystCandidates(platform, env, arch).find((p) => exists(p));
  if (bundled) {
    const nv = versionOf(bundled);
    if (!nv) log("Nimbalyst's Claude Code: its version could not be read.");
    else {
      log(`Nimbalyst's Claude Code: ${nv}.`);
      if (compareVersions(nv, min) < 0 || (latest && compareVersions(nv, latest) < 0)) log(NIMBALYST_NOTE(nv));
    }
  }
  return { stop: null };
}

// Nimbalyst's chats run the Claude Code it bundles, which moves only with a Nimbalyst release, days after a
// Claude Code fix. Nimbalyst can run another one instead (its setting customClaudeCodePath, in
// @nimbalyst/electron/ai-settings.json, which it reads at each session's start). This points it at the person's own
// Claude Code, which `claude update` and every run of this install keep current. Safeguards:
//   - only a native binary (claude.exe on Windows; on a Mac or Linux anything but a .js file) that answers --version
//   - only when it is not older than the bundled one, and not below the setup's minimum
//   - only within the bundled one's line (2.1.x with a bundled 2.1.x): the fixes of that line, never a new line
//   - a path the person set themselves is never touched; the setup changes only an empty field or the path it set
//   - when the own one falls behind the bundled one (a newer Nimbalyst), the field is emptied again
// Off: SETUP_NIMBALYST_CLAUDE=off. opts: { file, min, previous, dry, run, exists, platform, arch, env, log }.
// Returns { set }: the path now on record as the setup's (null when the setup set none), for setup-state.json.
// True when the file sits directly in one of the PATH folders (`where` also lists the current folder's own files).
export function inPathFolder(file, platform, env) {
  const norm = (p) => { const n = p.replaceAll("\\", "/").replace(/\/+$/, ""); return platform === "win32" ? n.toLowerCase() : n; };
  const key = Object.keys(env).find((k) => k.toUpperCase() === "PATH");
  const dirs = String((key && env[key]) || "").split(platform === "win32" ? ";" : ":").filter(Boolean).map(norm);
  return dirs.includes(norm(path.dirname(file)));
}

export function pointNimbalyst(opts) {
  const { file, min, previous = null, dry = false, run = realRun, exists = fs.existsSync, platform = process.platform,
    arch = process.arch, env = process.env, log = console.log, read = (f) => fs.readFileSync(f, "utf8"),
    write = (f, text) => fs.writeFileSync(f, text) } = opts;
  if (env.SETUP_NIMBALYST_CLAUDE === "off") { log("Nimbalyst's Claude Code: left as it is (SETUP_NIMBALYST_CLAUDE=off)."); return { set: previous }; }
  if (!file || !exists(file)) return { set: previous }; // no Nimbalyst here, or it never opened
  let ai;
  try { ai = JSON.parse(read(file)); } catch (e) { log(`Nimbalyst's Claude Code: left as it is (${file} is not valid JSON: ${e.message}).`); return { set: previous }; }
  const current = typeof ai.customClaudeCodePath === "string" ? ai.customClaudeCodePath : "";
  if (current && current !== previous) { log(`Nimbalyst's Claude Code: left as it is (you set ${current} yourself).`); return { set: null }; }

  const versionOf = (cmd) => { const r = run(cmd, ["--version"], 30000); return r.status === 0 && !r.error ? parseVersion(r.stdout) : null; };
  const where = run(platform === "win32" ? "where" : "which", ["claude"]);
  const lines = where.status === 0 ? where.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean) : [];
  const own = lines.filter((l) => inPathFolder(l, platform, env))
    .find((l) => platform === "win32" ? /\.exe$/i.test(l) : !/\.js$/i.test(l));
  const bundledPath = nimbalystCandidates(platform, env, arch).find((p) => exists(p));
  const bundled = bundledPath ? versionOf(bundledPath) : null;
  const mine = own ? versionOf(own) : null;

  const save = (value, line) => {
    if (dry) { log(`${line} (a real run sets it)`); return; }
    ai.customClaudeCodePath = value;
    write(file, JSON.stringify(ai, null, 2) + "\n");
    log(line);
  };
  let why = "";
  if (!own) why = "no native Claude Code on the PATH (a terminal install through npm can't be used here; `claude install` adds the native one)";
  else if (!mine) why = `${own} gave no version`;
  else if (min && compareVersions(mine, min) < 0) why = `your Claude Code ${mine} is older than ${min}`;
  else if (bundled && compareVersions(mine, bundled) < 0) why = `your Claude Code ${mine} is older than Nimbalyst's own ${bundled}`;
  // a new major or minor line may change what Nimbalyst talks to it with: wait for a Nimbalyst that ships it
  else if (bundled && mine.split(".").slice(0, 2).join(".") !== bundled.split(".").slice(0, 2).join(".")) why = `your Claude Code ${mine} is a newer line than Nimbalyst's own ${bundled}; it is used once a Nimbalyst release ships that line`;
  if (why) {
    if (current && current === previous) { save("", `Nimbalyst's Claude Code: back to its own${bundled ? ` (${bundled})` : ""}, because ${why}.`); return { set: null }; }
    log(`Nimbalyst's Claude Code: left on its own${bundled ? ` (${bundled})` : ""}, because ${why}.`);
    return { set: null };
  }
  if (current === own) { log(`Nimbalyst's Claude Code: yours, ${mine}${bundled ? ` (its own is ${bundled})` : ""}.`); return { set: own }; }
  save(own, `Nimbalyst's Claude Code: now yours, ${mine}${bundled ? `, instead of its own ${bundled}` : ""}, so its chats get Claude Code fixes on the day they ship. New chats use it; to undo, empty the custom Claude Code path in Nimbalyst's settings, or run the install with SETUP_NIMBALYST_CLAUDE=off.`);
  return { set: dry ? previous : own };
}
