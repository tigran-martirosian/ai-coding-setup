// Tests for hooks/code-review-gate.mjs. Run: node tests/test-code-review-gate.mjs
// Each case writes a small transcript and runs the hook on it as a Stop event.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const HOOK = fileURLToPath(new URL("../hooks/code-review-gate.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "test-code-review-gate-"));

let id = 0;
const typed = (text) => ({ type: "user", uuid: `u${++id}`, message: { role: "user", content: text } });
const tool = (name, input) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: `t${++id}`, name, input }] } });
const result = (ok = true) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: `t${id}`, content: ok ? "done" : "refused", ...(ok ? {} : { is_error: true }) }] } });
const edit = (file, ok = true) => [tool("Edit", { file_path: file, old_string: "a", new_string: "b" }), result(ok)];
const write = (file) => [tool("Write", { file_path: file, content: "x" }), result()];
const review = (skill = "code-review") => [tool("Skill", { skill, args: "high" }), result()];
const say = (text) => ({ type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } });
const THREE = [...edit("C:/p/a.js"), ...edit("C:/p/b.py"), ...edit("C:/p/c.ts")];

let n = 0;
// Each run is its own session unless one is named; the once-per-turn files go into the test folder
const run = (entries, { input = {}, env = {}, session } = {}) => {
  const file = join(dir, `t${++n}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const event = { session_id: session || `s${n}`, transcript_path: file, hook_event_name: "Stop", stop_hook_active: false, ...input };
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), env: { ...process.env, TEMP: dir, TMP: dir, TMPDIR: dir, ...env }, encoding: "utf8" }).stdout;
};
const blocks = (out) => out.includes('"decision":"block"') && out.includes("/code-review");

const cases = [
  ["3 code files edited, no review: blocked", [typed("build it"), ...THREE, say("Done.")], true],
  ["the block names the files", [typed("build it"), ...THREE], (out) => /3 code files \(a\.js, b\.py, c\.ts\)/.test(out)],
  ["2 code files: passes", [typed("fix"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py")], false],
  ["2 code files and a .md: passes", [typed("fix"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), ...edit("C:/p/README.md")], false],
  ["the same file edited 3 times: passes", [typed("fix"), ...edit("C:/p/a.js"), ...edit("C:/p/a.js"), ...edit("C:/p/a.js")], false],
  ["one file under two spellings of its path counts once", [typed("fix"), ...edit("C:/p/a.js"), ...edit("C:\\p\\A.js"), ...edit("C:/p/b.py")], process.platform !== "win32"],
  ["Write and MultiEdit count", [typed("build"), ...write("C:/p/a.go"), tool("MultiEdit", { file_path: "C:/p/b.rs", edits: [] }), result(), ...write("C:/p/c.py")], true],
  ["a notebook (.ipynb) is not on the code list, as in rule-check", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"),
    tool("NotebookEdit", { notebook_path: "C:/p/c.ipynb", new_source: "x" }), result()], false],
  ["Nimbalyst's [System: ...] prompt is not a new turn", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"),
    { ...typed("[System: background task(s) you launched have settled]"), promptSource: "sdk" }, ...edit("C:/p/c.ts")], true],
  ["Nimbalyst's [Child Session Update] prompt is not a new turn", [typed("lead"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"),
    { ...typed("[Child Session Update] child finished"), promptSource: "sdk" }, ...edit("C:/p/c.ts")], true],
  ["a turn started by typing /code-review high passes", [typed("/code-review high"), ...THREE], false],
  ["a command that only starts with code-review (/code-review-notes) is no review", [typed("/code-review-notes"), ...THREE], true],
  ["a refused edit doesn't count", [typed("fix"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), ...edit("C:/p/c.ts", false)], false],
  ["code-review after the first edit: passes", [typed("build"), ...edit("C:/p/a.js"), ...review(), ...edit("C:/p/b.py"), ...edit("C:/p/c.ts")], false],
  ["code-review after all edits: passes", [typed("build"), ...THREE, ...review()], false],
  ["a plugin's code-review skill counts", [typed("build"), ...THREE, ...review("some-plugin:code-review")], false],
  ["code-review, then 3 more code files: blocked", [typed("build"), ...edit("C:/p/a.js"), ...review(), ...edit("C:/p/b.py"), ...edit("C:/p/c.ts"), ...edit("C:/p/d.go")], true],
  ["code-review, then fixes in 2 of the reviewed files: passes", [typed("build"), ...THREE, ...review(), ...edit("C:/p/a.js"), ...edit("C:/p/b.py")], false],
  ["a refused code-review call is no review", [typed("build"), ...THREE, tool("Skill", { skill: "code-review" }), result(false)], true],
  ["code-review before the edits: blocked", [typed("build"), ...review(), ...THREE], true],
  ["another skill is not a review", [typed("build"), ...THREE, ...review("simplify")], true],
  ["edits in an earlier turn don't count", [typed("build"), ...THREE, say("Done."), typed("thanks, one more fix"), ...edit("C:/p/a.js")], false],
  ["a review in an earlier turn doesn't cover this one", [typed("build"), ...review(), say("ok"), typed("now the feature"), ...THREE], true],
  ["tool results are not a new turn", [typed("build"), ...edit("C:/p/a.js"), result(), ...edit("C:/p/b.py"), ...edit("C:/p/c.ts")], true],
  ["text Claude Code adds (isMeta) is not a new turn", [typed("build"), ...edit("C:/p/a.js"), { ...typed("skill text"), isMeta: true }, ...edit("C:/p/b.py"), ...edit("C:/p/c.ts")], true],
  ["a background task's notice is not a new turn", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"),
    { ...typed("<task-notification>done</task-notification>"), promptSource: "system", origin: { kind: "task-notification" } }, ...edit("C:/p/c.ts")], true],
  ["an interrupt notice is not a new turn", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), typed("[Request interrupted by user]"), ...edit("C:/p/c.ts")], true],
  ["a turn the user started with /code-review (review and fixes) passes", [typed("<command-message>code-review</command-message>\n<command-name>/code-review</command-name>\n<command-args>--fix</command-args>"), ...THREE], false],
  ["a JSON file under src/ is code", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), ...edit("C:/p/mdk/src/c.json")], true],
  ["a JSON file elsewhere is not", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), ...edit("C:/p/package.json")], false],
];

let fail = 0;
const report = (ok, name) => { if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
for (const [name, entries, want] of cases) {
  const out = run(entries);
  report(typeof want === "function" ? want(out) : want ? blocks(out) : out === "", name);
}
const blocked = [typed("build"), ...THREE];
report(blocks(run(blocked, { input: { stop_hook_active: true } })), "stop_hook_active from another hook's block: still blocks once");
report(blocks(run(blocked, { session: "same" })) && run(blocked, { session: "same" }) === "", "a second stop in the same turn passes (one block per turn)");
report(blocks(run([...blocked, say("ok"), typed("next feature"), ...THREE], { session: "same" })), "a new turn in the same session can block again");
report(run(blocked, { input: { session_id: undefined } }) === "", "no session id: passes");
report(run(blocked, { input: { agent_id: "a1" } }) === "", "inside a subagent (agent_id): passes");
report(run(blocked, { env: { CODE_REVIEW_GATE: "off" } }) === "", "CODE_REVIEW_GATE=off disables it");
report(run(blocked, { input: { transcript_path: join(dir, "missing.jsonl") } }) === "", "missing transcript fails open");
report(spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" }).stdout === "", "bad JSON fails open");
const many = [typed("build"), ...["a", "b", "c", "d", "e", "f", "g", "h"].flatMap((f) => edit(`C:/p/${f}.js`))];
report(/8 code files \(a\.js, b\.js, c\.js, d\.js, e\.js, f\.js and 2 more\)/.test(run(many)), "a long file list is cut after 6 names");
const old = join(dir, "code-review-gate-old.txt"), fresh = join(dir, "code-review-gate-fresh.txt");
writeFileSync(old, "x"); writeFileSync(fresh, "x");
utimesSync(old, new Date(Date.now() - 3 * 86400000), new Date(Date.now() - 3 * 86400000));
const cleaned = blocks(run(blocked));
report(cleaned && !existsSync(old) && existsSync(fresh), "a block deletes marker files older than two days and keeps newer ones");

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : `all ${cases.length + 10} passed`);
process.exit(fail ? 1 : 0);
