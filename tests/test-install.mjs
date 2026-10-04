// Tests for install.mjs on a blank temporary home folder. Nothing outside that folder is touched and
// no worker (Codex, Antigravity) has to be installed. Run: node tests/test-install.mjs
import { spawnSync } from "node:child_process";
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
ok("every file arrived byte for byte",
  shipped.filter((f) => !fs.existsSync(path.join(claude, f)) || !fs.readFileSync(path.join(claude, f)).equals(fs.readFileSync(path.join(REPO, f)))), []);
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
const expected = ["ask-anything/.claude/skills/read-web/SKILL.md", "claude-settings/.claude/skills/chat-review/SKILL.md", "claude-settings/HOW-TO.md",
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
  [rules().includes("- My own rule."), rules().includes("## External workers first"), rules().includes("Claude alone"), /agy -p/.test(rules())], [true, true, false, false]);
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
const found = installWith(bin, home, "--dry-run");
ok("codex on the PATH is found", [found.out.includes("Codex CLI (GPT): used (found on the PATH)"), found.out.includes("Codex only")], [true, true]);

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
ok("the old settings and the old hook are kept as copies", kept, ["settings.json", "sql-guard.mjs"]);
ok("rules with other content are left alone, and the installer says so",
  [fs.readFileSync(path.join(used, ".claude", "CLAUDE.md"), "utf8"), /rules: left alone.*--replace-rules/.test(onUsed.out)], ["# My rules\n\n- Mine.\n", true]);
ok("--projects puts the folders where it says", [HOMES.every((h) => fs.existsSync(path.join(elsewhere, h, "CLAUDE.md"))), fs.existsSync(path.join(used, "Projects"))], [true, false]);
const replaced = install(used, "--replace-rules");
const usedFiles = fs.readdirSync(path.join(used, ".claude"));
const oldRules = usedFiles.find((f) => f.startsWith("CLAUDE.md.before-install-"));
ok("--replace-rules takes the new rules and keeps the old ones as a dated copy",
  [fs.readFileSync(path.join(used, ".claude", "CLAUDE.md"), "utf8").startsWith("# How to format replies"), oldRules && fs.readFileSync(path.join(used, ".claude", oldRules), "utf8")], [true, "# My rules\n\n- Mine.\n"]);
ok("a later run without --projects uses the folder given before", [replaced.out.includes(fwd(path.join(elsewhere, "quick-tasks"))), fs.existsSync(path.join(used, "Projects"))], [true, false]);

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

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
