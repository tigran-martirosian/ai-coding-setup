// Tests for hooks/question-other.mjs. Run: node tests/test-question-other.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/question-other.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...process.env, CLAUDE_PROJECT_DIR: "", REC_CHECK: "off", ...env }, encoding: "utf8" }).stdout;
const P = (fields) => ({ tool_name: "mcp__nimbalyst__PromptForUserInput", tool_input: { fields } });
const single = (extra = {}) => ({ type: "singleSelect", id: "a", label: "Which look?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], ...extra });
const rec = (extra = {}) => ({ id: "x", label: "X (recommended)", ...extra });
const WHY = "Checked: DECISIONS.md already picks this. Other wins if: speed matters more.";
const LOOSE = "DECISIONS.md already picks this; choose Y if speed matters more.";
const ELSE = { type: "editText", id: "else", label: "Anything else?", initialText: "" };

const cases = [
  ["singleSelect without allowOther gets it added", P([single()]), "fix"],
  ["singleSelect with allowOther:false gets it added", P([single({ allowOther: false })]), "fix"],
  ["singleSelect with allowOther passes", P([single({ allowOther: true })]), false],
  ["confirm plus an editText passes", P([{ type: "confirm", id: "c", label: "Remove unused options?" }, ELSE]), false],
  ["confirm alone gets an Anything else? box (nothing to type in)", P([{ type: "confirm", id: "c", label: "Remove unused options?" }]), "fix"],
  ["multiSelect alone gets an Anything else? box (nothing to type in)", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A" }] }]), "fix"],
  ["Nimbalyst's AskUserQuestion is denied", { tool_name: "mcp__nimbalyst__AskUserQuestion", tool_input: { questions: [{ header: "h", question: "Which?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } }, true],
  ["the built-in AskUserQuestion passes", { tool_name: "AskUserQuestion", tool_input: { questions: [{ header: "h", question: "Which?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } }, false],
  ["a path in the form with no session record fails open", P([single({ allowOther: true }), { type: "editText", id: "e", label: "Full draft: docs/plan.md. Anything else?", initialText: "" }]), false],
  ["mixed: one good, one bad gets the bad one fixed", P([single({ allowOther: true }), single({ id: "b", label: "Which photo?" })]), "fix"],
  ["multiSelect/editText pass", P([{ type: "multiSelect", id: "m", label: "m", items: [] }, { type: "editText", id: "e", label: "e", initialText: "" }]), false],
  ["other tools pass", { tool_name: "Read", tool_input: { file_path: "x" } }, false],
  ["bad JSON fails open", "not json", false],
  ["no fields fails open", { tool_name: "mcp__nimbalyst__PromptForUserInput", tool_input: {} }, false],
  ["recommended option without a reason loses its mark", P([single({ allowOther: true, options: [rec(), { id: "y", label: "Y" }] })]), "fix"],
  ["recommended option with a too-short reason loses its mark", P([single({ allowOther: true, options: [rec({ description: "Fastest" }), { id: "y", label: "Y" }] })]), "fix"],
  ["recommended option with a reason passes", P([single({ allowOther: true, options: [rec({ description: WHY }), { id: "y", label: "Y" }] })]), false],
  ["two recommended options in one singleSelect: the second loses its mark", P([single({ allowOther: true, options: [rec({ description: WHY }), rec({ id: "y", description: WHY })] })]), "fix"],
  ["multiSelect badge 'recommended' without a subtitle loses the badge", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended" }] }]), "fix"],
  ["multiSelect with several recommended items and reasons passes", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended", subtitle: WHY }, { id: "b", title: "B (recommended)", subtitle: WHY }] }, ELSE]), false],
  ["recommended option with a reason in free wording loses its mark", P([single({ allowOther: true, options: [rec({ description: LOOSE }), { id: "y", label: "Y" }] })]), "fix"],
  ["'Judgment:' plus 'Other wins if:' passes", P([single({ allowOther: true, options: [rec({ description: "Judgment: fewer moving parts. Other wins if: you need it today." }), { id: "y", label: "Y" }] })]), false],
  ["'Checked:' without 'Other wins if:' loses its mark", P([single({ allowOther: true, options: [rec({ description: "Checked: DECISIONS.md already picks this one." }), { id: "y", label: "Y" }] })]), "fix"],
  ["'Other wins if:' without a basis label loses its mark", P([single({ allowOther: true, options: [rec({ description: "It is the simplest. Other wins if: speed matters more." }), { id: "y", label: "Y" }] })]), "fix"],
  ["multiSelect: one recommended item in free wording loses its mark", P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended", subtitle: WHY }, { id: "b", title: "B (recommended)", subtitle: LOOSE }] }]), "fix"],
  ["'not recommended' in a description is not a recommendation", P([single({ allowOther: true, options: [{ id: "x", label: "X", description: "not recommended" }, { id: "y", label: "Y" }] })]), false],
];
let fail = 0;
// A PromptForUserInput is never refused: "fix" = allowed with updatedInput and a note to Claude,
// "note" = sent unchanged with only the note, true = refused (AskUserQuestion only), false = no output
const hso = (o) => { try { return JSON.parse(o).hookSpecificOutput || null; } catch { return null; } };
const check = (out, want) => {
  const h = hso(out);
  if (want === "fix") return h?.permissionDecision === "allow" && !!h.updatedInput && /^question-other: \S/.test(h.additionalContext || "");
  if (want === "note") return !!h && !h.permissionDecision && !h.updatedInput && /^question-other: .*went out as is/.test(h.additionalContext || "");
  return want ? h?.permissionDecision === "deny" : out === "";
};
for (const [name, input, deny] of cases) {
  const out = run(input);
  const ok = check(out, deny);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const off = run(P([single()]), { QUESTION_OTHER: "off" }) === "";
if (!off) fail++;
console.log(`${off ? "PASS" : "FAIL"} QUESTION_OTHER=off disables it`);
// A refused form stays on screen in Nimbalyst beside the resent one, so a missing typing box is added, never refused
const fixedOf = (o) => JSON.parse(o).hookSpecificOutput.updatedInput.fields;
const one = fixedOf(run(P([single({ label: "Which photo?" })])));
const named = one.length === 1 && one[0].allowOther === true && one[0].label === "Which photo?";
if (!named) fail++;
console.log(`${named ? "PASS" : "FAIL"} a singleSelect gets allowOther: true and nothing else is added`);
const nim = run({ tool_name: "mcp__nimbalyst__AskUserQuestion", tool_input: { questions: [] } });
const nimOk = nim.includes("mcp__nimbalyst__PromptForUserInput") && nim.includes("allowOther: true") && !nim.includes("call PromptForUserInput again");
if (!nimOk) fail++;
console.log(`${nimOk ? "PASS" : "FAIL"} Nimbalyst AskUserQuestion deny names PromptForUserInput with allowOther`);
const typ = fixedOf(run(P([{ type: "confirm", id: "c", label: "Keep it?" }])));
const typOk = typ.length === 2 && typ[0].type === "confirm" && typ[1].type === "editText" && typ[1].label === "Anything else?" && typ[1].minLength === 0;
if (!typOk) fail++;
console.log(`${typOk ? "PASS" : "FAIL"} a form with nothing to type in gets an optional "Anything else?" editText`);
const both = hso(run(P([single({ label: "Which engine?", options: [rec(), { id: "y", label: "Y" }] })])));
const bothOk = both?.permissionDecision === "allow" && both.updatedInput.fields[0].allowOther === true && both.updatedInput.fields[0].options[0].label === "X" &&
  both.additionalContext.includes("allowOther") && both.additionalContext.includes('removed the "(recommended)" mark from "X"');
if (!bothOk) fail++;
console.log(`${bothOk ? "PASS" : "FAIL"} a form with two faults gets both fixed and both named in the note`);
const two = hso(run(P([single({ allowOther: true, options: [rec({ description: WHY }), rec({ id: "y", label: "Y (recommended)", description: WHY })] })])));
const twoOk = two?.updatedInput.fields[0].options[0].label === "X (recommended)" && two.updatedInput.fields[0].options[1].label === "Y" && two.additionalContext.includes("one option at most");
if (!twoOk) fail++;
console.log(`${twoOk ? "PASS" : "FAIL"} two recommended options: the first keeps the mark, the second loses it`);
const badge = hso(run(P([{ type: "multiSelect", id: "m", label: "m", items: [{ id: "a", title: "A", badge: "recommended" }] }, ELSE])));
const badgeOk = badge?.updatedInput.fields[0].items[0].badge === undefined && badge.updatedInput.fields[0].items[0].title === "A";
if (!badgeOk) fail++;
console.log(`${badgeOk ? "PASS" : "FAIL"} an unexplained "recommended" badge is removed`);
const clash = fixedOf(run(P([{ type: "confirm", id: "anythingElse", label: "Keep it?" }])));
const clashOk = clash[1].id !== "anythingElse";
if (!clashOk) fail++;
console.log(`${clashOk ? "PASS" : "FAIL"} the added box takes an id no field has`);
const why = run(P([single({ allowOther: true, label: "Which engine?", options: [rec(), { id: "y", label: "Y" }] })]));
const asksReason = why.includes("Which engine?") && why.includes("was missing");
if (!asksReason) fail++;
console.log(`${asksReason ? "PASS" : "FAIL"} the note names the question and says the reason was missing`);
const shape = run(P([single({ allowOther: true, label: "Which engine?", options: [rec({ description: LOOSE }), { id: "y", label: "Y" }] })]));
const asksShape = shape.includes("Which engine?") && shape.includes("Other wins if:") && !shape.includes("without a reason");
if (!asksShape) fail++;
console.log(`${asksShape ? "PASS" : "FAIL"} the note for a loose reason names the question and the shape`);

// "Checked:" against a session record
// The full temp path: on GitHub Windows it is a short RUNNER~1 path, and a path with a ~ in it is not read as a file
const dir = mkdtempSync(join(realpathSync.native(tmpdir()), "question-other-"));
const user = (text) => ({ type: "user", message: { role: "user", content: text } });
const call = (name, input) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name, input }] } });
const result = () => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", content: "ok" }] } });
const form = (description) => P([single({ allowOther: true, label: "Which engine?", options: [rec({ description }), { id: "y", label: "Y" }] })]);
const withRecord = (entries, description) => {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return run({ ...form(description), transcript_path: file });
};
const readDecisions = [call("Read", { file_path: "C:\\Projects\\x\\DECISIONS.md" }), result()];
const JUDGED = "Judgment: fewer moving parts. Other wins if: you need it today.";
const recordCases = [
  ["'Checked:' with nothing looked up in the session becomes 'Judgment:'", [user("which engine?")], WHY, true],
  ["'Checked:' naming a file read earlier in the session passes", [user("hi"), ...readDecisions, user("which engine?")], WHY, false],
  ["'Checked:' naming a file never touched, no lookup this turn, becomes 'Judgment:'", [user("hi"), call("Read", { file_path: "notes.txt" }), result(), user("which engine?")], WHY, true],
  ["'Checked:' naming a file never touched becomes 'Judgment:' even with another lookup this turn", [user("which engine?"), call("Read", { file_path: "notes.txt" }), result()], WHY, true],
  ["'Checked:' naming a file that only a tool result mentions passes", [user("hi"), { type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "Grep", input: { pattern: "engine" } }] } }, { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: [{ type: "text", text: "DECISIONS.md:12: engine X" }] }] } }, user("which engine?")], WHY, false],
  ["'Checked:' naming no file but with a lookup this turn passes", [user("which engine?"), call("WebSearch", { query: "engines" }), result()], "Checked: the docs suggest this one. Other wins if: speed matters more.", false],
  ["'Checked:' naming no file, lookup only in an earlier turn, becomes 'Judgment:'", [user("hi"), call("WebSearch", { query: "engines" }), result(), user("which engine?")], "Checked: the docs suggest this one. Other wins if: speed matters more.", true],
  ["an edit this turn is not a lookup", [user("which engine?"), call("Edit", { file_path: "a.txt" }), result()], "Checked: the docs suggest this one. Other wins if: speed matters more.", true],
  ["the form's own earlier try does not count as a lookup", [user("which engine?"), call("mcp__nimbalyst__PromptForUserInput", form(WHY).tool_input)], WHY, true],
  ["'Checked:' naming CLAUDE.md passes without a tool call", [user("which engine?")], "Checked: CLAUDE.md says no git here. Other wins if: the project moves online.", false],
  ["'Judgment:' passes with nothing looked up", [user("which engine?")], JUDGED, false],
  ["a lookup inside a subagent does not count", [user("which engine?"), { ...call("WebSearch", { query: "engines" }), isSidechain: true }], "Checked: the docs suggest this one. Other wins if: speed matters more.", true],
];
for (const [name, entries, description, deny] of recordCases) {
  const out = withRecord(entries, description);
  const ok = deny ? check(out, "fix") && hso(out).updatedInput.fields[0].options[0].description.startsWith("Judgment:") && hso(out).additionalContext.includes('rewrote "Checked:" to "Judgment:"') : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// pointing the user at something to look at needs a link this turn
const text = (s) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text: s }] } });
const look = (extra = {}) => ({ ...P([]), tool_input: { title: "Look through the wood page first", fields: [single({ allowOther: true, label: "Is it right?" }), ELSE], ...extra } });
const plain = (extra = {}) => ({ ...P([]), tool_input: { fields: [single({ allowOther: true, label: "Which engine?" }), ELSE], ...extra } });
const withTurn = (entries, input) => {
  const file = join(dir, `${Math.random().toString(36).slice(2)}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  return run({ ...input, transcript_path: file });
};
const H = homedir().replace(/\\/g, "/"), HL = (/^[A-Za-z]:/.test(H) ? "/" : "") + H.replace(/ /g, "%20");
const LINKED = "Built the wood page: [wood.html](/C:/Projects/my-project/docs/wood.html). I think it reads well; I'd keep it.";
const linkCases = [
  ["'Look through the page' with no link anywhere goes out with a note", [user("make the wood page"), text("_Done: the wood page is built._")], look(), "note"],
  ["'Look through the page' after a /C:/ link in the reply passes", [user("make the wood page"), text(LINKED)], look(), false],
  ["a Mac /Users/ link in the reply passes", [user("make it"), text("See [wood](/Users/you/x/wood.html).")], look(), false],
  ["a protocol-relative //host link is not a local link", [user("make it"), text("See [wood](//host/x/wood.html).")], look(), "note"],
  ["a Git Bash /c/ link is not a local link", [user("make it"), text("See [wood](/c/Projects/x/wood.html).")], look(), "note"],
  ["a board call after the link still leaves it in front of the user", [user("make it"), text(LINKED), call("mcp__nimbalyst__update_session_meta", { phase: "validating" }), result()], look(), false],
  ["a C:/ link without the leading slash passes",[user("make it"), text("See [wood](C:/Projects/x/wood.html).")], look(), false],
  ["a web link in the reply passes", [user("make it"), text("Live at https://example.com/wood")], look(), false],
  ["a link followed by another tool call before the form goes out with a note", [user("make it"), text(LINKED), call("Bash", { command: "git add ." }), result(), text("Saved.")], look(), "note"],
  ["an old research URL earlier in the turn does not count", [user("make it"), text("Found https://modrinth.com/mod/x/gallery"), call("Bash", { command: "python build.py" }), result(), text("The page works.")], look(), "note"],
  ["a picture shown before more tool calls does not count", [user("make it"), call("mcp__nimbalyst__display_to_user", { items: [] }), result(), call("Edit", { file_path: "a" }), result()], look(), "note"],
  ["a link, then an earlier try of the form, still counts", [user("make it"), text(LINKED), call("mcp__nimbalyst__PromptForUserInput", look().tool_input)], look(), false],
  ["'Scroll the wood page' with no link goes out with a note", [user("make it"), text("Opened it.")], plain({ intro: "Scroll the wood page (open in your browser), then type the ones you want." }), "note"],
  ["a link only in an earlier turn goes out with a note", [user("hi"), text(LINKED), user("now ask me")], look(), "note"],
  ["a backslash link (Nimbalyst can't open it) goes out with a note", [user("make it"), text("See [wood](C:\\Projects\\x\\wood.html).")], look(), "note"],
  ["a link inside the form's intro passes", [user("make it")], look({ intro: "[wood.html](/C:/Projects/x/wood.html)" }), false],
  ["a picture shown inline this turn passes", [user("make it"), call("mcp__nimbalyst__display_to_user", { items: [] }), result()], look(), false],
  ["a link written by a subagent does not count", [user("make it"), { ...text(LINKED), isSidechain: true }], look(), "note"],
  ["a file path in the intro with no link gets a pointer added", [user("plan it")], plain({ intro: "Full draft: docs/boss-materials.md. Three choices." }), "File: `docs/boss-materials.md`"],
  ["'goes into DECISIONS.md' is not something to look at", [user("plan it")], plain({ intro: "Your answers go into DECISIONS.md." }), false],
  ["'look at the buyer' is not something to look at", [user("deals?")], plain({ intro: "A small deal panel while you look at the buyer." }), false],
  ["'make photos for you to look at' (not made yet) passes", [user("photos?")], plain({ intro: "Make AI photos as a trial for you to look at (~$1.50)?" }), false],
  ["RU: 'Откройте страницу про дерево' with no link goes out with a note", [user("make it"), text("Готово.")], plain({ intro: "Откройте эту новую страницу про дерево и отметьте нужное." }), "note"],
  ["RU: 'посмотрите на него' with no link goes out with a note", [user("make it"), text("Готово.")], plain({ intro: "Посмотрите на него и скажите, подходит ли." }), "note"],
  ["RU: 'то, что я собрал' with a link in the reply passes", [user("make it"), text(LINKED)], plain({ intro: "Проверьте то, что я собрал." }), false],
  ["RU: 'ответы попадут в DECISIONS.md' / 'из out/data.xlsx' are not something to look at", [user("plan it")], plain({ intro: "Ответы попадут в docs/plan.md. Цифры взяты из out/inventory.xlsx." }), false],
  ["RU: 'посмотрите на покупателя' is not something to look at", [user("deals?")], plain({ intro: "Небольшая панель сделки, пока вы смотрите на покупателя." }), false],
  ["a path under DECISIONS/ passes", [user("plan it")], plain({ intro: "Conflict: DECISIONS/genetics.md says field crosses only." }), false],
  ["'save it as x.png' and 'counts are from x.xlsx' pass", [user("hi")], plain({ intro: "Save the picture as shots/brawl-2.png. Counts are from out/inventory.xlsx." }), false],
  ["a draft held in the form's own editText passes", [user("hi")], plain({ title: "Quick Start: proposed new version", fields: [{ type: "editText", id: "d", label: "My draft (edit in place)", initialText: "..." }] }), false],
  ["'check the new page' with no link goes out with a note", [user("make it"), text("Done.")], plain({ intro: "Check the new landing page before I push." }), "note"],
  ["'Does this plan look right?' about a plan in the chat passes", [user("plan it"), text("Plan: 1. a 2. b")], plain({ title: "Does this plan look right?" }), false],
  ["'Open C:/Projects/x/wood.html' with no link gets a pointer added", [user("make it"), text("Done.")], plain({ intro: "Open C:/Projects/x/wood.html and tell me." }), "File: [wood.html](/C:/Projects/x/wood.html)"],
  ["a backslash path in the form with no link gets a pointer added", [user("make it"), text("Done.")], plain({ intro: "Open C:\\Projects\\x\\wood.html and tell me." }), "File: [wood.html](/C:/Projects/x/wood.html)"],
  ["a ~/ path in the form with no link gets a pointer added", [user("make it"), text("Done.")], plain({ intro: "Report: ~/.claude/report.md" }), `File: [report.md](${HL}/.claude/report.md)`],
  ["a URL in an option's reason is not the link", [user("make it"), text("Done.")], plain({ intro: "Check the new landing page first.", fields: [single({ allowOther: true, label: "Tabs?", options: [rec({ description: "Checked: https://component.gallery showed tabs. Other wins if: few items." }), { id: "y", label: "Y" }] }), ELSE] }), "fix"],
  ["a file path with only a web link in the reply gets a pointer added", [user("plan it"), text("Based on https://example.com/docs")], plain({ intro: "Full draft: docs/boss-materials.md." }), "File: `docs/boss-materials.md`"],
  ["a file path with its /C:/ link in the reply passes", [user("plan it"), text("Draft: [boss-materials.md](/C:/Projects/x/docs/boss-materials.md)")], plain({ intro: "Full draft: docs/boss-materials.md." }), false],
  ["'save it as `shot.png`' passes", [user("hi")], plain({ intro: "Save it as `shot.png`?" }), false],
  ["'Go to docs/report.html' with no link gets a pointer added", [user("make it"), text("Done.")], plain({ intro: "Go to docs/report.html and tell me." }), "File: `docs/report.html`"],
  ["a decision form naming a shop's page passes", [user("price?")], plain({ intro: "Bloomingdale's page is gone for 48 items." }), false],
  ["a file named only in an option's Checked: reason passes", [user("hi"), call("Read", { file_path: "docs/engines.md" }), result(), user("which engine?")], plain({ fields: [single({ allowOther: true, label: "Which engine?", options: [rec({ description: "Checked: docs/engines.md picks it. Other wins if: speed matters." }), { id: "y", label: "Y" }] }), ELSE] }), false],
];
// A missing link to a file is added to the intro ("file": the intro then ends with that text); a phrase
// with no file to link goes out as is with a note
const introOf = (out) => hso(out)?.updatedInput?.intro || "";
for (const [name, entries, input, deny] of linkCases) {
  const out = withTurn(entries, input);
  const ok = deny === "fix" ? check(out, "fix") && hso(out).additionalContext.includes("went out as is")
    : typeof deny === "string" && deny !== "note" ? check(out, "fix") && introOf(out).endsWith(deny) : check(out, deny);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// a file outside the session's project is presented by its path in code; inside it needs a link
const PROJ = "C:\\Projects\\my project";
const at = (extra) => ({ ...plain(extra), cwd: PROJ });
const OUT_SKILL = "~/.claude/skills/x/SKILL.md";
const outsideCases = [
  ["outside file, path in code in the reply text, passes", [user("do it"), text(`Wrote \`${OUT_SKILL}\`. I'd keep it.`)], at({ intro: `Report: ${OUT_SKILL}.` }), false],
  ["outside file, path in code in the form's intro, passes", [user("do it"), text("Done.")], at({ intro: "Report: `C:/Users/you/audits/report.md`." }), false],
  ["outside file, nothing presented gets a pointer added", [user("do it"), text("Done.")], at({ intro: `Report: ${OUT_SKILL}.` }), "File: `" + H + "/.claude/skills/x/SKILL.md`"],
  ["outside file with only a markdown link (does not open) gets a pointer added", [user("do it"), text("See [SKILL.md](/C:/Users/you/.claude/skills/x/SKILL.md).")], at({ intro: "Report: C:/Users/you/.claude/skills/x/SKILL.md." }), "File: `C:/Users/you/.claude/skills/x/SKILL.md`"],
  ["outside file, a code span of another file does not count", [user("do it"), text("Wrote `~/.claude/skills/y/OTHER.md`.")], at({ intro: `Report: ${OUT_SKILL}.` }), "File: `" + H + "/.claude/skills/x/SKILL.md`"],
  ["inside file with only a path in code gets a pointer added (needs a link)", [user("do it"), text("Wrote `docs/plan.md`.")], at({ intro: "Draft: docs/plan.md." }), "File: [plan.md](/C:/Projects/my%20project/docs/plan.md)"],
  ["inside file with a /C: link passes", [user("do it"), text("Draft: [plan.md](/C:/Projects/my%20project/docs/plan.md).")], at({ intro: "Draft: docs/plan.md." }), false],
  ["a relative file resolves against cwd and counts as inside: a link is added", [user("do it"), text("Done.")], at({ intro: "Draft: report.md." }), "File: [report.md](/C:/Projects/my%20project/report.md)"],
  ["no cwd: the old link rule applies to an absolute path", [user("do it"), text("Done.")], plain({ intro: `Report: ${OUT_SKILL}.` }), `File: [SKILL.md](${HL}/.claude/skills/x/SKILL.md)`],
];
for (const [name, entries, input, deny] of outsideCases) {
  const out = withTurn(entries, input);
  const ok = deny ? check(out, "fix") && introOf(out).endsWith(deny) : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// CLAUDE_PROJECT_DIR is the open project even when the hook's cwd moved (Bash cd) into another project
{
  const realProj = join(dir, "realproj"), other = join(dir, "otherproj");
  for (const p of [realProj, other]) { mkdirSync(p, { recursive: true }); writeFileSync(join(p, "CLAUDE.md"), "x"); }
  const f = join(realProj, "plan.md").replace(/\\/g, "/");
  const entries = [user("do it"), text(`Wrote \`${f}\`.`)];
  const input = { ...plain({ intro: `Report: ${f}.` }), cwd: other };
  const noEnv = withTurn(entries, input) === "";
  const file = join(dir, "envcase.jsonl");
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n"));
  const withEnv = run({ ...input, transcript_path: file }, { CLAUDE_PROJECT_DIR: realProj });
  const okEnv = check(withEnv, "fix") && introOf(withEnv).endsWith(`[plan.md](${f.startsWith("/") ? "" : "/"}${f.replace(/ /g, "%20")})`); // a Mac path already starts with "/"
  const badEnv = run({ ...input, transcript_path: file }, { CLAUDE_PROJECT_DIR: join(dir, "nope") }) === "";
  for (const [name, ok] of [["without CLAUDE_PROJECT_DIR the cwd's project decides: file in another project counts as outside, path in code passes", noEnv], ["CLAUDE_PROJECT_DIR wins over a moved cwd: the file is inside the project and needs a link", okEnv], ["CLAUDE_PROJECT_DIR that does not exist falls back to the cwd walk", badEnv]]) {
    if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
}
// a prompt sent by the phone bot may use Nimbalyst's AskUserQuestion: the phone can answer nothing else
const ASK_NIM = { tool_name: "mcp__nimbalyst__AskUserQuestion", tool_input: { questions: [{ header: "h", question: "Which?", options: [{ label: "A", description: "a" }, { label: "B", description: "b" }] }] } };
const PHONE_PROMPT = "fix the header (Sent from the phone. If you need to ask something, use AskUserQuestion with plain options rather than a form: only that can be answered from the phone.)";
for (const [name, entries, deny] of [
  ["AskUserQuestion in a turn sent from the phone passes", [user(PHONE_PROMPT), text("Two ways to do it.")], false],
  ["a background task's notice in a phone turn keeps it a phone turn", [user(PHONE_PROMPT), text("Started."), user("<task-notification>\n<task-id>b1</task-id>\n<status>completed</status>\n</task-notification>"), text("Two ways to do it.")], false],
  ["AskUserQuestion after a phone turn, in a typed turn, is denied", [user(PHONE_PROMPT), text("Done."), user("now ask me")], true],
]) {
  const out = withTurn(entries, ASK_NIM);
  const ok = deny ? out.includes('"deny"') : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// a recommended form needs one rec-check agent since the user's last message; a singleSelect needs 2 options
// The check runs only where ~/.claude/agents/rec-check.md exists, so these runs get a made-up home folder that holds it
const recHome = mkdtempSync(join(tmpdir(), "question-other-home-"));
mkdirSync(join(recHome, ".claude", "agents"), { recursive: true });
writeFileSync(join(recHome, ".claude", "agents", "rec-check.md"), "---\nname: rec-check\n---\n");
const noRecHome = mkdtempSync(join(tmpdir(), "question-other-home-"));
const REC_ENV = { REC_CHECK: "", HOME: recHome, USERPROFILE: recHome };
const recTurn = (entries, input = form(JUDGED)) => {
  const file = join(dir, `rec-${Math.random()}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join(String.fromCharCode(10)));
  return run({ ...input, transcript_path: file }, REC_ENV);
};
const REC = call("Agent", { subagent_type: "rec-check", prompt: "look" });
const sent = (id, name, input = {}) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] } });
const back = (id, content = "ok", error = false) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, ...(error ? { is_error: true } : {}) }] } });
const FORM_TOOL = "mcp__nimbalyst__PromptForUserInput";
for (const [name, entries, deny] of [
  ["a recommended form with no rec-check goes out with a note to call one", [user("which?")], true],
  ["a recommended form after a rec-check this turn passes", [user("which?"), REC], false],
  ["a rec-check before the user's last message doesn't count", [user("which?"), REC, user("now the other thing")], true],
  ["a background notice doesn't start a new turn for rec-check", [user("which?"), REC, user("<task-notification><status>completed</status></task-notification>")], false],
  ["another agent type doesn't count as a rec-check", [user("which?"), call("Agent", { subagent_type: "worker", prompt: "rec-check this" })], true],
  ["a form that went through used up its check", [user("which?"), REC, sent("f1", FORM_TOOL), back("f1")], true],
  ["a refused form keeps its check for the next try", [user("which?"), REC, sent("f2", FORM_TOOL), back("f2", "refused", true)], false],
  ["a new rec-check covers the next form", [user("which?"), REC, sent("f3", FORM_TOOL), back("f3"), REC], false],
  ["a rec-check that failed doesn't count", [user("which?"), sent("r1", "Agent", { subagent_type: "rec-check" }), back("r1", "failed", true)], true],
]) {
  const out = recTurn(entries);
  const ok = deny ? check(out, "note") && hso(out).additionalContext.includes('subagent_type "rec-check"') : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
{
  const file = join(dir, "rec-off.jsonl");
  writeFileSync(file, JSON.stringify(user("which?")));
  const offOk = run({ ...form("Judgment: it is the simplest way. Other wins if: speed matters more."), transcript_path: file }, { REC_CHECK: "off" }) === "";
  if (!offOk) fail++;
  console.log(`${offOk ? "PASS" : "FAIL"} REC_CHECK=off turns the rec-check off`);
  const noRec = run({ ...P([single({ allowOther: true })]), transcript_path: file }, REC_ENV) === "";
  if (!noRec) fail++;
  console.log(`${noRec ? "PASS" : "FAIL"} a form with no recommended option needs no rec-check`);
  const noAgent = run({ ...form(JUDGED), transcript_path: file }, { ...REC_ENV, HOME: noRecHome, USERPROFILE: noRecHome }) === "";
  if (!noAgent) fail++;
  console.log(`${noAgent ? "PASS" : "FAIL"} an install without the rec-check agent skips the check`);
  const one = run(P([single({ allowOther: true, options: [{ id: "x", label: "X" }] })]));
  const oneOk = check(one, "note") && one.includes("fewer than 2 options");
  if (!oneOk) fail++;
  console.log(`${oneOk ? "PASS" : "FAIL"} a one-option singleSelect goes out as is, with a note`);
}
// a rec-check is no lookup: neither the call nor what it said backs a "Checked:"
const NAMED = "Checked: nothing-real.md shows it. Other wins if: speed matters more.";
for (const [name, entries, description, deny] of [
  ["a rec-check doesn't back a Checked: naming a file nothing opened", [user("which?"), REC], NAMED, true],
  ["a rec-check doesn't back a Checked: naming nothing", [user("which?"), REC], "Checked: looked at the code. Other wins if: speed matters more.", true],
  ["a rec-check's answer naming the file doesn't back it", [user("which?"), sent("r2", "Agent", { subagent_type: "rec-check", prompt: "nothing-real.md" }), back("r2", "nothing-real.md is fine")], NAMED, true],
  ["a real lookup plus a rec-check passes", [user("which?"), call("Read", { file_path: "C:/p/nothing-real.md" }), result(), REC], NAMED, false],
]) {
  const out = recTurn(entries, form(description));
  const ok = deny ? check(out, "fix") && hso(out).updatedInput.fields[0].options[0].description.startsWith("Judgment:") : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const quietOk = withTurn([user("make it"), text(LINKED), REC, result()], look()) === "";
if (!quietOk) fail++;
console.log(`${quietOk ? "PASS" : "FAIL"} a link written before the rec-check still counts`);
// AskUserQuestion: the same check on a recommended option, also from the phone
const ASK_REC = (tool_name) => ({ tool_name, tool_input: { questions: [{ header: "h", question: "Which?", options: [{ label: "A (recommended)", description: JUDGED }, { label: "B", description: "b" }] }] } });
for (const [name, entries, input, deny] of [
  ["the built-in AskUserQuestion with a recommended option needs a rec-check", [user("which?")], ASK_REC("AskUserQuestion"), true],
  ["the built-in one passes after a rec-check", [user("which?"), REC], ASK_REC("AskUserQuestion"), false],
  ["the built-in one with no recommended option needs none", [user("which?")], { ...ASK_NIM, tool_name: "AskUserQuestion" }, false],
  ["from the phone, a recommended option needs a rec-check", [user(PHONE_PROMPT)], ASK_REC("mcp__nimbalyst__AskUserQuestion"), true],
  ["from the phone, it passes after a rec-check", [user(PHONE_PROMPT), REC], ASK_REC("mcp__nimbalyst__AskUserQuestion"), false],
]) {
  const out = recTurn(entries, input);
  const ok = deny ? out.includes('"deny"') && out.includes("rec-check") && !out.includes("PromptForUserInput again") : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
// A /C:/ link must be read with its drive, or a file inside the project counts as outside and the form
// is refused with the link right there (in the form, or in the reply before it)
{
  const { pointer, outsideProject } = await import(pathToFileURL(HOOK).href);
  const CS = "C:\\Projects\\my-project";
  const GRILL = "[next-steps.md](/C:/Projects/my-project/docs/plan/next-steps.md)";
  const pt = pointer({ intro: `Plan: ${GRILL}.` }, []);
  const readOk = pt?.text === "/C:/Projects/my-project/docs/plan/next-steps.md" && !outsideProject(pt.text, CS);
  const formOk = withTurn([user("grill me"), text("Round two.")], { ...plain({ intro: `From ${GRILL}. Questions 1 and 4 are yours.` }), cwd: CS }) === "";
  const replyOk = withTurn([user("grill me"), text(`From ${GRILL}.`), sent("g1", FORM_TOOL), back("g1", "refused", true)],
    { ...plain({ intro: "Answer from /C:/Projects/my-project/docs/plan/next-steps.md." }), cwd: CS }) === "";
  const bare = withTurn([user("grill me"), text("Round two.")], { ...plain({ intro: "Plan in docs/plan/next-steps.md (/C:/Projects/my-project/docs/plan/next-steps.md)." }), cwd: CS });
  const bareOk = check(bare, "fix") && introOf(bare).endsWith(`File: ${GRILL}`);
  for (const [name, ok] of [["a /C:/ link in the form is read with its drive (inside the project)", readOk], ["a form holding its own /C:/ link to a project file passes", formOk],
    ["a /C:/ link in the reply, after a refused try of the form, still presents the file", replyOk], ["a bare path gets a working /C:/ link added to the intro", bareOk]]) {
    if (!ok) fail++;
    console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  }
}
const missing = run({ ...form(WHY), transcript_path: join(dir, "missing.jsonl") }) === "";
if (!missing) fail++;
console.log(`${missing ? "PASS" : "FAIL"} a missing session record fails open`);
rmSync(dir, { recursive: true, force: true });
rmSync(recHome, { recursive: true, force: true });
rmSync(noRecHome, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : `all ${cases.length + recordCases.length + linkCases.length + outsideCases.length + 34} passed`);
process.exit(fail ? 1 : 0);
