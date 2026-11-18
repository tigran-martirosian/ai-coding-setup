// Test and dry modes. PHONE_PC_DRY=1 starts nothing and registers nothing on the system: it only says what it
// would do. PHONE_PC_TEST=1 lets a test point the program at its own pipe, keys and page list; outside test mode
// those variables are ignored.
// The second PC program (a test copy beside the real one, phone/README.md): PHONE_PC_TEST=1 with PHONE_PC_APP_DIR
// (its own folder for keys, state and log) and PHONE_PC_PIPE (its own pipe). It writes no log-on entry.
import os from "node:os";
import path from "node:path";

export const DRY = process.env.PHONE_PC_DRY === "1";
export const TEST = process.env.PHONE_PC_TEST === "1";

export const testOverride = (name) => (TEST ? process.env[name] || null : null);

// True for the second PC program. Its own folder without its own pipe would stop or talk to the real program.
export const SECOND = Boolean(testOverride("PHONE_PC_APP_DIR"));
if (SECOND && !testOverride("PHONE_PC_PIPE"))
  throw new Error(
    "PHONE_PC_APP_DIR is set without PHONE_PC_PIPE: the second PC program needs its own pipe too",
  );

// The app folder: keys, state, log. ~/.phone-app unless the second PC program names its own.
// A test copy pointed at the real folder would use and overwrite the real program's keys and state.
const ownAppDir = testOverride("PHONE_PC_APP_DIR");
if (
  ownAppDir &&
  path.relative(
    path.join(os.homedir(), ".phone-app"),
    path.resolve(ownAppDir),
  ) === ""
)
  throw new Error(
    "PHONE_PC_APP_DIR names the real ~/.phone-app: a test copy needs its own folder",
  );

export function appDir() {
  const own = testOverride("PHONE_PC_APP_DIR");
  return own ? path.resolve(own) : path.join(os.homedir(), ".phone-app");
}

// The one-copy lock and control channel of the PC program.
export function pipeName() {
  const own = testOverride("PHONE_PC_PIPE");
  if (own) return own;
  if (process.platform === "win32") return "\\\\.\\pipe\\phone-app-pc";
  return path.join(os.homedir(), ".phone-app", "pc.sock");
}
