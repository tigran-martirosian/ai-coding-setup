// Tests for hooks/map-generated.mjs and the "generated" list of skills/systems-map/map.mjs. Run: node tests/test-map-generated.mjs
process.env.HOOK_ERRORS_LOG = "off";

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/map-generated.mjs", import.meta.url),
);
const MAPJS = fileURLToPath(
  new URL("../skills/systems-map/map.mjs", import.meta.url),
);
const { checkMap, handEdits, generatorOf } = await import(
  pathToFileURL(MAPJS).href
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "map-generated-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`,
  );
};

const MAP = {
  nodes: [
    {
      id: "road",
      name: "Road quest",
      what: "The quest line.",
      files: ["tools/road.py"],
    },
  ],
  links: [],
  generated: [
    {
      files: ["out/road.json", "docs/steps.md"],
      by: "tools/road.py",
      run: "python tools/road.py",
    },
  ],
};
const dir = path.join(tmp, "p");
const put = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
put("tools/road.py", "print(1)");
put("out/road.json", "{}");
put("docs/steps.md", "x");
put("src/other.js", "x");
put(".claude/systems-map.json", JSON.stringify(MAP));
const run = (input, env = {}) =>
  spawnSync("node", [HOOK], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: { ...process.env, MAP_GENERATED: "", CLAUDE_PROJECT_DIR: dir, ...env },
  });
const edit = (file, tool = "Edit") => ({
  tool_name: tool,
  tool_input: { file_path: file },
});
const denied = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput;
  } catch {
    return null;
  }
};

// ---- hook
let r = run(edit(path.join(dir, "out/road.json")));
const o = denied(r);
check(
  "a generated file is refused",
  o?.permissionDecision === "deny" && o.hookEventName === "PreToolUse",
  r.stdout + r.stderr,
);
check(
  "the refusal names the script and the command",
  /written by tools\/road\.py/.test(o?.permissionDecisionReason) &&
    /run `python tools\/road\.py`/.test(o?.permissionDecisionReason),
);
check(
  "Write is refused too",
  denied(run(edit(path.join(dir, "docs/steps.md"), "Write")))
    ?.permissionDecision === "deny",
);
check(
  "relative and backslash paths",
  denied(run(edit("out\\road.json")))?.permissionDecision === "deny" &&
    denied(run(edit("./docs/steps.md")))?.permissionDecision === "deny",
);
check(
  "case of the path ignored (Windows)",
  denied(run(edit(path.join(dir, "OUT/Road.json"))))?.permissionDecision ===
    "deny",
);
r = run(edit(path.join(dir, "tools/road.py")));
check("the script itself may be edited", r.stdout === "" && r.status === 0);
check(
  "another file is silent",
  run(edit(path.join(dir, "src/other.js"))).stdout === "",
);
check(
  "MAP_GENERATED=off is silent",
  run(edit(path.join(dir, "out/road.json")), { MAP_GENERATED: "off" })
    .stdout === "",
);
const wt = path.join(dir, "wt");
fs.mkdirSync(path.join(wt, ".claude"), { recursive: true });
fs.writeFileSync(
  path.join(wt, ".claude", "systems-map.json"),
  JSON.stringify(MAP),
);
check(
  "a worktree file outside the project uses the nearest map",
  denied(
    spawnSync("node", [HOOK], {
      input: JSON.stringify(edit(path.join(wt, "out/road.json"))),
      encoding: "utf8",
      env: { ...process.env, CLAUDE_PROJECT_DIR: path.join(tmp, "elsewhere") },
    }),
  )?.permissionDecision === "deny",
);
const nomap = path.join(tmp, "nomap");
fs.mkdirSync(nomap);
check(
  "no map: silent",
  spawnSync("node", [HOOK], {
    input: JSON.stringify(edit(path.join(nomap, "out/road.json"))),
    encoding: "utf8",
    env: { ...process.env, CLAUDE_PROJECT_DIR: nomap },
  }).stdout === "",
);
r = spawnSync("node", [HOOK], {
  input: "not json",
  encoding: "utf8",
  env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
});
check("junk input fails open", r.status === 0 && r.stdout === "");

// ---- map.mjs
check(
  "generatorOf finds the script",
  generatorOf(MAP, "out/road.json")?.by === "tools/road.py" &&
    generatorOf(MAP, "src/other.js") === null,
);
check(
  "a good generated list has no mistakes",
  checkMap(MAP, dir).bad.length === 0,
);
const badMap = { ...MAP, generated: [{ files: [], by: "", run: "" }, "x"] };
check(
  "a bad generated list is named",
  checkMap(badMap, dir).bad.filter((b) => b.startsWith("generated")).length ===
    4,
  JSON.stringify(checkMap(badMap, dir).bad),
);
check(
  "a missing generated file is GONE",
  checkMap(
    {
      ...MAP,
      generated: [{ files: ["out/none.json"], by: "tools/road.py", run: "x" }],
    },
    dir,
  ).gone.some(([p]) => p === "out/none.json"),
);
check(
  "not a git repository: no hand edits, no error",
  handEdits(MAP, dir).length === 0,
);
const git = (...a) =>
  execFileSync("git", ["-C", dir, ...a], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
git("init", "-q");
git("config", "user.email", "t@t");
git("config", "user.name", "t");
git("add", "-A");
git("commit", "-qm", "script and outputs");
check(
  "script and outputs in one commit: clean",
  handEdits(MAP, dir).length === 0,
);
put("out/road.json", '{"a":1}');
git("commit", "-qam", "hand edit of the output");
const h = handEdits(MAP, dir);
check(
  "an output changed after the script: HAND, with the commit",
  h.length === 1 &&
    h[0].file === "out/road.json" &&
    /hand edit of the output/.test(h[0].commits[0]),
  JSON.stringify(h),
);
put("tools/road.py", "print(2)");
put("out/road.json", '{"a":2}');
git("commit", "-qam", "script changed and rerun");
check(
  "the script changed and rerun after: clean again",
  handEdits(MAP, dir).length === 0,
);
const withInput = {
  ...MAP,
  generated: [{ ...MAP.generated[0], inputs: ["docs/in.md"] }],
};
put("docs/in.md", "x");
put("out/road.json", '{"a":3}');
git("add", "-A");
git("commit", "-qm", "input changed and rerun");
check(
  "an input change with the rerun counts as a run",
  handEdits(withInput, dir).length === 0 && handEdits(MAP, dir).length === 1,
);
const cli = spawnSync("node", [MAPJS, "--project", dir, "--check"], {
  encoding: "utf8",
});
check(
  "--check prints HAND and fails",
  cli.status === 1 &&
    /^HAND out\/road\.json/m.test(cli.stdout) &&
    /1 hand-edited/.test(cli.stdout),
  cli.stdout + cli.stderr,
);
const nearOut = spawnSync("node", [MAPJS, "--project", dir, "--near", "road"], {
  encoding: "utf8",
}).stdout;
check("--near names a thing's generated file", !/Generated:/.test(nearOut)); // tools/road.py is the script, not an output
// a lane reruns the script, main changes the script later, then the lane is merged: the lane's rerun is in last..HEAD but is a run
const fresh = {
  ...MAP,
  generated: [{ ...MAP.generated[0], files: ["docs/steps.md"] }],
};
put("docs/steps.md", "fresh");
git("commit", "-qam", "steps rerun on main");
git("checkout", "-qb", "lane");
put("tools/road.py", "print(3)");
put("docs/steps.md", "lane run");
git("commit", "-qam", "lane: script and rerun");
git("checkout", "-q", "-");
put("tools/road.py", "print(4)");
git("commit", "-qam", "main: script change");
git("merge", "-q", "--no-edit", "-X", "theirs", "lane");
check(
  "a merged lane's script-and-rerun commit is not a hand edit",
  handEdits(fresh, dir).length === 0,
  JSON.stringify(handEdits(fresh, dir)),
);
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
