#!/usr/bin/env node
// Tests for slow-output-gate (PreToolUse: refuses a multi-minute command whose output is piped into a
// truncating filter with nothing saving it first).
// Run: node test-slow-output-gate.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/slow-output-gate.mjs", import.meta.url));
const { offending, declaredSeconds, reason } = await import(pathToFileURL(HOOK).href);

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
};

// ---------------- how long the command gives itself ----------------

const SECONDS = [
  ["timeout 420 python x.py plan", 420],
  ["timeout 7m python x.py plan", 420],
  ["timeout 2h ./render.sh", 7200],
  ["timeout -k 10 300 python x.py", 300],
  ["timeout --signal=KILL 600 node y.mjs", 600],
  ["cd /tmp && timeout 180 ./slow", 180],
  ["python x.py plan", 0],
  ["echo timeout 420", 420],  // only a shape check; the pipe test decides whether it is refused
];
for (const [cmd, want] of SECONDS) {
  ok(`declaredSeconds: ${cmd}`, declaredSeconds(cmd) === want, `got ${declaredSeconds(cmd)}, want ${want}`);
}

// ---------------- refused ----------------

const REFUSED = [
  // The real case this hook exists for: a status question answered with a multi-minute dry run.
  `cd ~/.claude/scratch && timeout 420 python panel_36b_deploy.py plan 2>&1 | tail -40`,
  `timeout 300 npm test | head -20`,
  `timeout 5m ./build.sh 2>&1 | grep -i error | head -5`,
  `timeout 600 python slow.py | Select-Object -First 30`,
  `echo start; timeout 240 ./x.sh | tail -n 5`,
  // The redirect comes after the filter, so it saves the five lines, not the run.
  `timeout 420 ./x.sh | tail -5 > out.txt`,
  // A group redirect that keeps nothing is not a save either.
  `{ timeout 420 ./x.sh | tail -5; } > /dev/null`,
];
for (const cmd of REFUSED) {
  ok(`refused: ${cmd.slice(0, 60)}`, offending(cmd) !== "", `offending() returned ""`);
}

// ---------------- allowed ----------------

const ALLOWED = [
  // Saved first, then filtered: the file can be reread for free. This is the fix the hook asks for.
  `timeout 420 python panel_36b_deploy.py plan > plan.txt 2>&1; echo "exit $?"; grep -nE "^state" plan.txt | head -25`,
  `timeout 420 python x.py plan 2>&1 | tee out.txt | head -40`,
  `timeout 300 ./build.sh 2>&1 | Tee-Object out.txt | Select-Object -First 20`,
  // Short commands are cheap to rerun, so a tail costs nothing.
  `timeout 30 ./quick.sh | tail -5`,
  `ls -1 panel_3*.py | tail -3`,
  // Slow but nothing truncated.
  `timeout 420 python x.py plan`,
  `timeout 420 python x.py plan 2>&1 | grep -n state`,
  // The filter belongs to a different, cheap statement.
  `timeout 420 python x.py plan > out.txt 2>&1 && tail -40 out.txt`,
  // A loop or group whose own output is redirected keeps everything, however each statement filters.
  `{ for f in test-*.mjs; do echo "== $f"; timeout 300 node "$f" 2>&1 | tail -3; done; } > all.txt 2>&1`,
  `( timeout 420 ./a.sh | tail -5; timeout 420 ./b.sh | tail -5 ) > both.txt`,
  // Not a command at all.
  `grep -rn "timeout 420 ./x | tail" docs/`,
  ``,
];
for (const cmd of ALLOWED) {
  ok(`allowed: ${(cmd || "(empty)").slice(0, 60)}`, offending(cmd) === "", `offending() returned ${JSON.stringify(offending(cmd))}`);
}

ok("a non-string command is ignored", offending(undefined) === "" && offending(null) === "");

// ---------------- the threshold can be moved ----------------

ok("a 60s command is fine at the default threshold", offending(`timeout 60 ./x.sh | tail -5`) === "");
ok("...and refused when the threshold is 30", offending(`timeout 60 ./x.sh | tail -5`, 30) !== "");

// ---------------- what the refusal says ----------------

{
  const text = reason(`timeout 420 python x.py plan | tail -40`);
  ok("the refusal shows how to save the output", /> out\.txt 2>&1/.test(text), text.slice(0, 120));
  ok("the refusal asks for the cheapest call", /cheapest call/.test(text));
  ok("the refusal names its off switch", /SLOW_OUTPUT_GATE=off/.test(text));
}

// ---------------- run as a real hook ----------------

const runHook = (payload) => {
  const r = spawnSync(process.execPath, [HOOK], { input: JSON.stringify(payload), encoding: "utf8" });
  return { out: (r.stdout || "").trim(), code: r.status };
};

{
  const { out } = runHook({ tool_name: "Bash", tool_input: { command: `timeout 420 python x.py plan | tail -40` } });
  const parsed = out ? JSON.parse(out) : null;
  ok("the hook denies the real payload", parsed?.hookSpecificOutput?.permissionDecision === "deny", out.slice(0, 160));
}
{
  const { out } = runHook({ tool_name: "Bash", tool_input: { command: `timeout 420 python x.py plan > out.txt 2>&1` } });
  ok("the hook stays silent on a saved run", out === "", out.slice(0, 160));
}
{
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ tool_name: "Bash", tool_input: { command: `timeout 420 ./x.sh | tail -5` } }),
    encoding: "utf8",
    env: { ...process.env, SLOW_OUTPUT_GATE: "off" },
  });
  ok("the off switch silences it", (r.stdout || "").trim() === "");
}
{
  const r = spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" });
  ok("broken input fails open", (r.stdout || "").trim() === "" && r.status === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
