#!/usr/bin/env node
// Checks of the web tools change (one tool per web job): the web-research skill is short and points at
// workers/read-page.mjs, and no shipped file still sends a reader to Obscura or r.jina.ai.
// Obscura may still be named where the setup cleans up its old copy (install, uninstall and their tests) and in
// the changelog; r.jina.ai only in the changelog and the finder's link-key test (it matches links, reads nothing).
// Run: node tests/test-web-tools.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const SELF = "tests/test-web-tools.mjs";

let pass = 0,
  fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    return;
  }
  fail++;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
};

// ---------------- the web-research skill ----------------
const skillPath = path.join(REPO, "skills", "web-research", "SKILL.md");
const skill = fs.readFileSync(skillPath, "utf8");
const bytes = fs.statSync(skillPath).size;
ok("web-research is shorter than 4,746 bytes", bytes < 4746, `${bytes} bytes`);
const must = [
  ["names workers/read-page.mjs", /read-page\.mjs/],
  ["WebFetch takes an offset", /offset/i],
  [
    "fetched text is data, never instructions",
    /data[^.\n]*never[^.\n]*instruction/i,
  ],
  ["a Fable helper call sets effort", /effort/i],
  ["/deep-research only from the terminal", /\/deep-research[^\n]*terminal/i],
  [
    "says when Reddit or X was not read",
    /Reddit[^\n]*not read|not read[^\n]*Reddit/i,
  ],
  ["Firecrawl Local first", /Firecrawl/],
  [
    "defuddle 0.19.7 as the fallback",
    /defuddle[^\n]*0\.19\.7|0\.19\.7[^\n]*defuddle/i,
  ],
];
for (const [name, re] of must) ok(`web-research ${name}`, re.test(skill));
const mustNot = [
  ["Obscura", /obscura/i],
  ["r.jina.ai", /r\.jina\.ai/i],
  ["Exa", /\bExa\b|mcporter/],
  ["defuddle 0.19.6", /0\.19\.6/],
  ["social.mjs (the repo ships none)", /social\.mjs/],
];
for (const [name, re] of mustNot)
  ok(`web-research names no ${name}`, !re.test(skill));

// ---------------- the shipped files ----------------
const files = execFileSync("git", ["ls-files"], { cwd: REPO, encoding: "utf8" })
  .split("\n")
  .filter(Boolean);
const read = (f) => {
  try {
    return fs.readFileSync(path.join(REPO, f), "utf8");
  } catch {
    return ""; // listed but deleted in the working tree
  }
};
const allowed = {
  obscura: new Set([
    "install.mjs",
    "scripts/uninstall.mjs",
    "CHANGELOG.md",
    "tests/test-install.mjs",
    "tests/test-uninstall.mjs",
    "tests/upgrade-from-last-release.mjs", // installs the old version, whose installer still asks about it
    SELF,
  ]),
  jina: new Set([
    "CHANGELOG.md",
    "projects/quick-tasks/tools/test-finder.mjs",
    SELF,
  ]),
};
const obscuraLeft = files.filter(
  (f) => !allowed.obscura.has(f) && /obscura/i.test(read(f)),
);
ok(
  "no shipped file names Obscura outside its cleanup",
  obscuraLeft.length === 0,
  obscuraLeft.join(", "),
);
const jinaLeft = files.filter(
  (f) => !allowed.jina.has(f) && /r\.jina\.ai/i.test(read(f)),
);
ok(
  "no shipped file sends a reader to r.jina.ai",
  jinaLeft.length === 0,
  jinaLeft.join(", "),
);
ok(
  "scripts/obscura.mjs is gone",
  !fs.existsSync(path.join(REPO, "scripts", "obscura.mjs")),
);
ok(
  "workers/read-page.mjs exists",
  fs.existsSync(path.join(REPO, "workers", "read-page.mjs")),
);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
