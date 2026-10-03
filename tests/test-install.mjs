// Tests for install.mjs on a blank temporary home folder. Run: node tests/test-install.mjs
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
const install = (home, ...flags) => {
  const r = spawnSync(process.execPath, [INSTALL, "--home", home, ...flags], { encoding: "utf8" });
  return { code: r.status, out: r.stdout };
};
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const shipped = ["hooks", "agents", "skills"].flatMap((d) => walk(path.join(REPO, d))).map((f) => path.relative(REPO, f));
const example = JSON.parse(fs.readFileSync(path.join(REPO, "settings.example.json"), "utf8"));
const scripts = Object.values(example.hooks).flat().flatMap((g) => g.hooks).map((h) => h.command.match(/~\/\.claude\/(\S+)/)[1]);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "install-test-"));

// ---- dry run on a blank home folder
const home = path.join(tmp, "blank");
fs.mkdirSync(home);
const dry = install(home, "--dry-run");
ok("dry run exits cleanly", dry.code, 0);
ok("dry run lists every file it would copy", shipped.every((f) => dry.out.includes(f.replace(/\\/g, "/"))));
ok("dry run lists every hook it would wire", dry.out.split("\n").filter((l) => l.includes("hook added")).length, scripts.length);
ok("dry run changes nothing", fs.readdirSync(home), []);

// ---- the real install
const first = install(home);
const claude = path.join(home, ".claude");
ok("install exits cleanly", first.code, 0);
ok("every file arrived byte for byte",
  shipped.filter((f) => !fs.existsSync(path.join(claude, f)) || !fs.readFileSync(path.join(claude, f)).equals(fs.readFileSync(path.join(REPO, f)))), []);
const settings = JSON.parse(fs.readFileSync(path.join(claude, "settings.json"), "utf8"));
const commands = Object.values(settings.hooks).flat().flatMap((g) => g.hooks).map((h) => h.command);
ok("each hook is wired once", scripts.map((s) => commands.filter((c) => c.includes(path.basename(s))).length), scripts.map(() => 1));
ok("each command runs the installed copy by its full path",
  scripts.every((s) => commands.some((c) => c.startsWith(`node "${path.join(claude, s).replace(/\\/g, "/")}"`))));
for (const [event, groups] of Object.entries(example.hooks)) {
  for (const g of groups.filter((g) => g.matcher)) {
    const wired = settings.hooks[event].filter((x) => x.matcher === g.matcher).length;
    ok(`${event} hooks keep the matcher ${g.matcher}`, wired >= 1);
  }
}
ok("the handoff hook keeps its --hook argument", commands.some((c) => /handoff-brief\.mjs" --hook$/.test(c)));

// ---- a second run changes nothing
const before = walk(claude).map((f) => [f, fs.readFileSync(f, "utf8")]);
const second = install(home);
ok("second run exits cleanly", second.code, 0);
ok("second run copies nothing and wires nothing", /copied|replaced|hook added|wrote/.test(second.out), false);
ok("second run leaves every file as it was", walk(claude).map((f) => [f, fs.readFileSync(f, "utf8")]), before);

// ---- an existing setup keeps its own settings, and old copies are kept
const used = path.join(tmp, "used");
fs.mkdirSync(path.join(used, ".claude", "hooks"), { recursive: true });
const own = { model: "sonnet", hooks: { Stop: [{ hooks: [{ type: "command", command: "node my-own-hook.mjs" }] }] } };
fs.writeFileSync(path.join(used, ".claude", "settings.json"), JSON.stringify(own));
fs.writeFileSync(path.join(used, ".claude", "hooks", "sql-guard.mjs"), "// an older version\n");
ok("install on an existing setup exits cleanly", install(used).code, 0);
const merged = JSON.parse(fs.readFileSync(path.join(used, ".claude", "settings.json"), "utf8"));
ok("the user's own model and hook stay", [merged.model, JSON.stringify(merged.hooks.Stop).includes("my-own-hook.mjs")], ["sonnet", true]);
const kept = fs.readdirSync(path.join(used, ".claude")).concat(fs.readdirSync(path.join(used, ".claude", "hooks")))
  .filter((f) => f.includes(".before-install-")).map((f) => f.split(".before-install-")[0]).sort();
ok("the old settings and the old hook are kept as copies", kept, ["settings.json", "sql-guard.mjs"]);

// ---- broken settings are left alone
const broken = path.join(tmp, "broken");
fs.mkdirSync(path.join(broken, ".claude"), { recursive: true });
fs.writeFileSync(path.join(broken, ".claude", "settings.json"), "{ not json");
ok("settings that are not valid JSON stop the install", install(broken).code, 1);
ok("and nothing is changed or copied", [fs.readFileSync(path.join(broken, ".claude", "settings.json"), "utf8"), fs.readdirSync(path.join(broken, ".claude"))], ["{ not json", ["settings.json"]]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
