#!/usr/bin/env node
// ask: one command for gathering jobs (web research, reading long files) that uses whichever free
// worker this person has, in order, and moves to the next one when a worker is missing, signed out or
// out of usage. It always says which worker answered and why an earlier one was skipped.
//
//   ask.mjs [--web] [--think] "<short task>"
//   ask.mjs [--web] [--think] <path to a text file holding the task>
//   ask.mjs --status                      which workers are usable right now, and why not
//
// --web    web research. Order: Codex, then Antigravity (Gemini login, search_web and read_url).
// (none)   local files and code. Order: Codex, then Antigravity (Gemini login). Name the files in the task.
//
// Antigravity headless needs allow-rules in ~/.gemini/antigravity-cli/settings.json: read_url(*) for
// the web, read_file(<folder>) for files outside the folder it starts in. command(...) rules do not
// take effect headless, so the rules below steer it to its file tools instead of the shell.
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
function spawnBash(script, args) {
  return spawnSync("bash", ["-c", script, "ask", ...args], {
    encoding: "utf8", timeout: 15 * 60 * 1000, maxBuffer: 64 * 1024 * 1024, stdio: ["ignore", "pipe", "pipe"],
  });
}

// out: the program's answer text (by default its whole output)
function failure(r, out = r.stdout) {
  if (r.error) return { ok: false, reason: r.error.code === "ENOENT" ? "bash was not found" : r.error.message };
  const all = `${r.stderr || ""}\n${out || ""}`.trim();
  const last = all.split(/\r?\n/).filter((l) => l.trim()).slice(-2).join(" | ").slice(0, 300);
  return { ok: false, reason: last || `exit code ${r.status}, no output`, outOfUsage: OUT_OF_USAGE.test(all), notHere: NOT_HERE.test(all) };
}

function runBash(script, args) {
  const r = spawnBash(script, args);
  const out = (r.stdout || "").trim();
  if (!r.error && r.status === 0 && out) return { ok: true, text: out };
  return failure(r);
}

// Antigravity's own time limit. At 5 minutes it stopped 8 of 93 jobs in one project (2026-10-26).
const AGY_MINUTES = 8;
// When it runs out of time, its answer so far is usually empty: it was still searching or reading.
// The same conversation is then resumed once and told to write the answer from what it has found.
// Both runs together, with about 15 seconds of start-up each, stay under the Bash tool's 10-minute limit.
const AGY_WRAP_UP_SECONDS = 75;
const AGY_WRAP_UP = "Time is up: stop and do not call any more tools. Write a concise answer now from what you have already found, and say which parts you could not check.";
const PARTIAL = `[PARTIAL ANSWER: Antigravity ran out of time (${AGY_MINUTES} minutes) before it finished; this was written from what it had found by then and may be incomplete.]\n\n`;

// One Antigravity run with its event output, which names the conversation so it can be resumed
function agyOnce(prompt, limit, conversation) {
  const resume = conversation ? ` --conversation "$3"` : "";
  const r = spawnBash(`agy -p "$1" --mode plan --model "$2" --print-timeout ${limit} --output-format stream-json${resume} < /dev/null`,
    [prompt, AGY_MODEL, ...(conversation ? [conversation] : [])]);
  // The event lines hold the task, search words and page text, so a failure is judged on stderr, on the
  // lines that are not events, and on the status and error of a result that did not succeed
  const events = [], notEvents = [];
  for (const l of (r.stdout || "").split(/\r?\n/)) {
    let v;
    try { v = JSON.parse(l); } catch { notEvents.push(l); continue; }
    if (v && typeof v === "object") events.push(v);
  }
  const result = (events.find((e) => e.event === "result") || {}).result || {};
  const badResult = result.status && result.status !== "SUCCESS" ? JSON.stringify({ status: result.status, error: result.error }) : "";
  return {
    r, text: (result.response || "").trim(), timedOut: /print timeout after/.test(r.stderr || ""),
    conversation: result.conversation_id || (events.find((e) => e.conversation_id) || {}).conversation_id,
    failed: () => failure(r, `${notEvents.join("\n")}\n${badResult}`),
  };
}

function runAgy(prompt) {
  const first = agyOnce(prompt, `${AGY_MINUTES * 60}s`);
  if (first.r.error || first.r.status !== 0) return first.failed();
  if (first.text) return { ok: true, text: first.timedOut ? PARTIAL + first.text : first.text, partial: first.timedOut };
  if (!first.timedOut || !first.conversation) return first.failed();
  note(`agy ran out of time; asking it to write its answer from what it has found`);
  const second = agyOnce(AGY_WRAP_UP, `${AGY_WRAP_UP_SECONDS}s`, first.conversation);
  if (!second.r.error && second.r.status === 0 && second.text) return { ok: true, text: PARTIAL + second.text, partial: true };
  const why = second.failed(), before = first.failed();
  return { ...why, outOfUsage: why.outOfUsage || before.outOfUsage, notHere: why.notHere || before.notHere, reason: `ran out of time after ${AGY_MINUTES} minutes, and the wrap-up gave no answer either (${why.reason})` };
}

// Run with -p, Antigravity cannot ask for a permission: the first shell command the model tries (it
// reaches for one to list the folder) is refused and the run ends with no answer. Its file tools need none.
const AGY_RULES = [
  "Rules for this run: you are running without a terminal. Never call run_command (no PowerShell, no ls,",
  "dir, cat, Get-ChildItem or Get-Content): it is refused and the whole run ends with no answer.",
  "To list a folder call list_dir, to find files call find_by_name, to search text call grep_search,",
  "to read a file call view_file. If a file named in the task is missing, say so and carry on.",
  "Do not write or change any file. Do the work yourself: never launch a subagent.",
].join("\n");
const AGY_WEB_RULES = [
  "Rules for this run: you are running without a terminal. Never call run_command: it is refused and",
  "the whole run ends with no answer. Use search_web to search and read_url to read pages. Give the",
  "source URL for each fact. Do not read, write or change any local file.",
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
    run({ task, web }) {
      return runAgy(`${web ? AGY_WEB_RULES : AGY_RULES}\n\n${task}`);
    },
  },
};

const ORDER = { web: ["codex", "agy"], local: ["codex", "agy"] };
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
    note(`answered by ${ROUTES[route].label}${result.partial ? " (partial: it ran out of time)" : ""}`);
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
