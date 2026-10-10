#!/usr/bin/env node
// Installs this setup. Safe to run again: it adds what is missing and a second run changes nothing.
//   1. ~/.claude: the hooks, the worker agent and the skills, and the hook wiring from
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
//   --done chat-steps           only put on record that a chat carried out the steps named at the end
//                               (no longer needed: only the first install names them)
//   --language english|russian  the language Claude answers in and the extensions show (also en, ru,
//                               русский; kept for later runs, so an update keeps it; with russian,
//                               "language": "russian" goes into settings.json, and the extensions are built
//                               with SETUP_LANGUAGE=russian)
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

if (Number(process.versions.node.split(".")[0]) < 18) {
  console.log(`Node.js 18 or newer is needed; this is ${process.version}.`);
  process.exit(1);
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
    console.log(`${fwd(file)} is not valid JSON; nothing was changed. Fix it and run this again.`);
    process.exit(1);
  }
}
const settingsFile = path.join(CLAUDE, "settings.json");
const settings = readSettings(settingsFile);

// The projects folder: the one given, else the one an earlier run kept, else Projects in the home folder
const stateFile = path.join(CLAUDE, "setup-state.json");
const state = readSettings(stateFile);
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
const WORKERS = path.join(CLAUDE, "workers");
const have = { codex: worker("codex"), agy: worker("agy") };
const which = have.codex && have.agy ? "Codex and Antigravity" : have.codex ? "Codex only" : have.agy ? "Antigravity only" : "Claude alone";

// A dated copy of a file as it is now, made before it is changed. A copy already made today stays as
// it is (it is the older one); a second change on the same day gets -2, -3, ...
function keepCopy(file) {
  const base = `${file}.before-install-${today}`;
  let copy = base;
  for (let n = 2; fs.existsSync(copy); n++) {
    if (fs.readFileSync(copy).equals(fs.readFileSync(file))) return path.basename(copy);
    copy = `${base}-${n}`;
  }
  if (!DRY) fs.copyFileSync(file, copy);
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
  const backup = there ? keepCopy(to) : null;
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
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
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

// ---- 1. the files for ~/.claude
for (const rel of files) {
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
// projects/shared holds what the picture skill needs in ~/.claude: the skill itself and its gate
const shared = path.join(REPO, "projects", "shared");
if (have.codex) for (const rel of filesIn(shared)) put(path.join(CLAUDE, rel), fit(rel, fs.readFileSync(path.join(shared, rel))), { own: true });

// The hook wiring: each hook from an example is added unless that event already runs the same script.
// The command points at the installed copy by its full path, so it works from any folder and shell.
// A script named as ~/.claude/... is the one in ~/.claude, any other path is inside the project folder.
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
        if (JSON.stringify(list).includes(base)) {
          // An older copy of this setup may have wired the same script from another place in ~/.claude:
          // that wiring is pointed at the installed copy. A script outside ~/.claude is the user's own.
          const name = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          for (const old of global ? list.flatMap((g) => g.hooks || []) : []) {
            const m = String(old.command || "").match(new RegExp(`"([^"]*[\\\\/]${name})"|(\\S*[\\\\/]${name})`));
            const was = m && fwd(m[1] || m[2]).replace(/^~(?=\/)/, fwd(home));
            if (!was || was.toLowerCase() === at.toLowerCase() || !was.toLowerCase().startsWith(fwd(CLAUDE).toLowerCase() + "/")) continue;
            old.command = command;
            say(`hook repointed: ${event} ${base}${where} (it started ${was})`);
            added++;
          }
          continue;
        }
        const entry = { type: "command", command, timeout: hook.timeout };
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
const wired = wire(settings, example.hooks, CLAUDE);
if (!wired) say(`hooks already wired in ${fwd(settingsFile)}`);
// Claude Code's own settings go into the same file: what is set there already stays
const own = addClaudeCodeSettings(settings, WIN);
if (own.model) say(`model: set to sonnet in ${fwd(settingsFile)} (none was set)`);
if (own.added) say(`permissions: ${own.added} rule(s) added (the saved sign-ins and SSH keys can't be read, a .env file is asked about)`);
// Claude Code's own reply-language setting follows the language. english removes only the "russian"
// this setup wrote: a language the person set to something else stays.
let langChanged = false;
if (LANG === "russian" && settings.language !== "russian") { settings.language = "russian"; langChanged = true; say(`language: russian set in ${fwd(settingsFile)}`); }
else if (LANG === "english" && state.language === "russian" && settings.language === "russian") { delete settings.language; langChanged = true; say(`language: russian removed from ${fwd(settingsFile)}`); }
if (wired || own.model || own.added || langChanged) putJson(settingsFile, settings, settingsWas);

// ---- 2. the global rules, with the worker section that fits
const HEAD = /^## (External workers first for gathering information|Gathering information on Claude alone)$/;
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
const rulesFile = path.join(CLAUDE, "CLAUDE.md");
const mine = fs.existsSync(rulesFile) ? fs.readFileSync(rulesFile, "utf8").replace(/\r\n/g, "\n") : null;
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
  const backup = keepCopy(rulesFile);
  writeRules(built);
  say(`rules: replaced ${fwd(rulesFile)} (workers: ${which}; old copy: ${backup})`);
} else {
  if (mine === swapped) say(`rules: unchanged ${fwd(rulesFile)} (workers: ${which})`);
  else if (swapped !== null) {
    const backup = keepCopy(rulesFile);
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
for (const name of ["codex", "agy"]) if (answer(name) !== null) nextState[name] = answer(name);
if (nodeFile) nextState.node = nodeFile;
if (LANG) nextState.language = LANG;
for (const key of Object.keys(nextState)) if (nextState[key] === undefined) delete nextState[key];
if (JSON.stringify(nextState) !== JSON.stringify(state)) putJson(stateFile, nextState, JSON.stringify(state));

for (const [tool, what] of [["codex", "Codex CLI (GPT)"], ["agy", "Antigravity CLI (Gemini)"]]) {
  const why = opt(tool) ? "" : answer(tool) !== null ? " (as answered before)" : onPath(tool) ? " (found on the PATH)" : " (not found on the PATH)";
  say(`${what}: ${have[tool] ? "used" : "not used, optional"}${why}`);
}
// The editor extensions are built from source and installed into Nimbalyst's own extensions folder,
// when Nimbalyst is there. One whose source is as at the last run is left alone. read-aloud needs a
// speech program of its own, so it is only rebuilt where it is installed already.
const extDir = path.join(REPO, "extensions");
const extensions = fs.existsSync(extDir) ? fs.readdirSync(extDir).filter((n) => fs.existsSync(path.join(extDir, n, "package.json"))) : [];
const appData = process.platform === "darwin" ? path.join(os.homedir(), "Library", "Application Support") : process.env.APPDATA || "";
const extHome = path.join(appData, "@nimbalyst", "electron");
const EXT_FOLDER = { "ink-themes": "inktheme", "usage-plan": "usageplan", commands: "commandbuttons", "read-aloud": "readaloud" };
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
    if (name === "read-aloud" && !fs.existsSync(target)) { say(`extension left out: read-aloud (it needs its own speech program; see ${fwd(path.join(dir, "README.md"))})`); continue; }
    if (builtExt[name] === printOf(dir) && fs.existsSync(target)) { say(`extension unchanged: ${name}`); continue; }
    const plain = name === "ink-themes"; // builds with Node alone
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
    say(`extension installed: ${name} (quit Nimbalyst and open it again to load it)`);
  }
  if (!DRY && JSON.stringify(builtExt) !== JSON.stringify(state.extensions || {})) {
    nextState.extensions = builtExt;
    fs.writeFileSync(stateFile, JSON.stringify(nextState, null, 2) + "\n");
  }
} else if (extensions.length) {
  say(`Nimbalyst extensions are not installed by this script: ${extensions.join(", ")}. For each one, in ${fwd(path.join(REPO, "extensions"))}/<name>: npm install, npm run build, npm run install-ext, then restart Nimbalyst.`);
}

// The plugins. claude-hud stays on; the other three load into every session while they are on, so
// they are installed switched off and /new-project turns one on in the project that needs it. Each
// is handled once and put on record: one the user removed or switched later stays as they have it.
const PLUGINS = [
  ["claude-hud@claude-hud", "jarrodwatts/claude-hud", true],
  ["claude-code-setup@claude-plugins-official", "anthropics/claude-plugins-official", false],
  ["superpowers@claude-plugins-official", "anthropics/claude-plugins-official", false],
  ["context7@claude-plugins-official", "anthropics/claude-plugins-official", false],
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
  else for (const [name, market, on] of toPlug) {
    if (list.out.includes(name)) { say(`plugin already there: ${name} (left as it is)`); plugged.push(name); continue; }
    if (!markets.has(market)) { cli(`claude plugin marketplace add ${market}`); markets.add(market); }
    const got = cli(`claude plugin install ${name}`);
    const off = got.ok && !on ? cli(`claude plugin disable ${name}`) : got;
    if (!off.ok) { say(`plugin failed: ${name} (${tail(off.out)}). Everything else was installed; run this again to retry.`); continue; }
    plugged.push(name);
    say(`plugin installed: ${name}${on ? "" : " (switched off; /new-project turns it on in the project that needs it)"}`);
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
if (!DRY && JSON.stringify(plugged) !== JSON.stringify(state.plugins || [])) {
  nextState.plugins = plugged;
  fs.writeFileSync(stateFile, JSON.stringify(nextState, null, 2) + "\n");
}

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
const did = said.some((l) => /^(rules: )?(copied|replaced|wrote|hook added|hook repointed|linked|removed|extension installed|plugin installed|skill installed|model: set|permissions: )/.test(l));
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
say(DRY ? "Nothing was changed." : `Done. Restart Claude Code so it loads the hooks. How to use the setup: ${fwd(path.join(REPO, "docs", "HOW-TO.md"))}`);
if (did && !DRY) {
  fs.mkdirSync(path.dirname(logFile), { recursive: true });
  fs.writeFileSync(logFile, said.join("\n") + "\n");
}
