#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
// push-key-scan: a guard of the pre-tool dispatcher (hooks/dispatch-groups.json), for Bash and PowerShell.
// - `git push`: reads what the push would send (commits on the pushed branch that no remote has yet, plus the
//   uncommitted changes when the same command commits first) and asks before a push whose added lines hold a
//   key-shaped string (12 shapes: sk-ant-, ghp_, AKIA..., a private key block, a bot token...; and a 13th, a database
//   URL with a password) or that adds a key file (.env.*, .dev.vars, *.pem, *.key, id_ed25519, credentials,
//   .claude/settings.local.json: ship-check's secretFile). gitleaks (the broad scanner) runs over the same commits
//   and uncommitted changes, 10 s at most; when it fails or runs out of time the hook asks, saying the broad scan
//   could not run. gitleaks missing: a project switched on with `ship-check init` (it has .claude/ship-check.json)
//   asks, naming the install command; any other gets one note line and the push goes on (a push that sends no
//   commit gets neither). When git cannot read what the push sends (it could not start, ran past its time limit or
//   wrote too much) the hook asks; a ref git does not know passes, as the push itself will say so.
// - A deploy command (ship-check's findDeploy: wrangler deploy, vercel, npm run deploy... and the config's own
//   list) in a switched-on project is refused, naming `node ~/.claude/workers/ship-check.mjs deploy -- <command>`.
// - A broken .claude/ship-check.json (not JSON, or not of the config's shape) refuses a deploy or a push, naming the
//   file and what is wrong; other commands pass.
// Quoted text and comment lines are not commands (bareOf below). No model, no network. Fails closed: a check that
// throws stops the call (runHook failClosed; in the dispatcher a failed guard is a refusal).
// Switches: PUSH_KEY_SCAN=off turns the whole hook off; in the command (a prefix never reaches the hook's own
// environment) it skips the push scan. SHIP_CHECK=off, in the command or the environment, lets a deploy through.
// Tests fake gitleaks with SHIP_CHECK_GITLEAKS (workers/ship-check.mjs).
// Test: tests/test-push-key-scan.mjs
import {
  findDeploy,
  findGitleaks,
  gitleaksRange,
  gitleaksUncommitted,
  INSTALL_GITLEAKS,
  readConfig,
  secretFile,
} from "../workers/ship-check.mjs";
import { isMain, runHook } from "./lib/hook-io.mjs";

// gitleaks' time for one push, both of its runs together
const GITLEAKS_MS = 10000;

// Key shapes. A match must hold a digit (a long CSS class name that starts with sk- is not a key) and must
// not be a documented fake (AKIAIOSFODNN7EXAMPLE).
const SHAPES = [
  ["an Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI-style key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  [
    "a GitHub token",
    /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})/,
  ],
  ["a GitLab token", /\bglpat-[A-Za-z0-9_-]{20,}/],
  ["an npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
  ["a Slack token", /\bxox[baprs]-[A-Za-z0-9-]{10,}/],
  ["an AWS key id", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
  ["a Google API key", /\bAIza[0-9A-Za-z_-]{35}/],
  ["a Stripe key", /\b[sr]k_live_[0-9A-Za-z]{24,}/],
  ["a Hugging Face token", /\bhf_[A-Za-z0-9]{34,}/],
  ["a Telegram bot token", /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/],
  ["a private key", /-----BEGIN (?:[A-Z]+ )*PRIVATE KEY-----/],
];
const fake = (s) => /example|x{6}|0{10}/i.test(s);

export function keyIn(line) {
  for (const [kind, re] of SHAPES) {
    const m = line.match(re);
    if (m && (kind === "a private key" || /\d/.test(m[0])) && !fake(m[0]))
      return { kind, text: m[0] };
  }
  return null;
}

// The 13th shape, apart from the 12 (maskKeys keeps to those): a database URL with a password, which gitleaks' own
// rules miss. Not when the password is a placeholder (${DB_PASS}, $DB_PASS, %DB_PASS%, <password>, {{ pass }}) or a
// documented fake (the words docs and default containers use, or what `fake` above calls fake).
const DB_URL =
  /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|rediss?|amqps?):\/\/[^\s:@/'"`]*:([^\s@/'"`]+)@[^\s/'"`]+/;
const PLACEHOLDER =
  /^(?:\$\{[^}]*\}|\$\w+|%\w+%|<[^>]*>|\{\{.*\}\}|\*+|\.{3}|password|passw(?:or)?d|pass|pwd|secret|changeme|postgres|mysql|root|admin|guest|user|test)$/i;
export function dbUrlIn(line) {
  const m = line.match(DB_URL);
  if (!m || PLACEHOLDER.test(m[1]) || fake(m[1])) return null;
  return { kind: "a database URL with a password", text: m[0] };
}
const secretIn = (line) => keyIn(line) ?? dbUrlIn(line);

// The text with every real key replaced by "[<kind> hidden]" (reports and digests copy chat text, keys included)
export function maskKeys(text) {
  let out = String(text);
  for (const [kind, re] of SHAPES)
    out = out.replace(new RegExp(re.source, "g"), (m) =>
      (kind === "a private key" || /\d/.test(m)) && !fake(m)
        ? `[${kind} hidden]`
        : m,
    );
  return out;
}

// A file whose being pushed at all is the problem (ship-check's list). Examples and public keys are not.
export const keyFile = secretFile;

// The push: quoted text and comment lines blanked, a `bash -c` looked at whole
const LEAD = "(?:^|[\\s;&|(`\"'/\\\\])";
const PUSH = new RegExp(
  `${LEAD}git(?:\\.exe)?((?:\\s+-\\S+(?:\\s+[^\\s-]\\S*)?)*)\\s+push\\b([^;&|\\n]*)`,
);
// Blanked to the same length, so a place in it is the same place in the command; quoted text becomes one word ("___")
const bareOf = (command) => {
  const text = command.replace(/^\s*#.*$/gm, (s) => " ".repeat(s.length));
  const wrapped =
    /\b(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\.exe)?\s+(?:-\w*c\b|\/c\b)/i.test(
      text,
    );
  return wrapped
    ? text
    : text.replace(
        /"(?:[^"\\]|\\.)*"|'[^']*'/g,
        (q) => q[0] + "_".repeat(q.length - 2) + q[0],
      );
};

// NAME=off set by the command. A quoted value right after = is an assignment, other quoted text is not
const offIn = (command, name) => {
  const bare = command
    .replace(/^\s*#.*$/gm, "")
    .replace(/(=\s*)?("(?:[^"\\]|\\.)*"|'[^']*')/g, (m, eq) => (eq ? m : '""'));
  return new RegExp(
    `(?:^|[\\s;&|])(?:\\$env:)?${name}\\s*=\\s*["']?off\\b`,
    "im",
  ).test(bare);
};
export const offInCommand = (command) => offIn(command, "PUSH_KEY_SCAN");

const unquote = (s) => s.replace(/^["']|["']$/g, "");
const winPath = (p) =>
  process.platform === "win32" ? p.replace(/^\/([a-z])\//i, "$1:/") : p;
const CD =
  /(?:^|[;&|(]\s*|\n\s*)(?:cd|Set-Location|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g;

// What the command pushes: the folder (git -C, or the last cd before it), the source refs, whether it commits first
export function parsePush(command) {
  const bare = bareOf(command);
  const m = bare.match(PUSH);
  if (!m) return null;
  const at = m.index;
  const before = command.slice(0, at);
  let dir = null;
  for (const c of before.matchAll(CD)) dir = unquote(c[1]);
  const opt =
    m[1] &&
    command.slice(at, at + m[0].length).match(/\s-C\s+("[^"]+"|'[^']+'|\S+)/);
  if (opt)
    dir =
      dir && !path.isAbsolute(winPath(unquote(opt[1])))
        ? path.join(dir, unquote(opt[1]))
        : unquote(opt[1]);
  const args = m[2].trim().split(/\s+/).filter(Boolean);
  const all = args.includes("--all") || args.includes("--mirror");
  const positional = args.filter(
    (a) => !a.startsWith("-") && !/^["']_*["']$/.test(a),
  );
  const refs = positional
    .slice(1)
    .map((r) => r.replace(/^\+/, "").split(":")[0])
    .filter(Boolean);
  return {
    dir: dir && winPath(dir),
    refs: all ? ["--branches"] : refs.length ? refs : ["HEAD"],
    commitsFirst: /\bgit(?:\.exe)?\s+(?:-\S+\s+)*commit\b/.test(
      bare.slice(0, at),
    ),
  };
}

const GIT_MS = 5000;
const GIT_CAP = 64 * 1024 * 1024;
// git's output, or null when git answered with an error (not a repo, a ref it doesn't know). Throws GitFailed when
// git could not start, ran past its time limit or wrote more than the scan reads: what the push sends is unknown then.
class GitFailed extends Error {}
const git = (cwd, args) => {
  const r = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    timeout: GIT_MS,
    maxBuffer: GIT_CAP,
    windowsHide: true,
  });
  if (r.error?.code === "ETIMEDOUT")
    throw new GitFailed(
      `git ${args[0]} ran past its time limit (${GIT_MS / 1000} s)`,
    );
  if (r.error?.code === "ENOBUFS")
    throw new GitFailed(
      `git ${args[0]} wrote more than the scan reads (${GIT_CAP / 1024 / 1024} MB)`,
    );
  if (r.error) throw new GitFailed(`git could not start: ${r.error.message}`);
  return r.status === 0 ? r.stdout : null;
};

// The added lines of a unified diff, with the file each belongs to
function scanDiff(diff, hits) {
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "");
      if (file !== "/dev/null" && keyFile(file))
        hits.push({ kind: "a key file", file });
    } else if (line.startsWith("+")) {
      const k = secretIn(line);
      if (k) hits.push({ ...k, file });
    }
  }
}

// The shapes and key files in what the push sends: { hits, outgoing (some commit no remote has) }; null when git
// answers it can't read it (not a repo, or a ref git doesn't know: the push itself will say so); { error } when git
// could not start, ran past its time limit or wrote too much (the push must not pass unchecked then)
export function scan(push, cwd) {
  try {
    return scanWith(push, cwd);
  } catch (e) {
    if (e instanceof GitFailed) return { error: e.message };
    throw e;
  }
}
function scanWith(push, cwd) {
  const dir = push.dir ? path.resolve(cwd, push.dir) : cwd;
  const hits = [];
  const log = git(dir, [
    "log",
    "-p",
    "-U0",
    "--no-ext-diff",
    "--no-color",
    "--format=",
    ...push.refs,
    "--not",
    "--remotes",
  ]);
  if (log === null) return null;
  scanDiff(log, hits);
  if (push.commitsFirst) {
    scanDiff(
      git(dir, ["diff", "HEAD", "-U0", "--no-ext-diff", "--no-color"]) ?? "",
      hits,
    );
    for (const p of (
      git(dir, ["ls-files", "--others", "--exclude-standard"]) ?? ""
    )
      .split("\n")
      .filter(Boolean)) {
      if (keyFile(p)) {
        hits.push({ kind: "a key file", file: p });
        continue;
      }
      const full = path.join(dir, p);
      // a nested repo ("sub/") or a name git quoted (non-ASCII) is not a readable file here: skip it, don't crash
      const stat = fs.existsSync(full) ? fs.statSync(full) : null;
      if (!stat || !stat.isFile() || stat.size > 1024 * 1024) continue;
      for (const line of fs.readFileSync(full, "utf8").split("\n")) {
        const k = secretIn(line);
        if (k) hits.push({ ...k, file: p });
      }
    }
  }
  return { hits, outgoing: log.trim() !== "" };
}

// gitleaks over the same commits and uncommitted changes, GITLEAKS_MS for both runs together:
// { hits } or { error } (it failed or ran out of time)
export function broadScan(push, cwd, { outgoing }) {
  const dir = push.dir ? path.resolve(cwd, push.dir) : cwd;
  const until = Date.now() + GITLEAKS_MS;
  const runs = [
    ...(outgoing
      ? [(ms) => gitleaksRange(dir, push.refs, { timeoutMs: ms })]
      : []),
    ...(push.commitsFirst
      ? [(ms) => gitleaksUncommitted(dir, { timeoutMs: ms })]
      : []),
  ];
  const seen = new Set();
  const hits = [];
  for (const one of runs) {
    const left = until - Date.now();
    if (left <= 0)
      return {
        error: `gitleaks ran past its time limit (${GITLEAKS_MS / 1000} s)`,
      };
    const r = one(left);
    if (r.error) return { error: r.error };
    for (const f of r.findings) {
      const at = f.line ? `${f.file}:${f.line}` : f.file;
      if (seen.has(`${f.rule} ${at} ${f.masked}`)) continue;
      seen.add(`${f.rule} ${at} ${f.masked}`);
      hits.push({
        kind: `a secret (gitleaks rule ${f.rule})`,
        file: f.commit ? `${at}, commit ${f.commit}` : at,
        shown: f.masked,
      });
    }
  }
  return { hits };
}

// The project's .claude/ship-check.json from dir up: { config } (readConfig), { broken: what is wrong } when it is not
// JSON or not of the config's shape, or null when no folder from dir up holds one (no git is started then: this runs
// on every shell command)
function switchedOn(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".claude", "ship-check.json"))) {
      try {
        const config = readConfig(dir);
        return config && { config };
      } catch (e) {
        return { broken: e.message };
      }
    }
    if (path.dirname(d) === d) return null;
  }
}

// The folders a command runs in: the event's, then each one it cd's into (each cd taken from the one before)
function folders(command, cwd) {
  const dirs = [cwd];
  for (const c of command.matchAll(CD))
    dirs.push(path.resolve(dirs.at(-1), winPath(unquote(c[1]))));
  return dirs;
}

// The command with quoted text blanked (bareOf) and the wrapper `ship-check.mjs deploy -- ...` too, as its path may
// be quoted
const deployBare = (command) => {
  let bare = bareOf(command);
  for (const w of command.matchAll(
    /ship-check(?:\.mjs)?["']?\s+deploy\s+--[^;&|\n]*/g,
  ))
    bare =
      bare.slice(0, w.index) +
      " ".repeat(w[0].length) +
      bare.slice(w.index + w[0].length);
  return bare;
};
const deployOff = (command) =>
  process.env.SHIP_CHECK === "off" || offIn(command, "SHIP_CHECK");

// A deploy (the built-in list) or a push in a project whose .claude/ship-check.json is broken: the reason to refuse
// it, else null. Any other command passes, so a broken file does not stop every shell command in the project.
export function brokenConfigReason(command, cwd) {
  const push = !offInCommand(command) && parsePush(command);
  const deploy = !deployOff(command) && findDeploy(deployBare(command), null);
  if (!push && !deploy) return null;
  const dirs = folders(command, cwd);
  if (push?.dir) dirs.push(path.resolve(cwd, push.dir));
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const broken = switchedOn(dir)?.broken;
    if (broken)
      return (
        `[push-key-scan] This ${push ? "push" : "deploy"} is stopped: the project switched on ship-check, but its ` +
        `settings cannot be read: ${broken}. Fix the file, then run the command again. To run it without the checks, ` +
        `start the command with ${push ? "PUSH_KEY_SCAN=off" : "SHIP_CHECK=off"}.`
      );
  }
  return null;
}

const SEP = [";", "&", "|", "\n"];
// A deploy command run raw in a switched-on project: the reason to refuse it, else null. The folders looked at are
// the event's and each one the command cd's into; a folder whose config does not list the command is passed over.
export function deployReason(command, cwd) {
  if (deployOff(command)) return null;
  const bare = deployBare(command);
  for (const dir of folders(command, cwd)) {
    if (!fs.existsSync(dir)) continue;
    const config = switchedOn(dir)?.config;
    if (!config) continue;
    const hit = findDeploy(bare, config);
    if (!hit) continue;
    // the whole command the match sits in, as typed (bare keeps every place in the command), without the shell's
    // keyword before it (`then wrangler deploy` is run as `wrangler deploy`)
    const at = hit.index;
    const ends = SEP.map((c) =>
      bare.indexOf(c, at + hit.command.length),
    ).filter((i) => i >= 0);
    const typed = command
      .slice(
        Math.max(...SEP.map((c) => bare.lastIndexOf(c, at))) + 1,
        ends.length ? Math.min(...ends) : command.length,
      )
      .trim()
      .replace(/^(?:(?:then|do|else|elif|if|while|until)\s+)+/, "");
    return (
      `[push-key-scan] This project runs its deploys through ship-check (${dir.replace(/\\/g, "/")} is switched on: ` +
      "it has .claude/ship-check.json). Run it as\n" +
      `  node ~/.claude/workers/ship-check.mjs deploy -- ${typed}\n` +
      "It checks what the build folder uploads, runs the deploy, then probes the live address for exposed files. To " +
      "deploy without the check, start the command with SHIP_CHECK=off."
    );
  }
  return null;
}

const masked = (s) => `${s.slice(0, 8)}...`;
export function reason(hits) {
  const list = hits
    .slice(0, 5)
    .map((h) =>
      h.shown || h.text
        ? `${h.kind} in ${h.file} (${h.shown ?? masked(h.text)})`
        : `${h.kind}: ${h.file}`,
    );
  const more = hits.length > 5 ? ` and ${hits.length - 5} more` : "";
  return (
    `[push-key-scan] This push sends ${list.join("; ")}${more}. Once pushed, a key stays in the remote's history ` +
    "even after a fix, and has to be revoked. Allow only if it is a fake or meant to be public. If the key is real, take " +
    "it out of the commit (git reset or rebase) and revoke it. To push without this check, start the command with " +
    "PUSH_KEY_SCAN=off."
  );
}

// The push's verdict: { ask: [reasons], note } (nothing to say: an empty ask and no note)
function pushVerdict(command, cwd) {
  const out = { ask: [], note: null };
  if (offInCommand(command)) return out;
  const push = parsePush(command);
  if (!push) return out;
  const found = scan(push, cwd);
  if (!found) return out;
  if (found.error) {
    out.ask.push(
      `[push-key-scan] Could not read what this push sends: ${found.error}. Check the push by hand, or start the command with PUSH_KEY_SCAN=off.`,
    );
    return out;
  }
  const hits = [...found.hits];
  // a push that sends no commit (tags only, a deleted branch) has nothing for gitleaks to read
  if (found.outgoing || push.commitsFirst) {
    if (!findGitleaks()) {
      if (switchedOn(push.dir ? path.resolve(cwd, push.dir) : cwd))
        out.ask.push(
          `[push-key-scan] gitleaks is not installed, so the broad secret scan this project switched on (.claude/ship-check.json) could not run. Install it (${INSTALL_GITLEAKS}) and push again, or start the command with PUSH_KEY_SCAN=off.`,
        );
      else
        out.note = `[push-key-scan] Only the key shapes were checked: gitleaks, the broad secret scanner, is not installed (${INSTALL_GITLEAKS}).`;
    } else {
      const broad = broadScan(push, cwd, found);
      if (broad.error)
        out.ask.push(
          `[push-key-scan] The broad secret scan (gitleaks) could not run: ${broad.error}. Check the push by hand, or start the command with PUSH_KEY_SCAN=off.`,
        );
      else hits.push(...broad.hits);
    }
  }
  if (hits.length) out.ask.unshift(reason(hits));
  return out;
}

if (isMain(import.meta.url)) {
  runHook(
    "push-key-scan",
    (event) => {
      if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
      const command = String(event.tool_input?.command || "");
      const cwd = event.cwd || process.cwd();
      // a broken .claude/ship-check.json refuses a deploy or push once, with its own reason, and nothing else
      const broken = brokenConfigReason(command, cwd);
      const deny = broken ?? deployReason(command, cwd);
      const { ask, note } = broken
        ? { ask: [], note: null }
        : pushVerdict(command, cwd);
      const reasons = deny ? [deny, ...ask] : ask;
      if (!reasons.length && !note) return;
      // "ask" is the one verdict emit has no helper for (as in sql-guard)
      fs.writeSync(
        1,
        JSON.stringify({
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            ...(reasons.length && {
              permissionDecision: deny ? "deny" : "ask",
              permissionDecisionReason: reasons.join("\n\n"),
            }),
            ...(note && { additionalContext: note }),
          },
        }),
      );
    },
    { failClosed: true },
  );
}
