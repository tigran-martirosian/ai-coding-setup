// Tests for hooks/plan-usage-logger.mjs, against a local stand-in for Anthropic's endpoint with a
// made-up login. Nothing here touches a real login or a real log.
// Run: node tests/test-plan-usage-logger.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import http from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const LOGGER = fileURLToPath(new URL("../hooks/plan-usage-logger.mjs", import.meta.url));

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-usage-test-"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// A temp home, so a real ~/.claude is never read or written
const run = (args, env) => new Promise((done) => spawn(process.execPath, args, { env: { ...process.env, HOME: tmp, USERPROFILE: tmp, ...env }, stdio: "ignore" }).on("exit", done));
const readSamples = (file) => fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

const seen = [];
const server = http.createServer((req, res) => {
  seen.push(req.headers.authorization);
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify({
    five_hour: { utilization: 41, resets_at: "2026-09-28T15:10:00.5+00:00" },
    seven_day: { utilization: 12, resets_at: "2026-10-08T02:00:00.5+00:00" },
    seven_day_opus: null, extra_usage: { utilization: 0 },
    credit: { utilization: 20.5, resets_at: "2026-11-05T07:59:00+00:00", used_dollars: 51.25, limit_dollars: 250 },
  }));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const creds = path.join(tmp, "creds.json");
fs.writeFileSync(creds, JSON.stringify({ claudeAiOauth: { accessToken: "made-up-token", expiresAt: Date.now() + 3600000 } }));
const dir = path.join(tmp, "log");
const env = { PLAN_USAGE_DIR: dir, PLAN_USAGE_CREDS: creds, PLAN_USAGE_URL: `http://127.0.0.1:${server.address().port}/` };
const logFile = path.join(dir, "plan-usage.jsonl");

await run([LOGGER], env); // as a hook: returns at once, the request runs detached
for (let i = 0; i < 50 && !fs.existsSync(logFile); i++) await sleep(100);
const lines = fs.existsSync(logFile) ? readSamples(logFile) : [];
check("hook run saves one sample", lines.length, 1);
check("sample holds the 5-hour and weekly percentages with their reset times", [lines[0]?.five, lines[0]?.week],
  [{ u: 41, r: "2026-09-28T15:10:00.5+00:00" }, { u: 12, r: "2026-10-08T02:00:00.5+00:00" }]);
check("other meters are kept, empty ones and extra_usage are not", lines[0]?.more, { credit: { u: 20.5, r: "2026-11-05T07:59:00+00:00", usd: 51.25, cap: 250 } });
check("the login goes out as a bearer token", seen, ["Bearer made-up-token"]);
check("the login is not written to the log folder", fs.readdirSync(dir).some((f) => fs.readFileSync(path.join(dir, f), "utf8").includes("made-up-token")), false);
await run([LOGGER], env);
await sleep(500);
check("a second run inside 5 minutes asks nothing", seen.length, 1);

const old = path.join(tmp, "old.json");
fs.writeFileSync(old, JSON.stringify({ claudeAiOauth: { accessToken: "made-up-token", expiresAt: Date.now() - 1000 } }));
const dir2 = path.join(tmp, "log2");
fs.mkdirSync(dir2);
await run([LOGGER, "--fetch"], { ...env, PLAN_USAGE_DIR: dir2, PLAN_USAGE_CREDS: old });
check("an expired login is not sent and nothing is saved", [seen.length, fs.existsSync(path.join(dir2, "plan-usage.jsonl"))], [1, false]);
check("the status file says why", /expired/.test(fs.readFileSync(path.join(dir2, "plan-usage.status.json"), "utf8")), true);

const dir3 = path.join(tmp, "log3");
fs.mkdirSync(dir3);
await run([LOGGER, "--fetch"], { ...env, PLAN_USAGE_DIR: dir3, PLAN_USAGE_CREDS: path.join(tmp, "missing.json") });
check("no login file: nothing is sent, the status file says so", [seen.length, /no Claude login/.test(fs.readFileSync(path.join(dir3, "plan-usage.status.json"), "utf8"))], [1, true]);
server.close();

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
