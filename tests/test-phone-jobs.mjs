// Tests for the phone's jobs and usage (plan row C4): the PC's jobs.list and usage.get
// (skills/phone-bot/pc/actions/jobs.mjs, usage.mjs, core/door.mjs's trackerItems) and the page's Home parts and job
// screen (phone/page/screens/home-jobs.js, job.js, home-usage.js). The PC side runs the real registry in a temp
// home: a fake door answers tracker_list with the job tracker's own fixture items
// (extensions/job-tracker/test/fixture.html), a fixture database says which sessions run, and a fixture
// plan-usage.jsonl holds the usage. The page side draws on a small DOM stand-in, and its folds and counts are
// compared with what model.js gives for the same items. No real tracker or usage file is read.
// Run: node tests/test-phone-jobs.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");
const PAGE = path.join(ROOT, "phone", "page");
const TRACKER = path.join(ROOT, "extensions", "job-tracker");

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 500);
const tick = () => new Promise((r) => setTimeout(r, 30));

// ---- a temp home: the files library finds everything through os.homedir(), APPDATA and LOCALAPPDATA
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-jobs-"));
const home = path.join(tmp, "home");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
});
const NIM = path.join(process.env.APPDATA, "@nimbalyst", "electron");
fs.mkdirSync(path.join(NIM, "sqlite-db"), { recursive: true });

// ---- the job tracker's own fixture: its items, and its sessions (fixture.html's script: s-1 and s-2 run and
// work on t-18 and t-19, s-3 is linked to the in-progress t-20 but does not run, s-4 finished on t-15)
const fixtureHtml = fs.readFileSync(
  path.join(TRACKER, "test", "fixture.html"),
  "utf8",
);
const items = JSON.parse(
  fixtureHtml.match(
    /<script type="application\/json" id="items">([\s\S]*?)<\/script>/,
  )[1],
);
const FX_SESSIONS = [
  { id: "s-1", linkedTrackerItemIds: ["t-18"] },
  { id: "s-2", linkedTrackerItemIds: ["t-19"] },
  { id: "s-3", linkedTrackerItemIds: ["t-20"] },
  { id: "s-4", linkedTrackerItemIds: ["t-15"] },
];
const FX_RUNNING = ["s-1", "s-2"];
const model = await import(
  pathToFileURL(path.join(TRACKER, "src", "model.js")).href
);
const expected = model.pickerJobs(
  items,
  model.workingItemIds(FX_SESSIONS, FX_RUNNING),
);

// What tracker_list gives: the link the other way round, as linkedSessions on each item (probe 5), plus fields
// the phone does not need (comments, a summary text).
const linkedOf = (id) =>
  FX_SESSIONS.filter((s) => s.linkedTrackerItemIds.includes(id)).map(
    (s) => s.id,
  );
const trackerAnswer = (list) => ({
  structured: {
    action: "listed",
    count: list.length,
    items: list.map((i) => ({
      ...i,
      priority: "medium",
      customFields: {
        ...i.customFields,
        comments: [{ text: "x".repeat(200) }],
      },
      ...(linkedOf(i.id).length ? { linkedSessions: linkedOf(i.id) } : {}),
    })),
  },
  summary: `Found ${list.length} tracker item(s)`,
});

// ---- the fixture database: which sessions run
const fx = new DatabaseSync(path.join(NIM, "sqlite-db", "nimbalyst.sqlite"));
fx.exec(`CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT, is_archived INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`);
for (const [id, status] of [
  ["s-1", "running"],
  ["s-2", "running"],
  ["s-3", "idle"],
  ["s-4", "idle"],
  ["s-other", "running"],
])
  fx.prepare(
    "INSERT INTO ai_sessions (id, workspace_id, title, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).run(id, "C:\\Projects\\fixture", id, status, "2026-11-13", "2026-11-13");

const P = {
  fixture: "C:\\Projects\\fixture",
  noJobs: "C:\\Projects\\no-jobs",
  broken: "C:\\Projects\\broken",
};
function handle(name, _args, call) {
  if (name !== "tracker_list") throw new Error(`the fake door has no ${name}`);
  if (call.workspacePath === P.fixture) return trackerAnswer(items);
  if (call.workspacePath === P.noJobs)
    return trackerAnswer(items.filter((i) => i.type !== "release"));
  throw { rpc: "the tracker is not set up" };
}

// ---- the usage log: last night's figure, this morning's and the newest
const USAGE = path.join(home, ".claude", "usage-log", "plan-usage.jsonl");
const now = new Date();
const atToday = (h, m) => {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d;
};
const yesterday = new Date(atToday(0, 0).getTime() - 3600 * 1000);
const reset = new Date(now.getTime() + 3 * 24 * 3600 * 1000).toISOString();
const usageLine = (t, u) =>
  JSON.stringify({ t: t.toISOString(), five: null, week: { u, r: reset } });
const newest = new Date(Math.max(atToday(0, 1).getTime(), now - 60000));

const { startFakeDoor } = await import("./phone-bot/fake-door.mjs");
const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const registry = createRegistry();
await registry.load(path.join(PC, "actions"));
const ctx = { page: "ok", device: "dev-test", push: () => {} };
let rn = 0;
const ask = (a, d) => registry.handle({ k: "req", id: `r-${++rn}`, a, d }, ctx);

const answers = {};
let door = null;
let failure = null;
try {
  // ---- usage.get
  const none = await ask("usage.get");
  check(
    "usage.get with no usage log: a clear no-usage answer, no made-up figure",
    !none.ok && none.err === "no-usage" && /usage logger/.test(none.message),
    show(none),
  );
  fs.mkdirSync(path.dirname(USAGE), { recursive: true });
  fs.writeFileSync(
    USAGE,
    `${[
      usageLine(new Date(yesterday - 3600 * 1000), 28),
      usageLine(yesterday, 30),
      usageLine(newest, 42),
    ].join("\n")}\n`,
  );
  const usage = await ask("usage.get");
  check(
    "usage.get gives the log's last week percent, its reset and time, and today's use since midnight",
    usage.ok &&
      usage.d.weekPercent === 42 &&
      usage.d.resetsAt === new Date(reset).toISOString() &&
      usage.d.asOf === newest.toISOString() &&
      usage.d.today === 12,
    show(usage),
  );
  answers.usage = usage.d;
  const { readUsage } = await import(
    "../skills/phone-bot/pc/actions/usage.mjs"
  );
  const resetFile = path.join(path.dirname(USAGE), "plan-usage.jsonl");
  fs.writeFileSync(
    resetFile,
    `${usageLine(yesterday, 95)}\n${usageLine(newest, 3)}\n`,
  );
  const afterReset = readUsage(resetFile, now);
  fs.writeFileSync(resetFile, `${usageLine(newest, 7)}\n`);
  const onlyToday = readUsage(resetFile, now);
  fs.writeFileSync(resetFile, `${usageLine(newest, 7)}\n{"t":"x"}\n`);
  let badLast = null;
  try {
    readUsage(resetFile, now);
  } catch (e) {
    badLast = e.message;
  }
  check(
    "today: the percent now when the week started again since midnight, null when the log starts today, a bad last line an error",
    afterReset.today === 3 &&
      onlyToday.today === null &&
      /line 1 from the end/.test(badLast ?? ""),
    show({ afterReset, onlyToday, badLast }),
  );
  fs.writeFileSync(
    USAGE,
    `${[usageLine(yesterday, 30), usageLine(newest, 42)].join("\n")}\n`,
  );

  // ---- jobs.list
  door = await startFakeDoor({
    endpointFile: path.join(NIM, "mcp-endpoint.json"),
    workspaces: Object.entries(P).map(([name, p]) => ({ name, path: p })),
    tools: ["tracker_list"],
    handle,
  });
  const jobs = await ask("jobs.list");
  answers.jobs = jobs.d;
  const listCalls = door.calls.filter((c) => c.name === "tracker_list");
  check(
    "jobs.list asks every project's tracker for all items, closed ones too, with their fields",
    listCalls.length === 3 &&
      listCalls.every(
        (c) =>
          c.args.full === true &&
          c.args.includeClosed === true &&
          c.args.limit === -1,
      ),
    show(listCalls),
  );
  const fxProject = jobs.d?.projects.find((p) => p.name === "fixture");
  check(
    "jobs.list: the project with jobs, its items in model.js's shape, the one without a job left out",
    jobs.ok &&
      fxProject?.items.length === items.length &&
      !jobs.d.projects.some((p) => p.name === "noJobs") &&
      fxProject.items.every((i) => !("comments" in i.customFields)) &&
      !JSON.stringify(jobs.d).includes("C:\\\\Projects"),
    show(jobs),
  );
  check(
    "jobs.list: the running sessions' links, from the items' linkedSessions and the database",
    show(fxProject?.sessions) ===
      show([
        { id: "s-1", linkedTrackerItemIds: ["t-18"] },
        { id: "s-2", linkedTrackerItemIds: ["t-19"] },
      ]),
    show(fxProject?.sessions),
  );
  const broken = jobs.d?.projects.find((p) => p.name === "broken");
  check(
    "jobs.list: a project whose tracker can't be read says why",
    /not set up/.test(broken?.error ?? ""),
    show(broken),
  );
} catch (e) {
  failure = e;
} finally {
  await door?.close();
  fx.close();
  (await import("../skills/phone-bot/pc/core/db.mjs")).closeDb();
}

// ---- the page side: a DOM stand-in with what frame/dom.js and the Home files use
class FakeNode {
  constructor() {
    this.childNodes = [];
  }
  append(...kids) {
    for (const k of kids)
      this.childNodes.push(k instanceof FakeNode ? k : new FakeText(String(k)));
  }
  replaceChildren(...kids) {
    this.childNodes = [];
    this.append(...kids);
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
}
class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.className = "";
    this.attrs = {};
    this.listeners = {};
    this.style = {};
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({});
  }
}
globalThis.Node = FakeNode;
globalThis.document = {
  createElement: (tag) => new FakeElement(tag),
  createElementNS: (_ns, tag) => new FakeElement(tag),
  createTextNode: (text) => new FakeText(text),
};
const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
const hasClass = (n, c) => n.className?.split(" ").includes(c);
const byClass = (root, c) => walk(root).filter((n) => hasClass(n, c));

const pageUrl = (rel) => pathToFileURL(path.join(PAGE, rel)).href;
const PAGE_FILES = [
  "screens/home-jobs.js",
  "screens/job.js",
  "screens/home-usage.js",
];
try {
  if (failure) throw failure;
  const screens = await import(pageUrl("frame/screens.js"));
  for (const f of [
    "screens/home.js",
    "screens/home-sessions.js",
    ...PAGE_FILES,
  ])
    await import(pageUrl(f));
  const usagePage = await import(pageUrl("screens/home-usage.js"));
  check(
    "Home's parts in DS1's order: jobs after working, usage last",
    show(screens.homeParts().map((p) => p.id)) ===
      show(["pc-status", "version", "needs-you", "working", "jobs", "usage"]),
    show(screens.homeParts().map((p) => [p.id, p.order])),
  );
  const fixed = {
    "pc.status": {
      nimbalyst: "open",
      pcName: "Test PC",
      sessionsOpen: 2,
      asOf: now.toISOString(),
      setupVersion: "26.1",
      nimbalystVersion: "0.83.0",
      update: null,
    },
    "home.sessions": { needsYou: [], working: [], finishedToday: 0 },
    "projects.list": [],
    "jobs.list": answers.jobs,
    "usage.get": answers.usage,
  };
  const gone = [];
  const c = (params = {}) => ({
    connected: true,
    params,
    offered: () => true,
    ask: async (a) =>
      a in fixed ? { ok: true, d: fixed[a] } : { ok: false, err: "unknown" },
    go: (id, p) => gone.push({ id, params: p }),
    onEvent: () => {},
    haptic: () => {},
    mainButton: () => {},
  });
  const root = screens.screen("home").render(c());
  await tick();
  await tick();
  const text = root.textContent;
  const open = expected.open[0];
  const jobRows = byClass(root, "job");
  check(
    "Home lists the fixture's one open job with model.js's N of M, and not the finished one",
    jobRows.length === expected.open.length &&
      jobRows[0].textContent.includes(open.job.title) &&
      jobRows[0].textContent.includes(
        `${open.counts.done} of ${open.counts.total} steps`,
      ) &&
      !text.includes(expected.finished[0].job.title),
    text,
  );
  check(
    "the job's meta line has model.js's needs you, working and to do counts",
    jobRows[0]?.textContent.includes(
      `${open.counts.needs} needs you · ${open.counts.running} working · ${open.counts.todo} to do`,
    ),
    jobRows[0]?.textContent,
  );
  const parts = byClass(root, "jbar")[0]?.childNodes ?? [];
  check(
    "the bar: done, needs you, working and to do, each as wide as its count",
    show(parts.map((p) => [p.className, p.style.flexGrow])) ===
      show([
        ["d", String(open.counts.done)],
        ["n", String(open.counts.needs)],
        ["r", String(open.counts.running)],
        ["t", String(open.counts.todo)],
      ]),
    show(parts.map((p) => [p.className, p.style])),
  );
  check(
    "a project whose tracker cannot be read is named with its reason",
    text.includes("Could not read broken's tracker"),
    text,
  );
  jobRows[0]?.click();
  check(
    "a job row opens the job screen",
    gone[0]?.id === "job" && gone[0].params.job === open.job.id,
    show(gone),
  );

  // ---- the job screen: the four folds as model.js gives them, a step that needs the user first
  const jobRoot = screens.screen("job").render(c(gone[0].params));
  const heads = byClass(jobRoot, "fold").map(
    (f) => f.childNodes[0].textContent,
  );
  const want = [
    ["Needs you", open.folds.needs.length],
    ["Working", open.folds.running.length],
    ["To do", open.folds.todo.length],
    ["Finished", open.folds.done.length],
  ]
    .filter(([, n]) => n)
    .map(([w, n]) => `${w}${n}`);
  check(
    "the job screen's folds and counts are model.js's",
    show(heads) === show(want),
    show({ heads, want }),
  );
  const steps = byClass(jobRoot, "step");
  check(
    "a step that needs the user is listed first, in the needs-you block",
    open.folds.needs.length > 0 &&
      steps[0]?.attrs["data-step"] === open.folds.needs[0].item.id &&
      hasClass(steps[0], "needs"),
    show(steps.slice(0, 3).map((s) => s.attrs["data-step"])),
  );
  check(
    "Finished is folded: its steps show only after Show",
    steps.length ===
      open.folds.needs.length +
        open.folds.running.length +
        open.folds.todo.length,
    String(steps.length),
  );
  walk(jobRoot)
    .find((n) => n.attrs?.["aria-expanded"] === "false")
    ?.click();
  check(
    "Show opens Finished with every done and dropped step",
    byClass(jobRoot, "step").length === open.rows.length,
    String(byClass(jobRoot, "step").length),
  );

  // ---- usage on Home
  const usageBox = byClass(root, "usage")[0];
  check(
    "Home's usage shows the log's week percent, today's use and the reset",
    usageBox?.textContent.includes("42%used") &&
      byClass(usageBox, "u-fig")[0]?.textContent === "12%" &&
      usageBox.textContent.includes("of the week gone · resets") &&
      byClass(usageBox, "fill")[0]?.style.width === "42%",
    usageBox?.textContent,
  );
  check(
    "order on Home: Working, then Jobs, then Usage",
    text.indexOf("Working") < text.indexOf("Jobs") &&
      text.indexOf("Jobs") < text.indexOf("Usage"),
    text,
  );
  const half = Date.parse(reset) - 3.5 * 24 * 3600 * 1000;
  const near = usagePage.usageView(
    {
      weekPercent: 91,
      today: 14,
      resetsAt: reset,
      asOf: new Date(half).toISOString(),
    },
    half,
  );
  check(
    "from 85% the usage turns amber and says when it runs out at this pace",
    near.warn && /^At this pace it runs out /.test(near.runsOut ?? ""),
    show(near),
  );

  // ---- the build serves model.js unchanged where the screens' import finds it
  const { buildPage } = await import(pageUrl("build.mjs"));
  const served = new Map(buildPage().files);
  const src = fs
    .readFileSync(path.join(TRACKER, "src", "model.js"), "utf8")
    .replace(/\r\n/g, "\n");
  const url = new URL(
    "../../../extensions/job-tracker/src/model.js",
    "https://page.example/page/screens/home-jobs.js",
  );
  check(
    "the page build serves model.js unchanged at the path the screens import",
    served.get(url.pathname)?.toString("utf8") === src,
    url.pathname,
  );
  const js = PAGE_FILES.map((f) => fs.readFileSync(path.join(PAGE, f), "utf8"));
  check(
    "no px sizes or style attributes in the jobs and usage files",
    js.every((s) => !/\d+px|style:|setAttribute\("style"/.test(s)),
  );
} catch (e) {
  failure = e;
}
if (failure) {
  console.log(`FAIL the run stopped: ${failure.stack}`);
  failed++;
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 3 });
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
