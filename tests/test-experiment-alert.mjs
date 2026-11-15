// Tests for hooks/experiment-alert.mjs with a fake home folder and a fake ~/.claude.json (never the real one).
// Run: node tests/test-experiment-alert.mjs
process.env.HOOK_ERRORS_LOG = "off"; // the broken-file case must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/experiment-alert.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "experiment-alert-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};

const SECRET_ID = "3f9a1c2e-77b0-4d1e-9a6b-0c5e2f8d4a11";
const config = path.join(tmp, "claude.json");
const writeConfig = (experiments, flags, extra = {}) =>
  fs.writeFileSync(
    config,
    JSON.stringify({
      userID:
        "a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90",
      cachedExperimentData: Object.fromEntries(
        experiments.map((n) => [
          n,
          { experimentId: SECRET_ID, variationId: 1, value: true },
        ]),
      ),
      cachedExperimentFeatures: experiments,
      cachedGrowthBookFeatures: Object.fromEntries(
        flags.map((n) => [n, { token: "secret-flag-value-never-shown" }]),
      ),
      ...extra,
    }),
  );
const run = (env = {}) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: tmp,
      USERPROFILE: tmp,
      EXPERIMENT_ALERT: "",
      EXPERIMENT_ALERT_FILE: config,
      ...env,
    },
  });
  return { code: r.status, out: r.stdout ? JSON.parse(r.stdout) : null };
};
const seenFile = path.join(
  tmp,
  ".claude",
  "hooks",
  "state",
  "experiment-alert",
  "seen.json",
);
const seen = () => JSON.parse(fs.readFileSync(seenFile, "utf8"));

writeConfig(
  ["tengu_amber_prism"],
  ["tengu_amber_tollgate", "tengu-fable-off-switch"],
);
const first = run();
check("the first run says nothing", first.code === 0 && first.out === null);
check(
  "the first run records the names",
  JSON.stringify(seen()) ===
    JSON.stringify({
      experiments: ["tengu_amber_prism"],
      flags: ["tengu-fable-off-switch", "tengu_amber_tollgate"],
    }),
);
check("the same names again: nothing", run().out === null);

writeConfig(
  ["tengu_amber_prism", "tengu_breezy_horizon"],
  ["tengu_amber_tollgate", "tengu-fable-off-switch"],
);
const exp = run();
const msg = exp.out?.systemMessage || "";
check(
  "a new experiment is told to the user",
  /new experiment: tengu_breezy_horizon/.test(msg),
);
check(
  "Claude gets the same text at SessionStart",
  exp.out?.hookSpecificOutput?.hookEventName === "SessionStart" &&
    exp.out.hookSpecificOutput.additionalContext === msg,
);
check("no flag line when no flag is new", !/feature flag/.test(msg));
check(
  "the new name is recorded",
  seen().experiments.includes("tengu_breezy_horizon"),
);
check("told once", run().out === null);

const many = Array.from(
  { length: 11 },
  (_, i) => `tengu_flag_${String.fromCharCode(97 + i)}`,
);
writeConfig(
  ["tengu_amber_prism", "tengu_breezy_horizon"],
  ["tengu_amber_tollgate", ...many],
);
const flags = run().out?.systemMessage || "";
check(
  "new flags are listed, the rest counted",
  /new feature flags: tengu_flag_a, .*tengu_flag_h and 3 more/.test(flags),
);
check(
  "a removed name is kept in the record",
  seen().flags.includes("tengu-fable-off-switch"),
);

writeConfig(
  [
    "tengu_amber_prism",
    "tengu_breezy_horizon",
    SECRET_ID,
    "deadbeefdeadbeefdeadbeef",
  ],
  [
    "tengu_amber_tollgate",
    ...many,
    "AbCdEfGhIjKlMnOpQrStUvWxYz012345",
    "tengu-fable-off-switch",
  ],
);
const ids = run().out;
const stored = fs.readFileSync(seenFile, "utf8");
check(
  "names that look like ids or tokens are skipped",
  ids === null && !/3f9a1c2e|deadbeef|AbCdEf/.test(stored),
);
const allOut = JSON.stringify([first.out, exp.out, flags, ids]) + stored;
check(
  "no value is printed or stored",
  !/secret-flag-value|a1b2c3d4|experimentId|variationId/.test(allOut) &&
    !allOut.includes(SECRET_ID),
);

writeConfig(["tengu_new_one"], []);
check(
  "EXPERIMENT_ALERT=off says nothing and records nothing",
  run({ EXPERIMENT_ALERT: "off" }).out === null &&
    !seen().experiments.includes("tengu_new_one"),
);

fs.writeFileSync(config, "{ not json");
const broken = run();
check(
  "a broken claude.json fails open",
  broken.code === 0 && broken.out === null,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
