// Tests for hooks/settings-guard.mjs: a session's call to a Nimbalyst tool that changes one of the user's settings
// (permission mode, model, language, analytics, theme, sounds, spellcheck, extensions, features, sync) asks the
// user first, naming the tool and what it would set; reading tools and other tools pass; SETTINGS_GUARD=off
// (environment or ~/.claude settings env) turns it off; junk input fails closed. Also once through dispatch.mjs.
// Run: node tests/test-settings-guard.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeChecker, runHook, tmpHome } from "./lib/kit.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const hook = path.join(REPO, "hooks", "settings-guard.mjs");
const dispatcher = path.join(REPO, "hooks", "dispatch.mjs");
const { check, summary } = makeChecker();
const home = tmpHome("settings-guard-home-");
const cwd = tmpHome("settings-guard-cwd-");

const call = (tool_name, tool_input = {}) => ({
  session_id: "t",
  hook_event_name: "PreToolUse",
  cwd: cwd.dir,
  tool_name,
  tool_input,
});
const TRUST = call("mcp__nimbalyst-host__workspace_set_trust", {
  workspacePath: "C:\\Projects\\demo",
  trusted: true,
  mode: "bypass-all",
  allowAllUsesClassifier: true,
});
const env = (extra = {}) => ({
  HOOK_ERRORS_LOG: "off",
  SETTINGS_GUARD: "",
  CLAUDE_PROJECT_DIR: cwd.dir,
  ...extra,
});
const run = (event, extra) =>
  runHook(hook, event, { home: home.dir, cwd: cwd.dir, env: env(extra) });
const verdict = (r) => {
  if (r.status !== 0) return { got: `exit ${r.status}`, reason: r.stderr };
  if (!r.stdout.trim()) return { got: "pass", reason: "" };
  const o = JSON.parse(r.stdout).hookSpecificOutput ?? {};
  return {
    got: o.permissionDecision ?? "note",
    reason: o.permissionDecisionReason ?? "",
  };
};
const expect = (name, r, want) => {
  const v = verdict(r);
  check(name, v.got === want, `got ${v.got} ${v.reason} ${r.stderr}`.trim());
  return v;
};

// ---- asks for each setting tool
const trust = expect(
  "workspace_set_trust (a project's permission mode): the user is asked",
  run(TRUST),
  "ask",
);
check(
  "the ask names the tool and each field it would set, the deciding ones first in order",
  trust.reason.includes("workspace_set_trust") &&
    /workspacePath=.*trusted=true, mode="bypass-all", allowAllUsesClassifier=true/.test(
      trust.reason,
    ),
  trust.reason,
);
check(
  "the ask does not tell the session how to turn the guard off",
  !trust.reason.includes("SETTINGS_GUARD"),
  trust.reason,
);
// A long field put first can't push the deciding field out of the card
const padded = expect(
  "a long padding field before the deciding one: still asked",
  run(
    call("mcp__nimbalyst-host__workspace_set_trust", {
      note: "x".repeat(2000),
      workspacePath: "C:\\Projects\\demo",
      trusted: true,
      mode: "bypass-all",
      allowAllUsesClassifier: true,
    }),
  ),
  "ask",
);
check(
  "with a long padding field: the deciding field is still shown, and the long one is marked cut",
  padded.reason.includes("allowAllUsesClassifier=true") &&
    padded.reason.includes("…(cut)") &&
    padded.reason.length < 600,
  padded.reason.slice(0, 400),
);
for (const t of [
  "ai_set_default_model",
  "ai_set_preferred_language",
  "analytics_set_enabled",
  "appearance_set_theme",
  "appearance_set_completion_sound",
  "appearance_set_spellcheck",
  "appearance_set_spellcheck_languages",
  "extension_set_enabled",
  "features_toggle",
  "sync_set_for_project",
])
  expect(
    `${t}: the user is asked`,
    run(call(`mcp__nimbalyst-host__${t}`)),
    "ask",
  );

// ---- passes
for (const t of [
  "mcp__nimbalyst-host__settings_get_overview",
  "mcp__nimbalyst-host__spawn_session",
  "mcp__nimbalyst__update_session_meta",
  "mcp__other__workspace_set_trust",
  "Bash",
])
  expect(`${t}: passes`, run(call(t)), "pass");
expect(
  "SETTINGS_GUARD=off: passes",
  run(TRUST, { SETTINGS_GUARD: "off" }),
  "pass",
);
expect(
  "SETTINGS_GUARD=OFF (any case): passes",
  run(TRUST, { SETTINGS_GUARD: "OFF" }),
  "pass",
);
fs.mkdirSync(path.join(home.dir, ".claude"), { recursive: true });
const settings = path.join(home.dir, ".claude", "settings.json");
fs.writeFileSync(settings, JSON.stringify({ env: { SETTINGS_GUARD: "Off" } }));
expect(
  'SETTINGS_GUARD "Off" in ~/.claude/settings.json env: passes',
  run(TRUST),
  "pass",
);
fs.writeFileSync(settings, "{ not json");
expect(
  "a settings.json that is not JSON does not turn it off: asked",
  run(TRUST),
  "ask",
);
fs.rmSync(settings);

// ---- fails closed
expect(
  "junk input: the check fails, so the call is stopped",
  run("not json"),
  "exit 1",
);

// ---- through the dispatcher with the repo's own groups
const r = spawnSync(process.execPath, [dispatcher, "pre-tool"], {
  input: JSON.stringify(TRUST),
  encoding: "utf8",
  cwd: cwd.dir,
  env: {
    ...process.env,
    HOME: home.dir,
    USERPROFILE: home.dir,
    DISPATCH: "",
    DISPATCH_GROUPS: "",
    ...env(),
  },
});
const d = verdict(r);
check(
  "through dispatch.mjs pre-tool: the trust change is asked, and the reason names settings-guard",
  d.got === "ask" && d.reason.includes("settings-guard"),
  `got ${d.got} ${d.reason} ${r.stderr}`,
);

home.remove();
cwd.remove();
summary();
