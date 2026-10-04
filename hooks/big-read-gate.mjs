#!/usr/bin/env node
// big-read-gate: a PreToolUse hook that blocks whole-file dumps of large text files.
// Based on the "shunt" pattern from Spotify's portal-ai-plugins: hooks enforce, the model routes.
// Covers Read, and cat/less/more/head/tail/type/Get-Content in Bash or PowerShell (also inside
// powershell -Command '...' and bash -c '...'). A pipe or redirect lets a command through only
// when it narrows the output or sends it to a file: "cat big | grep x" and "cat big > out" pass,
// "cat big | tee out" and "cat big 2>/dev/null" don't. File name patterns (*.log) are not expanded.
// It fails open, so any error or odd input lets the call through. BIG_READ_GATE=off disables it.
import { readFileSync, statSync, writeSync } from "node:fs";
import { resolve, extname, dirname, join } from "node:path";

const MAX_LINES = Number(process.env.BIG_READ_MAX_LINES) || 350;
const MAX_BYTES = Number(process.env.BIG_READ_MAX_BYTES) || 50000;
const AGY_MODEL = process.env.BIG_READ_AGY_MODEL || "gemini-3.8-flash-medium";
const READ_CAP = 2000; // lines the Read tool returns when no limit is given
const BINARY = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".ico", ".pdf", ".ipynb"]);

// Git Bash on Windows writes C:\ as /c/
const native = (p) => (process.platform === "win32" ? p.replace(/^\/([a-zA-Z])(\/|$)/, "$1:/") : p);

function measure(path) {
  const st = statSync(path);
  if (!st.isFile() || BINARY.has(extname(path).toLowerCase())) return null;
  if (st.size > 20e6) return { lines: Math.ceil(st.size / 40), bytes: st.size }; // too big to count quickly
  const buf = readFileSync(path);
  let lines = 1;
  for (const b of buf) if (b === 10) lines++;
  return { lines, bytes: st.size };
}

// How many lines and bytes a read would put in context
function returned(m, from = 0, count = READ_CAP) {
  const lines = Math.max(0, Math.min(count, m.lines - from));
  return { lines, bytes: Math.round((m.bytes * lines) / m.lines) };
}

const tooBig = (r) => r.lines > MAX_LINES || r.bytes > MAX_BYTES;

function deny(path, m) {
  const kb = Math.round(m.bytes / 1024);
  const reason = [
    `[big-read-gate] ${path} is ${m.lines} lines (${kb} KB). Reading it whole would put all of it in context. Instead:`,
    `1. Locate the part you need (Grep with line numbers), then Read with offset/limit, at most ${MAX_LINES} lines.`,
    `2. To understand or summarise it, hand the reading to a cheap worker and keep only its answer. Use the first one available:`,
    `   - Antigravity (Gemini): agy -p "Read ${path}. <specific question>. Answer in terse bullets, each starting with the line number. Do not edit anything." --mode plan --model ${AGY_MODEL}`,
    `   - Codex (ChatGPT): ~/.claude/workers/ask-codex.sh "Read ${path}. <specific question>. Answer in terse bullets, each starting with the line number."`,
    `   - Otherwise a haiku subagent (Agent tool, model: haiku) that answers from targeted reads.`,
    `   Ask one specific question per call. Treat the answer as a lead, not ground truth.`,
    `Before editing, confirm the exact lines with a targeted Read. Never edit from a summary alone.`,
  ].join("\n");
  writeSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  process.exit(0);
}

// Splits a command into words and operators. Quotes, escapes, comments and heredoc bodies are
// honoured, so a ";" or "|" inside a string is not an operator. ps = PowerShell rules (the
// backtick escapes and a backslash is an ordinary character).
// Tokens: { w: word }, { op: ";" } (also &&, ||, &, newline), { op: "|" }, { redir: "<" | ">", fd }
function tokenize(s, ps) {
  const out = [];
  const esc = ps ? "`" : "\\";
  const heredocs = [];
  let w = null; // the word being built; null between words
  const push = () => { if (w !== null) out.push({ w }); w = null; };
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "'") {
      const end = s.indexOf("'", i + 1);
      w = (w ?? "") + s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end;
    } else if (c === '"') {
      w ??= "";
      for (i++; i < s.length && s[i] !== '"'; i++) {
        if (s[i] === esc && i + 1 < s.length && (ps || '"\\$`'.includes(s[i + 1]))) i++;
        w += s[i];
      }
    } else if (c === esc && i + 1 < s.length) {
      i++;
      if (s[i] !== "\n") w = (w ?? "") + s[i]; // an escaped newline joins two lines
    } else if (c === "#" && w === null) {
      while (i + 1 < s.length && s[i + 1] !== "\n") i++; // comment, up to the end of the line
    } else if (c === "\n" || c === ";") {
      push();
      out.push({ op: ";" });
      while (c === "\n" && heredocs.length) { // skip the heredoc bodies that start on the next line
        const mark = heredocs.shift();
        for (;;) {
          const end = s.indexOf("\n", i + 1);
          const line = s.slice(i + 1, end < 0 ? s.length : end);
          i = end < 0 ? s.length : end;
          if (end < 0 || line.trim() === mark) break;
        }
      }
    } else if (/\s/.test(c)) {
      push();
    } else if (c === "|") {
      push();
      if (s[i + 1] === "|") { i++; out.push({ op: ";" }); }
      else { if (s[i + 1] === "&") i++; out.push({ op: "|" }); }
    } else if (c === "&" && s[i + 1] === ">") {
      push();
      i += s[i + 2] === ">" ? 2 : 1;
      out.push({ redir: ">", fd: "" });
    } else if (c === "&") {
      push();
      if (s[i + 1] === "&") i++;
      out.push({ op: ";" });
    } else if (c === "<" || c === ">") {
      let fd = "";
      if (w !== null && /^\d+$/.test(w) && s.slice(i - w.length, i) === w) { fd = w; w = null; } // 2> and the like
      push();
      if (c === "<" && s[i + 1] === "<" && s[i + 2] !== "<") {
        const m = /^-?[ \t]*(['"]?)([^\s'"<>|;&]+)\1/.exec(s.slice(i + 2));
        if (m) { heredocs.push(m[2]); i += 1 + m[0].length; continue; }
      }
      if (c === "<") { while (s[i + 1] === "<") i++; out.push({ redir: "<" }); continue; }
      if (s[i + 1] === ">") i++;
      if (s[i + 1] === "&") { i++; while (/[\d-]/.test(s[i + 1] ?? "")) i++; continue; } // 2>&1: no file involved
      if (s[i + 1] === "|") i++;
      out.push({ redir: ">", fd });
    } else {
      w = (w ?? "") + c;
    }
  }
  push();
  return out;
}

// One stage of a pipeline: its command name, arguments, "< file" inputs and whether its output goes to a file
function parseStage(tokens) {
  const args = [], inputs = [];
  let toFile = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t.redir) { args.push(t.w); continue; }
    const target = tokens[i + 1]?.w;
    if (target !== undefined) i++;
    if (t.redir === "<") { if (target) inputs.push(target); }
    else if (t.fd === "" || t.fd === "1") toFile = true;
  }
  // Words that can stand before the command: VAR=value, "do", "then", "sudo" and the like
  while (args.length > 1 && /^([A-Za-z_]\w*=.*|then|do|else|time|sudo|command|[({!])$/.test(args[0])) args.shift();
  const name = (args.shift() || "").toLowerCase().replace(/^[({]+/, "").replace(/^.*[\\/]/, "").replace(/\.exe$/, "");
  return { name, args, inputs, toFile };
}

const READERS = new Set(["cat", "less", "more", "type", "gc", "get-content", "head", "tail"]);
// Commands that hand everything they get on to the screen, so a pipe into them is still a whole-file dump
const PASS_THROUGH = new Set(["tee", "cat", "less", "more", "nl", "sort", "tac", "tee-object", "out-host", "out-string", "out-default", "write-output", "write-host"]);
const COUNT_FLAGS = new Set(["-totalcount", "-head", "-tail", "-first", "-last", "--lines"]);
const VALUE_FLAGS = new Set(["-encoding", "-readcount", "-delimiter", "-stream", "-c", "--bytes"]);

// The files a stage reads and how many lines it prints (null = all of them). A count stays
// unlimited for "tail -n +5" (from line 5 to the end) and "head -n -5" (all but the last 5).
function readPlan(stage) {
  const { name } = stage;
  const headTail = name === "head" || name === "tail";
  const limiter = headTail || name === "select" || name === "select-object";
  if (!READERS.has(name) && !limiter) return null;
  const toCount = (v = "") => (/^[+-]/.test(v) ? (v[0] === (name === "tail" ? "+" : "-") ? null : parseInt(v.slice(1), 10) || 0) : parseInt(v, 10) || 0);
  let count = headTail ? 10 : null;
  const files = [...stage.inputs];
  for (let i = 0; i < stage.args.length; i++) {
    let a = stage.args[i], value;
    const colon = /^(--?[A-Za-z]+)[:=](.+)$/.exec(a); // -TotalCount:40, --lines=40
    if (colon) [, a, value] = colon;
    const lower = a.toLowerCase();
    const next = () => value ?? stage.args[++i];
    if (COUNT_FLAGS.has(lower) || (headTail && lower === "-n")) count = toCount(next());
    else if (headTail && /^-n?\d+$/.test(a)) count = parseInt(a.replace(/\D/g, ""), 10);
    else if (lower === "-path" || lower === "-literalpath") files.push(next());
    else if (VALUE_FLAGS.has(lower)) next();
    else if (!a.startsWith("-") && !a.startsWith("+")) files.push(a);
  }
  return { count, files: READERS.has(name) ? files.filter(Boolean) : [], limits: limiter };
}

function checkPipeline(stages, cwd, depth) {
  for (let i = 0; i < stages.length; i++) {
    const stage = stages[i];
    const plan = readPlan(stage);
    let count = plan ? plan.count : null;
    // What happens to this stage's output: written to a file or filtered (targeted), or cut to a line count
    let targeted = stages.slice(i).some((s) => s.toFile);
    for (const later of stages.slice(i + 1)) {
      const cut = readPlan(later);
      if (cut?.limits) count = cut.count === null ? count : count === null ? cut.count : Math.min(count, cut.count);
      else if (!PASS_THROUGH.has(later.name)) targeted = true;
    }
    if (targeted) continue;
    // powershell -Command '...' and bash -c '...' carry a command of their own
    const isPs = stage.name === "powershell" || stage.name === "pwsh";
    if ((isPs || stage.name === "bash" || stage.name === "sh") && count === null && depth < 2) {
      const at = stage.args.findIndex((a) => (isPs ? /^-(c|command)$/i : /^-[a-z]*c$/).test(a));
      if (at >= 0) checkShell(isPs ? stage.args.slice(at + 1).join(" ") : stage.args[at + 1] || "", cwd, isPs, depth + 1);
      continue;
    }
    for (const f of plan ? plan.files : []) {
      const path = resolve(native(cwd), native(f));
      let m = null;
      try { m = measure(path); } catch {} // no such file: nothing to dump
      if (m && tooBig(count === null ? m : returned(m, 0, count))) deny(path, m);
    }
  }
}

function checkShell(command, cwd, ps, depth = 0) {
  let stages = [[]];
  const flush = () => {
    checkPipeline(stages.filter((s) => s.length).map(parseStage), cwd, depth);
    stages = [[]];
  };
  for (const t of tokenize(command, ps)) {
    if (t.op === ";") flush();
    else if (t.op === "|") stages.push([]);
    else stages[stages.length - 1].push(t);
  }
  flush();
}

// A project opts out with "env": { "BIG_READ_GATE": "off" } in its .claude/settings(.local).json.
// Read the files directly, because settings env may not reach hook processes.
function projectOptedOut(dir) {
  for (let d = resolve(dir); ; d = dirname(d)) {
    for (const f of ["settings.local.json", "settings.json"]) {
      try {
        const env = JSON.parse(readFileSync(join(d, ".claude", f), "utf8")).env || {};
        if (String(env.BIG_READ_GATE).toLowerCase() === "off") return true;
      } catch {}
    }
    if (dirname(d) === d) return false;
  }
}

try {
  if ((process.env.BIG_READ_GATE || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  const input = event.tool_input || {};
  const cwd = native(event.cwd || process.cwd());
  if (projectOptedOut(cwd)) process.exit(0);
  if (event.tool_name === "Read" && input.file_path) {
    const path = resolve(native(cwd), native(input.file_path));
    const m = measure(path);
    const from = input.offset ? Math.max(0, input.offset - 1) : 0;
    if (m && tooBig(returned(m, from, input.limit || READ_CAP))) deny(path, m);
  } else if (["Bash", "PowerShell"].includes(event.tool_name) && input.command) {
    checkShell(input.command, cwd, event.tool_name === "PowerShell");
  }
} catch {
  // Fail open
}
process.exit(0);
