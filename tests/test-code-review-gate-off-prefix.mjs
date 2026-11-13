// Test: the push check honours CODE_REVIEW_GATE=off written in front of the command, as its deny reason tells you to,
// and not the same words in a comment line or quoted text. Run: node tests/test-code-review-gate-off-prefix.mjs
import { offInCommand } from "../hooks/code-review-gate.mjs";

const send = ["python tools/deploy.py", "send --version 9.9.9"].join(" ");
const cases = [
  [send, false],
  [`CODE_REVIEW_GATE=off ${send}`, true],
  [`$env:CODE_REVIEW_GATE="off"; ${send}`, true],
  [`echo CODE_REVIEW_GATE_offx; ${send}`, false],
  [`${send}\n\n# WHAT THIS DOES: deploys; CODE_REVIEW_GATE=off is not set`, false],
  [`echo "note: CODE_REVIEW_GATE=off removed" && ${send}`, false],
];
let failed = 0;
for (const [command, want] of cases) {
  const got = offInCommand(command);
  if (got !== want) failed++;
  console.log(`${got === want ? "ok  " : "FAIL"} ${got ? "off " : "gate"} ${command.replace(/\n/g, " ")}`);
}
process.exit(failed ? 1 : 0);
