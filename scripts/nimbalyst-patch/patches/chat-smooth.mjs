// Our own change, not an upstream PR: the agent chat stops jumping while a turn runs. Measured on 0.83.0 with
// 1758 applied (2026-11-20, a recorder logging every frame of the chat list):
// 1. Each new row snapped the view down by the row's whole height in one frame, and a long reply jumped
//    straight to its last line (2,133 px in one frame for a 500-word reply), so its start was never seen.
// 2. Every follow-scroll counted as the reader scrolling down, and virtua (the list library) then drops its
//    buffer above the view: in a long session about 60 rendered rows were thrown away on each new row and
//    built again 150-175 ms later, a stutter per row.
// 3. Rows not yet drawn were guessed at a fixed 90 px (real rows are 38-700 px), so as rows got drawn the
//    list's height swung by thousands of px and the visible text bounced 100-480 px for seconds after a long
//    session was opened.
// With this patch: following the bottom glides there (eased, at most about 8% of the view per frame; from
// further than 1.5 views away it first jumps to 1.5 views short); a reply that arrives while the chat is open
// and is taller than most of the view stops with its first line at the top and following pauses, so the
// "scroll to bottom" button takes the reader on; sending a message turns following back on; virtua keeps its
// buffer on both sides while scrolling; undrawn rows are guessed from the median of the drawn ones (virtua's
// own default when no fixed size is given). Opening a session (and its first second after the list is ready)
// still snaps to the end at once, as do the scroll-to-bottom button and jumps to a message.
// Measured on the same test turn, old vs patched: biggest one-frame move 1,090 px vs 163-224 px, rows above
// the view rebuilt 9 times vs 0. The buffer change is in virtua's shared code, so every
// virtua list in this chunk keeps rows on both sides while scrolling. Never retires: no upstream fix to wait for.
export default {
  id: "chat-smooth",
  files: /^out\/renderer\/assets\/registerExtensionSystem-[A-Za-z0-9_-]+\.js$/,
  upstream: null,
  requires: ["1758"],
  edits: [
    // virtua: keep the buffer above and below the view while scrolling (it kept only the side scrolled toward)
    {
      anchor: `1 !== I3 && (r3 -= t4), 2 !== I3 && (i3 += t4)`,
      replace: `r3 -= t4, i3 += t4`,
    },
    // The transcript list: no fixed 90 px guess, virtua guesses from the median of the drawn rows
    {
      anchor: `              bufferSize: vlistBufferSize,
              itemSize: 90,
`,
      replace: `              bufferSize: vlistBufferSize,
`,
    },
    // Following the bottom glides, and stops at the first line of a tall new reply
    {
      anchor: `  const followEnd = reactExports.useCallback(() => {
    if (hasPendingQuestionsRef.current || pointerHeldRef.current) return;
    if (shouldAutoScrollTranscript(getAtBottomState(), hasActiveTranscriptSelection(viewRootRef.current))) {
      scrollToEnd();
    }
  }, [getAtBottomState, scrollToEnd]);
`,
      replace: `  const glideFrameRef = reactExports.useRef(0);
  const glideTimeRef = reactExports.useRef(0);
  const lastMessageRef = reactExports.useRef(null);
  lastMessageRef.current = messages.length > 0 ? { index: messages.length - 1, type: messages[messages.length - 1].type } : null;
  const newRowsFromRef = reactExports.useRef({ sessionId: null, count: 0, from: 0 });
  {
    const rows = newRowsFromRef.current;
    if (rows.sessionId !== sessionId || rows.count === 0) {
      rows.sessionId = sessionId;
      rows.from = messages.length;
    }
    rows.count = messages.length;
  }
  const scrollReadyRef = reactExports.useRef(false);
  const openedAtRef = reactExports.useRef(0);
  scrollReadyRef.current = isScrollReady;
  if (!isScrollReady) openedAtRef.current = performance.now();
  reactExports.useEffect(() => () => cancelAnimationFrame(glideFrameRef.current), []);
  const followTarget = reactExports.useCallback((scroller) => {
    const bottom = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const last = lastMessageRef.current;
    const list = vlistRef.current;
    if (list && last && last.type === "assistant_message" && last.index >= newRowsFromRef.current.from) {
      const top = list.getItemOffset(last.index) - 8;
      if (list.getItemSize(last.index) > scroller.clientHeight * 0.8 && top >= scroller.scrollTop - 2 && top < bottom) {
        return { target: top, capped: true };
      }
    }
    return { target: bottom, capped: false };
  }, []);
  const resumedForRef = reactExports.useRef(-1);
  const followEnd = reactExports.useCallback(() => {
    const sent = lastMessageRef.current;
    if (sent && sent.type === "user_message" && sent.index >= newRowsFromRef.current.from && resumedForRef.current !== sent.index) {
      resumedForRef.current = sent.index;
      setAtBottomState(true);
    }
    if (!scrollReadyRef.current || performance.now() - openedAtRef.current < 1000) {
      if (hasPendingQuestionsRef.current || pointerHeldRef.current) return;
      if (shouldAutoScrollTranscript(getAtBottomState(), hasActiveTranscriptSelection(viewRootRef.current))) scrollToEnd();
      return;
    }
    if (glideFrameRef.current) return;
    glideTimeRef.current = performance.now();
    const step = (now) => {
      glideFrameRef.current = 0;
      if (hasPendingQuestionsRef.current || pointerHeldRef.current) return;
      if (!shouldAutoScrollTranscript(getAtBottomState(), hasActiveTranscriptSelection(viewRootRef.current))) return;
      const scroller = scrollContainerRef.current?.querySelector(".rich-transcript-vlist");
      if (!scroller) return;
      const { target, capped } = followTarget(scroller);
      let current = scroller.scrollTop;
      const gap = target - current;
      if (gap <= 1) {
        if (capped) setAtBottomState(false);
        return;
      }
      const dt = Math.min(64, Math.max(1, (now ?? performance.now()) - glideTimeRef.current));
      glideTimeRef.current = now ?? performance.now();
      if (gap > scroller.clientHeight * 1.5) current = target - scroller.clientHeight * 1.5;
      const left = target - current;
      const eased = Math.ceil(left * (1 - Math.pow(0.78, dt / 16.7)));
      current += Math.max(1, Math.min(eased, Math.ceil(scroller.clientHeight * 0.08 * dt / 16.7)));
      scroller.scrollTop = Math.min(target, current);
      lastScrollOffsetRef.current = scroller.scrollTop;
      glideFrameRef.current = requestAnimationFrame(step);
    };
    glideFrameRef.current = requestAnimationFrame(step);
  }, [getAtBottomState, followTarget, setAtBottomState, scrollToEnd]);
`,
    },
  ],
};
