// Test for skills/setup-audit/scripts/outcomes.mjs: a made-up chats folder with known answers, and the report it should print.
// Run: node tests/test-outcomes.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../skills/setup-audit/scripts/outcomes.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "outcomes-test-"));
const proj = path.join(root, "C--Projects-demo");
fs.mkdirSync(proj, { recursive: true });

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : `\n   got:  ${JSON.stringify(got)}\n   want: ${JSON.stringify(want)}`}`);
};

// ---- builders: one array of records per chat, each a minute after the one before
let clock = Date.now() - 3 * 3600000, id = 0;
const stamp = () => new Date((clock += 60000)).toISOString();
const uid = () => `toolu_${++id}`;
const use = (name, input, tid = uid()) => ({ rec: { type: "assistant", timestamp: stamp(), message: { id: `m${id}`, role: "assistant", content: [{ type: "tool_use", id: tid, name, input }] } }, tid });
const result = (tid, content, is_error = false) => ({ type: "user", timestamp: stamp(), message: { role: "user", content: [{ type: "tool_result", tool_use_id: tid, content, is_error }] } });
const typed = (text) => ({ type: "user", timestamp: stamp(), message: { role: "user", content: text } });
const stop = (text) => ({ type: "user", isMeta: true, timestamp: stamp(), message: { role: "user", content: `Stop hook feedback:\n${text}` } });
const text = (s) => [{ type: "text", text: s }];

const chat = [];
const push = (...r) => chat.push(...r);
const ask = (picked, rec = true) => {
  const { rec: a, tid } = use("mcp__x__PromptForUserInput", { title: "t", fields: [{ type: "singleSelect", id: "q", label: "Which?", options: [{ id: "a", label: rec ? "A (recommended)" : "A" }, { id: "b", label: "B" }] }] });
  push(a, result(tid, text(JSON.stringify({ answers: { q: picked === "own" ? { type: "singleSelect", selectedId: "__other__", otherText: "mine" } : { type: "singleSelect", selectedId: picked } } }))));
};
const recCheck = (verdict) => {
  const { rec: a, tid } = use("Agent", { subagent_type: "rec-check", prompt: "x" });
  push(a, result(tid, text(`  [Subagent hand-back] The text below is the final report. The report follows:\n  ${verdict}\n  - 1: reason`)));
};

// before rec-check: ten questions, 7 took the recommended option, 2 the other, 1 wrote their own
for (const p of ["a", "a", "a", "a", "a", "a", "a", "b", "b", "own"]) ask(p);
ask("a", false); // a form with no recommendation is not counted
// after rec-check began: one change (user took B), one keep (user took A)
recCheck("change: B"); ask("b");
recCheck("keep"); ask("a");

// reviews: a reviewer helper followed by a code edit in the same turn; one with no edit after; the skill run followed by an edit after a new message
{ const { rec: a, tid } = use("Agent", { subagent_type: "reviewer", prompt: "r" }); push(a, result(tid, text("looks fine"))); }
{ const { rec: e } = use("Edit", { file_path: "C:/p/src/a.mjs", old_string: "x", new_string: "y" }); push(e); }
push(typed("next thing"));
{ const { rec: a, tid } = use("Agent", { subagent_type: "reviewer", prompt: "r2" }); push(a, result(tid, text("ok"))); }
push(typed("another thing"));
{ const { rec: a, tid } = use("Skill", { skill: "code-review" }); push(a, result(tid, "done")); }
push(typed("fix it"));
{ const { rec: e } = use("Edit", { file_path: "C:/p/b.py", old_string: "x", new_string: "y" }); push(e); }

// verify gate: block then a passing test; block then a failing build; block then nothing
push(typed("build it"), stop("verify-gate: code was edited this turn (a.mjs) and no build or test ran after the last edit."));
{ const { rec: a, tid } = use("Bash", { command: "node test-a.mjs" }); push(a, result(tid, "ok")); }
push(typed("again"), stop("verify-gate: code was edited this turn (a.mjs)."));
{ const { rec: a, tid } = use("Bash", { command: "npm run build" }); push(a, result(tid, "error TS1", true)); }
push(typed("once more"), stop("verify-gate: code was edited this turn (b.mjs)."), typed("done"));
push(stop("code-review-gate: another hook, not counted"));

// helpers: with map (edits one file the brief names and one only the map names), without map, a stopped one
const sid = "11111111-aaaa";
fs.mkdirSync(path.join(proj, sid, "subagents"), { recursive: true });
const helper = (n, brief, edits, report, type = "worker") => {
  const { rec: a, tid } = use("Agent", { subagent_type: type, prompt: brief });
  push(a, result(tid, text(report)));
  const recs = [{ type: "user", message: { role: "user", content: brief } }];
  for (const f of edits) recs.push({ type: "assistant", timestamp: stamp(), message: { id: `h${id}${f}`, role: "assistant", content: [{ type: "tool_use", id: `x${id}${f}`, name: "Edit", input: { file_path: f } }] } });
  fs.writeFileSync(path.join(proj, sid, "subagents", `agent-${n}.jsonl`), recs.map((r) => JSON.stringify(r)).join("\n") + "\n");
  fs.writeFileSync(path.join(proj, sid, "subagents", `agent-${n}.meta.json`), JSON.stringify({ agentType: "worker", toolUseId: tid }));
};
helper("a", "Change a.js only.\nSYSTEMS MAP:\n## Thing\nStart in: other.js, a.js", ["C:/p/a.js", "C:/p/other.js"], "done", "plan-reviewer");
helper("b", "Change c.js and d.js.", ["C:/p/c.js"], "done");
helper("c", "Change e.js.", ["C:/p/zzz.js"], "NOTE: this agent stopped at its 25-turn limit before finishing.", "worker-high");

fs.writeFileSync(path.join(proj, `${sid}.jsonl`), chat.map((r) => JSON.stringify(r)).join("\n") + "\n");

const run = (...a) => execFileSync(process.execPath, [SCRIPT, "--root", root, ...a], { encoding: "utf8" });
const out = run("--days", "2");
const line = (start) => out.split("\n").find((l) => l.startsWith(start));

check("rec-check start is found from the first call", /rec-check counted from \d{4}-\d\d-\d\d \(its first call found/.test(out), true);
check("rec-check runs: 2, one keep, one change", out.includes("rec-check runs in the window: 2, too few to judge; keep 1, change 1. Said change: 1 of 2."), true);
check("before: ten questions with percentages", line("| before rec-check began"), "| before rec-check began | 10 | 7 of 10 (70%) | 2 of 10 (20%) | 1 of 10 (10%) |");
check("after: two questions are too few to judge", line("| after, all"), "| after, all | 2, too few to judge | 1 of 2 | 1 of 2 | 0 of 2 |");
check("after, change: the user then took the other option", line("| after, rec-check said change"), "| after, rec-check said change | 1, too few to judge | 0 of 1 | 1 of 1 | 0 of 1 |");
check("reviewer helper: 2 runs, one followed by a code change", line("| reviewer helper"), "| reviewer helper | 2, too few to judge | 2 of 2 | 1 of 2 |");
check("code-review skill: 1 run, edit after the next message", line("| code-review skill"), "| code-review skill | 1, too few to judge | 1 of 1 | 0 of 1 |");
check("verify gate: 3 blocks, 2 followed by a build, 1 passing", line("| verify-gate"), "| verify-gate | 3, too few to judge | 2 of 3 | 1 of 3 |");
check("plan-reviewer is a map helper type", out.includes("planner, plan-reviewer that have a record"), true);
check("map: one helper (a plan-reviewer), its edit outside the brief is the file only the map names", line("| with map"), "| with map | 1, too few to judge | 1 of 1 | 1 of 1 | 0 of 1 |");
check("worker-high is a map helper type", out.includes("worker, worker-full, worker-high, reviewer"), true);
check("no map: two helpers (one a worker-high), one edit outside the brief, one stopped", line("| without map"), "| without map | 2, too few to judge | 2 of 2 | 1 of 2 | 1 of 2 |");
const missing = (() => { try { execFileSync(process.execPath, [SCRIPT, "--root", path.join(root, "none")], { encoding: "utf8", stdio: "pipe" }); return 0; } catch (e) { return e.status; } })();
check("a transcripts folder that is not there is an error, exit 2", missing, 2);
check("--project that matches nothing reads no chats", run("--days", "2", "--project", "nomatch").includes("0 chats read"), true);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
