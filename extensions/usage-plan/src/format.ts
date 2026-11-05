// Pure helpers: the planner's JSON shape and how its values are worded on screen.

import { t } from './strings.ts';

export interface Pace {
  perDay: number;
  perHour?: number;
  atReset: number;
  full: string | null;
  /** Only the recent pace says how many hours it was read over. */
  hours?: number;
}

/** A limit besides the week (a per-model weekly limit such as Fable), as the logger keeps it. */
export interface Extra {
  name: string;
  used: number;
  resets: string | null;
}

export interface Plan {
  status: string;
  at?: string;
  week?: { used: number; resets: string; rolled: boolean; budget: number; today?: number; average: Pace | null; recent: Pace | null };
  five?: { open: boolean; used?: number; resets?: string; perHour?: number; atReset?: number; full?: string | null };
  /** The reading's per-model limits, when the planner passes them on: {model, u, r}. */
  models?: { model: string; u: number; r: string | null }[];
  /** Any other limit of the reading: {kind, group, u, r}. */
  limits?: { kind: string; group?: string; u: number; r: string | null }[];
}

export type Tone = 'success' | 'warning' | 'error';

/** What to show for a failed command. A crash ends in "Node.js v24.13.0"; a process killed at its time limit reports only "Command failed: <the whole command line>". */
export const failureLine = (stderr: string, plain: string) => {
  const line = stderr.trim().split('\n').pop() ?? '';
  return !line || /^(Command failed:|Node\.js v)/.test(line) ? plain : line;
};

const HOUR = 3_600_000;
export const HOUR_MS = HOUR;
export const WEEK_MS = 7 * 24 * HOUR;
export const FIVE_MS = 5 * HOUR;

/** "Tue 00:11" */
export const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(t.locale, { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';

/** "11:52" */
export const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }) : '';

/** "5 d 10 h", "2 h 5 m", "12 m" */
export function span(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d} ${t.day} ${h} ${t.hour}`;
  if (h) return `${h} ${t.hour} ${m} ${t.minute}`;
  return `${m} ${t.minute}`;
}

/** How much of a limit's window has passed, in whole percent: what the tick on the bar marks. */
export const elapsedPercent = (resets: string, length: number, now: number) =>
  Math.round(Math.min(100, Math.max(0, 100 - ((Date.parse(resets) - now) / length) * 100)));

/** The hours of this week the pace is read over: the average runs from the week's first reading, the recent one says its own. */
export function paceHours(plan: Plan): number | null {
  const week = plan.week;
  if (!week) return null;
  if (week.average) return week.average.perHour && week.used > 0 ? Math.max(1, Math.round(week.used / week.average.perHour)) : null;
  return week.recent?.hours ?? null;
}

/** The week's limits besides the week itself, one line each. */
export function extraLimits(plan: Plan): Extra[] {
  const models = (plan.models ?? []).map((m) => ({ name: m.model, used: m.u, resets: m.r }));
  const others = (plan.limits ?? []).map((l) => ({ name: (l.kind || l.group || '').replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase()), used: l.u, resets: l.r }));
  return [...models, ...others].filter((e) => e.name && typeof e.used === 'number');
}

export type Forecast =
  | { kind: 'new' }
  | { kind: 'runsOut'; full: string; before: number }
  | { kind: 'ends'; percent: number; tone: Tone };

/** Where the week ends at the pace so far. */
export function weekForecast(plan: Plan): Forecast | null {
  const week = plan.week;
  if (!week) return null;
  if (week.rolled) return { kind: 'new' };
  const p = pace(plan);
  if (!p) return null;
  if (p.full) return { kind: 'runsOut', full: p.full, before: Date.parse(week.resets) - Date.parse(p.full) };
  return { kind: 'ends', percent: Math.round(p.atReset), tone: p.atReset >= 90 ? 'warning' : 'success' };
}

/** The pace the planner's own advice uses. */
export const pace = (plan: Plan) => plan.week?.average ?? plan.week?.recent ?? null;

/** Red when the week runs out before its reset, yellow when it ends close to full. */
export function weekTone(plan: Plan): Tone {
  const p = pace(plan);
  if (p?.full) return 'error';
  if ((p?.atReset ?? 0) >= 90) return 'warning';
  return 'success';
}

const tenth = (n: number) => Math.round(n * 10) / 10;

/**
 * The open 5-hour window in percent an hour: what lasts until its reset, and the pace now.
 * null while no window is open.
 */
export function sessionPace(plan: Plan, now: number) {
  const five = plan.five;
  if (!five?.open || !five.resets) return null;
  const hoursLeft = Math.max(Date.parse(five.resets) - now, 10 * 60_000) / HOUR;
  return {
    budget: tenth(Math.max(0, 100 - (five.used ?? 0)) / hoursLeft),
    perHour: tenth(Math.max(0, five.perHour ?? 0)),
    atReset: five.atReset ?? five.used ?? 0,
    full: five.full ?? null,
  };
}
