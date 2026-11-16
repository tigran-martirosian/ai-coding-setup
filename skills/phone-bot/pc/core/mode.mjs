// Test and dry modes. PHONE_PC_DRY=1 starts nothing and registers nothing on the system: it only says what it
// would do. PHONE_PC_TEST=1 lets a test point the program at its own pipe, keys and page list; outside test mode
// those variables are ignored.
import os from "node:os";
import path from "node:path";

export const DRY = process.env.PHONE_PC_DRY === "1";
export const TEST = process.env.PHONE_PC_TEST === "1";

export const testOverride = (name) => (TEST ? process.env[name] || null : null);

// The one-copy lock and control channel of the PC program.
export function pipeName() {
  const own = testOverride("PHONE_PC_PIPE");
  if (own) return own;
  if (process.platform === "win32") return "\\\\.\\pipe\\phone-app-pc";
  return path.join(os.homedir(), ".phone-app", "pc.sock");
}
