#!/usr/bin/env node
// budget-gate: a PreToolUse hook on Agent/Task. A worker or worker-full brief whose stated budget is over 50 tool calls
// is refused: a worker stops at 80 turns, and steps run over their estimate when they read code nobody summarised
// (a step briefed at 70 calls used 115, built nothing on the first run, and refused the next step it was handed).
// Over 50 = split the step in two. A brief with no number passes.
// It fails open on any error. BUDGET_GATE=off disables it.
import { crashLog } from "./crash-log.mjs";
import { readFileSync, writeSync } from "node:fs";

export const MAX = 50;

// "Budget: 55", "**Budget (tool calls):** about 70", "budget of 40-60" (the higher end counts); not "150k" (context)
const BUDGET = /budget(?:\s*\([^)]{0,20}\))?\W{0,4}(?:about\s+|around\s+|of\s+|~\s*|up to\s+)?(\d{1,4})(?:\s*(?:-|–|to)\s*(\d{1,4}))?(?![\dk])/gi;

/** The budget a brief states, or null. A line that starts with "Budget" wins over one mentioned in passing
 *  (a pasted report: "S6 used 115 calls on a budget of 70"); among several, the last counts. */
export function statedBudget(prompt) {
  const all = [...String(prompt || "").matchAll(BUDGET)].map((m) => {
    const before = m.input.slice(m.input.lastIndexOf("\n", m.index) + 1, m.index);
    return { n: Math.max(Number(m[1]), Number(m[2] || 0)), ownLine: /^[\s*#>-]*$/.test(before) };
  });
  const pick = all.filter((b) => b.ownLine).pop() || all.pop();
  return pick ? pick.n : null;
}

export function decide(event) {
  if (!["Agent", "Task"].includes(event.tool_name)) return null;
  const input = event.tool_input || {};
  const type = String(input.subagent_type || "").toLowerCase();
  if (type !== "worker" && type !== "worker-full") return null;
  const budget = statedBudget(input.prompt);
  if (budget === null || budget <= MAX) return null;
  return `[budget-gate] This ${type} brief states a budget of ${budget} tool calls; the most is ${MAX}. A worker stops at 80 turns, and reading code nobody summarised runs a step over its estimate (a 70-call step took 115). Split it into two steps (for example the server side and the screen), each with its own brief and budget of ${MAX} or less. BUDGET_GATE=off disables this.`;
}

if (process.argv[1] && /(^|[\\/])budget-gate\.mjs$/.test(process.argv[1])) {
  try {
    if ((process.env.BUDGET_GATE || "").toLowerCase() === "off") process.exit(0);
    const reason = decide(JSON.parse(readFileSync(0, "utf8")));
    if (reason) {
      writeSync(1, JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
    }
  } catch (err) {
    crashLog("budget-gate", err);
  }
  process.exit(0);
}
