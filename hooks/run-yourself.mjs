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
  /\b(I\s+(already\s+)?(tried|ran|attempted)|my\s+(own\s+)?attempt|(it|that|this)\s+(failed|didn'?t work|did not work)|(was|got|is)\s+(blocked|denied)|password|passphrase|as\s+(an\s+)?administrator|elevated|sudo|permission\s+denied|PermissionDenied|(allow|approve)\s+(it|the\s+\w+|this|that)\b[^.\n]{0,40}\b(retry|try\s+again))\b/i;

// Steps only the user can do, judged per code span from the text around it (sampled send-backs, 2026-10-30)
// A secret they hold, typed into their own machine: a placeholder or an assignment in the command itself, or
// the words right beside it ("paste your key in place of ..."). A bare word like "token" in the same
// paragraph is not enough ("Your login token expired. You need to run `gh auth login`"). PIN is upper case only.
const SECRET_IN_CODE = /\bsk-ant-|<[^<>\n]*\b(?:api[ -]?key|key|token|secret|password|passphrase|code|PIN)\b[^<>\n]*>|\bsetx\s+\w+\s+["']|\b[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD|PASSPHRASE)\s*=|\byour[-_ ](?:api[-_ ]?)?(?:key|token|secret|password)\b/i;
const secretBeside = (noun, flags) => new RegExp(
  String.raw`\b(?:[Ee]nter|[Tt]ype|[Pp]aste|[Pp]ut|[Ii]nsert|[Ff]ill in|[Rr]eplace|[Ss]upply|[Pp]rovide)\b[^.\n]{0,40}\b${noun}\b|\b${noun}\b[^.\n]{0,40}\b(?:placeholder|in place of|goes in|where it says)\b`, flags);
const SECRET_BESIDE = secretBeside("(?:api[ -]?keys?|secrets?|passphrase|password|tokens?|verification code|one-time code|2FA(?: code)?|credentials?)", "i");
const PIN_BESIDE = secretBeside("PIN", "");
// The text is for another person to run on their own computer, not for this user. One regex for both checks.
// A pronoun counts when it is "he"/"she", or "they" with a person named in the 200 characters before it.
const OTHER_PERSON = new RegExp([
  String.raw`\b(?:he|she)\s+(?:opens?|runs?|pastes?|types?|needs?|should|can|will|uses?)\b`,
  String.raw`\b(?:friend|colleague|teammate|coworker|client|customer|maker|person|someone)\b[\s\S]{0,200}?\bthey\s+(?:open|run|paste|type|need|should|can|will|use)\b`,
  String.raw`\b(?:send|ask|tell|give)\s+(?:him|her)\b`,
  String.raw`\b(?:his|her|friend'?s?|other maker'?s?|someone else'?s?|another person'?s?)\s+(?:own\s+)?(?:computer|pc|machine|laptop|terminal|chat|project|session|window)\b`,
  String.raw`\btheir\s+own\s+(?:computer|pc|machine|laptop)\b`,
  String.raw`\b(?:your|the)\s+friend\b`,
].join("|"), "i");
// The code is a message to this chat, not a shell command: only the words just before it say so
const FOR_THIS_CHAT = /\b(?:in|into|to)\s+this\s+(?:chat|session|conversation)\b[^.`]{0,30}$/i;
// The permission system or a tool call refused the command: only the user can approve it (a refused push)
const PERM_REFUSED = /\b(?:permissions?|hook|sandbox|classifier|tool call|auto mode)\b[^.\n]{0,80}\b(?:refus|reject|declin|den)\w*|\b(?:refus|reject|declin)\w*\b[^.\n]{0,60}\b(?:permissions?|tool call|hook|sandbox|classifier)\b/i;
const around = (text, c) => text.slice(Math.max(0, c.at - 300), c.at) + " " + c.code + " " + text.slice(c.at + c.code.length, c.at + c.code.length + 200);
const onlyTheUser = (text, c) => {
  const near = around(text, c);
  const before = text.slice(Math.max(0, c.at - 120), c.at);
  return SECRET_IN_CODE.test(c.code) || SECRET_BESIDE.test(near) || PIN_BESIDE.test(near) || OTHER_PERSON.test(near) ||
    FOR_THIS_CHAT.test(before) || /\b(?:see|shows?|prints?|says?|reads?|returns?|displays?|output)\s*:?\s*$/i.test(before) || // output shown, not a command
    PERM_REFUSED.test(near) || SKILL_PROMPT.test(c.code);
};

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
// The item asks for something only the user knows or has ("the address, when you want it on the page"), or to
// send their own earlier message again: the text is theirs, so there is none to give. Not for an item that
// names a handoff, brief, prompt or command, which Claude writes (CLAUDE_WRITES, checked on both).
// THEIRS is anchored: the item opens with the thing asked for ("The server address, when you want it ...");
// a leading timing clause ("When you get a minute, tell the new session ...") is not a value only they hold.
const RESEND = /\b(?:send|resend|retype|repeat)\b[^.\n]{0,40}\b(message|request)\b[^.\n]{0,30}\bagain\b/i;
const THEIRS = /^[\s>*_#\-+\d.)]*(?:the|any|your|an?)\s+[^.\n:;,]{1,60},\s*(?:when|if)\s+you\s+(?:want|have|know|decide|choose|pick)\b|\byou'd\s+rather\b|\bonly\s+you\s+(?:know|have)\b/i;
const CLAUDE_WRITES = /\b(?:handoff|brief|prompt|command|script|query|instructions?|messages?|text|notes?)\b/i;
// Their own earlier message sent again: judged on the sentence it sits in, without the noun it names
const resendIsTheirs = (item) => {
  const m = RESEND.exec(item);
  if (!m) return false;
  const before = item.slice(0, m.index).split(/[.!?\n]/).pop();
  const after = item.slice(m.index + m[0].length).split(/[.!?\n]/)[0];
  return !CLAUDE_WRITES.test(before + " " + m[0].replace(new RegExp(`\\b${m[1]}\\b`, "i"), " ") + " " + after);
};

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
    if (resendIsTheirs(item) || (THEIRS.test(item) && !CLAUDE_WRITES.test(item))) return false;
    const prose = item.replace(/```[\s\S]*?(```|$)/g, " ").replace(/`[^`\n]+`/g, " ");
    const codes = codeCandidates(item).map((c) => c.code).filter(Boolean);
    const exact = codes.some((c) => /\s/.test(c) || c.startsWith("/"));
    return VAGUE.some((v) => v.re.test(prose) && !(v.anyCode ? codes.length : exact));
  });
};

export const asksUserToRun = (text) => {
  if (!text || EXEMPT.test(text)) return false;
  const codes = codeCandidates(text).filter((c) => shellLike(c.code) && !forOtherProject(text, c) && !onlyTheUser(text, c));
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

// OTHER_PERSON (above) also covers a prompt meant for another person: nothing here can reach their computer
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
// The user asked for the handoff, or asked what exactly to tell or paste into the new session
const ASKED_FOR_TEXT = /\b(?:what|which|how)\b[^.?!\n]{0,80}\b(?:tells?|say|says|paste|send|type|prompt|write)\b[^.?!\n]{0,60}\b(?:new|another|other|fresh|separate)\s+(?:session|chat|window|conversation)\b/i;
export const askedForHandoff = (t) => /\bhand[\s-]?off\b/i.test(t) || ASKED_FOR_TEXT.test(t);
const userAskedForHandoff = (input) => {
  try { return askedForHandoff(lastUserText(input.transcript_path)); } catch { return false; }
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
