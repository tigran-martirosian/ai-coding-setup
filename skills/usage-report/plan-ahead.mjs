#!/usr/bin/env node
// plan-ahead: what to expect from the Claude plan. Built from the samples saved by
// ~/.claude/hooks/plan-usage-logger.mjs (the account-wide 5-hour and weekly percentages); every
// number is a straight line drawn from what was recorded. Nothing is asked from Anthropic.
//
//   week    where the weekly percentage ends at this week's average pace and at the pace of the last
//           24 hours on record, and how many points a day last until the reset (1 point = 1% of the week)
//   five    whether the open 5-hour window fills up before it resets
//   days    the days left in this week: the percentage at the end of each, at this pace and on budget
//   hours   recorded use per local hour of the day, with this computer's part
//   otherUse  when other use of the account is usually on (from the config), and the clear stretches
//   tips    the same in short lines
//
// Config, optional: ~/.claude/usage-log/plan-hours.json. Hours and weekdays are on the clock of the zone given:
//   { "otherUse": [{ "name": "Evening use", "zone": "Europe/London", "from": 9, "to": 17, "days": ["Mon", "Tue", "Wed", "Thu", "Fri"] }] }
// "showSplit": false in the same file says the account has no other use: the dashboard then leaves out
// the split into this computer and other use.
//
// Run it directly for a text version:
//   node plan-ahead.mjs [--days N] [--plan FILE] [--config FILE] [--root DIR] [--now ISO] [--json]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cleanSamples, planUse, readSamples, rise, sameWindow } from "./plan-use.mjs";

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, FIVE = 5 * HOUR, WEEK = 7 * DAY;
const STEP = 30 * MIN; // the hours of other use are worked out in half hours
const AHEAD = 7 * DAY; // how far the schedule looks
const round = (n, d = 1) => Math.round(n * 10 ** d) / 10 ** d;
const iso = (t) => new Date(t).toISOString();
const nextMidnight = (t) => {
  const d = new Date(t);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime();
};

const clocks = new Map();
const clock = (zone) => {
  if (!clocks.has(zone)) clocks.set(zone, new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short", hour: "numeric", minute: "numeric", hourCycle: "h23" }));
  return clocks.get(zone);
};

export function readConfig(file) {
  let list = [], showSplit = true;
  try {
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    list = json.otherUse ?? [];
    showSplit = json.showSplit !== false;
  } catch {}
  return {
    showSplit,
    otherUse: (Array.isArray(list) ? list : []).filter((o) => {
      if (typeof o?.from !== "number" || typeof o?.to !== "number") return false;
      try { clock(o.zone); return true; } catch { return false; } // an unknown time zone
    }),
  };
}

// Is this other use usually on at time t? Read on the zone's clock; `to` before `from` means past midnight
function isOn(o, t) {
  const p = Object.fromEntries(clock(o.zone).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  const h = Number(p.hour) + Number(p.minute) / 60;
  return (!o.days || o.days.includes(p.weekday)) && (o.from <= o.to ? h >= o.from && h < o.to : h >= o.from || h < o.to);
}

// A straight line from a reading: where it stands at the reset, and when it reaches 100
function line(used, perHour, from, reset) {
  const end = used + perHour * (reset - from) / HOUR;
  return {
    perHour: round(perHour, 4), perDay: round(perHour * 24), atReset: round(end),
    full: perHour > 0 && end >= 100 ? iso(from + (100 - used) / perHour * HOUR) : null,
  };
}

const when = (t) => new Date(t).toLocaleString(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" });
const span = (ms) => {
  const m = Math.round(ms / MIN);
  return m >= 2880 ? `${Math.floor(m / 1440)} d ${Math.round(m % 1440 / 60)} h` : m >= 120 ? `${Math.round(m / 60)} h` : m >= 60 ? `1 h ${m - 60} min` : `${m} min`;
};

// `plan` is planUse's result for the same samples (its scale gives this computer's part)
export function planAhead(samples, cost, plan, config, now = Date.now()) {
  const S = cleanSamples(samples);
  const last = S.at(-1);
  const minute = (r) => Math.round(Date.parse(r ?? "") / MIN) * MIN; // the reported reset time jitters by under a second
  let reset = minute(last?.week.r), used = last?.week.u;
  if (!last || isNaN(reset)) return { status: "none" };
  const res = { status: "ok", at: last.t, now: iso(now), tips: [] };

  // ---- the week
  const rolled = reset <= now; // the week has started over since the last reading
  if (rolled) { reset += Math.ceil((now - reset + 1) / WEEK) * WEEK; used = 0; }
  const start = reset - WEEK, left = Math.max(reset - now, HOUR);
  const week = res.week = {
    used, resets: iso(reset), rolled, daysLeft: round(left / DAY, 2),
    budget: round(Math.max(0, 100 - used) / (left / DAY)), average: null, recent: null, share: null,
  };
  if (!rolled) {
    if (last.ms - start > HOUR) week.average = line(used, used / ((last.ms - start) / HOUR), last.ms, reset);
    const back = S.find((s) => s.ms >= last.ms - DAY && sameWindow(s.week, last.week));
    if (back && last.ms - back.ms >= 6 * HOUR) {
      week.recent = { ...line(used, (used - back.week.u) / ((last.ms - back.ms) / HOUR), last.ms, reset), hours: Math.round((last.ms - back.ms) / HOUR) };
    }
  }
  // used since local midnight, in points of the week
  const dayStart = nextMidnight(now) - DAY;
  const inWeek = rolled ? [] : S.filter((s) => sameWindow(s.week, last.week));
  const before = inWeek.findLast((s) => s.ms <= dayStart);
  week.today = rolled ? 0 : round(Math.max(0, used - (before ? before.week.u : start >= dayStart ? 0 : inWeek[0].week.u)));
  const pace = week.average ?? week.recent;
  if (plan?.status === "ok") {
    const all = Object.values(plan.days);
    const total = all.reduce((n, d) => n + d.total, 0), mine = all.reduce((n, d) => n + d.mine, 0);
    if (total > 0) week.share = round(Math.min(1, Math.max(0, mine / total)), 2);
  }

  res.days = [];
  for (let end = Math.min(nextMidnight(now), reset); ; end = Math.min(nextMidnight(end), reset)) {
    res.days.push({
      end: iso(end),
      atPace: pace ? round(used + pace.perHour * (end - (rolled ? now : last.ms)) / HOUR) : null,
      onBudget: round(used + week.budget * (end - now) / DAY),
    });
    if (end >= reset) break;
  }

  // ---- the 5-hour window
  const five = res.five = { open: false };
  const r5 = minute(last.five?.r);
  if (r5 > now) {
    // pace: the last half hour of readings when they span 10 minutes, otherwise the whole window so far
    const a = S.find((s) => s.ms >= last.ms - 30 * MIN && sameWindow(s.five, last.five));
    const perHour = last.ms - a.ms >= 10 * MIN
      ? (last.five.u - a.five.u) / ((last.ms - a.ms) / HOUR)
      : last.five.u / (Math.max(last.ms - (r5 - FIVE), 10 * MIN) / HOUR);
    Object.assign(five, { open: true, used: last.five.u, resets: iso(r5), ...line(last.five.u, perHour, last.ms, r5) });
  }

  // ---- what was recorded: weekly points per 5-hour point, and use per local hour of the day
  let sumW = 0, sumF = 0;
  const hours = Array.from({ length: 24 }, () => ({ seen: 0, total: 0, mine: 0 }));
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], b = S[i];
    const [dW] = rise(a.week, b.week), [dF, wholeF] = rise(a.five, b.five);
    if (wholeF && sameWindow(a.week, b.week)) { sumW += dW; sumF += dF; }
    for (let t = a.ms; t < b.ms;) {
      const d = new Date(t);
      const end = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1).getTime(), b.ms);
      const h = hours[d.getHours()];
      h.seen += (end - t) / HOUR;
      h.total += dW * (end - t) / (b.ms - a.ms); // the log can't say when in the stretch it happened
      t = end;
    }
  }
  if (plan?.perUnit) {
    for (const [min, units] of cost) {
      if (min * MIN >= S[0].ms && min * MIN < last.ms) hours[new Date(min * MIN).getHours()].mine += plan.perUnit * units;
    }
  }
  // a full 5-hour window, in points of the week
  res.window = sumW >= 4 && sumF >= 20 ? { points: round(100 * sumW / sumF), left: round(Math.max(0, 100 - used) / (100 * sumW / sumF)) } : null;

  // ---- the usual hours of other use
  const otherUse = config?.otherUse ?? [];
  const busy = [], clear = [];
  const first = Math.floor(now / STEP) * STEP;
  for (let t = first; t < first + AHEAD; t += STEP) {
    const list = otherUse.some((o) => isOn(o, t)) ? busy : clear;
    const from = Math.max(t, now), prev = list.at(-1);
    if (prev && prev.to === t) prev.to = t + STEP; else list.push({ from, to: t + STEP });
  }
  const midnight = nextMidnight(now) - DAY;
  res.hours = hours.map((h, i) => {
    let on = 0;
    if (otherUse.length) {
      const d = new Date(midnight);
      for (let k = 0; k < 7; k++) for (const m of [0, 30]) {
        const t = new Date(d.getFullYear(), d.getMonth(), d.getDate() + k, i, m).getTime();
        if (otherUse.some((o) => isOn(o, t))) on++;
      }
    }
    const seen = h.seen >= 0.5;
    return {
      h: i, seen: round(h.seen), rate: seen ? round(h.total / h.seen, 2) : null,
      mine: seen && plan?.perUnit ? round(Math.min(h.mine, h.total) / h.seen, 2) : null, otherUse: round(on / 14, 2),
    };
  });
  res.otherUse = {
    list: otherUse.map((o) => ({ name: o.name ?? "", zone: o.zone ?? "", from: o.from, to: o.to, days: o.days ?? null })),
    onNow: busy[0]?.from <= now,
    busy: busy.slice(0, 7).map((x) => ({ from: iso(x.from), to: iso(x.to) })),
    clear: clear.slice(0, 7).map((x) => ({ from: iso(x.from), to: iso(x.to) })),
  };

  // ---- in short lines; `k` lets the page leave out what its table already shows
  const tip = (k, text) => res.tips.push({ k, text });
  if (rolled) tip("week", `Week: started over ${when(start)}, nothing used yet.`);
  else if (pace?.full) tip("week", `Week: runs out ${when(Date.parse(pace.full))} at this pace, ${span(reset - Date.parse(pace.full))} before the reset.`);
  else if (pace) tip("week", `Week: ends near ${Math.round(pace.atReset)}% at this pace.`);
  tip("budget", `Budget: ${week.budget}% a day to last${pace ? `; now averaging ${pace.perDay}%` : ""}.`);
  if (!five.open) tip("five", `5-hour window: none open.`);
  else if (five.full) tip("five", `5-hour window: fills up around ${when(Date.parse(five.full))}, ${span(r5 - Date.parse(five.full))} before its reset.`);
  else tip("five", `5-hour window: ${Math.round(five.used)}%, resets ${when(r5)}.`);
  return res;
}

// ---- text version
const here = path.dirname(fileURLToPath(import.meta.url));
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
if (process.argv[1] && same(process.argv[1], fileURLToPath(import.meta.url))) {
  const args = process.argv.slice(2);
  const opt = (name, def) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? def : args[i + 1];
  };
  const log = path.join(os.homedir(), ".claude", "usage-log");
  const scanArgs = [path.join(here, "usage-scan.mjs"), "--json", "--cost", "--days", String(opt("days", 30))];
  if (opt("root")) scanArgs.push("--root", opt("root"));
  const cost = JSON.parse(execFileSync(process.execPath, scanArgs, { encoding: "utf8", maxBuffer: 1 << 30 })).cost ?? [];
  const samples = readSamples(opt("plan", path.join(log, "plan-usage.jsonl")));
  const now = opt("now") ? Date.parse(opt("now")) : Date.now();
  const A = planAhead(samples, cost, planUse(samples, cost), readConfig(opt("config", path.join(log, "plan-hours.json"))), now);
  if (args.includes("--json")) console.log(JSON.stringify(A, null, 2));
  else if (A.status === "none") console.log("No plan percentages have been recorded yet. Recording starts with the next Claude Code session on this computer.");
  else {
    const age = now - Date.parse(A.at);
    const out = [`Plan ahead, from the reading of ${when(Date.parse(A.at))}${age > 20 * MIN ? ` (${span(age)} old)` : ""}`, ""];
    out.push(`Week: ${Math.round(A.week.used)}% used, resets ${when(Date.parse(A.week.resets))} (${A.week.daysLeft} days left)`, "");
    for (const t of A.tips) out.push(`- ${t.text}`);
    out.push("", "Days left this week (percent of the weekly limit at the end of each day):");
    for (const d of A.days) {
      const day = new Date(Date.parse(d.end) - 1).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
      out.push(`  ${day.padEnd(12)} at this pace ${d.atPace == null ? "?" : d.atPace >= 100 ? "out" : Math.round(d.atPace) + "%"}, on budget ${Math.round(d.onBudget)}%`);
    }
    console.log(out.join("\n"));
  }
}
