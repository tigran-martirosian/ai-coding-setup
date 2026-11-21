#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crashLog } from "./lib/crash-log.mjs";
// map-brief: PreToolUse hook on the Agent tool. A helper's brief arrives with the Systems map lines for the things the brief touches, and
// only those. Reads the hook JSON on stdin. For tool_name Agent or Task with a subagent_type of worker, worker-full, worker-code, worker-refactor, reviewer or plan-reviewer it
// takes <project>/.claude/systems-map.json ($CLAUDE_PROJECT_DIR), cuts it to the things the prompt is about (skills/systems-map/map.mjs, the
// same as `map.mjs --brief`) and appends that to the prompt. updatedInput replaces the whole tool input, so every other field is copied.
// A prompt that already holds the marker "SYSTEMS MAP:" is left alone. A project with no map file, or one with no nodes, gets no output at
// all; "nothing matched" is said only when a real map exists. Fails open: any error is one line on stderr, exit 0, no map lines.
// The brief is built by hooks/lib/serves.mjs fullBrief, map part only (the Serves lines and the purpose check
// retired with the purpose record). Only its prompt is taken: run_in_background stays as sent (fullBrief's foreground
// would set it to false), so the trial's map arm differs from its none arm only by the map lines.
// Auto mode (permission_mode "auto", lib/hook-io.mjs autoMode): an updatedInput would void the classifier's review,
// so the hook rewrites nothing and the helper starts with its brief as sent (run_in_background not forced either).
// The map lines go to the calling session as additionalContext (it reads them with the tool result, so a foreground
// helper has already returned): send them with SendMessage if the helper still runs, check a returned helper's result
// against them, and put them in the brief of any later helper: the helper never sees the caller's
// context. A brief the map matches nothing in gets no context (no "nothing matched" line to send).
// The trial (memory-and-map spec D4): the hook acts only while ~/.claude/state/map-brief-trial.json ({"until":"YYYY-MM-DD"})
// exists and its date is today (local) or later; with no file, or after the date, it gives no output in any mode. A file
// that can't be read, isn't JSON or has no such date counts as no trial: one line on stderr. During the trial each eligible
// call (the types above, a project map with nodes, a prompt with no "SYSTEMS MAP:" marker yet) gets an arm at random:
// `map` does all of the above, `none` gives no output. Each such call adds one line to ~/.claude/state/map-brief-trial.jsonl:
// {ts, session, toolUseId, cwd, type, arm, mode ("auto" or "rewrite"), brief (the prompt as sent, first 8,000 characters)};
// a private script compares the arms from it. MAP_BRIEF_ARM=map|none fixes the arm (tests).
// MAP_BRIEF=off disables it.
import { autoMode, emit, runHook } from "./lib/hook-io.mjs";
import { loadMap } from "./lib/map-file.mjs";
import { fullBrief, MAP_MARKER, TYPES } from "./lib/serves.mjs";

const STATE = path.join(os.homedir(), ".claude", "state");
const TRIAL = path.join(STATE, "map-brief-trial.json");
const TRIAL_LOG = path.join(STATE, "map-brief-trial.jsonl");
const BRIEF_CHARS = 8000;
const ARMS = ["map", "none"];

// Today as YYYY-MM-DD on the local calendar
const today = () => {
  const d = new Date();
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

// Is the trial on? No file: no. A broken file: no, with one line on stderr.
function trialOn() {
  let text;
  try {
    text = fs.readFileSync(TRIAL, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return false;
    process.stderr.write(
      `map-brief: trial file unreadable, hook off: ${e.message}\n`,
    );
    return false;
  }
  let until;
  try {
    until = JSON.parse(text.replace(/^﻿/, ""))?.until;
  } catch (e) {
    process.stderr.write(
      `map-brief: trial file is not JSON, hook off: ${e.message}\n`,
    );
    return false;
  }
  if (typeof until !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(until)) {
    process.stderr.write(
      `map-brief: trial file has no "until": "YYYY-MM-DD", hook off\n`,
    );
    return false;
  }
  return until >= today();
}

const skipped = (e) => {
  crashLog("map-brief", e);
  process.stderr.write(`map-brief hook skipped: ${e?.name}: ${e?.message}\n`);
};

// A call the trial counts: a covered helper type, a prompt with no map lines yet, a project map with nodes
function eligible(event) {
  const input = event.tool_input;
  if (
    !["Agent", "Task"].includes(event.tool_name) ||
    !input ||
    typeof input !== "object"
  )
    return false;
  if (!TYPES.has(input.subagent_type) || typeof input.prompt !== "string")
    return false;
  if (input.prompt.includes(MAP_MARKER) || !process.env.CLAUDE_PROJECT_DIR)
    return false;
  const map = loadMap(process.env.CLAUDE_PROJECT_DIR);
  return Array.isArray(map?.nodes) && map.nodes.length > 0;
}

function pickArm() {
  const fixed = process.env.MAP_BRIEF_ARM;
  if (fixed) {
    if (!ARMS.includes(fixed))
      throw new Error(`MAP_BRIEF_ARM is "${fixed}", not map or none`);
    return fixed;
  }
  return ARMS[Math.random() < 0.5 ? 0 : 1];
}

runHook("map-brief", async (event) => {
  if (!trialOn()) return;
  let ok;
  try {
    ok = eligible(event);
  } catch (e) {
    return void skipped(e);
  }
  if (!ok) return;
  const arm = pickArm();
  const line = {
    ts: new Date().toISOString(),
    session: event.session_id ?? null,
    toolUseId: event.tool_use_id ?? null,
    cwd: event.cwd ?? null,
    type: event.tool_input.subagent_type,
    arm,
    mode: autoMode(event) ? "auto" : "rewrite",
    brief: event.tool_input.prompt.slice(0, BRIEF_CHARS),
  };
  try {
    fs.mkdirSync(STATE, { recursive: true });
    fs.appendFileSync(TRIAL_LOG, `${JSON.stringify(line)}\n`);
  } catch (e) {
    skipped(e);
  }
  if (arm === "none") return;
  const built = await fullBrief(event);
  for (const { part, e } of built?.errors ?? []) {
    if (part !== "map") continue;
    skipped(e);
  }
  if (built?.deny) return void emit.deny(built.deny);
  if (autoMode(event)) {
    if (built?.matched)
      emit.context(
        "PreToolUse",
        "map-brief: this helper ran with its brief as sent, without the systems map lines below (in auto mode " +
          "the hook rewrites nothing), and a helper never sees your context. If it is still running, send it these " +
          "lines now with SendMessage; if it has already returned, check its result against them. Put them in the " +
          "brief of any later helper on this work (a brief that holds them is left alone). Run " +
          `helpers in the background as usual.\n\n${built.map.trim()}`,
      );
    return;
  }
  if (!built?.input) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...event.tool_input, prompt: built.input.prompt },
      },
    }),
  );
});
