#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
// map-nudge: UserPromptSubmit hook, run by the dispatcher's prompt group. Two nudges:
// - Build: a project with 100 or more tracked code files (git ls-files, code extensions only, no vendored folders)
//   holding 10,000 or more lines, and no .claude/systems-map.json, gets one line of context: ask the user once, on a
//   question card (recommended answer yes), whether to build the map now from skills/systems-map/SKILL.md, and start
//   the background worker only on yes. It is asked once per project, ever (askedAt in the state), whatever the answer.
//   The ask counts as spent once that session's transcript shows the card (askedIn); a session that never showed it
//   (a headless claude -p run) gives it back, and the next session asks again.
//   The lines are counted only up to 10,000, from at most 2,000 files, 256 KB of each and 8 MB in all, so the count
//   stays cheap. A project the old version gave up on (tries 3 or more: it built without asking, up to 3 tries) counts
//   as asked.
// - Refresh: a project whose map lists files that are mostly gone or changed under a link (more than 20 %) gets a
//   line to start a background worker that refreshes it, without asking, at most once a week: upkeep of a map the
//   user already has.
// A linked git worktree (.git is a file) stays silent, or each new one would start its own build. A folder that is not
// a git repository counts as no. A map file with no nodes (for example {"handledBy": "..."}: the project keeps its own
// map) means silence. Project = $CLAUDE_PROJECT_DIR. Each project is looked at once a day at most, so a prompt costs
// one small file read. Silent for /commands. Fails open. MAP_NUDGE=off disables it.
// State: ~/.claude/hooks/state/map-nudge/projects.json.
import { emit, runHook } from "./lib/hook-io.mjs";
import { loadMap } from "./lib/map-file.mjs";
import { readJson, stateFile, writeJson } from "./lib/state.mjs";

const MIN_CODE_FILES = 100;
const MIN_CODE_LINES = 10000;
const LINE_FILES_CAP = 2000;
const LINE_BYTES_CAP = 256 * 1024;
const LINE_TOTAL_CAP = 8 * 1024 * 1024;
const OLD_MAX_TRIES = 3;
const CARD_READ_CAP = 8 * 1024 * 1024;
const STALE_SHARE = 0.2;
const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
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

// Do the files hold MIN_CODE_LINES lines? Stops at that many; reads at most LINE_FILES_CAP files, LINE_BYTES_CAP of
// each and LINE_TOTAL_CAP in all, so a project of many tiny files or of huge one-line files counts as no. A file that
// can't be read counts as no lines.
function enoughLines(dir, files) {
  const buf = Buffer.alloc(LINE_BYTES_CAP);
  let lines = 0;
  let left = LINE_TOTAL_CAP;
  for (const rel of files.slice(0, LINE_FILES_CAP)) {
    if (left <= 0) return false;
    let fd;
    try {
      fd = fs.openSync(path.join(dir, rel), "r");
      const n = fs.readSync(fd, buf, 0, Math.min(LINE_BYTES_CAP, left), 0);
      left -= n;
      for (let i = 0; i < n && lines < MIN_CODE_LINES; i++)
        if (buf[i] === 10) lines++;
      if (n && buf[n - 1] !== 10) lines++;
    } catch {
      continue;
    } finally {
      if (fd !== undefined) fs.closeSync(fd);
    }
    if (lines >= MIN_CODE_LINES) return true;
  }
  return false;
}

// Did the asked session show the question card? A question tool call (AskUserQuestion, or Nimbalyst's
// PromptForUserInput) naming the Systems map in its transcript, after the nudge, in at most CARD_READ_CAP bytes.
// No transcript, or one that can't be read, counts as no.
function cardShown({ transcript, from = 0 }) {
  if (!transcript) return false;
  let text;
  try {
    const fd = fs.openSync(transcript, "r");
    try {
      const buf = Buffer.alloc(CARD_READ_CAP);
      text = buf.toString(
        "utf8",
        0,
        fs.readSync(fd, buf, 0, CARD_READ_CAP, from),
      );
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return false;
  }
  return text
    .split("\n")
    .some(
      (line) =>
        /"type":"tool_use"/.test(line) &&
        /"name":"(AskUserQuestion|[\w-]*PromptForUserInput)"/.test(line) &&
        /systems map/i.test(line),
    );
}

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
    if (!rec.askedAt && rec.tries >= OLD_MAX_TRIES) {
      rec.askedAt = rec.nudgedAt ?? now;
      save();
    }
    // The ask is spent once the asked session's transcript shows the card. A session that never showed it (a
    // headless claude -p run) gives the ask back at the next session's first prompt, which asks again now.
    let again = false;
    if (rec.askedIn && event.session_id !== rec.askedIn.session) {
      if (cardShown(rec.askedIn)) delete rec.askedIn;
      else {
        delete rec.askedAt;
        again = true;
      }
      delete rec.askedIn;
      save();
    }
    if (rec.askedAt || (!again && rec.checkedAt && now - rec.checkedAt < DAY))
      return;
    rec.checkedAt = now;
    save();
    let code;
    try {
      const { trackedFiles, isCode } = await import(pathToFileURL(MAP_JS).href);
      code = trackedFiles(dir).filter(isCode);
    } catch {
      return;
    } // not a git repository: no
    if (code.length < MIN_CODE_FILES || !enoughLines(dir, code)) return;
    rec.askedAt = now;
    rec.askedIn = {
      session: event.session_id,
      transcript: event.transcript_path,
      from: event.transcript_path
        ? (fs.statSync(event.transcript_path, { throwIfNoEntry: false })
            ?.size ?? 0)
        : 0,
    };
    save();
    say(
      [
        `[map-nudge] This project has ${code.length} tracked code files (10,000 or more lines) and no Systems map (.claude/systems-map.json): the dictionary of its parts and what connects to what, which the briefs of helpers get their lines from.`,
        "- Ask the user once, on a question card (AskUserQuestion), whether to build a Systems map for this project now, in the background; recommended answer: yes.",
        `- Only if the user answers yes, start one background worker: ${worker("build", dir)}`,
        "- On no, start nothing. Either way, carry on with the user's request.",
        "- This question is asked once for this project; it does not come back, so don't repeat it on later turns.",
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
