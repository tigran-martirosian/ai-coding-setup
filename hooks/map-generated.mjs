#!/usr/bin/env node
// map-generated: PreToolUse hook on Edit, MultiEdit, Write and NotebookEdit. Refuses a hand edit of a file that a script writes, as listed under
// "generated" in the project's Systems map (<project>/.claude/systems-map.json, $CLAUDE_PROJECT_DIR, or the nearest map above a worktree file):
// the next run of that script would undo the edit, and the script would go on saying the old thing (the point of the map is that one fact has one home).
// The refusal names the script and the command that reruns it.
// Silent for every other file and for a project with no map. Fails open: any error is one line on stderr, exit 0. MAP_GENERATED=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { loadMap, mapFolderFor, normRel } from "./lib/map-file.mjs";

runHook("map-generated", (event) => {
  try {
    const input = event?.tool_input;
    const edited = input && typeof input === "object" ? input.file_path ?? input.notebook_path : null;
    if (typeof edited !== "string" || !edited) return;
    const project = process.env.CLAUDE_PROJECT_DIR;
    if (!project) return;
    const at = mapFolderFor(project, edited);
    if (!at) return;
    const rel = at.rel.toLowerCase();

    const map = loadMap(at.dir);
    if (!map) return;
    const g = (Array.isArray(map?.generated) ? map.generated : []).find((x) => Array.isArray(x?.files) && x.files.some((f) => normRel(f) === rel));
    if (!g || typeof g.by !== "string") return;
    const inputs = Array.isArray(g.inputs) && g.inputs.length ? ` (or its inputs ${g.inputs.join(", ")})` : "";
    emit.deny(
      `[map-generated] Refused: ${at.rel} is written by ${g.by}, so a hand edit is undone by its next run and the ` +
      `script keeps the old text. Change ${g.by}${inputs} instead, then run \`${g.run ?? g.by}\` (the "generated" list in .claude/systems-map.json).`);
  } catch (e) {
    process.stderr.write(`map-generated hook skipped: ${e?.name}: ${e?.message}\n`);
    throw e; // runHook logs it and ends with exit 0
  }
});
