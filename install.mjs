#!/usr/bin/env node
// Installs this setup. Safe to run again: it adds what is missing and a second run changes nothing.
//   1. ~/.claude: the hooks, the agents and the skills, and the hook wiring from
//      settings.example.json merged into settings.json
//   2. ~/.claude/CLAUDE.md: the global rules from rules/, written whole; the user's own rules in it move to
//      ~/.claude/rules/my-rules.md (scripts/rules.mjs)
//   3. the base project folders from projects/ (quick-tasks, claude-settings), each with its skills, hooks,
//      tools and its own .claude/settings.json. A folder an older version shipped and this one merged into
//      quick-tasks (projects/homes.json "retired") stays with all its files: its notes are copied into
//      quick-tasks where missing, and the setup no longer keeps it (scripts/projects.mjs: retiredHomes)
//   4. Claude Code's own settings (a default model when none is set, permission rules for the saved
//      sign-ins and .env files), the Nimbalyst extensions and the plugins
// What a script can't do (the settings inside Nimbalyst, voice typing) the first install names at the
// end for a chat; an update does not.
// A file that is replaced is kept, as it was, in ~/.claude/setup-logs/<YYYY-MM-DD>-install-backup/ under its path
// from the home folder; the copies older versions left next to the files move there once. The notes files
// the user fills in (profile.md, finds/INDEX.md) are written only when missing. Everything else is the
// user's once they changed it: a later run (an update) replaces a hook, a skill, the rules, a folder's
// CLAUDE.md or how-to.md only while it is still exactly what an earlier run wrote. A file that was
// there before the first install under the same name is the user's too. Such a file stays, the run
// lists it at the end, and --replace or --replace-all takes the setup's version.
// A run that changed something saves what it printed in ~/.claude/setup-logs.
// What a run was told is kept in ~/.claude/setup-state.json, with the version from version.json, so
// that the updater (skills/update-setup/update.mjs) can run this again without asking anything.
//   node install.mjs            install
//   node install.mjs --dry-run  print what it would do and change nothing
//   --uninstall                 take the setup out again: its hook wiring leaves settings.json, its files
//                               go unless changed, the user's copy in setup-logs is put back; the project folders,
//                               plugins and extensions stay (the run says how to remove them); with --dry-run
//                               it only prints what it would do
//   --obscura yes|no            put Obscura, the headless browser tools/peek.mjs falls back on, into ~/.claude/obscura
//                               (default: yes, about 70 MB, one pinned release with its SHA-256 checked; a no is
//                               remembered; with --home only when yes is given)
//   --projects <folder>         where the project folders go (default: Projects in the home folder;
//                               the folder given once is remembered for later runs)
//   --codex yes|no              whether the Codex CLI is used, for the picture skill and the web sweeps of
//                               quick-tasks (default: the answer given before, else yes when `codex` is
//                               on the PATH)
//   --handy yes|no              the answer about voice typing with Handy, asked once by the first install's chat
//                               (docs/full-install.md); only kept for later runs, which don't ask again. This run
//                               neither installs nor removes Handy: the chat installs it on a yes
//   --backup yes|no             the answer about the encrypted backup, asked once the same way; only kept (a yes is
//                               set up by /backup, a no leaves a ~/.claude-backup folder that is there alone)
//   --replace <file>           take the setup's version of one file the user changed, named as the run
//                               lists it (hooks/sql-guard.mjs); can be given several times
//   --replace-all               the same for every such file
//   --leave-out "<lead>"        leave this shipped rule out of ~/.claude/CLAUDE.md, on this and later runs
//                               (the lead: its bold opening, else its first six words); --put-back "<lead>" undoes it
//   --extensions yes|no         build the Nimbalyst extensions and put them into Nimbalyst (default: yes
//                               when Nimbalyst is installed; they change nothing until a theme is picked)
//   --no-theme                  leave Nimbalyst's theme alone (also SETUP_THEME=off); by default a Nimbalyst
//                               where no theme was picked yet, or a non-Ink one was picked before (switched once,
//                               then recorded), gets Ink Cobalt; an Ink theme, or a theme picked later, stays
//   --theme-done                a chat set the Ink theme through the open Nimbalyst: record it, nothing else
//   --app-settings <file>       Nimbalyst's settings file, when it is somewhere else (the tests)
//   --plugins yes|no            install the plugins (default: yes; each is handled once, so one that was
//                               removed or switched later stays as it is)
//   --with <names>               add one or more add-ons left out of a default install: phone-bot,
//                               read-aloud, comma-separated; a copy already in place
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
//   --keep-home-model           quick-tasks had "model": "sonnet" before it took in the hunts and questions; an
//                               update moves it to opus once. This keeps sonnet there (and, after the move, puts
//                               it back); the choice is kept for later runs. The global model is --keep-model's
//   --files-only                only step 1's files (hooks, agents, skills, workers; one the user changed stays) and
//                               the record of them with the new version: no Claude Code check, settings, rules,
//                               project folder files, extensions, theme or plugins. Step 1's cleanup of what earlier
//                               versions left still runs as usual (scripts/claude-files.mjs: retired skills, also two
//                               in the claude-settings folder, and Antigravity entries an old version recorded), and
//                               so does the move of the dated copies kept beside files into setup-logs (below).
//                               update.mjs --files-only runs it for a release labelled `kind: files`; it needs an
//                               install with its files on record
//   --home <folder>             install into <folder>/.claude instead of the home folder's
//   --node <file>               start the hooks with this Node by its full path instead of plain `node`
//                               (for a Mac, where an app opened from the Dock may not have Node on its
//                               PATH; remembered for later runs)
// The jobs are in scripts/ (each says what it does); this file reads the flags, builds the run's ctx and
// calls them in order. Each takes the ctx; what they record goes into ctx.nextState, written last.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkClaudeCode,
  pointNimbalyst,
} from "./scripts/claude-code-version.mjs";
import {
  ADDONS,
  claudeFiles,
  gitBashFound,
  gitBashMissing,
} from "./scripts/claude-files.mjs";
import { extensions } from "./scripts/extensions.mjs";
import {
  fwd,
  moveOldCopies,
  OWN_FOLDERS,
  readJson,
  writers,
} from "./scripts/files.mjs";
import { claudeSettings, onProPlan } from "./scripts/model.mjs";
import { appDataDir, nimbalystHome } from "./scripts/nimbalyst-paths.mjs";
import { obscura } from "./scripts/obscura.mjs";
import { plugins } from "./scripts/plugins.mjs";
import { projects, retiredHomes } from "./scripts/projects.mjs";
import { fitter, repoSources } from "./scripts/repo.mjs";
import { report } from "./scripts/report.mjs";
import { leftOut, rules } from "./scripts/rules.mjs";
import { stateFileIn, themeDone, writeState } from "./scripts/setup-state.mjs";
import { theme } from "./scripts/theme.mjs";
import { uninstall } from "./scripts/uninstall.mjs";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const opt = (name) =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] || "" : null;
const DRY = args.includes("--dry-run");
const FILES_ONLY = args.includes("--files-only");
const home =
  opt("home") !== null ? path.resolve(opt("home") || ".") : os.homedir();
const CLAUDE = path.join(home, ".claude");
const said = [];
const say = (s) => {
  said.push(s);
  console.log((DRY ? "[dry run] " : "") + s);
};
const ctx = {
  REPO,
  args,
  opt,
  DRY,
  home,
  CLAUDE,
  WIN: process.platform === "win32",
  said,
  say,
};

// SETUP_NODE_VERSION: the tests pretend another Node
const NODE_VERSION = process.env.SETUP_NODE_VERSION || process.versions.node;
const [nodeMajor, nodeMinor] = NODE_VERSION.split(".").map(Number);
if (nodeMajor < 18) {
  console.log(`Node.js 18 or newer is needed; this is v${NODE_VERSION}.`);
  process.exit(1);
}
// node:sqlite (Node 22.5) is used only to read Nimbalyst's database; the hooks themselves run on 18
if (nodeMajor < 22 || (nodeMajor === 22 && nodeMinor < 5)) {
  say(
    `Node.js v${NODE_VERSION} is older than 22.5. Three things read Nimbalyst's database and need 22.5 or newer, so they stay off: notes between Nimbalyst sessions (skills/steer), compact-self and the Nimbalyst figures in the usage dashboard. Nothing else does. Install Node.js 22.5 or newer to turn them on.`,
  );
}

// Claude Code itself: updated when behind npm's newest, and the install stops below the minimum this setup needs
// (version.json: claudeCodeMin). Also Nimbalyst's bundled Claude Code. /update-setup reaches this through install.mjs.
Object.assign(ctx, repoSources(REPO));
if (!FILES_ONLY) {
  const { stop } = checkClaudeCode({
    min: ctx.claudeCodeMin,
    dry: DRY,
    log: say,
  });
  if (stop) {
    console.log(stop);
    process.exit(1);
  }
}

// Settings that can't be read stop the install before anything is copied.
const settingsFile = path.join(CLAUDE, "settings.json");
const settings = readJson(settingsFile);
const stateFile = stateFileIn(CLAUDE);
const state = readJson(stateFile);
Object.assign(ctx, { settingsFile, settings, stateFile, state });
// The record (version, files, answers) is written last, so a run that stops part way leaves the old one
// and the next run does the whole job again; only the restore records (ctx.saveCopies) go on disk as they are
// made. Anything thrown ends here with that said.
let stateSaved = false;
process.on("uncaughtException", (e) => {
  console.log(
    `\nThe install stopped part way: ${e.code ? `${e.code} ` : ""}${e.message}`,
  );
  console.log(
    stateSaved
      ? `The install itself finished and is on record in ${fwd(stateFile)}; only the last step failed. Running it again is safe.`
      : `Nothing new was put on record${ctx.copiesSaved ? " (only where your old files are kept in setup-logs)" : ""}: ${fwd(stateFile)} still says ${state.version ? `version ${state.version}` : "that no version was installed"}. Files copied before the stop are in place and fine. Fix what the line above names, then run the same command again: running it again is safe and finishes the job.`,
  );
  process.exit(1);
});
// --done <name>: a step a chat carried out goes on record, so later runs stop naming it. A record with no
// version (only the restore records of a run that stopped part way) is not an install.
if (opt("done")) {
  if (!state.version) {
    console.log(
      `${fwd(stateFile)} has no install on record: run the install first.`,
    );
    process.exit(1);
  }
  writeState(stateFile, {
    ...state,
    done: [...new Set([...(state.done || []), opt("done")])],
  });
  console.log(`on record as done: ${opt("done")}`);
  process.exit(0);
}
// The language: the one given, else the one kept from an earlier run ("" = not chosen)
const LANGUAGES = {
  english: "english",
  en: "english",
  russian: "russian",
  ru: "russian",
  русский: "russian",
};
ctx.LANG = state.language || "";
if (opt("language") !== null) {
  ctx.LANG = LANGUAGES[opt("language").trim().toLowerCase()];
  if (!ctx.LANG) {
    console.log(
      `--language ${opt("language")}: not supported. The two languages are english and russian.`,
    );
    process.exit(1);
  }
}
const nodeFile = opt("node")
  ? fwd(path.resolve(opt("node")))
  : state.node || "";
ctx.NODE = nodeFile ? `"${nodeFile}"` : "node";
ctx.PROJECTS = opt("projects")
  ? path.resolve(opt("projects").replace(/^~(?=$|[\\/])/, home))
  : state.projects || path.join(home, "Projects");
ctx.homeSettings = Object.fromEntries(
  ctx.HOMES.map((h) => [
    h,
    readJson(path.join(ctx.PROJECTS, h, ".claude", "settings.json")),
  ]),
);

// Codex is optional: without it the picture skill (it needs Codex) is left out and the folders' notes say
// what Claude does instead.
ctx.onPath = (name) =>
  (process.env.PATH || "")
    .split(path.delimiter)
    .some(
      (d) =>
        d &&
        ["", ".cmd", ".exe", ".ps1"].some((e) =>
          fs.existsSync(path.join(d, name + e)),
        ),
    );
// A yes or no given once is remembered, so a later run (an update) doesn't turn Codex back on
const answer = (name) =>
  opt(name) === "yes"
    ? true
    : opt(name) === "no"
      ? false
      : typeof state[name] === "boolean"
        ? state[name]
        : null;
for (const name of ["handy", "backup"]) {
  if (opt(name) !== null && !["yes", "no"].includes(opt(name))) {
    console.log(`--${name} ${opt(name)}: the answer is yes or no.`);
    process.exit(1);
  }
}
// nimbalyst: whether a rule that needs Nimbalyst is shipped (rules/conditions.json). Under --home the real
// Nimbalyst is not this home's: false unless the tests pass --nimbalyst yes (not stored)
ctx.have = {
  codex: answer("codex") ?? ctx.onPath("codex"),
  nimbalyst:
    opt("home") === null
      ? fs.existsSync(nimbalystHome(appDataDir()))
      : opt("nimbalyst") === "yes",
};

// state.files: each of the setup's own files as a run last wrote it, by full path. One that no longer
// matches was changed by the user, or was theirs before the first install, and stays unless asked for.
// A setup put in place before files were on record has none: there a file is replaced as it used to be.
ctx.userCopies = new Set(state.userCopies || []);
ctx.onRecord = !state.version || "files" in state;
ctx.filesWritten = { ...(state.files || {}) };
ctx.replaceAll = args.includes("--replace-all");
const replaceThese = args.flatMap((a, i) =>
  a === "--replace" && args[i + 1]
    ? [fwd(args[i + 1]).replace(/^~\/\.claude\//, "")]
    : [],
);
ctx.asked = (to) =>
  ctx.replaceAll ||
  replaceThese.some((r) => fwd(to) === r || fwd(to).endsWith("/" + r));
// A file as the lists at the end name it: from ~/.claude where it is inside, else by its full path
ctx.short = (to) =>
  fwd(to).startsWith(fwd(CLAUDE) + "/")
    ? fwd(to).slice(fwd(CLAUDE).length + 1)
    : fwd(to);
ctx.tally = {
  added: 0,
  same: 0,
  replaced: [],
  yours: [],
  backupDirs: new Set(),
};
// A command that runs this installer again with some flags, on the same home folder
ctx.selfRun = (flags) =>
  `node "${fwd(path.join(REPO, "install.mjs"))}" ${flags}${opt("home") !== null ? ` --home "${fwd(home)}"` : ""}`;
Object.assign(ctx, writers(ctx), fitter(REPO, ctx.PROJECTS, ctx.WIN));

// --theme-done: a chat set the Ink theme through Nimbalyst itself (it was open), so it is no longer pending
if (args.includes("--theme-done")) {
  if (!state.version) {
    console.log(
      `${fwd(stateFile)} has no install on record: run the install first.`,
    );
    process.exit(1);
  }
  ctx.putJson(stateFile, themeDone(state), JSON.stringify(state));
  console.log("theme: on record as done");
  process.exit(0);
}
ctx.withNames = (opt("with") || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
if (args.includes("--with") && !ctx.withNames.length) {
  console.log(
    `--with needs a name. The add-ons are: ${Object.keys(ADDONS).join(", ")}.`,
  );
  process.exit(1);
}
const badWith = ctx.withNames.filter((n) => !(n in ADDONS));
if (badWith.length) {
  console.log(
    `--with ${badWith.join(",")}: not an add-on. The add-ons are: ${Object.keys(ADDONS).join(", ")}.`,
  );
  process.exit(1);
}

// --leave-out / --put-back: a lead that names no shipped rule stops here, before anything is written
const leaveOut = leftOut(ctx, ctx.repoText("rules/CLAUDE.md"));
if (leaveOut.error) {
  console.log(leaveOut.error);
  process.exit(1);
}

// The copies older versions kept next to the files they replaced (and own-rules.mjs its tidy, undo and restore
// copies) move into setup-logs, and the records that name one (state.userCopies, the undo records, a restore's
// stacked ones too) follow them. The record is saved right after the moves, before anything else can stop the
// run, so it never names a copy that is no longer where it says (--uninstall and --undo read it). A dry run
// follows them only in memory, so --uninstall --dry-run still names what it would put back. Once a run has
// finished the moves, the record says so (state.oldCopiesMoved) and later runs don't search again.
const oldCopiesIn = [
  { dir: CLAUDE, deep: false },
  ...[...OWN_FOLDERS, "shared-skills", "rules"].map((d) => ({
    dir: path.join(CLAUDE, d),
    deep: true,
  })),
  ...ctx.HOMES.map((h) => ({ dir: path.join(ctx.PROJECTS, h), deep: true })),
  ...(opt("app-settings")
    ? [{ dir: path.dirname(path.resolve(opt("app-settings"))), deep: false }]
    : opt("home") === null
      ? [{ dir: nimbalystHome(appDataDir()), deep: false }]
      : []),
];
const movedCopies = state.oldCopiesMoved
  ? new Map()
  : moveOldCopies({ home, dirs: oldCopiesIn, DRY, say });
if (movedCopies.size) {
  const follow = (p) => movedCopies.get(fwd(p)) ?? p;
  ctx.userCopies = new Set([...ctx.userCopies].map(follow));
  const followUndo = (undo) => {
    for (const u of undo?.files || []) if (u.copy) u.copy = follow(u.copy);
    if (undo?.before) followUndo(undo.before);
  };
  followUndo(state.rulesUndo);
  followUndo(state.rulesUndoBefore);
  if (ctx.userCopies.size) state.userCopies = [...ctx.userCopies].sort();
  if (DRY) ctx.dryMoves = movedCopies;
  else if (fs.existsSync(stateFile))
    ctx.saveCopies({
      rulesUndo: state.rulesUndo,
      rulesUndoBefore: state.rulesUndoBefore,
    });
}
// SETUP_TEST_STOP_AFTER=moves|rules: the tests stop a run there, as a kill or a later failure would
const stopFor = (step) => {
  if (process.env.SETUP_TEST_STOP_AFTER === step)
    throw new Error(`stopped after the ${step} (test)`);
};
stopFor("moves");

if (args.includes("--uninstall")) {
  uninstall(ctx);
  process.exit(0);
}
// The Pro plan has no Fable: there the agents, skills and rules name Opus where they name Fable (scripts/model.mjs)
ctx.PRO = onProPlan(ctx);
if (ctx.PRO)
  say(
    "plan: Pro, which has no Fable, so the helpers and texts that name Fable get Opus instead",
  );

// The project pass level (version.json projectPass) goes into ~/.claude/project-pass.json, which
// skills/update-project/pass.mjs stamps and the update-check folder offer reads; the rest of that file is the pass's
// own. A first run starts it with mode on-open, so the folder offer is on without a question.
function passLevel() {
  const level = JSON.parse(
    fs.readFileSync(path.join(REPO, "version.json"), "utf8"),
  ).projectPass;
  if (!Number.isInteger(level))
    throw new Error(
      `${fwd(path.join(REPO, "version.json"))} has no whole-number projectPass`,
    );
  const file = path.join(CLAUDE, "project-pass.json");
  const had = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : null;
  if (had?.level === level || DRY) return;
  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        folders: {},
        declined: {},
        declinedAll: null,
        mode: "on-open",
        ...had,
        level,
      },
      null,
      2,
    ) + "\n",
  );
}

// --files-only: the setup's own files in ~/.claude and the record of them, nothing else and nothing asked
if (FILES_ONLY) {
  if (!state.version || !("files" in state)) {
    console.log(
      `${fwd(stateFile)} has no record of the files the setup wrote, so a changed one can't be told from the setup's: run the update with /update-setup.`,
    );
    process.exit(1);
  }
  claudeFiles(ctx);
  const filesState = {
    ...state,
    repo: REPO,
    version: ctx.version,
    files: ctx.filesWritten,
    oldCopiesMoved: true,
  };
  if (ctx.userCopies.size) filesState.userCopies = [...ctx.userCopies].sort();
  if (!DRY) ctx.putJson(stateFile, filesState, JSON.stringify(state));
  stateSaved = true;
  passLevel();
  if (ctx.tally.yours.length)
    say(
      `Kept as yours (you changed them, so they stay behind ${ctx.version}): ${ctx.tally.yours.join(", ")}`,
    );
  say(
    `Files of version ${ctx.version} in place: ${ctx.tally.added} added, ${ctx.tally.replaced.length} replaced, ${ctx.tally.same} unchanged.`,
  );
  process.exit(0);
}

// ---- 1. the files for ~/.claude, then its settings.json
const noGitBash = ctx.WIN && !gitBashFound(ctx.settings);
if (noGitBash) say(gitBashMissing(settingsFile));
claudeFiles(ctx);
const modelMark = claudeSettings(ctx);
// ---- 2. the global rules
ctx.rulesUndo = [];
const { marks } = rules(ctx);
stopFor("rules");
// ---- 3. the project folders: first what moves out of the retired ones, so their notes are the ones that stay
retiredHomes(ctx);
const written = projects(ctx);
// Remembered for later runs: the projects folder, the folder of this setup (a chat can find it again),
// its version, the answers about Codex, Node and the two opt-ins (Handy, the backup), and what the rules and
// notes files were written as.
// Written once, after the extensions and plugins below: a run that stops before then leaves the old record.
const nextState = {
  ...state,
  projects: ctx.PROJECTS,
  repo: REPO,
  version: ctx.version,
  ...marks,
  written,
  files: ctx.filesWritten,
  oldCopiesMoved: true,
};
if (modelMark) nextState.model = modelMark;
if (Object.keys(ctx.homeModel).length) nextState.homeModel = ctx.homeModel;
// what the carve changed, for own-rules.mjs --undo (already on disk, ctx.saveCopies, with this same time);
// a run that carved nothing keeps the last record
if (ctx.rulesUndo.length)
  nextState.rulesUndo = {
    at: (ctx.rulesUndoAt ??= new Date().toISOString()),
    by: "carve",
    files: ctx.rulesUndo,
  };
delete nextState.rulesOffered;
if (ctx.userCopies.size) nextState.userCopies = [...ctx.userCopies].sort();
// what an older version recorded about the outside workers is gone with them (scripts/claude-files.mjs: dropAgy)
delete nextState.agyAdded;
delete nextState.agy;
if (answer("codex") !== null) nextState.codex = answer("codex");
// the opt-ins: an answer given once is kept, a run without the flag keeps it, and none given stays none (asked once)
for (const name of ["handy", "backup"])
  if (answer(name) !== null) nextState[name] = answer(name);
if (nodeFile) nextState.node = nodeFile;
if (ctx.LANG) nextState.language = ctx.LANG;
for (const key of Object.keys(nextState))
  if (nextState[key] === undefined) delete nextState[key];
ctx.nextState = nextState;

const codexWhy = opt("codex")
  ? ""
  : answer("codex") !== null
    ? " (as answered before)"
    : ctx.onPath("codex")
      ? " (found on the PATH)"
      : " (not found on the PATH)";
say(
  `Codex CLI (GPT): ${ctx.have.codex ? "used" : "not used, optional"}${codexWhy}; it makes the pictures and runs the web sweeps in quick-tasks`,
);
// ---- 4. Nimbalyst: the extensions and the theme. --home is another home folder (the tests), where the real
// Nimbalyst is not the one to install into
ctx.appData = appDataDir();
ctx.extHome = nimbalystHome(ctx.appData);
ctx.wantExt =
  opt("extensions") === "no"
    ? false
    : opt("extensions") === "yes"
      ? true
      : opt("home") === null;
extensions(ctx);
// Board Tidy leaves quick-tasks alone: each chat there is its own task, and old ones are looked up again.
// Added once (state.boardTidyKeep), so a person who later says "tidy it again" keeps their choice.
if (!state.boardTidyKeep && !DRY) {
  const file = path.join(CLAUDE, "board-tidy.json");
  const conf = readJson(file);
  const folder = fwd(path.join(ctx.PROJECTS, "quick-tasks"));
  const keep = Array.isArray(conf.keep) ? conf.keep : [];
  if (!keep.some((k) => fwd(k).toLowerCase() === folder.toLowerCase())) {
    fs.writeFileSync(
      file,
      JSON.stringify({ ...conf, keep: [...keep, folder] }, null, 2) + "\n",
    );
    say(
      `Board Tidy leaves ${folder} alone (its old chats stay on the board); "tidy quick-tasks again" changes that`,
    );
  }
  nextState.boardTidyKeep = true;
}
theme(ctx);
// Nimbalyst's chats run the person's own Claude Code rather than the copy Nimbalyst bundles, so they get its fixes on
// the day they ship (scripts/claude-code-version.mjs: pointNimbalyst, with its safeguards). Not with --home.
if (opt("home") === null && ctx.appData) {
  const { set } = pointNimbalyst({
    file: path.join(ctx.extHome, "ai-settings.json"),
    min: ctx.claudeCodeMin,
    previous: state.nimbalystClaude || null,
    dry: DRY,
    log: say,
  });
  if (!DRY) {
    if (set) nextState.nimbalystClaude = set;
    else delete nextState.nimbalystClaude;
  }
}
// ---- 5. the plugins
plugins(ctx);
// ---- 6. Obscura, the headless browser tools/peek.mjs falls back on (pinned, SHA-256 checked; scripts/obscura.mjs)
await obscura(ctx);
// The record is written now: everything that can stop a run has run. It is compared with the record on disk,
// which may already hold this run's restore records (ctx.saveCopies), not with the one read at the start. A
// record this run made itself (a first install) gets no copy in setup-logs.
const onDisk = readJson(stateFile);
if (JSON.stringify(nextState) !== JSON.stringify(onDisk))
  ctx.putJson(stateFile, nextState, JSON.stringify(onDisk), {
    copy: Object.keys(state).length > 0,
  });
stateSaved = true;
passLevel();
report(ctx, { noGitBash });
