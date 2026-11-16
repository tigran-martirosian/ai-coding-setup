// The live part of the session view (DS2 "Work rows", "Helpers", "Context", queued messages): the PC follows the
// session (session.watch, renewed every 9 minutes, as the PC drops a watch after 10) and pushes
// evt live { session, rows, state?, queue?, helpers?, context?, turnAt?, reopen?, ended? }. Tool calls show as they
// come, one bordered group per run of steps: its last 3 steps, the earlier ones folded into "N earlier steps · time".
// While the session works and no step is open, a live "Thinking" row counts from the last row's time; the PC's
// thinking row (written when the thinking ends) turns it into "Thought 19s", and when the transcript holds the
// thinking's text a tap opens it under the row. Helpers are one line above the dock that opens a sheet; context
// use is a 2 px bar along the session bar's bottom edge, in words from 80 %. A queued message is a dashed row with
// Edit and Remove; Remove waits out a 5-second Undo, then calls queue.remove (the door patch's
// remove_queued_prompt). Used by session.js; a new channel session (the page reconnects) draws the view again,
// which watches again, and the view that is gone stops its watch (session.unwatch).
import { el, icon } from "../frame/dom.js";
import { markdown } from "../frame/markdown.js";
import { timing } from "./session-cards.js";

export const RENEW_MS = 9 * 60 * 1000;
const LOOK_MS = 1000; // how often a watching view checks it is still shown, and counts a running step's time
const SHOWN = 3;
const LOUD = 80; // context use in words from this percent

const fill = (node, ...kids) =>
  node.replaceChildren(
    ...kids.filter((k) => k !== null && k !== undefined && k !== false),
  );

const GLYPHS = {
  read: ["M4 5h7a2 2 0 0 1 2 2v12a2 2 0 0 0-2-2H4z", "M20 5h-7v14h7z"],
  edit: ["M4 20h4L19 9l-4-4L4 16z"],
  run: ["M5 7l5 5-5 5", "M12 17h7"],
  search: ["M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z", "M16 16l4 4"],
  think: ["M9 18h6", "M10 21h4", "M12 3a6 6 0 0 0-3 11v1h6v-1a6 6 0 0 0-3-11z"],
  other: ["M12 5v14M5 12h14"],
  chev: ["M9 6l6 6-6 6"],
  x: ["M6 6l12 12M18 6L6 18"],
  tick: ["M5 12l5 5 9-10"],
  people: [
    "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6z",
    "M3 19a6 6 0 0 1 12 0",
    "M16 11a3 3 0 1 0 0-6",
    "M18 19a6 6 0 0 0-3-5",
  ],
};

// A tool's verb and icon on its row (DS2: Read, Edit, Run, Search, Write).
const VERBS = {
  Read: ["Read", "read"],
  Edit: ["Edit", "edit"],
  MultiEdit: ["Edit", "edit"],
  NotebookEdit: ["Edit", "edit"],
  Write: ["Write", "edit"],
  Bash: ["Run", "run"],
  PowerShell: ["Run", "run"],
  Grep: ["Search", "search"],
  Glob: ["Search", "search"],
  WebSearch: ["Search", "search"],
  WebFetch: ["Open", "read"],
  Task: ["Helper", "other"],
  Agent: ["Helper", "other"],
  TodoWrite: ["To-do", "other"],
};
function verbOf(tool) {
  if (VERBS[tool]) return VERBS[tool];
  const mcp = tool.match(/^mcp__[^_]+__(.+)$/);
  return [mcp ? mcp[1] : tool, "other"];
}

const ms = (at) => (at ? Date.parse(at) : Number.NaN);
// "14s", "1m 40s", "2h 05m"
export function took(n) {
  if (!Number.isFinite(n) || n < 0) return "";
  const s = Math.round(n / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600)
    return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
  return `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, "0")}m`;
}
export const tokens = (n) =>
  n >= 1000000
    ? `${Math.round(n / 100000) / 10}M`
    : n >= 1000
      ? `${Math.round(n / 1000)}k`
      : String(n);

// ---- watching

// The view that holds this device's watch: a view drawn again (a reconnect) takes it over, so the view it
// replaced does not stop the new watch when it notices it is gone.
let holder = null;

const ENDED = {
  timeout: "the PC stopped following it",
  "no-session": "the session is gone from Nimbalyst",
  "transcript-gone": "its transcript is gone",
  failed: "the PC could not read it",
};

// Watches v.params.session while `view` is shown. hooks.apply(d) gets the watch's first state (rows: []) and every
// live event; hooks.off(words) runs when the watch could not start or ended; hooks.tick() runs every second.
export function watchLive(v, view, hooks) {
  const me = {};
  holder = me;
  const s = { session: v.params.session };
  let renew = null;
  let look = null;
  let first = true;
  const quit = () => {
    clearTimeout(renew);
    clearInterval(look);
  };
  async function watch() {
    let r;
    try {
      // The first ask goes on from session.open's end (v.live.from); a renewal keeps the PC's place.
      r = await v.ctx.ask(
        "session.watch",
        first && Number.isInteger(v.live.from)
          ? { ...s, start: v.live.from }
          : s,
      );
      first = false;
    } catch (e) {
      r = e;
    }
    if (!view.isConnected || holder !== me) return;
    if (!r?.ok) {
      quit();
      return hooks.off(`Live updates are off: ${v.why(r)}.`);
    }
    hooks.apply({
      session: s.session,
      rows: [],
      state: r.d.state,
      queue: r.d.queue,
      helpers: r.d.helpers,
      context: r.d.context,
      turnAt: r.d.turnAt,
      tail: r.d.tail,
    });
    renew = setTimeout(watch, RENEW_MS);
    if (look) return;
    look = setInterval(() => {
      if (view.isConnected) return hooks.tick();
      quit();
      if (holder !== me) return;
      holder = null;
      v.ctx.ask("session.unwatch", s).catch(() => {}); // the page has moved on: nothing waits on this answer
    }, LOOK_MS);
  }
  v.ctx.onEvent((body) => {
    if (body.e !== "live" || body.d.session !== s.session || holder !== me)
      return;
    if (!body.d.ended) return hooks.apply(body.d);
    quit();
    hooks.off(
      `Live updates stopped: ${ENDED[body.d.ended] ?? `the PC said "${body.d.ended}"`}.`,
    );
  });
  watch();
}

// ---- work rows

// The live rows as the conversation's tail: text rows as messages, tool calls and thinking as steps of one group
// per run. A step: { kind: "tool" | "thinking", tool, label, from, to (null while it runs), error, text, cut, key }.
// A thinking step runs from the row before it to its own time (the PC writes it when the thinking ends). `before`
// is the newest row ahead of these ({ at, open }, or null). A group's key is the index of its first row, so a
// group unfolded by the user stays open when the rows are drawn again.
export function liveItems(rows, before = null) {
  const out = [];
  const byId = new Map();
  let group = null;
  let prev = before?.at ?? null;
  rows.forEach((r, k) => {
    const from = ms(prev);
    prev = r.at;
    if (r.kind === "text") {
      group = null;
      out.push({ text: r });
      return;
    }
    if (r.kind === "result") {
      const t = byId.get(r.id);
      if (t) {
        t.to = ms(r.at);
        t.error = r.error;
        t.add = r.add ?? null;
        t.del = r.del ?? null;
      }
      return;
    }
    if (!group) {
      group = [];
      out.push({ steps: group, key: k });
    }
    const think = r.kind === "thinking";
    const step = {
      kind: r.kind,
      tool: r.tool ?? null,
      label: r.label ?? "",
      from: think ? from : ms(r.at),
      to: think ? ms(r.at) : null,
      error: false,
      text: think ? (r.text ?? null) : null,
      cut: r.cut === true,
      key: k,
      // The files design's fields: the call's id and its line's byte offset (step.detail), its edit's counts.
      id: r.id ?? null,
      pos: r.pos ?? null,
      at: r.at ?? null,
      add: null,
      del: null,
    };
    if (r.kind === "tool") byId.set(r.id, step);
    group.push(step);
  });
  return out;
}

// The newest row of `rows` as the next rows' `before`: { at, open } (open: a tool call waits for its result).
export function lastOf(rows, before = null) {
  if (!rows.length) return before;
  const items = liveItems(rows, before);
  const end = items[items.length - 1];
  return {
    at: rows[rows.length - 1].at,
    open: Boolean(end.steps?.some((s) => s.kind === "tool" && s.to === null)),
  };
}

// The live "Thinking" step while the session works and no step is open: from the last row's time (or, with no
// rows yet, the newest row before them, else the turn's start). None right after a thinking row: the session is
// then writing what it thought.
function thinkingNow(rows, before, turnAt) {
  const end = lastOf(rows, before);
  if (end?.open || rows[rows.length - 1]?.kind === "thinking") return null;
  const from = ms(end?.at ?? turnAt);
  if (!Number.isFinite(from)) return null;
  return { kind: "thinking", from, to: null, live: true, text: null };
}

function stepRow(s, { now, running, opened, redraw, files }) {
  const live = s.to === null && running;
  const time = took((s.to ?? (live ? now : Number.NaN)) - s.from);
  if (s.kind === "thinking") {
    const head = [
      live
        ? el("span.orb.think", { "aria-hidden": "true" })
        : icon(GLYPHS.think, 18),
      el("span.verb", live ? "Thinking" : "Thought"),
      el("span.obj"),
      el("span.t", time),
    ];
    if (!s.text) return el(`div.wstep.think${live ? ".live" : ""}`, ...head);
    const open = opened.has(`think-${s.key}`);
    return el(
      "div.wthink",
      el(
        `button.wstep.think.has-text${open ? ".open" : ""}`,
        {
          type: "button",
          "aria-expanded": String(open),
          onclick: () => {
            if (open) opened.delete(`think-${s.key}`);
            else opened.add(`think-${s.key}`);
            redraw();
          },
        },
        ...head,
        icon(GLYPHS.chev, 16),
      ),
      open
        ? el(
            "div.wthink-text",
            s.text,
            s.cut
              ? el("span.wthink-cut", " … (the first 4,000 characters)")
              : null,
          )
        : null,
    );
  }
  const [verb, glyph] = verbOf(s.tool);
  // A call the PC can find again (its id and line offset) opens its sheet (session-files.js).
  const opens = Boolean(files && s.id && Number.isInteger(s.pos));
  return el(
    `${opens ? "button" : "div"}.wstep${live ? ".live" : ""}${s.error ? ".bad" : ""}${opens ? ".opens" : ""}`,
    opens
      ? {
          type: "button",
          "data-step": s.id,
          onclick: () =>
            files.openStep(
              { id: s.id, tool: s.tool, label: s.label, at: s.at },
              s.pos,
            ),
        }
      : {},
    live
      ? el("span.orb.think", { "aria-hidden": "true" })
      : icon(GLYPHS[glyph], 18),
    el("span.verb", verb),
    el("span.obj", s.label),
    s.add === null || s.add === undefined
      ? null
      : el(
          "span.xcounts",
          el("span.xadd", `+${s.add}`),
          " ",
          el("span.xdel", `−${s.del ?? 0}`),
        ),
    el("span.t", s.error ? "failed" : time),
    opens ? icon(GLYPHS.chev, 16) : null,
  );
}

// One group: the last 3 steps, the earlier ones folded into one row that unfolds in place.
function workRows(steps, key, how) {
  const box = el("div.wsteps");
  const draw = () => {
    const hide = how.opened.has(key) ? 0 : Math.max(0, steps.length - SHOWN);
    const early = steps.slice(0, hide);
    const end = early.length
      ? (early[early.length - 1].to ?? steps[hide].from)
      : 0;
    fill(
      box,
      hide
        ? el(
            "button.wstep.fold",
            {
              type: "button",
              onclick: () => {
                how.opened.add(key);
                draw();
              },
            },
            icon(GLYPHS.chev, 18),
            el(
              "span.obj",
              `${hide} earlier step${hide === 1 ? "" : "s"} · ${took(end - early[0].from)}`,
            ),
          )
        : null,
      ...steps.slice(hide).map((s) => stepRow(s, { ...how, redraw: draw })),
    );
  };
  draw();
  return box;
}

// rows: the PC's live rows; before: the newest row ahead of them ({ at, open } or null); turnAt: the turn's start.
export function liveRowsView(
  rows,
  { now, running, opened, before = null, turnAt = null, files = null },
) {
  const items = liveItems(rows, before);
  const thinking = running ? thinkingNow(rows, before, turnAt) : null;
  if (thinking) {
    const end = items[items.length - 1];
    if (end?.steps) end.steps.push(thinking);
    else items.push({ steps: [thinking], key: "live" });
  }
  const how = { now, running, opened, files };
  return items.map((it) => {
    if (it.steps) return workRows(it.steps, it.key, how);
    if (it.text.system) return systemRow(it.text);
    if (it.text.role === "user") return el("div.you", it.text.text);
    return el(
      "div.reply",
      markdown(
        it.text.text,
        files && it.text.links
          ? { links: it.text.links, open: files.openLink }
          : null,
      ),
    );
  });
}

// A line the system wrote, as the PC marked it (`system`): a helper's notice is one short row with its status and
// summary, never the notice's own text. A summary of the form `Agent "X" completed` shows as just X; a failed
// helper's row is in the error colour.
export function systemRow(t) {
  const how = !t.status || t.status === "completed" ? "finished" : t.status;
  const text = t.text?.replace(/^Agent "(.+)" \w+$/, "$1");
  return el(
    `p.convo-note.system-row${t.status === "failed" ? ".bad" : ""}`,
    text ? `Helper ${how}: ${text}` : `Helper ${how}`,
  );
}

// ---- helpers: one line above the dock, and its sheet

const HELPER_STATES = {
  running: "working",
  done: "finished",
  failed: "failed",
  stopped: "stopped",
};

// "2 helpers working · 1 finished"
export function helpersWords(list) {
  const parts = Object.entries(HELPER_STATES)
    .map(([state, word]) => [
      list.filter((h) => h.state === state).length,
      word,
    ])
    .filter(([n]) => n > 0);
  return parts
    .map(([n, word], k) =>
      k === 0 ? `${n} helper${n === 1 ? "" : "s"} ${word}` : `${n} ${word}`,
    )
    .join(" · ");
}

// The helpers line shows while the session has helpers and works or needs the user, or a helper still runs.
export function helpersPart(v) {
  const box = el("div.helpers-part");
  let open = false;

  function meta(h, now) {
    const running = h.state === "running";
    const time = running ? took(now - ms(h.since)) : took(h.ms ?? Number.NaN);
    const first = running
      ? h.step
        ? `${verbOf(h.step.tool)[0]} ${h.step.label}`.trim()
        : "Starting"
      : { done: "Finished", failed: "Failed", stopped: "Stopped" }[h.state];
    return [
      first,
      time || null,
      h.tokens === null ? null : `${tokens(h.tokens)} tokens`,
      h.tools === null ? null : `${h.tools} step${h.tools === 1 ? "" : "s"}`,
    ]
      .filter(Boolean)
      .join(" · ");
  }

  function row(h, now) {
    const mark =
      h.state === "running"
        ? el("span.orb.think", { "aria-hidden": "true" })
        : icon(h.state === "done" ? GLYPHS.tick : GLYPHS.x, 18);
    return el(
      `div.hrow.${h.state}`,
      { "data-helper": h.id },
      mark,
      el(
        "div.w",
        el("div.n", h.name || h.type || "Helper"),
        el("div.m", meta(h, now)),
        h.summary ? el("div.m.sum", h.summary) : null,
      ),
    );
  }

  function sheet(list, now) {
    const working = list.filter((h) => h.state === "running");
    const rest = list.filter((h) => h.state !== "running");
    const all = list.reduce((n, h) => n + (h.tokens ?? 0), 0);
    return el(
      "div.hsheet",
      { role: "dialog", "aria-modal": "true" },
      el(
        "div.formhead",
        el(
          "button.sb",
          {
            type: "button",
            "aria-label": "Close",
            onclick: () => {
              open = false;
              draw();
            },
          },
          icon(GLYPHS.x, 20),
        ),
        el(
          "div.ft",
          "Helpers",
          el("small", `${list.length} · ${tokens(all)} tokens · read only`),
        ),
      ),
      el(
        "div.hbody",
        working.length ? el("div.secth", "Working") : null,
        ...working.map((h) => row(h, now)),
        rest.length ? el("div.secth", "Finished") : null,
        ...rest.map((h) => row(h, now)),
      ),
    );
  }

  function draw() {
    const list = v.live.helpers ?? [];
    const busy = list.some((h) => h.state === "running");
    if (!list.length || (!busy && v.info?.state === "idle")) {
      open = false;
      return fill(box);
    }
    fill(
      box,
      el(
        "button.helpers",
        {
          type: "button",
          "data-action": "session.helpers",
          onclick: () => {
            open = true;
            draw();
          },
        },
        busy
          ? el("span.orb.think", { "aria-hidden": "true" })
          : icon(GLYPHS.people, 18),
        el("span.hw", helpersWords(list)),
        el("span.sp"),
        icon(GLYPHS.chev, 16),
      ),
      open ? sheet(list, Date.now()) : null,
    );
  }
  return { box, draw, isOpen: () => open };
}

// ---- context use: the bar along the session bar's bottom edge, and its words from 80 %

// Grey (.was) while the PC is not known to be there.
export function contextBar(v, known) {
  const c = v.live.context;
  const loud = known && c?.percent !== null && c?.percent >= LOUD;
  return el(`progress.ctxbar${known ? "" : ".was"}${loud ? ".loud" : ""}`, {
    max: "100",
    value: String(Math.min(100, c?.percent ?? 0)),
    "aria-label":
      c?.percent === null || !c ? "Context use" : `Context ${c.percent}% full`,
  });
}

// "context 820k of 1M", or null under 80 %.
export function contextWords(v) {
  const c = v.live.context;
  if (!c || c.percent === null || c.percent < LOUD) return null;
  return `context ${tokens(c.used)} of ${tokens(c.window)}`;
}

// ---- queued messages: a dashed row above the typing box

// put(text) puts a message back in the typing box.
export function queuePart(v, put) {
  const box = el("div.queue-part");
  const held = new Map(); // queueId -> { left, cancel } while its Undo runs
  let line = null; // a failure, in words
  let open = false;
  let busy = false;

  async function remove(q) {
    let r;
    try {
      r = await v.ctx.ask("queue.remove", {
        session: v.params.session,
        queueId: q.queueId,
      });
    } catch (e) {
      r = e;
    }
    if (r?.ok || r?.err === "no-queued")
      v.queued = v.queued.filter((x) => x.queueId !== q.queueId);
    else line = `Not removed: ${v.why(r)}`;
    return r?.ok ? r.d : null;
  }

  // Remove: the row goes at once, the message leaves the queue when the Undo ends.
  function later(q) {
    v.ctx.haptic("impact");
    line = null;
    const h = { left: Math.ceil(timing.undoMs / 1000) };
    const timer = setInterval(() => {
      h.left--;
      draw();
    }, 1000);
    const go = setTimeout(async () => {
      stop();
      await remove(q);
      draw();
    }, timing.undoMs);
    // Hiding the app closes the link: a removal still in its Undo goes out first, as the row is already gone.
    const off = v.ctx.beforeSleep(() => {
      stop();
      return remove(q);
    });
    function stop() {
      clearTimeout(go);
      clearInterval(timer);
      off();
      held.delete(q.queueId);
    }
    h.cancel = () => {
      stop();
      draw();
    };
    held.set(q.queueId, h);
    draw();
  }

  // Edit: the message leaves the queue at once and its whole text (queue.remove's answer) goes back in the
  // typing box. A refused removal keeps the row and the box as they were.
  async function edit(q) {
    v.ctx.haptic("impact");
    busy = true;
    line = null;
    draw();
    const done = await remove(q);
    busy = false;
    draw();
    if (done) put(done.text);
  }

  const row = (q, label) =>
    el(
      "div.queued",
      { "data-queue": q.queueId },
      el("span.q", label),
      el("span.tx", q.text),
      el(
        "button.sb",
        { type: "button", disabled: busy, onclick: () => edit(q) },
        "Edit",
      ),
      el(
        "button.sb.danger",
        {
          type: "button",
          "data-action": "queue.remove",
          disabled: busy,
          onclick: () => later(q),
        },
        "Remove",
      ),
    );

  function draw() {
    const list = v.queued.filter((q) => !held.has(q.queueId));
    if (list.length < 2) open = false;
    fill(
      box,
      ...[...held.values()].map((h) =>
        el(
          "div.undo",
          el("span", "Removed"),
          el("span.sp"),
          el(
            "button.link",
            { type: "button", onclick: h.cancel },
            `Undo · ${h.left}s`,
          ),
        ),
      ),
      line ? el("div.undo.bad", el("span", line)) : null,
      list.length > 1 && !open
        ? el(
            "button.queued.many",
            {
              type: "button",
              onclick: () => {
                open = true;
                draw();
              },
            },
            el("span.q", `Queued ${list.length}`),
            el("span.tx", list[list.length - 1].text),
            icon(GLYPHS.chev, 16),
          )
        : null,
      ...(list.length === 1 || open
        ? list.map((q, k) => row(q, `Queued ${list.length === 1 ? 1 : k + 1}`))
        : []),
    );
  }
  return { box, draw };
}
