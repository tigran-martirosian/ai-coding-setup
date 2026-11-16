// Keeps the PC program running: started by the Startup script at log-on, it starts main.mjs and starts it again
// when it ends, after 5 s, then twice as long after each quick end, up to 60 s. A run of 60 s or more counts as
// healthy and sets the wait back to 5 s. When the program ends with STOP_CODE (another copy already runs, or a
// wanted stop) this process ends too. No scheduled task: Windows Defender flags a task that starts a script.
// Run: node keep.mjs (written into the Startup script by setup.mjs)
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log } from "./core/log.mjs";
import { testOverride } from "./core/mode.mjs";

export const STOP_CODE = 77;
const FIRST_WAIT_MS = 5_000;
const MAX_WAIT_MS = 60_000;
const HEALTHY_MS = 60_000;

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);

function keep(child) {
  let wait = FIRST_WAIT_MS;
  const startOnce = () => {
    const began = Date.now();
    const p = spawn(process.execPath, [child], {
      stdio: "ignore",
      windowsHide: true,
      shell: false,
    });
    p.on("error", (e) => {
      log("keep", `cannot start the program: ${e.message}`);
      process.exit(1);
    });
    p.on("exit", (code, signal) => {
      if (code === STOP_CODE) {
        log("keep", "the program stopped on purpose: keep-alive ends");
        process.exit(0);
      }
      if (Date.now() - began >= HEALTHY_MS) wait = FIRST_WAIT_MS;
      log(
        "keep",
        `the program ended (${signal || `code ${code}`}): start again in ${wait / 1000} s`,
      );
      setTimeout(startOnce, wait);
      wait = Math.min(wait * 2, MAX_WAIT_MS);
    });
  };
  startOnce();
}

// Runs only as the started script; main.mjs imports STOP_CODE from here.
if (path.resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase())
  keep(testOverride("PHONE_PC_KEEP_CHILD") || path.join(HERE, "main.mjs"));
