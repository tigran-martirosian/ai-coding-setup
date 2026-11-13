// The frame every hook repeats: read the event once, honour the off switch, fail open, tell if this file is the
// script being run, and write the answers Claude Code understands. A hook never imports another hook; hooks and
// skill scripts import only from hooks/lib/.
//   runHook("big-read-gate", (event) => { ... });   // BIG_READ_GATE=off (any case) ends it before stdin is read
// The off switch is the hook's name in capitals with "-" as "_" (cold-cache -> COLD_CACHE); {off: "HANDOFF_HOOK"}
// names another one, {projectSettings: true} also looks in the project's settings env (settings-env.mjs).
// A thrown error is crash-logged and the hook ends with exit 0, so the call goes through. Input that is not a JSON
// object is the same, unless {exitOnBadInput: true} (decided-quote): then a message on stderr and exit 2.
// fn may be async; a number it returns becomes the exit code.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { crashLog, installCrashHandlers } from "./crash-log.mjs";
import { setting } from "./settings-env.mjs";

export const offName = (name) => name.toUpperCase().replace(/-/g, "_");

export function runHook(name, fn, { exitOnBadInput = false, off, projectSettings = false } = {}) {
  installCrashHandlers();
  const variable = off || offName(name);
  const value = projectSettings ? setting(variable) : process.env[variable] || "";
  if (value.toLowerCase() === "off") return Promise.resolve();
  return (async () => {
    let event;
    try {
      event = JSON.parse(fs.readFileSync(0, "utf8"));
      if (!event || typeof event !== "object" || Array.isArray(event)) throw new Error("hook input is not a JSON object");
    } catch (err) {
      if (exitOnBadInput) {
        process.stderr.write(`[${name}] Could not read the hook input as JSON (${err.message}). Set ${variable}=off to bypass.\n`);
        process.exitCode = 2;
      } else {
        crashLog(name, err);
        process.exitCode = 0;
      }
      return;
    }
    try {
      const code = await fn(event);
      if (typeof code === "number") process.exitCode = code;
    } catch (err) {
      crashLog(name, err);
      process.exitCode = 0;
    }
  })();
}

// Is this file the script being run? By real path, so a link or a letter-case difference still counts, and a
// file whose name only ends the same (x-foo.mjs for foo.mjs) does not.
const real = (p) => { try { return fs.realpathSync.native(p); } catch { return path.resolve(p); } };
export function isMain(importMetaUrl) {
  return Boolean(process.argv[1]) && real(process.argv[1]).toLowerCase() === real(fileURLToPath(importMetaUrl)).toLowerCase();
}

// No variable names Nimbalyst for a hook; the entry point is "sdk-..." in an app, "cli" in the terminal
export const inNimbalyst = () => /^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "");

const out = (obj) => fs.writeSync(1, JSON.stringify(obj));
export const emit = {
  deny: (reason) => out({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }),
  block: (reason) => out({ decision: "block", reason }),
  context: (eventName, text) => out({ hookSpecificOutput: { hookEventName: eventName, additionalContext: text } }),
};
