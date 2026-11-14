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

// The build inlines this file into index.js, so everything but the three exported names lives
// inside functions.

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
  const UP_KEYS = new Set(["PageUp", "ArrowUp", "Home"]);
  const DOWN_KEYS = new Set(["PageDown", "ArrowDown", "End", " "]);
  const holds = new Map(); // element -> { hold, session, scrollTo, seen }
  let observer;
  let drag; // { el, top } while the user drags a scrollbar
  let touchY;
  let frame;
  let pending = false;
  const listeners = [];

  const distance = (el) => el.scrollHeight - el.scrollTop - el.clientHeight;
  const sessionOf = (el) =>
    el.closest("[data-session-id]")?.getAttribute("data-session-id") || "";
  const stateOf = (el) => {
    const s = holds.get(el);
    if (!s) return null;
    const session = sessionOf(el);
    if (session !== s.session) {
      s.session = session;
      s.hold.stop();
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
    const s = { hold: createHold(), session: sessionOf(el) };
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
    // shows again, and that goes through
    s.seen = new IntersectionObserver((entries) => {
      if (entries.some((x) => !x.isIntersecting)) s.hold.stop();
    });
    s.seen.observe(el);
    holds.set(el, s);
  }

  function detach(el) {
    const s = holds.get(el);
    if (!s) return;
    if (el.scrollTo === s.scrollTo) delete el.scrollTo;
    s.seen.disconnect();
    holds.delete(el);
  }

  function scan() {
    pending = false;
    try {
      for (const el of holds.keys()) if (!el.isConnected) detach(el);
      for (const el of document.querySelectorAll(VLIST)) attach(el);
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
  }

  function onPointerUp() {
    drag = undefined;
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
    observer.observe(document.body, { childList: true, subtree: true });
    on("wheel", onWheel);
    on("keydown", onKey);
    on("pointerdown", onPointerDown);
    on("pointerup", onPointerUp);
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
  createHold,
  holdEditable,
  holdInnerScrolls,
  startScrollHold,
  stopScrollHold,
};
