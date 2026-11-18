// Tests for hooks/verify-gate.mjs. Run: node tests/test-verify-gate.mjs
// Each case writes a small transcript and runs the hook on it as a Stop event.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeChecker } from "./lib/kit.mjs";

const HOOK = fileURLToPath(
  new URL("../hooks/verify-gate.mjs", import.meta.url),
);
const dir = mkdtempSync(join(tmpdir(), "test-verify-gate-"));
const BAD_PATTERN_LOG = join(dir, "bad-pattern-errors.log"); // the one case that tests the crash log gives the hook its own log path

let id = 0;
const typed = (text) => ({
  type: "user",
  uuid: `u${++id}`,
  message: { role: "user", content: text },
});
const tool = (name, input) => ({
  type: "assistant",
  message: {
    role: "assistant",
    content: [{ type: "tool_use", id: `t${++id}`, name, input }],
  },
});
const result = (ok = true, text = "done") => ({
  type: "user",
  message: {
    role: "user",
    content: [
      {
        type: "tool_result",
        tool_use_id: `t${id}`,
        content: ok ? text : "failed",
        ...(ok ? {} : { is_error: true }),
      },
    ],
  },
});
const edit = (file, ok = true) => [
  tool("Edit", { file_path: file, old_string: "a", new_string: "b" }),
  result(ok),
];
const write = (file) => [
  tool("Write", { file_path: file, content: "x" }),
  result(),
];
const bash = (command, ok = true, extra = {}) => [
  tool("Bash", { command, ...extra }),
  result(ok),
];
const say = (text) => ({
  type: "assistant",
  message: { role: "assistant", content: [{ type: "text", text }] },
});

let n = 0;
// Each run is its own session unless one is named. The once-per-turn files and the error log go into the test folder.
// `project` is the env a project's .claude/settings.json holds; no settings file when it is not given.
const run = (entries, { input = {}, env = {}, session, project } = {}) => {
  const file = join(dir, `t${++n}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  const proj = join(dir, `p${n}`);
  mkdirSync(join(proj, ".claude"), { recursive: true });
  if (project)
    writeFileSync(
      join(proj, ".claude", "settings.json"),
      JSON.stringify({ env: project }),
    );
  const event = {
    session_id: session || `s${n}`,
    transcript_path: file,
    hook_event_name: "Stop",
    stop_hook_active: false,
    ...input,
  };
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_GATE: "",
      VERIFY_PATTERN: "",
      CLAUDE_PROJECT_DIR: proj,
      TEMP: dir,
      TMP: dir,
      TMPDIR: dir,
      HOME: dir,
      USERPROFILE: dir,
      ...env,
    },
  }).stdout;
};
const blocks = (out) =>
  out.includes('"decision":"block"') && out.includes("verify-gate:");

const EDITED = [typed("fix the parser"), ...edit("C:/p/a.js")];
const cases = [
  ["code edit, no build: blocked", [...EDITED, say("Done.")], true],
  [
    "the block names the file and says what to do",
    [...EDITED],
    (out) =>
      /\(a\.js\)/.test(out) && /Run the project's build or test/.test(out),
  ],
  [
    "the block is one line",
    [...EDITED],
    (out) => !JSON.parse(out).reason.includes("\n"),
  ],
  ["code edit then npm test: passes", [...EDITED, ...bash("npm test")], false],
  [
    "code edit then a build in the middle of a chain: passes",
    [...EDITED, ...bash("cd /p && npm run build 2>&1 | tail -5")],
    false,
  ],
  [
    "build before the edit: blocked",
    [typed("fix"), ...bash("npm run build"), ...edit("C:/p/a.js")],
    true,
  ],
  [
    "build, edit, build: passes",
    [
      typed("fix"),
      ...bash("npm run build"),
      ...edit("C:/p/a.js"),
      ...bash("npm run build"),
    ],
    false,
  ],
  [
    "build, edit, another edit with no build after: blocked",
    [
      typed("fix"),
      ...edit("C:/p/a.js"),
      ...bash("npm test"),
      ...edit("C:/p/b.js"),
    ],
    true,
  ],
  [
    "a failed build (error result) is not a run: blocked",
    [...EDITED, ...bash("npm run build", false)],
    true,
  ],
  [
    "a failed build, then one that works: passes",
    [...EDITED, ...bash("npm run build", false), ...bash("npm run build")],
    false,
  ],
  [
    "a refused edit doesn't count: passes",
    [typed("fix"), ...edit("C:/p/a.js", false)],
    false,
  ],
  [
    "a background build counts as a run",
    [...EDITED, ...bash("./gradlew build", true, { run_in_background: true })],
    false,
  ],
  [
    "docs-only edits: passes",
    [
      typed("write docs"),
      ...edit("C:/p/README.md"),
      ...write("C:/p/notes.txt"),
    ],
    false,
  ],
  [
    "a JSON file outside src/ is not code: passes",
    [typed("fix"), ...edit("C:/p/package.json")],
    false,
  ],
  [
    "a JSON file under src/ is code: blocked",
    [typed("fix"), ...edit("C:/p/mdk/src/c.json")],
    true,
  ],
  [
    "a throwaway script in a temp folder: passes",
    [typed("try"), ...write("D:/work/Temp/x.py")],
    false,
  ],
  [
    "a Write of code counts: blocked",
    [typed("build"), ...write("C:/p/a.go")],
    true,
  ],
  [
    "a command that is not a build (ls, git, node on a plain script): blocked",
    [
      ...EDITED,
      ...bash("ls"),
      ...bash("git status"),
      ...bash("node tools/run.mjs"),
    ],
    true,
  ],
  [
    "a build word inside a commit message is no run: blocked",
    [...EDITED, ...bash('git commit -m "make it pass npm test"')],
    true,
  ],
  [
    "a reply ending in a question: passes",
    [...EDITED, say("Done.")],
    false,
    { input: { last_assistant_message: "Which one do you want?" } },
  ],
  [
    "a reply ending in a question does not use up the block",
    [...EDITED],
    true,
    { input: { last_assistant_message: "Done." } },
  ],
  [
    "VERIFY_GATE=off in the environment: passes",
    [...EDITED],
    false,
    { env: { VERIFY_GATE: "off" } },
  ],
  [
    "VERIFY_GATE=off in the project's settings env: passes",
    [...EDITED],
    false,
    { project: { VERIFY_GATE: "off" } },
  ],
  [
    "another value of VERIFY_GATE does not turn it off",
    [...EDITED],
    true,
    { project: { VERIFY_GATE: "on" } },
  ],
  [
    "a subagent (agent_id) is skipped",
    [...EDITED],
    false,
    { input: { agent_id: "a1" } },
  ],
  [
    "a built-in tool Skill or Agent call is not a run: blocked",
    [
      ...EDITED,
      tool("Agent", { subagent_type: "worker", prompt: "npm test" }),
      result(),
    ],
    true,
  ],
  [
    "an edit from an earlier turn doesn't count in a turn with none",
    [
      typed("fix"),
      ...edit("C:/p/a.js"),
      say("Done."),
      typed("what does it do?"),
      say("It parses."),
    ],
    false,
  ],
  [
    "tool results are not a new turn",
    [typed("fix"), ...edit("C:/p/a.js"), result(), ...edit("C:/p/b.py")],
    true,
  ],
  [
    "a background task's notice is not a new turn",
    [
      typed("fix"),
      ...edit("C:/p/a.js"),
      {
        ...typed("<task-notification>done</task-notification>"),
        promptSource: "system",
        origin: { kind: "task-notification" },
      },
    ],
    true,
  ],
  ["a missing transcript fails open", null, false],
  [
    "VERIFY_PATTERN in env replaces the list: npm test no longer counts",
    [...EDITED, ...bash("npm test")],
    true,
    { env: { VERIFY_PATTERN: "check-all" } },
  ],
  [
    "VERIFY_PATTERN in env: the project's command counts",
    [...EDITED, ...bash("sh check-all.sh")],
    false,
    { env: { VERIFY_PATTERN: "check-all" } },
  ],
  [
    "VERIFY_PATTERN in the project's settings env",
    [...EDITED, ...bash("make lint-all")],
    false,
    { project: { VERIFY_PATTERN: "lint-all" } },
  ],
  [
    "a VERIFY_PATTERN that is no regex fails open",
    [...EDITED],
    false,
    { env: { VERIFY_PATTERN: "(", HOOK_ERRORS_LOG: BAD_PATTERN_LOG } },
  ],
];

// Commands the default list must take, and those it must not
const RUNS = [
  "./gradlew build",
  "gradlew.bat test",
  "C:/p/gradlew assembleDebug",
  "npm test",
  "npm run build",
  "npm run test",
  "pnpm test",
  "yarn build",
  "pytest -q",
  "python -m pytest tests/",
  "cargo build --release",
  "cargo test",
  "go build ./...",
  "go test ./...",
  "tsc -p .",
  "npx tsc --noEmit",
  "dotnet build",
  "dotnet test",
  "make",
  "make -C src",
  "bash run_all.sh",
  "./tests/run_all.sh",
  "qbuild",
  "C:/tools/qbuild.cmd",
  "node test-verify-gate.mjs",
  "node tests/test-x.mjs",
  "node tests/run-all.mjs",
  "node run-tests.mjs",
  "node --test",
  "cd /p && ./gradlew build",
  "CI=1 npm test",
  'JAVA_HOME="/c/Program Files/Eclipse Adoptium/jdk-17.0.20.101-hotspot" ./gradlew build',
  'cd mdk && JAVA_HOME="/c/a b/jdk" ./gradlew build',
  'node "C:/My Projects/x/tests/run-all.mjs"',
  "node 'C:/a b/test-x.mjs'",
  'node "test-x.mjs"',
  "mvn -q verify",
  "cmake --build out",
  "uv run pytest -q",
  "uv run --frozen python -m pytest tests/",
  "poetry run pytest",
  "pipenv run tox",
  "hatch run pytest -x",
  "cd /p && uv run pytest",
  "uv run --project /c/p pytest -q",
  "uv run --with pytest-cov pytest",
  "uv run --with pytest python -m pytest tests",
];
const NOT_RUNS = [
  'node "C:/a b/tools/run.mjs"',
  'node tools/x.mjs "tests/run-all.mjs"',
  "ls",
  "npm install",
  "npm run dev",
  "uv run python tools/x.py",
  "poetry run serve",
  "uv run --with pytest python x.py",
  "uv run --project /c/p python tools/x.py",
  "git commit -m 'make it'",
  "echo npm test",
  "cat tests/run-all.mjs",
  "node tools/run.mjs",
  "go mod tidy",
  "cargo fmt",
  "grep -rn pytest .",
  "makeup.sh",
];
for (const c of RUNS)
  cases.push([`default list takes: ${c}`, [...EDITED, ...bash(c)], false]);
for (const c of NOT_RUNS)
  cases.push([
    `default list does not take: ${c}`,
    [...EDITED, ...bash(c)],
    true,
  ]);

const { check, summary } = makeChecker();
for (const [name, entries, expect, opts] of cases) {
  const out =
    entries === null
      ? run([typed("x")], {
          input: { transcript_path: join(dir, "missing.jsonl") },
        })
      : run(entries, opts);
  check(
    name,
    typeof expect === "function"
      ? expect(out)
      : expect === true
        ? blocks(out)
        : !out,
    out || "(no output)",
  );
}

// Once per turn: a second stop in the same session and turn passes, a new turn blocks again
const first = [typed("fix"), ...edit("C:/p/a.js")];
check(
  "first stop of a turn: blocked",
  blocks(run(first, { session: "once" })),
  "",
);
check(
  "second stop in the same turn: passes",
  !run([...first, say("I'll run it later.")], {
    session: "once",
    input: { stop_hook_active: true },
  }),
  "blocked again",
);
check(
  "a new turn in the same session blocks again",
  blocks(
    run([...first, say("ok"), typed("again"), ...edit("C:/p/b.js")], {
      session: "once",
    }),
  ),
  "",
);
check(
  "a bad VERIFY_PATTERN leaves a line in the error log",
  existsSync(BAD_PATTERN_LOG) &&
    /verify-gate/.test(readFileSync(BAD_PATTERN_LOG, "utf8")),
  "no log line",
);

// A verify run at Stop: loading the verify skill and then a successful shell call is the turn's check
check(
  "a verify run (verify Skill, then a Bash call) after the edit counts as the turn's check at Stop",
  !run([
    typed("fix"),
    ...edit("C:/p/a.js"),
    tool("Skill", { skill: "verify" }),
    result(),
    ...bash("node .claude/skills/verify/drive.mjs"),
    say("Done."),
  ]),
  "blocked",
);
check(
  "loading the verify skill with no shell call after it is no check at Stop",
  blocks(
    run([
      typed("fix"),
      ...edit("C:/p/a.js"),
      tool("Skill", { skill: "verify" }),
      result(),
      say("Done."),
    ]),
  ),
  "not blocked",
);

// The commit check (--pre). Each case gets real git repositories, its own home (so its own observe log and state)
// and transcripts whose entries carry times.
let clock = Date.parse("2026-11-17T10:00:00Z");
const timed = (e) => ({
  ...e,
  timestamp: new Date((clock += 1000)).toISOString(),
});
const tTool = (name, input) => timed(tool(name, input));
const tResult = (ok = true, text = "done") => timed(result(ok, text));
const tEdit = (file) => [
  tTool("Edit", { file_path: file, old_string: "a", new_string: "b" }),
  tResult(),
];
const tBash = (command, ok = true, text = "done") => [
  tTool("Bash", { command }),
  tResult(ok, text),
];
const tVerify = (proof = "PROOF page: expected 200, got 200") => [
  tTool("Skill", { skill: "verify" }),
  tResult(true, "loaded"),
  ...tBash("node .claude/skills/verify/drive.mjs", true, proof),
];
const sh = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const SKILL_TEXT = "---\nname: verify\ndescription: test\n---\n# Verify\n";
// A folder (a git repository unless git: false) with staged files and maybe a verify skill
let folders = 0;
const folder = ({ staged = [], skill = false, git = true } = {}) => {
  const f = join(dir, `repo${++folders}`);
  mkdirSync(f, { recursive: true });
  if (git) sh(f, "init", "-q");
  for (const s of staged) {
    mkdirSync(join(f, s, ".."), { recursive: true });
    writeFileSync(join(f, s), "x\n");
    sh(f, "add", s);
  }
  if (skill) {
    mkdirSync(join(f, ".claude", "skills", "verify"), { recursive: true });
    writeFileSync(
      join(f, ".claude", "skills", "verify", "SKILL.md"),
      SKILL_TEXT,
    );
  }
  return f;
};
let homes = 0;
const newHome = () => {
  const h = join(dir, `home${++homes}`);
  mkdirSync(h, { recursive: true });
  return h;
};
const observed = (home) => {
  const f = join(home, ".claude", "hooks", "state", "observe.jsonl");
  return existsSync(f)
    ? readFileSync(f, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((l) => JSON.parse(l))
    : [];
};
// Runs the commit check. The transcript is <session>.jsonl, as Claude Code names it; `helpers` maps an agent id to
// its entries (its own file in <session>/subagents).
let commits = 0;
const pre = (
  entries,
  {
    cwd,
    command,
    tool: toolName = "Bash",
    toolInput,
    helpers = {},
    agent,
    env = {},
    home,
    session = `pre${++commits}`,
  } = {},
) => {
  const file = join(dir, `${session}.jsonl`);
  const lines = (list) => `${list.map((e) => JSON.stringify(e)).join("\n")}\n`;
  writeFileSync(file, lines(entries));
  for (const [id, list] of Object.entries(helpers)) {
    const sub = join(dir, session, "subagents");
    mkdirSync(sub, { recursive: true });
    writeFileSync(join(sub, `agent-${id}.jsonl`), lines(list));
  }
  const h = home || newHome();
  const r = spawnSync(process.execPath, [HOOK, "--pre"], {
    input: JSON.stringify({
      session_id: session,
      transcript_path: file,
      cwd,
      hook_event_name: "PreToolUse",
      tool_name: toolName,
      tool_input: toolInput ?? { command },
      ...(agent ? { agent_id: agent } : {}),
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_GATE: "",
      VERIFY_GATE_COMMIT: "",
      CLAUDE_PROJECT_DIR: dir,
      HOME: h,
      USERPROFILE: h,
      ...env,
    },
  });
  return { out: r.stdout, code: r.status, lines: observed(h), home: h };
};
const refused = (out) =>
  out.includes('"permissionDecision":"deny"') && out.includes("[verify-gate]");
const show = (r) =>
  `exit ${r.code}, out: ${r.out || "(none)"}, log: ${JSON.stringify(r.lines)}`;

const withSkill = folder({ staged: ["src/a.mjs"], skill: true });
const A = join(withSkill, "src", "a.mjs");
const unverifiedEdit = [typed("fix"), ...tEdit(A)];
const commitIn = (repo, msg = "fix: a") =>
  `git -C "${repo}" commit -m "${msg}"`;

let r = pre(unverifiedEdit, { cwd: withSkill, command: commitIn(withSkill) });
check(
  "observe (default): a code commit with no verify run in a project with a verify skill writes one would-refuse line and is not refused",
  !r.out &&
    r.code === 0 &&
    r.lines.length === 1 &&
    r.lines[0].would === "would-refuse" &&
    r.lines[0].arm === "commit",
  show(r),
);
const line = r.lines[0] ?? {};
check(
  "the log line carries repository, main or helper, the code files, the last edit's time, last verify none, PROOF seen",
  line.repo === withSkill.replace(/\\/g, "/") &&
    line.by === "main" &&
    JSON.stringify(line.files) === '["a.mjs"]' &&
    /^2026-11-17T/.test(line.lastEdit) &&
    line.lastVerify === "none" &&
    line.proof === false,
  JSON.stringify(line),
);

r = pre([...unverifiedEdit, ...tVerify()], {
  cwd: withSkill,
  command: commitIn(withSkill),
});
check(
  "a verify run after the last code edit: the commit is logged verified, with the run's time and the PROOF line seen",
  !r.out &&
    r.lines[0]?.would === "verified" &&
    /^2026-11-17T/.test(r.lines[0].lastVerify) &&
    r.lines[0].proof === true,
  show(r),
);

// Enforce: refused once per commit; the same commit again passes and is logged
const enforceHome = newHome();
const ENFORCE = { VERIFY_GATE_COMMIT: "enforce" };
const again = (entries) =>
  pre(entries, {
    cwd: withSkill,
    command: commitIn(withSkill),
    env: ENFORCE,
    home: enforceHome,
    session: "enf",
  });
r = again(unverifiedEdit);
check(
  "enforce: a due code commit is refused, naming the files and the verify skill",
  refused(r.out) &&
    r.out.includes("a.mjs") &&
    r.out.includes(".claude/skills/verify/SKILL.md"),
  show(r),
);
r = again(unverifiedEdit);
check(
  "enforce: the same commit sent again passes and is logged passed-after-refusal",
  !r.out && r.lines.at(-1)?.would === "passed-after-refusal",
  show(r),
);
r = again([...unverifiedEdit, ...tEdit(A)]);
check(
  "enforce: a new code edit makes a new commit, refused again",
  refused(r.out),
  show(r),
);
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: commitIn(withSkill),
  env: { VERIFY_GATE: "enforce" },
});
check(
  "VERIFY_GATE=enforce turns the commit refusal on too",
  refused(r.out),
  show(r),
);
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: commitIn(withSkill),
  env: { VERIFY_GATE: "off" },
});
check(
  "VERIFY_GATE=off turns the commit check off: no refusal, no line",
  !r.out && !r.lines.length,
  show(r),
);

// The reason line
for (const [dash, label] of [
  ["—", "a long dash"],
  ["-", "a typed hyphen"],
]) {
  r = pre(unverifiedEdit, {
    cwd: withSkill,
    command: `git -C "${withSkill}" commit -m "fix: a" -m "Verify: skipped ${dash} comment-only change"`,
    env: ENFORCE,
  });
  check(
    `a reason line with ${label} lets a due commit pass in enforce, logged as reason`,
    !r.out && r.lines[0]?.would === "reason",
    show(r),
  );
}
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: `git -C "${withSkill}" commit -m "$(cat <<'EOF'\nfix: a\n\nVerify: skipped — comment-only change\nEOF\n)"`,
  env: ENFORCE,
});
check(
  "a reason line inside a heredoc message passes",
  !r.out && r.lines[0]?.would === "reason",
  show(r),
);
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: commitIn(withSkill, "fix: a, Verify: skipped — inline"),
  env: ENFORCE,
});
check(
  "a reason that is not on a line of its own does not pass",
  refused(r.out),
  show(r),
);

// Which commits are checked
const docsOnly = folder({ staged: ["README.md"], skill: true });
r = pre([typed("fix"), ...tEdit(join(docsOnly, "src", "b.mjs"))], {
  cwd: docsOnly,
  command: commitIn(docsOnly),
});
check(
  "a docs-only commit is not checked: no line",
  !r.lines.length && !r.out,
  show(r),
);
const noSkill = folder({ staged: ["src/a.mjs"] });
r = pre([typed("fix"), ...tEdit(join(noSkill, "src", "a.mjs"))], {
  cwd: noSkill,
  command: commitIn(noSkill),
  env: ENFORCE,
});
check(
  "neither the repository nor the session folder has a verify skill: untouched, no line",
  !r.lines.length && !r.out,
  show(r),
);
const workshop = folder({ skill: true, git: false });
r = pre([typed("fix"), ...tEdit(join(noSkill, "src", "a.mjs"))], {
  cwd: workshop,
  command: commitIn(noSkill),
});
check(
  "a repository without a skill, committed from a session folder with one: logged, naming the session folder's skill",
  r.lines.length === 1 &&
    r.lines[0].would === "would-refuse" &&
    r.lines[0].reason.includes(
      join(workshop, ".claude", "skills", "verify", "SKILL.md").replace(
        /\\/g,
        "/",
      ),
    ),
  show(r),
);
const other = folder({ staged: ["src/c.mjs"] });
r = pre([typed("fix"), ...tEdit(join(other, "src", "c.mjs"))], {
  cwd: withSkill,
  command: commitIn(withSkill),
});
check(
  "an unverified edit in another repository than the commit's: no line",
  !r.lines.length && !r.out,
  show(r),
);

// The same state through the Nimbalyst commit tool and through PowerShell
const NIMBALYST = "mcp__nimbalyst__developer_git_commit_proposal";
const viaTool = (entries, env) =>
  pre(entries, {
    cwd: withSkill,
    tool: NIMBALYST,
    toolInput: {
      filesToStage: [{ path: "src/a.mjs", status: "modified" }],
      commitMessage: "fix: a",
    },
    env,
  });
for (const [name, entries] of [
  ["no verify run", unverifiedEdit],
  ["a verify run", [...unverifiedEdit, ...tVerify()]],
]) {
  const bashR = pre(entries, { cwd: withSkill, command: commitIn(withSkill) });
  const toolR = viaTool(entries);
  check(
    `a Bash git commit and the Nimbalyst commit tool give the same verdict (${name})`,
    bashR.lines[0]?.would && bashR.lines[0].would === toolR.lines[0]?.would,
    `${show(bashR)} | ${show(toolR)}`,
  );
}
r = viaTool(unverifiedEdit, ENFORCE);
check(
  "enforce: the Nimbalyst commit tool is refused like a Bash commit",
  refused(r.out),
  show(r),
);
r = pre(unverifiedEdit, {
  cwd: withSkill,
  tool: "PowerShell",
  command: commitIn(withSkill),
  env: ENFORCE,
});
check(
  "enforce: a PowerShell git commit is refused like a Bash one",
  refused(r.out),
  show(r),
);
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: `cd "${withSkill}" && git commit -m "fix: a"`,
});
check(
  "a leading cd names the commit's repository",
  r.lines[0]?.would === "would-refuse",
  show(r),
);
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: `git -C "${withSkill}" commit-graph write`,
});
check("git commit-graph is not a commit: no line", !r.lines.length, show(r));

// Helpers
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: commitIn(withSkill),
  helpers: { h1: [typed("verify it"), ...tVerify()] },
});
check(
  "at commit time, a helper's verify run after the main session's last edit covers the commit",
  r.lines[0]?.would === "verified",
  show(r),
);
r = pre([typed("fix"), ...tVerify()], {
  cwd: withSkill,
  command: commitIn(withSkill),
  helpers: { h1: [typed("edit it"), ...tEdit(A)] },
});
check(
  "a helper's unverified edit after the main session's verify run is seen",
  r.lines[0]?.would === "would-refuse",
  show(r),
);
r = pre([typed("fix"), ...tVerify()], {
  cwd: withSkill,
  command: commitIn(withSkill),
  agent: "h2",
  helpers: { h2: [typed("edit it"), ...tEdit(A)] },
});
check(
  "a helper's commit counts its own file alone and is logged as a helper's",
  r.lines[0]?.would === "would-refuse" && r.lines[0].by === "helper",
  show(r),
);

// Failures fail open with a crash line
const CRASH_LOG = join(dir, "commit-crash.log");
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: `git -C "${join(dir, "no-such-folder")}" commit -m "fix: a"`,
  env: { HOOK_ERRORS_LOG: CRASH_LOG },
});
check(
  "a failed git call writes a crash line and lets the commit through (exit 0, no output)",
  r.code === 0 &&
    !r.out &&
    existsSync(CRASH_LOG) &&
    /verify-gate/.test(readFileSync(CRASH_LOG, "utf8")),
  show(r),
);

// The commit's folder as the shell reads it: ~, $VAR set in the same command, a variable set elsewhere
const tildeHome = newHome();
const tildeRepo = join(tildeHome, "proj");
mkdirSync(join(tildeRepo, "src"), { recursive: true });
sh(tildeRepo, "init", "-q");
writeFileSync(join(tildeRepo, "src", "a.mjs"), "x\n");
sh(tildeRepo, "add", "src/a.mjs");
mkdirSync(join(tildeRepo, ".claude", "skills", "verify"), { recursive: true });
writeFileSync(
  join(tildeRepo, ".claude", "skills", "verify", "SKILL.md"),
  SKILL_TEXT,
);
const tildeEdit = [typed("fix"), ...tEdit(join(tildeRepo, "src", "a.mjs"))];
const FOLDER_LOG = join(dir, "folder-crash.log");
for (const [label, command] of [
  ["git -C ~/<repo> commit", 'git -C ~/proj commit -m "fix: a"'],
  ["cd ~/<repo> && git commit", 'cd ~/proj && git commit -m "fix: a"'],
  [
    'R=<repo>; git -C "$R" commit',
    `R="${tildeRepo.replace(/\\/g, "/")}"; git -C "$R" commit -m "fix: a"`,
  ],
]) {
  r = pre(tildeEdit, {
    cwd: dir,
    command,
    home: tildeHome,
    env: { HOOK_ERRORS_LOG: FOLDER_LOG },
  });
  check(
    `${label}: the folder is read as the shell reads it, so the unverified code commit is logged would-refuse with no crash`,
    r.lines.at(-1)?.would === "would-refuse" && !existsSync(FOLDER_LOG),
    show(r),
  );
}
r = pre(tildeEdit, {
  cwd: dir,
  command: 'git -C "$NO_SUCH_VERIFY_VAR" commit -m "fix: a"',
  env: { HOOK_ERRORS_LOG: FOLDER_LOG },
});
check(
  "a -C folder naming a variable with no value here is logged folder-unknown, not a crash",
  r.lines[0]?.would === "folder-unknown" &&
    r.lines[0].folder === "$NO_SUCH_VERIFY_VAR" &&
    !existsSync(FOLDER_LOG),
  show(r),
);

// The words after git commit: a redirection or a message's words are not paths
for (const [label, command] of [
  ["2>&1 | tail -1 after the commit", `${commitIn(withSkill)} 2>&1 | tail -1`],
  ["> /dev/null after the commit", `${commitIn(withSkill)} > /dev/null`],
  [
    "a two-line -m message",
    `git -C "${withSkill}" commit -m "fix: gate reads paths\n\nbody line"`,
  ],
]) {
  r = pre(unverifiedEdit, { cwd: withSkill, command });
  check(
    `${label}: the staged code file is still the commit's, so it is logged would-refuse`,
    r.lines[0]?.would === "would-refuse",
    show(r),
  );
}

// -F - with a heredoc: its reason line lets the commit through in enforce
r = pre(unverifiedEdit, {
  cwd: withSkill,
  command: `git -C "${withSkill}" commit -F - <<'EOF'\nfix: a\n\nVerify: skipped — only a comment changed\nEOF`,
  env: ENFORCE,
});
check(
  "a reason line in a -F - heredoc message passes in enforce (logged reason, not refused)",
  !refused(r.out) && r.lines[0]?.would === "reason",
  show(r),
);

// The verify skill's own script: written and fixed during a run, run again after a fix
const SKILL_DIR = join(withSkill, ".claude", "skills", "verify");
const drive = (proof = "PROOF ok") =>
  tBash("node .claude/skills/verify/drive.mjs", true, proof);
r = pre(
  [
    ...unverifiedEdit,
    tTool("Skill", { skill: "verify" }),
    tResult(true, "loaded"),
    tTool("Write", { file_path: join(SKILL_DIR, "drive.mjs"), content: "x" }),
    tResult(),
    ...drive(),
  ],
  { cwd: withSkill, command: commitIn(withSkill) },
);
check(
  "writing the verify skill's script during the run does not make the commit due (logged verified)",
  r.lines[0]?.would === "verified",
  show(r),
);
r = pre(
  [
    ...unverifiedEdit,
    tTool("Skill", { skill: "verify" }),
    tResult(true, "loaded"),
    ...drive("FAIL page"),
    ...tEdit(A),
    ...drive(),
  ],
  { cwd: withSkill, command: commitIn(withSkill) },
);
check(
  "a code fix after a verify run, then the skill's script run again, counts as verified",
  r.lines[0]?.would === "verified",
  show(r),
);
r = pre([...unverifiedEdit, ...drive()], {
  cwd: withSkill,
  command: commitIn(withSkill),
});
check(
  "the skill's script run with no load of the skill in the session is not a verify run",
  r.lines[0]?.would === "would-refuse",
  show(r),
);

// One repository under two spellings: a link (a junction on Windows) to it
const linked = join(dir, "linked");
symlinkSync(withSkill, linked, "junction");
r = pre([typed("fix"), ...tEdit(join(linked, "src", "a.mjs"))], {
  cwd: linked,
  command: commitIn(linked),
});
check(
  "an edit spelled through a link to the repository counts as inside it (git names the real folder)",
  r.lines[0]?.would === "would-refuse",
  show(r),
);

rmSync(dir, { recursive: true, force: true });
summary();
