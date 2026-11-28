// brief-size: measures a helper brief the way the lead skill writes one (headings in capitals at a line start:
// FILES:, DONE WHEN:, FIXES ..., NOT:, COMMANDS:). Used by hooks/brief-size-guard.mjs.
//   files     the files named to change: path-like words in the FILES section ("FILES to change:" too), leaving out
//             its read-only parts (a sentence or ";" part that starts with the word read, look, find, see or check,
//             and what follows the word "read" inside a part); a{b,c} counts as two names, a glob as one
//   items     separate numbered items ("1." or "1)" at a line start, indented at most 3 spaces) outside DONE WHEN
//   doneWhen  DONE WHEN cases: its top-level bullet or numbered lines; with none, its ";"-separated parts (a sentence
//             wrapped over several lines is one case)
//   ownLength the brief's characters without map-brief's SYSTEMS MAP section (added after the lead wrote the brief)
// A heading: a word in capitals at a line start, maybe more capital words, a few lower-case ones and a bracket, then
// a colon ("FILES to change:", "PLAN/SPEC:", "DONE WHEN (all):")
const HEADING =
  /^\s*([A-Z][A-Z/&-]+(?: [A-Z][A-Z/&-]+)*)(?: [a-z][a-z ]{0,20}?)?(?:\s*\([^)\n]*\))?\s*:/;
const PATH =
  /(?:[\w.~%*-]+[/\\])+[\w.*-]+|\b[\w*-]+\.(?:mjs|cjs|js|ts|tsx|jsx|json|jsonc|md|ps1|sh|py|html|css|yml|yaml|toml|txt|sql)\b/g;
// A word on its own: not the start or end of a path or a name ("read-config.mjs", "lib/read.mjs" are names)
const WORD_END = "(?=[\\s:,]|$)";
const READ_ONLY = new RegExp(
  `^\\s*(?:and\\s+|also\\s+)?(?:read|reads|look|find|see|check)${WORD_END}`,
  "i",
);
const READ_CUT = new RegExp(`(?:^|\\s)(?:read|reads)${WORD_END}`, "i");

// Sections by heading; text before the first heading is under "". `head` is the heading's own text.
export function sections(brief) {
  const out = [];
  let current = { name: "", head: "", lines: [] };
  for (const line of String(brief).split(/\r?\n/)) {
    const m = line.match(HEADING);
    if (m) {
      out.push(current);
      current = { name: m[1], head: m[0], lines: [line.slice(m[0].length)] };
    } else current.lines.push(line);
  }
  out.push(current);
  return out;
}

export const ownLength = (brief) =>
  sections(brief)
    .filter((s) => s.name !== "SYSTEMS MAP" && (s.head || s.lines.length))
    .reduce((n, s) => n + s.head.length + s.lines.join("\n").length + 1, -1);

function changedFiles(text, names) {
  for (const part of text.split(/;|\.\s+|\n/)) {
    if (READ_ONLY.test(part)) continue;
    const cut = part.split(READ_CUT)[0]; // "change a.mjs, b.mjs, read c.mjs"
    const spread = cut.replace(
      /([\w./\\~-]*)\{([^{}\s]+)\}([\w.]*)/g,
      (_, head, list, end) =>
        list
          .split(",")
          .map((x) => head + x + end)
          .join(" "),
    );
    for (const m of spread.matchAll(PATH))
      names.add(m[0].replace(/\\/g, "/").replace(/^\.\//, ""));
  }
}

function doneWhenCases(text) {
  const listed = text
    .split(/\r?\n/)
    .filter((line) => /^ ?(?:[-*•]|\d+[.)])\s+\S/.test(line)).length;
  if (listed) return listed;
  return text
    .replace(/\s*\r?\n\s*/g, " ")
    .split(";")
    .filter((part) => part.trim().length > 3).length;
}

export function measure(brief) {
  const names = new Set();
  let items = 0;
  let doneWhen = 0;
  for (const s of sections(brief)) {
    const text = s.lines.join("\n");
    if (/^FILES\b/.test(s.name)) changedFiles(text, names);
    if (s.name === "DONE WHEN") doneWhen += doneWhenCases(text);
    else
      items += s.lines.filter((line) =>
        /^\s{0,3}\d+[.)]\s+\S/.test(line),
      ).length;
  }
  return { files: names.size, items, doneWhen };
}
