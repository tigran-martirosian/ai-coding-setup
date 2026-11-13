// Test for hooks/worker-size.mjs: made-up subagent transcripts, hook run as a child process.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOOK = fileURLToPath(
  new URL("../hooks/worker-size.mjs", import.meta.url),
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "worker-size-test-"));
const stateDir = path.join(
  os.homedir(),
  ".claude",
  "hooks",
  "state",
  "worker-size",
); // where the hook keeps its state
const tag = "t" + process.pid;
let failed = 0;
let n = 0;

const asst = (ctx) =>
  JSON.stringify({
    type: "assistant",
    isSidechain: true,
    agentId: "x",
    timestamp: new Date().toISOString(),
    message: {
      id: "m" + Math.random(),
      model: "claude-x",
      content: [{ type: "text", text: "hi" }],
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: ctx - 10,
        cache_creation_input_tokens: 0,
      },
    },
  });
const user = () =>
  JSON.stringify({
    type: "user",
    isSidechain: true,
    message: { role: "user", content: "next" },
  });

// A parent transcript path plus the subagent file under <session>/subagents/ for one made-up helper
function helper(agentId, ctxList) {
  const session = "sess-" + tag;
  const parent = path.join(dir, session + ".jsonl");
  fs.writeFileSync(parent, asst(500000) + "\n"); // the parent's own size must not be read
  const sub = path.join(dir, session, "subagents");
  fs.mkdirSync(sub, { recursive: true });
  const file = path.join(sub, `agent-${agentId}.jsonl`);
  fs.writeFileSync(
    file,
    ctxList.flatMap((c) => [asst(c), user()]).join("\n") + "\n",
  );
  return { session, parent, file };
}

function run(name, expectNudge, { input, env = {} } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const out = r.stdout.trim();
  let ok = r.status === 0;
  if (expectNudge) {
    try {
      const j = JSON.parse(out);
      ok =
        ok &&
        j.hookSpecificOutput.hookEventName === "PostToolUse" &&
        j.hookSpecificOutput.additionalContext.startsWith("[worker-size]") &&
        j.hookSpecificOutput.additionalContext.includes(
          `~${expectNudge}k tokens`,
        );
    } catch {
      ok = false;
    }
  } else ok = ok && out === "";
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`,
  );
  return out;
}
const ev = (h, id, extra = {}) =>
  JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: h.session,
    transcript_path: h.parent,
    agent_id: id,
    ...extra,
  });

const ids = [];
const newId = () => {
  const id = `${tag}-${++n}`;
  ids.push(id);
  return id;
};

// main session: no agent_id, even over the limit
{
  const id = newId();
  const h = helper(id, [300000]);
  run("main-session-silent", 0, { input: ev(h, undefined) });
}
// one helper climbing: 120k silent, 160k nudges, 170k silent, 260k nudges
{
  const id = newId();
  const h = helper(id, [120000]);
  run("subagent-120k-silent", 0, { input: ev(h, id) });
  fs.writeFileSync(
    h.file,
    [asst(120000), asst(160000), user()].join("\n") + "\n",
  );
  run("subagent-160k-nudges", 160, { input: ev(h, id) });
  fs.writeFileSync(
    h.file,
    [asst(160000), asst(170000), user()].join("\n") + "\n",
  );
  run("subagent-170k-silent-again", 0, { input: ev(h, id) });
  fs.writeFileSync(
    h.file,
    [asst(170000), asst(260000), user()].join("\n") + "\n",
  );
  run("subagent-260k-nudges", 260, { input: ev(h, id) });
  // a compact drops it to 30k, then it climbs past the line again: warned again
  fs.writeFileSync(
    h.file,
    [asst(260000), asst(30000), user()].join("\n") + "\n",
  );
  run("after-compact-30k-silent", 0, { input: ev(h, id) });
  fs.writeFileSync(
    h.file,
    [asst(30000), asst(155000), user()].join("\n") + "\n",
  );
  run("after-compact-155k-nudges-again", 155, { input: ev(h, id) });
}
{
  const id = newId();
  const h = helper(id, [300000]);
  run("off-switch", 0, { input: ev(h, id), env: { WORKER_SIZE: "off" } });
  run("nudges-after-off", 300, { input: ev(h, id) });
}
{
  const id = newId();
  const h = helper("someone-else", [300000]);
  run("missing-subagent-file", 0, { input: ev(h, id) });
}
{
  const id = newId();
  const h = helper(id, [300000]);
  run("transcript-path-is-agent-file", 300, {
    input: JSON.stringify({
      session_id: "none",
      transcript_path: h.file,
      agent_id: id,
    }),
  });
}
{
  const id = newId();
  const h = helper(id, [1]);
  fs.writeFileSync(h.file, 'not json\n{"type":\n\n');
  run("broken-lines", 0, { input: ev(h, id) });
  run("broken-event", 0, { input: "{not json" });
  run("empty-input", 0, { input: "" });
  run("no-transcript-path", 0, { input: JSON.stringify({ agent_id: id }) });
}

// hard stop on PreToolUse
const pre = (
  h,
  id,
  agent_type = "worker",
  tool_name = "Bash",
  tool_input = {},
) =>
  JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: h.session,
    transcript_path: h.parent,
    agent_id: id,
    agent_type,
    tool_name,
    tool_input,
  });
// The older cases below test the refusal itself, so they run with no grace calls (WORKER_STOP_GRACE=0)
function runStop(name, expectDeny, input, env = { WORKER_STOP_GRACE: "0" }) {
  const r = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const out = r.stdout.trim();
  let ok = r.status === 0;
  if (expectDeny) {
    try {
      const o = JSON.parse(out).hookSpecificOutput;
      ok =
        ok &&
        o.hookEventName === "PreToolUse" &&
        o.permissionDecision === "deny" &&
        o.permissionDecisionReason.includes(
          "stop and report now: files changed, the check run, what is left, any half-edited file",
        );
    } catch {
      ok = false;
    }
  } else ok = ok && out === "";
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`,
  );
}
{
  const id = newId();
  const h = helper(id, [185000]);
  runStop("stop-refuses-at-185k", true, pre(h, id));
  run("note-still-at-185k-post", 185, { input: ev(h, id) });
  fs.writeFileSync(
    h.file,
    [asst(185000), asst(150000), user()].join("\n") + "\n",
  );
  runStop("stop-150k-passes-pre", false, pre(h, id));
  fs.rmSync(path.join(stateDir, id + ".json"), { force: true });
  run("note-at-150k-post", 150, { input: ev(h, id) });
  fs.writeFileSync(
    h.file,
    [asst(185000), asst(40000), user()].join("\n") + "\n",
  );
  runStop("stop-passes-40k-after-compaction", false, pre(h, id));
  runStop(
    "stop-main-session-untouched",
    false,
    JSON.stringify({
      hook_event_name: "PreToolUse",
      session_id: h.session,
      transcript_path: h.parent,
    }),
  );
}
{
  const id = newId();
  const h = helper(id, [185000]);
  runStop("stop-env-threshold-raised", false, pre(h, id), {
    WORKER_STOP_K: "200",
    WORKER_STOP_GRACE: "0",
  });
  fs.writeFileSync(h.file, asst(120000) + "\n");
  runStop("stop-env-threshold-lowered", true, pre(h, id), {
    WORKER_STOP_K: "100",
    WORKER_STOP_GRACE: "0",
  });
  runStop("stop-off-switch", false, pre(h, id), {
    WORKER_STOP_K: "100",
    WORKER_SIZE: "off",
    WORKER_STOP_GRACE: "0",
  });
}

// agent type and grace calls
const pre2 = (h, id, type, env = {}, tool = "Bash", toolInput = {}) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: pre(h, id, type, tool, toolInput),
    encoding: "utf8",
    env: { ...process.env, WORKER_STOP_GRACE: "", ...env },
  });
  const out = r.stdout.trim();
  if (!out) return "pass";
  const o = JSON.parse(out).hookSpecificOutput;
  if (o.permissionDecision === "deny") return "deny";
  const m = o.additionalContext.match(
    /at most (\d+) more calls of other tools; Write and Edit stay allowed/,
  );
  if (m) return "note" + m[1];
  return /Write and Edit stay allowed until \d+k and use no grace calls/.test(
    o.additionalContext,
  )
    ? "save"
    : "other";
};
const expectSeq = (name, got, want) => {
  const ok = got.join(",") === want.join(",");
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> " + got.join(",") + " (want " + want.join(",") + ")"}`,
  );
};
{
  const id = newId();
  const h = helper(id, [185000]);
  for (const type of ["planner", "reviewer", null])
    expectSeq(
      `stop-type-${type}-passes-past-180k`,
      [
        pre2(h, id, type),
        pre2(h, id, type),
        pre2(h, id, type),
        pre2(h, id, type),
        pre2(h, id, type),
      ],
      ["pass", "pass", "pass", "pass", "pass"],
    );
}
{
  const id = newId();
  const h = helper(id, [185000]);
  expectSeq(
    "worker-gets-3-noted-calls-then-refusal",
    Array.from({ length: 6 }, () => pre2(h, id, "worker")),
    ["note3", "note2", "note1", "deny", "deny", "deny"],
  );
  // compaction: size falls back, count is forgotten, the next climb gets its grace again
  fs.writeFileSync(
    h.file,
    [asst(185000), asst(40000), user()].join("\n") + "\n",
  );
  expectSeq("grace-passes-after-compaction", [pre2(h, id, "worker")], ["pass"]);
  fs.writeFileSync(
    h.file,
    [asst(40000), asst(183000), user()].join("\n") + "\n",
  );
  expectSeq(
    "grace-resets-after-compaction",
    [
      pre2(h, id, "worker"),
      pre2(h, id, "worker"),
      pre2(h, id, "worker"),
      pre2(h, id, "worker"),
    ],
    ["note3", "note2", "note1", "deny"],
  );
}
{
  const id = newId();
  const h = helper(id, [185000]);
  expectSeq(
    "worker-full-has-grace",
    [
      pre2(h, id, "worker-full", { WORKER_STOP_GRACE: "1" }),
      pre2(h, id, "worker-full", { WORKER_STOP_GRACE: "1" }),
    ],
    ["note1", "deny"],
  );
  const id6 = newId();
  const h6 = helper(id6, [185000]);
  expectSeq(
    "worker-refactor-has-grace",
    [
      pre2(h6, id6, "worker-refactor", { WORKER_STOP_GRACE: "1" }),
      pre2(h6, id6, "worker-refactor", { WORKER_STOP_GRACE: "1" }),
    ],
    ["note1", "deny"],
  );
  const id7 = newId();
  const h7 = helper(id7, [185000]);
  expectSeq(
    "worker-code-has-grace",
    [
      pre2(h7, id7, "worker-code", { WORKER_STOP_GRACE: "1" }),
      pre2(h7, id7, "worker-code", { WORKER_STOP_GRACE: "1" }),
    ],
    ["note1", "deny"],
  );
  const id2 = newId();
  const h2 = helper(id2, [185000]);
  expectSeq(
    "env-grace-5",
    Array.from({ length: 7 }, () =>
      pre2(h2, id2, "worker", { WORKER_STOP_GRACE: "5" }),
    ),
    ["note5", "note4", "note3", "note2", "note1", "deny", "deny"],
  );
  // past the stop line a Write or Edit still goes through and uses no grace, so unwritten work reaches disk
  const id4 = newId();
  const h4 = helper(id4, [185000]);
  const g1 = { WORKER_STOP_GRACE: "1" };
  expectSeq(
    "write-past-stop-line-saves-without-grace",
    [
      pre2(h4, id4, "worker", g1, "Write", { content: "x" }),
      pre2(h4, id4, "worker", g1),
      pre2(h4, id4, "worker", g1, "Edit", { new_string: "y" }),
      pre2(h4, id4, "worker", g1),
    ],
    ["save", "note1", "save", "deny"],
  );
  // a Write whose own input would carry the context past the save line is refused like any other call
  const id5 = newId();
  const h5 = helper(id5, [185000]);
  expectSeq(
    "write-that-crosses-save-line-is-refused",
    [
      pre2(h5, id5, "worker", { WORKER_STOP_GRACE: "0" }, "Write", {
        content: "x".repeat(40000),
      }),
    ],
    ["deny"],
  );
  const id3 = newId();
  const h3 = helper(id3, [185000]);
  expectSeq(
    "env-grace-0-refuses-at-once",
    [pre2(h3, id3, "worker", { WORKER_STOP_GRACE: "0" })],
    ["deny"],
  );
}

for (const id of ids)
  for (const ext of [".json", ".stop.json"])
    fs.rmSync(path.join(stateDir, id + ext), { force: true });
fs.rmSync(dir, { recursive: true, force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
