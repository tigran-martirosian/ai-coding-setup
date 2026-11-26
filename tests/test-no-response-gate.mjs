// Tests for hooks/no-response-gate.mjs. Run: node tests/test-no-response-gate.mjs
// Each case writes a small transcript and runs the hook on it as a Stop or UserPromptSubmit event.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { nodeStarts, UNDER_STARTS } from "./lib/kit.mjs";

const HOOK = fileURLToPath(
  new URL("../hooks/no-response-gate.mjs", import.meta.url),
);
const dir = mkdtempSync(join(tmpdir(), "test-no-response-gate-"));

let id = 0;
const typed = (text) => ({
  type: "user",
  uuid: `u${++id}`,
  promptSource: "sdk",
  message: { role: "user", content: text },
});
const meta = (text) => ({
  type: "user",
  isMeta: true,
  message: { role: "user", content: [{ type: "text", text }] },
});
const tool = (name, input) => ({
  type: "assistant",
  message: {
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "tool_use", id: `t${++id}`, name, input }],
  },
});
const result = (text = "done", err = false) => ({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: `t${id}`,
        content: text,
        ...(err ? { is_error: true } : {}),
      },
    ],
  },
});
const say = (text, model = "claude-opus-5-5") => ({
  type: "assistant",
  message: { role: "assistant", model, content: [{ type: "text", text }] },
});
const NRR = "No response requested.";
const synthetic = () => say(NRR, "<synthetic>");
const btw = (args) =>
  typed(
    `<command-message>btw</command-message>\n<command-name>/btw</command-name>\n<command-args>${args}</command-args>`,
  );
const SENT =
  'Sent to "Lead: build job". It reads the note before its next step.';
const steerSend = (note) => [
  tool("Bash", {
    command: `node ~/.claude/skills/steer/steer.mjs send - <<'EOF'\n${note}\nEOF`,
  }),
  result(SENT),
];
const refused = () =>
  result(
    "The user doesn't want to take this action right now. STOP what you are doing and wait for the user to tell you how to proceed.",
    true,
  );

let n = 0;
const transcriptOf = (entries) => {
  const file = join(dir, `t${++n}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return file;
};
const run = (entries, opts) => runOn(transcriptOf(entries), opts);
const runOn = (file, { input = {}, env = {} } = {}) => {
  const event = {
    session_id: `s${n}`,
    transcript_path: file,
    hook_event_name: "Stop",
    stop_hook_active: false,
    ...input,
  };
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).stdout;
};
const prompt = (entries, text) =>
  run(entries, {
    input: { hook_event_name: "UserPromptSubmit", prompt: text },
  });
const blocksEmpty = (out) =>
  out.includes('"decision":"block"') && out.includes("has no text");
const blocksBtw = (out) =>
  out.includes('"decision":"block"') &&
  out.includes("/btw note asks a question");
const reminds = (out) =>
  out.includes("additionalContext") && out.includes("cut off");

const BTW_Q = "Also the scaling should be higher. What is this?";
// A long session: 12 MB of older turns before the last one (only the file's end is read)
const OLD = Array.from({ length: 1200 }, () => say("x".repeat(10000)));
let long; // its file, written by the first case that uses it
// The user's stop (Nimbalyst's stop button; an app restart writes the same result)
const STOP =
  "[Tool call interrupted: the session ended before this call's result was recorded, so its outcome is unknown. Check whether it took effect before relying on it or running it again.]";
const stoppedTurn = [
  typed("Finish W3."),
  say(
    "The review found one Important bug: if an install stops midway, the person's own copy can no longer be restored. Sending it to one helper.",
  ),
  tool("Agent", { subagent_type: "worker-code", prompt: "fix" }),
  result(STOP),
  synthetic(),
];
const ASK =
  "Yo, what is going on? I stopped you. How long do you have left? What has been taking so much time?";
const START = "Start the stage 0 lead, and bring it up in the Nimbalyst view.";
// A background helper's finish notice, as Claude Code sends it as the prompt of a new turn
const HELPER_DONE = [
  "<task-notification>",
  "<task-id>a6fb01f828b9a4e1a</task-id>",
  "<tool-use-id>toolu_018KToBhFsmke2ertRuPCnbK</tool-use-id>",
  "<output-file>C:\\Temp\\claude\\s1\\tasks\\a6fb01f828b9a4e1a.output</output-file>",
  "<status>completed</status>",
  '<summary>Agent "Fix the restore step" finished</summary>',
  "<result>Done: the restore step is fixed and its test passes.</result>",
  "</task-notification>",
].join("\n");
// The same notice as the transcript stores it
const notice = (text) => ({
  ...typed(text),
  promptSource: "system",
  origin: { kind: "task-notification" },
});
const pre = (entries, name) =>
  run(entries, {
    input: { hook_event_name: "PreToolUse", tool_name: name, tool_input: {} },
  });

const cases = [
  [
    "12 MB transcript: the last turn is still judged (blocked)",
    () =>
      blocksEmpty(
        runOn(
          (long ??= transcriptOf([
            typed("hi"),
            ...OLD,
            typed("what's the build status?"),
            say(NRR),
          ])),
        ),
      ),
  ],
  // The Stop hook a person waits on stays quick on a long session: timed in bare node starts, so a busy computer
  // (CI runs every core at once) slows both sides alike
  [
    `12 MB transcript: judged within ${UNDER_STARTS} bare node starts`,
    () => {
      const t = nodeStarts(3, () => runOn(long));
      console.log(
        `      best of three: ${t.ms} ms = ${t.starts} starts of ${t.startMs} ms`,
      );
      return t.starts < UNDER_STARTS;
    },
  ],
  // Check 1: a typed message, no visible answer
  [
    'typed message, reply only "No response requested.": blocked',
    () => blocksEmpty(run([typed("what's the build status?"), say(NRR)])),
  ],
  [
    "typed message, only tool calls and no text: blocked",
    () =>
      blocksEmpty(
        run([
          typed("fix the bug"),
          tool("Read", { file_path: "src/a.js" }),
          result(),
        ]),
      ),
  ],
  [
    "typed message, a real answer: passes",
    () =>
      run([
        typed("what's the build status?"),
        tool("Bash", { command: "ls" }),
        result(),
        say("Two steps are building."),
      ]) === "",
  ],
  [
    "the answer only in last_assistant_message (transcript not flushed): passes",
    () =>
      run([typed("status?"), tool("Bash", { command: "ls" }), result()], {
        input: { last_assistant_message: "Two steps are building." },
      }) === "",
  ],
  [
    "a turn that ends in a form: passes",
    () =>
      run([
        typed("set it up"),
        tool("mcp__nimbalyst__PromptForUserInput", { fields: [] }),
        result(),
      ]) === "",
  ],
  [
    "the second stop (stop_hook_active): passes",
    () =>
      run([typed("status?"), say(NRR)], {
        input: { stop_hook_active: true },
      }) === "",
  ],
  [
    '"ok thanks" answered "No response requested.": passes',
    () => run([typed("ok thanks"), say(NRR)]) === "",
  ],
  [
    'a short instruction answered "No response requested.": blocked',
    () => blocksEmpty(run([typed("fix the bug"), say(NRR)])),
  ],
  // System events keep "No response requested."
  [
    'Claude Code host\'s [System: ...] notice, reply "No response requested.": passes',
    () =>
      run([
        typed("build it"),
        say("Started."),
        typed("[System: background task(s) you launched have settled]"),
        say(NRR),
      ]) === "",
  ],
  [
    "[SYSTEM NOTIFICATION - NOT USER INPUT] reminder: passes",
    () =>
      run([
        typed("build it"),
        say("Started."),
        typed(
          "[SYSTEM NOTIFICATION - NOT USER INPUT] the background task finished",
        ),
        say(NRR),
      ]) === "",
  ],
  [
    "[Child Session Update]: passes",
    () =>
      run([
        typed("lead it"),
        say("Started."),
        typed("[Child Session Update] child finished"),
        say(NRR),
      ]) === "",
  ],
  [
    "a task-notification entry: passes",
    () =>
      run([
        typed("build it"),
        say("Started."),
        {
          ...typed("<task-notification>task done</task-notification>"),
          origin: { kind: "task-notification" },
        },
        say(NRR),
      ]) === "",
  ],
  [
    "a stop-hook feedback entry is not a new turn",
    () =>
      blocksEmpty(
        run([
          typed("status?"),
          say(NRR),
          meta("Stop hook feedback:\nsomething"),
        ]),
      ),
  ],
  // Check 2: /btw with a question
  [
    "/btw question, reply only the forwarding line: blocked",
    () =>
      blocksBtw(
        run([
          btw(BTW_Q),
          meta("Base directory for this skill: btw"),
          ...steerSend(BTW_Q),
          say(SENT),
        ]),
      ),
  ],
  [
    '/btw typed raw, question without "?": blocked',
    () =>
      blocksBtw(
        run([
          typed("/btw what is lagging my pc, 9 gigs of memory"),
          ...steerSend("x"),
          say(SENT),
        ]),
      ),
  ],
  [
    "/btw question forwarded with send_prompt and a short note: blocked",
    () =>
      blocksBtw(
        run([
          btw("Why is it taking that long?"),
          tool("mcp__nimbalyst-host__send_prompt", { prompt: "x" }),
          result(),
          say("Passed it to the job session; it will handle it."),
        ]),
      ),
  ],
  [
    "/btw question, forwarded and answered: passes",
    () =>
      run([
        btw("How much longer will the 30 files take?"),
        ...steerSend("x"),
        say(
          SENT +
            "\n\nAbout 40 minutes: it has done 12 of 30 at about 2 minutes each.",
        ),
      ]) === "",
  ],
  [
    "/btw note with no question: passes",
    () =>
      run([
        btw("Center the working session. Also make the scaling higher."),
        ...steerSend("x"),
        say(SENT),
      ]) === "",
  ],
  [
    '/btw request starting with "can you" and no "?": passes',
    () =>
      run([
        btw("can you also add the blue button"),
        ...steerSend("x"),
        say(SENT),
      ]) === "",
  ],
  [
    '/btw request "... can you make them greener?": passes',
    () =>
      run([
        btw(
          "No brown on the buds. And the bright blue ones, can you make them look more real?",
        ),
        ...steerSend("x"),
        say(SENT),
      ]) === "",
  ],
  [
    '/btw with only a filler "you know what I mean?": passes',
    () =>
      run([
        btw(
          "Rewrite the other bullet points too. Like my whole document should read proper, you know what I mean?",
        ),
        ...steerSend("x"),
        say(SENT),
      ]) === "",
  ],
  [
    "/btw question after a request: blocked",
    () =>
      blocksBtw(
        run([
          btw("Can you add the button? Why is it taking that long"),
          ...steerSend("x"),
          say(SENT),
        ]),
      ),
  ],
  [
    '/btw question answered only "No response requested.": blocked',
    () => blocksBtw(run([btw("is the build done?"), say(NRR)])),
  ],
  [
    "/btw answer on the same line as the forwarding note: passes",
    () =>
      run([
        btw("is the build done?"),
        ...steerSend("x"),
        say('Sent to "worker-1". It is on step 3 of 5, writing the tests.'),
      ]) === "",
  ],
  [
    '/btw answered "Yes." with nothing forwarded: passes',
    () => run([btw("is the build done?"), say("Yes.")]) === "",
  ],
  [
    '/btw forwarded through ToolSearch + SendMessage, "I relayed your question": blocked',
    () =>
      blocksBtw(
        run([
          btw("Why is it taking that long?"),
          tool("ToolSearch", { query: "select:SendMessage" }),
          result(),
          tool("SendMessage", { to: "x", message: "y" }),
          result(),
          say("I relayed your question to the busy session."),
        ]),
      ),
  ],
  [
    '/btw instruction starting with "When": passes',
    () =>
      run([
        btw("When it finishes, also run the tests."),
        ...steerSend("x"),
        say(SENT),
      ]) === "",
  ],
  [
    '/btw "could you tell me what\'s left?": blocked',
    () =>
      blocksBtw(
        run([
          btw("could you tell me what's left?"),
          ...steerSend("x"),
          say(SENT),
        ]),
      ),
  ],
  [
    '/btw "do you know why?" without a question mark: blocked',
    () =>
      blocksBtw(
        run([btw("do you know why it broke"), ...steerSend("x"), say(SENT)]),
      ),
  ],
  [
    "/btw, second stop: passes",
    () =>
      run([btw(BTW_Q), ...steerSend(BTW_Q), say(SENT)], {
        input: { stop_hook_active: true },
      }) === "",
  ],
  // UserPromptSubmit: a turn cut off before any answer
  [
    "cut off after a refused tool, a different new message: reminder with the earlier text",
    () => {
      const out = prompt(
        [
          typed("how do I show the outlines?"),
          tool("Bash", { command: "ls" }),
          refused(),
          synthetic(),
        ],
        "what button is materials",
      );
      return reminds(out) && out.includes("how do I show the outlines?");
    },
  ],
  [
    "the same message delivered again: no reminder",
    () =>
      prompt(
        [
          typed("is half an hour enough?  <NIMBALYST_SYSTEM_MESSAGE> doc"),
          tool("Bash", { command: "ls" }),
          refused(),
          synthetic(),
        ],
        "is half an hour enough?  <NIMBALYST_SYSTEM_MESSAGE> other doc",
      ) === "",
  ],
  [
    "the new prompt already in the transcript: still reminds",
    () =>
      reminds(
        prompt(
          [typed("first question?"), synthetic(), typed("second question?")],
          "second question?",
        ),
      ),
  ],
  [
    "the cut-off turn had already answered in text: no reminder",
    () =>
      prompt(
        [
          typed("status?"),
          say(
            "Two steps are building: the tests and the deploy. Both started ten minutes ago and should be done in about twenty.",
          ),
          tool("Bash", { command: "ls" }),
          refused(),
          synthetic(),
        ],
        "ok next",
      ) === "",
  ],
  [
    "a one-line preamble before the refused tool is no answer: reminds",
    () =>
      reminds(
        prompt(
          [
            typed("Why did the test fail?"),
            say("Let me check."),
            tool("Bash", { command: "ls" }),
            refused(),
            synthetic(),
          ],
          "do the other thing",
        ),
      ),
  ],
  [
    "a message with no ASCII letters is not taken for the same message: reminds",
    () =>
      reminds(
        prompt(
          [
            typed("Почему тест упал?"),
            tool("Bash", { command: "ls" }),
            refused(),
            synthetic(),
          ],
          "Сделай ещё вот это",
        ),
      ),
  ],
  [
    "the same message reworded: no reminder",
    () =>
      prompt(
        [
          typed(
            "He started the game, have you even fixed anything or what is not fixed yet?",
          ),
          synthetic(),
        ],
        "start the game. have you even fixed anything or what is not fixed yet",
      ) === "",
  ],
  [
    "a prompt from a lead (Lead: ...): no reminder",
    () =>
      prompt(
        [typed("why is it slow?"), synthetic()],
        "Lead: your run was interrupted, continue",
      ) === "",
  ],
  [
    "the cut-off turn began with a system event: no reminder",
    () =>
      prompt(
        [
          typed("build"),
          say("Started."),
          typed("[System: background task(s) settled]"),
          synthetic(),
        ],
        "next",
      ) === "",
  ],
  [
    'the model\'s own "No response requested." (not synthetic): no reminder',
    () => prompt([typed("status?"), say(NRR)], "next") === "",
  ],
  [
    "an [Request interrupted by user] note is skipped",
    () =>
      reminds(
        prompt(
          [
            typed("why is it slow?"),
            tool("Bash", { command: "ls" }),
            typed("[Request interrupted by user for tool use]"),
            synthetic(),
          ],
          "other",
        ),
      ),
  ],
  // After a stop: the next prompt gets a note to answer and start no work until the user says to go on
  [
    "stop: next prompt gets the [stop] note",
    () => prompt(stoppedTurn, ASK).includes("[stop] The user stopped"),
  ],
  [
    "stop: a plain new instruction to start gets no [stop] note (an app restart writes the same result)",
    () => !prompt(stoppedTurn, START).includes("[stop]"),
  ],
  // A helper's finish notice opens a turn of its own; it is not the user's message, so the note (which says "this
  // reply answers their message") would halt a lead after every helper. The user's next typed stop still gets it.
  [
    "stop: a helper's finish notice after an answered stop gets no [stop] note (it would halt the lead)",
    () =>
      !prompt(
        [...stoppedTurn, typed(ASK), say("Two steps left; waiting for go.")],
        HELPER_DONE,
      ).includes("[stop]"),
  ],
  [
    "stop: a finish notice with text before <task-notification> on its first line gets no [stop] note (not typed)",
    () =>
      !prompt(
        stoppedTurn,
        `Background: ${HELPER_DONE.replace("completed", "stopped")}`,
      ).includes("[stop]"),
  ],
  [
    "stop: after a helper's finish notice, the user's next stop message still gets the [stop] note",
    () =>
      prompt(
        [
          ...stoppedTurn,
          typed(ASK),
          say("Two steps left; waiting for go."),
          notice(HELPER_DONE),
          say("The helper finished; its fix is in."),
        ],
        "Hold on, what is left?",
      ).includes("[stop] The user stopped"),
  ],
  // Only a message that says to stop holds: the stop button and a message sent mid-turn write the same interrupted
  // result 0.2-0.4 s before the message (the real stops of session c779e67d, 2026-11-11 00:47:58Z and 00:50:51Z)
  [
    "stop: a correction sent mid-turn ('fix this contraption at the bottom as well') gets no [stop] note",
    () => {
      const cut = [
        typed("Fix the shop layout."),
        tool("Bash", { command: "ls" }),
        refused(),
        typed("[Request interrupted by user for tool use]"),
        synthetic(),
      ];
      return !prompt(
        cut,
        "fix this contraption at the bottom as well",
      ).includes("[stop]");
    },
  ],
  // A message that tells Claude to stop holds; one that only asks about or mentions a stop does not
  ...[
    "stop",
    "stop it",
    "I stopped you",
    "please stop building",
    "halt",
    "hold on",
    "don't run that",
    "wait",
    "Wait, why did you stop?",
    "why won't you stop",
    "why can't you stop",
    "why don't you stop",
    "will you stop",
    "can you stop",
    // Voice text has no commas or question marks: a question before the stop must not take the stop with it
    "why is this still running stop it now",
    "did you even read it stop everything",
    "why would you do that please stop",
    "why are you deploying dont continue",
    "Ok, did I not say stop",
    "No, did you hear me, stop now",
    // A go word in a question about the work is no go
    "Why did you start deploying? Stop.",
    "how come you keep going stop",
  ].map((text) => [
    `stop: "${text}" says to stop and gets the [stop] note`,
    () => prompt(stoppedTurn, text).includes("[stop] The user stopped"),
  ]),
  ...[
    "why did you stop, bro",
    "did you stop?",
    "you stopped again",
    "what made it stop",
  ].map((text) => [
    `stop: "${text}" only asks about a stop and gets no [stop] note`,
    () => !prompt(stoppedTurn, text).includes("[stop]"),
  ]),
  // A go word outside the question still says to go on
  ...[
    "Why is it slow? Stop that and continue.",
    "why so slow, stop the old one and start the new lead",
  ].map((text) => [
    `stop: "${text}" says to go on and gets no [stop] note`,
    () => !prompt(stoppedTurn, text).includes("[stop]"),
  ]),
  [
    "stop: the stop note and the cut-off reminder come as one output",
    () => {
      const out = prompt(
        [
          typed("Why did the test fail?"),
          tool("Agent", { prompt: "x" }),
          result(STOP),
          synthetic(),
        ],
        ASK,
      );
      try {
        JSON.parse(out);
      } catch {
        return false;
      }
      return out.includes("[stop]") && reminds(out);
    },
  ],
  // D5 (hooks cut, plan 2.8): the PreToolUse part is cut, so a PreToolUse event gets nothing, even for a held
  // stop's work call; the prompt and Stop parts above work as before
  [
    "D5 PreToolUse: no output, not even for an Agent call after a held stop",
    () => pre([...stoppedTurn, typed(ASK)], "Agent") === "",
  ],
  // Off switch, subagents, errors
  [
    "NO_RESPONSE_GATE=off: passes",
    () =>
      run([typed("status?"), say(NRR)], {
        env: { NO_RESPONSE_GATE: "off" },
      }) === "",
  ],
  [
    "a subagent (agent_id): passes",
    () =>
      run([typed("status?"), say(NRR)], { input: { agent_id: "a1" } }) === "",
  ],
  [
    "a missing transcript fails open",
    () =>
      run([], { input: { transcript_path: join(dir, "missing.jsonl") } }) ===
      "",
  ],
  [
    "a missing transcript leaves no line in the crash log (none exists on a session's first prompt)",
    () => {
      const log = join(dir, "crash.log");
      run([], {
        input: {
          transcript_path: join(dir, "missing.jsonl"),
          hook_event_name: "UserPromptSubmit",
        },
        env: { HOOK_ERRORS_LOG: log },
      });
      return !existsSync(log);
    },
  ],
  // Russian (`--language russian`)
  [
    "RU: /btw question (Почему ...?), reply only the forwarding line: blocked",
    () =>
      blocksBtw(
        run([
          btw("Почему это так долго грузится?"),
          meta("Base directory for this skill: btw"),
          ...steerSend("x"),
          say(SENT),
        ]),
      ),
  ],
  [
    'RU: /btw question without "?" (как ...): blocked',
    () =>
      blocksBtw(
        run([
          btw("как это работает сейчас"),
          meta("Base directory for this skill: btw"),
          ...steerSend("x"),
          say(SENT),
        ]),
      ),
  ],
  [
    "RU: /btw request (Можешь добавить ...), forwarded only: passes",
    () =>
      !blocksBtw(
        run([
          btw("Можешь добавить синюю кнопку на главный экран"),
          meta("Base directory for this skill: btw"),
          ...steerSend("x"),
          say(SENT),
        ]),
      ),
  ],
  [
    'RU: /btw note with "что-то" (not a question word): passes',
    () =>
      !blocksBtw(
        run([
          btw("Что-то сломалось в списке задач"),
          meta("Base directory for this skill: btw"),
          ...steerSend("x"),
          say(SENT),
        ]),
      ),
  ],
  [
    'RU: "спасибо" answered "No response requested.": passes',
    () => run([typed("спасибо"), say(NRR)]) === "",
  ],
  [
    'RU: a short instruction answered "No response requested.": blocked',
    () => blocksEmpty(run([typed("исправь ошибку"), say(NRR)])),
  ],
];

let failed = 0;
for (const [name, check] of cases) {
  let ok = false;
  try {
    ok = check();
  } catch (e) {
    console.log(String(e));
  }
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(`\n${cases.length - failed} of ${cases.length} passed`);
process.exit(failed ? 1 : 0);
