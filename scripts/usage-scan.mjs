#!/usr/bin/env node
// usage-scan: token, worker, hook and subagent numbers from Claude Code transcripts
// (~/.claude/projects). Prints a short markdown report (or JSON with --json).
// "Tokens" = input + cache creation + cache read + output, counted once per API
// message id. "Calls" = distinct API messages. About 97% is usually cache reads.
//
// Options:
//   --days N          sessions active in the last N days (default 7)
//   --since ISO       start time instead of --days (e.g. 2026-09-30T05:00)
//   --until ISO       end time (default now)
//   --project TEXT    only project folders whose name contains TEXT (case-insensitive)
//   --session PREFIX  only sessions whose id starts with PREFIX (ignores --days)
//   --minutes N       with --session: only the first N minutes of each session
//   --top N           how many sessions to list (default 15)
//   --root DIR        transcripts folder (default ~/.claude/projects)
//   --json            print JSON instead of markdown
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? def : args[i + 1];
};
const flag = (name) => args.includes(`--${name}`);

const root = opt("root", path.join(os.homedir(), ".claude", "projects"));
const project = opt("project", "")?.toLowerCase();
const sessionPrefix = opt("session", "");
const minutes = Number(opt("minutes", 0));
const top = Number(opt("top", 15));
const until = opt("until") ? Date.parse(opt("until")) : Date.now();
const since = sessionPrefix
  ? 0
  : opt("since")
    ? Date.parse(opt("since"))
    : until - Number(opt("days", 7)) * 86400000;

// Only at a command position, so text that merely mentions `codex exec` (sed, grep, echo) doesn't count
const AT_CMD = String.raw`(?:^|[;&|({]|\$\(|\bdo\b|\bthen\b)\s*(?:(?:timeout|time)\s+(?:\S+\s+)?)?`;
const WORKER_RE = {
  codex: new RegExp(AT_CMD + String.raw`codex(?:\.exe)?\s+(?:--\S+\s+)*exec\b`, "gm"),
  agy: new RegExp(AT_CMD + String.raw`agy(?:\.exe)?\s+-p\b`, "gm"),
};
const HOOK_RE = /PreToolUse:(\w+) hook[^:]*:\s*\[([\w-]+)\]/;

const readLines = (file) => {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};

const textOf = (content) =>
  typeof content === "string" ? content
  : Array.isArray(content) ? content.map((c) => c.text ?? "").join("\n") : "";

// Scan one transcript file. `window` limits by time; returns null if nothing in it.
function scan(file, window) {
  const lines = readLines(file);
  const stamps = lines.map((l) => Date.parse(l.timestamp)).filter((t) => !isNaN(t));
  if (!stamps.length) return null;
  const start = Math.min(...stamps);
  const end = window.minutes ? Math.min(window.until, start + window.minutes * 60000) : window.until;
  const from = window.minutes ? start : window.since;
  const inWin = (l) => {
    const t = Date.parse(l.timestamp);
    return !isNaN(t) && t >= from && t <= end;
  };

  const msgs = new Map(); // message id -> usage
  const models = {};
  const tools = {};
  const toolUses = new Map(); // tool_use id -> {name, input, t}
  const workers = [];
  const hooks = [];
  let title = "";
  let first = Infinity, last = 0;

  for (const l of lines) {
    if (l.type === "ai-title" && l.aiTitle) title = l.aiTitle;
    if (l.type === "summary" && l.summary && !title) title = l.summary;
    if (!inWin(l)) continue;
    const t = Date.parse(l.timestamp);
    if (l.type === "assistant" && l.message?.usage) {
      first = Math.min(first, t); last = Math.max(last, t);
      const id = l.message.id ?? l.uuid;
      if (!msgs.has(id)) {
        const u = l.message.usage;
        const tok = (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) +
          (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);
        const ctx = tok - (u.output_tokens ?? 0);
        msgs.set(id, { tok, ctx });
        const m = l.message.model ?? "?";
        if (m !== "<synthetic>") models[m] = (models[m] ?? 0) + tok;
      }
      for (const c of l.message.content ?? []) {
        if (c.type !== "tool_use") continue;
        tools[c.name] = (tools[c.name] ?? 0) + 1;
        toolUses.set(c.id, { name: c.name, input: c.input ?? {}, t });
      }
    }
    if (l.type === "user" && Array.isArray(l.message?.content)) {
      for (const c of l.message.content) {
        if (c.type !== "tool_result") continue;
        const use = toolUses.get(c.tool_use_id);
        const text = textOf(c.content);
        const hm = text.match(HOOK_RE);
        if (hm) {
          hooks.push({ hook: hm[2], tool: hm[1], detail: use?.name === "Agent" || use?.name === "Task"
            ? use.input.subagent_type ?? "untyped" : "" , t, toolUseId: c.tool_use_id });
          continue;
        }
        if (!use || !["Bash", "PowerShell"].includes(use.name)) continue;
        const cmd = String(use.input.command ?? "");
        for (const [w, re] of Object.entries(WORKER_RE)) {
          let n = (cmd.match(re) ?? []).length;
          if (!n) continue;
          // A shell function wrapping the worker (`run() { codex ... }`) runs once per call of it
          for (const [def, fn] of cmd.matchAll(/(\w+)\s*\(\)\s*\{[^}]*\}/g)) {
            if (!new RegExp(re.source).test(def)) continue;
            const calls = (cmd.match(new RegExp(`(^|[\\s;&|(])${fn}\\s+["'$\\w]`, "gm")) ?? []).length;
            n += calls - (def.match(re) ?? []).length;
          }
          const bg = use.input.run_in_background === true;
          workers.push({
            worker: w, processes: n, seconds: bg ? null : Math.round((t - use.t) / 1000),
            ok: !c.is_error, background: bg, web: w === "codex" && /--search/.test(cmd),
            what: (use.input.description ?? "").slice(0, 80),
          });
        }
      }
    }
  }
  // After a hook block, what did Claude do next? (retry, a worker, or something else)
  const ordered = [...toolUses.entries()];
  for (const h of hooks) {
    const i = ordered.findIndex(([id]) => id === h.toolUseId);
    const next = ordered[i + 1]?.[1];
    if (!next) { h.next = "nothing"; continue; }
    const cmd = String(next.input.command ?? "");
    h.next = /\b(codex|agy)\b/.test(cmd) ? "worker"
      : next.name === ordered[i][1].name ? "retried" : next.name;
  }
  if (!msgs.size && !hooks.length) return null;
  const vals = [...msgs.values()];
  return {
    tokens: vals.reduce((a, v) => a + v.tok, 0),
    calls: vals.length,
    maxContext: vals.reduce((a, v) => Math.max(a, v.ctx), 0),
    models, tools, workers, hooks, title,
    first: isFinite(first) ? new Date(first).toISOString() : null,
    last: last ? new Date(last).toISOString() : null,
  };
}

// Collect sessions
const sessions = [];
if (!fs.existsSync(root)) { console.error(`No transcripts folder: ${root}`); process.exit(1); }
for (const proj of fs.readdirSync(root, { withFileTypes: true })) {
  if (!proj.isDirectory()) continue;
  if (project && !proj.name.toLowerCase().includes(project)) continue;
  const pdir = path.join(root, proj.name);
  for (const f of fs.readdirSync(pdir)) {
    if (!f.endsWith(".jsonl")) continue;
    const id = f.slice(0, -6);
    if (sessionPrefix && !id.startsWith(sessionPrefix)) continue;
    const file = path.join(pdir, f);
    if (!sessionPrefix && fs.statSync(file).mtimeMs < since) continue;
    const win = { since, until, minutes };
    const main = scan(file, win);
    const subs = [];
    const sdir = path.join(pdir, id, "subagents");
    if (fs.existsSync(sdir)) {
      for (const s of fs.readdirSync(sdir)) {
        if (!s.endsWith(".jsonl")) continue;
        // Subagents use the parent's time window (for --minutes, the parent's first N minutes)
        const pw = minutes && main?.first
          ? { since: Date.parse(main.first), until: Math.min(until, Date.parse(main.first) + minutes * 60000), minutes: 0 }
          : { since, until, minutes: 0 };
        const r = scan(path.join(sdir, s), pw);
        if (!r) continue;
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(sdir, s.replace(/\.jsonl$/, ".meta.json")), "utf8")); } catch {}
        subs.push({ id: s.slice(0, -6), type: meta.agentType ?? "?", description: meta.description ?? "", ...r });
      }
    }
    if (!main && !subs.length) continue;
    const m = main ?? { tokens: 0, calls: 0, maxContext: 0, models: {}, tools: {}, workers: [], hooks: [], title: "" };
    sessions.push({
      project: proj.name, id, ...m,
      subagents: subs,
      total: m.tokens + subs.reduce((a, s) => a + s.tokens, 0),
    });
  }
}
sessions.sort((a, b) => b.total - a.total);

// Totals
const all = sessions.flatMap((s) => [s, ...s.subagents]);
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
const workers = all.flatMap((s) => s.workers);
const hooks = all.flatMap((s) => s.hooks);
const byType = {};
for (const s of sessions) for (const a of s.subagents) {
  const model = Object.entries(a.models).sort((x, y) => y[1] - x[1])[0]?.[0] ?? "?";
  const k = `${a.type} (${model.replace(/^claude-/, "")})`;
  byType[k] ??= { runs: 0, tokens: 0, calls: 0, max: 0 };
  byType[k].runs++; byType[k].tokens += a.tokens; byType[k].calls += a.calls;
  byType[k].max = Math.max(byType[k].max, a.tokens);
}
const report = {
  window: sessionPrefix ? { session: sessionPrefix, minutes: minutes || null }
    : { since: new Date(since).toISOString(), until: new Date(until).toISOString(), minutes: minutes || null },
  project: project || null,
  totals: {
    sessions: sessions.length, tokens: sum(sessions, (s) => s.total),
    mainTokens: sum(sessions, (s) => s.tokens), subagentTokens: sum(sessions, (s) => s.total - s.tokens),
    subagentRuns: sum(sessions, (s) => s.subagents.length),
  },
  workers: {
    codexProcesses: sum(workers.filter((w) => w.worker === "codex"), (w) => w.processes),
    agyProcesses: sum(workers.filter((w) => w.worker === "agy"), (w) => w.processes),
    calls: workers.length, failed: workers.filter((w) => !w.ok).length, list: workers,
  },
  hooks: hooks.reduce((acc, h) => {
    acc[h.hook] ??= { blocks: 0, next: {} };
    acc[h.hook].blocks++; acc[h.hook].next[h.next] = (acc[h.hook].next[h.next] ?? 0) + 1;
    return acc;
  }, {}),
  subagentsByType: byType,
  sessions: sessions.map((s) => ({
    project: s.project, id: s.id, title: s.title, first: s.first, last: s.last,
    total: s.total, main: s.tokens, calls: s.calls, maxContext: s.maxContext,
    subagents: s.subagents.map((a) => ({ id: a.id, type: a.type, description: a.description, tokens: a.tokens, calls: a.calls, maxContext: a.maxContext, models: a.models })),
  })),
};

if (flag("json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const M = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : `${Math.round(n / 1e3)}k`;
// Project folders are paths with ":", "\" and "/" turned into "-"; drop the home folder or drive part
const homeKey = os.homedir().replace(/[:\\/]/g, "-") + "-";
const shortName = (p) => p === homeKey.slice(0, -1) ? "~" : (p.startsWith(homeKey) ? p.slice(homeKey.length) : p.replace(/^[A-Za-z]--(\w+-)?/, "")) || p;
const out = [];
const w = report.window;
out.push(`# Usage scan`);
out.push(w.session ? `Session ${w.session}${w.minutes ? `, first ${w.minutes} min` : ""}${project ? `, project filter "${project}"` : ""}.`
  : `${w.since.slice(0, 16)} to ${w.until.slice(0, 16)} UTC${project ? `, project filter "${project}"` : ""}.`);
out.push(`Tokens = input + cache + output, once per API message (mostly cache reads).`, ``);
const T = report.totals;
out.push(`**Total: ${M(T.tokens)}** in ${T.sessions} sessions (main ${M(T.mainTokens)}, subagents ${M(T.subagentTokens)} in ${T.subagentRuns} runs).`, ``);
out.push(`## Top sessions`, ``, `| Session | Project | Title | Total | Main (calls) | Max context | Subagents |`, `|---|---|---|---|---|---|---|`);
for (const s of report.sessions.slice(0, top)) {
  const subs = s.subagents.map((a) => `${a.type} ${M(a.tokens)}/${a.calls}`).join(", ") || "-";
  out.push(`| ${s.id.slice(0, 8)} | ${shortName(s.project)} | ${(s.title || "").slice(0, 40).replace(/\|/g, "/")} | ${M(s.total)} | ${M(s.main)} (${s.calls}) | ${M(s.maxContext)} | ${subs} |`);
}
out.push(``, `## Subagents by type`, ``);
const types = Object.entries(byType).sort((a, b) => b[1].tokens - a[1].tokens);
if (!types.length) out.push(`None.`);
else {
  out.push(`| Type (main model) | Runs | Tokens | Avg per run | Largest |`, `|---|---|---|---|---|`);
  for (const [k, v] of types) out.push(`| ${k} | ${v.runs} | ${M(v.tokens)} | ${M(v.tokens / v.runs)} | ${M(v.max)} |`);
}
out.push(``, `## Workers`, ``);
const W = report.workers;
out.push(`Codex: ${W.codexProcesses} processes, agy: ${W.agyProcesses}, in ${W.calls} shell calls (${W.failed} failed).`);
const timed = W.list.filter((x) => x.seconds != null);
if (timed.length) out.push(`Foreground call time: ${Math.min(...timed.map((x) => x.seconds))}-${Math.max(...timed.map((x) => x.seconds))} s.`);
for (const x of W.list.slice(0, 10)) out.push(`- ${x.worker}${x.web ? " (web)" : ""} ×${x.processes}${x.seconds != null ? `, ${x.seconds} s` : ", background"}${x.ok ? "" : ", FAILED"}: ${x.what || "(no description)"}`);
out.push(``, `## Hook blocks`, ``);
const H = Object.entries(report.hooks);
if (!H.length) out.push(`None.`);
for (const [k, v] of H) out.push(`- ${k}: ${v.blocks} blocks; next step: ${Object.entries(v.next).map(([n, c]) => `${n} ${c}`).join(", ")}`);
console.log(out.join("\n"));
