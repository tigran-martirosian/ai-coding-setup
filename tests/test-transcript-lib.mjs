// Tests for hooks/lib/transcript.mjs (the one transcript reader): the edge cases the hooks' old copies handled.
// Run: node tests/test-transcript-lib.mjs
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  tail,
  backEntries,
  entries,
  typedByUser,
  userText,
  assistantText,
  currentTurn,
  lastReply,
  lastUsage,
  QUESTION_TOOLS,
  subagentPath,
  agentType,
  agentLaunches,
  INJECTED,
} from "../hooks/lib/transcript.mjs";

const dir = mkdtempSync(join(tmpdir(), "transcript-lib-"));
let fail = 0,
  total = 0;
const report = (ok, name) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
const file = (name, lines) => {
  const p = join(dir, name);
  writeFileSync(
    p,
    lines
      .map((l) => (typeof l === "string" ? l : JSON.stringify(l)))
      .join("\n") + "\n",
  );
  return p;
};

const user = (content, extra = {}) => ({
  type: "user",
  message: { role: "user", content },
  ...extra,
});
const said = (text, extra = {}) => ({
  type: "assistant",
  message: { model: "claude-x", content: [{ type: "text", text }] },
  ...extra,
});
const use = (name, id, input = {}) => ({
  type: "assistant",
  message: {
    model: "claude-x",
    content: [{ type: "tool_use", id, name, input }],
  },
});
const result = (id, content, extra = {}) =>
  user([{ type: "tool_result", tool_use_id: id, content }], extra);
const usage = (n, extra = {}) => ({
  type: "assistant",
  timestamp: "2026-11-06T10:00:00Z",
  message: {
    model: "claude-x",
    content: [],
    usage: {
      input_tokens: 1,
      cache_read_input_tokens: n - 1,
      cache_creation_input_tokens: 0,
    },
  },
  ...extra,
});

// entries: sidechain lines out, bad lines skipped
const list = entries([
  JSON.stringify(user("hi")),
  "not json",
  JSON.stringify(user("side", { isSidechain: true })),
  "",
]);
report(
  list.length === 1 && userText(list[0]) === "hi",
  "entries skips a bad line and a sidechain line",
);
report(
  entries([JSON.stringify(user("side", { isSidechain: true }))], {
    sidechain: true,
  }).length === 1,
  "entries keeps sidechain lines in a subagent's own file",
);

// typed by user
report(typedByUser(user("fix the header")), "a typed message is typed");
report(
  !typedByUser(
    user("<task-notification><task-id>a1</task-id></task-notification>"),
  ),
  "a task notification is not typed",
);
report(
  !typedByUser(user("[System: background task(s) settled]")),
  "an injected system note is not typed",
);
report(
  !typedByUser(user("Stop hook feedback:\n[x] y", { isMeta: true })) &&
    !typedByUser(user("Stop hook feedback: y")),
  "a Stop hook's feedback is not typed",
);
report(
  !typedByUser(user("[Request interrupted by user]")),
  "an interrupt is not typed",
);
report(
  !typedByUser(user("go", { origin: { kind: "task-notification" } })) &&
    !typedByUser(user("go", { promptSource: "system" })),
  "origin and promptSource mark injected prompts",
);
report(
  !typedByUser(result("t1", "ok")),
  "a tool_result-only user entry is not typed",
);
report(INJECTED.test("  <task-notification>"), "INJECTED allows leading space");
report(
  assistantText(said("one")) === "one" &&
    userText(user([{ type: "text", text: "a" }, { type: "image" }])) === "a",
  "text of an assistant reply and of user blocks",
);

// currentTurn
const turn = [
  user("first"),
  said("x"),
  user("ask"),
  use("Bash", "t1"),
  result("t1", "ok"),
  user("[Request interrupted by user]"),
  said("y"),
];
const t1 = currentTurn(turn);
report(
  userText(t1.start) === "ask" && t1.entries.length === 4,
  "an interrupted turn still starts at the typed message",
);
const withNotice = [
  user("ask"),
  said("x"),
  user("<task-notification><task-id>a1</task-id></task-notification>"),
  said("z"),
];
report(
  currentTurn(withNotice).start === null &&
    currentTurn(withNotice).entries.length === 1,
  "a notice starts a turn of its own, not typed",
);
const typed = currentTurn(withNotice, { typed: true });
report(
  userText(typed.start) === "ask" && typed.entries.length === 3,
  "with typed, the turn runs back to the typed message",
);

// lastReply
report(
  lastReply([
    user("q"),
    use("Bash", "t1"),
    result("t1", "ok"),
    said("part 1"),
    said("part 2"),
  ]) === "part 1\npart 2",
  "lastReply is the text after the last tool call",
);

// lastUsage
const u = [
  usage(5000),
  said("x"),
  usage(120000),
  {
    type: "assistant",
    message: { model: "<synthetic>", content: [], usage: { input_tokens: 9 } },
  },
];
report(
  lastUsage(u)?.tokens === 120000,
  "usage comes from the last real assistant entry",
);
report(
  lastUsage(
    [
      ...u,
      {
        type: "system",
        subtype: "compact_boundary",
        compactMetadata: { postTokens: 13000 },
      },
    ],
    { compact: true },
  )?.tokens === 13000,
  "a later compact gives what it left",
);
report(
  lastUsage([usage(7000), usage(9000, { timestamp: undefined })], {
    timed: true,
  })?.tokens === 7000,
  "timed skips a reply with no timestamp",
);
report(lastUsage([user("hi")]) === null, "no usage at all is null");

// tail and backEntries
const big = file("big.jsonl", [user("x".repeat(200)), usage(42000)]);
const cut = tail(big, JSON.stringify(usage(42000)).length + 20);
report(
  cut.filter((l) => l.trim()).length === 1 &&
    JSON.parse(cut[0]).type === "assistant",
  "tail drops the line its start cut in half",
);
report(
  tail(big, 1e6).filter((l) => l.trim()).length === 2,
  "tail of a small file keeps its first line",
);
report(
  tail(file("empty.jsonl", []), 100).join("") === "" &&
    [...backEntries(join(dir, "empty.jsonl"))].length === 0,
  "an empty file has no lines",
);
report(
  tail(join(dir, "none.jsonl")).length === 0 &&
    [...backEntries(join(dir, "none.jsonl"))].length === 0,
  "a missing file has no lines",
);
const long = file("long.jsonl", [
  user("first"),
  said("y".repeat(5000)),
  usage(80000),
  said("z"),
]);
const back = [...backEntries(long, { chunk: 1000 })];
report(
  back.length === 4 &&
    userText(back[3]) === "first" &&
    lastUsage(backEntries(long, { chunk: 1000 }))?.tokens === 80000,
  "backEntries reads newest first across small chunks",
);

// helpers
report(
  QUESTION_TOOLS.test("AskUserQuestion") &&
    QUESTION_TOOLS.test("mcp__nimbalyst__PromptForUserInput") &&
    QUESTION_TOOLS.test("ExitPlanMode") &&
    !QUESTION_TOOLS.test("Bash"),
  "QUESTION_TOOLS names the form tools",
);
report(
  subagentPath("/p/s1.jsonl", "a1").replace(/\\/g, "/") ===
    "/p/s1/subagents/agent-a1.jsonl" &&
    subagentPath("/p/s1.jsonl", "a1", "s2").replace(/\\/g, "/") ===
      "/p/s2/subagents/agent-a1.jsonl",
  "subagentPath from the parent transcript",
);
report(
  subagentPath("/p/s1/subagents/agent-a1.jsonl", "zz").endsWith(
    "agent-a1.jsonl",
  ),
  "an agent file is its own path",
);
const helper = file("agent-h1.jsonl", [user("brief", { isSidechain: true })]);
writeFileSync(
  join(dir, "agent-h1.meta.json"),
  JSON.stringify({ agentType: "worker" }),
);
report(
  agentType(helper) === "worker" &&
    agentType(join(dir, "agent-none.jsonl")) === null,
  "agentType from meta.json, null without one",
);
const launches = agentLaunches([
  use("Agent", "t1", { description: "S1" }),
  result(
    "t1",
    "Async agent launched successfully.\nagentId: a111 (internal ID)",
  ),
  use("Task", "t2"),
  result("t2", "done.\nagentId: b222 (use SendMessage)"),
  use("Agent", "t3"),
  result("t3", "started", {
    toolUseResult: { status: "async_launched", agentId: "c333" },
  }),
  use("Bash", "t4"),
  result("t4", "Command running in background with ID: d444"),
]);
report(
  launches.map((l) => `${l.task}:${l.async}`).join(" ") ===
    "a111:true b222:false c333:true d444:true" &&
    launches[0].toolUseId === "t1",
  "agent launches from Agent/Task results, async marked",
);

rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} of ${total} failed` : `all ${total} passed`);
process.exit(fail ? 1 : 0);
