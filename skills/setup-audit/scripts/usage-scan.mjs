#!/usr/bin/env node
// usage-scan: token, worker, hook and subagent numbers from Claude Code transcripts
// (~/.claude/projects). Prints a short markdown report (or JSON with --json).
// "Tokens" = input + cache creation + cache read + output, counted once per API
// message id. "Calls" = distinct API messages. About 97% is usually cache reads.
//
// Options:
//   --days N          sessions active in the last N days (default 14)
//   --since ISO       start time instead of --days (e.g. YYYY-MM-DDTHH:MM)
//   --until ISO       end time (default now)
//   --project TEXT    only project folders whose name contains TEXT (case-insensitive)
//   --session PREFIX  only sessions whose id starts with PREFIX (ignores --days)
//   --minutes N       with --session: only the first N minutes of each session
//   --top N           how many sessions to list (default 15)
//   --root DIR        transcripts folder (default ~/.claude/projects)
//   --json            print JSON instead of markdown
//   --cost            with --json: add `cost`, a list of [minute, plan weight, tokens] (see apiCost)
//   --no-cache        parse every transcript (default: reuse per-file results in ~/.claude/reports/usage-scan-cache.jsonl)
//   --cache-file PATH use another cache file
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { BIG_READ_GATE, COMMAND_EXPLAIN, NOTE_ANYWHERE_RE, POWERSHELL_TOOL, RETIRED_NO_LINE, RETIRED_TOO_LONG, SETTLED_NOTE, WORKER_SIZE_NOTE } from "../../../hooks/lib/texts.mjs";
import { ARGS, opt } from "./lib/opt.mjs";
import { DAY_MS, DEFAULT_DAYS, day as dayKey } from "./lib/days.mjs";
import { TOO_FEW, defaultRoot } from "./lib/chats.mjs";
import { PRICE, PRICE_UNLISTED } from "./lib/prices.mjs";

const flag = (name) => ARGS.includes(`--${name}`);

const root = opt("root", defaultRoot());
const project = opt("project", "")?.toLowerCase();
const sessionPrefix = opt("session", "");
const minutes = Number(opt("minutes", 0));
const top = Number(opt("top", 15));
const until = opt("until") ? Date.parse(opt("until")) : Date.now();
const since = sessionPrefix
  ? 0
  : opt("since")
    ? Date.parse(opt("since"))
    : until - Number(opt("days", DEFAULT_DAYS)) * DAY_MS;

// Only at a command position, so text that merely mentions `codex exec` (sed, grep, echo) doesn't count
const AT_CMD = String.raw`(?:^|[;&|({]|\$\(|\bdo\b|\bthen\b)\s*(?:(?:timeout|time)\s+(?:\S+\s+)?)?`;
const WORKER_RE = {
  // either the raw command or the wrapper script (~/.claude/workers/ask-codex.sh)
  codex: new RegExp(AT_CMD + String.raw`(?:codex(?:\.exe)?\s+(?:--\S+\s+)*exec\b|(?:bash\s+)?\S*ask-codex(?:\.sh)?(?=\s))`, "gm"),
  agy: new RegExp(AT_CMD + String.raw`agy(?:\.exe)?\s+-p\b`, "gm"),
};
// The worker command (~/.claude/workers/ask.mjs) picks the worker itself and prints which one answered
const ASK_RE = new RegExp(AT_CMD + String.raw`(?:node\s+)?\S*workers/ask(?:\.mjs)?\s+(?!--status)`, "gm");
const ASK_ANSWERED = [[/answered by Codex/, "codex"], [/answered by Antigravity/, "agy"]];
const HOOK_RE = /PreToolUse:(\w+) hook[^:]*:\s*\[([\w-]+)\]/;

const readLines = (file) => {
  try {
    return fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  } catch { return []; }
};

// How heavily one API message counts against the plan, in relative units. Anthropic doesn't publish the
// formula, so the weight is the message's list price in dollars (apiCost, from the PRICE table in lib/prices.mjs).
// plan-use fits the scale (percent of the plan per unit) from the recorded plan percentages, so only the ratios matter.
// A model that is not in PRICE is priced like Sonnet and named on stderr, since its weight also moves the plan split.
const unpriced = new Map();
process.on("exit", () => {
  if (unpriced.size) console.error(`usage-scan: no price for ${[...unpriced].map(([m, n]) => `${m} (${n} messages)`).join(", ")}; counted as Sonnet`);
});
const apiCost = (u, model, quiet = false) => {
  if (model === "<synthetic>") return 0; // written by Claude Code itself, no API call
  let price = PRICE.find(([re]) => re.test(model));
  if (!price) { if (!quiet) unpriced.set(model, (unpriced.get(model) ?? 0) + 1); price = PRICE_UNLISTED; }
  const [, inp, outp, read] = price;
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

// Requests the setup itself causes: per file, every API request (last usage of its message id), the user
// messages (turns) with the requests under each, runs of failed tool calls, and hook blocks.
const emptyWaste = () => ({ reqs: new Map(), turns: [], streaks: [], blocks: [], unmatched: 0, launches: [] });
const WASTE_HOOK_RE = /hook (?:error|blocking error)[^:]*:\s*(?:\[[^\]]*\]:?\s*)?([a-z][a-z-]+):/i;
const BOARD_RE = /update_session_meta|update_session_board/;
// A settled prompt, and the text the hook background-tasks.mjs adds to one whose results already came as notifications
const SETTLED_RE = /^\s*\[System: background task\(s\) you launched have settled/;
// WORKER_SIZE_NOTE (worker-size.mjs) is an attachment line (hook_additional_context) in the helper's transcript
const SETTLED_ITEM_RE = /^- "(.*)" [a-z][a-z ()0-9-]{0,30}$/gm;
const REPEAT_MS = 15 * 60000;
// User prompts that are not typed by the user: the harness's own text
const NOT_TYPED_RE = /^\s*(?:This session is being continued|\[Resuming after|\[Request interrupted|<system-reminder>|<local-command|<command-name>\/clear)/;
// Launch kinds: explicit run_in_background:true on Agent/Task or Bash; an Agent/Task launch the harness ran async
// by default (result "Async agent launched ..."); a Bash call the harness moved to the background after its timeout
const ASYNC_AGENT_RE = /Async agent launched/;
const MOVED_BASH_RE = /^Command did not complete within[^\n]*moved to the background/;
const WAKE_RE = /^\s*(?:\[System: background task|<task-notification>)/;
// A commit, tag or public-repo push, or a release skill: after it the work of the session is done
const COMMIT_RE = new RegExp(AT_CMD + String.raw`(?:git\s+(?:-C\s+(?:"[^"]*"|'[^']*'|\S+)\s+)?(?:commit|tag)\b|(?:bash\s+)?\S*repo-push\.sh\b)`, "m");
const isCommit = (x) => (x.name === "Bash" && COMMIT_RE.test(String(x.input.command ?? "")))
  || (x.name === "Skill" && /^(?:[\w-]+:)?(?:release-setup|deploy)$/.test(String(x.input.skill ?? "")));
// What woke a wake-up turn: the launching tool call (tool-use-id in the message, or the agent's description), else the summary line
const firstWords = (t, n) => String(t ?? "").replace(/\s+/g, " ").trim().split(" ").slice(0, n).join(" ");
const wakeSource = (text, uses, agentByDesc) => {
  if (/^\s*\[System: background task/.test(text)) return "system message (background tasks settled)";
  const summary = text.match(/<summary>([\s\S]*?)<\/summary>/)?.[1] ?? "";
  const use = uses.get(text.match(/<tool-use-id>([^<]+)</)?.[1]);
  const fromUse = (u) => {
    if (u.name === "Monitor") return "Monitor";
    if (u.name === "Agent" || u.name === "Task") return "agent " + (u.input.subagent_type ?? "general-purpose");
    if (u.name !== "Bash" && u.name !== "PowerShell") return u.name;
    const cmd = String(u.input.command ?? "").replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, "");
    const note = cmd.match(NOTE_ANYWHERE_RE)?.[1];
    return "bash " + (note ? firstWords(note, 4) : firstWords(cmd, 1));
  };
  if (use) return fromUse(use);
  const ag = summary.match(/^Agent "(.*)"/)?.[1];
  if (ag !== undefined) return "agent " + (agentByDesc.get(ag) ?? "(unlinked)");
  if (/^Monitor/i.test(summary)) return "Monitor";
  const bg = summary.match(/^Background command "(.*)"/)?.[1];
  if (bg !== undefined) return "bash (unlinked) " + firstWords(bg, 4);
  return "other";
};
// Quality counters. Done-claim = the closing text of a main-chat turn says the work is done/fixed/working.
// Redo = a typed message within 30 min after it says it is not. Check = a shell call that ran a test, build or check.
const DONE_RE = /\b(?:done|fixed|it works|now works|works now|working now|verified|all (?:tests? )?pass(?:ed|es|ing)?|(?:is|are) (?:now )?(?:fixed|working|complete|in place)|have been (?:fixed|applied|updated)|resolved)\b/i;
const REDO_RE = /\b(?:still (?:broken|fail\w*|not|wrong|the same|happens|see|get|doesn'?t|isn'?t)|(?:doesn'?t|does not|didn'?t|did not|isn'?t|is not|not) (?:work|working|fixed|fix|change|changed)|not fixed|same (?:error|problem|issue)|you didn'?t|you did not|(?:is|are|in|the|still) (?:wrong|broken)|(?:fails?|failed|broke|happens|happened|errors?) again)\b/i;
const CHECK_RE = /\bnode\s+(?:--check\b|\S*test[-\w.]*)|\bnpm\s+(?:test|t|run\s+\S+)\b|\bgradlew?(?:\.bat)?\b|\bpytest\b|--check\b|\b(?:tsc|vitest|jest|mocha)\b|\bcargo\s+(?:test|build|check)\b|\bgo\s+(?:test|build|vet)\b/i;
const CHECK_DESC_RE = /\b(?:check|test|verif|validat)/i;
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const isCheck = (e) => (e.name === "Bash" || e.name === "PowerShell") && (CHECK_RE.test(String(e.input.command ?? "")) || CHECK_DESC_RE.test(String(e.input.description ?? "")));
const REDO_MS = 30 * 60000;
const ctxOf = (u = {}) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);

// Scan one transcript file. `window` limits by time; returns null if nothing in it. `sub`: a subagent file.
// `info` is filled with minT/maxT (first and last timestamp in the file, null if none) and `ledger`, the plan-cost
// entries [message id, minute, plan weight, tokens(, model if unpriced)] of the new messages, so the caller can add
// them to the shared cost table (and cache them) without scanning again.
function scan(file, window, sub = false, info = {}) {
  const lines = readLines(file);
  const stamps = lines.map((l) => Date.parse(l.timestamp)).filter((t) => !isNaN(t));
  info.minT = null; info.maxT = null; info.ledger = [];
  if (!stamps.length) return null;
  const start = Math.min(...stamps);
  info.minT = start; info.maxT = stamps.reduce((a, t) => (t > a ? t : a), -Infinity);
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
  const waste = emptyWaste();
  const wasteTool = new Map(); // tool_use id -> { id: request id, name }
  const wasteUses = new Map(); // tool_use id -> { name, input }, for wake-up sources
  const agentByDesc = new Map(); // Agent description -> subagent type
  // Prompt cache: what was read from it, written to it, sent uncached; and the mid-session rewrites
  // (a call after the first, context over 20k, that read back under half of the previous call's context
  // and wrote over half of its own), by their likely cause
  const promptCache = { input: 0, write: 0, read: 0, rewrites: {} };
  let prevCall = null, compactedSince = false;
  let turn = null, run = null;
  const endRun = () => { if (run && run.n >= 3) waste.streaks.push(run); run = null; };
  const helper = { toolIds: new Set(), bashIds: new Set(), noteAt: null, compacts: 0 }; // subagent files: size-note position, compactions
  const agentBg = {}; // main files: helper agent id -> launched in the background?
  const wasteLine = (l) => {
    if (sub && l.type === "system" && l.subtype === "compact_boundary") helper.compacts++;
    if (sub && l.type === "attachment" && l.attachment?.type === "hook_additional_context" && helper.noteAt === null
      && [].concat(l.attachment.content).join("\n").includes(WORKER_SIZE_NOTE)) helper.noteAt = helper.toolIds.size;
    if (!sub && l.isSidechain) return;
    if (l.type === "attachment") {
      if (!sub && turn?.settled && l.attachment?.type === "hook_additional_context" && [].concat(l.attachment.content).join("\n").includes(SETTLED_NOTE)) turn.note = true;
      return;
    }
    if (l.type === "assistant" && l.message?.id) {
      const id = l.message.id;
      let r = waste.reqs.get(id);
      if (!r) { r = { usage: null, tools: [] }; waste.reqs.set(id, r); turn?.ids.push(id); }
      r.usage = l.message.usage ?? r.usage;
      for (const c of l.message.content ?? []) {
        if (c.type === "text" && c.text?.trim()) turn?.ev.push({ k: "text", text: c.text, t: Date.parse(l.timestamp) });
        if (c.type !== "tool_use") continue;
        turn?.ev.push({ k: "tool", name: c.name, input: c.input ?? {} });
        r.tools.push({ name: c.name, input: c.input ?? {} });
        if (sub) { helper.toolIds.add(c.id); if (c.name === "Bash") helper.bashIds.add(c.id); }
        if (!sub && !wasteTool.has(c.id) && c.input?.run_in_background === true && ["Bash", "Agent", "Task"].includes(c.name)) waste.launches.push(c.name === "Bash" ? "bash" : "agent");
        wasteTool.set(c.id, { id, name: c.name });
        wasteUses.set(c.id, { name: c.name, input: c.input ?? {} });
        if ((c.name === "Agent" || c.name === "Task") && c.input?.description) agentByDesc.set(c.input.description, c.input.subagent_type ?? "general-purpose");
      }
    } else if (l.type === "user") {
      const c = l.message?.content;
      const text = typeof c === "string" ? c : Array.isArray(c) ? c.find((x) => x.type === "text")?.text : undefined;
      if (text !== undefined && !l.isMeta && !sub) {
        endRun();
        // wake-up: the harness started this turn itself (a background task or agent finished), not the user
        const wake = l.origin?.kind === "task-notification" || WAKE_RE.test(text);
        turn = { ids: [], ev: [], text, wake, at: waste.reqs.size, source: wake ? wakeSource(text, wasteUses, agentByDesc) : null,
          t: Date.parse(l.timestamp), settled: SETTLED_RE.test(text), typed: !wake && !NOT_TYPED_RE.test(text), note: false };
        waste.turns.push(turn);
      }
      if (!Array.isArray(c)) return;
      for (const x of c) {
        if (x.type !== "tool_result") continue;
        const use = wasteTool.get(x.tool_use_id);
        const body = textOf(x.content);
        const hook = body.match(WASTE_HOOK_RE)?.[1] ?? (body.includes(COMMAND_EXPLAIN) ? "command-explain" : null);
        if (hook && x.is_error) {
          const reason = hook !== "command-explain" ? "" : body.includes(RETIRED_TOO_LONG) ? "too long"
            : body.includes(RETIRED_NO_LINE) ? "no note (or no empty line before it)" : body.includes(POWERSHELL_TOOL) ? "PowerShell tool" : "other";
          if (!use) waste.unmatched++;
          waste.blocks.push({ hook, reason, id: use?.id ?? null });
        }
        if (sub) continue;
        const input = wasteUses.get(x.tool_use_id)?.input;
        if (use && (use.name === "Agent" || use.name === "Task")) {
          const agentId = body.match(/agentId: (\w+)/)?.[1];
          if (agentId) agentBg[agentId] = input.run_in_background === true || (input.run_in_background !== false && ASYNC_AGENT_RE.test(body));
        }
        if (use && (use.name === "Agent" || use.name === "Task") && input.run_in_background !== true && input.run_in_background !== false && ASYNC_AGENT_RE.test(body)) waste.launches.push("agent");
        if (use?.name === "Bash" && MOVED_BASH_RE.test(body.slice(0, 400))) waste.launches.push("moved");
        if (x.is_error) { run ??= { n: 0, tool: use?.name ?? "?" }; run.n++; } else endRun();
      }
    }
  };

  for (const l of lines) {
    if (l.type === "ai-title" && l.aiTitle) title = l.aiTitle;
    if (l.type === "summary" && l.summary && !title) title = l.summary;
    if (!inWin(l)) continue;
    wasteLine(l);
    const t = Date.parse(l.timestamp);
    if (l.type === "system" && l.subtype === "compact_boundary") compactedSince = true;
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
        if (m !== "<synthetic>") {
          const written = u.cache_creation_input_tokens ?? 0;
          promptCache.input += u.input_tokens ?? 0; promptCache.write += written; promptCache.read += u.cache_read_input_tokens ?? 0;
          // lost = read back under half of what the previous call held (big new tool results alone are growth, not a miss)
          if (prevCall && ctx > 20000 && written > ctx / 2 && (u.cache_read_input_tokens ?? 0) < prevCall.ctx / 2) {
            const gap = (t - prevCall.t) / 60000;
            const why = compactedSince ? "after a compaction" : m !== prevCall.model ? "model switch"
              : gap > 60 ? "idle over 1 h" : gap > 5 ? "idle 5-60 min" : "other";
            const r = (promptCache.rewrites[why] ??= { n: 0, tokens: 0 });
            r.n++; r.tokens += written;
          }
          prevCall = { t, model: m, ctx }; compactedSince = false;
          const e = [id, Math.floor(t / 60000), apiCost(u, m, true), tok];
          if (!PRICE.some(([re]) => re.test(m))) e.push(m);
          info.ledger.push(e);
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
        // Some refusals arrive as the hook's bare text, "[big-read-gate] ...", with no "PreToolUse:" prefix
        const bare = !text.match(HOOK_RE) && c.is_error === true && use ? text.match(/^\[([a-z]+(?:-[a-z]+)+)\]/) : null;
        const hm = text.match(HOOK_RE) ?? (bare && [bare[0], use.name, bare[1]]);
        if (hm) {
          hooks.push({ hook: hm[2], tool: hm[1], detail: use?.name === "Agent" || use?.name === "Task"
            ? use.input.subagent_type ?? "untyped" : "" , t, toolUseId: c.tool_use_id });
          continue;
        }
        if (!use || !["Bash", "PowerShell"].includes(use.name)) continue;
        const cmd = String(use.input.command ?? "");
        const asked = (cmd.match(ASK_RE) ?? []).length;
        if (asked) {
          const bg = use.input.run_in_background === true;
          // no "answered by" line: no worker could answer (or the output went to the background)
          const by = ASK_ANSWERED.find(([re]) => re.test(text))?.[1];
          workers.push({
            tokens: null, worker: by ?? "none", processes: asked, seconds: bg ? null : Math.round((t - use.t) / 1000),
            ok: bg ? !c.is_error : Boolean(by), background: bg, web: /workers\/ask(?:\.mjs)?\s+(?:--think\s+)?--web\b/.test(cmd),
            what: (use.input.description ?? "").slice(0, 80),
            at: new Date(use.t).toISOString(),
          });
        }
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
            ok: !c.is_error, background: bg, web: w === "codex" && /--search|ask-codex(?:\.sh)?\s+(?:--think\s+)?--web\b/.test(cmd),
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
    // the blocked call was not scanned (before the --days window, or on a line without usage)
    if (i < 0) { h.next = "call not seen"; continue; }
    const next = ordered[i + 1]?.[1];
    if (!next) { h.next = "nothing"; continue; }
    const cmd = String(next.input.command ?? "");
    h.next = /\b(codex|agy)\b|workers\/ask/.test(cmd) ? "worker"
      : next.name === ordered[i][1].name ? "retried" : next.name;
  }
  endRun();
  if (!msgs.size && !hooks.length) return null;
  const vals = [...msgs.values()];
  return {
    waste, agentBg, promptCache,
    helper: { toolCalls: helper.toolIds.size, bashCalls: helper.bashIds.size, noteAt: helper.noteAt, compacts: helper.compacts },
    tokens: vals.reduce((a, v) => a + v.tok, 0),
    calls: vals.length,
    maxContext: vals.reduce((a, v) => Math.max(a, v.ctx), 0),
    firstContext: vals[0]?.ctx ?? 0, // size of the first call = what is loaded before any work
    models, days, usd, tools, skills, agents, workers, hooks, title,
    first: isFinite(first) ? new Date(first).toISOString() : null,
    last: last ? new Date(last).toISOString() : null,
  };
}

// Per-file cache. A transcript is parsed once over its whole time range (window-independent) and the result kept,
// keyed by absolute path + size + mtimeMs, in a JSON-lines file (header line with the version, then one line per file).
// A cached file is used when all its timestamps lie inside the asked window (otherwise it is parsed again with the
// window). The version (SCAN_VERSION, below) is raised by hand when the code that decides the result changes.
// --no-cache: neither read nor write it. --cache-file PATH: another cache file.
const useCache = !flag("no-cache");
const cacheFile = opt("cache-file", path.join(os.homedir(), ".claude", "reports", "usage-scan-cache.jsonl"));
// Raise SCAN_VERSION by hand whenever an edit changes what a parsed file yields (a pattern, a field, a price); a
// comment or layout edit leaves it. The time zone is part of the version because the cached days are local dates.
const SCAN_VERSION = 6;
const CACHE_VERSION = `${SCAN_VERSION}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
// The cache file's lines, read in chunks: the file is hundreds of MB, past what one string can hold
function* cacheLines(file) {
  const fd = fs.openSync(file, "r");
  const buf = Buffer.alloc(1 << 24);
  let rest = Buffer.alloc(0);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0;) {
      let chunk = Buffer.concat([rest, buf.subarray(0, n)]);
      let i;
      while ((i = chunk.indexOf(10)) !== -1) {
        if (i > 0) yield chunk.toString("utf8", 0, i);
        chunk = chunk.subarray(i + 1);
      }
      rest = Buffer.from(chunk);
    }
    if (rest.length) yield rest.toString("utf8");
  } finally { fs.closeSync(fd); }
}
// Only two Maps live in an entry (waste.reqs and the unpriced counts); no number in a parse result is NaN or infinite
// (lines without a valid timestamp are skipped). Plain JSON.parse is several times faster than one with a reviver.
const encode = (e) => JSON.stringify({ ...e, unpriced: [...e.unpriced], result: e.result && { ...e.result, waste: { ...e.result.waste, reqs: [...e.result.waste.reqs] } } });
const decode = (line) => {
  const e = JSON.parse(line);
  e.unpriced = new Map(e.unpriced);
  if (e.result) e.result.waste.reqs = new Map(e.result.waste.reqs);
  return e;
};
const cache = new Map(); // absolute path -> entry
const rawLine = new Map(); // path -> its line in the cache file as read, written back unchanged
const cacheSeen = new Set();
let cacheDirty = false;
if (useCache && fs.existsSync(cacheFile)) {
  try {
    const rows = cacheLines(cacheFile);
    try {
      const head = rows.next();
      if (!head.done && JSON.parse(head.value).version === CACHE_VERSION) {
        for (const r of rows) { const e = decode(r); cache.set(e.file, e); rawLine.set(e.file, r); }
      } else console.error("usage-scan: cache is from other scan code, rebuilding it");
    } finally { rows.return(); } // closes the file, also when the loop stopped early: an open file blocks the rename on Windows
  } catch (e) {
    cache.clear();
    console.error(`usage-scan: cache unreadable (${e.message}), rebuilding it`);
  }
  if (!cache.size) cacheDirty = true;
}
function saveCache() {
  for (const f of [...cache.keys()]) if (!cacheSeen.has(f) && !fs.existsSync(f)) { cache.delete(f); cacheDirty = true; }
  if (!cacheDirty) return;
  fs.mkdirSync(path.dirname(cacheFile), { recursive: true });
  const tmp = `${cacheFile}.${process.pid}.tmp`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeSync(fd, JSON.stringify({ version: CACHE_VERSION }) + "\n");
    for (const e of cache.values()) fs.writeSync(fd, (rawLine.get(e.file) ?? encode(e)) + "\n");
  } finally { fs.closeSync(fd); }
  // Another scan reading the cache at this moment can make the rename fail on Windows; this run's output is still right
  try { fs.renameSync(tmp, cacheFile); } catch (e) {
    fs.rmSync(tmp, { force: true });
    console.error(`usage-scan: cache not saved (${e.message}); the next run reads the files again`);
  }
}
// Add a file's plan-cost entries to the shared cost table (a resumed chat repeats earlier messages in a new file)
function addLedger(ledger) {
  if (!withCost) return;
  for (const [id, minute, weight, tok, model] of ledger) {
    if (costSeen.has(id)) continue;
    costSeen.add(id);
    if (model) unpriced.set(model, (unpriced.get(model) ?? 0) + 1);
    const c = cost.get(minute) ?? [0, 0];
    c[0] += weight; c[1] += tok;
    cost.set(minute, c);
  }
}
// scan() through the cache; `st` = fs.statSync(file)
function scanFile(file, st, win, sub) {
  if (!useCache || win.minutes) {
    const info = {};
    const r = scan(file, win, sub, info);
    addLedger(info.ledger);
    return r;
  }
  cacheSeen.add(file);
  let e = cache.get(file);
  if (!e || e.size !== st.size || e.mtimeMs !== st.mtimeMs) {
    const before = new Map(unpriced);
    const info = {};
    const result = scan(file, { since: -Infinity, until: Infinity, minutes: 0 }, sub, info);
    // the cached figures are replayed below; undo what this parse counted on the shared table
    const counted = new Map();
    for (const [m, n] of unpriced) if (n !== (before.get(m) ?? 0)) counted.set(m, n - (before.get(m) ?? 0));
    unpriced.clear(); for (const [m, n] of before) unpriced.set(m, n);
    e = { file, size: st.size, mtimeMs: st.mtimeMs, minT: info.minT, maxT: info.maxT, ledger: info.ledger, unpriced: counted, result };
    cache.set(file, e); rawLine.delete(file); cacheDirty = true;
  }
  if (e.minT !== null && (e.minT < win.since || e.maxT > win.until)) {
    const info = {};
    const r = scan(file, win, sub, info);
    addLedger(info.ledger);
    return r;
  }
  for (const [m, n] of e.unpriced) unpriced.set(m, (unpriced.get(m) ?? 0) + n);
  addLedger(e.ledger);
  return e.result;
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
    const fst = fs.statSync(file);
    if (!sessionPrefix && fst.mtimeMs < since) continue;
    const win = { since, until, minutes };
    const main = scanFile(file, fst, win, false);
    const subs = [];
    const sdir = path.join(pdir, id, "subagents");
    if (fs.existsSync(sdir)) {
      for (const s of fs.readdirSync(sdir)) {
        if (!s.endsWith(".jsonl")) continue;
        // Subagents use the parent's time window (for --minutes, the parent's first N minutes)
        const pw = minutes && main?.first
          ? { since: Date.parse(main.first), until: Math.min(until, Date.parse(main.first) + minutes * 60000), minutes: 0 }
          : { since, until, minutes: 0 };
        const sfile = path.join(sdir, s);
        const r = scanFile(sfile, fs.statSync(sfile), pw, true);
        if (!r) continue;
        let meta = {};
        try { meta = JSON.parse(fs.readFileSync(path.join(sdir, s.replace(/\.jsonl$/, ".meta.json")), "utf8")); } catch {}
        subs.push({ id: s.slice(0, -6), type: meta.agentType ?? "?", description: meta.description ?? "", ...r });
      }
    }
    if (!main && !subs.length) continue;
    const m = main ?? { waste: emptyWaste(), promptCache: { input: 0, write: 0, read: 0, rewrites: {} }, tokens: 0, calls: 0, maxContext: 0, firstContext: 0, models: {}, days: {}, usd: {}, tools: {}, skills: {}, agents: {}, workers: [], hooks: [], title: "" };
    sessions.push({
      project: proj.name, id, ...m,
      subagents: subs,
      total: m.tokens + subs.reduce((a, s) => a + s.tokens, 0),
    });
  }
}
if (useCache) saveCache();
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
// Prompt cache over main chats and subagents; hitRate = share of the input read from the cache
const promptCache = { input: 0, write: 0, read: 0, rewrites: {} };
for (const s of all) {
  const c = s.promptCache;
  promptCache.input += c.input; promptCache.write += c.write; promptCache.read += c.read;
  for (const [why, r] of Object.entries(c.rewrites)) {
    const t = (promptCache.rewrites[why] ??= { n: 0, tokens: 0 });
    t.n += r.n; t.tokens += r.tokens;
  }
}
{
  const total = promptCache.input + promptCache.write + promptCache.read;
  promptCache.hitRate = total ? Math.round((promptCache.read / total) * 1e4) / 1e4 : null;
}
// Project folders are paths with ":", "\" and "/" turned into "-"; drop the home folder or drive part
const homeKey = os.homedir().replace(/[:\\/]/g, "-") + "-";
const shortName = (p) => p === homeKey.slice(0, -1) ? "~" : (p.startsWith(homeKey) ? p.slice(homeKey.length) : p.replace(/^[A-Za-z]--(\w+-)?/, "")) || p;

// Wasted requests: turns, streaks, board-only and ToolSearch-only come from the main chats; hook blocks
// and the token split also from subagents.
const median = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const wasted = { tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 }, requests: 0, turns: [], perProject: {}, streaks: [],
  hooks: {}, commandExplain: {}, unmatched: 0, boardOnly: { complete: { n: 0, tokens: 0 }, other: { n: 0, tokens: 0 } }, toolSearchOnly: { n: 0, tokens: 0 },
  wake: { n: 0, tokens: 0, perProject: {} }, background: { n: 0, perProject: {} },
  wakeSources: {}, wakeTextOnly: 0,
  afterCommit: { sessions: 0, withCommit: 0, requests: 0, tokens: 0, perSession: [] }, bigSubagents: { n: 0, tokens: 0, share: 0 },
  settled: { turns: [], perProject: {}, total: { n: 0, requests: 0, tools: 0, withNote: 0, repeats: 0, tokens: 0 } },
  quality: { minClaims: TOO_FEW, perProject: {}, total: {} },
  launches: { perProject: {}, total: { agent: 0, bash: 0, moved: 0 } }, typed: { perProject: {}, total: { typed: 0, tokens: 0, median: 0, mean: 0 } } };
for (const s of all) {
  const W = s.waste;
  const main = sessions.includes(s);
  const reqCtx = (id) => ctxOf(W.reqs.get(id).usage ?? {});
  for (const r of W.reqs.values()) {
    const u = r.usage ?? {};
    wasted.requests++;
    wasted.tokens.input += u.input_tokens ?? 0; wasted.tokens.cacheWrite += u.cache_creation_input_tokens ?? 0;
    wasted.tokens.cacheRead += u.cache_read_input_tokens ?? 0; wasted.tokens.output += u.output_tokens ?? 0;
    if (!main || !r.tools.length) continue;
    const t = ctxOf(u);
    if (r.tools.every((x) => BOARD_RE.test(x.name))) {
      const k = r.tools[0].input.phase === "complete" ? "complete" : "other";
      wasted.boardOnly[k].n++; wasted.boardOnly[k].tokens += t;
    }
    if (r.tools.every((x) => x.name === "ToolSearch")) { wasted.toolSearchOnly.n++; wasted.toolSearchOnly.tokens += t; }
    for (const x of r.tools) {
      if (!["Bash", "Agent", "Task"].includes(x.name) || x.input.run_in_background !== true) continue;
      const pn = shortName(s.project);
      wasted.background.n++; wasted.background.perProject[pn] = (wasted.background.perProject[pn] ?? 0) + 1;
    }
  }
  wasted.unmatched += W.unmatched;
  for (const b of W.blocks) {
    const tok = b.id ? reqCtx(b.id) : 0;
    const h = (wasted.hooks[b.hook] ??= { blocks: 0, tokens: 0 });
    h.blocks++; h.tokens += tok;
    if (b.hook === "command-explain") {
      const c = (wasted.commandExplain[b.reason] ??= { blocks: 0, tokens: 0 });
      c.blocks++; c.tokens += tok;
    }
  }
  if (!main) continue;
  const pname = shortName(s.project);
  const lp = (wasted.launches.perProject[pname] ??= { agent: 0, bash: 0, moved: 0 });
  for (const k of W.launches) { lp[k]++; wasted.launches.total[k]++; }
  // Settled turns: requests and tool calls until the next user message or wake-up; repeats = an item named in a settled prompt within 15 min before
  const seenItems = new Map();
  for (const t of W.turns) {
    if (!t.settled) continue;
    const items = [...t.text.matchAll(SETTLED_ITEM_RE)].map((m) => m[1]);
    const repeat = items.some((i) => seenItems.has(i) && t.t - seenItems.get(i) <= REPEAT_MS);
    for (const i of items) seenItems.set(i, t.t);
    const row = { project: pname, session: s.id.slice(0, 8), requests: t.ids.length, tools: sum(t.ids, (id) => W.reqs.get(id).tools.length), note: t.note, repeat, tokens: sum(t.ids, reqCtx) };
    wasted.settled.turns.push(row);
    const sp = (wasted.settled.perProject[pname] ??= { n: 0, requests: 0, tools: 0, withNote: 0, repeats: 0, tokens: 0 });
    for (const o of [sp, wasted.settled.total]) { o.n++; o.requests += row.requests; o.tools += row.tools; o.withNote += row.note ? 1 : 0; o.repeats += row.repeat ? 1 : 0; o.tokens += row.tokens; }
  }
  // Tokens per typed user message: the typed turn plus the wake-up turns after it, up to the next typed message
  const reqTok = (id) => { const u = W.reqs.get(id).usage ?? {}; return ctxOf(u) + (u.output_tokens ?? 0); };
  const tp = (wasted.typed.perProject[pname] ??= { typed: 0, tokens: 0, groups: [] });
  let group = null;
  for (const t of W.turns) {
    if (t.typed) { group = { tokens: 0 }; tp.groups.push(group); tp.typed++; }
    const tok = sum(t.ids, reqTok);
    tp.tokens += tok;
    if (group) group.tokens += tok;
  }
  // Quality: done-claims (closing text of a turn), redo (typed REDO_RE message within 30 min after), unchecked (edit in the turn, no check after the last one)
  const qp = (wasted.quality.perProject[pname] ??= { claims: 0, redos: 0, edited: 0, unchecked: 0, redoExamples: [], uncheckedExamples: [] });
  W.turns.forEach((t, i) => {
    const last = t.ev.at(-1);
    if (last?.k !== "text" || !DONE_RE.test(last.text)) return;
    const ex = { session: s.id.slice(0, 8), at: new Date(last.t).toISOString() };
    qp.claims++;
    const nextTyped = W.turns.slice(i + 1).find((x) => x.typed);
    if (nextTyped && nextTyped.t - last.t <= REDO_MS && REDO_RE.test(nextTyped.text)) {
      qp.redos++; if (qp.redoExamples.length < 3) qp.redoExamples.push({ ...ex, reply: firstWords(last.text, 12), answer: firstWords(nextTyped.text, 12) });
    }
    const lastEdit = t.ev.findLastIndex((e) => e.k === "tool" && EDIT_TOOLS.has(e.name));
    if (lastEdit < 0) return;
    qp.edited++;
    if (!t.ev.slice(lastEdit + 1).some((e) => e.k === "tool" && isCheck(e))) {
      qp.unchecked++; if (qp.uncheckedExamples.length < 3) qp.uncheckedExamples.push({ ...ex, reply: firstWords(last.text, 12) });
    }
  });
  for (const t of W.turns) {
    if (!t.ids.length) continue;
    const row = { project: shortName(s.project), session: s.id.slice(0, 8), requests: t.ids.length, tokens: sum(t.ids, reqCtx), text: t.text.replace(/\s+/g, " ").trim().slice(0, 60) };
    wasted.turns.push(row);
    const p = (wasted.perProject[row.project] ??= []);
    p.push(row.requests);
    if (t.wake) {
      const wp = (wasted.wake.perProject[row.project] ??= { n: 0, tokens: 0 });
      wp.n++; wp.tokens += row.tokens; wasted.wake.n++; wasted.wake.tokens += row.tokens;
      const ws = (wasted.wakeSources[t.source] ??= { n: 0, tokens: 0 });
      ws.n++; ws.tokens += row.tokens;
      if (!W.reqs.get(t.ids.at(-1)).tools.length) wasted.wakeTextOnly++;
    }
  }
  if (s.maxContext > 100e3) {
    const ids = [...W.reqs.keys()];
    const last = ids.findLastIndex((id) => W.reqs.get(id).tools.some(isCommit));
    wasted.afterCommit.sessions++;
    if (last >= 0) {
      wasted.afterCommit.withCommit++;
      wasted.afterCommit.requests += ids.length - 1 - last;
      const tail = sum(ids.slice(last + 1), reqCtx);
      wasted.afterCommit.tokens += tail;
      const after = W.turns.filter((t) => t.at > last);
      wasted.afterCommit.perSession.push({ project: shortName(s.project), session: s.id.slice(0, 8), requests: ids.length - 1 - last, tokens: tail,
        userMessages: after.filter((t) => !t.wake).length, wakeTurns: after.filter((t) => t.wake).length });
    }
  }
  for (const k of W.streaks) wasted.streaks.push({ project: shortName(s.project), session: s.id.slice(0, 8), n: k.n, tool: k.tool });
}
wasted.turnCount = wasted.turns.length;
wasted.longestTurns = [...wasted.turns].sort((a, b) => b.requests - a.requests).slice(0, 5);
wasted.requestsPerMessage = { median: median(wasted.turns.map((t) => t.requests)), max: Math.max(0, ...wasted.turns.map((t) => t.requests)) };
wasted.perProject = Object.fromEntries(Object.entries(wasted.perProject).map(([k, v]) => [k, { messages: v.length, median: median(v), max: Math.max(...v) }]));
wasted.streakCount = wasted.streaks.length;
wasted.longestStreak = Math.max(0, ...wasted.streaks.map((k) => k.n));
wasted.worstStreaks = [...wasted.streaks].sort((a, b) => b.n - a.n).slice(0, 5);
const subRuns = sessions.flatMap((s) => s.subagents), bigSubs = subRuns.filter((a) => a.maxContext > 150e3);
wasted.bigSubagents = { n: bigSubs.length, tokens: sum(bigSubs, (a) => a.tokens), share: sum(bigSubs, (a) => a.tokens) / (sum(subRuns, (a) => a.tokens) || 1) };
wasted.settled.worst = [...wasted.settled.turns].sort((a, b) => b.requests - a.requests).slice(0, 5);
delete wasted.settled.turns;
const allGroups = [];
for (const [k, v] of Object.entries(wasted.typed.perProject)) {
  allGroups.push(...v.groups);
  wasted.typed.perProject[k] = { typed: v.typed, tokens: v.tokens, median: median(v.groups.map((g) => g.tokens)), mean: v.typed ? Math.round(v.tokens / v.typed) : 0 };
  wasted.typed.total.typed += v.typed; wasted.typed.total.tokens += v.tokens;
}
{
  const Q = wasted.quality, rate = (n, d) => d < TOO_FEW ? null : Math.round(1000 * n / d) / 1000;
  const tot = { claims: 0, redos: 0, edited: 0, unchecked: 0 };
  for (const q of Object.values(Q.perProject)) for (const k of Object.keys(tot)) tot[k] += q[k];
  for (const q of [...Object.values(Q.perProject), tot]) { q.tooFew = q.claims < TOO_FEW; q.redoRate = rate(q.redos, q.claims); q.uncheckedRate = rate(q.unchecked, q.claims); }
  Q.total = tot;
}
wasted.typed.total.median = median(allGroups.map((g) => g.tokens));
wasted.typed.total.mean = wasted.typed.total.typed ? Math.round(wasted.typed.total.tokens / wasted.typed.total.typed) : 0;
delete wasted.turns; delete wasted.streaks;
// Helper runs past 150k context: what they did before and after the worker-size note
const topModel = (m) => Object.entries(m).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "?";
const bigHelpers = { runs: [] };
for (const s of sessions) for (const a of s.subagents) {
  if (a.maxContext <= 150e3) continue;
  const bg = s.agentBg?.[a.id.replace(/^agent-/, "")];
  const h = a.helper, noted = h.noteAt !== null;
  bigHelpers.runs.push({
    project: shortName(s.project), session: s.id.slice(0, 8), id: a.id, type: a.type, model: topModel(a.models),
    background: bg === undefined ? null : bg, tokens: a.tokens, calls: a.calls, maxContext: a.maxContext, toolCalls: h.toolCalls,
    noted, before: noted ? h.noteAt : h.toolCalls, after: noted ? h.toolCalls - h.noteAt : 0, compacts: h.compacts,
    bashShare: h.toolCalls ? Math.round(1000 * h.bashCalls / h.toolCalls) / 1000 : 0,
  });
}
bigHelpers.runs.sort((a, b) => b.tokens - a.tokens);
{
  const R = bigHelpers.runs, n = R.length, cnt = (f) => R.filter(f).length, top1 = (f) => { const c = {}; for (const r of R) c[f(r)] = (c[f(r)] ?? 0) + 1; return Object.entries(c).sort((x, y) => y[1] - x[1])[0]; };
  const noted = R.filter((r) => r.noted), tools = sum(R, (r) => r.toolCalls);
  bigHelpers.pattern = !n ? "No helper run passed 150k." : {
    runs: n, background: cnt((r) => r.background === true), foreground: cnt((r) => r.background === false), unknownLaunch: cnt((r) => r.background === null),
    withNote: noted.length, medianAfterNote: median(noted.map((r) => r.after)), compacted: cnt((r) => r.compacts > 0),
    bashShare: tools ? Math.round(1000 * sum(R, (r) => r.toolCalls * r.bashShare) / tools) / 1000 : 0,
    commonType: top1((r) => r.type)?.join(" "), commonModel: top1((r) => r.model)?.join(" "),
  };
}
// Context of the first API call (what is loaded before any work), median per project
const firstBy = { main: {}, helper: {} };
for (const s of sessions) {
  if (s.firstContext) (firstBy.main[shortName(s.project)] ??= []).push(s.firstContext);
  for (const a of s.subagents) if (a.firstContext) (firstBy.helper[shortName(s.project)] ??= []).push(a.firstContext);
}
const firstCallByProject = Object.fromEntries(Object.entries(firstBy).map(([k, o]) => [k, Object.fromEntries(Object.entries(o).map(([p, v]) => [p, { n: v.length, median: median(v) }]))]));
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
  bigHelpers,
  firstCallByProject,
  use,
  promptCache,
  wasted,
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
  const subs = s.subagents.map((a) => `${a.type} ${M(a.tokens)}/${a.calls}`).join(", ") || "—";
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
if (timed.length) out.push(`Foreground call time: ${Math.min(...timed.map((x) => x.seconds))}–${Math.max(...timed.map((x) => x.seconds))} s.`);
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
{
  const C = report.promptCache, all3 = C.input + C.write + C.read, share = (n) => `${(100 * n / (all3 || 1)).toFixed(1)}%`;
  const rw = Object.entries(C.rewrites).sort((a, b) => b[1].tokens - a[1].tokens);
  out.push(`- Prompt cache (main chats and subagents): ${share(C.read)} of the input read from the cache, ${share(C.write)} written to it, ${share(C.input)} uncached. Mid-session rewrites (a call after the first, context over 20k, that read back under half of the previous call's context and wrote over half of its own): ${sum(rw, ([, r]) => r.n)}, ${M(sum(rw, ([, r]) => r.tokens))} written; by cause: ${rw.map(([k, r]) => `${k} ${r.n} (${M(r.tokens)})`).join(", ") || "none"}.`);
}
out.push(`- Tool calls: ${listOf(U.tools)}`);
out.push(`- Skills: ${listOf(U.skills)}`);
out.push(`- Subagents: ${listOf(U.agents)}`);
const X = report.wasted;
const pct = (n, d) => d ? `${(100 * n / d).toFixed(1)}%` : "0%";
const tokAll = X.tokens.input + X.tokens.cacheWrite + X.tokens.cacheRead + X.tokens.output;
out.push(``, `## Wasted requests`, ``,
  `A request is one API call; each re-sends the whole context, so its cost is its context size (input + cache writes + cache reads).`, ``,
  `**Tokens in ${X.requests} requests:** fresh input ${M(X.tokens.input)} (${pct(X.tokens.input, tokAll)}), cache writes ${M(X.tokens.cacheWrite)} (${pct(X.tokens.cacheWrite, tokAll)}), ` +
  `cached re-reads ${M(X.tokens.cacheRead)} (${pct(X.tokens.cacheRead, tokAll)}, the context sent again, not new work), output ${M(X.tokens.output)} (${pct(X.tokens.output, tokAll)}).`, ``,
  `**Requests per user message** (main chats, ${X.turnCount} messages): median ${X.requestsPerMessage.median}, largest ${X.requestsPerMessage.max}.`, ``,
  `| Project | Messages | Median | Largest |`, `|---|---|---|---|`);
for (const [k, v] of Object.entries(X.perProject).sort((a, b) => b[1].messages - a[1].messages).slice(0, 10)) out.push(`| ${k} | ${v.messages} | ${v.median} | ${v.max} |`);
out.push(``, `**Longest turns:**`, ``, `| Project | Session | Requests | Tokens | Message |`, `|---|---|---|---|---|`);
for (const t of X.longestTurns) out.push(`| ${t.project} | ${t.session} | ${t.requests} | ${M(t.tokens)} | ${t.text.replace(/\|/g, "/")} |`);
out.push(``, `**Failure streaks** (3 or more tool calls in a row that came back as errors, inside one user message): ${X.streakCount}, longest ${X.longestStreak}.`);
for (const k of X.worstStreaks) out.push(`- ${k.project} ${k.session}: ${k.n} in a row, ${k.tool}`);
out.push(``, `**Hook blocks** (tokens = the request that was blocked):`);
const hookRows = Object.entries(X.hooks).sort((a, b) => b[1].tokens - a[1].tokens);
if (!hookRows.length) out.push(`- None.`);
for (const [k, v] of hookRows) out.push(`- ${k}: ${v.blocks} blocks, ${M(v.tokens)}`);
for (const [k, v] of Object.entries(X.commandExplain).sort((a, b) => b[1].blocks - a[1].blocks)) out.push(`  - command-explain, ${k}: ${v.blocks} blocks, ${M(v.tokens)}`);
if (X.unmatched) out.push(`- ${X.unmatched} blocks could not be matched to their request (it lies outside the time window); counted with 0 tokens.`);
const B = X.boardOnly, S = X.toolSearchOnly;
out.push(``, `**Requests that only set the board entry:** set to complete ${B.complete.n} (${M(B.complete.tokens)}), other ${B.other.n} (${M(B.other.tokens)}).`,
  `**Requests that only called ToolSearch:** ${S.n} (${M(S.tokens)}).`);
const byProj = (o, f) => {
  const rows = Object.entries(o).sort((a, b) => (b[1].n ?? b[1]) - (a[1].n ?? a[1]));
  const rest = rows.slice(6).reduce((a, [, v]) => a + (v.n ?? v), 0);
  return rows.slice(0, 6).map(([k, v]) => `${k} ${f(v)}`).join(", ") + (rows.length > 6 ? `, ${rows.length - 6} more projects ${rest}` : "") || "none";
};
out.push(``, `**Wake-up turns** (the harness started the turn: a background task or agent finished; main chats): ${X.wake.n} turns, ${M(X.wake.tokens)}. By project: ${byProj(X.wake.perProject, (v) => `${v.n} (${M(v.tokens)})`)}.`,
  `  By source (top 8; text-only wake-up turns, no tool call at the end: ${X.wakeTextOnly} of ${X.wake.n}): ${Object.entries(X.wakeSources).sort((a, b) => b[1].tokens - a[1].tokens).slice(0, 8).map(([k, v]) => `${k} ${v.n} (${M(v.tokens)})`).join(", ") || "none"}.`,
  `**Background launches** (Bash, Agent or Task with run_in_background; main chats): ${X.background.n}. By project: ${byProj(X.background.perProject, (v) => v)}.`,
  `**After-commit tail** (main chats that grew past 100k context: ${X.afterCommit.sessions}, ${X.afterCommit.withCommit} with a commit, tag, repo-push.sh or release-setup/deploy skill): ${X.afterCommit.requests} requests after the last one, ${M(X.afterCommit.tokens)}.`,
  `  Top 5 sessions (user messages after the last commit; 0 = Claude kept going on its own): ${[...X.afterCommit.perSession].sort((a, b) => b.tokens - a.tokens).slice(0, 5).map((v) => `${v.project}/${v.session} ${M(v.tokens)}, ${v.requests} requests, ${v.userMessages} user messages, ${v.wakeTurns} wake-ups`).join("; ") || "none"}.`,
  `**Big subagent runs** (context past 150k): ${X.bigSubagents.n} of ${subRuns.length} runs, ${M(X.bigSubagents.tokens)}, ${pct(X.bigSubagents.tokens, sum(subRuns, (a) => a.tokens))} of all subagent tokens.`);
const SE = X.settled, LA = X.launches, TY = X.typed;
out.push(``, `## Settled turns`, ``,
  `A settled turn starts with a "[System: background task(s) you launched have settled" prompt; its requests run until the next user message or wake-up. "With note": the background-tasks hook added its settled-notice note. "Repeat": it names an item a settled prompt named less than 15 min before (main chats).`, ``,
  `**Total:** ${SE.total.n} settled turns, ${SE.total.requests} requests, ${SE.total.tools} tool calls, ${M(SE.total.tokens)} tokens; ${SE.total.withNote} with the note, ${SE.total.repeats} repeats.`, ``,
  `| Project | Settled turns | Requests | Tool calls | With note | Repeats | Tokens |`, `|---|---|---|---|---|---|---|`);
for (const [k, v] of Object.entries(SE.perProject).sort((a, b) => b[1].n - a[1].n)) out.push(`| ${k} | ${v.n} | ${v.requests} | ${v.tools} | ${v.withNote} | ${v.repeats} | ${M(v.tokens)} |`);
out.push(``, `Most requests in one settled turn: ${SE.worst.map((r) => `${r.project}/${r.session} ${r.requests} requests, ${r.tools} tools, ${r.note ? "note" : "no note"}${r.repeat ? ", repeat" : ""}`).join("; ") || "none"}.`);
out.push(``, `## Background launches by kind`, ``,
  `Agent = Agent/Task launched in the background (run_in_background: true, or without run_in_background: false and the result says "Async agent launched"). Bash = run_in_background: true. Moved = a Bash call whose result says it "was moved to the background" after its timeout (main chats).`, ``,
  `**Total:** agent ${LA.total.agent}, bash ${LA.total.bash}, moved ${LA.total.moved}.`, ``,
  `| Project | Agent | Bash | Moved |`, `|---|---|---|---|`);
for (const [k, v] of Object.entries(LA.perProject).sort((a, b) => (b[1].agent + b[1].bash + b[1].moved) - (a[1].agent + a[1].bash + a[1].moved))) out.push(`| ${k} | ${v.agent} | ${v.bash} | ${v.moved} |`);
out.push(``, `## Tokens per typed user message`, ``,
  `Typed = a real user prompt (not a tool result, task notification, settled prompt, or system/hook text). A message counts its own requests plus the wake-up turns after it until the next typed message; tokens = input + cache + output per request (main chats). Mean = all main tokens / typed messages.`, ``,
  `**Total:** ${TY.total.typed} typed messages, ${M(TY.total.tokens)} tokens, median ${M(TY.total.median)} per message, mean ${M(TY.total.mean)}.`, ``,
  `| Project | Typed messages | Tokens | Median per message | Mean |`, `|---|---|---|---|---|`);
for (const [k, v] of Object.entries(TY.perProject).sort((a, b) => b[1].tokens - a[1].tokens)) out.push(`| ${k} | ${v.typed} | ${M(v.tokens)} | ${M(v.median)} | ${M(v.mean)} |`);
{
  const QL = X.quality, show = (q, n, r) => q.tooFew ? "too few to judge" : `${n} (${(100 * r).toFixed(1)}%)`;
  out.push(``, `## Quality: redo rate and unchecked done`, ``,
    `Done-claim = a main-chat turn whose closing text says done / fixed / works / verified / all pass / resolved (${DONE_RE}). **Redo** = a typed message within 30 min after it that says it is not (${REDO_RE}). **Unchecked** = a done-claim in a turn that edited a file (Edit/Write) with no test, build or check run (a Bash/PowerShell call like node test-, npm test, gradle, pytest, --check, or a description saying check/test/verify) after the last edit. Under ${QL.minClaims} done-claims in a project: no percentage. A cost cut that raises these is a bad cut.`, ``,
    `| Project | Done-claims | Redo | With an edit | Unchecked |`, `|---|---|---|---|---|`);
  for (const [k, q] of Object.entries(QL.perProject).sort((a, b) => b[1].claims - a[1].claims)) out.push(`| ${k} | ${q.claims} | ${show(q, q.redos, q.redoRate)} | ${q.edited} | ${show(q, q.unchecked, q.uncheckedRate)} |`);
  out.push(`| **all** | ${QL.total.claims} | ${show(QL.total, QL.total.redos, QL.total.redoRate)} | ${QL.total.edited} | ${show(QL.total, QL.total.unchecked, QL.total.uncheckedRate)} |`);
  for (const [label, key] of [["Redo examples", "redoExamples"], ["Unchecked examples", "uncheckedExamples"]]) {
    out.push(``, `**${label}** (session, time UTC):`);
    const rows = Object.entries(QL.perProject).flatMap(([k, q]) => q[key].map((e) => `- ${k} ${e.session} ${e.at.slice(0, 16)}: "${e.reply}"${e.answer ? ` -> "${e.answer}"` : ""}`));
    out.push(...(rows.length ? rows : ["- none"]));
  }
}
const BH = report.bigHelpers, P = BH.pattern;
out.push(``, `## Big helper runs (past 150k context)`, ``,
  `Per helper run whose context passed 150k. Background = from the parent's Agent call and result. Before/after = tool calls before and after the first "[worker-size]" note (the hook's attachment line in the helper's transcript); "no note" = never warned. Compacted = "compact_boundary" lines in the helper's transcript. Bash = share of its tool calls.`, ``);
if (!BH.runs.length) out.push(`None.`);
else {
  out.push(`| Project | Session | Helper | Model | Background | Tokens | API calls | Tool calls | Before note | After note | Compacted | Bash |`, `|---|---|---|---|---|---|---|---|---|---|---|---|`);
  for (const r of BH.runs.slice(0, top)) out.push(`| ${r.project} | ${r.session} | ${r.type} | ${r.model.replace(/^claude-/, "")} | ${r.background === null ? "unknown" : r.background ? "yes" : "no"} | ${M(r.tokens)} | ${r.calls} | ${r.toolCalls} | ${r.before} | ${r.noted ? r.after : "no note"} | ${r.compacts || "no"} | ${Math.round(r.bashShare * 100)}% |`);
  out.push(``, `**Pattern of the big runs:** ${P.runs} runs; ${P.background} launched in the background, ${P.foreground} in the foreground${P.unknownLaunch ? `, ${P.unknownLaunch} unknown` : ""}; ${P.bashShare * 100 | 0}% of their tool calls were Bash; ${P.withNote} got the size note and ran a median of ${P.medianAfterNote} more tool calls after it; ${P.compacted} compacted; most common helper ${P.commonType}, model ${P.commonModel}.`);
}
out.push(``, `## First-call context per project`, ``,
  `Input + cache tokens of the first API call of a transcript = what is loaded before any work (median per project).`, ``,
  `| Project | Main sessions | Main median | Helper runs | Helper median |`, `|---|---|---|---|---|`);
const FC = report.firstCallByProject;
for (const p of [...new Set([...Object.keys(FC.main), ...Object.keys(FC.helper)])].sort((a, b) => (FC.main[b]?.n ?? 0) + (FC.helper[b]?.n ?? 0) - (FC.main[a]?.n ?? 0) - (FC.helper[a]?.n ?? 0))) {
  const m = FC.main[p], h = FC.helper[p];
  out.push(`| ${p} | ${m?.n ?? 0} | ${m ? M(m.median) : "—"} | ${h?.n ?? 0} | ${h ? M(h.median) : "—"} |`);
}
console.log(out.join("\n"));
