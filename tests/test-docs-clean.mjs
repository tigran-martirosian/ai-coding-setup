// The public text stays clean and the README stays short (D1 and D2 of docs/2026-11-26-public-repo-text-spec.md in
// the setup's own folder).
// D1: no markdown file git ships (tracked or new and not ignored; tests/, .proof/ and audits/ aside) holds a word
// from WORDS, an author pronoun from PRONOUNS, or a name from .privacy-words, and no relative link, image or #anchor
// in one points at nothing. D2: README.md is at most README_WORDS words counted as `wc -w` counts them, its first
// TOP_LINES lines hold a one-sentence pitch, a link row, the video and at most TOP_BULLETS bullets, and its install,
// requirements and platforms headings come before the first feature heading, with an uninstall heading somewhere.
// Run: node tests/test-docs-clean.mjs
// The names in .privacy-words (one per line, git ignores the file) are read as scripts/privacy-check.mjs reads them
// and are never printed: a hit names the file and line only. Without the file (CI) that part is skipped.
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Words that are personal or internal anywhere in a shipped page, code blocks included. Each hit fails.
const WORDS = [
  ["monster", /\bmonsters?\b/gi],
  ["mob", /\bmobs?\b/gi],
  ["damage balance", /\bdamage balance\b/gi],
  ["ebay", /\bebay\b/gi],
  // a game's name, split here because it is also a private word that scripts/privacy-check.mjs refuses in any file
  ["pri-mal (a game's name)", /\bpri[m]al\b/gi],
  ["setup rebuild", /\bsetup[- ]rebuild\b/gi],
  // "58 were found left over on 2026-11-19": an incident note with its date
  ["dated incident note", /\bfound\b[^.\n]{0,100}?\bon 20\d\d-\d\d-\d\d/gi],
];
// Author pronouns. They are read outside the front matter, fenced code, `inline code`, **bold text** (screen labels
// such as **My Settings**), link targets, web addresses, "quoted text" and > quoted lines, so an example of what a
// user types does not count. "I/O", a letter I ("heading I"), the "grill me" command and placeholder names such as
// my-app or my_file are not pronouns. CHANGELOG.md may say I/me/my.
const PRONOUNS = [
  [
    "first person (I/me/my)",
    /(?<!\b(?:heading|section|part) )\bI\b(?!\/O\b)|(?<!\bgrill )\b[Mm](?:e|y|yself)\b(?![-_.]\w)/g,
    { changelog: false },
  ],
  ["he/his", /\b[Hh](?:e|is)\b/g, { changelog: true }],
];
// D2: README limits and the heading names each part is recognised by (checked on the heading text, any case)
const README_WORDS = 1300;
const TOP_LINES = 40;
const TOP_BULLETS = 8;
const HEADINGS = {
  install:
    /\binstall(?:ing|ation)?\b|\bget(?:ting)? started\b|\bquick ?start\b/i,
  requirements: /\brequirements?\b|\bprerequisites?\b|\bwhat you need\b/i,
  platforms: /\bplatforms?\b|\boperating systems?\b|\bwindows\b|\bmacos\b/i,
  // the first heading of the feature sections
  features: /\bfeatures?\b|\bwhat you get\b|\bwhat it does\b|\bhighlights\b/i,
  uninstall: /\buninstall(?:ing)?\b|\bundo\b|\bremov(?:e|ing)\b/i,
};
// Folders whose pages are not read by people: test fixtures, render proofs, audit output
const SKIP = /^(?:tests|\.proof|audits)\//;

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The private names, read as scripts/privacy-check.mjs reads them: one word or phrase per line, # starts a comment,
// "allow <file>:<line>" lets the words stand on that one line; each is matched anywhere, without regard to case.
// null when the file is absent.
const wordsFile = join(root, ".privacy-words");
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const ALLOW = /^allow\s+(\S+:\d+)$/i;
const listed = existsSync(wordsFile)
  ? readFileSync(wordsFile, "utf8")
      .split(/\r?\n/)
      .map((w) => w.trim())
      .filter((w) => w && !w.startsWith("#"))
  : null;
const names = listed?.filter((w) => !ALLOW.test(w)) ?? [];
const allowed = new Set(
  (listed ?? []).filter((w) => ALLOW.test(w)).map((w) => w.match(ALLOW)[1]),
);
const nameRes = names.map((w) => new RegExp(escapeRegExp(w), "gi"));
// Everything printed goes through this, so a quoted line never shows a private name
const redact = (s) => nameRes.reduce((t, re) => t.replace(re, "[name]"), s);

let fail = 0,
  total = 0;
const report = (ok, name, details = []) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${redact(name)}`);
  if (!ok) for (const d of details) console.log(`       ${redact(d)}`);
};

// The files git ships or would ship: tracked and new files that are not ignored, still on disk
const git = spawnSync(
  "git",
  ["-C", root, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
  { encoding: "utf8", maxBuffer: 1 << 28 },
);
if (git.status !== 0) {
  console.error(`git ls-files failed: ${git.stderr}`);
  process.exit(2);
}
const shipped = [...new Set(git.stdout.split("\u0000").filter(Boolean))].filter(
  (f) => existsSync(join(root, f)),
);
const shippedSet = new Set(shipped);
const shippedDirs = new Set(
  shipped.flatMap((f) =>
    f
      .split("/")
      .slice(0, -1)
      .map((_, i, parts) => parts.slice(0, i + 1).join("/")),
  ),
);
const pages = shipped.filter((f) => /\.md$/i.test(f) && !SKIP.test(f)).sort();
const text = Object.fromEntries(
  pages.map((f) => [f, readFileSync(join(root, f), "utf8")]),
);

// Blank out a match but keep its line breaks, so line numbers stay right
const blank = (s) => s.replace(/[^\n]/g, " ");
// The page with its fenced code blocks blanked
function noFences(page) {
  let fence = null;
  return page
    .split("\n")
    .map((line) => {
      const m = /^\s*(`{3,}|~{3,})/.exec(line);
      if (fence) {
        if (m && m[1][0] === fence[0] && m[1].length >= fence.length)
          fence = null;
        return blank(line);
      }
      if (m) {
        fence = m[1];
        return blank(line);
      }
      return line;
    })
    .join("\n");
}
// The page as prose: no code at all (fenced or inline)
const prose = (page) =>
  noFences(page).replace(/(`+)[^`\n]*?\1/g, (m) => blank(m));
// Prose without what someone else says or types: quotes, quoted lines, link targets, web addresses, HTML tags
const ownWords = (page) =>
  prose(page)
    .replace(/^---\r?\n[\s\S]*?\n---[ \t]*$/m, (m, i) => (i ? m : blank(m)))
    .replace(/<!--[\s\S]*?-->/g, blank)
    .replace(/\*\*[^*\n]+\*\*/g, blank)
    .replace(/^\s*>.*$/gm, blank)
    // a quote may run on over a line break, never over a blank line
    .replace(
      /"(?:[^"\n]|\n(?![ \t]*\n))*"|“(?:[^”\n]|\n(?![ \t]*\n))*”|«(?:[^»\n]|\n(?![ \t]*\n))*»/g,
      blank,
    )
    .replace(/\]\([^)\n]*\)/g, blank)
    .replace(/https?:\/\/\S+/g, blank)
    .replace(/<[^>\n]*>/g, blank);
const lineOf = (page, index) => page.slice(0, index).split("\n").length;

// ---- D1: words, pronouns, names ----
const hits = (re, page) =>
  [...page.matchAll(re)].map((m) => ({ at: lineOf(page, m.index), m: m[0] }));

for (const [name, re] of WORDS) {
  const found = pages.flatMap((f) =>
    hits(re, text[f]).map((h) => `${f}:${h.at}  "${h.m.slice(0, 80)}"`),
  );
  report(
    !found.length,
    `no shipped page holds "${name}" (personal or internal text, D1): ${found.length} hit(s)`,
    found,
  );
}
for (const [name, re, { changelog }] of PRONOUNS) {
  const found = pages
    .filter((f) => changelog || f !== "CHANGELOG.md")
    .flatMap((f) =>
      hits(re, ownWords(text[f])).map((h) => `${f}:${h.at}  "${h.m}"`),
    );
  report(
    !found.length,
    `no shipped page speaks as its author with ${name} outside code and quotes (D1): ${found.length} hit(s)`,
    found,
  );
}

if (!listed) console.log("names: skipped (no .privacy-words)");
else {
  console.log(`names: checked ${names.length}`);
  const found = [];
  for (const f of pages)
    text[f].split("\n").forEach((line, i) => {
      if (allowed.has(`${f}:${i + 1}`)) return;
      const n = nameRes.findIndex((re) => line.search(re) >= 0);
      // the name itself is never printed, only which entry it is among the names
      if (n >= 0) found.push(`${f}:${i + 1}  name ${n + 1} of .privacy-words`);
    });
  report(
    !found.length,
    `no shipped page holds a name from .privacy-words (D1): ${found.length} hit(s)`,
    found,
  );
}

// ---- D1: relative links and #anchors ----
// GitHub's anchor for a heading: its text without markup, lower case, punctuation dropped, spaces to hyphens (letters
// of any script kept); a repeated heading gets -1, -2. HTML id="" and name="" anchors count too.
// Tags are stripped until none is left, so a nested one like `<<b>script>` can't leave a tag behind.
const noTags = (s) => {
  let prev;
  do {
    prev = s;
    s = s.replace(/<[^>]+>/g, "");
  } while (s !== prev);
  return s;
};
const slug = (heading) =>
  noTags(
    heading
      .trim()
      .toLowerCase()
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1"),
  )
    .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu, "")
    .replace(/\s/g, "-");
const anchorCache = new Map();
function anchorsOf(file) {
  if (anchorCache.has(file)) return anchorCache.get(file);
  const page = noFences(
    text[file] ?? readFileSync(join(root, file), "utf8"),
  ).replace(/<!--[\s\S]*?-->/g, blank);
  const seen = new Map();
  const ids = new Set();
  for (const m of page.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = slug(m[1]);
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    ids.add(n ? `${base}-${n}` : base);
  }
  for (const m of page.matchAll(/\b(?:id|name)\s*=\s*["']([^"']+)["']/gi))
    ids.add(m[1].toLowerCase());
  anchorCache.set(file, ids);
  return ids;
}
// Every link and image target in the page's prose: [..](x), ![..](x), [ref]: x, href="x", src="x"
function targetsOf(page) {
  const t = prose(page).replace(/<!--[\s\S]*?-->/g, blank);
  const out = [];
  for (const m of t.matchAll(/\]\(\s*<?([^)\s>]*)>?(?:\s+["'(][^)\n]*)?\)/g))
    out.push({ at: lineOf(t, m.index), to: m[1] });
  for (const m of t.matchAll(/^ {0,3}\[[^\]\n]+\]:\s*<?([^\s>]+)>?/gm))
    out.push({ at: lineOf(t, m.index), to: m[1] });
  for (const m of t.matchAll(/\b(?:href|src)\s*=\s*["']([^"']+)["']/gi))
    out.push({ at: lineOf(t, m.index), to: m[1] });
  return out;
}
const isWeb = (u) => /^[a-z][a-z0-9+.-]*:/i.test(u) || u.startsWith("//");
const dead = [];
for (const f of pages)
  for (const { at, to } of targetsOf(text[f])) {
    if (!to || isWeb(to)) continue;
    const [pathPart, anchor] = to.split("#");
    let target = f;
    if (pathPart) {
      let p;
      try {
        p = decodeURIComponent(pathPart.split("?")[0]);
      } catch {
        p = pathPart;
      }
      target = posix
        .normalize(
          p.startsWith("/") ? p.slice(1) : posix.join(posix.dirname(f), p),
        )
        .replace(/\/$/, "");
      // A link that climbs above the repository's top folder opens one of GitHub's own pages for the repository
      // (SECURITY.md's ../../security/advisories/new); it is not a file here
      if (target.startsWith("../")) continue;
      // on GitHub a link works when it names a file or folder the repository holds
      if (!shippedSet.has(target) && !shippedDirs.has(target)) {
        dead.push(`${f}:${at}  ${to}  (no such file in the repository)`);
        continue;
      }
    }
    // an anchor is checked on markdown pages only (#L12 in a code file is a line, not a heading)
    if (
      anchor &&
      /\.md$/i.test(target) &&
      shippedSet.has(target) &&
      statSync(join(root, target)).isFile() &&
      !anchorsOf(target).has(decodeURIComponent(anchor).toLowerCase())
    )
      dead.push(`${f}:${at}  ${to}  (no such heading on ${target})`);
  }
report(
  !dead.length,
  `every relative link, image and #anchor in a shipped page resolves (D1): ${dead.length} dead`,
  dead,
);

// ---- D2: README shape ----
const readme = text["README.md"];
report(readme !== undefined, "README.md exists (D2)");
if (readme !== undefined) {
  // wc -w: a word is a run of characters that are not white space
  const words = readme.split(/\s+/).filter(Boolean).length;
  report(
    words <= README_WORDS,
    `README.md is at most ${README_WORDS} words as wc -w counts them (D2): ${words}`,
  );

  const topText = noFences(readme)
    .split("\n")
    .slice(0, TOP_LINES)
    .join("\n")
    .replace(/<!--[\s\S]*?-->/g, blank);
  const paragraphs = topText.split(/\n\s*\n/);
  const plain = (s) =>
    s
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  // The pitch: the first paragraph that is not a heading and reads as text (6 words or more once tags and link
  // targets are gone); it is one sentence when it ends with its only . ! or ?
  const pitch = paragraphs.find(
    (p) => !/^\s*(?:#|<h[1-6])/i.test(p) && plain(p).split(" ").length >= 6,
  );
  const ends = pitch ? plain(pitch).match(/[.!?](?=\s|$)/g)?.length : 0;
  report(
    !!pitch && ends === 1 && /[.!?]$/.test(plain(pitch)),
    `README.md opens with a one-sentence pitch in its first ${TOP_LINES} lines (D2): ${pitch ? `"${plain(pitch).slice(0, 100)}", ${ends ?? 0} sentence end(s)` : "none found"}`,
  );
  // The link row: one paragraph with 3 or more links that show words (badges show pictures), and nothing else
  // but separators between them
  const linkRe = /<a\s[^>]*>([\s\S]*?)<\/a>|(?<!!)\[([^\]]+)\]\([^)]*\)/gi;
  const linkRow = paragraphs.find((p) => {
    const labelled = [...p.matchAll(linkRe)].filter(
      (m) => plain(m[1] ?? m[2] ?? "").length > 0,
    );
    return (
      labelled.length >= 3 &&
      /^[\s|·•–—/,-]*$/.test(plain(p.replace(linkRe, " ")))
    );
  });
  report(
    !!linkRow,
    `README.md has a link row (3 or more text links, only separators between them) in its first ${TOP_LINES} lines (D2)`,
  );
  // The video: a <video> tag, a bare GitHub upload address, a link to a video file, or a YouTube or Vimeo link
  const video =
    /<video\b|^\s*https:\/\/github\.com\/user-attachments\/assets\/\S+\s*$|\.(?:mp4|webm|mov)\b|youtube\.com\/|youtu\.be\/|vimeo\.com\//im;
  report(
    video.test(topText),
    `README.md shows the video in its first ${TOP_LINES} lines (D2)`,
  );
  const bullets =
    (topText.match(/^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\S/gm)?.length ?? 0) +
    (topText.match(/<li\b/gi)?.length ?? 0);
  report(
    bullets <= TOP_BULLETS,
    `README.md has at most ${TOP_BULLETS} bullets in its first ${TOP_LINES} lines (D2): ${bullets}`,
  );

  // Headings in order, the title (the first h1) aside
  const headings = [
    ...noFences(readme).matchAll(
      /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$|<h([1-6])\b[^>]*>([\s\S]*?)<\/h\3>/gim,
    ),
  ]
    .map((m) => ({
      level: (m[1] ?? "").length || +m[3],
      text: plain(m[2] ?? m[4]),
    }))
    .filter((h, i) => !(i === 0 && h.level === 1));
  const first = (kind) =>
    headings.findIndex((h) => HEADINGS[kind].test(h.text));
  const named = (i) => (i < 0 ? "none" : `"${headings[i].text}"`);
  const features = first("features");
  report(
    features >= 0,
    `README.md has a feature heading (D2): ${named(features)}`,
  );
  for (const kind of ["install", "requirements", "platforms"]) {
    const i = first(kind);
    report(
      i >= 0 && (features < 0 || i < features),
      `README.md has a heading for ${kind} before the first feature heading (D2): ${kind} ${named(i)}, features ${named(features)}`,
    );
  }
  report(
    first("uninstall") >= 0,
    `README.md has an uninstall heading (D2): ${named(first("uninstall"))}`,
  );
}

// The release badge is a fixed picture (GitHub's image proxy gives up after 4 s, and a badge that asks GitHub for
// the latest release took longer), so each README must name the version in version.json.
{
  const version = JSON.parse(
    readFileSync(join(root, "version.json"), "utf8"),
  ).version;
  const badge = `https://img.shields.io/badge/release-v${version.replaceAll("-", "--")}-blue`;
  for (const f of ["README.md", "README.ru.md"])
    report(
      readFileSync(join(root, f), "utf8").includes(badge),
      `${f} shows the release badge for version.json's ${version}`,
    );
}

console.log(
  fail ? `\n${fail} of ${total} checks failed` : `\nall ${total} checks passed`,
);
process.exit(fail ? 1 : 0);
