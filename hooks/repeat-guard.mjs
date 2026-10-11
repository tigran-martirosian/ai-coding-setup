#!/usr/bin/env node
// repeat-guard: a PreToolUse hook that stops two kinds of looping inside one turn (a turn is everything
// done since the user's last message). It reads the transcript backwards, in 2 MB chunks, until the
// user's last message is found (the way turn-cap does), so a long turn with big pictures is still seen
// from its start. A background-task notification (<task-notification>, [System: background task) arrives
// as a user message but is not a new turn: it does not reset the counts.
//   1. Repeat-error gate: when the last three tool results of the turn are all errors from the same tool
//      with the same first 80 characters of text, and the three failed calls had the same target (the
//      file_path, else the first 80 characters of the command, else of the input as JSON), the call
//      about to run is denied if it is that same tool with that same target, i.e. a retry. Any other
//      call passes. The denial is a different error, so the next retry passes.
//   2. Same-file reminder (never refuses): the 6th edit of one file in a turn, or the 4th read of one
//      file, goes through with a short reminder as additional context. Exactly at that count only.
// Thresholds: REPEAT_GUARD_ERRORS (3), REPEAT_GUARD_EDITS (6), REPEAT_GUARD_READS (4).
// Fails open: any problem lets the call through silently. REPEAT_GUARD=off disables it.
import fs from "node:fs";

const ERRORS = Number(process.env.REPEAT_GUARD_ERRORS) || 3;
const EDITS = Number(process.env.REPEAT_GUARD_EDITS) || 6;
const READS = Number(process.env.REPEAT_GUARD_READS) || 4;
const CHUNK_BYTES = 2 * 1024 * 1024;
const EDIT_TOOLS = ["Edit", "MultiEdit", "Write"];

const parts = (c) => (Array.isArray(c) ? c : []);
const textOf = (c) => (typeof c === "string" ? c : parts(c).map((p) => p.text ?? "").join(" "));
const NOTIFICATION = /^(<task-notification>|\[System: background task)/;
const isRealUser = (j) =>
  j.type === "user" && !j.isMeta &&
  (typeof j.message?.content === "string" || parts(j.message?.content).some((p) => p.type === "text")) &&
  !NOTIFICATION.test(textOf(j.message?.content).trimStart());
const targetOf = (input) => input?.file_path ?? String(input?.command ?? JSON.stringify(input ?? {})).slice(0, 80);

// Reads the file backwards in 2 MB chunks until the last real user message is found (or the file start),
// and returns the parsed lines from that message on. A partial line at a chunk start is carried as a Buffer.
function readTurn(file) {
  const fd = fs.openSync(file, "r");
  try {
    let pos = fs.fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    let later = []; // parsed lines after the chunk being scanned, in file order
    while (pos > 0 || carry.length) {
      const len = Math.min(pos, CHUNK_BYTES);
      pos -= len;
      const chunk = Buffer.alloc(len);
      if (len) fs.readSync(fd, chunk, 0, len, pos);
      let buf = Buffer.concat([chunk, carry]);
      carry = Buffer.alloc(0);
      if (pos > 0) {
        const nl = buf.indexOf(10);
        if (nl < 0) { carry = buf; continue; }
        carry = buf.subarray(0, nl);
        buf = buf.subarray(nl + 1);
      }
      const parsed = [];
      for (const line of buf.toString("utf8").split("\n")) {
        if (!line.trim()) continue;
        try { parsed.push(JSON.parse(line)); } catch { /* skip */ }
      }
      for (let i = parsed.length - 1; i >= 0; i--) {
        if (!parsed[i].isSidechain && isRealUser(parsed[i])) return parsed.slice(i + 1).concat(later);
      }
      later = parsed.concat(later);
      if (pos === 0) break;
    }
    return later;
  } finally { fs.closeSync(fd); }
}

const deny = (reason) => process.stdout.write(JSON.stringify({
  hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: `repeat-guard: ${reason}` },
}));

try {
  if ((process.env.REPEAT_GUARD || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(fs.readFileSync(0, "utf8"));
  if (!event.transcript_path || !fs.existsSync(event.transcript_path)) process.exit(0);

  // The entries after the last real user message
  const entries = readTurn(event.transcript_path).filter((j) => !j.isSidechain);

  const uses = new Map(); // tool_use id -> { name, target }
  const calls = []; // { name, file }
  const results = []; // { name, error, text }
  for (const j of entries) {
    for (const p of parts(j.message?.content)) {
      if (j.type === "assistant" && p.type === "tool_use") {
        uses.set(p.id, { name: p.name, target: targetOf(p.input) });
        calls.push({ name: p.name, file: p.input?.file_path });
      } else if (j.type === "user" && p.type === "tool_result") {
        const u = uses.get(p.tool_use_id);
        results.push({ name: u?.name, target: u?.target, error: p.is_error === true, text: textOf(p.content).slice(0, 80) });
      }
    }
  }

  const last = results.slice(-ERRORS);
  if (last.length === ERRORS && last.every((r) => r.error && r.name && r.name === last[0].name && r.text === last[0].text && r.target === last[0].target) &&
    event.tool_name === last[0].name && targetOf(event.tool_input) === last[0].target) {
    deny(
      `the same error came back ${ERRORS} times from ${last[0].name}: "${last[0].text}". Do not retry it. ` +
      `If the error says the file changed, read the file again; otherwise take a different approach. ` +
      `If no other approach is left, ask the user in a form with options and include the error text.`,
    );
    process.exit(0);
  }

  const name = event.tool_name;
  const file = event.tool_input?.file_path;
  if (!file) process.exit(0);
  let reminder = "";
  if (EDIT_TOOLS.includes(name)) {
    const before = calls.filter((c) => EDIT_TOOLS.includes(c.name) && c.file === file).length;
    if (before + 1 === EDITS) reminder = `[repeat-guard] This is the ${EDITS}th edit of this file in this turn. Plan the remaining changes to it and make them in one edit.`;
  } else if (name === "Read") {
    const before = calls.filter((c) => c.name === "Read" && c.file === file).length;
    if (before + 1 === READS) reminder = `[repeat-guard] This file has been read ${before} times in this turn. Its content is already in the conversation; don't read it again.`;
  }
  if (reminder) process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reminder } }));
} catch {
  process.exit(0);
}
