// workers/ship-check.mjs (spec docs/2026-11-20-safe-deploys-spec.md D3-D8, D10), on real git repos and a local web server
// in a temp folder:
//   D3: `push --history` finds a key added and deleted later, naming the commit; CI's gitleaks and audit steps.
//   D4: `init` (ignore lines, config), `push` on a tracked .dev.vars, readConfig.
//   D5: `build <folder>`: the file list, files that must not be uploaded, a key in a built file, public-prefixed
//       secret names in the project's env files.
//   D6: `live <url>`: hidden paths, an app's fallback page, the security headers.
//   D7: `deploy -- <command>` (build check, command, live probe, in that order) and deployMatch.
//   D8: `push --full`: npm audit (findings, time limit) and GitHub secret scanning / push protection.
//   D10: new-project's skill says to run `ship-check init`.
// gitleaks, npm and gh are fakes written to the temp folder and named by SHIP_CHECK_GITLEAKS, SHIP_CHECK_NPM and
// SHIP_CHECK_GH. When gitleaks is on PATH, three cases also run the real one; otherwise one "skipped" line.
// The fake keys are put together at run time, so this file holds no key shape and the repo's own scans stay clean.
// Exit codes (plan, "Names fixed"): 0 pass, 1 findings, 2 cannot check.
// Run: node tests/test-ship-check.mjs
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { makeChecker, tmpHome } from "./lib/kit.mjs";

const REPO = fileURLToPath(new URL("..", import.meta.url));
const SHIP = path.join(REPO, "workers", "ship-check.mjs");
const fwd = (p) => p.replace(/\\/g, "/");
const { check, summary } = makeChecker();
const tmp = tmpHome("ship-check-test-");
const home = tmpHome("ship-check-home-");
process.on("exit", () => {
  for (const t of [tmp, home])
    try {
      t.remove();
    } catch (e) {
      console.log(`could not remove the temp folder ${t.dir}: ${e.message}`);
    }
});

// A generic key gitleaks' default rules find (rule generic-api-key): `api_key = "<40 hex>"`. Its entropy is kept
// well above gitleaks' 3.5 so the real gitleaks finds it on every run.
const entropy = (s) => {
  const n = {};
  for (const ch of s) n[ch] = (n[ch] || 0) + 1;
  return -Object.values(n).reduce(
    (a, k) => a + (k / s.length) * Math.log2(k / s.length),
    0,
  );
};
let HEX;
do HEX = randomBytes(20).toString("hex");
while (entropy(HEX) < 3.75);
const KEYWORD = "api" + "_key";
const KEY_LINE = `${KEYWORD} = "${HEX}"`;

// ---- the fakes (each run with Node by ship-check)
const fakes = path.join(tmp.dir, "fakes");
fs.mkdirSync(fakes);
const FAKE_GITLEAKS = path.join(fakes, "gitleaks.mjs");
const FAKE_NPM = path.join(fakes, "npm.mjs");
const FAKE_GH = path.join(fakes, "gh.mjs");
fs.writeFileSync(
  FAKE_GITLEAKS,
  `// Fake gitleaks 8 for tests/test-ship-check.mjs: its command line, one rule (generic-api-key: ${"api"}_key = "<40 hex>").
// git [path] (added lines of git log -p, --log-opts or --all), dir [path], detect [--no-git] --source <path>, stdin,
// version. Writes gitleaks' JSON report to --report-path (- is stdout; none: no report), exits --exit-code (default 1)
// on a finding. FAKE_GITLEAKS=hang waits 60 s; FAKE_GITLEAKS=broken fails. FAKE_GITLEAKS_LOG gets one line per call.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
const args = process.argv.slice(2);
const mode = process.env.FAKE_GITLEAKS || "";
if (process.env.FAKE_GITLEAKS_LOG) fs.appendFileSync(process.env.FAKE_GITLEAKS_LOG, JSON.stringify({ args, cwd: process.cwd() }) + "\\n");
const RULE = /${"api"}_key\\s*=\\s*["']([0-9a-f]{40})["']/;
const BOOL = new Set(["no-banner", "no-git", "redact", "verbose", "v", "pre-commit", "staged", "no-color", "follow-symlinks", "ignore-gitleaks-allow", "exit-on-error"]);
const SHORT = { r: "report-path", f: "report-format", s: "source", c: "config", l: "log-level", v: "verbose" };
const flags = {}, pos = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (/^--[\\w-]+=/.test(a)) { const at = a.indexOf("="); flags[a.slice(2, at)] = a.slice(at + 1); }
  else if (/^--?[\\w-]+$/.test(a)) {
    const k = a.startsWith("--") ? a.slice(2) : SHORT[a.slice(1)] || a.slice(1);
    if (BOOL.has(k)) flags[k] = true;
    else flags[k] = args[++i];
  } else pos.push(a);
}
const found = [];
const scanText = (text, file, commit = "", firstLine = 1) => {
  text.split(/\\r?\\n/).forEach((line, i) => {
    const m = line.match(RULE);
    if (m) found.push({ file, commit, line: firstLine + i, match: m[0], secret: m[1], col: m.index + 1 });
  });
};
const walk = (root) => {
  const out = [];
  const go = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) e.isDirectory() ? go(path.join(d, e.name)) : out.push(path.join(d, e.name)); };
  fs.statSync(root).isDirectory() ? go(root) : out.push(root);
  return out;
};
const scanDir = (root) => { for (const f of walk(root)) scanText(fs.readFileSync(f, "utf8"), f); };
const scanGit = (dir) => {
  const opts = (flags["log-opts"] || "").split(" ").filter(Boolean);
  const r = spawnSync("git", ["-C", dir, "log", "-p", "-U0", "--no-color", "--format=FAKECOMMIT %H", ...(opts.length ? opts : ["--all"])], { encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) { console.error("fake gitleaks: git log failed: " + r.stderr); process.exit(3); }
  let commit = "", file = "", line = 0;
  for (const l of r.stdout.split(/\\r?\\n/)) {
    if (l.startsWith("FAKECOMMIT ")) commit = l.slice(11);
    else if (l.startsWith("+++ ")) file = l === "+++ /dev/null" ? "" : l.slice(6);
    else if (l.startsWith("@@")) line = Number(l.match(/\\+(\\d+)/)[1]);
    else if (l.startsWith("+")) scanText(l.slice(1), file, commit, line++);
  }
};
function main() {
  if (mode === "broken") { console.error("gitleaks: fake failure"); process.exit(3); }
  const sub = pos[0];
  if (sub === "version") { console.log("8.30.1"); return 0; }
  if (flags["report-format"] && flags["report-format"] !== "json") { console.error("fake gitleaks: json reports only"); process.exit(3); }
  const target = pos[1] || flags.source || ".";
  if (sub === "git") scanGit(target);
  else if (sub === "dir") scanDir(target);
  else if (sub === "detect") flags["no-git"] ? scanDir(target) : scanGit(target);
  else if (sub === "stdin") scanText(fs.readFileSync(0, "utf8"), "");
  else { console.error("fake gitleaks: unknown command " + sub); process.exit(3); }
  const report = found.map((f) => {
    const secret = flags.redact ? "REDACTED" : f.secret;
    return { RuleID: "generic-api-key", Description: "Detected a Generic API Key", StartLine: f.line, EndLine: f.line,
      StartColumn: f.col, EndColumn: f.col + f.match.length - 1, Match: f.match.replace(f.secret, secret), Secret: secret,
      File: f.file, SymlinkFile: "", Commit: f.commit, Entropy: 3.8, Author: f.commit ? "t" : "", Email: f.commit ? "t@t" : "",
      Date: f.commit ? "2026-11-20T00:00:00Z" : "", Message: f.commit ? "work" : "", Tags: [],
      Fingerprint: [f.commit, f.file, "generic-api-key", f.line].filter(Boolean).join(":") };
  });
  const rp = flags["report-path"];
  if (rp === "-") process.stdout.write(JSON.stringify(report, null, 1) + "\\n");
  else if (rp) fs.writeFileSync(rp, JSON.stringify(report, null, 1));
  console.error(report.length ? "WRN leaks found: " + report.length : "INF no leaks found");
  return report.length ? Number(flags["exit-code"] ?? 1) : 0;
}
if (mode === "hang") setTimeout(() => {}, 60000);
else process.exitCode = main();
`,
);
fs.writeFileSync(
  FAKE_NPM,
  `// Fake npm for tests/test-ship-check.mjs: \`npm audit\` only. FAKE_NPM=clean | high (one high finding) | hang (60 s).
// FAKE_NPM_LOG gets the folder of each call, one per line.
import fs from "node:fs";
const args = process.argv.slice(2);
if (process.env.FAKE_NPM_LOG) fs.appendFileSync(process.env.FAKE_NPM_LOG, process.cwd() + "\\n");
if (args[0] !== "audit") { console.error("fake npm: audit only, got " + args.join(" ")); process.exit(3); }
const mode = process.env.FAKE_NPM || "clean";
if (mode === "hang") setTimeout(() => {}, 60000);
else {
  const high = mode === "high" ? 1 : 0;
  const counts = { info: 0, low: 0, moderate: 0, high, critical: 0, total: high };
  const vulnerabilities = high
    ? { "left-pad": { name: "left-pad", severity: "high", isDirect: true, via: ["GHSA-0000-0000-0000"], effects: [], range: "<1.3.1", nodes: ["node_modules/left-pad"], fixAvailable: true } }
    : {};
  if (args.includes("--json"))
    console.log(JSON.stringify({ auditReportVersion: 2, vulnerabilities, metadata: { vulnerabilities: counts, dependencies: { prod: 1, dev: 0, optional: 0, peer: 0, peerOptional: 0, total: 1 } } }, null, 2));
  else console.log(high ? "# npm audit report\\n\\nleft-pad  <1.3.1\\nSeverity: high\\n\\n1 high severity vulnerability" : "found 0 vulnerabilities");
  process.exitCode = high ? 1 : 0;
}
`,
);
fs.writeFileSync(
  FAKE_GH,
  `// Fake gh for tests/test-ship-check.mjs. \`gh api repos/<owner>/<repo>\` answers the repo's JSON (with
// security_and_analysis only to the owner: GH_TOKEN token-<login>, else the active account), \`gh repo view
// [<owner>/<repo>] --json <fields>\` those fields, \`gh auth status\` the accounts as gh 2.40+ lists them, \`gh auth
// token --user <login>\` token-<login>. No --jq.
// FAKE_GH=on (public, both enabled) | push-off (push protection disabled) | scan-off (secret scanning disabled) |
// private | hidden (no security_and_analysis in the answer) | broken (exit 1). FAKE_GH_ACCOUNTS: the logins, comma
// separated (default example-owner); FAKE_GH_ACTIVE: the active one (default the first); FAKE_GH_FAILED: logins whose
// token is invalid (auth status lists them as failed, gh api as them gives 401); FAKE_GH_AUTH=broken: auth status
// fails with no account listed; FAKE_GH_TOKEN=broken: auth token fails. An owner whose name ends in -org is an organization: the settings go only to the
// logins in FAKE_GH_ADMINS. FAKE_GH_LOG gets one line per call: its arguments and the login it ran as.
import fs from "node:fs";
const args = process.argv.slice(2);
const accounts = (process.env.FAKE_GH_ACCOUNTS || "example-owner").split(",");
const active = process.env.FAKE_GH_ACTIVE || accounts[0];
const as = process.env.GH_TOKEN ? process.env.GH_TOKEN.replace(/^token-/, "") : active;
const failed = (process.env.FAKE_GH_FAILED || "").split(",").filter(Boolean);
if (process.env.FAKE_GH_LOG) fs.appendFileSync(process.env.FAKE_GH_LOG, JSON.stringify({ args, as }) + "\\n");
const mode = process.env.FAKE_GH || "on";
if (mode === "broken") { console.error("HTTP 401: Bad credentials (https://api.github.com)"); process.exit(1); }
if (args.includes("--jq") || args.includes("-q")) { console.error("fake gh: no --jq"); process.exit(3); }
const full = (args.find((a) => /^(repos\\/)?[\\w.-]+\\/[\\w.-]+$/.test(a)) || "example-owner/example-repo").replace(/^repos\\//, "");
const priv = mode === "private";
const status = (off) => ({ status: off ? "disabled" : "enabled" });
const repo = {
  full_name: full, name: full.split("/")[1], owner: { login: full.split("/")[0], type: /-org$/.test(full.split("/")[0]) ? "Organization" : "User" }, private: priv,
  visibility: priv ? "private" : "public", html_url: "https://github.com/" + full,
  security_and_analysis: { secret_scanning: status(mode === "scan-off"), secret_scanning_push_protection: status(mode === "push-off"), dependabot_security_updates: status(false) },
};
const admin = repo.owner.type === "Organization"
  ? (process.env.FAKE_GH_ADMINS || "").split(",").includes(as)
  : as.toLowerCase() === repo.owner.login.toLowerCase();
if (mode === "hidden" || priv || !admin) delete repo.security_and_analysis;
if (args[0] === "auth" && args[1] === "status" && process.env.FAKE_GH_AUTH === "broken") {
  console.error("failed to read configuration: open hosts.yml: access is denied"); process.exit(1);
} else if (args[0] === "auth" && args[1] === "status") {
  console.log("github.com\\n" + accounts.map((a) => failed.includes(a)
    ? "  X Failed to log in to github.com account " + a + " (keyring)\\n  - Active account: " + (a === active) + "\\n  - The token in keyring is invalid.\\n  - To re-authenticate, run: gh auth login -h github.com"
    : "  \\u2713 Logged in to github.com account " + a + " (keyring)\\n  - Active account: " + (a === active) + "\\n  - Git operations protocol: https").join("\\n\\n"));
  if (failed.length) process.exitCode = 1;
} else if (args[0] === "auth" && args[1] === "token") {
  const user = args.includes("--user") ? args[args.indexOf("--user") + 1] : active;
  if (process.env.FAKE_GH_TOKEN === "broken") { console.error("failed to read token from keyring"); process.exit(1); }
  if (!accounts.includes(user)) { console.error("no oauth token found for github.com account " + user); process.exit(1); }
  console.log("token-" + user);
} else if (args[0] === "api" && failed.includes(as)) { console.error("HTTP 401: Bad credentials (https://api.github.com)"); process.exit(1); }
else if (args[0] === "api") console.log(JSON.stringify(repo));
else if (args[0] === "repo" && args[1] === "view") {
  const all = { nameWithOwner: full, name: repo.name, owner: { login: repo.owner.login }, isPrivate: priv, visibility: priv ? "PRIVATE" : "PUBLIC", url: repo.html_url };
  const i = args.indexOf("--json");
  const fields = i >= 0 ? args[i + 1].split(",") : Object.keys(all);
  console.log(JSON.stringify(Object.fromEntries(fields.map((f) => [f, all[f]]))));
} else { console.error("fake gh: unknown command " + args.join(" ")); process.exit(3); }
`,
);

// ---- running ship-check
const pathKey = Object.keys(process.env).find(
  (k) => k.toUpperCase() === "PATH",
);
// PATH without any folder that holds a gitleaks program (a computer without gitleaks)
const PATH_NO_GITLEAKS = process.env[pathKey]
  .split(path.delimiter)
  .filter(
    (d) =>
      !["gitleaks", "gitleaks.exe"].some((f) => fs.existsSync(path.join(d, f))),
  )
  .join(path.delimiter);
const realGitleaks =
  spawnSync("gitleaks", ["version"], { encoding: "utf8" }).status === 0;
// Every run starts with the fakes, a temp home and no SHIP_CHECK_*, FAKE_*, GH_TOKEN or GITHUB_TOKEN of the caller's. In `env`, a key
// replaces the same key in any letter case (Windows' Path), and undefined removes it.
const baseEnv = {
  ...Object.fromEntries(
    Object.entries(process.env).filter(
      ([k]) => !/^(SHIP_CHECK|FAKE_|GH_TOKEN$|GITHUB_TOKEN$)/i.test(k),
    ),
  ),
  HOME: home.dir,
  USERPROFILE: home.dir,
  HOOK_ERRORS_LOG: "off",
  SHIP_CHECK_GITLEAKS: FAKE_GITLEAKS,
  SHIP_CHECK_NPM: FAKE_NPM,
  SHIP_CHECK_GH: FAKE_GH,
};
const envWith = (env) => {
  const out = { ...baseEnv };
  for (const [k, v] of Object.entries(env)) {
    for (const old of Object.keys(out))
      if (old.toUpperCase() === k.toUpperCase()) delete out[old];
    if (v !== undefined) out[k] = v;
  }
  return out;
};
// Runs `node workers/ship-check.mjs <args>` in cwd. Not spawnSync: the local web server in this process must answer.
// Returns { status, out } (stdout and stderr together).
function ship(args, { cwd, env = {}, timeoutMs = 90000 } = {}) {
  if (!fs.existsSync(SHIP))
    return Promise.resolve({
      status: "not run",
      out: "workers/ship-check.mjs does not exist",
    });
  return new Promise((done) => {
    const p = spawn(process.execPath, [SHIP, ...args], {
      cwd,
      env: envWith(env),
    });
    let out = "",
      killed = false;
    const timer = setTimeout(() => {
      killed = true;
      p.kill();
    }, timeoutMs);
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (status) => {
      clearTimeout(timer);
      done({ status: killed ? "killed" : status, out });
    });
  });
}
const show = (r) =>
  `exit ${r.status}: ${r.out.trim().replace(/\s+/g, " ").slice(0, 500)}`;

// The in-process calls use the fake gitleaks too
for (const k of Object.keys(process.env))
  if (/^(SHIP_CHECK|FAKE_)/i.test(k)) delete process.env[k];
process.env.SHIP_CHECK_GITLEAKS = FAKE_GITLEAKS;
process.env.SHIP_CHECK_NPM = FAKE_NPM;
process.env.SHIP_CHECK_GH = FAKE_GH;
let mod, loadError;
try {
  mod = await import(pathToFileURL(SHIP).href);
} catch (e) {
  loadError = e;
}
const need = (name) => {
  if (!mod)
    throw new Error(
      `workers/ship-check.mjs did not load: ${loadError.message.split("\n")[0]}`,
    );
  if (typeof mod[name] !== "function")
    throw new Error(`workers/ship-check.mjs exports no ${name}()`);
  return mod[name];
};
// One case: fn returns [ok, extra]. A throw (ship-check missing, an export missing) is this case's FAIL line only.
async function test(name, fn) {
  try {
    const [ok, extra = ""] = await fn();
    check(name, Boolean(ok), extra);
  } catch (e) {
    check(name, false, e.message.split("\n")[0]);
  }
}

// ---- fixture repos
const git = (cwd, ...a) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${a.join(" ")} failed in ${cwd}: ${r.stderr}`);
  return r.stdout.trim();
};
const put = (dir, files) => {
  for (const [f, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), text);
  }
};
const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, "utf8") : null);
let n = 0;
// A git repo. commits: [{ files: { name: text }, remove: [names], message }], one commit each. remote "bare": a bare
// remote that gets every commit, then `unpushed` commits stay local; "github": a GitHub address, never pushed; "none".
function repo(
  commits = [{ files: { "README.md": "hello\n" } }],
  { remote = "bare", unpushed = [] } = {},
) {
  const dir = path.join(tmp.dir, `r${++n}`);
  fs.mkdirSync(dir);
  git(dir, "init", "-q", "-b", "main");
  for (const [k, v] of [
    ["user.email", "t@t"],
    ["user.name", "t"],
    ["commit.gpgsign", "false"],
    ["core.autocrlf", "false"],
  ])
    git(dir, "config", k, v);
  const commit = (c) => {
    put(dir, c.files ?? {});
    for (const f of c.remove ?? []) git(dir, "rm", "-q", f);
    git(dir, "add", "-A");
    git(dir, "commit", "-qm", c.message ?? "work");
  };
  commits.forEach(commit);
  if (remote === "bare") {
    const bare = path.join(tmp.dir, `r${n}.git`);
    git(tmp.dir, "init", "-q", "--bare", bare);
    git(dir, "remote", "add", "origin", bare);
    git(dir, "push", "-q", "-u", "origin", "main");
  }
  if (remote === "github")
    git(
      dir,
      "remote",
      "add",
      "origin",
      "https://github.com/example-owner/example-repo.git",
    );
  unpushed.forEach(commit);
  return dir;
}
// The ignore lines init adds (D4), and a project that ran init
const NEEDED = [
  ".env.*",
  "!.env.example",
  ".dev.vars",
  "*.pem",
  "*.key",
  "**/settings.local.json",
];
const SWITCHED_ON = {
  ".gitignore": `${NEEDED.join("\n")}\nnode_modules/\n`,
  ".claude/ship-check.json": '{ "build": null, "url": null }\n',
};
const lines = (text) =>
  text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#"));

// ---- D4: init, readConfig, push on a tracked key file
{
  const dir = repo(undefined, { remote: "none" });
  const cfgFile = path.join(dir, ".claude", "ship-check.json"),
    giFile = path.join(dir, ".gitignore");
  const r1 = await ship(["init"], { cwd: dir });
  const cfg1 = read(cfgFile),
    gi1 = read(giFile);
  await test("D4 init in a fresh repo: exits 0 and writes .claude/ship-check.json = { build: null, url: null }", () => {
    const cfg = cfg1 && JSON.parse(cfg1);
    return [
      r1.status === 0 &&
        cfg &&
        cfg.build === null &&
        cfg.url === null &&
        Object.keys(cfg).length === 2,
      `${show(r1)}; config ${cfg1}`,
    ];
  });
  await test("D4 init in a fresh repo: .gitignore gets .env.* then !.env.example, .dev.vars, *.pem, *.key, **/settings.local.json", () => {
    const l = lines(gi1 ?? "");
    const missing = NEEDED.filter((x) => !l.includes(x));
    return [
      gi1 !== null &&
        !missing.length &&
        l.indexOf("!.env.example") > l.indexOf(".env.*"),
      gi1 === null
        ? "no .gitignore written"
        : `missing: ${missing.join(", ") || "none"}; lines: ${l.join(" | ")}`,
    ];
  });
  await test('D4 init: git ignores .env.production, .dev.vars, server.pem, tls.key, .claude/settings.local.json (a "don\'t ask again" token must not be committed); not .env.example or the config', () => {
    // with the temp home, so this computer's global ignore list (~/.config/git/ignore) does not stand in for init
    const ignored = (f) =>
      spawnSync("git", ["check-ignore", "-q", "--no-index", f], {
        cwd: dir,
        env: envWith({
          XDG_CONFIG_HOME: undefined,
          GIT_CONFIG_GLOBAL: undefined,
        }),
      }).status === 0;
    const want = {
      ".env.production": true,
      ".dev.vars": true,
      "server.pem": true,
      "tls.key": true,
      ".claude/settings.local.json": true,
      ".env.example": false,
      ".claude/ship-check.json": false,
    };
    const wrong = Object.entries(want)
      .filter(([f, w]) => ignored(f) !== w)
      .map(([f, w]) => `${f} ${w ? "not ignored" : "ignored"}`);
    return [
      gi1 !== null && !wrong.length,
      gi1 === null ? "no .gitignore written" : wrong.join("; "),
    ];
  });
  await test("D4 init writes only neutral .gitignore lines (a public repo's .gitignore must not hint at the private setup): no line names ship-check or .claude", () => {
    const named = (gi1 ?? "")
      .split(/\r?\n/)
      .filter((l) => /ship-check|\.claude/i.test(l));
    return [
      gi1 !== null &&
        !named.length &&
        /^# secrets and local env files$/m.test(gi1),
      gi1 === null
        ? "no .gitignore written"
        : `lines naming the setup: ${named.join(" | ") || "none"}; .gitignore: ${gi1.replace(/\r?\n/g, " | ")}`,
    ];
  });
  const r2 = await ship(["init"], { cwd: dir });
  await test("D4 init a second time: exits 0 and changes neither file", () => [
    r1.status === 0 &&
      cfg1 !== null &&
      gi1 !== null &&
      r2.status === 0 &&
      read(cfgFile) === cfg1 &&
      read(giFile) === gi1,
    `${show(r2)}; config now ${read(cfgFile)}`,
  ]);
}
{
  // skills/new-project/preset/gitignore.txt holds all lines but .dev.vars
  const preset = fs.readFileSync(
    path.join(REPO, "skills", "new-project", "preset", "gitignore.txt"),
    "utf8",
  );
  const dir = repo([{ files: { ".gitignore": preset } }], { remote: "none" });
  const r = await ship(["init"], { cwd: dir });
  await test("D4 init on new-project's preset .gitignore: keeps its lines and adds only the missing ones", () => {
    const before = lines(preset),
      after = lines(read(path.join(dir, ".gitignore")) ?? "");
    const added = after.slice(before.length);
    const wantAdded = NEEDED.filter((x) => !before.includes(x));
    const twice = NEEDED.filter(
      (x) => after.filter((l) => l === x).length !== 1,
    );
    return [
      r.status === 0 &&
        before.every((l, i) => after[i] === l) &&
        added.length === wantAdded.length &&
        wantAdded.every((x) => added.includes(x)) &&
        !twice.length,
      `${show(r)}; added: ${added.join(" | ") || "nothing"} (want ${wantAdded.join(" | ")}); not once: ${twice.join(", ") || "none"}`,
    ];
  });
}
{
  const set = { build: "dist", url: "https://example.com" };
  const dir = repo(
    [{ files: { ".claude/ship-check.json": JSON.stringify(set) } }],
    { remote: "none" },
  );
  const r = await ship(["init"], { cwd: dir });
  await test("D4 init keeps a config the project already set", () => {
    const now = JSON.parse(read(path.join(dir, ".claude", "ship-check.json")));
    return [
      r.status === 0 &&
        now.build === "dist" &&
        now.url === set.url &&
        lines(read(path.join(dir, ".gitignore")) ?? "").includes(".dev.vars"),
      `${show(r)}; config ${JSON.stringify(now)}`,
    ];
  });
}
{
  const dir = repo(
    [
      {
        files: {
          ".claude/ship-check.json": JSON.stringify({
            build: "dist",
            url: "https://example.com",
            deploy: ["./ship.sh"],
          }),
          "web/src/a.js": "x\n",
        },
      },
    ],
    { remote: "none" },
  );
  const plain = repo(undefined, { remote: "none" });
  await test("D4 readConfig: the git top folder's .claude/ship-check.json, read from a subfolder; null without one", async () => {
    const readConfig = need("readConfig");
    const a = await readConfig(path.join(dir, "web", "src")),
      b = await readConfig(plain);
    return [
      a?.build === "dist" &&
        a?.url === "https://example.com" &&
        a?.deploy?.[0] === "./ship.sh" &&
        b === null,
      `got ${JSON.stringify(a)} and ${JSON.stringify(b)}`,
    ];
  });
}
{
  // .dev.vars committed before the ignore lines came
  const tracked = repo([
    { files: { "README.md": "hello\n", ".dev.vars": "API_TOKEN=abc\n" } },
    { files: SWITCHED_ON },
  ]);
  const clean = repo([{ files: { "README.md": "hello\n", ...SWITCHED_ON } }]);
  const r = await ship(["push"], { cwd: tracked });
  await test("D4 push: exits 1 on a tracked .dev.vars, naming it", () => [
    r.status === 1 && r.out.includes(".dev.vars"),
    show(r),
  ]);
  const c = await ship(["push"], { cwd: clean });
  await test("D4 push: a switched-on repo with no key file exits 0", () => [
    c.status === 0,
    show(c),
  ]);
  const off = await ship(["push"], {
    cwd: tracked,
    env: { SHIP_CHECK: "off" },
  });
  await test("SHIP_CHECK=off: push exits 0 on the repo with the tracked .dev.vars", () => [
    off.status === 0 && c.status === 0,
    show(off),
  ]);
}

// ---- D3: the history scan
const histRepo = repo([
  { files: { "README.md": "hello\n", ...SWITCHED_ON }, message: "base" },
  { files: { "settings.py": `${KEY_LINE}\n` }, message: "add settings" },
  { remove: ["settings.py"], message: "drop settings" },
]);
const keyCommit = git(histRepo, "rev-parse", "HEAD~1");
const historyCase = async (label, env) => {
  const r = await ship(["push", "--history"], { cwd: histRepo, env });
  await test(`D3 push --history (${label}): exits 1 naming the commit that added the deleted key, the key masked`, () => [
    r.status === 1 &&
      r.out.includes(keyCommit.slice(0, 7)) &&
      r.out.includes("settings.py") &&
      !r.out.includes(HEX),
    show(r).replaceAll(HEX, "<the key>"),
  ]);
};
await historyCase("fake gitleaks", {});
{
  const r = await ship(["push"], { cwd: histRepo });
  await test("D3 push without --history: a key only in commits the remote has is no finding (exit 0)", () => [
    r.status === 0,
    show(r),
  ]);
  const none = await ship(["push", "--history"], {
    cwd: histRepo,
    env: { SHIP_CHECK_GITLEAKS: undefined, PATH: PATH_NO_GITLEAKS },
  });
  await test("D3 push --history with no gitleaks anywhere: exits 2 naming gitleaks", () => [
    none.status === 2 && /gitleaks/i.test(none.out),
    show(none),
  ]);
}
await test("findGitleaks: SHIP_CHECK_GITLEAKS's .mjs, as a command array", () => {
  const cmd = need("findGitleaks")();
  return [
    Array.isArray(cmd) &&
      cmd.some((x) => path.resolve(String(x)) === FAKE_GITLEAKS),
    `got ${JSON.stringify(cmd)}`,
  ];
});
{
  // Asked in a child Node: no SHIP_CHECK_GITLEAKS and a PATH without gitleaks
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(pathToFileURL(SHIP).href)}); console.log(JSON.stringify(m.findGitleaks()));`,
    ],
    {
      encoding: "utf8",
      env: envWith({ SHIP_CHECK_GITLEAKS: undefined, PATH: PATH_NO_GITLEAKS }),
    },
  );
  await test("findGitleaks: null with no SHIP_CHECK_GITLEAKS and no gitleaks on PATH", () => [
    r.status === 0 && r.stdout.trim() === "null",
    `exit ${r.status}: ${(r.stdout + r.stderr).trim().slice(0, 300)}`,
  ]);
}
const rangeRepo = repo(
  [{ files: { "README.md": "hello\n", ...SWITCHED_ON } }],
  {
    unpushed: [
      { files: { "config.py": `${KEY_LINE}\n` }, message: "add config" },
    ],
  },
);
const rangeCommit = git(rangeRepo, "rev-parse", "HEAD");
const rangeOk = (res) =>
  Array.isArray(res?.findings) &&
  res.findings.some(
    (f) =>
      f.rule === "generic-api-key" &&
      fwd(String(f.file)).endsWith("config.py") &&
      f.commit &&
      rangeCommit.startsWith(String(f.commit)),
  ) &&
  !JSON.stringify(res).includes(HEX);
await test("gitleaksRange (fake gitleaks): the unpushed commit's key, with rule, file and commit, masked", async () => {
  const res = await need("gitleaksRange")(rangeRepo, ["main"], {
    timeoutMs: 30000,
  });
  return [
    rangeOk(res),
    String(JSON.stringify(res)).replaceAll(HEX, "<the key>").slice(0, 400),
  ];
});
await test("gitleaksRange: past its time limit, { error }", async () => {
  const fn = need("gitleaksRange");
  process.env.FAKE_GITLEAKS = "hang";
  try {
    const t = Date.now();
    const res = await fn(rangeRepo, ["main"], { timeoutMs: 1500 });
    return [
      typeof res?.error === "string" &&
        res.error &&
        !res.findings &&
        Date.now() - t < 20000,
      `${Date.now() - t} ms, got ${JSON.stringify(res)}`,
    ];
  } finally {
    delete process.env.FAKE_GITLEAKS;
  }
});

// ---- D8: push --full (npm audit, GitHub settings)
const fullRepo = repo(
  [
    {
      files: {
        "README.md": "hello\n",
        ...SWITCHED_ON,
        "package.json": "{}\n",
        "package-lock.json": "{}\n",
        "web/package.json": "{}\n",
        "web/package-lock.json": "{}\n",
      },
    },
  ],
  { remote: "github" },
);
put(fullRepo, { "node_modules/dep/package-lock.json": "{}\n" });
const npmLog = path.join(tmp.dir, "npm.log"),
  ghLog = path.join(tmp.dir, "gh.log");
const full = (env, cwd = fullRepo) => {
  fs.rmSync(npmLog, { force: true });
  fs.rmSync(ghLog, { force: true });
  return ship(["push", "--full"], {
    cwd,
    env: {
      FAKE_NPM_LOG: npmLog,
      FAKE_GH_LOG: ghLog,
      FAKE_NPM: "clean",
      FAKE_GH: "on",
      ...env,
    },
  });
};
{
  const r = await full({});
  const real = (d) => fs.realpathSync.native(d);
  const audited = (read(npmLog) ?? "")
    .split(/\r?\n/)
    .filter(Boolean)
    .map((d) => fwd(path.relative(real(fullRepo), real(d))) || ".")
    .sort();
  await test("D8 push --full: npm audit runs in each folder with a package-lock.json, not under node_modules", () => [
    audited.join() === ".,web",
    `audited: ${audited.join(", ") || "none"}; ${show(r)}`,
  ]);
  await test("D8 push --full: no high finding, secret scanning and push protection enabled: exit 0, gh asked", () => [
    r.status === 0 && Boolean(read(ghLog)),
    show(r),
  ]);
}
{
  const r = await full({ FAKE_NPM: "high" });
  await test("D8 push --full: a high npm audit finding exits 1", () => [
    r.status === 1 && /high/i.test(r.out),
    show(r),
  ]);
  // The audit's time limit, shortened for the test by SHIP_CHECK_AUDIT_TIMEOUT_MS (ms)
  const webOnly = repo(
    [
      {
        files: {
          "README.md": "hello\n",
          ...SWITCHED_ON,
          "web/package.json": "{}\n",
          "web/package-lock.json": "{}\n",
        },
      },
    ],
    { remote: "github" },
  );
  const t = Date.now();
  const slow = await full(
    { FAKE_NPM: "hang", SHIP_CHECK_AUDIT_TIMEOUT_MS: "1500" },
    webOnly,
  );
  await test("D8 push --full: npm audit past its time limit exits 2 naming the folder", () => [
    slow.status === 2 &&
      /\bweb\b/.test(fwd(slow.out)) &&
      Date.now() - t < 30000,
    `${Date.now() - t} ms, ${show(slow)}`,
  ]);
}
for (const [mode, want, says, label] of [
  ["push-off", 1, /push protection/i, "push protection disabled exits 1"],
  ["scan-off", 1, /secret scanning/i, "secret scanning disabled exits 1"],
  ["broken", 2, /\bgh\b|github/i, "gh fails: exits 2"],
  [
    "hidden",
    2,
    /secret scanning|push protection/i,
    "settings missing from gh's answer: exits 2",
  ],
  ["private", 0, /not checked/i, 'a private repo: "not checked", exit 0'],
]) {
  const r = await full({ FAKE_GH: mode });
  await test(`D8 push --full, GitHub settings: ${label}`, () => [
    r.status === want && says.test(r.out),
    show(r),
  ]);
}
{
  // gh's active account is not the repo's owner: read as the owner when gh holds that login, never switching accounts
  const calls = () =>
    (read(ghLog) ?? "")
      .split(/\r?\n/)
      .filter(Boolean)
      .map((l) => JSON.parse(l));
  const r = await full({
    FAKE_GH_ACCOUNTS: "someone-else,example-owner",
    FAKE_GH_ACTIVE: "someone-else",
  });
  const c = calls();
  await test("D8 push --full, GitHub settings: another account active, gh holds the owner's login: reads as the owner (exit 0), no account switch, no token shown", () => [
    r.status === 0 &&
      c.some((x) => x.args[0] === "api" && x.as === "example-owner") &&
      !c.some((x) => x.args.includes("switch")) &&
      !r.out.includes("token-"),
    `${show(r)}; gh calls: ${c.map((x) => `${x.args.join(" ")} as ${x.as}`).join(" | ")}`,
  ]);
  const o = await full({ FAKE_GH_ACCOUNTS: "someone-else" });
  await test("D8 push --full, GitHub settings: gh holds no login of the owner: exit 2, naming the account it read as and the owner", () => [
    o.status === 2 &&
      /read as someone-else, not the owner example-owner/.test(o.out) &&
      !calls().some((x) => x.args.includes("switch")),
    show(o),
  ]);
  // gh auth status marks the active account on a line after its block, a failed login's block too
  const callList = () =>
    calls()
      .map((x) => `${x.args.join(" ")} as ${x.as}`)
      .join(" | ");
  const f = await full({
    FAKE_GH_ACCOUNTS: "example-owner,someone-else",
    FAKE_GH_ACTIVE: "someone-else",
    FAKE_GH_FAILED: "someone-else",
  });
  await test("D8 push --full, GitHub settings: the active login failed (invalid token), the owner's login is valid: reads as the owner, exit 0", () => [
    f.status === 0 &&
      calls().some((x) => x.args[0] === "api" && x.as === "example-owner"),
    `${show(f)}; gh calls: ${callList()}`,
  ]);
  const g = await full({
    FAKE_GH_ACCOUNTS: "someone-else,example-owner",
    FAKE_GH_ACTIVE: "someone-else",
    FAKE_GH_FAILED: "example-owner",
  });
  await test("D8 push --full, GitHub settings: the owner's login failed: its token is not used, exit 2", () => [
    g.status === 2 &&
      !calls().some((x) => x.args[0] === "auth" && x.args[1] === "token"),
    `${show(g)}; gh calls: ${callList()}`,
  ]);
  const h = await full({
    FAKE_GH_ACCOUNTS: "someone-else",
    FAKE_GH_AUTH: "broken",
  });
  await test("D8 push --full, GitHub settings: gh auth status fails: the plain answer, no made-up account name, exit 2", () => [
    h.status === 2 &&
      /holds no secret scanning or push protection setting/.test(h.out) &&
      !/read as|active account/.test(h.out),
    show(h),
  ]);
  const tk = await full({
    FAKE_GH_ACCOUNTS: "someone-else,example-owner",
    FAKE_GH_ACTIVE: "someone-else",
    FAKE_GH_TOKEN: "broken",
  });
  await test("D8 push --full, GitHub settings: the owner's token cannot be read: falls back to the active account's read with one note, exit 2", () => [
    tk.status === 2 &&
      (tk.out.match(/could not read the gh token of example-owner/g) ?? [])
        .length === 1 &&
      /read as someone-else, not the owner example-owner/.test(tk.out),
    show(tk),
  ]);
  // A repo an organization owns: no login can be the owner, so the answer names the admin rights it needs
  const orgRepo = repo(
    [
      {
        files: {
          "README.md": "hello\n",
          ...SWITCHED_ON,
          "package-lock.json": "{}\n",
        },
      },
    ],
    { remote: "none" },
  );
  git(
    orgRepo,
    "remote",
    "add",
    "origin",
    "https://github.com/example-org/example-repo.git",
  );
  const k = await full({}, orgRepo);
  await test("D8 push --full, GitHub settings: an organization's repo, not an admin: exit 2, names the account and the admin rights, no advice to log in as the organization", () => [
    k.status === 2 &&
      /read as example-owner: can't see these settings \(it needs admin rights on example-org\/example-repo\)/.test(
        k.out,
      ) &&
      !/not the owner|gh auth login/.test(k.out),
    show(k),
  ]);
  const ka = await full({ FAKE_GH_ADMINS: "example-owner" }, orgRepo);
  await test("D8 push --full, GitHub settings: an organization's repo, the active account an admin: exit 0", () => [
    ka.status === 0,
    show(ka),
  ]);
  for (const [env, label] of [
    [{}, "the active account is the owner"],
    [{ FAKE_GH: "private" }, "a private repo"],
  ]) {
    const p = await full(env);
    const asked = calls().filter((x) => x.args[0] === "auth");
    await test(`D8 push --full, GitHub settings: ${label}: one gh api call, no account lookup (no extra gh wait)`, () => [
      p.status === 0 && !asked.length,
      `${show(p)}; auth calls: ${asked.map((x) => x.args.join(" ")).join(" | ") || "none"}`,
    ]);
  }
}
{
  const local = repo([
    {
      files: {
        "README.md": "hello\n",
        ...SWITCHED_ON,
        "package-lock.json": "{}\n",
      },
    },
  ]);
  const r = await full({}, local);
  await test('D8 push --full, no GitHub remote: "not checked", exit 0', () => [
    r.status === 0 && /not checked/i.test(r.out),
    show(r),
  ]);
}

// ---- D5: what gets uploaded
const CLEAN_SITE = {
  "index.html":
    '<!doctype html><title>t</title><script src="/assets/app.js"></script>\n',
  "assets/app.js": "console.log(1);\n",
  _headers: "/*\n  X-Content-Type-Options: nosniff\n",
  _redirects: "/old /new 301\n",
  ".well-known/security.txt": "Contact: mailto:security@example.com\n",
};
const inDist = (files) =>
  Object.fromEntries(Object.entries(files).map(([f, t]) => [`dist/${f}`, t]));
// A switched-on project with its built site in dist/ and its env files, both left uncommitted as a build leaves them
function project(dist, envFiles = {}, files = {}) {
  const dir = repo(
    [
      {
        files: {
          "README.md": "hello\n",
          ...SWITCHED_ON,
          "package.json": "{}\n",
          ...files,
        },
      },
    ],
    { remote: "none" },
  );
  put(dir, { ...inDist(dist), ...envFiles });
  return dir;
}
const buildIn = (dir) =>
  need("buildCheck")(path.join(dir, "dist"), { projectDir: dir });
{
  const dir = project(CLEAN_SITE);
  const r = await ship(["build", "dist"], { cwd: dir });
  const missing = Object.keys(CLEAN_SITE).filter(
    (f) => !fwd(r.out).includes(f),
  );
  await test("D5 build: a clean folder (with _headers, _redirects, .well-known/) exits 0 and lists every file", () => [
    r.status === 0 && !missing.length,
    `not listed: ${missing.join(", ") || "none"}; ${show(r)}`,
  ]);
  await test("D5 buildCheck: the clean folder's files, no problems", async () => {
    const res = await buildIn(dir);
    const files = (res?.files ?? []).map((f) => fwd(String(f)));
    const notIn = Object.keys(CLEAN_SITE).filter(
      (f) => !files.some((x) => x.endsWith(f)),
    );
    return [
      Array.isArray(res?.problems) &&
        res.problems.length === 0 &&
        !notIn.length,
      `not in files: ${notIn.join(", ") || "none"}; ${JSON.stringify(res)?.slice(0, 300)}`,
    ];
  });
}
for (const [label, file, text, mark] of [
  [".env", ".env", "API_URL=https://api.example.com\n", ".env"],
  [".git/", ".git/HEAD", "ref: refs/heads/main\n", ".git"],
  [
    "*.map",
    "assets/app.js.map",
    '{"version":3,"sources":["src/app.ts"]}\n',
    "app.js.map",
  ],
  ["*.bak", "index.html.bak", "<!doctype html>\n", "index.html.bak"],
  ["*.old", "config.old", "old\n", "config.old"],
  [
    "node_modules",
    "node_modules/left-pad/index.js",
    "module.exports = 1;\n",
    "node_modules",
  ],
  ["another dotfile", ".htpasswd", "admin:x\n", ".htpasswd"],
]) {
  const dir = project({ ...CLEAN_SITE, [file]: text });
  const r = await ship(["build", "dist"], { cwd: dir });
  await test(`D5 build: exits 1 on ${label} in the folder, naming ${mark}`, async () => {
    const res = await buildIn(dir);
    const named = (res?.problems ?? []).some(
      (p) => fwd(String(p.file)).includes(mark) && p.why,
    );
    return [
      r.status === 1 && fwd(r.out).includes(mark) && named,
      `${show(r)}; buildCheck problems ${JSON.stringify(res?.problems)}`,
    ];
  });
}
const keyDir = project({
  ...CLEAN_SITE,
  "assets/app.js": `const ${KEY_LINE};\n`,
});
const keyCase = async (label, env) => {
  const r = await ship(["build", "dist"], { cwd: keyDir, env });
  await test(`D5 build (${label}): exits 1 on a key inside a built file, naming the file, the key masked`, () => [
    r.status === 1 &&
      fwd(r.out).includes("assets/app.js") &&
      !r.out.includes(HEX),
    show(r).replaceAll(HEX, "<the key>"),
  ]);
};
await keyCase("fake gitleaks", {});
await test("D5 buildCheck: the key in assets/app.js is a problem on that file, the key masked", async () => {
  const res = await buildIn(keyDir);
  return [
    (res?.problems ?? []).some((p) =>
      fwd(String(p.file)).endsWith("assets/app.js"),
    ) && !JSON.stringify(res).includes(HEX),
    String(JSON.stringify(res?.problems)).replaceAll(HEX, "<the key>"),
  ];
});
{
  // Public-prefixed secret names in the project's env files are baked into the build
  const named = [
    [".env", "VITE_SECRET_KEY"],
    [".env.local", "NEXT_PUBLIC_API_TOKEN"],
    [".env.production", "PUBLIC_DB_PASSWORD"],
    [".env", "REACT_APP_STRIPE_KEY"],
    [".env.production", "NEXT_PUBLIC_SUPABASE_service_role"],
  ];
  const r = await ship(["build", "dist"], {
    cwd: project(CLEAN_SITE, { ".env": "VITE_SECRET_KEY=abc123\n" }),
  });
  await test("D5 build: exits 1 on VITE_SECRET_KEY in the project's .env, naming it", () => [
    r.status === 1 && r.out.includes("VITE_SECRET_KEY"),
    show(r),
  ]);
  await test("D5 buildCheck: each public-prefixed KEY/SECRET/TOKEN/PASSWORD/service_role name in .env, .env.local, .env.production", async () => {
    const missed = [];
    for (const [file, name] of named) {
      const res = await buildIn(
        project(CLEAN_SITE, { [file]: `${name}=abc123\n` }),
      );
      if (
        !(res?.problems ?? []).some((p) => `${p.file} ${p.why}`.includes(name))
      )
        missed.push(`${name} in ${file}`);
    }
    return [!missed.length, `not found: ${missed.join(", ")}`];
  });
  const fine = project(CLEAN_SITE, {
    ".env":
      "VITE_API_URL=https://api.example.com\nSECRET_KEY=abc123\nPUBLIC_URL=https://example.com\n",
  });
  const ok = await ship(["build", "dist"], { cwd: fine });
  await test("D5 build: public names without a secret word, and secrets without a public prefix, exit 0", () => [
    ok.status === 0,
    show(ok),
  ]);
}

// ---- D6: the live probe, against a local server. `site` says what it serves; `hits` records each path asked.
const ROOT_PAGE = CLEAN_SITE["index.html"];
// The phone relay's page headers (phone/relay/local/server.mjs PAGE_HEADERS) plus HSTS
const GOOD = {
  "Content-Security-Policy":
    "default-src 'none'; script-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors https://web.telegram.org",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};
const without = (name) =>
  Object.fromEntries(Object.entries(GOOD).filter(([k]) => k !== name));
let site = { headers: GOOD, files: {}, fallback: false };
const hits = [];
const server = http.createServer((req, res) => {
  const p = new URL(req.url, "http://local").pathname;
  hits.push(p);
  const h = { "Content-Type": "text/html; charset=utf-8", ...site.headers };
  if (p === "/") return res.writeHead(200, h).end(ROOT_PAGE);
  if (p === "/assets/app.js")
    return res
      .writeHead(200, { ...h, "Content-Type": "text/javascript" })
      .end("console.log(1);\n");
  if (p === "/deploy-marker") return res.writeHead(204, h).end();
  if (site.files[p])
    return res
      .writeHead(site.files[p][0], { ...h, "Content-Type": "text/plain" })
      .end(site.files[p][1]);
  if (site.fallback) return res.writeHead(200, h).end(ROOT_PAGE);
  res.writeHead(404, h).end("not found");
});
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const SITE_URL = `http://127.0.0.1:${server.address().port}`;
const live = (s) => {
  site = { headers: GOOD, files: {}, fallback: false, ...s };
  hits.length = 0;
  return ship(["live", SITE_URL], { cwd: tmp.dir });
};
{
  const r = await live({ files: { "/.git/HEAD": [403, "forbidden"] } });
  const notAsked = [
    "/.env",
    "/.env.local",
    "/.env.production",
    "/.git/HEAD",
    "/.git/config",
    "/.dev.vars",
    "/wrangler.jsonc",
    "/package.json",
    "/assets/app.js.map",
  ].filter((p) => !hits.includes(p));
  await test("D6 live: hidden paths 404/403 and every header right: exit 0, each hidden path and the bundle's .map asked", () => [
    r.status === 0 && !notAsked.length,
    `not asked: ${notAsked.join(", ") || "none"}; ${show(r)}`,
  ]);
  const fb = await live({ fallback: true });
  await test("D6 live: a 200 equal to the root page (an app's fallback) passes", () => [
    fb.status === 0,
    show(fb),
  ]);
  const env = await live({
    files: { "/.env": [200, "API_KEY=abc123\nPORT=3000\n"] },
  });
  await test("D6 live: /.env serving KEY= lines exits 1 naming /.env", () => [
    env.status === 1 && env.out.includes("/.env"),
    show(env),
  ]);
  const head = await live({
    files: { "/.git/HEAD": [200, "ref: refs/heads/main\n"] },
  });
  await test("D6 live: /.git/HEAD serving ref: refs/heads/main exits 1 naming /.git/HEAD", () => [
    head.status === 1 && head.out.includes("/.git/HEAD"),
    show(head),
  ]);
}
await test("D6 liveCheck: each other hidden path serving a file is a problem naming that path", async () => {
  const liveCheck = need("liveCheck");
  const served = {
    "/.env.local": "DB_PASSWORD=abc123\n",
    "/.env.production": "API_KEY=abc123\n",
    "/.git/config": "[core]\n\trepositoryformatversion = 0\n",
    "/.dev.vars": "API_TOKEN=abc123\n",
    "/wrangler.jsonc": '{ "name": "site", "main": "src/index.js" }\n',
    "/package.json": '{ "name": "site", "private": true }\n',
    "/assets/app.js.map": '{"version":3,"sources":["src/app.ts"]}\n',
  };
  const missed = [];
  for (const [p, body] of Object.entries(served)) {
    site = { headers: GOOD, files: { [p]: [200, body] }, fallback: false };
    const res = await liveCheck(SITE_URL, { fetch });
    if (!(res?.problems ?? []).some((x) => String(x.where).includes(p)))
      missed.push(p);
  }
  return [!missed.length, `not named: ${missed.join(", ")}`];
});
for (const [label, headers, says] of [
  [
    "no Strict-Transport-Security",
    without("Strict-Transport-Security"),
    /Strict-Transport-Security/i,
  ],
  [
    "no X-Content-Type-Options: nosniff",
    without("X-Content-Type-Options"),
    /X-Content-Type-Options|nosniff/i,
  ],
  [
    "no frame-ancestors and no X-Frame-Options",
    {
      ...GOOD,
      "Content-Security-Policy": "default-src 'none'; script-src 'self'",
    },
    /frame-ancestors|X-Frame-Options/i,
  ],
  ["no Referrer-Policy", without("Referrer-Policy"), /Referrer-Policy/i],
  [
    "Access-Control-Allow-Origin: *",
    { ...GOOD, "Access-Control-Allow-Origin": "*" },
    /Access-Control-Allow-Origin/i,
  ],
  ["X-Powered-By", { ...GOOD, "X-Powered-By": "Express" }, /X-Powered-By/i],
]) {
  const r = await live({ headers });
  await test(`D6 live: ${label} exits 1 naming it`, () => [
    r.status === 1 && says.test(r.out),
    show(r),
  ]);
}
{
  const r = await live({
    headers: {
      ...GOOD,
      "Content-Security-Policy": "default-src 'none'",
      "X-Frame-Options": "DENY",
    },
  });
  await test("D6 live: X-Frame-Options in place of frame-ancestors passes", () => [
    r.status === 0,
    show(r),
  ]);
}

// ---- D7: ship-check deploy -- <command>. The command asks the server for /deploy-marker, so `hits` shows its place.
function deployProject(config, dist = CLEAN_SITE) {
  return project(
    dist,
    {},
    {
      ".claude/ship-check.json": `${JSON.stringify(config)}\n`,
      "deploy-marker.mjs": `await fetch(${JSON.stringify(`${SITE_URL}/deploy-marker`)});\nconsole.log("DEPLOY-COMMAND-RAN");\n`,
    },
  );
}
const deploy = (dir, s = {}) => {
  site = { headers: GOOD, files: {}, fallback: false, ...s };
  hits.length = 0;
  return ship(["deploy", "--", "node", "deploy-marker.mjs"], { cwd: dir });
};
{
  const r = await deploy(deployProject({ build: "dist", url: SITE_URL }));
  const at = hits.indexOf("/deploy-marker");
  await test("D7 deploy: build check, then the command, then the live probe; exit 0", () => [
    r.status === 0 &&
      r.out.includes("DEPLOY-COMMAND-RAN") &&
      at >= 0 &&
      hits.indexOf("/.env", at) > at &&
      !hits.slice(0, at).includes("/.env"),
    `asked: ${hits.join(" ")}; ${show(r)}`,
  ]);
  const bad = await deploy(
    deployProject(
      { build: "dist", url: SITE_URL },
      { ...CLEAN_SITE, ".env": "API_URL=x\n" },
    ),
  );
  await test("D7 deploy: a build finding stops it before the command (exit 1, naming .env)", () => [
    bad.status === 1 &&
      !hits.includes("/deploy-marker") &&
      !bad.out.includes("DEPLOY-COMMAND-RAN") &&
      bad.out.includes(".env"),
    `asked: ${hits.join(" ") || "nothing"}; ${show(bad)}`,
  ]);
  const after = await deploy(deployProject({ build: "dist", url: SITE_URL }), {
    headers: without("Strict-Transport-Security"),
  });
  await test("D7 deploy: the live probe after the command fails it (exit 1, naming the header)", () => [
    after.status === 1 &&
      hits.includes("/deploy-marker") &&
      /Strict-Transport-Security/i.test(after.out),
    show(after),
  ]);
  const unset = await deploy(deployProject({ build: null, url: null }));
  await test('D7 deploy: exits 2 naming "build" while build is null, before the command', () => [
    unset.status === 2 &&
      /\bbuild\b/.test(unset.out) &&
      !hits.includes("/deploy-marker"),
    show(unset),
  ]);
  const noUrl = await deploy(deployProject({ build: "dist", url: null }));
  await test('D7 deploy: exits 2 naming "url" while url is null, before the command', () => [
    noUrl.status === 2 &&
      /\burl\b/.test(noUrl.out) &&
      !hits.includes("/deploy-marker"),
    show(noUrl),
  ]);
  const off = await deploy(deployProject({ build: false, url: false }));
  await test("D7 deploy: build and url false on purpose: the command runs, no probe, exit 0", () => [
    off.status === 0 &&
      hits.includes("/deploy-marker") &&
      !hits.includes("/.env"),
    `asked: ${hits.join(" ")}; ${show(off)}`,
  ]);
}
await test("D7 deployMatch: each built-in deploy command matches", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const missed = [
    "wrangler deploy",
    "npx wrangler deploy --env production",
    "wrangler pages deploy dist",
    "vercel --prod",
    "netlify deploy --prod",
    "firebase deploy --only hosting",
    "npx gh-pages -d dist",
    "fly deploy",
    "npm run deploy",
    "pnpm run deploy",
    "yarn run deploy",
    "bun run deploy",
  ].filter((c) => !dm(c, cfg));
  return [!missed.length, `not matched: ${missed.join(" | ")}`];
});
await test("D7 deployMatch: the config's deploy list matches; not without it", () => {
  const dm = need("deployMatch");
  const a = dm("./scripts/release.sh --prod", {
      build: null,
      url: null,
      deploy: ["./scripts/release.sh"],
    }),
    b = dm("./scripts/release.sh --prod", { build: null, url: null });
  return [
    Boolean(a) && b === null,
    `got ${JSON.stringify(a)} and ${JSON.stringify(b)}`,
  ];
});
await test("D7 deployMatch: the ship-check deploy wrapper and other commands never match", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null, deploy: ["./scripts/release.sh"] };
  const wrongly = [
    "node ~/.claude/workers/ship-check.mjs deploy -- wrangler deploy",
    'node "C:/Users/someone/.claude/workers/ship-check.mjs" deploy -- npm run deploy',
    "node ~/.claude/workers/ship-check.mjs deploy -- ./scripts/release.sh",
    "npm run build",
    "wrangler dev",
    "npx wrangler tail",
    "git push",
    "firebase login",
  ].filter((c) => dm(c, cfg) !== null);
  return [!wrongly.length, `matched: ${wrongly.join(" | ")}`];
});

// ---- /code-review round 1 of job 9: each case below once failed
{
  // .env.* does not match .env itself; the user's global ignore list must not decide this case
  const dir = repo(undefined, { remote: "none" });
  git(
    dir,
    "config",
    "core.excludesFile",
    path.join(tmp.dir, "no-global-ignore"),
  );
  const r = await ship(["init"], { cwd: dir });
  put(dir, { ".env": "PORT=3000\n" });
  const ig = spawnSync("git", ["check-ignore", "-q", ".env"], {
    cwd: dir,
  }).status;
  await test("review: init makes git ignore .env itself, not only .env.*", () => [
    r.status === 0 && ig === 0,
    `${show(r)}; git check-ignore .env exit ${ig}`,
  ]);
}
await test("review: deployMatch: a deploy tool's name as a package, a branch or an argument is no deploy", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const wrongly = [
    "npm install -D gh-pages",
    "git push origin gh-pages",
    "git checkout gh-pages",
    "npm i -g vercel",
    "which vercel",
  ].filter((c) => dm(c, cfg) !== null);
  return [!wrongly.length, `matched: ${wrongly.join(" | ")}`];
});
await test("review: deployMatch: the deploy tools run as commands still match", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const missed = [
    "npx gh-pages -d dist",
    "gh-pages -d dist",
    "vercel",
    "npx vercel --prod",
    "vercel deploy",
    "cd site && npx wrangler deploy",
    "NODE_ENV=production npm run deploy",
    "./node_modules/.bin/vercel --prod",
    'bash -c "wrangler deploy"',
  ].filter((c) => !dm(c, cfg));
  return [!missed.length, `not matched: ${missed.join(" | ")}`];
});
await test('review: deployMatch: a "deploy" that is a string, not a list, is an error naming "deploy"', () => {
  const dm = need("deployMatch");
  try {
    const got = dm("./ship.sh", {
      build: null,
      url: null,
      deploy: "./ship.sh",
    });
    return [false, `no error; got ${JSON.stringify(got)}`];
  } catch (e) {
    return [/"deploy".*list/.test(e.message), e.message];
  }
});
// end review of job 9: a pinned version (wrangler@4), a package name (netlify-cli, firebase-tools), vercel with an
// argument or a flag's value, and a deploy after `then` once ran raw in a switched-on project
await test("end review: deployMatch: pinned, runner and shell-keyword deploy forms match", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const missed = [
    "npx wrangler@4.162.0 deploy",
    "npx wrangler@latest pages deploy dist",
    "npx vercel@latest --prod",
    "vercel deploy dist --prod",
    "vercel --token $T --prod",
    "vercel --prod",
    "npx netlify-cli deploy",
    "netlify deploy --prod",
    "npx firebase-tools deploy",
    "npx gh-pages@6 -d dist",
    "if [ -d dist ]; then wrangler deploy; fi",
    "pnpm dlx wrangler@4 deploy",
  ].filter((c) => !dm(c, cfg));
  return [!missed.length, `not matched: ${missed.join(" | ")}`];
});
await test("end review: deployMatch: vercel's other subcommands and an installed pinned tool are no deploy", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const wrongly = [
    "npm i -D wrangler@4",
    "wrangler whoami",
    "vercel env pull",
    "vercel login",
    "vercel link",
    "vercel whoami",
    "vercel dev",
    "vercel pull",
    "vercel ls",
    "vercel --token $T env pull",
    "npx vercel@latest login",
  ].filter((c) => dm(c, cfg) !== null);
  return [!wrongly.length, `matched: ${wrongly.join(" | ")}`];
});
// vercel with a folder to deploy (`vercel ./dist`) and a runner told the package to fetch (`npx -p netlify-cli
// netlify deploy`) once ran raw in a switched-on project
await test("deployMatch: vercel <folder> and a runner's -p <package> deploy forms match", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const missed = [
    "vercel ./dist",
    "vercel ./dist --prod",
    "vercel --prod ../site",
    "npx vercel .",
    "npx -p netlify-cli netlify deploy",
    "npx -y -p netlify-cli@17 netlify deploy --prod",
    "npx --package=netlify-cli netlify deploy",
    "npx --package netlify-cli netlify deploy --dir dist",
  ].filter((c) => !dm(c, cfg));
  return [!missed.length, `not matched: ${missed.join(" | ")}`];
});
await test("deployMatch: a path after a vercel subcommand and a runner's other netlify command are no deploy", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const wrongly = [
    "vercel env pull .env.local",
    "vercel link --cwd ./site",
    "npx -p netlify-cli netlify login",
  ].filter((c) => dm(c, cfg) !== null);
  return [!wrongly.length, `matched: ${wrongly.join(" | ")}`];
});
// A value flag's value is no folder to deploy: the flag loop once gave the flag back as a bare flag and took its value
// (./apps/web) for vercel's folder word, so a subcommand after it read as a deploy
await test("deployMatch: a vercel value flag's path before a subcommand is no deploy", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const wrongly = [
    "vercel --cwd ./apps/web env ls",
    "vercel --cwd apps/web link",
    "vercel -A ./vercel.json env pull",
    "vercel --local-config ./v.json logs x",
    "vercel --token ./t env ls",
    "vercel -S ./x env ls",
    "vercel promote status",
  ].filter((c) => dm(c, cfg) !== null);
  return [!wrongly.length, `matched: ${wrongly.join(" | ")}`];
});
await test("deployMatch: vercel <folder> after flags, a value flag, redeploy and promote are deploys", () => {
  const dm = need("deployMatch");
  const cfg = { build: null, url: null };
  const missed = [
    "vercel ./dist",
    "vercel --prod ./dist",
    "vercel --cwd ./web --prod",
    "vercel redeploy",
    "vercel redeploy https://x.vercel.app",
    "vercel promote dpl_123 --yes",
  ].filter((c) => !dm(c, cfg));
  return [!missed.length, `not matched: ${missed.join(" | ")}`];
});
{
  const dir = project({
    ...CLEAN_SITE,
    ".nojekyll": "",
    ".htaccess": "Options -Indexes\n",
  });
  const r = await ship(["build", "dist"], { cwd: dir });
  await test("review: build: .nojekyll and .htaccess are the host's files, no findings; .htaccess still listed", () => [
    r.status === 0 && fwd(r.out).includes(".htaccess"),
    show(r),
  ]);
}
{
  const env = (names) => ({
    ".env": `${names.map((x) => `${x}=abc123`).join("\n")}\n`,
  });
  const publicOnes = [
    "VITE_SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY",
    "VITE_FIREBASE_API_KEY",
  ];
  await test("review: buildCheck: names public by design (anon key, publishable key, Firebase web key) are no findings", async () => {
    const res = await buildIn(project(CLEAN_SITE, env(publicOnes)));
    return [res?.problems?.length === 0, JSON.stringify(res?.problems)];
  });
  await test("review: buildCheck: VITE_STRIPE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY are still findings", async () => {
    const secret = [
      "VITE_STRIPE_SECRET_KEY",
      "NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY",
    ];
    const res = await buildIn(project(CLEAN_SITE, env(secret)));
    const missed = secret.filter(
      (x) => !(res?.problems ?? []).some((p) => p.why.includes(x)),
    );
    return [!missed.length, `not found: ${missed.join(", ")}`];
  });
  await test('review: buildCheck: the config\'s "publicNames" accepts a name on purpose; without it the name is a finding', async () => {
    const own = { build: null, url: null, publicNames: ["VITE_MAPS_KEY"] };
    const withList = await buildIn(
      project(CLEAN_SITE, env(["VITE_MAPS_KEY"]), {
        ".claude/ship-check.json": JSON.stringify(own),
      }),
    );
    const without = await buildIn(project(CLEAN_SITE, env(["VITE_MAPS_KEY"])));
    return [
      withList?.problems?.length === 0 && without?.problems?.length === 1,
      `with the list ${JSON.stringify(withList?.problems)}; without ${JSON.stringify(without?.problems)}`,
    ];
  });
}
{
  // A clean filter that takes 3 s makes `git add -A` slow; the 0.5 s limit must cover that git step too. The filter
  // leaves .git/slow-done when its 3 s are over: the answer must come before it (an order, not a clock).
  const dir = repo(undefined, { remote: "none" });
  git(
    dir,
    "config",
    "filter.slow.clean",
    "exec 2>/dev/null; sleep 3; : > .git/slow-done; cat",
  );
  put(dir, { ".gitattributes": "*.slow filter=slow\n", "a.slow": "x\n" });
  let res;
  try {
    res = await need("gitleaksUncommitted")(dir, { timeoutMs: 500 });
  } catch (e) {
    res = { thrown: e.message };
  }
  const filterDone = fs.existsSync(path.join(dir, ".git", "slow-done"));
  await test("review: gitleaksUncommitted: its git steps share the time limit; a slow git add ends in a time-limit error", () => [
    /time limit/.test(res?.error ?? "") && !filterDone,
    `slow filter ${filterDone ? "had ended" : "still running"}; ${JSON.stringify(res)}`,
  ]);
}

// ---- D3, D8: CI runs gitleaks over the whole history and the npm audit
{
  const yml = fs.readFileSync(
    path.join(REPO, ".github", "workflows", "tests.yml"),
    "utf8",
  );
  const jobs = {};
  let job = null,
    inJobs = false;
  for (const l of yml.split(/\r?\n/)) {
    if (/^jobs:\s*$/.test(l)) inJobs = true;
    else if (inJobs && /^ {2}[\w-]+:\s*$/.test(l))
      jobs[(job = l.trim().slice(0, -1))] = "";
    else if (job) jobs[job] += `${l}\n`;
  }
  const pinned = (t) =>
    /uses:\s*gitleaks\/gitleaks-action@[0-9a-f]{40}\b/.test(t) ||
    (/(curl|wget|gh release download|Invoke-WebRequest)[^\n]*gitleaks/i.test(
      t,
    ) &&
      /\b[0-9a-f]{64}\b/.test(t) &&
      /(sha256sum|shasum|Get-FileHash)/.test(t));
  const gl = Object.entries(jobs).filter(([, t]) => /gitleaks/i.test(t));
  await test("D3 CI: a job runs gitleaks pinned by a 40-hex commit (or a release download checked by its checksum)", () => [
    gl.some(([, t]) => pinned(t)),
    gl.length
      ? `jobs naming gitleaks: ${gl.map(([k]) => k).join(", ")}, none pinned`
      : "no job in tests.yml names gitleaks",
  ]);
  await test("D3 CI: that job checks out the whole history (fetch-depth: 0) and runs on pull requests", () => [
    gl.some(
      ([, t]) =>
        pinned(t) &&
        /fetch-depth:\s*0\b/.test(t) &&
        !/if:[^\n]*event_name\s*==\s*'push'/.test(t),
    ),
    "no pinned gitleaks job with fetch-depth: 0 that runs on pull requests",
  ]);
  await test("D8 CI: a step runs npm audit (not only npm ci --no-audit)", () => [
    /^\s*(?:-\s+)?(?:run:\s*)?npm audit\b/m.test(yml),
    "no npm audit step in tests.yml",
  ]);
}

// ---- D10: new-project says to switch the baseline on
{
  const skill = fs.readFileSync(
    path.join(REPO, "skills", "new-project", "SKILL.md"),
    "utf8",
  );
  await test("D10 new-project's SKILL.md says to run ship-check init", () => [
    /ship-check(?:\.mjs)?\s+init\b/.test(skill),
    "no `ship-check init` line in skills/new-project/SKILL.md",
  ]);
}

// ---- the real gitleaks (D1's generic key, D3's deleted key, D5's key in a built file)
if (!realGitleaks) console.log("skipped: no gitleaks on PATH");
else {
  const real = { SHIP_CHECK_GITLEAKS: undefined };
  // In a child Node, so ship-check sees no SHIP_CHECK_GITLEAKS
  const r = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      `const m = await import(${JSON.stringify(pathToFileURL(SHIP).href)}); console.log(JSON.stringify(await m.gitleaksRange(${JSON.stringify(rangeRepo)}, ["main"], { timeoutMs: 30000 })));`,
    ],
    { encoding: "utf8", env: envWith(real) },
  );
  await test("real gitleaks: gitleaksRange finds the generic api_key in the unpushed commit", () => {
    if (r.status !== 0)
      return [false, `exit ${r.status}: ${r.stderr.trim().split("\n")[0]}`];
    const res = JSON.parse(r.stdout.trim().split("\n").pop());
    return [rangeOk(res), r.stdout.replaceAll(HEX, "<the key>").slice(0, 400)];
  });
  await historyCase("real gitleaks", real);
  await keyCase("real gitleaks", real);
}

server.close();
summary();
