// Tests for docs/whats-new.md, the page an update points to when the middle version number rose: it exists, the
// docs index and the update skill point to it, and every skill, command and trigger phrase it names is real.
// Run: node tests/test-whats-new.mjs
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const read = (...p) => fs.readFileSync(path.join(REPO, ...p), "utf8");
let fail = 0,
  total = 0;
const report = (ok, name, detail = "") => {
  total++;
  if (!ok) fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${detail}`}`,
  );
};

const page = path.join(REPO, "docs", "whats-new.md");
report(
  fs.existsSync(page),
  "docs/whats-new.md exists, so the path the update gives opens a page",
);
if (!fs.existsSync(page)) {
  console.log(`\n${total - fail}/${total} passed`);
  process.exit(1);
}
const text = fs.readFileSync(page, "utf8");

const skills = new Set(
  fs
    .readdirSync(path.join(REPO, "skills"))
    .filter((n) => fs.existsSync(path.join(REPO, "skills", n, "SKILL.md"))),
);
const agents = new Set(
  fs
    .readdirSync(path.join(REPO, "agents"))
    .filter((n) => n.endsWith(".md"))
    .map((n) => n.replace(/\.md$/, "")),
);
const frontmatter = (name) =>
  read("skills", name, "SKILL.md").split(/^---\s*$/m)[1] || "";
// the description as the model reads it: YAML quoting undone ('' is one ' in single quotes, \" one ")
const description = (name) =>
  (frontmatter(name).match(/^description:\s*(.*)$/m)?.[1] || "")
    .replace(/''/g, "'")
    .replace(/\\"/g, '"')
    .toLowerCase();
const typedOnly = (name) =>
  /^disable-model-invocation:\s*true\s*$/m.test(frontmatter(name));

// Claude Code's own commands the page may name; anything else after a slash must be a skill of the setup
const BUILT_IN = new Set(["code-review", "advisor"]);
const current = text.split(/^## What's gone/m)[0];

const slashes = [...text.matchAll(/`\/([a-z][a-z-]*)/g)].map((m) => m[1]);
const badSlash = slashes.filter((n) => !skills.has(n) && !BUILT_IN.has(n));
report(
  slashes.length > 0 && badSlash.length === 0,
  "every /command on the page is a skill under skills/ or Claude Code's own",
  `not found: ${badSlash.join(", ")}`,
);

const named = [...current.matchAll(/`([a-z][a-z-]*)`/g)].map((m) => m[1]);
const badName = named.filter((n) => !skills.has(n) && !agents.has(n));
report(
  badName.length === 0,
  "every skill or helper the page names (outside What's gone) exists under skills/ or agents/",
  `not found: ${badName.join(", ")}`,
);

const rows = text
  .split("\n")
  .filter((l) => /^\| .* \| `[a-z-]+` \|$/.test(l))
  .map((l) => {
    const cells = l.split(" | ");
    return {
      line: l,
      say: cells[0].slice(2),
      skill: cells.at(-1).replace(/[`|\s]/g, ""),
    };
  });
report(
  rows.length >= 10,
  `the "Say or type" table has its rows (found ${rows.length})`,
);
for (const r of rows) {
  if (!skills.has(r.skill)) {
    report(false, `table row names a skill that exists: ${r.skill}`, r.line);
    continue;
  }
  const desc = description(r.skill);
  const quotes = [...r.say.matchAll(/"([^"]+)"/g)].map((m) =>
    m[1].toLowerCase(),
  );
  const missing = quotes.filter((q) => !desc.includes(q));
  report(
    missing.length === 0,
    `${r.skill}: every quoted phrase in its row is in the skill's own description, so saying it starts the skill`,
    `not in the description: ${missing.join(" / ")}`,
  );
  const cmds = [...r.say.matchAll(/`\/([a-z-]+)/g)].map((m) => m[1]);
  report(
    cmds.every((c) => c === r.skill),
    `${r.skill}: the command in its row is /${r.skill}`,
    r.line,
  );
  report(
    typedOnly(r.skill) === /\(typed\)/.test(r.say),
    `${r.skill}: its row says "typed" exactly when the skill starts only from a typed command`,
    r.line,
  );
}

const index = read("docs", "README.md");
report(/\]\(whats-new\.md\)/.test(index), "the docs index links whats-new.md");

const update = read("skills", "update-setup", "SKILL.md");
report(
  /what's new/.test(description("update-setup")) &&
    /что нового/.test(description("update-setup")),
  `update-setup's description has "what's new" and "что нового", so a person can ask for the page later`,
);
report(
  /^9\. \*\*Reply\*\*[\s\S]*middle number[^\n]*`~\/\.claude\/setup-source\/v<version>\/docs\/whats-new\.md`/m.test(
    update,
  ),
  "update-setup step 9 gives the tour and the page's path when the middle version number rose",
);

console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
