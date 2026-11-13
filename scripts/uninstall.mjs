// install.mjs --uninstall: takes the setup out again. Its hook wiring leaves settings.json, its files go
// unless changed, the oldest .before-install copy on record as the user's is put back; the project
// folders, plugins and extensions stay, and the run says how to remove them.
import fs from "node:fs";
import path from "node:path";
import { BACKUP, filesIn, fwd, OWN_FOLDERS, read, sha } from "./files.mjs";
import { dropAgy, dropSwitches } from "./claude-files.mjs";
import { EXT_FOLDER, nimbalystHome } from "./nimbalyst-paths.mjs";
import { scriptsOf, unwire } from "./wiring.mjs";

export function uninstall(ctx) {
  const { state, stateFile, CLAUDE, REPO, PROJECTS, home, settings, settingsFile, homeSettings, DRY, WIN, say, short, putJson } = ctx;
  if (!fs.existsSync(stateFile)) { console.log(`${fwd(stateFile)} is missing: there is no record of an install in ${fwd(CLAUDE)}, so nothing was removed.`); process.exit(1); }
  // A setup put in place before files were on record can't say which files are its own: nothing is changed
  if (state.version && !("files" in state)) {
    console.log(`${fwd(stateFile)} has no record of the files this setup wrote (it comes from an older version), so nothing was removed. Run the update first (node ${fwd(path.join(REPO, "install.mjs"))}, or /update-setup in a chat), which writes that record, then run --uninstall again.`);
    process.exit(1);
  }
  const root = fwd(CLAUDE).toLowerCase() + "/";
  const recorded = state.files || {};
  const kept = [];
  const removed = new Set();
  // 1. the hook wiring: an entry whose script is one of the setup's files (or a retired one) leaves settings.json
  const owned = new Set([...Object.keys(recorded), ...ctx.files.map((f) => fwd(path.join(CLAUDE, f)))].map((f) => f.toLowerCase()));
  const setups = (h) => scriptsOf(h, home).some((s) => owned.has(s) || ctx.RETIRED.some((n) => s === `${root}hooks/${n}`));
  const settingsBefore = JSON.stringify(settings);
  unwire(ctx, settings, setups);
  if (JSON.stringify(settings) !== settingsBefore) putJson(settingsFile, settings, settingsBefore);
  // 1b. the project folders keep their files, but their settings lose the entries that start a script in
  // ~/.claude (those scripts go below), and the picture skill's link into ~/.claude goes
  for (const name of ctx.HOMES) {
    const s = homeSettings[name];
    const was = JSON.stringify(s);
    unwire(ctx, s, setups, ` in ${name}`);
    if (JSON.stringify(s) !== was) putJson(path.join(PROJECTS, name, ".claude", "settings.json"), s, was);
    const link = path.join(PROJECTS, name, ".claude", "skills", "picture");
    if (ctx.homes.picture.homes.includes(name) && fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
      if (!DRY) { if (WIN) fs.rmdirSync(link); else fs.unlinkSync(link); }
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
    if (!fwd(file).toLowerCase().startsWith(root) || !fs.existsSync(file)) continue; // the project folders are not touched
    if (sha(fs.readFileSync(file)) === hash) drop(file); else kept.push(`${short(file)} (it differs from what the setup wrote)`);
  }
  for (const f of ctx.files.map((rel) => path.join(CLAUDE, rel))) {
    if (!(fwd(f) in recorded) && fs.existsSync(f)) kept.push(`${short(f)} (no record that the setup wrote it)`);
  }
  const rules = path.join(CLAUDE, "CLAUDE.md");
  if (fs.existsSync(rules)) {
    if (state.rules && sha(read(rules)) === state.rules) drop(rules); else kept.push(`CLAUDE.md (the rules; they differ from what the setup wrote)`);
  }
  dropSwitches(ctx, drop);
  if (!DRY) for (const file of removed) {
    for (let d = path.dirname(file); fwd(d).toLowerCase().startsWith(root); d = path.dirname(d)) {
      if (!fs.existsSync(d)) continue; // already taken out with an earlier file
      if (fs.readdirSync(d).length) break;
      fs.rmdirSync(d);
    }
  }
  // 3. the .before-install copies: the oldest one that is on record as the user's goes back to its name when
  // nothing of the user's is there. A copy of a setup file an update replaced is the setup's older version, not theirs.
  const userCopy = new Set((state.userCopies || []).map((c) => fwd(c).toLowerCase()));
  const isUsers = (copy) => userCopy.has(fwd(copy).toLowerCase());
  const copies = [
    ...fs.readdirSync(CLAUDE).filter((n) => n.startsWith("CLAUDE.md.before-install-")).map((n) => path.join(CLAUDE, n)),
    ...[...OWN_FOLDERS, "shared-skills"].flatMap((d) => filesIn(path.join(CLAUDE, d)).map((f) => path.join(CLAUDE, d, f))),
  ].filter((f) => BACKUP.test(path.basename(f)));
  const byTarget = new Map();
  for (const copy of copies) {
    const [, base, date, n] = path.basename(copy).match(BACKUP);
    const target = path.join(path.dirname(copy), base);
    byTarget.set(target, [...(byTarget.get(target) || []), { copy, key: `${date}-${String(n || 1).padStart(3, "0")}` }]);
  }
  for (const [target, list] of byTarget) {
    list.sort((a, b) => a.key.localeCompare(b.key));
    const first = list.findIndex(({ copy }) => isUsers(copy));
    list.forEach(({ copy }, i) => {
      if (i === first && (removed.has(fwd(target)) || !fs.existsSync(target))) {
        if (!DRY) fs.renameSync(copy, target);
        return say(`restored ${fwd(target)} from ${path.basename(copy)}`);
      }
      kept.push(`${short(copy)} (${i === first ? "a file with that name is there" : isUsers(copy) ? "a later copy" : "no record that it is yours: it may be an older version of the setup's own file"})`);
    });
  }
  // 4. what an older version set up in Antigravity
  dropAgy(ctx, kept);
  // 4b. Nimbalyst back on its own Claude Code, when the path there is still the one the setup set
  if (state.nimbalystClaude && ctx.opt("home") === null) {
    const aiFile = path.join(nimbalystHome(), "ai-settings.json");
    let ai = null;
    try { ai = JSON.parse(fs.readFileSync(aiFile, "utf8")); } catch (e) { kept.push(`Nimbalyst's custom Claude Code path (${fwd(aiFile)} could not be read: ${e.message}); empty it in Nimbalyst's settings`); }
    if (ai && ai.customClaudeCodePath === state.nimbalystClaude) {
      ai.customClaudeCodePath = "";
      if (!DRY) fs.writeFileSync(aiFile, JSON.stringify(ai, null, 2) + "\n");
      say(`Nimbalyst back on its own Claude Code (${fwd(aiFile)})`);
    }
  }
  if (!DRY) fs.rmSync(stateFile);
  say(`removed ${fwd(stateFile)} (the record of this install)`);
  // 5. what stays, and how to take it out
  say(`Kept, not touched:`);
  say(`  your files in the project folders (they may hold your work): ${fwd(PROJECTS)}; delete a folder by hand when it is not needed`);
  say(`  ${fwd(settingsFile)}: everything except the hook wiring, including the permission rules, the model and the language the setup set; edit them by hand`);
  for (const k of kept) say(`  ${k}`);
  if (fs.existsSync(path.join(CLAUDE, "setup-logs"))) say(`  ${fwd(path.join(CLAUDE, "setup-logs"))}: what each run printed; delete the folder when it is not needed`);
  const stateCopies = fs.readdirSync(CLAUDE).filter((n) => /^(settings\.json|setup-state\.json)\.before-install-/.test(n));
  if (stateCopies.length) say(`  copies of the settings and of the record, made before a change (${stateCopies.join(", ")}); delete them when they are not needed`);
  const plugins = state.plugins || [];
  const pluginNames = plugins.filter((n) => n !== "find-skills");
  if (pluginNames.length) say(`  plugins (${pluginNames.join(", ")}); remove one with: claude plugin uninstall <name>`);
  if (plugins.includes("find-skills")) say(`  the find-skills skill (fetched with npx, not a plugin); remove it with: npx skills remove find-skills -g, or delete ${fwd(path.join(CLAUDE, "skills", "find-skills"))} and ${fwd(path.join(home, ".agents", "skills", "find-skills"))} by hand`);
  if (Object.keys(state.extensions || {}).length) say(`  Nimbalyst extensions (${Object.keys(state.extensions).map((n) => EXT_FOLDER[n] || n).join(", ")}); delete each of these folders under Nimbalyst's extensions folder (@nimbalyst/electron/extensions) and restart Nimbalyst`);
  say(DRY ? "Nothing was changed." : "Done. Restart Claude Code so it stops loading the hooks.");
}
