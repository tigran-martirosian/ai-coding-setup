#!/usr/bin/env node
import { writeSync } from "node:fs";
// budget-gate: a PreToolUse hook on Agent/Task. A worker, worker-full, worker-code or worker-refactor brief whose stated budget is over 50 tool calls
// is refused: a worker stops at 80 turns, and steps run over their estimate when they read code nobody summarised
// (a step briefed at 70 calls used 115, built nothing on the first run, and refused the next step it was handed).
// Over 50 = split the step in two. A brief with no number passes.
// A planner call gets a one-line notice for the user instead: a plan takes minutes and nothing shows until it
// reports, so a long one looked stuck.
// It fails open on any error. BUDGET_GATE=off disables it.
import { emit, isMain, runHook } from "./lib/hook-io.mjs";

export const MAX = 50;
const WORKER_TYPES = new Set([
  "worker",
  "worker-full",
  "worker-code",
  "worker-refactor",
]);

// "Budget: 55", "**Budget (tool calls):** about 70", "budget of 40-60" (the higher end counts); not "150k" (context)
const BUDGET =
  /budget(?:\s*\([^)]{0,20}\))?\W{0,4}(?:about\s+|around\s+|of\s+|~\s*|up to\s+)?(\d{1,4})(?:\s*(?:-|–|to)\s*(\d{1,4}))?(?![\dk])/gi;

/** The budget a brief states, or null. A line that starts with "Budget" wins over one mentioned in passing
 *  (a pasted report: "S6 used 115 calls on a budget of 70"); among several, the last counts. */
export function statedBudget(prompt) {
  const all = [...String(prompt || "").matchAll(BUDGET)].map((m) => {
    const before = m.input.slice(
      m.input.lastIndexOf("\n", m.index) + 1,
      m.index,
    );
    return {
      n: Math.max(Number(m[1]), Number(m[2] || 0)),
      ownLine: /^[\s*#>-]*$/.test(before),
    };
  });
  const pick = all.filter((b) => b.ownLine).pop() || all.pop();
  return pick ? pick.n : null;
}

export function decide(event) {
  if (!["Agent", "Task"].includes(event.tool_name)) return null;
  const input = event.tool_input || {};
  const type = String(input.subagent_type || "").toLowerCase();
  if (!WORKER_TYPES.has(type)) return null;
  const budget = statedBudget(input.prompt);
  if (budget === null || budget <= MAX) return null;
  return `[budget-gate] This ${type} brief states a budget of ${budget} tool calls; the most is ${MAX}. A worker stops at 80 turns, and reading code nobody summarised runs a step over its estimate (a 70-call step took 115). Split it into two steps (for example the server side and the screen), each with its own brief and budget of ${MAX} or less. Tell the user in your reply: BUDGET_GATE=off turns this check off. Don't switch it off yourself.`;
}

/** The notice shown to the user when a planner starts, or null. */
export function plannerNotice(event) {
  if (!["Agent", "Task"].includes(event.tool_name)) return null;
  if (String(event.tool_input?.subagent_type || "").toLowerCase() !== "planner")
    return null;
  return "Planner started: a plan usually takes 5 to 30 minutes, and nothing shows here until it reports. Still running means still working; a message you send now waits until it is done.";
}

if (isMain(import.meta.url)) {
  runHook("budget-gate", (event) => {
    const notice = plannerNotice(event);
    if (notice) writeSync(1, JSON.stringify({ systemMessage: notice }));
    const reason = decide(event);
    if (reason) emit.deny(reason);
  });
}
