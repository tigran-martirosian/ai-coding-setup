#!/usr/bin/env node
// ship-check: the safety baseline every push and deploy runs, in any project
// (docs/2026-11-20-safe-deploys-spec.md). A project switches it on with `init`; the push-key-scan hook and the deploy
// path call it.
//
//   ship-check.mjs init                       writes .claude/ship-check.json ({ "build": null, "url": null }) and the
//                                             ignore lines for secret files (.env, .env.*, .dev.vars, *.pem, ...) that the
//                                             project's .gitignore lacks; keeps what is there, so a second run
//                                             changes nothing
//   ship-check.mjs push [--history] [--full]  key files git tracks (.env, .dev.vars, *.pem, id_rsa ...), and gitleaks
//                                             over the commits no remote has yet. --history: over every commit.
//                                             --full: also `npm audit --audit-level=high` in each folder with a
//                                             package-lock.json, and GitHub's secret scanning and push protection
//                                             (gh api; a public GitHub repo only, else "not checked: <reason>"; read
//                                             as the repo's owner when gh holds that login, the active gh account
//                                             never switched, else it names the account it read as)
//   ship-check.mjs build <folder>             lists every file a deploy of the folder uploads; problems: env files,
//                                             .git/, node_modules/, *.map, *.bak, *.old, key files, other dotfiles
//                                             (not .assetsignore, .nojekyll, .htaccess or .well-known/), keys inside
//                                             built files (gitleaks dir), public-prefixed secret names (VITE_..._KEY)
//                                             in the env files (not a name public by design, or in "publicNames")
//   ship-check.mjs live <url>                 /.env, /.git/HEAD and the other hidden paths, and the .map of the root
//                                             page's first script, give 404/403 (or the root page, an app's
//                                             fallback); the root page's security headers
//   ship-check.mjs deploy -- <command>        with "build" and "url" from .claude/ship-check.json (null: exit 2;
//                                             false: that step skipped): build check, then the command (its exit
//                                             code kept), then the live probe. A build finding stops it first.
//
// Exit codes: 0 pass; 1 findings; 2 cannot check (a tool missing, a read failed, a time limit; the message says what
// and how to fix it). Findings show file:line, the rule, the commit and the value masked (its first 4 characters).
// Switches: SHIP_CHECK=off skips the checks (push, build, live: exit 0 with one line; deploy: runs the command with
// no checks, saying so). SHIP_CHECK_GITLEAKS,
// SHIP_CHECK_NPM, SHIP_CHECK_GH name a .mjs file run with Node in place of the real tool (the tests' fakes);
// SHIP_CHECK_AUDIT_TIMEOUT_MS is npm audit's time limit per folder (default 60000).
// The real tools run without a shell; on Windows npm runs as node <npm-cli.js>, because npm.cmd needs one.
// Test: tests/test-ship-check.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const WIN = process.platform === "win32";
const fwd = (p) => p.replace(/\\/g, "/");
const GITLEAKS_TIMEOUT_MS = 60000;
const GH_TIMEOUT_MS = 20000;
const auditTimeoutMs = () => {
  const v = process.env.SHIP_CHECK_AUDIT_TIMEOUT_MS;
  if (v === undefined || v === "") return 60000;
  if (!/^\d+$/.test(v))
    throw new Error(
      `SHIP_CHECK_AUDIT_TIMEOUT_MS must be a number of ms, got "${v}"`,
    );
  return Number(v);
};
export const INSTALL_GITLEAKS = WIN
  ? "winget install Gitleaks.Gitleaks"
  : process.platform === "darwin"
    ? "brew install gitleaks"
    : "your package manager, or https://github.com/gitleaks/gitleaks/releases";
const INSTALL_GH = WIN
  ? "winget install GitHub.cli"
  : process.platform === "darwin"
    ? "brew install gh"
    : "https://cli.github.com";

// The lines init adds to .gitignore, in this order (!.env.example after .env.*, or the example is ignored too).
// The .gitignore names no tool: a public repo's lines say what they keep out, not which setup wrote them.
// **/settings.local.json keeps Claude Code's "don't ask again" list (each approved command word for word, a typed
// token too) out of git.
export const IGNORE_LINES = [
  ".env",
  ".env.*",
  "!.env.example",
  ".dev.vars",
  "*.pem",
  "*.key",
  "**/settings.local.json",
];
const CONFIG = path.join(".claude", "ship-check.json");

const git = (cwd, args, opts = {}) =>
  spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: 30000,
    maxBuffer: 256 * 1024 * 1024,
    windowsHide: true,
    ...opts,
  });
// The git top folder of dir, or null when dir is in no git repo
export function gitTop(dir) {
  const r = git(dir, ["rev-parse", "--show-toplevel"]);
  return r.status === 0 ? path.resolve(r.stdout.trim()) : null;
}

const strings = (v) =>
  Array.isArray(v) && v.every((x) => typeof x === "string" && x.trim());
const shown = (v) => JSON.stringify(v)?.slice(0, 60);
// What is wrong with the shape of a config, or null: an object; "deploy" and "publicNames" lists of strings
function configProblem(config) {
  if (!config || typeof config !== "object" || Array.isArray(config))
    return `must hold a JSON object ({ "build": ..., "url": ... }), not ${shown(config)}`;
  for (const k of ["deploy", "publicNames"])
    if (config[k] !== undefined && !strings(config[k]))
      return `"${k}" must be a list of strings, not ${shown(config[k])}`;
  return null;
}
// The git top folder's .claude/ship-check.json, or null (no repo, or the project has not switched the baseline on).
// Throws, naming the file and what is wrong, when it is not JSON or not of the config's shape.
export function readConfig(dir) {
  const top = gitTop(dir);
  if (!top) return null;
  const file = path.join(top, CONFIG);
  if (!fs.existsSync(file)) return null;
  let config;
  try {
    config = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`${fwd(file)} is not valid JSON: ${e.message}`);
  }
  const wrong = configProblem(config);
  if (wrong) throw new Error(`${fwd(file)}: ${wrong}`);
  return config;
}

// A file whose being in git at all is the problem: env files (not the example, sample or template), .dev.vars,
// key and certificate files, credentials, Claude's local settings, SSH private keys
export function secretFile(p) {
  const f = fwd(p);
  const name = f.split("/").pop();
  if (/^\.env(\..+)?$/i.test(name))
    return !/\.(example|sample|template|dist|defaults?)$/i.test(name);
  if (/^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/.test(name)) return true;
  return (
    name === ".dev.vars" ||
    /\.(pem|key|pfx|p12)$/i.test(name) ||
    /^\.?credentials\.json$/i.test(name) ||
    /(^|\/)\.aws\/credentials$/.test(f) ||
    /(^|\/)\.claude\/settings\.local\.json$/.test(f)
  );
}

// A value shown in output: its first 4 characters, never the rest
export const mask = (s) => {
  const v = String(s ?? "");
  return v.length > 8 ? `${v.slice(0, 4)}…` : "…";
};

const pathDirs = () => {
  const key = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH");
  return (process.env[key] ?? "").split(path.delimiter).filter(Boolean);
};
// A program on PATH (its .exe on Windows), or null
function onPath(name) {
  for (const d of pathDirs()) {
    const f = path.join(d, WIN ? `${name}.exe` : name);
    if (fs.existsSync(f) && fs.statSync(f).isFile()) return f;
  }
  return null;
}
// A tool as a command array: the .mjs the env var names (run with Node; a missing file is a missing tool), else
// what real() finds, else null
function tool(envName, real) {
  const fake = process.env[envName];
  if (fake)
    return fs.existsSync(fake) ? [process.execPath, path.resolve(fake)] : null;
  return real();
}
export const findGitleaks = () =>
  tool("SHIP_CHECK_GITLEAKS", () => {
    const f = onPath("gitleaks");
    return f ? [f] : null;
  });
const findGh = () =>
  tool("SHIP_CHECK_GH", () => {
    const f = onPath("gh");
    return f ? [f] : null;
  });
// npm: on Windows npm is npm.cmd, which only a shell can start, so its npm-cli.js runs with Node instead (beside
// node.exe, or beside the npm.cmd on PATH)
const findNpm = () =>
  tool("SHIP_CHECK_NPM", () => {
    if (!WIN) {
      const f = onPath("npm");
      return f ? [f] : null;
    }
    const dirs = [
      path.dirname(process.execPath),
      ...pathDirs().filter((d) => fs.existsSync(path.join(d, "npm.cmd"))),
    ];
    const cli = dirs
      .map((d) => path.join(d, "node_modules", "npm", "bin", "npm-cli.js"))
      .find((f) => fs.existsSync(f));
    return cli ? [process.execPath, cli] : null;
  });
const run = (cmd, args, opts) =>
  spawnSync(cmd[0], [...cmd.slice(1), ...args], {
    encoding: "utf8",
    windowsHide: true,
    maxBuffer: 256 * 1024 * 1024,
    ...opts,
  });
const firstLine = (s) =>
  String(s ?? "")
    .trim()
    .split(/\r?\n/)[0] || "no message";

// gitleaks with a JSON report on stdout (no secret is written to disk), in the git top folder so its .gitleaks.toml
// applies. { findings: [{ rule, file, line, commit, masked }] } or { error }
function gitleaks(top, args, timeoutMs, commitOf = (c) => c.slice(0, 7)) {
  const cmd = findGitleaks();
  if (!cmd) return { error: `gitleaks is not installed (${INSTALL_GITLEAKS})` };
  const r = run(
    cmd,
    [
      ...args,
      "--report-format",
      "json",
      "--report-path",
      "-",
      "--no-banner",
      "--log-level",
      "error",
    ],
    { cwd: top, timeout: timeoutMs },
  );
  if (r.error?.code === "ETIMEDOUT")
    return {
      error: `gitleaks ran past its time limit (${Math.round(timeoutMs / 1000)} s)`,
    };
  if (r.error) return { error: `gitleaks could not start: ${r.error.message}` };
  if (r.status !== 0 && r.status !== 1)
    return {
      error: `gitleaks failed (exit ${r.status}): ${firstLine(r.stderr)}`,
    };
  let report;
  try {
    report = JSON.parse(r.stdout);
  } catch {
    // never stdout in the message: it may hold the secret
    return {
      error: `gitleaks gave no readable report (exit ${r.status}): ${firstLine(r.stderr)}`,
    };
  }
  if (!Array.isArray(report))
    return { error: "gitleaks' report is not a list of findings" };
  return {
    findings: report.map((f) => ({
      rule: String(f.RuleID),
      file: fwd(String(f.File)),
      line: f.StartLine,
      commit: commitOf(String(f.Commit ?? "")),
      masked: mask(f.Secret),
    })),
  };
}
const noRepo = (dir) => ({ error: `${fwd(dir)} is in no git repository` });

// The commits on refs that no remote has yet
export function gitleaksRange(
  dir,
  refs = ["HEAD"],
  { timeoutMs = GITLEAKS_TIMEOUT_MS } = {},
) {
  const top = gitTop(dir);
  if (!top) return noRepo(dir);
  return gitleaks(
    top,
    ["git", ".", `--log-opts=${[...refs, "--not", "--remotes"].join(" ")}`],
    timeoutMs,
  );
}
// Every commit of every ref
export function gitleaksHistory(dir, { timeoutMs = GITLEAKS_TIMEOUT_MS } = {}) {
  const top = gitTop(dir);
  if (!top) return noRepo(dir);
  return gitleaks(top, ["git", ".", "--log-opts=--all"], timeoutMs);
}

// What a `git add -A && git commit` would add now (staged, unstaged and new files git does not ignore). It becomes a
// commit object made with a copy of the index, which no ref points to and git's gc removes; the repo's index, refs
// and files stay as they are. gitleaks reads that commit's patch, so file paths, line numbers and .gitleaks.toml
// work as for any commit. Findings have commit "". timeoutMs covers the git steps and gitleaks together.
export function gitleaksUncommitted(
  dir,
  { timeoutMs = GITLEAKS_TIMEOUT_MS } = {},
) {
  const until = Date.now() + timeoutMs;
  const late = (what) =>
    new Error(`${what} ran past the time limit (${timeoutMs / 1000} s)`);
  // git with the time left; none left, or git ran out of it, is the time-limit error
  const timed = (cwd, args, opts = {}) => {
    const left = until - Date.now();
    if (left <= 0) throw late(`git ${args[0]}`);
    const r = git(cwd, args, { ...opts, timeout: left });
    if (r.error?.code === "ETIMEDOUT") throw late(`git ${args[0]}`);
    if (r.error) throw new Error(`git could not run: ${r.error.message}`);
    return r;
  };
  let tmp;
  try {
    const t = timed(dir, ["rev-parse", "--show-toplevel"]);
    if (t.status !== 0) return noRepo(dir);
    const top = path.resolve(t.stdout.trim());
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ship-check-"));
    const index = path.join(tmp, "index");
    const real = path.resolve(
      top,
      timed(top, ["rev-parse", "--git-path", "index"]).stdout.trim(),
    );
    if (fs.existsSync(real)) fs.copyFileSync(real, index); // the copy keeps git's file times: only changed files are read
    const env = {
      ...process.env,
      GIT_INDEX_FILE: index,
      GIT_AUTHOR_NAME: "ship-check",
      GIT_AUTHOR_EMAIL: "ship-check@localhost",
      GIT_COMMITTER_NAME: "ship-check",
      GIT_COMMITTER_EMAIL: "ship-check@localhost",
    };
    const step = (args) => {
      const r = timed(top, args, { env });
      if (r.status !== 0)
        throw new Error(`git ${args[0]} failed: ${firstLine(r.stderr)}`);
      return r.stdout.trim();
    };
    step(["add", "-A"]);
    const tree = step(["write-tree"]);
    const head = timed(top, [
      "rev-parse",
      "-q",
      "--verify",
      "HEAD^{tree}",
    ]).stdout.trim();
    if (tree === head) return { findings: [] };
    const parent = head ? ["-p", "HEAD"] : [];
    const commit = step([
      "commit-tree",
      tree,
      ...parent,
      "-m",
      "ship-check: uncommitted changes",
    ]);
    const left = until - Date.now();
    if (left <= 0) throw late("gitleaks");
    return gitleaks(
      top,
      ["git", ".", `--log-opts=${commit} -1`],
      left,
      () => "",
    );
  } catch (e) {
    return { error: e.message };
  } finally {
    if (tmp) fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// ---- the deploy commands (the hook refuses them raw in a switched-on project; S2b's `deploy` runs them)
// A built-in deploy tool counts only where a command starts (not `npm i -g vercel`, `git checkout gh-pages`): the
// line's start or after ; & | ( ` " ' (a `bash -c "..."` keeps its quotes in the hook), then the shell's keywords
// (then, do, else, if ...), wrappers (sudo, env, bash -c, cmd /c ...) and VAR=value words, a package runner with its
// flags (npx -y, npx -p <package>, pnpm dlx, yarn, bunx ...), and a path to the program (./node_modules/.bin/). The
// tool's name may carry its package's version (wrangler@4.162.0, vercel@latest).
const AT = String.raw`(?<=(?:^|[;&|(\x60"'])\s*(?:(?:then|do|else|elif|if|while|until|sudo|env|exec|command|time|nohup|(?:bash|sh|zsh|pwsh|powershell)(?:\.exe)?\s+-\w*c|cmd(?:\.exe)?\s+\/c)\s+|[A-Za-z_]\w*=\S*\s+)*(?:(?:npx|pnpx|bunx|bun\s+x|(?:npm|pnpm)\s+exec|(?:pnpm|yarn)\s+dlx|pnpm|yarn)(?:\s+(?:(?:-p|--package)(?:\s+|=)[^\s;&|"'\x60]+|-[\w-]+))*(?:\s+--)?\s+)?(?:[^\s;&|"'\x60]*[/\\])?)`;
const VERSION = String.raw`(?:@[^\s;&|()"'\x60]*)?`;
// vercel deploys when it runs with flags only (a flag's value as `--token $T` too), with a folder as its first word
// (`vercel ./dist`, `vercel .`: a word that starts with . ~ / or holds a slash) or as `vercel deploy`, `vercel
// redeploy` or `vercel promote`; a subcommand (env, login, link, dev, pull, ls ...) is no deploy. A value flag's name
// is never read as a bare flag, so its value (`--cwd ./apps/web env ls`) is not taken for the folder.
const VERCEL_VALUE_NAME = String.raw`--?(?:token|scope|team|cwd|env|build-env|meta|regions|target|local-config|global-config|archive|[tSTebmAQ])`;
const VERCEL_VALUE_FLAG = String.raw`${VERCEL_VALUE_NAME}(?:\s+|=)[^\s;&|()"'\x60-][^\s;&|()"'\x60]*`;
const FOLDER_WORD = String.raw`(?:[.~/\\]|[^\s;&|()"'\x60-][^\s;&|()"'\x60]*[/\\])[^\s;&|()"'\x60]*`;
const BUILT_IN = [
  String.raw`wrangler${VERSION}\s+(?:pages\s+)?(?:deploy|publish)\b`,
  String.raw`vercel${VERSION}(?:\s+(?:${VERCEL_VALUE_FLAG}|(?!${VERCEL_VALUE_NAME}(?:[\s=]|$))--?[\w-]+(?:=[^\s;&|]*)?))*(?:\s+(?:(?:deploy|redeploy|promote(?!\s+status\b))\b|${FOLDER_WORD})|(?=\s*(?:$|[;&|)\n"'\x60])))`,
  String.raw`netlify(?:-cli)?${VERSION}\s+deploy\b`,
  String.raw`firebase(?:-tools)?${VERSION}\s+deploy\b`,
  String.raw`gh-pages${VERSION}(?![\w-])`,
  String.raw`fly(?:ctl)?\s+deploy\b`,
  String.raw`(?:npm|pnpm|yarn|bun)\s+run\s+deploy\b`,
].map((s) => new RegExp(AT + s, "m"));
const WRAPPER = /ship-check(?:\.mjs)?["']?\s+deploy\s+--[^;&|\n]*/g;
const literal = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The deploy command in command (built-in list plus config.deploy) and where it starts: { command, index }, or
// null. Comment lines and the `ship-check deploy -- …` wrapper never match; they are blanked to the same length, so
// index is the place in command. Quoted text is the caller's to blank (the hook's bareOf). Throws when
// config.deploy is not a list of strings.
export function findDeploy(command, config) {
  if (config?.deploy !== undefined && !strings(config.deploy))
    throw new Error(
      `"deploy" in ${fwd(CONFIG)} must be a list of strings, not ${shown(config.deploy)}`,
    );
  const blank = (s) => s.replace(/[^\n]/g, " ");
  const text = String(command)
    .replace(/^\s*#.*$/gm, blank)
    .replace(WRAPPER, blank);
  for (const re of BUILT_IN) {
    const m = re.exec(text);
    if (m) return { command: m[0].trim(), index: m.index };
  }
  for (const own of config?.deploy ?? []) {
    const m = new RegExp(
      `(?<=^|[\\s;&|(])${literal(own)}(?=$|[\\s;&|)])`,
      "m",
    ).exec(text);
    if (m) return { command: own, index: m.index };
  }
  return null;
}
// The deploy command in command, or null (findDeploy without the place)
export const deployMatch = (command, config) =>
  findDeploy(command, config)?.command ?? null;

// ---- build: what a deploy of the folder uploads
// The hosts' own files may be dotfiles or sit in a dot folder (_headers and _redirects are not dotfiles): Cloudflare's
// .assetsignore, GitHub Pages' .nojekyll, Apache's .htaccess. Every other dotfile or dot folder is a problem
const HOST_DOTFILES = new Set([".assetsignore", ".nojekyll", ".htaccess"]);
const HOST_DOTDIRS = new Set([".well-known"]);
// Why a file must not be uploaded ({ file, why }, its path relative to the folder), or null. A folder's problem is
// named on the folder ("node_modules/").
function uploadProblem(rel) {
  const parts = rel.split("/");
  const name = parts.at(-1);
  for (let i = 0; i < parts.length - 1; i++) {
    const file = `${parts.slice(0, i + 1).join("/")}/`;
    if (parts[i] === ".git")
      return { file, why: "git's folder: the project's history and config" };
    if (parts[i] === "node_modules")
      return { file, why: "installed packages, not site files" };
    if (parts[i].startsWith(".") && !HOST_DOTDIRS.has(parts[i]))
      return { file, why: "a hidden folder" };
  }
  if (/^\.env(\..*)?$/i.test(name))
    return { file: rel, why: "an env file: it holds the project's secrets" };
  if (/\.map$/i.test(name))
    return { file: rel, why: "a source map: it gives away the source code" };
  if (/\.(bak|old)$/i.test(name))
    return { file: rel, why: "a backup copy of a file" };
  if (secretFile(rel)) return { file: rel, why: "a key or secrets file" };
  if (name.startsWith(".") && !HOST_DOTFILES.has(name))
    return { file: rel, why: "a dotfile (hidden file)" };
  return null;
}
// Every file under root, relative, with forward slashes, sorted
function walkFiles(root) {
  const out = [];
  const go = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) go(p);
      else out.push(fwd(path.relative(root, p)));
    }
  };
  go(root);
  return out.sort();
}
// A name a build tool puts into the page (a public prefix) that says it is a secret
const PUBLIC_SECRET =
  /^(?:VITE_|NEXT_PUBLIC_|PUBLIC_|REACT_APP_)\w*?(?:KEY|SECRET|TOKEN|PASSWORD|service_role)/i;
// A key its provider means to be in the page (Supabase's anon key, a publishable key as Stripe's or Clerk's,
// Firebase's web API key), unless the name also says secret, private, password or service role
const PUBLIC_BY_DESIGN = /(?:ANON_KEY|PUBLISHABLE_KEY|FIREBASE_\w*API_?KEY)$/i;
const SECRET_WORD = /SECRET|PRIVATE|PASSWORD|SERVICE_ROLE/i;
const publicByDesign = (name) =>
  PUBLIC_BY_DESIGN.test(name) && !SECRET_WORD.test(name);
// The env files build tools read (.env, .env.local, .env.<mode>...; not the example), in each folder from the build
// folder's parent up to projectDir, and in projectDir. Names only: no value goes into a message. Not a name public
// by design, nor one in publicNames (the config's list of names accepted on purpose).
function publicSecretNames(folder, projectDir, publicNames) {
  const inside = (d) => {
    const r = path.relative(projectDir, d);
    return !r.startsWith("..") && !path.isAbsolute(r);
  };
  const dirs = [];
  for (let d = path.dirname(folder); inside(d); d = path.dirname(d)) {
    dirs.push(d);
    if (!path.relative(projectDir, d)) break;
  }
  if (!dirs.some((d) => !path.relative(projectDir, d))) dirs.push(projectDir);
  const problems = [];
  for (const dir of dirs) {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      if (
        !/^\.env(\..+)?$/i.test(name) ||
        /\.(example|sample|template|dist|defaults?)$/i.test(name) ||
        !fs.statSync(file).isFile()
      )
        continue;
      for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const key = line.match(/^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=/)?.[1];
        if (
          key &&
          PUBLIC_SECRET.test(key) &&
          !publicByDesign(key) &&
          !publicNames.includes(key)
        )
          problems.push({
            file: fwd(path.relative(projectDir, file)),
            why:
              `${key}: a secret's name with a public prefix; the build puts its value into the page for anyone ` +
              "to read (keep the secret on a server, without the prefix)",
          });
      }
    }
  }
  return problems;
}
// { files, problems: [{ file, why }], cannot: [why] }: every file in folder (relative, sorted); the files that must
// not be uploaded; keys inside built files (gitleaks dir, masked, with projectDir's .gitleaks.toml); public-prefixed
// secret names in the env files (the config's "publicNames" accepts names on purpose). cannot: what could not be
// checked (gitleaks missing or failed).
export function buildCheck(folder, { projectDir } = {}) {
  const root = path.resolve(folder);
  if (!fs.existsSync(root))
    throw new Error(`${fwd(root)} does not exist (build the project first?)`);
  if (!fs.statSync(root).isDirectory())
    throw new Error(`${fwd(root)} is not a folder`);
  const project = path.resolve(
    projectDir ?? gitTop(root) ?? path.dirname(root),
  );
  const files = walkFiles(root);
  const problems = [];
  for (const f of files) {
    const p = uploadProblem(f);
    if (p && !problems.some((x) => x.file === p.file)) problems.push(p);
  }
  const cannot = [];
  const toml = path.join(project, ".gitleaks.toml");
  const res = gitleaks(
    project,
    ["dir", root, ...(fs.existsSync(toml) ? ["--config", toml] : [])],
    GITLEAKS_TIMEOUT_MS,
  );
  if (res.error) cannot.push(`key scan of the built files: ${res.error}`);
  else
    for (const f of res.findings)
      problems.push({
        file: fwd(path.relative(root, path.resolve(project, f.file))),
        why: `line ${f.line}: a key (${f.rule}) ${f.masked} in a built file; take it out of the build and revoke it`,
      });
  const publicNames = readConfig(project)?.publicNames ?? [];
  problems.push(...publicSecretNames(root, project, publicNames));
  return { files, problems, cannot };
}

// ---- live: what the live address serves
const HIDDEN_PATHS = [
  "/.env",
  "/.env.local",
  "/.env.production",
  "/.git/HEAD",
  "/.git/config",
  "/.dev.vars",
  "/wrangler.jsonc",
  "/package.json",
];
const LIVE_TIMEOUT_MS = 10000;
const secretLines = (body) =>
  /^ref: refs\//m.test(body) || /^\s*(?:export\s+)?\w*KEY\w*\s*=/im.test(body);
// { problems: [{ where, why }], cannot: [{ where, why }], lines }: each hidden path and the source map of the root
// page's first script give 404 or 403, or a 200 equal to the root page (an app's fallback) with no `ref: refs/` or
// KEY= lines; the root page has the security headers. lines: each path asked and its status. Each request has
// timeoutMs; an address that does not answer is in cannot.
export async function liveCheck(
  url,
  { fetch: get = globalThis.fetch, timeoutMs = LIVE_TIMEOUT_MS } = {},
) {
  let base;
  try {
    base = new URL(url);
  } catch {
    throw new Error(`"${url}" is not a web address`);
  }
  if (!/^https?:$/.test(base.protocol))
    throw new Error(`"${url}" is not an http or https address`);
  const ask = async (target) => {
    const res = await get(target, {
      redirect: "follow",
      signal: AbortSignal.timeout(timeoutMs),
      headers: { "User-Agent": "ship-check" },
    });
    return { res, body: await res.text() };
  };
  const failed = (e) =>
    e?.name === "TimeoutError"
      ? `no answer within ${Math.round(timeoutMs / 1000)} s`
      : String(e?.cause?.code ?? e?.cause?.message ?? e?.message ?? e);
  const problems = [],
    cannot = [],
    lines = [];
  let root;
  try {
    root = await ask(base.href);
  } catch (e) {
    cannot.push({ where: base.href, why: `could not reach it: ${failed(e)}` });
    return { problems, cannot, lines };
  }
  lines.push(`/ ${root.res.status}`);
  if (!root.res.ok)
    cannot.push({
      where: "/",
      why: `the root page gave ${root.res.status}; is the address right?`,
    });

  // the root page's headers
  const h = (name) => root.res.headers.get(name);
  const header = (why) => problems.push({ where: "/", why });
  if (!h("strict-transport-security"))
    header(
      "no Strict-Transport-Security header (a browser may reach the site over plain http)",
    );
  if (!/^\s*nosniff\s*$/i.test(h("x-content-type-options") ?? ""))
    header("no X-Content-Type-Options: nosniff header");
  if (
    !/(^|;)\s*frame-ancestors\b/i.test(h("content-security-policy") ?? "") &&
    !h("x-frame-options")
  )
    header(
      "no Content-Security-Policy frame-ancestors and no X-Frame-Options (any site can frame the page)",
    );
  if (!h("referrer-policy")) header("no Referrer-Policy header");
  if ((h("access-control-allow-origin") ?? "").trim() === "*")
    header(
      "Access-Control-Allow-Origin: * (any site can read the answers through a visitor's browser)",
    );
  if (h("x-powered-by"))
    header(
      `X-Powered-By: ${h("x-powered-by")} (it names the server software; remove it)`,
    );

  // the hidden paths, and the source map of the root page's first script on the same address
  const targets = HIDDEN_PATHS.map((p) => new URL(p, base));
  const src = root.body.match(
    /<script\b[^>]*?\bsrc\s*=\s*["']?([^"'\s>]+)/i,
  )?.[1];
  if (!src) lines.push("source map: no script on the root page, not checked");
  else {
    const script = new URL(src, root.res.url || base.href);
    if (script.origin !== base.origin)
      lines.push(
        `source map: the first script is on ${script.origin}, not checked`,
      );
    else targets.push(new URL(`${script.pathname}.map`, base));
  }
  const rootBody = root.body.trim();
  await Promise.all(
    targets.map(async (t) => {
      const where = t.pathname;
      let a;
      try {
        a = await ask(t.href);
      } catch (e) {
        cannot.push({ where, why: `could not ask it: ${failed(e)}` });
        return;
      }
      const { status } = a.res;
      // sent on to another path (a login page, say): this path serves nothing itself
      const to = a.res.redirected ? new URL(a.res.url).pathname : where;
      lines.push(
        `${where} ${status}${to !== where ? ` (sent on to ${to})` : ""}`,
      );
      if (status === 404 || status === 403 || to !== where) return;
      if (status === 200 && a.body.trim() === rootBody && !secretLines(a.body))
        return;
      problems.push({
        where,
        why:
          status === 200
            ? "serves a file (200, not the root page): anyone can download it"
            : `gave ${status}, not 404 or 403: check what it serves`,
      });
    }),
  );
  lines.sort();
  return { problems, cannot, lines };
}

// ---- init: the ignore lines and the config
function init(cwd) {
  const top = gitTop(cwd);
  if (!top) {
    console.error(
      `ship-check init: ${fwd(cwd)} is in no git repository. Run \`git init\` first.`,
    );
    return 2;
  }
  console.log(`ship-check init in ${fwd(top)}`);
  const gi = path.join(top, ".gitignore");
  const had = fs.existsSync(gi) ? fs.readFileSync(gi, "utf8") : "";
  const eol = had.includes("\r\n") ? "\r\n" : "\n";
  const rows = had ? had.split(/\r?\n/) : [];
  if (rows.at(-1) === "") rows.pop();
  const has = (l) => rows.some((r) => r.trim() === l);
  const missing = IGNORE_LINES.filter((l) => !has(l));
  const tail = [];
  for (const l of missing) {
    // .env.* goes before an !.env.example already there: after it, it would ignore the example too
    const example = rows.findIndex((r) => r.trim() === "!.env.example");
    if (l === ".env.*" && example >= 0) rows.splice(example, 0, l);
    else tail.push(l);
  }
  if (missing.length) {
    if (tail.length)
      rows.push(
        ...(rows.length ? [""] : []),
        "# secrets and local env files",
        ...tail,
      );
    fs.writeFileSync(gi, rows.join(eol) + eol);
    console.log(`.gitignore: added ${missing.join(", ")}`);
  } else console.log(".gitignore: already holds every ignore line");
  const cfg = path.join(top, CONFIG);
  if (fs.existsSync(cfg)) console.log(`${fwd(CONFIG)}: kept (already there)`);
  else {
    fs.mkdirSync(path.dirname(cfg), { recursive: true });
    fs.writeFileSync(cfg, '{ "build": null, "url": null }\n');
    console.log(
      `${fwd(CONFIG)}: written; the project's pushes and deploys now run the baseline`,
    );
  }
  if (git(top, ["check-ignore", "-q", "--no-index", fwd(CONFIG)]).status === 0)
    console.log(
      `note: git ignores ${fwd(CONFIG)}; the baseline works, but other clones of the project lack it`,
    );
  console.log(
    'Next: set "build" (the folder a deploy uploads, or false) and "url" (the live address, or false) in ' +
      `${fwd(CONFIG)} before \`ship-check deploy\`, and run \`ship-check push --full\` once.`,
  );
  return 0;
}

// ---- push --full: npm audit in each folder with a package-lock.json
function audit(top) {
  const r = git(top, [
    "ls-files",
    "-z",
    "--cached",
    "--others",
    "--exclude-standard",
  ]);
  if (r.status !== 0)
    return {
      cannot: [
        `could not list the files: git ls-files: ${firstLine(r.stderr)}`,
      ],
    };
  const folders = [
    ...new Set(
      r.stdout
        .split("\0")
        .filter(
          (f) =>
            /(^|\/)package-lock\.json$/.test(f) &&
            !/(^|\/)node_modules\//.test(f),
        )
        .map((f) => path.posix.dirname(f)),
    ),
  ].sort();
  if (!folders.length)
    return {
      lines: [
        "dependency audit: npm only, and no package-lock.json here: not checked",
      ],
    };
  const npm = findNpm();
  if (!npm)
    return {
      cannot: [
        "dependency audit: npm not found (install Node.js, which brings npm)",
      ],
    };
  const limit = auditTimeoutMs();
  const lines = ["dependency audit (npm audit --audit-level=high; npm only):"],
    found = [],
    cannot = [];
  for (const folder of folders) {
    // the report goes to a file: npm audit --json into a pipe once ran past 110 s here, while a plain run took 1 s
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ship-check-audit-"));
    try {
      const outFile = path.join(tmp, "out.json"),
        errFile = path.join(tmp, "err.txt");
      const out = fs.openSync(outFile, "w"),
        err = fs.openSync(errFile, "w");
      let a;
      try {
        a = spawnSync(
          npm[0],
          [...npm.slice(1), "audit", "--audit-level=high", "--json"],
          {
            cwd: path.join(top, folder),
            stdio: ["ignore", out, err],
            timeout: limit,
            windowsHide: true,
          },
        );
      } finally {
        fs.closeSync(out);
        fs.closeSync(err);
      }
      if (a.error?.code === "ETIMEDOUT") {
        cannot.push(
          `npm audit in ${folder} ran past its time limit (${Math.round(limit / 1000)} s; ` +
            "SHIP_CHECK_AUDIT_TIMEOUT_MS sets it in ms)",
        );
        continue;
      }
      if (a.error) {
        cannot.push(
          `npm audit in ${folder} could not start: ${a.error.message}`,
        );
        continue;
      }
      let report;
      try {
        report = JSON.parse(fs.readFileSync(outFile, "utf8"));
      } catch {
        cannot.push(
          `npm audit in ${folder} gave no readable report: ${firstLine(fs.readFileSync(errFile, "utf8"))}`,
        );
        continue;
      }
      const counts = report.metadata?.vulnerabilities;
      if (report.error || !counts) {
        cannot.push(
          `npm audit in ${folder} failed: ${firstLine(report.error?.summary ?? fs.readFileSync(errFile, "utf8"))}`,
        );
        continue;
      }
      const bad = Object.values(report.vulnerabilities ?? {}).filter((v) =>
        ["high", "critical"].includes(v.severity),
      );
      const n = (counts.high ?? 0) + (counts.critical ?? 0);
      if (n)
        found.push(
          `${folder}: ${n} high or critical (${bad.map((v) => `${v.name} ${v.severity}`).join(", ")}); ` +
            "`npm audit` there says how to fix",
        );
      else lines.push(`  ${folder}: no high or critical finding`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  return { lines, found, cannot };
}

// ---- push --full: GitHub's secret scanning and push protection
// gh's usable logins on github.com and the active one, from `gh auth status`. gh 2.40+ lists one block per login:
// "Logged in to", "Failed to log in to" or "Timeout trying to log in to" "github.com account <login>", then
// "Active account: true|false"; older gh: one "Logged in to github.com as <login>". A failed or timed-out login is
// not usable but can be the active one. Its text is read whatever its exit code: it exits 1 when any login failed.
// null when gh auth status could not run or listed no login: then nothing is known about the accounts.
function ghAccounts(gh, top) {
  const st = run(gh, ["auth", "status", "--hostname", "github.com"], {
    cwd: top,
    timeout: GH_TIMEOUT_MS,
  });
  const blocks = [];
  let active = null,
    marked = false;
  for (const l of `${st.stdout ?? ""}\n${st.stderr ?? ""}`.split(/\r?\n/)) {
    const acc = l.match(
      /(Logged in to|Failed to log in to|Timeout trying to log in to) github\.com (?:account|as) ([\w-]+)/,
    );
    if (acc) blocks.push({ login: acc[2], ok: acc[1] === "Logged in to" });
    else if (/Active account: /.test(l)) {
      marked = true;
      if (/Active account: true/.test(l) && blocks.length)
        active = blocks.at(-1).login;
    }
  }
  if (st.error || !blocks.length) return null;
  if (!marked && blocks.length === 1) active = blocks[0].login;
  return { accounts: blocks.filter((b) => b.ok).map((b) => b.login), active };
}
// One `gh api repos/<full>`: { repo } or { error }. env undefined: as the active account; else GH_TOKEN of a login.
function ghRepo(gh, top, full, env) {
  const a = run(gh, ["api", `repos/${full}`], {
    cwd: top,
    timeout: GH_TIMEOUT_MS,
    env,
  });
  if (a.error || a.status !== 0)
    return {
      error: `gh api failed: ${firstLine(a.error?.message || a.stderr)} (signed in? gh auth status)`,
    };
  try {
    return { repo: JSON.parse(a.stdout) };
  } catch {
    return { error: "gh api gave no readable answer" };
  }
}
const privateRepo = (repo) =>
  repo.private || (repo.visibility && repo.visibility !== "public");
function githubSettings(top) {
  const r = git(top, ["remote", "-v"]);
  const urls =
    r.status === 0
      ? r.stdout.split(/\r?\n/).filter((l) => l.endsWith("(fetch)"))
      : [];
  const pick = [urls.find((l) => l.startsWith("origin\t")), ...urls].find(
    (l) => l && /github\.com[/:]/.test(l),
  );
  const m = pick?.match(
    /github\.com[/:]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?\s+\(fetch\)$/,
  );
  if (!m) return { lines: ["GitHub settings: not checked: no GitHub remote"] };
  const full = `${m[1]}/${m[2]}`;
  const gh = findGh();
  if (!gh)
    return {
      cannot: [
        `GitHub settings of ${full}: gh is not installed (${INSTALL_GH}, then gh auth login)`,
      ],
    };
  // First as the active account. Only the repo's admins see these settings, so when that read fails or misses them,
  // gh reads as the owner when it holds that login: its token from `gh auth token --user` in GH_TOKEN, the active
  // account left as it is. Else the answer says which account read, when gh auth status could tell.
  const owner = m[1];
  const same = (login) => login?.toLowerCase() === owner.toLowerCase();
  let read = ghRepo(gh, top, full),
    who = null;
  const notes = [];
  const acc =
    read.error || (!privateRepo(read.repo) && !read.repo.security_and_analysis)
      ? ghAccounts(gh, top)
      : null;
  if (acc) {
    const { accounts, active } = acc;
    who = active;
    const login = accounts.find(same);
    if (login && !same(active)) {
      const t = run(
        gh,
        ["auth", "token", "--hostname", "github.com", "--user", login],
        { cwd: top, timeout: GH_TIMEOUT_MS },
      );
      // No token: the active account's read stands, with one note
      if (t.error || t.status !== 0 || !t.stdout.trim())
        notes.push(
          `note: could not read the gh token of ${login}, the owner's login (gh auth token --user ${login}: ` +
            `${firstLine(t.error?.message || t.stderr)}); the GitHub settings below are as ${active} read them`,
        );
      else {
        read = ghRepo(gh, top, full, {
          ...process.env,
          GH_TOKEN: t.stdout.trim(),
        });
        who = login;
      }
    }
  }
  if (read.error)
    return {
      lines: notes,
      cannot: [`GitHub settings of ${full}: ${read.error}`],
    };
  const { repo } = read;
  if (privateRepo(repo))
    return {
      lines: [
        ...notes,
        `GitHub settings: not checked: ${full} is private (secret scanning on a private repo is not in GitHub Free)`,
      ],
    };
  // An organization is no login: only admin rights on the repo show the settings, so no advice to log in as it
  const org = repo.owner?.type === "Organization";
  const notOwner = !who
    ? ""
    : org
      ? `read as ${who}: `
      : same(who)
        ? ""
        : `read as ${who}, not the owner ${owner}: `;
  const sa = repo.security_and_analysis;
  if (!sa)
    return {
      lines: notes,
      cannot: [
        org && notOwner
          ? `GitHub settings of ${full}: ${notOwner}can't see these settings (it needs admin rights on ${full})`
          : notOwner
            ? `GitHub settings of ${full}: ${notOwner}can't see these settings (only the repo's admins can read ` +
              `them${notes.length ? "" : `; with a gh login of ${owner} (gh auth login), ship-check reads as the owner`})`
            : `GitHub settings of ${full}: gh's answer holds no secret scanning or push protection setting ` +
              "(only the repo's admins can read them)",
      ],
    };
  const lines = [
      ...notes,
      `GitHub settings of ${full}${who ? ` (read as ${who})` : ""}:`,
    ],
    found = [],
    cannot = [];
  for (const [key, label] of [
    ["secret_scanning", "secret scanning"],
    ["secret_scanning_push_protection", "push protection"],
  ]) {
    const status = sa[key]?.status;
    if (status === "enabled") lines.push(`  ${label}: enabled`);
    else if (!status)
      cannot.push(
        `GitHub settings of ${full}: ${notOwner}gh's answer holds no ${label} setting`,
      );
    else
      found.push(
        `${label} is ${status} on ${full}: turn it on at https://github.com/${full}/settings/security_analysis`,
      );
  }
  return { lines, found, cannot };
}

// ---- push: key files git tracks, gitleaks over the outgoing commits (or all), and with --full the audit and GitHub
function push(cwd, { history, full }) {
  const top = gitTop(cwd);
  if (!top) {
    console.error(`ship-check push: ${fwd(cwd)} is in no git repository`);
    return 2;
  }
  console.log(`ship-check push in ${fwd(top)}`);
  const found = [],
    cannot = [];
  const ls = git(top, ["ls-files", "-z"]);
  if (ls.status !== 0)
    cannot.push(
      `could not list the tracked files: git ls-files: ${firstLine(ls.stderr)}`,
    );
  else {
    const keys = ls.stdout.split("\0").filter(Boolean).filter(secretFile);
    if (keys.length)
      found.push(
        ...keys.map(
          (f) =>
            `${f}: a key or secrets file that git tracks (git rm --cached it, keep it in .gitignore, and change what it held)`,
        ),
      );
    else console.log("key files git tracks: none");
  }
  const what = history ? "every commit" : "the commits no remote has yet";
  if (git(top, ["rev-parse", "-q", "--verify", "HEAD"]).status !== 0)
    console.log("secret scan: no commit yet");
  else {
    const res = history ? gitleaksHistory(top) : gitleaksRange(top, ["HEAD"]);
    if (res.error) cannot.push(`secret scan (gitleaks, ${what}): ${res.error}`);
    else if (!res.findings.length)
      console.log(`secret scan (gitleaks, ${what}): no finding`);
    else
      found.push(
        ...res.findings.map(
          (f) =>
            `${f.file}:${f.line} ${f.rule} ${f.masked} in commit ${f.commit || "(uncommitted)"} (a real key: take it ` +
            "out of the commits and revoke it; a fake or public value: allow it in .gitleaks.toml with its reason)",
        ),
      );
  }
  if (full)
    for (const part of [audit(top), githubSettings(top)]) {
      for (const l of part.lines ?? []) console.log(l);
      found.push(...(part.found ?? []));
      cannot.push(...(part.cannot ?? []));
    }
  return result(found, cannot);
}

// The findings and cannot-check lines, the result line; the exit code
function result(found, cannot) {
  if (found.length)
    console.log(
      `findings (${found.length}):\n${found.map((f) => `  ${f}`).join("\n")}`,
    );
  if (cannot.length)
    console.log(
      `cannot check (${cannot.length}):\n${cannot.map((f) => `  ${f}`).join("\n")}`,
    );
  const code = found.length ? 1 : cannot.length ? 2 : 0;
  console.log(
    `result: ${["pass", "findings", "cannot check"][code]} (exit ${code})`,
  );
  return code;
}

// ---- build <folder>: the file list (a problem folder as one line), then the problems
function build(folder, projectDir) {
  const res = buildCheck(folder, { projectDir });
  const shown = fwd(path.relative(process.cwd(), path.resolve(folder))) || ".";
  console.log(
    `ship-check build ${shown}: ${res.files.length} files it would upload`,
  );
  const dirs = res.problems.map((p) => p.file).filter((f) => f.endsWith("/"));
  const listed = new Set();
  for (const f of res.files) {
    const dir = dirs.find((d) => f.startsWith(d));
    if (!dir) console.log(`  ${f}`);
    else if (!listed.has(dir)) {
      listed.add(dir);
      const n = res.files.filter((x) => x.startsWith(dir)).length;
      console.log(`  ${dir} (${n} files)`);
    }
  }
  return result(
    res.problems.map((p) => `${p.file}: ${p.why}`),
    res.cannot,
  );
}

// ---- live <url>: each path asked and its status, then the problems
async function live(url) {
  console.log(`ship-check live ${url}`);
  const res = await liveCheck(url);
  for (const l of res.lines) console.log(`  ${l}`);
  return result(
    res.problems.map((p) => `${p.where}: ${p.why}`),
    res.cannot.map((p) => `${p.where}: ${p.why}`),
  );
}

// ---- deploy -- <command>: the build check, the command, the live probe, from .claude/ship-check.json
// One word holding a space ("npm run deploy") runs in the shell; several words run without one, except a .cmd or
// .bat program on Windows, which only cmd can start (its words quoted for cmd).
function runCommand(words) {
  const opts = { stdio: "inherit" };
  if (words.length === 1 && /\s/.test(words[0]))
    return spawnSync(words[0], { ...opts, shell: true });
  if (WIN && !/[\\/]/.test(words[0]) && !path.extname(words[0])) {
    const exts = (process.env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
      .split(";")
      .filter(Boolean);
    const hit = pathDirs()
      .flatMap((d) => exts.map((x) => path.join(d, words[0] + x)))
      .find((f) => fs.existsSync(f));
    if (hit && /\.(cmd|bat)$/i.test(hit)) {
      const q = (w) =>
        /[\s"&|<>^()%!,;=]/.test(w) ? `"${w.replace(/"/g, '""')}"` : w;
      return spawnSync(words.map(q).join(" "), { ...opts, shell: true });
    }
  }
  return spawnSync(words[0], words.slice(1), opts);
}
async function deploy(words) {
  if (!words.length) {
    console.error(`ship-check deploy: no command after --\n${USAGE}`);
    return 2;
  }
  const line = words.join(" ");
  if (process.env.SHIP_CHECK === "off") {
    console.log(
      `ship-check deploy: off (SHIP_CHECK=off): running \`${line}\` with no checks`,
    );
    const r = runCommand(words);
    if (r.error) {
      console.error(
        `ship-check deploy: could not start the command: ${r.error.message}`,
      );
      return 2;
    }
    return r.status ?? 1;
  }
  const top = gitTop(process.cwd());
  const config = readConfig(process.cwd());
  if (!config) {
    console.error(
      `ship-check deploy: no ${fwd(CONFIG)} in ${fwd(top ?? process.cwd())}: run \`ship-check init\` first`,
    );
    return 2;
  }
  const unset = [
    [
      "build",
      "the folder a deploy uploads, relative to the project's top folder",
    ],
    ["url", "the live address, https://..."],
  ].filter(([k]) => config[k] === null || config[k] === undefined);
  if (unset.length) {
    console.error(
      `ship-check deploy: ${unset.map(([k]) => `"${k}"`).join(" and ")} not set in ${fwd(CONFIG)}. Set ` +
        `${unset.map(([k, what]) => `"${k}" to ${what}, or false on purpose`).join("; ")}. Nothing ran.`,
    );
    return 2;
  }
  if (config.build !== false && typeof config.build !== "string") {
    console.error(
      `ship-check deploy: "build" in ${fwd(CONFIG)} must be a folder or false, not ${JSON.stringify(config.build)}`,
    );
    return 2;
  }
  if (config.url !== false && typeof config.url !== "string") {
    console.error(
      `ship-check deploy: "url" in ${fwd(CONFIG)} must be an address or false, not ${JSON.stringify(config.url)}`,
    );
    return 2;
  }
  if (config.build === false)
    console.log('build check: skipped ("build" is false in the config)');
  else {
    const code = build(path.resolve(top, config.build), top);
    if (code !== 0) {
      console.log(
        `ship-check deploy: stopped before \`${line}\`: the build check did not pass`,
      );
      return code;
    }
  }
  console.log(`ship-check deploy: running \`${line}\``);
  const r = runCommand(words);
  if (r.error) {
    console.error(
      `ship-check deploy: could not start the command: ${r.error.message}`,
    );
    return 2;
  }
  if (r.status !== 0) {
    const code = r.status ?? 1;
    console.log(
      `ship-check deploy: the command failed (exit ${r.status ?? r.signal}); no live probe`,
    );
    return code;
  }
  if (config.url === false) {
    console.log('live probe: skipped ("url" is false in the config)');
    return 0;
  }
  return live(config.url);
}

const USAGE =
  "usage: ship-check.mjs init | push [--history] [--full] | build <folder> | live <url> | deploy -- <command>";
export async function main(argv) {
  const [sub, ...rest] = argv;
  if (sub === "init" && !rest.length) return init(process.cwd());
  if (
    ["push", "build", "live"].includes(sub) &&
    process.env.SHIP_CHECK === "off"
  ) {
    console.log(`ship-check ${sub}: off (SHIP_CHECK=off), nothing checked`);
    return 0;
  }
  if (sub === "push") {
    const bad = rest.filter((a) => !["--history", "--full"].includes(a));
    if (bad.length) {
      console.error(`ship-check push: unknown ${bad.join(" ")}\n${USAGE}`);
      return 2;
    }
    return push(process.cwd(), {
      history: rest.includes("--history"),
      full: rest.includes("--full"),
    });
  }
  if (sub === "build" && rest.length === 1) {
    const cwd = process.cwd();
    return build(rest[0], gitTop(path.resolve(rest[0])) ?? gitTop(cwd) ?? cwd);
  }
  if (sub === "live" && rest.length === 1) return live(rest[0]);
  if (sub === "deploy" && rest[0] === "--") return deploy(rest.slice(1));
  console.error(USAGE);
  return 2;
}

// Started as the script, not imported (by real path, as workers/download.mjs does)
const real = (p) => {
  try {
    return fs.realpathSync.native(p);
  } catch {
    return path.resolve(p);
  }
};
if (
  process.argv[1] &&
  real(process.argv[1]).toLowerCase() ===
    real(fileURLToPath(import.meta.url)).toLowerCase()
) {
  try {
    process.exitCode = await main(process.argv.slice(2));
  } catch (e) {
    console.error(`ship-check: ${e.message}`);
    process.exitCode = 2;
  }
}
