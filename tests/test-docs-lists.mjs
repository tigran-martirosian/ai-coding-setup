// The reference pages list exactly what the code folders hold (D4 of docs/2026-11-26-public-repo-text-spec.md in the
// setup's own folder), so a hook, skill or extension added, removed or renamed fails here until its page follows.
//   docs/reference/hooks.md       one table: hooks/*.mjs (not hooks/lib/, not dispatch*.mjs), a column headed
//                                 "Off switch" with the hook's variable in backticks
//   docs/reference/skills.md      two tables: skills/*/SKILL.md, then templates/shared/shared-skills/*/SKILL.md
//   docs/reference/extensions.md  one table: extensions/*/ (not shared/)
// Each table's first column holds the name in backticks exactly as its file or folder is named, one row each; each
// page's first sentence after its title gives the count as a number (skills.md: the skills in its first table).
// A hook's off switch is read from its source: the {off: "NAME"} given to runHook, else runHook's name in capitals
// with "-" as "_" (hooks/lib/hook-io.mjs offName); a hook without runHook reads process.env.NAME and compares it
// with "off" itself, and the variable named like the file wins when there are several.
// Run: node tests/test-docs-lists.mjs
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let fail = 0,
  total = 0;
const report = (ok, name, details = []) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) for (const d of details) console.log(`       ${d}`);
};

// ---- What the code folders hold ----
const folders = (dir, keep = () => true) =>
  readdirSync(join(root, dir), { withFileTypes: true })
    .filter((e) => e.isDirectory() && keep(e.name))
    .map((e) => e.name)
    .sort();
const skills = folders("skills", (n) =>
  existsSync(join(root, "skills", n, "SKILL.md")),
);
const templateSkills = folders("templates/shared/shared-skills", (n) =>
  existsSync(join(root, "templates/shared/shared-skills", n, "SKILL.md")),
);
const extensions = folders("extensions", (n) => n !== "shared");
const offName = (name) => name.toUpperCase().replace(/-/g, "_");
function offSwitch(file, source) {
  const run = /\brunHook\(\s*(?:"([\w-]+)"|([A-Za-z_$][\w$]*))/.exec(source);
  if (run) {
    const name =
      run[1] ??
      new RegExp(`\\bconst ${run[2]}\\s*=\\s*"([\\w-]+)"`).exec(source)?.[1];
    if (!name) return null;
    return /\boff:\s*"([A-Z0-9_]+)"/.exec(source)?.[1] ?? offName(name);
  }
  const read = [
    ...source.matchAll(
      /process\.env\.([A-Z0-9_]+)\s*\|\|\s*""\s*\)\s*\.toLowerCase\(\)\s*[!=]==\s*"off"/g,
    ),
  ].map((m) => m[1]);
  const own = offName(file);
  return read.includes(own) ? own : read.length === 1 ? read[0] : null;
}
const hooks = readdirSync(join(root, "hooks"))
  .filter((n) => n.endsWith(".mjs") && !n.startsWith("dispatch"))
  .map((n) => n.slice(0, -".mjs".length))
  .sort()
  .map((name) => ({
    name,
    off: offSwitch(
      name,
      readFileSync(join(root, "hooks", `${name}.mjs`), "utf8"),
    ),
  }));
const noSwitch = hooks.filter((h) => !h.off).map((h) => `hooks/${h.name}.mjs`);
report(
  !noSwitch.length,
  `every hook's off switch is found in its source (runHook, or process.env.NAME compared with "off"): ${noSwitch.length} without`,
  noSwitch,
);

// ---- What a reference page says ----
// The page with fenced code blocks dropped
const noFences = (page) =>
  page.replace(/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm, "");
const cells = (line) =>
  line
    .trim()
    .replace(/^\|/, "")
    .replace(/(?<!\\)\|$/, "")
    .split(/(?<!\\)\|/)
    .map((c) => c.trim());
// Every table: a header line, a line of dashes, then its rows
function tables(page) {
  const lines = noFences(page).split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i++) {
    if (
      !/^\s*\|/.test(lines[i]) ||
      !/^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(lines[i + 1])
    )
      continue;
    const rows = [];
    let j = i + 2;
    while (j < lines.length && /^\s*\|/.test(lines[j]))
      rows.push(cells(lines[j++]));
    out.push({ header: cells(lines[i]), rows });
    i = j - 1;
  }
  return out;
}
const ticked = (cell) => [...cell.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
const plain = (s) =>
  s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/<[^>]+>/g, " ")
    .replace(/[`*_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
// The first sentence of the first paragraph of text after the title (headings, tables, pictures and HTML aside)
function firstSentence(page) {
  const para = noFences(page)
    .split(/\r?\n\s*\r?\n/)
    .map((p) => p.trim())
    .find((p) => p && !/^(?:#|\||<|!\[|---)/.test(p) && plain(p).length > 0);
  if (!para) return "";
  const text = plain(para);
  return /^.*?[.!?](?=\s|$)/.exec(text)?.[0] ?? text;
}

// Compares one table's names with the folder's; returns the table's rows by name for further checks
function compare(page, label, table, expected, what) {
  if (!table) {
    report(false, `${page} has a table of ${what} (${label})`);
    return null;
  }
  const bad = [];
  const names = table.rows.map((r, i) => {
    const name = ticked(r[0] ?? "")[0];
    if (!name)
      bad.push(`row ${i + 1}: "${r[0] ?? ""}" has no name in backticks`);
    return name;
  });
  const seen = new Set();
  const twice = names.filter((n) => n && seen.size === seen.add(n).size);
  const missing = expected.filter((n) => !names.includes(n));
  const extra = names.filter((n) => n && !expected.includes(n));
  report(
    !bad.length && !twice.length && !missing.length && !extra.length,
    `${page} lists the ${expected.length} ${what} in ${label}, each once by its exact name (the page has ${table.rows.length} rows)`,
    [
      ...bad,
      ...twice.map((n) => `listed twice: ${n}`),
      ...missing.map((n) => `missing from the page: ${n}`),
      ...extra.map((n) => `on the page but not in the code: ${n}`),
    ],
  );
  return Object.fromEntries(table.rows.map((r, i) => [names[i], r]));
}

// Reads a page and checks its table count and first sentence; null when the page is not there
function readPage(page, tableCount, count, what) {
  const file = join(root, page);
  report(existsSync(file), `${page} exists (the generated list of ${what})`);
  if (!existsSync(file)) return null;
  const text = readFileSync(file, "utf8");
  const found = tables(text);
  report(
    found.length === tableCount,
    `${page} holds ${tableCount} table(s): ${found.length}`,
  );
  const sentence = firstSentence(text);
  report(
    new RegExp(`(?<![\\d.,])${count}(?![\\d.,]\\d)`).test(sentence),
    `${page}'s first sentence gives the count of ${what} as a number (${count}): "${sentence.slice(0, 120)}"`,
  );
  return found;
}

// hooks.md
{
  const page = "docs/reference/hooks.md";
  const found = readPage(page, 1, hooks.length, "hooks");
  if (found) {
    const rows = compare(
      page,
      "its table",
      found[0],
      hooks.map((h) => h.name),
      "hooks",
    );
    const col = found[0]?.header.findIndex((h) =>
      /^off switch$/i.test(plain(h)),
    );
    report(col >= 0, `${page}'s table has a column headed "Off switch"`);
    if (rows && col >= 0) {
      const wrong = hooks
        .filter((h) => h.off && rows[h.name])
        .filter(
          (h) =>
            !ticked(rows[h.name][col] ?? "")
              .map((t) => t.replace(/=.*$/, ""))
              .includes(h.off),
        )
        .map(
          (h) =>
            `${h.name}: the hook reads \`${h.off}\`, the page says "${rows[h.name][col] ?? ""}"`,
        );
      report(
        !wrong.length,
        `${page} names each hook's off switch in backticks as its source reads it: ${wrong.length} wrong`,
        wrong,
      );
    }
  }
}

// skills.md
{
  const page = "docs/reference/skills.md";
  const found = readPage(page, 2, skills.length, "skills");
  if (found) {
    compare(page, "its first table", found[0], skills, "skills in skills/");
    compare(
      page,
      "its second table",
      found[1],
      templateSkills,
      "template skills in templates/shared/shared-skills/",
    );
  }
}

// extensions.md
{
  const page = "docs/reference/extensions.md";
  const found = readPage(page, 1, extensions.length, "extensions");
  if (found) compare(page, "its table", found[0], extensions, "extensions");
}

console.log(
  fail ? `\n${fail} of ${total} checks failed` : `\nall ${total} checks passed`,
);
process.exit(fail ? 1 : 0);
