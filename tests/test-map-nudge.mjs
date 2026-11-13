// Tests for hooks/map-nudge.mjs. Run: node tests/test-map-nudge.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { makeChecker, UNDER_MS } from "./lib/kit.mjs";

const HOOK = fileURLToPath(new URL("../hooks/map-nudge.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "map-nudge-test-"));
const DAY = 24 * 60 * 60 * 1000;
const { check, summary } = makeChecker();

const write = (dir, rel, text = "x\n") => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), text);
};
// A folder with n code files, plus files that must not count (docs, data, vendored and build folders). git: make it a repository.
const project = (name, n, { git = true, map = null } = {}) => {
  const dir = path.join(tmp, name);
  fs.mkdirSync(dir, { recursive: true });
  for (let i = 0; i < n; i++) write(dir, `src/mod${i % 10}/file${i}.js`);
  for (let i = 0; i < 30; i++) write(dir, `docs/page${i}.md`);
  write(dir, "data.json", "{}");
  for (let i = 0; i < 50; i++) write(dir, `node_modules/dep/f${i}.js`);
  for (let i = 0; i < 20; i++) write(dir, `dist/b${i}.js`);
  if (map !== null) write(dir, ".claude/systems-map.json", typeof map === "string" ? map : JSON.stringify(map));
  if (git) {
    spawnSync("git", ["init", "-q"], { cwd: dir });
    spawnSync("git", ["add", "-A", "-f"], { cwd: dir });
  }
  return { dir, state: path.join(tmp, `${name}-state`), stateFile: path.join(tmp, `${name}-state`, ".claude", "hooks", "state", "map-nudge", "projects.json") };
};
const run = (p, prompt = "fix the login bug", env = {}) => {
  const t = Date.now();
  const r = spawnSync("node", [HOOK], { input: env.RAW ?? JSON.stringify({ prompt }), encoding: "utf8", env: { ...process.env, MAP_NUDGE: "", CLAUDE_PROJECT_DIR: p.dir, HOME: p.state, USERPROFILE: p.state, ...env } });
  return { ...r, ms: Date.now() - t };
};
const context = (r) => { try { return JSON.parse(r.stdout).hookSpecificOutput.additionalContext; } catch { return ""; } };
const state = (p) => { try { return JSON.parse(fs.readFileSync(p.stateFile, "utf8"))[p.dir.replace(/\\/g, "/")] ?? {}; } catch { return {}; } };
const setState = (p, rec) => { fs.mkdirSync(path.dirname(p.stateFile), { recursive: true }); fs.writeFileSync(p.stateFile, JSON.stringify({ [p.dir.replace(/\\/g, "/")]: rec })); };

// ---- no map: the count decides
const small = project("small", 99);
check("99 code files (vendored, docs and data do not count): silent", run(small).stdout === "");
const at100 = project("at100", 100);
let r = run(at100);
const text = context(r);
check("100 code files: nudges", /\[map-nudge\] This project has 100 tracked code files and no Systems map/.test(text), r.stdout + r.stderr);
check("the nudge says: a background worker, now, without asking", /Without asking, start one background worker now: Agent tool, subagent_type "worker", run_in_background true/.test(text));
check("the nudge names the skill file to read and the project folder", /Read [^"]*skills\/systems-map\/SKILL\.md and follow it\. Project folder: .*at100\./.test(text));
check("the nudge has the session mention it in one line", /tell the user in one line/.test(text));
check("the output is a UserPromptSubmit context", JSON.parse(r.stdout).hookSpecificOutput.hookEventName === "UserPromptSubmit");
check("second prompt: silent", run(at100).stdout === "");
setState(at100, { ...state(at100), checkedAt: Date.now() - 3 * DAY });
check("days later, still no map: silent (a week between tries)", run(at100).stdout === "");
check("the state file records the try", state(at100).tries === 1 && state(at100).nudgedAt > 0);
const weekOn = () => setState(at100, { ...state(at100), checkedAt: Date.now() - 8 * DAY, nudgedAt: Date.now() - 8 * DAY });
weekOn();
check("a week later, still no map: a second try (a build can be killed or refused)", /100 tracked code files/.test(context(run(at100))));
weekOn();
check("the third try", /100 tracked code files/.test(context(run(at100))) && state(at100).tries === 3);
weekOn();
check("after 3 tries: silent for good", run(at100).stdout === "");

// ---- the count is looked at once a day
const grows = project("grows", 99);
check("99 files: silent, and the look is recorded", run(grows).stdout === "" && state(grows).checkedAt > 0);
write(grows.dir, "src/extra.js");
spawnSync("git", ["add", "-A"], { cwd: grows.dir });
check("one file more the same day: silent (looked at today already)", run(grows).stdout === "");
setState(grows, { checkedAt: Date.now() - 2 * DAY });
check("a day later at 100: nudges", /100 tracked code files/.test(context(run(grows))));

// ---- not a git repo, other silences
const plain = project("plain", 150, { git: false });
check("not a git repository (150 code files): silent", run(plain).stdout === "" && run(plain).stderr === "");
const linked = project("linked", 120, { git: false });
fs.writeFileSync(path.join(linked.dir, ".git"), "gitdir: C:/elsewhere/.git/worktrees/x\n");
check("a linked worktree (.git is a file): silent, nothing recorded", run(linked).stdout === "" && !fs.existsSync(linked.stateFile));
const off = project("off", 120);
check("MAP_NUDGE=off: silent, nothing recorded", run(off, "x", { MAP_NUDGE: "off" }).stdout === "" && !fs.existsSync(off.stateFile));
check("a /command: silent, nothing recorded", run(off, "/compact").stdout === "" && !fs.existsSync(off.stateFile));
check("bad hook input: silent", run(off, "x", { RAW: "not json" }).stdout === "");
check("no project folder in the environment: silent", spawnSync("node", [HOOK], { input: JSON.stringify({ prompt: "x" }), encoding: "utf8", env: { ...process.env, CLAUDE_PROJECT_DIR: "", HOME: off.state, USERPROFILE: off.state } }).stdout === "");
check("after all that, the same project still nudges once", /120 tracked code files/.test(context(run(off))));

// ---- a map is there
const listed = (n, gone) => ({
  nodes: [{ id: "a", name: "Alpha part", what: "Does alpha.", files: Array.from({ length: n }, (_, i) => (i < gone ? `src/missing${i}.js` : `src/mod${i % 10}/file${i}.js`)) }],
  links: [],
});
const fresh = project("fresh", 150, { map: listed(10, 1) });
check("map present, 10 % of its files gone: silent", run(fresh).stdout === "");
const handled = project("handled", 150, { map: { handledBy: ".claude/hooks/map-brief.py" } });
check("map file with no nodes (handledBy): silent, nothing recorded", run(handled).stdout === "" && !fs.existsSync(handled.stateFile));
const noGit = project("nogit-map", 150, { git: false, map: listed(10, 0) });
check("map present, nothing gone, not a git repo: silent", run(noGit).stdout === "");

const stale = project("stale", 150, { map: listed(10, 5) });
r = run(stale);
check("stale map (5 of 10 listed files gone): nudges to refresh", /\[map-nudge\] The Systems map of this project .* 5 of the 10 files it lists \(50 %\) are gone or changed under a link/.test(context(r)) && /start one background worker now to refresh it: Agent tool, subagent_type "worker"/.test(context(r)), r.stdout + r.stderr);
check("stale map: the refresh prompt names the skill file", /Refresh this project's Systems map\. Read [^"]*SKILL\.md/.test(context(r)));
check("stale map: second prompt silent", run(stale).stdout === "");
setState(stale, { checkedAt: Date.now() - 2 * DAY, staleNudgedAt: Date.now() - 3 * DAY });
check("stale map: still silent 3 days after the nudge", run(stale).stdout === "");
setState(stale, { checkedAt: Date.now() - 2 * DAY, staleNudgedAt: Date.now() - 8 * DAY });
check("stale map: nudges again after a week", /5 of the 10 files/.test(context(run(stale))));
setState(stale, { checkedAt: Date.now() - 2 * DAY, staleNudgedAt: Date.now() - 8 * DAY });
check("stale map, MAP_NUDGE=off: silent", run(stale, "x", { MAP_NUDGE: "off" }).stdout === "");
const edge = project("edge", 150, { map: listed(10, 2) });
check("exactly 20 % gone: silent (more than 20 % is the line)", run(edge).stdout === "");

// ---- drift counts with the gone files: (gone + drifted) / total
const tokened = (gone, lost) => ({
  nodes: [{ id: "a", name: "Alpha part", what: "Does alpha.", files: ["src/mod0/file0.js"] }, { id: "b", name: "Beta part", what: "Does beta.", files: ["src/mod1/file1.js"] }],
  links: [{ from: "a", to: "b", says: "Alpha asks beta.", evidence: [
    ...Array.from({ length: gone }, (_, i) => `src/missing${i}.js`),
    ...Array.from({ length: lost }, (_, i) => ({ file: `src/mod${i + 2}/file${i + 2}.js`, token: "NOT_THERE" })),
    ...Array.from({ length: 10 - gone - lost }, (_, i) => ({ file: `src/mod${(i + 5) % 10}/file${i + 5}.js`, token: "x" })),
  ] }],
});
const drifting = project("drifting", 150, { map: tokened(1, 3) });
r = run(drifting);
check("1 gone + 3 changed of 12 listed files: nudges, counting both", /4 of the 12 files it lists \(33 %\) are gone or changed under a link/.test(context(r)), r.stdout + r.stderr);
const slight = project("slight", 150, { map: tokened(1, 1) });
check("1 gone + 1 changed (2 of 12, under 20 %): silent", run(slight).stdout === "");

// ---- speed on a big repository: 3,000 code files. The best of five runs, since other sessions share this computer.
const bigp = project("big", 3000);
const best = (n, f) => Math.min(...Array.from({ length: n }, f));
const counting = best(5, () => { fs.rmSync(bigp.state, { recursive: true, force: true }); return run(bigp).ms; });
check(`3,000 code files, no map, the count runs: under ${UNDER_MS / 1000} s (best of five ${counting} ms)`, counting < UNDER_MS);
const fast = best(5, () => run(bigp).ms);
check(`a project nudged before skips the count: under ${UNDER_MS / 1000} s (best of five ${fast} ms)`, fast < UNDER_MS);

// ---- every run above kept its own state: the real map-nudge state has none of this run's folders
const live = path.join(os.homedir(), ".claude", "hooks", "state", "map-nudge", "projects.json");
const liveKeys = fs.existsSync(live) ? Object.keys(JSON.parse(fs.readFileSync(live, "utf8"))) : [];
check("the test leaves the real map-nudge state alone", !liveKeys.some((k) => k.includes(path.basename(tmp))), liveKeys.filter((k) => k.includes(path.basename(tmp))).join(", "));

fs.rmSync(tmp, { recursive: true, force: true });
summary();
