// Tests for the carve of ~/.claude/CLAUDE.md in install.mjs (scripts/rules.mjs), on temporary home folders.
// Design checks 1-9, 15, 16 (docs/2026-11-09-b8b-design.md). Run: node tests/test-rules-carve.mjs
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.SETUP_CC_CHECK = "off";
const REPO = fileURLToPath(new URL("..", import.meta.url));
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`);
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "carve-test-"));
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const install = (home, ...flags) => {
  const r = spawnSync(process.execPath, [path.join(REPO, "install.mjs"), "--home", home, ...flags], { encoding: "utf8", env: { ...process.env, PATH: emptyPath, Path: emptyPath } });
  return { code: r.status, out: r.stdout + r.stderr };
};
const read = (f) => fs.readFileSync(f, "utf8");
const json = (f) => JSON.parse(read(f));
const sha = (t) => crypto.createHash("sha256").update(t).digest("hex");
// the rules line, without the "[dry run] " a dry run puts before each line
const line = (out) => out.split("\n").map((l) => l.replace(/^\[dry run\] /, "")).find((l) => l.startsWith("rules: ")) || "";
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : [path.join(dir, e.name)]));
const snap = (dir) => files(dir).sort().map((f) => [f, read(f)]);

const home = path.join(tmp, "a");
const claude = path.join(home, ".claude");
const rulesFile = path.join(claude, "CLAUDE.md");
const myRules = path.join(claude, "rules", "my-rules.md");
const stateFile = path.join(claude, "setup-state.json");
ok("install exits cleanly", install(home).code, 0);
const built = read(rulesFile);

// Check 1: rules as a run last wrote them are replaced with no carve and no my-rules.md
fs.writeFileSync(rulesFile, "# Rules of an older version\n");
fs.writeFileSync(stateFile, JSON.stringify({ ...json(stateFile), rules: sha("# Rules of an older version\n") }));
const fast = install(home);
ok("check 1: replaced as before, no my-rules.md, no undo record",
  [line(fast.out).startsWith(`rules: replaced ${rulesFile.replace(/\\/g, "/")}`), read(rulesFile) === built, fs.existsSync(myRules), "rulesUndo" in json(stateFile)], [true, true, false, false]);

// Checks 2-7 in one changed file: a deleted rule, an edited one, a re-wrapped one, an own bullet with its
// continuation lines and nested bullet, an own section, an old setup heading, all with CRLF line endings
const bullet = (start) => built.split("\n").find((l) => l.startsWith(start));
const ask = bullet("- **Ask when the user is faster.**");
const assume = bullet("- **Don't assume.**");
const recommended = bullet("- **Recommended answers.**");
const edited = assume.replace("focused", "sharp");
const OWN4 = "- **My tables first.** Look in the reports schema before\n  asking where data lives.\n  - Nested: the archive schema is read-only.";
const FIELD = "# My field\n\n- One.\n- Two,\n  wrapped.\n- Three.\n";
const person = (built.replace(ask + "\n", "").replace(assume, edited + "\n" + OWN4).replace(recommended, recommended.split(" ").reduce((a, w, i) => a + (i ? (i % 7 ? " " : "\n  ") : "") + w, ""))
  .replace("\n# Web research", "\n## External workers first for gathering information\n\n# Web research") + "\n" + FIELD).replace(/\n/g, "\r\n");
ok("the test's file has its changes", [!!ask, edited !== assume, person.includes("\r\n  ")], [true, true, true]);
fs.writeFileSync(rulesFile, person);
const carved = install(home);
const undo = json(stateFile).rulesUndo;
ok("carve exits cleanly", carved.code, 0);
ok("checks 2, 3: the deleted rule is back and the edited one has the shipped wording (the file is this version's whole)", read(rulesFile) === built, true);
ok("checks 3, 4, 5: my-rules.md has the edited wording, the own bullet in full and the own section in order",
  read(myRules), `## How to work\n\n${edited}\n${OWN4}\n\n## My field\n\n- One.\n- Two,\n  wrapped.\n- Three.\n`);
ok("checks 2, 6, 7: the counts (2 new or changed, the old heading removed, 5 moved; CRLF and re-wrapped count as shipped)",
  /^rules: brought up to this version: 2 setup rules new or changed, 1 old ones removed, 5 of yours moved to ~\/\.claude\/rules\/my-rules\.md \(old copy: CLAUDE\.md\.before-install-[\d-]+; undo: node ~\/\.claude\/skills\/update-setup\/own-rules\.mjs --undo\)$/.test(line(carved.out)), true);
ok("checks 3, 6: the dated copy has the person's file byte for byte", read(undo.files[0].copy), person);
ok("the undo record: the rules with their copy, my-rules.md created by the run", [undo.by, undo.files.map((f) => [f.file, f.copy === null])],
  ["carve", [[rulesFile.replace(/\\/g, "/"), false], [myRules.replace(/\\/g, "/"), true]]]);
ok("a carve on a recorded install is not a user copy", (json(stateFile).userCopies || []).includes(undo.files[0].copy), false);

// Check 8: an existing my-rules.md keeps its text; a block already there is not added again
const firstMine = read(myRules);
fs.writeFileSync(rulesFile, built + "\n# My field\n\n- One.\n- Four.\n");
install(home);
const undo8 = json(stateFile).rulesUndo;
ok("check 8: my-rules.md is the old text plus the one new block", read(myRules), firstMine + "\n- Four.\n");
ok("check 8: the undo record keeps the earlier my-rules.md", read(undo8.files[1].copy), firstMine);

// Check 9: a second update right after changes nothing
const before = snap(claude);
const again = install(home);
ok("check 9: rules: up to date and nothing changes", [line(again.out), JSON.stringify(snap(claude)) === JSON.stringify(before)], ["rules: up to date", true]);

// Check 16: --dry-run prints the counts and writes nothing
fs.writeFileSync(rulesFile, built + "\n- Five.\n");
const beforeDry = snap(claude);
const dry = install(home, "--dry-run");
ok("check 16: --dry-run prints the counts and writes nothing",
  [/^rules: brought up to this version: 0 setup rules new or changed, 0 old ones removed, 1 of yours moved/.test(line(dry.out)), JSON.stringify(snap(claude)) === JSON.stringify(beforeDry)], [true, true]);
fs.writeFileSync(rulesFile, built); // the dry run wrote nothing, so put the file back for the checks below

// Check 15: a CLAUDE.md from before the first install
const homeB = path.join(tmp, "b");
const claudeB = path.join(homeB, ".claude");
fs.mkdirSync(claudeB, { recursive: true });
fs.writeFileSync(path.join(claudeB, "CLAUDE.md"), "# My rules\n\n- Mine.\n");
const firstB = install(homeB);
const undoB = json(path.join(claudeB, "setup-state.json")).rulesUndo;
ok("check 15: its blocks go to my-rules.md and its dated copy is on userCopies",
  [read(path.join(claudeB, "rules", "my-rules.md")), json(path.join(claudeB, "setup-state.json")).userCopies.includes(undoB.files[0].copy), /1 of yours moved/.test(line(firstB.out))],
  ["## My rules\n\n- Mine.\n", true, true]);
const un = install(homeB, "--uninstall");
ok("check 15: --uninstall puts the copy back and says my-rules.md stays",
  [un.code, read(path.join(claudeB, "CLAUDE.md")), un.out.includes("my-rules.md stays"), fs.existsSync(path.join(claudeB, "rules", "my-rules.md"))], [0, "# My rules\n\n- Mine.\n", true, true]);

// Check 13: conditions. Without Nimbalyst (a --home run) the file-card rule is absent, with it present
const CARD = "- **A task written to a file gets short lines:**";
ok("check 13: without Nimbalyst the file-card rule is left out", read(rulesFile).includes(CARD), false);
const homeC = path.join(tmp, "c");
install(homeC, "--nimbalyst", "yes");
ok("check 13: with Nimbalyst it is there, and --nimbalyst is not stored", [read(path.join(homeC, ".claude", "CLAUDE.md")).includes(CARD), "nimbalyst" in json(path.join(homeC, ".claude", "setup-state.json"))], [true, false]);
const { splitBlocks, lead } = await import(new URL("../scripts/blocks.mjs", import.meta.url));
const { sameLead } = await import(new URL("../scripts/rules.mjs", import.meta.url));
const shippedLeads = splitBlocks(read(path.join(REPO, "rules", "CLAUDE.md"))).map((b) => lead(b.text));
ok("check 13: every key in conditions.json matches a block of rules/CLAUDE.md",
  Object.keys(json(path.join(REPO, "rules", "conditions.json"))).filter((k) => !shippedLeads.some((l) => sameLead(l, k))), []);

// Check 12: --leave-out and --put-back; a left-out rule still in the person's file is not theirs
const DONT = "- **Don't assume.**";
fs.writeFileSync(rulesFile, read(rulesFile) + "\n- Six.\n");
const mineBefore = read(myRules); // already holds the edited "Don't assume" wording from check 3
const left = install(home, "--leave-out", "Don't assume");
ok("check 12: the rule is absent on this run, only the own block appended to my-rules.md, and on record",
  [left.code, read(rulesFile).includes(DONT), read(myRules).slice(mineBefore.length), json(stateFile).rulesLeftOut], [0, false, "\n## Web research\n\n- Six.\n", ["Don't assume."]]);
install(home);
ok("check 12: and absent on the next update", read(rulesFile).includes(DONT), false);
install(home, "--put-back", "don't assume");
ok("check 12: --put-back restores it and clears the record", [read(rulesFile).includes(DONT), "rulesLeftOut" in json(stateFile)], [true, false]);
const beforeBad = snap(claude);
const bad = install(home, "--leave-out", "No such rule");
ok("check 12: an unknown lead stops with the list of leads and writes nothing",
  [bad.code, bad.out.includes('--leave-out "No such rule": no rule of this version starts like that'), bad.out.includes("  Don't assume."), JSON.stringify(snap(claude)) === JSON.stringify(beforeBad)], [1, true, true, true]);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
