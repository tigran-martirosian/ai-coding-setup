// Tests for the Systems map reader: skills/systems-map/map.mjs (--brief, --near, --check, --scan) and the hook
// hooks/map-brief.mjs. Run: node tests/test-map-brief.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/map-brief.mjs", import.meta.url));
const MAP = fileURLToPath(new URL("../skills/systems-map/map.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "map-brief-test-"));
let pass = 0, fail = 0;
const check = (name, ok, extra = "") => { ok ? pass++ : fail++; console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : extra ? `\n     ${extra}` : ""}`); };

// A project with files on disk and a map file. files: relative path -> content; map: object (or a string written as is), null for none.
const project = (name, files, map) => {
  const dir = path.join(tmp, name);
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), text);
  }
  fs.mkdirSync(path.join(dir, ".claude"), { recursive: true });
  if (map !== null) fs.writeFileSync(path.join(dir, ".claude", "systems-map.json"), typeof map === "string" ? map : JSON.stringify(map, null, 2));
  return dir;
};
const FILES = {
  "src/auth/login.js": "x", "src/auth/session.js": "x",
  "src/billing/invoice.js": "x", "src/billing/pricing.js": "x", "src/billing/tax.js": "x",
  "src/ui/Dashboard.tsx": "x", "docs/billing.md": "x", "README.md": "x", "package.json": "{}",
};
const MAPDATA = {
  nodes: [
    { id: "auth", name: "User login", what: "Signs a user in and keeps the session.", files: ["src/auth/login.js", "src/auth/session.js", "src/auth/removed.js"], notes: ["docs/auth-removed.md"] },
    { id: "billing", name: "Invoice billing", what: "Prices an order and issues the invoice.", files: ["src/billing/invoice.js", "src/billing/pricing.js"], notes: ["docs/billing.md"] },
    { id: "dashboard", name: "Dashboard screen", what: "Shows the account overview.", files: ["src/ui/Dashboard.tsx"] },
    { id: "settings", name: "Project settings", what: "Reads the project configuration.", files: ["package.json"] },
  ],
  links: [
    { from: "auth", to: "billing", says: "Billing reads the signed-in account from the session.", evidence: ["src/auth/session.js", "src/billing/invoice.js"] },
    { from: "billing", to: "dashboard", says: "The dashboard lists the latest invoices.", evidence: ["src/billing/invoice.js", "src/ui/Dashboard.tsx"] },
  ],
};
const dir = project("main", FILES, MAPDATA);

const hook = (cwd, input, env = {}) =>
  spawnSync("node", [HOOK], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, MAP_BRIEF: "", CLAUDE_PROJECT_DIR: cwd, ...env } });
const agent = (prompt, type = "worker", extra = {}) => ({ tool_name: "Agent", tool_input: { description: "Test: x", prompt, subagent_type: type, run_in_background: false, ...extra } });
const updated = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.updatedInput; } catch { return null; } };
const cli = (args, { cwd = dir, input = "" } = {}) => spawnSync("node", [MAP, ...args], { cwd, input, encoding: "utf8" });

// ---- the hook
let u = updated(hook(dir, agent("Fix the rounding bug in src/billing/invoice.js and add a test.")));
check("named file: the prompt keeps its text and gains the map lines", u && u.prompt.startsWith("Fix the rounding bug in src/billing/invoice.js and add a test.\n\nSYSTEMS MAP:") && u.prompt.includes("## Invoice billing [billing]"));
check("named file: the thing starts in that file first, and its links follow", u && /Start in: src\/billing\/invoice\.js, src\/billing\/pricing\.js/.test(u.prompt) && u.prompt.includes("- from User login: Billing reads the signed-in account") && u.prompt.includes("- to Dashboard screen: The dashboard lists"));
check("named file: ends with the 'More' line naming map.mjs", u && /\nMore: node ".*systems-map\/map\.mjs" --near <thing>; --near alone lists every thing\.$/.test(u.prompt));
check("named file: every other field of the tool input is copied", u && u.description === "Test: x" && u.subagent_type === "worker" && u.run_in_background === false);
const out = hook(dir, agent("x src/billing/invoice.js")).stdout;
check("the output is one PreToolUse updatedInput object", JSON.parse(out).hookSpecificOutput.hookEventName === "PreToolUse");

u = updated(hook(dir, agent("Look at how the user login works.")));
check("a thing's name as whole words matches", u && u.prompt.includes("## User login [auth]") && !u.prompt.includes("## Invoice billing"));
u = updated(hook(dir, agent("Change Dashboard.tsx", "reviewer")));
check("a bare file name matches; reviewer is a covered type", u && u.prompt.includes("## Dashboard screen [dashboard]"));
u = updated(hook(dir, agent("Check src\\billing\\pricing.js")));
check("a Windows-style path matches", u && u.prompt.includes("## Invoice billing [billing]"));
u = updated(hook(dir, agent("Review the planned change", "planner")));
check("planner is a covered type (nothing matched line)", u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched."));

u = updated(hook(dir, agent("Fix the rounding in src/billing/tax.js")));
check("folder fallback: a file no thing lists, in a thing's folder, finds that thing", u && u.prompt.includes("## Invoice billing [billing]") && !u.prompt.includes("## User login"));
u = updated(hook(dir, agent("Add a line to README.md about the install.")));
check("folder fallback ignores the project root", u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched."));
u = updated(hook(project("bare", { ...FILES, "src/billing/index.ts": "x" }, MAPDATA), agent("Export it from index.ts")));
check("folder fallback: a bare common name points at no folder", u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched."));
const parts = { nodes: ["a", "b", "c", "d"].map((k) => ({ id: k, name: `Part ${k}`, what: "Does it.", files: [`lib/${k}.js`] })), links: [] };
u = updated(hook(project("crowded", { "lib/a.js": "x", "lib/b.js": "x", "lib/c.js": "x", "lib/d.js": "x", "lib/other.js": "x" }, parts), agent("Fix the bug in lib/other.js")));
check("folder fallback: a folder with more things than a brief carries counts for nothing", u && u.prompt.includes("SYSTEMS MAP: nothing in this brief matched."));
u = updated(hook(dir, agent("Do something unrelated to anything listed.")));
check("nothing matched: one line naming the commands", u && /\n\nSYSTEMS MAP: nothing in this brief matched\. node ".*map\.mjs" --near lists every thing; --near <thing> gives its links\.$/.test(u.prompt));
const done = agent("Fix src/billing/invoice.js\n\nSYSTEMS MAP: already here.");
check("marker already there: no output", hook(dir, done).stdout === "");
for (const t of ["Explore", "general-purpose", "claude", "worker-slim"]) check(`other agent type (${t}): no output`, hook(dir, agent("Fix src/billing/invoice.js", t)).stdout === "");
check("other tool: no output", hook(dir, { tool_name: "Bash", tool_input: { command: "ls" } }).stdout === "");
check("Task (the old tool name) is covered", updated(hook(dir, { ...agent("x src/billing/invoice.js"), tool_name: "Task" })) !== null);

const none = project("none", FILES, null);
const rn = hook(none, agent("Fix src/billing/invoice.js"));
check("no map file: no output at all", rn.stdout === "" && rn.status === 0 && rn.stderr === "");
const handled = project("handled", FILES, { handledBy: ".claude/hooks/map-brief.py" });
check("a file with no nodes (handledBy): no output at all", hook(handled, agent("Fix src/billing/invoice.js")).stdout === "" && hook(handled, agent("unrelated")).stdout === "");
check("a map with an empty nodes list: no output at all", hook(project("empty", FILES, { nodes: [], links: [] }), agent("unrelated")).stdout === "");
check("MAP_BRIEF=off: no output", hook(dir, agent("Fix src/billing/invoice.js"), { MAP_BRIEF: "off" }).stdout === "");
const broken = hook(project("broken", FILES, "{ not json"), agent("Fix src/billing/invoice.js"));
check("fails open on a broken map file: no output, exit 0, one line on stderr", broken.stdout === "" && broken.status === 0 && /map-brief hook skipped/.test(broken.stderr) && broken.stderr.trim().split("\n").length === 1);
const junk = hook(dir, "not json at all");
check("fails open on bad hook input", junk.stdout === "" && junk.status === 0);
check("no project folder in the environment: no output", spawnSync("node", [HOOK], { input: JSON.stringify(agent("x")), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: "" } }).stdout === "");

// ---- deleted files are dropped
u = updated(hook(dir, agent("Fix src/auth/login.js")));
check("deleted file dropped: not in Start in, and no gone notes", u && u.prompt.includes("Start in: src/auth/login.js, src/auth/session.js") && !u.prompt.includes("removed") && !u.prompt.includes("auth-removed"));
check("a listed note that exists is kept", updated(hook(dir, agent("Fix src/billing/invoice.js"))).prompt.includes("Read: docs/billing.md"));
u = updated(hook(dir, agent("Fix src/auth/removed.js")));
check("a brief naming a deleted file: found by its folder, the deleted file is not listed", u && u.prompt.includes("## User login [auth]") && !/Start in:.*removed/.test(u.prompt.split("Fix src/auth/removed.js")[1]));

// ---- the cap: 7,000 characters, 3 full entries, one line for each further match
const big = { nodes: [], links: [] };
for (let k = 0; k < 5; k++) big.nodes.push({ id: `area${k}`, name: `Area number ${k}`, what: `Thing ${k} does its job.`, files: [`src/a${k}.js`] });
for (let k = 0; k < 5; k++) for (let j = 0; j < 40; j++) big.links.push({ from: `area${k}`, to: `area${(k + 1 + (j % 4)) % 5}`, says: `Link ${j} of area ${k}: ` + "words ".repeat(30), evidence: [`src/a${k}.js`] });
const bigDir = project("big", Object.fromEntries([0, 1, 2, 3, 4].map((k) => [`src/a${k}.js`, "x"])), big);
const five = "Work on Area number 0, Area number 1, Area number 2, Area number 3 and Area number 4.";
const rb = cli(["--brief"], { cwd: bigDir, input: five });
check("cap: at most 7,000 characters", rb.status === 0 && rb.stdout.trimEnd().length <= 7000 && rb.stdout.length > 5000, `length ${rb.stdout.length}`);
check("cap: 5 matches give 3 full entries and one line each for the other 2", (rb.stdout.match(/^## /gm) ?? []).length === 3 && /Also matched/.test(rb.stdout) && (rb.stdout.match(/^- Area number \d \[area\d\]: src\/a\d\.js$/gm) ?? []).length === 2, rb.stdout.slice(-300));
check("cap: links cut with a 'more links' line naming --near", /\(\d+ more links: node ".*map\.mjs" --near area\d\)/.test(rb.stdout));
const hb = updated(hook(bigDir, agent(five)));
check("cap: the hook adds at most 7,000 characters of map lines", hb && hb.prompt.length - five.length < 7000 + 700);

// ---- trim order: over the cap, start files are cut to 3 before any link is cut
const WORDS = 22; // link text length: full output is a little over 7,000 characters, and fits once the start files are cut to 3
const fat = { nodes: [], links: [] };
const fatFiles = (k) => [0, 1, 2, 3, 4, 5].map((j) => `src/area${k}/module-with-a-long-name-${j}.js`);
for (let k = 0; k < 3; k++) fat.nodes.push({ id: `area${k}`, name: `Area number ${k}`, what: `Thing ${k} does its job.`, files: fatFiles(k) });
for (let k = 0; k < 3; k++) for (let j = 0; j < 6; j++) fat.links.push({ from: `area${k}`, to: `area${(k + 1 + (j % 2)) % 3}`, says: `Link ${j} of area ${k}: ` + "words ".repeat(WORDS), evidence: [fatFiles(k)[0]] });
const fatDir = project("fat", Object.fromEntries(fat.nodes.flatMap((n) => n.files).map((f) => [f, "x"])), fat);
const threeNames = "Work on Area number 0, Area number 1 and Area number 2.";
const noCap = cli(["--brief"], { cwd: fatDir, input: threeNames });
const startCounts = (s) => (s.match(/^Start in: .*$/gm) ?? []).map((l) => l.slice(10).split(", ").length);
check("trim order: just over the cap, every thing keeps only 3 start files", startCounts(noCap.stdout).length === 3 && startCounts(noCap.stdout).every((c) => c === 3), `counts ${startCounts(noCap.stdout)}, length ${noCap.stdout.length}`);
check("trim order: with the files cut, no link is cut (36 link lines, no 'more links')", !/more links/.test(noCap.stdout) && (noCap.stdout.match(/^- (to|from) /gm) ?? []).length === 36, noCap.stdout.slice(-200));
check("under the cap nothing is cut: a thing with 6 files lists all 6", startCounts(cli(["--brief"], { cwd: fatDir, input: "Work on Area number 0." }).stdout)[0] === 6);

// ---- more matches than fit: one-liners cut at the cap, with the count left out
const wide = { nodes: [], links: [] };
for (let k = 0; k < 120; k++) wide.nodes.push({ id: `part${k}`, name: `Part number ${k}`, what: `Part ${k} does its job.`, files: [`lib/part${k}/a-fairly-long-file-name-${k}.js`, `lib/part${k}/another-long-file-name-${k}.js`] });
const wideDir = project("wide", Object.fromEntries(wide.nodes.flatMap((n) => n.files).map((f) => [f, "x"])), wide);
const rw = cli(["--brief"], { cwd: wideDir, input: wide.nodes.map((n) => n.name).join(", ") });
const wl = rw.stdout.trimEnd();
check("cap: 120 matches stay within 7,000 characters, cut at a whole line", rw.status === 0 && wl.length <= 7000 && wl.length > 6500, `length ${wl.length}`);
check("cap: the cut ends with the count of matches left out", (() => { const m = /\n- \((\d+) more matches left out\)$/.exec(wl); const shown = (wl.match(/^- Part number \d+ \[part\d+\]: /gm) ?? []).length; return m && Number(m[1]) + shown + 3 === 120; })(), wl.slice(-120));

// ---- ordinary words and written folders
const topics = { nodes: [
  { id: "release", name: "Release Beacon", what: "Announces a release.", files: ["src/release/beacon.js"] },
  { id: "quest", name: "Quest board", what: "Lists quests.", files: ["src/quest/board.js"] },
  ...[0, 1, 2, 3, 4, 5, 6, 7, 8].map((k) => ({ id: `wide${k}`, name: `Wide thing ${k}`, what: "Does it.", files: [`src/wide/w${k}.js`] })),
], links: [] };
const topicDir = project("topics", Object.fromEntries(topics.nodes.flatMap((n) => n.files).map((f) => [f, "x"])), topics);
const hookOn = (text) => updated(hook(topicDir, agent(text)));
check('"release" alone matches nothing', hookOn("Reviewing this change before the release and precision.").prompt.includes("SYSTEMS MAP: nothing in this brief matched."));
check('"Release Beacon" still matches', hookOn("Look at the Release Beacon.").prompt.includes("## Release Beacon [release]"));
check('"recall" is an ordinary word no more: it matches a thing whose id it is', updated(hook(project("recall", { "src/recall/beacon.js": "x" }, { nodes: [{ id: "recall", name: "Recall Beacon", what: "Brings a player home.", files: ["src/recall/beacon.js"] }], links: [] }), agent("Reviewing this change for recall and precision."))).prompt.includes("## Recall Beacon [recall]"));
u = hookOn("Review target: src/quest");
check("a named narrow folder matches the things with files in it", u.prompt.includes("## Quest board [quest]"));
u = hookOn("Review target: src/wide and src/wide/");
check("a broad folder (files of more than 8 things) adds nothing", u.prompt.includes("SYSTEMS MAP: nothing in this brief matched."));
u = hookOn("Fix the bug in src/wide/other.js");
check("a named file in a broad folder still matches nothing (crowded-folder rule)", u.prompt.includes("SYSTEMS MAP: nothing in this brief matched."));

// ---- --brief on its own
check("--brief with no match prints nothing, exit 0", (() => { const r = cli(["--brief"], { input: "nothing here" }); return r.status === 0 && r.stdout === ""; })());
check("--brief with --project from another folder", cli(["--project", dir, "--brief"], { cwd: tmp, input: "src/billing/invoice.js" }).stdout.includes("## Invoice billing"));

// ---- --near
let r = cli(["--near"]);
check("--near lists every thing", r.status === 0 && ["auth", "billing", "dashboard", "settings"].every((i) => r.stdout.includes(`- ${i}:`)));
r = cli(["--near", "billing"]);
check("--near <word>: the thing, its links with the code behind them, one step further", r.status === 0 && r.stdout.includes("## Invoice billing [billing]") && /- from User login: .* \(src\/auth\/session\.js, src\/billing\/invoice\.js\)/.test(r.stdout) && /One step further: /.test(r.stdout));
r = cli(["--near", "auth"]);
check("--near marks code that is gone", r.stdout.includes("src/auth/removed.js [GONE]"));
r = cli(["--near", "zzz-nothing"]);
check("--near with an unknown word: exit 1 and says so", r.status === 1 && /nothing on the map matches "zzz-nothing"/.test(r.stderr));
check("--near finds a thing by a file path", cli(["--near", "src/ui/Dashboard.tsx"]).stdout.includes("## Dashboard screen"));

// ---- --check
const good = project("good", FILES, {
  nodes: MAPDATA.nodes.map((n) => ({ ...n, files: n.files.filter((f) => !f.includes("removed")), notes: (n.notes ?? []).filter((f) => !f.includes("removed")) })),
  links: MAPDATA.links,
});
r = cli(["--check"], { cwd: good });
check("--check passes a clean map: exit 0", r.status === 0 && /^ok: 4 things, 2 links/m.test(r.stdout), r.stdout);
r = cli(["--check"]);
check("--check catches a missing file: exit 1, names it, gives the share", r.status === 1 && r.stdout.includes("GONE src/auth/removed.js") && r.stdout.includes("GONE docs/auth-removed.md") && /FAIL: .* 2 gone \(\d+\.\d%\)/.test(r.stdout), r.stdout);
const badLink = project("badlink", FILES, { nodes: MAPDATA.nodes.slice(1, 3), links: [{ from: "billing", to: "nowhere", says: "Goes nowhere.", evidence: ["src/billing/invoice.js"] }] });
r = cli(["--check"], { cwd: badLink });
check("--check catches a link to an unknown id: exit 1", r.status === 1 && /BAD .*to is not the id of a thing/.test(r.stdout), r.stdout);
const dup = project("dup", FILES, { nodes: [MAPDATA.nodes[1], MAPDATA.nodes[1]], links: [] });
r = cli(["--check"], { cwd: dup });
check("--check catches a duplicate id: exit 1", r.status === 1 && /duplicate id billing/.test(r.stdout), r.stdout);
r = cli(["--check"], { cwd: project("badjson", FILES, "{ nope") });
check("--check catches invalid JSON: exit 1", r.status === 1 && /not valid JSON/.test(r.stderr));
r = cli(["--check"], { cwd: project("noev", FILES, { nodes: [MAPDATA.nodes[1], MAPDATA.nodes[2]], links: [{ from: "billing", to: "dashboard", says: "x", evidence: [] }] }) });
check("--check wants evidence on every link", r.status === 1 && /evidence must be a list of paths/.test(r.stdout));
r = cli(["--check"], { cwd: none });
check("--check with no map: exit 1 and says where to learn how", r.status === 1 && /no map in/.test(r.stderr));
r = cli(["--check"], { cwd: handled });
check("--check on a handledBy file: says who keeps it, exit 0", r.status === 0 && /kept by \.claude\/hooks\/map-brief\.py/.test(r.stdout));

// ---- --scan
const repo = path.join(tmp, "repo");
const repoFiles = { "package.json": JSON.stringify({ name: "demo", main: "src/index.js", scripts: { build: "tsc", test: "node --test" } }), "src/index.js": "a\nb\nc", "src/api/routes/users.js": "x", "src/api/routes/orders.js": "x", "src/lib/util.ts": "x", "node_modules/dep/index.js": "x", "dist/out.js": "x", "docs/readme.md": "x", "Makefile": "all:" };
for (const [rel, text] of Object.entries(repoFiles)) { fs.mkdirSync(path.dirname(path.join(repo, rel)), { recursive: true }); fs.writeFileSync(path.join(repo, rel), text); }
spawnSync("git", ["init", "-q"], { cwd: repo });
spawnSync("git", ["add", "-A"], { cwd: repo });
r = cli(["--scan"], { cwd: repo });
check("--scan: counts tracked code files only, vendored and build folders skipped", r.status === 0 && /: 4 tracked code files \(of 9 tracked files/.test(r.stdout), r.stdout.slice(0, 300));
check("--scan: folders, biggest files, package scripts, main file, routes folder, Makefile", ["## Code files by folder", "src/ ", "## Biggest code files", "build=\"tsc\"", "Main-looking files: src/index.js", "src/api/ 2 files", "Makefile"].every((s) => r.stdout.includes(s)), r.stdout);
check("--scan: at most about 8 KB", r.stdout.length <= 8100);
const many = path.join(tmp, "many");
for (let d = 0; d < 60; d++) for (let f = 0; f < 12; f++) { const p = path.join(many, `pkg${d}`, `sub${f % 6}`, `routes`, `file${f}.js`); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, "x\n".repeat(f + d)); }
spawnSync("git", ["init", "-q"], { cwd: many });
spawnSync("git", ["add", "-A"], { cwd: many });
r = cli(["--scan"], { cwd: many });
check("--scan on a wide repo (720 files) still fits in about 8 KB", r.status === 0 && r.stdout.length <= 8100 && r.stdout.includes("720 tracked code files"), `length ${r.stdout.length}`);
r = cli(["--scan"], { cwd: none });
check("--scan outside a git repository: exit 1 and says so", r.status === 1 && /needs a git repository/.test(r.stderr));

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
