// Tests for typedOnly in scripts/plugins.mjs: the find-skills skill fetched with npx starts only when typed, so its
// description is not in every turn. Run: node tests/test-find-skills-typed.mjs
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { typedOnly } from "../scripts/plugins.mjs";

const dir = mkdtempSync(join(tmpdir(), "find-skills-typed-"));
let fail = 0,
  total = 0;
const report = (ok, name) => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
const file = join(dir, "SKILL.md");
const UPSTREAM =
  "---\nname: find-skills\ndescription: Helps users discover skills.\n---\n\n# Find Skills\n\n---\nnot frontmatter\n";

try {
  writeFileSync(file, UPSTREAM);
  report(typedOnly(file) === true, "the upstream copy is changed");
  const once = readFileSync(file, "utf8");
  report(
    once ===
      "---\nname: find-skills\ndescription: Helps users discover skills.\ndisable-model-invocation: true\n---\n\n# Find Skills\n\n---\nnot frontmatter\n",
    "the line goes at the end of the frontmatter, the body stays as it was",
  );
  report(
    typedOnly(file) === false && readFileSync(file, "utf8") === once,
    "a second run changes nothing",
  );

  writeFileSync(file, UPSTREAM.replace(/\n/g, "\r\n"));
  typedOnly(file);
  report(
    readFileSync(file, "utf8").includes(
      "skills.\r\ndisable-model-invocation: true\r\n---",
    ),
    "a CRLF file keeps CRLF",
  );

  writeFileSync(
    file,
    "---\nname: find-skills\ndisable-model-invocation: false\n---\nbody\n",
  );
  report(
    typedOnly(file) === false,
    "a copy where the person set the line themselves is left as they have it",
  );

  writeFileSync(file, "# no frontmatter\n");
  let threw = false;
  try {
    typedOnly(file);
  } catch (e) {
    threw = /no frontmatter/.test(e.message);
  }
  report(threw, "a file with no frontmatter is an error, not a silent skip");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
