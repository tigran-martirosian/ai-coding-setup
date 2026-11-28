// brief-size-guard: a PreToolUse guard on the Agent tool (Task in older versions) that refuses a worker brief too big
// for one helper's turn limit (80 turns, the worker*.md files' maxTurns), so the lead splits it before a helper runs out
// of turns partway through. The lead skill's slicing rule ("a slice must still fit one worker's turn limit") was words
// only; this is its check. Only subagent_type worker, worker-code, worker-full and worker-refactor are checked.
// The brief is measured by hooks/lib/brief-size.mjs; any one count over its limit refuses, and the message names each:
//   files to change  > 8     separate numbered items  > 8     DONE WHEN cases  > 6     characters  > 6,000
// The characters leave out map-brief's SYSTEMS MAP section (added after the lead wrote the brief).
// Where the limits come from (a scan of 2,591 saved worker runs, 2026-11-27): a run
// "ran out" when the app's turn-limit note came back or it used 70+ turns (helpers stop themselves near the limit).
// Base rate 7%. Over 8 files 20%, over 6 DONE WHEN cases 16%, over 6,000 characters 24%; each refuses under 2% of
// runs. Numbered items showed no lift (8% over 8): that limit is the reported case (9 fixes, out of turns before its
// first edit) and splitting a fix list is cheap. The counts explain little of a run's turns (R² 0.05; length 0.19),
// so most runs that run out are under every limit: this check stops the outliers, not every cut.
// Fails closed (a guard in the dispatcher's pre-tool group: a crash refuses only Agent calls). BRIEF_SIZE_GUARD=off
// (any case; observe logs what it would refuse) disables it, from the environment, else the project's settings env,
// else the "env" of settings.local.json or settings.json in ~/.claude.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { measure, ownLength } from "./lib/brief-size.mjs";
import { crashLog } from "./lib/crash-log.mjs";
import { emit, runHook } from "./lib/hook-io.mjs";
import { setting } from "./lib/settings-env.mjs";

const OFF = "BRIEF_SIZE_GUARD";
const WORKERS = /^worker(?:-code|-full|-refactor)?$/;
export const LIMITS = { files: 8, items: 8, doneWhen: 6, chars: 6000 };
const TURNS = 80;

// The mode from ~/.claude's settings env, used only when neither the environment nor the project's settings set one
// (the project's lookup walks up from the project folder, which misses ~/.claude when the project is not under home)
function homeMode() {
  if (setting(OFF)) return undefined;
  for (const f of ["settings.local.json", "settings.json"]) {
    const file = path.join(os.homedir(), ".claude", f);
    let value;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8"))?.env?.[OFF];
    } catch (err) {
      if (err.code !== "ENOENT")
        crashLog(
          "brief-size-guard",
          new Error(`${file} skipped, it can't be read: ${err.message}`),
        );
      continue;
    }
    if (value !== undefined && value !== null && value !== "") {
      const mode = String(value).toLowerCase();
      return ["off", "observe"].includes(mode) ? mode : "enforce";
    }
  }
  return undefined;
}

runHook(
  "brief-size-guard",
  (event) => {
    if (!["Agent", "Task"].includes(event.tool_name)) return;
    const input = event.tool_input || {};
    if (!WORKERS.test(String(input.subagent_type ?? ""))) return;
    const brief = typeof input.prompt === "string" ? input.prompt : "";
    const size = { ...measure(brief), chars: ownLength(brief) };
    const over = [
      ["files", `${size.files} files to change (limit ${LIMITS.files})`],
      [
        "items",
        `${size.items} separate numbered items (limit ${LIMITS.items})`,
      ],
      [
        "doneWhen",
        `${size.doneWhen} DONE WHEN cases (limit ${LIMITS.doneWhen})`,
      ],
      [
        "chars",
        `${size.chars.toLocaleString("en-US")} characters (limit ${LIMITS.chars.toLocaleString("en-US")})`,
      ],
    ]
      .filter(([key]) => size[key] > LIMITS[key])
      .map(([, text]) => text);
    if (!over.length) return;
    const decided = homeMode();
    if (decided === "off") return;
    emit.deny(
      `[brief-size-guard] Refused: this brief is too big for one worker's ${TURNS}-turn limit: ${over.join(", ")}. ` +
        "Briefs this size ran out of turns two to three times as often in past runs. Split it into slices that each " +
        "fit under every limit and launch one worker per slice (side by side when they change different files, one " +
        "after another when they share files). BRIEF_SIZE_GUARD=off turns this check off.",
      { decided },
    );
  },
  { failClosed: true, projectSettings: true },
);
