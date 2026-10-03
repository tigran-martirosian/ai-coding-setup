#!/usr/bin/env node
// link-gate: a Stop hook. Before a reply goes out, it reads the session's transcript and blocks the
// reply when it gives a link that was never opened in this session. Opened means a tool call that
// went to the address and did not fail: a browser tool navigated there, WebFetch or a fetch tool read
// it, or a shell command or script fetched it. A link that only showed up in search results was not
// opened. Links the user typed are never questioned, and neither are local or example addresses.
// It blocks the same reply at most 3 times, then lets it through, so it can't loop.
// Fails open. LINK_GATE=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const MAX_BLOCKS = 3;
const URL_RE = /https?:\/\/[^\s<>"'`)\]|\\]+/g;
const IGNORED_HOST = /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$|(^|\.)example\.(com|org|net)$|\.(test|example|invalid|localhost)$/;
const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (b.type === "text" ? b.text : typeof b.content === "string" ? b.content : "")).join("\n") : "";

function parse(url) {
  try {
    const x = new URL(String(url));
    if (!/^https?:$/.test(x.protocol)) return null;
    return { x, host: x.hostname.toLowerCase().replace(/^(www|m|mobile)\./, ""), path: x.pathname.replace(/\/+$/, "").toLowerCase() };
  } catch { return null; }
}

// One key per page: host and path. The query is ignored (tracking), except on a bare home page
// address, where it is all there is.
export function key(url) {
  const p = parse(url);
  return p ? p.host + p.path + (p.path ? "" : p.x.search) : "";
}

// Every http(s) link in a text that the gate should judge
export function linksIn(text) {
  const out = [];
  for (const m of String(text || "").matchAll(URL_RE)) {
    const url = m[0].replace(/[.,;:!?*]+$/, "");
    const p = parse(url);
    if (p && !IGNORED_HOST.test(p.x.hostname.toLowerCase()) && !/[{}]/.test(url)) out.push(url);
  }
  return out;
}

// What the session did, from its transcript entries (parsed JSON lines, in order)
export function scan(entries) {
  const opened = new Set(), typed = new Set(), calls = new Map();
  let reply = [];
  for (const e of entries) {
    if (e.isSidechain) continue;
    const content = e.message?.content;
    if (e.type === "user") {
      if (typeof content === "string" || (Array.isArray(content) && content.some((b) => b.type === "text"))) {
        for (const u of textOf(content).match(URL_RE) || []) typed.add(key(u));
      }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type !== "tool_result" || b.is_error) continue;
        for (const u of calls.get(b.tool_use_id) || []) opened.add(key(u));
      }
      reply = [];
      continue;
    }
    if (e.type !== "assistant" || !Array.isArray(content)) continue;
    const said = content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (content.some((b) => b.type === "tool_use")) reply = [];
    else if (said) reply.push(said);
    for (const b of content) {
      if (b.type !== "tool_use") continue;
      const input = b.input || {};
      if (/browser_(navigate|open_session)$|^WebFetch$|fetch_and_index$/.test(b.name) && input.url) calls.set(b.id, [input.url]);
      // a fetch written in a browser script or a sandboxed script, or an address fetched in the shell
      else if (/browser_evaluate$|ctx_(execute|execute_file|batch_execute)$|^(Bash|PowerShell)$/.test(b.name)) calls.set(b.id, JSON.stringify(input).match(URL_RE) || []);
    }
  }
  return { opened, typed, reply: reply.join("\n") };
}

// The links in a text that were never opened, each once
export function problems(text, { opened, typed = new Set() }) {
  const out = [], seen = new Set();
  for (const url of linksIn(text)) {
    const k = key(url);
    if (!k || seen.has(k) || typed.has(k)) continue;
    seen.add(k);
    if (!opened.has(k)) out.push(url);
  }
  return out;
}

export function verdict(input) {
  const entries = [];
  for (const line of fs.readFileSync(input.transcript_path, "utf8").split("\n")) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  const s = scan(entries);
  const reply = typeof input.last_assistant_message === "string" && input.last_assistant_message ? input.last_assistant_message : s.reply;
  return problems(reply, s);
}

export function reason(bad) {
  const lines = [`[link-gate] ${bad.length} link(s) in this reply were never opened in this session:`];
  for (const url of bad.slice(0, 12)) lines.push(`- ${url}`);
  if (bad.length > 12) lines.push(`- and ${bad.length - 12} more`);
  lines.push("Open each one (WebFetch or the browser) and keep it only if it loads and says what the reply claims, " +
    "or take it out and say in words that it was not checked. Then answer again.");
  return lines.join("\n");
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if ((process.env.LINK_GATE || "").toLowerCase() === "off") return;
      const input = JSON.parse(raw);
      if (!input.transcript_path) return;
      const bad = verdict(input);
      const dir = path.join(os.tmpdir(), "link-gate");
      const stateFile = path.join(dir, `${String(input.session_id || "none").replace(/[^\w-]/g, "")}.json`);
      let blocks = 0;
      try { blocks = JSON.parse(fs.readFileSync(stateFile, "utf8")).blocks || 0; } catch {}
      // stop_hook_active is false on a fresh reply: the count starts again there
      if (!input.stop_hook_active) blocks = 0;
      fs.mkdirSync(dir, { recursive: true });
      if (!bad.length || blocks >= MAX_BLOCKS) {
        fs.writeFileSync(stateFile, JSON.stringify({ blocks: 0 }));
        if (bad.length) process.stderr.write(`link-gate: let through after ${MAX_BLOCKS} blocks, ${bad.length} link(s) still unopened\n`);
        return;
      }
      fs.writeFileSync(stateFile, JSON.stringify({ blocks: blocks + 1 }));
      process.stdout.write(JSON.stringify({ decision: "block", reason: reason(bad) }));
    } catch {
      // fail open
    }
  });
}
