// node tests/test-pc-tidy-nudge.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = path.join(import.meta.dirname, "..", "hooks", "pc-tidy-nudge.mjs");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pc-tidy-nudge-"));
const STATE = path.join(DIR, ".claude", "hooks", "state", "pc-tidy-nudge");
const ARCHIVE = path.join(STATE, "disk-archive.json");
const NOTE = path.join(STATE, "disk-archive-note.txt");
const CONFIG = path.join(DIR, ".claude", "disk-tidy.json");
const WORKER = path.join(DIR, ".claude", "workers", "disk-tidy.mjs");
fs.mkdirSync(STATE, { recursive: true });
fs.mkdirSync(path.dirname(WORKER), { recursive: true });
fs.writeFileSync(WORKER, "process.exit(0);\n"); // the detached archive run ends at once
const HOUR = 60 * 60 * 1000;
let failed = 0,
  passed = 0;

// PC_TIDY_NUDGE_TEST_OPEN and PC_TIDY_NUDGE_HOURS were the old reminder's test and setting: set here, they must change nothing
function run({ prompt = "hello", env = {} } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
    env: {
      ...process.env,
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
      HOME: DIR,
      USERPROFILE: DIR,
      PC_TIDY_NUDGE: "",
      ...env,
    },
  });
  return r.stdout;
}
function check(name, ok) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
const reset = ({ config, archive, note } = {}) => {
  for (const f of [CONFIG, ARCHIVE, NOTE]) fs.rmSync(f, { force: true });
  if (config) fs.writeFileSync(CONFIG, JSON.stringify(config));
  if (archive) fs.writeFileSync(ARCHIVE, JSON.stringify(archive));
  if (note) fs.writeFileSync(NOTE, note);
};
const archiveState = () =>
  fs.existsSync(ARCHIVE) ? JSON.parse(fs.readFileSync(ARCHIVE, "utf8")) : {};
const ON = { archive: { afterDays: 30 } };
// The run a test started writes ranAt when it ends; wait for that, so it can't land in the next test's state
function started() {
  const begun = archiveState().startedAt > 0;
  for (
    let end = Date.now() + 10000;
    begun && !archiveState().ranAt && Date.now() < end;
  )
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
  return begun;
}

// the 12-hour restart reminder is gone
reset();
check(
  "no reminder after 12 hours open",
  run({ env: { PC_TIDY_NUDGE_TEST_OPEN: "13" } }) === "",
);
reset();
check(
  "no reminder after 30 hours open with the old hours setting",
  run({ env: { PC_TIDY_NUDGE_TEST_OPEN: "30", PC_TIDY_NUDGE_HOURS: "4" } }) ===
    "",
);
check(
  "no reminder state file is written",
  !fs.existsSync(path.join(STATE, "nudge.json")),
);

// the 3-day archive run stays
reset();
run();
check("archive not turned on: no run", !archiveState().startedAt);
reset({ config: ON });
run();
check("archive turned on: a run starts", started());
reset({ config: ON, archive: { ranAt: Date.now() - 24 * HOUR } });
run();
check("a run a day ago: no new run", !archiveState().startedAt);
reset({ config: ON, archive: { ranAt: Date.now() - 4 * 24 * HOUR } });
run();
check("a run 4 days ago: a new run starts", started());
reset({ config: { archive: { afterDays: 30, off: true } } });
run();
check("archive turned off: no run", !archiveState().startedAt);
reset({ note: "disk: archived 3 chats" });
check(
  "the last run's line shows once",
  JSON.parse(run() || "{}").systemMessage === "disk: archived 3 chats",
);
check("and not again", run() === "");

// switches
reset({ config: ON, note: "disk: archived 3 chats" });
check(
  "a /command stays silent",
  run({ prompt: "/pc-tidy" }) === "" && !archiveState().startedAt,
);
check(
  "off switch",
  run({ env: { PC_TIDY_NUDGE: "off" } }) === "" && !archiveState().startedAt,
);

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
