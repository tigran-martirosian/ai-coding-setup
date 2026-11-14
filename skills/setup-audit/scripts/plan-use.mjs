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
// Each plan (cut at an early weekly reset, or where a 5-hour limit is dropped or added) gets its own scale for step 2.
// With a 5-hour limit it is fitted in two parts, because the weekly number moves too slowly to fit directly:
//   k5 = 5-hour points per unit, taken from the 5-hour windows where this computer's share was
//        highest (in those, nobody else was using the account, or hardly);
//   c  = weekly points per 5-hour point, from all stretches (both numbers are account-wide,
//        so this needs no quiet period).
// Without one, from the weekly number alone (fitFromWeek).
import fs from "node:fs";
import { day as dayKey } from "./lib/days.mjs";

const SAME = 5 * 60000; // the reported reset time jitters by under a second between replies
export const NEED_WEEK = 4; // weekly points that must be on record before c is trusted
const NEED_FIVE = 5; // 5-hour points this computer must have used in a window for it to count

export function readSamples(file) {
  let text = "";
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {}
  return text
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter((s) => s?.week && !Number.isNaN(Date.parse(s.t)));
}

// g tells apart two windows with the same reset time (cleanSamples sets it after an early reset)
export const sameWindow = (a, b) =>
  a?.r &&
  b?.r &&
  Math.abs(Date.parse(a.r) - Date.parse(b.r)) < SAME &&
  (a.g ?? 0) === (b.g ?? 0);
// [points risen, whole]; whole is false when a reset in between hid part of the rise
export const rise = (a, b) => {
  if (!a || !b) return [0, false];
  if (sameWindow(a, b)) return [Math.max(0, b.u - a.u), true];
  if (!a.r && !a.u) return [b.u, true]; // no window was open yet
  return [b.u, false];
};

// Share `pts` over the local days between two times, by duration
const spread = (from, to, pts, add) => {
  if (!pts) {
    add(dayKey(from), 0);
    add(dayKey(to), 0);
    return;
  } // a quiet gap: only mark its two ends as recorded
  let t = from;
  while (t < to) {
    const d = new Date(t);
    const end = Math.min(
      new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1).getTime(),
      to,
    );
    add(dayKey(t), (pts * (end - t)) / (to - from));
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
  const S = samples
    .map((s) => ({ ...s, ms: Date.parse(s.t) }))
    .sort((a, b) => a.ms - b.ms);
  const top = { five: { r: 0, u: 0, g: 0 }, week: { r: 0, u: 0, g: 0 } };
  let era = 0; // counts plan changes (an early weekly reset, a 5-hour limit dropped or added): the scale is fitted again
  const near = (x, k, r) => Math.abs(Date.parse(x[k]?.r ?? "") - r) < SAME;
  // whether readings carry a 5-hour window; a change counts once it holds for every reading of the next RESET_HOLD
  let fives = null;
  const fiveHeld = (i, has) => {
    for (let j = i + 1; j < S.length; j++) {
      if (!S[j].week) continue;
      if (Boolean(S[j].five) !== has) return false;
      if (S[j].ms - S[i].ms >= RESET_HOLD) return true;
    }
    return false; // not decided yet: the log ends first
  };
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
    const hasFive = Boolean(s.five); // before a stale 5-hour reading is dropped below
    for (const k of ["five", "week"]) {
      const r = Date.parse(s[k]?.r ?? "");
      if (Number.isNaN(r)) continue;
      const t = top[k],
        u = s[k].u;
      if (r < t.r - SAME)
        s[k] = null; // from a window that is already over
      else if (r > t.r + SAME) top[k] = { r, u, g: 0 };
      else if (u < t.u && held(i, k, r, (v) => v < t.u)) {
        top[k] = { r, u, g: t.g + 1, old: Math.max(t.u, t.old ?? 0) };
        if (k === "week") era++;
      } else if (
        t.old != null &&
        u >= t.old &&
        u > t.u &&
        !held(i, k, r, (v) => v >= u)
      ) {
        // a stale reading from before the early reset
      } else t.u = Math.max(t.u, u);
      if (s[k]) s[k] = { ...s[k], u: top[k].u, g: top[k].g };
    }
    if (s.week) {
      const has = hasFive;
      if (fives === null) fives = has;
      else if (has !== fives && fiveHeld(i, has)) {
        fives = has;
        era++;
      }
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
    status: "calibrating",
    samples: S.length,
    first: S[0].t,
    last: last.t,
    latest: {
      five: last.five?.u ?? null,
      week: last.week.u,
      weekResets: last.week.r,
    },
    need: { week: NEED_WEEK, five: NEED_FIVE },
    weekSeen: 0,
    windows: 0,
    perUnit: null,
    margin: null,
    tokensPerPoint: null,
    days: {},
  };

  let ci = 0;
  const stretches = [];
  for (let i = 1; i < S.length; i++) {
    const a = S[i - 1],
      b = S[i];
    const [dW] = rise(a.week, b.week),
      [dF, wholeF] = rise(a.five, b.five);
    const mins = [];
    while (ci < cost.length && cost[ci][0] * 60000 + 30000 <= a.ms) ci++;
    for (; ci < cost.length && cost[ci][0] * 60000 + 30000 <= b.ms; ci++)
      mins.push(cost[ci]);
    stretches.push({
      a,
      b,
      dW,
      dF,
      both: wholeF && sameWindow(a.week, b.week),
      wholeF,
      mins,
      units: mins.reduce((n, m) => n + m[1], 0),
      tokens: mins.reduce((n, m) => n + m[2], 0),
    });
  }

  // Each plan gets its own scale (an early weekly reset starts a new one); the result shows the latest
  const fits = new Map();
  for (const x of stretches)
    (fits.get(x.b.era) ?? fits.set(x.b.era, []).get(x.b.era)).push(x);
  // eras: each plan's scale and the time after which it applies (plan-ahead reads it per minute)
  res.eras = [...fits].map(([, part]) => ({
    after: part[0].a.ms,
    perUnit: null,
  }));
  for (const [era, part] of fits) fits.set(era, fitScale(part));
  [...fits.values()].forEach((f, n) => {
    res.eras[n].perUnit = f.perUnit;
  });
  const now = fits.get(last.era) ?? fitScale([]);
  res.weekSeen = now.sumW;
  res.windows = now.windows;
  if (now.perUnit) {
    res.status = "ok";
    res.perUnit = now.perUnit;
    res.margin = now.margin;
    const mineNow = stretches.filter((x) => x.b.era === last.era);
    const units = mineNow.reduce((n, x) => n + x.units, 0);
    if (units)
      res.tokensPerPoint = Math.round(
        mineNow.reduce((n, x) => n + x.tokens, 0) / (now.perUnit * units),
      );
  }

  const day = (k) => (res.days[k] ??= { total: 0, mine: 0, other: 0, idle: 0 });
  for (const x of stretches) {
    const perUnit = fits.get(x.b.era).perUnit;
    const mine = perUnit ? perUnit * x.units : 0;
    if (perUnit)
      for (const [min, u] of x.mins) {
        const d = day(dayKey(min * 60000));
        d.mine += perUnit * u;
        d.total += perUnit * u;
      }
    // what is left is spread evenly: the log can't say when in the stretch it happened
    spread(x.a.ms, x.b.ms, x.dW - mine, (k, p) => {
      const d = day(k);
      d.total += p;
      if (perUnit) d.other += p;
      if (!x.units) d.idle += p; // this computer did nothing here, so this part is certain
    });
  }
  for (const d of Object.values(res.days))
    for (const k in d) d[k] = Math.round(d[k] * 1000) / 1000;

  // The plan's own weeks, newest first. One window per reset time and g; times are ms since 1970.
  // An early reset cuts the window it interrupts: that one runs from its start to the new one's first sample.
  const WEEK = 7 * 86400000,
    HOUR = 3600000;
  const wins = new Map();
  for (const s of S) {
    const g = s.week.g ?? 0,
      raw = Math.round(Date.parse(s.week.r) / 60000) * 60000;
    // the reported reset time jitters: one within 5 minutes of a known window's end is the same window
    const end =
      [...wins.values()].find(
        (w) => w.g === g && Math.abs(w.end - raw) <= 5 * 60000,
      )?.end ?? raw;
    const key = `${end}:${g}`;
    const w =
      wins.get(key) ??
      wins.set(key, { end, g, first: s.ms, era: s.era, samples: 0 }).get(key);
    w.last = s.ms;
    w.samples++;
    w.total = s.week.u;
    w.era = s.era;
  }
  const list = [...wins.values()];
  res.weeks = list
    .map((w, i) => {
      const next = list[i + 1];
      const start = w.g ? w.first : w.end - WEEK;
      const to = next && next.end === w.end ? next.first : w.end; // where this window really stops
      // each minute at the scale of the plan it fell in (a plan can change mid-week); no scale for a busy minute, no split
      let mine = fits.get(w.era)?.perUnit ? 0 : null,
        other = null;
      for (const [min, u] of mine === null ? [] : cost) {
        const t = min * 60000 + 30000;
        if (t < start || t >= to || !u) continue;
        const p = res.eras.findLast((e, n) => n === 0 || e.after <= t).perUnit;
        if (!p) {
          mine = null;
          break;
        }
        mine += p * u;
      }
      if (mine !== null) other = Math.min(w.total, Math.max(0, w.total - mine));
      const idle = stretches
        .filter(
          (x) =>
            !x.units &&
            x.b.ms >= w.first &&
            x.b.ms <= w.last &&
            x.b.week.g === w.g &&
            Math.abs(Date.parse(x.b.week.r) - w.end) <= 5 * 60000,
        )
        .reduce((n, x) => n + x.dW, 0);
      const partial =
        w.first - start > HOUR || (to <= last.ms && to - w.last > HOUR);
      return {
        end: w.end,
        start,
        stop: to,
        first: w.first,
        last: w.last,
        samples: w.samples,
        total: w.total,
        mine,
        other,
        idle,
        partial,
        era: w.era,
        g: w.g,
      };
    })
    .reverse();
  return res;
}

// The scale for one plan's stretches: weekly points per unit of this computer's plan weight
function fitScale(stretches) {
  // by what most of the plan's readings carry: one stale reading doesn't pick the method
  const withFive = stretches.filter((x) => x.b.five).length;
  return withFive * 2 > stretches.length
    ? fitFromFive(stretches)
    : fitFromWeek(stretches);
}

// A plan without a 5-hour limit: fitted on the weekly number alone. The log is cut into 3-hour blocks of clock time
// (long enough that a rise the plan reports minutes after the work stays in its block). Within each time of day
// (00-03, 03-06, ...) the blocks where this computer did more are compared with those where it did less: the extra
// weekly points per extra unit is the scale. Other use that keeps to its own hours (someone's working day) shifts a
// time of day's average, not that comparison, so it needs no quiet period and no guess about whose hours are whose.
export const NEED_WEEK_ALONE = 10; // weekly points on record in whole blocks before the scale is trusted
const NEED_BLOCKS = 20; // whole blocks on record
const BLOCK = 3 * 3600000;
const LONG = 6 * 3600000; // a longer stretch (the computer slept) says little about when the rise happened
function fitFromWeek(stretches) {
  const blocks = new Map(); // block start (ms) -> { w: points, u: units, seen: share of the block on record }
  // blocks follow local clock time (00-03, 03-06, ...), so each falls in one time of day in any zone
  const startOf = (t) => {
    const d = new Date(t);
    return d.setHours(Math.floor(d.getHours() / 3) * 3, 0, 0, 0);
  };
  const block = (t) => {
    const k = startOf(t);
    return blocks.get(k) ?? blocks.set(k, { w: 0, u: 0, seen: 0 }).get(k);
  };
  for (const x of stretches) {
    if (!sameWindow(x.a.week, x.b.week) || x.b.ms - x.a.ms > LONG) continue;
    for (const [min, u] of x.mins) block(min * 60000).u += u;
    for (let t = x.a.ms; t < x.b.ms; ) {
      let next = startOf(t) + BLOCK;
      if (next <= t) next = Math.floor(t / 3600000) * 3600000 + 3600000; // the 4-hour block of a clock change
      const end = Math.min(x.b.ms, next);
      const b = block(t);
      b.w += (x.dW * (end - t)) / (x.b.ms - x.a.ms);
      b.seen += (end - t) / BLOCK;
      t = end;
    }
  }
  // whole blocks only, grouped by time of day (local)
  const groups = new Map();
  for (const [k, b] of blocks) {
    if (b.seen < 0.9) continue;
    const g = Math.floor(new Date(k).getHours() / 3);
    (groups.get(g) ?? groups.set(g, []).get(g)).push(b);
  }
  let n = 0,
    sumW = 0,
    sumU = 0,
    num = 0,
    den = 0;
  for (const list of groups.values()) {
    const mu = list.reduce((s, b) => s + b.u, 0) / list.length,
      mw = list.reduce((s, b) => s + b.w, 0) / list.length;
    for (const b of list) {
      n++;
      sumW += b.w;
      sumU += b.u;
      num += (b.u - mu) * (b.w - mw);
      den += (b.u - mu) ** 2;
    }
  }
  // never more than all the rise in those blocks: this computer can't have used more than the whole account
  const perUnit =
    n >= NEED_BLOCKS && sumW >= NEED_WEEK_ALONE && den > 0 && num > 0
      ? Math.min(num / den, sumW / sumU)
      : null;
  let res2 = 0;
  if (perUnit)
    for (const list of groups.values()) {
      const mu = list.reduce((s, b) => s + b.u, 0) / list.length,
        mw = list.reduce((s, b) => s + b.w, 0) / list.length;
      for (const b of list) res2 += (b.w - mw - perUnit * (b.u - mu)) ** 2;
    }
  // the slope's standard error, as a share of it, and never under 10%
  const margin = perUnit
    ? Math.max(
        0.1,
        Math.sqrt(res2 / Math.max(1, n - groups.size - 1) / den) / perUnit,
      )
    : null;
  return { sumW, windows: 0, perUnit, margin };
}

function fitFromFive(stretches) {
  // c: weekly points per 5-hour point
  const both = stretches.filter((x) => x.both);
  const sumW = both.reduce((n, x) => n + x.dW, 0),
    sumF = both.reduce((n, x) => n + x.dF, 0);
  const c = sumW >= NEED_WEEK && sumF > 0 ? sumW / sumF : null;

  // k5: 5-hour points per unit, from the windows where this computer's share was highest
  const windows = new Map();
  for (const x of stretches) {
    if (!x.wholeF || !x.units || !x.b.five?.r) continue;
    const key = `${Math.round(Date.parse(x.b.five.r) / 600000)}:${x.b.five.g ?? 0}`;
    const w = windows.get(key) ?? { F: 0, U: 0 };
    w.F += x.dF;
    w.U += x.units;
    windows.set(key, w);
  }
  const fit = [...windows.values()]
    .filter((w) => w.F >= NEED_FIVE)
    .sort((p, q) => p.F / p.U - q.F / q.U);
  const pick = fit.length
    ? fit[Math.floor((Math.ceil(fit.length / 4) - 1) / 2)]
    : null;
  const k5 = pick ? pick.F / pick.U : null;
  const perUnit = c && k5 ? c * k5 : null;
  // rounding of the two fits (the percentages come as whole numbers), and never under 10%
  const margin = perUnit
    ? Math.hypot(Math.max(0.1, 1 / pick.F), 1 / sumW)
    : null;
  return { sumW, windows: fit.length, perUnit, margin };
}
