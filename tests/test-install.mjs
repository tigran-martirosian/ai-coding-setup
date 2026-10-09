// Tests for install.mjs on a blank temporary home folder. Nothing outside that folder is touched and
// no worker (Codex, Antigravity) has to be installed. Run: node tests/test-install.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = path.join(REPO, "install.mjs");
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-test-"));
// The installer looks for the workers on the PATH; the tests give it a PATH with nothing on it
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const installWith = (PATH, home, ...flags) => {
  const r = spawnSync(process.execPath, [INSTALL, "--home", home, ...flags], { encoding: "utf8", env: { ...process.env, PATH, Path: PATH } });
  return { code: r.status, out: r.stdout };
};
const install = (home, ...flags) => installWith(emptyPath, home, ...flags);
// Every real file under a folder; a link to a folder is not followed
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isSymbolicLink() ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const snap = (dir) => walk(dir).map((f) => [f, fs.readFileSync(f, "utf8")]);
const fwd = (p) => p.replace(/\\/g, "/");
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const commandsIn = (settings) => Object.values(settings.hooks || {}).flat().flatMap((g) => g.hooks).map((h) => h.command);
const copiesIn = (dir) => walk(dir).filter((f) => f.includes(".before-install-")).map((f) => path.basename(f).split(".before-install-")[0]).sort();
const shipped = ["hooks", "agents", "skills", "workers"].flatMap((d) => walk(path.join(REPO, d))).map((f) => path.relative(REPO, f));
const example = json(path.join(REPO, "settings.example.json"));
const scripts = Object.values(example.hooks).flat().flatMap((g) => g.hooks).map((h) => h.command.match(/~\/\.claude\/(\S+)/)[1]);
const HOMES = ["ask-anything", "claude-settings", "internet-search", "quick-tasks"];
const CHANGED = /copied|replaced|hook added|wrote|linked|removed/;

// ---- dry run on a blank home folder
const home = path.join(tmp, "blank");
fs.mkdirSync(home);
const claude = path.join(home, ".claude");
const projects = path.join(home, "Projects");
const dry = install(home, "--dry-run");
const globalHooks = (out) => out.split("\n").filter((l) => l.includes("hook added") && !/ in [\w-]+$/.test(l.trim()));
ok("dry run exits cleanly", dry.code, 0);
ok("dry run lists every file it would copy", shipped.every((f) => dry.out.includes(f.replace(/\\/g, "/"))));
ok("dry run lists every hook it would wire", globalHooks(dry.out).length, scripts.length);
ok("dry run lists the rules file", dry.out.includes(`rules: wrote ${fwd(path.join(claude, "CLAUDE.md"))} (workers: Claude alone)`));
ok("dry run lists the four project folders", HOMES.map((h) => dry.out.includes(`copied ${fwd(path.join(projects, h, "CLAUDE.md"))}`)), HOMES.map(() => true));
ok("dry run lists each folder's settings and the link gate's wiring",
  [...HOMES.map((h) => dry.out.includes(`wrote ${fwd(path.join(projects, h, ".claude", "settings.json"))}`)), dry.out.includes("hook added: Stop link-gate.mjs in internet-search")],
  [...HOMES.map(() => true), true]);
ok("dry run says how to build the extensions", /extensions are not installed by this script.*npm run build/.test(dry.out));
ok("dry run changes nothing", fs.readdirSync(home), []);

// ---- the real install
const first = install(home);
ok("install exits cleanly", first.code, 0);
// off Windows the installer takes Codex's Windows-only sandbox flag out of a shell script
const asInstalled = (f) => (f.endsWith(".sh") && process.platform !== "win32"
  ? Buffer.from(fs.readFileSync(path.join(REPO, f), "utf8").replace(` -c 'windows.sandbox="unelevated"'`, "")) : fs.readFileSync(path.join(REPO, f)));
ok("every file arrived byte for byte",
  shipped.filter((f) => !fs.existsSync(path.join(claude, f)) || !fs.readFileSync(path.join(claude, f)).equals(asInstalled(f))), []);
const settings = json(path.join(claude, "settings.json"));
const commands = commandsIn(settings);
const times = (list, s) => list.filter((x) => x.includes(path.basename(s))).length;
ok("each hook is wired as often as the example has it", scripts.map((s) => times(commands, s)), scripts.map((s) => times(scripts, s)));
ok("each command runs the installed copy by its full path",
  scripts.every((s) => commands.some((c) => c.startsWith(`node "${path.join(claude, s).replace(/\\/g, "/")}"`))));
for (const [event, groups] of Object.entries(example.hooks)) {
  for (const g of groups.filter((g) => g.matcher)) {
    const wired = settings.hooks[event].filter((x) => x.matcher === g.matcher).length;
    ok(`${event} hooks keep the matcher ${g.matcher}`, wired >= 1);
  }
}
ok("the handoff hook keeps its --hook argument", commands.some((c) => /handoff-brief\.mjs" --hook$/.test(c)));

// ---- the rules and the project folders, with no worker installed
const rules = () => fs.readFileSync(path.join(claude, "CLAUDE.md"), "utf8");
const text = (...p) => fs.readFileSync(path.join(projects, ...p), "utf8");
ok("the rules are written with the section for Claude alone",
  [rules().startsWith("# How to format replies"), rules().includes("## Gathering information on Claude alone"), rules().includes("## External workers first")], [true, true, false]);
ok("the rules keep the sections after the worker section", rules().includes("# Useful commands to suggest"));
ok("the rules name the real projects folder", [rules().includes("<projects>"), rules().includes(path.join(projects, "ask-anything"))], [false, true]);
ok("each project folder has its notes and its model",
  HOMES.map((h) => [fs.existsSync(path.join(projects, h, "CLAUDE.md")), text(h, "CLAUDE.md").includes("<projects>"), json(path.join(projects, h, ".claude", "settings.json")).model]),
  [[true, false, "opus"], [true, false, "opus"], [true, false, "opus"], [true, false, "sonnet"]]);
const expected = ["ask-anything/.claude/skills/read-web/SKILL.md", "claude-settings/.claude/skills/chat-review/SKILL.md", "claude-settings/.claude/skills/full-review/SKILL.md","claude-settings/HOW-TO.md",
  "internet-search/.claude/skills/finder/SKILL.md", "internet-search/.claude/hooks/link-gate.mjs", "internet-search/tools/peek.mjs",
  "internet-search/profile.md", "internet-search/finds/INDEX.md"];
ok("the skills, the link gate, the tools and the starter notes are there", expected.filter((f) => !fs.existsSync(path.join(projects, f))), []);
const gate = commandsIn(json(path.join(projects, "internet-search", ".claude", "settings.json")));
ok("the link gate is wired once, to the copy inside its folder", gate, [`node "${fwd(path.join(projects, "internet-search", ".claude", "hooks", "link-gate.mjs"))}"`]);
ok("without Codex the picture skill and its gate are left out",
  [fs.existsSync(path.join(claude, "hooks", "picture-gate.mjs")), fs.existsSync(path.join(projects, "quick-tasks", ".claude", "skills", "picture")),
    JSON.stringify(json(path.join(projects, "quick-tasks", ".claude", "settings.json"))).includes("picture-gate")], [false, false, false]);
ok("the notes say what a missing worker changes", [/## Workers on this computer\n\n- Codex is not set up/.test(text("ask-anything", "CLAUDE.md")), text("quick-tasks", "CLAUDE.md").includes("No generated pictures here")], [true, true]);
ok("the installer says one line for each thing it did", [first.out.includes(`copied ${fwd(path.join(projects, "internet-search", "profile.md"))}`), /Codex CLI \(GPT\): not used, optional \(not found on the PATH\)/.test(first.out)], [true, true]);

ok("setup-state.json records the projects folder and this repository folder as `repo`",
  [json(path.join(claude, "setup-state.json")).projects, path.resolve(json(path.join(claude, "setup-state.json")).repo)], [projects, path.resolve(REPO)]);

// ---- a second run changes nothing
const before = [...snap(claude), ...snap(projects)];
const second = install(home);
ok("second run exits cleanly", second.code, 0);
ok("second run copies nothing and wires nothing", CHANGED.test(second.out), false);
ok("second run leaves every file as it was", [...snap(claude), ...snap(projects)], before);

// ---- what the user wrote in the notes files stays, also when a worker is added
fs.writeFileSync(path.join(projects, "internet-search", "profile.md"), "# Profile for hunts\n\n- **Country:** somewhere\n");
fs.writeFileSync(path.join(projects, "ask-anything", "CLAUDE.md"), text("ask-anything", "CLAUDE.md").replace("# ask-anything", "# ask-anything\n\nMy own line."));
fs.writeFileSync(path.join(claude, "CLAUDE.md"), rules().replace("# How to work", "# How to work\n\n- My own rule."));
const withCodex = install(home, "--codex", "yes", "--agy", "no");
ok("install with Codex exits cleanly", withCodex.code, 0);
ok("the user's profile is kept as it is", text("internet-search", "profile.md"), "# Profile for hunts\n\n- **Country:** somewhere\n");
ok("only the worker section of the user's rules changes",
  [rules().includes("- My own rule."), rules().includes("## External workers first"), rules().includes("Claude alone"), rules().includes("~/.claude/workers/ask.mjs")], [true, true, false, true]);
ok("the installer says once that this version's rules differ from the user's", withCodex.out.includes("rules: new in this version, yours were kept"));
const inWorkers = (name) => fs.existsSync(path.join(claude, "workers", name));
ok("a worker that is not used is switched off for the worker command", [inWorkers("ask.mjs"), inWorkers("codex.off"), inWorkers("agy.off")], [true, false, true]);
ok("the user's own line stays and the note about Codex goes", [text("ask-anything", "CLAUDE.md").includes("My own line."), text("ask-anything", "CLAUDE.md").includes("Codex is not set up"),
  text("ask-anything", "CLAUDE.md").includes("Antigravity (Gemini) is not set up")], [true, false, true]);
ok("the changed files are kept as dated copies", [copiesIn(claude).includes("CLAUDE.md"), copiesIn(projects).includes("CLAUDE.md"), copiesIn(projects).includes("profile.md")], [true, true, false]);
const shared = path.join(claude, "shared-skills", "picture");
ok("with Codex the picture skill and its gate are installed", [fs.existsSync(path.join(shared, "picture.mjs")), fs.existsSync(path.join(claude, "hooks", "picture-gate.mjs"))], [true, true]);
for (const h of ["ask-anything", "quick-tasks"]) {
  const link = path.join(projects, h, ".claude", "skills", "picture");
  ok(`${h}: the picture skill is linked and is the shared one`,
    [fs.lstatSync(link).isSymbolicLink(), fs.readFileSync(path.join(link, "SKILL.md"), "utf8") === fs.readFileSync(path.join(shared, "SKILL.md"), "utf8")], [true, true]);
  const s = json(path.join(projects, h, ".claude", "settings.json"));
  const at = `node "${fwd(path.join(claude, "hooks", "picture-gate.mjs"))}"`;
  ok(`${h}: the gate is wired for display_to_user and Stop`,
    [s.hooks.PreToolUse.some((g) => g.matcher === "mcp__nimbalyst__display_to_user" && g.hooks[0].command === at), s.hooks.Stop.some((g) => g.hooks[0].command === at)], [true, true]);
}
ok("the other two folders get no picture gate", ["internet-search", "claude-settings"].map((h) => fs.readFileSync(path.join(projects, h, ".claude", "settings.json"), "utf8").includes("picture-gate")), [false, false]);
const beforeAgain = [...snap(claude), ...snap(projects)];
const again = install(home, "--codex", "yes", "--agy", "no");
ok("the next run doesn't say it again", again.out.includes("rules: new in this version"), false);
ok("a second run with Codex changes nothing", [CHANGED.test(again.out), JSON.stringify([...snap(claude), ...snap(projects)]) === JSON.stringify(beforeAgain)], [false, true]);

// ---- Codex taken away again: the link and the gate's wiring go, the shared files are not deleted through the link
ok("install without Codex again exits cleanly", install(home, "--codex", "no", "--agy", "no").code, 0);
ok("the links and the gate's wiring are gone", ["ask-anything", "quick-tasks"].map((h) =>
  [fs.existsSync(path.join(projects, h, ".claude", "skills", "picture")), fs.readFileSync(path.join(projects, h, ".claude", "settings.json"), "utf8").includes("picture-gate")]), [[false, false], [false, false]]);
ok("the shared skill's files are still there", fs.existsSync(path.join(shared, "SKILL.md")));
ok("the link gate's wiring stays", commandsIn(json(path.join(projects, "internet-search", ".claude", "settings.json"))).length, 1);

// ---- a worker on the PATH is found without a flag
const bin = path.join(tmp, "bin");
fs.mkdirSync(bin);
fs.writeFileSync(path.join(bin, "codex"), "");
const found = installWith(bin, path.join(tmp, "never-asked"), "--dry-run");
ok("codex on the PATH is found", [found.out.includes("Codex CLI (GPT): used (found on the PATH)"), found.out.includes("Codex only")], [true, true]);

ok("an answer given once wins over the PATH on a later run", installWith(bin, home, "--dry-run").out.includes("Codex CLI (GPT): not used, optional (as answered before)"));
ok("the answers, the version and Node are on record", (() => {
  const s = json(path.join(claude, "setup-state.json"));
  return [s.codex, s.agy, s.version === json(path.join(REPO, "version.json")).version, "node" in s];
})(), [false, false, true, false]);

// ---- an update: files the user never changed are replaced by the newer version's, changed ones stay
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
const upd = path.join(tmp, "upd");
install(upd);
const updState = path.join(upd, ".claude", "setup-state.json");
const updRules = path.join(upd, ".claude", "CLAUDE.md");
const updNotes = path.join(upd, "Projects", "quick-tasks", "CLAUDE.md");
const updHowTo = path.join(upd, "Projects", "claude-settings", "HOW-TO.md");
const mineNotes = path.join(upd, "Projects", "ask-anything", "CLAUDE.md");
// as if an older version had written these three files: other text, and on record as written
const s = json(updState);
fs.writeFileSync(updRules, "# Rules of an older version\n");
s.rules = sha("# Rules of an older version\n");
for (const f of [updNotes, updHowTo]) { fs.writeFileSync(f, "# Notes of an older version\n"); s.written[fwd(f)] = sha("# Notes of an older version\n"); }
fs.writeFileSync(updState, JSON.stringify(s));
fs.writeFileSync(mineNotes, "# ask-anything\n\nAll mine.\n");
const updated = install(upd);
ok("rules that are as an older version wrote them are replaced, with a dated copy",
  [fs.readFileSync(updRules, "utf8").startsWith("# How to format replies"), updated.out.includes(`rules: replaced ${fwd(updRules)}`), copiesIn(path.join(upd, ".claude")).includes("CLAUDE.md")], [true, true, true]);
ok("a folder's notes and the how-to that are as written are replaced too",
  [fs.readFileSync(updNotes, "utf8").startsWith("# quick-tasks"), fs.readFileSync(updHowTo, "utf8").includes("Notes of an older version")], [true, false]);
ok("notes the user changed stay", fs.readFileSync(mineNotes, "utf8").startsWith("# ask-anything\n\nAll mine.\n"));
ok("the run after the update changes nothing", CHANGED.test(install(upd).out), false);

// ---- an existing setup keeps its own settings and rules, and old copies are kept
const used = path.join(tmp, "used");
fs.mkdirSync(path.join(used, ".claude", "hooks"), { recursive: true });
const own = { model: "sonnet", hooks: { Stop: [{ hooks: [{ type: "command", command: "node my-own-hook.mjs" }] }] } };
fs.writeFileSync(path.join(used, ".claude", "settings.json"), JSON.stringify(own));
fs.writeFileSync(path.join(used, ".claude", "hooks", "sql-guard.mjs"), "// an older version\n");
fs.writeFileSync(path.join(used, ".claude", "CLAUDE.md"), "# My rules\n\n- Mine.\n");
const elsewhere = path.join(tmp, "work");
const onUsed = install(used, "--projects", elsewhere);
ok("install on an existing setup exits cleanly", onUsed.code, 0);
const merged = json(path.join(used, ".claude", "settings.json"));
ok("the user's own model and hook stay", [merged.model, JSON.stringify(merged.hooks.Stop).includes("my-own-hook.mjs")], ["sonnet", true]);
const kept = fs.readdirSync(path.join(used, ".claude")).concat(fs.readdirSync(path.join(used, ".claude", "hooks")))
  .filter((f) => f.includes(".before-install-")).map((f) => f.split(".before-install-")[0]).sort();
ok("the old settings are kept as a copy", kept, ["settings.json"]);
const usedHook = path.join(used, ".claude", "hooks", "sql-guard.mjs");
ok("a file that was there before under the same name stays, and the run lists it with the way to take the setup's",
  [fs.readFileSync(usedHook, "utf8"), onUsed.out.includes(`kept yours ${fwd(usedHook)}`), /Kept as yours[^\n]*\n  hooks\/sql-guard\.mjs\n[^\n]*--replace <name>[^\n]*--replace-all/.test(onUsed.out)],
  ["// an older version\n", true, true]);
const logs = () => fs.readdirSync(path.join(used, ".claude", "setup-logs"));
ok("a run that changed something saves what it printed", [logs().length, fs.readFileSync(path.join(used, ".claude", "setup-logs", logs()[0]), "utf8").includes(`kept yours ${fwd(usedHook)}`)], [1, true]);
ok("rules with other content are left alone, and the installer says so",
  [fs.readFileSync(path.join(used, ".claude", "CLAUDE.md"), "utf8"), /rules: left alone.*--replace-rules/.test(onUsed.out)], ["# My rules\n\n- Mine.\n", true]);
ok("--projects puts the folders where it says", [HOMES.every((h) => fs.existsSync(path.join(elsewhere, h, "CLAUDE.md"))), fs.existsSync(path.join(used, "Projects"))], [true, false]);
const replaced = install(used, "--replace-rules");
const usedFiles = fs.readdirSync(path.join(used, ".claude"));
const oldRules = usedFiles.find((f) => f.startsWith("CLAUDE.md.before-install-"));
ok("--replace-rules takes the new rules and keeps the old ones as a dated copy",
  [fs.readFileSync(path.join(used, ".claude", "CLAUDE.md"), "utf8").startsWith("# How to format replies"), oldRules && fs.readFileSync(path.join(used, ".claude", oldRules), "utf8")], [true, "# My rules\n\n- Mine.\n"]);
ok("a later run without --projects uses the folder given before", [replaced.out.includes(fwd(path.join(elsewhere, "quick-tasks"))), fs.existsSync(path.join(used, "Projects"))], [true, false]);
ok("the file of the user's still stays on a later run", fs.readFileSync(usedHook, "utf8"), "// an older version\n");
const oneTaken = install(used, "--replace", "hooks/sql-guard.mjs");
const hookCopy = fs.readdirSync(path.join(used, ".claude", "hooks")).find((f) => f.startsWith("sql-guard.mjs.before-install-"));
ok("--replace takes the setup's version of that one file and keeps the user's as a dated copy",
  [fs.readFileSync(usedHook).equals(fs.readFileSync(path.join(REPO, "hooks", "sql-guard.mjs"))), hookCopy && fs.readFileSync(path.join(used, ".claude", "hooks", hookCopy), "utf8"),
    /Replaced[^\n]*\n  hooks\/sql-guard\.mjs\n/.test(oneTaken.out)], [true, "// an older version\n", true]);

// ---- a file of the setup's that the user changed after the install stays, also in a project folder
const usedSkill = path.join(used, ".claude", "skills", "handoff", "SKILL.md");
const usedTool = path.join(elsewhere, "internet-search", "tools", "peek.mjs");
for (const f of [usedHook, usedSkill, usedTool]) fs.appendFileSync(f, "\n// my own change\n");
fs.writeFileSync(path.join(used, ".claude", "CLAUDE.md"), "# My rules again\n");
const usedBefore = [...snap(path.join(used, ".claude")), ...snap(elsewhere)];
const keptMine = install(used);
ok("the changed files stay and the run changes nothing",
  [JSON.stringify([...snap(path.join(used, ".claude")), ...snap(elsewhere)]) === JSON.stringify(usedBefore), CHANGED.test(keptMine.out),
    ["hooks/sql-guard.mjs", "skills/handoff/SKILL.md", fwd(usedTool)].every((f) => keptMine.out.includes(`\n  ${f}\n`)), keptMine.out.includes("Files: 3 kept as yours")],
  [true, false, true, true]);
install(used, "--replace-all");
ok("--replace-all takes the setup's version of every one of them, and the rules",
  [[usedHook, usedSkill, usedTool].map((f) => fs.readFileSync(f, "utf8").includes("my own change")), fs.readFileSync(path.join(used, ".claude", "CLAUDE.md"), "utf8").startsWith("# How to format replies")],
  [[false, false, false], true]);
ok("the run after it has nothing left to keep", install(used).out.includes("kept yours"), false);

// ---- a setup installed before files were on record: a file that differs is replaced once, with a copy
const usedState = path.join(used, ".claude", "setup-state.json");
const old = json(usedState);
delete old.files;
fs.writeFileSync(usedState, JSON.stringify(old));
fs.writeFileSync(usedSkill, "# The skill of an older version\n");
const fromOld = install(used);
ok("with no record an older file is replaced, and from then on the files are on record",
  [fromOld.out.includes(`replaced ${fwd(usedSkill)}`), fs.readFileSync(usedSkill, "utf8").includes("older version"), fwd(usedSkill) in json(usedState).files], [true, false, true]);

// ---- a hook in the settings whose script is gone is named
const gone = fwd(path.join(used, ".claude", "hooks", "gone.mjs"));
const withGone = json(path.join(used, ".claude", "settings.json"));
withGone.hooks.Stop.push({ hooks: [{ type: "command", command: `node "${gone}"` }] });
fs.writeFileSync(path.join(used, ".claude", "settings.json"), JSON.stringify(withGone));
ok("a wired hook whose script is not there is listed", install(used).out.includes(`\n  Stop: ${gone}\n`));

// ---- a hook of the setup's that an older copy wired from another place in ~/.claude is pointed at the installed one
const moved = path.join(tmp, "moved");
fs.mkdirSync(path.join(moved, ".claude", "skills", "handoff"), { recursive: true });
const oldBrief = fwd(path.join(moved, ".claude", "skills", "handoff", "handoff-brief.mjs"));
fs.writeFileSync(oldBrief, "// old\n");
const briefEvent = Object.keys(example.hooks).find((e) => JSON.stringify(example.hooks[e]).includes("handoff-brief.mjs"));
fs.writeFileSync(path.join(moved, ".claude", "settings.json"), JSON.stringify({ hooks: { [briefEvent]: [{ hooks: [
  { type: "command", command: `"node.exe" "${oldBrief}" --hook` }, { type: "command", command: "node /elsewhere/context-guard.mjs" }] }] } }));
const movedRun = install(moved);
const movedCmds = commandsIn(json(path.join(moved, ".claude", "settings.json")));
ok("a hook wired from an older place in ~/.claude is pointed at the installed copy, and a script elsewhere is left alone",
  [movedCmds.filter((c) => c.includes("handoff-brief.mjs")), movedCmds.includes("node /elsewhere/context-guard.mjs"), movedRun.out.includes(`hook repointed: ${briefEvent} handoff-brief.mjs`)],
  [[`node "${fwd(path.join(moved, ".claude", "hooks", "handoff-brief.mjs"))}" --hook`], true, true]);
ok("the run after it repoints nothing", install(moved).out.includes("hook repointed"), false);

// ---- with Nimbalyst there, the run builds an extension and puts it into Nimbalyst's folder
if (process.platform === "win32") {
  const themeDist = path.join(REPO, "extensions", "ink-themes", "dist");
  const hadDist = fs.existsSync(themeDist);
  const appData = path.join(tmp, "appdata");
  fs.mkdirSync(path.join(appData, "@nimbalyst", "electron"), { recursive: true });
  const withExt = () => spawnSync(process.execPath, [INSTALL, "--home", path.join(tmp, "ext-home"), "--extensions", "yes"],
    { encoding: "utf8", env: { ...process.env, PATH: emptyPath, Path: emptyPath, APPDATA: appData, SETUP_EXTENSIONS: "ink-themes" } }).stdout;
  ok("the theme extension is built and installed", [withExt().includes("extension installed: ink-themes"), fs.existsSync(path.join(appData, "@nimbalyst", "electron", "extensions", "inktheme", "manifest.json"))], [true, true]);
  ok("the next run leaves it alone", withExt().includes("extension unchanged: ink-themes"));
  ok("--extensions no leaves the extensions out", install(path.join(tmp, "ext-home"), "--extensions", "no").out.includes("extensions are not installed by this script"));
  // the build writes its output next to the source; a folder this test made goes again
  if (!hadDist) fs.rmSync(themeDist, { recursive: true, force: true });
}

// ---- Claude Code's own settings: a model when none is set, the permission rules, and a set model stays
ok("a blank home gets a model and the permission rules", [settings.model, settings.permissions.deny.includes("Read(~/.ssh/**)"), settings.permissions.ask.includes("Read(//**/.env)")], ["sonnet", true, true]);
ok("a model that was set stays, next to the rules", [merged.model, merged.permissions.deny.length > 0], ["sonnet", true]);

// ---- the plugins, with a stand-in for the claude command that keeps a list of what it was told
const fake = path.join(tmp, "fake-claude");
fs.mkdirSync(fake);
const told = path.join(fake, "told.txt");
fs.writeFileSync(path.join(fake, "claude.mjs"), `import fs from "node:fs";
const a = process.argv.slice(2).join(" ");
fs.appendFileSync(${JSON.stringify(told)}, a + "\\n");
if (a === "plugin list") console.log("Installed plugins:\\n  > superpowers@claude-plugins-official");
if (a === "plugin install context7@claude-plugins-official") { console.error("no network"); process.exit(1); }
`);
fs.writeFileSync(path.join(fake, "claude.cmd"), `@"${process.execPath}" "%~dp0claude.mjs" %*\r\n`);
fs.writeFileSync(path.join(fake, "claude"), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/claude.mjs" "$@"\n`, { mode: 0o755 });
fs.writeFileSync(path.join(fake, "git"), "");
const plugHome = path.join(tmp, "plug-home");
const shellPath = process.platform === "win32" ? `${fake}${path.delimiter}${path.join(process.env.SystemRoot || "C:\\Windows", "System32")}` : `${fake}${path.delimiter}/bin${path.delimiter}/usr/bin`;
const plug = installWith(shellPath, plugHome, "--plugins", "yes");
const toldLines = () => fs.readFileSync(told, "utf8").trim().split("\n");
ok("a missing plugin is installed, and the three that load everywhere are switched off",
  [plug.out.includes("plugin installed: claude-hud@claude-hud\n"), plug.out.includes("plugin installed: claude-code-setup@claude-plugins-official (switched off"),
    toldLines().includes("plugin disable claude-code-setup@claude-plugins-official"), toldLines().includes("plugin disable claude-hud@claude-hud")], [true, true, true, false]);
ok("one that is there already is left as it is", [plug.out.includes("plugin already there: superpowers@claude-plugins-official"), toldLines().some((l) => l.includes("install superpowers"))], [true, false]);
ok("one that fails is named and the install goes on", [/plugin failed: context7@claude-plugins-official \(no network\)/.test(plug.out), plug.code], [true, 0]);
ok("what was handled is on record", json(path.join(plugHome, ".claude", "setup-state.json")).plugins, ["claude-hud@claude-hud", "claude-code-setup@claude-plugins-official", "superpowers@claude-plugins-official"]);
fs.writeFileSync(told, "");
installWith(shellPath, plugHome, "--plugins", "yes");
ok("the next run only retries the one that failed", toldLines().filter((l) => l.startsWith("plugin install")), ["plugin install context7@claude-plugins-official"]);
ok("without the claude command the run says so", installWith(emptyPath, path.join(tmp, "no-claude"), "--plugins", "yes").out.includes("plugins not installed: the claude command is not on the PATH"));

// ---- the steps left for a chat are named until one is put on record as done
ok("the run names the steps left for a chat", /Left for a chat, once.*steps 8 and 9.*--done chat-steps/.test(plug.out));
const marked = install(plugHome, "--done", "chat-steps");
ok("--done puts them on record and changes nothing else", [marked.out.trim(), json(path.join(plugHome, ".claude", "setup-state.json")).done], ["on record as done: chat-steps", ["chat-steps"]]);
ok("and the next run no longer names them", install(plugHome).out.includes("Left for a chat"), false);

// ---- broken settings are left alone
const broken = path.join(tmp, "broken");
fs.mkdirSync(path.join(broken, ".claude"), { recursive: true });
fs.writeFileSync(path.join(broken, ".claude", "settings.json"), "{ not json");
ok("settings that are not valid JSON stop the install", install(broken).code, 1);
ok("and nothing is changed or copied", [fs.readFileSync(path.join(broken, ".claude", "settings.json"), "utf8"), fs.readdirSync(path.join(broken, ".claude"))], ["{ not json", ["settings.json"]]);
const brokenHome = path.join(tmp, "broken-home");
fs.mkdirSync(path.join(brokenHome, "Projects", "quick-tasks", ".claude"), { recursive: true });
fs.writeFileSync(path.join(brokenHome, "Projects", "quick-tasks", ".claude", "settings.json"), "{ not json");
ok("a project folder's settings that are not valid JSON stop it too, before anything is copied", [install(brokenHome).code, fs.existsSync(path.join(brokenHome, ".claude"))], [1, false]);

// --node: the hooks are started with the Node given, by its full path
const nodeHome = path.join(tmp, "node-home");
install(nodeHome, "--node", process.execPath);
const withNode = [json(path.join(nodeHome, ".claude", "settings.json")), json(path.join(nodeHome, "Projects", "internet-search", ".claude", "settings.json"))].flatMap(commandsIn);
ok("--node starts every hook with that Node", withNode.filter((c) => !c.startsWith(`"${fwd(process.execPath)}" "`)), []);

ok("--node is remembered for later runs", json(path.join(nodeHome, ".claude", "setup-state.json")).node, fwd(process.execPath));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
