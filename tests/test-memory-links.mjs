// Tests for setup-audit's memory-links.mjs (skills/setup-audit/scripts/memory-links.mjs): per memory folder it
// lists the `[[links]]` to no note, index lines whose file is gone, notes with no index line, absolute Windows and
// `~/` paths that don't exist, and notes with no date, so the memory check sees what rotted. Each case is a memory
// folder in a temp home.
// Run: node tests/test-memory-links.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SCRIPT = path.resolve(
  import.meta.dirname,
  "..",
  "skills",
  "setup-audit",
  "scripts",
  "memory-links.mjs",
);
let fails = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`);
};

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "memory-links-test-"));
const home = path.join(tmp, "home");
const WIN = process.platform === "win32";

// A memory folder under the temp home's projects, with the given files ({ "a.md": text })
function folder(project, files) {
  const dir = path.join(home, ".claude", "projects", project, "memory");
  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return dir;
}
const note = (name, body) =>
  `---\nname: ${name}\ndescription: x\nmetadata:\n  type: feedback\n---\n\n${body}\n`;

const run = (...args) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, HOME: home, USERPROFILE: home },
  });
// The finding lines of a run: [folder, kind, note, detail]
const findings = (r) =>
  r.stdout
    .split("\n")
    .filter((l) => l.split("  ").length >= 4)
    .map((l) => l.split("  "));
const has = (r, kind, noteName, detail = "") =>
  findings(r).some(
    (f) =>
      f[1] === kind &&
      f[2] === noteName &&
      f.slice(3).join("  ").includes(detail),
  );

// Real files a note may name: one path with a space in it, one under the home
fs.mkdirSync(path.join(tmp, "with space"), { recursive: true });
fs.writeFileSync(path.join(tmp, "with space", "here.md"), "x");
fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
fs.writeFileSync(path.join(home, ".claude", "here.md"), "x");
const realWin = path.join(tmp, "with space", "here.md");
const goneWin = WIN
  ? path.join(tmp, "no-such", "gone.md")
  : "C:\\no-such\\gone.md";

// One folder with every kind of finding, and things that must not be findings
const bad = folder("C--proj-bad", {
  "MEMORY.md":
    "- [Alpha](alpha.md) — a\n- [Beta](beta.md) — b\n- [Gone](gone-note.md) — the file is gone\n",
  "alpha.md": note(
    "alpha-note",
    "See [[beta]] and [[alpha-note]] and [[missing-note]] and [[old-one]].\n" +
      "**Why:** said on 2026-10-01.",
  ),
  "beta.md": note(
    "beta",
    `Files: \`${goneWin}\`, ~/.claude/no-such.md and ~/.claude/here.md.\n` +
      (WIN
        ? `Real: \`${realWin}\` and ${path.join(tmp, "with space")}.\n`
        : "") +
      "Skipped: https://example.com/C:/x/y, docs/facts.md:12, C:\\Projects\\<name>\\x.md, ~/.claude/projects/*/memory/.",
  ),
  "gamma.md": note("gamma", "Not in the index. (recheck 2027-01-01)"),
  "archive/old.md": note("old-one", "Archived, no date, no index line."),
});

// 1. Before the script exists every case below fails; with it, each kind is seen
let r = run(bad);
ok(
  "a folder with findings exits 1",
  r.status === 1,
  `got ${r.status} ${r.stderr}`,
);
ok(
  "link: a [[link]] to no note is listed",
  has(r, "link", "alpha", "missing-note"),
  r.stdout,
);
ok(
  "link: a [[link]] to a note only in archive/ is listed",
  has(r, "link", "alpha", "old-one"),
  r.stdout,
);
ok(
  "link: links to a file name and to a frontmatter name are not listed",
  !has(r, "link", "alpha", "[[beta]]") &&
    !has(r, "link", "alpha", "alpha-note"),
  r.stdout,
);
ok(
  "index: an index line whose file is missing is listed",
  has(r, "index", "MEMORY", "gone-note.md"),
  r.stdout,
);
ok(
  "orphan: a note with no index line is listed",
  has(r, "orphan", "gamma"),
  r.stdout,
);
ok(
  "orphan: notes in archive/ are left out",
  !findings(r).some((f) => f[2] === "old"),
  r.stdout,
);
ok(
  "path: a missing Windows path is listed",
  has(r, "path", "beta", goneWin),
  r.stdout,
);
ok(
  "path: a missing ~/ path is listed",
  has(r, "path", "beta", "~/.claude/no-such.md"),
  r.stdout,
);
ok(
  "path: existing paths, URLs, repo-relative paths, placeholders and wildcards are not listed",
  findings(r).filter((f) => f[1] === "path").length === 2,
  r.stdout,
);
ok(
  "undated: a note with no YYYY-MM-DD is listed",
  has(r, "undated", "beta"),
  r.stdout,
);
ok(
  "undated: a Why-line date and a (recheck) date count as dates",
  !has(r, "undated", "alpha") && !has(r, "undated", "gamma"),
  r.stdout,
);
ok(
  "the last line counts the findings by kind",
  /2 link, 1 index, 1 orphan, 2 path, 1 undated/.test(
    r.stdout.trim().split("\n").at(-1),
  ),
  r.stdout,
);

// 2. A clean folder exits 0
const clean = folder("C--proj-clean", {
  "MEMORY.md": "- [One](one.md) — one\n- [Two](two.md) — two\n",
  "one.md": note(
    "one",
    "See [[two]]. Real: ~/.claude/here.md\n**Why:** 2026-11-01.",
  ),
  "two.md": note("two", "Fine. modified: 2026-11-02"),
});
r = run(clean);
ok(
  "a clean folder exits 0",
  r.status === 0,
  `got ${r.status} ${r.stdout}${r.stderr}`,
);
ok("a clean folder lists no finding", findings(r).length === 0, r.stdout);

// 3. --json gives the same findings as data
r = run("--json", bad);
let data;
try {
  data = JSON.parse(r.stdout);
} catch {
  data = null;
}
ok("--json prints one JSON object", !!data, r.stdout);
ok(
  "--json lists each finding with folder, kind, note and detail",
  data?.findings?.length === 7 &&
    data.findings.every((f) => f.folder && f.kind && f.note && f.detail),
  r.stdout,
);
ok(
  "--json counts the kinds and exits 1",
  data?.counts?.link === 2 && data?.counts?.undated === 1 && r.status === 1,
  `${r.status} ${r.stdout}`,
);

// 4. No folder named: every ~/.claude/projects/*/memory/ under the home override
r = run();
ok(
  "no folder: every project's memory folder is read",
  findings(r).some((f) => f[0] === "C--proj-bad") &&
    /2 folders/.test(r.stdout.trim().split("\n").at(-1)),
  r.stdout + r.stderr,
);

// 5. A named folder that does not exist is an error, not a clean run
r = run(path.join(tmp, "no-such-folder"));
ok(
  "a missing folder exits 2 with an error",
  r.status === 2 && /no-such-folder/.test(r.stderr),
  `${r.status} ${r.stderr}`,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
