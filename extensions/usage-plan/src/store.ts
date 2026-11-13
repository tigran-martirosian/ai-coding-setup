// One shared copy of the planner's numbers for the gutter button and the panel.

import { script } from './command';
import type { Plan } from './format';

interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}
export type Exec = (command: string, options?: { timeout?: number }) => Promise<ExecResult>;

export interface Shared {
  setUp: boolean;
  members?: { name: string; me: boolean; five: number | null; week: number | null; active: boolean }[];
}

export interface State {
  plan: Plan | null;
  shared: Shared | null;
  error: string;
  loading: boolean;
}

const EXTENSION_ID = 'com.local.usageplan';
const REFRESH_MS = 5 * 60_000;

// The gutter button is drawn before any panel host exists, so until the panel is opened the
// numbers come through the same call host.exec makes. If the app ever changes that call, the
// button shows its plain icon until the panel is opened once.
const direct: Exec = (command, options) =>
  (window as unknown as { electronAPI: { invoke: (channel: string, args: unknown) => Promise<ExecResult> } }).electronAPI.invoke(
    'extension:exec',
    { extensionId: EXTENSION_ID, command, timeout: options?.timeout }
  );

let exec: Exec = direct;
let state: State = { plan: null, shared: null, error: '', loading: false };
let timer: ReturnType<typeof setInterval> | undefined;
const listeners = new Set<() => void>();

const set = (patch: Partial<State>) => {
  state = { ...state, ...patch };
  for (const listener of listeners) listener();
};

const lastLine = (r: ExecResult) => r.stderr.trim().split('\n').pop() || `exit ${r.exitCode}`;

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
    const r = await exec(script('plan-ahead.mjs', '--json'), { timeout: 30_000 });
    if (!r.success) throw new Error(lastLine(r));
    set({ plan: JSON.parse(r.stdout), error: '' });
    const sh = await exec(script('shared-usage.mjs'), { timeout: 30_000 });
    if (!sh.success) throw new Error(lastLine(sh));
    set({ shared: JSON.parse(sh.stdout), loading: false });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e), loading: false });
  }
}

/** Builds the full dashboard page and opens it in the browser. */
export async function openDashboard() {
  try {
    const r = await exec(script('usage-dashboard.mjs'), { timeout: 120_000 });
    if (!r.success) set({ error: lastLine(r) });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
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
