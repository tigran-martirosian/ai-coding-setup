// Scroll hold: a chat you scroll up in stays where you put it while the agent keeps writing.
// Nimbalyst follows the bottom of a session's transcript (.rich-transcript-vlist): after every
// update it scrolls to the end when the view was within 50px of it. A touchpad or a smooth-scrolling
// wheel moves the view in small steps, so the first steps up are still "at the bottom" and the next
// update pulls the reader back down, again and again while text streams.
// Here, a user's scroll up (wheel, keys, scrollbar, touch) starts "reading": while reading, the
// transcript's own scrolls down to its end are dropped. Reading ends when the user scrolls back to
// the end, presses a button outside the messages (the "Scroll to bottom" arrow, a banner), the
// transcript is hidden, or it shows another session. Other scrolls (a jump to a message, keeping the
// view steady when something above it changes size) go through.
//
// An open question card stays still. While the agent waits for an answer, the session's helpers keep
// adding and growing rows around the card. The app's list library keeps the view steady only for a
// row wholly above the view; a row partly in sight that grows pushes the card down by its growth
// (and a steadying scroll the hold above drops would do the same). So once a frame, while a list holds
// an open card, the card's place on screen is checked: when it moved with no scroll of the list since
// the last frame, the list scrolls it back. A scroll (the user's, the library's own steadying, the
// app's jump to the card, not the hold's own) sets the card's new place, and so does any move in the
// half second after the user presses a pointer or a key in the list outside the card (a click that
// opens a tool row above it). A scroll back the list cannot make (at its top or end) is dropped. No
// open card, the list hidden or the card out of view: no frame loop.

// The build inlines this file into index.js, so everything but the exported names lives inside
// functions.

// The decision, kept apart from the page so it can be tested on its own
const HOLD_BOTTOM_PX = 50; // the app's own "at the bottom" distance
const HOLD_END_PX = 100; // a scroll whose target is this close to the end is a follow-the-bottom scroll
function createHold() {
  let reading = false;
  let downAt = -Infinity;
  return {
    get reading() {
      return reading;
    },
    up() {
      reading = true;
    },
    down(now, distance) {
      downAt = now;
      if (distance <= 1) reading = false; // already at the end: nothing will scroll, so no scroll event
    },
    // A scroll event, whatever caused it; only a user's own way down to the end stops reading
    scrolled(now, distance) {
      if (reading && distance < HOLD_BOTTOM_PX && now - downAt < 1000)
        reading = false;
    },
    stop() {
      reading = false;
    },
    // May the transcript scroll itself from `from` to `to`, where `max` is the end?
    allows(from, to, max) {
      return !(reading && to > from && to >= max - HOLD_END_PX);
    },
  };
}

// The open card's decision, apart from the page as well
const CARD_MOVE_PX = 0.5; // less is rounding, not a move
const CARD_USER_MS = 500; // after the user's press in the list, its moves are the user's
function createCardHold() {
  let anchor = null; // the card's top in the list's box, where it is kept
  let scrolled = false;
  let touchedAt = -Infinity;
  return {
    get anchor() {
      return anchor;
    },
    // The list scrolled: the card's place after it is the one to keep
    scrolled() {
      scrolled = true;
    },
    // The user pressed a pointer or a key in the list at `now` (ms)
    touched(now) {
      touchedAt = now;
    },
    // Once a frame: the card's top in the list's box (null: no open card), whether any of it is in
    // view, and the time (ms). Returns how far to scroll the list to put the card back (0: leave it).
    frame(top, inView, now) {
      if (top == null) {
        anchor = null;
        scrolled = false;
        return 0;
      }
      if (anchor == null || scrolled || now - touchedAt < CARD_USER_MS) {
        anchor = inView ? top : null;
        scrolled = false;
        return 0;
      }
      const moved = top - anchor;
      return Math.abs(moved) > CARD_MOVE_PX ? moved : 0;
    },
    // The scroll back moved the list `px` less than asked (at its top or end): keep the card there
    fellShort(px) {
      if (anchor != null) anchor += px;
    },
    stop() {
      anchor = null;
      scrolled = false;
    },
  };
}

// Does a box between the target and the list (a tool's output box with its own scrollbar) still
// scroll that way (dir < 0 up, > 0 down)? Then the wheel moves that box, not the chat.
function holdInnerScrolls(
  target,
  list,
  dir,
  overflowOf = (n) => getComputedStyle(n).overflowY,
) {
  for (let n = target; n && n !== list; n = n.parentElement) {
    if (n.scrollHeight <= n.clientHeight + 1) continue;
    const overflow = overflowOf(n);
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (
      dir < 0
        ? n.scrollTop > 0
        : n.scrollTop + n.clientHeight < n.scrollHeight - 1
    )
      return true;
  }
  return false;
}

// A text field: its keys move the caret, not the chat
function holdEditable(target) {
  return (
    !!target &&
    (target.isContentEditable ||
      /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName || ""))
  );
}

// The page side: one copy, started and stopped with the extension
const scrollHoldPage = (() => {
  const VLIST = ".rich-transcript-vlist";
  // Only the question card: other cards of the app may share its markup, with other meanings
  const CARD = '[data-testid="ask-user-question-widget"][data-state="pending"]';
  const UP_KEYS = new Set(["PageUp", "ArrowUp", "Home"]);
  const DOWN_KEYS = new Set(["PageDown", "ArrowDown", "End", " "]);
  // element -> { hold, session, scrollTo, seen, card, cardHold, cardSeen, ownTop }; ownTop: where the
  // hold's own scroll back put the list, until its scroll event comes
  const holds = new Map();
  let observer;
  let drag; // { el, top } while the user drags a scrollbar
  let touchY;
  let frame;
  let pending = false;
  let cardFrame; // the open card's frame loop, only while a list holds one
  const listeners = [];

  const distance = (el) => el.scrollHeight - el.scrollTop - el.clientHeight;
  const sessionOf = (el) =>
    el.closest("[data-session-id]")?.getAttribute("data-session-id") || "";
  const letCardGo = (s) => {
    if (s.card) s.cardSeen.unobserve(s.card);
    s.card = null;
    s.ownTop = undefined;
    s.cardHold.stop();
  };
  // A press in the list outside the open card: what moves next is the user's doing (a row opened)
  const touchedIn = (el, target) => {
    if (target.closest(CARD)) return;
    stateOf(el)?.cardHold.touched(performance.now());
  };
  const stateOf = (el) => {
    const s = holds.get(el);
    if (!s) return null;
    const session = sessionOf(el);
    if (session !== s.session) {
      s.session = session;
      s.hold.stop();
      letCardGo(s);
    }
    return s;
  };
  const vlistOf = (target) =>
    target && target.closest ? target.closest(VLIST) : null;

  function scrollTarget(el, args) {
    const [a, b] = args;
    if (a && typeof a === "object")
      return typeof a.top === "number" ? a.top : el.scrollTop;
    return typeof b === "number" ? b : el.scrollTop;
  }

  function attach(el) {
    if (holds.has(el)) return;
    const s = {
      hold: createHold(),
      session: sessionOf(el),
      card: null,
      cardHold: createCardHold(),
      // The card coming into sight starts the paused frame loop again
      cardSeen: new IntersectionObserver(() => queueCards()),
      ownTop: undefined,
    };
    // An own scrollTo on this element only; the app's list library scrolls through it
    s.scrollTo = function scrollTo(...args) {
      const st = stateOf(el);
      if (
        st &&
        !st.hold.allows(
          el.scrollTop,
          scrollTarget(el, args),
          el.scrollHeight - el.clientHeight,
        )
      )
        return;
      return Element.prototype.scrollTo.apply(this, args);
    };
    el.scrollTo = s.scrollTo;
    // Out of sight (another tab or session shown, a pane closed): the app scrolls to the end when it
    // shows again, and that goes through. In sight again: the paused card loop starts again
    s.seen = new IntersectionObserver((entries) => {
      if (entries.some((x) => !x.isIntersecting)) {
        s.hold.stop();
        letCardGo(s);
      }
      queueCards();
    });
    s.seen.observe(el);
    holds.set(el, s);
  }

  function detach(el) {
    const s = holds.get(el);
    if (!s) return;
    if (el.scrollTo === s.scrollTo) delete el.scrollTo;
    s.seen.disconnect();
    letCardGo(s);
    s.cardSeen.disconnect();
    holds.delete(el);
  }

  // One list's open card, once a frame; false when there is nothing to watch: no open card, the list
  // hidden, or the card out of view and not held (a scroll, the page or the card's sight wakes it)
  function holdCard(el, s, now) {
    // The hold's own scroll back has had its scroll event by now
    s.ownTop = undefined;
    const card = s.card;
    if (
      !card ||
      !card.isConnected ||
      !card.matches(CARD) ||
      !el.contains(card)
    ) {
      letCardGo(s);
      s.card = el.querySelector(CARD);
      if (!s.card) return false;
      s.cardSeen.observe(s.card);
    }
    const box = el.getBoundingClientRect();
    if (!box.height) {
      // Hidden (display: none): no place to keep
      s.cardHold.stop();
      return false;
    }
    const r = s.card.getBoundingClientRect();
    const inView = r.bottom > box.top && r.top < box.bottom;
    const by = s.cardHold.frame(r.top - box.top, inView, now);
    if (by) {
      // The browser's own scroll: ours on the element drops a scroll down near the end while reading
      const from = el.scrollTop;
      Element.prototype.scrollBy.call(el, { top: by, behavior: "instant" });
      const moved = el.scrollTop - from;
      if (moved) s.ownTop = el.scrollTop;
      if (Math.abs(by - moved) > CARD_MOVE_PX) s.cardHold.fellShort(by - moved);
    }
    return inView || s.cardHold.anchor != null;
  }

  function holdCards() {
    cardFrame = undefined;
    let any = false;
    try {
      const now = performance.now();
      for (const el of holds.keys()) {
        const s = stateOf(el);
        if (s && el.isConnected && holdCard(el, s, now)) any = true;
      }
    } catch (e) {
      console.error(
        "[agents-panel] scroll hold could not keep the question card in place:",
        e,
      );
      return;
    }
    if (any) cardFrame = requestAnimationFrame(holdCards);
  }

  function queueCards() {
    if (cardFrame !== undefined) return;
    for (const el of holds.keys())
      if (el.querySelector(CARD)) {
        cardFrame = requestAnimationFrame(holdCards);
        return;
      }
  }

  function scan() {
    pending = false;
    try {
      for (const el of holds.keys()) if (!el.isConnected) detach(el);
      for (const el of document.querySelectorAll(VLIST)) attach(el);
      queueCards();
    } catch (e) {
      console.error(
        "[agents-panel] scroll hold could not attach to the chat:",
        e,
      );
    }
  }

  function queueScan() {
    if (pending) return;
    pending = true;
    frame = requestAnimationFrame(scan);
  }

  function on(type, fn) {
    const opts = { capture: true, passive: true };
    document.addEventListener(type, fn, opts);
    listeners.push([type, fn, opts]);
  }

  function onWheel(e) {
    if (e.ctrlKey || !e.deltaY) return;
    const el = vlistOf(e.target);
    const s = el && stateOf(el);
    if (!s || holdInnerScrolls(e.target, el, e.deltaY)) return;
    if (e.deltaY < 0) {
      if (el.scrollTop > 0) s.hold.up();
    } else s.hold.down(Date.now(), distance(el));
  }

  function onKey(e) {
    const el = vlistOf(e.target);
    if (el) {
      if (holdEditable(e.target)) return;
      const s = stateOf(el);
      if (!s) return;
      touchedIn(el, e.target);
      if (UP_KEYS.has(e.key) || (e.key === " " && e.shiftKey)) {
        if (el.scrollTop > 0) s.hold.up();
      } else if (DOWN_KEYS.has(e.key)) s.hold.down(Date.now(), distance(el));
      return;
    }
    // Enter in the message box sends: the answer shows at the end, as without the hold
    if (e.key === "Enter" && !e.shiftKey && holdEditable(e.target))
      stopAround(e.target);
    else if (e.key === "Enter" || e.key === " ") pressed(e.target);
  }

  // Ends reading in the session around a node (the whole window when it is in none)
  function stopAround(node) {
    const scope = node.closest("[data-session-id]") || document;
    for (const el of scope.querySelectorAll(VLIST)) holds.get(el)?.hold.stop();
  }

  // A button outside the messages (the "Scroll to bottom" arrow, a "click to review" banner, send)
  function pressed(target) {
    const button =
      target && target.closest
        ? target.closest('button, [role="button"]')
        : null;
    if (button && !vlistOf(button)) stopAround(button);
  }

  function onPointerDown(e) {
    const el = vlistOf(e.target);
    if (!el) return pressed(e.target);
    // A press on the list element itself, not on a message: its scrollbar (also an overlay one)
    if (e.target === el) drag = { el, top: el.scrollTop };
    else touchedIn(el, e.target);
  }

  function onPointerUp() {
    drag = undefined;
  }

  // The click that opens a row comes when the press ends, maybe long after the pointerdown
  function onClick(e) {
    const el = vlistOf(e.target);
    if (el && e.target !== el) touchedIn(el, e.target);
  }

  function onTouchStart(e) {
    touchY = e.touches[0]?.clientY;
  }

  function onTouchMove(e) {
    const el = vlistOf(e.target);
    const s = el && stateOf(el);
    const y = e.touches[0]?.clientY;
    if (!s || y == null || touchY == null) return;
    if (
      Math.abs(y - touchY) > 2 &&
      holdInnerScrolls(e.target, el, touchY - y)
    ) {
      touchY = y;
      return;
    }
    if (y > touchY + 2) {
      if (el.scrollTop > 0) s.hold.up();
    } else if (y < touchY - 2) s.hold.down(Date.now(), distance(el));
    touchY = y;
  }

  function onScroll(e) {
    const el = e.target;
    if (!el || !el.matches || !el.matches(VLIST)) return;
    const s = stateOf(el);
    if (!s) return;
    // The hold's own scroll back is no new place for the card
    if (s.ownTop !== undefined && Math.abs(el.scrollTop - s.ownTop) < 1)
      s.ownTop = undefined;
    else s.cardHold.scrolled();
    queueCards();
    if (drag && drag.el === el) {
      if (el.scrollTop < drag.top) s.hold.up();
      else if (el.scrollTop > drag.top) s.hold.down(Date.now(), distance(el));
      drag.top = el.scrollTop;
    }
    s.hold.scrolled(Date.now(), distance(el));
  }

  function start() {
    if (observer) return;
    observer = new MutationObserver(queueScan);
    // data-state: a question card that turns open
    observer.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    on("wheel", onWheel);
    on("keydown", onKey);
    on("pointerdown", onPointerDown);
    on("pointerup", onPointerUp);
    on("click", onClick);
    on("touchstart", onTouchStart);
    on("touchmove", onTouchMove);
    on("scroll", onScroll);
    queueScan();
  }

  function stop() {
    observer?.disconnect();
    observer = undefined;
    cancelAnimationFrame(frame);
    pending = false;
    if (cardFrame !== undefined) cancelAnimationFrame(cardFrame);
    cardFrame = undefined;
    for (const [type, fn, opts] of listeners)
      document.removeEventListener(type, fn, opts);
    listeners.length = 0;
    for (const el of [...holds.keys()]) detach(el);
    drag = undefined;
  }

  return { start, stop };
})();

function startScrollHold() {
  scrollHoldPage.start();
}
function stopScrollHold() {
  scrollHoldPage.stop();
}

export {
  createCardHold,
  createHold,
  holdEditable,
  holdInnerScrolls,
  startScrollHold,
  stopScrollHold,
};
