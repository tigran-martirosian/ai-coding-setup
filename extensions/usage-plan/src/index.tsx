/**
 * Usage Plan: the Claude plan numbers and forecast, as a popover next to a gutter button and a sidebar panel.
 *
 * All numbers come from ~/.claude/skills/setup-audit/scripts/plan-ahead.mjs --json (see store.ts).
 * This file only draws them. The week's percent is not drawn on the gutter button: the app's own Claude ring shows it.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PanelHostProps } from '@nimbalyst/extension-sdk';
import { FIVE_MS, WEEK_MS, HOUR_MS, clock, elapsedPercent, extraLimits, paceHours, pace, sessionPace, span, weekForecast, when } from './format';
import type { Tone } from './format';
import { UsageDashboardPanel, hideDashboardButton, showDashboardPanel, unhideDashboardButton } from './dashboard';
import { closePopover, installPopover, removePopover } from './popover';
import { getState, refresh, setExec, start, stop, subscribe } from './store';
import { CSS } from './styles';
import '../../shared/tokens.css';
import { t } from './strings';

const useStore = () => useSyncExternalStore(subscribe, getState);

/** Re-renders once a minute so "6 d 8 h left" stays right between refreshes. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

const Sym = ({ name }: { name: string }) => (
  <span className="material-symbols-outlined up-sym" aria-hidden="true">
    {name}
  </span>
);

/** One limit: its name and reset time, the figure, the bar with the labelled tick for the time that has passed, and the time left. */
function Limit(props: { name: string; used: number | null; resets?: string; length: number; tick: (percent: number) => string; tone: Tone; now: number; size: 'large' | 'small'; note?: string }) {
  const { name, used, resets, length, tick, tone, now, size, note } = props;
  const left = resets ? Date.parse(resets) - now : 0;
  const passed = resets ? elapsedPercent(resets, length, now) : 0;
  const tickText = tick(passed);
  const shown = used !== null && !!resets;
  return (
    <section className={`up-limit ${size}`}>
      <div className="up-row">
        <span className="up-label">{name}</span>
        {shown && <span className="up-cap">{t.resetsAt(when(resets))}</span>}
      </div>
      <div className="up-figline">
        <span className="up-fig">{used === null ? '–' : `${Math.round(used)}%`}</span>
        {used !== null && <span className="up-unit">{t.used}</span>}
      </div>
      <div className="up-bar" role="img" aria-label={used === null ? name : t.barLabel(Math.round(used), tickText)}>
        <div className="up-track">
          <div className={`up-fill ${tone === 'error' ? 'error' : ''}`} style={{ transform: `scaleX(${Math.min(100, used ?? 0) / 100})` }} />
        </div>
        {shown && <div className="up-tick" style={{ left: `${passed}%` }} title={tickText} />}
      </div>
      {shown && (
        <div className="up-now">
          <span style={{ left: `clamp(12px, ${passed}%, calc(100% - 12px))` }} title={tickText}>
            {t.now}
          </span>
        </div>
      )}
      <div className="up-cap">{used === null ? t.startsNext : [t.left(span(left)), note].filter(Boolean).join(' · ')}</div>
    </section>
  );
}

interface Stat {
  label: string;
  value: string;
  unit: string;
  /** What the figure is based on, always said under a pace. */
  basis: string;
  /** Set when the pace is over the budget. */
  tone?: Tone;
}

/** Budget and pace side by side read at one precision: a tenth below 10%, whole numbers above. */
const pct = (v: number) => `${v < 10 ? Math.round(v * 10) / 10 : Math.round(v)}%`;

/** What happens at this pace, as a tinted line, and the two numbers behind it side by side. */
function Forecast(props: { tone: Tone; verdict: string; detail: string; stats: Stat[] }) {
  const { tone, verdict, detail, stats } = props;
  return (
    <>
      <div className={`up-forecast ${tone}`}>
        <span className="up-dot" />
        <div>
          <div className="up-verdict">{verdict}</div>
          {detail && <div className="up-cap">{detail}</div>}
        </div>
      </div>
      {stats.length > 0 && (
        <div className="up-stats">
          {stats.map((st) => (
            <div className={`up-stat ${st.tone ?? ''}`} key={st.label}>
              <span className="up-cap">{st.label}</span>
              <span className="up-stat-fig">
                {st.value}
                <span className="up-unit">{st.unit}</span>
              </span>
              <span className="up-cap">{st.basis}</span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

/** Opens the dashboard panel in the main area; the popover, if that is where the click came from, closes. */
function openFullDashboard() {
  closePopover();
  showDashboardPanel();
}

/** The whole view. With a host it is the sidebar panel; without one, the popover. */
function UsagePlanPanel({ host }: Partial<PanelHostProps>) {
  const { plan, error, loading } = useStore();
  const now = useNow();

  useEffect(() => {
    if (host) setExec((command, options) => host.exec(command, options));
    start();
    refresh();
  }, [host]);

  const ok = plan?.status === 'ok' && plan.week ? plan : null;
  const week = ok?.week;
  const p = ok ? pace(ok) : null;
  const hours = ok ? paceHours(ok) : null;
  const s = ok ? sessionPace(ok, now) : null;
  const fc = ok ? weekForecast(ok) : null;
  const fiveTone: Tone = s?.full ? 'error' : s && s.atReset >= 90 ? 'warning' : 'success';
  const over = (paceValue: number, budget: number, toneIfOver: Tone): Tone | undefined => (paceValue > budget ? toneIfOver : undefined);

  let weekForecastView = null;
  if (week && fc) {
    const stats: Stat[] = [{ label: t.budget, value: pct(week.budget), unit: t.unitDay, basis: t.budgetWeek }];
    if (p && hours) {
      const tone = fc.kind === 'runsOut' ? 'error' : fc.kind === 'ends' ? fc.tone : 'success';
      stats.push({ label: t.yourPace, value: pct(p.perDay), unit: t.unitDay, basis: t.paceFrom(hours < 48 ? `${hours} ${t.hour}` : span(hours * HOUR_MS)), tone: over(p.perDay, week.budget, tone) });
    }
    const view =
      fc.kind === 'new'
        ? { tone: 'success' as Tone, verdict: t.newWeek, detail: '' }
        : fc.kind === 'runsOut'
          ? { tone: 'error' as Tone, verdict: t.runsOut(when(fc.full)), detail: t.beforeReset(span(fc.before)) }
          : { tone: fc.tone, verdict: t.endsNear(fc.percent), detail: t.lastsUntilReset };
    weekForecastView = <Forecast {...view} stats={fc.kind === 'new' ? [] : stats} />;
  }

  return (
    <div className="up" data-usage-plan>
      <style>{CSS}</style>
      <div className="up-head">
        <span className="up-title">{t.title}</span>
        {loading && <span className="up-busy">{t.updating}</span>}
        <button className="up-iconbtn" onClick={refresh} disabled={loading} title={t.refresh} aria-label={t.refresh}>
          <Sym name="refresh" />
        </button>
      </div>

      {ok && week && (
        <>
          <div className="up-group">
            <Limit
              name={t.week}
              used={week.used}
              resets={week.resets}
              length={WEEK_MS}
              tick={t.tickWeek}
              tone={fc?.kind === 'runsOut' ? 'error' : 'success'}
              now={now}
              size="large"
              note={week.today == null ? (ok.at ? t.asOf(clock(ok.at)) : '') : t.todayAsOf(Math.round(week.today), clock(ok.at))}
            />
            {weekForecastView}
            {extraLimits(ok).length > 0 && (
              <div className="up-extras">
                {extraLimits(ok).map((e) => (
                  <div className="up-extra" key={e.name}>
                    <span>{e.name}</span>
                    <span className="up-cap">{e.resets ? t.resetsAt(when(e.resets)) : ''}</span>
                    <span className="up-num">{Math.round(e.used)}%</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {s && (
            <div className="up-group">
              <Limit name={t.five} used={ok.five?.used ?? 0} resets={ok.five?.resets} length={FIVE_MS} tick={t.tickFive} tone={fiveTone} now={now} size="small" />
              <Forecast
                tone={fiveTone}
                verdict={s.full ? t.runsOut(clock(s.full)) : t.endsNear(Math.round(s.atReset))}
                detail={s.full && ok.five?.resets ? t.beforeReset(span(Date.parse(ok.five.resets) - Date.parse(s.full))) : t.lastsUntilReset}
                stats={[
                  { label: t.budget, value: pct(s.budget), unit: t.unitHour, basis: t.budgetFive },
                  { label: t.yourPace, value: pct(s.perHour), unit: t.unitHour, basis: t.paceFromFive, tone: over(s.perHour, s.budget, fiveTone) },
                ]}
              />
            </div>
          )}
        </>
      )}
      {plan && !ok && <div className="up-empty">{t.noPlan}</div>}
      {!plan && !error && <div className="up-empty">{t.loading}</div>}

      <div className="up-foot">
        {error && (
          <div className="up-error" role="alert">
            <span>{error}</span>
            <button onClick={refresh}>{t.retry}</button>
          </div>
        )}
        <button className="up-btn" onClick={openFullDashboard}>
          <Sym name="open_in_new" />
          <span>{t.dashboard}</span>
        </button>
      </div>
    </div>
  );
}

export function activate() {
  installPopover(() => <UsagePlanPanel />, t.title);
  hideDashboardButton();
  start();
}

export function deactivate() {
  stop();
  removePopover();
  unhideDashboardButton();
}

// The app reads `panels` when it loads the extension, so the button opens the popover from the
// first click even if the app only activates the extension when its panel is opened.
if (typeof window !== 'undefined') {
  installPopover(() => <UsagePlanPanel />, t.title);
  hideDashboardButton();
}

export const panels = {
  'usage-plan': { component: UsagePlanPanel },
  'usage-dashboard': { component: UsageDashboardPanel },
};
