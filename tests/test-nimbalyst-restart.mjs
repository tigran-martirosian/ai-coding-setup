#!/usr/bin/env node
// Tests for tools/nimbalyst-patch/restart.mjs, on a fake install folder in a temp folder (the same fake app,
// patches, installer and pin as test-nimbalyst-deliver.mjs) with a stand-in app process: a node script that is
// "running" while it keeps a line in the running-process file, and ends when a quit file appears (or, in one
// case, never by itself). A fake launcher stands in for every start restart.mjs makes. Nothing here touches the
// installed Nimbalyst, its processes or the real data folder. Windows only.
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TOOLS = path.join(import.meta.dirname, "..", "tools", "nimbalyst-patch");
const RESTART = path.join(TOOLS, "restart.mjs"),
  DELIVER = path.join(TOOLS, "deliver.mjs");
if (process.platform !== "win32") {
  console.log("skipped: restart.mjs is Windows only");
  process.exit(0);
}
const { QUIT_WORD } = await import(
  new URL("../tools/nimbalyst-patch/patches/updater-block.mjs", import.meta.url)
);
const T = fs.mkdtempSync(path.join(os.tmpdir(), "nimbalyst-restart-test-"));
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
};
const same = (a, b) =>
  path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();

// ---- the fake app (as in test-nimbalyst-deliver.mjs) ----
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
const patchedText = (f) =>
  fs.readFileSync(f, "utf8").includes('updater: "off"') &&
  fs.readFileSync(f, "utf8").includes('label: "Changed"');

// ---- shared fixtures: patches, installer, download, payload, pin, stand-in app, launcher ----
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
if (process.env.FAKE_INSTALLER_REMOVE_EXE) fs.rmSync(path.join(process.env.FAKE_INSTALL_DIR, "Nimbalyst.exe"));
if (code) process.exit(code);
fs.copyFileSync(process.env.FAKE_PAYLOAD, path.join(process.env.FAKE_INSTALL_DIR, "resources", "app.asar"));
`,
);
const DOWNLOAD = path.join(T, "fake-download.mjs");
write(
  DOWNLOAD,
  `import fs from "node:fs";
const [url, out] = process.argv.slice(2);
fs.copyFileSync(url, out);
`,
);
const PAYLOAD84 = buildAsar(
  path.join(T, "source", "payload-0.84.0.asar"),
  "0.84.0",
  MAIN,
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
// stand-in app: <running file> <line> <quit file> <obey|ignore>; ends by itself after 60 s at most
const STANDIN = path.join(T, "standin.cjs");
write(
  STANDIN,
  `const fs = require("fs");
const [runningFile, line, quitFile, mode] = process.argv.slice(2);
fs.writeFileSync(runningFile, line + "\\n");
const end = Date.now() + 60000;
setInterval(() => {
  if ((mode === "obey" && fs.existsSync(quitFile)) || Date.now() > end) { fs.rmSync(runningFile, { force: true }); process.exit(0); }
}, 50);
`,
);
// launcher: <kind> <cwd> <program> <args...>; logs each start; quit writes the quit file; self starts the program detached
const LAUNCHER = path.join(T, "launcher.mjs");
write(
  LAUNCHER,
  `import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
const [kind, cwd, program, ...args] = process.argv.slice(2);
const stagedThere = fs.existsSync(path.join(process.env.NIMBALYST_DELIVER_DATA, "staged.json"));
fs.appendFileSync(process.env.FAKE_LAUNCH_LOG, JSON.stringify({ kind, cwd, program, args, stagedThere }) + "\\n");
if (kind === "open" && process.env.FAKE_OPEN_FAILS) { console.error("the program would not start"); process.exit(5); }
if (kind === "quit") fs.writeFileSync(process.env.FAKE_QUIT_FILE, "quit");
if (kind === "self") spawn(program, args, { cwd, detached: true, stdio: "ignore", windowsHide: true }).unref();
`,
);

// One world per case: an install folder, a data folder, a home, logs, the running-process file and the stand-in.
const standins = [];
function world(name, { version = "0.83.0", blocked = false } = {}) {
  const root = path.join(T, name),
    install = path.join(root, "Programs", "Nimbalyst"),
    res = path.join(install, "resources");
  buildAsar(path.join(res, "app.asar"), version, blocked ? MAIN_BLOCKED : MAIN);
  fakeExe(path.join(install, "Nimbalyst.exe"));
  const w = {
    root,
    install,
    exe: path.join(install, "Nimbalyst.exe"),
    asar: path.join(res, "app.asar"),
    data: path.join(root, "data"),
    home: path.join(root, "home"),
    runningFile: path.join(root, "running.txt"),
    quitFile: path.join(root, "quit"),
    launchLog: path.join(root, "launch.log"),
    installerLog: path.join(root, "installer.log"),
    messageFile: path.join(root, "messages.log"),
  };
  fs.mkdirSync(w.home, { recursive: true });
  w.staged = () => readJson(path.join(w.data, "staged.json"));
  w.status = () => readJson(path.join(w.data, "status.json"));
  w.launches = () =>
    fs.existsSync(w.launchLog)
      ? fs
          .readFileSync(w.launchLog, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  w.messages = () =>
    fs.existsSync(w.messageFile)
      ? fs
          .readFileSync(w.messageFile, "utf8")
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l))
      : [];
  w.log = () =>
    fs.existsSync(path.join(w.data, "restart.log"))
      ? fs.readFileSync(path.join(w.data, "restart.log"), "utf8")
      : "";
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
    NIMBALYST_PATCH_PROGRAM_DIRS: "",
    NIMBALYST_RESTART_LAUNCH: LAUNCHER,
    NIMBALYST_RESTART_QUIT_WAIT_MS: "5000",
    NIMBALYST_RESTART_TRAY_WAIT_MS: "20000",
    FAKE_LAUNCH_LOG: w.launchLog,
    FAKE_QUIT_FILE: w.quitFile,
    FAKE_INSTALLER_LOG: w.installerLog,
    FAKE_INSTALL_DIR: install,
    FAKE_PAYLOAD: PAYLOAD84,
    NIMBALYST_DELIVER_MESSAGE_FILE: w.messageFile,
    ...extra,
  });
  w.deliver = (flag, extra) =>
    spawnSync(process.execPath, [DELIVER, flag], {
      encoding: "utf8",
      env: w.env(extra),
    });
  w.restart = (args, extra) => {
    const t = Date.now(),
      r = spawnSync(process.execPath, [RESTART, ...args], {
        encoding: "utf8",
        env: w.env(extra),
      });
    return {
      code: r.status,
      out: (r.stdout + r.stderr).trim(),
      ms: Date.now() - t,
    };
  };
  // the stand-in app; resolves once it is "running"
  w.start = async (mode = "obey") => {
    const c = spawn(
      process.execPath,
      [STANDIN, w.runningFile, w.exe, w.quitFile, mode],
      { stdio: "ignore", windowsHide: true },
    );
    standins.push(c);
    w.app = c;
    for (let i = 0; i < 100 && !fs.existsSync(w.runningFile); i++)
      await sleep(50);
    if (!fs.existsSync(w.runningFile))
      throw new Error("the stand-in app did not start");
  };
  w.appEnded = async () => {
    for (let i = 0; i < 100 && alive(w.app.pid); i++) await sleep(50);
    return !alive(w.app.pid);
  };
  return w;
}
const ok = (w) =>
  w.status()?.ok === true &&
  w.status()?.version === "0.84.0" &&
  JSON.stringify(w.status().patches) ===
    JSON.stringify(["updater-block", "fix"]);
const opened = (w) => w.launches().filter((l) => l.kind === "open");
const openedRight = (w) =>
  opened(w).length === 1 &&
  same(opened(w)[0].program, w.exe) &&
  same(opened(w)[0].cwd, w.install) &&
  opened(w)[0].args.length === 0;
// command lines of live processes that mention the test folder (a stand-in or a run left behind would show here)
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

  // 1. a patched app closes on the quit word, installs, patches, opens again
  w = world("patched", { blocked: true });
  await w.start();
  w.deliver("--stage");
  w.deliver("--wait");
  check(
    "patched: --stage with the app open leaves a staged job",
    w.staged()?.version === "0.84.0",
    JSON.stringify(w.staged()),
  );
  r = w.restart(["--run"]);
  const quits = w.launches().filter((l) => l.kind === "quit");
  check(
    "patched: the quit word goes to a second launch of Nimbalyst.exe from its own folder",
    quits.length === 1 &&
      same(quits[0].program, w.exe) &&
      same(quits[0].cwd, w.install) &&
      JSON.stringify(quits[0].args) === JSON.stringify([QUIT_WORD]),
    JSON.stringify(w.launches()),
  );
  check(
    "patched: staged.json is moved aside while the app closes (its quit listener installs nothing)",
    quits[0]?.stagedThere === false,
    JSON.stringify(quits),
  );
  check("patched: the stand-in app ended on the word", await w.appEnded());
  check(
    "patched: installed, patched, status ok, staged job gone",
    r.code === 0 &&
      asarVersion(w.asar) === "0.84.0" &&
      patchedText(w.asar) &&
      ok(w) &&
      !w.staged() &&
      !fs.existsSync(path.join(w.data, "restart-held.json")),
    `${r.code} ${r.out}\n${w.log()}`,
  );
  check(
    "patched: opened again, no arguments, from its own folder, after the install",
    openedRight(w) && w.launches().at(-1).kind === "open",
    JSON.stringify(w.launches()),
  );
  check(
    "patched: restart.log names each step",
    [
      "asking Nimbalyst to close",
      "every Nimbalyst process has ended",
      "--install-now done",
      "again",
    ].every((s) => w.log().includes(s)),
    w.log(),
  );

  // 2. an unpatched app: no word, waits for the user's tray Quit, then installs and opens again
  w = world("unpatched");
  await w.start();
  w.deliver("--stage");
  w.deliver("--wait");
  const t2 = Date.now();
  const run2 = spawn(process.execPath, [RESTART, "--run"], {
    stdio: "ignore",
    env: w.env(),
    windowsHide: true,
  });
  const done2 = new Promise((res) => run2.on("exit", (code) => res(code)));
  await sleep(2000);
  check(
    "unpatched: no quit word sent, still waiting while the app runs",
    w.launches().length === 0 &&
      alive(w.app.pid) &&
      run2.exitCode === null &&
      w.log().includes("waiting up to 20 s for a Quit from its tray icon"),
    `${JSON.stringify(w.launches())}\n${w.log()}`,
  );
  write(w.quitFile, "tray quit");
  const code2 = await done2;
  check(
    "unpatched: after the tray Quit it installs, patches and opens again",
    code2 === 0 &&
      asarVersion(w.asar) === "0.84.0" &&
      patchedText(w.asar) &&
      ok(w) &&
      openedRight(w) &&
      w.launches().every((l) => l.kind !== "quit") &&
      Date.now() - t2 < 15000,
    `${code2}\n${w.log()}`,
  );

  // 3. nothing staged: refuses with one line, starts nothing
  w = world("nothing", { blocked: true });
  r = w.restart([]);
  check(
    "nothing staged: one line, exit 1, nothing started",
    r.code === 1 &&
      r.out === "nimbalyst: not restarted: nothing is staged to install" &&
      w.launches().length === 0,
    `${r.code} ${r.out}`,
  );

  // 4. a download still running: refuses with one line, starts nothing (the lock's pid is this test, alive)
  w = world("downloading", { blocked: true });
  write(
    path.join(w.data, "staged.json"),
    JSON.stringify({
      version: "0.84.0",
      installer: null,
      node: process.execPath,
      deliver: DELIVER,
      at: new Date().toISOString(),
    }),
  );
  write(
    path.join(w.data, "download.lock"),
    JSON.stringify({
      pid: process.pid,
      version: "0.84.0",
      at: new Date().toISOString(),
    }),
  );
  r = w.restart([]);
  check(
    "download running: one line, exit 1, nothing started",
    r.code === 1 &&
      r.out ===
        "nimbalyst: not restarted: the download of Nimbalyst 0.84.0 is still running; run /update-setup again when it has ended" &&
      w.launches().length === 0,
    `${r.code} ${r.out}`,
  );
  r = w.restart(["--run"]);
  check(
    "download running: the run outside refuses too, nothing changed",
    r.code === 1 &&
      w.launches().length === 0 &&
      !w.status() &&
      w.log().includes("refused: the download"),
    w.log(),
  );

  // 5. the app does not close in time: nothing changed, the error in status, no process stopped
  w = world("stuck", { blocked: true });
  await w.start("ignore");
  w.deliver("--stage");
  w.deliver("--wait");
  const job5 = JSON.stringify(w.staged()),
    asar5 = sha256(w.asar);
  r = w.restart(["--run"], { NIMBALYST_RESTART_QUIT_WAIT_MS: "1500" });
  check(
    "stuck: exit 1, app.asar and the staged job unchanged, nothing installed or opened",
    r.code === 1 &&
      sha256(w.asar) === asar5 &&
      JSON.stringify(w.staged()) === job5 &&
      !fs.existsSync(w.installerLog) &&
      opened(w).length === 0 &&
      !fs.existsSync(path.join(w.data, "restart-held.json")),
    `${r.code}\n${w.log()}`,
  );
  check(
    "stuck: status.json holds the error in deliver.mjs's shape",
    w.status()?.ok === false &&
      w.status().version === "0.84.0" &&
      Array.isArray(w.status().patches) &&
      w.status().error ===
        "Nimbalyst did not close within 1.5 s of the quit request (1 process(es) still running): nothing changed",
    JSON.stringify(w.status()),
  );
  check(
    "stuck: the stand-in app is still running (nothing stopped by force)",
    alive(w.app.pid) && fs.existsSync(w.runningFile),
  );
  w.app.kill();
  await w.appEnded();

  // 6. a failed install still opens the app again
  w = world("install-fails", { blocked: true });
  await w.start();
  w.deliver("--stage");
  w.deliver("--wait");
  r = w.restart(["--run"], { FAKE_INSTALLER_EXIT: "3" });
  check(
    "failed install: exit 1, error in status, old version kept",
    r.code === 1 &&
      w.status()?.ok === false &&
      /exited with code 3/.test(w.status().error) &&
      asarVersion(w.asar) === "0.83.0",
    `${r.code} ${JSON.stringify(w.status())}\n${w.log()}`,
  );
  check(
    "failed install: Nimbalyst is opened again",
    openedRight(w) && w.log().includes("--install-now failed"),
    `${JSON.stringify(w.launches())}\n${w.log()}`,
  );
  check(
    "failed install: the job and its installer are kept for the next try, no message shown",
    w.staged()?.version === "0.84.0" &&
      fs.existsSync(w.staged().installer ?? "") &&
      w.messages().length === 0,
    `${JSON.stringify(w.staged())} ${JSON.stringify(w.messages())}`,
  );

  // 6b. a failed install that took Nimbalyst.exe away: a visible message names the error and the retry
  w = world("install-fails-no-exe", { blocked: true });
  await w.start();
  w.deliver("--stage");
  w.deliver("--wait");
  r = w.restart(["--run"], {
    FAKE_INSTALLER_EXIT: "3",
    FAKE_INSTALLER_REMOVE_EXE: "1",
  });
  const m6b = w.messages();
  check(
    "exe gone: exit 1, nothing opened, one message with the error and the retry command",
    r.code === 1 &&
      opened(w).length === 0 &&
      m6b.length === 1 &&
      /exited with code 3/.test(m6b[0].text) &&
      m6b[0].text.includes("/update-setup") &&
      m6b[0].text.includes("restart.mjs"),
    `${r.code} ${JSON.stringify(m6b)}\n${w.log()}`,
  );

  // 6c. Nimbalyst.exe is there but will not start again: a visible message
  w = world("reopen-fails", { blocked: true });
  await w.start();
  w.deliver("--stage");
  w.deliver("--wait");
  r = w.restart(["--run"], { FAKE_OPEN_FAILS: "1" });
  const m6c = w.messages();
  check(
    "reopen fails: installed, exit 1, one message saying to start it from the Start menu",
    r.code === 1 &&
      ok(w) &&
      m6c.length === 1 &&
      m6c[0].text.includes("Start menu") &&
      m6c[0].text.includes("/update-setup"),
    `${r.code} ${JSON.stringify(m6c)}\n${w.log()}`,
  );

  // 7. the app is not running: straight on (a patches-only job on the pinned version)
  w = world("closed", { version: "0.84.0" });
  write(
    path.join(w.data, "staged.json"),
    JSON.stringify({
      version: "0.84.0",
      installer: null,
      node: process.execPath,
      deliver: DELIVER,
      at: new Date().toISOString(),
    }),
  );
  r = w.restart(["--run"]);
  check(
    "not running: no word, patched, status ok, opened",
    r.code === 0 &&
      patchedText(w.asar) &&
      ok(w) &&
      openedRight(w) &&
      w.launches().length === 1 &&
      w.log().includes("Nimbalyst is not running"),
    `${r.code}\n${w.log()}`,
  );

  // 8. the plain start: starts itself again detached with --run, says one line, returns at once
  w = world("plain", { blocked: true });
  await w.start();
  w.deliver("--stage");
  w.deliver("--wait");
  r = w.restart([]);
  const self = w.launches()[0];
  check(
    "plain start: one line, exit 0",
    r.code === 0 &&
      r.out ===
        "nimbalyst: restarting: Nimbalyst closes now, the update and its fixes go in, and it opens again in about a minute",
    `${r.code} ${r.out}`,
  );
  check(
    "plain start: started itself again as node restart.mjs --run",
    self?.kind === "self" &&
      same(self.program, process.execPath) &&
      same(self.args[0], RESTART) &&
      self.args[1] === "--run" &&
      self.args.length === 2,
    JSON.stringify(w.launches()),
  );
  check(
    "plain start: returned before the run did its work",
    r.ms < 5000 && !opened(w).length,
    `${r.ms} ms`,
  );
  for (let i = 0; i < 200 && !w.log().includes("again\n"); i++)
    await sleep(100);
  check(
    "plain start: the detached run closed, installed, patched and opened again",
    (await w.appEnded()) && ok(w) && patchedText(w.asar) && openedRight(w),
    w.log(),
  );
  w = world("plain-unpatched");
  await w.start();
  w.deliver("--stage");
  w.deliver("--wait");
  r = w.restart([]);
  check(
    "plain start on an unpatched app asks for one tray Quit",
    r.code === 0 &&
      r.out ===
        "nimbalyst: quit Nimbalyst once from its tray icon (right-click, Quit); the update and its fixes then go in and it opens again in about a minute",
    r.out,
  );
  write(w.quitFile, "tray quit");
  for (let i = 0; i < 200 && !w.log().includes("again\n"); i++)
    await sleep(100);
  check(
    "plain start on an unpatched app: after the Quit it installs and opens again",
    ok(w) && openedRight(w) && !w.launches().some((l) => l.kind === "quit"),
    w.log(),
  );

  // 9. no process of the test left behind
  for (let i = 0; i < 50 && leftBehind(); i++) await sleep(100);
  check("no stand-in or run left behind", leftBehind() === "", leftBehind());
} finally {
  for (const c of standins) if (alive(c.pid)) c.kill();
  await sleep(300);
  fs.rmSync(T, { recursive: true, force: true });
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
