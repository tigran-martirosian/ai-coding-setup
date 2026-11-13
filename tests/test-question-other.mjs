// Tests for hooks/question-other.mjs. Run: node tests/test-question-other.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/question-other.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
const P = (fields) => ({ tool_name: "mcp__nimbalyst__PromptForUserInput", tool_input: { fields } });
const single = (extra = {}) => ({ type: "singleSelect", id: "a", label: "Which look?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], ...extra });
const rec = (extra = {}) => ({ id: "x", label: "X (recommended)", ...extra });
const WHY = "Checked: DECISIONS.md already picks this. Other wins if: speed matters more.";
const LOOSE = "DECISIONS.md already picks this; choose Y if speed matters more.";

const cases = [
  ["singleSelect without allowOther is denied", P([single()]), true],
  ["singleSelect with allowOther:false is denied", P([single({ allowOther: false })]), true],
  ["singleSelect with allowOther passes", P([single({ allowOther: true })]), false],
  ["confirm alone passes", P([{ type: "confirm", id: "c", label: "Remove unused options?" }]), false],
  ["mixed: one good, one bad is denied", P([single({ allowOther: true }), single({ id: "b", label: "Which photo?" })]), true],
  ["multiSelect/editText pass", P([{ type: "multiSelect", id: "m", label: "m", items: [] }, { type: "editText", id: "e", label: "e", initialText: "" }]), false],
  ["other tools pass", { tool_name: "Read", tool_input: { file_path: "x" } }, false],
  ["bad JSON fails open", "not json", false],
  ["no fields fails open", { tool_name: "mcp__nimbalyst__PromptForUserInput", tool_input: {} }, false],
  ["recommended option without a reason is denied", P([single({ allowOther: true, options: [rec(), { id: "y", label: "Y" }] })]), true],
  ["recommended option with a too-short reason is denied", P([single({ allowOther: true, options: [rec({ description: "Fastest" }), { id: "y", label: "Y" }] })]), true],
  ["recommended option with a reason passes", P([single({ allowOther: true, options: [rec({ description: WHY }), { id: "y", label: "Y" }] })]), false],
  ["two recommended options in one singleSelect is denied", P([single({ allowOther: true, options: [rec({ description: WHY }), rec({ id: "y", description: WHY })] })]), true],
  ["multiSelect badge 'recommended' without a subtitle is denied", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended" }] }]), true],
  ["multiSelect with several recommended items and reasons passes", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended", subtitle: WHY }, { id: "b", title: "B (recommended)", subtitle: WHY }] }]), false],
  ["recommended option with a reason in free wording is denied", P([single({ allowOther: true, options: [rec({ description: LOOSE }), { id: "y", label: "Y" }] })]), true],
  ["'Judgment:' plus 'Other wins if:' passes", P([single({ allowOther: true, options: [rec({ description: "Judgment: fewer moving parts. Other wins if: you need it today." }), { id: "y", label: "Y" }] })]), false],
  ["'Checked:' without 'Other wins if:' is denied", P([single({ allowOther: true, options: [rec({ description: "Checked: DECISIONS.md already picks this one." }), { id: "y", label: "Y" }] })]), true],
  ["'Other wins if:' without a basis label is denied", P([single({ allowOther: true, options: [rec({ description: "It is the simplest. Other wins if: speed matters more." }), { id: "y", label: "Y" }] })]), true],
  ["multiSelect: one recommended item in free wording is denied", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended", subtitle: WHY }, { id: "b", title: "B (recommended)", subtitle: LOOSE }] }]), true],
  ["'not recommended' in a description is not a recommendation", P([single({ allowOther: true, options: [{ id: "x", label: "X", description: "not recommended" }, { id: "y", label: "Y" }] })]), false],
];
let fail = 0;
for (const [name, input, deny] of cases) {
  const out = run(input);
  const ok = deny ? out.includes('"deny"') : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const off = run(P([single()]), { QUESTION_OTHER: "off" }) === "";
if (!off) fail++;
console.log(`${off ? "PASS" : "FAIL"} QUESTION_OTHER=off disables it`);
const msg = run(P([single({ label: "Which photo?" })]));
const named = msg.includes("Which photo?");
if (!named) fail++;
console.log(`${named ? "PASS" : "FAIL"} deny message names the question`);
const why = run(P([single({ allowOther: true, label: "Which engine?", options: [rec(), { id: "y", label: "Y" }] })]));
const asksReason = why.includes("Which engine?") && why.includes("without a reason");
if (!asksReason) fail++;
console.log(`${asksReason ? "PASS" : "FAIL"} deny message names the question and asks for the reason`);
const shape = run(P([single({ allowOther: true, label: "Which engine?", options: [rec({ description: LOOSE }), { id: "y", label: "Y" }] })]));
const asksShape = shape.includes("Which engine?") && shape.includes("Other wins if:") && !shape.includes("without a reason");
if (!asksShape) fail++;
console.log(`${asksShape ? "PASS" : "FAIL"} deny message for a loose reason names the question and the shape`);

// "Checked:" against a session record
const dir = mkdtempSync(join(tmpdir(), "question-other-"));
const user = (text) => ({ type: "user", message: { role: "user", content: text } });
const call = (name, input) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input }] } });
const result = () => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });
const form = (description) => P([single({ allowOther: true, label: "Which engine?", options: [rec({ description }), { id: "y", label: "Y" }] })]);
const withRecord = (entries, description) => {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return run({ ...form(description), transcript_path: file });
};
const readDecisions = [call("Read", { file_path: "C:\\work\\x\\DECISIONS.md" }), result()];
const JUDGED = "Judgment: fewer moving parts. Other wins if: you need it today.";
const recordCases = [
  ["'Checked:' with nothing looked up in the session is denied", [user("which engine?")], WHY, true],
  ["'Checked:' naming a file read earlier in the session passes", [user("hi"), ...readDecisions, user("which engine?")], WHY, false],
  ["'Checked:' naming a file never touched, no lookup this turn, is denied", [user("hi"), call("Read", { file_path: "notes.txt" }), result(), user("which engine?")], WHY, true],
  ["'Checked:' naming a file never touched is denied even with another lookup this turn", [user("which engine?"), call("Read", { file_path: "notes.txt" }), result()], WHY, true],
  ["'Checked:' naming a file that only a tool result mentions passes", [user("hi"), { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "engine" } }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "DECISIONS.md:12: engine X" }] }] } }, user("which engine?")], WHY, false],
  ["'Checked:' naming no file but with a lookup this turn passes", [user("which engine?"), call("WebSearch", { query: "engines" }), result()], "Checked: the docs suggest this one. Other wins if: speed matters more.", false],
  ["'Checked:' naming no file, lookup only in an earlier turn, is denied", [user("hi"), call("WebSearch", { query: "engines" }), result(), user("which engine?")], "Checked: the docs suggest this one. Other wins if: speed matters more.", true],
  ["an edit this turn is not a lookup", [user("which engine?"), call("Edit", { file_path: "a.txt" }), result()], "Checked: the docs suggest this one. Other wins if: speed matters more.", true],
  ["the form's own earlier try does not count as a lookup", [user("which engine?"), call("mcp__nimbalyst__PromptForUserInput", form(WHY).tool_input)], WHY, true],
  ["'Checked:' naming CLAUDE.md passes without a tool call", [user("which engine?")], "Checked: CLAUDE.md says no git here. Other wins if: the project moves online.", false],
  ["'Judgment:' passes with nothing looked up", [user("which engine?")], JUDGED, false],
  ["a lookup inside a subagent does not count", [user("which engine?"), { ...call("WebSearch", { query: "engines" }), isSidechain: true }], "Checked: the docs suggest this one. Other wins if: speed matters more.", true],
];
for (const [name, entries, description, deny] of recordCases) {
  const out = withRecord(entries, description);
  const ok = deny ? out.includes('"deny"') && out.includes("Judgment:") : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const missing = run({ ...form(WHY), transcript_path: join(dir, "missing.jsonl") }) === "";
if (!missing) fail++;
console.log(`${missing ? "PASS" : "FAIL"} a missing session record fails open`);
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : `all ${cases.length + recordCases.length + 5} passed`);
process.exit(fail ? 1 : 0);
