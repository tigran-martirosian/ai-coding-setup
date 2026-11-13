// Tests for hooks/delete-guard.mjs. Run: node test-delete-guard.mjs
// Nothing is deleted: the hook only reads the command text. A crash would fail open and look like "allow",
// so the crash log points at a temp file that must still be missing at the end.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
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
const run = (ev, env = {}) => {
  const r = spawnSync(process.execPath, [hook], {
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
  ["rm -rf in ${TMPDIR:-/tmp}", bash('rm -rf "${TMPDIR:-/tmp}/x"'), "allow"],
  ["rm -rf in /tmp", bash("rm -rf /tmp/scratch-1"), "allow"],
  [
    "rm -rf in AppData/Local/Temp",
    bash("rm -rf C:/Users/you/AppData/Local/Temp/run-5"),
    "allow",
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
