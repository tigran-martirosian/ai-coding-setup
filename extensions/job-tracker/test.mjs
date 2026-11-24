// Checks the Job Tracker: the build makes one script and a stylesheet with the shared tokens; the counts and
// words of the fixture's 27 made-up steps (test/fixture.html) read as the tracker design says; no text style under
// 12px, no weight of 700 or more, no upper case.
//   node test.mjs             the checks
//   node test.mjs --pictures  the checks, then the fixture in headless Chromium (Ink Aurora and Ink Bone): the job
//                             named "26.2" at 1920 wide and a long name at 2560, the long name at 1920 with the
//                             picker open, All open, no job and empty; pictures in <temp>/26-2-build/job-tracker/,
//                             the header, progress line, bar, the four folds and their rows and text sizes measured
//                             in the page
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildFor, createChecks } from "../shared/check.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const { check, finish } = createChecks();

buildFor(here, "english");
const dist = fs.readFileSync(path.join(here, "dist", "index.js"), "utf8");
check(
  "build: one script, no import lines left",
  !/^import /m.test(dist) && dist.includes("function foldsOf"),
);
check(
  "build: the folds and their rows are in the script",
  dist.includes("function foldsView") && dist.includes("function renderRow"),
);
check(
  "build: the chat column's move is in the script",
  dist.includes("function showChat") && dist.includes("function returnChat"),
);
check(
  "build: one export block",
  (dist.match(/^export \{/gm) || []).length === 1,
);
const distMod = await import(
  pathToFileURL(path.join(here, "dist", "index.js")).href
);
check(
  "build: exports activate and deactivate",
  typeof distMod.activate === "function" &&
    typeof distMod.deactivate === "function",
);
const manifest = JSON.parse(
  fs.readFileSync(path.join(here, "manifest.json"), "utf8"),
);
check("manifest: id", manifest.id === "com.local.jobtracker");
check(
  "manifest: main and styles are built",
  fs.existsSync(path.join(here, manifest.main)) &&
    fs.existsSync(path.join(here, manifest.styles)),
);

const { STRINGS, closeStep, archiveOldJobs, failure, readSessions } =
  await import(pathToFileURL(path.join(here, "src", "index.js")).href);
const {
  releaseSteps,
  categoryOf,
  openSteps,
  foldsOf,
  pickerJobs,
  notInJob,
  oldClosedJobs,
  workingItemIds,
} = await import(pathToFileURL(path.join(here, "src", "model.js")).href);
const { pageView } = await import(
  pathToFileURL(path.join(here, "src", "reading.js")).href
);
const { foldsView, ORDER, DONE_SHOWN } = await import(
  pathToFileURL(path.join(here, "src", "groups.js")).href
);
const { rowView, doingOf, waitsOn } = await import(
  pathToFileURL(path.join(here, "src", "row.js")).href
);

// The fixture's items, from its JSON block
const fixture = fs.readFileSync(
  path.join(here, "test", "fixture.html"),
  "utf8",
);
const items = JSON.parse(
  fixture.match(
    /<script type="application\/json" id="items">([\s\S]*?)<\/script>/,
  )[1],
);
const release = pickerJobs(items, new Set()).open[0].job;
check("job: the fixture's one open job", release.id === "rel-1");
const steps = releaseSteps(items, release.id);
check(
  "steps: 27 kept plus 1 dropped (archived and other releases left out)",
  steps.length === 28,
);
const at = new Date(2026, 10, 13, 17, 40);
// The fixture's sessions: s-1 and s-2 run and work on t-18 and t-19; t-20 and t-21 are in progress with none running
const fxWorking = new Set(["t-18", "t-19"]);
const view = pageView(STRINGS, items, fxWorking, null, at, "fixture-project");
const partsOf = (v) =>
  v.progress.parts.map((p) => `${p.part} ${p.n}`).join(", ");

check(
  "page: opens on the open job with the newest activity",
  view.kind === "job" && view.current === "rel-1",
);
check(
  "progress line: 17, of 27 steps done, 63%, Updated 17:40",
  view.progress.figure === "17" &&
    view.progress.words === "of 27 steps done" &&
    view.progress.percent === "63%" &&
    view.progress.updated === "Updated 17:40",
);
check(
  "bar: parts done 17, needs 1, running 2, to do 7 (the model's counts)",
  partsOf(view) === "done 17, needs 1, running 2, todo 7" ||
    console.log(partsOf(view)),
);
{
  const c = pickerJobs(items, fxWorking).open[0].counts;
  check(
    "bar: each part's count and hover come from the model's counts",
    (view.progress.parts.every((p) => p.n === c[p.part]) &&
      view.progress.parts.map((p) => p.tip).join(" | ") ===
        "Done: 17 of 27 steps | Needs you: 1 step | Running: 2 steps, a session works on each | To do: 7 steps, 5 for Claude, 2 for you") ||
      console.log(view.progress.parts.map((p) => p.tip).join(" | ")),
  );
}
check(
  "bar: a part at 0 is left out",
  partsOf(pageView(STRINGS, items, new Set(), null, at, "p")) ===
    "done 17, needs 1, todo 9",
);

// A dropped step leaves the total, whether wont-do or duplicate; a step that is not dropped counts (the page's own
// numbers, foldsOf's)
const withStatus = (id, status) =>
  steps.map((s) => (s.id === id ? { ...s, status } : s));
const countsOf = (list, run = fxWorking) => foldsOf(list, run).counts;
check(
  "dropped: wont-do leaves the total",
  countsOf(steps).total === 27 &&
    categoryOf({ status: "wont-do", title: "x" }) === "dropped",
);
check(
  "dropped: duplicate leaves the total",
  countsOf(withStatus("t-28", "duplicate")).total === 27,
);
// The live 26.2 data has "cancelled" steps; before, categoryOf threw on them and the release view was never drawn
const withCancelled = withStatus("t-28", "cancelled");
check(
  "dropped: cancelled leaves the total, and the page top still draws",
  categoryOf({ status: "cancelled", title: "x" }) === "dropped" &&
    countsOf(withCancelled).total === 27 &&
    pageView(
      STRINGS,
      items.map((i) => (i.id === "t-28" ? { ...i, status: "cancelled" } : i)),
      fxWorking,
      null,
      at,
      "p",
    ).progress.figure === view.progress.figure,
);
check(
  "dropped: the same step as to do counts",
  countsOf(withStatus("t-28", "to-do")).total === 28,
);

// Needs you is the user's, never running, though the app files it under "started": with a session on each of the
// four started steps, all four run; of the three waits-for-you steps, the one no open step comes before needs you
const allRunning = new Set(["t-18", "t-19", "t-20", "t-21"]);
check(
  "needs you: not running",
  countsOf(steps, allRunning).running === 4 &&
    countsOf(steps, allRunning).needs === 1,
);
check(
  "needs you: a running step turned Needs you leaves running",
  countsOf(withStatus("t-21", "waits-for-you"), allRunning).running === 3 &&
    countsOf(withStatus("t-21", "waits-for-you"), allRunning).needs === 2,
);
check(
  "unknown status: a clear error that names the step",
  (() => {
    try {
      categoryOf({ status: "someday", title: "Sort the old screenshots" });
      return false;
    } catch (e) {
      return /unknown step status "someday" on "Sort the old screenshots"/.test(
        e.message,
      );
    }
  })(),
);
check(
  "a status named like an object member (constructor, toString) is unknown too, not a hidden step",
  ["constructor", "toString", "__proto__"].every((status) => {
    try {
      categoryOf({ status, title: "x" });
      return false;
    } catch (e) {
      return /unknown step status/.test(e.message);
    }
  }),
);
check(
  "needs you: an in-review step counts for you, not running",
  countsOf(withStatus("t-20", "in-review"), allRunning).running === 3 &&
    countsOf(withStatus("t-20", "in-review"), allRunning).needs === 2,
);

// The page's job rules (tracker one-page design, sections 1 and 2), on the fixture's made-up jobs: s-1 runs and
// works on b-3; s-2 is linked to b-4 but does not run
const blockOf = (id) =>
  JSON.parse(
    fixture.match(
      new RegExp(
        `<script type="application/json" id="${id}">([\\s\\S]*?)</script>`,
      ),
    )[1],
  );
const jobItems = blockOf("jobs");
const working = workingItemIds(
  [
    { id: "s-1", linkedTrackerItemIds: ["b-3"] },
    { id: "s-2", linkedTrackerItemIds: ["b-4"] },
    { id: "s-3" },
  ],
  ["s-1", "s-3"],
);
const picker = pickerJobs(jobItems, working);
const jobById = (id) =>
  [...picker.open, ...picker.finished].find((j) => j.job.id === id);
const search = jobById("j-search");
const idsOf = (rows) => rows.map((r) => r.item.id).join(",");
const rowIn = (rows, id) => rows.find((r) => r.item.id === id);
check(
  "working: only the linked items of running sessions",
  working.size === 1 && working.has("b-3"),
);
check(
  "jobs: in-review is Needs you",
  categoryOf({ status: "in-review", title: "x" }) === "needs" &&
    idsOf(search.folds.needs) === "b-1,b-2",
);
check(
  "jobs: in-progress with no working session is not Running (it is To do, marked started)",
  idsOf(search.folds.running) === "b-3" &&
    rowIn(search.folds.todo, "b-4").started &&
    !rowIn(search.folds.todo, "b-5").started,
);
check(
  "jobs: To do holds to-do, the started step and the linked bug with its tag",
  idsOf(search.folds.todo) === "b-4,b-5,b-6,b-7,bug-1" &&
    rowIn(search.folds.todo, "bug-1").bug &&
    !rowIn(search.folds.todo, "b-5").bug,
);
check(
  "jobs: Done is newest first, then the dropped step, shown and never counted",
  idsOf(search.folds.done) === "b-9,b-8,b-10" &&
    search.folds.done[2].dropped &&
    !search.folds.done[0].dropped,
);
check(
  "jobs: counts (of 10, 2 done, 2 need you, 1 running, 5 to do, 1 dropped, 20%)",
  JSON.stringify(search.counts) ===
    JSON.stringify({
      total: 10,
      done: 2,
      needs: 2,
      running: 1,
      todo: 5,
      forYou: 2,
      forClaude: 3,
      dropped: 1,
      percent: 20,
    }),
);
check(
  'jobs: for you is a To do step owned by "user" or titled "Your OK" / "Your word"',
  idsOf(search.folds.todo.filter((r) => r.forYou)) === "b-6,b-7" &&
    !rowIn(search.folds.needs, "b-2").forYou,
);
check(
  "jobs: a step's file is on its row, null without one",
  rowIn(search.folds.needs, "b-1").file === "docs/search-design.md" &&
    rowIn(search.folds.needs, "b-2").file === null,
);
check(
  "jobs: an archived step is left out",
  !search.steps.some((s) => s.id === "b-11"),
);
check(
  "jobs: a job with every step done is finished (its stored status still in progress)",
  jobById("j-trailer").finished &&
    jobById("j-trailer").job.status === "in-progress",
);
check(
  "jobs: a job with version set, every step done and no gitTag is open",
  !jobById("j-40").finished &&
    jobById("j-40").version === "4.0" &&
    jobById("j-40").tag === null &&
    jobById("j-40").counts.done === jobById("j-40").counts.total,
);
check(
  "jobs: a job with version set, every step done and its gitTag set is finished",
  jobById("j-39").finished && jobById("j-39").tag === "v3.9",
);
check(
  "jobs: a job with no steps yet is open; a cancelled job is finished",
  !jobById("j-guide").finished && jobById("j-menu").finished,
);
check(
  "picker: lists open jobs only, newest activity first",
  picker.open.map((j) => j.job.id).join(",") === "j-search,j-guide,j-40",
);
check(
  "picker: finished jobs newest first; an archived job is left out",
  picker.finished.map((j) => j.job.id).join(",") === "j-39,j-menu,j-trailer" &&
    !jobById("j-old"),
);
check(
  "picker: a job's activity is the newest updated of the job and its steps",
  +search.activity === +new Date("2026-11-14T10:00:00"),
);
check(
  "updated: a done step with no updated time is a clear error",
  (() => {
    try {
      foldsOf(
        steps
          .filter((s) => s.status === "done")
          .map((s) => ({ ...s, updated: undefined })),
        new Set(),
      );
      return false;
    } catch (e) {
      return /item t-\d+ has no "updated" time/.test(e.message);
    }
  })(),
);
{
  const noJob = blockOf("no-job");
  let built = null;
  try {
    const p = pickerJobs(noJob, new Set());
    const loose = notInJob(noJob);
    built = { p, loose, f: foldsOf(loose, new Set()) };
  } catch (e) {
    console.log(e);
  }
  check(
    "no job: a project with no release and no waits-for-you status builds the model without throwing",
    built !== null &&
      built.p.open.length === 0 &&
      built.p.finished.length === 0 &&
      built.loose.length === 7 &&
      idsOf(built.f.folds.needs) === "n-3" &&
      built.f.folds.running.length === 0 &&
      idsOf(built.f.folds.todo) === "n-1,n-2,n-4,n-5,n-7" &&
      idsOf(built.f.folds.done) === "n-6",
  );
}
check(
  "not in a job: the main fixture's tasks outside any release",
  notInJob(items)
    .map((i) => i.id)
    .join(",") === "t-31,t-32,t-33,t-34,t-35",
);

// The header (design 3.2): the job's name, its goal, a state pill and one meta line; a short and a long name
const renamed = (title) =>
  pageView(
    STRINGS,
    items.map((i) => (i.id === "rel-1" ? { ...i, title } : i)),
    fxWorking,
    null,
    at,
    "p",
  ).head;
check(
  "header: name, goal, In progress pill, Started meta",
  view.head.name === "3.1 · Settings refresh" &&
    view.head.goal ===
      "a clearer settings screen and its tests, ready for the next update" &&
    !view.head.goalMissing &&
    view.head.state.word === "In progress" &&
    view.head.state.tip === "In progress: 10 steps left" &&
    view.head.meta === "Started 10 Nov",
);
check(
  "header: a bare created day (as the app stores it) is that day, not the day before",
  pageView(
    STRINGS,
    items.map((i) => (i.id === "rel-1" ? { ...i, created: "2026-11-14" } : i)),
    fxWorking,
    null,
    at,
    "p",
  ).head.meta === "Started 14 Nov",
);
const longName = "Rework the garden planner layout and plant lists";
// Too long for one line at 1920 (the picker's check under a two-line name)
const twoLineName =
  "Rework the garden planner layout, the plant lists and the watering screen before the spring update";
check(
  'header: a short name ("26.2") and a long made-up name are the headline as written',
  renamed("26.2").name === "26.2" && renamed(longName).name === longName,
);
check(
  "header: the name is the picker button and its hover says how many jobs are open",
  view.head.button && view.head.nameTip.endsWith("Switch job (1 open)"),
);
check(
  "header: a job with no goal says so",
  (() => {
    const h = pageView(
      STRINGS,
      items.map((i) => (i.id === "rel-1" ? { ...i, description: "" } : i)),
      fxWorking,
      null,
      at,
      "p",
    ).head;
    return h.goalMissing && h.goal === "No goal written yet.";
  })(),
);

// The picker (design 3.3): All open first, the open jobs newest activity first, Not in a job, then Finished
const jobsView = pageView(STRINGS, jobItems, working, null, at, "p");
check(
  "picker: All open first, then the open jobs only, newest activity first",
  jobsView.picker.all.label === "All open" &&
    jobsView.picker.all.meta === "3 jobs" &&
    jobsView.picker.open.map((j) => j.id).join(",") === "j-search,j-guide,j-40",
);
check(
  "picker: the finished jobs are below, in their own list",
  jobsView.picker.finished.map((j) => j.id).join(",") ===
    "j-39,j-menu,j-trailer" && jobsView.picker.more === null,
);
check(
  "picker: an open job's line says done and who is needed",
  jobsView.picker.open[0].meta === "2 of 10 done" &&
    jobsView.picker.open[0].needs === "2 need you",
);
check(
  "picker: Not in a job only when items are outside every job",
  jobsView.picker.loose === null &&
    view.picker.loose.label === "Not in a job" &&
    view.picker.loose.meta === "5 items",
);
check(
  "page: the job with the newest activity is shown first",
  jobsView.current === "j-search",
);

// All open (design 3.9): one line per open job with its bar and its needs-you count
const allView = pageView(STRINGS, jobItems, working, "all", at, "p");
check(
  "all open: one line per open job, with its percent and needs-you words",
  allView.kind === "all" &&
    allView.jobs
      .map((j) => `${j.id} ${j.percent} ${j.right} ${j.needs}`)
      .join(" | ") ===
      "j-search 20 2 of 10 2 need you | j-guide 0 0 of 0 null | j-40 100 2 of 2 null" &&
    allView.head.meta === "3 open · as of 17:40",
);
check(
  "all open: Not in a job is the last line when open items are outside every job",
  pageView(STRINGS, items, fxWorking, "all", at, "p").jobs.at(-1).id === "none",
);
// Not in a job counts its open items only (design 3.3): one of the five loose items done leaves four
{
  const oneDone = items.map((i) =>
    i.id === "t-31" ? { ...i, status: "done" } : i,
  );
  const v = pageView(STRINGS, oneDone, fxWorking, "all", at, "p");
  check(
    "not in a job: the picker and the All open line count the open items only",
    v.picker.loose.meta === "4 items" && v.jobs.at(-1).right === "4 items",
  );
}
// No open item outside a job: no "Not in a job" entry, and the page does not open on it
{
  const allDone = blockOf("no-job").map((i) => ({ ...i, status: "done" }));
  const v = pageView(STRINGS, allDone, new Set(), null, at, "p");
  check(
    "not in a job: with every loose item done, the page does not open on it and the picker leaves it out",
    v.kind === "empty" && v.picker.loose === null,
  );
}
// Only finished jobs: All open says so in one sentence, with no "0 open" and no empty list
{
  const closed = jobItems.map((i) =>
    ["j-search", "j-guide", "j-40"].includes(i.id)
      ? { ...i, status: "released" }
      : i,
  );
  const v = pageView(STRINGS, closed, working, null, at, "p");
  check(
    'all open: with only finished jobs, the page says "No open jobs." and shows no list',
    v.kind === "all" &&
      v.head.goal === "No open jobs." &&
      v.head.meta === null &&
      v.jobs === null,
  );
}
// The Finished hover says why: the stored status, or every step done or dropped (and the tag, for a version)
{
  const tipOf = (list, id) =>
    pageView(STRINGS, list, working, id, at, "p").head.state.tip;
  const released = jobItems.map((i) =>
    i.id === "j-search" ? { ...i, status: "released" } : i,
  );
  check(
    "finished hover: a cancelled job, a released one with open steps, a job with every step done, one with its tag",
    tipOf(jobItems, "j-menu") === "Finished: marked cancelled" &&
      tipOf(released, "j-search") === "Finished: marked finished" &&
      tipOf(jobItems, "j-trailer") === "Finished: every step done or dropped" &&
      tipOf(jobItems, "j-39") ===
        "Finished: every step done or dropped, tag v3.9 set",
  );
}

// No job (design 3.10) and empty (3.11)
const noJobView = pageView(
  STRINGS,
  blockOf("no-job"),
  new Set(),
  null,
  at,
  "game",
);
check(
  "no job: the page shows Not in a job with the project as its meta",
  noJobView.kind === "none" &&
    noJobView.head.name === "Not in a job" &&
    noJobView.head.meta === "game" &&
    noJobView.picker.all.disabled &&
    noJobView.progress.figure === "1",
);
check(
  "empty: a project with no items draws the empty state",
  pageView(STRINGS, [], new Set(), null, at, "p").kind === "empty",
);
check(
  'words: no "release" on the page (the jobs fixture has none in its names)',
  !/release/i.test(JSON.stringify([jobsView, allView, noJobView])),
);

// The four folds (design 3.7): Needs you, Running, To do, Done, in that order, with foldsOf's counts. The fixture's
// sessions as index.js reads them: s-1 runs on S18 and last edited a file, s-2 runs the tests on S19, s-3 is linked
// to S20 but does not run (it ended at 15:40), the finished s-4 is linked to the done S15
const fxFolds = foldsOf(steps, fxWorking);
const minutesAgo = (n) => +at - n * 60 * 1000;
const fxSessions = new Map([
  [
    "t-18",
    {
      id: "s-1",
      title: "",
      running: true,
      waiting: false,
      updatedAt: minutesAgo(5),
      call: { toolName: "Edit", arguments: {} },
    },
  ],
  [
    "t-19",
    {
      id: "s-2",
      title: "",
      running: true,
      waiting: false,
      updatedAt: minutesAgo(5),
      call: {
        toolName: "Bash",
        arguments: { command: "npm test", description: "Run the tests" },
      },
    },
  ],
  [
    "t-20",
    {
      id: "s-3",
      title: "",
      running: false,
      waiting: false,
      updatedAt: minutesAgo(120),
      call: null,
    },
  ],
  [
    "t-15",
    {
      id: "s-4",
      title: "Pick the type sizes",
      running: false,
      waiting: false,
      updatedAt: minutesAgo(3 * 1440),
      call: null,
    },
  ],
]);
const foldCtx = {
  open: openSteps(steps),
  now: at,
  sessionOf: (id) => fxSessions.get(id) || null,
  // The fixture's Sessions column lists s-1 and s-2
  listed: (id) => id === "s-1" || id === "s-2",
};
const atStart = { open: new Set(["needs", "running", "todo"]), doneAll: false };
const fv = foldsView(STRINGS, fxFolds.folds, atStart, foldCtx);
const foldIds = (f) => f.rows.map((r) => r.id).join(",");
check(
  "folds: Needs you, Running, To do, Done in that order, each count foldsOf's",
  ORDER.join(",") === "needs,running,todo,done" &&
    fv.map((f) => `${f.word} ${f.count}`).join(" | ") ===
      "Needs you 1 | Running 2 | To do 7 | Done 18" &&
    fv.every((f) => f.count === fxFolds.folds[f.key].length),
);
check(
  "folds: the steps in each fold; Done newest first, the dropped step last",
  fv.map(foldIds).join(" / ") ===
    "t-27 / t-18,t-19 / t-20,t-21,t-22,t-23,t-24,t-25,t-26 / " +
      "t-17,t-16,t-15,t-14,t-13,t-12,t-11,t-10,t-09,t-08,t-07,t-06,t-05,t-04,t-03,t-02,t-01,t-28" ||
    console.log(fv.map(foldIds).join(" / ")),
);
check(
  "folds: Done closed at start, the other three open",
  fv.map((f) => f.open).join(",") === "true,true,true,false",
);
{
  const empty = foldsView(
    STRINGS,
    foldsOf(steps, new Set()).folds,
    atStart,
    foldCtx,
  )[1];
  check(
    "folds: an empty fold shows 0 and its sentence, never open",
    empty.count === 0 &&
      empty.empty === "Nothing running right now." &&
      !empty.open &&
      empty.rows.length === 0,
  );
}
{
  const many = Array.from({ length: DONE_SHOWN + 5 }, (_, i) => ({
    id: `d-${i}`,
    type: "task",
    title: `Done step ${i}`,
    status: "done",
    archived: false,
    updated: new Date(2026, 10, 1, 10, i).toISOString(),
    customFields: {},
  }));
  const f = foldsOf(many, new Set()).folds;
  const ctx = { open: [], now: at, sessionOf: () => null };
  const shown = foldsView(STRINGS, f, atStart, ctx)[3];
  const all = foldsView(STRINGS, f, { ...atStart, doneAll: true }, ctx)[3];
  check(
    `folds: Done shows its first ${DONE_SHOWN} rows, then "Show 5 more"; all of them after the click`,
    shown.rows.length === DONE_SHOWN &&
      shown.more === "Show 5 more" &&
      shown.count === DONE_SHOWN + 5 &&
      all.rows.length === DONE_SHOWN + 5 &&
      all.more === null,
  );
}

// The rows (design 3.8): mark, what it waits on or does, the plan chip, the session link where one is linked
const rowById = (id) => fv.flatMap((f) => f.rows).find((r) => r.id === id);
const said = (r) =>
  [
    `${r.mark.kind}${r.mark.orb ? `:${r.mark.orb}` : ""}${r.mark.half ? ":half" : ""}`,
    r.wait,
    r.plan || "-",
    r.session ? `${r.session.word} ${r.session.id}` : "-",
  ].join(" | ");
for (const [what, id, want] of [
  [
    "Needs you, ready for the user",
    "t-27",
    "dot | ready for you | Part 3 · builds | -",
  ],
  [
    "the user's step that waits on open steps sits in To do, not Needs you: your turn after them",
    "t-22",
    "ring | your turn after The polish round on the two mock-ups; Restyle the account mock-up | - | -",
  ],
  [
    "running, its session editing",
    "t-18",
    "orb:composing | editing files · since 17:20 | Part 2 · design | Open session s-1",
  ],
  [
    "running, its session running the tests",
    "t-19",
    "orb:solving | running a check | Part 2 · design | Open session s-2",
  ],
  [
    "started, its session not running: the session ended, with the time of its last change",
    "t-20",
    "ring:half | session ended 15:40, step not done | - | Open session s-3",
  ],
  [
    "started, no session",
    "t-21",
    "ring:half | started, no session on it | - | -",
  ],
  [
    "to do, waiting",
    "t-23",
    "ring | waits on Your OK on the restyled mock-ups | - | -",
  ],
  [
    "done, a finished session linked",
    "t-15",
    "tick | 08:15 | Part 2 · design | Open session s-4",
  ],
  ["dropped", "t-28", "tick | dropped | Part 2 · design | -"],
])
  check(
    `row ${what}: ${want}`,
    said(rowById(id)) === want || console.log(said(rowById(id))),
  );
// The session's state on a row (close approach, Proofs, Session states; the user picked "Show what's real"): only
// the states the app keeps a source for, in the agents panel's and the phone app's words
{
  const s1 = fxSessions.get("t-18");
  // S18 as the model files it when its session waits on the user (the session is not in the running ids, index.js
  // readSessions): in Needs you
  const asking = foldsOf(steps, new Set(["t-18", "t-19"]), new Set(["t-18"]));
  const rowOfId = (id) =>
    asking.rows.find((r) => r.item.id === id && r.fold !== "running") ||
    fxFolds.folds.running.find((r) => r.item.id === id);
  const stated = (session) => {
    const row = session.waiting ? rowOfId("t-18") : fxFolds.folds.running[0];
    const v = rowView(STRINGS, row, { ...foldCtx, session });
    return `${v.mark.orb} | ${v.wait} | ${v.waitTone}`;
  };
  const waits = { ...s1, running: false, waiting: true, call: null };
  const cases = [
    [
      "a working session shows what it does and since when, in plain running words",
      s1,
      "composing | editing files · since 17:20 | running",
    ],
    [
      'a session that waits on the user says "needs you" with the listening orb and since it began to wait, in the attention tone',
      { ...waits, waitingSince: minutesAgo(3) },
      "listening | needs you · since 17:37 | attention",
    ],
    [
      'a waiting session whose start of waiting the app does not give says "needs you" with no "since"',
      { ...waits, waitingSince: null },
      "listening | needs you | attention",
    ],
    [
      'a running session with no change for a day says "no change since" its day and hour',
      { ...s1, updatedAt: +new Date(2026, 10, 11, 9, 10) },
      "composing | no change since 11 Nov 09:10 | attention",
    ],
    [
      "a running session quiet for less than a day still shows what it does",
      { ...s1, updatedAt: minutesAgo(23 * 60) },
      "composing | editing files · since 17:20 | running",
    ],
    [
      "a session that waits on the user says so even with no change for a day",
      {
        ...waits,
        waitingSince: minutesAgo(3),
        updatedAt: minutesAgo(2 * 1440),
      },
      "listening | needs you · since 17:37 | attention",
    ],
  ];
  check(
    "session waits on you: the step moves to Needs you, out of Running, and counts there",
    asking.folds.needs.map((r) => r.item.id).join(",") === "t-18,t-27" &&
      !asking.folds.running.some((r) => r.item.id === "t-18") &&
      asking.counts.needs === 2 &&
      asking.counts.running === 1,
  );
  {
    const v = rowView(STRINGS, rowOfId("t-18"), {
      ...foldCtx,
      session: { ...waits, waitingSince: minutesAgo(3) },
    });
    check(
      "session waits on you: its action is Open session, not Mark done",
      v.done === null && v.session && v.session.word === "Open session",
    );
  }
  for (const [what, session, want] of cases)
    check(
      `session state: ${what}: ${want}`,
      stated(session) === want || console.log(stated(session)),
    );
  check(
    "session state: a started step's session that ended yesterday says its day and hour",
    rowView(
      STRINGS,
      fxFolds.folds.todo.find((r) => r.item.id === "t-20"),
      {
        ...foldCtx,
        session: {
          ...fxSessions.get("t-20"),
          updatedAt: +new Date(2026, 10, 12, 9, 10),
        },
      },
    ).wait === "session ended 12 Nov 09:10, step not done",
  );
  // A step's file is written by sessions and by any file's frontmatter: a network path would make Windows send the
  // user's sign-in to that host on a click, so it gets no Open link
  const fileOf = (file) =>
    rowView(
      STRINGS,
      { ...fxFolds.folds.todo.find((r) => r.item.id === "t-20"), file },
      foldCtx,
    ).file;
  check(
    "a step's network or device path (//host, \\\\host, \\\\?\\) gets no Open link; a project path keeps it",
    [
      "//203.0.113.5/docs/setup.md",
      "\\\\203.0.113.5\\docs\\setup.md",
      "\\\\?\\C:\\x.md",
      "/\\203.0.113.5/x.md",
    ].every((f) => fileOf(f) === null) &&
      fileOf("docs/setup.md")?.path === "docs/setup.md",
  );
  check(
    "a step's file gets an Open link only as a drive path or a path that stays inside the project",
    [
      String.raw`\??\C:\x.md`,
      String.raw`\\.\pipe\x`,
      // a single / is the drive root on Windows; on macOS and Linux it is a real path and opens (tested below)
      ...(process.platform === "win32" ? ["/etc/passwd"] : []),
      String.raw`\x.md`,
      "C:x.md",
      "../x.md",
      "docs/../../x.md",
      String.raw`docs\..\..\x.md`,
    ].every((f) => fileOf(f) === null) &&
      [
        String.raw`C:\Projects\x.md`,
        "c:/x.md",
        "./docs/a.md",
        "docs/../a.md",
      ].every((f) => fileOf(f) !== null),
  );
  const { openable } = await import(
    pathToFileURL(path.join(here, "src", "row.js")).href
  );
  const BS = String.fromCharCode(92);
  check(
    "a macOS or Linux absolute path opens off Windows; // and two backslashes never; Windows device names never",
    openable("/srv/me/p/a.md", false) &&
      !openable("/srv/me/p/a.md", true) &&
      !openable("//host/x.md", false) &&
      !openable(`${BS}${BS}host${BS}x.md`, false) &&
      ["COM1", "docs/aux.md", "nul", "docs/LPT1.txt", "con"].every(
        (f) => !openable(f, true),
      ) &&
      openable("docs/auxiliary.md", true),
  );
  // The app keeps no lasting record of a session's error: no row ever names one, whatever the session holds
  const words = [
    ...cases.map(([, session]) => stated({ ...session, status: "error" })),
    ...fv.flatMap((f) => f.rows).map((r) => r.wait),
  ];
  check(
    "session state: no row says a session failed or had an error",
    !words.some((w) => /error|fail|stopped/i.test(w)) ||
      console.log(words.filter((w) => /error|fail|stopped/i.test(w))),
  );
}
check(
  "rows: a session link only on S18, S19, S20 and S15",
  fv
    .flatMap((f) => f.rows)
    .filter((r) => r.session)
    .map((r) => r.id)
    .join(",") === "t-18,t-19,t-20,t-15",
);
check(
  'rows: a listed session\'s link hovers its name only; one the Sessions column does not list adds "Opens in the Sessions view" (S20, and the done S15)',
  rowById("t-18").session.tip === STRINGS.openSessionLinked &&
    rowById("t-20").session.tip ===
      `${STRINGS.openSessionLinked}\nOpens in the Sessions view` &&
    rowById("t-15").session.tip ===
      "Open the session “Pick the type sizes”\nOpens in the Sessions view",
);
check(
  "rows: the started steps S20 and S21 sit in To do, marked started",
  foldIds(fv[2]).startsWith("t-20,t-21,") &&
    fv[2].rows.slice(0, 2).every((r) => r.mark.half && r.tip.includes("\n")),
);
check(
  "rows: the Needs you row's ready words, and To do's ready when nothing is waited on",
  rowView(STRINGS, fxFolds.folds.needs[0], { ...foldCtx, open: [] }).wait ===
    "ready for you" &&
    rowView(STRINGS, fxFolds.folds.todo[3], { ...foldCtx, open: [] }).wait ===
      "ready",
);
check(
  'rows: S22\'s file is a link "Open settings-review.md", in its folder; no other row has one',
  JSON.stringify(rowById("t-22").file) ===
    JSON.stringify({
      path: "docs/mockups/settings-review.md",
      word: "Open settings-review.md",
      note: "in docs/mockups",
      tip: "docs/mockups/settings-review.md\nOpen in the editor",
    }) && fv.flatMap((f) => f.rows).filter((r) => r.file).length === 1,
);
{
  const jobFolds = foldsView(STRINGS, search.folds, atStart, {
    open: openSteps(search.steps),
    now: at,
    sessionOf: () => null,
  });
  const bug = jobFolds.flatMap((f) => f.rows).find((r) => r.id === "bug-1");
  check(
    'rows: the bug shows its "Bug" tag, the other rows none',
    bug.bug === "Bug" &&
      jobFolds.flatMap((f) => f.rows).filter((r) => r.bug).length === 1,
  );
}

check(
  "index: no sessionState.subscribe (it would narrow the app's one subscription to this project)",
  !fs
    .readFileSync(path.join(here, "src", "index.js"), "utf8")
    .includes("sessionState.subscribe("),
);

// Waits on, as the live 26.2 data has it: step codes hold a space ("look W4"), and the order is in dependsOn links
const coded = (id, step, more = {}) => ({
  id,
  type: "task",
  title: `Step ${step}`,
  status: "to-do",
  archived: false,
  customFields: { step, collection: [{ itemId: "rel-1" }], ...more },
});
const w4 = coded("w-4", "look W4");
const w45 = coded("w-45", "look W45");
const p5 = { ...coded("p-5", "pipe P5"), status: "done" };
const byText = coded("w-9", "look W9", { waitsOn: "look W4, pipe P5" });
const byLink = coded("w-8", "look W8", { dependsOn: [{ itemId: "w-45" }] });
const liveOpen = openSteps([w4, w45, p5, byText, byLink]);
check(
  "waits on: a spaced code in the text matches whole, a done step and a longer code do not",
  waitsOn(byText, liveOpen).join("|") === "Step look W4",
);
check(
  "waits on: a dependsOn link to an open step counts",
  waitsOn(byLink, liveOpen).join("|") === "Step look W45",
);
check(
  "waits on: the row says it",
  rowView(STRINGS, foldsOf([w45, byLink], new Set()).rows[1], {
    open: liveOpen,
    now: at,
    session: null,
  }).wait === "waits on Step look W45",
);
check(
  "waits on: the row names the waited-on step by its title, never its code",
  rowView(STRINGS, foldsOf([w4, byText], new Set()).rows[1], {
    open: liveOpen,
    now: at,
    session: null,
  }).wait === "waits on Step look W4",
);
{
  const w7 = { ...byLink, status: "waits-for-you", id: "w-7" };
  const f = foldsOf([w4, w7, w45], new Set());
  const row = f.folds.todo.find((r) => r.item.id === "w-7");
  const v =
    row &&
    rowView(STRINGS, row, {
      open: openSteps([w4, w7, w45]),
      now: at,
      session: null,
    });
  check(
    "waits on: a step for the user linked to an open step is in To do, not Needs you, says your turn after it, and has no Mark done",
    f.folds.needs.length === 0 &&
      f.counts.forYou === 1 &&
      v.wait === "your turn after Step look W45" &&
      v.done === null,
  );
}

// A To do row sits under its stage heading, so it shows no stage chip (user, 2026-11-23: stages as headings).
// To do in run order under stage headings (user, 2026-11-23): stage number first, then how many open steps stand
// before a step, then the order given; the first row of a stage carries its heading and no row shows the stage chip
{
  const a = coded("o-a", "A");
  const b = coded("o-b", "B", { waitsOn: "A" });
  const c = coded("o-c", "C", { waitsOn: "B" });
  // Given last-edited first, as the app hands them over
  const order = (list) =>
    foldsOf(list, new Set())
      .folds.todo.map((r) => r.item.customFields.step)
      .join("");
  check(
    "run order: a step comes after the steps it waits on",
    order([c, b, a]) === "ABC",
  );
  const s = (step, stage, more = {}) =>
    coded(`s-${step}`, step, { stage, ...more });
  const release = s("R", "3. Release");
  const fix = s("F", "2. Fix");
  const build = s("B", "1. Build");
  const loose = coded("s-L", "L");
  check(
    "run order: stage number first, steps with no stage last",
    order([release, loose, fix, build]) === "BFRL",
  );
  const loop1 = coded("l-1", "X", { waitsOn: "Y" });
  const loop2 = coded("l-2", "Y", { waitsOn: "X" });
  check(
    "run order: a wait loop does not hang and keeps both steps",
    order([loop1, loop2]).length === 2,
  );
  const b2 = s("B2", "1. Build", { waitsOn: "B" });
  const list = [release, b2, fix, build, loose];
  const views = foldsView(
    STRINGS,
    foldsOf(list, new Set()).folds,
    atStart,
    foldCtx,
  )[2].rows;
  check(
    "stages: a heading on the first row of each stage, Other steps for the rest, no stage chip",
    views.map((v) => v.stageHead).join("|") ===
      "1. Build||2. Fix|3. Release|Other steps" &&
      views.every((v) => v.plan === null),
  );
  const plain = foldsView(
    STRINGS,
    foldsOf([c, b, a], new Set()).folds,
    atStart,
    foldCtx,
  )[2].rows;
  check(
    "stages: none set, no headings",
    plain.every((v) => !v.stageHead),
  );
}

// The Mark done button (close approach, point 1): the ready Needs you row and a started step whose session ended
// have it; a click writes the step type's own done status through the app's tracker update, and the row moves to
// Done; a failed write keeps the row and its words say so
{
  const t27 = steps.find((s) => s.id === "t-27");
  const needsRow = (list) => foldsOf(list, fxWorking).folds.needs;
  check(
    "Mark done: the ready Needs you row and the started step whose session ended have one, no other row",
    fv
      .flatMap((f) => f.rows)
      .filter((r) => r.done)
      .map((r) => `${r.id} ${r.done.word}`)
      .join(",") === "t-27 Mark done,t-20 Mark done" ||
      console.log(fv.flatMap((f) => f.rows).filter((r) => r.done)),
  );
  const calls = [];
  const writes = (answer) => ({
    documentService: {
      updateTrackerItem: async (arg) => {
        calls.push(arg);
        return answer();
      },
    },
  });
  const ok = await closeStep(
    writes(() => ({ success: true, item: { ...t27, status: "done" } })),
    () => steps,
    "t-27",
  );
  const after = foldsOf(ok.items, fxWorking).folds;
  check(
    "Mark done: the click calls the tracker update with status done for that step only",
    JSON.stringify(calls) ===
      JSON.stringify([{ itemId: "t-27", updates: { status: "done" } }]),
  );
  check(
    "Mark done: after the write the row leaves Needs you and is first in Done",
    ok.error === null &&
      !after.needs.some((r) => r.item.id === "t-27") &&
      after.done[0].item.id === "t-27",
  );
  // A plan's done status is "completed" (tracker facts); "done" is not a plan status
  calls.length = 0;
  const plan = { ...t27, id: "p-1", type: "plan", status: "in-review" };
  const planned = await closeStep(
    writes(() => ({ success: true })),
    () => [plan],
    "p-1",
  );
  check(
    'Mark done: a plan is written with its own done status "completed", and lands in Done',
    JSON.stringify(calls) ===
      JSON.stringify([{ itemId: "p-1", updates: { status: "completed" } }]) &&
      planned.items[0].status === "completed" &&
      foldsOf(planned.items, new Set()).folds.done.length === 1,
  );
  // A read that lands during the write is kept: closeStep builds on the items as they stand when the write answers
  let current = steps;
  const later = steps.map((s) =>
    s.id === "t-23" ? { ...s, title: "New" } : s,
  );
  const raced = await closeStep(
    writes(() => {
      current = later;
      return { success: false, error: "the database is locked" };
    }),
    () => current,
    "t-27",
  );
  check(
    "Mark done: a failed write keeps a read that landed meanwhile",
    raced.items === later,
  );
  const no = await closeStep(
    writes(() => ({ success: false, error: "the database is locked" })),
    () => steps,
    "t-27",
  );
  const thrown = await closeStep(
    writes(() => {
      throw new Error("the app did not answer");
    }),
    () => steps,
    "t-27",
  );
  check(
    "Mark done: a failed write (an error answer or a thrown call) keeps the row in Needs you",
    no.items === steps &&
      thrown.items === steps &&
      needsRow(no.items).some((r) => r.item.id === "t-27") &&
      thrown.error === "the app did not answer",
  );
  const objectError = await closeStep(
    writes(() => ({
      success: false,
      error: { code: "SQLITE_BUSY", message: "the file is busy" },
    })),
    () => steps,
    "t-27",
  );
  check(
    'Mark done: an error answer that is an object gives its message, not "[object Object]"',
    objectError.error === "the file is busy" &&
      failure({ error: new Error("disk full") }) === "disk full",
  );
  const row = rowView(
    STRINGS,
    needsRow(no.items).find((r) => r.item.id === "t-27"),
    { ...foldCtx, failed: new Map([["t-27", no.error]]) },
  );
  check(
    "Mark done: after a failed write the row says the tracker did not save it, and why",
    row.wait ===
      "Not marked done: the tracker did not save it (the database is locked)" &&
      row.waitTone === "failed",
  );
}

// Finished jobs leave the picker (close approach, point 2): a job released or cancelled 3 days ago is archived when
// the page reads, through the app's archive call; a newer one stays; a job the app did not archive stays too
{
  const now = Date.parse("2026-11-16T12:00:00");
  const ago = (days) => new Date(now - days * 864e5).toISOString();
  const job = (id, status, updated, closed) => ({
    id,
    type: "release",
    title: id,
    status,
    archived: false,
    updated,
    customFields: closed
      ? {
          activity: [
            { action: "status_changed", newValue: status, timestamp: closed },
          ],
        }
      : {},
  });
  const jobs = [
    job("j-open", "in-progress", ago(10)),
    // released 4 days ago, edited since: its release line counts, not its last change
    job("j-old", "released", ago(1), ago(4)),
    job("j-new", "released", ago(2), ago(2)),
    job("j-gone", "cancelled", ago(5)),
    job("j-locked", "released", ago(6)),
  ];
  const asked = [];
  const r = await archiveOldJobs(
    {
      documentService: {
        archiveTrackerItem: async (arg) => {
          asked.push(arg);
          return arg.itemId === "j-locked"
            ? { success: false, error: "the database is locked" }
            : { success: true };
        },
      },
    },
    jobs,
    now,
    new Set(),
  );
  const shown = pickerJobs(r.items, new Set());
  const ids = [...shown.open, ...shown.finished].map((j) => j.job.id);
  check(
    "old jobs: the jobs released or cancelled 3 days ago are archived through the app, the newer one is not",
    JSON.stringify(asked) ===
      JSON.stringify([
        { itemId: "j-old", archive: true },
        { itemId: "j-gone", archive: true },
        { itemId: "j-locked", archive: true },
      ]),
  );
  check(
    "old jobs: a job released over 3 days ago is not in the picker; one released 2 days ago still is",
    !ids.includes("j-old") &&
      !ids.includes("j-gone") &&
      ids.includes("j-new") &&
      ids.includes("j-open"),
  );
  check(
    "old jobs: a job the app did not archive stays in the picker and is named with what failed",
    ids.includes("j-locked") &&
      JSON.stringify(r.failed) ===
        JSON.stringify([{ id: "j-locked", error: "the database is locked" }]),
  );
  // The app stamps an activity line with Date.now(), a number: released 4 days ago by that line, edited yesterday
  const stamped = job("j-ms", "released", ago(1), now - 4 * 864e5);
  check(
    "old jobs: a release line stamped in ms (as the app writes it) counts, not the job's last change",
    oldClosedJobs([stamped], now).length === 1,
  );
  // An archived job's open steps stay in view under "Not in a job"; its done steps leave with it
  const step = (id, status) => ({
    id,
    type: "task",
    title: id,
    status,
    archived: false,
    updated: ago(5),
    customFields: { collection: [{ itemId: "j-old" }] },
  });
  const loose = notInJob([
    { ...jobs[1], archived: true },
    step("s-open", "to-do"),
    step("s-done", "done"),
  ]).map((i) => i.id);
  check(
    'old jobs: an archived job\'s open step shows under "Not in a job", its done step does not',
    loose.join(",") === "s-open" || console.log(loose),
  );
}

// The sessions as index.js reads them (close approach, Proofs, Session states): the app counts a session as running
// only while its turn runs, so a Claude CLI session that waits on the user is not in the running ids; its own state
// says "waiting_for_input", with lastActivity the time it began to wait
{
  const waitedAt = new Date(2026, 10, 13, 17, 31);
  const fakeApp = {
    invoke: async (channel) => {
      if (channel === "sessions:list")
        return {
          success: true,
          sessions: [
            {
              id: "s-w",
              updatedAt: minutesAgo(9),
              linkedTrackerItemIds: ["t-18"],
            },
            {
              id: "s-r",
              updatedAt: minutesAgo(1),
              linkedTrackerItemIds: ["t-19"],
            },
            {
              id: "s-e",
              updatedAt: minutesAgo(120),
              linkedTrackerItemIds: ["t-20"],
            },
          ],
        };
      if (channel === "transcript:get-tail-messages") return [];
      throw new Error(`no channel ${channel}`);
    },
    sessionState: {
      getRunningSessionIds: async () => ({
        success: true,
        sessionIds: ["s-r"],
      }),
      getSessionState: async (id) => ({
        success: true,
        state:
          id === "s-w"
            ? {
                status: "waiting_for_input",
                isStreaming: false,
                lastActivity: waitedAt,
              }
            : id === "s-r"
              ? {
                  status: "running",
                  isStreaming: true,
                  lastActivity: new Date(),
                }
              : null,
      }),
    },
  };
  const got = await readSessions(fakeApp, steps, "/p");
  const f = foldsOf(steps, got.working, got.waiting);
  const fold = (id) => f.rows.find((r) => r.item.id === id).fold;
  check(
    "sessions: a session that waits on the user, not in the running ids, is found as waiting, with when it began to wait",
    got.waiting.has("t-18") &&
      got.working.has("t-18") &&
      got.sessions.get("t-18").waiting === true &&
      got.sessions.get("t-18").waitingSince === +waitedAt,
  );
  check(
    'sessions: its step shows in Needs you as "needs you", never as "session ended"; a session that ended still says so',
    fold("t-18") === "needs" &&
      rowView(
        STRINGS,
        f.rows.find((r) => r.item.id === "t-18"),
        {
          ...foldCtx,
          session: got.sessions.get("t-18"),
        },
      ).wait === "needs you · since 17:31" &&
      fold("t-19") === "running" &&
      fold("t-20") === "todo" &&
      /^session ended/.test(
        rowView(
          STRINGS,
          f.rows.find((r) => r.item.id === "t-20"),
          {
            ...foldCtx,
            session: got.sessions.get("t-20"),
          },
        ).wait,
      ),
  );
}

// The last tool's name gives the orb's shape (the agents panel's map) and plain words
for (const [call, want] of [
  [{ toolName: "Read" }, "searching reading files"],
  [{ toolName: "Grep" }, "searching searching files"],
  [{ toolName: "Edit" }, "composing editing files"],
  [{ toolName: "Write" }, "composing editing files"],
  [
    {
      toolName: "Bash",
      arguments: { command: "npm test", description: "Run the tests" },
    },
    "solving running a check",
  ],
  [
    { toolName: "Bash", arguments: { command: "git status" } },
    "working running a command",
  ],
  [{ toolName: "Agent" }, "connecting waiting on helpers"],
  [{ toolName: "TodoWrite" }, "shaping planning"],
  [{ toolName: "SomethingNew" }, "working using SomethingNew"],
]) {
  const d = doingOf(STRINGS, call);
  check(
    `orb: ${call.toolName} gives ${want}`,
    `${d.orb} ${d.words}` === want || console.log(`${d.orb} ${d.words}`),
  );
}

// Text styles: nothing under 12px, no weight of 700 or more, no upper case; the page's own ladder (DESIGN.md
// "Tracker page") is set once on .rt-root as --rt-* shorthands
const tokens = fs.readFileSync(
  path.join(here, "..", "shared", "tokens.css"),
  "utf8",
);
const own = fs
  .readFileSync(path.join(here, "src", "style.css"), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const tokenFont = (name) => {
  const m = (name.startsWith("rt-") ? own : tokens).match(
    new RegExp(`--${name}:\\s*(\\d+)\\s+(\\d+)px`),
  );
  if (!m)
    throw new Error(`font --${name} not found in tokens.css or style.css`);
  return { weight: +m[1], size: +m[2] };
};
const ladder = (name) => {
  const f = tokenFont(name);
  return `${f.size}/${f.weight}`;
};
const fonts = [...own.matchAll(/font:\s*var\(--([\w-]+)\)/g)].map((m) =>
  tokenFont(m[1]),
);
const sizes = [...own.matchAll(/font-size:\s*(\d+)px/g)].map((m) => +m[1]);
const weights = [...own.matchAll(/font-weight:\s*(\d+)/g)].map((m) => +m[1]);
check(
  "css: every font is a shared token or the page's own ladder",
  fonts.length > 0 &&
    !/[^-]font:(?!\s*(var\(|inherit;))/.test(own) &&
    [...own.matchAll(/--rt-[\w-]+:\s*([^;]+);/g)].every((m) =>
      /^\d+ \d+px\/\d+px var\(--x-font-ui\)$/.test(m[1]),
    ),
);
check(
  "css: no text under 12px",
  [...fonts.map((f) => f.size), ...sizes].every((s) => s >= 12),
);
check(
  "css: no weight of 700 or more",
  [...fonts.map((f) => f.weight), ...weights].every((w) => w < 700),
);
check("css: no upper case", !/text-transform:\s*uppercase/.test(own));
check(
  "css: the page ladder: name 30/600, count 26/600, words 17/400, goal 15/400, group 16/600, row 14/400 and 14/500, small 12/500",
  [
    ladder("rt-name"),
    ladder("rt-progress"),
    ladder("rt-progress-words"),
    ladder("rt-goal"),
    ladder("rt-group"),
    ladder("rt-row"),
    ladder("rt-row-em"),
    ladder("rt-small"),
  ].join(" ") === "30/600 26/600 17/400 15/400 16/600 14/400 14/500 12/500" &&
    /\.rt-title\s*{[^}]*font:\s*var\(--rt-name\)/.test(own) &&
    /\.rt-pg-fig\s*{\s*font:\s*var\(--rt-progress\)/.test(own) &&
    /\.rt-pg-words\s*{\s*font:\s*var\(--rt-progress-words\)/.test(own),
);
check(
  "css: the bar is 10px high and needs you keeps 8px",
  /\.rt-bar\s*{[^}]*height:\s*10px/.test(own) &&
    /\.rt-needs\s*{[^}]*min-width:\s*8px/.test(own),
);
check(
  "css: left-aligned from 24px, capped at 1200px",
  /max-width:\s*calc\(1200px \+ 2 \* var\(--x-space-5\)\)/.test(own) &&
    !/margin:\s*0 auto/.test(own),
);
check(
  "css: each fold a panel with a hairline border, 16px apart, its heading the 16/600 group size",
  /\.rt-fold\s*{\s*margin-top:\s*var\(--x-space-4\);\s*border:\s*1px solid var\(--x-hairline\)/.test(
    own,
  ) &&
    /\.rt-fold-title\s*{[^}]*font:\s*var\(--rt-group\)/.test(own) &&
    /\.rt-root \.rt-fold-head\s*{[^}]*font:\s*var\(--rt-group\)/.test(own),
);
check(
  "css: a row title 14/400, 14/500 in Needs you; chips 12/500; the bug tag in the failed tone",
  /\.rt-root \.rt-row-title\s*{[^}]*font:\s*var\(--rt-row\)/.test(own) &&
    /\.rt-row-needs \.rt-row-title\s*{\s*font:\s*var\(--rt-row-em\)/.test(
      own,
    ) &&
    /\.rt-chip\s*{[^}]*font:\s*var\(--rt-small\)/.test(own) &&
    /\.rt-chip-bug\s*{\s*color:\s*var\(--x-state-failed\)/.test(own),
);
check(
  "css: the app's list and the sidebar under its header hidden with two classes",
  /\.tracker-sidebar > \.rt-left-hidden,\s*\.tracker-table-container\.rt-table-hidden\s*{\s*display:\s*none/.test(
    own,
  ),
);
check(
  "dist: the agents panel's orb map and the shared orbs are in the script",
  dist.includes("function stageOf") && /window\.Orbs ?=/.test(dist),
);
check(
  "dist css: shared tokens first",
  fs
    .readFileSync(path.join(here, "dist", "style.css"), "utf8")
    .startsWith(tokens),
);

if (process.argv.includes("--pictures")) await pictures();

finish();

/**
 * The fixture in Playwright's headless Chromium (driven over the DevTools protocol, so no npm package is needed),
 * served over http from the extensions folder. Per theme and width: one picture, and the measures printed.
 */
async function pictures() {
  const http = await import("node:http");
  const { spawn } = await import("node:child_process");
  const out = path.join(os.tmpdir(), "26-2-build", "job-tracker");
  fs.mkdirSync(out, { recursive: true });

  const root = path.join(here, "..");
  const types = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".mjs": "text/javascript",
    ".css": "text/css",
    ".woff2": "font/woff2",
  };
  const server = http.createServer((req, res) => {
    const file = path.join(
      root,
      decodeURIComponent(new URL(req.url, "http://x").pathname),
    );
    if (
      !file.startsWith(root) ||
      !fs.existsSync(file) ||
      !fs.statSync(file).isFile()
    ) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "content-type": types[path.extname(file)] || "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
  const port = server.address().port;

  const pw = path.join(process.env.LOCALAPPDATA || "", "ms-playwright");
  if (!fs.existsSync(pw))
    throw new Error(`Playwright's browsers are not there: ${pw}`);
  const shell = fs
    .readdirSync(pw)
    .filter((d) => /^chromium_headless_shell-\d+$/.test(d))
    .sort()
    .pop();
  const exe =
    shell &&
    path.join(
      pw,
      shell,
      "chrome-headless-shell-win64",
      "chrome-headless-shell.exe",
    );
  if (!exe || !fs.existsSync(exe))
    throw new Error(`no chrome-headless-shell in ${pw}`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "rt-chrome-"));
  const chrome = spawn(
    exe,
    [
      "--mute-audio",
      "--hide-scrollbars",
      "--no-first-run",
      "--remote-debugging-port=0",
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  try {
    const wsBrowser = await new Promise((ok, bad) => {
      let err = "";
      chrome.stderr.on("data", (d) => {
        err += d;
        const m = err.match(/DevTools listening on (ws:\/\/\S+)/);
        if (m) ok(m[1]);
      });
      chrome.on("exit", (c) => bad(new Error(`Chromium ended (${c}): ${err}`)));
    });
    const list = await (
      await fetch(`http://${new URL(wsBrowser).host}/json/list`)
    ).json();
    const target = list.find((t) => t.type === "page");
    if (!target) throw new Error("Chromium has no page open");
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send("Runtime.enable");
    await page.send("Page.enable");

    // One state: the fixture with `query` at a size, once its page top is drawn as `kind`; its measures
    const open = async (query, theme, kind, [width, height] = [1920, 1080]) => {
      page.errors.length = 0;
      await page.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      const url = `http://127.0.0.1:${port}/job-tracker/test/fixture.html?w=${width}${query}#${theme}`;
      await page.send("Page.navigate", { url });
      // The new page, not the one before it, which has a page top too
      return waitFor(
        page,
        `location.href === ${JSON.stringify(url)} && ${measureScript(kind)}`,
        `the ${kind} page`,
      );
    };
    const shoot = async (file) => {
      const shot = await page.send("Page.captureScreenshot", {
        format: "png",
      });
      const to = path.join(out, file);
      fs.writeFileSync(to, Buffer.from(shot.data, "base64"));
      return to;
    };
    const click = (selector) =>
      page.send("Runtime.evaluate", {
        expression: `document.querySelector(${JSON.stringify(selector)}).click()`,
      });
    const noErrors = (name) =>
      check(
        `${name}: no page errors`,
        page.errors.length === 0 || console.log(page.errors.join("\n")),
      );
    const plainText = (name, m) =>
      check(
        `${name}: no text under 12px, no weight 700+, no upper case`,
        m.smallest >= 12 && m.heaviest < 700 && !m.upper,
      );
    const partsLine = (v) =>
      v.progress.parts.map((p) => `${p.part}:${p.n}:${p.tip}`).join(" / ");
    const pgLine = (v) =>
      [v.progress.figure, v.progress.words, v.progress.percent]
        .filter(Boolean)
        .join("|");
    // The picker's lines top to bottom: option ids, "Finished" for its heading, "more" for the more button
    const pickerOrder = (v) =>
      [
        "all",
        ...v.picker.open.map((j) => j.id),
        ...(v.picker.loose ? ["none"] : []),
        ...(v.picker.finished.length ? ["Finished"] : []),
        ...v.picker.finished.slice(0, v.picker.shown).map((j) => j.id),
        ...(v.picker.more ? ["more"] : []),
      ].join(",");
    const mainAll = pageView(STRINGS, items, fxWorking, "all", at, "p");
    // The page archives the fixture's jobs released or cancelled 3 days before the real clock, so its picker leaves them out
    const oldIds = new Set(oldClosedJobs(items, Date.now()).map((j) => j.id));
    const archivedNow = pageView(
      STRINGS,
      items.map((i) => (oldIds.has(i.id) ? { ...i, archived: true } : i)),
      fxWorking,
      null,
      at,
      "fixture-project",
    );

    for (const theme of ["ink-aurora", "ink-bone"]) {
      for (const [width, height, title] of [
        [1920, 1080, "26.2"],
        [2560, 1438, longName],
      ]) {
        const name = `${theme}-${width}`;
        const m = await open(
          `&name=${encodeURIComponent(title)}`,
          theme,
          "job",
          [width, height],
        );
        const file = await shoot(`${name}.png`);
        console.log(
          `${name}: "${m.name}" ${m.nameFont} in ${m.nameLines} line(s), count ${m.fig}, words ${m.words}, ` +
            `left ${m.headLeft}/${m.barLeft}px, bar ${m.width}px, smallest ${m.smallest}px · ${file}`,
        );
        noErrors(name);
        check(
          `${name}: the Sessions column stands in the tracker's left column; the tracker sidebar hidden, its type rows still in the page`,
          (m.sideHidden &&
            m.onlySidebar &&
            m.typeRows === 3 &&
            m.sessionsShown) ||
            console.log(
              `hidden ${m.sideHidden}, only it ${m.onlySidebar}, type rows ${m.typeRows}, sessions ${m.sessionsShown}`,
            ),
        );
        if (name === "ink-aurora-1920") {
          // The guard: React inserting next to the borrowed column, or removing it, while it is away never throws;
          // the column is borrowed again on the next sync. Leaving the tracker takes it home at once.
          const r = await page.send("Runtime.evaluate", {
            expression: `(async () => {
              const home = document.querySelector(".agent-mode .resizable-panel-left");
              const col = document.getElementById("fx-sessions");
              const out = { away: col.parentElement !== home };
              const i = document.createElement("i");
              try { home.insertBefore(i, col); out.insert = "ok"; } catch (e) { out.insert = String(e); }
              i.remove();
              await new Promise((ok) => setTimeout(ok, 300));
              out.again = col.parentElement !== home && !!document.querySelector(".tracker-sidebar").parentElement.contains(col);
              window.fxLeave();
              await Promise.resolve();
              out.home = col.parentElement === home;
              document.querySelector('[data-layout="tracker-mode-wrapper"]').classList.remove("hidden");
              await Promise.resolve();
              out.backAtOnce = col.parentElement !== home;
              return out; })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          const g = r.result.value;
          check(
            "sessions: a React insert next to the borrowed column does not throw, and the column comes back to the tracker",
            (g.away && g.insert === "ok" && g.again) ||
              console.log(JSON.stringify(g)),
          );
          check(
            "sessions: leaving the tracker puts the column home at once, and reopening it brings the column back at once",
            (g.home && g.backAtOnce) || console.log(JSON.stringify(g)),
          );
          // Closing and opening the left panel: the app drops the tracker panel (with the borrowed column in it)
          // and draws a new one; the column must come back into the new panel, not leave it empty
          const p = await page.send("Runtime.evaluate", {
            expression: `(async () => {
              const col = document.getElementById("fx-sessions");
              const side = document.querySelector(".tracker-sidebar");
              const old = side.parentElement;
              const fresh = old.cloneNode(false);
              const newSide = side.cloneNode(true);
              newSide.classList.remove("rt-left-hidden");
              fresh.appendChild(newSide);
              old.replaceWith(fresh);
              await new Promise((ok) => setTimeout(ok, 300));
              return { inNew: fresh.contains(col), sideHidden: newSide.classList.contains("rt-left-hidden"),
                shown: col.getClientRects().length > 0 }; })()`,
            awaitPromise: true,
            returnByValue: true,
          });
          const pv = p.result.value;
          check(
            "sessions: after the left panel is closed and opened, the Sessions column is back in the tracker's left column",
            (pv.inNew && pv.sideHidden && pv.shown) ||
              console.log(JSON.stringify(pv)),
          );
          const n = await open("&sessions=none", theme, "job", [width, height]);
          check(
            "sessions: with no Sessions column the project header stays and only the list under it goes",
            (n.headerKept && n.typeRows === 3) ||
              console.log(`header ${n.headerKept}, type rows ${n.typeRows}`),
          );
          // Back to the state the checks below read
          await open(`&name=${encodeURIComponent(title)}`, theme, "job", [
            width,
            height,
          ]);
        }
        check(
          `${name}: the name and the bar start 24px from the pane`,
          m.headLeft === 24 && m.barLeft === 24,
        );
        check(
          `${name}: the name as written at 30/600, the largest text, two lines at most, not cut`,
          m.name === title &&
            m.nameFont === "600 30px/36px" &&
            m.nameColor &&
            m.nameIsLargest &&
            m.nameLines <= 2 &&
            !m.nameCut,
        );
        check(
          `${name}: the name is one closed button for a listbox, its hover says how many jobs are open`,
          m.popup === "listbox" &&
            m.expanded === "false" &&
            m.nameTip.endsWith("Switch job (1 open)"),
        );
        check(
          `${name}: goal 15/400, pill and meta on the right`,
          m.goal === "400 15px/22px" &&
            m.goalText === view.head.goal &&
            m.pill === view.head.state.word &&
            m.meta === view.head.meta &&
            m.sideRight,
        );
        check(
          `${name}: the progress line: count 26/600, words 17/400, the model's words, the time on the right`,
          m.fig === "600 26px/30px" &&
            m.words === "400 17px/24px" &&
            m.line === pgLine(view) &&
            m.asof.endsWith(m.time) &&
            m.asofRight,
        );
        check(
          `${name}: the bar's parts in order with the model's counts and hover words, each as wide as its share`,
          (m.parts === partsLine(view) && m.shares) ||
            console.log(`${m.parts}\n${partsLine(view)}\n${m.shares}`),
        );
        check(
          `${name}: the folds start under the bar; the app's own list hidden`,
          m.foldsShown && m.foldsUnder && !m.tableShown,
        );
        check(
          `${name}: the first fold sits 28px under the bar, as in the mock-up`,
          m.foldsGap === 28 || console.log(`gap ${m.foldsGap}px`),
        );
        plainText(name, m);
        check(`${name}: capped at 1200px`, m.width <= 1200);
        const f = await waitFor(page, foldsScript(), "the four folds");
        console.log(
          `${name}: folds ${f.heads} · orbs ${f.orbs} · Needs you words ${f.contrast.toFixed(2)}:1`,
        );
        check(
          `${name}: four folds top to bottom, Needs you, Running, To do, Done, each count foldsOf's`,
          f.heads ===
            fv.map((x) => `${x.key}:${x.word}:${x.count}`).join(" / ") &&
            f.topDown,
        );
        check(
          `${name}: Done closed at start, the other three open; headings 16/600`,
          f.open === "true,true,true,false" && f.headFont === "600 16px/22px",
        );
        check(
          `${name}: each open fold's rows in the model's order, none of Done's`,
          f.rows === [...fv.slice(0, 3).map(foldIds), ""].join(" / ") ||
            console.log(f.rows),
        );
        check(
          `${name}: one line per row; titles 500 in Needs you, 400 elsewhere`,
          f.oneLine && f.titleFonts === "500,400",
        );
        check(
          `${name}: S20 and S21 in To do, half-filled rings; S20's session ended two hours ago and says so with its time, S21 has no session`,
          /^todo half session ended (\d\d:\d\d|\d{1,2} \w{3} \d\d:\d\d), step not done\|todo half started, no session on it$/.test(
            f.started,
          ) || console.log(f.started),
        );
        check(
          `${name}: session links on S18, S19 and S20 while Done is closed; the running orbs from the last tools`,
          f.sessions ===
            "t-18:Open session,t-19:Open session,t-20:Open session" &&
            f.orbs === "composing,solving",
        );
        check(
          `${name}: S22 has its underlined file link`,
          f.file === "Open settings-review.md|underline",
        );
        if (theme === "ink-bone")
          check(
            `${name}: the Needs you words read 4.5:1 or more on its tint`,
            f.contrast >= 4.5,
          );
        await itemChecks(page, name, out);
        const label = await waitFor(
          page,
          `(() => { const e = document.querySelector('.tracker-links-line[data-rt-label="job"] > .w-28');
            return e && getComputedStyle(e, "::before").content; })()`,
          "the job link's label",
        );
        check(
          `${name}: item view, the link to the job reads "In job"`,
          label === '"In job"',
        );
        if (width !== 1920) continue;
        // The picker opens under the name: All open first, the open jobs, Not in a job, then Finished below
        await click(".rt-name");
        const pk = await waitFor(page, pickerScript(), "the open picker");
        const pkFile = await shoot(`${theme}-picker.png`);
        console.log(`${theme}-picker: ${pk.order} · ${pkFile}`);
        check(
          `${theme}-picker: open under the name, the name says so`,
          pk.expanded === "true" && pk.under,
        );
        check(
          `${theme}-picker: All open first, the open jobs, Not in a job, then Finished below, top to bottom; the jobs released or cancelled 3 days ago left out`,
          pk.order === pickerOrder(archivedNow) && pk.topDown,
        );
        // All open from the picker; then the job back through the picker
        await click('.rt-picker [data-pick="all"]');
        const all = await waitFor(page, measureScript("all"), "All open");
        check(
          `${name}: a click on All open shows each open job and closes the picker`,
          all.name === mainAll.head.name &&
            all.jobs === mainAll.jobs.map((j) => j.id).join(",") &&
            all.expanded === "false" &&
            !all.tableShown,
        );
        await click(".rt-name");
        await waitFor(page, pickerScript(), "the picker again");
        await click('.rt-picker [data-pick="rel-1"]');
        const back = await waitFor(page, measureScript("job"), "the job back");
        check(
          `${name}: a click on the job in the picker brings it back with its folds`,
          back.name === title &&
            back.expanded === "false" &&
            back.foldsShown &&
            back.foldsUnder,
        );
        await waitFor(page, foldsScript(), "the four folds again");
        // A click while a slow read runs is drawn at once (the app's session list took 20 s and the picker looked
        // dead, 2026-11-19): the picker opens and closes within a second while the 6 s read is still under way
        await page.send("Runtime.evaluate", {
          expression: "window.fxSlowList = 6000; window.fxChange()",
        });
        await new Promise((ok) => setTimeout(ok, 300));
        const slowAt = Date.now();
        await click(".rt-name");
        await waitFor(page, pickerScript(), "the picker during a slow read");
        await click(".rt-name");
        await waitFor(
          page,
          `document.querySelector(".rt-picker").hidden`,
          "the picker closed during a slow read",
        );
        const slowMs = Date.now() - slowAt;
        check(
          `${name}: during a 6 s read the picker opens and closes at once (${slowMs} ms)`,
          slowMs < 1500,
        );
        await page.send("Runtime.evaluate", {
          expression: "window.fxSlowList = 0",
        });
        await new Promise((ok) => setTimeout(ok, 6000));
        // A click on Done's heading opens it: its 18 rows, the finished session's link on S15; a second click closes it
        await click(".rt-fold-done .rt-fold-head");
        const done = await waitFor(page, doneScript(true), "Done open");
        await shoot(`${name}-done-open.png`);
        check(
          `${name}: a click opens Done: its ${fv[3].count} rows shown`,
          done.rows === fv[3].count,
        );
        check(
          `${name}: session links only on S18, S19, S20 and S15`,
          done.sessions === "t-18,t-19,t-20,t-15",
        );
        await click(".rt-fold-done .rt-fold-head");
        const closed = await waitFor(page, doneScript(false), "Done closed");
        check(`${name}: a second click closes Done`, closed.rows === 0);
        // Keys (design 3.3): each draw makes a new section, so the focused control must be found again in it
        const key = async (k, code, text) => {
          for (const type of ["keyDown", "keyUp"])
            await page.send("Input.dispatchKeyEvent", {
              type,
              key: k,
              code: k,
              windowsVirtualKeyCode: code,
              ...(type === "keyDown" && text ? { text } : {}),
            });
        };
        const focused = (selector) =>
          `(() => { const a = document.activeElement;
            return a && a.isConnected && a.matches(${JSON.stringify(selector)}) && a.getAttribute("aria-expanded"); })()`;
        await page.send("Runtime.evaluate", {
          expression: `document.querySelector(".rt-fold-done .rt-fold-head").focus()`,
        });
        await key("Enter", 13, "\r");
        await waitFor(page, doneScript(true), "Done open by Enter");
        check(
          `${name}: Enter on Done's heading opens it and the heading keeps the focus`,
          (await waitFor(
            page,
            focused(".rt-fold-done .rt-fold-head"),
            "the focus on Done's heading",
          )) === "true",
        );
        await key("Enter", 13, "\r");
        await waitFor(page, doneScript(false), "Done closed by Enter");
        // The picker by keys: Enter on the name opens it, an arrow moves into it, Esc closes it and the name has the focus
        await page.send("Runtime.evaluate", {
          expression: `document.querySelector(".rt-name").focus()`,
        });
        await key("Enter", 13, "\r");
        await waitFor(page, pickerScript(), "the picker by Enter");
        await key("ArrowDown", 40);
        const onAll = await waitFor(
          page,
          `document.activeElement.isConnected && document.activeElement.dataset.pick`,
          "the focus in the picker",
        );
        // A session change while the picker is open redraws it without its fade-in
        await page.send("Runtime.evaluate", {
          expression: `window.fxOldPicker = document.querySelector(".rt-picker"); fxSessionTool("s-2", { toolName: "Read", arguments: {} })`,
        });
        const redrawnPicker = await waitFor(
          page,
          `(() => { const p = document.querySelector(".rt-picker");
            return p && p !== window.fxOldPicker && !p.hidden &&
              { fade: p.classList.contains("rt-picker-fade"), anims: p.getAnimations().length, focus: document.activeElement.dataset.pick }; })()`,
          "the picker redrawn",
        );
        check(
          `${name}: a redraw while the picker is open neither fades it in again nor moves the focus`,
          !redrawnPicker.fade &&
            redrawnPicker.anims === 0 &&
            redrawnPicker.focus === "all",
        );
        await key("Escape", 27);
        const escaped = await waitFor(
          page,
          `(() => { const p = document.querySelector(".rt-picker"); return p && p.hidden && ${focused(".rt-name")}; })()`,
          "the picker closed by Esc",
        );
        check(
          `${name}: arrow down moves into the picker; Esc closes it and the name has the focus`,
          onAll === "all" && escaped === "false",
        );
        // The three ways out of a row (one-page proofs): its file, its session, the item view
        const calls = async (selector, what) => {
          await page.send("Runtime.evaluate", {
            expression: `window.fxCalls.length = 0`,
          });
          await click(selector);
          return waitFor(
            page,
            `window.fxCalls.length && JSON.stringify(window.fxCalls)`,
            what,
          );
        };
        check(
          `${name}: S22's file link calls workspace:open-file with the file under the project, not the item view`,
          (await calls(
            '.rt-row[data-step="t-22"] .rt-file',
            "the open-file call",
          )) ===
            JSON.stringify([
              {
                channel: "workspace:open-file",
                workspacePath: "/fixture-project",
                filePath: "/fixture-project/docs/mockups/settings-review.md",
              },
            ]),
        );
        check(
          `${name}: S20's session link (not in the Sessions column) fires open-ai-session with its session, not the item view`,
          (await calls(
            '.rt-row[data-step="t-20"] .rt-session',
            "the open-session event",
          )) ===
            JSON.stringify([
              {
                channel: "open-ai-session",
                sessionId: "s-3",
                workspacePath: "/fixture-project",
              },
            ]),
        );
        check(
          `${name}: a click on a row opens its item view`,
          (await calls('.rt-row[data-step="t-23"]', "the open-item event")) ===
            JSON.stringify([
              { channel: "nimbalyst:navigate-tracker-item", itemId: "t-23" },
            ]),
        );
        // A new last tool: S18's orb and words follow
        await page.send("Runtime.evaluate", {
          expression: `fxSessionTool("s-1", { toolName: "Grep", arguments: {} })`,
        });
        const redrawn = await waitFor(
          page,
          `(() => { const r = document.querySelector('.rt-row[data-step="t-18"]');
            return r && r.querySelector('canvas[data-orb="searching"]') && r.querySelector(".rt-wait").textContent; })()`,
          "S18 with its new last tool",
        );
        check(
          `${name}: a new last tool redraws S18's orb and words`,
          redrawn.startsWith("searching files · since "),
        );
        // A step the app adds later lands in To do once the data watcher hears of it
        await page.send("Runtime.evaluate", {
          expression: `fxAddStep(${JSON.stringify({
            id: "t-40",
            type: "task",
            title: "A step added later",
            status: "to-do",
            archived: false,
            updated: "2026-11-13T17:00:00",
            customFields: { step: "S40", collection: [{ itemId: "rel-1" }] },
          })}, false)`,
        });
        const added = await waitFor(
          page,
          `(() => { const r = document.querySelector('.rt-row[data-step="t-40"]');
            return r && r.closest(".rt-fold").dataset.fold + " " + r.closest(".rt-fold").querySelector(".rt-count").textContent; })()`,
          "the step added later",
        );
        check(
          `${name}: a step added later lands in To do, its count one up`,
          added === `todo ${fv[2].count + 1}`,
        );
        // The Mark done button through the page (index.js markDone): a failed save keeps the row and says why; a
        // save that goes through moves the row to Done
        const doneState = `(() => { const r = document.querySelector('.rt-row[data-step="t-27"]');
          return r && r.closest(".rt-fold").dataset.fold + " | " + r.querySelector(".rt-wait").textContent; })()`;
        await page.send("Runtime.evaluate", {
          expression: "window.fxFailWrites = true",
        });
        await click('.rt-row[data-step="t-27"] .rt-done-button');
        const kept = await waitFor(
          page,
          `(() => { const s = ${doneState}; return s && s.includes("Not marked") && s; })()`,
          "the failed Mark done",
        );
        check(
          `${name}: Mark done with a failed save keeps the row in Needs you and says the tracker did not save it`,
          kept ===
            "needs | Not marked done: the tracker did not save it (the database is locked)" ||
            console.log(kept),
        );
        await page.send("Runtime.evaluate", {
          expression: "window.fxFailWrites = false",
        });
        await click('.rt-row[data-step="t-27"] .rt-done-button');
        const moved = await waitFor(
          page,
          `(() => { const s = ${doneState}; return s && s.startsWith("done") && s; })()`,
          "the row in Done after Mark done",
        );
        check(
          `${name}: Mark done with a save that goes through moves the row to Done`,
          moved.startsWith("done | ") || console.log(moved),
        );
      }

      // A name too long for one line at 1920 wraps to two; the picker opens under its second line, not over it
      {
        const m = await open(
          `&name=${encodeURIComponent(twoLineName)}`,
          theme,
          "job",
        );
        await click(".rt-name");
        const pk = await waitFor(
          page,
          pickerScript(),
          "the picker under a long name",
        );
        const file = await shoot(`${theme}-picker-long-name.png`);
        console.log(
          `${theme}-picker-long-name: ${m.nameLines} line(s) · ${file}`,
        );
        check(
          `${theme}-picker-long-name: the name in two lines at 1920, the picker under it`,
          m.nameLines === 2 && pk.expanded === "true" && pk.under,
        );
      }

      // All open on the made-up jobs (design 3.9), reached through the picker; a click on a job's line opens it
      await open("&data=jobs", theme, "job");
      const bug = await waitFor(
        page,
        `(() => { const r = document.querySelector('.rt-row[data-step="bug-1"]'); const t = r && r.querySelector(".rt-chip-bug");
          return t && t.getClientRects().length && r.closest(".rt-fold").dataset.fold + " " + t.textContent; })()`,
        "the bug row",
      );
      check(
        `${theme}-jobs: the bug row in To do shows "Bug"`,
        bug === "todo Bug",
      );
      await click(".rt-name");
      await waitFor(page, pickerScript(), "the jobs' picker");
      await click('.rt-picker [data-pick="all"]');
      const all = await waitFor(page, measureScript("all"), "All open");
      const allFile = await shoot(`${theme}-all-open.png`);
      console.log(`${theme}-all-open: ${all.jobs} · ${all.needs} · ${allFile}`);
      noErrors(`${theme}-all-open`);
      // As the page reads it: the cancelled Spring menu is archived, and its open step shows under Not in a job
      const oldIds = new Set(
        oldClosedJobs(jobItems, Date.now()).map((j) => j.id),
      );
      const pagedAll = pageView(
        STRINGS,
        jobItems.map((i) => (oldIds.has(i.id) ? { ...i, archived: true } : i)),
        working,
        "all",
        at,
        "p",
      );
      check(
        `${theme}-all-open: one line per open job with its needs-you words, no bar, the list hidden`,
        all.name === allView.head.name &&
          all.meta.startsWith("3 open · as of ") &&
          all.jobs === pagedAll.jobs.map((j) => j.id).join(",") &&
          all.needs === pagedAll.jobs.map((j) => j.needs || "").join(",") &&
          all.parts === "" &&
          !all.tableShown &&
          !all.foldsShown,
      );
      plainText(`${theme}-all-open`, all);
      await click('.rt-job-row[data-pick="j-search"]');
      const opened = await waitFor(page, measureScript("job"), "the job");
      check(
        `${theme}-all-open: a click on a job's line opens the job`,
        opened.name === jobsView.picker.open[0].name && opened.foldsShown,
      );

      // The session states (close approach, Proofs): s-1 waits on the user, s-2 had no change for two days (and the
      // app's state says "error"), s-3 ended two hours ago
      await open("&states=1", theme, "job");
      const st = await waitFor(page, foldsScript(), "the four folds");
      const stFile = await shoot(`${theme}-session-states.png`);
      console.log(`${theme}-session-states: ${st.states} · ${stFile}`);
      noErrors(`${theme}-session-states`);
      const stamp = "(\\d\\d:\\d\\d|\\d{1,2} \\w{3} \\d\\d:\\d\\d)";
      check(
        `${theme}-session-states: S18 (its session waits, not in the running ids) in Needs you with the listening orb and "needs you" since it began to wait, S19 says "no change since" its day and hour, S20 "session ended", its time and "step not done"`,
        new RegExp(
          "^t-18 needs listening ~ needs you · since \\d\\d:\\d\\d ~ rt-wait rt-wait-attention \\| " +
            `t-19 running solving ~ no change since \\d{1,2} \\w{3} \\d\\d:\\d\\d ~ rt-wait rt-wait-attention \\| ` +
            `t-20 todo - ~ session ended ${stamp}, step not done ~ rt-wait rt-wait-attention$`,
        ).test(st.states) || console.log(st.states),
      );
      check(
        `${theme}-session-states: the attention words share the one warning tone; working words are plain text, links keep their own colour`,
        (st.tones.attention === st.tones.warning &&
          st.tones.attention !== st.tones.text &&
          st.tones.link !== st.tones.text) ||
          console.log(st.tones),
      );
      check(
        `${theme}-session-states: no row names an error, though the app's state of S19's session says "error"`,
        st.errorWords === "" || console.log(st.errorWords),
      );

      // No job (design 3.10): Not in a job, its progress over the loose items
      const none = await open("&data=no-job", theme, "none");
      const noneFile = await shoot(`${theme}-no-job.png`);
      console.log(
        `${theme}-no-job: "${none.name}" · ${none.line} · ${noneFile}`,
      );
      noErrors(`${theme}-no-job`);
      check(
        `${theme}-no-job: Not in a job as the name, the progress of the loose items, the folds under it`,
        none.name === noJobView.head.name &&
          none.line === pgLine(noJobView) &&
          none.parts === partsLine(noJobView) &&
          none.foldsShown &&
          none.foldsUnder &&
          !none.tableShown,
      );
      plainText(`${theme}-no-job`, none);

      // Empty (design 3.11): the title and one line, nothing else
      const empty = await open("&data=empty", theme, "empty");
      const emptyFile = await shoot(`${theme}-empty.png`);
      console.log(`${theme}-empty: "${empty.empty}" · ${emptyFile}`);
      noErrors(`${theme}-empty`);
      check(
        `${theme}-empty: "No jobs yet" and one line, no button, no bar, no list`,
        empty.empty === STRINGS.noJobs &&
          empty.lead === STRINGS.emptyLead &&
          empty.name === null &&
          empty.parts === "" &&
          !empty.tableShown &&
          !empty.foldsShown &&
          empty.emptyLeft === 24,
      );
      plainText(`${theme}-empty`, empty);

      // A step with a status the app does not have (S20, read on the first read): the page says what failed in one
      // line, the app's left column and list stay in view, and the console has the error too
      page.errors.length = 0;
      await page.send("Page.navigate", {
        url: `http://127.0.0.1:${port}/job-tracker/test/fixture.html?w=1920&bad=t-20#${theme}`,
      });
      let bad = null;
      for (let t = 0; t < 100 && !bad; t++) {
        const r = await page.send("Runtime.evaluate", {
          expression: `(() => { const e = document.querySelector(".rt-root.rt-error");
            if (!location.search.includes("bad=") || !e) return null;
            const side = document.querySelector(".tracker-sidebar");
            const table = document.querySelector(".tracker-table-container");
            return { text: e.textContent, ours: document.querySelectorAll(".rt-root").length,
              side: side.getClientRects().length > 0 && !document.querySelector(".rt-left-hidden"),
              table: table.getClientRects().length > 0, rows: table.querySelectorAll(".tracker-table-row").length }; })()`,
          returnByValue: true,
        });
        bad = r.result.value;
        if (!bad) await new Promise((ok) => setTimeout(ok, 100));
      }
      const badFile = await shoot(`${theme}-bad-status.png`);
      console.log(`${theme}-bad-status: ${bad && bad.text} · ${badFile}`);
      check(
        `${theme}-bad-status: the page says which step has an unknown status`,
        !!bad &&
          bad.text ===
            'The job page could not be drawn. Unknown step status "someday" on "Restyle the privacy mock-up". The tracker\'s own list is below.',
      );
      check(
        `${theme}-bad-status: the app's left column and list stay in view, the error line is all of ours`,
        !!bad && bad.side && bad.table && bad.rows > 0 && bad.ours === 1,
      );
      check(
        `${theme}-bad-status: the console has the error too`,
        page.errors.some((e) => e.includes('unknown step status "someday"')),
      );
      page.errors.length = 0;
    }
    await chatChecks(page, port, open, shoot, noErrors);
    await chatWidthChecks(page, open, shoot, noErrors, plainText);
    await itemChatChecks(page, open, shoot, noErrors);
    page.close();
  } finally {
    chrome.kill();
    server.close();
    await new Promise((ok) => setTimeout(ok, 500));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5 });
  }
}

/**
 * The session's chat beside the page (tracker chat design, sections 3, 4, 8 and 10), at 1920 in Ink Aurora: the
 * Sessions view's chat column moved onto the page and home again, its home's guard, no session open, and a column
 * that is missing while a session is open. `open`, `shoot` and `noErrors` are pictures()'s own.
 */
async function chatChecks(page, port, open, shoot, noErrors) {
  const run = async (expression) =>
    (
      await page.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
  const wait = "await new Promise((ok) => setTimeout(ok, 300));";
  // Where the chat column stands, and what stands with it
  const where = `(() => {
    const row = document.querySelector(".tracker-mode");
    const col = document.getElementById("fx-chat");
    const r = col && col.getBoundingClientRect();
    return {
      last: !!col && row.lastElementChild === col,
      shown: !!r && r.width > 0 && r.height > 0 && r.left >= 0 && r.right <= innerWidth + 1,
      home: !!col && col.parentElement === document.getElementById("fx-chat-home"),
      next: !!col && col.nextElementSibling === document.getElementById("fx-chat-next"),
      style: col && col.getAttribute("style"),
      columns: document.querySelectorAll(".agent-workstream-session-area").length,
      empty: !!document.querySelector(".rt-chat-empty"),
      page: !!document.querySelector(".rt-root") &&
        !document.querySelector('[data-layout="tracker-mode-wrapper"]').classList.contains("hidden"),
    }; })()`;
  const settled = `(async () => { ${wait} return ${where}; })()`;

  // The stored choice to hide the chat keeps the column home (the other states' fixture)
  await open("", "ink-aurora", "job");
  const hidden = await run(settled);
  check(
    "chat: the stored hidden choice keeps the chat column home",
    (hidden.home && hidden.next && !hidden.last && !hidden.empty) ||
      console.log(JSON.stringify(hidden)),
  );

  // The move: the column is the tracker row's last child, on screen
  await open("&chat=on", "ink-aurora", "job");
  const on = await run(settled);
  const onFile = await shoot("ink-aurora-chat-on.png");
  console.log(`chat-on: ${JSON.stringify(on)} · ${onFile}`);
  check(
    "chat: with a session open its chat column is the last child of the tracker row, on screen, the page beside it",
    (on.page && on.last && on.shown && on.columns === 1 && !on.empty) ||
      console.log(JSON.stringify(on)),
  );
  // A draft typed in its box stays through a redraw of the page (the column is moved, never copied)
  const typed = await run(`(async () => {
    const box = document.querySelector('[data-testid="agent-mode-chat-input"]');
    box.focus();
    box.value = "a draft kept across redraws";
    box.dispatchEvent(new Event("input", { bubbles: true }));
    window.fxSessionTool("s-1", { toolName: "Grep", arguments: {} });
    ${wait}
    const again = document.querySelector('[data-testid="agent-mode-chat-input"]');
    return { same: again === box, value: again.value,
      onPage: document.querySelector(".tracker-mode").contains(again) }; })()`);
  check(
    "chat: text typed in the chat's box stays through a redraw of the page",
    (typed.same &&
      typed.value === "a draft kept across redraws" &&
      typed.onPage) ||
      console.log(JSON.stringify(typed)),
  );
  // A click on another Sessions row: the app changes the session in the column; the page and the column stay
  const picked = await run(`(async () => {
    document.getElementById("session-list-item-s-2").click();
    ${wait}
    return { ...${where}, current: document.getElementById("session-list-item-s-2").getAttribute("aria-current"),
      title: document.getElementById("fx-chat-title").textContent }; })()`);
  check(
    "chat: a click on another Sessions row shows that session in the column; the page and the column stay",
    (picked.page &&
      picked.last &&
      picked.shown &&
      picked.current === "page" &&
      picked.title === "Set up the project") ||
      console.log(JSON.stringify(picked)),
  );
  // Three rounds of leaving and reopening the tracker: home at once, on the page again; it ends home
  const rounds = await run(`(async () => {
    const wrap = document.querySelector('[data-layout="tracker-mode-wrapper"]');
    const out = [];
    for (let i = 0; i < 3; i++) {
      window.fxLeave();
      await Promise.resolve();
      const away = ${where};
      wrap.classList.remove("hidden");
      ${wait}
      const back = ${where};
      out.push(away.home && away.next && away.style === "grid-area: 4 / 1;" && back.last && back.shown);
    }
    window.fxLeave();
    await Promise.resolve();
    const end = ${where};
    wrap.classList.remove("hidden");
    ${wait}
    return { out, end }; })()`);
  check(
    "chat: three rounds of leaving and reopening: home at once before its old next sibling with grid-area: 4 / 1; back, one column in the page",
    (rounds.out.length === 3 &&
      rounds.out.every(Boolean) &&
      rounds.end.home &&
      rounds.end.next &&
      rounds.end.style === "grid-area: 4 / 1;" &&
      rounds.end.columns === 1) ||
      console.log(JSON.stringify(rounds)),
  );
  noErrors("chat-rounds");
  // The guard: React inserting before the moved column, or removing it, while it is away never throws; after an
  // insert it comes back to the page on the next sync; after a removal (the session closed) the panel shows
  const g = await run(`(async () => {
    const home = document.getElementById("fx-chat-home");
    const col = document.getElementById("fx-chat");
    const out = { away: col.parentElement !== home };
    const i = document.createElement("i");
    try { home.insertBefore(i, col); out.insert = "ok"; } catch (e) { out.insert = String(e); }
    out.homeStyle = col.getAttribute("style");
    i.remove();
    ${wait}
    out.again = document.querySelector(".tracker-mode").lastElementChild === col;
    for (const r of document.querySelectorAll('[data-testid="session-list-item"]')) r.removeAttribute("aria-current");
    try { home.removeChild(col); out.remove = "ok"; } catch (e) { out.remove = String(e); }
    ${wait}
    out.gone = !col.isConnected;
    out.empty = document.querySelector(".tracker-mode").lastElementChild === document.querySelector(".rt-chat-empty");
    return out; })()`);
  check(
    "chat: a React insert before the moved column, or its removal, while it is away does not throw",
    (g.away &&
      g.insert === "ok" &&
      g.homeStyle === "grid-area: 4 / 1;" &&
      g.again &&
      g.remove === "ok" &&
      g.gone &&
      g.empty) ||
      console.log(JSON.stringify(g)),
  );
  noErrors("chat-guard");

  // No session open: the quiet two-line panel at the chat's place; a row pick puts the column in
  await open("&chat=none", "ink-aurora", "job");
  const none = await run(`(async () => { ${wait}
    const p = document.querySelector(".rt-chat-empty");
    const r = p && p.getBoundingClientRect();
    return { last: !!p && document.querySelector(".tracker-mode").lastElementChild === p,
      shown: !!r && r.width > 0 && r.right <= innerWidth + 1,
      lines: p ? [...p.children].map((e) => e.textContent).join("|") : "",
      column: !!document.getElementById("fx-chat") }; })()`);
  const noneFile = await shoot("ink-aurora-chat-none.png");
  console.log(`chat-none: ${JSON.stringify(none)} · ${noneFile}`);
  check(
    'chat: with no session open "No session open" and how to pick one stand at the chat\'s place',
    (none.last &&
      none.shown &&
      none.lines === `${STRINGS.chatEmpty}|${STRINGS.chatEmptyLead}` &&
      !none.column) ||
      console.log(JSON.stringify(none)),
  );
  const pickedIn = await run(
    `(async () => { document.getElementById("session-list-item-s-1").click(); ${wait} return ${where}; })()`,
  );
  check(
    "chat: a row pick with no session open puts the column in, in place of the panel",
    (pickedIn.last &&
      pickedIn.shown &&
      !pickedIn.empty &&
      pickedIn.columns === 1) ||
      console.log(JSON.stringify(pickedIn)),
  );
  noErrors("chat-none");

  // A session open but no chat column where the page looks (a renamed app): one error, no panel, no made-up chat
  page.errors.length = 0;
  await page.send("Page.navigate", {
    url: `http://127.0.0.1:${port}/job-tracker/test/fixture.html?w=1920&chat=missing#ink-aurora`,
  });
  let miss = null;
  for (let t = 0; t < 100 && !miss; t++) {
    miss = await run(`(async () => {
      if (!location.search.includes("chat=missing") || !document.querySelector(".rt-root .rt-name")) return null;
      ${wait}
      window.fxSessionTool("s-1", { toolName: "Grep", arguments: {} });
      ${wait}
      return { empty: !!document.querySelector(".rt-chat-empty"),
        lastIsPage: document.querySelector(".tracker-mode").lastElementChild.id === "fx-view" }; })()`);
    if (!miss) await new Promise((ok) => setTimeout(ok, 100));
  }
  const said = page.errors.filter((e) =>
    e.includes("job-tracker: no chat column to show beside the tracker"),
  );
  check(
    "chat: a session open with no chat column logs one error and shows no panel",
    (!!miss &&
      said.length === 1 &&
      page.errors.length === 1 &&
      !miss.empty &&
      miss.lastIsPage) ||
      console.log(JSON.stringify({ miss, errors: page.errors })),
  );
  page.errors.length = 0;
}

/**
 * The chat's width, its handle and the Chat button (tracker chat design, sections 1, 2 and 7), in the live app's frame
 * (?frame=live: rails 118 px, Sessions column 297 px, no item open) at 1600, 1280 and 1100 wide, in Ink Aurora.
 * Pictures chat-1600.png, chat-1280.png and chat-1100.png. `open`, `shoot`, `noErrors` and `plainText` are
 * pictures()'s own.
 */
async function chatWidthChecks(page, open, shoot, noErrors, plainText) {
  const run = async (expression) =>
    (
      await page.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
  const wait = "await new Promise((ok) => setTimeout(ok, 300));";
  // The chat's and the page's widths, the handle, the Chat button, the rows, and what is stored
  const sizes = `(() => {
    const box = (e) => e.getBoundingClientRect();
    const row = document.querySelector(".tracker-mode");
    const col = document.getElementById("fx-chat");
    const on = !!col && col.parentElement === row;
    const handle = document.querySelector(".rt-chat-handle");
    const btn = document.querySelector(".rt-chat-toggle");
    const rows = [...document.querySelectorAll(".rt-row")].filter((r) => r.getClientRects().length);
    const under = (r) => box(r.querySelector(".rt-row-right")).top >= box(r.querySelector(".rt-row-title")).bottom - 1;
    return {
      on,
      chat: on ? Math.round(box(col).width) : 0,
      page: Math.round(box(document.querySelector(".fx-page")).width),
      handle: !!handle && handle.nextElementSibling === col && handle.getAttribute("role") === "separator" &&
        handle.getAttribute("aria-orientation") === "vertical" ? Math.round(box(handle).width) : 0,
      hasHandle: !!handle,
      value: handle ? +handle.getAttribute("aria-valuenow") : null,
      pressed: btn ? btn.getAttribute("aria-pressed") : null,
      tip: btn ? btn.title : null,
      word: btn ? btn.textContent : null,
      rows: rows.length,
      twoLines: rows.length > 0 && rows.every(under),
      oneLine: rows.length > 0 && !rows.some(under),
      // The room a row's title has (its column; the title button itself is as wide as its text)
      title: rows.length ? Math.round(Math.min(...rows.map((r) => box(r.querySelector(".rt-row-main")).width))) : 0,
      stored: localStorage.getItem("job-tracker.chatWidth"),
      choice: localStorage.getItem("job-tracker.chatShown"),
    }; })()`;
  const settled = `(async () => { ${wait} return ${sizes}; })()`;
  const resize = (width) =>
    page.send("Emulation.setDeviceMetricsOverride", {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    });
  const mouse = (type, x, y, more = {}) =>
    page.send("Input.dispatchMouseEvent", {
      type,
      x,
      y,
      button: "left",
      ...more,
    });
  const handleAt = () =>
    run(`(() => { const r = document.querySelector(".rt-chat-handle").getBoundingClientRect();
      return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; })()`);
  const live = "&chat=on&frame=live";

  // The three window widths: chat 420, 340 and hidden; the page keeps 480; rows on two lines under a 640 px page,
  // and a row's title never squeezed under 200 px
  for (const [w, want] of [
    [1600, 420],
    [1280, 340],
    [1100, 0],
  ]) {
    const m = await open(live, "ink-aurora", "job", [w, 900]);
    const s = await run(settled);
    const file = await shoot(`chat-${w}.png`);
    console.log(`chat-${w}: ${JSON.stringify(s)} · ${file}`);
    plainText(`chat-${w}`, m);
    if (want) {
      check(
        `chat-${w}: the chat is ${want} px with the 6 px handle before it, the page at least 480 px`,
        (s.on &&
          s.chat === want &&
          s.handle === 6 &&
          s.value === want &&
          s.page >= 480) ||
          console.log(JSON.stringify(s)),
      );
      check(
        `chat-${w}: the Chat button is pressed and says what a click does`,
        (s.pressed === "true" &&
          s.word.endsWith(STRINGS.chatButton) &&
          s.tip === STRINGS.chatHide) ||
          console.log(JSON.stringify(s)),
      );
    } else {
      check(
        `chat-${w}: below a 1200 px window the chat starts hidden: the column is home, no handle, the button not pressed`,
        (!s.on &&
          !s.hasHandle &&
          s.pressed === "false" &&
          s.tip === STRINGS.chatShow) ||
          console.log(JSON.stringify(s)),
      );
    }
    check(
      `chat-${w}: rows on two lines where the page is under 640 px, and a row's title keeps at least 200 px`,
      ((s.page >= 640 || s.twoLines) && s.title >= 200) ||
        console.log(JSON.stringify(s)),
    );
    noErrors(`chat-${w}`);
  }

  // The live app's row (?wrap=app): the Sessions column shares the row's first child with the page, so it is not page.
  // At 1280 px the default 340 fits (1280 - 118 - 297 - 6 - 340 = 519); a drag to the left stops where the page is 480
  await open(`${live}&wrap=app`, "ink-aurora", "job", [1280, 900]);
  const wrapped = await run(settled);
  let at = await handleAt();
  await mouse("mouseMoved", at.x, at.y);
  await mouse("mousePressed", at.x, at.y, { buttons: 1, clickCount: 1 });
  await mouse("mouseMoved", at.x - 200, at.y, { buttons: 1 });
  await mouse("mouseReleased", at.x - 200, at.y, { buttons: 0, clickCount: 1 });
  const wrapDrag = await run(settled);
  check(
    "chat-row: in the app's own row the Sessions column is not counted as page: 340 at 1280, a drag stops with the page at 480",
    (wrapped.on &&
      wrapped.chat === 340 &&
      wrapped.page >= 480 &&
      wrapDrag.on &&
      wrapDrag.chat > 340 &&
      wrapDrag.page >= 479 &&
      wrapDrag.page <= 481) ||
      console.log(JSON.stringify({ wrapped, wrapDrag })),
  );
  noErrors("chat-row");

  // Mid-drag, a page change (a class flips, as the app does all the time) must not put the old width back under the
  // pointer: the column stays at the drag's width until the release
  await open(live, "ink-aurora", "job", [1600, 900]);
  await run(settled);
  at = await handleAt();
  await mouse("mouseMoved", at.x, at.y);
  await mouse("mousePressed", at.x, at.y, { buttons: 1, clickCount: 1 });
  await mouse("mouseMoved", at.x - 100, at.y, { buttons: 1 });
  const midDrag = await run(`(async () => {
    ${wait}
    document.body.classList.add("fx-flip");
    ${wait}
    document.body.classList.remove("fx-flip");
    ${wait}
    return ${sizes}; })()`);
  await mouse("mouseReleased", at.x - 100, at.y, {
    buttons: 0,
    clickCount: 1,
  });
  const afterMid = await run(settled);
  check(
    "chat-drag-hold: mid-drag a page change keeps the drag's width (420 + 100), and the release keeps it",
    (midDrag.chat === 520 &&
      afterMid.chat === 520 &&
      afterMid.stored === "520") ||
      console.log(JSON.stringify({ midDrag, afterMid })),
  );
  noErrors("chat-drag-hold");

  // The app's floating Phase pill (made here as the app draws it) gets its own band in the chat beside the page: the
  // transcript starts under it, so no row runs under the pill
  const band = await run(`(async () => {
    const col = document.getElementById("fx-chat");
    const wrap = document.createElement("div");
    wrap.className = "flex-1 overflow-hidden relative";
    wrap.style.cssText = "position: relative; height: 400px;";
    const actions = document.createElement("div");
    actions.className = "floating-transcript-actions";
    // The app's own one-class rules (Tailwind's absolute, right-3, top-1.5), not inline styles
    const appRules = document.createElement("style");
    appRules.textContent = ".fx-abs { position: absolute; display: flex; right: 12px; top: 6px; }";
    document.head.append(appRules);
    actions.classList.add("fx-abs");
    actions.innerHTML = '<button style="height: 36px">Implementing</button>';
    const view = document.createElement("div");
    view.className = "rich-transcript-view";
    view.style.cssText = "height: 100%; display: flex; flex-direction: column;";
    view.innerHTML = '<div class="fx-row" style="height: 30px">first row</div>';
    wrap.append(actions, view);
    col.append(wrap);
    ${wait}
    const a = actions.getBoundingClientRect();
    const r = view.firstElementChild.getBoundingClientRect();
    const out = { bandLeft: Math.round(a.left - wrap.getBoundingClientRect().left), bandWidth: Math.round(a.width),
      wrapWidth: Math.round(wrap.getBoundingClientRect().width), bandBottom: Math.round(a.bottom), rowTop: Math.round(r.top),
      bg: getComputedStyle(actions).backgroundColor };
    wrap.remove();
    appRules.remove();
    return out; })()`);
  check(
    "chat-band: in the chat beside the page the Phase pill's band spans the column with a background, and the first transcript row starts under it",
    (band.bandLeft === 0 &&
      band.bandWidth === band.wrapWidth &&
      band.rowTop >= band.bandBottom &&
      band.bg !== "rgba(0, 0, 0, 0)") ||
      console.log(JSON.stringify(band)),
  );

  // A drag to 700 stops at 640, or where the page reaches 480; the width is kept and back after a reload
  await open(live, "ink-aurora", "job", [1600, 900]);
  await run(settled);
  at = await handleAt();
  await mouse("mouseMoved", at.x, at.y);
  await mouse("mousePressed", at.x, at.y, { buttons: 1, clickCount: 1 });
  await mouse("mouseMoved", at.x - 140, at.y, { buttons: 1 });
  await mouse("mouseMoved", at.x - 280, at.y, { buttons: 1 });
  await mouse("mouseReleased", at.x - 280, at.y, { buttons: 0, clickCount: 1 });
  const dragged = await run(settled);
  check(
    "chat-drag: a drag to 700 px stops at 640 or where the page reaches 480; the width is kept",
    (dragged.on &&
      (dragged.chat === 640 || dragged.page === 480) &&
      dragged.value === dragged.chat &&
      dragged.stored === String(dragged.chat)) ||
      console.log(JSON.stringify(dragged)),
  );
  await open(`${live}&keep=1`, "ink-aurora", "job", [1600, 900]);
  const reloaded = await run(settled);
  check(
    "chat-drag: the dragged width is back after a reload",
    (reloaded.on && reloaded.chat === dragged.chat) ||
      console.log(JSON.stringify(reloaded)),
  );
  // A smaller window clamps the kept width without overwriting it; the old size gives it back
  await resize(1280);
  const small = await run(settled);
  await resize(1600);
  const big = await run(settled);
  check(
    "chat-drag: a smaller window clamps the kept width so the page keeps 480, the kept width stays; back at 1600 it returns",
    (small.on &&
      small.chat < dragged.chat &&
      small.chat >= 300 &&
      small.page >= 480 &&
      small.stored === dragged.stored &&
      big.chat === dragged.chat) ||
      console.log(JSON.stringify({ small, big })),
  );
  // Arrow keys move the handle 16 px; a double-click gives the default and forgets the kept width
  const keyed = await run(`(async () => {
    const h = document.querySelector(".rt-chat-handle");
    h.focus();
    h.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    ${wait}
    return ${sizes}; })()`);
  check(
    "chat-keys: an arrow key moves the handle 16 px",
    (keyed.chat === big.chat - 16 && keyed.stored === String(keyed.chat)) ||
      console.log(JSON.stringify(keyed)),
  );
  at = await handleAt();
  await mouse("mousePressed", at.x, at.y, { buttons: 1, clickCount: 1 });
  await mouse("mouseReleased", at.x, at.y, { buttons: 0, clickCount: 1 });
  await mouse("mousePressed", at.x, at.y, { buttons: 1, clickCount: 2 });
  await mouse("mouseReleased", at.x, at.y, { buttons: 0, clickCount: 2 });
  const reset = await run(settled);
  check(
    "chat-reset: a double-click on the handle gives the default width, 420 at 1600",
    (reset.chat === 420 && reset.stored === null) ||
      console.log(JSON.stringify(reset)),
  );
  noErrors("chat-drag");

  // The Chat button sends the column home and brings it back; the choice holds through a redraw and a reload
  const hid = await run(`(async () => {
    document.querySelector(".rt-chat-toggle").click();
    ${wait}
    window.fxSessionTool("s-1", { toolName: "Grep", arguments: {} });
    ${wait}
    const home = document.getElementById("fx-chat").parentElement === document.getElementById("fx-chat-home");
    return { ...${sizes}, home }; })()`);
  check(
    "chat-button: a click sends the column home, takes the handle away and is kept through a redraw",
    (hid.home &&
      !hid.on &&
      !hid.hasHandle &&
      hid.pressed === "false" &&
      hid.choice === "false") ||
      console.log(JSON.stringify(hid)),
  );
  await open(`${live}&keep=2`, "ink-aurora", "job", [1600, 900]);
  const still = await run(settled);
  check(
    "chat-button: the hidden choice holds after a reload",
    (!still.on && still.pressed === "false") ||
      console.log(JSON.stringify(still)),
  );
  const back = await run(`(async () => {
    document.querySelector(".rt-chat-toggle").click();
    ${wait}
    return ${sizes}; })()`);
  check(
    "chat-button: a second click brings the column back beside the page",
    (back.on &&
      back.chat === 420 &&
      back.handle === 6 &&
      back.pressed === "true" &&
      back.choice === "true") ||
      console.log(JSON.stringify(back)),
  );
  // Below 1200 px the user's choice to show the chat wins over the width default: 300 px
  await open(`${live}&keep=3`, "ink-aurora", "job", [1100, 900]);
  const shown = await run(settled);
  check(
    "chat-button: below 1200 px a chat the user showed stays shown, at 300 px",
    (shown.on && shown.chat === 300) || console.log(JSON.stringify(shown)),
  );
  noErrors("chat-button");
  await run(`localStorage.removeItem("job-tracker.chatShown")`);
}

/**
 * "Open session" and an opened item with the chat beside the page (tracker chat design, sections 5 and 6), in the
 * live app's frame in Ink Aurora: a listed session opens in the chat, an unlisted one in the Sessions view; an item
 * takes the list's place at 1600 and stands beside it at 2560; the full-page item's own chat is not shown while ours
 * is. Pictures chat-item-1600.png and chat-item-2560.png. `open`, `shoot` and `noErrors` are pictures()'s own.
 */
async function itemChatChecks(page, open, shoot, noErrors) {
  const run = async (expression) =>
    (
      await page.send("Runtime.evaluate", {
        expression,
        awaitPromise: true,
        returnByValue: true,
      })
    ).result.value;
  const wait = "await new Promise((ok) => setTimeout(ok, 300));";
  const live = "&chat=on&frame=live";
  const after = (script) =>
    run(`(async () => { ${script}; ${wait} return ${facts}; })()`);
  // The sessions: what the page sent the app, the current Sessions row, the chat's session, the links' hovers. The
  // item: its region in the item's row, the row's class, the list, our Back line and the list's scroll place.
  const facts = `(() => {
    const box = (e) => e.getBoundingClientRect();
    const view = document.getElementById("fx-view");
    const detail = document.getElementById("detail");
    const list = document.querySelector(".fx-page");
    const back = document.querySelector(".rt-item-back");
    const open = !!detail && detail.parentElement === view;
    const cur = document.querySelector('[data-testid="session-list-item"][aria-current="page"]');
    const shown = (sel) => { const e = document.querySelector(sel); return !!e && e.getClientRects().length > 0; };
    return {
      calls: window.fxCalls.filter((c) => c.channel === "open-ai-session").map((c) => c.sessionId),
      current: cur ? cur.id : null,
      chatTitle: document.getElementById("fx-chat-title").textContent,
      chatOn: document.getElementById("fx-chat").parentElement === document.querySelector(".tracker-mode"),
      page: !!document.querySelector(".rt-root") &&
        !document.querySelector('[data-layout="tracker-mode-wrapper"]').classList.contains("hidden"),
      tips: Object.fromEntries([...document.querySelectorAll(".rt-session")].map((b) => [b.dataset.session, b.title])),
      open,
      wide: view.classList.contains("rt-item-wide"),
      list: list.getClientRects().length ? Math.round(box(list).width) : 0,
      item: open ? Math.round(box(detail).width) : 0,
      row: Math.round(box(view).width),
      back: back ? (back.querySelector(".rt-item-back-label") || back).textContent : null,
      backAbove: !!back && back.nextElementSibling === detail && box(back).bottom <= box(detail).top + 1,
      scroll: document.querySelector(".fx-body").scrollTop,
      docChat: shown('[data-testid="tracker-document-right-panel"]'),
      docDrag: shown('[data-testid="tracker-document-right-panel-resize"]'),
      menu: [...document.querySelectorAll('[data-testid="window-top-bar-right-pane-menu"] [role="menuitem"]')]
        .filter((b) => b.getClientRects().length).map((b) => b.lastElementChild.textContent),
    }; })()`;
  const backWords = `${STRINGS.backTo}`.replace("{name}", release.title);

  // Open session: with the chat hidden, a listed session (s-2) is picked in the Sessions column, the chat comes back
  // with it, the page stays and the app gets no open-ai-session; an unlisted one (s-3) goes to the Sessions view
  await open(live, "ink-aurora", "job", [1600, 900]);
  const hid = await after(`document.querySelector(".rt-chat-toggle").click()`);
  const listed = await after(
    `document.querySelector('.rt-session[data-session="s-2"]').click()`,
  );
  check(
    "chat-open: Open session of a listed session marks its Sessions row current, shows the chat with it, the page stays, no open-ai-session",
    (!hid.chatOn &&
      listed.current === "session-list-item-s-2" &&
      listed.chatTitle === "Set up the project" &&
      listed.chatOn &&
      listed.page &&
      listed.calls.length === 0) ||
      console.log(JSON.stringify(listed)),
  );
  const unlisted = await after(
    `document.querySelector('.rt-session[data-session="s-3"]').click()`,
  );
  check(
    'chat-open: an unlisted session sends open-ai-session and its hover says "Opens in the Sessions view"; a listed one\'s does not',
    (unlisted.calls.join() === "s-3" &&
      unlisted.tips["s-3"].endsWith("\nOpens in the Sessions view") &&
      !unlisted.tips["s-2"].includes("Sessions view")) ||
      console.log(JSON.stringify(unlisted)),
  );
  const done = await after(
    `document.querySelector('[data-fold="done"] .rt-fold-head').click()`,
  );
  const doneSent = await after(
    `document.querySelector('.rt-session[data-session="s-4"]').click()`,
  );
  check(
    "chat-open: a Done row's session link does the same: its unlisted session goes to the Sessions view, with the hover",
    ((done.tips["s-4"] || "").endsWith("\nOpens in the Sessions view") &&
      doneSent.calls.join() === "s-3,s-4") ||
      console.log(JSON.stringify(doneSent)),
  );
  noErrors("chat-open");

  // At 1600 the list would keep 759 - 400 = 359 px: the item takes its place, with the Back line; Back closes it the
  // app's way and shows the list at the scroll place it had (a second query, so the page loads anew)
  await open(`${live}&n=2`, "ink-aurora", "job", [1600, 900]);
  const scrolled = await after(`
    document.querySelector('[data-fold="done"] .rt-fold-head').click();
    ${wait}
    document.querySelector(".fx-body").scrollTop = 240`);
  const wide = await after(
    `document.querySelector('.rt-row[data-step="t-22"]').click()`,
  );
  const file1600 = await shoot("chat-item-1600.png");
  console.log(`chat-item-1600: ${JSON.stringify(wide)} · ${file1600}`);
  check(
    `chat-item-1600: a row click opens the item in the list's place, filling the row, under "${backWords}"`,
    (wide.open &&
      wide.wide &&
      wide.list === 0 &&
      wide.item === wide.row &&
      wide.back === backWords &&
      wide.backAbove &&
      wide.chatOn) ||
      console.log(JSON.stringify(wide)),
  );
  const closed = await after(
    `document.querySelector(".rt-item-back button")?.click()`,
  );
  check(
    "chat-item-1600: Back closes the item the app's way and shows the list at the same scroll place",
    (scrolled.scroll > 0 &&
      !closed.open &&
      !closed.wide &&
      !closed.back &&
      closed.list === closed.row &&
      closed.scroll === scrolled.scroll) ||
      console.log(JSON.stringify({ scrolled: scrolled.scroll, closed })),
  );
  // The chat hidden gives the list room (1185 - 400 px): the item goes beside it; the chat back, in its place again
  await after(`document.querySelector('.rt-row[data-step="t-22"]').click()`);
  const roomy = await after(
    `document.querySelector(".rt-chat-toggle").click()`,
  );
  const narrow = await after(
    `document.querySelector(".rt-chat-toggle").click()`,
  );
  check(
    "chat-item-1600: the rule is checked again on a size change: chat hidden, the item beside the list; chat back, in its place",
    (roomy.open &&
      !roomy.wide &&
      roomy.list >= 440 &&
      roomy.item === 400 &&
      !roomy.back &&
      narrow.wide &&
      narrow.list === 0) ||
      console.log(JSON.stringify({ roomy, narrow })),
  );
  noErrors("chat-item-1600");

  // At 2560 the list keeps 1719 - 400 px: the item opens beside it, no Back line
  await open(live, "ink-aurora", "job", [2560, 900]);
  const beside = await after(
    `document.querySelector('.rt-row[data-step="t-22"]').click()`,
  );
  const file2560 = await shoot("chat-item-2560.png");
  console.log(`chat-item-2560: ${JSON.stringify(beside)} · ${file2560}`);
  check(
    "chat-item-2560: a row click opens the item beside the list, at the app's width, no Back line",
    (beside.open &&
      !beside.wide &&
      beside.item === 400 &&
      beside.list >= 440 &&
      !beside.back &&
      beside.chatOn) ||
      console.log(JSON.stringify(beside)),
  );
  noErrors("chat-item-2560");

  // One chat on screen: while our chat stands, the full-page item's chat panel, its drag line and the top bar's
  // "Chat about this item" option are not shown; with our chat hidden they are back
  const one = await after(`window.fxOpenDocument()`);
  const two = await after(`document.querySelector(".rt-chat-toggle").click()`);
  check(
    "chat-one: while the chat column is on the page, the item's own chat panel, its room and its top bar option are not shown",
    (one.chatOn &&
      !one.docChat &&
      !one.docDrag &&
      one.menu.join() === "Discussion") ||
      console.log(JSON.stringify(one)),
  );
  check(
    "chat-one: with the chat hidden, the item's own chat panel and its option are back",
    (!two.chatOn &&
      two.docChat &&
      two.docDrag &&
      two.menu.join() === "Chat about this item,Discussion") ||
      console.log(JSON.stringify(two)),
  );
  noErrors("chat-one");
  await run(`localStorage.removeItem("job-tracker.chatShown")`);
}

// The item view's 33 parts (tracker design, "Item view, second round"), each part's verdict as one check (a function,
// as pictures() runs before this line is reached)
function itemParts() {
  return [
    "type icon kept at 18",
    "title kept at 16/600",
    "type chip restyled: no fill, one meta line Task · key",
    "source badge hidden",
    "item key restyled: 13px mono, muted, tooltip kept",
    "Published chip hidden",
    "archive and full-screen folded: shown with the pointer, space kept",
    "delete folded the same, red on hover",
    "close kept, 28 square",
    "body restyled: one column, 16 apart, in the design's order",
    "Sessions heading restyled: 13/600, sentence case",
    "first linked session filled, full width, 32 high; the next one quiet",
    "No linked sessions line hidden",
    "Launch Session filled with no session, else a quiet icon button",
    "Link Existing and Launch Worktree folded: 28px icons shown with the pointer",
    "status restyled: first, no frame, in its state tone, icon 16",
    "priority hidden while Medium, shown as text otherwise",
    "step and stage restyled: text on the status line",
    "budget restyled: 20 calls at the line's right end",
    "waits on and proof restyled: a second line, Waits on: named",
    "set link pills folded behind More fields",
    "empty pills folded behind one quiet More fields pill",
    "tags folded while empty",
    "type tags folded",
    "Content heading hidden",
    "text box restyled: surface-1, no border, text 12px in, 15px, empty one line high",
    "drag handle hidden",
    "Links group kept: heading 13/600, targets 14, chevron icon",
    "Comments heading hidden",
    "comment field restyled: 32 high, radius 6, hairline",
    "Post restyled: quiet, only with focus or text",
    "activity folded behind History and details · 3",
    "Created by block folded in the same fold, chips without fill",
  ];
}

/**
 * The item view in its two states (linked sessions; none), with the folds open, with the pointer over the header and
 * over the sessions group, and with the design's fallback switch: a check per part, exactly one filled button in each
 * state, no cut text, text at 16/15/14/13 only (icons aside). Pictures of the view with and without a session, and
 * with its folds open.
 */
async function itemChecks(page, name, out) {
  const run = (expression) =>
    page.send("Runtime.evaluate", { expression, returnByValue: true });
  const D = `document.querySelector('[data-testid="tracker-item-detail"]')`;
  const shot = async (file) => {
    const box = await waitFor(
      page,
      `(() => { const r = document.querySelector('[data-testid="tracker-detail-region"]').getBoundingClientRect();
        return { x: r.left, y: r.top, width: r.width, height: r.height }; })()`,
    );
    const s = await page.send("Page.captureScreenshot", {
      format: "png",
      clip: { ...box, scale: 1 },
    });
    fs.writeFileSync(path.join(out, file), Buffer.from(s.data, "base64"));
  };
  const pointAt = async (selector) => {
    const p = await waitFor(
      page,
      `(() => { const r = ${D}.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`,
    );
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
  };
  const away = () =>
    page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 1, y: 1 });
  const flipFolds = () =>
    run(
      `${D}.querySelector(".rt-more").click(); ${D}.querySelector(".rt-history").click();`,
    );

  await run("fxItemView(true)");
  const linked = await waitFor(
    page,
    itemScript(false),
    "the item view with sessions",
  );
  await shot(`${name}-item-session.png`);
  await pointAt('button[title="Delete permanently"]');
  const overHeader = await waitFor(
    page,
    pointerScript(),
    "the header under the pointer",
  );
  await pointAt(".tracker-sessions-section label");
  const overSessions = await waitFor(
    page,
    pointerScript(),
    "the sessions group under the pointer",
  );
  await away();
  await flipFolds();
  await run(
    `(() => { const i = ${D}.querySelector('[data-testid="tracker-comment-input"]'); i.value = "Looks right"; i.dispatchEvent(new Event("input", { bubbles: true })); })()`,
  );
  const opened = await waitFor(page, itemScript(true), "the open folds");
  await shot(`${name}-item-open.png`);
  await flipFolds();
  await waitFor(page, itemScript(false), "the closed folds");
  // The design's fallback (OPEN_SESSION_IS_MAIN = false): Launch Session filled though a session is linked
  // set in the same task as the measure, so the script cannot set it back in between
  const fallback = await waitFor(
    page,
    `(${D}.dataset.rtMain = "launch", ${itemScript(false)})`,
    "the fallback",
  );
  await run("fxItemView(false)");
  const none = await waitFor(
    page,
    `!${D}.querySelector('button[title^="Open session: "]') && ${itemScript(false)}`,
    "the item view without a session",
  );
  await shot(`${name}-item-launch.png`);
  const states = [linked, opened, none];
  console.log(
    `${name}: item view filled ${linked.filled} / ${none.filled} · sizes ${[...new Set(states.flatMap((s) => s.sizes))].sort().join(",")}`,
  );
  itemParts().forEach((what, i) => {
    const n = i + 1;
    const ok = [...states, overHeader, overSessions].every(
      (s) => s.parts[n] !== false,
    );
    check(
      `${name}: item part ${n}, ${what}`,
      ok ||
        console.log(
          JSON.stringify(
            [...states, overHeader, overSessions].map((s) => s.parts[n]),
          ),
        ),
    );
  });
  check(
    `${name}: item view, one filled button: the first session with one, Launch Session without; Post quiet`,
    linked.filled === "Open session: Look-over: quotes, wave 1" &&
      opened.filled === linked.filled &&
      opened.postShown &&
      none.filled === "Launch a new AI session for this item",
  );
  check(
    `${name}: item view, the fallback switch fills Launch Session alone`,
    fallback.filled === "Launch a new AI session for this item",
  );
  check(
    `${name}: item view, no text cut`,
    states.every((s) => !s.cut) ||
      console.log(states.map((s) => s.cut).join(" / ")),
  );
  check(
    `${name}: item view, text at 16, 15, 14 and 13 only (icons aside)`,
    states.every((s) => s.sizes.every((z) => [16, 15, 14, 13].includes(z))),
  );
}

// Runs in the page: null until the item view carries the script's marks with its folds open (or closed), then the
// verdict of each part that applies in this state (true or false; a part that does not apply is left out), the
// filled buttons, the text sizes and any cut text
function itemScript(open) {
  return `(() => {
  const d = document.querySelector('[data-testid="tracker-item-detail"]');
  if (!d || !d.dataset.rtMain || !d.querySelector(".rt-history") || !d.querySelector(".rt-more") ||
    d.dataset.rtMore !== "${open ? "open" : "closed"}" || document.fonts.status !== "loaded") return null;
  const q = (s) => d.querySelector(s);
  const cs = (e, p) => getComputedStyle(e, p);
  const shown = (e) => !!e && e.getClientRects().length > 0;
  const hidden = (e) => !!e && !e.getClientRects().length;
  const px = (e, k) => parseFloat(cs(e)[k]);
  const box = (e) => e.getBoundingClientRect();
  const clear = (e) => cs(e).backgroundColor === "rgba(0, 0, 0, 0)";
  const sq28 = (e) => box(e).width === 28 && box(e).height === 28;
  const before = (e, p = "::before") => cs(e, p).content.replace(/"/g, "");
  const tone = (v) => { const i = document.createElement("i"); i.style.color = v; document.body.append(i); const c = cs(i).color; i.remove(); return c; };
  const fill = (v) => { const i = document.createElement("i"); i.style.backgroundColor = v; document.body.append(i); const c = cs(i).backgroundColor; i.remove(); return c; };
  const sentence = (e) => cs(e).textTransform === "none" && (cs(e).letterSpacing === "normal" || cs(e).letterSpacing === "0px");
  const accent = fill("var(--x-accent)");
  const linked = !!q('button[title^="Open session: "]');
  const H = q(".tracker-item-detail-header");
  const B = q(":scope > .overflow-y-auto");
  const S = q(".tracker-sessions-section");
  const P = q('[data-testid="tracker-detail-field-pills"]');
  const pill = (f) => P.querySelector('[data-field="' + f + '"]');
  const btn = (t) => d.querySelector('button[title^="' + t + '"]');
  const launch = btn("Launch a new AI session");
  const status = pill("status");
  const chip = q(".tracker-item-detail-header span.font-medium.px-1\\\\.5:not([data-testid])");
  const key = q('[data-testid="tracker-item-local-key"]');
  const entries = [...d.querySelectorAll('.tracker-sessions-section .space-y-1 > button[title^="Open session: "]')];
  const editor = q(".tracker-content-editor");
  const firstText = editor.querySelector(".ContentEditable__root > p");
  const links = q(".tracker-links-section");
  const post = q(".tracker-comment-composer > button");
  const input = q('[data-testid="tracker-comment-input"]');
  const fold = q(".rt-history");
  const activity = q('[data-ink-part="activity"]');
  const created = q('[data-ink-part="created"]');
  const more = q(".rt-more");
  const folded = ["owner", "blocks", "goal"].map(pill);
  const setLinks = ["dependsOn", "collection"].map(pill);
  const top = (e) => box(e).top;
  const mid = (e) => (box(e).top + box(e).bottom) / 2;
  const order = [q(".tracker-detail-fields"), S, editor.parentElement, links, input.closest(".space-y-2"), fold];
  const parts = {
    1: px(H.querySelector(":scope > span.mt-1 > .material-symbols-outlined"), "fontSize") === 18,
    2: cs(q('[data-testid="tracker-detail-title"]')).fontSize === "16px" && cs(q('[data-testid="tracker-detail-title"]')).fontWeight === "600",
    3: clear(chip) && px(chip, "fontSize") === 13 && Math.abs(top(chip) - top(key)) < 4 &&
      chip.textContent + " " + before(key) + " " + key.textContent === "Task · " + (linked ? "CLS.74" : "CLS.75"),
    4: hidden(q('[data-testid="tracker-source-db-badge"]')),
    5: /Mono/.test(cs(key).fontFamily) && px(key, "fontSize") === 13 && cs(key).color === tone("var(--x-text-muted)") && !!key.title,
    6: hidden(q('[data-testid="tracker-publication-chip"]')),
    9: cs(btn("Close (Esc)")).opacity === "1" && sq28(btn("Close (Esc)")),
    10: cs(B).display === "flex" && cs(B).flexDirection === "column" && cs(B).rowGap === "16px" &&
      [...B.children].every((c) => cs(c).marginTop === "0px") && order.every((e, i) => i === 0 || top(order[i - 1]) < top(e)),
    11: px(S.querySelector("label"), "fontSize") === 13 && cs(S.querySelector("label")).fontWeight === "600" && sentence(S.querySelector("label")),
    16: status.tagName === "BUTTON" && box(status).left === box(P).left && cs(status).borderTopWidth === "0px" && px(status, "fontSize") === 13 &&
      px(status.querySelector(".material-symbols-outlined"), "fontSize") === 16 && shown(status.querySelector(".material-symbols-outlined")) &&
      (linked ? clear(status) && cs(status).color === tone("var(--x-state-running)")
        : !clear(status) && cs(status).fontWeight === "600" && cs(status).color === tone("var(--x-state-needs)")),
    17: linked ? hidden(pill("priority")) : shown(pill("priority")) && px(pill("priority"), "fontSize") === 13 && cs(pill("priority")).borderTopWidth === "0px",
    18: ["step", "stage"].every((f) => shown(pill(f)) && cs(pill(f)).borderTopWidth === "0px" && px(pill(f), "fontSize") === 13 &&
      hidden(pill(f).querySelector(".material-symbols-outlined")) && before(pill(f)) === (f === "step" ? "· step" : "·") && Math.abs(mid(pill(f)) - mid(status)) < 6),
    19: before(pill("budget").querySelector(".tracker-field-pill-value"), "::after") === " calls" && Math.abs(box(pill("budget")).right - box(P).right) < 1.5 &&
      hidden(pill("budget").querySelector(".material-symbols-outlined")),
    20: linked ? ["waitsOn", "proof"].every((f) => shown(pill(f)) && top(pill(f)) > box(status).bottom) && before(pill("waitsOn")) === "Waits on:" &&
      px(pill("waitsOn"), "fontSize") === 13 : ["waitsOn", "proof"].every((f) => ${open ? "shown" : "hidden"}(pill(f))),
    21: setLinks.every(${open ? "shown" : "hidden"}),
    22: folded.every(${open ? "shown" : "hidden"}) && clear(more) && more.textContent === "${open ? "Fewer fields" : "More fields"}" && more.getAttribute("aria-expanded") === "${open}",
    23: ${open ? `shown(q(".tracker-detail-tags")) && px(q(".tracker-detail-tags label"), "fontSize") === 13 && sentence(q(".tracker-detail-tags label"))` : `hidden(q(".tracker-detail-tags"))`},
    24: ${open ? `shown(q(".tracker-type-tags-editor")) && px(q(".tracker-type-tags-editor button"), "fontSize") === 13` : `hidden(q(".tracker-type-tags-editor"))`},
    25: hidden(editor.parentElement.querySelector(":scope > label")),
    26: cs(editor).backgroundColor === fill("var(--x-surface-1)") && cs(editor).borderTopWidth === "0px" && cs(editor).borderTopLeftRadius === "8px" &&
      box(firstText).left - box(editor).left === 12 && px(editor.querySelector(".ContentEditable__root"), "fontSize") === 15 &&
      (linked || box(editor).height === 48),
    27: hidden(q(".draggable-block-menu")),
    28: px(links.querySelector("h4"), "fontSize") === 13 && cs(links.querySelector("h4")).fontWeight === "600" && sentence(links.querySelector("h4")) &&
      px(links.querySelector(".tracker-links-page .truncate"), "fontSize") === 14 && px(links.querySelector(".tracker-links-page > span"), "fontSize") === 13 &&
      px(links.querySelector(".transition-transform"), "fontSize") === 0 && before(links.querySelector(".transition-transform")) === "chevron_right" &&
      (!linked || (() => { const l = [...links.querySelectorAll(".tracker-links-line")].pop(); const f = l.querySelector(":scope > .rt-done-fold");
        const ts = [...l.querySelectorAll(".tracker-links-page")].filter(shown);
        return !!f && f.textContent.trim() === "4 done" && ts.length === 4 && ts.every((t) => box(t).right <= box(l).right + 0.5 &&
          box(t.querySelector(".truncate")).right <= box(l).right + 0.5); })()),
    29: hidden(q(".tracker-comments-section").parentElement.querySelector("h4")),
    30: box(input).height === 32 && cs(input).borderTopLeftRadius === "6px" && cs(input).borderTopWidth === "1px",
    31: ${open ? "shown(post) && clear(post)" : "hidden(post)"},
    32: fold.textContent === "History and details · 3" && fold.getAttribute("aria-expanded") === "${open}" &&
      ${open ? `shown(activity) && px(activity.querySelector(":scope > div > div"), "fontSize") === 13` : "hidden(activity)"},
    33: ${open ? `shown(created) && clear(created.querySelector(".rounded")) && px(created.querySelector(".grid"), "fontSize") === 13` : "hidden(created)"},
  };
  if (!open) {
    parts[7] = ["Archive", "Focus content"].every((t) => cs(btn(t)).opacity === "0" && sq28(btn(t)));
    parts[8] = cs(btn("Delete permanently")).opacity === "0" && sq28(btn("Delete permanently"));
    parts[15] = ["Link an existing", "Launch a new isolated"].every((t) => cs(btn(t)).opacity === "0" && sq28(btn(t)));
  }
  if (linked && d.dataset.rtMain === "session") {
    parts[12] = clear(entries[0]) === false && cs(entries[0]).backgroundColor === accent && box(entries[0]).height === 32 &&
      cs(entries[0]).borderTopLeftRadius === "6px" && box(entries[0]).width === box(S).width && before(entries[0]) === "arrow_forward" &&
      cs(entries[0].lastElementChild).color === tone("var(--x-on-accent)") && px(entries[0].lastElementChild, "fontSize") === 13 && clear(entries[1]);
    parts[14] = clear(launch) && sq28(launch);
  }
  if (!linked) {
    parts[13] = hidden(S.querySelector(":scope > p"));
    parts[14] = cs(launch).backgroundColor === accent && box(launch).height === 32 && px(launch, "fontSize") === 14;
  }
  const texts = [...d.querySelectorAll("*")].filter((e) => shown(e) && !e.closest(".material-symbols-outlined") &&
    px(e, "fontSize") > 0 && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const dbox = box(d);
  const cut = texts.filter((e) => (e.scrollWidth > e.clientWidth + 1 && cs(e).textOverflow !== "ellipsis") ||
    (e.scrollHeight > e.clientHeight + 1 && cs(e).overflowY !== "visible") || box(e).right > dbox.right + 0.5 || box(e).left < dbox.left);
  return {
    parts,
    filled: [...d.querySelectorAll("button")].filter((b) => shown(b) && cs(b).opacity !== "0" && cs(b).backgroundColor === accent).map((b) => b.title).join("|"),
    postShown: shown(post) && cs(post).opacity !== "0",
    sizes: [...new Set(texts.map((e) => px(e, "fontSize")))],
    cut: cut.map((e) => e.className + ":" + e.textContent.slice(0, 30)).join(", "),
  };
})()`;
}

// Runs in the page: what the pointer shows in the item view's header and sessions group (parts 7, 8 and 15)
function pointerScript() {
  return `(() => {
  const d = document.querySelector('[data-testid="tracker-item-detail"]');
  const cs = (e) => getComputedStyle(e);
  const b = (t) => d.querySelector('button[title^="' + t + '"]');
  const i = document.createElement("i");
  i.style.color = "var(--x-error)";
  document.body.append(i);
  const error = cs(i).color;
  i.remove();
  const overHeader = d.querySelector(".tracker-item-detail-header:hover");
  const overSessions = d.querySelector(".tracker-sessions-section:hover");
  if (!overHeader && !overSessions) return null;
  const parts = {};
  if (overHeader) {
    parts[7] = ["Archive", "Focus content"].every((t) => cs(b(t)).opacity === "1");
    parts[8] = cs(b("Delete permanently")).opacity === "1" && cs(b("Delete permanently")).color === error;
  } else
    parts[15] = ["Link an existing", "Launch a new isolated", "Launch a new AI session"].every((t) => cs(b(t)).opacity === "1");
  return { parts };
})()`;
}
// Runs in the page: null until the four folds are drawn with S18's orb and the fonts are loaded, then what they show:
// headings and counts, open or closed, the rows shown in each, the started rows, the session links shown, the
// running orbs, S22's file link, and the contrast of the Needs you words on its tint (colours read back from a
// canvas, so any CSS colour works)
function foldsScript() {
  return `(() => {
  const folds = [...document.querySelectorAll(".rt-root .rt-fold")];
  const row = (id) => document.querySelector('.rt-row[data-step="' + id + '"]');
  if (folds.length !== 4 || !row("t-18") || !row("t-18").querySelector("canvas[data-orb]") ||
    document.fonts.status !== "loaded") return null;
  const cs = (e) => getComputedStyle(e);
  const shown = (e) => e.getClientRects().length > 0;
  const top = (e) => e.getBoundingClientRect().top;
  const ctx = document.createElement("canvas").getContext("2d", { willReadFrequently: true });
  const px = (...fills) => {
    ctx.clearRect(0, 0, 1, 1);
    for (const f of fills) { ctx.fillStyle = f; ctx.fillRect(0, 0, 1, 1); }
    return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
  };
  const lum = (c) => c.map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; })
    .reduce((s, v, i) => s + v * [0.2126, 0.7152, 0.0722][i], 0);
  const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
  const needs = folds.find((f) => f.dataset.fold === "needs");
  const under = [document.body, document.querySelector('[data-layout="tracker-mode-wrapper"]'), needs]
    .map((e) => cs(e).backgroundColor);
  const words = [...needs.querySelectorAll(".rt-fold-word, .rt-row-title, .rt-wait")];
  const contrast = Math.min(...words.map((e) => ratio(px(...under, cs(e).color), px(...under))));
  const font = (e) => cs(e).fontWeight + " " + cs(e).fontSize + "/" + cs(e).lineHeight;
  const rows = [...document.querySelectorAll(".rt-row")].filter(shown);
  const link = row("t-22").querySelector(".rt-file");
  return {
    heads: folds.map((f) => f.dataset.fold + ":" + f.querySelector(".rt-fold-word").textContent + ":" +
      f.querySelector(".rt-count").textContent).join(" / "),
    topDown: folds.every((f, i) => i === 0 || top(f) > top(folds[i - 1])),
    open: folds.map((f) => { const h = f.querySelector("button.rt-fold-head"); return h ? h.getAttribute("aria-expanded") : "empty"; }).join(","),
    headFont: [...new Set(folds.map((f) => font(f.querySelector(".rt-fold-head"))))].join(","),
    rows: folds.map((f) => [...f.querySelectorAll(".rt-row")].filter(shown).map((r) => r.dataset.step).join(",")).join(" / "),
    oneLine: rows.every((r) => r.querySelector(".rt-row-title").getBoundingClientRect().height <= 21 &&
      r.querySelector(".rt-row-right").getBoundingClientRect().height <= 24),
    titleFonts: ["t-27", "t-23"].map((id) => cs(row(id).querySelector(".rt-row-title")).fontWeight).join(","),
    started: ["t-20", "t-21"].map((id) => row(id).closest(".rt-fold").dataset.fold + " " +
      (row(id).querySelector(".rt-ring.rt-half") ? "half " : "") + row(id).querySelector(".rt-wait").textContent).join("|"),
    sessions: [...document.querySelectorAll(".rt-session")].filter(shown)
      .map((e) => e.closest(".rt-row").dataset.step + ":" + e.textContent).join(","),
    // S18, S19 and S20's session states: orb ~ words ~ tone class
    states: ["t-18", "t-19", "t-20"].map((id) => {
      const c = row(id).querySelector("canvas[data-orb]");
      const w = row(id).querySelector(".rt-wait");
      return id + " " + row(id).closest(".rt-fold").dataset.fold + " " + (c ? c.dataset.orb : "-") + " ~ " +
        w.textContent + " ~ " + w.className;
    }).join(" | "),
    // The colours: a working session's words, the attention words, a row title and a session link
    tones: (() => {
      const color = (sel) => { const e = document.querySelector(sel); return e ? cs(e).color : "-"; };
      const warn = document.createElement("span");
      warn.style.color = "var(--x-state-needs)";
      document.querySelector(".rt-root").append(warn);
      const warning = cs(warn).color;
      warn.remove();
      return {
        running: color(".rt-wait-running"),
        attention: [...new Set([...document.querySelectorAll(".rt-wait-attention")].map((e) => cs(e).color))].join(","),
        text: color(".rt-row-title"),
        link: color(".rt-session"),
        warning,
      };
    })(),
    errorWords: [...document.querySelectorAll(".rt-wait")].map((e) => e.textContent)
      .filter((t) => /error|fail|stopped/i.test(t)).join(" | "),
    orbs: [...document.querySelectorAll(".rt-fold-running canvas[data-orb]")].map((c) => c.dataset.orb).join(","),
    file: link && shown(link) ? link.textContent + "|" + cs(link).textDecorationLine : null,
    contrast,
  };
})()`;
}

// Runs in the page: null until Done is open (or closed), then how many of its rows show and which rows show a
// session link
function doneScript(open) {
  return `(() => {
  const head = document.querySelector(".rt-fold-done .rt-fold-head");
  if (!head || head.getAttribute("aria-expanded") !== "${open}") return null;
  const shown = (e) => e.getClientRects().length > 0;
  return {
    rows: [...document.querySelectorAll(".rt-fold-done .rt-row")].filter(shown).length,
    sessions: [...document.querySelectorAll(".rt-session")].filter(shown).map((e) => e.closest(".rt-row").dataset.step).join(","),
  };
})()`;
}

// Runs in the page: null until the page top is drawn as `kind` (its data-kind) and the fonts are loaded, then the
// measures of the header, the progress line and bar, the hidden sidebar and app list, and the folds under the bar
// (null for a part the state does not have)
function measureScript(kind) {
  return `(() => {
  const root = document.querySelector(".rt-root");
  if (!root || root.dataset.kind !== ${JSON.stringify(kind)} || document.fonts.status !== "loaded") return null;
  const cs = (e) => getComputedStyle(e);
  const box = (e) => e.getBoundingClientRect();
  const q = (s) => root.querySelector(s);
  const font = (e) => (e ? cs(e).fontWeight + " " + cs(e).fontSize + "/" + cs(e).lineHeight : null);
  const text = (s) => (q(s) ? q(s).textContent : null);
  const pane = box(document.querySelector('[data-layout="tracker-mode-wrapper"]'));
  const left = (e) => (e ? Math.round(box(e).left - pane.left) : null);
  const texts = [...document.body.querySelectorAll("*")].filter((e) =>
    e.getClientRects().length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()));
  const ours = texts.filter((e) => root.contains(e));
  const size = (e) => parseFloat(cs(e).fontSize);
  const name = q(".rt-name-text");
  const button = q(".rt-name");
  const bar = q(".rt-bar");
  const parts = [...root.querySelectorAll(".rt-part[data-count][data-tip]")];
  const total = parts.reduce((s, p) => s + +p.dataset.count, 0);
  const share = (p) => (bar ? box(bar).width * +p.dataset.count / total : 0);
  // A part under 8px is held at 8px (the needs-you part), which takes up to 8px from the others
  const slack = parts.some((p) => share(p) < 8) ? 9.5 : 1.5;
  const side = document.querySelector(".tracker-sidebar");
  const table = document.querySelector(".tracker-table-container");
  const folds = q(".rt-folds");
  const asof = q(".rt-asof");
  const headSide = q(".rt-head-side");
  const now = new Date();
  return {
    kind: root.dataset.kind,
    name: name ? name.textContent : null,
    nameFont: font(name),
    // The name in the theme's text colour (the page around it is #333, as in the app)
    nameColor: (() => {
      if (!name) return null;
      const p = document.createElement("span");
      p.style.color = "var(--nim-text)";
      root.append(p);
      const want = cs(p).color;
      p.remove();
      return cs(name).color === want;
    })(),
    nameLines: name ? Math.round(box(name).height / parseFloat(cs(name).lineHeight)) : null,
    nameCut: name ? name.scrollHeight > name.clientHeight + 1 : null,
    nameIsLargest: name ? texts.every((e) => size(e) <= size(name)) : null,
    popup: button ? button.getAttribute("aria-haspopup") : null,
    expanded: button ? button.getAttribute("aria-expanded") : null,
    nameTip: button ? button.title : null,
    headLeft: left(name),
    barLeft: left(bar),
    emptyLeft: left(q(".rt-empty-title")),
    width: Math.round(box(bar || root).width),
    goal: font(q(".rt-goal")),
    goalText: text(".rt-goal"),
    pill: text(".rt-pill"),
    meta: text(".rt-head-meta"),
    sideRight: headSide ? Math.abs(box(headSide).right - box(q(".rt-head")).right) < 1 : null,
    fig: font(q(".rt-pg-fig")),
    words: font(q(".rt-pg-words")),
    line: [...root.querySelectorAll(".rt-pg-line > span:not(.rt-asof)")].map((e) => e.textContent).join("|"),
    asof: asof ? asof.textContent : null,
    asofRight: asof && bar ? Math.abs(box(asof).right - box(bar).right) < 1 : null,
    time: String(now.getHours()).padStart(2, "0") + ":" + String(now.getMinutes()).padStart(2, "0"),
    parts: parts.map((p) => p.classList[1].slice(3) + ":" + p.dataset.count + ":" + p.dataset.tip).join(" / "),
    shares: parts.every((p) => Math.abs(box(p).width - share(p)) <= slack),
    jobs: [...root.querySelectorAll(".rt-job-row")].map((r) => r.dataset.pick).join(","),
    needs: [...root.querySelectorAll(".rt-job-row")].map((r) => (r.querySelector(".rt-needs-n") || { textContent: "" }).textContent).join(","),
    empty: text(".rt-empty-title"),
    lead: text(".rt-lead"),
    sideHidden: !!side && !side.getClientRects().length,
    onlySidebar: [...document.querySelectorAll(".rt-left-hidden")].every((e) => e === side),
    sessionsShown:
      !!side &&
      !!document.querySelector(".session-history-list") &&
      side.parentElement.contains(document.querySelector(".session-history-list")) &&
      document.querySelector(".session-history-list").getClientRects().length > 0,
    headerKept:
      !!side &&
      [...side.children].every((e) =>
        e.matches(".workspace-color-accent, .workspace-summary-header") ? e.getClientRects().length > 0 : !e.getClientRects().length,
      ),
    tabsShown: document.querySelectorAll("#fx-tabs button").length === 1 &&
      document.querySelector("#fx-tabs button").getClientRects().length > 0,
    typeRows: document.querySelectorAll(".tracker-sidebar .tracker-nav-type-row").length,
    tableShown: table.getClientRects().length > 0,
    foldsShown: !!folds && folds.getClientRects().length > 0,
    foldsUnder: !!folds && !!bar && box(folds).top >= box(bar).bottom,
    foldsGap: folds && bar && folds.firstElementChild ? Math.round(box(folds.firstElementChild).top - box(bar).bottom) : null,
    smallest: Math.min(...ours.map(size)),
    heaviest: Math.max(...ours.map((e) => +cs(e).fontWeight)),
    upper: ours.some((e) => cs(e).textTransform === "uppercase"),
  };
})()`;
}

// Runs in the page: null until the picker is open, drawn and done fading in, then its lines top to bottom (option ids, "Finished" for
// its heading, "more" for the more button), whether they go down the page in that order and sit under the name
function pickerScript() {
  return `(() => {
  const picker = document.querySelector(".rt-picker");
  if (!picker || picker.hidden || !picker.getClientRects().length) return null;
  // Fully opened: its fade-in done
  if (getComputedStyle(picker).opacity !== "1" || picker.getAnimations({ subtree: true }).length) return null;
  const lines = [...picker.children].filter((e) => !e.classList.contains("rt-pk-sep"));
  const tops = lines.map((e) => e.getBoundingClientRect().top);
  const name = document.querySelector(".rt-name");
  return {
    order: lines.map((e) => e.dataset.pick || (e.classList.contains("rt-pk-head") ? e.textContent : "more")).join(","),
    topDown: tops.every((t, i) => i === 0 || t > tops[i - 1]),
    under: picker.getBoundingClientRect().top >=
      Math.max(...[name, name.querySelector(".rt-name-text")].map((e) => e.getBoundingClientRect().bottom)) - 1,
    expanded: name.getAttribute("aria-expanded"),
  };
})()`;
}

/** One DevTools connection: send(method, params) and the page's uncaught errors. */
async function connect(url) {
  const ws = new WebSocket(url);
  await new Promise((ok, bad) => {
    ws.onopen = ok;
    ws.onerror = () => bad(new Error(`could not connect to ${url}`));
  });
  let id = 0;
  const waiting = new Map();
  const errors = [];
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.method === "Runtime.exceptionThrown")
      errors.push(
        msg.params.exceptionDetails.exception?.description ||
          msg.params.exceptionDetails.text,
      );
    if (
      msg.method === "Runtime.consoleAPICalled" &&
      msg.params.type === "error"
    )
      errors.push(
        msg.params.args.map((a) => a.description || a.value).join(" "),
      );
    const w = waiting.get(msg.id);
    if (!w) return;
    waiting.delete(msg.id);
    if (msg.error) w.bad(new Error(msg.error.message));
    else w.ok(msg.result);
  };
  return {
    errors,
    send: (method, params = {}) =>
      new Promise((ok, bad) => {
        const n = ++id;
        waiting.set(n, { ok, bad });
        ws.send(JSON.stringify({ id: n, method, params }));
      }),
    close: () => ws.close(),
  };
}

/** Evaluates `expr` every 100 ms until it gives a value; an error in the page or 10 s without one throws. */
async function waitFor(page, expr, what = "the reading") {
  for (let t = 0; t < 100; t++) {
    const r = await page.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    });
    if (r.exceptionDetails)
      throw new Error(
        r.exceptionDetails.exception?.description || r.exceptionDetails.text,
      );
    if (r.result.value) return r.result.value;
    if (page.errors.length)
      throw new Error(`page error: ${page.errors.join("\n")}`);
    await new Promise((ok) => setTimeout(ok, 100));
  }
  throw new Error(`${what} did not appear in 10 s`);
}
