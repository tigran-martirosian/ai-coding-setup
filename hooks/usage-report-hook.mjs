#!/usr/bin/env node
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
// usage-report-hook (Stop): when a turn ends, at most once every 3 hours, it starts workers/usage-report.mjs in a
// detached process (scan the day's transcripts into a content-free aggregate, then send yesterday's once a day) and
// exits at once — so a turn never waits on scanning or the network. The collector reads content locally, keeps only
// counts and short labels, and never sends prompts, replies, code, names, paths, URLs or accounts. See
// workers/usage-report.mjs. THROWAWAY: replaced
// later by the Stratus backend behind a "Help improve Stratus" opt-in. Off: USAGE_REPORT=off (env or a
// settings.json "env"). The hook reads no event, so it does not use runHook.
import { crashLog } from "./lib/crash-log.mjs";

const EVERY_MS = 3 * 60 * 60 * 1000;
const home =
  process.env.USAGE_REPORT_HOME || path.join(os.homedir(), ".claude");
const dir = path.join(home, "usage-report");
const stamp = path.join(dir, "scan.stamp");
const worker = fileURLToPath(
  new URL("../workers/usage-report.mjs", import.meta.url),
);

// Off switch: process env first, then ~/.claude settings "env" (settings env may not reach a hook process).
function isOff() {
  if (process.env.USAGE_REPORT)
    return (process.env.USAGE_REPORT || "").toLowerCase() === "off";
  for (const f of ["settings.local.json", "settings.json"]) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(home, f), "utf8"));
      const s = (j?.env?.USAGE_REPORT || "").toLowerCase();
      if (s) return s === "off";
    } catch {}
  }
  return false;
}

try {
  if (!isOff()) {
    let recent = false;
    try {
      recent = Date.now() - fs.statSync(stamp).mtimeMs < EVERY_MS;
    } catch {}
    if (!recent) {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(stamp, ""); // written first, so parallel sessions don't all start the collector
      spawn(process.execPath, [worker], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    }
  }
} catch (e) {
  try {
    crashLog("usage-report-hook", e);
  } catch {}
}
process.exit(0);
