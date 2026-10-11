#!/usr/bin/env node
// context-guard: UserPromptSubmit and Stop hook. Every tool call re-sends the whole conversation, so
// in a big session a one-line edit costs as much as the context (measured 2026-09-30: 109 small edits
// at 274-485k context cost 35M tokens for a font, a background and some copy).
// It only WARNS. The one rule that stops a session lives in turn-cap (after 15 steps at over 100k tokens
// the session is cut and restarts from a note in ~/.claude/handoffs/); until 2026-10-11 this hook also
// held the reply at 200k and ordered an automatic handoff, which turn-cap then refused (its Bash step).
//   UserPromptSubmit: when the last context is over the limit (CONTEXT_GUARD_K, default 150 = 150k
//     tokens), it warns the user and tells Claude to batch the work. Silent for /commands.
//   Stop: when a reply ends over the warning limit (CONTEXT_GUARD_AUTO_K, default 200), it shows the
//     user one line with turn-cap's rule. Once per session, then again every further 100k. Silent when
//     this turn already handed off. CONTEXT_GUARD_AUTO=off silences that line.
// Fails open. CONTEXT_GUARD=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT_K = Number(process.env.CONTEXT_GUARD_K) || 150;
const AUTO_K = Number(process.env.CONTEXT_GUARD_AUTO_K) || 200;
const AUTO = process.env.CONTEXT_GUARD_AUTO !== "off";
// turn-cap's rule, in plain words (the numbers are turn-cap's SESSION_STEPS and SESSION_K)
const RULE = "after 15 more steps at over 100k the session is cut; write the restart note into ~/.claude/handoffs/ and spawn a CHILD JOB session.";

// The last lines of the transcript (up to 4 MB)
function tail(file) {
  const size = fs.statSync(file).size;
  const len = Math.min(size, 4 * 1024 * 1024);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  return buf.toString("utf8").split("\n");
}
// Context size of the last main-conversation API call
function lastContext(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"usage"')) continue;
    let j;
    try { j = JSON.parse(lines[i]); } catch { continue; }
    const u = j.message?.usage;
    if (j.type !== "assistant" || j.isSidechain || !u || j.message.model === "<synthetic>") continue;
    return (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  }
  return 0;
}
// Whether Claude already wrote a handoff brief or opened a new session since the user's last message
function handedOffThisTurn(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (line.includes('"type":"user"') && !line.includes('"tool_result"')) return false;
    if (line.includes('"type":"assistant"') && /handoff-brief\.mjs|spawn_session/.test(line)) return true;
  }
  return false;
}

let raw = "";
process.stdin.on("data", (d) => (raw += d));
process.stdin.on("end", () => {
  try {
    if (process.env.CONTEXT_GUARD === "off") return;
    const input = JSON.parse(raw);
    const stop = input.hook_event_name === "Stop";
    if (stop && (!AUTO || input.stop_hook_active)) return;
    if (!stop && String(input.prompt ?? "").trim().startsWith("/")) return;
    if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return;
    const lines = tail(input.transcript_path);
    const k = Math.round(lastContext(lines) / 1000);
    if (k < (stop ? AUTO_K : LIMIT_K)) return;

    // handedAt: the size at which the user was last warned (or the work was moved to a fresh session)
    const stateDir = path.join(os.tmpdir(), "context-guard");
    const stateFile = path.join(stateDir, `${String(input.session_id || "none").replace(/[^\w-]/g, "")}.json`);
    let handedAt = 0;
    try { handedAt = JSON.parse(fs.readFileSync(stateFile, "utf8")).handedAt || 0; } catch {}
    const done = handedAt && k < handedAt + 100;
    const mark = () => { try { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ handedAt: k })); } catch {} };

    if (stop) {
      if (done) return;
      mark();
      if (handedOffThisTurn(lines)) return;
      process.stdout.write(JSON.stringify({
        systemMessage: `[context-guard] This session holds ~${k}k tokens, and every further message re-sends all of it. turn-cap's rule: ${RULE}`,
      }));
      return;
    }

    const context = [
      `[context-guard] This session already holds ~${k}k tokens, and every tool call re-sends all of it (~${k}k per call, even for a one-line edit). For this request:`,
      `- Plan every change first, then apply them in as few calls as possible: all changes to one file in one Edit (or one Write of the whole file), not one Edit per line.`,
      `- Don't re-read files, images or previews that are already in this conversation; render or check once at the end, not after each change.`,
      `- Put all your questions in one prompt. Skip optional skills, reviews and extra checks unless the user asked for them.`,
    ];
    if (AUTO && k >= AUTO_K) {
      context.push(done
        ? `- The user was already warned at ~${handedAt}k and kept going here; don't raise it again unless they ask.`
        : `- This session is past ${AUTO_K}k. turn-cap's rule: ${RULE} Don't open a new session on your own for this; just keep the steps few.`);
    }
    process.stdout.write(JSON.stringify({
      systemMessage: `Context is ~${k}k tokens: every step re-sends all of it.${AUTO ? ` Past ${AUTO_K}k, turn-cap cuts a long run of steps and the work restarts in a fresh session.` : " For tweaks or new work, /compact or a new session is much cheaper."}`,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context.join("\n") },
    }));
  } catch {
    // fail open
  }
});
