// Tests for hooks/repeat-guard.mjs. Run: node tests/test-repeat-guard.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/repeat-guard.mjs", import.meta.url));
const DIR = mkdtempSync(join(tmpdir(), "repeat-guard-"));
const BASE = { REPEAT_GUARD: "", REPEAT_GUARD_ERRORS: "", REPEAT_GUARD_EDITS: "", REPEAT_GUARD_READS: "" };

// Transcript builders
let n = 0;
const user = (text) => ({ type: "user", message: { role: "user", content: text } });
const meta = (text) => ({ type: "user", isMeta: true, message: { role: "user", content: text } });
const use = (name, input = {}) => { const id = `t${++n}`; return [{ type: "assistant", message: { content: [{ type: "tool_use", id, name, input }] } }, id]; };
const result = (id, text, isError) => ({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: id, is_error: isError, content: text }] } });
const failed = (name, text, input = { file_path: F }) => { const [a, id] = use(name, input); return [a, result(id, text, true)]; };
const F = "/p/a.txt";
const touched = (name, file) => { const [a, id] = use(name, { file_path: file }); return [a, result(id, "ok", false)]; };
const many = (k, name, file) => Array.from({ length: k }, () => touched(name, file)).flat();

let fileNo = 0;
const transcript = (entries) => {
  const p = join(DIR, `t${++fileNo}.jsonl`);
  writeFileSync(p, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return p;
};
const run = (entries, tool, input, env = {}) => {
  const transcript_path = entries === null ? join(DIR, "missing.jsonl") : transcript(entries);
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ transcript_path, tool_name: tool, tool_input: input }),
    env: { ...process.env, ...BASE, ...env }, encoding: "utf8",
  }).stdout;
};

const ERR = "File has been modified since read, either by the user or by a linter.";
const EDIT = ["Edit", { file_path: F }];
const BASH = ["Bash", { command: "ls" }];
const MISSING = "File does not exist.";
const missing = (i) => failed("Read", MISSING, { file_path: `/p/missing${i}.txt` });
const cases = [
  ["three reads of different missing files, then Bash: passes", () => run([user("go"), ...missing(1), ...missing(2), ...missing(3)], ...BASH), false],
  ["three reads of different missing files, then a Read of another file: passes", () => run([user("go"), ...missing(1), ...missing(2), ...missing(3)], "Read", { file_path: "/p/other.txt" }), false],
  ["three failed edits of one file, then a Read of that file: passes", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR)], "Read", { file_path: F }), false],
  ["three failed edits of one file, then an edit of another file: passes", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR)], "Edit", { file_path: "/p/b.txt" }), false],
  ["three failed edits of one file, then a Bash command: passes", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...BASH), false],
  ["three failed edits of one file, then a 4th edit of it: denied", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...EDIT), "deny"],
  ["three times the same failing Bash command, then the same command: denied", () => run([user("go"), ...[1, 2, 3].flatMap(() => failed("Bash", "boom", { command: "ls" }))], ...BASH), "deny"],
  ["three times the same failing Bash command, then a different command: passes", () => run([user("go"), ...[1, 2, 3].flatMap(() => failed("Bash", "boom", { command: "ls" }))], "Bash", { command: "pwd" }), false],
  ["three failed edits of different files with the same error, then an edit of the first: passes", () => run([user("go"), ...failed("Edit", ERR, { file_path: "/p/1" }), ...failed("Edit", ERR, { file_path: "/p/2" }), ...failed("Edit", ERR, { file_path: "/p/3" })], "Edit", { file_path: "/p/1" }), false],
  ["three identical errors from one tool: denied", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...EDIT), "permissionDecision\":\"deny"],
  ["the denial message names the error", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...EDIT), "File has been modified"],
  ["two identical errors: passes", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...EDIT), false],
  ["three errors with different text: passes", () => run([user("go"), ...failed("Edit", "one"), ...failed("Edit", "two"), ...failed("Edit", "three")], ...EDIT), false],
  ["three identical errors from different tools: passes", () => run([user("go"), ...failed("Edit", ERR), ...failed("Write", ERR), ...failed("Read", ERR)], ...EDIT), false],
  ["a success among the last three: passes", () => run([user("go"), ...failed("Edit", ERR), ...touched("Edit", F), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...EDIT), false],
  ["errors differing only after 80 characters: denied", () => run([user("go"), ...["a", "b", "c"].flatMap((s) => failed("Edit", "x".repeat(80) + s))], ...EDIT), "deny"],
  ["three identical errors before the last user message, none after: passes", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR), user("next")], ...EDIT), false],
  ["a meta user line does not start a new turn: denied", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), meta("note"), ...failed("Edit", ERR)], ...EDIT), "deny"],
  ["errors are counted with is_error only: three identical non-errors pass", () => run([user("go"), ...Array.from({ length: 3 }, () => { const [a, id] = use("Edit"); return [a, result(id, ERR, false)]; }).flat()], ...EDIT), false],
  ["5th edit of one file: passes with no output", () => run([user("go"), ...many(4, "Edit", F)], "Edit", { file_path: F }), false],
  ["6th edit of one file: reminder", () => run([user("go"), ...many(5, "Edit", F)], "Edit", { file_path: F }), "in one edit"],
  ["6th edit counts Write and MultiEdit too: reminder", () => run([user("go"), ...many(2, "Edit", F), ...many(2, "Write", F), ...many(1, "MultiEdit", F)], "Write", { file_path: F }), "additionalContext"],
  ["the reminder does not refuse", () => run([user("go"), ...many(5, "Edit", F)], "Edit", { file_path: F }), (o) => !o.includes("deny")],
  ["7th edit: no output", () => run([user("go"), ...many(6, "Edit", F)], "Edit", { file_path: F }), false],
  ["edits spread over different files: no output", () => run([user("go"), ...[1, 2, 3, 4, 5, 6].flatMap((i) => touched("Edit", `/p/f${i}.txt`))], "Edit", { file_path: "/p/f7.txt" }), false],
  ["edits before the last user message do not count", () => run([user("go"), ...many(5, "Edit", F), user("next")], "Edit", { file_path: F }), false],
  ["3 reads: no output", () => run([user("go"), ...many(2, "Read", F)], "Read", { file_path: F }), false],
  ["4th read of one file: reminder", () => run([user("go"), ...many(3, "Read", F)], "Read", { file_path: F }), "already in the conversation"],
  ["5th read: no output", () => run([user("go"), ...many(4, "Read", F)], "Read", { file_path: F }), false],
  ["reads do not count as edits", () => run([user("go"), ...many(5, "Read", F)], "Edit", { file_path: F }), false],
  ["REPEAT_GUARD=off: no output", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...EDIT, { REPEAT_GUARD: "off" }), false],
  ["missing transcript: no output", () => run(null, ...EDIT), false],
  ["bad JSON on stdin: no output", () => spawnSync(process.execPath, [HOOK], { input: "not json", env: { ...process.env, ...BASE }, encoding: "utf8" }).stdout, false],
  ["unreadable line in the transcript is skipped", () => {
    const p = join(DIR, "bad.jsonl");
    writeFileSync(p, [JSON.stringify(user("go")), "{broken", ...[1, 2, 3].flatMap(() => failed("Edit", ERR)).map((e) => JSON.stringify(e))].join("\n"));
    return spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ transcript_path: p, tool_name: "Edit", tool_input: { file_path: F } }), env: { ...process.env, ...BASE }, encoding: "utf8" }).stdout;
  }, "deny"],
  ["REPEAT_GUARD_ERRORS=2: two errors denied", () => run([user("go"), ...failed("Edit", ERR), ...failed("Edit", ERR)], ...EDIT, { REPEAT_GUARD_ERRORS: "2" }), "deny"],
  ["REPEAT_GUARD_EDITS=3: 3rd edit reminded", () => run([user("go"), ...many(2, "Edit", F)], "Edit", { file_path: F }, { REPEAT_GUARD_EDITS: "3" }), "additionalContext"],
  ["REPEAT_GUARD_READS=2: 2nd read reminded", () => run([user("go"), ...many(1, "Read", F)], "Read", { file_path: F }, { REPEAT_GUARD_READS: "2" }), "additionalContext"],
  ["only the tail is read: a huge transcript still works", () => {
    const filler = { type: "assistant", message: { content: [{ type: "text", text: "y".repeat(2000) }] } };
    return run([user("go"), ...Array.from({ length: 500 }, () => filler), ...many(5, "Edit", F)], "Edit", { file_path: F });
  }, "additionalContext"],
];

let failures = 0;
for (const [name, go, expect] of cases) {
  const out = go();
  const ok = expect === false ? !out : typeof expect === "function" ? expect(out) : out.includes(expect);
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n      got: ${out || "(no output)"}`}`);
}
rmSync(DIR, { recursive: true, force: true });
console.log(`\n${cases.length - failures}/${cases.length} passed`);
process.exit(failures ? 1 : 0);
