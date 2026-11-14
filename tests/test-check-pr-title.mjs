// Tests for scripts/check-pr-title.mjs, the pull-request title check of CI: type and length only.
// Run: node tests/test-check-pr-title.mjs
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const CHECK = fileURLToPath(
  new URL("../scripts/check-pr-title.mjs", import.meta.url),
);
let fails = 0;
const ok = (name, got, want) => {
  const pass = got === want;
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};
const run = (...args) =>
  spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8" });
const exit = (title) => run(title).status;

const long = `fix: ${"a".repeat(85)}`;
ok("a 90-character title is refused", exit(long), 1);
ok("the reason names the length", /90 characters/.test(run(long).stderr), true);
ok("a title with no type is refused", exit("read S3 keys once"), 1);
ok("an unknown type is refused", exit("feature: read S3 keys once"), 1);
ok("a type with no space after the colon is refused", exit("fix:read keys"), 1);
ok("a type with a scope is refused", exit("fix(hooks): read keys"), 1);
ok("a capital type is refused", exit("Fix: read keys"), 1);
ok("fix: read S3 keys once is accepted", exit("fix: read S3 keys once"), 0);
ok("a 72-character title is accepted", exit(`fix: ${"a".repeat(67)}`), 0);
// Dependabot with commit-message prefix "build": a colon and a space follow a prefix that ends with a letter
// (GitHub's Dependabot options reference, "commit-message"); "bump" is lower case after a lower-case prefix, and a
// folder other than the top one is added as "in /<folder>" (dependabot-core, pr_name_prefixer.rb, message_builder.rb).
ok(
  "a Dependabot actions title is accepted",
  exit("build: bump actions/checkout from 7.0.1 to 7.1.0"),
  0,
);
ok(
  "a Dependabot npm title in an extension folder is accepted",
  exit("build: bump esbuild from 0.28.2 to 0.28.3 in /extensions/commands"),
  0,
);
ok("no title is a usage error", run().status, 2);
ok("an empty title is a usage error", exit(""), 2);
// Ids of open plan rows are the commit hook's check, not CI's.
ok("a row-like word passes in CI", exit("fix: drop P3 keys"), 0);

console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
