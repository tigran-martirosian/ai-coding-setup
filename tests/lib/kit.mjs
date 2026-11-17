// Shared plumbing for the hook tests (not a test: run-all only runs test-*.mjs files in tests/).
//   import { makeChecker, tmpHome, runHook, sleep, nodeStarts, UNDER_STARTS } from "./lib/kit.mjs";
// A test that imports this file gets HOOK_ERRORS_LOG=off unless run-all or the caller already set it, so a hook fed junk
// input leaves nothing in the real crash log. A case that tests the log passes its own HOOK_ERRORS_LOG path in env.
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.HOOK_ERRORS_LOG ||= "off";

// A speed budget for a hook a person waits on, in bare node starts rather than ms: CI runs test files side by side
// (cores minus one), and a busy computer slows a hook and a bare start alike, so the count holds where a fixed ms limit fails.
// The hooks timed this way take 2 to 3 starts; a hook slowed by 2 s takes about 100.
export const UNDER_STARTS = 50;

// Times run() against a bare `node -e 0` start taken right beside it, best of n each.
// Returns { ms, startMs, starts }: the run's best, the bare start's best, and the run in bare starts.
export function nodeStarts(n, run) {
  let ms = Infinity,
    startMs = Infinity;
  for (let i = 0; i < n; i++) {
    let t = performance.now();
    const r = spawnSync(process.execPath, ["-e", "0"]);
    if (r.status !== 0)
      throw new Error(
        `a bare node start failed: ${r.error?.message ?? `exit ${r.status}`}`,
      );
    startMs = Math.min(startMs, performance.now() - t);
    t = performance.now();
    run();
    ms = Math.min(ms, performance.now() - t);
  }
  return {
    ms: Math.round(ms),
    startMs: Math.round(startMs),
    starts: Math.round((10 * ms) / startMs) / 10,
  };
}

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
