// The session view (DS2): the session bar with its state and Stop, the conversation with Markdown, and the dock
// at the bottom: the typing box (Send, or Queue while the session works, and Note), or in its place the card of
// what the session waits on (session-cards.js). With no session in the params it is a new session in the
// params' project, and the first Send starts it on the PC. Once the session is open the PC pushes what changes
// (session-live.js: work rows, state, queue, helpers, context); when it cannot, the view says so and asks again
// every few seconds while the session works or needs the user.
import { el, icon } from "../frame/dom.js";
import { markdown } from "../frame/markdown.js";
import { registerScreen } from "../frame/screens.js";
import { hhmm } from "./home.js";
import { errWord, kept as keptProjects, projectName } from "./projects.js";
import { attachParts } from "./session-attach.js";
import { cardFor } from "./session-cards.js";
import { changesFiles, filesPart } from "./session-files.js";
import {
  contextBar,
  contextWords,
  helpersPart,
  lastOf,
  liveRowsView,
  queuePart,
  systemRow,
  took,
  watchLive,
} from "./session-live.js";
import { voiceParts } from "./session-voice.js";

// replaceChildren writes an empty slot as the text "null": the empty slots are left out first.
const fill = (node, ...kids) =>
  node.replaceChildren(
    ...kids.filter((k) => k !== null && k !== undefined && k !== false),
  );

const REFRESH_MS = 5000;
// The message box's field (design "Long prompts" and "Dictation"): one line of its text (--p-body), its most
// lines, the fewest it keeps when the keyboard leaves little room, and the quiet before it may shrink.
const LINE = 22;
const MAX_LINES = 9;
const MIN_CAP = 3;
const QUIET_MS = 1000;
const DRAFT_MS = 1000;

// Drafts (design "Dictation", fix 2): the message box's words per session (per project for a new one) live outside
// the view, so a redraw of the view or a reopen of the mini app keeps them. A field's value is saved at most once a
// second and put only into a field just built, never into one the user is in. localStorage can be blocked in a
// webview: the draft then lasts while the page does, and typing and sending go on as before.
export const drafts = new Map(); // key -> text
const fields = new Map(); // key -> the field of the newest view
const storeKey = (key) => `phone.draft:${key}`;
function draftOf(key) {
  if (drafts.has(key)) return drafts.get(key);
  try {
    return localStorage.getItem(storeKey(key)) ?? "";
  } catch {
    return "";
  }
}
function keepDraft(key, text) {
  drafts.set(key, text);
  try {
    if (text) localStorage.setItem(storeKey(key), text);
    else localStorage.removeItem(storeKey(key));
  } catch {
    /* storage blocked: the draft in memory stays */
  }
}

const GLYPHS = {
  // Nimbalyst's Send: a paper plane
  send: ["M22 2 15 22 11 13 2 9Z", "M22 2 11 13"],
};

// What an error means, in words for a line under what the user pressed.
const SAY = {
  timeout: "the PC did not answer in time",
  "not-connected": "no link to the PC right now",
  "no-prompt": "the question was already answered or is gone",
  "not-running": "the session is not working",
  "needs-door-patch": "this needs the door patch on the PC",
};
export const why = (r) => {
  const w = errWord(r);
  // A Note the session could not take carries the note sender's reason.
  if (w === "note-failed")
    return `the note did not reach the session: ${r.why}`;
  const extra = r?.extra?.message ? ` (${r.extra.message})` : "";
  return SAY[w] ?? `the PC answered "${w}"${extra}`;
};

const STATES = {
  waiting: { word: "Needs you", cls: "needs", mark: "span.orb.listen" },
  running: { word: "Working", cls: "run", mark: "span.orb.think" },
  idle: { word: "Finished", cls: "done", mark: "span.done-mark" },
};

// What a tool did, in plain words. The PC sends only the tool's name (core/transcripts.mjs), not its file,
// command or search words, so a step says what kind of thing it did: `one` for its own line, `many(n)` for the
// summary of a run of steps. Tools of one kind share a key, so the summary counts them together.
const times = (n) => (n === 1 ? "once" : `${n} times`);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
const KINDS = {
  read: { one: "Read a file", many: (n) => `read ${plural(n, "file")}` },
  edit: { one: "Edited a file", many: (n) => `made ${plural(n, "edit")}` },
  write: { one: "Wrote a file", many: (n) => `wrote ${plural(n, "file")}` },
  run: { one: "Ran a command", many: (n) => `ran ${plural(n, "command")}` },
  search: { one: "Searched the files", many: (n) => `searched ${times(n)}` },
  fetch: {
    one: "Opened a web page",
    many: (n) => `opened ${plural(n, "web page")}`,
  },
  web: { one: "Searched the web", many: (n) => `searched the web ${times(n)}` },
  helper: {
    one: "Started a helper",
    many: (n) => `started ${plural(n, "helper")}`,
  },
  todo: {
    one: "Updated its to-do list",
    many: (n) => `updated its to-do list ${times(n)}`,
  },
  other: { many: (n) => `used ${plural(n, "other tool")}` },
};
const KIND_OF = {
  Read: "read",
  Edit: "edit",
  MultiEdit: "edit",
  NotebookEdit: "edit",
  Write: "write",
  Bash: "run",
  PowerShell: "run",
  Grep: "search",
  Glob: "search",
  WebFetch: "fetch",
  WebSearch: "web",
  Task: "helper",
  Agent: "helper",
  TodoWrite: "todo",
};
const kindOf = (name) => KIND_OF[name] ?? "other";

// One step's line: a known tool in words, any other by its name (an MCP tool as "server · tool").
function stepWords(name) {
  const k = kindOf(name);
  if (k !== "other") return KINDS[k].one;
  const mcp = name.match(/^mcp__([^_]+)__(.+)$/);
  return `Used ${mcp ? `${mcp[1]} · ${mcp[2]}` : name}`;
}

// "5 steps: read 2 files, ran 1 command", the kinds in the order they first came.
export function stepsSummary(tools) {
  const count = new Map();
  for (const t of tools) count.set(kindOf(t), (count.get(kindOf(t)) ?? 0) + 1);
  const parts = [...count].map(([k, n]) => KINDS[k].many(n));
  return `${plural(tools.length, "step")}: ${parts.join(", ")}`;
}

// One step's line. With the PC's step (its id) and its turn's pos, a tap opens the step's sheet (session-files.js).
function stepLine(w, tag, files) {
  if (!files || !w.step?.id || !Number.isInteger(w.pos))
    return el(tag, stepWords(w.tool));
  return el(
    tag,
    el(
      "button.work-step",
      {
        type: "button",
        "data-step": w.step.id,
        onclick: () => files.openStep(w.step, w.pos),
      },
      el("span.sum", stepWords(w.tool)),
      el("span.chev", { "aria-hidden": "true" }),
    ),
  );
}

// A run of steps in a row: one step is its own line; more fold into one summary line that opens the list on tap.
// work: [{ tool, step, pos }] (step and pos when the PC sent the turn's steps).
function workGroup(work, files) {
  const box = el("div.work");
  const tools = work.map((w) => w.tool);
  if (tools.length === 1) {
    box.append(stepLine(work[0], "div.work-line", files));
    return box;
  }
  const draw = (open) =>
    fill(
      box,
      el(
        "button.work-sum",
        {
          type: "button",
          "aria-expanded": open ? "true" : "false",
          onclick: () => draw(!open),
        },
        el("span.sum", stepsSummary(tools)),
        el("span.chev", { "aria-hidden": "true" }),
      ),
      open
        ? el("ol.work-list", ...work.map((w) => stepLine(w, "li", files)))
        : null,
    );
  draw(false);
  return box;
}

// A message the user wrote; a note the session got mid-turn carries the Note tag.
export const youRow = (t) =>
  el("div.you", t.note ? el("span.you-tag", "Note") : null, t.text);

// The conversation's elements from the turns, oldest first; tool calls of turns in a row share one group. With
// `files` (session-files.js) steps and file links open their sheets, and a finished answer that changed files ends
// in its changed-files line; `open` is true while the newest answer still runs.
export function turnsView(items, files = null, open = false) {
  const out = [];
  let work = null;
  let answer = []; // the assistant turns since the last prompt
  const endAnswer = (last) => {
    if (files && !(last && open) && answer.some((t) => changesFiles(t.steps)))
      out.push(
        files.changesLine({
          at: answer[answer.length - 1].pos,
          from: answer[0].pos,
        }),
      );
    answer = [];
  };
  for (const t of items) {
    if (t.role === "user") {
      // A note reaches the session mid-answer: the answer goes on after it.
      if (!t.system && !t.note) endAnswer(false);
      if (!t.system) work = null;
      out.push(t.system ? systemRow(t) : youRow(t));
      continue;
    }
    answer.push(t);
    if (t.text) {
      work = null;
      out.push(
        el(
          "div.reply",
          markdown(
            t.text,
            files && t.links ? { links: t.links, open: files.openLink } : null,
          ),
        ),
      );
    }
    if (t.cut) out.push(el("p.convo-note", "Cut here: the rest is on the PC."));
    if (t.tools?.length) {
      if (!work) {
        work = [];
        out.push(work);
      }
      work.push(
        ...(t.steps?.length === t.tools.length
          ? t.steps.map((step) => ({ tool: step.tool, step, pos: t.pos }))
          : t.tools.map((tool) => ({ tool, step: null, pos: null }))),
      );
    }
  }
  endAnswer(true);
  return out.map((o) => (Array.isArray(o) ? workGroup(o, files) : o));
}

function render(ctx) {
  const params = ctx.params;
  const v = {
    ctx,
    params,
    info: null, // session.open's answer
    pending: undefined, // session.pending's answer: undefined until asked, null for nothing
    queued: [], // queue.list's answer
    error: null, // why the session could not be read
    asOf: null, // when the PC last answered
    sent: [], // messages sent from this page and not yet in the transcript: { text, how }
    stopped: false,
    stopping: false,
    stopError: null,
    typeInstead: null, // { head, button, send(text) } while a card's "Type instead" is open
    loading: false,
    sign: null,
    watching: false, // session.watch was asked
    // What the PC pushes (session-live.js): on while the watch runs; rows are the work rows since the conversation
    // was read; before is the newest row ahead of them ({ at, open }); turnAt is when the turn started; error is
    // the line that says live updates are off.
    live: {
      on: false,
      rows: [],
      before: null,
      turnAt: null,
      helpers: null,
      context: null,
      error: null,
      opened: new Set(),
      from: null, // where the watch starts: session.open's end
      read: null, // the end of the read the conversation shows: rows of lines before it are drawn there
    },
  };
  const view = el("div.session-view");
  const bar = el("div.s-bar");
  const convo = el("div.convo", { onclick: () => compose.blur() });
  const liveBox = el("div.live-rows");
  const dock = el("div.dock");
  const files = filesPart(v);
  view.append(bar, convo, files.box);
  const helpers = helpersPart(v);
  const queue = queuePart(v, (text) => compose.put(text));
  const isNew = () => !params.session;
  const name = () =>
    params.name ??
    projectName(params.project ?? v.info?.project) ??
    "this project";
  v.projectName = name;
  const state = () => v.info?.state ?? null;

  // ---- session bar
  // " · 2m 14s" after Working: the turn's time, counted each second (tick) from the start the PC sent.
  let clock = null;
  const turnTime = () =>
    v.live.on && v.live.turnAt && state() === "running"
      ? ` · ${took(Date.now() - Date.parse(v.live.turnAt))}`
      : null;
  function drawBar() {
    clock = null;
    if (isNew()) {
      fill(
        bar,
        el(
          "div.who",
          el("div.s-name", "New session"),
          el("div.s-line", `${name()} · starts when you press Send`),
        ),
      );
      return;
    }
    const s = STATES[state()];
    const known = ctx.connected && !v.error;
    // The project's name opens the project: Telegram's Back goes where the user came from, which after an
    // alert's Open button is Home.
    const project = params.project ?? v.info?.project;
    const line = s
      ? [
          el(`${s.mark}${known ? "" : ".was"}`, { "aria-hidden": "true" }),
          el(
            `span.s-word.${s.cls}`,
            s.word,
            known && turnTime()
              ? (clock = el("span.s-time", turnTime()))
              : null,
          ),
          " · ",
          project
            ? el(
                "button.s-proj",
                {
                  type: "button",
                  onclick: () => ctx.go("project", { project, name: name() }),
                },
                name(),
                " ›",
              )
            : name(),
          known || !v.asOf ? null : ` · as of ${hhmm(v.asOf)}`,
          known && contextWords(v)
            ? [" · ", el("span.s-ctx", contextWords(v))]
            : null,
        ]
      : [v.error ? `Could not read it: ${v.error}` : "Asking the PC…"];
    // A waiting session can be stopped too (DS2).
    const canStop =
      known &&
      (state() === "running" || state() === "waiting") &&
      ctx.offered("session.stop");
    fill(
      bar,
      el(
        "div.who",
        el("div.s-name", v.info?.title ?? params.title ?? "Session"),
        el("div.s-line", line),
        v.stopError ? el("div.s-err", v.stopError) : null,
        v.live.error ? el("div.s-note", v.live.error) : null,
      ),
      canStop
        ? el(
            "button.stop",
            {
              type: "button",
              "data-action": "session.stop",
              disabled: v.stopping,
              onclick: stop,
            },
            el("span.sq", { "aria-hidden": "true" }),
            v.stopping ? "Stopping…" : "Stop",
          )
        : null,
      contextBar(v, known),
    );
  }

  async function stop() {
    ctx.haptic("impact");
    v.stopping = true;
    v.stopError = null;
    drawBar();
    let r;
    try {
      r = await ctx.ask("session.stop", { session: params.session });
    } catch (e) {
      r = e;
    }
    v.stopping = false;
    if (r?.ok) v.stopped = true;
    else v.stopError = `Not stopped: ${why(r)}`;
    drawBar();
    if (!r?.ok) return;
    drawConvo(nearEnd());
    load();
  }

  // ---- conversation
  async function older() {
    let r;
    try {
      r = await ctx.ask("session.older", {
        session: params.session,
        before: v.info.before,
      });
    } catch (e) {
      r = e;
    }
    if (!r?.ok) {
      v.olderError = `Could not load earlier messages: ${why(r)}`;
      return drawConvo(false);
    }
    v.olderError = null;
    v.info = {
      ...v.info,
      items: [...r.d.items, ...v.info.items],
      before: r.d.before,
    };
    const from = ctx.scrollBox.scrollHeight;
    drawConvo(false);
    ctx.scrollBox.scrollTop += ctx.scrollBox.scrollHeight - from;
  }

  function drawConvo(toEnd) {
    if (isNew()) {
      fill(
        convo,
        el(
          "p.newhint",
          el("b", "What should it do?"),
          `Type it. The session starts on the PC, in ${name()}, when you press Send.`,
        ),
        ...v.sent.map((m) => el("div.you", m.text)),
      );
      return;
    }
    if (!v.info) return fill(convo);
    // A sent message leaves the waiting bubbles once the transcript or the live rows hold it.
    const said = new Set(
      [...v.info.items, ...v.live.rows.filter((r) => r.kind === "text")]
        .filter((t) => t.role === "user" && !t.system)
        .map((t) => t.text.trim()),
    );
    v.sent = v.sent.filter((m) => !said.has(m.text.trim()));
    drawLive(false);
    fill(
      convo,
      v.info.before !== null
        ? el(
            "button.btn-quiet.older",
            { type: "button", onclick: older },
            "Earlier messages",
          )
        : null,
      v.olderError ? el("p.convo-note.bad", v.olderError) : null,
      v.info.items.length || v.sent.length
        ? null
        : el("p.convo-note", "No messages yet."),
      ...turnsView(v.info.items, files, state() === "running"),
      liveBox,
      // While the PC pushes the queue, a queued message shows as the row above the typing box instead.
      ...v.sent
        .filter((m) => !(v.live.on && m.how === "queue"))
        .map((m) =>
          el(
            `div.you${m.how === "send" ? "" : ".held"}`,
            m.how === "send"
              ? null
              : el("span.you-tag", m.how === "queue" ? "Queued" : "Note"),
            m.text,
          ),
        ),
      v.stopped ? el("p.convo-note", "Stopped by you") : null,
    );
    if (toEnd)
      requestAnimationFrame(() => {
        ctx.scrollBox.scrollTop = ctx.scrollBox.scrollHeight;
      });
  }

  // The work rows the PC pushed since the conversation was read.
  function drawLive(toEnd) {
    fill(
      liveBox,
      ...liveRowsView(v.live.rows, {
        now: Date.now(),
        running: state() === "running",
        opened: v.live.opened,
        before: v.live.before,
        turnAt: v.live.turnAt,
        files,
      }),
    );
    if (toEnd)
      requestAnimationFrame(() => {
        ctx.scrollBox.scrollTop = ctx.scrollBox.scrollHeight;
      });
  }

  // ---- dock: the typing box, or in its place the card of what the session waits on; the helpers line on top
  const compose = composeBox();
  let dockKey = null;

  function dockState() {
    if (isNew()) return { key: "compose" };
    if (!ctx.connected) return { key: "off" };
    if (!v.info || v.pending === undefined) return { key: "none" };
    if (v.pending && !v.typeInstead)
      return { key: `card:${v.pending.kind}:${v.pending.promptId}` };
    return { key: v.typeInstead ? "compose:instead" : "compose" };
  }

  // The dock is built again only when what it shows changes, so a refresh keeps the typed text, the focus and a
  // card's picks.
  function drawDock() {
    const d = dockState();
    if (d.key === dockKey) {
      if (d.key.startsWith("compose")) compose.update();
      return;
    }
    dockKey = d.key;
    if (d.key === "off")
      fill(
        dock,
        el(
          "p.dock-line",
          "PC off or asleep. Read-only until it is back; this session comes back by itself.",
        ),
      );
    else if (d.key === "none") fill(dock);
    else if (d.key.startsWith("card:"))
      fill(dock, helpers.box, cardFor(v, v.pending));
    else {
      compose.update();
      fill(
        dock,
        helpers.box,
        d.key === "compose" ? queue.box : null,
        compose.box,
      );
    }
  }

  // The message box, copied from Nimbalyst's (design "The message box"). The field's height is whole 22 px lines
  // from a hidden copy of its text, never its rows. iOS dictation sends each new guess as an ordinary input, so
  // while inputs come less than 1 s apart the field only grows; it shrinks after 1 s with no input. Nothing here
  // changes the field's text or caret on input, and only the field scrolls.
  function composeBox() {
    let sending = false;
    let line = null; // { text, bad }
    let shown = 1; // the field's height in lines
    let quiet = null; // the shrink that waits for 1 s with no input
    let saving = null; // the draft's save, at most one a second
    const key = params.session ?? `new:${params.project}`;
    const saveSoon = () => {
      if (saving) return;
      saving = setTimeout(() => {
        saving = null;
        if (fields.get(key) === field) keepDraft(key, field.value);
      }, DRAFT_MS);
    };
    const field = el("textarea.field", {
      "aria-label": "Message",
      oninput: () => {
        fit(false);
        clearTimeout(quiet);
        quiet = setTimeout(() => fit(true), QUIET_MS);
        saveSoon();
        update();
      },
      onscroll: () => fade(),
      onkeydown: (e) => {
        // Telegram on a computer has a real keyboard: Enter sends, Shift+Enter is a new line.
        if (e.key === "Enter" && !e.shiftKey && DESKTOP.has(ctx.tg.platform)) {
          e.preventDefault();
          submit("main");
        }
      },
    });
    const head = el("div.compose-head");
    const note = el(
      "button.btn.note",
      {
        type: "button",
        "data-action": "session.note",
        onclick: () => submit("note"),
      },
      "Note",
    );
    const main = el("button.btn.fill.send", {
      type: "button",
      onclick: () => submit("main"),
    });
    const lineEl = el("p.dock-line");
    // Attach (session-attach.js): the paperclip first in the row, its chips and their lines above the field.
    const attach = attachParts(ctx, {
      key,
      target: () =>
        params.session
          ? { session: params.session }
          : { project: params.project },
      changed: () => {
        fit(true);
        update();
      },
    });
    // Voice (session-voice.js): the record button just before Note, its line above the field, its panel after.
    const row = el("div.btnrow", attach.button, el("span.sp"), note, main);
    const voice = voiceParts(ctx, {
      key,
      field,
      row,
      changed: () => {
        fit(true);
        saveSoon();
        update();
      },
    });
    const compIn = el("div.compose-in", field, row);
    // The hidden copy of the field's text, at the field's width, that the height is measured from.
    const copy = el("div.field-copy", { "aria-hidden": "true" });
    const box = el(
      "div.compose",
      head,
      el(
        "div.compose-box",
        voice.chip,
        attach.chips,
        attach.lines,
        compIn,
        voice.panel,
        attach.input,
        copy,
      ),
      lineEl,
    );
    // The words come from the field this one replaces (a redraw while the old one is still shown: its value is
    // newer than the saved draft), else from the draft. A field the user was in hands its focus on, caret at the end.
    const old = fields.get(key);
    const was = old?.isConnected ? old : null;
    const hadFocus = Boolean(was && document.activeElement === was);
    field.value = was ? was.value : draftOf(key);
    fields.set(key, field);
    if (field.value || hadFocus)
      requestAnimationFrame(() => {
        if (!field.isConnected) return;
        fit(true);
        if (!hadFocus) return;
        field.focus();
        field.setSelectionRange(field.value.length, field.value.length);
      });
    const linesFor = (text) => {
      copy.replaceChildren(`${text}​`);
      return Math.max(1, Math.round(copy.scrollHeight / LINE));
    };
    // Up to 9 lines, fewer when the conversation would keep under 2 lines in view (keyboard up), never under 3.
    // shrink: whether it may get smaller now (after 1 s with no input, or a change that is not typing).
    function fit(shrink) {
      const room =
        shown + Math.floor((ctx.scrollBox.clientHeight - 2 * LINE) / LINE);
      const want = Math.min(
        linesFor(field.value),
        Math.max(MIN_CAP, Math.min(MAX_LINES, room)),
      );
      if (want > shown || (shrink && want < shown)) {
        shown = want;
        field.style.setProperty("--lines", String(want));
        keepCaret();
      }
      fade();
    }
    // After the height changes, a caret line out of view is brought 22 px inside the edge, by scrolling the
    // field only (never the page: the conversation and the box stay still while words arrive).
    function keepCaret() {
      const bottom = linesFor(field.value.slice(0, field.selectionEnd)) * LINE;
      const view = shown * LINE;
      if (bottom > field.scrollTop + view)
        field.scrollTop = bottom + LINE - view;
      else if (bottom - 2 * LINE < field.scrollTop)
        field.scrollTop = Math.max(0, bottom - 2 * LINE);
    }
    // The edges fade only where there is more text past them.
    function fade() {
      const up = field.scrollTop > 0;
      const down =
        field.scrollTop + field.clientHeight < field.scrollHeight - 1;
      const cls = `field${up ? " more-up" : ""}${down ? " more-down" : ""}`;
      if (field.className !== cls) field.className = cls;
    }
    const action = () =>
      v.typeInstead
        ? "type-instead"
        : isNew()
          ? "session.new"
          : state() === "running"
            ? "session.queue"
            : "session.send";

    function update() {
      const ti = v.typeInstead;
      head.hidden = !ti;
      fill(
        head,
        ...(ti
          ? [
              el("span.compose-title", ti.head),
              el(
                "button.btn.back",
                {
                  type: "button",
                  onclick: () => {
                    v.typeInstead = null;
                    drawDock();
                  },
                },
                "Back",
              ),
            ]
          : []),
      );
      const empty = !field.value.trim();
      const a = action();
      note.hidden = Boolean(ti) || isNew() || !ctx.offered("session.note");
      note.disabled = empty || sending || (!ti && attach.waits());
      // A card's box sends words only: the files wait for the message box.
      attach.update(Boolean(ti));
      compIn.className = `compose-in${!ti && attach.has() ? " has-files" : ""}`;
      main.disabled = empty || sending || (!ti && attach.waits());
      main.setAttribute("data-action", a);
      // Nimbalyst's icon-only Send; while the session works the word Queue, on a card's box the card's word.
      const word = ti ? ti.button : a === "session.queue" ? "Queue" : null;
      main.className = `btn fill send${word ? "" : " icon-only"}`;
      main.setAttribute("aria-label", sending ? "Sending" : (word ?? "Send"));
      fill(main, word ?? icon(GLYPHS.send, 20));
      field.setAttribute(
        "placeholder",
        ti
          ? "Your words…"
          : a === "session.queue"
            ? "Message to queue…"
            : "Message…",
      );
      lineEl.hidden = !line;
      lineEl.className = `dock-line${line?.bad ? " bad" : ""}`;
      fill(lineEl, line?.text ?? "");
      voice.update();
    }

    async function submit(which) {
      const text = field.value.trim();
      const ti = v.typeInstead;
      if (!text || sending || (!ti && attach.waits())) return;
      ctx.haptic("impact");
      const a = which === "note" ? "session.note" : action();
      // The picked files go with Send, Queue, Note and a new session.
      const files = !ti && attach.has() ? { attachments: attach.ids() } : {};
      sending = true;
      line = null;
      update();
      let r;
      try {
        if (ti) r = await ti.send(text);
        else if (a === "session.new")
          r = await ctx.ask(a, { project: params.project, text, ...files });
        else r = await ctx.ask(a, { session: params.session, text, ...files });
      } catch (e) {
        r = e;
      }
      sending = false;
      if (!r?.ok) {
        // Nothing typed is lost: the text stays in the box for Try again.
        if (files.attachments && (r?.err ?? r?.code) === "attachment-unknown")
          attach.lost();
        line = { text: `Not sent: ${why(r)}`, bad: true };
        return update();
      }
      if (files.attachments) attach.clear();
      field.value = "";
      clearTimeout(saving);
      saving = null;
      keepDraft(key, "");
      clearTimeout(quiet);
      fit(true);
      if (!ti)
        v.sent.push({
          text,
          how:
            a === "session.note"
              ? "note"
              : a === "session.queue" && r.d.queued
                ? "queue"
                : "send",
        });
      if (a === "session.new") params.session = r.d.session;
      v.typeInstead = null;
      update();
      if (ti) drawDock();
      drawConvo(true);
      load();
    }

    return {
      box,
      update,
      blur: () => field.blur(),
      focus: () => field.focus(),
      // A queued message's Edit puts its words back here, after what the box holds and one empty line (as
      // Nimbalyst's own Edit does).
      put: (text) => {
        field.value = field.value ? `${field.value}\n\n${text}` : text;
        saveSoon();
        fit(true);
        update();
        field.focus();
      },
    };
  }

  // What the cards (session-cards.js) use.
  v.name = name;
  v.why = why;
  v.answer = async (kind, answer) => {
    let r;
    try {
      r = await ctx.ask("session.answer", {
        session: params.session,
        promptId: v.pending.promptId,
        kind,
        answer: JSON.stringify(answer),
      });
    } catch (e) {
      r = e;
    }
    if (r?.ok || r?.err === "no-prompt") load();
    return r;
  };
  v.openTypeInstead = (spec) => {
    v.typeInstead = spec;
    drawDock();
    compose.focus();
  };

  // ---- asking the PC
  const nearEnd = () =>
    ctx.scrollBox.clientHeight + ctx.scrollBox.scrollTop >=
    ctx.scrollBox.scrollHeight - 80;

  async function load() {
    if (isNew()) {
      drawBar();
      drawConvo(false);
      return drawDock();
    }
    if (v.loading) {
      // A push asked while the PC was being asked: once more after this answer.
      v.again = true;
      return;
    }
    v.loading = true;
    v.again = false;
    clearTimeout(v.timer);
    const ask = (a, d) => ctx.ask(a, d).catch((e) => e);
    const s = { session: params.session };
    const [open, pending, queued, projects] = await Promise.all([
      ask("session.open", s),
      ask("session.pending", s),
      ctx.offered("queue.list") ? ask("queue.list", s) : null,
      keptProjects.projects ? null : ask("projects.list", {}),
    ]);
    v.loading = false;
    if (projects?.ok) keptProjects.projects = projects.d;
    if (!open?.ok || !pending?.ok) {
      v.error = why(open?.ok ? pending : open);
      drawBar();
      return drawDock();
    }
    const first = !v.info;
    const last = open.d.items[open.d.items.length - 1];
    const sign = JSON.stringify([
      open.d.items.length,
      last?.text.length,
      last?.tools?.length,
      open.d.state,
    ]);
    v.error = null;
    v.asOf = new Date().toISOString();
    // Unchanged turns keep what is drawn, earlier messages loaded by the user included.
    v.info =
      sign === v.sign
        ? { ...v.info, state: open.d.state, title: open.d.title }
        : open.d;
    params.title = open.d.title;
    v.pending = pending.d;
    v.queued = queued?.ok ? queued.d : [];
    drawBar();
    if (sign !== v.sign) {
      const toEnd = first || nearEnd();
      v.sign = sign;
      // The conversation now holds every row of a line before the byte this read stopped at (open.d.end): those
      // leave the live rows, the ones after stay, so a row written while the PC was asked shows once.
      // A push of such a row that comes after this answer is dropped too (apply).
      v.live.read = open.d.end;
      const held = v.live.rows.filter((r) => r.pos < v.live.read);
      v.live.before = lastOf(held, v.live.before);
      v.live.rows = v.live.rows.filter((r) => !(r.pos < v.live.read));
      drawConvo(toEnd);
    }
    drawDock();
    helpers.draw();
    queue.draw();
    if (v.again) return load();
    if (!v.watching && ctx.connected && ctx.offered("session.watch")) {
      v.watching = true;
      // The watch goes on from where this read stopped: no row is missed between the two.
      v.live.from = open.d.end;
      watchLive(v, view, { apply, off, tick });
    }
    refreshLater();
  }

  // Without the PC's pushes, ask again every few seconds while the session works or needs the user.
  function refreshLater() {
    clearTimeout(v.timer);
    if (!v.live.on && (state() === "running" || state() === "waiting"))
      v.timer = setTimeout(() => {
        if (view.isConnected && ctx.connected) load();
      }, REFRESH_MS);
  }

  // ---- what the PC pushes (session-live.js)
  function apply(d) {
    v.live.on = true;
    v.live.error = null;
    clearTimeout(v.timer);
    if ("queue" in d) v.queued = d.queue;
    if ("helpers" in d) v.live.helpers = d.helpers;
    if ("context" in d) v.live.context = d.context;
    if ("turnAt" in d) v.live.turnAt = d.turnAt;
    // The watch's first answer names the newest row before it (a renewal's is older than the rows since).
    if (d.tail && !v.live.rows.length && !v.live.before) v.live.before = d.tail;
    if (d.reopen) {
      // A new or shorter transcript: the conversation is read again.
      v.live.rows = [];
      v.live.before = null;
      v.live.read = null;
      v.sign = null;
    } else if (d.rows.some((r) => !(r.pos < v.live.read))) {
      const toEnd = nearEnd();
      const fresh = d.rows.filter((r) => !(r.pos < v.live.read));
      v.live.rows.push(...fresh);
      // A user message among them can be one still shown as sent: the whole conversation is drawn again.
      if (fresh.some((r) => r.kind === "text" && r.role === "user"))
        drawConvo(toEnd);
      else drawLive(toEnd);
    }
    // Stop's line belongs to the stopped turn: a session that works again has moved past it.
    if (d.state === "running") v.stopped = false;
    const moved = Boolean(d.state && v.info && d.state !== v.info.state);
    if (moved) {
      v.info = { ...v.info, state: d.state };
      drawLive(false); // a session that stopped working ends its live Thinking row
    }
    // A new state can bring a question, or end one: the PC is asked again.
    if (d.reopen || moved) load();
    drawBar();
    drawDock();
    helpers.draw();
    queue.draw();
  }
  function off(words) {
    v.live.on = false;
    v.live.error = words;
    drawBar();
    refreshLater();
  }
  function tick() {
    if (state() === "running") {
      drawLive(false);
      if (clock) fill(clock, turnTime());
    }
    if (helpers.isOpen()) helpers.draw();
  }

  v.reload = load;
  ctx.onEvent((body) => {
    if (body.e === "status") load();
  });
  drawBar();
  drawConvo(false);
  drawDock();
  if (ctx.connected || isNew()) load();
  return { content: view, bottom: dock };
}

const DESKTOP = new Set(["tdesktop", "macos", "weba", "webk", "unigram"]);

registerScreen({
  id: "session",
  tab: null,
  title: (p) => p.title ?? (p.session ? "Session" : "New session"),
  render,
  actions: [
    "session.open",
    "session.pending",
    "session.answer",
    "session.send",
    "session.queue",
    "session.note",
    "session.stop",
    "session.watch",
    "session.unwatch",
    "queue.list",
    "queue.remove",
    "form.answer",
    "form.instead",
  ],
});
