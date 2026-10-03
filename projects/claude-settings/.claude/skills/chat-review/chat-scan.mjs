#!/usr/bin/env node
// chat-scan: turns the recent Claude Code chats on this computer (~/.claude/projects) into one short
// digest per project, for the chat-review skill. No model is called and nothing is sent anywhere.
// Each digest (<out>/<project>.md) holds:
//   - numbers: chats, requests, tools, skills and slash commands used, kinds of file written
//   - signals: questions where the user typed their own answer instead of picking an option, replies
//     the user interrupted, tool calls the user refused, hook blocks, tools that kept failing,
//     requests sent more than once
//   - the chats in short: every request (cut to --chars) with the end of Claude's reply to it
// and an index is printed: project, chats, requests, signals, digest file.
// Options: --days N (default 14)   --project TEXT (only folders whose path contains it)
//          --top N projects, busiest first (default 4)   --chars N per request (default 400)
//          --max-kb N per digest (default 120)   --out DIR (default ~/.claude/reports/chat-review/<date>)
//          --root DIR (default ~/.claude/projects)
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf(`--${name}`); return i === -1 ? def : args[i + 1]; };
const root = opt("root", path.join(os.homedir(), ".claude", "projects"));
const days = Number(opt("days", 14));
const only = String(opt("project", "")).toLowerCase();
const top = Number(opt("top", 4));
const chars = Number(opt("chars", 400));
const maxBytes = Number(opt("max-kb", 120)) * 1024;
const since = Date.now() - days * 86400000;
const pad = (n) => String(n).padStart(2, "0");
const day = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const out = opt("out", path.join(os.homedir(), ".claude", "reports", "chat-review", day(Date.now())));

// Lines that look like a request but were written by a program (a hook, a skill load, a notification)
const MACHINE = /^(<(?!command-)[a-z-]+[ >]|\[System:|\[Child Session|\[\d+ messages? arrived|Stop hook feedback|The PermissionDeni|Another Claude ses|Base directory for|Condense the tool|Caveat: |\[Image: |Use the Bash tool )/;
const INTERRUPTED = /^\[Request interrupted by user/;
const REFUSED = /^The user doesn't want to (take this action|proceed)/;
const HOOK = /^(?:Pre|Post)ToolUse:\S+ hook (?:blocking )?error:\s*\[?([\w-]+)\]?/;
const QUESTION_TOOL = /(AskUserQuestion|PromptForUserInput)$/;

const one = (s) => String(s ?? "").replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, " ").replace(/\s+/g, " ").trim();
const cut = (s, n = chars) => { const t = one(s); return t.length > n ? `${t.slice(0, n)}…` : t; };
const tail = (s, n = 250) => { const t = one(s); return t.length > n ? `…${t.slice(-n)}` : t; };
const textOf = (content) => typeof content === "string" ? content
  : Array.isArray(content) ? content.map((b) => b.text ?? (typeof b.content === "string" ? b.content : "")).join("\n") : "";
const bump = (map, key, by = 1) => { map[key] = (map[key] || 0) + by; };
const topOf = (map, n = 10) => Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => `${k} ${v}`).join(", ") || "none";

// What the user answered to a question tool. own = they typed their own answer, no option was picked.
function answersOf(use, text) {
  const found = [];
  let json = null;
  try { json = JSON.parse(text); } catch {}
  if (json?.cancelled) return found;
  if (/PromptForUserInput$/.test(use.name)) {
    for (const f of use.input.fields || []) {
      const a = json?.answers?.[f.id];
      if (!a || f.type !== "singleSelect") continue;
      const own = a.selectedId === "__other__";
      const picked = (f.options || []).find((o) => o.id === a.selectedId)?.label;
      found.push({ q: f.label, options: (f.options || []).map((o) => o.label), answer: own ? a.otherText : picked ?? a.selectedId, own });
    }
    return found;
  }
  for (const q of use.input.questions || []) {
    const labels = (q.options || []).map((o) => o.label);
    let answer = json?.answers?.[q.question];
    if (answer === undefined) answer = text.split(`"${q.question}"="`)[1]?.split(/"(?:, "|\. |$)/)[0];
    if (answer === undefined) continue;
    answer = Array.isArray(answer) ? answer.join(", ") : String(answer);
    found.push({ q: q.question, options: labels, answer, own: !labels.some((l) => answer.includes(l)) });
  }
  return found;
}

function readChat(file) {
  const chat = { file, cwd: "", title: "", first: 0, turns: [], questions: [], refused: [], interrupted: 0,
    hooks: {}, errors: {}, tools: {}, skills: {}, commands: {}, kinds: {} };
  const uses = new Map();
  let said = "";
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.type === "ai-title" && e.aiTitle) chat.title = e.aiTitle;
    if (e.isSidechain) continue;
    if (e.cwd && !chat.cwd) chat.cwd = e.cwd;
    const content = e.message?.content;
    if (e.type === "assistant" && Array.isArray(content)) {
      for (const b of content) {
        if (b.type === "text" && b.text.trim()) said = b.text;
        if (b.type !== "tool_use") continue;
        const input = b.input || {};
        uses.set(b.id, { name: b.name, input });
        bump(chat.tools, b.name.replace(/^mcp__[\w-]+?__/, ""));
        if (b.name === "Skill" && input.skill) bump(chat.skills, input.skill);
        if (/^(Write|Edit)$/.test(b.name) && input.file_path) bump(chat.kinds, path.extname(String(input.file_path)).toLowerCase() || "(no extension)");
      }
      continue;
    }
    if (e.type !== "user") continue;
    const typed = [];
    for (const b of typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : []) {
      if (b.type === "tool_result") {
        const use = uses.get(b.tool_use_id);
        const text = textOf(b.content);
        if (!use) continue;
        if (QUESTION_TOOL.test(use.name)) { chat.questions.push(...answersOf(use, text)); continue; }
        if (!b.is_error) continue;
        const hook = text.match(HOOK);
        const what = cut(use.input.description || use.input.command || use.input.file_path || "", 120);
        if (hook) bump(chat.hooks, hook[1]);
        else if (REFUSED.test(text)) chat.refused.push(`${use.name}: ${what}`);
        else { const t = (chat.errors[use.name] ||= { n: 0, kinds: {} }); t.n++; bump(t.kinds, cut(text, 60)); }
      } else if (b.type === "text" && b.text.trim()) {
        const text = b.text.trim();
        if (INTERRUPTED.test(text)) { chat.interrupted++; if (chat.turns.length) chat.turns.at(-1).interrupted = true; continue; }
        const command = text.match(/<command-name>\/?([\w:-]+)<\/command-name>/);
        const body = text.match(/^# (\/[\w:-]+)/); // the text of a slash command, loaded by the app
        if (body) bump(chat.commands, body[1]);
        else if (command) {
          bump(chat.commands, `/${command[1]}`);
          typed.push(`/${command[1]} ${text.match(/<command-args>([\s\S]*?)<\/command-args>/)?.[1] ?? ""}`);
        } else if (!MACHINE.test(text)) typed.push(text);
      }
    }
    const request = one(typed.join(" "));
    if (!request) continue;
    const t = Date.parse(e.timestamp) || 0;
    if (!chat.first) chat.first = t;
    if (chat.turns.length) chat.turns.at(-1).reply = said;
    chat.turns.push({ t, text: request, reply: "" });
    said = "";
  }
  if (chat.turns.length) chat.turns.at(-1).reply = said;
  return chat;
}

// Collect the chats of the window, grouped by the folder they ran in
const projects = new Map();
if (!fs.existsSync(root)) { console.log(`No chats folder: ${root}`); process.exit(1); }
for (const dir of fs.readdirSync(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const f of fs.readdirSync(path.join(root, dir.name))) {
    const file = path.join(root, dir.name, f);
    if (!f.endsWith(".jsonl") || fs.statSync(file).mtimeMs < since) continue;
    const chat = readChat(file);
    if (!chat.turns.length) continue;
    const where = chat.cwd || dir.name;
    if (only && !where.toLowerCase().includes(only)) continue;
    if (!projects.has(where)) projects.set(where, []);
    projects.get(where).push(chat);
  }
}

const sum = (chats, f) => chats.reduce((a, c) => a + f(c), 0);
const merged = (chats, field) => { const m = {}; for (const c of chats) for (const [k, v] of Object.entries(c[field])) bump(m, k, v); return m; };
const rows = [...projects.entries()].map(([where, chats]) => ({ where, chats: chats.sort((a, b) => b.first - a.first), requests: sum(chats, (c) => c.turns.length) }))
  .sort((a, b) => b.requests - a.requests).slice(0, top);
if (!rows.length) { console.log(`No chats with requests in the last ${days} days${only ? ` for "${only}"` : ""}.`); process.exit(0); }

fs.mkdirSync(out, { recursive: true });
console.log(`Chats of the last ${days} days, busiest projects first. Digests in ${out}\n`);
for (const p of rows) {
  const label = new Map(p.chats.map((c, i) => [c, `S${i + 1}`]));
  const asked = p.chats.flatMap((c) => c.questions.map((q) => ({ ...q, s: label.get(c) })));
  const own = asked.filter((q) => q.own);
  const interrupted = sum(p.chats, (c) => c.interrupted);
  const refused = p.chats.flatMap((c) => c.refused.map((r) => `[${label.get(c)}] ${r}`));
  const hooks = merged(p.chats, "hooks");
  const errors = {};
  for (const c of p.chats) for (const [tool, t] of Object.entries(c.errors)) { const m = (errors[tool] ||= { n: 0, kinds: {} }); m.n += t.n; for (const [k, v] of Object.entries(t.kinds)) bump(m.kinds, k, v); }
  const again = {};
  for (const c of p.chats) for (const t of c.turns) if (t.text.length >= 15) bump(again, t.text.toLowerCase().slice(0, 120));
  const repeats = Object.entries(again).filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1]).slice(0, 8);

  const head = [
    `# ${path.basename(p.where)}`, "", `Folder: ${p.where}`,
    `Last ${days} days: ${p.chats.length} chats, ${p.requests} requests, ${asked.length} questions asked (${own.length} answered in the user's own words), ${interrupted} replies interrupted, ${refused.length} tool calls refused.`,
    `Tools: ${topOf(merged(p.chats, "tools"), 12)}`, `Skills: ${topOf(merged(p.chats, "skills"))}`, `Slash commands: ${topOf(merged(p.chats, "commands"))}`,
    `Kinds of file written: ${topOf(merged(p.chats, "kinds"))}`, `Hook blocks: ${topOf(hooks)}`, "", "## Signals", "",
    `### Questions the user answered in their own words (${own.length})`, ...own.map((q) => `- [${q.s}] Asked: "${cut(q.q, 160)}" Options: ${q.options.map((o) => cut(o, 60)).join(" | ") || "none"} Typed: "${cut(q.answer, 300)}"`), "",
    `### Tool calls the user refused (${refused.length})`, ...refused.slice(0, 15).map((r) => `- ${r}`), "",
    "### Tools that failed", ...Object.entries(errors).sort((a, b) => b[1].n - a[1].n).slice(0, 8).map(([tool, t]) => `- ${tool}: ${t.n} (${topOf(t.kinds, 3)})`), "",
    "### Requests sent more than once", ...repeats.map(([text, n]) => `- ${n} times: "${text}"`), "",
    "## Chats (newest first; S-labels are used above)", "",
  ];
  const body = [];
  let size = Buffer.byteLength(head.join("\n")), left = 0;
  for (const c of p.chats) {
    const part = [`### ${label.get(c)} ${day(c.first)} ${c.title ? `"${c.title}"` : ""} (${c.turns.length} requests)`];
    c.turns.forEach((t, i) => {
      part.push(`${i + 1}. USER${t.interrupted ? " (then interrupted the reply)" : ""}: ${cut(t.text)}`);
      if (t.reply) part.push(`   CLAUDE, end of its reply: ${tail(t.reply)}`);
    });
    const text = part.join("\n") + "\n";
    if (size + Buffer.byteLength(text) > maxBytes && body.length) { left++; continue; }
    size += Buffer.byteLength(text);
    body.push(text);
  }
  if (left) body.push(`(${left} older chats left out to keep this file under ${maxBytes / 1024} KB)`);
  // two folders with the same name in different places get different files
  const base = path.basename(p.where).replace(/[^\w.-]+/g, "-") || "project";
  const name = `${base}${rows.filter((r) => path.basename(r.where) === path.basename(p.where)).indexOf(p) || ""}.md`;
  fs.writeFileSync(path.join(out, name), head.join("\n") + body.join("\n") + "\n");
  console.log(`- ${path.basename(p.where)}: ${p.chats.length} chats, ${p.requests} requests, own answers ${own.length} of ${asked.length} questions, interrupted ${interrupted}, refused ${refused.length}, hook blocks ${sum(p.chats, (c) => Object.values(c.hooks).reduce((a, b) => a + b, 0))}, repeats ${repeats.length} -> ${name}`);
}
