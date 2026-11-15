#!/usr/bin/env node
import fs from "node:fs";
// map-drift: PostToolUse hook on Edit, MultiEdit, Write and NotebookEdit. When the file just edited backs a link of the project's Systems map
// as tokened evidence ({ "file", "token" } in <project>/.claude/systems-map.json, $CLAUDE_PROJECT_DIR) and the file no longer holds the token,
// the model gets one line per such link: check the thing at the other end, then fix the link's evidence or drop the link. Silent for every
// other file, for path-only evidence and for a project with no map. Each project + file + link is said once an hour. Never blocks.
// Fails open: any error is one line on stderr, exit 0. MAP_DRIFT=off disables it.
// State: ~/.claude/hooks/state/map-drift/said.json.
import { emit, runHook } from "./lib/hook-io.mjs";
import { loadMap, mapFolderFor, normRel } from "./lib/map-file.mjs";
import { readJson, stateFile, writeJson } from "./lib/state.mjs";

const HOUR = 60 * 60 * 1000;
const STATE_FILE = stateFile("map-drift", "said");

runHook("map-drift", (event) => {
  try {
    const input = event?.tool_input;
    const edited =
      input && typeof input === "object"
        ? (input.file_path ?? input.notebook_path)
        : null;
    if (typeof edited !== "string" || !edited) return;
    const project = process.env.CLAUDE_PROJECT_DIR;
    if (!project) return;
    // A file outside the project (a git worktree of it, such as a helper's) is checked against the map of the
    // nearest folder above it that has one, so a worktree helper's edits are checked too
    const at = mapFolderFor(project, edited);
    if (!at) return;
    const { dir, file } = at;
    const rel = at.rel.toLowerCase();

    const map = loadMap(dir);
    if (!Array.isArray(map?.links)) return;
    const name = new Map(
      (Array.isArray(map.nodes) ? map.nodes : [])
        .filter((n) => n && typeof n.id === "string")
        .map((n) => [n.id, n.name || n.id]),
    );

    // The tokened evidence of this file, one per link
    const found = new Map();
    for (const l of map.links) {
      if (!l || !Array.isArray(l.evidence)) continue;
      for (const e of l.evidence) {
        if (
          !e ||
          typeof e !== "object" ||
          typeof e.file !== "string" ||
          typeof e.token !== "string" ||
          !e.token
        )
          continue;
        if (normRel(e.file) !== rel) continue;
        const key = `${l.from} -> ${l.to}`;
        if (!found.has(key))
          found.set(key, { link: l, token: e.token, file: e.file });
      }
    }
    if (!found.size) return;

    let text;
    try {
      text = fs.readFileSync(file, "utf8");
    } catch {
      return;
    } // a deleted file is for --check
    const lost = [...found].filter(([, f]) => !text.includes(f.token));
    if (!lost.length) return;

    const state = readJson(STATE_FILE) ?? {};
    const now = Date.now();
    for (const k of Object.keys(state))
      if (!(now - state[k] < HOUR)) delete state[k];
    const lines = [];
    for (const [arrow, f] of lost) {
      const k = `${dir.replace(/\\/g, "/")}|${rel}|${arrow}`;
      if (state[k]) continue;
      state[k] = now;
      const l = f.link;
      lines.push(
        `[map-drift] ${f.file} backs the link ${name.get(l.from) ?? l.from} -> ${name.get(l.to) ?? l.to} ("${l.says ?? ""}") and no longer has "${f.token}". ` +
          `Before done: check ${name.get(l.to) ?? l.to} still holds, then fix that link's evidence in .claude/systems-map.json or drop the link.`,
      );
    }
    if (!lines.length) return;
    writeJson(STATE_FILE, state);
    emit.context("PostToolUse", lines.join("\n"));
  } catch (e) {
    process.stderr.write(`map-drift hook skipped: ${e?.name}: ${e?.message}\n`);
    throw e; // runHook logs it and ends with exit 0
  }
});
