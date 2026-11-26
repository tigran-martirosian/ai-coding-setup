// Joins this PC to a phone app relay, pairs a phone, shows the status, sets or removes the start at log-on, and
// sets up voice (downloads the speech model once, up front).
// Run: node setup.mjs join <relay address> | pair | status | start-logon | start | restart | remove | voice
// PHONE_PC_DRY=1 writes no log-on entry, starts, stops and downloads nothing: it prints what it would do.
// The second PC program (PHONE_PC_TEST=1 with PHONE_PC_APP_DIR and PHONE_PC_PIPE, core/mode.mjs) writes no log-on
// entry and leaves the real program and the old bot alone: it is started straight from this copy's keep.mjs and
// stopped through its own pipe only.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { groupCode } from "../../../phone/shared/seal.mjs";
import {
  findUv,
  MODEL,
  MODEL_MB,
  markerPath,
  settingUp,
  settingUpPath,
  UV_ARGS,
} from "./actions/voice.mjs";
import { keyFilePath, writeText } from "./core/files.mjs";
import { createKeys, keysExist, loadKeys } from "./core/keys.mjs";
import { DRY, pipeName, SECOND, TEST, testOverride } from "./core/mode.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAIN = path.join(HERE, "main.mjs");
const KEEP = path.join(HERE, "keep.mjs");
const PLATFORM = testOverride("PHONE_PC_PLATFORM") || process.platform;
// The scheduled task of earlier versions (Windows Defender flagged it): only deleted, never made.
const OLD_TASK = "Phone app PC";
// The retired Telegram inbox bot (before 26.3): join and remove take out what it left on Windows.
const OLD_BOT = path.join(HERE, "..", "bot", "inbox-bot.mjs");
const OLD_BOT_SCRIPTS = ["phone-bot.vbs", "phone-inbox.vbs"];
const OLD_BOT_TASKS = ["Phone bot", "Phone inbox bot"];
const OLD_BOT_MARKER = "<!-- phone-bot: installed by /phone-bot -->";
const ASK_WAIT_MS = 15_000;

const USAGE = `Usage: node setup.mjs join <relay address> | pair | status | start-logon | start | restart | remove | voice
  join <address>  make this PC's keys, start at log-on, start the program and show a pairing code
  pair            show a new pairing code, to pair a phone or add a second device
  status          show the keys, the start at log-on and whether the program runs
  start-logon     set the start at log-on again (the Startup script, which starts keep.mjs; keep.mjs starts
                  the program again when it ends)
  start           start the program now through the Startup script (a second copy stops by itself)
  restart         end the running program so keep.mjs starts it again from new files (an update runs this)
  remove          stop the program and remove the start at log-on, and the old scheduled task; the keys stay
  (join and remove also take out the retired Telegram inbox bot: its process, Startup scripts, tasks, /phone skill)
  voice           download the speech model (about ${MODEL_MB} MB) once, so the phone's record button works;
                  installs uv with winget when it is missing. voice --background does it hidden and returns at once`;

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

function startupScript() {
  if (!process.env.APPDATA)
    fail("APPDATA is not set: cannot find the Startup folder");
  return path.join(
    process.env.APPDATA,
    "Microsoft",
    "Windows",
    "Start Menu",
    "Programs",
    "Startup",
    "phone-app-pc.vbs",
  );
}

const q = (a) => (/[\s"]/.test(a) ? `"${a}"` : a);

// Runs a fixed program with fixed arguments, never through a shell and with no console window (the voice setup runs
// hidden). In dry mode only prints it.
function run(cmd, args, { mayFail = false } = {}) {
  if (DRY) {
    console.log(`would run: ${[cmd, ...args].map(q).join(" ")}`);
    return { status: 0, stdout: "" };
  }
  const r = spawnSync(cmd, args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (r.error) fail(`${cmd} failed: ${r.error.message}`);
  if (r.status !== 0 && !mayFail)
    fail(
      `${cmd} failed: ${(r.stderr || r.stdout || `exit code ${r.status}`).trim()}`,
    );
  return r;
}

function needWindows(what) {
  if (PLATFORM !== "win32")
    fail(
      `${what} is set up on Windows only. On this system run the program by hand: node ${q(MAIN)}`,
    );
}

// The key file's access list: only this Windows user.
function lockKeyFile() {
  if (PLATFORM !== "win32") return;
  run("icacls", [
    keyFilePath(),
    "/inheritance:r",
    "/grant:r",
    `${os.userInfo().username}:F`,
  ]);
}

function startLogon() {
  if (SECOND) fail("The second PC program has no start at log-on.");
  needWindows("Start at log-on");
  const vbs = startupScript();
  const line = `CreateObject("WScript.Shell").Run """${process.execPath}"" ""${KEEP}""", 0, False\r\n`;
  if (DRY) console.log(`would write ${vbs}: ${line.trim()}`);
  else {
    fs.mkdirSync(path.dirname(vbs), { recursive: true });
    fs.writeFileSync(vbs, line);
  }
}

function removeLogon() {
  if (SECOND) return;
  needWindows("Start at log-on");
  const vbs = startupScript();
  if (DRY) console.log(`would delete ${vbs}`);
  else fs.rmSync(vbs, { force: true });
  run("schtasks", ["/delete", "/tn", OLD_TASK, "/f"], { mayFail: true });
}

// Stops the running program wherever it was started from (the installed copy or a work copy): it holds the pipe,
// so it is asked through it and ends with its keep.mjs. Then this copy's keep.mjs (so it does not start the program
// again) and program by command line: a program before 26.3.2 does not know "stop", and a keep.mjs may be waiting
// to start one again.
async function stopProgram() {
  if (!SECOND) needWindows("Stopping the program");
  if (DRY) console.log("would ask the running PC program to stop");
  else if ((await askOnce("stop"))?.stopping === true) {
    const until = Date.now() + ASK_WAIT_MS;
    while (await askOnce("status")) {
      if (Date.now() > until)
        fail("The PC program was asked to stop but still runs.");
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  // The real program may run from a copy with the same paths: the second one is stopped through its pipe only.
  if (SECOND) return;
  const has = (p) => `$_.CommandLine.Contains('${p.replace(/'/g, "''")}')`;
  const ps = `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and (${has(KEEP)} -or ${has(MAIN)}) } | Sort-Object { -not ${has(KEEP)} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
  run("powershell", ["-NoProfile", "-Command", ps]);
}

// The old bot's process (by its path, as stopProgram does), its Startup scripts and scheduled tasks, and the /phone
// skill it wrote (only with its marker). Its secrets folder stays and is only named.
function removeOldBot() {
  if (SECOND) return;
  needWindows("Removing the old bot");
  const has = `$_.CommandLine.Contains('${OLD_BOT.replace(/'/g, "''")}')`;
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and ${has} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ]);
  for (const name of OLD_BOT_SCRIPTS) {
    const vbs = path.join(path.dirname(startupScript()), name);
    if (!fs.existsSync(vbs)) continue;
    if (DRY) console.log(`would delete ${vbs}`);
    else {
      fs.rmSync(vbs);
      console.log(`The old bot's Startup script ${vbs} is removed.`);
    }
  }
  for (const task of OLD_BOT_TASKS)
    run("schtasks", ["/delete", "/tn", task, "/f"], { mayFail: true });
  const skill = path.join(os.homedir(), ".claude", "skills", "phone");
  const file = path.join(skill, "SKILL.md");
  if (
    fs.existsSync(file) &&
    fs.readFileSync(file, "utf8").includes(OLD_BOT_MARKER)
  ) {
    if (DRY) console.log(`would delete ${file}`);
    else {
      fs.rmSync(file);
      if (!fs.readdirSync(skill).length) fs.rmdirSync(skill);
      console.log(`The old bot's /phone skill ${skill} is removed.`);
    }
  }
  const secrets = path.join(os.homedir(), ".telegram-control");
  if (fs.existsSync(secrets))
    console.log(
      `The old bot's secrets are kept in ${secrets}: delete that folder by hand if nothing uses it.`,
    );
}

// Starts a Node script hidden and on its own, as the Startup script starts the real program, and returns at once.
// It keeps this process's variables. Its output goes to `logFile`, or nowhere.
function startHidden(script, args = [], logFile = null) {
  if (DRY) {
    console.log(
      `would start hidden: ${[process.execPath, script, ...args].map(q).join(" ")}`,
    );
    return;
  }
  const out = logFile ? fs.openSync(logFile, "w") : "ignore";
  spawn(process.execPath, [script, ...args], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    shell: false,
  }).unref();
  if (logFile) fs.closeSync(out);
}

function startProgram() {
  if (SECOND) return startHidden(KEEP);
  needWindows("Starting the program");
  if (!DRY && !fs.existsSync(startupScript()))
    fail(
      "There is no start at log-on yet. Run: node setup.mjs start-logon, then start.",
    );
  run("wscript", [startupScript()]);
}

// One JSON line to the running program, one back; null when it does not run.
function askOnce(cmd) {
  return new Promise((resolve) => {
    const s = net.connect(pipeName());
    let buf = "";
    s.setEncoding("utf8");
    s.setTimeout(ASK_WAIT_MS, () => s.destroy());
    s.on("connect", () => s.write(`${JSON.stringify({ cmd })}\n`));
    s.on("data", (c) => (buf += c));
    s.on("error", () => resolve(null));
    s.on("close", () => {
      try {
        resolve(JSON.parse(buf));
      } catch {
        resolve(null);
      }
    });
  });
}

// Waits up to 15 seconds for a program that is just starting.
async function ask(cmd) {
  const until = Date.now() + ASK_WAIT_MS;
  for (;;) {
    const a = await askOnce(cmd);
    if (a || Date.now() > until) return a;
    await new Promise((r) => setTimeout(r, 500));
  }
}

async function cmdPair() {
  if (!keysExist())
    fail(
      "This PC has not joined yet. Run: node setup.mjs join <relay address>",
    );
  if (DRY && !TEST) {
    console.log("would ask the PC program for a pairing code");
    return;
  }
  const a = await ask("pair");
  if (!a)
    fail(
      "The PC program is not running. Run: node setup.mjs start, then pair again.",
    );
  if (a.error) fail(`The PC program could not make a code: ${a.error}`);
  console.log(`Pairing code (10 minutes, one use):\n  ${groupCode(a.code)}`);
  console.log(`The same code with a Copy button: ${a.url}`);
  console.log(
    "In the app on your phone: tap Use the code from my PC, then scan the code or paste it.",
  );
  if (!DRY && PLATFORM === "win32")
    run("explorer.exe", [a.url], { mayFail: true });
}

async function cmdJoin(address) {
  let u;
  try {
    u = new URL(address);
  } catch {
    fail(`"${address}" is not an address. It looks like https://<name>.<host>`);
  }
  if (u.protocol !== "https:" && !(TEST && u.hostname === "127.0.0.1"))
    fail("The relay address must start with https://");
  if (keysExist())
    console.log(
      "This PC had joined before: its old keys are replaced, so pair your phone again.",
    );
  if (SECOND) await stopProgram();
  else if (PLATFORM === "win32") {
    removeOldBot();
    await stopProgram();
  }
  await createKeys(u.origin);
  lockKeyFile();
  console.log(`Keys made: ${keyFilePath()}`);
  if (SECOND) startProgram();
  else if (PLATFORM === "win32") {
    startLogon();
    startProgram();
  }
  if (DRY) console.log("would ask the PC program for a pairing code");
  else await cmdPair();
}

async function cmdStatus() {
  if (!keysExist())
    console.log("joined: no (run: node setup.mjs join <relay address>)");
  else {
    const k = loadKeys();
    console.log(
      `joined: ${k.joined ? "yes" : "keys made, the relay has not confirmed yet"}`,
    );
    console.log(
      `owner: ${k.ownerTgId !== null ? "bound" : "no phone paired yet"}`,
    );
    console.log(`paired devices: ${k.devices.length} of 4`);
  }
  if (SECOND) console.log("startup script: none (the second PC program)");
  else if (PLATFORM === "win32") {
    const vbs = startupScript();
    console.log(`startup script: ${fs.existsSync(vbs) ? vbs : "not set up"}`);
    const r = run("schtasks", ["/query", "/tn", OLD_TASK], { mayFail: true });
    if (!DRY && r.status === 0)
      console.log(
        `old task "${OLD_TASK}": still there, not needed any more (run: node setup.mjs remove, then start-logon)`,
      );
  }
  const a = DRY && !TEST ? null : await askOnce("status");
  console.log(
    `running: ${a ? `yes, page ${a.page}, ${a.actions} actions` : "no"}`,
  );
}

// After an update put new files in place: the running program ends and keep.mjs, left running, starts it again from
// the new files after 5 s. Only main.mjs is stopped, found by its path, so a program too old to know a restart word
// restarts too. Nothing runs: nothing to do. Not back within 30 s: started through the Startup script.
async function cmdRestart() {
  needWindows("Restarting the program");
  const main = testOverride("PHONE_PC_MAIN") || MAIN;
  if (DRY) {
    console.log(
      `would stop the running ${main} (not keep.mjs, which starts it again in 5 s)`,
    );
    return;
  }
  const before = await askOnce("status");
  if (!before) {
    console.log("restart: the PC program is not running, nothing to restart");
    return;
  }
  const has = `$_.CommandLine.Contains('${main.replace(/'/g, "''")}')`;
  run("powershell", [
    "-NoProfile",
    "-Command",
    `Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -and ${has} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`,
  ]);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const until = Date.now() + 30_000;
  let gone = false;
  while (Date.now() < until) {
    const a = await askOnce("status");
    if (!a) gone = true;
    // A program from this version names its process; an older one is told apart by the pipe going quiet first.
    else if (gone || (a.pid && before.pid && a.pid !== before.pid)) {
      console.log("restart: the PC program runs again with the new files");
      return;
    }
    await sleep(500);
  }
  if (!gone) fail("restart: the PC program was asked to end but still runs");
  if (!SECOND && fs.existsSync(startupScript())) {
    startProgram();
    console.log(
      "restart: keep.mjs did not start it again, so it was started through the Startup script",
    );
  } else fail("restart: the PC program ended and did not start again");
}

async function cmdRemove() {
  removeOldBot();
  removeLogon();
  await stopProgram();
  console.log(
    `Program stopped and start at log-on removed. The keys stay in ${keyFilePath()}.`,
  );
}

// Voice (PC program design, section 7): the transcriber loads the speech model from this PC only, so it is
// downloaded here, once, and never in the middle of a recording. Done = the model loads; then the marker file
// tells voice.warm that voice is set up. While it runs, the file settingUpPath() holds its process id, so the
// phone hears that voice is being set up. uv comes from winget when it is missing.
// --background: starts this same step hidden, its output in voice-setup.log, and returns at once (the install and
// the update start it so). In test mode PHONE_PC_VOICE_SETUP names a script started in its place.
// A second start while a setup runs (its file names a live process) only says so: two downloads would race.
function cmdVoice(background) {
  if (settingUp()) {
    console.log("Voice: its setup already runs; not starting a second one.");
    return;
  }
  if (background) {
    fs.mkdirSync(path.dirname(markerPath()), { recursive: true });
    const log = path.join(path.dirname(markerPath()), "voice-setup.log");
    const fake = testOverride("PHONE_PC_VOICE_SETUP");
    startHidden(
      fake || fileURLToPath(import.meta.url),
      fake ? [] : ["voice"],
      log,
    );
    console.log(
      `Voice: the speech model (about ${MODEL_MB} MB) downloads in the background; its output goes to ${log}.`,
    );
    return;
  }
  if (!DRY) {
    writeText(settingUpPath(), `${JSON.stringify({ pid: process.pid })}\n`);
    process.on("exit", () => fs.rmSync(settingUpPath(), { force: true }));
  }
  let uv = findUv();
  if (!uv && PLATFORM !== "win32")
    fail(
      "Voice needs uv, which is not on the PATH. Install it (https://docs.astral.sh/uv/), then run: node setup.mjs voice",
    );
  if (!uv) {
    console.log("Voice needs uv: installing it with winget.");
    // Run hidden by --background, nobody can answer winget's agreement questions: they are accepted here.
    const r = run(
      "winget",
      [
        "install",
        "--id",
        "astral-sh.uv",
        "-e",
        "--source",
        "winget",
        "--accept-source-agreements",
        "--accept-package-agreements",
      ],
      { mayFail: true },
    );
    uv = DRY ? "uv" : findUv();
    if (!uv)
      fail(
        `uv did not install (winget: ${(r.stderr || r.stdout || `exit code ${r.status}`).trim().split("\n").pop()}). Install it (https://docs.astral.sh/uv/), then run: node setup.mjs voice`,
      );
  }
  console.log(
    `Voice: downloading the speech model "${MODEL}" (about ${MODEL_MB} MB) and its Python packages, once. This takes a few minutes.`,
  );
  const args = [...UV_ARGS, "--download"];
  if (DRY) console.log(`would run: ${[uv, ...args].map(q).join(" ")}`);
  else {
    const r = spawnSync(uv, args, {
      stdio: "inherit",
      shell: false,
      windowsHide: true,
    });
    if (r.error) fail(`uv failed: ${r.error.message}`);
    if (r.status !== 0)
      fail(
        `The speech model did not download (exit code ${r.status}); see the lines above. Run node setup.mjs voice again.`,
      );
  }
  const marker = `${JSON.stringify({ model: MODEL, setAt: new Date().toISOString() })}\n`;
  if (DRY) console.log(`would write ${markerPath()}: ${marker.trim()}`);
  else writeText(markerPath(), marker);
  console.log(
    "Voice is set up: the record button on the phone turns speech into text on this PC.",
  );
}

const [cmd, arg] = process.argv.slice(2);
if (cmd === "join") await cmdJoin(arg);
else if (cmd === "pair") await cmdPair();
else if (cmd === "status") await cmdStatus();
else if (cmd === "start-logon") startLogon();
else if (cmd === "start") startProgram();
else if (cmd === "restart") await cmdRestart();
else if (cmd === "remove") await cmdRemove();
else if (cmd === "voice") cmdVoice(arg === "--background");
else console.log(USAGE);
