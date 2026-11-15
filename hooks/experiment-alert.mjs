#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// experiment-alert: SessionStart hook. Tells the user when ~/.claude.json lists an experiment or feature flag it has
// not listed before, so a new server-side experiment (like breezy_horizon, which CLAUDE_CODE_BREEZY_HORIZON=0 turns
// off) is not noticed only by its effects. Claude Code keeps them in three places of ~/.claude.json:
//   cachedExperimentData (object, one key per experiment this account is in), cachedExperimentFeatures (an array of
//   the same names) and cachedGrowthBookFeatures (object, one key per feature flag, over a thousand).
// Only key names are read and kept; values (experiment and variation ids, flag settings) are never printed or stored,
// and a name that looks like a token or an id (a long run of hex or base64, a uuid) is skipped.
// SessionStart, not UserPromptSubmit: the list changes at most once per session start, so one check there costs no
// prompt anything and needs no once-a-day clock. Claude Code refreshes the list during the session, so a new entry
// is seen at the next session start.
// The names seen are kept in hooks/state/experiment-alert/seen.json; the first run records them and says nothing.
// A name that goes away stays in the record, so one that comes and goes is told once.
// Fails open. EXPERIMENT_ALERT=off disables it. EXPERIMENT_ALERT_FILE replaces the ~/.claude.json path (tests).
import { runHook } from "./lib/hook-io.mjs";
import { readJson, stateFile, writeJson } from "./lib/state.mjs";

const FILE =
  process.env.EXPERIMENT_ALERT_FILE || path.join(os.homedir(), ".claude.json");
const SEEN = stateFile("experiment-alert", "seen");
const SHOWN = 8; // flag names listed in the message; the rest are counted

// A plain name (tengu_breezy_horizon, tengu-fable-off-switch), not a secret or an id: no run of 16 hex digits, no
// uuid, no unbroken run of 32 letters and digits
const isName = (s) =>
  typeof s === "string" &&
  /^[A-Za-z][\w.-]{0,99}$/.test(s) &&
  !/[0-9a-f]{16,}/i.test(s) &&
  !/[0-9a-f]{8}-[0-9a-f]{4}-/i.test(s) &&
  !/[A-Za-z0-9]{32,}/.test(s);

const keysOf = (o) =>
  o && typeof o === "object" && !Array.isArray(o) ? Object.keys(o) : [];

// The experiment and flag names in a ~/.claude.json object
function names(config) {
  const experiments = new Set(
    [
      ...keysOf(config.cachedExperimentData),
      ...(Array.isArray(config.cachedExperimentFeatures)
        ? config.cachedExperimentFeatures
        : []),
    ].filter(isName),
  );
  const flags = new Set(keysOf(config.cachedGrowthBookFeatures).filter(isName));
  return { experiments: [...experiments].sort(), flags: [...flags].sort() };
}

const list = (a) =>
  a.length > SHOWN
    ? `${a.slice(0, SHOWN).join(", ")} and ${a.length - SHOWN} more`
    : a.join(", ");

// The message for the new names, or "" when there are none
function message(added) {
  const parts = [];
  if (added.experiments.length)
    parts.push(
      `new experiment${added.experiments.length > 1 ? "s" : ""}: ${list(added.experiments)}`,
    );
  if (added.flags.length)
    parts.push(
      `new feature flag${added.flags.length > 1 ? "s" : ""}: ${list(added.flags)}`,
    );
  if (!parts.length) return "";
  return (
    `experiment-alert: Claude Code's ~/.claude.json lists ${parts.join("; ")}. ` +
    `An experiment can change how Claude Code behaves; some have an off switch in settings env (CLAUDE_CODE_BREEZY_HORIZON=0 turns off breezy_horizon). ` +
    `If the user asks, look the names up in the Claude Code changelog and issues.`
  );
}

runHook("experiment-alert", () => {
  const now = names(JSON.parse(fs.readFileSync(FILE, "utf8"))); // missing or broken: crash-logged, says nothing
  const seen = readJson(SEEN);
  if (!seen) return writeJson(SEEN, now); // first run: record silently
  const added = {
    experiments: now.experiments.filter((n) => !seen.experiments.includes(n)),
    flags: now.flags.filter((n) => !seen.flags.includes(n)),
  };
  if (!added.experiments.length && !added.flags.length) return;
  writeJson(SEEN, {
    experiments: [...seen.experiments, ...added.experiments].sort(),
    flags: [...seen.flags, ...added.flags].sort(),
  });
  const text = message(added);
  fs.writeSync(
    1,
    JSON.stringify({
      systemMessage: text,
      hookSpecificOutput: {
        hookEventName: "SessionStart",
        additionalContext: text,
      },
    }),
  );
});
