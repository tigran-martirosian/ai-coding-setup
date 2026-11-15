// Tests for hooks/map-drift.mjs. Run: node tests/test-map-drift.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/map-drift.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "map-drift-test-"));
const STATE = path.join(tmp, "home"); // the hook's HOME
const STATE_FILE = path.join(
  STATE,
  ".claude",
  "hooks",
  "state",
  "map-drift",
  "said.json",
);
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
      id: "cart",
      name: "Shopping cart",
      what: "Holds the items.",
      files: ["src/cart.js"],
    },
    {
      id: "pricing",
      name: "Pricing",
      what: "Prices things.",
      files: ["src/price.js"],
    },
    {
      id: "ship",
      name: "Parcel dispatch",
      what: "Sends parcels.",
      files: ["src/ship.js"],
    },
  ],
  links: [
    {
      from: "cart",
      to: "pricing",
      says: "Cart asks pricing for the total.",
      evidence: [{ file: "src/cart.js", token: "priceOf" }, "src/price.js"],
    },
    {
      from: "ship",
      to: "cart",
      says: "Dispatch reads the cart.",
      evidence: [
        { file: "src/cart.js", token: "cartItems" },
        { file: "src/ship.js", token: "dispatch" },
      ],
    },
    {
      from: "pricing",
      to: "ship",
      says: "Path-only link.",
      evidence: ["src/price.js", "src/plain.js"],
    },
  ],
};
const project = (name, files, map = MAP) => {
  const dir = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".claude", "systems-map.json"),
    JSON.stringify(map),
  );
  return dir;
};
const FILES = {
  "src/cart.js": "function priceOf(){}; const cartItems = [];",
  "src/price.js": "x",
  "src/ship.js": "function dispatch(){}",
  "src/plain.js": "x",
  "other.js": "x",
};
const run = (dir, input, env = {}) =>
  spawnSync("node", [HOOK], {
    input: typeof input === "string" ? input : JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      MAP_DRIFT: "",
      CLAUDE_PROJECT_DIR: dir,
      HOME: STATE,
      USERPROFILE: STATE,
      ...env,
    },
  });
const edit = (file, tool = "Edit") => ({
  tool_name: tool,
  tool_input: { file_path: file },
});
const context = (r) => {
  try {
    return JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  } catch {
    return "";
  }
};
const reset = () => fs.rmSync(STATE, { recursive: true, force: true });

// ---- fires when a token is gone
const dir = project("main", {
  ...FILES,
  "src/cart.js": "function other(){}; const cartItems = [];",
});
let r = run(dir, edit(path.join(dir, "src/cart.js")));
const text = context(r);
check(
  "token gone: says which link, what it says and which token",
  text ===
    '[map-drift] src/cart.js backs the link Shopping cart -> Pricing ("Cart asks pricing for the total.") and no longer has "priceOf". Before done: check Pricing still holds, then fix that link\'s evidence in .claude/systems-map.json or drop the link.',
  r.stdout + r.stderr,
);
check(
  "the output is a PostToolUse context",
  JSON.parse(r.stdout).hookSpecificOutput.hookEventName === "PostToolUse",
);
check(
  "a token still there in the same file (cartItems): that link is not named",
  !/Parcel dispatch -> Shopping cart|Shopping cart -> Parcel/.test(text),
);
check("exit 0, nothing on stderr", r.status === 0 && r.stderr === "");

// ---- other tools and path shapes
reset();
check(
  "relative file_path works",
  /no longer has "priceOf"/.test(context(run(dir, edit("src/cart.js")))),
);
reset();
// Backslash paths come only from Windows; elsewhere a backslash is a plain character in a file name
if (process.platform === "win32")
  check(
    "backslash path works",
    /no longer has "priceOf"/.test(
      context(
        run(dir, edit(path.join(dir, "src", "cart.js").replace(/\//g, "\\"))),
      ),
    ),
  );
reset();
check(
  "Write works",
  /no longer has "priceOf"/.test(
    context(run(dir, edit(path.join(dir, "src/cart.js"), "Write"))),
  ),
);
reset();
check(
  "notebook_path works",
  /no longer has "priceOf"/.test(
    context(
      run(dir, {
        tool_name: "NotebookEdit",
        tool_input: { notebook_path: path.join(dir, "src/cart.js") },
      }),
    ),
  ),
);

// ---- two links on one file
reset();
const two = project("two", {
  ...FILES,
  "src/cart.js": "nothing",
  "src/price.js": "x",
});
const lines = context(run(two, edit("src/cart.js"))).split("\n");
check(
  "two links with a lost token in one file: one line each",
  lines.length === 2 &&
    /Shopping cart -> Pricing/.test(lines[0]) &&
    /Parcel dispatch -> Shopping cart/.test(lines[1]) &&
    /"cartItems"/.test(lines[1]),
  lines.join("|"),
);

// ---- silent cases
reset();
const sound = project("sound", FILES);
check("token present: silent", run(sound, edit("src/cart.js")).stdout === "");
check(
  "a file the map does not list: silent",
  run(dir, edit("other.js")).stdout === "",
);
check(
  "a file listed only as a thing file or by path-only evidence: silent",
  run(dir, edit("src/plain.js")).stdout === "" &&
    run(dir, edit("src/price.js")).stdout === "",
);
check(
  "a file outside the project with no map above it: silent",
  run(dir, edit(path.join(tmp, "elsewhere", "src/cart.js"))).stdout === "",
);
reset();
const wt = project("main_worktrees/lane-a", {
  ...FILES,
  "src/cart.js": "function other(){}; const cartItems = [];",
});
check(
  "a file in a worktree outside the project: checked against the worktree's own map",
  /no longer has "priceOf"/.test(
    context(run(sound, edit(path.join(wt, "src/cart.js")))),
  ),
);
reset();
check(
  "MAP_DRIFT=off: silent, nothing recorded",
  run(dir, edit("src/cart.js"), { MAP_DRIFT: "off" }).stdout === "" &&
    !fs.existsSync(STATE_FILE),
);
const nomap = path.join(tmp, "nomap");
fs.mkdirSync(nomap, { recursive: true });
check("no map file: silent", run(nomap, edit("src/cart.js")).stdout === "");
check(
  "no project folder in the environment: silent",
  run("", edit("src/cart.js")).stdout === "",
);
check(
  "a tool call with no file path: silent",
  run(dir, { tool_name: "Bash", tool_input: { command: "ls" } }).stdout === "",
);

// ---- once per project + file + link per hour
reset();
check(
  "first edit says it",
  /priceOf/.test(context(run(dir, edit("src/cart.js")))),
);
check(
  "second edit within the hour: silent",
  run(dir, edit("src/cart.js")).stdout === "",
);
const state = JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
const key = Object.keys(state)[0];
state[key] = Date.now() - 61 * 60 * 1000;
fs.writeFileSync(STATE_FILE, JSON.stringify(state));
check(
  "over an hour later: says it again",
  /priceOf/.test(context(run(dir, edit("src/cart.js")))),
);
const other = project("main2", {
  ...FILES,
  "src/cart.js": "function other(){}; const cartItems = [];",
});
check(
  "another project with the same file and link: says it (state is per project)",
  /priceOf/.test(context(run(other, edit("src/cart.js")))),
);

// ---- junk and failures
reset();
r = run(dir, "not json");
check(
  "junk stdin: exit 0, no output",
  r.status === 0 && r.stdout === "",
  r.stderr,
);
const crashLog = path.join(tmp, "crash.log");
spawnSync("node", [HOOK], {
  input: "not json",
  env: {
    ...process.env,
    HOOK_ERRORS_LOG: crashLog,
    CLAUDE_PROJECT_DIR: dir,
    HOME: STATE,
    USERPROFILE: STATE,
  },
});
check(
  "junk stdin leaves a crash-log line from map-drift",
  /map-drift: /.test(
    fs.existsSync(crashLog) ? fs.readFileSync(crashLog, "utf8") : "",
  ),
);
const badmap = project("badmap", FILES);
fs.writeFileSync(
  path.join(badmap, ".claude", "systems-map.json"),
  "{ not json",
);
r = run(badmap, edit("src/cart.js"));
check(
  "a map that does not parse: fails open (exit 0, no output)",
  r.status === 0 && r.stdout === "",
);
check(
  "empty stdin: exit 0, no output",
  (r = run(dir, "")).status === 0 && r.stdout === "",
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
