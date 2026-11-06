#!/usr/bin/env node
// question-other: PreToolUse hook for Nimbalyst's PromptForUserInput. The user wants to type their own answer on any
// choice question, so every singleSelect must set allowOther: true; a plain yes/no should be a confirm field.
// A recommended option (marked "(recommended)" or with the badge "recommended") must carry its reason in its
// description / subtitle, shaped "Checked: ..." (something was looked up) or "Judgment: ..." (nothing was), then
// "Other wins if: ...". A "Checked:" claim is compared with the session record (transcript_path). It can check that a
// reason is there, not that it is a good one. A singleSelect may recommend only one option and needs at least 2 options.
// QUESTION_OTHER=off disables it; REC_CHECK=off turns the rec-check agent check off. It fails open.
//
// It refuses:
// - Nimbalyst's own AskUserQuestion, which has no box for the user's own answer (the built-in AskUserQuestion adds
//   "Other" itself and is left alone; it needs mcp__nimbalyst__AskUserQuestion in the settings matcher). A turn whose
//   prompt came from the phone bot may use it: the phone can answer nothing else;
// - a form where no field lets the user type (no editText field, no singleSelect with allowOther);
// - a form that points the user at something to look at (a "look through / check the page" phrase, or a file path in
//   its title, intro or labels) when neither the form nor Claude's visible text since its last ordinary tool call has a
//   clickable link (a markdown link to /C:/..., C:/... or /Users/..., or a URL) and no picture or preview was shown
//   there. Option descriptions are not scanned for it: they hold the "Checked:" reasons, which name files.
//   The link must match where the file is: Nimbalyst opens a markdown link only for a file inside the open project
//   (the nearest ancestor of the hook input's cwd with a CLAUDE.md or .git, else the cwd). A file outside it is
//   presented by its path in inline code (`~/.claude/x.md`, `C:/Users/you/x.md`) in the form or the reply text;
//   a link to it would not open.
// - a form with a recommended option, AskUserQuestion included, without its own rec-check agent call: one called since
//   the user's last message and since the last form that went through. That call is no lookup, so it can't back a
//   "Checked:". It is skipped when ~/.claude/agents/rec-check.md isn't there (an install without that agent).
// A PromptForUserInput is never refused: mend() fixes every fault above in place and tells Claude in one line
// (additionalContext) what it changed. A missing link gets a "File:" pointer in the intro; an unexplained or unshaped
// recommendation loses its "(recommended)" mark; an unbacked "Checked:" becomes "Judgment:"; a second recommended
// option in a singleSelect loses its mark; a missing rec-check or a one-option singleSelect goes out as is with a
// note. review() still lists the reasons; only AskUserQuestion is still refused.
import { emit, isMain, runHook } from "./lib/hook-io.mjs";
import { gitBashToNative, projectRoot } from "./lib/paths.mjs";
import { ru } from "./lib/ru.mjs";
// INJECTED: user text Claude Code, Nimbalyst or a hook adds on its own; it does not start a new turn
import { INJECTED } from "./lib/transcript.mjs";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";

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
const RU_POINTS = ru([
  String.raw`«(?:посмотрите|посмотри|взгляните|взгляни)\s+(?:на\s+)?(?:него|неё|нее|это|них|эти)»`,
  String.raw`«${RU_LOOK}\s+(?:на\s+)?(?:эту|этот|это|эти|мою|мой|моё|мое|мои|ваш\p{L}*|его|её|ее|их)(?:\s+[\p{L}-]+){0,2}?\s+${RU_NOUN}»`,
  String.raw`«то, что я (?:сделал|сделала|собрал|собрала|написал|написала|нарисовал|нарисовала|изменил|изменила)»`,
  String.raw`«(?:этот|мой|новый|обновл[её]нный)\s+макет»`,
].join("|"));
const RU_NOT_TO_LOOK = /(?<!\p{L})(?:из|как|(?:добавлено|записано|сохранено|скопировано|перенесено|попадут|попадёт|попадет|идут|пойдут) в)\s*[(`"'\[]?\s*$/iu;
const PATH = /(?:^|[\s(:"'`\[])((?:\/?[A-Za-z]:|~)?[\\/]?(?:[\w.\-]+[\\/])*[\w\-]+\.(?:md|html?|pdf|png|jpe?g|gif|webp|svg|mp4|docx?|xlsx?|pptx?|csv))\b/gi;
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
// A markdown link to a local file is read by its target, not its label: the label is a bare name
// ("x.md") that would resolve against the cwd.
export function pointer(input, fields) {
  const text = formText(input, fields).replace(/\[[^\]\n]*\]\(\s*<?((?!https?:)[^)\s>]+)>?\s*\)/gi, " $1 ");
  const phrase = text.match(POINTS) || text.match(RU_POINTS);
  if (phrase) return { text: phrase[0], file: false };
  const path = [...text.matchAll(PATH)].find((m) =>
    !NOTES.test(m[1]) && !NOT_TO_LOOK.test(text.slice(Math.max(0, m.index - 30), m.index + m[0].length - m[1].length)) &&
    !RU_NOT_TO_LOOK.test(text.slice(Math.max(0, m.index - 30), m.index + m[0].length - m[1].length)));
  return path ? { text: path[1], file: true } : null;
}

// Inside the open project? The project root is the nearest ancestor of cwd with a CLAUDE.md or .git, else cwd.
// Without a cwd nothing can be told, so the file counts as inside (the link rule stays as it was).
const slashed = (p) => p.replace(/\\/g, "/");
// The file's full path with forward slashes (C:/..., /Users/...); a relative one stays relative without a cwd
const absolute = (file, cwd) => {
  let t = slashed(file);
  if (t === "~" || t.startsWith("~/")) t = slashed(homedir()) + t.slice(1);
  t = gitBashToNative(t).replace(/^\/([A-Za-z]:\/)/, "$1");
  if (cwd && !/^[A-Za-z]:\//.test(t) && !t.startsWith("/")) {
    const base = gitBashToNative(slashed(cwd));
    t = slashed((/^[A-Za-z]:\//.test(base) ? win32 : posix).resolve(base, t));
  }
  return t;
};
export function outsideProject(file, cwd) {
  if (!cwd) return false;
  const norm = (p) => slashed(p).replace(/\/+$/, "").toLowerCase();
  const a = norm(absolute(file, cwd)), r = norm(projectRoot({ cwd: gitBashToNative(slashed(cwd)) }));
  return !(a === r || a.startsWith(r + "/"));
}
// What the form gets when nothing presents the file: a link Nimbalyst opens inside the project, the path in code outside it
const pointerTo = (file, cwd, outside) => {
  const t = absolute(file, cwd);
  if (outside || !/^(?:[A-Za-z]:)?\//.test(t)) return `\`${t}\``;
  return `[${t.split("/").pop()}](${/^[A-Za-z]:/.test(t) ? "/" : ""}${t.replace(/ /g, "%20")})`;
};
// A path in inline code that names the file (its name, plus a folder or ~)
const inCode = (s, file) => {
  const name = file.split(/[\\/]/).pop().toLowerCase();
  return [...s.matchAll(/`([^`\n]+)`/g)].some((m) => /[\\/~]/.test(m[1]) && m[1].toLowerCase().includes(name));
};

const REC_ASK = `This form recommends an option and no rec-check agent has looked at it: none since the user's last message, or none since the last form went through. ` +
  `The user clicks the recommended option on trust and about a third of them missed. Call the Agent tool once, in the foreground, with subagent_type "rec-check". Its prompt: the user's own words on this, ` +
  `the question, every option with its reason, and what you looked at. Act on what it says, then send the form again. Fix anything it changes; if you overrule it, say why in the reply.`;

// A form with no way to type an answer, fixed in place instead of refused: Nimbalyst draws a form as soon
// as the call starts, so a refused form stays on screen beside the corrected one and the user sees it twice.
// Each singleSelect gets allowOther: true, and a form with no field that takes typing gets an optional
// "Anything else?" box. Returns the new input, or null when nothing needed adding.
export function repair(input) {
  let fields = input?.fields;
  if (typeof fields === "string") try { fields = JSON.parse(fields); } catch { return null; }
  if (!Array.isArray(fields)) return null;
  let changed = false;
  const out = fields.map((f) => {
    if (f?.type === "singleSelect" && f.allowOther !== true) { changed = true; return { ...f, allowOther: true }; }
    return f;
  });
  if (!out.some(typeable)) {
    let id = "anythingElse";
    while (out.some((f) => f?.id === id)) id += "_";
    out.push({ type: "editText", id, label: "Anything else?", format: "plain", initialText: "", minLength: 0 });
    changed = true;
  }
  return changed ? { ...input, fields: out } : null;
}

const REC_NOTE = `the form recommends an option and no rec-check agent looked at it since the user's last message (or since the last form went through); it went out as is. ` +
  `The user clicks the recommended option on trust and about a third of them missed, so before the next recommended form call the Agent tool once, in the foreground, ` +
  `with subagent_type "rec-check" (the user's own words, the question, every option with its reason, what you looked at). If its answer would have changed this pick, tell the user in the reply.`;
const unmark = (o) => {
  const c = { ...o };
  for (const k of ["label", "title"]) if (typeof c[k] === "string") c[k] = c[k].replace(/\s*\(recommended\)/gi, "").trim();
  if (/^recommended$/i.test(String(c.badge || "").trim())) delete c.badge;
  return c;
};
const nameOf = (o) => `"${String(o?.label || o?.title || o?.id || "").replace(/\s*\(recommended\)/gi, "").trim()}"`;

// A PromptForUserInput fixed in place, never refused (a refused form stays on screen beside the resent one):
// { input: the new tool_input or null when nothing changed, notes: one line each for Claude }.
export function mend(event, seen) {
  const original = event.tool_input || {};
  let fields = original.fields;
  if (typeof fields === "string") try { fields = JSON.parse(fields); } catch { return { input: null, notes: [] }; }
  if (!Array.isArray(fields)) return { input: null, notes: [] };
  const notes = [];
  const noOther = fields.filter((f) => f?.type === "singleSelect" && f.allowOther !== true).map((f) => `"${f.label || f.id}"`);
  const fixed = repair({ ...original, fields });
  let changed = !!fixed;
  if (noOther.length) notes.push(`added allowOther: true to ${noOther.join(", ")}: the user wants to type their own answer on every choice question.`);
  if (fixed && fixed.fields.length > fields.length) notes.push(`added an optional "Anything else?" box: no field took typing (next time set allowOther: true on a singleSelect or add an editText).`);
  let input = fixed || { ...original, fields };
  let anyPick = false;
  input = { ...input, fields: input.fields.map((f) => {
    const key = f?.type === "singleSelect" ? "options" : f?.type === "multiSelect" ? "items" : null;
    if (!key || !Array.isArray(f[key])) return f;
    const name = `"${f.label || f.id}"`;
    let kept = 0;
    const dropped = [];
    const opts = f[key].map((o) => {
      if (!recommended(o)) return o;
      if (!hasReason(o) || !hasShape(o)) {
        changed = true;
        notes.push(`removed the "(recommended)" mark from ${nameOf(o)} in ${name}: its reason ${hasReason(o) ? "was not in the shape" : "was missing; the shape is"} ` +
          `"Checked: <what you looked at and what it showed>" or "Judgment: <why>", then "Other wins if: <the case for another option>". Next time write it that way, or recommend nothing.`);
        return unmark(o);
      }
      let c = o;
      if (seen && !backed(o, seen)) {
        const k = o.description ? "description" : "subtitle";
        c = { ...o, [k]: String(o[k]).replace(/(^|[^a-z])checked(\s*:)/i, "$1Judgment$2") };
        changed = true;
        notes.push(`rewrote "Checked:" to "Judgment:" on ${nameOf(o)} in ${name}: this session's record shows no tool call that touched what it names (or, naming nothing, no lookup since the user's last message). Write "Checked:" only for something really looked up.`);
      }
      if (f.type === "singleSelect" && ++kept > 1) { changed = true; dropped.push(nameOf(o)); return unmark(c); }
      anyPick = true;
      return c;
    });
    if (dropped.length) notes.push(`removed the "(recommended)" mark from ${dropped.join(", ")} in ${name}: a singleSelect recommends one option at most, so only the first kept it.`);
    if (f.type === "singleSelect" && f[key].length < 2) notes.push(`${name} has fewer than 2 options, so it asks nothing; it went out as is. Next time add the real alternative, use a confirm field for a plain yes/no, or decide it yourself.`);
    return { ...f, [key]: opts };
  }) };
  // A link in the form's own words or in the reply right before it, or a picture shown there, counts as presented
  const point = seen ? pointer(input, input.fields) : null;
  if (point) {
    const cwd = typeof event.cwd === "string" ? event.cwd : "";
    const outside = point.file && outsideProject(point.text, cwd);
    const presented = (s) => (outside ? inCode(s, point.text) : (point.file ? LOCAL_LINK : LINK).test(s));
    // A bare name ("DESIGN.md") is placed in the cwd only when it is there: elsewhere the link would be made up
    const bareMissing = point.file && !/[\\/~]/.test(point.text) && !(cwd && existsSync(absolute(point.text, cwd)));
    if (!presented(formText(input, input.fields, true)) && !presented(seen.replyText) && !seen.shown) {
      if (bareMissing) notes.push(`the form names "${point.text}" with no folder, and no such file is in the session's folder, so no link was added; it went out as is. ` +
        `Next time put the file's full path in the reply before the form: inside the open project a markdown link [name](/C:/path/to/file.md), outside it the path in inline code.`);
      else if (point.file) {
        const where = `File: ${pointerTo(point.text, cwd, outside)}`;
        input = { ...input, intro: [input.intro, where].filter((s) => typeof s === "string" && s.trim()).join("\n\n") };
        changed = true;
        notes.push(`the form points at "${point.text}" and nothing in front of the user presented it, so "${where}" was added to its intro. ` +
          `Next time put it in the reply before the form: inside the open project a markdown link [name](/C:/path/to/file.md), outside it the path in inline code.`);
      } else notes.push(`the form sends the user to look at something ("${point.text}") with no link in the form or the reply before it; it went out as is. Next time write the link (a markdown link or a web address) in the reply first.`);
    }
  }
  if (anyPick && seen?.recChecked === false && recCheckOn()) notes.push(REC_NOTE);
  return { input: changed ? input : null, notes };
}

// The reasons to refuse one call (empty when it may go through). seen = readRecord(...) or null.
// For PromptForUserInput they are counted (the replay), not sent: the main block calls mend() instead.
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

if (isMain(import.meta.url)) {
  runHook("question-other", (event) => {
    let seen = null; // no session record (or an unreadable one) lets "Checked:" and the link check through
    const needsRecord = /PromptForUserInput$|AskUserQuestion$/.test(String(event.tool_name || ""));
    try { if (needsRecord && event.transcript_path) seen = readRecord(event.transcript_path); } catch {}
    if (/PromptForUserInput$/.test(String(event.tool_name || ""))) {
      const { input, notes } = mend(event, seen);
      const out = { hookEventName: "PreToolUse" };
      if (input) Object.assign(out, { permissionDecision: "allow", updatedInput: input });
      if (notes.length) out.additionalContext = `question-other: ${notes.join(" ")}`;
      if (input || notes.length) process.stdout.write(JSON.stringify({ hookSpecificOutput: out }));
    } else {
      const parts = review(event, seen);
      if (parts.length) emit.deny(`question-other: ${parts.join(" ")}`);
    }
  });
}
