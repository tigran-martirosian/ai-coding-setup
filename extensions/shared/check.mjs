// The test harness the extensions' test.mjs files share: a pass/fail counter and the build step.
import { spawnSync } from "node:child_process";

/** `check(name, ok)` counts and prints FAIL lines; `finish()` prints the totals and sets the exit code. */
export function createChecks() {
  let pass = 0;
  let fail = 0;
  return {
    check(name, ok) {
      if (ok) pass++;
      else {
        fail++;
        console.log(`FAIL ${name}`);
      }
    },
    finish() {
      console.log(`${pass} pass, ${fail} fail`);
      process.exit(fail ? 1 : 0);
    },
  };
}

/** Runs the extension's build.mjs (in `here`) for one language; throws with its stderr when it fails. */
export function buildFor(here, lang) {
  const r = spawnSync(process.execPath, ["build.mjs"], {
    cwd: here,
    encoding: "utf8",
    env: { ...process.env, SETUP_LANGUAGE: lang },
  });
  if (r.status !== 0) throw new Error(`build (${lang}) failed: ${r.stderr}`);
}
