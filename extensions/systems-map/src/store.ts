// Reads the map file and the path check. The panel calls `read` when it opens and every REFRESH_MS while it is open.

import { MAP_REL, classify, parseCheck } from './map.ts';
import type { Check, Loaded } from './map.ts';

export type Invoke = (channel: string, args: unknown) => Promise<unknown>;
export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}
export type Exec = (command: string, options?: { timeout?: number }) => Promise<ExecResult>;

export interface Snapshot {
  loaded: Loaded;
  /** null when there is no map to check, or the check could not run. */
  check: Check | null;
  /** The file's text plus the check output: two snapshots with the same key look the same. */
  key: string;
}

export const REFRESH_MS = 60_000;
/** The model Commands starts its sessions with, whatever was picked last in the app. */
export const MODEL = 'claude-code:sonnet';
const CHECK_TIMEOUT_MS = 30_000;
// A refusal (no project open, provider off) comes back at once; the reply itself takes minutes.
const REFUSAL_MS = 2000;

const missing = (e: unknown) => /ENOENT|no such file/i.test(String((e as Error)?.message ?? e));
export const reason = (e: unknown) => String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']*': (Error: )?/, '');

/** `map.mjs --check` for one project. The project folder is an argument of node, so no shell quoting touches it. */
export const checkCommand = (workspace: string) =>
  `node -e "const p=require('path'),o=require('os');require('child_process').spawnSync(process.execPath,[p.join(o.homedir(),'.claude','skills','systems-map','map.mjs'),'--project',process.argv[1],'--check'],{stdio:'inherit'})" "${workspace.replace(/\\/g, '/')}"`;

/** Reads the file and, for a real map, the check. A read that fails for any reason but "no such file" throws. */
export async function read(workspace: string, invoke: Invoke, exec: Exec): Promise<Snapshot> {
  const file = `${workspace.replace(/\\/g, '/').replace(/\/+$/, '')}/${MAP_REL}`;
  let raw: string | null;
  try {
    raw = String(await invoke('extensions:read-file', file));
  } catch (e) {
    if (!missing(e)) throw new Error(reason(e));
    raw = null;
  }
  const loaded = classify(raw);
  let check: Check | null = null;
  let out = '';
  if (loaded.kind === 'map') {
    try {
      out = (await exec(checkCommand(workspace), { timeout: CHECK_TIMEOUT_MS })).stdout;
      check = parseCheck(out);
    } catch {
      check = null; // the map still shows; the caption says the check did not run
    }
  }
  return { loaded, check, key: `${raw}\u0000${out}` };
}

/** Starts the "Build a map" session. Returns '' once it is running, or the reason the app refused. */
export function build(invoke: Invoke, sessionName: string, wait = REFUSAL_MS): Promise<string> {
  const sent = invoke('extensions:ai-send-prompt', { prompt: '/systems-map', sessionName, model: MODEL });
  return Promise.race([
    sent.then(
      () => '',
      (e) => reason(e)
    ),
    new Promise<string>((resolve) => setTimeout(() => resolve(''), wait)),
  ]);
}
