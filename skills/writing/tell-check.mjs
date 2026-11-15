#!/usr/bin/env node
// Marks the phrases in a draft that a script can find (tells.md has the full list and the judgement); it rewrites
// nothing. A mark is a place to look: the agent reads each one and keeps the ones that are right.
//   node tell-check.mjs <file>     the draft in the file
//   node tell-check.mjs -          the draft from stdin
// Prints one line per mark, "<line>: <strong|weak> <mark>: "<matched text>"", then "N strong, M weak (in K
// paragraphs)". A strong mark prints at one sighting; a weak note prints only when 2 or more fall in one paragraph.
// Exits 0 when no mark printed, 1 when any did, 2 when the file can't be read or holds no text.
// Left out before matching (line numbers stay): fenced code, inline code, lines starting with ">", double-quoted
// spans under 120 characters, URLs and link targets "](...)". Link text stays checked. Matching runs on each
// paragraph (blank line = new paragraph) as one text, so a phrase broken by a line wrap is still found.
// Credit: blader/humanizer 3.1.0 (MIT); conorbronsdon/avoid-ai-writing (MIT) for the two tiers and the measure of
// false hits on human text; FeedHive/ai-slop-detector for the "several in one paragraph" rule; Wikipedia's "Signs of
// AI writing". No pattern text is copied from them; the phrases come from tells.md.
import fs from "node:fs";

// A space in a pattern matches any run of spaces or one line wrap; spaces inside [...] stay as they are.
const wrapped = (src) => {
  let out = "";
  let inClass = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\") {
      out += c + src[++i];
      continue;
    }
    if (c === "[") inClass = true;
    else if (c === "]") inClass = false;
    out +=
      c === " " && !inClass
        ? /[?*+{]/.test(src[i + 1] ?? "")
          ? String.raw`\s`
          : String.raw`\s+`
        : c;
  }
  return out;
};
const rx = (flags, ...sources) =>
  sources.map((s) => new RegExp(wrapped(s), `gm${flags}`));
const r = String.raw;

const STRONG = [
  [
    "Placeholder left in",
    [
      ...rx(
        "i",
        r`\[([^\]\n]{0,30}\s)?(insert|your|add|placeholder|name|company|date|time)\b[^\]]*\](?![(\[])`,
      ),
      ...rx("", r`\bTODO\b`, r`\bTBD\b`, r`\bXX+\b`),
    ],
  ],
  [
    "Note to the user left in",
    rx(
      "i",
      r`\b(delete|remove) this (section|line|note|paragraph) before (publishing|submitting|sending)\b`,
    ),
  ],
  [
    "Chat residue",
    rx(
      "i",
      r`\bI hope this helps\b`,
      r`\blet me know if you('d| would) like\b`,
      r`\bas an AI (language )?model\b`,
      r`\bgreat question\b`,
    ),
  ],
  [
    "Process talk",
    rx(
      "i",
      r`\bwhile preserving (the )?(original |core )?(meaning|intent|voice|tone|functionality)\b`,
      r`\bfor (better )?clarity and flow\b`,
      r`\b(ensured|maintained) (consistency|the original)\b`,
      r`\bpreserv(ed|ing) the (original )?(meaning|intent|voice)\b`,
    ),
  ],
  [
    "Contrast forms",
    rx(
      "i",
      r`\b(not|isn'?t) (just|only|merely|simply) [^.;:!?]{1,60}[,;—–] ?(it's|it is)\b`,
      r`\bit's not [^.;!?]{1,50}[,;—–-]+ ?it's\b`,
      r`\bmore than (a|an|just) [^.;!?]{1,40}, it's (a|an|the)\b`,
      r`\bless like (a|an )?[^.;!?]{1,40} (and )?more like\b`,
    ),
  ],
  [
    "Corrective framing",
    rx(
      "i",
      r`\bshould be (treated|seen|read|understood) as [^.;!?]{1,60} rather than\b`,
      r`\bshould not be confused with\b`,
      r`\b(this|which|that) does not (establish|mean|imply) that\b`,
    ),
  ],
  [
    "Spelling out the meaning",
    rx(
      "i",
      r`(?<![\w,]\s+)\bthis matters\b`,
      r`(?<![\w,]\s+)\bwhy (this|it|[a-z]+) matters\b`,
      r`\bhere'?s why (this|it) matters\b`,
    ),
  ],
  [
    "Staged run-up",
    rx(
      "i",
      r`\bhere'?s the thing\b`,
      r`\bhere'?s what (nobody|no one) tells you\b`,
      r`^the result\?`,
      r`\blet that sink in\b`,
      r`^stop [^.]{1,40}\. start\b`,
    ),
  ],
  [
    "Claude 2026 phrases",
    rx(
      "i",
      r`\bload[- ]bearing\b`,
      r`\bis genuinely\b`,
      r`\b(my|one) honest (take|note|assessment)\b`,
      r`\bthe honest answer is\b`,
      r`\bbelt and suspenders\b`,
    ),
  ],
];

const WEAK = [
  [
    "Agent words",
    rx(
      "i",
      r`\bgenuinely\b`,
      r`\bquietly\b`,
      r`\bseams?\b`,
      r`\bearns? (its|their) (keep|place)\b`,
      r`\bdependable\b`,
      r`\bthe whole thing\b`,
      r`\bthe shape of\b`,
      r`\bblast radius\b`,
      r`\bdeliberately\b`,
      r`\bsmoking gun\b`,
      r`\bheavy lifting\b`,
    ),
  ],
  [
    'Contrast with "but"',
    rx("i", r`\bnot (just|only|merely|simply) [^.;:!?]{1,60}[,;]? but\b`),
  ],
  [
    "Older words",
    rx(
      "i",
      r`\bdelve\b`,
      r`\btapestry\b`,
      r`\bleverag(e|ing)\b`,
      r`\bseamless(ly)?\b`,
      r`\brobust\b`,
      r`\blandscape\b`,
      r`\bpassionate\b`,
      r`\bresults-driven\b`,
      r`\bspearheaded\b`,
    ),
  ],
  [
    "Stock openers",
    rx(
      "i",
      r`\bI hope this (email|message) finds you\b`,
      r`\bI am writing to (express|inquire)\b`,
      r`\bI'?m excited to (share|announce)\b`,
    ),
  ],
  // These stay within one line, so they are not wrapped.
  [
    "Emoji heading",
    [
      /^#{1,6}[ \t].*\p{Extended_Pictographic}/gmu,
      /^\p{Extended_Pictographic}️?[ \t]*\*\*[^*\n]+\*\*/gmu,
    ],
  ],
];
const DASH = /—|(?<=^|\s)(?:–|--)(?=\s|$)/gm;
const BOLD_BULLET = /^[-*] \*\*[^*\n]+\*\*:?/gm;
// Within one paragraph: a run of characters with no blank line in it
const SPAN = r`(?:[^\n]|\n(?![ \t]*\n))`;

const stop = (why) => {
  console.error(`tell-check: ${why}`);
  process.exit(2);
};
const file = process.argv[2];
if (!file || process.argv.length > 3)
  stop("give one file, or - for stdin: node tell-check.mjs <file>");
let input;
try {
  input = fs.readFileSync(file === "-" ? 0 : file, "utf8");
} catch (e) {
  stop(`cannot read ${file === "-" ? "stdin" : file}: ${e.message}`);
}
if (!input.trim()) stop(`no text in ${file === "-" ? "stdin" : file}`);

// Blank out what is not checked; every line keeps its place, so line numbers match the file.
const blank = (s) => s.replace(/[^\n]/g, " ");
let fence = null;
let text = input
  .replace(/\r\n?/g, "\n")
  .replace(/’/g, "'") // a curly apostrophe reads as a straight one in "it's", "here's"
  .split("\n")
  .map((line) => {
    const mark = line.match(/^ {0,3}(`{3,}|~{3,})/)?.[1];
    if (fence) {
      if (mark && mark[0] === fence[0] && mark.length >= fence.length)
        fence = null;
      return "";
    }
    if (mark) {
      fence = mark;
      return "";
    }
    return /^\s*>/.test(line) ? "" : line;
  })
  .join("\n");
for (const re of [
  new RegExp(`\`${SPAN}+?\``, "g"), // inline code
  /(?<=\]\()[^)\n]*(?=\))/g, // link target; the link text stays
  /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi, // URL
  new RegExp(`"${SPAN.replace("[^\\n]", '[^"\\n]')}{1,117}"`, "g"), // quoted span
  new RegExp(`“${SPAN.replace("[^\\n]", "[^”\\n]")}{1,117}”`, "g"),
])
  text = text.replace(re, blank);

// Paragraphs: runs of non-blank lines, each line trimmed, joined with line breaks
const paras = [];
let cur = null;
text.split("\n").forEach((line, i) => {
  const t = line.trim();
  if (!t) cur = null;
  else {
    if (!cur) paras.push((cur = { lines: [] }));
    cur.lines.push({ n: i + 1, t });
  }
});
const words = text.split(/\s+/).filter(Boolean).length;
const bullets = [...text.matchAll(BOLD_BULLET)].length;
let bulletNoted = false;

const found = (groups, joined) =>
  groups.flatMap(([mark, res]) =>
    res.flatMap((re) =>
      [...joined.matchAll(re)].map((m) => ({
        mark,
        at: m.index,
        end: m.index + m[0].length,
        text: m[0],
      })),
    ),
  );
// Leaves out a hit that overlaps one kept before it (several patterns can find one phrase)
const apart = (hits, taken) => {
  const kept = [];
  for (const h of hits.sort((a, b) => a.at - b.at || b.end - a.end))
    if (![...taken, ...kept].some((k) => h.at < k.end && k.at < h.end))
      kept.push(h);
  return kept;
};

const out = [];
let strongCount = 0;
let weakCount = 0;
let paraCount = 0;
for (const { lines } of paras) {
  const joined = lines.map((l) => l.t).join("\n");
  const starts = [];
  let next = 0;
  for (const l of lines) {
    starts.push(next);
    next += l.t.length + 1;
  }
  const lineAt = (at) => lines[starts.findLastIndex((s) => s <= at)].n;
  const strong = apart(found(STRONG, joined), []);
  const weak = apart(found(WEAK, joined), strong);
  const dashes = [...joined.matchAll(DASH)];
  if (dashes.length >= 3)
    weak.push({
      mark: "Dash habit",
      at: dashes[0].index,
      text: `${dashes.length} dashes`,
    });
  const bullet = joined.match(new RegExp(BOLD_BULLET.source, "m"));
  if (bullet && !bulletNoted && bullets >= 3 && words < 200) {
    bulletNoted = true;
    weak.push({
      mark: "Bold-label bullets in short text",
      at: bullet.index,
      text: `${bullets} bold-label bullets`,
    });
  }
  const shown = [
    ...strong.map((h) => ({ ...h, kind: "strong" })),
    ...(new Set(weak.map((h) => h.text.toLowerCase())).size >= 2
      ? weak.map((h) => ({ ...h, kind: "weak" }))
      : []),
  ].sort((a, b) => a.at - b.at);
  if (!shown.length) continue;
  paraCount++;
  strongCount += strong.length;
  weakCount += shown.length - strong.length;
  for (const h of shown)
    out.push(
      `${lineAt(h.at)}: ${h.kind} ${h.mark}: "${h.text.replace(/\s+/g, " ")}"`,
    );
}
for (const line of out) console.log(line);
console.log(
  `${strongCount} strong, ${weakCount} weak (in ${paraCount} paragraphs)`,
);
process.exit(out.length ? 1 : 0);
