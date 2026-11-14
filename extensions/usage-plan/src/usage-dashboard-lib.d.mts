// Types for the copy of usage-dashboard-lib.mjs next to this file. The data is the build's JSON, so it stays loose.
/* eslint-disable @typescript-eslint/no-explicit-any */
export const esc: (s: unknown) => string;
export const fmt: (n: number) => string;
export const pct: (a: number, b: number) => string;
export const plural: (n: number, word: string) => string;
export const sum: <T>(arr: T[], f: (x: T) => number) => number;
export const pad: (n: number) => string;
export const dayKey: (d: Date) => string;
export const fmtDay: (k: string) => string;
export const fmtTime: (iso: string | null | undefined) => string;
export const fmtWhen: (iso: string) => string;
export const modelName: (m: string) => string;
export const topModel: (
  models: Record<string, number> | null | undefined,
) => string;
export const leaf: (p: unknown) => string;
export const fmtUsd: (n: number) => string;
export const pts: (n: number) => string;
export const flat: (days: any) => Record<string, number>;
export function prepareData(D: any, now?: Date): string[];
/** A plan week from P.weeks (newest first), times in ms; stop is where the window really ended (an early reset can cut it before end). */
export interface PlanWeek {
  end: number;
  start: number;
  stop?: number;
  first: number;
  last: number;
  samples: number;
  total: number;
  mine: number | null;
  other: number | null;
  idle: number;
  partial: boolean;
  era: number;
  g?: number;
}
export interface WeekRange {
  key: string;
  label: string;
  title: string;
  week: PlanWeek;
}
export const weekKey: (w: PlanWeek) => string;
export const weekSpan: (w: PlanWeek) => string;
export function weekRanges(P: any, now?: Date): WeekRange[];
export function weekNote(w: PlanWeek): string;
export const weekDaysOf: (allDays: string[], w: PlanWeek) => string[];
export function rangeDaysOf(
  allDays: string[],
  range: number | "all" | string,
  P?: any,
): string[];
export const tok: (u: any, days: Set<string>) => number;
export const usd: (u: any, days: Set<string>) => number;
export function chatRows(
  sessions: any[],
  days: Set<string>,
  f: { project: string | null; type: string | null; q: string },
  skip?: "project" | "type",
): any[];
export function codexRunsOf(
  rs: any[],
  codexSessions: any[],
  days: Set<string>,
  q: string,
): any[];
export function geminiRunsOf(
  conversations: any[],
  days: Set<string>,
  q: string,
): any[];
export function planFor(
  P: any,
  days: Set<string>,
  week?: PlanWeek,
): {
  total: number;
  other: number;
  idle: number;
  any: boolean;
  mine: number;
  split?: boolean;
};
export const otherTokensFor: (
  P: any,
  shared: boolean,
  filtered: boolean,
  d: string,
) => number;
export function niceMax(v: number): number;
