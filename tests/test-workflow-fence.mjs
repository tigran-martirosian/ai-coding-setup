// Tests for hooks/workflow-fence.mjs (spec docs/2026-11-20-web-tools-spec.md D4, D7): a Workflow call named
// deep-research is refused in an app or headless run (entry point sdk-*), and passes in the terminal (cli), for
// another name, for an inline script and with WORKFLOW_FENCE=off. Also once through hooks/dispatch.mjs pre-tool.
// Run: node tests/test-workflow-fence.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeChecker, runHook, tmpHome } from "./lib/kit.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const hook = path.join(REPO, "hooks", "workflow-fence.mjs");
const dispatcher = path.join(REPO, "hooks", "dispatch.mjs");
const { check, summary } = makeChecker();
// The home folder sits one level below a temp folder, so a .claude folder above home can be tested (and the
// temp folder, inside the real home on Windows, never reads the real ~/.claude)
const root = tmpHome("workflow-fence-home-");
const home = { dir: path.join(root.dir, "home"), remove: root.remove };
fs.mkdirSync(home.dir);
const cwd = tmpHome("workflow-fence-cwd-");

const workflow = (tool_input) => ({
  session_id: "t",
  hook_event_name: "PreToolUse",
  cwd: cwd.dir,
  tool_name: "Workflow",
  tool_input,
});
const DEEP = workflow({
  name: "deep-research",
  args: "what is the tallest tree?",
});
const run = (event, env = {}) =>
  runHook(hook, event, {
    home: home.dir,
    cwd: cwd.dir,
    env: {
      HOOK_ERRORS_LOG: "off",
      WORKFLOW_FENCE: "",
      CLAUDE_PROJECT_DIR: cwd.dir,
      CLAUDE_CODE_ENTRYPOINT: "sdk-cli",
      ...env,
    },
  });
// "deny" with its reason, "pass" for no answer, "exit N" for an error exit
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

// ---- refused in an app or headless run
const headless = expect(
  "an sdk-cli (headless) run: /deep-research is refused before any helper starts",
  run(DEEP),
  "deny",
);
check(
  "the refusal says why (no approval stop, no way to stop it) and the way out (terminal, WORKFLOW_FENCE=off)",
  /approval stop/i.test(headless.reason) &&
    /stop/i.test(headless.reason.replace(/approval stop/gi, "")) &&
    /terminal/i.test(headless.reason) &&
    headless.reason.includes("WORKFLOW_FENCE=off"),
  headless.reason,
);
expect(
  "a Nimbalyst run (sdk-ts) with the name in other case and spaces: refused",
  run(workflow({ name: "  Deep-Research ", args: "x" }), {
    CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
  }),
  "deny",
);
for (const name of [
  "some-plugin:deep-research",
  "deep_research",
  " Plugin:DEEP_RESEARCH ",
])
  expect(
    `the name "${name}" (a plugin's copy, or with _): refused`,
    run(workflow({ name, args: "x" })),
    "deny",
  );
for (const name of [
  "deep-research-lite",
  "my-deep-research",
  "deep-research:notes",
])
  expect(
    `the name "${name}" (another workflow): passes`,
    run(workflow({ name, args: "x" })),
    "pass",
  );

// ---- passes silently
expect(
  "a terminal run (cli): /deep-research passes, its approval stop shows there",
  run(DEEP, { CLAUDE_CODE_ENTRYPOINT: "cli" }),
  "pass",
);
expect(
  "WORKFLOW_FENCE=off in the environment: passes",
  run(DEEP, { WORKFLOW_FENCE: "off" }),
  "pass",
);
expect(
  "WORKFLOW_FENCE=OFF (any case): passes",
  run(DEEP, { WORKFLOW_FENCE: "OFF" }),
  "pass",
);
expect(
  "another workflow name: passes",
  run(workflow({ name: "code-review", args: "x" })),
  "pass",
);
expect(
  "an inline workflow script: passes",
  run(workflow({ script: "export default async () => 'deep-research'" })),
  "pass",
);
expect(
  "another tool with a name field: passes",
  run({ ...workflow({ name: "deep-research" }), tool_name: "Skill" }),
  "pass",
);

// The off switch in the "env" of ~/.claude/settings.json (that env may not reach a hook process)
fs.mkdirSync(path.join(home.dir, ".claude"), { recursive: true });
const settings = path.join(home.dir, ".claude", "settings.json");
fs.writeFileSync(settings, JSON.stringify({ env: { WORKFLOW_FENCE: "Off" } }));
expect(
  'WORKFLOW_FENCE "Off" in the env of ~/.claude/settings.json: passes',
  run(DEEP),
  "pass",
);
// A settings file that can't be read does not set the switch; the other file still counts
const local = path.join(home.dir, ".claude", "settings.local.json");
fs.mkdirSync(local);
expect(
  "settings.local.json is a folder, settings.json says off: passes",
  run(DEEP),
  "pass",
);
fs.rmSync(settings);
expect(
  "settings.local.json is a folder, no off anywhere: refused as usual",
  run(DEEP),
  "deny",
);
fs.rmSync(local, { recursive: true });
// Only the home folder's own .claude counts, not one in a folder above it
const above = path.join(root.dir, ".claude");
fs.mkdirSync(above);
fs.writeFileSync(
  path.join(above, "settings.json"),
  JSON.stringify({ env: { WORKFLOW_FENCE: "off" } }),
);
expect(
  "WORKFLOW_FENCE=off in a .claude folder above home: refused as usual",
  run(DEEP),
  "deny",
);
fs.rmSync(above, { recursive: true });

// Fails closed (wired as a guard): the error exit makes the dispatcher stop the Workflow call
expect(
  "junk input: the check fails, so the call is stopped",
  run("not json"),
  "exit 1",
);

// ---- once through the dispatcher's pre-tool group, with the repo's own hooks/dispatch-groups.json
const viaDispatch = (entrypoint) => {
  const r = spawnSync(process.execPath, [dispatcher, "pre-tool"], {
    input: JSON.stringify(DEEP),
    encoding: "utf8",
    cwd: cwd.dir,
    env: {
      ...process.env,
      HOME: home.dir,
      USERPROFILE: home.dir,
      HOOK_ERRORS_LOG: "off",
      DISPATCH: "",
      DISPATCH_GROUPS: "",
      WORKFLOW_FENCE: "",
      CLAUDE_PROJECT_DIR: cwd.dir,
      CLAUDE_CODE_ENTRYPOINT: entrypoint,
    },
  });
  return verdict(r);
};
const app = viaDispatch("sdk-cli");
check(
  "through dispatch.mjs pre-tool in an sdk-cli run: refused, and the reason names workflow-fence",
  app.got === "deny" && app.reason.includes("workflow-fence"),
  `got ${app.got} ${app.reason}`,
);
const term = viaDispatch("cli");
check(
  "through dispatch.mjs pre-tool in a terminal run: no refusal",
  term.got !== "deny" && !term.got.startsWith("exit"),
  `got ${term.got} ${term.reason}`,
);

home.remove();
cwd.remove();
summary();
