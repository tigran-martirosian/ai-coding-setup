#!/usr/bin/env node
// usage-dashboard: builds a clickable usage page and opens it in the browser.
// Claude numbers come from usage-scan's JSON; Codex and Gemini numbers from their own
// records on this computer. Output: ~/.claude/reports/usage-dashboard.html (one file, works offline) and
// ~/.claude/reports/usage-dashboard.json (the same data plus builtAt, for the Usage Plan panel).
// The number logic is in usage-dashboard-lib.mjs, inlined into the page at build.
//
// Options:
//   --days N        how far back to load (default 90; the page has its own range buttons)
//   --out FILE      where to write the page
//   --root DIR      Claude transcripts folder, passed on to usage-scan
//   --codex DIR     Codex home (default ~/.codex)
//   --gemini DIR    Gemini home (default ~/.gemini)
//   --plan FILE     plan percentages saved by plan-usage-logger (default ~/.claude/usage-log/plan-usage.jsonl)
//   --ahead FILE    the usual hours of other use for the "Plan ahead" section (default ~/.claude/usage-log/plan-hours.json)
//   --json FILE     where to write the same data as JSON (default: usage-dashboard.json next to --out)
//   --no-open       build only, don't open the browser
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { ARGS, opt } from "./lib/opt.mjs";
import { DAY_MS } from "./lib/days.mjs";
import { CODEX_WEIGHT } from "./lib/prices.mjs";
import { planUse, readSamples } from "./plan-use.mjs";
import { planAhead, readConfig } from "./plan-ahead.mjs";

const started = Date.now();

const here = path.dirname(fileURLToPath(import.meta.url));
const out = opt("out", path.join(os.homedir(), ".claude", "reports", "usage-dashboard.html"));
const jsonOut = opt("json", path.join(path.dirname(out), "usage-dashboard.json"));
const days = Number(opt("days", 90));
const since = Date.now() - days * DAY_MS;

const walk = (dir, list = []) => {
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return list; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, list); else list.push(p);
  }
  return list;
};

// Codex used directly (app, CLI, Nimbalyst): saved sessions hold a running token total.
// Worker runs (`codex exec`) save a session too, unless started with --ephemeral; a saved worker run is matched to its call in the Claude transcripts, not listed twice.
// The plan limits in these records are for the whole account, not just this computer: every record
// that carries them becomes a sample for the "other use" estimate, next to this computer's own tokens.
// A saved codex_exec session belongs to the worker call that began up to 2 s before it and has not run past its length (30 min if unknown) plus 5 s
const CALL_START_SLACK_MS = 2000, CALL_DEFAULT_S = 1800, CALL_END_SLACK_S = 5;
function codexUsage(home, workers) {
  const res = { sessions: [], limits: null };
  const samples = [], cost = new Map();
  const iso = (sec) => sec ? new Date(sec * 1000).toISOString() : null;
  const win = (w) => w ? { u: w.used_percent, r: iso(w.resets_at) } : null;
  const names = {};
  try {
    for (const l of fs.readFileSync(path.join(home, "session_index.jsonl"), "utf8").split("\n")) {
      if (!l) continue;
      const j = JSON.parse(l);
      names[j.id] = j.thread_name;
    }
  } catch {}
  for (const file of [...walk(path.join(home, "sessions")), ...walk(path.join(home, "archived_sessions"))]) {
    if (!/rollout-.*\.jsonl$/.test(file) || fs.statSync(file).mtimeMs < since) continue;
    let meta = {}, tokens = 0, fresh = 0, first = null, last = null, model = "";
    let prev = { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, total_tokens: 0 };
    for (const l of fs.readFileSync(file, "utf8").split("\n")) {
      if (!l) continue;
      let j;
      try { j = JSON.parse(l); } catch { continue; }
      const p = j.payload ?? {};
      if (j.type === "session_meta") meta = p;
      if (j.type === "turn_context" && p.model) model = p.model;
      if (p.type === "token_count") {
        const tot = p.info?.total_token_usage;
        if (tot && tot.total_tokens > prev.total_tokens) {
          // Codex plan weight by the price ratios in CODEX_WEIGHT; fitted on its own, apart from Claude's
          const d = (k) => (tot[k] ?? 0) - (prev[k] ?? 0);
          const c = cost.get(Math.floor(Date.parse(j.timestamp) / 60000)) ?? [0, 0];
          c[0] += (d("input_tokens") - d("cached_input_tokens") + CODEX_WEIGHT.cachedInput * d("cached_input_tokens") + CODEX_WEIGHT.output * d("output_tokens")) / 1e6;
          c[1] += d("total_tokens");
          cost.set(Math.floor(Date.parse(j.timestamp) / 60000), c);
          prev = tot;
          tokens = tot.total_tokens;
          fresh = tot.total_tokens - (tot.cached_input_tokens ?? 0);
        }
        const rl = p.rate_limits;
        if (rl?.primary && (!res.limits || j.timestamp > res.limits.at)) {
          res.limits = { at: j.timestamp, plan: rl.plan_type ?? "", primary: rl.primary, secondary: rl.secondary ?? null };
        }
        const wins = [rl?.primary, rl?.secondary].filter(Boolean);
        const week = wins.find((w) => w.window_minutes > 600);
        if (week) samples.push({ t: j.timestamp, five: win(wins.find((w) => w.window_minutes <= 600)), week: win(week) });
      }
      if (j.timestamp) { first ??= j.timestamp; last = j.timestamp; }
    }
    if (!last) continue;
    if (meta.originator === "codex_exec") {
      // the worker call that was running when this session started
      const start = Date.parse(first);
      const call = workers.filter((w) => {
        const at = Date.parse(w.at);
        return at <= start + CALL_START_SLACK_MS && start <= at + ((w.seconds ?? CALL_DEFAULT_S) + CALL_END_SLACK_S) * 1000;
      }).sort((a, b) => (a.at < b.at ? 1 : -1))[0];
      // "tokens used", as Codex prints at the end of a run, leaves out cached input
      if (call) { call.saved = (call.saved ?? 0) + fresh; continue; }
    }
    const id = meta.id ?? meta.session_id ?? path.basename(file);
    const helper = meta.source?.subagent ? Object.values(meta.source.subagent)[0] : "";
    res.sessions.push({ id, title: names[id] ?? "", at: last, cwd: meta.cwd ?? "", origin: [meta.originator, helper].filter(Boolean).join(" · "), tokens, model });
  }
  // Worker runs that saved no session (--ephemeral) still used the plan: take the
  // token count they printed, or the average of those that printed one
  const printed = workers.filter((w) => w.saved == null && w.tokens != null);
  const average = printed.length ? printed.reduce((n, w) => n + w.tokens, 0) / printed.reduce((n, w) => n + w.processes, 0) : 0;
  for (const w of workers) {
    if (w.saved != null) { w.tokens ??= w.saved; delete w.saved; continue; }
    const tok = w.tokens ?? average * w.processes;
    const c = cost.get(Math.floor(Date.parse(w.at) / 60000)) ?? [0, 0];
    c[0] += tok / 1e6; c[1] += tok;
    cost.set(Math.floor(Date.parse(w.at) / 60000), c);
  }
  res.plan = planUse(samples, [...cost.entries()].sort((a, b) => a[0] - b[0]).map(([min, [w, tok]]) => [min, w, tok]));
  return res;
}

// Gemini through Antigravity: its conversation list has titles and step counts, but no token counts.
async function geminiUsage(home) {
  const res = { conversations: [], available: false };
  let DatabaseSync;
  const warn = process.emitWarning;
  process.emitWarning = () => {}; // node:sqlite prints an "experimental" warning on load
  try { ({ DatabaseSync } = await import("node:sqlite")); } catch { return res; } finally { process.emitWarning = warn; }
  for (const app of ["antigravity-cli", "antigravity"]) {
    const file = path.join(home, app, "conversation_summaries.db");
    if (!fs.existsSync(file)) continue;
    try {
      const db = new DatabaseSync(file, { readOnly: true });
      const rows = db.prepare("select conversation_id, title, step_count, last_modified_time, workspace_uris from conversation_summaries").all();
      db.close();
      res.available = true;
      for (const r of rows) {
        // "YYYY-MM-DD HH:MM:SS.fffffff+00:00"
        const at = new Date(String(r.last_modified_time).replace(" ", "T").replace(/(\.\d{3})\d*/, "$1"));
        if (isNaN(at) || at.getTime() < since) continue;
        let folder = "";
        try { folder = decodeURIComponent(JSON.parse(r.workspace_uris)[0] ?? "").replace(/^file:\/\/\//, ""); } catch {}
        res.conversations.push({ id: r.conversation_id, title: r.title, at: at.toISOString(), steps: r.step_count, folder, app });
      }
    } catch {}
  }
  return res;
}

const scanArgs = [path.join(here, "usage-scan.mjs"), "--json", "--cost", "--days", String(days)];
if (opt("root")) scanArgs.push("--root", opt("root"));
const report = JSON.parse(execFileSync(process.execPath, scanArgs, { encoding: "utf8", maxBuffer: 1 << 30 }));

const usageLog = path.join(os.homedir(), ".claude", "usage-log");
const samples = readSamples(opt("plan", path.join(usageLog, "plan-usage.jsonl")));
const plan = planUse(samples, report.cost ?? []);
const config = readConfig(opt("ahead", path.join(usageLog, "plan-hours.json")));

// The page, its lib and the Nimbalyst panel read the split as "shared" and "others" (the same names everywhere),
// so the config's showSplit / otherUse are renamed here.
const ahead = planAhead(samples, report.cost ?? [], plan, config);
if (ahead) {
  if (ahead.otherUse) { ahead.others = ahead.otherUse; delete ahead.otherUse; }
  for (const v of Object.values(ahead)) if (Array.isArray(v)) for (const h of v) if (h && typeof h === "object" && "otherUse" in h) { h.others = h.otherUse; delete h.otherUse; }
}
const data = {
  generated: new Date().toISOString(),
  computer: os.hostname(),
  sessions: report.sessions,
  plan,
  shared: config.showSplit, // false: no other use of the account, so the page leaves out the split
  ahead,
  codex: codexUsage(opt("codex", path.join(os.homedir(), ".codex")), report.sessions.flatMap((s) => s.workers.filter((w) => w.worker === "codex"))),
  gemini: await geminiUsage(opt("gemini", path.join(os.homedir(), ".gemini"))),
};
// "<" is escaped so a chat title can't close the script tag
const json = JSON.stringify(data).replace(/</g, "\\u003c");
// the lib is a plain ES module: drop the leading "export " so its declarations run as page script
const lib = fs.readFileSync(path.join(here, "usage-dashboard-lib.mjs"), "utf8").replace(/^export /gm, "");
const page = fs.readFileSync(path.join(here, "usage-dashboard.html"), "utf8").replace("/*__LIB__*/", () => lib).replace("__DATA__", () => json);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
// same data for the panel; temp file then rename, so a reader never sees half a file
fs.mkdirSync(path.dirname(jsonOut), { recursive: true });
const tmp = `${jsonOut}.${process.pid}.tmp`;
// buildMs: how long this build took, so the panel can show a progress bar for the next one
fs.writeFileSync(tmp, JSON.stringify({ ...data, builtAt: new Date().toISOString(), buildMs: Date.now() - started }));
fs.renameSync(tmp, jsonOut);
console.log(`Dashboard: ${out} (${report.totals.sessions} Claude chats, ${data.codex.sessions.length} Codex sessions, ${data.gemini.conversations.length} Gemini conversations)`);

if (!ARGS.includes("--no-open")) {
  const [cmd, a] = process.platform === "win32" ? ["cmd", ["/c", "start", "", out]]
    : process.platform === "darwin" ? ["open", [out]] : ["xdg-open", [out]];
  spawn(cmd, a, { detached: true, stdio: "ignore" }).unref();
}
