// Tests for the phone's Start button on the PC (skills/phone-bot/pc/actions/pc.mjs, nimbalyst.start), not in dry
// mode. Nimbalyst.exe runs but has no endpoint file (it was deleted, so the phone reads "closed"): Start must refuse
// and start no second copy, since a second copy quits at once and the phone would then read "failed". The stand-in
// Nimbalyst.exe is a copy of node in a temp %LOCALAPPDATA%\Programs\Nimbalyst, kept waiting. Windows only.
// Run: node tests/test-phone-pc-start.mjs
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 400);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== "win32") {
  console.log("skip: Start is offered on Windows only");
  process.exit(0);
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-pc-start-"));
const home = path.join(tmp, "home");
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
});
const exe = path.join(
  process.env.LOCALAPPDATA,
  "Programs",
  "Nimbalyst",
  "Nimbalyst.exe",
);
fs.mkdirSync(path.dirname(exe), { recursive: true });
fs.copyFileSync(process.execPath, exe);
// Another Nimbalyst.exe of this user (the real one, open on this PC) makes Start refuse whether or not the stand-in
// runs, so the "already runs" case cannot show anything then and is skipped. It is looked up before the stand-in starts.
const otherNimbalyst = execFileSync(
  path.win32.join(process.env.SystemRoot, "System32", "tasklist.exe"),
  ["/FI", "IMAGENAME eq Nimbalyst.exe", "/FO", "CSV", "/NH"],
  { encoding: "utf8", windowsHide: true },
)
  .split(/\r?\n/)
  .some((l) => l.trim().toLowerCase().startsWith('"nimbalyst.exe",'));
// Nimbalyst running: the stand-in waits a minute; with no arguments a copy quits at once, as a second Nimbalyst does.
const running = otherNimbalyst
  ? null
  : spawn(exe, ["-e", "setTimeout(() => {}, 60000)"], {
      stdio: "ignore",
      windowsHide: true,
    });
// "up" once the OS made the stand-in (the process list Start reads has it), else why it did not start
let standIn = "starting";
running?.once("spawn", () => (standIn = "up"));
running?.once("error", (e) => (standIn = `did not start: ${e.message}`));

const { createRegistry } = await import(
  "../skills/phone-bot/pc/core/registry.mjs"
);
const { register } = await import("../skills/phone-bot/pc/actions/pc.mjs");
const registry = createRegistry();
register(registry);
const pushed = [];
const ctx = {
  page: "ok",
  device: "dev-test",
  setupVersion: "0.0.0",
  push: (e) => pushed.push(e),
};
let rn = 0;
const ask = (a, d = {}) =>
  registry.handle({ k: "req", id: `r-${++rn}`, a, d }, ctx);

let failure = null;
try {
  if (otherNimbalyst)
    console.log(
      "skip: Start while Nimbalyst.exe runs: another Nimbalyst.exe of this user runs on this PC, so a refusal would not show the stand-in was found",
    );
  else {
    // The stand-in must still run when Start asks, or the refusal would rest on nothing.
    for (
      const end = Date.now() + 20000;
      standIn === "starting";
      await sleep(50)
    )
      if (Date.now() > end) standIn = "no spawn event within 20 s";
    if (standIn !== "up")
      throw new Error(`the Nimbalyst.exe stand-in ${standIn}`);
    const before = await ask("pc.status");
    const standInRuns = running.exitCode === null && running.pid !== undefined;
    const start = await ask("nimbalyst.start");
    // A second copy that was started quits within a second; the start's watch then marks the start failed.
    await sleep(3000);
    const after = await ask("pc.status");
    check(
      "Start while Nimbalyst.exe runs with no endpoint is refused, and the phone still reads closed, not failed",
      standInRuns &&
        before.d?.nimbalyst === "closed" &&
        start.ok === false &&
        start.err === "nimbalyst-running" &&
        after.d?.nimbalyst === "closed",
      show({
        standInRuns,
        before: before.d?.nimbalyst,
        start,
        after: after.d?.nimbalyst,
      }),
    );
    check(
      "the refusal tells the user to restart Nimbalyst on the PC",
      /restart Nimbalyst/i.test(start.message ?? ""),
      show(start),
    );
  }

  // ---- the check whether Nimbalyst.exe runs cannot run (no SystemRoot, or tasklist fails or times out): Start
  // starts the stand-in as before and logs why. tasklist is faked through child_process.execFile.
  const cp = createRequire(import.meta.url)("node:child_process");
  const realExecFile = cp.execFile;
  const fakeTasklist = (answer) => {
    cp.execFile = (file, args, opts, cb) =>
      /tasklist\.exe$/i.test(file)
        ? setImmediate(() => cb(...answer(args)))
        : realExecFile(file, args, opts, cb);
    syncBuiltinESMExports();
  };
  const realTasklist = () => {
    cp.execFile = realExecFile;
    syncBuiltinESMExports();
  };
  // The stand-in started with no arguments quits at once; the start's watch then marks the start failed.
  const startOnce = async () => {
    const n = pushed.length;
    const r = await ask("nimbalyst.start");
    for (let i = 0; r.ok && pushed.length === n && i < 50; i++)
      await sleep(200);
    return r;
  };
  const logged = (words) => {
    const file = path.join(home, ".phone-app", "pc.log");
    return fs.existsSync(file)
      ? fs
          .readFileSync(file, "utf8")
          .split("\n")
          .filter((l) => l.includes(words)).length
      : 0;
  };
  const systemRoot = process.env.SystemRoot;
  delete process.env.SystemRoot;
  let noRoot;
  try {
    noRoot = await startOnce();
  } finally {
    process.env.SystemRoot = systemRoot;
  }
  fakeTasklist(() => [new Error("Command failed: tasklist timed out")]);
  let noList;
  try {
    noList = await startOnce();
  } finally {
    realTasklist();
  }
  check(
    "when the running-check cannot run, Start starts Nimbalyst as before and logs why (FAIL: with no SystemRoot or a failing tasklist, Start fails where it used to work)",
    noRoot.ok === true &&
      noRoot.d?.state === "starting" &&
      noList.ok === true &&
      noList.d?.state === "starting" &&
      logged("could not check") >= 2,
    show({ noRoot, noList, logged: logged("could not check") }),
  );

  // ---- another user's Nimbalyst.exe (another Windows session on this PC) does not stop this user's Start; this
  // user's does. The fake tasklist lists one Nimbalyst.exe of `owner` and applies a USERNAME filter as tasklist does.
  const me = process.env.USERNAME || os.userInfo().username;
  const meFull = process.env.USERDOMAIN
    ? `${process.env.USERDOMAIN}\\${me}`
    : me;
  const tasklistOf = (owner) => (args) => {
    const user = args
      .filter((a, i) => args[i - 1] === "/FI" && /^USERNAME eq /i.test(a))
      .map((a) => a.replace(/^USERNAME eq /i, "").toLowerCase());
    const shown = user.every(
      (u) =>
        u === owner.toLowerCase() ||
        u === owner.split("\\").pop().toLowerCase(),
    );
    return [
      null,
      shown
        ? '"Nimbalyst.exe","4242","RDP-Tcp#1","2","200,000 K"\r\n'
        : "INFO: No tasks are running which match the specified criteria.\r\n",
      "",
    ];
  };
  let otherUser;
  let thisUser;
  try {
    fakeTasklist(tasklistOf("OTHERPC\\someone-else"));
    otherUser = await startOnce();
    fakeTasklist(tasklistOf(meFull));
    thisUser = await startOnce();
  } finally {
    realTasklist();
  }
  check(
    "another user's Nimbalyst.exe does not refuse Start, this user's does (FAIL: Start is refused while someone else on the PC runs Nimbalyst)",
    otherUser.ok === true &&
      otherUser.d?.state === "starting" &&
      thisUser.err === "nimbalyst-running",
    show({ otherUser, thisUser }),
  );
} catch (e) {
  failure = e;
} finally {
  if (running) {
    running.kill();
    await new Promise((r) =>
      running.exitCode === null ? running.once("exit", r) : r(),
    );
  }
}
if (failure) {
  console.log(`FAIL the run stopped: ${failure.stack}`);
  failed++;
}
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
console.log(`\n${pass} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
