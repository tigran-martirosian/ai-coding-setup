// Tests for ~/.claude/skills/setup-audit/scripts/usage-scan.mjs on a made-up transcripts folder.
// Run: node test-usage-scan.mjs
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";

const SCRIPT = fileURLToPath(new URL("../skills/setup-audit/scripts/usage-scan.mjs", import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), "usage-scan-test-"));
const proj = path.join(root, "C--Projects-demo");
fs.mkdirSync(path.join(proj, "s1", "subagents"), { recursive: true });

const T0 = Date.parse("2026-09-30T05:00:00Z");
const at = (min) => new Date(T0 + min * 60000).toISOString();
const usage = (inp, cr, out) => ({ input_tokens: inp, cache_creation_input_tokens: 0, cache_read_input_tokens: cr, output_tokens: out });
const asst = (min, id, u, content = [], model = "claude-opus-5-5") =>
  ({ type: "assistant", timestamp: at(min), message: { id, model, usage: u, content } });
const bash = (id, command, extra = {}) => ({ type: "tool_use", id, name: "Bash", input: { command, description: id, ...extra } });
const result = (min, id, text, is_error = false) =>
  ({ type: "user", timestamp: at(min), message: { content: [{ type: "tool_result", tool_use_id: id, content: text, is_error }] } });
const write = (file, lines) => fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");

const wrapper = `run() { codex --search exec --skip-git-repo-check "$1" < /dev/null > "$2.txt"; }\nrun "a" x & run "b" y & run "c" z & wait`;
write(path.join(proj, "s1.jsonl"), [
  { type: "ai-title", aiTitle: "Demo session" },
  // same message id on two lines (two content blocks): counted once
  asst(0, "m1", usage(10, 1000, 90), [{ type: "text", text: "hi" }]),
  asst(0, "m1", usage(10, 1000, 90), [bash("b1", "cd x; codex exec --skip-git-repo-check 'q' < /dev/null")]),
  result(1, "b1", "answer\ntokens used\n1,234\nanswer"),
  asst(2, "m2", usage(0, 2000, 0), [bash("b2", wrapper)]),
  result(3, "b2", "done"),
  // mentions codex exec only as text inside sed: not a worker run
  asst(4, "m3", usage(0, 3000, 0), [bash("b3", "sed -i 's/codex exec -s/codex exec --skip -s/' f.md")]),
  result(4, "b3", ""),
  asst(5, "m4", usage(0, 4000, 0), [{ type: "tool_use", id: "a1", name: "Agent", input: { subagent_type: "Explore", prompt: "find" } }]),
  result(5, "a1", "PreToolUse:Agent hook error: [worker-nudge] Search/research subagents cost...", true),
  asst(6, "m5", usage(0, 5000, 0), [bash("b4", "agy -p 'read big.ts' --mode plan"),
    bash("b5", "~/.claude/workers/ask-codex.sh --web /tmp/task.txt"),
    // the worker command: counted under the worker that answered; --status is not a worker run
    bash("b6", '~/.claude/workers/ask.mjs --web "who won"'),
    bash("b7", '~/.claude/workers/ask.mjs "read big.ts"'),
    bash("b8", "~/.claude/workers/ask.mjs --status"),
    bash("b9", "~/.claude/workers/ask.mjs --web /tmp/task.txt")]),
  result(7, "b4", "ok"),
  result(7, "b5", "ok"),
  result(7, "b6", "[ask] answered by Codex (ChatGPT login)\nSpain."),
  result(7, "b7", "[ask] answered by Antigravity (gemini-3.8-flash-medium)\nIt has 3 functions."),
  result(7, "b8", "Web research (--web), in this order:"),
  result(7, "b9", "[ask] no free worker could answer. Do it with Claude instead"),
  // after minute 30: outside a --minutes 30 window
  asst(45, "m6", usage(0, 100000, 0), [
    { type: "tool_use", id: "k1", name: "Skill", input: { skill: "handoff" } },
    { type: "tool_use", id: "x1", name: "mcp__demo__lookup", input: {} },
    { type: "tool_use", id: "x2", name: "mcp__demo__fetch", input: {} },
  ]),
]);
write(path.join(proj, "s1", "subagents", "agent-x.jsonl"), [
  asst(10, "s-m1", usage(5, 500, 5), [], "claude-sonnet-5-5"),
  asst(50, "s-m2", usage(0, 700, 0), [], "claude-sonnet-5-5"),
]);
fs.writeFileSync(path.join(proj, "s1", "subagents", "agent-x.meta.json"), JSON.stringify({ agentType: "copy-humanizer" }));

const run = (...a) => JSON.parse(execFileSync("node", [SCRIPT, "--root", root, "--json", ...a], { encoding: "utf8" }));
let pass = 0, fail = 0;
const check = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) { pass++; console.log(`ok   ${name}`); }
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

const full = run("--session", "s1");
const s = full.sessions[0];
check("main tokens deduped by message id", s.main, 1100 + 2000 + 3000 + 4000 + 5000 + 100000);
check("main calls", s.calls, 6);
check("title", s.title, "Demo session");
check("max context", s.maxContext, 100000);
check("subagent type from meta", s.subagents[0].type, "copy-humanizer");
check("subagent tokens", s.subagents[0].tokens, 510 + 700);
check("total = main + subagents", full.totals.tokens, s.main + 1210);
check("codex processes (1 direct + 3 via shell function + 1 ask-codex.sh + 1 answered through ask.mjs, sed ignored)", full.workers.codexProcesses, 6);
check("agy processes (1 direct + 1 answered through ask.mjs)", full.workers.agyProcesses, 2);
check("worker shell calls (ask.mjs --status is not one)", full.workers.calls, 7);
check("an ask.mjs call no worker answered is counted as failed", full.workers.list.filter((w) => w.worker === "none" && !w.ok).length, 1);
check("web flag on the shell function call, ask-codex.sh --web and both ask.mjs --web calls", full.workers.list.filter((w) => w.web).length, 4);
check("hook block counted", full.hooks["worker-nudge"]?.blocks, 1);
check("next step after block", full.hooks["worker-nudge"]?.next, { worker: 1 });
// fields the dashboard reads
const dayTotal = (days) => Object.values(days).flatMap(Object.values).reduce((a, b) => a + b, 0);
check("per-day tokens add up to main", dayTotal(s.days), s.main);
check("per-day tokens add up for a subagent", dayTotal(s.subagents[0].days), 1210);
check("per-day tokens are split by model", [...new Set(Object.values(s.subagents[0].days).flatMap(Object.keys))], ["claude-sonnet-5-5"]);
// API-price equivalent: Opus 5.5 is $4 in, $20 out, $0.20 cache read per million; Sonnet 5.5 $2, $10, $0.20
const usdTotal = (usd) => Math.round(Object.values(usd).reduce((a, b) => a + b, 0) * 1e4) / 1e4;
check("dollars at API prices, main chat", usdTotal(s.usd), Math.round((10 * 4 + 90 * 20 + 115000 * 0.2) / 1e6 * 1e4) / 1e4);
check("dollars at API prices, subagent on another model", usdTotal(s.subagents[0].usd), Math.round((5 * 2 + 5 * 10 + 1200 * 0.2) / 1e6 * 1e4) / 1e4);
check("total dollars is a number", typeof full.totals.usd, "number");
check("session lists its worker calls with a start time", s.workers.map((w) => typeof w.at), Array(7).fill("string"));
check("short project name", s.name, "demo");
check("Codex token count read from the result, null when missing", s.workers.map((w) => w.tokens), [1234, null, null, null, null, null, null]);
// what gets used (the unused-inventory part of the audit)
check("tool calls, MCP tools grouped per server", full.use.tools, { Bash: 9, "demo (MCP)": 2, Agent: 1, Skill: 1 });
check("skill uses", full.use.skills, { handoff: 1 });
check("subagent starts by type", full.use.agents, { Explore: 1 });
check("tokens by model", full.use.models, { "claude-opus-5-5": 115100, "claude-sonnet-5-5": 1210 });
check("first-call size and big-session counts", [full.use.firstCall, full.use.over200k], [{ median: 1010, max: 1010 }, 0]);

const win = run("--session", "s1", "--minutes", "30");
check("--minutes cuts main", win.sessions[0].main, 15100);
check("--minutes cuts subagent", win.sessions[0].subagents[0].tokens, 510);

const days = run("--since", "2026-09-30T00:00:00Z", "--until", "2026-09-30T05:20:00Z", "--project", "demo");
check("--since/--until window", days.totals.mainTokens, 15100);
check("--project filter excludes others", run("--project", "nomatch", "--days", "10000").totals.sessions, 0);

// Wasted requests: own project so the cases above stay as they are
const tool = (id, name, input = {}) => ({ type: "tool_use", id, name, input });
const user = (min, text) => ({ type: "user", timestamp: at(min), message: { content: text } });
const blocked = (why) => `PreToolUse:Bash hook error: [node hook]: command-explain: ${why}`;
fs.mkdirSync(path.join(root, "C--Projects-waste"));
write(path.join(root, "C--Projects-waste", "w1.jsonl"), [
  user(0, "fix the thing please"),
  asst(1, "w-m1", usage(0, 1000, 1), [tool("w1", "Bash")]), result(1, "w1", blocked("Command is too long"), true),
  asst(2, "w-m2", usage(0, 2000, 1), [tool("w2", "Bash")]), result(2, "w2", "boom", true),
  asst(3, "w-m3", usage(0, 3000, 1), [tool("w3", "Bash")]), result(3, "w3", blocked("no explanation line"), true),
  asst(4, "w-m4", usage(0, 4000, 1), [tool("w4", "mcp__nimbalyst__update_session_meta", { phase: "complete" })]), result(4, "w4", "ok"),
  asst(5, "w-m5", usage(0, 5000, 1), [tool("w5", "mcp__nimbalyst__update_session_meta", { add: ["x"] })]), result(5, "w5", "ok"),
  asst(6, "w-m6", usage(0, 6000, 1), [tool("w6", "ToolSearch")]), result(6, "w6", "ok"),
  // not an error, only quotes a block message (a file read): not a block
  asst(7, "w-m7", usage(0, 7000, 1), [tool("w7", "Read")]), result(7, "w7", blocked("Command is too long")),
  // one message id on two lines: one request, usage of the last line
  asst(7, "w-m9", usage(0, 50, 1), [{ type: "text", text: "a" }]),
  asst(7, "w-m9", usage(0, 70, 3), [{ type: "text", text: "b" }]),
  user(8, "second message"),
  asst(9, "w-m8", usage(0, 100, 1), [{ type: "text", text: "ok" }]),
]);
const X = run("--project", "waste", "--days", "10000").wasted;
check("wasted: requests per message", [X.turnCount, X.requestsPerMessage], [2, { median: 8, max: 8 }]);
check("wasted: per project", X.perProject, { waste: { messages: 2, median: 8, max: 8 } });
check("wasted: longest turn", X.longestTurns.map((t) => [t.requests, t.tokens, t.text]), [[8, 28070, "fix the thing please"], [1, 100, "second message"]]);
check("wasted: one failure streak of 3", [X.streakCount, X.longestStreak, X.worstStreaks.map((k) => [k.n, k.tool])], [1, 3, [[3, "Bash"]]]);
check("wasted: hook blocks with the blocked request's tokens", X.hooks["command-explain"], { blocks: 2, tokens: 4000 });
check("wasted: command-explain by reason", X.commandExplain, { "too long": { blocks: 1, tokens: 1000 }, "no note (or no empty line before it)": { blocks: 1, tokens: 3000 } });
check("wasted: board-only requests split", X.boardOnly, { complete: { n: 1, tokens: 4000 }, other: { n: 1, tokens: 5000 } });
check("wasted: ToolSearch-only requests", X.toolSearchOnly, { n: 1, tokens: 6000 });
check("wasted: token split", X.tokens, { input: 0, cacheWrite: 0, cacheRead: 28170, output: 11 });

// Wake-up turns, background launches, after-commit tail, big subagent runs: own project
fs.mkdirSync(path.join(root, "C--Projects-wake", "k1", "subagents"), { recursive: true });
write(path.join(root, "C--Projects-wake", "k1.jsonl"), [
  user(0, "build it"),
  asst(1, "k-m1", usage(0, 120000, 1), [tool("k1", "Bash", { command: "sleep 9", run_in_background: true })]), result(1, "k1", "started"),
  asst(2, "k-m2", usage(0, 121000, 1), [tool("k2", "Bash", { command: "cd x && git commit -m done" })]), result(2, "k2", "ok"),
  asst(3, "k-m3", usage(0, 122000, 1), [{ type: "text", text: "committed" }]),
  { ...user(4, "<task-notification>\n<task-id>x</task-id>"), origin: { kind: "task-notification" } },
  asst(5, "k-m4", usage(0, 123000, 1), [tool("k3", "Agent", { run_in_background: true, prompt: "p" })]), result(5, "k3", "started"),
  user(6, "[System: background task(s) you launched have settled:\n- sleep"),
  asst(7, "k-m5", usage(0, 124000, 1), [tool("k4", "Bash", { command: "echo git commit is not run" })]), result(7, "k4", "ok"),
  user(8, "thanks"),
  asst(9, "k-m6", usage(0, 125000, 1), [{ type: "text", text: "bye" }]),
]);
write(path.join(root, "C--Projects-wake", "k1", "subagents", "big.jsonl"), [asst(1, "k-s1", usage(0, 160000, 0)), asst(2, "k-s2", usage(0, 170000, 0))]);
write(path.join(root, "C--Projects-wake", "k1", "subagents", "small.jsonl"), [asst(1, "k-s3", usage(0, 10000, 0))]);
const K = run("--project", "wake", "--days", "10000").wasted;
check("wasted: wake-up turns by origin and by text", K.wake, { n: 2, tokens: 123000 + 124000, perProject: { wake: { n: 2, tokens: 247000 } } });
check("wasted: background launches", K.background, { n: 2, perProject: { wake: 2 } });
check("wasted: after-commit tail (last commit is k-m2; the echo does not count)", { ...K.afterCommit, perSession: undefined }, { sessions: 1, withCommit: 1, requests: 4, tokens: 122000 + 123000 + 124000 + 125000 });
check("wasted: big subagent runs", [K.bigSubagents.n, K.bigSubagents.tokens, Math.round(K.bigSubagents.share * 1000)], [1, 330000, 971]);

// Wake-up turns by source (tool-use-id link, agent description link) and the after-commit tail per session
fs.mkdirSync(path.join(root, "C--Projects-src"), { recursive: true });
const note = (id, summary, useId) => `<task-notification>\n<task-id>${id}</task-id>\n${useId ? `<tool-use-id>${useId}</tool-use-id>\n` : ""}<status>completed</status>\n<summary>${summary}</summary>\n</task-notification>`;
write(path.join(root, "C--Projects-src", "q1.jsonl"), [
  user(0, "go"),
  asst(1, "q-m1", usage(0, 120000, 1), [tool("q1", "Bash", { command: "sleep 5\n# WHAT THIS DOES: wait for the build now please", run_in_background: true }),
    tool("q2", "Agent", { subagent_type: "Explore", description: "scan it", run_in_background: true })]),
  asst(2, "q-m2", usage(0, 121000, 1), [tool("q3", "Bash", { command: "git commit -m x" })]),
  user(3, note("t1", "Background command &quot;wait&quot; completed", "q1")),
  asst(4, "q-m3", usage(0, 122000, 1), [{ type: "text", text: "build is done" }]),
  user(5, note("t2", 'Agent "scan it" finished')),
  asst(6, "q-m4", usage(0, 123000, 1), [tool("q4", "Read", { file_path: "a" })]),
  asst(7, "q-m5", usage(0, 124000, 1), [{ type: "text", text: "ok" }]),
]);
const Q = run("--project", "src", "--days", "10000").wasted;
check("wasted: wake-up sources and text-only turns", [Q.wakeSources, Q.wakeTextOnly],
  [{ "bash wait for the build": { n: 1, tokens: 122000 }, "agent Explore": { n: 1, tokens: 123000 + 124000 } }, 2]);
check("wasted: after-commit tail per session (no user message after the commit)", Q.afterCommit.perSession,
  [{ project: "src", session: "q1", requests: 3, tokens: 122000 + 123000 + 124000, userMessages: 0, wakeTurns: 2 }]);

// A refusal that arrives as the hook's bare text, with no "PreToolUse:" prefix; a non-error "[x-y]" result is not one
fs.mkdirSync(path.join(root, "C--Projects-bare"), { recursive: true });
write(path.join(root, "C--Projects-bare", "r1.jsonl"), [
  user(0, "read it"),
  asst(1, "r-m1", usage(0, 5000, 1), [tool("r1", "Read", { file_path: "big.md" }), tool("r2", "Bash", { command: "cat notes" })]),
  result(1, "r1", "[big-read-gate] big.md is 500 lines (40 KB).", true),
  result(1, "r2", "[big-read-gate] is the hook's name"),
]);
const R = run("--project", "bare", "--days", "10000");
check("bare-text hook block counted once, under its tool", [R.hooks["big-read-gate"]?.blocks], [1]);

// Settled turns, background launches by kind, tokens per typed user message: own project
fs.mkdirSync(path.join(root, "C--Projects-sett"), { recursive: true });
const settled = (min, item) => user(min, `[System: background task(s) you launched have settled:\n- "${item}" completed\n  Summary: ok`);
const noteLine = (min) => ({ type: "attachment", timestamp: at(min), attachment: { type: "hook_additional_context", content: ["[background-tasks] This settled notice repeats results you already had."] } });
write(path.join(root, "C--Projects-sett", "z1.jsonl"), [
  user(0, "typed one"),
  asst(1, "z-m1", usage(0, 1000, 0), [tool("a1", "Agent", { run_in_background: true }), tool("a2", "Agent", { description: "implicit" }), tool("a3", "Agent", { run_in_background: false }), tool("a4", "Agent", { description: "plain" })]),
  result(1, "a1", "Async agent launched successfully."), result(1, "a2", "Async agent launched successfully."),
  result(1, "a3", "Async agent launched successfully."), result(1, "a4", "the agent finished"),
  asst(2, "z-m2", usage(0, 2000, 0), [tool("b1", "Bash", { command: "sleep 9", run_in_background: true }), tool("b2", "Bash", { command: "sleep 99" }), tool("b3", "Bash", { command: "grep moved log" })]),
  result(2, "b1", "Command running in background with ID: bx1."),
  result(2, "b2", "Command did not complete within its 120s timeout and was moved to the background (ID: bx2)."),
  result(2, "b3", "line: was moved to the background"),
  settled(3, "job A"), noteLine(3),
  asst(4, "z-m3", usage(0, 3000, 0), [tool("c1", "Read", { file_path: "a" })]), result(4, "c1", "ok"),
  asst(5, "z-m4", usage(0, 4000, 0), [{ type: "text", text: "done" }]),
  settled(10, "job A"),
  asst(11, "z-m5", usage(0, 5000, 0), [{ type: "text", text: "done" }]),
  settled(40, "job A"),
  asst(41, "z-m6", usage(0, 6000, 0), [{ type: "text", text: "done" }]),
  user(42, "typed two"),
  asst(43, "z-m7", usage(0, 7000, 0), [{ type: "text", text: "done" }]),
]);
const Z = run("--project", "sett", "--days", "10000").wasted;
check("settled turns: count, requests, tools, with note, repeat within 15 min (the one 30 min later is not)", Z.settled.total, { n: 3, requests: 4, tools: 1, withNote: 1, repeats: 1, tokens: 3000 + 4000 + 5000 + 6000 });
check("settled turns: per project", Z.settled.perProject, { sett: { n: 3, requests: 4, tools: 1, withNote: 1, repeats: 1, tokens: 18000 } });
check("launches: Agent in background (explicit true + implicit async result; run_in_background:false and a plain result are not)", Z.launches.perProject.sett.agent, 2);
check("launches: Bash with run_in_background:true", Z.launches.perProject.sett.bash, 1);
check("launches: Bash moved to the background (a result that only mentions it is not)", Z.launches.perProject.sett.moved, 1);
check("typed messages: count, total tokens, median and mean per message (settled turns belong to the typed message before)", Z.typed.perProject.sett, { typed: 2, tokens: 28000, median: 21000, mean: 14000 });

// Big helper runs (past 150k): background from the parent's call/result, calls before/after the worker-size note, compaction, Bash share; first-call medians
const bigDir = path.join(root, "C--Projects-big");
fs.mkdirSync(path.join(bigDir, "b1", "subagents"), { recursive: true });
write(path.join(bigDir, "b1.jsonl"), [
  user(0, "go"),
  asst(1, "p-m1", usage(0, 40000, 0), [tool("g1", "Agent", { description: "big one", subagent_type: "worker", run_in_background: true }), tool("g2", "Agent", { description: "small one", subagent_type: "reviewer", run_in_background: false })]),
  result(1, "g1", "Async agent launched successfully.\nagentId: abig (internal ID)\nThe agent is working in the background."),
  result(1, "g2", "agentId: asmall (use SendMessage)\nreport"),
]);
const sizeNote = (min) => ({ type: "attachment", timestamp: at(min), attachment: { type: "hook_additional_context", content: ["[worker-size] This helper's context is ~160k tokens and every call re-sends it."] } });
const subCall = (min, id, ctx, name) => asst(min, id, usage(2000, ctx - 2000, 0), [tool("t" + id, name, name === "Bash" ? { command: "x" } : {})], "claude-sonnet-5-5");
write(path.join(bigDir, "b1", "subagents", "agent-abig.jsonl"), [
  subCall(2, "h1", 52000, "Bash"), subCall(3, "h2", 100000, "Bash"), subCall(4, "h3", 160000, "Read"), sizeNote(4),
  subCall(5, "h4", 165000, "Bash"), subCall(6, "h5", 170000, "Bash"),
  { type: "system", subtype: "compact_boundary", timestamp: at(7), content: "Conversation compacted" },
  subCall(8, "h6", 60000, "Bash"),
]);
fs.writeFileSync(path.join(bigDir, "b1", "subagents", "agent-abig.meta.json"), JSON.stringify({ agentType: "worker" }));
write(path.join(bigDir, "b1", "subagents", "agent-asmall.jsonl"), [subCall(2, "k1", 30000, "Read")]);
fs.writeFileSync(path.join(bigDir, "b1", "subagents", "agent-asmall.meta.json"), JSON.stringify({ agentType: "reviewer" }));
const BG = run("--project", "big", "--days", "10000");
check("big helpers: only the run past 150k, with background, tool calls before/after the note, compaction and Bash share",
  BG.bigHelpers.runs.map((r) => [r.id, r.type, r.model, r.background, r.toolCalls, r.noted, r.before, r.after, r.compacts, r.bashShare, r.maxContext]),
  [["agent-abig", "worker", "claude-sonnet-5-5", true, 6, true, 3, 3, 1, 0.833, 170000]]);
check("big helpers: pattern line data", [BG.bigHelpers.pattern.runs, BG.bigHelpers.pattern.background, BG.bigHelpers.pattern.withNote, BG.bigHelpers.pattern.medianAfterNote, BG.bigHelpers.pattern.compacted, BG.bigHelpers.pattern.commonType], [1, 1, 1, 3, 1, "worker 1"]);
check("first-call context: median per project, main sessions and helpers", BG.firstCallByProject, { main: { big: { n: 1, median: 40000 } }, helper: { big: { n: 2, median: 52000 } } });

// Quality: done-claims, redo (typed message within 30 min saying it is not), unchecked (no check after the last edit)
fs.mkdirSync(path.join(root, "C--Projects-qual"), { recursive: true });
const say = (min, id, text, extra = []) => asst(min, id, usage(0, 1000, 1), [...extra, { type: "text", text }]);
write(path.join(root, "C--Projects-qual", "u1.jsonl"), [
  user(0, "add the flag"),
  asst(1, "u-m1", usage(0, 1000, 1), [tool("e1", "Edit", { file_path: "a" })]), result(1, "e1", "ok"),
  asst(2, "u-m2", usage(0, 1000, 1), [bash("c1", "node test-flag.mjs")]), result(2, "c1", "3/3"),
  say(3, "u-m3", "Fixed, the flag works."),
  user(10, "it still doesn't work, same error"), // 7 min later: a redo, and a checked claim
  asst(11, "u-m4", usage(0, 1000, 1), [tool("e2", "Edit", { file_path: "a" })]), result(11, "e2", "ok"),
  say(12, "u-m5", "Done."), // edit, no check: unchecked
  user(15, "thanks, now the docs"), // not a redo
  asst(16, "u-m6", usage(0, 1000, 1), [tool("e3", "Write", { file_path: "d" })]), result(16, "e3", "ok"),
  asst(17, "u-m7", usage(0, 1000, 1), [bash("c2", "npm test")]), result(17, "c2", "ok"),
  say(18, "u-m8", "Docs are done, all tests pass."), // checked
  user(60, "this is wrong"), // 42 min later: outside 30 min, not a redo
  say(61, "u-m9", "Which part?"),
]);
const QU = run("--project", "qual", "--days", "10000").wasted.quality;
check("quality: 3 done-claims, 1 redo (30 min limit holds), 3 with an edit, 1 unchecked, too few to judge", [QU.perProject.qual.claims, QU.perProject.qual.redos, QU.perProject.qual.edited, QU.perProject.qual.unchecked, QU.perProject.qual.tooFew, QU.perProject.qual.redoRate], [3, 1, 3, 1, true, null]);
check("quality: examples carry session and time", [QU.perProject.qual.redoExamples.map((e) => [e.session, e.at]), QU.perProject.qual.uncheckedExamples.map((e) => [e.session, e.at])], [[["u1", at(3)]], [["u1", at(12)]]]);
check("quality: markdown says 'too few to judge' and lists the example", (() => {
  const md = execFileSync("node", [SCRIPT, "--root", root, "--project", "qual", "--days", "10000"], { encoding: "utf8" });
  return [md.includes("| qual | 3 | too few to judge | 3 | too few to judge |"), md.includes("qual u1 " + at(12).slice(0, 16))];
})(), [true, true]);
// ten done-claims: a percentage; every second one is followed by "not fixed", all without a check
fs.mkdirSync(path.join(root, "C--Projects-qual2"), { recursive: true });
write(path.join(root, "C--Projects-qual2", "v1.jsonl"), Array.from({ length: 10 }, (_, i) => [
  user(i * 10, i % 2 ? "not fixed" : "next one"),
  asst(i * 10 + 1, `v-a${i}`, usage(0, 1000, 1), [tool(`v${i}`, "Edit", { file_path: "a" })]), result(i * 10 + 1, `v${i}`, "ok"),
  say(i * 10 + 2, `v-b${i}`, "Done."),
]).flat());
const QV = run("--project", "qual2", "--days", "10000").wasted.quality.perProject.qual2;
check("quality: ten claims give rates (redo 5 of 10: every claim followed by an odd message)", [QV.claims, QV.tooFew, QV.redos, QV.redoRate, QV.unchecked, QV.uncheckedRate], [10, false, 5, 0.5, 10, 1]);

fs.rmSync(root, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
