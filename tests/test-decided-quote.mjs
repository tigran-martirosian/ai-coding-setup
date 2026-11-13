// Test for hooks/decided-quote.mjs. Run: node test-decided-quote.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

const HOOK = fileURLToPath(new URL("../hooks/decided-quote.mjs", import.meta.url));
let n = 0;
function run(event, env = {}, raw) {
  n++;
  const input = raw ?? JSON.stringify({ session_id: `dq-test-${process.pid}-${n}`, ...event });
  const r = spawnSync(process.execPath, [HOOK], { input, encoding: "utf8", env: { ...process.env, DECIDED_QUOTE: "", ...env } });
  let out = null;
  try { out = r.stdout ? JSON.parse(r.stdout) : null; } catch {}
  return { status: r.status, denied: out?.hookSpecificOutput?.permissionDecision === "deny", out, stderr: r.stderr };
}
const spawn = (prompt) => ({ tool_name: "mcp__nimbalyst-host__spawn_session", tool_input: { prompt } });

// A made-up brief: the quote sits in another paragraph than the claim
const QUOTES = `Sam (the owner) talked the layout through earlier. Their words: "the list view should stay available ... the cards are nice but some people still want the plain table."`;
const DECIDED = `DECIDED by Sam in a form (write these into DECISIONS.md as one new entry at the top of the list, in the file's existing style):
1. Show cards by default with a switch to the plain table. This replaces the table-only layout picked last week.
2. Sorting keeps the last choice between visits.
3. Still open: the export button and where it goes.`;
const PROPOSED = `PROPOSED by the previous session, NOT yet confirmed by Sam (write into the plan under a heading "Proposed, not confirmed"):
- Layout: toolbar on top, filters in a side panel.`;
const HEAD = `CHILD JOB: write the layout plan into docs/ and DECISIONS.md (planning only, build nothing)\n\nProject: C:\\Projects\\sample-app. About 10 steps. Notes (.md) only.`;
const BRIEF = [HEAD, QUOTES, DECIDED, PROPOSED].join("\n\n");

// 1. refuses a brief whose decision claim has no quote in its own paragraph
let r = run(spawn(BRIEF));
assert.equal(r.denied, true, "brief should be refused");
assert.match(r.out.hookSpecificOutput.permissionDecisionReason, /DECIDED by Sam in a form/);
console.log("ok 1: brief with an unquoted decision refused");

// 1b. the identical retry goes through
const same = { session_id: `dq-retry-${process.pid}`, ...spawn(BRIEF) };
assert.equal(run(same).denied, true);
assert.equal(run(same).denied, false);
console.log("ok 1b: identical retry passes");

// 2. passes once each decided item has a quote
const FIXED = `DECIDED by Sam in a form "Default layout" (message 2026-10-11T04:40, parent transcript C:\\x\\parent.jsonl):
1. Their ticked option, in full: "Cards by default, with a switch to the plain table".
2. Typed with it: "some people still want the plain table".
3. Still open: the export button and where it goes.`;
r = run(spawn([HEAD, QUOTES, FIXED, PROPOSED].join("\n\n")));
assert.equal(r.denied, false, "quoted brief should pass");
console.log("ok 2: brief with quotes passes");

// 3. a brief with no decision claim (and a "not confirmed" line) passes
r = run(spawn(`${HEAD}\n\nPROPOSED by Claude, not confirmed by Sam:\n- Layout: toolbar on top.\n\nWrite docs/layout-plan.md.`));
assert.equal(r.denied, false);
r = run({ tool_name: "Agent", tool_input: { prompt: "Read the file and report the line count." } });
assert.equal(r.denied, false);
console.log("ok 3: no decision claim passes");

// 4. a brief that only mentions the words inside quotation marks passes
r = run(spawn(`CHILD JOB: add a check\n\nNew hook: if the text claims a user decision (a line with "DECIDED", "decided by" or "confirmed by") and the same block holds no quoted passage of at least three words, refuse once.`));
assert.equal(r.denied, false, "a rule that names the phrases is not a claim");
console.log("ok 4: a mention of the phrases passes");

// 5. off switch
r = run(spawn(BRIEF), { DECIDED_QUOTE: "off" });
assert.equal(r.denied, false);
assert.equal(r.status, 0);
console.log("ok 5: DECIDED_QUOTE=off passes the brief");

// 6. Write into a handoffs folder is checked, other Writes are not
r = run({ tool_name: "Write", tool_input: { file_path: "D:\\work\\.claude\\handoffs\\x.md", content: DECIDED } });
assert.equal(r.denied, true);
r = run({ tool_name: "Write", tool_input: { file_path: "C:\\Projects\\p\\DECISIONS.md", content: DECIDED } });
assert.equal(r.denied, false);
console.log("ok 6: Write into handoffs checked, elsewhere ignored");

// 7. unreadable input is an error, not a pass
r = run(null, {}, "not json {");
assert.equal(r.status, 2);
assert.match(r.stderr, /decided-quote/);
console.log("ok 7: unreadable input exits 2 with a message");

console.log("all decided-quote tests passed");
