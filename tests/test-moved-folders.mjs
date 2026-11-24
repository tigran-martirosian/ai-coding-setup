// Tests for the folders the setup moved (scripts/files.mjs MOVED_FOLDERS; 26.6: ~/.claude/tools/nimbalyst-patch went
// to ~/.claude/scripts/nimbalyst-patch). An install over an older home takes out the old copies the setup wrote and
// never one the person changed or put there; a staged Nimbalyst job naming the old delivery script is pointed at
// the new one, and a delivery that may still run from the old folder keeps it until the next update. Temporary
// homes only. Run: node tests/test-moved-folders.mjs
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

process.env.SETUP_CC_CHECK = "off";
process.env.NIMBALYST_FOLLOW = "off";
const REPO = fileURLToPath(new URL("..", import.meta.url));
const NEW_REL = path.join("scripts", "nimbalyst-patch");
const OLD_REL = path.join("tools", "nimbalyst-patch");
let fails = 0;
const ok = (name, pass, detail = "") => {
  if (!pass) fails++;
  console.log(`${pass ? "PASS" : "FAIL"} ${name}${pass ? "" : `: ${detail}`}`);
};
const fwd = (p) => p.replace(/\\/g, "/");
// The lines of an install's output about the moved folder and Nimbalyst, for a failed check's detail
const about = (out) =>
  out
    .split("\n")
    .filter(
      (l) => /tools|nimbalyst|staged|error/i.test(l) && !/^unchanged /.test(l),
    )
    .join("\n  ");
const sha = (b) => crypto.createHash("sha256").update(b).digest("hex");
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "moved-folders-test-"));
process.on("exit", () => fs.rmSync(tmp, { recursive: true, force: true }));
const emptyPath = path.join(tmp, "empty-path");
fs.mkdirSync(emptyPath);
const install = (home, data, ...flags) => {
  const r = spawnSync(
    process.execPath,
    [
      path.join(REPO, "install.mjs"),
      "--home",
      home,
      "--codex",
      "no",
      "--extensions",
      "no",
      "--plugins",
      "no",
      "--obscura",
      "no",
      "--no-theme",
      ...flags,
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: emptyPath,
        Path: emptyPath,
        NIMBALYST_DELIVER_DATA: data,
      },
    },
  );
  if (r.status !== 0)
    throw new Error(
      `install into ${home} ended with exit ${r.status}: ${r.stdout}${r.stderr}`,
    );
  return r.stdout;
};
const repoFiles = (dir, base = dir) =>
  fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((e) =>
      e.isDirectory()
        ? repoFiles(path.join(dir, e.name), base)
        : [path.relative(base, path.join(dir, e.name))],
    );
const PATCH_FILES = repoFiles(path.join(REPO, NEW_REL));

// A home as 26.5 left it: installed, then the patch folder's copies in ~/.claude/tools/nimbalyst-patch/, each on
// the record (setup-state.json "files") with the hash the setup wrote. edit: files the person changed after that.
// linked: ~/.claude is a junction (a symbolic link off Windows) to a folder elsewhere.
function oldHome(name, edit = [], linked = false) {
  const home = path.join(tmp, name);
  const data = path.join(tmp, `${name}-data`);
  if (linked) {
    const real = path.join(tmp, `${name}-real-claude`);
    fs.mkdirSync(real, { recursive: true });
    fs.mkdirSync(home, { recursive: true });
    fs.symlinkSync(real, path.join(home, ".claude"), "junction");
  }
  install(home, data);
  const claude = path.join(home, ".claude");
  const stateFile = path.join(claude, "setup-state.json");
  const state = JSON.parse(fs.readFileSync(stateFile, "utf8"));
  for (const rel of PATCH_FILES) {
    const at = path.join(claude, OLD_REL, rel);
    const shipped = fs.readFileSync(path.join(REPO, NEW_REL, rel));
    fs.mkdirSync(path.dirname(at), { recursive: true });
    fs.writeFileSync(at, shipped);
    state.files[fwd(at)] = sha(shipped);
  }
  for (const rel of edit)
    fs.appendFileSync(
      path.join(claude, OLD_REL, rel),
      "\n// changed by the person\n",
    );
  fs.writeFileSync(stateFile, JSON.stringify(state, null, 2));
  return { home, data, claude, stateFile };
}
// A staged Nimbalyst job (deliver.mjs's staged.json) that names deliver; returns the file and its text
function stage(h, deliver) {
  fs.mkdirSync(h.data, { recursive: true });
  const file = path.join(h.data, "staged.json");
  const text = JSON.stringify({ version: "0.99.0", node: "node", deliver });
  fs.writeFileSync(file, text);
  return { file, text };
}
const stagedDeliver = (file) =>
  JSON.parse(fs.readFileSync(file, "utf8")).deliver;
// The line that tells Claude, in the middle of an update from 26.5, that the old updater's Nimbalyst step can't run
const NIMBALYST_LINE =
  "Nimbalyst: its update moves to scripts/ and runs at the next session start; skip the Nimbalyst step of this update.";
const keptLine = (h) => `kept ${fwd(path.join(h.claude, OLD_REL))}/ this time`;

// ---- 1. the setup's own copies only: all go, ~/.claude/tools with them, and the record of a copy already gone
{
  const h = oldHome("clean");
  const stale = path.join(h.claude, OLD_REL, "patches", "gone-already.mjs");
  const state = JSON.parse(fs.readFileSync(h.stateFile, "utf8"));
  state.files[fwd(stale)] = sha("gone");
  fs.writeFileSync(h.stateFile, JSON.stringify(state, null, 2));
  const out = install(h.home, h.data);
  ok(
    "an update takes out every unchanged old copy and the old top folder: ~/.claude/tools is gone",
    !fs.existsSync(path.join(h.claude, "tools")),
    `${fwd(path.join(h.claude, "tools"))} is still there`,
  );
  ok(
    "the new folder holds what the old one held: ~/.claude/scripts/nimbalyst-patch has every patch file",
    PATCH_FILES.every((rel) =>
      fs.existsSync(path.join(h.claude, NEW_REL, rel)),
    ),
  );
  ok(
    "the update says the move in one line",
    out.includes(
      `moved ${fwd(path.join(h.claude, OLD_REL))}/ to ${fwd(path.join(h.claude, NEW_REL))}/ (${PATCH_FILES.length} old copies removed`,
    ),
    about(out),
  );
  ok(
    "with the old deliver.mjs gone, the update tells Claude to skip the old updater's Nimbalyst step, once",
    out.split(NIMBALYST_LINE).length === 2,
    about(out),
  );
  const after = JSON.parse(fs.readFileSync(h.stateFile, "utf8"));
  ok(
    "the record of written files keeps no old path, not even one whose file was already gone",
    !Object.keys(after.files).some((f) =>
      f.startsWith(`${fwd(path.join(h.claude, "tools"))}/`),
    ),
    Object.keys(after.files)
      .filter((f) => f.startsWith(`${fwd(path.join(h.claude, "tools"))}/`))
      .join(", "),
  );
}

// ---- 2. a copy the person changed and files the person made stay; a staged job naming another script stays
{
  const changed = path.join("patches", "home-links.mjs");
  const h = oldHome("mixed", [changed]);
  const mine = path.join(h.claude, OLD_REL, "my-notes.txt");
  const myTool = path.join(h.claude, "tools", "mine", "run.mjs");
  fs.writeFileSync(mine, "my own notes\n");
  fs.mkdirSync(path.dirname(myTool), { recursive: true });
  fs.writeFileSync(myTool, "// my own tool\n");
  const changedAt = path.join(h.claude, OLD_REL, changed);
  const changedText = fs.readFileSync(changedAt);
  fs.mkdirSync(h.data, { recursive: true });
  const stagedFile = path.join(h.data, "staged.json");
  const otherJob = JSON.stringify({
    version: "0.99.0",
    node: "node",
    deliver: path.join(tmp, "elsewhere", "deliver.mjs"),
  });
  fs.writeFileSync(stagedFile, otherJob);
  const out = install(h.home, h.data);
  ok(
    "a copy the person changed is never deleted: it stays with its content",
    fs.existsSync(changedAt) && fs.readFileSync(changedAt).equals(changedText),
    `${fwd(changedAt)} is gone or differs`,
  );
  ok(
    "a changed copy is named, with where the setup's copy is now",
    out.includes(
      `kept yours ${fwd(changedAt)} (changed since it was installed; the setup's copy is now in ${fwd(path.join(h.claude, NEW_REL))}/`,
    ),
    about(out),
  );
  ok(
    "files the person made in the old folder are left alone",
    fs.readFileSync(mine, "utf8") === "my own notes\n" &&
      fs.readFileSync(myTool, "utf8") === "// my own tool\n",
  );
  ok(
    "the unchanged copies beside them still go",
    !fs.existsSync(path.join(h.claude, OLD_REL, "deliver.mjs")) &&
      !fs.existsSync(path.join(h.claude, OLD_REL, "patches", "1558.mjs")),
  );
  ok(
    "a staged job naming another delivery script is left as it was",
    fs.readFileSync(stagedFile, "utf8") === otherJob,
  );
  const again = install(h.home, h.data);
  ok(
    "the next update names the changed copy no more and still leaves it",
    !again.includes(fwd(changedAt)) && fs.existsSync(changedAt),
    about(again),
  );
}

// ---- 3. a staged job that names the old deliver.mjs may be running from it: the job is pointed at the new
// script and the old folder stays this time; the next update takes it out
{
  const h = oldHome("staged");
  const oldDeliver = path.join(h.claude, OLD_REL, "deliver.mjs");
  const newDeliver = path.join(h.claude, NEW_REL, "deliver.mjs");
  const job = stage(h, oldDeliver);
  const out = install(h.home, h.data);
  const staged = JSON.parse(fs.readFileSync(job.file, "utf8"));
  ok(
    "a staged Nimbalyst job that named the old deliver.mjs names the new one, so the app's close still runs it",
    path.resolve(staged.deliver) === path.resolve(newDeliver) &&
      staged.version === "0.99.0" &&
      staged.node === "node",
    JSON.stringify(staged),
  );
  ok(
    "the old folder a staged job named stays this time, and one line says so",
    fs.existsSync(oldDeliver) && out.includes(keptLine(h)),
    about(out),
  );
  ok(
    "with the old deliver.mjs still there, the old updater's Nimbalyst step is not called off",
    !out.includes(NIMBALYST_LINE),
    about(out),
  );
  install(h.home, h.data);
  ok(
    "the next update takes the old folder out, the job now naming the new script",
    !fs.existsSync(path.join(h.claude, "tools")) &&
      path.resolve(stagedDeliver(job.file)) === path.resolve(newDeliver),
  );
}

// ---- 4. a stage run holds download.lock: the staged job and the old folder stay as they are
{
  const h = oldHome("locked");
  const oldDeliver = path.join(h.claude, OLD_REL, "deliver.mjs");
  const job = stage(h, oldDeliver);
  const lock = path.join(h.data, "download.lock");
  // this test's own process stands for the stage run: it is alive
  fs.writeFileSync(
    lock,
    JSON.stringify({ pid: process.pid, version: "0.99.0", at: "now" }),
  );
  const out = install(h.home, h.data);
  ok(
    "while a Nimbalyst stage run holds download.lock, staged.json is not touched",
    fs.readFileSync(job.file, "utf8") === job.text,
    fs.readFileSync(job.file, "utf8"),
  );
  ok(
    "while a stage run holds download.lock, the old folder stays and one line says so",
    fs.existsSync(oldDeliver) && out.split(keptLine(h)).length === 2,
    about(out),
  );
  fs.rmSync(lock);
  install(h.home, h.data);
  ok(
    "once the stage run is over, the next update points the job at the new script",
    path.resolve(stagedDeliver(job.file)) ===
      path.resolve(path.join(h.claude, NEW_REL, "deliver.mjs")),
  );
}

// ---- 5. Windows refuses to remove a folder a program has open (EBUSY): it stays for the next run, the install goes on
{
  const h = oldHome("busy");
  const busy = path.join(h.claude, OLD_REL, "patches");
  const holder = spawn(
    process.execPath,
    ["-e", "setTimeout(() => {}, 60000)"],
    {
      cwd: busy,
      stdio: "ignore",
    },
  );
  let out;
  try {
    out = install(h.home, h.data);
  } catch (e) {
    out = e;
  }
  ok(
    "a folder in use (a program started in it) never makes the install fail",
    typeof out === "string",
    about(String(out)),
  );
  ok(
    "the unchanged copies in the folder in use still go",
    !fs.existsSync(path.join(busy, "1558.mjs")),
  );
  holder.kill();
  await new Promise((r) => holder.on("exit", r));
  install(h.home, h.data);
  ok(
    "once the folder is free, the next update takes it out",
    !fs.existsSync(path.join(h.claude, "tools")),
  );
}

// ---- 6. ~/.claude reached through a junction: a job naming the old script by its real path is still pointed
{
  const h = oldHome("linked", [], true);
  const oldDeliver = fs.realpathSync.native(
    path.join(h.claude, OLD_REL, "deliver.mjs"),
  );
  const job = stage(h, oldDeliver);
  install(h.home, h.data);
  const now = stagedDeliver(job.file);
  ok(
    "a staged job naming the old deliver.mjs by its real path (not through the junction) is pointed at the new one",
    fs.existsSync(now) &&
      fs.realpathSync.native(now) ===
        fs.realpathSync.native(path.join(h.claude, NEW_REL, "deliver.mjs")),
    now,
  );
}

// ---- 7. an old copy kept beside a file in the old folder moves into setup-logs, and --uninstall puts it back
{
  const h = oldHome("copies");
  const target = path.join(h.claude, OLD_REL, "deliver.mjs");
  const oldCopy = `${target}.before-install-20261001`;
  fs.writeFileSync(oldCopy, "// my own deliver\n");
  const state = JSON.parse(fs.readFileSync(h.stateFile, "utf8"));
  delete state.oldCopiesMoved;
  state.userCopies = [fwd(oldCopy)];
  fs.writeFileSync(h.stateFile, JSON.stringify(state, null, 2));
  install(h.home, h.data);
  const moved = path.join(
    h.claude,
    "setup-logs",
    "2026-10-01-install-backup",
    ".claude",
    OLD_REL,
    "deliver.mjs",
  );
  ok(
    "an old copy in the moved folder goes into setup-logs like the others",
    !fs.existsSync(oldCopy) && fs.existsSync(moved),
    `${fwd(oldCopy)} ${fs.existsSync(oldCopy) ? "is still there" : "is gone"}`,
  );
  install(h.home, h.data, "--uninstall");
  ok(
    "--uninstall puts the person's copy back in the moved folder",
    fs.existsSync(target) &&
      fs.readFileSync(target, "utf8") === "// my own deliver\n",
  );
}

// ---- 8. --dry-run over a 26.5 home (no new folder yet) names the staged job it would point
{
  const h = oldHome("dry");
  fs.rmSync(path.join(h.claude, NEW_REL), { recursive: true });
  const job = stage(h, path.join(h.claude, OLD_REL, "deliver.mjs"));
  const out = install(h.home, h.data, "--dry-run");
  ok(
    "--dry-run says it would point the staged job, as a real run would, and changes nothing",
    out.includes(
      `would point the staged Nimbalyst job in ${fwd(job.file)} at ${fwd(path.join(h.claude, NEW_REL, "deliver.mjs"))}`,
    ) && fs.readFileSync(job.file, "utf8") === job.text,
    about(out),
  );
}

console.log(fails ? `FAIL ${fails} checks failed` : "all passed");
process.exit(fails ? 1 : 0);
