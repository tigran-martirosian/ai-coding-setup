// Tests for hooks/lib/import-cycles.mjs and verify-gate's end-of-turn cycle check.
// Run: node tests/test-import-cycles.mjs
// Each case builds a small git repository of JS/TS files, commits a starting state, edits files on disk and asks
// which import cycles the edits added (a cycle that was already in the last commit is not the turn's).
import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { importNames, newCycles } from "../hooks/lib/import-cycles.mjs";
import { makeChecker } from "./lib/kit.mjs";

const { check, summary } = makeChecker();
const HOOK = fileURLToPath(
  new URL("../hooks/verify-gate.mjs", import.meta.url),
);
const root = mkdtempSync(join(tmpdir(), "test-import-cycles-"));
let n = 0;

const git = (repo, ...args) => {
  const r = spawnSync("git", ["-C", repo, ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
};
const put = (repo, files) => {
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(repo, rel)), { recursive: true });
    writeFileSync(join(repo, rel), text);
  }
};
// A repository with `start` committed, then `after` written on top (not committed)
function repoOf(start, after = {}) {
  const repo = join(root, `r${++n}`);
  mkdirSync(repo, { recursive: true });
  git(repo, "init", "-q");
  git(repo, "config", "user.email", "t@example.com");
  git(repo, "config", "user.name", "t");
  put(repo, start);
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "start");
  put(repo, after);
  return repo;
}
const abs = (repo, rels) => rels.map((r) => join(repo, r));

// 1. A turn that makes b import a, where a already imports b: a new cycle, named in order
{
  const repo = repoOf(
    { "a.ts": 'import { b } from "./b";\n', "b.ts": "export const b = 1;\n" },
    { "b.ts": 'import { a } from "./a";\nexport const b = 1;\n' },
  );
  const c = newCycles(abs(repo, ["b.ts"]));
  check(
    "an edit that closes a loop between two files is a new cycle",
    c.length === 1 && c[0].join(" ") === "b.ts a.ts b.ts",
    JSON.stringify(c),
  );
}

// 2. A cycle already in the last commit, touched by the turn: not the turn's
{
  const repo = repoOf(
    {
      "a.ts": 'import { b } from "./b";\n',
      "b.ts": 'import { a } from "./a";\n',
    },
    { "b.ts": 'import { a } from "./a";\nexport const more = 2;\n' },
  );
  const c = newCycles(abs(repo, ["b.ts"]));
  check(
    "a cycle that was already there is not new",
    c.length === 0,
    JSON.stringify(c),
  );
}

// 3. A type-only import makes no cycle at run time
{
  const repo = repoOf(
    { "a.ts": 'import { b } from "./b";\n', "b.ts": "export const b = 1;\n" },
    { "b.ts": 'import type { A } from "./a";\nexport const b = 1;\n' },
  );
  check(
    "a type-only import is not a cycle",
    newCycles(abs(repo, ["b.ts"])).length === 0,
  );
}

// 4. A longer loop through a folder's index and an ESM-style ".js" name for a .ts file
{
  const repo = repoOf(
    {
      "src/a.ts": 'import { b } from "./lib/index.js";\n',
      "src/lib/index.ts": 'export * from "./c";\n',
      "src/lib/c.ts": "export const c = 1;\n",
    },
    { "src/lib/c.ts": 'import { a } from "../a.js";\nexport const c = 1;\n' },
  );
  const c = newCycles(abs(repo, ["src/lib/c.ts"]));
  check(
    "a three-file loop through index and a .js name is found",
    c.length === 1 &&
      c[0].join(" ") === "src/lib/c.ts src/a.ts src/lib/index.ts src/lib/c.ts",
    JSON.stringify(c),
  );
}

// 5. A new file that joins a loop (it had no last-commit version), with require and a dynamic import
{
  const repo = repoOf(
    { "a.js": "const n = require('./n');\n" },
    { "n.js": "module.exports = () => import('./a.js');\n" },
  );
  const c = newCycles(abs(repo, ["n.js"]));
  check(
    "a new file that closes a loop by require and import() is a new cycle",
    c.length === 1 && c[0].join(" ") === "n.js a.js n.js",
    JSON.stringify(c),
  );
}

// 6. Package imports, a file outside any repository and a non-JS file are skipped
{
  const repo = repoOf({ "a.ts": 'import x from "react";\n' }, {});
  const loose = join(root, "loose.ts");
  writeFileSync(loose, 'import { y } from "./loose";\n');
  check(
    "package imports, a file outside a repository and a Python file give no cycle",
    newCycles([...abs(repo, ["a.ts"]), loose, join(repo, "x.py")]).length === 0,
  );
}

// 7. A file's import of itself is not counted (it is a different smell, and a re-export barrel can do it)
{
  const repo = repoOf(
    { "a.ts": "export const a = 1;\n" },
    {
      "a.ts": 'import "./a";\nexport const a = 1;\n',
    },
  );
  check(
    "a file importing itself is not counted",
    newCycles(abs(repo, ["a.ts"])).length === 0,
  );
}

// 8. The file named through a linked folder (macOS /var is /private/var): the loop is still found, paths from the top
{
  const repo = repoOf(
    { "a.ts": 'import { b } from "./b";\n', "b.ts": "export const b = 1;\n" },
    { "b.ts": 'import { a } from "./a";\nexport const b = 1;\n' },
  );
  const linked = join(root, `link${n}`);
  symlinkSync(repo, linked, "junction");
  const c = newCycles([join(linked, "b.ts")]);
  check(
    "a file named through a linked folder still gives the loop, named from the top",
    c.length === 1 && c[0].join(" ") === "b.ts a.ts b.ts",
    JSON.stringify(c),
  );
}

// The Stop hook: a turn whose edit adds a cycle is blocked once with the loop named; VERIFY_GATE_CYCLES=off skips it
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
const result = () => ({
  type: "user",
  message: {
    role: "user",
    content: [{ type: "tool_result", tool_use_id: `t${id}`, content: "done" }],
  },
});
function stop(repo, entries, env = {}) {
  const file = join(root, `t${++n}.jsonl`);
  writeFileSync(file, entries.map((e) => JSON.stringify(e)).join("\n") + "\n");
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      session_id: `s${n}`,
      transcript_path: file,
      hook_event_name: "Stop",
      stop_hook_active: false,
      cwd: repo,
    }),
    encoding: "utf8",
    env: {
      ...process.env,
      VERIFY_GATE: "",
      VERIFY_PATTERN: "",
      VERIFY_GATE_CYCLES: "",
      CLAUDE_PROJECT_DIR: repo,
      HOME: root,
      USERPROFILE: root,
      ...env,
    },
  }).stdout;
}
{
  const repo = repoOf(
    { "a.ts": 'import { b } from "./b";\n', "b.ts": "export const b = 1;\n" },
    { "b.ts": 'import { a } from "./a";\nexport const b = 1;\n' },
  );
  const turn = [
    typed("wire b to a"),
    tool("Edit", {
      file_path: join(repo, "b.ts"),
      old_string: "x",
      new_string: "y",
    }),
    result(),
    tool("Bash", { command: "npm test" }),
    result(),
  ];
  const out = stop(repo, turn);
  check(
    "a tested turn that added a cycle is blocked, the loop named",
    out.includes('"decision":"block"') && out.includes("b.ts → a.ts → b.ts"),
    out,
  );
  check(
    "VERIFY_GATE_CYCLES=off lets it finish",
    stop(repo, turn, { VERIFY_GATE_CYCLES: "off" }) === "",
  );
  const fine = repoOf(
    { "a.ts": "export const a = 1;\n" },
    { "a.ts": "export const a = 2;\n" },
  );
  check(
    "a tested turn with no new cycle finishes",
    stop(fine, [
      typed("bump a"),
      tool("Edit", {
        file_path: join(fine, "a.ts"),
        old_string: "1",
        new_string: "2",
      }),
      result(),
      tool("Bash", { command: "npm test" }),
      result(),
    ]) === "",
  );
}

// Long runs of spaces or blank lines (no from, no quote) are read in linear time, not by backtracking
{
  const t = Date.now();
  importNames(`import ${" ".repeat(50000)}x`);
  importNames(`${" import".repeat(20000)}`);
  importNames(`import {${" a,".repeat(20000)}`);
  importNames(`${"\n".repeat(50000)}x`);
  const ms = Date.now() - t;
  check(
    "long runs of spaces, import words or blank lines are read in under a second",
    ms < 1000,
    `${ms} ms`,
  );
  check(
    "an import is still read after the change",
    importNames('import { a } from "./a";\nexport * from "./b";\n').join(
      " ",
    ) === "./a ./b",
  );
}

rmSync(root, { recursive: true, force: true });
summary();
