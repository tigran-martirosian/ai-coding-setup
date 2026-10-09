// Tests for hooks/command-explain.mjs. Run: node test-command-explain.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/command-explain.mjs", import.meta.url));
// Every run names its surroundings, so results don't depend on where the tests are started.
const TERMINAL = { CLAUDE_CODE_ENTRYPOINT: "cli", COMMAND_EXPLAIN_BASH: "yes", COMMAND_EXPLAIN_LINES: "", COMMAND_EXPLAIN_WIDTH: "" };
const NIMBALYST = { ...TERMINAL, CLAUDE_CODE_ENTRYPOINT: "sdk-cli" };
const run = (input, env = TERMINAL) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
const B = (command, tool = "Bash") => ({ tool_name: tool, tool_input: { command, description: "List files" } });
const LINE = "# WHAT THIS DOES: Lists the files in this folder.";
const NOTE = `\n\n${LINE}`; // an empty line, then the labelled note
const echoes = (n) => Array.from({ length: n }, (_, i) => `echo ${i + 1}`).join("\n");
const MISSING = "no explanation line";

const cases = [
  ["bare command is denied", B("ls -la"), MISSING],
  ["command, empty line, labelled note passes", B(`ls -la${NOTE}`), false],
  ["several lines, empty line, labelled note passes", B(`cd app && npm install\nnpm test | tail -5${NOTE}`), false],
  ["note without the label is denied", B("ls -la\n\n# Lists the files in this folder."), MISSING],
  ["label in lower case is denied", B("ls -la\n\n# what this does: Lists the files in this folder."), MISSING],
  ["labelled note with no empty line before it is denied", B(`ls -la\n${LINE}`), MISSING],
  ["note on the first line only is denied", B(`${LINE}\n\nls -la`), MISSING],
  ["note alone with no command is denied", B(LINE), MISSING],
  ["note on the same line as the command is denied", B(`ls -la ${LINE}`), MISSING],
  ["too-short note is denied", B("ls -la\n\n# WHAT THIS DOES: ok"), MISSING],
  ["note without words is denied", B("ls -la\n\n# WHAT THIS DOES: ---- 123 ----"), MISSING],
  ["blank lines after the note pass", B(`ls -la${NOTE}\n\n`), false],
  ["Windows line endings pass", B(`ls -la\r\n\r\n${LINE}\r\n`), false],
  ["note in another language passes", B("ls -la\n\n# WHAT THIS DOES: Показывает файлы в этой папке."), false],
  ["heredoc followed by a note passes", B(`node - <<'EOF'\nconsole.log(1)\nEOF${NOTE}`), false],
  ["heredoc with the note inside it is denied", B(`node - <<'EOF'\n\n${LINE}\nconsole.log(1)\nEOF`), MISSING],
  ["PowerShell bare command is denied", B("Get-ChildItem", "PowerShell"), MISSING],
  ["terminal: PowerShell with a note passes", B(`Get-ChildItem${NOTE}`, "PowerShell"), false],
  ["terminal: a 14-line command with a note passes", B(`${echoes(12)}${NOTE}`), false],
  ["other tools pass", { tool_name: "Read", tool_input: { file_path: "x" } }, false],
  ["bad JSON fails open", "not json", false],
  ["no command fails open", { tool_name: "Bash", tool_input: {} }, false],
  ["Nimbalyst: short command with a note passes", B(`ls -la${NOTE}`), false, NIMBALYST],
  ["Nimbalyst: bare command is denied", B("ls -la"), MISSING, NIMBALYST],
  ["Nimbalyst: PowerShell with a note is denied", B(`Get-ChildItem${NOTE}`, "PowerShell"), "Bash tool", NIMBALYST],
  ["Nimbalyst without Git Bash: PowerShell with a note passes", B(`Get-ChildItem${NOTE}`, "PowerShell"), false, { ...NIMBALYST, COMMAND_EXPLAIN_BASH: "no" }],
  ["Nimbalyst without Git Bash: bare PowerShell is denied", B("Get-ChildItem", "PowerShell"), MISSING, { ...NIMBALYST, COMMAND_EXPLAIN_BASH: "no" }],
  ["Nimbalyst: a 14-line command is denied", B(`${echoes(12)}${NOTE}`), "too long", NIMBALYST],
  ["Nimbalyst: one 1000-character line is denied", B(`echo ${"x".repeat(1000)}${NOTE}`), "too long", NIMBALYST],
  ["Nimbalyst: 7 lines in all pass", B(`${echoes(5)}${NOTE}`), false, NIMBALYST],
  ["Nimbalyst: 8 lines in all are denied", B(`${echoes(6)}${NOTE}`), "too long", NIMBALYST],
  ["Nimbalyst: one 300-character line passes", B(`echo ${"x".repeat(300)}${NOTE}`), false, NIMBALYST],
  ["Nimbalyst: COMMAND_EXPLAIN_LINES raises the limit", B(`${echoes(12)}${NOTE}`), false, { ...NIMBALYST, COMMAND_EXPLAIN_LINES: "20" }],
  ["Nimbalyst: a long command with no note gets the note message first", B(echoes(12)), MISSING, NIMBALYST],
  ["Nimbalyst: the too-long message says the command gets 5 lines", B(`${echoes(6)}${NOTE}`), "the command itself gets 5", NIMBALYST],
  ["Nimbalyst: the too-long message gives the two steps", B(`${echoes(6)}${NOTE}`), "with the Write tool; 2. run that file", NIMBALYST],
];
let fail = 0;
for (const [name, input, deny, env] of cases) {
  const out = run(input, env);
  const ok = deny === false ? out === "" : out.includes('"deny"') && out.includes(deny);
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const off = run(B("ls -la"), { ...NIMBALYST, COMMAND_EXPLAIN: "off" }) === "";
if (!off) fail++;
console.log(`${off ? "PASS" : "FAIL"} COMMAND_EXPLAIN=off disables it`);
const msg = run(B("ls -la"));
const example = msg.includes("# WHAT THIS DOES: Installs the project's packages");
if (!example) fail++;
console.log(`${example ? "PASS" : "FAIL"} deny message shows an example`);
console.log(fail ? `${fail} failed` : `all ${cases.length + 2} passed`);
process.exit(fail ? 1 : 0);
