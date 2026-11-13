// Tests for chat-review's read-digests.mjs (projects/claude-settings/.claude/skills/chat-review/read-digests.mjs), mainly --earlier.
// Run: node test-read-digests.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL = path.join(HERE, "..", "projects", "claude-settings", ".claude", "skills", "chat-review");
const READ = path.join(SKILL, "read-digests.mjs");
const TASK = fs.readFileSync(path.join(SKILL, "reader-task.txt"), "utf8");
let fails = 0;
const ok = (name, pass, detail = "") => { if (!pass) fails++; console.log(`${pass ? "ok  " : "FAIL"} ${name}${pass ? "" : ` ${detail}`}`); };

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "read-digests-test-"));
// fake worker: prints the text of the task file it is given
const fake = path.join(tmp, "fake-ask.mjs");
fs.writeFileSync(fake, 'import fs from "node:fs"; process.stdout.write(fs.readFileSync(process.argv[2], "utf8"));\n');

let n = 0;
function setup(names) {
  const d = path.join(tmp, `case${++n}`);
  fs.mkdirSync(d);
  for (const f of names) fs.writeFileSync(path.join(d, f), `# ${f}\n3 chats, 7 requests\n### S1 2026-10-12 "x" (7 requests)\n`);
  return d;
}
const run = (dir, ...extra) => spawnSync(process.execPath, [READ, dir, ...extra], { encoding: "utf8", env: { ...process.env, CHAT_REVIEW_ASK: fake } });
const findingsOf = (d, f) => fs.existsSync(path.join(d, f)) ? fs.readFileSync(path.join(d, f), "utf8") : null;
const decided = (rows) => `# Findings\n\n## Decided\n\n| Proposal | Ticked or declined | Where it went |\n|---|---|---|\n${rows.map((r) => `| ${r[0]} | ${r[1]} | ${r[2] || "CLAUDE.md"} |`).join("\n")}\n\n## Seen, nothing to change\n- x\n`;
const earlierFile = (name, text) => { const p = path.join(tmp, name); fs.writeFileSync(p, text); return p; };

// 1. no --earlier: the prompt is exactly the old one
{
  const d = setup(["alpha.md"]);
  const r = run(d);
  const got = findingsOf(d, "alpha.findings.md");
  const want = `Read the file ${path.join(d, "alpha.md")}.\n\n${TASK}`;
  ok("1 no --earlier: prompt is the old one", r.status === 0 && got?.trim() === want.trim() && !got.includes("EARLIER FIXES"), `status ${r.status} ${r.stdout}`);
}

// 2. ticked rows go to their project, Everywhere to all, declined and other projects stay out
const f2 = earlierFile("findings-2026-10-10.md", decided([
  ["alpha: first fix", "Ticked"], ["alpha: second fix", "ticked, with a change"], ["Everywhere: a global fix", "Ticked"],
  ["beta: beta fix", "Ticked"], ["alpha: declined fix", "Declined"], ["no colon so no project", "Ticked"],
]));
{
  const d = setup(["alpha.md", "beta.md"]);
  const r = run(d, "--earlier", f2);
  const a = findingsOf(d, "alpha.findings.md") || "", b = findingsOf(d, "beta.findings.md") || "";
  ok("2a project A: its two rows plus Everywhere, numbered", r.status === 0 && a.includes("   1. alpha: first fix") && a.includes("   2. alpha: second fix") && a.includes("   3. Everywhere: a global fix"), a);
  ok("2b project A: date, no B row, no declined row", a.includes("on 2026-10-10 the fixes") && a.includes("dated after 2026-10-10") && !a.includes("beta fix") && !a.includes("declined fix") && !a.includes("no colon"), a);
  ok("2c project A: the text of reader-task.txt comes first, then an empty line", a.includes(`${TASK.trimEnd()}\n\nOne more heading after H, outside the 80 lines:\n\nI. EARLIER FIXES`), a);
  ok("2d project B: its row and Everywhere", b.includes("   2. beta: beta fix") && b.includes("   1. Everywhere: a global fix") && !b.includes("alpha: first"), b);
}

// 3. a space in the project name matches the dashed digest name
{
  const f = earlierFile("findings-2026-10-09.md", decided([["sample projects: fix one", "Ticked"]]));
  const d = setup(["sample-projects.md"]);
  const r = run(d, "--earlier", f);
  const a = findingsOf(d, "sample-projects.findings.md") || "";
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
    ok(`${name}: exit 1, a message, no findings`, r.status === 1 && r.stdout.trim().length > 0 && !findingsOf(d, "alpha.findings.md"), `status ${r.status} ${r.stdout}`);
  }
}

// 5. only declined rows: not an error, prompt as without --earlier
{
  const f = earlierFile("findings-2026-10-07.md", decided([["alpha: x", "Declined"], ["Everywhere: y", "declined"]]));
  const d = setup(["alpha.md"]);
  const r = run(d, "--earlier", f);
  const got = findingsOf(d, "alpha.findings.md");
  const want = `Read the file ${path.join(d, "alpha.md")}.\n\n${TASK}`;
  ok("5 only declined rows: exit 0, old prompt", r.status === 0 && got?.trim() === want.trim() && /No ticked fixes/.test(r.stdout), `status ${r.status} ${r.stdout}`);
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
