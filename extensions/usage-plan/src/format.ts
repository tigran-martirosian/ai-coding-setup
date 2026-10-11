// Pure helpers: the planner's JSON shape and how its values are worded on screen.

import { t } from './strings.ts';

export interface Pace {
  perDay: number;
  atReset: number;
  full: string | null;
}

export interface Plan {
  status: string;
  at?: string;
  week?: { used: number; resets: string; rolled: boolean; budget: number; today?: number; average: Pace | null; recent: Pace | null };
  five?: { open: boolean; used?: number; resets?: string; perHour?: number; atReset?: number; full?: string | null };
}

export type Tone = 'success' | 'warning' | 'error';

const HOUR = 3_600_000;
export const WEEK_MS = 7 * 24 * HOUR;
export const FIVE_MS = 5 * HOUR;

/** "Tue 12:11 AM" */
export const when = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleString(t.locale, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';

/** "11:52 AM" */
export const clock = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleTimeString(t.locale, { hour: 'numeric', minute: '2-digit' }) : '';

/** "5d 10h", "2h 5m", "12m" */
export function span(ms: number) {
  const minutes = Math.max(0, Math.round(ms / 60_000));
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d}${t.day} ${h}${t.hour}`;
  if (h) return `${h}${t.hour} ${m}${t.minute}`;
  return `${m}${t.minute}`;
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
