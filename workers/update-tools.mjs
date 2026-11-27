#!/usr/bin/env node
// update-tools: brings the programs the setup uses up to their latest version. /update-setup runs it last
// (skills/update-setup/update.mjs, with --budget 15); Claude Code itself is that script's own check
// (scripts/claude-code-version.mjs), so it is not updated here. In order:
//   - the plugin sources (`claude plugin marketplace update`), then each plugin installed for the user
//     (`claude plugin update <id> --scope user`). A plugin installed only in a project folder is left to that
//     folder. A plugin whose source now declares a new install command is not accepted here (no -y): its update
//     fails with Claude Code's reason, and the person accepts it with `claude plugin update <id>`.
//   - the global npm packages in SETUP_NPM, and no other: `npm install -g` of someone's own global tool could
//     break a version they keep on purpose. --check lists those others too, as not updated.
//   - yt-dlp, when a Python on the PATH has it as a package (pip install -U).
//   - on Windows, the winget programs in WINGET. Git gets a line only: its installer needs admin rights and
//     stops while any Git Bash runs (every Claude session runs one), so the person updates it.
// A program that is not on this computer is one line "<name>: skipped, not installed", never a failure.
// Prints one line per program as soon as it is known, "<name>: <before> -> <after>" or "<name>: <before>
// (latest)", then the failures under FAILED: and exit 1. It keeps a total time budget: each command gets at most
// what is left, and once the budget is spent the programs not reached are listed as failures (not updated).
//
//   update-tools.mjs                   update everything, in at most 60 minutes
//   update-tools.mjs --budget <min>    the same in at most <min> minutes
//   update-tools.mjs --check           list what is behind, change nothing
//   update-tools.mjs --home <folder>   read the plugins of <folder>/.claude (tests)
//
// UPDATE_TOOLS=off: one line, nothing run. Commands are found on the PATH and run through the shell, as
// scripts/plugins.mjs runs claude: Windows' npm, and the stand-in commands of tests/test-update-tools.mjs, are
// .cmd files, which run only through the shell.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const say = (line) => console.log(line); // each line at once, so a run stopped from outside still shows what it did
if (String(process.env.UPDATE_TOOLS || "").toLowerCase() === "off") {
  say("programs: not updated (UPDATE_TOOLS=off)");
  process.exit(0);
}
const CHECK = args.includes("--check");
const budgetAt = args.indexOf("--budget");
const BUDGET_MIN = budgetAt === -1 ? 60 : Number(args[budgetAt + 1]);
if (!(BUDGET_MIN > 0)) {
  console.error(
    `update-tools: --budget needs a positive number of minutes, got "${args[budgetAt + 1]}"`,
  );
  process.exit(2);
}
const homeAt = args.indexOf("--home");
if (homeAt !== -1 && !args[homeAt + 1]) {
  console.error("update-tools: --home needs a folder");
  process.exit(2);
}
const HOME = homeAt === -1 ? homedir() : path.resolve(args[homeAt + 1]);
const deadline = Date.now() + BUDGET_MIN * 60000;
const SPENT = `the ${BUDGET_MIN} min time budget is spent`;

// The global npm packages the setup installs or needs: the full install (docs/full-install.md) installs the Codex
// CLI with `npm i -g @openai/codex`, which the picture skill and the quick-tasks finder use. Claude Code's own
// package is left to update.mjs's check (CLAUDE_CODE_NPM), so --check does not list it as someone else's.
const SETUP_NPM = ["@openai/codex"];
const CLAUDE_CODE_NPM = "@anthropic-ai/claude-code";
// The winget programs the setup uses (docs/reference/dependencies.md): the GitHub CLI and ffmpeg
const WINGET = [
  ["GitHub.cli", "GitHub CLI"],
  ["Gyan.FFmpeg", "FFmpeg"],
];
const PYTHONS = ["python3", "python"];

const failures = [];
// The file the shell would run for a command name, or null (as scripts/plugins.mjs looks). lstat, because
// Windows' app aliases (winget) are links that stat can not follow.
const which = (name) => {
  for (const d of (process.env.PATH || "").split(path.delimiter))
    for (const e of process.platform === "win32" ? [".exe", ".cmd"] : [""])
      if (d && fs.lstatSync(path.join(d, name + e), { throwIfNoEntry: false }))
        return path.join(d, name + e);
  return null;
};
// Every word passed is a constant of this file or a name checked against SAFE first, so nothing in a line is
// read by the shell
const SAFE = /^[\w.@/=-]+$/;
// Runs a command with at most `ms`, and never past the budget
function run(cmd, words, ms = 10 * 60000) {
  const left = deadline - Date.now();
  if (left <= 0) return { ok: false, stdout: "", out: "", error: SPENT };
  const bad = words.find((w) => !SAFE.test(w));
  if (bad)
    throw new Error(`"${bad}" is not a name this script passes to ${cmd}`);
  const r = spawnSync([cmd, ...words].join(" "), {
    shell: true,
    encoding: "utf8",
    timeout: Math.min(ms, left),
    windowsHide: true,
    maxBuffer: 1 << 26,
    cwd: tmpdir(),
  });
  const timedOut = r.error?.code === "ETIMEDOUT";
  return {
    ok: !r.error && r.status === 0,
    stdout: r.stdout || "",
    out: `${r.stdout || ""}${r.stderr || ""}`.trim(),
    error: !r.error
      ? null
      : timedOut && Date.now() >= deadline
        ? SPENT
        : timedOut
          ? `no answer within ${Math.round(ms / 1000)} s`
          : r.error.message,
  };
}
const tail = (t) =>
  String(t).split(/\r?\n/).filter(Boolean).slice(-3).join(" | ") || "no output";
const why = (r) => r.error || tail(r.out);
// A step that can not go on throws; the loop at the end puts it with the failures
const must = (r, what) => {
  if (r.error) throw new Error(`${what}: ${r.error}`);
  return r;
};

// ---- Claude Code plugins ----
// id -> the version installed for the user, or null when it is installed only in project folders
function installedPlugins() {
  const file = path.join(HOME, ".claude", "plugins", "installed_plugins.json");
  if (!fs.existsSync(file)) return {};
  const all = JSON.parse(fs.readFileSync(file, "utf8")).plugins || {};
  return Object.fromEntries(
    Object.entries(all).map(([id, list]) => [
      id,
      list.find((i) => i.scope === "user")?.version ?? null,
    ]),
  );
}
function updatePlugins() {
  if (!which("claude"))
    return say("plugins: skipped, not installed (no claude command)");
  const before = installedPlugins();
  const ids = Object.keys(before);
  if (!ids.length) return say("plugins: none installed");
  // --check changes nothing, and only the sources' update tells what is newer: not looked for there
  if (!CHECK) {
    const m = run("claude", ["plugin", "marketplace", "update"]);
    if (!m.ok) failures.push(`plugin sources: ${why(m)}`);
  }
  for (const id of ids) {
    if (CHECK || before[id] === null) continue;
    if (!SAFE.test(id)) {
      failures.push(
        `plugin ${id}: its name has characters this script does not pass to a shell`,
      );
      continue;
    }
    const r = run("claude", ["plugin", "update", id, "--scope", "user"]);
    if (!r.ok) failures.push(`plugin ${id}: ${why(r)}`);
  }
  const after = CHECK ? before : installedPlugins();
  let changed = false;
  for (const id of ids) {
    if (before[id] === null) {
      say(`plugin ${id}: skipped, installed only in project folders`);
      continue;
    }
    if (CHECK)
      say(
        `plugin ${id}: ${before[id]} (--check does not look for plugin updates)`,
      );
    else if (before[id] === after[id])
      say(`plugin ${id}: ${before[id]} (latest)`);
    else {
      changed = true;
      say(`plugin ${id}: ${before[id]} -> ${after[id]}`);
    }
  }
  if (changed) say("plugins: the updated ones load in the next new chat");
}

// ---- global npm packages ----
function updateNpm() {
  if (!which("npm"))
    return say("npm packages: skipped, not installed (no npm command)");
  // both answer in JSON on stdout; both can exit 1 with a good answer (outdated: something is behind)
  const ls = must(
    run("npm", ["ls", "-g", "--depth=0", "--json"], 120000),
    "npm ls -g",
  );
  const od = must(
    run("npm", ["outdated", "-g", "--json"], 120000),
    "npm outdated -g",
  );
  const parse = (r, what) => {
    try {
      return JSON.parse(r.stdout.trim() || "{}");
    } catch {
      throw new Error(`${what} gave no JSON: ${tail(r.out)}`);
    }
  };
  const have = parse(ls, "npm ls -g").dependencies || {};
  const behind = parse(od, "npm outdated -g");
  for (const name of SETUP_NPM) {
    if (!have[name]) {
      say(`npm ${name}: skipped, not installed`);
      continue;
    }
    const b = behind[name];
    if (!b) say(`npm ${name}: ${have[name].version} (latest)`);
    else if (CHECK) say(`npm ${name}: ${b.current} -> ${b.latest} (behind)`);
    else {
      const r = run("npm", ["install", "-g", `${name}@latest`]);
      if (r.ok) say(`npm ${name}: ${b.current} -> ${b.latest}`);
      else {
        say(`npm ${name}: ${b.current} -> ${b.latest} failed`);
        failures.push(`npm ${name}: ${why(r)}`);
      }
    }
  }
  if (CHECK)
    for (const [name, b] of Object.entries(behind))
      if (!SETUP_NPM.includes(name) && name !== CLAUDE_CODE_NPM)
        say(
          `npm ${name}: ${b.current} -> ${b.latest} behind (not updated: not the setup's)`,
        );
}

// ---- yt-dlp, as a Python package ----
const numbers = (v) => String(v).split(".").map(Number).join("."); // pip's 2025.1.5 is yt-dlp's 2025.01.05
function updateYtDlp() {
  let py = null;
  let before = null;
  for (const p of PYTHONS) {
    if (!which(p)) continue;
    // Windows' python stand-ins in WindowsApps fail here too, as a Python without yt-dlp does
    const r = must(
      run(p, ["-m", "yt_dlp", "--version"], 60000),
      `${p} -m yt_dlp`,
    );
    if (r.ok) {
      py = p;
      before = r.stdout.trim().split(/\r?\n/)[0];
      break;
    }
  }
  if (!py) return say("yt-dlp: skipped, not installed as a Python package");
  if (CHECK) {
    const idx = run(py, ["-m", "pip", "index", "versions", "yt-dlp"], 120000);
    const latest =
      idx.ok && (idx.stdout.match(/^yt-dlp \(([^)]+)\)/m) || [])[1];
    if (!latest)
      say(
        `yt-dlp: ${before} (the newest version could not be read: ${why(idx)})`,
      );
    else if (numbers(latest) === numbers(before))
      say(`yt-dlp: ${before} (latest)`);
    else say(`yt-dlp: ${before} -> ${latest} (behind)`);
    return;
  }
  const r = run(py, ["-m", "pip", "install", "-U", "-q", "yt-dlp"]);
  if (!r.ok) failures.push(`yt-dlp: ${why(r)}`);
  const v = run(py, ["-m", "yt_dlp", "--version"], 60000);
  const after = v.ok ? v.stdout.trim().split(/\r?\n/)[0] : "?";
  say(
    `yt-dlp: ${before === after ? `${before} (latest)` : `${before} -> ${after}`}`,
  );
}

// ---- winget programs (Windows) ----
// { installed, available } from winget's list; installed null when winget lists no such program
function wingetRow(id) {
  const r = must(
    run(
      "winget",
      ["list", "--id", id, "--exact", "--accept-source-agreements"],
      120000,
    ),
    `winget list ${id}`,
  );
  const row = r.out
    .split(/[\r\n]+/)
    .find((l) => l.includes(` ${id} `) || l.endsWith(` ${id}`));
  if (!row) return { installed: null, available: null };
  const parts = row.trim().split(/\s+/);
  const at = parts.indexOf(id);
  const available =
    parts[at + 2] && parts[at + 2] !== "winget" ? parts[at + 2] : null;
  return { installed: parts[at + 1] || "?", available };
}
function updateWinget() {
  if (process.platform !== "win32")
    return say("winget programs: skipped, not Windows");
  if (!which("winget"))
    return say("winget programs: skipped, not installed (no winget command)");
  for (const [id, label] of WINGET) {
    const name = `${label} (${id})`;
    const { installed, available } = wingetRow(id);
    if (!installed) say(`${name}: skipped, not installed`);
    else if (!available) say(`${name}: ${installed} (latest)`);
    else if (CHECK) say(`${name}: ${installed} -> ${available} (behind)`);
    else {
      const r = run(
        "winget",
        [
          "upgrade",
          "--id",
          id,
          "--exact",
          "--silent",
          "--accept-package-agreements",
          "--accept-source-agreements",
        ],
        15 * 60000,
      );
      if (r.ok) say(`${name}: ${installed} -> ${available}`);
      else {
        say(`${name}: ${installed} -> ${available} failed`);
        failures.push(`${id}: ${why(r)}`);
      }
    }
  }
  const git = wingetRow("Git.Git");
  if (!git.installed) say("Git: skipped, not installed through winget");
  else if (!git.available) say(`Git: ${git.installed} (latest)`);
  else
    say(
      `Git: ${git.installed} -> ${git.available} behind; update Git yourself (its installer needs admin rights and every Git Bash closed)`,
    );
}

for (const [name, step] of [
  ["plugins", updatePlugins],
  ["npm packages", updateNpm],
  ["yt-dlp", updateYtDlp],
  ["winget programs", updateWinget],
]) {
  if (Date.now() >= deadline) {
    failures.push(`${name}: not updated, ${SPENT}`);
    continue;
  }
  try {
    step();
  } catch (e) {
    failures.push(`${name}: ${e?.message || e}`);
  }
}
if (failures.length) {
  say(`\nFAILED:\n${failures.map((f) => `- ${f}`).join("\n")}`);
  process.exit(1);
}
