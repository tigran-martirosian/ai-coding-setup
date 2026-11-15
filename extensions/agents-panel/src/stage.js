// Which thinking orb a running row shows (shared/orbs/orbs.js; DESIGN.md "Thinking orbs"): the orb's shape shows the
// kind of work, the meta line's words still name it. Pure, so test.mjs checks every tool.
// build.mjs inlines this file into dist/index.js, so it must not import anything.

const READING = new Set([
  "Read",
  "Grep",
  "Glob",
  "LS",
  "WebFetch",
  "WebSearch",
  "NotebookRead",
]);
const EDITING = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const HELPERS = new Set(["Agent", "Task"]);
const PLANNING = new Set(["EnterPlanMode", "ExitPlanMode", "TodoWrite"]);
// A command that runs a check: its text (the command, or its "# WHAT THIS DOES" line) names one of these
const CHECK = /\b(?:tests?|checks?|lint|verify|pytest|vitest|jest)\b/i;
// The helper's role: the run log's agent type, else a "Reviewer:" / "Planner:" prefix on its description
const REVIEW = /review/i;
const PLAN = /plan/i;
const ROLE_PREFIX = /^\s*(reviewer|planner)\s*:/i;

/** The orb state of a running row. `kind` is the app's kind word ("Sub-agent", "Command", ...), `tool` the app's last
 *  tool name ('' before the first), `role` the run log's agent type ('' when unknown), `text` the app's description.
 *  Waiting on its helpers beats the role; a reviewer's or planner's own work shows their role; then the tool. */
function stageOf({ kind, tool = "", role = "", text = "" }) {
  if (kind === "Command") return CHECK.test(text) ? "solving" : "working";
  if (HELPERS.has(tool)) return "connecting";
  const who = role || text.match(ROLE_PREFIX)?.[1] || "";
  if (REVIEW.test(who)) return "solving";
  if (PLAN.test(who) || PLANNING.has(tool)) return "shaping";
  if (READING.has(tool)) return "searching";
  if (EDITING.has(tool)) return "composing";
  if (!tool) return "breathing";
  // Bash, PowerShell and any other tool: work being done
  return "working";
}

export { stageOf };
