// Tests for hooks/planner-readonly.mjs. Run: node tests/test-planner-readonly.mjs
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/planner-readonly.mjs", import.meta.url),
);
let pass = 0,
  fail = 0;
function run(command, { tool = "Bash", agent = "planner", env = {} } = {}) {
  const event = {
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: { command },
  };
  if (agent) {
    event.agent_type = agent;
    event.agent_id = "a1";
  }
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(event),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  return r.stdout.includes('"deny"') ? "deny" : "allow";
}
function check(name, got, want) {
  const ok = got === want;
  if (ok) pass++;
  else fail++;
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : `: got ${got}, want ${want}`}`,
  );
}
const allow = (cmd, opts) =>
  check(`allow: ${cmd.replace(/\n/g, "\\n")}`, run(cmd, opts), "allow");
const deny = (cmd, opts) =>
  check(`deny: ${cmd.replace(/\n/g, "\\n")}`, run(cmd, opts), "deny");

// Reading: allowed
allow("git status --short");
allow("git -C C:/Projects/x log --oneline -5");
allow('git -C "C:/Projects/my projects/app" status --short');
allow("git worktree list");
allow("git diff HEAD~1 -- hooks/x.mjs");
allow("git show HEAD:agents/planner.md");
allow("git branch");
allow("git branch -a");
allow("git remote -v");
allow("git stash list");
allow("git --no-pager log --format=%h -3");
allow("ls");
allow("ls -la docs | wc -l");
allow("node ~/.claude/skills/systems-map/map.mjs --near x");
allow("node D:/tools/.claude/skills/systems-map/map.mjs --near hooks skills");
allow("git status --short 2>&1");
allow("git log --oneline -5 2>/dev/null");
allow("git status --short && git log --oneline -3; git worktree list");
allow("grep -n 'planner' agents/planner.md | head -20");
// The harmless ones planners and reviewers kept being refused (2026-11-13)
allow('cd "C:/Projects/my x" && git log --oneline -3');
allow("echo === && ls; pwd");
allow('R="C:/Projects/my folder/x"; ls "$R"; git -C "$R" status');
allow("echo === && node tests/test-x.mjs", { agent: "reviewer" });
deny("echo hi > f.txt");
deny("echo $(rm x) && cd x");
deny("PATH=/tmp/evil; ls");
deny("GIT_DIR=/x; git status");
deny("R=x rm f");
deny("cd x && rm f");
deny('R="--open-files-in-pager=vi"; git grep "$R" x'); // a flag hidden in a variable
deny("R=-o; sort $R f a.txt");
deny('R="a b"; uniq $R'); // unquoted, splits into an output file
allow("R=C:/x; ls $R");
allow("rg -n --glob '*.md' planner");
allow("sort -u a.txt | uniq -c");
allow("tail -n 20 HANDOFF.md");
allow("git status --short\n\n# WHAT THIS DOES: Show the repo state");
allow("git log --oneline -1 # the last commit");
allow("git log --grep='a > b' --oneline");

// Writing or running programs: denied (the design's list, section 2.2 / P3-2)
deny("git diff --output=f");
deny("git stash");
deny("git checkout main");
deny("rm x");
deny("ls > f");
deny("ls >> f");
deny("git status && rm x");
deny("echo $(rm x)");
deny("echo `rm x`");
deny('git log --format="$(rm x)"');
deny("sort -o f a.txt");
deny("Remove-Item x", { tool: "PowerShell" });
deny("rg --pre cat x");
deny("rg --pre-glob '*' --pre cat x");
deny("git grep -O x");
deny("git grep -nOsh -e echo -- f"); // -O bundled with other short options runs sh on f (review finding)
deny("git grep -iO -e x");
deny("file -zC -m x");
deny("file --comp -m x");
deny("tail -5f x");
deny("ls (Remove-Item x)", { tool: "PowerShell" });
deny("grep x @(rm f)", { tool: "PowerShell" });
allow("grep -n 'f(x)' a.js");
allow("git grep -n -e planner");

// The plan-reviewer: the same reading list plus test runs (user, 2026-11-09)
const R = { agent: "plan-reviewer" };
allow("git status --short", R);
allow("node tests/test-planner.mjs", R);
allow("node C:/Projects/x/tests/run-all.mjs", R);
allow("node test-rules-size.mjs && node run-private-tests.mjs", R);
allow("npm test", R);
allow("npm run test:unit", R);
allow("python -I -m pytest -q tests", R);
allow("pytest -x", R);
allow("python -I tools/test_replay.py", R);
deny("rm x", R);
deny("node scripts/deploy.mjs", R);
deny("node -e \"require('fs').writeFileSync('x','')\" test.mjs", R);
deny("npm install", R);
deny("npm run build", R);
deny("node tests/test-x.mjs > out.txt", R);
deny('python -c \'open("x","w")\'', R);
deny("git push", R);
deny("node tests/../install.mjs", R);
deny("node scripts/publish-latest.mjs", R);
deny("node contest.mjs", R);
deny("node --watch tests/test-x.mjs", R);
deny("npm run test-and-publish", R);
deny("pytest --basetemp=C:/Users/you/.claude", R);
deny("pytest -p evil", R);
deny("python -m pytest --junitxml=C:/x.xml", R);
deny("pytest -o cache_dir=C:/x", R);
allow("pytest -q -k slow tests/test_a.py", R);
allow("node app.test.mjs", R);
deny("node tests/test-planner.mjs"); // the planner itself runs no tests
deny("npm test");
const rr = spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({
    tool_name: "Bash",
    agent_type: "plan-reviewer",
    tool_input: { command: "npm install" },
  }),
  encoding: "utf8",
});
check(
  "the plan-reviewer's refusal says to list the check as not run",
  /plan-reviewer reads and runs tests only/.test(rr.stdout) &&
    /not run/.test(rr.stdout)
    ? "yes"
    : rr.stdout,
  "yes",
);
// The reviewer reads and runs tests like the plan-reviewer (user, 2026-11-12, D7 item 1)
deny("npm install", { agent: "reviewer" });
allow("node tests/test-x.mjs", { agent: "reviewer" });
check(
  "a worker running npm install: not touched",
  run("npm install", { agent: "worker" }),
  "allow",
);
const rv = spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({
    tool_name: "Bash",
    agent_type: "reviewer",
    tool_input: { command: "npm install" },
  }),
  encoding: "utf8",
});
check(
  "the reviewer's refusal names the reviewer",
  /The reviewer reads and runs tests only/.test(rv.stdout) ? "yes" : rv.stdout,
  "yes",
);
const wk = spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({
    tool_name: "Bash",
    agent_type: "worker",
    tool_input: { command: "npm install" },
  }),
  encoding: "utf8",
});
check("a worker: no output at all", wk.stdout, "");
deny("git grep --open-files-in-pager=vi x");
deny("sort --compress-program=sh f");
deny("git diff --ext-diff");
deny("git show --ext-diff HEAD");
deny("git log --textconv -p");
deny("git -c core.pager=sh log");
deny("git --exec-path=/tmp log");
deny("touch x");
// More ways around it
deny("git branch -D main");
deny("git branch new-name");
deny("git worktree add ../x");
deny("git remote add origin u");
deny("git stash pop");
deny("git commit -m x");
deny("git push");
deny("tail -f log.txt");
deny("uniq in.txt out.txt");
deny("file -C -m magic");
deny("GIT_EXTERNAL_DIFF=sh git diff");
deny("node script.mjs");
deny("node -e \"require('fs').writeFileSync('x','y')\"");
deny("ls & rm x");
deny("cat < x");
deny("diff <(ls) <(ls a)");
deny("git status | tee out.txt");
deny("ls | xargs rm");
deny("find . -delete");
deny("bash -c 'ls'");
deny("npm test");
deny("node tests/run-all.mjs");
deny("git status 'unclosed");
deny("(rm x)");

// Shortened long flags and other ways in (review, 2026-11-09)
deny("git grep --open=echo -e x -- f");
deny("git grep --open-files=vi x");
deny("git diff --ext");
deny("git log --outp=f");
deny("sort --out=f x");
deny("sort --comp=sh x");
deny("tail --fol x");
deny("rg --hostname-bin=sh x");
deny("rg -z x");
deny("rg --search-zip x");
// biome-ignore lint/suspicious/noTemplateCurlyInString: a shell command, not a template
deny("ls ${x:='a'}${x@P}");
// biome-ignore lint/suspicious/noTemplateCurlyInString: a shell command, not a template
deny('ls "${HOME}"');
deny("./ls");
deny("scripts/head x");
allow("git log --oneline --no-ext-diff -3");
allow("git diff --text a b");
allow("git grep -n -e planner");
allow("sort -n -k2 a.txt");
allow("rg -n --hidden x");

// Scope: only the planner
check("main session: not touched", run("rm x", { agent: null }), "allow");
check("a worker: not touched", run("rm x", { agent: "worker" }), "allow");
check(
  "a plugin-named planner is guarded",
  run("rm x", { agent: "setup:planner" }),
  "deny",
);
check("other tool: not touched", run("rm x", { tool: "Read" }), "allow");
check("off switch", run("rm x", { env: { PLANNER_READONLY: "off" } }), "allow");
check(
  "bad input fails open (no agent known)",
  spawnSync(process.execPath, [HOOK], { input: "not json", encoding: "utf8" })
    .stdout,
  "",
);

const r = spawnSync(process.execPath, [HOOK], {
  input: JSON.stringify({
    tool_name: "Bash",
    agent_type: "planner",
    tool_input: { command: "touch x" },
  }),
  encoding: "utf8",
});
check(
  "the refusal names the plan-reviewer",
  /plan-reviewer runs it/.test(r.stdout) ? "yes" : r.stdout,
  "yes",
);

console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
