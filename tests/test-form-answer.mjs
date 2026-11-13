// Tests for hooks/form-answer.mjs: the note after a form's answer. Run: node tests/test-form-answer.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/form-answer.mjs", import.meta.url),
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
    env: { ...process.env, FORM_ANSWER: "", ...env },
  });
const note = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput;
  } catch {
    return null;
  }
};
// A Nimbalyst form's answer as the transcript shows it: the tool's result, with a tick and typed text
const answer = {
  answers: {
    go: {
      type: "singleSelect",
      selectedId: "__other__",
      otherText: "no, keep the old one",
    },
  },
  respondedBy: "desktop",
};
const form = (tool_name, extra = {}) => ({
  hook_event_name: "PostToolUse",
  tool_name,
  tool_input: {},
  tool_response: [{ type: "text", text: JSON.stringify(answer) }],
  ...extra,
});

let r = run(form("mcp__nimbalyst__PromptForUserInput"));
let o = note(r);
check(
  "PromptForUserInput answer: the note",
  o?.hookEventName === "PostToolUse" &&
    o.additionalContext.includes("what the user typed outweighs"),
  r.stdout + r.stderr,
);
check(
  "the note says how to report a tick",
  o?.additionalContext.includes('"you ticked: <the option\'s full text>"'),
);
check(
  "built-in AskUserQuestion: the note",
  note(run(form("AskUserQuestion")))?.additionalContext.startsWith(
    "[form-answer]",
  ),
);
check(
  "Nimbalyst AskUserQuestion: the note",
  note(
    run(form("mcp__nimbalyst__AskUserQuestion")),
  )?.additionalContext.startsWith("[form-answer]"),
);
check("another tool: silent", run(form("Read")).stdout === "");
check(
  "in a helper (agent_id): silent",
  run(form("mcp__nimbalyst__PromptForUserInput", { agent_id: "a1" })).stdout ===
    "",
);
check(
  "FORM_ANSWER=off: silent",
  run(form("mcp__nimbalyst__PromptForUserInput"), { FORM_ANSWER: "off" })
    .stdout === "",
);
r = spawnSync(process.execPath, [HOOK], {
  input: "not json",
  encoding: "utf8",
});
check("bad input: silent, exit 0", r.stdout === "" && r.status === 0);
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
