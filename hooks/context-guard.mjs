#!/usr/bin/env node
// context-guard: UserPromptSubmit and Stop hook. Every tool call re-sends the whole conversation, so
// in a big session a one-line edit costs as much as the context (measured 2026-09-30: 109 small edits
// at 274-485k context cost 35M tokens for a font, a background and some copy).
// It only WARNS and never stops a session; until 2026-10-11 this hook also held the reply at 200k and
// ordered an automatic handoff.
//   UserPromptSubmit: when the last context is over the limit (CONTEXT_GUARD_K, default 150 = 150k
//     tokens), it warns the user and tells Claude to batch the work, then: with a warm cache, to queue
//     a /compact with a focus line onto its own session once the request is done (compact-self.mjs);
//     with a cold one (last reply over CONTEXT_GUARD_COLD_MIN, default 60 minutes), to move to a fresh
//     session instead. Silent for /commands.
//   Stop: when a reply ends over the warning limit (CONTEXT_GUARD_AUTO_K, default 200), it shows the
//     user one line about the size. Once per session, then again every further 100k. Silent when
//     this turn already handed off. CONTEXT_GUARD_AUTO=off silences that line.
// Fails open. CONTEXT_GUARD=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT_K = Number(process.env.CONTEXT_GUARD_K) || 150;
const AUTO_K = Number(process.env.CONTEXT_GUARD_AUTO_K) || 200;
const AUTO = process.env.CONTEXT_GUARD_AUTO !== "off";
// What the warnings tell Claude to do, in plain words
const RULE = "keep the steps few and batch the changes.";
// Past the limit: a warm session compacts, a cold one (idle over COLD_MIN) moves to a fresh session
// (user, 2026-10-29; audits/compact-vs-handoff-2026-10-29: warm compact ~44k, cold ~590k)
const COLD_MIN = Number(process.env.CONTEXT_GUARD_COLD_MIN) || 60;
const FOCUS = "Keep every message the user typed, quoted; open asks and decisions; child session ids; the next step. Mark Claude's own estimates as unconfirmed.";

// Minutes since the last main-conversation assistant entry, or null when there is none
function idleMinutes(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].includes('"type":"assistant"')) continue;
    let j;
    try { j = JSON.parse(lines[i]); } catch { continue; }
    if (j.isSidechain || !j.timestamp) continue;
    return Math.round((Date.now() - Date.parse(j.timestamp)) / 60000);
  }
  return null;
}

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
    // handedAt: the size at which the user was last warned (or the work was moved to a fresh session)
    const stateDir = path.join(os.tmpdir(), "context-guard");
    const stateFile = path.join(stateDir, `${String(input.session_id || "none").replace(/[^\w-]/g, "")}.json`);
    // Back under the limit (after a /compact): forget the last warning, so the next cycle warns again
    if (!stop && k < LIMIT_K) { try { fs.rmSync(stateFile, { force: true }); } catch {} return; }
    if (k < (stop ? AUTO_K : LIMIT_K)) return;
    let handedAt = 0;
    try { handedAt = JSON.parse(fs.readFileSync(stateFile, "utf8")).handedAt || 0; } catch {}
    const done = handedAt && k < handedAt + 100;
    const mark = () => { try { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ handedAt: k })); } catch {} };

    if (stop) {
      if (done) return;
      mark();
      if (handedOffThisTurn(lines)) return;
      process.stdout.write(JSON.stringify({
        systemMessage: `[context-guard] This session holds ~${k}k tokens, and every further message re-sends all of it. Tip: ${RULE}`,
      }));
      return;
    }

    const context = [
      `[context-guard] This session already holds ~${k}k tokens, and every tool call re-sends all of it (~${k}k per call, even for a one-line edit). For this request:`,
      `- Plan every change first, then apply them in as few calls as possible: all changes to one file in one Edit (or one Write of the whole file), not one Edit per line.`,
      `- Don't re-read files, images or previews that are already in this conversation; render or check once at the end, not after each change.`,
      `- Put all your questions in one prompt. Skip optional skills, reviews and extra checks unless the user asked for them.`,
    ];
    const idle = idleMinutes(lines);
    const cold = idle !== null && idle > COLD_MIN;
    // The Stop warning ("done") only stops the size line repeating; the compact or move step stays,
    // because that is what brings the session back under the limit (compact-self skips a duplicate)
    if (cold) {
      context.push(`- The cache went cold (last reply ~${idle} min ago), so a /compact would re-send all ~${k}k at full price. Unless only quick questions remain, move the work to a fresh session now with the handoff skill.`);
    } else {
      context.push(`- Once this request is done, unless only quick questions remain, queue a /compact onto this session while the cache is warm: \`node ~/.claude/skills/steer/compact-self.mjs\` with this focus line on stdin: "${FOCUS}" (in a plain terminal, put \`/compact <that focus line>\` in "Needs you" instead).`);
    }
    process.stdout.write(JSON.stringify({
      systemMessage: `Context is ~${k}k tokens: every step re-sends all of it. ${cold ? "The cache is cold: Claude moves the work to a fresh session." : "Claude compacts this session when this request is done, unless only quick questions are left."}`,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context.join("\n") },
    }));
  } catch {
    // fail open
  }
});
