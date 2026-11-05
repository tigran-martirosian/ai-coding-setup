#!/usr/bin/env node
// update-check: UserPromptSubmit hook. Every 12 hours it asks GitHub whether a newer version of this
// setup is released (version.json on the main branch) and, if so, says it in one line and has Claude
// mention /update-setup. It also reads CHANGELOG.md (at the same time, same wait) and says how many releases
// the user is behind and what came in since, so someone weeks behind sees what the update brings, not one
// line about the newest hotfix. No changelog in time: the one-line notice as before. It never downloads or changes anything: the update itself is
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
const RAW = BASE || "https://raw.githubusercontent.com/tigran-martirosian/ai-coding-setup/main";
const VERSION_URL = `${RAW}/version.json`;
const CHANGES_URL = `${RAW}/CHANGELOG.md`;
const NOTES_MAX = 12; // release lines handed to Claude, newest first
const NOTE_CHARS = 240;
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
      let latest, changelog = "";
      try {
        const wait = last.error === TIMED_OUT ? WAIT_SLOW : WAIT;
        const [v, c] = await Promise.allSettled([get(VERSION_URL, wait), get(CHANGES_URL, wait)]);
        if (v.status === "rejected") throw v.reason;
        latest = JSON.parse(v.value);
        if (c.status === "fulfilled") changelog = String(c.value); // the changelog only adds detail
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
          const yours = installed === "0" ? "an older one" : installed;
          // "- 1.0.84 (Nov 3, 2026): text" lines newer than the installed version, up to the released one
          const missed = [...changelog.matchAll(/^- (\d+(?:\.\d+)*) \([^)]*\): (.+)$/gm)]
            .filter(([, ver]) => newer(ver, installed) && !newer(ver, latest.version));
          const many = missed.length >= 2;
          const notes = missed.slice(0, NOTES_MAX).map(([, ver, text]) => `  - ${ver}: ${text.length > NOTE_CHARS ? text.slice(0, NOTE_CHARS) + "…" : text}`);
          const context = [
            `[update-check] A newer version of the Claude Code setup is released: ${latest.version} (installed: ${yours}).${what}`,
            many
              ? `- The user is ${missed.length} releases behind. Do the user's request first. At the end of your reply, under a short "Setup update" heading, say in three to five plain bullets what the update brings them: the biggest changes from the release notes below, in what they gain (less usage, fewer mistakes, new commands). Then say that typing /update-setup installs it and keeps their own files and skills. Calm and concrete, no alarm.`
              : `- Do the user's request first. At the end of your reply, say once, in one line, that a setup update is ready and that typing /update-setup installs it.`,
            `- Don't install it unless the user asks. This reminder comes at most every 12 hours; don't repeat it on later turns.`,
            ...(many ? [`Release notes since ${yours}, newest first${missed.length > NOTES_MAX ? ` (the ${NOTES_MAX} newest of ${missed.length})` : ""}:`, ...notes] : []),
          ].join("\n");
          const behind = many ? ` You are ${missed.length} releases behind (on ${yours}): fixes and improvements you don't have yet.` : what;
          process.stdout.write(JSON.stringify({
            systemMessage: `Setup update ready: version ${latest.version}.${behind} Type /update-setup to install it; your own files and skills are kept.`,
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
