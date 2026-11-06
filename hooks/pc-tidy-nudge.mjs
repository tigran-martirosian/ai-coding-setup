#!/usr/bin/env node
// pc-tidy-nudge: UserPromptSubmit hook. Nimbalyst holds more memory the longer it stays open and nothing
// says when to restart it. When it has been open PC_TIDY_NUDGE_HOURS (default 12) or more, this tells the
// user and has Claude mention /pc-tidy, at most once per that many hours across all sessions. It only
// reminds: stopping things by itself could kill a build another session is running. The process check
// starts PowerShell, so it runs at most once an hour. Windows only, only inside Nimbalyst. Silent for
// /commands. Fails open. PC_TIDY_NUDGE=off disables it.
import { runHook, inNimbalyst } from "./lib/hook-io.mjs";
import { stateFile, readJson, writeJson } from "./lib/state.mjs";
import { execFileSync } from "node:child_process";

const HOURS = Number(process.env.PC_TIDY_NUDGE_HOURS) || 12;
const HOUR = 60 * 60 * 1000;
const STATE_FILE = stateFile("pc-tidy-nudge", "nudge");
const OLDEST = "(Get-Process Nimbalyst -ErrorAction Stop | Sort-Object StartTime | Select-Object -First 1).StartTime.ToUniversalTime().ToString('o')";

function hoursOpen() {
  if (process.env.PC_TIDY_NUDGE_TEST_OPEN) return Number(process.env.PC_TIDY_NUDGE_TEST_OPEN);
  let started;
  try { started = execFileSync("powershell", ["-NoProfile", "-Command", OLDEST], { encoding: "utf8", timeout: 4000, windowsHide: true }).trim(); } catch { return NaN; } // Nimbalyst closed or PowerShell slow: no answer, not a crash
  return (Date.now() - Date.parse(started)) / HOUR;
}

runHook("pc-tidy-nudge", (event) => {
  if (process.platform !== "win32" || !inNimbalyst()) return;
  if (String(event.prompt ?? "").trim().startsWith("/")) return;

  const state = readJson(STATE_FILE) ?? {};
  const now = Date.now();
  if (state.checkedAt && now - state.checkedAt < HOUR) return;
  state.checkedAt = now;
  const save = () => writeJson(STATE_FILE, state);
  save();

  const open = hoursOpen();
  if (!(open >= HOURS)) return;
  if (state.nudgedAt && now - state.nudgedAt < HOURS * HOUR) return;
  state.nudgedAt = now;
  save();

  const hours = Math.floor(open);
  process.stdout.write(JSON.stringify({
    systemMessage: `Nimbalyst has been open ${hours} hours. Restart it once no session is working. /pc-tidy shows what is holding memory.`,
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
