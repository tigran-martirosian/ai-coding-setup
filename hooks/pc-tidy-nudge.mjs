#!/usr/bin/env node
// pc-tidy-nudge: UserPromptSubmit hook. Nimbalyst holds more memory the longer it stays open and nothing
// says when to restart it. When it has been open PC_TIDY_NUDGE_HOURS (default 12) or more, this tells the
// user and has Claude mention /pc-tidy, at most once per that many hours across all sessions. It only
// reminds: stopping things by itself could kill a build another session is running. The process check
// starts PowerShell, so it runs at most once an hour. Windows only, only inside Nimbalyst. Silent for
// /commands. Fails open. PC_TIDY_NUDGE=off disables it.
// It also runs the chat archive (workers/disk-tidy.mjs --auto --archive-only) at most once every 3 days, on
// every system, once the person has turned the archive on (~/.claude/disk-tidy.json). The run is detached,
// so the prompt never waits; when it archived or deleted something, the next prompt shows its one line.
import { runHook, inNimbalyst } from "./lib/hook-io.mjs";
import { stateFile, readJson, writeJson, STATE_DIR } from "./lib/state.mjs";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOURS = Number(process.env.PC_TIDY_NUDGE_HOURS) || 12;
const HOUR = 60 * 60 * 1000;
const ARCHIVE_EVERY = 3 * 24 * HOUR;
const STATE_FILE = stateFile("pc-tidy-nudge", "nudge");
const ARCHIVE_STATE = stateFile("pc-tidy-nudge", "disk-archive");
const ARCHIVE_NOTE = path.join(STATE_DIR, "pc-tidy-nudge", "disk-archive-note.txt");
const OLDEST = "(Get-Process Nimbalyst -ErrorAction Stop | Sort-Object StartTime | Select-Object -First 1).StartTime.ToUniversalTime().ToString('o')";

function hoursOpen() {
  if (process.env.PC_TIDY_NUDGE_TEST_OPEN) return Number(process.env.PC_TIDY_NUDGE_TEST_OPEN);
  let started;
  try { started = execFileSync("powershell", ["-NoProfile", "-Command", OLDEST], { encoding: "utf8", timeout: 4000, windowsHide: true }).trim(); } catch { return NaN; } // Nimbalyst closed or PowerShell slow: no answer, not a crash
  return (Date.now() - Date.parse(started)) / HOUR;
}

// The line of the last archive run, once; and a new run when 3 days have passed and the person said yes
function archiveNote() {
  let note = "";
  if (fs.existsSync(ARCHIVE_NOTE)) { note = fs.readFileSync(ARCHIVE_NOTE, "utf8").trim(); fs.rmSync(ARCHIVE_NOTE, { force: true }); }
  const cfg = readJson(path.join(os.homedir(), ".claude", "disk-tidy.json")) ?? {};
  const worker = path.join(os.homedir(), ".claude", "workers", "disk-tidy.mjs");
  if (!cfg.archive?.afterDays || cfg.archive.off || !fs.existsSync(worker)) return note;
  const state = readJson(ARCHIVE_STATE) ?? {};
  if (state.ranAt && Date.now() - state.ranAt < ARCHIVE_EVERY) return note;
  if (state.startedAt && Date.now() - state.startedAt < HOUR) return note; // one run at a time; a failed one is tried again an hour on
  writeJson(ARCHIVE_STATE, { ...state, startedAt: Date.now() });
  spawn(process.execPath, ["-e", RUN_ARCHIVE, worker, ARCHIVE_NOTE, ARCHIVE_STATE], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  return note;
}
// the detached run: ranAt is saved only when the worker exits 0; a failure leaves a note the next prompt shows once
const RUN_ARCHIVE = `const { spawnSync } = require("node:child_process"); const fs = require("node:fs");
const [worker, note, stateFile] = process.argv.slice(1);
const r = spawnSync(process.execPath, [worker, "--auto", "--archive-only", "--note-file", note], { encoding: "utf8", windowsHide: true });
if (r.status === 0) fs.writeFileSync(stateFile, JSON.stringify({ ranAt: Date.now() }));
else fs.writeFileSync(note, "disk: the chat archive run failed (" + (String(r.stderr || r.error || "exit " + r.status).trim().split(/\\r?\\n/)[0] || "exit " + r.status) + "); it tries again in an hour. Run: node ~/.claude/workers/disk-tidy.mjs --auto --archive-only");`;

function nimbalystNudge() {
  if (process.platform !== "win32" || !inNimbalyst()) return null;
  const state = readJson(STATE_FILE) ?? {};
  const now = Date.now();
  if (state.checkedAt && now - state.checkedAt < HOUR) return null;
  state.checkedAt = now;
  const save = () => writeJson(STATE_FILE, state);
  save();

  const open = hoursOpen();
  if (!(open >= HOURS)) return null;
  if (state.nudgedAt && now - state.nudgedAt < HOURS * HOUR) return null;
  state.nudgedAt = now;
  save();
  return Math.floor(open);
}

runHook("pc-tidy-nudge", (event) => {
  if (String(event.prompt ?? "").trim().startsWith("/")) return;
  const note = archiveNote();
  const hours = nimbalystNudge();
  if (hours === null) {
    if (note) process.stdout.write(JSON.stringify({ systemMessage: note }));
    return;
  }
  process.stdout.write(JSON.stringify({
    systemMessage: [note, `Nimbalyst has been open ${hours} hours. Restart it once no session is working. /pc-tidy shows what is holding memory.`].filter(Boolean).join("\n"),
    hookSpecificOutput: {
      hookEventName: "UserPromptSubmit",
      additionalContext: [
        `[pc-tidy-nudge] Nimbalyst has been open ${hours} hours, and it holds more memory the longer it stays open.`,
        "- Do the user's request first. At the end of your reply, say once, in one line, to restart Nimbalyst once no session is working, and that /pc-tidy shows what is holding memory.",
        "- Don't run /pc-tidy without a yes, don't restart anything yourself, and don't repeat this on later turns.",
      ].join("\n"),
    },
  }));
});
