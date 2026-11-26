// PC status and Start Nimbalyst (actions 1 and 2 of the PC program design). Nimbalyst's own .exe is one of the
// three programs the PC program may start: a fixed path, no arguments, no shell. Before a start, Windows' tasklist
// (a fixed path under SystemRoot, fixed arguments, no shell) says whether Nimbalyst.exe already runs.
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listProjects, watchEndpoint } from "../../bot/nimbalyst.mjs";
import { projectCounts } from "../core/db.mjs";
import { listProjects as doorProjects, patchTools } from "../core/door.mjs";
import {
  NIMBALYST_MARKER,
  nimbalystResources,
  readText,
  updateCheckPath,
} from "../core/files.mjs";
import { log } from "../core/log.mjs";
import { DRY, testOverride } from "../core/mode.mjs";
import { ActionError } from "../core/registry.mjs";

const PLATFORM = testOverride("PHONE_PC_PLATFORM") || process.platform;

const OPEN_WAIT_MS = 2 * 60 * 1000;
const EARLY_EXIT_MS = 60 * 1000;
const VERSION = /^\d+(\.\d+)*$/;

let starting = null; // { since } while a start runs
let lastStart = null; // "failed" after a start that did not open

// ---- pc.status's read fields: a source that can't be read gives null, and the reason goes to the log once
// per change (pc.status is asked on every page open).

const lastWhy = new Map();
function unread(field, why) {
  if (lastWhy.get(field) !== why) {
    lastWhy.set(field, why);
    log("status", `${field} unread: ${why}`);
  }
  return null;
}
const readOk = (field) => lastWhy.delete(field);

// 26.1 is newer than 1.0.114: number by number, a missing part counts as 0 (as hooks/update-check.mjs compares).
export function newer(a, b) {
  const [x, y] = [a, b].map((v) => String(v).split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
}

function readJson(file) {
  const text = readText(file);
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`${file} is not valid JSON: ${e.message}`);
  }
}

// The newest released setup, from the update check the setup's hook stores every 12 hours (the same version
// /update-setup would install). { version } when it is newer than this PC's, else null.
export function setupUpdate(installed) {
  let stored;
  try {
    stored = readJson(updateCheckPath());
  } catch (e) {
    return unread(
      "update",
      e.code === "ENOENT" ? "no update check stored yet" : e.message,
    );
  }
  if (typeof stored.latest !== "string" || !VERSION.test(stored.latest))
    return unread("update", "the stored update check has no newest version");
  readOk("update");
  return newer(stored.latest, installed) ? { version: stored.latest } : null;
}

// Nimbalyst's version: the setup's patch marker (written when it patched this install), else the app's own
// package.json beside it.
export function nimbalystVersion() {
  let dir;
  try {
    dir = nimbalystResources();
  } catch (e) {
    return unread("nimbalystVersion", e.message);
  }
  for (const [name, app] of [
    [NIMBALYST_MARKER, null],
    ["package.json", "@nimbalyst/electron"],
  ]) {
    let d;
    try {
      d = readJson(path.join(dir, name));
    } catch (e) {
      if (e.code === "ENOENT") continue;
      return unread("nimbalystVersion", e.message);
    }
    if (app && d.name !== app)
      return unread("nimbalystVersion", `${name} is not ${app}'s`);
    if (typeof d.version !== "string" || !VERSION.test(d.version))
      return unread("nimbalystVersion", `${name} has no version`);
    readOk("nimbalystVersion");
    return d.version;
  }
  return unread(
    "nimbalystVersion",
    `no ${NIMBALYST_MARKER} or package.json in ${dir}`,
  );
}

// Sessions that need the user or are working, in the projects Nimbalyst lists. Only while it is open.
function sessionsOpen(state) {
  if (state !== "open") return unread("sessionsOpen", `Nimbalyst is ${state}`);
  try {
    const listed = new Set(doorProjects().map((p) => p.path));
    let n = 0;
    for (const [project, c] of projectCounts())
      if (listed.has(project)) n += (c.needsYou || 0) + (c.working || 0);
    readOk("sessionsOpen");
    return n;
  } catch (e) {
    return unread("sessionsOpen", e.message);
  }
}

// Which door patch tools are present (read once per Nimbalyst start). Only while it is open.
async function doorFlags(state) {
  if (state !== "open") return unread("door", `Nimbalyst is ${state}`);
  try {
    const flags = await patchTools();
    readOk("door");
    return flags;
  } catch (e) {
    return unread("door", e.extra?.message || e.extra?.why || e.message);
  }
}

function nimbalystState() {
  if (starting) return "starting";
  try {
    listProjects();
    return "open";
  } catch (e) {
    if (e.code !== "NOT_RUNNING") throw e;
    return lastStart === "failed" ? "failed" : "closed";
  }
}

// The fixed command: %LOCALAPPDATA%\Programs\Nimbalyst\Nimbalyst.exe, no arguments.
export function startCommand() {
  if (PLATFORM !== "win32")
    throw new ActionError("not-offered", { why: "Windows only" });
  if (!process.env.LOCALAPPDATA)
    throw new Error("LOCALAPPDATA is not set: cannot find Nimbalyst");
  return {
    file: path.join(
      process.env.LOCALAPPDATA,
      "Programs",
      "Nimbalyst",
      "Nimbalyst.exe",
    ),
    args: [],
    options: { detached: true, stdio: "ignore", shell: false },
  };
}

// Whether this user runs a program with the file name of `file`, from tasklist's CSV lines ("Nimbalyst.exe","1234",
// ...). Other lines (the "no tasks" note, in the system's language) name no program. Another user's copy (another
// Windows session on the PC) does not count: it is not the one the phone talks to.
function programRuns(file) {
  if (!process.env.SystemRoot)
    throw new Error("SystemRoot is not set: cannot find tasklist");
  const name = path.basename(file);
  const user = process.env.USERNAME || os.userInfo().username;
  const who = process.env.USERDOMAIN
    ? `${process.env.USERDOMAIN}\\${user}`
    : user;
  return new Promise((resolve, reject) => {
    execFile(
      path.win32.join(process.env.SystemRoot, "System32", "tasklist.exe"),
      [
        "/FI",
        `IMAGENAME eq ${name}`,
        "/FI",
        `USERNAME eq ${who}`,
        "/FO",
        "CSV",
        "/NH",
      ],
      { shell: false, windowsHide: true, timeout: 15_000 },
      (e, stdout) => {
        if (e) return reject(new Error(`tasklist failed: ${e.message}`));
        const want = `"${name.toLowerCase()}",`;
        resolve(
          stdout
            .split(/\r?\n/)
            .some((l) => l.trim().toLowerCase().startsWith(want)),
        );
      },
    );
  });
}

function watchStart(child, push) {
  const since = Date.now();
  starting = { since };
  const finish = (state) => {
    if (!starting || starting.since !== since) return;
    starting = null;
    lastStart = state === "open" ? null : "failed";
    clearInterval(poll);
    log("nimbalyst", state);
    push({ e: "status", d: { nimbalyst: state } });
  };
  const poll = setInterval(() => {
    try {
      listProjects();
      finish("open");
    } catch {
      if (Date.now() - since > OPEN_WAIT_MS) finish("failed");
    }
  }, 2000);
  child.on("exit", () => {
    if (Date.now() - since < EARLY_EXIT_MS) finish("failed");
  });
  child.on("error", () => finish("failed"));
}

export function register(registry) {
  watchEndpoint();

  registry.add({
    name: "pc.status",
    run: async (_d, ctx) => {
      const nimbalyst = nimbalystState();
      return {
        pcName: os.hostname(),
        setupVersion: ctx.setupVersion,
        nimbalystVersion: nimbalystVersion(),
        update: setupUpdate(ctx.setupVersion),
        nimbalyst,
        sessionsOpen: sessionsOpen(nimbalyst),
        door: await doorFlags(nimbalyst),
        page: ctx.page,
        asOf: new Date().toISOString(),
      };
    },
  });

  registry.add({
    name: "nimbalyst.start",
    run: async (_d, ctx) => {
      const state = nimbalystState();
      if (state === "open" || state === "starting")
        throw new ActionError("already-open", { state });
      const cmd = startCommand();
      if (DRY) {
        log("dry", "would start Nimbalyst");
        return { state: "starting", dry: { file: cmd.file, args: cmd.args } };
      }
      if (!fs.existsSync(cmd.file))
        throw new ActionError("nimbalyst-missing", { file: cmd.file });
      // Nimbalyst runs but its endpoint file is gone, so it reads closed. A second copy would quit at once (and, as
      // it quits, delete the endpoint file of the running one), so the phone would read "failed". A check that
      // cannot run is logged and Start goes on as it did before the check.
      let runs = false;
      try {
        runs = await programRuns(cmd.file);
      } catch (e) {
        log(
          "nimbalyst",
          `could not check whether Nimbalyst.exe runs: ${e.message}`,
        );
      }
      if (runs) {
        log("nimbalyst", "start refused: Nimbalyst.exe already runs");
        throw new ActionError("nimbalyst-running", {
          message:
            "Nimbalyst is already running on the PC, but the phone cannot reach it. Restart Nimbalyst on the PC.",
        });
      }
      if (starting || nimbalystState() === "open")
        throw new ActionError("already-open", { state: nimbalystState() });
      const child = spawn(cmd.file, cmd.args, cmd.options);
      child.unref();
      log("nimbalyst", "starting");
      watchStart(child, ctx.push);
      return { state: "starting" };
    },
  });
}
