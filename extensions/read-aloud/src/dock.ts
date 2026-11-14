/**
 * The docked player: a one-line player above the chat box while the reply being read is scrolled out of view,
 * so the player keeps its controls when its strip is gone. It shows only while something is being read and that
 * reply's player box is not on screen, and it goes with the box: Close here or in the box (or the end of the
 * reply) hides both.
 *
 * Plain DOM (the host gives this extension no portal): one element, put just before the chat box of the session
 * that holds the reply (or the chat box on screen), and redrawn once per frame while the player, the page or its
 * scroll changes.
 */

import { type PlayerState, player } from "./player";
import { t } from "./strings";
import {
  type BoxView,
  boxKeyDown,
  boxView,
  closePlayer,
  ORB_DELAY_MS,
} from "./transcript";

const SEL = {
  chatBox: ".ai-chat-input",
  session: "[data-session-id]",
  list: ".rich-transcript-vlist",
};

/** What the dock shows, or null when it is hidden: only while reading, and only while the strip is off screen. */
export function dockView(
  st: PlayerState,
  stripOnScreen: boolean,
  orbShown: boolean,
): BoxView | null {
  if (stripOnScreen || st.status === "idle") return null;
  return boxView(st, st.key, orbShown);
}

/** The player box of the item being read, if the chat has it on the page now (a long chat drops far rows). */
function findStrip(key: string): HTMLElement | null {
  for (const el of document.querySelectorAll<HTMLElement>(
    ".readaloud-control.active",
  )) {
    if (el.getAttribute("data-readaloud-key") === key && el.offsetParent)
      return el;
  }
  return null;
}

/** Whether any of the element is inside its chat's scroll area (and the window). */
function onScreen(el: HTMLElement): boolean {
  const r = el.getBoundingClientRect();
  const list = el.closest(SEL.list)?.getBoundingClientRect();
  const top = Math.max(list?.top ?? 0, 0);
  const bottom = Math.min(list?.bottom ?? innerHeight, innerHeight);
  return r.height > 0 && r.bottom > top && r.top < bottom;
}

function button(
  icon: string,
  word: string,
  onClick: () => void,
  title?: string,
) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "readaloud-btn";
  if (title) b.title = title;
  const i = document.createElement("span");
  i.className = "material-symbols-outlined";
  i.textContent = icon;
  const w = document.createElement("span");
  w.className = "readaloud-word";
  w.textContent = word;
  b.append(i, w);
  b.addEventListener("click", onClick);
  return b;
}

/** Starts the dock for this window; returns the stop function. */
export function startDock(): () => void {
  const dock = document.createElement("div");
  dock.className = "readaloud-dock";
  dock.setAttribute("role", "region");
  dock.setAttribute("aria-label", t.dockLabel);
  dock.addEventListener("keydown", (e) => void boxKeyDown(e, close));

  let key: string | null = null;
  // Where the reply was when it was last on screen, so "Show reply" can bring back a row the chat dropped
  let lastSeen: {
    list: HTMLElement;
    top: number;
    session: string | null;
  } | null = null;
  let orbShown = false;
  let orbTimer = 0;
  let drawn = "";
  let frame = 0;

  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(update);
  };
  const scheduleIfReading = () => {
    if (player.get().status !== "idle") schedule();
  };

  function close() {
    const box = dock.nextElementSibling;
    const hadFocus = dock.contains(document.activeElement);
    closePlayer();
    if (hadFocus)
      box
        ?.querySelector<HTMLElement>("textarea, [contenteditable='true']")
        ?.focus();
  }

  function showReply() {
    if (!key) return;
    const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
    const strip = findStrip(key);
    if (strip) {
      strip.scrollIntoView({
        block: "center",
        behavior: smooth ? "smooth" : "auto",
      });
      return;
    }
    if (!lastSeen?.list.isConnected) return;
    lastSeen.list.scrollTop = lastSeen.top;
    const k = key;
    requestAnimationFrame(() =>
      findStrip(k)?.scrollIntoView({ block: "center" }),
    );
  }

  /** The chat box to dock above: the one of the reply's session when it is on screen, else the one on screen. */
  function chatBox(session: string | null): HTMLElement | null {
    const boxes = [
      ...document.querySelectorAll<HTMLElement>(SEL.chatBox),
    ].filter((b) => b.offsetParent);
    return (
      boxes.find(
        (b) =>
          session &&
          b.closest(SEL.session)?.getAttribute("data-session-id") === session,
      ) ??
      boxes[0] ??
      null
    );
  }

  function draw(view: BoxView, canShow: boolean) {
    const sig = `${view.state}|${view.word}|${view.detail}|${view.mark}|${canShow}`;
    if (sig === drawn) return;
    drawn = sig;
    const status = document.createElement("span");
    status.className = "readaloud-status";
    status.setAttribute("aria-live", "polite");
    const mark = document.createElement("span");
    mark.className = "readaloud-mark";
    if (view.mark === "orb") {
      const orb = document.createElement("canvas");
      orb.setAttribute("data-orb", "breathing");
      orb.setAttribute("data-orb-px", "24");
      orb.setAttribute("aria-hidden", "true");
      mark.append(orb);
    } else if (view.mark === "dot") {
      const dot = document.createElement("span");
      dot.className = `readaloud-dot ${view.state}`;
      mark.append(dot);
    }
    const word = document.createElement("span");
    word.className = `readaloud-state-word ${view.state}`;
    word.textContent = view.word;
    status.append(mark, word);
    if (view.detail) {
      const detail = document.createElement("span");
      detail.className = "readaloud-detail";
      detail.textContent = view.detail;
      status.append(detail);
    }
    const actions = [
      view.state === "paused"
        ? button("play_arrow", t.resume, () => player.resume())
        : button("pause", t.pause, () => player.pause()),
    ];
    if (canShow)
      actions.push(
        button("vertical_align_top", t.showReply, showReply, t.showReplyTip),
      );
    const closeBtn = button("close", t.close, close, t.closeTip);
    closeBtn.classList.add("readaloud-close");
    closeBtn.setAttribute("aria-keyshortcuts", "Escape");
    actions.push(closeBtn);
    const hadFocus = dock.contains(document.activeElement);
    dock.replaceChildren(status, ...actions);
    if (hadFocus) closeBtn.focus();
  }

  function hide() {
    dock.remove();
    drawn = "";
  }

  function update() {
    frame = 0;
    const st = player.get();
    if (st.key !== key) {
      key = st.key;
      lastSeen = null;
    }
    // The orb shows only when preparing lasts longer than ORB_DELAY_MS, as in the box
    const preparing = st.status === "synthesizing";
    if (!preparing) {
      clearTimeout(orbTimer);
      orbTimer = 0;
      orbShown = false;
    } else if (!orbShown && !orbTimer) {
      orbTimer = window.setTimeout(() => {
        orbShown = true;
        orbTimer = 0;
        schedule();
      }, ORB_DELAY_MS);
    }
    const strip = key ? findStrip(key) : null;
    const seen = !!strip && onScreen(strip);
    if (strip && seen) {
      const list = strip.closest<HTMLElement>(SEL.list);
      const session =
        strip.closest(SEL.session)?.getAttribute("data-session-id") ?? null;
      if (list) lastSeen = { list, top: list.scrollTop, session };
    }
    const view = dockView(st, seen, orbShown);
    const box = view ? chatBox(lastSeen?.session ?? null) : null;
    if (!view || !box) return hide();
    const style = getComputedStyle(box);
    dock.style.marginLeft = style.marginLeft;
    dock.style.marginRight = style.marginRight;
    if (dock.nextElementSibling !== box) box.before(dock);
    draw(view, !!strip || !!lastSeen?.list.isConnected);
  }

  const unsubscribe = player.subscribe(schedule);
  const observer = new MutationObserver(scheduleIfReading);
  observer.observe(document.body, { childList: true, subtree: true });
  document.addEventListener("scroll", scheduleIfReading, {
    capture: true,
    passive: true,
  });
  window.addEventListener("resize", scheduleIfReading);
  schedule();

  return () => {
    unsubscribe();
    observer.disconnect();
    document.removeEventListener("scroll", scheduleIfReading, {
      capture: true,
    });
    window.removeEventListener("resize", scheduleIfReading);
    cancelAnimationFrame(frame);
    clearTimeout(orbTimer);
    hide();
  };
}
