// Shared plumbing for the hook tests (not a test: run-all only runs test-*.mjs files in tests/).
//   import { makeChecker, tmpHome, runHook, sleep, UNDER_MS } from "./lib/kit.mjs";
// A test that imports this file gets HOOK_ERRORS_LOG=off unless run-all or the caller already set it, so a hook fed junk
// input leaves nothing in the real crash log. A case that tests the log passes its own HOOK_ERRORS_LOG path in env.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOOK_ERRORS_LOG ||= "off";

// A speed case asserts "under this many ms", never a tight margin: a slow or loaded machine must not fail it.
export const UNDER_MS = 5000;

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// The check/ok counter: check(name, ok, extra) prints one line; summary() prints the count and exits 1 on any failure.
export function makeChecker() {
  let pass = 0,
    fail = 0;
  const check = (name, ok, extra = "") => {
    ok ? pass++ : fail++;
    console.log(
      `${ok ? "ok  " : "FAIL"} ${name}${ok || !extra ? "" : `\n     ${extra}`}`,
    );
  };
  const summary = () => {
    console.log(`\n${pass}/${pass + fail} passed`);
    process.exit(fail ? 1 : 0);
  };
  return { check, summary };
}

// A temp folder to use as HOME / USERPROFILE. remove() deletes it.
export function tmpHome(prefix = "test-home-") {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
}

// Runs a hook file with a JSON event (or a raw string) on stdin. env is added to process.env; home sets HOME and USERPROFILE.
// Returns { stdout, stderr, status, ms }.
export function runHook(hookFile, event, { env = {}, home, cwd } = {}) {
  const t = Date.now();
  const r = spawnSync(process.execPath, [hookFile], {
    input: typeof event === "string" ? event : JSON.stringify(event),
    encoding: "utf8",
    cwd,
    env: {
      ...process.env,
      ...(home ? { HOME: home, USERPROFILE: home } : {}),
      ...env,
    },
  });
  return {
    stdout: r.stdout,
    stderr: r.stderr,
    status: r.status,
    ms: Date.now() - t,
  };
}
