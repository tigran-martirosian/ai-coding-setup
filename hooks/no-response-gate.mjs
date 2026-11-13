#!/usr/bin/env node
// no-response-gate: backs "every question the user typed gets its answer" (a skipped question was a reply of only
// "No response requested." or a /btw question only forwarded).
// Stop, two checks, each blocks once (stop_hook_active):
// 1. The turn began with a message the user typed and has no visible text, or only "No response
//    requested.": answer it. A turn that ends in a form (AskUserQuestion, PromptForUserInput) passes,
//    and so does a short acknowledgement with no question ("ok thanks").
// 2. The message is /btw with a question, and the reply only forwarded it (nothing left after the
//    "Sent to ..." / "Left for ..." note, or the only actions were forwarding calls and the rest is a
//    short "passed it on"): answer the question in the reply, forwarding is extra.
// UserPromptSubmit, one check: the real "No response requested." replies are written by Claude Code
// itself (model "<synthetic>") when a turn is cut off by a refused tool call or a new message, and no
// Stop hook runs for those turns. When the previous turn was cut off that way before any answer (a
// one-line "Let me check." is no answer), after a message the user typed, and the new prompt is not
// that message sent again, it adds a note to answer the earlier message too.
// System events (background-task notices, "[System: ...]", "[Child Session Update]") are not typed
// messages, so "No response requested." stays allowed there. Subagents (agent_id) are skipped.
// Fails open. NO_RESPONSE_GATE=off disables it.
import { runHook, isMain, emit } from "./lib/hook-io.mjs";
import { entries as readEntries, tail, userText, assistantText, typedByUser, currentTurn, INTERRUPTED, QUESTION_TOOLS, SYNTHETIC } from "./lib/transcript.mjs";
import { ruHyphen as ru } from "./lib/ru.mjs";
import fs from "node:fs";

// Only the transcript's end is read (a long session's file reaches 100s of MB); a turn longer than this
// has no start in it and passes
const TAIL_BYTES = 8 * 1024 * 1024;

// Russian twins of the English word lists below (for `--language russian`). \b does not see Cyrillic
// letters, so these use the u flag and « » for "no letter on this side"; a hyphen after the word
// ("что-то", "кто-то") means it is not a question word (ruHyphen). The English patterns are untouched.
const RU_ASK_WORD = String.raw`(?:что|чего|чему|чем|почему|зачем|как(?!\s+только)|где|куда|откуда|какой|какая|какое|какие|какую|каком|каким|каких|какого|который|которая|которое|которые|кто|кого|кому|кем|сколько|чей|чья|чьё|чьи|разве|неужели)`;
const RU_QUESTION_WORD = ru(String.raw`^[^\p{L}\d]*(?:${RU_ASK_WORD}|есть\s+ли|можно\s+ли|нужно\s+ли|стоит\s+ли|\p{L}+\s+ли)»`);
const RU_ASKS_WHAT = ru(String.raw`«(?:${RU_ASK_WORD}|ли)»`);
const RU_REQUEST = ru(String.raw`«(?:можешь|можете|сможешь|сможете|(?:не\s+)?мог(?:ла|ли)?\s+бы|будь\s+добр|будьте\s+добры)»|^[^\p{L}\d]*пожалуйста»`);
const RU_FILLER = ru(String.raw`«(?:понимаешь|понимаете|знаешь|знаете|ясно)(?:\s+о\s+чём\s+я|\s+о\s+чем\s+я)?\s*\?\s*$`);
const RU_ACK = /^((ок|окей|хорошо|ладно|спасибо|благодарю|спс|супер|круто|отлично|понял|поняла|понятно|ясно|принято|идеально|ага|угу|да|класс|здорово|прекрасно|договорились|годится|👍)[\s.,!]*)+$/iu;
const RU_FORWARDED = ru(String.raw`«(?:отправ\p{L}*|переда\p{L}*|пересл\p{L}*|направ\p{L}*|сказал\p{L}*|оставил\p{L}*|поставил\p{L}*)»`);
const RU_PASSED_TO = ru(String.raw`«(?:сесси\p{L}*|заметк\p{L}*|сообщени\p{L}*|его|её|ее|им|вопрос\p{L}*|чат\p{L}*)»`);

const REASON_EMPTY =
  "no-response-gate: the user typed a message this turn and your reply has no text (or only \"No response requested.\"). " +
  "Answer their message now: lead with the answer to each question they typed, then report any work.";
const REASON_BTW =
  "no-response-gate: the user's /btw note asks a question and your reply only forwarded it. Answer the question in your reply now, under the forwarding line, in a few lines. " +
  "A question about the busy session's work (its progress, what it did): run node ~/.claude/skills/steer/steer.mjs btw \"<question>\" and answer from its output. Any other question: from what you know or a quick check.";

const NO_RESPONSE = /^No response requested\.?$/i;
// A sentence that starts like a question. "can you / will / do it" start requests more often, so those
// count only with "?" ("do you" is a question); "when" mostly starts an instruction ("When it's done, ...")
const QUESTION_WORD = /^\W*(what|what's|whats|why|how|is|isn't|are|aren't|does|did|didn't|do (you|we|u|i|they)|should|where|which|who|wtf)\b/i;
// steer's note: Sent to "<tab name>". It reads the note before its next step.
const FORWARD_NOTE = /\b(Sent to|Left for)\s+("[^"\n]*"|\S+)\.?|It reads the note before its next step\.?/gi;
const FORWARD_SEEN = new RegExp(FORWARD_NOTE.source, "i");
// A message that needs no reply, where "No response requested." is fine
const ACK = /^((ok(ay)?|k|thanks|thank you|thx|ty|cool|nice|great|got it|good|perfect|sure|yep|👍)[\s.,!]*)+$/iu;

// The /btw note's text, or null when the message is not /btw
export const btwNote = (text) => {
  const t = text.trim();
  const cmd = /<command-name>\/?btw<\/command-name>/.test(t) ? (/<command-args>([\s\S]*?)(<\/command-args>|$)/.exec(t)?.[1] ?? "") : null;
  if (cmd !== null) return cmd;
  const m = /^\/btw(\s[\s\S]*|$)/.exec(t);
  return m ? m[1] : null;
};
// A sentence that starts like a question, or ends in "?" and is not a request ("can you make it blue?",
// unless it asks what/why/how: "could you tell me what's left?") or filler ("you know what I mean?")
const REQUEST = /\b(can|could|would|will)\s+(you|u)\b|^\W*please\b/i;
const ASKS_WHAT = /\b(what|what's|why|how|where|which|who|whether|if)\b/i;
const FILLER = /\b(you know what i mean|you know|know what i'?m saying)\?\s*$/i;
export const asksQuestion = (note) =>
  note.split(/(?<=[.!?\n])\s+/).some((s) =>
    QUESTION_WORD.test(s.trim()) || RU_QUESTION_WORD.test(s.trim()) ||
    (/\?\s*$/.test(s) && !FILLER.test(s) && !RU_FILLER.test(s) && ((!REQUEST.test(s) && !RU_REQUEST.test(s)) || ASKS_WHAT.test(s) || RU_ASKS_WHAT.test(s))));

const isForwarding = (b) =>
  /^(SendMessage|mcp__nimbalyst-host__send_prompt)$/.test(b.name) ||
  (b.name === "Bash" && /steer\.mjs["']?\s+send\b/.test(String(b.input?.command || "")));
// Calls that only prepare a forward (loading the SendMessage tool, finding the session)
const isPrep = (b) => /^(ToolSearch|ListAgents|mcp__nimbalyst-host__list_spawned_sessions|mcp__nimbalyst-host__list_recent_sessions)$/.test(b.name);
const FORWARD_WORDS = /\b(sent|send|sending|passed|pass|passing|forward|forwarded|forwarding|relayed|relay|handed|told|queued|left)\b/i;

// The block reason for this Stop, or null
export function stopVerdict(entries, lastMessage) {
  const { start, entries: turn } = currentTurn(entries);
  if (!start) return null;
  let text = turn.filter((e) => e.type === "assistant" && e.message?.model !== SYNTHETIC).map(assistantText).join("\n");
  if (typeof lastMessage === "string" && !text.includes(lastMessage.trim())) text += "\n" + lastMessage;
  text = text.trim();
  const uses = turn.filter((e) => e.type === "assistant" && Array.isArray(e.message?.content)).flatMap((e) => e.message.content.filter((b) => b.type === "tool_use"));
  const note = btwNote(userText(start));
  if (note !== null) {
    if (!asksQuestion(note)) return null;
    let rest = text.replace(FORWARD_NOTE, "").trim();
    if (NO_RESPONSE.test(rest)) rest = "";
    const forwards = uses.filter((b) => !isPrep(b));
    const forwarded = forwards.some(isForwarding) || FORWARD_SEEN.test(text);
    const onlyForwarded = forwards.length > 0 && forwards.every(isForwarding);
    const passedOn = rest.length < 150 && ((FORWARD_WORDS.test(rest) && /\b(session|note|it|them|question)\b/i.test(rest)) || (RU_FORWARDED.test(rest) && RU_PASSED_TO.test(rest)));
    return !rest || (forwarded && rest.length < 15) || (onlyForwarded && passedOn) ? REASON_BTW : null;
  }
  if (text && !NO_RESPONSE.test(text)) return null;
  if (uses.length && QUESTION_TOOLS.test(uses[uses.length - 1].name)) return null;
  if (text && (ACK.test(flat(userText(start))) || RU_ACK.test(flat(userText(start))))) return null;
  return REASON_EMPTY;
}

const flat = (s) => s.replace(/<NIMBALYST_SYSTEM_MESSAGE>[\s\S]*$/, "").replace(/\s+/g, " ").trim();
const gist = (s) => flat(s).toLowerCase().replace(/[^\p{L}\p{N}]/gu, "").slice(0, 60);
const words = (s) => flat(s).toLowerCase().match(/[\p{L}\p{N}']{3,}/gu) || [];
// The new prompt is the earlier message sent again, maybe reworded: same start, or 60% of its first 40 words
const sameMessage = (prompt, earlier) => {
  const g = gist(earlier);
  if (g && gist(prompt) === g) return true;
  const had = words(earlier).slice(0, 40), now = new Set(words(prompt));
  return had.length >= 3 && had.filter((w) => now.has(w)).length >= 0.6 * had.length;
};
// Prompts that come with promptSource "sdk" like typed ones but are sent by another session or a loop
// (a lead's brief, a relayed note, a report, a scheduled tick, a form's answer); they get no reminder
// (a handoff's "Read <brief> and continue the work" is a task to pick up, not a question left open)
const NOT_TYPED = /^(Time: |CHILD JOB\b|\[\d+ messages? arrived|\[Resuming after|Your turn was interrupted\b|From session\b|FROM "|REPORT from\b|Lead: |(New|One more|Another)( small)? (request|item) from the user\b|Read \S*handoffs\S* and continue\b)/i;
// Text before a tool call this short is a preamble ("Let me check."), not an answer
const PREAMBLE = 100;

// UserPromptSubmit: the typed message the previous turn was cut off on before any answer, or null
export function cutOffMessage(entries, prompt) {
  if (typeof prompt === "string" && NOT_TYPED.test(flat(prompt))) return null;
  let a = entries.length - 1;
  while (a >= 0 && entries[a].type !== "assistant") a--;
  if (a < 0 || entries[a].message?.model !== SYNTHETIC || !NO_RESPONSE.test(assistantText(entries[a]).trim())) return null;
  let said = 0;
  for (let i = a - 1; i >= 0; i--) {
    const e = entries[i];
    if (e.type === "assistant") {
      if (e.message?.model !== SYNTHETIC) said += assistantText(e).trim().length;
      if (said >= PREAMBLE) return null;
      continue;
    }
    if (e.type !== "user" || e.isMeta || !userText(e).trim() || INTERRUPTED.test(userText(e).trim())) continue;
    if (!typedByUser(e)) return null;
    const earlier = flat(userText(e));
    if (!earlier || NOT_TYPED.test(earlier) || (typeof prompt === "string" && sameMessage(prompt, earlier))) return null;
    return earlier;
  }
  return null;
}

if (isMain(import.meta.url)) {
  runHook("no-response-gate", (input) => {
    if (input.agent_id || !input.transcript_path || !fs.existsSync(input.transcript_path)) return; // none yet on a session's first prompt
    const entries = readEntries(tail(input.transcript_path, TAIL_BYTES));
    if (input.hook_event_name === "UserPromptSubmit") {
      const earlier = cutOffMessage(entries, input.prompt);
      if (earlier) {
        const quote = earlier.length > 300 ? earlier.slice(0, 300) + " …" : earlier;
        emit.context("UserPromptSubmit",
          `[no-response-gate] Your last turn was cut off (a refused tool call or a new message) before you replied to the user's earlier message: "${quote}". ` +
          "Answer it in this reply as well, unless the new message replaces it or says to drop it; if the new message repeats it, answer once.");
      }
    } else if (!input.stop_hook_active) {
      const reason = stopVerdict(entries, input.last_assistant_message);
      if (reason) emit.block(reason);
    }
  });
}
