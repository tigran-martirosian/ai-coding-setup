#!/usr/bin/env node
// Tests for tools/nimbalyst-patch/deliver.mjs, on a fake install folder in a temp folder: a small built
// app.asar, a fake Nimbalyst.exe (only its fuse wire), test patches, a fake installer (a node script that lays
// down a prepared app.asar), a fake download (a copy) and a file that stands for the running-process list.
// Nothing here touches the installed Nimbalyst, its processes or the real data folder. Windows only.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DELIVER = path.join(
  import.meta.dirname,
  "..",
  "tools",
  "nimbalyst-patch",
  "deliver.mjs",
);
if (process.platform !== "win32") {
  console.log("skipped: deliver.mjs is Windows only");
  process.exit(0);
}
const T = fs.mkdtempSync(path.join(os.tmpdir(), "nimbalyst-deliver-test-"));
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

// ---- the fake app ----
const MAIN = 'module.exports = { updater: "on", label: "Edited" };\n';
const MAIN_BLOCKED = 'module.exports = { updater: "off", label: "Edited" };\n';
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
const asarVersion = (file) => {
  const b = fs.readFileSync(file);
  return (b.toString("utf8").match(/"version":"([^"]+)"/) || [])[1];
};

// ---- shared fixtures: patches, installer, download, payloads, pin ----
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
const INSTALLER = path.join(T, "source", "Nimbalyst-Windows-x64.exe");
write(
  INSTALLER,
  `// fake installer: logs its arguments, then lays down FAKE_PAYLOAD as the new app.asar
const fs = require("fs"), path = require("path");
fs.appendFileSync(process.env.FAKE_INSTALLER_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");
const code = Number(process.env.FAKE_INSTALLER_EXIT || 0);
if (code) process.exit(code);
fs.copyFileSync(process.env.FAKE_PAYLOAD, path.join(process.env.FAKE_INSTALL_DIR, "resources", "app.asar"));
`,
);
const DOWNLOAD = path.join(T, "fake-download.mjs");
write(
  DOWNLOAD,
  `import fs from "node:fs";
const [url, out] = process.argv.slice(2);
fs.appendFileSync(process.env.FAKE_DOWNLOAD_LOG, url + "\\n");
await new Promise((r) => setTimeout(r, Number(process.env.FAKE_DOWNLOAD_MS || 0)));
fs.copyFileSync(url, out);
if (process.env.FAKE_DOWNLOAD_CORRUPT) fs.appendFileSync(out, "x");
`,
);
const PAYLOAD84 = buildAsar(
  path.join(T, "source", "payload-0.84.0.asar"),
  "0.84.0",
  MAIN,
);
const PAYLOAD85 = buildAsar(
  path.join(T, "source", "payload-0.85.0.asar"),
  "0.85.0",
  MAIN,
);
const PAYLOAD_BAD = buildAsar(
  path.join(T, "source", "payload-bad.asar"),
  "0.84.0",
  MAIN + "// other bytes\n",
);
const PIN = path.join(T, "pin.json");
write(
  PIN,
  JSON.stringify({
    version: "0.84.0",
    url: INSTALLER,
    sha512: sha512(INSTALLER),
    size: fs.statSync(INSTALLER).size,
    electron: null,
    asarSha256: sha256(PAYLOAD84),
    patches: ["updater-block", "fix"],
    checkedAt: "2026-11-12T00:00:00Z",
  }),
);

// One world per case: an install folder, a data folder, a home, logs and the running-process file.
function world(
  name,
  { version = "0.83.0", blocked = false, running = false } = {},
) {
  const root = path.join(T, name),
    install = path.join(root, "Programs", "Nimbalyst"),
    res = path.join(install, "resources");
  buildAsar(path.join(res, "app.asar"), version, blocked ? MAIN_BLOCKED : MAIN);
  fakeExe(path.join(install, "Nimbalyst.exe"));
  const w = {
    root,
    install,
    res,
    asar: path.join(res, "app.asar"),
    data: path.join(root, "data"),
    home: path.join(root, "home"),
    runningFile: path.join(root, "running.txt"),
    installerLog: path.join(root, "installer.log"),
    downloadLog: path.join(root, "download.log"),
  };
  fs.mkdirSync(w.home, { recursive: true });
  w.setRunning = (on) =>
    on
      ? write(w.runningFile, path.join(install, "Nimbalyst.exe") + "\n")
      : fs.rmSync(w.runningFile, { force: true });
  w.setRunning(running);
  w.staged = () => readJson(path.join(w.data, "staged.json"));
  w.status = () => readJson(path.join(w.data, "status.json"));
  w.installerRuns = () =>
    fs.existsSync(w.installerLog)
      ? fs
          .readFileSync(w.installerLog, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  w.downloads = () =>
    fs.existsSync(w.downloadLog)
      ? fs.readFileSync(w.downloadLog, "utf8").trim().split("\n").length
      : 0;
  w.env = (extra = {}) => ({
    ...process.env,
    NIMBALYST_FOLLOW: "",
    USERPROFILE: w.home,
    HOME: w.home,
    NIMBALYST_DELIVER_DATA: w.data,
    NIMBALYST_DELIVER_APP: install,
    NIMBALYST_DELIVER_PIN: PIN,
    NIMBALYST_DELIVER_PATCHES: PATCHES,
    NIMBALYST_DELIVER_DOWNLOAD: DOWNLOAD,
    NIMBALYST_DELIVER_RUN_WITH: process.execPath,
    NIMBALYST_DELIVER_RUNNING: w.runningFile,
    NIMBALYST_DELIVER_QUIT_WAIT_MS: "600",
    NIMBALYST_PATCH_PROGRAM_DIRS: "",
    FAKE_INSTALLER_LOG: w.installerLog,
    FAKE_DOWNLOAD_LOG: w.downloadLog,
    FAKE_INSTALL_DIR: install,
    FAKE_PAYLOAD: PAYLOAD84,
    ...extra,
  });
  w.run = (flag, extra) => {
    const r = spawnSync(process.execPath, [DELIVER, flag], {
      encoding: "utf8",
      env: w.env(extra),
    });
    return { code: r.status, out: (r.stdout + r.stderr).trim() };
  };
  // --stage returns at once and hands a download or an install to a run of its own: --wait waits for that run
  w.stage = (extra) => ({
    ...w.run("--stage", extra),
    waited: w.run("--wait", extra).code,
  });
  w.line = (extra) => w.run("--status", extra).out;
  w.log = () =>
    fs.existsSync(path.join(w.data, "deliver.log"))
      ? fs.readFileSync(path.join(w.data, "deliver.log"), "utf8")
      : "";
  return w;
}
const patchedText = (f) =>
  fs.readFileSync(f, "utf8").includes('updater: "off"') &&
  fs.readFileSync(f, "utf8").includes('label: "Changed"');
// command lines of live processes that mention the test folder (a waiter left behind would show here)
function leftBehind() {
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      `Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -like '*${T}*' -and $_.ProcessId -ne $PID } | ForEach-Object { $_.CommandLine }`,
    ],
    { encoding: "utf8" },
  );
  if (r.status !== 0) throw new Error(`process list failed: ${r.stderr}`);
  return r.stdout.trim();
}

try {
  let r, w;
  const ARGS = JSON.stringify(["--updated", "/S", "--currentuser"]);
  const settle = async (fn) => {
    let v;
    for (let i = 0; i < 30 && (v = fn()) !== ""; i++)
      await new Promise((res) => setTimeout(res, 100));
    return v;
  };

  // 1. stage with the app closed: --stage returns at once, its own run downloads, installs and patches
  w = world("closed");
  r = w.stage();
  check(
    "closed app: --stage installs with the silent per-user arguments, no --force-run",
    r.code === 0 &&
      r.waited === 0 &&
      w.installerRuns().length === 1 &&
      JSON.stringify(w.installerRuns()[0]) === ARGS,
    `${r.out}\n${JSON.stringify(w.installerRuns())}\n${w.log()}`,
  );
  check(
    "closed app: the new version is in and patched, staged job, installer and lock gone",
    asarVersion(w.asar) === "0.84.0" &&
      patchedText(w.asar) &&
      !w.staged() &&
      !fs.existsSync(path.join(w.data, "staged")) &&
      !fs.existsSync(path.join(w.data, "download.lock")),
    w.log(),
  );
  check(
    "closed app: status.json ok with the applied patches",
    JSON.stringify(
      w.status() && [w.status().ok, w.status().version, w.status().patches],
    ) === JSON.stringify([true, "0.84.0", ["updater-block", "fix"]]),
    JSON.stringify(w.status()),
  );
  check(
    "closed app: --status says on",
    w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    w.line(),
  );
  r = w.stage();
  check(
    "closed app: a second --stage has nothing to do",
    r.code === 0 && w.installerRuns().length === 1 && w.downloads() === 1,
    w.log(),
  );

  // 2. stage with an unpatched app running: stays staged, no waiting process; --install-now finishes it
  w = world("unpatched-running", { running: true });
  r = w.stage();
  const job = w.staged();
  check(
    "unpatched running app: staged with the installer, node and this script, nothing installed",
    r.code === 0 &&
      job?.version === "0.84.0" &&
      fs.existsSync(job.installer ?? "") &&
      job.node === process.execPath &&
      path.resolve(job.deliver).toLowerCase() ===
        path.resolve(DELIVER).toLowerCase() &&
      w.installerRuns().length === 0 &&
      asarVersion(w.asar) === "0.83.0",
    `${r.out}\n${JSON.stringify(job)}`,
  );
  check(
    "unpatched running app: --status says restart to finish",
    w.line() === "nimbalyst: restart to finish: 0.83.0 -> 0.84.0, 2 fixes",
    w.line(),
  );
  const behind = await settle(leftBehind);
  check("unpatched running app: no process left behind", behind === "", behind);
  r = w.run("--install-now");
  check(
    "--install-now while the app still runs: exit 1, error in status.json, job kept",
    r.code === 1 &&
      /still running/.test(w.status()?.error) &&
      w.staged() &&
      w.installerRuns().length === 0,
    JSON.stringify(w.status()),
  );
  check(
    "a failed try is named after the staged job's line",
    /^nimbalyst: restart to finish: 0\.83\.0 -> 0\.84\.0, 2 fixes \(the last try failed: Nimbalyst is still running/.test(
      w.line(),
    ),
    w.line(),
  );
  w.setRunning(false);
  r = w.run("--install-now");
  check(
    "--install-now with the app closed: installs and patches, status on",
    r.code === 0 &&
      asarVersion(w.asar) === "0.84.0" &&
      patchedText(w.asar) &&
      !w.staged() &&
      w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    `${r.out}\n${w.line()}\n${w.log()}`,
  );

  // 3. stage with a patched app running: installs when it closes; reopened, --after-quit gives up
  w = world("patched-running", { blocked: true, running: true });
  r = w.stage();
  check(
    "patched running app: staged, --status says it installs when Nimbalyst closes",
    r.code === 0 &&
      w.staged()?.installer &&
      w.line() === "nimbalyst: 0.84.0 installs when Nimbalyst closes",
    `${r.out}\n${w.line()}`,
  );
  r = w.run("--after-quit");
  check(
    "app reopened: --after-quit gives up quietly, job kept, nothing installed",
    r.code === 0 &&
      w.staged() &&
      w.installerRuns().length === 0 &&
      /next close tries again/.test(w.log()),
    `${r.out}\n${w.log()}`,
  );
  w.setRunning(false);
  r = w.run("--after-quit");
  check(
    "app closed: --after-quit installs and patches",
    r.code === 0 &&
      asarVersion(w.asar) === "0.84.0" &&
      patchedText(w.asar) &&
      !w.staged(),
    `${r.out}\n${w.log()}`,
  );

  // 4. off: off.json and NIMBALYST_FOLLOW=off (any case; environment and settings.json) do nothing
  w = world("off");
  r = w.run("--off");
  check(
    "--off on an app with nothing patched: off.json written, prints off",
    r.code === 0 &&
      r.out === "nimbalyst: off" &&
      fs.existsSync(path.join(w.data, "off.json")),
    r.out,
  );
  r = w.stage();
  check(
    "off.json: --stage does nothing",
    r.code === 0 &&
      !w.staged() &&
      w.downloads() === 0 &&
      w.installerRuns().length === 0 &&
      w.line() === "nimbalyst: off",
    w.log(),
  );
  // --on starts a real delivery: the line it prints is the run it started, not a guess
  r = w.run("--on");
  check(
    "--on: off.json gone, a delivery starts and the line says getting",
    r.code === 0 &&
      !fs.existsSync(path.join(w.data, "off.json")) &&
      r.out === "nimbalyst: getting 0.84.0",
    r.out,
  );
  w.run("--wait");
  check(
    "--on: the delivery it started installs and patches",
    asarVersion(w.asar) === "0.84.0" &&
      patchedText(w.asar) &&
      w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    `${w.line()}\n${w.log()}`,
  );
  w = world("off-env");
  r = w.stage({ NIMBALYST_FOLLOW: "OFF" });
  check(
    "NIMBALYST_FOLLOW=OFF: --stage does nothing",
    r.code === 0 &&
      !w.staged() &&
      w.downloads() === 0 &&
      w.line({ NIMBALYST_FOLLOW: "OFF" }) === "nimbalyst: off",
    w.log(),
  );
  write(
    path.join(w.home, ".claude", "settings.json"),
    JSON.stringify({ env: { NIMBALYST_FOLLOW: "Off" } }),
  );
  r = w.stage();
  check(
    "NIMBALYST_FOLLOW=Off in settings.json: --stage does nothing",
    r.code === 0 &&
      !w.staged() &&
      w.downloads() === 0 &&
      w.line() === "nimbalyst: off",
    w.log(),
  );

  // 4b. --off on a patched, closed app: the original app.asar is back at once, so Nimbalyst updates itself again
  w = world("off-closed");
  w.stage();
  r = w.run("--off");
  check(
    "--off, app closed: the original app.asar is back, no backup, no marker, no job",
    r.code === 0 &&
      r.out ===
        "nimbalyst: off; the original Nimbalyst is back and updates itself again" &&
      sha256(w.asar) === sha256(PAYLOAD84) &&
      !fs.existsSync(`${w.asar}.orig`) &&
      !fs.existsSync(path.join(w.res, "ai-coding-setup-patched.json")) &&
      !w.staged() &&
      w.line() === "nimbalyst: off",
    `${r.out}\n${w.log()}`,
  );
  r = w.run("--on");
  check(
    "--on after --off: a delivery starts again",
    r.code === 0 && r.out === "nimbalyst: getting 0.84.0",
    r.out,
  );
  w.run("--wait");
  check(
    "--on after --off: patched again, no new download",
    patchedText(w.asar) &&
      w.downloads() === 1 &&
      w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    `${w.line()}\n${w.log()}`,
  );

  // 4c. --off on a patched, running app: a restore job that the next close carries out
  w = world("off-running");
  w.stage();
  w.setRunning(true);
  r = w.run("--off");
  const offLine =
    "nimbalyst: off; the original Nimbalyst comes back when it next closes, then it updates itself again";
  check(
    "--off, app running: a restore job for the quit listener, app untouched",
    r.code === 0 &&
      r.out === offLine &&
      w.staged()?.restore === true &&
      w.staged()?.node === process.execPath &&
      patchedText(w.asar) &&
      w.line() === offLine,
    `${r.out}\n${JSON.stringify(w.staged())}`,
  );
  r = w.stage();
  check(
    "--off, app running: --stage leaves the restore job",
    r.code === 0 && w.staged()?.restore === true && w.downloads() === 1,
    w.log(),
  );
  w.setRunning(false);
  r = w.run("--after-quit");
  check(
    "--off, app closed afterwards: --after-quit puts the original back",
    r.code === 0 &&
      sha256(w.asar) === sha256(PAYLOAD84) &&
      !fs.existsSync(`${w.asar}.orig`) &&
      !w.staged() &&
      w.line() === "nimbalyst: off",
    `${r.out}\n${w.log()}`,
  );

  // 5. hash mismatches are refused; the error stays until a new attempt starts
  w = world("bad-download");
  r = w.stage({ FAKE_DOWNLOAD_CORRUPT: "1" });
  check(
    "download not matching the pin: refused, nothing staged, installer not run, file deleted",
    r.code === 0 &&
      !w.staged() &&
      w.installerRuns().length === 0 &&
      !fs.existsSync(path.join(w.data, "staged", "Nimbalyst-0.84.0.exe")) &&
      asarVersion(w.asar) === "0.83.0",
    `${r.out}\n${w.log()}`,
  );
  check(
    "download not matching: --status says failed and how to retry",
    /^nimbalyst: failed: the download of 0\.84\.0 does not match the pin .*; run \/update-setup to retry$/.test(
      w.line(),
    ),
    w.line(),
  );
  r = w.run("--stage", { FAKE_DOWNLOAD_MS: "1500" });
  check(
    "a new --stage clears the old failure before it returns: the line says getting at once",
    r.code === 0 && !w.status() && w.line() === "nimbalyst: getting 0.84.0",
    `${w.line()}\n${JSON.stringify(w.status())}`,
  );
  w.run("--wait");
  check(
    "the retry installs and patches",
    w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    `${w.line()}\n${w.log()}`,
  );
  w = world("bad-asar");
  r = w.stage({ FAKE_PAYLOAD: PAYLOAD_BAD });
  check(
    "app.asar after install not matching asarSha256: refused, not patched, failed status, job and installer kept",
    r.code === 0 &&
      !patchedText(w.asar) &&
      /does not match the checked hash/.test(w.status()?.error) &&
      fs.existsSync(w.staged()?.installer ?? ""),
    `${r.out}\n${JSON.stringify(w.status())}`,
  );

  // 5b. the status line tells the truth when nothing is staged and nothing runs
  w = world("not-staged");
  check(
    "nothing staged, nothing running: --status says not staged",
    w.line() ===
      "nimbalyst: not staged: 0.83.0 -> 0.84.0; run /update-setup to get it",
    w.line(),
  );
  w = world("not-staged-fixes", { version: "0.84.0" });
  check(
    "the pin is in without its fixes: --status says not staged",
    w.line() ===
      "nimbalyst: not staged: 0.84.0 is in without every fix; run /update-setup to get them",
    w.line(),
  );

  // 5c. a job for an older pin goes before --stage returns
  w = world("old-job", { running: true });
  const oldInst = path.join(w.data, "staged", "Nimbalyst-0.83.5.exe");
  write(oldInst, "old");
  write(
    path.join(w.data, "staged.json"),
    JSON.stringify({
      version: "0.83.5",
      installer: oldInst,
      node: process.execPath,
      deliver: DELIVER,
      at: new Date().toISOString(),
    }),
  );
  r = w.run("--stage", { FAKE_DOWNLOAD_MS: "1500" });
  check(
    "an old job is dropped before --stage returns: the line says getting the pin",
    r.code === 0 &&
      !fs.existsSync(oldInst) &&
      w.staged() === null &&
      w.line() === "nimbalyst: getting 0.84.0",
    `${w.line()}\n${JSON.stringify(w.staged())}`,
  );
  w.run("--wait");
  check(
    "then the pin's job is staged",
    w.staged()?.version === "0.84.0",
    JSON.stringify(w.staged()),
  );

  // 6. patch-only job: the pinned version is in but not patched
  w = world("patch-only", { version: "0.84.0", running: true });
  r = w.run("--stage");
  check(
    "patch-only, app running: a job with no installer, no download, written before --stage returns",
    r.code === 0 && w.staged()?.installer === null && w.downloads() === 0,
    JSON.stringify(w.staged()),
  );
  w.setRunning(false);
  r = w.stage();
  check(
    "patch-only, app closed: patched, no installer run, status on",
    r.code === 0 &&
      patchedText(w.asar) &&
      w.installerRuns().length === 0 &&
      w.downloads() === 0 &&
      !w.staged() &&
      w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    `${r.out}\n${w.line()}\n${w.log()}`,
  );

  // 7. installed newer than the pin: nothing changes
  w = world("newer", { version: "0.85.0" });
  const before = sha256(w.asar);
  r = w.stage();
  check(
    "installed newer than the pin: nothing downloaded, installed or patched",
    r.code === 0 &&
      w.downloads() === 0 &&
      w.installerRuns().length === 0 &&
      sha256(w.asar) === before,
    w.log(),
  );
  check(
    "installed newer: --status says so",
    w.line() ===
      "nimbalyst: 0.85.0 is newer than the setup has checked (0.84.0)",
    w.line(),
  );
  // 8. an override (trial) job: a version newer than the pin, checked against its own asarSha256
  w = world("override", { blocked: true, running: true });
  const overrideJob = () => {
    const inst = path.join(w.data, "staged", "Nimbalyst-0.85.0.exe");
    write(inst, fs.readFileSync(INSTALLER));
    write(
      path.join(w.data, "staged.json"),
      JSON.stringify({
        version: "0.85.0",
        installer: inst,
        node: process.execPath,
        deliver: DELIVER,
        at: new Date().toISOString(),
        override: true,
        asarSha256: sha256(PAYLOAD85),
      }),
    );
  };
  overrideJob();
  r = w.run("--stage", { FAKE_PAYLOAD: PAYLOAD85 });
  check(
    "override job, app running: --stage keeps it, no download, installs when Nimbalyst closes",
    r.code === 0 &&
      w.staged()?.override === true &&
      w.staged()?.version === "0.85.0" &&
      w.downloads() === 0 &&
      w.line() === "nimbalyst: 0.85.0 installs when Nimbalyst closes",
    `${r.out}\n${w.line()}\n${w.log()}`,
  );
  w.setRunning(false);
  r = w.stage({ FAKE_PAYLOAD: PAYLOAD85 });
  check(
    "override job, app closed: installs 0.85.0 and patches, status.json keeps override",
    r.code === 0 &&
      asarVersion(w.asar) === "0.85.0" &&
      patchedText(w.asar) &&
      w.status()?.override === true &&
      w.status()?.ok === true &&
      !w.staged(),
    `${r.out}\n${JSON.stringify(w.status())}\n${w.log()}`,
  );
  check(
    "override installed: --status says trial",
    w.line() === "nimbalyst: on, 0.85.0 (trial; pin 0.84.0), 2 fixes applied",
    w.line(),
  );
  r = w.stage();
  check(
    "a later --stage keeps the trial: no download, no install",
    r.code === 0 &&
      w.downloads() === 0 &&
      w.installerRuns().length === 1 &&
      asarVersion(w.asar) === "0.85.0" &&
      w.line() === "nimbalyst: on, 0.85.0 (trial; pin 0.84.0), 2 fixes applied",
    `${w.line()}\n${w.log()}`,
  );
  overrideJob();
  r = w.run("--unstage");
  check(
    "--unstage clears an override job and its installer",
    r.code === 0 && !w.staged() && !fs.existsSync(path.join(w.data, "staged")),
    r.out,
  );

  // 9. per-machine install: nothing changes
  w = world("per-machine");
  const pm = { NIMBALYST_PATCH_PROGRAM_DIRS: path.join(w.root, "Programs") };
  const pmBefore = sha256(w.asar);
  r = w.stage(pm);
  check(
    "per-machine install: --stage changes nothing",
    r.code === 0 &&
      w.downloads() === 0 &&
      !w.staged() &&
      sha256(w.asar) === pmBefore,
    w.log(),
  );
  check(
    "per-machine install: --status says can't patch here",
    w.line(pm) ===
      "nimbalyst: can't patch here: Nimbalyst is installed for all users",
    w.line(pm),
  );

  // 10. the installer exits non-zero: the job and its installer stay, the retry needs no new download
  w = world("installer-fails");
  r = w.stage({ FAKE_INSTALLER_EXIT: "3" });
  check(
    "installer exit 3: failed status, job and installer kept, old app untouched",
    r.code === 0 &&
      fs.existsSync(w.staged()?.installer ?? "") &&
      asarVersion(w.asar) === "0.83.0" &&
      w.line() ===
        "nimbalyst: restart to finish: 0.83.0 -> 0.84.0, 2 fixes (the last try failed: the installer of 0.84.0 exited with code 3)",
    `${r.out}\n${w.line()}`,
  );
  r = w.run("--install-now", { FAKE_INSTALLER_EXIT: "5" });
  check(
    "installer exit 5: --install-now exit 1 with the error in status.json",
    r.code === 1 &&
      w.status()?.ok === false &&
      /exited with code 5/.test(w.status()?.error),
    `${r.out}\n${JSON.stringify(w.status())}`,
  );
  r = w.run("--install-now");
  check(
    "the retry uses the kept installer: installed and patched, one download",
    r.code === 0 &&
      w.downloads() === 1 &&
      w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    `${r.out}\n${w.line()}`,
  );

  // 10b. a patch run that fails after a checked install keeps a patch-only job for the next close
  const BAD_PATCHES = path.join(T, "bad-patches");
  write(
    path.join(BAD_PATCHES, "updater-block.mjs"),
    `export default { id: "updater-block", files: /^out\\/main\\/index\\.js$/, upstream: null, requiredFirst: true,
  edits: [{ anchor: 'updater: "on"', replace: 'updater: "off" +' }] };\n`,
  );
  w = world("patch-fails");
  r = w.stage({ NIMBALYST_DELIVER_PATCHES: BAD_PATCHES });
  check(
    "patch run fails after the install: a patch-only job stays, the installer goes, the error is named",
    asarVersion(w.asar) === "0.84.0" &&
      !patchedText(w.asar) &&
      w.staged()?.installer === null &&
      !fs.existsSync(path.join(w.data, "staged")) &&
      /^nimbalyst: restart to finish: 0\.84\.0 -> 0\.84\.0, 2 fixes \(the last try failed: patching: /.test(
        w.line(),
      ),
    `${w.line()}\n${JSON.stringify(w.staged())}`,
  );
  r = w.run("--install-now");
  check(
    "the next try patches without a new install",
    r.code === 0 &&
      w.installerRuns().length === 1 &&
      w.line() === "nimbalyst: on, 0.84.0, 2 fixes applied",
    `${r.out}\n${w.line()}`,
  );

  // 10c. a failed install after a quit that leaves no Nimbalyst.exe: a message on the screen
  w = world("quit-broken", { blocked: true, running: true });
  w.stage();
  w.setRunning(false);
  fs.rmSync(path.join(w.install, "Nimbalyst.exe"));
  const messages = path.join(w.root, "messages.jsonl");
  r = w.run("--after-quit", {
    FAKE_INSTALLER_EXIT: "4",
    NIMBALYST_DELIVER_MESSAGE_FILE: messages,
  });
  const shown = fs.existsSync(messages)
    ? fs
        .readFileSync(messages, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    : [];
  check(
    "--after-quit, install failed and Nimbalyst.exe gone: one message names the error and the retry, the job stays",
    r.code === 1 &&
      shown.length === 1 &&
      /exited with code 4/.test(shown[0].text) &&
      /Nimbalyst\.exe is missing/.test(shown[0].text) &&
      /\/update-setup/.test(shown[0].text) &&
      fs.existsSync(w.staged()?.installer ?? ""),
    `${r.out}\n${JSON.stringify(shown)}`,
  );

  // 11. --wait returns when a running download has ended
  w = world("wait", { running: true });
  const child = spawn(process.execPath, [DELIVER, "--stage"], {
    env: w.env({ FAKE_DOWNLOAD_MS: "2000" }),
    stdio: "ignore",
  });
  const childDone = new Promise((res) => child.on("exit", res));
  const lock = path.join(w.data, "download.lock");
  for (let i = 0; i < 100 && !fs.existsSync(lock); i++)
    await new Promise((res) => setTimeout(res, 50));
  check(
    "download running: --status says getting",
    w.line() === "nimbalyst: getting 0.84.0",
    w.line(),
  );
  const t0 = Date.now();
  r = w.run("--wait");
  check(
    "--wait returns after the download ended, the job is staged",
    r.code === 0 &&
      Date.now() - t0 > 300 &&
      !fs.existsSync(lock) &&
      w.staged()?.version === "0.84.0",
    `${r.code} ${Date.now() - t0} ms ${JSON.stringify(w.staged())}`,
  );
  await childDone;
  r = w.run("--wait");
  check("--wait with no download running returns at once", r.code === 0, r.out);

  // 12. not installed, bad usage
  w = world("none");
  fs.rmSync(w.install, { recursive: true });
  r = w.stage();
  check(
    "not installed: --status says so, --stage does nothing",
    r.code === 0 &&
      w.line() === "nimbalyst: not installed" &&
      w.downloads() === 0,
    `${r.out}\n${w.line()}`,
  );
  r = w.run("--bogus");
  check(
    "unknown option: exit 2",
    r.code === 2 && /unknown option --bogus/.test(r.out),
    r.out,
  );
} finally {
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exitCode = failed ? 1 : 0;
