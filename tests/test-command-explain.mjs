// Tests for hooks/command-explain.mjs. Run: node test-command-explain.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/command-explain.mjs", import.meta.url));
const run = (input, env = {}) =>
  spawnSync(process.execPath, [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), env: { ...process.env, ...env }, encoding: "utf8" }).stdout;
const B = (command, tool = "Bash") => ({ tool_name: tool, tool_input: { command, description: "List files" } });

const cases = [
  ["bare command is denied", B("ls -la"), true],
  ["command with a last-line note passes", B("ls -la\n# Lists the files in this folder."), false],
  ["long command with a last-line note passes", B("cd app && npm install\nnpm test | tail -5\n# Installs packages, then runs the tests and shows the last lines."), false],
  ["note on the first line only is denied", B("# Lists the files in this folder.\nls -la"), true],
  ["note on the same line as the command is denied", B("ls -la # Lists the files in this folder."), true],
  ["too-short note is denied", B("ls -la\n# ok"), true],
  ["note without words is denied", B("ls -la\n# ---- 123 ----"), true],
  ["blank lines after the note pass", B("ls -la\n# Lists the files in this folder.\n\n"), false],
  ["Windows line endings pass", B("ls -la\r\n# Lists the files in this folder.\r\n"), false],
  ["note in another language passes", B("ls -la\n# Показывает файлы в этой папке."), false],
  ["heredoc followed by a note passes", B("node - <<'EOF'\nconsole.log(1)\nEOF\n# Runs a one-line Node script that prints 1."), false],
  ["heredoc with no note after it is denied", B("node - <<'EOF'\n# prints the number one\nconsole.log(1)\nEOF"), true],
  ["PowerShell bare command is denied", B("Get-ChildItem", "PowerShell"), true],
  ["PowerShell with a note passes", B("Get-ChildItem\n# Lists the files in this folder.", "PowerShell"), false],
  ["other tools pass", { tool_name: "Read", tool_input: { file_path: "x" } }, false],
  ["bad JSON fails open", "not json", false],
  ["no command fails open", { tool_name: "Bash", tool_input: {} }, false],
];
let fail = 0;
for (const [name, input, deny] of cases) {
  const out = run(input);
  const ok = deny ? out.includes('"deny"') : out === "";
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
const off = run(B("ls -la"), { COMMAND_EXPLAIN: "off" }) === "";
if (!off) fail++;
console.log(`${off ? "PASS" : "FAIL"} COMMAND_EXPLAIN=off disables it`);
const msg = run(B("ls -la"));
const example = msg.includes("# Installs the project's packages");
if (!example) fail++;
console.log(`${example ? "PASS" : "FAIL"} deny message shows an example`);
console.log(fail ? `${fail} failed` : `all ${cases.length + 2} passed`);
process.exit(fail ? 1 : 0);
