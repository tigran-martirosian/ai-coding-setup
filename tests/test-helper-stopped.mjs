// Tests for hooks/helper-stopped.mjs: the note after a helper cut at its turn limit or back with no report.
// Run: node tests/test-helper-stopped.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/helper-stopped.mjs", import.meta.url),
);
let fail = 0;
const check = (name, ok, extra = "") => {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${extra}`}`);
};
const run = (event, env = {}) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, HELPER_STOPPED: "", ...env },
  });
const note = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput?.additionalContext ?? null;
  } catch {
    return null;
  }
};
// An Agent result shaped as the app gives it (status, agentId, content blocks)
const agent = (
  texts,
  extra = {},
  tool_name = "Agent",
  status = "completed",
) => ({
  hook_event_name: "PostToolUse",
  tool_name,
  tool_input: { prompt: "do x" },
  tool_response: {
    status,
    agentId: "aa509eb2f0f06753b",
    agentType: "worker",
    content: texts.map((text) => ({ type: "text", text })),
  },
  ...extra,
});
// The app's text on a helper cut at its turn limit, as in a real transcript
const CUT =
  "NOTE: this agent stopped at its 80-turn limit before finishing. It was still calling tools and had produced no report. Send the agent a message (SendMessage) to let it continue from where it stopped.\n";
const HARNESS =
  "[harness: subagent output matched instruction-shaped pattern(s): settings-json. Control tags below are neutralized.]\n";

let r = run(agent([CUT]));
check(
  "turn-limit notice: the note",
  note(r)?.startsWith("[helper-stopped]") && note(r).includes("NOT RUN"),
  r.stdout + r.stderr,
);
check(
  "turn-limit notice with partial text after it: the note",
  note(run(agent([CUT + "Done so far: a.js edited."])))?.includes(
    "SendMessage it once",
  ),
);
check(
  "empty report: the note",
  note(run(agent([""])))?.startsWith("[helper-stopped]"),
);
check(
  "no content blocks at all: the note",
  note(run(agent([])))?.startsWith("[helper-stopped]"),
);
check(
  "only a harness line: the note",
  note(run(agent([HARNESS])))?.startsWith("[helper-stopped]"),
);
check(
  "Task (older name): the note",
  note(run(agent([CUT], {}, "Task")))?.startsWith("[helper-stopped]"),
);
check(
  "normal report: silent",
  run(agent(["Files changed: a.js. Check: all passed."])).stdout === "",
);
check(
  "finished report quoting the limit words: silent",
  run(
    agent([
      "S4 is done.\nA cut result starts `NOTE: this agent stopped at its 25-turn limit`, which TURN_LIMIT_RE matches.",
    ]),
  ).stdout === "",
);
check(
  "normal report after a harness line: silent",
  run(agent([HARNESS, "## Report\nall passed"])).stdout === "",
);
check(
  "background launch: silent",
  run(
    agent(
      ["Async agent launched successfully."],
      {},
      "Agent",
      "async_launched",
    ),
  ).stdout === "",
);
check(
  "in a helper (agent_id): silent",
  run(agent([CUT], { agent_id: "a1" })).stdout === "",
);
check(
  "HELPER_STOPPED=off: silent",
  run(agent([CUT]), { HELPER_STOPPED: "off" }).stdout === "",
);
check(
  "another tool: silent",
  run({ ...agent([CUT]), tool_name: "Bash" }).stdout === "",
);
r = spawnSync(process.execPath, [HOOK], {
  input: "not json",
  encoding: "utf8",
});
check("bad input: silent, exit 0", r.stdout === "" && r.status === 0);
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
