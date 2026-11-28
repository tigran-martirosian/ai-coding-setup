// The public pages name only things that ship, so a reader or an agent never follows a page to a hook, off switch,
// skill or file that was renamed or removed. A second source to check the text against is the code itself.
// Pages read: README.md, README.ru.md, CONTRIBUTING.md, SECURITY.md and docs/**/*.md as git ships them (tracked, or
// new and not ignored). CHANGELOG.md is left out: it names old things on purpose.
//   - `NAME=off` (an off switch): NAME is a variable the code reads: a literal in a shipped code file, or a hook's
//     name in capitals with "-" as "_" (hooks/lib/hook-io.mjs offName).
//   - `hooks/x.mjs`, `skills/x/`, `docs/x.md` and any other backticked path under a shipped top folder: it exists in
//     the tree. A path with a placeholder (<x>, *, {x}, ...) is not checked.
//     A path in a user's own project or made at run time is listed in ELSEWHERE.
//   - `/name` (a slash command): a skill in skills/ or templates/shared/shared-skills/, a command in commands/, a
//     phone bot command (phone/relay/bot/bot.mjs), or a built-in Claude Code command from BUILTIN.
// Run: node tests/test-docs-match-code.mjs   (DOCS_ROOT=<folder> checks another copy of the tree)
import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(
  process.env.DOCS_ROOT || join(dirname(fileURLToPath(import.meta.url)), ".."),
);
let fail = 0,
  total = 0;
const report = (ok, name, details = []) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
  if (!ok) for (const d of details) console.log(`       ${d}`);
};

// Claude Code's own slash commands, which no skill here provides.
const BUILTIN = new Set(
  "add-dir advisor agents bug clear compact config context cost doctor exit export fast help hooks ide init install-github-app login logout mcp memory model permissions plugin plugins pr-comments release-notes resume review rewind status statusline terminal-setup upgrade usage vim code-review simplify loop btw effort security-review deep-research".split(
    " ",
  ),
);
// Paths the pages name in a user's own project or in the live setup, not in this tree.
const ELSEWHERE = new Set([
  "docs/glossary.md", // a project's terms (domain-modeling skill)
  "docs/facts.md", // a project's facts (new-project skill)
  "hooks/state", // made by the hooks at run time in ~/.claude
]);
// Top folders whose paths are checked; a path under another folder (~/.claude, a project's own) is not this tree's.
const TOP = [
  "hooks",
  "skills",
  "agents",
  "workers",
  "scripts",
  "extensions",
  "phone",
  "templates",
  "docs",
  "tests",
  "rules",
  "commands",
];

const git = (args) => {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed: ${r.stderr}`);
  return r.stdout.split("\n").filter(Boolean);
};
const shipped = [
  ...new Set([
    ...git(["ls-files"]),
    ...git(["ls-files", "--others", "--exclude-standard"]),
  ]),
].filter((f) => existsSync(join(root, f)));

const pages = shipped.filter(
  (f) =>
    /^(README(\.ru)?|CONTRIBUTING|SECURITY)\.md$/.test(f) ||
    /^docs\/.+\.md$/.test(f),
);

// ---- What the code holds ----
const code = shipped.filter(
  (f) => /\.(mjs|cjs|js|ps1|sh)$/.test(f) && !f.startsWith("tests/"),
);
const literals = new Set();
for (const f of code)
  for (const m of readFileSync(join(root, f), "utf8").matchAll(
    /\b[A-Z][A-Z0-9_]{2,}\b/g,
  ))
    literals.add(m[0]);
const offName = (name) => name.toUpperCase().replace(/-/g, "_");
for (const f of shipped)
  if (/^hooks\/[^/]+\.mjs$/.test(f)) literals.add(offName(f.slice(6, -4)));
for (const f of code)
  for (const m of readFileSync(join(root, f), "utf8").matchAll(
    /runHook\(\s*["'`]([\w-]+)["'`]/g,
  ))
    literals.add(offName(m[1]));

const skillDirs = (dir) =>
  existsSync(join(root, dir))
    ? readdirSync(join(root, dir)).filter((n) =>
        existsSync(join(root, dir, n, "SKILL.md")),
      )
    : [];
const commands = new Set([
  ...skillDirs("skills"),
  ...skillDirs("templates/shared/shared-skills"),
  ...(existsSync(join(root, "commands"))
    ? readdirSync(join(root, "commands"))
        .filter((n) => n.endsWith(".md"))
        .map((n) => n.slice(0, -3))
    : []),
]);
// The phone bot's own commands, which its owner types in Telegram.
const bot = join(root, "phone/relay/bot/bot.mjs");
if (existsSync(bot))
  for (const m of readFileSync(bot, "utf8").matchAll(
    /["'`]\/?([a-z][a-z-]+)["'` ]/g,
  ))
    commands.add(m[1]);
// A skill's own name in its front matter can differ from its folder.
for (const f of shipped)
  if (/(^|\/)SKILL\.md$/.test(f)) {
    const m = readFileSync(join(root, f), "utf8").match(/^name:\s*(\S+)/m);
    if (m) commands.add(m[1].replace(/^["']|["']$/g, ""));
  }

const exists = (p) => {
  const clean = p.replace(/\/$/, "");
  return existsSync(join(root, clean));
};

// ---- What the pages name ----
const missing = { switch: [], path: [], command: [] };
for (const page of pages) {
  const lines = readFileSync(join(root, page), "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = `${page}:${i + 1}`;
    for (const m of line.matchAll(/\b([A-Z][A-Z0-9_]{2,})=off\b/g))
      if (!literals.has(m[1])) missing.switch.push(`${at} ${m[1]}=off`);
    for (const m of line.matchAll(/`([^`\n]+)`/g)) {
      const span = m[1].trim();
      const path = span.match(
        new RegExp(`^(?:\\./)?((?:${TOP.join("|")})/[\\w./-]*)$`),
      );
      if (
        path &&
        !/[<>*{}]|\.\.\./.test(span) &&
        !ELSEWHERE.has(path[1].replace(/\/$/, "")) &&
        !exists(path[1])
      )
        missing.path.push(`${at} ${path[1]}`);
      const cmd = span.match(/^\/([a-z][\w-]*)(?:\s|$)/);
      if (cmd && !commands.has(cmd[1]) && !BUILTIN.has(cmd[1]))
        missing.command.push(`${at} /${cmd[1]}`);
    }
  });
}

report(pages.length > 5, `the pages to read were found (${pages.length})`, [
  `only ${pages.length} pages under ${root}`,
]);
report(
  missing.switch.length === 0,
  "every NAME=off in the pages is a variable the code reads",
  missing.switch,
);
report(
  missing.path.length === 0,
  "every repo path in the pages exists in the tree",
  missing.path,
);
report(
  missing.command.length === 0,
  "every /command in the pages is a shipped skill or a built-in command",
  missing.command,
);

console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
