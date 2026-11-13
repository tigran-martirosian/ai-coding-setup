#!/usr/bin/env node
// pc-tidy-nudge: UserPromptSubmit hook. Nimbalyst holds more memory the longer it stays open and nothing
// says when to restart it. When it has been open PC_TIDY_NUDGE_HOURS (default 12) or more, this tells the
// user and has Claude mention /pc-tidy, at most once per that many hours across all sessions. It only
// reminds: stopping things by itself could kill a build another session is running. The process check
// starts PowerShell, so it runs at most once an hour. Windows only, only inside Nimbalyst. Silent for
// /commands. Fails open. PC_TIDY_NUDGE=off disables it.
import { crashLog } from "./crash-log.mjs";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const HOURS = Number(process.env.PC_TIDY_NUDGE_HOURS) || 12;
const HOUR = 60 * 60 * 1000;
const STATE_DIR = process.env.PC_TIDY_NUDGE_DIR || path.join(os.homedir(), ".claude", "hooks", "state");
const STATE_FILE = path.join(STATE_DIR, "pc-tidy-nudge.json");
const OLDEST = "(Get-Process Nimbalyst -ErrorAction Stop | Sort-Object StartTime | Select-Object -First 1).StartTime.ToUniversalTime().ToString('o')";

function hoursOpen() {
  if (process.env.PC_TIDY_NUDGE_TEST_OPEN) return Number(process.env.PC_TIDY_NUDGE_TEST_OPEN);
  let started;
  try { started = execFileSync("powershell", ["-NoProfile", "-Command", OLDEST], { encoding: "utf8", timeout: 4000, windowsHide: true }).trim(); } catch { return NaN; } // Nimbalyst closed or PowerShell slow: no answer, not a crash
  return (Date.now() - Date.parse(started)) / HOUR;
}

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    if (process.env.PC_TIDY_NUDGE === "off" || process.platform !== "win32") return;
    // No variable names Nimbalyst for a hook; the entry point is "sdk-..." in an app, "cli" in the terminal
    if (!/^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "")) return;
    if (String(JSON.parse(raw).prompt ?? "").trim().startsWith("/")) return;

    let state = {};
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
    const now = Date.now();
    if (state.checkedAt && now - state.checkedAt < HOUR) return;
    state.checkedAt = now;
    const save = () => { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(state)); };
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
  } catch (err) {
    crashLog("pc-tidy-nudge", err);
    // fail open
  }
});
