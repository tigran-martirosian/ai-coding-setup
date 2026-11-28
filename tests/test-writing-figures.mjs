// Tests for the writing skill's figure check (skills/writing/figure-check.mjs): a rewrite that keeps every figure
// prints nothing and exits 0, also when sentences are reordered or "1,000" becomes "1000"; a figure that changed,
// went or came is named with its line; one file is compared with its last committed copy; a bad path exits 2.
// Run: node tests/test-writing-figures.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REPO = path.join(import.meta.dirname, "..");
const CHECK = path.join(REPO, "skills", "writing", "figure-check.mjs");
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok || !detail ? "" : `\n      ${detail}`}`,
  );
};
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "figure-check-"));
const file = (name, text) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, text);
  return p;
};
const run = (...args) =>
  spawnSync(process.execPath, [CHECK, ...args], { encoding: "utf8", cwd: dir });
const show = (r) => `exit ${r.status}: ${(r.stdout + r.stderr).trim()}`;

const before = file(
  "before.md",
  "The report takes 6 minutes instead of 40.\n\nIt served 1,000 users at 99.5% uptime in 2026.\n",
);

{
  const after = file(
    "same.md",
    "In 2026 it served 1000 users, with 99.5% uptime.\n\nNow the report takes 6 minutes, down from 40.\n",
  );
  const r = run(before, after);
  check(
    "same figures, reworded and reordered: exit 0, no figure named",
    r.status === 0 && !/^(went|came):/m.test(r.stdout),
    show(r),
  );
}
{
  const after = file(
    "changed.md",
    "The report takes 5 minutes instead of 40.\n\nIt served 1,000 users at 99.5% uptime in 2026.\n",
  );
  const r = run(before, after);
  check(
    "a changed figure: exit 1, the old one named with its line, the new one with its line",
    r.status === 1 &&
      /6\b.*line 1/.test(r.stdout) &&
      /5\b.*line 1/.test(r.stdout),
    show(r),
  );
}
{
  const after = file(
    "dropped.md",
    "The report takes 6 minutes instead of 40.\n\nIt served 1,000 users in 2026.\n",
  );
  const r = run(before, after);
  check(
    "a dropped figure is named",
    r.status === 1 && /99\.5%/.test(r.stdout),
    show(r),
  );
}
{
  const after = file(
    "added.md",
    "The report takes 6 minutes instead of 40.\n\nIt served 1,000 users at 99.5% uptime in 2026, for $12 a month.\n",
  );
  const r = run(before, after);
  check(
    "an added figure is named",
    r.status === 1 && /\$12/.test(r.stdout),
    show(r),
  );
}
{
  const r = run(before, path.join(dir, "missing.md"));
  check("a missing file stops with exit 2", r.status === 2, show(r));
}
{
  const g = (...a) => spawnSync("git", a, { cwd: dir, encoding: "utf8" });
  g("init", "-q");
  g("-c", "user.name=t", "-c", "user.email=t@t", "add", "before.md");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x");
  fs.writeFileSync(
    before,
    "The report takes 6 minutes instead of 45.\n\nIt served 1,000 users at 99.5% uptime in 2026.\n",
  );
  const r = run(before);
  check(
    "one file: compared with its last commit",
    r.status === 1 && /40/.test(r.stdout) && /45/.test(r.stdout),
    show(r),
  );
}

fs.rmSync(dir, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
