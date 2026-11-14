// Test for hooks/job-done.mjs: made-up small transcripts, hook run as a child process.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(new URL("../hooks/job-done.mjs", import.meta.url));
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "job-done-test-"));
const runId = "t" + process.pid + "-" + Date.now();
const stateDir = path.join(
  os.homedir(),
  ".claude",
  "hooks",
  "state",
  "job-done",
);
const sessions = [];
let failed = 0;
let n = 0;

const ago = (min) => new Date(Date.now() - min * 60000).toISOString();
const asst = (ctx, content, extra = {}) =>
  JSON.stringify({
    type: "assistant",
    timestamp: ago(1),
    message: {
      id: "m" + Math.random(),
      model: "claude-x",
      content,
      usage: {
        input_tokens: 10,
        cache_read_input_tokens: ctx - 10,
        cache_creation_input_tokens: 0,
      },
    },
    ...extra,
  });
const text = (t = "ok") => [{ type: "text", text: t }];
const bash = (cmd, id = "tu_" + Math.random()) => [
  { type: "tool_use", id, name: "Bash", input: { command: cmd } },
];
const skill = (name) => [
  {
    type: "tool_use",
    id: "tu_" + Math.random(),
    name: "Skill",
    input: { skill: name },
  },
];
const user = (t) =>
  JSON.stringify({
    type: "user",
    timestamp: ago(2),
    message: { role: "user", content: t },
  });
const toolResult = () =>
  JSON.stringify({
    type: "user",
    timestamp: ago(1),
    message: {
      role: "user",
      content: [{ type: "tool_result", tool_use_id: "x", content: "done" }],
    },
  });

function run(name, lines, expectNudge, { event = {}, env = {}, session } = {}) {
  const file = path.join(dir, name + ".jsonl");
  if (Array.isArray(lines)) fs.writeFileSync(file, lines.join("\n") + "\n");
  const sid = session ?? `${runId}-${++n}`;
  sessions.push(sid);
  const input =
    lines === "broken-event"
      ? "{not json"
      : JSON.stringify({
          transcript_path: file,
          session_id: sid,
          prompt: "next job please",
          cwd: os.tmpdir(),
          ...event,
        });
  const r = spawnSync(process.execPath, [HOOK], {
    input,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const out = r.stdout.trim();
  let ok = r.status === 0;
  if (expectNudge) {
    try {
      const j = JSON.parse(out);
      const c = j.hookSpecificOutput.additionalContext;
      ok =
        ok &&
        j.hookSpecificOutput.hookEventName === "UserPromptSubmit" &&
        !("decision" in j) &&
        c.includes("committed at ~" + expectNudge + "k tokens") &&
        c.includes("handoff skill");
    } catch {
      ok = false;
    }
  } else ok = ok && out === "";
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`,
  );
  return out;
}

const committed = (ctx, cmd = 'git commit -m "x"') => [
  user("build it"),
  asst(ctx, bash(cmd, "tu_commit")),
  toolResult(),
  asst(ctx, text("committed")),
];

const out = run("commit-at-150k", committed(150000), 150);
console.log(
  "      " +
    JSON.parse(out).hookSpecificOutput.additionalContext.slice(0, 120) +
    "...",
);
run("commit-at-60k-silent", committed(60000), false);
run(
  "no-commit-silent",
  [
    user("build it"),
    asst(150000, bash("npm test")),
    toolResult(),
    asst(150000, text("tests pass")),
  ],
  false,
);
run("git-push-nudges", committed(120000, "git push origin main"), 120);
run("git-tag-nudges", committed(120000, "git -C /x tag v1"), 120);
run("repo-push-sh-nudges", committed(120000, "bash audits/repo-push.sh"), 120);
run(
  "release-skill-nudges",
  [
    user("ship"),
    asst(130000, skill("release-setup")),
    toolResult(),
    asst(130000, text("released")),
  ],
  130,
);
run(
  "deploy-skill-nudges",
  [
    user("ship"),
    asst(130000, skill("deploy")),
    toolResult(),
    asst(130000, text("deployed")),
  ],
  130,
);
run(
  "other-skill-silent",
  [
    user("ship"),
    asst(130000, skill("handoff")),
    toolResult(),
    asst(130000, text("done")),
  ],
  false,
);
run(
  "commit-before-previous-typed-silent",
  [
    user("build"),
    asst(150000, bash('git commit -m "x"')),
    toolResult(),
    asst(150000, text("done")),
    user("one more"),
    asst(150000, text("answer")),
  ],
  false,
);
run(
  "prompt-already-in-transcript",
  [...committed(150000), user("next job please")],
  150,
);
run(
  "commit-only-in-sidechain-ignored",
  [
    user("build it"),
    asst(150000, bash('git commit -m "x"'), { isSidechain: true }),
    toolResult(),
    asst(150000, text("done")),
  ],
  false,
);
run(
  "sidechain-context-ignored",
  [...committed(150000), asst(20000, text("sub"), { isSidechain: true })],
  150,
);
run(
  "compact-boundary-resets-context",
  [
    ...committed(150000),
    JSON.stringify({
      type: "system",
      subtype: "compact_boundary",
      compactMetadata: { postTokens: 30000 },
    }),
  ],
  false,
);
run("command-prompt-silent", committed(150000), false, {
  event: { prompt: "/clear" },
});
run("task-notification-silent", committed(150000), false, {
  event: { prompt: "<task-notification>x</task-notification>" },
});
run("system-prompt-silent", committed(150000), false, {
  event: { prompt: "[System: something]" },
});
run("subagent-silent", committed(150000), false, {
  event: { agent_id: "abc" },
});
run("off-switch", committed(150000), false, { env: { JOB_DONE: "off" } });

// One commit nudges once: same session, same transcript, second message is silent
const same = `${runId}-same`;
run("first-message-after-commit", committed(150000), 150, { session: same });
run("second-message-after-same-commit-silent", committed(150000), false, {
  session: same,
});
// A new commit in the same session nudges again
run(
  "new-commit-nudges-again",
  committed(150000, 'git commit -m "y"').map((l) =>
    l.replace("tu_commit", "tu_commit2"),
  ),
  150,
  { session: same },
);

run("broken-lines", ["not json", '{"type":', ""], false);
run("empty-file", [""], false);
run("missing-file", null, false);
run("broken-event", "broken-event", false);

// PostToolUse: a main-session commit that landed (the repository's HEAD made in the last 2 minutes, whatever the
// output) tells Claude to hand the next piece to a fresh session, only when the project has an open job: made-up
// projects (a real git repository each, HEAD made `ago` seconds back) with and without one
const git = (root, args, ago = 0) => {
  const at = `@${Math.round(Date.now() / 1000 - ago)} +0000`;
  const r = spawnSync(
    "git",
    [
      "-C",
      root,
      "-c",
      "user.name=t",
      "-c",
      "user.email=t@t",
      "-c",
      "core.autocrlf=false",
      ...args,
    ],
    {
      encoding: "utf8",
      env: { ...process.env, GIT_AUTHOR_DATE: at, GIT_COMMITTER_DATE: at },
    },
  );
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} in ${root}: ${r.stderr}`);
  return r.stdout;
};
const write = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
};
const commitNow = (root, files, ago = 5) => {
  write(root, files);
  git(root, ["add", "-A"]);
  git(root, ["commit", "-q", "--no-verify", "-m", "x"], ago);
};
const project = (name, files, ago = 5) => {
  const root = path.join(dir, name);
  fs.mkdirSync(root, { recursive: true });
  git(root, ["init", "-q"]);
  commitNow(root, { "src/a.txt": "a\n", ...files }, ago);
  return root;
};
const ROWS =
  "## Job list\n\n| Step | Job |\n|---|---|\n| S1 | build it |\n| S2 | test it |\n";
const OPEN = project("open", { "docs/2026-11-09-x-plan.md": ROWS });
const NONE = project("none", {
  "docs/notes.md": "| S1 | not a plan file |\n",
  "HANDOFF.md": "## Next\n- [x] done\n",
});
const OLD = project("old", { "docs/old-plan.md": ROWS });
const old = new Date(Date.now() - 3 * 86400e3);
fs.utimesSync(path.join(OLD, "docs/old-plan.md"), old, old);
const HANDOFF = project("handoff", {
  "HANDOFF.md": "## Next\n- [ ] step 3: the tests\n",
});
const TICKED = project("ticked", {
  "docs/a-plan.md": "- [x] one\n- [x] two\n",
});
const STALE = project("stale", { "docs/2026-11-09-x-plan.md": ROWS }, 600); // HEAD 10 minutes old: no commit landed now
const LETTERS = project("letters", {
  "docs/2026-11-12-y-plan.md":
    "| Step | Job |\n|---|---|\n| BH1 | fix it |\n| W3 | wire it |\n",
});
const PLANONLY = project(
  "planonly",
  { "docs/2026-11-12-x-plan.md": ROWS },
  600,
);
commitNow(PLANONLY, {
  "docs/2026-11-12-x-plan.md": ROWS + "| S3 | more |\n",
  "HANDOFF.md": "- [ ] x\n",
});
// folders named like a plan or a state file, beside a real open plan: skipped, never read as files
const PLANDIR = project("plandir", { "docs/2026-11-12-x-plan.md": ROWS });
fs.mkdirSync(path.join(PLANDIR, "docs/old-plans.md"));
fs.mkdirSync(path.join(PLANDIR, "docs/lane-state.md"));
const COMMIT_TOOL = "mcp__nimbalyst__developer_git_commit_proposal";
const fwd = (p) => p.replace(/\\/g, "/");
const postSession = `${runId}-post`;
sessions.push(postSession);

// One hook run: expect "" (silent), "note" (PostToolUse piece note), "deny" (PreToolUse) or "block" (Stop), each
// with words the text must hold
function hook(name, ev, expect, words = [], env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(ev),
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
  const out = r.stdout.trim();
  let ok = r.status === 0;
  try {
    if (expect === "") ok = ok && out === "";
    else {
      const j = JSON.parse(out);
      const t =
        expect === "note"
          ? j.hookSpecificOutput.hookEventName === "PostToolUse" &&
            j.hookSpecificOutput.additionalContext
          : expect === "ask"
            ? j.hookSpecificOutput.hookEventName === "UserPromptSubmit" &&
              j.hookSpecificOutput.additionalContext
            : expect === "deny"
              ? j.hookSpecificOutput.permissionDecision === "deny" &&
                j.hookSpecificOutput.permissionDecisionReason
              : j.decision === "block" && j.reason;
      ok = ok && typeof t === "string" && words.every((w) => t.includes(w));
    }
  } catch {
    ok = false;
  }
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${name}${ok ? "" : "  -> status " + r.status + ", out: " + out.slice(0, 200)}`,
  );
}
const NOTE_WORDS = [
  "A piece of work is committed",
  "handoff skill",
  "prompt queued",
  "wins over a context-guard",
];
function post(name, command, stdout, expectNote, extra = {}) {
  const ev = {
    hook_event_name: "PostToolUse",
    session_id: postSession,
    tool_name: "Bash",
    cwd: path.join(OPEN, "docs"),
    tool_input: { command },
    tool_response: { stdout, stderr: "", interrupted: false },
    ...extra,
  };
  hook(name, ev, expectNote ? "note" : "", NOTE_WORDS, extra.env);
}
const made =
  "[main 1a2b3c4] Brewery hall roof\n 3 files changed, 40 insertions(+)";
post("post-commit-made-notes", 'git commit -m "roof"', made, true);
post(
  "post-plan-named-folder-skipped-notes",
  `git -C "${fwd(PLANDIR)}" commit -m "x"`,
  made,
  true,
  { cwd: PLANDIR },
);
post(
  "post-commit-with-C-notes",
  `git -C "${fwd(OPEN)}" commit -am "x"`,
  made,
  true,
);
post(
  "post-root-commit-notes",
  'git commit -m "first"',
  "[master (root-commit) 9f8e7d6] first",
  true,
);
post(
  "post-commit-in-chain-notes",
  'git add a && git commit -m "x" && git log -1',
  "[feat/x 0abcdef1] x\n1 file changed",
  true,
);
post("post-string-response-notes", 'git commit -m "x"', null, true, {
  tool_response: made,
});
post(
  "post-detached-head-notes",
  'git commit -m "x"',
  "[detached HEAD 1a2b3c4] x",
  true,
);
post(
  "post-dash-c-config-notes",
  'git -c user.name=x --no-pager commit -m "x"',
  made,
  true,
);
post(
  "post-merge-notes",
  "git merge --no-ff step-3",
  "Merge made by the 'ort' strategy.\n a | 1 +",
  true,
);
post(
  "post-fast-forward-merge-notes",
  "git merge step-3",
  "Updating 1a2b3c4..5d6e7f8\nFast-forward\n a | 1 +",
  true,
);
// A merge that stopped, nothing to commit, or a commit refused by a git hook leaves HEAD as it was (STALE: 10 min old)
post(
  "post-merge-conflict-silent",
  "git merge step-3",
  "Auto-merging a\nCONFLICT (content): Merge conflict in a",
  false,
  { cwd: STALE },
);
post("post-amend-silent", "git commit --amend --no-edit", made, false);
post(
  "post-nothing-to-commit-silent",
  'git commit -m "x"',
  "On branch main\nnothing to commit, working tree clean",
  false,
  { cwd: STALE },
);
post("post-hook-refused-commit-silent", 'git commit -m "x"', "", false, {
  cwd: STALE,
});
// The detection fix: a quiet commit prints nothing; rows named with letters; the Nimbalyst commit tool; cd into the
// repository; a commit of only the plan file and HANDOFF.md is the State update, not a piece
post("post-quiet-commit-notes", 'git commit -q -m "S1"', "", true);
post(
  "post-quiet-commit-letter-rows-notes",
  'git commit -q -m "BH1"',
  "",
  true,
  { cwd: LETTERS },
);
post(
  "post-cd-into-open-project-notes",
  `cd "${fwd(OPEN)}" && git commit -q -m "x"`,
  "",
  true,
  { cwd: NONE },
);
post(
  "post-cd-into-project-without-plan-silent",
  `cd "${fwd(NONE)}" && git commit -q -m "x"`,
  "",
  false,
  { cwd: TICKED },
);
post("post-nimbalyst-commit-tool-notes", null, null, true, {
  tool_name: COMMIT_TOOL,
  tool_input: { filesToStage: ["src/a.txt"], commitMessage: "S1" },
  tool_response: "Committed 1a2b3c4",
});
post(
  "post-plan-only-commit-silent",
  'git commit -q -m "plan: S3 done"',
  "",
  false,
  { cwd: PLANONLY },
);
// The tracker line: the piece note asks to update the step's tracker item; a records-only commit gets no note, so no line
hook(
  "post-note-has-tracker-line",
  {
    hook_event_name: "PostToolUse",
    session_id: postSession,
    tool_name: "Bash",
    cwd: path.join(OPEN, "docs"),
    tool_input: { command: 'git commit -m "roof"' },
    tool_response: { stdout: made, stderr: "", interrupted: false },
  },
  "note",
  [
    "Update the step's tracker item",
    "proof (the commit and session id)",
    "done only once the row's Done when check passed",
    "in-review",
  ],
);
{
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      hook_event_name: "PostToolUse",
      session_id: postSession,
      tool_name: "Bash",
      cwd: PLANONLY,
      tool_input: { command: 'git commit -q -m "plan: S3 done"' },
      tool_response: { stdout: "", stderr: "", interrupted: false },
    }),
    encoding: "utf8",
  });
  const ok = r.status === 0 && !r.stdout.includes("tracker item");
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  post-records-only-no-tracker-line${ok ? "" : "  -> status " + r.status + ", out: " + r.stdout.slice(0, 200)}`,
  );
}
post("post-git-log-silent", "git log --oneline -3", "1a2b3c4 x", false);
post("post-commit-word-in-echo-silent", 'echo "[main 1a2b3c4] x"', made, false);
post("post-non-bash-silent", 'git commit -m "x"', made, false, {
  tool_name: "Edit",
});
post("post-subagent-silent", 'git commit -m "x"', made, false, {
  agent_id: "abc",
});
post("post-off-switch", 'git commit -m "x"', made, false, {
  env: { JOB_DONE: "off" },
});
post("post-no-plan-silent", 'git commit -m "x"', made, false, { cwd: NONE });
post("post-plan-older-than-48h-silent", 'git commit -m "x"', made, false, {
  cwd: OLD,
});
post("post-only-ticked-boxes-silent", 'git commit -m "x"', made, false, {
  cwd: TICKED,
});
// A "docs" that is a file, not a folder: silent and no crash (a crash also exits 0, so the crash log is checked)
const docsCrashLog = path.join(dir, "docsfile-crash.log");
post("post-docs-is-a-file-silent", 'git commit -m "x"', made, false, {
  cwd: project("docsfile", { docs: "not a folder\n" }),
  env: { HOOK_ERRORS_LOG: docsCrashLog },
});
{
  const ok = !fs.existsSync(docsCrashLog);
  if (!ok) failed++;
  console.log(
    `${ok ? "PASS" : "FAIL"}  post-docs-is-a-file-no-crash${ok ? "" : "  -> " + fs.readFileSync(docsCrashLog, "utf8").trim()}`,
  );
}
post("post-handoff-unticked-notes", 'git commit -m "x"', made, true, {
  cwd: HANDOFF,
});
post(
  "post-dash-C-into-open-project-notes",
  `git -C "${OPEN.replace(/\\/g, "/")}" commit -m "x"`,
  made,
  true,
  { cwd: NONE },
);
post(
  "post-dash-C-into-project-without-plan-silent",
  `git -C "${NONE.replace(/\\/g, "/")}" commit -m "x"`,
  made,
  false,
  { cwd: TICKED },
);
post("post-no-git-folder-silent", 'git commit -m "x"', made, false, {
  cwd: os.tmpdir(),
});

// The claim (design option B): session abcd1234 claimed S3 in the plan's State cell; S3's commit landed 30 s ago.
// Each case runs in its own session (ids all start with abcd1234), so the refuse-once state of one doesn't touch another.
const CLAIM_PLAN = (s4) =>
  `| Step | Job | State |\n|---|---|---|\n| S3 | the hall | session abcd1234: S3, ends with commit + handoff |\n| S4 | build the cards | ${s4} |\n`;
const CLAIM = project(
  "claim",
  { "docs/2026-11-12-x-plan.md": CLAIM_PLAN("open") },
  30,
);
write(CLAIM, { "src/b.txt": "b\n" });
git(CLAIM, ["add", "src/b.txt"]); // the next piece's work, staged
const LAST = project(
  "last",
  { "docs/2026-11-12-x-plan.md": CLAIM_PLAN("done 2026-11-12 1a2b3c4") },
  30,
);
const OTHER = project("other", {}, 30);
const WT = path.join(dir, "claim-wt"); // a linked worktree of CLAIM: .git is a file
git(CLAIM, ["worktree", "add", "-q", WT, "-b", "wt-" + runId]);
commitNow(WT, { "src/c.txt": "c\n" }, 5);
let caseN = 0;
const claimSession = (id = "abcd1234") => {
  const s = `${id}-${runId}-${++caseN}`;
  sessions.push(s);
  return s;
};
const ev = (session_id, cwd, hook_event_name, extra) => ({
  session_id,
  cwd,
  hook_event_name,
  transcript_path: path.join(dir, "none.jsonl"),
  ...extra,
});
const landed = (name, s, cwd = CLAIM, expect = "note") =>
  hook(
    name,
    ev(s, cwd, "PostToolUse", {
      tool_name: "Bash",
      tool_input: { command: 'git commit -q -m "S3"' },
      tool_response: { stdout: "", stderr: "" },
    }),
    expect,
    expect ? NOTE_WORDS : [],
  );
const agent = (s, description, cwd = CLAIM) =>
  ev(s, cwd, "PreToolUse", {
    tool_name: "Agent",
    tool_input: { description, prompt: "x" },
  });
const bashPre = (s, command, cwd = CLAIM) =>
  ev(s, cwd, "PreToolUse", { tool_name: "Bash", tool_input: { command } });
const HELD = ["S3", "is done", "handoff skill", "send it again"];

let s = claimSession();
landed("claim-1-piece-landed-notes", s);
hook(
  "claim-1-agent-for-next-row-denied",
  agent(s, "S4: build the cards"),
  "deny",
  [...HELD, "Starting S4"],
);
hook("claim-2-same-call-again-allowed", agent(s, "S4: build the cards"), "");
s = claimSession();
landed("claim-3-piece-landed-notes", s);
hook(
  "claim-3-second-commit-denied",
  bashPre(s, 'git commit -q -m "cards part"'),
  "deny",
  [...HELD, "second commit"],
);
hook(
  "claim-3-second-commit-resent-allowed",
  bashPre(s, 'git commit -q -m "cards part"'),
  "",
);
s = claimSession();
landed("claim-3b-piece-landed-notes", s);
hook(
  "claim-3-plan-only-commit-allowed",
  bashPre(s, 'git commit -q -m "plan: hall done" -- docs/2026-11-12-x-plan.md'),
  "",
);
hook(
  "claim-3-plan-and-handoff-by-tool-allowed",
  ev(s, CLAIM, "PreToolUse", {
    tool_name: COMMIT_TOOL,
    tool_input: {
      filesToStage: ["docs/2026-11-12-x-plan.md", "HANDOFF.md"],
      commitMessage: "plan",
    },
  }),
  "",
);
hook("claim-agent-without-a-row-allowed", agent(s, "Review the diff"), "");
hook("claim-agent-for-own-row-allowed", agent(s, "S3: check the hall"), "");
hook(
  "claim-stage-end-commit-in-other-repo-allowed",
  bashPre(s, `git -C "${fwd(OTHER)}" commit -q -m "stage end"`),
  "",
);
hook(
  "claim-commit-by-tool-denied",
  ev(s, CLAIM, "PreToolUse", {
    tool_name: COMMIT_TOOL,
    tool_input: { filesToStage: ["src/b.txt"], commitMessage: "cards" },
  }),
  "deny",
  HELD,
);
s = claimSession();
hook(
  "claim-before-piece-landed-allowed",
  bashPre(s, 'git commit -q -m "hall"'),
  "",
);
s = claimSession("ffff0000");
landed("claim-4-no-claim-piece-notes", s);
hook("claim-4-no-claim-agent-silent", agent(s, "S4: build the cards"), "");
hook(
  "claim-4-no-claim-commit-silent",
  bashPre(s, 'git commit -q -m "cards part"'),
  "",
);
hook(
  "claim-4-no-claim-stop-silent",
  ev(s, CLAIM, "Stop", {
    stop_hook_active: false,
    transcript_path: path.join(dir, "stop.jsonl"),
  }),
  "",
);
s = claimSession();
landed("claim-5-last-row-piece-notes", s, LAST);
hook(
  "claim-5-last-open-row-agent-silent",
  agent(s, "S4: build the cards", LAST),
  "",
);
hook(
  "claim-5-last-open-row-commit-silent",
  bashPre(s, 'git commit -q -m "more"', LAST),
  "",
);
hook(
  "claim-5-last-open-row-stop-silent",
  ev(s, LAST, "Stop", {
    stop_hook_active: false,
    transcript_path: path.join(dir, "stop.jsonl"),
  }),
  "",
);

// Stop (design option A cases 2-4, for a session with a claim): a turn that ends after the piece with no hand-off is
// blocked once; stop_hook_active passes; a hand-off call after the piece passes; a linked worktree's commit is no piece
// The turn's entries are dated after the piece is recorded (a minute ahead, so the runs before them don't overtake it)
const afterPiece = (lines) =>
  lines
    .map((l) =>
      JSON.stringify({
        ...JSON.parse(l),
        timestamp: new Date(Date.now() + 60e3).toISOString(),
      }),
    )
    .join("\n") + "\n";
fs.writeFileSync(
  path.join(dir, "stop.jsonl"),
  afterPiece([
    user("build S3"),
    asst(60000, bash('git commit -q -m "S3"')),
    toolResult(),
    asst(60000, text("S3 committed")),
  ]),
);
fs.writeFileSync(
  path.join(dir, "handed.jsonl"),
  afterPiece([
    user("build S3"),
    asst(60000, bash('git commit -q -m "S3"')),
    toolResult(),
    asst(60000, skill("handoff")),
    toolResult(),
    asst(60000, text("handed off")),
  ]),
);
const stop = (s, cwd, active, transcript = "stop.jsonl") =>
  ev(s, cwd, "Stop", {
    stop_hook_active: active,
    transcript_path: path.join(dir, transcript),
  });
s = claimSession();
landed("stop-2-piece-landed-notes", s);
hook("stop-2-no-handoff-blocked", stop(s, CLAIM, false), "block", [
  "[job-done]",
  "S3",
  "handoff skill",
]);
hook("stop-2-second-stop-same-piece-silent", stop(s, CLAIM, false), "");
s = claimSession();
landed("stop-3-piece-landed-notes", s);
hook("stop-3-stop-hook-active-silent", stop(s, CLAIM, true), "");
s = claimSession();
landed("stop-handed-off-piece-notes", s);
hook("stop-handed-off-silent", stop(s, CLAIM, false, "handed.jsonl"), "");
s = claimSession();
landed("stop-4-linked-worktree-commit-silent", s, WT, "");
hook("stop-4-linked-worktree-stop-silent", stop(s, WT, false), "");
hook(
  "stop-4-linked-worktree-commit-pre-silent",
  bashPre(s, 'git commit -q -m "more"', WT),
  "",
);
hook("stop-off-switch", stop(s, CLAIM, false), "", [], { JOB_DONE: "off" });

// The id note (UserPromptSubmit): a main session in a folder with an open plan and no claim of its own is told its
// id's first 8 characters once, so it can write the claim
const ask = (s, cwd, extra = {}) =>
  ev(s, cwd, "UserPromptSubmit", { prompt: "run the next row", ...extra });
s = claimSession("ee112233");
hook("id-note-names-prefix-and-plan", ask(s, path.join(CLAIM, "docs")), "ask", [
  "[job-done] This session's id starts with ee112233.",
  "row of docs/2026-11-12-x-plan.md",
  "`session ee112233: <row>`",
  "lane's state file",
]);
hook("id-note-second-prompt-silent", ask(s, CLAIM), "");
hook("id-note-no-open-plan-silent", ask(claimSession("ee112244"), NONE), "");
hook("id-note-claim-exists-silent", ask(claimSession(), CLAIM), "");
hook(
  "id-note-subagent-silent",
  ask(claimSession("ee112255"), CLAIM, { agent_id: "abc" }),
  "",
);
// A side session keeps its claim in its lane state file beside the plan (plan section 7): found, and held as in the plan
const LANE = project(
  "lane",
  {
    "docs/2026-11-12-x-plan.md": CLAIM_PLAN("open").replace(
      "session abcd1234: S3, ends with commit + handoff",
      "open",
    ),
    "docs/2026-11-12-state-d.md":
      "## Lane D\n\nsession cafe0001: S3, ends with commit + handoff\n",
  },
  30,
);
s = claimSession("cafe0001");
hook("state-file-claim-no-id-note", ask(s, LANE), "");
landed("state-file-claim-piece-notes", s, LANE);
hook(
  "state-file-claim-second-commit-denied",
  bashPre(s, 'git commit -q -m "cards part"', LANE),
  "deny",
  [...HELD, "2026-11-12-x-plan.md"],
);

// The claim outlives the State update: S3's commit landed, then its State cell became "done …" without the claim line
const SURV = project(
  "survive",
  {
    "docs/2026-11-12-x-plan.md": CLAIM_PLAN("open").replace(
      "abcd1234",
      "d0d0d0d0",
    ),
  },
  30,
);
const survA = claimSession("d0d0d0d0"),
  survB = claimSession("d0d0d0d0");
landed("claim-kept-piece-a-notes", survA, SURV);
landed("claim-kept-piece-b-notes", survB, SURV);
write(SURV, {
  "docs/2026-11-12-x-plan.md": CLAIM_PLAN("open").replace(
    "session abcd1234: S3, ends with commit + handoff",
    "done 2026-11-12 1a2b3c4",
  ),
});
hook(
  "claim-kept-after-state-done-agent-denied",
  agent(survA, "S4: build the cards", SURV),
  "deny",
  [
    ...HELD,
    "`done <hash>, session d0d0d0d0: S3`",
    "keep the claim in the cell",
  ],
);
hook(
  "claim-kept-after-state-done-commit-denied",
  bashPre(survB, 'git commit -q -m "cards part"', SURV),
  "deny",
  HELD,
);
hook("claim-kept-stop-blocked", stop(survB, SURV, false), "block", [
  "S3",
  "keep the claim in the cell",
  "handoff skill",
]);
// Records (plan files, lane state files, progress.md, HANDOFF.md) are never a piece and never refused
s = claimSession("cafe0001");
landed("records-lane-piece-notes", s, LANE);
hook(
  "records-state-and-progress-commit-allowed",
  bashPre(
    s,
    'git commit -q -m "lane D: hall done" docs/2026-11-12-state-d.md docs/progress.md',
    LANE,
  ),
  "",
);
// Marking a row done usually also writes the user's answers into DECISIONS.md: still records only
hook(
  "records-decisions-with-plan-commit-allowed",
  bashPre(
    s,
    'git commit -q -m "hall done" docs/2026-11-12-state-d.md DECISIONS.md docs/decisions-archive.md',
    LANE,
  ),
  "",
);
hook(
  "records-refusal-not-used-up-denied",
  bashPre(s, 'git commit -q -m "cards part"', LANE),
  "deny",
  HELD,
);
const LANEB = project(
  "laneb",
  {
    "docs/2026-11-12-x-plan.md": CLAIM_PLAN("open").replace(
      "session abcd1234: S3, ends with commit + handoff",
      "open",
    ),
  },
  600,
);
commitNow(LANEB, {
  "docs/2026-11-12-state-d.md":
    "session cafe0002: S3, ends with commit + handoff\n",
});
s = claimSession("cafe0002");
landed("records-claim-commit-no-piece-silent", s, LANEB, "");
hook(
  "records-row-first-commit-allowed",
  bashPre(s, 'git commit -q -m "hall work"', LANEB),
  "",
);
// Paths given to git commit without "--"; a merge-base or commit-graph call is no commit; the -C of another git call
// in the command is not the commit's folder
const CLAIM2 = project(
  "claim2",
  { "docs/2026-11-12-x-plan.md": CLAIM_PLAN("open") },
  30,
);
s = claimSession();
landed("paths-piece-notes", s, CLAIM2);
hook(
  "paths-plan-commit-without-dashes-allowed",
  bashPre(
    s,
    'git commit -q -m "plan: hall done" docs/2026-11-12-x-plan.md',
    CLAIM2,
  ),
  "",
);
hook(
  "paths-code-commit-without-dashes-denied",
  bashPre(
    s,
    'git commit -q -m "cards" src/b.txt docs/2026-11-12-x-plan.md',
    CLAIM2,
  ),
  "deny",
  HELD,
);
post(
  "post-git-merge-base-silent",
  "git merge-base main HEAD",
  "1a2b3c4",
  false,
);
post("post-git-commit-graph-silent", "git commit-graph write", "", false);
post(
  "post-dash-C-of-other-git-call-ignored-notes",
  `git -C "${fwd(STALE)}" log -1 && git commit -q -m "x"`,
  "",
  true,
);

// Commit subject (PreToolUse, every time, helpers too): over 72 characters, an open row's id as the plan writes it,
// or a session id is refused; done rows, plans older than 48 hours and other casings refuse nothing
const SUBJ_PLAN = (v2) =>
  `| Step | Job | State |\n|---|---|---|\n| V2 | the layout | ${v2} |\n| S3 | read keys | done 2026-11-13 1a2b3c4 |\n`;
const SUBJ = project("subj", {
  "docs/2026-11-13-s-plan.md": SUBJ_PLAN("open"),
});
const SUBJ_DONE = project("subj-done", {
  "docs/2026-11-13-s-plan.md": SUBJ_PLAN("done 1a2b3c4"),
});
const SUBJ_OLD = project("subj-old", {
  "docs/2026-11-13-s-plan.md":
    "| Step | Job | State |\n|---|---|---|\n| S3 | read keys | open |\n",
});
fs.utimesSync(path.join(SUBJ_OLD, "docs/2026-11-13-s-plan.md"), old, old);
const subjSession = `${runId}-subj`;
sessions.push(subjSession);
const pre = (cwd, tool_input, extra = {}) =>
  ev(subjSession, cwd, "PreToolUse", {
    tool_name: "Bash",
    tool_input,
    ...extra,
  });
const commitPre = (cwd, message, extra) =>
  pre(cwd, { command: `git commit -q -m ${JSON.stringify(message)}` }, extra);
const toolPre = (cwd, commitMessage) =>
  pre(
    cwd,
    { filesToStage: ["src/a.txt"], commitMessage },
    { tool_name: COMMIT_TOOL },
  );
const REWORD = ["Commit refused", "<type>: <what the person gains>"];
const long = "feat: " + "a".repeat(84);
hook("subject-90-chars-denied", commitPre(NONE, long), "deny", [
  ...REWORD,
  "90 characters",
  "72",
]);
hook("subject-72-chars-allowed", commitPre(NONE, long.slice(0, 72)), "");
hook(
  "subject-open-row-id-denied",
  commitPre(SUBJ, "feat: V2 layout for the cards"),
  "deny",
  [...REWORD, "2026-11-13-s-plan.md", "row V2"],
);
hook(
  "subject-open-row-id-of-commit-repo-denied",
  pre(NONE, {
    command: `cd "${fwd(SUBJ)}" && git commit -q -m "feat: V2 layout for the cards"`,
  }),
  "deny",
  ["row V2"],
);
hook(
  "subject-done-row-id-allowed",
  commitPre(SUBJ_DONE, "feat: V2 layout for the cards"),
  "",
);
hook(
  "subject-S3-of-done-row-allowed",
  commitPre(SUBJ, "fix: read S3 keys once"),
  "",
);
hook(
  "subject-S3-of-plan-over-48h-allowed",
  commitPre(SUBJ_OLD, "fix: read S3 keys once"),
  "",
);
hook("subject-other-casing-allowed", commitPre(SUBJ, "fix: v2 layout"), "");
hook("subject-clear-allowed", commitPre(SUBJ, "fix: steadier card layout"), "");
hook(
  "subject-helper-commit-denied",
  commitPre(SUBJ, "feat: V2 layout for the cards", { agent_id: "abc" }),
  "deny",
  ["row V2"],
);
hook(
  "subject-helper-commit-denied-again",
  commitPre(SUBJ, "feat: V2 layout for the cards", { agent_id: "abc" }),
  "deny",
  ["row V2"],
);
hook(
  "subject-commit-tool-denied",
  toolPre(SUBJ, "feat: V2 layout\n\nbody"),
  "deny",
  ["row V2"],
);
hook(
  "subject-commit-tool-clear-allowed",
  toolPre(SUBJ, "fix: steadier layout"),
  "",
);
hook(
  "subject-heredoc-denied",
  pre(SUBJ, {
    command: `git commit -q -m "$(cat <<'EOF'\nfeat: V2 layout\n\nWhy it changed.\nEOF\n)"`,
  }),
  "deny",
  ["row V2"],
);
// A " inside a heredoc message must not end it early and let the commit through unchecked
const heredoc = (open, text, close = "EOF") =>
  pre(NONE, {
    command: `git commit -q -m "$(cat <<${open}\n${text}\n${close}\n)"`,
  });
hook(
  "subject-heredoc-quote-in-body-90-chars-denied",
  heredoc("'EOF'", `${long}\n\nSay "hello" to the new layout.`),
  "deny",
  ["90 characters"],
);
hook(
  "subject-heredoc-quote-in-body-allowed",
  heredoc("'EOF'", 'fix: steadier layout\n\nSay "hello" to it.'),
  "",
);
hook(
  "subject-heredoc-quote-in-subject-checked",
  pre(SUBJ, {
    command: `git commit -q -m "$(cat <<'EOF'\nfeat: V2 "layout"\n\nWhy.\nEOF\n)"`,
  }),
  "deny",
  ["row V2"],
);
for (const [name, open, close] of [
  ["unquoted", "EOF", "EOF"],
  ["double-quoted", '"MSG"', "MSG"],
  ["dash-tabs", "-END_MSG", "\tEND_MSG"],
])
  hook(
    `subject-heredoc-${name}-denied`,
    heredoc(open, `\t${long}\n\nSay "hi".`, close),
    "deny",
    ["90 characters"],
  );
hook(
  "subject-body-not-checked-allowed",
  pre(SUBJ, {
    command: 'git commit -q -m "fix: steadier layout\n\nRow V2 of the plan."',
  }),
  "",
);
hook(
  "subject-session-id-denied",
  commitPre(NONE, "fix: notes of session 1a2b3c4d"),
  "deny",
  ["session id"],
);
hook(
  "subject-own-session-id-denied",
  commitPre(NONE, `fix: notes from ${subjSession.slice(0, 8)}`),
  "deny",
  ["this session's id"],
);
hook(
  "subject-file-message-not-checked",
  pre(SUBJ, { command: "git commit -q -F V2.txt" }),
  "",
);
hook(
  "subject-merge-not-checked",
  pre(SUBJ, { command: 'git merge -m "V2" dev' }),
  "",
);
for (const [name, event] of [
  ["long", commitPre(NONE, long)],
  ["open-row", commitPre(SUBJ, "feat: V2 layout")],
  ["tool", toolPre(SUBJ, "feat: V2 layout")],
  ["session", commitPre(NONE, "fix: notes of session 1a2b3c4d")],
  ["helper", commitPre(SUBJ, "feat: V2 layout", { agent_id: "abc" })],
])
  hook(`subject-off-switch-${name}-allowed`, event, "", [], {
    COMMIT_SUBJECT: "off",
  });

fs.rmSync(dir, { recursive: true, force: true });
for (const s of sessions)
  fs.rmSync(path.join(stateDir, s + ".json"), { force: true });
console.log(failed ? `\n${failed} FAILED` : "\nall passed");
process.exit(failed ? 1 : 0);
