#!/usr/bin/env node
// big-read-gate: a PreToolUse hook that blocks whole-file dumps of large text files.
// Based on the "shunt" pattern from Spotify's portal-ai-plugins: hooks enforce, the model routes.
// Covers Read, and cat/less/more/head/tail/type/Get-Content in Bash or PowerShell.
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
    `1. Locate the part you need (Grep with line numbers, or context-mode's ctx_execute_file), then Read with offset/limit, at most ${MAX_LINES} lines.`,
    `2. To understand or summarise it, hand the reading to a cheap worker and keep only its answer. Use the first one available:`,
    `   - Antigravity (Gemini): agy -p "Read ${path}. <specific question>. Answer in terse bullets, each starting with the line number. Do not edit anything." --mode plan --model ${AGY_MODEL}`,
    `   - Codex (ChatGPT): codex exec --skip-git-repo-check --ephemeral -s read-only -c 'windows.sandbox="unelevated"' -c model_reasoning_effort="low" "Read ${path}. <specific question>. Answer in terse bullets, each starting with the line number."`,
    `   - Otherwise a haiku subagent (Agent tool, model: haiku) that answers from targeted reads.`,
    `   Ask one specific question per call. Treat the answer as a lead, not ground truth.`,
    `Before editing, confirm the exact lines with a targeted Read. Never edit from a summary alone.`,
  ].join("\n");
  writeSync(1, JSON.stringify({
    hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason },
  }));
  process.exit(0);
}

// Splits a shell segment into words, keeping quoted strings together
const words = (s) => (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((w) => w.replace(/^["']|["']$/g, ""));

function checkShell(command, cwd) {
  for (const seg of command.split(/&&|\|\||;|\n/)) {
    if (/[|>]/.test(seg)) continue; // piped or redirected output is already targeted
    const [cmd, ...args] = words(seg.trim());
    if (!cmd) continue;
    const name = cmd.toLowerCase();
    let count = null; // null means the whole file
    const files = [];
    if (["head", "tail"].includes(name)) count = 10;
    else if (!["cat", "less", "more", "type", "gc", "get-content"].includes(name)) continue;
    for (let i = 0; i < args.length; i++) {
      const a = args[i];
      const lower = a.toLowerCase();
      if (["-n", "-totalcount", "-head", "-tail", "-first", "-last"].includes(lower)) count = parseInt(args[++i], 10) || 0;
      else if (/^-n\d+$/.test(a) || /^-\d+$/.test(a)) count = parseInt(a.replace(/\D/g, ""), 10);
      else if (["-path", "-literalpath", "-encoding"].includes(lower)) { if (lower !== "-encoding") files.push(args[++i]); else i++; }
      else if (!a.startsWith("-") && !a.startsWith("+")) files.push(a);
    }
    for (const f of files) {
      const path = resolve(native(cwd), native(f));
      const m = measure(path);
      if (m && tooBig(count === null ? m : returned(m, 0, count))) deny(path, m);
    }
  }
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
    checkShell(input.command, cwd);
  }
} catch {
  // Fail open
}
process.exit(0);
