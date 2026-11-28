// Tests for hooks/brief-size-guard.mjs and hooks/lib/brief-size.mjs: a worker brief over one helper's size (files to
// change, separate numbered items, DONE WHEN cases, length) is refused with the counts named; a brief at the limits,
// another agent type and BRIEF_SIZE_GUARD=off pass. Also once through hooks/dispatch.mjs pre-tool.
// Run: node tests/test-brief-size-guard.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeChecker, runHook, tmpHome } from "./lib/kit.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const hook = path.join(REPO, "hooks", "brief-size-guard.mjs");
const dispatcher = path.join(REPO, "hooks", "dispatch.mjs");
const { measure, ownLength } = await import(
  pathToFileURL(path.join(REPO, "hooks", "lib", "brief-size.mjs"))
);
const { check, summary } = makeChecker();
// Home one level below a temp folder (the temp folder is inside the real home on Windows, so the real ~/.claude is
// never read); the project folder is outside home, as C:/Projects is
const root = tmpHome("brief-size-home-");
const home = { dir: path.join(root.dir, "home"), remove: root.remove };
fs.mkdirSync(path.join(home.dir, ".claude"), { recursive: true });
const project = tmpHome("brief-size-project-");

const agent = (prompt, type = "worker-code", tool = "Agent") => ({
  session_id: "t",
  hook_event_name: "PreToolUse",
  cwd: project.dir,
  tool_name: tool,
  tool_input: { description: "S1: x", subagent_type: type, prompt },
});
const run = (event, env = {}) =>
  runHook(hook, event, {
    home: home.dir,
    cwd: project.dir,
    env: {
      HOOK_ERRORS_LOG: "off",
      BRIEF_SIZE_GUARD: "",
      CLAUDE_PROJECT_DIR: project.dir,
      ...env,
    },
  });
const denied = (r) => {
  try {
    return (
      JSON.parse(r.stdout).hookSpecificOutput?.permissionDecision === "deny"
    );
  } catch {
    return false;
  }
};
const reason = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.permissionDecisionReason;
  } catch {
    return r.stdout + r.stderr;
  }
};
const files = (n) =>
  Array.from({ length: n }, (_, i) => `tools/q/f${i}.mjs`).join(", ");
const numbered = (n) =>
  Array.from({ length: n }, (_, i) => `${i + 1}. fix thing ${i}`).join("\n");
const bullets = (n) =>
  Array.from({ length: n }, (_, i) => `- case ${i} passes`).join("\n");
const brief = ({ f = 2, items = 0, dw = 2, pad = 0 } = {}) =>
  [
    "JOB GOAL: rework the queue.",
    `SLICE: S1 of 3.${" word".repeat(pad)}`,
    items ? `FIXES:\n${numbered(items)}` : "",
    `DONE WHEN:\n${bullets(dw)}`,
    `FILES: change ${files(f)}. Read docs/plan.md, tools/q/other.mjs.`,
    "NOT: tests.",
    "COMMANDS: node tests/test-q.mjs",
  ]
    .filter(Boolean)
    .join("\n");

// The measure on the brief shapes the lead writes
let m = measure(brief({ f: 3, items: 4, dw: 5 }));
check(
  "measure: files to change, numbered items, DONE WHEN cases; read-only files left out",
  m.files === 3 && m.items === 4 && m.doneWhen === 5,
  JSON.stringify(m),
);
m = measure(
  "FILES to change: tools/queue/{runner.mjs,queue.mjs}, plan.mjs; read anything.\nDONE WHEN: a passes; b passes; c is shown",
);
check(
  "measure: 'FILES to change' heading, a{b,c} as two names, inline DONE WHEN split on ';'",
  m.files === 3 && m.doneWhen === 3,
  JSON.stringify(m),
);
m = measure(
  "DONE WHEN:\n- moves:\n  - a -> b;\n  - c -> d;\n- paths updated\nFILES: R `hooks/a.mjs`, W `tools/b.mjs`",
);
check(
  "measure: nested DONE WHEN bullets count as one case",
  m.doneWhen === 2 && m.files === 2,
  JSON.stringify(m),
);

m = measure(
  "FILES: change hooks/read-config.mjs and hooks/a.mjs; lib/reads.mjs too",
);
check(
  "measure: a file named read-… or reads.mjs is counted, not taken for the word read",
  m.files === 3,
  JSON.stringify(m),
);
m = measure(
  `DONE WHEN: the queue runs the job\n${"  and the wrapped sentence goes on\n".repeat(7)}FILES: a.mjs`,
);
check(
  "measure: a DONE WHEN sentence wrapped over 8 lines is one case",
  m.doneWhen === 1,
  JSON.stringify(m),
);
const sample = `JOB GOAL: x\nFILES: a.mjs\nSYSTEMS MAP: (map)\n- node y\n- node z\nNOT: tests`;
check(
  "ownLength: the whole brief, headings included, minus the SYSTEMS MAP section",
  ownLength(sample) ===
    sample.length - "SYSTEMS MAP: (map)\n- node y\n- node z\n".length &&
    ownLength("JOB GOAL: x\nNOT: y") === "JOB GOAL: x\nNOT: y".length,
  String(ownLength(sample)),
);

// At the limits: passes silently
let r = run(agent(brief({ f: 8, items: 8, dw: 6 })));
check(
  "8 files, 8 items, 6 DONE WHEN cases: passes",
  r.status === 0 && r.stdout === "",
  r.stdout + r.stderr,
);

r = run(agent(brief({ f: 9 })));
check(
  "9 files to change: refused, the count and limit named",
  denied(r) && /9 files to change \(limit 8\)/.test(reason(r)),
  reason(r),
);
r = run(agent(brief({ items: 9 })));
check(
  "9 separate numbered fixes: refused",
  denied(r) && /9 separate numbered items \(limit 8\)/.test(reason(r)),
  reason(r),
);
r = run(agent(brief({ dw: 7 })));
check(
  "7 DONE WHEN cases: refused",
  denied(r) && /7 DONE WHEN cases \(limit 6\)/.test(reason(r)),
  reason(r),
);
r = run(agent(brief({ pad: 1300 })));
check(
  "a brief over 6,000 characters: refused",
  denied(r) && /characters \(limit 6,000\)/.test(reason(r)),
  reason(r),
);
r = run(agent(brief({ f: 10, dw: 8 })));
check(
  "two counts over: both named, with what to do and the off switch",
  denied(r) &&
    /10 files/.test(reason(r)) &&
    /8 DONE WHEN/.test(reason(r)) &&
    /[Ss]plit/.test(reason(r)) &&
    /BRIEF_SIZE_GUARD=off/.test(reason(r)),
  reason(r),
);
r = run(
  agent(
    `${brief({ pad: 900 })}\nSYSTEMS MAP: (from map-brief)\n${"- node x: a part of the setup\n".repeat(100)}`,
  ),
);
check(
  "map-brief's SYSTEMS MAP lines don't count toward the length",
  r.status === 0 && r.stdout === "",
  reason(r),
);

for (const type of ["worker", "worker-full", "worker-refactor"]) {
  r = run(agent(brief({ f: 9 }), type));
  check(`${type} is checked`, denied(r), reason(r));
}
r = run(agent(brief({ f: 9 }), "worker-code", "Task"));
check("the older Task tool name is checked", denied(r), reason(r));
for (const type of ["reviewer", "general-purpose", null]) {
  const event = agent(brief({ f: 20, items: 20 }), type);
  if (type === null) delete event.tool_input.subagent_type; // the app's default agent
  r = run(event);
  check(
    `${type ?? "no type"} is not a worker: passes`,
    r.status === 0 && r.stdout === "",
    reason(r),
  );
}
r = run(agent(brief({ f: 9 })), { BRIEF_SIZE_GUARD: "off" });
check(
  "BRIEF_SIZE_GUARD=off: passes",
  r.status === 0 && r.stdout === "",
  reason(r),
);
fs.writeFileSync(
  path.join(home.dir, ".claude", "settings.json"),
  JSON.stringify({ env: { BRIEF_SIZE_GUARD: "off" } }),
);
r = run(agent(brief({ f: 9 })));
check(
  "BRIEF_SIZE_GUARD=off in ~/.claude/settings.json env: passes",
  r.status === 0 && r.stdout === "",
  reason(r),
);
fs.writeFileSync(
  path.join(home.dir, ".claude", "settings.json"),
  JSON.stringify({ env: { BRIEF_SIZE_GUARD: "observe" } }),
);
r = run(agent(brief({ f: 9 })));
const observed = path.join(
  home.dir,
  ".claude",
  "hooks",
  "state",
  "observe.jsonl",
);
check(
  "BRIEF_SIZE_GUARD=observe in ~/.claude/settings.json: passes, the refusal logged",
  r.status === 0 &&
    r.stdout === "" &&
    fs.existsSync(observed) &&
    /brief-size-guard/.test(fs.readFileSync(observed, "utf8")),
  reason(r),
);
r = run(agent(brief({ f: 9 })), { BRIEF_SIZE_GUARD: "enforce" });
check(
  "BRIEF_SIZE_GUARD=enforce in the environment beats observe in ~/.claude",
  denied(r),
  reason(r),
);
fs.rmSync(path.join(home.dir, ".claude", "settings.json"));

// Through the dispatcher: the refusal names the guard
r = spawnSync(process.execPath, [dispatcher, "pre-tool"], {
  input: JSON.stringify(agent(brief({ f: 9 }))),
  encoding: "utf8",
  cwd: project.dir,
  env: {
    ...process.env,
    HOME: home.dir,
    USERPROFILE: home.dir,
    DISPATCH: "",
    HOOK_ERRORS_LOG: "off",
    BRIEF_SIZE_GUARD: "",
    MAP_BRIEF: "off",
    CLAUDE_PROJECT_DIR: project.dir,
    DISPATCH_GROUPS: "",
  },
});
check(
  "through dispatch.mjs pre-tool: refused, the guard named",
  denied(r) && /brief-size-guard/.test(reason(r)),
  r.stdout + r.stderr,
);

home.remove();
project.remove();
summary();
