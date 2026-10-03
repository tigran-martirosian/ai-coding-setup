#!/usr/bin/env node
// Installs this setup into ~/.claude: the hooks, the worker agent, the skills, and the hook wiring
// from settings.example.json merged into settings.json. Safe to run again: it adds what is missing.
//   node install.mjs            install
//   node install.mjs --dry-run  print what it would do and change nothing
//   --home <folder>             install into <folder>/.claude instead of the home folder's
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const DRY = args.includes("--dry-run");
const home = args.includes("--home") ? path.resolve(args[args.indexOf("--home") + 1] || ".") : os.homedir();
const CLAUDE = path.join(home, ".claude");
const fwd = (p) => p.replace(/\\/g, "/");
const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
const say = (s) => console.log((DRY ? "[dry run] " : "") + s);

if (Number(process.versions.node.split(".")[0]) < 18) {
  console.log(`Node.js 18 or newer is needed; this is ${process.version}.`);
  process.exit(1);
}

// Every file in these repo folders goes to the folder of the same name under ~/.claude.
function filesIn(dir) {
  const full = path.join(REPO, dir);
  return fs.readdirSync(full, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? filesIn(path.join(dir, e.name)) : [path.join(dir, e.name)]);
}
const files = ["hooks", "agents", "skills"].flatMap(filesIn);

// Settings that can't be read stop the install before anything is copied.
const settingsFile = path.join(CLAUDE, "settings.json");
let settings = {};
if (fs.existsSync(settingsFile)) {
  try { settings = JSON.parse(fs.readFileSync(settingsFile, "utf8")); } catch {
    console.log(`${fwd(settingsFile)} is not valid JSON; nothing was changed. Fix it and run this again.`);
    process.exit(1);
  }
}

// A file that is already there with other content is kept next to the new one before it is replaced.
for (const rel of files) {
  const from = path.join(REPO, rel);
  const to = path.join(CLAUDE, rel);
  const text = fs.readFileSync(from);
  if (fs.existsSync(to) && fs.readFileSync(to).equals(text)) { say(`unchanged ${fwd(to)}`); continue; }
  const backup = fs.existsSync(to) ? `${to}.before-install-${today}` : null;
  if (!DRY) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (backup) fs.copyFileSync(to, backup);
    fs.writeFileSync(to, text);
  }
  say(`${backup ? "replaced" : "copied"} ${fwd(to)}${backup ? ` (old copy: ${path.basename(backup)})` : ""}`);
}

// The hook wiring: each hook from the example is added unless that event already runs the same script.
// The command points at the installed copy by its full path, so it works from any folder and shell.
const example = JSON.parse(fs.readFileSync(path.join(REPO, "settings.example.json"), "utf8"));
let added = 0;
for (const [event, groups] of Object.entries(example.hooks)) {
  for (const group of groups) {
    for (const hook of group.hooks) {
      const [, script, extra] = hook.command.match(/~\/\.claude\/(\S+)(.*)$/);
      const list = ((settings.hooks ??= {})[event] ??= []);
      if (JSON.stringify(list).includes(path.basename(script))) continue;
      const command = `node "${fwd(path.join(CLAUDE, script))}"${extra}`;
      const entry = { type: "command", command, timeout: hook.timeout };
      list.push(group.matcher ? { matcher: group.matcher, hooks: [entry] } : { hooks: [entry] });
      say(`hook added: ${event}${group.matcher ? ` (${group.matcher})` : ""} ${path.basename(script)}`);
      added++;
    }
  }
}
if (!added) say(`hooks already wired in ${fwd(settingsFile)}`);
else {
  const backup = fs.existsSync(settingsFile) ? `${settingsFile}.before-install-${today}` : null;
  if (!DRY) {
    fs.mkdirSync(CLAUDE, { recursive: true });
    if (backup) fs.copyFileSync(settingsFile, backup);
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2) + "\n");
  }
  say(`wrote ${fwd(settingsFile)}${backup ? ` (old copy: ${path.basename(backup)})` : ""}`);
}

// The outside workers are optional: without them worker-nudge has nowhere to point and the court
// sits with its Claude seats only.
const onPath = (name) => (process.env.PATH || "").split(path.delimiter)
  .some((d) => d && ["", ".cmd", ".exe", ".ps1"].some((e) => fs.existsSync(path.join(d, name + e))));
for (const [tool, what] of [["codex", "Codex CLI (GPT)"], ["agy", "Antigravity CLI (Gemini)"]]) {
  say(`${what}: ${onPath(tool) ? "found" : "not found, optional"}`);
}
say(DRY ? "Nothing was changed." : "Done. Restart Claude Code so it loads the hooks.");
