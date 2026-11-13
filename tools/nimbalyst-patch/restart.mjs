#!/usr/bin/env node
// restart: restart to finish. /update-setup runs `node ~/.claude/tools/nimbalyst-patch/restart.mjs` as its last
// call, from a shell that Nimbalyst itself started. Windows only. Plain Node, no npm dependencies. No flags.
//
// Started plain, it checks that a job is staged and no download runs (else one line and exit 1, nothing
// started), then starts itself again with --run, hidden and outside Nimbalyst's process tree (through
// Win32_Process.Create, so the app's quit can't end it), prints one line and returns at once. The --run part:
//   1. closes Nimbalyst: a patched app gets the quit word (a second launch `Nimbalyst.exe <QUIT_WORD>`) and has
//      60 s to end every process under the install folder; an unpatched app gets nothing and the user has
//      10 minutes for one Quit from its tray icon; an app that is not running goes straight on. Nothing is
//      ever stopped by force: when a process is left at the end of the wait, nothing is changed, the error goes
//      to status.json and the run stops;
//   2. runs `deliver.mjs --install-now` (installs the staged job, patches; its error goes to status.json);
//   3. starts Nimbalyst again (Nimbalyst.exe, no arguments, its own folder as working folder) on every way out
//      after step 1 began, also after a failed close or install, unless Nimbalyst.exe still runs. When
//      Nimbalyst.exe is missing or can't be started, a message box names the error and how to try again (the
//      staged installer stays after a failed install, so a retry needs no new download).
// While the patched app closes, staged.json is moved aside to restart-held.json, so the app's own quit listener
// (which starts `deliver.mjs --after-quit` when a job is staged) does not install alongside this run; it is moved
// back before the install, and on every way out.
// Each step is logged in <data>\restart.log (<data> as in deliver.mjs).
//
// Environment overrides (tests): NIMBALYST_RESTART_LAUNCH (a node script run as `<script> <kind> <cwd> <program>
// <args...>` in place of every start this script makes; kind is self, quit or open), NIMBALYST_RESTART_QUIT_WAIT_MS,
// NIMBALYST_RESTART_TRAY_WAIT_MS, and deliver.mjs's NIMBALYST_DELIVER_DATA, NIMBALYST_DELIVER_APP,
// NIMBALYST_DELIVER_RUNNING (the process list), NIMBALYST_DELIVER_MESSAGE_FILE (the message box) and the rest it
// reads in --install-now.
//
// Exit codes: 0 done or started; 1 refused or failed (a failure is in status.json); 2 bad usage.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  appState,
  dataDir,
  downloadRunning,
  installDir,
  missingText,
  RETRY,
  running,
  showMessage,
} from "./deliver.mjs";
import { QUIT_WORD } from "./patches/updater-block.mjs";

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const DELIVER = path.join(HERE, "deliver.mjs");
const RUN = "--run";
const QUIT_WAIT_MS = Number(
  process.env.NIMBALYST_RESTART_QUIT_WAIT_MS || 60 * 1000,
);
const TRAY_WAIT_MS = Number(
  process.env.NIMBALYST_RESTART_TRAY_WAIT_MS || 10 * 60 * 1000,
);

const D = () => {
  const d = dataDir();
  return {
    dir: d,
    staged: path.join(d, "staged.json"),
    held: path.join(d, "restart-held.json"),
    status: path.join(d, "status.json"),
    log: path.join(d, "restart.log"),
  };
};

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}

function log(line) {
  const { dir, log: file } = D();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    file,
    `${new Date().toISOString()} [${process.pid}] ${line}\n`,
  );
}

// status.json in deliver.mjs's shape
function fail(error) {
  const job = readJson(D().staged);
  fs.writeFileSync(
    D().status,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        ok: false,
        version: job?.version ?? null,
        patches: [],
        ...(job?.override ? { override: true } : {}),
        error,
      },
      null,
      2,
    ) + "\n",
  );
  log(`failed: ${error}`);
  return 1;
}

// Why the restart can't go on now, or null.
function refusal() {
  if (!fs.existsSync(D().staged)) return "nothing is staged to install";
  const lock = downloadRunning();
  if (lock)
    return `the download of Nimbalyst ${lock.version} is still running; run /update-setup again when it has ended`;
  return null;
}

// ---- starting programs ----

const psQuote = (s) => `'${String(s).replace(/['‘’‚‛]/g, "$&$&")}'`;

// Starts a program through Win32_Process.Create: its parent is the WMI service, not this process, so it lives on
// when Nimbalyst and everything under it ends. Hidden window; the environment of this process is passed on.
export function startOutside(program, args, cwd) {
  const cmdLine = [program, ...args].map((a) => `"${a}"`).join(" ");
  const env = Object.entries(process.env)
    .filter(([k, v]) => k && !k.startsWith("=") && !/[\r\n]/.test(`${k}${v}`))
    .map(([k, v]) => psQuote(`${k}=${v}`))
    .join(",");
  const script =
    [
      "$ErrorActionPreference = 'Stop'",
      `$s = New-CimInstance -CimClass (Get-CimClass -ClassName Win32_ProcessStartup) -ClientOnly -Property @{ ShowWindow = [uint16]0; EnvironmentVariables = [string[]]@(${env}) }`,
      `$r = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{ CommandLine = ${psQuote(cmdLine)}; CurrentDirectory = ${psQuote(cwd)}; ProcessStartupInformation = $s }`,
      "if ($r.ReturnValue -ne 0) { [Console]::Error.WriteLine('Win32_Process.Create returned ' + $r.ReturnValue); exit 1 }",
      "[Console]::Out.WriteLine($r.ProcessId)",
      "exit 0",
    ].join("\n") + "\n";
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      "-",
    ],
    { input: script, encoding: "utf8", windowsHide: true, timeout: 60 * 1000 },
  );
  const pid = Number((r.stdout || "").trim().split(/\s+/).pop());
  if (r.error || r.status !== 0 || !Number.isInteger(pid) || pid <= 0) {
    throw new Error(
      `could not start ${cmdLine} through Win32_Process.Create: ${(r.error?.message || r.stderr || r.stdout || `exit ${r.status}`).trim()}`,
    );
  }
  return pid;
}

// A detached start that does not wait for the program; resolves once it has started.
function startDetached(program, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(program, args, {
      cwd,
      detached: true,
      stdio: "ignore",
    });
    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve(child.pid);
    });
  });
}

// Every start this script makes goes through here, so the tests can stand in for it.
async function launch(kind, cwd, program, args) {
  const fake = process.env.NIMBALYST_RESTART_LAUNCH;
  if (fake) {
    const r = spawnSync(process.execPath, [fake, kind, cwd, program, ...args], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 30 * 1000,
    });
    if (r.error || r.status !== 0)
      throw new Error(
        `the test launcher failed for ${kind}: ${(r.error?.message || r.stderr || `exit ${r.status}`).trim()}`,
      );
    return null;
  }
  if (kind === "self") return startOutside(program, args, cwd);
  return startDetached(program, args, cwd);
}

// ---- the run outside Nimbalyst ----

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const span = (ms) =>
  ms >= 60 * 1000 && ms % (60 * 1000) === 0
    ? `${ms / 60000} minutes`
    : `${ms / 1000} s`;

// [] once every app process under the install folder has ended, else what is still running at the end of the wait
async function waitClosed(install, ms) {
  const end = Date.now() + ms,
    step = Math.max(100, Math.min(1000, ms / 20));
  for (;;) {
    const left = running(install);
    if (!left.length || Date.now() >= end) return left;
    await sleep(step);
  }
}

// staged.json aside while a patched app closes, so its quit listener starts no install of its own
function hold() {
  fs.renameSync(D().staged, D().held);
  log("staged.json moved aside to restart-held.json while Nimbalyst closes");
}
function unhold() {
  const d = D();
  if (!fs.existsSync(d.held)) return;
  if (fs.existsSync(d.staged)) {
    fs.rmSync(d.held);
    log("a newer staged.json was written meanwhile; restart-held.json dropped");
    return;
  }
  fs.renameSync(d.held, d.staged);
  log("staged.json moved back");
}

// Closes Nimbalyst; null when it is closed, else the error.
async function close(install, exe) {
  if (!running(install).length) {
    log("Nimbalyst is not running");
    return null;
  }
  let left;
  if ((await appState(install)).blocked) {
    hold();
    try {
      log(`asking Nimbalyst to close: "${exe}" ${QUIT_WORD}`);
      await launch("quit", install, exe, [QUIT_WORD]);
      left = await waitClosed(install, QUIT_WAIT_MS);
    } finally {
      unhold();
    }
    if (left.length)
      return `Nimbalyst did not close within ${span(QUIT_WAIT_MS)} of the quit request (${left.length} process(es) still running): nothing changed`;
  } else {
    log(
      `Nimbalyst is not patched yet: no quit request; waiting up to ${span(TRAY_WAIT_MS)} for a Quit from its tray icon`,
    );
    left = await waitClosed(install, TRAY_WAIT_MS);
    if (left.length)
      return `Nimbalyst was not quit from its tray icon within ${span(TRAY_WAIT_MS)} (${left.length} process(es) still running): nothing changed`;
  }
  log("every Nimbalyst process has ended");
  return null;
}

// Starts whatever Nimbalyst is there again, unless its main program still runs. When it can't be started, a
// message on the screen names the error and how to try again. true when Nimbalyst runs or was started.
async function reopen(install, exe, error) {
  if (
    running(install).some(
      (p) => path.basename(p).toLowerCase() === "nimbalyst.exe",
    )
  ) {
    log("Nimbalyst.exe still runs: not started again");
    return true;
  }
  if (!fs.existsSync(exe)) {
    log(`${exe} is gone: Nimbalyst is not started again`);
    await showMessage(missingText(exe, error));
    return false;
  }
  try {
    await launch("open", install, exe, []);
    log(`started "${exe}" again`);
    return true;
  } catch (e) {
    log(`could not start Nimbalyst again: ${e.message}`);
    await showMessage(
      `Nimbalyst could not be started again after its update${error ? ` (${String(error).replace(/\.$/, "")})` : ""}: ${e.message}.\n\nStart it from the Start menu. ${RETRY}`,
    );
    return false;
  }
}

async function run() {
  const d = D();
  log(`run started outside Nimbalyst (parent pid ${process.ppid})`);
  if (fs.existsSync(d.held) && !fs.existsSync(d.staged)) {
    fs.renameSync(d.held, d.staged);
    log("restart-held.json of a broken run moved back to staged.json");
  }
  const why = refusal();
  if (why) {
    log(`refused: ${why}`);
    return 1;
  }
  const install = installDir();
  if (!install) return fail("Nimbalyst is not installed");
  const exe = path.join(install, "Nimbalyst.exe");
  let error = null;
  try {
    // a close that timed out may still have ended the main program (helpers left): it is started again below
    error = await close(install, exe);
    if (error) fail(error);
    else {
      log("running deliver.mjs --install-now");
      const r = spawnSync(process.execPath, [DELIVER, "--install-now"], {
        encoding: "utf8",
        windowsHide: true,
      });
      if (r.error) {
        error = `could not run deliver.mjs --install-now: ${r.error.message}`;
        fail(error);
      } else if (r.status !== 0) {
        error =
          readJson(d.status)?.error ??
          ((r.stderr || "").trim() || `exit ${r.status}`);
        log(`deliver.mjs --install-now failed (exit ${r.status}): ${error}`);
      } else log("deliver.mjs --install-now done");
    }
  } catch (e) {
    error = e.message;
    try {
      fail(error);
    } catch (e2) {
      log(`could not write status.json: ${e2.message}`);
    }
  }
  const started = await reopen(install, exe, error);
  return started && !error ? 0 : 1;
}

// ---- the plain start ----

async function main(argv) {
  if (process.platform !== "win32") {
    console.log(
      "nimbalyst: the restart is for Windows only; nothing to do here",
    );
    return 0;
  }
  if (argv[0] === RUN && argv.length === 1) {
    try {
      return await run();
    } catch (e) {
      try {
        fail(e.message);
      } catch {}
      return 1;
    }
  }
  if (argv.length) {
    console.error("[nimbalyst-restart] usage: restart.mjs (no flags)");
    return 2;
  }
  try {
    const why = refusal();
    if (why) {
      log(`plain start refused: ${why}`);
      console.log(`nimbalyst: not restarted: ${why}`);
      return 1;
    }
    const install = installDir();
    if (!install) {
      console.log("nimbalyst: not restarted: Nimbalyst is not installed");
      return 1;
    }
    const open = running(install).length > 0,
      patched = open && (await appState(install)).blocked;
    const pid = await launch("self", HERE, process.execPath, [SELF, RUN]);
    log(
      `plain start: started "${SELF}" ${RUN} outside Nimbalyst${pid ? ` (pid ${pid})` : ""}`,
    );
    console.log(
      !open
        ? "nimbalyst: installing the update and its fixes; Nimbalyst opens in about a minute"
        : patched
          ? "nimbalyst: restarting: Nimbalyst closes now, the update and its fixes go in, and it opens again in about a minute"
          : "nimbalyst: quit Nimbalyst once from its tray icon (right-click, Quit); the update and its fixes then go in and it opens again in about a minute",
    );
    return 0;
  } catch (e) {
    console.log(`nimbalyst: not restarted: ${e.message}`);
    return 1;
  }
}

const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
if (process.argv[1] && real(process.argv[1]) === real(SELF))
  process.exitCode = await main(process.argv.slice(2));
