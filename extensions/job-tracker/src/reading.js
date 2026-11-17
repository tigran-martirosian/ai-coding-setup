// The top of the tracker page (tracker one-page design 3.2-3.4 and 3.9-3.11, with its three later passes, which win):
// the header (the job's name as the page's headline and the picker button, its goal under it, a state pill and one
// meta line on the right), the picker under the name ("All open", the open jobs newest activity first, "Not in a
// job", then "Finished"), one progress line ("141 of 150 steps done 94%", "Updated 09:55") over a 10px bar with a
// needs-you part, the "All open" list, and the no-job and empty states. No kind word, and no counts per group: the
// groups under the bar show them (third pass).
// pageView() makes the words (no DOM, so test.mjs runs it in Node); renderPage() draws them.
import { categoryOf, foldsOf, notInJob, pickerJobs } from "./model.js";

const fill = (s, v) =>
  s.replace(/\{(\w+)\}/g, (_, k) => {
    if (!(k in v)) throw new Error(`job-tracker: no value for {${k}}`);
    return String(v[k]);
  });
const pad = (n) => String(n).padStart(2, "0");
const timeOf = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const dayOf = (S, d) =>
  d.toLocaleDateString(S.dateLocale, { day: "numeric", month: "short" });
// The picker shows this many finished jobs, then "N more finished"
const FINISHED_SHOWN = 5;

/** "1 step" or "3 steps": `unit` is { one, many }. */
const counted = (n, unit) => `${n} ${n === 1 ? unit.one : unit.many}`;

/** The first paragraph of the item's description, on one line; null when it has none. */
function goalOf(item) {
  const text = typeof item.description === "string" ? item.description : "";
  const first = text.trim().split(/\n\s*\n/)[0];
  return first ? first.replace(/\s+/g, " ").trim() : null;
}

/** The item's `created` time as a Date, or null when the item has none (the "Started" part is then left out). */
function createdOf(item) {
  if (item.created == null) return null;
  // The app stores a bare day ("2026-11-14"); new Date() reads that as midnight UTC, the day before west of
  // Greenwich, so a bare day is read as that day here
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(item.created);
  const d = day
    ? new Date(+day[1], +day[2] - 1, +day[3])
    : new Date(item.created);
  if (Number.isNaN(+d))
    throw new Error(`job-tracker: item ${item.id} has a bad "created" time`);
  return d;
}

/**
 * What the page shows for `pick` (a job id, "all" or "none"): that one while it is there, else the open job with the
 * newest activity, else "Not in a job" when open items are outside every job (`looseOpen`, design 3.3), else "All
 * open" when finished jobs exist, else the empty page.
 */
function shownOf(picker, loose, looseOpen, pick) {
  const jobs = [...picker.open, ...picker.finished];
  if (pick === "all" && jobs.length) return { kind: "all" };
  if (pick === "none" && loose.length) return { kind: "none" };
  const picked = jobs.find((j) => j.job.id === pick);
  if (picked) return { kind: "job", job: picked };
  if (picker.open.length) return { kind: "job", job: picker.open[0] };
  if (looseOpen.length) return { kind: "none" };
  if (jobs.length) return { kind: "all" };
  return { kind: "empty" };
}

/** The progress line and the bar's parts (done, needs you, running, to do) for `counts` of model.js foldsOf. */
function progressOf(S, c, unit, now) {
  const toDo =
    c.forYou && c.forClaude
      ? fill(S.tipToDoBoth, {
          n: counted(c.todo, unit),
          claude: c.forClaude,
          you: c.forYou,
        })
      : fill(c.forYou ? S.tipToDoYou : S.tipToDoClaude, {
          n: counted(c.todo, unit),
        });
  const parts = [
    {
      part: "done",
      n: c.done,
      tip: fill(S.tipDone, { done: c.done, total: counted(c.total, unit) }),
    },
    {
      part: "needs",
      n: c.needs,
      tip: fill(S.tipNeeds, { n: counted(c.needs, unit) }),
    },
    {
      part: "running",
      n: c.running,
      tip: fill(c.running === 1 ? S.tipRunningOne : S.tipRunning, {
        n: counted(c.running, unit),
      }),
    },
    { part: "todo", n: c.todo, tip: toDo },
  ].filter((p) => p.n > 0);
  return {
    figure: c.total ? String(c.done) : null,
    words: c.total
      ? fill(S.ofDone, { total: counted(c.total, unit) })
      : fill(S.noneYet, { unit: unit.many }),
    percent: c.total ? `${c.percent}%` : null,
    updated: fill(S.updated, { time: timeOf(now) }),
    label: fill(S.barLabel, {
      done: c.done,
      total: counted(c.total, unit),
      needs: c.needs,
      running: c.running,
      todo: c.todo,
    }),
    total: c.total,
    parts,
  };
}

/** "2 need you" or "1 needs you"; null at 0. */
const needsWords = (S, n) =>
  n ? fill(n === 1 ? S.needsOne : S.needsMany, { n }) : null;

/**
 * The words and numbers of the page top. `items` are the project's tracker items, `working` the ids of the items a
 * session works on now (model.js workingItemIds), `pick` what the user picked (a job id, "all", "none" or null),
 * `now` the time the data was read, `project` the project folder's name, `waiting` the ids of the items a session
 * waits on the user about (none when left out).
 */
function pageView(S, items, working, pick, now, project, waiting = new Set()) {
  const picker = pickerJobs(items, working, waiting);
  const loose = notInJob(items);
  const looseOpen = loose.filter(
    (i) => !["done", "dropped"].includes(categoryOf(i)),
  );
  const shown = shownOf(picker, loose, looseOpen, pick);
  const kind = shown.kind;
  const current = kind === "job" ? shown.job.job.id : kind;
  const nOpen = picker.open.length;
  const items1 = { one: S.item, many: S.items };
  const steps1 = { one: S.step, many: S.steps };
  const nameTip = (name) => `${name}\n${fill(S.switchJob, { n: nOpen })}`;

  let head = null;
  let progress = null;
  let jobs = null;
  if (kind === "job") {
    const j = shown.job;
    const left = j.counts.total - j.counts.done;
    let stateTip;
    // Why it is finished: its stored status, else its steps (and, when it ships as a version, its tag)
    if (j.closedAs)
      stateTip =
        j.closedAs === "cancelled"
          ? S.finishedCancelledTip
          : S.finishedMarkedTip;
    else if (j.finished)
      stateTip = j.version
        ? fill(S.finishedTagTip, { tag: j.tag })
        : S.finishedTip;
    else if (left)
      stateTip = fill(S.inProgressTip, { n: counted(left, steps1) });
    else if (j.counts.total) stateTip = S.inProgressNoTag;
    else stateTip = S.inProgressNoSteps;
    const started = createdOf(j.job);
    const meta = [
      started ? fill(S.started, { date: dayOf(S, started) }) : null,
      j.version ? fill(S.version, { version: j.version }) : null,
      j.version ? (j.tag ? fill(S.tag, { tag: j.tag }) : S.noTag) : null,
    ].filter(Boolean);
    const goal = goalOf(j.job);
    head = {
      name: j.job.title,
      button: true,
      nameTip: nameTip(j.job.title),
      goal: goal || S.noGoal,
      goalMissing: !goal,
      state: {
        word: j.finished ? S.finished : S.inProgress,
        done: j.finished,
        tip: stateTip,
      },
      meta: meta.join(S.sep),
    };
    progress = progressOf(S, j.counts, steps1, now);
  } else if (kind === "none") {
    head = {
      name: S.notInJob,
      button: true,
      nameTip: nameTip(S.notInJob),
      goal: fill(loose.length === 1 ? S.looseGoalOne : S.looseGoal, {
        n: loose.length,
      }),
      goalMissing: false,
      state: null,
      meta: project,
    };
    progress = progressOf(
      S,
      foldsOf(loose, working, waiting).counts,
      items1,
      now,
    );
  } else if (kind === "all") {
    head = {
      name: S.allOpenTitle,
      button: true,
      nameTip: nameTip(S.allOpenTitle),
      // No open job (only finished ones): one plain sentence in place of "0 open" and an empty list
      goal: nOpen ? null : S.noOpenJobsLead,
      goalMissing: false,
      state: null,
      meta: nOpen ? fill(S.allMeta, { n: nOpen, time: timeOf(now) }) : null,
    };
    jobs = picker.open.map((j) => ({
      id: j.job.id,
      name: j.job.title,
      sub: goalOf(j.job) || "",
      percent: j.counts.percent,
      right: fill(S.ofShort, { done: j.counts.done, total: j.counts.total }),
      needs: needsWords(S, j.counts.needs),
    }));
    if (looseOpen.length)
      jobs.push({
        id: "none",
        name: S.notInJob,
        sub: S.looseSub,
        percent: null,
        right: counted(looseOpen.length, items1),
        needs: null,
      });
    if (!jobs.length) jobs = null;
  }

  return {
    kind,
    current,
    head,
    progress,
    jobs,
    picker: {
      all: {
        label: S.allOpen,
        meta: nOpen
          ? counted(nOpen, { one: S.job, many: S.jobs })
          : S.noOpenJobs,
        disabled: !nOpen,
      },
      open: picker.open.map((j) => ({
        id: j.job.id,
        name: j.job.title,
        percent: j.counts.percent,
        meta: fill(S.doneShort, { done: j.counts.done, total: j.counts.total }),
        needs: needsWords(S, j.counts.needs),
      })),
      loose:
        looseOpen.length || kind === "none"
          ? { label: S.notInJob, meta: counted(looseOpen.length, items1) }
          : null,
      finished: picker.finished.map((j) => ({
        id: j.job.id,
        name: j.job.title,
        meta: fill(S.finishedOn, { date: dayOf(S, j.activity) }),
      })),
      shown: FINISHED_SHOWN,
      more:
        picker.finished.length > FINISHED_SHOWN
          ? fill(S.moreFinished, {
              n: picker.finished.length - FINISHED_SHOWN,
            })
          : null,
    },
  };
}

/**
 * Draws the view as one <section class="rt-root">. `ui` is { pickerOpen, pickerFade, moreFinished, chatShown }:
 * pickerFade only on the draw that opens the picker, so a redraw while it is open does not fade it in again. `on`
 * holds the clicks: pick(id) with a job id, "all" or "none", picker(open), moreFinished() and chat(show).
 */
function renderPage(doc, view, S, ui, on) {
  const el = (tag, cls, text) => {
    const e = doc.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };
  const miniBar = (percent) => {
    const bar = el("span", "rt-mini");
    const done = el("i", "rt-mini-done");
    done.style.width = `${percent}%`;
    bar.append(done);
    return bar;
  };
  const root = el("section", "rt-root");
  root.dataset.kind = view.kind;
  root.setAttribute("aria-label", S.pageLabel);

  if (view.kind === "empty") {
    root.append(
      el("h1", "rt-empty-title", S.noJobs),
      el("p", "rt-lead", S.emptyLead),
    );
    return root;
  }

  // Header: name and goal on the left, state pill and meta on the right
  const h = view.head;
  const head = el("header", "rt-head");
  const name = el("button", "rt-name");
  name.type = "button";
  name.title = h.nameTip;
  name.setAttribute("aria-haspopup", "listbox");
  name.setAttribute("aria-expanded", String(!!ui.pickerOpen));
  name.setAttribute("aria-controls", "rt-picker");
  name.append(el("span", "rt-name-text", h.name), el("span", "rt-chev"));
  const title = el("h1", "rt-title");
  title.append(name);
  head.append(title);
  const side = el("div", "rt-head-side");
  const tools = el("div", "rt-head-tools");
  if (h.state) {
    const pill = el(
      "span",
      "rt-pill" + (h.state.done ? " rt-pill-done" : ""),
      h.state.word,
    );
    pill.title = h.state.tip;
    tools.append(pill);
  }
  // The Chat button beside the pill (tracker chat design, section 7): shows or hides the session's chat
  const chat = el("button", "rt-chat-toggle");
  chat.type = "button";
  chat.setAttribute("aria-pressed", String(!!ui.chatShown));
  chat.title = ui.chatShown ? S.chatHide : S.chatShow;
  const icon = el("span", "material-symbols-outlined rt-chat-icon", "chat");
  icon.setAttribute("aria-hidden", "true");
  chat.append(icon, el("span", null, S.chatButton));
  chat.addEventListener("click", () => on.chat(!ui.chatShown));
  tools.append(chat);
  side.append(tools);
  if (h.meta) side.append(el("span", "rt-head-meta", h.meta));
  head.append(side);
  if (h.goal)
    head.append(
      el("p", "rt-goal" + (h.goalMissing ? " rt-goal-missing" : ""), h.goal),
    );

  // The picker: a listbox of buttons under the name
  const pk = view.picker;
  const picker = el(
    "div",
    "rt-picker" + (ui.pickerFade ? " rt-picker-fade" : ""),
  );
  picker.id = "rt-picker";
  picker.setAttribute("role", "listbox");
  picker.setAttribute("aria-label", S.pickerLabel);
  picker.hidden = !ui.pickerOpen;
  const option = (id, label, cls) => {
    const b = el("button", "rt-pk" + (cls ? ` ${cls}` : ""));
    b.type = "button";
    b.setAttribute("role", "option");
    b.setAttribute("aria-selected", String(id === view.current));
    b.dataset.pick = id;
    b.append(el("span", "rt-pk-name", label));
    b.title = label;
    b.addEventListener("click", () => on.pick(id));
    picker.append(b);
    return b;
  };
  const sep = () => picker.append(el("div", "rt-pk-sep"));
  const all = option("all", pk.all.label);
  all.append(el("span", "rt-pk-meta", pk.all.meta));
  all.disabled = pk.all.disabled;
  sep();
  for (const j of pk.open) {
    const b = option(j.id, j.name);
    const meta = el("span", "rt-pk-meta");
    meta.append(miniBar(j.percent), el("span", null, j.meta));
    if (j.needs) meta.append(el("span", "rt-needs-n", j.needs));
    b.append(meta);
  }
  if (pk.loose)
    option("none", pk.loose.label).append(
      el("span", "rt-pk-meta", pk.loose.meta),
    );
  if (pk.finished.length) {
    sep();
    picker.append(el("div", "rt-pk-head", S.finished));
    const shown = ui.moreFinished
      ? pk.finished
      : pk.finished.slice(0, pk.shown);
    for (const j of shown)
      option(j.id, j.name, "rt-pk-done").append(
        el("span", "rt-pk-meta", j.meta),
      );
    if (pk.more && !ui.moreFinished) {
      const more = el("button", "rt-pk-more", pk.more);
      more.type = "button";
      more.addEventListener("click", () => on.moreFinished());
      picker.append(more);
    }
  }
  head.append(picker);
  name.addEventListener("click", (e) => {
    e.stopPropagation();
    on.picker(picker.hidden);
  });
  // Arrows move between the options, Esc closes and gives the focus back to the name: the name takes it first, so
  // the redraw that closes the picker puts it on the new name (index.js keeps the focus over a redraw)
  head.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !picker.hidden) {
      e.preventDefault();
      name.focus();
      on.picker(false);
      return;
    }
    if (picker.hidden || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    const opts = [...picker.querySelectorAll("button:not(:disabled)")];
    const at = opts.indexOf(doc.activeElement);
    const step = e.key === "ArrowDown" ? 1 : -1;
    opts[(at + step + opts.length) % opts.length].focus();
  });
  root.append(head);

  // The progress line over the bar
  if (view.progress) {
    const p = view.progress;
    const box = el("div", "rt-progress");
    const line = el("div", "rt-pg-line");
    if (p.figure) line.append(el("span", "rt-pg-fig", p.figure));
    line.append(el("span", "rt-pg-words", p.words));
    if (p.percent) line.append(el("span", "rt-pg-pct", p.percent));
    line.append(el("span", "rt-asof", p.updated));
    const bar = el("div", "rt-bar");
    bar.setAttribute("role", "img");
    bar.setAttribute("aria-label", p.label);
    for (const part of p.parts) {
      const i = el("i", `rt-part rt-${part.part}`);
      i.dataset.count = String(part.n);
      i.dataset.tip = part.tip;
      i.style.flexGrow = String(part.n);
      bar.append(i);
    }
    box.append(line, bar);
    root.append(box);
  }

  // All open: one row per open job
  if (view.jobs) {
    const list = el("div", "rt-jobs");
    for (const j of view.jobs) {
      const row = el("button", "rt-job-row");
      row.type = "button";
      row.dataset.pick = j.id;
      row.title = fill(S.openJob, { name: j.name });
      const text = el("span", "rt-job-text");
      text.append(
        el("span", "rt-job-name", j.name),
        el("span", "rt-job-sub", j.sub),
      );
      const right = el("span", "rt-job-right");
      right.append(el("span", null, j.right));
      if (j.needs) right.append(el("span", "rt-needs-n", j.needs));
      row.append(
        text,
        j.percent == null ? el("span") : miniBar(j.percent),
        right,
      );
      row.addEventListener("click", () => on.pick(j.id));
      list.append(row);
    }
    root.append(list);
  }
  return root;
}

export { goalOf, pageView, renderPage, shownOf };
