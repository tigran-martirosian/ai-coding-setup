// Nimbalyst PR #1758 (nimbalyst/nimbalyst), refs #919: the agent transcript stops pulling the reader back
// while a reply streams. RichTranscriptView keeps the bottom itself (scrollTop = scrollHeight, and a
// ResizeObserver on the list and its content re-pins while following) instead of virtua's
// scrollToIndex(last, "end"), which re-aimed at a fixed row on every resize and ignored the reader's own
// scrolling. Following ends only on reader input: wheel up, ArrowUp, PageUp, Home or Shift+Space, an upward
// drag with the pointer held, or a programmatic jump (scroll to message, to top, a search result, the
// permission banner). No pin while the pointer is held, text is selected or a question is pending.
// Ported to 0.83.0 from the PR's head e4dc40e7: RichTranscriptView lives in the hashed renderer chunk
// out/renderer/assets/registerExtensionSystem-*.js. 0.83.0's scrollToMessage already takes a toolCallId and
// its onScroll has a false-top check; both are kept as they are.
// Left out: the tests (the new e2e transcript-scroll-bottom.spec.ts and the unit test changes).
// `upstream` is the declaration rollup emits for the PR's `export function nextTranscriptFollowState`;
// this port declares the same rule as a const, so a patched bundle never holds the marker.
export default {
  id: "1758",
  files: /^out\/renderer\/assets\/registerExtensionSystem-[A-Za-z0-9_-]+\.js$/,
  upstream: "function nextTranscriptFollowState(",
  edits: [
    // The follow rule and the new shouldAutoScrollTranscript(isFollowing, hasActiveSelection)
    {
      anchor: `function shouldAutoScrollTranscript(wasAtBottom, distanceFromBottom, hasActiveSelection = false) {
  if (hasActiveSelection) return false;
  return wasAtBottom || isTranscriptAtBottom(distanceFromBottom);
}
`,
      replace: `const SCROLL_UP_KEYS = /* @__PURE__ */ new Set(["ArrowUp", "PageUp", "Home"]);
const nextTranscriptFollowState = (isFollowing, distanceFromBottom, movedUp, pointerHeld) => {
  if (distanceFromBottom <= 1) return true;
  if (movedUp && pointerHeld) return false;
  return isFollowing || !movedUp && isTranscriptAtBottom(distanceFromBottom);
};
function shouldAutoScrollTranscript(isFollowing, hasActiveSelection = false) {
  if (hasActiveSelection) return false;
  return isFollowing;
}
`,
    },
    // The last scroll offset and whether the pointer is held in the list
    {
      anchor: `  const isAtBottomRef = reactExports.useRef(
    persistScrollState ? getSessionIsAtBottom(sessionId) : true
  );
`,
      replace: `  const isAtBottomRef = reactExports.useRef(
    persistScrollState ? getSessionIsAtBottom(sessionId) : true
  );
  const lastScrollOffsetRef = reactExports.useRef(0);
  const pointerHeldRef = reactExports.useRef(false);
`,
    },
    // A pending question stops the pin
    {
      anchor: `    ready: isScrollReady && isContainerVisible
  });
  const settings = propsSettings || defaultSettings;
`,
      replace: `    ready: isScrollReady && isContainerVisible
  });
  const hasPendingQuestionsRef = reactExports.useRef(false);
  hasPendingQuestionsRef.current = pendingQuestions.length > 0;
  const settings = propsSettings || defaultSettings;
`,
    },
    // scrollToEnd, followEnd and handleScrollIntent
    {
      anchor: `  const getAtBottomState = reactExports.useCallback(() => {
    return isAtBottomRef.current;
  }, []);
`,
      replace: `  const getAtBottomState = reactExports.useCallback(() => {
    return isAtBottomRef.current;
  }, []);
  const scrollToEnd = reactExports.useCallback(() => {
    const scroller = scrollContainerRef.current?.querySelector(".rich-transcript-vlist");
    if (!scroller) return;
    scroller.scrollTop = scroller.scrollHeight;
    lastScrollOffsetRef.current = scroller.scrollTop;
  }, []);
  const followEnd = reactExports.useCallback(() => {
    if (hasPendingQuestionsRef.current || pointerHeldRef.current) return;
    if (shouldAutoScrollTranscript(getAtBottomState(), hasActiveTranscriptSelection(viewRootRef.current))) {
      scrollToEnd();
    }
  }, [getAtBottomState, scrollToEnd]);
  const handleScrollIntent = reactExports.useCallback((event) => {
    if (event.type === "pointerdown") {
      pointerHeldRef.current = true;
      const release = () => {
        pointerHeldRef.current = false;
      };
      window.addEventListener("pointerup", release, { once: true });
      window.addEventListener("pointercancel", release, { once: true });
      return;
    }
    const scrollsUp = "deltaY" in event ? event.deltaY < 0 && !event.ctrlKey : "key" in event && (SCROLL_UP_KEYS.has(event.key) || event.key === " " && event.shiftKey) && !event.target.closest('input, textarea, select, [contenteditable="true"]');
    const scroller = event.currentTarget.querySelector(".rich-transcript-vlist");
    if (scrollsUp && scroller && scroller.scrollTop > 0) setAtBottomState(false);
  }, [setAtBottomState]);
`,
    },
    // Jumping to a message leaves follow mode
    {
      anchor: `      if (!vlistRef.current) return;
      vlistRef.current.scrollToIndex(index2, { align: toolCallId ? "start" : "center" });
`,
      replace: `      if (!vlistRef.current) return;
      setAtBottomState(false);
      vlistRef.current.scrollToIndex(index2, { align: toolCallId ? "start" : "center" });
`,
    },
    // Jumping to the top leaves follow mode
    {
      anchor: `    scrollToTop: () => {
      vlistRef.current?.scrollToIndex(0, { align: "start" });
    }
  }), []);
`,
      replace: `    scrollToTop: () => {
      setAtBottomState(false);
      vlistRef.current?.scrollToIndex(0, { align: "start" });
    }
  }), [setAtBottomState]);
`,
    },
    // Opening a session pins to the last pixel, below the "Thinking..." row too. Only the scroll call is
    // anchored: patch 1867 replaces the condition line above it.
    {
      anchor: `        vlistRef.current?.scrollToIndex(messages.length - 1, { align: "end" });
      }
      frame = requestAnimationFrame(() => {
`,
      replace: `        setAtBottomState(true);
        scrollToEnd();
      }
      frame = requestAnimationFrame(() => {
`,
    },
    // New messages follow the end; a ResizeObserver re-pins while rows grow
    {
      anchor: `  reactExports.useEffect(() => {
    if (pendingQuestions.length > 0) return;
    const wasAtBottom = getAtBottomState();
    const frame = requestAnimationFrame(() => {
      if (!vlistRef.current) return;
      const scrollSize = vlistRef.current.scrollSize;
      const viewportSize = vlistRef.current.viewportSize;
      const scrollOffset = vlistRef.current.scrollOffset;
      const distanceFromBottom = scrollSize - scrollOffset - viewportSize;
      const hasActiveSelection = hasActiveTranscriptSelection(viewRootRef.current);
      if (shouldAutoScrollTranscript(wasAtBottom, distanceFromBottom, hasActiveSelection)) {
        const lastIndex = isWaitingForResponse ? messages.length : messages.length - 1;
        vlistRef.current.scrollToIndex(lastIndex, { align: "end" });
        setAtBottomState(true);
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [getAtBottomState, messages, isWaitingForResponse, setAtBottomState, pendingQuestions.length]);
`,
      replace: `  reactExports.useEffect(() => {
    const frame = requestAnimationFrame(followEnd);
    return () => cancelAnimationFrame(frame);
  }, [followEnd, messages, isWaitingForResponse, pendingQuestions.length]);
  const hasTranscriptRows = messages.length > 0 || isWaitingForResponse;
  reactExports.useEffect(() => {
    const scroller = scrollContainerRef.current?.querySelector(".rich-transcript-vlist");
    if (!scroller) return;
    const observer = new ResizeObserver(followEnd);
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [sessionId, isContainerVisible, hasTranscriptRows, followEnd]);
`,
    },
    // The scroll-to-bottom button pins to the last pixel and follows again
    {
      anchor: `  const scrollToBottom = reactExports.useCallback(() => {
    if (!vlistRef.current) return;
    const lastIndex = isWaitingForResponse ? messages.length : messages.length - 1;
    vlistRef.current.scrollToIndex(lastIndex, { align: "end" });
  }, [messages.length, isWaitingForResponse]);
`,
      replace: `  const scrollToBottom = reactExports.useCallback(() => {
    setAtBottomState(true);
    scrollToEnd();
  }, [scrollToEnd, setAtBottomState]);
`,
    },
    // A search result leaves follow mode
    {
      anchor: `        onScrollToMessage: (index2) => {
          vlistRef.current?.scrollToIndex(index2, { align: "center" });
`,
      replace: `        onScrollToMessage: (index2) => {
          setAtBottomState(false);
          vlistRef.current?.scrollToIndex(index2, { align: "center" });
`,
    },
    // The wheel, keys and pointer on the list report the reader's intent
    {
      anchor:
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the app's own source text, matched as it is
        'jsxRuntimeExports.jsx("div", { className: `rich-transcript-messages rich-transcript-messages-wrapper flex flex-col max-w-full overflow-x-hidden h-full ${isScrollReady ? "scroll-ready" : ""}`, children:',
      replace:
        // biome-ignore lint/suspicious/noTemplateCurlyInString: the app's own source text, matched as it is
        'jsxRuntimeExports.jsx("div", { className: `rich-transcript-messages rich-transcript-messages-wrapper flex flex-col max-w-full overflow-x-hidden h-full ${isScrollReady ? "scroll-ready" : ""}`, onWheel: handleScrollIntent, onKeyDown: handleScrollIntent, onPointerDown: handleScrollIntent, children:',
    },
    // onScroll applies the follow rule instead of "within 50px of the end"
    {
      anchor: `                  const isAtBottom = isTranscriptAtBottom(distanceFromBottom);
                  setAtBottomState(isAtBottom);
`,
      replace: `                  const movedUp = offset2 < lastScrollOffsetRef.current;
                  lastScrollOffsetRef.current = offset2;
                  setAtBottomState(nextTranscriptFollowState(isAtBottomRef.current, distanceFromBottom, movedUp, pointerHeldRef.current));
`,
    },
    // The permission banner's jump leaves follow mode
    {
      anchor: `                const targetIdx = pendingPermissionIndices[0];
                vlistRef.current?.scrollToIndex(targetIdx, { align: "center" });
`,
      replace: `                const targetIdx = pendingPermissionIndices[0];
                setAtBottomState(false);
                vlistRef.current?.scrollToIndex(targetIdx, { align: "center" });
`,
    },
  ],
};
