// Tests for install.mjs --uninstall on a blank temporary home folder. Nothing outside that folder is
// touched and Codex doesn't have to be installed. Run: node tests/test-uninstall.mjs
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// the backup's folder is the test home's unless a test names one (scripts/uninstall.mjs turns its schedule off)
delete process.env.CLAUDE_BACKUP_HOME;
const REPO = fileURLToPath(new URL("..", import.meta.url));
const INSTALL = path.join(REPO, "install.mjs");
let fails = 0;
const ok = (name, got, want = true) => {
  const pass = JSON.stringify(got) === JSON.stringify(want);
  if (!pass) fails++;
  console.log(
    `${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`}`,
  );
};
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "uninstall-test-"));
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const runWith = (env, home, ...flags) => {
  const r = spawnSync(process.execPath, [INSTALL, "--home", home, ...flags], {
    encoding: "utf8",
    env: { ...process.env, PATH: emptyPath, Path: emptyPath, ...env },
  });
  return { code: r.status, out: r.stdout };
};
const run = (home, ...flags) => runWith({}, home, ...flags);
const walk = (dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isSymbolicLink()
        ? []
        : e.isDirectory()
          ? walk(path.join(dir, e.name))
          : [path.join(dir, e.name)],
    );
const snap = (dir) => walk(dir).map((f) => [f, fs.readFileSync(f, "utf8")]);
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
// A replaced file's copy: setup-logs/<day>-install-backup/<its path from the home folder>, by the local day
const now = new Date();
const DAY = new Date(now.getTime() - now.getTimezoneOffset() * 6e4)
  .toISOString()
  .slice(0, 10);
const backupOf = (h, file, day = DAY) =>
  path.join(
    h,
    ".claude",
    "setup-logs",
    day + "-install-backup",
    path.relative(h, file),
  );
const besideFiles = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((n) => n.includes(".before-install-"));
const commandsIn = (settings) =>
  Object.values(settings.hooks || {})
    .flat()
    .flatMap((g) => g.hooks)
    .map((h) => h.command);
const shipped = ["hooks", "agents", "skills", "workers", "tools"]
  .flatMap((d) => walk(path.join(REPO, d)))
  .map((f) => path.relative(REPO, f));
const example = json(path.join(REPO, "settings.example.json"));
const scripts = Object.values(example.hooks)
  .flat()
  .flatMap((g) => g.hooks)
  .map((h) => h.command.match(/~\/\.claude\/(\S+)/)[1]);

// ---- a home with the person's own hook, setting, hook file and a file under a setup name
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
const projects = path.join(home, "Projects");
fs.mkdirSync(path.join(claude, "hooks"), { recursive: true });
const ownCommand = "node /my/own-hook.mjs";
fs.writeFileSync(
  path.join(claude, "settings.json"),
  JSON.stringify({
    theme: "dark",
    hooks: { Stop: [{ hooks: [{ type: "command", command: ownCommand }] }] },
  }),
);
fs.writeFileSync(path.join(claude, "hooks", "my-own.mjs"), "// mine\n");
const restored = path.normalize(scripts[0]);
const changed = shipped.find((f) => f.startsWith("skills") && f !== restored);
const mineBefore = "// my version of a setup hook\n";
fs.mkdirSync(path.dirname(path.join(claude, restored)), { recursive: true });
fs.writeFileSync(path.join(claude, restored), mineBefore);

ok(
  "install (taking the setup's version of one file of the person's) exits cleanly",
  run(home, "--replace", restored).code,
  0,
);
ok(
  "a dated copy of the person's file was made in setup-logs, none beside it",
  fs.existsSync(backupOf(home, path.join(claude, restored))) &&
    besideFiles(claude).length === 0,
);
ok(
  "the setup's hooks are wired",
  commandsIn(json(path.join(claude, "settings.json"))).length > 1,
);
const tools = shipped.filter((f) => f.startsWith("tools"));
ok(
  "the tools/ files (the Nimbalyst patcher) are installed",
  tools.length > 0 && tools.every((f) => fs.existsSync(path.join(claude, f))),
);
fs.appendFileSync(path.join(claude, changed), "\n// edited by the person\n");
const installed = snap(home);

// ---- dry run: prints, changes nothing
const dry = run(home, "--uninstall", "--dry-run");
ok("dry run exits cleanly", dry.code, 0);
ok(
  "dry run changes nothing",
  JSON.stringify(snap(home)),
  JSON.stringify(installed),
);
ok(
  "dry run ends with what was kept",
  dry.out.includes("Kept, not touched:") &&
    dry.out.includes("Nothing was changed."),
);

// ---- the real uninstall
const un = run(home, "--uninstall");
ok("uninstall exits cleanly", un.code, 0);
const left = json(path.join(claude, "settings.json"));
ok("the person's setting stays", left.theme, "dark");
ok(
  "the empty effort variable the setup set is gone",
  "CLAUDE_CODE_EFFORT_LEVEL" in (left.env ?? {}),
  false,
);
ok("only the person's hook is still wired", commandsIn(left), [ownCommand]);
ok(
  "the person's own hook file stays",
  fs.existsSync(path.join(claude, "hooks", "my-own.mjs")),
);
ok(
  "the setup's files are gone, except the changed one and the restored one",
  shipped
    .filter((f) => ![changed, restored].includes(f))
    .every((f) => !fs.existsSync(path.join(claude, f))),
);
ok(
  "the copy in setup-logs is back under its name",
  fs.readFileSync(path.join(claude, restored), "utf8"),
  mineBefore,
);
ok(
  "no copy of it is left over",
  fs.existsSync(backupOf(home, path.join(claude, restored))),
  false,
);
ok(
  "the changed setup file stays, as changed",
  fs
    .readFileSync(path.join(claude, changed), "utf8")
    .includes("edited by the person"),
);
ok(
  "the run lists the changed file as kept",
  un.out.includes(changed.replace(/\\/g, "/")) &&
    un.out.includes("it differs from what the setup wrote"),
);
ok(
  "the record of the install is gone",
  fs.existsSync(path.join(claude, "setup-state.json")),
  false,
);
ok(
  "the project folders are left alone and the run says so",
  fs.existsSync(path.join(projects, "quick-tasks", "CLAUDE.md")) &&
    un.out.includes("your files in the project folders"),
);
ok(
  "a second uninstall says there is nothing recorded",
  run(home, "--uninstall").code,
  1,
);

// ---- 1. an update replaces the setup's OWN older files: their copies are not the person's and don't come back
const sha = (text) => crypto.createHash("sha256").update(text).digest("hex");
const home2 = path.join(tmp, "home2");
const claude2 = path.join(home2, ".claude");
const userHook = path.join(claude2, restored);
fs.mkdirSync(path.dirname(userHook), { recursive: true });
fs.writeFileSync(userHook, mineBefore);
ok("home2: install exits cleanly", run(home2, "--replace", restored).code, 0);
// make three installed files look as an older release wrote them: a hook, a skill file and the rules
const stateFile2 = path.join(claude2, "setup-state.json");
const st2 = json(stateFile2);
const oldHook = scripts
  .map((s) => path.normalize(s))
  .find((s) => s !== restored);
const oldSkill = shipped.find((f) => f.startsWith("skills") && f !== oldHook);
const OLD = "// an older release of the setup wrote this\n";
for (const rel of [oldHook, oldSkill]) {
  fs.writeFileSync(path.join(claude2, rel), OLD);
  const key = Object.keys(st2.files).find((k) =>
    k.endsWith("/" + rel.replace(/\\/g, "/")),
  );
  st2.files[key] = sha(OLD);
}
const OLD_RULES = "# older rules\n";
fs.writeFileSync(path.join(claude2, "CLAUDE.md"), OLD_RULES);
st2.rules = sha(OLD_RULES);
fs.writeFileSync(stateFile2, JSON.stringify(st2, null, 2));
ok("home2: the update exits cleanly", run(home2).code, 0);
ok(
  "home2: the update made copies of the old setup files in setup-logs",
  fs.existsSync(backupOf(home2, path.join(claude2, oldHook))) &&
    fs.existsSync(backupOf(home2, path.join(claude2, "CLAUDE.md"))) &&
    besideFiles(claude2).length === 0,
);
const un2 = run(home2, "--uninstall");
ok("home2: uninstall exits cleanly", un2.code, 0);
ok(
  "home2: the old hook, skill file and rules did not come back",
  [oldHook, oldSkill, "CLAUDE.md"].every(
    (f) => !fs.existsSync(path.join(claude2, f)),
  ),
);
ok(
  "home2: no file holds an older setup version",
  walk(claude2).every(
    (f) =>
      !fs.readFileSync(f, "utf8").includes("an older release of the setup") ||
      /-install-backup/.test(f),
  ),
);
ok(
  "home2: the person's own file replaced by the first install does come back",
  fs.readFileSync(userHook, "utf8"),
  mineBefore,
);
ok(
  "home2: the old copies stay in setup-logs and the run says so",
  fs.existsSync(backupOf(home2, path.join(claude2, oldHook))) &&
    un2.out.includes(
      "install-backup folders the copies of the files a run replaced",
    ),
);

// ---- 3. a copy an older version left next to the file: uninstall moves it into setup-logs first, then puts it back
const home5 = path.join(tmp, "home5");
const claude5 = path.join(home5, ".claude");
ok("home5: install exits cleanly", run(home5).code, 0);
const hook5 = path.join(claude5, restored);
const oldCopy5 = hook5 + ".before-install-20261001";
fs.writeFileSync(oldCopy5, mineBefore);
const st5 = json(path.join(claude5, "setup-state.json"));
fs.writeFileSync(
  path.join(claude5, "setup-state.json"),
  JSON.stringify({
    ...st5,
    oldCopiesMoved: undefined,
    userCopies: [oldCopy5.replace(/\\/g, "/")],
  }),
);
const dry5 = run(home5, "--uninstall", "--dry-run");
ok(
  "home5: --uninstall --dry-run says it would move the old copy and put it back, and changes nothing",
  [
    dry5.code,
    dry5.out.includes(`[dry run] would move ${oldCopy5.replace(/\\/g, "/")}`),
    dry5.out.includes(`[dry run] restored ${hook5.replace(/\\/g, "/")}`),
    fs.existsSync(oldCopy5),
    fs.existsSync(backupOf(home5, hook5, "2026-10-01")),
    fs.readFileSync(hook5, "utf8") === mineBefore,
  ],
  [0, true, true, true, false, false],
);
const un5 = run(home5, "--uninstall");
ok(
  "home5: the old copy is moved into setup-logs/2026-10-01-install-backup and put back from there",
  [
    un5.code,
    fs.readFileSync(hook5, "utf8"),
    fs.existsSync(oldCopy5),
    fs.existsSync(backupOf(home5, hook5, "2026-10-01")),
    /moved the old copy .*2026-10-01-install-backup/.test(un5.out),
  ],
  [0, mineBefore, false, false, true],
);

// ---- 3b. a run that stops right after moving the old copies still leaves a record that names where they went:
// the next run and --uninstall put the person's rules back
const home6 = path.join(tmp, "home6");
const claude6 = path.join(home6, ".claude");
ok("home6: install exits cleanly", run(home6).code, 0);
const rules6 = path.join(claude6, "CLAUDE.md");
const oldCopy6 = rules6 + ".before-install-20261001";
const MINE6 = "# My rules from before the setup\n\n- Mine.\n";
fs.writeFileSync(oldCopy6, MINE6);
const state6 = path.join(claude6, "setup-state.json");
fs.writeFileSync(
  state6,
  JSON.stringify({
    ...json(state6),
    oldCopiesMoved: undefined,
    userCopies: [oldCopy6.replace(/\\/g, "/")],
  }),
);
const stopped6 = runWith({ SETUP_TEST_STOP_AFTER: "moves" }, home6);
const moved6 = backupOf(home6, rules6, "2026-10-01");
ok(
  "home6: a run that stops after the moves exits with the stop named, the copy moved and the record following it",
  [
    stopped6.code,
    /The install stopped part way: stopped after the moves/.test(stopped6.out),
    /only where your old files are kept in setup-logs/.test(stopped6.out),
    fs.existsSync(oldCopy6),
    fs.existsSync(moved6),
    json(state6).userCopies,
  ],
  [1, true, true, false, true, [moved6.replace(/\\/g, "/")]],
);
const again6 = run(home6);
const un6 = run(home6, "--uninstall");
ok(
  "home6: the next run and --uninstall put the person's CLAUDE.md back from setup-logs",
  [
    again6.code,
    un6.code,
    fs.readFileSync(rules6, "utf8"),
    fs.existsSync(moved6),
  ],
  [0, 0, MINE6, false],
);

// ---- 3c. two equal copies of one day: a dry run names the second as dropped, as the real run drops it. After a
// run that finished the moves, the record says so and later runs no longer search for such copies
const home7 = path.join(tmp, "home7");
const claude7 = path.join(home7, ".claude");
ok("home7: install exits cleanly", run(home7).code, 0);
const state7 = path.join(claude7, "setup-state.json");
ok(
  "home7: the record says the old copies were moved",
  json(state7).oldCopiesMoved,
  true,
);
const hook7 = path.join(claude7, restored);
const [first7, second7] = [
  hook7 + ".before-install-20261001",
  hook7 + ".before-install-20261001-2",
];
for (const f of [first7, second7]) fs.writeFileSync(f, mineBefore);
fs.writeFileSync(
  state7,
  JSON.stringify({ ...json(state7), oldCopiesMoved: undefined }),
);
const fwd7 = (p) => p.replace(/\\/g, "/");
const to7 = backupOf(home7, hook7, "2026-10-01");
const dry7 = run(home7, "--dry-run");
ok(
  "home7: a dry run names the second equal copy as dropped, not moved to a -2 folder",
  [
    dry7.out.includes(`would move ${fwd7(first7)} to ${fwd7(to7)}`),
    dry7.out.includes(
      `would remove ${fwd7(second7)} (the same copy goes to ${fwd7(to7)})`,
    ),
    /2026-10-01-install-backup-2/.test(dry7.out),
  ],
  [true, true, false],
);
const real7 = run(home7);
ok(
  "home7: the real run moves the first, drops the second and puts the mark on record",
  [
    real7.code,
    fs.existsSync(first7),
    fs.existsSync(second7),
    fs.existsSync(to7),
    fs.existsSync(
      path.join(claude7, "setup-logs", "2026-10-01-install-backup-2"),
    ),
    json(state7).oldCopiesMoved,
  ],
  [0, false, false, true, false, true],
);
const late7 = hook7 + ".before-install-20261002";
fs.writeFileSync(late7, mineBefore);
const next7 = run(home7);
ok(
  "home7: with the mark on record a later run does not search for old copies",
  [next7.code, fs.existsSync(late7), /moved the old copy/.test(next7.out)],
  [0, true, false],
);

// ---- 2. with Codex the picture gate is wired in the project settings and linked in: uninstall takes those out
const home3 = path.join(tmp, "home3");
ok(
  "home3: install with Codex exits cleanly",
  run(home3, "--codex", "yes").code,
  0,
);
const aaSettings = path.join(
  home3,
  "Projects",
  "quick-tasks",
  ".claude",
  "settings.json",
);
const aaLink = path.join(
  home3,
  "Projects",
  "quick-tasks",
  ".claude",
  "skills",
  "picture",
);
ok(
  "home3: the picture gate is wired and the skill linked",
  fs.readFileSync(aaSettings, "utf8").includes("picture-gate.mjs") &&
    !!fs.lstatSync(aaLink, { throwIfNoEntry: false }),
);
ok("home3: uninstall exits cleanly", run(home3, "--uninstall").code, 0);
ok(
  "home3: no project settings run a missing script",
  ["claude-settings", "quick-tasks"].every(
    (p) =>
      !fs
        .readFileSync(
          path.join(home3, "Projects", p, ".claude", "settings.json"),
          "utf8",
        )
        .includes(".claude/hooks/"),
  ),
);
ok(
  "home3: the junction is gone",
  !!fs.lstatSync(aaLink, { throwIfNoEntry: false }),
  false,
);
ok(
  "home3: the gate script is gone and the project's own files stay",
  !fs.existsSync(path.join(home3, ".claude", "hooks", "picture-gate.mjs")) &&
    fs.existsSync(path.join(home3, "Projects", "quick-tasks", "CLAUDE.md")),
);

// ---- 3d. an install from before /shared-usage was retired: --uninstall takes out the ccpool start at log-on it wrote
const home8 = path.join(tmp, "home8");
ok("home8: install exits cleanly", run(home8).code, 0);
const ccpoolVbs8 = path.join(
  home8,
  "AppData",
  "Roaming",
  "Microsoft",
  "Windows",
  "Start Menu",
  "Programs",
  "Startup",
  "ccpool.vbs",
);
const ccpoolPlist8 = path.join(
  home8,
  "Library",
  "LaunchAgents",
  "com.ai-coding-setup.ccpool.plist",
);
fs.mkdirSync(path.dirname(ccpoolVbs8), { recursive: true });
fs.writeFileSync(
  ccpoolVbs8,
  `CreateObject("WScript.Shell").Run "cmd /c ccpool daemon start", 0, False\r\n`,
);
fs.mkdirSync(path.dirname(ccpoolPlist8), { recursive: true });
fs.writeFileSync(
  ccpoolPlist8,
  '<plist version="1.0">\n<dict>\n  <key>Label</key><string>com.ai-coding-setup.ccpool</string>\n</dict>\n</plist>\n',
);
const un8 = run(home8, "--uninstall");
ok(
  "home8: --uninstall removes the ccpool start at log-on, Windows and macOS, and names each",
  [
    un8.code,
    fs.existsSync(ccpoolVbs8),
    fs.existsSync(ccpoolPlist8),
    un8.out.includes(
      "removed " + ccpoolVbs8.replace(/\\/g, "/") + " (the start at log-on",
    ),
  ],
  [0, false, false, true],
);

// ---- 3e. Nimbalyst patched by the setup: --uninstall puts the original app.asar back. A fake install under the
// test home's AppData/Local (with --home the real one is never looked at); no folder counts as Program Files
const asarOf = (pkg) => {
  const data = Buffer.from(JSON.stringify(pkg));
  const head = Buffer.from(
    JSON.stringify({
      files: { "package.json": { size: data.length, offset: "0" } },
    }),
  );
  const padded = Buffer.concat([
    head,
    Buffer.alloc((4 - (head.length % 4)) % 4),
  ]);
  const pickle = Buffer.alloc(8);
  pickle.writeUInt32LE(4 + padded.length, 0);
  pickle.writeUInt32LE(head.length, 4);
  const size = Buffer.alloc(8);
  size.writeUInt32LE(4, 0);
  size.writeUInt32LE(8 + padded.length, 4);
  return Buffer.concat([size, pickle, padded, data]);
};
const ORIGINAL = asarOf({ name: "nimbalyst", version: "0.9.1" });
const PATCHED = asarOf({ name: "nimbalyst", version: "0.9.1", patched: true });
// patch.mjs lists running programs with powershell.exe (Windows) or ps: their folder on PATH, nothing else
const psDir =
  process.platform === "win32"
    ? path.join(process.env.SystemRoot, "System32", "WindowsPowerShell", "v1.0")
    : "/bin";
const patchEnv = {
  NIMBALYST_PATCH_PROGRAM_DIRS: path.join(tmp, "no-program-files"),
  PATH: psDir,
  Path: psDir,
};
const fakeNimbalyst = (h) => {
  const res = path.join(
    h,
    "AppData",
    "Local",
    "Programs",
    "Nimbalyst",
    "resources",
  );
  fs.mkdirSync(res, { recursive: true });
  fs.writeFileSync(path.join(res, "app.asar"), PATCHED);
  fs.writeFileSync(path.join(res, "app.asar.orig"), ORIGINAL);
  fs.writeFileSync(
    path.join(res, "ai-coding-setup-patched.json"),
    JSON.stringify({ version: "0.9.1", patches: ["1558"] }),
  );
  return res;
};
const appState = (res) => [
  fs.readFileSync(path.join(res, "app.asar")).equals(ORIGINAL),
  fs.existsSync(path.join(res, "app.asar.orig")),
  fs.existsSync(path.join(res, "ai-coding-setup-patched.json")),
];
const home9 = path.join(tmp, "home9");
ok("home9: install exits cleanly", run(home9).code, 0);
const res9 = fakeNimbalyst(home9);
const dry9 = runWith(patchEnv, home9, "--uninstall", "--dry-run");
ok(
  "home9: a dry run says it would put the original app.asar back and changes nothing",
  [
    dry9.code,
    dry9.out.includes("would put Nimbalyst's original app.asar back"),
    ...appState(res9),
  ],
  [0, true, false, true, true],
);
const un9 = runWith(patchEnv, home9, "--uninstall");
ok(
  "home9: --uninstall with Nimbalyst closed puts the original app.asar back, drops the backup and the marker, and says so",
  [
    un9.code,
    un9.out.includes("restored the original app.asar (Nimbalyst 0.9.1)"),
    ...appState(res9),
  ],
  [0, true, true, false, false],
);
if (process.platform === "win32") {
  // A running Nimbalyst.exe from the fake install folder (a copy of node, waiting): nothing is changed, the run names the command
  const home10 = path.join(tmp, "home10");
  ok("home10: install exits cleanly", run(home10).code, 0);
  const res10 = fakeNimbalyst(home10);
  const exe10 = path.join(path.dirname(res10), "Nimbalyst.exe");
  fs.copyFileSync(process.execPath, exe10);
  const app10 = spawn(exe10, ["-e", "setTimeout(() => {}, 120000)"], {
    stdio: "ignore",
  });
  const un10 = runWith(patchEnv, home10, "--uninstall");
  app10.kill();
  await new Promise((done) =>
    app10.exitCode !== null ? done() : app10.once("exit", done),
  );
  const later10 = `node "${path.join(REPO, "tools", "nimbalyst-patch", "patch.mjs").replace(/\\/g, "/")}" --restore --app "${res10.replace(/\\/g, "/")}"`;
  ok(
    "home10: with Nimbalyst running, --uninstall leaves app.asar as it is and names the command that puts it back later",
    [
      un10.code,
      un10.out.includes("Nimbalyst is running and holds it") &&
        un10.out.includes(later10),
      ...appState(res10),
    ],
    [0, true, false, true, true],
  );
  const again10 = spawnSync(
    process.execPath,
    [
      path.join(REPO, "tools", "nimbalyst-patch", "patch.mjs"),
      "--restore",
      "--app",
      res10,
    ],
    { encoding: "utf8", env: { ...process.env, ...patchEnv } },
  );
  ok(
    "home10: once Nimbalyst is closed, that command puts the original back",
    [again10.status, ...appState(res10)],
    [0, true, false, false],
  );
}

// ---- 3f. a backup with its schedule on: --uninstall turns it off before anything goes, and keeps the backup's folder.
// The installed workers/backup.mjs is swapped for a stand-in, so the real scheduler is never reached: it adds its
// arguments to calls.log in the backup's folder (CLAUDE_BACKUP_HOME, here inside the test folder), and fails when
// STUB_BACKUP_FAIL is set
const home11 = path.join(tmp, "home11");
const claude11 = path.join(home11, ".claude");
ok("home11: install exits cleanly", run(home11).code, 0);
const bk11 = path.join(tmp, "backup11");
fs.mkdirSync(bk11);
const calls11 = path.join(bk11, "calls.log");
fs.writeFileSync(
  path.join(claude11, "workers", "backup.mjs"),
  `import fs from "node:fs";
import path from "node:path";
fs.appendFileSync(path.join(process.env.CLAUDE_BACKUP_HOME, "calls.log"), process.argv.slice(2).join(" ") + "\\n");
if (process.env.STUB_BACKUP_FAIL) { console.error("Unregister-ScheduledTask: access denied"); process.exit(1); }
`,
);
const cfg11 = (schedule) =>
  fs.writeFileSync(
    path.join(bk11, "config.json"),
    JSON.stringify({ target: "b2", schedule }),
  );
const callsOf11 = () =>
  fs.existsSync(calls11)
    ? fs.readFileSync(calls11, "utf8").trim().split("\n")
    : [];
const kept11 = (out) =>
  out.includes(
    `${bk11.replace(/\\/g, "/")}: the backup's folder; it holds the backup's password and storage key`,
  ) && out.includes("Save the password somewhere else");
cfg11(false);
const off11 = runWith(
  { CLAUDE_BACKUP_HOME: bk11 },
  home11,
  "--uninstall",
  "--dry-run",
);
ok(
  "home11: schedule off: a dry run does not start backup.mjs and names the backup's folder as kept",
  [off11.code, /schedule off/.test(off11.out), callsOf11(), kept11(off11.out)],
  [0, false, [], true],
);
cfg11(true);
const dry11 = runWith(
  { CLAUDE_BACKUP_HOME: bk11 },
  home11,
  "--uninstall",
  "--dry-run",
);
ok(
  "home11: schedule on: a dry run says it would turn it off and does not start backup.mjs",
  [
    dry11.code,
    dry11.out.includes("[dry run] would turn the backup's schedule off"),
    callsOf11(),
  ],
  [0, true, []],
);
const before11 = JSON.stringify(snap(home11));
const fail11 = runWith(
  { CLAUDE_BACKUP_HOME: bk11, STUB_BACKUP_FAIL: "1" },
  home11,
  "--uninstall",
);
ok(
  "home11: turning the schedule off fails: the uninstall stops with the error and changes nothing",
  [
    fail11.code,
    fail11.out.includes(
      "The uninstall stopped, nothing was changed: turning the backup's schedule off failed: Unregister-ScheduledTask: access denied",
    ),
    JSON.stringify(snap(home11)) === before11,
  ],
  [1, true, true],
);
fs.rmSync(calls11, { force: true });
const un11 = runWith({ CLAUDE_BACKUP_HOME: bk11 }, home11, "--uninstall");
ok(
  "home11: --uninstall runs backup.mjs off once, before the files go, and keeps the backup's folder",
  [
    un11.code,
    callsOf11(),
    un11.out.includes("the backup's schedule is off"),
    un11.out.indexOf("schedule is off") < un11.out.indexOf("removed "),
    fs.existsSync(path.join(bk11, "config.json")),
    kept11(un11.out),
  ],
  [0, ["off"], true, true, true, true],
);

// ---- 4. a record without a list of files (older setup): stop before changing anything
const home4 = path.join(tmp, "home4");
const claude4 = path.join(home4, ".claude");
fs.mkdirSync(path.join(claude4, "hooks"), { recursive: true });
fs.writeFileSync(
  path.join(claude4, "setup-state.json"),
  JSON.stringify({ version: "0.0.1" }),
);
fs.writeFileSync(
  path.join(claude4, "hooks", scripts[0].replace(/^hooks\//, "")),
  "// a hook\n",
);
fs.writeFileSync(
  path.join(claude4, "settings.json"),
  JSON.stringify({
    hooks: {
      Stop: [
        {
          hooks: [
            {
              type: "command",
              command: `node "${path.join(claude4, scripts[0]).replace(/\\/g, "/")}"`,
            },
          ],
        },
      ],
    },
  }),
);
const before4 = JSON.stringify(snap(home4));
const un4 = run(home4, "--uninstall");
ok("home4: uninstall without a file record exits 1", un4.code, 1);
ok("home4: nothing was changed", JSON.stringify(snap(home4)), before4);
ok(
  "home4: it says to run the update first",
  un4.out.includes("Run the update first"),
);
ok("home4: a second run says the same", run(home4, "--uninstall").code, 1);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fails ? `\n${fails} failed` : "\nall passed");
process.exit(fails ? 1 : 0);
