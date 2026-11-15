// The session's chat beside the job page (tracker chat design, sections 3, 4, 8 and 10): while our page stands, the
// Sessions view's own chat column (its session tabs, transcript and input) is moved in as the last child of the
// tracker's flex row, and moved home again before the page leaves. It already holds the session open in the Sessions
// view, and a click on a row of the Sessions column changes it: nothing of ours runs for that. React keeps drawing
// the column where it stands; its home gets a guard, so React never meets a missing child (that error would blank
// the window). With no session open the app draws no column, and a quiet two-line panel stands in its place.
// A 6 px handle before the column sets its width (sections 1, 2 and 7); the Chat button in the page header
// (reading.js) shows or hides it. "Open session" on a row picks its session in the Sessions column, so it shows in
// this chat (section 5); an opened item stands beside the list or in its place (section 6), and the full-page item's
// own chat is hidden while this one is on the page (style.css).

import { SEL } from "./selectors.js";

// The chat's widths (design sections 1 and 7): 420 px from a 1440 px window, 340 px below it; never under 300 or
// over 640, and never so wide that the page gets under 480. Below a 1200 px window it starts hidden.
const CHAT_WIDE = 420;
const CHAT_NARROW = 340;
const CHAT_WIDE_FROM = 1440;
const CHAT_MIN = 300;
const CHAT_MAX = 640;
const PAGE_MIN = 480;
const CHAT_HIDDEN_BELOW = 1200;
// The handle's width, and one arrow key's move (section 2)
const HANDLE_WIDTH = 6;
const KEY_STEP = 16;

// The user's choice to show ("true") or hide ("false") the chat, kept in the app's local storage (shared by its
// windows); none: the window's width decides
const SHOWN_KEY = "job-tracker.chatShown";
// The width the user set by drag or keys, kept the same way; clamped to the window, never overwritten by a clamp
const WIDTH_KEY = "job-tracker.chatWidth";

/** Whether the chat stands beside the page: the user's choice, else shown from a 1200 px window. */
function chatShown(win) {
  const choice = localStorage.getItem(SHOWN_KEY);
  if (choice === "true") return true;
  if (choice === "false") return false;
  return win.innerWidth >= CHAT_HIDDEN_BELOW;
}

/** The user's choice from the Chat button, kept over the width default. */
function setChatShown(show) {
  localStorage.setItem(SHOWN_KEY, String(show));
}

/**
 * The width for the chat part `part` (the column or the no-session panel) in the tracker row `row`: the kept width,
 * else the default for the window, clamped so the page keeps 480 px (the other parts of the row keep theirs).
 */
function chatWidthFor(row, part, want) {
  const win = row.ownerDocument.defaultView;
  const kept = Number(localStorage.getItem(WIDTH_KEY));
  let w = want;
  if (w == null)
    w =
      kept > 0
        ? kept
        : win.innerWidth >= CHAT_WIDE_FROM
          ? CHAT_WIDE
          : CHAT_NARROW;
  // The page is the part of the row that holds our page: on the live app the row's one child is the app's resizable
  // panel, whose left side holds the tracker sidebar (with the Sessions column moved in); that side is not page
  const root = row.querySelector(SEL.root);
  let others = 0;
  for (const c of row.children) {
    if (c === part || c.classList.contains("rt-chat-handle")) continue;
    const width = c.getBoundingClientRect().width;
    if (!root || !c.contains(root)) {
      others += width;
      continue;
    }
    let pagePart = root;
    while (
      pagePart !== c &&
      !pagePart.parentElement.querySelector(
        `${SEL.sidebar}, ${SEL.sessionsList}`,
      )
    )
      pagePart = pagePart.parentElement;
    others += width - pagePart.getBoundingClientRect().width;
  }
  const room = row.clientWidth - HANDLE_WIDTH - others - PAGE_MIN;
  return Math.round(Math.max(CHAT_MIN, Math.min(CHAT_MAX, room, w)));
}

/** The chat part at width `w`; the handle says it. Unchanged values are not written again. */
function setChatWidth(part, handle, w) {
  if (part.style.flexBasis !== `${w}px`)
    part.style.cssText = `flex: 0 0 ${w}px; min-width: 0; height: 100%;`;
  if (handle && handle.getAttribute("aria-valuenow") !== String(w))
    handle.setAttribute("aria-valuenow", String(w));
}

/**
 * The 6 px handle (design section 2): a drag sets the width within the limits, arrow keys move it 16 px, a
 * double-click gives the default back and forgets the kept width. The column is the handle's next sibling.
 */
function makeChatHandle(doc, words) {
  const h = doc.createElement("div");
  h.className = "rt-chat-handle";
  h.tabIndex = 0;
  h.setAttribute("role", "separator");
  h.setAttribute("aria-orientation", "vertical");
  h.setAttribute("aria-label", words.chatHandle);
  h.setAttribute("aria-valuemin", String(CHAT_MIN));
  h.setAttribute("aria-valuemax", String(CHAT_MAX));
  const size = (want) => {
    const part = h.nextElementSibling;
    const w = chatWidthFor(h.parentElement, part, want);
    setChatWidth(part, h, w);
    return w;
  };
  const keep = (w) => localStorage.setItem(WIDTH_KEY, String(w));
  // A drag measures the row once, at its start (the widest the chat may get), and then writes one width per frame:
  // no layout reads while the transcript reflows under the pointer
  let drag = null;
  h.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    h.setPointerCapture(e.pointerId);
    h.classList.add("rt-chat-dragging");
    drag = {
      x: e.clientX,
      from: Number(h.getAttribute("aria-valuenow")),
      max: chatWidthFor(h.parentElement, h.nextElementSibling, CHAT_MAX),
      frame: 0,
    };
  });
  h.addEventListener("pointermove", (e) => {
    if (!drag) return;
    // Leftward widens the chat: the handle sits on its left edge
    drag.want = drag.from + drag.x - e.clientX;
    if (drag.frame) return;
    drag.frame = requestAnimationFrame(() => {
      if (!drag) return;
      drag.frame = 0;
      drag.w = Math.round(Math.max(CHAT_MIN, Math.min(drag.max, drag.want)));
      setChatWidth(h.nextElementSibling, h, drag.w);
    });
  });
  const end = () => {
    if (!drag) return;
    if (drag.frame) cancelAnimationFrame(drag.frame);
    if (drag.want != null)
      drag.w = Math.round(Math.max(CHAT_MIN, Math.min(drag.max, drag.want)));
    if (drag.w != null) {
      setChatWidth(h.nextElementSibling, h, drag.w);
      keep(drag.w);
    }
    drag = null;
    // Last, so the sync this class change starts finds the kept width
    h.classList.remove("rt-chat-dragging");
  };
  h.addEventListener("pointerup", end);
  h.addEventListener("pointercancel", end);
  h.addEventListener("dblclick", () => {
    localStorage.removeItem(WIDTH_KEY);
    size();
  });
  h.addEventListener("keydown", (e) => {
    const step =
      e.key === "ArrowLeft" ? KEY_STEP : e.key === "ArrowRight" ? -KEY_STEP : 0;
    if (!step) return;
    e.preventDefault();
    keep(size(Number(h.getAttribute("aria-valuenow")) + step));
  });
  return h;
}

/**
 * A change of the tracker row's size (the window, or the Sessions column folded) sizes the chat again: `chat.again`
 * runs a sync. One watcher per row.
 */
function watchChatRow(row, chat) {
  if (chat.watched === row) return;
  if (chat.observer) chat.observer.disconnect();
  chat.watched = row;
  chat.observer = new ResizeObserver(() => chat.again());
  chat.observer.observe(row);
}

/** One error per opening of the tracker page (the page watcher calls this file on every change). */
function failOnce(chat, text) {
  if (!chat.failed) console.error(text);
  chat.failed = true;
}

/**
 * The chat column on the tracker page `page`, as the last child of its flex row, with the handle before it. `chat` is
 * the state this file keeps: { moved: { column, home, next, style, gone } or null, failed: an error was logged this
 * opening, watched and observer: the row's size watcher, again: runs a sync }. `words` holds the panel's two lines
 * and the handle's name.
 */
function showChat(doc, page, chat, words) {
  const row = page.querySelector(SEL.trackerRow);
  if (row) watchChatRow(row, chat);
  if (!chatShown(doc.defaultView)) {
    returnChat(doc, chat);
    return;
  }
  if (!row) {
    returnChat(doc, chat);
    failOnce(chat, "job-tracker: no tracker row to show the chat in");
    return;
  }
  const home = doc.querySelector(SEL.chatHome);
  const found = doc.querySelector(SEL.chatColumn);
  let m = chat.moved;
  // React removed the column while it was away, the agent view was drawn anew, or a new column stands at home: the
  // old one goes (home when its home still stands, else it is left over)
  if (m && (m.gone || m.home !== home || (found && found !== m.column))) {
    returnChat(doc, chat);
    m = null;
  }
  const column = found || (m && m.column);
  if (!column) {
    if (doc.querySelector(SEL.currentSession)) {
      // A session is open but its column is not where it was (a new app version renamed it): no made-up chat
      removeChatEmpty(doc);
      removeChatHandle(doc);
      failOnce(chat, "job-tracker: no chat column to show beside the tracker");
      return;
    }
    removeChatHandle(doc);
    const panel = showChatEmpty(doc, row, words);
    setChatWidth(panel, null, chatWidthFor(row, panel));
    return;
  }
  removeChatEmpty(doc);
  const handle =
    row.querySelector(":scope > .rt-chat-handle") || makeChatHandle(doc, words);
  if (
    column.parentElement === row &&
    row.lastElementChild === column &&
    column.previousElementSibling === handle
  ) {
    // While the handle is dragged its width stands: a sync would put the kept width back under the pointer
    if (!handle.classList.contains("rt-chat-dragging"))
      setChatWidth(column, handle, chatWidthFor(row, column));
    return;
  }
  if (!m) {
    m = {
      column,
      home,
      next: column.nextSibling,
      style: column.getAttribute("style"),
      gone: false,
    };
    chat.moved = m;
    guardHome(home, m);
  }
  row.append(handle, column);
  setChatWidth(column, handle, chatWidthFor(row, column));
}

/** The column home before its saved next sibling, with its own style attribute back. */
function putHome(m) {
  const next = m.next && m.next.parentElement === m.home ? m.next : null;
  m.home.insertBefore(m.column, next);
  if (m.style === null) m.column.removeAttribute("style");
  else m.column.setAttribute("style", m.style);
}

/**
 * The guard on the column's home, set once per home: if React removes the column, or inserts before it, while it is
 * away, it is put home first. A removed column is marked gone, so the next sync does not move it in again.
 */
function guardHome(home, m) {
  if (home.__jtChatGuard) {
    home.__jtChatGuard.m = m;
    return;
  }
  const g = { m };
  const back = (node) => {
    if (g.m && node === g.m.column && node.parentElement !== home) putHome(g.m);
  };
  const remove = home.removeChild;
  const insert = home.insertBefore;
  home.removeChild = function (node) {
    back(node);
    if (g.m && node === g.m.column) g.m.gone = true;
    return remove.call(this, node);
  };
  home.insertBefore = function (node, ref) {
    back(ref);
    return insert.call(this, node, ref);
  };
  home.__jtChatGuard = g;
}

/** The moved column back home and the panel gone (a no-op when nothing was moved). */
function returnChat(doc, chat) {
  removeChatEmpty(doc);
  removeChatHandle(doc);
  const m = chat.moved;
  if (!m) return;
  chat.moved = null;
  if (m.home.__jtChatGuard) m.home.__jtChatGuard.m = null;
  if (m.column.parentElement === m.home) return;
  if (m.home.isConnected && !m.gone) putHome(m);
  // The app drew its agent view anew meanwhile, or dropped this column: it is left over
  else m.column.remove();
}

/** No session open: the quiet panel at the chat's width, "No session open" and how to pick one. */
function showChatEmpty(doc, row, words) {
  let panel = doc.querySelector(".rt-chat-empty");
  if (panel && panel.parentElement === row && row.lastElementChild === panel)
    return panel;
  if (!panel) {
    panel = doc.createElement("aside");
    panel.className = "rt-chat-empty";
    const title = doc.createElement("p");
    title.className = "rt-chat-empty-title";
    title.textContent = words.chatEmpty;
    const lead = doc.createElement("p");
    lead.className = "rt-chat-empty-lead";
    lead.textContent = words.chatEmptyLead;
    panel.append(title, lead);
  }
  row.appendChild(panel);
  return panel;
}

function removeChatEmpty(doc) {
  for (const el of doc.querySelectorAll(".rt-chat-empty")) el.remove();
}

function removeChatHandle(doc) {
  for (const el of doc.querySelectorAll(".rt-chat-handle")) el.remove();
}

/** The tracker page left: the column home, its size no longer watched, and the next opening may log its error again. */
function leaveChat(doc, chat) {
  returnChat(doc, chat);
  if (chat.observer) chat.observer.disconnect();
  chat.observer = null;
  chat.watched = null;
  chat.failed = false;
}

// Where an opened item stands (design section 6), read from the app's code (TrackerDocumentView and
// TrackerDetailPanelResizable, 2026-11-14): the item view's region sits in a flex row beside the list region that
// holds our page; the app gives it `shrink-0` and an inline width, or `data-fill="true"` on a full-page item. Its
// close button is the item view's `button[title="Close (Esc)"]`.
const ITEM_REGION = '[data-testid="tracker-detail-region"]';
const ITEM_CLOSE = 'button[title="Close (Esc)"]';
// The list keeps at least this much beside the item, else the item takes its place
const LIST_MIN = 440;
// The full-page item's "Chat about this item" option in the top bar's panel menu (WindowTopBar, PanelButton): its
// label is the only thing that tells it apart, so it gets our mark and style.css hides it while the chat is on
const TOPBAR_MENU = '[data-testid="window-top-bar-right-pane-menu"]';
const ITEM_CHAT_LABEL = "Chat about this item";

/**
 * The session's row in the Sessions column (`#session-list-item-<id>`, the app's own id), or null when it is not
 * there: archived, filtered out by the list's search, or not drawn by the list (a virtual list; tracker chat design
 * section 5).
 */
function listedSession(doc, sessionId) {
  const row = doc.getElementById(`session-list-item-${sessionId}`);
  return row && row.closest(SEL.sessionsList) ? row : null;
}

/** The open item's region beside our page's list, or null (none open, or a full-page item). */
function itemRegion(page) {
  const root = page.querySelector(SEL.root);
  if (!root) return null;
  for (const r of page.querySelectorAll(ITEM_REGION))
    if (r.dataset.fill !== "true" && r.parentElement.contains(root)) return r;
  return null;
}

/** The item's row and the item are watched for size: a change runs a sync, which places the item again. */
function watchItem(item, parent, region) {
  if (item.parent === parent && item.region === region) return;
  if (item.observer) item.observer.disconnect();
  item.parent = parent;
  item.region = region;
  item.observer = new ResizeObserver(() => item.again());
  item.observer.observe(parent);
  item.observer.observe(region);
}

/** The item beside the list again: the list shown at the scroll place it had, our Back line gone. */
function itemBeside(doc, item) {
  for (const el of doc.querySelectorAll(".rt-item-back")) el.remove();
  const wide = item.wide;
  if (!wide) return;
  item.wide = null;
  wide.parent.classList.remove("rt-item-wide");
  for (const [el, top] of wide.scrolls) el.scrollTop = top;
}

/**
 * Notes the list's scroll places as the user opens an item, before the item stands beside the list and narrows it
 * (a hidden list loses its place, and a narrowed one moves).
 */
function noteListScroll(doc, item) {
  const root = doc.querySelector(SEL.root);
  if (!root) return;
  item.listScrolls = [];
  for (let e = root.parentElement; e; e = e.parentElement)
    item.listScrolls.push([e, e.scrollTop]);
}

/**
 * The opened item beside the list when the list keeps 440 px, else in its place (design section 6): the item's row
 * gets `rt-item-wide`, which hides the list and lets the item fill the row (its own drag width is ignored, not
 * changed), with a "Back to <job>" line above it that closes the item the app's way. `item` is the state this keeps:
 * { wide: { parent, scrolls } or null, parent and region watched, observer, failed, again: runs a sync }. `back` is
 * the Back line's text.
 */
function placeItem(doc, page, item, back) {
  const region = itemRegion(page);
  if (!region) {
    leaveItem(doc, item);
    return;
  }
  const parent = region.parentElement;
  watchItem(item, parent, region);
  const width = Number.parseFloat(region.style.width);
  if (!(width > 0)) {
    itemBeside(doc, item);
    if (!item.failed)
      console.error("job-tracker: the item view has no width of its own");
    item.failed = true;
    return;
  }
  if (parent.clientWidth - width >= LIST_MIN) {
    itemBeside(doc, item);
    return;
  }
  if (!item.wide || item.wide.parent !== parent) {
    itemBeside(doc, item);
    // The list's scroll place from before the item opened, kept while it is hidden (a hidden box loses it)
    const scrolls = (item.listScrolls || []).filter(
      ([e]) => e !== parent && parent.contains(e),
    );
    item.wide = { parent, scrolls };
    item.listScrolls = null;
    parent.classList.add("rt-item-wide");
  }
  let line = parent.querySelector(":scope > .rt-item-back");
  if (!line) line = makeItemBack(doc);
  if (line.nextElementSibling !== region) region.before(line);
  const label = line.querySelector(".rt-item-back-label");
  if (label.textContent !== back) label.textContent = back;
}

/** The Back line: a button that clicks the item view's own close button, so the app closes the item its way. */
function makeItemBack(doc) {
  const line = doc.createElement("div");
  line.className = "rt-item-back";
  const b = doc.createElement("button");
  b.type = "button";
  const icon = doc.createElement("span");
  icon.className = "material-symbols-outlined rt-item-back-icon";
  icon.setAttribute("aria-hidden", "true");
  icon.textContent = "arrow_back";
  const label = doc.createElement("span");
  label.className = "rt-item-back-label";
  b.append(icon, label);
  b.addEventListener("click", () => {
    const region = line.nextElementSibling;
    const close = region && region.querySelector(ITEM_CLOSE);
    if (!close) {
      console.error("job-tracker: the item view has no close button");
      return;
    }
    close.click();
  });
  line.append(b);
  return line;
}

/** The tracker page left or not drawn: the item back beside the list, nothing watched, the error may show again. */
function leaveItem(doc, item) {
  itemBeside(doc, item);
  if (item.observer) item.observer.disconnect();
  item.observer = null;
  item.parent = null;
  item.region = null;
  item.failed = false;
}

/** Marks the top bar's "Chat about this item" option, so style.css can hide it while our chat is on the page. */
function markItemChat(doc) {
  for (const b of doc.querySelectorAll(`${TOPBAR_MENU} [role="menuitem"]`))
    if (
      !b.hasAttribute("data-rt-item-chat") &&
      [...b.children].some((c) => c.textContent === ITEM_CHAT_LABEL)
    )
      b.setAttribute("data-rt-item-chat", "");
}

export {
  chatShown,
  leaveChat,
  leaveItem,
  listedSession,
  markItemChat,
  noteListScroll,
  placeItem,
  returnChat,
  setChatShown,
  showChat,
};
