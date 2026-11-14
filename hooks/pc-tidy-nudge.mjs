#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// pc-tidy-nudge: UserPromptSubmit hook. It runs the chat archive (workers/disk-tidy.mjs --auto --archive-only) at
// most once every 3 days, on every system, once the person has turned the archive on (~/.claude/disk-tidy.json). The
// run is detached, so the prompt never waits; when it archived or deleted something, the next prompt shows its one
// line. Silent for /commands. Fails open. PC_TIDY_NUDGE=off disables it.
// It says nothing about how long Nimbalyst has been open: /pc-tidy's report says to restart it after a day open.
import { runHook } from "./lib/hook-io.mjs";
import { readJson, STATE_DIR, stateFile, writeJson } from "./lib/state.mjs";

const HOUR = 60 * 60 * 1000;
const ARCHIVE_EVERY = 3 * 24 * HOUR;
const ARCHIVE_STATE = stateFile("pc-tidy-nudge", "disk-archive");
const ARCHIVE_NOTE = path.join(
  STATE_DIR,
  "pc-tidy-nudge",
  "disk-archive-note.txt",
);
// The line of the last archive run, once; and a new run when 3 days have passed and the person said yes
function archiveNote() {
  let note = "";
  if (fs.existsSync(ARCHIVE_NOTE)) {
    note = fs.readFileSync(ARCHIVE_NOTE, "utf8").trim();
    fs.rmSync(ARCHIVE_NOTE, { force: true });
  }
  const cfg =
    readJson(path.join(os.homedir(), ".claude", "disk-tidy.json")) ?? {};
  const worker = path.join(os.homedir(), ".claude", "workers", "disk-tidy.mjs");
  if (!cfg.archive?.afterDays || cfg.archive.off || !fs.existsSync(worker))
    return note;
  const state = readJson(ARCHIVE_STATE) ?? {};
  if (state.ranAt && Date.now() - state.ranAt < ARCHIVE_EVERY) return note;
  if (state.startedAt && Date.now() - state.startedAt < HOUR) return note; // one run at a time; a failed one is tried again an hour on
  writeJson(ARCHIVE_STATE, { ...state, startedAt: Date.now() });
  spawn(
    process.execPath,
    ["-e", RUN_ARCHIVE, worker, ARCHIVE_NOTE, ARCHIVE_STATE],
    { detached: true, stdio: "ignore", windowsHide: true },
  ).unref();
  return note;
}
// the detached run: ranAt is saved only when the worker exits 0; a failure leaves a note the next prompt shows once
const RUN_ARCHIVE = `const { spawnSync } = require("node:child_process"); const fs = require("node:fs");
const [worker, note, stateFile] = process.argv.slice(1);
const r = spawnSync(process.execPath, [worker, "--auto", "--archive-only", "--note-file", note], { encoding: "utf8", windowsHide: true });
if (r.status === 0) fs.writeFileSync(stateFile, JSON.stringify({ ranAt: Date.now() }));
else fs.writeFileSync(note, "disk: the chat archive run failed (" + (String(r.stderr || r.error || "exit " + r.status).trim().split(/\\r?\\n/)[0] || "exit " + r.status) + "); it tries again in an hour. Run: node ~/.claude/workers/disk-tidy.mjs --auto --archive-only");`;

runHook("pc-tidy-nudge", (event) => {
  if (
    String(event.prompt ?? "")
      .trim()
      .startsWith("/")
  )
    return;
  const note = archiveNote();
  if (note) process.stdout.write(JSON.stringify({ systemMessage: note }));
});
