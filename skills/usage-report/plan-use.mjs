// plan-use: splits the account's recorded Claude plan usage into "this computer" and
// "other use" (other devices or apps on the same account). An estimate.
//
// Inputs: the samples saved by ~/.claude/hooks/plan-usage-logger.mjs (account-wide 5-hour
// and weekly percentages) and usage-scan's --cost list (this computer's plan weight per minute).
//
// Method, per stretch between two samples:
//   1. total  = how much the weekly percentage rose (whole account; 1 point = 1% of the weekly limit).
//   2. mine   = this computer's plan weight in that stretch x (weekly points per unit of weight).
//   3. other  = total - mine.
// The scale in step 2 is fitted in two parts, because the weekly number moves too slowly to fit directly:
//   k5 = 5-hour points per unit, taken from the 5-hour windows where this computer's share was
//        highest (in those, nobody else was using the account, or hardly);
//   c  = weekly points per 5-hour point, from all stretches (both numbers are account-wide,
//        so this needs no quiet period).
import fs from "node:fs";

const SAME = 5 * 60000; // the reported reset time jitters by under a second between replies
const NEED_WEEK = 4; // weekly points that must be on record before c is trusted
const NEED_FIVE = 5; // 5-hour points this computer must have used in a window for it to count

const dayKey = (t) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function readSamples(file) {
  let text = "";
  try { text = fs.readFileSync(file, "utf8"); } catch {}
  return text.split("\n").filter(Boolean).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter((s) => s?.week && !isNaN(Date.parse(s.t)));
}

export const sameWindow = (a, b) => a?.r && b?.r && Math.abs(Date.parse(a.r) - Date.parse(b.r)) < SAME;
// [points risen, whole]; whole is false when a reset in between hid part of the rise
export const rise = (a, b) => {
  if (!a || !b) return [0, false];
  if (sameWindow(a, b)) return [Math.max(0, b.u - a.u), true];
  if (!a.r && !a.u) return [b.u, true]; // no window was open yet
  return [b.u, false];
};

// Share `pts` over the local days between two times, by duration
const spread = (from, to, pts, add) => {
  if (!pts) { add(dayKey(from), 0); add(dayKey(to), 0); return; } // a quiet gap: only mark its two ends as recorded
  let t = from;
  while (t < to) {
    const d = new Date(t);
    const end = Math.min(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(), to);
    add(dayKey(t), pts * (end - t) / (to - from));
    t = end;
  }
};

// Readings can be stale or out of order (Codex repeats old ones in sessions left open). Inside a
// window the percentage only grows and windows only move forward, so anything else is dropped or lifted.
export function cleanSamples(samples) {
  const top = { five: { r: 0, u: 0 }, week: { r: 0, u: 0 } };
  return samples.map((s) => ({ ...s, ms: Date.parse(s.t) })).sort((a, b) => a.ms - b.ms).map((s) => {
    for (const k of ["five", "week"]) {
      const r = Date.parse(s[k]?.r ?? "");
      if (isNaN(r)) continue;
      if (r < top[k].r - SAME) s[k] = null; // from a window that is already over
      else if (r > top[k].r + SAME) top[k] = { r, u: s[k].u };
      else s[k] = { ...s[k], u: (top[k].u = Math.max(top[k].u, s[k].u)) };
    }
    return s;
  }).filter((s) => s.week);
}

export function planUse(samples, cost) {
  const S = cleanSamples(samples);
  if (!S.length) return { status: "none" };
  const last = S.at(-1);
  const res = {
    status: "calibrating", samples: S.length, first: S[0].t, last: last.t,
    latest: { five: last.five?.u ?? null, week: last.week.u, weekResets: last.week.r },
    need: { week: NEED_WEEK, five: NEED_FIVE }, weekSeen: 0, windows: 0,
    perUnit: null, margin: null, tokensPerPoint: null, days: {},
  };

  let ci = 0;
  const stretches = [];
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1], b = S[i];
    const [dW] = rise(a.week, b.week), [dF, wholeF] = rise(a.five, b.five);
    const mins = [];
    while (ci < cost.length && cost[ci][0] * 60000 + 30000 <= a.ms) ci++;
    for (; ci < cost.length && cost[ci][0] * 60000 + 30000 <= b.ms; ci++) mins.push(cost[ci]);
    stretches.push({
      a, b, dW, dF, both: wholeF && sameWindow(a.week, b.week), wholeF, mins,
      units: mins.reduce((n, m) => n + m[1], 0), tokens: mins.reduce((n, m) => n + m[2], 0),
    });
  }

  // c: weekly points per 5-hour point
  const both = stretches.filter((x) => x.both);
  const sumW = both.reduce((n, x) => n + x.dW, 0), sumF = both.reduce((n, x) => n + x.dF, 0);
  res.weekSeen = sumW;
  const c = sumW >= NEED_WEEK && sumF > 0 ? sumW / sumF : null;

  // k5: 5-hour points per unit, from the windows where this computer's share was highest
  const windows = new Map();
  for (const x of stretches) {
    if (!x.wholeF || !x.units || !x.b.five?.r) continue;
    const key = Math.round(Date.parse(x.b.five.r) / 600000);
    const w = windows.get(key) ?? { F: 0, U: 0 };
    w.F += x.dF; w.U += x.units;
    windows.set(key, w);
  }
  const fit = [...windows.values()].filter((w) => w.F >= NEED_FIVE).sort((p, q) => p.F / p.U - q.F / q.U);
  res.windows = fit.length;
  const pick = fit.length ? fit[Math.floor((Math.ceil(fit.length / 4) - 1) / 2)] : null;
  const k5 = pick ? pick.F / pick.U : null;

  const perUnit = c && k5 ? c * k5 : null;
  if (perUnit) {
    res.status = "ok";
    res.perUnit = perUnit;
    // rounding of the two fits (the percentages come as whole numbers), and never under 10%
    res.margin = Math.hypot(Math.max(0.1, 1 / pick.F), 1 / sumW);
    const units = stretches.reduce((n, x) => n + x.units, 0);
    if (units) res.tokensPerPoint = Math.round(stretches.reduce((n, x) => n + x.tokens, 0) / (perUnit * units));
  }

  const day = (k) => (res.days[k] ??= { total: 0, mine: 0, other: 0, idle: 0 });
  for (const x of stretches) {
    const mine = perUnit ? perUnit * x.units : 0;
    if (perUnit) for (const [min, u] of x.mins) {
      const d = day(dayKey(min * 60000));
      d.mine += perUnit * u; d.total += perUnit * u;
    }
    // what is left is spread evenly: the log can't say when in the stretch it happened
    spread(x.a.ms, x.b.ms, x.dW - mine, (k, p) => {
      const d = day(k);
      d.total += p;
      if (perUnit) d.other += p;
      if (!x.units) d.idle += p; // this computer did nothing here, so this part is certain
    });
  }
  for (const d of Object.values(res.days)) for (const k in d) d[k] = Math.round(d[k] * 1000) / 1000;
  return res;
}
