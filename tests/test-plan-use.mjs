// Tests for the "other use" estimate: skills/usage-report/plan-use.mjs, usage-scan --cost and the
// dashboard build, on made-up data in a temp folder. Nothing here touches a real login or log.
// Run: node tests/test-plan-use.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL = fileURLToPath(new URL("../skills/usage-report", import.meta.url));
const { planUse } = await import(pathToFileURL(path.join(SKILL, "plan-use.mjs")).href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};
const near = (name, got, want) => check(name, Math.round(got * 100) / 100, want);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-usage-test-"));

// ---- usage-scan --cost
const root = path.join(tmp, "projects");
const proj = path.join(root, "C--Projects-demo");
fs.mkdirSync(proj, { recursive: true });
const T0 = new Date(2026, 8, 28, 9, 0).getTime(); // local time, so the day checks hold in any time zone
const at = (min) => new Date(T0 + min * 60000).toISOString();
const asst = (min, id, model, usage) => ({ type: "assistant", timestamp: at(min), message: { id, model, usage, content: [] } });
const write = (file, rows) => fs.writeFileSync(path.join(proj, file), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
write("s1.jsonl", [
  asst(1, "m1", "claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e5 }), // 5 x (1 + 0.5) = 7.5
  asst(1, "m2", "claude-haiku-4-5-20251001", { cache_read_input_tokens: 1e6 }), // 1 x 0.1
  asst(9, "m3", "claude-sonnet-5-5", { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 4e5 } }), // 3 x (0.75 + 0.8)
]);
write("s2.jsonl", [asst(1, "m1", "claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e5 })]); // resumed chat: same message again
const scan = JSON.parse(execFileSync(process.execPath, [path.join(SKILL, "usage-scan.mjs"), "--json", "--cost", "--root", root, "--days", "100000"], { encoding: "utf8" }));
const m0 = Math.floor(T0 / 60000);
check("--cost: plan weight and tokens per minute, a repeated message counted once", scan.cost, [[m0 + 1, 7.6, 2100000], [m0 + 9, 4.65, 1000000]]);
check("without --cost the list is left out", "cost" in JSON.parse(execFileSync(process.execPath, [path.join(SKILL, "usage-scan.mjs"), "--json", "--root", root, "--days", "100000"], { encoding: "utf8" })), false);

// ---- plan-use
// Truth in this made-up day: 2 five-hour points per unit, 0.1 weekly points per five-hour point.
const A = "2026-09-28T15:10:00.2+00:00", A2 = "2026-09-28T15:10:00.9+00:00", B = "2026-09-28T20:10:00.4+00:00", W = "2026-10-08T02:00:00.1+00:00";
const s = (min, five, r, week) => ({ t: at(min), five: { u: five, r }, week: { u: week, r: W } });
const samples = [
  s(0, 0, A, 10),
  s(60, 20, A2, 12), // this computer alone: 10 units
  s(120, 50, A, 15), // this computer 5 units, other use 20 five-hour points
  s(180, 60, A, 16), // this computer idle, other use 10 five-hour points
  s(400, 0, B, 16), // next 5-hour window
  s(460, 30, B, 19), // this computer alone: 15 units
];
const cost = [[m0 + 30, 10, 1000], [m0 + 90, 5, 500], [m0 + 430, 15, 1500]];
const day = `2026-09-28`;
const r = planUse(samples, cost);
check("split is ready", [r.status, r.samples, r.windows, r.weekSeen], ["ok", 6, 2, 9]);
near("weekly points per unit, from the window where this computer was alone", r.perUnit, 0.2);
check("whole account, this computer, other use, certain part", r.days[day], { total: 9, mine: 6, other: 3, idle: 1 });
check("tokens per weekly point", r.tokensPerPoint, 500);
check("latest reading", r.latest, { five: 30, week: 19, weekResets: W });

const early = planUse(samples.slice(0, 2), cost);
check("too little on record: no split, the total is still shown", [early.status, early.days[day]], ["calibrating", { total: 2, mine: 0, other: 0, idle: 0 }]);
const night = planUse([s(14 * 60, 0, A, 10), s(16 * 60, 0, A, 12)], []); // 23:00 to 01:00
check("an idle stretch over midnight is shared between the two days", night.days, { "2026-09-28": { total: 1, mine: 0, other: 0, idle: 1 }, "2026-09-29": { total: 1, mine: 0, other: 0, idle: 1 } });
check("a weekly reset in between counts what the new week shows", planUse([s(0, 0, A, 90), { ...s(60, 0, A, 3), week: { u: 3, r: "2026-10-15T02:00:00+00:00" } }], []).days[day].total, 3);
check("no samples", planUse([], cost), { status: "none" });
const lastWeek = "2026-10-01T02:00:00+00:00";
const stale = planUse([s(0, 0, A, 10), s(10, 0, A, 14), s(20, 0, A, 11), { ...s(30, 0, A, 80), week: { u: 80, r: lastWeek } }, s(40, 0, A, 15)], []);
check("stale readings (a lower number, or one from a window that is over) add nothing", [stale.samples, stale.days[day].total], [4, 5]);

// ---- dashboard build
const out = path.join(tmp, "page.html");
fs.writeFileSync(path.join(tmp, "plan.jsonl"), samples.map((x) => JSON.stringify(x)).join("\n") + "\n");
// A Codex worker call in a Claude chat (its result shows no token count), the session Codex saved for it,
// and a session from the Codex app
write("s3.jsonl", [
  { type: "assistant", timestamp: at(20), message: { id: "m9", model: "claude-opus-5-5", usage: {}, content: [{ type: "tool_use", id: "b1", name: "Bash", input: { command: "codex exec --skip-git-repo-check 'q' < /dev/null > out.txt", description: "worker" } }] } },
  { type: "user", timestamp: at(21), message: { content: [{ type: "tool_result", tool_use_id: "b1", content: "" }] } },
]);
const cdir = path.join(tmp, "codex", "sessions", "2026", "09", "28");
fs.mkdirSync(cdir, { recursive: true });
const limits = (five, week) => ({ plan_type: "plus", primary: { used_percent: five, window_minutes: 300, resets_at: 1790762346 }, secondary: { used_percent: week, window_minutes: 10080, resets_at: 1791349146 } });
const count = (min, total, five, week) => ({ timestamp: at(min), type: "event_msg", payload: { type: "token_count", info: { total_token_usage: total }, rate_limits: limits(five, week) } });
const used = { input_tokens: 1000, cached_input_tokens: 600, output_tokens: 50, total_tokens: 1050 };
const rollout = (name, originator, rows) => fs.writeFileSync(path.join(cdir, `rollout-${name}.jsonl`),
  [{ timestamp: rows[0].timestamp, type: "session_meta", payload: { id: name, originator, cwd: "C:\\x" } }, ...rows].map((x) => JSON.stringify(x)).join("\n") + "\n");
rollout("worker", "codex_exec", [count(20.2, used, 10, 5), count(20.6, used, 11, 6)]); // the second record repeats the same totals
rollout("app", "Codex Desktop", [count(300, used, 20, 8)]);

execFileSync(process.execPath, [path.join(SKILL, "usage-dashboard.mjs"), "--no-open", "--out", out, "--root", root, "--plan", path.join(tmp, "plan.jsonl"),
  "--codex", path.join(tmp, "codex"), "--gemini", path.join(tmp, "none"), "--days", "100000"], { encoding: "utf8" });
const data = JSON.parse(fs.readFileSync(out, "utf8").match(/<script id="data" type="application\/json">(.*?)<\/script>/s)[1]);
check("the page gets the plan numbers", [data.plan.status, data.plan.samples, data.plan.days[day].total], ["ok", 6, 9]);
check("a saved worker run fills in the call's tokens (without cached input) and is not listed twice",
  [data.sessions.flatMap((x) => x.workers).map((w) => w.tokens), data.codex.sessions.map((x) => [x.id, x.tokens])], [[450], [["app", 1050]]]);
check("Codex records become samples: account-wide rise and the latest reading", [data.codex.plan.samples, data.codex.plan.days[day].total, data.codex.plan.latest.week], [3, 3, 8]);
check("this computer's Codex tokens are counted once per record", data.codex.plan.status, "calibrating");

fs.rmSync(tmp, { recursive: true, force: true });

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`
${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
