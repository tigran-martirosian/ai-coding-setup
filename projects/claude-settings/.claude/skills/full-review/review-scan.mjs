#!/usr/bin/env node
// review-scan: what the usage scan does not measure, from the Claude Code chat records (~/.claude/projects),
// for the full-review skill. No model is called and nothing is sent anywhere. Main chats only, no subagents.
//   - kind of work: what each request did (look, edit, run, delegate, ask, talk), how much of it ran in
//     stretches a helper could have taken, and what-if totals for other ways to split the work between models
//   - time: where the minutes of each turn went (the model, the shell, subagents, waiting for the user)
//   - turns that ran long, quick answers the user pushed back on, replies the user interrupted
//   - thinking: how much hidden thinking there was (its text is not stored in the records)
//   - tool errors: which tools fail, how often, with what
// A "request" is one API call; a "turn" is one message the user typed with everything done for it.
// "Weight" is the rough plan weight of usage-report/usage-scan.mjs (cache reads 0.1x, output 5x).
// Options: --days N (default 7)   --project TEXT (only folders whose path contains it)
//          --top N rows per list (default 8)   --root DIR (default ~/.claude/projects)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : args[i + 1]; };
const root = opt("root", path.join(os.homedir(), ".claude", "projects"));
const days = Number(opt("days", 7));
const only = String(opt("project", "")).toLowerCase();
const top = Number(opt("top", 8));
const since = Date.now() - days * 86400000;

// Opus : Sonnet : Haiku = 5 : 3 : 1 as in usage-scan.mjs. Fable is not in its table: it is counted at 2.5
// times Opus, the ratio of the list prices there.
const FAMILY = [[/fable|mythos/, 12.5, "Fable"], [/opus/, 5, "Opus"], [/sonnet/, 3, "Sonnet"], [/haiku/, 1, "Haiku"]];
const famOf = (model) => FAMILY.find(([re]) => re.test(model))?.[1] ?? 3;
const weightOf = (u, model) => {
  const write = u.cache_creation_input_tokens ?? 0;
  const write1h = u.cache_creation?.ephemeral_1h_input_tokens ?? 0;
  return famOf(model) * ((u.input_tokens ?? 0) + 1.25 * (write - write1h) + 2 * write1h +
    0.1 * (u.cache_read_input_tokens ?? 0) + 5 * (u.output_tokens ?? 0)) / 1e6;
};
const tokensOf = (u) => (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.output_tokens ?? 0);

// Lines that look like a message but were written by a program (same list as chat-review/chat-scan.mjs)
const MACHINE = /^(<(?!command-)[a-z-]+[ >]|\[System:|\[Child Session|\[\d+ messages? arrived|Stop hook feedback|The PermissionDeni|Another Claude ses|Base directory for|Condense the tool|Caveat: |\[Image: |Use the Bash tool )/;
const INTERRUPTED = /^\[Request interrupted by user/;
const NOT_A_FAILURE = /hook (?:blocking )?error|The user doesn't want to|interrupted by user/i;
// First words of the next message that look like a correction. A lead for the reader, not a verdict.
const FILLER = /^(?:ok(?:ay)?|well|hmm+|so|but|and|yeah|alright|bro)[,.! ]+/i;
const PUSH = /^(?:no[,.! ]|nope|wrong|incorrect|not what|that'?s not|this is not|it'?s not|i said|i told|i asked|i meant|again[,.! ]|still |why did(?:n'?t)? (?:you|u)\b|why (?:are|do|would) (?:you|u)\b|(?:you|u) (?:didn'?t|did not|haven'?t|missed|forgot|ignored|still)\b|(?:it )?did(?:n'?t| not) work|(?:it )?does(?:n'?t| not) work|not working|stop[,.! ]|wtf|нет[,.! ]|не то|не так|я же|опять|снова|не работает|почему ты)/i;

const LOOK = /^(Read|Grep|Glob|WebSearch|WebFetch|ToolSearch)$|browser_(screenshot|get_page_info|list_sessions)|memory_(recall|search|read|list)|tracker_(get|list)|__(list|get)_/;
const EDIT = /^(Edit|Write|NotebookEdit|MultiEdit)$/;
const RUN = /^(Bash|PowerShell)$/;
const AGENT = /^(Agent|Task)$/;
const DELEGATE = /^(Agent|Task)$|spawn_session|send_prompt|create_session/;
const ASK = /(AskUserQuestion|PromptForUserInput)$/;
const BOARD = /update_session_meta|update_session_board/;
const READ_ONLY = /^(?:cd|ls|dir|cat|head|tail|grep|rg|find|wc|stat|du|file|which|where|echo|sort|uniq|cut|tr|sed -n|git (?:-C \S+ )?(?:status|log|diff|show|branch)|Get-Content|Get-ChildItem|Select-String|Test-Path)\b/;
// A shell command that only looks: every part starts with a reading program and nothing is written to a file.
const readOnlyShell = (cmd) => {
  const body = String(cmd ?? "").split(/\n\s*#/)[0].replace(/2>(?:&1|\/dev\/null|\$null)/g, "");
  if (!body.trim() || />/.test(body)) return false;
  return body.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean).every((s) => READ_ONLY.test(s));
};
function kindOf(tools) {
  if (!tools.length) return "talk";
  const names = tools.map((x) => x.name);
  if (names.some((n) => DELEGATE.test(n))) return "delegate";
  if (names.some((n) => ASK.test(n))) return "ask";
  if (names.some((n) => EDIT.test(n))) return "edit";
  const rest = tools.filter((x) => !BOARD.test(x.name));
  if (!rest.length) return "board";
  if (rest.every((x) => LOOK.test(x.name) || (RUN.test(x.name) && readOnlyShell(x.input.command)))) return "look";
  return names.some((n) => RUN.test(n)) ? "run" : "other";
}
const KINDS = {
  look: "only reading and searching (files, the web, read-only shell)",
  edit: "writing or changing a file",
  run: "running a command",
  other: "other tools (browser, app tools)",
  delegate: "starting a subagent or another session",
  ask: "asking the user in a form",
  board: "only setting the board entry",
  talk: "text only, no tool",
};
const LEAD_KINDS = new Set(["talk", "ask", "delegate", "board"]);

const one = (s) => String(s ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ").replace(/\s+/g, " ").trim();
const cut = (s, n = 60) => { const t = one(s).replace(/\|/g, "/"); return t.length > n ? `${t.slice(0, n)}…` : t; };
const textOf = (content) => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((b) => b.text ?? (typeof b.content === "string" ? b.content : "")).join("\n") : "";
const PAUSE = 15 * 60000; // a longer gap before the model's next line: the computer slept or the chat was left
const SHELL_MAX = 10 * 60000; // a shell call cannot run longer; the rest of the gap was a permission prompt
const TOOL_MAX = 2 * 60000;
const owner = new Map(); // API message id -> file, because a resumed chat repeats earlier messages in a new file
const turnSeen = new Set();

function readChat(file) {
  const chat = { cwd: "", turns: [], errors: [], calls: {} };
  const uses = new Map();
  const reqs = new Map();
  let turn = null, effort = "";
  const add = (bucket, ms) => { if (turn && ms > 0) turn.time[bucket] = (turn.time[bucket] ?? 0) + ms; };
  for (const raw of fs.readFileSync(file, "utf8").split("\n")) {
    if (!raw) continue;
    let l;
    try { l = JSON.parse(raw); } catch { continue; }
    const eff = raw.length < 4000 && raw.match(/"effort":"(\w+)"/);
    if (eff) effort = eff[1];
    if (l.isSidechain) continue;
    if (l.cwd && !chat.cwd) chat.cwd = l.cwd;
    const t = Date.parse(l.timestamp);
    if (isNaN(t)) continue;
    const content = l.message?.content;
    if (l.type === "assistant" && l.message?.id && l.message.model !== "<synthetic>") {
      const id = l.message.id;
      if ((owner.get(id) ?? file) !== file) continue;
      owner.set(id, file);
      turn ??= { t: t, text: "(the chat went on without a typed message)", reqs: [], time: {}, last: t };
      if (!chat.turns.includes(turn)) chat.turns.push(turn);
      let r = reqs.get(id);
      if (!r) { r = { model: l.message.model ?? "?", usage: {}, tools: [], thinking: false, visible: 0, effort }; reqs.set(id, r); turn.reqs.push(r); }
      r.usage = l.message.usage ?? r.usage;
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type === "thinking") r.thinking = true;
        else if (b.type === "text") r.visible += (b.text ?? "").length;
        else if (b.type === "tool_use") {
          r.tools.push({ name: b.name, input: b.input ?? {} });
          r.visible += JSON.stringify(b.input ?? {}).length;
          uses.set(b.id, b.name);
          const name = b.name.replace(/^mcp__[\w-]+?__/, "");
          (chat.calls[name] ??= { n: 0, failed: 0 }).n++;
        }
      }
      const gap = t - turn.last;
      add(gap > PAUSE ? "paused" : "model", gap);
      turn.last = t;
      continue;
    }
    if (l.type !== "user" || l.isMeta) continue;
    const typed = [];
    let timed = false;
    for (const b of typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []) {
      if (b.type === "tool_result") {
        const name = uses.get(b.tool_use_id);
        if (!name) continue;
        if (turn && !timed) {
          timed = true;
          const gap = t - turn.last;
          if (ASK.test(name)) add("you", gap);
          else if (AGENT.test(name)) add("subagents", gap);
          else {
            const max = RUN.test(name) ? SHELL_MAX : TOOL_MAX;
            add(RUN.test(name) ? "shell" : "tools", Math.min(gap, max));
            add("you", gap - max);
          }
        }
        const text = textOf(b.content);
        if (b.is_error && !NOT_A_FAILURE.test(text.slice(0, 300))) {
          const short = name.replace(/^mcp__[\w-]+?__/, "");
          if (chat.calls[short]) chat.calls[short].failed++;
          chat.errors.push({ tool: short, what: cut(text.replace(/\d+/g, "N"), 70) });
          if (turn) turn.failed = (turn.failed ?? 0) + 1;
        }
      } else if (b.type === "text" && b.text?.trim()) {
        const text = b.text.trim();
        if (INTERRUPTED.test(text)) { if (turn) turn.interrupted = true; continue; }
        const command = text.match(/<command-name>\/?([\w:-]+)<\/command-name>/);
        if (command) typed.push(`/${command[1]} ${text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? ""}`);
        else if (/^# \/[\w:-]+/.test(text)) continue; // the text of a slash command, loaded by the app
        else if (!MACHINE.test(text)) typed.push(text);
        else if (turn && !timed) { timed = true; add("background", t - turn.last); }
      }
    }
    const message = one(typed.join(" "));
    if (message) { turn = { t, text: message, reqs: [], time: {}, last: t }; chat.turns.push(turn); }
    else if (turn) turn.last = t;
  }
  return chat;
}

// Collect the turns of the window
const chats = [];
if (!fs.existsSync(root)) { console.error(`No chats folder: ${root}`); process.exit(1); }
for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of fs.readdirSync(path.join(root, dir.name))) {
    const file = path.join(root, dir.name, f);
    if (!f.endsWith(".jsonl") || fs.statSync(file).mtimeMs < since) continue;
    const chat = readChat(file);
    const where = chat.cwd || dir.name;
    if (only && !where.toLowerCase().includes(only)) continue;
    chat.project = path.basename(where);
    chat.id = f.slice(0, 8);
    chat.turns = chat.turns.filter((u) => {
      const key = `${u.t}|${u.text.slice(0, 40)}`;
      if (u.t < since || !u.reqs.length || turnSeen.has(key)) return false;
      turnSeen.add(key);
      return true;
    });
    if (chat.turns.length) chats.push(chat);
  }
}
const turns = chats.flatMap((c) => c.turns.map((u, i) => Object.assign(u, { project: c.project, id: c.id, next: c.turns[i + 1] })));
if (!turns.length) { console.log(`No turns in the last ${days} days${only ? ` for "${only}"` : ""}.`); process.exit(0); }

// Kind of each request, and the stretches a helper could have taken
const kinds = {}, models = {};
let total = 0;
const sum = (list, f) => list.reduce((a, x) => a + f(x), 0);
for (const u of turns) {
  for (const r of u.reqs) {
    r.kind = kindOf(r.tools);
    r.w = weightOf(r.usage, r.model);
    r.tok = tokensOf(r.usage);
    r.fam = famOf(r.model);
    total += r.w;
    const k = (kinds[r.kind] ??= { n: 0, tok: 0, w: 0 });
    k.n++; k.tok += r.tok; k.w += r.w;
    const m = (models[r.model.replace(/^claude-/, "")] ??= { n: 0, w: 0 });
    m.n++; m.w += r.w;
  }
  // look stretch: 3 or more "look" requests in a row. build stretch: 10 or more work requests in a row
  // (no talking, asking or delegating between them) with at least 3 edits.
  const stretch = (ok, min, mark, extra = () => true) => {
    for (let i = 0; i < u.reqs.length;) {
      let j = i;
      while (j < u.reqs.length && ok(u.reqs[j])) j++;
      const part = u.reqs.slice(i, j);
      if (part.length >= min && extra(part)) part.forEach((r, n) => { r[mark] = n === 0 ? "first" : "rest"; });
      i = Math.max(j, i + 1);
    }
  };
  stretch((r) => r.kind === "look", 3, "inLook");
  stretch((r) => !LEAD_KINDS.has(r.kind) || r.kind === "board", 10, "inBuild", (part) => part.filter((r) => r.kind === "edit").length >= 3);
  u.w = sum(u.reqs, (r) => r.w);
  u.tok = sum(u.reqs, (r) => r.tok);
  u.active = (u.time.model ?? 0) + (u.time.shell ?? 0) + (u.time.subagents ?? 0) + (u.time.tools ?? 0);
}
const reqs = turns.flatMap((u) => u.reqs);
const M = (n) => n >= 1e6 ? `${(n / 1e6).toFixed(n >= 1e7 ? 1 : 2)}M` : `${Math.round(n / 1e3)}k`;
const pct = (a, b = total) => b ? `${Math.round(a / b * 100)}%` : "0%";
const mins = (ms) => ms >= 3600000 ? `${(ms / 3600000).toFixed(1)} h` : `${(ms / 60000).toFixed(ms >= 600000 ? 0 : 1)} min`;
const median = (list) => { const s = [...list].sort((a, b) => a - b); return s.length ? s[s.length >> 1] : 0; };
const out = [];
const p = (...lines) => out.push(...lines);

p("# Review scan", `Last ${days} days${only ? `, "${only}" only` : ""}: ${chats.length} main chats, ${turns.length} turns, ${reqs.length} requests. Subagents are not in these numbers.`, "");

p("## Kind of work (main chats)", "",
  `Models: ${Object.entries(models).sort((a, b) => b[1].w - a[1].w).map(([m, v]) => `${m} ${v.n} requests, ${pct(v.w)} of the weight`).join("; ")}.`, "",
  "| Kind | What the request did | Requests | Tokens | Share of weight |", "|---|---|---|---|---|",
  ...Object.entries(kinds).sort((a, b) => b[1].w - a[1].w).map(([k, v]) => `| ${k} | ${KINDS[k]} | ${v.n} | ${M(v.tok)} | ${pct(v.w)} |`), "");
const lookAll = reqs.filter((r) => r.inLook), lookRest = lookAll.filter((r) => r.inLook === "rest");
const build = reqs.filter((r) => r.inBuild && !r.inLook);
const lookW = sum(lookAll, (r) => r.w), buildW = sum(build, (r) => r.w);
p(`**Looking stretches** (3 or more look requests in a row): ${lookAll.filter((r) => r.inLook === "first").length} stretches, ${lookAll.length} requests, ${pct(lookW)} of the weight. One worker call could have stood in for each stretch.`,
  `**Building stretches** (10 or more work requests in a row with at least 3 edits; the looking stretches inside them are counted above): ${reqs.filter((r) => r.inBuild === "first").length} stretches, ${build.length} requests, ${pct(buildW)} of the weight. An upper limit: only the part that follows a clear plan can go to a helper.`,
  `**Could have gone to a helper:** between ${pct(lookW)} (looking only) and ${pct(lookW + buildW)} (looking and all building) of the weight.`, "");
// Every request sends the whole chat so far, so a long chat makes each further step dearer
const ctxOf = (r) => r.tok - (r.usage.output_tokens ?? 0);
const over = (n) => reqs.filter((r) => ctxOf(r) > n);
p(`**Context size:** an average request sent ${M(sum(reqs, ctxOf) / reqs.length)} tokens of context. Requests sent with over 150k: ${over(150000).length}, ${pct(sum(over(150000), (r) => r.w))} of the weight; over 200k: ${over(200000).length}, ${pct(sum(over(200000), (r) => r.w))}; over 300k: ${over(300000).length}, ${pct(sum(over(300000), (r) => r.w))}.`, "");

// What-if totals. Same requests and context sizes; only who runs them changes.
const to = (r, fam) => r.w * Math.min(fam, r.fam) / r.fam;
const whatIf = [
  ["Looking stretches go to a free worker (one request per stretch stays)", total - sum(lookRest, (r) => r.w)],
  ["That, and the building stretches run on Sonnet helpers", total - sum(lookRest, (r) => r.w) - sum(build, (r) => r.w - to(r, 3))],
  ["Opus leads (talks, asks, delegates), Sonnet does all the work requests", sum(reqs, (r) => LEAD_KINDS.has(r.kind) ? r.w : to(r, 3))],
  ["Fable leads, Sonnet does all the work requests", sum(reqs, (r) => LEAD_KINDS.has(r.kind) ? r.w * 12.5 / r.fam : to(r, 3))],
  ["Sonnet runs everything", sum(reqs, (r) => to(r, 3))],
];
p("## What if the work were split differently", "",
  "The same requests with the same context sizes, only run by someone else. Sizes of the prize, not forecasts: a helper starts with a small context (cheaper than shown) but has to be briefed and checked (dearer than shown). Weights: Haiku 1, Sonnet 3, Opus 5, Fable 12.5.", "",
  "| Split | Weight | Against now |", "|---|---|---|", `| As it was | ${total.toFixed(0)} | |`,
  ...whatIf.map(([name, w]) => `| ${name} | ${w.toFixed(0)} | ${w <= total ? "−" : "+"}${pct(Math.abs(total - w))} |`), "");

// Time
const buckets = ["model", "shell", "subagents", "tools", "you", "background", "paused"];
const timeOf = (list, b) => sum(list, (u) => u.time[b] ?? 0);
const active = sum(turns, (u) => u.active);
const where = (u) => ["model", "shell", "subagents", "tools"].map((b) => [b, u.time[b] ?? 0]).filter(([, v]) => v > 0)
  .sort((a, b) => b[1] - a[1]).slice(0, 2).map(([b, v]) => `${b} ${pct(v, u.active)}`).join(", ");
const row = (u) => `| ${u.project} | ${u.id} | ${mins(u.active)} | ${u.reqs.length} | ${M(u.tok)} | ${where(u)} | ${cut(u.text)} |`;
p("## Time", "",
  `Working time in all turns: **${mins(active)}** (the model ${pct(timeOf(turns, "model"), active)}, shell commands ${pct(timeOf(turns, "shell"), active)}, subagents ${pct(timeOf(turns, "subagents"), active)}, other tools ${pct(timeOf(turns, "tools"), active)}).`,
  `Not counted as working time: ${mins(timeOf(turns, "you"))} waiting for the user (forms and permission prompts), ${mins(timeOf(turns, "background"))} waiting for background work or another session, ${mins(timeOf(turns, "paused"))} in gaps over 15 minutes.`,
  `A turn: median ${mins(median(turns.map((u) => u.active)))} and ${median(turns.map((u) => u.reqs.length))} requests; ${turns.filter((u) => u.active > 600000).length} turns took over 10 minutes, ${turns.filter((u) => u.active > 1800000).length} over 30.`, "",
  "| Project | Turns | Working time | Model | Shell | Subagents | Other tools | Waiting for the user |", "|---|---|---|---|---|---|---|---|");
const byProject = {};
for (const u of turns) (byProject[u.project] ??= []).push(u);
for (const [name, list] of Object.entries(byProject).sort((a, b) => sum(b[1], (u) => u.active) - sum(a[1], (u) => u.active)).slice(0, 10)) {
  const a = sum(list, (u) => u.active);
  p(`| ${name} | ${list.length} | ${mins(a)} | ${pct(timeOf(list, "model"), a)} | ${pct(timeOf(list, "shell"), a)} | ${pct(timeOf(list, "subagents"), a)} | ${pct(timeOf(list, "tools"), a)} | ${mins(timeOf(list, "you"))} |`);
}
const head = ["| Project | Chat | Working time | Requests | Tokens | Where the time went | Message |", "|---|---|---|---|---|---|---|"];
p("", "**Turns that took longest:**", "", ...head, ...[...turns].sort((a, b) => b.active - a.active).slice(0, top).map(row), "");

// Pushed back, interrupted
const pushed = (u) => { let t = u.next?.text ?? ""; for (let i = 0; i < 2; i++) t = t.replace(FILLER, ""); return PUSH.test(t); };
const quick = turns.filter((u) => u.reqs.length <= 2 && !u.reqs.some((r) => r.kind === "edit" || r.kind === "run"));
const quickPushed = quick.filter(pushed);
const longPushed = turns.filter((u) => u.reqs.length >= 10 && pushed(u));
const stopped = turns.filter((u) => u.interrupted);
const after = (u) => `| ${u.project} | ${u.id} | ${u.reqs.length} | ${mins(u.active)} | ${cut(u.text, 45)} | ${cut(u.next?.text ?? "", 60)} |`;
const head2 = ["| Project | Chat | Requests | Working time | Message | The user's next message |", "|---|---|---|---|---|---|"];
p("## Too short, or long and still wrong", "",
  `"Pushed back" means the first words of the user's next message look like a correction (no, wrong, I said, again, still, didn't work...). A lead for a reader to check, not a verdict.`, "",
  `**Quick answers** (1 or 2 requests, nothing edited or run): ${quick.length} of ${turns.length} turns; pushed back on: ${quickPushed.length}.`, "",
  ...(quickPushed.length ? [...head2, ...quickPushed.slice(0, top).map(after), ""] : []),
  `**Long turns** (10 or more requests) the user pushed back on: ${longPushed.length} of ${turns.filter((u) => u.reqs.length >= 10).length}.`, "",
  ...(longPushed.length ? [...head2, ...longPushed.sort((a, b) => b.w - a.w).slice(0, top).map(after), ""] : []),
  `**Replies the user interrupted:** ${stopped.length}; they had run a median of ${median(stopped.map((u) => u.reqs.length))} requests and ${mins(median(stopped.map((u) => u.active)))}, ${M(sum(stopped, (u) => u.tok))} tokens in all.`, "",
  ...(stopped.length ? [...head, ...stopped.sort((a, b) => b.tok - a.tok).slice(0, top).map(row), ""] : []));

// Thinking
const think = reqs.filter((r) => r.thinking);
for (const r of think) r.hidden = Math.max(0, (r.usage.output_tokens ?? 0) - r.visible / 3.5);
const hidden = sum(think, (r) => r.hidden), output = sum(reqs, (r) => r.usage.output_tokens ?? 0);
const efforts = {};
for (const r of reqs) if (r.effort) efforts[r.effort] = (efforts[r.effort] ?? 0) + 1;
const sorted = think.map((r) => r.hidden).sort((a, b) => a - b);
for (const u of turns) u.hidden = sum(u.reqs, (r) => r.hidden ?? 0);
p("## Thinking", "",
  "The records keep no thinking text, so what it thought cannot be read. Its size is estimated: output tokens minus the text and tool input that can be seen.", "",
  `Requests with a thinking step: ${think.length} of ${reqs.length} (${pct(think.length, reqs.length)}). Hidden thinking: about ${M(hidden)} tokens, ${pct(hidden, output)} of all output and ${pct(sum(think, (r) => r.hidden * 5 * r.fam / 1e6))} of the weight.`,
  `Per thinking request: median ${Math.round(median(sorted))} tokens, 1 in 20 over ${Math.round(sorted[Math.floor(sorted.length * 0.95)] ?? 0)}.`,
  `Effort setting seen: ${Object.entries(efforts).map(([e, n]) => `${e} ${n} requests`).join(", ") || "not recorded"}.`, "",
  "**Turns with the most thinking:**", "", "| Project | Chat | Thinking | Requests | Working time | Message |", "|---|---|---|---|---|---|",
  ...[...turns].sort((a, b) => b.hidden - a.hidden).slice(0, Math.min(top, 5)).map((u) => `| ${u.project} | ${u.id} | ${M(u.hidden)} | ${u.reqs.length} | ${mins(u.active)} | ${cut(u.text)} |`), "");

// Tool errors (hook blocks, refused calls and interruptions are not failures; usage-scan lists the blocks)
const calls = {}, sigs = {};
for (const c of chats) {
  for (const [name, v] of Object.entries(c.calls)) { const t = (calls[name] ??= { n: 0, failed: 0 }); t.n += v.n; t.failed += v.failed; }
  for (const e of c.errors) { const s = (sigs[`${e.tool}: ${e.what}`] ??= { n: 0, projects: new Set() }); s.n++; s.projects.add(c.project); }
}
const failed = Object.entries(calls).filter(([, v]) => v.failed).sort((a, b) => b[1].failed - a[1].failed);
p("## Tool calls that failed", "",
  `${sum(failed, ([, v]) => v.failed)} of ${sum(Object.values(calls), (v) => v.n)} tool calls came back as an error (hook blocks and refused calls left out).`, "",
  "| Tool | Calls | Failed | Rate |", "|---|---|---|---|", ...failed.slice(0, top).map(([name, v]) => `| ${name} | ${v.n} | ${v.failed} | ${pct(v.failed, v.n)} |`), "",
  "**Most frequent errors:**", "",
  ...Object.entries(sigs).sort((a, b) => b[1].n - a[1].n).slice(0, top + 4).map(([what, s]) => `- ${s.n} times (${[...s.projects].slice(0, 3).join(", ")}): ${what}`));
console.log(out.join("\n"));
