#!/usr/bin/env node
// Tests for ~/.claude/workers/versions.mjs - the version / "is X available" lookup.
// The pure matching logic runs offline; the live lookups are skipped with --offline.
// Run: node test-versions.mjs [--offline]
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

const TOOL = fileURLToPath(new URL("../workers/versions.mjs", import.meta.url));
const { hasVersion, isPreRelease, byVersionDesc } = await import(pathToFileURL(TOOL).href);
const OFFLINE = process.argv.includes("--offline");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; return; }
  fail++;
  console.log(`FAIL  ${name}${extra ? `\n      ${extra}` : ""}`);
};

// ---------------- hasVersion: what counts as "that version is there" ----------------

const PG = ["18.6", "18", "17.11", "17", "16.15", "16", "15.19", "15"];

ok("exact major match", hasVersion(PG, "18").yes);
ok("exact minor match", hasVersion(PG, "18.6").yes);
ok("a leading v is ignored", hasVersion(PG, "v18.6").yes);
ok("a missing major is NO", hasVersion(PG, "19").yes === false);
ok("a missing minor is NO", hasVersion(PG, "18.9").yes === false);
ok("the series counts when only minors are listed",
  hasVersion(["4.4.0", "4.3.0", "4.2.2"], "4.4").yes, JSON.stringify(hasVersion(["4.4.0"], "4.4")));
ok("the series answer says which ones matched", /4\.4\.0/.test(hasVersion(["4.4.0", "4.3.0"], "4.4").match));
ok("18 does not match 18x nonsense", hasVersion(["180.1", "1.8"], "18").yes === false);

// A pre-release must never be reported as a plain YES: npm, PyPI, GitHub and NuGet all list them
ok("isPreRelease spots the usual shapes",
  ["3.0.0-rc1", "3.0.0-beta.2", "v4.0.0a1", "2.0.0-alpha", "1.0.0-SNAPSHOT", "5.0.0.dev1"]
    .every(isPreRelease), JSON.stringify(["3.0.0-rc1", "v4.0.0a1", "5.0.0.dev1"].map(isPreRelease)));
ok("isPreRelease leaves stable versions alone",
  ["18.6", "v4.4.0", "1.0.0", "15.9.0"].every((v) => !isPreRelease(v)));
{
  const only = hasVersion(["3.0.0-rc1", "3.0.0-beta.2", "2.9.1"], "3");
  ok("a series that is only pre-releases says PRE-RELEASE", only.yes && /PRE-RELEASE/.test(only.how), JSON.stringify(only));
  ok("and it is flagged for the caller", only.preRelease === true);
}
{
  const exact = hasVersion(["4.0.0a1", "3.5.0"], "4.0.0a1");
  ok("an exact pre-release match says so too", exact.yes && /PRE-RELEASE/.test(exact.how), JSON.stringify(exact));
}
{
  const mixed = hasVersion(["4.4.0", "4.4.0-rc1", "4.3.0"], "4");
  ok("a series with a stable release does not shout pre-release", mixed.yes && !/PRE-RELEASE/.test(mixed.how), JSON.stringify(mixed));
  ok("and it quotes the stable ones only", !/rc1/.test(mixed.match), mixed.match);
}
// The evidence must be the current versions, not the oldest alphas
ok("byVersionDesc puts the newest first",
  ["4.0.0a1", "4.13.0", "4.2.2", "4.4.0"].sort(byVersionDesc)[0] === "4.13.0",
  JSON.stringify(["4.0.0a1", "4.13.0", "4.2.2", "4.4.0"].sort(byVersionDesc)));
ok("byVersionDesc ranks a stable above its own rc",
  ["4.4.0-rc1", "4.4.0"].sort(byVersionDesc)[0] === "4.4.0");
ok("byVersionDesc treats 4.4.1 as newer than 4.4",
  ["4.4", "4.4.1"].sort(byVersionDesc)[0] === "4.4.1");
{
  const ev = hasVersion(["10.0.0-alpha.1", "10.0.0-rc.1", "10.13.0", "10.1.0", "9.9.0"], "10");
  ok("the YES evidence starts with the newest stable", ev.match.startsWith("10.13.0"), ev.match);
}
ok("empty and null entries are skipped", hasVersion([null, undefined, "", "18.6"], "18.6").yes);
ok("nothing listed is NO", hasVersion([], "18").yes === false);

// ---------------- the command: usage and exit codes ----------------

const run = (args) => {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: "utf8", timeout: 60000 });
  return { out: `${r.stdout || ""}${r.stderr || ""}`, status: r.status };
};

{
  const r = run([]);
  ok("no target: exit 2 with usage", r.status === 2 && /give at least one target/.test(r.out), r.out.slice(0, 120));
}
{
  const r = run(["postgresql", "--has"]);
  ok("--has with no number: exit 2", r.status === 2 && /needs a version number/.test(r.out), r.out.slice(0, 120));
}
{
  const r = run(["postgresql", "npm:x", "--has", "18"]);
  ok("--has with two targets: exit 2", r.status === 2 && /one target at a time/.test(r.out), r.out.slice(0, 120));
}
{
  const r = run(["--list"]);
  ok("--list names the target forms", r.status === 0 && /gh.*npm.*pypi/s.test(r.out), r.out.slice(0, 160));
}
{
  const r = run(["gh:notaroundhere"]);
  ok("gh: without owner/repo says so", /needs owner\/repo/.test(r.out), r.out.slice(0, 160));
}

if (OFFLINE) {
  console.log("(live lookups skipped: --offline)");
} else {
  {
    const r = run(["postgresql", "--has", "18"]);
    ok("postgresql --has 18: YES and exit 0", r.status === 0 && /Is 18 available\? YES/.test(r.out), r.out.slice(-240));
    ok("the answer prints the source URL", /source: https:\/\/endoflife\.date\/postgresql/.test(r.out));
    ok("the answer prints the date checked", /checked \d{4}-\d{2}-\d{2}/.test(r.out));
    ok("end-of-life branches are hidden by default", /older branches are end-of-life/.test(r.out), r.out.slice(0, 400));
    ok("supported branches are shown", /supported/.test(r.out));
  }
  {
    const r = run(["postgresql", "--has", "19"]);
    ok("postgresql --has 19: NO and exit 5", r.status === 5 && /Is 19 available\? NO/.test(r.out), `status ${r.status}`);
    ok("a NO refuses to be read as 'does not exist'",
      /does NOT mean it does not exist/.test(r.out), r.out.slice(-300));
    ok("a NO says where to look next", /download page/.test(r.out));
  }
  {
    const r = run(["postgresql", "--all"]);
    ok("--all lists the dead branches too", /END OF LIFE/.test(r.out) && !/older branches are end-of-life/.test(r.out));
  }
  {
    const r = run(["gh:sqlfluff/sqlfluff"]);
    ok("gh: lists releases newest first with dates",
      r.status === 0 && /GitHub releases/.test(r.out) && /\d{4}-\d{2}-\d{2}/.test(r.out), r.out.slice(0, 200));
    ok("a pre-release is marked", /pre-release/.test(r.out));
  }
  {
    const r = run(["npm:sql-formatter"]);
    ok("npm: puts latest first", /latest\s+\d+\.\d+\.\d+/.test(r.out), r.out.slice(0, 200));
  }
  {
    const r = run(["pypi:sqlfluff"]);
    ok("pypi: gives the latest and the Python it needs",
      r.status === 0 && /latest\s+\d/.test(r.out) && /requires/.test(r.out), r.out.slice(0, 200));
  }
  {
    const r = run(["nosuchthing-xyz-zzz"]);
    ok("an unknown bare name: exit 4, every source named", r.status === 4 && /eol:.*npm:.*pypi:/s.test(r.out), r.out.slice(0, 300));
    ok("it says how to name the source instead", /gh:owner\/repo/.test(r.out));
  }
  {
    // two targets at once, and the exit code is the worst of them
    const r = run(["npm:sql-formatter", "nosuchthing-xyz-zzz"]);
    ok("several targets: the bad one sets exit 4", r.status === 4, `status ${r.status}`);
    ok("several targets: the good one still answered", /sql-formatter \(npm\)/.test(r.out));
  }
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exitCode = fail ? 1 : 0;
