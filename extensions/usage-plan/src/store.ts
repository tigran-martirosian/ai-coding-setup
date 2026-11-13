// One shared copy of the planner's numbers for the panel and the popover.

import { hostExec, hostInvoke } from "../../shared/host.ts";
import { script } from "./command";
import { failureLine } from "./format";
import type { Plan } from "./format";
import { t } from "./strings";

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}
export type Exec = (
  command: string,
  options?: { timeout?: number },
) => Promise<ExecResult>;

export interface State {
  plan: Plan | null;
  /** A plain sentence about the numbers (what to do next); the technical reason goes to the console. */
  error: string;
  loading: boolean;
}

const EXTENSION_ID = "com.local.usageplan";
const REFRESH_MS = 5 * 60_000;

// The popover is drawn before any panel host exists, so until the panel is opened the
// numbers come through the same call host.exec makes.
const direct: Exec = (command, options) =>
  hostExec<ExecResult>(hostInvoke, EXTENSION_ID, command, options?.timeout);

let exec: Exec = direct;
let state: State = { plan: null, error: "", loading: false };
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

export const getState = () => state;

export function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** The panel hands over its host's exec once it is mounted. */
export function setExec(hostExec: Exec) {
  exec = hostExec;
}

export async function refresh() {
  if (state.loading) return;
  set({ loading: true });
  try {
    const r = await exec(script("plan-ahead.mjs", "--json"), {
      timeout: 30_000,
    });
    if (!r.success) throw new Error(failureLine(r.stderr, t.refreshFailed));
    set({ plan: JSON.parse(r.stdout), error: "", loading: false });
  } catch (e) {
    console.warn(
      "[usageplan] refresh:",
      e instanceof Error ? e.message : String(e),
    );
    set({ error: t.refreshFailed, loading: false });
  }
}

export function start() {
  if (timer) return;
  refresh();
  timer = setInterval(refresh, REFRESH_MS);
}

export function stop() {
  if (timer) clearInterval(timer);
  timer = undefined;
}
