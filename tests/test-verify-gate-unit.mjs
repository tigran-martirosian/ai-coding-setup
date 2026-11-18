// Unit tests for the exports of hooks/verify-gate.mjs (unverified, runsEdited, commitState): running an edited script counts as its check; other commands do not; a verify run (load, then a shell call) counts at its load. Run: node tests/test-verify-gate-unit.mjs
import assert from "node:assert/strict";
import { commitState, runsEdited, unverified } from "../hooks/verify-gate.mjs";

const edit = (id, p) => ({
  type: "assistant",
  message: {
    content: [{ type: "tool_use", id, name: "Edit", input: { file_path: p } }],
  },
});
const bash = (id, command) => ({
  type: "assistant",
  message: {
    content: [{ type: "tool_use", id, name: "Bash", input: { command } }],
  },
});
const P = "C:\\Projects\\x\\tools\\grow-house\\melon_carts.py";

assert.equal(
  runsEdited("cd /c/x && python tools/grow-house/melon_carts.py > /dev/null", [
    "melon_carts.py",
  ]),
  true,
);
assert.equal(
  runsEdited("python -I tools/melon_carts.py --out x", ["melon_carts.py"]),
  true,
);
assert.equal(runsEdited("node C:/a/b/gen.mjs", ["gen.mjs"]), true);
assert.equal(
  runsEdited("grep -n x tools/grow-house/melon_carts.py", ["melon_carts.py"]),
  false,
);
assert.equal(
  runsEdited("python tools/other_melon_carts.py", ["melon_carts.py"]),
  false,
);
assert.equal(
  runsEdited("cat melon_carts.py | python", ["melon_carts.py"]),
  false,
);

assert.equal(
  unverified(
    [edit("1", P), bash("2", "python tools/grow-house/melon_carts.py")],
    null,
  ).due,
  false,
);
assert.equal(
  unverified(
    [edit("1", P), bash("2", "grep x tools/grow-house/melon_carts.py")],
    null,
  ).due,
  true,
);
assert.equal(
  unverified(
    [bash("0", "python tools/grow-house/melon_carts.py"), edit("1", P)],
    null,
  ).due,
  true,
); // run before the edit
assert.equal(
  unverified([edit("1", P), bash("2", "cd mdk && ./gradlew build")], null).due,
  false,
); // builds still count
const Q = "C:\\h\\hooks\\b.mjs";
assert.equal(
  unverified(
    [
      edit("1", P),
      edit("2", Q),
      bash("3", "python tools/grow-house/melon_carts.py"),
    ],
    null,
  ).due,
  true,
); // b.mjs unrun
assert.equal(
  unverified(
    [
      edit("1", P),
      edit("2", Q),
      bash("3", "python melon_carts.py"),
      bash("4", "node hooks/b.mjs"),
    ],
    null,
  ).due,
  false,
);
assert.equal(
  unverified(
    [edit("1", P), bash("2", "python melon_carts.py"), edit("3", P)],
    null,
  ).due,
  true,
); // edited again after its run
assert.equal(
  unverified(
    [
      edit("1", Q),
      edit("2", "C:\\h\\b.test.mjs"),
      bash("3", "node hooks/b.test.mjs"),
    ],
    null,
  ).due,
  false,
); // a *.test.mjs run is a test

// A verify run: a load of a verify skill, then one successful shell call; it counts at the load
const call = (id, name, input, at) => ({
  type: "assistant",
  ...(at ? { timestamp: at } : {}),
  message: { content: [{ type: "tool_use", id, name, input }] },
});
const failedResult = (id) => ({
  type: "user",
  message: {
    content: [
      { type: "tool_result", tool_use_id: id, content: "x", is_error: true },
    ],
  },
});
const skill = (id, name) => call(id, "Skill", { skill: name });
const due = (list) => unverified(list, null).due;
const VERIFY_SKILL = "C:\\h\\.claude\\skills\\verify\\SKILL.md";
assert.equal(
  due([edit("1", Q), skill("2", "verify"), bash("3", "ls")]),
  false,
  "a verify run (verify Skill, then a successful Bash call) after the edit must count as the check",
);
assert.equal(
  due([edit("1", Q), skill("2", "verify")]),
  true,
  "loading the verify skill with nothing run after it must not count",
);
assert.equal(
  due([skill("1", "verify"), edit("2", Q), bash("3", "ls")]),
  true,
  "a verify run counts at its load: an edit between the load and the shell call must stay due",
);
assert.equal(
  due([
    edit("1", Q),
    call("2", "Read", { file_path: VERIFY_SKILL }),
    bash("3", "ls"),
  ]),
  false,
  "a Read of .claude/skills/verify/SKILL.md must count as a load of the verify skill",
);
assert.equal(
  due([edit("1", Q), skill("2", "verify"), bash("3", "ls"), failedResult("3")]),
  true,
  "a shell call whose result is marked is_error must not complete a verify run",
);
assert.equal(
  due([edit("1", Q), skill("2", "review"), bash("3", "ls")]),
  true,
  "a Skill named review is not a verify skill and must not count",
);
for (const name of ["verify-api", "plugin:verify"])
  assert.equal(
    due([edit("1", Q), skill("2", name), bash("3", "ls")]),
    false,
    `a Skill named ${name} must count as a verify skill`,
  );
assert.equal(
  due([
    edit("1", Q),
    {
      type: "user",
      message: { content: "<command-name>/verify</command-name>" },
    },
    bash("3", "ls"),
  ]),
  false,
  "the user typing /verify must count as a load",
);

// At commit time the files are merged by entry time
const at = (s) => `2026-11-17T10:00:${String(s).padStart(2, "0")}Z`;
const REPO = "C:\\h";
const mainList = [call("1", "Edit", { file_path: Q }, at(1))];
const helperRun = [
  call("h1", "Skill", { skill: "verify" }, at(5)),
  call("h2", "Bash", { command: "node drive.mjs" }, at(6)),
];
assert.equal(
  commitState([mainList, helperRun], REPO).due,
  false,
  "at commit time, a helper file holding a verify load and run after the main session's last edit must cover the commit",
);
assert.equal(
  commitState(
    [[...mainList, call("2", "Edit", { file_path: Q }, at(9))], helperRun],
    REPO,
  ).due,
  true,
  "at commit time, a main-session edit after the helper's verify run must stay due",
);
assert.equal(
  commitState(
    [[call("1", "Edit", { file_path: "C:\\other\\b.mjs" }, at(1))]],
    REPO,
  ).edit,
  null,
  "an edit in another repository than the commit's must not count",
);
console.log("verify-gate tests passed");
