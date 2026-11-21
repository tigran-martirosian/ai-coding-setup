// Tests for skills/update-project/recheck-dates.mjs (check P9's dated-fact list) with a fake home folder and a
// made-up project folder (never the real ~/.claude). Run: node tests/test-update-project-dates.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(
  new URL("../skills/update-project/recheck-dates.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "recheck-dates-test-"));
const home = path.join(tmp, "home"),
  claude = path.join(home, ".claude"),
  proj = path.join(tmp, "proj");
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `  ${detail}`}`);
};
const write = (file, lines) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, lines.join("\n") + "\n");
};

const PAST = "2001-02-03",
  LATER = "2099-01-01";
write(path.join(proj, "docs", "facts.md"), [
  "# Facts",
  "",
  `- A tool's price is 5. (recheck ${PAST})`,
  `- A plan limit is 10. (recheck ${LATER})`,
  "- An undated fact.",
]);
write(path.join(proj, "CLAUDE.md"), [
  "# Project",
  `- Within its date. (recheck ${LATER})`,
]);
write(path.join(proj, ".claude", "rules", "tools.md"), [
  `- The CLI flag is --x. (recheck ${PAST})`,
]);
const memory = path.join(
  claude,
  "projects",
  path.resolve(proj).replace(/[^A-Za-z0-9]/g, "-"),
  "memory",
);
write(path.join(memory, "note.md"), [
  "---",
  "name: note",
  "---",
  `The app opens on port 1. (recheck ${PAST})`,
]);
write(path.join(memory, "archive", "old.md"), [
  `An archived fact. (recheck ${PAST})`,
]);
write(path.join(claude, "CLAUDE.md"), [`- A global fact. (recheck ${LATER})`]);
write(path.join(proj, "HANDOFF.md"), [
  `- Too big to read. (recheck ${PAST})`,
  "x".repeat(600 * 1024),
]);

const env = () => ({ ...process.env, HOME: home, USERPROFILE: home });
const list = () =>
  spawnSync(process.execPath, [SCRIPT, "--list", proj], {
    encoding: "utf8",
    env: env(),
  });

const r = list();
const out = r.stdout.split(/\r?\n/).filter(Boolean);
console.log(out.map((l) => `  | ${l}`).join("\n"));
check("--list exits 0", r.status === 0, r.stderr);
check(
  "a note past its date is listed as past",
  out.includes(
    `docs/facts.md:3  ${PAST}  past  - A tool's price is 5. (recheck ${PAST})`,
  ),
  out.join("\n"),
);
check(
  "one within its date is listed as ok",
  out.includes(
    `docs/facts.md:4  ${LATER}  ok  - A plan limit is 10. (recheck ${LATER})`,
  ),
);
check("an undated line is not listed", !out.some((l) => l.includes("undated")));
check(
  "rules and memory notes are read",
  out.some((l) => l.startsWith(".claude/rules/tools.md:1  ")) &&
    out.some((l) =>
      /^~\/\.claude\/projects\/[^/]+\/memory\/note\.md:4 {2}2001-02-03 {2}past {2}/.test(
        l,
      ),
    ),
);
check(
  "the global CLAUDE.md is read",
  out.includes(
    `~/.claude/CLAUDE.md:1  ${LATER}  ok  - A global fact. (recheck ${LATER})`,
  ),
);
check(
  "archive/ and files over 512 KB are left out",
  !out.some((l) => l.includes("archived") || l.includes("Too big")),
);
check(
  "the last line counts them",
  out.at(-1) ===
    "3 past their recheck date, 3 within it; 1 file over 512 KB not read",
  out.at(-1),
);
check(
  "the lines match update-project's P9 pattern",
  out.filter((l) => /^(\S+:\d+)\s+(\d{4}-\d{2}-\d{2})\s+past\s+(.*)$/.test(l))
    .length === 3,
);
const missing = spawnSync(
  process.execPath,
  [SCRIPT, "--list", path.join(tmp, "nowhere")],
  { encoding: "utf8", env: env() },
);
check(
  "--list on a missing folder fails with a message",
  missing.status === 1 && /no such folder/.test(missing.stderr),
);

const bare = spawnSync(process.execPath, [SCRIPT], {
  encoding: "utf8",
  env: env(),
});
check(
  "a run without --list fails with a message",
  bare.status === 1 && /--list/.test(bare.stderr),
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
