// Tests for voice (plan row C3): the record button's recording goes from the page to the PC in pieces through the
// sealed channel (phone/page/frame/channel.js sendStream, skills/phone-bot/pc/core/channel.mjs), the PC's
// voice.warm, voice.transcribe and voice.result (skills/phone-bot/pc/actions/voice.mjs) run a stand-in
// transcriber that speaks the real one's JSON lines, and the page's voice parts of the typing box
// (phone/page/screens/session-voice.js) put the text in the box unsent, or show the error and keep the recording.
// `setup.mjs voice`, the install and the update run in dry mode only; `setup.mjs voice --background` runs for real
// with a stand-in script (PHONE_PC_VOICE_SETUP) in place of the download. No speech model is downloaded, no
// winget runs and nothing real is transcribed.
// Run: node tests/test-phone-voice.mjs
import { ChildProcess, spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
import { createRequire, syncBuiltinESMExports } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PC = path.join(ROOT, "skills", "phone-bot", "pc");
const PAGE = path.join(ROOT, "phone", "page");

let pass = 0;
let failed = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : failed++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${extra}`}`);
};
const show = (v) => JSON.stringify(v)?.slice(0, 500);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 8000) {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() > end) return null;
    await sleep(20);
  }
}

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
// A Node script's output, run without blocking this process (the update asks a server in it).
const runNode = (args, env) =>
  new Promise((resolve) => {
    const c = spawn(process.execPath, args, { env, windowsHide: true });
    let out = "";
    c.stdout.on("data", (d) => (out += d));
    c.stderr.on("data", (d) => (out += d));
    c.on("close", () => resolve(out));
  });

// ---- the page's stand-ins: a DOM with what frame/dom.js and session-voice.js use, and a microphone whose
// recorder makes MP4 only (as iPhones before Safari 18.4) and gives `mic.next` as the recording on stop
class FakeNode {
  constructor() {
    this.childNodes = [];
  }
  append(...kids) {
    for (const k of kids)
      this.childNodes.push(k instanceof FakeNode ? k : new FakeText(String(k)));
  }
  replaceChildren(...kids) {
    this.childNodes = [];
    this.append(...kids);
  }
  get textContent() {
    return this.childNodes.map((c) => c.textContent).join("");
  }
}
class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.data = text;
  }
  get textContent() {
    return this.data;
  }
}
class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.tagName = tag;
    this.className = "";
    this.attrs = {};
    this.listeners = {};
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.style = {};
    this.focused = false;
    this.selectionStart = 0;
    this.selectionEnd = 0;
  }
  setAttribute(k, v) {
    this.attrs[k] = v;
  }
  addEventListener(type, fn) {
    (this.listeners[type] ||= []).push(fn);
  }
  click() {
    for (const fn of this.listeners.click || []) fn({ target: this });
  }
  focus() {
    this.focused = true;
  }
  blur() {
    this.focused = false;
  }
  setSelectionRange(from, to) {
    this.selectionStart = from;
    this.selectionEnd = to;
  }
}
const walk = (n, out = []) => {
  out.push(n);
  for (const c of n.childNodes) walk(c, out);
  return out;
};
// Whether `target` or a node holding it under `root` is hidden.
const hiddenIn = (root, target) => {
  const path = (n) => {
    if (n === target) return [n];
    for (const c of n.childNodes) {
      const p = path(c);
      if (p) return [n, ...p];
    }
    return null;
  };
  return (path(root) ?? []).some((n) => n.hidden);
};
const mic = { next: null };
function installPage() {
  class FakeRecorder {
    static isTypeSupported = (type) => type === "audio/mp4";
    constructor(_stream, { mimeType }) {
      this.mimeType = mimeType;
      this.listeners = {};
    }
    addEventListener(type, fn) {
      (this.listeners[type] ||= []).push(fn);
    }
    start() {}
    stop() {
      const data = new Blob([mic.next], { type: this.mimeType });
      setTimeout(() => {
        for (const fn of this.listeners.dataavailable) fn({ data });
        for (const fn of this.listeners.stop) fn({});
      }, 0);
    }
  }
  Object.assign(globalThis, {
    Node: FakeNode,
    document: {
      createElement: (tag) => new FakeElement(tag),
      createElementNS: (_ns, tag) => new FakeElement(tag),
      createTextNode: (text) => new FakeText(text),
    },
    MediaRecorder: FakeRecorder,
  });
  navigator.mediaDevices = {
    getUserMedia: async () => ({ getTracks: () => [{ stop() {} }] }),
  };
}

// ---- a temp home and temp folder, a stand-in uv on the PATH and the stand-in transcriber
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "phone-voice-"));
const home = path.join(tmp, "home");
const temp = path.join(tmp, "temp");
const bin = path.join(tmp, "bin");
for (const d of [home, temp, bin]) fs.mkdirSync(d, { recursive: true });
const fakeUv = path.join(bin, process.platform === "win32" ? "uv.exe" : "uv");
fs.writeFileSync(fakeUv, "");
const realPath = process.env.PATH;
const withUv = `${bin}${path.delimiter}${realPath}`;
const heardLog = path.join(tmp, "heard.jsonl");
// The real transcriber's lines: {"ready":true} once loaded, then {"text"} or {"error"} per {"file"}. A file that
// starts with FAIL has "no speech"; others are "heard" with their size and SHA-256, so the test sees the bytes.
const fakeTranscriber = path.join(tmp, "fake-transcriber.mjs");
fs.writeFileSync(
  fakeTranscriber,
  `import fs from "node:fs";
import { createHash } from "node:crypto";
import readline from "node:readline";
process.stdout.write(JSON.stringify({ ready: true }) + "\\n");
for await (const line of readline.createInterface({ input: process.stdin })) {
  const { file } = JSON.parse(line);
  fs.appendFileSync(process.env.FAKE_HEARD_LOG, JSON.stringify({ file, there: fs.existsSync(file), pid: process.pid }) + "\\n");
  const bytes = fs.readFileSync(file);
  while (bytes.subarray(0, 4).toString() === "HOLD" && !fs.existsSync(process.env.FAKE_RELEASE))
    await new Promise((r) => setTimeout(r, 20));
  const answer = bytes.subarray(0, 4).toString() === "FAIL"
    ? { error: "no speech found in the recording" }
    : { text: "heard " + bytes.length + " bytes " + createHash("sha256").update(bytes).digest("hex") };
  process.stdout.write(JSON.stringify(answer) + "\\n");
}
`,
);
Object.assign(process.env, {
  HOME: home,
  USERPROFILE: home,
  APPDATA: path.join(home, "AppData", "Roaming"),
  LOCALAPPDATA: path.join(home, "AppData", "Local"),
  TEMP: temp,
  TMP: temp,
  TMPDIR: temp,
  PATH: withUv,
  PHONE_PC_TEST: "1",
  PHONE_PC_TRANSCRIBER: fakeTranscriber,
  FAKE_HEARD_LOG: heardLog,
  FAKE_RELEASE: path.join(tmp, "release"),
});
const voiceDir = path.join(temp, "phone-app-voice");
const audioLeft = () =>
  fs.existsSync(voiceDir) ? fs.readdirSync(voiceDir) : [];
const heard = () =>
  fs.existsSync(heardLog)
    ? fs
        .readFileSync(heardLog, "utf8")
        .trim()
        .split("\n")
        .map((l) => JSON.parse(l))
    : [];

const seal = await import("../phone/shared/seal.mjs");
const { createChannel } = await import(
  pathToFileURL(path.join(PC, "core", "channel.mjs")).href
);
const { createRegistry } = await import(
  pathToFileURL(path.join(PC, "core", "registry.mjs")).href
);
const voice = await import(
  pathToFileURL(path.join(PC, "actions", "voice.mjs")).href
);
const pageChannel = await import(
  pathToFileURL(path.join(PAGE, "frame", "channel.js")).href
);

// ---- the PC's registry with the voice actions, its channel, and the page's channel session joined in this
// process: every frame the page sends goes to the PC's channel and back, sealed, with no relay between.
const registry = createRegistry();
voice.register(registry);
const K = seal.randomBytes(32);
const dev = seal.toB64u(seal.randomBytes(16));
const toPage = new Set();
const pageFrames = [];
const channel = createChannel({
  keys: { devices: [{ device: dev, K: seal.toB64u(K) }] },
  send: (f) =>
    setImmediate(() => {
      for (const fn of [...toPage]) fn(f);
    }),
  registry,
  context: () => ({ page: "ok", setupVersion: "0.0.0" }),
  pcVersion: "0.0.0",
});
const link = {
  send(f) {
    pageFrames.push(f);
    setImmediate(() => channel.onApp(f));
  },
  listen(fn) {
    toPage.add(fn);
    return () => toPage.delete(fn);
  },
  next(match, ms) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        off();
        reject(new Error("no answer"));
      }, ms);
      const off = link.listen((f) => {
        if (!match(f)) return;
        clearTimeout(timer);
        off();
        resolve(f);
      });
    });
  },
  onClose: () => () => {},
  buffered: 0,
};

let failure = null;
try {
  const session = await pageChannel.openSession(link, {
    K,
    dev,
    pageVersion: "0.0.0",
    onEvent: () => {},
  });
  const ask = (a, d) => session.ask(a, d);

  // ---- voice.warm before the setup step: no uv, then no model
  // This PC's own PATH may hold a real uv: the no-uv case has an empty PATH.
  process.env.PATH = "";
  const noUv = await ask("voice.warm");
  process.env.PATH = withUv;
  const noModel = await ask("voice.warm");
  check(
    "voice.warm with no uv answers voice-not-set-up with the setup line",
    noUv.ok === false &&
      noUv.err === "voice-not-set-up" &&
      /uv/.test(noUv.message) &&
      /setup\.mjs voice$/.test(noUv.run),
    show(noUv),
  );
  check(
    "voice.warm with uv but no downloaded model answers voice-not-set-up",
    noModel.err === "voice-not-set-up" && /model/.test(noModel.message),
    show(noModel),
  );

  // ---- the setup step, dry: it names the model's size and the download line, and downloads nothing
  const dry = spawnSync(
    process.execPath,
    [path.join(PC, "setup.mjs"), "voice"],
    {
      encoding: "utf8",
      env: { ...process.env, PHONE_PC_DRY: "1" },
    },
  );
  const dryOut = `${dry.stdout}${dry.stderr}`;
  console.log(dryOut.trim().replace(/^/gm, "     | "));
  check(
    "setup.mjs voice (dry) says the model's size up front and would run the download line once",
    dry.status === 0 &&
      /speech model "small" \(about 480 MB\)/.test(dryOut) &&
      dryOut.includes("would run:") &&
      // A folder name with a space puts the script path in quotes
      /transcribe-server\.py"? --download/.test(dryOut) &&
      !fs.existsSync(voice.markerPath()),
    dryOut,
  );
  // The transcriber's Python packages come from the lock beside it, never resolved fresh: setup installs exactly the
  // lock, and each start finds the script's Python with no network.
  check(
    "setup.mjs voice (dry) installs the transcriber's locked packages, and each start is offline (FAIL: a voice start installs whatever package versions are newest)",
    fs.existsSync(`${voice.SERVER}.lock`) &&
      /uv(\.exe)?"? sync --script "?[^\n]*transcribe-server\.py"? --frozen\n/.test(
        dryOut,
      ) &&
      !dryOut.includes("--with") &&
      voice.FIND_PYTHON_ARGS?.join(" ") ===
        `python find --script ${voice.SERVER} --offline` &&
      /python"? -I "?[^\n]*transcribe-server\.py"? --download/.test(dryOut),
    dryOut,
  );
  // uv 0.6.10 is the first with `python find --script`; numbers compare as numbers (0.10 is newer than 0.6).
  const uvAnswers = {
    "uv 0.6.9 (8e5b5a3 2025-03-21)": false,
    "uv 0.5.31": false,
    "uv 0.6.10 (f2a2d982b 2025-03-25)": true,
    "uv 0.10.2": true,
    "uv 1.0.0": true,
    "error: unknown": false,
  };
  const uvWrong = Object.entries(uvAnswers).filter(
    ([line, ok]) => voice.uvNewEnough?.(line) !== ok,
  );
  check(
    "setup.mjs voice takes uv 0.6.10 or newer and updates an older one first (FAIL: an older uv without sync --script makes every voice setup fail)",
    uvWrong.length === 0 &&
      /uv(\.exe)?"? --version, then [^\n]*uv(\.exe)?"? self update when it is older than 0\.6\.10\n/.test(
        dryOut,
      ),
    show({ uvWrong, dryOut }),
  );
  const noUvOn = (platform) =>
    spawnSync(process.execPath, [path.join(PC, "setup.mjs"), "voice"], {
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: "",
        PHONE_PC_DRY: "1",
        PHONE_PC_PLATFORM: platform,
      },
    });
  const noUvWin = noUvOn("win32");
  check(
    "setup.mjs voice (dry) on Windows without uv installs uv with winget, then would run the download",
    noUvWin.status === 0 &&
      noUvWin.stdout.includes(
        "would run: winget install --id astral-sh.uv -e --source winget",
      ) &&
      /transcribe-server\.py"? --download/.test(noUvWin.stdout),
    `${noUvWin.stdout}${noUvWin.stderr}`,
  );
  const noUvSetup = noUvOn("linux");
  check(
    "setup.mjs voice without uv off Windows stops with a clear error",
    noUvSetup.status === 1 && /needs uv/.test(noUvSetup.stderr),
    noUvSetup.stderr,
  );

  // The voice setup runs hidden (--background), so every program it starts (winget, uv) gets no console window.
  // setup.mjs runs in a child process here, so its spawn options are read from the source: each spawn( and
  // spawnSync( call up to its closing "})" must hold windowsHide: true.
  const setupSrc = fs.readFileSync(path.join(PC, "setup.mjs"), "utf8");
  const spawnCalls = setupSrc
    .split(/\bspawn(?:Sync)?\(/)
    .slice(1)
    .map((c) => c.slice(0, c.indexOf("})")));
  const unhidden = spawnCalls.filter((c) => !/windowsHide: true/.test(c));
  check(
    "every program setup.mjs starts (winget, uv, the hidden setup) opens no console window: windowsHide: true",
    spawnCalls.length >= 3 && unhidden.length === 0,
    show(unhidden),
  );

  // ---- while `setup.mjs voice` runs (its file names a live process): the phone hears it is being set up
  fs.mkdirSync(path.dirname(voice.settingUpPath()), { recursive: true });
  fs.writeFileSync(voice.settingUpPath(), JSON.stringify({ pid: process.pid }));
  const busy = await ask("voice.warm");
  check(
    "while the model downloads, voice.warm answers voice-setting-up with the new words and no command line",
    busy.err === "voice-setting-up" &&
      busy.message ===
        "Voice is being set up on your PC. Try again in a few minutes." &&
      busy.run === undefined,
    show(busy),
  );
  const second = spawnSync(
    process.execPath,
    [path.join(PC, "setup.mjs"), "voice", "--background"],
    { encoding: "utf8", env: { ...process.env, PHONE_PC_DRY: "1" } },
  );
  check(
    "a second voice setup while one runs says so and starts nothing (two downloads would race)",
    second.status === 0 &&
      second.stdout.includes("its setup already runs") &&
      !second.stdout.includes("would start hidden"),
    `${second.stdout}${second.stderr}`,
  );
  const ended = spawnSync(process.execPath, ["-e", ""]);
  fs.writeFileSync(voice.settingUpPath(), JSON.stringify({ pid: ended.pid }));
  const stale = await ask("voice.warm");
  check(
    "a setup file left by a process that has ended counts as not set up, with the setup line",
    stale.err === "voice-not-set-up" && /setup\.mjs voice$/.test(stale.run),
    show(stale),
  );
  fs.rmSync(voice.settingUpPath());

  // ---- the install and the update start the voice setup once when the add-on is there and voice is not set up
  // (dry: --dry-run and --check). Run in a home of their own, without --home (with --home they never start it).
  const home2 = path.join(tmp, "home2");
  const pcSetup2 = path.join(
    home2,
    ".claude",
    "skills",
    "phone-bot",
    "pc",
    "setup.mjs",
  );
  fs.mkdirSync(path.dirname(pcSetup2), { recursive: true });
  fs.writeFileSync(pcSetup2, "");
  const server = http.createServer((_q, a) =>
    a.end(JSON.stringify({ version: "1.0.0" })),
  );
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  fs.writeFileSync(
    path.join(home2, ".claude", "setup-state.json"),
    JSON.stringify({ version: "1.0.0" }),
  );
  const env2 = {
    ...process.env,
    HOME: home2,
    USERPROFILE: home2,
    SETUP_CC_CHECK: "off",
    SETUP_UPDATE_BASE: `http://127.0.0.1:${server.address().port}`,
  };
  const starts = (out) =>
    out.split("would start its setup in the background").length - 1;
  const installRun = () =>
    runNode([path.join(ROOT, "install.mjs"), "--dry-run"], env2);
  const updateRun = () =>
    runNode(
      [path.join(ROOT, "skills", "update-setup", "update.mjs"), "--check"],
      env2,
    );
  const [inst1, upd1] = [await installRun(), await updateRun()];
  check(
    "the install (dry) with the phone add-on and no voice marker starts the voice setup once",
    starts(inst1) === 1 && inst1.includes("voice --background"),
    inst1.split("\n").slice(-15).join("\n"),
  );
  check(
    "the update (dry) with the phone add-on and no voice marker starts the voice setup once",
    starts(upd1) === 1 && upd1.includes("voice --background"),
    upd1,
  );
  fs.mkdirSync(path.join(home2, ".phone-app"));
  fs.writeFileSync(path.join(home2, ".phone-app", "voice.json"), "{}");
  const [inst2, upd2] = [await installRun(), await updateRun()];
  check(
    "with the voice marker in place the install and the update do not start the voice setup",
    starts(inst2) === 0 &&
      starts(upd2) === 0 &&
      /Already on the newest/.test(upd2),
    upd2,
  );
  server.close();

  // ---- `setup.mjs voice --background`, not dry, with a stand-in for the download: it returns at once and the
  // stand-in carries on after the caller has ended
  if (process.platform === "win32") {
    const standIn = path.join(tmp, "stand-in-setup.mjs");
    const standInDone = path.join(tmp, "stand-in-done");
    // The stand-in writes its mark only once its caller (setup.mjs, its parent) has ended: an order, not a clock. A
    // caller that waited on it would never end, and spawnSync's 10 s limit would kill it (status null).
    fs.writeFileSync(
      standIn,
      `import fs from "node:fs";
const caller = process.ppid;
const alive = () => { try { process.kill(caller, 0); return true; } catch { return false; } };
const poll = setInterval(() => {
  if (alive()) return;
  clearInterval(poll);
  fs.writeFileSync(${JSON.stringify(standInDone)}, "done after the caller ended");
}, 50);
`,
    );
    const bg = spawnSync(
      process.execPath,
      [path.join(PC, "setup.mjs"), "voice", "--background"],
      {
        encoding: "utf8",
        env: { ...process.env, PHONE_PC_VOICE_SETUP: standIn },
        timeout: 10000,
      },
    );
    const appeared = await until(() => fs.existsSync(standInDone), 10000);
    check(
      "setup.mjs voice --background returns without waiting on the setup it started, and that setup ends its work after the caller has exited",
      bg.status === 0 && appeared,
      show({
        status: bg.status,
        appeared,
        out: bg.stdout,
        err: bg.stderr,
      }),
    );
  }

  // A marker from a release before the lock: the model is there, but the Python may lack the locked packages. The
  // PC program starts the setup itself (a stand-in here, which marks that it ran and changes nothing) and the phone
  // hears it is being set up; once that setup has ended without fixing it, the phone gets the setup line.
  fs.mkdirSync(path.dirname(voice.markerPath()), { recursive: true });
  fs.writeFileSync(voice.markerPath(), JSON.stringify({ model: "small" }));
  const redoMark = path.join(tmp, "redo-setup-ran");
  const redoStandIn = path.join(tmp, "redo-setup.mjs");
  fs.writeFileSync(
    redoStandIn,
    `import fs from "node:fs"; fs.writeFileSync(${JSON.stringify(redoMark)}, "ran");\n`,
  );
  process.env.PHONE_PC_VOICE_SETUP = redoStandIn;
  const oldMarker = await ask("voice.warm");
  const redoRan = await until(() => fs.existsSync(redoMark), 10000);
  delete process.env.PHONE_PC_VOICE_SETUP;
  const lock = createHash("sha256")
    .update(fs.readFileSync(`${voice.SERVER}.lock`))
    .digest("hex");
  fs.writeFileSync(
    voice.markerPath(),
    JSON.stringify({ model: "small", lock: "0".repeat(64) }),
  );
  const otherLock = await ask("voice.warm");
  check(
    "voice.warm with a marker for an older lock starts the voice setup itself and answers voice-setting-up (FAIL: voice breaks after an update until a command is typed on the PC)",
    redoRan &&
      oldMarker.ok === false &&
      oldMarker.err === "voice-setting-up" &&
      oldMarker.run === undefined,
    show({ redoRan, oldMarker }),
  );
  check(
    "after that setup ended with the lock still old, voice.warm answers voice-not-set-up with the setup line (FAIL: a PC set up on an older release runs a Python without the locked packages)",
    otherLock.ok === false &&
      otherLock.err === "voice-not-set-up" &&
      /setup\.mjs voice$/.test(otherLock.run),
    show({ otherLock }),
  );
  // What the real setup step leaves once the model loads.
  fs.writeFileSync(
    voice.markerPath(),
    JSON.stringify({ model: "small", lock }),
  );

  // ---- the transcriber's Python is found once with `uv python find`, and found again after a start fails.
  // node:child_process is wrapped here: `python find` answers a made-up path, and that path starts the stand-in.
  {
    const cp = createRequire(import.meta.url)("node:child_process");
    const real = { spawn: cp.spawn, spawnSync: cp.spawnSync };
    const fakePy = path.join(tmp, "made-up-python.exe");
    let finds = 0;
    let startFails = false;
    let child = null;
    cp.spawnSync = (cmd, args, opts) => {
      if (args?.[0] !== "python" || args[1] !== "find")
        return real.spawnSync(cmd, args, opts);
      finds++;
      return { status: 0, stdout: `${fakePy}\n`, stderr: "" };
    };
    cp.spawn = (cmd, args, opts) => {
      if (cmd !== fakePy) return real.spawn(cmd, args, opts);
      child = real.spawn(
        process.execPath,
        startFails ? ["-e", "process.exit(3)"] : [fakeTranscriber],
        opts,
      );
      return child;
    };
    syncBuiltinESMExports();
    delete process.env.PHONE_PC_TRANSCRIBER;
    // One start: it waits for ready, then the stand-in is stopped and voice.mjs has seen it end.
    const startOnce = async () => {
      await ask("voice.warm");
      const me = child;
      for (let i = 0; !startFails && i < 500; i++) {
        if ((await ask("voice.warm")).d?.ready) break;
        await sleep(20);
      }
      if (me.exitCode === null) {
        const ended = new Promise((r) => me.once("exit", r));
        me.kill();
        await ended;
      }
    };
    try {
      await startOnce();
      await startOnce();
      const afterTwo = finds;
      startFails = true;
      await startOnce();
      startFails = false;
      await startOnce();
      check(
        "the transcriber's Python is found once for two starts, and found again after a start fails (FAIL: each start waits for uv python find, or a moved Python is never found again)",
        afterTwo === 1 && finds === 2,
        show({ afterTwo, finds }),
      );
    } finally {
      Object.assign(cp, real);
      syncBuiltinESMExports();
      process.env.PHONE_PC_TRANSCRIBER = fakeTranscriber;
    }
  }
  const warm = await ask("voice.warm");
  check(
    "voice.warm once set up starts the transcriber and answers { ready }",
    warm.ok && typeof warm.d.ready === "boolean",
    show(warm),
  );

  // ---- a 5 MB recording in pieces of 192 KB, joined whole on the PC
  const big = new Uint8Array(randomBytes(5 * 1024 * 1024));
  const before = pageFrames.length;
  const progress = [];
  const sent = await session.sendStream(big, "audio/mp4", (p) =>
    progress.push(p),
  );
  const pieces = pageFrames.length - before;
  check(
    "a 5 MB recording goes as 27 sealed pieces and the PC answers it whole",
    sent.ok &&
      sent.d.bytes === big.length &&
      pieces === 27 &&
      progress.length === 27 &&
      progress[26] === 1,
    show({ sent, pieces, progress: progress.length }),
  );
  const t1 = await ask("voice.transcribe", { stream: sent.d.stream });
  check(
    "voice.transcribe answers at once with a job id",
    t1.ok && typeof t1.d.job === "string",
    show(t1),
  );
  const r1 = await ask("voice.result", { job: t1.d?.job });
  const want = createHash("sha256").update(big).digest("hex");
  check(
    "the transcriber got the 5 MB file whole (size and SHA-256) and its text comes back",
    r1.ok && r1.d.done && r1.d.text === `heard ${big.length} bytes ${want}`,
    show(r1),
  );
  const first = heard()[0];
  check(
    "the audio was written to %TEMP%\\phone-app-voice as .m4a and deleted after the job",
    first?.there === true &&
      fs.realpathSync.native(path.dirname(first.file)) ===
        fs.realpathSync.native(voiceDir) &&
      first.file.endsWith(".m4a") &&
      audioLeft().length === 0,
    show({ first, left: audioLeft() }),
  );
  const again = await ask("voice.transcribe", { stream: sent.d.stream });
  check(
    "a stream is taken once: asked again it answers no-stream",
    again.err === "no-stream",
    show(again),
  );

  // ---- a failed transcription: the error comes back, and the audio is deleted all the same
  const bad = new TextEncoder().encode("FAIL and then some sound");
  const s2 = await session.sendStream(bad, "audio/webm;codecs=opus");
  const t2 = await ask("voice.transcribe", { stream: s2.d?.stream });
  const r2 = await ask("voice.result", { job: t2.d?.job });
  check(
    "a failed transcription answers transcribe-failed with the transcriber's error",
    r2.ok === false &&
      r2.err === "transcribe-failed" &&
      /no speech found/.test(r2.message),
    show(r2),
  );
  check(
    "the failed job's audio (.webm) is deleted too",
    heard()[1]?.file.endsWith(".webm") && audioLeft().length === 0,
    show({ h: heard(), left: audioLeft() }),
  );
  const other = await registry.handle(
    { k: "req", id: "x", a: "voice.result", d: { job: t1.d?.job } },
    { page: "ok", device: "another-device" },
  );
  check(
    "another device cannot read a job's text",
    other.err === "no-job",
    show(other),
  );

  // ---- voice notes may be 50 MB: voice.transcribe with a stand-in stream (the PC channel's own limit aside)
  const MB = 1024 * 1024;
  const transcribeOf = (size) =>
    registry.handle(
      { k: "req", id: "big", a: "voice.transcribe", d: { stream: "s1" } },
      {
        page: "ok",
        device: "big-device",
        takeStream: () => ({ bytes: Buffer.alloc(size), mime: "audio/mp4" }),
      },
    );
  const take30 = await transcribeOf(30 * MB);
  const take51 = await transcribeOf(51 * MB);
  check(
    "voice.transcribe takes a 30 MB recording and refuses 51 MB with too-big",
    take30.ok === true &&
      typeof take30.d?.job === "string" &&
      take51.ok === false &&
      take51.err === "too-big",
    show({ take30, take51 }),
  );

  const odd = await session.sendStream(new Uint8Array(10), "video/mp4");
  const t3 = await ask("voice.transcribe", { stream: odd.d?.stream });
  check(
    "audio of a format the PC does not know answers unknown-audio",
    t3.err === "unknown-audio" && t3.mime === "video/mp4",
    show(t3),
  );

  // ---- a recording is never left in %TEMP%: not after a failed write, not after a restart
  await registry.handle(
    { k: "req", id: "big-r", a: "voice.result", d: { job: take30.d?.job } },
    { page: "ok", device: "big-device" },
  );
  {
    // The disk fills during the write: a part of the file is on disk when the write fails, as with a real ENOSPC.
    const nodeFs = createRequire(import.meta.url)("node:fs");
    const realWrite = nodeFs.writeFileSync;
    nodeFs.writeFileSync = (file, data, opts) => {
      if (!String(file).includes("phone-app-voice"))
        return realWrite(file, data, opts);
      realWrite(file, data.subarray(0, 4), opts);
      throw Object.assign(new Error("ENOSPC: no space left on device"), {
        code: "ENOSPC",
      });
    };
    syncBuiltinESMExports();
    let full;
    try {
      const s = await session.sendStream(
        new TextEncoder().encode("a recording the disk has no room for"),
        "audio/mp4",
      );
      full = await ask("voice.transcribe", { stream: s.d?.stream });
    } finally {
      nodeFs.writeFileSync = realWrite;
      syncBuiltinESMExports();
    }
    check(
      "a recording whose write fails is refused and leaves no file in %TEMP%",
      full?.ok === false && audioLeft().length === 0,
      show({ full, left: audioLeft() }),
    );
  }
  {
    // A program that stopped mid-job left its recording; another program's job written just now is not touched.
    fs.mkdirSync(voiceDir, { recursive: true });
    const stale = path.join(voiceDir, "left-by-an-earlier-run.m4a");
    const fresh = path.join(voiceDir, "another-program-job.m4a");
    fs.writeFileSync(stale, "old");
    fs.writeFileSync(fresh, "new");
    const hoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    fs.utimesSync(stale, hoursAgo, hoursAgo);
    const restarted = await import(
      `${pathToFileURL(path.join(PC, "actions", "voice.mjs")).href}?restart`
    );
    restarted.register(createRegistry());
    check(
      "a recording left by an earlier run goes at the next start; one written in the last 2 hours stays",
      !fs.existsSync(stale) && fs.existsSync(fresh),
      show(audioLeft()),
    );
    fs.rmSync(fresh, { force: true });
  }
  let lockJob;
  {
    // An old recording another program holds (EBUSY on delete) or that cannot be looked at (EPERM) is passed over
    // with a log line: the PC program still starts, the other old recordings still go, a new recording is written out.
    fs.mkdirSync(voiceDir, { recursive: true });
    const hoursAgo = new Date(Date.now() - 3 * 3600 * 1000);
    const old = (name) => {
      const p = path.join(voiceDir, name);
      fs.writeFileSync(p, "old");
      fs.utimesSync(p, hoursAgo, hoursAgo);
      return p;
    };
    const locked = old("held-by-another-program.m4a");
    const denied = old("not-to-be-looked-at.m4a");
    const plain = old("left-by-an-earlier-run.m4a");
    const nodeFs = createRequire(import.meta.url)("node:fs");
    const realRm = nodeFs.rmSync;
    const realStat = nodeFs.statSync;
    const refused = (code) =>
      Object.assign(new Error(`${code}: refused`), { code });
    nodeFs.rmSync = (p, o) => {
      if (String(p) === locked) throw refused("EBUSY");
      return realRm(p, o);
    };
    nodeFs.statSync = (p, o) => {
      if (String(p) === denied) throw refused("EPERM");
      return realStat(p, o);
    };
    syncBuiltinESMExports();
    let startError = null;
    let job;
    try {
      try {
        (
          await import(
            `${pathToFileURL(path.join(PC, "actions", "voice.mjs")).href}?locked`
          )
        ).register(createRegistry());
      } catch (e) {
        startError = e.message;
      }
      job = await registry.handle(
        { k: "req", id: "lock-t", a: "voice.transcribe", d: { stream: "s1" } },
        {
          page: "ok",
          device: "lock-device",
          takeStream: () => ({
            bytes: Buffer.from("a recording beside a locked one"),
            mime: "audio/mp4",
          }),
        },
      );
    } finally {
      nodeFs.rmSync = realRm;
      nodeFs.statSync = realStat;
      syncBuiltinESMExports();
    }
    lockJob = job.d?.job;
    const result = await registry.handle(
      { k: "req", id: "lock-r", a: "voice.result", d: { job: job.d?.job } },
      { page: "ok", device: "lock-device" },
    );
    const logged = fs
      .readFileSync(path.join(home, ".phone-app", "pc.log"), "utf8")
      .split("\n")
      .filter((l) => l.includes("was not deleted")).length;
    check(
      "an old recording that is locked or unreadable is passed over and logged (FAIL: one locked old recording stops the PC program from starting and breaks voice)",
      startError === null &&
        job.ok === true &&
        result.d?.done === true &&
        !fs.existsSync(plain) &&
        fs.existsSync(locked) &&
        logged >= 2,
      show({ startError, job, result, left: audioLeft(), logged }),
    );
    fs.rmSync(locked, { force: true });
    fs.rmSync(denied, { force: true });
  }

  // ---- a job over 10 minutes is stopped (the 10 minutes made short here), and the recording queued behind it goes
  // to a new transcriber, not to the stopped one
  {
    // Earlier jobs are through first: each sets a timer of KEEP_DONE_MS (also 10 minutes) as it ends, which the stub
    // below would shorten in place of the job's own timer.
    const through = async (job, device) => {
      for (let i = 0; i < 5; i++) {
        const r = await registry.handle(
          { k: "req", id: "through", a: "voice.result", d: { job } },
          { page: "ok", device },
        );
        if (!r.ok || r.d.done) return;
      }
      throw new Error(`a job of ${device} was not through after 100 s`);
    };
    await through(take30.d?.job, "big-device");
    await through(lockJob, "lock-device");
    const realSetTimeout = globalThis.setTimeout;
    const sA = await session.sendStream(
      new TextEncoder().encode("HOLD past the job time"),
      "audio/mp4",
    );
    const sB = await session.sendStream(
      new TextEncoder().encode("the next recording"),
      "audio/mp4",
    );
    let shortened = 0;
    globalThis.setTimeout = (fn, ms, ...rest) =>
      realSetTimeout(
        fn,
        ms === 10 * 60 * 1000 && !shortened++ ? 300 : ms,
        ...rest,
      );
    // The first stop signal after this fails (kill() answers false, the process goes on), as when Windows refuses it.
    const realKill = ChildProcess.prototype.kill;
    let refusedKills = 0;
    ChildProcess.prototype.kill = function refuseOnce() {
      ChildProcess.prototype.kill = realKill;
      refusedKills++;
      return false;
    };
    const heardBefore = heard().length;
    let slow;
    let next;
    try {
      slow = await ask("voice.transcribe", { stream: sA.d?.stream });
      next = await ask("voice.transcribe", { stream: sB.d?.stream });
    } finally {
      globalThis.setTimeout = realSetTimeout;
    }
    const rA = await ask("voice.result", { job: slow.d?.job });
    const rB = await ask("voice.result", { job: next.d?.job });
    ChildProcess.prototype.kill = realKill;
    check(
      "after a job over 10 minutes is stopped, the next recording is written out by a new transcriber",
      shortened === 1 &&
        rA.err === "transcribe-failed" &&
        /over 10 minutes/.test(rA.message) &&
        rB.ok === true &&
        /^heard /.test(rB.d?.text ?? ""),
      show({ rA, rB }),
    );
    const stuck = heard()[heardBefore]?.pid;
    const alive = (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch {
        return false;
      }
    };
    const ended = await until(() => stuck && !alive(stuck), 15_000);
    const logged = fs
      .readFileSync(path.join(home, ".phone-app", "pc.log"), "utf8")
      .split("\n")
      .filter((l) => l.includes("did not take the stop signal")).length;
    check(
      "a stopped transcriber that ignores its stop signal is logged and killed hard a few seconds later (FAIL: a transcriber whose kill failed runs on untracked)",
      refusedKills === 1 && ended === true && logged >= 1,
      show({ refusedKills, stuck, ended, logged }),
    );
  }

  // ---- at most 2 jobs of one device wait: a third is refused until one is through
  const held = [];
  for (let i = 0; i < 3; i++) {
    const s = await session.sendStream(
      new TextEncoder().encode(`HOLD ${i}`),
      "audio/mp4",
    );
    held.push(await ask("voice.transcribe", { stream: s.d?.stream }));
  }
  fs.writeFileSync(process.env.FAKE_RELEASE, "");
  const heldDone = await ask("voice.result", { job: held[1].d?.job });
  check(
    "a third waiting job of one device is refused with too-many-jobs and a message",
    held[0].ok &&
      held[1].ok &&
      held[2].err === "too-many-jobs" &&
      /recordings/.test(held[2].message) &&
      heldDone.d?.done === true,
    show({ held, heldDone }),
  );

  // ---- the page: the record button in the typing box, on a DOM stand-in, a stand-in microphone that records
  // as an iPhone does (MP4 only) and the same channel session to the PC as above
  installPage();
  const { voiceParts } = await import(
    pathToFileURL(path.join(PAGE, "screens", "session-voice.js")).href
  );
  const asked = [];
  const answered = [];
  const streamed = [];
  const ctx = {
    ask: (a, d) => {
      asked.push(a);
      return session.ask(a, d).finally(() => answered.push(a));
    },
    sendStream: (bytes, mime, onProgress, max) => {
      const entry = {
        sha: sha(bytes),
        mime,
        bytes: bytes.length,
        max,
        parts: 0,
      };
      streamed.push(entry);
      return session.sendStream(
        bytes,
        mime,
        (p) => {
          entry.parts++;
          onProgress?.(p);
        },
        max,
      );
    },
    offered: () => true,
    haptic: () => {},
  };
  const box = (key, typed) => {
    const field = new FakeElement("textarea");
    field.value = typed;
    field.setSelectionRange(typed.length, typed.length);
    const row = new FakeElement("div");
    row.append(new FakeElement("button"));
    let changes = 0;
    const parts = voiceParts(ctx, {
      key,
      field,
      row,
      changed: () => changes++,
    });
    const root = new FakeElement("div");
    root.append(parts.chip, field, row, parts.panel);
    return { field, row, root, parts, changes: () => changes };
  };
  const act = (root, name) =>
    walk(root).find(
      (n) => n.attrs?.["data-action"] === name && !hiddenIn(root, n),
    );

  const a = box("session-a", "Before");
  act(a.root, "voice.record").click();
  const recording = await until(() => act(a.root, "voice.stop"));
  check(
    "the record button opens the recording panel in place of the button row, sends voice.warm and asks to keep the screen on without a wake lock",
    recording &&
      a.row.hidden &&
      a.field.hidden &&
      asked.includes("voice.warm") &&
      /Keep the screen on/.test(a.parts.panel.textContent) &&
      /\d:\d\d/.test(a.parts.panel.textContent),
    show({ panel: a.parts.panel.textContent, asked }),
  );
  // the record tap's voice.warm is back before Stop, so its answer cannot cross the stop's redraw
  check(
    "the record tap's voice.warm is answered",
    await until(() => answered.includes("voice.warm"), 20000),
    show({ asked, answered }),
  );
  mic.next = big;
  recording.click();
  const landed = await until(() => /heard/.test(a.field.value), 15000);
  check(
    "after Stop the 5 MB recording goes in pieces, and its text lands in the box at the cursor, unsent, the box back",
    landed &&
      a.field.value === `Before heard ${big.length} bytes ${want}` &&
      streamed[0]?.sha === want &&
      streamed[0].mime === "audio/mp4" &&
      !asked.some((x) => x.startsWith("session.")) &&
      !a.row.hidden &&
      !a.field.hidden &&
      a.field.focused &&
      a.field.selectionStart === a.field.value.length &&
      a.changes() > 0,
    show({ value: a.field.value?.slice(0, 120), streamed, asked }),
  );
  check(
    'the line above the text says "From voice · 0:00" with Play and Record again',
    /From voice · 0:0\d/.test(a.parts.chip.textContent) &&
      /Play/.test(a.parts.chip.textContent) &&
      Boolean(act(a.root, "voice.again")),
    a.parts.chip.textContent,
  );

  const b = box("session-b", "");
  act(b.root, "voice.record").click();
  const stopB = await until(() => act(b.root, "voice.stop"));
  check(
    'the stop button under the recording says "Done, make text"',
    stopB.textContent === "Done, make text",
    stopB.textContent,
  );
  mic.next = bad;
  const heardBefore = heard().length;
  stopB.click();
  const failedLine = await until(() =>
    /Not turned into text/.test(b.parts.chip.textContent),
  );
  check(
    "a failed transcription shows its error with Try again, the box left empty",
    failedLine &&
      /no speech found/.test(b.parts.chip.textContent) &&
      Boolean(act(b.root, "voice.retry")) &&
      b.field.value === "",
    b.parts.chip.textContent,
  );
  const micB = act(b.root, "voice.record");
  micB.click();
  await sleep(300);
  check(
    "while a recording failed the record button is off, and a tap on it keeps the recording and its Try again",
    micB.disabled === true &&
      /Not turned into text/.test(b.parts.chip.textContent) &&
      Boolean(act(b.root, "voice.retry")),
    show({ disabled: micB.disabled, chip: b.parts.chip.textContent }),
  );
  act(b.root, "voice.retry").click();
  await until(() => heard().length === heardBefore + 2);
  await until(() => /Not turned into text/.test(b.parts.chip.textContent));
  check(
    "the recording is kept: Try again sends the same recording to the PC again",
    streamed.length === 3 &&
      streamed[1].sha === streamed[2].sha &&
      streamed[1].sha === sha(bad) &&
      heard().length === heardBefore + 2 &&
      /no speech found/.test(b.parts.chip.textContent),
    show({ streamed, heard: heard().length - heardBefore }),
  );

  // ---- the voice screen sends with the 50 MB limit: one byte over is refused before any piece, 30 MB goes out
  const c = box("session-c", "");
  act(c.root, "voice.record").click();
  const stopC = await until(() => act(c.root, "voice.stop"));
  mic.next = new Uint8Array(pageChannel.FILES_STREAM_MAX + 1);
  const framesC = pageFrames.length;
  stopC.click();
  const overLine = await until(() =>
    /Not turned into text/.test(c.parts.chip.textContent),
  );
  check(
    'a recording one byte over 50 MB is refused before a piece is sent, in the words "the recording is over 50 MB"',
    overLine &&
      /the recording is over 50 MB/.test(c.parts.chip.textContent) &&
      streamed.at(-1).bytes === pageChannel.FILES_STREAM_MAX + 1 &&
      streamed.at(-1).parts === 0 &&
      pageFrames.length === framesC,
    show({ chip: c.parts.chip.textContent, last: streamed.at(-1) }),
  );
  const d = box("session-d", "");
  act(d.root, "voice.record").click();
  const stopD = await until(() => act(d.root, "voice.stop"));
  mic.next = new Uint8Array(30 * MB);
  stopD.click();
  const firstPiece = await until(
    () => streamed.at(-1).bytes === 30 * MB && streamed.at(-1).parts > 0,
    15000,
  );
  check(
    "the voice screen sends a 30 MB recording with the 50 MB limit and its first piece goes out",
    firstPiece && streamed.at(-1).max === pageChannel.FILES_STREAM_MAX,
    show({ last: streamed.at(-1), chip: d.parts.chip.textContent }),
  );
} catch (e) {
  failure = e;
}

if (failure) {
  failed++;
  console.log(`FAIL the run stopped: ${failure.stack}`);
}
console.log(`\n${pass} passed, ${failed} failed`);
fs.rmSync(tmp, { recursive: true, force: true, maxRetries: 5 });
process.exit(failed ? 1 : 0);
