// workflow-fence: a PreToolUse hook (Workflow) that refuses `/deep-research` in an app or headless run (entry point
// sdk-*: Nimbalyst, claude -p). There the workflow skips its "Review dynamic workflow" approval stop, and neither
// Stop nor TaskStop ends it: one run started 99 helpers on a one-line question (docs/2026-11-20-hooks-health.md
// part 3). /deep-research calls Workflow with {"name":"deep-research","args":"<question>"}; the name is matched
// trimmed and in any case, with "_" for "-" and with a plugin's prefix (<plugin>:deep-research). A terminal run
// (entry point cli) passes: its approval stop shows there. Other workflow names and inline workflows
// ({"script": "..."}) pass. The message says to run /deep-research in the terminal.
// Fails closed (a guard in the dispatcher's pre-tool group: a crash refuses only Workflow calls). WORKFLOW_FENCE=off
// (any case) disables it, from the environment or from the "env" of settings.local.json or settings.json in
// ~/.claude, not in a folder above home (that env may not reach a hook process, so the files are read). A file
// that can't be read or is not valid JSON does not set the switch; it is crash-logged and the other file counts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crashLog } from "./lib/crash-log.mjs";
import { emit, inNimbalyst, runHook } from "./lib/hook-io.mjs";

const OFF = "WORKFLOW_FENCE";
const DEEP_RESEARCH = /^(?:[^:\s]+:)?deep[-_]research$/i;

function offInSettings() {
  for (const f of ["settings.local.json", "settings.json"]) {
    const file = path.join(os.homedir(), ".claude", f);
    let value;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8"))?.env?.[OFF];
    } catch (err) {
      if (err.code !== "ENOENT")
        crashLog(
          "workflow-fence",
          new Error(`${file} skipped, it can't be read: ${err.message}`),
        );
      continue;
    }
    if (value !== undefined && value !== null && value !== "")
      return String(value).toLowerCase() === "off";
  }
  return false;
}

runHook(
  "workflow-fence",
  (event) => {
    if (event.tool_name !== "Workflow" || !inNimbalyst()) return;
    const name = String((event.tool_input || {}).name ?? "").trim();
    if (!DEEP_RESEARCH.test(name) || offInSettings()) return;
    emit.deny(
      "[workflow-fence] Refused: in an app or headless run, /deep-research skips its approval stop and nothing can stop it once it starts (one run started 99 helpers). Run /deep-research in the Claude Code terminal, where its approval stop shows, or set WORKFLOW_FENCE=off.",
    );
  },
  { failClosed: true },
);
