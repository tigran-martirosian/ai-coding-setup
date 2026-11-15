// Tests for hooks/push-key-scan.mjs, on real git repos in a temp folder (each with a bare remote). Run: node test-push-key-scan.mjs
// The fake keys are put together at run time, so this file holds no key shape itself and its own push passes the hook.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { keyFile, keyIn, parsePush } from "../hooks/push-key-scan.mjs";

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
  const put = (files) => {
    for (const [f, text] of Object.entries(files))
      writeFileSync(join(dir, f), text);
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

console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
