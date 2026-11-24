// Our own change, not an upstream PR: Nimbalyst stops repeating background task results Claude already has.
// 1. The cause: BACKGROUND_LAUNCH_ACK ran on the whole text of a tracked tool result, so a foreground result
//    that quoted "Async agent launched" or "running in the background" further down marked its task as a
//    background one, and its end came back as a "[System: background task(s) you launched have settled" prompt.
//    Claude Code's launch acknowledgement is always the first line, so the test now reads only that line.
// 2. The repeat: when the drain closes the Claude Code process and wakes the session with the results
//    (finalizeBackgroundDrain), a result is left out when Claude Code's transcript on disk proves Claude read
//    its task notice and then ended a turn with a real reply, with no compaction in between. The lead's
//    transcript counts, and a helper's (HELPER_READ_COUNTS: the lead got the helper's report). Every doubt
//    keeps the result: no transcript, a read error, a read limit, a killed task, a notice answered only by
//    Claude Code's stand-in "No response requested.", or a turn cut off after the notice. When every result is
//    proven, no prompt is sent and the drain settles as one with nothing to report.
// The record of a task end gains startedAt, so a notice is matched to its own run of a task id. 1944's cold
// fallback (liveWake.cold) still sends every result. Ported to the 0.83.0 main bundle; every anchor occurs once
// with 1944 applied and once without it. Never retires on its own: when 1944 retires, drop it from `requires`.
export default {
  id: "settled-repeat",
  files: /^out\/main\/index\.js$/,
  upstream: null,
  requires: ["1944"],
  edits: [
    // the cause fix: the launch acknowledgement is the first line of the result
    {
      anchor: `  return BACKGROUND_LAUNCH_ACK.test(extractToolResultText(resultContent));
`,
      replace: `  // Claude Code's launch acknowledgement is the first line of its result. A foreground result that
  // quotes these words further down (a scan, a hand-back, a file) is not one (settled-repeat).
  return BACKGROUND_LAUNCH_ACK.test(extractToolResultText(resultContent).trimStart().split("\\n", 1)[0]);
`,
    },
    // applySystemTaskChunk: the record of a task end carries the start of its run
    {
      anchor: `        elapsedMs: Date.now() - existing.startedAt
      };
`,
      replace: `        elapsedMs: Date.now() - existing.startedAt,
        // When this run began: its notice in the transcript comes after it (settled-repeat)
        startedAt: existing.startedAt
      };
`,
    },
    // the proof: which results a transcript shows Claude already read and answered
    {
      anchor: `function hasRunningTasks(tasks) {
`,
      replace: `// settled-repeat: the user's choices (design section 1) and the read limits (design section 2).
const HELPER_READ_COUNTS = true;
const TRIM_PROVEN_RESULTS = true;
const TRANSCRIPT_TAIL_BYTES = 16 * 1024 * 1024;
const TRANSCRIPT_TOTAL_BYTES = 64 * 1024 * 1024;
const STAND_IN_REPLY = /^(No response requested\\.?)?$/i;
function readTranscriptTail(file, size) {
  const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
  const buffer = Buffer.alloc(length);
  const fd = fs$3.openSync(file, "r");
  try {
    fs$3.readSync(fd, buffer, 0, length, size - length);
  } finally {
    fs$3.closeSync(fd);
  }
  const text = buffer.toString("utf8");
  return length < size ? text.slice(text.indexOf("\\n") + 1) : text;
}
// settled-repeat: whether Claude Code handed this run's notice to Claude and Claude then finished a turn with a
// real reply, with no compaction in between. The notice's stamp is the task's end (it dates the run); its place
// in the file is the read.
function noticeAnsweredInTranscript(text, taskId, from, until) {
  const tag = \`<task-id>\${taskId}</task-id>\`;
  const first = text.indexOf(tag);
  if (first < 0) return false;
  let delivered = false;
  for (const line of text.slice(text.lastIndexOf("\\n", first) + 1).split("\\n")) {
    if (!line.includes(tag) && !line.includes('"end_turn"') && !line.includes('"compact_boundary"')) continue;
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry.type === "system" && entry.subtype === "compact_boundary") {
      delivered = false;
    } else if (!delivered) {
      const stamp = Date.parse(entry.timestamp);
      const notice = entry.type === "attachment" && entry.attachment?.type === "queued_command" ? extractToolResultText(entry.attachment.prompt) : entry.type === "user" ? extractToolResultText(entry.message?.content) : "";
      delivered = notice.includes("<task-notification>") && notice.includes(tag) && stamp >= from && stamp < until;
    } else if (entry.type === "assistant" && entry.message?.stop_reason === "end_turn") {
      // Each block of a reply is its own entry, all marked end_turn: a thinking-only one is not the reply
      const blocks = entry.message.content;
      if (Array.isArray(blocks) && blocks.length > 0 && !blocks.some((b) => b?.type === "text")) continue;
      if (!STAND_IN_REPLY.test(extractToolResultText(blocks).trim())) return true;
      delivered = false;
    }
  }
  return false;
}
// settled-repeat: the results of a closed-process wake that Claude has not had yet. A result goes only when a
// transcript proves Claude read its notice and answered after it. Any doubt or error sends every result.
function dropResultsClaudeAlreadyRead(claudeSessionId, notifications, tasks) {
  try {
    const candidates = notifications.filter((n2) => (n2.status === "completed" || n2.status === "failed") && typeof n2.startedAt === "number");
    if (candidates.length === 0) return notifications;
    if (!claudeSessionId) {
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: no Claude session id; sending every result\`);
      return notifications;
    }
    const root = path$2.join(resolveClaudeConfigDir(), "projects");
    const lead = fs$3.readdirSync(root).map((dir) => path$2.join(root, dir, \`\${claudeSessionId}.jsonl\`)).find((file) => fs$3.existsSync(file));
    if (!lead) {
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: no transcript \${claudeSessionId}.jsonl found; sending every result\`);
      return notifications;
    }
    const files = [lead];
    const helpers = path$2.join(lead.slice(0, -".jsonl".length), "subagents");
    if (HELPER_READ_COUNTS && fs$3.existsSync(helpers)) {
      for (const name of fs$3.readdirSync(helpers)) if (/^agent-.+\\.jsonl$/.test(name)) files.push(path$2.join(helpers, name));
    }
    const earliest = Math.min(...candidates.map((n2) => n2.startedAt));
    const nextRunStart = (n2) => Math.min(Infinity, ...[...notifications, tasks.get(n2.taskId)].filter((o) => o && o.taskId === n2.taskId && o.startedAt > n2.startedAt).map((o) => o.startedAt));
    const proven = new Set();
    let budget = TRANSCRIPT_TOTAL_BYTES;
    for (const file of files) {
      if (proven.size === candidates.length) break;
      const { size, mtimeMs } = fs$3.statSync(file);
      if (mtimeMs < earliest) continue;
      const length = Math.min(size, TRANSCRIPT_TAIL_BYTES);
      if (length > budget) {
        console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: transcript read limit (64 MB) reached before \${file}; results not yet proven are sent\`);
        break;
      }
      budget -= length;
      const text = readTranscriptTail(file, size);
      for (const n2 of candidates) if (!proven.has(n2) && noticeAnsweredInTranscript(text, n2.taskId, n2.startedAt, nextRunStart(n2))) proven.add(n2);
    }
    if (proven.size === 0 || (!TRIM_PROVEN_RESULTS && proven.size < notifications.length)) return notifications;
    console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: \${proven.size} of \${notifications.length} background task result(s) already reached Claude in its transcript; not sent again: [\${[...proven].map((n2) => n2.taskId).join(", ")}]\`);
    return notifications.filter((n2) => !proven.has(n2));
  } catch (error2) {
    console.warn("[CLAUDE-CODE] SUBAGENT_DRAIN: could not check which results Claude already has; sending every result:", error2);
    return notifications;
  }
}
function hasRunningTasks(tasks) {
`,
    },
    // finalizeBackgroundDrain: the closed-process wake names only the results Claude has not had
    {
      anchor: `    if (sessionId && shouldContinueWithTaskResults(this.drainExitCause, this.drainTerminalNotifications)) {
      const message = buildTaskResultContinuationMessage(this.drainTerminalNotifications);
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: waking session \${sessionId} with \${this.drainTerminalNotifications.length} background task result(s)\`);
`,
      replace: `    const unread = sessionId && shouldContinueWithTaskResults(this.drainExitCause, this.drainTerminalNotifications) ? dropResultsClaudeAlreadyRead(this.sessions.getSessionId(sessionId), this.drainTerminalNotifications, this.activeTasks) : [];
    if (sessionId && shouldContinueWithTaskResults(this.drainExitCause, unread)) {
      const message = buildTaskResultContinuationMessage(unread);
      console.log(\`[CLAUDE-CODE] SUBAGENT_DRAIN: waking session \${sessionId} with \${unread.length} background task result(s)\`);
`,
    },
  ],
};
