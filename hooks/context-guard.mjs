#!/usr/bin/env node
// context-guard: UserPromptSubmit and Stop hook. Every tool call re-sends the whole conversation, so
// in a big session a one-line edit costs as much as the context (measured 2026-09-30: 109 small edits
// at 274-485k context cost 35M tokens for a font, a background and some copy).
//   UserPromptSubmit: when the last context is over the limit (CONTEXT_GUARD_K, default 150 = 150k
//     tokens), it warns the user and tells Claude to batch the work. Silent for /commands.
//   Stop: when a reply ends over the handoff limit (CONTEXT_GUARD_AUTO_K, default 200; it was 250
//     until 2026-10-08, when 31% of a week's tokens sat in requests sent with over 200k), it holds the
//     reply once and has Claude move the work to a fresh session (the handoff skill) without asking,
//     so the user's next message doesn't re-send the big context. Once per session, then again every
//     further 100k. Silent when this turn already handed off. CONTEXT_GUARD_AUTO=off keeps only the warning.
// Fails open. CONTEXT_GUARD=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT_K = Number(process.env.CONTEXT_GUARD_K) || 150;
const AUTO_K = Number(process.env.CONTEXT_GUARD_AUTO_K) || 200;
const AUTO = process.env.CONTEXT_GUARD_AUTO !== "off";

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

    // handedAt: the size at which this session was last moved to a fresh one
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
        decision: "block",
        reason: [
          `[context-guard] This session now holds ~${k}k tokens, and every further message here re-sends all of it. Move the work to a fresh session now, without asking the user:`,
          `- Follow the handoff skill (its "Automatic handoff" part): write the summary, then the brief with it, open the new session.`,
          `- If the task is finished, say so in the summary; the new session then only reads the brief and waits for the user's next request.`,
          `- Do no other work. End with two lines: the new session is open (its name), and the next message goes there, not here.`,
          `- One exception: if your reply just asked the user something this session needs answered, don't hand off; say in one line that the work moves to a fresh session after their answer.`,
        ].join("\n"),
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
        ? `- A fresh session was already opened at ~${handedAt}k and the user kept going here; don't hand off again unless they ask.`
        : `- When this request is done, move the work to a fresh session without asking (the handoff skill, "Automatic handoff").`);
    }
    process.stdout.write(JSON.stringify({
      systemMessage: `Context is ~${k}k tokens: every step re-sends all of it.${AUTO ? ` Past ${AUTO_K}k the work moves to a fresh session when the reply ends.` : " For tweaks or new work, /compact or a new session is much cheaper."}`,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context.join("\n") },
    }));
  } catch {
    // fail open
  }
});
