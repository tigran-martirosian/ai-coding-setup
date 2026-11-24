// Our own change, not an upstream PR: a scheduled wakeup that fires while its session is mid-turn arrives as a
// note in that turn, not as a queued prompt that waits for the turn to end. A session sets a wakeup with
// Nimbalyst's schedule_wakeup tool; SessionWakeupScheduler.fire() calls the executor that main's boot code
// configures, and that executor always put the prompt in the session's queue ("1 QUEUED" above the chat box),
// so a session still working got it only after its turn. Now the executor first asks isSessionMidTurn (the
// bundle's own check: status running or waiting_for_input). When the session is mid-turn it sends the prompt
// the way the Note button of our Commands extension does: `node ~/.claude/skills/steer/steer.mjs send --to
// <session id> - --nowait`, the text on stdin. Exit 0 means the note is in steer's inbox and the session's steer
// hook hands it over at its next tool call ("[btw] ..."); the wakeup then counts as fired. Steer exits 3 when
// it finds the session not busy, and any other end (no steer script, no node, a timeout, another exit code) is
// logged with steer's output: in all those cases the wakeup goes to the queue as before. An idle session is
// not touched: it still gets a new turn. The note starts with a line that says it is the session's own wakeup,
// since steer's hook labels every note as one the user sent. Never retires: no upstream fix to wait for.
export const NOTE_HEAD =
  "[wakeup] The wakeup you scheduled with schedule_wakeup fired while you were working. Its prompt:";

export default {
  id: "wakeup-note",
  files: /^out\/main\/index\.js$/,
  upstream: null,
  edits: [
    // the note path, beside the scheduler that fires the wakeups
    {
      anchor: `function notifyWakeupFired(row) {
`,
      replace: `// wakeup-note patch: send a wakeup's prompt as a note through the steer script, as the Note button does.
// Resolves true when steer took the note, false when the wakeup must go to the queue. Never rejects.
const WAKEUP_NOTE_MS = 30000;
const WAKEUP_NOTE_HEAD = ${JSON.stringify(NOTE_HEAD)};
function sendWakeupAsNote(sessionId, workspacePath, prompt) {
  const fs2 = require("fs"), path2 = require("path");
  const steer = path2.join(require("os").homedir(), ".claude", "skills", "steer", "steer.mjs");
  if (!fs2.existsSync(steer)) {
    logger$5.warn("Wakeup goes to the queue: no steer script to send it as a note", { sessionId, steer });
    return Promise.resolve(false);
  }
  return new Promise((resolve) => {
    let out = "";
    const child = require("child_process").spawn("node", [steer, "send", "--to", sessionId, "-", "--nowait"], {
      cwd: workspacePath && fs2.existsSync(workspacePath) ? workspacePath : void 0,
      windowsHide: true,
      timeout: WAKEUP_NOTE_MS
    });
    child.stdout.on("data", (d) => out += d);
    child.stderr.on("data", (d) => out += d);
    child.on("error", (error2) => {
      logger$5.warn("Wakeup goes to the queue: the steer script did not start", { sessionId, error: error2.message });
      resolve(false);
    });
    child.on("close", (code, signal) => {
      if (code === 0) {
        logger$5.info("Wakeup sent as a note to a session mid-turn", { sessionId, noteId: /^Note id: (\\S+)/m.exec(out)?.[1] });
        resolve(true);
        return;
      }
      logger$5.info("Wakeup goes to the queue: steer did not take the note", { sessionId, code, signal, out: out.trim().slice(0, 300) });
      resolve(false);
    });
    child.stdin.on("error", () => {
    });
    child.stdin.end(\`\${WAKEUP_NOTE_HEAD}
\${prompt}\`);
  });
}
function notifyWakeupFired(row) {
`,
    },
    // the executor: a session mid-turn gets the note; otherwise (or when steer did not take it) the queue
    {
      anchor: `        if (!aiSvcRef) {
          return { triggered: false };
        }
        await aiSvcRef.queuePromptForSession(sessionId, prompt, void 0, {
`,
      replace: `        if (!aiSvcRef) {
          return { triggered: false };
        }
        // wakeup-note patch: a session mid-turn reads the prompt as a note at its next tool call
        if (isSessionMidTurn(sessionId) && await sendWakeupAsNote(sessionId, workspacePath, prompt)) {
          return { triggered: true };
        }
        await aiSvcRef.queuePromptForSession(sessionId, prompt, void 0, {
`,
    },
  ],
};
