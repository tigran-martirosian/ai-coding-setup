#!/usr/bin/env node
// session-cleanup: a session closes what it opened (dev servers, watchers, headless browsers, background shells,
// llama-server, Gradle daemons) and lists the git worktrees it made; it never touches a process it did not start.
// Design: docs/2026-11-12-session-cleanup-design.md (D4) in the setup project.
//   PreToolUse Bash|PowerShell: a call that can start something that stays (LAUNCH) saves its start time;
//     `git worktree add` records the worktree (path, branch) at once, with no process list.
//   PostToolUse Bash|PowerShell: for a saved call, one process list (Get-CimInstance). A process is opened by this
//     session when it was made after the call's start, is alive, and its parent chain (each parent older than its
//     child) reaches this hook's claude.exe; or all its chain is new, the chain breaks at a gone parent and the command
//     line of a process in it holds a program the call named (a detached start: `npm run dev &` leaves npm's node.exe,
//     cmd.exe and vite's node.exe); or, in a gradle call, it is a GradleDaemon whose new chain breaks the same way (one
//     parented by another program, an IDE, is not this call's). It goes in the session's ledger,
//     ~/.claude/hooks/state/session-cleanup/<session_id>.json. A process made before the call (reused) never does.
//   SessionEnd: starts a detached closer and returns. Reasons clear, logout, prompt_input_exit close the ledger;
//     `other` closes it outside Nimbalyst (a `claude -p` run) and keeps it inside (a turn's process ended). Each
//     SessionEnd leaves one line in closed.log with its reason, entry point and host.
//   SessionStart, UserPromptSubmit: at most every 10 min, a detached sweep closes the ledgers whose transcript was
//     not written for SESSION_CLEANUP_IDLE_HOURS (default 3). SessionStart also names this project's leftover
//     worktrees of other sessions, with the remove command; worktrees are never removed.
// Closing one entry: a fresh process list; only a PID alive with the same creation time and command line is closed
// (taskkill /T /F, a Gradle daemon too: `gradlew --stop` would stop every daemon of that Gradle version, another
// session's or the IDE's). A PID another ledger also names is kept.
// Every closed, kept or dropped entry gets one line in ~/.claude/hooks/state/session-cleanup/closed.log.
// SESSION_CLEANUP=off does nothing; =on closes; anything else (unset, report) is report mode: it records and
// writes what it would close to closed.log, and closes nothing. Fails open: an error is crash-logged, nothing closed.
// Windows only (the process list and taskkill); elsewhere it does nothing.
// Tests: SESSION_CLEANUP_TEST_PROCS names a JSON file used as the process list (each read appends a line to
// <file>.calls), and closing appends "kill <pid>" to <file>.kills instead of stopping anything;
// SESSION_CLEANUP_TEST_ROOT names the PID that stands for this session's claude.exe.
import { runHook, isMain } from "./lib/hook-io.mjs";
import { crashLog } from "./lib/crash-log.mjs";
import { readJson, writeJson, sweep, STATE_DIR } from "./lib/state.mjs";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const NAME = "session-cleanup";
const HOOK_FILE = fileURLToPath(import.meta.url);
const DIR = path.join(STATE_DIR, NAME);
const PENDING = path.join(DIR, "pending");
const CLOSED_LOG = path.join(DIR, "closed.log");
const SWEEP_STATE = path.join(DIR, "sweep.json");
const SWEEP_EVERY = 10 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const FAKE = process.env.SESSION_CLEANUP_TEST_PROCS || "";
const mode = () => {
  const v = (process.env.SESSION_CLEANUP || "").toLowerCase();
  return v === "off" ? "off" : v === "on" ? "on" : "report";
};
const idleHours = () => {
  const v = process.env.SESSION_CLEANUP_IDLE_HOURS;
  if (!v) return 3;
  const n = Number(v);
  if (!(n > 0))
    throw new Error(
      `SESSION_CLEANUP_IDLE_HOURS is "${v}", not a number of hours above 0`,
    );
  return n;
};

// A command that doesn't end by itself: the same list as background-tasks.mjs' SERVER (hooks don't import hooks)
const SERVER =
  /\b(runServer|runClient|nodemon|http-server|live-server|webpack-dev-server|http\.server|uvicorn|gunicorn)\b|\bflask\s+run\b|\bmanage\.py\s+runserver\b|\bnode\s[^|;&\n]*server|\bnpx\s+(serve|vite)\b|\bserve\s+-s\b|\bdocker[ -]compose\s+up\b(?![^|;&\n]*\s-\w*d)|\b(npm|pnpm|yarn)\s+run\s+preview\b|\bstreamlit\s+run\b|\brails\s+(s|server)\b|--watch\b|\btsc\b[^|;&\n]*\s-w\b|-Wait\b|\btail\b[^|;&\n]*\s-\w*[fF]\b|(^|[\s;&|(])(npm|pnpm|yarn|bun)\s+(run\s+)?(dev|start|serve|watch)\b|(^|[\s;&|(])(vite|next|nuxt|astro)(\s+dev)?\s*$|(^|[\s;&|(])watch\s|\bwhile\s+(true|:)/im;
// ...and the other ways to start something that stays: a trailing & (not && or 2>&1), a detached start, the tools
// known to leave a process behind
const STARTS =
  /(?<![&>|])&(?![&>])\s*($|[;)#])|\bStart-Process\b|\bnohup\b|\bstart\s+\/b\b|\bcmd(\.exe)?\s+[\/]+c\s+start\b|\bllama-server\b|\bgradlew?\b|--headless\b|\bplaywright\b|\bpuppeteer\b/im;
const GRADLE = /\bgradlew?\b/i;
const WORKTREE_ADD = /\bgit\b[^\n;&|]*?\bworktree\s+add\s+([^\n;&|]+)/i;
export const isLaunch = (command, background = false) =>
  background || SERVER.test(command) || STARTS.test(command);

// "git worktree add [-b name] <path> [commit]" -> { path, branch }
export function worktreeOf(command, cwd) {
  const m = command.match(WORKTREE_ADD);
  if (!m) return null;
  const words = m[1]
    .match(/"[^"]*"|'[^']*'|\S+/g)
    .map((w) => w.replace(/^["']|["']$/g, ""));
  let branch = "",
    where = "";
  for (let i = 0; i < words.length; i++) {
    if (/^-[bB]$/.test(words[i])) {
      branch = words[++i] ?? "";
      continue;
    }
    if (words[i].startsWith("-")) continue;
    if (!where) where = words[i];
    else if (!branch) branch = words[i];
  }
  return where ? { path: path.resolve(cwd || ".", where), branch } : null;
}

// The process list: [{ pid, ppid, name, created (ms), cmd }]
export function snapshot() {
  if (FAKE) {
    fs.appendFileSync(`${FAKE}.calls`, "list\n");
    return JSON.parse(fs.readFileSync(FAKE, "utf8"));
  }
  const ps =
    "Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ pid = $_.ProcessId; ppid = $_.ParentProcessId; name = $_.Name; " +
    "created = $(if ($_.CreationDate) { ([DateTimeOffset]$_.CreationDate).ToUnixTimeMilliseconds() } else { 0 }); cmd = $_.CommandLine } } | ConvertTo-Json -Compress";
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-Command", ps],
    { encoding: "utf8", windowsHide: true, maxBuffer: 64 * 1024 * 1024 },
  );
  if (r.status !== 0)
    throw new Error(
      `the process list failed: ${String(
        r.stderr || r.error || `exit ${r.status}`,
      )
        .trim()
        .slice(0, 200)}`,
    );
  const list = JSON.parse(r.stdout);
  return (Array.isArray(list) ? list : [list]).map((p) => ({
    ...p,
    cmd: p.cmd ?? "",
  }));
}

// --- Who opened what ---
const byPid = (list) => new Map(list.map((p) => [p.pid, p]));
// p's parent while it is still the process that started p (made before it); null when it is gone or its PID reused
const parentOf = (procs, p) => {
  const q = procs.get(p.ppid);
  return q && q.pid !== p.pid && q.created <= p.created ? q : null;
};
// p and its ancestors, nearest first
function chain(procs, p) {
  const out = [p];
  for (
    let q = parentOf(procs, p);
    q && !out.includes(q) && out.length < 64;
    q = parentOf(procs, q)
  )
    out.push(q);
  return out;
}
const isClaude = (p) => /^claude(\.exe)?$/i.test(p.name);
// The process this hook runs in (its own entry, or its parent's when the list was made by a test)
const selfOf = (procs) =>
  procs.get(process.pid) ?? procs.get(process.ppid) ?? null;
// The claude.exe this hook runs under: walk up from the hook itself
export function findRoot(procs, from = selfOf(procs)) {
  if (!from) return null;
  const testRoot = Number(process.env.SESSION_CLEANUP_TEST_ROOT || 0);
  return (
    chain(procs, from).find((p) =>
      testRoot ? p.pid === testRoot : isClaude(p),
    ) ?? null
  );
}
// What runs that claude.exe: Nimbalyst when any ancestor is it, else its parent (a shell for `claude -p`)
const hostOf = (procs, root) => {
  const up = chain(procs, root).slice(1);
  return (up.find((p) => /nimbalyst/i.test(p.name)) ?? up[0])?.name ?? "";
};
const HOOK_RUN = /[\\/]\.claude[\\/]hooks[\\/]/i; // other hooks running at the same moment
// The setup's Nimbalyst delivery (deliver.mjs, restart.mjs) outlives the session on purpose: it waits for Nimbalyst
// to close, swaps its files and starts it again. Neither it nor what it starts is this session's to close.
const DELIVERY = /tools[\\/]nimbalyst-patch[\\/]/i;
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The programs a call names: the first word of each command, past wrappers (nohup, Start-Process, start /b, cmd /c,
// env settings) and shell builtins; a runner (npx, pnpx, bunx) names the program after it too. "./gradlew" -> gradlew
const WRAPPER =
  /^(nohup|exec|env|sudo|setsid|nice|time|start|start-process|cmd|\/[a-z]|-filepath|\w+=\S*)$/i;
const BUILTIN =
  /^(cd|echo|export|set|sleep|wait|true|false|test|source|if|then|else|fi|do|done|while|for|until)$/i;
const progName = (w) =>
  String(w ?? "")
    .split(/[\\/]/)
    .pop()
    .replace(/\.(exe|cmd|bat|ps1)$/i, "");
export function programsOf(command) {
  const out = new Set();
  for (const part of String(command).split(/&&|\|\||[;&|()\n]/)) {
    const words = (part.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) =>
      w.replace(/^["']|["']$/g, ""),
    );
    let i = 0;
    while (i < words.length && WRAPPER.test(words[i])) i++;
    const first = progName(words[i]);
    if (first.length < 2 || BUILTIN.test(first) || /^[<>$-]/.test(first))
      continue;
    out.add(first);
    const next = /^(npx|pnpx|bunx)$/i.test(first)
      ? progName(words.slice(i + 1).find((w) => !w.startsWith("-")))
      : "";
    if (next.length > 1) out.add(next);
  }
  return [...out];
}
// The word stands in the command line as a word or a path part (npm in ...\node_modules\npm\bin\npm-cli.js)
const holds = (cmd, word) =>
  new RegExp(`(^|[^\\w.-])${escape(word)}(\\.exe)?($|[^\\w-])`, "i").test(
    String(cmd ?? ""),
  );

// The processes this session's call opened: [{ ...process, kind }]. kind: child (under this claude.exe), detached
// (all its chain new, the top's parent gone, a command line in the chain holds a program the call named), gradle (a
// GradleDaemon of a gradle call, all its chain new and the top's parent gone; one under an IDE is not this call's).
export function opened(procs, { since, command, root }) {
  const self = selfOf(procs);
  const mine = new Set(self ? chain(procs, self).map((p) => p.pid) : []);
  const programs = programsOf(command);
  const found = [];
  for (const p of procs.values()) {
    if (
      !(p.created > since) ||
      mine.has(p.pid) ||
      p.pid === process.pid ||
      /^conhost\.exe$/i.test(p.name)
    )
      continue;
    const up = chain(procs, p);
    if (
      up.some(
        (q) =>
          q.pid === process.pid ||
          HOOK_RUN.test(q.cmd ?? "") ||
          DELIVERY.test(q.cmd ?? ""),
      )
    )
      continue; // this hook's list, other hooks, the delivery
    const top = up[up.length - 1];
    let kind = "";
    if (root && up.some((q) => q.pid === root.pid)) kind = "child";
    else if (top.created > since && !up.some(isClaude)) {
      if (/^javaw?\.exe$/i.test(p.name) && /GradleDaemon/.test(p.cmd ?? ""))
        kind = GRADLE.test(command) ? "gradle" : "";
      else if (up.some((q) => programs.some((w) => holds(q.cmd, w))))
        kind = "detached";
    }
    if (kind) found.push({ ...p, kind });
  }
  return found;
}

// --- The ledger: ~/.claude/hooks/state/session-cleanup/<session_id>.json ---
const safe = (s) => String(s).replace(/[^\w.-]/g, "_");
const ledgerFile = (sessionId) => path.join(DIR, `${safe(sessionId)}.json`);
function update(event, fn) {
  const file = ledgerFile(event.session_id);
  const l = readJson(file) ?? {
    session_id: event.session_id,
    transcript_path: "",
    host: "",
    processes: [],
    worktrees: [],
  };
  if (event.transcript_path) l.transcript_path = event.transcript_path;
  fn(l);
  writeJson(file, l);
}
function listLedgers() {
  let names;
  try {
    names = fs.readdirSync(DIR);
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw err;
  }
  return names
    .filter((n) => n.endsWith(".json") && n !== "sweep.json")
    .map((n) => readJson(path.join(DIR, n)))
    .filter(
      (l) =>
        l?.session_id &&
        Array.isArray(l.processes) &&
        Array.isArray(l.worktrees),
    );
}
const saveOrDrop = (l) => {
  if (l.processes.length || l.worktrees.length)
    writeJson(ledgerFile(l.session_id), l);
  else fs.rmSync(ledgerFile(l.session_id), { force: true });
};
const log = (line) => {
  fs.mkdirSync(DIR, { recursive: true });
  fs.appendFileSync(CLOSED_LOG, `${new Date().toISOString()} ${line}\n`);
};

function record(event, command, since) {
  const procs = byPid(snapshot());
  const root = findRoot(procs);
  const found = opened(procs, { since, command, root });
  update(event, (l) => {
    if (root && !l.host) l.host = hostOf(procs, root);
    for (const p of found) {
      if (l.processes.some((e) => e.pid === p.pid && e.created === p.created))
        continue;
      l.processes.push({
        pid: p.pid,
        created: p.created,
        name: p.name,
        cmd: String(p.cmd ?? "").slice(0, 120),
        cwd: event.cwd ?? "",
        kind: p.kind,
        tool_use_id: event.tool_use_id ?? "",
        at: Date.now(),
      });
    }
  });
}

// --- Closing ---
const CLOSE_ON = new Set(["clear", "logout", "prompt_input_exit"]);
function stop(e) {
  if (FAKE) {
    fs.appendFileSync(`${FAKE}.kills`, `kill ${e.pid}\n`);
    return "closed";
  }
  const r = spawnSync("taskkill", ["/T", "/F", "/PID", String(e.pid)], {
    encoding: "utf8",
    windowsHide: true,
  });
  return r.status === 0
    ? "closed"
    : `close failed (${
        String(r.stderr || r.stdout || r.error)
          .trim()
          .split(/\r?\n/)[0]
      })`;
}

// Closes one session's ledger. reason: a SessionEnd reason, or "idle" from the sweep. A SessionEnd also logs its
// reason, entry point and host, the facts that tell a Nimbalyst turn from a `claude -p` end.
export function closeLedger(sessionId, reason, { ppid = 0, entry = "" } = {}) {
  const file = ledgerFile(sessionId);
  const ledger = readJson(file);
  const ending = reason !== "idle";
  if (!ending && !ledger?.processes?.length) return;
  const procs = byPid(snapshot());
  if (ending) {
    const root = ppid ? findRoot(procs, procs.get(ppid) ?? null) : null;
    const host = ledger?.host || (root ? hostOf(procs, root) : "");
    log(
      `${sessionId} session end: reason ${reason}, entry point ${entry || "none"}, host ${host || "unknown"}, mode ${mode()}`,
    );
    // `other` in Nimbalyst is a turn's process ending, not the user closing; an unknown host is kept too (the sweep is the net)
    const close =
      CLOSE_ON.has(reason) ||
      (reason === "other" && host && !/nimbalyst/i.test(host));
    if (!close || !ledger?.processes?.length) return;
  }
  const others = new Set(
    listLedgers()
      .filter((l) => l.session_id !== ledger.session_id)
      .flatMap((l) => l.processes.map((e) => `${e.pid}:${e.created}`)),
  );
  for (const e of ledger.processes) {
    const p = procs.get(e.pid);
    let what;
    if (!p) what = "gone";
    else if (p.created !== e.created || !String(p.cmd ?? "").startsWith(e.cmd))
      what = "dropped (the PID is now another process)";
    else if (others.has(`${e.pid}:${e.created}`))
      what = "kept (another session's ledger names it)";
    else if (mode() !== "on") what = "would close (report mode)";
    else what = stop(e);
    log(`${sessionId} ${what}: pid ${e.pid} ${e.name} "${e.cmd}" (${reason})`);
  }
  ledger.processes = [];
  saveOrDrop(ledger);
}

// Closes the ledgers whose transcript (or, with none, its newest entry) is older than the idle hours
export function sweepLedgers() {
  sweep(`${NAME}/pending`, 1);
  const cutoff = Date.now() - idleHours() * HOUR;
  for (const l of listLedgers()) {
    if (!l.processes.length) continue;
    let last = Math.max(...l.processes.map((e) => e.at));
    if (l.transcript_path) {
      try {
        last = fs.statSync(l.transcript_path).mtimeMs;
      } catch (err) {
        if (err.code !== "ENOENT") throw err;
      }
    }
    if (last < cutoff) closeLedger(l.session_id, "idle");
  }
}
function startSweep() {
  const s = readJson(SWEEP_STATE) ?? {};
  if (s.at && Date.now() - s.at < SWEEP_EVERY) return;
  writeJson(SWEEP_STATE, { at: Date.now() });
  spawn(process.execPath, [HOOK_FILE, "--sweep"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  }).unref();
}

// One line per worktree another session made in this project that is still there; gone ones leave the ledger
const samePath = (a, b) =>
  path.resolve(a || ".").toLowerCase() === path.resolve(b || ".").toLowerCase();
function worktreeLines(event) {
  const lines = [];
  for (const l of listLedgers()) {
    if (l.session_id === event.session_id || !l.worktrees.length) continue;
    const left = l.worktrees.filter((w) => fs.existsSync(w.path));
    if (left.length !== l.worktrees.length)
      saveOrDrop({ ...l, worktrees: left });
    for (const w of left) {
      if (!samePath(w.project, event.cwd)) continue;
      const r = spawnSync("git", ["-C", w.path, "status", "--porcelain"], {
        encoding: "utf8",
        windowsHide: true,
      });
      const state =
        r.status !== 0
          ? "git status failed"
          : r.stdout.trim()
            ? "dirty"
            : "clean";
      lines.push(
        `- ${w.path} (branch ${w.branch || "none"}, ${state}): git worktree remove "${w.path}"`,
      );
    }
  }
  return lines;
}

function onEvent(event) {
  if (process.platform !== "win32" && !FAKE) return;
  const kind = event.hook_event_name;
  if (kind === "PreToolUse" || kind === "PostToolUse") {
    if (
      !/^(Bash|PowerShell)$/.test(event.tool_name ?? "") ||
      !event.session_id ||
      !event.tool_use_id
    )
      return;
    const command = String(event.tool_input?.command ?? "");
    const pending = path.join(PENDING, `${safe(event.tool_use_id)}.json`);
    if (kind === "PreToolUse") {
      const wt = worktreeOf(command, event.cwd);
      if (wt)
        update(event, (l) =>
          l.worktrees.push({ ...wt, project: event.cwd ?? "", at: Date.now() }),
        );
      if (isLaunch(command, event.tool_input?.run_in_background === true))
        writeJson(pending, { at: Date.now() });
      return;
    }
    const saved = readJson(pending);
    if (!saved) return;
    fs.rmSync(pending, { force: true });
    record(event, command, saved.at);
    return;
  }
  if (kind === "SessionEnd") {
    if (!event.session_id) return;
    const args = [
      HOOK_FILE,
      "--close",
      event.session_id,
      String(event.reason ?? ""),
      String(process.ppid),
      process.env.CLAUDE_CODE_ENTRYPOINT ?? "",
    ];
    spawn(process.execPath, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  if (kind !== "SessionStart" && kind !== "UserPromptSubmit") return;
  startSweep();
  if (kind !== "SessionStart") return;
  const lines = worktreeLines(event);
  if (!lines.length) return;
  const text = `[session-cleanup] Worktrees an earlier session made in this project are still there (the hook never removes one):\n${lines.join("\n")}`;
  process.stdout.write(
    JSON.stringify({
      systemMessage: text,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: text,
      },
    }),
  );
}

if (isMain(import.meta.url)) {
  const [flag, ...args] = process.argv.slice(2);
  if (flag === "--close" || flag === "--sweep") {
    if (mode() !== "off") {
      try {
        if (flag === "--sweep") sweepLedgers();
        else
          closeLedger(args[0], args[1], {
            ppid: Number(args[2]) || 0,
            entry: args[3] ?? "",
          });
      } catch (err) {
        crashLog(NAME, err);
      }
    }
  } else runHook(NAME, onEvent);
}
