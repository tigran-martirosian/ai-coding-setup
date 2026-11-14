// Tests for hooks/serves-brief.mjs and its rules in hooks/lib/serves.mjs: a plan row's Serves cell travels into the
// helper's brief. Run: node tests/test-serves-brief.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/serves-brief.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "serves-brief-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`,
  );
};

// A project folder with files: relative path -> content.
const project = (name, files) => {
  const dir = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  return dir;
};
const PLAN = [
  "# Plan",
  "",
  "| Step | Helper | What it does |",
  "|---|---|---|",
  "| I1 | worker | Builds the cases |",
  "| I3, only on your yes | worker-code | The hook |",
  "",
  "| Step | Job | Decides | Serves | Files | Done when |",
  "|---|---|---|---|---|---|",
  "| I1 | Build cases | the brief | “prove it on the real case” (DECISIONS 2026-11-12) | `cases.jsonl` | `git show x | grep -c y` → 1 |",
  "| I2 | Text fix | wording | decided, see DECISIONS | `agents/` | tests pass |",
  '| I3 | New hook | nothing | "hook I3 yes" (DECISIONS 2026-11-12) | `hooks/` | its test passes |',
  "| I4 | Run batch | nothing |  | `run/` | 6 results |",
  "| I6 | Merge | nothing | none (mechanics) | live files | 0 differ |",
  "| ~~LR1~~ | **DROPPED** | | | | |",
  "",
].join("\n");
const OLD = [
  "# Old plan",
  "",
  "| Step | Job | Done when |",
  "|---|---|---|",
  "| A1 | Build | passes |",
  "",
].join("\n");
const dir = project("main", {
  "docs/plan.md": PLAN,
  "docs/old-plan.md": OLD,
  "docs/notes.md": "# Notes\n\nNo table.\n",
});

const hook = (input, { cwd = dir, env = {} } = {}) =>
  spawnSync("node", [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      SERVES_BRIEF: "",
      MAP_BRIEF: "",
      CLAUDE_PROJECT_DIR: cwd,
      ...env,
    },
  });
const agent = (prompt, type = "worker", extra = {}) => ({
  tool_name: "Agent",
  cwd: dir,
  tool_input: {
    description: "Test: x",
    prompt,
    subagent_type: type,
    run_in_background: false,
    ...extra,
  },
});
const out = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput;
  } catch {
    return null;
  }
};
const updated = (r) => out(r)?.updatedInput ?? null;
// changed on purpose (purpose check): a brief with a plan row now ends with the PURPOSE CHECK result line; these
// projects have no DECISIONS.md, so it says the check did not run
const NOREC = (d) =>
  `\nPURPOSE CHECK: not run: no DECISIONS.md in ${d.replace(/\\/g, "/")}.`;

// ---- a worker brief gets its row's cell
let u = updated(hook(agent("STEP: I3 of docs/plan.md. Build the hook.")));
check(
  "worker: the row's Serves cell is appended as one line, the prompt kept",
  u?.prompt ===
    'STEP: I3 of docs/plan.md. Build the hook.\n\nSERVES (from docs/plan.md I3): "hook I3 yes" (DECISIONS 2026-11-12)' +
      NOREC(dir),
  u?.prompt,
);
check(
  "every other field of the tool input is copied",
  u &&
    u.description === "Test: x" &&
    u.subagent_type === "worker" &&
    u.run_in_background === false,
);
check(
  "not twice: a brief that holds the line already gets no output",
  hook(agent(u.prompt)).stdout === "",
);
u = updated(hook(agent("Do row I1 in `docs/plan.md`")));
check(
  "a cell after a `code | span` cell is still found; curly quotes count",
  u?.prompt.endsWith(
    "SERVES (from docs/plan.md I1): “prove it on the real case” (DECISIONS 2026-11-12)" +
      NOREC(dir),
  ),
  u?.prompt,
);
u = updated(
  hook(
    agent(
      `Build row I3 of ${path.join(dir, "docs", "plan.md")}; I2 must be done first.`,
    ),
  ),
);
check(
  "an absolute Windows path works; 'row I3' picks I3 over a passing I2",
  u &&
    /SERVES \(from .*plan\.md I3\): "hook I3 yes"/.test(u.prompt) &&
    !/ I2\)/.test(u.prompt),
  u?.prompt,
);
u = updated(hook(agent("Steps I1 and I3 of docs/plan.md")));
check(
  "two ids, none after step/row: both lines",
  u &&
    u.prompt.includes("docs/plan.md I1)") &&
    u.prompt.includes("docs/plan.md I3)"),
  u?.prompt,
);
u = updated(hook(agent("STEP: I6 of docs/plan.md")));
check(
  "'none (mechanics)' counts as a purpose",
  u?.prompt.endsWith(
    "SERVES (from docs/plan.md I6): none (mechanics)" + NOREC(dir),
  ) &&
    !/no quoted purpose/.test(
      out(hook(agent("STEP: I6 of docs/plan.md"))).additionalContext ?? "",
    ),
);
let o = out(hook(agent("STEP: I6 of docs/plan.md")));
check(
  "no DECISIONS.md: the lead gets a 'not run' note of its own, not a 'no quoted purpose' one",
  o?.additionalContext ===
    `serves-brief purpose check: not run: no DECISIONS.md in ${dir.replace(/\\/g, "/")}.`,
  o?.additionalContext,
);
u = updated(hook(agent("STEP: I3 of docs/plan.md", "planner")));
check(
  "planner gets the row too",
  u?.prompt.includes("SERVES (from docs/plan.md I3)"),
);
u = updated(
  hook(agent("STEP: I3 of docs/plan.md"), { env: { CLAUDE_PROJECT_DIR: "" } }),
);
check(
  "a relative path resolves from the hook's cwd without a project folder",
  u?.prompt.includes("SERVES (from docs/plan.md I3)"),
);

// ---- no quoted purpose: a visible line, and a note to the lead
o = out(hook(agent("STEP: I2 of docs/plan.md")));
check(
  "pointer only: a visible 'no quoted purpose' line naming the cell",
  /SERVES \(from docs\/plan\.md I2\): no quoted purpose: the row's Serves cell \("decided, see DECISIONS"\) quotes no words of the user\./.test(
    o?.updatedInput.prompt ?? "",
  ),
  o?.updatedInput?.prompt,
);
check(
  "pointer only: the lead gets a note",
  /^serves-brief: no quoted purpose; .*docs\/plan\.md I2/.test(
    o?.additionalContext ?? "",
  ),
  o?.additionalContext,
);
o = out(hook(agent("STEP: I4 of docs/plan.md")));
check(
  "empty cell: the visible line says so",
  /I4\): no quoted purpose: the row's Serves cell is empty\./.test(
    o?.updatedInput.prompt ?? "",
  ),
);
o = out(hook(agent("STEP: A1 of docs/old-plan.md")));
check(
  "no Serves column: the visible line says so",
  /SERVES \(from docs\/old-plan\.md A1\): no quoted purpose: the plan's job list has no Serves column\./.test(
    o?.updatedInput.prompt ?? "",
  ) && !!o.additionalContext,
);

// ---- reviewers get every row
for (const t of ["reviewer", "plan-reviewer"]) {
  u = updated(
    hook(agent("Review the plan docs/plan.md before the user sees it.", t)),
  );
  const want =
    [
      "SERVES (from docs/plan.md, every row): what the user said each row is for.",
      "I1: “prove it on the real case” (DECISIONS 2026-11-12)",
      'I2: no quoted purpose (the row\'s Serves cell ("decided, see DECISIONS") quotes no words of the user)',
      'I3: "hook I3 yes" (DECISIONS 2026-11-12)',
      "I4: no quoted purpose (the row's Serves cell is empty)",
      "I6: none (mechanics)",
    ].join("\n") + NOREC(dir);
  check(
    `${t}: every row's cell, one per line, struck-out rows left out`,
    u?.prompt.endsWith(`\n\n${want}`),
    u?.prompt,
  );
}
u = updated(hook(agent("Review docs/old-plan.md", "reviewer")));
check(
  "reviewer, plan with no Serves column: one visible line",
  u?.prompt.endsWith(
    "SERVES (from docs/old-plan.md): no quoted purpose: the plan's job list has no Serves column. Flag it as a finding." +
      NOREC(dir),
  ),
  u?.prompt,
);

// ---- RVI fixes: "Row" tables, rows of a table with no Serves column, paths with spaces or a line number
const LANE = [
  "# Lane",
  "",
  "| Row | Job | Serves | State |",
  "|---|---|---|---|",
  '| LB3 | Sort photos | "weekly garden photos, sorted" (DECISIONS 2026-01-07) | open |',
  "",
].join("\n");
const MIXED = [
  "# Mixed",
  "",
  "| Step | Job | Serves | Done when |",
  "|---|---|---|---|",
  '| C1 | Card | "one card" (DECISIONS 2026-11-12) | ok |',
  "",
  "| Step | Job | Done when |",
  "|---|---|---|",
  "| C2 | Squash | passes |",
  "",
].join("\n");
const sp = project("with space", {
  "docs/lane-b.md": LANE,
  "docs/mixed.md": MIXED,
});
u = updated(hook(agent("Build row LB3 of docs/lane-b.md"), { cwd: sp }));
check(
  "a table whose first column is 'Row' counts",
  u?.prompt.endsWith(
    'SERVES (from docs/lane-b.md LB3): "weekly garden photos, sorted" (DECISIONS 2026-01-07)' +
      NOREC(sp),
  ),
  u?.prompt,
);
u = updated(hook(agent("Review docs/mixed.md", "reviewer"), { cwd: sp }));
check(
  "reviewer: a row of a table with no Serves column still gets its line",
  u?.prompt.endsWith(
    'C1: "one card" (DECISIONS 2026-11-12)\nC2: no quoted purpose (the plan\'s job list has no Serves column)' +
      NOREC(sp),
  ),
  u?.prompt,
);
const spacedPlan = path.join(sp, "docs", "lane-b.md").replace(/\\/g, "/");
u = updated(
  hook(
    agent(
      `Repo: ${sp.replace(/\\/g, "/")}/repo here; build row LB3 of ${spacedPlan} now.`,
    ),
    { cwd: tmp, env: { CLAUDE_PROJECT_DIR: "" } },
  ),
);
check(
  "an absolute plan path with a space, after another absolute path, is found",
  u?.prompt.includes(`SERVES (from ${spacedPlan} LB3): "weekly garden photos`),
  u?.prompt,
);
// a Mac or Linux path (no drive letter) with a space, after another such path; on Windows the drive is dropped,
// so the path resolves against the current drive (moved to the temp folder's drive for the check)
{
  const cwdWas = process.cwd();
  process.chdir(path.parse(tmp).root);
  const { planFiles } = await import(
    new URL("../hooks/lib/serves.mjs", import.meta.url).href
  );
  const noDrive = (p) => p.replace(/^[A-Za-z]:/, "");
  const posixPlan = noDrive(spacedPlan);
  const found = planFiles(
    `Repo: ${noDrive(sp.replace(/\\/g, "/"))}/repo here; build row LB3 of ${posixPlan} now.`,
    [tmp],
  );
  check(
    "a drive-less absolute plan path with a space, after another, is found",
    found.length === 1 && found[0].shown === posixPlan,
    JSON.stringify(found),
  );
  process.chdir(cwdWas);
}
u = updated(hook(agent("Row LB3, see docs/lane-b.md:5"), { cwd: sp }));
check(
  "a plan path with a line number is found",
  u?.prompt.includes("SERVES (from docs/lane-b.md LB3)"),
  u?.prompt,
);

// ---- the purpose check: a made-up record at the top of DECISIONS.md and rows that name its things
const RECORD = [
  "# Decisions",
  "",
  "## What each thing is for",
  "",
  '- **image resizer** (also: resizer, resize tool): "Smaller photos for the shop pages, made when I upload." · *2026-01-05* · from "smaller photos … when I upload"',
  '- **planner**: "Plans as careful as a senior engineer." · *2026-01-04* · from "careful as a senior engineer"',
  '- **report builder**: "Monthly sales reports." · *2026-01-06* · from "monthly sales reports by mail"',
  '- **old exporter**: "Exports for the old shop." · *2026-01-01* · from "exports for the old shop"',
  "- this line does not parse",
  "this prose line is no entry either",
  "",
  "## 2026-01-05",
  "",
  '- **The image resizer makes shop photos small.** The user: "I want smaller photos, you know, made right when I upload them" · *user, 2026-01-05*',
  '- **Plans stay careful.** The user: "plans as careful as a senior engineer would make" · *user, 2026-01-04*',
  "",
].join("\n");
const ARCHIVE =
  '# Archive\n\n- **Old exporter.** The user: "exports for the old shop, kept as is" · *user, 2026-01-01*\n';
const OK_QUOTE =
  '"Smaller photos for the shop pages, made when I upload." (DECISIONS 2026-01-05)';
const PPLAN = [
  "# Purpose plan",
  "",
  "| Step | Job | Serves | Files | Done when | Helper |",
  "|---|---|---|---|---|---|",
  '| P1 | Speed up the image resizer | "make it fast" (DECISIONS 2026-01-05) | `src/resize.js` | faster | worker |',
  `| P2 | Check the resizer, read-only | ${OK_QUOTE} | \`src/resize.js\` | report | worker |`,
  '| P3 | Image resizer audit, read-only | "make it fast" (DECISIONS 2026-01-05) | `src/resize.js` | report | worker |',
  `| P4 | Resizer run. NARROWED: report only, because the shop is closed | ${OK_QUOTE} | \`src/resize.js\` | report | worker |`,
  '| P5 | Resizer run. NARROWED: report only, because the shop is closed | "make it fast" (DECISIONS 2026-01-05) | `src/resize.js` | report | worker |',
  '| P6 | Tidy the docs, read-only | "keep it tidy" (DECISIONS 2026-01-05) | `docs/` | tidy | planner |',
  '| P7 | Resize tool fix | "I want smaller photos, made right when I upload them" (DECISIONS 2026-01-05) | `src/resize.js` | fixed | worker |',
  '| P8 | Fix `tests/test-planner.mjs` and the plan-reviewer text | "keep tests green" (DECISIONS 2026-01-05) | `tests/` | green | worker |',
  '| P9 | Edit the agent text | "keep tests green" (DECISIONS 2026-01-05) | `agents/planner.md` | green | worker |',
  '| P10 | Notes | "keep notes" (DECISIONS 2026-01-05) | `docs/2026-01-02-image-resizer-notes.md` | written | worker |',
  '| P11 | Sort the planner\'s table | "keep tests green" (DECISIONS 2026-01-05) | `docs/` | sorted | worker |',
  '| P12 | Fix the planner hook | "Plans as careful as a senior engineer." (DECISIONS 2026-01-04) | hooks/planner-readonly.mjs | `node x.mjs --dry-run` passes | worker |',
  '| P13 | Report builder fix | "Monthly sales reports" (DECISIONS 2026-01-06) | `src/report.js` | fixed | worker |',
  "| P14 | Resizer fix | “Smaller … the shop pages, made when I upload.” (DECISIONS 2026-01-05) | `src/resize.js` | fixed | worker |",
  '| P15 | Resizer fix | "Smaller … upload" (DECISIONS 2026-01-05) | `src/resize.js` | fixed | worker |',
  '| P16 | Resizer fix | "made when I upload … smaller photos" (DECISIONS 2026-01-05) | `src/resize.js` | fixed | worker |',
  "",
  "| Row | State | Notes |",
  "|---|---|---|",
  "| R1 | next | see the image resizer notes |",
  "",
].join("\n");
const pdir = project("purpose", {
  "DECISIONS.md": RECORD,
  "docs/decisions-archive.md": ARCHIVE,
  "docs/purpose-plan.md": PPLAN,
});
const deny = (r) => {
  const o = out(r);
  return o?.permissionDecision === "deny" ? o.permissionDecisionReason : null;
};
const start = (
  id,
  type = "worker",
  prompt = `STEP: ${id} of docs/purpose-plan.md`,
) => hook({ ...agent(prompt, type), cwd: pdir }, { cwd: pdir });
const want = {
  P1: "a", // names the resizer, Serves lacks its words
  P2: "b", // has the words, says read-only with no mark
  P3: "ab",
  P4: "", // NARROWED mark and the words
  P5: "a", // the mark answers rule b only
  P6: "", // names nothing (the Helper cell is not read), so read-only is not checked
  P7: "", // the raw phrase of the entry counts as the user's words too
  P8: "", // test-planner.mjs and plan-reviewer do not name the planner
  P9: "a", // agents/planner.md names the planner
  P10: "a", // a dated file name names the resizer
  P11: "a", // "the planner's table"
  P12: "", // "readonly" in a file path and "dry-run" in a code span set no limit
  P13: "", // the entry's words without their final full stop (its raw phrase is not in it)
  P14: "", // a quote cut with "…": its parts in order, 8 of the entry's 10 words (the raw phrase is not in it)
  P15: "a", // cut too short: 2 words of the raw phrase's 5
  P16: "a", // cut parts out of order
  R1: "a", // a table with no Job column: Notes is read; no Serves column
};
for (const [id, rules] of Object.entries(want)) {
  const r = start(id);
  const d = deny(r);
  const ok = rules
    ? !!d &&
      d.startsWith("serves-brief refused this helper start: ") &&
      d.includes(`row ${id} of docs/purpose-plan.md names `) &&
      rules.includes("a") === d.includes("Serves cell lacks these words") &&
      rules.includes("b") === /says "read-only" without a NARROWED/.test(d) &&
      d.endsWith("Do not start a safer stand-in.")
    : !d &&
      /\nPURPOSE CHECK: 1 row\(s\) checked .*none fails/.test(
        updated(r)?.prompt ?? "",
      );
  check(
    `worker start on ${id}: ${rules ? `refused by rule ${rules.split("").join(" and ")}` : "goes through"}`,
    ok,
    d ?? updated(r)?.prompt.split("\n\n").at(-1),
  );
}
const d = deny(start("P1"));
check(
  "the refusal quotes the entry's words and date, and names the raw words",
  d?.includes(
    'names image resizer. DECISIONS.md says what it is for: "Smaller photos for the shop pages, made when I upload." (2026-01-05; the raw words "smaller photos … when I upload" count too)',
  ),
  d,
);
check(
  "a brief that already holds a SERVES line is still refused",
  !!deny(
    start(
      "P1",
      "worker-code",
      "STEP: P1 of docs/purpose-plan.md\n\nSERVES (from docs/purpose-plan.md P1): x",
    ),
  ),
);
u = updated(start("P4"));
check(
  "a passing row naming a thing: a FOR line with the words, and the result line",
  u?.prompt.includes(
    '\nFOR image resizer (named by P4): "Smaller photos for the shop pages, made when I upload." (2026-01-05; the raw words "smaller photos … when I upload" count too)\nPURPOSE CHECK: 1 row(s) checked against 4 entries of DECISIONS.md; none fails.',
  ),
  u?.prompt,
);
o = out(start("P1", "planner"));
check(
  "planner on a failing row: not refused; FOR line, a PURPOSE CHECK line and the failing row",
  !o?.permissionDecision &&
    /\nFOR image resizer \(named by P1\): /.test(
      o?.updatedInput?.prompt ?? "",
    ) &&
    /\nPURPOSE CHECK: 1 row\(s\) checked against 4 entries of DECISIONS\.md; 1 fail \(below\)\./.test(
      o.updatedInput.prompt,
    ) &&
    /\n- P1: image resizer: the row's Serves cell lacks these words; the row needs "Smaller photos/.test(
      o.updatedInput.prompt,
    ) &&
    /^serves-brief purpose check: docs\/purpose-plan\.md P1 fails \(image resizer: the row's Serves cell lacks these words\); fix the row before a worker starts on it\./m.test(
      o.additionalContext ?? "",
    ) &&
    !/no quoted purpose/.test(o.additionalContext ?? ""),
  `${o?.updatedInput?.prompt}\n     ${o?.additionalContext}`,
);
for (const t of ["reviewer", "plan-reviewer"]) {
  o = out(start("", t, "Review docs/purpose-plan.md"));
  const p = o?.updatedInput?.prompt ?? "";
  check(
    `${t}: never refused; every row checked, one line per failing row`,
    !o?.permissionDecision &&
      /\nPURPOSE CHECK: 17 row\(s\) checked against 4 entries of DECISIONS\.md; 10 fail \(below\)\./.test(
        p,
      ) &&
      ["P1", "P3", "P9", "R1"].every((id) => p.includes(`\n- ${id}: `)) &&
      !p.includes("\n- P4: ") &&
      p.includes("\nFOR planner (named by P9, P11, P12): "),
    p.split("\n\n").at(-1),
  );
}
check(
  "unbacked and stale entries and a line that does not parse are named in the result line and the note",
  /Record: unbacked: report builder; stale: old exporter; lines that do not parse: "- this line does not parse", "this prose line is no entry either"\./.test(
    o?.updatedInput?.prompt ?? "",
  ) &&
    /DECISIONS\.md record: unbacked: report builder; stale: old exporter/.test(
      o.additionalContext ?? "",
    ),
  o?.updatedInput?.prompt.split("\n\n").at(-1),
);
const nosec = project("no-section", {
  "DECISIONS.md":
    "# Decisions\n\n## 2026-01-05\n\n- **A choice.** · *user, 2026-01-05*\n",
  "docs/purpose-plan.md": PPLAN,
});
o = out(
  hook(
    { ...agent("STEP: P1 of docs/purpose-plan.md"), cwd: nosec },
    { cwd: nosec },
  ),
);
check(
  "no record section: not refused, a result line says the check did not run, and the lead gets a note",
  o?.updatedInput?.prompt.endsWith(
    '\nPURPOSE CHECK: not run: DECISIONS.md has no "What each thing is for" section.',
  ) &&
    o.additionalContext ===
      'serves-brief purpose check: not run: DECISIONS.md has no "What each thing is for" section.',
  `${o?.updatedInput?.prompt}\n     ${o?.additionalContext}`,
);

// a plan and its design both named: the design's table has the same row id and no Serves column
const PAIR_PLAN = [
  "| Step | Job | Serves | Files | Done when |",
  "|---|---|---|---|---|",
  `| K2 | Speed up the resizer | ${OK_QUOTE} | \`src/resize.js\` | faster |`,
  "",
].join("\n");
const PAIR_DESIGN = [
  "| Row | What the image resizer does | Done when |",
  "|---|---|---|",
  "| K2 | Image resizer, cached sizes | faster |",
  "",
].join("\n");
const pair = project("pair", {
  "DECISIONS.md": RECORD,
  "docs/decisions-archive.md": ARCHIVE,
  "docs/pair-design.md": PAIR_DESIGN,
  "docs/pair-plan.md": PAIR_PLAN,
});
o = out(
  hook(
    {
      ...agent("Design: docs/pair-design.md. Plan: docs/pair-plan.md, row K2."),
      cwd: pair,
    },
    { cwd: pair },
  ),
);
check(
  "plan and design both named: the row of the file with a Serves column wins, the design's row is dropped",
  !o?.permissionDecision &&
    o?.updatedInput?.prompt.includes(
      `\n\nSERVES (from docs/pair-plan.md K2): ${OK_QUOTE}\n`,
    ) &&
    !o.updatedInput.prompt.includes("pair-design.md K2") &&
    /\nPURPOSE CHECK: 1 row\(s\) checked .*none fails/.test(
      o.updatedInput.prompt,
    ),
  o?.permissionDecisionReason ?? o?.updatedInput?.prompt,
);
o = out(
  hook(
    {
      ...agent("Review docs/pair-plan.md and docs/pair-design.md", "reviewer"),
      cwd: pair,
    },
    { cwd: pair },
  ),
);
check(
  "reviewer, plan and design both named: no 'no Serves column' line for the design",
  o?.updatedInput?.prompt.includes(
    "SERVES (from docs/pair-plan.md, every row)",
  ) &&
    !o.updatedInput.prompt.includes("SERVES (from docs/pair-design.md") &&
    /\nPURPOSE CHECK: 1 row\(s\) checked .*none fails/.test(
      o.updatedInput.prompt,
    ),
  o?.updatedInput?.prompt,
);

// an error inside the check (here a cwd that is no path): the helper still starts, but the brief and the lead are told
const br = hook({ ...agent("STEP: I3 of docs/plan.md"), cwd: 42 });
o = out(br);
check(
  "an error in the check: not refused, a 'PURPOSE CHECK: not run: <error>' line and a lead note",
  br.status === 0 &&
    !o?.permissionDecision &&
    o?.updatedInput?.prompt.startsWith(
      "STEP: I3 of docs/plan.md\n\nPURPOSE CHECK: not run: TypeError: ",
    ) &&
    /^serves-brief purpose check: not run: TypeError: /.test(
      o.additionalContext ?? "",
    ) &&
    /serves-brief hook skipped/.test(br.stderr),
  `${br.stdout}\n     ${br.stderr}`,
);
{
  const { nameRe } = await import(
    new URL("../hooks/lib/serves.mjs", import.meta.url).href
  );
  const cases = [
    ["planner", "tests/test-planner.mjs", false],
    ["planner", "agents/planner.md", true],
    ["planner", "the planner's table", true],
    ["planner", "the plan-reviewer", false],
    ["planner", "two planners", true],
    ["resize tool", "the Resize-Tool run", true],
    ["resizer", "resizer-notes", true],
    ["resizer", "superresizer", false],
    ["resizer", "resizer2", false],
  ];
  const bad = cases.filter(([n, t, yes]) => nameRe(n).test(t) !== yes);
  check(
    "name matching: no letter, digit, - or _ before; s or 's after; space, - and _ alike",
    !bad.length,
    JSON.stringify(bad),
  );
}

// ---- nothing to add
check(
  "no plan file named: no output",
  hook(agent("Fix the bug in I3 of the hook.")).stdout === "",
);
check(
  "a plan file that does not exist: no output",
  hook(agent("STEP: I3 of docs/missing.md")).stdout === "",
);
check(
  "a .md file with no Step table: no output",
  hook(agent("STEP: I3, see docs/notes.md")).stdout === "",
);
check(
  "a plan named but no step of it (worker): no output",
  hook(agent("Read docs/plan.md and fix typos.")).stdout === "",
);
for (const t of ["Explore", "general-purpose"])
  check(
    `other agent type (${t}): no output`,
    hook(agent("STEP: I3 of docs/plan.md", t)).stdout === "",
  );
check(
  "other tool: no output",
  hook({ tool_name: "Bash", tool_input: { command: "cat docs/plan.md" } })
    .stdout === "",
);

// ---- off switch and failing open
check(
  "SERVES_BRIEF=off: no output",
  hook(agent("STEP: I3 of docs/plan.md"), { env: { SERVES_BRIEF: "off" } })
    .stdout === "",
);
const offDir = project("off", {
  "docs/plan.md": PLAN,
  ".claude/settings.json": JSON.stringify({ env: { SERVES_BRIEF: "off" } }),
});
check(
  "SERVES_BRIEF off in the project's settings env: no output",
  hook({ ...agent("STEP: I3 of docs/plan.md"), cwd: offDir }, { cwd: offDir })
    .stdout === "",
);
const junk = hook("not json at all");
check(
  "fails open on bad hook input: no output, exit 0",
  junk.stdout === "" && junk.status === 0,
);
const odd = hook({
  tool_name: "Agent",
  tool_input: { prompt: 42, subagent_type: "worker" },
});
check(
  "fails open on a prompt that is not text",
  odd.stdout === "" && odd.status === 0,
);
const dirPlan = project("dirplan", { "docs/plan.md/inner.txt": "x" });
const dp = hook(
  { ...agent("STEP: I3 of docs/plan.md"), cwd: dirPlan },
  { cwd: dirPlan },
);
check(
  "a folder named like a plan: no output, exit 0",
  dp.stdout === "" && dp.status === 0 && dp.stderr === "",
);

// ---- the map part beside the Serves part
const MAP_JS = fileURLToPath(
  new URL("../skills/systems-map/map.mjs", import.meta.url),
).replace(/\\/g, "/");
const NONE = `\n\nSYSTEMS MAP: nothing in this brief matched (node "${MAP_JS}" --near <word> looks one up).`;
const mapped = project("mapped", {
  "docs/plan.md": PLAN,
  "src/ship.js": "x",
  ".claude/systems-map.json": JSON.stringify({
    nodes: [
      {
        id: "ship",
        name: "Parcel dispatch",
        what: "Sends parcels.",
        files: ["src/ship.js"],
        words: ["\\bshipping\\b"],
      },
    ],
    links: [],
  }),
});
const mappedRun = (prompt) =>
  updated(hook({ ...agent(prompt), cwd: mapped }, { cwd: mapped }));
const serveI3 =
  '\n\nSERVES (from docs/plan.md I3): "hook I3 yes" (DECISIONS 2026-11-12)' +
  NOREC(mapped);
u = mappedRun("STEP: I3 of docs/plan.md. Fix the shipping rules.");
check(
  "map: a brief whose only match is a code part matched by words gets the short 'nothing matched' line, then the Serves lines",
  u?.prompt ===
    "STEP: I3 of docs/plan.md. Fix the shipping rules." + NONE + serveI3,
  u?.prompt,
);
const matched = mappedRun("STEP: I3 of docs/plan.md. Fix src/ship.js.");
check(
  "map: the SYSTEMS MAP: marker opens the map part, matched or not (outcomes.mjs counts it)",
  NONE.startsWith("\n\nSYSTEMS MAP: ") &&
    matched?.prompt.includes("\n\nSYSTEMS MAP: ") &&
    matched.prompt.includes("## Parcel dispatch [ship]") &&
    matched.prompt.endsWith(serveI3),
  matched?.prompt,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
