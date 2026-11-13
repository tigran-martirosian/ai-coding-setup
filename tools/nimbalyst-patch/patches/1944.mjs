// Nimbalyst PR #1944 (nimbalyst/nimbalyst), fixes #1943: background task results no longer cut off the
// agent's turn. When the last background task settles after the turn, the drain keeps the CLI open and
// emits a wake that takes over the live query and reads the CLI's own turn about the results, instead of
// closing the CLI and waking it cold (the resumed CLI wrote "No response requested."). A follow-up sent
// while tasks drain goes in at once, stamped with a uuid, and its turn starts at the CLI's reply to it.
// If no turn takes the wake within 60 s the drain ends the old way; that cold wake now says the process
// was closed. Ported to the 0.83.0 main bundle from the PR's head 4fc563eb.
// Left out: the question-card part (lateAnswerHook.ts, the PostToolBatch hook in sdkOptionsBuilder.ts,
// dependencyInjection.ts, electron index.ts, registerAskUserQuestionAnswerHandler.ts,
// registerInteractivePromptHandlers.ts, requestUserInputOrphanedAnswer.ts): a separate mechanism.
// `upstream` is the declaration rollup emits for the PR's `export function answersPushedMessage`; this
// port declares the same helper as a const, so a patched bundle never holds the marker.
export default {
  id: "1944",
  files: /^out\/main\/index\.js$/,
  upstream: "function answersPushedMessage(",
  requires: ["1558"],
  edits: [
    // subagentDrain.ts: the closed-process note and the processClosed option
    {
      anchor: `function buildTaskResultContinuationMessage(notifications) {
`,
      replace: `const CLOSED_PROCESS_NOTE = 'Nimbalyst closed the Claude Code process that held these results and is delivering them here. If a task notification or hand-back just above was answered with "No response requested.", Claude Code inserted that reply because the process closed before you could answer: you did not write it, and that input is still unhandled. A notice that one of these tasks "didn\\'t finish before the previous session ended" refers to the closed process; the status listed here is the real outcome.';
function buildTaskResultContinuationMessage(notifications, { processClosed = true } = {}) {
`,
    },
    // subagentDrain.ts: a cold wake carries the note, the live wake does not
    {
      anchor: `  return header + "\\n" + lines.join("\\n") + footer;
`,
      replace: `  return header + "\\n" + lines.join("\\n") + (processClosed ? "\\n" + CLOSED_PROCESS_NOTE : "") + footer;
`,
    },
    // drainHandoff.ts: LIVE_WAKE_TIMEOUT_MS, parkedUntilAborted, canAdoptDrainingQuery, answersPushedMessage
    {
      anchor: `const DRAIN_HANDOFF_TIMEOUT_MS = 1e4;
function canAdoptDrainingQuery(facts) {
  return facts.hasLeadQuery && facts.draining && facts.promptStreamOpen && facts.hasRunningTasks && facts.terminalNotificationCount === 0 && !facts.settledThisTurn`,
      replace: `const DRAIN_HANDOFF_TIMEOUT_MS = 1e4;
const LIVE_WAKE_TIMEOUT_MS = 6e4;
const parkedUntilAborted = (signal) => {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    const abort = () => {
      const error2 = new Error("The draining turn was aborted while waiting for its live wake");
      error2.name = "AbortError";
      reject(error2);
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
  });
};
const answersPushedMessage = (chunk, uuid) => {
  if (!chunk || typeof chunk !== "object") return false;
  const frame = chunk;
  if (frame.type !== "assistant" && frame.type !== "result") return false;
  if (frame.type === "assistant" && frame.parent_tool_use_id) return false;
  if (frame.user_message_uuid === uuid) return true;
  return Array.isArray(frame.user_message_uuids) && frame.user_message_uuids.includes(uuid);
};
function canAdoptDrainingQuery(facts) {
  return facts.hasLeadQuery && facts.draining && facts.promptStreamOpen && (facts.hasRunningTasks || facts.liveWakePending) && !facts.settledThisTurn`,
    },
    // ClaudeCodeProvider.ts: the adoptionPending and liveWake fields
    {
      anchor: `  liveQueryModelVariant = null;
`,
      replace: `  liveQueryModelVariant = null;
  // Set when a draining turn hands its live query to a follow-up, cleared when
  // the follow-up starts streaming it. leadQuery is null in between.
  adoptionPending = false;
  // The last background task settled during a drain and its result went out as a
  // wake that takes this live query (drainHandoff.ts). \`cold\` is the same report
  // for a fresh query, used when the wake cannot take this one. Any turn consumes it.
  liveWake = null;
`,
    },
    // ClaudeCodeProvider.ts sendMessage: the live wake adopts the query too, or falls back to the cold report
    {
      anchor: `    const adopted = this.canAcceptFollowUpDuringDrain() && this.liveQueryModelVariant === this.resolveModelVariant() ? await this.takeOverDrainingQuery() : null;
`,
      replace: `    const pendingWake = this.liveWake;
    const liveWake = pendingWake?.live === message ? pendingWake : null;
    const canAdopt = liveWake ? this.canAdoptLiveQuery(!liveWake.expired) : this.canAcceptFollowUpDuringDrain();
    const adopted = canAdopt && this.liveQueryModelVariant === this.resolveModelVariant() ? await this.takeOverDrainingQuery() : null;
    if (pendingWake) {
      if (pendingWake.timer) clearTimeout(pendingWake.timer);
      if (this.liveWake === pendingWake) this.liveWake = null;
    }
    if (liveWake && !adopted) {
      console.log("[CLAUDE-CODE] SUBAGENT_DRAIN: the live wake could not take the live query; delivering it on a new query");
      state2.message = liveWake.cold;
    }
    const takesCliTurn = liveWake !== null && adopted !== null;
`,
    },
    // ClaudeCodeProvider.ts sendMessage: bind a follow-up to the CLI's reply; the wake turn sends nothing
    {
      anchor: `      const queryCallStart = Date.now();
      const leadQuery = adopted ? await this.deliverToAdoptedQuery(adopted, promptInput, builtPromptController) : claudeAgentSdk.query({
`,
      replace: `      const queryCallStart = Date.now();
      let bindUuid = adopted?.bindToOwnTurn && !takesCliTurn ? crypto$1.randomUUID() : null;
      let foreignChunkCount = 0;
      let foreignResultSeen = false;
      if (bindUuid) console.log(\`[CLAUDE-CODE] DRAIN_HANDOFF: a background task settled during the drain; this turn starts at the CLI's reply to message \${bindUuid}\`);
      if (takesCliTurn) console.log("[CLAUDE-CODE] DRAIN_HANDOFF: the wake turn reads the CLI's own turn about the settled task(s); nothing is sent to the CLI");
      const leadQuery = adopted ? await this.deliverToAdoptedQuery(adopted, promptInput, builtPromptController, bindUuid, !takesCliTurn) : claudeAgentSdk.query({
`,
    },
    // ClaudeCodeProvider.ts sendMessage: the adopting turn now streams the query
    {
      anchor: `      this.leadQuery = leadQuery;
      turnQuery = this.leadQuery;
`,
      replace: `      this.leadQuery = leadQuery;
      turnQuery = this.leadQuery;
      this.adoptionPending = false;
`,
    },
    // ClaudeCodeProvider.ts stream loop: behind its live wake the draining turn parks instead of reading
    {
      anchor: `          const watchdogActive = awaitingSuggestion || shouldArmStreamStallWatchdog({
            resultReceivedTime: state2.resultReceivedTime,
            outstandingToolCalls: state2.outstandingToolCalls,
            hasRunningTasks: this.hasRunningTasks(),
            hasPendingUserInteraction: this.hasPendingUserInteraction()
          });
          const nextPromise = carriedNext ?? iterator.next();
`,
      replace: `          const parked = this.liveWake !== null && carriedNext === null;
          const watchdogActive = !parked && (awaitingSuggestion || (bindUuid !== null ? foreignResultSeen : shouldArmStreamStallWatchdog({
            resultReceivedTime: state2.resultReceivedTime,
            outstandingToolCalls: state2.outstandingToolCalls,
            hasRunningTasks: this.hasRunningTasks(),
            hasPendingUserInteraction: this.hasPendingUserInteraction()
          })));
          const nextPromise = parked ? parkedUntilAborted(turnController?.signal) : carriedNext ?? iterator.next();
`,
    },
    // ClaudeCodeProvider.ts stream loop: hand off without a pending read; an expired live wake ends the drain
    {
      anchor: `            if (this.handOffIfRequested(state2.completeEmitted, iterator, nextPromise)) break;
`,
      replace: `            if (this.handOffIfRequested(state2.completeEmitted, iterator, parked ? null : nextPromise)) break;
            if (this.liveWake?.expired) {
              void nextPromise.catch(() => {
              });
              this.drainExitCause = "resolved";
              break;
            }
`,
    },
    // ClaudeCodeProvider.ts stream loop: frames before the CLI's reply belong to its own turn
    {
      anchor: `          if (typeof chunk === "object" && chunk !== null) {
            const armsGraceTimer = shouldArmGraceTimerForResult(
`,
      replace: `          if (bindUuid !== null) {
            if (answersPushedMessage(chunk, bindUuid)) {
              console.log(\`[CLAUDE-CODE] DRAIN_HANDOFF: the CLI answered this turn's message (\${chunk.type} frame) after \${foreignChunkCount} frame(s) of its own turn\`);
              bindUuid = null;
            } else {
              foreignChunkCount++;
              if (chunk?.type === "result") foreignResultSeen = true;
              else if (chunk?.type === "assistant") foreignResultSeen = false;
            }
          }
          const beforeOwnReply = bindUuid !== null;
          if (typeof chunk === "object" && chunk !== null && !beforeOwnReply && !this.liveWake) {
            const armsGraceTimer = shouldArmGraceTimerForResult(
`,
    },
    // ClaudeCodeProvider.ts stream loop: nothing of the CLI's own turn is yielded as this turn's reply
    {
      anchor: `            if (state2.completeEmitted && (this.drainingBackgroundTasks || this.awaitingPromptSuggestion) && item.kind !== "system_task") {
`,
      replace: `            if ((beforeOwnReply || state2.completeEmitted && (this.drainingBackgroundTasks || this.awaitingPromptSuggestion)) && item.kind !== "system_task") {
`,
    },
    // ClaudeCodeProvider.ts stream loop: the CLI's own result neither counts as a flush nor ends this turn
    {
      anchor: `          if (typeof chunk === "object" && chunk !== null && !state2.completeEmitted && isNotificationFlushResult(chunk,`,
      replace: `          if (typeof chunk === "object" && chunk !== null && !state2.completeEmitted && !beforeOwnReply && isNotificationFlushResult(chunk,`,
    },
    {
      anchor: `          if (typeof chunk === "object" && chunk !== null && chunk.type === "result" && !state2.completeEmitted) {
`,
      replace: `          if (typeof chunk === "object" && chunk !== null && chunk.type === "result" && !state2.completeEmitted && !beforeOwnReply) {
`,
    },
    // ClaudeCodeProvider.ts stream loop: keep the CLI open for the wake carrying the results
    {
      anchor: `          if (shouldExitDrain(state2.completeEmitted, this.drainingBackgroundTasks, this.hasRunningTasks())) {
`,
      replace: `          if (!this.liveWake && shouldExitDrain(state2.completeEmitted, this.drainingBackgroundTasks, this.hasRunningTasks())) {
            if (this.startLiveWake(sessionId)) continue;
`,
    },
    // ClaudeCodeProvider.ts endTurn
    {
      anchor: `    const queryForDrainCleanup = this.leadQuery;
    this.leadQuery = null;
`,
      replace: `    const queryForDrainCleanup = this.leadQuery;
    this.leadQuery = null;
    this.adoptionPending = false;
`,
    },
    // ClaudeCodeProvider.ts isLeadBusy: covers the gap between release and adoption
    {
      anchor: `    return this.leadQuery !== null || this.teammateIdleMessagePending;
`,
      replace: `    return this.leadQuery !== null || this.teammateIdleMessagePending || this.adoptionPending;
`,
    },
    // ClaudeCodeProvider.ts: canAcceptFollowUpDuringDrain yields to the live wake; canAdoptLiveQuery; startLiveWake
    {
      anchor: `  canAcceptFollowUpDuringDrain() {
    return canAdoptAwaitingSuggestionQuery({
      awaiting: this.awaitingPromptSuggestion,
      hasLeadQuery: this.leadQuery !== null,
      promptStreamOpen: !!this.promptController && !this.promptController.isEnded(),
      wasInterrupted: this.wasInterrupted,
      hasPendingUserInteraction: this.hasPendingUserInteraction(),
      hasTeammateWork: this.teammateIdleMessagePending || this.teammateManager.hasPendingTeammateMessages() || this.teammateManager.hasActiveTeammates(),
      hasPendingContinuation: this.streamClosedContinuationMessagePending !== null,
      handoffInProgress: this.drainHandoff !== null
    }) || canAdoptDrainingQuery({
      hasLeadQuery: this.leadQuery !== null,
      draining: this.drainingBackgroundTasks,
      promptStreamOpen: !!this.promptController && !this.promptController.isEnded(),
      hasRunningTasks: this.hasRunningTasks(),
      terminalNotificationCount: this.drainTerminalNotifications.length,
      settledThisTurn: this.settledBackgroundTasksThisTurn,
      graceExpired: this.drainGraceExpired,
      wasInterrupted: this.wasInterrupted,
      hasPendingUserInteraction: this.hasPendingUserInteraction(),
      hasTeammateWork: this.teammateIdleMessagePending || this.teammateManager.hasPendingTeammateMessages() || this.teammateManager.hasActiveTeammates(),
      // \`streamClosedContinuationPrepared\` only records that the check ran.
      hasPendingContinuation: this.streamClosedContinuationMessagePending !== null,
      handoffInProgress: this.drainHandoff !== null
    });
  }
`,
      replace: `  canAcceptFollowUpDuringDrain() {
    if (this.liveWake) return false;
    return this.canAdoptLiveQuery(false);
  }
  canAdoptLiveQuery(liveWakePending) {
    const hasTeammateWork = this.teammateIdleMessagePending || this.teammateManager.hasPendingTeammateMessages() || this.teammateManager.hasActiveTeammates();
    return canAdoptAwaitingSuggestionQuery({
      awaiting: this.awaitingPromptSuggestion,
      hasLeadQuery: this.leadQuery !== null,
      promptStreamOpen: !!this.promptController && !this.promptController.isEnded(),
      wasInterrupted: this.wasInterrupted,
      hasPendingUserInteraction: this.hasPendingUserInteraction(),
      hasTeammateWork,
      hasPendingContinuation: this.streamClosedContinuationMessagePending !== null,
      handoffInProgress: this.drainHandoff !== null
    }) || canAdoptDrainingQuery({
      hasLeadQuery: this.leadQuery !== null,
      draining: this.drainingBackgroundTasks,
      promptStreamOpen: !!this.promptController && !this.promptController.isEnded(),
      hasRunningTasks: this.hasRunningTasks(),
      liveWakePending,
      settledThisTurn: this.settledBackgroundTasksThisTurn,
      graceExpired: this.drainGraceExpired,
      wasInterrupted: this.wasInterrupted,
      // The CLI's own turn about the settled task may be asking the user something;
      // the live wake takes that turn over, question included.
      hasPendingUserInteraction: !liveWakePending && this.hasPendingUserInteraction(),
      hasTeammateWork,
      // \`streamClosedContinuationPrepared\` only records that the check ran.
      hasPendingContinuation: this.streamClosedContinuationMessagePending !== null,
      handoffInProgress: this.drainHandoff !== null
    });
  }
  /**
   * The last background task settled while the turn drained. Instead of closing the CLI mid-way
   * through its own turn about it, emit a wake whose turn takes over this live query and reads
   * that turn. False leaves the old path: end the drain, close the CLI, wake on a fresh query.
   */
  startLiveWake(sessionId) {
    if (!sessionId || !shouldContinueWithTaskResults("resolved", this.drainTerminalNotifications) || !this.promptController || this.promptController.isEnded() || this.wasInterrupted || this.drainGraceExpired || this.drainHandoff || this.teammateIdleMessagePending || this.teammateManager.hasPendingTeammateMessages() || this.teammateManager.hasActiveTeammates() || this.streamClosedContinuationMessagePending !== null) return false;
    if (this.promptEndTimer) {
      clearTimeout(this.promptEndTimer);
      this.promptEndTimer = null;
    }
    const liveWake = {
      live: buildTaskResultContinuationMessage(this.drainTerminalNotifications, { processClosed: false }),
      cold: buildTaskResultContinuationMessage(this.drainTerminalNotifications),
      timer: null,
      expired: false
    };
    liveWake.timer = setTimeout(() => {
      liveWake.timer = null;
      liveWake.expired = true;
      console.warn(\`[CLAUDE-CODE] SUBAGENT_DRAIN: no turn took the live wake within \${LIVE_WAKE_TIMEOUT_MS}ms; ending the drain\`);
      const resolve2 = this.interruptResolve;
      this.interruptResolve = null;
      resolve2?.();
    }, LIVE_WAKE_TIMEOUT_MS);
    this.liveWake = liveWake;
    console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: waking session \${sessionId} with \${this.drainTerminalNotifications.length} background task result(s) on the live query\`);
    this.emit("teammate:messageWhileIdle", { sessionId, message: liveWake.live });
    return true;
  }
`,
    },
    // ClaudeCodeProvider.ts releaseToFollowUpTurn: bindToOwnTurn, adoptionPending
    {
      anchor: `      toolHooksService: this.toolHooksService
    };
    this.leadQuery = null;
    ClaudeCodeProvider.streamingInstances.delete(this);
`,
      replace: `      toolHooksService: this.toolHooksService,
      bindToOwnTurn: this.drainTerminalNotifications.length > 0
    };
    this.leadQuery = null;
    this.adoptionPending = true;
    ClaudeCodeProvider.streamingInstances.delete(this);
`,
    },
    // ClaudeCodeProvider.ts deliverToAdoptedQuery: stamp the follow-up; the live wake pushes nothing
    {
      anchor: `  async deliverToAdoptedQuery(adopted, promptInput, builtPromptController) {
    const { value: followUp } = await promptInput[Symbol.asyncIterator]().next();
    builtPromptController.end("adopted-live-query");
    if (!followUp || !adopted.promptController.push(followUp)) {
      throw new Error("Claude Code closed its input before the follow-up could be delivered. Send it again.");
    }
`,
      replace: `  async deliverToAdoptedQuery(adopted, promptInput, builtPromptController, uuid, send) {
    if (send) {
      const { value: followUp } = await promptInput[Symbol.asyncIterator]().next();
      builtPromptController.end("adopted-live-query");
      if (followUp && uuid) followUp.uuid = uuid;
      if (!followUp || !adopted.promptController.push(followUp)) {
        throw new Error("Claude Code closed its input before the follow-up could be delivered. Send it again.");
      }
    } else {
      builtPromptController.end("adopted-live-query");
    }
`,
    },
    // ClaudeCodeProvider.ts finalizeBackgroundDrain: the live wake already went out; send no second one
    {
      anchor: `    if (outcome2.autoContinue && sessionId) {
`,
      replace: `    if (this.liveWake) {
      if (this.liveWake.timer) {
        clearTimeout(this.liveWake.timer);
        this.liveWake.timer = null;
      }
      this.teammateIdleMessagePending = true;
      return;
    }
    if (outcome2.autoContinue && sessionId) {
`,
    },
  ],
};
