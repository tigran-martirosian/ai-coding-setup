/**
 * Usage Plan: the Claude plan numbers and forecast, as a gutter button and a sidebar panel.
 *
 * All numbers come from ~/.claude/skills/usage-report/plan-ahead.mjs --json (see store.ts).
 * This file only draws them.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PanelGutterButtonProps, PanelHostProps } from '@nimbalyst/extension-sdk';
import { FIVE_MS, WEEK_MS, clock, pace, sessionPace, span, weekTone, when } from './format';
import type { Tone } from './format';
import { clearGutter, paintGutter } from './gutter';
import { installPopover, removePopover } from './popover';
import type { Shared } from './store';
import { getState, openDashboard, refresh, setExec, start, stop, subscribe } from './store';
import { CSS } from './styles';
import { t } from './strings';

const useStore = () => useSyncExternalStore(subscribe, getState);

/** Re-renders once a minute so "Resets in 2h 5m" stays right between refreshes. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const Sym = ({ name, className = '' }: { name: string; className?: string }) => (
  <span className={`material-symbols-outlined up-sym ${className}`} aria-hidden="true">
    {name}
  </span>
);

function Limit(props: { name: string; sub: string; used: number | null; resets?: string; length: number; tone: Tone; now: number }) {
  const { name, sub, used, resets, length, tone, now } = props;
  const left = resets ? Date.parse(resets) - now : 0;
  return (
    <div className={tone}>
      <div className="up-row">
        <div>
          <div className="up-name">{name}</div>
          <div className="up-sub">{sub}</div>
        </div>
        <div>
          <div className="up-pct">{used === null ? '–' : `${Math.round(used)}%`}</div>
          {used !== null && <div className="up-used">{t.used}</div>}
        </div>
      </div>
      <div className="up-bar">
        <div className="up-fill" style={{ width: `${Math.min(100, used ?? 0)}%` }} />
        {used !== null && <div className="up-tick" style={{ left: `${Math.min(100, Math.max(0, 100 - (left / length) * 100))}%` }} />}
      </div>
      <div className="up-meta">
        <Sym name="schedule" />
        {used === null ? t.startsNext : t.resetsIn(span(left))}
      </div>
    </div>
  );
}

const pctText = (n: number | null) => (n === null ? '—' : `${Math.round(n)}%`);

/** One row per person who uses the shared subscription, as counted by ccpool. */
function SharedUse({ members }: { members: NonNullable<Shared['members']> }) {
  return (
    <div className="up-group">
      <div className="up-who">
        <div>
          <div className="up-name">{t.whoUsed}</div>
          <div className="up-sub">{t.sharedHint}</div>
        </div>
        <div className="up-col">{`5${t.hour}`}</div>
        <div className="up-col">{t.weekShort}</div>
        {members.map((m) => (
          <SharedRow key={m.name} member={m} />
        ))}
      </div>
    </div>
  );
}

function SharedRow({ member }: { member: NonNullable<Shared['members']>[number] }) {
  return (
    <>
      <div>
        {member.name === 'unknown' ? t.notCounted : member.name}
        {member.me && <span className="up-dim">{` · ${t.you}`}</span>}
      </div>
      <div className="up-who-num">{pctText(member.five)}</div>
      <div className="up-who-num">{pctText(member.week)}</div>
    </>
  );
}

interface Forecast {
  icon: string;
  value: string;
  note: string;
}

/** Where a limit ends at this pace, over the budget that lasts and the pace now. */
function PaceCard(props: { forecast: Forecast | null; tone: Tone; budgetLabel: string; budget: number; pace: number | null; unit: string }) {
  const { forecast, tone, budgetLabel, budget, pace, unit } = props;
  return (
    <div className="up-card">
      {forecast && (
        <div className={`up-item ${tone}`}>
          <span className="up-badge">
            <Sym name={forecast.icon} />
          </span>
          <div>
            <div className="up-value">{forecast.value}</div>
            <div className="up-note">{forecast.note}</div>
          </div>
        </div>
      )}
      <div className="up-stats">
        <div className="up-stat">
          <div className="up-label">{budgetLabel}</div>
          <div className="up-num">
            {budget}% <small>{unit}</small>
          </div>
        </div>
        {pace !== null && (
          <div className="up-stat">
            <div className="up-label">{t.yourPace}</div>
            <div className={`up-num ${pace > budget ? 'over' : ''}`}>
              {pace}% <small>{unit}</small>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** The whole view. With a host it is the sidebar panel; without one, the popover. */
function UsagePlanPanel({ host }: Partial<PanelHostProps>) {
  const { plan, shared, error, loading } = useStore();
  const now = useNow();
  const [opening, setOpening] = useState(false);

  useEffect(() => {
    if (host) setExec((command, options) => host.exec(command, options));
    start();
    refresh();
  }, [host]);

  const ok = plan?.status === 'ok' && plan.week ? plan : null;
  const week = ok?.week;
  const five = ok?.five;
  const p = ok ? pace(ok) : null;
  const s = ok ? sessionPace(ok, now) : null;
  const tone = ok ? weekTone(ok) : 'success';
  const fiveTone: Tone = s?.full ? 'error' : (s?.atReset ?? 0) >= 90 ? 'warning' : 'success';

  let forecast: Forecast | null = null;
  if (week?.rolled) forecast = { icon: 'restart_alt', value: t.newWeek, note: t.nothingUsed };
  else if (week && p?.full) forecast = { icon: 'trending_up', value: t.runsOut(when(p.full)), note: t.beforeReset(span(Date.parse(week.resets) - Date.parse(p.full))) };
  else if (p) forecast = { icon: 'check_circle', value: t.endsNear(Math.round(p.atReset)), note: t.lastsUntilReset };

  let fiveForecast: Forecast | null = null;
  if (s?.full && five?.resets) fiveForecast = { icon: 'trending_up', value: t.runsOut(clock(s.full)), note: t.beforeReset(span(Date.parse(five.resets) - Date.parse(s.full))) };
  else if (s) fiveForecast = { icon: 'check_circle', value: t.endsNear(Math.round(s.atReset)), note: t.lastsUntilReset };

  return (
    <div className="up" data-usage-plan>
      <style>{CSS}</style>
      <div className="up-head">
        <span className="up-title">{t.title}</span>
        <button className="up-iconbtn" onClick={refresh} disabled={loading} title={t.refresh} aria-label={t.refresh}>
          <Sym name="refresh" className={loading ? 'up-spin' : ''} />
        </button>
      </div>

      {week && (
        <>
          <div className="up-group">
            <Limit name={t.weekly} sub={week.today == null ? t.window7 : t.window7Today(Math.round(week.today))} used={week.used} resets={week.resets} length={WEEK_MS} tone={tone} now={now} />
            <PaceCard forecast={forecast} tone={tone} budgetLabel={t.dailyBudget} budget={week.budget} pace={p ? p.perDay : null} unit={t.unitDay} />
          </div>
          <div className="up-group">
            <Limit name={t.session} sub={t.window5} used={s ? (five?.used ?? 0) : null} resets={five?.resets} length={FIVE_MS} tone={fiveTone} now={now} />
            {s && <PaceCard forecast={fiveForecast} tone={fiveTone} budgetLabel={t.hourlyBudget} budget={s.budget} pace={s.perHour} unit={t.unitHour} />}
          </div>
          {shared?.setUp && shared.members?.length ? <SharedUse members={shared.members} /> : null}
        </>
      )}
      {plan && !ok && <div className="up-empty">{t.noPlan}</div>}
      {!plan && !error && <div className="up-empty">{t.loading}</div>}

      <div className="up-foot">
        {error && <div className="up-error">{error}</div>}
        <button
          className="up-btn"
          disabled={opening}
          onClick={async () => {
            setOpening(true);
            await openDashboard();
            setOpening(false);
          }}
        >
          <Sym name="open_in_new" />
          {opening ? t.opening : t.fullDashboard}
        </button>
        {plan?.at && <div className="up-updated">{t.updated(clock(plan.at))}</div>}
      </div>
    </div>
  );
}

const RING = 2 * Math.PI * 12;

/**
 * The week's percent in a ring, like Nimbalyst's own usage buttons.
 * The app does not render this yet (see gutter.ts, which draws the same ring on the app's own button).
 */
function UsagePlanGutterButton({ isActive, onActivate }: PanelGutterButtonProps) {
  const { plan } = useStore();
  const now = useNow();
  useEffect(start, []);

  const ok = plan?.status === 'ok' && plan.week ? plan : null;
  const week = ok?.week;
  const p = ok ? pace(ok) : null;
  const lines = week
    ? [
        t.weekUsed(Math.round(week.used), span(Date.parse(week.resets) - now)),
        week.today == null ? '' : t.todayOfWeek(Math.round(week.today)),
        p?.full ? t.runsOutAtPace(when(p.full)) : p ? t.endsNearAtPace(Math.round(p.atReset)) : '',
        ok?.five?.open ? t.sessionUsed(Math.round(ok.five.used ?? 0)) : '',
      ]
    : [t.title];

  return (
    <button
      className="nav-button group relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 text-nim-muted hover:bg-nim-tertiary hover:text-nim"
      style={{ position: 'relative', width: 36, height: 36, padding: 0, border: 0, borderRadius: 6, cursor: 'pointer', ...(isActive ? { background: 'var(--nim-bg-tertiary)' } : {}) }}
      title={lines.filter(Boolean).join('\n')}
      aria-label={t.title}
      aria-pressed={isActive}
      onClick={onActivate}
    >
      {week ? (
        <>
          <svg width="32" height="32" viewBox="0 0 32 32" style={{ transform: 'rotate(-90deg)', display: 'block', margin: 'auto' }}>
            <circle cx="16" cy="16" r="12" fill="none" stroke="var(--nim-bg-tertiary)" strokeWidth="3" />
            <circle
              cx="16"
              cy="16"
              r="12"
              fill="none"
              stroke={`var(--nim-${weekTone(ok!)})`}
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={RING}
              strokeDashoffset={RING * (1 - Math.min(100, week.used) / 100)}
              style={{ transition: 'stroke-dashoffset 0.3s' }}
            />
          </svg>
          <span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, fontWeight: 600, color: 'var(--nim-text)' }}>
            {Math.round(week.used)}%
          </span>
        </>
      ) : (
        <span className="material-symbols-outlined" style={{ fontSize: 20 }}>
          data_usage
        </span>
      )}
    </button>
  );
}

let unpaint: (() => void) | undefined;

export function activate() {
  unpaint ??= subscribe(() => paintGutter(getState().plan));
  paintGutter(getState().plan);
  installPopover(() => <UsagePlanPanel />);
  start();
}

export function deactivate() {
  stop();
  unpaint?.();
  unpaint = undefined;
  clearGutter();
  removePopover();
}

// The app reads `panels` when it loads the extension, so the button opens the popover from the
// first click even if the app only activates the extension when its panel is opened.
if (typeof window !== 'undefined') installPopover(() => <UsagePlanPanel />);

export const panels = {
  'usage-plan': { component: UsagePlanPanel, gutterButton: UsagePlanGutterButton },
};
