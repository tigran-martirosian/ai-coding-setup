// The hooks cut (plan 2.8, spec docs/2026-11-20-hooks-cut-spec.md D1-D5): settings.example.json, read together
// with hooks/dispatch-groups.json, wires only the hooks 2.8 keeps, and the cut ones are gone from the repo.
// "Wired" is an entry of the example, or a hook of a group a `hooks/dispatch.mjs <group>` entry runs.
// Run: node tests/test-hooks-cut.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { makeChecker } from "./lib/kit.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const { check, summary } = makeChecker();
const json = (p) => JSON.parse(fs.readFileSync(path.join(REPO, p), "utf8"));

// The 17 hooks 2.8 marks Cut, the 5 upkeep hooks, and map-prompt (plan 2.10, docs/2026-11-20-memory-and-map-spec.md D1)
const CUT = [
  "long-sleep-guard",
  "big-read-gate",
  "background-tasks",
  "slow-output-gate",
  "decided-quote",
  "serves-brief",
  "budget-gate",
  "worker-size",
  "job-done",
  "context-guard",
  "cold-cache",
  "handoff-brief",
  "next-step-gate",
  "run-yourself",
  "web-answer-gate",
  "form-answer",
  "code-review-gate",
  "upkeep-note",
  "recheck-dates",
  "patch-next",
  "pc-tidy-nudge",
  "experiment-alert",
  "map-prompt",
];
// The groups as the plan names them ("Names fixed for every slice"), each hook with its old matcher as `tools`.
// map-brief and map-nudge come back through the dispatcher (plan 2.10, memory-and-map spec D2 and D4).
const BASH = "Bash|PowerShell";
const GROUPS = {
  "pre-tool": {
    event: "PreToolUse",
    hooks: [
      // The hooks that rewrite the command come before the guards, so the guards check the command that runs
      ["hooks/download-guard.mjs", [], BASH],
      ["hooks/command-explain.mjs", [], BASH],
      ["hooks/delete-guard.mjs", [], BASH],
      ["hooks/find-guard.mjs", [], BASH],
      ["hooks/sql-guard.mjs", [], BASH],
      // job 9 D9: push-key-scan moved into the dispatcher as a guard, after the other guards (it also sees deploy commands)
      ["hooks/push-key-scan.mjs", [], BASH],
      ["hooks/workflow-fence.mjs", [], "Workflow"],
      // settings-guard asks the user before a session changes one of their Nimbalyst settings (2026-11-23)
      ["hooks/settings-guard.mjs", [], "mcp__nimbalyst.*"],
      [
        "hooks/verify-gate.mjs",
        ["--pre"],
        "Bash|PowerShell|mcp__nimbalyst__developer_git_commit_proposal",
      ],
      // These two are also wired on PostToolUse for other work: session-cleanup saves a launch's start time here and
      // lists the processes after it; steer holds a long call here and hands a note over with a quick call's result
      ["hooks/session-cleanup.mjs", [], BASH],
      ["skills/steer/steer.mjs", ["--hook"], undefined],
      [
        "hooks/repeat-guard.mjs",
        ["--near-cap-only"],
        "Edit|Write|Read|Bash|PowerShell|Grep|Glob|WebFetch|WebSearch|mcp__.*",
      ],
      ["hooks/map-brief.mjs", [], "Agent|Task"],
      // job 11a D7: file-name-note is a new note in the pre-tool group, on Write only (no Node process of its own)
      ["hooks/file-name-note.mjs", [], "Write"],
    ],
  },
  prompt: {
    event: "UserPromptSubmit",
    hooks: [
      ["hooks/usage-dashboard-hook.mjs", [], undefined],
      ["hooks/no-response-gate.mjs", [], undefined],
      ["skills/steer/steer.mjs", ["--hook"], undefined],
      ["hooks/session-cleanup.mjs", [], undefined],
      ["hooks/map-nudge.mjs", [], undefined],
    ],
  },
  stop: {
    event: "Stop",
    hooks: [
      ["hooks/plan-usage-logger.mjs", [], undefined],
      ["hooks/verify-gate.mjs", [], undefined],
      ["hooks/no-response-gate.mjs", [], undefined],
      ["hooks/file-link-gate.mjs", [], undefined],
      ["skills/steer/steer.mjs", ["--hook"], undefined],
    ],
  },
};

// Every hook the example runs: { event, matcher, if, script ("hooks/x.mjs"), args, group }
const example = json("settings.example.json");
const groupsPath = path.join(REPO, "hooks", "dispatch-groups.json");
const groups = fs.existsSync(groupsPath)
  ? json("hooks/dispatch-groups.json")
  : null;
check(
  "hooks/dispatch-groups.json exists and is read with the example",
  groups !== null,
  `missing: ${groupsPath}`,
);
const wired = [];
const problems = [];
for (const [event, list] of Object.entries(example.hooks)) {
  for (const g of list) {
    for (const h of g.hooks) {
      const m = h.command.match(
        /^node ~\/\.claude\/(\S+\.mjs)((?:\s+\S+)*)\s*$/,
      );
      if (!m) {
        problems.push(
          `${event}: a command not in the form node ~/.claude/<script>: ${h.command}`,
        );
        continue;
      }
      const args = m[2].trim() ? m[2].trim().split(/\s+/) : [];
      const own = { event, matcher: g.matcher, if: h.if, script: m[1], args };
      if (m[1] !== "hooks/dispatch.mjs") {
        wired.push(own);
        continue;
      }
      const list = groups?.[args[0]];
      if (!Array.isArray(list)) {
        problems.push(
          `${event}: dispatch.mjs ${args[0]} has no group in dispatch-groups.json`,
        );
        continue;
      }
      for (const e of list)
        wired.push({
          event,
          matcher: g.matcher,
          script: e.hook,
          args: e.args ?? [],
          group: args[0],
          tools: e.tools,
        });
    }
  }
}
check(
  "every example command is read",
  problems.length === 0,
  problems.join("\n     "),
);
const name = (w) => path.basename(w.script, ".mjs");
const where = (n) =>
  wired
    .filter((w) => name(w) === n)
    .map((w) =>
      `${w.event}${w.group ? ` (${w.group})` : ""} ${w.args.join(" ")}`.trim(),
    );

// ---- D1: the cut hooks are gone and retired
const retired = example._setup?.retired ?? [];
for (const n of CUT) {
  const left = [
    fs.existsSync(path.join(REPO, "hooks", `${n}.mjs`)) && `hooks/${n}.mjs`,
    fs.existsSync(path.join(REPO, "tests", `test-${n}.mjs`)) &&
      `tests/test-${n}.mjs`,
    ...where(n).map((w) => `wired on ${w}`),
    !retired.includes(`${n}.mjs`) && "not in _setup.retired",
  ].filter(Boolean);
  check(
    `D1 ${n} is cut (file, test, wiring gone; in _setup.retired)`,
    left.length === 0,
    left.join("; "),
  );
}
// No repo text tells a person to use a cut hook: the markdown files outside CHANGELOG history. A path into a kept
// skill (code moved next to it, e.g. skills/update-project/...) is not the hook.
const tracked = spawnSync("git", ["-C", REPO, "ls-files", "*.md"], {
  encoding: "utf8",
});
if (tracked.status !== 0)
  throw new Error(`git ls-files failed: ${tracked.stderr}`);
const TEXT_ALLOW = new Set(["CHANGELOG.md"]);
const mentions = [];
for (const f of tracked.stdout.split("\n").filter(Boolean)) {
  if (TEXT_ALLOW.has(f)) continue;
  const lines = fs.readFileSync(path.join(REPO, f), "utf8").split("\n");
  lines.forEach((line, i) => {
    const bare = line.replace(/skills\/[\w./-]*/g, "");
    for (const n of CUT)
      if (new RegExp(`(^|[^\\w-])${n}([^\\w-]|$)`).test(bare))
        mentions.push(`${f}:${i + 1} ${n}`);
  });
}
check(
  "D1 no markdown text outside CHANGELOG names a cut hook",
  mentions.length === 0,
  `${mentions.length} mentions, first: ${mentions.slice(0, 8).join(", ")}`,
);

// ---- D2: planner-readonly is in no global table; its file stays for the agents' frontmatter
check(
  "D2 planner-readonly is not wired in the example",
  where("planner-readonly").length === 0,
  where("planner-readonly").join("; "),
);
check(
  "D2 hooks/planner-readonly.mjs stays",
  fs.existsSync(path.join(REPO, "hooks", "planner-readonly.mjs")),
);
check(
  "D2 planner-readonly.mjs is not retired (the agents still run it)",
  !retired.some((r) => r.startsWith("planner-readonly.mjs")),
);

// ---- D3: no surviving code names the planner agent as a live one. History lines (a dated user quote, or a line
// that says the planner was retired) may stay.
const PLACES = [
  "hooks",
  "scripts",
  "skills/setup-audit/scripts/outcomes.mjs",
  "extensions/agents-panel/src",
];
const grep = spawnSync(
  "git",
  ["-C", REPO, "grep", "-n", "-i", "-E", "\\bplanner\\b", "--", ...PLACES],
  {
    encoding: "utf8",
  },
);
if (grep.status > 1) throw new Error(`git grep failed: ${grep.stderr}`);
const HISTORY = /\(user, 20\d\d-|\bretired\b|\bno longer\b|\bformer\b/i;
const planner = grep.stdout
  .split("\n")
  .filter(Boolean)
  .filter((l) =>
    /\bplanner\b(?!-readonly)/i.test(l.replace(/planner-readonly/gi, "")),
  )
  .filter((l) => !HISTORY.test(l));
check(
  "D3 no hook, lib, script, outcomes.mjs or agents-panel line names the planner agent",
  planner.length === 0,
  `${planner.length} lines:\n     ${planner
    .slice(0, 12)
    .map((l) => l.slice(0, 150))
    .join("\n     ")}`,
);

// ---- D4, D5: the partial cuts
const events = (n) =>
  [...new Set(wired.filter((w) => name(w) === n).map((w) => w.event))].sort();
check(
  "D4 plan-usage-logger runs on Stop only",
  JSON.stringify(events("plan-usage-logger")) === '["Stop"]',
  where("plan-usage-logger").join("; "),
);
check(
  "D5 no-response-gate has no PreToolUse wiring, and keeps UserPromptSubmit and Stop",
  JSON.stringify(events("no-response-gate")) === '["Stop","UserPromptSubmit"]',
  where("no-response-gate").join("; "),
);
// The plan's other wiring changes (S1a): repeat-guard only as --near-cap-only, session-cleanup off SessionStart
check(
  "repeat-guard is wired only as --near-cap-only",
  wired
    .filter((w) => name(w) === "repeat-guard")
    .every((w) => w.args.join(" ") === "--near-cap-only") &&
    where("repeat-guard").length > 0,
  where("repeat-guard").join("; "),
);
check(
  "session-cleanup has no SessionStart entry",
  !events("session-cleanup").includes("SessionStart"),
  where("session-cleanup").join("; "),
);

// ---- the groups: each wired once on its event, as the plan names them, and their hooks not also wired on their own
for (const [group, { event, hooks }] of Object.entries(GROUPS)) {
  const entries = (example.hooks[event] ?? []).flatMap((g) =>
    g.hooks
      .filter(
        (h) => /hooks\/dispatch\.mjs\s+(\S+)/.exec(h.command)?.[1] === group,
      )
      .map(() => g.matcher ?? ""),
  );
  check(
    `${group} is wired once on ${event}, for every tool`,
    entries.length === 1 && ["", "*"].includes(entries[0]),
    JSON.stringify(entries),
  );
  const got = (groups?.[group] ?? []).map((e) => [
    e.hook,
    e.args ?? [],
    e.tools,
  ]);
  check(
    `${group} runs the plan's hooks in order, each with its old matcher`,
    JSON.stringify(got) === JSON.stringify(hooks),
    `got ${JSON.stringify(got)}`,
  );
  const twice = hooks.filter(([script, args]) =>
    wired.some(
      (w) =>
        !w.group &&
        w.event === event &&
        w.script === script &&
        w.args.join(" ") === args.join(" "),
    ),
  );
  check(
    `${group}: no hook of the group is also wired on its own on ${event}`,
    twice.length === 0,
    twice.map((h) => h[0]).join(", "),
  );
}
// opencli-readonly, wired with an `if`, stays its own entry
check(
  "opencli-readonly stays its own PreToolUse entry with an if",
  wired.some(
    (w) =>
      name(w) === "opencli-readonly" &&
      w.event === "PreToolUse" &&
      !w.group &&
      w.if,
  ),
  where("opencli-readonly").join("; "),
);
// job 9 D9: push-key-scan runs in the pre-tool dispatcher (no longer its own entry with an if), so it also sees deploy
// commands and runs once per push
check(
  "push-key-scan runs in the dispatcher's pre-tool group, and has no PreToolUse entry of its own",
  wired.some(
    (w) =>
      name(w) === "push-key-scan" &&
      w.event === "PreToolUse" &&
      w.group === "pre-tool",
  ) && !wired.some((w) => name(w) === "push-key-scan" && !w.group),
  where("push-key-scan").join("; "),
);

summary();
