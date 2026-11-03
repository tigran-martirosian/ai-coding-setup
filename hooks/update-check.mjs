#!/usr/bin/env node
// update-check: UserPromptSubmit hook. Every 12 hours it asks GitHub whether a newer version of this
// setup is released (version.json on the main branch) and, if so, says it in one line and has Claude
// mention /update-setup. It never downloads or changes anything: the update itself is
// skills/update-setup/update.mjs, started by the user. The installed version is the one install.mjs
// wrote to ~/.claude/setup-state.json; a setup with no version on record counts as older.
// The answer is kept in ~/.claude/update-check.json, so every other prompt costs one file read.
// Offline, or GitHub not answering within 0.7 seconds (2.5 on the try after a timeout, so a slow line still hears of an
// update): silent to the user, so a prompt never waits long. The failure
// is written into update-check.json (failedAt and error, cleared by the next good answer) and the check is not tried
// again for an hour, so an offline prompt costs one file read, not a wait for every prompt.
// Fails open. UPDATE_CHECK=off disables it. SETUP_UPDATE_BASE points it at another address (tests).
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";

const CLAUDE = path.join(process.env.SETUP_UPDATE_HOME || os.homedir(), ".claude");
const BASE = process.env.SETUP_UPDATE_BASE;
const VERSION_URL = BASE ? `${BASE}/version.json` : "https://raw.githubusercontent.com/tigran-martirosian/ai-coding-setup/main/version.json";
const EVERY = 12 * 60 * 60 * 1000;
const RETRY = 60 * 60 * 1000; // after a failed check
const WAIT = 700; // ms a prompt may wait for GitHub
const WAIT_SLOW = 2500; // the same, when the last try ran out of time
const TIMED_OUT = "no answer in time";
const json = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
// 1.10.0 is newer than 1.9.2: compared number by number
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v || "0").split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};
// Reads an address, following redirects. Not fetch: on Windows, Node can crash when a process ends
// right after one.
const get = (url, ms, hops = 5) => new Promise((resolve, reject) => {
  const req = (url.startsWith("https:") ? https : http).get(url, { timeout: ms, headers: { "user-agent": "setup-update" } }, (res) => {
    if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location && hops > 0) {
      res.resume();
      return resolve(get(new URL(res.headers.location, url).href, ms, hops - 1));
    }
    if (res.statusCode !== 200) { res.resume(); return reject(new Error(`HTTP ${res.statusCode}`)); }
    const parts = [];
    res.on("data", (d) => parts.push(d));
    res.on("end", () => resolve(Buffer.concat(parts)));
    res.on("error", reject);
  });
  req.on("timeout", () => req.destroy(new Error(TIMED_OUT)));
  req.on("error", reject);
});

if (process.env.UPDATE_CHECK !== "off") {
  try {
    const stateFile = path.join(CLAUDE, "update-check.json");
    const last = json(stateFile);
    const within = (at, ms) => Date.now() - new Date(at || 0).getTime() < ms;
    if (!within(last.checkedAt, EVERY) && !within(last.failedAt, RETRY)) {
      let latest;
      try {
        latest = JSON.parse(await get(VERSION_URL, last.error === TIMED_OUT ? WAIT_SLOW : WAIT));
      } catch (e) {
        // Remember the failure (and why) instead of trying again on every prompt
        fs.writeFileSync(stateFile, JSON.stringify({ ...last, failedAt: new Date().toISOString(), error: String(e.message || e) }) + "\n");
        latest = null; // offline, a timeout or an HTTP error: kept in update-check.json above, and not a crash
      }
      if (latest?.version) {
        const installed = json(path.join(CLAUDE, "setup-state.json")).version || "0";
        fs.writeFileSync(stateFile, JSON.stringify({ checkedAt: new Date().toISOString(), latest: latest.version }) + "\n");
        if (newer(latest.version, installed)) {
          const what = latest.summary ? ` ${latest.summary}` : "";
          const context = [
            `[update-check] A newer version of the Claude Code setup is released: ${latest.version} (installed: ${installed === "0" ? "an older one" : installed}).${what}`,
            `- Do the user's request first. At the end of your reply, say once, in one line, that a setup update is ready and that typing /update-setup installs it.`,
            `- Don't install it unless the user asks. This reminder comes at most every 12 hours; don't repeat it on later turns.`,
          ].join("\n");
          process.stdout.write(JSON.stringify({
            systemMessage: `Setup update ready: version ${latest.version}.${what} Type /update-setup to install it.`,
            hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
          }));
        }
      }
    }
  } catch (err) {
    crashLog("update-check", err);
    // fail open
  }
}
