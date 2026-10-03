// Tests for hooks/big-read-gate.mjs on made-up files in a temp folder. Run: node test-big-read-gate.mjs
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/big-read-gate.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "big-read-gate-test-"));
const bigText = Array.from({ length: 7500 }, (_, i) => `line ${i + 1}`).join("\n");
const B = join(dir, "big.txt");
writeFileSync(B, bigText);
writeFileSync(join(dir, "small.md"), "a few\nshort\nlines\n");
writeFileSync(join(dir, "picture.png"), Buffer.alloc(100000));
// a project that switched the gate off in its own settings
const optOut = join(dir, "opted-out");
mkdirSync(join(optOut, ".claude"), { recursive: true });
mkdirSync(join(optOut, "tools"));
writeFileSync(join(optOut, ".claude", "settings.json"), JSON.stringify({ env: { BIG_READ_GATE: "off" } }));
writeFileSync(join(optOut, "big.txt"), bigText);
// Git Bash writes C:\ as /c/
const gitBashDir = process.platform === "win32" ? dir.replace(/^([A-Za-z]):/, (_, d) => "/" + d.toLowerCase()).replace(/\\/g, "/") : dir;

const cases = [
  ["Read big whole", "deny", { tool_name: "Read", tool_input: { file_path: B } }],
  ["Read big targeted 100", "pass", { tool_name: "Read", tool_input: { file_path: B, offset: 100, limit: 100 } }],
  ["Read big offset-only", "deny", { tool_name: "Read", tool_input: { file_path: B, offset: 100 } }],
  ["Read big tail via offset 7400", "pass", { tool_name: "Read", tool_input: { file_path: B, offset: 7400 } }],
  ["Read small", "pass", { tool_name: "Read", tool_input: { file_path: join(dir, "small.md") } }],
  ["Read png", "pass", { tool_name: "Read", tool_input: { file_path: join(dir, "picture.png") } }],
  ["Read missing", "pass", { tool_name: "Read", tool_input: { file_path: join(dir, "nope.txt") } }],
  ["relative cat in opted-out project", "pass", { tool_name: "Bash", tool_input: { command: "cat big.txt" }, cwd: optOut }],
  ["PS Get-Content -Path quoted", "deny", { tool_name: "PowerShell", tool_input: { command: `Get-Content -Path "${B}"` } }],
  ["PS Get-Content -TotalCount 40", "pass", { tool_name: "PowerShell", tool_input: { command: "Get-Content big.txt -TotalCount 40" } }],
  ["PS type big", "deny", { tool_name: "PowerShell", tool_input: { command: `type "${B}"` } }],
  ["Grep tool ignored", "pass", { tool_name: "Grep", tool_input: { pattern: "x", path: B } }],
  ["opted-out project Read", "pass", { tool_name: "Read", tool_input: { file_path: join(optOut, "big.txt") }, cwd: join(optOut, "tools") }],
  ["relative Read big", "deny", { tool_name: "Read", tool_input: { file_path: "big.txt" } }],
  ["Git Bash cwd, relative cat", "deny", { tool_name: "Bash", tool_input: { command: "cat big.txt" }, cwd: gitBashDir }],
  // pipes and redirects: only a filter, a line limit or a file as the target lets a dump through
  ["cat piped into grep", "pass", { tool_name: "Bash", tool_input: { command: "cat big.txt | grep 'line 7'" } }],
  ["cat piped into head -20", "pass", { tool_name: "Bash", tool_input: { command: "cat big.txt | head -20" } }],
  ["cat redirected to a file", "pass", { tool_name: "Bash", tool_input: { command: "cat big.txt > copy.txt" } }],
  ["cat piped into tee", "deny", { tool_name: "Bash", tool_input: { command: "cat big.txt | tee copy.txt" } }],
  ["cat with only errors redirected", "deny", { tool_name: "Bash", tool_input: { command: "cat big.txt 2>/dev/null" } }],
  ["cat with input redirect", "deny", { tool_name: "Bash", tool_input: { command: "cat < big.txt" } }],
  ["tail -n +5 (to the end)", "deny", { tool_name: "Bash", tool_input: { command: "tail -n +5 big.txt" } }],
  ["tail -n 30", "pass", { tool_name: "Bash", tool_input: { command: "tail -n 30 big.txt" } }],
  ["cat after && and a variable", "deny", { tool_name: "Bash", tool_input: { command: "cd . && LANG=C cat big.txt" } }],
  ["semicolon inside a string is not a new command", "pass", { tool_name: "Bash", tool_input: { command: 'echo "done; cat big.txt"' } }],
  ["cat inside a heredoc body is text", "pass", { tool_name: "Bash", tool_input: { command: "node - <<'EOF'\ncat big.txt\nEOF" } }],
  ["cat of a missing file", "pass", { tool_name: "Bash", tool_input: { command: "cat nope.txt" } }],
  ["bash -c carries a dump", "deny", { tool_name: "Bash", tool_input: { command: "bash -c 'cat big.txt'" } }],
  ["powershell -Command carries a dump", "deny", { tool_name: "Bash", tool_input: { command: "powershell -NoProfile -Command 'Get-Content big.txt'" } }],
  ["powershell -Command with a line limit", "pass", { tool_name: "Bash", tool_input: { command: "powershell -NoProfile -Command 'Get-Content big.txt -TotalCount 40'" } }],
  ["PS Get-Content piped into Select-Object -First", "pass", { tool_name: "PowerShell", tool_input: { command: "Get-Content big.txt | Select-Object -First 20" } }],
  ["PS Get-Content piped into Out-Host", "deny", { tool_name: "PowerShell", tool_input: { command: "Get-Content big.txt | Out-Host" } }],
];
let fail = 0;
for (const [name, want, ev] of cases) {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify({ cwd: dir, ...ev }) });
  const got = r.stdout.toString().includes('"deny"') ? "deny" : "pass";
  if (got !== want) fail++;
  console.log(`${got === want ? "ok  " : "FAIL"} ${name}: ${got}`);
}
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
