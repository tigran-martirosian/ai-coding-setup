#!/usr/bin/env node
import { crashLog } from "./lib/crash-log.mjs";
// serves-brief: PreToolUse hook on the Agent tool. A helper's brief arrives with what the user said its plan row is for, so the
// purpose is not lost between the plan and the brief (a constraint left out of a brief was broken 30-38% of the time, 0% when pinned).
// A brief of worker, worker-full, worker-code, worker-refactor or planner that names a plan file and a step id of its job-list table gets
// "SERVES (from <plan> <step>): <the row's Serves cell>"; a reviewer or plan-reviewer brief gets every row's cell. A row with no quoted
// purpose (no Serves column, an empty cell, a pointer such as "decided") gets a visible "no quoted purpose" line in the brief and a
// note to the lead. The rules are in hooks/lib/serves.mjs. map-brief runs on the same call and only one updatedInput is used, so this
// hook's output also carries the map lines (unless MAP_BRIEF=off): both build the same full brief. A brief that already holds
// "SERVES (from" gets no second copy. Fails open: an error is one line on stderr, exit 0, no Serves lines, but the
// brief gets "PURPOSE CHECK: not run: <error>" and the lead a note.
// Purpose check: when a checked row names a thing of the "What each thing is for" record in the project's DECISIONS.md
// and lacks the user's words for it in Serves (or limits it without a NARROWED: mark), a worker start is refused;
// a planner or reviewer brief gets FOR lines and a PURPOSE CHECK line instead. map-brief refuses with the same text.
// Its fails, its record faults and a check that did not run go to the lead as a "serves-brief purpose check:" note.
// SERVES_BRIEF=off disables it (process env or a project's settings env).
import { emit, runHook } from "./lib/hook-io.mjs";
import { fullBrief } from "./lib/serves.mjs";

runHook(
  "serves-brief",
  async (event) => {
    const built = await fullBrief(event);
    for (const { part, e } of built?.errors ?? []) {
      if (part !== "serves") continue;
      crashLog("serves-brief", e);
      process.stderr.write(
        `serves-brief hook skipped: ${e?.name}: ${e?.message}\n`,
      );
    }
    if (built?.deny) return void emit.deny(built.deny);
    if (!built?.input) return;
    const out = { hookEventName: "PreToolUse", updatedInput: built.input };
    const context = [
      built.notes.length
        ? `serves-brief: no quoted purpose; add the user's words to the plan row's Serves cell. ${built.notes.join(" ")}`
        : "",
      built.purposeNotes.length
        ? `serves-brief purpose check: ${built.purposeNotes.join(" ")}`
        : "",
    ].filter(Boolean);
    if (context.length) out.additionalContext = context.join("\n");
    process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
  },
  { projectSettings: true },
);
