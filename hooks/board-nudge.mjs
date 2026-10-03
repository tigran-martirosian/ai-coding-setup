#!/usr/bin/env node
// board-nudge: UserPromptSubmit hook. The Nimbalyst Sessions board fills up with finished sessions
// and nothing says when to tidy it. A hook can't see the board, so this counts the transcripts
// started in this project since the last cleanup as a stand-in. At BOARD_NUDGE_N (default 15) or
// more it tells the user and has Claude offer /board-cleanup, at most once a day per project.
// Running /board-cleanup (or /planning:session-cleanup) resets the count. Only inside Nimbalyst.
// Silent for other /commands. Fails open. BOARD_NUDGE=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT = Number(process.env.BOARD_NUDGE_N) || 15;
const DAY = 24 * 60 * 60 * 1000;
const STATE_DIR = process.env.BOARD_NUDGE_DIR || path.join(os.homedir(), ".claude", "board-nudge");

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    if (process.env.BOARD_NUDGE === "off") return;
    // No variable names Nimbalyst for a hook; the entry point is "sdk-..." in an app, "cli" in the terminal
    if (!/^sdk/i.test(process.env.CLAUDE_CODE_ENTRYPOINT ?? "")) return;
    const input = JSON.parse(raw);
    if (!input.transcript_path) return;
    const projectDir = path.dirname(input.transcript_path);
    const stateFile = path.join(STATE_DIR, `${path.basename(projectDir).replace(/[^\w-]/g, "")}.json`);
    let state = {};
    try { state = JSON.parse(fs.readFileSync(stateFile, "utf8")); } catch {}
    const save = () => { fs.mkdirSync(STATE_DIR, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify(state)); };

    const prompt = String(input.prompt ?? "").trim();
    const now = Date.now();
    if (/^\/(board-cleanup|planning:session-cleanup)\b/.test(prompt)) { state = { cleanedAt: now }; save(); return; }
    if (prompt.startsWith("/")) return;
    if (state.nudgedAt && now - state.nudgedAt < DAY) return;

    // Sessions started since the last cleanup (or in the last 14 days when none is recorded)
    const since = state.cleanedAt || now - 14 * DAY;
    let count = 0;
    for (const f of fs.readdirSync(projectDir)) {
      if (!f.endsWith(".jsonl")) continue;
      try { if (fs.statSync(path.join(projectDir, f)).birthtimeMs > since) count++; } catch {}
    }
    if (count < LIMIT) return;
    state.nudgedAt = now;
    save();

    const when = state.cleanedAt ? `the last board cleanup on ${new Date(state.cleanedAt).toISOString().slice(0, 10)}` : "14 days ago (no board cleanup on record)";
    const context = [
      `[board-nudge] About ${count} sessions have been started in this project since ${when}, so the Nimbalyst Sessions board is probably cluttered.`,
      `- Do the user's request first. At the end of your reply, offer once, in one line, to tidy the board with /board-cleanup.`,
      `- If the user says yes, open it as its own session (spawn_session with isolated: true and the prompt "/board-cleanup"). Don't run it inside this session and don't start it without a yes.`,
      `- This reminder comes at most once a day per project; don't repeat the offer on later turns.`,
    ].join("\n");
    process.stdout.write(JSON.stringify({
      systemMessage: `Sessions board: about ${count} new sessions since the last cleanup. /board-cleanup tidies it.`,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context },
    }));
  } catch {
    // fail open
  }
});
