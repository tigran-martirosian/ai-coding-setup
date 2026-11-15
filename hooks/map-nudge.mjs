#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// map-nudge: UserPromptSubmit hook. A project with 100 or more tracked code files (git ls-files, code extensions only, no vendored
// folders) and no .claude/systems-map.json gets one line of context: start a background worker now, without asking, to build the map from
// skills/systems-map/SKILL.md, and tell the user in one line. At most 3 times, a week apart: a build can be killed or refused, and the prompt
// can be a headless run that starts no worker. A linked git worktree (.git is a file) stays silent, or each new one would start its own build.
// A project whose map lists files that are mostly gone (more than 20 %)
// gets the same for a refresh, at most once a week. A folder that is not a git repository counts as no. A map file with no nodes (for example
// {"handledBy": "..."}: the project keeps its own map) means silence. Project = $CLAUDE_PROJECT_DIR. Each project is looked at once a day
// at most, so a prompt costs one small file read. Silent for /commands. Fails open. MAP_NUDGE=off disables it.
// State: ~/.claude/hooks/state/map-nudge/projects.json.
import { emit, runHook } from "./lib/hook-io.mjs";
import { loadMap } from "./lib/map-file.mjs";
import { readJson, stateFile, writeJson } from "./lib/state.mjs";

const MIN_CODE_FILES = 100;
const STALE_SHARE = 0.2;
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const MAX_TRIES = 3;
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MAP_JS = path.join(HERE, "..", "skills", "systems-map", "map.mjs");
const SKILL_MD = path
  .resolve(HERE, "..", "skills", "systems-map", "SKILL.md")
  .replace(/\\/g, "/");
const STATE_FILE = stateFile("map-nudge", "projects");

const worker = (what, dir) =>
  `Agent tool, subagent_type "worker", run_in_background true, description "Systems map: ${what} for this project", ` +
  `prompt "${what[0].toUpperCase()}${what.slice(1)} this project's Systems map. Read ${SKILL_MD} and follow it. Project folder: ${dir}. Budget about 50 tool calls."`;

const say = (text) => emit.context("UserPromptSubmit", text);

runHook("map-nudge", async (event) => {
  if (
    String(event.prompt ?? "")
      .trim()
      .startsWith("/")
  )
    return;
  const project = process.env.CLAUDE_PROJECT_DIR;
  if (!project) return;
  const dir = path.resolve(project);
  const key = dir.replace(/\\/g, "/");
  if (fs.statSync(path.join(dir, ".git"), { throwIfNoEntry: false })?.isFile())
    return;

  let map = null;
  try {
    map = loadMap(dir);
  } catch {
    return;
  } // a map file that does not read or parse is for --check, not for a nudge
  if (map && !(Array.isArray(map.nodes) && map.nodes.length)) return;

  const state = readJson(STATE_FILE) ?? {};
  const rec = state[key] ?? {};
  const now = Date.now();
  const save = () => {
    state[key] = rec;
    writeJson(STATE_FILE, state);
  };

  if (!map) {
    if (
      (rec.tries ?? 0) >= MAX_TRIES ||
      (rec.nudgedAt && now - rec.nudgedAt < WEEK) ||
      (rec.checkedAt && now - rec.checkedAt < DAY)
    )
      return;
    rec.checkedAt = now;
    save();
    let count = 0;
    try {
      count = (await import(pathToFileURL(MAP_JS).href)).countCodeFiles(dir);
    } catch {
      return;
    } // not a git repository: no
    if (count < MIN_CODE_FILES) return;
    rec.nudgedAt = now;
    rec.tries = (rec.tries ?? 0) + 1;
    save();
    say(
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
  say(
    [
      `[map-nudge] The Systems map of this project (.claude/systems-map.json) is out of date: ${stale} of the ${total} files it lists (${Math.round((100 * stale) / total)} %) are gone or changed under a link.`,
      `- Without asking, start one background worker now to refresh it: ${worker("refresh", dir)}`,
      "- Carry on with the user's request, and tell the user in one line that the map is being refreshed in the background.",
      "- Say this once; don't repeat it on later turns.",
    ].join("\n"),
  );
});
