// node tests/test-pc-tidy-nudge.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOOK = path.join(import.meta.dirname, "..", "hooks", "pc-tidy-nudge.mjs");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pc-tidy-nudge-"));
const FILE = path.join(DIR, "pc-tidy-nudge.json");
const HOUR = 60 * 60 * 1000;
let failed = 0, passed = 0;

function run(open, { prompt = "hello", env = {} } = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt }),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_CODE_ENTRYPOINT: "sdk-ts", PC_TIDY_NUDGE_DIR: DIR, PC_TIDY_NUDGE_TEST_OPEN: String(open), PC_TIDY_NUDGE: "", ...env },
  });
  return r.stdout;
}
function check(name, ok) {
  ok ? passed++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
}
const reset = (state) => { fs.rmSync(FILE, { force: true }); if (state) fs.writeFileSync(FILE, JSON.stringify(state)); };
const ago = (h) => Date.now() - h * HOUR;

reset(); check("under 12 hours stays silent", run(11) === "");
reset(); const out = run(13.6);
check("at 13 hours it reminds", /open 13 hours/.test(JSON.parse(out || "{}").systemMessage ?? ""));
check("it tells Claude what to say", /\/pc-tidy/.test(JSON.parse(out || "{}").hookSpecificOutput?.additionalContext ?? ""));
check("again within the hour stays silent", run(14) === "");
reset({ checkedAt: ago(2), nudgedAt: ago(2) }); check("a reminder 2 hours ago stays silent", run(15) === "");
reset({ checkedAt: ago(2), nudgedAt: ago(13) }); check("a reminder 13 hours ago repeats", run(25) !== "");
reset({ checkedAt: ago(2), nudgedAt: ago(13) }); check("a restarted Nimbalyst stays silent", run(1) === "");
reset(); check("the hours can be changed", run(5, { env: { PC_TIDY_NUDGE_HOURS: "4" } }) !== "");
reset(); check("off switch", run(30, { env: { PC_TIDY_NUDGE: "off" } }) === "");
reset(); check("a /command stays silent", run(30, { prompt: "/pc-tidy" }) === "");
reset(); check("outside Nimbalyst stays silent", run(30, { env: { CLAUDE_CODE_ENTRYPOINT: "cli" } }) === "");
reset(); check("a failed process check says nothing", run("notanumber") === "");
fs.writeFileSync(FILE, "{broken"); check("a broken state file still works", run(13) !== "");

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
