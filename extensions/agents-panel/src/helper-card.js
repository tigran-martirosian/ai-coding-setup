// The helper card in the chat (chat-column design 4 and its high-end round): the app draws a finished helper as one
// folded line ("Sub-Agent [worker-full]", a chevron). This fills that line in, inside the app's own card button (so a
// click still opens and closes it): a status mark, the helper's task, and one meta line that starts with one status word:
//   - running                  stage orb · "Helper searching files · 2m · 14 steps" (half speed and "still" after 2 min
//                              with no step: "Helper still searching files · last step 3m ago")
//   - running in the background  orb · "Running in the background · 4m"
//   - done                     grey tick (drawn once when seen finishing) · "Reviewer finished · 5m · 51 steps · 125k tokens"
//   - done in the background   grey tick · "Helper finished · 7m · tokens not reported" (tokens only when the app has them)
//   - stopped with work left   grey dash · "Stopped early · <the report's reason> · 61k tokens"
//   - failed                   error dot · "Failed · <the first error line>"
//   - opened                   the same head; then the first report line and "worker-full · Opus high · started 8:09 pm"
//                              above the app's own child tool list
// Why a script and not the app's tool-widget slot: Nimbalyst 0.83.0 keeps setTranscriptToolWidgets out of the modules it
// hands extensions (window.__nimbalyst_extensions["@nimbalyst/runtime"] has only the markdown slot), and a widget for
// "Task" would replace the whole card, child tool list included.
// Where each fact comes from: the card's React props (TranscriptToolCard's toolMsg: isBackground, agentType, model,
// effort, the child tool calls, the result's first 500 characters, createdAt); the helper run log by tool id
// (agent-run-log: description, type, model, effort, result and why, totalTokens, totalDurationMs, totalToolUseCount);
// for a background helper, the agents list's task by tool id (status, durationMs, toolCount, tokenCount), the only
// place the app keeps its end. A part with no source is left off the line, never guessed.
// build.mjs inlines this file into dist/index.js (one scope with the other files, so its names are its own), so it
// must not import anything: the stage, clock and model words come in as arguments.

const HC_WAIT_MS = 2 * 60 * 1000;
const HC_REVIEW = /review/i;
const HC_PLAN = /plan/i;
const HC_SVG = "http://www.w3.org/2000/svg";
const HC_TICK = "M3.5 8.5l3 3 6-7";
const HC_CHEV = "M6 4l4 4-4 4";

const hcMissed = new Set();
// Tool ids seen running in this window: only those draw their tick when they finish
const hcSeenRunning = new Set();
// Tool id -> when its card first showed a result with no log result yet
const hcEnded = new Map();

/** Logs a missing part of the helper card once per window. */
function hcMissing(what) {
  if (hcMissed.has(what)) return;
  hcMissed.add(what);
  console.error(
    `[agents-panel] ${what} not found: the app's markup or data have changed, so the helper card is left as the app draws it`,
  );
}

const hcFill = (text, map) =>
  text.replace(/\{(\w+)\}/g, (m, k) => (k in map ? String(map[k]) : m));

/** The role word from the agent type: Reviewer, Planner, else Helper. */
function helperRole(type, s) {
  if (HC_REVIEW.test(type || "")) return s.roles.reviewer;
  if (HC_PLAN.test(type || "")) return s.roles.planner;
  return s.roles.helper;
}

/** A short time for the meta line: "45s", "5m", "1h 5m". */
function helperTime(ms, units) {
  const sec = Math.max(0, Math.floor(ms / 1000));
  if (sec < 60) return `${sec}${units.s}`;
  if (sec < 3600) return `${Math.floor(sec / 60)}${units.m}`;
  return `${Math.floor(sec / 3600)}${units.h} ${Math.floor((sec % 3600) / 60)}${units.m}`;
}

/** "850 tokens", "125k tokens", "1.2M tokens". */
function helperTokens(n, s) {
  const v =
    n >= 1e6
      ? `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}${s.million}`
      : n >= 1000
        ? `${Math.round(n / 1000)}${s.thousand}`
        : String(n);
  return hcFill(s.tokens, { n: v });
}

const hcSteps = (n, s) => hcFill(n === 1 ? s.steps.one : s.steps.many, { n });

/** The report's reason in plain words: no "BLOCKED S3:", no "What is left:", the turn limit named. */
function helperWhy(why, s) {
  if (typeof why !== "string" || !why.trim()) return "";
  if (why === "turn limit") return s.turnLimit;
  return why
    .replace(/^error:\s*/i, "")
    .replace(/^BLOCKED\b[^:]*:\s*/, "")
    .replace(
      /^(?:what(?:'s| is) (?:still )?left|left to do|still to do|not done(?: yet)?)\b[\s*:.-]*/i,
      "",
    )
    .trim();
}

/** The first line of a report, without Markdown marks; '' when none. */
function helperFirstLine(text) {
  if (typeof text !== "string") return "";
  const line = text.split("\n").find((l) => l.replace(/[#>*_`\-\s]/g, ""));
  return line
    ? line
        .replace(/^[\s#>*-]+/, "")
        .replace(/[*_`]/g, "")
        .trim()
    : "";
}

/** The card's state, mark and meta line. `f` holds the facts (see helperFacts); `stage` is stage.js's stageOf; `s` is
 *  STRINGS.helperCard; `units` STRINGS.units; `now` in ms. Returns { state, mark, orb, slow, parts: [{ text, part }] }. */
function helperView(f, s, units, stage, now) {
  const role = helperRole(f.type, s);
  const p = (text, part) => ({ text, part });
  const tokens = (n) =>
    Number.isFinite(n) && n > 0 ? p(helperTokens(n, s), "tokens") : null;
  const time = (ms) =>
    Number.isFinite(ms) && ms > 0 ? p(helperTime(ms, units), "time") : null;
  const steps = (n) =>
    Number.isFinite(n) && n > 0 ? p(hcSteps(n, s), "steps") : null;
  const out = (state, mark, parts, extra = {}) => ({
    state,
    mark,
    orb: null,
    slow: false,
    ...extra,
    parts: parts.filter(Boolean),
  });
  const task = f.task;
  if (
    f.result === "fail" ||
    task?.status === "failed" ||
    (f.isError && f.hasResult)
  )
    return out("failed", "dot", [
      p(s.failed, "state"),
      helperWhy(f.why, s) ? p(helperWhy(f.why, s), "why") : null,
    ]);
  if (f.result === "partial" || task?.status === "stopped")
    return out("stopped", "dash", [
      p(s.stopped, "state"),
      helperWhy(f.why, s) ? p(helperWhy(f.why, s), "why") : null,
      tokens(f.totalTokens ?? task?.tokenCount),
    ]);
  if (f.background) {
    if (!task)
      return out("background-unknown", "pending", [p(s.inBackground, "state")]);
    if (task.status === "running")
      return out(
        "background",
        "orb",
        [p(s.background, "state"), time(now - task.startedAt)],
        {
          orb: stage({ kind: "", tool: task.lastToolName || "", role: f.type }),
        },
      );
    return out("done-background", "tick", [
      p(hcFill(s.finished, { role }), "state"),
      time(task.durationMs),
      steps(task.toolCount),
      tokens(task.tokenCount) || p(s.noTokens, "tokens"),
    ]);
  }
  if (!f.hasResult) {
    const doing = Object.hasOwn(s.doing, f.lastTool)
      ? s.doing[f.lastTool]
      : s.running;
    const quiet = now - (f.lastStepAt ?? f.startedAt);
    const orb = stage({ kind: "", tool: f.lastTool || "", role: f.type });
    if (f.lastStepAt && quiet > HC_WAIT_MS)
      return out(
        "running",
        "orb",
        [
          p(hcFill(s.still, { role, doing }), "state"),
          p(hcFill(s.lastStep, { n: helperTime(quiet, units) }), "time"),
        ],
        { orb, slow: true },
      );
    return out(
      "running",
      "orb",
      [
        p(hcFill(s.doingLine, { role, doing }), "state"),
        time(now - f.startedAt),
        steps(f.childSteps),
      ],
      { orb },
    );
  }
  return out("done", "tick", [
    p(hcFill(s.finished, { role }), "state"),
    time(f.totalDurationMs),
    steps(f.totalToolUseCount),
    tokens(f.totalTokens) || p(s.noTokens, "tokens"),
  ]);
}

/** The card's toolMsg from the app's React props (TranscriptToolCard, a few fibers up), or null. */
function helperMsg(container) {
  const key = Object.keys(container).find((k) => k.startsWith("__reactFiber"));
  for (let f = key && container[key], d = 0; f && d < 4; f = f.return, d++) {
    const msg = f.memoizedProps?.toolMsg;
    if (msg) return msg;
  }
  return null;
}

/** The facts of one card: its props, its run-log line (by tool id) and, for a background helper, its agents-list task. */
function helperFacts(msg, run, task) {
  const call = msg.toolCall;
  const sub = msg.subagent || {};
  const kids = (sub.childEvents || []).filter((c) => c?.toolCall);
  const last = kids[kids.length - 1];
  const at = (d) =>
    d instanceof Date
      ? d.getTime()
      : typeof d === "number"
        ? d
        : Date.parse(d) || null;
  return {
    id: call.providerToolCallId,
    background:
      call.arguments?.run_in_background === true || sub.isBackground === true,
    hasResult: call.result != null && call.result !== "",
    isError: msg.isError === true,
    report: call.result,
    prompt:
      typeof call.arguments?.prompt === "string" ? call.arguments.prompt : "",
    description: run?.description || "",
    type: run?.type || sub.agentType || "",
    model: run?.model || sub.model || null,
    effort: run?.effort || sub.reasoningEffort || null,
    result: run?.result || null,
    why: run?.why || null,
    totalTokens: run?.totalTokens,
    totalDurationMs: run?.totalDurationMs,
    totalToolUseCount: run?.totalToolUseCount,
    startedAt: at(msg.createdAt) ?? Date.now(),
    lastStepAt: last ? at(last.createdAt) : null,
    lastTool: last?.toolCall.toolName || "",
    childSteps: kids.length,
    task: task || null,
  };
}

/** One path in a 16px svg box. */
function hcPath(d, cls) {
  const svg = document.createElementNS(HC_SVG, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", cls);
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(HC_SVG, "path");
  path.setAttribute("d", d);
  svg.append(path);
  return svg;
}

/** The status mark: the stage orb (shared/orbs draws it and keeps it still under reduced motion), the tick (drawn once
 *  when `draw`), or a plain dash, dot or pending ring. */
function hcMark(view, draw) {
  const mark = document.createElement("span");
  mark.className = "ap-helper-mark";
  if (view.mark === "orb") {
    const orb = document.createElement("canvas");
    orb.className = "ap-helper-orb";
    orb.dataset.orb = view.orb;
    orb.dataset.orbPx = "24";
    if (view.slow) orb.dataset.orbSpeed = "0.5";
    mark.append(orb);
  } else if (view.mark === "tick") {
    mark.append(
      hcPath(
        HC_TICK,
        draw ? "ap-helper-tick ap-helper-draw" : "ap-helper-tick",
      ),
    );
  } else {
    const shape = document.createElement("span");
    shape.className = `ap-helper-${view.mark}`;
    mark.append(shape);
  }
  return mark;
}

/** The meta line's parts, one span each, with a dot between them. */
function hcMeta(meta, parts) {
  const text = parts.map((x) => x.text).join(" · ");
  if (meta.dataset.apText === text) return;
  meta.dataset.apText = text;
  meta.replaceChildren();
  parts.forEach((x, i) => {
    if (i) {
      const sep = document.createElement("span");
      sep.className = "ap-sep";
      sep.textContent = "·";
      meta.append(sep);
    }
    const span = document.createElement("span");
    span.dataset.apPart = x.part;
    span.textContent = x.text;
    meta.append(span);
  });
}

/** The folded head inside the app's button; rebuilt only when the mark changes, so the orb keeps running. */
function hcHead(button, view, taskText, draw) {
  const key = `${view.state}|${view.mark}|${view.orb}|${view.slow}`;
  let head = button.querySelector(":scope > .ap-helper");
  if (!head || head.dataset.apKey !== key) {
    head?.remove();
    head = document.createElement("span");
    head.className = "ap-helper";
    head.dataset.apKey = key;
    const text = document.createElement("span");
    text.className = "ap-helper-text";
    const task = document.createElement("span");
    task.className = "ap-helper-task";
    const meta = document.createElement("span");
    meta.className = "ap-helper-meta";
    text.append(task, meta);
    head.append(hcMark(view, draw), text, hcPath(HC_CHEV, "ap-helper-chev"));
    button.append(head);
  }
  head.querySelector(".ap-helper-task").textContent = taskText;
  hcMeta(head.querySelector(".ap-helper-meta"), view.parts);
}

/** The opened card's first lines, above the app's child tool list: the report's first line, then
 *  "worker-full · Opus high · started 8:09 pm". */
function hcBody(expanded, lines) {
  let body = expanded.querySelector(":scope > .ap-helper-body");
  const text = lines.join("\n");
  if (body?.dataset.apText === text) return;
  if (!body) {
    body = document.createElement("div");
    body.className = "ap-helper-body";
    expanded.prepend(body);
  }
  body.dataset.apText = text;
  body.replaceChildren(
    ...lines.map((line, i) => {
      const div = document.createElement("div");
      div.className =
        i === lines.length - 1 ? "ap-helper-detail" : "ap-helper-report";
      div.textContent = line;
      return div;
    }),
  );
}

/** Our parts off one card. */
function hcClear(card) {
  card
    .querySelectorAll(
      ":scope > .rich-transcript-tool-button > .ap-helper, :scope > .rich-transcript-tool-expanded > .ap-helper-body",
    )
    .forEach((n) => n.remove());
  delete card.dataset.apHelper;
}

/** Fills in every helper card in the window. `s` = STRINGS.helperCard, `units` = STRINGS.units, `stage` = stageOf,
 *  `words(model, effort)` = "Opus high" or '', `runs` = the run-log lines, `tasks` = Map of tool id -> agents-list task.
 *  Returns { cards, running, waiting }: how many helper cards, a card still runs (the ticker goes on), a finished card
 *  has no log result yet (the log is read again). */
function syncHelpers(s, units, stage, words, runs, tasks, now) {
  let cards = 0;
  let running = false;
  let waiting = false;
  for (const container of document.querySelectorAll(
    ".rich-transcript-tool-container",
  )) {
    const card = container.querySelector(
      ":scope > .rich-transcript-tool-card.sub-agent",
    );
    if (!card) continue;
    const msg = helperMsg(container);
    if (!msg?.toolCall) {
      hcMissing("the helper card's props (toolMsg)");
      hcClear(card);
      continue;
    }
    const button = card.querySelector(":scope > .rich-transcript-tool-button");
    if (!button) {
      hcMissing("the helper card's button");
      continue;
    }
    const id = msg.toolCall.providerToolCallId;
    const run = id ? runs.find((r) => r.toolUseId === id) : null;
    const f = helperFacts(msg, run, id ? tasks.get(id) : null);
    const view = helperView(f, s, units, stage, now);
    cards++;
    if (view.state === "running" || view.state === "background") {
      running = true;
      if (id) hcSeenRunning.add(id);
    }
    // A helper seen running here whose log line has no result yet: the hook writes it as the helper ends, so the
    // reading goes on for up to 2 minutes after the card shows its result (then the card stays as it is)
    if (f.hasResult && !f.background && hcSeenRunning.has(id) && !run?.result) {
      if (!hcEnded.has(id)) hcEnded.set(id, now);
      if (now - hcEnded.get(id) < HC_WAIT_MS) waiting = true;
    }
    card.dataset.apHelper = view.state;
    hcHead(
      button,
      view,
      f.description || helperFirstLine(f.prompt),
      view.mark === "tick" && hcSeenRunning.has(id),
    );
    const expanded = card.querySelector(
      ":scope > .rich-transcript-tool-expanded",
    );
    if (expanded) hcBody(expanded, helperOpened(f, s, words));
  }
  return { cards, running, waiting };
}

/** The opened card's lines: the report's first line (a finished helper that is not in the background), then
 *  "worker-full · Opus high · started 8:09 pm". */
function helperOpened(f, s, words) {
  const started = new Date(f.startedAt)
    .toLocaleTimeString(s.timeLocale, { hour: "numeric", minute: "2-digit" })
    .toLowerCase();
  const detail = [
    f.type,
    words(f.model, f.effort),
    hcFill(s.started, { n: started }),
  ]
    .filter(Boolean)
    .join(" · ");
  const report = f.hasResult && !f.background ? helperFirstLine(f.report) : "";
  return report ? [report, detail] : [detail];
}

/** Takes every helper card back to the app's own look (deactivate). */
function stopHelpers() {
  document
    .querySelectorAll(".rich-transcript-tool-card[data-ap-helper]")
    .forEach(hcClear);
  hcSeenRunning.clear();
  hcEnded.clear();
}

export {
  helperFacts,
  helperFirstLine,
  helperOpened,
  helperView,
  helperWhy,
  stopHelpers,
  syncHelpers,
};
