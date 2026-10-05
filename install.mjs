#!/usr/bin/env node
// Installs this setup. Safe to run again: it adds what is missing and a second run changes nothing.
//   1. ~/.claude: the hooks, the worker agent and the skills, and the hook wiring from
//      settings.example.json merged into settings.json
//   2. ~/.claude/CLAUDE.md: the global rules from rules/, with the section about outside workers that
//      fits what is installed (Codex, Antigravity, both or neither)
//   3. the base project folders from projects/ (ask-anything, internet-search, quick-tasks,
//      claude-settings), each with its skills, hooks, tools and its own .claude/settings.json
// A file that is replaced is kept next to the new one as <name>.before-install-<date>. The notes files
// the user fills in (profile.md, finds/INDEX.md) are written only when missing. The rules, each
// folder's CLAUDE.md and HOW-TO.md are the user's once they changed them: a later run (an update)
// replaces one only while it is still exactly what an earlier run wrote.
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
//   --home <folder>             install into <folder>/.claude instead of the home folder's
//   --node <file>               start the hooks with this Node by its full path instead of plain `node`
//                               (for a Mac, where an app opened from the Dock may not have Node on its
//                               PATH; remembered for later runs)
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] || "" : null);
const DRY = args.includes("--dry-run");
const home = opt("home") !== null ? path.resolve(opt("home") || ".") : os.homedir();
const CLAUDE = path.join(home, ".claude");
const WIN = process.platform === "win32";
const fwd = (p) => p.replace(/\\/g, "/");
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const say = (s) => console.log((DRY ? "[dry run] " : "") + s);
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
// Writes a file and says what happened. keep: a file that is already there is the user's and stays.
function put(to, data, { keep = false } = {}) {
  const there = fs.existsSync(to);
  if (there && keep) return say(`kept ${fwd(to)} (already there)`);
  if (there && fs.readFileSync(to).equals(data)) return say(`unchanged ${fwd(to)}`);
  const backup = there ? keepCopy(to) : null;
  if (!DRY) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, data);
  }
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
  put(path.join(CLAUDE, rel), data);
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
if (have.codex) for (const rel of filesIn(shared)) put(path.join(CLAUDE, rel), fit(rel, fs.readFileSync(path.join(shared, rel))));

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
        if (JSON.stringify(list).includes(path.basename(script))) continue;
        const command = `${NODE} "${fwd(path.join(global ? CLAUDE : folder, script))}"${extra}`;
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
if (!wire(settings, example.hooks, CLAUDE)) say(`hooks already wired in ${fwd(settingsFile)}`);
else putJson(settingsFile, settings, settingsWas);

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
else if (args.includes("--replace-rules") || state.rules === sha(mine)) {
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
    put(path.join(dir, rel), fit(rel, fs.readFileSync(path.join(from, rel))), { keep: !own });
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
const nextState = { ...state, projects: PROJECTS, repo: REPO, version, ...marks, written };
for (const name of ["codex", "agy"]) if (answer(name) !== null) nextState[name] = answer(name);
if (nodeFile) nextState.node = nodeFile;
for (const key of Object.keys(nextState)) if (nextState[key] === undefined) delete nextState[key];
if (JSON.stringify(nextState) !== JSON.stringify(state)) putJson(stateFile, nextState, JSON.stringify(state));

for (const [tool, what] of [["codex", "Codex CLI (GPT)"], ["agy", "Antigravity CLI (Gemini)"]]) {
  const why = opt(tool) ? "" : answer(tool) !== null ? " (as answered before)" : onPath(tool) ? " (found on the PATH)" : " (not found on the PATH)";
  say(`${what}: ${have[tool] ? "used" : "not used, optional"}${why}`);
}
// The editor extensions are built from source with npm and installed into Nimbalyst, so not here
const extDir = path.join(REPO, "extensions");
const extensions = fs.existsSync(extDir) ? fs.readdirSync(extDir).filter((n) => fs.existsSync(path.join(extDir, n, "package.json"))) : [];
if (extensions.length) {
  say(`Nimbalyst extensions are not installed by this script: ${extensions.join(", ")}. For each one, in ${fwd(path.join(REPO, "extensions"))}/<name>: npm install, npm run build, npm run install-ext, then restart Nimbalyst.`);
}
say(`Voice typing is not installed by this script: it is Handy, a separate free program. See "Voice typing" in ${fwd(path.join(REPO, "README.md"))}`);
say(`The programs, the plugins and the app settings are the full install: ${fwd(path.join(REPO, "docs", "full-install.md"))}`);
say(DRY ? "Nothing was changed." : `Done. Restart Claude Code so it loads the hooks. How to use the setup: ${fwd(path.join(REPO, "docs", "HOW-TO.md"))}`);
