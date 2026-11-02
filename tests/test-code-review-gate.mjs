// Tests for hooks/code-review-gate.mjs. Run: node tests/test-code-review-gate.mjs
// Each case writes a small transcript and runs the hook on it as a Stop event.
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, writeFileSync, rmSync, utimesSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { delimiter, join } from "node:path";
delete process.env.REVIEW_PUSH_PATTERN; // a project that sets one must not reach the test through this shell

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
  ["Write counts", [typed("build"), ...write("C:/p/a.go"), ...write("C:/p/b.rs"), ...write("C:/p/c.py")], true],
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
  ["files add up over the session's turns", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), say("Done."), typed("one more"), ...edit("C:/p/c.ts")], true],
  ["a turn that changed nothing doesn't ask, whatever came before", [typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), ...edit("C:/p/c.ts", false), say("Done."), typed("what does it do?"), say("It works.")], false],
  ["earlier work and a turn with no edits: no ask", [typed("build"), ...THREE, say("Done."), typed("thanks"), say("ok")], false],
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

let fail = 0, total = 0;
const report = (ok, name) => { total++; if (!ok) fail++; console.log(`${ok ? "PASS" : "FAIL"} ${name}`); };
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
const NINE = ["a", "b", "c", "d", "e", "f", "g", "h", "i"].flatMap((f) => edit(`C:/p/${f}.js`));
const TEN = [...NINE, ...edit("C:/p/j.js")];
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
report(run([typed("fix"), ...NINE], REAL) === "", "by default 9 code files pass");
report(blocks(run([typed("build"), ...TEN], REAL)), "by default 10 code files are blocked");
report(run([typed("build"), ...THREE, ...reviewer()]) === "", "a reviewer agent counts as a review");
report(blocks(run([typed("build"), ...THREE, ...reviewer({ subagent_type: "worker", prompt: "review it" })])), "another agent type is no review");
report(run([typed("build"), ...THREE, ...review("blind-review")]) === "", "the blind-review skill counts as a review");
report(/Run one reviewer/.test(run(blocked)) && /don't start a second/.test(run(blocked)), "the block asks for one reviewer and no second");
report(blocks(withHelpers([STARTED, say("Done.")], [["a", TEN]])), "one helper's 10 files count");
report(blocks(withHelpers([STARTED, say("Done.")], [["a", ONE("a")], ["b", ONE("b")]])), "2 helpers that edited code: a job of several steps");
report(withHelpers([STARTED, say("Done.")], [["a", ONE("a")]]) === "", "1 helper with 1 file passes");
report(withHelpers([STARTED, say("Done.")], [["a", [say("read only")]], ["b", ONE("b")]]) === "", "a helper that edited nothing is no step");
report(withHelpers([STARTED, say("Done.")], [["a", TEN, 3600000]]) === "", "a helper from well before this turn doesn't count on its own");
report(blocks(withHelpers([STARTED, ...edit("C:/p/k.js"), say("Done.")], [["a", TEN, 3600000]])), "an earlier helper's files add up with this turn's edit");
const LATER = { ...reviewer()[0], timestamp: new Date(Date.now() + 60000).toISOString() };
report(withHelpers([STARTED, LATER, result()], [["a", TEN]]) === "", "a reviewer after the helpers passes");
report(blocks(withHelpers([STARTED, ...ONE("a"), ...ONE("b"), ...ONE("c"), say("Done.")], [["a", ONE("d")], ["b", ONE("e")]], { CODE_REVIEW_GATE: "led" })), "led mode: a job of several helper steps is blocked");
report(run([typed("build"), ...TEN], { env: { CODE_REVIEW_MIN_FILES: "", CODE_REVIEW_GATE: "led" } }) === "", "led mode: the main session's own edits pass");
report(withHelpers([STARTED, say("Done.")], [["a", TEN]], { CODE_REVIEW_GATE: "led" }) === "", "led mode: one helper, however many files, passes");
report(run([typed("build"), ...edit("C:/p/a.js"), ...edit("C:/p/b.py"), say("Done."), typed("one more"), ...edit("C:/p/c.ts")], { env: { CODE_REVIEW_GATE: "led" } }) === "", "led mode: small turns don't add up");
const launched = (agentId) => ({ type: "user", message: { role: "user", content: [{ type: "tool_result", tool_use_id: "x", content: "started" }] }, toolUseResult: { status: "async_launched", agentId } });
const notice = (id) => ({ ...typed(`<task-notification><task-id>${id}</task-id></task-notification>`), promptSource: "system", origin: { kind: "task-notification" } });
report(withHelpers([STARTED, launched("a"), say("Waiting.")], [["a", TEN]]) === "", "a background helper still at work: the job isn't finished, no block");
report(blocks(withHelpers([STARTED, launched("a"), say("Waiting."), notice("a"), say("Done.")], [["a", TEN]])), "its notice arrived: blocked");
report(blocks(withHelpers([STARTED, launched("a"), say("Waiting.")], [["a", ONE("a"), 1200000], ["b", TEN]])), "a helper silent for 20 minutes is a leftover: blocked");
// One reviewer at most: what comes after a review, and what a typed note must not hide
const MIN = 60000;
const at = (e, ago) => ({ ...e, timestamp: new Date(Date.now() - ago).toISOString() });
const aged = (entries, ago) => entries.map((e) => at(e, ago));
const [R_CALL, R_BACK] = reviewer();
const REVIEWED = [at(typed("build"), 40 * MIN), at(R_CALL, 30 * MIN), at(R_BACK, 29 * MIN), say("Findings."), at(typed("fix those"), 5 * MIN), say("Done.")];
report(withHelpers(REVIEWED, [["a", [...aged(TEN, 35 * MIN), ...aged(ONE("a"), 2 * MIN)]]]) === "", "a helper resumed for a fix counts only what it did since the review");
report(withHelpers(REVIEWED, [["a", aged(ONE("a"), 2 * MIN)], ["b", aged(ONE("b"), 2 * MIN)]]) === "", "2 helpers after a review are fixing it: no second reviewer");
report(blocks(withHelpers(REVIEWED, [["a", aged(TEN, 2 * MIN)]])), "10 new files after a review in an earlier turn: blocked");
report(withHelpers(REVIEWED, [["a", aged(TEN, 2 * MIN)]], { CODE_REVIEW_GATE: "led" }) === "", "led mode: one helper after a review passes");
report(blocks(withHelpers(REVIEWED, [["a", aged(TEN, 2 * MIN)], ["b", aged(ONE("k"), 2 * MIN)]], { CODE_REVIEW_GATE: "led" })), "led mode: a new job of several helpers after a review is blocked");
report(withHelpers([STARTED, at(R_CALL, 30000), at(R_BACK, 29000), say("Fixing.")], [["a", aged(ONE("a"), 45000)], ["b", aged(TEN, 10000)]]) === "", "10 files of fixes after this turn's review: no second reviewer");
// Small turns add up, and a review starts the count again
const THREE_ON = { CODE_REVIEW_MIN_FILES: "3" };
const before = [at(typed("build"), 40 * MIN), ...aged(THREE, 35 * MIN)];
report(withHelpers([...before, at(R_CALL, 30 * MIN), at(R_BACK, 29 * MIN), at(typed("one more"), 3 * MIN), ...aged(ONE("k"), 2 * MIN)], [], THREE_ON) === "", "a review earlier in the session starts the count again");
report(blocks(withHelpers([...before, at(typed("one more"), 3 * MIN), ...aged(ONE("k"), 2 * MIN)], [], THREE_ON, "reset")), "with no review, the earlier files count");
report(blocks(withHelpers([...before, at(typed("one more"), 3 * MIN), ...aged(ONE("k"), 2 * MIN), at(typed("and one more"), 0), ...ONE("m")], [], THREE_ON, "reset")), "a block nobody acted on leaves the files counted");
report(blocks(withHelpers([at(typed("build"), 40 * MIN), ...aged(ONE("a"), 35 * MIN), at(typed("one more"), 3 * MIN), ...aged(ONE("b"), 2 * MIN), say("Done.")], [["a", [...aged(ONE("c"), 35 * MIN)], 34 * MIN]], THREE_ON)), "a helper's earlier files add up over turns too");
// Hooks, settings and CI, on the real threshold
const one = (file) => run([typed("change it"), ...edit(file)], REAL);
for (const f of ["C:/p/.claude/settings.json", "C:/p/.claude/settings.local.json", "C:/p/.claude/hooks/x.mjs", "C:/p/.github/workflows/ci.yml", "C:/p/.gitlab-ci.yml", "C:/p/.circleci/config.yml", "C:/p/.husky/pre-commit", "C:/p/settings.example.json"])
  report(blocks(one(f)), `a setup file is reviewed at one file: ${f.slice(5)}`);
report(/changed 1 file: hooks, rules, settings or CI files \(ci\.yml\)/.test(one("C:/p/.github/workflows/ci.yml")), "the block names the setup file and says how many");
report(/every changed file by path \(1 file\)/.test(one("C:/p/.github/workflows/ci.yml")) && /every changed file by path \(3 files\)/.test(run([typed("build"), ...THREE])), "the brief hint says how many files to name");
report(one("C:/p/src/hooks/useThing.js") === "", "a web project's src/hooks file is ordinary code");
report(one("D:/work/Temp/.claude/hooks/x.mjs") === "", "a setup file in a temp folder is a throwaway");
report(run([typed("change it"), ...edit("C:/p/.claude/settings.json")], { env: { CODE_REVIEW_MIN_FILES: "", CODE_REVIEW_GATE: "led" } }) === "", "led mode: a setup file alone passes");
report(blocks(withHelpers([at(typed("build"), 40 * MIN), at(R_CALL, 30 * MIN), at(R_BACK, 29 * MIN), at(typed("fix that"), 5 * MIN), ...aged(edit("C:/p/.claude/settings.json"), MIN)], [])), "a setup change in a later turn than the review still asks");
// A /code-review the user typed is a review for the count too
const TYPED = [at(typed("/code-review high"), 10 * MIN), ...aged(TEN, 9 * MIN)];
report(withHelpers(TYPED, [], {}, "typed") === "", "a typed review's own turn passes");
report(withHelpers([...TYPED, at(typed("thanks, one more"), MIN), ...aged(ONE("k"), 30000)], [], {}, "typed") === "", "the files of a typed review's turn don't count afterwards");
report(blocks(withHelpers([...TYPED, at(typed("one hook"), MIN), ...aged(edit("C:/p/.claude/hooks/x.mjs"), 30000)], [], {}, "typed")), "a setup change after a typed review's turn still asks");
// After a review 2 helpers are a new job from 5 files, also in led mode
const JOB = [["a", ["a", "b", "c"].flatMap((f) => aged(ONE(f), 2 * MIN))], ["b", ["d", "e"].flatMap((f) => aged(ONE(f), 2 * MIN))]];
const FIXES = [["a", ["a", "b"].flatMap((f) => aged(ONE(f), 2 * MIN))], ["b", ["c", "d"].flatMap((f) => aged(ONE(f), 2 * MIN))]];
report(blocks(withHelpers(REVIEWED, JOB)), "a new job of 2 helpers on 5 files after a review is blocked");
report(blocks(withHelpers(REVIEWED, JOB, { CODE_REVIEW_GATE: "led" })), "led mode: the same");
report(withHelpers(REVIEWED, FIXES, { CODE_REVIEW_GATE: "led" }) === "", "2 helpers on 4 files after a review are fixing it");
const NOTE = [at(typed("build"), 20 * MIN), at(typed("one more thing"), MIN), say("Done.")];
report(blocks(withHelpers(NOTE, [["a", ONE("a"), 10 * MIN], ["b", ONE("b"), 10 * MIN]])), "helpers that finished 10 minutes before a typed note still count");
const ONCE = [["a", ONE("a"), 2 * MIN], ["b", ONE("b"), 2 * MIN]];
report(blocks(withHelpers([STARTED, say("Done.")], ONCE, {}, "asked")), "a job of helpers blocks");
report(withHelpers([STARTED, say("Done."), at(typed("thanks"), 0), say("ok")], ONCE, {}, "asked") === "", "the next message doesn't ask about the same helpers again");
mkdirSync(join(dir, ".claude"), { recursive: true });
writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ env: { CODE_REVIEW_GATE: "off" } }));
report(run(blocked) === "", "the switch can sit in the project's settings");
rmSync(join(dir, ".claude"), { recursive: true, force: true });

// The wider lists
for (const f of ["C:/p/.claude/agents/x.md", "C:/p/.claude/rules/x.md", "C:/p/.claude/skills/x/SKILL.md", "C:/p/CLAUDE.md"]) report(blocks(one(f)), `rules and agents are setup files: ${f.slice(5)}`);
report(blocks(run([typed("build"), ...["a.vue", "b.php", "c.sql"].flatMap((f) => edit(`C:/p/${f}`))])), "vue, php and sql are code");
report(withHelpers([at(typed("fix"), 5 * MIN), at(R_CALL, 4 * MIN), at(R_BACK, 3 * MIN), ...aged(edit("C:/p/.claude/hooks/x.mjs"), MIN)], []) === "", "a setup fix in the review's own turn: no second reviewer");
// A review counts when its report is back
const reviewerLeft = (session, last) => {
  mkdirSync(join(dir, session, "subagents"), { recursive: true });
  writeFileSync(join(dir, session, "subagents", "agent-rev.meta.json"), JSON.stringify({ agentType: "reviewer", toolUseId: R_CALL.message.content[0].id }));
  return [["rev", [last]]];
};
const CUT_RUN = [at(typed("build"), 40 * MIN), ...aged(TEN, 35 * MIN), at(R_CALL, 30 * MIN), at(R_BACK, 29 * MIN), say("Done.")];
const cutOut = withHelpers(CUT_RUN, reviewerLeft("cut", result()), {}, "cut");
report(blocks(cutOut) && /SendMessage/.test(cutOut), "a reviewer cut at its limit is not a review, and the block says what to do");
report(blocks(withHelpers(CUT_RUN, reviewerLeft("empty", say("No diff to review.")), {}, "empty")), "a reviewer with no report is not a review");
report(withHelpers(CUT_RUN, reviewerLeft("back", say("**Against the request:** pass\n**Quality:** pass")), {}, "back") === "", "a reviewer that reported is a review");
// A question to the user mid-job passes; the next stop still counts
report(run(blocked, { input: { last_assistant_message: "Should I go on with the next part?" } }) === "", "a reply ending in a question passes");
const reply = (last_assistant_message) => ({ last_assistant_message });
const ASKED = [typed("build"), ...THREE, say("Deploy it?")];
report(run(ASKED, { session: "held", input: reply("Deploy it?") }) === "", "a question holds the work");
report(run([...ASKED, typed("which one?"), say("A or B?")], { session: "held", input: reply("A or B?") }) === "", "a second question keeps holding it");
report(blocks(run([...ASKED, typed("yes"), say("Deployed.")], { session: "held", input: reply("Deployed.") })), "the reply after the answer asks for the review, though that turn changed nothing");
report(run([...ASKED, typed("thanks"), say("Done.")], { session: "held", input: reply("Done.") }) === "", "and only once");
run(ASKED, { session: "held2", input: reply("Deploy it?") });
report(run([...ASKED, typed("yes"), at(tool("Agent", { subagent_type: "reviewer", prompt: "x" }), -60000), result(), say("Reviewed.")], { session: "held2", input: reply("Reviewed.") }) === "", "a review after the question ends the hold");
run([typed("change it"), ...edit("C:/p/.claude/hooks/x.mjs"), say("Ship it?")], { session: "held3", input: reply("Ship it?") });
report(/this work changed 1 file: hooks, rules, settings or CI files \(x\.mjs\)/.test(run([typed("change it"), ...edit("C:/p/.claude/hooks/x.mjs"), say("Ship it?"), typed("yes"), say("Shipped.")], { session: "held3", input: reply("Shipped.") })), "a held setup file is named after the answer");
const NAMED = [at(typed("build"), 40 * MIN), at(tool("Agent", { subagent_type: "reviewer", prompt: "Changed: C:\\p\\.claude\\hooks\\x.mjs" }), 30 * MIN), at(result(), 29 * MIN), at(typed("fix that"), 5 * MIN)];
report(withHelpers([...NAMED, ...aged(edit("C:/p/.claude/hooks/x.mjs"), MIN)], []) === "", "a fix to a setup file the review's brief named: no second review");
report(blocks(withHelpers([...NAMED, ...aged(edit("C:/p/.claude/hooks/y.mjs"), MIN)], [])), "a setup file the review's brief didn't name still asks");
report(withHelpers([at(typed("build"), 5 * MIN), say("Done.")], [["a", [...aged(edit("C:/p/a.js"), 3 * MIN), at({ ...typed("the summary"), isCompactSummary: true }, 150000), ...aged(edit("C:/p/b.js"), 2 * MIN)]]]) === "", "a helper that compacted is still one step");
report(blocks(run(blocked, { input: { last_assistant_message: "Done." } })), "a reply ending otherwise is judged");
// A worker reused for the next step: each brief is a step, its own wake-ups are not
const wake = { type: "user", message: { role: "user", content: "<task-notification>build done</task-notification>" } };
report(blocks(withHelpers([STARTED, say("Done.")], [["a", [at(typed("step 1"), 4 * MIN), ...aged(ONE("a"), 3 * MIN), at(typed("step 2"), 2 * MIN), ...aged(ONE("b"), MIN)]]])), "a reused worker's two briefs are two steps");
report(withHelpers([STARTED, say("Done.")], [["a", [at(typed("step 1"), 4 * MIN), ...aged(ONE("a"), 3 * MIN), at(wake, 2 * MIN), ...aged(ONE("b"), MIN)]]]) === "", "a wake-up from its own build is not a step");
// The push check: --pre, PreToolUse on Bash. THREE files are due at the test threshold of 3
const hookEnv = (env = {}) => ({ ...process.env, CODE_REVIEW_GATE: "", CODE_REVIEW_MIN_FILES: "", CLAUDE_PROJECT_DIR: dir, TEMP: dir, TMP: dir, TMPDIR: dir, ...env });
const pre = (entries, command, { env = {}, session, input = {}, tool_name = "Bash" } = {}) => {
  const sid = session || `p${++n}`, file = join(dir, `${sid}-${++n}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const event = { session_id: sid, transcript_path: file, hook_event_name: "PreToolUse", tool_name, tool_input: { command }, ...input };
  return spawnSync(process.execPath, [HOOK, "--pre"], { input: JSON.stringify(event), env: hookEnv({ CODE_REVIEW_MIN_FILES: "3", ...env }), encoding: "utf8" }).stdout;
};
const denied = (out) => out.includes('"permissionDecision":"deny"');
const DUE = [typed("build"), ...THREE, say("Done.")];
const pushOut = pre(DUE, "git push origin main");
report(denied(pushOut) && /one reviewer agent/.test(pushOut) && /CODE_REVIEW_GATE=off/.test(pushOut) && /3 files/.test(pushOut), "due: git push is denied, with the reviewer and the off switch in the text");
report(pre([typed("build"), ...THREE, ...reviewer(), say("Done.")], "git push origin main") === "", "reviewed: git push is allowed");
report(pre([typed("build"), ...THREE, ...review(), say("Done.")], "git push origin main") === "", "reviewed by the code-review skill: git push is allowed");
report(pre(DUE, 'git commit -m "build it"') === "", "due: git commit is untouched");
report(pre(DUE, 'git commit -m "then git push it"') === "", "due: a commit message that says git push is untouched");
report(pre(DUE, "git status && git diff") === "", "due: other git commands are untouched");
report(denied(pre(DUE, "GH_TOKEN=x git push origin main")), "due: a push with a prefix is denied");
report(denied(pre(DUE, "cd /p && git add -A && git commit -m x && git push")), "due: a push at the end of a chain is denied");
report(denied(pre(DUE, "git -C /p push origin main")), "due: git -C dir push is denied");
report(denied(pre(DUE, "gh release create v1 --notes x")) && denied(pre(DUE, "npm publish")), "due: gh release and npm publish are denied");
report(denied(pre(DUE, 'bash -c "git push"')), "due: a push inside bash -c is denied");
report(pre([typed("build"), ...THREE, say("Done."), typed("push it"), say("Pushing.")], "git push") !== "", "work from an earlier turn, a push in a turn with no edits: still denied");
report(pre([typed("fix"), ...edit("C:/p/a.js"), say("Done.")], "git push") === "", "not due: git push is allowed");
report(pre(DUE, "git push", { env: { CODE_REVIEW_GATE: "off" } }) === "", "CODE_REVIEW_GATE=off: git push is allowed");
report(pre(DUE, "git push", { tool_name: "Read" }) === "", "only shell tools are checked");
report(/"deny"/.test(pre(DUE, "git push", { input: { agent_id: "a1" } })), "a helper's push is checked too");
report(/"deny"/.test(pre(DUE, "git push", { tool_name: "PowerShell" })), "a push from PowerShell is checked too");
report(/"deny"/.test(pre([...DUE, launched("bg1")], "git push")), "a helper running in the background doesn't open the push");
report(["/usr/bin/git push", "git.exe push origin main", "C:/Git/bin/git.exe push"].every((c) => /"deny"/.test(pre(DUE, c))), "git with a path or .exe is a push");
report(pre(DUE, "git status\n\n# WHAT THIS DOES: shows what git push would send") === "", "a comment line that says git push is not one");
report(pre(DUE, "gh release view v1") === "" && /"deny"/.test(pre(DUE, "gh release create v1")), "reading a release passes, making one is checked");
report(pre(DUE, "git push", { input: { transcript_path: join(dir, "missing.jsonl") } }) === "", "a missing transcript fails open on a push");
report(spawnSync(process.execPath, [HOOK, "--pre"], { input: "not json", encoding: "utf8" }).stdout === "", "bad JSON fails open on a push");
report(pre(DUE, "./deploy.sh") === "" && denied(pre(DUE, "./deploy.sh", { env: { REVIEW_PUSH_PATTERN: "deploy\\.sh$" } })), "REVIEW_PUSH_PATTERN in the env adds a command");
mkdirSync(join(dir, ".claude"), { recursive: true });
writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ env: { REVIEW_PUSH_PATTERN: "deploy\\.sh$" } }));
report(denied(pre(DUE, "./deploy.sh")), "REVIEW_PUSH_PATTERN in the project's settings adds a command");
writeFileSync(join(dir, ".claude", "settings.json"), JSON.stringify({ env: { REVIEW_PUSH_PATTERN: "(" } }));
report(pre(DUE, "./deploy.sh") === "" && denied(pre(DUE, "git push")), "a pattern that doesn't parse is ignored");
rmSync(join(dir, ".claude"), { recursive: true, force: true });
const afterPush = (() => { pre(DUE, "git push", { session: "samepush" }); return run(DUE, { session: "samepush" }); })();
report(blocks(afterPush), "a denied push doesn't use up the Stop arm's one block of the turn");

// Counting from git. A stub `git` on PATH answers the few calls the hook makes from a file the test writes
const PATHKEY = Object.keys(process.env).find((k) => k.toLowerCase() === "path") || "PATH";
const stubDir = join(dir, "stub-bin"), stubTop = join(dir, "stub-repo");
mkdirSync(stubDir); mkdirSync(stubTop);
writeFileSync(join(stubDir, "git-stub.mjs"), [
  'import fs from "node:fs";',
  'const cfg = JSON.parse(fs.readFileSync(new URL("./stub.json", import.meta.url), "utf8"));',
  "if (cfg.fail) process.exit(1);",
  "let a = process.argv.slice(2);",
  'while (a[0] === "-c") a = a.slice(2);',
  'if (a[0] === "rev-parse") process.stdout.write(cfg.top + "\\n" + cfg.head + "\\n");',
  'else if (a[0] === "status") process.stdout.write(cfg.status.map((f) => " M " + f + "\\0").join(""));',
  'else if (a[0] === "config") process.stdout.write(cfg.email + "\\n");',
  'else if (a[0] === "log") { const who = (a.find((x) => x.startsWith("--author=")) || "").slice(9); process.stdout.write(cfg.commits.filter((c) => who === "<" + c.author + ">").flatMap((c) => c.files).join("\\n") + "\\n"); }',
  "else process.exit(1);",
].join("\n"));
if (process.platform === "win32") writeFileSync(join(stubDir, "git.cmd"), `@"${process.execPath}" "%~dp0git-stub.mjs" %*\r\n`);
else { writeFileSync(join(stubDir, "git"), `#!/bin/sh\nexec "${process.execPath}" "$(dirname "$0")/git-stub.mjs" "$@"\n`); chmodSync(join(stubDir, "git"), 0o755); }
const stub = (o = {}) => writeFileSync(join(stubDir, "stub.json"), JSON.stringify({ top: stubTop, head: "aaa", status: [], email: "me@x", commits: [], ...o }));
const STUB = { [PATHKEY]: stubDir + delimiter + process.env[PATHKEY] };
const startHook = (session, env = {}) => spawnSync(process.execPath, [HOOK, "--start"], { input: JSON.stringify({ session_id: session, hook_event_name: "SessionStart", source: "startup" }), env: hookEnv(env), encoding: "utf8" });
const baseOf = (session) => join(dir, `code-review-gate-${session}.base.json`);
const TWELVE = Array.from({ length: 12 }, (_, i) => `src/f${i}.js`);
const SED = [typed("rename it everywhere with sed"), { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", id: "sed1", name: "Bash", input: { command: "sed -i s/a/b/ src/*.js" } }] } }, say("Done.")];
const READING = [typed("what does this file do?"), say("It starts the server.")];
stub();
report(startHook("g1", STUB).stdout === "" && existsSync(baseOf("g1")), "the start arm stores a baseline and prints nothing");
stub({ status: TWELVE });
const g1 = run(SED, { session: "g1", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } });
report(blocks(g1) && /12 code files/.test(g1), "12 code files changed by sed, none in the transcript: blocked at Stop");
stub();
startHook("g-read", STUB);
stub({ status: TWELVE });
report(run(READING, { session: "g-read", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } }) === "", "a turn that only read: files another session changed are not its work");
report(run([...SED, typed("thanks"), say("ok")], { session: "g1", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } }) === "", "the next turn that changed nothing doesn't ask about the same git files again");
report(denied(pre(SED, "git push", { session: "g1", env: STUB })), "the push check counts the git files too");
stub(); startHook("g2", STUB); stub({ status: TWELVE.slice(0, 9) });
report(run(SED, { session: "g2", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } }) === "", "9 git files are below the threshold");
stub(); startHook("g3", STUB); stub({ status: [...TWELVE.slice(0, 9), "docs/a.md", "docs/b.md", "docs/c.md"] });
report(run(SED, { session: "g3", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } }) === "", "git files are filtered by the code list: 9 code files and 3 .md pass");
stub({ status: [] }); startHook("g4", STUB); stub({ status: TWELVE });
report(blocks(run([typed("edit"), ...THREE.slice(0, 4), say("ok")], { session: "g4", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } })), "git files add to the transcript's: 2 edited and 12 changed by sed");
stub({ status: TWELVE }); startHook("g5", STUB); // dirty at the start: not this session's work
report(run(SED, { session: "g5", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } }) === "", "files dirty at the session start don't count");
stub({ status: [...TWELVE] });
report(run(SED, { session: "g6", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } }) === "" && existsSync(baseOf("g6")), "a session with no baseline stores one at its first Stop and counts nothing from git");
stub({ head: "aaa" }); startHook("g7", STUB); startHook("g8", STUB);
stub({ head: "bbb", commits: [{ author: "other@x", files: TWELVE }] });
report(run(SED, { session: "g7", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } }) === "", "a pull of another author's 12 commits' files doesn't count");
stub({ head: "bbb", commits: [{ author: "other@x", files: TWELVE }, { author: "me@x", files: TWELVE }] });
report(blocks(run(SED, { session: "g8", env: { ...STUB, CODE_REVIEW_MIN_FILES: "" } })), "the user's own commits count, the other's beside them don't");
stub({ fail: true });
report(blocks(run([typed("build"), ...THREE], { session: "g9", env: STUB })) && run([typed("fix"), ...edit("C:/p/a.js")], { session: "g10", env: STUB }) === "", "a git that fails: the transcript count, as before");
report(startHook("g11", STUB).stdout === "" && !existsSync(baseOf("g11")), "a failing git leaves no baseline and no output");
startHook("g12");
report(!existsSync(baseOf("g12")) && blocks(run([typed("build"), ...THREE], { session: "g12" })) && !existsSync(baseOf("g12")), "no git repo: no baseline, today's count");
report(startHook("g13", { CODE_REVIEW_GATE: "off" }).stdout === "" && !existsSync(baseOf("g13")), "off: the start arm stores nothing");

// The same with real git, in a repository the test makes. A review after the changes ends their count
const repo = join(dir, "repo");
mkdirSync(repo);
const git = (...args) => { const r = spawnSync("git", args, { cwd: repo, encoding: "utf8" }); if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`); return r.stdout; };
const as = (who) => ["-c", `user.email=${who}@x`, "-c", `user.name=${who}`, "-c", "commit.gpgsign=false"];
const touch = (names, text) => names.forEach((f) => { mkdirSync(join(repo, "src"), { recursive: true }); writeFileSync(join(repo, f), text); });
const real = (session, entries = SED) => run(entries, { session, env: { CLAUDE_PROJECT_DIR: repo, CODE_REVIEW_MIN_FILES: "" } });
const realStart = (session) => startHook(session, { CLAUDE_PROJECT_DIR: repo });
git("init", "-q"); git("config", "user.email", "me@x"); git("config", "user.name", "me");
touch(TWELVE, "a\n"); git("add", "-A"); git(...as("me"), "commit", "-q", "-m", "first");
realStart("r1"); realStart("r2"); realStart("r3");
touch(TWELVE, "b\n"); git("add", "-A"); git(...as("other"), "commit", "-q", "-m", "their work", "--author=other <other@x>");
report(real("r1") === "", "real git: a pull of another author's commits to 12 code files doesn't count");
touch(TWELVE, "c\n"); git("add", "-A"); git(...as("me"), "commit", "-q", "-m", "my work");
const r2 = real("r2");
report(blocks(r2) && /12 code files/.test(r2), "real git: the user's own commits to 12 code files count");
const REVIEWED_LATER = [...SED.slice(0, 1), { ...reviewer()[0], timestamp: new Date(Date.now() + 60000).toISOString() }, result(), say("Reviewed.")];
report(real("r3", REVIEWED_LATER) === "", "real git: a review after the changes: they don't count");
realStart("r4");
touch(TWELVE, "d\n");
report(blocks(real("r4")), "real git: 12 tracked files changed in the working tree (sed) count");
git("checkout", "--", ".");
realStart("r5");
const mainBranch = git("rev-parse", "--abbrev-ref", "HEAD").trim();
git("checkout", "-q", "-b", "helper"); touch(TWELVE, "e\n"); git("add", "-A"); git(...as("me"), "commit", "-q", "-m", "helper work");
git("checkout", "-q", mainBranch); git(...as("me"), "merge", "-q", "--no-ff", "helper", "-m", "merge the helper");
report(blocks(real("r5")), "real git: merging a helper's branch counts its commits");
touch(TWELVE, "ccc\n"); realStart("r6");
git("add", "-A"); git(...as("me"), "commit", "-q", "-m", "reviewed work from before this session");
report(real("r6") === "", "real git: committing files that were dirty at the start, unchanged, is not new work");
touch(TWELVE, "dddd\n"); realStart("r7"); touch(TWELVE, "eeeee\n");
git("add", "-A"); git(...as("me"), "commit", "-q", "-m", "more work on them");
report(blocks(real("r7")), "real git: a file dirty at the start and changed again before the commit counts");

// A crash leaves a line
const crashHome = join(dir, "crash-home");
spawnSync(process.execPath, [HOOK], { input: "not json", env: { ...process.env, CODE_REVIEW_GATE: "", USERPROFILE: crashHome, HOME: crashHome, CLAUDE_PROJECT_DIR: dir }, encoding: "utf8" });
report(existsSync(join(crashHome, ".claude", "hooks", "state", "hook-errors.log")), "a crash fails open and leaves a line in the log");

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} of ${total} failed` : `all ${total} passed`);
process.exit(fail ? 1 : 0);
