#!/usr/bin/env node
// context-guard: UserPromptSubmit, PreCompact, Stop and PostToolUse hook. Every tool call re-sends the
// whole conversation, so in a big session a one-line edit costs as much as the context.
// It only WARNS and never stops a session.
// Claude Code itself compacts at COMPACT_K (autoCompactWindow in settings.json): mid-turn, or before the
// next message of an idle session, so a finished session is left alone. This hook does not compact.
//   UserPromptSubmit: over the limit (CONTEXT_GUARD_K, default 150 = 150k tokens) and under COMPACT_K, it
//     tells Claude to batch the work; with a cold cache (last reply over CONTEXT_GUARD_COLD_MIN, default
//     60 minutes), to move to a fresh session too. The user sees nothing of it: the session compacts and
//     hands off by itself. At COMPACT_K or more it only tells the user the session compacts first.
//     Silent for /commands.
//   PreCompact: gives an automatic compact the focus line (a /compact by hand has its own).
//   Stop: when a reply ends at RUN_K or more, where the automatic compact has not run
//     (CONTEXT_GUARD_AUTO_K moves that line), it shows the
//     user one line about the size. Once per session, then again every further 100k. Silent when
//     this turn already handed off. CONTEXT_GUARD_AUTO=off silences that line.
//   PostToolUse: the safety net for an automatic compact that did not run. Over CONTEXT_GUARD_RUN_K
//     (default 300) it tells Claude to finish the step in hand, save its state, queue a /compact and end
//     the turn, starting nothing new. Once, then again every further 100k.
// The size is the last API call's, unless a compact came after it: then the compact's own figure, so
// the first message after a compact is not warned about the size the compact just removed.
// Fails open. CONTEXT_GUARD=off disables it.
import { crashLog } from "./lib/crash-log.mjs";
import { runHook } from "./lib/hook-io.mjs";
import { sessionKey } from "./lib/paths.mjs";
import { stateFile, readJson, writeJson } from "./lib/state.mjs";
import {
  tail,
  entries,
  lastUsage,
  typedByUser,
  CONTEXT_K,
} from "./lib/transcript.mjs";
import fs from "node:fs";

const LIMIT_K = Number(process.env.CONTEXT_GUARD_K) || 150;
const AUTO = process.env.CONTEXT_GUARD_AUTO !== "off";
const RUN_K = Number(process.env.CONTEXT_GUARD_RUN_K) || CONTEXT_K.run;
// Where Claude Code compacts by itself (see CONTEXT_K)
const COMPACT_K =
  Number(process.env.CONTEXT_GUARD_COMPACT_K) || CONTEXT_K.compact;
// The end-of-reply size line: only where the automatic compact has not run
const AUTO_K = Number(process.env.CONTEXT_GUARD_AUTO_K) || RUN_K;
// Between the limit and COMPACT_K, a cold session (idle over COLD_MIN) moves to a fresh session: a cold compact costs far more than a warm one
const COLD_MIN = Number(process.env.CONTEXT_GUARD_COLD_MIN) || 60;
const FOCUS =
  "Keep every message the user typed, quoted; open asks and decisions; the next step. Mark Claude's own estimates as unconfirmed.";

// Minutes since the last main-conversation assistant entry, or null when there is none
function idleMinutes(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    if (list[i].type === "assistant" && list[i].timestamp)
      return Math.round((Date.now() - Date.parse(list[i].timestamp)) / 60000);
  }
  return null;
}

// Context size of the last main-conversation API call, or what a later compact left
const lastContext = (list) => lastUsage(list, { compact: true })?.tokens ?? 0;
// Whether Claude already wrote a handoff brief or opened a new session since the user's last typed message
function handedOffThisTurn(list) {
  for (let i = list.length - 1; i >= 0; i--) {
    const e = list[i];
    if (typedByUser(e)) return false;
    if (
      e.type === "assistant" &&
      /handoff-brief\.mjs|spawn_session/.test(
        JSON.stringify(e.message?.content ?? ""),
      )
    )
      return true;
  }
  return false;
}

runHook("context-guard", (input) => {
  {
    if (input.hook_event_name === "PreCompact") {
      if (input.trigger === "auto") process.stdout.write(FOCUS);
      return;
    }
    if (input.hook_event_name === "PostToolUse") {
      // A subagent's hook gets the main transcript: the size is not its own, and the order is not for it
      if (input.agent_id) return;
      // Runs on every tool call: 1 MB holds the last usage line, except just after a huge tool result
      if (!input.transcript_path || !fs.existsSync(input.transcript_path))
        return;
      const k = Math.round(
        lastContext(entries(tail(input.transcript_path, 1024 * 1024))) / 1000,
      );
      const file = stateFile(
        "context-guard",
        `run-${sessionKey(input.session_id)}`,
      );
      if (!k) return; // no usage line in the tail says nothing about the size
      // Back under the limit (after a /compact): forget the last warning, so the next climb warns again
      if (k < RUN_K) {
        try {
          fs.rmSync(file, { force: true });
        } catch {}
        return;
      }
      const warnedAt = readJson(file, { missing: {} }).warnedAt || 0;
      if (warnedAt && k < warnedAt + 100) return;
      writeJson(file, { warnedAt: k });
      process.stdout.write(
        JSON.stringify({
          systemMessage: `This session holds ~${k}k tokens and its automatic compact has not run: every step re-sends all of it. Claude is told to finish the step in hand and stop.`,
          hookSpecificOutput: {
            hookEventName: "PostToolUse",
            additionalContext: `[context-guard] This session holds ~${k}k tokens, its automatic compact has not run, and every tool call re-sends all of it. Finish the step in hand, save what a next session needs in a file, report and end your turn. Start nothing new here. Before you end the turn, queue a /compact onto this session: \`node ~/.claude/skills/steer/compact-self.mjs\` with this focus line on stdin: "${FOCUS}" (in a plain terminal, put \`/compact <that focus line>\` in "Needs you" instead), and say so at the end of the reply. Only a person's message telling you to carry on overrides this.`,
          },
        }),
      );
      return;
    }
    const stop = input.hook_event_name === "Stop";
    if (stop && (!AUTO || input.stop_hook_active)) return;
    if (
      !stop &&
      String(input.prompt ?? "")
        .trim()
        .startsWith("/")
    )
      return;
    if (!input.transcript_path || !fs.existsSync(input.transcript_path)) return;
    const lines = entries(tail(input.transcript_path));
    const k = Math.round(lastContext(lines) / 1000);
    if (!k) return; // no usage line in the tail says nothing about the size
    // handedAt: the size at which the user was last warned (or the work was moved to a fresh session)
    const file = stateFile("context-guard", sessionKey(input.session_id));
    // Back under the limit (after a /compact): forget the last warning, so the next cycle warns again
    if (!stop && k < LIMIT_K) {
      try {
        fs.rmSync(file, { force: true });
      } catch {}
      return;
    }
    if (k < (stop ? AUTO_K : LIMIT_K)) return;
    const handedAt = readJson(file, { missing: {} }).handedAt || 0;
    // A size under the last warning means a compact came between: this is a new climb
    const done = handedAt && k >= handedAt && k < handedAt + 100;
    const mark = () => {
      try {
        writeJson(file, { handedAt: k });
      } catch (err) {
        crashLog("context-guard", err);
      }
    };

    if (stop) {
      if (done) return;
      mark();
      if (handedOffThisTurn(lines)) return;
      process.stdout.write(
        JSON.stringify({
          systemMessage: `[context-guard] This session holds ~${k}k tokens${k >= RUN_K ? " and its automatic compact has not run" : ". It compacts itself before the next message, about a minute"}.`,
        }),
      );
      return;
    }

    // Claude Code compacts before it answers, so advice about this size would be out of date by then.
    // At RUN_K or more it has already failed to, so the advice below is what is left.
    if (k >= COMPACT_K && k < RUN_K) {
      process.stdout.write(
        JSON.stringify({
          systemMessage: `This session holds ~${k}k tokens: it compacts itself first, about a minute, then answers.`,
        }),
      );
      return;
    }

    const context = [
      `[context-guard] This session already holds ~${k}k tokens, and every tool call re-sends all of it (~${k}k per call, even for a one-line edit). For this request:`,
      `- Plan every change first, then apply them in as few calls as possible: small changes to one file in one Edit, not one Edit per line; a new or rewritten file in parts of at most ~300 lines per call (one huge call hits the output limit and is lost).`,
      `- Don't re-read files, images or previews that are already in this conversation; render or check once at the end, not after each change.`,
      `- Put all your questions in one prompt. Skip optional skills; the reviewer and the build or test a gate asks for still run.`,
    ];
    const idle = idleMinutes(lines);
    const cold = idle !== null && idle > COLD_MIN;
    if (cold)
      context.push(
        `- The cache went cold (last reply ~${idle} min ago). Unless only quick questions remain, tell the user in one line and move the work to a fresh session now with the handoff skill.`,
      );
    // For Claude only: the user has nothing to do about the size
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: context.join("\n"),
        },
      }),
    );
  }
});
