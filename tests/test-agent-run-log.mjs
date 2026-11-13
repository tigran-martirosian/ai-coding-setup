// Tests for hooks/agent-run-log.mjs: one line per Agent call with the helper's model and effort, and its result (success, partial
// or fail) written onto it when the call ends. Run: node tests/test-agent-run-log.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(
  new URL("../hooks/agent-run-log.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "agent-run-log-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`,
  );
};

// Home agents folder with a worker (sonnet/medium), a planner with only a model and a reviewer at high.
const agents = path.join(tmp, "agents");
fs.mkdirSync(agents);
fs.writeFileSync(
  path.join(agents, "worker.md"),
  "---\nname: worker\nmodel: sonnet\neffort: medium\n---\nbody\n",
);
fs.writeFileSync(
  path.join(agents, "reviewer.md"),
  "---\nmodel: fable\neffort: high\n---\n",
);
fs.writeFileSync(
  path.join(agents, "planner.md"),
  "﻿---\r\nname: planner\r\nmodel: fable\r\n---\r\nbody\r\n",
);
// A project that overrides the worker.
const project = path.join(tmp, "proj");
fs.mkdirSync(path.join(project, ".claude", "agents"), { recursive: true });
fs.writeFileSync(
  path.join(project, ".claude", "agents", "worker.md"),
  "---\nmodel: haiku\neffort: low\n---\n",
);
const bare = path.join(tmp, "bare");
fs.mkdirSync(bare);
// A transcript whose last assistant entry is Opus at high; a cut line first and a later user line.
const transcript = path.join(tmp, "t.jsonl");
fs.writeFileSync(
  transcript,
  [
    '{"cut line',
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-sonnet-5-5" },
      effort: "low",
    }),
    JSON.stringify({
      type: "assistant",
      message: { model: "claude-opus-5-5" },
      effort: "high",
    }),
    JSON.stringify({ type: "user", message: { content: "assistant said" } }),
  ].join("\n") + "\n",
);

const run = (event, env = {}, log = path.join(tmp, "log.jsonl")) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
    env: {
      ...process.env,
      AGENT_RUN_LOG_FILE: log,
      AGENT_RUN_LOG_AGENTS: agents,
      CLAUDE_PROJECT_DIR: "",
      CLAUDE_CODE_EFFORT_LEVEL: "",
      ...env,
    },
  });
  return r;
};
const last = (log = path.join(tmp, "log.jsonl")) => {
  const l = fs.readFileSync(log, "utf8").trim().split("\n");
  return JSON.parse(l[l.length - 1]);
};
const ev = (input, extra = {}) => ({
  tool_name: "Agent",
  session_id: "s1",
  cwd: bare,
  transcript_path: transcript,
  tool_input: { description: "Read files: x", prompt: "p", ...input },
  ...extra,
});

let r = run(ev({ subagent_type: "worker" }));
let l = last();
check(
  "worker: home frontmatter model and effort",
  l.model === "sonnet" && l.effort === "medium",
  JSON.stringify(l),
);
check(
  "no stdout (never rewrites the input)",
  r.stdout === "" && r.status === 0,
  r.stdout + r.stderr,
);
check(
  "fields: session, cwd, description, type, ts",
  l.session === "s1" &&
    l.cwd === bare &&
    l.description === "Read files: x" &&
    l.type === "worker" &&
    !isNaN(Date.parse(l.ts)),
);

run(ev({ subagent_type: "worker", model: "opus" }));
l = last();
check(
  "override model wins, effort from the file",
  l.model === "opus" && l.effort === "medium",
  JSON.stringify(l),
);

run(ev({ subagent_type: "worker" }), { CLAUDE_PROJECT_DIR: project });
l = last();
check(
  "project agent file wins over home",
  l.model === "haiku" && l.effort === "low",
  JSON.stringify(l),
);

run(ev({ subagent_type: "planner" }));
l = last();
check(
  "BOM + CRLF frontmatter; missing effort from the session",
  l.model === "fable" && l.effort === "high",
  JSON.stringify(l),
);

run(ev({ subagent_type: "Explore" }));
l = last();
check(
  "unknown type: session model and effort from the transcript",
  l.model === "claude-opus-5-5" && l.effort === "high" && l.type === "Explore",
  JSON.stringify(l),
);

run(ev({}));
l = last();
check(
  "no subagent_type counts as general-purpose",
  l.type === "general-purpose" && l.model === "claude-opus-5-5",
);

run(ev({ subagent_type: "fork" }, { transcript_path: undefined }), {});
l = last();
check(
  "no transcript: model and effort null",
  l.model === null && l.effort === null,
  JSON.stringify(l),
);

run(
  ev(
    { subagent_type: "fork", description: "Gone transcript" },
    { transcript_path: path.join(tmp, "gone.jsonl") },
  ),
  {},
);
l = last();
check(
  "missing transcript file: line still written, model null",
  l.description === "Gone transcript" && l.model === null,
  JSON.stringify(l),
);

// CLAUDE_CODE_EFFORT_LEVEL in the hook's environment beats the file and the call's own effort; empty falls through
run(ev({ subagent_type: "reviewer" }), { CLAUDE_CODE_EFFORT_LEVEL: "medium" });
l = last();
check(
  "variable medium, file high: logs medium",
  l.model === "fable" && l.effort === "medium",
  JSON.stringify(l),
);
run(ev({ subagent_type: "reviewer", effort: "low" }), {
  CLAUDE_CODE_EFFORT_LEVEL: "medium",
});
check(
  "variable medium beats the call's effort",
  last().effort === "medium",
  JSON.stringify(last()),
);
run(ev({ subagent_type: "reviewer" }));
check(
  "variable empty, file high: logs high",
  last().effort === "high",
  JSON.stringify(last()),
);
run(ev({ subagent_type: "reviewer", effort: "low" }));
check(
  "variable empty: the call's effort beats the file",
  last().effort === "low",
  JSON.stringify(last()),
);
run(ev({ subagent_type: "reviewer" }), { CLAUDE_CODE_EFFORT_LEVEL: "auto" });
check(
  "variable auto sends no level: effort null",
  last().effort === null,
  JSON.stringify(last()),
);
run(ev({ subagent_type: "Explore" }), { CLAUDE_CODE_EFFORT_LEVEL: "unset" });
check(
  "variable unset: no level from the session either",
  last().effort === null && last().model === "claude-opus-5-5",
  JSON.stringify(last()),
);

const offLog = path.join(tmp, "off.jsonl");
run(ev({ subagent_type: "worker" }), { AGENT_RUN_LOG: "off" }, offLog);
check("AGENT_RUN_LOG=off writes nothing", !fs.existsSync(offLog));

const bashLog = path.join(tmp, "bash.jsonl");
run({ tool_name: "Bash", tool_input: { command: "ls" } }, {}, bashLog);
check("other tools ignored", !fs.existsSync(bashLog));

const junkLog = path.join(tmp, "junk.jsonl");
r = run("not json", {}, junkLog);
check(
  "junk input fails open (exit 0, nothing written)",
  r.status === 0 && !fs.existsSync(junkLog),
  r.stderr,
);

const trimLog = path.join(tmp, "trim.jsonl");
fs.writeFileSync(
  trimLog,
  Array.from({ length: 520 }, (_, i) => JSON.stringify({ n: i })).join("\n") +
    "\n",
);
run(ev({ subagent_type: "worker" }), {}, trimLog);
const kept = fs.readFileSync(trimLog, "utf8").trim().split("\n");
check(
  "trim to the last 500 lines",
  kept.length === 500 &&
    JSON.parse(kept[0]).n === 21 &&
    JSON.parse(kept[499]).type === "worker",
  `${kept.length} ${kept[0]}`,
);

// ---- the result: success, partial or fail, written onto the helper's start line
const resLog = path.join(tmp, "result.jsonl");
const lines = (log = resLog) =>
  fs
    .readFileSync(log, "utf8")
    .trim()
    .split("\n")
    .map((x) => JSON.parse(x));
const OLD_KEYS = [
  "ts",
  "session",
  "cwd",
  "description",
  "type",
  "model",
  "effort",
];
// A start (PreToolUse) and its end (PostToolUse) with this report; `response` replaces the usual completed one
const helper = (
  id,
  report,
  { response, event = "PostToolUse", extra = {} } = {},
) => {
  const start = ev(
    { subagent_type: "worker", description: `Helper ${id}` },
    { hook_event_name: "PreToolUse", tool_use_id: id },
  );
  run(start, {}, resLog);
  const end = {
    ...start,
    hook_event_name: event,
    tool_response: response ?? {
      status: "completed",
      content: [{ type: "text", text: report }],
    },
    ...extra,
  };
  r = run(end, {}, resLog);
  return lines().find((x) => x.toolUseId === id);
};
l = helper("t1", "Done. Files changed: a.mjs.\nOutside the brief: none");
check(
  "a normal report logs success",
  l.result === "success" &&
    l.why === null &&
    !isNaN(Date.parse(l.endedAt)) &&
    r.stdout === "" &&
    r.status === 0,
  JSON.stringify(l),
);
check(
  "the old fields are unchanged: same keys and values as the start, toolUseId added",
  OLD_KEYS.every((k) => k in l) &&
    l.model === "sonnet" &&
    l.effort === "medium" &&
    l.type === "worker" &&
    l.description === "Helper t1" &&
    l.session === "s1" &&
    l.cwd === bare,
  JSON.stringify(l),
);
check(
  "the result is written onto the start line, not as a second line",
  lines().filter((x) => x.description === "Helper t1").length === 1 &&
    lines().length === 1,
  JSON.stringify(lines()),
);
l = helper(
  "t2",
  "Found the cause.\n\nBLOCKED S3: expected one compare, found two. Checked: hooks. Need: which one.",
);
check(
  "a BLOCKED report logs partial, with the BLOCKED line as why",
  l.result === "partial" && /^BLOCKED S3:/.test(l.why),
  JSON.stringify(l),
);
l = helper("t3", "");
check(
  "an empty report logs fail",
  l.result === "fail" && l.why === "empty report",
  JSON.stringify(l),
);
l = helper("t4", "", {
  response: {
    status: "completed",
    content: [{ type: "text", text: "[harness: agent ended]" }],
  },
});
check(
  "a report of only harness lines counts as empty: fail",
  l.result === "fail",
  JSON.stringify(l),
);
l = helper("t5", "Agent stopped at its 40-turn limit.\nDone so far: a.");
check(
  "the turn-limit note logs partial",
  l.result === "partial" && l.why === "turn limit",
  JSON.stringify(l),
);
l = helper("t6", "Done: the hook.\nWhat is left:\n- the test\n- the docs");
check(
  "a 'what is left' list logs partial",
  l.result === "partial" && /What is left/.test(l.why),
  JSON.stringify(l),
);
l = helper("t7", "Done: all of it.\nWhat is left: nothing.");
check(
  "'what is left: nothing' is success",
  l.result === "success",
  JSON.stringify(l),
);
l = helper(
  "t8",
  "The brief says a report with a `BLOCKED` line is partial; I wrote that rule.",
);
check(
  "BLOCKED in the middle of a line is success",
  l.result === "success",
  JSON.stringify(l),
);
l = helper("t9", "", {
  event: "PostToolUseFailure",
  extra: { error: "Agent crashed: out of memory" },
});
check(
  "a failed call (PostToolUseFailure) logs fail with its error",
  l.result === "fail" && l.why === "error: Agent crashed: out of memory",
  JSON.stringify(l),
);
l = helper("t10", "API Error: 529 overloaded");
check(
  "an API error as the report logs fail",
  l.result === "fail" && /^API Error/.test(l.why),
  JSON.stringify(l),
);
l = helper("t11", "", {
  response: { status: "async_launched", agentId: "a1" },
});
check(
  "a background launch gets no result",
  !("result" in l),
  JSON.stringify(l),
);
// an old start line with no toolUseId: found by session and description
fs.writeFileSync(
  resLog,
  JSON.stringify({
    ts: "2026-11-01T00:00:00.000Z",
    session: "s1",
    cwd: bare,
    description: "Old helper",
    type: "worker",
    model: "sonnet",
    effort: "medium",
  }) + "\n",
);
run(
  {
    ...ev({ description: "Old helper" }),
    hook_event_name: "PostToolUse",
    tool_use_id: "t12",
    tool_response: {
      status: "completed",
      content: [{ type: "text", text: "Done." }],
    },
  },
  {},
  resLog,
);
check(
  "a start line from before toolUseId is found by session and description",
  lines().length === 1 &&
    lines()[0].result === "success" &&
    !("toolUseId" in lines()[0]),
  JSON.stringify(lines()),
);
// no start line at all: a line with no description, which the Agents Panel skips
const loneLog = path.join(tmp, "lone.jsonl");
run(
  {
    ...ev({ description: "Never started" }),
    hook_event_name: "PostToolUse",
    tool_use_id: "t13",
    tool_response: "BLOCKED S1: no.",
  },
  {},
  loneLog,
);
l = last(loneLog);
check(
  "no start line: a result line with no description",
  l.result === "partial" && l.toolUseId === "t13" && !("description" in l),
  JSON.stringify(l),
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
