// Tests for hooks/push-key-scan.mjs, on real git repos in a temp folder (each with a bare remote). Run: node test-push-key-scan.mjs
// The fake keys are put together at run time, so this file holds no key shape itself and its own push passes the hook.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  keyFile,
  keyIn,
  maskKeys,
  parsePush,
} from "../hooks/push-key-scan.mjs";
import { writeReport } from "../skills/setup-audit/scripts/lib/reports.mjs";

const hook = fileURLToPath(
  new URL("../hooks/push-key-scan.mjs", import.meta.url),
);
const root = mkdtempSync(join(tmpdir(), "pushscan-"));
const GH = "gh" + "p_" + "a1B2c3D4e5F6g7H8i9J0k1L2m3N4o5P6q7R8";
const OPENAI = "sk-" + "proj-" + "Zx9Yw8Vu7Ts6Rq5Po4Nm3Lk2Jh1";
const AWS = "AK" + "IA" + "Q3EGRZ7XK2PLMN4T";
const PEM =
  "-----BEGIN " +
  "OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\n-----END OPENSSH PRIVATE KEY-----\n";

const sh = (cwd, ...args) => {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${r.stderr}`);
};
let n = 0;
// A repo whose remote has one commit; then `commit` files go into a new local commit, `loose` files stay untracked
function repo({ pushed = {}, commit = {}, loose = {} } = {}) {
  const dir = join(root, `r${++n}`),
    remote = join(root, `r${n}.git`);
  mkdirSync(dir);
  sh(root, "init", "-q", "--bare", remote);
  sh(dir, "init", "-q", "-b", "main");
  sh(dir, "config", "user.email", "t@t");
  sh(dir, "config", "user.name", "t");
  sh(dir, "config", "commit.gpgsign", "false");
  // the user's global ignore list (it may skip .claude/settings.local.json) must not decide what a case commits
  sh(dir, "config", "core.excludesFile", join(root, "no-global-ignore"));
  const put = (files) => {
    for (const [f, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, f)), { recursive: true });
      writeFileSync(join(dir, f), text);
    }
  };
  put({ "README.md": "hello\n", ...pushed });
  sh(dir, "add", "-A");
  sh(dir, "commit", "-qm", "base");
  sh(dir, "remote", "add", "origin", remote);
  sh(dir, "push", "-q", "-u", "origin", "main");
  if (Object.keys(commit).length) {
    put(commit);
    sh(dir, "add", "-A");
    sh(dir, "commit", "-qm", "work");
  }
  put(loose);
  return dir;
}

const run = (ev, env = {}) =>
  spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: "t", ...ev }),
    env: { ...process.env, ...env },
    encoding: "utf8",
  }).stdout;
const bash = (cwd, command, tool = "Bash") => ({
  cwd,
  tool_name: tool,
  tool_input: { command },
});

const withToken = repo({ commit: { "config.js": `const token = "${GH}";\n` } });
const withEnv = repo({ commit: { ".env": "PORT=3000\n" } });
const toCommit = repo({ loose: { "keys.py": `aws = "${AWS}"\n` } });
const withPem = repo({ commit: { "deploy.txt": PEM } });
const clean = repo({ commit: { "app.js": "console.log(1);\n" } });
const example = repo({
  commit: {
    ".env.example": "AWS_ACCESS_KEY_ID=AKIAIOSFODNN7EXAMPLE\nOPENAI_API_KEY=\n",
  },
});
const oldKey = repo({
  pushed: { "old.js": `k = "${OPENAI}"\n` },
  commit: { "app.js": "x = 1\n" },
});
const elsewhere = mkdtempSync(join(tmpdir(), "pushscan-cwd-"));

const cases = [
  [
    "ask: pushed commit holds a GitHub token",
    bash(withToken, "git push"),
    true,
  ],
  [
    "ask: pushed commit adds a .env file",
    bash(withEnv, "git push origin main"),
    true,
  ],
  [
    "ask: same command commits an untracked file with an AWS key",
    bash(toCommit, `git add -A && git commit -m "add keys" && git push`),
    true,
  ],
  [
    "ask: pushed commit holds a private key block",
    bash(withPem, "git push"),
    true,
  ],
  [
    "ask: cd into the repo first, from another folder",
    bash(elsewhere, `cd "${withToken}" && git push origin main`),
    true,
  ],
  [
    "ask: git -C with a quoted path",
    bash(elsewhere, `git -C "${withToken}" push`),
    true,
  ],
  [
    "ask: PowerShell push",
    bash(withToken, "git push origin main", "PowerShell"),
    true,
  ],
  ["ask: push inside bash -c", bash(withToken, `bash -c "git push"`), true],
  [
    "ask: with the explain line after it",
    bash(withToken, "git push\n\n# WHAT THIS DOES: sends the work to GitHub"),
    true,
  ],
  ["silent: push of a commit with no key", bash(clean, "git push"), false],
  [
    "silent: .env.example with the documented AWS fake",
    bash(example, "git push"),
    false,
  ],
  [
    "silent: key only in a commit the remote already has",
    bash(oldKey, "git push"),
    false,
  ],
  [
    "silent: commit whose message says git push",
    bash(withToken, `git commit -m "never git push a key"`),
    false,
  ],
  [
    "silent: git push only in the explain line",
    bash(withToken, "git status\n\n# WHAT THIS DOES: checks before a git push"),
    false,
  ],
  [
    "silent: echo of the words git push",
    bash(withToken, `echo "run git push later"`),
    false,
  ],
  [
    "silent: PUSH_KEY_SCAN=off in the command",
    bash(withToken, "PUSH_KEY_SCAN=off git push"),
    false,
  ],
  ["silent: not a git repo", bash(elsewhere, "git push"), false],
  [
    "silent: Read tool",
    {
      cwd: withToken,
      tool_name: "Read",
      tool_input: { file_path: "config.js" },
    },
    false,
  ],
];

let fail = 0;
const check = (ok, name) => {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
for (const [name, ev, want] of cases)
  check(run(ev).includes('"ask"') === want, name);

const asked = run(bash(withToken, "git push"));
check(
  asked.includes("config.js") &&
    !asked.includes(GH) &&
    asked.includes("PUSH_KEY_SCAN=off"),
  "reason names the file, masks the key, says how to push anyway",
);
check(
  run(bash(withToken, "git push"), { PUSH_KEY_SCAN: "off" }) === "",
  "PUSH_KEY_SCAN=off in the environment: silent",
);
check(
  spawnSync(process.execPath, [hook], { input: "not json", encoding: "utf8" })
    .stdout === "",
  "bad input: silent",
);

check(
  keyIn("className: sk-" + "some-long-css-class-name-here") === null,
  "keyIn: a long sk- identifier with no digit is no key",
);
check(
  keyIn(`x = "${OPENAI}"`)?.kind === "an OpenAI-style key",
  "keyIn: OpenAI project key",
);
check(
  keyFile(".env.local") &&
    !keyFile(".env.example") &&
    keyFile("home/.ssh/id_ed25519") &&
    !keyFile("id_ed25519.pub"),
  "keyFile: .env.local and private key yes, example and .pub no",
);
check(
  parsePush("git push --force origin feat:main")?.refs.join() === "feat",
  "parsePush: source of a refspec",
);

// Reports and digests hide keys: a chat digest once held a pasted Anthropic key in plain text
{
  const key = "sk-ant-api03-" + "a1B2c3D4e5F6g7H8i9J0kLmNoPqRsT";
  const masked = maskKeys(`new key ${key} please`);
  check(
    masked === "new key [an Anthropic key hidden] please",
    `maskKeys: hides an Anthropic key (got ${masked})`,
  );
  check(
    maskKeys("className: sk-" + "some-long-css-class-name-here") ===
      "className: sk-" + "some-long-css-class-name-here",
    "maskKeys: leaves a CSS class name alone",
  );
  const dir = mkdtempSync(join(tmpdir(), "mask-"));
  writeReport(
    dir,
    "d.md",
    `- S19: here is the key ${key}
`,
  );
  const out = readFileSync(join(dir, "d.md"), "utf8");
  check(
    !out.includes(key) && out.includes("[an Anthropic key hidden]"),
    "writeReport: a digest file never holds a key from the chat",
  );
}

// ---- job 9 (docs/2026-11-20-safe-deploys-spec.md D1, D2, D7): the broad scan with gitleaks, the longer key-file
// list, and the refusal of a raw deploy command in a project switched on with `ship-check init`.
// gitleaks is faked through SHIP_CHECK_GITLEAKS (a .mjs file the hook runs with Node). A path to a missing file is
// "gitleaks is not installed", so the cases below do not depend on a gitleaks on this PC's PATH.
const SHIP_CONFIG = {
  ".claude/ship-check.json": '{ "build": null, "url": null }\n',
};
const fakes = mkdtempSync(join(tmpdir(), "pushscan-fake-"));
const fakeGitleaks = (name, body) => {
  const f = join(fakes, `${name}.mjs`);
  writeFileSync(f, body);
  return f;
};
const NO_GITLEAKS = { SHIP_CHECK_GITLEAKS: join(fakes, "not-there.mjs") };
// A generic key none of the 12 shapes knows: api_key = "<40 hex>"
const LEAK_HEX = "9f86d0818" + "84c7d659a2feaa0c55ad015a3bf4f1b";
const GENERIC = "api" + `_key = "${LEAK_HEX}"`;
// A gitleaks-style JSON report of one finding in `file`. It goes to stdout, or to the file --report-path names, and
// the fake exits 1, as gitleaks does when it finds a leak.
const finding = (file, commit) =>
  fakeGitleaks(
    `finding-${file.replace(/\W/g, "-")}`,
    `import fs from "node:fs";
const a = process.argv.slice(2);
const at = a.findIndex((x) => x === "--report-path" || x === "-r" || x.startsWith("--report-path="));
const to = at < 0 ? "-" : a[at].includes("=") ? a[at].split("=").slice(1).join("=") : a[at + 1];
const report = JSON.stringify([{
  RuleID: "generic-api-key", Description: "Detected a Generic API Key", StartLine: 1, EndLine: 1,
  StartColumn: 1, EndColumn: ${GENERIC.length}, Match: ${JSON.stringify(GENERIC)}, Secret: "${LEAK_HEX}",
  File: "${file}", SymlinkFile: "", Commit: "${commit}", Entropy: 3.9, Author: "t", Email: "t@t",
  Date: "2026-11-20T00:00:00Z", Message: "work", Tags: [], Fingerprint: "${commit}:${file}:generic-api-key:1",
}]);
if (to && to !== "-" && to !== "/dev/stdout") fs.writeFileSync(to, report);
else process.stdout.write(report);
process.exit(1);
`,
  );
const CRASH = fakeGitleaks(
  "crash",
  `process.stderr.write("panic: runtime error\\n");\nprocess.exit(2);\n`,
);
const HANG = fakeGitleaks("hang", "setTimeout(() => {}, 120000);\n");

// The hook's answer, read: { decision, reason, context, ms }
const answer = (ev, env = {}) => {
  const t = Date.now();
  const r = spawnSync(process.execPath, [hook], {
    input: JSON.stringify({ session_id: "t", ...ev }),
    env: { ...process.env, ...env },
    encoding: "utf8",
    timeout: 60000,
  });
  let o = {};
  try {
    o = r.stdout.trim() ? JSON.parse(r.stdout) : {};
  } catch {
    o = { unreadable: r.stdout };
  }
  const hs = o.hookSpecificOutput ?? {};
  return {
    status: r.status,
    decision: hs.permissionDecision ?? null,
    reason: String(hs.permissionDecisionReason ?? ""),
    context: String(hs.additionalContext ?? ""),
    ms: Date.now() - t,
    raw: `exit ${r.status}, ${Date.now() - t} ms, stdout ${r.stdout.slice(0, 400)} stderr ${r.stderr.slice(0, 200)}`,
  };
};
const said = (name, ok, a) => check(ok, ok ? name : `${name}\n     ${a.raw}`);

// D1: a generic key in an outgoing commit; gitleaks finds it, the 12 shapes do not
const generic = repo({ commit: { "config.py": `${GENERIC}\n` } });
const genericSha = spawnSync("git", ["rev-parse", "HEAD"], {
  cwd: generic,
  encoding: "utf8",
}).stdout.trim();
{
  const a = answer(bash(generic, "git push"), {
    SHIP_CHECK_GITLEAKS: finding("config.py", genericSha),
  });
  said(
    "D1 ask: gitleaks finds a generic api_key in an outgoing commit; the reason names config.py and generic-api-key, the value masked",
    a.decision === "ask" &&
      a.reason.includes("config.py") &&
      a.reason.includes("generic-api-key") &&
      !a.reason.includes(LEAK_HEX),
    a,
  );
}
// D1: the same key still uncommitted when the hook runs; the command commits it first
{
  const dir = repo({ pushed: { "config.py": "debug = False\n" } });
  writeFileSync(join(dir, "config.py"), `debug = False\n${GENERIC}\n`);
  const a = answer(bash(dir, "git commit -am x && git push"), {
    SHIP_CHECK_GITLEAKS: finding("config.py", ""),
  });
  said(
    "D1 ask: `git commit -am x && git push` with the generic key still uncommitted; names config.py and generic-api-key, masked",
    a.decision === "ask" &&
      a.reason.includes("config.py") &&
      a.reason.includes("generic-api-key") &&
      !a.reason.includes(LEAK_HEX),
    a,
  );
}
// D1: the 13th shape, a database URL with a password, which gitleaks' own rules miss: asked with no gitleaks at all
const DB_WORD = "Tr0ub4dor" + "AndHorse7";
{
  const dir = repo({
    commit: {
      "db.js": `const url = "postgres://app:${DB_WORD}@db.internal:5432/main";\n`,
    },
  });
  const a = answer(bash(dir, "git push"), NO_GITLEAKS);
  said(
    "D1 ask: a postgres:// URL with a password, no gitleaks installed (the hook's 13th shape); file named, password masked",
    a.decision === "ask" &&
      a.reason.includes("db.js") &&
      !a.reason.includes(DB_WORD),
    a,
  );
}
{
  const dir = repo({
    commit: {
      "db.js":
        'const url = "postgres://app:' +
        "$" +
        '{DB_PASS}@db.internal:5432/main";\n',
    },
  });
  const a = answer(bash(dir, "git push"), NO_GITLEAKS);
  said(
    "D1 silent: a postgres:// URL whose password is a ${DB_PASS} placeholder",
    a.decision !== "ask",
    a,
  );
}
// D1: gitleaks missing. A switched-on project asks and names the install command; any other passes with one note line.
{
  const dir = repo({ commit: { "app.js": "x = 1\n" }, loose: SHIP_CONFIG });
  const a = answer(bash(dir, "git push"), NO_GITLEAKS);
  const install =
    process.platform === "win32"
      ? "winget install Gitleaks.Gitleaks"
      : process.platform === "darwin"
        ? "brew install gitleaks"
        : "gitleaks";
  said(
    `D1 ask: a project with .claude/ship-check.json and no gitleaks; the reason names "${install}"`,
    a.decision === "ask" && a.reason.includes(install),
    a,
  );
}
{
  const dir = repo({ commit: { "app.js": "x = 1\n" } });
  const a = answer(bash(dir, "git push"), NO_GITLEAKS);
  said(
    "D1 pass: no .claude/ship-check.json and no gitleaks; one note line (additionalContext) that names gitleaks",
    a.decision === null &&
      /gitleaks/i.test(a.context) &&
      !a.context.trim().includes("\n"),
    a,
  );
}
// D1: gitleaks itself fails (a crash, or running past the hook's time limit): ask, saying the broad scan could not run
for (const [what, fake] of [
  ["crashes", CRASH],
  ["hangs past the time limit", HANG],
]) {
  const dir = repo({ commit: { "app.js": "x = 1\n" } });
  const a = answer(bash(dir, "git push"), { SHIP_CHECK_GITLEAKS: fake });
  said(
    `D1 ask: a gitleaks that ${what}; the reason says the broad scan could not run`,
    a.decision === "ask" && /could not run/i.test(a.reason) && a.ms < 30000,
    a,
  );
}

// D2: the longer list of key files (YOUR WORDS: ".env.*, .dev.vars, *.pem, .claude/settings.local.json")
for (const [file, want] of [
  [".dev.vars", true],
  ["server.pem", true],
  ["tls.key", true],
  ["cert.pfx", true],
  [".claude/settings.local.json", true],
  [".env.production", true],
  [".env.example", false],
  ["id_rsa.pub", false],
]) {
  const dir = repo({ commit: { [file]: "nothing secret here\n" } });
  const a = answer(bash(dir, "git push"), NO_GITLEAKS);
  said(
    `D2 ${want ? "ask" : "pass"}: a push adding ${file}`,
    (a.decision === "ask") === want,
    a,
  );
}

// D7: in a switched-on project a raw deploy command is denied, with the ship-check line to run instead
const shipped = repo({ commit: { "app.js": "x = 1\n" }, loose: SHIP_CONFIG });
const plainProject = repo({ commit: { "app.js": "x = 1\n" } });
const explain = (c) => `${c}\n\n# WHAT THIS DOES: puts the site live`;
const deny = (a) =>
  a.decision === "deny" && a.reason.includes("ship-check.mjs deploy -- ");
for (const tool of ["Bash", "PowerShell"])
  for (const c of ["wrangler deploy", "npx vercel --prod", "npm run deploy"]) {
    const a = answer(bash(shipped, explain(c), tool), NO_GITLEAKS);
    said(
      `D7 deny (${tool}): \`${c}\` in a switched-on project, naming ship-check.mjs deploy -- `,
      deny(a),
      a,
    );
  }
for (const [what, c] of [
  ["SHIP_CHECK=off before it", explain("SHIP_CHECK=off wrangler deploy")],
  [
    "the wrapper itself",
    explain("node ~/.claude/workers/ship-check.mjs deploy -- wrangler deploy"),
  ],
  ["a deploy word in quoted text", explain('echo "wrangler deploy"')],
  [
    "a deploy word only in the explain line",
    "git status\n\n# WHAT THIS DOES: checks before wrangler deploy",
  ],
]) {
  const a = answer(bash(shipped, c), NO_GITLEAKS);
  said(`D7 pass: ${what}`, a.decision !== "deny", a);
}
{
  const a = answer(bash(plainProject, explain("wrangler deploy")), NO_GITLEAKS);
  said(
    "D7 pass: `wrangler deploy` in a project without .claude/ship-check.json",
    a.decision !== "deny",
    a,
  );
}

// ---- /code-review round 1 of job 9: each case below once let a push or deploy through, or stopped every command

// A broken .claude/ship-check.json (not JSON, or "deploy" not a list of strings) once made the fail-closed guard
// refuse every shell command in the project. Plain commands pass; a deploy or a push is refused once, the reason
// naming the file and what is wrong.
for (const [what, text, wrong] of [
  ["a trailing comma", '{ "build": null, "url": null, }\n', /not valid JSON/],
  [
    '"deploy" a number',
    '{ "build": null, "url": null, "deploy": 5 }\n',
    /"deploy".*list/,
  ],
  [
    '"deploy" a string',
    '{ "build": null, "url": null, "deploy": "./ship.sh" }\n',
    /"deploy".*list/,
  ],
]) {
  const dir = repo({
    commit: { "app.js": "x = 1\n" },
    loose: { ".claude/ship-check.json": text },
  });
  for (const c of ["ls", "git status"]) {
    const a = answer(bash(dir, explain(c)), NO_GITLEAKS);
    said(
      `broken config (${what}): \`${c}\` passes (a broken ship-check.json must not stop every command)`,
      a.status === 0 && a.decision === null,
      a,
    );
  }
  for (const c of ["wrangler deploy", "git push"]) {
    const a = answer(bash(dir, explain(c)), NO_GITLEAKS);
    said(
      `broken config (${what}): \`${c}\` is refused once, naming .claude/ship-check.json and what is wrong`,
      a.decision === "deny" &&
        a.reason.includes(".claude/ship-check.json") &&
        wrong.test(a.reason) &&
        a.reason.split("[push-key-scan]").length === 2,
      a,
    );
  }
}

// git could not read what the push sends (here it cannot start): the push once passed unchecked; now it asks
{
  const pathKey = Object.keys(process.env).find(
    (k) => k.toUpperCase() === "PATH",
  );
  const a = answer(bash(withToken, "git push"), {
    ...NO_GITLEAKS,
    [pathKey]: dirname(process.execPath),
  });
  said(
    "git cannot start: the push is asked about, the reason saying git could not read what it sends",
    a.decision === "ask" &&
      /could not read what this push sends/i.test(a.reason) &&
      /git/.test(a.reason),
    a,
  );
}
// a ref git does not know still passes: the push itself will say so
{
  const a = answer(bash(clean, "git push origin no-such-branch"), NO_GITLEAKS);
  said(
    "a ref git does not know: no ask (the push itself says so)",
    a.decision === null,
    a,
  );
}

// A deploy that cd's into another switched-on project whose own list holds it, each cd taken from the one before.
// It once passed: the guard stopped at the first switched-on folder that did not list the command.
{
  const own = repo({
    commit: { "app.js": "x = 1\n" },
    loose: {
      ".claude/ship-check.json":
        '{ "build": null, "url": null, "deploy": ["./publish.sh"] }\n',
    },
  });
  const rel = own.split(/[\\/]/).pop();
  const a = answer(
    bash(shipped, explain(`cd "${root}" && cd ${rel} && ./publish.sh`)),
    NO_GITLEAKS,
  );
  said(
    "deny: `cd <root> && cd <project> && ./publish.sh` from another switched-on project; the second project lists ./publish.sh",
    deny(a) && a.reason.includes("deploy -- ./publish.sh"),
    a,
  );
}

// The command the deny message suggests is the deploy itself, not the cd before it that holds the same word
{
  const a = answer(
    bash(shipped, explain("cd vercel-site && vercel")),
    NO_GITLEAKS,
  );
  said(
    "deny of `cd vercel-site && vercel` suggests `deploy -- vercel`, not `deploy -- cd vercel-site`",
    deny(a) &&
      /deploy -- vercel\n/.test(a.reason) &&
      !a.reason.includes("deploy -- cd"),
    a,
  );
}

// End review of job 9: a pinned deploy (wrangler@4.162.0) once ran raw; the line suggested is the whole deploy, with
// its runner and version, and a deploy after `then` is suggested without the `then`
for (const [c, want] of [
  [
    "cd site && npx wrangler@4.162.0 deploy",
    "deploy -- npx wrangler@4.162.0 deploy\n",
  ],
  ["if [ -d dist ]; then wrangler deploy; fi", "deploy -- wrangler deploy\n"],
]) {
  const a = answer(bash(shipped, explain(c)), NO_GITLEAKS);
  said(
    `deny of \`${c}\` suggests \`${want.trim()}\``,
    deny(a) && a.reason.includes(want),
    a,
  );
}

// A push that sends no commit (tags only, a branch deleted) in a switched-on project with no gitleaks: nothing to
// scan, so no ask about the missing gitleaks
{
  const dir = repo({ loose: SHIP_CONFIG });
  sh(dir, "branch", "old");
  for (const c of ["git push --tags", "git push origin --delete old"]) {
    const a = answer(bash(dir, c), NO_GITLEAKS);
    said(
      `no ask: \`${c}\` sends no commit, so a missing gitleaks does not matter`,
      a.decision === null,
      a,
    );
  }
}

for (const d of [root, fakes, elsewhere])
  rmSync(d, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
