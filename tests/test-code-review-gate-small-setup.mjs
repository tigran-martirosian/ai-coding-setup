// Test: a few lines of rule text (CLAUDE.md, a skill .md) since the last review need no reviewer; a hook, settings,
// a bigger edit or a file a helper changed still do. Run: node tests/test-code-review-gate-small-setup.mjs
import { editsSinceReview, smallSetupEdits } from "../hooks/code-review-gate.mjs";

const edit = (file_path, oldN, newN) => ({ type: "tool_use", id: Math.random().toString(36), name: "Edit",
  input: { file_path, old_string: "x\n".repeat(oldN - 1) + "x", new_string: "y\n".repeat(newN - 1) + "y" } });
const turn = (...blocks) => [{ type: "assistant", timestamp: "2026-11-05T21:00:00Z", message: { content: blocks } }];
const excused = (entries, helperKeys = []) => {
  const { lines } = editsSinceReview(entries);
  return [...smallSetupEdits(lines, new Set(helperKeys))].map((k) => k.split("/").pop());
};
const P = "C:/Projects/x/";
const cases = [
  ["3-line CLAUDE.md edit", excused(turn(edit(P + "CLAUDE.md", 2, 3))), ["claude.md"]],
  ["two small rule files, 8 lines in all", excused(turn(edit(P + "CLAUDE.md", 2, 3), edit(P + ".claude/skills/deploy/SKILL.md", 5, 5))).sort(), ["claude.md", "skill.md"]],
  ["12 lines of rules in all", excused(turn(edit(P + "CLAUDE.md", 6, 6), edit(P + ".claude/skills/deploy/SKILL.md", 6, 6))), []],
  ["2-line hook edit", excused(turn(edit(P + ".claude/hooks/gate.mjs", 2, 2))), []],
  ["settings edit", excused(turn(edit(P + ".claude/settings.json", 1, 1))), []],
  ["1-line replace_all in CLAUDE.md", excused(turn({ ...edit(P + "CLAUDE.md", 1, 1), input: { ...edit(P + "CLAUDE.md", 1, 1).input, replace_all: true } })), []],
  ["1-line agent .md edit", excused(turn(edit(P + ".claude/agents/worker.md", 1, 1))), []],
  ["1-line skill frontmatter edit", excused(turn({ type: "tool_use", id: "fm", name: "Edit", input: { file_path: P + ".claude/skills/a/SKILL.md", old_string: "allowed-tools: Read", new_string: "allowed-tools: Read, Bash" } })), []],
  ["rule file a helper also changed", excused(turn(edit(P + "CLAUDE.md", 1, 1)), [process.platform === "win32" ? (P + "CLAUDE.md").toLowerCase() : P + "CLAUDE.md"]), []],
];
let failed = 0;
for (const [name, got, want] of cases) {
  const ok = JSON.stringify(got.map((s) => s.toLowerCase())) === JSON.stringify(want);
  if (!ok) failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}: excused ${JSON.stringify(got)}`);
}
process.exit(failed ? 1 : 0);
