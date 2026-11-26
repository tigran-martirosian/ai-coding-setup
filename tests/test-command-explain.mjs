// Tests for hooks/command-explain.mjs. Run: node test-command-explain.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/command-explain.mjs", import.meta.url),
);
// Every run names its surroundings, so results don't depend on where the tests are started.
const TERMINAL = {
  CLAUDE_CODE_ENTRYPOINT: "cli",
  COMMAND_EXPLAIN_LINES: "",
  COMMAND_EXPLAIN_WIDTH: "",
};
const NIMBALYST = { ...TERMINAL, CLAUDE_CODE_ENTRYPOINT: "sdk-cli" };
const run = (input, env = TERMINAL) =>
  spawnSync(process.execPath, [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).stdout;
const B = (command, tool = "Bash") => ({
  tool_name: tool,
  tool_input: { command, description: "List files" },
});
const LINE = "# WHAT THIS DOES: Lists the files in this folder.";
const NOTE = `\n\n${LINE}`; // an empty line, then the labelled note
const echoes = (n) =>
  Array.from({ length: n }, (_, i) => `echo ${i + 1}`).join("\n");
const MISSING = { added: true }; // let through with a stand-in note appended, not refused

const cases = [
  ["bare command gets a stand-in note", B("ls -la"), MISSING],
  ["command, empty line, labelled note passes", B(`ls -la${NOTE}`), false],
  [
    "several lines, empty line, labelled note passes",
    B(`cd app && npm install\nnpm test | tail -5${NOTE}`),
    false,
  ],
  [
    "note without the label gets a stand-in note",
    B("ls -la\n\n# Lists the files in this folder."),
    MISSING,
  ],
  [
    "label in lower case gets a stand-in note",
    B("ls -la\n\n# what this does: Lists the files in this folder."),
    MISSING,
  ],
  [
    "note on the first line only gets a stand-in note",
    B(`${LINE}\n\nls -la`),
    MISSING,
  ],
  ["note alone with no command gets a stand-in note", B(LINE), MISSING],
  [
    "note on the same line as the command gets a stand-in note",
    B(`ls -la ${LINE}`),
    MISSING,
  ],
  [
    "too-short note gets a stand-in note",
    B("ls -la\n\n# WHAT THIS DOES: ok"),
    MISSING,
  ],
  [
    "note without words gets a stand-in note",
    B("ls -la\n\n# WHAT THIS DOES: ---- 123 ----"),
    MISSING,
  ],
  ["blank lines after the note pass", B(`ls -la${NOTE}\n\n`), false],
  ["Windows line endings pass", B(`ls -la\r\n\r\n${LINE}\r\n`), false],
  [
    "note in another language passes",
    B("ls -la\n\n# WHAT THIS DOES: Показывает файлы в этой папке."),
    false,
  ],
  [
    "heredoc followed by a note passes",
    B(`node - <<'EOF'\nconsole.log(1)\nEOF${NOTE}`),
    false,
  ],
  [
    "heredoc with the note inside it gets a stand-in note",
    B(`node - <<'EOF'\n\n${LINE}\nconsole.log(1)\nEOF`),
    MISSING,
  ],
  [
    "PowerShell bare command gets a stand-in note",
    B("Get-ChildItem", "PowerShell"),
    MISSING,
  ],
  [
    "terminal: PowerShell with a note passes",
    B(`Get-ChildItem${NOTE}`, "PowerShell"),
    false,
  ],
  [
    "terminal: a 14-line command with a note passes",
    B(`${echoes(12)}${NOTE}`),
    false,
  ],
  [
    "other tools pass",
    { tool_name: "Read", tool_input: { file_path: "x" } },
    false,
  ],
  ["bad JSON fails open", "not json", false],
  ["no command fails open", { tool_name: "Bash", tool_input: {} }, false],
  [
    "Nimbalyst: short command with a note passes",
    B(`ls -la${NOTE}`),
    false,
    NIMBALYST,
  ],
  [
    "Nimbalyst: bare command gets a stand-in note",
    B("ls -la"),
    MISSING,
    NIMBALYST,
  ],
  [
    "Nimbalyst: PowerShell with a note passes (the installer turns the tool off; no refusal)",
    B(`Get-ChildItem${NOTE}`, "PowerShell"),
    false,
    NIMBALYST,
  ],
  [
    "Nimbalyst: bare PowerShell gets a stand-in note",
    B("Get-ChildItem", "PowerShell"),
    MISSING,
    NIMBALYST,
  ],
  [
    "Nimbalyst: a 14-line command with a note passes (no line limit)",
    B(`${echoes(12)}${NOTE}`),
    false,
    NIMBALYST,
  ],
  [
    "Nimbalyst: a 200-line command with a note passes",
    B(`${echoes(198)}${NOTE}`),
    false,
    NIMBALYST,
  ],
  [
    "Nimbalyst: one 1000-character line with a note passes",
    B(`echo ${"x".repeat(1000)}${NOTE}`),
    false,
    NIMBALYST,
  ],
  [
    "Nimbalyst: a heredoc script followed by a note passes",
    B(`node - <<'EOF'\n${echoes(20)}\nEOF${NOTE}`),
    false,
    NIMBALYST,
  ],
  [
    "Nimbalyst: a long command with no note gets a stand-in note",
    B(echoes(12)),
    MISSING,
    NIMBALYST,
  ],
];
// A command let through with a stand-in note: no decision (the permission prompt still decides),
// the same input with the note appended after an empty line
const added = (out, input) => {
  try {
    const h = JSON.parse(out).hookSpecificOutput;
    const cmd = input.tool_input.command;
    const want = `${cmd.trimEnd()}\n\n# WHAT THIS DOES: (no note given) ${cmd.replace(/\s+/g, " ").trim().slice(0, 60)}`;
    return (
      h.hookEventName === "PreToolUse" &&
      !("permissionDecision" in h) &&
      h.updatedInput.command === want &&
      h.updatedInput.description === input.tool_input.description &&
      h.additionalContext.includes("Write the line yourself")
    );
  } catch {
    return false;
  }
};
let fail = 0,
  ran = 0;
const report = (ok, name) => {
  ran++;
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
};
for (const [name, input, expect, env] of cases) {
  const out = run(input, env);
  report(
    expect === false
      ? out === ""
      : expect === MISSING
        ? added(out, input)
        : out.includes('"deny"') && out.includes(expect),
    name,
  );
}
report(
  run(B("ls -la"), { ...NIMBALYST, COMMAND_EXPLAIN: "off" }) === "",
  "COMMAND_EXPLAIN=off disables it",
);
const long = B(`cd app &&   npm install\n${echoes(30)}`);
const note = JSON.parse(run(long))
  .hookSpecificOutput.updatedInput.command.split("\n")
  .pop();
report(
  note ===
    "# WHAT THIS DOES: (no note given) cd app && npm install echo 1 echo 2 echo 3 echo 4 echo 5 ech",
  "stand-in note is one line: the command's first 60 characters, spaces squeezed",
);
const fixed = JSON.parse(run(B("ls -la"))).hookSpecificOutput.updatedInput
  .command;
report(
  run(B(fixed)) === "",
  "a command with the stand-in note passes unchanged",
);
// A good note written straight under the command keeps its words; the hook adds the empty line, no reminder
// (until 2026-11-19 it was replaced by the stand-in, so the popup said "no note given" for a command that had one)
for (const [name, cmd, want] of [
  [
    "labelled note with no empty line before it: empty line added, note kept",
    `ls -la\n${LINE}`,
    `ls -la\n\n${LINE}`,
  ],
  [
    "several lines, note with no empty line: empty line added, note kept",
    `cd app\nnpm test\n${LINE}\n`,
    `cd app\nnpm test\n\n${LINE}`,
  ],
]) {
  let h;
  try {
    h = JSON.parse(run(B(cmd))).hookSpecificOutput;
  } catch {}
  report(
    h?.updatedInput?.command === want &&
      h.updatedInput.description === "List files" &&
      !("additionalContext" in h) &&
      !("permissionDecision" in h),
    name,
  );
}
const helper = JSON.parse(
  run({ ...B("ls -la"), agent_id: "sub-1" }),
).hookSpecificOutput;
report(
  /no note given/.test(helper.updatedInput.command) &&
    !helper.additionalContext,
  "a helper gets the stand-in without the reminder",
);
report(
  JSON.parse(run(B("ls -la"))).hookSpecificOutput.additionalContext?.startsWith(
    "command-explain:",
  ),
  "the main session still gets the reminder",
);
// A note on the command's own line gets the stand-in, and the reminder says where the note goes: the plain
// "had no note" reminder read as if no note was written at all
const sameLine =
  JSON.parse(run(B(`ls -la ${LINE}`))).hookSpecificOutput.additionalContext ??
  "";
report(
  /own last line/.test(sameLine) &&
    /empty line/.test(sameLine) &&
    !/had no/.test(sameLine),
  `a note on the command's own line: the reminder says the note goes on its own last line after an empty line, not that there was none (got: ${sameLine})`,
);
// Only a trailing comment is a note on the command's line: the words inside a quoted string are data, and a note
// written with no space after the # is still a note
const reminder = (command) =>
  JSON.parse(run(B(command))).hookSpecificOutput.additionalContext ?? "";
const quoted = reminder('echo "# WHAT THIS DOES: x" >> notes.txt');
report(
  /had no/.test(quoted) && !/own last line/.test(quoted),
  `the note words inside a quoted string are not a note on the command's line: the plain "had no note" reminder (got: ${quoted})`,
);
const tightHash = reminder("ls #WHAT THIS DOES: list");
report(
  /own last line/.test(tightHash) && !/had no/.test(tightHash),
  `a trailing "#WHAT THIS DOES:" with no space after the # is a note on the command's line (got: ${tightHash})`,
);
// Soft check: a lowercase or over-70-character note is allowed, with a note for next time
const softNote = (command, extra = {}) => {
  const out = run({ ...B(command), ...extra });
  try {
    return JSON.parse(out).hookSpecificOutput.additionalContext ?? null;
  } catch {
    return out === "" ? "" : null;
  }
};
const lower = softNote(
  "ls -la\n\n# WHAT THIS DOES: lists the files in this folder",
);
report(
  lower?.includes("capital letter") && lower.includes("70 characters"),
  "lowercase note: allowed with a note about capitals",
);
const longLine = `# WHAT THIS DOES: ${"Lists the files ".repeat(6).slice(0, 89)}x`;
report(
  longLine.length - 18 === 90 &&
    softNote(`ls -la\n\n${longLine}`)?.includes("70 characters"),
  "90-character note: allowed with a note about length",
);
report(softNote(`ls -la${NOTE}`) === "", "good note: no note");
report(
  softNote("ls -la\n\n# WHAT THIS DOES: lists the files in this folder", {
    agent_id: "sub-1",
  }) === "",
  "helper with a lowercase note: no note",
);
const soft = JSON.parse(
  run(B("ls -la\n\n# WHAT THIS DOES: lists the files in this folder")),
).hookSpecificOutput;
report(
  !("permissionDecision" in soft) && !("updatedInput" in soft),
  "soft check never refuses or rewrites the command",
);
// Auto mode (permission_mode "auto"): Nimbalyst's classifier reviews each call, and an updatedInput voids that
// review, so the hook rewrites nothing and tells Claude in additionalContext instead
const auto = (command, extra = {}) => {
  const out = run({ ...B(command), permission_mode: "auto", ...extra });
  if (out === "") return null;
  try {
    return JSON.parse(out).hookSpecificOutput;
  } catch {
    return { unreadable: out };
  }
};
const told = (h) =>
  h &&
  !("updatedInput" in h) &&
  !("permissionDecision" in h) &&
  String(h.additionalContext).startsWith("command-explain:");
const bare = auto("ls -la");
report(
  told(bare) && bare.additionalContext.includes("# WHAT THIS DOES:"),
  "auto: a command with no note is not rewritten; the missing note is told in additionalContext",
);
const tight = auto(`ls -la\n${LINE}`);
report(
  told(tight) && /empty line/.test(tight.additionalContext),
  "auto: a note with no empty line before it is not rewritten; the missing empty line is told in additionalContext",
);
// In auto mode the classifier decides and a popup seldom shows, so the reason given is the one that holds there
for (const [what, h] of [
  ["no note", bare],
  ["no empty line", tight],
])
  report(
    /agents panel/.test(h?.additionalContext) &&
      !/popup (explained nothing|showed)/.test(h?.additionalContext),
    `auto, ${what}: the context names the agents panel and any popup that shows, not a popup that always shows`,
  );
report(auto(`ls -la${NOTE}`) === null, "auto: a good note: no output");
for (const cmd of ["ls -la", `ls -la\n${LINE}`])
  report(
    !("updatedInput" in (auto(cmd, { agent_id: "sub-1" }) ?? {})),
    `auto: a helper's command (${JSON.stringify(cmd)}) is not rewritten`,
  );
// Any other mode: the output is byte for byte the one with no mode in the event
for (const mode of ["default", "acceptEdits", "bypassPermissions", "plan"])
  for (const cmd of ["ls -la", `ls -la\n${LINE}`, `ls -la${NOTE}`])
    report(
      run({ ...B(cmd), permission_mode: mode }) === run(B(cmd)),
      `mode ${mode}: the same output as now for ${JSON.stringify(cmd)}`,
    );
console.log(fail ? `${fail} failed` : `all ${ran} passed`);
process.exit(fail ? 1 : 0);
