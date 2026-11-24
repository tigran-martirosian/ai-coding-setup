// Reads the map file and the path check. The panel calls `read` when it opens and every REFRESH_MS while it is open.

import type { Invoke } from "../../shared/host.ts";
import { hostError, readHostFile, startSession } from "../../shared/host.ts";
import type { Check, Loaded } from "./map.ts";
import { classify, MAP_REL, parseCheck } from "./map.ts";

export interface ExecResult {
  success: boolean;
  stdout: string;
  stderr: string;
  exitCode: number;
}
export type Exec = (
  command: string,
  options?: ReturnType<typeof trusted>,
) => Promise<ExecResult>;

export interface Snapshot {
  loaded: Loaded;
  /** null when there is no map to check, or the check could not run. */
  check: Check | null;
  /** The file's text plus the check output: two snapshots with the same key look the same. */
  key: string;
}

export const REFRESH_MS = 60_000;
const CHECK_TIMEOUT_MS = 30_000;

// The ~/.claude folder of the person who built the extension, set by vite.config.ts.
declare const __CLAUDE_DIR__: string;

/**
 * The exec options of the check. Nimbalyst runs a command in the open project unless told otherwise,
 * and on Windows cmd.exe looks for `node` in the current folder before PATH, so a project's own
 * node.cmd would run instead of Node.js. So the check runs in ~/.claude (--project carries the
 * project), and NoDefaultCurrentDirectoryInExePath (passed here; Nimbalyst merges it into the child's environment)
 * stops cmd.exe from searching the current folder at all.
 */
export const trusted = (options: { timeout: number }, workspace = "") => ({
  ...options,
  cwd: __CLAUDE_DIR__,
  env: { NoDefaultCurrentDirectoryInExePath: "1", MAP_PROJECT: workspace },
});

const missing = (e: unknown) =>
  /ENOENT|no such file/i.test(String((e as Error)?.message ?? e));

/** `map.mjs --check` for one project. The project folder comes in through the MAP_PROJECT environment variable
 * (see trusted), never on the command line, so no folder name can be read by cmd.exe as % or quote syntax. */
export const checkCommand = (_workspace?: string) =>
  `node -e "const p=require('path'),o=require('os');require('child_process').spawnSync(process.execPath,[p.join(o.homedir(),'.claude','skills','systems-map','map.mjs'),'--project',process.env.MAP_PROJECT,'--check'],{stdio:'inherit'})"`;

/** Reads the file and, for a real map, the check. A read that fails for any reason but "no such file" throws. */
export async function read(
  workspace: string,
  invoke: Invoke,
  exec: Exec,
): Promise<Snapshot> {
  const file = `${workspace.replace(/\\/g, "/").replace(/\/+$/, "")}/${MAP_REL}`;
  let raw: string | null;
  try {
    raw = await readHostFile(invoke, file);
  } catch (e) {
    if (!missing(e)) throw new Error(hostError(e));
    raw = null;
  }
  const loaded = classify(raw);
  let check: Check | null = null;
  let out = "";
  if (loaded.kind === "map") {
    try {
      out = (
        await exec(
          checkCommand(),
          trusted({ timeout: CHECK_TIMEOUT_MS }, workspace.replace(/\\/g, "/")),
        )
      ).stdout;
      check = parseCheck(out);
    } catch {
      check = null; // the map still shows; the caption says the check did not run
    }
  }
  return { loaded, check, key: `${raw}\u0000${out}` };
}

/** Starts the "Build a map" session. Returns '' once it is running, or the reason the app refused. */
export function build(
  invoke: Invoke,
  sessionName: string,
  wait?: number,
): Promise<string> {
  return startSession(invoke, "/systems-map", sessionName, wait);
}
