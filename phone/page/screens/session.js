// The session view (DS2): the session bar with its state and Stop, the conversation with Markdown, and the dock
// at the bottom: the typing box (Send, or Queue while the session works, and Note), or in its place the card of
// what the session waits on (session-cards.js). With no session in the params it is a new session in the
// params' project, and the first Send starts it on the PC. Once the session is open the PC pushes what changes
// (session-live.js: work rows, state, queue, helpers, context); when it cannot, the view says so and asks again
// every few seconds while the session works or needs the user.
import { ENTRY_MAX, keep, kept as keptOf } from "../frame/cache.js";
import { el, ICONS, icon } from "../frame/dom.js";
import {
  CHECK_ICON,
  COPIED_MS,
  COPY_ICON,
  copyText,
  markdown,
  textSize,
} from "../frame/markdown.js";
import { outbox } from "../frame/outbox.js";
import { registerScreen } from "../frame/screens.js";
import { STORE_SUFFIX } from "../screens.generated.js";
import { hhmm } from "./home.js";
import { errWord, kept as keptProjects, projectName } from "./projects.js";
import { attachParts } from "./session-attach.js";
import { cardFor, timing } from "./session-cards.js";
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
const STILL_WAITS =
  "The session still waits on this. Answer again, or on the PC.";
// A sent message (comfort design, section 5): its "Sending…" turns to "Still sending…" after 10 s; a refused one
// fades out over 150 ms.
const SLOW_SEND_MS = 10_000;
// A message written while the link to a PC whose hello has no message ids is down waits this long for the link,
// then its words go back in the box. An object, so the tests can shorten it.
export const linkWait = { ms: 60_000 };
// The first words of the block the PC adds after a message's words when files go with it (pc/actions/attach.mjs
// BLOCK_HEAD).
const FILES_HEAD = "Attached files (";
const FADE_MS = 150;
// The jump-to-latest button shows when the chat's end is over 300 px below the view and goes under 100 px.
const JUMP_SHOW = 300;
const JUMP_HIDE = 100;
// The last session opened is kept on the phone (cache.js, name "session"): its newest 60 rows at most, cut from the
// oldest end until the entry fits.
const KEPT_ROWS = 60;
// Where each session was left, while the page lives: { y, end }, end when it was at the chat's end. The frame's
// own place (app.js leave) is set before the conversation is read, so the session puts this one back itself.
const places = new Map();

// Drafts (design "Dictation", fix 2): the message box's words per session (per project for a new one) live outside
// the view, so a redraw of the view or a reopen of the mini app keeps them. A field's value is saved at most once a
// second and put only into a field just built, never into one the user is in. localStorage can be blocked in a
// webview: the draft then lasts while the page does, and typing and sending go on as before.
export const drafts = new Map(); // key -> text
const fields = new Map(); // key -> the field of the newest view
const storeKey = (key) => `phone.draft${STORE_SUFFIX}:${key}`;
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
// The draft in memory follows every keystroke; the stored copy is written at once when the page is hidden or put
// away, so words typed in the last second outlive a close of the mini app. The page stand-ins of the screen tests
// that only draw a session (attach, files, live) have no window or document events, hence the ?. here.
const keepAll = () => {
  for (const [key, text] of drafts) keepDraft(key, text);
};
globalThis.addEventListener?.("pagehide", keepAll);
document.addEventListener?.("visibilitychange", keepAll);

const GLYPHS = {
  // Nimbalyst's Send: a paper plane
  send: ["M22 2 15 22 11 13 2 9Z", "M22 2 11 13"],
  clock: ["M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z", "M12 7v5l3 2"],
};

// What an error means, in words for a line under what the user pressed.
const SAY = {
  timeout: "the PC did not answer in time",
  "not-connected": "no link to the PC right now",
  // The channel's own words for a PC that is off or a link that dropped (as session-attach.js says them).
  "pc-offline": "the PC is off or asleep",
  closed: "the link to the PC closed",
  "no-prompt": "the question was already answered or is gone",
  "not-running": "the session is not working",
  "needs-door-patch": "this needs the door patch on the PC",
  // Nimbalyst refused a New session, also when started with no calling session: its helper-session limit (4 at
  // once, or its lifetime count) for the project's newest session.
  "session-limit":
    "Nimbalyst refused a new session: too many helper sessions from the project's newest session. Finish or close some, or start one on the PC",
};
// A send whose link dropped after it may have left (a ChannelError, not the PC's answer and not "no link yet"):
// to a PC without message ids nobody can tell whether it arrived.
const LINK_DROPPED =
  "The link dropped before the PC confirmed it: check the session before you send it again.";
// The outbox keeps such a failure on its entry as { dropped: true } (waitLink, a send without an id).
const droppedAfter = (r) =>
  r?.dropped === true ||
  (r instanceof Error && r.code !== undefined && r.code !== "not-connected");
// The red line when a message's words go back in the box.
const backLine = (r) =>
  droppedAfter(r)
    ? `${LINK_DROPPED} Your message is back in the box.`
    : `Not sent: ${why(r)}. Your message is back in the box.`;
export const why = (r) => {
  // The answer's own word (or the channel's code), without the message errWord puts after it.
  const w = r?.err ?? r?.code;
  if (w === "send-unclear")
    return "the PC program restarted while taking this message: check the session before you send it again";
  // A Note the session could not take carries the note sender's reason.
  if (w === "note-failed")
    return `the note did not reach the session: ${r.why}`;
  // A word with no plain words shows as the PC sent it, with its message, as "door-error (x)".
  return SAY[w] ?? `the PC answered "${errWord(r)}"`;
};

// "14:05", or "12 Nov, 14:05" when it was kept on an earlier day.
function keptWhen(at) {
  const d = new Date(at);
  if (d.toDateString() === new Date().toDateString()) return hhmm(d);
  const day = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${day}, ${hhmm(d)}`;
}

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

// ---- copy and the long press (comfort design, section 7, branch A: the iPhone selects text in place). A message's
// text is the iPhone's own: a press there selects it, and nothing here listens to that press or cancels it. Every
// message has a copy icon. Off the text, a 300 ms touch press opens the page's Copy menu in two places only: the
// action row under an answer and the space left of your bubble.
const PRESS_MS = 300;
const PRESS_SLOP = 10;

// The listeners of a press area: a touch held 300 ms without moving over 10 px calls onPress.
function pressable(onPress) {
  let timer = null;
  let from = null;
  const stop = () => {
    clearTimeout(timer);
    timer = null;
  };
  return {
    onpointerdown: (e) => {
      stop();
      // Touch only: with a mouse (Telegram Desktop) text selects as on any page and no menu opens.
      if (e.pointerType !== "touch") return;
      from = [e.clientX, e.clientY];
      timer = setTimeout(() => {
        timer = null;
        onPress();
      }, PRESS_MS);
    },
    onpointermove: (e) => {
      if (
        timer &&
        Math.hypot(e.clientX - from[0], e.clientY - from[1]) > PRESS_SLOP
      )
        stop();
    },
    onpointerup: stop,
    onpointercancel: stop,
    // A press area holds no text: the phone's own long-press menu stays away from it.
    oncontextmenu: (e) => e.preventDefault(),
  };
}

// A message's copy icon: a tap puts the message as written on the clipboard, then shows a check and "Copied".
function copyButton(ctx, text) {
  const btn = el("button.msg-copy", { type: "button" });
  let back = null;
  const draw = (ok) => {
    btn.className = `msg-copy${ok === true ? " ok" : ok === false ? " bad" : ""}`;
    btn.setAttribute(
      "aria-label",
      ok === true ? "Copied" : ok === false ? "Not copied" : "Copy message",
    );
    fill(
      btn,
      icon(ok === true ? CHECK_ICON : COPY_ICON, 18),
      ok === null ? null : el("span.msg-copied", ok ? "Copied" : "Not copied"),
    );
  };
  btn.addEventListener("click", () =>
    copyText(text, (ok) => {
      // Telegram's success haptic waits on frame/telegram.js: the selection tick stands in.
      if (ok) ctx.haptic("select");
      clearTimeout(back);
      draw(ok);
      back = setTimeout(() => draw(null), COPIED_MS);
    }),
  );
  draw(null);
  return btn;
}

// The messages of a conversation without copy (the screen tests' plain turns).
const PLAIN = {
  you: (text, tag = null, cls = "") =>
    el(`div.you${cls}`, tag ? el("span.you-tag", tag) : null, text),
  reply: (text, links) => el("div.reply", markdown(text, links)),
};

// The messages of one session view: your message in a row with its copy icon and the press area left of it,
// Claude's answer with its action row under it, and the Copy menu. `pill` is the "Copied" line above the dock.
function talkParts(ctx, view, pill) {
  let menu = null; // the open menu: { node, card, scrim, moved }
  let pillBack = null;
  function showPill(ok) {
    clearTimeout(pillBack);
    pill.className = `copied-pill${ok ? "" : " bad"}`;
    fill(pill, ok ? "Copied" : "Not copied");
    pill.hidden = false;
    pillBack = setTimeout(() => {
      pill.hidden = true;
    }, COPIED_MS);
  }
  function close() {
    if (!menu) return;
    const m = menu;
    menu = null;
    m.card.remove();
    m.scrim.remove();
    m.node.className = m.node.className.replace(/ lifted$/, "");
    if (m.moved) ctx.scrollBox.scrollTop -= m.moved;
  }
  // The held message stays lit over the dim; the card opens under it, in the chat, so it covers no message.
  function open(node, text, mine) {
    close();
    // Telegram's medium haptic waits on frame/telegram.js: the light impact stands in.
    ctx.haptic("impact");
    const card = el(
      `div.msg-menu${mine ? ".mine" : ""}`,
      { role: "menu" },
      el(
        "button.msg-menu-item",
        {
          type: "button",
          role: "menuitem",
          onclick: () => {
            copyText(text, showPill);
            close();
          },
        },
        "Copy",
        icon(COPY_ICON, 20),
      ),
    );
    const scrim = el("div.msg-scrim", { onclick: close });
    node.className += " lifted";
    node.after(card);
    view.append(scrim);
    menu = { node, card, scrim, moved: 0 };
    // The chat moves up when the card does not fit above the dock (the screen tests' stand-ins lay nothing out).
    requestAnimationFrame(() => {
      const r = card.getBoundingClientRect?.();
      const box = ctx.scrollBox.getBoundingClientRect?.();
      if (!r || !box || menu?.card !== card) return;
      const over = r.bottom + 12 - box.bottom;
      if (over <= 0) return;
      ctx.scrollBox.scrollTop += over;
      menu.moved = over;
    });
  }
  return {
    close,
    // A redraw of the part that holds the held message ends the menu.
    holds: (box) => Boolean(menu && walkHas(box, menu.node)),
    you(text, tag = null, cls = "") {
      const row = el("div.you-row");
      row.append(
        el(
          "div.you-gap",
          pressable(() => open(row, text, true)),
        ),
        copyButton(ctx, text),
        PLAIN.you(text, tag, cls),
      );
      return row;
    },
    reply(text, links) {
      const node = PLAIN.reply(text, links);
      node.append(
        el(
          "div.msg-acts",
          copyButton(ctx, text),
          el(
            "div.acts-gap",
            pressable(() => open(node, text, false)),
          ),
        ),
      );
      return node;
    },
  };
}
const walkHas = (box, node) =>
  box === node || [...box.childNodes].some((c) => walkHas(c, node));

// How many of a read's items are new at the end against the items drawn before it: those after the last drawn
// item's pos (its line's byte offset). Earlier messages loaded at the top and a read that starts later are not new.
export function newAtEnd(before, items) {
  if (!before.length) return items.length;
  const last = before[before.length - 1].pos;
  return items.filter((t) => t.pos > last).length;
}

// The conversation's elements from the turns, oldest first; tool calls of turns in a row share one group. With
// `files` (session-files.js) steps and file links open their sheets, and a finished answer that changed files ends
// in its changed-files line; `open` is true while the newest answer still runs. `talk` draws the messages.
export function turnsView(items, files = null, open = false, talk = PLAIN) {
  const out = [];
  const at = []; // each element's turn pos, for its data-key
  const put = (o, pos) => {
    out.push(o);
    at.push(pos);
  };
  let work = null;
  let answer = []; // the assistant turns since the last prompt
  const endAnswer = (last) => {
    if (files && !(last && open) && answer.some((t) => changesFiles(t.steps)))
      put(
        files.changesLine({
          at: answer[answer.length - 1].pos,
          from: answer[0].pos,
        }),
        answer[answer.length - 1].pos,
      );
    answer = [];
  };
  for (const t of items) {
    if (t.role === "user") {
      // A note reaches the session mid-answer: the answer goes on after it.
      if (!t.system && !t.note) endAnswer(false);
      if (!t.system) work = null;
      put(
        t.system ? systemRow(t) : talk.you(t.text, t.note ? "Note" : null),
        t.pos,
      );
      continue;
    }
    answer.push(t);
    if (t.text) {
      work = null;
      put(
        talk.reply(
          t.text,
          files && t.links ? { links: t.links, open: files.openLink } : null,
        ),
        t.pos,
      );
    }
    if (t.cut)
      put(el("p.convo-note", "Cut here: the rest is on the PC."), t.pos);
    if (t.tools?.length) {
      if (!work) {
        work = [];
        put(work, t.pos);
      }
      work.push(
        ...(t.steps?.length === t.tools.length
          ? t.steps.map((step) => ({ tool: step.tool, step, pos: t.pos }))
          : t.tools.map((tool) => ({ tool, step: null, pos: null }))),
      );
    }
  }
  endAnswer(true);
  // A row's data-key ("<pos>:<n>", n counting rows of one turn) finds it again after a redraw (keepTop).
  const seen = new Map();
  return out.map((o, i) => {
    const node = Array.isArray(o) ? workGroup(o, files) : o;
    if (at[i] !== undefined) {
      const n = seen.get(at[i]) ?? 0;
      seen.set(at[i], n + 1);
      node.setAttribute("data-key", `${at[i]}:${n}`);
    }
    return node;
  });
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
    // messages sent from this page and not yet in the transcript: { text, how, state } with state sending, slow
    // (over 10 s), sent or gone (refused, fading out)
    sent: [],
    kept: null, // while the conversation drawn is the one kept on the phone: when it was kept
    placed: false, // the conversation was put at its place once: from then on scrolling records the place
    stopped: false,
    stopping: false,
    stopError: null,
    typeInstead: null, // { head, button, send(text) } while a card's "Type instead" is open
    answered: null, // { id, last } the prompt the PC accepted an answer to: its card stays away while the PC is asked again
    closed: new Set(), // prompt ids whose result line the transcript holds: their cards never come back
    back: null, // the id of a prompt whose card came back at the last ask
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
  // The text size picked in Settings (comfort design, section 6) sets the messages' and code's size.
  const view = el("div.session-view", { "data-text": textSize() });
  const bar = el("div.s-bar");
  const convo = el("div.convo", { onclick: () => compose.blur() });
  const liveBox = el("div.live-rows");
  const dock = el("div.dock");
  const pill = el("p.copied-pill", { hidden: true, role: "status" });
  const talk = talkParts(ctx, view, pill);
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

  // The last session opened, kept on the phone, is drawn at once; the PC's answer replaces it (comfort design,
  // section 3).
  const keptSession = isNew() ? null : keptOf("session");
  if (keptSession && keptSession.data.id === params.session) {
    v.info = keptSession.data.info;
    v.kept = keptSession.at;
  }
  function keepSession() {
    // A view left behind may still be asked again (a recheck): only the shown one is the last session opened.
    if (!view.isConnected) return;
    let items = v.info.items.slice(-KEPT_ROWS);
    const data = () => ({
      id: params.session,
      info: { ...v.info, items, before: null },
    });
    // The entry adds { at } around the data: 64 characters are left for it.
    while (items.length > 1 && JSON.stringify(data()).length > ENTRY_MAX - 64)
      items = items.slice(1);
    keep("session", data());
  }

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
    const known = ctx.connected && !v.error && !v.kept;
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
        // A kept conversation says so in place of the status line until the PC's answer replaces it.
        v.kept && !v.error
          ? el(
              "div.s-line.s-kept",
              el("span.spinner", { "aria-hidden": "true" }),
              `Updating · as of ${keptWhen(v.kept)}`,
            )
          : el("div.s-line", line),
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

  const isStale = (m) => {
    const e = outbox.get(m.mid);
    return Boolean(e && outbox.stale(e));
  };
  // A sent message as a bubble, and under it while the PC has not answered its "Sending…" line.
  const sentRows = (m) => [
    talk.you(
      m.text,
      m.how === "send" || m.state !== "sent"
        ? null
        : m.how === "queue"
          ? "Queued"
          : "Note",
      `${m.how === "send" || m.state !== "sent" ? "" : ".held"}${m.state === "gone" ? ".gone" : ""}`,
    ),
    // Past the hour of silent retries the outbox no longer sends it by itself: the user picks.
    (m.state === "sending" || m.state === "slow") && m.mid && isStale(m)
      ? el(
          "p.sent-mark.sent-stale",
          { "data-mid": m.mid },
          "Not sent yet. ",
          el(
            "button.btn-quiet",
            { type: "button", onclick: () => compose.sendNow(m) },
            "Send now",
          ),
          " ",
          el(
            "button.btn-quiet",
            { type: "button", onclick: () => compose.discard(m) },
            "Discard",
          ),
        )
      : m.state === "sending" || m.state === "slow"
        ? el(
            "p.sent-mark",
            icon(GLYPHS.clock, 12),
            m.state === "slow" ? "Still sending…" : "Sending…",
          )
        : null,
    // The session handed its work on: its transcript never gets the message, the session that continues it does.
    m.movedTo
      ? el(
          "p.sent-mark.sent-moved",
          `Sent on to “${m.movedTo.title ?? "the next session"}”, which continues this work. `,
          el(
            "button.btn-quiet",
            {
              type: "button",
              onclick: () =>
                ctx.go("session", {
                  session: m.movedTo.session,
                  project: params.project ?? v.info?.project,
                  title: m.movedTo.title ?? undefined,
                }),
            },
            "Open",
          ),
        )
      : null,
  ];

  // The top row in view and its height on screen, so a redraw can put it back at that height (null when nothing
  // is laid out, as in the screen tests' stand-ins).
  function topRow() {
    const box = ctx.scrollBox.getBoundingClientRect?.();
    if (!box) return null;
    for (const n of convo.childNodes) {
      const key = n.getAttribute?.("data-key");
      if (!key) continue;
      const r = n.getBoundingClientRect();
      if (r.bottom > box.top) return { key, top: r.top };
    }
    return null;
  }
  function keepTop(row) {
    if (!row) return;
    const n = [...convo.childNodes].find(
      (c) => c.getAttribute?.("data-key") === row.key,
    );
    if (n) ctx.scrollBox.scrollTop += n.getBoundingClientRect().top - row.top;
  }

  // The transcript byte the page has read up to (also from a kept conversation): a message sent now is written at
  // or after it.
  function readTo() {
    return Math.max(
      v.live.read ?? 0,
      ...(v.info?.items ?? []).map((t) => t.pos + 1),
      ...v.live.rows.map((r) => r.pos + 1),
    );
  }

  function drawConvo(toEnd) {
    talk.close();
    if (isNew()) {
      fill(
        convo,
        el(
          "p.newhint",
          el("b", "What should it do?"),
          `Type it. The session starts on the PC, in ${name()}, when you press Send.`,
        ),
        ...v.sent.flatMap(sentRows),
      );
      if (toEnd) toLatest();
      return;
    }
    if (!v.info) return fill(convo);
    // A sent message leaves the waiting bubbles once the transcript or the live rows hold it: its words alone, or
    // followed by the block the PC adds naming the files sent with it. Only a turn written at or after the byte
    // the page had read when it was sent counts (an earlier "yes" looks the same), and each turn stands for one
    // message, so the same words sent twice keep both bubbles until both are in.
    const said = [
      ...v.info.items,
      ...v.live.rows.filter((r) => r.kind === "text"),
    ]
      .filter((t) => t.role === "user" && !t.system)
      .map((t) => ({ text: t.text.trim(), pos: t.pos }));
    const used = new Set();
    const holds = (m) => {
      const t = m.text.trim();
      const turn = said.find(
        (x) =>
          !used.has(x) &&
          x.pos >= m.from &&
          (x.text === t || x.text.startsWith(`${t}\n\n${FILES_HEAD}`)),
      );
      if (turn) used.add(turn);
      return Boolean(turn);
    };
    // A message still in the outbox stays there even when the transcript holds it: the PC's answer to its id is
    // what ends it.
    v.sent = v.sent.filter((m) => {
      const held = holds(m);
      return (m.mid && outbox.get(m.mid)) || !held;
    });
    drawLive(false);
    const top = toEnd ? null : topRow();
    fill(
      convo,
      // A kept conversation is cut: Earlier messages waits for the PC's answer.
      v.info.before !== null && !v.kept
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
      ...turnsView(v.info.items, files, state() === "running", talk),
      liveBox,
      // While the PC pushes the queue, a queued message shows as the row above the typing box instead.
      ...v.sent
        .filter((m) => !(v.live.on && m.how === "queue" && m.state === "sent"))
        .flatMap(sentRows),
      v.stopped ? el("p.convo-note", "Stopped by you") : null,
    );
    if (toEnd) toLatest();
    else keepTop(top);
  }
  function toLatest() {
    requestAnimationFrame(() => {
      ctx.scrollBox.scrollTop = ctx.scrollBox.scrollHeight;
    });
  }
  // The conversation's first draw goes where the session was left (places), else to its end; from then on
  // scrolling records the place.
  function toPlace() {
    const place = places.get(params.session);
    requestAnimationFrame(() => {
      ctx.scrollBox.scrollTop =
        place && !place.end ? place.y : ctx.scrollBox.scrollHeight;
      v.placed = true;
      jump.update();
    });
  }

  // ---- jump to latest (comfort design, section 5): a round button above the dock while the chat's end is far
  // below; new messages that come meanwhile count on its badge.
  const jump = (() => {
    let on = false;
    let count = 0;
    const badge = el("span.jump-badge");
    const btn = el(
      "button.jump",
      {
        type: "button",
        onclick: () => {
          const b = ctx.scrollBox;
          const far = b.scrollHeight - b.scrollTop - b.clientHeight;
          // Node's screen tests have no matchMedia: there the jump is instant.
          const still = globalThis.matchMedia?.(
            "(prefers-reduced-motion: reduce)",
          ).matches;
          b.scrollTo({
            top: b.scrollHeight,
            behavior:
              far <= 3 * b.clientHeight && !still ? "smooth" : "instant",
          });
          count = 0;
          draw();
        },
      },
      icon(ICONS["arrow-down"], 20),
      badge,
    );
    function draw() {
      btn.className = `jump${on ? " on" : ""}`;
      btn.setAttribute("aria-hidden", on ? "false" : "true");
      btn.setAttribute("tabindex", on ? "0" : "-1");
      btn.setAttribute(
        "aria-label",
        count
          ? `Jump to latest, ${count > 99 ? "99+" : count} new`
          : "Jump to latest",
      );
      badge.hidden = !count;
      fill(badge, count ? (count > 99 ? "99+" : String(count)) : "");
    }
    draw();
    return {
      btn,
      update() {
        const b = ctx.scrollBox;
        const far = b.scrollHeight - b.scrollTop - b.clientHeight;
        if (far > JUMP_SHOW) on = true;
        else if (far < JUMP_HIDE) {
          on = false;
          count = 0;
        }
        draw();
      },
      // n new messages came while the user reads further up.
      more(n) {
        if (!on || !(n > 0)) return;
        count += n;
        draw();
      },
    };
  })();
  const onScroll = () => {
    if (!view.isConnected)
      return ctx.scrollBox.removeEventListener("scroll", onScroll);
    if (!v.placed) return;
    if (!isNew())
      places.set(params.session, {
        y: ctx.scrollBox.scrollTop,
        end: nearEnd(),
      });
    jump.update();
  };
  // The screen tests' stand-in scroll boxes (attach, files, live) have no events, hence the ?. here.
  ctx.scrollBox.addEventListener?.("scroll", onScroll, { passive: true });

  // The work rows the PC pushed since the conversation was read.
  function drawLive(toEnd) {
    if (talk.holds(liveBox)) talk.close();
    fill(
      liveBox,
      ...liveRowsView(v.live.rows, {
        now: Date.now(),
        running: state() === "running",
        opened: v.live.opened,
        before: v.live.before,
        turnAt: v.live.turnAt,
        files,
        talk,
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
    // A kept conversation keeps its typing box live until the PC answers (comfort design, section 3).
    if (v.kept && v.pending === undefined) return { key: "compose" };
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
        jump.btn,
        pill,
        el(
          "p.dock-line",
          "PC off or asleep. Read-only until it is back; this session comes back by itself.",
        ),
      );
    else if (d.key === "none") fill(dock, jump.btn, pill);
    else if (d.key.startsWith("card:"))
      fill(
        dock,
        jump.btn,
        pill,
        helpers.box,
        v.back === v.pending.promptId ? el("p.dock-line", STILL_WAITS) : null,
        cardFor(v, v.pending),
      );
    else {
      compose.update();
      fill(
        dock,
        jump.btn,
        pill,
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
    let saving = null; // the draft's save to storage, at most one a second
    const key = params.session ?? `new:${params.project}`;
    const saveSoon = () => {
      if (fields.get(key) === field) drafts.set(key, field.value);
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
      // Leaving the field stores the draft at once.
      onblur: () => {
        if (fields.get(key) === field) keepDraft(key, field.value);
      },
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
      // A new session's first message still waits in the outbox: a second one would start a second session.
      if (
        a === "session.new" &&
        outbox.list(key).some((e) => e.a === "session.new")
      ) {
        line = {
          text: "The session starts once the PC gets your first message. Send this one after that.",
          bad: false,
        };
        return update();
      }
      sending = true;
      line = null;
      // The message shows at once at the chat's end with "Sending…", and the box empties (comfort design,
      // section 5). A card's typed answer is not a message: it waits in its box as before. The picked files stay
      // in the box until the PC took them.
      const m = ti
        ? null
        : {
            text,
            how:
              a === "session.note"
                ? "note"
                : a === "session.queue"
                  ? "queue"
                  : "send",
            state: "sending",
            from: readTo(),
          };
      if (m) {
        v.sent.push(m);
        emptyBox();
        m.slow = setTimeout(() => {
          if (m.state !== "sending") return;
          m.state = "slow";
          drawConvo(false);
        }, SLOW_SEND_MS);
        drawConvo(true);
      }
      update();
      const hello = ctx.hello;
      // A card's answer before the PC is linked waits for the link instead of failing.
      if (!m && !ctx.connected) await ctx.linked();
      const data =
        a === "session.new"
          ? { project: params.project, text, ...files }
          : { session: params.session, text, ...files };
      if (m) m.files = Boolean(files.attachments);
      // Before the PC is linked (a kept screen before the first hello, or a dropped link to a PC without ids) the
      // message waits in the outbox for the link (waitLink).
      if (m && !hello?.ids && !ctx.connected) {
        const e = outbox.add({
          key,
          a,
          d: data,
          text,
          how: m.how,
          early: true,
        });
        m.mid = e.mid;
        sending = false;
        if (m.files) attach.clear();
        update();
        return waitLink(e);
      }
      // A PC whose hello says ids: the message goes through the outbox (frame/outbox.js). A lost link only delays
      // it: it keeps its clock and goes again on the next link; the PC's answer ends it (the outbox's listener).
      if (m && hello?.ids) {
        const e = outbox.add({ key, a, d: data, text, how: m.how });
        m.mid = e.mid;
        const o = await outbox.send(e, ctx.ask);
        sending = false;
        // The files went with the message: they leave the box, so they are not sent twice.
        if (o.held && m.files) attach.clear();
        return update();
      }
      let r;
      try {
        if (ti) r = await ti.send(text);
        else r = await ctx.ask(a, data);
      } catch (e) {
        r = e;
      }
      sending = false;
      if (!m) {
        if (!r?.ok) {
          line = { text: `Not sent: ${why(r)}`, bad: true };
          return update();
        }
        emptyBox();
        v.typeInstead = null;
        update();
        drawDock();
        drawConvo(true);
        return load();
      }
      finish(m, a, r);
    }

    // The PC's answer to a message, or the link's failure with a PC that takes no ids. A refusal fades the message
    // out and puts its words back in the box, ahead of anything typed since: nothing typed is lost.
    function finish(m, a, r) {
      clearTimeout(m.slow);
      if (!r?.ok) {
        if (m.files && (r?.err ?? r?.code) === "attachment-unknown")
          attach.lost();
        m.state = "gone";
        drawConvo(false);
        setTimeout(() => {
          v.sent = v.sent.filter((x) => x !== m);
          drawConvo(false);
        }, FADE_MS);
        putBack(m.text);
        line = { text: backLine(r), bad: true };
        return update();
      }
      if (m.files) attach.clear();
      m.state = "sent";
      if (m.how === "queue" && !r.d.queued) m.how = "send";
      // Gone on to the session that continues the work: shown here as sent there, never as waiting in this queue.
      if (r.d.movedTo) {
        m.movedTo = r.d.movedTo;
        m.how = "send";
      }
      if (a === "session.new") params.session = r.d.session;
      update();
      drawConvo(nearEnd());
      load();
    }
    function putBack(text) {
      field.value = field.value ? `${text}\n\n${field.value}` : text;
      saveSoon();
      fit(true);
    }

    // The outbox's answers for this view's messages, also those sent again by the frame after a new link. A
    // message no longer in the chat (its words already in the transcript) needs nothing more.
    const offOutbox = outbox.listen(({ entry, r }) => {
      if (!view.isConnected) return offOutbox();
      if (entry.key !== key) return;
      const m = v.sent.find((x) => x.mid === entry.mid);
      if (!r?.ok) outbox.take(entry.mid);
      if (m) finish(m, entry.a, r);
      else if (!r?.ok) {
        putBack(entry.text);
        line = { text: backLine(r), bad: true };
        update();
      }
    });
    // Messages still in the outbox show in the chat with their clock; a refusal that came while this view was
    // closed puts its words back in the box now. One written before the link (a view the frame drew again at the
    // hello, or a page closed before it) waits for the link here too.
    for (const e of outbox.list(key)) {
      if (e.refused) {
        outbox.take(e.mid);
        putBack(e.text);
        line = { text: backLine(e.refused), bad: true };
      } else {
        v.sent.push({
          text: e.text,
          how: e.how,
          state: "sending",
          mid: e.mid,
          files: false,
          // Sent from an earlier view: the session may have written it before anything here was read.
          from: 0,
        });
        if (e.early) waitLink(e);
      }
    }

    // A message written before the link waits in the outbox, so a redraw at the hello and a close of the page keep
    // it. It goes once the link comes: with its id to a PC whose hello says ids (the frame's flush sends it too; the
    // outbox makes it one send), else once without one. Its answer reaches the view shown then, through the outbox's
    // listener, never this view's closure. To a PC known to take no ids it waits linkWait.ms at most: then its
    // words go back in the box. Without an id a repeat could run twice, so a failed link ends it the same way
    // (dropped: it may have arrived).
    function waitLink(e) {
      if (ctx.hello && !ctx.hello.ids && !ctx.connected)
        setTimeout(
          () => outbox.giveUp(e.mid, { err: "not-connected" }),
          linkWait.ms,
        );
      ctx.linked().then(async (hello) => {
        const now = outbox.get(e.mid);
        if (!now || now.refused) return;
        const ids = hello?.ids === true;
        const o = await outbox.send(now, ctx.ask, ids);
        if (o.held && !ids)
          outbox.giveUp(e.mid, {
            err: o.held.code ?? "failed",
            dropped: droppedAfter(o.held),
          });
      });
    }

    // Send now on a message past its hour of silent retries: the retries start over.
    async function sendNow(m) {
      const e = outbox.renew(m.mid);
      if (!e) return;
      ctx.haptic("impact");
      m.state = "sending";
      drawConvo(false);
      await outbox.send(e, ctx.ask);
    }
    function discard(m) {
      ctx.haptic("select");
      outbox.take(m.mid);
      clearTimeout(m.slow);
      v.sent = v.sent.filter((x) => x !== m);
      drawConvo(false);
    }
    function emptyBox() {
      field.value = "";
      clearTimeout(saving);
      saving = null;
      keepDraft(key, "");
      clearTimeout(quiet);
      fit(true);
    }

    return {
      box,
      update,
      sendNow,
      discard,
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
      say: (text) => {
        line = { text };
        update();
      },
    };
  }

  // What the cards (session-cards.js) use.
  v.name = name;
  v.why = why;
  // The PC accepted an answer to prompt `id`: its card leaves at once and the typing box takes its place. The PC is
  // asked again after each of timing.recheckMs; a pending answer that still names the prompt is ignored until the
  // last ask, where the card comes back only if no result line closed it.
  v.accepted = (id) => {
    v.answered = { id, last: false };
    v.back = null;
    v.pending = null;
    v.typeInstead = null;
    drawDock();
    compose.say("Answer sent.");
    timing.recheckMs.forEach((ms, i) => {
      setTimeout(() => {
        if (!view.isConnected || v.answered?.id !== id) return;
        if (i === timing.recheckMs.length - 1) v.answered.last = true;
        load();
      }, ms);
    });
  };
  // What session.pending names, less a prompt closed by its result line or one just answered here.
  function shownPending(p) {
    if (!p) return null;
    if (!p.promptType && v.closed.has(p.promptId)) return null;
    if (v.answered?.id === p.promptId) {
      if (!v.answered.last) return null;
      v.back = p.promptId;
    }
    return p;
  }
  v.answer = async (kind, answer) => {
    const id = v.pending.promptId;
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
    if (r?.ok) v.accepted(id);
    else if (r?.err === "no-prompt") load();
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
    const had = v.kept ? null : (v.info?.items ?? null);
    const last = open.d.items[open.d.items.length - 1];
    const sign = JSON.stringify([
      open.d.items.length,
      last?.text.length,
      last?.tools?.length,
      open.d.state,
    ]);
    v.error = null;
    v.asOf = new Date().toISOString();
    v.kept = null;
    // Unchanged turns keep what is drawn, earlier messages loaded by the user included.
    v.info =
      sign === v.sign
        ? { ...v.info, state: open.d.state, title: open.d.title }
        : open.d;
    params.title = open.d.title;
    v.pending = shownPending(pending.d);
    if (v.answered?.last) v.answered = null;
    v.queued = queued?.ok ? queued.d : [];
    drawBar();
    if (sign !== v.sign) {
      const toEnd = !first && nearEnd();
      if (had !== null) jump.more(newAtEnd(had, open.d.items));
      v.sign = sign;
      // The conversation now holds every row of a line before the byte this read stopped at (open.d.end): those
      // leave the live rows, the ones after stay, so a row written while the PC was asked shows once.
      // A push of such a row that comes after this answer is dropped too (apply).
      v.live.read = open.d.end;
      const held = v.live.rows.filter((r) => r.pos < v.live.read);
      v.live.before = lastOf(held, v.live.before);
      v.live.rows = v.live.rows.filter((r) => !(r.pos < v.live.read));
      drawConvo(toEnd);
      if (first) toPlace();
      keepSession();
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
      // Its bytes count from the start again: a message waiting to show may be anywhere in it.
      for (const m of v.sent) m.from = 0;
    } else if (d.rows.some((r) => !(r.pos < v.live.read))) {
      const toEnd = nearEnd();
      const fresh = d.rows.filter((r) => !(r.pos < v.live.read));
      v.live.rows.push(...fresh);
      jump.more(fresh.filter((r) => r.kind === "text").length);
      // A user message among them can be one still shown as sent: the whole conversation is drawn again.
      if (fresh.some((r) => r.kind === "text" && r.role === "user"))
        drawConvo(toEnd);
      else drawLive(toEnd);
    }
    // A result line for a question's or form's call closes that card for good, also on a page that did not answer
    // (the door's own prompts, permission and plan, end by the state change).
    for (const r of d.rows ?? []) if (r.kind === "result") v.closed.add(r.id);
    if (
      v.pending &&
      !v.pending.promptType &&
      v.closed.has(v.pending.promptId)
    ) {
      v.pending = null;
      v.back = null;
      v.typeInstead = null;
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
  if (v.kept) toPlace();
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
