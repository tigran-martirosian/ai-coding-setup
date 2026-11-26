// Test of the skill linter (skills/setup-audit/scripts/skill-lint.mjs): it catches each kind of weak skill
// (bad frontmatter, no numbered steps, a step that acts with no command, a command with no check, no error table),
// passes a sound one, prints `<skill>: <rule>: <detail>` lines and a total, and exits 1 on any failure.
// Run: node tests/test-skill-lint.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const LINT = path.join(ROOT, "skills/setup-audit/scripts/skill-lint.mjs");
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
  }
};

const ERRORS = `
## When a step fails

| Problem | What to do |
|---|---|
| the build prints an error | fix the file it names, then run step 1 again |
`;
const GOOD = `---
name: good
description: Use when the test needs a sound skill.
---

# Good

1. Run \`node build.mjs --out dist\`; it prints \`built 3 files\`.
2. Tell the user what was built.
${ERRORS}`;

// One fixture skill per failure kind, each named for the rule it breaks.
const FIXTURES = {
  good: GOOD,
  "frontmatter-missing": GOOD.replace(/^---[\s\S]*?---\n/, ""),
  "frontmatter-name": GOOD.replace("name: good", "name: other"),
  "frontmatter-description": GOOD.replace(/description: .*\n/, ""),
  "no-steps": GOOD.replace(/1\. [\s\S]*?(?=\n## )/, "Some reference text.\n"),
  "step-no-command": GOOD.replace(
    "2. Tell the user what was built.",
    "2. Delete the old output folder.",
  ),
  "step-no-check": GOOD.replace(
    "; it prints `built 3 files`.",
    " and move on.",
  ),
  "no-error-table": GOOD.replace(ERRORS, "\n"),
};

const EXPECT = {
  "frontmatter-missing": "frontmatter",
  "frontmatter-name": "frontmatter",
  "frontmatter-description": "frontmatter",
  "no-steps": "steps",
  "step-no-command": "step-command",
  "step-no-check": "step-check",
  "no-error-table": "error-table",
};

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skill-lint-"));
const run = (...args) => {
  const r = spawnSync(process.execPath, [LINT, ...args], { encoding: "utf8" });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
};
try {
  check("the linter script exists", fs.existsSync(LINT));
  for (const [name, text] of Object.entries(FIXTURES)) {
    const folder = path.join(dir, "all", name);
    fs.mkdirSync(folder, { recursive: true });
    fs.writeFileSync(
      path.join(folder, "SKILL.md"),
      text.replace("name: good", `name: ${name}`),
    );
  }
  // The name fixture must keep its wrong name.
  fs.writeFileSync(
    path.join(dir, "all", "frontmatter-name", "SKILL.md"),
    FIXTURES["frontmatter-name"],
  );

  const all = run(path.join(dir, "all"));
  const lines = all.out.split(/\r?\n/);
  const has = (skill, rule) =>
    lines.some((l) => l.startsWith(`${skill}: ${rule}: `));
  check(
    "a sound skill (numbered steps, command and check, error table) passes",
    !lines.some((l) => l.startsWith("good: ")),
    all.out,
  );
  check(
    "a skill with no frontmatter fails the frontmatter rule",
    has("frontmatter-missing", "frontmatter"),
    all.out,
  );
  check(
    "a skill whose name differs from its folder fails the frontmatter rule",
    has("frontmatter-name", "frontmatter"),
    all.out,
  );
  check(
    "a skill with no description fails the frontmatter rule",
    has("frontmatter-description", "frontmatter"),
    all.out,
  );
  check(
    "a skill with no numbered steps fails the steps rule",
    has("no-steps", "steps"),
    all.out,
  );
  check(
    "a step that acts (Delete ...) but names no command fails step-command",
    has("step-no-command", "step-command"),
    all.out,
  );
  check(
    "a step that runs a command but says no way to check it fails step-check",
    has("step-no-check", "step-check"),
    all.out,
  );
  check(
    "a skill with no error table or failure section fails error-table",
    has("no-error-table", "error-table"),
    all.out,
  );
  check(
    "each fixture breaks only its own rule (no stray failures)",
    lines
      .filter((l) => /^[\w-]+: [\w-]+: /.test(l))
      .every((l) => {
        const [skill, rule] = l.split(": ");
        return EXPECT[skill] === rule;
      }),
    all.out,
  );
  check(
    "it prints a total line with the failure count",
    /^skill-lint: 7 failures? in 7 of 8 skills/m.test(all.out),
    all.out,
  );
  check("it exits 1 when any skill fails", all.code === 1, `exit ${all.code}`);

  const goodOnly = path.join(dir, "ok");
  fs.mkdirSync(path.join(goodOnly, "good"), { recursive: true });
  fs.writeFileSync(path.join(goodOnly, "good", "SKILL.md"), GOOD);
  const ok = run(goodOnly);
  check(
    "it exits 0 and says 0 failures when every skill passes",
    ok.code === 0 && /^skill-lint: 0 failures in 0 of 1 skills/m.test(ok.out),
    `exit ${ok.code}: ${ok.out}`,
  );

  const missing = run(path.join(dir, "no-such-folder"));
  check(
    "a folder that does not exist stops with a clear error, not a pass",
    missing.code === 2 && /no-such-folder/.test(missing.out),
    `exit ${missing.code}: ${missing.out}`,
  );

  // The repo's own run: the skill that files papercuts passes every rule.
  const repo = run();
  check(
    "with no folder it lints the repo's skills/ (a total line is printed)",
    /^skill-lint: \d+ failures? in \d+ of \d+ skills/m.test(repo.out),
    repo.out.slice(-500),
  );
  check(
    "the log-papercut skill passes every rule",
    !repo.out.split(/\r?\n/).some((l) => l.startsWith("log-papercut: ")) &&
      fs.existsSync(path.join(ROOT, "skills/log-papercut/SKILL.md")),
    repo.out
      .split(/\r?\n/)
      .filter((l) => l.startsWith("log-papercut"))
      .join("\n"),
  );
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
