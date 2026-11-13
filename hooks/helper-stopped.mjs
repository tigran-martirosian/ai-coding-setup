#!/usr/bin/env node
// helper-stopped: PostToolUse hook on the Agent tool (Task in older versions). A helper cut at its turn limit comes back
// with the app's note "stopped at its N-turn limit" (TURN_LIMIT_RE) and a half-done job; one that finished with no
// report comes back empty. Either way it is not finished, so the note says what to do: SendMessage it once for what is
// done and left, then compare the files. A cut or empty reviewer counts as not run.
// Only a foreground helper's result is a tool result. A background helper's end, and the end of a helper resumed by
// SendMessage (whose own result is only "Resuming agent ..."), arrive as task notifications, which no hook sees.
// The app's "[harness: ...]" lines in front of a report are not report. Main session only. HELPER_STOPPED=off disables it.
import { runHook, emit } from "./lib/hook-io.mjs";
import { TURN_LIMIT_RE } from "./lib/texts.mjs";

const HELPER_STOPPED_NOTE =
  "[helper-stopped] This helper stopped before it finished: SendMessage it once for what is done and what is left, " +
  "then compare the files yourself. A cut or empty reviewer is NOT RUN.";

// The report's text: a string, or the blocks of tool_response.content
function reportText(response) {
  if (typeof response === "string") return response;
  const blocks = Array.isArray(response?.content)
    ? response.content
    : Array.isArray(response)
      ? response
      : [];
  return blocks
    .map((b) =>
      typeof b === "string" ? b : typeof b?.text === "string" ? b.text : "",
    )
    .join("\n");
}

runHook("helper-stopped", (event) => {
  if (event.agent_id || !["Agent", "Task"].includes(event.tool_name)) return;
  const response = event.tool_response;
  const status =
    response && typeof response === "object" && !Array.isArray(response)
      ? response.status
      : undefined;
  if (status !== undefined && status !== "completed") return; // a background launch, not a report
  const text = reportText(response);
  const report = text
    .split("\n")
    .filter((line) => !/^\s*\[harness:/.test(line))
    .join("\n")
    .trim();
  // The app puts its note first; a finished report that only quotes the words (as a hook test report does) is not cut
  const firstLine = report.split("\n").find((line) => line.trim()) ?? "";
  if (TURN_LIMIT_RE.test(firstLine) || !report)
    emit.context("PostToolUse", HELPER_STOPPED_NOTE);
});
