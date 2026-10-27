#!/usr/bin/env node
// Tests for web-worker-gate (PreToolUse: refuses ask.mjs --web) and web-answer-gate (Stop: refuses a
// reply that hedges about availability without checking, or lists fewer things than were asked for).
// Run: node test-web-gates.mjs
import { spawnSync } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath, pathToFileURL } from "node:url";

const WORKER_HOOK = fileURLToPath(new URL("../hooks/web-worker-gate.mjs", import.meta.url));
const ANSWER_HOOK = fileURLToPath(new URL("../hooks/web-answer-gate.mjs", import.meta.url));
const { offending, reason: workerReason } = await import(pathToFileURL(WORKER_HOOK).href);
const {
  hedgeProblem, countProblem, wantedCount, listedCount, checkedASource, visibleProse,
} = await import(pathToFileURL(ANSWER_HOOK).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
};

// ---------------- web-worker-gate: which commands are refused ----------------

const REFUSED = [
  `node ~/.claude/workers/ask.mjs --web "latest postgres version"`,
  `~/.claude/workers/ask.mjs --web /tmp/task.txt`,
  `cd /c/Projects/x && node ~/.claude/workers/ask.mjs --web "find 12 mods" > out.txt`,
  `timeout 280 node ~/.claude/workers/ask.mjs --web "x"`,
  `node "./workers/ask.mjs" --think --web "x"`,
  `node ask.mjs --web "x"`,
];
for (const cmd of REFUSED) ok(`refuses: ${cmd.slice(0, 48)}`, offending(cmd) !== "");

const ALLOWED = [
  `node ~/.claude/workers/ask.mjs "read C:/x/big.md and summarise"`,  // local files still fine
  `node ~/.claude/workers/ask.mjs --status`,
  `~/.claude/workers/ask.mjs --status | sed -n 3p`,
  `node ~/.claude/workers/versions.mjs postgresql --has 18`,
  `curl -s https://endoflife.date/api/v1/products/postgresql/`,
  `grep -rn "ask.mjs --web" docs/`,                                   // writing about it is not running it
  `echo "the rule says not to use ask.mjs --web any more"`,
];
for (const cmd of ALLOWED) ok(`allows: ${cmd.slice(0, 48)}`, offending(cmd) === "", `got "${offending(cmd)}"`);

ok("refusal names the version checker", /versions\.mjs/.test(workerReason("x")));
ok("refusal names the off switch", /WEB_WORKER_GATE=off/.test(workerReason("x")));
ok("refusal gives the measured reason", /72 such calls|29 gave nothing/.test(workerReason("x")));
ok("refusal does not repeat the inflated grep count", !/101/.test(workerReason("x")));

// A shell line can hold several commands: exempting the whole line on its first word let the real call through
const SNEAKY = [
  `echo start && node ~/.claude/workers/ask.mjs --web "x"`,
  `cat q.txt; node ~/.claude/workers/ask.mjs --web "x"`,
  `ls && ~/.claude/workers/ask.mjs --web /tmp/q.txt`,
  `grep -q foo bar.txt || node ~/.claude/workers/ask.mjs --web "x"`,
  `head -1 f.txt | node ~/.claude/workers/ask.mjs --web "x"`,
];
for (const cmd of SNEAKY) ok(`refuses behind a text tool: ${cmd.slice(0, 40)}`, offending(cmd) !== "", `got ""`);

const STILL_ALLOWED = [
  `echo "do not use ask.mjs --web" && node run.mjs`,
  `grep -rn "ask.mjs --web" docs/ && echo done`,
  `node ~/.claude/workers/ask.mjs --status && echo ok`,
  `cat notes.md; node ~/.claude/workers/ask.mjs "read ./big.md"`,
];
for (const cmd of STILL_ALLOWED) ok(`still allows: ${cmd.slice(0, 44)}`, offending(cmd) === "", `got "${offending(cmd)}"`);

// The real hook process, end to end
const runHook = (hook, input, env = {}) => {
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify(input), encoding: "utf8", env: { ...process.env, ...env },
  });
  return { out: r.stdout.trim(), status: r.status };
};

{
  const { out } = runHook(WORKER_HOOK, { tool_name: "Bash", tool_input: { command: `node ~/.claude/workers/ask.mjs --web "x"` } });
  const parsed = out ? JSON.parse(out) : null;
  ok("hook denies a --web call", parsed?.hookSpecificOutput?.permissionDecision === "deny", out.slice(0, 120));
}
{
  const { out } = runHook(WORKER_HOOK, { tool_name: "Bash", tool_input: { command: `node ~/.claude/workers/ask.mjs "local file job"` } });
  ok("hook stays silent for a local-file call", out === "", out.slice(0, 120));
}
{
  const { out } = runHook(WORKER_HOOK,
    { tool_name: "Bash", tool_input: { command: `node ~/.claude/workers/ask.mjs --web "x"` } }, { WEB_WORKER_GATE: "off" });
  ok("off switch works", out === "", out.slice(0, 120));
}
{
  const { out, status } = runHook(WORKER_HOOK, { tool_name: "Bash" }); // no command at all
  ok("fails open on a missing command", out === "" && status === 0);
}

// ---------------- web-answer-gate: the hedge check ----------------

const NO_TOOLS = [];
const CHECKED = [{ name: "WebFetch", input: { url: "https://www.postgresql.org/" } }];
const CHECKED_CURL = [{ name: "Bash", input: { command: "curl -s https://endoflife.date/api/v1/products/postgresql/" } }];
const CHECKED_VERSIONS = [{ name: "Bash", input: { command: "node ~/.claude/workers/versions.mjs postgresql --has 18" } }];
const UNRELATED = [{ name: "Read", input: { file_path: "C:/x/y.md" } }, { name: "Bash", input: { command: "git status" } }];

const HEDGING = [
  "PostgreSQL 18 may not be available for your setup yet.",
  "That version might not be released for Forge 1.20.1.",
  "This package does not appear to exist on npm.",
  "The 3.11 build is not available for 1.20.1, as far as I know.",
  "I could not confirm whether a Forge build exists.",
  "There may not be a release that supports this.",
  "The mod might not have a 1.20.1 build.",
];
for (const text of HEDGING) {
  ok(`hedge caught: ${text.slice(0, 40)}`, hedgeProblem(text, NO_TOOLS) !== null);
  ok(`hedge allowed once checked: ${text.slice(0, 28)}`, hedgeProblem(text, CHECKED) === null);
}
ok("a curl to a fact source counts as checking", hedgeProblem(HEDGING[0], CHECKED_CURL) === null);
ok("versions.mjs counts as checking", hedgeProblem(HEDGING[0], CHECKED_VERSIONS) === null);
ok("an unrelated tool does not count as checking", hedgeProblem(HEDGING[0], UNRELATED) !== null);
ok("a cited source URL is allowed to say absent",
  hedgeProblem("18.6 is current; 19 may not be available as stable yet - https://endoflife.date/postgresql", NO_TOOLS) === null);

const FINE = [
  "PostgreSQL 18.6 is current, released 2026-08-11.",
  "I installed it and the tests pass.",
  "The file may not be there, so the script checks first.",   // not about availability of a release
  "This might not be the fastest approach, but it works.",
  "Done - the hook now blocks that command.",
  // Ordinary coding prose: these were all blocked before the sentence check went in
  "The directory may not exist, so mkdir -p runs first.",
  "That column might not exist in the staging table.",
  "There may not be a test for this path yet.",
  "I could not confirm whether the hook fired, so I added a log line.",
  "The env var may not be set in a fresh shell.",
  "A cached session may not exist on the first run.",
  "This branch might not have the commit yet.",
  "The endpoint may not be reachable from the sandbox.",
];
for (const text of FINE) ok(`no false hedge: ${text.slice(0, 44)}`, hedgeProblem(text, NO_TOOLS) === null,
  `blocked on "${hedgeProblem(text, NO_TOOLS)}"`);

// A release hedge still blocks even when the reply also talks about files and tests
ok("a release hedge in a long reply still blocks",
  hedgeProblem("I updated the hook and the tests pass.\nPostgreSQL 19 may not be available yet.", NO_TOOLS) !== null);
ok("a code hedge next to release talk does not block",
  hedgeProblem("I bumped the package version to 2.1.0. The output directory may not exist, so it is created.", NO_TOOLS) === null,
  `blocked on "${hedgeProblem("I bumped the package version to 2.1.0. The output directory may not exist, so it is created.", NO_TOOLS)}"`);

ok("a hedge inside a code block is not this reply's claim",
  hedgeProblem("Here is the log:\n```\nwarning: may not be available\n```\nAll good.", NO_TOOLS) === null);
ok("visibleProse drops fenced blocks", !visibleProse("a\n```\nsecret\n```\nb").includes("secret"));
ok("checkedASource sees WebSearch", checkedASource([{ name: "WebSearch", input: { query: "x" } }]));

// ---------------- web-answer-gate: the count check ----------------

ok("wantedCount: give me 10 examples", wantedCount("give me 10 examples of SQL linters") === 10);
ok("wantedCount: find 12 mods", wantedCount("Find 12 Minecraft mods for Forge 1.20.1") === 12);
ok("wantedCount: a range takes the lower end", wantedCount("Find 8-12 resource packs for the dragon") === 8);
ok("wantedCount: 10 examples with no verb", wantedCount("I want 10 options for this") === 10);
ok("wantedCount: list 5 alternatives", wantedCount("list 5 alternatives to sqlfluff") === 5);

// This hook is about web research: a number in any other kind of ask must not arm the count check
ok("wantedCount ignores: show me 5 rows", wantedCount("show me 5 rows from that table") === 0);
ok("wantedCount ignores: 10 reasons this is slow", wantedCount("give me 10 reasons this is slow") === 0);
ok("wantedCount ignores: list 4 columns", wantedCount("list 4 columns I should add") === 0);
ok("wantedCount ignores: 3 ways to refactor this function", wantedCount("give me 3 ways to refactor this function") === 0);
ok("wantedCount ignores: write 5 tests", wantedCount("write 5 tests for the hook") === 0);
ok("wantedCount still fires on research with a noun that could be either",
  wantedCount("find me 6 libraries that do this") === 6);

ok("wantedCount ignores: fix the 3 tests", wantedCount("fix the 3 failing tests") === 0);
ok("wantedCount ignores: 2 bugs", wantedCount("there are 2 bugs in this file, find them") === 0);
ok("wantedCount ignores: took 5 minutes", wantedCount("the search took 5 minutes and found nothing") === 0);
ok("wantedCount ignores a plain question", wantedCount("what is the latest postgres version?") === 0);
ok("wantedCount ignores a huge number", wantedCount("find 500 examples") === 0);
ok("wantedCount ignores one or two", wantedCount("give me 1 example") === 0);

ok("listedCount counts bullets", listedCount("- a\n- b\n- c") === 3);
ok("listedCount counts a numbered list", listedCount("1. a\n2. b\n3. c\n4. d") === 4);
ok("listedCount counts table rows, not the header",
  listedCount("| Name | Use |\n|---|---|\n| a | x |\n| b | y |") === 2);
ok("listedCount takes the larger of list and table, not the sum",
  listedCount("| N |\n|---|\n| a |\n| b |\n| c |\n\n- caveat one\n- caveat two") === 3);
ok("listedCount ignores a fenced block", listedCount("```\n- not an item\n- nor this\n```\n- real one") === 1);

{
  const prompt = "give me 10 examples of open source SQL linters";
  const short = "Here are a few:\n- SQLFluff\n- sqruff\n- sql-formatter";
  const p = countProblem(prompt, short, NO_TOOLS);
  ok("count caught: 3 of 10", p && p.want === 10 && p.got === 3, JSON.stringify(p));

  const full = Array.from({ length: 10 }, (_, i) => `- tool ${i + 1}`).join("\n");
  ok("count fine: 10 of 10", countProblem(prompt, full, NO_TOOLS) === null);

  const owned = "I found only 6 that are still maintained. I searched the npm registry, GitHub topics and PyPI.\n" +
    Array.from({ length: 6 }, (_, i) => `- tool ${i + 1}`).join("\n");
  ok("count fine when the shortfall is owned and sourced", countProblem(prompt, owned, NO_TOOLS) === null);

  const halfOwned = "I found only 6.\n" + Array.from({ length: 6 }, (_, i) => `- tool ${i + 1}`).join("\n");
  ok("count still blocks when it says how many but not where it looked",
    countProblem(prompt, halfOwned, NO_TOOLS) !== null);

  ok("count skipped when the turn asked the user a question",
    countProblem(prompt, short, [{ name: "mcp__nimbalyst__PromptForUserInput", input: {} }]) === null);
  ok("count skipped when nothing was asked for", countProblem("fix the bug", short, NO_TOOLS) === null);
}

// The real Stop hook over a transcript
{
  const dir = mkdtempSync(join(tmpdir(), "web-gate-"));
  const t = join(dir, "t.jsonl");
  const lines = [
    { type: "user", message: { content: "give me 10 examples of SQL linters" } },
    { type: "assistant", message: { content: [{ type: "text", text: "Here are a few:\n- SQLFluff\n- sqruff" }] } },
  ].map((o) => JSON.stringify(o)).join("\n");
  writeFileSync(t, lines);

  const { out } = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir });
  const parsed = out ? JSON.parse(out) : null;
  ok("Stop hook blocks a 2-of-10 reply", parsed?.decision === "block", out.slice(0, 160));
  ok("the block says the numbers", /asked for 10; this reply lists 2/.test(parsed?.reason || ""), (parsed?.reason || "").slice(0, 160));

  const quiet = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir, stop_hook_active: true });
  ok("silent when stop_hook_active", quiet.out === "");

  const offRun = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir }, { WEB_ANSWER_GATE: "off" });
  ok("WEB_ANSWER_GATE=off works", offRun.out === "");

  const countOff = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir }, { COUNT_CHECK: "off" });
  ok("COUNT_CHECK=off works", countOff.out === "");

  const missing = runHook(ANSWER_HOOK, { transcript_path: join(dir, "nope.jsonl"), cwd: dir });
  ok("fails open on a missing transcript", missing.out === "" && missing.status === 0);
}

// An injected entry is not the user's prompt: a Stop hook's own feedback sits in the transcript as a
// user message, and reading it as the ask makes both checks judge the wrong text.
{
  const dir = mkdtempSync(join(tmpdir(), "web-gate-meta-"));
  const t = join(dir, "t.jsonl");
  writeFileSync(t, [
    { type: "user", message: { content: "give me 10 examples of SQL linters" } },
    { type: "assistant", message: { content: [{ type: "text", text: "- SQLFluff\n- sqruff" }] } },
    { type: "user", isMeta: true, message: { content: "Stop hook feedback: code-review-gate: run the review" } },
  ].map((o) => JSON.stringify(o)).join("\n"));
  const { out } = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir });
  const parsed = out ? JSON.parse(out) : null;
  ok("the real prompt is found past an injected entry", parsed?.decision === "block", out.slice(0, 140));
  ok("and the count is judged against it", /asked for 10/.test(parsed?.reason || ""));
}
{
  // The injected text itself must not arm the count check
  const dir = mkdtempSync(join(tmpdir(), "web-gate-meta2-"));
  const t = join(dir, "t.jsonl");
  writeFileSync(t, [
    { type: "user", message: { content: "tidy up the hook" } },
    { type: "user", isMeta: true, message: { content: "Stop hook feedback: this turn changed 8 code files, find 10 examples" } },
    { type: "assistant", message: { content: [{ type: "text", text: "Done, the hook is tidier." }] } },
  ].map((o) => JSON.stringify(o)).join("\n"));
  const { out } = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir });
  ok("an injected ask does not arm the count check", out === "", out.slice(0, 140));
}

// A hedging reply with a tool call recorded in the transcript must pass
{
  const dir = mkdtempSync(join(tmpdir(), "web-gate2-"));
  const t = join(dir, "t.jsonl");
  writeFileSync(t, [
    { type: "user", message: { content: "is postgres 19 out?" } },
    { type: "assistant", message: { content: [{ type: "tool_use", name: "WebFetch", input: { url: "https://www.postgresql.org/" } }] } },
    { type: "assistant", message: { content: [{ type: "text", text: "19 may not be available as a stable release yet." }] } },
  ].map((o) => JSON.stringify(o)).join("\n"));
  const { out } = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir });
  ok("a hedge passes when the turn really checked", out === "", out.slice(0, 160));
}

// The same hedge with no check must block
{
  const dir = mkdtempSync(join(tmpdir(), "web-gate3-"));
  const t = join(dir, "t.jsonl");
  writeFileSync(t, [
    { type: "user", message: { content: "is postgres 19 out?" } },
    { type: "assistant", message: { content: [{ type: "text", text: "19 may not be available as a stable release yet." }] } },
  ].map((o) => JSON.stringify(o)).join("\n"));
  const { out } = runHook(ANSWER_HOOK, { transcript_path: t, cwd: dir });
  const parsed = out ? JSON.parse(out) : null;
  ok("the same hedge blocks with no check", parsed?.decision === "block", out.slice(0, 160));
  ok("the block names versions.mjs", /versions\.mjs/.test(parsed?.reason || ""));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
