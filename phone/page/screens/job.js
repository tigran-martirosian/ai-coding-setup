// One job (DS1 section 3, item 5; plan row C4): the job tracker's four folds, Needs you · Working · To do ·
// Finished, as grouped sections, Finished folded. The folds and their order are model.js's (home-jobs.js), so a
// step that needs the user comes first. Steps open nothing on the phone, so their rows have no chevron.
import {
  openSteps,
  waitsOnSteps,
} from "../../../extensions/job-tracker/src/model.js";
import { el } from "../frame/dom.js";
import { registerScreen } from "../frame/screens.js";
import {
  findJob,
  jobBar,
  jobMeta,
  jobsKept,
  loadJobs,
  stepsOf,
} from "./home-jobs.js";

const FOLDS = [
  { fold: "needs", word: "Needs you", block: "div.block.needs-block" },
  { fold: "running", word: "Working", block: "div.block" },
  { fold: "todo", word: "To do", block: "div.block" },
  { fold: "done", word: "Finished", block: "div.block" },
];

// What a waiting step waits for, in plain words
const NEEDS_WORD = {
  "waits-for-you": "waits for you",
  "in-review": "to review",
};

// The row's mark, as on the tracker page: an amber dot (needs you), the thinking orb (working), a ring (to do,
// half filled when started), a tick (done) and a dash (dropped).
function mark(r) {
  if (r.fold === "needs")
    return el("span.orb.listen", { "aria-hidden": "true" });
  if (r.fold === "running")
    return el("span.orb.think", { "aria-hidden": "true" });
  if (r.dropped) return el("span.mk.dash", { "aria-hidden": "true" });
  if (r.fold === "done") return el("span.mk.tick", { "aria-hidden": "true" });
  return el(`span.mk.ring${r.started ? ".half" : ""}`, {
    "aria-hidden": "true",
  });
}

function stepRow(r, open) {
  const code = r.item.customFields?.step;
  const waits =
    r.fold === "todo"
      ? waitsOnSteps(r.item, open).map((o) => o.customFields?.step || o.title)
      : [];
  const parts = [
    code ? String(code) : null,
    r.fold === "needs"
      ? el("span.w", NEEDS_WORD[r.item.status] ?? r.item.status)
      : null,
    r.fold === "running" ? el("span.w", "a session works on it") : null,
    r.started ? "started, no session on it" : null,
    r.forYou ? "yours" : null,
    waits.length ? `waits on ${waits.join(", ")}` : null,
    r.dropped ? r.item.status : null,
  ].filter(Boolean);
  const cls = {
    needs: "needs",
    running: "running",
    todo: "todo",
    done: "done",
  }[r.fold];
  return el(
    `div.row.step.${cls}${r.dropped ? ".dropped" : ""}`,
    { "data-step": r.item.id },
    mark(r),
    el(
      "div.row-text",
      el("div.name", r.item.title),
      parts.length
        ? el(
            "div.meta",
            parts.flatMap((p, i) => (i ? [" · ", p] : [p])),
          )
        : null,
    ),
    el("div.right", r.bug ? el("span.chip.bug", "Bug") : null),
  );
}

function render(ctx) {
  const box = el("div.home.job-page");
  let showDone = false;
  const { project, job } = ctx.params;

  const draw = () => {
    const j = jobsKept.d ? findJob(jobsKept.d, project, job) : null;
    if (!j) {
      box.replaceChildren(
        el(
          "div.block",
          el(
            "div.empty",
            jobsKept.error
              ? `Could not read the job: ${jobsKept.error}`
              : jobsKept.d
                ? "This job is no longer in the tracker."
                : "Reading the job tracker…",
          ),
        ),
      );
      return;
    }
    const open = openSteps(j.steps);
    const summary = el(
      "div.group",
      el(
        "div.block.job-sum",
        el(
          "div.job-top",
          el("span.name", stepsOf(j.counts)),
          el("span.of", `${j.counts.percent}%`),
        ),
        jobBar(j.counts),
        jobMeta(j.counts, [j.projectName]),
      ),
    );
    const folds = FOLDS.filter((f) => j.folds[f.fold].length).map((f) => {
      const rows = j.folds[f.fold];
      const folded = f.fold === "done" && !showDone;
      return el(
        `div.group.fold.fold-${f.fold}`,
        el("div.g-head", f.word, el("span.n", String(rows.length))),
        folded
          ? null
          : el(
              f.block,
              rows.map((r) => stepRow(r, open)),
            ),
        f.fold === "done"
          ? el(
              "div.g-link-row",
              {
                role: "button",
                tabindex: "0",
                "aria-expanded": String(showDone),
                onclick: () => {
                  showDone = !showDone;
                  draw();
                },
              },
              showDone ? "Hide finished" : `Show ${rows.length} finished`,
              el("i.chev", { "aria-hidden": "true" }),
            )
          : null,
      );
    });
    box.replaceChildren(
      summary,
      ...(folds.length
        ? folds
        : [el("div.block", el("div.empty", "This job has no steps yet."))]),
    );
  };

  if (!jobsKept.d && ctx.connected) loadJobs(ctx, draw);
  draw();
  return box;
}

registerScreen({
  id: "job",
  tab: null,
  title: (params) =>
    (jobsKept.d &&
      findJob(jobsKept.d, params.project, params.job)?.job.title) ||
    "Job",
  render,
  actions: ["jobs.list"],
});
