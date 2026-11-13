// Tests for install.mjs --uninstall on a blank temporary home folder. Nothing outside that folder is
// touched and no worker (Codex, Antigravity) has to be installed. Run: node tests/test-uninstall.mjs
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uninstall-test-"));
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const run = (home, ...flags) => {
  const r = spawnSync(process.execPath, [INSTALL, "--home", home, ...flags], { encoding: "utf8", env: { ...process.env, PATH: emptyPath, Path: emptyPath } });
  return { code: r.status, out: r.stdout };
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isSymbolicLink() ? [] : e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const snap = (dir) => walk(dir).map((f) => [f, fs.readFileSync(f, "utf8")]);
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const commandsIn = (settings) => Object.values(settings.hooks || {}).flat().flatMap((g) => g.hooks).map((h) => h.command);
const shipped = ["hooks", "agents", "skills", "workers"].flatMap((d) => walk(path.join(REPO, d))).map((f) => path.relative(REPO, f));
const example = json(path.join(REPO, "settings.example.json"));
const scripts = Object.values(example.hooks).flat().flatMap((g) => g.hooks).map((h) => h.command.match(/~\/\.claude\/(\S+)/)[1]);

// ---- a home with the person's own hook, setting, hook file and a file under a setup name
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
const projects = path.join(home, "Projects");
fs.mkdirSync(path.join(claude, "hooks"), { recursive: true });
const ownCommand = "node /my/own-hook.mjs";
fs.writeFileSync(path.join(claude, "settings.json"), JSON.stringify({ theme: "dark", hooks: { Stop: [{ hooks: [{ type: "command", command: ownCommand }] }] } }));
fs.writeFileSync(path.join(claude, "hooks", "my-own.mjs"), "// mine\n");
const restored = path.normalize(scripts[0]);
const changed = shipped.find((f) => f.startsWith("skills") && f !== restored);
const mineBefore = "// my version of a setup hook\n";
fs.mkdirSync(path.dirname(path.join(claude, restored)), { recursive: true });
fs.writeFileSync(path.join(claude, restored), mineBefore);

ok("install (taking the setup's version of one file of the person's) exits cleanly", run(home, "--replace", restored).code, 0);
ok("a dated copy of the person's file was made", fs.readdirSync(path.dirname(path.join(claude, restored))).some((n) => n.startsWith(path.basename(restored) + ".before-install-")));
ok("the setup's hooks are wired", commandsIn(json(path.join(claude, "settings.json"))).length > 1);
fs.appendFileSync(path.join(claude, changed), "\n// edited by the person\n");
const installed = snap(home);

// ---- dry run: prints, changes nothing
const dry = run(home, "--uninstall", "--dry-run");
ok("dry run exits cleanly", dry.code, 0);
ok("dry run changes nothing", JSON.stringify(snap(home)), JSON.stringify(installed));
ok("dry run ends with what was kept", dry.out.includes("Kept, not touched:") && dry.out.includes("Nothing was changed."));

// ---- the real uninstall
const un = run(home, "--uninstall");
ok("uninstall exits cleanly", un.code, 0);
const left = json(path.join(claude, "settings.json"));
ok("the person's setting stays", left.theme, "dark");
ok("only the person's hook is still wired", commandsIn(left), [ownCommand]);
ok("the person's own hook file stays", fs.existsSync(path.join(claude, "hooks", "my-own.mjs")));
ok("the setup's files are gone, except the changed one and the restored one",
  shipped.filter((f) => ![changed, restored].includes(f)).every((f) => !fs.existsSync(path.join(claude, f))));
ok("the .before-install copy is back under its name", fs.readFileSync(path.join(claude, restored), "utf8"), mineBefore);
ok("no copy of it is left over", fs.readdirSync(path.dirname(path.join(claude, restored))).some((n) => n.startsWith(path.basename(restored) + ".before-install-")), false);
ok("the changed setup file stays, as changed", fs.readFileSync(path.join(claude, changed), "utf8").includes("edited by the person"));
ok("the run lists the changed file as kept", un.out.includes(changed.replace(/\\/g, "/")) && un.out.includes("it differs from what the setup wrote"));
ok("the record of the install is gone", fs.existsSync(path.join(claude, "setup-state.json")), false);
ok("the project folders are left alone and the run says so",
  fs.existsSync(path.join(projects, "ask-anything", "CLAUDE.md")) && un.out.includes("your files in the project folders"));
ok("a second uninstall says there is nothing recorded", run(home, "--uninstall").code, 1);

// ---- 1. an update replaces the setup's OWN older files: their copies are not the person's and don't come back
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const home2 = path.join(tmp, "home2");
const claude2 = path.join(home2, ".claude");
const userHook = path.join(claude2, restored);
fs.mkdirSync(path.dirname(userHook), { recursive: true });
fs.writeFileSync(userHook, mineBefore);
ok("home2: install exits cleanly", run(home2, "--replace", restored).code, 0);
// make three installed files look as an older release wrote them: a hook, a skill file and the rules
const stateFile2 = path.join(claude2, "setup-state.json");
const st2 = json(stateFile2);
const oldHook = scripts.map((s) => path.normalize(s)).find((s) => s !== restored);
const oldSkill = shipped.find((f) => f.startsWith("skills") && f !== oldHook);
const OLD = "// an older release of the setup wrote this\n";
for (const rel of [oldHook, oldSkill]) {
  fs.writeFileSync(path.join(claude2, rel), OLD);
  const key = Object.keys(st2.files).find((k) => k.endsWith("/" + rel.replace(/\\/g, "/")));
  st2.files[key] = sha(OLD);
}
const OLD_RULES = "# older rules\n";
fs.writeFileSync(path.join(claude2, "CLAUDE.md"), OLD_RULES);
st2.rules = sha(OLD_RULES);
fs.writeFileSync(stateFile2, JSON.stringify(st2, null, 2));
ok("home2: the update exits cleanly", run(home2).code, 0);
const copiesOf = (dir, name) => fs.readdirSync(dir).filter((n) => n.startsWith(name + ".before-install-"));
ok("home2: the update made copies of the old setup files",
  copiesOf(path.dirname(path.join(claude2, oldHook)), path.basename(oldHook)).length === 1 && copiesOf(claude2, "CLAUDE.md").length === 1);
const un2 = run(home2, "--uninstall");
ok("home2: uninstall exits cleanly", un2.code, 0);
ok("home2: the old hook, skill file and rules did not come back",
  [oldHook, oldSkill, "CLAUDE.md"].every((f) => !fs.existsSync(path.join(claude2, f))));
ok("home2: no file holds an older setup version", walk(claude2).every((f) => !fs.readFileSync(f, "utf8").includes("an older release of the setup") || /before-install/.test(f)));
ok("home2: the person's own file replaced by the first install does come back", fs.readFileSync(userHook, "utf8"), mineBefore);
ok("home2: the old copies are listed as kept", un2.out.includes("no record that it is yours"));

// ---- 2. with Codex the picture gate is wired in the project settings and linked in: uninstall takes those out
const home3 = path.join(tmp, "home3");
ok("home3: install with Codex exits cleanly", run(home3, "--codex", "yes").code, 0);
const aaSettings = path.join(home3, "Projects", "ask-anything", ".claude", "settings.json");
const aaLink = path.join(home3, "Projects", "ask-anything", ".claude", "skills", "picture");
ok("home3: the picture gate is wired and the skill linked", fs.readFileSync(aaSettings, "utf8").includes("picture-gate.mjs") && !!fs.lstatSync(aaLink, { throwIfNoEntry: false }));
ok("home3: uninstall exits cleanly", run(home3, "--uninstall").code, 0);
ok("home3: no project settings run a missing script",
  ["ask-anything", "quick-tasks"].every((p) => !fs.readFileSync(path.join(home3, "Projects", p, ".claude", "settings.json"), "utf8").includes(".claude/hooks/")));
ok("home3: the junction is gone", !!fs.lstatSync(aaLink, { throwIfNoEntry: false }), false);
ok("home3: the gate script is gone and the project's own files stay",
  !fs.existsSync(path.join(home3, ".claude", "hooks", "picture-gate.mjs")) && fs.existsSync(path.join(home3, "Projects", "ask-anything", "CLAUDE.md")));

// ---- 4. a record without a list of files (older setup): stop before changing anything
const home4 = path.join(tmp, "home4");
const claude4 = path.join(home4, ".claude");
fs.mkdirSync(path.join(claude4, "hooks"), { recursive: true });
fs.writeFileSync(path.join(claude4, "setup-state.json"), JSON.stringify({ version: "0.0.1" }));
fs.writeFileSync(path.join(claude4, "hooks", scripts[0].replace(/^hooks\//, "")), "// a hook\n");
fs.writeFileSync(path.join(claude4, "settings.json"), JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `node "${path.join(claude4, scripts[0]).replace(/\\/g, "/")}"` }] }] } }));
const before4 = JSON.stringify(snap(home4));
const un4 = run(home4, "--uninstall");
ok("home4: uninstall without a file record exits 1", un4.code, 1);
ok("home4: nothing was changed", JSON.stringify(snap(home4)), before4);
ok("home4: it says to run the update first", un4.out.includes("Run the update first"));
ok("home4: a second run says the same", run(home4, "--uninstall").code, 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
