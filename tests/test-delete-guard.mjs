// Tests for hooks/delete-guard.mjs. Run: node test-delete-guard.mjs
// Nothing is deleted: the hook only reads the command text. A crash would fail open and look like "allow",
// so the crash log points at a temp file that must still be missing at the end.
import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(
  new URL("../hooks/delete-guard.mjs", import.meta.url),
);
const dir = mkdtempSync(join(tmpdir(), "deleteguard-"));
const crashes = join(dir, "hook-errors.log");
const PROJECT = "C:\\Projects\\demo";
const WORKTREE = "C:\\Users\\you\\AppData\\Local\\Temp\\cch-wt\\b1";

let stderr = ""; // a hook that does not even load also prints nothing on stdout
let status = 0; // Claude Code reads the JSON verdict only when the hook ends with exit 0
const run = (ev, env = {}, nodeArgs = []) => {
  const r = spawnSync(process.execPath, [...nodeArgs, hook], {
    input: JSON.stringify({ session_id: "t", cwd: PROJECT, ...ev }),
    env: { ...process.env, DELETE_GUARD: "", HOOK_ERRORS_LOG: crashes, ...env },
    encoding: "utf8",
  });
  stderr += r.stderr;
  status = r.status;
  return r.stdout;
};
const verdict = (out) =>
  out.includes('"deny"')
    ? "deny"
    : out.includes('"ask"')
      ? "ask"
      : out === ""
        ? "allow"
        : `other: ${out}`;
const bash = (command, extra = {}) => ({
  tool_name: "Bash",
  tool_input: { command },
  ...extra,
});
const ps = (command, extra = {}) => ({
  tool_name: "PowerShell",
  tool_input: { command },
  ...extra,
});
const slash = (p) => p.replace(/\\/g, "/"); // a path as a Bash command writes it

const cases = [
  // refused
  ["rm -rf on a project folder", bash("rm -rf src"), "deny"],
  ["rm -rf after then", bash("if [ -d build ]; then rm -rf build; fi"), "deny"],
  ["rm -rf after if", bash("if rm -rf build; then echo gone; fi"), "deny"],
  ["rm -rf after do", bash('for d in a b; do rm -rf "$d"; done'), "deny"],
  ["rm -rf after else", bash("if true; then :; else rm -rf build; fi"), "deny"],
  ["rm -rf after !", bash("! rm -rf build"), "deny"],
  ["rm -rf in { }", bash("{ rm -rf build; }"), "deny"],
  ["rm -rf in ( )", bash("(cd sub && rm -rf build)"), "deny"],
  [
    "PowerShell Remove-Item -Recurse in an if block",
    ps("if (Test-Path build) { Remove-Item -Recurse -Force build }"),
    "deny",
  ],
  [
    "PowerShell Remove-Item -Recurse in ForEach-Object",
    ps("Get-ChildItem . | ForEach-Object { Remove-Item $_ -Recurse }"),
    "deny",
  ],
  [
    "one-file rm after then",
    bash("if [ -f a.txt ]; then rm a.txt; fi"),
    "allow",
  ],
  [
    "rm -rf on an absolute project path",
    bash('rm -rf "C:/Projects/demo/build"'),
    "deny",
  ],
  ["rm -fr form", bash("rm -fr ./out"), "deny"],
  ["rm -r form", bash("rm -r docs"), "deny"],
  ["rm --recursive form", bash("rm --recursive docs"), "deny"],
  // rm, like any GNU tool, takes a shortened long option: --r, --rec and --recur all mean --recursive
  ["rm --rec form (shortened --recursive)", bash("rm --rec -f ./dir"), "deny"],
  ["rm --recur form (shortened --recursive)", bash("rm --recur ./dir"), "deny"],
  ["rm --r form (shortened --recursive)", bash("rm --r docs"), "deny"],
  ["rm of one named file in the project", bash("rm ./file.txt"), "allow"],
  ["wildcard delete", bash("rm *.log"), "deny"],
  ["wildcard in a folder", bash("rm -f build/*.o"), "deny"],
  ["find -delete", bash('find . -name "*.tmp" -delete'), "deny"],
  ["find -exec rm", bash("find src -type f -exec rm {} +"), "deny"],
  ["git clean -fd", bash("git clean -fd"), "deny"],
  ["git clean -xdf", bash("git clean -xdf"), "deny"],
  [
    "git -C project clean --force",
    bash("git -C C:/Projects/demo clean --force"),
    "deny",
  ],
  // git's global options before the subcommand take their value as the next word; the subcommand comes after it
  [
    "git --git-dir <dir> before reset --hard",
    bash("git --git-dir .git reset --hard"),
    "deny",
  ],
  [
    "git --git-dir <dir> before push --force",
    bash("git --git-dir .git push --force"),
    "deny",
  ],
  [
    "git --namespace <name> before push --force",
    bash("git --namespace x push --force"),
    "deny",
  ],
  [
    "git --work-tree <dir> before reset --hard",
    bash("git --work-tree . reset --hard"),
    "deny",
  ],
  [
    "git --config-env <name=var> before push -f",
    bash("git --config-env a.b=HOME push -f"),
    "deny",
  ],
  [
    "git --attr-source <tree> before reset --hard",
    bash("git --attr-source HEAD reset --hard"),
    "deny",
  ],
  [
    "git --git-dir <dir> before a harmless status",
    bash("git --git-dir .git status"),
    "allow",
  ],
  // git's parse-options takes a shortened long option too
  ["git reset --har (shortened --hard)", bash("git reset --har"), "deny"],
  [
    "git push --force-w (shortened --force-with-lease)",
    bash("git push --force-w origin main"),
    "deny",
  ],
  ["git clean --f -d (shortened --force)", bash("git clean --f -d"), "deny"],
  [
    "git clean --dry --force (shortened --dry-run) deletes nothing",
    bash("git clean --dry --force"),
    "allow",
  ],
  [
    "git clean -fd -e -n (-n is the exclude pattern)",
    bash("git clean -fd -e -n"),
    "deny",
  ],
  ["git clean -fden (n is the value of -e)", bash("git clean -fden"), "deny"],
  ["git clean -fd --exclude -n", bash("git clean -fd --exclude -n"), "deny"],
  [
    "git clean -fd -- -n (a path, not an option)",
    bash("git clean -fd -- -n"),
    "deny",
  ],
  [
    "git clean -fd -e keep -n is a dry run",
    bash("git clean -fd -e keep -n"),
    "allow",
  ],
  // git clean deletes in the work tree, which -C does not move: --work-tree, GIT_WORK_TREE or core.worktree names it
  [
    "git --work-tree <project> clean -f from a temp folder",
    bash("git --work-tree C:/Projects/demo clean -f", { cwd: WORKTREE }),
    "deny",
  ],
  [
    "git --work-tree <temp folder> clean -f",
    bash("git --work-tree /tmp/w clean -f"),
    "allow",
  ],
  [
    "git --work-tree <project> with -C <temp> after it, clean -fdx",
    bash(
      "git --git-dir C:/Projects/demo/.git --work-tree C:/Projects/demo -C /tmp/x clean -fdx",
    ),
    "deny",
  ],
  [
    "git -C <temp> with a relative --work-tree inside it, clean -f",
    bash("git -C /tmp --work-tree w clean -f"),
    "allow",
  ],
  [
    "GIT_WORK_TREE=<temp folder> before git clean -f",
    bash("GIT_WORK_TREE=/tmp/w git clean -f"),
    "allow",
  ],
  [
    "git -c core.worktree=<project> clean -f from a temp folder",
    bash("git -C /tmp/x -c core.worktree=C:/Projects/demo clean -f"),
    "deny",
  ],
  [
    "git --config-env core.worktree=<unknown variable> clean -f",
    bash("git -C /tmp/x --config-env core.worktree=WT clean -f"),
    "deny",
  ],
  [
    "GIT_DIR=<project git dir> with no work tree, clean -f from a temp folder",
    bash("GIT_DIR=C:/Projects/demo/.git git -C /tmp/x clean -f"),
    "deny",
  ],
  [
    "git --git-dir=<project git dir> with no work tree, clean -f from a temp folder",
    bash("git --git-dir=C:/Projects/demo/.git -C /tmp/x clean -f"),
    "deny",
  ],
  [
    "git --git-dir with a temp-folder work tree, clean -f",
    bash("git --git-dir C:/Projects/demo/.git --work-tree /tmp/w clean -f"),
    "allow",
  ],
  // a push that deletes remote branches is refused like a force push
  ["git push --mirror", bash("git push --mirror origin"), "deny"],
  ["git push --prune", bash("git push --prune origin main"), "deny"],
  ["git push --delete", bash("git push --delete origin old"), "deny"],
  [
    "git push --del (shortened --delete)",
    bash("git push --del origin old"),
    "deny",
  ],
  ["git push -d", bash("git push -d origin old"), "deny"],
  ["git push -ud (d in a bundle)", bash("git push -ud origin old"), "deny"],
  ["git push origin :branch", bash("git push origin :old"), "deny"],
  ["git push -u origin main", bash("git push -u origin main"), "allow"],
  [
    "git push --progress (not --prune)",
    bash("git push --progress origin main"),
    "allow",
  ],
  // a command prefix's option value is not the command: sudo -u root rm is rm
  ["sudo -u <user> rm -rf", bash("sudo -u root rm -rf src"), "deny"],
  ["sudo --user <user> rm -rf", bash("sudo --user root rm -rf src"), "deny"],
  ["nice -n <adj> rm -rf", bash("nice -n 5 rm -rf src"), "deny"],
  ["env -u <name> rm -rf", bash("env -u HOME rm -rf src"), "deny"],
  ["time -o <file> rm -rf", bash("time -o t.log rm -rf src"), "deny"],
  ["env -S 'rm -rf src'", bash("env -S 'rm -rf src'"), "deny"],
  ["xargs --max-args <n> rm", bash("ls | xargs --max-args 1 rm -f"), "deny"],
  ["sudo -u <user> ls", bash("sudo -u root ls"), "allow"],
  // bash reads an unquoted C:\dir as C:dir, which starts from drive C's own current folder: not known, so refused
  [
    "git -C <temp> --work-tree=C:dir clean (drive-relative work tree)",
    bash("git -C /tmp/x --work-tree=C:dir clean -f"),
    "deny",
  ],
  ["rm fed by xargs", bash("ls | xargs rm -f"), "deny"],
  ["rm -rf inside bash -c", bash(`bash -c "rm -rf src"`), "deny"],
  ["rm -rf inside $( )", bash("echo $(rm -rf src)"), "deny"],
  ["rm -rf after other commands", bash("npm test && rm -rf dist"), "deny"],
  ["cd out of the project, then rm -rf", bash("cd .. && rm -rf demo"), "deny"],
  [
    "rm -rf climbing out of a worktree",
    bash("rm -rf ../../../src", {
      cwd: "C:\\Projects\\demo\\.claude\\worktrees\\w1",
    }),
    "deny",
  ],
  ["rm -rf the temp folder itself", bash('rm -rf "$TEMP"'), "deny"],
  ["rm -rf climbing out of /tmp", bash("rm -rf /tmp/../home/user"), "deny"],
  ["rm -rf an unknown variable", bash('rm -rf "$OUT_DIR"'), "deny"],
  [
    "PowerShell Remove-Item -Recurse",
    ps("Remove-Item -Recurse -Force C:\\Projects\\demo\\out"),
    "deny",
  ],
  ["PowerShell rm -r alias", ps("rm -r .\\out"), "deny"],
  ["PowerShell wildcard", ps("Remove-Item *.txt"), "deny"],
  ["PowerShell -Include", ps("Remove-Item .\\logs -Include *.log"), "deny"],
  ["PowerShell fed by a pipe", ps("Get-ChildItem *.log | Remove-Item"), "deny"],
  [
    "Bash runs powershell -Command",
    bash(`powershell -Command "Remove-Item -Recurse C:\\Projects\\demo\\out"`),
    "deny",
  ],
  // named files pass without asking (user, 2026-11-12)
  ["one-file rm", bash("rm file.txt"), "allow"],
  ["named files", bash('rm -f a.txt "b c.txt"'), "allow"],
  ["PowerShell one file", ps("Remove-Item notes.txt"), "allow"],
  // allowed
  ["rm -rf in $TEMP", bash('rm -rf "$TEMP/x"'), "allow"],
  // biome-ignore lint/suspicious/noTemplateCurlyInString: a shell command, not a template
  ["rm -rf in ${TMPDIR:-/tmp}", bash('rm -rf "${TMPDIR:-/tmp}/x"'), "allow"],
  ["rm -rf in /tmp", bash("rm -rf /tmp/scratch-1"), "allow"],
  [
    // a Windows temp path; on another system it is no temp folder
    "rm -rf in AppData/Local/Temp",
    bash("rm -rf C:/Users/you/AppData/Local/Temp/run-5"),
    process.platform === "win32" ? "allow" : "deny",
  ],
  ["wildcard in temp", bash("rm -f /tmp/run/*.json"), "allow"],
  [
    "rm -rf a mktemp folder",
    bash('d=$(mktemp -d)\ntouch "$d/a"\nrm -rf "$d"'),
    "allow",
  ],
  [
    "rm -rf a cch-wt worktree path",
    bash("rm -rf D:/work/cch-wt/b2/build"),
    "allow",
  ],
  [
    "rm -rf a .claude/worktrees path",
    bash("rm -rf C:/Projects/demo/.claude/worktrees/w1"),
    "allow",
  ],
  [
    "rm -rf inside a worktree cwd",
    bash("rm -rf build", { cwd: WORKTREE }),
    "allow",
  ],
  [
    "git clean -fd in a worktree",
    bash("git clean -fd", { cwd: WORKTREE }),
    "allow",
  ],
  ["rm -rf node_modules", bash("rm -rf node_modules"), "allow"],
  ["rm -rf a .cache folder", bash("rm -rf ~/.cache/pip"), "allow"],
  [
    "find -delete in __pycache__",
    bash("find src/__pycache__ -name '*.pyc' -delete"),
    "allow",
  ],
  ["git clean dry run", bash("git clean -nd"), "allow"],
  [
    "git --work-tree=<project> -C <temp> clean: the work tree is where it deletes",
    bash(
      String.raw`git --work-tree=C:\Projects\app -C "${WORKTREE}" clean -fd`,
    ),
    "deny",
  ],
  [
    "GIT_WORK_TREE=<project> git -C <temp> clean",
    bash(
      String.raw`GIT_WORK_TREE=C:\Projects\app git -C "${WORKTREE}" clean -fd`,
    ),
    "deny",
  ],
  [
    "git -C <temp> --work-tree=. clean stays in the temp folder",
    bash(String.raw`git -C "${WORKTREE}" --work-tree=. clean -fd`),
    "allow",
  ],
  [
    "git clean -fd -n --no-dry-run (last one wins)",
    bash("git clean -fd -n --no-dry-run"),
    "deny",
  ],
  [
    "git clean -d with requireForce off",
    bash("git -c clean.requireForce=false clean -d"),
    "deny",
  ],
  [
    "git clean --no-dry-run -n is a dry run",
    bash("git clean -fd --no-dry-run -n"),
    "allow",
  ],
  [
    "the setup's own cleanup",
    bash(
      "node workers/disk-tidy.mjs --apply\n\n# WHAT THIS DOES: tidies the disk",
    ),
    "allow",
  ],
  ["quoted text: echo", bash('echo "rm -rf /"'), "allow"],
  ["quoted text: grep pattern", bash('grep -rn "rm -rf \\*" hooks/'), "allow"],
  [
    "quoted text: commit message",
    bash(`git commit -m "drop the rm -rf * line"`),
    "allow",
  ],
  [
    "heredoc body",
    bash("cat > note.md <<'EOF'\nrm -rf /\nfind / -delete\nEOF\necho done"),
    "allow",
  ],
  ["comment", bash("ls # rm -rf /"), "allow"],
  ["rmdir is not rm", bash("rmdir empty-folder"), "allow"],
  [
    "PowerShell temp folder",
    ps("Remove-Item -Recurse -Force $env:TEMP\\x"),
    "allow",
  ],
  [
    "PowerShell -WhatIf",
    ps("Remove-Item -Recurse C:\\Projects\\demo\\out -WhatIf"),
    "allow",
  ],
  [
    "PowerShell quoted text",
    ps(`Write-Output "Remove-Item -Recurse C:\\"`),
    "allow",
  ],
  [
    "Read tool",
    { tool_name: "Read", tool_input: { file_path: "rm -rf" } },
    "allow",
  ],
];
let fail = 0;
const check = (ok, name, got) => {
  if (!ok) fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` (got ${got})`}`);
};
for (const [name, ev, want] of cases) {
  const got = verdict(run(ev));
  check(
    got === want && status === 0,
    `${name}: ${want}`,
    `${got}, exit ${status}`,
  );
}
const main = run(bash("rm -rf src"));
check(
  main.includes("ask them in a form"),
  "main session refusal says to ask the user",
  main,
);
const helper = run(bash("rm -rf src", { agent_id: "a1" }));
check(
  helper.includes("You are a helper"),
  "helper refusal says to report it",
  helper,
);
// Rescope (2026-11-19): what git brings back passes. Needs a real repo outside the temp folder, which always passes,
// and outside this checkout, which can itself sit in a cch-wt worktree, where every delete passes: the home folder.
// The real one from the system: run-all.mjs points HOME and USERPROFILE at a temp folder, where every delete passes.
const realHome = userInfo().homedir;
{
  // Not in temp: every delete under the temp folder passes, so nothing here would be judged. Made in try, removed in finally.
  const home = join(realHome, `.dg-scratch-${process.pid}`);
  const repo = join(home, "repo"),
    plain = join(home, "plain");
  const g = (...a) =>
    spawnSync("git", ["-C", repo, ...a], { encoding: "utf8" }).status;
  try {
    for (const d of [join(repo, "src"), join(plain, "src")])
      mkdirSync(d, { recursive: true });
    for (const d of [repo, plain]) {
      writeFileSync(join(d, "src", "a.txt"), "a");
      writeFileSync(join(d, "src", "b.txt"), "b");
    }
    g("init", "-q");
    g("add", "-A");
    g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "x");
    mkdirSync(join(repo, "dist"));
    writeFileSync(join(repo, "dist", "out.js"), "");
    const at = (cwd, command) => verdict(run(bash(command, { cwd })));
    const want = (got, exp, name) => check(got === exp, `${name}: ${exp}`, got);
    want(
      at(repo, "rm -rf src"),
      "allow",
      "rm -rf of a committed, unchanged folder in a git repo (git brings it back)",
    );
    want(
      at(repo, "rm src/*.txt"),
      "allow",
      "wildcard delete of committed, unchanged files in a git repo",
    );
    want(
      at(repo, "find src -name '*.txt' -delete"),
      "allow",
      "find -delete under a committed, unchanged folder",
    );
    want(
      at(repo, "rm -rf dist"),
      "allow",
      "rm -rf of build output in a git repo",
    );
    want(
      at(plain, "rm -rf src"),
      "deny",
      "rm -rf of the same folder outside a git repo",
    );
    writeFileSync(join(repo, "src", "new.txt"), "n");
    want(
      at(repo, "rm -rf src"),
      "deny",
      "rm -rf of a repo folder holding an untracked file (git can't bring it back)",
    );
    rmSync(join(repo, "src", "new.txt"));
    writeFileSync(join(repo, "src", "a.txt"), "changed");
    want(
      at(repo, "rm -rf src"),
      "deny",
      "rm -rf of a repo folder holding an uncommitted change",
    );
    want(
      at(repo, "rm data.db"),
      "deny",
      "deleting a database file outside temp",
    );
    want(
      at(repo, 'rm "$TEMP/x.sqlite"'),
      "allow",
      "deleting a database file in temp",
    );
    want(at(repo, "git reset --hard"), "deny", "git reset --hard");
    want(at(repo, "git reset --soft HEAD~1"), "allow", "git reset --soft");
    for (const p of [
      "git push --force",
      "git push -f origin main",
      "git push origin +main",
      "git push --force-with-lease",
    ])
      want(at(repo, p), "deny", `force push: ${p}`);
    want(at(repo, "git push origin main"), "allow", "a plain push");
    // D12: a tracked file stays free even outside the project folders (the event's cwd is the project)
    g("checkout", "-q", "--", ".");
    want(
      verdict(run(bash(`rm "${slash(join(repo, "src", "b.txt"))}"`))),
      "allow",
      "D12 one committed file of a git repo outside the project folders",
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
// D12 (hooks cut, plan 2.8): no ask for what Claude made in the session (files it wrote, recordings it made) or what
// the user named; still an ask (deny or ask) for user data and for anything outside the project folders. "Made in the
// session" and "named by the user" are read from the session's transcript. The folders sit in the home folder:
// outside temp, outside any git repo, outside the project (the event's cwd stays C:\Projects\demo).
{
  // Not in temp: every delete under the temp folder passes, so nothing here would be judged. Made in try, removed in finally.
  const home = join(realHome, `.dg-d12-${process.pid}`);
  const made = join(home, "made"),
    rec = join(home, "rec"),
    mixed = join(home, "mixed"),
    named = join(home, "exports"),
    other = join(home, "keep");
  let n = 0;
  const transcript = (entries) => {
    const file = join(dir, `d12-${++n}.jsonl`);
    writeFileSync(
      file,
      entries
        .flat(Infinity)
        .map((e) => JSON.stringify(e))
        .join("\n") + "\n",
    );
    return file;
  };
  const typed = (text) => ({
    type: "user",
    promptSource: "sdk",
    message: { role: "user", content: text },
  });
  // A tool call and its result, as the transcript keeps them: result "ok", "error", or null (no result yet)
  const call = (name, input, result = "ok", id = `d${++n}`) => [
    {
      type: "assistant",
      message: {
        role: "assistant",
        content: [{ type: "tool_use", id, name, input }],
      },
    },
    ...(result
      ? [
          {
            type: "user",
            message: {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: id,
                  content: result,
                  ...(result === "error" && { is_error: true }),
                },
              ],
            },
            toolUseResult: {},
          },
        ]
      : []),
  ];
  const wrote = (p, result) =>
    call("Write", { file_path: p, content: "x" }, result);
  const at = (entries, command, tool = bash) =>
    verdict(run(tool(command, { transcript_path: transcript(entries) })));
  const notAllow = (got) => got === "deny" || got === "ask";
  const shot = (name, ok, got) => check(ok, name, got);
  try {
    for (const d of [made, rec, mixed, named, other])
      mkdirSync(d, { recursive: true });
    for (const f of ["a.txt", "b.txt"]) writeFileSync(join(made, f), f);
    writeFileSync(join(rec, "clip-1.mp4"), "");
    writeFileSync(join(mixed, "draft.txt"), "Claude's");
    writeFileSync(join(mixed, "notes.txt"), "the user's");
    for (const d of [named, other]) writeFileSync(join(d, "x.csv"), "");
    const ask = typed("Build me the report.");
    const session = [
      ask,
      wrote(join(made, "a.txt")),
      wrote(join(made, "b.txt")),
    ];
    let got = at(session, `rm -rf "${slash(made)}"`);
    shot(
      "D12 rm -rf of a folder holding only files Claude wrote this session: allow",
      got === "allow",
      got,
    );
    got = at(session, `rm "${slash(made)}"/*.txt`);
    shot(
      "D12 wildcard delete of files Claude wrote this session: allow",
      got === "allow",
      got,
    );
    got = at(session, `Remove-Item -Recurse -Force "${made}"`, ps);
    shot(
      "D12 PowerShell Remove-Item -Recurse of Claude's session files: allow",
      got === "allow",
      got,
    );
    const recording = [
      ask,
      call("Bash", {
        command: `ffmpeg -f gdigrab -i desktop -t 5 "${slash(join(rec, "clip-1.mp4"))}"`,
      }),
    ];
    got = at(recording, `rm -rf "${slash(rec)}"`);
    shot(
      "D12 rm -rf of a recording Claude made this session: allow",
      got === "allow",
      got,
    );
    got = at(
      [ask, wrote(join(mixed, "draft.txt"))],
      `rm -rf "${slash(mixed)}"`,
    );
    shot(
      "D12 rm -rf of a folder that also holds a file Claude did not make: still asks",
      notAllow(got),
      got,
    );
    const said = [
      typed(`Delete the old exports folder, ${slash(named)}, it's junk.`),
    ];
    got = at(said, `rm -rf "${slash(named)}"`);
    shot(
      "D12 rm -rf of the folder the user named in their message: allow",
      got === "allow",
      got,
    );
    got = at(said, `rm -rf "${slash(other)}"`);
    shot(
      "D12 rm -rf of a folder the user did not name: still asks",
      notAllow(got),
      got,
    );
    // Outside the project folders: a named file the session did not make and the user did not name
    for (const [label, tool, command] of [
      ["rm", bash, "rm C:/Users/you/Documents/report.docx"],
      ["PowerShell", ps, "Remove-Item C:\\Users\\you\\Documents\\report.docx"],
    ]) {
      got = at([ask], command, tool);
      shot(
        `D12 ${label} of one file outside the project folders: still asks`,
        notAllow(got),
        got,
      );
    }
    // Fix round 1 (code review): when the hook can't be sure the user named a path or Claude made it, it asks.
    // A path the user typed names only itself, not the folders above it.
    const deeper = [typed(`Look at ${slash(other)}/x.csv first.`)];
    for (const [label, command] of [
      ["rm -rf of the folder holding it", `rm -rf "${slash(other)}"`],
      ["rm -rf of a folder two levels up", `rm -rf "${slash(home)}"`],
      [
        "find -delete of the folder holding it",
        `find "${slash(other)}" -delete`,
      ],
    ]) {
      got = at(deeper, command);
      shot(
        `D12 ${label}, above a path the user typed: still asks`,
        notAllow(got),
        got,
      );
    }
    // Only what the user typed names a path: not a summary, a helper's brief, a tool's output or a system note
    const says = `Delete ${slash(named)} now.`;
    const userish = (extra) => ({ ...typed(says), ...extra });
    for (const [label, entry] of [
      ["a compaction summary", userish({ isCompactSummary: true })],
      ["a helper's brief (sidechain)", userish({ isSidechain: true })],
      ["a transcript-only entry", userish({ isVisibleInTranscriptOnly: true })],
      ["a tool's result", userish({ toolUseResult: {} })],
      ["a message a tool sent", userish({ sourceToolUseID: "x1" })],
      ...[
        "<task-notification>",
        "<local-command-stdout>",
        "<command-name>",
        "<system-reminder>",
      ].map((tag) => [`text starting with ${tag}`, typed(`${tag}${says}`)]),
    ]) {
      got = at([entry], `rm -rf "${slash(named)}"`);
      shot(
        `D12 a path only in ${label}, not typed by the user: still asks`,
        notAllow(got),
        got,
      );
    }
    // ffmpeg makes only its output: the last argument, when it is not an -i input or an option's value
    const clip = slash(join(rec, "clip-1.mp4"));
    for (const [label, command] of [
      ["probing (-i, no output)", `ffmpeg -hide_banner -i "${clip}"`],
      ["a second -i input", `ffmpeg -i desktop -i "${clip}"`],
      ["an option's value", `ffmpeg -i desktop -filter_script "${clip}"`],
    ]) {
      got = at([ask, call("Bash", { command })], `rm -rf "${slash(rec)}"`);
      shot(
        `D12 ffmpeg ${label} did not make the file: still asks`,
        notAllow(got),
        got,
      );
    }
    // -o/--output marks a file made only for tools that write it; touch can touch a file that was already there
    const csv = slash(join(other, "x.csv"));
    for (const [label, command, want] of [
      [
        "unzip -o (overwrite, then the zip it reads)",
        `unzip -o "${csv}"`,
        "ask",
      ],
      ["ls -o (long list)", `ls -o "${csv}"`, "ask"],
      ["touch of a file that was there", `touch "${csv}"`, "ask"],
      [
        "curl -o (a download it wrote)",
        `curl -o "${csv}" https://example.com/x.csv`,
        "allow",
      ],
    ]) {
      got = at([ask, call("Bash", { command })], `rm -rf "${slash(other)}"`);
      const ok = want === "allow" ? got === "allow" : notAllow(got);
      shot(
        `D12 ${label}: ${want === "allow" ? "made, allow" : "not made, still asks"}`,
        ok,
        got,
      );
    }
    // A call counts as made only when its result is in and is not an error, and never the call being judged
    const both = (result) => [
      wrote(join(made, "a.txt"), result),
      wrote(join(made, "b.txt"), result),
    ];
    got = at([ask, both(null)], `rm -rf "${slash(made)}"`);
    shot(
      "D12 Write calls with no result yet did not make the files: still asks",
      notAllow(got),
      got,
    );
    got = at([ask, both("error")], `rm -rf "${slash(made)}"`);
    shot(
      "D12 Write calls that failed did not make the files: still asks",
      notAllow(got),
      got,
    );
    const judged = `curl -o "${csv}" https://example.com/x.csv; rm -rf "${slash(other)}"`;
    got = verdict(
      run(
        bash(judged, {
          tool_use_id: "now",
          transcript_path: transcript([
            ask,
            call("Bash", { command: judged }, "ok", "now"),
          ]),
        }),
      ),
    );
    shot(
      "D12 the call being judged does not count as having made its files: still asks",
      notAllow(got),
      got,
    );
    // A link or junction anywhere in the path: the place it reaches is not the one named or made, so it asks
    const lnk = join(home, "lnk"),
      deep = join(home, "deep", "keep2"),
      up = join(home, "up"),
      madel = join(home, "madel");
    mkdirSync(deep, { recursive: true });
    mkdirSync(madel);
    writeFileSync(join(deep, "y.csv"), "");
    writeFileSync(join(madel, "a.txt"), "");
    symlinkSync(other, lnk, "junction");
    symlinkSync(deep, up, "junction");
    symlinkSync(other, join(madel, "lnk"), "junction");
    got = at([typed(`Delete ${slash(lnk)} please.`)], `rm -rf "${slash(lnk)}"`);
    shot(
      "D12 rm -rf of a junction the user named (it reaches other files): still asks",
      notAllow(got),
      got,
    );
    got = at([typed(says)], `rm -rf "${slash(up)}/../exports"`);
    shot(
      "D12 rm -rf of a named path reached through a junction and ..: still asks",
      notAllow(got),
      got,
    );
    got = at(
      [ask, wrote(join(madel, "a.txt")), wrote(join(madel, "lnk"))],
      `rm -rf "${slash(madel)}"`,
    );
    shot(
      "D12 rm -rf of a made folder holding a junction (not judged a single file): still asks",
      notAllow(got),
      got,
    );
    // A recorded command that changes folder: its relative output paths are not guessed
    const moved = call("Bash", {
      command: "cd ../made && curl -o x.csv https://example.com/x.csv",
    });
    moved[0].cwd = other;
    got = at([ask, moved], `rm -rf "${slash(other)}"`);
    shot(
      "D12 a relative output after cd in the recorded command does not count as made: still asks",
      notAllow(got),
      got,
    );
    // Case: Windows matches paths in any case; a case-sensitive system (the hook run as on Linux) keeps it
    const asLinux = [
      "--import",
      "data:text/javascript,Object.defineProperty(process,'platform',{value:'linux'})",
    ];
    const upper = [
      typed(`Delete ${slash(named).replace(/exports$/, "EXPORTS")} now.`),
    ];
    const rmNamed = `rm -rf "${slash(named)}"`;
    got = at(upper, rmNamed);
    shot(
      "D12 the user's path in another case: on Windows it names the folder (allow); elsewhere it is another folder (asks)",
      process.platform === "win32" ? got === "allow" : notAllow(got),
      got,
    );
    got = verdict(
      run(bash(rmNamed, { transcript_path: transcript(upper) }), {}, asLinux),
    );
    shot(
      "D12 Linux: the user's path in another case is another folder: still asks",
      notAllow(got),
      got,
    );
    got = verdict(
      run(
        bash(rmNamed, { transcript_path: transcript([typed(says)]) }),
        {},
        asLinux,
      ),
    );
    shot(
      "D12 Linux: the user's path in the same case names the folder: allow",
      got === "allow",
      got,
    );
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}
const off = run(bash("rm -rf src"), { DELETE_GUARD: "off" });
check(off === "", "DELETE_GUARD=off: allow", off);
const bad = spawnSync(process.execPath, [hook], {
  input: "not json",
  env: { ...process.env, HOOK_ERRORS_LOG: "off" },
  encoding: "utf8",
}).stdout;
check(bad === "", "bad input: allow", bad);
check(
  !existsSync(crashes) && stderr === "",
  "no crash while the cases ran",
  stderr || "a crash log line",
);
rmSync(dir, { recursive: true, force: true });
console.log(fail ? `${fail} failed` : "all passed");
process.exit(fail ? 1 : 0);
