// Nimbalyst PR #1836 (nimbalyst/nimbalyst), fixes #366: text typed in the chat while exactly one
// AskUserQuestion card waits is sent as that card's answer, instead of being queued behind a question
// that never resolves. When the answer is refused or cannot apply, the text is queued as before.
// Ported to 0.83.0: SessionTranscript lives in a hashed renderer chunk (out/renderer/assets/index-*.js);
// the PR's new pendingQuestionRouting module is added just above the component. The shared
// sendOutcomes list of blocked reasons is bundled twice (renderer chunk and main), so both copies get
// the new reason; the line before each list tells the two copies apart.
// `upstream` is the declaration rollup emits for the PR's `export async function tryAnswerPendingQuestion`;
// this port declares the same helper as a const, so a patched bundle never holds the marker.
const REASONS_HEAD = `const SEND_SURFACES = ["transcript", "launch_popup"];
const SEND_BLOCKED_REASONS = [
  // Renderer, before anything is dispatched
  "empty_draft",
  "no_session_data",
  "queued_cli_not_ready",
  "cli_submit_failed",
  "submission_record_failed",
  "queued_while_loading",
`;
const reasons = (before) => ({
  anchor: before + REASONS_HEAD,
  replace:
    before +
    REASONS_HEAD +
    `  "answered_pending_question",
`,
});

export default {
  id: "1836",
  files: /^out\/(main\/index|renderer\/assets\/index-[\w-]+)\.js$/,
  upstream: "function tryAnswerPendingQuestion(",
  edits: [
    // shared/analytics/sendOutcomes.ts, renderer copy and main copy
    reasons(
      "const sessionViewRetention = createSessionViewRetention(store);\n",
    ),
    reasons(
      "const workspaceFileEditAttributionService = new WorkspaceFileEditAttributionServiceImpl();\n",
    ),
    // pendingQuestionRouting.ts (new)
    {
      anchor: `const LocalSessionTranscript = reactExports.forwardRef(({
`,
      replace: `const pickPendingQuestionAnswer = (pendingPrompts, text) => {
  const answer = text.trim();
  if (!answer) return null;
  if (pendingPrompts.length !== 1) return null;
  const prompt = pendingPrompts[0];
  if (prompt.promptType !== "ask_user_question_request") return null;
  const questions = prompt.data?.questions;
  if (!Array.isArray(questions) || questions.length !== 1) return null;
  const questionText = questions[0]?.question;
  if (typeof questionText !== "string" || !questionText) return null;
  return { questionId: prompt.promptId, answers: { [questionText]: answer } };
};
const tryAnswerPendingQuestion = async (pendingPrompts, text, hasAttachments, submit) => {
  if (hasAttachments) return false;
  const answer = pickPendingQuestionAnswer(pendingPrompts, text);
  if (!answer) return false;
  try {
    return await submit(answer.questionId, answer.answers);
  } catch (error) {
    console.error("[pendingQuestionRouting] Failed to answer pending question:", error);
    return false;
  }
};
const LocalSessionTranscript = reactExports.forwardRef(({
`,
    },
    // SessionTranscript.tsx: one answer send shared by the question widget and the chat box
    {
      anchor: `  const handleQueue = reactExports.useCallback(async (message2) => {
`,
      replace: `  const submitQuestionAnswer = reactExports.useCallback(async (questionId, answers) => {
    const result = await window.electronAPI.invoke("claude-code:answer-question", { questionId, answers, sessionId });
    if (result?.success === false) {
      console.error("[SessionTranscript] Question answer refused:", result.error);
      return false;
    }
    posthog?.capture("ask_user_question_answered", {
      numQuestions: Object.keys(answers).length
    });
    return true;
  }, [sessionId, posthog]);
  const handleQueue = reactExports.useCallback(async (message2) => {
`,
    },
    // SessionTranscript.tsx handleSend: answer the waiting question before queueing
    {
      anchor: `    if (isLoading) {
      handleQueue(currentDraftInput.trim());
`,
      replace: `    if (isLoading) {
      const answered = await tryAnswerPendingQuestion(
        store.get(sessionPendingPromptsAtom(sessionId)),
        currentDraftInput,
        (store.get(sessionDraftAttachmentsAtom(sessionId)) ?? []).length > 0,
        submitQuestionAnswer
      );
      if (answered) {
        setLastSubmitAt(Date.now());
        setDraftInput("");
        setDraftAttachments([]);
        clearAIInputHistory(sessionId);
        blocked("answered_pending_question");
        return;
      }
      handleQueue(currentDraftInput.trim());
`,
    },
    // SessionTranscript.tsx handleSend deps
    {
      anchor: "updateSessionStore, handleQueue, setIsProcessing,",
      replace:
        "updateSessionStore, handleQueue, submitQuestionAnswer, setIsProcessing,",
    },
    // SessionTranscript.tsx widget host: the widget's own buttons use the shared send
    {
      anchor: `    askUserQuestionSubmit: async (questionId, answers) => {
      await window.electronAPI.invoke("claude-code:answer-question", { questionId, answers, sessionId });
      posthog?.capture("ask_user_question_answered", {
        numQuestions: Object.keys(answers).length
      });
    },
`,
      replace: `    askUserQuestionSubmit: async (questionId, answers) => {
      await submitQuestionAnswer(questionId, answers);
    },
`,
    },
  ],
};
