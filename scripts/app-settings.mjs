#!/usr/bin/env node
// The settings of the full install that are not files of this repository (docs/full-install.md).
// install.mjs makes the Claude Code ones itself; this script is for those alone, and for Handy.
// Safe to run again: it adds what is missing and a second run changes nothing. A file that is changed
// is kept, as it was, in ~/.claude/setup-logs/<YYYY-MM-DD>-install-backup/ under its path from the home folder.
//   node scripts/app-settings.mjs            Claude Code, ~/.claude/settings.json: "model": "opus" (medium effort) when no
//                                            model is set, and permission rules (the agent can't read the
//                                            saved sign-ins or the SSH keys, and asks before a .env file),
//                                            and an empty CLAUDE_CODE_EFFORT_LEVEL so helpers run at their own effort
//   node scripts/app-settings.mjs --handy    the same, and Handy's settings for voice typing (Windows;
//                                            quit Handy first, it writes its file when it closes)
//   --dry-run                                print what it would do and change nothing
//   --home <folder>                          use <folder>/.claude instead of the home folder's
//   --handy-file <file>                      Handy's settings file, when it is somewhere else
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { addClaudeCodeSettings, effortLines } from "./claude-code-settings.mjs";
import { freshCopy, fwd, today } from "./files.mjs";
import { nimbalystHome } from "./nimbalyst-paths.mjs";

const args = process.argv.slice(2);
const opt = (name) =>
  args.includes(`--${name}`) ? args[args.indexOf(`--${name}`) + 1] || "" : null;
const DRY = args.includes("--dry-run");
const WIN = process.platform === "win32";
const home =
  opt("home") !== null ? path.resolve(opt("home") || ".") : os.homedir();
const day = today();
const say = (s) => console.log((DRY ? "[dry run] " : "") + s);

function read(file) {
  if (!fs.existsSync(file)) return {};
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    console.log(
      `${fwd(file)} is not valid JSON; nothing was changed. Fix it and run this again.`,
    );
    process.exit(1);
  }
}
// Writes the file when the merge changed it; the file as it was is kept in setup-logs (scripts/files.mjs: freshCopy)
function write(file, data, was) {
  if (JSON.stringify(data) === was) return say(`unchanged ${fwd(file)}`);
  const copy = fs.existsSync(file) ? freshCopy(home, file, day, DRY) : null;
  if (!DRY) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(data, null, 2) + "\n");
  }
  say(`wrote ${fwd(file)}${copy ? ` (old copy: ${fwd(copy)})` : ""}`);
}

// ---- Claude Code
const settingsFile = path.join(home, ".claude", "settings.json");
const settings = read(settingsFile);
const settingsWas = JSON.stringify(settings);
const did = addClaudeCodeSettings(settings, WIN);
say(
  did.model
    ? `model: set to opus at medium effort (none was set)`
    : `model: left as it is (${settings.model})`,
);
say(`permissions: ${did.added} rule(s) added`);
// Nimbalyst's own effort setting is only named, and only for the real home folder
for (const line of effortLines(
  did,
  opt("home") === null ? path.join(nimbalystHome(), "app-settings.json") : null,
  fwd(settingsFile),
))
  say(line);
write(settingsFile, settings, settingsWas);

// ---- Handy: the settings from the README's "Voice typing" table. Its model, microphone and sounds
// are picked in Handy's own first-start setup and stay as they are.
const HANDY = {
  shortcut_activation: "push_to_talk",
  // Ctrl+V, not "direct": direct typing sends every letter as its own keystroke, so a dictation that
  // lands while the wrong part of an app has focus fires one shortcut per letter.
  paste_method: "ctrl_v",
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
  const file =
    opt("handy-file") ||
    path.join(
      process.env.APPDATA || "",
      "com.pais.handy",
      "settings_store.json",
    );
  if (!WIN && !opt("handy-file")) {
    say(
      `Handy: its settings are written by this script on Windows only. On a Mac set them in Handy's own window: the table under "Voice typing" in the README.`,
    );
  } else if (!fs.existsSync(file)) {
    say(
      `Handy: no settings file yet (${fwd(file)}). Open Handy once, finish its first-start setup, quit it and run this again.`,
    );
  } else {
    const store = read(file);
    const was = JSON.stringify(store);
    const s = (store.settings ??= {});
    Object.assign(s, HANDY);
    // Right Alt as the key to hold; the rest of the shortcut's entry stays
    if (s.bindings?.transcribe)
      s.bindings.transcribe.current_binding = "alt_right";
    s.custom_words = [...new Set([...(s.custom_words || []), ...WORDS])];
    write(file, store, was);
  }
}
say(DRY ? "Nothing was changed." : "settings done");
