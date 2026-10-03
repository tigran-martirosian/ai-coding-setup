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
//   --cost            with --json: add `cost`, a list of [minute, plan weight, tokens] (see planWeight)
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

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

// How heavily one API message counts against the plan, in rough relative units. Anthropic
// doesn't publish the formula, so this follows the price ratios: cache reads 0.1x input,
// cache writes 1.25x (2x for the 1-hour cache), output 5x, and Opus : Sonnet : Haiku = 5 : 3 : 1.
// The dashboard fits the scale (percent of the plan per unit) from the recorded plan percentages.
const FAMILY = [[/opus/, 5], [/sonnet/, 3], [/haiku/, 1]];
const planWeight = (u, model) => {
  const w = FAMILY.find(([re]) => re.test(model))?.[1] ?? 3;
  const write = u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return w * ((u.input_tokens ?? 0) + 1.25 * (write - write1h) + 2 * write1h +
    0.1 * (u.cache_read_input_tokens ?? 0) + 5 * (u.output_tokens ?? 0)) / 1e6;
};
// What one API message would cost at Anthropic's list prices (dollars per million tokens:
// input, output, cache read; cache writes cost 1.25x input, 2x for the 1-hour cache). A plan
// is not billed this way: the figure only says what the same tokens cost on the pay-as-you-go API.
// Prices as of 2026-09; a model that is not listed is priced like Sonnet.
const PRICE = [[/opus-5-5/, 4, 20, 0.2], [/opus/, 5, 25, 0.5], [/fable-5-1|mythos-5-1/, 10, 50, 0.25], [/fable|mythos/, 10, 50, 1],
  [/sonnet-4/, 3, 15, 0.3], [/sonnet/, 2, 10, 0.2], [/haiku/, 1, 5, 0.1]];
const apiCost = (u, model) => {
  const [, inp, outp, read] = PRICE.find(([re]) => re.test(model)) ?? [null, 2, 10, 0.2];
  const write = u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return (inp * ((u.input_tokens ?? 0) + 1.25 * (write - write1h) + 2 * write1h) +
    read * (u.cache_read_input_tokens ?? 0) + outp * (u.output_tokens ?? 0)) / 1e6;
};
const cents = (o) => Object.fromEntries(Object.entries(o).map(([d, v]) => [d, Math.round(v * 1e4) / 1e4]));
const withCost = flag("cost");
const cost = new Map(); // minute -> [plan weight, tokens], over all transcripts
const costSeen = new Set(); // a resumed chat repeats earlier messages in a new file

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
  const days = {}; // local date -> model -> tokens
  const usd = {}; // local date -> dollars at API prices
  const tools = {};
  const skills = {}; // skill name -> times invoked
  const agents = {}; // subagent type -> times started
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
        const day = (days[dayKey(t)] ??= {});
        day[m] = (day[m] ?? 0) + tok;
        if (m !== "<synthetic>") usd[dayKey(t)] = (usd[dayKey(t)] ?? 0) + apiCost(u, m);
        if (withCost && m !== "<synthetic>" && !costSeen.has(id)) {
          costSeen.add(id);
          const c = cost.get(Math.floor(t / 60000)) ?? [0, 0];
          c[0] += planWeight(u, m); c[1] += tok;
          cost.set(Math.floor(t / 60000), c);
        }
      }
      for (const c of l.message.content ?? []) {
        if (c.type !== "tool_use") continue;
        tools[c.name] = (tools[c.name] ?? 0) + 1;
        if (c.name === "Skill" && c.input?.skill) skills[c.input.skill] = (skills[c.input.skill] ?? 0) + 1;
        if (c.name === "Agent" || c.name === "Task") {
          const a = c.input?.subagent_type ?? "general-purpose";
          agents[a] = (agents[a] ?? 0) + 1;
        }
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
          // Codex ends each run with "tokens used <n>"; missing when the output went to a file or the background
          const used = w === "codex" ? [...text.matchAll(/tokens used\s+([\d,]+)/g)].map((m) => Number(m[1].replace(/,/g, ""))) : [];
          workers.push({
            tokens: used.length ? used.reduce((a, b) => a + b, 0) : null,
            worker: w, processes: n, seconds: bg ? null : Math.round((t - use.t) / 1000),
            ok: !c.is_error, background: bg, web: w === "codex" && /--search/.test(cmd),
            what: (use.input.description ?? "").slice(0, 80),
            at: new Date(use.t).toISOString(),
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
    firstContext: vals[0]?.ctx ?? 0, // size of the first call = what is loaded before any work
    models, days, usd, tools, skills, agents, workers, hooks, title,
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
    const m = main ?? { tokens: 0, calls: 0, maxContext: 0, firstContext: 0, models: {}, days: {}, usd: {}, tools: {}, skills: {}, agents: {}, workers: [], hooks: [], title: "" };
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
// What actually gets used, to spot things loaded into every session and never called
const tally = (objs) => {
  const o = {};
  for (const x of objs) for (const [k, v] of Object.entries(x)) o[k] = (o[k] ?? 0) + v;
  return Object.fromEntries(Object.entries(o).sort((a, b) => b[1] - a[1]));
};
// MCP tools are counted per server: mcp__<server>__<tool>
const byServer = (tools) => {
  const o = {};
  for (const [k, v] of Object.entries(tools)) {
    const n = k.startsWith("mcp__") ? `${k.split("__")[1]} (MCP)` : k;
    o[n] = (o[n] ?? 0) + v;
  }
  return o;
};
const firsts = sessions.map((s) => s.firstContext).filter(Boolean).sort((a, b) => a - b);
const use = {
  tools: tally(all.map((s) => byServer(s.tools))),
  skills: tally(all.map((s) => s.skills)),
  agents: tally(all.map((s) => s.agents)),
  models: tally(all.map((s) => s.models)),
  firstCall: { median: firsts[Math.floor(firsts.length / 2)] ?? 0, max: firsts.at(-1) ?? 0 },
  over200k: sessions.filter((s) => s.maxContext > 200e3).length,
  over300k: sessions.filter((s) => s.maxContext > 300e3).length,
};
// Project folders are paths with ":", "\" and "/" turned into "-"; drop the home folder or drive part
const homeKey = os.homedir().replace(/[:\\/]/g, "-") + "-";
const shortName = (p) => p === homeKey.slice(0, -1) ? "~" : (p.startsWith(homeKey) ? p.slice(homeKey.length) : p.replace(/^[A-Za-z]--(\w+-)?/, "")) || p;
const report = {
  window: sessionPrefix ? { session: sessionPrefix, minutes: minutes || null }
    : { since: new Date(since).toISOString(), until: new Date(until).toISOString(), minutes: minutes || null },
  project: project || null,
  totals: {
    sessions: sessions.length, tokens: sum(sessions, (s) => s.total),
    mainTokens: sum(sessions, (s) => s.tokens), subagentTokens: sum(sessions, (s) => s.total - s.tokens),
    subagentRuns: sum(sessions, (s) => s.subagents.length),
    usd: Math.round(sum(all, (s) => sum(Object.values(s.usd), (v) => v)) * 100) / 100,
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
  use,
  sessions: sessions.map((s) => ({
    project: s.project, name: shortName(s.project), id: s.id, title: s.title, first: s.first, last: s.last,
    total: s.total, main: s.tokens, calls: s.calls, maxContext: s.maxContext,
    models: s.models, days: s.days, usd: cents(s.usd), workers: [s, ...s.subagents].flatMap((x) => x.workers),
    subagents: s.subagents.map((a) => ({ id: a.id, type: a.type, description: a.description, tokens: a.tokens, calls: a.calls, maxContext: a.maxContext, models: a.models, days: a.days, usd: cents(a.usd) })),
  })),
  ...(withCost ? { cost: [...cost.entries()].sort((a, b) => a[0] - b[0]).map(([min, [w, tok]]) => [min, Math.round(w * 1e5) / 1e5, tok]) } : {}),
};

if (flag("json")) { console.log(JSON.stringify(report, null, 2)); process.exit(0); }

const M = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : `${Math.round(n / 1e3)}k`;
const out = [];
const w = report.window;
out.push(`# Usage scan`);
out.push(w.session ? `Session ${w.session}${w.minutes ? `, first ${w.minutes} min` : ""}${project ? `, project filter "${project}"` : ""}.`
  : `${w.since.slice(0, 16)} to ${w.until.slice(0, 16)} UTC${project ? `, project filter "${project}"` : ""}.`);
out.push(`Tokens = input + cache + output, once per API message (mostly cache reads).`, ``);
const T = report.totals;
out.push(`**Total: ${M(T.tokens)}** in ${T.sessions} sessions (main ${M(T.mainTokens)}, subagents ${M(T.subagentTokens)} in ${T.subagentRuns} runs).`,
  `The same tokens would cost about **$${T.usd.toLocaleString("en-US", { maximumFractionDigits: 0 })}** on the pay-as-you-go API (list prices; the plan is not billed this way).`, ``);
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
out.push(``, `## What gets used`, ``);
const U = report.use;
const listOf = (o) => Object.entries(o).slice(0, 30).map(([k, v]) => `${k} ${v}`).join(", ") || "none";
out.push(`- Models: ${Object.entries(U.models).map(([k, v]) => `${k.replace(/^claude-/, "")} ${M(v)} (${Math.round(v / (T.tokens || 1) * 100)}%)`).join(", ") || "none"}`);
out.push(`- Session start (first call): median ${M(U.firstCall.median)}, largest ${M(U.firstCall.max)}. Sessions that grew past 200k: ${U.over200k}, past 300k: ${U.over300k}.`);
out.push(`- Tool calls: ${listOf(U.tools)}`);
out.push(`- Skills: ${listOf(U.skills)}`);
out.push(`- Subagents: ${listOf(U.agents)}`);
console.log(out.join("\n"));
