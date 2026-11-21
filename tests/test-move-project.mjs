#!/usr/bin/env node
// Tests for skills/file-upkeep/move-project.mjs (D6), through its command line, on a made-up world in a temp
// folder: a projects folder with a git repo and a worktree outside it (<name>_worktrees), fake Nimbalyst files
// and database, a made-up home (.claude.json, .claude/projects/<slug>, live text files), a fake schtasks that
// keeps its tasks in a JSON file, and a fake Nimbalyst install for the queue (the deliver.mjs fakes, as in
// tests/test-nimbalyst-deliver.mjs). Nothing here touches the real %APPDATA%\@nimbalyst, ~/.claude, C:\Projects
// or the scheduled tasks. Windows only.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { pathToFileURL } from "node:url";

const MOVE = path.join(
  import.meta.dirname,
  "..",
  "skills",
  "file-upkeep",
  "move-project.mjs",
);
if (process.platform !== "win32") {
  console.log("skipped: move-project.mjs is Windows only");
  process.exit(0);
}
const T = fs.realpathSync.native(
  fs.mkdtempSync(path.join(os.tmpdir(), "move-project-test-")),
);
let failed = 0,
  passed = 0;
function check(name, ok, detail = "") {
  ok ? passed++ : failed++;
  console.log(
    `${ok ? "ok  " : "FAIL"} ${name}${ok || !detail ? "" : `\n     ${String(detail).slice(0, 900)}`}`,
  );
}
const sha256 = (f) =>
  crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const sha512 = (f) =>
  crypto.createHash("sha512").update(fs.readFileSync(f)).digest("base64");
const readJson = (f) =>
  fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : null;
const write = (f, text) => {
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, text);
};
const writeJson = (f, value) => write(f, JSON.stringify(value, null, 2) + "\n");
const fwd = (p) => p.replace(/\\/g, "/");
const same = (a, b) =>
  typeof a === "string" &&
  typeof b === "string" &&
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
// how Claude Code files a project's history: every character that is not a letter or digit becomes "-"
const slug = (p) => p.replace(/[^A-Za-z0-9]/g, "-");
// Nimbalyst's workspace-settings.json key: "ws:" + base64 of the path, without padding
const wsKey = (p) =>
  "ws:" + Buffer.from(p).toString("base64").replace(/=+$/, "");

// git without the person's own settings (no global or system config: no hooks, no templates)
const GITCONFIG = path.join(T, "gitconfig");
write(GITCONFIG, "");
const GIT_ENV = {
  GIT_CONFIG_GLOBAL: GITCONFIG,
  GIT_CONFIG_NOSYSTEM: "1",
};
function git(cwd, ...args) {
  const r = spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });
  if (r.status !== 0)
    throw new Error(`git ${args.join(" ")} in ${cwd}: ${r.stderr}`);
  return r.stdout;
}
const gitTry = (cwd, ...args) =>
  spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...GIT_ENV },
  });

// ---- the fake Nimbalyst install the queue asks deliver.mjs about (see tests/test-nimbalyst-deliver.mjs) ----
// "patched" means the updater-block patch is in app.asar: the app's quit listener then starts deliver --after-quit
const MAIN = 'module.exports = { updater: "on", label: "Edited" };\n';
const COMPLETE = 'module.exports = { updater: "off", label: "Changed" };\n';
function buildAsar(file, version, main) {
  const files = {
    "package.json": JSON.stringify({ name: "nimbalyst", version }),
    "out/main/index.js": main,
  };
  const header = { files: {} },
    data = [];
  let offset = 0;
  for (const [p, content] of Object.entries(files)) {
    const parts = p.split("/"),
      name = parts.pop();
    let dir = header;
    for (const d of parts) dir = dir.files[d] ??= { files: {} };
    const buf = Buffer.from(content);
    dir.files[name] = { size: buf.length, offset: String(offset) };
    offset += buf.length;
    data.push(buf);
  }
  const json = Buffer.from(JSON.stringify(header)),
    payload = Math.ceil((4 + json.length) / 4) * 4;
  const head = Buffer.alloc(16 + payload - 4);
  head.writeUInt32LE(4, 0);
  head.writeUInt32LE(payload + 4, 4);
  head.writeUInt32LE(payload, 8);
  head.writeUInt32LE(json.length, 12);
  json.copy(head, 16);
  write(file, Buffer.concat([head, ...data]));
  return file;
}
// junk, the fuse sentinel, version 1, 9 fuses with EnableEmbeddedAsarIntegrityValidation off
const fakeExe = (file) =>
  write(
    file,
    Buffer.concat([
      crypto.randomBytes(2000),
      Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX"),
      Buffer.from([1, 9]),
      Buffer.from("101100011"),
      crypto.randomBytes(100),
    ]),
  );
const PATCHES = path.join(T, "patches");
write(
  path.join(PATCHES, "updater-block.mjs"),
  `export default { id: "updater-block", files: /^out\\/main\\/index\\.js$/, upstream: null, requiredFirst: true,
  edits: [{ anchor: 'updater: "on"', replace: 'updater: "off"' }] };\n`,
);
write(
  path.join(PATCHES, "fix.mjs"),
  `export default { id: "fix", files: /^out\\/main\\/index\\.js$/, upstream: "UPSTREAM_FIX",
  edits: [{ anchor: 'label: "Edited"', replace: 'label: "Changed"' }] };\n`,
);
// nothing in these cases installs or downloads: both fakes fail loudly when called
const NO_INSTALL = path.join(T, "source", "Nimbalyst-Windows-x64.exe");
write(
  NO_INSTALL,
  'console.error("no install in the move-project test"); process.exit(1);\n',
);
const NO_DOWNLOAD = path.join(T, "no-download.mjs");
write(
  NO_DOWNLOAD,
  'console.error("no download in the move-project test"); process.exit(1);\n',
);
const PAYLOAD = buildAsar(
  path.join(T, "source", "payload-0.84.0.asar"),
  "0.84.0",
  MAIN,
);
const PIN = path.join(T, "pin.json");
writeJson(PIN, {
  version: "0.84.0",
  url: NO_INSTALL,
  sha512: sha512(NO_INSTALL),
  size: fs.statSync(NO_INSTALL).size,
  electron: null,
  asarSha256: sha256(PAYLOAD),
  patches: ["updater-block", "fix"],
  checkedAt: "2026-11-20T00:00:00Z",
});

// ---- the fake schtasks: run with node in place of schtasks.exe ----
// Its tasks are tasks.json next to it ({ "\\name": "<task xml>" }). It answers /query (all tasks or one /tn; as
// /xml, as /fo csv, or as a plain table), carries out /create /tn <name> /xml <file> /f, and adds each call to
// calls.jsonl next to it ({ args, created? }).
const FAKE_SCHTASKS = `import fs from "node:fs";
import path from "node:path";
const here = import.meta.dirname, stateFile = path.join(here, "tasks.json");
const args = process.argv.slice(2), at = (f) => args.findIndex((a) => a.toLowerCase() === f);
const val = (f) => (at(f) >= 0 ? args[at(f) + 1] : undefined);
const tasks = JSON.parse(fs.readFileSync(stateFile, "utf8"));
const norm = (n) => "\\\\" + String(n).replace(/^\\\\/, "");
const call = { args };
const tag = (xml, t) => (xml.match(new RegExp("<" + t + ">([^<]*)</" + t + ">")) || [])[1] ?? "";
const csv = (row) => row.map((v) => '"' + String(v).replace(/"/g, '""') + '"').join(",");
function answer() {
  if (at("/create") >= 0) {
    const b = fs.readFileSync(val("/xml"));
    const xml = b[0] === 0xff && b[1] === 0xfe ? b.subarray(2).toString("utf16le") : b.toString("utf8").replace(/^\\uFEFF/, "");
    const name = norm(val("/tn"));
    call.created = { name, xml };
    tasks[name] = xml;
    fs.writeFileSync(stateFile, JSON.stringify(tasks, null, 2));
    return [0, 'SUCCESS: The scheduled task "' + name.slice(1) + '" has successfully been created.\\r\\n'];
  }
  if (at("/query") < 0) return [1, "ERROR: Invalid argument/option.\\r\\n"];
  let names = Object.keys(tasks);
  const tn = val("/tn");
  if (tn !== undefined) {
    names = names.filter((n) => n.toLowerCase() === norm(tn).toLowerCase());
    if (!names.length) return [1, "ERROR: The system cannot find the file specified.\\r\\n"];
  }
  if (at("/xml") >= 0) {
    if (tn !== undefined) return [0, tasks[names[0]]];
    const body = (x) => x.replace(/^<\\?xml[^>]*>\\s*/, "");
    return [0, '<?xml version="1.0" encoding="UTF-16"?>\\r\\n<Tasks>\\r\\n' +
      names.map((n) => "<!-- " + n + " -->\\r\\n" + body(tasks[n])).join("") + "</Tasks>\\r\\n"];
  }
  if (/csv/i.test(val("/fo") ?? "")) {
    const rows = names.map((n) => {
      const x = tasks[n];
      return csv(["PC", n, "N/A", "Ready", "Interactive only", "N/A", "0", "test",
        (tag(x, "Command") + " " + tag(x, "Arguments")).trim(), tag(x, "WorkingDirectory"), "N/A"]);
    });
    const head = csv(["HostName", "TaskName", "Next Run Time", "Status", "Logon Mode", "Last Run Time",
      "Last Result", "Author", "Task To Run", "Start In", "Comment"]);
    return [0, (at("/nh") >= 0 ? rows : [head, ...rows]).join("\\r\\n") + "\\r\\n"];
  }
  return [0, names.map((n) => n + "    N/A    Ready").join("\\r\\n") + "\\r\\n"];
}
const [code, out] = answer();
fs.appendFileSync(path.join(here, "calls.jsonl"), JSON.stringify(call) + "\\n");
(code ? process.stderr : process.stdout).write(out);
process.exitCode = code;
`;
const taskXml = (name, script, cwd) => `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <URI>${name}</URI>
  </RegistrationInfo>
  <Actions Context="Author">
    <Exec>
      <Command>node.exe</Command>
      <Arguments>"${script}"</Arguments>
      <WorkingDirectory>${cwd}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;

// ---- one made-up world per case ----
// P\fam-port is the project (a git repo) with its worktree outside it at P\fam-port_worktrees\road; P\fam-portal is
// a sister project whose name starts with the same letters: nothing of it may change. The move is to P\fam\port.
function world(name, { app = "patched" } = {}) {
  const root = path.join(T, name),
    P = path.join(root, "P");
  const w = {
    root,
    P,
    from: path.join(P, "fam-port"),
    to: path.join(P, "fam", "port"),
    portal: path.join(P, "fam-portal"),
    wt: path.join(P, "fam-port_worktrees", "road"),
    home: path.join(root, "home"),
    appdata: path.join(root, "appdata"),
    nim: path.join(root, "appdata", "@nimbalyst", "electron"),
    deliver: path.join(root, "deliver-data"),
    install: path.join(root, "Programs", "Nimbalyst"),
    tasks: path.join(root, "tasks"),
    runningFile: path.join(root, "running.txt"),
  };
  w.claude = path.join(w.home, ".claude");
  w.skill = path.join(w.claude, "skills", "x", "SKILL.md");
  w.settings = path.join(w.claude, "settings.json");
  w.db = path.join(w.nim, "sqlite-db", "nimbalyst.sqlite");
  const nightly = (base) => path.join(base, "scripts", "nightly.mjs");
  w.nightly = nightly(w.from);

  // the project and its worktree
  write(path.join(w.from, "README.md"), "# fam-port\n");
  write(path.join(w.from, "docs", "notes.md"), "notes\n");
  write(w.nightly, "console.log('nightly');\n");
  git(w.from, "init", "-q", "-b", "main");
  git(w.from, "add", ".");
  git(
    w.from,
    "-c",
    "user.name=test",
    "-c",
    "user.email=test@example.com",
    "commit",
    "-q",
    "-m",
    "start",
  );
  git(w.from, "worktree", "add", "-q", "-b", "road", w.wt);
  write(path.join(w.portal, "run.mjs"), "console.log('portal');\n");

  // Nimbalyst's two JSON files and its database
  writeJson(path.join(w.nim, "app-settings.json"), {
    theme: "dark",
    recent: [
      { path: w.from, name: "fam-port" },
      { path: w.portal, name: "fam-portal" },
    ],
    docSyncEnabledProjects: [w.from, w.portal],
  });
  writeJson(path.join(w.nim, "workspace-settings.json"), {
    [wsKey(w.from)]: {
      workspacePath: w.from,
      windowState: { workspacePath: w.from, width: 1200 },
      attachedFolders: [path.join(w.from, "docs")],
    },
    [wsKey(w.portal)]: {
      workspacePath: w.portal,
      windowState: { workspacePath: w.portal, width: 900 },
      attachedFolders: [],
    },
  });
  fs.mkdirSync(path.dirname(w.db), { recursive: true });
  const db = new DatabaseSync(w.db);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE ai_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, title TEXT);
    CREATE TABLE worktrees (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, name TEXT);
    CREATE TABLE tracker_items (id TEXT PRIMARY KEY, workspace TEXT NOT NULL, title TEXT);
    CREATE TABLE github_issue_poll_state (id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL UNIQUE, last_polled_at INTEGER);`);
  const add = (sql, ...rows) => {
    const s = db.prepare(sql);
    for (const r of rows) s.run(...r);
  };
  add(
    "INSERT INTO ai_sessions VALUES (?, ?, ?)",
    ["s1", w.from, "first"],
    ["s2", w.from, "second"],
    ["s3", w.portal, "portal"],
  );
  add("INSERT INTO worktrees VALUES (?, ?, ?)", ["wt1", w.from, "road"]);
  add(
    "INSERT INTO tracker_items VALUES (?, ?, ?)",
    ["t1", w.from, "a bug"],
    ["t2", w.portal, "portal bug"],
  );
  add(
    "INSERT INTO github_issue_poll_state VALUES (?, ?, ?)",
    [1, w.from, 100],
    [2, w.portal, 200],
  );
  db.close();

  // the made-up home: .claude.json, the history folders, live text files naming the project
  writeJson(path.join(w.home, ".claude.json"), {
    numStartups: 3,
    projects: {
      [fwd(w.from)]: { allowedTools: [], lastSessionId: "s1" },
      [fwd(w.portal)]: { allowedTools: [], lastSessionId: "p1" },
    },
  });
  write(
    path.join(w.claude, "projects", slug(w.from), "s1.jsonl"),
    JSON.stringify({ cwd: w.from }) + "\n",
  );
  write(
    path.join(w.claude, "projects", slug(w.portal), "p1.jsonl"),
    JSON.stringify({ cwd: w.portal }) + "\n",
  );
  write(
    w.skill,
    `# x\n\nRun node "${w.nightly}".\nThe notes are in ${fwd(path.join(w.from, "docs"))}.\nThe sister project is ${w.portal}, also written ${fwd(w.portal)}.\n`,
  );
  writeJson(w.settings, {
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: `node "${w.nightly}"` }] },
      ],
    },
  });

  // the fake schtasks: one task names the project, one the sister project
  write(path.join(w.tasks, "schtasks.mjs"), FAKE_SCHTASKS);
  writeJson(path.join(w.tasks, "tasks.json"), {
    "\\fam-port nightly": taskXml("\\fam-port nightly", w.nightly, w.from),
    "\\Other job": taskXml(
      "\\Other job",
      path.join(w.portal, "run.mjs"),
      w.portal,
    ),
  });
  w.created = () => {
    const f = path.join(w.tasks, "calls.jsonl");
    return fs.existsSync(f)
      ? fs
          .readFileSync(f, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
          .filter((c) => c.created)
          .map((c) => c.created)
      : [];
  };

  // the fake Nimbalyst install, open: patched (the quit listener is there) or not
  buildAsar(
    path.join(w.install, "resources", "app.asar"),
    "0.84.0",
    app === "patched" ? COMPLETE : MAIN,
  );
  fakeExe(path.join(w.install, "Nimbalyst.exe"));
  write(w.runningFile, path.join(w.install, "Nimbalyst.exe") + "\n");

  w.env = (extra = {}) => ({
    ...process.env,
    ...GIT_ENV,
    USERPROFILE: w.home,
    HOME: w.home,
    APPDATA: w.appdata,
    LOCALAPPDATA: path.join(root, "localappdata"),
    MOVE_PROJECT_NIMBALYST_DATA: w.nim,
    MOVE_PROJECT_SCHTASKS: path.join(w.tasks, "schtasks.mjs"),
    MOVE_PROJECT_RUNNING: "0",
    NIMBALYST_FOLLOW: "",
    NIMBALYST_DELIVER_DATA: w.deliver,
    NIMBALYST_DELIVER_APP: w.install,
    NIMBALYST_DELIVER_PIN: PIN,
    NIMBALYST_DELIVER_PATCHES: PATCHES,
    NIMBALYST_DELIVER_DOWNLOAD: NO_DOWNLOAD,
    NIMBALYST_DELIVER_RUN_WITH: process.execPath,
    NIMBALYST_DELIVER_RUNNING: w.runningFile,
    NIMBALYST_DELIVER_QUIT_WAIT_MS: "600",
    NIMBALYST_DELIVER_MESSAGE_FILE: path.join(root, "messages.jsonl"),
    NIMBALYST_PATCH_PROGRAM_DIRS: "",
    SETUP_NIMBALYST_OPEN_FILE: w.runningFile,
    ...extra,
  });
  w.run = (args, extra) => {
    const r = spawnSync(process.execPath, [MOVE, ...args], {
      encoding: "utf8",
      env: w.env(extra),
      timeout: 120000,
    });
    return { code: r.status, out: `${r.stdout}${r.stderr}`.trim() };
  };
  w.move = (flags = [], extra) =>
    w.run([w.from, w.to, ...flags, "--home", w.home], extra);
  // every file and folder a move may change (Nimbalyst's database without its -wal and -shm files)
  w.hash = () => {
    const out = [];
    const walk = (p) => {
      if (!fs.existsSync(p)) return out.push(`${p} missing`);
      if (!fs.statSync(p).isDirectory()) return out.push(`${p} ${sha256(p)}`);
      out.push(`${p}${path.sep}`);
      for (const n of fs.readdirSync(p).sort())
        if (!/-(wal|shm)$/.test(n)) walk(path.join(p, n));
    };
    for (const p of [w.P, w.home, w.appdata, path.join(w.tasks, "tasks.json")])
      walk(p);
    return crypto.createHash("sha256").update(out.join("\n")).digest("hex");
  };
  w.queue = () => readJson(path.join(w.deliver, "moves.json"));
  w.staged = () => readJson(path.join(w.deliver, "staged.json"));
  return w;
}

// After a move from P\fam-port to P\fam\port: every place keyed by the path names the new place, and nothing of the
// sister project P\fam-portal changed. One check per place, so a FAIL names the place the move left behind.
function placesFixed(w, label) {
  check(
    `${label}: the project folder is at the new place with its files and its .git, the old place is gone`,
    !fs.existsSync(w.from) &&
      fs.existsSync(path.join(w.to, "README.md")) &&
      fs.existsSync(path.join(w.to, ".git")),
    `${w.from}: ${fs.existsSync(w.from)}, ${w.to}: ${fs.existsSync(w.to)}`,
  );

  // git: the outside worktree is still linked both ways and works (wherever the move put it)
  const list = gitTry(w.to, "worktree", "list", "--porcelain");
  const entries = (list.stdout ?? "")
    .split(/\r?\n\r?\n/)
    .filter((b) => b.trim())
    .map((b) =>
      Object.fromEntries(
        b
          .trim()
          .split(/\r?\n/)
          .map((l) =>
            l.includes(" ")
              ? [l.slice(0, l.indexOf(" ")), l.slice(l.indexOf(" ") + 1)]
              : [l, true],
          ),
      ),
    );
  const road = entries.find((e) => e.branch === "refs/heads/road");
  const wt = road?.worktree;
  const back =
    wt && fs.existsSync(path.join(wt, ".git"))
      ? fs
          .readFileSync(path.join(wt, ".git"), "utf8")
          .replace(/^gitdir:\s*/, "")
          .trim()
      : null;
  const gitdirFile = path.join(w.to, ".git", "worktrees", "road", "gitdir");
  const forth = fs.existsSync(gitdirFile)
    ? fs.readFileSync(gitdirFile, "utf8").trim()
    : null;
  check(
    `${label}: git worktree list from the new place shows the worktree at a real folder, both link files point at real paths, git status works in it`,
    list.status === 0 &&
      same(entries[0]?.worktree, w.to) &&
      !!road &&
      !road.prunable &&
      fs.existsSync(path.join(wt, "README.md")) &&
      same(back, path.join(w.to, ".git", "worktrees", "road")) &&
      same(forth, path.join(wt, ".git")) &&
      gitTry(wt, "status", "--short").status === 0,
    `${list.stdout}${list.stderr}\nworktree .git: ${back}\ngitdir: ${forth}`,
  );

  // Nimbalyst
  const a = readJson(path.join(w.nim, "app-settings.json"));
  check(
    `${label}: Nimbalyst's app-settings.json: the recent entry and docSyncEnabledProjects name the new place; the sister project and other settings stay`,
    a?.theme === "dark" &&
      a.recent?.some((r) => same(r.path, w.to)) &&
      !a.recent.some((r) => same(r.path, w.from)) &&
      a.recent.some((r) => r.path === w.portal && r.name === "fam-portal") &&
      a.docSyncEnabledProjects?.some((p) => same(p, w.to)) &&
      !a.docSyncEnabledProjects.some((p) => same(p, w.from)) &&
      a.docSyncEnabledProjects.includes(w.portal),
    JSON.stringify(a),
  );
  const s = readJson(path.join(w.nim, "workspace-settings.json")) ?? {};
  const e = s[wsKey(w.to)];
  check(
    `${label}: Nimbalyst's workspace-settings.json: the entry is keyed "ws:"+base64 of the new place, and its workspacePath, windowState.workspacePath and attachedFolders name it; the sister project's entry stays`,
    !!e &&
      !(wsKey(w.from) in s) &&
      same(e.workspacePath, w.to) &&
      same(e.windowState?.workspacePath, w.to) &&
      e.windowState.width === 1200 &&
      e.attachedFolders?.length === 1 &&
      same(e.attachedFolders[0], path.join(w.to, "docs")) &&
      JSON.stringify(s[wsKey(w.portal)]) ===
        JSON.stringify({
          workspacePath: w.portal,
          windowState: { workspacePath: w.portal, width: 900 },
          attachedFolders: [],
        }),
    JSON.stringify(s),
  );
  let rows;
  const db = new DatabaseSync(w.db, { readOnly: true });
  try {
    const all = (sql) => db.prepare(sql).all();
    rows = {
      ai_sessions: all(
        "SELECT id, workspace_id AS p FROM ai_sessions ORDER BY id",
      ),
      worktrees: all("SELECT id, workspace_id AS p FROM worktrees ORDER BY id"),
      tracker_items: all(
        "SELECT id, workspace AS p FROM tracker_items ORDER BY id",
      ),
      github_issue_poll_state: all(
        "SELECT id, workspace_id AS p, last_polled_at AS t FROM github_issue_poll_state ORDER BY id",
      ),
    };
  } finally {
    db.close();
  }
  const at = (list, id) => list.find((r) => r.id === id)?.p;
  check(
    `${label}: Nimbalyst's database: ai_sessions.workspace_id, worktrees.workspace_id, tracker_items.workspace and the unique github_issue_poll_state.workspace_id name the new place; the sister project's rows stay`,
    rows.ai_sessions.length === 3 &&
      same(at(rows.ai_sessions, "s1"), w.to) &&
      same(at(rows.ai_sessions, "s2"), w.to) &&
      at(rows.ai_sessions, "s3") === w.portal &&
      same(at(rows.worktrees, "wt1"), w.to) &&
      same(at(rows.tracker_items, "t1"), w.to) &&
      at(rows.tracker_items, "t2") === w.portal &&
      rows.github_issue_poll_state.length === 2 &&
      same(at(rows.github_issue_poll_state, 1), w.to) &&
      rows.github_issue_poll_state[0].t === 100 &&
      at(rows.github_issue_poll_state, 2) === w.portal,
    JSON.stringify(rows),
  );

  // Claude Code
  const c = readJson(path.join(w.home, ".claude.json"));
  check(
    `${label}: ~/.claude.json: the projects entry is keyed by the new place (forward slashes) with its settings; the sister project's entry stays`,
    c?.numStartups === 3 &&
      JSON.stringify(c.projects?.[fwd(w.to)]) ===
        JSON.stringify({ allowedTools: [], lastSessionId: "s1" }) &&
      !(fwd(w.from) in c.projects) &&
      c.projects[fwd(w.portal)]?.lastSessionId === "p1",
    JSON.stringify(c),
  );
  const projects = path.join(w.claude, "projects");
  check(
    `${label}: ~/.claude/projects/<slug>: the history folder carries the new place's slug with its sessions; the sister project's stays`,
    fs.existsSync(path.join(projects, slug(w.to), "s1.jsonl")) &&
      // the old and new places can share a slug (P\fam-port and P\fam\port both give ...-P-fam-port): then the
      // folder keeps its name. Changed by the lead after S4a: the first version needed it to exist and be gone at once.
      (slug(w.to) === slug(w.from) ||
        !fs.existsSync(path.join(projects, slug(w.from)))) &&
      fs.existsSync(path.join(projects, slug(w.portal), "p1.jsonl")),
    fs.existsSync(projects) ? fs.readdirSync(projects).join("\n") : "none",
  );
  const skill = fs.readFileSync(w.skill, "utf8");
  const settings = readJson(w.settings);
  const nightlyTo = path.join(w.to, "scripts", "nightly.mjs");
  check(
    `${label}: live text files under ~/.claude name the new place (C:\\x and C:/x in a SKILL.md, C:\\\\x inside settings.json); the sister project's path stays`,
    skill.includes(`node "${nightlyTo}"`) &&
      skill.includes(fwd(path.join(w.to, "docs"))) &&
      skill.includes(`${w.portal}, also written ${fwd(w.portal)}.`) &&
      !skill
        .split(w.portal)
        .join("")
        .split(fwd(w.portal))
        .join("")
        .toLowerCase()
        .includes("fam-port") &&
      settings?.hooks?.SessionStart?.[0]?.hooks?.[0]?.command ===
        `node "${nightlyTo}"`,
    `${skill}\n${JSON.stringify(settings)}`,
  );

  // scheduled tasks
  const made = w.created();
  const xml =
    made.filter((t) => t.name.toLowerCase() === "\\fam-port nightly").at(-1)
      ?.xml ?? "";
  check(
    `${label}: the scheduled task naming the project is created again naming the new place (Task To Run and Start In); the sister project's task is left alone`,
    xml.includes(`"${nightlyTo}"`) &&
      xml.includes(`<WorkingDirectory>${w.to}</WorkingDirectory>`) &&
      !xml.includes(w.from) &&
      !made.some((t) => t.name.toLowerCase() === "\\other job"),
    JSON.stringify(made),
  );
}

try {
  let w, r, before;

  // 1. --dry, with Nimbalyst open (the dry run reads only): lists every place, changes nothing
  w = world("dry");
  before = w.hash();
  r = w.move(["--dry"], { MOVE_PROJECT_RUNNING: "1" });
  check(
    "--dry: exit 0 and nothing changes (the same hash of the project, worktree, home, Nimbalyst files and tasks), no task created, no queue",
    r.code === 0 &&
      w.hash() === before &&
      w.created().length === 0 &&
      !w.queue(),
    r.out,
  );
  const places = {
    worktree: /fam-port_worktrees/,
    "app-settings.json": /app-settings\.json/,
    "workspace-settings.json": /workspace-settings\.json/,
    ai_sessions: /\bai_sessions\b/,
    worktrees: /\bworktrees\b/,
    tracker_items: /\btracker_items\b/,
    github_issue_poll_state: /\bgithub_issue_poll_state\b/,
    ".claude.json": /\.claude\.json/,
    "the history folder": new RegExp(slug(w.from)),
    "SKILL.md": /SKILL\.md/,
    "~/.claude/settings.json": /(^|[\\/\s])settings\.json/m,
    "the task": /fam-port nightly/,
  };
  const missing = Object.keys(places).filter((k) => !places[k].test(r.out));
  check(
    "--dry: the list names every place the move fixes (worktree, both Nimbalyst files, each database table, .claude.json, the history folder, the live text files, the task) and nothing of the sister project",
    missing.length === 0 &&
      !/fam-portal/.test(r.out) &&
      !/Other job/.test(r.out),
    `missing: ${missing.join(", ")}\n${r.out}`,
  );

  // 2. Nimbalyst running: a real move refuses and changes nothing
  w = world("running");
  before = w.hash();
  r = w.move([], { MOVE_PROJECT_RUNNING: "1" });
  check(
    "Nimbalyst running: a real move exits 1, says Nimbalyst is open, changes nothing",
    r.code === 1 &&
      /nimbalyst/i.test(r.out) &&
      /running|open/i.test(r.out) &&
      w.hash() === before &&
      w.created().length === 0,
    r.out,
  );

  // 3. Nimbalyst closed: a real move fixes every place
  w = world("move");
  r = w.move([], { MOVE_PROJECT_RUNNING: "0" });
  check("a move with Nimbalyst closed: exit 0", r.code === 0, r.out);
  placesFixed(w, "a move with Nimbalyst closed");

  // 4. the target exists: refused before anything is touched
  w = world("target");
  write(path.join(w.to, "keep.txt"), "already here\n");
  before = w.hash();
  r = w.move([], { MOVE_PROJECT_RUNNING: "0" });
  check(
    "an existing target: exit 1, says it exists, nothing touched (the same hash, no task created)",
    r.code === 1 &&
      /exist/i.test(r.out) &&
      w.hash() === before &&
      w.created().length === 0,
    r.out,
  );

  // 5. --queue with Nimbalyst open and patched (its quit listener starts deliver --after-quit), then --run-queued
  w = world("queue");
  before = w.hash();
  r = w.move(["--queue"], { MOVE_PROJECT_RUNNING: "1" });
  const q = w.queue();
  check(
    "--queue, Nimbalyst open with its quit listener: exit 0, <deliver data>/moves.json holds { from, to, at }, nothing moved yet",
    r.code === 0 &&
      q?.moves?.length === 1 &&
      same(q.moves[0].from, w.from) &&
      same(q.moves[0].to, w.to) &&
      !Number.isNaN(Date.parse(q.moves[0].at)) &&
      w.hash() === before,
    `${r.out}\n${JSON.stringify(q)}`,
  );
  const job = w.staged();
  check(
    "--queue runs deliver's --stage: a marker job (no version, no installer, atClose true) makes the next close start --after-quit",
    !!job &&
      !("version" in job) &&
      job.installer === null &&
      job.atClose === true,
    `${JSON.stringify(job)}\n${fs.existsSync(path.join(w.deliver, "deliver.log")) ? fs.readFileSync(path.join(w.deliver, "deliver.log"), "utf8") : ""}`,
  );
  fs.rmSync(w.runningFile, { force: true });
  r = w.run(["--run-queued"], { MOVE_PROJECT_RUNNING: "0" });
  check(
    "--run-queued with Nimbalyst closed: exit 0, the queue is empty",
    r.code === 0 && !(w.queue()?.moves?.length > 0),
    `${r.out}\n${JSON.stringify(w.queue())}`,
  );
  placesFixed(w, "--run-queued");

  // 6. --queue with no quit listener (the app not patched, or the delivery off): refused, nothing queued
  for (const [name, app, extra, why] of [
    ["queue-unpatched", "unpatched", {}, "the app not patched"],
    ["queue-off", "patched", { NIMBALYST_FOLLOW: "off" }, "the delivery off"],
  ]) {
    w = world(name, { app });
    before = w.hash();
    r = w.move(["--queue"], { MOVE_PROJECT_RUNNING: "1", ...extra });
    check(
      `--queue with no quit listener (${why}): exit 1, says the move needs Nimbalyst closed, nothing queued or changed`,
      r.code === 1 &&
        /nimbalyst/i.test(r.out) &&
        /clos/i.test(r.out) &&
        !(w.queue()?.moves?.length > 0) &&
        w.hash() === before,
      `${r.out}\n${JSON.stringify(w.queue())}`,
    );
  }

  // 7. --tasks <file>: lists the scheduled tasks naming one file, changes none
  w = world("tasks");
  r = w.run(["--tasks", w.nightly]);
  check(
    "--tasks <file>: exit 0, lists the task naming the file and not the other one, creates nothing",
    r.code === 0 &&
      /fam-port nightly/.test(r.out) &&
      !/Other job/.test(r.out) &&
      w.created().length === 0,
    r.out,
  );

  // ---- cases from the S4a review ----
  // 8. a move to P\renamed (a new history folder name) in a world with more around it: neighbour folders
  // "fam-port - Copy" and "fam-port (2)", live files under ~/.claude/rules and ~/.claude/workers, a history folder of
  // a subfolder (and a memory file naming it), and a history folder no session places
  w = world("more");
  const renamed = path.join(w.P, "renamed");
  const copyFile = path.join(w.P, "fam-port - Copy", "x.cmd"),
    secondFile = path.join(w.P, "fam-port (2)", "y.md");
  write(copyFile, "rem copy\n");
  write(secondFile, "second\n");
  const sky = path.join(w.claude, "skills", "n", "SKILL.md");
  write(
    sky,
    `copy: ${copyFile}\nsecond: ${secondFile}\nown: ${w.from} and more\n`,
  );
  const rulesFile = path.join(w.claude, "rules", "paths.md"),
    workersFile = path.join(w.claude, "workers", "run.mjs");
  write(rulesFile, `The project lives in ${w.from}.\n`);
  write(workersFile, `const p = "${fwd(w.nightly)}";\n`);
  const projectsDir = path.join(w.claude, "projects");
  const subSlug = `${slug(w.from)}-sub`,
    ghost = path.join(projectsDir, `${slug(w.from)}-ghost`);
  write(
    path.join(projectsDir, subSlug, "q1.jsonl"),
    JSON.stringify({ cwd: path.join(w.from, "sub") }) + "\n",
  );
  write(path.join(ghost, "memory", "MEMORY.md"), "no sessions here\n");
  const memo = path.join(projectsDir, slug(w.from), "memory", "notes.md");
  write(memo, `See ${subSlug} and ${slug(w.from)}.\n`);
  const moreArgs = [w.from, renamed, "--home", w.home];
  r = w.run([...moreArgs, "--dry"]);
  check(
    "an open Claude Code session: --dry prints a warning line naming the risk (other open Claude Code sessions in the project, ~/.claude.json written back, the old history folder)",
    r.code === 0 &&
      /warning:.*open Claude Code session/i.test(r.out) &&
      /\.claude\.json/.test(r.out.split(/warning:/)[1] ?? "") &&
      /history folder/.test(r.out.split(/warning:/)[1] ?? ""),
    r.out,
  );
  const dryOut = r.out;
  r = w.run(moreArgs);
  check(
    "an open Claude Code session: a real move prints the same warning line, and exits 0",
    r.code === 0 && /warning:.*open Claude Code session/i.test(r.out),
    r.out,
  );
  const skyNow = fs.readFileSync(sky, "utf8");
  check(
    'a neighbour folder: "C:\\P\\fam-port - Copy\\x" and "C:\\P\\fam-port (2)\\y" keep naming those real folders; "C:\\P\\fam-port and more" (no such neighbour) becomes the new place',
    skyNow.includes(`copy: ${copyFile}\n`) &&
      skyNow.includes(`second: ${secondFile}\n`) &&
      skyNow.includes(`own: ${renamed} and more\n`) &&
      fs.existsSync(copyFile) &&
      fs.existsSync(secondFile),
    skyNow,
  );
  check(
    "live text files under ~/.claude/rules and ~/.claude/workers name the new place",
    fs.readFileSync(rulesFile, "utf8").includes(renamed) &&
      fs
        .readFileSync(workersFile, "utf8")
        .includes(fwd(path.join(renamed, "scripts", "nightly.mjs"))),
    `${fs.readFileSync(rulesFile, "utf8")}${fs.readFileSync(workersFile, "utf8")}`,
  );
  const memoNow = path.join(projectsDir, slug(renamed), "memory", "notes.md");
  check(
    "a subfolder's history folder: it gets the new place's name, and a memory file naming it names the new one",
    fs.existsSync(path.join(projectsDir, `${slug(renamed)}-sub`, "q1.jsonl")) &&
      !fs.existsSync(path.join(projectsDir, subSlug)) &&
      fs.existsSync(memoNow) &&
      fs.readFileSync(memoNow, "utf8") ===
        `See ${slug(renamed)}-sub and ${slug(renamed)}.\n`,
    `${fs.readdirSync(projectsDir).join("\n")}\n${fs.existsSync(memoNow) ? fs.readFileSync(memoNow, "utf8") : "no memo"}`,
  );
  check(
    "a history folder that starts like the project's but no session places: --dry and the real move each print a line naming it, and it is left as it is",
    dryOut.includes(ghost) &&
      /by hand/.test(dryOut.split(ghost)[1] ?? "") &&
      r.out.includes(ghost) &&
      fs.existsSync(path.join(ghost, "memory", "MEMORY.md")),
    `${dryOut}\n---\n${r.out}`,
  );

  // 9. ~/.claude.json with two projects keys that differ only in case: both would get the same new key, so refused
  w = world("case-keys");
  writeJson(path.join(w.home, ".claude.json"), {
    numStartups: 3,
    projects: {
      [fwd(w.from)]: { lastSessionId: "s1" },
      [fwd(w.from).toLowerCase()]: { lastSessionId: "s0" },
      [fwd(w.portal)]: { lastSessionId: "p1" },
    },
  });
  before = w.hash();
  r = w.move();
  check(
    "~/.claude.json with two keys differing only in case: exit 1 before the move, names both keys, nothing changed",
    r.code === 1 &&
      r.out.includes(fwd(w.from)) &&
      r.out.includes(fwd(w.from).toLowerCase()) &&
      /case/.test(r.out) &&
      w.hash() === before &&
      w.created().length === 0,
    r.out,
  );

  // 10. the source typed in another case than the real folder (and the target's parent too)
  w = world("typed-case");
  const realTo = path.join(w.P, "renamed");
  r = w.run([
    w.from.toLowerCase(),
    path.join(w.P.toLowerCase(), "renamed"),
    "--home",
    w.home,
  ]);
  const histNames = fs.readdirSync(path.join(w.claude, "projects"));
  const cj = readJson(path.join(w.home, ".claude.json"));
  check(
    "a source typed in lower case: the history folder moves to the new place's slug in the disk's case, and ~/.claude.json is keyed by the new place in the disk's case",
    r.code === 0 &&
      histNames.includes(slug(realTo)) &&
      fs.existsSync(
        path.join(w.claude, "projects", slug(realTo), "s1.jsonl"),
      ) &&
      !histNames.some((n) => n.toLowerCase() === slug(w.from).toLowerCase()) &&
      fwd(realTo) in (cj?.projects ?? {}),
    `${r.out}\n${histNames.join("\n")}\n${JSON.stringify(cj)}`,
  );

  // 11. a cp1251 .cmd file (not UTF-8) naming the project: rewritten byte for byte, its other bytes kept
  const cp1251 = Buffer.from([0xcf, 0xf0, 0xee, 0xe5, 0xea, 0xf2]); // "Проект" in cp1251
  const cmdBytes = (p) =>
    Buffer.concat([
      Buffer.from("@echo off\r\nrem "),
      cp1251,
      Buffer.from(`\r\ncd /d "${p}"\r\n`),
    ]);
  w = world("code-page");
  const cmd = path.join(w.claude, "tools", "go.cmd");
  write(cmd, cmdBytes(w.from));
  r = w.move();
  check(
    "a cp1251 .cmd naming the project: the path is rewritten and its cp1251 bytes are kept (no U+FFFD)",
    r.code === 0 && fs.readFileSync(cmd).equals(cmdBytes(w.to)),
    `${r.out}\n${fs.readFileSync(cmd).toString("hex")}`,
  );
  w = world("code-page-wide");
  const cmd2 = path.join(w.claude, "tools", "go.cmd");
  write(cmd2, cmdBytes(w.from));
  const wideTo = path.join(w.P, "фам");
  r = w.run([w.from, wideTo, "--home", w.home]);
  check(
    "a cp1251 .cmd and a target that is not plain ASCII: the file is listed as not fixed, edit it by hand, and its bytes stay as they were",
    r.code === 0 &&
      new RegExp(`${cmd2.replace(/[\\.]/g, "\\$&")}.*by hand`).test(r.out) &&
      fs.readFileSync(cmd2).equals(cmdBytes(w.from)),
    `${r.out}\n${fs.readFileSync(cmd2).toString("hex")}`,
  );

  // 12. the log cannot be made (setup-logs is a file): refused before anything moves
  w = world("log-blocked");
  write(path.join(w.claude, "setup-logs"), "a file, not a folder\n");
  before = w.hash();
  r = w.move();
  check(
    "a log that cannot be created: exit 1 before anything moves, says the log cannot be written, nothing changed",
    r.code === 1 &&
      /log/.test(r.out) &&
      w.hash() === before &&
      fs.existsSync(w.from),
    r.out,
  );

  // 13. a move that cannot be undone: the project moves, its _worktrees folder is held open by a process (so it
  // will not move), and P denies "add a subfolder" to this user (so the project cannot go back): exit 2, saying where
  w = world("rollback");
  fs.mkdirSync(path.dirname(w.to), { recursive: true });
  const holder = spawn(
    process.execPath,
    ["-e", "setInterval(() => {}, 1000)"],
    {
      cwd: w.wt,
      stdio: "ignore",
    },
  );
  const user = process.env.USERNAME;
  const acl = (...a) => spawnSync("icacls", [w.P, ...a], { encoding: "utf8" });
  try {
    const denied = acl("/deny", `${user}:(AD)`);
    if (denied.status !== 0)
      throw new Error(`icacls: ${denied.stdout}${denied.stderr}`);
    // the case needs the deny to hold; on an administrator's machine (the CI runner) it may not, and the move
    // is then undone as it should be, so there is nothing to test there
    const probe = path.join(w.P, "deny-probe");
    try {
      fs.mkdirSync(probe);
      fs.rmdirSync(probe);
      r = null;
    } catch {
      r = w.move();
    }
  } finally {
    acl("/remove:d", user);
    holder.kill();
  }
  if (r === null)
    console.log(
      "skip a move that cannot be undone: this machine lets the user add a folder despite the deny",
    );
  else check(
    "a move that cannot be undone: exit 2, says the project is now at the new place and the log path, and the project is really there",
    r.code === 2 &&
      r.out.includes(`${w.from} is now at ${w.to}`) &&
      /by hand/.test(r.out) &&
      /\.log/.test(r.out) &&
      fs.existsSync(path.join(w.to, "README.md")),
    r.out,
  );

  // 14. scheduled tasks naming the project that schtasks /create /xml could not make again as they are: refused
  // before the move, naming the task and why. The task's other parts are as in taskXml.
  const whoGroups = spawnSync(
    path.join(process.env.SystemRoot, "System32", "whoami.exe"),
    ["/groups", "/fo", "csv", "/nh"],
    { encoding: "utf8" },
  ).stdout;
  const elevated = /"S-1-16-(12288|16384)"/.test(whoGroups);
  w = world("task-kinds");
  const tasksFile = path.join(w.tasks, "tasks.json");
  const withTask = (extra) => {
    const tasks = readJson(tasksFile);
    tasks["\\fam-port nightly"] = taskXml(
      "\\fam-port nightly",
      w.nightly,
      w.from,
    ).replace("<Actions", `${extra}\n  <Actions`);
    writeJson(tasksFile, tasks);
  };
  for (const [what, extra, why] of [
    [
      "a stored password (LogonType Password)",
      '<Principals><Principal id="Author"><LogonType>Password</LogonType></Principal></Principals>',
      /password/i,
    ],
    [
      "another account's UserId",
      '<Principals><Principal id="Author"><UserId>OTHERPC\\someone</UserId><LogonType>InteractiveToken</LogonType></Principal></Principals>',
      /another account.*OTHERPC\\someone/,
    ],
    [
      "a definition read with characters lost (U+FFFD)",
      "<RegistrationInfo><Description>Ночной ��</Description></RegistrationInfo>",
      /U\+FFFD/,
    ],
  ]) {
    withTask(extra);
    before = w.hash();
    r = w.move();
    check(
      `a scheduled task naming the project with ${what}: exit 1 before the move, names the task and why, nothing changed, no task created`,
      r.code === 1 &&
        /fam-port nightly/.test(r.out) &&
        why.test(r.out) &&
        w.hash() === before &&
        w.created().length === 0,
      r.out,
    );
  }
  withTask(
    '<Principals><Principal id="Author"><LogonType>InteractiveToken</LogonType><RunLevel>HighestAvailable</RunLevel></Principal></Principals>',
  );
  before = w.hash();
  r = w.move();
  check(
    elevated
      ? "a task with highest privileges, from an elevated terminal: the move goes ahead (exit 0)"
      : "a task with highest privileges, from a terminal that is not elevated: exit 1 before the move, names the task and says to run as administrator, nothing changed",
    elevated
      ? r.code === 0
      : r.code === 1 &&
          /fam-port nightly/.test(r.out) &&
          /administrator/.test(r.out) &&
          w.hash() === before &&
          w.created().length === 0,
    r.out,
  );
  // ---- cases from the S4b review ----
  // 13. a folder named in Cyrillic capitals: its database rows follow it, in any case (LIKE ignores case for ASCII only)
  w = world("cyrillic");
  {
    const cyrFrom = path.join(w.P, "Проект-Ж"),
      cyrTo = path.join(w.P, "fam", "Проект-Ж");
    write(path.join(cyrFrom, "README.md"), "# x\n");
    const db = new DatabaseSync(w.db);
    db.exec(
      "CREATE TABLE session_files (id TEXT PRIMARY KEY, workspace_id TEXT, file_path TEXT)",
    );
    db.prepare("INSERT INTO ai_sessions VALUES (?, ?, ?)").run(
      "c1",
      cyrFrom,
      "cyr",
    );
    db.prepare("INSERT INTO session_files VALUES (?, ?, ?)").run(
      "f1",
      cyrFrom,
      path.join(w.P, "ПРОЕКТ-Ж", "notes.md"),
    );
    db.close();
    r = w.run([cyrFrom, cyrTo, "--home", w.home], {
      MOVE_PROJECT_RUNNING: "0",
    });
    const check2 = new DatabaseSync(w.db, { readOnly: true });
    const ws = check2
        .prepare("SELECT workspace_id AS v FROM ai_sessions WHERE id = 'c1'")
        .get().v,
      file = check2
        .prepare("SELECT workspace_id AS w, file_path AS f FROM session_files")
        .get();
    check2.close();
    check(
      "a folder named in Cyrillic capitals: exit 0, the folder moved, its database rows (any case) name the new place",
      r.code === 0 &&
        fs.existsSync(path.join(cyrTo, "README.md")) &&
        ws === cyrTo &&
        file.w === cyrTo &&
        same(file.f, path.join(cyrTo, "notes.md")),
      `${r.out}\nai_sessions: ${ws}\nsession_files: ${JSON.stringify(file)}`,
    );
  }

  // 14. a unique key over two path columns that both change: --dry and --queue refuse it, as the real run would
  w = world("two-columns");
  {
    const db = new DatabaseSync(w.db);
    db.exec(
      "CREATE TABLE session_files (id INTEGER PRIMARY KEY, workspace_id TEXT NOT NULL, file_path TEXT NOT NULL, UNIQUE (workspace_id, file_path))",
    );
    db.prepare(
      "INSERT INTO session_files (workspace_id, file_path) VALUES (?, ?)",
    ).run(w.from, path.join(w.from, "a.md"));
    db.prepare(
      "INSERT INTO session_files (workspace_id, file_path) VALUES (?, ?)",
    ).run(w.to, path.join(w.to, "a.md"));
    db.close();
  }
  before = w.hash();
  const dryTwo = w.move(["--dry"], { MOVE_PROJECT_RUNNING: "1" }),
    queueTwo = w.move(["--queue"], { MOVE_PROJECT_RUNNING: "1" }),
    realTwo = w.move([], { MOVE_PROJECT_RUNNING: "0" });
  check(
    "a unique key over workspace_id and file_path that both change into a record already there: --dry, --queue and the real run all exit 1 naming session_files, nothing changed, nothing queued",
    [dryTwo, queueTwo, realTwo].every(
      (x) => x.code === 1 && /session_files/.test(x.out),
    ) &&
      w.hash() === before &&
      !(w.queue()?.moves?.length > 0),
    `--dry: ${dryTwo.out}\n--queue: ${queueTwo.out}\nreal: ${realTwo.out}`,
  );

  // 15. --run-queued and Nimbalyst opening: checked before each move; a move refused because it opened goes back
  const answers = (w, text) => {
    const f = path.join(w.root, "running-answers.txt");
    write(f, text);
    return `@${f}`;
  };
  const queueBoth = (w) =>
    writeJson(path.join(w.deliver, "moves.json"), {
      moves: [
        { from: w.from, to: w.to, at: "2026-11-20T10:00:00.000Z" },
        {
          from: w.portal,
          to: path.join(w.P, "fam", "portal"),
          at: "2026-11-20T10:01:00.000Z",
        },
      ],
    });
  w = world("reopen-before-child");
  queueBoth(w);
  before = w.hash();
  // the run's check: closed; the move's own check: open
  r = w.run(["--run-queued"], { MOVE_PROJECT_RUNNING: answers(w, "0 1") });
  check(
    "--run-queued, Nimbalyst opens before the first move starts: exit 1, that move is back at the head of the queue with the one after it, nothing moved, nothing refused",
    r.code === 1 &&
      w.queue()?.moves?.length === 2 &&
      same(w.queue().moves[0].from, w.from) &&
      same(w.queue().moves[1].from, w.portal) &&
      !w.queue().refused &&
      w.hash() === before,
    `${r.out}\n${JSON.stringify(w.queue())}`,
  );
  w = world("reopen-between");
  queueBoth(w);
  // the run's check and the first move's: closed; the run's check before the second move: open
  r = w.run(["--run-queued"], { MOVE_PROJECT_RUNNING: answers(w, "0 0 1") });
  check(
    "--run-queued, Nimbalyst opens after the first move: exit 1, the first project moved, the second still queued, not started",
    r.code === 1 &&
      fs.existsSync(path.join(w.to, "README.md")) &&
      fs.existsSync(w.portal) &&
      w.queue()?.moves?.length === 1 &&
      same(w.queue().moves[0].from, w.portal),
    `${r.out}\n${JSON.stringify(w.queue())}`,
  );

  // 16. a queued move refused for another reason (its target exists): kept under "refused", said by deliver --status,
  // gone once the project is moved
  w = world("queued-refused");
  write(path.join(w.to, "keep.txt"), "already here\n");
  writeJson(path.join(w.deliver, "moves.json"), {
    moves: [{ from: w.from, to: w.to, at: "2026-11-20T10:00:00.000Z" }],
  });
  r = w.run(["--run-queued"], { MOVE_PROJECT_RUNNING: "0" });
  const kept = w.queue();
  const statusLine = spawnSync(
    process.execPath,
    [
      path.join(
        path.dirname(MOVE),
        "..",
        "..",
        "tools",
        "nimbalyst-patch",
        "deliver.mjs",
      ),
      "--status",
    ],
    { encoding: "utf8", env: w.env() },
  ).stdout.trim();
  check(
    "a queued move whose target exists: --run-queued exits 1, the move leaves the queue and is kept under refused with the reason; deliver --status names it",
    r.code === 1 &&
      kept?.moves?.length === 0 &&
      kept?.refused?.length === 1 &&
      same(kept.refused[0].from, w.from) &&
      /exists/.test(kept.refused[0].why) &&
      statusLine.includes("was refused") &&
      statusLine.includes(path.basename(w.from)),
    `${r.out}\n${JSON.stringify(kept)}\n${statusLine}`,
  );
  fs.rmSync(w.to, { recursive: true, force: true });
  r = w.move([], { MOVE_PROJECT_RUNNING: "0" });
  check(
    "once the project is moved, its refused record goes (moves.json gone)",
    r.code === 0 && !w.queue(),
    `${r.out}\n${JSON.stringify(w.queue())}`,
  );

  // 17. moves.json is changed only under its lock: a run that finds the lock held waits for it and then sees what
  // the holder wrote (no move lost, none run twice); a lock of a process that is gone is taken over
  w = world("queue-lock");
  writeJson(path.join(w.deliver, "moves.json"), {
    moves: [{ from: w.from, to: w.to, at: "2026-11-20T10:00:00.000Z" }],
  });
  {
    const movesF = path.join(w.deliver, "moves.json"),
      lockF = `${movesF}.lock`;
    // the holder takes the lock, adds the second move after 1.5 s, then lets go
    const holder = spawn(
      process.execPath,
      [
        "-e",
        `const fs = require("fs");
fs.writeFileSync(${JSON.stringify(lockF)}, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }), { flag: "wx" });
setTimeout(() => {
  const q = JSON.parse(fs.readFileSync(${JSON.stringify(movesF)}, "utf8"));
  q.moves.push({ from: ${JSON.stringify(w.portal)}, to: ${JSON.stringify(path.join(w.P, "fam", "portal"))}, at: "2026-11-20T10:01:00.000Z" });
  fs.writeFileSync(${JSON.stringify(movesF)}, JSON.stringify(q));
  fs.rmSync(${JSON.stringify(lockF)});
}, 1500);`,
      ],
      { stdio: "ignore" },
    );
    for (let i = 0; i < 100 && !fs.existsSync(lockF); i++)
      await new Promise((res) => setTimeout(res, 20));
    const run = await new Promise((res) => {
      const c = spawn(process.execPath, [MOVE, "--run-queued"], {
        env: w.env(),
      });
      let out = "";
      c.stdout.on("data", (b) => (out += b));
      c.stderr.on("data", (b) => (out += b));
      c.on("close", (code) => res({ code, out }));
    });
    await new Promise((res) =>
      holder.exitCode !== null ? res() : holder.on("exit", res),
    );
    check(
      "--run-queued while another process holds moves.json.lock: it waits, then carries out both moves once each (exit 0, both projects moved, queue empty, nothing refused)",
      run.code === 0 &&
        fs.existsSync(path.join(w.to, "README.md")) &&
        fs.existsSync(path.join(w.P, "fam", "portal", "run.mjs")) &&
        !w.queue(),
      `${run.out}\n${JSON.stringify(w.queue())}`,
    );
  }
  w = world("queue-stale-lock");
  writeJson(path.join(w.deliver, "moves.json"), {
    moves: [{ from: w.from, to: w.to, at: "2026-11-20T10:00:00.000Z" }],
  });
  {
    // the lock of a process that has ended
    const gone = spawnSync(
      process.execPath,
      ["-e", "process.stdout.write(String(process.pid))"],
      {
        encoding: "utf8",
      },
    ).stdout;
    writeJson(path.join(w.deliver, "moves.json.lock"), {
      pid: Number(gone),
      at: new Date().toISOString(),
    });
  }
  r = w.run(["--run-queued"], { MOVE_PROJECT_RUNNING: "0" });
  check(
    "a moves.json.lock left by a process that has ended is taken over: --run-queued carries the move out (exit 0), no lock left",
    r.code === 0 &&
      fs.existsSync(path.join(w.to, "README.md")) &&
      !fs.existsSync(path.join(w.deliver, "moves.json.lock")),
    r.out,
  );

  // 18. Nimbalyst's JSON keys named like an object's own properties ("constructor", "__proto__") are entries like
  // any other: no false clash, none lost
  w = world("proto-keys");
  {
    const f = path.join(w.nim, "app-settings.json"),
      j = readJson(f);
    j.constructor = { path: w.from, name: "fam-port" };
    Object.defineProperty(j, "__proto__", {
      value: { dir: w.from },
      enumerable: true,
      writable: true,
      configurable: true,
    });
    writeJson(f, j);
  }
  r = w.move([], { MOVE_PROJECT_RUNNING: "0" });
  {
    const j = JSON.parse(
      fs.readFileSync(path.join(w.nim, "app-settings.json"), "utf8"),
    );
    check(
      'app-settings.json with the keys "constructor" and "__proto__": the move goes ahead (exit 0) and both keys stay, naming the new place',
      r.code === 0 &&
        Object.hasOwn(j, "constructor") &&
        same(j.constructor.path, w.to) &&
        Object.hasOwn(j, "__proto__") &&
        same(j["__proto__"].dir, w.to),
      `${r.out}\n${fs.readFileSync(path.join(w.nim, "app-settings.json"), "utf8")}`,
    );
  }

  // 19. ~/.claude/hooks/state/<hook>/: the folder of a hook that is gone (no ~/.claude/hooks/<hook>.mjs: the
  // retired code-review-gate and context-guard) is its leftovers and stays as it was, even when it names the old
  // place; the state of a live hook keyed by the project's path (map-nudge/projects.json, map-drift/said.json,
  // with hooks/map-nudge.mjs and hooks/map-drift.mjs there) follows it, so the moved project does not look new to
  // them. The files are at the paths and in the shape those hooks write (hooks/lib/state.mjs stateFile).
  w = world("hooks-state");
  {
    const state = path.join(w.claude, "hooks", "state"),
      sid = "010cc326-0a5f-45c4-8dd3-97962f24d2f0",
      nudgeF = path.join(state, "map-nudge", "projects.json"),
      driftF = path.join(state, "map-drift", "said.json");
    for (const h of ["map-nudge", "map-drift"])
      write(path.join(w.claude, "hooks", `${h}.mjs`), `// ${h}: a live hook\n`);
    write(
      nudgeF,
      JSON.stringify({
        [fwd(w.from)]: { checkedAt: 1793678783829 },
        [fwd(w.portal)]: { checkedAt: 1793595401021 },
      }),
    );
    write(
      driftF,
      JSON.stringify({
        [`${fwd(w.from)}|src/main.mjs|quality -> finds`]: 1793950293686,
        [`${fwd(w.portal)}|run.mjs|ladder -> reforge`]: 1793951447289,
      }),
    );
    const retired = {
      [path.join(state, "context-guard", `${sid}.json`)]: JSON.stringify({
        handedAt: 190,
        cwd: w.from,
      }),
      [path.join(state, "code-review-gate", `${sid}.json`)]: JSON.stringify({
        turn: "85ea1486-357f-484a-9fe8-5b3bd5d6088b",
      }),
      [path.join(state, "code-review-gate", `${sid}.base.json`)]:
        JSON.stringify({
          top: fwd(w.from),
          head: "83be69deaa8bcb40eb683ed7a815efef405f5a04",
          dirty: { "docs/plan.md": "1794585195803.5977:932" },
        }),
      [path.join(state, "code-review-gate", `${sid}.others.json`)]:
        JSON.stringify({
          since: 1794961402289,
          offsets: { [path.join(w.from, "notes", "s1.jsonl")]: 483964 },
        }),
    };
    for (const [f, text] of Object.entries(retired)) write(f, text);
    r = w.move([], { MOVE_PROJECT_RUNNING: "0" });
    const changed = Object.entries(retired)
      .filter(
        ([f, text]) => !fs.existsSync(f) || fs.readFileSync(f, "utf8") !== text,
      )
      .map(([f]) => path.relative(state, f));
    check(
      "state folders of hooks that are gone (code-review-gate's <session>.json, .base.json, .others.json; context-guard's <session>.json), naming the old place, stay byte for byte after a move (exit 0)",
      r.code === 0 &&
        fs.existsSync(path.join(w.to, "README.md")) &&
        !changed.length,
      `changed: ${changed.join(", ")}\n${r.out}`,
    );
    let nudge = null,
      drift = null,
      bad = "";
    try {
      nudge = JSON.parse(fs.readFileSync(nudgeF, "utf8"));
      drift = JSON.parse(fs.readFileSync(driftF, "utf8"));
    } catch (e) {
      bad = e.message;
    }
    check(
      "the live hooks' map-nudge/projects.json and map-drift/said.json follow the move: still valid JSON, the project's keys name the new place (none the old), the sister project's keys stay",
      !bad &&
        nudge?.[fwd(w.to)]?.checkedAt === 1793678783829 &&
        !(fwd(w.from) in nudge) &&
        nudge?.[fwd(w.portal)]?.checkedAt === 1793595401021 &&
        drift?.[`${fwd(w.to)}|src/main.mjs|quality -> finds`] ===
          1793950293686 &&
        !(`${fwd(w.from)}|src/main.mjs|quality -> finds` in drift) &&
        drift?.[`${fwd(w.portal)}|run.mjs|ladder -> reforge`] === 1793951447289,
      `${bad}\n${fs.readFileSync(nudgeF, "utf8")}\n${fs.readFileSync(driftF, "utf8")}`,
    );
  }

  // 20. the lock's two other rules: a lock older than a minute is stale even when its process still runs (taken over
  // at once), and a fresh lock of a running process refuses once the wait (10 s) is over. The wait is faked: a
  // preload makes each pause return at once and moves Date.now on by its length.
  w = world("queue-old-lock");
  writeJson(path.join(w.deliver, "moves.json"), {
    moves: [{ from: w.from, to: w.to, at: "2026-11-20T10:00:00.000Z" }],
  });
  {
    const lockF = path.join(w.deliver, "moves.json.lock"),
      old = new Date(Date.now() - 120000);
    // held by this test's process, which runs; written two minutes ago
    writeJson(lockF, { pid: process.pid, at: old.toISOString() });
    fs.utimesSync(lockF, old, old);
    r = w.run(["--run-queued"], { MOVE_PROJECT_RUNNING: "0" });
    check(
      "a moves.json.lock older than a minute, its process still running, is taken over: --run-queued carries the move out (exit 0), no lock left",
      r.code === 0 &&
        fs.existsSync(path.join(w.to, "README.md")) &&
        !fs.existsSync(lockF),
      r.out,
    );
  }
  w = world("queue-held-lock");
  {
    const movesF = path.join(w.deliver, "moves.json"),
      lockF = `${movesF}.lock`;
    writeJson(movesF, {
      moves: [{ from: w.from, to: w.to, at: "2026-11-20T10:00:00.000Z" }],
    });
    const lockText = JSON.stringify({
      pid: process.pid,
      at: new Date().toISOString(),
    });
    write(lockF, lockText);
    const before = fs.readFileSync(movesF, "utf8");
    const clock = path.join(w.root, "fast-clock.mjs");
    write(
      clock,
      `const now = Date.now.bind(Date);
let ahead = 0;
Date.now = () => now() + ahead;
Atomics.wait = (a, i, v, ms) => ((ahead += ms), "timed-out");
`,
    );
    const t0 = Date.now();
    r = w.run(["--run-queued"], {
      MOVE_PROJECT_RUNNING: "0",
      NODE_OPTIONS: `--import=${pathToFileURL(clock).href}`,
    });
    const took = Date.now() - t0;
    check(
      "a fresh moves.json.lock of a running process: --run-queued waits its 10 s (faked), then refuses (exit 1, names the holder's pid); the queue, the lock and the project stay as they were",
      r.code === 1 &&
        r.out.includes(`is held by process ${process.pid}`) &&
        took < 8000 &&
        fs.readFileSync(movesF, "utf8") === before &&
        fs.readFileSync(lockF, "utf8") === lockText &&
        fs.existsSync(path.join(w.from, "README.md")) &&
        !fs.existsSync(w.to),
      `took ${took} ms\n${r.out}`,
    );
  }
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
