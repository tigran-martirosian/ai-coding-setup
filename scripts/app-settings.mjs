#!/usr/bin/env node
// The settings of the full install that are not files of this repository (docs/full-install.md).
// Safe to run again: it adds what is missing and a second run changes nothing. A file that is changed
// is kept next to the new one as <name>.before-install-<date>.
//   node scripts/app-settings.mjs            Claude Code, ~/.claude/settings.json: "model": "sonnet" when no
//                                            model is set, and permission rules (the agent can't read the
//                                            saved sign-ins or the SSH keys, and asks before a .env file)
//   node scripts/app-settings.mjs --handy    the same, and Handy's settings for voice typing (Windows;
//                                            quit Handy first, it writes its file when it closes)
//   --dry-run                                print what it would do and change nothing
//   --home <folder>                          use <folder>/.claude instead of the home folder's
//   --handy-file <file>                      Handy's settings file, when it is somewhere else
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const opt = (name) => (args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] || "" : null);
const DRY = args.includes("--dry-run");
const WIN = process.platform === "win32";
const home = opt("home") !== null ? path.resolve(opt("home") || ".") : os.homedir();
const fwd = (p) => p.replace(/\\/g, "/");
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const say = (s) => console.log((DRY ? "[dry run] " : "") + s);

function read(file) {
  if (!fs.existsSync(file)) return {};
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch {
    console.log(`${fwd(file)} is not valid JSON; nothing was changed. Fix it and run this again.`);
    process.exit(1);
  }
}
// Writes the file when the merge changed it; the file as it was is kept as a dated copy (-2, -3 on the same day)
function write(file, data, was) {
  if (JSON.stringify(data) === was) return say(`unchanged ${fwd(file)}`);
  let copy = null;
  if (fs.existsSync(file)) {
    copy = `${file}.before-install-${today}`;
    for (let n = 2; fs.existsSync(copy); n++) copy = `${file}.before-install-${today}-${n}`;
    if (!DRY) fs.copyFileSync(file, copy);
  }
  if (!DRY) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  }
  say(`wrote ${fwd(file)}${copy ? ` (old copy: ${path.basename(copy)})` : ""}`);
}

// ---- Claude Code
const DENY = [
  "Read(~/.claude/.credentials.json)", "Read(~/.codex/auth.json)", "Read(~/.gemini/oauth_creds.json)",
  "Read(~/.gemini/google_accounts.json)", "Read(~/.ssh/**)",
  "Bash(*.credentials.json*)", "Bash(*.codex/auth.json*)", "Bash(*oauth_creds.json*)", "Bash(*.ssh/*)",
  "PowerShell(*.credentials.json*)", "PowerShell(*.codex/auth.json*)", "PowerShell(*.codex\\auth.json*)",
  "PowerShell(*oauth_creds.json*)", "PowerShell(*.ssh/*)", "PowerShell(*.ssh\\*)",
];
const ASK = [
  "Read(//**/.env)", "Read(//**/.env.*)", "Bash(* .env*)", "Bash(*/.env*)",
  "PowerShell(* .env*)", "PowerShell(*/.env*)", "PowerShell(*\\.env*)",
];
const forThisSystem = (rules) => rules.filter((r) => WIN || !r.startsWith("PowerShell("));

const settingsFile = path.join(home, ".claude", "settings.json");
const settings = read(settingsFile);
const settingsWas = JSON.stringify(settings);
if (!settings.model) { settings.model = "sonnet"; say(`model: set to sonnet (none was set)`); }
else say(`model: left as it is (${settings.model})`);
let added = 0;
for (const [kind, rules] of [["deny", DENY], ["ask", ASK]]) {
  const list = ((settings.permissions ??= {})[kind] ??= []);
  for (const rule of forThisSystem(rules)) if (!list.includes(rule)) { list.push(rule); added++; }
}
say(`permissions: ${added} rule(s) added`);
write(settingsFile, settings, settingsWas);

// ---- Handy: the settings from the README's "Voice typing" table. Its model, microphone and sounds
// are picked in Handy's own first-start setup and stay as they are.
const HANDY = {
  shortcut_activation: "push_to_talk",
  paste_method: "direct",
  clipboard_handling: "dont_modify",
  append_trailing_space: true,
  filler_word_removal_enabled: true,
  vad_enabled: true,
  model_unload_timeout: "never",
  autostart_enabled: true,
  start_hidden: true,
};
const WORDS = ["Nimbalyst", "Claude", "Codex", "Gemini", "handoff"];
if (args.includes("--handy")) {
  const file = opt("handy-file") || path.join(process.env.APPDATA || "", "com.pais.handy", "settings_store.json");
  if (!WIN && !opt("handy-file")) {
    say(`Handy: its settings are written by this script on Windows only. On a Mac set them in Handy's own window: the table under "Voice typing" in the README.`);
  } else if (!fs.existsSync(file)) {
    say(`Handy: no settings file yet (${fwd(file)}). Open Handy once, finish its first-start setup, quit it and run this again.`);
  } else {
    const store = read(file);
    const was = JSON.stringify(store);
    const s = (store.settings ??= {});
    Object.assign(s, HANDY);
    // Right Alt as the key to hold; the rest of the shortcut's entry stays
    if (s.bindings?.transcribe) s.bindings.transcribe.current_binding = "alt_right";
    s.custom_words = [...new Set([...(s.custom_words || []), ...WORDS])];
    write(file, store, was);
  }
}
say(DRY ? "Nothing was changed." : "settings done");
