// Tests for hooks/code-review-gate.mjs. Run: node tests/test-code-review-gate.mjs
// Each case writes a small transcript and runs the hook on it as a Stop event.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync, utimesSync, existsSync } from "node:fs";
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
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), env: { ...process.env, CODE_REVIEW_GATE: "", CODE_REVIEW_MIN_FILES: "3", CLAUDE_PROJECT_DIR: dir, TEMP: dir, TMP: dir, TMPDIR: dir, ...env }, encoding: "utf8" }).stdout;
};
const blocks = (out) => out.includes('"decision":"block"') && out.includes('subagent_type \\"reviewer\\"');

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
  ["a review this turn, after the work, ends the gate: what follows is its fixes", [typed("build"), ...edit("C:/p/a.js"), ...review(), ...edit("C:/p/b.py"), ...edit("C:/p/c.ts"), ...edit("C:/p/d.go")], false],
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
  ["a throwaway script in a temp folder is not code", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), ...edit("C:/Users/you/AppData/Local/Temp/c.py")], false],
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

// The cases above run with a threshold of 3. These run on the real one, and on helpers' transcripts
const FIVE = ["a", "b", "c", "d", "e"].flatMap((f) => edit(`C:/p/${f}.js`));
const REAL = { env: { CODE_REVIEW_MIN_FILES: "" } };
const reviewer = (input = { subagent_type: "reviewer", prompt: "look" }) => [tool("Agent", input), result()];
// A run whose transcript has a subagents folder next to it; each helper is [name, entries, age in ms]
const withHelpers = (entries, helpers, env = {}, session = `h${++n}`) => {
  const folder = join(dir, session, "subagents");
  mkdirSync(folder, { recursive: true });
  for (const [name, edits, age] of helpers) {
    const file = join(folder, `agent-${name}.jsonl`);
    writeFileSync(file, edits.map((e) => JSON.stringify(e)).join("\n") + "\n");
    if (age) utimesSync(file, new Date(Date.now() - age), new Date(Date.now() - age));
  }
  const file = join(dir, `${session}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const event = { session_id: session, transcript_path: file, hook_event_name: "Stop", stop_hook_active: false };
  return spawnSync(process.execPath, [HOOK], { input: JSON.stringify(event), env: { ...process.env, CODE_REVIEW_GATE: "", CODE_REVIEW_MIN_FILES: "", CLAUDE_PROJECT_DIR: dir, TEMP: dir, TMP: dir, TMPDIR: dir, ...env }, encoding: "utf8" }).stdout;
};
const STARTED = { ...typed("build"), timestamp: new Date(Date.now() - 60000).toISOString() };
const ONE = (f) => edit(`C:/p/${f}.js`);
report(run([typed("fix"), ...THREE], REAL) === "", "by default 3 code files pass");
report(blocks(run([typed("build"), ...FIVE], REAL)), "by default 5 code files are blocked");
report(run([typed("build"), ...THREE, ...reviewer()]) === "", "a reviewer agent counts as a review");
report(blocks(run([typed("build"), ...THREE, ...reviewer({ subagent_type: "worker", prompt: "review it" })])), "another agent type is no review");
report(run([typed("build"), ...THREE, ...review("blind-review")]) === "", "the blind-review skill counts as a review");
report(/Run one reviewer/.test(run(blocked)) && /don't start a second/.test(run(blocked)), "the block asks for one reviewer and no second");
report(blocks(withHelpers([STARTED, say("Done.")], [["a", FIVE]])), "one helper's 5 files count");
report(blocks(withHelpers([STARTED, say("Done.")], [["a", ONE("a")], ["b", ONE("b")]])), "2 helpers that edited code: a job of several steps");
report(withHelpers([STARTED, say("Done.")], [["a", ONE("a")]]) === "", "1 helper with 1 file passes");
report(withHelpers([STARTED, say("Done.")], [["a", [say("read only")]], ["b", ONE("b")]]) === "", "a helper that edited nothing is no step");
report(withHelpers([STARTED, say("Done.")], [["a", FIVE, 3600000]]) === "", "a helper from well before this turn doesn't count");
const LATER = { ...reviewer()[0], timestamp: new Date(Date.now() + 60000).toISOString() };
report(withHelpers([STARTED, LATER, result()], [["a", FIVE]]) === "", "a reviewer after the helpers passes");
report(blocks(withHelpers([STARTED, ...ONE("a"), ...ONE("b"), ...ONE("c"), say("Done.")], [["a", ONE("d")], ["b", ONE("e")]], { CODE_REVIEW_GATE: "led" })), "led mode: a job of several helper steps is blocked");
report(run([typed("build"), ...FIVE], { env: { CODE_REVIEW_MIN_FILES: "", CODE_REVIEW_GATE: "led" } }) === "", "led mode: the main session's own edits pass");
report(withHelpers([STARTED, say("Done.")], [["a", FIVE]], { CODE_REVIEW_GATE: "led" }) === "", "led mode: one helper, however many files, passes");
const launched = (agentId) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "started" }] }, toolUseResult: { status: "async_launched", agentId } });
const notice = (id) => ({ ...typed(`<task-notification><task-id>${id}</task-id></task-notification>`), promptSource: "system", origin: { kind: "task-notification" } });
report(withHelpers([STARTED, launched("a"), say("Waiting.")], [["a", FIVE]]) === "", "a background helper still at work: the job isn't finished, no block");
report(blocks(withHelpers([STARTED, launched("a"), say("Waiting."), notice("a"), say("Done.")], [["a", FIVE]])), "its notice arrived: blocked");
report(blocks(withHelpers([STARTED, launched("a"), say("Waiting.")], [["a", ONE("a"), 1200000], ["b", FIVE]])), "a helper silent for 20 minutes is a leftover: blocked");
// One reviewer at most: what comes after a review, and what a typed note must not hide
const MIN = 60000;
const at = (e, ago) => ({ ...e, timestamp: new Date(Date.now() - ago).toISOString() });
const aged = (entries, ago) => entries.map((e) => at(e, ago));
const [R_CALL, R_BACK] = reviewer();
const REVIEWED = [at(typed("build"), 40 * MIN), at(R_CALL, 30 * MIN), at(R_BACK, 29 * MIN), say("Findings."), at(typed("fix those"), 5 * MIN), say("Done.")];
report(withHelpers(REVIEWED, [["a", [...aged(FIVE, 35 * MIN), ...aged(ONE("a"), 2 * MIN)]]]) === "", "a helper resumed for a fix counts only what it did since the review");
report(withHelpers(REVIEWED, [["a", aged(ONE("a"), 2 * MIN)], ["b", aged(ONE("b"), 2 * MIN)]]) === "", "2 helpers after a review are fixing it: no second reviewer");
report(blocks(withHelpers(REVIEWED, [["a", aged(FIVE, 2 * MIN)]])), "5 new files after a review in an earlier turn: blocked");
report(withHelpers(REVIEWED, [["a", aged(FIVE, 2 * MIN)]], { CODE_REVIEW_GATE: "led" }) === "", "led mode: one helper after a review passes");
report(blocks(withHelpers(REVIEWED, [["a", aged(FIVE, 2 * MIN)], ["b", aged(ONE("f"), 2 * MIN)]], { CODE_REVIEW_GATE: "led" })), "led mode: a new job of several helpers after a review is blocked");
report(withHelpers([STARTED, at(R_CALL, 30000), at(R_BACK, 29000), say("Fixing.")], [["a", aged(ONE("a"), 45000)], ["b", aged(FIVE, 10000)]]) === "", "5 files of fixes after this turn's review: no second reviewer");
const NOTE = [at(typed("build"), 20 * MIN), at(typed("one more thing"), MIN), say("Done.")];
report(blocks(withHelpers(NOTE, [["a", ONE("a"), 10 * MIN], ["b", ONE("b"), 10 * MIN]])), "helpers that finished 10 minutes before a typed note still count");
const ONCE = [["a", ONE("a"), 2 * MIN], ["b", ONE("b"), 2 * MIN]];
report(blocks(withHelpers([STARTED, say("Done.")], ONCE, {}, "asked")), "a job of helpers blocks");
report(withHelpers([STARTED, say("Done."), at(typed("thanks"), 0), say("ok")], ONCE, {}, "asked") === "", "the next message doesn't ask about the same helpers again");
mkdirSync(join(dir, ".claude"), { recursive: true });
writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ env: { CODE_REVIEW_GATE: "off" } }));
report(run(blocked) === "", "the switch can sit in the project's settings");
rmSync(join(dir, ".claude"), { recursive: true, force: true });

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : `all ${cases.length + 38} passed`);
process.exit(fail ? 1 : 0);
