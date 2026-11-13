#!/usr/bin/env node
// question-other: a PreToolUse hook for Nimbalyst's PromptForUserInput. The user wants to type
// their own answer on any choice question (design picks, "this or that"), so every singleSelect
// must set allowOther: true. A plain yes/no (keep it or not) should be a confirm field instead,
// which stays uncluttered.
// It also checks recommendations, because the user accepts the recommended option with one click
// most of the time: an option marked "(recommended)" (or with the badge "recommended") must carry its
// reason in its description / subtitle, and a singleSelect may recommend only one option.
// It can check that a reason is there, not that it is a good one.
// The reason has a fixed shape, so the user sees how much a recommendation rests on and the model
// has to write down the case against its own pick: "Checked: ..." (something was looked up)
// or "Judgment: ..." (nothing was), followed by "Other wins if: ...". A "Checked:" claim is compared
// with the session record (transcript_path), so it cannot be written for something never looked up.
// It also refuses (about one form in six left the user no way to type, and one asked the user to look
// through a page with no link anywhere):
// - Nimbalyst's own AskUserQuestion, which has no box for the user's own answer (the built-in
//   AskUserQuestion adds "Other" itself and is left alone; it needs mcp__nimbalyst__AskUserQuestion in
//   the settings matcher). A turn whose prompt came from the phone bot may use it: the phone can
//   answer nothing else;
// - a form where no field lets the user type (no editText field, no singleSelect with allowOther);
// - a form that points the user at something to look at (a "look through / check the page" phrase, or
//   a file path in its title, intro or labels) when neither the form nor Claude's visible text since its
//   last ordinary tool call has a clickable link (a markdown link to /C:/..., C:/... or /Users/..., or a URL) and no
//   picture or preview was shown there. Option descriptions are not scanned for it: they hold the
//   "Checked:" reasons, which name files.
//   Since 2026-10-29 the link must match where the file is: Nimbalyst opens a markdown link only for a
//   file inside the open project (the nearest ancestor of the hook input's cwd with a CLAUDE.md or .git,
//   else the cwd). A file outside it is presented by its path in inline code (`~/.claude/x.md`,
//   `C:/Users/you/x.md`) in the form or the reply text; a link to it would not open.
// Since 2026-11-02 (about a third of 739 real recommended questions truly missed, and a pick's "Checked:"
// did little better than "Judgment:") a form with a recommended option, AskUserQuestion included, also
// needs its own rec-check agent: one called since the user's last message and since the last form that went
// through. That call is no lookup, so it can't back a "Checked:". A singleSelect needs at least 2 options.
// REC_CHECK=off turns the agent check off; it is skipped too when ~/.claude/agents/rec-check.md isn't there (an install without that agent).
// It fails open, so any error or odd input lets the call through. QUESTION_OTHER=off disables it.
import { crashLog } from "./crash-log.mjs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, posix, resolve, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const MIN_REASON = 20; // characters; shorter than this is a label, not a reason
const recommended = (o) =>
  o && (/\(recommended\)/i.test(`${o.label || ""} ${o.title || ""}`) || /^recommended$/i.test(String(o.badge || "").trim()));
const reasonOf = (o) => String(o.description || o.subtitle || "").trim();
const hasReason = (o) => reasonOf(o).length >= MIN_REASON;
const BASIS = /(?:^|[^a-z])(?:checked|judgment)\s*:\s*\S/i;
const COUNTER = /other wins if\s*:\s*\S/i;
const hasShape = (o) => BASIS.test(reasonOf(o)) && COUNTER.test(reasonOf(o));

// "Checked:" is a claim the session record can confirm: a file or site it names must show up in one of
// this session's tool calls or their results; when it names none, something must have been looked up
// since the user's last message. Otherwise the word is "Judgment:". Files that are always loaded (CLAUDE.md, MEMORY.md) need no tool call.
const LOOKUP = /^(Read|Grep|Glob|Bash|PowerShell|WebSearch|WebFetch|LSP|Agent)$|ctx_|browser_|tracker_|memory_|search|fetch/i;
const FORM = /PromptForUserInput|AskUserQuestion/;
const SHOWN = /display_to_user|capture_editor_screenshot|browser_open_local_preview/; // put a picture or page in front of the user
// Bookkeeping calls change nothing the user sees, so a link written just before them still counts
const QUIET = /update_session_meta|update_session_board|^Task(Create|Update|List|Get)$|^TodoWrite$|^ToolSearch$/;
// User text Claude Code or Nimbalyst adds on its own (a background task's notice, an interrupt, a
// system or child-session prompt): it does not start a new turn
const INJECTED = /^\s*(<task-notification>|\[(Request interrupted|System:|Child Session Update\]))/;
// The phone bot's note on every prompt it sends: a phone can answer only Nimbalyst's AskUserQuestion
const PHONE = /\(Sent from the phone\. /;
const ALWAYS_LOADED = /^(claude|memory)\.md$/;
const checkedClause = (o) => (reasonOf(o).match(/(?:^|[^a-z])checked\s*:\s*([\s\S]*?)(?=other wins if\s*:|$)/i) || [])[1] || "";
const sources = (s) => [...s.matchAll(/[\w~.\-\/\\]*[\w\-]\.[a-z][a-z0-9]{0,5}\b/gi)].map((m) => m[0].split(/[\/\\]/).pop().toLowerCase());
export const readRecord = (file) => recordFrom(readFileSync(file, "utf8").split("\n"));
export function recordFrom(lines) {
  const calls = [], results = [], forms = new Set(), recCalls = new Set();
  // replyText / shown: what the user has in front of them right before the form, i.e. the text and
  // pictures since the last ordinary tool call (an old research URL earlier in the turn doesn't count)
  let turnStart = 0, replyText = "", shown = false, fromPhone = false, recChecked = false;
  for (const line of lines) {
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (!e || e.isSidechain) continue;
    const content = e.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    if (e.type === "user" && !e.isMeta) {
      const said = typeof content === "string" ? content : blocks.map((b) => (b?.type === "text" ? b.text || "" : "")).join("\n");
      const typed = (typeof content === "string" || (blocks.some((b) => b?.type === "text") && !blocks.some((b) => b?.type === "tool_result")))
        && !INJECTED.test(said) && e.origin?.kind !== "task-notification";
      if (typed) { turnStart = calls.length; replyText = ""; shown = false; fromPhone = PHONE.test(said); recChecked = false; }
    }
    for (const b of blocks) {
      if (e.type === "assistant" && b?.type === "text") replyText += `\n${b.text || ""}`;
      if (e.type === "assistant" && b?.type === "tool_use") {
        const isRec = /^(Agent|Task)$/.test(b.name || "") && b.input?.subagent_type === "rec-check";
        if (SHOWN.test(b.name || "")) shown = true;
        else if (!FORM.test(b.name || "") && !QUIET.test(b.name || "") && !isRec) { replyText = ""; shown = false; }
        if (FORM.test(b.name || "")) forms.add(b.id);
        else if (isRec) { recCalls.add(b.id); recChecked = true; } // not a lookup: the form it checks can't be backed by it
        else calls.push({ name: b.name || "", text: JSON.stringify(b.input || {}).toLowerCase() });
      } else if (e.type === "user" && b?.type === "tool_result") {
        if (forms.has(b.tool_use_id)) { if (!b.is_error) recChecked = false; } // a check covers the one form it saw; a refused form keeps it
        else if (recCalls.has(b.tool_use_id)) { if (b.is_error) recChecked = false; }
        else results.push(JSON.stringify(b.content ?? "").toLowerCase());
      }
    }
  }
  const thisTurn = calls.slice(turnStart);
  return { calls, results, thisTurn, replyText, shown, fromPhone, recChecked };
}
const recCheckOn = () => (process.env.REC_CHECK || "").toLowerCase() !== "off" && existsSync(join(homedir(), ".claude", "agents", "rec-check.md"));
const backed = (o, seen) => {
  const clause = checkedClause(o);
  if (!clause) return true; // "Judgment:" claims nothing
  const named = sources(clause);
  if (named.some((s) => ALWAYS_LOADED.test(s))) return true;
  // a named file or site must show up in what a tool was asked or in what it returned
  if (named.length) return named.some((s) => seen.calls.some((c) => c.text.includes(s)) || seen.results.some((r) => r.includes(s)));
  return seen.thisTurn.some((c) => LOOKUP.test(c.name));
};

// A field the user can type into
const typeable = (f) => f && (f.type === "editText" || (f.type === "singleSelect" && f.allowOther === true));

// Words that send the user to look at something. Bare nouns ("page", "file") are left out on purpose:
// on real forms they mostly name a shop's page or a source, not something Claude made.
const NOUN = String.raw`(?:page|file|doc|document|draft|mockup|preview|picture|photo|image|screenshot|report|video|version|layout|site|html)s?`;
const POINTS = new RegExp([
  String.raw`\b(?:look|looking|glance) (?:through|at|over) (?:it|this|them|these)\b`, // not "look at the buyer"
  String.raw`\b(?:open|check|see|read|review|try|test|scroll|browse|go through|look through|look at|look over) (?:the|this|my|it|them|your)(?:\s+[\w-]+){0,2}?\s+${NOUN}\b`,
  String.raw`\bwhat I(?:'ve| have)? (?:built|made|wrote|drew|changed|put together)\b`,
  String.raw`\b(?:the|this|my) (?:new |updated |first )?mockups?\b`, // not "draft" or "preview": often inside the form or not made yet
].join("|"), "i"); // not "looks right?" or "take a look": often about a plan written in the chat itself
// Russian twins of POINTS and NOT_TO_LOOK (`--language russian`). \b does not see Cyrillic: u flag and lookarounds.
const RU_NOUN = String.raw`(?:страниц\p{L}*|файл\p{L}*|документ\p{L}*|черновик\p{L}*|макет\p{L}*|превью|картинк\p{L}*|фото\p{L}*|изображени\p{L}*|скриншот\p{L}*|отч[её]т\p{L}*|видео|верси\p{L}*|сайт\p{L}*|html)`;
const RU_LOOK = String.raw`(?:посмотрите|посмотри|взгляните|взгляни|откройте|открой|проверьте|проверь|прочитайте|прочти|просмотрите|просмотри|пролистайте|пролистай|ознакомьтесь с|протестируйте|протестируй|попробуйте|попробуй)`;
const RU_POINTS = new RegExp([
  String.raw`(?<!\p{L})(?:посмотрите|посмотри|взгляните|взгляни)\s+(?:на\s+)?(?:него|неё|нее|это|них|эти)(?!\p{L})`,
  String.raw`(?<!\p{L})${RU_LOOK}\s+(?:на\s+)?(?:эту|этот|это|эти|мою|мой|моё|мое|мои|ваш\p{L}*|его|её|ее|их)(?:\s+[\p{L}-]+){0,2}?\s+${RU_NOUN}(?!\p{L})`,
  String.raw`(?<!\p{L})то, что я (?:сделал|сделала|собрал|собрала|написал|написала|нарисовал|нарисовала|изменил|изменила)(?!\p{L})`,
  String.raw`(?<!\p{L})(?:этот|мой|новый|обновл[её]нный)\s+макет(?!\p{L})`,
].join("|"), "iu");
const RU_NOT_TO_LOOK = /(?<!\p{L})(?:из|как|(?:добавлено|записано|сохранено|скопировано|перенесено|попадут|попадёт|попадет|идут|пойдут) в)\s*[(`"'\[]?\s*$/iu;
const PATH = /(?:^|[\s(:"'`\[])((?:[A-Za-z]:|~)?[\\/]?(?:[\w.\-]+[\\/])*[\w\-]+\.(?:md|html?|pdf|png|jpe?g|gif|webp|svg|mp4|docx?|xlsx?|pptx?|csv))\b/gi;
const NOTES = /(?:^|[\\/])(?:decisions|claude|handoff|memory)(?:\.md$|[\\/])/i; // where answers get written, not something to look at
// "goes into x.md", "added to x.md", "save it as `x.png`", "counts are from x.xlsx"
const NOT_TO_LOOK = /\b(?:into|(?:added|written|saved|copied|moved|appended) to|as|from)\s*[(`"'\[]?\s*$/i;
// Links Nimbalyst's chat opens: an absolute local path with forward slashes (/C:/..., or /Users/... on
// a Mac), or a web address
const LOCAL_LINK = /\]\(\s*<?(?:\/?[A-Za-z]:\/|\/(?![\/\\]|[A-Za-z]\/))[^)]*\)/; // not //host or Git Bash's /c/...
const WEB_LINK = /https?:\/\/[^\s)]+/i;
export const LINK = new RegExp(`${LOCAL_LINK.source}|${WEB_LINK.source}`, "i");
// The form's own words; option descriptions hold the "Checked:" reasons, so they are left out
const formText = (input, fields, withDrafts = false) => {
  const out = [input.title, input.intro];
  for (const f of fields) {
    if (!f) continue;
    out.push(f.label, f.description);
    if (withDrafts) out.push(f.initialText);
    for (const o of [...(Array.isArray(f.options) ? f.options : []), ...(Array.isArray(f.items) ? f.items : [])]) out.push(o?.label, o?.title);
  }
  return out.filter((s) => typeof s === "string").join("\n");
};
// What in the form sends the user to look at something: { text, file } (file: a local path), or null
export function pointer(input, fields) {
  const text = formText(input, fields);
  const phrase = text.match(POINTS) || text.match(RU_POINTS);
  if (phrase) return { text: phrase[0], file: false };
  const path = [...text.matchAll(PATH)].find((m) =>
    !NOTES.test(m[1]) && !NOT_TO_LOOK.test(text.slice(Math.max(0, m.index - 30), m.index + m[0].length - m[1].length)) &&
    !RU_NOT_TO_LOOK.test(text.slice(Math.max(0, m.index - 30), m.index + m[0].length - m[1].length)));
  return path ? { text: path[1], file: true } : null;
}

// Inside the open project? The project root is the nearest ancestor of cwd with a CLAUDE.md or .git, else cwd.
// Without a cwd nothing can be told, so the file counts as inside (the link rule stays as it was).
const gitBash = (p) => p.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");
const slashed = (p) => p.replace(/\\/g, "/");
export function projectRoot(cwd) {
  // CLAUDE_PROJECT_DIR is the open project; the hook's cwd follows Bash `cd` and can sit elsewhere
  const envDir = process.env.CLAUDE_PROJECT_DIR;
  try { if (envDir && existsSync(envDir)) return gitBash(slashed(envDir)); } catch {}
  try {
    for (let d = cwd; ; ) {
      if (existsSync(join(d, "CLAUDE.md")) || existsSync(join(d, ".git"))) return d;
      const up = dirname(d);
      if (up === d) return cwd;
      d = up;
    }
  } catch { return cwd; }
}
export function outsideProject(file, cwd) {
  if (!cwd) return false;
  const base = gitBash(slashed(cwd));
  let t = slashed(file);
  if (t === "~" || t.startsWith("~/")) t = slashed(homedir()) + t.slice(1);
  t = gitBash(t).replace(/^\/([A-Za-z]:\/)/, "$1");
  if (!/^[A-Za-z]:\//.test(t) && !t.startsWith("/")) t = (/^[A-Za-z]:\//.test(base) ? win32 : posix).resolve(base, t);
  const norm = (p) => slashed(p).replace(/\/+$/, "").toLowerCase();
  const a = norm(t), r = norm(projectRoot(base));
  return !(a === r || a.startsWith(r + "/"));
}
// A path in inline code that names the file (its name, plus a folder or ~)
const inCode = (s, file) => {
  const name = file.split(/[\\/]/).pop().toLowerCase();
  return [...s.matchAll(/`([^`\n]+)`/g)].some((m) => /[\\/~]/.test(m[1]) && m[1].toLowerCase().includes(name));
};

const REC_ASK = `This form recommends an option and no rec-check agent has looked at it: none since the user's last message, or none since the last form went through. ` +
  `The user clicks the recommended option on trust and about a third of them missed. Call the Agent tool once, in the foreground, with subagent_type "rec-check". Its prompt: the user's own words on this, ` +
  `the question, every option with its reason, and what you looked at. Act on what it says, then send the form again. Fix anything it changes; if you overrule it, say why in the reply.`;

// The reasons to refuse one call (empty when it may go through). seen = readRecord(...) or null.
export function review(event, seen) {
  const tool = String(event.tool_name || "");
  if (/AskUserQuestion$/.test(tool)) {
    if (tool.startsWith("mcp__") && !seen?.fromPhone)
      return [`Nimbalyst's AskUserQuestion has no box where the user can type their own answer, and the user wants one on every question. ` +
        `Use mcp__nimbalyst__PromptForUserInput instead: a singleSelect with allowOther: true for a choice, a confirm field for a plain yes/no, ` +
        `plus an optional editText field ("Anything else?") when no field takes typing.`];
    const pick = (event.tool_input?.questions || []).some((q) => (q?.options || []).some(recommended));
    return pick && seen?.recChecked === false && recCheckOn() ? [REC_ASK] : [];
  }
  if (!tool.endsWith("PromptForUserInput")) return [];
  const input = event.tool_input || {};
  let fields = input.fields;
  if (typeof fields === "string") try { fields = JSON.parse(fields); } catch { return []; }
  if (!Array.isArray(fields)) return [];
  const noOther = [], noReason = [], noShape = [], notChecked = [], twoRecommended = [], oneOption = [];
  let anyPick = false;
  for (const f of fields) {
    if (!f) continue;
    const name = `"${f.label || f.id}"`;
    if (f.type === "singleSelect" && f.allowOther !== true) noOther.push(name);
    const options = f.type === "singleSelect" ? f.options : f.type === "multiSelect" ? f.items : null;
    if (!Array.isArray(options)) continue;
    const picks = options.filter(recommended);
    anyPick ||= picks.length > 0;
    if (f.type === "singleSelect" && options.length < 2) oneOption.push(name);
    if (f.type === "singleSelect" && picks.length > 1) twoRecommended.push(name);
    if (picks.some((o) => !hasReason(o))) noReason.push(name);
    else if (picks.some((o) => !hasShape(o))) noShape.push(name);
    else if (seen && picks.some((o) => !backed(o, seen))) notChecked.push(name);
  }
  const parts = [];
  if (noOther.length)
    parts.push(
      `${noOther.join(", ")} has no free-text option. The user wants to write their own answer on every choice question. ` +
      `Add allowOther: true to each singleSelect. If a question is a plain yes/no (keep it or not, an obvious no-brainer), use a confirm field instead, ` +
      `and add an optional editText field ("Anything else?") when no other field takes typing.`);
  else if (!fields.some(typeable))
    parts.push(
      `No field in this form lets the user type their own answer (no editText field and no singleSelect with allowOther: true). ` +
      `Add an optional editText field labelled "Anything else?", or allowOther: true on a singleSelect.`);
  // A link in the form's own words or in the reply right before it, or a picture shown there, counts as
  // presented. A local file needs a local link: a web address does not open it.
  const point = pointer(input, fields);
  const outside = !!point?.file && outsideProject(point.text, typeof event.cwd === "string" ? event.cwd : "");
  const presented = (s) => (outside ? inCode(s, point.text) : (point.file ? LOCAL_LINK : LINK).test(s));
  if (point && seen && !presented(formText(input, fields, true)) && !presented(seen.replyText) && !seen.shown)
    parts.push(outside
      ? `This form sends the user to look at a file ("${point.text}") that is outside the open project, and neither the form nor the reply text right before it names its path in code. ` +
        `Nimbalyst opens a markdown link only for a file inside the open project (a file inside the project: a markdown link; outside it: its path in code), so a link would not open. ` +
        `Stop and write the path in inline code in the reply text first (\`~/.claude/skills/x/SKILL.md\` or \`C:/Users/you/x.md\`), with what you wrote, what you think of it and what you recommend. Then ask.`
      : `This form sends the user to look at something ("${point.text}"), but neither the form nor the reply text right before it has a clickable link to it, ` +
        `so the user cannot find it. Stop and write it in the reply text first: what you built or wrote, as a markdown link ` +
        `([name](/C:/path/to/file.md): forward slashes, no file:///, no backslashes; or a web address for a site), what you think of it and what you recommend. ` +
        `(A file inside the project: a markdown link; outside it: its path in code.) Then ask.`);
  if (noReason.length)
    parts.push(
      `${noReason.join(", ")} recommends an option without a reason. The user accepts the recommended option with one click, so say in its ` +
      `description (subtitle in a multiSelect) why it is the best choice, as "Checked: <what you looked at and what it showed>" or ` +
      `"Judgment: <why>", followed by "Other wins if: <the case where another option is better>". ` +
      `If you have no basis (a matter of taste, or it depends on something only the user knows), drop the "(recommended)" mark and the pre-selection.`);
  if (noShape.length)
    parts.push(
      `${noShape.join(", ")} recommends an option whose reason is not in the two-part shape. Write it as "Checked: <what you looked at and ` +
      `what it showed>" (or "Judgment: <why>" when nothing was looked up), followed by "Other wins if: <the case where another option is better>". ` +
      `Write "Checked:" only for something really looked up. A hard-to-undo choice that rests on judgment alone gets no "(recommended)" mark.`);
  if (notChecked.length)
    parts.push(
      `${notChecked.join(", ")} says "Checked:" but this session's record shows no tool call that touched the file or site it names (or, when it ` +
      `names none, nothing was looked up since the user's last message). Look it up now (one file, DECISIONS.md or one search) and name it after "Checked:", ` +
      `or write "Judgment:" instead. The user clicks the recommended option on trust, so "Checked:" has to be true.`);
  if (twoRecommended.length)
    parts.push(`${twoRecommended.join(", ")} marks more than one option as recommended. Recommend one, or none.`);
  if (oneOption.length)
    parts.push(`${oneOption.join(", ")} has fewer than 2 options, so it asks nothing. Add the real alternative, or use a confirm field if it is a plain yes/no, or decide it yourself and say so.`);
  if (anyPick && seen?.recChecked === false && recCheckOn()) parts.push(REC_ASK);
  return parts;
}

if (process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase()) {
  try {
    if ((process.env.QUESTION_OTHER || "").toLowerCase() === "off") process.exit(0);
    const event = JSON.parse(readFileSync(0, "utf8"));
    let seen = null; // no session record (or an unreadable one) lets "Checked:" and the link check through
    const needsRecord = /PromptForUserInput$|AskUserQuestion$/.test(String(event.tool_name || ""));
    try { if (needsRecord && event.transcript_path) seen = readRecord(event.transcript_path); } catch {}
    const parts = review(event, seen);
    if (parts.length) {
      const again = /AskUserQuestion$/.test(String(event.tool_name || "")) ? "" : " Then call PromptForUserInput again.";
      process.stdout.write(JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PreToolUse",
          permissionDecision: "deny",
          permissionDecisionReason: `question-other: ${parts.join(" ")}${again}`,
        },
      }));
    }
  } catch (err) {
    crashLog("question-other", err);
    process.exit(0);
  }
}
