// Test for hooks/compact-handoff.mjs: the hand-off note after a compaction in the main session only;
// silent on other session starts, in helpers and when switched off.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/compact-handoff.mjs", import.meta.url),
);
let fail = 0;
const run = (event, env = {}) =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ hook_event_name: "SessionStart", ...event }),
    encoding: "utf8",
    env: {
      ...process.env,
      COMPACT_HANDOFF: "",
      HOOK_ERRORS_LOG: "off",
      CLAUDE_CODE_ENTRYPOINT: "sdk-ts",
      ...env,
    },
  });
const contextOf = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  } catch {
    return "";
  }
};
const check = (name, ok) => {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) fail++;
};

const main = run({ source: "compact", session_id: "s1" });
const ctx = contextOf(main);
check("compact, main session: exit 0", main.status === 0);
check(
  "compact, main session: hand-off note",
  ctx.startsWith("[compact-handoff]"),
);
check(
  "note: finish the step, commit, handoff skill",
  ctx.includes("Finish the step you are on and commit it") &&
    ctx.includes("don't start the next step") &&
    ctx.includes("`handoff` skill"),
);
check(
  "note: agrees with lead's merged-slice hand-off",
  ctx.includes("`lead`") && ctx.includes("brief.mjs --should"),
);
check(
  "note: no handoff when nothing is left",
  ctx.includes("no handoff is needed"),
);
check(
  "SessionStart event name",
  JSON.parse(main.stdout).hookSpecificOutput.hookEventName === "SessionStart",
);
check(
  "terminal session also gets it",
  contextOf(run({ source: "compact" }, { CLAUDE_CODE_ENTRYPOINT: "cli" })) ===
    ctx,
);

for (const source of ["startup", "resume", "clear", "fork", undefined])
  check(`source ${source}: silent`, run({ source }).stdout === "");
check(
  "helper compacts (agent_id): silent",
  run({ source: "compact", agent_id: "a1", agent_type: "worker" }).stdout ===
    "",
);
check(
  "main session started with --agent (agent_type, no agent_id): note",
  contextOf(run({ source: "compact", agent_type: "lead" })) === ctx,
);
// Nimbalyst chats run as sdk-cli (2026-11-28), so that entrypoint must still get the note
check(
  "Nimbalyst chat (sdk-cli): note",
  contextOf(
    run({ source: "compact" }, { CLAUDE_CODE_ENTRYPOINT: "sdk-cli" }),
  ) === ctx,
);
for (const off of ["off", "OFF"])
  check(
    `COMPACT_HANDOFF=${off}: silent`,
    run({ source: "compact" }, { COMPACT_HANDOFF: off }).stdout === "",
  );
const bad = spawnSync(process.execPath, [HOOK], {
  input: "not json",
  encoding: "utf8",
  env: { ...process.env, COMPACT_HANDOFF: "", HOOK_ERRORS_LOG: "off" },
});
check("bad input: exit 0, silent", bad.status === 0 && bad.stdout === "");

if (fail) {
  console.log(`\n${fail} failed`);
  process.exit(1);
}
console.log("\nall passed");
