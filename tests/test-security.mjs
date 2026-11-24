// Test for the security skill (skills/security): one setup in three levels - always on (the security-guidance
// plugin that install and update turn on, scripts/plugins.mjs), quick (a change) and deep (a whole project, once:
// deepsec, then Cloudflare's security-audit skill as a second pass).
// Each level says what it runs, roughly what it costs and when to use it; no key is written anywhere and no hook
// of ours is added for it. Run: node tests/test-security.mjs
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL  ${name}`);
  }
};
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), "utf8");
const DIR = path.join(ROOT, "skills", "security");
const skill = fs.existsSync(path.join(DIR, "SKILL.md"))
  ? read("skills", "security", "SKILL.md")
  : "";
const deep = fs.existsSync(path.join(DIR, "deep-scan.md"))
  ? read("skills", "security", "deep-scan.md")
  : "";
const SG = "security-guidance@claude-plugins-official";

// ---- the skill: frontmatter, and a description that names the three levels and fires on a security ask
const front = skill.match(/^---\n([\s\S]*?)\n---/)?.[1] || "";
check("the skill is named security", /^name: security$/m.test(front));
const desc = front.match(/^description: (.*)$/m)?.[1] || "";
check(
  "the description names the three levels, so a security ask reaches the skill",
  /always on/i.test(desc) && /quick/i.test(desc) && /deep/i.test(desc),
);
check(
  "the description fires on a security review, scan and a release",
  /review/i.test(desc) && /scan/i.test(desc) && /release/i.test(desc),
);

// ---- the levels table: one row per level, each with what runs, a rough cost and when
const rows = skill
  .split("\n")
  .filter((l) => /^\| (Always on|Quick|Deep) \|/.test(l))
  .map((l) =>
    l
      .split("|")
      .slice(1, -1)
      .map((c) => c.trim()),
  );
check(
  "the table has exactly the three levels, in order: Always on, Quick, Deep",
  JSON.stringify(rows.map((r) => r[0])) ===
    JSON.stringify(["Always on", "Quick", "Deep"]),
);
check(
  "each level says what it runs, what it costs and when to use it (no empty cell)",
  rows.length === 3 && rows.every((r) => r.length === 4 && r.every(Boolean)),
);
const row = (name) => rows.find((r) => r[0] === name) || [];
check(
  "always on runs the security-guidance plugin",
  /security-guidance/.test(row("Always on")[1]),
);
check(
  "quick runs Claude Code's own /security-review on the change",
  /\/security-review/.test(row("Quick")[1]),
);
check(
  "deep runs deepsec over the whole project",
  /deepsec/.test(row("Deep")[1]),
);
check(
  "deep adds Cloudflare's security-audit skill as a second pass after deepsec, not in its place",
  /Cloudflare's security-audit skill as a second pass/.test(row("Deep")[1]) &&
    row("Deep")[1].indexOf("deepsec") < row("Deep")[1].indexOf("Cloudflare"),
);
check(
  "deep gives a cost in money, so the person can weigh it first",
  /\$\d/.test(row("Deep")[2]),
);

// ---- each level has its own section, and the deep one points to its steps
for (const h of ["Always on", "Quick", "Deep"])
  check(
    `the ${h} level has its own section`,
    new RegExp(`^## ${h}\\b`, "m").test(skill),
  );
check(
  "the deep section links its steps file, and the file is there",
  /\]\(deep-scan\.md\)/.test(skill) && deep.length > 0,
);
check(
  "the reply names the level it ran (a release names it in its notes)",
  /name the level/i.test(skill),
);

// ---- the always-on level is the plugin the installer and the update turn on
const plugins = read("scripts", "plugins.mjs");
check(
  "the skill names the same plugin that scripts/plugins.mjs installs",
  skill.includes(SG) && plugins.includes(`"${SG}"`),
);

// ---- no key anywhere, and the deep scan's risks are said before its steps
check(
  "the deep scan uses the person's own claude login, with no key written into a file",
  /mode: "local"/.test(deep) && /Never write\s+an API key or token/.test(deep),
);
check(
  "the deep scan says its agents run unattended, so only trusted code is scanned",
  /unattended/.test(deep) && /trusts/.test(deep),
);
check(
  "the deep scan starts small and capped (--limit) before a full run",
  /--limit \d/.test(deep),
);
check(
  "the deep scan's output stays off the remote (.git/info/exclude)",
  /\.git\/info\/exclude/.test(deep),
);
check(
  "the risks come before the steps in the deep-scan file",
  deep.indexOf("## Risks") > -1 &&
    deep.indexOf("## Risks") < deep.indexOf("## Steps"),
);
const second = deep.slice(deep.indexOf("## Second pass"));
check(
  "the second pass has its own section in the deep-scan file, before the findings are sorted",
  deep.indexOf("## Second pass") > -1 &&
    deep.indexOf("## Second pass") < deep.indexOf("## Findings"),
);
check(
  "the second pass loads Cloudflare's skill for the one run (--plugin-dir), at a pinned commit",
  /--plugin-dir/.test(second) && /checkout [0-9a-f]{7,}/.test(second),
);
check(
  "the second pass says how to make its checking scripts run on Windows",
  /Windows/.test(second) &&
    /O_NOFOLLOW/.test(second) &&
    /lstatSync/.test(second),
);
const KEY =
  /sk-ant-[A-Za-z0-9_-]{8,}|ANTHROPIC_API_KEY\s*=\s*\S|AKIA[0-9A-Z]{16}/;
check(
  "no key or token value is written in the skill's files or the settings example",
  !KEY.test(skill) &&
    !KEY.test(deep) &&
    !KEY.test(read("settings.example.json")),
);

// ---- no new hook: the skill folder holds only text, and nothing of it is wired in the settings example
check(
  "the skill folder holds only markdown (no hook or script of ours)",
  fs.existsSync(DIR) && fs.readdirSync(DIR).every((f) => f.endsWith(".md")),
);
check(
  "the settings example wires no security hook",
  !/security/i.test(
    JSON.stringify(JSON.parse(read("settings.example.json")).hooks),
  ),
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
