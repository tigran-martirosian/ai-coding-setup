#!/usr/bin/env node
// link-gate: Stop hook for the finder project. Backs the rule "a link counts only if it is the
// item's own page, opened in this session". It reads the session's transcript and blocks the reply
// when a link in it (or in a finds/*.md file written this session):
//   - was never opened in this session (browser_navigate, browser_open_session, WebFetch, an address
//     fetched in Bash, a browser script or context-mode, or an "OPENED <url>" line from tools/peek.mjs), or
//   - is a search, category or front page, unless its line says it is a search to save (a front page
//     that was opened passes in a quick answer, where the site itself is the thing recommended), or
//   - failed tools/limits.mjs and its line or table does not say what it breaks.
// It also blocks when limits.json was written this session but tools/limits.mjs was never run and the
// reply lists three or more links. Links the user typed themselves are never questioned.
// It blocks the same reply at most 3 times, then lets it through (no endless loop).
// Fails open. LINK_GATE=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { key, notAnItemPage, isSaveLabel, saysItBreaks, linksIn, threadId } from "../../tools/links.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MAX_BLOCKS = 3;
const URL_RE = /https?:\/\/[^\s<>"'`)\]|\\]+/g;
const textOf = (content) =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((b) => (b.type === "text" ? b.text : typeof b.content === "string" ? b.content : "")).join("\n") : "";

// The threads a command reads with "opencli reddit read <id or url>", also inside "for id in a b c; do ... read $id"
function redditReads(command) {
  if (!/opencli(\.cmd)?\s+reddit\s+read\b/.test(command)) return [];
  const words = [...command.matchAll(/reddit\s+read\s+(\S+)/g)].map((m) => m[1]);
  const loop = /\bfor\s+\w+\s+in\s+([^;\n]+)/.exec(command);
  if (loop && words.some((w) => w.includes("$"))) words.push(...loop[1].trim().split(/\s+/));
  return words.map((w) => threadId(w.replace(/["']/g, ""))).filter(Boolean).map((id) => `https://www.reddit.com/comments/${id}/`);
}

// What the session did, from its transcript entries (parsed JSON lines, in order)
export function scan(entries) {
  const opened = new Set(), typed = new Set(), written = [], calls = new Map();
  let limitsWritten = false, limitsRun = false, siteRun = false, reply = [];
  for (const e of entries) {
    const content = e.message?.content;
    if (e.type === "user") {
      if (typeof content === "string" || (Array.isArray(content) && content.some((b) => b.type === "text"))) {
        for (const u of textOf(content).match(URL_RE) || []) typed.add(key(u));
      }
      for (const b of Array.isArray(content) ? content : []) {
        if (b.type !== "tool_result") continue;
        const call = calls.get(b.tool_use_id);
        if (call && !b.is_error) for (const u of call) opened.add(key(u));
        // also when the line is read back from a background command's output file (Read numbers its lines)
        for (const m of textOf(b.content).matchAll(/^(?:\s*\d+\t)?OPENED (\S+)/gm)) opened.add(key(m[1]));
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
      if (/browser_(navigate|open_session)$|^WebFetch$|ctx_fetch_and_index$/.test(b.name) && input.url) calls.set(b.id, [input.url]);
      else if (/browser_evaluate$|ctx_(execute|execute_file|batch_execute)$/.test(b.name)) calls.set(b.id, JSON.stringify(input).match(URL_RE) || []); // a fetch() written in a script
      else if (/^(Bash|PowerShell)$/.test(b.name)) {
        const command = String(input.command || "");
        if (/limits\.mjs/.test(command)) limitsRun = true;
        if (/site\.mjs/.test(command)) siteRun = true;
        if (!/(site|peek|reddit)\.mjs/.test(command)) calls.set(b.id, [...(command.match(URL_RE) || []), ...redditReads(command)]);
      } else if (/^(Write|Edit)$/.test(b.name)) {
        const file = String(input.file_path || "").replace(/\\/g, "/");
        if (/\/finds\/[^/]+\.md$/i.test(file)) written.push({ file, text: String(input.content ?? input.new_string ?? "") });
        if (/\/limits\.json$/i.test(file)) limitsWritten = true;
      }
    }
  }
  // A full hunt (limits written or checked, or a marketplace read) as against a quick answer
  return { opened, typed, written, limitsWritten, limitsRun, hunt: limitsWritten || limitsRun || siteRun, reply: reply.join("\n") };
}

// The links that may not stand, each with the reason
export function problems(text, { opened, typed = new Set(), checked = {}, hunt = true }) {
  const out = [], seen = new Set();
  for (const l of linksIn(text)) {
    const k = key(l.url);
    if (!k || seen.has(k) || typed.has(k)) continue;
    seen.add(k);
    const kind = notAnItemPage(l.url);
    if (kind) {
      const ownSite = kind === "a site's front page" && !hunt && opened.has(k);
      if (!ownSite && !isSaveLabel(l.line) && !isSaveLabel(l.intro)) out.push({ url: l.url, why: `is ${kind}, not an item's own page` });
    } else if (!opened.has(k)) out.push({ url: l.url, why: "was never opened in this session" });
    else if (checked[k] && !checked[k].ok && !saysItBreaks(`${l.line}\n${l.intro}\n${l.thead}`)) {
      out.push({ url: l.url, why: `breaks a limit (${checked[k].reasons.join("; ")}) and its line does not say so` });
    }
  }
  return out;
}

// Verdicts from tools/limits.mjs, newest two days only
function loadChecked() {
  const all = {};
  const dir = path.join(ROOT, "finds", "sources");
  for (const topic of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    const file = path.join(dir, topic, "checked.json");
    try {
      if (Date.now() - fs.statSync(file).mtimeMs > 48 * 3600e3) continue;
      for (const r of JSON.parse(fs.readFileSync(file, "utf8")).rows) if (r.url) all[key(r.url)] = r;
    } catch {}
  }
  return all;
}

export function verdict(input) {
  const entries = [];
  for (const line of fs.readFileSync(input.transcript_path, "utf8").split("\n")) {
    try { entries.push(JSON.parse(line)); } catch {}
  }
  const s = scan(entries);
  const reply = typeof input.last_assistant_message === "string" && input.last_assistant_message ? input.last_assistant_message : s.reply;
  const ctx = { opened: s.opened, typed: s.typed, checked: input.checked || loadChecked(), hunt: s.hunt };
  const bad = problems(reply, ctx).map((p) => ({ ...p, where: "the reply" }));
  for (const w of s.written) {
    let now = "";
    try { now = fs.readFileSync(w.file, "utf8"); } catch { continue; }
    // only what this session wrote and is still in the file
    for (const p of problems(w.text, ctx)) if (now.includes(p.url) && !bad.some((b) => b.url === p.url)) bad.push({ ...p, where: path.basename(w.file) });
  }
  const listed = linksIn(reply).filter((l) => !notAnItemPage(l.url)).length;
  const noLimits = s.limitsWritten && !s.limitsRun && listed >= 3;
  return { bad, noLimits };
}

export function reason({ bad, noLimits }) {
  const lines = [];
  if (bad.length) {
    lines.push(`[link-gate] ${bad.length} link(s) may not stand:`);
    for (const b of bad.slice(0, 12)) lines.push(`- ${b.url} ${b.why} (in ${b.where})`);
    if (bad.length > 12) lines.push(`- and ${bad.length - 12} more`);
    lines.push(
      "Fix each one in ONE command, then answer again: open the pages (`node tools/peek.mjs <url> <url>...`, WebFetch or the browser) and list each only if it is live; " +
      "or take the link out and say in words that it was not opened. A search link stays only on a line that says it is a search to save. " +
      "A listing that breaks a limit goes under \"ruled out\" or in a table with a \"what breaks\" column. Fix the finds/ file too if it is named above.");
  }
  if (noLimits) lines.push("[link-gate] limits.json was written but the candidates were never checked: write candidates.json and run `node tools/limits.mjs <topic folder>` before presenting, and put its \"Dropped:\" line in the answer.");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if ((process.env.LINK_GATE || "").toLowerCase() === "off") return;
      const input = JSON.parse(raw);
      if (!input.transcript_path) return;
      const v = verdict(input);
      const dir = path.join(os.tmpdir(), "finder-link-gate");
      const stateFile = path.join(dir, `${String(input.session_id || "none").replace(/[^\w-]/g, "")}.json`);
      let blocks = 0;
      try { blocks = JSON.parse(fs.readFileSync(stateFile, "utf8")).blocks || 0; } catch {}
      const failing = v.bad.length || v.noLimits;
      // stop_hook_active is false on a fresh reply: the count starts again there
      if (!input.stop_hook_active) blocks = 0;
      fs.mkdirSync(dir, { recursive: true });
      if (!failing || blocks >= MAX_BLOCKS) {
        fs.writeFileSync(stateFile, JSON.stringify({ blocks: 0 }));
        if (failing) process.stderr.write(`link-gate: let through after ${MAX_BLOCKS} blocks, ${v.bad.length} link(s) still unchecked\n`);
        return;
      }
      fs.writeFileSync(stateFile, JSON.stringify({ blocks: blocks + 1 }));
      process.stdout.write(JSON.stringify({ decision: "block", reason: reason(v) }));
    } catch {
      // fail open
    }
  });
}
