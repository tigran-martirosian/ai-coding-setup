#!/usr/bin/env node
// build-nudge: a PreToolUse hook that reminds the main session, when it runs on Opus or Fable, to plan
// and hand the doing to a cheaper subagent. Measured 2026-10-08 over a week: turns with three or more
// edit steps were two thirds of the cost, each step re-sending the whole conversation at Opus prices.
// A turn is everything done since the user's last message; a step is one reply of the model (several
// tool calls sent together are one step).
//   1. Build: the edit call that comes after BUILD_NUDGE_EDITS (3) edit steps in the turn is denied
//      once, with how to brief a `worker` subagent. Edits to record files (HANDOFF.md, DECISIONS.md,
//      memory and handoff notes) are not counted and never denied.
//   2. Lookups: a read, search or page fetch that comes after BUILD_NUDGE_LOOKUPS (4) lookup-only steps
//      in a row is denied once, pointing to the free worker or a Haiku subagent.
//   3. Requests: once the turn has BUILD_NUDGE_REQUESTS (15) steps with tool calls, the next tool call of any
//      kind gets a note, once per turn. It is not a denial: the call goes through.
// Reminders 1 and 2 come once per turn: repeating the call goes through. Calls sent together with the
// denied one (within BUILD_NUDGE_WINDOW_MS, 3000) are denied with it. Subagents and sessions on a
// cheaper model are left alone. It reads the transcript backwards to the user's last message.
// Fails open: any problem lets the call through silently. BUILD_NUDGE=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const EDITS = Number(process.env.BUILD_NUDGE_EDITS) || 3;
const LOOKUPS = Number(process.env.BUILD_NUDGE_LOOKUPS) || 4;
const REQUESTS = Number(process.env.BUILD_NUDGE_REQUESTS) || 15;
const WINDOW_MS = Number(process.env.BUILD_NUDGE_WINDOW_MS ?? 3000);
const CHUNK_BYTES = 1024 * 1024;
const EDIT_TOOLS = ["Edit", "MultiEdit", "Write", "NotebookEdit"];
const LOOKUP_TOOLS = ["Read", "Grep", "Glob", "WebFetch", "WebSearch"];
const RECORD_FILE = /(HANDOFF|DECISIONS|MEMORY)\.md$|[\\/](memory|handoffs)[\\/]/i;

// Reads the file backwards in 1 MB chunks until the last real user message is found (or the file start),
// and returns the parsed lines from that message on. A partial line at a chunk start is carried as a Buffer.
// (A fixed tail went blind in sessions with pictures: base64 filled it and the turn's steps were not seen.)
function readTurn(file) {
  const fd = fs.openSync(file, "r");
  try {
    let pos = fs.fstatSync(fd).size;
    let carry = Buffer.alloc(0);
    let later = [];
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
        if (!parsed[i].isSidechain && isRealUser(parsed[i])) return parsed.slice(i).concat(later);
      }
      later = parsed.concat(later);
      if (pos === 0) break;
    }
    return later;
  } finally { fs.closeSync(fd); }
}
const parts = (c) => (Array.isArray(c) ? c : []);
const isRealUser = (j) =>
  j.type === "user" && !j.isMeta &&
  (typeof j.message?.content === "string" || parts(j.message?.content).some((p) => p.type === "text"));
const isBuildEdit = (name, input) => EDIT_TOOLS.includes(name) && !RECORD_FILE.test(String(input?.file_path ?? ""));

const BUILD = (n) => [
  `[build-nudge] This turn already has ${n} edit steps on the main model. Every further step re-sends the whole conversation at its price.`,
  `If more than a couple of edits are still to come and you can say what they are, stop editing here and hand the rest to a subagent: subagent_type "worker" (Sonnet), with model "haiku" for renames, formatting and other mechanical edits.`,
  `Brief it so it does not have to think about design: the files, the exact structure to write (names, signatures, what each part does, the wording that matters), what must not change, and the one check that proves it. Then read its report and the diff yourself before saying done.`,
  `If only one or two edits are left, or each one needs this conversation or a decision of yours, repeat the call and it goes through. This reminder comes once per turn.`,
].join("\n");
const LOOKUP = (n) => [
  `[build-nudge] ${n} lookup steps in a row on the main model. Each one re-sends the whole conversation.`,
  `If more gathering is still to come, hand it over in one go: the free worker (~/.claude/workers/ask.mjs "<question, with the files or folders named>"), or a subagent with subagent_type "worker" and model "haiku" given the question, where to look and a short answer format with paths and line numbers.`,
  `If this is the last lookup or two, or you need the exact text in front of you, repeat the call and it goes through. This reminder comes once per turn.`,
].join("\n");
const REQUEST = (n) => [
  `[build-nudge] This turn has already made ${n} requests on the main model, and each one re-sends the whole conversation.`,
  `The session the user talks in leads; it does not build. If work is still to come, hand it over as small jobs, one per helper: subagent_type "worker" (Sonnet, or model "haiku" for mechanical work) with the files, the exact structure to write, what must not change, the one check that proves it and a budget of about 10 tool calls. Gathering goes to the free worker (~/.claude/workers/ask.mjs).`,
  `What only this session can do (reading a report and the diff, the final check, the reply) goes into as few steps as possible: send independent tool calls together. This note comes once per turn and blocks nothing.`,
].join("\n");

try {
  if ((process.env.BUILD_NUDGE || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(fs.readFileSync(0, "utf8"));
  if (event.agent_id) process.exit(0);
  const name = event.tool_name;
  const kind = isBuildEdit(name, event.tool_input) ? "build" : LOOKUP_TOOLS.includes(name) ? "lookup" : null;
  if (!event.transcript_path || !fs.existsSync(event.transcript_path)) process.exit(0);

  // The steps after the last real user message, and the model of the latest reply
  let turn = "cut", model = "";
  const steps = new Map(); // message id -> tool names and inputs
  for (const j of readTurn(event.transcript_path)) {
    if (j.isSidechain) continue;
    if (isRealUser(j)) { turn = j.uuid ?? "cut"; steps.clear(); continue; }
    if (j.type !== "assistant" || !j.message || j.message.model === "<synthetic>") continue;
    model = j.message.model ?? model;
    const id = j.message.id ?? j.uuid;
    const step = steps.get(id) ?? steps.set(id, []).get(id);
    for (const p of parts(j.message.content)) if (p.type === "tool_use") step.push({ name: p.name, input: p.input });
  }
  if (!/opus|fable|mythos/.test(model)) process.exit(0);

  const all = [...steps.values()].filter((s) => s.length);
  let count = 0;
  if (kind === "build") count = all.filter((s) => s.some((t) => isBuildEdit(t.name, t.input))).length;
  else if (kind === "lookup") for (let i = all.length - 1; i >= 0 && all[i].every((t) => LOOKUP_TOOLS.includes(t.name)); i--) count++;

  // Once per turn; calls sent together with the denied one are denied with it
  const dir = path.join(os.tmpdir(), "build-nudge");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${String(event.session_id || "none").replace(/[^\w-]/g, "")}.json`);
  let state = {};
  try { state = JSON.parse(fs.readFileSync(file, "utf8")); } catch {}
  // A long turn pushes the user's message out of the tail: then an earlier reminder counts as this turn's
  const sameTurnAs = (last) => !!last && (last.turn === turn || turn === "cut");

  if (kind && count >= (kind === "build" ? EDITS : LOOKUPS)) {
    const last = state[kind];
    const sameTurn = sameTurnAs(last);
    if (!sameTurn || Date.now() - last.at < WINDOW_MS) {
      if (!sameTurn) fs.writeFileSync(file, JSON.stringify({ ...state, [kind]: { turn, at: Date.now() } }));
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: (kind === "build" ? BUILD : LOOKUP)(count) },
      }));
      process.exit(0);
    }
  }

  // Requests: a note, never a denial
  if (all.length >= REQUESTS && !sameTurnAs(state.requests)) {
    fs.writeFileSync(file, JSON.stringify({ ...state, requests: { turn, at: Date.now() } }));
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: REQUEST(all.length) },
    }));
  }
} catch {
  // Fail open
}
process.exit(0);
