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
import { getState, openDashboard, refresh, setExec, start, stop, subscribe } from './store';
import { CSS } from './styles';

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
          {used !== null && <div className="up-used">used</div>}
        </div>
      </div>
      <div className="up-bar">
        <div className="up-fill" style={{ width: `${Math.min(100, used ?? 0)}%` }} />
        {used !== null && <div className="up-tick" style={{ left: `${Math.min(100, Math.max(0, 100 - (left / length) * 100))}%` }} />}
      </div>
      <div className="up-meta">
        <Sym name="schedule" />
        {used === null ? 'Starts with your next message' : `Resets in ${span(left)}`}
      </div>
    </div>
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
            <div className="up-label">Your pace</div>
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
  const { plan, error, loading } = useStore();
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
  if (week?.rolled) forecast = { icon: 'restart_alt', value: 'New week', note: 'Nothing used yet' };
  else if (week && p?.full) forecast = { icon: 'trending_up', value: `Runs out ${when(p.full)}`, note: `${span(Date.parse(week.resets) - Date.parse(p.full))} before the reset` };
  else if (p) forecast = { icon: 'check_circle', value: `Ends near ${Math.round(p.atReset)}%`, note: 'Lasts until the reset' };

  let fiveForecast: Forecast | null = null;
  if (s?.full && five?.resets) fiveForecast = { icon: 'trending_up', value: `Runs out ${clock(s.full)}`, note: `${span(Date.parse(five.resets) - Date.parse(s.full))} before the reset` };
  else if (s) fiveForecast = { icon: 'check_circle', value: `Ends near ${Math.round(s.atReset)}%`, note: 'Lasts until the reset' };

  return (
    <div className="up" data-usage-plan>
      <style>{CSS}</style>
      <div className="up-head">
        <span className="up-title">Usage Plan</span>
        <button className="up-iconbtn" onClick={refresh} disabled={loading} title="Refresh" aria-label="Refresh">
          <Sym name="refresh" className={loading ? 'up-spin' : ''} />
        </button>
      </div>

      {week && (
        <>
          <div className="up-group">
            <Limit name="Weekly" sub={week.today == null ? '7-day window' : `7-day window · ${Math.round(week.today)}% today`} used={week.used} resets={week.resets} length={WEEK_MS} tone={tone} now={now} />
            <PaceCard forecast={forecast} tone={tone} budgetLabel="Daily budget" budget={week.budget} pace={p ? p.perDay : null} unit="a day" />
          </div>
          <div className="up-group">
            <Limit name="Session" sub="5-hour window" used={s ? (five?.used ?? 0) : null} resets={five?.resets} length={FIVE_MS} tone={fiveTone} now={now} />
            {s && <PaceCard forecast={fiveForecast} tone={fiveTone} budgetLabel="Hourly budget" budget={s.budget} pace={s.perHour} unit="an hour" />}
          </div>
        </>
      )}
      {plan && !ok && <div className="up-empty">No plan numbers recorded yet.</div>}
      {!plan && !error && <div className="up-empty">Loading…</div>}

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
          {opening ? 'Opening…' : 'Full dashboard'}
        </button>
        {plan?.at && <div className="up-updated">Updated {clock(plan.at)}</div>}
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
        `Week: ${Math.round(week.used)}% used (resets ${span(Date.parse(week.resets) - now)})`,
        week.today == null ? '' : `Today: ${Math.round(week.today)}% of the week`,
        p?.full ? `Runs out ${when(p.full)} at this pace` : p ? `Ends near ${Math.round(p.atReset)}% at this pace` : '',
        ok?.five?.open ? `Session: ${Math.round(ok.five.used ?? 0)}% used` : '',
      ]
    : ['Usage Plan'];

  return (
    <button
      className="nav-button group relative w-9 h-9 flex items-center justify-center border-none rounded-md cursor-pointer transition-all duration-150 p-0 active:scale-95 focus-visible:outline-2 focus-visible:outline-[var(--nim-primary)] focus-visible:outline-offset-2 text-nim-muted hover:bg-nim-tertiary hover:text-nim"
      style={{ position: 'relative', width: 36, height: 36, padding: 0, border: 0, borderRadius: 6, cursor: 'pointer', ...(isActive ? { background: 'var(--nim-bg-tertiary)' } : {}) }}
      title={lines.filter(Boolean).join('\n')}
      aria-label="Usage Plan"
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
