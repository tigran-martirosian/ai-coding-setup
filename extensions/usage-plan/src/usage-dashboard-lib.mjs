// usage-dashboard-lib: the number logic of the usage dashboard (no DOM, no page state).
// Used three ways: the build (usage-dashboard.mjs) inlines this file into the page, with each
// leading "export " removed, so the page stays one standalone file; the Usage Plan panel and the
// tests import it as a normal ES module. Keep it plain: top-level `export const|function` only,
// one declaration per line start, no imports.

export const esc = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export const fmt = (n) =>
  n >= 1e9
    ? (n / 1e9).toFixed(2) + "B"
    : n >= 1e6
      ? (n / 1e6).toFixed(n >= 1e7 ? 1 : 2) + "M"
      : n >= 1e3
        ? Math.round(n / 1e3) + "k"
        : String(Math.round(n));
export const pct = (a, b) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
export const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
export const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0);
// pad and dayKey repeat lib/days.mjs on purpose: the build inlines this file into the page, so it can import nothing.
export const pad = (n) => String(n).padStart(2, "0");
export const dayKey = (d) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const fmtDay = (k) =>
  new Date(k + "T12:00:00").toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
export const fmtTime = (iso) =>
  iso
    ? new Date(iso).toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      })
    : "";
export const fmtWhen = (iso) =>
  new Date(iso).toLocaleString(undefined, {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
export const modelName = (m) =>
  m.replace(/^claude-/, "").replace(/-\d{8}$/, "");
export const topModel = (models) => {
  const e = Object.entries(models || {}).sort((a, b) => b[1] - a[1])[0];
  return e ? modelName(e[0]) : "";
};
export const leaf = (p) =>
  String(p || "")
    .replace(/[\\/]+$/, "")
    .split(/[\\/]/)
    .pop();
export const fmtUsd = (n) =>
  "$" +
  n.toLocaleString(
    "en-US",
    n >= 100
      ? { maximumFractionDigits: 0 }
      : { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
export const pts = (n) =>
  n >= 10 ? String(Math.round(n)) : n.toFixed(1).replace(/\.0$/, "");

// Tokens per day for every chat and every subagent: { "YYYY-MM-DD": {model: n} } -> { "YYYY-MM-DD": total }
export const flat = (days) => {
  const o = {};
  for (const [d, m] of Object.entries(days || {}))
    o[d] = Object.values(m).reduce((a, b) => a + b, 0);
  return o;
};

// Adds dayTot / day fields to the data in place and returns every day key from the first used day to today.
export function prepareData(D, now = new Date()) {
  const today = dayKey(now);
  let minDay = today;
  for (const s of D.sessions) {
    s.dayTot = flat(s.days);
    for (const a of s.subagents) a.dayTot = flat(a.days);
    for (const w of s.workers) w.day = dayKey(new Date(w.at));
    for (const u of [s, ...s.subagents])
      for (const d in u.dayTot) if (d < minDay) minDay = d;
  }
  for (const x of [...D.codex.sessions, ...D.gemini.conversations])
    x.day = dayKey(new Date(x.at));
  const allDays = [];
  for (
    let d = new Date(minDay + "T12:00:00");
    dayKey(d) <= today;
    d.setDate(d.getDate() + 1)
  )
    allDays.push(dayKey(d));
  return allDays;
}

// Plan weeks (P.weeks, newest first, times in ms): { end, start, first, last, samples, total, mine, other, idle, partial, era }
export const weekKey = (w) => "w" + w.start;
const monthDay = (ms) =>
  new Date(ms).toLocaleDateString("en-US", { month: "short", day: "numeric" });
// "Oct 22 – 29" inside one month, "Oct 29 – Nov 5" across two
export const weekSpan = (w) => {
  const e = w.stop ?? w.end,
    a = new Date(w.start),
    b = new Date(e);
  return a.getMonth() === b.getMonth()
    ? `${monthDay(w.start)} – ${b.getDate()}`
    : `${monthDay(w.start)} – ${monthDay(e)}`;
};
const weekExact = (w) =>
  `${new Date(w.start).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} to ${new Date(w.stop ?? w.end).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`;
// The week buttons: up to 6, newest first. "This week" is the window that has not ended yet.
export function weekRanges(P, now = new Date()) {
  const ws = (P && P.weeks) || [];
  const t = now.getTime();
  // "Last week" is the window that ended at the newest reset before now (not one cut short by an early
  // reset inside this week, and not an old one when the logger was off for a while)
  const lastIdx = ws.findIndex((w) => w.end <= t); // newest first, so the first one that has ended
  return ws.slice(0, 6).map((w, i) => {
    const label =
      i === 0 && t < w.end
        ? "This week"
        : i === lastIdx && t - w.end < 7 * 864e5
          ? "Last week"
          : weekSpan(w);
    return { key: weekKey(w), label, title: weekExact(w), week: w };
  });
}
// The note under "Who used the plan" for one week
export function weekNote(w) {
  const d = (ms) => monthDay(ms);
  return `${weekSpan(w)}, ${Math.round(w.total)}% used${
    w.partial
      ? [
          w.first - w.start > 36e5 && `recorded from ${d(w.first)}`,
          Date.now() >= (w.stop ?? w.end) &&
            (w.stop ?? w.end) - w.last > 36e5 &&
            `recorded until ${d(w.last)}`,
        ]
          .filter(Boolean)
          .map((x) => ", " + x)
          .join("")
      : ""
  }`;
}
// The day keys whose local noon falls inside [start, stop) (stop = end unless an early reset cut the window)
export const weekDaysOf = (allDays, w) =>
  allDays.filter((d) => {
    const t = new Date(d + "T12:00:00").getTime();
    return t >= w.start && t < (w.stop ?? w.end);
  });
// The day keys a range button covers: a number of days, "all", or a week key (needs P)
export function rangeDaysOf(allDays, range, P) {
  if (range === "all") return allDays;
  if (typeof range === "string") {
    const w = ((P && P.weeks) || []).find((x) => weekKey(x) === range);
    if (!w) throw new Error("unknown range " + range);
    return weekDaysOf(allDays, w);
  }
  return allDays.slice(-range);
}

// Tokens of one chat or subagent inside `days` (a Set of day keys)
export const tok = (u, days) => {
  let n = 0;
  for (const d in u.dayTot) if (days.has(d)) n += u.dayTot[d];
  return n;
};
// What the same tokens would cost on the pay-as-you-go API (list prices, worked out in usage-scan)
export const usd = (u, days) => {
  let n = 0;
  for (const d in u.usd || {}) if (days.has(d)) n += u.usd[d];
  return n;
};

// Claude chats that match the filters (project, type = subagent type, q = lower-cased search text),
// optionally ignoring one filter ("project" or "type"), with their tokens inside `days`
export function chatRows(sessions, days, f, skip) {
  const out = [];
  for (const s of sessions) {
    if (skip !== "project" && f.project && s.project !== f.project) continue;
    if (f.q && !`${s.title} ${s.name} ${s.id}`.toLowerCase().includes(f.q))
      continue;
    const main = tok(s, days);
    const subs = s.subagents
      .map((a) => ({ a, t: tok(a, days) }))
      .filter((x) => x.t > 0);
    if (skip !== "type" && f.type && !subs.some((x) => x.a.type === f.type))
      continue;
    const sub = subs.reduce((n, x) => n + x.t, 0);
    if (main + sub <= 0) continue;
    out.push({
      s,
      main,
      sub,
      subs,
      total: main + sub,
      usd: usd(s, days) + sum(subs, (x) => usd(x.a, days)),
    });
  }
  return out;
}
// Codex: runs started from Claude chats (rs = chatRows output) plus sessions used directly (app, CLI, Nimbalyst)
export function codexRunsOf(rs, codexSessions, days, q) {
  const fromClaude = rs.flatMap((r) =>
    r.s.workers
      .filter((w) => w.worker === "codex" && days.has(w.day))
      .map((w) => ({
        at: w.at,
        what: w.what,
        from: r.s.title || r.s.id.slice(0, 8),
        tokens: w.tokens,
        seconds: w.seconds,
        ok: w.ok,
        n: w.processes,
        web: w.web,
        background: w.background,
      })),
  );
  const direct = codexSessions
    .filter(
      (c) =>
        days.has(c.day) &&
        (!q || `${c.title} ${c.cwd}`.toLowerCase().includes(q)),
    )
    .map((c) => ({
      at: c.at,
      what: c.title || leaf(c.cwd),
      from: c.origin || "Codex",
      tokens: c.tokens,
      seconds: null,
      ok: true,
      n: 1,
      direct: true,
    }));
  return [...fromClaude, ...direct].sort((a, b) => (a.at < b.at ? 1 : -1));
}
export function geminiRunsOf(conversations, days, q) {
  return conversations
    .filter(
      (c) =>
        days.has(c.day) &&
        (!q || `${c.title} ${c.folder}`.toLowerCase().includes(q)),
    )
    .sort((a, b) => (a.at < b.at ? 1 : -1));
}

// Claude plan use recorded for the whole account, split into this computer and other use.
// 1 point = 1% of the weekly limit. The split is an estimate (see plan-use.mjs).
export function planFor(P, days, week) {
  if (week) {
    const total = Math.max(0, week.total);
    const split = week.mine != null && week.other != null;
    const other = split ? Math.min(total, Math.max(0, week.other)) : 0;
    return {
      total,
      other,
      idle: Math.max(0, week.idle ?? 0),
      mine: total - other,
      any: true,
      split,
    };
  }
  const t = { total: 0, other: 0, idle: 0, any: false };
  for (const d in P.days ?? {}) {
    if (!days.has(d)) continue;
    t.any = true;
    for (const k of ["total", "other", "idle"]) t[k] += P.days[d][k];
  }
  // rounding in the recorded percentages can push a part slightly below zero or above the total
  t.total = Math.max(0, t.total);
  t.other = Math.min(t.total, Math.max(0, t.other));
  t.mine = t.total - t.other;
  return t;
}
// The scale of the plan a day fell in: weekly points per list-price dollar of this computer's use. plan-use.mjs fits
// one per plan (P.eras); a day takes the plan in force at its local noon, a day before the log the first plan's, as
// plan-use does. null: that plan has no scale yet.
export function dayScale(P, d) {
  if (!Array.isArray(P.eras))
    throw new Error("plan data has no per-plan scales: rerun the usage build");
  const t = new Date(d + "T12:00:00").getTime();
  return P.eras.findLast((e, n) => n === 0 || e.after <= t)?.perUnit ?? null;
}
// The day chart's bars (days = day keys, rs = chatRows output). Once the plan has a scale they are plan points
// (1 point = 1% of the weekly limit): this computer's main chats and subagents are their list-price dollars at the
// day's scale, and other use is the estimate from plan-use. Before that they are tokens, with no other use.
// The estimate covers the whole account, so it is left out while a project, subagent or search filter is on.
export function dayBars(rs, days, P, shared, filtered) {
  const points = P.status === "ok";
  const scale = new Map(points ? days.map((d) => [d, dayScale(P, d)]) : []);
  const per = new Map(
    days.map((d) => [
      d,
      {
        main: 0,
        sub: 0,
        other:
          points && shared && !filtered
            ? Math.max(0, P.days[d]?.other ?? 0)
            : 0,
      },
    ]),
  );
  const add = (u, k) => {
    if (points && !u.usd)
      throw new Error("usage data has no per-day cost: rerun the usage scan");
    const by = points ? u.usd : u.dayTot;
    for (const d in by)
      if (per.has(d))
        per.get(d)[k] += points ? by[d] * (scale.get(d) ?? 0) : by[d];
  };
  for (const r of rs) {
    add(r.s, "main");
    for (const a of r.s.subagents) add(a, "sub");
  }
  return { unit: points ? "points" : "tokens", per };
}
// One figure of the day chart: "3.4%" of the weekly limit, or "12.3M" tokens
export const dayFig = (unit, n) => (unit === "points" ? `${pts(n)}%` : fmt(n));

export function niceMax(v) {
  const p = 10 ** Math.floor(Math.log10(v));
  const f = v / p;
  return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
}
