// Tests for hooks/verify-gate.mjs. Run: node tests/test-verify-gate.mjs
// Each case writes a small transcript and runs the hook on it as a Stop event.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
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

rmSync(dir, { recursive: true, force: true });
summary();
