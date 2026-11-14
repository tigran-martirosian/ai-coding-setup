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

const hook = (cwd, input, env = {}) =>
  spawnSync("node", [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, MAP_BRIEF: "", CLAUDE_PROJECT_DIR: cwd, ...env },
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
check(
  "named file: the thing starts in that file first, and its links follow",
  u &&
    /Start in: src\/billing\/invoice\.js, src\/billing\/pricing\.js/.test(
      u.prompt,
    ) &&
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
const out = hook(dir, agent("x src/billing/invoice.js")).stdout;
check(
  "the output is one PreToolUse updatedInput object",
  JSON.parse(out).hookSpecificOutput.hookEventName === "PreToolUse",
);

u = updated(hook(dir, agent("Look at how the user login works.")));
check(
  "a thing's name as whole words matches",
  u &&
    u.prompt.includes("## User login [auth]") &&
    !u.prompt.includes("## Invoice billing"),
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
u = updated(hook(dir, agent("Review the planned change", "planner")));
check(
  "planner is a covered type (nothing matched line)",
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
check(
  "folder fallback: a file no thing lists, in a thing's folder, finds that thing",
  u &&
    u.prompt.includes("## Invoice billing [billing]") &&
    !u.prompt.includes("## User login"),
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

// ---- serves-brief runs on the same call and only one updatedInput is used: both hooks build the same full brief
const SERVES_HOOK = fileURLToPath(
  new URL("../hooks/serves-brief.mjs", import.meta.url),
);
const plan = [
  "| Step | Job | Serves |",
  "|---|---|---|",
  '| B1 | Fix invoice | "rounding must match the tax office" (DECISIONS) |',
  "",
].join("\n");
const both = project("both", { ...FILES, "docs/plan.md": plan }, MAPDATA);
const servesHook = (input, env = {}) =>
  spawnSync("node", [SERVES_HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      MAP_BRIEF: "",
      SERVES_BRIEF: "",
      CLAUDE_PROJECT_DIR: both,
      ...env,
    },
  });
const call = agent(
  "STEP: B1 of docs/plan.md. Fix the rounding in src/billing/invoice.js.",
);
const fromMap = updated(hook(both, call, { SERVES_BRIEF: "" })),
  fromServes = updated(servesHook(call));
// changed on purpose (purpose check): the Serves part now ends with the PURPOSE CHECK result line
const servesLine =
  '\n\nSERVES (from docs/plan.md B1): "rounding must match the tax office" (DECISIONS)' +
  `\nPURPOSE CHECK: not run: no DECISIONS.md in ${both.replace(/\\/g, "/")}.`;
check(
  "both hooks: the same brief, map lines then the Serves line, whichever output is used",
  fromMap &&
    JSON.stringify(fromMap) === JSON.stringify(fromServes) &&
    fromMap.prompt.endsWith(servesLine) &&
    fromMap.prompt.indexOf("## Invoice billing [billing]") <
      fromMap.prompt.indexOf("SERVES (from"),
  fromMap?.prompt,
);
const mapOff = updated(servesHook(call, { MAP_BRIEF: "off" }));
check(
  "MAP_BRIEF=off: map-brief says nothing, serves-brief still gives the Serves line and no map lines",
  hook(both, call, { MAP_BRIEF: "off" }).stdout === "" &&
    mapOff?.prompt === call.tool_input.prompt + servesLine,
);
const servesOff = updated(hook(both, call, { SERVES_BRIEF: "off" }));
check(
  "SERVES_BRIEF=off: serves-brief says nothing, map-brief still gives the map lines and no Serves line",
  servesHook(call, { SERVES_BRIEF: "off" }).stdout === "" &&
    servesOff?.prompt.includes("## Invoice billing [billing]") &&
    !servesOff.prompt.includes("SERVES (from"),
);
// a worker start on a row that fails the purpose check: both hooks refuse with the same text, so the refusal holds
// whichever output is used; the off switches still work
const refusedDir = project(
  "refused",
  {
    ...FILES,
    "docs/plan.md": [
      "| Step | Job | Serves |",
      "|---|---|---|",
      '| B2 | Run the invoice billing, read-only | "rounding must match the tax office" (DECISIONS) |',
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
const denyOf = (r) => {
  try {
    const o = JSON.parse(r.stdout).hookSpecificOutput;
    return o.permissionDecision === "deny" ? o.permissionDecisionReason : null;
  } catch {
    return null;
  }
};
const mapDeny = denyOf(hook(refusedDir, refusedCall, { SERVES_BRIEF: "" })),
  servesDeny = denyOf(
    servesHook(refusedCall, { CLAUDE_PROJECT_DIR: refusedDir }),
  );
check(
  "both hooks refuse a worker start on a failing row, with the same text",
  !!mapDeny &&
    mapDeny === servesDeny &&
    mapDeny.includes('"Invoices that match the tax office."') &&
    mapDeny.includes('"read-only"'),
  `${mapDeny}\n     ${servesDeny}`,
);
check(
  "MAP_BRIEF=off: map-brief says nothing, serves-brief still refuses",
  hook(refusedDir, refusedCall, { MAP_BRIEF: "off" }).stdout === "" &&
    !!denyOf(
      servesHook(refusedCall, {
        CLAUDE_PROJECT_DIR: refusedDir,
        MAP_BRIEF: "off",
      }),
    ),
);
check(
  "SERVES_BRIEF=off: no refusal from either hook, map-brief gives the map lines",
  !denyOf(hook(refusedDir, refusedCall, { SERVES_BRIEF: "off" })) &&
    updated(
      hook(refusedDir, refusedCall, { SERVES_BRIEF: "off" }),
    )?.prompt.includes("SYSTEMS MAP:") &&
    servesHook(refusedCall, {
      CLAUDE_PROJECT_DIR: refusedDir,
      SERVES_BRIEF: "off",
    }).stdout === "",
);

// ---- deleted files are dropped
u = updated(hook(dir, agent("Fix src/auth/login.js")));
check(
  "deleted file dropped: not in Start in, and no gone notes",
  u &&
    u.prompt.includes("Start in: src/auth/login.js, src/auth/session.js") &&
    !u.prompt.includes("removed") &&
    !u.prompt.includes("auth-removed"),
);
check(
  "a listed note that exists is kept",
  updated(hook(dir, agent("Fix src/billing/invoice.js"))).prompt.includes(
    "Read: docs/billing.md",
  ),
);
u = updated(hook(dir, agent("Fix src/auth/removed.js")));
check(
  "a brief naming a deleted file: found by its folder, the deleted file is not listed",
  u &&
    u.prompt.includes("## User login [auth]") &&
    !/Start in:.*removed/.test(u.prompt.split("Fix src/auth/removed.js")[1]),
);

// ---- the cap: 2,000 characters, 3 full entries, one line for each further match
// changed on purpose (B1): the cap went from 7,000 to 2,000 characters, and the "more links" line no longer repeats the command
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
  "Work on Area number 0, Area number 1, Area number 2, Area number 3 and Area number 4.";
const rb = cli(["--brief"], { cwd: bigDir, input: five });
check(
  "cap: at most 2,000 characters",
  rb.status === 0 &&
    rb.stdout.trimEnd().length <= 2000 &&
    rb.stdout.length > 1500,
  `length ${rb.stdout.length}`,
);
check(
  "cap: 5 matches give 3 full entries and one line each for the other 2",
  (rb.stdout.match(/^## /gm) ?? []).length === 3 &&
    /Also matched/.test(rb.stdout) &&
    (rb.stdout.match(/^- Area number \d \[area\d\]: src\/a\d\.js$/gm) ?? [])
      .length === 2,
  rb.stdout.slice(-300),
);
check(
  "cap: links cut with a '- (<k> more: --near <id>)' line, no command in it",
  /^- \(\d+ more: --near area\d\)$/m.test(rb.stdout) &&
    !rb.stdout.includes('node "'),
  rb.stdout,
);
const hb = updated(hook(bigDir, agent(five)));
check(
  "cap: the hook adds at most 2,000 characters of map lines",
  hb && hb.prompt.length - five.length < 2000 + 700,
);

// ---- trim order: over the cap, start files are cut to 3 before any link is cut
const WORDS = 0; // link text length: full output is a little over 2,000 characters, and fits once the start files are cut to 3
const fat = { nodes: [], links: [] };
const fatFiles = (k) =>
  [0, 1, 2, 3, 4, 5].map((j) => `src/area${k}/module-with-a-long-name-${j}.js`);
for (let k = 0; k < 3; k++)
  fat.nodes.push({
    id: `area${k}`,
    name: `Area number ${k}`,
    what: `Thing ${k} does its job.`,
    files: fatFiles(k),
  });
for (let k = 0; k < 3; k++)
  for (let j = 0; j < 6; j++)
    fat.links.push({
      from: `area${k}`,
      to: `area${(k + 1 + (j % 2)) % 3}`,
      says: `Link ${j} of area ${k}: ` + "words ".repeat(WORDS),
      evidence: [fatFiles(k)[0]],
    });
const fatDir = project(
  "fat",
  Object.fromEntries(fat.nodes.flatMap((n) => n.files).map((f) => [f, "x"])),
  fat,
);
const threeNames = "Work on Area number 0, Area number 1 and Area number 2.";
const noCap = cli(["--brief"], { cwd: fatDir, input: threeNames });
const startCounts = (s) =>
  (s.match(/^Start in: .*$/gm) ?? []).map(
    (l) => l.slice(10).split(", ").length,
  );
check(
  "trim order: just over the cap, every thing keeps only 3 start files",
  startCounts(noCap.stdout).length === 3 &&
    startCounts(noCap.stdout).every((c) => c === 3),
  `counts ${startCounts(noCap.stdout)}, length ${noCap.stdout.length}`,
);
check(
  "trim order: with the files cut, no link is cut (36 link lines, no 'more' line)",
  !/ more: --near|^Links: \d/m.test(noCap.stdout) &&
    (noCap.stdout.match(/^- (to|from) /gm) ?? []).length === 36,
  noCap.stdout.slice(-200),
);
check(
  "under the cap nothing is cut: a thing with 6 files lists all 6",
  startCounts(
    cli(["--brief"], { cwd: fatDir, input: "Work on Area number 0." }).stdout,
  )[0] === 6,
);

// ---- more matches than fit: one-liners cut at the cap, with the count left out
const wide = { nodes: [], links: [] };
for (let k = 0; k < 120; k++)
  wide.nodes.push({
    id: `part${k}`,
    name: `Part number ${k}`,
    what: `Part ${k} does its job.`,
    files: [
      `lib/part${k}/a-fairly-long-file-name-${k}.js`,
      `lib/part${k}/another-long-file-name-${k}.js`,
    ],
  });
const wideDir = project(
  "wide",
  Object.fromEntries(wide.nodes.flatMap((n) => n.files).map((f) => [f, "x"])),
  wide,
);
const rw = cli(["--brief"], {
  cwd: wideDir,
  input: wide.nodes.map((n) => n.name).join(", "),
});
const wl = rw.stdout.trimEnd();
check(
  "cap: 120 matches stay within 2,000 characters, every line whole",
  rw.status === 0 &&
    wl.length <= 2000 &&
    wl.length > 1800 &&
    wl
      .split("\n")
      .filter((l) => l.startsWith("- Part"))
      .every((l) =>
        /^- Part number (\d+) \[part\1\]: lib\/part\1\/a-fairly-long-file-name-\1\.js, lib\/part\1\/another-long-file-name-\1\.js$/.test(
          l,
        ),
      ),
  `length ${wl.length}`,
);
check(
  "cap: the cut ends with the count of matches left out",
  (() => {
    const m = /\n- \((\d+) more matches left out\)$/.exec(wl);
    const shown = (wl.match(/^- Part number \d+ \[part\d+\]: /gm) ?? []).length;
    return m && Number(m[1]) + shown + 3 === 120;
  })(),
  wl.slice(-120),
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
check(
  '"Release Beacon" still matches',
  hookOn("Look at the Release Beacon.").prompt.includes(
    "## Release Beacon [release]",
  ),
);
check(
  '"recall" is an ordinary word no more: it matches a thing whose id it is',
  updated(
    hook(
      project(
        "recall",
        { "src/recall/beacon.js": "x" },
        {
          nodes: [
            {
              id: "recall",
              name: "Recall Beacon",
              what: "Brings a player home.",
              files: ["src/recall/beacon.js"],
            },
          ],
          links: [],
        },
      ),
      agent("Reviewing this change for recall and precision."),
    ),
  ).prompt.includes("## Recall Beacon [recall]"),
);
u = hookOn("Review target: src/quest");
check(
  "a named narrow folder matches the things with files in it",
  u.prompt.includes("## Quest board [quest]"),
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
  "--near: Decided lines are the '- ' lines of DECISIONS.md that the words match, with their line number",
  /Decided:\n- line 2: Shipping rule: free over 50\.\n/.test(r.stdout) &&
    !/Unrelated line|plain line|Tax is off/.test(r.stdout),
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
r = cli(["--brief"], {
  cwd: tdir,
  input: "Fix the Pricing table.\nBudget: keep shipping costs out of it.",
});
check(
  "--brief: beside a thing the brief names, a code part matched by words alone is not shown",
  /## Pricing \[pricing\]/.test(r.stdout) && !/Parcel dispatch/.test(r.stdout),
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
const SMAP = {
  nodes: skillIds.map((s) => ({
    id: s,
    name: `Skill ${s}`,
    what: "A skill.",
    files: [`skills/${s}/SKILL.md`, "docs/index.md"],
    words: ["\\bskill rule\\b"],
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
  .filter((l) => l.startsWith("- line "));
check(
  "--near: at most 3 Decided lines, each at most 200 characters with its line number",
  decided.length === 3 &&
    decided.every((l) => l.length <= 200) &&
    decided[0].startsWith("- line 2: Skill rule 1:") &&
    /\(3 more in DECISIONS\.md\)/.test(r.stdout),
  r.stdout,
);

// ---- match kind: words alone give a how-to thing one line, a code part nothing; shared folders; cut order
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
    },
    howTo("do-a", "How to: alpha", ["\\balpha step\\b"]),
    howTo("do-b", "How to: bravo", ["\\bbravo step\\b"]),
    howTo("do-c", "How to: charlie", [
      "\\bcharlie step\\b",
      "\\bcharlie go\\b",
    ]),
  ],
  links: [],
};
const kdir = project("kinds", KFILES, KMAP);
r = cli(["--brief"], { cwd: kdir, input: "Do the alpha step once." });
check(
  "words: a how-to thing matched by words alone is one line ending ' (by words)', no full entry",
  r.stdout ===
    "Also matched (name, where to start):\n- How to: alpha [do-a]: docs/a.md (by words)\n",
  r.stdout,
);
r = cli(["--brief"], {
  cwd: kdir,
  input: "The alpha step, the bravo step, the charlie step, charlie go.",
});
check(
  "words: of three how-to things matched by words alone, the best 2 by rank are shown",
  /\[do-c\][^\n]*\(by words\)\n- How to: alpha \[do-a\]/.test(r.stdout) &&
    !/do-b/.test(r.stdout) &&
    !/left out/.test(r.stdout),
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
  "words: a thing matched by file is a full entry, the words line comes last",
  r.stdout.startsWith("## Invoice billing [billing]") &&
    r.stdout.endsWith(
      "\n\nAlso matched (name, where to start):\n- How to: alpha [do-a]: docs/a.md (by words)\n",
    ),
  r.stdout,
);
r = cli(["--brief"], {
  cwd: kdir,
  input: "Add src/billing/new.ts for the alpha step.",
});
check(
  "fallback: an unlisted file's folder still counts beside a words hit (full entry, then the words line)",
  r.stdout.startsWith("## Invoice billing [billing]") &&
    /\n- How to: alpha \[do-a\]: docs\/a\.md \(by words\)\n$/.test(r.stdout),
  r.stdout,
);

// a one-word folder names nothing in the fallback; a folder with a slash does, as kind "folder"
const { briefFind } = await import(pathToFileURL(MAP).href);
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

// a long absolute folder that every file of a line starts with is written once
const abs = path
  .join(tmp, "shared-abs-map", "shared-abs", "some", "folder")
  .replace(/\\/g, "/");
const other = process.execPath.replace(/\\/g, "/");
const AFILES = {};
for (const f of ["a.js", "b.js", "c.js", "d.js", "e.js"])
  AFILES[`shared-abs/some/folder/${f}`] = "x";
const part = (id, files) => ({ id, name: `Part ${id}`, what: "x", files });
const adir = project("shared-abs-map", AFILES, {
  nodes: [
    part("x", [`${abs}/a.js`, `${abs}/b.js`, `${abs}/c.js`]),
    part("y", [`${abs}/d.js`]),
    part("z", [`${abs}/e.js`, other]),
    part("w", [`${abs}/d.js`, `${abs}/e.js`]),
  ],
  links: [],
});
r = cli(["--brief"], {
  cwd: adir,
  input: "Part x, Part y, Part z and Part w.",
});
check(
  "shared folder: three files under one long folder read 'Start in <folder>/: a, b, c'",
  r.stdout.includes(`\nStart in ${abs}/: a.js, b.js, c.js\n`),
  r.stdout,
);
check(
  "shared folder: one file, or files in two folders, keep their whole paths",
  r.stdout.includes(`\nStart in: ${abs}/d.js\n`) &&
    r.stdout.includes(`\nStart in: ${abs}/e.js, ${other}\n`),
  r.stdout,
);
check(
  "shared folder: a one-line entry reads '- <name> [<id>] in <folder>/: a, b'",
  r.stdout.includes(`\n- Part w [w] in ${abs}/: d.js, e.js`),
  r.stdout,
);

// cut order: one-line entries go before a full entry loses its head, words lines before the others
const WHAT = 560; // characters of each `what`: the output is just over 2,000 and fits once the words line is cut
const OFILES = { "docs/w.md": "x" };
const ONODES = [];
for (const k of [1, 2, 3, 4, 5]) {
  OFILES[`src/o${k}.js`] = "x";
  ONODES.push({
    id: `o${k}`,
    name: `Order part ${k}`,
    what: `Part ${k} ` + "x".repeat(WHAT),
    files: [`src/o${k}.js`],
  });
}
ONODES.push({ ...howTo("do-w", "How to: whistle", ["\\bwhistle loud\\b"]) });
const odir = project("cut-order", OFILES, { nodes: ONODES, links: [] });
r = cli(["--brief"], {
  cwd: odir,
  input:
    "Order part 1, Order part 2, Order part 3, Order part 4, Order part 5; whistle loud.",
});
check(
  "cut order: the words line is cut first; the file-matched one-line entries and all 3 full entries stay",
  r.stdout.trimEnd().length <= 2000 &&
    (r.stdout.match(/^## /gm) ?? []).length === 3 &&
    /\n- Order part 4 \[o4\]: src\/o4\.js\n- Order part 5 \[o5\]: src\/o5\.js\n- \(1 more matches left out\)\n$/.test(
      r.stdout,
    ),
  `length ${r.stdout.length}\n${r.stdout.slice(-200)}`,
);

// a top entry with a 2,500-character `what`: its name, what and start files stay; its links shrink to one line
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
r = cli(["--brief"], {
  cwd: ldir2,
  input: "Long part 1, Long part 2 and Long part 3.",
});
check(
  "long what: the top entry keeps its name, what and start files; every link cut reads 'Links: <k> (--near <id>)'",
  r.stdout.startsWith(
    `## Long part 1 [l1]\n${"y".repeat(2500)}\nStart in: src/l1.js\nLinks: 2 (--near l1)`,
  ),
  r.stdout.slice(2500),
);
check(
  "long what: the second and third full entries became one-line entries, then were left out",
  (r.stdout.match(/^## /gm) ?? []).length === 1 &&
    r.stdout.endsWith(
      "\n\nAlso matched (name, where to start):\n- (2 more matches left out)\n",
    ),
  r.stdout.slice(2500),
);

// three 700-character entries: the third becomes one line, and the one-line entries cut before it come back into the freed room
const WFILES = {};
const WNODES = [1, 2, 3, 4, 5, 6, 7].map((k) => {
  WFILES[`src/w${k}.js`] = "x";
  return {
    id: `w${k}`,
    name: `Wide part ${k}`,
    what: k <= 3 ? "z".repeat(700) : `Part ${k}.`,
    files: [`src/w${k}.js`],
  };
});
r = cli(["--brief"], {
  cwd: project("refill", WFILES, { nodes: WNODES, links: [] }),
  input: WNODES.map((n) => n.name).join(", ") + ".",
});
check(
  "refill: after the third full entry became one line, all five one-line entries are shown",
  (r.stdout.match(/^## /gm) ?? []).length === 2 &&
    [3, 4, 5, 6, 7].every((k) =>
      r.stdout.includes(`\n- Wide part ${k} [w${k}]`),
    ) &&
    !r.stdout.includes("left out") &&
    r.stdout.length <= 2000,
  `length ${r.stdout.length}\n${r.stdout.slice(1400)}`,
);
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
