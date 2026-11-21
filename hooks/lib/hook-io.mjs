// The frame every hook repeats: read the event once, honour the off switch, fail open, tell if this file is the
// script being run, and write the answers Claude Code understands. A hook never imports another hook; hooks and
// skill scripts import only from hooks/lib/.
//   runHook("find-guard", (event) => { ... });   // FIND_GUARD=off (any case) ends it before stdin is read
// The off switch is the hook's name in capitals with "-" as "_" (verify-gate -> VERIFY_GATE); {off: "OTHER_NAME"}
// names another one, {projectSettings: true} also looks in the project's settings env (settings-env.mjs).
// A thrown error is crash-logged and the hook ends with exit 0, so the call goes through. Input that is not a JSON
// object is the same, unless {exitOnBadInput: true}: then a message on stderr and exit 2.
// {failClosed: true} (guards wired with onFailure "block"): a thrown error or bad input is crash-logged, said on
// stderr and ends with exit 1, so Claude Code's onFailure decides; with "block" the call is stopped.
// fn may be async; a number it returns becomes the exit code.
// Inside hooks/dispatch.mjs (several hooks in one Node process) `dispatch.on` is true: runHook leaves the crash
// handlers to the dispatcher and puts its promise in `dispatch.runs`, so the dispatcher waits for it. There
// process.exit throws a HookExit instead of ending the process; runHook takes it as the hook's normal end, with
// its exit code, and a hook that catches errors itself passes it on (`if (err instanceof HookExit) throw err`).
// Modes, so a new gate can first log what it would refuse: the same variable takes off | observe | enforce (any
// case). Empty is the hook's default: {mode: "observe"} in runHook, else enforce. Any other value
// (DELETE_GUARD=on, VERIFY_GATE=warn) is enforce, so it keeps its old meaning. An arm of a hook has its
// own variable and default:
//   emit.block(reason, { arm: "commit", mode: "observe" })   // reads VERIFY_GATE_COMMIT
// Order for an arm: its variable, then the hook's variable when that is observe or enforce, then the arm default,
// then the hook default. An arm set to off drops that refusal silently.
// In observe, emit.deny and emit.block write nothing on stdout, so the call goes through, and append one line to
// ~/.claude/hooks/state/observe.jsonl instead (renamed to observe.1.jsonl at 1 MB; a failed append is crash-logged
// and the hook ends quietly). workers/observe-log.mjs prints it. emit.context writes in every mode but off. The
// hook's own state is written as in enforce, so the log counts what enforce would do. hookMode() returns the mode
// for a hook that skips work in observe. observeLine() writes a line the hook chooses, with extra fields, in
// observe and enforce: verify-gate's commit check logs every commit it checks.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crashLog, installCrashHandlers } from "./crash-log.mjs";
import { setting } from "./settings-env.mjs";

export const offName = (name) => name.toUpperCase().replace(/-/g, "_");

const MODES = ["off", "observe", "enforce"];
const OBSERVE_CAP = 1024 * 1024;
// The hook runHook is running and the event it read, so emit knows whose refusal it logs
let running = null;

// What process.exit throws while hooks/dispatch.mjs runs a hook: the hook ended, with this exit code
export class HookExit extends Error {
  constructor(code) {
    super(`process.exit(${code ?? ""})`);
    this.code = code;
  }
}
// Set by hooks/dispatch.mjs only. begin() before each hook: no earlier hook's runs or running state. code(n) takes
// runHook's exit code for the hook the work belongs to: process.exitCode is one for the whole process, so work a
// hook left running would set it for the hook running then.
export const dispatch = {
  on: false,
  runs: [],
  code: null,
  begin() {
    running = null;
    this.runs = [];
  },
};
const setCode = (code) => {
  if (dispatch.on) dispatch.code(code);
  else process.exitCode = code;
};
// A hook that ended with process.exit inside fn: its code becomes the exit code, as process.exit would make it
const exited = (err) => {
  if (!(err instanceof HookExit)) return false;
  if (err.code !== undefined) setCode(err.code);
  return true;
};

const read = (variable, projectSettings) =>
  (projectSettings
    ? setting(variable)
    : process.env[variable] || ""
  ).toLowerCase();
// "" stays "" (use the default); a value that is not a mode is enforce
const asMode = (value) =>
  !value ? "" : MODES.includes(value) ? value : "enforce";

function modeOf(variable, projectSettings, hookDefault, arm, armDefault) {
  const value = read(variable, projectSettings);
  if (!arm) return asMode(value) || hookDefault;
  if (value === "off") return "off";
  return (
    asMode(read(`${variable}_${offName(arm)}`, projectSettings)) ||
    (value === "observe" || value === "enforce" ? value : "") ||
    armDefault ||
    hookDefault
  );
}

// `mode` is the default of what is asked: the arm's when `arm` is given, else the hook's. Inside the running hook
// of that name, its variable, settings lookup and default are used unless given here.
export function hookMode(name, { arm, mode, projectSettings, off } = {}) {
  const own = running?.name === name ? running : null;
  const hookDefault = (!arm && mode) || own?.mode || "enforce";
  return modeOf(
    off || own?.variable || offName(name),
    projectSettings ?? own?.projectSettings ?? false,
    hookDefault,
    arm,
    arm ? mode : undefined,
  );
}

export function runHook(
  name,
  fn,
  {
    exitOnBadInput = false,
    failClosed = false,
    off,
    projectSettings = false,
    mode = "enforce",
  } = {},
) {
  if (!dispatch.on) installCrashHandlers();
  if (!MODES.includes(mode))
    throw new Error(
      `${name}: mode "${mode}" is not one of ${MODES.join(", ")}`,
    );
  const variable = off || offName(name);
  if (read(variable, projectSettings) === "off") return Promise.resolve();
  running = { name, variable, projectSettings, mode, event: null };
  const fail = (err) => {
    crashLog(name, err);
    process.stderr.write(
      `[${name}] The check itself failed (${err.message}). Set ${variable}=off to bypass.\n`,
    );
    setCode(1);
  };
  const run = (async () => {
    let event;
    try {
      event = JSON.parse(fs.readFileSync(0, "utf8"));
      if (!event || typeof event !== "object" || Array.isArray(event))
        throw new Error("hook input is not a JSON object");
    } catch (err) {
      if (exitOnBadInput) {
        process.stderr.write(
          `[${name}] Could not read the hook input as JSON (${err.message}). Set ${variable}=off to bypass.\n`,
        );
        setCode(2);
      } else if (failClosed) {
        fail(err);
      } else {
        crashLog(name, err);
        setCode(0);
      }
      return;
    }
    running.event = event;
    try {
      const code = await fn(event);
      if (typeof code === "number") setCode(code);
    } catch (err) {
      if (exited(err)) return;
      if (failClosed) return fail(err);
      crashLog(name, err);
      setCode(0);
    }
  })();
  if (dispatch.on) dispatch.runs.push(run);
  return run;
}

// Is this file the script being run? By real path, so a link or a letter-case difference still counts, and a
// file whose name only ends the same (x-foo.mjs for foo.mjs) does not.
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
export function isMain(importMetaUrl) {
  return (
    Boolean(process.argv[1]) &&
    real(process.argv[1]).toLowerCase() ===
      real(fileURLToPath(importMetaUrl)).toLowerCase()
  );
}

// Auto mode: the event's permission_mode is "auto" (Nimbalyst with "uses classifier" on). A classifier reviews each
// tool call there, and a hook's updatedInput voids that review, so a hook that would rewrite a call gives its note as
// additionalContext instead.
export const autoMode = (event) => event?.permission_mode === "auto";

// No variable names Nimbalyst for a hook; the entry point is "sdk-..." in an app, "cli" in the terminal
export const inNimbalyst = () =>
  /^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "");

// Returns nothing: runHook turns a returned number into the exit code, and writeSync returns a byte count,
// so `return emit.deny(...)` once exited non-zero (2026-11-12).
const out = (obj) => {
  fs.writeSync(1, JSON.stringify(obj));
};
// Outside runHook (a test, a script) there is no running hook: the refusal is written, as before modes
function refuse(would, reason, { arm, mode } = {}, obj) {
  const now = running ? hookMode(running.name, { arm, mode }) : "enforce";
  if (now === "enforce") return out(obj);
  if (now === "observe") observe(would, reason, arm);
}
const BASE_FIELDS = [
  "t",
  "hook",
  "arm",
  "session",
  "agent",
  "cwd",
  "would",
  "reason",
];
// One log line for a gate that logs each check it makes, passes too, in observe and in enforce (not when off):
//   observeLine("verified", "a.js", { arm: "commit", mode: "observe", fields: { repo: "C:/x" } })
// `fields` go after the usual ones; one with a usual name throws. Only inside runHook.
export function observeLine(would, reason, { arm, mode, fields = {} } = {}) {
  if (!running) throw new Error("observeLine is called outside runHook");
  const taken = Object.keys(fields).filter((k) => BASE_FIELDS.includes(k));
  if (taken.length)
    throw new Error(`observeLine: ${taken.join(", ")} is a usual field`);
  if (hookMode(running.name, { arm, mode }) === "off") return;
  observe(would, reason, arm, fields);
}
function observe(would, reason, arm, fields = {}) {
  try {
    const dir = path.join(os.homedir(), ".claude", "hooks", "state");
    const file = path.join(dir, "observe.jsonl");
    fs.mkdirSync(dir, { recursive: true });
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    if (size >= OBSERVE_CAP)
      fs.renameSync(file, path.join(dir, "observe.1.jsonl"));
    const { event } = running;
    const line = {
      t: new Date().toISOString(),
      hook: running.name,
      arm: arm || null,
      session: event?.session_id ?? null,
      agent: event?.agent_id ?? null,
      cwd: event?.cwd ? String(event.cwd).replace(/\\/g, "/") : null,
      would,
      reason: String(reason).slice(0, 300),
      ...fields,
    };
    fs.appendFileSync(file, `${JSON.stringify(line)}\n`);
  } catch (err) {
    crashLog(running.name, err);
  }
}
export const emit = {
  deny: (reason, opts) =>
    refuse("deny", reason, opts, {
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: reason,
      },
    }),
  block: (reason, opts) =>
    refuse("block", reason, opts, { decision: "block", reason }),
  context: (eventName, text) =>
    out({
      hookSpecificOutput: { hookEventName: eventName, additionalContext: text },
    }),
};
