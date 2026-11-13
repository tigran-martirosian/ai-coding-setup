// Tests for chat-review's read-digests.mjs (skills/setup-audit/scripts/read-digests.mjs): it writes
// one <project>.task.md per digest for a `worker` subagent to follow, mainly the --earlier rows.
// Run: node test-read-digests.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "skills", "setup-audit", "scripts");
const READ = path.join(SKILL, "read-digests.mjs");
const TASK = fs.readFileSync(path.join(SKILL, "reader-task.txt"), "utf8");
let fails = 0;
const ok = (name, pass, detail = "") => { if (!pass) fails++; console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "read-digests-test-"));

let n = 0;
function setup(names) {
  const d = path.join(tmp, `case${++n}`);
  fs.mkdirSync(d);
  for (const f of names) fs.writeFileSync(path.join(d, f), `# ${f}\n3 chats, 7 requests\n### S1 2026-10-12 "x" (7 requests)\n`);
  return d;
}
const run = (dir, ...extra) => spawnSync(process.execPath, [READ, dir, ...extra], { encoding: "utf8" });
// a task file: the digest to read, reader-task.txt (plus any earlier fixes), then the findings file to write last,
// so "the file named above" in reader-task.txt can only mean the digest
const head = (d, name) => `Read the file ${path.join(d, name + ".md")}.

`;
const tail = (d, name) => `

Write your answer to the file ${path.join(d, name + ".findings.md")}: it is the one file you write ("do not write files" above does not apply to it). Then reply with one line.
`;
const fileOf = (d, f) => fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), "utf8") : null;
const decided = (rows) => `# Findings\n\n## Decided\n\n| Proposal | Ticked or declined | Where it went |\n|---|---|---|\n${rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2] || "CLAUDE.md"} |`).join("\n")}\n\n## Seen, nothing to change\n- x\n`;
const earlierFile = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };

// 1. no --earlier: the task file is the head plus reader-task.txt, one line is printed, no findings file is made
{
  const d = setup(["alpha.md"]);
  fs.writeFileSync(path.join(d, "alpha.findings.md"), "stale");
  fs.writeFileSync(path.join(d, "skipped.task.md"), "left by an earlier run");
  const r = run(d);
  const got = fileOf(d, "alpha.task.md");
  ok("1e a task file left by an earlier run is removed", fileOf(d, "skipped.task.md") === null);
  ok("1a no --earlier: task file is the head plus reader-task.txt", r.status === 0 && got === head(d, "alpha") + TASK.trimEnd() + tail(d, "alpha") && !got.includes("EARLIER FIXES"), `status ${r.status} ${r.stdout}`);
  ok("1b one line for the project; the stale findings file is gone (a worker writes it)", r.stdout.trim().split("\n").length === 1 && r.stdout.includes("alpha.md: task written -> alpha.task.md") && fileOf(d, "alpha.findings.md") === null, r.stdout);
  const again = run(d);
  ok("1c a second run does not take the task file for a digest", again.status === 0 && again.stdout.trim().split("\n").length === 1 && fileOf(d, "alpha.task.task.md") === null, again.stdout);
}

// 1d. a project with fewer than 5 requests is skipped: no task file
{
  const d = setup(["alpha.md"]);
  fs.writeFileSync(path.join(d, "tiny.md"), "# tiny\n1 chats, 3 requests\n");
  const r = run(d);
  ok("1d fewer than 5 requests: skipped, no task file", r.status === 0 && /tiny\.md: skipped, only 3 requests/.test(r.stdout) && fileOf(d, "tiny.task.md") === null && fileOf(d, "alpha.task.md") !== null, r.stdout);
}

// 2. ticked rows go to their project, Everywhere to all, declined and other projects stay out
const f2 = earlierFile("findings-2026-10-10.md", decided([
  ["alpha: first fix", "Ticked"], ["alpha: second fix", "ticked, with a change"], ["Everywhere: a global fix", "Ticked"],
  ["beta: beta fix", "Ticked"], ["alpha: declined fix", "Declined"], ["no colon so no project", "Ticked"],
]));
{
  const d = setup(["alpha.md", "beta.md"]);
  const r = run(d, "--earlier", f2);
  const a = fileOf(d, "alpha.task.md") || "", b = fileOf(d, "beta.task.md") || "";
  ok("2a project A: its two rows plus Everywhere, numbered", r.status === 0 && a.includes("   1. alpha: first fix") && a.includes("   2. alpha: second fix") && a.includes("   3. Everywhere: a global fix"), a);
  ok("2b project A: date, no B row, no declined row", a.includes("on 2026-10-10 the fixes") && a.includes("dated after 2026-10-10") && !a.includes("beta fix") && !a.includes("declined fix") && !a.includes("no colon"), a);
  ok("2c project A: head, then the text of reader-task.txt, then an empty line", a.startsWith(head(d, "alpha")) && a.endsWith(tail(d, "alpha")) && a.includes(`${TASK.trimEnd()}\n\nOne more heading after H, outside the 80 lines:\n\nI. EARLIER FIXES`), a);
  ok("2d project B: its row and Everywhere", b.includes("   2. beta: beta fix") && b.includes("   1. Everywhere: a global fix") && !b.includes("alpha: first"), b);
}

// 3. a space in the project name matches the dashed digest name
{
  const f = earlierFile("findings-2026-10-09.md", decided([["sample projects: fix one", "Ticked"]]));
  const d = setup(["sample-projects.md"]);
  const r = run(d, "--earlier", f);
  const a = fileOf(d, "sample-projects.task.md") || "";
  ok("3 'sample projects' matches sample-projects.md", r.status === 0 && a.includes("   1. sample projects: fix one"), a);
}

// 4. errors: missing file, no Decided table, no date in the name
{
  const d = setup(["alpha.md"]);
  const cases = [
    ["4a missing file", path.join(tmp, "findings-2026-01-01.md")],
    ["4b no Decided section", earlierFile("findings-2026-10-08.md", "# Findings\n\nNothing here.\n")],
    ["4c no date in the name", earlierFile("findings-latest.md", decided([["alpha: x", "Ticked"]]))],
  ];
  for (const [name, file] of cases) {
    const r = run(d, "--earlier", file);
    ok(`${name}: exit 1, a message, no task file`, r.status === 1 && r.stdout.trim().length > 0 && !fileOf(d, "alpha.task.md"), `status ${r.status} ${r.stdout}`);
  }
}

// 5. only declined rows: not an error, task as without --earlier
{
  const f = earlierFile("findings-2026-10-07.md", decided([["alpha: x", "Declined"], ["Everywhere: y", "declined"]]));
  const d = setup(["alpha.md"]);
  const r = run(d, "--earlier", f);
  const got = fileOf(d, "alpha.task.md");
  ok("5 only declined rows: exit 0, task without earlier fixes", r.status === 0 && got === head(d, "alpha") + TASK.trimEnd() + tail(d, "alpha") && /No ticked fixes/.test(r.stdout), `status ${r.status} ${r.stdout}`);
}

// 6. ticked rows that cannot be scored are reported; Everywhere rows are not
{
  const f = earlierFile("findings-2026-10-06.md", decided([["alpha: fine", "Ticked"], ["ghost: gone", "Ticked"], ["no colon here", "Ticked"], ["Everywhere: all", "Ticked"]]));
  const d = setup(["alpha.md"]);
  const r = run(d, "--earlier", f);
  ok("6a no digest for the project: one line", r.status === 0 && r.stdout.includes("Earlier fix not scored (no digest for it this time): ghost: gone"), `status ${r.status} ${r.stdout}`);
  ok("6b no colon: one line", r.stdout.includes("Earlier fix not scored (no project before a colon): no colon here"), r.stdout);
  ok("6c scored and Everywhere rows not reported", !/not scored.*(alpha: fine|Everywhere)/.test(r.stdout), r.stdout);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} FAILED` : "all passed");
process.exit(fails ? 1 : 0);
