// Tests for scripts/diagram-rule.mjs: a Mermaid diagram only for branching or structure, at most 8 boxes,
// labels of 1-3 words, no straight chain of more than 3 boxes. Needs the tag v26.5.2.
// Run: node tests/test-diagram-rule.mjs
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const CHECK = join(REPO, "scripts", "diagram-rule.mjs");
const tmp = mkdtempSync(join(tmpdir(), "diagram-rule-"));
let fails = 0;
const ok = (name, pass, why = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: ${why}`}`);
};
const run = (...pages) => {
  const r = spawnSync(process.execPath, [CHECK, ...pages], {
    encoding: "utf8",
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
};
const page = (name, ...blocks) => {
  const file = join(tmp, `${name}.md`);
  writeFileSync(
    file,
    `# ${name}\n\n${blocks.map((b) => `\`\`\`mermaid\n${b}\n\`\`\`\n`).join("\n")}`,
  );
  return file;
};

try {
  // The released 26.5.2 pages each break the rule.
  mkdirSync(join(tmp, "docs"));
  const released = {
    "docs/whats-new.md": [
      /10 boxes, more than 8/,
      /a straight chain of 10 boxes/,
      /"One end review against the spec" has 6 words/,
    ],
    "README.md": [
      /9 boxes, more than 8/,
      /a straight chain of 5 boxes/,
      /has 9 words/,
    ],
    "docs/features.md": [/"Hooks check each tool call" has 5 words/],
    "docs/setup.md": [
      /"worker subagent long reading, routine edits" has 6 words/,
    ],
  };
  for (const [f, reasons] of Object.entries(released)) {
    const g = spawnSync("git", ["show", `v26.5.2:${f}`], {
      cwd: REPO,
      encoding: "utf8",
    });
    if (g.status !== 0)
      throw new Error(
        `git show v26.5.2:${f} failed (is the tag fetched?): ${g.stderr}`,
      );
    const file = join(tmp, f);
    writeFileSync(file, g.stdout);
    const r = run(file);
    ok(
      `v26.5.2 ${f} breaks the rule (exit 1)`,
      r.status === 1,
      `exit ${r.status}\n${r.out}`,
    );
    for (const why of reasons)
      ok(`v26.5.2 ${f}: ${why.source}`, why.test(r.out), r.out);
  }

  const clean = run(join(REPO, "tests", "fixtures", "pages", "clean.md"));
  ok(
    "the clean fixture's small branching diagram meets the rule (exit 0)",
    clean.status === 0,
    `exit ${clean.status}\n${clean.out}`,
  );
  ok("a page with no diagram meets the rule", run(page("none")).status === 0);

  // The limits themselves: 8 boxes, 3 words and a chain of 3 pass; one more fails.
  const fan = (n) =>
    `flowchart TD\n${Array.from({ length: n - 1 }, (_, i) => `  a --> b${i}`).join("\n")}`;
  ok(
    "8 boxes pass",
    run(page("eight", fan(8))).status === 0,
    run(page("eight", fan(8))).out,
  );
  const nine = run(page("nine", fan(9)));
  ok(
    "9 boxes fail",
    nine.status === 1 && /9 boxes, more than 8/.test(nine.out),
    nine.out,
  );
  ok(
    "a 3-word label passes",
    run(page("three", 'flowchart TD\n  a["One two three"] --> b & c'))
      .status === 0,
  );
  const four = run(
    page("four", "flowchart TD\n  a[One two<br>three four] --> b & c"),
  );
  ok(
    "a 4-word label across a <br> fails",
    four.status === 1 && /has 4 words/.test(four.out),
    four.out,
  );
  ok(
    "a chain of 3 boxes passes",
    run(page("chain3", "flowchart LR\n  a --> b --> c")).status === 0,
  );
  const chain4 = run(page("chain4", "flowchart LR\n  a --> b --> c --> d"));
  ok(
    "a chain of 4 boxes fails",
    chain4.status === 1 && /straight chain of 4 boxes/.test(chain4.out),
    chain4.out,
  );
  const tail = run(
    page(
      "tail",
      "flowchart TD\n  a --> b & c\n  b -->|yes| d\n  d -- then --> e\n  e -.-> f",
    ),
  );
  ok(
    "a branch with a 4-box tail after it fails (arrows with text read)",
    tail.status === 1 &&
      /straight chain of 4 boxes \(b -> d -> e -> f\)/.test(tail.out),
    tail.out,
  );
  const seq = run(page("seq", "sequenceDiagram\n  A->>B: hi"));
  ok(
    "a diagram that is not a flowchart fails, named",
    seq.status === 1 && /not a flowchart/.test(seq.out),
    seq.out,
  );
  ok("no page given is a wrong call (exit 2)", run().status === 2);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
