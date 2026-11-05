#!/usr/bin/env node
// map-nudge: UserPromptSubmit hook. A project with 100 or more tracked code files (git ls-files, code extensions only, no vendored
// folders) and no .claude/systems-map.json gets one line of context: start a background worker now, without asking, to build the map from
// skills/systems-map/SKILL.md, and tell the user in one line. At most 3 times, a week apart: a build can be killed or refused, and the prompt
// can be a headless run that starts no worker. A linked git worktree (.git is a file) stays silent, or each new one would start its own build.
// A project whose map lists files that are mostly gone (more than 20 %)
// gets the same for a refresh, at most once a week. A folder that is not a git repository counts as no. A map file with no nodes (for example
// {"handledBy": "..."}: the project keeps its own map) means silence. Project = $CLAUDE_PROJECT_DIR. Each project is looked at once a day
// at most, so a prompt costs one small file read. Silent for /commands. Fails open. MAP_NUDGE=off disables it.
// State: ~/.claude/hooks/state/map-nudge.json (MAP_NUDGE_DIR moves it).
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MIN_CODE_FILES = 100;
const STALE_SHARE = 0.2;
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const MAX_TRIES = 3;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_JS = path.join(HERE, "..", "skills", "systems-map", "map.mjs");
const SKILL_MD = path.resolve(HERE, "..", "skills", "systems-map", "SKILL.md").replace(/\\/g, "/");
const STATE_DIR = process.env.MAP_NUDGE_DIR || path.join(os.homedir(), ".claude", "hooks", "state");
const STATE_FILE = path.join(STATE_DIR, "map-nudge.json");

const worker = (what, dir) =>
  `Agent tool, subagent_type "worker", run_in_background true, description "Systems map: ${what} for this project", ` +
  `prompt "${what[0].toUpperCase()}${what.slice(1)} this project's Systems map. Read ${SKILL_MD} and follow it. Project folder: ${dir}. Budget about 60 tool calls."`;

const emit = (text) =>
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: text } }));

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  try {
    if (process.env.MAP_NUDGE === "off") return;
    if (String(JSON.parse(raw).prompt ?? "").trim().startsWith("/")) return;
    const project = process.env.CLAUDE_PROJECT_DIR;
    if (!project) return;
    const dir = path.resolve(project);
    const key = dir.replace(/\\/g, "/");
    if (fs.statSync(path.join(dir, ".git"), { throwIfNoEntry: false })?.isFile()) return;

    let map = null;
    try {
      map = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "systems-map.json"), "utf8").replace(/^﻿/, ""));
    } catch (e) {
      if (e.code !== "ENOENT") return; // a map file that does not parse is for --check, not for a nudge
    }
    if (map && !(Array.isArray(map.nodes) && map.nodes.length)) return;

    let state = {};
    try { state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8")); } catch {}
    const rec = state[key] ?? {};
    const now = Date.now();
    const save = () => {
      state[key] = rec;
      fs.mkdirSync(STATE_DIR, { recursive: true });
      fs.writeFileSync(STATE_FILE, JSON.stringify(state));
    };

    if (!map) {
      if ((rec.tries ?? 0) >= MAX_TRIES || (rec.nudgedAt && now - rec.nudgedAt < WEEK) || (rec.checkedAt && now - rec.checkedAt < DAY)) return;
      rec.checkedAt = now;
      save();
      let count = 0;
      try { count = (await import(pathToFileURL(MAP_JS).href)).countCodeFiles(dir); } catch { return; } // not a git repository: no
      if (count < MIN_CODE_FILES) return;
      rec.nudgedAt = now;
      rec.tries = (rec.tries ?? 0) + 1;
      save();
      emit(
        [
          `[map-nudge] This project has ${count} tracked code files and no Systems map (.claude/systems-map.json): the dictionary of its parts and what connects to what, which the briefs of helpers get their lines from.`,
          `- Without asking, start one background worker now: ${worker("build", dir)}`,
          "- Carry on with the user's request, and tell the user in one line that the map is being built in the background.",
          "- Say this once; don't repeat it on later turns.",
        ].join("\n"),
      );
      return;
    }

    if (rec.checkedAt && now - rec.checkedAt < DAY) return;
    rec.checkedAt = now;
    save();
    if (rec.staleNudgedAt && now - rec.staleNudgedAt < WEEK) return;
    const { missingPaths, drift } = await import(pathToFileURL(MAP_JS).href);
    const { total, gone } = missingPaths(map, dir);
    const changed = drift(map, dir).length;
    const stale = gone.length + changed;
    if (!total || stale / total <= STALE_SHARE) return;
    rec.staleNudgedAt = now;
    save();
    emit(
      [
        `[map-nudge] The Systems map of this project (.claude/systems-map.json) is out of date: ${stale} of the ${total} files it lists (${Math.round((100 * stale) / total)} %) are gone or changed under a link.`,
        `- Without asking, start one background worker now to refresh it: ${worker("refresh", dir)}`,
        "- Carry on with the user's request, and tell the user in one line that the map is being refreshed in the background.",
        "- Say this once; don't repeat it on later turns.",
      ].join("\n"),
    );
  } catch (err) {
    crashLog("map-nudge", err);
    // fail open
  }
});
