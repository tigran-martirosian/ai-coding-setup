// Checks the agent definitions in the agents folder of this repository that the rules depend on. Run: node tests/test-agents.mjs
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const AGENTS = fileURLToPath(new URL("../agents/", import.meta.url));
const read = (name) =>
  readFileSync(join(AGENTS, `${name}.md`), "utf8").replace(/\r\n/g, "\n");
const parts = (text) => {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error("no frontmatter");
  return { head: m[1], body: m[2].trim() };
};
const has = (head, key, value) =>
  new RegExp(`^${key}:[ ]*${value}[ ]*$`, "m").test(head);
const tools = (head) =>
  (head.match(/^tools:\s*(.*)$/m)?.[1] || "").split(/,\s*/);

const worker = parts(read("worker")),
  full = parts(read("worker-full"));
const planRev = parts(read("plan-reviewer")),
  rev = parts(read("reviewer")),
  high = parts(read("worker-refactor"));
const code = parts(read("worker-code")),
  blind = parts(read("blind-reviewer"));
const desc = (head) => head.match(/^description:\s*(.*)$/m)?.[1] || "";
const rest = (head) =>
  head
    .split("\n")
    .filter((l) => !/^(name|description|model|effort):/.test(l))
    .join("\n");
const WRITE_TOOLS = ["Edit", "Write", "NotebookEdit", "Agent", "PowerShell"];
const SLIM =
  /\n\nYou start without the CLAUDE\.md files[\s\S]*?in plain words>`\./;
// worker-refactor alone gets the shape line (user, 2026-11-13: it replaces the ownership line), the refactor section
// and Anthropic's "Finishing work" block (user, 2026-11-10) without its "be persistent" line (setup review
// 2026-11-19, 2.6); the rest is the worker's body
const OWN_OLD = /^- This codebase is yours:[^\n]*\n/m;
const OWN =
  /^- Inside your FILES the shape of the code is your call[^\n]*what the code does stays the same\.\n/m;
const REFACTOR = /\n# The refactor\n[\s\S]*?(?=\n# Communicating clearly)/;
const FINISH = /\n+# Finishing work\n[\s\S]*$/;
const highBody = high.body.replace(/\r\n/g, "\n");
const highCore = highBody
  .replace(OWN, "")
  .replace(REFACTOR, "")
  .replace(FINISH, "");
const newProject = readFileSync(
  fileURLToPath(new URL("../skills/new-project/SKILL.md", import.meta.url)),
  "utf8",
);
// /new-project's base table and its verify presets (design 2026-11-17: verify skill section 1 and 5). A missing
// preset reads as null, so its check FAILs instead of crashing.
const baseTable = (
  newProject
    .replace(/\r\n/g, "\n")
    .match(/\n## 2\. Create the base[\s\S]*?(?=\n## 2b\.)/)?.[0] || ""
)
  .split("\n")
  .filter((l) => l.startsWith("| "));
const baseRow = (file) =>
  baseTable.find((l) => l.startsWith(`| \`${file}\` |`));
const preset = (name) => {
  try {
    return readFileSync(
      fileURLToPath(
        new URL(`../skills/new-project/preset/${name}`, import.meta.url),
      ),
      "utf8",
    ).replace(/\r\n/g, "\n");
  } catch {
    return null;
  }
};
const inOrder = (text, heads) => {
  let at = -1;
  return heads.every((h) => {
    at = text.indexOf(`\n${h}\n`, at + 1);
    return at >= 0;
  });
};
const VERIFY_KINDS = {
  web: "--mute-audio",
  godot: "godot --headless",
  tool: "headless and muted",
  pipeline: "headless and muted",
};
const VERIFY_HEADS = [
  "## 1. Start",
  "## 2. Use it",
  "## 3. Proof",
  "## 4. Clean up",
  "## 5. Report",
];
const gitignorePreset = preset("gitignore.txt");
const leadRef = readFileSync(
  fileURLToPath(new URL("../skills/lead/reference.md", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");
const checks = [
  [
    "worker is named worker and starts without CLAUDE.md",
    has(worker.head, "name", "worker") &&
      has(worker.head, "omitClaudeMd", "true"),
  ],
  [
    "worker has no Agent tool and keeps Edit, Write, Bash",
    !tools(worker.head).includes("Agent") &&
      ["Edit", "Write", "Bash"].every((t) => tools(worker.head).includes(t)),
  ],
  [
    "worker-full loads CLAUDE.md and has every tool",
    has(full.head, "name", "worker-full") &&
      !/omitClaudeMd/.test(full.head) &&
      !/^tools:/m.test(full.head),
  ],
  [
    "the two workers differ only by the block for starting without CLAUDE.md",
    SLIM.test(worker.body) && worker.body.replace(SLIM, "") === full.body,
  ],
  [
    "the worker's own block carries the rules it no longer loads",
    ["WHAT THIS DOES", "no made-up defaults", "Commit or push only"].every(
      (s) => worker.body.includes(s),
    ),
  ],
  [
    "worker-refactor is named worker-refactor, on fable at high effort",
    has(high.head, "name", "worker-refactor") &&
      has(high.head, "model", "fable") &&
      has(high.head, "effort", "high"),
  ],
  [
    "worker-refactor has the worker's body and the rest of its settings",
    highCore === worker.body.replace(/\r\n/g, "\n") &&
      rest(high.head) === rest(worker.head),
  ],
  [
    "worker-refactor swaps the ownership line for the shape line and adds Anthropic's Finishing work text, with no be-persistent line",
    OWN.test(highBody) &&
      !OWN_OLD.test(highBody) &&
      FINISH.test(high.body) &&
      !/be persistent|Please avoid stopping/i.test(high.body) &&
      high.body.includes(
        "This does not override the need for confirmation on risky or destructive actions.",
      ),
  ],
  [
    // 2026-11-20, decision D1: the planner agent is retired, so it is no longer read here
    "every worker and both reviewers carry Anthropic's Communicating clearly text",
    [worker, code, full, high, planRev, rev].every(
      (a) =>
        a.body.includes("# Communicating clearly") &&
        a.body.includes("Write for an intelligent but low-context reader."),
    ) &&
      [worker, code, full, high].every((a) =>
        a.body.includes(
          "the last `Outside the brief:` line, or the one `BLOCKED` line",
        ),
      ),
  ],
  [
    "every worker finishes the brief or ends with BLOCKED at a refused command",
    [worker, code, full, high].every((a) =>
      /Finish everything the brief asks\.[^\n]*BLOCKED/.test(a.body),
    ),
  ],
  [
    "worker-refactor has the refactor section: map first, every dependent in FILES, compiler and tests as judge, assertions kept, done when",
    REFACTOR.test(highBody) &&
      [
        "**Map first.**",
        "take its errors as the rest of the map",
        "**One decision, every dependent.**",
        "A dependent outside your FILES goes in your report",
        "**The compiler and the tests are the judge.**",
        "Tests keep their assertions",
        "Done when every dependent inside your FILES is ticked",
      ].every((s) => highBody.includes(s)),
  ],
  [
    "worker-refactor has its own description, which says a rename is never a reason",
    desc(high.head) !== "" &&
      desc(high.head) !== desc(worker.head) &&
      /rename[^.]*never a reason/i.test(desc(high.head)),
  ],
  // 2026-11-09 model table (setup review 2026-11-19, 2.6): a helper on another model does not inherit effort
  [
    "worker is on sonnet at medium effort",
    has(worker.head, "model", "sonnet") && has(worker.head, "effort", "medium"),
  ],
  [
    "every agent file sets its effort",
    readdirSync(AGENTS)
      .filter((f) => f.endsWith(".md"))
      .every((f) => /^effort:\s*\S/m.test(parts(read(f.slice(0, -3))).head)),
  ],
  [
    "worker-full is on opus at high effort",
    has(full.head, "model", "opus") && has(full.head, "effort", "high"),
  ],
  [
    "worker-code is named worker-code, on opus at high effort",
    has(code.head, "name", "worker-code") &&
      has(code.head, "model", "opus") &&
      has(code.head, "effort", "high"),
  ],
  [
    "worker-code has the worker's body and the rest of its settings",
    code.body === worker.body && rest(code.head) === rest(worker.head),
  ],
  [
    "worker-code has its own description, for code changes, sending a long refactor to worker-refactor",
    desc(code.head) !== desc(worker.head) &&
      /code changes/i.test(desc(code.head)) &&
      /refactor[^.]*worker-refactor/i.test(desc(code.head)),
  ],
  [
    "plan-reviewer is named, on fable, read-only",
    has(planRev.head, "name", "plan-reviewer") &&
      has(planRev.head, "model", "fable") &&
      ["Read", "Grep", "Glob", "Bash"].every((t) =>
        tools(planRev.head).includes(t),
      ) &&
      !tools(planRev.head).some((t) => WRITE_TOOLS.includes(t)),
  ],
  [
    "plan-reviewer has a turn cap of 40 or fewer",
    Number(planRev.head.match(/^maxTurns:\s*(\d+)/m)?.[1]) <= 40,
  ],
  // rewritten on purpose (2026-11-19, pipeline design sections 2 and 6): the plan-reviewer checks a plan against the
  // spec and the user's words in one pass, the reviewer is the spec reviewer at the end, the blind-reviewer sees
  // screens and text only; these checks guard the new key lines
  [
    "plan-reviewer's input is the user's ask in their own words, the spec and the plan",
    /the user's ask in their own words, the spec \(`docs\/<date>-<job>-spec\.md`\), the plan/.test(
      planRev.body,
    ),
  ],
  [
    // 2026-11-20, decision D10: check 7 (the size fits the work, a named time limit as the ceiling) is undone; the
    // lead folds sequential steps itself (D3) and check 2 already guards the user's limits
    // 2026-11-26 (user): check 7 is now "End to end" - a plan whose output reached no one and shipped nothing passed
    // all six checks, so the reviewer traces the flow to the user and the bottleneck
    "plan-reviewer has its seven checks in order: done-when proved, the user's words, nothing dropped, runs as written, shared edges, risky, end to end",
    [
      "1. **Every done-when line is proved.**",
      "2. **The user's words hold.**",
      "3. **Nothing dropped quietly.**",
      "4. **Each slice runs as written.**",
      "5. **Shared files and names have edges.**",
      "6. **Risky is marked.**",
      "7. **End to end.**",
    ]
      .map((s) => planRev.body.indexOf(s))
      .every((p, i, a) => p >= 0 && (i === 0 || p > a[i - 1])) &&
      !/\n8\. \*\*/.test(planRev.body) &&
      !/size fits the work|time limit/i.test(planRev.body) &&
      /all seven checks ran/.test(planRev.body),
  ],
  [
    "plan-reviewer reports findings per spec line, quoted, each with its proof",
    /D2 "<the done-when line, quoted>"/.test(planRev.body) &&
      /Your words "<the quote>"/.test(planRev.body) &&
      /Prove each finding/.test(planRev.body),
  ],
  [
    // 2026-11-20, decision D11 and setup review 2.5: one pass, no rerun mid-run; the lead maps a cut to its
    // done-when line instead, so the old "runs once more after a cut" check is reversed
    "plan-reviewer runs once on the lead's plan and is not run again after a mid-run cut",
    /You check a big job's plan once/.test(planRev.body) &&
      /The lead wrote the plan and\s+fixes what you find, one round; you do not run again/.test(
        planRev.body,
      ) &&
      /a mid-run cut is not reviewed again/.test(desc(planRev.head)) &&
      !/Mid-run, after a cut/.test(planRev.body) &&
      !/planner\b/.test(planRev.body),
  ],
  [
    "plan-reviewer and reviewer look for no purpose record, Serves cell, NARROWED line or PURPOSE CHECK line",
    [planRev.body, rev.body].every(
      (t) =>
        !/purpose record|What each thing is for|Serves|NARROWED|PURPOSE CHECK/.test(
          t,
        ),
    ),
  ],
  [
    "the four workers carry the same stop line and the no-stand-in rule, with no SERVES field",
    [worker, code, full, high].every(
      (a) =>
        a.body.includes(
          "When what you find contradicts the goal or the brief:",
        ) &&
        a.body.includes(
          "A slice that cannot do what it is for stops and asks, and builds no safer stand-in.",
        ) &&
        // the brief fields and hand-back the lead's reference.md uses (pipeline design section 5, 2026-11-19)
        a.body.includes("your SLICE of the PLAN file, its DONE WHEN lines") &&
        a.body.includes("YOUR WORDS") &&
        a.body.includes(
          "what differed from the brief; what you found; worries",
        ) &&
        !/SERVES/.test(a.body),
    ),
  ],
  [
    "plan-reviewer runs only read-only checks",
    /Run only read-only checks/.test(planRev.body),
  ],
  [
    "plan-reviewer's Bash runs under the planner-readonly hook",
    /PreToolUse:[\s\S]*matcher: "Bash\|PowerShell"[\s\S]*planner-readonly\.mjs/.test(
      planRev.head,
    ),
  ],
  // D2 (hooks cut): planner-readonly leaves the global hook table, so reviewer's shell guard is its own frontmatter
  [
    "reviewer has plan-reviewer's planner-readonly hooks block in its frontmatter",
    (() => {
      const block = (head) =>
        head.match(/^hooks:\n(?:[ ]+.*\n?)+/m)?.[0].trimEnd();
      const want = block(planRev.head);
      return (
        Boolean(want) &&
        /planner-readonly\.mjs/.test(want) &&
        block(rev.head) === want
      );
    })(),
  ],
  [
    "reviewer's and plan-reviewer's planner-readonly hook stays fail-closed (onFailure block)",
    [rev.head, planRev.head].every((head) =>
      /command: "node ~\/\.claude\/hooks\/planner-readonly\.mjs"\n(?:[ ]+.*\n)*?[ ]+onFailure: "block"/.test(
        head,
      ),
    ),
  ],
  [
    "reviewer's input is the spec, the full diff and the end-check outputs, never the chat",
    /the full diff of the job, and the lead's end-check outputs\. You never see the chat/.test(
      rev.body,
    ) && /never the chat/.test(desc(rev.head)),
  ],
  [
    "reviewer runs the checks itself where it can, and marks one it could not run",
    /Run its check yourself where you can/.test(rev.body) &&
      /marked "from the lead's output"/.test(rev.body),
  ],
  [
    "reviewer is read-only with a turn cap of 60",
    !tools(rev.head).some((t) => WRITE_TOOLS.includes(t)) &&
      has(rev.head, "maxTurns", "60"),
  ],
  [
    "reviewer gives each done-when line met, missing, looks wrong or not asked for, quoted with its proof",
    ["**met**", "**missing**", "**looks wrong**", "**not asked for**"].every(
      (s) => rev.body.includes(s),
    ) && /D1 "<the done-when line, quoted>": met\. Proof:/.test(rev.body),
  ],
  [
    "reviewer calls out every change to a check file after the check slice; a changed expected value is always a finding",
    /diff it from the check slice's commit/.test(rev.body) &&
      /A changed expected value[^.]*is always a finding/.test(rev.body) &&
      /Check files changed after the check slice:/.test(rev.body),
  ],
  [
    "reviewer says what it did not read, gives no scores and keeps a word cap",
    /Not read: /.test(rev.body) &&
      /No scores/.test(rev.body) &&
      /At most 400 words/.test(rev.body),
  ],
  [
    // 2026-11-20, decision D4: the end reviewer is scoped to correctness, not told to find problems in general
    "reviewer's scope is correctness: every gap that makes the result wrong, no style, nothing the project's tools enforce",
    /Your scope is correctness: report every gap that makes the result wrong against the spec, whatever its size\. Skip\s+style, naming, and what the project's tools \(linter, formatter, type checker\) already enforce\./.test(
      rev.body,
    ) && /correctness only \(no style\)/.test(desc(rev.head)),
  ],
  [
    // 2026-11-20, decision D5: the checks are tests, the run and CI, not stacked self-check lines
    "no agent file carries a stacked self-check line (double-check, verify with a subagent)",
    readdirSync(AGENTS)
      .filter((f) => f.endsWith(".md"))
      .every(
        (f) =>
          !/double[- ]check|verify (it )?with a (sub)?agent/i.test(
            read(f.slice(0, -3)),
          ),
      ),
  ],
  [
    "reviewer no longer says one is enough",
    !/one is enough/i.test(rev.head + rev.body),
  ],
  [
    "reviewer sends a newcomer's look to the blind-reviewer",
    /blind-reviewer/.test(desc(rev.head)) &&
      !/blind screen review/i.test(desc(rev.head)),
  ],
  [
    "reviewer reads no REVIEW.md (local /code-review follows CLAUDE.md; pipeline design section 8)",
    !/REVIEW\.md/.test(rev.body),
  ],
  [
    // "Changed in this change" left 2026-11-19: it relayed a loosened review-rules file, and the pipeline reads none (design section 8)
    "lead gives the reviewer a Base line, reproduces before a fix, and a not-reproduced finding costs no fix round",
    /`Base: <commit>` line per[\s\S]{0,4}repository/.test(leadRef) &&
      /fix brief starts with that command/.test(leadRef) &&
      /\*\*Not reproduced\*\*[^\n]*costs no fix round/.test(leadRef) &&
      /verify skill[^\n]*every helper's brief/.test(leadRef),
  ],
  [
    "every worker fixes the code, never edits, weakens or skips a test to get green, and deletes a causeless flaky test only with the reason in known-failures, no sleeps or retries",
    [worker, code, full, high].every(
      (a) =>
        /skip a test to get green/i.test(a.body) &&
        /flaky test with no cause found may be deleted[^\n]*known-failures[^\n]*no sleeps or retries/.test(
          a.body,
        ),
    ),
  ],
  [
    "blind-reviewer is named, on opus at medium effort, starts without CLAUDE.md",
    has(blind.head, "name", "blind-reviewer") &&
      has(blind.head, "model", "opus") &&
      has(blind.head, "effort", "medium") &&
      has(blind.head, "omitClaudeMd", "true"),
  ],
  [
    "blind-reviewer can only read what it is given: Read is its one tool",
    tools(blind.head).join(",") === "Read",
  ],
  [
    "blind-reviewer's brief ends with SYSTEMS MAP: none",
    /SYSTEMS MAP: none/.test(desc(blind.head)),
  ],
  [
    "blind-reviewer gets only screenshots with their scale, or the text, and a word list",
    /Screenshots of every state, each with its scale/.test(blind.body) &&
      /A short word list/.test(blind.body) &&
      /Nothing else\./.test(blind.body),
  ],
  [
    "blind-reviewer names a missing state and ranks what a newcomer trips over, worst first",
    /state X not shown/.test(blind.body) &&
      /worst first/.test(blind.body) &&
      ["[blocks]", "[slows]", "[nit]"].every((s) => blind.body.includes(s)),
  ],
  [
    "blind-reviewer's answer opens with PASS or FAIL alone, so saved word for word it is the page's verdict verify-gate reads",
    /```\r?\nPASS \/ FAIL\r?\n/.test(blind.body) &&
      /The first line is FAIL when any finding is \[blocks\], else PASS, alone on its line/.test(
        blind.body,
      ),
  ],
  [
    "blind-reviewer is for screens and text only: no command checks, no whole-setup look",
    !/command/i.test(desc(blind.head)) && !/whole setup/i.test(blind.body),
  ],
  [
    "blind-reviewer carries Anthropic's Communicating clearly text",
    blind.body.includes("# Communicating clearly") &&
      blind.body.includes("Write for an intelligent but low-context reader."),
  ],
  [
    "new-project starts DECISIONS.md with dated sections newest first, no purpose record",
    /\| `DECISIONS\.md` \| The index: decisions in dated sections, newest first/.test(
      newProject,
    ) && !/What each thing is for|purpose record/.test(newProject),
  ],
  [
    "new-project's base table writes the verify skill from the four kind templates, with the CLAUDE.md line and, when nothing starts yet, the HANDOFF item instead",
    !!baseRow(".claude/skills/verify/SKILL.md") &&
      Object.keys(VERIFY_KINDS).every((k) =>
        baseRow(".claude/skills/verify/SKILL.md").includes(
          `preset/verify-${k}.md`,
        ),
      ) &&
      baseRow(".claude/skills/verify/SKILL.md").includes(
        "`- Before a commit that changes code: the verify skill (.claude/skills/verify/SKILL.md) starts the app and proves the change.`",
      ) &&
      baseRow(".claude/skills/verify/SKILL.md").includes(
        "`- [ ] Write .claude/skills/verify/SKILL.md from new-project's preset/verify-<kind>.md once the app first starts.`",
      ),
  ],
  [
    "new-project writes no REVIEW.md and ships no preset for one (the pipeline reads none, pipeline design section 8)",
    !baseRow("REVIEW.md") &&
      !/REVIEW\.md/.test(newProject) &&
      preset("REVIEW.md") === null,
  ],
  [
    "new-project's gitignore preset names no tool or setup folder (no .claude/ or .nimbalyst line) and keeps the \"don't ask again\" file out with **/settings.local.json",
    !!gitignorePreset &&
      !gitignorePreset
        .split("\n")
        .some((l) => l.includes(".claude/") || l.includes(".nimbalyst")) &&
      gitignorePreset.split("\n").includes("**/settings.local.json"),
  ],
  ...Object.entries(VERIFY_KINDS).map(([kind, quiet]) => [
    `new-project's preset/verify-${kind}.md exists as a verify skill: frontmatter, the five steps in order, the PROOF line a program checks, and headless, muted runs (${quiet})`,
    ((t) =>
      !!t &&
      /^---\nname: verify\ndescription: \S[^\n]*\n---\n/.test(t) &&
      inOrder(t, VERIFY_HEADS) &&
      t.includes("`PROOF <what>: expected <x>, got <y>`") &&
      t.includes(quiet))(preset(`verify-${kind}.md`)),
  ]),
];
// Claude Code drops an agent whose frontmatter is not valid YAML; its quoting retry works only on LF files, and
// installed copies can be CRLF (blind-reviewer went missing that way). So no plain value may hold ": " or " #",
// or start with a YAML indicator; such a value goes in quotes.
const unsafe = readdirSync(AGENTS)
  .filter((f) => f.endsWith(".md"))
  .flatMap((f) =>
    parts(read(f.slice(0, -3)))
      .head.split("\n")
      .filter((l) => /^[a-zA-Z]+:/.test(l))
      .map((l) => [f, l.replace(/^[a-zA-Z]+:\s*/, "")])
      .filter(
        ([, v]) =>
          !/^(["']).*\1$/.test(v) &&
          (/: | #/.test(v) || /^[[{*&!|>%@`"']/.test(v)),
      )
      .map(([f, v]) => `${f}: ${v.slice(0, 60)}`),
  );
if (unsafe.length) console.log(unsafe.join("\n"));
checks.push([
  'every agent frontmatter value parses as plain YAML (quoted when it holds ": " or " #")',
  unsafe.length === 0,
]);
let fail = 0;
for (const [name, ok] of checks) {
  if (!ok) fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
}
console.log(fail ? `${fail} failed` : `all ${checks.length} passed`);
process.exit(fail ? 1 : 0);
