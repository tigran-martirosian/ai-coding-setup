// Checks the Agents Panel build: manifest points at real files, the script loads and exports
// activate/deactivate, the stylesheet is well formed and carries both fixes, and the Russian
// build swaps both labels. Run: node test.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFor, createChecks } from "../shared/check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { check, finish } = createChecks();
const build = (lang) => buildFor(here, lang);

build("russian");
const ru = fs.readFileSync(path.join(here, "dist", "index.js"), "utf8");
const ruMod = await import(
  pathToFileURL(path.join(here, "dist", "index.js")).href + `?ru=${Date.now()}`
);
check(
  "russian: done label",
  ruMod.STRINGS.done === "Готово: {n}" && !/done: ['"]\{n\} done['"]/.test(ru),
);
check(
  "russian: idle label",
  ruMod.STRINGS.idle === "Ничего не запущено" &&
    !/idle: ['"]Nothing running['"]/.test(ru),
);
check(
  "russian: Helper word and time in the meta line, tool count in the tooltip",
  ruMod.metaWords("Sub-agent · 2m 10s · 14 tools · stopped", "stopped") ===
    "Помощник · остановлено через 2м 10с" &&
    ruMod.metaTip("Sub-agent · 2m 10s · 14 tools · stopped", "stopped") ===
      "Помощник · остановлено через 2м 10с · инструментов: 14" &&
    ruMod.metaWords("Command", "completed") === "Команда · готово",
);
check(
  "russian: the new words",
  ruMod.STRINGS.kinds["Sub-agent"] === "Помощник" &&
    ruMod.nowWords("Agent") === "ждёт помощника (Agent)" &&
    ruMod.metaWords("Sub-agent · 1s", "completed") ===
      "Помощник · готово за 1с" &&
    ruMod.metaWords("Sub-agent · 12s · failed", "failed") ===
      "Помощник · сбой через 12с" &&
    ruMod.metaWords("Sub-agent · 5s", "running") === "Помощник · думает · 5с" &&
    ruMod.countWords({ running: 1, failed: 0, stopped: 2 }).text ===
      "Работает: 1 · Остановлено: 2" &&
    !/Субагент|субагент/.test(ru),
);
check(
  "russian: rest of the file untouched",
  ru.includes("function plainTitle") && ru.includes("export {"),
);

build("english");
const enMod = await import(
  pathToFileURL(path.join(here, "src", "index.js")).href
);
const keys = (o) => Object.keys(o).sort().join();
check(
  "russian: same keys as english",
  keys(ruMod.STRINGS) === keys(enMod.STRINGS) &&
    keys(ruMod.STRINGS.now) === keys(enMod.STRINGS.now) &&
    keys(ruMod.STRINGS.helperCard) === keys(enMod.STRINGS.helperCard) &&
    keys(ruMod.STRINGS.helperCard.doing) ===
      keys(enMod.STRINGS.helperCard.doing),
);
// Model names are product names and stay as they are in Russian; a string of placeholders only ("{role} {doing}")
// has no words to translate
const wordsOnly = (w) =>
  typeof w !== "string" || /\p{L}/u.test(w.replace(/\{\w+\}/g, ""));
check(
  "russian: every string differs",
  Object.entries(enMod.STRINGS)
    .filter(([k]) => k !== "models")
    .every(([k, v]) =>
      typeof v === "string"
        ? v !== ruMod.STRINGS[k]
        : Object.entries(v)
            .filter(([, w]) => wordsOnly(w))
            .every(([t, w]) => w !== ruMod.STRINGS[k][t]),
    ) &&
    Object.entries(enMod.STRINGS.helperCard.doing).every(
      ([t, w]) => w !== ruMod.STRINGS.helperCard.doing[t],
    ),
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(here, "manifest.json"), "utf8"),
);
check("manifest id", manifest.id === "com.local.agentspanel");
check("manifest main exists", fs.existsSync(path.join(here, manifest.main)));
check(
  "manifest styles exists",
  fs.existsSync(path.join(here, manifest.styles)),
);

const mod = await import(
  pathToFileURL(path.join(here, "dist", "index.js")).href + `?t=${Date.now()}`
);
check("exports activate", typeof mod.activate === "function");
check("exports deactivate", typeof mod.deactivate === "function");

// Pure functions, on the app's real strings
const { plainTitle, metaWords, nowWords, parseMeta, countWords } = mod;
check(
  "title: plain text only gets a capital",
  plainTitle("Web search: Acme login steps") ===
    "Web search: Acme login steps" &&
    plainTitle("lists the windows") === "Lists the windows",
);
check(
  "title: WHAT THIS DOES line of a two-line command",
  plainTitle(
    "Get-Process | Select -First 3\n# WHAT THIS DOES: lists the windows",
  ) === "Lists the windows",
);
check(
  "title: first line of a multi-line text",
  plainTitle("first line\nsecond line") === "First line",
);
check(
  "title: long text cut to its first line",
  plainTitle(`${"x".repeat(130)}\nmore`) === `X${"x".repeat(129)}`,
);
check(
  "meta: running helper, one line (kind, doing, time), tool count only in the tooltip",
  metaWords("Sub-agent · 1s · 1 tool · WebFetch", "running") ===
    "Helper · reading a page (WebFetch) · 1s" &&
    mod.metaTip("Sub-agent · 1s · 1 tool · WebFetch", "running") ===
      "Helper · reading a page (WebFetch) · 1s · 1 tool",
);
check(
  "meta: running with unknown tool",
  metaWords("Sub-agent · 5s · 2 tools · FooTool", "running") ===
    "Helper · FooTool · 5s",
);
check(
  "meta: a running helper before its first tool reads thinking, a planner planning",
  metaWords("Sub-agent · 5s", "running") === "Helper · thinking · 5s" &&
    metaWords("Sub-agent · 5s", "running", null, 0, {
      model: "opus",
      type: "planner",
    }) === "Helper · planning · 5s · Opus",
);
check(
  "meta: a command the app marks as backgrounded says so",
  metaWords(
    "Command",
    "running",
    { startedAt: 0, durationMs: 0, isBackgrounded: true },
    372000,
  ) === "Command · running in the background · 6m 12s",
);
// Every tool the app names, and the roles, to its orb (DESIGN.md "Thinking orbs")
{
  const { stageOf } = mod;
  const h = (tool, role = "", text = "") =>
    stageOf({ kind: "Sub-agent", tool, role, text });
  const cases = [
    [h(""), "breathing"],
    ...["Read", "Grep", "Glob", "LS", "WebFetch", "WebSearch"].map((t) => [
      h(t),
      "searching",
    ]),
    ...["Edit", "Write", "MultiEdit", "NotebookEdit"].map((t) => [
      h(t),
      "composing",
    ]),
    ...["Bash", "PowerShell", "Skill", "FooTool"].map((t) => [h(t), "working"]),
    ...["Agent", "Task"].map((t) => [h(t), "connecting"]),
    ...["EnterPlanMode", "ExitPlanMode", "TodoWrite"].map((t) => [
      h(t),
      "shaping",
    ]),
    [h("Read", "planner"), "shaping"],
    [h("", "", "Planner: the build"), "shaping"],
    [h("Bash", "reviewer"), "solving"],
    [h("Grep", "", "Reviewer: check A1"), "solving"],
    [h("Agent", "reviewer"), "connecting"],
    [stageOf({ kind: "Command", text: "git status --short" }), "working"],
    [stageOf({ kind: "Command", text: "node test.mjs" }), "solving"],
    [stageOf({ kind: "Command", text: "npm run lint" }), "solving"],
    [stageOf({ kind: "Command", text: "git checkout main" }), "working"],
  ];
  const bad = cases.filter(([got, want]) => got !== want);
  check(
    `stage: each tool and role to its orb${bad.length ? ` (${bad.length} wrong)` : ""}`,
    !bad.length,
  );
  check(
    "stage: the row view carries the orb and slows it after 2 minutes without a report",
    mod.rowView(
      "Sub-agent · 35s · 3 tools · Edit",
      "running",
      { startedAt: 0, durationMs: 35000 },
      60000,
    ).orb === "composing" &&
      !mod.rowView(
        "Sub-agent · 35s · 3 tools · Edit",
        "running",
        { startedAt: 0, durationMs: 35000 },
        155000,
      ).slow &&
      mod.rowView(
        "Sub-agent · 35s · 3 tools · Edit",
        "running",
        { startedAt: 0, durationMs: 35000 },
        156000,
      ).slow &&
      mod.rowView("Sub-agent · 4m 24s", "completed").orb === null,
  );
}
check(
  "meta: running, no elapsed",
  metaWords("Command", "running") === "Command",
);
check(
  "meta: completed helper",
  metaWords("Sub-agent · 4m 24s · 30 tools", "completed") ===
    "Helper · done in 4m 24s",
);
check(
  "meta: completed command",
  metaWords("Command", "completed") === "Command · done",
);
check(
  "meta: failed command",
  metaWords("Command · failed", "failed") === "Command · failed",
);
check(
  "meta: stopped helper",
  metaWords("Sub-agent · 2m 10s · 14 tools · stopped", "stopped") ===
    "Helper · stopped after 2m 10s",
);
check(
  "meta: hours",
  metaWords("Workflow · 1h 5m", "completed") === "Workflow · done in 1h 5m",
);
check(
  "meta: no row reads quiet, idle or stalled",
  !/quiet|idle|stalled/i.test(
    JSON.stringify(Object.entries(mod.STRINGS).filter(([k]) => k !== "idle")) +
      mod.STRINGS.idle,
  ),
);
check(
  "meta: unparseable stays null",
  metaWords("something odd · here", "running") === null &&
    metaWords("Sub-agent · a · b · c", "running") === null,
);
check(
  "meta: parse outcome",
  parseMeta("Sub-agent · 2m 10s · 14 tools · stopped")?.last === "",
);
check(
  "now: words and tool name",
  nowWords("Grep") === "searching files (Grep)" &&
    nowWords("Agent") === "waiting on a helper (Agent)" &&
    nowWords("Bash") === "running a command (Bash)",
);
// A frozen row: the app said 35s while the planner had run 2 minutes
const T0 = 1793864638072;
const planner = { startedAt: T0, durationMs: 35000 };
const seen = "Sub-agent · 35s · 10 tools · Grep";
check(
  "live time: counts from startedAt, not the app's durationMs",
  metaWords(seen, "running", planner, T0 + 120000) ===
    "Helper · searching files (Grep) · 2m 0s",
);
check(
  "live time: moves each second",
  metaWords(seen, "running", planner, T0 + 121000) ===
    "Helper · searching files (Grep) · 2m 1s",
);
check(
  "live time: no report for over 2 minutes keeps the last step and adds the wait",
  metaWords(seen, "running", planner, T0 + 35000 + 4 * 60000 + 5000) ===
    "Helper · searching files (Grep) for 4m · 4m 40s",
);
check(
  "live time: silent with no last step reads thinking, never quiet",
  metaWords("Sub-agent · 35s", "running", planner, T0 + 35000 + 3 * 60000) ===
    "Helper · thinking for 3m · 3m 35s",
);
check(
  "live time: exactly 2 minutes silent shows no wait yet",
  metaWords(seen, "running", planner, T0 + 35000 + 120000).startsWith(
    "Helper · searching files (Grep) · ",
  ),
);
check(
  "live time: hours",
  metaWords(
    seen,
    "running",
    { startedAt: T0, durationMs: 3600000 + 300000 },
    T0 + 3600000 + 330000,
  ) === "Helper · searching files (Grep) · 1h 5m",
);
check(
  "live time: no task keeps the app's time",
  metaWords(seen, "running") === "Helper · searching files (Grep) · 35s",
);
check(
  "live time: a finished row keeps the app's time",
  metaWords(
    "Sub-agent · 4m 24s · 30 tools",
    "completed",
    planner,
    T0 + 999999,
  ) === "Helper · done in 4m 24s",
);
check(
  "live time: a running command counts up and never reads quiet",
  metaWords(
    "Command",
    "running",
    { startedAt: T0, durationMs: 0 },
    T0 + 667000,
  ) === "Command · 11m 7s",
);
check(
  "clock: app format",
  mod.clock(45000) === "45s" &&
    mod.clock(130000) === "2m 10s" &&
    mod.clock(3900000) === "1h 5m" &&
    mod.clock(-5) === "0s",
);
{
  const task = { startedAt: 1, durationMs: 2 };
  const row = {
    __reactFiber$x: {
      memoizedProps: { className: "task-item" },
      return: { memoizedProps: { task } },
    },
  };
  check(
    "rowTask: task prop one level up",
    mod.rowTask(row) === task && mod.rowTask({}) === null,
  );
  const newer = { startedAt: 1, durationMs: 9 };
  row.__reactFiber$x.return.alternate = { memoizedProps: { task: newer } };
  check(
    "rowTask: the newer task of the two fibers",
    mod.rowTask(row) === newer,
  );
}
check(
  "russian: wait words",
  ruMod.metaWords(seen, "running", planner, T0 + 35000 + 4 * 60000) ===
    "Помощник · ищет по файлам (Grep) уже 4м · 4м 35с",
);
check(
  "count: running first, a failure stays named beside it, then failed, then done",
  countWords({ running: 2, failed: 1, completed: 5 }).text ===
    "2 running · 1 failed" &&
    countWords({ running: 8, failed: 1, stopped: 1, completed: 6 }).text ===
      "8 running · 1 failed · 1 stopped" &&
    countWords({ running: 0, failed: 1, stopped: 2, completed: 6 }).text ===
      "1 failed · 2 stopped" &&
    countWords({ running: 2, failed: 0, completed: 5 }).text === "2 running" &&
    countWords({ running: 0, failed: 1, completed: 5 }).text === "1 failed" &&
    countWords({ running: 0, failed: 0, completed: 12 }).text ===
      "Nothing running",
);

// Model and effort of a helper, from the run log
const { modelWords, effortWords, runWords, matchRun, parseRuns } = mod;
check(
  "model: short names",
  modelWords("sonnet") === "Sonnet" &&
    modelWords("opus") === "Opus" &&
    modelWords("haiku") === "Haiku" &&
    modelWords("fable") === "Fable",
);
check(
  "model: full ids by family",
  modelWords("claude-sonnet-4-5") === "Sonnet" &&
    modelWords("claude-opus-5-5") === "Opus" &&
    modelWords("Claude-Haiku-4") === "Haiku",
);
check(
  "model: null, unknown and inherited show nothing",
  modelWords(null) === "" &&
    modelWords(undefined) === "" &&
    modelWords("inherited") === "" &&
    modelWords("gpt-9") === "",
);
check(
  "effort: as given, xhigh in words, null nothing",
  effortWords("medium") === "medium" &&
    effortWords("xhigh") === "very high" &&
    effortWords("odd") === "odd" &&
    effortWords(null) === "",
);
check(
  "run words: joined, model only, nothing without a model",
  runWords({ model: "sonnet", effort: "medium" }) === "Sonnet medium" &&
    runWords({ model: "opus", effort: null }) === "Opus" &&
    runWords({ model: null, effort: "high" }) === "" &&
    runWords(null) === "",
);
const log = [
  { description: "Worker: panel", model: "sonnet" },
  { description: " Worker: panel ", model: "opus" },
  { description: "Other", model: "haiku" },
  { description: "Worker: panel", model: "fable" },
];
const got = matchRun(
  ["Worker: panel", "Worker: panel", "Command text", "Other"],
  log,
);
check(
  "match: same description claims two different lines, newest first",
  got[0] === log[3] && got[1] === log[1],
);
check(
  "match: no line gives null, others still match",
  got[2] === null && got[3] === log[2],
);
const four = matchRun(
  ["Worker: panel", "Worker: panel", "Worker: panel", "Worker: panel"],
  log,
);
check(
  "match: the oldest line goes to the third row, a fourth finds nothing left",
  four[2] === log[0] && four[3] === null,
);
check(
  "match: trimmed on both sides",
  matchRun(["  Other\n"], log)[0] === log[2],
);
check(
  "parse runs: skips bad lines",
  parseRuns(
    '{"description":"a","model":"opus"}\nnot json\n\n[1]\n{"model":"x"}\n{"description":"b"}',
  )
    .map((r) => r.description)
    .join() === "a,b",
);
check(
  "title: kind word and colon stripped",
  plainTitle("Worker: fix the panel") === "Fix the panel" &&
    plainTitle("reviewer :  check it") === "Check it" &&
    plainTitle("Sub-agent: a") === "A" &&
    plainTitle("HELPER: b") === "B",
);
check(
  "title: other kinds and mid-text words stay",
  plainTitle("Read files: farmfind fetcher") ===
    "Read files: farmfind fetcher" &&
    plainTitle("Ask the worker: now") === "Ask the worker: now",
);
check(
  'title: cut at the first " · ", " | " or ";"',
  plainTitle("Fix A · and B") === "Fix A" &&
    plainTitle("Fix A | and B") === "Fix A" &&
    plainTitle("Fix A; and B") === "Fix A" &&
    plainTitle("Worker: fix A; then B") === "Fix A" &&
    plainTitle("a|b") === "A|b",
);
check(
  "meta: the model ends a running row's line; model and effort are in the tooltip in every state",
  metaWords("Sub-agent · 4m 24s · 30 tools · Grep", "running", null, 0, {
    model: "sonnet",
    effort: "medium",
  }) === "Helper · searching files (Grep) · 4m 24s · Sonnet medium" &&
    mod.metaTip("Sub-agent · 4m 24s · 30 tools · Grep", "running", null, 0, {
      model: "sonnet",
      effort: "medium",
    }) ===
      "Helper · searching files (Grep) · 4m 24s · Sonnet medium · 30 tools" &&
    metaWords("Sub-agent · 4m 24s · 30 tools", "completed", null, 0, {
      model: "opus",
      effort: "xhigh",
    }) === "Helper · done in 4m 24s" &&
    mod.metaTip("Sub-agent · 4m 24s · 30 tools", "completed", null, 0, {
      model: "opus",
      effort: "xhigh",
    }) === "Helper · done in 4m 24s · Opus very high · 30 tools" &&
    mod.metaTip("Sub-agent · 2m 10s", "stopped", null, 0, {
      model: "haiku",
      effort: null,
    }) === "Helper · stopped after 2m 10s · Haiku" &&
    mod.metaTip("Sub-agent · 1s", "failed", null, 0, {
      model: "fable",
      effort: "high",
    }) === "Helper · failed after 1s · Fable high",
);
check(
  "meta: a running helper's row names the model with its effort ('Opus high', no comma); no effort, the model alone",
  metaWords("Sub-agent · 1m 0s · Read", "running", null, 0, {
    model: "claude-opus-5-5",
    effort: "high",
  }) === "Helper · reading a file (Read) · 1m 0s · Opus high" &&
    metaWords("Sub-agent · 1m 0s · Read", "running", null, 0, {
      model: "opus",
      effort: null,
    }) === "Helper · reading a file (Read) · 1m 0s · Opus",
);
check(
  "meta: no run or an unknown model changes nothing",
  metaWords("Sub-agent · 4m 24s · Grep", "running", null, 0, null) ===
    "Helper · searching files (Grep) · 4m 24s" &&
    metaWords("Sub-agent · 4m 24s · Grep", "running", null, 0, {
      model: "inherited",
      effort: "high",
    }) === "Helper · searching files (Grep) · 4m 24s",
);
check(
  "russian: model and effort",
  ruMod.metaTip("Sub-agent · 4m 24s", "completed", null, 0, {
    model: "sonnet",
    effort: "xhigh",
  }) === "Помощник · готово за 4м 24с · Sonnet очень высокий",
);
check(
  "manifest: filesystem permission",
  manifest.permissions?.filesystem === true && manifest.version === "0.4.0",
);
check(
  "build: runs.js inlined, no import left",
  !/from ['"]\.\/runs\.js['"]/.test(ru) &&
    ru.includes("function matchRun") &&
    fs
      .readFileSync(path.join(here, "dist", "index.js"), "utf8")
      .includes("function readRuns"),
);
check(
  "build: scroll-hold.js inlined, no import left",
  !/from ['"]\.\/scroll-hold\.js['"]/.test(ru) &&
    ru.includes("function startScrollHold"),
);

// Scroll hold. The chat's end is at 5000; the app follows it by scrolling there after each update.
{
  const { createHold } = mod;
  const MAX = 5000;
  let h = createHold();
  check(
    "hold: not reading, the app follows the bottom",
    h.allows(4990, MAX, MAX),
  );
  // The bug: one small step up (20px, a touchpad or a smooth wheel) is still inside the app's 50px,
  // and the next update pulled the reader back down
  h.up();
  h.scrolled(1000, 20);
  check(
    "hold: a small step up holds against the follow scroll",
    h.reading && !h.allows(4980, MAX, MAX),
  );
  check(
    "hold: a scroll near the end (list library estimate) is held too",
    !h.allows(4800, MAX - 60, MAX),
  );
  check(
    "hold: a jump to a message further up or in the middle goes through",
    h.allows(4980, 1200, MAX) && h.allows(2000, 3000, MAX),
  );
  check("hold: scrolling up goes through", h.allows(4980, 4000, MAX));
  h.scrolled(2000, 10);
  check(
    "hold: reaching the end without the user going down keeps reading",
    h.reading,
  );
  h.down(3000, 400);
  h.scrolled(3200, 300);
  check("hold: on the way down, not yet at the end, still reading", h.reading);
  h.scrolled(3500, 30);
  check(
    "hold: the user back at the end, following again",
    !h.reading && h.allows(4970, MAX, MAX),
  );
  h = createHold();
  h.up();
  h.down(10000, 400);
  h.scrolled(11500, 0);
  check(
    "hold: a down gesture over a second old does not end reading",
    h.reading,
  );
  h.down(12000, 0);
  check("hold: a wheel down already at the end ends reading", !h.reading);
  h.up();
  h.stop();
  check(
    "hold: stop (the scroll-to-bottom arrow, another session) ends reading",
    !h.reading && h.allows(0, MAX, MAX),
  );

  // A tool's output box inside the chat with its own scrollbar
  const { holdInnerScrolls, holdEditable } = mod;
  const list = {
    scrollHeight: 9000,
    clientHeight: 800,
    scrollTop: 8200,
    parentElement: null,
  };
  const box = {
    scrollHeight: 600,
    clientHeight: 256,
    scrollTop: 100,
    parentElement: list,
  };
  const line = {
    scrollHeight: 20,
    clientHeight: 20,
    scrollTop: 0,
    parentElement: box,
  };
  const auto = () => "auto";
  check(
    "inner box: a wheel inside a box that can still scroll moves the box, not the chat",
    holdInnerScrolls(line, list, -1, auto) &&
      holdInnerScrolls(line, list, 1, auto),
  );
  box.scrollTop = 0;
  check(
    "inner box: at its top, a wheel up moves the chat",
    !holdInnerScrolls(line, list, -1, auto) &&
      holdInnerScrolls(line, list, 1, auto),
  );
  box.scrollTop = 344;
  check(
    "inner box: at its end, a wheel down moves the chat",
    !holdInnerScrolls(line, list, 1, auto) &&
      holdInnerScrolls(line, list, -1, auto),
  );
  box.scrollTop = 100;
  check(
    "inner box: overflow hidden or visible does not count",
    !holdInnerScrolls(line, list, -1, () => "hidden") &&
      !holdInnerScrolls(line, list, -1, () => "visible"),
  );
  check(
    "inner box: the list itself is not an inner box",
    !holdInnerScrolls(list, list, -1, auto),
  );
  check(
    "editable: text fields and contenteditable, not a plain block",
    holdEditable({ tagName: "TEXTAREA" }) &&
      holdEditable({ tagName: "INPUT" }) &&
      holdEditable({ tagName: "DIV", isContentEditable: true }) &&
      !holdEditable({ tagName: "DIV", isContentEditable: false }) &&
      !holdEditable(null),
  );
}

// The file list folded to one summary line: 340 files in 9 top folders, in the app's order (not by size)
{
  const { filesSummary, createFold, STRINGS } = mod;
  const folders = [
    ["agents", 5],
    ["audits", 120],
    ["docs", 64],
    ["extensions", 40],
    ["hooks", 22],
    ["scripts", 9],
    ["skills", 18],
    ["tests", 14],
    ["tools", 48],
  ].map(([name, count]) => ({ name, count }));
  const s = filesSummary(folders, 0, STRINGS);
  check(
    "files: 340 files in 9 folders, the three biggest named, the rest counted",
    s.total === 340 &&
      s.title === "340 files in 9 folders" &&
      s.detail === "audits 120 · docs 64 · tools 48 · 6 more folders",
  );
  check(
    "files: loose files count in the total; one folder, one more folder; equal folders keep the app's order",
    filesSummary(folders.slice(0, 4), 3, STRINGS).title ===
      "232 files in 4 folders" &&
      filesSummary(folders.slice(0, 4), 0, STRINGS).detail ===
        "audits 120 · docs 64 · extensions 40 · 1 more folder" &&
      filesSummary([{ name: "src", count: 1 }], 0, STRINGS).title ===
        "1 file in 1 folder" &&
      filesSummary(
        [
          { name: "b", count: 2 },
          { name: "a", count: 2 },
        ],
        0,
        STRINGS,
      ).detail === "b 2 · a 2",
  );
  check(
    "files: only loose files read as a count, no folder words",
    filesSummary([], 2, STRINGS).title === "2 files" &&
      filesSummary([], 2, STRINGS).detail === "",
  );
  check(
    "russian: the summary line",
    ruMod.filesSummary(folders, 0, ruMod.STRINGS).title ===
      "Файлов: 340, папок: 9" &&
      ruMod.filesSummary(folders, 0, ruMod.STRINGS).detail ===
        "audits 120 · docs 64 · tools 48 · ещё папок: 6",
  );
  // The fold state lives in storage: folded at first, and an opened list is still open on the next load
  const store = new Map();
  const storage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  const first = createFold(storage, "agentsPanel.filesOpen");
  const wasFolded = !first.isOpen();
  first.toggle();
  const reloaded = createFold(storage, "agentsPanel.filesOpen");
  const openAfterLoad = reloaded.isOpen();
  reloaded.toggle();
  check(
    "files: folded by default, the fold remembered across a reload",
    wasFolded &&
      openAfterLoad &&
      !createFold(storage, "agentsPanel.filesOpen").isOpen() &&
      store.get("agentsPanel.filesOpen") === "0",
  );
}

// The commit box is pressed folded once per mount: a box opened later (by the app or the keyboard) stays open
{
  const fold = await import(
    pathToFileURL(path.join(here, "src", "files-fold.js")).href +
      `?t=${Date.now()}`
  );
  let open = true;
  let clicks = 0;
  const kids = [];
  const left = {
    click: () => {
      clicks++;
      open = !open;
    },
    querySelector: (sel) =>
      sel === ":scope > .ap-commit"
        ? (kids.find((k) => k.className === "ap-commit") ?? null)
        : null,
    get lastElementChild() {
      return kids[kids.length - 1] ?? null;
    },
    append: (n) => kids.push(n),
  };
  const panel = {
    dataset: {},
    querySelector: (sel) =>
      sel === ".git-operations-panel__header-left"
        ? left
        : sel === ":scope > .git-operations-panel__content"
          ? open
            ? {}
            : null
          : null,
  };
  const content = {
    querySelector: (sel) => (sel === ".file-edits-sidebar__empty" ? {} : null),
  };
  const sidebar = {
    dataset: {},
    querySelector: (sel) =>
      sel === ":scope > .git-operations-panel"
        ? panel
        : sel === ":scope > .files-edited-sidebar__content"
          ? content
          : null,
  };
  const saved = {
    document: globalThis.document,
    localStorage: globalThis.localStorage,
  };
  globalThis.document = {
    querySelectorAll: () => [sidebar],
    createElement: () => ({ className: "", textContent: "" }),
  };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  try {
    fold.syncFiles(mod.STRINGS);
    const foldedFirst = clicks === 1 && !open;
    open = true; // opened by something other than a mouse click on the header
    fold.syncFiles(mod.STRINGS);
    fold.syncFiles(mod.STRINGS);
    check(
      "files: the commit box folded once per mount, a later open left open",
      foldedFirst && clicks === 1 && open,
    );
  } finally {
    globalThis.document = saved.document;
    globalThis.localStorage = saved.localStorage;
  }
}

// The app draws a tree of several folders inside a root folder node with no header; that root is not a folder with a
// missing name (which dropped the whole fold and left every folder open), its folders are the top ones and its own
// files the loose ones. A tree of one folder starts at that folder.
{
  const fold = await import(
    pathToFileURL(path.join(here, "src", "files-fold.js")).href +
      `?root=${Date.now()}`
  );
  class El {
    constructor(className, kids = [], text = "") {
      this.className = className;
      this.textContent = text;
      this.parentElement = null;
      this.children = kids;
      for (const k of kids) k.parentElement = this;
    }
    matches(sel) {
      return sel
        .split(".")
        .filter(Boolean)
        .every((c) => this.className.split(" ").includes(c));
    }
    closest(sel) {
      for (let n = this; n; n = n.parentElement) if (n.matches(sel)) return n;
      return null;
    }
    *walk() {
      for (const k of this.children) {
        yield k;
        yield* k.walk();
      }
    }
    querySelectorAll(sel) {
      return [...this.walk()].filter((n) => n.matches(sel));
    }
    querySelector(sel) {
      const scope = sel.startsWith(":scope > ");
      const want = scope ? sel.slice(9) : sel;
      return (
        (scope ? this.children : [...this.walk()]).find((n) =>
          n.matches(want),
        ) ?? null
      );
    }
  }
  const file = (name) => new El("file-edits-sidebar__file", [], name);
  const folder = (name, count, kids) =>
    new El("file-edits-sidebar__directory-node", [
      new El("file-edits-sidebar__directory-header", [
        new El("file-edits-sidebar__directory-path", [], name),
        new El("file-edits-sidebar__directory-count", [], String(count)),
      ]),
      new El("file-edits-sidebar__directory-children", kids),
    ]);
  const tree = new El("file-edits-sidebar__files", [
    new El("file-edits-sidebar__root-checkbox"),
    new El("file-edits-sidebar__directory-node", [
      new El("", [
        folder("docs", 3, [
          folder("plans", 2, [file("a.md"), file("b.md")]),
          file("c.md"),
        ]),
        folder("hooks", 1, [file("d.mjs")]),
        file("README.md"),
        file("package.json"),
      ]),
    ]),
  ]);
  const one = new El("file-edits-sidebar__files", [
    folder("src/lib", 2, [file("a.js"), file("b.js")]),
  ]);
  const read =
    typeof fold.readFolders === "function" ? fold.readFolders(tree) : null;
  const single =
    typeof fold.readFolders === "function" ? fold.readFolders(one) : null;
  check(
    "files: the app's header-less root folder is read through: its folders are the top ones, its files the loose ones",
    read?.folders.map((f) => `${f.name} ${f.count}`).join() ===
      "docs 3,hooks 1" &&
      read.loose === 2 &&
      single?.folders.map((f) => `${f.name} ${f.count}`).join() ===
        "src/lib 2" &&
      single.loose === 0,
  );
}

// The chat's thinking line: the app's four kinds of words in ours, and the orb for each
{
  const { thinkingView, stageOf, STRINGS } = mod;
  const view = (text, card = null, m = mod) =>
    m.thinkingView(text, card, m.STRINGS, m.stageOf);
  const is = (v, words, orb) => v && v.words === words && v.orb === orb;
  check(
    "thinking: the four word cases (no dots, no 'agents')",
    is(view("Thinking..."), "Thinking", "breathing") &&
      is(
        view("Waiting on background task: Scan the chat logs"),
        "Waiting on a background task: Scan the chat logs",
        "connecting",
      ) &&
      is(
        view("Waiting on 3 background tasks..."),
        "Waiting on 3 background tasks",
        "connecting",
      ) &&
      is(
        view("Waiting for 2 agents to complete..."),
        "Waiting for 2 helpers to finish",
        "connecting",
      ),
  );
  check(
    "thinking: one helper, and a background task the app could not describe",
    is(
      view("Waiting for 1 agent to complete..."),
      "Waiting for 1 helper to finish",
      "connecting",
    ) &&
      is(
        view("Waiting on background task: background task"),
        "Waiting on a background task",
        "connecting",
      ),
  );
  check(
    "thinking: while the newest tool card runs, its stage and words",
    is(
      view("Thinking...", { tool: "Grep", command: "" }),
      "Searching files",
      "searching",
    ) &&
      is(
        view("Thinking...", { tool: "Edit", command: "" }),
        "Editing a file",
        "composing",
      ) &&
      is(
        view("Thinking...", { tool: "Bash", command: "ls -la" }),
        "Running a command",
        "working",
      ) &&
      is(
        view("Thinking...", { tool: "Bash", command: "npm test" }),
        "Running a command",
        "solving",
      ) &&
      is(
        view("Thinking...", { tool: "Task", command: "" }),
        "Waiting on a helper",
        "connecting",
      ) &&
      is(
        view("Thinking...", { tool: "TodoWrite", command: "" }),
        "Thinking",
        "shaping",
      ),
  );
  check(
    "thinking: words the app did not have are not guessed (null, the app's stay)",
    view("Compacting...") === null &&
      view("Waiting for 2 teammates to complete...") === null &&
      view("") === null &&
      typeof thinkingView === "function" &&
      typeof stageOf === "function" &&
      STRINGS.waitLine.thinking === "Thinking",
  );
  const pool = STRINGS.waitLine.playful;
  check(
    "thinking: plain Thinking has a pool of playful words (Pondering, Tinkering...), no repeats, no Thinking",
    Array.isArray(pool) &&
      pool.length >= 10 &&
      pool.includes("Pondering") &&
      !pool.includes("Thinking") &&
      new Set(pool).size === pool.length,
  );
  check(
    "russian: the thinking line",
    is(view("Thinking...", null, ruMod), "Думает", "breathing") &&
      is(
        view("Waiting on background task: Scan the chat logs", null, ruMod),
        "Ждёт фоновую задачу: Scan the chat logs",
        "connecting",
      ) &&
      is(
        view("Waiting on 3 background tasks...", null, ruMod),
        "Ждёт фоновые задачи: 3",
        "connecting",
      ) &&
      is(
        view("Waiting for 2 agents to complete...", null, ruMod),
        "Ждёт помощников: 2",
        "connecting",
      ) &&
      is(
        view("Thinking...", { tool: "Read", command: "" }, ruMod),
        "Читает файл",
        "searching",
      ),
  );
}

// "Needs you": the open questions as the app finds them, the chat bar's words, the session row's words, the summary line
{
  const { openQuestions, needsWhat, sessionWords, countWords: count } = mod;
  const ask = (id, qs, result) => ({
    type: "tool_call",
    toolCall: {
      toolName: "AskUserQuestion",
      providerToolCallId: id,
      arguments: {
        questions: qs.map((question) => ({
          question,
          header: "H",
          options: [{ label: "a" }],
        })),
      },
      ...(result ? { result } : {}),
    },
  });
  const human = { type: "user_message", text: "go on" };
  const answer = {
    type: "user_message",
    text: "[Resuming after answering a question] Picked a",
    promptOrigin: "interactive-question",
  };
  const ids = (m) =>
    openQuestions(m)
      .map((c) => c.id)
      .join();
  check(
    "needs: open questions are the unanswered question cards since the last human turn, oldest first",
    ids([
      ask("old", ["Before"]),
      human,
      ask("q1", ["Who should own the copy row?"]),
      answer,
      ask("q2", ["Which theme first?", "And the size?"]),
    ]) === "q1,q2" &&
      ids([ask("q1", ["A?"], "picked a"), ask("q2", ["B?"])]) === "q2" &&
      ids([ask("q1", ["A?"]), human]) === "" &&
      ids([
        {
          type: "tool_call",
          toolCall: {
            toolName: "mcp__nimbalyst__AskUserQuestion",
            providerToolCallId: "m1",
            arguments: { questions: [{ question: "Q?" }] },
          },
        },
      ]) === "m1" &&
      ids([
        {
          type: "tool_call",
          toolCall: { toolName: "Bash", providerToolCallId: "b1" },
        },
      ]) === "",
  );
  const what = (cards) => needsWhat(cards, mod.STRINGS).what;
  check(
    "needs: the chat bar says what waits, the newest question first, a count from two",
    what([{ id: "a", questions: ["Who should own the copy row?"] }]) ===
      "1 question: Who should own the copy row?" &&
      what([
        { id: "a", questions: ["Older?"] },
        { id: "b", questions: ["Which theme first?"] },
      ]) === "2 questions: Which theme first? and 1 more" &&
      what([{ id: "a", questions: ["One?", "Two?", "Three?"] }]) ===
        "3 questions: One? and 2 more" &&
      what([{ id: "a", questions: [] }]) === "1 question" &&
      what([]) === null &&
      needsWhat([{ id: "a", questions: ["x", "y"] }], mod.STRINGS).count === 2,
  );
  const words = (state, n, m = mod) =>
    m
      .sessionWords(state, n, m.STRINGS)
      .map((p) => p.text)
      .join(" · ");
  check(
    "needs: the session row's words lead its meta line, the count only from two, running for a running row",
    words("needs", 0) === "Needs you" &&
      words("needs", 1) === "Needs you" &&
      words("needs", 2) === "Needs you · 2" &&
      words("running", 0) === "running" &&
      sessionWords("needs", 2, mod.STRINGS)[0].part === "needs",
  );
  check(
    "needs: the summary line leads with Needs you (no number) and drops Nothing running",
    count({ running: 2, failed: 1, stopped: 0, needs: true }).text ===
      "Needs you · 2 running · 1 failed" &&
      count({ running: 0, failed: 0, stopped: 0, needs: true }).text ===
        "Needs you" &&
      count({ running: 0, failed: 0, stopped: 0, needs: true }).parts[0]
        .state === "needs" &&
      count({ running: 1, failed: 0, stopped: 0, needs: false }).text ===
        "1 running",
  );
  check(
    "russian: the needs-you words",
    words("needs", 3, ruMod) === "Ждёт вас · 3" &&
      words("running", 0, ruMod) === "работает" &&
      ruMod.needsWhat(
        [
          { id: "a", questions: ["X?"] },
          { id: "b", questions: ["Y?"] },
        ],
        ruMod.STRINGS,
      ).what === "Вопросов: 2. Y? и ещё 1",
  );
}

// The helper card in the chat: its seven states from the app's card props, the run-log line and the agents-list task
{
  const { helperFacts, helperOpened, helperWhy, helperFirstLine, helperTasks } =
    mod;
  const NOW = 1793864638072;
  const min = 60000;
  const kid = (toolName, at) => ({
    type: "tool_call",
    createdAt: new Date(at),
    toolCall: { toolName, result: "ok" },
  });
  const msg = ({
    id = "t1",
    started = NOW - 2 * min - 10000,
    result,
    background = false,
    kids = [],
    isError = false,
    type = "worker-full",
  } = {}) => ({
    createdAt: new Date(started),
    isError,
    toolCall: {
      toolName: "Task",
      providerToolCallId: id,
      arguments: {
        prompt: "## Scan the logs\n\nThe brief.",
        ...(background ? { run_in_background: true } : {}),
      },
      ...(result ? { result } : {}),
    },
    subagent: {
      agentType: type,
      isBackground: background,
      model: "claude-opus-5-5",
      reasoningEffort: "high",
      childEvents: kids,
    },
  });
  const view = (m, run = null, task = null, now = NOW, s = mod) =>
    s.helperView(
      s.helperFacts(m, run, task),
      s.STRINGS.helperCard,
      s.STRINGS.units,
      s.stageOf,
      now,
    );
  const line = (v) => v.parts.map((p) => p.text).join(" · ");
  const fourteen = Array.from({ length: 14 }, (_, i) =>
    kid(i === 13 ? "Grep" : "Read", NOW - (14 - i) * 5000),
  );
  const running = view(msg({ kids: fourteen }), {
    description: "U3: chat column design",
    type: "worker-full",
  });
  check(
    "helper card: running, the stage orb and 'Helper searching files · 2m · 14 steps'",
    running.state === "running" &&
      running.mark === "orb" &&
      running.orb === "searching" &&
      !running.slow &&
      line(running) === "Helper searching files · 2m · 14 steps" &&
      running.parts[0].part === "state",
  );
  const quiet = view(
    msg({ started: NOW - 8 * min, kids: [kid("Bash", NOW - 3 * min)] }),
    { type: "reviewer" },
  );
  check(
    "helper card: running with no step for over 2 minutes, the orb at half speed and the wait in words",
    quiet.state === "running" &&
      quiet.slow &&
      line(quiet) === "Reviewer still running a command · last step 3m ago",
  );
  const bgTask = {
    toolUseId: "t1",
    status: "running",
    startedAt: NOW - 4 * min - 5000,
    lastToolName: "Read",
  };
  const bg = view(
    msg({ background: true, result: "Async agent launched successfully." }),
    null,
    bgTask,
  );
  check(
    "helper card: running in the background, 'Running in the background · 4m'; with no task only 'In the background'",
    bg.state === "background" &&
      bg.mark === "orb" &&
      line(bg) === "Running in the background · 4m" &&
      line(view(msg({ background: true, result: "launched" }))) ===
        "In the background",
  );
  const done = view(msg({ type: "reviewer", result: "Two findings." }), {
    type: "reviewer",
    result: "success",
    totalTokens: 125096,
    totalDurationMs: 308565,
    totalToolUseCount: 51,
  });
  check(
    "helper card: done, a grey tick and 'Reviewer finished · 5m · 51 steps · 125k tokens'",
    done.state === "done" &&
      done.mark === "tick" &&
      line(done) === "Reviewer finished · 5m · 51 steps · 125k tokens",
  );
  const bgDone = (tokenCount) =>
    view(msg({ background: true, result: "launched" }), null, {
      toolUseId: "t1",
      status: "completed",
      startedAt: NOW,
      durationMs: 7 * min,
      toolCount: 30,
      tokenCount,
    });
  check(
    "helper card: done in the background, 'tokens not reported' when the task has none, its tokens when it has",
    bgDone(0).state === "done-background" &&
      bgDone(0).mark === "tick" &&
      line(bgDone(0)) ===
        "Helper finished · 7m · 30 steps · tokens not reported" &&
      line(bgDone(1234567)) === "Helper finished · 7m · 30 steps · 1.2M tokens",
  );
  const stopped = view(msg({ result: "Done: S1." }), {
    result: "partial",
    why: "What is left: 2 items left",
    totalTokens: 61000,
  });
  check(
    "helper card: stopped early, a grey dash and the report's reason in plain words; the turn limit named",
    stopped.state === "stopped" &&
      stopped.mark === "dash" &&
      line(stopped) === "Stopped early · 2 items left · 61k tokens" &&
      helperWhy(
        "BLOCKED S3: expected a list, found none",
        mod.STRINGS.helperCard,
      ) === "expected a list, found none" &&
      helperWhy("turn limit", mod.STRINGS.helperCard) === "hit its turn limit",
  );
  const failed = view(msg({ result: "error", isError: true }), {
    result: "fail",
    why: "error: npm test exited with code 1",
  });
  check(
    "helper card: failed, the error dot and 'Failed · npm test exited with code 1'",
    failed.state === "failed" &&
      failed.mark === "dot" &&
      line(failed) === "Failed · npm test exited with code 1",
  );
  const words = (model, effort) => mod.runWords({ model, effort });
  const opened = helperOpened(
    helperFacts(
      msg({
        started: Date.UTC(2026, 10, 13, 20, 9),
        result: "## Helper card built\n\nThe rest.",
      }),
      { type: "worker-full", model: "opus", effort: "high", result: "success" },
    ),
    mod.STRINGS.helperCard,
    words,
  );
  check(
    "helper card: opened, the report's first line, then type, model and effort, and the start time",
    opened.length === 2 &&
      opened[0] === "Helper card built" &&
      /^worker-full · Opus high · started \d{1,2}:09\s[ap]m$/.test(opened[1]) &&
      helperOpened(
        helperFacts(msg({ background: true, result: "launched" }), null, null),
        mod.STRINGS.helperCard,
        words,
      ).length === 1,
  );
  check(
    "helper card: the task words, from the log line, else the prompt's first line; no number is made up",
    helperFacts(msg(), { description: "U3: chat column" }, null).description ===
      "U3: chat column" &&
      helperFirstLine(msg().toolCall.arguments.prompt) === "Scan the logs" &&
      line(view(msg({ result: "ok" }), { result: "success" })) ===
        "Helper finished · tokens not reported" &&
      line(view(msg({ kids: [] }), null, null, NOW - 2 * min - 10000)) ===
        "Helper running",
  );
  const row = (task) => ({
    __reactFiber$t: { memoizedProps: { task }, return: null },
  });
  const tasks = helperTasks([
    row({ startedAt: 1, toolUseId: "a" }),
    row({ startedAt: 2 }),
    row({ startedAt: 3, toolUseId: "b" }),
  ]);
  check(
    "helper card: the agents list's tasks by tool id",
    tasks.size === 2 &&
      tasks.get("a").startedAt === 1 &&
      tasks.get("b").startedAt === 3,
  );
  check(
    "russian: the helper card's words",
    line(view(msg({ kids: fourteen }), null, null, NOW, ruMod)) ===
      "Помощник ищет по файлам · 2м · шагов: 14" &&
      line(
        view(
          msg({ type: "reviewer", result: "x" }),
          {
            type: "reviewer",
            result: "success",
            totalTokens: 125096,
            totalDurationMs: 308565,
            totalToolUseCount: 51,
          },
          null,
          NOW,
          ruMod,
        ),
      ) === "Проверяющий: готово · 5м · шагов: 51 · токенов: 125 тыс.",
  );
}

const rawCss = fs.readFileSync(path.join(here, "dist", "style.css"), "utf8");
const tokens = fs.readFileSync(
  path.join(here, "..", "shared", "tokens.css"),
  "utf8",
);
check("css: begins with tokens block", rawCss.startsWith(tokens));
check("css: has --x-surface-1", rawCss.includes("--x-surface-1"));
// A `font` shorthand without a family is invalid and the browser drops it
const typeTokens = [
  ...tokens.matchAll(
    /--x-(?:title|body|row-title|meta|heading|count|figure):([^;]+);/g,
  ),
].map((m) => m[1].trim());
check(
  "tokens: every type token is a full font shorthand",
  typeTokens.length === 7 &&
    typeTokens.every((v) => v.endsWith("var(--x-font-ui)")),
);
{
  // Our own rules (after the tokens block) are on the new type scale: no old caption/micro token, nothing under 12px
  const own = rawCss.slice(tokens.length).replace(/\/\*[\s\S]*?\*\//g, "");
  check(
    "css: on the new type scale (no --x-micro or --x-caption, no size under 12px)",
    !/--x-(?:micro|caption)/.test(own) &&
      [...own.matchAll(/font-size:\s*(\d+)px/g)].every((m) => +m[1] >= 12) &&
      own.includes("font: var(--x-row-title)") &&
      own.includes("font: var(--x-meta)"),
  );
  check(
    "css: one meta line, the doing part cut with an ellipsis; title on one line",
    /\.teammate-panel \.ap-meta\s*{[^}]*white-space:\s*nowrap/.test(own) &&
      /\[data-ap-part="doing"\]\s*{[^}]*text-overflow:\s*ellipsis/.test(own) &&
      /\.teammate-panel \.ap-title\s*{[^}]*white-space:\s*nowrap/.test(own),
  );
  check(
    "css: no green, block at the bottom capped at 72%, the app's spinner hidden behind our mark",
    !/success|#4ade80/.test(own) &&
      /\.files-edited-sidebar > \.teammate-panel\s*{[^}]*margin-top:\s*auto[^}]*max-height:\s*72%/.test(
        own,
      ) &&
      own.includes("[data-ap-mark] > div:first-child > :not(.ap-mark)"),
  );
  const dist = fs.readFileSync(path.join(here, "dist", "index.js"), "utf8");
  check(
    "build: stage.js and the orb mount inlined, the mount inside loadOrbs",
    !/from ['"]\.\/stage\.js['"]/.test(dist) &&
      dist.includes("function stageOf") &&
      !dist.includes("ORBS-MOUNT") &&
      dist.indexOf("thinking-orbs 0.3.2") > dist.indexOf("function loadOrbs"),
  );
  check(
    "build: files-fold.js inlined, re-applied on every change, started and stopped with the panel",
    !/from ['"]\.\/files-fold\.js['"]/.test(dist) &&
      dist.includes("function syncFiles") &&
      /function sync\(\)[\s\S]*?syncFiles\(STRINGS\)/.test(dist) &&
      /function activate\(\)[\s\S]*?startFilesFold\(queue\)/.test(dist) &&
      /function deactivate\(\)[\s\S]*?stopFilesFold\(\)/.test(dist),
  );
  check(
    "build: chat-state.js inlined, re-applied on every change, given back at deactivate",
    !/from ['"]\.\/chat-state\.js['"]/.test(dist) &&
      dist.includes("function syncThinking") &&
      /function sync\(\)[\s\S]*?syncThinking\(STRINGS, stageOf\)/.test(dist) &&
      /function deactivate\(\)[\s\S]*?stopThinking\(\)/.test(dist),
  );
  check(
    "build: a playful word picked once per line and dropped when the line goes back to the app; row orbs drawn at 16px",
    /line\.dataset\.apWord = pool\[Math\.floor\(Math\.random\(\) \* pool\.length\)\]/.test(
      dist,
    ) &&
      /function unsyncLine[\s\S]*?delete line\.dataset\.apWord/.test(dist) &&
      dist.includes('needsOrb("ap-session-orb", orbState, "16")'),
  );
  check(
    "css: the app's dots hidden only while our orb is there; our words in the meta type, upright",
    /\.rich-transcript-waiting:has\(> \.ap-thinking-orb\) > \.rich-transcript-waiting-dots\s*{\s*display:\s*none/.test(
      own,
    ) &&
      /\.rich-transcript-waiting > \.ap-thinking-orb\s*{[^}]*width:\s*var\(--x-orb-size\)/.test(
        own,
      ) &&
      /\.rich-transcript-waiting \.ap-thinking-text\s*{[^}]*font:\s*var\(--x-meta\)[^}]*font-style:\s*normal/.test(
        own,
      ) &&
      // Only our own elements are styled, plus these app selectors: the dots' hide rule and the helper card's own
      // four (its tone, radius and no border; its button content and its description hidden while our head is there;
      // the hairline over its opened part), each scoped to a card we marked
      [...own.matchAll(/([^{}]*rich-transcript[^{}]*){/g)].every((m) =>
        m[1]
          .trim()
          .split(/\s*,\s*/)
          .every(
            (sel) =>
              /\.ap-(?:thinking-(?:orb|text)|helper-[a-z]+)\s*$/.test(sel) ||
              /> \.rich-transcript-waiting-dots$/.test(sel) ||
              [
                ".rich-transcript-tool-card.sub-agent[data-ap-helper]",
                ".rich-transcript-tool-button:has(> .ap-helper) > :not(.ap-helper)",
                ".rich-transcript-tool-card.sub-agent[data-ap-helper] > .rich-transcript-tool-expanded > .rich-transcript-tool-section:has(> .rich-transcript-tool-description)",
                ".rich-transcript-tool-card.sub-agent[data-ap-helper] > .rich-transcript-tool-expanded",
              ].includes(sel),
          ),
      ),
  );
  check(
    "css: helper card on surface 1, radius 8, no border; task 14/500, meta 13/400 muted; state word at 500",
    /\.rich-transcript-tool-card\.sub-agent\[data-ap-helper\]\s*{\s*border:\s*none;\s*border-radius:\s*var\(--x-radius-window\);\s*background:\s*var\(--x-surface-1\)/.test(
      own,
    ) &&
      /\.ap-helper-task\s*{\s*font:\s*var\(--x-row-title\)/.test(own) &&
      /\.ap-helper-meta\s*{\s*font:\s*var\(--x-meta\)[^}]*color:\s*var\(--x-text-muted\)/.test(
        own,
      ) &&
      /\.ap-helper-meta > \[data-ap-part="state"\]\s*{\s*font-weight:\s*500/.test(
        own,
      ),
  );
  check(
    "css: helper state tones: running in the accent text tone, failed in the error tone, done grey tick, stopped grey dash",
    /\[data-ap-helper="running"\] \.ap-helper-meta > \[data-ap-part="state"\],\s*\[data-ap-helper="background"\] \.ap-helper-meta > \[data-ap-part="state"\]\s*{\s*color:\s*var\(--x-state-running\)/.test(
      own,
    ) &&
      /\[data-ap-helper="failed"\] \.ap-helper-meta > \[data-ap-part="state"\]\s*{\s*color:\s*var\(--x-state-failed\)/.test(
        own,
      ) &&
      /\.ap-helper-tick\s*{\s*stroke:\s*var\(--x-state-done\)/.test(own) &&
      /\.ap-helper-dash\s*{[^}]*background:\s*var\(--x-state-stopped\)/.test(
        own,
      ) &&
      /\.ap-helper-dot\s*{[^}]*background:\s*var\(--x-state-failed\)/.test(own),
  );
  check(
    "css: the app's button content hidden only while our head is in it; its description only on a card we marked",
    /\.rich-transcript-tool-button:has\(> \.ap-helper\) > :not\(\.ap-helper\),\s*\.rich-transcript-tool-card\.sub-agent\[data-ap-helper\] > \.rich-transcript-tool-expanded > \.rich-transcript-tool-section:has\(> \.rich-transcript-tool-description\)\s*{\s*display:\s*none/.test(
      own,
    ),
  );
  check(
    "css: reduced motion: the tick drawn in 240ms (--x-motion-slow) without the draw, the chevron without its turn",
    /\.ap-helper-draw path\s*{[^}]*animation:\s*ap-helper-draw var\(--x-motion-slow\)/.test(
      own,
    ) &&
      /--x-motion-slow:\s*240ms/.test(tokens) &&
      /@media \(prefers-reduced-motion: reduce\)\s*{\s*\.ap-helper-draw path\s*{\s*animation:\s*none;\s*stroke-dashoffset:\s*0;\s*}\s*\.ap-helper-chev\s*{\s*transition:\s*none/.test(
        own,
      ),
  );
  check(
    "build: helper-card.js inlined, re-applied on every change, given back at deactivate",
    !/from ['"]\.\/helper-card\.js['"]/.test(dist) &&
      dist.includes("function syncHelpers") &&
      /function sync\(\)[\s\S]*?syncHelpers\(\s*STRINGS\.helperCard/.test(
        dist,
      ) &&
      /function deactivate\(\)[\s\S]*?stopHelpers\(\)/.test(dist),
  );
  check(
    "build: needs-you marks re-applied after the thinking line, given back at deactivate",
    dist.includes("function syncNeeds") &&
      /function sync\(\)[\s\S]*?syncThinking\(STRINGS, stageOf\)[\s\S]*?syncNeeds\(STRINGS, chats\)/.test(
        dist,
      ) &&
      /function deactivate\(\)[\s\S]*?stopNeeds\(\)/.test(dist) &&
      /attributeFilter: \[[^\]]*"class"[^\]]*"data-state"/.test(dist),
  );
  check(
    "css: needs you in the warning tone at 600 on its 12% tint (row, bar, card); running at 500 in the accent text tone",
    /\.ap-needs-word,\s*\.teammate-panel \.ap-count > \[data-ap-part="needs"\]\s*{\s*font-weight:\s*600;\s*color:\s*var\(--x-state-needs\)/.test(
      own,
    ) &&
      /\.ap-session-state\[data-ap-state="running"\] > \[data-ap-part\]\s*{\s*font-weight:\s*500;\s*color:\s*var\(--x-state-running\)/.test(
        own,
      ) &&
      /\[data-ap-session="needs-you"\]:not\(\.active\):not\(\.selected\)\s*{\s*background:\s*var\(--x-state-needs-tint\)/.test(
        own,
      ) &&
      /\[data-ap-needs="banner"\]\s*{[^}]*--x-state-needs-tint/.test(own) &&
      /\[data-ap-needs="card"\] > :first-child\s*{[^}]*--x-state-needs-tint/.test(
        own,
      ),
  );
  check(
    "css: the app's row icon hidden only while our orb stands in for it; the bar's words cut to one line",
    /\.session-list-item-right:has\(> \.ap-session-orb\) > \.session-list-item-status\s*{\s*display:\s*none/.test(
      own,
    ) &&
      /\.ap-needs-what\s*{[^}]*text-overflow:\s*ellipsis[^}]*white-space:\s*nowrap/.test(
        own,
      ) &&
      /\.ap-session-orb,\s*\.ap-needs-orb\s*{[^}]*width:\s*var\(--x-orb-size\)/.test(
        own,
      ),
  );
  check(
    "css: folded, the app's list and Expand all / Collapse all hidden, the list's box only the line high",
    /\[data-ap-files="folded"\] \.file-edits-sidebar__files,\s*\.files-edited-sidebar\[data-ap-files="folded"\] \.files-edited-sidebar__control-btn\s*{\s*display:\s*none/.test(
      own,
    ) &&
      /\[data-ap-files="folded"\] > \.files-edited-sidebar__content\s*{\s*flex:\s*none/.test(
        own,
      ) &&
      /\.ap-files-title\s*{[^}]*font:\s*var\(--x-row-title\)/.test(own) &&
      /\.ap-files-detail\s*{[^}]*font:\s*var\(--x-meta\)/.test(own) &&
      /:has\(> \.git-operations-panel__content\) \.ap-commit\s*{\s*display:\s*none/.test(
        own,
      ),
  );
  check(
    "css: opened, the file list leaves the agents block at least half the column while one of its lists is open",
    /\.files-edited-sidebar\[data-ap-files="open"\] > \.teammate-panel:has\(\.max-h-\\\[200px\\\]\)\s*{[^}]*flex-shrink:\s*0;[^}]*min-height:\s*50%/.test(
      own,
    ),
  );
  const rowTitleRule = (sel) =>
    new RegExp(`${sel}[^{]*{\\s*font:\\s*var\\(--x-row-title\\)`).test(own);
  check(
    "css: the right panel's section headers (Agents & commands, Teammates, Trackers) as big as a helper row's title, like the commit line",
    rowTitleRule(
      String.raw`\.files-edited-sidebar \.teammate-panel > div > button > \.text-xs\.font-medium,\s*\.files-edited-sidebar \.tracker-panel-title`,
    ) &&
      /\.teammate-panel \.ap-title\s*{[^}]*font:\s*var\(--x-row-title\)/.test(
        own,
      ) &&
      /\.git-operations-panel__branch\s*{\s*font:\s*var\(--x-row-title\)/.test(
        own,
      ),
  );
}
check("css: has --x-motion-base", rawCss.includes("--x-motion-base"));

const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, "");
check(
  "css braces balanced",
  (css.match(/{/g) || []).length === (css.match(/}/g) || []).length,
);
check(
  "css: agents list rules",
  [
    '.task-item[data-status="running"]',
    '.task-item[data-status="completed"]',
    ".task-item[data-ap-first]",
    ".ap-meta",
    ".ap-count",
    ".ap-fold:focus-visible",
    "[data-ap-header] > .ml-auto.font-mono",
    '[data-ap-folded="1"] .ap-fold-icon',
  ].every((s) => css.includes(`.teammate-panel ${s}`)),
);
check(
  "css: no accent bar, no transition all",
  !css.includes("inset 3px") && !/transition:\s*all/.test(css),
);
check(
  "css: a meta part longer than the row is cut with an ellipsis, not run past the edge",
  /\.teammate-panel \.ap-meta > span\s*{[^}]*max-width:\s*100%[^}]*text-overflow:\s*ellipsis/.test(
    css,
  ),
);
check(
  "css: commit panel shrinks",
  /\.git-operations-panel\s*{\s*min-width:\s*0/.test(css),
);
check(
  "css: commit switch wraps",
  css.includes('[data-testid="git-commit-mode-toggle"]'),
);

finish();
