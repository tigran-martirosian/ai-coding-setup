#!/usr/bin/env node
// ext-swap: puts the Nimbalyst extensions the setup built in place of the ones Nimbalyst loads. Windows and macOS.
// Plain Node, no npm dependencies, no imports from the repo's scripts/ (the installed copy lives in
// ~/.claude/scripts/nimbalyst-patch/).
//
// A running Nimbalyst reads its extension folders after start (new windows, Ctrl+R, readaloud's backend,
// boardtidy's pick.mjs), so a build is never written into them. The installer (scripts/extensions.mjs) builds into
// <data>/extensions-pending/.part/<folder> and renames that to <data>/extensions-pending/<folder> when the build
// ended well. This module swaps each pending folder in, only while Nimbalyst is not running: the live
// <data>/extensions/<folder> is renamed aside (to extensions-pending/.old/<folder>), the pending one is renamed in,
// the old one is deleted. When the second rename fails, the old folder is put back and the pending one stays.
// A name starting with a dot (.part, .old) is never swapped.
// <data> is Nimbalyst's own folder: %APPDATA%\@nimbalyst\electron, or ~/Library/Application Support/@nimbalyst/electron.
//
//   ext-swap.mjs --swap         swaps now when Nimbalyst is closed; one line per folder
//   ext-swap.mjs --after-quit   starts itself again on its own (Windows: outside Nimbalyst's process tree, through
//                               restart.mjs's startOutside) and returns; that run waits up to 2 minutes for
//                               Nimbalyst to end, then swaps. Each step goes to extensions-pending/swap.log
//   ext-swap.mjs --status       one line: "extensions: waiting: <folder>, ..." or "extensions: nothing waiting"
//
// Environment overrides (tests): SETUP_NIMBALYST_OPEN=yes|no says whether Nimbalyst runs (as in the installer);
// SETUP_NIMBALYST_OPEN_FILE=<file> makes it count as running while that file exists (it wins over the first);
// EXT_SWAP_WAIT_MS the wait of --after-quit.
//
// Exit codes: 0 done or nothing to do; 1 Nimbalyst runs, a swap failed or the wait ran out; 2 bad usage.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const RUN = "--after-quit-run";
const WAIT_MS = Number(process.env.EXT_SWAP_WAIT_MS || 2 * 60 * 1000);

// ---- places ----

/** Nimbalyst's own data folder (the one holding extensions/). */
export function nimbalystData() {
  const appData =
    process.platform === "darwin"
      ? path.join(os.homedir(), "Library", "Application Support")
      : process.env.APPDATA;
  if (!appData)
    throw new Error("APPDATA is not set, so Nimbalyst's folder is unknown");
  return path.join(appData, "@nimbalyst", "electron");
}
export const liveDir = (data = nimbalystData()) =>
  path.join(data, "extensions");
export const pendingDir = (data = nimbalystData()) =>
  path.join(data, "extensions-pending");
/** Where the installer builds one extension before it counts as pending. */
export const partDir = (data = nimbalystData()) =>
  path.join(pendingDir(data), ".part");

/** The folders waiting to go in, sorted; .part, .old and files are not among them. */
export function pendingNames(data = nimbalystData()) {
  const dir = pendingDir(data);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

// ---- is Nimbalyst running ----

/** Whether a Nimbalyst process runs (the installer's check, scripts/theme.mjs, with its test switches). */
export function nimbalystRunning() {
  if (process.env.SETUP_NIMBALYST_OPEN_FILE)
    return fs.existsSync(process.env.SETUP_NIMBALYST_OPEN_FILE);
  if (process.env.SETUP_NIMBALYST_OPEN)
    return process.env.SETUP_NIMBALYST_OPEN === "yes";
  if (process.platform === "win32") {
    const r = spawnSync(
      "tasklist",
      ["/FI", "IMAGENAME eq Nimbalyst.exe", "/NH"],
      { encoding: "utf8", windowsHide: true },
    );
    if (r.error || r.status !== 0)
      throw new Error(
        `tasklist failed, so it is unknown whether Nimbalyst runs: ${(r.error?.message || r.stderr || `exit ${r.status}`).trim()}`,
      );
    return /Nimbalyst\.exe/i.test(r.stdout || "");
  }
  // pgrep: exit 0 found, 1 not found, anything else an error
  const r = spawnSync("pgrep", ["-x", "Nimbalyst"], { encoding: "utf8" });
  if (r.error || (r.status !== 0 && r.status !== 1))
    throw new Error(
      `pgrep failed, so it is unknown whether Nimbalyst runs: ${(r.error?.message || r.stderr || `exit ${r.status}`).trim()}`,
    );
  return r.status === 0;
}

// ---- the swap ----

/**
 * Swaps every pending folder in, when Nimbalyst is not running. Returns { running, swapped: [folder],
 * failed: [{ folder, error }] }; with running true nothing was moved. `log` gets one line per step;
 * `rename` is fs.renameSync (the tests make it fail).
 */
export function swapPending({
  data = nimbalystData(),
  log = () => {},
  rename = fs.renameSync,
} = {}) {
  const names = pendingNames(data);
  const result = { running: false, swapped: [], failed: [] };
  if (!names.length) return result;
  if (nimbalystRunning()) {
    result.running = true;
    log(`Nimbalyst runs; waiting: ${names.join(", ")}`);
    return result;
  }
  const live = liveDir(data);
  const old = path.join(pendingDir(data), ".old");
  fs.mkdirSync(live, { recursive: true });
  fs.mkdirSync(old, { recursive: true });
  for (const folder of names) {
    const from = path.join(pendingDir(data), folder);
    const to = path.join(live, folder);
    const aside = path.join(old, folder);
    try {
      fs.rmSync(aside, { recursive: true, force: true });
      const hadLive = fs.existsSync(to);
      if (hadLive) rename(to, aside);
      try {
        rename(from, to);
      } catch (e) {
        if (hadLive)
          try {
            rename(aside, to);
          } catch (back) {
            throw new Error(
              `${e.message}; the old folder could not be put back from ${aside}: ${back.message}`,
            );
          }
        throw e;
      }
    } catch (e) {
      result.failed.push({ folder, error: e.message });
      log(`${folder}: not swapped, it stays pending: ${e.message}`);
      continue;
    }
    result.swapped.push(folder);
    log(`${folder}: swapped in`);
    try {
      fs.rmSync(aside, { recursive: true, force: true });
    } catch (e) {
      log(
        `${folder}: the old copy in ${aside} is left (the next swap deletes it): ${e.message}`,
      );
    }
  }
  return result;
}

// ---- the command line ----

function fileLog(line) {
  const dir = pendingDir();
  fs.mkdirSync(dir, { recursive: true });
  fs.appendFileSync(
    path.join(dir, "swap.log"),
    `${new Date().toISOString()} [${process.pid}] ${line}\n`,
  );
}

function swapLine(r) {
  if (r.running)
    return `extensions: Nimbalyst runs; waiting: ${pendingNames().join(", ")}`;
  const parts = [];
  if (r.swapped.length) parts.push(`swapped in: ${r.swapped.join(", ")}`);
  for (const f of r.failed) parts.push(`not swapped: ${f.folder} (${f.error})`);
  return `extensions: ${parts.join("; ") || "nothing waiting"}`;
}

// Starts this file again with RUN, on its own: on Windows outside Nimbalyst's process tree, so its quit can't end it
async function detach() {
  if (process.platform === "win32") {
    // loaded here, not at the top: restart.mjs loads deliver.mjs, which loads this file
    const { startOutside } = await import("./restart.mjs");
    return startOutside(process.execPath, [SELF, RUN], HERE);
  }
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SELF, RUN], {
      cwd: HERE,
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

async function afterQuitRun() {
  const end = Date.now() + WAIT_MS;
  while (nimbalystRunning()) {
    if (Date.now() >= end) {
      fileLog(
        `--after-quit: Nimbalyst still runs after ${WAIT_MS / 1000} s; waiting: ${pendingNames().join(", ")}`,
      );
      return 1;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const r = swapPending({ log: (l) => fileLog(`--after-quit: ${l}`) });
  return r.running || r.failed.length ? 1 : 0;
}

async function main(argv) {
  const usage = "usage: ext-swap.mjs --swap | --after-quit | --status";
  if (argv.length !== 1) {
    console.error(`[ext-swap] ${usage}`);
    return 2;
  }
  const a = argv[0];
  try {
    if (a === "--status") {
      const names = pendingNames();
      console.log(
        `extensions: ${names.length ? `waiting: ${names.join(", ")}` : "nothing waiting"}`,
      );
      return 0;
    }
    if (a === "--swap") {
      const r = swapPending({ log: (l) => fileLog(`--swap: ${l}`) });
      console.log(swapLine(r));
      return r.running || r.failed.length ? 1 : 0;
    }
    if (a === "--after-quit") {
      const pid = await detach();
      fileLog(`--after-quit: started "${SELF}" ${RUN} on its own (pid ${pid})`);
      console.log(
        "extensions: they go in once Nimbalyst has closed (up to 2 minutes from now)",
      );
      return 0;
    }
    if (a === RUN) return await afterQuitRun();
    console.error(`[ext-swap] unknown option ${a}. ${usage}`);
    return 2;
  } catch (e) {
    console.error(`[ext-swap] failed: ${e.message}`);
    try {
      fileLog(`${a}: failed: ${e.message}`);
    } catch {}
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
// No top-level await: a run started here imports restart.mjs -> deliver.mjs, and deliver.mjs may import this
// file; an await at the top would leave this module unfinished while that import waits for it.
if (process.argv[1] && real(process.argv[1]) === real(SELF))
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
