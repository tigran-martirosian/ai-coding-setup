#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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
//      One error earlier (the last two results the same error, the call about to run that same retry) the call passes with a
//      note: find what both tries took for granted, else call the stuck-advisor agent. The note and the refusal name the
//      advisor while its calls last (ADVISOR_CALLS a session, counted from the agent-run log's stuck-advisor lines for this
//      session_id; AGENT_RUN_LOG_FILE moves that file), then fall back to asking the user in a form. In a subagent, which
//      has no Agent tool, they say to report BLOCKED instead: the session decides.
//   2. Same-file reminder (never refuses): the 6th edit of one file in a turn, or the 4th read of one
//      file, goes through with a short reminder as additional context. Exactly at that count only.
//   3. Same call (never refuses, from the retired loop-warn hook): the 5th identical call (same tool, same input)
//      among the turn's last 20 calls goes through (a call with a file_path has the counts in 2 instead) with a note to stop repeating it. Exactly at that count only.
//   4. Near the turn limit (never refuses): a helper isn't told its turn count, and one cut at its cap stops mid-work
//      with no report. From the count in NEAR_CAP on (about 90% of the agent's cap), every call carries a note to
//      finish and report. Reviewers read every changed file whole, so their count no longer depends on the brief.
// Thresholds: REPEAT_GUARD_ERRORS (3), REPEAT_GUARD_EDITS (6), REPEAT_GUARD_READS (4), REPEAT_GUARD_SAME (5).
// In a subagent (agent_id set) the hook still gets the main session's transcript_path; it reads the
// subagent's own transcript instead (transcript_path when that is already agent-*.jsonl, else
// <session file without .jsonl>/subagents/agent-<agent_id>.jsonl). Every line there is
// isSidechain, so sidechain lines count in that file; the turn starts at the subagent's brief.
// Fails open: any problem lets the call through silently. REPEAT_GUARD=off disables it.
import { emit, runHook } from "./lib/hook-io.mjs";
import {
  agentType,
  backEntries,
  subagentPath,
  typedByUser,
} from "./lib/transcript.mjs";

const ERRORS = Number(process.env.REPEAT_GUARD_ERRORS) || 3;
const EDITS = Number(process.env.REPEAT_GUARD_EDITS) || 6;
const READS = Number(process.env.REPEAT_GUARD_READS) || 4;
const SAME = Number(process.env.REPEAT_GUARD_SAME) || 5;
const SAME_WINDOW = 20; // the last calls of the turn that same-call counting looks at
const EDIT_TOOLS = ["Edit", "Write"];
const NEAR_CAP = {
  worker: 70,
  "worker-full": 70,
  "worker-code": 70,
  "worker-refactor": 70,
  reviewer: 54,
  "plan-reviewer": 36,
  planner: 36,
  "stuck-advisor": 18,
  "blind-reviewer": 27,
}; // caps 80, 80, 80, 80, 60, 40, 40, 20, 30 in agents/
const ADVISOR_CALLS = 3; // stuck-advisor calls a session (agents/stuck-advisor.md)
const RUN_LOG =
  process.env.AGENT_RUN_LOG_FILE ||
  path.join(os.homedir(), ".claude", "state", "agent-runs.jsonl");

const parts = (c) => (Array.isArray(c) ? c : []);
const textOf = (c) =>
  typeof c === "string"
    ? c
    : parts(c)
        .map((p) => p.text ?? "")
        .join(" ");
const targetOf = (input) =>
  input?.file_path ??
  String(input?.command ?? JSON.stringify(input ?? {})).slice(0, 80);

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

// Turns since the brief: one reply can make several calls, so each reply counts once
function nearCap(transcript, entries) {
  const turns = new Set(
    entries
      .filter(
        (j) =>
          j.type === "assistant" &&
          parts(j.message?.content).some((p) => p.type === "tool_use"),
      )
      .map((j) => j.message?.id),
  ).size;
  if (turns < Math.min(...Object.values(NEAR_CAP))) return "";
  const type = agentType(transcript);
  const limit = NEAR_CAP[type];
  if (!limit || turns < limit) return "";
  return `[repeat-guard] You have used ${turns} turns and are close to your limit. Finish the edit in hand, then stop and write your report: what is done, what is left and why. A helper cut at its limit returns nothing.`;
}

// stuck-advisor calls left in this session: the agent-run log has one line per helper launch, with its session and type
function advisorCallsLeft(session) {
  if (!session || !fs.existsSync(RUN_LOG)) return ADVISOR_CALLS;
  const used = fs
    .readFileSync(RUN_LOG, "utf8")
    .split("\n")
    .filter((l) => {
      try {
        const r = JSON.parse(l);
        return (
          r.session === session && r.type === "stuck-advisor" && r.description
        );
      } catch {
        return false;
      }
    }).length;
  return Math.max(0, ADVISOR_CALLS - used);
}

// The way out once retrying is ruled out: the advisor while calls last, then the user; a subagent reports BLOCKED
function wayOut(event) {
  if (event.agent_id)
    return "If no other approach is left, stop and end your report with BLOCKED and the error text: the session decides.";
  const left = advisorCallsLeft(event.session_id);
  if (!left)
    return "If no other approach is left, ask the user in a form with options and include the error text (the stuck-advisor's calls for this session are used).";
  return (
    `If no other approach is left, call the stuck-advisor agent (${left} of ${ADVISOR_CALLS} calls left this session) with a brief of at most 300 words: ` +
    "the goal, each try and why it failed, the exact error, up to 5 files with lines, the one question. Else ask the user in a form with options and include the error text."
  );
}

runHook("repeat-guard", (event) => {
  let transcript = String(event.transcript_path ?? "");
  if (event.agent_id && transcript)
    transcript = subagentPath(transcript, event.agent_id);
  if (!transcript || !fs.existsSync(transcript)) return;

  // The entries after the user's last typed message
  const entries = readTurn(transcript, !!event.agent_id);

  const uses = new Map(); // tool_use id -> { name, target }
  const calls = []; // { name, file, key }
  const results = []; // { name, error, text }
  for (const j of entries) {
    for (const p of parts(j.message?.content)) {
      if (j.type === "assistant" && p.type === "tool_use") {
        uses.set(p.id, { name: p.name, target: targetOf(p.input) });
        calls.push({
          name: p.name,
          file: p.input?.file_path,
          key: p.name + JSON.stringify(p.input ?? {}),
        });
      } else if (j.type === "user" && p.type === "tool_result") {
        const u = uses.get(p.tool_use_id);
        results.push({
          name: u?.name,
          target: u?.target,
          error: p.is_error === true,
          text: textOf(p.content).slice(0, 80),
        });
      }
    }
  }

  // The last k results are all the same error from one tool and target, and the call about to run is that same retry
  const sameError = (k) => {
    const last = results.slice(-k);
    return last.length === k &&
      last.every(
        (r) =>
          r.error &&
          r.name &&
          r.name === last[0].name &&
          r.text === last[0].text &&
          r.target === last[0].target,
      ) &&
      event.tool_name === last[0].name &&
      targetOf(event.tool_input) === last[0].target
      ? last[0]
      : null;
  };
  const third = sameError(ERRORS);
  if (third) {
    emit.deny(
      `repeat-guard: the same error came back ${ERRORS} times from ${third.name}: "${third.text}". Do not retry it. ` +
        `If the error says the file changed, read the file again; otherwise take a different approach. ` +
        wayOut(event),
    );
    return;
  }

  const name = event.tool_name;
  const file = event.tool_input?.file_path;
  let reminder = "";
  const second = ERRORS > 2 ? sameError(ERRORS - 1) : null;
  const stuck =
    second &&
    `[repeat-guard] The same error came back ${ERRORS - 1} times from ${second.name}: "${second.text}". ` +
      `Before you try again, find what both tries took for granted; the next identical error is refused. ` +
      wayOut(event);
  if (file && EDIT_TOOLS.includes(name)) {
    const before = calls.filter(
      (c) => EDIT_TOOLS.includes(c.name) && c.file === file,
    ).length;
    if (before + 1 === EDITS)
      reminder = `[repeat-guard] This is the ${EDITS}th edit of this file in this turn. Plan the remaining changes to it and make them in one edit.`;
  } else if (file && name === "Read") {
    const before = calls.filter(
      (c) => c.name === "Read" && c.file === file,
    ).length;
    if (before + 1 === READS)
      reminder = `[repeat-guard] This file has been read ${before} times in this turn. Its content is already in the conversation: work from that copy.`;
  }
  const key = name + JSON.stringify(event.tool_input ?? {});
  const same =
    calls.slice(-(SAME_WINDOW - 1)).filter((c) => c.key === key).length + 1;
  if (!file && same === SAME)
    reminder = `[repeat-guard] This is the ${SAME}th identical ${name} call (same input) in the last ${SAME_WINDOW} calls of this turn. It will give the same result: read the last output closely, change the approach, or, when waiting for something, use one longer wait.`;
  const near = event.agent_id ? nearCap(transcript, entries) : "";
  reminder = [stuck, reminder, near].filter(Boolean).join(" ");
  if (reminder) emit.context("PreToolUse", reminder);
});
