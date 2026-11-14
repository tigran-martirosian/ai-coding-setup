// Tests for skills/update-project/pass.mjs: --check on a made-up folder raises each check id (P1 to P12, and P13 to
// P15 for a local git folder), the git and GitHub checks (P13 to P23) on folders of each kind with a fake gh (an
// organisation's repo, an owner in another case, a 401 and a 404 among them), a folder inside a bigger repo, and the
// stamp modes (--done with --kept, --skip, --skip-all, --list) write ~/.claude/project-pass.json as the design says,
// and version.json's projectPass equals pass.mjs's LEVEL.
// Everything happens in a temporary home folder (--home), so the real ~/.claude is never read or written.
// Run: node tests/test-update-project.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { LEVEL } from "../skills/update-project/pass.mjs";

const PASS = fileURLToPath(
  new URL("../skills/update-project/pass.mjs", import.meta.url),
);
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "update-project-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${detail.trim().split("\n").join("\n     ")}`}`,
  );
};
const fwd = (p) => p.replace(/\\/g, "/");
const home = path.join(tmp, "home"),
  claude = path.join(home, ".claude");
const runEnv = (env, ...args) => {
  const r = spawnSync(process.execPath, [PASS, ...args, "--home", home], {
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const run = (...args) => {
  const r = spawnSync(process.execPath, [PASS, ...args, "--home", home], {
    encoding: "utf8",
  });
  return { code: r.status, out: (r.stdout || "") + (r.stderr || "") };
};
const write = (file, text) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, text);
};
const stamp = () =>
  JSON.parse(fs.readFileSync(path.join(claude, "project-pass.json"), "utf8"));

// A made-up folder with one fault for each check. file-upkeep's checker is the real one, found beside pass.mjs.
const dir = path.join(tmp, "work"),
  key = fwd(dir);
write(path.join(dir, "CLAUDE.md"), "# Work\n\nA made-up project.\n"); // P2: no base lines
write(
  path.join(dir, "HANDOFF.md"),
  Array.from({ length: 130 }, (_, i) => `line ${i}`).join("\n") +
    "\nSee `docs/gone/old-plan.md`.\n",
); // P3, P8
write(
  path.join(dir, "DECISIONS.md"),
  "# Decisions\n\n- Use tabs. Replaced by the spaces rule.\n",
); // P4
write(path.join(dir, ".claude", "settings.json"), "{ not json"); // P5
write(path.join(dir, "docs", "HOW-TO.md"), "# How to\n"); // P6: an upper-case name
write(
  path.join(dir, "docs", "facts.md"),
  "# Facts\n\n- A fact with no date.\n",
); // P11
// no .claude/rules/: P1
spawnSync("git", ["init", "-q", dir]); // P7: all untracked
write(
  path.join(
    claude,
    "projects",
    key.replace(/[^A-Za-z0-9]/g, "-"),
    "memory",
    "note.md",
  ),
  "a memory note\n",
); // P8.memory
// P9 reads the recheck-dates hook (row C4); a stand-in prints one past and one ok line in its --list form
write(
  path.join(claude, "hooks", "recheck-dates.mjs"),
  'console.log("docs/facts.md:3  2026-01-01  past  - A fact.\\nCLAUDE.md:2  2099-01-01  ok  - Another.\\n1 past their recheck date, 1 within it");\n',
);

const first = run("--check", dir);
const lines = first.out.trim().split(/\r?\n/);
const ids = lines.slice(0, -1).map((l) => l.split(/\s+/)[0]);
const top = [...new Set(ids.map((i) => i.split(".")[0]))].sort(
  (a, b) => Number(a.slice(1)) - Number(b.slice(1)),
);
check(
  "--check exits 0 and ends with the summary line",
  first.code === 0 &&
    new RegExp(
      `^project-pass .+ · \\d+ to fix · \\d+ to ask · \\d+ notes · level ${LEVEL}$`,
    ).test(lines.at(-1)),
  first.out,
);
// a local git folder without the preset also raises P13 (no Git: line), P14 (no commit line), P15 (no .gitattributes)
check(
  "--check raises every check id, P1 to P15",
  top.join() === Array.from({ length: 15 }, (_, i) => `P${i + 1}`).join(),
  top.join(),
);
check(
  "P1 once: the missing .claude/rules/ folder only",
  ids.filter((i) => i === "P1").length === 1 &&
    lines.some((l) => /^P1\s+fix\s+\.claude\/rules\//.test(l)),
);
check(
  "P2 lists each missing base line as its own id",
  ["P2.handoff", "P2.designs", "P2.standard", "P2.checks", "P2.tools"].every(
    (i) => ids.includes(i),
  ),
  ids.join(),
);
check(
  "P3, P4, P5, P10, P11 once each",
  ["P3", "P4", "P5", "P10", "P11"].every(
    (i) => ids.filter((x) => x === i).length === 1,
  ),
  ids.join(),
);
check(
  "P6 passes the checker's rename on",
  lines.some((l) => /^P6\s+fix\s+docs\/HOW-TO\.md/.test(l)),
  first.out,
);
check(
  "P7 groups the untracked entries by top folder",
  ids.includes("P7.docs") && ids.includes("P7.CLAUDE.md"),
  ids.join(),
);
check(
  "P8 names the missing path with its line, and the memory notes",
  lines.some(
    (l) =>
      l.startsWith("P8.docs/gone/old-plan.md") && l.includes("HANDOFF.md:131"),
  ) && ids.includes("P8.memory"),
  first.out,
);
check(
  "P9 lists the past fact only",
  ids.filter((i) => i.startsWith("P9")).join() === "P9.docs/facts.md:3",
  ids.join(),
);
check(
  "P12 asks for a map when the folder has none",
  lines.some((l) =>
    /^P12\s+ask\s+\.claude\/systems-map\.json\s+no Systems map/.test(l),
  ),
  first.out,
);
// P12 on a folder with a map: none of its things lists a ~/ file -> ask; one does -> nothing
const mapped = path.join(tmp, "mapped");
const node = (files) => ({ id: "a", name: "A", what: "A.", files });
write(
  path.join(mapped, ".claude", "systems-map.json"),
  JSON.stringify({ nodes: [node(["src/a.js"])], links: [] }),
);
const noHow = run("--check", mapped).out;
check(
  "P12 asks for how-to things when no thing lists a ~/ file",
  /^P12\s+ask\s+\S+\s+the map has no "how we do X" things/m.test(noHow),
  noHow,
);
write(
  path.join(mapped, ".claude", "systems-map.json"),
  JSON.stringify({
    nodes: [
      node(["src/a.js"]),
      { ...node(["~/.claude/skills/web-research/SKILL.md"]), id: "b" },
    ],
    links: [],
  }),
);
const withHow = run("--check", mapped).out;
check(
  "P12 is quiet when the map has a how-to thing",
  !/^P12/m.test(withHow),
  withHow,
);

// The git and GitHub checks. A fake gh (PASS_GH) answers as FAKE_GH says: "off" (nothing set, a public repo),
// "on" (everything set), "upgrade" (a private repo on GitHub Free: rulesets answer 403), "revoked" (401) or "gone" (404).
// The signed-in accounts are FAKE_ACCOUNTS (default "someone"); the organisation repo acme/thing is read only with
// member's token. Owner names compare case-insensitively, as on GitHub.
const fakeGh = path.join(tmp, "fake-gh.mjs");
write(
  fakeGh,
  `const mode = process.env.FAKE_GH, on = mode === "on", accounts = (process.env.FAKE_ACCOUNTS || "someone").split(",");
const a = process.argv.slice(2).join(" ").replace(/^api repos\\/someone\\//i, "api repos/someone/");
const out = (x) => { process.stdout.write(typeof x === "string" ? x : JSON.stringify(x)); process.exit(0); };
const fail = (msg, body = "") => { process.stdout.write(body); process.stderr.write("gh: " + msg + "\\n"); process.exit(1); };
if (a === "auth status") out("github.com\\n" + accounts.map((n) => "  ✓ Logged in to github.com account " + n + " (keyring)\\n").join(""));
const u = a.match(/^auth token -u (\\S+)$/);
if (u) accounts.includes(u[1]) ? out("token-" + u[1] + "\\n") : fail("no oauth token found for github.com account " + u[1]);
const org = a.startsWith("api repos/acme/thing");
if (org && process.env.GH_TOKEN !== "token-member") fail("Not Found (HTTP 404)");
const R = org ? "api repos/acme/thing" : "api repos/someone/thing";
if (a === R && mode === "revoked") fail("Bad credentials (HTTP 401)");
if (a === R && mode === "gone") fail("Not Found (HTTP 404)");
if (a === R) out({ permissions: { admin: process.env.FAKE_ADMIN !== "no" }, private: mode === "upgrade", default_branch: on ? "main" : "master", allow_squash_merge: true,
  allow_merge_commit: !on, allow_rebase_merge: !on, squash_merge_commit_title: on ? "PR_TITLE" : "COMMIT_OR_PR_TITLE",
  delete_branch_on_merge: on, security_and_analysis: { secret_scanning: { status: on ? "enabled" : "disabled" },
  secret_scanning_push_protection: { status: on ? "enabled" : "disabled" } } });
if (a === R + "/rulesets") mode === "upgrade"
  ? fail("Upgrade to GitHub Pro or make this repository public to enable this feature. (HTTP 403)", '{"message":"Upgrade to GitHub Pro"}')
  : out(on ? [{ id: 1, name: "main" }] : []);
if (a === R + "/rules/branches/main") out(["pull_request", "non_fast_forward", "deletion", "required_status_checks"].map((type) => ({ type })));
if (a === R + "/actions/runs?status=success&per_page=1") out({ total_count: 1 });
if (a === R + "/vulnerability-alerts") on ? out("") : fail("Not Found (HTTP 404)");
if (a === R + "/automated-security-fixes") out({ enabled: on, paused: false });
if (a === R + "/private-vulnerability-reporting") out({ enabled: on });
if (a === R + "/code-scanning/default-setup") out({ state: on ? "configured" : "not-configured" });
fail("fake gh has no answer for: " + a);
`,
);
const NEW = Array.from({ length: 11 }, (_, i) => `P${i + 13}`);
const gitIds = (out) =>
  out
    .trim()
    .split(/\r?\n/)
    .slice(0, -1)
    .map((l) => l.split(/\s+/))
    .filter(([id]) => /^P(1[3-9]|2\d)\b/.test(id));
const preset = (n) =>
  fs.readFileSync(
    fileURLToPath(
      new URL(`../skills/new-project/preset/${n}`, import.meta.url),
    ),
    "utf8",
  );
const hub = path.join(tmp, "hub");
spawnSync("git", ["init", "-q", hub]);
spawnSync("git", [
  "-C",
  hub,
  "remote",
  "add",
  "origin",
  "https://github.com/someone/thing.git",
]);
write(path.join(hub, "CLAUDE.md"), "# Hub\n\nA made-up project.\n"); // no Git: line, no commit line
write(path.join(hub, "CHANGELOG.md"), "# Changelog\n\n## Version 1\n"); // P23: an old-form heading
write(
  path.join(hub, "package.json"),
  '{ "scripts": { "test": "node test.mjs" } }\n',
); // P18: a Node stack, so CI is offered
const hubOff = runEnv({ PASS_GH: fakeGh, FAKE_GH: "off" }, "--check", hub);
const offIds = gitIds(hubOff.out);
check(
  "a GitHub folder with no preset and GitHub settings off prints every id P13 to P23, each as ask",
  hubOff.code === 0 &&
    NEW.every((i) => offIds.some(([id]) => id === i)) &&
    offIds.every(([, kind]) => kind === "ask") &&
    !/^P24/m.test(hubOff.out),
  hubOff.out,
);
write(
  path.join(hub, "CLAUDE.md"),
  "# Hub\n\nGit: GitHub (public); main holds merged work only; each change goes on a branch <type>/<topic> and reaches main as one squash-merged pull request whose title follows the commit rule.\n" +
    'Commits: subject "<type>: <what the person gains>", at most 72 characters; type is one of feat, fix, docs, test, ci, refactor, perf, build, chore; no plan-step or session ids.\n',
);
write(path.join(hub, ".gitattributes"), preset("gitattributes.txt"));
write(
  path.join(hub, ".github", "pull_request_template.md"),
  preset("pull_request_template.md"),
);
write(path.join(hub, ".github", "workflows", "ci.yml"), preset("ci-node.yml"));
write(path.join(hub, ".github", "dependabot.yml"), preset("dependabot.yml"));
write(path.join(hub, "CHANGELOG.md"), preset("CHANGELOG.md"));
spawnSync("git", [
  "-C",
  hub,
  "symbolic-ref",
  "refs/remotes/origin/HEAD",
  "refs/remotes/origin/main",
]);
const hubOn = runEnv({ PASS_GH: fakeGh, FAKE_GH: "on" }, "--check", hub);
check(
  "the same folder with the preset in place and the settings on prints none of P13 to P23",
  hubOn.code === 0 && gitIds(hubOn.out).length === 0,
  hubOn.out,
);
const free = runEnv({ PASS_GH: fakeGh, FAKE_GH: "upgrade" }, "--check", hub);
check(
  "a private repo on GitHub Free: the 403 on rulesets prints P21 as a note",
  free.code === 0 &&
    /^P21\s+note\s+\S+\s+a protected main is not possible on this plan/m.test(
      free.out,
    ) &&
    /^P13\s+ask\s+CLAUDE\.md\s+the Git: line says public, GitHub says private/m.test(
      free.out,
    ),
  free.out,
);
const noGh = runEnv({ PASS_GH: path.join(tmp, "no-such-gh") }, "--check", hub);
check(
  "without gh, P20 to P22 print as notes and nothing else of theirs",
  noGh.code === 0 &&
    ["P20", "P21", "P22"].every((i) =>
      new RegExp(
        `^${i}\\s+note\\s+github\\.com/someone/thing\\s+not checked: gh not found`,
        "m",
      ).test(noGh.out),
    ) &&
    gitIds(noGh.out).every(([, kind]) => kind === "note"),
  noGh.out,
);
const setOrigin = (url) =>
  spawnSync("git", ["-C", hub, "remote", "set-url", "origin", url]);
setOrigin("https://github.com/acme/thing.git");
const org = runEnv(
  { PASS_GH: fakeGh, FAKE_GH: "on", FAKE_ACCOUNTS: "outsider,member" },
  "--check",
  hub,
);
check(
  "an organisation's repo is read with the token of a signed-in account that can read it",
  org.code === 0 &&
    gitIds(org.out).length === 0 &&
    !/not checked|^GitHub/m.test(org.out),
  org.out,
);
const orgNone = runEnv(
  { PASS_GH: fakeGh, FAKE_GH: "on", FAKE_ACCOUNTS: "outsider" },
  "--check",
  hub,
);
check(
  "an organisation's repo no signed-in account can read: P20 to P22 notes name the accounts tried",
  orgNone.code === 0 &&
    ["P20", "P21", "P22"].every((i) =>
      new RegExp(
        `^${i}\\s+note\\s+github\\.com/acme/thing\\s+not checked: no signed-in gh account can read acme/thing \\(tried outsider\\): one of them needs access to acme/thing`,
        "m",
      ).test(orgNone.out),
    ),
  orgNone.out,
);
const orgReader = runEnv(
  {
    PASS_GH: fakeGh,
    FAKE_GH: "on",
    FAKE_ACCOUNTS: "outsider,member",
    FAKE_ADMIN: "no",
  },
  "--check",
  hub,
);
check(
  "a repo the signed-in accounts can read but not administer: P20 to P22 are notes, nothing offered",
  orgReader.code === 0 &&
    ["P20", "P21", "P22"].every((i) =>
      new RegExp(
        `^${i}\\s+note\\s+github\\.com/acme/thing\\s+not checked: no signed-in gh account is an admin of acme/thing`,
        "m",
      ).test(orgReader.out),
    ) &&
    !/^P2[0-2]\s+ask/m.test(orgReader.out),
  orgReader.out,
);
setOrigin("https://github.com/SomeOne/thing.git");
const cased = runEnv({ PASS_GH: fakeGh, FAKE_GH: "on" }, "--check", hub);
check(
  "an owner written in another case than the signed-in account still uses that account",
  cased.code === 0 &&
    gitIds(cased.out).length === 0 &&
    !/not checked/.test(cased.out),
  cased.out,
);
setOrigin("https://github.com/someone/thing.git");
for (const [mode, code] of [
  ["revoked", 401],
  ["gone", 404],
]) {
  const r = runEnv({ PASS_GH: fakeGh, FAKE_GH: mode }, "--check", hub);
  check(
    `a GitHub ${code} keeps the local findings and prints one line naming the error and the checks not run`,
    r.code === 0 &&
      /^P1\s+fix\s+HANDOFF\.md/m.test(r.out) &&
      new RegExp(
        `^GitHub\\s+note\\s+github\\.com/someone/thing\\s+GitHub answered gh api repos/someone/thing: .*HTTP ${code}.*; did not run: P13 \\(the visibility\\), P20, P21, P22$`,
        "m",
      ).test(r.out) &&
      !/^P2[0-2]/m.test(r.out) &&
      /^project-pass .* level /m.test(r.out),
    r.out,
  );
}
// a project folder inside a bigger repo (a package with its own CLAUDE.md) is a git folder of that repo
const mono = path.join(tmp, "mono"),
  pkg = path.join(mono, "packages", "app");
spawnSync("git", ["init", "-q", mono]);
write(path.join(mono, ".gitattributes"), preset("gitattributes.txt"));
write(path.join(pkg, "CLAUDE.md"), "# App\n\nA made-up package.\n");
const monoOut = run("--check", pkg).out;
check(
  "a folder inside a bigger repo is a git folder: no git init offered, the repo's .gitattributes counts",
  /^P13\s+ask\s+CLAUDE\.md\s+no Git: line \(the folder is git on this computer only\)/m.test(
    monoOut,
  ) &&
    !/not a git folder|git init -b main/.test(monoOut) &&
    /^P14\s/m.test(monoOut) &&
    !/^P15\s/m.test(monoOut) &&
    /^P7\s+ask\s+\.\/\s+the whole folder is untracked/m.test(monoOut),
  monoOut,
);
const noGit = path.join(tmp, "nogit");
write(path.join(noGit, "CLAUDE.md"), "# No git\n\nA made-up project.\n");
const noGitOut = run("--check", noGit).out;
check(
  "a folder without git prints only P13 of the git checks",
  gitIds(noGitOut)
    .map(([id]) => id)
    .join() === "P13" &&
    /^P13\s+ask\s+CLAUDE\.md\s+no Git: line \(the folder is not a git folder\)/m.test(
      noGitOut,
    ),
  noGitOut,
);
write(path.join(noGit, "CLAUDE.md"), "# No git\n\nGit: none.\n");
check(
  "a folder without git and a Git: none line prints no git check",
  gitIds(run("--check", noGit).out).length === 0,
);
check(
  "--check writes nothing",
  !fs.existsSync(path.join(claude, "project-pass.json")),
);

// --list: the folder of the newest transcript in a projects folder, behind until stamped
write(
  path.join(claude, "projects", "some-slug", "s1.jsonl"),
  JSON.stringify({ type: "user", cwd: dir }) + "\n",
);
const listed = run("--list");
check(
  "--list names the folder from a transcript's cwd as behind",
  listed.code === 0 &&
    listed.out.includes(`${key}  behind  last used `) &&
    /· 1 behind ·/.test(listed.out),
  listed.out,
);

// --done with --kept: stamped at the level, the kept ids left out of the next check (P2 keeps every P2 sub-id)
const done = run("--done", dir, "--kept", "P4,P2");
const s = stamp();
check(
  "--done stamps the folder at the level with its kept ids",
  done.code === 0 &&
    s.level === LEVEL &&
    s.folders[key]?.done === LEVEL &&
    s.folders[key].kept.join() === "P4,P2" &&
    s.mode === "on-open",
  JSON.stringify(s),
);
const again = run("--check", dir).out;
check(
  "kept ids are left out of the next check",
  !/^P4\s/m.test(again) && !/^P2\./m.test(again) && /^P3\s/m.test(again),
  again,
);
run("--done", dir, "--kept", "P3");
check(
  "a later --done adds to the kept ids",
  stamp().folders[key].kept.join() === "P4,P2,P3",
);
check(
  "--list shows the folder as done",
  run("--list").out.includes(`${key}  done  `),
);

// --skip and --skip-all
const other = path.join(tmp, "other");
fs.mkdirSync(other);
check(
  "--skip writes the folder as declined at the level",
  run("--skip", other).code === 0 && stamp().declined[fwd(other)] === LEVEL,
);
check(
  "--skip-all writes declinedAll at the level",
  run("--skip-all").code === 0 && stamp().declinedAll === LEVEL,
);
check(
  "--done on a declined folder clears its decline",
  run("--done", other).code === 0 && !(fwd(other) in stamp().declined),
);
check(
  "--done with no folder stops with its reason",
  /--done needs a folder/.test(run("--done").out) && run("--done").code === 1,
);
write(path.join(claude, "project-pass.json"), "{ broken");
check(
  "a stamp file that is not JSON stops with its name",
  run("--status").code === 1 &&
    /project-pass\.json is not valid JSON/.test(run("--status").out),
);

// The two levels move together: raised in one only, pass.mjs writes its own level back and every folder shows behind
const released = JSON.parse(
  fs.readFileSync(new URL("../version.json", import.meta.url), "utf8"),
).projectPass;
check(
  "version.json projectPass equals pass.mjs LEVEL",
  released === LEVEL,
  `version.json projectPass ${released}, pass.mjs LEVEL ${LEVEL}: raise both`,
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
