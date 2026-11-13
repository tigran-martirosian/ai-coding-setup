#!/usr/bin/env node
// repeat-guard: a PreToolUse hook that stops two kinds of looping inside one turn (a turn is everything
// done since the user's last message). It reads the transcript backwards, in 2 MB chunks, until the
// user's last message is found, so a long turn with big pictures is still seen
// from its start. A background-task notification (<task-notification>, [System: background task) or other
// injected text arrives as a user message but is not a new turn: it does not reset the counts.
//   1. Repeat-error gate: when the last three tool results of the turn are all errors from the same tool
//      with the same first 80 characters of text, and the three failed calls had the same target (the
//      file_path, else the first 80 characters of the command, else of the input as JSON), the call
//      about to run is denied if it is that same tool with that same target, i.e. a retry. Any other
//      call passes. The denial is a different error, so the next retry passes.
//   2. Same-file reminder (never refuses): the 6th edit of one file in a turn, or the 4th read of one
//      file, goes through with a short reminder as additional context. Exactly at that count only.
//   3. Near the turn limit (never refuses): a helper isn't told its turn count, and one cut at its cap stops mid-work
//      with no report. From the count in NEAR_CAP on, every call carries a note to finish and report.
//      A reviewer's count grows with the job, read from its brief ("N files"): 20 + 2 per file past 10, at most 40.
// Thresholds: REPEAT_GUARD_ERRORS (3), REPEAT_GUARD_EDITS (6), REPEAT_GUARD_READS (4).
// In a subagent (agent_id set) the hook still gets the main session's transcript_path; it reads the
// subagent's own transcript instead (transcript_path when that is already agent-*.jsonl, else
// <session file without .jsonl>/subagents/agent-<agent_id>.jsonl). Every line there is
// isSidechain, so sidechain lines count in that file; the turn starts at the subagent's brief.
// Fails open: any problem lets the call through silently. REPEAT_GUARD=off disables it.
import { emit, runHook } from "./lib/hook-io.mjs";
import { backEntries, typedByUser, subagentPath, agentType } from "./lib/transcript.mjs";
import fs from "node:fs";

const ERRORS = Number(process.env.REPEAT_GUARD_ERRORS) || 3;
const EDITS = Number(process.env.REPEAT_GUARD_EDITS) || 6;
const READS = Number(process.env.REPEAT_GUARD_READS) || 4;
const EDIT_TOOLS = ["Edit", "Write"];
const NEAR_CAP = { worker: 70, "worker-full": 70, reviewer: 25, planner: 12, "rec-check": 6 }; // caps 80, 80, 45, 15, 8 in agents/; a reviewer's number is only for a brief with no file count

const parts = (c) => (Array.isArray(c) ? c : []);
const textOf = (c) => (typeof c === "string" ? c : parts(c).map((p) => p.text ?? "").join(" "));
const targetOf = (input) => input?.file_path ?? String(input?.command ?? JSON.stringify(input ?? {})).slice(0, 80);

// The entries after the user's last typed message (a task's notice is not one), in file order: the file is read
// backwards until that message is found, or to its start. In a subagent's own transcript every line counts.
function readTurn(file, sidechain) {
  const turn = [];
  for (const e of backEntries(file, { sidechain })) {
    if (typedByUser(e)) break;
    turn.push(e);
  }
  return turn.reverse();
}

// The first line of a helper's transcript is its brief. A reviewer's brief says how many files the job changed
// ("this work changed 14 code files"): the biggest such number in it, or 0 when it names none.
function briefFiles(transcript) {
  const fd = fs.openSync(transcript, "r");
  try {
    const buf = Buffer.alloc(256 * 1024);
    const first = buf.toString("utf8", 0, fs.readSync(fd, buf, 0, buf.length, 0)).split("\n")[0];
    const brief = JSON.parse(first);
    const counts = [...textOf(brief.message?.content).matchAll(/\b(\d{1,3})\s+(?:\w+\s+)?files\b/gi)].map((m) => Number(m[1]));
    return Math.max(0, ...counts);
  } catch { return 0; } finally { fs.closeSync(fd); }
}

// A reviewer's budget grows with the job: 20 turns plus 2 for each file past 10, at most 40 (its cap in agents/ is 45).
// A brief that names no file count keeps the flat NEAR_CAP number.
const reviewerBudget = (files) => files ? Math.min(40, 20 + 2 * Math.max(0, files - 10)) : NEAR_CAP.reviewer;

// Turns since the brief: one reply can make several calls, so each reply counts once
function nearCap(transcript, entries) {
  const turns = new Set(entries.filter((j) => j.type === "assistant" && parts(j.message?.content).some((p) => p.type === "tool_use")).map((j) => j.message?.id)).size;
  if (turns < Math.min(...Object.values(NEAR_CAP))) return "";
  const type = agentType(transcript);
  const limit = type === "reviewer" ? reviewerBudget(briefFiles(transcript)) : NEAR_CAP[type];
  if (!limit || turns < limit) return "";
  return `[repeat-guard] You have used ${turns} turns and are close to your limit. Finish the edit in hand, then stop and write your report: what is done, what is left and why. A helper cut at its limit returns nothing.`;
}

runHook("repeat-guard", (event) => {
  let transcript = String(event.transcript_path ?? "");
  if (event.agent_id && transcript) transcript = subagentPath(transcript, event.agent_id);
  if (!transcript || !fs.existsSync(transcript)) return;

  // The entries after the user's last typed message
  const entries = readTurn(transcript, !!event.agent_id);

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
    emit.deny(
      `repeat-guard: the same error came back ${ERRORS} times from ${last[0].name}: "${last[0].text}". Do not retry it. ` +
      `If the error says the file changed, read the file again; otherwise take a different approach. ` +
      `If no other approach is left, ask the user in a form with options and include the error text.`,
    );
    return;
  }

  const name = event.tool_name;
  const file = event.tool_input?.file_path;
  let reminder = "";
  if (file && EDIT_TOOLS.includes(name)) {
    const before = calls.filter((c) => EDIT_TOOLS.includes(c.name) && c.file === file).length;
    if (before + 1 === EDITS) reminder = `[repeat-guard] This is the ${EDITS}th edit of this file in this turn. Plan the remaining changes to it and make them in one edit.`;
  } else if (file && name === "Read") {
    const before = calls.filter((c) => c.name === "Read" && c.file === file).length;
    if (before + 1 === READS) reminder = `[repeat-guard] This file has been read ${before} times in this turn. Its content is already in the conversation; don't read it again.`;
  }
  const near = event.agent_id ? nearCap(transcript, entries) : "";
  if (near) reminder = reminder ? `${reminder} ${near}` : near;
  if (reminder) emit.context("PreToolUse", reminder);
});
