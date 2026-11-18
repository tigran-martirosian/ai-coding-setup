// Home's Jobs (DS1 section 3, item 5; plan row C4): one row per open job of the job tracker, "N of M steps", the
// tracker page's bar made small and one meta line in the state tones. The PC sends each project's tracker items
// and the running sessions' links (jobs.list); the grouping and counting is the job tracker's own model.js,
// unchanged, so the phone shows the same folds and counts as the tracker page. A row opens the job (job.js).
import {
  pickerJobs,
  workingItemIds,
} from "../../../extensions/job-tracker/src/model.js";
import { el } from "../frame/dom.js";
import { hasScreen, registerHomePart } from "../frame/screens.js";
import { keepPart, keptPart } from "./home.js";

// The last jobs.list answer: { d, error, key, box }. `key` is the pc.status time it was asked for, so Home asks
// once per status answer, not on every redraw; `box` is the Jobs block drawn last, which an answer fills in.
export const jobsKept = { d: null, error: null, key: null, box: null };

// The PC's own words when its answer has them ({ err, message }), else its error word.
const errWord = (r) => r?.message ?? r?.err ?? r?.code ?? "no answer";

// Asks the PC for the jobs; calls `then` when the answer is in jobsKept.
export async function loadJobs(ctx, then) {
  let r;
  try {
    r = await ctx.ask("jobs.list", {});
  } catch (e) {
    r = e;
  }
  if (r?.ok) {
    jobsKept.d = r.d;
    jobsKept.error = null;
    keepPart("jobs", r.d);
  } else jobsKept.error = errWord(r);
  then();
}

/**
 * The open jobs of a jobs.list answer through model.js: [{ project, projectName, ...jobOf }], the jobs with a step
 * that needs the user first, then by newest activity (the tracker's picker order); and the projects whose tracker
 * could not be read: [{ name, error }].
 */
export function openJobs(d) {
  const jobs = [];
  const failed = [];
  for (const p of d.projects) {
    if (p.error) {
      failed.push({ name: p.name, error: p.error });
      continue;
    }
    const working = workingItemIds(
      p.sessions,
      p.sessions.map((s) => s.id),
    );
    for (const j of pickerJobs(p.items, working).open)
      jobs.push({ project: p.project, projectName: p.name, ...j });
  }
  jobs.sort(
    (a, b) =>
      (b.counts.needs > 0) - (a.counts.needs > 0) || b.activity - a.activity,
  );
  return { jobs, failed };
}

/** One job of a jobs.list answer, or null: { project, projectName, ...jobOf }. */
export function findJob(d, project, jobId) {
  const p = d.projects.find((x) => x.project === project && !x.error);
  if (!p) return null;
  const working = workingItemIds(
    p.sessions,
    p.sessions.map((s) => s.id),
  );
  const { open, finished } = pickerJobs(p.items, working);
  const j = [...open, ...finished].find((x) => x.job.id === jobId);
  return j ? { project: p.project, projectName: p.name, ...j } : null;
}

// The tracker page's bar, small: finished, needs you, working, to do, in that order, each part as wide as its count.
export function jobBar(counts) {
  const bar = el("div.jbar", { "aria-hidden": "true" });
  for (const [cls, n] of [
    ["d", counts.done],
    ["n", counts.needs],
    ["r", counts.running],
    ["t", counts.todo],
  ])
    if (n > 0) {
      const part = el(`i.${cls}`);
      part.style.flexGrow = String(n);
      bar.append(part);
    }
  return bar;
}

// "1 needs you · 3 working · 28 to do", the zero parts left out; the needs and working words in their tones.
export function jobMeta(counts, extra = []) {
  const parts = [
    ...extra,
    counts.needs ? el("span.w-needs", `${counts.needs} needs you`) : null,
    counts.running ? el("span.w-run", `${counts.running} working`) : null,
    counts.todo ? `${counts.todo} to do` : null,
  ].filter(Boolean);
  if (!parts.length) parts.push("no open steps");
  return el(
    "div.job-meta",
    parts.flatMap((p, i) => (i ? [" · ", p] : [p])),
  );
}

export const stepsOf = (counts) =>
  `${counts.done} of ${counts.total} step${counts.total === 1 ? "" : "s"}`;

const chev = () => el("i.chev", { "aria-hidden": "true" });

function jobRow(ctx, j, manyProjects) {
  const opens = hasScreen("job");
  return el(
    "div.job",
    opens
      ? {
          role: "button",
          tabindex: "0",
          "data-job": j.job.id,
          onclick: () => ctx.go("job", { project: j.project, job: j.job.id }),
        }
      : { "data-job": j.job.id },
    el(
      "div.job-top",
      el("span.name", j.job.title),
      el("span.of", stepsOf(j.counts), opens ? chev() : null),
    ),
    jobBar(j.counts),
    jobMeta(j.counts, manyProjects ? [j.projectName] : []),
  );
}

function fill(ctx) {
  const { box, d, error } = jobsKept;
  if (!box) return;
  const head = (n) =>
    el("div.g-head", "Jobs", n ? el("span.n", String(n)) : null);
  const sub = el("div.g-sub", "Plans of several steps, from the job tracker");
  if (!d) {
    box.replaceChildren(
      head(0),
      sub,
      el(
        "div.block",
        el(
          "div.empty",
          error
            ? `Could not read the jobs: ${error}`
            : "Reading the job tracker…",
        ),
      ),
    );
    return;
  }
  const { jobs, failed } = openJobs(d);
  const many = new Set(jobs.map((j) => j.project)).size > 1;
  box.replaceChildren(
    head(jobs.length),
    sub,
    el(
      "div.block",
      jobs.length
        ? jobs.map((j) => jobRow(ctx, j, many))
        : el("div.empty", "No open jobs."),
    ),
    ...(error ? [el("p.err", `Could not read the jobs again: ${error}`)] : []),
    ...failed.map((f) =>
      el("p.err", `Could not read ${f.name}'s tracker: ${f.error}`),
    ),
  );
}

// Jobs need Nimbalyst's door: shown only while Nimbalyst is open and the PC offers jobs.list.
function renderJobs(ctx) {
  const { home } = ctx;
  const s = home.kept.status;
  // Drawn from what Home kept on the phone: the kept jobs, asking nothing.
  if (ctx.updating) {
    jobsKept.d = keptPart("jobs");
    if (!jobsKept.d || s?.nimbalyst !== "open") return null;
    jobsKept.box = el("div.group.jobs");
    fill(ctx);
    return jobsKept.box;
  }
  if (!ctx.connected || !home.fresh || s?.nimbalyst !== "open") return null;
  if (!ctx.offered("jobs.list")) return null;
  jobsKept.box = el("div.group.jobs");
  if (jobsKept.key !== s.asOf) {
    jobsKept.key = s.asOf;
    loadJobs(ctx, () => fill(ctx));
  }
  fill(ctx);
  return jobsKept.box;
}

registerHomePart({ id: "jobs", order: 50, render: renderJobs });
