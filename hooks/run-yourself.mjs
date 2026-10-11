#!/usr/bin/env node
// run-yourself: Stop hook. Backs the "Do the work yourself, fully" rule in CLAUDE.md. If Claude ends
// a turn by telling the user to run, paste or type a shell command (a code span or block next to
// phrases like "open a terminal and run", "you need to run", "paste this into"), it blocks the stop
// ONCE and says to run it itself. Silent for slash commands the user types (/model, /handoff ...),
// URLs and localhost, commands shown as proof of what was run, a message that says the attempt
// already failed or needs a password / admin rights, and when stop_hook_active is set (no loops).
// A prompt to paste into a session in another project's window is not a shell command, so that check
// skips it; the third check below handles it.
// Second check, for the "Needs you" rule: blocks ONCE when a "Needs you" item tells the user to send,
// paste, type or run something ("send the handoff", "tell it to read the file", "run the login
// command") without the exact text in a code block or code span.
// Third check, for "a yes is the go-ahead": blocks ONCE when the reply hands the user a prompt to paste
// into a session in another project's window, and says to do the work from here if its own tools can.
// Silent when the user's last message asked for a handoff, or the reply says what the work needs a
// session there for (a skill, hook or MCP server that only loads in that project), or the prompt is the
// handoff skill's own ("... continue the work from "Where we are"").
// Fails open. RUN_YOURSELF=off disables it.
import fs from "node:fs";

const REASON =
  "You told the user to run a command. Run it yourself now; hand it over only if your own attempt failed, or it needs a password only they can type.";
const REASON_VAGUE =
  'A "Needs you" item tells the user to send, paste, type or run something without giving the exact text. If a command can do it, run it yourself now. ' +
  "If the step really is theirs, rewrite the item: the exact text in a code block, where to paste it (which window or field), and what they should see afterwards.";
const REASON_HANDOVER =
  "You are handing the user a prompt to paste into another project's session. If your own tools can do that work from here (edit that project's files, run a command in its folder) " +
  "and the user asked for it or confirmed it, do it now and report what you did. Keep the handover only if the work needs a session inside that project, and then say what it needs that session for.";

const TRIGGERS = [
  /\b(open|launch|start|use)\s+(a|an|the|your)?\s*(new\s+)?(terminal|powershell|command prompt|cmd|shell|console)\b/i,
  /\b(run|paste|type|execute|enter)\b[^.\n]{0,60}\b(in|into|at|on|from)\s+(a|an|the|your)\s+(new\s+)?(terminal|powershell|shell|command prompt|cmd|console)\b/i,
  /\b(you|you'll|you will)\s+(need|have|must|should|can|could)\s+(to\s+)?(run|paste|type|execute)\b/i,
  /\b(please|just|now|then|first)\s+(run|paste|type|execute)\b/i,
  /\b(run|paste|type|execute)\s+(this|these|the following|it yourself)\b/i,
  /\bcopy\s*(and|&)\s*paste\b/i,
];
// The attempt already failed, or only the user can do it
const EXEMPT =
  /\b(I\s+(already\s+)?(tried|ran|attempted)|my\s+(own\s+)?attempt|(it|that|this)\s+(failed|didn'?t work|did not work)|(was|got|is)\s+(blocked|denied)|password|passphrase|as\s+(an\s+)?administrator|elevated|sudo)\b/i;

const codeCandidates = (text) => {
  const out = [];
  for (const m of text.matchAll(/```[^\n]*\n([\s\S]*?)```/g)) out.push({ at: m.index, code: m[1].trim() });
  const noBlocks = text.replace(/```[\s\S]*?```/g, (b) => " ".repeat(b.length));
  for (const m of noBlocks.matchAll(/`([^`\n]+)`/g)) out.push({ at: m.index, code: m[1].trim() });
  return out;
};
// A multi-word command the user would type in a shell: not a /slash command, URL, localhost or bare path
const shellLike = (c) =>
  /\s/.test(c) && !/^\/[\w:-]+(\s|$)/.test(c) && !/^https?:/i.test(c) && !/localhost|127\.0\.0\.1/i.test(c) && !/^[A-Za-z]:[\\/][^\s]*$/.test(c);

// The text around the code says it goes into a session or chat in another project's window, not a terminal
const forOtherProject = (text, c) => {
  const around = text.slice(Math.max(0, c.at - 300), c.at) + " " + text.slice(c.at + c.code.length, c.at + c.code.length + 200);
  return /\b(session|chat)\b/i.test(around) && /\b(window|project|workspace)\b/i.test(around) &&
    !/\b(terminal|powershell|command prompt|cmd|shell|console)\b/i.test(around);
};

// "Needs you" items that hand over typing or pasting without the text. anyCode: a one-word code span is enough (a value)
const VAGUE = [
  { re: /\b(tell|ask|instruct|point|direct)\s+(it|the\s+(new\s+|other\s+|fresh\s+)?(session|chat|agent|claude|model))\b/i },
  { re: /\b(send|paste|give|hand|pass|forward|submit)\s+(it\s+|over\s+)?(the|this|that|a|your)\s+(\w+\s+)?(handoff|brief|prompt|message|instructions?|text|command|note)\b/i },
  { re: /\b(run|rerun|execute|type|enter|use)\s+(the|a|an|that|this|your|its)\s+([\w-]+\s+){0,2}(command|script|query|one-liner)\b/i },
  { re: /\b(enter|type|paste|set|fill\s+in|put\s+in)\s+(the|a|an|that|this)\s+([\w-]+\s+){0,2}(value|setting|search\s+(text|term|phrase)|query|text|url|path|name)\b/i, anyCode: true },
];
// Only the user has it, so there is no text to give
const SECRET = /\b(password|passphrase|api key|secret|token|verification code|one-time code|2FA|PIN)\b/;

// The "Needs you" section split into its top-level items (text before the first bullet is an item too)
const needsYouItems = (text) => {
  const m = /(?:^|\n)[ \t>]*(?:#{1,6}[ \t]*|[-*][ \t]+)?(?:\*\*|__)?needs you\b/i.exec(text);
  if (!m) return [];
  let section = text.slice(m.index + m[0].length);
  const end = section.search(/\n#{1,6}[ \t]/);
  if (end >= 0) section = section.slice(0, end);
  const items = [[]];
  let fenced = false;
  for (const line of section.split("\n")) {
    if (/^\s*```/.test(line)) fenced = !fenced;
    else if (!fenced && /^ {0,3}([-*+]|\d+[.)])\s+/.test(line)) items.push([]);
    items[items.length - 1].push(line);
  }
  return items.map((i) => i.join("\n")).filter((i) => i.trim());
};

export const vagueNeedsYou = (text) => {
  if (!text) return false;
  return needsYouItems(text).some((item) => {
    if (SECRET.test(item)) return false;
    const prose = item.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]+`/g, " ");
    const codes = codeCandidates(item).map((c) => c.code).filter(Boolean);
    const exact = codes.some((c) => /\s/.test(c) || c.startsWith("/"));
    return VAGUE.some((v) => v.re.test(prose) && !(v.anyCode ? codes.length : exact));
  });
};

export const asksUserToRun = (text) => {
  if (!text || EXEMPT.test(text)) return false;
  const codes = codeCandidates(text).filter((c) => shellLike(c.code) && !forOtherProject(text, c));
  if (!codes.length) return false;
  for (const re of TRIGGERS) {
    const m = re.exec(text);
    if (!m) continue;
    const from = m.index - 100, to = m.index + m[0].length + 300;
    if (codes.some((c) => c.at >= from && c.at <= to)) return true;
  }
  return false;
};

// The reply says why the work has to happen in a session of that project
const NEEDS_SESSION =
  /\b(needs?|requires?|has to run in|must run in|only (runs?|works?|loads?) in)\b[^.\n]{0,100}\b(session|skills?|hooks?|MCP|plugins?)\b/i;

// The reply says the prompt is for another person, to use on their own computer: nothing here can reach it
const OTHER_PERSON =
  /\b(his|her|their|friend'?s?|other maker'?s?|someone else'?s?|another person'?s?)\s+(own\s+)?(computer|pc|machine|laptop|chat)\b/i;

// The prompt the handoff skill itself tells Claude to hand over ("Read <brief> and continue the work from
// "Where we are"..."): a handoff the skill was asked for, not work Claude could do from here
const SKILL_PROMPT = /\bcontinue the work from\s+["“”']?Where we are\b/i;

export const handsOverPrompt = (text) => {
  if (!text || NEEDS_SESSION.test(text) || OTHER_PERSON.test(text)) return false;
  return codeCandidates(text).some((c) => {
    if (!shellLike(c.code) || !forOtherProject(text, c) || SKILL_PROMPT.test(c.code)) return false;
    return /\b(paste|type|send|give)\b/i.test(text.slice(Math.max(0, c.at - 300), c.at));
  });
};

// What the user last typed (not a tool result), to see whether they asked for the handoff themselves
const lastUserText = (transcriptPath) => {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.type !== "user") continue;
    const c = e.message?.content;
    const t = typeof c === "string" ? c : Array.isArray(c) ? c.filter((b) => b.type === "text").map((b) => b.text).join("\n") : "";
    if (t.trim()) return t;
  }
  return "";
};
const userAskedForHandoff = (input) => {
  try { return /\bhand[\s-]?off\b/i.test(lastUserText(input.transcript_path)); } catch { return false; }
};

// The text Claude wrote after its last tool call (the part the user reads as the reply)
const lastReply = (transcriptPath) => {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.type === "user") break;
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    if (e.message.content.some((b) => b.type === "tool_use")) break;
    const t = e.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (t) parts.unshift(t);
  }
  return parts.join("\n");
};

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if (process.env.RUN_YOURSELF === "off") return;
      const input = JSON.parse(raw);
      if (input.stop_hook_active) return;
      const text = typeof input.last_assistant_message === "string" && input.last_assistant_message
        ? input.last_assistant_message
        : input.transcript_path ? lastReply(input.transcript_path) : "";
      if (asksUserToRun(text)) process.stdout.write(JSON.stringify({ decision: "block", reason: REASON }));
      else if (vagueNeedsYou(text)) process.stdout.write(JSON.stringify({ decision: "block", reason: REASON_VAGUE }));
      else if (handsOverPrompt(text) && !userAskedForHandoff(input)) process.stdout.write(JSON.stringify({ decision: "block", reason: REASON_HANDOVER }));
    } catch {
      // fail open
    }
  });
}
