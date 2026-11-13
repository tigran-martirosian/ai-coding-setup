#!/usr/bin/env node
// Installs this setup. Safe to run again: it adds what is missing and a second run changes nothing.
//   1. ~/.claude: the hooks, the agents and the skills, and the hook wiring from
//      settings.example.json merged into settings.json
//   2. ~/.claude/CLAUDE.md: the global rules from rules/, with the section about outside workers that
//      fits what is installed (Codex, Antigravity, both or neither)
//   3. the base project folders from projects/ (ask-anything, internet-search, quick-tasks,
//      claude-settings), each with its skills, hooks, tools and its own .claude/settings.json
//   4. Claude Code's own settings (a default model when none is set, permission rules for the saved
//      sign-ins and .env files), the Nimbalyst extensions and the plugins
// What a script can't do (the settings inside Nimbalyst, voice typing) the first install names at the
// end for a chat; an update does not.
// A file that is replaced is kept next to the new one as <name>.before-install-<date>. The notes files
// the user fills in (profile.md, finds/INDEX.md) are written only when missing. Everything else is the
// user's once they changed it: a later run (an update) replaces a hook, a skill, the rules, a folder's
// CLAUDE.md or HOW-TO.md only while it is still exactly what an earlier run wrote. A file that was
// there before the first install under the same name is the user's too. Such a file stays, the run
// lists it at the end, and --replace or --replace-all takes the setup's version.
// A run that changed something saves what it printed in ~/.claude/setup-logs.
// What a run was told is kept in ~/.claude/setup-state.json, with the version from version.json, so
// that the updater (skills/update-setup/update.mjs) can run this again without asking anything.
//   node install.mjs            install
//   node install.mjs --dry-run  print what it would do and change nothing
//   --uninstall                 take the setup out again: its hook wiring leaves settings.json, its files
//                               go unless changed, a .before-install copy is put back; the project folders,
//                               plugins and extensions stay (the run says how to remove them); with --dry-run
//                               it only prints what it would do
//   --projects <folder>         where the project folders go (default: Projects in the home folder;
//                               the folder given once is remembered for later runs)
//   --codex yes|no              whether the Codex CLI is used (default: the answer given before, else
//                               yes when `codex` is on the PATH)
//   --agy yes|no                the same for the Antigravity CLI (`agy`)
//   --replace-rules             replace a ~/.claude/CLAUDE.md that has other content (a dated copy is kept)
//   --replace <file>            take the setup's version of one file the user changed, named as the run
//                               lists it (hooks/sql-guard.mjs); can be given several times
//   --replace-all               the same for every such file, and for the rules
//   --extensions yes|no         build the Nimbalyst extensions and put them into Nimbalyst (default: yes
//                               when Nimbalyst is installed; they change nothing until a theme is picked)
//   --plugins yes|no            install the plugins (default: yes; each is handled once, so one that was
//                               removed or switched later stays as it is)
//   --with <names>               add one or more add-ons left out of a default install: phone-bot,
//                               shared-usage, read-aloud, comma-separated; a copy already in place
//                               stays and keeps being updated by a plain run
//   --done chat-steps           only put on record that a chat carried out the steps named at the end
//                               (no longer needed: only the first install names them)
//   --language english|russian  the language Claude answers in and the extensions show (also en, ru,
//                               русский; kept for later runs, so an update keeps it; with russian,
//                               "language": "russian" goes into settings.json, and the extensions are built
//                               with SETUP_LANGUAGE=russian)
//   --keep-model                an older install (before 1.0.74) has "model": "sonnet" from the old installer; an
//                               update moves it to opus at medium effort. This keeps sonnet (and, after a
//                               move, puts sonnet back); the choice is kept for later runs
//   --home <folder>             install into <folder>/.claude instead of the home folder's
//   --node <file>               start the hooks with this Node by its full path instead of plain `node`
//                               (for a Mac, where an app opened from the Dock may not have Node on its
//                               PATH; remembered for later runs)
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { addClaudeCodeSettings } from "./scripts/claude-code-settings.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] || "" : null);
const DRY = args.includes("--dry-run");
const home = opt("home") !== null ? path.resolve(opt("home") || ".") : os.homedir();
const CLAUDE = path.join(home, ".claude");
const WIN = process.platform === "win32";
const fwd = (p) => p.replace(/\\/g, "/");
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const said = [];
const say = (s) => { said.push(s); console.log((DRY ? "[dry run] " : "") + s); };
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const read = (file) => fs.readFileSync(file, "utf8").replace(/\r\n/g, "\n");

// SETUP_NODE_VERSION: the tests pretend another Node
const NODE_VERSION = process.env.SETUP_NODE_VERSION || process.versions.node;
const [nodeMajor, nodeMinor] = NODE_VERSION.split(".").map(Number);
if (nodeMajor < 18) {
  console.log(`Node.js 18 or newer is needed; this is v${NODE_VERSION}.`);
  process.exit(1);
}
// node:sqlite (Node 22.5) is used only to read Nimbalyst's database; the hooks themselves run on 18
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
  say(`Node.js v${NODE_VERSION} is older than 22.5. Three things read Nimbalyst's database and need 22.5 or newer, so they stay off: notes between Nimbalyst sessions (skills/steer), compact-self and the Nimbalyst figures in the usage dashboard. Nothing else does. Install Node.js 22.5 or newer to turn them on.`);
}

// Every file under a repo folder, as paths from that folder
function filesIn(dir, base = dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]);
}
// Every file in these repo folders goes to the folder of the same name under ~/.claude.
const files = ["hooks", "agents", "skills", "workers"].flatMap((d) => filesIn(path.join(REPO, d)).map((f) => path.join(d, f)));

// Settings that can't be read stop the install before anything is copied.
function readSettings(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch {
    console.log(`${fwd(file)} is not valid JSON, so the install stopped here. Fix it and run this again.`);
    process.exit(1);
  }
}
const settingsFile = path.join(CLAUDE, "settings.json");
const settings = readSettings(settingsFile);

// The projects folder: the one given, else the one an earlier run kept, else Projects in the home folder
const stateFile = path.join(CLAUDE, "setup-state.json");
const state = readSettings(stateFile);
// The record (version, files, answers) is written last, so a run that stops part way leaves the old one
// and the next run does the whole job again. Anything thrown ends here with that said.
let stateSaved = false;
process.on("uncaughtException", (e) => {
  console.log(`\nThe install stopped part way: ${e.code ? `${e.code} ` : ""}${e.message}`);
  console.log(stateSaved
    ? `The install itself finished and is on record in ${fwd(stateFile)}; only the last step failed. Running it again is safe.`
    : `Nothing new was put on record: ${fwd(stateFile)} still says ${state.version ? `version ${state.version}` : "that no version was installed"}. Files copied before the stop are in place and fine. Fix what the line above names, then run the same command again: running it again is safe and finishes the job.`);
  process.exit(1);
});
// --done <name>: a step a chat carried out goes on record, so later runs stop naming it
if (opt("done")) {
  if (!fs.existsSync(stateFile)) { console.log(`${fwd(stateFile)} is missing: run the install first.`); process.exit(1); }
  fs.writeFileSync(stateFile, JSON.stringify({ ...state, done: [...new Set([...(state.done || []), opt("done")])] }, null, 2) + "\n");
  console.log(`on record as done: ${opt("done")}`);
  process.exit(0);
}
// The language: the one given, else the one kept from an earlier run ("" = not chosen)
const LANGUAGES = { english: "english", en: "english", russian: "russian", ru: "russian", "русский": "russian" };
let LANG = state.language || "";
if (opt("language") !== null) {
  LANG = LANGUAGES[opt("language").trim().toLowerCase()];
  if (!LANG) { console.log(`--language ${opt("language")}: not supported. The two languages are english and russian.`); process.exit(1); }
}
const nodeFile = opt("node") ? fwd(path.resolve(opt("node"))) : state.node || "";
const NODE = nodeFile ? `"${nodeFile}"` : "node";
const PROJECTS = opt("projects") ? path.resolve(opt("projects").replace(/^~(?=$|[\\/])/, home)) : state.projects || path.join(home, "Projects");
const HOMES = fs.readdirSync(path.join(REPO, "projects"), { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name !== "shared").map((e) => e.name);
const homeSettings = Object.fromEntries(HOMES.map((h) => [h, readSettings(path.join(PROJECTS, h, ".claude", "settings.json"))]));

// The outside workers are optional: without them the rules send gathering to Claude's cheaper models,
// the court sits with its Claude seats only and the picture skill (it needs Codex) is left out.
const onPath = (name) => (process.env.PATH || "").split(path.delimiter)
  .some((d) => d && ["", ".cmd", ".exe", ".ps1"].some((e) => fs.existsSync(path.join(d, name + e))));
// A yes or no given once is remembered, so a later run (an update) doesn't turn a worker back on
const answer = (name) => (opt(name) === "yes" ? true : opt(name) === "no" ? false : typeof state[name] === "boolean" ? state[name] : null);
const worker = (name) => answer(name) ?? onPath(name);
// Claude Code on Windows starts the hooks through Git Bash: without it every guard of this setup fails.
// Looked for as Claude Code does: the path set in CLAUDE_CODE_GIT_BASH_PATH (environment or the "env" of
// settings.json), then the usual Git for Windows folders, then a git.exe on the PATH.
const gitBashFound = () => {
  const env = process.env;
  const roots = [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432, env.LOCALAPPDATA && path.join(env.LOCALAPPDATA, "Programs")];
  const gits = (env.PATH || "").split(path.delimiter).filter((d) => d && fs.existsSync(path.join(d, "git.exe")));
  return [env.CLAUDE_CODE_GIT_BASH_PATH, settings.env?.CLAUDE_CODE_GIT_BASH_PATH,
    ...roots.filter(Boolean).map((r) => path.join(r, "Git", "bin", "bash.exe")),
    ...gits.flatMap((d) => [path.join(d, "..", "bin", "bash.exe"), path.join(d, "..", "..", "bin", "bash.exe")])]
    .filter(Boolean).some((p) => fs.existsSync(p));
};
const GIT_BASH_MISSING = `Git Bash was not found on this computer. Claude Code on Windows starts the hooks through it, so without it every guard of this setup fails. Install Git for Windows (https://git-scm.com/download/win), or, when it is installed in an unusual place, set CLAUDE_CODE_GIT_BASH_PATH to the full path of its bash.exe in the "env" part of ${fwd(settingsFile)}. The install goes on; run it again after that.`;
const WORKERS = path.join(CLAUDE, "workers");
const have = { codex: worker("codex"), agy: worker("agy") };
const which = have.codex && have.agy ? "Codex and Antigravity" : have.codex ? "Codex only" : have.agy ? "Antigravity only" : "Claude alone";

// A dated copy of a file as it is now, made before it is changed. A copy already made today stays as
// it is (it is the older one); a second change on the same day gets -2, -3, ...
// user: the file being copied is the user's own (not one the setup wrote earlier). Such a copy goes on
// record in state.userCopies, and only those are put back by --uninstall: every update also copies the
// setup's own older files, and those must not come back.
const userCopies = new Set(state.userCopies || []);
function keepCopy(file, user = false) {
  const base = `${file}.before-install-${today}`;
  let copy = base;
  for (let n = 2; fs.existsSync(copy); n++) {
    if (fs.readFileSync(copy).equals(fs.readFileSync(file))) { if (user) userCopies.add(fwd(copy)); return path.basename(copy); }
    copy = `${base}-${n}`;
  }
  if (!DRY) fs.copyFileSync(file, copy);
  if (user) userCopies.add(fwd(copy));
  return path.basename(copy);
}
// state.files: each of the setup's own files as a run last wrote it, by full path. One that no longer
// matches was changed by the user, or was theirs before the first install, and stays unless asked for.
// A setup put in place before files were on record has none: there a file is replaced as it used to be.
const onRecord = !state.version || "files" in state;
const filesWritten = { ...(state.files || {}) };
const replaceAll = args.includes("--replace-all");
const replaceThese = args.flatMap((a, i) => (a === "--replace" && args[i + 1] ? [fwd(args[i + 1]).replace(/^~\/\.claude\//, "")] : []));
const asked = (to) => replaceAll || replaceThese.some((r) => fwd(to) === r || fwd(to).endsWith("/" + r));
// A file as the lists at the end name it: from ~/.claude where it is inside, else by its full path
const short = (to) => (fwd(to).startsWith(fwd(CLAUDE) + "/") ? fwd(to).slice(fwd(CLAUDE).length + 1) : fwd(to));
const tally = { added: 0, same: 0, replaced: [], yours: [] };
// A command that runs this installer again with some flags, on the same home folder
const selfRun = (flags) => `node "${fwd(path.join(REPO, "install.mjs"))}" ${flags}${opt("home") !== null ? ` --home "${fwd(home)}"` : ""}`;
// Writes a file and says what happened. keep: a file that is already there is the user's and stays.
// own: one of the setup's files, which stays only when the user changed it.
function put(to, data, { keep = false, own = false } = {}) {
  const there = fs.existsSync(to);
  if (there && keep) return say(`kept ${fwd(to)} (already there)`);
  const now = there ? fs.readFileSync(to) : null;
  if (there && now.equals(data)) {
    if (own) filesWritten[fwd(to)] = sha(data);
    tally.same++;
    return say(`unchanged ${fwd(to)}`);
  }
  if (there && own && onRecord && filesWritten[fwd(to)] !== sha(now) && !asked(to)) {
    tally.yours.push(short(to));
    return say(`kept yours ${fwd(to)} (it differs from the setup's version)`);
  }
  // The user's own unless it is exactly what the setup last wrote there (or it can't be told: no record)
  const backup = there ? keepCopy(to, onRecord && !(own && filesWritten[fwd(to)] === sha(now))) : null;
  if (!DRY) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, data);
  }
  if (own) filesWritten[fwd(to)] = sha(data);
  if (backup) tally.replaced.push(short(to)); else tally.added++;
  say(`${backup ? "replaced" : "copied"} ${fwd(to)}${backup ? ` (old copy: ${backup})` : ""}`);
}
function putJson(file, data, was) {
  if (JSON.stringify(data) === was && fs.existsSync(file)) return say(`unchanged ${fwd(file)}`);
  const backup = fs.existsSync(file) ? keepCopy(file) : null;
  if (!DRY) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // written whole under another name, then moved: a stop in the middle can't leave half a file
    fs.writeFileSync(`${file}.part`, JSON.stringify(data, null, 2) + "\n");
    fs.renameSync(`${file}.part`, file);
  }
  say(`wrote ${fwd(file)}${backup ? ` (old copy: ${backup})` : ""}`);
}
// The rules and the project folders name the projects folder as <projects>; the text gets the real
// one. Off Windows the folder separator and Codex's Windows-only sandbox flag go.
function fit(rel, data) {
  if (!/\.(md|txt)$/.test(rel)) return data;
  let text = data.toString("utf8");
  if (!WIN) text = text.replaceAll("<projects>\\", "<projects>/").replaceAll(` -c 'windows.sandbox="unelevated"'`, "").replaceAll(" On Windows, without the unelevated sandbox it can't read files.", "");
  return Buffer.from(text.replaceAll("<projects>", PROJECTS));
}
const repoText = (rel) => fit(rel, fs.readFileSync(path.join(REPO, rel))).toString("utf8").replace(/\r\n/g, "\n");

const RETIRED = ["build-nudge.mjs", "turn-cap.mjs"];
// The folder each extension (named as in the repo) has in Nimbalyst's extensions folder
const EXT_FOLDER = { "ink-themes": "inktheme", "agents-panel": "agentspanel", "usage-plan": "usageplan", commands: "commandbuttons", "read-aloud": "readaloud" };
// Add-ons: left out of a default install. --with name[,name,...] adds any of them; a copy already in
// the target stays and keeps being updated by a plain run; --uninstall treats them like any other skill or extension.
const ADDONS = { "phone-bot": "skill", "shared-usage": "skill", "read-aloud": "extension" };
const withNames = (opt("with") || "").split(",").map((s) => s.trim()).filter(Boolean);
if (args.includes("--with") && !withNames.length) { console.log(`--with needs a name. The add-ons are: ${Object.keys(ADDONS).join(", ")}.`); process.exit(1); }
const badWith = withNames.filter((n) => !(n in ADDONS));
if (badWith.length) { console.log(`--with ${badWith.join(",")}: not an add-on. The add-ons are: ${Object.keys(ADDONS).join(", ")}.`); process.exit(1); }
// A file under an add-on skill is left out unless it was asked for with --with, or a copy is already there
const addonSkip = (rel) => Object.entries(ADDONS).some(([name, kind]) => kind === "skill" && fwd(rel).startsWith(fwd(path.join("skills", name)) + "/")
  && !withNames.includes(name) && !fs.existsSync(path.join(CLAUDE, "skills", name, "SKILL.md")));
// The allow-rules the setup adds to Antigravity's settings; state.agyAdded records which ones it really added
const AGY_RULES = [`read_file(${fwd(PROJECTS)})`, ...["hooks", "skills", "agents"].map((d) => `read_file(${fwd(CLAUDE)}/${d})`)];
// Earlier versions added these. An update takes them out: what it reads can carry a planted line, ~/.claude holds the
// Claude login, and read_url could send it anywhere
const AGY_RETIRED = ["read_url(*)", `read_file(${fwd(CLAUDE)})`];
// Antigravity's settings can't refuse web search or a file by pattern, so its hooks file gets a PreToolUse hook
// (workers/agy-gate.mjs): in the worker command's runs it refuses web search and subagents, and .env files unless
// the task names .env. The command has no quotes: Antigravity passes them on to node, which then can't find the file.
const AGY_HOOK = "ask-worker-gate";
const agyHooksFile = path.join(home, ".gemini", "config", "hooks.json");
const agyGateFile = `${fwd(CLAUDE)}/workers/agy-gate.mjs`;
let agyAdded = [...(state.agyAdded || [])];

// ---- --uninstall: takes the setup out again and ends the run
if (args.includes("--uninstall")) {
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
  const owned = new Set([...Object.keys(recorded), ...files.map((f) => fwd(path.join(CLAUDE, f)))].map((f) => f.toLowerCase()));
  const scriptsOf = (h) => [...String(h.command || "").matchAll(/"([^"]+\.(?:mjs|cjs|js|sh|py|ps1))"|(\S+\.(?:mjs|cjs|js|sh|py|ps1))(?=\s|$)/g)]
    .map((m) => fwd((m[1] || m[2]).replace(/^~(?=[\\/])/, home)).toLowerCase());
  const setups = (h) => scriptsOf(h).some((s) => owned.has(s) || RETIRED.some((n) => s === `${root}hooks/${n}`));
  const unwire = (target, where = "") => {
    const before = JSON.stringify(target);
    for (const [event, groups] of Object.entries(target.hooks || {})) {
      if (!Array.isArray(groups)) continue;
      let gone = 0;
      target.hooks[event] = groups.filter((g) => {
        const n = (g.hooks || []).length;
        for (const h of (g.hooks || []).filter(setups)) say(`hook unwired: ${event} ${path.basename(scriptsOf(h)[0] || "")}${where}`);
        g.hooks = (g.hooks || []).filter((h) => !setups(h));
        gone += n - g.hooks.length;
        return !n || g.hooks.length;
      });
      if (gone && !target.hooks[event].length) delete target.hooks[event];
    }
    if (target.hooks && !Object.keys(target.hooks).length && JSON.stringify(target) !== before) delete target.hooks;
  };
  const settingsBefore = JSON.stringify(settings);
  unwire(settings);
  if (JSON.stringify(settings) !== settingsBefore) putJson(settingsFile, settings, settingsBefore);
  // 1b. the project folders keep their files, but their settings lose the entries that start a script in
  // ~/.claude (those scripts go below), and the picture skill's link into ~/.claude goes
  const pictureHomes = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "homes.json"), "utf8")).picture.homes;
  for (const name of HOMES) {
    const s = homeSettings[name];
    const was = JSON.stringify(s);
    unwire(s, ` in ${name}`);
    if (JSON.stringify(s) !== was) putJson(path.join(PROJECTS, name, ".claude", "settings.json"), s, was);
    const link = path.join(PROJECTS, name, ".claude", "skills", "picture");
    if (pictureHomes.includes(name) && fs.lstatSync(link, { throwIfNoEntry: false })?.isSymbolicLink()) {
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
  for (const f of files.map((rel) => path.join(CLAUDE, rel))) {
    if (!(fwd(f) in recorded) && fs.existsSync(f)) kept.push(`${short(f)} (no record that the setup wrote it)`);
  }
  const rules = path.join(CLAUDE, "CLAUDE.md");
  if (fs.existsSync(rules)) {
    if (state.rules && sha(read(rules)) === state.rules) drop(rules); else kept.push(`CLAUDE.md (the rules; they differ from what the setup wrote)`);
  }
  for (const name of ["codex", "agy"]) {
    const off = path.join(WORKERS, `${name}.off`);
    if (fs.existsSync(off) && fs.readFileSync(off, "utf8").startsWith("Not used on this computer.")) drop(off);
  }
  if (!DRY) for (const file of removed) {
    for (let d = path.dirname(file); fwd(d).toLowerCase().startsWith(root); d = path.dirname(d)) {
      if (!fs.existsSync(d)) continue; // already taken out with an earlier file
      if (fs.readdirSync(d).length) break;
      fs.rmdirSync(d);
    }
  }
  // 3. the .before-install copies: the oldest one that is on record as the user's goes back to its name when
  // nothing of the user's is there. A copy of a setup file an update replaced is the setup's older version, not theirs.
  const BACKUP = /^(.*)\.before-install-(\d{8})(?:-(\d+))?$/;
  const userCopy = new Set((state.userCopies || []).map((c) => fwd(c).toLowerCase()));
  const isUsers = (copy) => userCopy.has(fwd(copy).toLowerCase());
  const copies = [
    ...fs.readdirSync(CLAUDE).filter((n) => n.startsWith("CLAUDE.md.before-install-")).map((n) => path.join(CLAUDE, n)),
    ...["hooks", "agents", "skills", "workers", "shared-skills"].flatMap((d) => filesIn(path.join(CLAUDE, d)).map((f) => path.join(CLAUDE, d, f))),
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
  // 4. Antigravity's allow-rules: the ones the install recorded as added go; without a record they are only named
  const agyFile = path.join(home, ".gemini", "antigravity-cli", "settings.json");
  if (fs.existsSync(agyFile)) {
    const agy = readSettings(agyFile);
    const allow = agy.permissions?.allow || [];
    const added = (state.agyAdded || []).filter((r) => allow.includes(r));
    if (added.length) {
      agy.permissions.allow = allow.filter((r) => !added.includes(r));
      putJson(agyFile, agy, null);
      say(`removed the allow rules the setup added from ${fwd(agyFile)}: ${added.join(", ")}`);
    } else if (!state.agyAdded && [...AGY_RULES, ...AGY_RETIRED].some((r) => allow.includes(r))) {
      kept.push(`${fwd(agyFile)}: allow rules (${[...AGY_RULES, ...AGY_RETIRED].filter((r) => allow.includes(r)).join(", ")}) that the setup may have added; remove them by hand if they are not yours`);
    }
  }
  // 5. Antigravity's hook for the worker command
  if (fs.existsSync(agyHooksFile)) {
    const hooks = readSettings(agyHooksFile);
    if (AGY_HOOK in hooks) {
      delete hooks[AGY_HOOK];
      if (DRY) say(`would remove the hook ${AGY_HOOK} from ${fwd(agyHooksFile)}`);
      else if (Object.keys(hooks).length) putJson(agyHooksFile, hooks, null);
      else { fs.rmSync(agyHooksFile); say(`removed ${fwd(agyHooksFile)} (it held only the setup's hook)`); }
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
  process.exit(0);
}

// ---- 1. the files for ~/.claude
const noGitBash = WIN && !gitBashFound();
if (noGitBash) say(GIT_BASH_MISSING);
for (const rel of files) {
  if (addonSkip(rel)) continue;
  let data = fs.readFileSync(path.join(REPO, rel));
  // a shell script needs Unix line ends and has to be runnable; off Windows Codex's Windows-only sandbox flag goes
  const script = rel.endsWith(".sh") || rel === path.join("workers", "ask.mjs"); // started by its own name
  if (script) data = Buffer.from(data.toString("utf8").replace(/\r\n/g, "\n").replace(WIN ? "" : ` -c 'windows.sandbox="unelevated"'`, ""));
  put(path.join(CLAUDE, rel), data, { own: true });
  if (script && !DRY) fs.chmodSync(path.join(CLAUDE, rel), 0o755);
}
// The worker command (workers/ask.mjs) leaves out a worker that has a file <name>.off next to it
for (const name of ["codex", "agy"]) {
  const off = path.join(WORKERS, `${name}.off`);
  if (!have[name]) put(off, Buffer.from(`Not used on this computer. Run install.mjs with --${name} yes to use this worker.\n`), { keep: true });
  else if (fs.existsSync(off)) { if (!DRY) fs.rmSync(off); say(`removed ${fwd(off)}`); }
}
// Antigravity run headless can't ask for a permission, so a tool that needs one ends the run with no
// answer: read_file for a file outside the folder it starts in. These allow-rules let it read the projects
// folder and the setup's own hooks, skills and agents; its own rules stay as they are.
if (have.agy) {
  const agyFile = path.join(home, ".gemini", "antigravity-cli", "settings.json");
  const agySettings = readSettings(agyFile);
  const was = JSON.stringify(agySettings);
  const had = agySettings.permissions?.allow || [];
  const allow = had.filter((r) => !AGY_RETIRED.includes(r));
  if (allow.length !== had.length) say(`removed from ${fwd(agyFile)}: ${had.filter((r) => AGY_RETIRED.includes(r)).join(", ")} (they let a file it reads send your login out)`);
  const want = AGY_RULES.filter((r) => !allow.includes(r));
  agyAdded = [...new Set([...agyAdded.filter((r) => !AGY_RETIRED.includes(r)), ...want])]; // on record, so --uninstall takes out only these
  agySettings.permissions = { ...agySettings.permissions, allow: [...allow, ...want] };
  putJson(agyFile, agySettings, want.length || allow.length !== had.length ? null : was);
  if (/\s/.test(agyGateFile)) say(`NOT registered: ${agyGateFile} has a space in it, which Antigravity's hooks can't run. The worker command will not start Antigravity until the setup is in a folder without spaces.`);
  else {
    const hooks = readSettings(agyHooksFile);
    const wasHooks = JSON.stringify(hooks);
    hooks[AGY_HOOK] = { PreToolUse: [{ matcher: "*", hooks: [{ type: "command", command: `node ${agyGateFile}`, timeout: 10 }] }] };
    putJson(agyHooksFile, hooks, wasHooks);
  }
}
// projects/shared holds what the picture skill needs in ~/.claude: the skill itself and its gate
const shared = path.join(REPO, "projects", "shared");
if (have.codex) for (const rel of filesIn(shared)) put(path.join(CLAUDE, rel), fit(rel, fs.readFileSync(path.join(shared, rel))), { own: true });
// Skills the setup retired (each is now /setup-audit <part>): the files an earlier run wrote there go, one
// line for each skill. A file the user changed stays and is named, as below. These run before the loop
// below, which would otherwise say it once for every file.
const RETIRED_SKILLS = [
  [path.join(CLAUDE, "skills", "usage-report"), "/setup-audit usage"],
  [path.join(CLAUDE, "skills", "project-scan"), "/setup-audit scan"],
  [path.join(PROJECTS, "claude-settings", ".claude", "skills", "chat-review"), "/setup-audit chat"],
  [path.join(PROJECTS, "claude-settings", ".claude", "skills", "full-review"), "/setup-audit full"],
];
for (const [dir, now] of RETIRED_SKILLS) {
  if (!fs.existsSync(dir)) continue;
  let gone = 0;
  const unknown = [];
  for (const f of filesIn(dir).map((rel) => path.join(dir, rel))) {
    const hash = filesWritten[fwd(f)];
    if (hash === undefined) { unknown.push(f); continue; }
    delete filesWritten[fwd(f)];
    if (sha(fs.readFileSync(f)) !== hash) { say(`kept yours ${fwd(f)} (a retired skill, and changed since it was installed; delete it by hand when not needed)`); continue; }
    if (!DRY) fs.rmSync(f);
    gone++;
  }
  if (gone) say(`removed the retired skill ${short(dir)} (${gone} file${gone === 1 ? "" : "s"}; it is now ${now})`);
  if (unknown.length) say(`kept yours ${fwd(dir)} (a retired skill, now ${now}; there is no record that the setup wrote ${unknown.length === 1 ? "its file" : "these files"}, so ${unknown.length === 1 ? "it stays" : "they stay"}; delete the folder by hand when not needed)`);
  if (!DRY) { // folders left empty go, deepest first
    const prune = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory()) prune(path.join(d, e.name));
      if (!fs.readdirSync(d).length) fs.rmdirSync(d);
    };
    prune(dir);
  }
}
// A file an earlier version put here and this one no longer ships goes, unless it was changed since
const shipped = new Set([...files, ...filesIn(shared)].map((rel) => fwd(path.join(CLAUDE, rel))));
const ownFolders = ["hooks", "agents", "skills", "workers"].map((d) => `${fwd(path.join(CLAUDE, d))}/`);
for (const [to, hash] of Object.entries(filesWritten)) {
  if (shipped.has(to) || !ownFolders.some((d) => to.startsWith(d))) continue;
  const now = fs.existsSync(to) ? fs.readFileSync(to) : null;
  delete filesWritten[to];
  if (now && sha(now) !== hash) { say(`kept yours ${to} (no longer part of the setup, and changed since it was installed)`); continue; }
  if (now && !DRY) {
    fs.rmSync(to);
    if (!fs.readdirSync(path.dirname(to)).length) fs.rmdirSync(path.dirname(to));
  }
  if (now) say(`removed ${to} (no longer part of the setup)`);
}
// The add-ons left out of this run are named, so the commands the docs list can be found
for (const name of Object.keys(ADDONS).filter((n) => ADDONS[n] === "skill" && addonSkip(path.join("skills", n, "SKILL.md")))) say(`add-on left out: ${name} (add it with --with ${name})`);

// The hook wiring: each hook from an example is added unless that event already runs the same script.
// The command points at the installed copy by its full path, so it works from any folder and shell.
// A script named as ~/.claude/... is the one in ~/.claude, any other path is inside the project folder.
// A hook whose example matcher changed: an install that still has exactly the old one gets the new one.
// A matcher the user changed themselves is not in this list and is left alone.
const OLD_MATCHERS = { "question-other.mjs": ["mcp__nimbalyst__PromptForUserInput", "mcp__nimbalyst__PromptForUserInput|mcp__nimbalyst__AskUserQuestion"] };
// Hooks the setup retired (their files are gone): an install that has one wired from ~/.claude loses
// that entry on the next run. The same script from another folder is the user's own and stays.
// (RETIRED itself is defined above the uninstall block, which needs it too.)
function retire(target) {
  const root = fwd(CLAUDE).toLowerCase();
  const retired = (h) => {
    const cmd = fwd(String(h.command || "")).replace(/(^|[\s"'])~\//g, `$1${fwd(home)}/`).toLowerCase();
    return RETIRED.some((name) => cmd.includes(`${root}/hooks/${name}`));
  };
  let removed = 0;
  for (const [event, groups] of Object.entries(target.hooks || {})) {
    if (!Array.isArray(groups)) continue;
    target.hooks[event] = groups.filter((group) => {
      const before = (group.hooks || []).length;
      if (!before) return true;
      group.hooks = group.hooks.filter((h) => !retired(h));
      removed += before - group.hooks.length;
      if (group.hooks.length) return true;
      say(`hook removed: ${event} ${group.matcher || ""} (switched off in this version)`.replace("  ", " "));
      return false;
    });
  }
  return removed;
}
// A command's arguments after the script (null when it does not start that script): "--start" in
// `node "<claude>/hooks/code-review-gate.mjs" --start`
const nameIn = (base) => base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const argsOf = (command, base) => String(command || "").match(new RegExp(`(?:^|[\\\\/"' ])${nameIn(base)}["']?(?=\\s|$)(.*)$`))?.[1].replace(/\s*\d?>>?\s*\S+/g, "").trim().replace(/\s+/g, " ") ?? null; // a redirect is no argument
// Where a command starts the script from, as a path with / ('~' written out), or null
const scriptOf = (command, base) => {
  const m = String(command || "").match(new RegExp(`"([^"]*[\\\\/]${nameIn(base)})"|(\\S*[\\\\/]${nameIn(base)})`));
  return m && fwd(m[1] || m[2]).replace(/^~(?=\/)/, fwd(home));
};
const insideClaude = (p) => !!p && p.toLowerCase().startsWith(fwd(CLAUDE).toLowerCase() + "/");
function wire(target, hooks, folder, where = "") {
  let added = 0;
  for (const [event, groups] of Object.entries(hooks || {})) {
    for (const group of groups) {
      for (const hook of group.hooks) {
        const global = hook.command.match(/~\/\.claude\/(\S+)(.*)$/);
        const [, script, extra] = global || hook.command.match(/^node (\S+)(.*)$/);
        const list = ((target.hooks ??= {})[event] ??= []);
        const base = path.basename(script);
        const at = fwd(path.join(global ? CLAUDE : folder, script));
        const command = `${NODE} "${at}"${extra}`;
        const wanted = extra.trim().replace(/\s+/g, " ");
        // One script can be wired several times with different arguments (code-review-gate.mjs plain,
        // --start, --pre) and, with an `if`, once for each tool: an entry counts as this one only when
        // the arguments are the same, and the `if` too where the example has one.
        const same = (h) => argsOf(h.command, base) === wanted && (!hook.if || h.if === hook.if);
        // An older wiring of this hook ran for every command; the `if` handlers replace it, not join it.
        // Only the one started from ~/.claude is the setup's; a script from elsewhere is the user's own.
        if (hook.if && global) {
          for (const g of [...list]) {
            const before = (g.hooks || []).length;
            g.hooks = (g.hooks || []).filter((h) => !(!h.if && argsOf(h.command, base) === wanted && insideClaude(scriptOf(h.command, base))));
            if (g.hooks.length === before) continue;
            if (!g.hooks.length) list.splice(list.indexOf(g), 1);
            say(`hook replaced: ${event} ${base}${where} (it ran for every command; now only where the command needs it)`);
            added++;
          }
        }
        if (list.some((g) => (g.hooks || []).some(same))) {
          // An older copy of this setup may have wired the same script from another place in ~/.claude:
          // that wiring is pointed at the installed copy. A script outside ~/.claude is the user's own.
          for (const old of global ? list.flatMap((g) => g.hooks || []).filter(same) : []) {
            const was = scriptOf(old.command, base);
            if (!was || was.toLowerCase() === at.toLowerCase() || !insideClaude(was)) continue;
            old.command = command;
            say(`hook repointed: ${event} ${base}${where} (it started ${was})`);
            added++;
          }
          for (const g of list) {
            if (!group.matcher || !(OLD_MATCHERS[base] || []).includes(g.matcher)) continue;
            if (!(g.hooks || []).some((h) => String(h.command || "").includes(base))) continue;
            say(`hook matcher updated: ${event} ${base}${where} (${g.matcher} -> ${group.matcher})`);
            g.matcher = group.matcher;
            added++;
          }
          continue;
        }
        // Everything else the example sets comes along: without asyncRewake a watcher would hold the session up.
        const entry = { ...hook, command };
        list.push(group.matcher ? { matcher: group.matcher, hooks: [entry] } : { hooks: [entry] });
        say(`hook added: ${event}${group.matcher ? ` (${group.matcher})` : ""} ${path.basename(script)}${where}`);
        added++;
      }
    }
  }
  return added;
}
const example = JSON.parse(fs.readFileSync(path.join(REPO, "settings.example.json"), "utf8"));
const settingsWas = JSON.stringify(settings);
const retiredHooks = retire(settings);
const wired = wire(settings, example.hooks, CLAUDE) + retiredHooks;
if (!wired) say(`hooks already wired in ${fwd(settingsFile)}`);
// Before 1.0.74 the installer set "model": "sonnet", and an update keeps the settings a person has, so
// that stayed for good. Such a setup (sonnet, no model settings, a version on record that is older) moves to
// opus at medium effort, said loudly. state.model records the choice for later runs: "moved", or "kept"
// (--keep-model). --keep-model after a move puts sonnet back; it is the undo.
const olderThan = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) < (y[i] || 0);
  return false;
};
const KEEP_MODEL = args.includes("--keep-model");
let modelMark = state.model;
let modelChanged = false;
if (KEEP_MODEL && state.model === "moved") {
  if (settings.model === "opus") {
    settings.model = "sonnet";
    for (const name of ["claude-opus-5", "claude-opus-5-5"]) {
      const s = settings.modelSettings?.[name];
      if (s && JSON.stringify(s) === JSON.stringify({ effortLevel: "medium" })) delete settings.modelSettings[name];
    }
    if (settings.modelSettings && !Object.keys(settings.modelSettings).length) delete settings.modelSettings;
    modelChanged = true;
    say(`model: sonnet is back in ${fwd(settingsFile)}, and stays on later runs (--keep-model)`);
  } else say(`model: --keep-model has nothing to undo, "model" in ${fwd(settingsFile)} is ${JSON.stringify(settings.model)} and stays as it is`);
  modelMark = "kept";
} else if (KEEP_MODEL) {
  modelMark = "kept";
  if (settings.model === "sonnet") say(`model: sonnet stays in ${fwd(settingsFile)} (--keep-model); later runs keep it too`);
  else say(`model: --keep-model found no move on record, so "model" in ${fwd(settingsFile)} stays ${JSON.stringify(settings.model)}. Set it there to change it.`);
} else if (!state.model && state.version && olderThan(state.version, "1.0.75") && settings.model === "sonnet" && !settings.modelSettings) {
  delete settings.model; // addClaudeCodeSettings below sets opus at medium effort
  modelMark = "moved";
  modelChanged = true;
  say(`MODEL CHANGED: ${fwd(settingsFile)} had "model": "sonnet", which the installer before 1.0.74 set for you, so it is now opus at medium effort.`);
  say(`  To undo: ${selfRun("--keep-model")}`);
  say(`  (in a chat: /update-setup --keep-model). That puts sonnet back and keeps it on every later run.`);
}
// Claude Code's own settings go into the same file: what is set there already stays
const own = addClaudeCodeSettings(settings, WIN);
if (own.model && !modelChanged) say(`model: set to opus at medium effort in ${fwd(settingsFile)} (none was set)`);
if (own.compact) say(`compact: long chats compact themselves at about 200k, set in ${fwd(settingsFile)}`);
if (own.cache) say(`cache: helpers keep their prompt cache for an hour, set in ${fwd(settingsFile)}`);
if (own.logs) say(`logs: transcripts are kept 120 days, set in ${fwd(settingsFile)}`);
if (own.added) say(`permissions: ${own.added} rule(s) added (the saved sign-ins and SSH keys can't be read, a .env file is asked about)`);
// Claude Code's own reply-language setting follows the language. english removes only the "russian"
// this setup wrote: a language the person set to something else stays.
let langChanged = false;
if (LANG === "russian" && settings.language !== "russian") { settings.language = "russian"; langChanged = true; say(`language: russian set in ${fwd(settingsFile)}`); }
else if (LANG === "english" && state.language === "russian" && settings.language === "russian") { delete settings.language; langChanged = true; say(`language: russian removed from ${fwd(settingsFile)}`); }
if (wired || own.model || modelChanged || own.compact || own.cache || own.logs || own.added || langChanged) putJson(settingsFile, settings, settingsWas);

// ---- 2. the global rules, with the worker section that fits
// Every heading the worker section has ever carried: an older rules file on disk still has an old one.
const HEAD = /^## (External workers first for gathering information|Gathering information on Claude alone|The free workers? reads? local files, not the web)$/;
// Puts the worker section in place of the one the text has (from its heading to the next "# " heading)
function withWorkers(text, section) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => HEAD.test(l));
  if (i === -1) return null;
  let j = i + 1;
  while (j < lines.length && !/^# /.test(lines[j])) j++;
  lines.splice(i, j - i, ...section.replace(/\n+$/, "").split("\n"), "");
  return lines.join("\n");
}
const full = repoText("rules/CLAUDE.md");
// One section fits every mix of workers: its command (ask.mjs) picks the worker. With none, the section for Claude alone
const section = have.codex || have.agy ? null : repoText("rules/workers-none.md");
const built = section ? withWorkers(full, section) : full;
// A renamed heading in rules/CLAUDE.md used to end here as "writeFileSync received null": say so instead.
if (built === null) throw new Error(`rules/CLAUDE.md has no worker section heading matching ${HEAD} - add the new heading to HEAD in install.mjs`);
const rulesFile = path.join(CLAUDE, "CLAUDE.md");
const mine =fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf8").replace(/\r\n/g, "\n") : null;
// Only the worker section of an existing rules file is the installer's to change
const ownSection = section || full.split("\n").slice(full.split("\n").findIndex((l) => HEAD.test(l))).join("\n").split(/\n(?=# )/)[0];
const swapped = mine === null ? null : withWorkers(mine, ownSection);
const writeRules = (text) => { if (!DRY) { fs.mkdirSync(CLAUDE, { recursive: true }); fs.writeFileSync(rulesFile, text); } };
// state.rules: the rules as a run last wrote them. A file that still matches was not changed by the
// user, so a newer version replaces it. state.rulesOffered: the newer rules the user was last told about.
const marks = { rules: state.rules, rulesOffered: state.rulesOffered };
if (mine === null) { writeRules(built); say(`rules: wrote ${fwd(rulesFile)} (workers: ${which})`); }
else if (mine === built) say(`rules: unchanged ${fwd(rulesFile)} (workers: ${which})`);
else if (args.includes("--replace-rules") || replaceAll || state.rules === sha(mine)) {
  const backup = keepCopy(rulesFile, onRecord && state.rules !== sha(mine));
  writeRules(built);
  say(`rules: replaced ${fwd(rulesFile)} (workers: ${which}; old copy: ${backup})`);
} else {
  if (mine === swapped) say(`rules: unchanged ${fwd(rulesFile)} (workers: ${which})`);
  else if (swapped !== null) {
    const backup = keepCopy(rulesFile, onRecord);
    writeRules(swapped);
    say(`rules: wrote the worker section of ${fwd(rulesFile)} (${which}); the rest is left as it was (old copy: ${backup})`);
  } else {
    say(`rules: left alone, ${fwd(rulesFile)} has other content. Run again with --replace-rules to take these rules (a dated copy is kept), or merge rules/CLAUDE.md by hand.`);
  }
  // The user's own rules stay; said once for each version of the rules they don't have
  if (state.rulesOffered !== sha(built)) say(`rules: new in this version, yours were kept. Run again with --replace-rules to take them (a dated copy is kept).`);
  marks.rulesOffered = sha(built);
  marks.kept = true;
}
if (!marks.kept) marks.rules = sha(built);
const rulesKept = !!marks.kept; // the user's own rules were not replaced: named again in the closing list
delete marks.kept;

// ---- 3. the project folders
const homes = JSON.parse(fs.readFileSync(path.join(REPO, "projects", "homes.json"), "utf8"));
// The notes files as a run last wrote them, by full path. One that still matches is not the user's yet.
const written = { ...(state.written || {}) };
const asWritten = (file) => fs.existsSync(file) && written[fwd(file)] === sha(read(file));
const NOTE = "## Workers on this computer";
// The lines about a missing worker, as the last section of a folder's CLAUDE.md; none when nothing is missing
function withNote(text, wanted) {
  const lines = text.split("\n");
  const i = lines.indexOf(NOTE);
  if (i === -1 && !wanted.length) return text;
  if (i !== -1) { let j = i + 1; while (j < lines.length && !/^#{1,2} /.test(lines[j])) j++; lines.splice(i, j - i); }
  while (lines.length && lines.at(-1) === "") lines.pop();
  if (wanted.length) lines.push("", NOTE, "", ...wanted);
  return lines.join("\n") + "\n";
}
for (const name of HOMES) {
  const from = path.join(REPO, "projects", name);
  const dir = path.join(PROJECTS, name);
  const example = path.join(".claude", "settings.json");
  for (const rel of filesIn(from)) {
    if (rel === example || rel === "CLAUDE.md") continue;
    // Skills, hooks and tools are the setup's; anything else in the folder is the user's once it is there
    const own = rel.startsWith(".claude" + path.sep) || rel.startsWith("tools" + path.sep);
    put(path.join(dir, rel), fit(rel, fs.readFileSync(path.join(from, rel))), { keep: !own, own });
  }
  if (name === "claude-settings") {
    const howTo = path.join(dir, "HOW-TO.md");
    const text = fit("HOW-TO.md", fs.readFileSync(path.join(REPO, "docs", "HOW-TO.md"))).toString("utf8").replace(/\r\n/g, "\n");
    const ours = asWritten(howTo);
    put(howTo, Buffer.from(text), { keep: !ours });
    if (ours || !fs.existsSync(howTo) || read(howTo) === text) written[fwd(howTo)] = sha(text);
  }

  // CLAUDE.md: written when missing and replaced while it is as an earlier run wrote it; in one the
  // user changed only the note about missing workers changes
  const notes = path.join(dir, "CLAUDE.md");
  const wanted = (homes.notes[name] || []).filter((n) => n.without.every((w) => !have[w])).map((n) => n.line);
  const fresh = withNote(repoText(path.join("projects", name, "CLAUDE.md")), wanted);
  if (!fs.existsSync(notes) || asWritten(notes) || read(notes) === fresh) {
    put(notes, Buffer.from(fresh));
    written[fwd(notes)] = sha(fresh);
  } else {
    const now = fs.readFileSync(notes, "utf8").replace(/\r\n/g, "\n");
    const next = withNote(now, wanted);
    if (next === now) say(`kept ${fwd(notes)} (already there)`);
    else put(notes, Buffer.from(next));
  }

  // The folder's own settings: its model, its hooks and, with Codex, the picture skill and its gate
  const file = path.join(dir, example);
  const s = homeSettings[name];
  const was = JSON.stringify(s);
  const wants = JSON.parse(fs.readFileSync(path.join(from, example), "utf8"));
  s.model ??= wants.model;
  wire(s, wants.hooks, dir, ` in ${name}`);
  if (homes.picture.homes.includes(name)) {
    const link = path.join(dir, ".claude", "skills", "picture");
    const linked = fs.existsSync(link);
    if (have.codex) {
      wire(s, homes.picture.hooks, dir, ` in ${name}`);
      if (!linked) {
        if (!DRY) {
          fs.mkdirSync(path.dirname(link), { recursive: true });
          fs.symlinkSync(path.join(CLAUDE, "shared-skills", "picture"), link, "junction");
        }
        say(`linked ${fwd(link)} to the picture skill in ${fwd(CLAUDE)}`);
      }
    } else {
      // Codex is gone after an earlier run with it: the link (never a real folder) and the gate's entries go
      if (linked && fs.lstatSync(link).isSymbolicLink()) {
        if (!DRY) { if (WIN) fs.rmdirSync(link); else fs.unlinkSync(link); }
        say(`removed the link ${fwd(link)} (the picture skill needs Codex)`);
      }
      for (const event of Object.keys(s.hooks || {})) {
        s.hooks[event] = s.hooks[event].filter((g) => !JSON.stringify(g).includes("picture-gate.mjs"));
        if (!s.hooks[event].length) delete s.hooks[event];
      }
      if (s.hooks && !Object.keys(s.hooks).length) delete s.hooks;
    }
  }
  putJson(file, s, was);
}
// Remembered for later runs: the projects folder, the folder of this setup (a chat can find it again),
// its version, the answers about the workers and Node, and what the rules and notes files were written as
const version = JSON.parse(fs.readFileSync(path.join(REPO, "version.json"), "utf8")).version;
const nextState = { ...state, projects: PROJECTS, repo: REPO, version, ...marks, written, files: filesWritten };
if (modelMark) nextState.model = modelMark;
if (userCopies.size) nextState.userCopies = [...userCopies].sort();
if (agyAdded.length) nextState.agyAdded = agyAdded;
for (const name of ["codex", "agy"]) if (answer(name) !== null) nextState[name] = answer(name);
if (nodeFile) nextState.node = nodeFile;
if (LANG) nextState.language = LANG;
for (const key of Object.keys(nextState)) if (nextState[key] === undefined) delete nextState[key];
// (nextState is written once, after the extensions and plugins below: a run that stops before then
// leaves the old record, version included)

for (const [tool, what] of [["codex", "Codex CLI (GPT)"], ["agy", "Antigravity CLI (Gemini)"]]) {
  const why = opt(tool) ? "" : answer(tool) !== null ? " (as answered before)" : onPath(tool) ? " (found on the PATH)" : " (not found on the PATH)";
  say(`${what}: ${have[tool] ? "used" : "not used, optional"}${why}`);
}
// The editor extensions are built from source and installed into Nimbalyst's own extensions folder,
// when Nimbalyst is there. One whose source is as at the last run is left alone. read-aloud needs a
// speech program of its own, so it is only built with --with read-aloud or where it is installed already.
const extDir = path.join(REPO, "extensions");
const extensions = fs.existsSync(extDir) ? fs.readdirSync(extDir).filter((n) => fs.existsSync(path.join(extDir, n, "package.json"))) : [];
const appData = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.env.APPDATA || "";
const extHome = path.join(appData, "@nimbalyst", "electron");
// (EXT_FOLDER, the folder name of each extension, is defined above the uninstall block, which needs it too.)
// --home is another home folder (the tests), where the real Nimbalyst is not the one to install into
const wantExt = opt("extensions") === "no" ? false : opt("extensions") === "yes" ? true : opt("home") === null;
const sourceOf = (dir, base = dir) => fs.readdirSync(dir, { withFileTypes: true }).filter((e) => !["node_modules", "dist"].includes(e.name))
  .flatMap((e) => (e.isDirectory() ? sourceOf(path.join(dir, e.name), base) : [path.relative(base, path.join(dir, e.name))]));
// The extensions are built in the language (SETUP_LANGUAGE), so it is part of what is compared
const EXT_LANG = LANG || "english";
const printOf = (dir) => sha(sourceOf(dir).sort().map((f) => f + "\n" + read(path.join(dir, f))).join("\n") + `\nlanguage:${EXT_LANG}`);
const builtExt = { ...(state.extensions || {}) };
if (extensions.length && wantExt && appData && fs.existsSync(extHome)) {
  const only = (process.env.SETUP_EXTENSIONS || "").split(",").filter(Boolean); // the tests build one
  for (const name of extensions.filter((n) => !only.length || only.includes(n))) {
    const dir = path.join(extDir, name);
    const target = path.join(extHome, "extensions", EXT_FOLDER[name] || name);
    if (name === "read-aloud" && !withNames.includes("read-aloud") && !fs.existsSync(target)) { say(`extension left out: read-aloud (it needs its own speech program; see ${fwd(path.join(dir, "README.md"))}; add it with --with read-aloud)`); continue; }
    if (builtExt[name] === printOf(dir) && fs.existsSync(target)) { say(`extension unchanged: ${name}`); continue; }
    const plain = ["ink-themes", "agents-panel"].includes(name); // build with Node alone
    if (!plain && !onPath("npm")) { say(`extension not built: ${name} (npm is not on the PATH; install Node.js with npm and run this again)`); continue; }
    if (DRY) { say(`extension would be built and installed: ${name}`); continue; }
    const steps = plain ? [[process.execPath, ["build.mjs"]], [process.execPath, ["build.mjs", "--install"]]]
      : [["npm", ["install"]], ["npm", ["run", "build"]], ["npm", ["run", "install-ext"]]];
    let failed = "";
    for (const [cmd, a] of steps) {
      const run = { cwd: dir, encoding: "utf8", timeout: 600000, env: { ...process.env, SETUP_LANGUAGE: EXT_LANG } };
      const r = cmd === "npm" ? spawnSync(`npm ${a.join(" ")}`, { ...run, shell: true }) : spawnSync(cmd, a, run);
      if (r.status === 0) continue;
      failed = `${path.basename(cmd)} ${a.join(" ")}: ${(`${r.stderr || ""}${r.stdout || ""}`.trim() || String(r.error || "no output")).split("\n").slice(-4).join(" | ")}`;
      break;
    }
    if (failed) { say(`extension failed: ${name} (${failed}). Everything else was installed; run this again to retry.`); continue; }
    builtExt[name] = printOf(dir);
    say(`extension installed: ${name}${name === "read-aloud" ? ` (it needs its own speech program; see ${fwd(path.join(dir, "README.md"))})` : ""} (quit Nimbalyst and open it again to load it)`);
  }
  if (!DRY && JSON.stringify(builtExt) !== JSON.stringify(state.extensions || {})) nextState.extensions = builtExt;
} else if (extensions.length) {
  say(`Nimbalyst extensions are not installed by this script: ${extensions.join(", ")}. For each one, in ${fwd(path.join(REPO, "extensions"))}/<name>: npm install, npm run build, npm run install-ext, then restart Nimbalyst.`);
}

// The plugins. Each is handled once and put on record: one the user removed or switched later stays
// as they have it.
const PLUGINS = [
  ["claude-hud@claude-hud", "jarrodwatts/claude-hud"],
];
// --home is another home folder (the tests), and the claude command works on the real one
const wantPlugins = opt("plugins") === "no" ? false : opt("plugins") === "yes" ? true : opt("home") === null;
const plugged = [...(state.plugins || [])];
const toPlug = PLUGINS.filter(([name]) => !plugged.includes(name));
const cli = (line, ms = 300000) => {
  const r = spawnSync(line, { shell: true, encoding: "utf8", timeout: ms });
  return { ok: r.status === 0, out: `${r.stdout || ""}${r.stderr || ""}`.trim() || String(r.error || "no output") };
};
const tail = (text) => text.split("\n").slice(-3).join(" | ");
if (!wantPlugins) {
  if (toPlug.length) say(`plugins not installed by this run: ${toPlug.map(([n]) => n.split("@")[0]).join(", ")}`);
} else if (toPlug.length && !onPath("claude")) {
  say(`plugins not installed: the claude command is not on the PATH. Run this again from a terminal where claude works.`);
} else if (toPlug.length && !onPath("git")) {
  say(`plugins not installed: they are downloaded with Git, which is not on the PATH. Install Git and run this again.`);
} else if (toPlug.length && DRY) {
  say(`plugins would be installed if missing: ${toPlug.map(([n]) => n.split("@")[0]).join(", ")}`);
} else if (toPlug.length) {
  const list = cli("claude plugin list", 60000);
  const markets = new Set();
  if (!list.ok) say(`plugins not installed: claude plugin list failed (${tail(list.out)})`);
  else for (const [name, market] of toPlug) {
    if (list.out.includes(name)) { say(`plugin already there: ${name} (left as it is)`); plugged.push(name); continue; }
    if (!markets.has(market)) { cli(`claude plugin marketplace add ${market}`); markets.add(market); }
    const got = cli(`claude plugin install ${name}`);
    if (!got.ok) { say(`plugin failed: ${name} (${tail(got.out)}). Everything else was installed; run this again to retry.`); continue; }
    plugged.push(name);
    say(`plugin installed: ${name}`);
  }
}
// find-skills is someone else's skill, fetched with npx into the real home folder
const finder = "find-skills";
if (wantPlugins && !DRY && opt("home") === null && !plugged.includes(finder)) {
  if (fs.existsSync(path.join(CLAUDE, "skills", finder))) plugged.push(finder);
  else if (onPath("npx")) {
    const got = cli(`npx -y skills add vercel-labs/skills --skill ${finder} -g -y`);
    if (got.ok) { plugged.push(finder); say(`skill installed: ${finder}`); }
    else say(`skill failed: ${finder} (${tail(got.out)}). Everything else was installed; run this again to retry.`);
  }
}
if (!DRY && JSON.stringify(plugged) !== JSON.stringify(state.plugins || [])) nextState.plugins = plugged;
// The record is written now: everything that can stop a run has run
if (JSON.stringify(nextState) !== JSON.stringify(state)) putJson(stateFile, nextState, JSON.stringify(state));
stateSaved = true;

// What a script can't do is named by the first install only: the settings inside Nimbalyst are
// reached with tools only a chat there has, and voice typing is a program the person sets up.
// A home with a version on record has been through that, so a later run (an update) stays quiet:
// it opens no folder and asks about nothing the person has already set up or answered.
const fullInstall = fwd(path.join(REPO, "docs", "full-install.md"));
if (!state.version && !(state.done || []).includes("chat-steps")) {
  say(`Left for a chat, once: Nimbalyst's settings and voice typing. In a Claude chat (inside Nimbalyst where it is used) carry out steps 8 and 9 of ${fullInstall}. This is named now only; an update never asks for it.`);
}
say(`The programs (Nimbalyst, Git, uv, the outside workers) are the full install: ${fullInstall}`);

// ---- what this run did to files that were already there, and what looks left over
// A hook in settings.json that starts a script by its full path, where that script is not there
const lost = [];
if (!DRY) for (const [event, groups] of Object.entries(settings.hooks || {})) {
  for (const hook of groups.flatMap((g) => g.hooks || [])) {
    for (const m of String(hook.command || "").matchAll(/"([^"]+\.(?:mjs|cjs|js|sh|py|ps1))"|(\S+\.(?:mjs|cjs|js|sh|py|ps1))(?=\s|$)/g)) {
      let script = (m[1] || m[2]).replace(/^~(?=[\\/])/, home);
      if (WIN) script = script.replace(/^\/([a-zA-Z])\//, "$1:/");
      if (path.isAbsolute(script) && !/[$%]/.test(script) && !fs.existsSync(script)) lost.push(`${event}: ${fwd(script)}`);
    }
  }
}
const did = said.some((l) => /^(rules: )?(copied|replaced|wrote|hook added|hook repointed|hook replaced|hook matcher updated|linked|removed|extension installed|plugin installed|skill installed|model: set|MODEL CHANGED|model: sonnet is back|permissions: )/.test(l));
if (did || tally.yours.length) {
  const parts = [[tally.added, "new"], [tally.replaced.length, "replaced"], [tally.yours.length, "kept as yours"], [tally.same, "unchanged"]];
  say(`Files: ${parts.filter(([n]) => n).map(([n, what]) => `${n} ${what}`).join(", ")}.`);
}
if (tally.replaced.length) {
  say(`Replaced, the old one is next to each as <name>.before-install-<date>:`);
  for (const f of tally.replaced) say(`  ${f}`);
}
if (tally.yours.length) {
  say(`Kept as yours, because they differ from the setup's version (you changed them, or had them before):`);
  for (const f of tally.yours) say(`  ${f}`);
  say(`To take the setup's version, run this again with --replace <name> for one file or --replace-all for all of them and the rules. Yours is then kept as a dated copy.`);
}
if (lost.length) {
  say(`Hooks in ${fwd(settingsFile)} whose script is not there (left over from something else; nothing was done about them):`);
  for (const l of lost) say(`  ${l}`);
}
// What a run printed is saved when it changed something, so it can be read or sent later
const stamp = new Date().toISOString().slice(0, 19).replace(/[-:]/g, "").replace("T", "-");
const logFile = path.join(CLAUDE, "setup-logs", `install-${stamp}.txt`);
if (did && !DRY) say(`This run is saved in ${fwd(logFile)}`);
say(`Language: ${LANG || "not chosen"}`);
if (noGitBash) say(GIT_BASH_MISSING);
say(DRY ? "Nothing was changed." : `Done. Restart Claude Code so it loads the hooks. How to use the setup: ${fwd(path.join(REPO, "docs", "HOW-TO.md"))}`);
// The closing list of an update: what is still on an older version because it is the user's, each with
// the line that takes the setup's version. --replace <file> works on the names as the lists above give
// them, --replace-rules on the rules; --home is repeated so the line acts on the same folder.
if (tally.yours.length || rulesKept) {
  const quote = (name) => (/\s/.test(name) ? `"${name}"` : name);
  say(`Yours, on old versions (they stay as they are, so they are behind this version); each line takes the setup's version, and yours stays as a dated copy:`);
  for (const f of tally.yours) say(`  ${f}: ${selfRun(`--replace ${quote(f)}`)}`);
  if (rulesKept) say(`  the rules (CLAUDE.md): ${selfRun("--replace-rules")}`);
  if (tally.yours.length > 1 || (tally.yours.length && rulesKept)) say(`  all of them and the rules at once: ${selfRun("--replace-all")}`);
}
if (did && !DRY) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, said.join("\n") + "\n");
}
