#!/usr/bin/env node
// context-guard: UserPromptSubmit, PreCompact, Stop and PostToolUse hook. Every tool call re-sends the
// whole conversation, so in a big session a one-line edit costs as much as the context (measured
// 2026-09-30: 109 small edits at 274-485k context cost 35M tokens for a font, a background and some copy).
// It only WARNS and never stops a session; until 2026-10-11 this hook also held the reply at 200k and
// ordered an automatic handoff.
// Claude Code itself compacts at COMPACT_K (autoCompactWindow in settings.json): mid-turn, or before the
// next message of an idle session, so a finished session is left alone (2026-10-31: 23 of 49 compacts
// queued at the end of a request went on sessions that never ran again, one was cancelled in the chat
// and its session ran on to 357k, one raced a message and bought nothing). This hook does not compact.
//   UserPromptSubmit: over the limit (CONTEXT_GUARD_K, default 150 = 150k tokens) and under COMPACT_K, it
//     warns the user and tells Claude to batch the work; with a cold cache (last reply over
//     CONTEXT_GUARD_COLD_MIN, default 60 minutes), to move to a fresh session too. At COMPACT_K or more it
//     only says the session compacts first. Silent for /commands.
//   PreCompact: gives an automatic compact the focus line (a /compact by hand has its own).
//   Stop: when a reply ends at COMPACT_K or more (CONTEXT_GUARD_AUTO_K moves that line), it shows the
//     user one line about the size. Once per session, then again every further 100k. Silent when
//     this turn already handed off. CONTEXT_GUARD_AUTO=off silences that line.
//   PostToolUse: the safety net for an automatic compact that did not run. Over CONTEXT_GUARD_RUN_K
//     (default 300) it tells Claude to finish the step in hand, save its state, queue a /compact and end
//     the turn, starting nothing new. Once, then again every further 100k.
// The size is the last API call's, unless a compact came after it: then the compact's own figure, so
// the first message after a compact is not warned about the size the compact just removed.
// Fails open. CONTEXT_GUARD=off disables it.
import { crashLog } from "./crash-log.mjs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const LIMIT_K = Number(process.env.CONTEXT_GUARD_K) || 150;
const AUTO = process.env.CONTEXT_GUARD_AUTO !== "off";
const RUN_K = Number(process.env.CONTEXT_GUARD_RUN_K) || 300;
// Where Claude Code compacts by itself: autoCompactWindow 230000 less the 33k it keeps free is 197k,
// and the size here leaves out the last reply and the next message
const COMPACT_K = Number(process.env.CONTEXT_GUARD_COMPACT_K) || 190;
const AUTO_K = Number(process.env.CONTEXT_GUARD_AUTO_K) || COMPACT_K;
// Between the limit and COMPACT_K, a cold session (idle over COLD_MIN) moves to a fresh session
// (user, 2026-10-29; audits/compact-vs-handoff-2026-10-29: warm compact ~44k, cold ~590k)
const COLD_MIN = Number(process.env.CONTEXT_GUARD_COLD_MIN) || 60;
const FOCUS = "Keep every message the user typed, quoted; open asks and decisions; the next step. Mark Claude's own estimates as unconfirmed.";

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
function tail(file, max = 4 * 1024 * 1024) {
  const size = fs.statSync(file).size;
  const len = Math.min(size, max);
  const buf = Buffer.alloc(len);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, buf, 0, len, size - len);
  fs.closeSync(fd);
  return buf.toString("utf8").split("\n");
}
// Context size of the last main-conversation API call, or what a later compact left
function lastContext(lines) {
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].includes('"compact_boundary"')) {
      let b;
      try { b = JSON.parse(lines[i]); } catch { continue; }
      if (b.type === "system" && b.subtype === "compact_boundary" && !b.isSidechain) return b.compactMetadata?.postTokens ?? 0;
    }
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
    if (input.hook_event_name === "PreCompact") {
      if (input.trigger === "auto") process.stdout.write(FOCUS);
      return;
    }
    if (input.hook_event_name === "PostToolUse") {
      // A subagent's hook gets the main transcript: the size is not its own, and the order is not for it
      if (input.agent_id) return;
      // Runs on every tool call: 1 MB holds the last usage line, except just after a huge tool result
      if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return;
      const k = Math.round(lastContext(tail(input.transcript_path, 1024 * 1024)) / 1000);
      const dir = path.join(os.tmpdir(), "context-guard");
      const file = path.join(dir, `run-${String(input.session_id || "none").replace(/[^\w-]/g, "")}.json`);
      if (!k) return; // no usage line in the tail says nothing about the size
      // Back under the limit (after a /compact): forget the last warning, so the next climb warns again
      if (k < RUN_K) { try { fs.rmSync(file, { force: true }); } catch {} return; }
      let warnedAt = 0;
      try { warnedAt = JSON.parse(fs.readFileSync(file, "utf8")).warnedAt || 0; } catch {}
      if (warnedAt && k < warnedAt + 100) return;
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify({ warnedAt: k }));
      process.stdout.write(JSON.stringify({
        systemMessage: `This session holds ~${k}k tokens and its automatic compact has not run: every step re-sends all of it. Claude is told to finish the step in hand and stop.`,
        hookSpecificOutput: { hookEventName: "PostToolUse", additionalContext: `[context-guard] This session holds ~${k}k tokens, its automatic compact has not run, and every tool call re-sends all of it. Finish the step in hand, save what a next session needs in a file, report and end your turn. Start nothing new here. Before you end the turn, queue a /compact onto this session: \`node ~/.claude/skills/steer/compact-self.mjs\` with this focus line on stdin: "${FOCUS}" (in a plain terminal, put \`/compact <that focus line>\` in "Needs you" instead), and say so at the end of the reply. Only a person's message telling you to carry on overrides this.` },
      }));
      return;
    }
    const stop = input.hook_event_name === "Stop";
    if (stop && (!AUTO || input.stop_hook_active)) return;
    if (!stop && String(input.prompt ?? "").trim().startsWith("/")) return;
    if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return;
    const lines = tail(input.transcript_path);
    const k = Math.round(lastContext(lines) / 1000);
    if (!k) return; // no usage line in the tail says nothing about the size
    // handedAt: the size at which the user was last warned (or the work was moved to a fresh session)
    const stateDir = path.join(os.tmpdir(), "context-guard");
    const stateFile = path.join(stateDir, `${String(input.session_id || "none").replace(/[^\w-]/g, "")}.json`);
    // Back under the limit (after a /compact): forget the last warning, so the next cycle warns again
    if (!stop && k < LIMIT_K) { try { fs.rmSync(stateFile, { force: true }); } catch {} return; }
    if (k < (stop ? AUTO_K : LIMIT_K)) return;
    let handedAt = 0;
    try { handedAt = JSON.parse(fs.readFileSync(stateFile, "utf8")).handedAt || 0; } catch {}
    // A size under the last warning means a compact came between: this is a new climb
    const done = handedAt && k >= handedAt && k < handedAt + 100;
    const mark = () => { try { fs.mkdirSync(stateDir, { recursive: true }); fs.writeFileSync(stateFile, JSON.stringify({ handedAt: k })); } catch {} };

    if (stop) {
      if (done) return;
      mark();
      if (handedOffThisTurn(lines)) return;
      process.stdout.write(JSON.stringify({
        systemMessage: `[context-guard] This session holds ~${k}k tokens${k >= RUN_K ? " and its automatic compact has not run" : ". It compacts itself before the next message, about a minute"}.`,
      }));
      return;
    }

    // Claude Code compacts before it answers, so advice about this size would be out of date by then.
    // At RUN_K or more it has already failed to, so the advice below is what is left.
    if (k >= COMPACT_K && k < RUN_K) {
      process.stdout.write(JSON.stringify({ systemMessage: `This session holds ~${k}k tokens: it compacts itself first, about a minute, then answers.` }));
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
    if (cold) context.push(`- The cache went cold (last reply ~${idle} min ago). Unless only quick questions remain, move the work to a fresh session now with the handoff skill.`);
    process.stdout.write(JSON.stringify({
      systemMessage: `Context is ~${k}k tokens: every step re-sends all of it. ${cold ? "The cache is cold: Claude moves the work to a fresh session." : k >= RUN_K ? "Its automatic compact has not run." : "It compacts itself at about 200k."}`,
      hookSpecificOutput: { hookEventName: "UserPromptSubmit", additionalContext: context.join("\n") },
    }));
  } catch (err) {
    crashLog("context-guard", err);
    // fail open
  }
});
