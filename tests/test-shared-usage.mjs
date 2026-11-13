// Tests for skills/usage-report/shared-usage.mjs: the reading of `ccpool status`.
// Run: node tests/test-shared-usage.mjs
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL = fileURLToPath(new URL("../skills/usage-report", import.meta.url));
const { parseStatus } = await import(pathToFileURL(path.join(SKILL, "shared-usage.mjs")).href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};

const sample = [
  " ▐▛███▜▌   ccpool · status  ·  you are alex",
  "▝▜█████▛▘  account someone@example.com  ·  2 members (1 active)",
  "  ▘▘ ▝▝    synced 61s ago",
  "",
  "overall",
  "  5h      ████████░░░░   81%  · resets 13m",
  "  weekly  ███░░░░░░░░░   30%  · resets 4d 6h",
  "",
  "members",
  "   # member    usage                                   5h   wk  state",
  "   1 alex ◂  █░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░   4%    —  active",
  "   2 unknown   ████████████████████████████░░░░░░░░░  77%  30%  idle",
  "",
  "  github.com/hexxt-git/ccpool  ·  ccpool.hexxt.dev",
].join("\n");

check("sample: two members", parseStatus(sample), {
  setUp: true,
  members: [
    { name: "alex", me: true, five: 4, week: null, active: true },
    { name: "unknown", me: false, five: 77, week: 30, active: false },
  ],
});
check("no members block: not set up", parseStatus("ccpool is installed. Run ccpool init to set up.\n"), { setUp: false });
let msg = "";
try {
  parseStatus("members\n   # member usage 5h wk state\n   garbage here\n");
} catch (e) {
  msg = e.message;
}
check("members header with garbage rows throws", msg, "ccpool status: output not understood");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
