// Tests for voice (plan row C3): the record button's recording goes from the page to the PC in pieces through the
// sealed channel (phone/page/frame/channel.js sendStream, skills/phone-bot/pc/core/channel.mjs), the PC's
// voice.warm, voice.transcribe and voice.result (skills/phone-bot/pc/actions/voice.mjs) run a stand-in
// transcriber that speaks the real one's JSON lines, and the page's voice parts of the typing box
// (phone/page/screens/session-voice.js) put the text in the box unsent, or show the error and keep the recording.
// `setup.mjs voice`, the install and the update run in dry mode only; `setup.mjs voice --background` runs for real
// with a stand-in script (PHONE_PC_VOICE_SETUP) in place of the download. No speech model is downloaded, no
// winget runs and nothing real is transcribed.
// Run: node tests/test-phone-voice.mjs
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import http from "node:http";
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
  fs.appendFileSync(process.env.FAKE_HEARD_LOG, JSON.stringify({ file, there: fs.existsSync(file) }) + "\\n");
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
      dryOut.includes("--with faster-whisper") &&
      !fs.existsSync(voice.markerPath()),
    dryOut,
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
  const server = http.createServer((q, a) =>
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
    fs.writeFileSync(
      standIn,
      `import fs from "node:fs";\nsetTimeout(() => fs.writeFileSync(${JSON.stringify(standInDone)}, "done"), 1500);\n`,
    );
    const t0 = Date.now();
    const bg = spawnSync(
      process.execPath,
      [path.join(PC, "setup.mjs"), "voice", "--background"],
      {
        encoding: "utf8",
        env: { ...process.env, PHONE_PC_VOICE_SETUP: standIn },
        timeout: 10000,
      },
    );
    const took = Date.now() - t0;
    const notYet = !fs.existsSync(standInDone);
    const appeared = await until(() => fs.existsSync(standInDone), 10000);
    check(
      "setup.mjs voice --background returns within 5 s and the started setup ends its work after the caller has exited",
      bg.status === 0 && took < 5000 && notYet && appeared,
      show({
        status: bg.status,
        took,
        notYet,
        appeared,
        out: bg.stdout,
        err: bg.stderr,
      }),
    );
  }

  // What the real setup step leaves once the model loads.
  fs.mkdirSync(path.dirname(voice.markerPath()), { recursive: true });
  fs.writeFileSync(voice.markerPath(), JSON.stringify({ model: "small" }));
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
  const streamed = [];
  const ctx = {
    ask: (a, d) => {
      asked.push(a);
      return session.ask(a, d);
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
  await sleep(300);
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
