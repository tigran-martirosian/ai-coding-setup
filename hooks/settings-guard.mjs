// settings-guard: a PreToolUse hook that asks the user before a session changes one of their Nimbalyst settings
// through Nimbalyst's own tools: a project's permission mode (workspace_set_trust), the default model, the reply
// language, analytics, the theme, sounds, spellcheck, extensions on or off, feature switches and sync. Those are
// the user's choices; a session once switched every project's permission mode on its own (2026-11-20). The ask
// names the tool and what it would set, so the user approves only what they asked for. Every other tool passes.
// Fails closed (a guard in the dispatcher's pre-tool group: a crash refuses only these calls). SETTINGS_GUARD=off
// (any case) disables it, from the environment or from the "env" of settings.local.json or settings.json in
// ~/.claude (that env may not reach a hook process, so the files are read). A file that can't be read or is not
// valid JSON does not set the switch; it is crash-logged and the other file counts.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crashLog } from "./lib/crash-log.mjs";
import { emit, runHook } from "./lib/hook-io.mjs";

const OFF = "SETTINGS_GUARD";
// The Nimbalyst host server's tools that change a setting of the user's (the server name may carry a suffix)
const SETTING_TOOL =
  /^mcp__nimbalyst[\w-]*__(workspace_set_trust|ai_set_default_model|ai_set_preferred_language|analytics_set_enabled|appearance_set_[\w]+|extension_set_enabled|features_toggle|sync_set_for_project)$/;

// What the call would set, for the user's card: the fields that decide what changes come first in a fixed
// order, then any others; every field is shown (none dropped), each value JSON-quoted (so a session's free text
// can't pass as the guard's own words) and shortened on its own, with "…(cut)" where a value was shortened.
const FIRST = [
  "workspacePath",
  "trusted",
  "mode",
  "allowAllUsesClassifier",
  "enabled",
  "model",
  "language",
  "theme",
];
function describe(input) {
  const obj = input && typeof input === "object" ? input : { input };
  const keys = [
    ...FIRST.filter((k) => k in obj),
    ...Object.keys(obj).filter((k) => !FIRST.includes(k)),
  ];
  if (!keys.length) return "no arguments";
  return keys
    .map((k) => {
      const v = JSON.stringify(obj[k]) ?? "undefined";
      const shown = v.length > 120 ? `${v.slice(0, 120)}…(cut)` : v;
      return `${JSON.stringify(k).slice(1, -1).slice(0, 60)}=${shown}`;
    })
    .join(", ");
}

function offInSettings() {
  for (const f of ["settings.local.json", "settings.json"]) {
    const file = path.join(os.homedir(), ".claude", f);
    let value;
    try {
      value = JSON.parse(fs.readFileSync(file, "utf8"))?.env?.[OFF];
    } catch (err) {
      if (err.code !== "ENOENT")
        crashLog(
          "settings-guard",
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
  "settings-guard",
  (event) => {
    const m = SETTING_TOOL.exec(String(event.tool_name ?? ""));
    if (!m || offInSettings()) return;
    emit.ask(
      `[settings-guard] A session wants to change one of your Nimbalyst settings: ${m[1]} with ${describe(event.tool_input)}. Approve only if you asked for this change.`,
    );
  },
  { failClosed: true },
);
