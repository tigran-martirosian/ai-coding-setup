// install.mjs --uninstall: takes the setup out again. Its hook wiring leaves settings.json, its files go
// unless changed, the oldest copy in setup-logs on record as the user's is put back; the project
// folders, plugins and extensions stay, and the run says how to remove them. A backup with its schedule on is turned
// off first (workers/backup.mjs off), so no scheduled task is left starting a deleted script; the backup's folder stays.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  restore as restoreNimbalyst,
  runningFrom,
} from "../tools/nimbalyst-patch/patch.mjs";
import { HELPER_DENY } from "./claude-code-settings.mjs";
import { dropAgy, dropCcpoolStart, dropSwitches } from "./claude-files.mjs";
import {
  BACKUP_DIR,
  filesIn,
  fwd,
  moveFile,
  OWN_FOLDERS,
  read,
  sha,
} from "./files.mjs";
import { EXT_FOLDER, nimbalystHome } from "./nimbalyst-paths.mjs";
import { scriptsOf, unwire } from "./wiring.mjs";

// Nimbalyst's resources folder as patch.mjs lays it out (its paths() is not exported): the patched app.asar, the
// original it keeps as app.asar.orig, its marker file, and the install folder its running check looks in
const nimbalystApp = (res) => ({
  res,
  asar: path.join(res, "app.asar"),
  orig: path.join(res, "app.asar.orig"),
  marker: path.join(res, "ai-coding-setup-patched.json"),
  install: path.dirname(res),
});

export function uninstall(ctx) {
  const {
    state,
    stateFile,
    CLAUDE,
    REPO,
    PROJECTS,
    home,
    settings,
    settingsFile,
    homeSettings,
    DRY,
    WIN,
    say,
    short,
    putJson,
  } = ctx;
  if (!fs.existsSync(stateFile)) {
    console.log(
      `${fwd(stateFile)} is missing: there is no record of an install in ${fwd(CLAUDE)}, so nothing was removed.`,
    );
    process.exit(1);
  }
  // A setup put in place before files were on record can't say which files are its own: nothing is changed
  if (state.version && !("files" in state)) {
    console.log(
      `${fwd(stateFile)} has no record of the files this setup wrote (it comes from an older version), so nothing was removed. Run the update first (node ${fwd(path.join(REPO, "install.mjs"))}, or /update-setup in a chat), which writes that record, then run --uninstall again.`,
    );
    process.exit(1);
  }
  // 0. the backup's schedule off while its script is still there (CLAUDE_BACKUP_HOME, else ~/.claude-backup, as in
  // skills/update-setup/update.mjs); when that fails nothing else is changed
  const backupHome = process.env.CLAUDE_BACKUP_HOME
    ? path.resolve(process.env.CLAUDE_BACKUP_HOME)
    : path.join(home, ".claude-backup");
  const backupConfig = path.join(backupHome, "config.json");
  if (fs.existsSync(backupConfig)) {
    const notOff = (why) => {
      console.log(`The uninstall stopped, nothing was changed: ${why}`);
      process.exit(1);
    };
    let cfg;
    try {
      cfg = JSON.parse(fs.readFileSync(backupConfig, "utf8"));
    } catch (e) {
      notOff(
        `${fwd(backupConfig)} could not be read (${e.message}), so it is not known whether the backup's schedule is on. Fix the file, or turn the schedule off with /backup, then run --uninstall again.`,
      );
    }
    if (cfg.schedule) {
      const worker = path.join(CLAUDE, "workers", "backup.mjs");
      if (!fs.existsSync(worker))
        notOff(
          `the backup's schedule is on and ${fwd(worker)} is missing, so it can't be turned off. Remove the scheduled backup by hand (Windows: the task "Claude backup" in Task Scheduler; Mac: launchctl bootout of com.ai-coding-setup.backup), set "schedule": false in ${fwd(backupConfig)}, then run --uninstall again.`,
        );
      const command = `node "${fwd(worker)}" off`;
      if (DRY)
        say(
          `would turn the backup's schedule off (${command}); the backup's folder ${fwd(backupHome)} stays`,
        );
      else {
        const r = spawnSync(process.execPath, [worker, "off"], {
          encoding: "utf8",
          windowsHide: true,
          env: {
            ...process.env,
            CLAUDE_BACKUP_HOME: backupHome,
            CLAUDE_HOME: CLAUDE,
          },
        });
        if (r.error || r.status !== 0)
          notOff(
            `turning the backup's schedule off failed: ${(r.error?.message || r.stderr || r.stdout || `exit ${r.status}`).trim()}. Fix that (or run ${command} yourself), then run --uninstall again.`,
          );
        say(
          `the backup's schedule is off (${command}); the backup's folder ${fwd(backupHome)} stays`,
        );
      }
    }
  }
  const root = fwd(CLAUDE).toLowerCase() + "/";
  const recorded = state.files || {};
  const kept = [];
  const removed = new Set();
  // 1. the hook wiring: an entry whose script is one of the setup's files (or a retired one) leaves settings.json
  const owned = new Set(
    [
      ...Object.keys(recorded),
      ...ctx.files.map((f) => fwd(path.join(CLAUDE, f))),
    ].map((f) => f.toLowerCase()),
  );
  const setups = (h) =>
    scriptsOf(h, home).some(
      (s) => owned.has(s) || ctx.RETIRED.some((n) => s === `${root}hooks/${n}`),
    );
  const settingsBefore = JSON.stringify(settings);
  unwire(ctx, settings, setups);
  // The rules that block the built-in helpers go too: they point to the worker agent, which goes below
  const deny = settings.permissions?.deny;
  if (Array.isArray(deny) && deny.some((r) => HELPER_DENY.includes(r))) {
    settings.permissions.deny = deny.filter((r) => !HELPER_DENY.includes(r));
    say(
      `permissions: the rules blocking the Explore and general-purpose helpers are taken out of ${fwd(settingsFile)}`,
    );
  }
  // The empty CLAUDE_CODE_EFFORT_LEVEL the setup set goes; a value the person set stays
  if (settings.env?.CLAUDE_CODE_EFFORT_LEVEL === "") {
    delete settings.env.CLAUDE_CODE_EFFORT_LEVEL;
    if (!Object.keys(settings.env).length) delete settings.env;
    say(
      `effort: the empty CLAUDE_CODE_EFFORT_LEVEL is taken out of ${fwd(settingsFile)}, so Nimbalyst's effort picker sets the level again`,
    );
  }
  if (JSON.stringify(settings) !== settingsBefore)
    putJson(settingsFile, settings, settingsBefore);
  // 1b. the project folders keep their files, but their settings lose the entries that start a script in
  // ~/.claude (those scripts go below), and the picture skill's link into ~/.claude goes
  for (const name of ctx.HOMES) {
    const s = homeSettings[name];
    const was = JSON.stringify(s);
    unwire(ctx, s, setups, ` in ${name}`);
    if (JSON.stringify(s) !== was)
      putJson(path.join(PROJECTS, name, ".claude", "settings.json"), s, was);
    const link = path.join(PROJECTS, name, ".claude", "skills", "picture");
    if (
      ctx.homes.picture.homes.includes(name) &&
      fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()
    ) {
      if (!DRY) {
        if (WIN) fs.rmdirSync(link);
        else fs.unlinkSync(link);
      }
      say(`removed the link ${fwd(link)} (it pointed into ${fwd(CLAUDE)})`);
    }
  }
  // 2. the files: removed while they are what a run wrote; one that differs, or has no record, stays
  const drop = (file) => {
    if (!DRY) fs.rmSync(file);
    removed.add(fwd(file));
    say(`removed ${fwd(file)}`);
  };
  for (const [file, hash] of Object.entries(recorded)) {
    if (!fwd(file).toLowerCase().startsWith(root) || !fs.existsSync(file))
      continue; // the project folders are not touched
    if (sha(fs.readFileSync(file)) === hash) drop(file);
    else kept.push(`${short(file)} (it differs from what the setup wrote)`);
  }
  for (const f of ctx.files.map((rel) => path.join(CLAUDE, rel))) {
    if (!(fwd(f) in recorded) && fs.existsSync(f))
      kept.push(`${short(f)} (no record that the setup wrote it)`);
  }
  const rules = path.join(CLAUDE, "CLAUDE.md");
  if (fs.existsSync(rules)) {
    if (state.rules && sha(read(rules)) === state.rules) drop(rules);
    else
      kept.push(`CLAUDE.md (the rules; they differ from what the setup wrote)`);
  }
  if (fs.existsSync(path.join(CLAUDE, "rules", "my-rules.md")))
    kept.push(`rules/my-rules.md (your own rules; my-rules.md stays)`);
  dropSwitches(ctx, drop);
  // the project pass record install.mjs writes (the level, and the folders /update-project stamped)
  if (fs.existsSync(path.join(CLAUDE, "project-pass.json")))
    drop(path.join(CLAUDE, "project-pass.json"));
  if (!DRY)
    for (const file of removed) {
      for (
        let d = path.dirname(file);
        fwd(d).toLowerCase().startsWith(root);
        d = path.dirname(d)
      ) {
        if (!fs.existsSync(d)) continue; // already taken out with an earlier file
        if (fs.readdirSync(d).length) break;
        fs.rmdirSync(d);
      }
    }
  // 3. the copies in setup-logs/<date>-install-backup: of the setup's files and the rules, the oldest copy that is
  // on record as the user's goes back to its place when nothing of the user's is there. A copy of a setup file an
  // update replaced is the setup's older version, not theirs, and stays in setup-logs with the other copies.
  const userCopy = new Set(
    [...ctx.userCopies].map((c) => fwd(c).toLowerCase()),
  );
  const isUsers = (copy) => userCopy.has(fwd(copy).toLowerCase());
  const logs = path.join(CLAUDE, "setup-logs");
  const restorable = (target) =>
    fwd(target).toLowerCase() ===
      fwd(path.join(CLAUDE, "CLAUDE.md")).toLowerCase() ||
    [...OWN_FOLDERS, "shared-skills"].some((d) =>
      fwd(target)
        .toLowerCase()
        .startsWith(fwd(path.join(CLAUDE, d)).toLowerCase() + "/"),
    );
  const byTarget = new Map();
  // rec: the copy's path in setup-logs, as the record names it; copy: where it is now. They differ only in a dry
  // run, where an old copy beside its file (ctx.dryMoves) was not moved into setup-logs first.
  const add = (dir, rel, copy) => {
    const m = dir.match(BACKUP_DIR);
    const target = path.join(home, rel);
    if (!m || !restorable(target)) return;
    byTarget.set(target, [
      ...(byTarget.get(target) || []),
      {
        copy,
        rec: path.join(logs, dir, rel),
        key: `${m[1]}-${String(m[2] || 1).padStart(3, "0")}`,
      },
    ]);
  };
  for (const dir of fs.existsSync(logs) ? fs.readdirSync(logs) : []) {
    if (BACKUP_DIR.test(dir))
      for (const rel of filesIn(path.join(logs, dir)))
        add(dir, rel, path.join(logs, dir, rel));
  }
  for (const [from, to] of ctx.dryMoves || []) {
    const [dir, ...rel] = path.relative(logs, to).split(path.sep);
    add(dir, path.join(...rel), from);
  }
  for (const [target, list] of byTarget) {
    list.sort((a, b) => a.key.localeCompare(b.key));
    const first = list.findIndex(({ rec }) => isUsers(rec));
    if (first === -1) continue;
    if (removed.has(fwd(target)) || !fs.existsSync(target)) {
      if (!DRY) moveFile(list[first].copy, target);
      say(`restored ${fwd(target)} from ${short(list[first].copy)}`);
    } else
      kept.push(
        `${short(list[first].copy)} (your copy of ${short(target)}; a file with that name is there)`,
      );
  }
  // 4. what an older version set up in Antigravity, and the ccpool start at log-on of the retired /shared-usage
  dropAgy(ctx, kept);
  dropCcpoolStart(ctx);
  // 4b. Nimbalyst back on its own Claude Code, when the path there is still the one the setup set
  if (state.nimbalystClaude && ctx.opt("home") === null) {
    const aiFile = path.join(nimbalystHome(), "ai-settings.json");
    let ai = null;
    try {
      ai = JSON.parse(fs.readFileSync(aiFile, "utf8"));
    } catch (e) {
      kept.push(
        `Nimbalyst's custom Claude Code path (${fwd(aiFile)} could not be read: ${e.message}); empty it in Nimbalyst's settings`,
      );
    }
    if (ai && ai.customClaudeCodePath === state.nimbalystClaude) {
      ai.customClaudeCodePath = "";
      if (!DRY) fs.writeFileSync(aiFile, JSON.stringify(ai, null, 2) + "\n");
      say(`Nimbalyst back on its own Claude Code (${fwd(aiFile)})`);
    }
  }
  // 4c. Nimbalyst's original app.asar back, when the setup's patcher left its backup or its marker. The real install
  // under LOCALAPPDATA; with --home (the tests) the one under <home>/AppData/Local, never the real one. patch.mjs
  // refuses while Nimbalyst runs (it holds app.asar): then the run names the command to put it back later.
  const local =
    ctx.opt("home") === null
      ? process.env.LOCALAPPDATA
      : path.join(home, "AppData", "Local");
  const app =
    local &&
    nimbalystApp(path.join(local, "Programs", "Nimbalyst", "resources"));
  if (app && (fs.existsSync(app.orig) || fs.existsSync(app.marker))) {
    const later = `node "${fwd(path.join(REPO, "tools", "nimbalyst-patch", "patch.mjs"))}" --restore --app "${fwd(app.res)}"`;
    try {
      if (runningFrom(app.install).length)
        kept.push(
          `Nimbalyst's patched app.asar (Nimbalyst is running and holds it); quit Nimbalyst, then put the original back with: ${later}`,
        );
      else if (DRY)
        say(`would put Nimbalyst's original app.asar back in ${fwd(app.res)}`);
      else for (const line of restoreNimbalyst(app)) say(`Nimbalyst: ${line}`);
    } catch (e) {
      say(
        `FAILED: Nimbalyst's original app.asar was NOT put back (${e.message}). Fix that, then run: ${later}`,
      );
      kept.push(
        `Nimbalyst's patched app.asar (putting the original back failed, see above); run: ${later}`,
      );
    }
  }
  // 4d. Obscura, which the install put in ~/.claude/obscura (scripts/obscura.mjs); only that folder, never one on the PATH
  const obscura = path.join(CLAUDE, "obscura");
  if (fs.existsSync(path.join(obscura, "VERSION"))) {
    if (!DRY) fs.rmSync(obscura, { recursive: true, force: true });
    say(
      `removed ${fwd(obscura)} (Obscura, the headless browser peek.mjs fell back on)`,
    );
  }
  if (!DRY) fs.rmSync(stateFile);
  say(`removed ${fwd(stateFile)} (the record of this install)`);
  // 5. what stays, and how to take it out
  say(`Kept, not touched:`);
  say(
    `  your files in the project folders (they may hold your work): ${fwd(PROJECTS)}; delete a folder by hand when it is not needed`,
  );
  say(
    `  ${fwd(settingsFile)}: everything except the hook wiring, the two helper rules and the empty effort variable, including the other permission rules, the model and the language the setup set; edit them by hand`,
  );
  for (const k of kept) say(`  ${k}`);
  if (fs.existsSync(backupHome))
    say(
      `  ${fwd(backupHome)}: the backup's folder; it holds the backup's password and storage key. The backups in your Backblaze bucket stay. Save the password somewhere else before you delete this folder by hand, or the backups can't be read`,
    );
  if (fs.existsSync(logs))
    say(
      `  ${fwd(logs)}: what each run printed, and in <date>-install-backup folders the copies of the files a run replaced (the settings, the record, older versions of the setup's files); delete the folder when it is not needed`,
    );
  const plugins = state.plugins || [];
  const pluginNames = plugins.filter((n) => n !== "find-skills");
  if (pluginNames.length)
    say(
      `  plugins (${pluginNames.join(", ")}); remove one with: claude plugin uninstall <name>`,
    );
  if (plugins.includes("find-skills"))
    say(
      `  the find-skills skill (fetched with npx, not a plugin); remove it with: npx skills remove find-skills -g, or delete ${fwd(path.join(CLAUDE, "skills", "find-skills"))} and ${fwd(path.join(home, ".agents", "skills", "find-skills"))} by hand`,
    );
  if (Object.keys(state.extensions || {}).length)
    say(
      `  Nimbalyst extensions (${Object.keys(state.extensions)
        .map((n) => EXT_FOLDER[n] || n)
        .join(
          ", ",
        )}); delete each of these folders under Nimbalyst's extensions folder (@nimbalyst/electron/extensions) and restart Nimbalyst`,
    );
  say(
    DRY
      ? "Nothing was changed."
      : "Done. Restart Claude Code so it stops loading the hooks.",
  );
}
