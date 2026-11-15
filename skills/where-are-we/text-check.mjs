#!/usr/bin/env node
// Finds the marks a tracker text must not hold (tracker-texts.md, "Marks a script can find"): commit hashes, session
// ids, row codes, file paths, commands in backticks, plan labels and DECISIONS references.
//   node text-check.mjs [<file>]          one text, from the file or from stdin
//   node text-check.mjs --json [<file>]   many texts: a JSON array of {"name": "...", "text": "..."}, from the file or
//                                         from stdin; each mark line starts with the name of the text it is in, and a
//                                         last line counts the texts with marks
// Prints one line per mark found, "<mark>: <the text>", and exits 1 when there is any; prints "no marks" and exits 0
// when there is none. No text, or input that can't be read, stops it with exit 2.
// Links (https://…) are left out, and a row code counts only beside a word that marks it as one ("row R1", "look W4",
// "T3:", "T7, T8"), so names such as S3, MP4 or GPT4 standing alone pass. "no marks" does not clear test counts, call
// counts or process words: the rules file says what else a text must not hold.
import fs from "node:fs";

const CODE = String.raw`(?:[A-Z]{1,3}\d{1,2}[a-z]?)`;
const MARKS = [
  [
    "commit hash",
    /(?<![Ss]ession )\b(?=[0-9a-f]*\d)(?=[0-9a-f]*[a-f])[0-9a-f]{7,40}\b/g,
  ],
  [
    "session id",
    /\bsession [0-9a-f]{8}\b|\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  ],
  [
    "row code",
    new RegExp(
      [
        // after a word that names a row: "row R1", "after L4", "look W4", "build T1"
        String.raw`(?<=\b(?:[Rr]ows?|[Ss]teps?|[Aa]fter|[Bb]efore|[Ll]ook|[Pp]ipe|[Bb]uild|[Ww]ave) )${CODE}\b`,
        // a title prefix or a label: "T3: …"
        String.raw`\b${CODE}(?=:)`,
        // a list of two or more codes: "T7, T8", "S1/S2"
        String.raw`\b${CODE}(?=(?:, ?|\/)${CODE}\b)`,
        String.raw`(?<=\b${CODE}(?:, ?|\/))${CODE}\b`,
        String.raw`\bOK-[A-Z]+\d*[a-z]?\b`,
      ].join("|"),
      "g",
    ),
  ],
  [
    "file path",
    // a capitalized name before .js is a library (Next.js, Node.js), not a file
    /(?:<\w+>|~|\b[\w.-]+)?[/\\][\w.<>{},/\\-]*\.\w{1,5}\b|\b(?![A-Z][a-z]+\.js\b)[\w-]+\.(?:md|mjs|js|json|ya?ml|ts|tsx|html|txt)\b/g,
  ],
  ["command", /`[^`]+`/g],
  [
    "plan label",
    /\*\*(?:Serves|Done when|Stage|Helper|Runs|Proof):\*\*|^(?:[-*] )?(?:Serves|Done when|Plan|Proof):/gm,
  ],
  // a title only "Your OK:" or "Your word:" may start for the user
  ["user prefix", /^You:/gm],
  ["DECISIONS reference", /\(DECISIONS \d{4}-\d{2}-\d{2}\)/g],
];
const LINK = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;

// The marks in one text, as "<mark>: <found>" lines
const marksIn = (text) => {
  const t = text.replace(LINK, " ");
  return MARKS.flatMap(([name, re]) =>
    [...t.matchAll(re)].map((m) => `${name}: ${m[0]}`),
  );
};

const stop = (why) => {
  console.error(`text-check: ${why}`);
  process.exit(2);
};
const args = process.argv.slice(2);
const json = args.includes("--json");
const file = args.find((a) => a !== "--json");
let input;
try {
  input = file ? fs.readFileSync(file, "utf8") : fs.readFileSync(0, "utf8");
} catch (e) {
  stop(`cannot read ${file || "stdin"}: ${e.message}`);
}
if (!input.trim()) stop("no text given");

if (!json) {
  const found = marksIn(input);
  console.log(found.length ? found.join("\n") : "no marks");
  process.exit(found.length ? 1 : 0);
}
let texts;
try {
  texts = JSON.parse(input);
} catch (e) {
  stop(`the input is not JSON: ${e.message}`);
}
if (
  !Array.isArray(texts) ||
  !texts.length ||
  texts.some((t) => typeof t?.name !== "string" || typeof t?.text !== "string")
)
  stop('give a JSON array of {"name": "...", "text": "..."}');
let flagged = 0;
for (const { name, text } of texts) {
  const found = marksIn(text);
  if (found.length) flagged++;
  for (const f of found) console.log(`${name}: ${f}`);
}
console.log(
  flagged
    ? `${flagged} of ${texts.length} texts have marks`
    : `no marks in ${texts.length} texts`,
);
process.exit(flagged ? 1 : 0);
