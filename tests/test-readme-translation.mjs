// README.ru.md stays a full translation of README.md: the same headings per level, the same relative links and
// images, each language row pointing at the other file, and every relative link, image and heading anchor resolving.
// Run: node tests/test-readme-translation.mjs
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0,
  total = 0;
const report = (ok, name) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};

// The text outside fenced code blocks, where headings and links can't be
const prose = (text) =>
  text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?^\1[ \t]*$/gm, "");

// Heading counts per level: markdown "#" lines and HTML <h1>..<h6>
function headingCounts(text) {
  const counts = [0, 0, 0, 0, 0, 0];
  for (const m of prose(text).matchAll(/^(#{1,6})\s+\S/gm))
    counts[m[1].length - 1]++;
  for (const m of prose(text).matchAll(/<h([1-6])[\s>]/gi)) counts[+m[1] - 1]++;
  return counts;
}

// GitHub's anchor for a heading: lower case, punctuation dropped, spaces to hyphens (letters of any script kept)
const slug = (heading) =>
  heading
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
const anchors = (text) =>
  new Set(
    [...prose(text).matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)].map((m) =>
      slug(m[1].replace(/`/g, "")),
    ),
  );

// Every link and image target: markdown [..](x) and ![..](x), HTML href="x" and src="x"
function targets(text) {
  const t = prose(text);
  const out = [];
  for (const m of t.matchAll(
    /!?\[[^\]]*\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g,
  ))
    out.push(m[1]);
  for (const m of t.matchAll(/\b(?:href|src)\s*=\s*"([^"]+)"/gi))
    out.push(m[1]);
  return out;
}
const isRelative = (u) =>
  !/^[a-z][a-z0-9+.-]*:/i.test(u) && !u.startsWith("//");

const files = { en: "README.md", ru: "README.ru.md" };
const text = {};
for (const [lang, name] of Object.entries(files)) {
  const p = join(root, name);
  report(
    existsSync(p),
    `${name} exists (the ${lang} README the language row links to)`,
  );
  text[lang] = existsSync(p) ? readFileSync(p, "utf8") : "";
}

// 1. The same headings per level
const hEn = headingCounts(text.en);
const hRu = headingCounts(text.ru);
report(
  JSON.stringify(hEn) === JSON.stringify(hRu),
  `README.ru.md has the same number of headings per level as README.md (en h1-h6 ${hEn.join("/")}, ru ${hRu.join("/")})`,
);

// 2. The same relative links and images (the language switch aside, which points at the other file)
const langFiles = new Set(Object.values(files));
const relSet = (t) =>
  new Set(
    targets(t).filter(
      (u) => isRelative(u) && !u.startsWith("#") && !langFiles.has(u),
    ),
  );
const sEn = relSet(text.en);
const sRu = relSet(text.ru);
const onlyEn = [...sEn].filter((u) => !sRu.has(u));
const onlyRu = [...sRu].filter((u) => !sEn.has(u));
report(
  onlyEn.length === 0,
  `every relative link and image of README.md is in README.ru.md too${onlyEn.length ? `; missing: ${onlyEn.join(", ")}` : ""}`,
);
report(
  onlyRu.length === 0,
  `README.ru.md links nothing README.md doesn't${onlyRu.length ? `; extra: ${onlyRu.join(", ")}` : ""}`,
);
report(
  sEn.size > 5,
  `the link check found the README's links (${sEn.size} relative targets)`,
);

// 3. The language row: each README links the other
report(
  targets(text.en).includes(files.ru),
  "README.md's language row links README.ru.md",
);
report(
  targets(text.ru).includes(files.en),
  "README.ru.md's language row links README.md",
);

// 4. Every relative target exists, and an anchor into a markdown file names one of its headings
for (const [lang, name] of Object.entries(files)) {
  const broken = [];
  for (const u of new Set(targets(text[lang]).filter(isRelative))) {
    const [path, frag] = u.split("#");
    const file = path ? join(root, decodeURIComponent(path)) : join(root, name);
    if (!existsSync(file)) {
      broken.push(`${u} (no such file)`);
      continue;
    }
    if (
      frag &&
      file.endsWith(".md") &&
      !anchors(readFileSync(file, "utf8")).has(
        decodeURIComponent(frag).toLowerCase(),
      )
    )
      broken.push(`${u} (no heading with that anchor)`);
  }
  report(
    broken.length === 0,
    `every relative link, image and anchor in ${name} resolves${broken.length ? `; broken: ${broken.join(", ")}` : ""}`,
  );
}

console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
