// Tests for scripts/app-settings.mjs on a temporary home folder and a made-up Handy settings file.
// Nothing outside that folder is touched. Run: node tests/test-app-settings.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/app-settings.mjs", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "app-settings-test-"));
const run = (home, ...flags) => {
  const r = spawnSync(process.execPath, [SCRIPT, "--home", home, ...flags], { encoding: "utf8" });
  return { code: r.status, out: r.stdout };
};
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const copies = (dir) => fs.readdirSync(dir).filter((n) => n.includes(".before-install-"));

// A blank home: the file is created, with the model and the rules
const blank = path.join(tmp, "blank");
const file = path.join(blank, ".claude", "settings.json");
ok("a dry run exits cleanly and writes nothing", [run(blank, "--dry-run").code, fs.existsSync(file)], [0, false]);
ok("the first run exits cleanly", run(blank).code, 0);
const first = json(file);
ok("the model is sonnet", first.model, "sonnet");
ok("the sign-in files and SSH keys are denied", ["Read(~/.claude/.credentials.json)", "Read(~/.ssh/**)"].every((r) => first.permissions.deny.includes(r)));
ok("a .env file is asked about", first.permissions.ask.includes("Read(//**/.env)"));
ok("PowerShell rules only on Windows", first.permissions.deny.some((r) => r.startsWith("PowerShell(")), process.platform === "win32");
const before = fs.readFileSync(file, "utf8");
const second = run(blank);
ok("a second run changes nothing", [second.out.includes("0 rule(s) added"), fs.readFileSync(file, "utf8") === before, copies(path.dirname(file))], [true, true, []]);

// A home with its own settings: they stay, and a dated copy of the old file is kept
const own = path.join(tmp, "own");
const ownFile = path.join(own, ".claude", "settings.json");
fs.mkdirSync(path.dirname(ownFile), { recursive: true });
fs.writeFileSync(ownFile, JSON.stringify({ model: "opus", permissions: { deny: ["Read(~/secret)"], allow: ["Bash(ls:*)"] }, hooks: { Stop: [] } }));
run(own);
const merged = json(ownFile);
ok("the user's model and own rules stay", [merged.model, merged.permissions.deny[0], merged.permissions.allow, merged.hooks], ["opus", "Read(~/secret)", ["Bash(ls:*)"], { Stop: [] }]);
ok("a dated copy of the old file is kept", copies(path.dirname(ownFile)).length, 1);

// Settings that are not valid JSON stop it
const broken = path.join(tmp, "broken");
fs.mkdirSync(path.join(broken, ".claude"), { recursive: true });
fs.writeFileSync(path.join(broken, ".claude", "settings.json"), "{ not json");
ok("settings that are not valid JSON stop it, unchanged", [run(broken).code, fs.readFileSync(path.join(broken, ".claude", "settings.json"), "utf8")], [1, "{ not json"]);

// Handy: only with --handy, only into a file that is there, and the user's other settings stay
const handy = path.join(tmp, "handy", "settings_store.json");
ok("no Handy file: said, nothing written", [run(blank, "--handy", "--handy-file", handy).out.includes("no settings file yet"), fs.existsSync(handy)], [true, false]);
fs.mkdirSync(path.dirname(handy), { recursive: true });
const store = { settings: { selected_microphone: "Some Mic", paste_method: "ctrl_v", custom_words: ["Kubernetes", "Claude"],
  bindings: { transcribe: { current_binding: "ctrl+space", default_binding: "ctrl+space", id: "transcribe" } } } };
fs.writeFileSync(handy, JSON.stringify(store));
run(blank);
ok("without --handy the file is left alone", json(handy), store);
run(blank, "--handy", "--handy-file", handy);
const h = json(handy).settings;
ok("Handy gets push to talk, direct typing and Right Alt", [h.shortcut_activation, h.paste_method, h.bindings.transcribe.current_binding], ["push_to_talk", "direct", "alt_right"]);
ok("the rest of Handy's settings stays", [h.selected_microphone, h.bindings.transcribe.default_binding], ["Some Mic", "ctrl+space"]);
ok("the words are added once, after the user's own", h.custom_words, ["Kubernetes", "Claude", "Nimbalyst", "Codex", "Gemini", "handoff"]);
ok("a dated copy of Handy's old file is kept", copies(path.dirname(handy)).length, 1);
const handyBefore = fs.readFileSync(handy, "utf8");
run(blank, "--handy", "--handy-file", handy);
ok("a second Handy run changes nothing", [fs.readFileSync(handy, "utf8") === handyBefore, copies(path.dirname(handy)).length], [true, 1]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
