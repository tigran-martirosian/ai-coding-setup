// Makes ccpool's background program start at log-on, and starts it now.
// Run: node logon-start.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const HOME = os.homedir();
const PLATFORM = process.env.SHARED_USAGE_PLATFORM || process.platform;
const DRY = process.env.SHARED_USAGE_DRY === "1";
const APPDATA = process.env.APPDATA || path.join(HOME, "AppData", "Roaming");
const VBS = path.join(APPDATA, "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "ccpool.vbs");
const LABEL = "com.ai-coding-setup.ccpool";
const PLIST = path.join(HOME, "Library", "LaunchAgents", `${LABEL}.plist`);

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const q = (a) => (/[\s"]/.test(a) ? `"${a}"` : a);

// Runs a command. In dry mode only prints it. With `optional` a failure is not an error.
function run(cmd, args, optional = false) {
  if (DRY) {
    console.log(`would run: ${[cmd, ...args].map(q).join(" ")}`);
    return;
  }
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (optional) return;
  if (r.error) fail(`${cmd} failed: ${r.error.message}`);
  if (r.status !== 0) fail(`${cmd} failed: ${(r.stderr || r.stdout || `exit code ${r.status}`).trim()}`);
}

// The real file behind the `ccpool` command. A launch agent starts without the shell's PATH,
// so it gets node and this file by their full paths.
function ccpoolScript() {
  if (DRY) return "/usr/local/lib/node_modules/ccpool/dist/cli.js";
  const r = spawnSync("which", ["ccpool"], { encoding: "utf8" });
  const found = (r.stdout || "").trim();
  if (r.status !== 0 || !found) fail("ccpool was not found. Install it first: npm install -g ccpool");
  return fs.realpathSync(found);
}

if (PLATFORM === "win32") {
  fs.mkdirSync(path.dirname(VBS), { recursive: true });
  fs.writeFileSync(VBS, `CreateObject("WScript.Shell").Run "cmd /c ccpool daemon start", 0, False\r\n`);
  run("wscript", [VBS]);
  console.log(`Start at log-on is set: ${VBS}`);
} else if (PLATFORM === "darwin") {
  const script = ccpoolScript();
  fs.mkdirSync(path.dirname(PLIST), { recursive: true });
  fs.writeFileSync(
    PLIST,
    `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>${script}</string>
    <string>daemon</string>
    <string>start</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>AbandonProcessGroup</key><true/>
</dict>
</plist>
`,
  );
  run("launchctl", ["unload", "-w", PLIST], true);
  run("launchctl", ["load", "-w", PLIST]);
  console.log(`Start at log-on is set: ${PLIST}`);
} else {
  console.log("This system has no start at log-on set up here: after a restart of the computer, run `ccpool daemon start`.");
}
