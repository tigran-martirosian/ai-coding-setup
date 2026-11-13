// Tests the Pro plan fallback of install.mjs: on a Pro plan (<home>/.claude.json, oauthAccount.organizationType
// "claude_pro") every Fable model choice in the agents, skills and rules is written as Opus; on any other plan,
// or with no record, the files are as shipped. Each case installs into its own temporary home folder.
// Run: node tests/test-pro-fallback.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// No network and no real Claude Code update from any installer this test starts (scripts/claude-code-version.mjs)
process.env.SETUP_CC_CHECK = "off";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = path.join(REPO, "install.mjs");
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "pro-fallback-test-"));
// The installer looks for Codex on the PATH; the tests give it a PATH with nothing on it
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const install = (home) => {
  const r = spawnSync(process.execPath, [INSTALL, "--home", home], {
    encoding: "utf8",
    env: { ...process.env, PATH: emptyPath, Path: emptyPath },
  });
  return { code: r.status, out: r.stdout + r.stderr };
};
const fwd = (p) => p.replace(/\\/g, "/");
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)],
    );
// A home folder with Claude Code's record of the plan (null: no record; raw: the file's whole text)
const homeWith = (name, plan, raw = null) => {
  const home = path.join(tmp, name);
  fs.mkdirSync(home);
  if (plan !== null || raw !== null)
    fs.writeFileSync(
      path.join(home, ".claude.json"),
      raw ??
        JSON.stringify({
          oauthAccount: {
            organizationType: plan,
            planDisplayName: plan === "claude_pro" ? "Pro" : "Max",
          },
        }),
    );
  return home;
};
const setPlan = (home, plan) =>
  fs.writeFileSync(
    path.join(home, ".claude.json"),
    JSON.stringify({ oauthAccount: { organizationType: plan } }),
  );
// The files the check covers, by path inside ~/.claude, with the home folder's own path taken out
const covered = (home) => {
  const claude = path.join(home, ".claude");
  const files = [
    ...["agents", "skills"].flatMap((d) => walk(path.join(claude, d))),
    path.join(claude, "CLAUDE.md"),
    path.join(claude, "settings.json"),
  ];
  return Object.fromEntries(
    files.map((f) => [
      fwd(path.relative(claude, f)),
      fs
        .readFileSync(f, "utf8")
        .split(home)
        .join("<home>")
        .split(fwd(home))
        .join("<home>")
        .split(home.replace(/\\/g, "\\\\"))
        .join("<home>"),
    ]),
  );
};
const differ = (a, b) =>
  [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(
    (k) => a[k] !== b[k],
  );
const FABLE_AGENTS = [
  "blind-reviewer",
  "plan-reviewer",
  "planner",
  "reviewer",
  "stuck-advisor",
  "worker-refactor",
].map((n) => `agents/${n}.md`);
const modelLine = (files, rel) => files[rel].match(/^model: (\w+)$/m)?.[1];
// What tells Claude to use Fable: a model line or argument, or a "Fable at <effort>" (a benchmark's "Fable at medium's" score is a fact, not a choice)
const fableChoice = (text) =>
  /model: fable|model: "fable"|model `fable`|Fable at (?!medium's 54)/i.test(
    text,
  );

// ---- no record of the plan: the files as shipped
const plain = homeWith("no-record", null);
ok("install with no plan record exits cleanly", install(plain).code, 0);
const shipped = covered(plain);
ok(
  "with no plan record the agents keep Fable",
  FABLE_AGENTS.map((a) => modelLine(shipped, a)),
  FABLE_AGENTS.map(() => "fable"),
);

// ---- Max: byte for byte what an install with no record writes
const max = homeWith("max", "claude_max");
const maxRun = install(max);
ok("install on Max exits cleanly", maxRun.code, 0);
ok(
  "on Max every agent, skill, rules and settings file is as with no plan record",
  differ(covered(max), shipped),
  [],
);
ok(
  "on Max the installer says nothing about the plan",
  /^plan:/m.test(maxRun.out),
  false,
);

// ---- Pro: every Fable choice is Opus
const pro = homeWith("pro", "claude_pro");
const proRun = install(pro);
ok("install on Pro exits cleanly", proRun.code, 0);
ok(
  "on Pro the installer says the helpers get Opus",
  /^plan: Pro, which has no Fable/m.test(proRun.out),
);
const proFiles = covered(pro);
// scripts are left out: their Fable names read logs and prices, they choose no model
ok(
  "on Pro no agent, skill, rules or settings text tells Claude to use Fable",
  Object.keys(proFiles).filter(
    (k) => /\.(md|txt|json)$/.test(k) && fableChoice(proFiles[k]),
  ),
  [],
);
ok(
  "on Pro the agents that ran Fable run Opus",
  FABLE_AGENTS.map((a) => modelLine(proFiles, a)),
  FABLE_AGENTS.map(() => "opus"),
);
ok(
  "on Pro the rules name Opus for the planner and reviewers",
  proFiles["CLAUDE.md"].includes(
    "The planner and both reviewers run Opus at high",
  ),
);
ok(
  "on Pro only files that named Fable differ from the shipped ones",
  differ(proFiles, shipped).filter((k) => !fableChoice(shipped[k])),
  [],
);

// ---- Pro again: everything as the first run wrote it
const proAgain = install(pro);
ok("a second install on Pro exits cleanly", proAgain.code, 0);
ok(
  "a second install on Pro keeps nothing as the user's",
  proAgain.out.split("\n").filter((l) => l.includes("kept yours")),
  [],
);
ok(
  "a second install on Pro finds the Opus agents unchanged",
  FABLE_AGENTS.map((a) =>
    proAgain.out.includes(`unchanged ${fwd(path.join(pro, ".claude", a))}`),
  ),
  FABLE_AGENTS.map(() => true),
);
ok(
  "a second install on Pro finds the rules up to date",
  proAgain.out.includes("rules: up to date"),
);

// ---- Pro, then Max: Fable is back and nothing is kept as the user's
setPlan(pro, "claude_max");
const switched = install(pro);
ok("an install after a switch to Max exits cleanly", switched.code, 0);
ok(
  "after a switch to Max nothing is kept as the user's",
  switched.out.split("\n").filter((l) => l.includes("kept yours")),
  [],
);
ok(
  "after a switch to Max the files are as shipped again",
  differ(covered(pro), shipped),
  [],
);
ok(
  "after a switch to Max no rule was moved to my-rules.md",
  fs.existsSync(path.join(pro, ".claude", "rules", "my-rules.md")),
  false,
);

// ---- a plan record that is not JSON: the install goes on, on Fable, and says why
const broken = homeWith("broken", null, "{ not json");
const brokenRun = install(broken);
ok("install with an unreadable plan record exits cleanly", brokenRun.code, 0);
ok(
  "an unreadable plan record is named",
  /^plan: .*\.claude\.json could not be read .*so the helpers stay on Fable$/m.test(
    brokenRun.out,
  ),
);
ok(
  "with an unreadable plan record the files are as shipped",
  differ(covered(broken), shipped),
  [],
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `${fails} failed` : "all passed");
process.exit(fails ? 1 : 0);
