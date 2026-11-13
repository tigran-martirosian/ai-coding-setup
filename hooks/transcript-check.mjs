#!/usr/bin/env node
// transcript-check: SessionStart hook. About a dozen hooks read Claude Code's own transcript, a private format,
// and they fail open, so a change to it would turn them off with no sign. Their tests use made-up lines, so this
// one looks at a real one: the tail of the project's newest earlier transcript, once per Claude Code version.
// It says out loud what is missing; it never stops anything. TRANSCRIPT_CHECK=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TAIL = 512 * 1024;
const STATE = process.env.TRANSCRIPT_CHECK_STATE || path.join(os.homedir(), ".claude", "hooks", "state", "transcript-check.json");

function newestOther(current) {
  const folder = path.dirname(current);
  const found = fs.readdirSync(folder).filter((f) => f.endsWith(".jsonl") && path.join(folder, f) !== path.normalize(current))
    .map((f) => { const p = path.join(folder, f), s = fs.statSync(p); return { p, size: s.size, time: s.mtimeMs }; })
    .filter((f) => f.size > 0).sort((a, b) => b.time - a.time);
  return found[0];
}

function tailEntries({ p, size }) {
  const len = Math.min(size, TAIL), buf = Buffer.alloc(len), fd = fs.openSync(p, "r");
  try { fs.readSync(fd, buf, 0, len, size - len); } finally { fs.closeSync(fd); }
  const lines = buf.toString("utf8").split("\n");
  if (len < size) lines.shift(); // the first line was cut in half
  const out = { entries: [], bad: 0 };
  for (const l of lines) {
    if (!l.trim()) continue;
    try { out.entries.push(JSON.parse(l)); } catch { out.bad++; }
  }
  return out;
}

// What the hooks rely on. null = this transcript has no tool call, so it can't show anything either way
export function missing(entries) {
  const blocks = entries.flatMap((e) => (Array.isArray(e.message?.content) ? e.message.content.map((b) => ({ e, b })) : []));
  const uses = blocks.filter(({ e, b }) => e.type === "assistant" && b?.type === "tool_use");
  const results = blocks.filter(({ e, b }) => e.type === "user" && b?.type === "tool_result");
  if (!uses.length) return entries.length ? null : ["any readable line"];
  const gone = [];
  if (!results.length && uses.length > 1) gone.push("tool_result blocks in user lines"); // one call: a run killed on it
  if (!entries.some((e) => e.timestamp && !Number.isNaN(Date.parse(e.timestamp)))) gone.push("timestamp");
  if (!uses.every(({ b }) => b.id && b.name && b.input)) gone.push("id, name and input on tool_use blocks");
  if (results.length && !results.some(({ b }) => b.tool_use_id)) gone.push("tool_use_id on tool_result blocks");
  return gone;
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  try {
    if ((process.env.TRANSCRIPT_CHECK || "").toLowerCase() === "off") process.exit(0);
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    if (!input.transcript_path) process.exit(0);
    const newest = newestOther(input.transcript_path);
    if (!newest) process.exit(0);
    const { entries, bad } = tailEntries(newest);
    if (!entries.length && !bad) process.exit(0); // one line longer than the tail, a pasted picture say: nothing to judge
    const version = [...entries].reverse().find((e) => e.version)?.version || "unknown";
    let state = {};
    try { state = JSON.parse(fs.readFileSync(STATE, "utf8")); } catch {}
    if (state.ok === version && version !== "unknown") process.exit(0);
    const gone = missing(entries);
    if (gone === null) process.exit(0);
    if (!gone.length) {
      fs.mkdirSync(path.dirname(STATE), { recursive: true });
      fs.writeFileSync(STATE, JSON.stringify({ ok: version }));
      process.exit(0);
    }
    const say = `transcript-check: Claude Code ${version} changed its transcript: ${gone.join(", ")} not found in ${path.basename(newest.p)}${bad ? ` (${bad} lines did not parse)` : ""}. ` +
      `The hooks that read it (code-review-gate, repeat-guard, question-other and others) may be doing nothing. Tell the user before relying on them.`;
    process.stdout.write(JSON.stringify({ systemMessage: say, hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: say } }));
  } catch {
    // fail open
  }
}
