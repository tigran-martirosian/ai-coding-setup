// Tests for "~/" paths in a Systems map (skills/systems-map/map.mjs): a project's "how we do X" things point at the setup's
// skills in the user's home, so a map has no user name in it. map.mjs runs as a child process with a temp home folder.
// Run: node tests/test-map-home-paths.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const MAP_JS = fileURLToPath(
  new URL("../skills/systems-map/map.mjs", import.meta.url),
);
const dir = mkdtempSync(join(tmpdir(), "map-home-"));
const home = join(dir, "home");
const proj = join(dir, "proj");
let fail = 0,
  total = 0;
const report = (ok, name, extra = "") => {
  total++;
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : `\n${extra}`}`);
};
const put = (root, rel, text) => {
  const f = join(root, rel);
  mkdirSync(join(f, ".."), { recursive: true });
  writeFileSync(f, text);
};
const run = (args, input = "") => {
  try {
    return {
      code: 0,
      out: execFileSync(
        process.execPath,
        [MAP_JS, "--project", proj, ...args],
        {
          input,
          encoding: "utf8",
          env: { ...process.env, HOME: home, USERPROFILE: home },
          stdio: ["pipe", "pipe", "pipe"],
        },
      ),
    };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) + String(e.stderr) };
  }
};

put(
  home,
  ".claude/skills/web-research/SKILL.md",
  "Use versions.mjs for a version. social.mjs reads Reddit.",
);
put(home, ".claude/skills/handoff/SKILL.md", "Write the brief.");
put(proj, "src/app.js", "export const x = 1;");
put(proj, "DECISIONS.md", "- research ends with a source\n");
const map = {
  nodes: [
    {
      id: "do-research",
      name: "How we research",
      what: "Research starts in DECISIONS.md and the project's notes, then goes to the web.",
      files: ["DECISIONS.md"],
      words: ["\\bresearch"],
    },
    {
      id: "do-web-research",
      name: "How we search the web",
      what: "Web search and reading pages.",
      files: ["~/.claude/skills/web-research/SKILL.md"],
      words: ["\\bweb search", "\\breddit\\b"],
    },
    {
      id: "app",
      name: "The app",
      what: "The app itself.",
      files: ["src/app.js"],
    },
  ],
  links: [
    {
      from: "do-research",
      to: "do-web-research",
      says: "Research that the files cannot answer goes to the web.",
      evidence: [
        { file: "~/.claude/skills/web-research/SKILL.md", token: "social.mjs" },
      ],
    },
    {
      from: "do-web-research",
      to: "app",
      says: "x",
      evidence: ["src/app.js"],
    },
  ],
};
put(proj, ".claude/systems-map.json", JSON.stringify(map));

let r = run(["--check"]);
report(r.code === 0, "--check: a ~/ path that exists is not GONE", r.out);

const homeShown = join(home, ".claude/skills/web-research/SKILL.md").replace(
  /\\/g,
  "/",
);
r = run(
  ["--brief"],
  "We need to do deep research on this from DECISIONS.md, then a web search, Reddit too",
);
report(
  r.code === 0 && /^## How we research \[do-research\]/m.test(r.out),
  "--brief: a research brief puts the research thing in",
  r.out,
);
report(
  r.out.includes(homeShown),
  "--brief: a ~/ file is shown as a full path a Read can open",
  r.out,
);
report(
  !r.out.includes("~/.claude"),
  "--brief: no ~/ path is left for the helper to expand",
  r.out,
);
report(
  /- to How we search the web: Research/.test(r.out),
  "--brief: the research thing shows its link to web search",
  r.out,
);

r = run(["--near", "do-web-research"]);
report(
  r.code === 0 && r.out.includes(homeShown),
  "--near: shows the ~/ file in full",
  r.out,
);

// the setup file loses the token: DRIFT
put(
  home,
  ".claude/skills/web-research/SKILL.md",
  "Use versions.mjs for a version.",
);
r = run(["--check"]);
report(
  r.code === 1 &&
    /DRIFT ~\/\.claude\/skills\/web-research\/SKILL\.md/.test(r.out),
  "--check: a ~/ evidence file that lost its token is DRIFT",
  r.out,
);

// the setup file is gone: GONE
rmSync(join(home, ".claude/skills/web-research"), {
  recursive: true,
  force: true,
});
r = run(["--check"]);
report(
  r.code === 1 && /~\/\.claude\/skills\/web-research\/SKILL\.md/.test(r.out),
  "--check: a ~/ path that is gone is listed",
  r.out,
);

// ---- "already held" (promptFind's held), read against the temp home
const held = join(dir, "held");
const HELD_PATHS = {
  skill: "~/.claude/skills/s/SKILL.md",
  worker: "~/.claude/workers/x.mjs",
  copy: "copy/skills/s/SKILL.md",
  plug: "~/.claude/plugins/x/skills/p/SKILL.md",
  rule: "~/.claude/rules/r.md",
  claude: "~/.claude/CLAUDE.md",
  memory: `~/.claude/projects/${held.replace(/[^a-zA-Z0-9]/g, "-")}/memory/MEMORY.md`,
};
for (const p of Object.values(HELD_PATHS))
  p.startsWith("~/") ? put(home, p.slice(2), "x") : put(held, p, "x");
const heldMap = join(dir, "held-map.json");
writeFileSync(
  heldMap,
  JSON.stringify({
    nodes: Object.entries(HELD_PATHS).map(([k, f]) => ({
      id: `do-${k}`,
      name: `How to: ${k}`,
      what: "x",
      files: [f],
      words: [`\\b${k}\\b`],
    })),
    links: [],
  }),
);
const FIND = `import fs from "node:fs";
const { promptFind } = await import(process.argv[1]);
console.log(JSON.stringify(promptFind(process.argv[2], JSON.parse(fs.readFileSync(process.argv[3], "utf8")), process.argv[4])));`;
const found = JSON.parse(
  execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      FIND,
      new URL("../skills/systems-map/map.mjs", import.meta.url).href,
      Object.keys(HELD_PATHS).join(" "),
      heldMap,
      held,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, HOME: home, USERPROFILE: home },
    },
  ),
);
const heldOf = Object.fromEntries(found.map((h) => [h.id.slice(3), h.held]));
report(
  heldOf.skill === true,
  "held: a ~/.claude/skills/s/SKILL.md present in the home",
  JSON.stringify(found),
);
report(
  heldOf.worker === false,
  "not held: a ~/.claude/workers/x.mjs",
  JSON.stringify(found),
);
report(
  heldOf.copy === true,
  "held: <folder>/skills/s/SKILL.md while the home has skills/s",
  JSON.stringify(found),
);
report(
  heldOf.plug === true,
  "held: a plugin skill's SKILL.md",
  JSON.stringify(found),
);
report(
  heldOf.rule === true && heldOf.claude === true,
  "held: ~/.claude/rules/r.md and ~/.claude/CLAUDE.md",
  JSON.stringify(found),
);
report(
  heldOf.memory === true,
  "held: the project's MEMORY.md",
  JSON.stringify(found),
);

// ---- --check flags a words entry that is one bare common word
const wordMap = (words) =>
  put(
    proj,
    ".claude/systems-map.json",
    JSON.stringify({
      nodes: [
        { id: "app", name: "The app", what: "x", files: ["src/app.js"], words },
      ],
      links: [],
    }),
  );
wordMap(["\\breleases?\\b"]);
r = run(["--check"]);
report(
  r.code === 1 &&
    (r.out.match(/^WORD /gm) ?? []).length === 1 &&
    /^WORD app: "\\\\breleases\?\\\\b" is one common word/m.test(r.out) &&
    /^FAIL: .*, 1 common words/m.test(r.out),
  "--check: a words entry \\breleases?\\b gives one WORD line, FAIL, exit 1",
  r.out,
);
wordMap(["release to the public repo"]);
r = run(["--check"]);
report(
  r.code === 0 && /^ok: .*, 0 common words$/m.test(r.out),
  "--check: words entry 'release to the public repo' is ok, exit 0",
  r.out,
);

rmSync(dir, { recursive: true, force: true });
console.log(`\n${total - fail}/${total} passed`);
process.exit(fail ? 1 : 0);
