// Picks how much of the test suite a pull request runs, from the files it changes against its base.
// Run: node scripts/ci-lane.mjs <base ref> [--event <github event>] [--github-output <file>]
// Prints the lane and why, and with --github-output writes lane, parts, only, ffmpeg and browser for the workflow:
//   docs   every changed file is a page or picture (README*.md, LICENSE*, docs/ apart from docs/promo/): the test
//          jobs are skipped (GitHub counts a job skipped by its condition as passed) and lint, privacy, typecheck
//          and the page check still run. A docs change reaches nobody's computer: updates download a release tag.
//   small  a fix: one job per system runs the test files that cover the changed files (a changed test file, or a
//          test whose text names a changed file; by its last two path parts when its name is not unique), plus
//          the update path every release takes on a person's computer (ALWAYS).
//   full   the whole suite, split in two jobs per system: a scheduled or manual run, a release that raises the
//          middle version number (big), a change to how tests run (FULL_IF), or a changed code file no test
//          names (a gap a narrow run would miss). The nightly run on main is the net under the small lane.
import { spawnSync } from "node:child_process";
import { appendFileSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The update path: every release runs it on each person's computer.
export const ALWAYS = [
  "test-install.mjs",
  "test-update.mjs",
  "test-update-check.mjs",
];
// Tests that draw with ffmpeg, which the runners install only for them.
export const FFMPEG = ["test-watch.mjs", "test-picture-gate.mjs"];
// Tests that draw pages in Playwright's Chromium, which the runners download only for them.
export const BROWSER = ["test-render-check.mjs"];
// Files that change how every test runs.
const FULL_IF = [
  /^tests\/run-all\.mjs$/,
  /^tests\/run-all-timings\.json$/,
  /^package(-lock)?\.json$/,
  /^\.github\//,
  /^scripts\/ci-lane\.mjs$/,
];
const DOCS = [/^README(\.[\w-]+)?\.md$/, /^LICENSE/, /^docs\/(?!promo\/)/];
// A page or picture: a pull request of these only runs no tests, and the release script can publish them alone.
export const isDocs = (f) => DOCS.some((re) => re.test(f));
// Files every release or page edit touches: many tests read or mention them, so naming them proves nothing.
// They bring the docs test (and the update path, which always runs; it reads version.json).
const BOOKKEEPING = [/^CHANGELOG\.md$/, /^version\.json$/, ...DOCS];
const BOOKKEEPING_TESTS = ["test-docs-clean.mjs", "test-update-project.mjs"];
// Text a test cannot name usefully: a page, a picture, the release notes. They never force the full suite.
const NOT_CODE = [
  /\.(md|png|jpe?g|gif|svg|webp|mp4|txt)$/i,
  /^CHANGELOG\.md$/,
  /^LICENSE/,
];

const middle = (v) => String(v ?? "").split(".")[1];

// The lane of a change. changed: repo paths; tests: { name: text } of tests/test-*.mjs; all: every tracked path;
// versions: { base, head } of version.json.
export function pickLane({ event, changed, tests, all, versions }) {
  if (event !== "pull_request")
    return { lane: "full", why: `a ${event} run tests everything` };
  if (!changed.length)
    return { lane: "full", why: "no changed file found; everything" };
  if (changed.every(isDocs))
    return {
      lane: "docs",
      why: `${changed.length} page or picture file(s) only`,
    };
  const runner = changed.find((f) => FULL_IF.some((re) => re.test(f)));
  if (runner)
    return { lane: "full", why: `${runner} changes how every test runs` };
  if (
    versions.base &&
    versions.head &&
    middle(versions.base) !== middle(versions.head)
  )
    return {
      lane: "full",
      why: `a big release (${versions.base} to ${versions.head})`,
    };
  const counts = {};
  for (const p of all) {
    const n = p.split("/").pop();
    counts[n] = (counts[n] ?? 0) + 1;
  }
  const keyOf = (p) => {
    const parts = p.split("/");
    return counts[parts.at(-1)] > 1 ? parts.slice(-2).join("/") : parts.at(-1);
  };
  const picked = new Set();
  const gaps = [];
  for (const f of changed) {
    const name = f.split("/").pop();
    if (f.startsWith("tests/") && tests[name] !== undefined) {
      picked.add(name);
      continue;
    }
    if (BOOKKEEPING.some((re) => re.test(f))) {
      for (const t of BOOKKEEPING_TESTS)
        if (tests[t] !== undefined) picked.add(t);
      continue;
    }
    const key = keyOf(f);
    const hits = Object.keys(tests).filter((t) => tests[t].includes(key));
    for (const t of hits) picked.add(t);
    if (!hits.length && !NOT_CODE.some((re) => re.test(f))) gaps.push(f);
  }
  if (gaps.length)
    return {
      lane: "full",
      why: `no test names ${gaps.slice(0, 3).join(", ")}${gaps.length > 3 ? ` and ${gaps.length - 3} more` : ""}`,
    };
  for (const t of ALWAYS) if (tests[t] !== undefined) picked.add(t);
  const only = [...picked].sort();
  return {
    lane: "small",
    why: `${changed.length} changed file(s); ${only.length} test file(s) cover them`,
    only,
  };
}

function git(args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(
      `ci-lane: git ${args.join(" ")} failed: ${(r.stderr || r.error?.message || "").trim()}`,
    );
  return r.stdout;
}

const versionAt = (rev) => {
  const r = spawnSync("git", ["-C", root, "show", `${rev}:version.json`], {
    encoding: "utf8",
  });
  return r.status === 0 ? JSON.parse(r.stdout).version : null;
};

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const args = process.argv.slice(2);
  const opt = (name) => {
    const i = args.indexOf(name);
    return i < 0 ? null : args.splice(i, 2)[1];
  };
  const event = opt("--event") ?? "pull_request";
  const outFile = opt("--github-output");
  const base = args[0];
  if (event === "pull_request" && !base)
    throw new Error(
      "usage: node scripts/ci-lane.mjs <base ref> [--event <github event>] [--github-output <file>]",
    );
  const changed =
    event === "pull_request"
      ? git(["diff", "--name-only", `${base}...HEAD`])
          .split("\n")
          .filter(Boolean)
      : [];
  const tests = Object.fromEntries(
    readdirSync(join(root, "tests"))
      .filter((n) => /^test-.*\.mjs$/.test(n))
      .map((n) => [n, readFileSync(join(root, "tests", n), "utf8")]),
  );
  const all = git(["ls-files"]).split("\n").filter(Boolean);
  const versions =
    event === "pull_request"
      ? { base: versionAt(base), head: versionAt("HEAD") }
      : {};
  const r = pickLane({ event, changed, tests, all, versions });
  console.log(`lane: ${r.lane} (${r.why})`);
  if (r.only) console.log(`tests: ${r.only.join(" ")}`);
  if (outFile) {
    const needs = (list) =>
      r.lane === "full" || (r.only ?? []).some((t) => list.includes(t));
    appendFileSync(
      outFile,
      [
        `lane=${r.lane}`,
        `parts=${r.lane === "full" ? "[1,2]" : "[1]"}`,
        `only=${(r.only ?? []).join(",")}`,
        `ffmpeg=${needs(FFMPEG)}`,
        `browser=${needs(BROWSER)}`,
        "",
      ].join("\n"),
    );
  }
}
