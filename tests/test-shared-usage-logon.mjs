// Tests for skills/shared-usage/logon-start.mjs (dry mode: nothing is started).
// Run: node tests/test-shared-usage-logon.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("../skills/shared-usage/logon-start.mjs", import.meta.url));

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};

const home = fs.mkdtempSync(path.join(os.tmpdir(), "shared-usage-logon-"));

function run(platform) {
  const env = {
    ...process.env,
    USERPROFILE: home,
    HOME: home,
    APPDATA: path.join(home, "AppData", "Roaming"),
    SHARED_USAGE_DRY: "1",
    SHARED_USAGE_PLATFORM: platform,
  };
  const r = spawnSync(process.execPath, [SCRIPT], { encoding: "utf8", env });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
}

try {
  let r = run("win32");
  const vbs = path.join(home, "AppData", "Roaming", "Microsoft", "Windows", "Start Menu", "Programs", "Startup", "ccpool.vbs");
  check("win32 writes the start file", fs.existsSync(vbs), r.out);
  check("win32 start file runs the daemon hidden", fs.readFileSync(vbs, "utf8").includes('"cmd /c ccpool daemon start", 0, False'));
  check("win32 only prints wscript", r.code === 0 && r.out.includes("would run: wscript"), r.out);
  check("win32 says it is set", r.out.includes("Start at log-on is set"), r.out);

  r = run("darwin");
  const plist = path.join(home, "Library", "LaunchAgents", "com.ai-coding-setup.ccpool.plist");
  check("darwin writes a launch agent", fs.existsSync(plist), r.out);
  const xml = fs.readFileSync(plist, "utf8");
  check("darwin starts node by its full path", xml.includes(`<string>${process.execPath}</string>`), xml);
  check("darwin runs daemon start", /cli\.js<\/string>\s*<string>daemon<\/string>\s*<string>start<\/string>/.test(xml), xml);
  check("darwin runs at log-on", xml.includes("<key>RunAtLoad</key><true/>"), xml);
  check("darwin only prints launchctl", r.out.includes("would run: launchctl load -w"), r.out);
  check("darwin says it is set", r.code === 0 && r.out.includes("Start at log-on is set"), r.out);

  r = run("linux");
  check("linux says how to start again", r.code === 0 && r.out.includes("run `ccpool daemon start`"), r.out);
  check("linux does not claim it is set", !r.out.includes("Start at log-on is set"), r.out);
} finally {
  fs.rmSync(home, { recursive: true, force: true });
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
