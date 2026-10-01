// Tests for hooks/question-other.mjs. Run: node test-question-other.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/question-other.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
const P = (fields) => ({ tool_name: "mcp__nimbalyst__PromptForUserInput", tool_input: { fields } });
const single = (extra = {}) => ({ type: "singleSelect", id: "a", label: "Which look?", options: [{ id: "x", label: "X" }, { id: "y", label: "Y" }], ...extra });

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
console.log(fail ? `${fail} failed` : `all ${cases.length + 2} passed`);
process.exit(fail ? 1 : 0);
