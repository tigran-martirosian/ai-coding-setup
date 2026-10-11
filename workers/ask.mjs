#!/usr/bin/env node
// ask: one command for gathering jobs (web research, reading long files) that uses whichever free
// worker this person has, in order, and moves to the next one when a worker is missing, signed out or
// out of usage. It always says which worker answered and why an earlier one was skipped.
//
//   ask.mjs [--web] [--think] "<short task>"
//   ask.mjs [--web] [--think] <path to a text file holding the task>
//   ask.mjs --status                      which workers are usable right now, and why not
//
// --web    web research. Codex (ChatGPT login) is the one free worker that can search the web.
// (none)   local files and code. Order: Codex, then Antigravity (Gemini login). Name the files in the task.
// --think  a hard question: Codex runs with its default reasoning effort instead of low.
//
// What a person has is detected, not configured:
//   Codex        `codex` is installed and ~/.claude/workers/codex.off does not exist
//   Antigravity  `agy` is installed and ~/.claude/workers/agy.off does not exist
//
// Exit codes: 0 answered; 2 bad usage; 3 no worker could answer (the output says what to do instead).
import { readFileSync, writeFileSync, existsSync, statSync } from "node:fs";
import { join, delimiter, dirname } from "node:path";
import { homedir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOME = process.env.ASK_HOME || join(homedir(), ".claude", "workers");
const HERE = dirname(fileURLToPath(import.meta.url));
const AGY_MODEL = process.env.BIG_READ_AGY_MODEL || "gemini-3.8-flash-medium";
const COOLDOWN_FILE = join(HOME, "cooldown.json");
const COOLDOWN_MS = 30 * 60 * 1000; // an out-of-usage worker is not tried again for half an hour
const OUT_OF_USAGE = /usage limit|rate limit|quota|resource_exhausted|too many requests|\b429\b/i;
const NOT_HERE = /location is not supported/i; // the service refuses this place, so trying again soon is no use either

const note = (line) => process.stderr.write(`[ask] ${line}\n`);

function onPath(name) {
  const exts = process.platform === "win32" ? ["", ".cmd", ".exe", ".ps1"] : [""];
  return (process.env.PATH || "").split(delimiter).some((d) => d && exts.some((e) => existsSync(join(d, name + e))));
}

function readCooldowns() {
  if (!existsSync(COOLDOWN_FILE)) return {};
  return JSON.parse(readFileSync(COOLDOWN_FILE, "utf8"));
}

function setCooldown(route) {
  writeFileSync(COOLDOWN_FILE, JSON.stringify({ ...readCooldowns(), [route]: Date.now() + COOLDOWN_MS }));
}

// Why a route can't be used right now, or "" when it can
function unusable(route) {
  if (existsSync(join(HOME, `${route}.off`))) return `switched off (${route}.off)`;
  if (!onPath(route)) return "not installed";
  const until = readCooldowns()[route];
  if (until && until > Date.now()) return `out of usage or not available here, next try after ${new Date(until).toLocaleTimeString()}`;
  return "";
}

// Runs a program through bash with the task as a positional argument, so no quoting is needed
function runBash(script, args) {
  const r = spawnSync("bash", ["-c", script, "ask", ...args], {
    encoding: "utf8", timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
  if (r.error) return { ok: false, reason: r.error.code === "ENOENT" ? "bash was not found" : r.error.message };
  const out = (r.stdout || "").trim();
  if (r.status === 0 && out) return { ok: true, text: out };
  const all = `${r.stderr || ""}\n${r.stdout || ""}`.trim();
  const last = all.split(/\r?\n/).filter((l) => l.trim()).slice(-2).join(" | ").slice(0, 300);
  return { ok: false, reason: last || `exit code ${r.status}, no output`, outOfUsage: OUT_OF_USAGE.test(all), notHere: NOT_HERE.test(all) };
}

// Run with -p, Antigravity cannot ask for a permission: the first shell command the model tries (it
// reaches for one to list the folder) is refused and the run ends with no answer. Its file tools need none.
const AGY_RULES = [
  "Rules for this run: you are running without a terminal. Never run a shell command (no run_command,",
  "no PowerShell, no ls, dir, cat, Get-ChildItem or Get-Content): it is refused and the whole run ends",
  "with no answer. Use only your file tools to list folders, find files and read them. If a file named",
  "in the task is missing, say so and carry on. Do not write or change any file.",
].join("\n");

const ROUTES = {
  codex: {
    label: "Codex (ChatGPT login)",
    run({ task, web, think }) {
      const flags = [web ? "--web" : "", think ? "--think" : ""].filter(Boolean).join(" ");
      return runBash(`"$1" ${flags} "$2" < /dev/null`, [join(HERE, "ask-codex.sh"), task]);
    },
  },
  agy: {
    label: `Antigravity (${AGY_MODEL})`,
    run({ task }) {
      return runBash(`agy -p "$1" --mode plan --model "$2" < /dev/null`, [`${AGY_RULES}\n\n${task}`, AGY_MODEL]);
    },
  },
};

// Antigravity is not in the web list: headless, it is denied the commands it tries and loops for minutes
const ORDER = { web: ["codex"], local: ["codex", "agy"] };
const CLAUDE_INSTEAD = {
  web: `Do it with Claude instead: a "worker" subagent (Sonnet) with a budget of about 15 tool calls, or WebSearch for one quick fact.`,
  local: `Do it with Claude instead: Grep and Read with offset/limit, or a "worker" subagent with a budget of about 15 tool calls.`,
};

const args = process.argv.slice(2);
let web = false, think = false, status = false;
while (args.length && args[0].startsWith("--")) {
  const flag = args.shift();
  if (flag === "--web") web = true;
  else if (flag === "--think") think = true;
  else if (flag === "--status") status = true;
  else { note(`unknown option ${flag}`); process.exit(2); }
}

if (status) {
  for (const kind of ["web", "local"]) {
    console.log(`${kind === "web" ? "Web research (--web)" : "Local files"}, in this order:`);
    for (const route of ORDER[kind]) console.log(`  ${route}: ${unusable(route) || "ready"}`);
    console.log(`  then Claude itself`);
  }
  process.exit(0);
}

if (args.length !== 1 || !args[0]) {
  note(`give one task, as text or as the path of a text file. Usage: ask.mjs [--web] [--think] "<task>"`);
  process.exit(2);
}
let task = args[0];
if (existsSync(task) && statSync(task).isFile()) {
  task = readFileSync(task, "utf8").trim();
  if (!task) { note(`the task file ${args[0]} is empty`); process.exit(2); }
}

const kind = web ? "web" : "local";
let answered = false;
for (const route of ORDER[kind]) {
  const why = unusable(route);
  if (why) { note(`${route} skipped: ${why}`); continue; }
  const result = ROUTES[route].run({ task, web, think });
  if (result.ok) {
    note(`answered by ${ROUTES[route].label}`);
    console.log(result.text);
    answered = true;
    break;
  }
  if (result.outOfUsage || result.notHere) setCooldown(route);
  note(`${route} failed${result.outOfUsage ? " (out of usage)" : result.notHere ? " (not available from this location)" : ""}: ${result.reason}`);
}
if (!answered) {
  note(`no free worker could answer. ${CLAUDE_INSTEAD[kind]}`);
  process.exitCode = 3;
}
