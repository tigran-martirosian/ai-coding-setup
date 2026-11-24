// Nimbalyst PR #1558 (nimbalyst/nimbalyst), fixes #1557: a background task that finishes while the lead
// waits on a question card no longer wakes the lead (which closed the card with "Connection closed").
// The wake is held per session and released once the pending-prompt bit goes from true to false.
// Ported to the 0.83.0 main bundle: the PR's two new modules (idleWakeSignals, idleWakeGating) are added
// beside the code that uses them, the rest follows the PR's edits line for line.
// `upstream` is the declaration rollup emits for the PR's `export function decideIdleWake`; this port
// declares the same helper as a const, so a patched bundle never holds the marker.
export default {
  id: "1558",
  files: /^out\/main\/index\.js$/,
  upstream: "function decideIdleWake(",
  edits: [
    // pendingPromptPersistence.ts: hasSessionPendingPrompt + onPendingPromptCleared; idleWakeSignals.ts
    {
      anchor: `function resetPendingPromptTracking() {
  sessionsWithPendingPrompt.clear();
}
`,
      replace: `function resetPendingPromptTracking() {
  sessionsWithPendingPrompt.clear();
}
function hasSessionPendingPrompt(sessionId) {
  return sessionsWithPendingPrompt.has(sessionId);
}
const clearedListeners = /* @__PURE__ */ new Set();
function onPendingPromptCleared(listener) {
  clearedListeners.add(listener);
  return () => clearedListeners.delete(listener);
}
function isSessionBlockedOnUser(sessionId) {
  return hasSessionPendingPrompt(sessionId);
}
function onSessionUnblocked(listener) {
  return onPendingPromptCleared(listener);
}
`,
    },
    // pendingPromptPersistence.ts: fire on the logical true -> false transition, even if persisting failed
    {
      anchor: `  if (hasPendingPrompt && !wasAlreadyPending) {
    void notifyMobileOfBlockedSession(sessionId);
  }
}
`,
      replace: `  if (hasPendingPrompt && !wasAlreadyPending) {
    void notifyMobileOfBlockedSession(sessionId);
  }
  if (!hasPendingPrompt && wasAlreadyPending) {
    for (const listener of clearedListeners) {
      try {
        listener(sessionId);
      } catch (err) {
        logger$p.main.warn(
          \`[pendingPromptPersistence] pending-prompt-cleared listener threw for session \${sessionId}:\`,
          err
        );
      }
    }
  }
}
`,
    },
    // idleWakeGating.ts, then teammateIdleWake.ts: defer instead of waking a lead blocked on the user
    {
      anchor: `function createTeammateIdleWakeListener(deps) {
  return async (data) => {
    if (!data.sessionId) {
      deps.logWarn("[AIService] teammate:messageWhileIdle with no sessionId");
      return;
    }
    if (!deps.isSessionActive(data.sessionId)) {
      deps.logInfo(\`[AIService] Ignoring teammate message for ended session \${data.sessionId}\`);
      return;
    }
`,
      replace: `const decideIdleWake = (params) => {
  if (!params.sessionActive) return { action: "drop", reason: "session-ended" };
  if (params.hasPendingPrompt) return { action: "defer", reason: "pending-prompt" };
  return { action: "deliver" };
};
const deferredIdleWakes = /* @__PURE__ */ new Map();
function deferIdleWakeMessage(sessionId, message) {
  const queue = deferredIdleWakes.get(sessionId);
  if (queue) queue.push(message);
  else deferredIdleWakes.set(sessionId, [message]);
}
function takeDeferredIdleWakeMessages(sessionId) {
  const queue = deferredIdleWakes.get(sessionId);
  if (!queue) return [];
  deferredIdleWakes.delete(sessionId);
  return queue;
}
function createTeammateIdleWakeListener(deps) {
  return async (data) => {
    if (!data.sessionId) {
      deps.logWarn("[AIService] teammate:messageWhileIdle with no sessionId");
      return;
    }
    const decision = decideIdleWake({
      sessionActive: deps.isSessionActive(data.sessionId),
      hasPendingPrompt: deps.isBlockedOnUser(data.sessionId)
    });
    if (decision.action === "drop") {
      deps.logInfo(\`[AIService] Ignoring teammate message for ended session \${data.sessionId}\`);
      return;
    }
    if (decision.action === "defer") {
      deps.holdForUser(data.sessionId, data.message);
      deps.logInfo(\`[AIService] Holding teammate message for session \${data.sessionId}: lead is waiting on an interactive prompt\`);
      return;
    }
`,
    },
    // MessageStreamingHandler.ts: the two new listener deps
    {
      anchor: `        endSession: (id2) => sessionStateManagerForWake.endSession(id2),
`,
      replace: `        endSession: (id2) => sessionStateManagerForWake.endSession(id2),
        isBlockedOnUser: (id2) => isSessionBlockedOnUser(id2),
        holdForUser: (id2, message2) => deferIdleWakeMessage(id2, message2),
`,
    },
    // MessageStreamingHandler.ts: release the held messages once the prompt clears (one subscription per handler)
    {
      anchor: `      this.installListener(provider2, "teammate:messageWhileIdle", onTeammateMessageWhileIdle);
`,
      replace: `      this.installListener(provider2, "teammate:messageWhileIdle", onTeammateMessageWhileIdle);
      this.unsubscribePromptCleared?.();
      this.unsubscribePromptCleared = onSessionUnblocked((sessionId2) => {
        const held = takeDeferredIdleWakeMessages(sessionId2);
        if (held.length === 0) return;
        logger$p.main.info(\`[AIService] Releasing \${held.length} held teammate message(s) for session \${sessionId2}\`);
        void onTeammateMessageWhileIdle({ sessionId: sessionId2, message: held.join("\\n\\n") });
      });
`,
    },
    // MessageStreamingHandler.ts: destroy() also drops that subscription
    {
      anchor: `  destroy() {
    this.unsubscribeBatchListener();
  }
`,
      replace: `  destroy() {
    this.unsubscribeBatchListener();
    this.unsubscribePromptCleared?.();
    this.unsubscribePromptCleared = void 0;
  }
`,
    },
  ],
};
