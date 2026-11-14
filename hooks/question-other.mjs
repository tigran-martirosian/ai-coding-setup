#!/usr/bin/env node
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix, win32 } from "node:path";
// question-other: PreToolUse hook for Nimbalyst's PromptForUserInput (and both AskUserQuestion tools). The user wants to type their own answer on every
// question, so every singleSelect sets allowOther: true, every multiSelect is followed right away by an editText
// (Nimbalyst drops allowOther on a multiSelect), and a confirm or reorder field needs an editText in the form.
// QUESTION_OTHER=off disables it. It fails open.
//
// It refuses two kinds of card (user, 2026-11-13); a refusal starts with the fixed marker [card-refused], which the
// Nimbalyst card-refused patch looks for to hide the dead card:
// - labels the user never used: a plan-row id (B6, WT2-WT4) or a single-letter name ("helper K") anywhere on the
//   card that the user's last typed message doesn't use. A handoff prompt ("Read …/.claude/handoffs/x.md and continue")
//   and a compaction summary are Claude's own text, so their labels don't count as the user's;
//   A label listed in the project's .claude/card-labels.txt (a game tier, a key, a product code) is never a fault;
// - a status or nag card that asks no decision ("Are you still sorting the photos?", "Will you send them now?").
// A card with both gets the nag text alone: it is not to be sent again. At most 2 refusals in a row (since the user's
// last typed message; a card that went through ends the run): the third faulty card goes through with a note and no
// marker, and one line in ~/.claude/hooks/state/question-other/let-through.log, so a refusal with no exit can't loop.
// With no readable session record the run can't be counted, so a faulty card goes through with a note.
// Every other fault lets it through with a note (additionalContext) telling Claude to get it right next time and,
// where it could change the answer, to say so in the reply: an updatedInput never reaches the screen (live test
// 2026-11-09). The faults with a note:
// - a question with no box to type in (above): the reply after the answer names it and invites a typed change;
// - a form that points the user at something to look at (a "look through / check the page" phrase, or a file path in
//   its title, intro or labels) when neither the form nor Claude's visible text since its last ordinary tool call has a
//   clickable link (a markdown link to /C:/..., C:/... or /Users/..., or a URL) and no picture or preview was shown
//   there. Option descriptions are not scanned for it: they hold the reasons for an option, which often name files.
//   The link must match where the file is: Nimbalyst opens a markdown link only for a file inside the open project
//   (the nearest ancestor of the hook input's cwd with a CLAUDE.md or .git, else the cwd). A file outside it is
//   presented by its path in inline code (`~/.claude/x.md`, `C:/Users/you/x.md`) in the form or the reply text;
//   a link to it would not open.
// - a singleSelect with more than one recommended option (marked "(recommended)" or with the badge "recommended"),
//   or with fewer than 2 options.
import { emit, isMain, runHook } from "./lib/hook-io.mjs";
import { gitBashToNative, projectRoot } from "./lib/paths.mjs";
import { ru } from "./lib/ru.mjs";
import { STATE_DIR } from "./lib/state.mjs";
// INJECTED: user text Claude Code, Nimbalyst or a hook adds on its own; it does not start a new turn
import { INJECTED } from "./lib/transcript.mjs";

// Never change it: the card-refused patch hides a card whose result contains it
export const MARKER = "[card-refused]";
export const MAX_REFUSALS = 2;
// A continued session's first message: Claude's handoff wrote it, the user only sent it
const HANDOFF = /^Read \S*[\\/]\.claude[\\/]handoffs[\\/]\S+\.md and continue/;

const recommended = (o) =>
  o &&
  (/\(recommended\)/i.test(`${o.label || ""} ${o.title || ""}`) ||
    /^recommended$/i.test(String(o.badge || "").trim()));

const FORM = /PromptForUserInput|AskUserQuestion/;
const SHOWN =
  /display_to_user|capture_editor_screenshot|browser_open_local_preview/; // put a picture or page in front of the user
// Bookkeeping calls change nothing the user sees, so a link written just before them still counts
const QUIET =
  /update_session_meta|update_session_board|^Task(Create|Update|List|Get)$|^TodoWrite$|^ToolSearch$/;
export const readRecord = (file) =>
  recordFrom(readFileSync(file, "utf8").split("\n"));
export function recordFrom(lines) {
  // replyText / shown: what the user has in front of them right before the form, i.e. the text and
  // pictures since the last ordinary tool call (an old research URL earlier in the turn doesn't count)
  // asked: the user's last typed message, whose words a card may use without explaining them ("" after a handoff prompt)
  // refusedRun: the card refusals in a row since then; a card that went through ends the run
  let replyText = "",
    shown = false,
    asked = "",
    refusedRun = 0;
  const cards = new Set();
  for (const line of lines) {
    let e;
    try {
      e = JSON.parse(line);
    } catch {
      continue;
    }
    if (!e || e.isSidechain) continue;
    const content = e.message?.content;
    const blocks = Array.isArray(content) ? content : [];
    // A compaction summary is Claude Code's text, not the user's: it neither exempts labels nor ends a run
    if (e.type === "user" && !e.isMeta && !e.isCompactSummary) {
      const said =
        typeof content === "string"
          ? content
          : blocks
              .map((b) => (b?.type === "text" ? b.text || "" : ""))
              .join("\n");
      const typed =
        (typeof content === "string" ||
          (blocks.some((b) => b?.type === "text") &&
            !blocks.some((b) => b?.type === "tool_result"))) &&
        !INJECTED.test(said) &&
        e.origin?.kind !== "task-notification";
      if (typed) {
        replyText = "";
        shown = false;
        asked = HANDOFF.test(said.trim()) ? "" : said;
        refusedRun = 0;
      }
    }
    for (const b of blocks) {
      // A refusal is an error result holding the marker; an answer that quotes the marker is no refusal
      if (
        e.type === "user" &&
        b?.type === "tool_result" &&
        cards.has(b.tool_use_id)
      )
        refusedRun =
          b.is_error && JSON.stringify(b.content ?? "").includes(MARKER)
            ? refusedRun + 1
            : 0;
      if (
        e.type === "assistant" &&
        b?.type === "tool_use" &&
        FORM.test(b.name || "")
      )
        cards.add(b.id);
      if (e.type === "assistant" && b?.type === "text")
        replyText += `\n${b.text || ""}`;
      if (e.type === "assistant" && b?.type === "tool_use") {
        if (SHOWN.test(b.name || "")) shown = true;
        else if (!FORM.test(b.name || "") && !QUIET.test(b.name || "")) {
          replyText = "";
          shown = false;
        }
      }
    }
  }
  return { replyText, shown, asked, refusedRun };
}

// A plan-row id (B6, S7, C-2, WT2-WT4, BH0c): 1-3 capitals, an optional hyphen, 1-3 digits, an optional small
// letter, an optional range. Common names of that shape (file formats, codecs, paper sizes, quarters, consoles,
// storage services, text encodings, hashes, chips, HTML headings) are not ids.
const ROW_ID =
  /(?<![\w.-])[A-Z]{1,3}-?\d{1,3}[a-z]?(?:-[A-Z]{1,3}-?\d{1,3}[a-z]?)?(?![\w-]|\.\w)/g; // a full stop ends a sentence; "A4.pdf" is a file
const COMMON_ID =
  /^(?:MP[34]|M4[AV]|H26[45]|AV1|VP[89]|A[3-6]|Q[1-4]|PS[2-5]|X11|CSS3|K8s|GPT-?\d|S3|B2|R2|UTF-?(?:8|16|32)|SHA-?(?:1|256|384|512)|AES-?(?:128|192|256)|M[1-4]|H[1-6])$/;
export const rowIds = (text, asked = "") =>
  [...new Set(String(text).match(ROW_ID) || [])].filter(
    (id) =>
      !COMMON_ID.test(id.replace(/s$/, "")) && // "MP3s" is a plural, not an id
      !new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(asked),
  );
// Everything on a card the user reads: titles, questions, option labels and the line under each option
const askText = (questions) =>
  questions
    .flatMap((q) => [
      q?.header,
      q?.question,
      ...(Array.isArray(q?.options) ? q.options : []).flatMap((o) => [
        o?.label,
        o?.description,
      ]),
    ])
    .filter((s) => typeof s === "string")
    .join("\n");
// A single-letter name ("helper K"): a capital other than A and I (they are words) alone right after one of these
// nouns (small or capital first letter; the letter itself must be a capital, so "tab n" is none). Let through when the
// letter is an option's own label on the card ("B", "B: whole passage", "Option B") or the user's last typed message
// uses it as a word.
const LETTER_NAME = new RegExp(
  String.raw`\b(${"session|chat|child|helper|worker|agent|subagent|tab|thread|window|pane|instance"
    .split("|")
    .map((w) => `[${w[0]}${w[0].toUpperCase()}]${w.slice(1)}`)
    .join("|")})\s+([B-HJ-Z])(?!\w|[-:\/\\&+#]|['’](?!s\b)|\.\w)`,
  "g",
);
const OPTION_LETTER = /^\s*(?:[Oo]ption\s+)?([A-Z])(?![\w'’])/;
export const letterNames = (text, optionLabels = [], asked = "") => {
  const own = new Set(
    optionLabels
      .map((l) => String(l).match(OPTION_LETTER)?.[1])
      .filter(Boolean),
  );
  return [
    ...new Set(
      [...String(text).matchAll(LETTER_NAME)]
        .filter(
          (m) =>
            !own.has(m[2]) &&
            !new RegExp(`(?<![\\w-])${m[2]}(?![\\w-])`).test(asked),
        )
        .map((m) => m[0]),
    ),
  ];
};
// A status or nag question: whether the user is still doing, has done or will now do their own part. Not "Should I
// run it now?" (Claude's own action), "Are you (still) happy with it?" (a judgement) or "Are you ready for me to post
// it?" (a go-ahead).
const OK = String.raw`(?!(?:be |feel )?(?:ok|okay|fine|happy|sure|good|comfortable|alright|willing|able|want|prefer|like|mean|meant|rather|agree)\b)`;
const NAG = new RegExp(
  [
    String.raw`\b(?:are|were) you (?:still ${OK}|done\b|finished\b)`,
    String.raw`\b(?:have|did|has) you ${OK}[^.?!]*\b(?:yet|already|had a chance|finished|done)\b`,
    String.raw`\bwill you ${OK}[^.?!]*\bnow\b`,
  ].join("|"),
  "i",
);
export const nagQuestion = (texts) =>
  texts.find((s) => typeof s === "string" && NAG.test(s)) || null;
const idNote = (ids) =>
  `The card shows labels the user didn't use (${ids.join(", ")}). Explain each in plain words or leave it out: ` +
  `the user reads the card without the plan in front of them. Every item and the line under it says in full words what it is and ` +
  `what changes, never shorthand copied from a list ("One action, two outcomes" told the user nothing).`;
const nagNote = (q) =>
  `The card asks no decision ("${q}" asks whether the user is still doing, has done or will now do their own part). ` +
  `Next time write the state in one line in the reply and end the turn; the earlier question stays open until the user answers.`;
export const idRefusal = (labels) =>
  `${MARKER} question-other refused this card: it shows labels the user never used (${labels.join(", ")}). ` +
  `Send it again with each label replaced by what the thing is, in plain words. If you cannot say what it is, leave it out.`;
export const NAG_REFUSAL =
  `${MARKER} question-other refused this card: it asks no decision. Do not send it again. ` +
  `Write the state in one line in your reply and end the turn. The earlier question stays open until the user answers.`;

// The questions without a box to type in: a singleSelect without allowOther, a multiSelect not followed right away
// by an editText, and a confirm or reorder field in a form with no editText at all
export function untypeable(fields) {
  const hasText = fields.some((f) => f?.type === "editText");
  const out = [];
  fields.forEach((f, i) => {
    if (!f) return;
    const name = `"${f.label || f.id}"`;
    if (f.type === "singleSelect" && f.allowOther !== true) out.push(name);
    else if (f.type === "multiSelect" && fields[i + 1]?.type !== "editText")
      out.push(name);
    else if ((f.type === "confirm" || f.type === "reorder") && !hasText)
      out.push(name);
  });
  return out;
}

// Words that send the user to look at something. Bare nouns ("page", "file") are left out on purpose:
// on real forms they mostly name a shop's page or a source, not something Claude made.
const NOUN = `(?:page|file|doc|document|draft|mockup|preview|picture|photo|image|screenshot|report|video|version|layout|site|html)s?`;
const POINTS = new RegExp(
  [
    String.raw`\b(?:look|looking|glance) (?:through|at|over) (?:it|this|them|these)\b`, // not "look at the buyer"
    String.raw`\b(?:open|check|see|read|review|try|test|scroll|browse|go through|look through|look at|look over) (?:the|this|my|it|them|your)(?:\s+[\w-]+){0,2}?\s+${NOUN}\b`,
    String.raw`\bwhat I(?:'ve| have)? (?:built|made|wrote|drew|changed|put together)\b`,
    String.raw`\b(?:the|this|my) (?:new |updated |first )?mockups?\b`, // not "draft" or "preview": often inside the form or not made yet
  ].join("|"),
  "i",
); // not "looks right?" or "take a look": often about a plan written in the chat itself
// Russian twins of POINTS and NOT_TO_LOOK (`--language russian`). \b does not see Cyrillic: u flag and lookarounds.
const RU_NOUN = String.raw`(?:страниц\p{L}*|файл\p{L}*|документ\p{L}*|черновик\p{L}*|макет\p{L}*|превью|картинк\p{L}*|фото\p{L}*|изображени\p{L}*|скриншот\p{L}*|отч[её]т\p{L}*|видео|верси\p{L}*|сайт\p{L}*|html)`;
const RU_LOOK = `(?:посмотрите|посмотри|взгляните|взгляни|откройте|открой|проверьте|проверь|прочитайте|прочти|просмотрите|просмотри|пролистайте|пролистай|ознакомьтесь с|протестируйте|протестируй|попробуйте|попробуй)`;
const RU_POINTS = ru(
  [
    String.raw`«(?:посмотрите|посмотри|взгляните|взгляни)\s+(?:на\s+)?(?:него|неё|нее|это|них|эти)»`,
    String.raw`«${RU_LOOK}\s+(?:на\s+)?(?:эту|этот|это|эти|мою|мой|моё|мое|мои|ваш\p{L}*|его|её|ее|их)(?:\s+[\p{L}-]+){0,2}?\s+${RU_NOUN}»`,
    `«то, что я (?:сделал|сделала|собрал|собрала|написал|написала|нарисовал|нарисовала|изменил|изменила)»`,
    String.raw`«(?:этот|мой|новый|обновл[её]нный)\s+макет»`,
  ].join("|"),
);
const RU_NOT_TO_LOOK =
  /(?<!\p{L})(?:из|как|(?:добавлено|записано|сохранено|скопировано|перенесено|попадут|попадёт|попадет|идут|пойдут) в)\s*[(`"'[]?\s*$/iu;
const PATH =
  /(?:^|[\s(:"'`[])((?:\/?[A-Za-z]:|~)?[\\/]?(?:[\w.-]+[\\/])*[\w-]+\.(?:md|html?|pdf|png|jpe?g|gif|webp|svg|mp4|docx?|xlsx?|pptx?|csv))\b/gi;
const NOTES = /(?:^|[\\/])(?:decisions|claude|handoff|memory)(?:\.md$|[\\/])/i; // where answers get written, not something to look at
// "goes into x.md", "added to x.md", "save it as `x.png`", "counts are from x.xlsx"
const NOT_TO_LOOK =
  /\b(?:into|(?:added|written|saved|copied|moved|appended) to|as|from)\s*[(`"'[]?\s*$/i;
// Links Nimbalyst's chat opens: an absolute local path with forward slashes (/C:/..., or /Users/... on
// a Mac), or a web address
const LOCAL_LINK = /\]\(\s*<?(?:\/?[A-Za-z]:\/|\/(?![/\\]|[A-Za-z]\/))[^)]*\)/; // not //host or Git Bash's /c/...
const WEB_LINK = /https?:\/\/[^\s)]+/i;
export const LINK = new RegExp(`${LOCAL_LINK.source}|${WEB_LINK.source}`, "i");
// The form's own words; option descriptions hold the reasons for an option, which often name files, so they are left out
const formText = (input, fields, withDrafts = false) => {
  const out = [input.title, input.intro];
  for (const f of fields) {
    if (!f) continue;
    out.push(f.label, f.description);
    if (withDrafts) out.push(f.initialText);
    for (const o of [
      ...(Array.isArray(f.options) ? f.options : []),
      ...(Array.isArray(f.items) ? f.items : []),
    ])
      out.push(o?.label, o?.title);
  }
  return out.filter((s) => typeof s === "string").join("\n");
};
// What in the form sends the user to look at something: { text, file } (file: a local path), or null
// A markdown link to a local file is read by its target, not its label: the label is a bare name
// ("x.md") that would resolve against the cwd.
export function pointer(input, fields) {
  const text = formText(input, fields).replace(
    /\[[^\]\n]*\]\(\s*<?((?!https?:)[^)\s>]+)>?\s*\)/gi,
    " $1 ",
  );
  const phrase = text.match(POINTS) || text.match(RU_POINTS);
  if (phrase) return { text: phrase[0], file: false };
  const path = [...text.matchAll(PATH)].find(
    (m) =>
      !NOTES.test(m[1]) &&
      !NOT_TO_LOOK.test(
        text.slice(
          Math.max(0, m.index - 30),
          m.index + m[0].length - m[1].length,
        ),
      ) &&
      !RU_NOT_TO_LOOK.test(
        text.slice(
          Math.max(0, m.index - 30),
          m.index + m[0].length - m[1].length,
        ),
      ),
  );
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
  const a = norm(absolute(file, cwd)),
    r = norm(projectRoot({ cwd: gitBashToNative(slashed(cwd)) }));
  return !(a === r || a.startsWith(r + "/"));
}
// A path in inline code that names the file (its name, plus a folder or ~)
const inCode = (s, file) => {
  const name = file.split(/[\\/]/).pop().toLowerCase();
  return [...s.matchAll(/`([^`\n]+)`/g)].some(
    (m) => /[\\/~]/.test(m[1]) && m[1].toLowerCase().includes(name),
  );
};

// A form's fields, or null when they can't be read
const fieldsOf = (input) => {
  let fields = input.fields;
  if (typeof fields === "string")
    try {
      fields = JSON.parse(fields);
    } catch {
      return null;
    }
  return Array.isArray(fields) ? fields : null;
};
const OWN_NUMBER = /^\s*([A-Z]{1,3}-?\d{1,3}[a-z]?)\.\s/;
// A range of two ids, as ROW_ID finds it: "WT2-WT4" -> WT2, WT4 ("C-2" is one id)
const RANGE = /^([A-Z]{1,3}-?\d{1,3}[a-z]?)-([A-Z]{1,3}-?\d{1,3}[a-z]?)$/;
// A project's own labels the user knows (game tiers, keys, product codes): <project>/.claude/card-labels.txt, one
// label per line (exact, case-sensitive: T3) or /regex/ for a family (/T[1-5]/, matched whole); # comment lines,
// a # comment after a space at the end of a line and blank lines are skipped. A listed label is never a label fault,
// and a range (WT2-WT4) is listed when each of its parts is. No file is no list; a bad regex line is skipped and
// named in the note.
export const NO_LIST = { has: () => false, bad: [] };
export function readLabels(root) {
  let text;
  try {
    text = readFileSync(join(root, ".claude", "card-labels.txt"), "utf8");
  } catch (err) {
    if (err.code === "ENOENT") return NO_LIST;
    throw err;
  }
  const exact = new Set(),
    families = [],
    bad = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(/(?:^|\s)#.*$/, "").trim();
    if (!line) return;
    const re = line.match(/^\/(.+)\/$/);
    if (!re) return void exact.add(line);
    try {
      families.push(new RegExp(`^(?:${re[1]})$`));
    } catch {
      bad.push(`line ${i + 1} "${line}"`);
    }
  });
  const one = (l) => exact.has(l) || families.some((f) => f.test(l));
  const range = (l) => l.match(RANGE)?.slice(1);
  // "worker L" is listed when "L" is; "WT2-WT4" when "WT2" and "WT4" are
  return {
    has: (l) =>
      one(l) || one(l.replace(/^\S+\s+/, "")) || !!range(l)?.every(one),
    bad,
  };
}
const badNote = (bad) =>
  `.claude/card-labels.txt has lines that are no valid regex, so they were skipped: ${bad.join(", ")}. Fix them.`;
const optionsOf = (f) => [
  ...(Array.isArray(f?.options) ? f.options : []),
  ...(Array.isArray(f?.items) ? f.items : []),
];
// The faults a card is refused for: { labels: ids and letter names the user never used, nag: the question that asks
// no decision, or null }. Labels are looked for in every word on the card, the lines under the options and items too;
// the nag only in the questions (a form's title and field labels), not in option lines.
export function cardFaults(event, seen, list = NO_LIST) {
  const tool = String(event.tool_name || "");
  const asked = seen?.asked || "";
  let text, optionLabels, questions;
  if (/AskUserQuestion$/.test(tool)) {
    const qs = Array.isArray(event.tool_input?.questions)
      ? event.tool_input.questions
      : [];
    text = askText(qs);
    optionLabels = qs.flatMap((q) =>
      (Array.isArray(q?.options) ? q.options : []).map((o) => o?.label),
    );
    questions = qs.map((q) => q?.question);
  } else if (tool.endsWith("PromptForUserInput")) {
    const input = event.tool_input || {};
    const fields = fieldsOf(input);
    if (!fields) return { labels: [], nag: null };
    const subLines = fields
      .flatMap((f) =>
        optionsOf(f).flatMap((o) => [o?.description, o?.subtitle]),
      )
      .filter((s) => typeof s === "string");
    text = [formText(input, fields), ...subLines].join("\n");
    optionLabels = fields.flatMap((f) =>
      optionsOf(f).flatMap((o) => [o?.label, o?.title]),
    );
    questions = [input.title, ...fields.map((f) => f?.label)];
  } else return { labels: [], nag: null };
  // The card's own numbering ("Q8. How many releases?") is defined right there, so the user knows it
  const own = questions
    .map((q) => (typeof q === "string" ? q.match(OWN_NUMBER)?.[1] : null))
    .filter(Boolean);
  return {
    labels: [
      ...rowIds(text, asked).filter((id) => !own.includes(id)),
      ...letterNames(
        text,
        optionLabels.filter((l) => typeof l === "string"),
        asked,
      ),
    ].filter((l) => !list.has(l)),
    nag: nagQuestion(questions),
  };
}

// One call's faults: a list of notes for Claude, used when the card goes out. seen = readRecord(...) or null.
export function review(event, seen, list = NO_LIST) {
  const tool = String(event.tool_name || "");
  const { labels, nag } = cardFaults(event, seen, list);
  const cardNotes = [
    ...(labels.length ? [idNote(labels)] : []),
    ...(nag ? [nagNote(nag)] : []),
    ...(list.bad.length ? [badNote(list.bad)] : []),
  ];
  // Nimbalyst's own question card has a typing box on every question
  if (/AskUserQuestion$/.test(tool)) return cardNotes;
  if (!tool.endsWith("PromptForUserInput")) return [];
  const input = event.tool_input || {};
  const fields = fieldsOf(input);
  if (!fields) return [];
  const noBox = untypeable(fields);
  const twoRecommended = [],
    oneOption = [];
  for (const f of fields) {
    if (!f || f.type !== "singleSelect" || !Array.isArray(f.options)) continue;
    const name = `"${f.label || f.id}"`;
    if (f.options.length < 2) oneOption.push(name);
    if (f.options.filter(recommended).length > 1) twoRecommended.push(name);
  }
  const parts = [];
  if (noBox.length)
    parts.push(
      `${noBox.join(", ")} has no box where the user can type their own answer, and the user wants one on every question. ` +
        `The form is on screen as sent (a refusal can't take it back), so in the reply after the answer name it and invite a typed change: ` +
        `"The form's ${noBox[0]} had no box to type in; write here if you want something other than the options." ` +
        `On the next form, a plain choice (single or multi pick) goes on mcp__nimbalyst__AskUserQuestion, whose card has a typing box on every question. ` +
        `Keep PromptForUserInput only for a draft to edit, a reorder or many fields, and then: allowOther: true on each singleSelect, an optional editText ` +
        `("Other (optional)", minLength 0) right after each multiSelect, and an optional "Anything else?" editText when only confirm or reorder fields remain.`,
    );
  parts.push(...cardNotes);
  // A link in the form's own words or in the reply right before it, or a picture shown there, counts as
  // presented. A local file needs a local link: a web address does not open it.
  const point = pointer(input, fields);
  const outside =
    !!point?.file &&
    outsideProject(point.text, typeof event.cwd === "string" ? event.cwd : "");
  const presented = (s) =>
    outside ? inCode(s, point.text) : (point.file ? LOCAL_LINK : LINK).test(s);
  if (
    point &&
    seen &&
    !presented(formText(input, fields, true)) &&
    !presented(seen.replyText) &&
    !seen.shown
  )
    parts.push(
      outside
        ? `This form sends the user to look at a file ("${point.text}") that is outside the open project, and neither the form nor the reply text right before it names its path in code. ` +
            `Nimbalyst opens a markdown link only for a file inside the open project (a file inside the project: a markdown link; outside it: its path in code), so a link would not open. ` +
            `Write the path in inline code in the reply text (\`~/.claude/skills/x/SKILL.md\` or \`C:/Users/you/x.md\`), with what you wrote, what you think of it and what you recommend.`
        : `This form sends the user to look at something ("${point.text}"), but neither the form nor the reply text right before it has a clickable link to it, ` +
            `so the user cannot find it. Write it in the reply text: what you built or wrote, as a markdown link ` +
            `([name](/C:/path/to/file.md): forward slashes, no file:///, no backslashes; or a web address for a site), what you think of it and what you recommend. ` +
            `(A file inside the project: a markdown link; outside it: its path in code.)`,
    );
  if (twoRecommended.length)
    parts.push(
      `${twoRecommended.join(", ")} marks more than one option as recommended. Recommend one, or none.`,
    );
  if (oneOption.length)
    parts.push(
      `${oneOption.join(", ")} has fewer than 2 options, so it asks nothing. Add the real alternative, or use a confirm field if it is a plain yes/no, or decide it yourself and say so.`,
    );
  return parts;
}

if (isMain(import.meta.url)) {
  runHook("question-other", (event) => {
    let seen = null; // no session record (or an unreadable one) lets the link check through
    const needsRecord = /PromptForUserInput$|AskUserQuestion$/.test(
      String(event.tool_name || ""),
    );
    try {
      if (needsRecord && event.transcript_path)
        seen = readRecord(event.transcript_path);
    } catch {}
    // Labels the user never used and a card that asks no decision are refused (the card-refused patch hides the
    // dead card), at most MAX_REFUSALS times in a row; every other fault goes to Claude as a note. With no readable
    // record neither the run nor the user's words are known, so the card goes through with a note.
    // The project: CLAUDE_PROJECT_DIR, else the nearest folder at or above the cwd with a CLAUDE.md or .git
    const list = needsRecord ? readLabels(projectRoot(event)) : NO_LIST;
    const { labels, nag } = cardFaults(event, seen, list);
    const faulty = labels.length > 0 || !!nag;
    if (faulty && seen && seen.refusedRun < MAX_REFUSALS) {
      emit.deny(
        (nag ? NAG_REFUSAL : idRefusal(labels)) +
          (list.bad.length ? ` ${badNote(list.bad)}` : ""),
      );
      return;
    }
    const parts = review(event, seen, list);
    if (parts.length)
      emit.context(
        "PreToolUse",
        `question-other: this form went out as is` +
          (!faulty
            ? ""
            : seen
              ? ` (${MAX_REFUSALS} refusals in a row already; another could loop)`
              : " (no session record to count refusals by, so it was not refused)") +
          `. Get these right on the next form; where one could change the user's answer (a question with no typing box, a missing link), ` +
          `tell the user in your reply after the answer. Its faults: ${parts.join(" ")}`,
      );
    if (faulty && seen) {
      const file = join(STATE_DIR, "question-other", "let-through.log");
      mkdirSync(join(STATE_DIR, "question-other"), { recursive: true });
      appendFileSync(
        file,
        `${new Date().toISOString()} ${event.session_id || "-"} ${event.tool_name}: ` +
          `let through after ${MAX_REFUSALS} refusals; ${nag ? `asks no decision: ${nag}` : `labels: ${labels.join(", ")}`}\n`,
      );
    }
  });
}
