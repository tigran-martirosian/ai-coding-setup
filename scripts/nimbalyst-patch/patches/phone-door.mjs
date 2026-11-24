// Our own change, not an upstream PR: Nimbalyst's MCP door (/mcp/host, the meta-agent tools such as send_prompt
// and respond_to_prompt) has no tool to answer a PromptForUserInput form, to stop a running turn the way the Stop
// button does, or to remove a queued message. A phone app that drives sessions through the door needs all three,
// and a plan answer that also tells the windows and the tray, and a session pin. This adds five door tools, each
// a thin wrapper around a handler Nimbalyst already has:
// - answer_form: handleRequestUserInputResponse, the form handler of Nimbalyst's own phone app;
// - stop_session: the window's "ai:cancelRequest" handler (the Stop button);
// - remove_queued_prompt: the window's "ai:deleteQueuedPrompt" handler, after checking the row is still pending
//   and belongs to the session;
// - answer_plan: handleExitPlanModeResponse, the plan handler of Nimbalyst's own phone app;
// - set_session_pinned: the window's "sessions:update-metadata" handler, which saves isPinned and tells every
//   window (the window's own "sessions:update-pinned" does not tell the others).
// The three window handlers are closures, so E5, E6 and E7 keep a reference to each in phoneDoorHandlers when it is
// registered; their code does not change. Every tool checks the session belongs to the route's project, the
// same check respond_to_prompt makes. The tools are listed on /mcp/host only, not for extension agents.
// Never retires: upstream has no such tools to wait for.

export default {
  id: "phone-door",
  files: /^out\/main\/index\.js$/,
  upstream: null,
  edits: [
    // E1: the tool list (META_AGENT_TOOL_DEFS): the new tools go before respond_to_prompt
    {
      anchor: `  {
    name: "respond_to_prompt",
    description: "Answer a child session's interactive prompt such as AskUserQuestion, ExitPlanMode, or ToolPermission.",
`,
      replace: `  // phone-door patch: tools for the user's phone app.
  {
    name: "answer_form",
    description: "For the user's phone app only; do not call unless the user asks. Answer or cancel a session's open PromptForUserInput form. promptId is the form's tool call id.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The session that shows the form." },
        promptId: { type: "string", description: "The form's id: the tool_use id of its PromptForUserInput call." },
        answers: { type: "object", description: "Field id to value, the same shape the form in the app sends." },
        cancelled: { type: "boolean", description: "Optional. If true, cancel the form; answers is ignored." }
      },
      required: ["sessionId", "promptId"]
    }
  },
  {
    name: "stop_session",
    description: "For the user's phone app only; do not call unless the user asks. Stop the session's running turn, the same as the Stop button. Queued messages stay queued.",
    inputSchema: {
      type: "object",
      properties: { sessionId: { type: "string", description: "The session to stop." } },
      required: ["sessionId"]
    }
  },
  {
    name: "remove_queued_prompt",
    description: "For the user's phone app only; do not call unless the user asks. Remove one queued message that has not been sent yet. promptId is an id from list_queued_prompts.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The session that holds the queued message." },
        promptId: { type: "string", description: "The queued message's id from list_queued_prompts." }
      },
      required: ["sessionId", "promptId"]
    }
  },
  {
    name: "answer_plan",
    description: "For the user's phone app only; do not call unless the user asks. Approve or reject a session's plan (ExitPlanMode), the way Nimbalyst's own phone app does.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The session with the plan." },
        promptId: { type: "string", description: "The plan prompt's id." },
        approved: { type: "boolean", description: "true approves, false rejects." },
        feedback: { type: "string", description: "Optional. Text sent with the answer." },
        startNewSession: { type: "boolean", description: "Optional. If true, clear the context on approval." }
      },
      required: ["sessionId", "promptId", "approved"]
    }
  },
  {
    name: "set_session_pinned",
    description: "For the user's phone app only; do not call unless the user asks. Pin or unpin a session in Nimbalyst's session list, the same as Pin and Unpin in the app.",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: { type: "string", description: "The session to pin or unpin." },
        pinned: { type: "boolean", description: "true pins, false unpins." }
      },
      required: ["sessionId", "pinned"]
    }
  },
  {
    name: "respond_to_prompt",
    description: "Answer a child session's interactive prompt such as AskUserQuestion, ExitPlanMode, or ToolPermission.",
`,
    },
    // E2: the host route's list (HOST_TOOLS): without it the tools are callable but not listed
    {
      anchor: `  "respond_to_prompt",
  "get_session_status",
`,
      replace: `  "respond_to_prompt",
  "answer_form",
  "stop_session",
  "remove_queued_prompt",
  "answer_plan",
  "set_session_pinned",
  "get_session_status",
`,
    },
    // E3: the tool code, before dispatchMetaAgentTool
    {
      anchor: `async function dispatchMetaAgentTool(name, aiSessionId, workspaceId, args) {
`,
      replace: `// phone-door patch: door tools for the phone app. Each one reuses a handler Nimbalyst already has.
const phoneDoorHandlers = {};
async function phoneDoorSession(workspaceId, sessionId) {
  if (typeof sessionId !== "string" || !sessionId) throw new Error("sessionId is required");
  const session = await AISessionsRepository.get(sessionId);
  if (!session || !sameWorkspaceIdentity(session.workspacePath, workspaceId)) {
    throw new Error(\`Session \${sessionId} not found\`);
  }
  return session;
}
function phoneDoorPromptId(args) {
  if (typeof args.promptId !== "string" || !args.promptId) throw new Error("promptId is required");
  return args.promptId;
}
async function phoneDoorAnswerForm(workspaceId, args) {
  await phoneDoorSession(workspaceId, args.sessionId);
  const promptId = phoneDoorPromptId(args);
  const cancelled = args.cancelled === true;
  if (!cancelled && (typeof args.answers !== "object" || args.answers === null || Array.isArray(args.answers))) {
    throw new Error("answers must be an object of field values");
  }
  if (await isInteractivePromptClosed(args.sessionId, promptId)) throw new Error("This form is already closed.");
  await handleRequestUserInputResponse(args.sessionId, promptId, { answers: cancelled ? {} : args.answers, cancelled });
  for (let i2 = 0; i2 < 25; i2++) {
    if (await isInteractivePromptClosed(args.sessionId, promptId)) {
      return JSON.stringify({ sessionId: args.sessionId, promptId, cancelled, closed: true }, null, 2);
    }
    await new Promise((resolve2) => setTimeout(resolve2, 200));
  }
  throw new Error("The answer was sent, but the form did not close within 5 s. Look at the form on the PC.");
}
async function phoneDoorStop(workspaceId, args) {
  await phoneDoorSession(workspaceId, args.sessionId);
  if (!phoneDoorHandlers.cancel) throw new Error("Nimbalyst's Stop handler is not registered");
  const result2 = await phoneDoorHandlers.cancel(null, args.sessionId, 0);
  if (!result2?.success) throw new Error(result2?.error || "Stop failed");
  notifyAllWindows("ai:sessionCancelled", { sessionId: args.sessionId });
  return JSON.stringify({ sessionId: args.sessionId, stopped: true }, null, 2);
}
async function phoneDoorRemoveQueued(workspaceId, args) {
  await phoneDoorSession(workspaceId, args.sessionId);
  const promptId = phoneDoorPromptId(args);
  if (!phoneDoorHandlers.deleteQueued) throw new Error("Nimbalyst's queue handler is not registered");
  const row = await getQueuedPromptsStore().get(promptId);
  if (!row || row.sessionId !== args.sessionId) {
    throw new Error(\`Queued prompt \${promptId} not found in session \${args.sessionId}\`);
  }
  if (row.status !== "pending") throw new Error(\`Queued prompt \${promptId} is \${row.status}: it was already sent\`);
  await phoneDoorHandlers.deleteQueued(null, promptId);
  notifyAllWindows("ai:queuedPromptsReceived", { sessionId: args.sessionId, promptCount: 0 });
  return JSON.stringify({ sessionId: args.sessionId, promptId, removed: true }, null, 2);
}
async function phoneDoorAnswerPlan(workspaceId, args) {
  await phoneDoorSession(workspaceId, args.sessionId);
  const promptId = phoneDoorPromptId(args);
  if (typeof args.approved !== "boolean") throw new Error("approved must be true or false");
  handleExitPlanModeResponse(args.sessionId, promptId, { approved: args.approved, feedback: args.feedback, startNewSession: args.startNewSession === true });
  if (args.approved) await AISessionsRepository.updateMetadata(args.sessionId, { mode: "agent" });
  return JSON.stringify({ sessionId: args.sessionId, promptId, approved: args.approved }, null, 2);
}
async function phoneDoorSetPinned(workspaceId, args) {
  await phoneDoorSession(workspaceId, args.sessionId);
  if (typeof args.pinned !== "boolean") throw new Error("pinned must be true or false");
  if (!phoneDoorHandlers.updateSession) throw new Error("Nimbalyst's session update handler is not registered");
  const result2 = await phoneDoorHandlers.updateSession(null, args.sessionId, { isPinned: args.pinned });
  if (!result2?.success) throw new Error(result2?.error || "Pin failed");
  return JSON.stringify({ sessionId: args.sessionId, pinned: args.pinned }, null, 2);
}
async function dispatchMetaAgentTool(name, aiSessionId, workspaceId, args) {
`,
    },
    // E4: the dispatch cases
    {
      anchor: `    case "respond_to_prompt":
      return toolFns.respondToPrompt(aiSessionId, effectiveWorkspaceId, args ?? {});
`,
      replace: `    case "answer_form":
      return phoneDoorAnswerForm(effectiveWorkspaceId, args ?? {});
    case "stop_session":
      return phoneDoorStop(effectiveWorkspaceId, args ?? {});
    case "remove_queued_prompt":
      return phoneDoorRemoveQueued(effectiveWorkspaceId, args ?? {});
    case "answer_plan":
      return phoneDoorAnswerPlan(effectiveWorkspaceId, args ?? {});
    case "set_session_pinned":
      return phoneDoorSetPinned(effectiveWorkspaceId, args ?? {});
    case "respond_to_prompt":
      return toolFns.respondToPrompt(aiSessionId, effectiveWorkspaceId, args ?? {});
`,
    },
    // E5: keep the Stop button's handler (a closure over the window handlers' ctx) for stop_session
    {
      anchor: `  safeHandle("ai:cancelRequest", async (_event, sessionId, chunksReceived) => {
`,
      replace: `  safeHandle("ai:cancelRequest", phoneDoorHandlers.cancel = async (_event, sessionId, chunksReceived) => {
`,
    },
    // E6: keep the delete-queued-message handler for remove_queued_prompt
    {
      anchor: `  safeHandle("ai:deleteQueuedPrompt", async (event, promptId) => {
`,
      replace: `  safeHandle("ai:deleteQueuedPrompt", phoneDoorHandlers.deleteQueued = async (event, promptId) => {
`,
    },
    // E7: keep the window's session update handler for set_session_pinned (it also tells every window)
    {
      anchor: `  safeHandle("sessions:update-metadata", async (event, sessionId, updates) => {
`,
      replace: `  safeHandle("sessions:update-metadata", phoneDoorHandlers.updateSession = async (event, sessionId, updates) => {
`,
    },
  ],
};
