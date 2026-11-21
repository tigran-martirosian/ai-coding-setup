// Tests for the Systems map reader: skills/systems-map/map.mjs (--brief, --near, --check, --scan) and the hook
// hooks/map-brief.mjs. Run: node tests/test-map-brief.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/map-brief.mjs", import.meta.url));
const MAP = fileURLToPath(
  new URL("../skills/systems-map/map.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "map-brief-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`,
  );
};

// A project with files on disk and a map file. files: relative path -> content; map: object (or a string written as is), null for none.
const project = (name, files, map) => {
  const dir = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  if (map !== null)
    fs.writeFileSync(
      path.join(dir, ".claude", "systems-map.json"),
      typeof map === "string" ? map : JSON.stringify(map, null, 2),
    );
  return dir;
};
const FILES = {
  "src/auth/login.js": "x",
  "src/auth/session.js": "x",
  "src/billing/invoice.js": "x",
  "src/billing/pricing.js": "x",
  "src/billing/tax.js": "x",
  "src/ui/Dashboard.tsx": "x",
  "docs/billing.md": "x",
  "README.md": "x",
  "package.json": "{}",
};
const MAPDATA = {
  nodes: [
    {
      id: "auth",
      name: "User login",
      what: "Signs a user in and keeps the session.",
      files: [
        "src/auth/login.js",
        "src/auth/session.js",
        "src/auth/removed.js",
      ],
      notes: ["docs/auth-removed.md"],
    },
    {
      id: "billing",
      name: "Invoice billing",
      what: "Prices an order and issues the invoice.",
      files: ["src/billing/invoice.js", "src/billing/pricing.js"],
      notes: ["docs/billing.md"],
    },
    {
      id: "dashboard",
      name: "Dashboard screen",
      what: "Shows the account overview.",
      files: ["src/ui/Dashboard.tsx"],
    },
    {
      id: "settings",
      name: "Project settings",
      what: "Reads the project configuration.",
      files: ["package.json"],
    },
  ],
  links: [
    {
      from: "auth",
      to: "billing",
      says: "Billing reads the signed-in account from the session.",
      evidence: ["src/auth/session.js", "src/billing/invoice.js"],
    },
    {
      from: "billing",
      to: "dashboard",
      says: "The dashboard lists the latest invoices.",
      evidence: ["src/billing/invoice.js", "src/ui/Dashboard.tsx"],
    },
  ],
};
const dir = project("main", FILES, MAPDATA);

// The hook acts only while ~/.claude/state/map-brief-trial.json is unexpired (memory-and-map spec D4): each test home
// is a temp folder; trial is the file's text, or null for none.
const localDay = (offsetDays = 0) => {
  const d = new Date(Date.now() + offsetDays * 864e5);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};
const testHome = (name, trial) => {
  const h = path.join(tmp, "homes", name);
  fs.mkdirSync(path.join(h, ".claude", "state"), { recursive: true });
  if (trial !== null)
    fs.writeFileSync(
      path.join(h, ".claude", "state", "map-brief-trial.json"),
      trial,
    );
  return h;
};
const trialLog = (h) => {
  const f = path.join(h, ".claude", "state", "map-brief-trial.jsonl");
  return fs.existsSync(f)
    ? fs
        .readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
};
const onHome = testHome("on", JSON.stringify({ until: localDay(14) }));

// Every case below the trial section runs in the map arm of an unexpired trial
const hook = (cwd, input, env = {}) =>
  spawnSync("node", [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      MAP_BRIEF: "",
      CLAUDE_PROJECT_DIR: cwd,
      HOME: onHome,
      USERPROFILE: onHome,
      MAP_BRIEF_ARM: "map",
      ...env,
    },
  });
const agent = (prompt, type = "worker", extra = {}) => ({
  tool_name: "Agent",
  tool_input: {
    description: "Test: x",
    prompt,
    subagent_type: type,
    run_in_background: false,
    ...extra,
  },
});
const updated = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.updatedInput;
  } catch {
    return null;
  }
};
const cli = (args, { cwd = dir, input = "" } = {}) =>
  spawnSync("node", [MAP, ...args], { cwd, input, encoding: "utf8" });

// ---- the trial (memory-and-map spec D4): the hook acts only while the trial file is unexpired; each eligible call gets
// an arm, map or none, and one line in ~/.claude/state/map-brief-trial.jsonl
const TRIAL_BRIEF =
  "Fix the rounding bug in src/billing/invoice.js and add a test.";
const trialCall = (prompt = TRIAL_BRIEF, extra = {}) => ({
  session_id: "sess-1",
  tool_use_id: "toolu_1",
  cwd: dir,
  ...agent(prompt),
  ...extra,
});
const onHomeEnv = (h, arm = "map") => ({
  HOME: h,
  USERPROFILE: h,
  MAP_BRIEF_ARM: arm,
});
for (const [name, trial] of [
  ["no trial file", null],
  ["a trial that ended yesterday", JSON.stringify({ until: localDay(-1) })],
]) {
  const h = testHome(name.replace(/\W+/g, "-"), trial);
  const outs = [
    trialCall(),
    trialCall(TRIAL_BRIEF, { permission_mode: "auto" }),
  ].map((c) => hook(dir, c, onHomeEnv(h)));
  check(
    `trial: ${name}: no output in any mode, nothing logged (the hook acts only during the trial)`,
    outs.every((r) => r.stdout === "" && r.status === 0 && r.stderr === "") &&
      trialLog(h).length === 0,
    outs.map((r) => r.stdout + r.stderr).join(" | "),
  );
}
{
  const h = testHome("broken", "{ not json");
  const r = hook(dir, trialCall(), onHomeEnv(h));
  check(
    "trial: a broken trial file counts as no trial: no output, exit 0, one line on stderr",
    r.stdout === "" &&
      r.status === 0 &&
      r.stderr.trim().split("\n").length === 1 &&
      /trial file/.test(r.stderr) &&
      trialLog(h).length === 0,
    r.stdout + r.stderr,
  );
}
{
  const h = testHome("today", JSON.stringify({ until: localDay(0) }));
  const r = hook(dir, trialCall(), onHomeEnv(h));
  check(
    "trial: a trial whose until is today still acts (the map arm rewrites)",
    updated(r)?.prompt.includes("## Invoice billing [billing]"),
    r.stdout + r.stderr,
  );
}
{
  const h = testHome("map-arm", JSON.stringify({ until: localDay(14) }));
  const r = hook(dir, trialCall(), onHomeEnv(h, "map"));
  const u = updated(r);
  const log = trialLog(h);
  check(
    "trial: the map arm rewrites the brief as before",
    u?.prompt.startsWith(`${TRIAL_BRIEF}\n\nSYSTEMS MAP:`) &&
      u.prompt.includes("## Invoice billing [billing]"),
    r.stdout + r.stderr,
  );
  check(
    "trial: the map arm logs one line with ts, session, toolUseId, cwd, type, arm, mode and the brief as sent",
    log.length === 1 &&
      Object.keys(log[0]).sort().join() ===
        "arm,brief,cwd,mode,session,toolUseId,ts,type" &&
      !Number.isNaN(Date.parse(log[0].ts)) &&
      log[0].session === "sess-1" &&
      log[0].toolUseId === "toolu_1" &&
      log[0].cwd === dir &&
      log[0].type === "worker" &&
      log[0].arm === "map" &&
      log[0].mode === "rewrite" &&
      log[0].brief === TRIAL_BRIEF,
    JSON.stringify(log),
  );
}
{
  const h = testHome("none-arm", JSON.stringify({ until: localDay(14) }));
  const outs = [
    trialCall(),
    trialCall(TRIAL_BRIEF, { permission_mode: "auto" }),
  ].map((c) => hook(dir, c, onHomeEnv(h, "none")));
  const log = trialLog(h);
  check(
    "trial: the none arm gives no output in either mode and logs each call with arm none",
    outs.every((r) => r.stdout === "" && r.status === 0) &&
      log.length === 2 &&
      log.every((l) => l.arm === "none") &&
      log.map((l) => l.mode).join() === "rewrite,auto",
    outs.map((r) => r.stdout + r.stderr).join(" | ") + JSON.stringify(log),
  );
}
{
  const h = testHome("auto", JSON.stringify({ until: localDay(14) }));
  const r = hook(
    dir,
    trialCall(TRIAL_BRIEF, { permission_mode: "auto" }),
    onHomeEnv(h, "map"),
  );
  let o = null;
  try {
    o = JSON.parse(r.stdout).hookSpecificOutput;
  } catch {}
  const log = trialLog(h);
  check(
    "trial: auto mode, map arm: no updatedInput, the map lines as context, logged with mode auto",
    o &&
      !("updatedInput" in o) &&
      o.additionalContext.includes("## Invoice billing [billing]") &&
      log.length === 1 &&
      log[0].mode === "auto" &&
      log[0].arm === "map",
    r.stdout + JSON.stringify(log),
  );
}
{
  const h = testHome("long", JSON.stringify({ until: localDay(14) }));
  const long = `${TRIAL_BRIEF} ${"word ".repeat(3000)}`;
  const u = updated(hook(dir, trialCall(long), onHomeEnv(h)));
  const log = trialLog(h);
  check(
    "trial: the logged brief is the prompt as sent, cut to its first 8,000 characters; the helper still gets all of it",
    log.length === 1 &&
      log[0].brief === long.slice(0, 8000) &&
      u?.prompt.startsWith(long),
    `${log[0]?.brief.length}`,
  );
}
{
  const h = testHome("not-eligible", JSON.stringify({ until: localDay(14) }));
  hook(dir, { ...trialCall(), ...agent(TRIAL_BRIEF, "Explore") }, onHomeEnv(h));
  hook(project("trial-nomap", FILES, null), trialCall(), onHomeEnv(h));
  hook(
    dir,
    trialCall(`${TRIAL_BRIEF}\n\nSYSTEMS MAP: already here.`),
    onHomeEnv(h),
  );
  check(
    "trial: an uncovered type, a project with no map and a brief that already holds map lines are not logged",
    trialLog(h).length === 0,
    JSON.stringify(trialLog(h)),
  );
}
{
  const h = testHome("random", JSON.stringify({ until: localDay(14) }));
  const r = hook(dir, trialCall(), {
    HOME: h,
    USERPROFILE: h,
    MAP_BRIEF_ARM: "",
  });
  const log = trialLog(h);
  check(
    "trial: with no MAP_BRIEF_ARM the arm is map or none, and the output follows it",
    log.length === 1 &&
      (log[0].arm === "map" ? updated(r) !== null : r.stdout === ""),
    r.stdout + JSON.stringify(log),
  );
}

// ---- the hook
let u = updated(
  hook(
    dir,
    agent("Fix the rounding bug in src/billing/invoice.js and add a test."),
  ),
);
check(
  "named file: the prompt keeps its text and gains the map lines",
  u &&
    u.prompt.startsWith(
      "Fix the rounding bug in src/billing/invoice.js and add a test.\n\nSYSTEMS MAP:",
    ) &&
    u.prompt.includes("## Invoice billing [billing]"),
);
// changed on purpose (job 6 S1): the brief gives a thing's rules and links, no start files
check(
  "named file: the thing's links follow, and no 'Start in' line",
  u &&
    !/Start in/.test(u.prompt) &&
    u.prompt.includes(
      "- from User login: Billing reads the signed-in account",
    ) &&
    u.prompt.includes("- to Dashboard screen: The dashboard lists"),
);
check(
  "named file: ends with the 'More' line naming map.mjs",
  u &&
    /\nMore: node ".*systems-map\/map\.mjs" --near <thing>; --near alone lists every thing\.$/.test(
      u.prompt,
    ),
);
check(
  "named file: every other field of the tool input is copied",
  u &&
    u.description === "Test: x" &&
    u.subagent_type === "worker" &&
    u.run_in_background === false,
);
// The trial's map arm differs from its none arm only by the map lines: the rewrite keeps run_in_background as sent
// (a terminal session, where serves.mjs foreground would set it to false)
{
  const term = { CLAUDE_CODE_ENTRYPOINT: "cli", BACKGROUND_TASKS: "" };
  const bg = updated(
    hook(
      dir,
      agent("Fix src/billing/invoice.js", "worker", {
        run_in_background: true,
      }),
      term,
    ),
  );
  const call = agent("Fix src/billing/invoice.js");
  delete call.tool_input.run_in_background;
  const absent = updated(hook(dir, call, term));
  check(
    "map arm: run_in_background stays as sent (true stays true, absent stays absent), so the arms differ only by the map lines",
    bg?.run_in_background === true &&
      absent !== null &&
      !("run_in_background" in absent),
    JSON.stringify({ bg: bg?.run_in_background, absent }),
  );
}
const out = hook(dir, agent("x src/billing/invoice.js")).stdout;
check(
  "the output is one PreToolUse updatedInput object",
  JSON.parse(out).hookSpecificOutput.hookEventName === "PreToolUse",
);

u = updated(hook(dir, agent("Look at how the user login works.")));
// changed on purpose (job 6 S1): only things matched by file are shown; a name alone gives none
check(
  "a thing's name alone, with no file of it, gets the nothing matched line",
  u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
  u?.prompt,
);
u = updated(hook(dir, agent("Change Dashboard.tsx", "reviewer")));
check(
  "a bare file name matches; reviewer is a covered type",
  u && u.prompt.includes("## Dashboard screen [dashboard]"),
);
u = updated(hook(dir, agent("Check src\\billing\\pricing.js")));
check(
  "a Windows-style path matches",
  u && u.prompt.includes("## Invoice billing [billing]"),
);
u = updated(hook(dir, agent("Review the planned change", "plan-reviewer")));
check(
  "a covered type whose brief matches nothing gets the nothing matched line",
  u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
);
u = updated(
  hook(dir, agent("Review the plan for Dashboard.tsx", "plan-reviewer")),
);
check(
  "plan-reviewer is a covered type",
  u && u.prompt.includes("## Dashboard screen [dashboard]"),
);

u = updated(hook(dir, agent("Change Dashboard.tsx", "worker-refactor")));
check(
  "worker-refactor is a covered type",
  u && u.prompt.includes("## Dashboard screen [dashboard]"),
);

u = updated(hook(dir, agent("Change Dashboard.tsx", "worker-code")));
check(
  "worker-code is a covered type",
  u && u.prompt.includes("## Dashboard screen [dashboard]"),
);

u = updated(hook(dir, agent("Fix the rounding in src/billing/tax.js")));
// changed on purpose (job 6 S1): a thing found through the folder of an unlisted file is not matched by file, so it is not shown
check(
  "folder fallback: a file no thing lists, in a thing's folder, gets the nothing matched line",
  u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
  u?.prompt,
);
u = updated(hook(dir, agent("Add a line to README.md about the install.")));
check(
  "folder fallback ignores the project root",
  u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
);
u = updated(
  hook(
    project("bare", { ...FILES, "src/billing/index.ts": "x" }, MAPDATA),
    agent("Export it from index.ts"),
  ),
);
check(
  "folder fallback: a bare common name points at no folder",
  u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
);
const parts = {
  nodes: ["a", "b", "c", "d"].map((k) => ({
    id: k,
    name: `Part ${k}`,
    what: "Does it.",
    files: [`lib/${k}.js`],
  })),
  links: [],
};
u = updated(
  hook(
    project(
      "crowded",
      {
        "lib/a.js": "x",
        "lib/b.js": "x",
        "lib/c.js": "x",
        "lib/d.js": "x",
        "lib/other.js": "x",
      },
      parts,
    ),
    agent("Fix the bug in lib/other.js"),
  ),
);
check(
  "folder fallback: a folder with more things than a brief carries counts for nothing",
  u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
);
u = updated(hook(dir, agent("Do something unrelated to anything listed.")));
// changed on purpose (B1): the "nothing matched" line is shorter and names one command
check(
  "nothing matched: one short line naming --near",
  u &&
    u.prompt.endsWith(
      `\n\nSYSTEMS MAP: nothing in this brief matched (node "${MAP.replace(/\\/g, "/")}" --near <word> looks one up).`,
    ),
  u?.prompt,
);
const done = agent("Fix src/billing/invoice.js\n\nSYSTEMS MAP: already here.");
check("marker already there: no output", hook(dir, done).stdout === "");
for (const t of ["Explore", "general-purpose", "claude", "worker-slim"])
  check(
    `other agent type (${t}): no output`,
    hook(dir, agent("Fix src/billing/invoice.js", t)).stdout === "",
  );
check(
  "other tool: no output",
  hook(dir, { tool_name: "Bash", tool_input: { command: "ls" } }).stdout === "",
);
check(
  "Task (the old tool name) is covered",
  updated(
    hook(dir, { ...agent("x src/billing/invoice.js"), tool_name: "Task" }),
  ) !== null,
);

const none = project("none", FILES, null);
const rn = hook(none, agent("Fix src/billing/invoice.js"));
check(
  "no map file: no output at all",
  rn.stdout === "" && rn.status === 0 && rn.stderr === "",
);
const handled = project("handled", FILES, {
  handledBy: ".claude/hooks/map-brief.py",
});
check(
  "a file with no nodes (handledBy): no output at all",
  hook(handled, agent("Fix src/billing/invoice.js")).stdout === "" &&
    hook(handled, agent("unrelated")).stdout === "",
);
check(
  "a map with an empty nodes list: no output at all",
  hook(project("empty", FILES, { nodes: [], links: [] }), agent("unrelated"))
    .stdout === "",
);
check(
  "MAP_BRIEF=off: no output",
  hook(dir, agent("Fix src/billing/invoice.js"), { MAP_BRIEF: "off" })
    .stdout === "",
);
const broken = hook(
  project("broken", FILES, "{ not json"),
  agent("Fix src/billing/invoice.js"),
);
check(
  "fails open on a broken map file: no output, exit 0, one line on stderr",
  broken.stdout === "" &&
    broken.status === 0 &&
    /map-brief hook skipped/.test(broken.stderr) &&
    broken.stderr.trim().split("\n").length === 1,
);
// Auto mode (permission_mode "auto"): an updatedInput would void Nimbalyst's classifier review, so the map lines go
// to the calling session as additionalContext, with a line telling it to paste them into the brief itself. Without
// the rewrite run_in_background is not forced either.
const autoCall = (prompt, extra = {}) => ({
  ...agent(prompt, "worker", extra),
  permission_mode: "auto",
});
for (const [name, call] of [
  ["auto", autoCall("Fix the rounding bug in src/billing/invoice.js.")],
  [
    "auto, a background helper",
    autoCall("Fix the rounding bug in src/billing/invoice.js.", {
      run_in_background: true,
    }),
  ],
]) {
  const r = hook(dir, call);
  let h = null;
  try {
    h = JSON.parse(r.stdout).hookSpecificOutput;
  } catch {}
  // the helper has already started with the brief as sent: the line asks for what can still be done
  check(
    `${name}: no updatedInput; the map lines go to the caller's context with a line to send them to the helper now`,
    h &&
      !("updatedInput" in h) &&
      !("permissionDecision" in h) &&
      h.additionalContext.includes("SYSTEMS MAP:") &&
      h.additionalContext.includes("## Invoice billing [billing]") &&
      /SendMessage/.test(h.additionalContext) &&
      /already returned, check its result/.test(h.additionalContext) &&
      /later helper/.test(h.additionalContext),
    r.stdout,
  );
}
check(
  "auto: a brief that already holds the marker: no output",
  hook(dir, { ...done, permission_mode: "auto" }).stdout === "",
);
const autoNone = hook(
  dir,
  autoCall("Do something unrelated to anything listed."),
).stdout;
check(
  "auto: a brief the map matches nothing in: no output (no 'nothing matched' line to send)",
  autoNone === "",
  autoNone,
);
// Any other mode: the output is byte for byte the one with no mode in the event
for (const mode of ["default", "acceptEdits", "bypassPermissions", "plan"])
  check(
    `mode ${mode}: the same output as now`,
    hook(dir, {
      ...agent("Fix src/billing/invoice.js", "worker", {
        run_in_background: true,
      }),
      permission_mode: mode,
    }).stdout ===
      hook(
        dir,
        agent("Fix src/billing/invoice.js", "worker", {
          run_in_background: true,
        }),
      ).stdout,
  );
const junk = hook(dir, "not json at all");
check("fails open on bad hook input", junk.stdout === "" && junk.status === 0);
check(
  "no project folder in the environment: no output",
  spawnSync("node", [HOOK], {
    input: JSON.stringify(agent("x")),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: "" },
  }).stdout === "",
);

// ---- changed on purpose (purpose record retired 2026-11-19): map-brief no longer adds the plan row's Serves lines
// nor runs the purpose check; it gives the map lines only and refuses nothing.
const plan = [
  "| Step | Job | Serves |",
  "|---|---|---|",
  '| B1 | Fix invoice | "rounding must match the tax office" (DECISIONS) |',
  "",
].join("\n");
const both = project("both", { ...FILES, "docs/plan.md": plan }, MAPDATA);
const call = agent(
  "STEP: B1 of docs/plan.md. Fix the rounding in src/billing/invoice.js.",
);
const fromMap = updated(hook(both, call, { SERVES_BRIEF: "" }));
check(
  "map-brief adds the map lines and no Serves line or purpose check (the purpose record is retired)",
  fromMap?.prompt.includes("## Invoice billing [billing]") &&
    !fromMap.prompt.includes("SERVES (from") &&
    !fromMap.prompt.includes("PURPOSE CHECK"),
  fromMap?.prompt,
);
// a row that names a thing in an old purpose record, with no Serves words for it and a limit not marked NARROWED
const refusedDir = project(
  "refused",
  {
    ...FILES,
    "docs/plan.md": [
      "| Step | Job | Files |",
      "|---|---|---|",
      "| B2 | Run the invoice billing, read-only | src/billing/invoice.js |",
      "",
    ].join("\n"),
    "DECISIONS.md": [
      "# Decisions",
      "",
      "## What each thing is for",
      "",
      '- **invoice billing** (also: billing): "Invoices that match the tax office." · *2026-01-05* · from "match the tax office"',
      "",
      "## 2026-01-05",
      "",
      '- **Billing follows the tax office.** The user: "every invoice has to match the tax office rules" · *user, 2026-01-05*',
      "",
    ].join("\n"),
  },
  MAPDATA,
);
const refusedCall = agent("STEP: B2 of docs/plan.md. Run it.");
const startOld = hook(refusedDir, refusedCall, { SERVES_BRIEF: "" });
check(
  "map-brief does not refuse a worker start on a row without Serves words (the purpose check is retired)",
  !startOld.stdout.includes('"deny"') &&
    updated(startOld)?.prompt.includes("SYSTEMS MAP:"),
  startOld.stdout,
);

// ---- deleted files are dropped
// changed on purpose (job 6 S1): the brief lists no start files or notes, so the "note that exists is kept" case went
u = updated(hook(dir, agent("Fix src/auth/login.js")));
check(
  "deleted file dropped: the thing is shown, with no gone file or note",
  u &&
    u.prompt.includes("## User login [auth]") &&
    !u.prompt.includes("removed") &&
    !u.prompt.includes("auth-removed"),
  u?.prompt,
);
u = updated(hook(dir, agent("Fix src/auth/removed.js")));
check(
  "a brief naming a deleted file: the file is no listed file, so nothing matched",
  u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
  u?.prompt,
);

// ---- the cap: 2,000 characters, at most 3 full entries, the rest named on one "Also matched by file" line
// changed on purpose (job 6 S1): things are matched by file, not by name; a further thing is named on one line with no start
// files, so the start-file cut and the one-line entries (with their "more matches left out" count) went
const big = { nodes: [], links: [] };
for (let k = 0; k < 5; k++)
  big.nodes.push({
    id: `area${k}`,
    name: `Area number ${k}`,
    what: `Thing ${k} does its job.`,
    files: [`src/a${k}.js`],
  });
for (let k = 0; k < 5; k++)
  for (let j = 0; j < 40; j++)
    big.links.push({
      from: `area${k}`,
      to: `area${(k + 1 + (j % 4)) % 5}`,
      says: `Link ${j} of area ${k}: ` + "words ".repeat(30),
      evidence: [`src/a${k}.js`],
    });
const bigDir = project(
  "big",
  Object.fromEntries([0, 1, 2, 3, 4].map((k) => [`src/a${k}.js`, "x"])),
  big,
);
const five =
  "Work on src/a0.js, src/a1.js, src/a2.js, src/a3.js and src/a4.js.";
const rb = cli(["--brief"], { cwd: bigDir, input: five });
const linkCounts = (s) =>
  s
    .split(/^## /m)
    .slice(1)
    .map((e) => (e.match(/^- (to|from|<-|\w+ ->) /gm) ?? []).length);
const alsoNames = (s) =>
  (/^Also matched by file \(--near <id>\): (.*)$/m.exec(s)?.[1] ?? "")
    .split(", ")
    .filter(Boolean);
check(
  "cap: at most 2,000 characters",
  rb.status === 0 &&
    rb.stdout.trimEnd().length <= 2000 &&
    rb.stdout.length > 1500,
  `length ${rb.stdout.length}`,
);
check(
  "cap: 5 file-matched things: at most 3 full entries, every other one named on the 'Also matched by file' line",
  linkCounts(rb.stdout).length >= 1 &&
    linkCounts(rb.stdout).length <= 3 &&
    linkCounts(rb.stdout).length + alsoNames(rb.stdout).length === 5,
  rb.stdout,
);
check(
  "cap: links cut with a '- (<k> more: --near <id>)' line, no command in it",
  /^- \(\d+ more: --near area\d\)$/m.test(rb.stdout) &&
    !rb.stdout.includes('node "'),
  rb.stdout,
);
check(
  "cap: a full entry moved to the Also line keeps every entry left at 3 links or more",
  linkCounts(rb.stdout).every((c) => c >= 3),
  `${linkCounts(rb.stdout)}`,
);
const hb = updated(hook(bigDir, agent(five)));
check(
  "cap: the hook adds at most 2,000 characters of map lines",
  hb && hb.prompt.length - five.length < 2000 + 700,
);

// cut order: links are cut, one at a time from the entry with the most, before any full entry moves
const cutMap = { nodes: [], links: [] };
for (let k = 0; k < 3; k++)
  cutMap.nodes.push({
    id: `c${k}`,
    name: `Cut part ${k}`,
    what: `Part ${k}.`,
    files: [`src/c${k}.js`],
  });
for (let k = 0; k < 3; k++)
  for (let j = 0; j < 6; j++)
    cutMap.links.push({
      from: `c${k}`,
      to: `c${(k + 1 + (j % 2)) % 3}`,
      says: `Link ${j} of part ${k}: ` + "w ".repeat(15),
      evidence: [`src/c${k}.js`],
    });
const rc = cli(["--brief"], {
  cwd: project(
    "cut-links",
    { "src/c0.js": "x", "src/c1.js": "x", "src/c2.js": "x" },
    cutMap,
  ),
  input: "Fix src/c0.js, src/c1.js and src/c2.js.",
});
check(
  "cut order: just over the cap, all 3 full entries stay and only links are cut",
  rc.stdout.trimEnd().length <= 2000 &&
    linkCounts(rc.stdout).length === 3 &&
    linkCounts(rc.stdout).every((c) => c >= 3) &&
    / more: --near c\d\)$/m.test(rc.stdout) &&
    !/^Also matched/m.test(rc.stdout),
  `length ${rc.stdout.length}, links ${linkCounts(rc.stdout)}\n${rc.stdout}`,
);

// refill: three 600-character entries; the third moves to the Also line and the links cut before that come back
const refMap = { nodes: [], links: [] };
for (let k = 0; k < 3; k++)
  refMap.nodes.push({
    id: `r${k}`,
    name: `Refill part ${k}`,
    what: "z".repeat(600),
    files: [`src/r${k}.js`],
  });
for (let k = 0; k < 3; k++)
  for (let j = 0; j < 4; j++)
    refMap.links.push({
      from: `r${k}`,
      to: `r${(k + 1 + (j % 2)) % 3}`,
      says: `Link ${j} of part ${k}.`,
      evidence: [`src/r${k}.js`],
    });
const rr = cli(["--brief"], {
  cwd: project(
    "refill-links",
    { "src/r0.js": "x", "src/r1.js": "x", "src/r2.js": "x" },
    refMap,
  ),
  input: "Fix src/r0.js, src/r1.js and src/r2.js.",
});
check(
  "refill: after the third entry moved to the Also line, the two left show all their links again",
  rr.stdout.trimEnd().length <= 2000 &&
    linkCounts(rr.stdout).length === 2 &&
    !/ more: --near/.test(rr.stdout) &&
    alsoNames(rr.stdout).length === 1,
  `length ${rr.stdout.length}, links ${linkCounts(rr.stdout)}\n${rr.stdout.slice(-400)}`,
);

// many file-matched things: the Also line names 8 and counts the rest
const wide = { nodes: [], links: [] };
for (let k = 0; k < 120; k++)
  wide.nodes.push({
    id: `part${k}`,
    name: `Part number ${k}`,
    what: `Part ${k} does its job.`,
    files: [`lib/part${k}/a-fairly-long-file-name-${k}.js`],
    rules: [`Part ${k} never writes to disk.`],
  });
const wideDir = project(
  "wide",
  Object.fromEntries(wide.nodes.flatMap((n) => n.files).map((f) => [f, "x"])),
  wide,
);
const rw = cli(["--brief"], {
  cwd: wideDir,
  input: wide.nodes.map((n) => n.files[0]).join(", "),
});
const wl = rw.stdout.trimEnd();
check(
  "cap: 120 file-matched things: 3 full entries, the Also line names 8 and counts the other 109",
  rw.status === 0 &&
    wl.length <= 2000 &&
    (wl.match(/^## /gm) ?? []).length === 3 &&
    /\nAlso matched by file \(--near <id>\): Part number 3 \[part3\], .*Part number 10 \[part10\] and 109 more$/.test(
      wl,
    ),
  wl.slice(-300),
);

// ---- ordinary words and written folders
const topics = {
  nodes: [
    {
      id: "release",
      name: "Release Beacon",
      what: "Announces a release.",
      files: ["src/release/beacon.js"],
    },
    {
      id: "quest",
      name: "Quest board",
      what: "Lists quests.",
      files: ["src/quest/board.js"],
    },
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({
      id: `wide${k}`,
      name: `Wide thing ${k}`,
      what: "Does it.",
      files: [`src/wide/w${k}.js`],
    })),
  ],
  links: [],
};
const topicDir = project(
  "topics",
  Object.fromEntries(topics.nodes.flatMap((n) => n.files).map((f) => [f, "x"])),
  topics,
);
const hookOn = (text) => updated(hook(topicDir, agent(text)));
check(
  '"release" alone matches nothing',
  hookOn(
    "Reviewing this change before the release and precision.",
  ).prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
);
// changed on purpose (job 6 S1): a name or folder match no longer reaches the brief (only file matches do); it still ranks things,
// so these cases read briefFind's match kinds
const { briefFind } = await import(pathToFileURL(MAP).href);
const kindOf = (text, nodes, id) =>
  briefFind(
    text,
    nodes.map((n) => ({ ...n, words: [] })),
    [],
    topicDir,
  )[2].get(id);
check(
  '"Release Beacon" still matches, by name',
  kindOf("Look at the Release Beacon.", topics.nodes, "release") === "name",
);
check(
  '"recall" is an ordinary word no more: it matches a thing whose id it is',
  kindOf(
    "Reviewing this change for recall and precision.",
    [
      {
        id: "recall",
        name: "Recall Beacon",
        what: "Brings a player home.",
        files: ["src/recall/beacon.js"],
      },
    ],
    "recall",
  ) === "name",
);
check(
  "a named narrow folder matches the things with files in it, by folder",
  // the id is renamed here so the written "src/quest" does not also match it by id
  kindOf(
    "Review target: src/quest",
    topics.nodes.map((n) => (n.id === "quest" ? { ...n, id: "qb" } : n)),
    "qb",
  ) === "folder",
);
u = hookOn("Review target: src/wide and src/wide/");
check(
  "a broad folder (files of more than 8 things) adds nothing",
  u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
);
u = hookOn("Fix the bug in src/wide/other.js");
check(
  "a named file in a broad folder still matches nothing (crowded-folder rule)",
  u.prompt.includes("SYSTEMS MAP: nothing in this brief matched ("),
);

// ---- --brief on its own
check(
  "--brief with no match prints nothing, exit 0",
  (() => {
    const r = cli(["--brief"], { input: "nothing here" });
    return r.status === 0 && r.stdout === "";
  })(),
);
check(
  "--brief with --project from another folder",
  cli(["--project", dir, "--brief"], {
    cwd: tmp,
    input: "src/billing/invoice.js",
  }).stdout.includes("## Invoice billing"),
);

// ---- --near
let r = cli(["--near"]);
check(
  "--near lists every thing",
  r.status === 0 &&
    ["auth", "billing", "dashboard", "settings"].every((i) =>
      r.stdout.includes(`- ${i}:`),
    ),
);
r = cli(["--near", "billing"]);
check(
  "--near <word>: the thing, its links with the code behind them, one step further",
  r.status === 0 &&
    r.stdout.includes("## Invoice billing [billing]") &&
    /- from User login: .* \(src\/auth\/session\.js, src\/billing\/invoice\.js\)/.test(
      r.stdout,
    ) &&
    /One step further: /.test(r.stdout),
);
r = cli(["--near", "auth"]);
check(
  "--near marks code that is gone",
  r.stdout.includes("src/auth/removed.js [GONE]"),
);
r = cli(["--near", "zzz-nothing"]);
check(
  "--near with an unknown word: exit 1 and says so",
  r.status === 1 && /nothing on the map matches "zzz-nothing"/.test(r.stderr),
);
check(
  "--near finds a thing by a file path",
  cli(["--near", "src/ui/Dashboard.tsx"]).stdout.includes(
    "## Dashboard screen",
  ),
);

// ---- --check
const good = project("good", FILES, {
  nodes: MAPDATA.nodes.map((n) => ({
    ...n,
    files: n.files.filter((f) => !f.includes("removed")),
    notes: (n.notes ?? []).filter((f) => !f.includes("removed")),
  })),
  links: MAPDATA.links,
});
r = cli(["--check"], { cwd: good });
check(
  "--check passes a clean map: exit 0",
  r.status === 0 && /^ok: 4 things, 2 links/m.test(r.stdout),
  r.stdout,
);
r = cli(["--check"]);
check(
  "--check catches a missing file: exit 1, names it, gives the share",
  r.status === 1 &&
    r.stdout.includes("GONE src/auth/removed.js") &&
    r.stdout.includes("GONE docs/auth-removed.md") &&
    /FAIL: .* 2 gone \(\d+\.\d%\)/.test(r.stdout),
  r.stdout,
);
const badLink = project("badlink", FILES, {
  nodes: MAPDATA.nodes.slice(1, 3),
  links: [
    {
      from: "billing",
      to: "nowhere",
      says: "Goes nowhere.",
      evidence: ["src/billing/invoice.js"],
    },
  ],
});
r = cli(["--check"], { cwd: badLink });
check(
  "--check catches a link to an unknown id: exit 1",
  r.status === 1 && /BAD .*to is not the id of a thing/.test(r.stdout),
  r.stdout,
);
const dup = project("dup", FILES, {
  nodes: [MAPDATA.nodes[1], MAPDATA.nodes[1]],
  links: [],
});
r = cli(["--check"], { cwd: dup });
check(
  "--check catches a duplicate id: exit 1",
  r.status === 1 && /duplicate id billing/.test(r.stdout),
  r.stdout,
);
r = cli(["--check"], { cwd: project("badjson", FILES, "{ nope") });
check(
  "--check catches invalid JSON: exit 1",
  r.status === 1 && /not valid JSON/.test(r.stderr),
);
r = cli(["--check"], {
  cwd: project("noev", FILES, {
    nodes: [MAPDATA.nodes[1], MAPDATA.nodes[2]],
    links: [{ from: "billing", to: "dashboard", says: "x", evidence: [] }],
  }),
});
check(
  "--check wants evidence on every link",
  r.status === 1 && /evidence must be a list of paths/.test(r.stdout),
);
r = cli(["--check"], { cwd: none });
check(
  "--check with no map: exit 1 and says where to learn how",
  r.status === 1 && /no map in/.test(r.stderr),
);
r = cli(["--check"], { cwd: handled });
check(
  "--check on a handledBy file: says who keeps it, exit 0",
  r.status === 0 && /kept by \.claude\/hooks\/map-brief\.py/.test(r.stdout),
);

// ---- rules on a thing, why on a link: --check validates them, --brief and --near show them
const RFILES = {
  "src/cart/cart.js": "x",
  "src/cart/total.js": "x",
  "src/pricing/price.js": "x",
  "src/mail/send.js": "x",
  "src/lonely.js": "x",
};
const RULE_CART = "Never round the total here; pricing rounds it.";
const WHY_PRICE =
  "The cart must never work out a price itself, so a price change lands in one place.";
const RMAP = {
  nodes: [
    {
      id: "cart",
      name: "Shopping cart",
      what: "Holds what the buyer picked.",
      files: ["src/cart/cart.js", "src/cart/total.js"],
      rules: [RULE_CART],
    },
    {
      id: "pricing",
      name: "Pricing",
      what: "Works out each price.",
      files: ["src/pricing/price.js"],
      rules: ["Prices are whole cents only."],
    },
    {
      id: "mail",
      name: "Receipt mail",
      what: "Sends the receipt.",
      files: ["src/mail/send.js"],
    },
    {
      id: "lonely",
      name: "Lonely part",
      what: "Has no rules and no links.",
      files: ["src/lonely.js"],
    },
  ],
  links: [
    {
      from: "pricing",
      to: "cart",
      type: "feeds",
      says: "Pricing gives the cart its prices.",
      why: WHY_PRICE,
      evidence: ["src/cart/total.js"],
    },
    {
      from: "cart",
      to: "mail",
      says: "The cart sends the receipt mail.",
      evidence: ["src/mail/send.js"],
    },
  ],
};
const rdir = project("rules", RFILES, RMAP);
r = cli(["--check"], { cwd: rdir });
check(
  "--check: a map with rules (list of lines) and why (a sentence) passes, exit 0",
  r.status === 0 && /^ok: 4 things, 2 links/m.test(r.stdout),
  r.stdout + r.stderr,
);
const badRules = project("badrules", RFILES, {
  nodes: [
    { ...RMAP.nodes[0], rules: RULE_CART },
    { ...RMAP.nodes[1], rules: ["Prices are whole cents only.", ""] },
    { ...RMAP.nodes[2], rules: [7] },
    RMAP.nodes[3],
  ],
  links: [
    { ...RMAP.links[0], why: "" },
    { ...RMAP.links[1], why: 3 },
  ],
});
r = cli(["--check"], { cwd: badRules });
const badLines = (r.stdout.match(/^BAD\s.*$/gm) ?? [])
  .map((l) => l.replace(/^BAD\s+/, "BAD "))
  .join("\n");
check(
  "--check refuses rules that is a string, not a list: exit 1",
  r.status === 1 && /BAD thing 1 \(cart\): rules must be a list/.test(badLines),
  r.stdout,
);
check(
  "--check refuses an empty rules line and a rules line that is no string",
  /BAD thing 2 \(pricing\): rules must be a list/.test(badLines) &&
    /BAD thing 3 \(mail\): rules must be a list/.test(badLines),
  r.stdout,
);
check(
  "--check refuses a why that is empty or no string",
  /BAD link 1 \(pricing -> cart\): why must be/.test(badLines) &&
    /BAD link 2 \(cart -> mail\): why must be/.test(badLines),
  r.stdout,
);
check(
  "--check: a thing with no rules and a link with no why are fine (no BAD line for lonely)",
  !/lonely/.test(badLines),
  r.stdout,
);

r = cli(["--brief"], { cwd: rdir, input: "Fix the sum in src/cart/total.js" });
check(
  "--brief: a thing matched by file shows its rules",
  r.status === 0 &&
    r.stdout.includes(`## Shopping cart [cart]`) &&
    r.stdout.includes(`Rules:\n- ${RULE_CART}`),
  r.stdout,
);
check(
  "--brief: a link of a file-matched thing shows its why after what it says",
  r.stdout.includes(
    `- <- feeds from Pricing: Pricing gives the cart its prices. Why: ${WHY_PRICE}`,
  ),
  r.stdout,
);
check(
  "--brief: no plain part-and-files lines (no 'Start in', no 'Also matched')",
  !/Start in/.test(r.stdout) && !/Also matched/.test(r.stdout),
  r.stdout,
);
r = cli(["--brief"], {
  cwd: rdir,
  input: "Change how the Shopping cart and the Receipt mail work",
});
check(
  "--brief: things matched by name alone, not by file, are left out",
  r.status === 0 && r.stdout === "",
  r.stdout,
);
r = cli(["--brief"], { cwd: rdir, input: "Fix src/lonely.js" });
check(
  "--brief: a file-matched thing with no rules and no links is left out",
  r.status === 0 && r.stdout === "",
  r.stdout,
);
r = cli(["--brief"], {
  cwd: rdir,
  input: "Fix src/cart/cart.js and src/mail/send.js",
});
const cartPart = r.stdout.split("## Shopping cart [cart]")[1] ?? "";
check(
  "--brief: the link nearest the brief's files comes first",
  cartPart.indexOf("- to Receipt mail:") >= 0 &&
    cartPart.indexOf("- to Receipt mail:") <
      cartPart.indexOf("- <- feeds from Pricing:"),
  r.stdout,
);

r = cli(["--near", "cart"], { cwd: rdir });
check(
  "--near shows a thing's rules",
  r.status === 0 && r.stdout.includes(`Rules:\n- ${RULE_CART}`),
  r.stdout,
);
check(
  "--near shows a link's why",
  /- <- feeds from Pricing: Pricing gives the cart its prices\. Why: The cart must never/.test(
    r.stdout,
  ),
  r.stdout,
);

// ---- --scan
const repo = path.join(tmp, "repo");
const repoFiles = {
  "package.json": JSON.stringify({
    name: "demo",
    main: "src/index.js",
    scripts: { build: "tsc", test: "node --test" },
  }),
  "src/index.js": "a\nb\nc",
  "src/api/routes/users.js": "x",
  "src/api/routes/orders.js": "x",
  "src/lib/util.ts": "x",
  "node_modules/dep/index.js": "x",
  "dist/out.js": "x",
  "docs/readme.md": "x",
  Makefile: "all:",
};
for (const [rel, text] of Object.entries(repoFiles)) {
  fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), text);
}
spawnSync("git", ["init", "-q"], { cwd: repo });
spawnSync("git", ["add", "-A"], { cwd: repo });
r = cli(["--scan"], { cwd: repo });
check(
  "--scan: counts tracked code files only, vendored and build folders skipped",
  r.status === 0 &&
    /: 4 tracked code files \(of 9 tracked files/.test(r.stdout),
  r.stdout.slice(0, 300),
);
check(
  "--scan: folders, biggest files, package scripts, main file, routes folder, Makefile",
  [
    "## Code files by folder",
    "src/ ",
    "## Biggest code files",
    'build="tsc"',
    "Main-looking files: src/index.js",
    "src/api/ 2 files",
    "Makefile",
  ].every((s) => r.stdout.includes(s)),
  r.stdout,
);
check("--scan: at most about 8 KB", r.stdout.length <= 8100);
const many = path.join(tmp, "many");
for (let d = 0; d < 60; d++)
  for (let f = 0; f < 12; f++) {
    const p = path.join(
      many,
      `pkg${d}`,
      `sub${f % 6}`,
      `routes`,
      `file${f}.js`,
    );
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, "x\n".repeat(f + d));
  }
spawnSync("git", ["init", "-q"], { cwd: many });
spawnSync("git", ["add", "-A"], { cwd: many });
r = cli(["--scan"], { cwd: many });
check(
  "--scan on a wide repo (720 files) still fits in about 8 KB",
  r.status === 0 &&
    r.stdout.length <= 8100 &&
    r.stdout.includes("720 tracked code files"),
  `length ${r.stdout.length}`,
);
r = cli(["--scan"], { cwd: none });
check(
  "--scan outside a git repository: exit 1 and says so",
  r.status === 1 && /needs a git repository/.test(r.stderr),
);

// ---- typed links, match words, tokened evidence, drift
const TFILES = {
  "src/cart/cart.js": "export function cartTotal() {}",
  "src/price/price.js": "export const PRICE_TABLE = 1;",
  "src/old/gone.js": "x",
  "src/ship/ship.js": "x",
  "DECISIONS.md":
    "# Decisions\n- Shipping rule: free over 50.\n- Unrelated line.\nplain line about shipping\n- Tax is off.\n",
};
const TMAP = {
  nodes: [
    {
      id: "cart",
      name: "Shopping cart",
      what: "Holds the items.",
      files: ["src/cart/cart.js"],
      group: "shop",
    },
    {
      id: "pricing",
      name: "Pricing",
      what: "Prices things.",
      files: ["src/price/price.js"],
    },
    {
      id: "ship",
      name: "Parcel dispatch",
      what: "Sends parcels.",
      files: ["src/ship/ship.js"],
      words: ["\\bshipping\\b", "free over"],
    },
  ],
  links: [
    {
      from: "pricing",
      to: "cart",
      type: "feeds",
      says: "Pricing feeds the cart total.",
      evidence: [
        { file: "src/cart/cart.js", token: "cartTotal" },
        "src/price/price.js",
      ],
    },
    {
      from: "ship",
      to: "cart",
      type: "limits",
      says: "Shipping limits the cart.",
      evidence: [{ file: "src/price/price.js", token: "NO_SUCH_TOKEN" }],
    },
    {
      from: "cart",
      to: "ship",
      says: "Cart hands over to dispatch.",
      evidence: [{ file: "src/old/missing.js", token: "x" }],
    },
  ],
};
const tdir = project("typed", TFILES, TMAP);
r = cli(["--check"], { cwd: tdir });
check(
  "--check: DRIFT line for a token that is gone",
  /^DRIFT src\/price\/price\.js {2}\(link ship -> cart\): no longer has: NO_SUCH_TOKEN$/m.test(
    r.stdout,
  ),
  r.stdout,
);
check(
  "--check: a token that is present is not drift",
  !/DRIFT src\/cart/.test(r.stdout),
);
check(
  "--check: summary counts drifted, exit 1",
  r.status === 1 &&
    /, 1 drifted, 0 common words$/m.test(r.stdout) &&
    /GONE src\/old\/missing\.js/.test(r.stdout),
  r.stdout,
);
const goodTdir = project("typed-good", TFILES, {
  ...TMAP,
  links: TMAP.links.slice(0, 1),
});
r = cli(["--check"], { cwd: goodTdir });
check(
  "--check: typed link with present token: ok, 0 drifted, exit 0",
  r.status === 0 && /^ok: .*, 0 drifted, 0 common words$/m.test(r.stdout),
  r.stdout,
);
const badMap = {
  nodes: [
    {
      id: "a",
      name: "A",
      what: "a",
      files: ["README.md"],
      group: 3,
      words: ["(", 5],
    },
  ],
  links: [
    {
      from: "a",
      to: "a",
      type: "bogus",
      says: "s",
      evidence: [{ file: "README.md", token: "" }],
    },
  ],
};
r = cli(["--check"], {
  cwd: project("typed-bad", { "README.md": "x" }, badMap),
});
check(
  "--check: BAD for unknown type",
  /BAD .*unknown type "bogus"/.test(r.stdout),
  r.stdout,
);
check(
  "--check: BAD for a regex that does not compile and a non-string word",
  /BAD .*words entry "\(" is not a valid regex/.test(r.stdout) &&
    /BAD .*words entry 5/.test(r.stdout),
  r.stdout,
);
check(
  "--check: BAD for a non-string group and an empty token",
  /BAD .*group must be a string/.test(r.stdout) &&
    /BAD .*evidence must be a list of paths or \{ file, token \}/.test(
      r.stdout,
    ),
  r.stdout,
);
r = cli(["--near", "pricing"], { cwd: tdir });
check(
  "--near: out-link shows its type word",
  /- feeds -> Shopping cart: Pricing feeds the cart total\./.test(r.stdout),
  r.stdout,
);
r = cli(["--near", "cart"], { cwd: tdir });
check(
  "--near: in-link shows <- type from",
  /- <- feeds from Pricing: /.test(r.stdout) &&
    /- <- limits from Parcel dispatch: /.test(r.stdout),
  r.stdout,
);
check(
  "--near: untyped link keeps to/from",
  /- to Parcel dispatch: Cart hands over to dispatch\./.test(r.stdout),
);
check(
  "--near: a drifted link and a gone link get [CODE GONE], a sound one does not",
  /limits from Parcel dispatch: .*\[CODE GONE\]$/m.test(r.stdout) &&
    /to Parcel dispatch: .*\[GONE\]\) \[CODE GONE\]$/m.test(r.stdout) &&
    !/feeds from Pricing: .*CODE GONE/.test(r.stdout),
  r.stdout,
);
r = cli(["--near", "ship"], { cwd: tdir });
check(
  "--near: Decided lines are the '- ' lines of DECISIONS.md that the words match, with their file and line",
  /Decided:\n- DECISIONS\.md:2: Shipping rule: free over 50\.\n/.test(
    r.stdout,
  ) && !/Unrelated line|plain line|Tax is off/.test(r.stdout),
  r.stdout,
);
r = cli(["--near", "pricing"], { cwd: tdir });
check(
  "--near: a thing with no words has no Decided lines",
  !/Decided:/.test(r.stdout),
);
r = cli(["--near", "ship"], {
  cwd: project(
    "typed-nodec",
    Object.fromEntries(
      Object.entries(TFILES).filter(([k]) => k !== "DECISIONS.md"),
    ),
    TMAP,
  ),
});
check(
  "--near: no DECISIONS.md, no Decided lines, no error",
  r.status === 0 && !/Decided:/.test(r.stdout),
  r.stderr,
);
// a split record: the root keeps the index, the entry lives in docs/decisions/x.md (line 4)
const SPLIT_INDEX = [
  "# Decisions",
  "",
  "## Decision files",
  "",
  'Entries live in docs/decisions/, moved there word for word. A new decision goes at the top of its topic file below; one that fits none goes in its job\'s file, docs/decisions/YYYY-MM-DD-<job>.md. Find any: grep -rn "<word>" DECISIONS.md docs/decisions/. Replaced entries: docs/decisions-archive.md.',
  "",
  "- `docs/decisions/x.md`: Shipping notes",
  "",
].join("\n");
r = cli(["--near", "ship"], {
  cwd: project(
    "typed-split",
    {
      ...Object.fromEntries(
        Object.entries(TFILES).filter(([k]) => k !== "DECISIONS.md"),
      ),
      "DECISIONS.md": SPLIT_INDEX,
      "docs/decisions/x.md":
        "# Shipping notes\n\n## Shipping notes\n- Shipping goes by courier.\n",
    },
    TMAP,
  ),
});
check(
  "--near: a line only in docs/decisions/x.md shows with its file and line; the index line is never shown",
  /Decided:\n- docs\/decisions\/x\.md:4: Shipping goes by courier\.\n/.test(
    r.stdout,
  ) && !/Shipping notes/.test(r.stdout),
  r.stdout + r.stderr,
);
r = cli(["--brief"], {
  cwd: tdir,
  input: "Work on the shipping rules, nothing else.",
});
// changed on purpose (B1, rule 3): a code part matched by words alone is no longer shown
check(
  "--brief: a code part matched by words alone is not shown",
  r.status === 0 && r.stdout === "",
  r.stdout,
);
// changed on purpose (job 6 S1): the brief names a file, since a name alone shows nothing; the dispatch part may still show as the far
// end of a cart link, so the check is that it gets no entry of its own
r = cli(["--brief"], {
  cwd: tdir,
  input: "Fix src/cart/cart.js.\nBudget: keep shipping costs out of it.",
});
check(
  "--brief: beside a thing matched by file, a code part matched by words alone gets no entry",
  /## Shopping cart \[cart\]/.test(r.stdout) &&
    !/## Parcel dispatch/.test(r.stdout),
  r.stdout,
);
check(
  "--brief: arrows show the type word",
  /- <- limits from|- limits -> |- <- feeds from|- feeds -> /.test(
    cli(["--brief"], { cwd: tdir, input: "Change src/cart/cart.js" }).stdout,
  ),
);
r = cli(["--brief"], { cwd: tdir, input: "Change src/cart/cart.js" });
check(
  "--brief: evidence given as { file, token } still finds the thing by file",
  /## Shopping cart \[cart\]/.test(r.stdout),
  r.stdout,
);
check(
  "map.mjs exports drift()",
  (await import(pathToFileURL(MAP).href)).drift(TMAP, tdir).length === 1,
);

// ---- a path names a thing only when it means one listed file; a shared file names none; --near keeps Decided short
const skillIds = ["alpha", "bravo", "charlie", "delta", "echo"];
const SFILES = {
  "docs/index.md": "x",
  "DECISIONS.md":
    "# Decisions\n" +
    Array.from(
      { length: 6 },
      (_, k) => `- Skill rule ${k + 1}: ${"long words ".repeat(40)}end.\n`,
    ).join(""),
};
for (const s of skillIds) SFILES[`skills/${s}/SKILL.md`] = "x";
SFILES["tools/solo.mjs"] = "x";
// each skill carries a rule (job 6 S1): a file-matched thing with no rules and no links is left out of the brief
const SMAP = {
  nodes: skillIds.map((s) => ({
    id: s,
    name: `Skill ${s}`,
    what: "A skill.",
    files: [`skills/${s}/SKILL.md`, "docs/index.md"],
    words: ["\\bskill rule\\b"],
    rules: [`Skill ${s} is edited in the repo only.`],
  })),
  links: [],
};
SMAP.nodes[0].files.push("tools/solo.mjs");
const sdir = project("shared", SFILES, SMAP);
r = cli(["--brief"], { cwd: sdir, input: "Fix the wording in SKILL.md." });
check(
  "--brief: a bare SKILL.md that five things list names none of them",
  r.status === 0 && r.stdout === "",
  r.stdout,
);
r = cli(["--brief"], {
  cwd: sdir,
  input: "Fix the wording in skills/charlie/SKILL.md.",
});
check(
  "--brief: a path with its folder names the one thing that lists it",
  /## Skill charlie \[charlie\]/.test(r.stdout) &&
    !/\[(alpha|bravo|delta|echo)\]/.test(r.stdout),
  r.stdout,
);
r = cli(["--brief"], { cwd: sdir, input: "Change solo.mjs only." });
check(
  "--brief: a bare name only one listed file has names its thing",
  /## Skill alpha \[alpha\]/.test(r.stdout),
  r.stdout,
);
r = cli(["--brief"], { cwd: sdir, input: "Update docs/index.md." });
check(
  "--brief: a file that five things list names none of them",
  r.status === 0 && r.stdout === "",
  r.stdout,
);
const LMAP = {
  nodes: ["a", "b", "c", "d"].map((id) => ({
    id,
    name: `Part ${id}`,
    what: "A part.",
    files: [`src/${id}.js`],
  })),
  links: [
    { from: "a", to: "b", says: "A calls B.", evidence: ["src/hub.js"] },
    { from: "c", to: "d", says: "C calls D.", evidence: ["src/hub.js"] },
  ],
};
const ldir = project(
  "evidence-hub",
  {
    "src/a.js": "x",
    "src/b.js": "x",
    "src/c.js": "x",
    "src/d.js": "x",
    "src/hub.js": "x",
  },
  LMAP,
);
r = cli(["--brief"], { cwd: ldir, input: "Change src/hub.js." });
check(
  "--brief: evidence alone names no thing when more than 3 things touch the file",
  r.status === 0 && r.stdout === "",
  r.stdout,
);
r = cli(["--brief"], {
  cwd: project(
    "evidence-small",
    { "src/a.js": "x", "src/b.js": "x", "src/hub.js": "x" },
    { nodes: LMAP.nodes.slice(0, 2), links: LMAP.links.slice(0, 1) },
  ),
  input: "Change src/hub.js.",
});
check(
  "--brief: evidence names its two things when at most 3 touch the file",
  /## Part a \[a\]/.test(r.stdout) && /## Part b \[b\]/.test(r.stdout),
  r.stdout,
);
r = cli(["--near", "alpha"], { cwd: sdir });
const decided = (r.stdout.split("Decided:\n")[1] ?? "")
  .split("\n")
  .filter((l) => l.startsWith("- DECISIONS.md:"));
check(
  "--near: at most 3 Decided lines, each at most 200 characters with its file and line",
  decided.length === 3 &&
    decided.every((l) => l.length <= 200) &&
    decided[0].startsWith("- DECISIONS.md:2: Skill rule 1:") &&
    /\(3 more in the decision files\)/.test(r.stdout),
  r.stdout,
);

// ---- match kind: words alone show nothing; a thing matched by file shows, and a words hit beside it adds no line
// changed on purpose (job 6 S1): the "(by words)" lines for how-to things went with the other plain part-and-files lines
const KFILES = {
  "src/billing/invoice.js": "x",
  "docs/a.md": "x",
  "docs/b.md": "x",
  "docs/c.md": "x",
};
const howTo = (id, name, words) => ({
  id,
  name,
  what: "How it is done.",
  files: [`docs/${id.slice(3)}.md`],
  group: "how-to",
  words,
});
const KMAP = {
  nodes: [
    {
      id: "billing",
      name: "Invoice billing",
      what: "Issues the invoice.",
      files: ["src/billing/invoice.js"],
      words: ["\\bpayment run\\b"],
      rules: ["Never issue two invoices for one order."],
    },
    howTo("do-a", "How to: alpha", ["\\balpha step\\b"]),
    howTo("do-b", "How to: bravo", ["\\bbravo step\\b"]),
  ],
  links: [],
};
const kdir = project("kinds", KFILES, KMAP);
r = cli(["--brief"], {
  cwd: kdir,
  input: "Do the alpha step once, then the bravo step.",
});
check(
  "words: how-to things matched by words alone give no lines",
  r.status === 0 && r.stdout === "",
  r.stdout,
);
r = cli(["--brief"], { cwd: kdir, input: "Start the payment run." });
u = updated(hook(kdir, agent("Start the payment run.")));
check(
  "words: a code part matched by words alone is not shown; alone, the hook writes the 'nothing matched' line",
  r.stdout === "" &&
    u?.prompt.includes("\n\nSYSTEMS MAP: nothing in this brief matched ("),
  r.stdout,
);
r = cli(["--brief"], {
  cwd: kdir,
  input: "Fix src/billing/invoice.js, then the alpha step.",
});
check(
  "words: a thing matched by file is shown with its rule, the words hit beside it adds nothing",
  r.stdout ===
    "## Invoice billing [billing]\nIssues the invoice.\nRules:\n- Never issue two invoices for one order.\nLinks: none\n",
  r.stdout,
);
r = cli(["--brief"], {
  cwd: kdir,
  input: "Add src/billing/new.ts for the alpha step.",
});
check(
  "fallback: an unlisted file's folder and a words hit give no lines (neither is a file match)",
  r.status === 0 && r.stdout === "",
  r.stdout,
);

// a one-word folder names nothing in the fallback; a folder with a slash does, as kind "folder"
const fnodes = [
  { id: "top", name: "Top hooks", files: ["hooks/y.mjs"], words: [] },
  { id: "deep", name: "Deep hooks", files: ["lib/hooks/y.mjs"], words: [] },
];
const fdir = project(
  "fallback",
  { "hooks/y.mjs": "x", "lib/hooks/y.mjs": "x" },
  {
    nodes: fnodes.map(({ words, ...n }) => ({ ...n, what: "x" })),
    links: [],
  },
);
check(
  "fallback: the unlisted hooks/x.mjs (one-word folder) matches nothing",
  cli(["--brief"], { cwd: fdir, input: "Add hooks/x.mjs." }).stdout === "",
);
const [fRanked, , fKinds] = briefFind("Add lib/hooks/x.mjs.", fnodes, [], fdir);
check(
  "fallback: the unlisted lib/hooks/x.mjs beside a listed lib/hooks/y.mjs gives that thing, kind folder",
  fRanked.join() === "deep" && fKinds.get("deep") === "folder",
  `${fRanked} ${[...fKinds]}`,
);

// a file of the project root is named by its bare name or the root's own path, not by a path into another folder
const rnodes = [
  { id: "hn", name: "Handoff notes", files: ["HANDOFF.md"], words: [] },
  { id: "pr", name: "Project rules", files: ["CLAUDE.md"], words: [] },
];
const rroot = "C:/Work/app";
const rfind = (t, d = rroot, n = rnodes) => briefFind(t, n, [], d)[0].join();
for (const [t, want] of [
  ["Read ~/.claude/CLAUDE.md first.", ""],
  ["Copy the steps from C:/Other/HANDOFF.md.", ""],
  ["Update HANDOFF.md.", "hn"],
  [`Update ${rroot}/HANDOFF.md.`, "hn"],
  ["Update C:\\Work\\App\\handoff.md.", "hn"],
])
  check(
    `root file: "${t}" names ${want || "nothing"}`,
    rfind(t) === want,
    rfind(t),
  );

// a listed path with a space names its file when the brief holds it whole; plain text with the same words does not
const spnodes = [
  {
    id: "sp",
    name: "Spaced hook",
    files: [
      "C:/Projects/my apps/github-staging/claude-code-hooks/hooks/map-brief.mjs",
    ],
    words: [],
  },
  { id: "mn", name: "Meeting log", files: ["docs/my notes.md"], words: [] },
];
const sroot = "C:/Projects/my apps";
for (const [t, want, d = rroot, n = spnodes] of [
  [
    "Fix C:/Projects/my apps/github-staging/claude-code-hooks/hooks/map-brief.mjs now.",
    "sp",
  ],
  [
    "Fix C:\\Projects\\My Apps\\github-staging\\claude-code-hooks\\hooks\\map-brief.mjs now.",
    "sp",
  ],
  ["Look at the my apps folder and map-brief.", ""],
  ["Fill in docs/my notes.md.", "mn"],
  ["Fill in my notes.", ""],
  [`Update ${sroot}/HANDOFF.md.`, "hn", sroot, rnodes],
  ["Update C:/Other projects/HANDOFF.md.", "", sroot, rnodes],
])
  check(
    `space path: "${t}" names ${want || "nothing"}`,
    rfind(t, d, n) === want,
    rfind(t, d, n),
  );

// changed on purpose (job 6 S1): the shared-folder "Start in" form, the words-line cut and the one-line refill went with the start
// files and the one-line entries; the cut order and the link refill are tested with the cap above
// a top entry with a 2,500-character `what`: its name and what stay; its links shrink to one line; the others move to the Also line
const LFILES = { "src/l1.js": "x", "src/l2.js": "x", "src/l3.js": "x" };
const LNODES = [1, 2, 3].map((k) => ({
  id: `l${k}`,
  name: `Long part ${k}`,
  what: k === 1 ? "y".repeat(2500) : `Part ${k}.`,
  files: [`src/l${k}.js`],
}));
const ldir2 = project("long-what", LFILES, {
  nodes: LNODES,
  links: [
    { from: "l1", to: "l2", says: "One feeds two.", evidence: ["src/l1.js"] },
    { from: "l1", to: "l3", says: "One feeds three.", evidence: ["src/l1.js"] },
  ],
});
r = cli(["--brief"], { cwd: ldir2, input: "Fix src/l1.js only." });
check(
  "long what: the top entry keeps its name and what; every link cut reads 'Links: <k> (--near <id>)'",
  r.stdout.startsWith(
    `## Long part 1 [l1]\n${"y".repeat(2500)}\nLinks: 2 (--near l1)`,
  ),
  r.stdout.slice(2500),
);
check(
  "long what: the second and third full entries moved to the Also line, then were counted",
  (r.stdout.match(/^## /gm) ?? []).length === 1 &&
    r.stdout.endsWith("\n\nAlso matched by file (--near <id>): 2 more\n"),
  r.stdout.slice(2500),
);
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
