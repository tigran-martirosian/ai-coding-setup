// Tests for ~/.claude/skills/steer/steer.mjs (the /btw script and the Note button): when a note reaches the
// busy session, and who it is sent to. Runs against a throwaway home folder; touches nothing real.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const STEER = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "steer",
  "steer.mjs",
);
// The real path: a script finds its own folder by it (macOS /var is /private/var), so the logs filed here match
const home = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "steer-test-")),
);
const work = path.join(home, "work");
fs.mkdirSync(work);
const key = (c) => String(c).replace(/[^a-zA-Z0-9]/g, "-");
const inboxDir = path.join(home, ".claude", "steer");
const inbox = path.join(inboxDir, `${key(work)}.jsonl`);
const projDir = path.join(home, ".claude", "projects", key(work));
fs.mkdirSync(inboxDir, { recursive: true });
fs.mkdirSync(projDir, { recursive: true });

const run = (args, { input = "", env = {}, cwd = work } = {}) => {
  const r = spawnSync(process.execPath, [STEER, ...args], {
    input,
    cwd,
    encoding: "utf8",
    env: {
      ...process.env,
      USERPROFILE: home,
      HOME: home,
      CLAUDE_CODE_SESSION_ID: "",
      STEER_WAIT: "0",
      STEER_NIMBALYST_DB: path.join(home, "no-nimbalyst.sqlite"),
      ...env,
    },
  });
  return { out: r.stdout.trim(), code: r.status };
};
const hook = (ev, extra = {}, env = {}) => {
  const r = run(["--hook"], {
    env,
    input: JSON.stringify({
      hook_event_name: ev,
      session_id: "busy-1",
      cwd: work,
      ...extra,
    }),
  });
  return r.out ? JSON.parse(r.out) : null;
};
const put = (notes, file = inbox) =>
  fs.writeFileSync(file, notes.map((n) => JSON.stringify(n)).join("\n") + "\n");
const note = (msg, o = {}) => ({ ts: Date.now(), to: "busy-1", msg, ...o });
const left = (file = inbox) =>
  fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
const sleep = (ms) =>
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
const transcript = (id, lastStop, middle = []) =>
  fs.writeFileSync(
    path.join(projDir, `${id}.jsonl`),
    [
      { type: "user", message: { content: `request of ${id}` } },
      ...middle,
      {
        type: "assistant",
        message: {
          stop_reason: lastStop,
          content: [
            lastStop === "end_turn"
              ? { type: "text", text: "All done." }
              : { type: "tool_use", name: "Bash", input: {} },
          ],
        },
      },
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );

let pass = 0,
  fail = 0;
const ok = (name, cond) => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "ok  " : "FAIL"}  ${name}`);
};

// 1-3: before a call that runs long or starts something, the call is held with the note; such calls of
// the same step are held too; the retry a moment later goes through. (Only those are
// held, so these name a helper launch.)
const agentCall = { tool_name: "Agent", tool_input: { prompt: "build it" } };
put([note("use the blue one")]);
let o = hook("PreToolUse", agentCall);
ok(
  "before a tool call: the call is held and carries the note",
  o?.hookSpecificOutput?.permissionDecision === "deny" &&
    o.hookSpecificOutput.permissionDecisionReason.includes("use the blue one"),
);
o = hook("PreToolUse", agentCall);
ok(
  "a second call of the same step is held too",
  o?.hookSpecificOutput?.permissionDecision === "deny" &&
    o.hookSpecificOutput.permissionDecisionReason.includes("Held together"),
);
ok(
  "a tool result in that moment does not repeat the note",
  hook("PostToolUse") === null,
);
sleep(1700);
ok("the retry goes through", hook("PreToolUse", agentCall) === null);
ok("the delivered note is cleared", left().length === 0);

// A quick call is not held: a held call does not run and is sent again, one more request.
// Its result carries the note seconds later.
put([note("use the red one")]);
ok(
  "a quick call runs: not held, and the note waits",
  hook("PreToolUse", { tool_name: "Read", tool_input: { file_path: "a" } }) ===
    null &&
    left().length === 1 &&
    !left()[0].seen,
);
o = hook("PostToolUse", { tool_name: "Read" });
ok(
  "its result carries the note",
  o?.hookSpecificOutput?.additionalContext.includes("use the red one") &&
    left().length === 0,
);
put([note("one at a time")]);
ok(
  "a plain Bash call is not held",
  hook("PreToolUse", { tool_name: "Bash", tool_input: { command: "ls" } }) ===
    null,
);
ok(
  "a background Bash call is not held",
  hook("PreToolUse", {
    tool_name: "Bash",
    tool_input: { command: "x", run_in_background: true, timeout: 600000 },
  }) === null,
);
o = hook("PreToolUse", {
  tool_name: "Bash",
  tool_input: { command: "npm test", timeout: 600000 },
});
ok(
  "a Bash call with a timeout over 2 min is held, and says nothing in it ran",
  o?.hookSpecificOutput?.permissionDecision === "deny" &&
    o.hookSpecificOutput.permissionDecisionReason.includes(
      "Nothing in it ran",
    ) &&
    o.hookSpecificOutput.permissionDecisionReason.includes("again in full"),
);
ok(
  "a quick call of the same step is not held with it",
  hook("PreToolUse", { tool_name: "Read", tool_input: {} }) === null,
);
ok(
  "a question to the user in the same step is held with it",
  hook("PreToolUse", {
    tool_name: "mcp__nimbalyst__AskUserQuestion",
    tool_input: {},
  })?.hookSpecificOutput?.permissionDecisionReason.includes("Held together"),
);
sleep(1700);
hook("PostToolUse");
fs.rmSync(inbox, { force: true });

// 4: after a tool call, the note rides along with the result.
put([note("skip step 3")]);
o = hook("PostToolUse");
ok(
  "after a tool call: the note comes with the result",
  o?.hookSpecificOutput?.hookEventName === "PostToolUse" &&
    o.hookSpecificOutput.additionalContext.includes("skip step 3"),
);
ok("and is cleared", left().length === 0);
// 2026-11-11: a note waited 9 min behind a 10-minute `gh run watch`, then the session blocked again
put([note("check the folders", { ts: Date.now() - 9 * 60e3 })]);
o = hook("PostToolUse", {
  tool_name: "Bash",
  tool_input: { command: "gh run watch 1", timeout: 600000 },
});
ok(
  "a note that waited through a long call says how long, and sends the next wait to the background",
  o?.hookSpecificOutput?.additionalContext.includes("waited 9 min") &&
    o.hookSpecificOutput.additionalContext.includes("run_in_background: true"),
);
put([note("use the blue one")]);
o = hook("PostToolUse");
ok(
  "a fresh note has no wait line",
  o?.hookSpecificOutput?.additionalContext.includes("use the blue one") &&
    !o.hookSpecificOutput.additionalContext.includes("waited"),
);

// 5: at the end of a reply, the session is kept going.
put([note("also check the footer")]);
o = hook("Stop");
ok(
  "when finishing: the session is kept going with the note",
  o?.decision === "block" && o.reason.includes("also check the footer"),
);
ok("and is cleared", left().length === 0);
ok("finishing with no note: nothing happens", hook("Stop") === null);
// D8: a turn that makes no tool call never runs PreToolUse or PostToolUse: its Stop hands the note over
const noToolTp = path.join(home, "no-tool-turn.jsonl");
fs.writeFileSync(
  noToolTp,
  [
    {
      type: "user",
      promptSource: "sdk",
      message: { role: "user", content: "What is the plan?" },
    },
    {
      type: "assistant",
      message: {
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        content: [{ type: "text", text: "Here is the plan." }],
      },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n") + "\n",
);
put([note("answer in Russian", { id: "d8a" })]);
o = hook("Stop", {
  transcript_path: noToolTp,
  last_assistant_message: "Here is the plan.",
});
ok(
  "a note sent during a turn with no tool call is handed over at that turn's Stop",
  o?.decision === "block" && o.reason.includes("[note d8a] answer in Russian"),
);
fs.rmSync(inbox, { force: true });

// 5b: the final reply lists each delivered note back under "### Your notes"; a reply that skips one is sent back once.
const notesTp = path.join(home, "notes-back.jsonl");
const NOTE_N1 =
  "[note n1] Forget about the quick task stuff, let's do it on Wednesday.";
const writeTp = (entries) =>
  fs.writeFileSync(
    notesTp,
    entries.map((e) => JSON.stringify(e)).join("\n") + "\n",
  );
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Do W2, the quick tasks pass, then W3." },
  },
  {
    type: "attachment",
    attachment: {
      type: "hook_additional_context",
      content: [
        `[btw] The user sent this while you were working. … \n- ${NOTE_N1}`,
      ],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "W3 is merged." }],
    },
  },
]);
o = hook("Stop", {
  transcript_path: notesTp,
  last_assistant_message: "W3 is merged and tested.",
});
ok(
  "notes: a reply that skips the note is blocked",
  o?.decision === "block" && o.reason.includes("Forget about the quick task"),
);
ok(
  "notes: a reply that lists it back passes",
  hook("Stop", {
    transcript_path: notesTp,
    last_assistant_message:
      'W3 is merged.\n### Your notes\n- "Forget about the quick task stuff": moved to Wednesday, W2 skipped.',
  }) === null,
);
ok(
  "notes: blocks only once",
  hook("Stop", {
    transcript_path: notesTp,
    stop_hook_active: true,
    last_assistant_message: "W3 is merged.",
  }) === null,
);
// A note from a turn cut off by a stop (synthetic "No response requested.") is still owed in the next reply
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Finish W3." },
  },
  {
    type: "attachment",
    attachment: {
      type: "hook_additional_context",
      content: [`[btw] … \n- ${NOTE_N1}`],
    },
  },
  {
    type: "assistant",
    message: {
      model: "<synthetic>",
      stop_reason: "stop_sequence",
      content: [{ type: "text", text: "No response requested." }],
    },
  },
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "What is going on? I stopped you." },
  },
]);
o = hook("Stop", {
  transcript_path: notesTp,
  last_assistant_message: "Stopped. Done: S8. Left: W3 fixes.",
});
ok(
  "notes: a note from the cut-off turn is still asked for",
  o?.decision === "block" && o.reason.includes("Forget about the quick task"),
);
// A note already listed back in an earlier reply is not asked for again
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Finish W3." },
  },
  {
    type: "attachment",
    attachment: {
      type: "hook_additional_context",
      content: [`[btw] … \n- ${NOTE_N1}`],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: 'Done.\n### Your notes\n- "Forget about the quick task": moved.',
        },
      ],
    },
  },
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Now do S9." },
  },
]);
ok(
  "notes: a note from an earlier answered turn is not asked for again",
  hook("Stop", {
    transcript_path: notesTp,
    last_assistant_message: "S9 is done.",
  }) === null,
);
// Only notes steer delivered count: not a marker in a forwarded child report, nor one in a file read
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Do W2." },
  },
  {
    type: "attachment",
    attachment: {
      type: "hook_additional_context",
      content: [
        `[report] This is a child session's report …\n[note r1] W2 is done: 3 files changed.`,
      ],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      content: [
        {
          type: "tool_use",
          id: "rd1",
          name: "Read",
          input: { file_path: "tests/test-steer.mjs" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "rd1",
          content: `101\tconst NOTE_N1 = "${NOTE_N1}";\n105\t  content: [\`[btw] The user sent this while you were working. … \\n- \${NOTE_N1}\`]`,
        },
      ],
    },
  },
]);
ok(
  "notes: a forwarded report's marker and a file read are not notes",
  hook("Stop", {
    transcript_path: notesTp,
    last_assistant_message: "W2 is done.",
  }) === null,
);
// A reply in another language, under any ### heading, lists the note back by its words
const NOTE_RU = "[note n2] Забудь про быстрые задачи, сделаем их в среду.";
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Сделай W2." },
  },
  {
    type: "attachment",
    attachment: {
      type: "hook_additional_context",
      content: [
        `[btw] The user sent this while you were working. … \n- ${NOTE_RU}`,
      ],
    },
  },
]);
ok(
  "notes: a Russian reply under a ### heading with the note's words passes",
  hook("Stop", {
    transcript_path: notesTp,
    last_assistant_message:
      'W3 готов.\n### Ваши заметки\n- "Забудь про быстрые задачи": перенёс на среду.',
  }) === null,
);
// 2026-11-20: a note handed over at a Stop was listed back in the reply that answered it, then listed again in
// the next turn's reply ("answered last turn"); no Stop hook asked for it the second time. The hand-over text
// ("In your final reply, list it back") invited it, so every hand-over says: once, in the reply that ends this
// turn, never in a later reply.
put([note("are we just working forever in this session?", { id: "d5a" })]);
const d5Texts = [
  hook("PostToolUse")?.hookSpecificOutput?.additionalContext || "",
];
put([note("are we just working forever in this session?", { id: "d5b" })]);
d5Texts.push(hook("Stop")?.reason || "");
put([note("are we just working forever in this session?", { id: "d5c" })]);
d5Texts.push(
  hook("PreToolUse", agentCall)?.hookSpecificOutput?.permissionDecisionReason ||
    "",
);
sleep(1700);
hook("PostToolUse");
fs.rmSync(inbox, { force: true });
ok(
  "notes: each hand-over asks for the list-back once, in this turn's reply, and never again in a later reply",
  d5Texts.every(
    (t) =>
      t.includes("### Your notes") &&
      /\bonce\b/.test(t) &&
      /later repl(y|ies)[^.\n]*(not|never|n't)/i.test(t),
  ),
);
// The real shape: the note came as Stop hook feedback, the next reply listed it back, then a new turn ends
// without it: no send-back.
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Put job 11a in the phase 2 list." },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: "Job 11a is in the list." }],
    },
  },
  {
    type: "user",
    isMeta: true,
    message: {
      role: "user",
      content: `Stop hook feedback:\n[btw] The user sent this just as you were finishing, so don't stop yet. It is an addition or a correction to the current task …\n- [note n3] Are we just working forever in this session?\nDeal with it now, then finish.`,
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "end_turn",
      content: [
        {
          type: "text",
          text: '### Your notes\n- "Are we just working forever in this session?": no, one session per job.',
        },
      ],
    },
  },
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "What about new projects?" },
  },
]);
ok(
  "notes: a Stop-delivered note listed back in the next reply is not asked for in the turn after",
  hook("Stop", {
    transcript_path: notesTp,
    last_assistant_message: "New projects start with a tidy skeleton.",
  }) === null,
);
// Listed back in any reply counts, also a text written mid-turn in a turn the user then stopped
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Finish W3." },
  },
  {
    type: "attachment",
    attachment: {
      type: "hook_additional_context",
      content: [`[btw] … \n- ${NOTE_N1}`],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: '### Your notes\n- "Forget about the quick task stuff": moved to Wednesday.',
        },
        { type: "tool_use", id: "b1", name: "Bash", input: { command: "ls" } },
      ],
    },
  },
  {
    type: "assistant",
    message: {
      model: "<synthetic>",
      stop_reason: "stop_sequence",
      content: [{ type: "text", text: "No response requested." }],
    },
  },
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Go on." },
  },
]);
ok(
  "notes: a note listed back in any earlier reply text is never asked for again",
  hook("Stop", {
    transcript_path: notesTp,
    last_assistant_message: "W3 is done.",
  }) === null,
);
// A mid-turn text that only talks about the same subject (a "### Plan" with the note's words) is not a list-back:
// only "### Your notes" or the note's id there counts, so the final reply is still asked for it.
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Finish W3." },
  },
  {
    type: "attachment",
    attachment: {
      type: "hook_additional_context",
      content: [`[btw] … \n- ${NOTE_N1}`],
    },
  },
  {
    type: "assistant",
    message: {
      model: "claude-opus-5-5",
      stop_reason: "tool_use",
      content: [
        {
          type: "text",
          text: "### Plan\n- The quick task pass waits; W3 first.",
        },
        { type: "tool_use", id: "b2", name: "Bash", input: { command: "ls" } },
      ],
    },
  },
]);
o = hook("Stop", {
  transcript_path: notesTp,
  last_assistant_message: "W3 is done.",
});
ok(
  "notes: a mid-turn ### heading that only shares the note's words is not a list-back; the final reply is still asked for the note",
  o?.decision === "block" &&
    o.reason.includes("Forget about the quick task stuff"),
);
// D6: each note line says it is the user's and when it was sent (local HH:MM); the [note id] marker still parses
const d6ts = Date.now() - 60e3;
const d6at = [new Date(d6ts).getHours(), new Date(d6ts).getMinutes()]
  .map((x) => String(x).padStart(2, "0"))
  .join(":");
put([
  note("Forget about the quick task stuff", { id: "d6a", ts: d6ts }),
  note("Check the logs\n\n(Sent from the phone.)", { id: "d6b", ts: d6ts }),
]);
const d6ctx = hook("PostToolUse")?.hookSpecificOutput?.additionalContext || "";
ok(
  "a handed-over note line says it is the user's and the local time it was sent, at the end of its first line",
  d6ctx.includes(
    `\n- [note d6a] Forget about the quick task stuff (the user's note, sent ${d6at})\n`,
  ) &&
    d6ctx.includes(
      `\n- [note d6b] Check the logs (the user's note, sent ${d6at})\n\n(Sent from the phone.)`,
    ),
);
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Do W2." },
  },
  {
    type: "attachment",
    attachment: { type: "hook_additional_context", content: [d6ctx] },
  },
]);
o = hook("Stop", {
  transcript_path: notesTp,
  last_assistant_message: "W2 is done.",
});
ok(
  "a timed note line still parses: the send-back quotes the note's own words, not the label",
  o?.decision === "block" &&
    o.reason.includes('- "Forget about the quick task stuff"') &&
    !o.reason.includes("sent 09:05"),
);
ok(
  "a timed note line is still matched when the reply lists it back",
  hook("Stop", {
    transcript_path: notesTp,
    last_assistant_message:
      '### Your notes\n- "Forget about the quick task": moved.\n- "Check the logs": done.',
  }) === null,
);
// A note typed with Windows line ends: the label goes before the \r, at the end of the first line's words
put([note("Check the logs\r\nand the build", { id: "d6c", ts: d6ts })]);
const d6crlf = hook("PostToolUse")?.hookSpecificOutput?.additionalContext || "";
writeTp([
  {
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: "Do W2." },
  },
  {
    type: "attachment",
    attachment: { type: "hook_additional_context", content: [d6crlf] },
  },
]);
o = hook("Stop", {
  transcript_path: notesTp,
  last_assistant_message: "W2 is done.",
});
ok(
  "a CRLF note gets its time label before the \\r, and the send-back still quotes the note's own words",
  d6crlf.includes(
    `\n- [note d6c] Check the logs (the user's note, sent ${d6at})\r\nand the build`,
  ) &&
    o?.decision === "block" &&
    o.reason.includes('- "Check the logs"') &&
    !o.reason.includes("the user's note, sent"),
);

// 6: a helper agent inside the busy session must not take the note.
// The copy goes only to a helper the session waits for (a foreground Agent call with no result yet), so
// these name the session's transcript.
const parentT = path.join(home, "parent.jsonl");
const agentUse = (id) =>
  JSON.stringify({
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Agent", input: {} }] },
  }) + "\n";
fs.writeFileSync(parentT, agentUse("call-fg"));
const sub = (id, tp = parentT) => ({ agent_id: id, transcript_path: tp });
put([note("for the main session")]);
ok(
  "a subagent does not take the note",
  hook("PreToolUse", sub("sub-1")) === null && left().length === 1,
);
o = hook("PostToolUse", sub("sub-1"));
ok(
  "a subagent gets a copy after a tool call, to pass on in its report",
  o?.hookSpecificOutput?.additionalContext.includes("for the main session") &&
    o.hookSpecificOutput.additionalContext.includes("User note received:"),
);
ok(
  "a note not about the helper's task does not stop it; one that tells it to stop does (user, 2026-11-18)",
  o?.hookSpecificOutput?.additionalContext.includes("otherwise carry on") &&
    o.hookSpecificOutput.additionalContext.includes(
      "Stopped early for a user note:",
    ),
);
ok("only once per subagent", hook("PostToolUse", sub("sub-1")) === null);
ok(
  "another subagent gets its own copy",
  hook(
    "PostToolUse",
    sub("sub-2"),
  )?.hookSpecificOutput?.additionalContext.includes("for the main session"),
);
ok(
  "the note stays for the main session",
  left().length === 1 && !left()[0].seen,
);
ok(
  "a helper's own transcript path leads to its session's",
  hook(
    "PostToolUse",
    sub("sub-3", path.join(home, "parent", "subagents", "agent-sub3.jsonl")),
  )?.hookSpecificOutput?.additionalContext.includes("for the main session"),
);
fs.writeFileSync(
  parentT,
  agentUse("call-bg") +
    JSON.stringify({
      type: "user",
      message: {
        content: [
          {
            type: "tool_result",
            tool_use_id: "call-bg",
            content: "Async agent launched successfully.",
          },
        ],
      },
    }) +
    "\n",
);
ok(
  "a background helper gets no copy: the session reads the note itself",
  hook("PostToolUse", sub("sub-4")) === null &&
    !(left()[0].relayed || []).includes("sub-4"),
);

// 7: another session leaves it alone.
ok(
  "another session does not take the note",
  hook("PostToolUse", { session_id: "someone-else" }) === null &&
    left().length === 1,
);

// 8: the session moved to another folder since the note was sent.
o = hook("PostToolUse", { cwd: path.join(home, "elsewhere") });
ok(
  "a session that changed folder still gets the note",
  o?.hookSpecificOutput?.additionalContext.includes("for the main session"),
);

// 9: old notes are dropped silently.
put([note("waited long", { ts: Date.now() - 90 * 60e3 })]);
ok(
  "a note an hour and a half old still arrives (long tool calls, background jobs)",
  hook("PostToolUse")?.hookSpecificOutput?.additionalContext.includes(
    "waited long",
  ),
);
put([note("stale", { ts: Date.now() - 121 * 60e3 })]);
ok(
  "a note older than 2 hours is dropped",
  hook("PreToolUse") === null && left().length === 0,
);

// 10: no inbox folder at all.
fs.rmSync(inboxDir, { recursive: true, force: true });
ok("no notes folder: nothing happens", hook("PreToolUse") === null);

// 11-13: who it is sent to.
transcript("aaaaaaaa-self", "tool_use");
transcript("bbbbbbbb-busy", "tool_use");
let r = run(["send", "hello"], {
  env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" },
});
ok(
  "the sending session is not offered as a target; an unnamed target is called by its last request",
  r.code === 0 &&
    r.out.startsWith(
      'Queued for the session last asked "request of bbbbbbbb-busy", not delivered yet.',
    ),
);
ok(
  "the note is queued for the busy session",
  left().length === 1 && left()[0].to === "bbbbbbbb-busy",
);
transcript("bbbbbbbb-busy", "end_turn");
r = run(["send", "hello again"], {
  env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" },
});
ok(
  "a finished session: the note is left, with the 20 minute limit",
  r.code === 0 &&
    r.out.startsWith("Left for ") &&
    r.out.includes("idle") &&
    r.out.includes("within 2 hours"),
);
transcript("cccccccc-busy", "tool_use");
r = run(["send", "which one"], {
  env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" },
});
ok(
  "several targets, none named: the busy one gets the note, not the finished one",
  r.code === 0 &&
    r.out.startsWith(
      'Queued for the session last asked "request of cccccccc-busy", ',
    ) &&
    left().at(-1).to === "cccccccc-busy",
);

// 14-17: the target is called by the name on its tab, so the user can tell where the note went.
const self = { env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" } };
transcript("bbbbbbbb-busy", "tool_use", [
  {
    type: "assistant",
    message: {
      content: [
        {
          type: "tool_use",
          id: "tu-meta-1",
          name: "mcp__nimbalyst__update_session_meta",
          input: { phase: "implementing" },
        },
      ],
    },
  },
  {
    type: "user",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "tu-meta-1",
          content: [
            {
              type: "text",
              text: JSON.stringify({ after: { name: "Juicer hunt" } }),
            },
          ],
        },
      ],
    },
  },
]);
r = run(["send", "--to", "bbbbbbbb", "hi"], self);
ok(
  "a session is called by its Nimbalyst tab name",
  r.code === 0 &&
    r.out.startsWith('Queued for "Juicer hunt", not delivered yet.'),
);
transcript("cccccccc-busy", "tool_use", [
  { type: "ai-title", aiTitle: "Title from Claude Code" },
]);
r = run(["send", "--to", "cccccccc", "hi"], self);
ok(
  "without a tab name, Claude Code's own title is used",
  r.code === 0 && r.out.startsWith('Queued for "Title from Claude Code", '),
);
r = run(["send", "which one"], self);
ok(
  "several busy targets: the most recently active one gets the note",
  r.code === 0 && r.out.startsWith('Queued for "Title from Claude Code", '),
);
r = run(["send", "--to", "zzzzzzzz", "hi"], self);
ok(
  "an unknown id sends nothing and lists the sessions by name",
  r.code === 2 &&
    r.out.includes("NOT SENT") &&
    r.out.includes('bbbbbbbb  "Juicer hunt"  busy') &&
    r.out.includes('cccccccc  "Title from Claude Code"  busy'),
);
transcript(
  "cccccccc-busy",
  "tool_use",
  Array.from({ length: 40 }, () => ({
    type: "assistant",
    message: { content: [{ type: "text", text: "x".repeat(100000) }] },
  })),
);
r = run(["send", "--to", "cccccccc", "hi"], self);
ok(
  "a long session whose only request is at the start is still called by it",
  r.code === 0 &&
    r.out.startsWith(
      'Queued for the session last asked "request of cccccccc-busy", ',
    ),
);

// 18-23: --to with a Nimbalyst session id (a lead's child, in another folder) finds its transcript,
// and Nimbalyst's status decides how the note goes, not the transcript's last line.
const { DatabaseSync } = await import("node:sqlite");
const dbPath = path.join(home, "nimbalyst.sqlite");
const db = new DatabaseSync(dbPath);
const childWs = path.join(home, "child-folder");
db.exec(
  "CREATE TABLE ai_sessions (id TEXT, title TEXT, status TEXT, provider_session_id TEXT, workspace_id TEXT, updated_at TEXT)",
);
// Nimbalyst's prompt queue, with its real columns
db.exec(
  "CREATE TABLE queued_prompts (id TEXT PRIMARY KEY, session_id TEXT, prompt TEXT, status TEXT, attachments TEXT, document_context TEXT, created_at INTEGER, claimed_at INTEGER, completed_at INTEGER, error_message TEXT)",
);
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
  "e13360ea-nimb",
  "job 3b: base design",
  "running",
  "dddddddd-child",
  childWs,
  "2026-10-29",
);
const status = (s) =>
  db
    .prepare("UPDATE ai_sessions SET status = ? WHERE id = 'e13360ea-nimb'")
    .run(s);
const childDir = path.join(home, ".claude", "projects", key(childWs));
fs.mkdirSync(childDir, { recursive: true });
const childT = (stop) =>
  fs.writeFileSync(
    path.join(childDir, "dddddddd-child.jsonl"),
    JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: stop,
        content: [{ type: "tool_use", name: "Bash", input: {} }],
      },
    }) + "\n",
  );
const nimb = {
  env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self", STEER_NIMBALYST_DB: dbPath },
};
childT("tool_use");
r = run(["send", "--to", "e13360ea", "wine ages faster"], nimb);
ok(
  "a Nimbalyst id reaches the busy child in another folder, named by its title",
  r.code === 0 &&
    r.out.startsWith('Queued for "job 3b: base design", not delivered yet.') &&
    left().at(-1).to === "dddddddd-child",
);
// D7: --after puts the note into Nimbalyst's own queue through outbox.jsonl, in the line shape the Commands
// extension's bridge reads ({ id, ts, session, prompt }, the Nimbalyst session id), so it comes as a new turn
// after the current one; the steer inbox (next tool call) stays as it was.
const obFile = path.join(inboxDir, "outbox.jsonl");
const obPrev = fs.existsSync(obFile) ? fs.readFileSync(obFile, "utf8") : null;
const inboxN = left().length,
  obN = left(obFile).length;
r = run(["send", "--to", "e13360ea", "--after", "then tidy the docs"], nimb);
const obLine = left(obFile).at(-1);
ok(
  "--after: the note goes to Nimbalyst's queue through the outbox in the bridge's shape, not to the steer inbox, and says so",
  r.code === 0 &&
    /after its current turn/.test(r.out) &&
    left(obFile).length === obN + 1 &&
    typeof obLine?.id === "string" &&
    obLine.id.length > 0 &&
    typeof obLine.ts === "number" &&
    Date.now() - obLine.ts < 60e3 &&
    obLine.session === "e13360ea-nimb" &&
    obLine.prompt === "then tidy the docs" &&
    left().length === inboxN,
);
r = run(["send", "--to", "cccccccc-busy", "--after", "then tidy the docs"], {
  env: { CLAUDE_CODE_SESSION_ID: "aaaaaaaa-self" },
});
ok(
  "--after with no Nimbalyst session to queue it for: NOT SENT, nothing written",
  r.code !== 0 &&
    r.out.includes("--after cannot queue") &&
    left(obFile).length === obN + 1 &&
    left().length === inboxN,
);
// --after flags come before the note's words in any order, and none of them ends up in the note
r = run(
  ["send", "--to", "e13360ea", "--after", "--nowait", "then check the build"],
  nimb,
);
const obAfterNowait = left(obFile).at(-1)?.prompt;
r = run(
  ["send", "--to", "e13360ea", "--nowait", "--after", "then check the build"],
  nimb,
);
ok(
  `--after with --nowait in either order: the note is its own words, no flag in it (got "${obAfterNowait}", "${left(obFile).at(-1)?.prompt}")`,
  obAfterNowait === "then check the build" &&
    left(obFile).at(-1)?.prompt === "then check the build" &&
    left(obFile).length === obN + 3,
);
// --after into a session too big for new work is refused like a plain send; --last and --user still pass
fs.writeFileSync(
  path.join(childDir, "dddddddd-child.jsonl"),
  [
    {
      type: "assistant",
      message: {
        model: "claude-opus-5-5",
        usage: {
          input_tokens: 0,
          cache_read_input_tokens: 250000,
          cache_creation_input_tokens: 0,
        },
        content: [{ type: "text", text: "working" }],
      },
    },
    {
      type: "assistant",
      message: {
        stop_reason: "tool_use",
        content: [{ type: "tool_use", name: "Bash", input: {} }],
      },
    },
  ]
    .map((e) => JSON.stringify(e))
    .join("\n") + "\n",
);
const bigEnv = { env: { ...nimb.env, STEER_MAX_K: "200" } };
r = run(["send", "--to", "e13360ea", "--after", "one more job"], bigEnv);
ok(
  `--after into a session over STEER_MAX_K is NOT SENT (exit 4) and nothing is queued (exit ${r.code}: ${r.out.split("\n")[0]})`,
  r.code === 4 && left(obFile).length === obN + 3,
);
const rLast = run(
  ["send", "--to", "e13360ea", "--last", "--after", "finish it"],
  bigEnv,
);
const rUser = run(
  ["send", "--to", "e13360ea", "--after", "--user", "the user's words"],
  bigEnv,
);
ok(
  "--after with --last or --user passes the size limit and queues the note without the flag",
  rLast.code === 0 &&
    rUser.code === 0 &&
    left(obFile).length === obN + 5 &&
    left(obFile).at(-1).prompt === "the user's words",
);
childT("tool_use");
// A fresh install has no steer folder yet: --after makes it before it takes the lock, so it does not wait the
// lock's 0.8 s timeout and write unlocked. Timed against the same send once the folder exists.
{
  const home2 = fs.realpathSync.native(
    fs.mkdtempSync(path.join(os.tmpdir(), "steer-fresh-")),
  );
  const childDir2 = path.join(home2, ".claude", "projects", key(childWs));
  fs.mkdirSync(childDir2, { recursive: true });
  fs.copyFileSync(
    path.join(childDir, "dddddddd-child.jsonl"),
    path.join(childDir2, "dddddddd-child.jsonl"),
  );
  const env2 = { env: { ...nimb.env, HOME: home2, USERPROFILE: home2 } };
  const ob2 = path.join(home2, ".claude", "steer", "outbox.jsonl");
  let t0 = Date.now();
  const rFresh = run(["send", "--to", "e13360ea", "--after", "first"], env2);
  const freshMs = Date.now() - t0;
  t0 = Date.now();
  run(["send", "--to", "e13360ea", "--after", "second"], env2);
  const warmMs = Date.now() - t0;
  ok(
    `--after on a fresh install makes the steer folder before taking the lock (fresh ${freshMs} ms, folder there ${warmMs} ms)`,
    rFresh.code === 0 &&
      left(ob2)
        .map((e) => e.prompt)
        .join("|") === "first|second" &&
      freshMs - warmMs < 600,
  );
  fs.rmSync(home2, { recursive: true, force: true });
}
if (obPrev === null) fs.rmSync(obFile, { force: true });
else fs.writeFileSync(obFile, obPrev);
// The transcript has to show the background job (a reply that ended with no job
// left is idle whatever Nimbalyst says).
fs.writeFileSync(
  path.join(childDir, "dddddddd-child.jsonl"),
  JSON.stringify({
    type: "user",
    toolUseResult: { backgroundTaskId: "job9" },
  }) +
    "\n" +
    JSON.stringify({
      type: "assistant",
      message: {
        stop_reason: "end_turn",
        content: [{ type: "text", text: "waiting" }],
      },
    }) +
    "\n",
);
let before = left().length;
r = run(["send", "--to", "e13360ea", "wine ages faster"], nimb);
ok(
  "reply ended but Nimbalyst says running (a background job): the note is queued, not refused",
  r.code === 0 &&
    r.out.startsWith("Queued for ") &&
    left().length === before + 1,
);
childT("end_turn");
before = left().length;
const endNimb = { env: { ...nimb.env, STEER_ENDING_WAIT: "3" } };
// A stand-in for a live --watch: marks the note seen within a second
const watcher = spawn(process.execPath, [
  "-e",
  `const fs=require("fs"),f=${JSON.stringify(inbox)},t=Date.now();
   const i=setInterval(()=>{try{const a=fs.readFileSync(f,"utf8").split("\\n").filter(Boolean).map(JSON.parse);
   if(a.some(e=>e.msg==="watched note"&&!e.seen)){fs.writeFileSync(f,a.map(e=>JSON.stringify(e.msg==="watched note"?{...e,seen:Date.now()}:e)).join("\\n")+"\\n");clearInterval(i);}}catch{}
   if(Date.now()-t>8000)clearInterval(i);},100);`,
]);
r = run(["send", "--to", "e13360ea", "watched note"], endNimb);
watcher.kill();
ok(
  "reply ended, Nimbalyst still says running, a watcher takes it: sent as a note (the Note button never queues it as a message)",
  r.code === 0 &&
    r.out.includes("its reply is ending") &&
    left().length === before + 1,
);
before = left().length;
r = run(["send", "--to", "e13360ea", "nobody watches"], endNimb);
ok(
  "reply ended and no watcher takes the note: taken back, send_prompt it instead",
  r.code === 3 &&
    r.out.includes("nothing is watching") &&
    left().length === before,
);
status("waiting_for_input");
r = run(["send", "--to", "e13360ea", "pick blue"], nimb);
ok(
  "waiting for the user's answer: queued, and it says the note comes after that answer",
  r.code === 0 && r.out.includes("waiting for an answer"),
);
status("idle");
childT("tool_use");
before = left().length;
r = run(["send", "--to", "e13360ea", "wine ages faster"], nimb);
ok(
  "idle in Nimbalyst (transcript cut off mid tool call): nothing queued, told to send_prompt to the Nimbalyst id",
  r.code === 3 &&
    r.out.includes("send_prompt to session e13360ea-nimb") &&
    left().length === before,
);
r = run(["send", "--to", "dddddddd", "hi"], nimb);
ok(
  "the Claude session id finds the same Nimbalyst row",
  r.code === 3 && r.out.includes("is idle"),
);
r = run(["send", "--to", "ffffffff", "hi"], nimb);
ok(
  "an id in neither place sends nothing",
  r.code === 2 && r.out.startsWith("NOT SENT"),
);
// A new tab: Nimbalyst has its row, Claude has no session yet
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
  "56b89c3d-new",
  "New Session",
  "idle",
  null,
  childWs,
  "2026-10-30",
);
before = left().length;
r = run(["send", "--to", "56b89c3d-new", "first words"], nimb);
ok(
  "a session that has never run: nothing queued, told to send_prompt so the first message starts it",
  r.code === 3 &&
    r.out.includes("send_prompt to it") &&
    r.out.includes("56b89c3d-new") &&
    left().length === before,
);
// A session in a git worktree: Nimbalyst records the main folder, the transcript is under the worktree's
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
  "5a051ea1-nimb",
  "lane: bugs",
  "running",
  "eeeeeeee-lane",
  childWs,
  "2026-10-29",
);
const laneDir = path.join(
  home,
  ".claude",
  "projects",
  key(childWs + "_worktrees/moving-comet"),
);
fs.mkdirSync(laneDir, { recursive: true });
fs.writeFileSync(
  path.join(laneDir, "eeeeeeee-lane.jsonl"),
  JSON.stringify({
    type: "assistant",
    message: {
      stop_reason: "tool_use",
      content: [{ type: "tool_use", name: "Bash", input: {} }],
    },
  }) + "\n",
);
r = run(["send", "--to", "5a051ea1", "hi"], nimb);
ok(
  "a session in a git worktree is found by its transcript in the worktree's folder",
  r.code === 0 &&
    r.out.startsWith('Queued for "lane: bugs", not delivered yet.') &&
    left().at(-1).to === "eeeeeeee-lane",
);

// 24-30: send_prompt to a session Nimbalyst says is busy is held and turned into a steer note; to an
// idle one it goes through. A session not in Nimbalyst keeps the /btw check (held until steer was tried).
const tp = path.join(home, "lead.jsonl");
const lead = (said, steered) =>
  fs.writeFileSync(
    tp,
    [
      { type: "user", message: { content: "earlier request" } },
      { type: "user", message: { content: said } },
      {
        type: "user",
        message: { content: "<system-reminder>x</system-reminder>" },
      },
      ...(steered
        ? [
            {
              type: "assistant",
              message: {
                content: [
                  {
                    type: "tool_use",
                    name: "Bash",
                    input: {
                      command:
                        "node ~/.claude/skills/steer/steer.mjs send --to e13360ea - <<'EOF'",
                    },
                  },
                ],
              },
            },
          ]
        : []),
    ]
      .map((e) => JSON.stringify(e))
      .join("\n") + "\n",
  );
const sp = (prompt, extra = {}, id = "e13360ea") =>
  hook(
    "PreToolUse",
    {
      transcript_path: tp,
      tool_name: "mcp__nimbalyst-host__send_prompt",
      tool_input: { sessionId: id, prompt, ...extra },
    },
    nimb.env,
  );
status("running");
lead("tell job 3b to use the new brief", false);
o = sp("Use the new brief");
ok(
  "send_prompt to a running session is held, whatever it says, and names the steer command",
  o?.hookSpecificOutput?.permissionDecision === "deny" &&
    o.hookSpecificOutput.permissionDecisionReason.includes(
      "steer.mjs send --to e13360ea",
    ),
);
lead("send it as btw", true);
ok(
  "held even after a steer try, while it is running",
  sp("/btw wine")?.hookSpecificOutput?.permissionDecision === "deny",
);
status("idle");
lead("e13360ea send to this session /btw wine ages faster", false);
ok(
  "send_prompt to an idle session goes through, /btw or not",
  sp("/btw From the user: wine ages faster") === null,
);
status("running");
lead("btw stop it now", false);
ok(
  "an interrupt the lead chose goes through",
  sp("Stop", { interrupt: true }) === null,
);
lead("e13360ea send to this session /btw wine ages faster", false);
o = sp("/btw From the user: wine ages faster", {}, "99999999");
ok(
  "not in Nimbalyst: a /btw note is held",
  o?.hookSpecificOutput?.permissionDecision === "deny",
);
lead("send it as btw", true);
ok(
  "not in Nimbalyst: after steer.mjs send was tried, it goes through",
  sp("/btw wine", {}, "99999999") === null,
);
lead("tell job 3b to use the new brief", false);
ok(
  "not in Nimbalyst: an ordinary relay goes through",
  sp("Use the new brief", {}, "99999999") === null,
);

// 31-40: after a handoff, a child report reaching the old lead is forwarded to whoever leads now.
const moved = path.join(inboxDir, "moved.json"),
  outbox = path.join(inboxDir, "outbox.jsonl");
const ups = (sid, prompt) => {
  const r = run(["--hook"], {
    env: nimb.env,
    input: JSON.stringify({
      hook_event_name: "UserPromptSubmit",
      session_id: sid,
      cwd: work,
      prompt,
    }),
  });
  return r.out ? JSON.parse(r.out) : null;
};
const REP =
  '[Child Session Update]\nSession: "lane 2" (abc)\nDone: the deploy script works.';
r = run(["moved", "--to", "e13360ea"], {
  env: { ...nimb.env, CLAUDE_CODE_SESSION_ID: "old-lead" },
});
ok(
  "moved records where the lead went",
  r.code === 0 &&
    JSON.parse(fs.readFileSync(moved, "utf8"))["old-lead"]?.to === "e13360ea",
);
// Not blocked: the prompt still runs as the turn (it now gets a "[report]" label, tested below).
ok(
  "a session that never handed off runs its child reports itself",
  !ups("some-lead", REP)?.decision,
);
ok(
  "a slash command typed in the old lead still runs there",
  ups("old-lead", "/compact") === null,
);
ok(
  "a system injection in the old lead still runs there",
  ups("old-lead", "<task-notification>x</task-notification>") === null &&
    ups("old-lead", "[SYSTEM NOTIFICATION] x") === null,
);
ok(
  "a message typed in a session that never handed off runs there",
  ups("some-lead", "what did lane 2 say?") === null,
);
status("running");
fs.rmSync(inbox, { force: true });
o = ups("old-lead", REP);
ok(
  "a report to the old lead is not run there and says where it went",
  o?.decision === "block" &&
    o.reason.includes('"job 3b: base design"') &&
    o.reason.includes("before its next step"),
);
ok(
  "it waits as a report note for the current lead's Claude session",
  left().at(-1)?.to === "dddddddd-child" && left().at(-1)?.kind === "report",
);
ok("a busy lead is not woken", !fs.existsSync(outbox));
status("idle");
o = ups("old-lead", REP);
const ob = left(outbox);
ok(
  "an idle lead is woken through the outbox with its Nimbalyst id",
  o?.reason.includes("woken to read it") &&
    ob.length === 1 &&
    ob[0].session === "e13360ea-nimb" &&
    ob[0].id,
);
db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
  "f2f2f2f2-nimb",
  "lead (cont.) (cont.)",
  "running",
  "eeeeeeee-new",
  childWs,
  "2026-10-29",
);
run(["moved", "--from", "dddddddd-child", "--to", "f2f2f2f2"], nimb);
fs.rmSync(inbox, { force: true });
ups("old-lead", REP);
ok(
  "a chain of handoffs is followed to the newest lead",
  left().at(-1)?.to === "eeeeeeee-new",
);
r = run(["--hook"], {
  input: JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "eeeeeeee-new",
    cwd: work,
  }),
});
o = r.out ? JSON.parse(r.out) : null;
const ctx = o?.hookSpecificOutput?.additionalContext || "";
ok(
  "the new lead gets it as a child report, not as a note from the user",
  ctx.includes("[report]") &&
    ctx.includes("deploy script works") &&
    !ctx.includes("The user sent"),
);
run(["moved", "--from", "lost-lead", "--to", "77777777"], nimb);
o = ups("lost-lead", REP);
ok(
  "a lead that moved to an unknown session keeps the report and says so",
  !o?.decision &&
    o?.hookSpecificOutput?.additionalContext.includes("not found"),
);

// 41-48: a message the user types in the old lead goes the same way, as a request from the user.
const TYPED = "what did lane 2 say?";
const status2 = (s) =>
  db
    .prepare("UPDATE ai_sessions SET status = ? WHERE id = 'f2f2f2f2-nimb'")
    .run(s);
status2("running");
fs.rmSync(inbox, { force: true });
fs.rmSync(outbox, { force: true });
o = ups("old-lead", TYPED);
ok(
  "a typed message to the old lead (busy new lead) is not run there and says where it went",
  o?.decision === "block" &&
    o.reason.startsWith("→ Sent to") &&
    o.reason.includes("before its next step") &&
    o.hookSpecificOutput?.suppressOriginalPrompt === true,
);
ok(
  "it waits as a user-kind note for the current lead's session, unchanged",
  left().at(-1)?.kind === "user" &&
    left().at(-1)?.msg === TYPED &&
    left().at(-1)?.to === "eeeeeeee-new",
);
ok("a busy lead is not woken for it", !fs.existsSync(outbox));
r = run(["--hook"], {
  input: JSON.stringify({
    hook_event_name: "PostToolUse",
    session_id: "eeeeeeee-new",
    cwd: work,
  }),
});
const tctx =
  (r.out ? JSON.parse(r.out) : null)?.hookSpecificOutput?.additionalContext ||
  "";
ok(
  "the new lead is told it is the user's own message typed in the old session, a request",
  tctx.includes("[user]") &&
    tctx.includes("reached the session you took over from") &&
    tctx.includes("most likely typed there by the user") &&
    tctx.includes("reads like one session writing to another") &&
    tctx.includes(TYPED) &&
    !tctx.includes("[report]"),
);
status2("idle");
fs.rmSync(inbox, { force: true });
o = ups("old-lead", TYPED);
const ob2 = left(outbox);
ok(
  "an idle new lead is woken through the outbox for it",
  o?.reason.includes("woken to read it") &&
    ob2.length === 1 &&
    ob2[0].session === "f2f2f2f2-nimb" &&
    ob2[0].prompt.startsWith(
      "A message that reached the session you took over from was forwarded to you",
    ) &&
    ob2[0].prompt.includes("one session writing to another"),
);
const rec = JSON.parse(fs.readFileSync(moved, "utf8"));
rec["old-lead"].ts = Date.now() - 25 * 3600e3;
fs.writeFileSync(moved, JSON.stringify(rec));
fs.rmSync(inbox, { force: true });
ok(
  "a handoff over 24 hours old keeps typed messages in the old session",
  ups("old-lead", TYPED) === null && left().length === 0,
);
o = ups("old-lead", REP);
ok(
  "but an old record still forwards child reports",
  o?.decision === "block" && o.reason.startsWith("→ Report sent to"),
);

// 49-53: review fixes. Whitespace before a report, a bad outbox line, the off switch, no temp files left.
rec["old-lead"].ts = Date.now();
fs.writeFileSync(moved, JSON.stringify(rec));
fs.rmSync(inbox, { force: true });
o = ups("old-lead", "\n  " + REP);
ok(
  "a report with leading whitespace is forwarded as a report, not as a user message",
  o?.reason.startsWith("→ Report sent to") && left().at(-1)?.kind === "report",
);
fs.rmSync(inbox, { force: true });
fs.writeFileSync(
  outbox,
  JSON.stringify({
    id: "keep-me",
    ts: Date.now(),
    session: "x",
    prompt: "queued earlier",
  }) + "\n{this is not json\n",
);
o = ups("old-lead", REP);
ok(
  "a bad line in the outbox does not wipe the queued entries",
  left(outbox).some((e) => e.id === "keep-me") && left(outbox).length === 2,
);
fs.rmSync(inbox, { force: true });
o = run(["--hook"], {
  env: { ...nimb.env, STEER_FORWARD: "off" },
  input: JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "old-lead",
    cwd: work,
    prompt: TYPED,
  }),
});
ok(
  "STEER_FORWARD=off keeps a typed message in the old session",
  o.out === "" && left().length === 0,
);
o = run(["--hook"], {
  env: { ...nimb.env, STEER_FORWARD: "off" },
  input: JSON.stringify({
    hook_event_name: "UserPromptSubmit",
    session_id: "old-lead",
    cwd: work,
    prompt: REP,
  }),
});
ok(
  "STEER_FORWARD=off still forwards child reports",
  JSON.parse(o.out || "{}").decision === "block" &&
    left().at(-1)?.kind === "report",
);
ok(
  "no temp files are left in the steer folder",
  !fs.readdirSync(inboxDir).some((n) => n.endsWith(".tmp")),
);

// 54-60: a child's report that Nimbalyst queues for the busy parent reaches it as a "[report]" note at its
// next step, not after its turn; the queued copy that still comes as a turn is dropped.
{
  const queue = (id, sess, prompt, origin, kind, st = "pending") =>
    db
      .prepare(
        "INSERT INTO queued_prompts (id, session_id, prompt, status, document_context, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        sess,
        prompt,
        st,
        JSON.stringify({
          promptProvenance: {
            actor: "agent",
            origin,
            messageKind: kind,
            originSessionId: "kid-1",
          },
        }),
        Date.now(),
      );
  const rc = () => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(inboxDir, "receipts.json"), "utf8"),
      );
    } catch {
      return [];
    }
  };
  const crT = path.join(home, "child-report.jsonl");
  fs.writeFileSync(crT, "");
  const busy = (ev, extra = {}) =>
    hook(ev, { transcript_path: crT, ...extra }, nimb.env);
  db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
    "n-busy",
    "busy parent",
    "running",
    "busy-1",
    work,
    "2026-11-12",
  );
  db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
    "n-other",
    "other parent",
    "running",
    "other-1",
    work,
    "2026-11-12",
  );
  const ROW = "meta-1794538599030-ukimefz",
    KID =
      '[Child Session Update]\nSession: "lane 4" (kid-1)\nDone: the importer works.';
  queue(ROW, "n-busy", KID, "child-session-update", "report");
  queue(
    "meta-1794538599031-instr",
    "n-busy",
    "lead instruction: do step 5",
    "session-orchestration",
    "instruction",
  );
  queue(
    "meta-1794538599032-other",
    "n-other",
    "[Child Session Update]\nanother parent's child",
    "child-session-update",
    "report",
  );
  fs.rmSync(inbox, { force: true });
  o = busy("PostToolUse");
  let c = o?.hookSpecificOutput?.additionalContext || "";
  ok(
    "busy parent: its child's queued report comes after the tool call as a [report] note that asks to claim it",
    c.includes("[report]") &&
      c.includes(`[note ${ROW}]`) &&
      c.includes("the importer works") &&
      c.includes("consume_session_inbox") &&
      c.includes("report_1794538599030") &&
      !c.includes("The user sent") &&
      !c.includes("do step 5") &&
      !c.includes("another parent's child"),
  );
  fs.appendFileSync(
    crT,
    JSON.stringify({ text: `[report] …\n[note ${ROW}] ${KID}` }) + "\n",
  );
  sleep(1700);
  o = busy("PostToolUse");
  const got = rc().find((x) => x.id === ROW);
  ok(
    "busy parent: once its marker is in the transcript it is delivered, with a hash of its text, and handed over only once",
    o === null &&
      got?.state === "delivered" &&
      got.to === "busy-1" &&
      /^[0-9a-f]{40}$/.test(got.sha || "") &&
      !left().some((e) => e.id === ROW) &&
      busy("PostToolUse") === null,
  );
  queue(
    "meta-1794538600000-stop",
    "n-busy",
    "[Child Session Update]\nDone: lane 5 merged.",
    "child-session-update",
    "report",
  );
  o = busy("Stop");
  ok(
    "busy parent: a report queued as it finishes keeps it going",
    o?.decision === "block" &&
      o.reason.includes("[report]") &&
      o.reason.includes("lane 5 merged"),
  );
  db.prepare(
    "UPDATE queued_prompts SET status = 'completed' WHERE id = 'meta-1794538600000-stop'",
  ).run();
  fs.rmSync(inbox, { force: true });
  queue(
    "meta-1794538601000-help",
    "n-busy",
    "[Child Session Update]\nDone: helper case.",
    "child-session-update",
    "report",
  );
  fs.writeFileSync(parentT, agentUse("call-fg"));
  hook(
    "PostToolUse",
    { agent_id: "sub-9", transcript_path: parentT },
    nimb.env,
  );
  const inHelper = left().some((e) => e.id === "meta-1794538601000-help");
  c = busy("PostToolUse")?.hookSpecificOutput?.additionalContext || "";
  ok(
    "inside a helper the report is not taken; the parent's own next tool call gets it",
    !inHelper && c.includes("helper case"),
  );
  fs.appendFileSync(
    crT,
    JSON.stringify({ text: "[note meta-1794538601000-help]" }) + "\n",
  );
  const RACE = "meta-1794538602000-race";
  o = busy("PostToolUse", {
    tool_name: "mcp__nimbalyst-host__consume_session_inbox",
    tool_response: [
      {
        type: "text",
        text: JSON.stringify({
          messages: [
            {
              id: RACE,
              kind: "report",
              text: "[Child Session Update]\nDone: race case.",
            },
          ],
        }),
      },
    ],
  });
  c = o?.hookSpecificOutput?.additionalContext || "";
  ok(
    "a report the model claimed before the hook saw it is labelled [report] and gets a receipt",
    c.includes("[report]") &&
      c.includes("race case") &&
      rc().find((x) => x.id === RACE)?.state === "delivered",
  );
  o = ups("busy-1", KID);
  ok(
    "the queued copy of a report already read as a note is dropped",
    o?.decision === "block" &&
      o.reason.includes("Already read as a note") &&
      o.hookSpecificOutput?.suppressOriginalPrompt === true,
  );
  db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
    "n-idle",
    "idle parent",
    "running",
    "idle-1",
    work,
    "2026-11-12",
  );
  const IDLE =
    '[Child Session Update]\nSession: "lane 7" (k7)\nDone: idle case.';
  queue(
    "meta-1794538603000-idle",
    "n-idle",
    IDLE,
    "child-session-update",
    "report",
    "executing",
  );
  o = ups("idle-1", IDLE);
  const ctxIdle = o?.hookSpecificOutput?.additionalContext || "";
  ok(
    "an idle parent's report turn runs, labelled [report], and gets a receipt for its queue row",
    !o?.decision &&
      ctxIdle.includes("[report]") &&
      ctxIdle.includes("child session you started") &&
      !ctxIdle.includes("consume_session_inbox") &&
      rc().find((x) => x.id === "meta-1794538603000-idle")?.state ===
        "delivered",
  );
  // Build review CRR: questions, status messages, the off switch, a handed-off parent, a failing read.
  const ASK =
    '[Child Session Update]\nSession: "lane 8" (k8)\nACTION REQUIRED: the child asks which branch to use.';
  queue(
    "meta-1794538604000-ask",
    "n-idle",
    ASK,
    "child-session-update",
    "question",
    "executing",
  );
  ok(
    "a child's question coming as a turn is left as it comes, not labelled a report",
    ups("idle-1", ASK) === null &&
      !rc().some((x) => x.id === "meta-1794538604000-ask"),
  );
  o = busy("PostToolUse", {
    tool_name: "mcp__nimbalyst-host__consume_session_inbox",
    tool_response: [
      {
        type: "text",
        text: JSON.stringify({
          messages: [
            {
              id: "meta-1794538605000-st",
              sourceSessionId: "kid-1",
              kind: "status",
              text: "[Child Session Update]\nStill working.",
            },
            {
              id: "meta-1794538605001-orch",
              sourceSessionId: "peer-1",
              kind: "report",
              text: "lane 3 is merged",
            },
          ],
        }),
      },
    ],
  });
  ok(
    "a claimed status message or another session's report is not labelled a child's report",
    o === null &&
      !rc().some(
        (x) =>
          x.id === "meta-1794538605000-st" ||
          x.id === "meta-1794538605001-orch",
      ),
  );
  queue(
    "meta-1794538606000-off",
    "n-busy",
    "[Child Session Update]\nDone: off switch case.",
    "child-session-update",
    "report",
  );
  o = hook(
    "PostToolUse",
    { transcript_path: crT },
    { ...nimb.env, STEER_REPORTS: "off" },
  );
  ok(
    "STEER_REPORTS=off leaves the queue unread",
    o === null && !left().some((e) => e.id === "meta-1794538606000-off"),
  );
  ok(
    "with the switch back on the same report comes",
    (busy("PostToolUse")?.hookSpecificOutput?.additionalContext || "").includes(
      "off switch case",
    ),
  );
  db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)").run(
    "n-moved",
    "handed-off parent",
    "running",
    "moved-1",
    work,
    "2026-11-12",
  );
  run(["moved", "--to", "e13360ea"], {
    env: { ...nimb.env, CLAUDE_CODE_SESSION_ID: "moved-1" },
  });
  queue(
    "meta-1794538607000-mv",
    "n-moved",
    "[Child Session Update]\nDone: handed-off case.",
    "child-session-update",
    "report",
  );
  hook(
    "PostToolUse",
    { session_id: "moved-1", transcript_path: crT },
    nimb.env,
  );
  ok(
    "a parent that handed off does not take its queue at a tool call (forwarding takes it)",
    !left().some((e) => e.id === "meta-1794538607000-mv"),
  );
  const oldDb = path.join(home, "old-nimbalyst.sqlite"),
    errLog = path.join(home, "hook-errors.log");
  fs.writeFileSync(oldDb, "");
  fs.rmSync(path.join(inboxDir, "report-read-error.txt"), { force: true });
  const failing = () =>
    hook(
      "PostToolUse",
      { transcript_path: crT },
      { ...nimb.env, STEER_NIMBALYST_DB: oldDb, HOOK_ERRORS_LOG: errLog },
    );
  const f1 = failing(),
    f2 = failing();
  const logged = fs.existsSync(errLog)
    ? fs.readFileSync(errLog, "utf8").split("\n").filter(Boolean)
    : [];
  ok(
    "a queue read that fails (no queued_prompts table) is logged once, not at every tool call",
    f1 === null &&
      f2 === null &&
      logged.length === 1 &&
      logged[0].includes("queued_prompts"),
  );
  fs.rmSync(inbox, { force: true });
}
db.close();

// Delivery receipts: a note stays until its marker is in the session's transcript. The holds
// here name a helper launch, the kind of call that is held.
{
  const inbox = path.join(home, ".claude", "steer");
  const tp2 = path.join(home, "receipt-transcript.jsonl");
  const box = path.join(inbox, "receipt-test.jsonl");
  const rc = () => {
    try {
      return JSON.parse(
        fs.readFileSync(path.join(inbox, "receipts.json"), "utf8"),
      );
    } catch {
      return [];
    }
  };
  const sid = { session_id: "rcpt-1", transcript_path: tp2 };
  const put = (e) => {
    fs.mkdirSync(inbox, { recursive: true });
    fs.writeFileSync(box, JSON.stringify(e) + "\n");
  };
  const inBox = () =>
    fs.existsSync(box)
      ? fs
          .readFileSync(box, "utf8")
          .split("\n")
          .filter(Boolean)
          .map((l) => JSON.parse(l))
      : [];
  const pause = () =>
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1700);
  fs.writeFileSync(tp2, "");
  put({
    ts: Date.now(),
    id: "n1",
    to: "rcpt-1",
    from: "lead-1",
    msg: "keep the clouds",
  });
  const result = (call) =>
    JSON.stringify({
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: call }] },
    }) + "\n";
  let x = hook("PreToolUse", { ...sid, ...agentCall, tool_use_id: "call-1" });
  ok(
    "the held call carries the note with its marker",
    x?.hookSpecificOutput?.permissionDecisionReason.includes(
      "[note n1] keep the clouds",
    ),
  );
  ok(
    "handing it over does not count as delivered",
    inBox().length === 1 &&
      inBox()[0].tries === 1 &&
      !rc().some((r) => r.id === "n1"),
  );
  pause();
  // The call was cancelled: its result landed without the note.
  fs.appendFileSync(tp2, result("call-1"));
  ok(
    "a lost hold does not hold the next call",
    hook("PreToolUse", { ...sid, ...agentCall }) === null,
  );
  x = hook("PostToolUse", sid);
  ok(
    "a lost note rides with the next tool result",
    x?.hookSpecificOutput?.additionalContext.includes(
      "[note n1] keep the clouds",
    ) && inBox()[0].tries === 2,
  );
  fs.writeFileSync(
    tp2,
    JSON.stringify({ text: "[note n1] keep the clouds" }) + "\n",
  );
  pause();
  x = hook("PreToolUse", sid);
  ok(
    "once the marker is in the transcript the note is done",
    x === null &&
      inBox().length === 0 &&
      rc().find((r) => r.id === "n1")?.state === "delivered",
  );
  // Tool calls run while their reply is still coming and their results land later (a note handed over
  // several times in one reply was marked failed, yet it had arrived). Other lines land meanwhile.
  fs.writeFileSync(tp2, "");
  put({
    ts: Date.now(),
    id: "n4",
    to: "rcpt-1",
    from: "lead-1",
    msg: "mid reply",
  });
  hook("PreToolUse", { ...sid, ...agentCall, tool_use_id: "call-4" });
  pause();
  const later = Array.from({ length: 6 }, (_, i) => {
    fs.appendFileSync(
      tp2,
      JSON.stringify({ type: "last-prompt" }) + "\n" + result(`other-${i}`),
    );
    return hook("PostToolUse", sid);
  });
  ok(
    "before its call has a result: no repeat of the note, whatever else lands",
    later.every((v) => v === null) && inBox()[0].tries === 1,
  );
  ok("and no failed receipt", !rc().some((r) => r.id === "n4"));
  fs.appendFileSync(
    tp2,
    JSON.stringify({ text: "[note n4] mid reply" }) + "\n",
  );
  ok(
    "the reply ends with the note in it: delivered",
    hook("PostToolUse", sid) === null &&
      rc().find((r) => r.id === "n4")?.state === "delivered",
  );
  // A Stop is the last chance: the reply is over, so a note still missing is carried again.
  fs.writeFileSync(tp2, "");
  put({
    ts: Date.now(),
    id: "n5",
    to: "rcpt-1",
    from: "lead-1",
    msg: "at the end",
  });
  hook("PreToolUse", { ...sid, ...agentCall, tool_use_id: "call-5" });
  pause();
  x = hook("Stop", sid);
  ok(
    "a note still missing at Stop is carried again",
    x?.decision === "block" &&
      x.reason.includes("[note n5] at the end") &&
      inBox()[0].tries === 2,
  );
  // The 2 hour limit is reached from any session's hook, so it looks in the receiver's transcript.
  fs.writeFileSync(
    tp2,
    JSON.stringify({ text: "[note n6] read long ago" }) + "\n",
  );
  put({
    ts: Date.now() - 3 * 3600e3,
    id: "n6",
    to: "rcpt-1",
    msg: "read long ago",
    seen: Date.now() - 3 * 3600e3,
    transcript: tp2,
    tries: 1,
  });
  hook("PostToolUse", { session_id: "someone-else" });
  ok(
    "past the limit, a note in its transcript counts as delivered",
    rc().find((r) => r.id === "n6")?.state === "delivered",
  );
  put({
    ts: Date.now() - 3 * 3600e3,
    id: "n7",
    to: "rcpt-1",
    msg: "never read",
    seen: Date.now() - 3 * 3600e3,
    transcript: tp2,
    tries: 1,
  });
  hook("PostToolUse", { session_id: "someone-else" });
  ok(
    "past the limit, a note not in it has failed",
    rc().find((r) => r.id === "n7")?.state === "failed",
  );
  fs.writeFileSync(tp2, "");
  put({
    ts: Date.now(),
    id: "n2",
    to: "rcpt-1",
    from: "lead-1",
    msg: "never lands",
    seen: Date.now() - 5000,
    tries: 4,
  });
  ok(
    "after the last try it is marked failed",
    hook("PostToolUse", sid) === null &&
      rc().find((r) => r.id === "n2")?.state === "failed",
  );
  x = hook("PostToolUse", { session_id: "lead-1" });
  ok(
    "the sender is told once a note failed",
    x?.hookSpecificOutput?.additionalContext.includes("NOT been confirmed") &&
      x.hookSpecificOutput.additionalContext.includes("never lands"),
  );
  ok("and only once", hook("PostToolUse", { session_id: "lead-1" }) === null);
  put({
    ts: Date.now() - 11 * 60e3,
    id: "n3",
    to: "rcpt-9",
    from: "lead-1",
    msg: "slow one",
  });
  x = hook("PostToolUse", { session_id: "lead-1" });
  ok(
    "the sender is warned about a note still waiting after 10 minutes",
    x?.hookSpecificOutput?.additionalContext.includes("slow one"),
  );
  ok(
    "that warning comes once too",
    hook("PostToolUse", { session_id: "lead-1" }) === null &&
      inBox().length === 1,
  );
  r = run(["status"], { env: { CLAUDE_CODE_SESSION_ID: "lead-1" } });
  ok(
    "status lists what is waiting and what failed",
    r.out.includes("slow one") &&
      r.out.includes("FAILED") &&
      r.out.includes("never lands"),
  );
  fs.rmSync(box, { force: true });
}

// A session over 300k takes no new work from another session; finishing notes and the user's own pass
const huge = (n) => ({
  type: "assistant",
  message: {
    model: "claude-opus-5-5",
    usage: {
      input_tokens: 0,
      cache_read_input_tokens: n,
      cache_creation_input_tokens: 0,
    },
    content: [{ type: "text", text: "working" }],
  },
});
transcript("dddddddd-busy", "tool_use", [huge(598000)]);
r = run(["send", "--to", "dddddddd", "one more job"], self);
ok(
  "a note from another session to a huge session is refused",
  r.code === 4 &&
    r.out.includes("NOT SENT") &&
    r.out.includes("~598k") &&
    r.out.includes("--last"),
);
r = run(["send", "--to", "dddddddd", "--last", "finish and stop"], self);
ok(
  "--last passes the size check",
  r.code === 0 && r.out.startsWith("Queued for"),
);
r = run(
  ["send", "--to", "dddddddd", "--user", "the note the user wrote"],
  self,
);
ok(
  "--user passes the size check",
  r.code === 0 && r.out.startsWith("Queued for"),
);
r = run(["send", "--to", "dddddddd", "from the Note button"]);
ok(
  "the Note button, outside a session, is never refused",
  r.code === 0 && r.out.startsWith("Queued for"),
);
// --nowait never reads the receipt. The send runs with a 600 s receipt wait while the test marks every note in
// the inbox delivered: a send that waits sees that receipt and says "Delivered to", one that does not says
// "Queued for". The 60 s kill only ends a hung send; it never makes the check pass.
r = await new Promise((done) => {
  const c = spawn(
    process.execPath,
    [STEER, "send", "--to", "dddddddd", "--nowait", "do not wait"],
    {
      cwd: work,
      env: {
        ...process.env,
        USERPROFILE: home,
        HOME: home,
        CLAUDE_CODE_SESSION_ID: "",
        STEER_WAIT: "600",
        STEER_NIMBALYST_DB: path.join(home, "no-nimbalyst.sqlite"),
      },
    },
  );
  const receiptsFile = path.join(inboxDir, "receipts.json");
  const deliver = setInterval(() => {
    let all = [];
    try {
      all = JSON.parse(fs.readFileSync(receiptsFile, "utf8"));
    } catch {}
    // The send may not have written its note yet
    if (!fs.existsSync(inbox)) return;
    const ids = fs
      .readFileSync(inbox, "utf8")
      .split("\n")
      .flatMap((l) => {
        try {
          return [JSON.parse(l).id];
        } catch {
          return [];
        }
      })
      .filter((id) => id && !all.some((e) => e.id === id));
    if (!ids.length) return;
    const tmp = `${receiptsFile}.test.tmp`;
    fs.writeFileSync(
      tmp,
      JSON.stringify([
        ...all,
        ...ids.map((id) => ({ id, state: "delivered" })),
      ]),
    );
    fs.renameSync(tmp, receiptsFile);
  }, 20);
  let hung = false;
  const kill = setTimeout(() => {
    hung = true;
    c.kill();
  }, 60000);
  let out = "";
  c.stdout.on("data", (d) => (out += d));
  c.on("close", (code) => {
    clearInterval(deliver);
    clearTimeout(kill);
    done({ out: out.trim(), code, hung });
  });
});
ok(
  `--nowait does not wait for the receipt: it says "Queued for" and gives the note's id, not "Delivered to" (exit ${r.code}${r.hung ? ", killed after 60 s" : ""}: ${r.out.split("\n")[0]})`,
  r.code === 0 &&
    !r.hung &&
    r.out.startsWith("Queued for") &&
    !r.out.includes("Delivered to") &&
    /^Note id: \w+$/m.test(r.out),
);
r = run(["send", "--to", "dddddddd", "-", "--nowait"], { input: "from stdin" });
ok(
  "--nowait works after the - the button sends",
  r.code === 0 && /^Note id: \w+$/m.test(r.out),
);
r = run(["send", "--to", "dddddddd", "why", "--nowait", "fails"]);
ok(
  "a note that mentions --nowait keeps the word and waits as usual",
  r.code === 0 && !/Note id/.test(r.out),
);
fs.readdirSync(path.join(home, ".claude", "steer"))
  .filter((n) => n.endsWith(".jsonl"))
  .forEach((n) => {
    const f = path.join(home, ".claude", "steer", n);
    fs.writeFileSync(
      f,
      fs
        .readFileSync(f, "utf8")
        .split("\n")
        .filter((l) => !l.includes("why --nowait fails"))
        .join("\n"),
    );
  });
ok(
  "--nowait is not part of the note",
  !fs
    .readdirSync(path.join(home, ".claude", "steer"))
    .filter((n) => n.endsWith(".jsonl"))
    .some((n) =>
      fs
        .readFileSync(path.join(home, ".claude", "steer", n), "utf8")
        .includes("--nowait"),
    ),
);
transcript("dddddddd-busy", "tool_use", [huge(250000)]);
r = run(["send", "--to", "dddddddd", "next step"], self);
ok(
  "a session under the limit takes notes",
  r.code === 0 && r.out.startsWith("Queued for"),
);
r = run(["send", "--to", "dddddddd", "next step"], {
  env: { ...self.env, STEER_MAX_K: "200" },
});
ok("STEER_MAX_K lowers the limit", r.code === 4);

// --watch: the background Stop hook that wakes a session waiting on a background job.
{
  const tp = path.join(home, "watch.jsonl");
  const line = (o) => JSON.stringify(o) + "\n";
  const job =
    line({ type: "user", toolUseResult: { backgroundTaskId: "job1" } }) +
    line({ type: "assistant", message: { content: "waiting" } });
  fs.writeFileSync(tp, job);
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    STEER_WATCH_TICK: "0.05",
    STEER_WATCH_MAX: "1",
    // No job: ends at once unless a test sets a window
    STEER_WATCH_IDLE: "0",
    // never the real Nimbalyst database
    STEER_NIMBALYST_DB: path.join(home, "no-nimbalyst.sqlite"),
    STEER_WATCH_ARGS: "claude --input-format stream-json --print",
  };
  const payload = (extra = {}) =>
    JSON.stringify({
      hook_event_name: "Stop",
      session_id: "busy-1",
      cwd: work,
      transcript_path: tp,
      ...extra,
    });
  const watch = (input = payload(), more = {}) => {
    const r = spawnSync(process.execPath, [STEER, "--watch"], {
      input,
      cwd: work,
      encoding: "utf8",
      env: { ...env, ...more },
    });
    return { code: r.status, err: r.stderr };
  };
  const later = (ms, fn, more = {}) =>
    new Promise((done) => {
      const c = spawn(process.execPath, [STEER, "--watch"], {
        cwd: work,
        env: { ...env, ...more },
      });
      const t0 = Date.now();
      let err = "";
      c.stderr.on("data", (d) => (err += d));
      c.on("close", (code) => done({ code, err, ms: Date.now() - t0 }));
      c.stdin.end(payload());
      setTimeout(fn, ms);
    });
  fs.rmSync(inbox, { force: true });
  let w = watch();
  ok(
    "watch: no note, it ends quietly at its time limit",
    w.code === 0 && w.err === "",
  );
  put([
    note("waiting note", { id: "w1" }),
    note("for someone else", { id: "w2", to: "other" }),
  ]);
  w = watch();
  ok(
    "watch: a note wakes the session with exit 2 and its text",
    w.code === 2 &&
      w.err.includes("waiting note") &&
      w.err.includes("[note w1]"),
  );
  ok(
    "watch: another session's note stays out of it",
    !w.err.includes("for someone else"),
  );
  const box = left(),
    w1 = box.find((e) => e.id === "w1");
  ok(
    "watch: the note stays until its marker is in the transcript",
    w1?.seen > 0 && w1.tries === 1 && w1.transcript === tp,
  );
  ok(
    "watch: the other session's note is untouched",
    !box.find((e) => e.id === "w2").seen,
  );
  ok(
    "watch: a note already handed over does not wake it twice",
    watch().code === 0,
  );
  fs.rmSync(inbox, { force: true });
  put([note("off", { id: "w3" })]);
  ok(
    "watch: STEER_WATCH=off does nothing",
    watch(payload(), { STEER_WATCH: "off" }).code === 0 && !left()[0].seen,
  );
  ok(
    "watch: a plain claude -p ends at once, it would be held up",
    watch(payload(), { STEER_WATCH_ARGS: "claude -p hello" }).code === 0 &&
      !left()[0].seen,
  );
  ok(
    "watch: an unreadable command line ends at once",
    watch(payload(), { STEER_WATCH_ARGS: "" }).code === 0 && !left()[0].seen,
  );
  ok(
    "watch: a terminal session is watched",
    watch(payload(), { STEER_WATCH_ARGS: "claude" }).code === 2,
  );
  put([note("off", { id: "w3" })]);
  ok(
    "watch: a subagent's stop does nothing",
    watch(payload({ agent_id: "a1" })).code === 0 && !left()[0].seen,
  );
  ok(
    "watch: no transcript, no wake",
    watch(payload({ transcript_path: undefined })).code === 0 &&
      !left()[0].seen,
  );
  fs.rmSync(inbox, { force: true });
  // A new turn ends the watch. Its time limit is 600 s and its session is a do-nothing process the test keeps
  // alive, so only the new turn can end it. A broken watch would run on: after 60 s the test kills that process,
  // which ends the watch too, and the check fails. The turn line is written again every 0.1 s, not once: the
  // watch takes the transcript's size when it starts, and under load one early write lands before that and
  // never counts.
  const session = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1e9)"],
    {
      stdio: "ignore",
    },
  );
  let killed = false;
  const stopSession = setTimeout(() => {
    killed = true;
    session.kill();
  }, 60000);
  let turns;
  let g = await later(
    150,
    () =>
      (turns = setInterval(
        () =>
          fs.appendFileSync(
            tp,
            line({ type: "user", message: { content: "next" } }),
          ),
        100,
      )),
    { STEER_WATCH_MAX: "600", CLAUDE_PID: String(session.pid) },
  );
  clearInterval(turns);
  clearTimeout(stopSession);
  session.kill();
  ok(
    `watch: a new turn ends it, since --hook takes over (exit ${g.code} after ${g.ms} ms${killed ? "; it ended only when the test killed its session after 60 s" : ""})`,
    g.code === 0 && !killed,
  );
  g = await later(150, () => {
    fs.appendFileSync(
      tp,
      line({ type: "system", subtype: "stop_hook_summary" }),
    );
    setTimeout(() => put([note("after a system line", { id: "w4" })]), 100);
  });
  ok(
    "watch: a hook's system line does not end it",
    g.code === 2 && g.err.includes("after a system line"),
  );
  fs.rmSync(inbox, { force: true });
  put([note("a report", { id: "w5", kind: "report" })]);
  w = watch();
  ok(
    "watch: a forwarded report is left to the outbox wake-up",
    w.code === 0 && !left()[0].seen,
  );
  fs.rmSync(inbox, { force: true });
  for (const [what, l] of [
    ["a compact summary", { type: "user", isCompactSummary: true }],
    ["a meta line", { type: "user", isMeta: true }],
    [
      "an interrupt",
      { type: "user", message: { content: "[Request interrupted by user]" } },
    ],
    [
      "a local command",
      {
        type: "user",
        message: { content: "<local-command-stdout>x</local-command-stdout>" },
      },
    ],
  ]) {
    g = await later(150, () => {
      fs.appendFileSync(tp, line(l));
      setTimeout(() => put([note("still watching", { id: "w6" })]), 100);
    });
    ok(`watch: ${what} does not end it`, g.code === 2);
    fs.rmSync(inbox, { force: true });
  }
  put([note("no job", { id: "w7" })]);
  const done =
    job +
    line({
      type: "user",
      message: {
        content:
          "<task-notification><task-id>job1</task-id></task-notification>",
      },
    });
  fs.writeFileSync(tp, done);
  ok(
    "watch: every job finished, no watcher",
    watch().code === 0 && !left()[0].seen,
  );
  fs.writeFileSync(
    tp,
    line({ type: "assistant", message: { content: "plain reply" } }),
  );
  ok("watch: no job at all, no watcher", watch().code === 0 && !left()[0].seen);
  // 2026-11-18: Nimbalyst kept a finished reply's session busy a median 39 s; a note sent then waited.
  ok(
    "watch: no job, a note sent as the reply ends wakes the session within its idle window",
    watch(payload(), { STEER_WATCH_IDLE: "1" }).code === 2 && !!left()[0].seen,
  );
  fs.rmSync(path.join(inboxDir, "outbox.jsonl"), { force: true });
  put([note("app stopped it", { id: "w8" })]);
  const wdb = new DatabaseSync(dbPath);
  wdb
    .prepare("INSERT INTO ai_sessions VALUES (?, ?, ?, ?, ?, ?)")
    .run("b0b0b0b0-nimb", "watched", "idle", "busy-1", work, "2026-11-18");
  wdb.close();
  const deadPid = spawnSync(process.execPath, ["-e", "0"]).pid;
  // only a session with a job left running gets the outbox wake: with none, send takes the note back and queues it
  fs.writeFileSync(
    tp,
    line({
      type: "user",
      toolUseResult: {
        isAsync: true,
        status: "async_launched",
        agentId: "ag0",
      },
    }),
  );
  w = watch(payload(), {
    STEER_WATCH_IDLE: "5",
    CLAUDE_PID: String(deadPid),
    STEER_NIMBALYST_DB: dbPath,
  });
  const wake = left(path.join(inboxDir, "outbox.jsonl"));
  ok(
    "watch: the app stopped the session with a note unread, so its queue starts it through the outbox",
    w.code === 0 &&
      wake.length === 1 &&
      wake[0].session === "b0b0b0b0-nimb" &&
      !left()[0].seen,
  );
  fs.rmSync(path.join(inboxDir, "outbox.jsonl"), { force: true });
  fs.writeFileSync(
    tp,
    line({ type: "assistant", message: { content: "plain reply" } }),
  );
  w = watch(payload(), {
    STEER_WATCH_IDLE: "0",
    CLAUDE_PID: String(deadPid),
    STEER_NIMBALYST_DB: dbPath,
  });
  ok(
    "watch: with no job it writes no outbox wake, since send takes the note back and queues it (no double prompt)",
    w.code === 0 && left(path.join(inboxDir, "outbox.jsonl")).length === 0,
  );
  fs.rmSync(path.join(inboxDir, "outbox.jsonl"), { force: true });
  fs.writeFileSync(
    tp,
    line({
      type: "user",
      toolUseResult: {
        isAsync: true,
        status: "async_launched",
        agentId: "ag1",
      },
    }),
  );
  ok("watch: a background agent counts as a job", watch().code === 2);
  fs.rmSync(inbox, { force: true });
  fs.writeFileSync(
    tp,
    line({
      type: "user",
      toolUseResult: {
        isAsync: true,
        status: "async_launched",
        agentId: "ag2",
      },
    }) +
      line({
        type: "user",
        message: {
          content:
            "<task-notification><task-id>ag2</task-id></task-notification>",
        },
      }) +
      line({
        type: "user",
        toolUseResult: { success: true, resumedAgentId: "ag2" },
      }),
  );
  put([note("resumed", { id: "w12" })]);
  ok(
    "watch: a helper resumed after it ended counts as a job",
    watch().code === 2,
  );
  fs.rmSync(inbox, { force: true });
  fs.writeFileSync(
    tp,
    job + line({ type: "api-request-blob", blob: "x".repeat(2.5e6) }),
  );
  put([note("long", { id: "w13" })]);
  ok(
    "watch: a job started more than 2 MB back still counts",
    watch().code === 2,
  );
  fs.rmSync(inbox, { force: true });
  fs.writeFileSync(tp, job);
  put([note("gone", { id: "w8" })]);
  const dead = spawnSync(process.execPath, ["-p", "process.pid"], {
    encoding: "utf8",
  }).stdout.trim();
  ok(
    "watch: its Claude is gone, it ends and leaves the note",
    watch(payload(), { CLAUDE_PID: dead }).code === 0 && !left()[0].seen,
  );
  ok(
    "watch: quoted prompt text is not a flag",
    watch(payload(), { STEER_WATCH_ARGS: 'claude "why does -p fail"' }).code ===
      2,
  );
  put([note("q", { id: "w9" })]);
  ok(
    "watch: a -p prompt that names stream-json still ends at once",
    watch(payload(), {
      STEER_WATCH_ARGS: 'claude -p "explain --input-format stream-json"',
    }).code === 0 && !left()[0].seen,
  );
  fs.rmSync(inbox, { force: true });
  // After a wake-up: --hook must not repeat the note or hold a tool call with a false message.
  const hookT = path.join(home, "hook.jsonl");
  fs.writeFileSync(
    hookT,
    line({ type: "assistant", message: { content: "x" } }),
  );
  const sid = { transcript_path: hookT };
  put([
    note("woken", {
      id: "w10",
      seen: Date.now(),
      via: "watch",
      tries: 1,
      transcript: hookT,
    }),
  ]);
  ok(
    "after a wake-up: a tool call is not held",
    hook("PreToolUse", sid) === null,
  );
  sleep(1700);
  ok(
    "after a wake-up: a tool result does not repeat the note",
    hook("PostToolUse", sid) === null && left().length === 1,
  );
  fs.appendFileSync(
    hookT,
    line({ type: "user", message: { content: "[note w10] woken" } }),
  );
  ok(
    "after a wake-up: the marker confirms it",
    hook("PostToolUse", sid) === null && left().length === 0,
  );
  put([
    note("lost", {
      id: "w11",
      seen: Date.now() - 11 * 60e3,
      via: "watch",
      tries: 1,
      transcript: hookT,
    }),
  ]);
  o = hook("PostToolUse", sid);
  ok(
    "after a wake-up: one that never showed is carried again",
    o?.hookSpecificOutput?.additionalContext?.includes("lost"),
  );
  fs.rmSync(inbox, { force: true });
}

fs.rmSync(home, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
