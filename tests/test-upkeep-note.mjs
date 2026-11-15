// Test for hooks/upkeep-note.mjs: temp project folders (most with git), the hook run as a child process with a
// PostToolUse event on stdin, HOME and USERPROFILE pointed at a temp home so its state never lands in the real ~/.claude.
process.env.HOOK_ERRORS_LOG = "off"; // junk input must not leave lines in the hooks' crash log

import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fileKey } from "../hooks/lib/paths.mjs";

const HOOK = fileURLToPath(
  new URL("../hooks/upkeep-note.mjs", import.meta.url),
);
const base = fs.mkdtempSync(
  path.join(os.tmpdir(), `upkeep-note-test-t${process.pid}-${Date.now()}-`),
);
const home = path.join(base, "home");
fs.mkdirSync(home);
const stateDir = path.join(home, ".claude", "hooks", "state", "upkeep-note");
const ENV = {
  ...process.env,
  HOME: home,
  USERPROFILE: home,
  HOOK_ERRORS_LOG: "off",
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@users.noreply.github.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@users.noreply.github.com",
};
delete ENV.CLAUDE_PROJECT_DIR; // the open project would win over the event's cwd
delete ENV.UPKEEP_NOTE;
delete ENV.GIT_DIR;
delete ENV.GIT_WORK_TREE;

let failed = 0;
let passed = 0;
const notes = []; // every note produced, for the no-question case
function ok(name, cond, detail = "") {
  if (cond) {
    passed++;
    console.log(`ok   ${name}`);
  } else {
    failed++;
    console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
  }
}

const lines = (n, word = "line") =>
  Array.from({ length: n }, (_, i) => `${word} ${i + 1}`).join("\n") + "\n";
let k = 0;
function folder(files, { git = true } = {}) {
  const dir = path.join(base, `p${++k}`);
  write(dir, files);
  if (git) sh(dir, ["init", "-q"]);
  return dir;
}
function write(dir, files) {
  for (const [name, text] of Object.entries(files)) {
    const f = path.join(dir, name);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, text);
  }
}
function sh(dir, args, env = {}) {
  const r = spawnSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    env: { ...ENV, ...env },
  });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} in ${dir}: ${r.stderr}`);
  return r.stdout;
}
const commit = (dir, env = {}) => {
  sh(dir, ["add", "-A"]);
  sh(dir, ["commit", "-q", "--allow-empty", "-m", "x"], env);
};

// runs the hook; {status, ctx}: ctx the note text, or "" when silent
function hook(event, env = {}) {
  const r = spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify({
      session_id: "s1",
      hook_event_name: "PostToolUse",
      ...event,
    }),
    encoding: "utf8",
    env: { ...ENV, ...env },
  });
  const out = r.stdout.trim();
  const ctx = out
    ? (JSON.parse(out).hookSpecificOutput?.additionalContext ?? "")
    : "";
  if (ctx) notes.push(ctx);
  return { status: r.status, ctx, err: r.stderr };
}
const onCommit = (dir, command = "git commit -m x", extra = {}) =>
  hook({ tool_name: "Bash", tool_input: { command }, cwd: dir, ...extra });
const onEdit = (dir, file, tool = "Edit") =>
  hook({ tool_name: tool, tool_input: { file_path: file }, cwd: dir });

// the state file whose root is this folder, or null
function stateOf(dir) {
  if (!fs.existsSync(stateDir)) return null;
  for (const n of fs.readdirSync(stateDir).filter((x) => x.endsWith(".json"))) {
    const s = JSON.parse(fs.readFileSync(path.join(stateDir, n), "utf8"));
    if (s.root === fileKey(dir)) return { file: path.join(stateDir, n), s };
  }
  return null;
}
const localDay = (d) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
const today = localDay(new Date());
function toYesterday(dir) {
  const { file, s } = stateOf(dir);
  s.day = localDay(new Date(Date.now() - 86400000));
  fs.writeFileSync(file, JSON.stringify(s));
}
const silent = (r) => r.status === 0 && r.ctx === "";

try {
  const LONG = lines(130);
  const DEC =
    "# Decisions\n\n## 2026-03-01 Use npm\nAll builds use npm.\n\n## 2026-01-02 Use make\nAll builds use make.\n";
  const addDecision = (dir, line) =>
    fs.writeFileSync(
      path.join(dir, "DECISIONS.md"),
      DEC.replace(
        "# Decisions\n\n",
        `# Decisions\n\n## 2026-11-13 New\n${line}\n\n`,
      ),
    );

  // 1, 3, 4: the note, then silence the same day, then told again the next day
  const p1 = folder({ "HANDOFF.md": LONG });
  commit(p1);
  let r = onCommit(p1);
  ok(
    "1 no plan file: long HANDOFF and a commit give the note",
    r.ctx.startsWith("Upkeep for this project (") &&
      r.ctx.includes("HANDOFF.md: 130 lines") &&
      r.ctx.includes('"Upkeep:"') &&
      r.ctx.includes(`## Cut ${today}`) &&
      stateOf(p1)?.s.day === today,
    r.ctx || r.err,
  );
  fs.appendFileSync(path.join(p1, "HANDOFF.md"), "one more\n");
  commit(p1);
  ok("3 second trigger the same day is silent", silent(onCommit(p1)));
  toYesterday(p1);
  commit(p1);
  r = onCommit(p1);
  ok(
    "4 next day it is told again",
    r.ctx.includes("HANDOFF.md: 131 lines") && stateOf(p1).s.day === today,
    r.ctx,
  );

  const p2 = folder({ "HANDOFF.md": lines(120) });
  commit(p2);
  ok("2 120 lines is silent", silent(onCommit(p2)) && !stateOf(p2));

  // 5, 6, 7: the edit trigger
  const p5 = folder({ "HANDOFF.md": LONG });
  r = onEdit(p5, path.join(p5, "HANDOFF.md"));
  ok(
    "5 an edit of HANDOFF.md gives the note",
    r.ctx.includes("HANDOFF.md: 130 lines"),
    r.ctx || r.err,
  );
  const p6 = folder({ "HANDOFF.md": LONG, "notes.md": "x\n" });
  ok(
    "6 an edit of another file is silent",
    silent(onEdit(p6, path.join(p6, "notes.md"))) && !stateOf(p6),
  );
  const p7 = folder({ "HANDOFF.md": "short\n", "docs/HANDOFF.md": LONG });
  ok(
    "7 HANDOFF.md in a subfolder is silent",
    silent(onEdit(p7, path.join(p7, "docs", "HANDOFF.md"), "Write")),
  );

  // 8-15: who and what stays silent, and the Nimbalyst commit tool
  const p8 = folder({ "HANDOFF.md": LONG });
  commit(p8);
  ok("8 helper is silent", silent(onCommit(p8, undefined, { agent_id: "a1" })));
  const p9 = folder({ "HANDOFF.md": "short\n" });
  commit(p9);
  const wt = path.join(base, "wt9");
  sh(p9, ["worktree", "add", "-q", wt]);
  fs.writeFileSync(path.join(wt, "HANDOFF.md"), LONG);
  commit(wt);
  ok("9 linked worktree is silent", silent(onCommit(wt)) && !stateOf(wt));
  const p10 = folder({ "HANDOFF.md": LONG });
  commit(p10);
  ok(
    "10 off switch is silent",
    silent(
      hook(
        {
          tool_name: "Bash",
          tool_input: { command: "git commit -m x" },
          cwd: p10,
        },
        { UPKEEP_NOTE: "off" },
      ),
    ) && !stateOf(p10),
  );
  write(home, { "HANDOFF.md": LONG });
  sh(home, ["init", "-q"]);
  sh(home, ["add", "HANDOFF.md"]);
  sh(home, ["commit", "-q", "-m", "x"]);
  ok("11 home folder is silent", silent(onCommit(home)) && !stateOf(home));
  const p12 = folder({ "HANDOFF.md": LONG });
  const old = new Date(Date.now() - 10 * 60000).toISOString();
  commit(p12, { GIT_COMMITTER_DATE: old, GIT_AUTHOR_DATE: old });
  ok("12 old commit is silent", silent(onCommit(p12)));
  const p13 = folder({ "HANDOFF.md": LONG });
  commit(p13);
  ok(
    "13 amend is silent",
    silent(onCommit(p13, "git commit --amend --no-edit")),
  );
  const p14a = folder({ "HANDOFF.md": LONG });
  const p14b = folder({ "HANDOFF.md": "short\n" });
  commit(p14a);
  commit(p14b);
  ok(
    "14 commit in another repository is silent",
    silent(
      onCommit(p14a, `git -C "${p14b.replace(/\\/g, "/")}" commit -m x`),
    ) && !stateOf(p14a),
  );
  const p15 = folder({ "HANDOFF.md": LONG });
  commit(p15);
  r = hook({
    tool_name: "mcp__nimbalyst__developer_git_commit_proposal",
    tool_input: {},
    cwd: p15,
  });
  ok(
    "15 Nimbalyst commit tool triggers",
    r.ctx.includes("HANDOFF.md: 130 lines"),
    r.ctx || r.err,
  );

  // 15b-15d: the size limit and the once-per-session HANDOFF note
  const pBig = folder({ "HANDOFF.md": lines(40, "x".repeat(400)) }); // 40 lines, ~16 KB
  commit(pBig);
  r = onCommit(pBig);
  ok(
    "15b few lines but over 12 KB gives the note",
    r.ctx.includes("HANDOFF.md: 40 lines, 16 KB, over the limit"),
    r.ctx || r.err,
  );
  const pSes = folder({
    "HANDOFF.md": LONG,
    "CLAUDE.md": "See `docs/gone.md`.\n",
  });
  commit(pSes);
  const first = onCommit(pSes);
  commit(pSes);
  r = onCommit(pSes, undefined, { session_id: "s2" });
  ok(
    "15c a second session the same day is told of HANDOFF.md only",
    first.ctx.includes("docs/gone.md") &&
      r.ctx.includes("HANDOFF.md: 130 lines") &&
      !r.ctx.includes("docs/gone.md"),
    r.ctx || r.err,
  );
  commit(pSes);
  ok(
    "15d that session is not told twice",
    silent(onCommit(pSes, undefined, { session_id: "s2" })),
  );
  fs.writeFileSync(path.join(pSes, "HANDOFF.md"), "short\n");
  commit(pSes);
  ok(
    "15e a short HANDOFF.md gives a new session nothing",
    silent(onCommit(pSes, undefined, { session_id: "s3" })),
  );

  // 16, 17: dead paths
  const p16 = folder({
    "CLAUDE.md": "See `docs/gone.md` for it.\n",
    "HANDOFF.md": "short\n",
  });
  commit(p16);
  r = onCommit(p16);
  const first16 =
    r.ctx.includes("- `docs/gone.md` (CLAUDE.md:1)") &&
    !r.ctx.includes("HANDOFF.md:");
  toYesterday(p16);
  commit(p16);
  ok("16 a path is told once", first16 && silent(onCommit(p16)), r.ctx);
  const p17 = folder({
    "CLAUDE.md":
      [1, 2, 3, 4, 5, 6, 7].map((i) => `- \`docs/g${i}.md\``).join("\n") + "\n",
  });
  commit(p17);
  r = onCommit(p17);
  const named = (t) =>
    [1, 2, 3, 4, 5, 6, 7].filter((i) => t.includes(`\`docs/g${i}.md\``));
  const firstNamed = named(r.ctx);
  const firstState = stateOf(p17).s.paths.length;
  toYesterday(p17);
  commit(p17);
  r = onCommit(p17);
  ok(
    "17 at most 5 paths per note",
    firstNamed.join() === "1,2,3,4,5" &&
      firstState === 5 &&
      named(r.ctx).join() === "6,7",
    `${firstNamed} / ${firstState} / ${named(r.ctx)}`,
  );

  // 18-21: decision lines
  const p18 = folder({ "DECISIONS.md": DEC });
  commit(p18);
  addDecision(p18, "Builds use npm. Replaces the 2026-01-02 entry below.");
  commit(p18);
  r = onCommit(p18);
  const first18 = r.ctx.includes(
    '- DECISIONS.md:4: "Builds use npm. Replaces the 2026-01-02 entry below."',
  );
  toYesterday(p18);
  write(p18, { "a.txt": "a\n" });
  commit(p18);
  ok(
    "18 a Replaces line added by the commit is told once",
    first18 && silent(onCommit(p18)),
    r.ctx,
  );
  const p19 = folder({
    "HANDOFF.md": "short\n",
    "DECISIONS.md":
      DEC +
      "\n## 2025-12-01 Old\nReplaces the old way.\nThe strict preset is replaced by the shared one.\n",
  });
  commit(p19);
  write(p19, { "a.txt": "a\n" });
  commit(p19);
  ok(
    "19 an old Replaces line is silent",
    silent(onCommit(p19)) && !stateOf(p19),
  );
  const p20 = folder({ "HANDOFF.md": LONG, "DECISIONS.md": DEC });
  commit(p20);
  addDecision(p20, "Replaces the 2026-01-02 entry below.");
  r = onEdit(p20, path.join(p20, "HANDOFF.md"));
  ok(
    "20 an uncommitted Replaces line is told",
    r.ctx.includes("HANDOFF.md: 130 lines") &&
      r.ctx.includes('DECISIONS.md:4: "Replaces the 2026-01-02 entry below."'),
    r.ctx,
  );
  const p21 = folder(
    {
      "CLAUDE.md": "notes\n",
      "HANDOFF.md": LONG,
      "DECISIONS.md": DEC + "Replaces the make entry.\n",
    },
    { git: false },
  );
  r = onEdit(p21, path.join(p21, "HANDOFF.md"));
  ok(
    "21 no git: HANDOFF edit notes, no decision part",
    r.ctx.includes("HANDOFF.md: 130 lines") && !r.ctx.includes("DECISIONS.md:"),
    r.ctx || r.err,
  );

  // 22: nothing found writes no stamp
  const p22 = folder({ "HANDOFF.md": "short\n" });
  commit(p22);
  const quiet22 = silent(onCommit(p22)) && !stateOf(p22);
  write(p22, { "HANDOFF.md": LONG });
  commit(p22);
  ok(
    "22 nothing found writes no stamp",
    quiet22 && onCommit(p22).ctx.includes("HANDOFF.md: 130"),
  );

  // 23: no note asks a question, quoted question marks become (qm)
  const p23 = folder({
    "CLAUDE.md": "See `docs/what?.md`.\n",
    "DECISIONS.md": DEC,
  });
  commit(p23);
  addDecision(p23, "Replaces the make entry below?");
  commit(p23);
  r = onCommit(p23);
  ok(
    "23 the note asks no question",
    r.ctx.includes("`docs/what(qm).md`") &&
      r.ctx.includes('"Replaces the make entry below(qm)"') &&
      notes.length >= 12 && // cases 1, 4, 5, 15, 16, 17 twice, 18, 20, 21, 22, 23
      notes.every((t) => !t.includes("?")),
    `${notes.length} notes; ${r.ctx}`,
  );

  // 24: a broken state file fails open
  const p24 = folder({ "HANDOFF.md": LONG });
  commit(p24);
  fs.mkdirSync(stateDir, { recursive: true });
  const keyOf = (dir) =>
    `${fileKey(dir)
      .replace(/[^A-Za-z0-9-]/g, "-")
      .slice(
        0,
        100,
      )}-${crypto.createHash("sha1").update(fileKey(dir)).digest("hex").slice(0, 8)}`;
  fs.writeFileSync(path.join(stateDir, `${keyOf(p24)}.json`), "not json");
  r = onCommit(p24);
  ok(
    "24 a broken state file fails open",
    r.status === 0 &&
      r.ctx.includes("HANDOFF.md: 130 lines") &&
      stateOf(p24)?.s.day === today,
    r.ctx || r.err,
  );

  // 25: a PowerShell commit triggers
  const p25 = folder({ "HANDOFF.md": LONG });
  commit(p25);
  r = hook({
    tool_name: "PowerShell",
    tool_input: { command: "git commit -m x" },
    cwd: p25,
  });
  ok(
    "25 a PowerShell commit triggers",
    r.ctx.includes("HANDOFF.md: 130 lines"),
    r.ctx || r.err,
  );

  // 26: a project in a subfolder of a bigger repository, with its own DECISIONS.md
  const p26 = folder({
    "README.md": "big repo\n",
    "app/CLAUDE.md": "notes\n",
    "app/HANDOFF.md": LONG,
    "app/DECISIONS.md": DEC,
  });
  commit(p26);
  const app = path.join(p26, "app");
  addDecision(app, "Replaces the 2026-01-02 entry below.");
  commit(p26);
  r = onCommit(app);
  ok(
    "26 a project in a subfolder of its repository triggers on a commit",
    r.ctx.includes("HANDOFF.md: 130 lines") &&
      r.ctx.includes(
        'DECISIONS.md:4: "Replaces the 2026-01-02 entry below."',
      ) &&
      stateOf(app)?.s.day === today &&
      !stateOf(p26),
    r.ctx || r.err,
  );

  // 27: a folder name with spaces, reached by cd; 28: cd into another repository before the commit is silent
  const gitFolder = (name) => {
    const dir = path.join(base, name);
    write(dir, { "HANDOFF.md": LONG });
    sh(dir, ["init", "-q"]);
    commit(dir);
    return dir;
  };
  const fwdOf = (p) => p.replace(/\\/g, "/");
  const p27 = gitFolder("my app");
  r = onCommit(p27, `cd "${fwdOf(p27)}" && git commit -m x`);
  ok(
    "27 a folder name with spaces triggers",
    r.ctx.includes("HANDOFF.md: 130 lines") &&
      r.ctx.includes(path.resolve(p27)) &&
      stateOf(p27)?.s.day === today,
    r.ctx || r.err,
  );
  const p28a = folder({ "HANDOFF.md": LONG });
  const p28b = folder({ "HANDOFF.md": "short\n" });
  commit(p28a);
  commit(p28b);
  ok(
    "28 cd into another repository, then commit, is silent",
    silent(onCommit(p28a, `cd "${fwdOf(p28b)}" && git commit -m x`)) &&
      !stateOf(p28a),
  );

  // 29: "my app" and "my_app" have state files of their own
  const p29 = gitFolder("my_app");
  r = onCommit(p29);
  ok(
    "29 folders whose keys differ only in a sign keep apart",
    r.ctx.includes("HANDOFF.md: 130 lines") &&
      stateOf(p27)?.file !== stateOf(p29)?.file &&
      stateOf(p29)?.s.day === today,
    r.ctx || r.err,
  );

  // 30-34: the root DECISIONS.md over 200 lines or 25,000 bytes gives the split command, once per session
  // a DECISIONS.md of exactly n lines and, when given, exactly `bytes` bytes (the last line padded); with a ## section
  const sized = (n, bytes = 0, { section = true } = {}) => {
    const head = section
      ? ["# Decisions", "", "## 2026-11-01 Work"]
      : ["# Decisions", ""];
    const all = [
      ...head,
      ...Array.from({ length: n - head.length }, (_, i) => `- e${i}`),
    ];
    const short = bytes - Buffer.byteLength(`${all.join("\n")}\n`);
    if (bytes) all[all.length - 1] += "x".repeat(short);
    return `${all.join("\n")}\n`;
  };
  const splitCmd = (dir) => `--split "${path.resolve(dir)}"`;
  const p30 = folder({ "DECISIONS.md": sized(201) });
  commit(p30);
  r = onCommit(p30);
  ok(
    "30a 201 lines gives the note with the split command and no commit order",
    r.ctx.includes(
      "DECISIONS.md: 201 lines, 1 KB, over the limit of 200 lines or 25 KB",
    ) &&
      r.ctx.includes(
        `skills${path.sep}file-upkeep${path.sep}decisions.mjs" ${splitCmd(p30)}`,
      ) &&
      r.ctx.includes("Never edit the moved text by hand.") &&
      !r.ctx.includes("Commit exactly"),
    r.ctx || r.err,
  );
  commit(p30);
  const again30 = onCommit(p30);
  commit(p30);
  r = onCommit(p30, undefined, { session_id: "s2" });
  ok(
    "30b a second commit in the same session is silent; a new session is told again",
    silent(again30) && r.ctx.includes(splitCmd(p30)),
    again30.ctx || r.ctx || r.err,
  );
  const p30c = folder({ "DECISIONS.md": sized(100, 25001) });
  commit(p30c);
  r = onCommit(p30c);
  ok(
    "30c 25,001 bytes in 100 lines gives the note",
    r.ctx.includes("DECISIONS.md: 100 lines, 25 KB, over the limit") &&
      r.ctx.includes(splitCmd(p30c)),
    r.ctx || r.err,
  );
  const p30d = folder({ "DECISIONS.md": sized(200, 25000) });
  commit(p30d);
  ok(
    "30d exactly 200 lines and 25,000 bytes is silent",
    silent(onCommit(p30d)) && !stateOf(p30d),
  );
  const p31 = folder({ "a.txt": "a\n" });
  commit(p31);
  write(p31, { "DECISIONS.md": sized(201) });
  sh(p31, ["commit", "-q", "--allow-empty", "-m", "x"]);
  ok(
    "31 over the limit but not tracked by git is silent",
    silent(onCommit(p31)) && !stateOf(p31),
  );
  const p32 = folder({
    "DECISIONS.md": sized(201, 0, { section: false }),
  });
  commit(p32);
  ok(
    "32 over the limit with no ## section is silent",
    silent(onCommit(p32)) && !stateOf(p32),
  );
  const p33 = folder({ "DECISIONS.md": sized(201) });
  commit(p33);
  const sha1Of = (f) =>
    crypto.createHash("sha1").update(fs.readFileSync(f)).digest("hex");
  const rootFile = path.join(p33, "DECISIONS.md");
  const failDir = path.join(home, ".claude", "hooks", "state", "decisions");
  fs.mkdirSync(failDir, { recursive: true });
  fs.writeFileSync(
    path.join(
      failDir,
      `${crypto.createHash("sha1").update(fileKey(p33)).digest("hex").slice(0, 16)}.json`,
    ),
    JSON.stringify({
      rootSha1: sha1Of(rootFile),
      file: "DECISIONS.md",
      fileSha1: sha1Of(rootFile),
      reason: "mixed line ends in DECISIONS.md",
      at: new Date().toISOString(),
    }),
  );
  const quiet33 = silent(onCommit(p33, undefined, { session_id: "s9" }));
  fs.appendFileSync(rootFile, "- one more\n");
  commit(p33);
  r = onCommit(p33, undefined, { session_id: "s10" });
  ok(
    "33 a lasting split failure with both files unchanged is silent; a changed DECISIONS.md is told again",
    quiet33 && r.ctx.includes(splitCmd(p33)),
    r.ctx || r.err,
  );

  // 34, 35: "Replaces" lines in docs/decisions/
  const p34 = folder({
    "DECISIONS.md": DEC,
    "docs/decisions/x.md": "# X\n\n- a\n",
  });
  commit(p34);
  write(p34, {
    "docs/decisions/x.md":
      "# X\n\n- Builds use npm. Replaces the 2026-01-02 entry.\n- a\n",
  });
  commit(p34);
  r = onCommit(p34);
  ok(
    "34 a Replaces line added to docs/decisions/x.md is named by its file and line",
    r.ctx.includes("Decision files: these lines") &&
      r.ctx.includes(
        '- docs/decisions/x.md:3: "- Builds use npm. Replaces the 2026-01-02 entry."',
      ),
    r.ctx || r.err,
  );
  const p35 = folder({
    "DECISIONS.md":
      "# Decisions\n\n## 2026-11-13 New\nReplaces the 2026-01-02 entry below.\n\n## 2026-01-02 Use make\nAll builds use make.\n",
  });
  commit(p35);
  write(p35, {
    "DECISIONS.md":
      "# Decisions\n\n## 2026-01-02 Use make\nAll builds use make.\n",
    "docs/decisions/x.md":
      "# X\n\n## 2026-11-13 New\nReplaces the 2026-01-02 entry below.\n",
  });
  commit(p35);
  r = onCommit(p35);
  ok(
    "35 a commit that only moves a Replaces line gives no Replaces part",
    silent(r) && !r.ctx.includes("Decision files"),
    r.ctx || r.err,
  );
} finally {
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(
  failed ? `${failed} failed, ${passed} passed` : `all ${passed} passed`,
);
process.exit(failed ? 1 : 0);
