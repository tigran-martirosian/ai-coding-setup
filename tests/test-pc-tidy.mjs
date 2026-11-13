// node tests/test-pc-tidy.mjs
// Feeds workers/pc-tidy.ps1 a made-up process and port list and checks which ones it calls leftovers.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

if (process.platform !== "win32") { console.log("skipped: Windows only"); process.exit(0); }
const SCRIPT = path.join(import.meta.dirname, "..", "workers", "pc-tidy.ps1");
const DIR = fs.mkdtempSync(path.join(os.tmpdir(), "pc-tidy-"));
const H = 60 * 60 * 1000;
const at = (hoursAgo) => new Date(Date.now() - hoursAgo * H).toISOString();
const GIT = "C:\\Program Files\\Git\\usr\\bin\\";
const p = (ProcessId, ParentProcessId, Name, hoursAgo, CommandLine = "", ExecutablePath = "") =>
  ({ ProcessId, ParentProcessId, Name, CreationDate: at(hoursAgo), CommandLine, ExecutablePath, WorkingSetSize: 50 * 1024 * 1024 });

const procs = [
  p(10, 4, "explorer.exe", 48),
  p(20, 10, "Nimbalyst.exe", 12, "Nimbalyst.exe --remote-debugging-port=9222"),
  p(21, 20, "claude.exe", 11),
  p(22, 21, "bash.exe", 10, "bash -c source shell-snapshots/x.sh", GIT + "bash.exe"),        // live session's old shell: keep
  p(23, 22, "tail.exe", 10, "tail -f run.log", GIT + "tail.exe"),                              // its watcher: keep
  // orphans, old: stop
  p(101, 9001, "bash.exe", 30, "bash -c source /c/Users/someone/.claude/shell-snapshots/s.sh", GIT + "bash.exe"),
  p(102, 9002, "tail.exe", 30, "tail -n 0 -f a.log", GIT + "tail.exe"),
  p(103, 9003, "grep.exe", 30, "grep --line-buffered err", GIT + "grep.exe"),
  p(104, 9004, "chrome.exe", 30, "chrome.exe --headless=new --user-data-dir=C:/Users/someone/.claude/browser-profiles/a --remote-debugging-port=9222"),
  p(105, 9005, "node.exe", 30, "node.exe C:\\Users\\someone\\.claude\\workers\\watch.mjs"),
  p(106, 9006, "python.exe", 30, "python.exe C:\\Users\\someone\\AppData\\Local\\Temp\\probe.py"),
  p(107, 9007, "java.exe", 30, "java -cp x org.gradle.launcher.daemon.bootstrap.GradleDaemon"),
  p(108, 50, "tail.exe", 30, "tail -f b.log", GIT + "tail.exe"),                              // starter number reused below
  p(50, 10, "notepad.exe", 1),
  // keep
  p(201, 9101, "tail.exe", 1, "tail -f c.log", GIT + "tail.exe"),                              // orphan but young
  p(202, 9102, "mintty.exe", 30, "mintty.exe", GIT + "mintty.exe"),                            // a terminal window
  p(203, 9103, "ssh-agent.exe", 30, "ssh-agent", GIT + "ssh-agent.exe"),
  p(204, 9104, "chrome.exe", 30, "chrome.exe --profile-directory=Default"),                    // a browser you see
  p(205, 9105, "chrome.exe", 30, "chrome.exe --type=renderer --headless"),                     // a browser's helper
  p(206, 9106, "node.exe", 30, "node.exe D:\\tools\\server.js"),                               // not from our work
  p(207, 9107, "Nimbalyst.exe", 30, "Nimbalyst.exe"),
  p(208, 9108, "Code.exe", 30, "Code.exe"),
  // maybe wanted: listed apart, never stopped
  p(301, 9201, "node.exe", 30, "node.exe C:\\Projects\\telegram\\inbox-bot.mjs"),
  p(302, 9202, "node.exe", 30, "node.exe C:\\Users\\someone\\AppData\\Roaming\\npm\\node_modules\\pool\\cli.js daemon run"),
];
fs.writeFileSync(path.join(DIR, "p.json"), JSON.stringify(procs));
fs.writeFileSync(path.join(DIR, "ports.json"), JSON.stringify([{ Port: 9222, Pid: 19884 }, { Port: 3456, Pid: 20 }, { Port: 445, Pid: 4 }]));

const run = (...extra) => spawnSync("powershell", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", SCRIPT,
  "-ProcessFile", path.join(DIR, "p.json"), "-PortFile", path.join(DIR, "ports.json"), ...extra], { encoding: "utf8" });
const r = run();
const out = r.stdout;
const section = (name) => (out.split(name)[1] ?? "").split(/\r?\n\r?\n/)[0];
const ids = (text) => new Set([...text.matchAll(/^\s+(\d+)\s+\d+ MB/gm)].map((m) => Number(m[1])));
const listed = ids(section("LEFTOVERS")), maybe = ids(section("MAYBE WANTED"));
let failed = 0, passed = 0;
const check = (name, ok) => { ok ? passed++ : failed++; console.log(`${ok ? "ok  " : "FAIL"} ${name}`); };

check("runs without errors", r.status === 0 && !r.stderr.trim());
for (const id of [101, 102, 103, 104, 105, 106, 107, 108]) check(`leftover ${id} (${procs.find((x) => x.ProcessId === id).Name}) is listed`, listed.has(id));
for (const id of [20, 21, 22, 23, 201, 202, 203, 204, 205, 206, 207, 208, 50]) check(`${id} (${procs.find((x) => x.ProcessId === id).Name}) is kept`, !listed.has(id));
check("each leftover says why", /\(headless browser\)/.test(out) && /\(command-line tool\)/.test(out) && /\(script from Claude or Temp\)/.test(out));
check("count line matches", /LEFTOVERS\s+8,/.test(out));
for (const id of [206, 301, 302]) check(`${id} (a bot or daemon) is only listed as maybe wanted`, maybe.has(id) && !listed.has(id));
check("nothing else is maybe wanted", maybe.size === 3);
check("names the port a closed program holds", /port 9222\s+\(program 19884, closed\)/.test(out));
check("a live program's port is not named", !/port 3456/.test(out) && !/port 445/.test(out));
const go = run("-Go");
check("-Go refuses a made-up list", go.status !== 0 || /cannot be used/.test(go.stderr + go.stdout));

fs.rmSync(DIR, { recursive: true, force: true });
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) { console.log(out); process.exit(1); }
