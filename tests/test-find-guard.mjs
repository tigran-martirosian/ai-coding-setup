// Tests for hooks/find-guard.mjs. Run: node tests/test-find-guard.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const hook = fileURLToPath(new URL("../hooks/find-guard.mjs", import.meta.url));
const run = (ev, env = {}) =>
  spawnSync(process.execPath, [hook], {
    input:
      typeof ev === "string"
        ? ev
        : JSON.stringify({
            session_id: "t",
            hook_event_name: "PreToolUse",
            ...ev,
          }),
    env: { ...process.env, FIND_GUARD: "", ...env },
    encoding: "utf8",
  });
const bash = (command) => ({ tool_name: "Bash", tool_input: { command } });
const ps = (command) => ({ tool_name: "PowerShell", tool_input: { command } });
const verdict = (out) =>
  out
    ? (JSON.parse(out).hookSpecificOutput?.permissionDecision ?? "note")
    : "pass";
const cases = [
  // a whole drive or the whole home folder: refused
  ["find /: refused", bash("find / -name settings.json 2>/dev/null"), "deny"],
  ["find /c: refused", bash("find /c -name '*.log'"), "deny"],
  ["find /c/: refused", bash("find /c/ -iname nimbalyst.exe"), "deny"],
  ["find C:/: refused", bash('find "C:/" -name x'), "deny"],
  [
    "find ~ without -maxdepth: refused",
    bash("find ~ -name '*.jsonl' | head"),
    "deny",
  ],
  ["find $HOME: refused", bash("find $HOME -type f -name x"), "deny"],
  [
    "find the home folder by its path: refused",
    bash("find /c/Users/you -name x"),
    "deny",
  ],
  ["find -L /: refused", bash("find -L / -name x"), "deny"],
  [
    "find ~ -maxdepth 5: refused (over the limit of 3)",
    bash("find ~ -maxdepth 5 -name x"),
    "deny",
  ],
  ["grep -r from home: refused", bash("grep -rn 'token' ~"), "deny"],
  ["grep -R from a drive root: refused", bash("grep -Rl secret /c/"), "deny"],
  ["rg from home: refused", bash("rg -l 'api_key' ~/"), "deny"],
  [
    "rg --files from a drive root: refused",
    bash("rg --files C:/ | rg nimbalyst"),
    "deny",
  ],
  [
    "Get-ChildItem C:\\ -Recurse: refused",
    ps("Get-ChildItem C:\\ -Recurse -Filter *.log"),
    "deny",
  ],
  [
    "gci -Path $env:USERPROFILE -Recurse: refused",
    ps("gci -Path $env:USERPROFILE -Recurse -Include *.jsonl"),
    "deny",
  ],
  [
    "Get-ChildItem -Depth 6 from C:\\: refused",
    ps("Get-ChildItem C:\\ -Depth 6"),
    "deny",
  ],
  ["dir /s C:\\ in cmd: refused", bash("cmd //c dir /s C:\\ /b"), "deny"],
  [
    "dir /s C:\\ in PowerShell's cmd: refused",
    ps('cmd /c "dir /s /b C:\\nimbalyst.exe"'),
    "deny",
  ],
  [
    "Get-ChildItem inside powershell -Command: refused",
    bash('powershell -NoProfile -Command "Get-ChildItem C:\\ -Recurse"'),
    "deny",
  ],
  ["where /r C:\\: refused", bash("where /r C:\\ node.exe"), "deny"],
  ["ls -R ~: refused", bash("ls -R ~"), "deny"],
  ["find / after a cd: refused", bash("cd /tmp && find / -name x"), "deny"],
  // a named folder, a depth of 3 or less, no recursion: allowed
  ["find in the project: allowed", bash("find . -name '*.mjs'"), "pass"],
  ["find with no folder: allowed", bash("find -name '*.mjs'"), "pass"],
  [
    "find in a folder below home: allowed",
    bash("find ~/.claude -name '*.md'"),
    "pass",
  ],
  [
    "find in a named folder on C:: allowed",
    bash('find "C:/Program Files/Nimbalyst" -name "*.exe"'),
    "pass",
  ],
  [
    "find ~ -maxdepth 2: allowed",
    bash("find ~ -maxdepth 2 -name '*.json'"),
    "pass",
  ],
  ["find / -maxdepth 3: allowed", bash("find / -maxdepth 3 -name x"), "pass"],
  [
    "rg --max-depth 3 from home: allowed",
    bash("rg --max-depth 3 -l x ~"),
    "pass",
  ],
  ["rg with the pattern / in a folder: allowed", bash("rg -n / src"), "pass"],
  [
    "grep without -r on a home file: allowed",
    bash("grep -n alias ~/.bashrc"),
    "pass",
  ],
  ["grep -r for / in the project: allowed", bash("grep -rn / hooks"), "pass"],
  [
    "Get-ChildItem C:\\ without -Recurse: allowed",
    ps("Get-ChildItem C:\\"),
    "pass",
  ],
  [
    "Get-ChildItem -Depth 2 from home: allowed",
    ps("Get-ChildItem $env:USERPROFILE -Depth 2"),
    "pass",
  ],
  [
    "Get-ChildItem -Recurse in a named folder: allowed",
    ps("Get-ChildItem C:\\work\\app -Recurse -Filter *.mjs"),
    "pass",
  ],
  // a bare * is the current folder's files, not a drive root; /* and C:/* are
  ['grep -rn "TODO" *: allowed', bash('grep -rn "TODO" *'), "pass"],
  ["rg TODO *: allowed", bash("rg TODO *"), "pass"],
  ['find * -name "*.md": allowed', bash('find * -name "*.md"'), "pass"],
  ["ls -R *: allowed", bash("ls -R *"), "pass"],
  ['rg foo -g "*": allowed', bash('rg foo -g "*"'), "pass"],
  ["find /*: refused", bash("find /* -name x"), "deny"],
  ["grep -r from C:/*: refused", bash("grep -rl secret C:/*"), "deny"],
  ["dir C:\\ without /s: allowed", bash("cmd //c dir C:\\"), "pass"],
  ["ls ~ without -R: allowed", bash("ls -la ~"), "pass"],
  [
    "find.exe in PowerShell searches text: allowed",
    ps('find /c "error" log.txt'),
    "pass",
  ],
  // quoted text and text bodies are not commands
  ['echo "find /": allowed', bash('echo "find / -name x"'), "pass"],
  [
    "a commit message naming find ~: allowed",
    bash("git commit -m 'find-guard refuses find ~ and grep -r /'"),
    "pass",
  ],
  [
    "a heredoc body naming find /: allowed",
    bash(
      "cat > notes.txt <<'EOF'\nfind / -name x\nGet-ChildItem C:\\ -Recurse\nEOF",
    ),
    "pass",
  ],
  [
    "a PowerShell here-string naming Get-ChildItem C:\\ -Recurse: allowed",
    ps("$t = @'\nGet-ChildItem C:\\ -Recurse\n'@\nWrite-Output $t"),
    "pass",
  ],
  [
    "grep for the text find /: allowed",
    bash("grep -rn 'find /' hooks"),
    "pass",
  ],
  // other tools, switch, bad input
  [
    "Grep tool: ignored",
    { tool_name: "Grep", tool_input: { pattern: "x", path: "C:/" } },
    "pass",
  ],
  [
    "FIND_GUARD=off passes find /",
    [bash("find / -name x"), { FIND_GUARD: "off" }],
    "pass",
  ],
  ["junk input: passes", "not json", "pass"],
];
let failed = 0;
for (const [name, ev, want] of cases) {
  const [event, env] = Array.isArray(ev) ? ev : [ev, {}];
  const r = run(event, env);
  const got = r.status === 0 ? verdict(r.stdout) : `exit ${r.status}`;
  if (got !== want) failed++;
  console.log(
    `${got === want ? "ok  " : "FAIL"} ${name}${got === want ? "" : ` (got ${got})`}`,
  );
}
const msg = JSON.parse(run(bash("find ~ -name x")).stdout).hookSpecificOutput
  .permissionDecisionReason;
const words =
  msg.includes("all of ~") &&
  msg.includes("project folder") &&
  msg.includes("-maxdepth 3");
if (!words) failed++;
console.log(
  `${words ? "ok  " : "FAIL"} the message names the folder, the project folder and the depth limit`,
);
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
