#!/usr/bin/env node
// push-key-scan: PreToolUse on Bash|PowerShell `git push`. Reads the lines the push would send (commits on the pushed
// branch that no remote has yet, plus uncommitted changes when the same command commits first) and asks before a push
// whose added lines hold a key-shaped string (sk-ant-, ghp_, AKIA..., a private key block, a bot token...) or that adds
// a key file (.env, id_ed25519, credentials). Quoted text and comment lines are not commands, as in code-review-gate's
// isPush. Rules only: no model, no network. Fails open. PUSH_KEY_SCAN=off disables it (in the command too: a prefix
// never reaches the hook's own environment).
// Test: tests/test-push-key-scan.mjs
import { runHook, isMain } from "./lib/hook-io.mjs";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// Key shapes. A match must hold a digit (a long CSS class name that starts with sk- is not a key) and must
// not be a documented fake (AKIAIOSFODNN7EXAMPLE).
const SHAPES = [
  ["an Anthropic key", /\bsk-ant-[A-Za-z0-9_-]{20,}/],
  ["an OpenAI-style key", /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}/],
  ["a GitHub token", /\b(?:gh[pousr]_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{22,})/],
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
    if (m && (kind === "a private key" || /\d/.test(m[0])) && !fake(m[0])) return { kind, text: m[0] };
  }
  return null;
}

// A file whose being pushed at all is the problem. Examples and public keys are not.
export function keyFile(p) {
  const name = p.split(/[\\/]/).pop();
  if (/^\.env(\..+)?$/i.test(name)) return !/\.(example|sample|template|dist|defaults?)$/i.test(name);
  if (/^id_(rsa|dsa|ecdsa|ed25519)(_sk)?$/.test(name)) return true;
  return /(^|[\\/])\.aws[\\/]credentials$/.test(p) || /^\.?credentials\.json$/i.test(name);
}

// The push, as code-review-gate's isPush finds it: quoted text and comment lines blanked, a `bash -c` looked at whole
const LEAD = "(?:^|[\\s;&|(`\"'/\\\\])";
const PUSH = new RegExp(`${LEAD}git(?:\\.exe)?((?:\\s+-\\S+(?:\\s+[^\\s-]\\S*)?)*)\\s+push\\b([^;&|\\n]*)`);
// Blanked to the same length, so a place in it is the same place in the command; quoted text becomes one word ("___")
const bareOf = (command) => {
  const text = command.replace(/^\s*#.*$/gm, (s) => " ".repeat(s.length));
  const wrapped = /\b(?:bash|sh|zsh|pwsh|powershell|cmd)(?:\.exe)?\s+(?:-\w*c\b|\/c\b)/i.test(text);
  return wrapped ? text : text.replace(/"(?:[^"\\]|\\.)*"|'[^']*'/g, (q) => q[0] + "_".repeat(q.length - 2) + q[0]);
};

// A quoted value right after = is an assignment, other quoted text is not (code-review-gate's offInCommand)
export function offInCommand(command) {
  const bare = command.replace(/^\s*#.*$/gm, "").replace(/(=\s*)?("(?:[^"\\]|\\.)*"|'[^']*')/g, (m, eq) => (eq ? m : '""'));
  return /(?:^|[\s;&|])(?:\$env:)?PUSH_KEY_SCAN\s*=\s*["']?off\b/im.test(bare);
}

const unquote = (s) => s.replace(/^["']|["']$/g, "");
const winPath = (p) => (process.platform === "win32" ? p.replace(/^\/([a-z])\//i, "$1:/") : p);

// What the command pushes: the folder (git -C, or the last cd before it), the source refs, whether it commits first
export function parsePush(command) {
  const bare = bareOf(command);
  const m = bare.match(PUSH);
  if (!m) return null;
  const at = m.index;
  const before = command.slice(0, at);
  let dir = null;
  for (const c of before.matchAll(/(?:^|[;&|(]\s*|\n\s*)(?:cd|Set-Location|pushd)\s+("[^"]+"|'[^']+'|[^\s;&|]+)/g)) dir = unquote(c[1]);
  const opt = m[1] && command.slice(at, at + m[0].length).match(/\s-C\s+("[^"]+"|'[^']+'|\S+)/);
  if (opt) dir = dir && !path.isAbsolute(winPath(unquote(opt[1]))) ? path.join(dir, unquote(opt[1])) : unquote(opt[1]);
  const args = m[2].trim().split(/\s+/).filter(Boolean);
  const all = args.includes("--all") || args.includes("--mirror");
  const positional = args.filter((a) => !a.startsWith("-") && !/^["']_*["']$/.test(a));
  const refs = positional.slice(1).map((r) => r.replace(/^\+/, "").split(":")[0]).filter(Boolean);
  return {
    dir: dir && winPath(dir),
    refs: all ? ["--branches"] : refs.length ? refs : ["HEAD"],
    commitsFirst: /\bgit(?:\.exe)?\s+(?:-\S+\s+)*commit\b/.test(bare.slice(0, at)),
  };
}

const git = (cwd, args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8", timeout: 5000, maxBuffer: 64 * 1024 * 1024, windowsHide: true });
  if (r.error || r.status !== 0) return null;
  return r.stdout;
};

// The added lines of a unified diff, with the file each belongs to
function scanDiff(diff, hits) {
  let file = "";
  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      file = line.slice(4).replace(/^b\//, "");
      if (file !== "/dev/null" && keyFile(file)) hits.push({ kind: "a key file", file });
    } else if (line.startsWith("+")) {
      const k = keyIn(line);
      if (k) hits.push({ ...k, file });
    }
  }
}

export function scan(push, cwd) {
  const dir = push.dir ? path.resolve(cwd, push.dir) : cwd;
  const hits = [];
  const log = git(dir, ["log", "-p", "-U0", "--no-ext-diff", "--no-color", "--format=", ...push.refs, "--not", "--remotes"]);
  if (log === null) return null; // not a repo, or a ref git doesn't know: the push itself will say so
  scanDiff(log, hits);
  if (push.commitsFirst) {
    scanDiff(git(dir, ["diff", "HEAD", "-U0", "--no-ext-diff", "--no-color"]) ?? "", hits);
    for (const p of (git(dir, ["ls-files", "--others", "--exclude-standard"]) ?? "").split("\n").filter(Boolean)) {
      if (keyFile(p)) { hits.push({ kind: "a key file", file: p }); continue; }
      const full = path.join(dir, p);
      // a nested repo ("sub/") or a name git quoted (non-ASCII) is not a readable file here: skip it, don't crash
      const stat = fs.existsSync(full) ? fs.statSync(full) : null;
      if (!stat || !stat.isFile() || stat.size > 1024 * 1024) continue;
      for (const line of fs.readFileSync(full, "utf8").split("\n")) {
        const k = keyIn(line);
        if (k) hits.push({ ...k, file: p });
      }
    }
  }
  return hits;
}

const masked = (s) => `${s.slice(0, 8)}...`;
export function reason(hits) {
  const list = hits.slice(0, 5).map((h) => (h.text ? `${h.kind} in ${h.file} (${masked(h.text)})` : `${h.kind}: ${h.file}`));
  const more = hits.length > 5 ? ` and ${hits.length - 5} more` : "";
  return `[push-key-scan] This push sends ${list.join("; ")}${more}. Once pushed, a key stays in the remote's history ` +
    "even after a fix, and has to be revoked. Allow only if it is a fake or meant to be public. If the key is real, take " +
    "it out of the commit (git reset or rebase) and revoke it. To push without this check, start the command with " +
    "PUSH_KEY_SCAN=off.";
}

if (isMain(import.meta.url)) {
  runHook("push-key-scan", (event) => {
    if (!["Bash", "PowerShell"].includes(event.tool_name)) return;
    const command = String(event.tool_input?.command || "");
    if (offInCommand(command)) return;
    const push = parsePush(command);
    if (!push) return;
    const hits = scan(push, event.cwd || process.cwd());
    if (!hits?.length) return;
    // "ask" is the one verdict emit has no helper for (as in sql-guard)
    fs.writeSync(1, JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "ask", permissionDecisionReason: reason(hits) },
    }));
  }, { failClosed: true });
}
