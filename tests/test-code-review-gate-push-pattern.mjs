// Test: a project's REVIEW_PUSH_PATTERN matches a real deploy command, not the same words inside quoted search text.
// Run: node tests/test-code-review-gate-push-pattern.mjs
process.env.REVIEW_PUSH_PATTERN = "(deploy|push-updater)\\.py\\s+send";
const { isPush } = await import("../hooks/code-review-gate.mjs");

const cases = [
  ["python tools/deploy.py send --version 9.9.9", true],
  ["cd /c/x && python tools/push-updater.py send --version 9.9.9 2>&1 | tail -8", true],
  ["grep -l 'deploy.py send --version 4.2.3\\|push-updater.py send' *.jsonl", false],
  ['grep -rl "deploy.py send --version 4.2.3" .', false],
  ["python tools/deploy.py check --version 9.9.9\n\n# WHAT THIS DOES: before deploy.py send", false],
  ["git push", true],
];
let failed = 0;
for (const [command, want] of cases) {
  const got = isPush(command);
  if (got !== want) failed++;
  console.log(`${got === want ? "ok  " : "FAIL"} ${got ? "push" : "pass"} ${command.replace(/\n/g, " ")}`);
}
process.exit(failed ? 1 : 0);
