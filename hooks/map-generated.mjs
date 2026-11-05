#!/usr/bin/env node
// map-generated: PreToolUse hook on Edit, MultiEdit, Write and NotebookEdit. Refuses a hand edit of a file that a script writes, as listed under
// "generated" in the project's Systems map (<project>/.claude/systems-map.json, $CLAUDE_PROJECT_DIR, or the nearest map above a worktree file):
// the next run of that script would undo the edit, and the script would go on saying the old thing (the point of the map is that one fact has one home).
// The refusal names the script and the command that reruns it.
// Silent for every other file and for a project with no map. Fails open: any error is one line on stderr, exit 0. MAP_GENERATED=off disables it.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import path from "node:path";

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    if (process.env.MAP_GENERATED === "off") return;
    const event = JSON.parse(raw);
    const input = event?.tool_input;
    const edited = input && typeof input === "object" ? input.file_path ?? input.notebook_path : null;
    if (typeof edited !== "string" || !edited) return;
    const project = process.env.CLAUDE_PROJECT_DIR;
    if (!project) return;
    let dir = path.resolve(project);
    const file = path.resolve(dir, edited);
    const outside = (d) => { const r = path.relative(d, file).replace(/\\/g, "/"); return !r || r.startsWith("../") || r === ".." || path.isAbsolute(r); };
    if (outside(dir)) {
      let up = path.dirname(file);
      while (!fs.existsSync(path.join(up, ".claude", "systems-map.json")) && path.dirname(up) !== up) up = path.dirname(up);
      if (!fs.existsSync(path.join(up, ".claude", "systems-map.json"))) return;
      dir = up;
    }
    const rel = path.relative(dir, file).replace(/\\/g, "/").toLowerCase();

    let map;
    try {
      map = JSON.parse(fs.readFileSync(path.join(dir, ".claude", "systems-map.json"), "utf8").replace(/^﻿/, ""));
    } catch (e) {
      if (e.code === "ENOENT") return;
      throw e;
    }
    const norm = (p) => (typeof p === "string" ? p.replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").toLowerCase() : "");
    const g = (Array.isArray(map?.generated) ? map.generated : []).find((x) => Array.isArray(x?.files) && x.files.some((f) => norm(f) === rel));
    if (!g || typeof g.by !== "string") return;
    const inputs = Array.isArray(g.inputs) && g.inputs.length ? ` (or its inputs ${g.inputs.join(", ")})` : "";
    const reason =
      `[map-generated] Refused: ${path.relative(dir, file).replace(/\\/g, "/")} is written by ${g.by}, so a hand edit is undone by its next run and the ` +
      `script keeps the old text. Change ${g.by}${inputs} instead, then run \`${g.run ?? g.by}\` (the "generated" list in .claude/systems-map.json).`;
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: reason } }));
  } catch (e) {
    crashLog("map-generated", e);
    process.stderr.write(`map-generated hook skipped: ${e?.name}: ${e?.message}\n`);
  }
});
