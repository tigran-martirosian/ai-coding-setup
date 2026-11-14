// Agents Panel: makes Nimbalyst's "Agents & commands" list (.teammate-panel) readable.
//   - running items on top, then failed, then stopped (style.css, from the app's own data-status)
//   - completed items folded behind a "N done" line (open/closed is remembered)
//   - each row titled in plain words (the "# WHAT THIS DOES:" line of a shell command, else its
//     first line; the full text stays in the tooltip) with one meta line: kind, what it is doing, time,
//     model ("Helper · searching files (Grep) · 2m 10s · Opus"; a finished row "Helper · done in 3s"); effort
//     and tool count are in the meta line's tooltip. The time counts up every second from the task's start; a
//     helper silent for over 2 minutes keeps its last step and adds the wait ("running a command (Bash) for 4m")
//   - a thinking orb by stage in place of the app's spinner (stage.js; the orb at half speed after 2 minutes
//     without a report), a grey tick on done rows, a grey dash on stopped ones, a still dot on failed ones
//   - the header reads "2 running · 1 failed · 1 stopped" / "Nothing running" instead of the app's N/M
//   - a chat scrolled up stays put while the agent writes (scroll-hold.js)
//   - the panel's file list folded to one summary line and its commit box to the branch line (files-fold.js)
//   - the chat's "Thinking..." line: one stage orb in place of the app's three dots, our plain words (chat-state.js)
//   - "Needs you" with the listening orb on a waiting session's row, the chat's Jump to question bar, the question
//     card and this list's summary line; a stage orb and "running" on a running session's row (chat-state.js)
//   - the helper card in the chat: a status mark, the helper's task and "Reviewer finished · 5m · 51 steps · 125k
//     tokens"; opened, its first report line and "worker-full · Opus high · started 8:09 pm" (helper-card.js)
// React owns the rows and rewrites their class names, so this only adds data-ap-* attributes and
// its own .ap-* elements, never changes the app's ones. Styles are in style.css.

import {
  chatSessions,
  needsWhat,
  openQuestions,
  panelSession,
  sessionWords,
  stopNeeds,
  stopThinking,
  syncNeeds,
  syncThinking,
  thinkingView,
} from "./chat-state.js";
import {
  createFold,
  filesSummary,
  startFilesFold,
  stopFilesFold,
  syncFiles,
} from "./files-fold.js";
import {
  helperFacts,
  helperFirstLine,
  helperOpened,
  helperView,
  helperWhy,
  stopHelpers,
  syncHelpers,
} from "./helper-card.js";
import { matchRun, parseRuns, readRuns } from "./runs.js";
import {
  createHold,
  holdEditable,
  holdInnerScrolls,
  startScrollHold,
  stopScrollHold,
} from "./scroll-hold.js";
import { stageOf } from "./stage.js";

// Every visible word. {n} is replaced by a number. The Russian build swaps this whole object.
const STRINGS = {
  running: "{n} running",
  failed: "{n} failed",
  done: "{n} done",
  stopped: "{n} stopped",
  idle: "Nothing running",
  // A finished row's state with its time ({n}, "2m 10s"); without a time the word alone
  doneIn: "done in {n}",
  failedAfter: "failed after {n}",
  stoppedAfter: "stopped after {n}",
  doneWord: "done",
  failedWord: "failed",
  stoppedWord: "stopped",
  // The kind words (the app's "Sub-agent" reads "Helper"), the tool count and the time units ("2m 10s")
  kinds: {
    "Sub-agent": "Helper",
    Command: "Command",
    Workflow: "Workflow",
    "MCP task": "MCP task",
    Task: "Task",
  },
  tools: { one: "{n} tool", many: "{n} tools" },
  units: { h: "h", m: "m", s: "s" },
  // A running row with no report from its helper for over 2 minutes: its last step and how long it has
  // been on it ({step} is the step, else `thinking`; {n} is the time, "4m")
  waiting: "{step} for {n}",
  // A running helper before its first tool: "thinking", or "planning" for a planner; a command the app marks as
  // sent to the background
  thinking: "thinking",
  planning: "planning",
  background: "running in the background",
  // Model families and effort levels of a helper, from the run log; anything else is shown as given (effort) or not at all (model)
  models: { sonnet: "Sonnet", opus: "Opus", haiku: "Haiku", fable: "Fable" },
  efforts: {
    low: "low",
    medium: "medium",
    high: "high",
    xhigh: "very high",
    max: "maximum",
  },
  now: {
    WebFetch: "reading a page",
    WebSearch: "searching the web",
    Read: "reading a file",
    Grep: "searching files",
    Glob: "searching files",
    Edit: "editing a file",
    Write: "editing a file",
    MultiEdit: "editing a file",
    Bash: "running a command",
    PowerShell: "running a command",
    Agent: "waiting on a helper",
  },
  // The folded file list's summary line ("340 files in 9 folders", then "audits 31 · docs 14 · tools 9 · 6 more
  // folders"), its tooltips, and the word after the branch on the folded commit box
  filesLine: "{files} in {folders}",
  files: { one: "{n} file", many: "{n} files" },
  folders: { one: "{n} folder", many: "{n} folders" },
  moreFolders: { one: "{n} more folder", many: "{n} more folders" },
  filesOpen: "Open the full list",
  filesFold: "Fold the list",
  commit: "Commit",
  // The chat's thinking line in place of the app's words ("Thinking...", "Waiting on 3 background tasks...",
  // "Waiting for 2 agents to complete..."); while a tool runs, its "now" words lead instead of "Thinking"
  waitLine: {
    thinking: "Thinking",
    // What the line says in place of plain "Thinking": one of these, picked per turn (chat-state.js syncLine)
    playful: [
      "Pondering",
      "Tinkering",
      "Noodling",
      "Mulling",
      "Brewing",
      "Clauding",
      "Percolating",
      "Musing",
      "Cogitating",
      "Puzzling",
      "Scheming",
      "Conjuring",
      "Simmering",
      "Ruminating",
      "Whirring",
      "Untangling",
      "Crafting",
      "Churning",
      "Hatching",
      "Wrangling",
    ],
    background: "Waiting on a background task",
    backgroundWhat: "Waiting on a background task: {what}",
    backgrounds: "Waiting on {n} background tasks",
    helper: "Waiting for {n} helper to finish",
    helpers: "Waiting for {n} helpers to finish",
  },
  // A session that waits on the user: the word on its row, the chat bar, the question card and this list's summary
  // line; the chat bar's "what waits" ({n} questions, {what} the newest one, {more} the rest); a running session's word
  needs: {
    word: "Needs you",
    one: "1 question: {what}",
    many: "{n} questions: {what} and {more} more",
    oneBare: "1 question",
    manyBare: "{n} questions",
    running: "running",
  },
  // The helper card in the chat ({role} is a role word, {doing} what it does, {n} a number or time). Its meta line:
  // "Helper searching files · 2m · 14 steps", "Helper still searching files · last step 3m ago", "Running in the
  // background · 4m", "Reviewer finished · 5m · 51 steps · 125k tokens", "Stopped early · <reason> · 61k tokens",
  // "Failed · <reason>"; a background helper the agents list does not show: "In the background". Opened:
  // "worker-full · Opus high · started 8:09 pm" (the time in timeLocale's clock)
  helperCard: {
    roles: { helper: "Helper", reviewer: "Reviewer", planner: "Planner" },
    finished: "{role} finished",
    doingLine: "{role} {doing}",
    still: "{role} still {doing}",
    doing: {
      WebFetch: "reading a page",
      WebSearch: "searching the web",
      Read: "reading files",
      Grep: "searching files",
      Glob: "searching files",
      Edit: "editing files",
      Write: "editing files",
      MultiEdit: "editing files",
      Bash: "running a command",
      PowerShell: "running a command",
      Agent: "waiting on a helper",
      Task: "waiting on a helper",
    },
    running: "running",
    background: "Running in the background",
    inBackground: "In the background",
    stopped: "Stopped early",
    failed: "Failed",
    turnLimit: "hit its turn limit",
    steps: { one: "{n} step", many: "{n} steps" },
    tokens: "{n} tokens",
    noTokens: "tokens not reported",
    lastStep: "last step {n} ago",
    started: "started {n}",
    timeLocale: "en-US",
    thousand: "k",
    million: "M",
  },
};

const FOLD_KEY = "agentsPanel.folded";
const EXPLAIN = /#\s*WHAT THIS DOES:\s*([^\n]+)/i;
const KINDS = new Set(["Sub-agent", "Command", "Workflow", "MCP task", "Task"]);
const ELAPSED = /^(?:\d+s|\d+m \d+s|\d+h \d+m)$/;
const TOOLS = /^\d+ tools?$/;
const GROUPS = ["running", "failed", "stopped"];
const WAIT_MS = 2 * 60 * 1000;
const KIND_PREFIX = /^(?:worker|reviewer|sub-agent|helper)\s*:\s*/i;
const CLAUSE_END = / · | \| |;/;
const RUN_POLL_MS = 5000;

// The helper run log (src/runs.js, inlined by build.mjs): read when the set of rows changes and every 5 s while one runs
let runs = [];
let runsKey = null;
let runsAt = 0;
let runsBusy = false;
// The helper cards at the last sync (syncHelpers), and whether their update has failed once (logged once)
let helpers = { cards: 0, running: false, waiting: false };
let helpersFailed = false;

let observer;
let pending = false;
let frame;
let ticker;

const isFolded = () => localStorage.getItem(FOLD_KEY) !== "0";
const fill = (text, n) => text.replace("{n}", String(n));

/** Title of a row: the description (first character upper-cased); for a shell command the
 *  "# WHAT THIS DOES:" line, for a multi-line or very long text its first line. A leading "Worker:" /
 *  "Reviewer:" / "Sub-agent:" / "Helper:" is dropped (the meta line names the kind) and the title ends at
 *  the first " · ", " | " or ";" (the full text stays in the tooltip). */
function plainTitle(text) {
  const t = text.trim();
  if (!t) return "";
  const explained = t.match(EXPLAIN);
  let title;
  if (explained) title = explained[1].trim().replace(/\s+/g, " ");
  else {
    const lines = t.split("\n");
    title = lines.length > 1 ? lines[0].trim() : t;
  }
  title = title.replace(KIND_PREFIX, "").split(CLAUSE_END)[0].trim();
  return title.charAt(0).toUpperCase() + title.slice(1);
}

/** The model family of a log value ("sonnet", "claude-opus-5-5") in the answer language; unknown or "inherited" gives ''. */
function modelWords(model) {
  const family =
    typeof model === "string"
      ? model.toLowerCase().match(/sonnet|opus|haiku|fable/)?.[0]
      : undefined;
  return family ? STRINGS.models[family] : "";
}

/** The effort as given, "xhigh" in words; null gives ''. */
function effortWords(effort) {
  if (typeof effort !== "string" || !effort.trim()) return "";
  const e = effort.trim().toLowerCase();
  return Object.hasOwn(STRINGS.efforts, e) ? STRINGS.efforts[e] : e;
}

/** "Opus high"; just the model without an effort; nothing without a model. */
function runWords(run) {
  const model = modelWords(run?.model);
  return model
    ? [model, effortWords(run.effort)].filter(Boolean).join(" ")
    : "";
}

/** What a running row is doing, from the app's last-tool name: "searching files (Grep)"; an unknown tool stays as is. */
function nowWords(tool) {
  return Object.hasOwn(STRINGS.now, tool)
    ? `${STRINGS.now[tool]} (${tool})`
    : tool;
}

/** Kind, elapsed and tool count in the answer language. */
const kindWord = (kind) => STRINGS.kinds[kind] ?? kind;
const elapsedWords = (e) =>
  e.replace(/(\d+)([hms])/g, (_, n, u) => n + STRINGS.units[u]);
const toolsWords = (t) => {
  if (!t) return "";
  const n = parseInt(t, 10);
  return fill(n === 1 ? STRINGS.tools.one : STRINGS.tools.many, n);
};

/** Splits the app's meta string (Kind · elapsed? · N tools? · lastTool? · failed|stopped?) or returns null when it does not fit. */
function parseMeta(meta) {
  const parts = meta.split(" · ").map((p) => p.trim());
  const kind = parts.shift();
  if (!KINDS.has(kind)) return null;
  const out = { kind, elapsed: "", tools: "", last: "" };
  if (parts.length && ELAPSED.test(parts[0])) out.elapsed = parts.shift();
  if (parts.length && TOOLS.test(parts[0])) out.tools = parts.shift();
  if (
    parts.length &&
    (parts[parts.length - 1] === "failed" ||
      parts[parts.length - 1] === "stopped")
  )
    parts.pop();
  if (parts.length > 1) return null;
  if (parts.length) out.last = parts[0];
  return out;
}

/** A time in the app's format: "45s", "2m 10s", "1h 5m". */
function clock(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
}

/** The row's task object from the app's React props ({ startedAt, durationMs, ... }; depth 1), or null. */
function rowTask(item) {
  const key = Object.keys(item).find((k) => k.startsWith("__reactFiber"));
  for (let f = key && item[key], d = 0; f && d < 4; f = f.return, d++) {
    const t = f.memoizedProps?.task;
    if (!t || typeof t.startedAt !== "number") continue;
    // The node keeps the fiber it was made with; after a re-render the newer task can be on its alternate
    const other = f.alternate?.memoizedProps?.task;
    return other && (other.durationMs || 0) > (t.durationMs || 0) ? other : t;
  }
  return null;
}

/** Our meta line for a row, or null when the app's meta does not parse (then the app's stays visible).
 *  The app's time on a running row is its durationMs, moved on only when the helper reports a tool call,
 *  so a helper that thinks for minutes looks frozen. With the row's task, a running row counts from
 *  task.startedAt to `now`, and one whose last report (startedAt + durationMs) is over WAIT_MS old
 *  adds how long it has been on its last step ("searching files (Grep) for 4m") and slows its orb. One line:
 *  kind, what it is doing, time, model with its effort ("Opus high", from the helper's log line `run`,
 *  { model, effort, type }; the model alone when the log has no effort); a finished row "Helper · done in 3s".
 *  The tooltip `tip` adds the model and effort in every state, and the tool count. `text` is the app's description
 *  (stage.js reads a command's text for a check). Returns { parts: [{ text, part }], tip, orb, slow }. */
function rowView(
  meta,
  status,
  task = null,
  now = Date.now(),
  run = null,
  text = "",
) {
  const m = parseMeta(meta);
  if (!m) return null;
  const live = status === "running" && task;
  const kind = { text: kindWord(m.kind), part: "kind" };
  const elapsed = elapsedWords(live ? clock(now - task.startedAt) : m.elapsed);
  let parts,
    orb = null,
    slow = false;
  if (status === "running") {
    orb = stageOf({ kind: m.kind, tool: m.last, role: run?.type ?? "", text });
    // Only a sub-agent reports tool calls; a command's durationMs stays 0
    const silent =
      live && m.kind === "Sub-agent"
        ? now - (task.startedAt + (task.durationMs || 0))
        : 0;
    slow = silent > WAIT_MS;
    let step = m.last && nowWords(m.last);
    if (!step && m.kind === "Sub-agent")
      step = orb === "shaping" ? STRINGS.planning : STRINGS.thinking;
    if (!step && m.kind === "Command" && task?.isBackgrounded === true)
      step = STRINGS.background;
    const doing = slow
      ? STRINGS.waiting
          .replace("{step}", step || STRINGS.thinking)
          .replace("{n}", elapsedWords(`${Math.floor(silent / 60000)}m`))
      : step;
    parts = [
      kind,
      { text: doing, part: "doing" },
      { text: elapsed, part: "time" },
      { text: runWords(run), part: "model" },
    ];
  } else {
    const outcome = {
      completed: [STRINGS.doneIn, STRINGS.doneWord],
      failed: [STRINGS.failedAfter, STRINGS.failedWord],
      stopped: [STRINGS.stoppedAfter, STRINGS.stoppedWord],
    }[status];
    if (!outcome) return null;
    parts = [
      kind,
      { text: elapsed ? fill(outcome[0], elapsed) : outcome[1], part: status },
    ];
  }
  parts = parts.filter((p) => p.text);
  const tip = [
    ...parts.filter((p) => p.part !== "model").map((p) => p.text),
    runWords(run),
    toolsWords(m.tools),
  ].filter(Boolean);
  return { parts, tip: tip.join(" · "), orb, slow };
}

/** The meta line as text, or null when the app's meta does not parse (then the app's stays visible). */
function metaWords(meta, status, task = null, now = Date.now(), run = null) {
  const view = rowView(meta, status, task, now, run);
  return view && view.parts.map((p) => p.text).join(" · ");
}

/** The meta line's tooltip: the line plus the effort and the tool count. */
function metaTip(meta, status, task = null, now = Date.now(), run = null) {
  return rowView(meta, status, task, now, run)?.tip ?? null;
}

/** Header reading in words: every state above the done fold that has rows, running first ("2 running · 1 failed ·
 *  1 stopped"); only finished rows read "Nothing running" (the fold line already counts them). While the panel's
 *  session waits on the user (`c.needs`), "Needs you" leads, with no number (the count shows on the session row and
 *  the chat bar only), and stands alone in place of "Nothing running". `parts` keep each count's state for its tone. */
function countWords(c) {
  const parts = ["running", "failed", "stopped"]
    .filter((s) => c[s])
    .map((s) => ({ text: fill(STRINGS[s], c[s]), state: s }));
  if (c.needs) parts.unshift({ text: STRINGS.needs.word, state: "needs" });
  if (!parts.length) parts.push({ text: STRINGS.idle, state: "" });
  return {
    text: parts.map((p) => p.text).join(" · "),
    running: c.running > 0,
    parts,
  };
}

function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/** Sets an attribute only when it differs, so the orb mount and our observer see no needless change. */
function setAttr(node, name, value) {
  if (value === null) {
    if (node.hasAttribute(name)) node.removeAttribute(name);
  } else if (node.getAttribute(name) !== String(value))
    node.setAttribute(name, String(value));
}

/** Spans for `parts` ({ text, <role> }) joined by " · " separators, each span marked with its role. */
function setParts(node, parts, role) {
  const key = parts.map((p) => `${p[role]}:${p.text}`).join("|");
  if (node.dataset.apKey === key) return;
  node.dataset.apKey = key;
  node.replaceChildren(
    ...parts.flatMap((p, i) => {
      const span = document.createElement("span");
      span.className = "ap-part";
      span.textContent = p.text;
      if (p[role]) span.dataset.apPart = p[role];
      if (!i) return [span];
      const sep = document.createElement("span");
      sep.className = "ap-sep";
      sep.textContent = " · ";
      return [sep, span];
    }),
  );
}

/** The row's state mark in the app's status slot: an orb while running (when the meta line parsed, so its stage is
 *  known; otherwise the app's spinner stays), a tick, a still dot or a dash once finished. */
function setMark(item, view) {
  const slot = item.querySelector(":scope > div:first-child");
  const status = item.dataset.status;
  const running = status === "running";
  const known =
    (running && view?.orb) ||
    status === "completed" ||
    status === "failed" ||
    status === "stopped";
  let mark = slot?.querySelector(":scope > .ap-mark");
  if (!slot || !known) {
    mark?.remove();
    delete item.dataset.apMark;
    return;
  }
  const tag = running ? "CANVAS" : "SPAN";
  if (mark && mark.tagName !== tag) {
    mark.remove();
    mark = null;
  }
  if (!mark) {
    mark = document.createElement(tag.toLowerCase());
    mark.className = "ap-mark";
    slot.append(mark);
  }
  if (running) {
    setAttr(mark, "data-orb", view.orb);
    setAttr(mark, "data-orb-px", "24");
    setAttr(mark, "data-orb-speed", view.slow ? "0.5" : null);
    setAttr(
      mark,
      "aria-label",
      view.parts.find((p) => p.part === "doing")?.text ?? null,
    );
  } else {
    setAttr(mark, "data-ap-mark", status);
    setAttr(mark, "aria-hidden", "true");
    // The tick is a Material Symbols glyph (the app's icon font); the dot and the dash are drawn in style.css
    mark.classList.toggle("material-symbols-outlined", status === "completed");
    setText(mark, status === "completed" ? "check" : "");
  }
  if (item.dataset.apMark !== "") item.dataset.apMark = "";
}

function decorateRow(item, run) {
  const body = item.querySelector(":scope > .flex-1");
  if (!body) return;
  const appNodes = [...body.children].filter(
    (c) =>
      !c.classList.contains("ap-title") && !c.classList.contains("ap-meta"),
  );
  const original = appNodes[0];
  if (!original) return;

  const text = original.textContent;
  if (item.dataset.apSource !== text) {
    item.dataset.apSource = text;
    body.querySelector(":scope > .ap-title")?.remove();
    const title = plainTitle(text);
    if (title) {
      const node = document.createElement("div");
      node.className = "ap-title";
      node.textContent = title;
      node.title = text.trim();
      body.append(node);
      item.dataset.apTitle = "1";
    } else {
      delete item.dataset.apTitle;
    }
  }

  const appMeta = appNodes[1]?.textContent ?? "";
  const running = item.dataset.status === "running";
  const key = `${item.dataset.status}|${appMeta}|${runWords(run)}|${run?.type ?? ""}`;
  // A running row's time moves every second, so it is worked out on every pass
  if (
    !running &&
    item.dataset.apMetaSource === key &&
    item.querySelector(":scope > div:first-child > .ap-mark")
  )
    return;
  item.dataset.apMetaSource = key;
  const view = appMeta
    ? rowView(
        appMeta,
        item.dataset.status,
        running ? rowTask(item) : null,
        Date.now(),
        run,
        text,
      )
    : null;
  setMark(item, view);
  let node = body.querySelector(":scope > .ap-meta");
  if (view === null) {
    node?.remove();
    delete item.dataset.apMeta;
    return;
  }
  if (!node) {
    node = document.createElement("div");
    node.className = "ap-meta";
    body.append(node);
  }
  setParts(node, view.parts, "part");
  if (node.title !== view.tip) node.title = view.tip;
  item.dataset.apMeta = "1";
}

/** `chats` is chatSessions(): the panel's session waits on the user while its chat says so. */
function updateList(scroller, chats) {
  const items = [...scroller.querySelectorAll(".task-item")];
  if (!items.length) return;
  const counts = { running: 0, failed: 0, stopped: 0, completed: 0 };
  const panel = scroller.closest(".teammate-panel");
  counts.needs = !!(panel && chats.get(panelSession(panel))?.waiting);
  for (const item of items)
    if (item.dataset.status in counts) counts[item.dataset.status]++;
  const folded = isFolded() ? "1" : "0";
  if (scroller.dataset.apFolded !== folded) scroller.dataset.apFolded = folded;

  // 8px above the first row of a group that has another group above it
  let seen = false;
  for (const group of GROUPS) {
    let first = true;
    for (const item of items) {
      if (item.dataset.status !== group) continue;
      if (first && seen) item.dataset.apFirst = "";
      else delete item.dataset.apFirst;
      first = false;
    }
    if (!first) seen = true;
  }
  for (const item of items)
    if (!GROUPS.includes(item.dataset.status)) delete item.dataset.apFirst;

  let fold = scroller.querySelector(":scope > .ap-fold");
  if (!counts.completed) {
    fold?.remove();
  } else {
    if (!fold) {
      fold = document.createElement("button");
      fold.type = "button";
      fold.className = "ap-fold";
      fold.innerHTML =
        '<span class="material-symbols-outlined ap-fold-icon" aria-hidden="true">expand_more</span><span class="ap-fold-text"></span>';
      fold.onclick = () => {
        localStorage.setItem(FOLD_KEY, isFolded() ? "0" : "1");
        queue();
      };
      scroller.append(fold);
    }
    setText(
      fold.querySelector(".ap-fold-text"),
      fill(STRINGS.done, counts.completed),
    );
    fold.setAttribute("aria-expanded", folded === "0" ? "true" : "false");
  }

  // Header: our reading in words replaces the app's N/M (only while the list is open and we can count)
  const header = scroller.previousElementSibling;
  if (
    header?.tagName === "BUTTON" &&
    header.querySelector(":scope > .ml-auto.font-mono")
  ) {
    header.dataset.apHeader = "";
    let count = header.querySelector(":scope > .ap-count");
    if (!count) {
      count = document.createElement("span");
      count.className = "ap-count";
      header.append(count);
    }
    const reading = countWords(counts);
    setParts(count, reading.parts, "state");
    if (reading.running) count.dataset.apState = "running";
    else delete count.dataset.apState;
  }
}

/** The app's own description text of a row (what the title is made from). */
function rowText(item) {
  const body = item.querySelector(":scope > .flex-1");
  const original =
    body &&
    [...body.children].find(
      (c) =>
        !c.classList.contains("ap-title") && !c.classList.contains("ap-meta"),
    );
  return original?.textContent ?? "";
}

/** The agents list's tasks by their tool id, so a background helper's card finds its own (the rows' React props). */
function helperTasks(items) {
  const tasks = new Map();
  for (const item of items) {
    const task = rowTask(item);
    if (task?.toolUseId) tasks.set(task.toolUseId, task);
  }
  return tasks;
}

/** Reads the run log when the set of rows has changed, and every 5 s while a row or a helper card runs or a finished
 *  card waits for its log result; a new reading redraws. */
function refreshRuns(items) {
  const key = items.map(rowText).join("\n");
  const running =
    items.some((i) => i.dataset.status === "running") ||
    helpers.running ||
    helpers.waiting;
  if (
    runsBusy ||
    (key === runsKey && !(running && Date.now() - runsAt >= RUN_POLL_MS))
  )
    return;
  runsKey = key;
  runsAt = Date.now();
  runsBusy = true;
  readRuns().then((read) => {
    runsBusy = false;
    if (read) runs = read;
    if (observer) queue();
  });
}

function sync() {
  pending = false;
  let chats = new Map();
  try {
    chats = chatSessions();
  } catch (e) {
    console.error("[agents-panel] could not read the mounted chats:", e);
  }
  let items = [];
  try {
    const scrollers = new Set();
    items = [...document.querySelectorAll(".teammate-panel .task-item")];
    if (items.length) refreshRuns(items);
    const matched = matchRun(items.map(rowText), runs);
    for (const [n, item] of items.entries()) {
      decorateRow(item, matched[n]);
      const scroller = item.closest(".overflow-y-auto");
      if (scroller) scrollers.add(scroller);
    }
    for (const scroller of scrollers) updateList(scroller, chats);
    // A collapsed list has no rows to count: give the header back to the app's N/M
    for (const header of document.querySelectorAll(
      ".teammate-panel [data-ap-header]",
    )) {
      if (scrollers.has(header.nextElementSibling)) continue;
      header.querySelector(":scope > .ap-count")?.remove();
      delete header.dataset.apHeader;
    }
  } catch (e) {
    console.error("[agents-panel] could not update the agents list:", e);
  }
  try {
    syncThinking(STRINGS, stageOf);
  } catch (e) {
    console.error(
      "[agents-panel] could not update the chat's thinking line:",
      e,
    );
  }
  // After the thinking line: a running session's row takes that line's orb
  try {
    syncNeeds(STRINGS, chats);
  } catch (e) {
    console.error(
      "[agents-panel] could not update the needs-you and running marks:",
      e,
    );
  }
  try {
    syncFiles(STRINGS);
  } catch (e) {
    console.error(
      "[agents-panel] could not fold the file list and commit box:",
      e,
    );
  }
  try {
    helpers = syncHelpers(
      STRINGS.helperCard,
      STRINGS.units,
      stageOf,
      (model, effort) => runWords({ model, effort }),
      runs,
      helperTasks(items),
      Date.now(),
    );
    // With the agents list closed there are no rows to start a reading, so the cards start one themselves
    if (helpers.cards) refreshRuns(items);
  } catch (e) {
    helpers = { cards: 0, running: false, waiting: false };
    if (!helpersFailed)
      console.error("[agents-panel] could not update the helper cards:", e);
    helpersFailed = true;
  }
}

function queue() {
  if (pending) return;
  pending = true;
  frame = requestAnimationFrame(sync);
}

function removeAll() {
  document
    .querySelectorAll(".ap-fold, .ap-title, .ap-meta, .ap-count, .ap-mark")
    .forEach((n) => n.remove());
  document
    .querySelectorAll(
      "[data-ap-folded], [data-ap-title], [data-ap-source], [data-ap-meta], [data-ap-meta-source], [data-ap-first], [data-ap-header], [data-ap-mark]",
    )
    .forEach((n) => {
      delete n.dataset.apFolded;
      delete n.dataset.apTitle;
      delete n.dataset.apSource;
      delete n.dataset.apMeta;
      delete n.dataset.apMetaSource;
      delete n.dataset.apFirst;
      delete n.dataset.apHeader;
      delete n.dataset.apMark;
    });
}

/** Starts the shared thinking-orbs mount (shared/orbs/orbs.js, which build.mjs puts in place of the marker line;
 *  it keeps one copy per window, so a second extension or a second activate adds no second loop). */
function loadOrbs() {
  // ORBS-MOUNT (build.mjs)
  if (!window.Orbs)
    throw new Error(
      "the thinking-orbs mount is missing: load dist/index.js built by build.mjs, not src/index.js",
    );
}

function activate() {
  if (observer) return;
  // One copy per window: a test copy injected by hand takes over from the installed one
  if (window.__agentsPanel && window.__agentsPanel.deactivate !== deactivate) {
    window.__agentsPanel.deactivate();
  }
  window.__agentsPanel = { deactivate };
  loadOrbs();
  observer = new MutationObserver(queue);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true,
    attributes: true,
    // data-status: an agent row's state; class and data-state: a session row's status and a question card answered
    attributeFilter: ["data-status", "class", "data-state"],
  });
  // Running rows' and helper cards' time, once a second while any runs (or a finished card waits for its log result)
  ticker = setInterval(() => {
    if (
      helpers.running ||
      helpers.waiting ||
      document.querySelector(
        '.teammate-panel .task-item[data-status="running"]',
      )
    )
      queue();
  }, 1000);
  startFilesFold(queue);
  queue();
  startScrollHold();
}

function deactivate() {
  stopScrollHold();
  stopFilesFold();
  stopThinking();
  stopNeeds();
  stopHelpers();
  helpers = { cards: 0, running: false, waiting: false };
  observer?.disconnect();
  observer = undefined;
  clearInterval(ticker);
  ticker = undefined;
  cancelAnimationFrame(frame);
  pending = false;
  removeAll();
}

export {
  activate,
  clock,
  countWords,
  createFold,
  createHold,
  deactivate,
  effortWords,
  filesSummary,
  helperFacts,
  helperFirstLine,
  helperOpened,
  helperTasks,
  helperView,
  helperWhy,
  holdEditable,
  holdInnerScrolls,
  matchRun,
  metaTip,
  metaWords,
  modelWords,
  needsWhat,
  nowWords,
  openQuestions,
  parseMeta,
  parseRuns,
  plainTitle,
  rowTask,
  rowView,
  runWords,
  STRINGS,
  sessionWords,
  stageOf,
  syncHelpers,
  thinkingView,
};
