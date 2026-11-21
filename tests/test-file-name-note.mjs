// Tests for hooks/file-name-note.mjs: a Write that makes a new file whose name or place breaks the file standard
// (N1-N8, P8 folder roles, P10 the projects root) gets one note for Claude, starting "file-name-note:", naming the
// rule and the proposed name; the call itself is never rewritten or refused. A good name, an existing file, a file
// outside any project, a file in a git-ignored folder, a broken .claude/file-standard.json and FILE_NAME_NOTE=off
// give nothing. Each run is under 1 second. The same note comes through `dispatch.mjs pre-tool`.
// Spec docs/2026-11-20-file-names-spec.md D7. Everything happens in made-up folders under the system temp folder.
// Run: node tests/test-file-name-note.mjs
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HOOK = fileURLToPath(
  new URL("../hooks/file-name-note.mjs", import.meta.url),
);
const DISPATCH = fileURLToPath(
  new URL("../hooks/dispatch.mjs", import.meta.url),
);
const tmp = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "file-name-note-test-")),
);
let pass = 0,
  fail = 0;
const check = (name, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${String(detail).trim().split("\n").join("\n     ")}`}`,
  );
};
const make = (root, files) => {
  for (const [rel, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), text);
  }
};
const git = (root, ...a) => {
  const r = spawnSync("git", ["-C", root, ...a], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
};
const gitRepo = (root, files) => {
  make(root, files);
  git(root, "init", "-q");
  git(root, "config", "user.email", "someone@example.com");
  git(root, "config", "user.name", "someone");
  git(root, "add", "-A");
  git(root, "commit", "-q", "-m", "start");
};

// A made-up home (no real ~/.claude is read), a made-up projects root, and two projects in it
const home = path.join(tmp, "home");
fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
const projects = path.join(tmp, "projects");
const shop = path.join(projects, "shop");
gitRepo(shop, {
  "CLAUDE.md": "# shop\n",
  ".gitignore": "logs/\n",
  "docs/Old_Name.md": "an old file\n",
  "scripts/build.mjs": "",
});
const broken = path.join(projects, "broken");
gitRepo(broken, {
  "CLAUDE.md": "# broken\n",
  ".claude/file-standard.json": "{ not json",
});
const scratch = path.join(tmp, "scratch"); // a temp-folder file outside any project
fs.mkdirSync(scratch, { recursive: true });

const ENV = {
  HOME: home,
  USERPROFILE: home,
  HOOK_ERRORS_LOG: "off",
  FILE_STANDARD_PROJECTS: projects,
  // the hook is silent in the temp folder (os.tmpdir()), where these made-up projects sit: the hook's temp folder is
  // scratch/ instead, so the projects are judged and scratch/ is the temp folder of the "outside any project" case
  TEMP: scratch,
  TMP: scratch,
  TMPDIR: scratch,
};
const baseEnv = () => {
  const e = { ...process.env, ...ENV };
  delete e.FILE_NAME_NOTE;
  delete e.DISPATCH;
  return e;
};
const event = (file, { cwd = shop, mode = "default" } = {}) => ({
  session_id: "file-name-note-test",
  hook_event_name: "PreToolUse",
  permission_mode: mode,
  cwd,
  tool_name: "Write",
  tool_input: { file_path: file, content: "x\n" },
});
const times = [];
const run = (ev, { env = {}, project = shop, argv = [HOOK] } = {}) => {
  const t0 = Date.now();
  const r = spawnSync(process.execPath, argv, {
    input: JSON.stringify(ev),
    env: { ...baseEnv(), CLAUDE_PROJECT_DIR: project, ...env },
    encoding: "utf8",
  });
  times.push([
    path.basename(ev.tool_input.file_path),
    Date.now() - t0,
    r.status,
  ]);
  return { code: r.status, out: r.stdout || "", err: r.stderr || "" };
};
const parse = (out) => {
  try {
    return JSON.parse(out);
  } catch {
    return null;
  }
};
const noteOf = (r) =>
  String(parse(r.out)?.hookSpecificOutput?.additionalContext ?? "");
const shown = (r) =>
  `exit ${r.code}\nstdout: ${r.out}\nstderr: ${r.err.trim().split("\n").slice(0, 4).join("\n")}`;
const silent = (name, r) =>
  check(
    `silent: ${name}`,
    r.code === 0 && r.out.trim() === "" && r.err.trim() === "",
    shown(r),
  );
const noted = (name, r, ...words) => {
  const note = noteOf(r);
  check(
    `note: ${name}`,
    r.code === 0 &&
      note.startsWith("file-name-note:") &&
      words.every((w) => note.includes(w)),
    shown(r),
  );
};

// the hits: a name (N1, with the proposed name), a folder role (P8, to shown/), the projects root (P10)
const nameHit = event(path.join(shop, "docs", "Menu_Ideas.md"));
noted(
  "a new docs/Menu_Ideas.md names N1 and docs/menu-ideas.md",
  run(nameHit),
  "N1",
  "menu-ideas.md",
);
noted(
  "a new picture in docs/ names P8 and shown/preview.png",
  run(event(path.join(shop, "docs", "preview.png"))),
  "P8",
  "shown/preview.png",
);
noted(
  "a new loose file in the projects root names P10",
  run(event(path.join(projects, "notes.txt"))),
  "P10",
);
// the silent ones
silent(
  "a good name (docs/menu-ideas.md)",
  run(event(path.join(shop, "docs", "menu-ideas.md"))),
);
silent(
  "an existing file overwritten (docs/Old_Name.md)",
  run(event(path.join(shop, "docs", "Old_Name.md"))),
);
silent(
  "a temp-folder file outside any project",
  run(event(path.join(scratch, "Bad_Name.md"), { cwd: scratch })),
);
silent(
  "a file in a git-ignored folder (logs/)",
  run(event(path.join(shop, "logs", "Run_Log.txt"))),
);
silent(
  "a broken .claude/file-standard.json lets the call through",
  run(event(path.join(broken, "docs", "Menu_Ideas.md"), { cwd: broken }), {
    project: broken,
  }),
);
silent("FILE_NAME_NOTE=off", run(nameHit, { env: { FILE_NAME_NOTE: "off" } }));
// auto mode: the note, never an updatedInput or a deny
const auto = run(
  event(path.join(shop, "docs", "Menu_Ideas.md"), { mode: "auto" }),
);
const autoOut = parse(auto.out);
check(
  "auto mode: the note, no updatedInput, no deny",
  noteOf(auto).startsWith("file-name-note:") &&
    !autoOut?.hookSpecificOutput?.updatedInput &&
    autoOut?.hookSpecificOutput?.permissionDecision !== "deny",
  shown(auto),
);

// ---- review round (2026-11-20): cases added after the first version
const fwd = (p) => p.replace(/\\/g, "/");
// Claude Code's own folder: ~/.claude holds a CLAUDE.md and no .git, and its names are Claude Code's
make(path.join(home, ".claude"), { "CLAUDE.md": "# rules\n" });
for (const rel of [
  "projects/C--x/memory/feedback_testing.md",
  "plans/Fix_Login.md",
])
  silent(
    `a new file under ~/.claude (${rel})`,
    run(event(path.join(home, ".claude", ...rel.split("/")), { cwd: home })),
  );
// a git project made in the temp folder is no project of the person's
const tempRepo = path.join(scratch, "try-repo");
gitRepo(tempRepo, { "CLAUDE.md": "# try\n" });
const tempHit = event(path.join(tempRepo, "docs", "Menu_Ideas.md"), {
  cwd: tempRepo,
});
silent(
  "a git project inside the temp folder",
  run(tempHit, { project: tempRepo }),
);
const elsewhere = path.join(tmp, "not-temp");
fs.mkdirSync(elsewhere);
noted(
  "the same git project when the temp folder is elsewhere (control)",
  run(tempHit, {
    project: tempRepo,
    env: { TEMP: elsewhere, TMP: elsewhere, TMPDIR: elsewhere },
  }),
  "N1",
);
// names a tool or platform requires, and route folders, keep their form
make(shop, {
  "app/components/UserCard.tsx": "",
  "ios/App/AppDelegate.swift": "", // Xcode's target folder exists: the case is about the file's name
});
for (const rel of [
  "Cargo.toml",
  "Cargo.lock",
  "CMakeLists.txt",
  "app/src/main/AndroidManifest.xml",
  "ios/App/Info.plist",
  "ios/Podfile.lock",
  "src/Shop.App.csproj",
  "GEMINI.md",
  "README.de.md",
  "README.zh-CN.md",
  "app/[slug]/page.tsx",
  "app/[...parts]/page.tsx",
  "app/(store)/layout.tsx",
  "public/Logo@2x.png",
  "public/logo@3x.png",
  "app/components/UserCard.module.css",
])
  silent(
    `a name a tool requires (${rel})`,
    run(event(path.join(shop, ...rel.split("/")))),
  );
// the note names absolute paths: the proposal is no use relative to a root the note does not name
const abs = noteOf(run(nameHit));
check(
  "the note names the new file and the proposed name as absolute paths",
  abs.includes(fwd(path.join(shop, "docs", "Menu_Ideas.md"))) &&
    abs.includes(fwd(path.join(shop, "docs", "menu-ideas.md"))),
  abs,
);
// the person's own setting errors give no crash-log line on every Write
const errLog = path.join(tmp, "hook-errors.log");
const home2 = path.join(tmp, "home2");
make(path.join(home2, ".claude"), { "setup-state.json": "{ not json" });
const brokenState = run(nameHit, {
  env: {
    HOME: home2,
    USERPROFILE: home2,
    FILE_STANDARD_PROJECTS: "",
    HOOK_ERRORS_LOG: errLog,
  },
});
check(
  "a broken setup-state.json: exit 0, nothing on stderr, no hook-errors.log line",
  brokenState.code === 0 &&
    brokenState.err.trim() === "" &&
    !fs.existsSync(errLog),
  shown(brokenState),
);
silent(
  "a broken .claude/file-standard.json writes no hook-errors.log line",
  run(event(path.join(broken, "docs", "Menu_Ideas.md"), { cwd: broken }), {
    project: broken,
    env: { HOOK_ERRORS_LOG: errLog },
  }),
);
check(
  "  ...and the log stays empty",
  !fs.existsSync(errLog),
  fs.existsSync(errLog) ? fs.readFileSync(errLog, "utf8") : "",
);
// the off switch in the project's settings env
const offProject = path.join(projects, "quiet");
gitRepo(offProject, {
  "CLAUDE.md": "# quiet\n",
  ".claude/settings.json": JSON.stringify({ env: { FILE_NAME_NOTE: "off" } }),
});
silent(
  "FILE_NAME_NOTE=off in the project's .claude/settings.json env",
  run(
    event(path.join(offProject, "docs", "Menu_Ideas.md"), { cwd: offProject }),
    {
      project: offProject,
    },
  ),
);
// a Git Bash path (/c/...) is the same file
if (process.platform === "win32") {
  const bash = fwd(path.join(shop, "docs", "Menu_Ideas.md")).replace(
    /^([A-Za-z]):/,
    (_, d) => `/${d.toLowerCase()}`,
  );
  noted(
    `a Git Bash path (${bash.slice(0, 3)}...) gets the same note`,
    run(event(bash)),
    "N1",
    "menu-ideas.md",
  );
}
// loading the checker runs none of its command line: a "--home" with no folder in the hook's own arguments
noted(
  "the checker's command-line handling does not run when the hook loads it",
  run(nameHit, { argv: [HOOK, "--home"] }),
  "N1",
);

const slow = times.filter(([, ms, code]) => ms >= 1000 || code !== 0);
check(
  "each run ends (exit 0) in under 1 second",
  times.length > 0 && slow.length === 0,
  JSON.stringify(times),
);

// the same name hit through the dispatcher's pre-tool group, with a groups file holding only the plan's entry
const groups = path.join(tmp, "groups.json");
fs.writeFileSync(
  groups,
  JSON.stringify({
    "pre-tool": [
      {
        hook: "hooks/file-name-note.mjs",
        args: [],
        guard: false,
        tools: "Write",
      },
    ],
  }),
);
noted(
  "through dispatch.mjs pre-tool: the same note",
  run(nameHit, {
    env: { DISPATCH_GROUPS: groups },
    argv: [DISPATCH, "pre-tool"],
  }),
  "N1",
  "menu-ideas.md",
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
