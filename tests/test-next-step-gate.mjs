// Tests for hooks/next-step-gate.mjs (a reply that ends on Claude's own next step is sent back once).
// Run: node tests/test-next-step-gate.mjs
process.env.HOOK_ERRORS_LOG = "off";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/next-step-gate.mjs", import.meta.url),
);
const { ownNextStep, stopVerdict } = await import(pathToFileURL(HOOK).href);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "next-step-gate-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`,
  );
};

// Two replies that ended the turn after A1-A3 with the plan's next steps still open
const INCIDENT_1 =
  "A1 to A3 are done: every sub-agent row now shows its model and effort.\n\n### Next\nNext is R1, research on what makes an interface look AI-made, from the last month or two. Then the shell steps S1 to S3.";
const INCIDENT_2 =
  "### Left\n- In the dark theme, finished rows look as bright as running ones.\n- **Next:** R1, research on what makes an interface look AI-made. Then the shell steps S1 to S3 of [whole-app-plan.md](/C:/x.md).";

const user = (text) => ({ type: "user", message: { content: text } });
const said = (text, tools = []) => ({
  type: "assistant",
  message: {
    model: "claude-opus-5-5",
    content: [
      ...tools.map((name) => ({ type: "tool_use", name, input: {} })),
      ...(text ? [{ type: "text", text }] : []),
    ],
  },
});
const skill = (name) => ({
  type: "assistant",
  message: {
    model: "claude-opus-5-5",
    content: [{ type: "tool_use", name: "Skill", input: { skill: name } }],
  },
});
const turn = (...rest) => [user("Read the handoff and continue."), ...rest];

check(
  "incident 1: '### Next' heading, next line is the step",
  /^Next is R1/.test(ownNextStep(INCIDENT_1) || ""),
  ownNextStep(INCIDENT_1),
);
check(
  "incident 2: '- **Next:** R1'",
  /^R1, research/.test(ownNextStep(INCIDENT_2) || ""),
  ownNextStep(INCIDENT_2),
);
check(
  "incident 1 blocks after work",
  !!stopVerdict(turn(said("", ["Bash"]), said(INCIDENT_1)), null),
);
check(
  "incident 2 blocks on a system-event turn too",
  !!stopVerdict(
    [
      user("[System: background task(s) you launched have settled]"),
      said("", ["Read"]),
      said(INCIDENT_2),
    ],
    null,
  ),
);
check(
  "reason quotes the step",
  /R1, research/.test(
    stopVerdict(turn(said("", ["Bash"]), said(INCIDENT_2)), null) || "",
  ),
);

const PASSES = [
  ["names the user", "Next: once you restart Nimbalyst, the panel loads."],
  ["Needs you on the line", "**Next (needs you):** pick the palette."],
  ["fresh session", "### Next\nR1 in a fresh session (handoff written)."],
  ["a later date", "- Next: compare the counters after 2026-11-08."],
  ["no next line", "Done. Tests pass (14 of 14)."],
  ["'next time' is not a step", "Next time the hook fires it writes one line."],
  ["your", "Next step is your call: A or B."],
  ["'Next, I ran' is narration", "Next, I ran the full suite and it passed."],
  [
    "a Needs you section",
    "## Next\nR1 (after your pick)\n\n### Needs you\n- pick the palette: warm or cold",
  ],
  ["waits on running work", "Next: R1 once the build finishes."],
];
const BLOCKS = [
  ["the user's example 'Next I start the bot'", "Done.\nNext I start the bot."],
  ["'### Next steps' with a list", "### Next steps\n- R1, the research"],
  ["'**Next steps:**'", "**Next steps:** R1 then S1."],
  ["'Next, I'll'", "Next, I'll run the release."],
  [
    "a waiting line first, then a real step",
    "Next: once you restart, it loads.\n\n**Next:** R1, the research.",
  ],
];
for (const [name, text] of BLOCKS)
  check(
    `blocks: ${name}`,
    !!stopVerdict(turn(said("", ["Bash"]), said(text)), null),
    String(ownNextStep(text)),
  );
for (const [name, text] of PASSES)
  check(
    `passes: ${name}`,
    stopVerdict(turn(said("", ["Bash"]), said(text)), null) === null,
    ownNextStep(text),
  );

// Go-asks for Claude's own work, from the 2026-11-17 chat review: blocked even under "Needs you"
const { goAsk } = await import(pathToFileURL(HOOK).href);
const GO_BLOCKS = [
  "Next is the merge step. I'll start it in a new session when you say go.",
  "### Needs you\n- Say go and I'll open a fresh session to continue the build from the plan.",
  "### Needs you\n- Say go and I'll start the planner on step 2 now.",
  "### Needs you\n- **Say go** for the phone re-plan.",
  "Nothing is built. Say the word and I start step 1.",
];
for (const text of GO_BLOCKS)
  check(
    `FAIL if a go-ask for own work passes (go-ask block): ${text.slice(0, 50)}`,
    /say go/.test(
      stopVerdict(turn(said("", ["Bash"]), said(text)), null) || "",
    ),
    String(goAsk(text)),
  );
const GO_PASSES = [
  "### Needs you\n- Say go to release 26.4 and push the tag.",
  "### Needs you\n- Say go and I'll send the message to the friend.",
  "### Needs you\n- Restart Nimbalyst.",
  "The tests go through the relay first, then go back to the PC.",
  "Done; the hook lets the call go on.",
];
for (const text of GO_PASSES)
  check(
    `FAIL if a release/message ask or plain 'go' is blocked (go-ask pass): ${text.slice(0, 50)}`,
    goAsk(text) === null,
    String(goAsk(text)),
  );

// Restart and click-test asks, real reply endings from the 2026-11-17 chat review: blocked even under "Needs you"
const { testAsk } = await import(pathToFileURL(HOOK).href);
const TEST_BLOCKS = [
  "### Needs you\n- Restart Nimbalyst, or switch to another theme and back to Ink Neon, to load it. Then tell me if it's right.",
  "### Needs you\n- At your next Nimbalyst restart: click Done on a test row in the tracker.",
  '- **T6:** say "restart" and I\'ll restart Nimbalyst (this chat closes when it does). Then click Done on a test row and tell me whether it moved.',
  '- Either "restart" so I run the launcher, or restart Nimbalyst yourself when it suits you; then do the T6 click and tell me what happened.',
  "- Click Done on the Job Tracker step that's waiting for you, the next time you restart Nimbalyst.",
  "### Needs you\n- **Restart Nimbalyst** so the wakeup fix loads.",
  "- **Done button:** restart Nimbalyst and click Done on a test row in the tracker. Tell the new session whether the row moved.",
  "Please restart Nimbalyst so the fix loads.",
  "You need to restart Nimbalyst to load it.",
  "- **Wakeup fix:** restart Nimbalyst so it loads.",
  "Quit and reopen Nimbalyst to load the fix.",
  "After the restart, click Done on a test row and let me know if it moved.",
  "- [ ] Restart Nimbalyst",
  "> Restart Nimbalyst so the fix loads.",
  "- Restart Nimbalyst so the phone relay fix loads.",
];
for (const text of TEST_BLOCKS)
  check(
    `FAIL if a restart or click-test ask passes (test-ask block): ${text.slice(0, 50)}`,
    /restart the app or click/.test(
      stopVerdict(turn(said("", ["Bash"]), said(text)), null) || "",
    ),
    String(testAsk(text)),
  );
const TEST_PASSES = [
  "The fix loads at the next Nimbalyst restart; it is under Check later in HANDOFF.md.",
  "- Open the app on your phone, tap Files and tell me whether the list shows.",
  "I clicked Done on the test row through the inspector and the row moved.",
  "Restarting the relay took 4 s.",
  "Restart is not needed: the hook is read on every call.",
  "    restart: unless-stopped",
  "I did not restart Nimbalyst; you never have to do that yourself.",
  "Click Save in the dialog; the toast will say Saved.",
  "I would say restarting is not needed here.",
  "Restart Claude Code so the new MCP server loads.",
  '- **The restart check missed common wordings.** "Please restart Nimbalyst", "Quit and reopen…", a bold label before the ask and checkbox lines all got through. They\'re caught now.',
];
for (const text of TEST_PASSES)
  check(
    `FAIL if a report or phone-only check is blocked (test-ask pass): ${text.slice(0, 50)}`,
    testAsk(text) === null,
    String(testAsk(text)),
  );

check(
  "passes: ends in a form",
  stopVerdict(
    turn(said(INCIDENT_1, ["mcp__nimbalyst__PromptForUserInput"])),
    null,
  ) === null,
);
check(
  "passes: handoff skill this turn",
  stopVerdict(turn(skill("handoff"), said(INCIDENT_1)), null) === null,
);
check(
  "passes: plain answer, no tool calls",
  stopVerdict(turn(said(INCIDENT_1)), null) === null,
);
check(
  "last_assistant_message wins over the transcript",
  !!stopVerdict(turn(said("ok", ["Bash"])), INCIDENT_2),
);

// Whole hook: block JSON, once only, off switch, subagents
const transcript = path.join(tmp, "t.jsonl");
fs.writeFileSync(
  transcript,
  turn(said("", ["Bash"]), said(INCIDENT_1))
    .map((e) => JSON.stringify(e))
    .join("\n") + "\n",
);
const state = path.join(tmp, "state");
const run = (extra = {}, env = {}) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: "Stop",
      session_id: "s1",
      transcript_path: transcript,
      ...extra,
    }),
    encoding: "utf8",
    env: { ...process.env, HOME: state, USERPROFILE: state, ...env },
  });
let r = run();
const out = r.stdout ? JSON.parse(r.stdout) : {};
check(
  "hook: blocks with a reason",
  out.decision === "block" && /next-step-gate/.test(out.reason),
  r.stdout + r.stderr,
);
check(
  "hook: the same step twice passes (no loop)",
  run({ stop_hook_active: true }).stdout === "",
);
check(
  "hook: a different step in the same turn blocks again",
  /S1, the shell/.test(
    run({
      stop_hook_active: true,
      last_assistant_message: "Next: S1, the shell steps.",
    }).stdout,
  ),
);
// two pushes so far (R1, S1): the third still blocks, the fourth is silent
check(
  "hook: a third push in the turn still blocks",
  /step 3/.test(
    run({
      stop_hook_active: true,
      last_assistant_message: "Next: step 3 of the plan.",
    }).stdout,
  ),
);
check(
  "hook: at most 3 pushes a turn (the 4th is silent)",
  run({
    stop_hook_active: true,
    last_assistant_message: "Next: step 9 of the plan.",
  }).stdout === "",
);
check(
  "hook: a new turn starts the count again",
  /step 9/.test(
    run({ last_assistant_message: "Next: step 9 of the plan." }).stdout,
  ),
);
check("hook: subagent skipped", run({ agent_id: "a1" }).stdout === "");
check(
  "hook: NEXT_STEP_GATE=off",
  run({}, { NEXT_STEP_GATE: "off" }).stdout === "",
);
r = spawnSync(process.execPath, [HOOK], { input: "junk", encoding: "utf8" });
check("hook: junk fails open", r.status === 0 && r.stdout === "");

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
