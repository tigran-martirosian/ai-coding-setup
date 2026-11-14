// Tests for hooks/map-prompt.mjs (UserPromptSubmit): a person's message gets the parts of the project's map it names, less the ones
// whose first file the session already holds. HOME and USERPROFILE point at a temp home, so "already held" never reads the real ~/.claude.
// Run: node tests/test-map-prompt.mjs

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/map-prompt.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "map-prompt-test-"));
const home = path.join(tmp, "home");
fs.mkdirSync(home, { recursive: true });
let pass = 0,
  fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n     ${extra}`}`);
};

const project = (name, files, map) => {
  const dir = path.join(tmp, name);
  for (const rel of files) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), "x");
  }
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  if (map !== null)
    fs.writeFileSync(
      path.join(dir, ".claude", "systems-map.json"),
      typeof map === "string" ? map : JSON.stringify(map),
    );
  return dir;
};

const node = (id, name, files, words, extra = {}) => ({
  id,
  name,
  what: "",
  files,
  words,
  ...extra,
});
const MAP = {
  nodes: [
    node("billing", "Billing", ["src/billing.js"], ["\\bweb search"]),
    node(
      "do-web-research",
      "How to: web research",
      ["notes/web.md", "tools/peek.mjs", "gone.md"],
      ["\\bweb search", "search the web", "\\bonline\\b"],
      { group: "how-to" },
    ),
    node(
      "do-release",
      "How to: release",
      ["notes/release.md"],
      ["\\brelease\\b"],
      { group: "how-to" },
    ),
    node(
      "topic-pricing",
      "Pricing",
      ["src/billing.js", "notes/prices.md"],
      ["\\bprices?\\b"],
      { group: "topic" },
    ),
  ],
  links: [],
};
const FILES = [
  "src/billing.js",
  "notes/web.md",
  "tools/peek.mjs",
  "notes/release.md",
  "notes/prices.md",
];
const dir = project("p1", FILES, MAP);

let sid = 0;
const run = (prompt, { cwd = dir, session = `s${++sid}`, env = {} } = {}) => {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt, session_id: session, cwd }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOOK_ERRORS_LOG: "off",
      CLAUDE_PROJECT_DIR: cwd,
      MAP_PROMPT: "",
      ...env,
    },
  });
  let ctx = "";
  if (r.stdout.trim())
    ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
  return { ctx, code: r.status, err: r.stderr };
};

let r = run("do a web search on allocators");
check(
  "a how-to thing matched by words is shown with its files",
  r.ctx.includes("- How to: web research: notes/web.md, tools/peek.mjs"),
  r.ctx,
);
check(
  "the note starts with the parts head",
  r.ctx.startsWith(
    "[map-prompt] Parts of this project's systems map that this message names",
  ),
  r.ctx,
);
check(
  "a file that no longer exists is left out",
  !r.ctx.includes("gone.md"),
  r.ctx,
);
check(
  "a part of the code whose words match, but not its name, is not shown",
  !r.ctx.includes("Billing"),
  r.ctx,
);
check("exit 0", r.code === 0, r.err);

r = run("the billing totals are off by a cent");
check(
  "a part of the code named by its name is shown with its files",
  r.ctx.includes("- Billing: src/billing.js"),
  r.ctx,
);

r = run("what do the prices look like this week");
check(
  "a topic is shown",
  r.ctx.includes("- Pricing: src/billing.js, notes/prices.md"),
  r.ctx,
);

r = run("what is the newest Node.js LTS release");
check(
  "a words entry that is one bare common word (\\brelease\\b) gives no note",
  r.ctx === "",
  r.ctx,
);

run("search the web", { session: "same" });
r = run("search the web again before the prices change", { session: "same" });
check(
  "a thing shown before in the session is not repeated",
  !r.ctx.includes("web research") && r.ctx.includes("Pricing"),
  r.ctx,
);
r = run("web, web, web", { session: "same" });
check("nothing new matched: silent", r.ctx === "", r.ctx);

const named = project("p6", ["notes/garden.md"], {
  nodes: [
    node("do-tidy-garden", "How to: tidy the garden", ["notes/garden.md"], [], {
      group: "how-to",
    }),
    node("topic-soil", "Soil care", ["notes/garden.md"], [], {
      group: "topic",
    }),
  ],
  links: [],
});
r = run("please tidy the garden today", { cwd: named });
check(
  "a how-to thing is matched by its name without 'How to:'",
  r.ctx.includes("How to: tidy the garden"),
  r.ctx,
);
r = run("what about soil care", { cwd: named });
check("a topic is matched by its name", r.ctx.includes("Soil care"), r.ctx);

const filler = " and then we talked about lunch".repeat(60);
r = run("we should search the web" + filler);
check("a long message: one passing word is not enough", r.ctx === "", r.ctx);
r = run("search the web, the web results online" + filler);
check("a long message: two hits are", r.ctx.includes("web research"), r.ctx);
r = run(
  "tidy this <pasted_content id=x>search the web for release notes</pasted_content> please",
);
check("pasted text does not count", r.ctx === "", r.ctx);
r = run("look at this ```search the web``` thanks");
check("a code fence does not count", r.ctx === "", r.ctx);

// A thing whose first file the session holds from its start (skill, rules file, CLAUDE.md, agent) only repeats it: no note.
const heldDir = project(
  "p9",
  [
    ".claude/skills/shed/SKILL.md",
    ".claude/rules/water.md",
    "CLAUDE.md",
    ".claude/agents/walker.md",
    "tools/mow.mjs",
  ],
  {
    nodes: [
      node(
        "do-shed",
        "How to: tidy the shed",
        [".claude/skills/shed/SKILL.md"],
        ["\\bshed\\b"],
        { group: "how-to" },
      ),
      node(
        "do-water",
        "How to: water plants",
        [".claude/rules/water.md", "tools/mow.mjs"],
        ["\\bwater\\b"],
        { group: "how-to" },
      ),
      node(
        "do-cat",
        "How to: feed the cat",
        ["CLAUDE.md", "tools/mow.mjs"],
        ["\\bcat\\b"],
        { group: "how-to" },
      ),
      node(
        "do-dog",
        "How to: walk the dog",
        [".claude/agents/walker.md", "tools/mow.mjs"],
        ["\\bdog\\b"],
        { group: "how-to" },
      ),
      node(
        "do-mow",
        "How to: mow the lawn",
        ["notes/gone.md", "tools/mow.mjs"],
        ["\\blawn\\b"],
        { group: "how-to" },
      ),
    ],
    links: [],
  },
);
r = run("tidy the shed please", { cwd: heldDir, session: "held" });
check(
  "a how-to thing whose first file is a project skill that exists is not shown",
  r.ctx === "",
  r.ctx,
);
r = run("the shed again, and the shed door", { cwd: heldDir, session: "held" });
check(
  "a held thing stays out on a later message of the same session",
  r.ctx === "",
  r.ctx,
);
r = run("water the plants", { cwd: heldDir });
check(
  "first file in the project's .claude/rules/: not shown",
  r.ctx === "",
  r.ctx,
);
r = run("feed the cat", { cwd: heldDir });
check("first file the project's CLAUDE.md: not shown", r.ctx === "", r.ctx);
r = run("walk the dog", { cwd: heldDir });
check(
  "first file in the project's .claude/agents/: not shown",
  r.ctx === "",
  r.ctx,
);
r = run("mow the lawn", { cwd: heldDir });
check(
  "first listed file gone, the next a script: shown from the script",
  r.ctx.includes("- How to: mow the lawn: tools/mow.mjs"),
  r.ctx,
);
const docDir = project(
  "p10",
  [".claude/skills/shed/SKILL.md", "notes/shed.md"],
  {
    nodes: [
      node(
        "do-shed",
        "How to: tidy the shed",
        ["notes/shed.md", ".claude/skills/shed/SKILL.md"],
        ["\\bshed\\b"],
        { group: "how-to" },
      ),
    ],
    links: [],
  },
);
r = run("tidy the shed please", { cwd: docDir });
check(
  "the same how-to thing with a project doc first is shown",
  r.ctx.includes("- How to: tidy the shed: notes/shed.md"),
  r.ctx,
);

const bigDir = project("p7", ["notes/small.md"], {
  nodes: [
    node(
      "do-research",
      "How to: research",
      ["DECISIONS.md", "notes/small.md"],
      ["\\bresearch"],
      { group: "how-to" },
    ),
  ],
  links: [],
});
fs.writeFileSync(path.join(bigDir, "DECISIONS.md"), "line\n".repeat(400));
r = run("research this", { cwd: bigDir });
check(
  "a file too big to read whole is marked",
  r.ctx.includes("DECISIONS.md (big: grep it), notes/small.md"),
  r.ctx,
);
const codeDir = project("p8", [], {
  nodes: [
    node(
      "do-versions",
      "How to: versions",
      ["tools/versions.mjs"],
      ["\\bversions?\\b"],
      { group: "how-to" },
    ),
  ],
  links: [],
});
fs.mkdirSync(path.join(codeDir, "tools"));
fs.writeFileSync(path.join(codeDir, "tools/versions.mjs"), "x;\n".repeat(400));
r = run("what version is it", { cwd: codeDir });
check(
  "a big script is not marked (it is run, not read)",
  r.ctx.includes("tools/versions.mjs") && !r.ctx.includes("big"),
  r.ctx,
);

const r2 = spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({
    prompt: "search the web",
    session_id: "cwdonly",
    cwd: dir,
  }),
  encoding: "utf8",
  env: {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    HOOK_ERRORS_LOG: "off",
    CLAUDE_PROJECT_DIR: "",
    MAP_PROMPT: "",
  },
});
check(
  "no CLAUDE_PROJECT_DIR: the event's cwd is the project",
  r2.stdout.includes("web research"),
  r2.stdout + r2.stderr,
);

const r3 = () =>
  spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({ prompt: "search the web", cwd: dir }),
    encoding: "utf8",
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      HOOK_ERRORS_LOG: "off",
      CLAUDE_PROJECT_DIR: dir,
      MAP_PROMPT: "",
    },
  }).stdout;
r3();
check(
  "no session id: nothing remembered, shown again",
  r3().includes("web research"),
);

check("nothing matches: silent", run("fix the typo in the readme").ctx === "");
check(
  "a /command is left alone",
  run("/release-setup the web thing").ctx === "",
);
check(
  "MAP_PROMPT=off turns it off",
  run("search the web", { env: { MAP_PROMPT: "off" } }).ctx === "",
);
check(
  "no map: silent",
  run("search the web", { cwd: project("p2", [], null) }).ctx === "",
);
check(
  "a map with no nodes: silent",
  run("search the web", { cwd: project("p3", [], { handledBy: "x" }) }).ctx ===
    "",
);
r = run("search the web", { cwd: project("p4", [], "{not json") });
check(
  "a broken map fails open: exit 0, no output",
  r.code === 0 && r.ctx === "",
  r.err,
);

// Many long matches: the note stays within 600 characters and keeps the best ones.
const long = "notes/" + "a".repeat(120) + ".md";
const many = {
  nodes: Array.from({ length: 12 }, (_, i) =>
    node(
      `do-thing-${i}`,
      `How to: thing ${i}`,
      [long, long.replace(".md", "b.md")],
      ["\\bthing\\b"],
      { group: "how-to" },
    ),
  ),
  links: [],
};
r = run("do the thing", {
  cwd: project("p5", [long, long.replace(".md", "b.md")], many),
});
check(
  "the note stays within 600 characters",
  r.ctx.length > 0 && r.ctx.length <= 600,
  `${r.ctx.length}: ${r.ctx}`,
);
check("at most 3 things", (r.ctx.match(/\n- /g) ?? []).length <= 3, r.ctx);
check(
  "a long line drops files before the thing is left out",
  /How to: thing 0: notes\/a+\.md/.test(r.ctx),
  r.ctx,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
