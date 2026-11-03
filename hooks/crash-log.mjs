// Crash trace, shared by every hook. A hook that crashes must still let the call through (fail open), but a dead
// hook must not look like a quiet one, so the crash leaves one line in hooks/state/hook-errors.log:
//   <ISO time> <hook name>: <message>
// Each hook calls crashLog("<name>", err) from its outermost catch only; a catch that deliberately skips a bad line,
// a missing file or a probe stays silent. crashLog never throws. Importing this file from a hook also installs
// uncaughtException and unhandledRejection handlers (a crash outside any catch) that log the same way and then
// end as Node does without them: the stack on stderr and exit code 1.
// transcript-check.mjs reads the log at session start and says out loud when a new line has appeared.
// HOOK_ERRORS_LOG=off writes nothing (the tests set it, so their junk input leaves no trace); any other value is
// the log's path instead of the default.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const setting = process.env.HOOK_ERRORS_LOG || "";
export const CRASH_LOG = setting && setting !== "off" ? setting : path.join(os.homedir(), ".claude", "hooks", "state", "hook-errors.log");

export function crashLog(hook, err) {
  try {
    if (setting === "off") return;
    const message = String(err?.message || err).replace(/\s+/g, " ").trim().slice(0, 300);
    fs.mkdirSync(path.dirname(CRASH_LOG), { recursive: true });
    fs.appendFileSync(CRASH_LOG, `${new Date().toISOString()} ${hook}: ${message}\n`);
  } catch {
    // nothing more to do
  }
}

// Only when a hook is the script being run (a test that imports a hook's functions keeps its own error handling)
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const here = path.dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && same(path.dirname(process.argv[1]), here)) {
  const hook = path.basename(process.argv[1]).replace(/\.mjs$/, "");
  const die = (err) => {
    crashLog(hook, err);
    try { process.stderr.write(`${err?.stack || err}\n`); } catch { /* nothing more to do */ }
    process.exit(1);
  };
  process.on("uncaughtException", die);
  process.on("unhandledRejection", die);
}
