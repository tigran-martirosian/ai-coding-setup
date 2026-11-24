#!/usr/bin/env node
// deliver: brings the Nimbalyst version in pin.json onto this PC and patches it. Windows only. Plain Node,
// no npm dependencies. Started by the setup's update path (--stage), by the patched app's quit listener
// (--after-quit) and by restart.mjs (--install-now).
//
//   deliver.mjs --status        one line "nimbalyst: <state>[; <queued project moves waiting or refused>]"
//   deliver.mjs --stage         get what the pin needs ready: the checked installer in <data>\staged\ and
//                               <data>\staged.json; with Nimbalyst closed it installs and patches too. It returns
//                               within seconds: a download, an install or a patch run goes to --stage-work
//   deliver.mjs --stage-work    (started by --stage only) that long part, hidden and on its own, holding download.lock
//   deliver.mjs --wait          returns when a running stage run has ended (10 minutes at most)
//   deliver.mjs --after-quit    the quit listener's call: waits up to 2 minutes for the app to end, then installs
//   deliver.mjs --install-now   installs the staged job (if any) and patches, now; the app must be closed
//   deliver.mjs --off           turns the delivery off (writes off.json, drops the staged job) and puts the original
//                               app.asar back, so Nimbalyst updates itself again: at once with the app closed, else
//                               through a restore job that the next close (quit listener or restart.mjs) carries out
//   deliver.mjs --on            turns it on again and starts a delivery (as --stage)
//   deliver.mjs --unstage       drops the staged job and the staged installer
//
// Data folder <data> = %LOCALAPPDATA%\ai-coding-setup\nimbalyst (NIMBALYST_DELIVER_DATA moves it; the quit
// listener honours the same variable). Files: off.json, staged.json { version, installer|null, node, deliver,
// at, atClose, override?, asarSha256? } or a restore job { restore: true, installer: null, node, deliver, at } or a
// marker job { extensions?: true, moves?: true, installer: null, node, deliver, at, atClose: true },
// status.json { at, ok, version, patches, override?, error? }, download.lock { pid, version, at } while a stage
// run works, deliver.log, and moves.json { moves: [{ from, to, at }], refused?: [...] } (project moves queued while
// Nimbalyst ran, written by skills/file-upkeep/move-project.mjs --queue; `refused` holds those refused when they ran).
// `atClose` is true when the app's close listener will start --after-quit (the app is patched; the delivery is on).
// Panels (Nimbalyst extensions the setup built into extensions-pending, see ext-swap.mjs) go in after the job's
// own work in --install-now and --after-quit, never while Nimbalyst runs; then the queued moves are carried out
// (move-project.mjs --run-queued, which checks itself that Nimbalyst is closed; what it says goes to deliver.log).
// With no other job staged, --stage keeps a marker job while panels or moves wait and the close listener is
// there (queued moves keep it with the delivery off too, and after a failed download): it makes the close start
// --after-quit, installs nothing, writes no status.json and goes once nothing waits. A failed swap goes to
// deliver.log only; moves waiting or refused are added to --status, and --off is refused while moves wait that no
// close would carry out.
// Off when NIMBALYST_FOLLOW=off (any case; environment, or the env of ~/.claude/settings.json) or off.json exists.
// A job marked `override` (a trial of a version newer than the pin, written by the follow script) is never
// replaced by --stage; it is checked against its own asarSha256 and status.json keeps `override: true`.
// No waiting process: on a running app that is not patched yet (no quit listener) the job stays staged until
// restart.mjs, or until a later --stage finds the app closed.
// A failed install keeps the job and its installer, so the next close (or restart.mjs) tries again; a failed
// result stays in status.json until a new attempt starts. When the app is left without Nimbalyst.exe, a message
// on the screen says so (showMessage).
//
// Environment overrides (tests): NIMBALYST_DELIVER_APP (install folder holding Nimbalyst.exe and resources),
// NIMBALYST_DELIVER_PIN, NIMBALYST_DELIVER_PATCHES, NIMBALYST_DELIVER_DOWNLOAD (a node script run as
// `<script> <url> <file>`), NIMBALYST_DELIVER_RUN_WITH (a program that runs the installer file),
// NIMBALYST_DELIVER_RUNNING (a file listing running app paths, one per line; no file = none running),
// NIMBALYST_DELIVER_MESSAGE_FILE (a file each on-screen message is added to as a JSON line, in place of showing it),
// NIMBALYST_DELIVER_QUIT_WAIT_MS, NIMBALYST_DELIVER_DOWNLOAD_WAIT_MS. NIMBALYST_PATCH_PROGRAM_DIRS as in patch.mjs.
//
// Exit codes: 0 done or nothing to do; 1 failed (the error is in status.json) or --wait timed out; 2 bad usage.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { pendingNames, swapPending } from "./ext-swap.mjs";
import {
  apply,
  asarVersion,
  loadPatches,
  perMachine,
  plan,
  readAsar,
  readFuses,
  restore,
  runningFrom,
} from "./patch.mjs";

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
// Nimbalyst's own updater runs `--updated /S --force-run`; no --force-run here, restart.mjs relaunches.
// Only per-user installs are delivered (a per-machine one is refused), so --currentuser always applies.
// Not verified that the NSIS script honours both.
export const INSTALLER_ARGS = ["--updated", "/S", "--currentuser"];
const INSTALLER_TIMEOUT_MS = 10 * 60 * 1000;
const QUIT_WAIT_MS = Number(
  process.env.NIMBALYST_DELIVER_QUIT_WAIT_MS || 2 * 60 * 1000,
);
const DOWNLOAD_WAIT_MS = Number(
  process.env.NIMBALYST_DELIVER_DOWNLOAD_WAIT_MS || 10 * 60 * 1000,
);

// ---- places ----

export function dataDir() {
  if (process.env.NIMBALYST_DELIVER_DATA)
    return path.resolve(process.env.NIMBALYST_DELIVER_DATA);
  if (!process.env.LOCALAPPDATA)
    throw new Error("LOCALAPPDATA is not set, so the data folder is unknown");
  return path.join(process.env.LOCALAPPDATA, "ai-coding-setup", "nimbalyst");
}
const D = () => {
  const d = dataDir();
  return {
    dir: d,
    off: path.join(d, "off.json"),
    staged: path.join(d, "staged.json"),
    stagedDir: path.join(d, "staged"),
    status: path.join(d, "status.json"),
    lock: path.join(d, "download.lock"),
    log: path.join(d, "deliver.log"),
  };
};

// The install folder: the override, else the per-user place, else Program Files (refused later as per-machine).
function installDir() {
  if (process.env.NIMBALYST_DELIVER_APP) {
    const d = path.resolve(process.env.NIMBALYST_DELIVER_APP);
    return fs.existsSync(path.join(d, "resources", "app.asar")) ? d : null;
  }
  const dirs = [
    process.env.LOCALAPPDATA &&
      path.join(process.env.LOCALAPPDATA, "Programs", "Nimbalyst"),
    ...[process.env.ProgramFiles, process.env["ProgramFiles(x86)"]]
      .filter(Boolean)
      .map((p) => path.join(p, "Nimbalyst")),
  ].filter(Boolean);
  return (
    dirs.find((d) => fs.existsSync(path.join(d, "resources", "app.asar"))) ??
    null
  );
}
const appPaths = (install) => {
  const res = path.join(install, "resources"),
    asar = path.join(res, "app.asar");
  return {
    res,
    asar,
    orig: `${asar}.orig`,
    tmp: `${asar}.patched-tmp`,
    marker: path.join(res, "ai-coding-setup-patched.json"),
    install,
    exe: path.join(install, "Nimbalyst.exe"),
  };
};
const patchesDir = () =>
  path.resolve(
    process.env.NIMBALYST_DELIVER_PATCHES || path.join(HERE, "patches"),
  );
const downloader = () =>
  path.resolve(
    process.env.NIMBALYST_DELIVER_DOWNLOAD ||
      path.join(HERE, "..", "..", "workers", "download.mjs"),
  );

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${file}: ${e.message}`);
  }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2) + "\n");
}

export function readPin() {
  const file = path.resolve(
    process.env.NIMBALYST_DELIVER_PIN || path.join(HERE, "pin.json"),
  );
  const pin = readJson(file);
  if (!pin) throw new Error(`${file} does not exist`);
  for (const k of ["version", "url", "sha512", "asarSha256"])
    if (typeof pin[k] !== "string" || !pin[k])
      throw new Error(`${file}: ${k} is missing`);
  if (!Number.isInteger(pin.size) || pin.size <= 0)
    throw new Error(`${file}: size is missing`);
  return pin;
}

function log(line) {
  const { dir, log: file } = D();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    file,
    `${new Date().toISOString()} [${process.pid}] ${line}\n`,
  );
}

// ---- small facts ----

const offIn = (v) => String(v ?? "").toLowerCase() === "off";
function isOff() {
  if (offIn(process.env.NIMBALYST_FOLLOW)) return true;
  const settings = readJson(
    path.join(os.homedir(), ".claude", "settings.json"),
  );
  if (offIn(settings?.env?.NIMBALYST_FOLLOW)) return true;
  return fs.existsSync(D().off);
}

// -1, 0 or 1; numbers only, a pre-release tail is ignored
export function compareVersions(a, b) {
  const pa = a.split("-")[0].split(".").map(Number),
    pb = b.split("-")[0].split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0,
      y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y))
      throw new Error(`can't compare versions ${a} and ${b}`);
    if (x !== y) return x < y ? -1 : 1;
  }
  return 0;
}

function running(install) {
  const file = process.env.NIMBALYST_DELIVER_RUNNING;
  if (file === undefined) return runningFrom(install);
  return fs.existsSync(file)
    ? fs
        .readFileSync(file, "utf8")
        .split(/\r?\n/)
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
function downloadRunning() {
  const lock = readJson(D().lock);
  return lock && Number.isInteger(lock.pid) && alive(lock.pid) ? lock : null;
}

// What to do after a failure that leaves Nimbalyst closed
export const RETRY = `To try again, run /update-setup in Claude Code, or this in a terminal: node "${path.join(HERE, "restart.mjs")}"`;

// A message box on the screen, for a failure the person must see now (Nimbalyst is left closed). Returns once
// the box's process has started; it does not wait for the OK. NIMBALYST_DELIVER_MESSAGE_FILE (tests): the message
// is added to that file as one JSON line instead.
export function showMessage(text) {
  const title = "Nimbalyst update";
  log(`message on the screen: ${text.replace(/\s*\n+\s*/g, " ")}`);
  const file = process.env.NIMBALYST_DELIVER_MESSAGE_FILE;
  if (file) {
    fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
    fs.appendFileSync(file, JSON.stringify({ title, text }) + "\n");
    return Promise.resolve();
  }
  const q = (s) => `'${String(s).replace(/['‘’‚‛]/g, "$&$&")}'`;
  const script = `Add-Type -AssemblyName System.Windows.Forms; [void][System.Windows.Forms.MessageBox]::Show(${q(text)}, ${q(title)}, 'OK', 'Error', 'Button1', 'ServiceNotification')`;
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-WindowStyle",
        "Hidden",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
      { detached: true, stdio: "ignore", windowsHide: true },
    );
    child.once("error", (e) =>
      reject(new Error(`could not show the message box: ${e.message}`)),
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

function hashFile(file, algo, encoding) {
  const h = crypto.createHash(algo),
    fd = fs.openSync(file, "r"),
    buf = Buffer.alloc(8 * 1024 * 1024);
  try {
    for (let n; (n = fs.readSync(fd, buf, 0, buf.length, null)) > 0; )
      h.update(buf.subarray(0, n));
  } finally {
    fs.closeSync(fd);
  }
  return h.digest(encoding);
}

// What the installed app is: its version, whether the updater block is in, whether every patch that can go in is in.
async function appState(install) {
  const P = appPaths(install),
    asar = readAsar(P.asar),
    version = asarVersion(asar);
  const patches = await loadPatches(patchesDir());
  const { results } = plan(asar, patches);
  const blocked =
    results.find((r) => r.id === "updater-block")?.state === "applied";
  const applied = results.filter((r) => r.state === "applied").map((r) => r.id);
  return {
    P,
    version,
    blocked,
    applied,
    complete: blocked && !results.some((r) => r.state === "would apply"),
    patchCount: patches.length,
  };
}

// ---- the status line ----

// ` (the last try failed: <error>)` when status.json holds a failure of this job, else ""
const lastTry = (status, job) =>
  status &&
  status.ok === false &&
  (job.restore || status.version === job.version) &&
  status.at >= job.at
    ? ` (the last try failed: ${String(status.error).replace(/\.$/, "")})`
    : "";

// the delivery's state, then the queued project moves (movesNote): waiting, refused, or a moves.json that can't be read
export async function statusLine() {
  if (process.platform !== "win32") return "not on this system";
  return `${await deliveryState()}${movesNote()}`;
}
async function deliveryState() {
  if (isOff()) {
    const job = readJson(D().staged);
    return job?.restore
      ? `off; the original Nimbalyst comes back when it next closes, then it updates itself again${lastTry(readJson(D().status), job)}`
      : "off";
  }
  const install = installDir();
  if (!install || !fs.existsSync(path.join(install, "resources", "app.asar")))
    return "not installed";
  const P = appPaths(install);
  if (perMachine(P.res))
    return "can't patch here: Nimbalyst is installed for all users";
  if (
    fs.existsSync(P.exe) &&
    readFuses(P.exe).EnableEmbeddedAsarIntegrityValidation === "1"
  )
    return "can't patch here: the app checks its own files (asar integrity fuse on)";
  const pin = readPin();
  const lock = downloadRunning();
  if (lock) return `getting ${lock.version}`;
  const app = await appState(install),
    staged = readJson(D().staged),
    status = readJson(D().status);
  // a restore job and a marker job (panels only) have no version: for Nimbalyst nothing is staged
  if (staged?.version) {
    return (
      (app.blocked
        ? `${staged.version} installs when Nimbalyst closes`
        : `restart to finish: ${app.version} -> ${staged.version}, ${app.patchCount} fixes`) +
      lastTry(status, staged)
    );
  }
  const trial = status?.ok && status.override && status.version === app.version;
  if (app.complete && app.version === pin.version)
    return `on, ${app.version}, ${app.applied.length} fixes applied`;
  if (app.complete && trial)
    return `on, ${app.version} (trial; pin ${pin.version}), ${app.applied.length} fixes applied`;
  if (!trial && compareVersions(app.version, pin.version) > 0)
    return `${app.version} is newer than the setup has checked (${pin.version})`;
  if (status && status.ok === false)
    return `failed: ${String(status.error).replace(/\.$/, "")}; run /update-setup to retry`;
  return app.version === pin.version
    ? `not staged: ${pin.version} is in without every fix; run /update-setup to get them`
    : `not staged: ${app.version} -> ${pin.version}; run /update-setup to get it`;
}

// ---- the job ----

function fail(error, job) {
  writeJson(D().status, {
    at: new Date().toISOString(),
    ok: false,
    version: job?.version ?? null,
    patches: [],
    ...(job?.override ? { override: true } : {}),
    error,
  });
  log(`failed: ${error}`);
  return 1;
}

function dropStaged() {
  const d = D();
  fs.rmSync(d.staged, { force: true });
  fs.rmSync(d.stagedDir, { recursive: true, force: true });
}

// A failed result of an earlier attempt goes when a new attempt starts
function clearFailed() {
  const status = readJson(D().status);
  if (status && status.ok === false) {
    fs.rmSync(D().status);
    log(`a new attempt starts; the last failure is cleared: ${status.error}`);
  }
}

// Puts the original app.asar back (the app must be closed): Nimbalyst's own updater works again.
function restoreOriginal(P) {
  const lines = restore(P);
  log(`--off: ${lines.join("; ")}; Nimbalyst updates itself again`);
}

// ---- panels ----

export const isMarker = (job) =>
  (job?.extensions === true || job?.moves === true) &&
  !job.version &&
  !job.restore;

// Swaps the waiting panels in; ext-swap.mjs checks itself that Nimbalyst is closed. A failure goes to deliver.log
// only: the panels stay pending and the next close tries again. Returns whether a panel still waits.
function swapPanels(tag) {
  try {
    if (!pendingNames().length) return false;
    swapPending({ log: (l) => log(`${tag}: panels: ${l}`) });
    return pendingNames().length > 0;
  } catch (e) {
    log(`${tag}: panels: not swapped, they stay pending: ${e.message}`);
    return true;
  }
}

// ---- queued project moves ----

const movesFile = () => path.join(dataDir(), "moves.json");
const MOVE_PROJECT = path.join(
  HERE,
  "..",
  "..",
  "skills",
  "file-upkeep",
  "move-project.mjs",
);
// moves.json as { waiting, refused }: the moves waiting for the close, and those refused or failed when they ran
// (move-project.mjs keeps them under `refused` until that project is queued again or moved). A file that can't be
// read throws.
function movesQueue() {
  const f = movesFile(),
    q = readJson(f);
  if (!q) return { waiting: 0, refused: [] };
  if (!Array.isArray(q.moves)) throw new Error(`${f} has no "moves" list`);
  return {
    waiting: q.moves.length,
    refused: Array.isArray(q.refused) ? q.refused : [],
  };
}
// How many moves wait. A moves.json that can't be read counts as waiting, so the marker job stays and the close
// runs move-project.mjs, which refuses it naming the file; the read error goes to deliver.log and the status line.
function queuedMoves(tag) {
  try {
    return movesQueue().waiting;
  } catch (e) {
    log(
      `${tag}: queued moves: ${e.message}; the marker job stays until it is fixed or deleted`,
    );
    return 1;
  }
}
// The status line's part on project moves: those waiting for the close, those refused when they ran, or a
// moves.json that can't be read; "" when there are none.
function movesNote() {
  let q;
  try {
    q = movesQueue();
  } catch (e) {
    return `; the queued project moves can't be read: ${String(e.message).replace(/\.$/, "")}; fix or delete it`;
  }
  const parts = [];
  if (q.waiting)
    parts.push(
      `${q.waiting} project move${q.waiting > 1 ? "s wait" : " waits"} for Nimbalyst to close`,
    );
  for (const x of q.refused)
    parts.push(
      `the queued move ${x.from} -> ${x.to} was ${x.exit === 2 ? "stopped midway" : "refused"}: ${String(
        x.why ?? "",
      )
        .replace(/^move-project (refused|failed midway[^:]*): /, "")
        .replace(
          /\.$/,
          "",
        )} (listed until that project is queued again or moved; delete it from ${movesFile()} to drop it)`,
    );
  return parts.length ? `; ${parts.join("; ")}` : "";
}
// Carries out the queued moves (move-project.mjs --run-queued) after the job's own work. No time limit: a move
// stopped midway would leave its database transaction open while restart.mjs starts Nimbalyst again. Never throws:
// what the move says, and a move that could not run, go to deliver.log; moves.json keeps what was not done.
function runMoves(tag) {
  try {
    const n = queuedMoves(tag);
    if (!n) return;
    log(`${tag}: queued project move(s): move-project.mjs --run-queued`);
    const r = spawnSync(
      process.execPath,
      ["--disable-warning=ExperimentalWarning", MOVE_PROJECT, "--run-queued"],
      { encoding: "utf8", windowsHide: true },
    );
    for (const l of `${r.stdout ?? ""}${r.stderr ?? ""}`.split(/\r?\n/))
      if (l.trim()) log(`${tag}: move: ${l}`);
    if (r.error || r.status !== 0)
      log(
        `${tag}: move-project.mjs --run-queued ${r.error ? `could not run: ${r.error.message}` : `exited with code ${r.status}`}`,
      );
  } catch (e) {
    log(`${tag}: queued moves: ${e.message}`);
  }
}
// Why the app's close would not start --after-quit, or null when it would (the app patched, the delivery on).
// move-project.mjs --queue asks this before it queues a move.
export async function closeListener() {
  if (process.platform !== "win32") return "this is not Windows";
  if (isOff()) return "the setup's Nimbalyst delivery is off";
  const install = installDir();
  if (!install) return "Nimbalyst is not installed where the setup patches it";
  if (perMachine(appPaths(install).res))
    return "Nimbalyst is installed for all users, so the setup does not patch it";
  if (!(await appState(install)).blocked)
    return "Nimbalyst is not patched yet, so it has no quit listener";
  return null;
}

// With no other job staged: keeps a marker job while panels or queued moves wait and the close listener can start
// --after-quit (the app patched); else drops a marker job that is there. With the delivery off the panels wait for
// /update-setup, but queued moves keep the marker: the app is still patched, and only its close carries them out.
function markJob(tag, blocked) {
  const d = D(),
    job = readJson(d.staged);
  if (job && !isMarker(job)) return;
  const waiting = isOff() ? [] : pendingNames(),
    moves = queuedMoves(tag);
  if ((waiting.length || moves) && blocked) {
    writeJson(d.staged, {
      ...(waiting.length ? { extensions: true } : {}),
      ...(moves ? { moves: true } : {}),
      installer: null,
      node: process.execPath,
      deliver: SELF,
      at: new Date().toISOString(),
      atClose: true,
    });
    log(
      `${tag}: ${[waiting.length && `panels wait (${waiting.join(", ")})`, moves && `${moves} project move(s) wait`].filter(Boolean).join(" and ")}: a marker job makes the next close ${waiting.length ? "swap them in" : "carry them out"}`,
    );
  } else if (job) {
    dropStaged();
    log(
      `${tag}: the marker job is dropped: ${waiting.length || moves ? "no close listener starts --after-quit" : "no panel or move waits"}`,
    );
  }
}

// --install-now: the job's own work, then the waiting panels, then the queued moves. A marker job only swaps the
// panels and carries out the moves: no install, no patch run, no status.json; it goes once nothing waits.
async function installNow(tag = "--install-now") {
  const job = readJson(D().staged);
  if (isMarker(job)) {
    const panels = swapPanels(tag);
    runMoves(tag);
    const moves = queuedMoves(tag);
    if (panels || moves) {
      log(
        `${tag}: ${[panels && "panels", moves && "project moves"].filter(Boolean).join(" and ")} still wait; the marker job stays for the next close`,
      );
      return 0;
    }
    dropStaged();
    log(`${tag}: nothing waits any more; the marker job is dropped`);
    return 0;
  }
  const code = await installJob();
  const panels = swapPanels(tag);
  runMoves(tag);
  if ((panels || queuedMoves(tag)) && !fs.existsSync(D().staged))
    try {
      const install = installDir();
      if (install) markJob(tag, (await appState(install)).blocked);
    } catch (e) {
      log(`${tag}: no marker job written: ${e.message}`);
    }
  return code;
}

// Installs the staged job (if any) and patches, or carries out a restore job. The app must be closed.
async function installJob() {
  const install = installDir();
  if (!install) return fail("Nimbalyst is not installed");
  const P = appPaths(install),
    d = D();
  if (perMachine(P.res))
    return fail("can't patch here: Nimbalyst is installed for all users");
  const job = readJson(d.staged);
  const left = running(install);
  if (left.length)
    return fail(
      `Nimbalyst is still running (${left.length} process(es)): nothing changed`,
      job,
    );
  if (job?.restore) {
    // the restore job stays when it fails, so the next close tries again
    try {
      restoreOriginal(P);
    } catch (e) {
      return fail(`putting the original Nimbalyst back: ${e.message}`, job);
    }
    dropStaged();
    return 0;
  }
  if (isOff()) {
    if (job) dropStaged();
    log("--install-now: delivery is off: nothing installed or patched");
    return 0;
  }
  const pin = readPin();
  if (!job) {
    // nothing staged: only the pinned version (or a trial already in) gets its patches again
    const version = asarVersion(readAsar(P.asar)),
      status = readJson(d.status);
    if (
      version !== pin.version &&
      !(status?.ok && status.override && status.version === version)
    ) {
      log(
        `--install-now: nothing staged and ${version} is not the pin ${pin.version}: nothing to do`,
      );
      return 0;
    }
  }
  if (job?.installer) {
    if (!fs.existsSync(job.installer)) {
      dropStaged();
      return fail(`the staged installer ${job.installer} is gone`, job);
    }
    if (!job.override) {
      if (job.version !== pin.version) {
        dropStaged();
        return fail(
          `the staged job is for ${job.version}, the pin is ${pin.version}`,
          job,
        );
      }
      if (
        fs.statSync(job.installer).size !== pin.size ||
        hashFile(job.installer, "sha512", "base64") !== pin.sha512
      ) {
        dropStaged();
        return fail(
          `the staged installer of ${job.version} no longer matches the pin's sha512 and size`,
          job,
        );
      }
    }
    const want = job.override ? job.asarSha256 : pin.asarSha256;
    if (typeof want !== "string" || !want) {
      dropStaged();
      return fail(`the staged job for ${job.version} names no asarSha256`, job);
    }
    const runWith = process.env.NIMBALYST_DELIVER_RUN_WITH;
    const [cmd, args] = runWith
      ? [runWith, [job.installer, ...INSTALLER_ARGS]]
      : [job.installer, INSTALLER_ARGS];
    log(`running the installer of ${job.version}: ${[cmd, ...args].join(" ")}`);
    // until the install is checked, a failure keeps the job and its installer: the next close tries again
    const r = spawnSync(cmd, args, {
      stdio: "ignore",
      windowsHide: true,
      timeout: INSTALLER_TIMEOUT_MS,
    });
    if (r.error || r.status !== 0)
      return fail(
        `the installer of ${job.version} ${r.error ? `could not run: ${r.error.message}` : `exited with code ${r.status}`}`,
        job,
      );
    if (!fs.existsSync(P.asar))
      return fail(
        `after the installer of ${job.version} there is no ${P.asar}`,
        job,
      );
    const got = hashFile(P.asar, "sha256", "hex");
    if (got !== want)
      return fail(
        `app.asar after the installer of ${job.version} does not match the checked hash (${got})`,
        job,
      );
    // the fresh app.asar is unpatched and checked: a backup and a marker of the old version are stale
    fs.rmSync(P.orig, { force: true });
    fs.rmSync(P.marker, { force: true });
    log(`installed ${job.version}, app.asar matches the checked hash`);
  }
  // a failed patch run after a checked install keeps a patch-only job (the installer goes), so the next close
  // tries the patches again
  const patchFailed = (error) => {
    if (job?.installer) {
      fs.rmSync(d.stagedDir, { recursive: true, force: true });
      writeJson(d.staged, { ...job, installer: null });
    }
    return fail(`patching: ${error}`, job);
  };
  try {
    await apply(P, patchesDir());
  } catch (e) {
    return patchFailed(e.message);
  }
  const app = await appState(install);
  if (!app.blocked)
    return patchFailed("the updater block is not in after the patch run");
  const trial =
    !!job?.override ||
    (app.version !== pin.version && readJson(d.status)?.override === true);
  writeJson(d.status, {
    at: new Date().toISOString(),
    ok: true,
    version: app.version,
    patches: app.applied,
    ...(trial ? { override: true } : {}),
  });
  dropStaged();
  log(`done: Nimbalyst ${app.version} with ${app.applied.join(", ")}`);
  return 0;
}

// Downloads the pinned installer into <data>\staged\ and checks its sha512 and size. The caller holds download.lock.
function download(pin) {
  const d = D();
  fs.mkdirSync(d.stagedDir, { recursive: true });
  const file = path.join(d.stagedDir, `Nimbalyst-${pin.version}.exe`);
  fs.rmSync(file, { force: true });
  log(`downloading ${pin.url}`);
  const r = spawnSync(process.execPath, [downloader(), pin.url, file], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (r.error || r.status !== 0)
    throw new Error(
      `the download of ${pin.version} failed: ${(r.error?.message || r.stderr || r.stdout || `exit ${r.status}`).trim().split("\n").pop()}`,
    );
  if (!fs.existsSync(file))
    throw new Error(`the download of ${pin.version} left no ${file}`);
  const size = fs.statSync(file).size,
    sha = hashFile(file, "sha512", "base64");
  if (size !== pin.size || sha !== pin.sha512) {
    fs.rmSync(file, { force: true });
    throw new Error(
      `the download of ${pin.version} does not match the pin (${size !== pin.size ? `size ${size}, pin ${pin.size}` : "sha512 differs"}): refused`,
    );
  }
  return file;
}

// --stage's long part goes to --stage-work, started hidden and on its own. Before this returns, download.lock
// names that run (so the status line says `getting <version>` at once) and an old failure is cleared. One run at
// a time: when another one works, nothing is started.
function handOver(version) {
  const d = D();
  fs.mkdirSync(d.dir, { recursive: true });
  const tmp = `${d.lock}.${process.pid}`;
  const lockAs = (pid) =>
    fs.writeFileSync(
      tmp,
      JSON.stringify({ pid, version, at: new Date().toISOString() }),
    );
  // a hard link of a complete file: the lock appears whole, and only once
  lockAs(process.pid);
  try {
    try {
      fs.linkSync(tmp, d.lock);
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const other = downloadRunning();
      if (other) {
        log(
          `--stage: a stage run for ${other.version} is already working (pid ${other.pid})`,
        );
        return 0;
      }
      fs.rmSync(d.lock, { force: true });
      fs.linkSync(tmp, d.lock);
    }
  } finally {
    fs.rmSync(tmp, { force: true });
  }
  clearFailed();
  let child;
  try {
    child = spawn(process.execPath, [SELF, "--stage-work"], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    });
    if (!child.pid) throw new Error("it got no process id");
  } catch (e) {
    fs.rmSync(d.lock, { force: true });
    return fail(`could not start deliver.mjs --stage-work: ${e.message}`, {
      version,
    });
  }
  child.on("error", (e) => log(`deliver.mjs --stage-work: ${e.message}`));
  child.unref();
  lockAs(child.pid);
  fs.renameSync(tmp, d.lock);
  log(
    `--stage: ${version}: deliver.mjs --stage-work started (pid ${child.pid})`,
  );
  return 0;
}

// The --stage logic. Started plain it decides and writes only small files; a download, an install or a patch run
// (the app closed) is handed to --stage-work, which runs this again as `worker`, holding download.lock.
async function stage({ worker = false } = {}) {
  if (process.platform !== "win32") return 0;
  if (isOff()) {
    // the close path is off: waiting panels wait for /update-setup; queued moves keep the marker while the app is
    // still patched (markJob)
    if (isMarker(readJson(D().staged))) {
      log("--stage: delivery is off");
      const install = installDir();
      markJob("--stage", !!install && (await appState(install)).blocked);
    } else log("--stage: delivery is off");
    return 0;
  }
  const install = installDir();
  if (!install) {
    log("--stage: Nimbalyst is not installed");
    return 0;
  }
  const P = appPaths(install),
    d = D();
  if (perMachine(P.res)) {
    log("--stage: per-machine install, can't patch here");
    return 0;
  }
  const pin = readPin();
  let job = readJson(d.staged);
  // a marker job stays only while no Nimbalyst job is staged (markJob below, or overwritten by a new job)
  if (isMarker(job)) job = null;
  if (job?.restore) {
    dropStaged();
    job = null;
    log(
      "--stage: the delivery is on, so the waiting restore of the original is dropped",
    );
  }
  let get = false;
  if (job?.override) log(`--stage: the trial job for ${job.version} stays`);
  else {
    const app = await appState(install),
      status = readJson(d.status);
    const trial =
      status?.ok && status.override && status.version === app.version;
    if (trial || compareVersions(app.version, pin.version) > 0) {
      if (job) dropStaged();
      log(
        `--stage: installed ${app.version}${trial ? " (trial)" : ""} is newer than the pin ${pin.version}: nothing to do`,
      );
      markJob("--stage", app.blocked);
      return 0;
    }
    if (app.version === pin.version && app.complete) {
      if (job) dropStaged();
      log(`--stage: ${pin.version} is in with every fix: nothing to do`);
      markJob("--stage", app.blocked);
      return 0;
    }
    const have =
      job &&
      job.version === pin.version &&
      (job.installer === null
        ? app.version === pin.version
        : fs.existsSync(job.installer ?? ""));
    if (!have) {
      // a job for an older pin (or one whose installer is gone) goes at once, before any status is read
      if (job) {
        dropStaged();
        log(
          `--stage: the job for ${job.version} is dropped; the pin is ${pin.version}`,
        );
      }
      job = null;
      get = app.version !== pin.version;
    }
  }
  // A kept job names the patcher that staged it; after the patcher moves (tools/ up to 26.5, scripts/ since 26.6,
  // and an update deletes the old folder) the quit listener would start a script that is gone.
  if (job && (job.deliver !== SELF || job.node !== process.execPath)) {
    job = { ...job, deliver: SELF, node: process.execPath };
    writeJson(d.staged, job);
    log(`--stage: the job for ${job.version} now names this patcher`);
  }
  const closed = !running(install).length;
  if (!worker && (get || closed)) return handOver(job?.version ?? pin.version);
  if (!job) {
    let installer = null;
    if (get) {
      try {
        installer = download(pin);
      } catch (e) {
        const code = fail(e.message, { version: pin.version });
        // queued moves (or panels) still need the close to start --after-quit
        markJob("--stage", (await appState(install)).blocked);
        return code;
      }
      if (isOff()) {
        dropStaged();
        log(
          "--stage: the delivery was turned off during the download: the installer is dropped",
        );
        markJob("--stage", (await appState(install)).blocked);
        return 0;
      }
    } else if (!worker) clearFailed();
    job = {
      version: pin.version,
      installer,
      node: process.execPath,
      deliver: SELF,
      at: new Date().toISOString(),
      atClose: (await appState(install)).blocked,
    };
    writeJson(d.staged, job);
    log(`--stage: staged ${pin.version}${installer ? "" : " (patches only)"}`);
  }
  if (!running(install).length) return installNow();
  const blocked = (await appState(install)).blocked;
  if (job.atClose !== blocked) {
    job = { ...job, atClose: blocked };
    writeJson(d.staged, job);
  }
  log(
    blocked
      ? `--stage: Nimbalyst is open; ${job.version} installs when it closes`
      : "--stage: Nimbalyst is open and not patched yet; restart to finish",
  );
  return 0;
}

// --stage-work: waits until --stage has handed download.lock to this process, then does the work and frees the lock
async function stageWork() {
  const d = D(),
    end = Date.now() + 10 * 1000;
  while (readJson(d.lock)?.pid !== process.pid) {
    if (Date.now() >= end)
      return fail(
        "deliver.mjs --stage-work: the --stage that started it did not hand download.lock over",
      );
    await new Promise((r) => setTimeout(r, 50));
  }
  try {
    return await stage({ worker: true });
  } finally {
    if (readJson(d.lock)?.pid === process.pid)
      fs.rmSync(d.lock, { force: true });
  }
}

// The restart's message when Nimbalyst.exe is gone after a failed install
export const missingText = (exe, error) =>
  `Nimbalyst could not be updated${error ? `: ${String(error).replace(/\.$/, "")}` : ""}.\n\n${exe} is missing, so Nimbalyst can't start.\n\n${RETRY}`;

async function afterQuit() {
  if (process.platform !== "win32") return 0;
  const job = readJson(D().staged);
  // a marker job still swaps the panels with the delivery off: they are no part of it; queued moves neither
  if (
    !job ||
    (isOff() && !job.restore && !isMarker(job) && !queuedMoves("--after-quit"))
  )
    return 0;
  const install = installDir();
  if (!install) return fail("Nimbalyst is not installed");
  const step = Math.max(50, Math.min(500, QUIT_WAIT_MS / 4)),
    end = Date.now() + QUIT_WAIT_MS;
  while (running(install).length) {
    if (Date.now() >= end) {
      log(
        "--after-quit: Nimbalyst is still (or again) running; the next close tries again",
      );
      return 0;
    }
    await new Promise((r) => setTimeout(r, step));
  }
  const code = await installNow("--after-quit");
  // nobody waits for this run: a Nimbalyst that can't start any more is said on the screen
  const exe = appPaths(install).exe;
  if (code && !fs.existsSync(exe))
    await showMessage(missingText(exe, readJson(D().status)?.error));
  return code;
}

// --off: no delivery, and the original app.asar back so Nimbalyst updates itself again (now, or at the next close).
// Returns the line to print. Queued project moves need a close that starts --after-quit: with Nimbalyst open and
// patched, the restore job's close carries them out; else --off is refused while they wait, saying so.
async function turnOff() {
  const d = D();
  const moves = movesQueue().waiting;
  if (moves && process.platform === "win32") {
    const install = installDir();
    if (
      !install ||
      !fs.existsSync(appPaths(install).orig) ||
      !running(install).length
    )
      throw new Error(
        `${moves} project move${moves > 1 ? "s" : ""} queued while Nimbalyst ran wait${moves > 1 ? "" : "s"} in ${movesFile()} for its close, and with the delivery off nothing would carry ${moves > 1 ? "them" : "it"} out. With Nimbalyst closed, run node "${MOVE_PROJECT}" --run-queued (or delete ${movesFile()} to drop ${moves > 1 ? "them" : "it"}), then run --off again`,
      );
  }
  writeJson(d.off, { at: new Date().toISOString() });
  dropStaged();
  log("--off");
  if (process.platform !== "win32") return "off";
  const install = installDir();
  if (!install) return "off";
  const P = appPaths(install);
  if (!fs.existsSync(P.orig)) {
    if ((await appState(install)).blocked)
      throw new Error(
        `the delivery is off, but Nimbalyst's own updater stays blocked: ${P.orig}, the original to put back, is missing. Reinstall Nimbalyst from its website to get its own updates back`,
      );
    return "off";
  }
  if (running(install).length) {
    writeJson(d.staged, {
      restore: true,
      installer: null,
      node: process.execPath,
      deliver: SELF,
      at: new Date().toISOString(),
    });
    log(
      `--off: Nimbalyst is open; the original app.asar goes back when it closes${moves ? `, and the ${moves} queued project move(s) are carried out then` : ""}`,
    );
    return `off; the original Nimbalyst comes back when it next closes, then it updates itself again${movesNote()}`;
  }
  restoreOriginal(P);
  return "off; the original Nimbalyst is back and updates itself again";
}

async function waitDownload() {
  const end = Date.now() + DOWNLOAD_WAIT_MS;
  while (downloadRunning()) {
    if (Date.now() >= end) return 1;
    await new Promise((r) => setTimeout(r, 250));
  }
  return 0;
}

async function main(argv) {
  const usage =
    "usage: deliver.mjs --status | --stage | --wait | --after-quit | --install-now | --on | --off | --unstage";
  if (argv.length !== 1) {
    console.error(`[nimbalyst-deliver] ${usage}`);
    return 2;
  }
  const a = argv[0];
  try {
    if (a === "--status") {
      console.log(`nimbalyst: ${await statusLine()}`);
      return 0;
    }
    if (a === "--stage") return await stage();
    if (a === "--stage-work") return await stageWork();
    if (a === "--wait") return await waitDownload();
    if (a === "--after-quit") return await afterQuit();
    if (a === "--install-now")
      return process.platform === "win32" ? await installNow() : 0;
    if (a === "--unstage") {
      dropStaged();
      log("--unstage: staged job dropped");
      return 0;
    }
    if (a === "--off") {
      console.log(`nimbalyst: ${await turnOff()}`);
      return 0;
    }
    if (a === "--on") {
      fs.rmSync(D().off, { force: true });
      log("--on");
      const code = await stage();
      console.log(`nimbalyst: ${await statusLine()}`);
      return code;
    }
    console.error(`[nimbalyst-deliver] unknown option ${a}. ${usage}`);
    return 2;
  } catch (e) {
    console.error(`[nimbalyst-deliver] failed: ${e.message}`);
    // a job that broke leaves its error for the status line; --status and the switches only report it
    if (
      [
        "--stage",
        "--stage-work",
        "--after-quit",
        "--install-now",
        "--on",
      ].includes(a)
    )
      try {
        fail(e.message);
      } catch {}
    return 1;
  }
}

// for restart.mjs
export { appState, downloadRunning, installDir, running };

const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
if (process.argv[1] && real(process.argv[1]) === real(SELF))
  process.exitCode = await main(process.argv.slice(2));
