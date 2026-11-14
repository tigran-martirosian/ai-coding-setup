// Tests for hooks/long-sleep-guard.mjs. Run: node tests/test-long-sleep-guard.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(
  new URL("../hooks/long-sleep-guard.mjs", import.meta.url),
);
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
    env: { ...process.env, LONG_SLEEP_GUARD: "", ...env },
    encoding: "utf8",
  });
const bash = (command, more = {}) => ({
  tool_name: "Bash",
  tool_input: { command, ...more.input },
  ...more.event,
});
const ps = (command) => ({ tool_name: "PowerShell", tool_input: { command } });
const helper = (command, input = {}) =>
  bash(command, { input, event: { agent_id: "a1" } });
const bg = (command, event = {}) =>
  bash(command, { input: { run_in_background: true }, event });
const verdict = (out) =>
  out
    ? (JSON.parse(out).hookSpecificOutput?.permissionDecision ?? "note")
    : "pass";
const cases = [
  // one sleep over 60 s: main session and helpers, foreground and background
  ["sleep 300: refused", bash("sleep 300"), "deny"],
  ["Start-Sleep -Seconds 90: refused", ps("Start-Sleep -Seconds 90"), "deny"],
  ["Start-Sleep 90: refused", ps("Start-Sleep 90"), "deny"],
  ["Start-Sleep -Seconds:90: refused", ps("Start-Sleep -Seconds:90"), "deny"],
  ["sleep 2m: refused", bash("sleep 2m"), "deny"],
  ["sleep 1.5m: refused", bash("sleep 1.5m"), "deny"],
  [
    "sleep 1h after a build: refused",
    bash("npm run build && sleep 1h && ls dist"),
    "deny",
  ],
  [
    "timeout /t 120 in cmd: refused",
    bash('cmd //c "timeout /t 120 /nobreak"'),
    "deny",
  ],
  ["timeout /t -1 (waits for a key): refused", bash("timeout /t -1"), "deny"],
  ["sleep infinity (never ends): refused", bash("sleep infinity"), "deny"],
  [
    "sleep 300 inside bash -c: refused",
    bash('bash -c "sleep 300; echo done"'),
    "deny",
  ],
  [
    "Start-Sleep 300 inside powershell -NoProfile -Command: refused",
    bash('powershell -NoProfile -Command "Start-Sleep 300"'),
    "deny",
  ],
  ["sleep 300 in the background: refused", bg("sleep 300"), "deny"],
  ["helper sleep 300: refused", helper("sleep 300"), "deny"],
  [
    "helper sleep 300 in the background: refused",
    bg("sleep 300", { agent_id: "a1" }),
    "deny",
  ],
  [
    "a sleep after a closed loop is a single sleep: refused",
    bash("while kill -0 $p; do sleep 5; done; sleep 90"),
    "deny",
  ],
  // up to 60 s passes
  ["sleep 60: allowed", bash("sleep 60"), "pass"],
  ["sleep 1m: allowed", bash("sleep 1m"), "pass"],
  [
    "Start-Sleep -Milliseconds 5000: allowed",
    ps("Start-Sleep -Milliseconds 5000"),
    "pass",
  ],
  [
    "two sleeps of 30 s: allowed (the whole wait is background-tasks' part)",
    bash("sleep 30; check; sleep 30"),
    "pass",
  ],
  [
    "GNU timeout with a command: not a sleep",
    bash("timeout 300 npm test"),
    "pass",
  ],
  // loops: helpers' rounds are held to 60 s, the main session's loops are background-tasks' part
  [
    "helper loop with 120 s rounds: refused",
    helper("while kill -0 $p; do sleep 120; done"),
    "deny",
  ],
  [
    "helper loop on several lines with 120 s rounds: refused",
    helper("until grep -q done log\ndo\n  sleep 120\ndone"),
    "deny",
  ],
  [
    "helper PowerShell loop with 120 s rounds: refused",
    {
      ...ps("while ($true) { if (Test-Path done) { break }; Start-Sleep 120 }"),
      agent_id: "a1",
    },
    "deny",
  ],
  [
    "helper loop with 10 s rounds and a 10-minute timeout: allowed",
    helper("until grep -q done log; do sleep 10; done", { timeout: 600000 }),
    "pass",
  ],
  [
    "main-session loop with 120 s rounds: left to background-tasks",
    bash("while kill -0 $p; do sleep 120; done"),
    "pass",
  ],
  // quoted text and text bodies are not commands
  ['echo "sleep 300": allowed', bash('echo "sleep 300"'), "pass"],
  [
    "a commit message naming sleep 300: allowed",
    bash("git commit -m 'refuse sleep 300 and Start-Sleep 90'"),
    "pass",
  ],
  [
    "a heredoc body naming sleep 300: allowed",
    bash(
      "git commit -F - <<'EOF'\nlong-sleep-guard: sleep 300 is refused\nEOF\necho ok",
    ),
    "pass",
  ],
  [
    "a PowerShell here-string naming Start-Sleep 300: allowed",
    ps("$t = @'\nStart-Sleep 300\n'@\nWrite-Output $t"),
    "pass",
  ],
  [
    "grep for the word sleep: allowed",
    bash("grep -n 'sleep 300' hooks/*.mjs"),
    "pass",
  ],
  // other tools, switches, bad input
  [
    "Read tool: ignored",
    { tool_name: "Read", tool_input: { file_path: "sleep 300" } },
    "pass",
  ],
  [
    "LONG_SLEEP_GUARD=off passes sleep 300",
    [bash("sleep 300"), { LONG_SLEEP_GUARD: "off" }],
    "pass",
  ],
  [
    "LONG_SLEEP_GUARD=warn turns it into a note",
    [bash("sleep 300"), { LONG_SLEEP_GUARD: "warn" }],
    "note",
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
const msg = JSON.parse(run(helper("sleep 300")).stdout).hookSpecificOutput
  .permissionDecisionReason;
const main = JSON.parse(run(bash("sleep 300")).stdout).hookSpecificOutput
  .permissionDecisionReason;
const words =
  msg.includes("60 s") &&
  msg.includes("600000") &&
  main.includes("run_in_background: true") &&
  main.includes("ScheduleWakeup");
if (!words) failed++;
console.log(
  `${words ? "ok  " : "FAIL"} the message names the limit and the way out for a helper and for the main session`,
);
console.log(failed ? `${failed} failed` : "all passed");
process.exit(failed ? 1 : 0);
