// Tests for the "other use" estimate: skills/setup-audit/scripts/plan-use.mjs, usage-scan --cost and the
// dashboard build, on made-up data in a temp folder. Nothing here touches a real login or log.
// Run: node tests/test-plan-use.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL = fileURLToPath(new URL("../skills/setup-audit/scripts", import.meta.url));
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
  asst(1, "m1", "claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e5 }), // list price: 4 + 20 x 0.1 = 6
  asst(1, "m2", "claude-haiku-4-5-20251001", { cache_read_input_tokens: 1e6 }), // 0.1 x 1 = 0.1
  asst(9, "m3", "claude-sonnet-5-5", { cache_creation_input_tokens: 1e6, cache_creation: { ephemeral_1h_input_tokens: 4e5 } }), // 2 x (1.25 x 0.6 + 2 x 0.4) = 3.1
]);
write("s2.jsonl", [asst(1, "m1", "claude-opus-5-5", { input_tokens: 1e6, output_tokens: 1e5 })]); // resumed chat: same message again
const scan = JSON.parse(execFileSync(process.execPath, [path.join(SKILL, "usage-scan.mjs"), "--json", "--cost", "--root", root, "--days", "100000"], { encoding: "utf8", env: { ...process.env, HOME: tmp, USERPROFILE: tmp } }));
const m0 = Math.floor(T0 / 60000);
check("--cost: plan weight and tokens per minute, a repeated message counted once", scan.cost, [[m0 + 1, 6.1, 2100000], [m0 + 9, 3.1, 1000000]]);
check("without --cost the list is left out", "cost" in JSON.parse(execFileSync(process.execPath, [path.join(SKILL, "usage-scan.mjs"), "--json", "--root", root, "--days", "100000"], { encoding: "utf8", env: { ...process.env, HOME: tmp, USERPROFILE: tmp } })), false);

// ---- plan-use
// Truth in this made-up day: 2 five-hour points per unit, 0.1 weekly points per five-hour point.
const A = "2026-09-28T15:10:00.2+00:00", A2 = "2026-09-28T15:10:00.9+00:00", B = "2026-09-28T20:10:00.4+00:00", W = "2026-10-08T02:00:00.1+00:00";
const s = (min, five, r, week) => ({ t: at(min), five: { u: five, r }, week: { u: week, r: W } });
const samples = [
  s(0, 0, A, 10),
  s(60, 20, A2, 12), // this computer alone: 10 units
  s(120, 50, A, 15), // this computer 5 units, someone else 20 five-hour points
  s(180, 60, A, 16), // this computer idle, someone else 10 five-hour points
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
// a plan change sets the week back to 0 and keeps the reset time
const early2 = planUse([s(0, 0, A, 97), s(10, 0, A, 98), s(20, 0, A, 0), s(25, 0, A, 0), s(30, 0, A, 1), s(40, 0, A, 4)], []);
check("an early reset with the same reset time starts a new week", [early2.latest.week, early2.days[day].total], [4, 5]);
// after the plan change a unit costs half as many weekly points: the new plan gets its own scale
const C = "2026-09-29T00:20:00+00:00";
const switched = planUse([...samples, s(500, 0, C, 0), s(560, 20, C, 2), s(620, 40, C, 4)], [...cost, [m0 + 530, 20, 2000], [m0 + 590, 20, 2000]]);
near("the latest plan's scale", switched.perUnit, 0.1);
check("each plan's days use its own scale", [switched.days[day], switched.tokensPerPoint], [{ total: 13, mine: 10, other: 3, idle: 1 }, 1000]);
const back = planUse([s(0, 0, A, 97), s(10, 0, A, 98), s(20, 0, A, 0), s(25, 0, A, 1), s(40, 0, A, 2), s(60, 0, A, 98), s(65, 0, A, 3), s(80, 0, A, 4)], []);
check("after an early reset, an old high reading that doesn't hold is stale", [back.latest.week, back.days[day].total], [4, 5]);
const tail = planUse([s(0, 0, A, 50), s(10, 0, A, 51), s(20, 0, A, 40), s(25, 0, A, 40)], []);
check("low readings at the end of the log are not a reset yet", [tail.latest.week, tail.days[day].total], [51, 1]);
const blip = planUse([s(0, 0, A, 97), s(10, 0, A, 98), s(20, 0, A, 0), s(25, 0, A, 98), s(40, 0, A, 99)], []);
check("one low reading that the next reading undoes is still stale", [blip.latest.week, blip.days[day].total], [99, 2]);

// ---- plan weeks
const wk = (w) => [w.g, w.total, w.mine == null ? null : Math.round(w.mine * 100) / 100, w.other == null ? null : Math.round(w.other * 100) / 100, w.idle, w.partial];
// the made-up day above lies before W's week starts, so these two move it into the week ending 1 Oct
const W1 = "2026-10-01T02:00:00.1+00:00";
const inWeek = (xs) => xs.map((x) => ({ ...x, week: { ...x.week, r: W1 } }));
const rw = planUse(inWeek(samples), cost), sw = planUse(inWeek([...samples, s(500, 0, C, 0), s(560, 20, C, 2), s(620, 40, C, 4)]), [...cost, [m0 + 530, 20, 2000], [m0 + 590, 20, 2000]]);
const WEND = Math.round(Date.parse(W1) / 60000) * 60000;
check("a full week: end, start, last reading, this computer's share by the fitted scale, the rest, idle part",
  [rw.weeks.length, rw.weeks[0].end, rw.weeks[0].start, rw.weeks[0].last, wk(rw.weeks[0]), rw.weeks[0].era], [1, WEND, WEND - 7 * 86400000, Date.parse(at(460)), [0, 19, 6, 13, 1, true], 0]); // true: the log starts days after the week began
check("an early reset splits a window in two (g 0 and 1, same end); no fitted scale gives null for mine and other",
  [early2.weeks.map(wk), early2.weeks.map((w) => w.end === Date.parse(W) - 100), early2.weeks[0].start, early2.weeks[1].end], [[[1, 4, null, null, 4, false], [0, 98, null, null, 1, false]], [true, true], early2.weeks[0].first, Math.round(Date.parse(W) / 60000) * 60000]);
check("each plan's window uses its own era's scale, and a cost minute counts only inside its window",
  [sw.weeks.map(wk), sw.weeks.map((w) => w.era)], [[[1, 4, 4, 0, 0, false], [0, 19, 6, 13, 1, true]], [1, 0]]);
// a reset time that jitters across a :30 s boundary (01:59:29 and 02:00:31) is still one window
const jit = planUse(inWeek(samples).map((x, i) => ({ ...x, week: { ...x.week, r: i % 2 ? "2026-10-01T01:59:29Z" : "2026-10-01T02:00:31Z" } })), cost);
check("a jittering reset time stays one window", [jit.weeks.length, jit.weeks[0].samples], [1, rw.weeks[0].samples]);
const R1 = "2026-10-01T02:00:00+00:00", R2 = "2026-10-08T02:00:00+00:00", R3 = "2026-10-15T02:00:00+00:00";
const ws = (t, u, r) => ({ t, week: { u, r } });
const edge = planUse([ws("2026-09-30T10:00:00Z", 30, R1), ws("2026-09-30T12:00:00Z", 35, R1), ws("2026-10-01T02:30:00Z", 2, R2), ws("2026-10-07T20:00:00Z", 60, R2), ws("2026-10-08T03:00:00Z", 1, R3)], []);
check("a first week that starts late or a past week that stops early is partial; the running one is not",
  [edge.weeks.map((w) => w.partial), edge.weeks.map((w) => w.total), edge.weeks[0].start], [[false, true, true], [1, 60, 35], Date.parse(R3) - 7 * 86400000]);
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
  "--codex", path.join(tmp, "codex"), "--gemini", path.join(tmp, "none"), "--days", "100000"], { encoding: "utf8", env: { ...process.env, HOME: tmp, USERPROFILE: tmp } });
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
