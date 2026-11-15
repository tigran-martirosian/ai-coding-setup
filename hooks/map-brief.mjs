#!/usr/bin/env node
import { crashLog } from "./lib/crash-log.mjs";
// map-brief: PreToolUse hook on the Agent tool. A helper's brief arrives with the Systems map lines for the things the brief touches, and
// only those. Reads the hook JSON on stdin. For tool_name Agent or Task with a subagent_type of worker, worker-full, worker-code, worker-refactor, reviewer, planner or plan-reviewer it
// takes <project>/.claude/systems-map.json ($CLAUDE_PROJECT_DIR), cuts it to the things the prompt is about (skills/systems-map/map.mjs, the
// same as `map.mjs --brief`) and appends that to the prompt. updatedInput replaces the whole tool input, so every other field is copied.
// A prompt that already holds the marker "SYSTEMS MAP:" is left alone. A project with no map file, or one with no nodes, gets no output at
// all; "nothing matched" is said only when a real map exists. Fails open: any error is one line on stderr, exit 0, no map lines.
// serves-brief runs on the same call and only one updatedInput is used, so both build the same full brief (hooks/lib/serves.mjs):
// this hook's output also carries the plan row's Serves lines unless SERVES_BRIEF=off. For the same reason, a worker
// start that serves-brief refuses (the purpose check) is refused here too, with the same text.
// MAP_BRIEF=off disables it.
import { emit, runHook } from "./lib/hook-io.mjs";
import { fullBrief } from "./lib/serves.mjs";

runHook("map-brief", async (event) => {
  const built = await fullBrief(event);
  for (const { part, e } of built?.errors ?? []) {
    if (part !== "map") continue;
    crashLog("map-brief", e);
    process.stderr.write(`map-brief hook skipped: ${e?.name}: ${e?.message}\n`);
  }
  if (built?.deny) return void emit.deny(built.deny);
  if (!built?.input) return;
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: built.input,
      },
    }),
  );
});
