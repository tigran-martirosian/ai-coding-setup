#!/usr/bin/env node
// update-check: UserPromptSubmit hook. Once a day it asks GitHub whether a newer version of this
// setup is released (version.json on the main branch) and, if so, says it in one line and has Claude
// mention /update-setup. It never downloads or changes anything: the update itself is
// skills/update-setup/update.mjs, started by the user. The installed version is the one install.mjs
// wrote to ~/.claude/setup-state.json; a setup with no version on record counts as older.
// The day's answer is kept in ~/.claude/update-check.json, so every other prompt costs one file read.
// Offline, or GitHub not answering within 4 seconds: silent, and the next prompt tries again.
// Fails open. UPDATE_CHECK=off disables it. SETUP_UPDATE_BASE points it at another address (tests).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const CLAUDE = path.join(process.env.SETUP_UPDATE_HOME || os.homedir(), ".claude");
const BASE = process.env.SETUP_UPDATE_BASE;
const VERSION_URL = BASE ? `${BASE}/version.json` : "https://raw.githubusercontent.com/tigran-martirosian/ai-coding-setup/main/version.json";
const DAY = 24 * 60 * 60 * 1000;
const json = (file) => { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return {}; } };
// 1.10.0 is newer than 1.9.2: compared number by number
const newer = (a, b) => {
  const [x, y] = [a, b].map((v) => String(v || "0").split(".").map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  return false;
};

if (process.env.UPDATE_CHECK !== "off") {
  try {
    const stateFile = path.join(CLAUDE, "update-check.json");
    const last = json(stateFile);
    if (!(Date.now() - new Date(last.checkedAt || 0).getTime() < DAY)) {
      const res = await fetch(VERSION_URL, { signal: AbortSignal.timeout(4000) });
      if (res.ok) {
        const latest = await res.json();
        const installed = json(path.join(CLAUDE, "setup-state.json")).version || "0";
        fs.writeFileSync(stateFile, JSON.stringify({ checkedAt: new Date().toISOString(), latest: latest.version }) + "\n");
        if (newer(latest.version, installed)) {
          const what = latest.summary ? ` ${latest.summary}` : "";
          const context = [
            `[update-check] A newer version of the Claude Code setup is released: ${latest.version} (installed: ${installed === "0" ? "an older one" : installed}).${what}`,
            `- Do the user's request first. At the end of your reply, say once, in one line, that a setup update is ready and that typing /update-setup installs it.`,
            `- Don't install it unless the user asks. This reminder comes at most once a day; don't repeat it on later turns.`,
          ].join("\n");
          process.stdout.write(JSON.stringify({
            systemMessage: `Setup update ready: version ${latest.version}.${what} Type /update-setup to install it.`,
            hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
          }));
        }
      }
    }
  } catch {
    // fail open
  }
}
