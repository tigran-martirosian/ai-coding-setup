// The chat's "Thinking..." line (chat-column design 5 and its high-end round): while a turn runs, the app's last chat
// item is .rich-transcript-waiting with three bouncing dots, its words and the turn's time. This puts one thinking
// orb (shared/orbs/orbs.js) in place of the dots and our plain words in place of the app's:
//   - "Thinking..."                          -> "Thinking"; while the turn's newest tool card runs, that tool's
//                                               words ("Searching files", "Running a command")
//   - "Waiting on background task: <what>"   -> "Waiting on a background task: <what>"
//   - "Waiting on 3 background tasks..."     -> "Waiting on 3 background tasks"
//   - "Waiting for 2 agents to complete..."  -> "Waiting for 2 helpers to finish"
// The orb shows the stage: the newest tool card's (stage.js) while it runs, `connecting` while the turn waits on
// background work or helpers, else `breathing`. The time stays the app's own (it already has tabular-nums).
// React owns the line and rewrites its words when they change, so index.js calls syncThinking() on every change (its
// MutationObserver). Words or markup the app should have and has not are logged once and left as the app draws them.
// build.mjs inlines this file into dist/index.js (one scope with the other files, so its names are its own), so it
// must not import anything: the stage function comes in as an argument.

const WAIT_THINKING = /^Thinking\.\.\.$/;
const WAIT_BACKGROUND = /^Waiting on background task: (.+)$/s;
const WAIT_BACKGROUNDS = /^Waiting on (\d+) background tasks\.\.\.$/;
const WAIT_HELPERS = /^Waiting for (\d+) agents? to complete\.\.\.$/;
// The app's description when a background task has none
const WAIT_NO_WHAT = "background task";
const WAIT_SHELLS = new Set(["Bash", "PowerShell"]);

const waitMissed = new Set();

/** Logs a missing part of the thinking line once per window. */
function waitMissing(what) {
  if (waitMissed.has(what)) return;
  waitMissed.add(what);
  console.error(
    `[agents-panel] ${what} not found: the app's markup or words have changed, so the thinking line is left as the app draws it`,
  );
}

const waitCapital = (text) => text.charAt(0).toUpperCase() + text.slice(1);

/** Our words and orb for the app's waiting text. `card` is the turn's newest tool card while it runs ({ tool,
 *  command }) or null; `stage` is stage.js's stageOf. Returns { words, orb }, or null for words the app did not have
 *  on 0.83.0 (then its own words stay). */
function thinkingView(text, card, strings, stage) {
  const t = text.trim();
  const s = strings.waitLine;
  let m;
  if (WAIT_THINKING.test(t)) {
    if (!card) return { words: s.thinking, orb: "breathing" };
    const orb = WAIT_SHELLS.has(card.tool)
      ? stage({ kind: "Command", text: card.command })
      : stage({ kind: "", tool: card.tool });
    // The app names a helper's tool "Task"; a newer Claude Code names it "Agent"
    const doing = strings.now[card.tool === "Task" ? "Agent" : card.tool];
    return { words: doing ? waitCapital(doing) : s.thinking, orb };
  }
  if ((m = t.match(WAIT_BACKGROUND))) {
    const what = m[1].trim();
    return {
      words:
        what === WAIT_NO_WHAT
          ? s.background
          : s.backgroundWhat.replace("{what}", what),
      orb: "connecting",
    };
  }
  if ((m = t.match(WAIT_BACKGROUNDS)))
    return { words: s.backgrounds.replace("{n}", m[1]), orb: "connecting" };
  if ((m = t.match(WAIT_HELPERS)))
    return {
      words: (m[1] === "1" ? s.helper : s.helpers).replace("{n}", m[1]),
      orb: "connecting",
    };
  return null;
}

/** The tool call of a chat tool card, from the app's React props (TranscriptToolCard's `toolMsg`), or null. */
function cardCall(container) {
  const key = Object.keys(container).find((k) => k.startsWith("__reactFiber"));
  for (let f = key && container[key], d = 0; f && d < 4; f = f.return, d++) {
    const call = f.memoizedProps?.toolMsg?.toolCall;
    if (call) return call;
  }
  return null;
}

/** The turn's newest top-level tool card while it runs (no result yet): { tool, command }; else null. */
function runningCard(transcript) {
  const cards = transcript.querySelectorAll(
    ".rich-transcript-tool-container:not(.nested)",
  );
  const newest = cards[cards.length - 1];
  if (!newest) return null;
  const call = cardCall(newest);
  if (!call || typeof call.toolName !== "string") {
    waitMissing("a chat tool card's tool call (React props toolMsg.toolCall)");
    return null;
  }
  if (call.result != null) return null;
  return {
    tool: call.toolName,
    command: String(call.arguments?.command ?? ""),
  };
}

function waitAttr(node, name, value) {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value);
}

/** One thinking line: the orb right before the app's dots (style.css hides the dots while it is there), our words as
 *  the only child of the app's words span (the app's text kept on it, for the next pass and for deactivate). */
function syncLine(line, strings, stage) {
  const dots = line.querySelector(":scope > .rich-transcript-waiting-dots");
  const label = line.querySelector(":scope > .rich-transcript-waiting-text");
  if (!dots || !label) {
    waitMissing(
      !dots
        ? "the thinking line's dots (.rich-transcript-waiting-dots)"
        : "the thinking line's words (.rich-transcript-waiting-text)",
    );
    unsyncLine(line);
    return;
  }
  let ours = label.querySelector(":scope > .ap-thinking-text");
  const text =
    ours && label.childNodes.length === 1
      ? ours.dataset.apSource
      : label.textContent;
  const view = thinkingView(
    text,
    runningCard(line.parentElement),
    strings,
    stage,
  );
  if (!view) {
    waitMissing(`the thinking line's words "${text.trim()}"`);
    unsyncLine(line);
    return;
  }
  let orb = line.querySelector(":scope > .ap-thinking-orb");
  if (!orb) {
    orb = document.createElement("canvas");
    orb.className = "ap-thinking-orb";
    waitAttr(orb, "data-orb-px", "24");
    waitAttr(orb, "aria-hidden", "true");
  }
  if (orb.nextElementSibling !== dots) dots.before(orb);
  waitAttr(orb, "data-orb", view.orb);
  if (!ours || label.childNodes.length !== 1) {
    ours = document.createElement("span");
    ours.className = "ap-thinking-text";
    ours.dataset.apSource = text;
    label.replaceChildren(ours);
  }
  // Plain "Thinking" becomes one playful word ("Pondering", "Tinkering"), picked once per line so it holds for the turn
  let words = view.words;
  if (words === strings.waitLine.thinking) {
    const pool = strings.waitLine.playful;
    if (!pool.includes(line.dataset.apWord))
      line.dataset.apWord = pool[Math.floor(Math.random() * pool.length)];
    words = line.dataset.apWord;
  }
  if (ours.textContent !== words) ours.textContent = words;
}

/** Gives a line back to the app: no orb (so the dots show), the app's own words. */
function unsyncLine(line) {
  line.querySelector(":scope > .ap-thinking-orb")?.remove();
  delete line.dataset.apWord;
  for (const ours of line.querySelectorAll(".ap-thinking-text"))
    ours.parentElement.textContent = ours.dataset.apSource;
}

/** `stage` is stage.js's stageOf. */
function syncThinking(strings, stage) {
  for (const line of document.querySelectorAll(".rich-transcript-waiting"))
    syncLine(line, strings, stage);
}

function stopThinking() {
  for (const line of document.querySelectorAll(".rich-transcript-waiting"))
    unsyncLine(line);
  document.querySelectorAll(".ap-thinking-orb").forEach((n) => n.remove());
}

// "Needs you" (chat-column design 3, the build plan's look rule): a session that waits on the user says so in the
// same two words in four places, each with the `listening` orb in the warning tone:
//   - its session row: the orb in the row's right slot in place of the app's icon, "Needs you" leading the meta line,
//     "Needs you · 2" from two waiting questions (the count only while that session's chat is mounted, see below)
//   - the chat's "Jump to question" bar (.rich-transcript-question-navigation): orb, "Needs you", then what waits
//     ("1 question: <the newest question>", "3 questions: <the newest> and 2 more")
//   - the question card (.ask-user-question-widget[data-state="pending"]): orb and "Needs you" in its header
//   - the agents list's summary line (index.js): "Needs you" leading it while the panel's session waits
// A running session row gets a stage orb and "running" in place of the app's spinner: the orb of its chat's
// thinking line while that chat is mounted, `connecting` while the app says it waits on background tasks, else
// `working` (the app keeps another session's stage in its store, out of a script's reach).
// Where the facts come from (Nimbalyst 0.83.0): the row's state is the app's own status class
// (`waiting-for-input`, `pending-prompt`, `processing`, `background-wait`). The waiting questions are worked out
// from the chat view's props (RichTranscriptView: sessionId, messages, hasPendingInteractivePrompt) the same way
// the app's findPendingQuestions does; the app's per-session list (sessionPendingPromptsAtom) is a store atom no
// script can read, so a session whose chat is not mounted shows "Needs you" with no count.

const QUESTION_TOOLS = new Set([
  "AskUserQuestion",
  "PromptForUserInput",
  "RequestUserInput",
]);
const MCP_TOOL = /^mcp__[^_]+(?:_[^_]+)*__(.+)$/;
const TOOL_LIKE = new Set(["tool_call", "interactive_prompt", "subagent"]);
const ANSWER_RESUME = "[Resuming after answering a question]";
const NEEDS_STATES = ["waiting-for-input", "pending-prompt"];
const RUNNING_STATES = ["processing", "background-wait"];
const ROW_ID = /^session-list-item-(.+)$/;

const isQuestionTool = (name) =>
  typeof name === "string" &&
  QUESTION_TOOLS.has(name.match(MCP_TOOL)?.[1] ?? name);

/** A user message that starts a new human turn (not an answer to a card, not one the agent or system sent). */
function isHumanTurn(m) {
  if (m.type !== "user_message" || m.optimistic) return false;
  if (m.promptActor === "agent" || m.promptActor === "system") return false;
  return (
    m.promptOrigin !== "interactive-question" &&
    !m.text?.startsWith(ANSWER_RESUME)
  );
}

/** The question cards still waiting for an answer, oldest first: [{ id, questions: [text, ...] }]. As the app's
 *  partitionUnansweredQuestions: a question tool call with no result since the last human turn. */
function openQuestions(messages) {
  const open = [];
  const seen = new Set();
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.type === "user_message") {
      if (isHumanTurn(m)) break;
      continue;
    }
    const call = m.toolCall;
    const id = call?.providerToolCallId;
    if (!id || seen.has(id)) continue;
    seen.add(id);
    if (!isQuestionTool(call.toolName) || call.result || !TOOL_LIKE.has(m.type))
      continue;
    const asked = Array.isArray(call.arguments?.questions)
      ? call.arguments.questions
      : [];
    open.unshift({
      id,
      questions: asked
        .map((q) => q?.question)
        .filter((q) => typeof q === "string"),
    });
  }
  return open;
}

/** What waits, for the chat bar: the number of questions (a card can ask several) and the newest card's first
 *  one. Returns { count, what }; `what` is null when no card is open. A card whose words the app's arguments do
 *  not carry counts as one question and is named by the count alone. */
function needsWhat(cards, strings) {
  const s = strings.needs;
  const count = cards.reduce((n, c) => n + Math.max(1, c.questions.length), 0);
  if (!count) return { count, what: null };
  const newest = cards[cards.length - 1].questions[0];
  const what = !newest
    ? (count === 1 ? s.oneBare : s.manyBare).replace("{n}", count)
    : count === 1
      ? s.one.replace("{what}", newest)
      : s.many
          .replace("{n}", count)
          .replace("{more}", count - 1)
          .replace("{what}", newest);
  return { count, what };
}

/** The meta-line words of a session row: "Needs you", "Needs you · 2" (a count only from 2), "running".
 *  Returns [{ text, part }]. */
function sessionWords(state, count, strings) {
  if (state === "running")
    return [{ text: strings.needs.running, part: "running" }];
  const parts = [{ text: strings.needs.word, part: "needs" }];
  if (count >= 2) parts.push({ text: String(count), part: "count" });
  return parts;
}

const needsMissed = new Set();

/** Logs a missing part of the "Needs you" marks once per window. */
function needsMissing(what) {
  if (needsMissed.has(what)) return;
  needsMissed.add(what);
  console.error(
    `[agents-panel] ${what} not found: the app's markup has changed, so "Needs you" is left as the app draws it there`,
  );
}

/** The props of the nearest React component above `node` that pass `test`, or null. */
function propsAbove(node, test, depth) {
  const key = Object.keys(node).find((k) => k.startsWith("__reactFiber"));
  for (let f = key && node[key], d = 0; f && d < depth; f = f.return, d++)
    if (f.memoizedProps && test(f.memoizedProps)) return f.memoizedProps;
  return null;
}

/** Every mounted chat: Map of session id to { view, waiting, cards } (cards: openQuestions). */
function chatSessions() {
  const chats = new Map();
  for (const view of document.querySelectorAll(".rich-transcript-view")) {
    const p = propsAbove(
      view,
      (q) => typeof q.sessionId === "string" && Array.isArray(q.messages),
      8,
    );
    if (!p) {
      needsMissing(
        "a chat view's session and messages (React props sessionId, messages)",
      );
      continue;
    }
    chats.set(p.sessionId, {
      view,
      waiting: p.hasPendingInteractivePrompt === true,
      cards: openQuestions(p.messages),
    });
  }
  return chats;
}

/** The session id the agents list belongs to (TeammatePanel's props), or null. */
function panelSession(panel) {
  const p = propsAbove(panel, (q) => typeof q.sessionId === "string", 4);
  if (!p) needsMissing("the agents list's session (React props sessionId)");
  return p?.sessionId ?? null;
}

function needsOrb(className, orb, px = "24") {
  const c = document.createElement("canvas");
  c.className = className;
  c.setAttribute("data-orb", orb);
  c.setAttribute("data-orb-px", px);
  c.setAttribute("aria-hidden", "true");
  return c;
}

/** Spans for `parts` joined by " · " (the meta line's own separator), each marked with its part. */
function needsParts(node, parts) {
  const key = parts.map((p) => `${p.part}:${p.text}`).join("|");
  if (node.dataset.apKey === key) return;
  node.dataset.apKey = key;
  node.replaceChildren(
    ...parts.flatMap((p, i) => {
      const span = document.createElement("span");
      span.dataset.apPart = p.part;
      span.textContent = p.text;
      if (!i) return [span];
      const sep = document.createElement("span");
      sep.className = "ap-sep";
      sep.textContent = " · ";
      return [sep, span];
    }),
  );
}

/** One session row: state from the app's status class, orb in the right slot, words leading the meta line. */
function syncRow(row, chats, strings) {
  const status = row.querySelector(
    ":scope > .session-list-item-right > .session-list-item-status",
  );
  const cls =
    status &&
    [...NEEDS_STATES, ...RUNNING_STATES].find((c) =>
      status.classList.contains(c),
    );
  if (!cls) return unsyncRow(row);
  const state = NEEDS_STATES.includes(cls) ? "needs" : "running";
  const chat = chats.get(row.id.match(ROW_ID)?.[1]);
  // The words lead the meta line; a compact row has none, so they go before its time
  const meta = row.querySelector(".session-list-item-meta");
  const compactTime =
    !meta &&
    row.querySelector(
      ".session-list-item-compact-line > .session-list-item-datetime",
    );
  if (!meta && !compactTime) {
    needsMissing("a session row's meta line (.session-list-item-meta)");
    return unsyncRow(row);
  }
  const orbState =
    state === "needs"
      ? "listening"
      : cls === "background-wait"
        ? "connecting"
        : (chat?.view.querySelector(
            ".rich-transcript-waiting > .ap-thinking-orb",
          )?.dataset.orb ?? "working");
  let orb = status.parentElement.querySelector(":scope > .ap-session-orb");
  if (!orb) {
    // A session row's orb is the row's 16px icon size, not the 24px of the chat
    orb = needsOrb("ap-session-orb", orbState, "16");
    status.parentElement.append(orb);
  }
  waitAttr(orb, "data-orb", orbState);
  // The app's tooltip moves to our orb with its icon hidden ("Waiting for your response", "Processing...")
  if (status.title) waitAttr(orb, "title", status.title);
  let words = row.querySelector(".ap-session-state");
  if (!words) {
    words = document.createElement("span");
    words.className = "ap-session-state";
  }
  if (meta) {
    if (meta.firstChild !== words) meta.prepend(words);
  } else if (words.nextElementSibling !== compactTime)
    compactTime.before(words);
  waitAttr(words, "data-ap-state", state);
  const count =
    state === "needs" && chat ? needsWhat(chat.cards, strings).count : 0;
  needsParts(words, sessionWords(state, count, strings));
  waitAttr(row, "data-ap-session", state === "needs" ? "needs-you" : "running");
}

function unsyncRow(row) {
  row.querySelector(".ap-session-orb")?.remove();
  row.querySelector(".ap-session-state")?.remove();
  if (row.hasAttribute("data-ap-session"))
    row.removeAttribute("data-ap-session");
}

/** The orb and "Needs you" mark of the bar and the card. */
function needsMark(className, strings) {
  const mark = document.createElement("span");
  mark.className = className;
  const word = document.createElement("span");
  word.className = "ap-needs-word";
  word.textContent = strings.needs.word;
  mark.append(needsOrb("ap-needs-orb", "listening"), word);
  return mark;
}

/** The chat's "Jump to question" bar: orb, "Needs you", what waits, then the app's button. */
function syncBanner(bar, chats, strings) {
  const button = bar.querySelector(":scope > .rich-transcript-question-button");
  const view = bar.closest(".rich-transcript-view");
  const chat = view && [...chats.values()].find((c) => c.view === view);
  const { what } = chat ? needsWhat(chat.cards, strings) : { what: null };
  if (!button || !what) {
    needsMissing(
      !button
        ? "the chat's Jump to question button (.rich-transcript-question-button)"
        : "the open question behind the chat's Jump to question bar",
    );
    return unsyncBanner(bar);
  }
  let mark = bar.querySelector(":scope > .ap-needs-banner");
  if (!mark) {
    mark = needsMark("ap-needs-banner", strings);
    const text = document.createElement("span");
    text.className = "ap-needs-what";
    mark.append(text);
  }
  if (mark.nextElementSibling !== button) button.before(mark);
  const text = mark.querySelector(".ap-needs-what");
  if (text.textContent !== what) text.textContent = what;
  waitAttr(text, "title", what);
  waitAttr(bar, "data-ap-needs", "banner");
}

function unsyncBanner(bar) {
  bar.querySelector(":scope > .ap-needs-banner")?.remove();
  if (bar.hasAttribute("data-ap-needs")) bar.removeAttribute("data-ap-needs");
}

/** A question card waiting for its answer: orb and "Needs you" after the header's title. */
function syncCard(card, strings) {
  const title = card.querySelector(":scope > div:first-child > span");
  if (!title) {
    needsMissing("the question card's header title");
    return unsyncCard(card);
  }
  let mark = title.parentElement.querySelector(":scope > .ap-needs-card");
  if (!mark) mark = needsMark("ap-needs-card", strings);
  if (title.nextElementSibling !== mark) title.after(mark);
  waitAttr(card, "data-ap-needs", "card");
}

function unsyncCard(card) {
  card.querySelector(".ap-needs-card")?.remove();
  if (card.hasAttribute("data-ap-needs")) card.removeAttribute("data-ap-needs");
}

/** Re-applies every "Needs you" and running mark; index.js calls it on every change, after syncThinking (a running
 *  row takes its chat's thinking-line orb). `chats` is chatSessions(). */
function syncNeeds(strings, chats) {
  for (const row of document.querySelectorAll(".session-list-item"))
    syncRow(row, chats, strings);
  for (const bar of document.querySelectorAll(
    ".rich-transcript-question-navigation",
  ))
    syncBanner(bar, chats, strings);
  for (const card of document.querySelectorAll(
    '.ask-user-question-widget[data-state="pending"]',
  ))
    syncCard(card, strings);
  // A card answered since the last pass, a bar or row the app has since redrawn without its state
  for (const card of document.querySelectorAll(
    '[data-ap-needs="card"]:not([data-state="pending"])',
  ))
    unsyncCard(card);
}

function stopNeeds() {
  for (const row of document.querySelectorAll("[data-ap-session]"))
    unsyncRow(row);
  for (const bar of document.querySelectorAll('[data-ap-needs="banner"]'))
    unsyncBanner(bar);
  for (const card of document.querySelectorAll('[data-ap-needs="card"]'))
    unsyncCard(card);
  document
    .querySelectorAll(
      ".ap-session-orb, .ap-session-state, .ap-needs-banner, .ap-needs-card",
    )
    .forEach((n) => n.remove());
}

export {
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
};
