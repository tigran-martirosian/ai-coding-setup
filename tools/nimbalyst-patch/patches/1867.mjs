// Nimbalyst PR #1867 (nimbalyst/nimbalyst): "Jump to question" and the automatic jump go to the newest open
// question card, not the oldest (an abandoned card stays open after the agent re-asks under a new id). The
// automatic jump fires once per newly opened question and not again when the pane is shown again; a jump
// cut short by a hidden pane or a session switch is still retried. Ported to the 0.83.0 renderer from the
// PR's head 46d6242f: usePendingQuestionNavigation and RichTranscriptView live in a hashed chunk
// (out/renderer/assets/registerExtensionSystem-*.js).
// Left out: the tests (usePendingQuestionNavigation.test.ts, RichTranscriptView.permissionBanner.test.tsx)
// and the CHANGELOG line. The PR's `export` on PendingQuestion and findPendingQuestions only serves the tests.
// `upstream` is the declaration rollup emits for the PR's `export function selectAutoJumpQuestion`; this
// port declares the same helper as a const, so a patched bundle never holds the marker.
export default {
  id: "1867",
  files: /^out\/renderer\/assets\/registerExtensionSystem-[A-Za-z0-9_-]+\.js$/,
  upstream: "function selectAutoJumpQuestion(",
  edits: [
    // usePendingQuestionNavigation.ts: newestPendingQuestion, selectAutoJumpQuestion, and the per-session
    // record of revealed question ids that replaces navigationRef
    {
      anchor: `function usePendingQuestionNavigation({ messages, sessionId, ready, vlistRef, scrollContainerRef }) {
  const pendingQuestions = reactExports.useMemo(() => findPendingQuestions(messages), [messages]);
  const navigationRef = reactExports.useRef({ sessionId, seen: /* @__PURE__ */ new Set() });
`,
      replace: `const newestPendingQuestion = (questions) => {
  return questions[questions.length - 1];
};
const selectAutoJumpQuestion = (questions, revealed) => {
  const newest = newestPendingQuestion(questions);
  return newest && !revealed.has(newest.id) ? newest : void 0;
};
function usePendingQuestionNavigation({ messages, sessionId, ready, vlistRef, scrollContainerRef }) {
  const pendingQuestions = reactExports.useMemo(() => findPendingQuestions(messages), [messages]);
  const revealedRef = reactExports.useRef(/* @__PURE__ */ new Map());
  const revealedFor = reactExports.useCallback((id2) => {
    let revealed = revealedRef.current.get(id2);
    if (!revealed) revealedRef.current.set(id2, revealed = /* @__PURE__ */ new Set());
    return revealed;
  }, []);
`,
    },
    // usePendingQuestionNavigation.ts jumpToQuestion: a question counts as shown once a reveal frame runs
    {
      anchor: `      if (latest2.sessionId !== sessionId || !target || !vlistRef.current) return;
`,
      replace: `      if (latest2.sessionId !== sessionId || !target || !vlistRef.current) return;
      revealedFor(sessionId).add(target.id);
`,
    },
    // usePendingQuestionNavigation.ts: the auto-jump effect targets the newest unrevealed question, the
    // cleanup only cancels, and the hook returns jumpToNewestQuestion and hasQuestionToReveal
    {
      anchor: `  }, [cancelJump, scrollContainerRef, sessionId, vlistRef]);
  reactExports.useEffect(() => {
    if (navigationRef.current.sessionId !== sessionId) {
      navigationRef.current = { sessionId, seen: /* @__PURE__ */ new Set() };
    }
    if (!ready) {
      cancelJump();
      navigationRef.current.seen.clear();
      return;
    }
    const unseen = pendingQuestions.filter((question) => !navigationRef.current.seen.has(question.id));
    if (unseen.length === 0) return;
    unseen.forEach((question) => navigationRef.current.seen.add(question.id));
    jumpToQuestion(unseen[0]);
  }, [pendingQuestions, ready, sessionId, jumpToQuestion, cancelJump]);
  reactExports.useEffect(() => () => {
    cancelJump();
    navigationRef.current.seen.clear();
  }, [cancelJump, sessionId]);
  return { pendingQuestions, jumpToQuestion };
}
`,
      replace: `  }, [cancelJump, revealedFor, scrollContainerRef, sessionId, vlistRef]);
  reactExports.useEffect(() => {
    if (!ready) {
      cancelJump();
      return;
    }
    const revealed = revealedFor(sessionId);
    const target = selectAutoJumpQuestion(pendingQuestions, revealed);
    pendingQuestions.forEach((question) => {
      if (question !== target) revealed.add(question.id);
    });
    if (target) jumpToQuestion(target);
  }, [pendingQuestions, ready, sessionId, jumpToQuestion, cancelJump, revealedFor]);
  reactExports.useEffect(() => cancelJump, [cancelJump, sessionId]);
  const jumpToNewestQuestion = reactExports.useCallback(() => {
    const newest = newestPendingQuestion(latestRef.current.pendingQuestions);
    if (newest) jumpToQuestion(newest);
  }, [jumpToQuestion]);
  const hasQuestionToReveal = reactExports.useCallback(() => {
    const { sessionId: currentSessionId, pendingQuestions: current } = latestRef.current;
    return selectAutoJumpQuestion(current, revealedFor(currentSessionId)) !== void 0;
  }, [revealedFor]);
  return { pendingQuestions, jumpToNewestQuestion, hasQuestionToReveal };
}
`,
    },
    // RichTranscriptView.tsx: take the new hook results
    {
      anchor: `  const { pendingQuestions, jumpToQuestion } = usePendingQuestionNavigation({
`,
      replace: `  const { pendingQuestions, jumpToNewestQuestion, hasQuestionToReveal } = usePendingQuestionNavigation({
`,
    },
    // RichTranscriptView.tsx first scroll: skip the scroll to the bottom only when a question will auto-jump.
    // Only the condition line is anchored: patch 1758 replaces the scroll call below it.
    {
      anchor: `    frame = requestAnimationFrame(() => {
      if (pendingQuestions.length === 0) {
`,
      replace: `    frame = requestAnimationFrame(() => {
      if (!hasQuestionToReveal()) {
`,
    },
    // RichTranscriptView.tsx: the button jumps to the newest open question
    {
      anchor: `        onClick: () => jumpToQuestion(pendingQuestions[0]),
        "aria-label": "Jump to question",
`,
      replace: `        onClick: jumpToNewestQuestion,
        "aria-label": "Jump to question",
`,
    },
  ],
};
