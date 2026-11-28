#!/usr/bin/env node
// Tests for hooks/usage-report-hook.mjs: the Stop hook throttles (at most every 3 hours), spawns the collector
// detached when due, and obeys USAGE_REPORT=off. A --import recorder replaces child_process.spawn so nothing is
// actually started; it only logs what the hook would have launched.
// Run: node tests/test-usage-report-hook.mjs
process.env.HOOK_ERRORS_LOG = "off";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/usage-report-hook.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "usage-hook-test-"));
const HOME = path.join(tmp, ".claude");
fs.mkdirSync(HOME, { recursive: true });
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${extra}`}`);
};

// A recorder that logs every spawn and starts nothing.
const REC = path.join(tmp, "rec.mjs");
const SPAWNS = path.join(tmp, "spawns.jsonl");
fs.writeFileSync(
  REC,
  `import cp from "node:child_process";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
cp.spawn = (cmd, args) => {
  fs.appendFileSync(process.env.SPAWN_RECORD, JSON.stringify(args ?? []) + "\\n");
  return { unref() {} };
};
syncBuiltinESMExports();
`,
);

const stamp = path.join(HOME, "usage-report", "scan.stamp");
const runHook = (env = {}) =>
  spawnSync(process.execPath, ["--import", pathToFileURL(REC).href, HOOK], {
    input: JSON.stringify({ hook_event_name: "Stop" }),
    env: {
      ...process.env,
      USAGE_REPORT: "",
      USAGE_REPORT_HOME: HOME,
      SPAWN_RECORD: SPAWNS,
      ...env,
    },
    encoding: "utf8",
  });
const spawnCount = () =>
  fs.existsSync(SPAWNS)
    ? fs.readFileSync(SPAWNS, "utf8").split("\n").filter(Boolean).length
    : 0;

// Fresh: the hook spawns the collector and writes the stamp.
runHook();
check("a fresh turn spawns the collector", spawnCount() === 1);
check(
  "the spawn target is the usage-report worker",
  fs.readFileSync(SPAWNS, "utf8").includes("usage-report.mjs"),
);
check("the throttle stamp is written", fs.existsSync(stamp));

// Immediately again: throttled, no second spawn.
runHook();
check(
  "a second turn within the window does not spawn again",
  spawnCount() === 1,
);

// Stamp older than 3 hours: spawns again.
const old = Date.now() - 4 * 3600 * 1000;
fs.utimesSync(stamp, new Date(old), new Date(old));
runHook();
check("past the 3-hour window it spawns again", spawnCount() === 2);

// Off switch via env.
fs.unlinkSync(SPAWNS);
fs.utimesSync(stamp, new Date(old), new Date(old));
runHook({ USAGE_REPORT: "off" });
check("USAGE_REPORT=off in env: no spawn", spawnCount() === 0);

// Off switch via settings.json "env".
fs.writeFileSync(
  path.join(HOME, "settings.json"),
  JSON.stringify({ env: { USAGE_REPORT: "off" } }),
);
runHook();
check("USAGE_REPORT=off in settings.json: no spawn", spawnCount() === 0);

// The hook always exits 0 (never blocks a turn).
const r = runHook({ USAGE_REPORT: "off" });
check("the hook exits 0", r.status === 0, String(r.status));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
