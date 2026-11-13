#!/usr/bin/env node
// map-brief: PreToolUse hook on the Agent tool. A helper's brief arrives with the Systems map lines for the things the brief touches, and
// only those. Reads the hook JSON on stdin. For tool_name Agent or Task with a subagent_type of worker, worker-full, reviewer or planner it
// takes <project>/.claude/systems-map.json ($CLAUDE_PROJECT_DIR), cuts it to the things the prompt is about (skills/systems-map/map.mjs, the
// same as `map.mjs --brief`) and appends that to the prompt. updatedInput replaces the whole tool input, so every other field is copied.
// A prompt that already holds the marker "SYSTEMS MAP:" is left alone. A project with no map file, or one with no nodes, gets no output at
// all; "nothing matched" is said only when a real map exists. Fails open: any error is one line on stderr, exit 0, no output.
// MAP_BRIEF=off disables it.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const TYPES = new Set(["worker", "worker-full", "reviewer", "planner"]);
const MARKER = "SYSTEMS MAP:";
const MAP_JS = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "skills", "systems-map", "map.mjs");

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", async () => {
  try {
    if (process.env.MAP_BRIEF === "off") return;
    const event = JSON.parse(raw);
    const input = event.tool_input;
    if (!["Agent", "Task"].includes(event.tool_name) || !input || typeof input !== "object") return;
    const prompt = input.prompt;
    if (!TYPES.has(input.subagent_type) || typeof prompt !== "string" || prompt.includes(MARKER)) return;

    const project = process.env.CLAUDE_PROJECT_DIR;
    if (!project) return;
    let map;
    try {
      map = JSON.parse(fs.readFileSync(path.join(project, ".claude", "systems-map.json"), "utf8").replace(/^﻿/, ""));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    if (!Array.isArray(map?.nodes) || !map.nodes.length) return;

    const { brief, CMD } = await import(pathToFileURL(MAP_JS).href);
    const head =
      "\n\nSYSTEMS MAP: the project's dictionary of what connects to what, cut to the things this brief touches. A change to one of these " +
      "links means checking the thing at the other end, or naming it under Outside the brief.\n";
    const tail = `\nMore: ${CMD} --near <thing>; --near alone lists every thing.`;
    const none = `\n\nSYSTEMS MAP: nothing in this brief matched. ${CMD} --near lists every thing; --near <thing> gives its links.`;
    const lines = brief(prompt, map, project).trim();
    const updated = { ...input, prompt: prompt + (lines ? head + lines + tail : none) };
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", updatedInput: updated } }));
  } catch (e) {
    process.stderr.write(`map-brief hook skipped: ${e?.name}: ${e?.message}\n`);
  }
});
