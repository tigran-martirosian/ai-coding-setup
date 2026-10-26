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
const ELSE = { type: "editText", id: "else", label: "Anything else?", initialText: "" };

const cases = [
  ["singleSelect without allowOther is denied", P([single()]), true],
  ["singleSelect with allowOther:false is denied", P([single({ allowOther: false })]), true],
  ["singleSelect with allowOther passes", P([single({ allowOther: true })]), false],
  ["confirm plus an editText passes", P([{ type: "confirm", id: "c", label: "Remove unused options?" }, ELSE]), false],
  ["confirm alone is denied (nothing to type in)", P([{ type: "confirm", id: "c", label: "Remove unused options?" }]), true],
  ["multiSelect alone is denied (nothing to type in)", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A" }] }]), true],
  ["Nimbalyst's AskUserQuestion is denied", { tool_name: "mcp__nimbalyst__AskUserQuestion", tool_input: { questions: [{ header: "h", question: "Which?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } }, true],
  ["the built-in AskUserQuestion passes", { tool_name: "AskUserQuestion", tool_input: { questions: [{ header: "h", question: "Which?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } }, false],
  ["a path in the form with no session record fails open", P([single({ allowOther: true }), { type: "editText", id: "e", label: "Full draft: docs/plan.md. Anything else?", initialText: "" }]), false],
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
  ["multiSelect with several recommended items and reasons passes", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended", subtitle: WHY }, { id: "b", title: "B (recommended)", subtitle: WHY }] }, ELSE]), false],
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
const named = msg.includes("Which photo?") && !msg.includes("No field in this form") && msg.includes("Anything else?");
if (!named) fail++;
console.log(`${named ? "PASS" : "FAIL"} deny message names the question (and does not also say no field takes typing)`);
const nim = run({ tool_name: "mcp__nimbalyst__AskUserQuestion", tool_input: { questions: [] } });
const nimOk = nim.includes("mcp__nimbalyst__PromptForUserInput") && nim.includes("allowOther: true") && !nim.includes("call PromptForUserInput again");
if (!nimOk) fail++;
console.log(`${nimOk ? "PASS" : "FAIL"} Nimbalyst AskUserQuestion deny names PromptForUserInput with allowOther`);
const typ = run(P([{ type: "confirm", id: "c", label: "Keep it?" }]));
const typOk = typ.includes("Anything else?") && typ.includes("allowOther: true");
if (!typOk) fail++;
console.log(`${typOk ? "PASS" : "FAIL"} no-typing deny asks for an "Anything else?" editText or allowOther`);
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
// pointing the user at something to look at needs a link this turn
const text = (s) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: s }] } });
const look = (extra = {}) => ({ ...P([]), tool_input: { title: "Look through the menu page first", fields: [single({ allowOther: true, label: "Is it right?" }), ELSE], ...extra } });
const plain = (extra = {}) => ({ ...P([]), tool_input: { fields: [single({ allowOther: true, label: "Which engine?" }), ELSE], ...extra } });
const withTurn = (entries, input) => {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return run({ ...input, transcript_path: file });
};
const LINKED = "Built the menu page: [menu.html](/C:/Projects/shop/docs/menu.html). I think it reads well; I'd keep it.";
const linkCases = [
  ["'Look through the page' with no link anywhere is denied", [user("make the menu page"), text("_Done: the menu page is built._")], look(), true],
  ["'Look through the page' after a /C:/ link in the reply passes", [user("make the menu page"), text(LINKED)], look(), false],
  ["a Mac /Users/ link in the reply passes", [user("make it"), text("See [menu](/Users/you/x/menu.html).")], look(), false],
  ["a protocol-relative //host link is not a local link", [user("make it"), text("See [menu](//host/x/menu.html).")], look(), true],
  ["a Git Bash /c/ link is not a local link", [user("make it"), text("See [menu](/c/Projects/x/menu.html).")], look(), true],
  ["a board call after the link still leaves it in front of the user", [user("make it"), text(LINKED), call("mcp__nimbalyst__update_session_meta", { phase: "validating" }), result()], look(), false],
  ["a C:/ link without the leading slash passes",[user("make it"), text("See [menu](C:/Projects/x/menu.html).")], look(), false],
  ["a web link in the reply passes", [user("make it"), text("Live at https://example.com/menu")], look(), false],
  ["a link followed by another tool call before the form is denied", [user("make it"), text(LINKED), call("Bash", { command: "git add ." }), result(), text("Saved.")], look(), true],
  ["an old research URL earlier in the turn does not count", [user("make it"), text("Found https://example.org/gallery"), call("Bash", { command: "python build.py" }), result(), text("The page works.")], look(), true],
  ["a picture shown before more tool calls does not count", [user("make it"), call("mcp__nimbalyst__display_to_user", { items: [] }), result(), call("Edit", { file_path: "a" }), result()], look(), true],
  ["a link, then an earlier try of the form, still counts", [user("make it"), text(LINKED), call("mcp__nimbalyst__PromptForUserInput", look().tool_input)], look(), false],
  ["'Scroll the menu page' with no link is denied", [user("make it"), text("Opened it.")], plain({ intro: "Scroll the menu page (open in your browser), then type the ones you want." }), true],
  ["a link only in an earlier turn is denied", [user("hi"), text(LINKED), user("now ask me")], look(), true],
  ["a backslash link (Nimbalyst can't open it) is denied", [user("make it"), text("See [menu](C:\\Projects\\x\\menu.html).")], look(), true],
  ["a link inside the form's intro passes", [user("make it")], look({ intro: "[menu.html](/C:/Projects/x/menu.html)" }), false],
  ["a picture shown inline this turn passes", [user("make it"), call("mcp__nimbalyst__display_to_user", { items: [] }), result()], look(), false],
  ["a link written by a subagent does not count", [user("make it"), { ...text(LINKED), isSidechain: true }], look(), true],
  ["a file path in the intro with no link is denied", [user("plan it")], plain({ intro: "Full draft: docs/launch-plan.md. Three choices." }), true],
  ["'goes into DECISIONS.md' is not something to look at", [user("plan it")], plain({ intro: "Your answers go into DECISIONS.md." }), false],
  ["'look at the buyer' is not something to look at", [user("deals?")], plain({ intro: "A small deal panel while you look at the buyer." }), false],
  ["'make photos for you to look at' (not made yet) passes", [user("photos?")], plain({ intro: "Make AI photos as a trial for you to look at (~$1.50)?" }), false],
  ["a path under DECISIONS/ passes", [user("plan it")], plain({ intro: "Conflict: DECISIONS/genetics.md says field crosses only." }), false],
  ["'save it as x.png' and 'counts are from x.xlsx' pass", [user("hi")], plain({ intro: "Save the picture as shots/scene-2.png. Counts are from out/inventory.xlsx." }), false],
  ["a draft held in the form's own editText passes", [user("hi")], plain({ title: "Quick Start: proposed new version", fields: [{ type: "editText", id: "d", label: "My draft (edit in place)", initialText: "..." }] }), false],
  ["'check the new page' with no link is denied", [user("make it"), text("Done.")], plain({ intro: "Check the new landing page before I push." }), true],
  ["'Does this plan look right?' about a plan in the chat passes", [user("plan it"), text("Plan: 1. a 2. b")], plain({ title: "Does this plan look right?" }), false],
  ["'Open C:/Projects/x/menu.html' with no link is denied", [user("make it"), text("Done.")], plain({ intro: "Open C:/Projects/x/menu.html and tell me." }), true],
  ["a backslash path in the form with no link is denied", [user("make it"), text("Done.")], plain({ intro: "Open C:\\Projects\\x\\menu.html and tell me." }), true],
  ["a ~/ path in the form with no link is denied", [user("make it"), text("Done.")], plain({ intro: "Report: ~/.claude/report.md" }), true],
  ["a URL in an option's reason is not the link", [user("make it"), text("Done.")], plain({ intro: "Check the new landing page first.", fields: [single({ allowOther: true, label: "Tabs?", options: [rec({ description: "Checked: https://component.gallery showed tabs. Other wins if: few items." }), { id: "y", label: "Y" }] }), ELSE] }), true],
  ["a file path with only a web link in the reply is denied", [user("plan it"), text("Based on https://example.com/docs")], plain({ intro: "Full draft: docs/launch-plan.md." }), true],
  ["a file path with its /C:/ link in the reply passes", [user("plan it"), text("Draft: [launch-plan.md](/C:/Projects/x/docs/launch-plan.md)")], plain({ intro: "Full draft: docs/launch-plan.md." }), false],
  ["'save it as `shot.png`' passes", [user("hi")], plain({ intro: "Save it as `shot.png`?" }), false],
  ["'Go to docs/report.html' with no link is denied", [user("make it"), text("Done.")], plain({ intro: "Go to docs/report.html and tell me." }), true],
  ["a decision form naming a shop's page passes", [user("price?")], plain({ intro: "The shop's page is gone for 48 items." }), false],
  ["a file named only in an option's Checked: reason passes", [user("hi"), call("Read", { file_path: "docs/engines.md" }), result(), user("which engine?")], plain({ fields: [single({ allowOther: true, label: "Which engine?", options: [rec({ description: "Checked: docs/engines.md picks it. Other wins if: speed matters." }), { id: "y", label: "Y" }] }), ELSE] }), false],
];
for (const [name, entries, input, deny] of linkCases) {
  const out = withTurn(entries, input);
  const ok = deny ? out.includes('"deny"') && out.includes("/C:/") && out.includes("Then ask") : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// a prompt sent by the phone bot may use Nimbalyst's AskUserQuestion: the phone can answer nothing else
const ASK_NIM = { tool_name: "mcp__nimbalyst__AskUserQuestion", tool_input: { questions: [{ header: "h", question: "Which?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } };
const PHONE_PROMPT = "fix the header (Sent from the phone. If you need to ask something, use AskUserQuestion with plain options rather than a form: only that can be answered from the phone.)";
for (const [name, entries, deny] of [
  ["AskUserQuestion in a turn sent from the phone passes", [user(PHONE_PROMPT), text("Two ways to do it.")], false],
  ["AskUserQuestion after a phone turn, in a typed turn, is denied", [user(PHONE_PROMPT), text("Done."), user("now ask me")], true],
]) {
  const out = withTurn(entries, ASK_NIM);
  const ok = deny ? out.includes('"deny"') : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const missing = run({ ...form(WHY), transcript_path: join(dir, "missing.jsonl") }) === "";
if (!missing) fail++;
console.log(`${missing ? "PASS" : "FAIL"} a missing session record fails open`);
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : `all ${cases.length + recordCases.length + linkCases.length + 9} passed`);
process.exit(fail ? 1 : 0);
