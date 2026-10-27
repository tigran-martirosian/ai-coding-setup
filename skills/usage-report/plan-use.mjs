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

// g tells apart two windows with the same reset time (cleanSamples sets it after an early reset)
export const sameWindow = (a, b) => a?.r && b?.r && Math.abs(Date.parse(a.r) - Date.parse(b.r)) < SAME && (a.g ?? 0) === (b.g ?? 0);
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
// Except an early reset (a plan change sets the week back to 0 and keeps the reset time): a lower
// number, with every later reading of the window under the old top up to one RESET_HOLD on, starts
// a new window there. After that, a reading back at the old top counts only when it holds as well.
const RESET_HOLD = 15 * 60000;
export function cleanSamples(samples) {
  const S = samples.map((s) => ({ ...s, ms: Date.parse(s.t) })).sort((a, b) => a.ms - b.ms);
  const top = { five: { r: 0, u: 0, g: 0 }, week: { r: 0, u: 0, g: 0 } };
  let era = 0; // counts early weekly resets: after a plan change the scale has to be fitted again
  const near = (x, k, r) => Math.abs(Date.parse(x[k]?.r ?? "") - r) < SAME;
  // every later reading of this window up to the first one RESET_HOLD on passes ok(u)
  const held = (i, k, r, ok) => {
    for (let j = i + 1; j < S.length && S[j].ms <= r + SAME; j++) {
      if (!near(S[j], k, r)) continue;
      if (!ok(S[j][k].u)) return false;
      if (S[j].ms - S[i].ms >= RESET_HOLD) return true;
    }
    return false; // not decided yet: the log ends (or the window does) first
  };
  return S.map((s, i) => {
    for (const k of ["five", "week"]) {
      const r = Date.parse(s[k]?.r ?? "");
      if (isNaN(r)) continue;
      const t = top[k], u = s[k].u;
      if (r < t.r - SAME) s[k] = null; // from a window that is already over
      else if (r > t.r + SAME) top[k] = { r, u, g: 0 };
      else if (u < t.u && held(i, k, r, (v) => v < t.u)) {
        top[k] = { r, u, g: t.g + 1, old: Math.max(t.u, t.old ?? 0) };
        if (k === "week") era++;
      } else if (t.old != null && u >= t.old && u > t.u && !held(i, k, r, (v) => v >= u)) {
        // a stale reading from before the early reset
      } else t.u = Math.max(t.u, u);
      if (s[k]) s[k] = { ...s[k], u: top[k].u, g: top[k].g };
    }
    s.era = era;
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

  // Each plan gets its own scale (an early weekly reset starts a new one); the result shows the latest
  const fits = new Map();
  for (const x of stretches) (fits.get(x.b.era) ?? fits.set(x.b.era, []).get(x.b.era)).push(x);
  // eras: each plan's scale and the time after which it applies (plan-ahead reads it per minute)
  res.eras = [...fits].map(([, part]) => ({ after: part[0].a.ms, perUnit: null }));
  for (const [era, part] of fits) fits.set(era, fitScale(part));
  [...fits.values()].forEach((f, n) => { res.eras[n].perUnit = f.perUnit; });
  const now = fits.get(last.era) ?? fitScale([]);
  res.weekSeen = now.sumW;
  res.windows = now.windows;
  if (now.perUnit) {
    res.status = "ok";
    res.perUnit = now.perUnit;
    res.margin = now.margin;
    const mineNow = stretches.filter((x) => x.b.era === last.era);
    const units = mineNow.reduce((n, x) => n + x.units, 0);
    if (units) res.tokensPerPoint = Math.round(mineNow.reduce((n, x) => n + x.tokens, 0) / (now.perUnit * units));
  }

  const day = (k) => (res.days[k] ??= { total: 0, mine: 0, other: 0, idle: 0 });
  for (const x of stretches) {
    const perUnit = fits.get(x.b.era).perUnit;
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

// The scale for one plan's stretches: weekly points per unit of this computer's plan weight
function fitScale(stretches) {
  // c: weekly points per 5-hour point
  const both = stretches.filter((x) => x.both);
  const sumW = both.reduce((n, x) => n + x.dW, 0), sumF = both.reduce((n, x) => n + x.dF, 0);
  const c = sumW >= NEED_WEEK && sumF > 0 ? sumW / sumF : null;

  // k5: 5-hour points per unit, from the windows where this computer's share was highest
  const windows = new Map();
  for (const x of stretches) {
    if (!x.wholeF || !x.units || !x.b.five?.r) continue;
    const key = `${Math.round(Date.parse(x.b.five.r) / 600000)}:${x.b.five.g ?? 0}`;
    const w = windows.get(key) ?? { F: 0, U: 0 };
    w.F += x.dF; w.U += x.units;
    windows.set(key, w);
  }
  const fit = [...windows.values()].filter((w) => w.F >= NEED_FIVE).sort((p, q) => p.F / p.U - q.F / q.U);
  const pick = fit.length ? fit[Math.floor((Math.ceil(fit.length / 4) - 1) / 2)] : null;
  const k5 = pick ? pick.F / pick.U : null;
  const perUnit = c && k5 ? c * k5 : null;
  // rounding of the two fits (the percentages come as whole numbers), and never under 10%
  const margin = perUnit ? Math.hypot(Math.max(0.1, 1 / pick.F), 1 / sumW) : null;
  return { sumW, windows: fit.length, perUnit, margin };
}
