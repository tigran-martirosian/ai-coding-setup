// Test that every skills/*/SKILL.md has frontmatter Claude Code can parse. A frontmatter that does not
// parse as YAML still loads, but with no fields: Claude never sees the description and never picks the skill.
// Run: node tests/test-skill-frontmatter.mjs            (every skill in skills/)
//      node tests/test-skill-frontmatter.mjs <file...>  (only these files, e.g. an old copy of one)
// Only one-line `key: value` fields are read: block scalars (`>`, `|`), lists and nested keys fail here even though
// YAML allows them, so a skill that needs one extends this parser first.
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0, fail = 0;
const check = (name, ok) => { ok ? pass++ : (fail++, console.log(`FAIL  ${name}`)); };

// The problems in one frontmatter block, strictly: one `key: value` per line, a value either quoted or a
// plain scalar with no ": " (YAML reads that as a second key) and no " #" (the rest becomes a comment).
function problems(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/);
  if (!m) return { errors: ["no frontmatter: the first line must be --- and a closing --- must follow"], fields: {} };
  const errors = [], fields = {};
  m[1].split(/\r?\n/).forEach((line, i) => {
    const at = `line ${i + 2}`;
    if (!line.trim()) return;
    const kv = line.match(/^([A-Za-z][\w-]*):(?: (.*))?$/);
    if (!kv) return errors.push(`${at}: not a "key: value" line: ${line}`);
    const [, key, raw = ""] = kv;
    if (key in fields) errors.push(`${at}: ${key} is set twice`);
    const v = raw.trim();
    if (/^"/.test(v)) {
      if (!/^"(?:[^"\\]|\\.)*"$/.test(v)) errors.push(`${at}: ${key} opens a double quote it does not close cleanly`);
      fields[key] = v.slice(1, -1).replace(/\\(.)/g, "$1");
    } else if (/^'/.test(v)) {
      if (!/^'(?:[^']|'')*'$/.test(v)) errors.push(`${at}: ${key} opens a single quote it does not close cleanly`);
      fields[key] = v.slice(1, -1).replace(/''/g, "'");
    } else {
      if (/: /.test(v) || /:$/.test(v)) errors.push(`${at}: ${key} has an unquoted ": " (quote the value or reword)`);
      if (/ #/.test(v)) errors.push(`${at}: ${key} has an unquoted " #" (the rest would be a comment)`);
      if (/^([[\]{}#&*!|>%@`,]|[-?:]( |$))/.test(v)) errors.push(`${at}: ${key} starts with a YAML indicator character (quote it)`);
      fields[key] = v;
    }
  });
  const d = fields.description;
  if (d === undefined || d === "") errors.push("no description");
  else {
    if (/[<>]/.test(d)) errors.push("description has < or > (Claude Code shows them as &lt; &gt;; write [name] or use argument-hint)");
    if (d.length > 1536) errors.push(`description is ${d.length} characters (the listing cuts it at 1,536)`);
  }
  return { errors, fields };
}

const args = process.argv.slice(2);
const files = args.length ? args.map((a) => path.resolve(a)) : fs.readdirSync(path.join(ROOT, "skills"))
  .map((n) => path.join(ROOT, "skills", n, "SKILL.md")).filter((f) => fs.existsSync(f));
check("there are skills to check", files.length > 0);
for (const f of files) {
  const name = path.relative(ROOT, f).replace(/\\/g, "/");
  const { errors, fields } = problems(fs.readFileSync(f, "utf8"));
  for (const e of errors) console.log(`      ${name}: ${e}`);
  check(`${name}: frontmatter parses strictly`, errors.length === 0);
  if (!args.length) check(`${name}: name matches its folder`, fields.name === path.basename(path.dirname(f)));
}

// The checker itself catches what it is for.
const bad = (desc) => problems(`---\nname: x\ndescription: ${desc}\n---\nbody\n`).errors.length > 0;
check("self: catches an unquoted colon-space", bad("Use when the user runs /x (optional: a folder)."));
check("self: catches angle brackets", bad("Use on /x <name>."));
check("self: catches a description over 1,536 characters", bad("a".repeat(1537)));
check("self: accepts a quoted colon-space", !bad('"Use when (optional: a folder)."'));
check("self: accepts a colon with no space after it", !bad("Use headless:false here."));
check("self: catches a missing opening ---", problems("name: x\n---\n").errors.length > 0);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
