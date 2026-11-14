// Tests for skills/update-setup/update.mjs: a real update from this version to a made-up newer one,
// served by a small local server that stands in for GitHub. Everything happens in a temporary home
// folder. Run: node tests/test-update.mjs
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { lead, splitBlocks } from "../scripts/blocks.mjs";

// No network and no real Claude Code update from any installer this test starts (scripts/claude-code-version.mjs)
process.env.SETUP_CC_CHECK = "off";
// the backup's folder is the test home's unless a test names one (skills/update-setup/update.mjs: the Backup: line)
delete process.env.CLAUDE_BACKUP_HOME;
const REPO = fileURLToPath(new URL("..", import.meta.url));
const UPDATE = path.join(REPO, "skills", "update-setup", "update.mjs");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "update-test-"));
let pass = 0,
  fail = 0;
const check = (name, ok) => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}`);
};
const json = (file) => JSON.parse(fs.readFileSync(file, "utf8"));
const fwd = (p) => p.replace(/\\/g, "/");
// A replaced file's copy: setup-logs/<day>-install-backup/<its path from the home folder>
const now = new Date();
const DAY = new Date(now.getTime() - now.getTimezoneOffset() * 6e4)
  .toISOString()
  .slice(0, 10); // the local day, as the installer names its folders
const backupOf = (h, file, day = DAY) =>
  path.join(
    h,
    ".claude",
    "setup-logs",
    `${day}-install-backup`,
    path.relative(h, file),
  );
const besideFiles = (dir) =>
  fs
    .readdirSync(dir, { recursive: true })
    .filter((n) => /\.before-install-/.test(n));

// ---- the newer version: this repository with a higher number, one new rule, one changed extension
const NEW = "99.9.9";
const pack = path.join(tmp, "pack", `ai-coding-setup-${NEW}`);
const SKIP = [".git", "node_modules", "promo", "dist", "img"];
fs.cpSync(REPO, pack, {
  recursive: true,
  filter: (src) => !SKIP.includes(path.basename(src)),
});
// one project pass level up, so the update names the project folders behind it
const PASS_NEW = json(path.join(REPO, "version.json")).projectPass + 1;
fs.writeFileSync(
  path.join(pack, "version.json"),
  JSON.stringify({
    version: NEW,
    projectPass: PASS_NEW,
    summary: "A made-up release.",
  }),
);
fs.appendFileSync(
  path.join(pack, "rules", "CLAUDE.md"),
  "\n- A rule from the newer version.\n",
);
fs.appendFileSync(path.join(pack, "hooks", "sql-guard.mjs"), "\n// newer\n");
fs.appendFileSync(
  path.join(pack, "extensions", "commands", "README.md"),
  "\nChanged in the newer version.\n",
);
// A stand-in for tools/nimbalyst-patch/deliver.mjs, in every pack and in a home before each run, so no test starts the
// real one: it adds its flags to calls.log beside it, and --status prints STUB_NIMBALYST as the `nimbalyst:` line
const DELIVER_REL = path.join("tools", "nimbalyst-patch", "deliver.mjs");
const DELIVER_STUB = `import fs from "node:fs";
fs.appendFileSync(new URL("./calls.log", import.meta.url), process.argv.slice(2).join(" ") + "\\n");
if (process.argv.includes("--status")) console.log("nimbalyst: " + (process.env.STUB_NIMBALYST || "on, 0.83.0, 3 fixes applied"));
`;
const putStub = (root) => {
  fs.mkdirSync(path.dirname(path.join(root, DELIVER_REL)), { recursive: true });
  fs.writeFileSync(path.join(root, DELIVER_REL), DELIVER_STUB);
};
const callsOf = (h) => {
  const f = path.join(h, ".claude", path.dirname(DELIVER_REL), "calls.log");
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n") : [];
};
const waitCalls = async (h, call, ms = 5000) => {
  for (
    const end = Date.now() + ms;
    Date.now() < end;
    await new Promise((r) => setTimeout(r, 100))
  )
    if (callsOf(h).includes(call)) return true;
  return false;
};
putStub(pack);
const served = path.join(tmp, "served");
fs.mkdirSync(served);
const winTar = path.join(
  process.env.SystemRoot || "C:\\Windows",
  "System32",
  "tar.exe",
);
const tar =
  process.platform === "win32" && fs.existsSync(winTar) ? winTar : "tar";
const packed = spawnSync(
  tar,
  [
    "-czf",
    path.join("..", "served", `v${NEW}.tar.gz`),
    `ai-coding-setup-${NEW}`,
  ],
  { cwd: path.join(tmp, "pack"), encoding: "utf8" },
);
check(
  "the test archive was made",
  packed.status === 0 && fs.existsSync(path.join(served, `v${NEW}.tar.gz`)),
);

let released = { version: NEW, summary: "A made-up release." };
const server = http.createServer((req, res) => {
  if (req.url === "/version.json") return res.end(JSON.stringify(released));
  const file = path.join(served, path.basename(req.url));
  if (!fs.existsSync(file)) {
    res.statusCode = 404;
    return res.end();
  }
  res.end(fs.readFileSync(file));
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const BASE = `http://127.0.0.1:${server.address().port}`;
// The server runs in this process, so the updater is started without blocking it
const update = (home, ...flags) =>
  new Promise((resolve) => {
    if (fs.existsSync(path.join(home, ".claude")))
      putStub(path.join(home, ".claude"));
    const p = spawn(process.execPath, [UPDATE, "--home", home, ...flags], {
      env: {
        ...process.env,
        SETUP_UPDATE_BASE: BASE,
        NIMBALYST_DELIVER_DATA: path.join(home, "nimbalyst-data"),
      },
    });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ code, out }));
  });

// ---- this version installed, with no workers, plus things of the user's own
const home = path.join(tmp, "home");
const claude = path.join(home, ".claude");
const first = spawnSync(
  process.execPath,
  [path.join(REPO, "install.mjs"), "--home", home, "--codex", "no"],
  { encoding: "utf8" },
);
check(
  "this version installs",
  first.status === 0 &&
    json(path.join(claude, "setup-state.json")).version ===
      json(path.join(REPO, "version.json")).version,
);
check(
  "a first install starts the project pass stamp at this version's level, mode on-open, no folders",
  JSON.stringify(json(path.join(claude, "project-pass.json"))) ===
    JSON.stringify({
      folders: {},
      declined: {},
      declinedAll: null,
      mode: "on-open",
      level: PASS_NEW - 1,
    }),
);
const ownSkill = path.join(claude, "skills", "build-table", "SKILL.md");
fs.mkdirSync(path.dirname(ownSkill), { recursive: true });
fs.writeFileSync(ownSkill, "# My own skill\n");
const settingsFile = path.join(claude, "settings.json");
const settings = json(settingsFile);
settings.model = "opus";
settings.hooks.Stop.push({
  hooks: [{ type: "command", command: "node my-own-hook.mjs" }],
});
// as an older version wired it: question-other on PromptForUserInput only, no code-review or file-link gate
for (const g of settings.hooks.PreToolUse)
  if (JSON.stringify(g).includes("question-other.mjs"))
    g.matcher = "mcp__nimbalyst__PromptForUserInput";
for (const g of settings.hooks.Stop)
  g.hooks = g.hooks.filter(
    (h) => !/code-review-gate|file-link-gate/.test(h.command),
  );
settings.hooks.Stop = settings.hooks.Stop.filter((g) => g.hooks.length);
fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2));
const profile = path.join(home, "Projects", "quick-tasks", "profile.md");
fs.writeFileSync(profile, "# My profile\n");
// as an older version that used Antigravity left it: its hook in Antigravity's hooks file and its allow rule
// on record, each beside one of the user's own
const agyHooks = path.join(home, ".gemini", "config", "hooks.json");
const agySettings = path.join(
  home,
  ".gemini",
  "antigravity-cli",
  "settings.json",
);
const setupRule = `read_file(${fwd(path.join(home, "Projects"))})`;
fs.mkdirSync(path.dirname(agyHooks), { recursive: true });
fs.mkdirSync(path.dirname(agySettings), { recursive: true });
fs.writeFileSync(
  agyHooks,
  JSON.stringify({
    "ask-worker-gate": {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [
            {
              type: "command",
              command: `node ${fwd(claude)}/workers/agy-gate.mjs`,
              timeout: 10,
            },
          ],
        },
      ],
    },
    "my-own-gate": {
      PreToolUse: [
        {
          matcher: "*",
          hooks: [{ type: "command", command: "node my-gate.mjs" }],
        },
      ],
    },
  }),
);
fs.writeFileSync(
  agySettings,
  JSON.stringify({
    theme: "dark",
    permissions: { allow: [setupRule, "read_file(C:/mine)"] },
  }),
);
const stateAt = path.join(claude, "setup-state.json");
fs.writeFileSync(
  stateAt,
  JSON.stringify({ ...json(stateAt), agy: false, agyAdded: [setupRule] }),
);
// as an older version left it: dated copies next to the files it replaced (one on record as the user's, one
// named by the carve's undo record), and the how-to under its old upper-case name
const oldHookCopy = path.join(
  claude,
  "hooks",
  "sql-guard.mjs.before-install-20261001",
);
const oldNotes = path.join(home, "Projects", "claude-settings", "CLAUDE.md");
const oldNotesCopy = oldNotes + ".before-install-20261001";
fs.writeFileSync(oldHookCopy, "// my hook from before the install\n");
fs.writeFileSync(oldNotesCopy, "# my notes from before\n");
const settingsDir = path.join(home, "Projects", "claude-settings");
fs.renameSync(
  path.join(settingsDir, "how-to.md"),
  path.join(settingsDir, "x.part"),
);
fs.renameSync(
  path.join(settingsDir, "x.part"),
  path.join(settingsDir, "HOW-TO.md"),
);
{
  const st = json(stateAt);
  st.written[fwd(path.join(settingsDir, "HOW-TO.md"))] =
    st.written[fwd(path.join(settingsDir, "how-to.md"))];
  delete st.written[fwd(path.join(settingsDir, "how-to.md"))];
  delete st.oldCopiesMoved; // an older version's record has no such mark, so the next run searches for the copies
  st.userCopies = [fwd(oldHookCopy)];
  st.rulesUndo = {
    at: "2026-10-01T00:00:00.000Z",
    by: "carve",
    files: [{ file: fwd(oldNotes), copy: fwd(oldNotesCopy) }],
  };
  fs.writeFileSync(stateAt, JSON.stringify(st));
}

// ---- only looking
const looked = await update(home, "--check");
check(
  "--check names the newer version and what is new",
  looked.code === 0 &&
    looked.out.includes(`Newer version: ${NEW}`) &&
    looked.out.includes("What is new: A made-up release."),
);
check(
  "--check downloads nothing",
  !fs.existsSync(path.join(claude, "setup-source")),
);

// ---- the update
const done = await update(home);
const state = json(path.join(claude, "setup-state.json"));
const source = path.join(claude, "setup-source", `v${NEW}`);
check(
  "the update exits cleanly",
  done.code === 0 && done.out.includes(`Updated to version ${NEW}`),
);
check(
  "the install wrote the new project pass level into the stamp, mode on-open",
  json(path.join(claude, "project-pass.json")).level === PASS_NEW &&
    json(path.join(claude, "project-pass.json")).mode === "on-open",
);
check(
  "the raised level is named with the project folders behind it",
  new RegExp(
    `^project-pass: level ${PASS_NEW - 1} → ${PASS_NEW}, \\d+ folders behind$`,
    "m",
  ).test(done.out),
  done.out
    .split("\n")
    .filter((l) => l.startsWith("project-pass"))
    .join("\n"),
);
check("the version on record is the new one", state.version === NEW);
// on a Mac the temporary folder is a link, and Node names a script by its real path
check(
  "the setup's folder is now the downloaded one",
  fs.existsSync(path.join(source, "install.mjs")) &&
    fs.realpathSync(state.repo) === fs.realpathSync(source),
);
check(
  "a changed hook is replaced and the old one kept as a dated copy",
  fs
    .readFileSync(path.join(claude, "hooks", "sql-guard.mjs"), "utf8")
    .endsWith("// newer\n") &&
    fs.existsSync(backupOf(home, path.join(claude, "hooks", "sql-guard.mjs"))),
);
check(
  "the copies an older version left next to files move into setup-logs under their date, none stay beside a file",
  fs.readFileSync(
    backupOf(home, path.join(claude, "hooks", "sql-guard.mjs"), "2026-10-01"),
    "utf8",
  ) === "// my hook from before the install\n" &&
    fs.readFileSync(backupOf(home, oldNotes, "2026-10-01"), "utf8") ===
      "# my notes from before\n" &&
    besideFiles(claude).length === 0 &&
    besideFiles(path.join(home, "Projects")).length === 0,
);
check(
  "the records naming a moved copy follow it (userCopies, the undo record)",
  state.userCopies.includes(
    fwd(
      backupOf(home, path.join(claude, "hooks", "sql-guard.mjs"), "2026-10-01"),
    ),
  ) &&
    state.rulesUndo.files[0].copy ===
      fwd(backupOf(home, oldNotes, "2026-10-01")),
);
check(
  "the how-to of an older version is renamed to how-to.md and kept on record",
  fs.readdirSync(settingsDir).includes("how-to.md") &&
    !fs.readdirSync(settingsDir).includes("HOW-TO.md") &&
    fwd(path.join(settingsDir, "how-to.md")) in state.written &&
    !(fwd(path.join(settingsDir, "HOW-TO.md")) in state.written),
);
check(
  "rules the user never changed are brought up to date",
  fs
    .readFileSync(path.join(claude, "CLAUDE.md"), "utf8")
    .includes("A rule from the newer version."),
);
check(
  "the user's own skill is untouched",
  fs.readFileSync(ownSkill, "utf8") === "# My own skill\n",
);
const after = json(settingsFile);
check(
  "the user's own model and hook stay",
  after.model === "opus" &&
    JSON.stringify(after.hooks.Stop).includes("my-own-hook.mjs"),
);
check(
  "an older install gets the new Stop gates and question-other's wider matcher",
  ["code-review-gate.mjs", "file-link-gate.mjs"].every((h) =>
    JSON.stringify(after.hooks.Stop).includes(h),
  ) &&
    after.hooks.PreToolUse.some(
      (g) =>
        g.matcher ===
          "mcp__nimbalyst__PromptForUserInput|mcp__nimbalyst__AskUserQuestion|AskUserQuestion" &&
        JSON.stringify(g).includes("question-other.mjs"),
    ),
);
check(
  "the user's notes stay",
  fs.readFileSync(profile, "utf8") === "# My profile\n",
);
check(
  "the answer about Codex is remembered",
  /Codex CLI \(GPT\): not used, optional \(as answered before\)/.test(done.out),
);
check(
  "what an older version set up in Antigravity goes, the user's own hook and rule stay",
  JSON.stringify(Object.keys(json(agyHooks))) ===
    JSON.stringify(["my-own-gate"]) &&
    JSON.stringify(json(agySettings)) ===
      JSON.stringify({
        theme: "dark",
        permissions: { allow: ["read_file(C:/mine)"] },
      }) &&
    !("agyAdded" in state) &&
    !("agy" in state),
);
check(
  "the changed extension is named, the others are not",
  done.out.includes("extension changed: commands") &&
    !done.out.includes("extension changed: usage-plan"),
);
check(
  "the download leaves no archive and no half-made folder",
  fs.readdirSync(path.join(claude, "setup-source")).join() === `v${NEW}`,
);
check(
  "NB4. an update passes on deliver.mjs's nimbalyst: line",
  (done.out.match(/^nimbalyst: .*$/gm) || []).join() ===
    "nimbalyst: on, 0.83.0, 3 fixes applied",
  done.out,
);
check(
  "NB4. and starts deliver.mjs --stage after the install",
  (await waitCalls(home, "--stage")) && callsOf(home).includes("--status"),
);

// ---- an update is quiet: what a chat does at the first install (open the folders in Nimbalyst, ask
// about a theme and voice typing) is named by the first install only, and the skill has no such step
check(
  "the first install names the steps left for a chat",
  /Left for a chat, once.*steps 8 and 9/.test(first.stdout),
);
check(
  "an update names nothing for a chat: no folders to open, no theme or voice typing question",
  !/Left for a chat|voice typing|Handy|a theme/i.test(done.out),
);
check(
  "the update skill has no step that opens folders or asks about a theme or voice typing",
  !/Left for a chat|workspace_open|folders opened|the theme|voice typing|Handy|full-install/i.test(
    fs.readFileSync(
      path.join(REPO, "skills", "update-setup", "SKILL.md"),
      "utf8",
    ),
  ),
);
check(
  "OPT1. an install with no backup answer: the update says Backup: not asked, once, and puts no Handy answer on record",
  (done.out.match(/^Backup: .*$/gm) || []).join() === "Backup: not asked" &&
    !("handy" in state) &&
    !("backup" in state),
  done.out,
);

fs.rmSync(path.join(claude, path.dirname(DELIVER_REL), "calls.log"));
process.env.STUB_NIMBALYST = "restart to finish: 0.83.0 -> 0.84.0, 3 fixes";
const again = await update(home);
delete process.env.STUB_NIMBALYST;
check(
  "a second run says it is on the newest version and changes nothing",
  again.code === 0 &&
    again.out.trim().split("\n")[0] ===
      `Already on the newest version (${NEW}).` &&
    again.out.includes("version check skipped"),
);
await new Promise((r) => setTimeout(r, 700));
check(
  "NB4. on the newest version the nimbalyst: line is passed on too, and no stage starts",
  /^nimbalyst: restart to finish: 0\.83\.0 -> 0\.84\.0, 3 fixes$/m.test(
    again.out,
  ) && callsOf(home).join() === "--status",
);
// the retry: on the newest version a failed or missing delivery is staged again, before the line is read again
for (const [what, line] of [
  [
    "a failed delivery",
    "failed: the installer of 0.84.0 exited with code 3; run /update-setup to retry",
  ],
  [
    "nothing staged",
    "not staged: 0.83.0 -> 0.84.0; run /update-setup to get it",
  ],
]) {
  const calls = path.join(claude, path.dirname(DELIVER_REL), "calls.log");
  fs.rmSync(calls, { force: true });
  process.env.STUB_NIMBALYST = line;
  const retry = await update(home);
  const retryCalls = callsOf(home).join();
  fs.rmSync(calls, { force: true });
  process.env.NIMBALYST_FOLLOW = "OFF";
  const off = await update(home);
  delete process.env.NIMBALYST_FOLLOW;
  check(
    `RV2B. newest version, ${what}: --stage runs again (and returns) before the status is read again`,
    retry.code === 0 &&
      retry.out.includes(`nimbalyst: ${line}`) &&
      retryCalls === "--status,--stage,--status",
    `${retryCalls}\n${retry.out}`,
  );
  check(
    `RV2B. newest version, ${what}, NIMBALYST_FOLLOW=OFF: no stage`,
    off.code === 0 && callsOf(home).join() === "--status",
    callsOf(home).join(),
  );
}
delete process.env.STUB_NIMBALYST;

// ---- an Ink theme left pending (Nimbalyst was open) is named again, unless a theme was picked since
const appSet = path.join(tmp, "app-settings.json");
const pendState = (extra) =>
  fs.writeFileSync(
    stateAt,
    JSON.stringify({
      ...json(stateAt),
      themePending: true,
      themePendingFrom: "dark",
      ...extra,
    }),
  );
fs.writeFileSync(appSet, JSON.stringify({ theme: "dark" }));
pendState();
const pend1 = await update(home, "--app-settings", appSet);
check(
  "a pending Ink theme is named again, still pending",
  /^theme: set now: com\.local\.inktheme:ink-cobalt \(/m.test(pend1.out) &&
    json(stateAt).themePending === true,
);
fs.writeFileSync(appSet, JSON.stringify({ theme: "light" }));
const pend2 = await update(home, "--app-settings", appSet);
check(
  "after another theme was picked: no line, pending cleared, switch recorded",
  !pend2.out.includes("theme: set now:") &&
    !("themePending" in json(stateAt)) &&
    !("themePendingFrom" in json(stateAt)) &&
    json(stateAt).inkSwitched === true,
);

// ---- the opt-ins on an update: Handy is never asked (one found goes on record unasked), the backup gets one line
// from the answer on record and the backup's folder (CLAUDE_BACKUP_HOME, here inside the test folder)
{
  const stateBefore = fs.readFileSync(stateAt, "utf8");
  const backupHome = path.join(tmp, "backup-home");
  const lastRun = path.join(backupHome, "last-run.json");
  process.env.CLAUDE_BACKUP_HOME = backupHome;
  const setState = (changes) => {
    const s = json(stateAt);
    for (const [k, v] of Object.entries(changes))
      if (v === undefined) delete s[k];
      else s[k] = v;
    fs.writeFileSync(stateAt, JSON.stringify(s));
  };
  const backupLines = async () => {
    const r = await update(home);
    return [r.code, (r.out.match(/^Backup: .*$/gm) || []).join(" | ")];
  };
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const daysAgo = (n) =>
    new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();
  setState({ backup: undefined });
  check(
    "OPT1. no backup answer on record: Backup: not asked",
    same(await backupLines(), [0, "Backup: not asked"]),
  );
  setState({ backup: true });
  check(
    "OPT1. a yes with no config.json yet: setup not finished",
    same(await backupLines(), [
      0,
      "Backup: setup not finished, /backup finishes it",
    ]),
  );
  setState({ backup: false });
  check(
    "OPT1. a no with no config.json: no Backup line",
    same(await backupLines(), [0, ""]),
  );
  setState({ backup: true });
  fs.mkdirSync(backupHome, { recursive: true });
  fs.writeFileSync(
    path.join(backupHome, "config.json"),
    JSON.stringify({ target: "b2" }),
  );
  check(
    "OPT1. set up and never run yet: no Backup line",
    same(await backupLines(), [0, ""]),
  );
  fs.writeFileSync(
    lastRun,
    JSON.stringify({
      time: daysAgo(1),
      ok: false,
      error: "the storage key was refused",
    }),
  );
  check(
    "OPT1. the last run failed: its error is named",
    same(await backupLines(), [
      0,
      "Backup: last run failed: the storage key was refused; /backup shows why",
    ]),
  );
  fs.writeFileSync(lastRun, JSON.stringify({ time: daysAgo(9), ok: true }));
  check(
    "OPT1. the last good run more than 7 days ago: its age is named",
    same(await backupLines(), [
      0,
      "Backup: last good run 9 days ago; /backup now runs one",
    ]),
  );
  fs.writeFileSync(lastRun, JSON.stringify({ time: daysAgo(6), ok: true }));
  check(
    "OPT1. a good run 6 days ago: no Backup line",
    same(await backupLines(), [0, ""]),
  );
  fs.writeFileSync(lastRun, "{ not json");
  const [badCode, badLine] = await backupLines();
  check(
    "OPT1. a last-run.json that can't be read: one Backup line naming the file",
    badCode === 0 &&
      badLine.startsWith(`Backup: ${fwd(lastRun)} could not be read (`),
    badLine,
  );
  fs.rmSync(backupHome, { recursive: true });
  setState({ backup: undefined });
  const saidNo = await update(home, "--backup", "no");
  check(
    "OPT1. update.mjs --backup no only puts the no on record",
    saidNo.code === 0 &&
      json(stateAt).backup === false &&
      !/Already on the newest|^nimbalyst:/m.test(saidNo.out),
    saidNo.out,
  );
  check(
    "OPT1. and the next update has no Backup line",
    same(await backupLines(), [0, ""]),
  );
  setState({ backup: undefined });
  const saidYes = await update(home, "--backup", "yes");
  check(
    "OPT1. update.mjs --backup yes puts the yes on record",
    saidYes.code === 0 && json(stateAt).backup === true,
    saidYes.out,
  );
  check(
    "OPT1. and the next update does not ask again",
    !(await backupLines())[1].includes("Backup: not asked"),
  );
  const skill = fs.readFileSync(
    path.join(REPO, "skills", "update-setup", "SKILL.md"),
    "utf8",
  );
  check(
    "OPT1. the skill's yes to the backup question puts it on record before /backup",
    /Backup: yes: `node ~\/\.claude\/skills\/update-setup\/update\.mjs --backup yes`[^\n]*then[^\n]*`\/backup`/.test(
      skill,
    ),
  );
  setState({ backup: undefined });
  fs.mkdirSync(backupHome, { recursive: true });
  fs.writeFileSync(
    path.join(backupHome, "config.json"),
    JSON.stringify({ target: "b2" }),
  );
  const ranBackup = await backupLines();
  check(
    "OPT1. /backup run without the question (config.json, no answer): not asked, and the yes goes on record",
    ranBackup[0] === 0 &&
      !ranBackup[1].includes("Backup: not asked") &&
      json(stateAt).backup === true,
    ranBackup.join(" "),
  );
  fs.rmSync(backupHome, { recursive: true });
  setState({ backup: false });
  const badAnswer = await update(home, "--backup", "later");
  check(
    "OPT1. update.mjs --backup with no yes or no stops, the answer stays",
    badAnswer.code === 1 &&
      badAnswer.out.includes(
        "Update stopped: --backup later: the answer is yes or no.",
      ) &&
      json(stateAt).backup === false,
  );
  delete process.env.CLAUDE_BACKUP_HOME;
  // Handy: looked for inside the test home only (its settings folder, where Windows and a Mac keep it)
  setState({ handy: undefined });
  const noHandy = await update(home);
  check(
    "OPT1. no Handy found: no Handy answer on record and nothing said",
    noHandy.code === 0 &&
      !("handy" in json(stateAt)) &&
      !/Handy|voice typing/i.test(noHandy.out),
  );
  for (const d of [
    path.join(home, "AppData", "Roaming", "com.pais.handy"),
    path.join(home, "Library", "Application Support", "com.pais.handy"),
  ])
    fs.mkdirSync(d, { recursive: true });
  const foundHandy = await update(home);
  check(
    "OPT1. Handy found with no answer on record: yes goes on record, nothing said",
    foundHandy.code === 0 &&
      json(stateAt).handy === true &&
      !/Handy|voice typing/i.test(foundHandy.out),
    foundHandy.out,
  );
  setState({ handy: false });
  await update(home);
  check(
    "OPT1. a no on record stays a no when Handy is found",
    json(stateAt).handy === false,
  );
  for (const d of ["AppData", "Library"])
    fs.rmSync(path.join(home, d), { recursive: true });
  fs.writeFileSync(stateAt, stateBefore);
}

// ---- a recorded setup folder that is not a setup folder: stopped before anything is loaded from it
const planted = path.join(tmp, "not-setup");
fs.mkdirSync(path.join(planted, "scripts"), { recursive: true });
fs.writeFileSync(
  path.join(planted, "scripts", "claude-code-version.mjs"),
  'console.log("planted module ran");\nexport const checkClaudeCode = () => ({ stop: null });\n',
);
const stateText = fs.readFileSync(stateAt, "utf8");
fs.writeFileSync(stateAt, JSON.stringify({ ...json(stateAt), repo: planted }));
const plantedRun = await update(home);
fs.writeFileSync(stateAt, stateText);
check(
  "on the newest version, a recorded folder that is no setup folder: Update stopped:, nothing loaded from it",
  plantedRun.code === 1 &&
    /^Update stopped: the setup's folder \([^)]*not-setup\) is not a setup folder/m.test(
      plantedRun.out,
    ) &&
    !plantedRun.out.includes("planted module ran"),
);

// ---- rules the user changed: their own rule moves to ~/.claude/rules/my-rules.md, the new shipped rule arrives
const mine = path.join(tmp, "mine");
spawnSync(
  process.execPath,
  [path.join(REPO, "install.mjs"), "--home", mine, "--codex", "no"],
  { encoding: "utf8" },
);
const myRules = path.join(mine, ".claude", "CLAUDE.md");
const ownFile = path.join(mine, ".claude", "rules", "my-rules.md");
fs.writeFileSync(
  myRules,
  fs
    .readFileSync(myRules, "utf8")
    .replace("# How to work", "# How to work\n\n- My own rule."),
);
const myHook = path.join(mine, ".claude", "hooks", "sql-guard.mjs");
fs.appendFileSync(myHook, "\n// my own change\n");
const mySkill = path.join(mine, ".claude", "skills", "build-table", "SKILL.md");
fs.mkdirSync(path.dirname(mySkill), { recursive: true });
fs.writeFileSync(mySkill, "# My own skill\n");
process.env.NIMBALYST_FOLLOW = "off";
const keptMine = await update(mine);
delete process.env.NIMBALYST_FOLLOW;
await new Promise((r) => setTimeout(r, 700));
check(
  "NB4. NIMBALYST_FOLLOW=off: the update starts no stage, the nimbalyst: line still comes",
  !callsOf(mine).includes("--stage") &&
    callsOf(mine).includes("--status") &&
    /^nimbalyst: /m.test(keptMine.out),
);
check(
  "a run that carves the rules leaves the user's own skill byte for byte",
  fs.readFileSync(mySkill, "utf8") === "# My own skill\n",
);
check(
  "a hook of the setup's that the user changed is kept and listed",
  fs.readFileSync(myHook, "utf8").endsWith("// my own change\n") &&
    /Kept as yours[^\n]*\n {2}hooks\/sql-guard\.mjs\n/.test(keptMine.out),
);
const hookTaken = await update(mine, "--replace", "hooks/sql-guard.mjs");
check(
  "--replace takes this version's copy and keeps the user's as a dated copy",
  hookTaken.code === 0 &&
    fs.readFileSync(myHook, "utf8").endsWith("// newer\n") &&
    fs
      .readFileSync(backupOf(mine, myHook), "utf8")
      .endsWith("// my own change\n") &&
    besideFiles(path.dirname(myHook)).length === 0,
);
check(
  "one update keeps the user's own rule (moved to my-rules.md) and brings the new shipped rule",
  keptMine.code === 0 &&
    /^rules: brought up to this version: \d+ setup rules new or changed, \d+ old ones removed, 1 of yours moved to /m.test(
      keptMine.out,
    ) &&
    fs
      .readFileSync(myRules, "utf8")
      .includes("A rule from the newer version.") &&
    !fs.readFileSync(myRules, "utf8").includes("- My own rule.") &&
    /## How to work\n+- My own rule\./.test(fs.readFileSync(ownFile, "utf8")),
);
const rulesNow = fs.readFileSync(myRules, "utf8");
const oldFlag = await update(mine, "--replace-rules");
check(
  "--replace-rules is no longer passed on: no installer runs and the rules stay as they are",
  oldFlag.code === 0 &&
    !/^rules:/m.test(oldFlag.out) &&
    fs.readFileSync(myRules, "utf8") === rulesNow,
);
// --leave-out is passed on with its lead (install.mjs records it in state.rulesLeftOut)
const leftLead = lead(
  splitBlocks(
    fs.readFileSync(path.join(REPO, "rules", "CLAUDE.md"), "utf8"),
  ).find((b) => /^- /.test(b.text)).text,
);
const leftOut = await update(mine, "--leave-out", leftLead);
check(
  "--leave-out is passed on with its lead",
  leftOut.code === 0 &&
    JSON.stringify(
      json(path.join(mine, ".claude", "setup-state.json")).rulesLeftOut,
    ) === JSON.stringify([leftLead]),
);
const putBack = await update(mine, "--put-back", leftLead);
check(
  "--put-back is passed on with its lead",
  putBack.code === 0 &&
    !json(path.join(mine, ".claude", "setup-state.json")).rulesLeftOut?.length,
);

// ---- the closing list: what stays behind this version, with the line that takes it; the rules are never on it
check(
  "an update ends with the list of what stays on old versions, each with its --replace line, and no rules line",
  /Yours, on old versions/.test(keptMine.out) &&
    keptMine.out.includes("hooks/sql-guard.mjs: node ") &&
    /--replace "?hooks\/sql-guard\.mjs"?/.test(keptMine.out) &&
    !/the rules \(CLAUDE\.md\)|--replace-rules/.test(keptMine.out),
);
check(
  "a run with nothing left behind prints no such list",
  !/Yours, on old versions/.test(hookTaken.out),
);

// ---- a setup folder missing one of its scripts stops with a clear line, not an import stack trace
const partRepo = path.join(tmp, "part-repo");
fs.mkdirSync(path.join(partRepo, "scripts"), { recursive: true });
fs.mkdirSync(path.join(partRepo, "extensions", "ink-themes"), {
  recursive: true,
});
fs.copyFileSync(
  path.join(REPO, "scripts", "ink-default.mjs"),
  path.join(partRepo, "scripts", "ink-default.mjs"),
);
fs.copyFileSync(
  path.join(REPO, "extensions", "ink-themes", "themes.mjs"),
  path.join(partRepo, "extensions", "ink-themes", "themes.mjs"),
);
for (const f of ["install.mjs", "version.json", "scripts/setup-state.mjs"])
  fs.copyFileSync(path.join(REPO, f), path.join(partRepo, f));
const mineState = path.join(mine, ".claude", "setup-state.json");
fs.writeFileSync(
  mineState,
  JSON.stringify({
    ...json(mineState),
    repo: partRepo,
    themePending: true,
    themePendingFrom: "dark",
  }),
);
const partRun = await update(mine, "--app-settings", appSet);
check(
  "a pending theme with a setup folder lacking scripts/nimbalyst-paths.mjs: Update stopped:, exit 1",
  partRun.code === 1 &&
    /^Update stopped: the setup's folder \([^)]*\) has no scripts\/nimbalyst-paths\.mjs/m.test(
      partRun.out,
    ),
);

// ---- the update skill asks nothing about taking the rules: the carve keeps the user's own
const skillText = fs.readFileSync(
  path.join(REPO, "skills", "update-setup", "SKILL.md"),
  "utf8",
);
check(
  "the update skill has no question about taking the new rules",
  !/take the new rules|--replace-rules|takes the rules too|yours were kept/i.test(
    skillText,
  ),
);
// the printed line is run as it stands, on a home of its own
const listHome = path.join(tmp, "list-home");
spawnSync(
  process.execPath,
  [path.join(REPO, "install.mjs"), "--home", listHome, "--codex", "no"],
  { encoding: "utf8" },
);
const listHook = path.join(listHome, ".claude", "hooks", "sql-guard.mjs");
fs.appendFileSync(listHook, "\n// my own change\n");
const listed = (await update(listHome)).out
  .split("\n")
  .find((l) => l.includes("hooks/sql-guard.mjs: node "));
const listedRun = spawnSync(listed.slice(listed.indexOf(": node ") + 2), {
  shell: true,
  encoding: "utf8",
  env: {
    ...process.env,
    PATH:
      path.dirname(process.execPath) +
      path.delimiter +
      (process.env.PATH || ""),
  },
});
check(
  "the printed --replace line works as it stands: it takes this version's hook",
  fs.readFileSync(listHook, "utf8").includes("// my own change") === false &&
    listedRun.status === 0,
);

// ---- a friend from before 1.0.74 on sonnet moves to Opus medium, loudly; --keep-model undoes it
const oldHome = (name, model) => {
  const h = path.join(tmp, name);
  spawnSync(
    process.execPath,
    [path.join(REPO, "install.mjs"), "--home", h, "--codex", "no"],
    { encoding: "utf8" },
  );
  const stateFileOld = path.join(h, ".claude", "setup-state.json");
  fs.writeFileSync(
    stateFileOld,
    JSON.stringify({ ...json(stateFileOld), version: "1.0.70" }),
  );
  const sf = path.join(h, ".claude", "settings.json");
  const s = json(sf);
  delete s.modelSettings;
  s.model = model;
  fs.writeFileSync(sf, JSON.stringify(s));
  return { h, settings: () => json(sf), state: () => json(stateFileOld) };
};
const sonnetHome = oldHome("sonnet-old", "sonnet");
const moved = await update(sonnetHome.h);
check(
  "an update from 1.0.70 moves sonnet to Opus medium and says so with the undo",
  moved.code === 0 &&
    sonnetHome.settings().model === "opus" &&
    Object.values(sonnetHome.settings().modelSettings || {}).some(
      (m) => m.effortLevel === "medium",
    ) &&
    /MODEL CHANGED/.test(moved.out) &&
    /--keep-model/.test(moved.out) &&
    sonnetHome.state().model === "moved",
);
const keptSonnet = oldHome("sonnet-keep", "sonnet");
const keptRun = await update(keptSonnet.h, "--keep-model");
check(
  "--keep-model through the updater keeps sonnet and records it",
  keptRun.code === 0 &&
    keptSonnet.settings().model === "sonnet" &&
    !/MODEL CHANGED/.test(keptRun.out) &&
    keptSonnet.state().model === "kept",
);
const otherHome = oldHome("other-model", "opus");
check(
  "a friend on another model is not moved",
  (await update(otherHome.h)).code === 0 &&
    otherHome.settings().model === "opus" &&
    !otherHome.state().model,
);

// ---- --files-only, the self-install hooks/update-check.mjs starts for releases of files only (spec section 7, case 9).
// The release changes two hooks, a skill, the rules and the hook table: only the hooks and the skill may land.
const FILESV = "99.9.11";
const thisVersion = json(path.join(REPO, "version.json")).version;
const filesPack = path.join(tmp, "pack-files", `ai-coding-setup-${FILESV}`);
fs.cpSync(REPO, filesPack, {
  recursive: true,
  filter: (src) => !SKIP.includes(path.basename(src)),
});
const filesRelease = {
  version: FILESV,
  projectPass: PASS_NEW,
  releases: {
    [FILESV]: {
      kind: "files",
      important: false,
      headline: "Two hooks say more.",
    },
  },
};
fs.writeFileSync(
  path.join(filesPack, "version.json"),
  JSON.stringify(filesRelease),
);
// the release's heading goes above the newest version heading, as a release writes it
const log = fs.readFileSync(path.join(filesPack, "CHANGELOG.md"), "utf8");
if (!/^## \[\d/m.test(log))
  throw new Error(
    "CHANGELOG.md has no version heading to put the test release above",
  );
fs.writeFileSync(
  path.join(filesPack, "CHANGELOG.md"),
  log.replace(
    /^## \[\d/m,
    (head) => `## [${FILESV}] - 2026-11-09\n\n- Two hooks say more.\n\n${head}`,
  ),
);
fs.appendFileSync(
  path.join(filesPack, "hooks", "sql-guard.mjs"),
  "\n// files release\n",
);
fs.appendFileSync(
  path.join(filesPack, "hooks", "link-gate.mjs"),
  "\n// files release\n",
);
fs.appendFileSync(
  path.join(filesPack, "skills", "update-setup", "SKILL.md"),
  "\nFiles release.\n",
);
fs.appendFileSync(
  path.join(filesPack, "rules", "CLAUDE.md"),
  "\n- A rule a files release must not bring.\n",
);
const example = json(path.join(filesPack, "settings.example.json"));
example.hooks.Stop.push({
  hooks: [
    {
      type: "command",
      command: "node ~/.claude/hooks/not-wired-by-files-only.mjs",
    },
  ],
});
fs.writeFileSync(
  path.join(filesPack, "settings.example.json"),
  JSON.stringify(example, null, 2),
);
putStub(filesPack);
check(
  "the files-only test archive was made",
  spawnSync(
    tar,
    [
      "-czf",
      path.join("..", "served", `v${FILESV}.tar.gz`),
      `ai-coding-setup-${FILESV}`,
    ],
    { cwd: path.join(tmp, "pack-files"), encoding: "utf8" },
  ).status === 0,
);

const filesHome = path.join(tmp, "files-home");
const fc = path.join(filesHome, ".claude");
spawnSync(
  process.execPath,
  [path.join(REPO, "install.mjs"), "--home", filesHome, "--codex", "no"],
  { encoding: "utf8" },
);
const fOwnSkill = path.join(fc, "skills", "build-table", "SKILL.md");
fs.mkdirSync(path.dirname(fOwnSkill), { recursive: true });
fs.writeFileSync(fOwnSkill, "# My own skill\n");
const fMyHook = path.join(fc, "hooks", "link-gate.mjs");
fs.appendFileSync(fMyHook, "\n// my own change\n");
const fBefore = {
  settings: fs.readFileSync(path.join(fc, "settings.json"), "utf8"),
  rules: fs.readFileSync(path.join(fc, "CLAUDE.md"), "utf8"),
};
const checkFile = path.join(fc, "update-check.json");
fs.writeFileSync(
  checkFile,
  JSON.stringify({
    latest: FILESV,
    autoRun: {
      version: FILESV,
      from: thisVersion,
      startedAt: new Date().toISOString(),
    },
  }),
);

// a missed release labelled setup: nothing is installed, the error goes on record for the hook
released = {
  version: FILESV,
  releases: { [FILESV]: { kind: "setup", important: true, headline: "x" } },
};
const refused = await update(filesHome, "--files-only");
const refusedAuto = json(checkFile).auto;
check(
  "--files-only refuses a release that is not files only, and says so in update-check.json",
  refused.code === 1 &&
    refusedAuto?.ok === false &&
    refusedAuto.version === FILESV &&
    /99\.9\.11 is not a release of files only/.test(refusedAuto.error) &&
    !("autoRun" in json(checkFile)),
);
check(
  "and setup-state.json keeps the installed version",
  json(path.join(fc, "setup-state.json")).version === thisVersion &&
    !fs
      .readFileSync(path.join(fc, "hooks", "sql-guard.mjs"), "utf8")
      .includes("// files release"),
);

released = filesRelease;
// the installed version's folder gone: its own reason, not "changes the extensions"
const fStateFile = path.join(fc, "setup-state.json");
const fStateText = fs.readFileSync(fStateFile, "utf8");
fs.writeFileSync(
  fStateFile,
  JSON.stringify({ ...JSON.parse(fStateText), repo: path.join(tmp, "gone") }),
);
const noRepo = await update(filesHome, "--files-only");
check(
  "--files-only with the setup's folder gone: stopped with that reason in auto",
  noRepo.code === 1 &&
    /setup's folder .* is gone/.test(json(checkFile).auto?.error || "") &&
    !/changes the extension/.test(json(checkFile).auto.error),
);
// something thrown outside stop() (here a setup-state.json that is not JSON) still goes on record with its message
fs.writeFileSync(fStateFile, "{ broken");
const thrown = await update(filesHome, "--files-only");
check(
  "--files-only: an error thrown outside stop() is recorded in auto with its message",
  thrown.code === 1 &&
    json(checkFile).auto?.ok === false &&
    /JSON/.test(json(checkFile).auto.error),
);
fs.writeFileSync(fStateFile, fStateText);
fs.writeFileSync(path.join(fc, "update-auto.lock"), "");
const selfDone = await update(filesHome, "--files-only");
check(
  "--files-only frees the hook's lock when it ends",
  !fs.existsSync(path.join(fc, "update-auto.lock")),
);
const fState = json(path.join(fc, "setup-state.json"));
const okAuto = json(checkFile).auto;
check(
  "--files-only installs a files release: exit 0, the new version on record",
  selfDone.code === 0 && fState.version === FILESV,
);
check(
  "its result goes to update-check.json auto",
  okAuto?.ok === true &&
    okAuto.version === FILESV &&
    okAuto.from === thisVersion &&
    okAuto.headline === "Two hooks say more" &&
    !!okAuto.at &&
    !("autoRun" in json(checkFile)) &&
    json(checkFile).latest === FILESV,
);
check(
  "a hook the setup wrote is replaced, the skill too",
  fs
    .readFileSync(path.join(fc, "hooks", "sql-guard.mjs"), "utf8")
    .endsWith("// files release\n") &&
    fs
      .readFileSync(path.join(fc, "skills", "update-setup", "SKILL.md"), "utf8")
      .endsWith("Files release.\n"),
);
check(
  "a hook the user changed is not replaced, and auto lists it as kept",
  fs.readFileSync(fMyHook, "utf8").endsWith("// my own change\n") &&
    JSON.stringify(okAuto.kept) === JSON.stringify(["hooks/link-gate.mjs"]),
);
check(
  "the user's own skill is untouched",
  fs.readFileSync(fOwnSkill, "utf8") === "# My own skill\n",
);
check(
  "settings.json and the rules are not touched",
  fs.readFileSync(path.join(fc, "settings.json"), "utf8") ===
    fBefore.settings &&
    fs.readFileSync(path.join(fc, "CLAUDE.md"), "utf8") === fBefore.rules,
);
check(
  "the record of the files is kept up to date, with the setup's folder the downloaded one",
  fs.realpathSync(fState.repo) ===
    fs.realpathSync(path.join(fc, "setup-source", `v${FILESV}`)) &&
    Object.keys(fState.files).some((f) => f.endsWith("/hooks/sql-guard.mjs")),
);
// the same release labelled nimbalyst (a Nimbalyst version the setup checked) installs itself as well; --files-only
// leaves the stage and the nimbalyst: line to the hook, which says its result
const fStateAfter = fs.readFileSync(fStateFile, "utf8");
fs.writeFileSync(fStateFile, fStateText);
fs.writeFileSync(
  checkFile,
  JSON.stringify({
    latest: FILESV,
    autoRun: {
      version: FILESV,
      from: thisVersion,
      startedAt: new Date().toISOString(),
    },
  }),
);
released = {
  ...filesRelease,
  releases: {
    [FILESV]: {
      kind: "nimbalyst",
      important: false,
      headline: "Nimbalyst 0.84.0 with the setup's fixes.",
    },
  },
};
const nbSelf = await update(filesHome, "--files-only");
await new Promise((r) => setTimeout(r, 700));
check(
  "NB4. --files-only installs a nimbalyst release: exit 0, the new version on record, auto ok",
  nbSelf.code === 0 &&
    json(fStateFile).version === FILESV &&
    json(checkFile).auto?.ok === true,
  nbSelf.out,
);
check(
  "NB4. --files-only starts no stage and prints no nimbalyst: line",
  callsOf(filesHome).length === 0 && !/^nimbalyst: /m.test(nbSelf.out),
);
released = filesRelease;
fs.writeFileSync(fStateFile, fStateAfter);
const plainAfter = await update(filesHome);
check(
  "a normal update afterwards says it is on the newest version",
  plainAfter.code === 0 &&
    plainAfter.out.startsWith(`Already on the newest version (${FILESV})`),
);

// ---- the file reorganize offer: file-check.mjs --status --homes, its offer line passed on as files-offer:
const shopHome = path.join(tmp, "Users", "someone", "Projects", "shop");
fs.mkdirSync(shopHome, { recursive: true });
fs.writeFileSync(path.join(shopHome, "CLAUDE.md"), "# shop\n");
fs.writeFileSync(path.join(shopHome, "Price_List.md"), "p\n");
const withShop = json(path.join(fc, "setup-state.json"));
fs.writeFileSync(
  path.join(fc, "setup-state.json"),
  JSON.stringify({
    ...withShop,
    projects: fwd(path.dirname(shopHome)),
    written: { ...withShop.written, [`${fwd(shopHome)}/CLAUDE.md`]: "x" },
  }),
);
const offered = await update(filesHome);
check(
  "an update with files to reorganize passes the offer on as one files-offer: line",
  offered.code === 0 &&
    (
      offered.out.match(
        /^files-offer: 1 folder, 1 files to reorganize, about \d+ minutes .*--skip --homes\)$/gm,
      ) || []
    ).length === 1,
  offered.out,
);
fs.rmSync(path.join(shopHome, "Price_List.md"));
const tidy = await update(filesHome);
check(
  "with nothing to reorganize (offer: none) it prints no files line",
  tidy.code === 0 && !/^files/m.test(tidy.out),
  tidy.out,
);

// ---- what stops an update leaves the setup as it was
released = { version: "99.9.10" };
const noArchive = await update(home);
check(
  "a release with no archive stops the update with the reason",
  noArchive.code === 1 &&
    /Update stopped: could not download .*v99\.9\.10\.tar\.gz \(HTTP 404\)/.test(
      noArchive.out,
    ),
);
check(
  "and the installed version is unchanged",
  json(path.join(claude, "setup-state.json")).version === NEW &&
    fs.readdirSync(path.join(claude, "setup-source")).join() === `v${NEW}`,
);
fs.writeFileSync(path.join(served, "v99.9.10.tar.gz"), "not an archive");
const badArchive = await update(home);
check(
  "a download that is not an archive stops it too",
  badArchive.code === 1 &&
    badArchive.out.includes("Update stopped: could not unpack") &&
    json(path.join(claude, "setup-state.json")).version === NEW,
);
released = { version: "soon" };
check(
  "a version file with no number stops it",
  (await update(home)).out.includes("has no usable version number"),
);
const never = path.join(tmp, "never");
fs.mkdirSync(never);
const notInstalled = await update(never);
check(
  "a home folder the installer never ran in is told to install first",
  notInstalled.code === 1 &&
    notInstalled.out.includes("setup-state.json is missing"),
);
server.close();
const offline = await update(home);
check(
  "no connection: stopped with the reason",
  offline.code === 1 && offline.out.includes("Update stopped: could not read"),
);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(fail ? `${fail} failed, ${pass} passed` : `all ${pass} passed`);
process.exit(fail ? 1 : 0);
