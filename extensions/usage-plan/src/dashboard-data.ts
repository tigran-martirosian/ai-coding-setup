// The dashboard's data rules without React: what a good file looks like, when it is stale, and the
// states the panel moves through. The panel (dashboard.tsx) only runs the commands and draws.

export const REQUIRED_KEYS = [
  "generated",
  "builtAt",
  "computer",
  "sessions",
  "plan",
  "shared",
  "ahead",
  "codex",
  "gemini",
] as const;
export const STALE_MS = 3_600_000;

/** The JSON the build script writes. Only builtAt is looked into here; the views read the rest. */
export interface DashboardData {
  generated: unknown;
  builtAt: string;
  computer: unknown;
  sessions: unknown;
  plan: unknown;
  shared: unknown;
  ahead: unknown;
  codex: unknown;
  gemini: unknown;
  /** How long the build that wrote the file took, in ms (written by the build; older files have none). */
  buildMs?: number;
}

/** Throws with the reason when the text is not JSON, not an object, misses a key, or has no usable builtAt. */
export function parseDashboard(text: string): DashboardData {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    throw new Error(
      `the file is not valid JSON (${e instanceof Error ? e.message : String(e)})`,
    );
  }
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("the file is not a JSON object");
  const missing = REQUIRED_KEYS.filter((key) => !(key in value));
  if (missing.length) throw new Error(`the file misses ${missing.join(", ")}`);
  const builtAt = (value as { builtAt: unknown }).builtAt;
  if (typeof builtAt !== "string" || Number.isNaN(Date.parse(builtAt)))
    throw new Error("builtAt is not a date");
  return value as DashboardData;
}

/** True when the file is more than an hour old. A builtAt in the future counts as fresh. */
export const isStale = (builtAt: string, now: number) =>
  now - Date.parse(builtAt) > STALE_MS;

/** The end (ms) of the newest plan week in the file, or null when the file has none. */
export function newestWeekEnd(data: DashboardData): number | null {
  const weeks = (data.plan as { weeks?: { end?: unknown }[] } | null)?.weeks;
  const end = weeks?.[0]?.end;
  return typeof end === "number" ? end : null;
}

/** Stale by age (over an hour), or built before the newest week's reset while that reset has now passed, so "This week" never shows last week's numbers. */
export function isDataStale(data: DashboardData, now: number): boolean {
  if (isStale(data.builtAt, now)) return true;
  const end = newestWeekEnd(data);
  return end !== null && Date.parse(data.builtAt) < end && now >= end;
}

export interface DashboardState {
  data: DashboardData | null;
  /** reading: first read under way; ready: showing data at rest; rebuilding: build under way (old data, if any, stays). */
  status: "reading" | "ready" | "rebuilding";
  /** The reason of the last failure; empty when none. */
  error: string;
}

export const initialState: DashboardState = {
  data: null,
  status: "reading",
  error: "",
};

export type DashboardEvent =
  | { type: "read-ok"; data: DashboardData }
  | { type: "read-missing" }
  | { type: "read-failed"; reason: string }
  | { type: "build-start" }
  | { type: "build-failed"; reason: string };

export function reduce(
  state: DashboardState,
  event: DashboardEvent,
): DashboardState {
  switch (event.type) {
    case "read-ok":
      return { data: event.data, status: "ready", error: "" };
    case "read-missing":
      return { ...state, status: "ready", error: "" };
    case "read-failed":
      return { ...state, status: "ready", error: event.reason };
    case "build-start":
      return { ...state, status: "rebuilding", error: "" };
    case "build-failed":
      return { ...state, status: "ready", error: event.reason };
  }
}

/** A press of Refresh or Try again starts a build only when none is running. */
export const canStartBuild = (state: DashboardState) =>
  state.status !== "rebuilding";

/** After the first read: build when there is no file or it is stale. */
export const needsBuildOnOpen = (data: DashboardData | null, now: number) =>
  data === null || isDataStale(data, now);

/** The most the bar shows while a build runs: it only reaches 100% when the build is done. */
export const PROGRESS_CAP = 0.95;

/** How far a running build is, 0 to 0.95, from the time it has run and the last build's time; null when the last time is unknown. */
export function progressFraction(
  elapsedMs: number,
  buildMs: number | undefined,
): number | null {
  if (typeof buildMs !== "number" || !(buildMs > 0)) return null;
  return Math.min(PROGRESS_CAP, Math.max(0, elapsedMs / buildMs));
}
