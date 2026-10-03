// Tests for the "Plan ahead" forecast: skills/usage-report/plan-ahead.mjs, its text
// version and the dashboard build. Made-up samples in a temp folder; the real log is not touched.
// Checks use fixed instants, so they hold in any time zone.
// Run: node tests/test-plan-ahead.mjs
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const SKILL = fileURLToPath(new URL("../skills/usage-report", import.meta.url));
const { planAhead, readConfig } = await import(pathToFileURL(path.join(SKILL, "plan-ahead.mjs")).href);

let pass = 0, fail = 0;
const check = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `: got ${JSON.stringify(got)}, wanted ${JSON.stringify(want)}`}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "plan-ahead-test-"));

// The week runs 1 Oct 02:00 to 8 Oct 02:00 (UTC). 3 Oct 2026 is a Saturday.
const WEEK = "2026-10-08T02:00:00.4+00:00";
const s = (t, week, five, r5) => ({ t, week: { u: week, r: WEEK }, five: five == null ? null : { u: five, r: r5 } });
const samples = [
  s("2026-10-02T02:00:00Z", 20, 10, "2026-10-02T04:00:00+00:00"),
  s("2026-10-02T03:00:00Z", 22, 35, "2026-10-02T04:00:00+00:00"),
  s("2026-10-03T01:30:00Z", 38, 30, "2026-10-03T04:00:00+00:00"),
  s("2026-10-03T02:00:00Z", 40, 40, "2026-10-03T04:00:00+00:00"),
];
const hours = { otherUse: [{ name: "Evening", zone: "Europe/Moscow", from: 10, to: 19, days: ["Mon", "Tue", "Wed", "Thu", "Fri"] }] };
const at = (iso) => Date.parse(iso);

check("no samples: nothing to forecast", planAhead([], [], { status: "none" }, hours, at("2026-10-03T02:00:00Z")), { status: "none" });

// ---- the week
let A = planAhead(samples, [], { status: "calibrating" }, hours, at("2026-10-03T02:00:00Z"));
check("week: used, reset time rounded to the minute, days left, points a day that last", [A.week.used, A.week.resets, A.week.daysLeft, A.week.budget],
  [40, "2026-10-08T02:00:00.000Z", 5, 12]);
check("week average pace: 40 points in 48 hours ends at 140 and runs out after 72 more hours", [A.week.average.perDay, A.week.average.atReset, A.week.average.full],
  [20, 140, "2026-10-06T02:00:00.000Z"]);
check("pace of the last 24 hours on record", [A.week.recent.perDay, A.week.recent.hours], [20, 24]);
check("days: the last one ends at the reset, on budget at 100", [A.days.at(-1).end, A.days.at(-1).onBudget, A.days.at(-1).atPace], ["2026-10-08T02:00:00.000Z", 100, 140]);
check("no split yet: no share of the budget for this computer", A.week.share, null);

// ---- the 5-hour window
check("5-hour window: 10 points in the last half hour ends at 80, not full", [A.five.open, A.five.used, A.five.resets, A.five.atReset, A.five.full],
  [true, 40, "2026-10-03T04:00:00.000Z", 80, null]);
const fast = [...samples.slice(0, 2), s("2026-10-03T01:30:00Z", 38, 50, "2026-10-03T04:00:00+00:00"), s("2026-10-03T02:00:00Z", 40, 70, "2026-10-03T04:00:00+00:00")];
check("5-hour window: 20 points in half an hour fills up 45 minutes later", planAhead(fast, [], null, hours, at("2026-10-03T02:00:00Z")).five.full, "2026-10-03T02:45:00.000Z");
check("5-hour window: closed once its reset time has passed", planAhead(samples, [], null, hours, at("2026-10-03T05:00:00Z")).five, { open: false });
check("a full 5-hour window in weekly points (4 weekly points for 35 window points)", A.window, { points: 11.4, left: 5.3 });

// ---- the hours of other use
check("Saturday: other use is off until Monday 10:00 Moscow time", [A.otherUse.onNow, A.otherUse.clear[0], A.otherUse.busy[0]],
  [false, { from: "2026-10-03T02:00:00.000Z", to: "2026-10-05T07:00:00.000Z" }, { from: "2026-10-05T07:00:00.000Z", to: "2026-10-05T16:00:00.000Z" }]);
const tip = (X, k) => X.tips.find((t) => t.k === k)?.text ?? null;
check("advice: the week, the budget and the 5-hour window, nothing about when to get on or off", A.tips.map((t) => t.k), ["week", "budget", "five"]);
check("advice is short: every line under 90 characters", A.tips.every((t) => t.text.length < 90), true);
const fri = planAhead(samples.slice(0, 2), [], null, hours, at("2026-10-02T08:00:00Z"));
check("Friday 11:00 Moscow time: other use is on until 19:00", [fri.otherUse.onNow, fri.otherUse.busy[0], fri.otherUse.clear[0].from],
  [true, { from: "2026-10-02T08:00:00.000Z", to: "2026-10-02T16:00:00.000Z" }, "2026-10-02T16:00:00.000Z"]);
const alone = planAhead(samples, [], null, { otherUse: [] }, at("2026-10-03T02:00:00Z"));
check("no other use set: no busy hours", alone.otherUse.busy, []);
check("hours of the day: 24 entries holding the whole recorded rise", [A.hours.length, Math.round(A.hours.reduce((n, h) => n + (h.rate ?? 0) * h.seen, 0))], [24, 20]);

// ---- after the weekly reset
const next = planAhead(samples, [], null, hours, at("2026-10-09T02:00:00Z"));
check("a week that started over: nothing used, next reset a week on, no pace", [next.week.rolled, next.week.used, next.week.resets, next.week.average, next.five.open],
  [true, 0, "2026-10-15T02:00:00.000Z", null, false]);

// ---- this computer's part
const split = planAhead(samples, [], { status: "ok", perUnit: 1, days: { "2026-10-02": { total: 16, mine: 12 }, "2026-10-03": { total: 4, mine: 3 } } }, hours, at("2026-10-03T02:00:00Z"));
check("split known: this computer's share of the recorded use", split.week.share, 0.75);

// ---- config
const cfg = path.join(tmp, "plan-hours.json");
fs.writeFileSync(cfg, JSON.stringify({ otherUse: [hours.otherUse[0], { name: "Bad zone", zone: "Mars/Olympus", from: 1, to: 2 }, { name: "No hours", zone: "Europe/Moscow" }] }));
check("config: entries with an unknown time zone or no hours are dropped", readConfig(cfg).otherUse.map((o) => o.name), ["Evening"]);
check("config: a missing file means no other use, and the split stays on", readConfig(path.join(tmp, "none.json")), { showSplit: true, otherUse: [] });
const solo = path.join(tmp, "solo.json");
fs.writeFileSync(solo, JSON.stringify({ showSplit: false }));
check("config: \"showSplit\": false is read", readConfig(solo), { showSplit: false, otherUse: [] });

// ---- text version and dashboard build
const log = path.join(tmp, "plan-usage.jsonl"), root = path.join(tmp, "projects");
fs.writeFileSync(log, samples.map((x) => JSON.stringify(x)).join("\n") + "\n");
fs.mkdirSync(root);
const common = ["--plan", log, "--root", root];
const text = execFileSync(process.execPath, [path.join(SKILL, "plan-ahead.mjs"), ...common, "--config", cfg, "--now", "2026-10-03T02:00:00Z"], { encoding: "utf8" });
check("text version: week line, 5-hour line, budget and the days table, no get on or off", [/Week: 40% used/.test(text), /5-hour window: 40%, resets/.test(text), /Budget: /.test(text), /Get o(n|ff)/.test(text), /on budget 100%/.test(text)],
  [true, true, true, false, true]);
const page = path.join(tmp, "page.html");
execFileSync(process.execPath, [path.join(SKILL, "usage-dashboard.mjs"), ...common, "--ahead", cfg, "--codex", path.join(tmp, "x"), "--gemini", path.join(tmp, "y"), "--out", page, "--no-open"], { encoding: "utf8" });
const html = fs.readFileSync(page, "utf8");
const built = JSON.parse(html.match(/<script id="data" type="application\/json">(.*?)<\/script>/s)[1]);
check("dashboard: the page carries the forecast and has the Plan ahead section", [built.ahead.status, built.ahead.otherUse.list[0].name, /<h2>Plan ahead<\/h2>/.test(html), /renderAhead\(\);/.test(html)],
  ["ok", "Evening", true, true]);
const data = (file) => JSON.parse(fs.readFileSync(file, "utf8").match(/<script id="data" type="application\/json">(.*?)<\/script>/s)[1]);
execFileSync(process.execPath, [path.join(SKILL, "usage-dashboard.mjs"), ...common, "--ahead", solo, "--codex", path.join(tmp, "x"), "--gemini", path.join(tmp, "y"), "--out", page, "--no-open"], { encoding: "utf8" });
check("dashboard: split on by default, off with \"showSplit\": false, and the page hides the section then", [built.showSplit, data(page).showSplit, /\$\("plan-s"\)\.hidden = !SHOW_SPLIT;/.test(html)],
  [true, false, true]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
