#!/usr/bin/env node
// usage-report: the setup's anonymous usage collector. It reads this machine's Claude Code transcripts LOCALLY,
// reduces each to counts and short labels — never prompts, replies, code, file names, paths, URLs, project names
// or accounts — and, at most once a day, sends the day's aggregate to the sink (POST /usage). The raw content is
// read, reduced on the spot, and dropped; only the counts are ever written to disk or sent. Turn it off with
// USAGE_REPORT=off (env or a settings.json "env"). THROWAWAY: a stopgap replaced later by the Stratus app's own
// backend behind a "Help improve Stratus" opt-in switch, which this same USAGE_REPORT control becomes.
//
// Modes (the Stop hook usage-report-hook.mjs spawns this detached, so a turn never waits):
//   --scan    reduce transcripts touched since the last scan into ~/.claude/usage-report/pending.json
//   --send    POST each unsent day's aggregate to the sink, then mark it sent
//   (default: --scan then --send)
//   --manifest  rewrite workers/usage-shipped.json from this repo's shipped skills/plugins (run at release)
//
// For tests: USAGE_REPORT_HOME (the ~/.claude to read and write), USAGE_REPORT_URL and USAGE_REPORT_KEY (the sink
// and its token; the defaults are the real ones), USAGE_REPORT_NOW (a fixed Date.now() in ms).
import crypto from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  entries,
  QUESTION_TOOLS,
  typedByUser,
  userText,
} from "../hooks/lib/transcript.mjs";

// The sink's URL and the drive-by-scanner token. General, non-identifying strings; they ship in the public repo.
// The sink is a small forwarder whose only job is POST /usage; it stores the aggregate and checks its shape again
// (a body with anything but counts and short labels is refused there too). A failed send is silent and retried the
// next day. USAGE_REPORT_URL points it elsewhere (tests use a local server). The token is not a secret: it only
// turns away drive-by scanners, so it ships here.
const SINK_URL =
  process.env.USAGE_REPORT_URL || "https://stratus-usage.pages.dev/usage";
const SINK_KEY = process.env.USAGE_REPORT_KEY || "usage-report-public-token";

const SEND_EVERY_MS = 24 * 3600 * 1000;
const now = () => Number(process.env.USAGE_REPORT_NOW) || Date.now();
const home = () =>
  process.env.USAGE_REPORT_HOME || path.join(os.homedir(), ".claude");
const dir = () => path.join(home(), "usage-report");
const pendingFile = () => path.join(dir(), "pending.json");
const idFile = () => path.join(dir(), "id");
const stampFile = () => path.join(dir(), "send.stamp");

const off = () => {
  const v = (process.env.USAGE_REPORT || "").toLowerCase();
  if (v) return v === "off";
  // Honour a settings.json "env": USAGE_REPORT off, read directly (settings env may not reach this process).
  for (const f of ["settings.local.json", "settings.json"]) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(home(), f), "utf8"));
      const s = (j?.env?.USAGE_REPORT || "").toLowerCase();
      if (s) return s === "off";
    } catch {}
  }
  return false;
};

const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);
const readJson = (f, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(f, "utf8"));
  } catch {
    return fallback;
  }
};
const writeJson = (f, o) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, JSON.stringify(o));
};

// A short token: a name/label/extension/command and nothing else. The one gate every stored string passes, so a
// path, URL, email or account can never reach pending.json or the sink even through a bug upstream.
const TOKEN = /^[A-Za-z0-9._-]{1,60}$/;
const token = (s) => (typeof s === "string" && TOKEN.test(s) ? s : null);
const bump = (map, k, by = 1) => {
  const t = token(k);
  if (t) map[t] = (map[t] || 0) + by;
};

// A fresh empty per-day aggregate.
const emptyDay = () => ({
  missing: {},
  added: { skills: [], mcp: [], plugins: [] },
  friction: {
    toolErrors: 0,
    shellFails: 0,
    waits: 0,
    waitBuckets: {},
    guardsOff: [],
  },
  fileTypes: {},
  programs: {},
  labels: {},
});

// ---- which programs shell commands start, by name, from a fixed list only -----------------------------------
// The first word of a command can be a script named after someone's project, so only names on this list are ever
// counted; anything else is dropped unread. Office apps driven over COM (New-Object -ComObject Excel.Application)
// count under the app's name.
const PROGRAMS = new Set(
  (
    "docker docker-compose podman kubectl helm minikube psql pg_dump mysql sqlite3 sqlcmd mongosh redis-cli duckdb " +
    "bq snowsql dbt python python3 py pip pip3 uv conda jupyter node npm npx pnpm yarn bun deno tsc git gh glab " +
    "az aws gcloud terraform vercel wrangler supabase netlify flyctl heroku firebase stripe sentry-cli dotnet java " +
    "mvn gradle go cargo rustc ruby gem php composer r rscript make cmake ffmpeg magick pandoc curl wget playwright " +
    "n8n code winget choco scoop excel winword powerpnt outlook msaccess powerbi pbidesktop tableau ssms azuredatastudio " +
    "blender photoshop figma obs libreoffice soffice ollama"
  ).split(" "),
);
const COM_APPS =
  /-ComObject\s+["']?(Excel|Word|Outlook|PowerPoint|Access|Visio)\./gi;
const SHELL_TOOLS = new Set(["Bash", "PowerShell"]);
const LAUNCHERS = new Set([
  "start",
  "start-process",
  "saps",
  "sudo",
  "exec",
  "time",
  "call",
  "&",
]);

// The listed program names one shell command starts: each segment's first word (after env assignments and
// launchers like `start`), reduced to a bare lowercase name with any folder and .exe/.cmd dropped.
function programsIn(cmd) {
  const out = [];
  if (typeof cmd !== "string") return out;
  for (const m of cmd.matchAll(COM_APPS)) {
    const app = m[1].toLowerCase();
    out.push(
      app === "word"
        ? "winword"
        : app === "powerpoint"
          ? "powerpnt"
          : app === "access"
            ? "msaccess"
            : app,
    );
  }
  for (const seg of cmd.split(/&&|\|\||[;|\n]|\$\(|`/)) {
    const words = seg.match(/"[^"]*"|'[^']*'|\S+/g) || []; // a quoted path with spaces stays one word
    let i = 0;
    while (i < words.length) {
      const w = words[i].replace(/^["'(]+|["')]+$/g, "");
      const low = w.toLowerCase();
      if (
        !w ||
        /^[A-Za-z_][A-Za-z0-9_]*=/.test(w) ||
        LAUNCHERS.has(low) ||
        (i > 0 && low.startsWith("-"))
      ) {
        i++;
        continue;
      }
      const name = (low.split(/[\\/]/).pop() || "").replace(
        /\.(exe|cmd|bat|ps1)$/,
        "",
      );
      if (PROGRAMS.has(name)) out.push(name);
      break;
    }
  }
  return out;
}

// ---- reducing one transcript, content-free -------------------------------------------------------------------

const FILE_TOOLS = new Set(["Read", "Write", "Edit", "NotebookEdit"]);
const extОf = (p) => {
  if (typeof p !== "string") return null;
  const base = p.split(/[\\/]/).pop() || "";
  const m = base.match(/(\.[A-Za-z0-9]{1,8})$/);
  return m ? m[1].toLowerCase() : null;
};

// Reduce a shipped-name set (skills/plugins) from the manifest beside this file; missing → empty sets.
function shipped() {
  const m = readJson(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "usage-shipped.json",
    ),
    {},
  );
  return {
    skills: new Set(m.skills || []),
    plugins: new Set(m.plugins || []),
    switches: new Set(m.switches || []), // env-var names the shipped hooks read; the only keys guardsOff may report
  };
}

// The command names a .claude folder serves, lowercased: its skills/<name>/ folders and every commands/**/<name>.md
// file (nested folders included), links followed. A folder that isn't there serves none; a broken link is skipped;
// any other read error is the caller's crash.
function servedBy(claudeDir, set) {
  const list = (dir) => {
    try {
      return fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ENOTDIR") return [];
      throw err;
    }
  };
  const kind = (dir, e) => {
    if (!e.isSymbolicLink())
      return e.isDirectory() ? "dir" : e.isFile() ? "file" : "";
    try {
      const s = fs.statSync(path.join(dir, e.name));
      return s.isDirectory() ? "dir" : s.isFile() ? "file" : "";
    } catch (err) {
      if (err.code === "ENOENT" || err.code === "ELOOP") return "";
      throw err;
    }
  };
  const skills = path.join(claudeDir, "skills");
  for (const e of list(skills))
    if (kind(skills, e) === "dir") set.add(e.name.toLowerCase());
  const walk = (dir, depth) => {
    for (const e of list(dir)) {
      const k = kind(dir, e);
      if (k === "dir" && depth < 8) walk(path.join(dir, e.name), depth + 1);
      else if (k === "file" && e.name.toLowerCase().endsWith(".md"))
        set.add(e.name.slice(0, -3).toLowerCase());
    }
  };
  walk(path.join(claudeDir, "commands"), 0);
  return set;
}

// The slash-command names this machine CAN serve: shipped skills plus the person's own skills and commands in
// ~/.claude. A project's .claude folders are added per transcript line (projectKnows), so a project's command
// name, which can carry the project's name, is never reported.
function knownCommands(shippedSkills) {
  return servedBy(
    home(),
    new Set([...shippedSkills].map((s) => String(s).toLowerCase())),
  );
}
// A line's folder and every folder above it (Claude Code reads .claude from parents too). A line with no folder
// can't be checked, so it counts as known: a name that might be the person's own is never sent.
const projectCommands = new Map();
const projectKnows = (cwd, name) => {
  if (typeof cwd !== "string" || !cwd) return true;
  if (!projectCommands.has(cwd)) {
    const set = new Set();
    for (let dir = path.resolve(cwd); ; ) {
      servedBy(path.join(dir, ".claude"), set);
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    projectCommands.set(cwd, set);
  }
  return projectCommands.get(cwd).has(name);
};

// What the person added themselves, by name only: skills/plugins not in the shipped manifest, and MCP servers in
// their Claude config. Names are tokens; anything else is dropped.
function addedNames(shippedSets) {
  const skills = [];
  const plugins = [];
  const mcp = [];
  try {
    for (const e of fs.readdirSync(path.join(home(), "skills"), {
      withFileTypes: true,
    }))
      if (e.isDirectory() && !shippedSets.skills.has(e.name) && token(e.name))
        skills.push(e.name);
  } catch {}
  try {
    for (const e of fs.readdirSync(path.join(home(), "plugins"), {
      withFileTypes: true,
    }))
      if (e.isDirectory() && !shippedSets.plugins.has(e.name) && token(e.name))
        plugins.push(e.name);
  } catch {}
  // MCP server names from ~/.claude.json (the setup installs none there, so these are their own).
  const cfg =
    readJson(path.join(path.dirname(home()), ".claude.json"), null) ||
    readJson(path.join(os.homedir(), ".claude.json"), {});
  const servers =
    cfg?.mcpServers && typeof cfg.mcpServers === "object"
      ? Object.keys(cfg.mcpServers)
      : [];
  for (const name of servers) if (token(name)) mcp.push(name);
  return {
    skills: [...new Set(skills)],
    plugins: [...new Set(plugins)],
    mcp: [...new Set(mcp)],
  };
}

// Guards the person switched off: ~/.claude settings "env" keys set to off/observe — but ONLY keys that are the
// setup's own switch names (the shipped manifest's `switches`, the env vars the shipped hooks read). A key the setup
// doesn't own (one of their own private env vars) is never reported, even when set to "off". Reported as the
// setup names it, lowercased with "-" for "_" (DELETE_GUARD → delete-guard).
function guardsOff(switches) {
  const own = switches instanceof Set ? switches : new Set(switches || []);
  const out = new Set();
  for (const f of ["settings.local.json", "settings.json"]) {
    const j = readJson(path.join(home(), f), null);
    const env = j?.env;
    if (env && typeof env === "object")
      for (const [k, v] of Object.entries(env)) {
        const val = String(v).toLowerCase();
        if (
          (val === "off" || val === "observe") &&
          own.has(k) &&
          token(k.toLowerCase().replace(/_/g, "-"))
        )
          out.add(k.toLowerCase().replace(/_/g, "-"));
      }
  }
  return [...out];
}

const bucketOf = (ms) =>
  ms < 60000 ? "lt1m" : ms <= 5 * 60000 ? "1to5m" : "gt5m";

// Reduce one session file's NEW lines (from byte offset `from`) into `day`, counting the session's label once if
// its id is new. Returns the new byte offset. Reads content, keeps only counts.
function reduceSession(file, from, day, seenSessions, sessionId) {
  let size;
  try {
    size = fs.statSync(file).size;
  } catch {
    return from;
  }
  if (size <= from) return from;
  // Read only the new tail; a line cut at the start is dropped (picked up next scan is not needed — offset only
  // advances past whole lines we parsed). We read from `from` to end.
  const fd = fs.openSync(file, "r");
  let text;
  try {
    const buf = Buffer.alloc(size - from);
    fs.readSync(fd, buf, 0, buf.length, from);
    text = buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const list = entries(text);
  const sessionExt = {}; // for the label, this session's extensions (cumulative within this tail)
  const known = day.__known; // Set passed in
  // pending question tool_use by id → timestamp, matched to the user tool_result that answers it
  const askedAt = new Map();

  for (const e of list) {
    const ts = e.timestamp ? Date.parse(e.timestamp) : null;
    // User typed text → missing slash-commands
    if (typedByUser(e)) {
      const t = userText(e).trim();
      // A real slash-command attempt only: starts with a letter, 2+ chars, and is NOT followed by a path separator
      // or more word chars — so a pasted path like "/c/Users/..." or "/tmp/x" is never read as a command name.
      // A plugin's "/plugin:command" is skipped (":" ends no match): the plugin's name is the person's own choice.
      const m = t.match(/^\/([a-z][a-z0-9-]{1,40})(?![\w/\\:-])/i);
      if (m) {
        const name = m[1].toLowerCase();
        if (!known.has(name) && !projectKnows(e.cwd, name))
          bump(day.missing, name);
      }
    }
    // Assistant tool_use blocks
    if (e.type === "assistant" && Array.isArray(e.message?.content))
      for (const b of e.message.content) {
        if (b.type !== "tool_use") continue;
        if (QUESTION_TOOLS.test(b.name)) {
          day.friction.waits++;
          if (ts && b.id) askedAt.set(b.id, ts);
        }
        if (FILE_TOOLS.has(b.name)) {
          const ext = extОf(b.input?.file_path || b.input?.notebook_path);
          if (ext && token(ext)) {
            bump(day.fileTypes, ext);
            sessionExt[ext] = (sessionExt[ext] || 0) + 1;
          }
        }
        if (SHELL_TOOLS.has(b.name))
          for (const prog of programsIn(b.input?.command))
            bump((day.programs ||= {}), prog);
      }
    // User tool_result blocks → errors, shell fails, answered-wait durations
    if (e.type === "user" && Array.isArray(e.message?.content))
      for (const b of e.message.content) {
        if (b.type !== "tool_result") continue;
        if (b.is_error) day.friction.toolErrors++;
        const started = b.tool_use_id && askedAt.get(b.tool_use_id);
        if (started && ts) {
          const bk = bucketOf(ts - started);
          day.friction.waitBuckets[bk] =
            (day.friction.waitBuckets[bk] || 0) + 1;
          askedAt.delete(b.tool_use_id);
        }
        // A Bash non-zero exit: Claude Code marks the result is_error, counted above; also count the shell-specific
        // "exit code" signature so a tool that wraps a failing command still registers, without reading the output.
        const r = e.toolUseResult;
        if (
          b.is_error &&
          r &&
          typeof r === "object" &&
          ("stderr" in r || "stdout" in r || "exitCode" in r) &&
          r.exitCode !== 0
        )
          day.friction.shellFails++;
      }
  }
  // Label this session once, from its extensions (content-free).
  if (sessionId && !seenSessions.has(sessionId)) {
    seenSessions.add(sessionId);
    bump(day.labels, labelFor(sessionExt));
  }
  return size;
}

// A short label from a session's file-extension histogram. No text is read.
function labelFor(ext) {
  const has = (...xs) => xs.some((x) => ext["." + x]);
  if (has("xlsx", "xls", "csv", "ods")) return "spreadsheet";
  if (has("sql")) return "sql";
  if (has("pbix", "pbit")) return "powerbi";
  if (
    has(
      "py",
      "js",
      "ts",
      "tsx",
      "jsx",
      "go",
      "rs",
      "java",
      "cs",
      "rb",
      "php",
      "c",
      "cpp",
      "h",
    )
  )
    return "coding";
  if (has("md", "txt", "docx", "doc", "rtf")) return "writing";
  return "other";
}

// Walk ~/.claude/projects/*/*.jsonl for files changed since the last scan; merge each into today's aggregate.
function scan() {
  const pending = readJson(pendingFile(), {
    byDate: {},
    offsets: {},
    seen: [],
    sentDates: [],
  });
  pending.byDate ||= {};
  pending.offsets ||= {};
  pending.seen ||= [];
  const seenSessions = new Set(pending.seen);
  const today = dayOf(now());
  const day = (pending.byDate[today] ||= emptyDay());

  const shippedSets = shipped();
  day.__known = knownCommands(shippedSets.skills);

  const projects = path.join(home(), "projects");
  let roots = [];
  try {
    roots = fs
      .readdirSync(projects, { withFileTypes: true })
      .filter((e) => e.isDirectory())
      .map((e) => path.join(projects, e.name));
  } catch {}
  for (const root of roots) {
    let files = [];
    try {
      files = fs
        .readdirSync(root)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => path.join(root, f));
    } catch {}
    for (const file of files) {
      const sessionId = path.basename(file, ".jsonl");
      const from = pending.offsets[file] || 0;
      pending.offsets[file] = reduceSession(
        file,
        from,
        day,
        seenSessions,
        sessionId,
      );
    }
  }
  delete day.__known;

  // Re-derive the once-per-day snapshots (added names, guards off) fresh each scan.
  day.added = addedNames(shippedSets);
  day.friction.guardsOff = guardsOff(shippedSets.switches);

  pending.seen = [...seenSessions].slice(-5000);
  writeJson(pendingFile(), pending);
  return pending;
}

// POST one day's aggregate; resolves true on a 2xx, false otherwise (offline, refused, timeout).
function postDay(id, date, dayAgg) {
  return new Promise((resolve) => {
    const body = JSON.stringify({
      v: 1,
      id,
      date,
      missing: dayAgg.missing || {},
      added: dayAgg.added || { skills: [], mcp: [], plugins: [] },
      friction: dayAgg.friction || {},
      fileTypes: dayAgg.fileTypes || {},
      programs: dayAgg.programs || {},
      labels: dayAgg.labels || {},
    });
    let u;
    try {
      u = new URL(SINK_URL);
    } catch {
      return resolve(false);
    }
    const lib = u.protocol === "http:" ? http : https;
    const req = lib.request(
      u,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Usage-Key": SINK_KEY,
          "Content-Length": Buffer.byteLength(body),
        },
        timeout: 4000,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode >= 200 && res.statusCode < 300);
      },
    );
    req.on("timeout", () => req.destroy());
    req.on("error", () => resolve(false));
    req.end(body);
  });
}

// Make/keep this install's random id — tied to nothing identifying.
function installId() {
  let id = "";
  try {
    id = fs.readFileSync(idFile(), "utf8").trim();
  } catch {}
  if (!/^[0-9a-f-]{36}$/.test(id)) {
    id = crypto.randomUUID();
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(idFile(), id);
  }
  return id;
}

async function send() {
  // At most once a day.
  try {
    if (now() - fs.statSync(stampFile()).mtimeMs < SEND_EVERY_MS) return;
  } catch {}
  const pending = readJson(pendingFile(), null);
  if (!pending?.byDate) return;
  const id = installId();
  pending.sentDates ||= [];
  const unsent = Object.keys(pending.byDate)
    .filter((d) => !pending.sentDates.includes(d) && d < dayOf(now()))
    .sort();
  // Yesterday and older are final; today keeps accumulating until tomorrow.
  let anyTried = false;
  for (const date of unsent) {
    anyTried = true;
    const okSent = await postDay(id, date, pending.byDate[date]);
    if (okSent) {
      pending.sentDates.push(date);
      delete pending.byDate[date];
    }
  }
  pending.sentDates = pending.sentDates.slice(-400);
  writeJson(pendingFile(), pending);
  if (anyTried) {
    fs.mkdirSync(dir(), { recursive: true });
    fs.writeFileSync(stampFile(), "");
  }
}

// Rewrite the shipped-names manifest from this repo (release-time). Shipped skills are the ../skills dir; shipped
// plugins are the names the installer sets up, read from scripts/plugins.mjs so the list stays current.
function writeManifest() {
  const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
  let skills = [];
  try {
    skills = fs
      .readdirSync(path.join(repo, "skills"), { withFileTypes: true })
      .filter((e) => e.isDirectory() && TOKEN.test(e.name))
      .map((e) => e.name)
      .sort();
  } catch {}
  let plugins = [];
  try {
    const src = fs.readFileSync(
      path.join(repo, "scripts", "plugins.mjs"),
      "utf8",
    );
    plugins = [
      ...new Set(
        [...src.matchAll(/"([a-zA-Z0-9_-]+)@[a-zA-Z0-9_-]+"/g)].map(
          (m) => m[1],
        ),
      ),
    ]
      .filter((n) => TOKEN.test(n))
      .sort();
  } catch {}
  // The setup's own switch names: each shipped hook's off switch (its runHook name upper-cased with "-"→"_", or an
  // explicit off:"NAME") plus every UPPER_SNAKE env var the hooks read. guardsOff reports a guard-off key only if it
  // is on this list, so a user's own private env var can never leak. Derived the same way the docs-lists test does.
  const offName = (n) => n.toUpperCase().replace(/-/g, "_");
  const switches = new Set();
  const addEnvReads = (src) => {
    for (const m of src.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g))
      switches.add(m[1]);
  };
  // hook off switches (hooks/*.mjs, not the dispatcher itself)
  let hookFiles = [];
  try {
    hookFiles = fs
      .readdirSync(path.join(repo, "hooks"))
      .filter((f) => f.endsWith(".mjs") && !f.startsWith("dispatch"));
  } catch {}
  for (const f of hookFiles) {
    let src = "";
    try {
      src = fs.readFileSync(path.join(repo, "hooks", f), "utf8");
    } catch {}
    addEnvReads(src);
    const run = /\brunHook\(\s*(?:"([\w-]+)"|([A-Za-z_$][\w$]*))/.exec(src);
    if (run) {
      const name =
        run[1] ??
        new RegExp(`\\bconst ${run[2]}\\s*=\\s*"([\\w-]+)"`).exec(src)?.[1];
      if (name)
        switches.add(/\boff:\s*"([A-Z0-9_]+)"/.exec(src)?.[1] ?? offName(name));
    }
  }
  // env reads in the shared hook libraries too
  try {
    for (const f of fs
      .readdirSync(path.join(repo, "hooks", "lib"))
      .filter((f) => f.endsWith(".mjs")))
      addEnvReads(fs.readFileSync(path.join(repo, "hooks", "lib", f), "utf8"));
  } catch {}
  const manifest = { skills, plugins, switches: [...switches].sort() };
  fs.writeFileSync(
    path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "usage-shipped.json",
    ),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--manifest")) {
    writeManifest();
    return;
  }
  if (off()) return;
  const doScan = args.includes("--scan") || !args.includes("--send");
  const doSend = args.includes("--send") || !args.includes("--scan");
  if (doScan) scan();
  if (doSend) await send();
}

main().catch((e) => {
  // Fail silent: a collector error must never surface or block. Only a crash note, locally.
  try {
    fs.mkdirSync(dir(), { recursive: true });
    fs.appendFileSync(
      path.join(dir(), "error.log"),
      `${new Date().toISOString()} ${e.stack || e.message}\n`,
    );
  } catch {}
});
