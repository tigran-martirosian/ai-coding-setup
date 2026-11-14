// Tests for hooks/recheck-dates.mjs with a fake home folder and a made-up project folder (never the real ~/.claude).
// Run: node tests/test-recheck-dates.mjs
process.env.HOOK_ERRORS_LOG = "off";

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/recheck-dates.mjs", import.meta.url),
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

// never the real backup folder: none set up unless a test names one
const env = (extra = {}) => ({
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  RECHECK_DATES: "",
  CLAUDE_PROJECT_DIR: proj,
  CLAUDE_BACKUP_HOME: path.join(tmp, "no-backup"),
  ...extra,
});
const list = () =>
  spawnSync(process.execPath, [HOOK, "--list", proj], {
    encoding: "utf8",
    env: env(),
  });
const hook = (extra) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: "SessionStart",
      source: "startup",
      cwd: proj,
    }),
    encoding: "utf8",
    env: env(extra),
  });
  return {
    code: r.status,
    out: r.stdout ? JSON.parse(r.stdout) : null,
    raw: r.stdout + r.stderr,
  };
};

// --list: every dated line in its form, past and ok, then the counts
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
  [HOOK, "--list", path.join(tmp, "nowhere")],
  { encoding: "utf8", env: env() },
);
check(
  "--list on a missing folder fails with a message",
  missing.status === 1 && /no such folder/.test(missing.stderr),
);

// The hook: off switch, then the message once per folder per day, then silence
check("RECHECK_DATES=off is silent", hook({ RECHECK_DATES: "off" }).raw === "");
const first = hook();
const msg = first.out?.systemMessage || "",
  ctx = first.out?.hookSpecificOutput?.additionalContext || "";
check(
  "the hook tells the user, at most 3 named",
  first.code === 0 &&
    msg.startsWith(
      "3 notes here are past their recheck date: docs/facts.md:3 (2001-02-03)",
    ),
  first.raw,
);
check(
  "the one within its date is not named",
  !msg.includes("docs/facts.md:4") &&
    !msg.includes("CLAUDE.md:") &&
    !ctx.includes("A plan limit"),
);
check(
  "Claude gets the list and the answer-first rule",
  ctx.includes("- docs/facts.md:3 (2001-02-03): - A tool's price is 5.") &&
    ctx.includes("Answer the user's request first"),
);
check(
  "the state file records the folder",
  Object.keys(
    JSON.parse(
      fs.readFileSync(
        path.join(claude, "hooks", "state", "recheck-dates.json"),
        "utf8",
      ),
    ),
  ).length === 1,
);
check("the second start the same day is silent", hook().raw === "");
const fresh = path.join(tmp, "fresh");
write(path.join(fresh, "docs", "facts.md"), [`- Fine. (recheck ${LATER})`]);
check("none past: silent", hook({ CLAUDE_PROJECT_DIR: fresh }).raw === "");

// The stale-backup line: a backup folder (CLAUDE_BACKUP_HOME) backing up a made-up folder, in a folder with no past notes
const bk = path.join(tmp, "backup-home"),
  data = path.join(tmp, "backed-up");
const daysAgo = (n) => new Date(Date.now() - n * 24 * 60 * 60 * 1000);
const aged = (file, days) => {
  write(file, ["x"]);
  fs.utimesSync(file, daysAgo(days), daysAgo(days));
};
aged(path.join(data, "notes.md"), 20);
aged(path.join(data, "node_modules", "pkg", "index.js"), 0); // newer, but the backup leaves node_modules out
const lastRun = (days, ok = true) =>
  fs.writeFileSync(
    path.join(bk, "last-run.json"),
    JSON.stringify({ time: daysAgo(days).toISOString(), ok }),
  );
const backupStamp = path.join(
  claude,
  "hooks",
  "state",
  "recheck-dates-backup.json",
);
const backupHook = () =>
  hook({ CLAUDE_PROJECT_DIR: fresh, CLAUDE_BACKUP_HOME: bk });
fs.mkdirSync(bk);
lastRun(10);
check("backup: no config.json (not set up): silent", backupHook().raw === "");
fs.writeFileSync(
  path.join(bk, "config.json"),
  JSON.stringify({
    target: "b2",
    folders: [{ path: data, exclude: [] }],
    schedule: false,
  }),
);
check(
  "backup: last good run 10 days ago, nothing changed since (a newer file only in node_modules): silent",
  backupHook().raw === "",
);
aged(path.join(data, "new.md"), 0);
lastRun(6);
check(
  "backup: last good run 6 days ago, a file changed since: silent",
  backupHook().raw === "",
);
lastRun(10);
const stale = backupHook();
check(
  "backup: last good run 10 days ago and a file changed since: the line shows",
  stale.code === 0 &&
    stale.out?.systemMessage ===
      "Backup: last good run 10 days ago and files changed since; /backup now runs one" &&
    !stale.out?.hookSpecificOutput,
  stale.raw,
);
check("backup: a second start the same day is silent", backupHook().raw === "");
fs.rmSync(backupStamp);
lastRun(10, false);
check(
  "backup: a last run that failed: silent (no time of a good run)",
  backupHook().raw === "",
);
fs.writeFileSync(path.join(bk, "last-run.json"), "{ not json");
const bad = backupHook();
check(
  "backup: a last-run.json that can't be read: one line naming it, no crash",
  bad.code === 0 &&
    (bad.out?.systemMessage || "").startsWith(
      `Backup: ${path.join(bk, "last-run.json").replace(/\\/g, "/")} could not be read (`,
    ),
  bad.raw,
);
fs.rmSync(backupStamp);
lastRun(10);
check(
  "backup: RECHECK_DATES=off silences the line too",
  hook({
    CLAUDE_PROJECT_DIR: fresh,
    CLAUDE_BACKUP_HOME: bk,
    RECHECK_DATES: "off",
  }).raw === "",
);
write(path.join(tmp, "proj-again", "docs", "facts.md"), [
  `- Old. (recheck ${PAST})`,
]);
const both = hook({
  CLAUDE_PROJECT_DIR: path.join(tmp, "proj-again"),
  CLAUDE_BACKUP_HOME: bk,
});
check(
  "backup: with past notes too, one message has both",
  (both.out?.systemMessage || "").split("\n").length === 2 &&
    !!both.out?.hookSpecificOutput,
  both.raw,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
