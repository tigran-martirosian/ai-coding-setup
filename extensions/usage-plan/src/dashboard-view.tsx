/**
 * What the Usage dashboard panel draws from the build's JSON: the same sections as the browser page
 * (skills/setup-audit/scripts/usage-dashboard.html), in the shared look. The number logic is the shared
 * usage-dashboard-lib; this file only filters, lays out and words it.
 */

import { Fragment, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { progressFraction } from "./dashboard-data";
import type { DashboardData, DashboardState } from "./dashboard-data";
import { DASHBOARD_CSS } from "./dashboard-styles";
import { clock } from "./format";
import { t } from "./strings";
import {
  chatRows,
  codexRunsOf,
  fmt,
  fmtDay,
  fmtTime,
  fmtUsd,
  fmtWhen,
  geminiRunsOf,
  leaf,
  modelName,
  niceMax,
  otherTokensFor,
  pad,
  pct,
  planFor,
  prepareData,
  pts,
  rangeDaysOf,
  sum,
  topModel,
  weekRanges,
} from "./usage-dashboard-lib.mjs";

/* eslint-disable @typescript-eslint/no-explicit-any -- the build's JSON is read loosely, as in the browser page */

// ---- small parts ----

function Icon({ d }: { d: string }) {
  return (
    <svg
      className="ud-ic"
      viewBox="0 0 12 12"
      width="12"
      height="12"
      aria-hidden="true"
    >
      <path
        d={d}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
const ICON = {
  open: "M4.5 2.5 8 6l-3.5 3.5",
  x: "M3 3l6 6M9 3l-6 6",
  ok: "M2.5 6.5 5 9l4.5-5.5",
  down: "M6 2.5v7M3 6.5l3 3 3-3",
  up: "M6 9.5v-7M3 5.5l3-3 3 3",
};

const Dot = ({ s, line }: { s: string; line?: boolean }) => (
  <i className={`ud-dot ${s}${line ? " line" : ""}`} />
);

function Section({
  title,
  note,
  children,
  className,
}: {
  title: ReactNode;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`ud-sec ${className ?? ""}`}>
      <div className="ud-head">
        <h2>{title}</h2>
        {note != null && note !== "" && <span className="ud-note">{note}</span>}
      </div>
      {children}
    </section>
  );
}

/** A folded section: opens on a click, like the browser page's Subagents / Codex / Gemini. */
function Fold({
  title,
  note,
  children,
}: {
  title: string;
  note: string;
  children: ReactNode;
}) {
  return (
    <details className="ud-sec ud-fold">
      <summary>
        <h2>
          <Icon d={ICON.open} />
          {title}
        </h2>
        <span className="ud-note">{note}</span>
      </summary>
      {children}
    </details>
  );
}

const Empty = ({ children }: { children: ReactNode }) => (
  <p className="ud-empty">{children}</p>
);

interface RankItem {
  key?: string | null;
  label: string;
  value: number;
  shown?: string;
  note?: string;
}

function Ranks({
  items,
  picked,
  onPick,
}: {
  items: RankItem[];
  picked?: string | null;
  onPick?: (key: string) => void;
}) {
  const max = Math.max(...items.map((x) => x.value));
  return (
    <div className={`ud-ranks${picked ? " picked" : ""}`}>
      {items.map((x, i) => {
        const inner = (
          <>
            <span className="lab" title={x.label}>
              {x.label}
            </span>
            <span>
              <i
                className="ud-bar s1"
                style={{ width: `${(x.value / max) * 100}%` }}
              />
            </span>
            <span className="val">{x.shown ?? fmt(x.value)}</span>
            <span className="note">{x.note ?? ""}</span>
          </>
        );
        return onPick && x.key != null ? (
          <button
            key={i}
            className={`ud-rank${picked === x.key ? " on" : ""}`}
            aria-pressed={picked === x.key}
            onClick={() => onPick(x.key as string)}
          >
            {inner}
          </button>
        ) : (
          <div key={i} className="ud-rank">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

function OkState({ ok }: { ok: boolean }) {
  return ok ? (
    <span className="ud-state">
      <Icon d={ICON.ok} />
      {t.ok}
    </span>
  ) : (
    <span className="ud-state bad">
      <Icon d={ICON.x} />
      {t.failed}
    </span>
  );
}

// ---- plan: who used it ----

/** The split for one account (Claude or Codex): this computer against other devices or other use of it. */
function PlanBlock({
  P,
  days,
  week,
}: {
  P: any;
  days: Set<string>;
  week?: any;
}) {
  const tt = planFor(P, days, week);
  if (!tt.any) return <Empty>{t.nothingRecorded}</Empty>;
  // "calibrating": not enough on record yet to split the time this computer was working
  const parts: [string, string, number, string][] =
    (tt.split ?? P.status === "ok")
      ? [
          ["s1", t.thisComputer, tt.mine, "≈ "],
          ["s3", t.otherUse, tt.other, "≈ "],
        ]
      : [
          ["s3", t.otherIdle, tt.idle, ""],
          ["s0", t.notSplit, tt.total - tt.idle, ""],
        ];
  return (
    <>
      <div className="ud-who">
        {parts.map(([cls, name, n, approx]) => (
          <div key={cls}>
            <div className="name">
              <Dot s={cls} />
              {name}
            </div>
            <div className="fig">
              <b>{pct(n, tt.total)}</b>
              <span>
                {approx}
                {t.ofWeekly(pts(n))}
              </span>
            </div>
          </div>
        ))}
      </div>
      <div className="ud-share">
        {parts.map(([cls, , n]) =>
          n > 0 ? <i key={cls} className={cls} style={{ flex: n }} /> : null,
        )}
      </div>
    </>
  );
}

// ---- plan ahead ----

const until = (iso: string) => {
  const m = Math.round((Date.parse(iso) - Date.now()) / 60000);
  if (!(m > 0)) return t.resetSince;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  return t.resetsIn(
    d
      ? `${d}${t.day} ${h}${t.hour}`
      : h
        ? `${h}${t.hour} ${m % 60}${t.minute}`
        : `${m}${t.minute}`,
  );
};
// green while it lasts, yellow when it gets close, red when it runs out before the reset
const tone = (used: number, fc: any) =>
  fc?.full || used >= 90
    ? "bad"
    : used >= 70 || (fc?.atReset ?? 0) >= 85
      ? "warn"
      : "good";

function Limit(p: {
  name: string;
  sub: string;
  used: number | null;
  cls: string;
  resets: string;
  forecast: ReactNode;
}) {
  return (
    <div className="ud-limit">
      <div className="top">
        <div>
          <div className="name">{p.name}</div>
          <div className="sub">{p.sub}</div>
        </div>
        <div className={`pct ${p.used == null ? "ud-muted" : p.cls}`}>
          {p.used == null ? "–" : `${Math.round(p.used)}%`}
        </div>
      </div>
      <div className={`ud-track ${p.cls}`}>
        {p.used ? <i style={{ width: `${Math.min(100, p.used)}%` }} /> : null}
      </div>
      <div className="foot">
        <span>{p.resets}</span>
        <span>{p.forecast}</span>
      </div>
    </div>
  );
}

function Ahead({ A, shared }: { A: any; shared: boolean }) {
  const w = A.week;
  const f = A.five;
  const pace = w.average ?? w.recent;
  const weekTone = tone(w.used, pace);
  const fiveTone = tone(f.used ?? 0, f);
  const weekNote = !pace ? null : pace.full ? (
    <span className="bad">{t.runsOutAt(fmtWhen(pace.full))}</span>
  ) : (
    <span className={weekTone === "warn" ? "warn" : ""}>
      {t.endsNearP(Math.round(pace.atReset))}
    </span>
  );
  const fiveNote = !f.open ? null : f.full ? (
    <span className="bad">{t.fillsAt(fmtWhen(f.full))}</span>
  ) : (
    <span className={fiveTone === "warn" ? "warn" : ""}>
      {t.endsNearP(Math.round(f.atReset))}
    </span>
  );

  // advice lines come as "Label: text"
  const advice = (A.tips as any[])
    .filter((x) => x.k !== "week" && x.k !== "five")
    .map((x) => {
      const i = x.text.indexOf(": ");
      const text = i < 0 ? x.text : x.text.slice(i + 2);
      return {
        k: x.k as string,
        label: i < 0 ? "" : (x.text.slice(0, i) as string),
        text: text.charAt(0).toUpperCase() + text.slice(1),
      };
    });

  const who = (A.others.list as any[])
    .map((o) => o.name || t.otherUse)
    .join(` ${t.and} `);
  const split = shared && (A.hours as any[]).some((h) => h.mine != null);
  const top = Math.max(...(A.hours as any[]).map((h) => h.rate ?? 0), 0.01);

  return (
    <>
      <div className="ud-plan">
        <div>
          <Limit
            name={t.weekly}
            sub={t.window7}
            used={w.used}
            cls={weekTone}
            resets={until(w.resets)}
            forecast={weekNote}
          />
          <Limit
            name={t.session}
            sub={t.five}
            used={f.open ? f.used : null}
            cls={f.open ? fiveTone : ""}
            resets={
              f.open ? until(f.resets) : f.none ? t.noneOnPlan : t.startsNext
            }
            forecast={f.none ? null : fiveNote}
          />
          {advice.length > 0 && (
            <dl className="ud-advice">
              {advice.map((a) => (
                <Fragment key={a.k + a.label}>
                  <dt>{a.label}</dt>
                  <dd>{a.text}</dd>
                </Fragment>
              ))}
            </dl>
          )}
        </div>
        <div className="ud-scroll">
          <table className="ud-outlook">
            <thead>
              <tr>
                <th>{t.byEndOf}</th>
                <th />
                <th className="num">{t.atPace}</th>
                <th className="num">{t.onBudget}</th>
              </tr>
            </thead>
            <tbody>
              {(A.days as any[]).map((d) => {
                const label = new Date(
                  Date.parse(d.end) - 1,
                ).toLocaleDateString(undefined, {
                  weekday: "short",
                  month: "short",
                  day: "numeric",
                });
                const out = d.atPace >= 100;
                const cls = out ? "bad" : d.atPace >= 85 ? "warn" : "good";
                return (
                  <tr key={d.end}>
                    <th scope="row">{label}</th>
                    <td className="barcell">
                      {d.atPace == null ? null : (
                        <div className={`ud-track ${cls}`}>
                          <i style={{ width: `${Math.min(100, d.atPace)}%` }} />
                        </div>
                      )}
                    </td>
                    <td className={`num strong ${out ? "bad" : ""}`}>
                      {d.atPace == null
                        ? ""
                        : out
                          ? t.out
                          : `${Math.round(d.atPace)}%`}
                    </td>
                    <td className="num ud-muted">{Math.round(d.onBudget)}%</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <details className="ud-subfold">
        <summary>
          <Icon d={ICON.open} />
          {t.byHour}
        </summary>
        <div className="ud-hours">
          {(A.hours as any[]).map((h) => {
            const mine = split ? (h.mine ?? 0) : 0;
            const rest = Math.max(0, (h.rate ?? 0) - mine);
            const title = t.hourTitle(
              pad(h.h),
              h.rate,
              split && h.mine != null ? h.mine : null,
              h.others ? { who, days: Math.round(h.others * 7) } : null,
            );
            return (
              <div
                key={h.h}
                className={`hr${h.others ? " busy" : ""}`}
                title={title}
              >
                <span className="col">
                  {rest ? (
                    <i
                      className={split ? "s3" : "s0"}
                      style={{ height: `${(rest / top) * 100}%` }}
                    />
                  ) : null}
                  {mine ? (
                    <i
                      className="s1"
                      style={{ height: `${(mine / top) * 100}%` }}
                    />
                  ) : null}
                </span>
                <i className="mark" />
                <b>{h.h % 3 ? "" : pad(h.h)}</b>
              </div>
            );
          })}
        </div>
        <div className="ud-legend">
          {split ? (
            <>
              <span>
                <Dot s="s1" />
                {t.thisComputer}
              </span>
              <span>
                <Dot s="s3" />
                {t.otherUse}
              </span>
            </>
          ) : (
            <span>
              <Dot s="s0" />
              {shared ? t.wholeAccount : t.planUse}
            </span>
          )}
          {who && (
            <span>
              <Dot s="line" line />
              {t.usuallyOn(who)}
            </span>
          )}
        </div>
      </details>
    </>
  );
}

// ---- tokens per day ----

interface DayTip {
  day: string;
  main: number;
  sub: number;
  other: number;
  x: number;
  y: number;
}

function Daily(p: {
  days: string[];
  rs: any[];
  other: (d: string) => number;
  picked: string | null;
  onPick: (d: string) => void;
}) {
  const [tip, setTip] = useState<DayTip | null>(null);
  const per = new Map<string, { main: number; sub: number; other: number }>(
    p.days.map((d) => [d, { main: 0, sub: 0, other: p.other(d) }]),
  );
  for (const r of p.rs) {
    for (const d in r.s.dayTot)
      if (per.has(d)) (per.get(d) as { main: number }).main += r.s.dayTot[d];
    for (const a of r.s.subagents)
      for (const d in a.dayTot)
        if (per.has(d)) (per.get(d) as { sub: number }).sub += a.dayTot[d];
  }
  const values = [...per.values()];
  const anyOther = values.some((v) => v.other > 0);
  const max = niceMax(
    Math.max(1, ...values.map((v) => v.main + v.sub + v.other)),
  );
  const step = Math.ceil(p.days.length / 10);
  const ticks = [0, 0.5, 1];
  return (
    <>
      <div className="ud-legend ud-chartlegend">
        <span>
          <Dot s="s1" />
          {t.mainChat}
        </span>
        <span>
          <Dot s="s2" />
          {t.subagents}
        </span>
        {anyOther && (
          <span>
            <Dot s="s3" />
            {t.otherUse}
          </span>
        )}
      </div>
      <div className="ud-chart">
        <div className="yaxis">
          {ticks.map((k) => (
            <span key={k} style={{ bottom: `${k * 100}%` }}>
              {k ? fmt(max * k).replace(/\.0+(?=\D)/, "") : "0"}
            </span>
          ))}
        </div>
        <div className="plot">
          {ticks.map((k) => (
            <i
              key={k}
              className={`gridline${k ? "" : " base"}`}
              style={{ bottom: `${k * 100}%` }}
            />
          ))}
          <div className={`days${p.picked ? " picked" : ""}`}>
            {p.days.map((d) => {
              const v = per.get(d) as {
                main: number;
                sub: number;
                other: number;
              };
              return (
                <button
                  key={d}
                  className={`day${p.picked === d ? " on" : ""}`}
                  aria-pressed={p.picked === d}
                  aria-label={t.dayLabel(
                    fmtDay(d),
                    fmt(v.main + v.sub),
                    v.other ? fmt(v.other) : "",
                  )}
                  onClick={() => p.onPick(d)}
                  onMouseMove={(e) =>
                    setTip({ day: d, ...v, x: e.clientX, y: e.clientY })
                  }
                  onMouseLeave={() => setTip(null)}
                >
                  <span className="stack">
                    {v.other ? (
                      <i
                        className="seg s3"
                        style={{ height: `${(v.other / max) * 100}%` }}
                      />
                    ) : null}
                    {v.sub ? (
                      <i
                        className="seg s2"
                        style={{ height: `${(v.sub / max) * 100}%` }}
                      />
                    ) : null}
                    {v.main ? (
                      <i
                        className="seg s1"
                        style={{ height: `${(v.main / max) * 100}%` }}
                      />
                    ) : null}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        <div />
        <div className="xaxis">
          {p.days.map((d, i) => (
            <span key={d}>
              {(p.days.length - 1 - i) % step === 0 ? <b>{fmtDay(d)}</b> : null}
            </span>
          ))}
        </div>
      </div>
      {tip && <Tip tip={tip} />}
    </>
  );
}

/** The hover card of a day's bar; placed over the cursor, kept inside the window. */
function Tip({ tip }: { tip: DayTip }) {
  const left = Math.min(tip.x + 14, window.innerWidth - 200);
  const top = Math.max(8, tip.y - 100);
  return (
    <div className="ud-tip" style={{ left, top }}>
      <div className="h">{fmtDay(tip.day)}</div>
      <div>
        <span>{t.thisComputer}</span>
        <b>{fmt(tip.main + tip.sub)}</b>
      </div>
      <div>
        <span>
          <Dot s="s1" />
          {t.mainChat}
        </span>
        <span>{fmt(tip.main)}</span>
      </div>
      <div>
        <span>
          <Dot s="s2" />
          {t.subagents}
        </span>
        <span>{fmt(tip.sub)}</span>
      </div>
      {tip.other ? (
        <div>
          <span>
            <Dot s="s3" />
            {t.otherUse}
          </span>
          <span>≈ {fmt(tip.other)}</span>
        </div>
      ) : null}
    </div>
  );
}

// ---- chats ----

const SORT: Record<string, (r: any) => string | number> = {
  title: (r) => (r.s.title || "").toLowerCase(),
  project: (r) => r.s.name.toLowerCase(),
  last: (r) => r.s.last || "",
  total: (r) => r.total,
};

function ChatDetail({ r, days }: { r: any; days: Set<string> }) {
  const s = r.s;
  const parts: {
    label: string;
    desc: string;
    model: string;
    tok: number;
    ctx: number;
    cls: string;
  }[] = [
    {
      label: t.mainChat,
      desc: "",
      model: topModel(s.models),
      tok: r.main,
      ctx: s.maxContext,
      cls: "s1",
    },
    ...[...(r.subs as any[])]
      .sort((a, b) => b.t - a.t)
      .map(({ a, t: n }) => ({
        label: a.type,
        desc: a.description,
        model: topModel(a.models),
        tok: n,
        ctx: a.maxContext,
        cls: "s2",
      })),
  ];
  const max = Math.max(1, ...parts.map((x) => x.tok));
  const ws = (s.workers as any[]).filter((w) => days.has(w.day));
  const name: Record<string, string> = { codex: "Codex", agy: "Gemini" };
  return (
    <tr className="detail">
      <td colSpan={5}>
        <div className="meta">
          {t.chatMeta(
            s.id.slice(0, 8),
            s.project,
            fmtTime(s.first),
            fmtTime(s.last),
          )}
          {r.usd ? (
            <>
              , <span title={t.usdNote}>{t.aboutUsd(fmtUsd(r.usd))}</span>
            </>
          ) : null}
        </div>
        <table>
          <thead>
            <tr>
              <th>{t.part}</th>
              <th>{t.whatItDid}</th>
              <th>{t.model}</th>
              <th className="num">{t.tokens}</th>
              <th />
              <th className="num">{t.largestContext}</th>
            </tr>
          </thead>
          <tbody>
            {parts.map((x, i) => (
              <tr key={i}>
                <td className="nowrap">
                  <Dot s={x.cls} />
                  {x.label}
                </td>
                <td>
                  <div className="desc" title={x.desc}>
                    {x.desc}
                  </div>
                </td>
                <td className="nowrap">{x.model}</td>
                <td className="num strong">{fmt(x.tok)}</td>
                <td className="splitcell">
                  <i
                    className={`ud-bar ${x.cls}`}
                    style={{ width: `${(x.tok / max) * 100}%` }}
                  />
                </td>
                <td className="num">{fmt(x.ctx)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {ws.length > 0 && (
          <>
            <h3>{t.workersFromChat}</h3>
            <ul>
              {ws.map((w, i) => (
                <li key={i}>
                  {name[w.worker] ?? w.worker}
                  {w.web ? ` (${t.webSearch})` : ""}
                  {w.processes > 1 ? `, ${t.atOnce(w.processes)}` : ""}
                  {w.seconds != null
                    ? `, ${w.seconds} ${t.secondsUnit}`
                    : `, ${t.inBackground}`}
                  {w.tokens != null ? `, ${t.tokensN(fmt(w.tokens))}` : ""}
                  {w.ok ? (
                    ""
                  ) : (
                    <>
                      , <span className="bad">{t.failed}</span>
                    </>
                  )}
                  : {w.what || t.noDescription}
                </li>
              ))}
            </ul>
          </>
        )}
      </td>
    </tr>
  );
}

function Chats(p: { rs: any[]; days: Set<string> }) {
  const [sort, setSort] = useState("total");
  const [dir, setDir] = useState(-1);
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const f = SORT[sort];
  const rs = [...p.rs].sort((a, b) => {
    const x = f(a);
    const y = f(b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
  if (!rs.length) return <Empty>{t.noChatsMatch}</Empty>;
  const max = Math.max(...rs.map((r) => r.total));
  const shown = all ? rs : rs.slice(0, 15);
  const toggleOpen = (id: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const pick = (k: string) => {
    if (sort === k) setDir(-dir);
    else {
      setSort(k);
      setDir(k === "title" || k === "project" ? 1 : -1);
    }
  };
  const cols: [string | null, ReactNode, string][] = [
    ["title", t.chat, ""],
    ["project", t.project, ""],
    ["last", t.lastActive, ""],
    ["total", t.tokens, "num"],
    [
      null,
      <>
        <Dot s="s1" />
        {t.mainChat}
        <Dot s="s2" />
        {t.subagents}
      </>,
      "",
    ],
  ];
  return (
    <>
      <div className="ud-scroll">
        <table className="ud-chats">
          <thead>
            <tr>
              {cols.map(([k, label, c], i) => (
                <th
                  key={i}
                  className={c}
                  aria-sort={
                    k && sort === k
                      ? dir < 0
                        ? "descending"
                        : "ascending"
                      : undefined
                  }
                >
                  {k ? (
                    <button
                      className={sort === k ? "on" : ""}
                      onClick={() => pick(k)}
                    >
                      {label}
                      {sort === k && <Icon d={dir < 0 ? ICON.down : ICON.up} />}
                    </button>
                  ) : (
                    label
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const s = r.s;
              const isOpen = open.has(s.id);
              return (
                <Fragment key={s.id}>
                  <tr
                    className={`row${isOpen ? " open" : ""}`}
                    tabIndex={0}
                    aria-expanded={isOpen}
                    onClick={() => toggleOpen(s.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleOpen(s.id);
                      }
                    }}
                  >
                    <td className="t" title={s.title}>
                      <Icon d={ICON.open} />
                      {s.title || t.untitledChat(s.id.slice(0, 8))}
                    </td>
                    <td className="nowrap">{s.name}</td>
                    <td className="nowrap ud-muted">{fmtTime(s.last)}</td>
                    <td className="num strong">{fmt(r.total)}</td>
                    <td className="splitcell">
                      <span
                        className="split"
                        style={{ width: `${(r.total / max) * 100}%` }}
                      >
                        {r.main ? (
                          <i className="s1" style={{ flex: r.main }} />
                        ) : null}
                        {r.sub ? (
                          <i className="s2" style={{ flex: r.sub }} />
                        ) : null}
                      </span>
                    </td>
                  </tr>
                  {isOpen && <ChatDetail r={r} days={p.days} />}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      {rs.length > shown.length && (
        <button className="ud-more" onClick={() => setAll(true)}>
          {t.showAllChats(rs.length)}
        </button>
      )}
    </>
  );
}

// ---- Codex and Gemini ----

function CodexBody({
  D,
  cx,
  days,
  shared,
}: {
  D: any;
  cx: any[];
  days: Set<string>;
  shared: boolean;
}) {
  const [all, setAll] = useState(false);
  const L = D.codex.limits;
  const CP = D.codex.plan ?? { status: "none" };
  const hasPlan = shared && CP.status !== "none";
  const plan = hasPlan ? (
    <div className="ud-gap">
      <PlanBlock P={CP} days={days} />
    </div>
  ) : null;
  const limits =
    L && !hasPlan ? (
      <p className="ud-after">
        {t.codexLimits(
          L.plan,
          Math.round(L.primary.used_percent),
          Math.round(L.primary.window_minutes / 60),
          L.secondary
            ? {
                pct: Math.round(L.secondary.used_percent),
                days: Math.round(L.secondary.window_minutes / 1440),
              }
            : null,
          fmtTime(L.at),
        )}
      </p>
    ) : null;
  if (!cx.length)
    return (
      <>
        {plan}
        <Empty>{t.noCodex}</Empty>
        {limits}
      </>
    );
  const shown = all ? cx : cx.slice(0, 12);
  return (
    <>
      {plan}
      <div className="ud-scroll">
        <table>
          <thead>
            <tr>
              <th>{t.when}</th>
              <th>{t.what}</th>
              <th>{t.startedFrom}</th>
              <th className="num">{t.tokens}</th>
              <th className="num">{t.time}</th>
              <th>{t.result}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((x, i) => (
              <tr key={i}>
                <td className="nowrap ud-muted">{fmtTime(x.at)}</td>
                <td>
                  {x.what || t.noDescription}
                  {x.web && <span className="ud-muted"> {t.webSearch}</span>}
                  {x.n > 1 && (
                    <span className="ud-muted"> {t.atOnce(x.n)}</span>
                  )}
                </td>
                <td>
                  <div className="desc" title={x.from}>
                    {x.from}
                  </div>
                </td>
                <td className="num">
                  {x.tokens != null ? (
                    fmt(x.tokens)
                  ) : (
                    <span className="ud-muted">{t.notReported}</span>
                  )}
                </td>
                <td className="num">
                  {x.seconds != null ? (
                    `${x.seconds} ${t.secondsUnit}`
                  ) : (
                    <span className="ud-muted">
                      {x.direct ? "" : t.inBackground}
                    </span>
                  )}
                </td>
                <td>
                  <OkState ok={x.ok} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {cx.length > shown.length && (
        <button className="ud-more" onClick={() => setAll(true)}>
          {t.showAllRuns(cx.length)}
        </button>
      )}
      {limits}
    </>
  );
}

function GeminiBody({
  D,
  gm,
  rs,
  days,
}: {
  D: any;
  gm: any[];
  rs: any[];
  days: Set<string>;
}) {
  const [all, setAll] = useState(false);
  if (!D.gemini.available) return <Empty>{t.noAntigravity}</Empty>;
  if (!gm.length) return <Empty>{t.noGemini}</Empty>;
  const fromClaude: any[] = rs.flatMap((r) =>
    (r.s.workers as any[]).filter((w) => w.worker === "agy" && days.has(w.day)),
  );
  const failed = fromClaude.filter((w) => !w.ok).length;
  const shown = all ? gm : gm.slice(0, 12);
  return (
    <>
      <div className="ud-scroll">
        <table>
          <thead>
            <tr>
              <th>{t.when}</th>
              <th>{t.conversation}</th>
              <th>{t.folder}</th>
              <th className="num">{t.steps}</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((g, i) => (
              <tr key={i}>
                <td className="nowrap ud-muted">{fmtTime(g.at)}</td>
                <td>{g.title || t.untitled}</td>
                <td>
                  <div className="desc" title={g.folder}>
                    {leaf(g.folder)}
                  </div>
                </td>
                <td className="num">{g.steps}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {gm.length > shown.length && (
        <button className="ud-more" onClick={() => setAll(true)}>
          {t.showAllConversations(gm.length)}
        </button>
      )}
      {fromClaude.length > 0 && (
        <p className="ud-after">
          {t.geminiFromClaude(
            sum(fromClaude, (w) => w.processes),
            failed,
          )}
        </p>
      )}
    </>
  );
}

// ---- the page ----

type Range = number | "all" | string; // days, 'all', or a plan week key

function Body({ D }: { D: any }) {
  // prepareData adds the per-day totals in place; once per file
  const allDays = useMemo(() => prepareData(D), [D]);
  const P = D.plan ?? { status: "none" };
  const shared = D.shared !== false; // false: no other use of the account, so nothing is split
  // plan weeks as the range buttons; none (no plan logger): Today / 7 days / 30 days / All
  const weeks = useMemo(() => weekRanges(P, new Date()), [P]);
  // null = the default (newest week), so a rebuild after a weekly reset moves to the new week;
  // a picked week that the new data no longer has falls back to the default too
  const [picked, setRange] = useState<Range | null>(null);
  const range: Range =
    picked == null ||
    (typeof picked === "string" &&
      picked !== "all" &&
      !weeks.some((w) => w.key === picked))
      ? weeks.length
        ? weeks[0].key
        : 7
      : picked;
  const [day, setDay] = useState<string | null>(null);
  const [project, setProject] = useState<string | null>(null);
  const [type, setType] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const toggle =
    (cur: string | null, set: (v: string | null) => void) => (v: string) =>
      set(cur === v ? null : v);

  const query = q.trim().toLowerCase();
  const rangeDays = useMemo(
    () => rangeDaysOf(allDays, range, P),
    [allDays, range, P],
  );
  const days = useMemo(
    () => new Set<string>(day ? [day] : rangeDays),
    [day, rangeDays],
  );
  const sessions: any[] = D.sessions;
  const rows = (skip?: "project" | "type") =>
    chatRows(sessions, days, { project, type, q: query }, skip);
  const rs = rows();
  // the chart always spans the range, even while one day is picked
  const rsRange = useMemo(
    () => chatRows(sessions, new Set(rangeDays), { project, type, q: query }),
    [sessions, rangeDays, project, type, query],
  );
  const cx = codexRunsOf(rs, D.codex.sessions, days, query);
  const gm = geminiRunsOf(D.gemini.conversations, days, query);

  const week = day ? undefined : weeks.find((w) => w.key === range)?.week;
  const filtered = !!(project || type || query);
  const A = D.ahead ?? { status: "none" };
  const cost = sum(rs, (r: any) => r.usd);

  // projects
  const byProject = new Map<
    string,
    { key: string; label: string; value: number; n: number }
  >();
  for (const r of rows("project")) {
    const p = byProject.get(r.s.project) ?? {
      key: r.s.project,
      label: r.s.name,
      value: 0,
      n: 0,
    };
    p.value += r.total;
    p.n++;
    byProject.set(r.s.project, p);
  }
  const plist = [...byProject.values()].sort((a, b) => b.value - a.value);
  const projectItems: RankItem[] = plist
    .slice(0, 8)
    .map((p) => ({ ...p, note: t.chatsN(p.n) }));
  const restProjects = plist.slice(8);
  if (restProjects.length)
    projectItems.push({
      key: null,
      label: t.smallerProjects(restProjects.length),
      value: sum(restProjects, (p) => p.value),
      note: t.chatsN(sum(restProjects, (p) => p.n)),
    });

  // models: ranked and shared by plan weight (list-price dollars, so a Fable
  // token weighs twice an Opus one); the token count is shown beside
  const byModel: Record<string, number> = {};
  const useByModel: Record<string, number> = {};
  for (const r of rs) {
    for (const u of [r.s, ...r.s.subagents]) {
      if (!u.dayUsd)
        throw new Error("usage data has no per-model cost: rerun the usage scan");
      for (const [d, m] of Object.entries<Record<string, number>>(
        u.days || {},
      )) {
        if (!days.has(d)) continue;
        for (const [name, n] of Object.entries(m))
          if (n > 0 && name !== "<synthetic>")
            byModel[modelName(name)] = (byModel[modelName(name)] ?? 0) + n;
      }
      for (const [d, m] of Object.entries<Record<string, number>>(u.dayUsd)) {
        if (!days.has(d)) continue;
        for (const [name, c] of Object.entries(m))
          if (c > 0)
            useByModel[modelName(name)] = (useByModel[modelName(name)] ?? 0) + c;
      }
    }
  }
  const modelTotal = Object.values(useByModel).reduce((a, b) => a + b, 0);
  const modelItems: RankItem[] = Object.entries(byModel)
    .map(([label, n]) => ({ label, value: useByModel[label] ?? 0, shown: fmt(n) }))
    .sort((a, b) => b.value - a.value)
    .map((x) => ({
      ...x,
      note: x.value / modelTotal < 0.005 ? t.under1 : pct(x.value, modelTotal),
    }));

  // subagent types
  const byType = new Map<
    string,
    { key: string; label: string; value: number; runs: number }
  >();
  for (const r of rows("type")) {
    for (const { a, t: n } of r.subs as { a: any; t: number }[]) {
      const x = byType.get(a.type) ?? {
        key: a.type,
        label: a.type,
        value: 0,
        runs: 0,
      };
      x.value += n;
      x.runs++;
      byType.set(a.type, x);
    }
  }
  const typeItems: RankItem[] = [...byType.values()]
    .sort((a, b) => b.value - a.value)
    .map((x) => ({ ...x, note: t.runsEach(x.runs, fmt(x.value / x.runs)) }));
  const typeRuns = sum(
    typeItems,
    (x) => (byType.get(x.key as string) as { runs: number }).runs,
  );

  const chips: [string, string][] = [];
  if (day) chips.push(["day", t.chipDay(fmtDay(day))]);
  if (project)
    chips.push([
      "project",
      t.chipProject(
        sessions.find((s) => s.project === project)?.name ?? project,
      ),
    ]);
  if (type) chips.push(["type", t.chipSubagent(type)]);
  const clear = (k: string) =>
    (
      ({ day: setDay, project: setProject, type: setType }) as Record<
        string,
        (v: null) => void
      >
    )[k](null);

  const md = (ms: number) =>
    new Date(ms).toLocaleDateString(t.locale, {
      month: "short",
      day: "numeric",
    });
  const spanOf = (w: any) => {
    const stop = w.stop ?? w.end;
    return new Date(w.start).getMonth() === new Date(stop).getMonth()
      ? `${md(w.start)} – ${new Date(stop).getDate()}`
      : `${md(w.start)} – ${md(stop)}`;
  };
  const weekLabel = (w: any, lib: string) =>
    lib === "This week"
      ? t.thisWeek
      : lib === "Last week"
        ? t.lastWeek
        : spanOf(w);
  const weekNoteText = (w: any) => {
    const stop = w.stop ?? w.end;
    const extra = w.partial
      ? ([
          w.first - w.start > 36e5 && t.recordedFrom(md(w.first)),
          Date.now() >= stop &&
            stop - w.last > 36e5 &&
            t.recordedUntil(md(w.last)),
        ].filter(Boolean) as string[])
      : [];
    return t.weekNote(spanOf(w), Math.round(w.total), extra);
  };
  const rangeLabel = (r: Range) =>
    r === 1 ? t.today : r === "all" ? t.all : t.daysN(r as number);
  const ranges: { key: Range; label: string; title?: string }[] = weeks.length
    ? [
        ...weeks.map((w) => ({
          key: w.key as Range,
          label: weekLabel(w.week, w.label),
          title: w.title,
        })),
        { key: "all" as Range, label: t.all },
      ]
    : ([1, 7, 30, "all"] as Range[]).map((r) => ({
        key: r,
        label: rangeLabel(r),
      }));
  const codexTokens = sum(cx, (x: any) => x.tokens || 0);

  return (
    <>
      <Section
        title={t.planAhead}
        note={A.status === "none" ? "" : t.asOf(fmtTime(A.at))}
      >
        {A.status === "none" ? (
          <Empty>{t.noForecast}</Empty>
        ) : (
          <Ahead A={A} shared={shared} />
        )}
      </Section>

      <div className="ud-controls">
        <div className="ud-seg" role="group">
          {ranges.map((r) => {
            const on = range === r.key && !day;
            return (
              <button
                key={r.key}
                className={on ? "on" : ""}
                aria-pressed={on}
                title={r.title}
                onClick={() => {
                  setRange(r.key);
                  setDay(null);
                }}
              >
                {r.label}
              </button>
            );
          })}
        </div>
        <span className="sum" title={cost ? t.usdNote : ""}>
          {t.sumLine(
            fmt(sum(rs, (r: any) => r.total)),
            rs.length,
            cost ? fmtUsd(cost) : "",
          )}
        </span>
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={t.searchChats}
          aria-label={t.searchChats}
        />
      </div>
      {chips.length > 0 && (
        <div className="ud-chips">
          {chips.map(([k, label]) => (
            <button
              key={k}
              className="ud-chip"
              aria-label={t.removeFilter(label)}
              onClick={() => clear(k)}
            >
              {label}
              <Icon d={ICON.x} />
            </button>
          ))}
        </div>
      )}

      {shared && (
        <Section title={t.whoUsed} note={week ? weekNoteText(week) : ""}>
          {P.status === "none" ? (
            <Empty>{t.noPlanPct}</Empty>
          ) : (
            <PlanBlock P={P} days={days} week={week} />
          )}
        </Section>
      )}

      <div className="ud-cols2">
        <Section title={t.projects}>
          {projectItems.length ? (
            <Ranks
              items={projectItems}
              picked={project}
              onPick={toggle(project, setProject)}
            />
          ) : (
            <Empty>{t.noClaude}</Empty>
          )}
        </Section>
        <Section title={t.models}>
          {modelItems.length ? (
            <Ranks items={modelItems} />
          ) : (
            <Empty>{t.noClaude}</Empty>
          )}
        </Section>
      </div>

      {rangeDays.length >= 2 && (
        <Section title={t.tokensPerDay}>
          <Daily
            days={rangeDays}
            rs={rsRange}
            other={(d) => otherTokensFor(P, shared, filtered, d)}
            picked={day}
            onPick={(d) => setDay(day === d ? null : d)}
          />
        </Section>
      )}

      <Section title={t.chats} note={rs.length ? t.chatsN(rs.length) : ""}>
        <Chats rs={rs} days={days} />
      </Section>

      <Fold
        title={t.subagentsTitle}
        note={
          typeItems.length
            ? t.tokensInRuns(fmt(sum(typeItems, (x) => x.value)), typeRuns)
            : t.none
        }
      >
        {typeItems.length ? (
          <Ranks
            items={typeItems}
            picked={type}
            onPick={toggle(type, setType)}
          />
        ) : (
          <Empty>{t.noSubagents}</Empty>
        )}
      </Fold>
      <Fold
        title="Codex"
        note={
          cx.length
            ? t.tokensInRuns(
                fmt(codexTokens),
                sum(cx, (x: any) => x.n),
              )
            : t.none
        }
      >
        <CodexBody D={D} cx={cx} days={days} shared={shared} />
      </Fold>
      <Fold
        title="Gemini"
        note={
          gm.length
            ? t.conversationsSteps(
                gm.length,
                sum(gm, (g: any) => g.steps),
              )
            : t.none
        }
      >
        <GeminiBody D={D} gm={gm} rs={rs} days={days} />
      </Fold>
    </>
  );
}

// ---- header, progress, empty state ----

/** Milliseconds since `active` turned true; 0 while not active. */
function useElapsed(active: boolean) {
  const [ms, setMs] = useState(0);
  useEffect(() => {
    if (!active) {
      setMs(0);
      return;
    }
    const start = Date.now();
    setMs(0);
    const id = setInterval(() => setMs(Date.now() - start), 500);
    return () => clearInterval(id);
  }, [active]);
  return ms;
}

function Progress({
  elapsedMs,
  buildMs,
}: {
  elapsedMs: number;
  buildMs: number | undefined;
}) {
  const frac = progressFraction(elapsedMs, buildMs);
  return (
    <div
      className="ud-progress"
      role="progressbar"
      aria-label={t.rebuilding}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={frac == null ? undefined : Math.round(frac * 100)}
    >
      {frac == null ? (
        <i className="indeterminate" />
      ) : (
        <i style={{ transform: `scaleX(${frac})` }} />
      )}
    </div>
  );
}

interface Props {
  state: DashboardState;
  onRefresh: () => void;
}

export function DashboardView({ state, onRefresh }: Props) {
  const { data, status, error } = state;
  const rebuilding = status === "rebuilding";
  const elapsed = useElapsed(rebuilding);
  const D = data as (DashboardData & Record<string, any>) | null;
  return (
    <div className="ud" data-usage-dashboard>
      <style>{DASHBOARD_CSS}</style>
      <div className="ud-wrap">
        <header className="ud-top">
          <h1>{t.dashboardTitle}</h1>
          {D && <span className="ud-muted">{t.asOf(clock(D.builtAt))}</span>}
          {D && (
            <span className="ud-muted ud-scope">{`${D.computer} · ${t.built(fmtTime(D.generated as string))}`}</span>
          )}
          <span className="ud-spacer" />
          {rebuilding && (
            <span className="ud-muted ud-busy">
              {t.rebuildingFor(Math.floor(elapsed / 1000))}
            </span>
          )}
          <button className="ud-btn" onClick={onRefresh} disabled={rebuilding}>
            {t.refresh}
          </button>
        </header>
        {rebuilding && <Progress elapsedMs={elapsed} buildMs={D?.buildMs} />}
        {error && (
          <div className="ud-error" role="alert">
            <span>{error}</span>
            <button
              className="ud-btn"
              onClick={onRefresh}
              disabled={rebuilding}
            >
              {t.retry}
            </button>
          </div>
        )}
        {D ? (
          <Body D={D} />
        ) : status === "reading" ? (
          <p className="ud-empty">{t.loading}</p>
        ) : (
          <div className="ud-nodata">
            <h2>{t.noDataTitle}</h2>
            <p className="ud-empty">
              {rebuilding ? t.noDataBuilding : t.noDataPress}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
