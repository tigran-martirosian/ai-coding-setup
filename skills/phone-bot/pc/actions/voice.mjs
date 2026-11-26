// Voice to text (PC program design, section 7; actions 29 and 30). A transcriber that stays running
// (voice/transcribe-server.py, the speech model loaded once) is started on voice.warm, which the page sends when
// the user taps record, so its start-up of about 26 s runs while he speaks. The recording comes as a stream of the
// sealed channel; voice.transcribe writes it to %TEMP%\phone-app-voice\<random>.<ext>, queues the job and answers
// at once with a job id, and voice.result waits up to 20 s for the text. So no request outlasts the page's 30 s
// answer time, however long the speech is, and a job survives the page going to sleep. The audio file is
// deleted after the job, also when it fails or its write fails; one that a stopped program left goes at the next
// start. The transcriber stops after 15 minutes without a job.
// It is one of the three programs the PC program may start: a fixed command line, no shell.
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appDir, checkPath, readText } from "../core/files.mjs";
import { log } from "../core/log.mjs";
import { DRY, testOverride } from "../core/mode.mjs";
import { ActionError } from "../core/registry.mjs";

const PC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SERVER = path.join(PC_DIR, "voice", "transcribe-server.py");
export const MODEL = "small";
export const MODEL_MB = 480;
// The transcriber's Python packages are locked in SERVER.lock (uv lock --script). `setup.mjs voice` installs exactly
// the lock into the script's own environment; each start finds that environment's Python with no network and runs
// the server isolated (-I), so no start resolves or fetches a package.
export const SYNC_ARGS = ["sync", "--script", SERVER, "--frozen"];
export const FIND_PYTHON_ARGS = [
  "python",
  "find",
  "--script",
  SERVER,
  "--offline",
];
export const SERVER_ARGS = ["-I", SERVER];
// The oldest uv with `sync --script` and `python find --script`: uv's changelog (changelogs/0.6.x.md), 0.6.10
// "Support `python find --script`" (#11891); `sync --script` is there since before 0.6.7.
export const UV_MIN = "0.6.10";

// Whether the answer of `uv --version` ("uv 0.6.10 (...)") names UV_MIN or newer; false when it names no version.
export function uvNewEnough(versionLine) {
  const m = versionLine.trim().match(/^uv (\d+)\.(\d+)\.(\d+)/);
  if (!m) return false;
  const min = UV_MIN.split(".").map(Number);
  for (let i = 0; i < 3; i++)
    if (Number(m[i + 1]) !== min[i]) return Number(m[i + 1]) > min[i];
  return true;
}

// The Python of the transcriber's environment, from `uv python find`; a clear error when uv cannot say.
export function scriptPython(uv) {
  const r = spawnSync(uv, FIND_PYTHON_ARGS, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  if (r.error) throw new Error(`uv python find failed: ${r.error.message}`);
  const py = r.stdout.trim();
  if (r.status !== 0 || !py)
    throw new Error(
      `uv python find found no Python for the transcriber (exit code ${r.status}): ${lastLine(r.stderr || "")}`,
    );
  return py;
}

// The SHA-256 of SERVER.lock: `setup.mjs voice` writes it into the marker, and a start needs the same, so a PC set up
// for an older lock runs the setup again instead of a Python without the new packages.
export function lockHash() {
  return createHash("sha256")
    .update(fs.readFileSync(`${SERVER}.lock`))
    .digest("hex");
}

// The transcriber's Python, found once with `uv python find` and kept until a start fails.
let found = null; // { uv, py }
function transcriberPython(uv) {
  if (found?.uv !== uv) found = { uv, py: scriptPython(uv) };
  return found.py;
}
const SETUP_LINE = `node ${path.join(PC_DIR, "setup.mjs")} voice`;

// Whether this program run has started `setup.mjs voice --background` for a changed lock.
let redoStarted = false;
function redoSetup() {
  log("voice", "the lock changed: starting the voice setup again");
  if (DRY) return;
  spawn(
    process.execPath,
    [path.join(PC_DIR, "setup.mjs"), "voice", "--background"],
    { detached: true, stdio: "ignore", windowsHide: true, shell: false },
  ).unref();
}

const IDLE_MS = 15 * 60 * 1000;
const JOB_MS = 10 * 60 * 1000;
const KILL_WAIT_MS = 5000; // a stopped transcriber still running this long after is killed hard
const RESULT_WAIT_MS = 20_000;
const KEEP_DONE_MS = 10 * 60 * 1000;
const JOBS_WAITING_MAX = 2; // jobs of one device not yet through: each holds up to 50 MB in %TEMP%
// A recording older than this was left by a program that stopped mid-job: no job lives as long (2 waiting jobs per
// device, 4 devices, 10 minutes each), so another PC program's job in progress is never taken.
const LEFT_MS = 2 * 3600 * 1000;
const AUDIO_MAX = 50 * 1024 * 1024; // the page's FILES_STREAM_MAX, which it sends voice notes with
const SETTING_UP =
  "Voice is being set up on your PC. Try again in a few minutes.";
const ID = /^[A-Za-z0-9_-]{1,64}$/;
// The formats a phone's MediaRecorder gives (platform facts, section 8) and their file endings.
const EXT = {
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/aac": "aac",
  "audio/webm": "webm",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
};

// Written by `setup.mjs voice` once the model is downloaded.
export const markerPath = () => path.join(appDir(), "voice.json");
// Holds { pid } of `setup.mjs voice` while it runs.
export const settingUpPath = () => path.join(appDir(), "voice-setup.json");
const voiceDir = () => path.join(os.tmpdir(), "phone-app-voice");

// uv on the PATH, or in winget's links folder (setup.mjs installs it with winget; a program started before that
// has the old PATH), or null.
export function findUv() {
  const names = process.platform === "win32" ? ["uv.exe"] : ["uv"];
  const dirs = (process.env.PATH || "").split(path.delimiter);
  if (process.platform === "win32" && process.env.LOCALAPPDATA)
    dirs.push(
      path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Links"),
    );
  for (const dir of dirs)
    for (const n of names)
      if (dir && fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  return null;
}

// Whether `setup.mjs voice` runs now: its file names a process that is still there.
export function settingUp() {
  let pid;
  try {
    pid = JSON.parse(readText(settingUpPath())).pid;
  } catch {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

// The program and arguments of the transcriber; ActionError voice-setting-up while `setup.mjs voice` runs, else
// voice-not-set-up with the line to run when uv or the model is missing. In test mode PHONE_PC_TRANSCRIBER names a
// Node script speaking the same lines.
function command() {
  const uv = findUv();
  let marker;
  try {
    marker = JSON.parse(readText(markerPath()));
  } catch {
    marker = null;
  }
  const forLock = marker?.lock === lockHash();
  if ((!uv || marker?.model !== MODEL || !forLock) && settingUp())
    throw new ActionError("voice-setting-up", { message: SETTING_UP });
  if (!uv)
    throw new ActionError("voice-not-set-up", {
      message: "uv is not installed",
      run: SETUP_LINE,
    });
  // No marker, or one that does not read, means the setup step has not finished.
  if (marker?.model !== MODEL)
    throw new ActionError("voice-not-set-up", {
      message: "the speech model is not downloaded",
      run: SETUP_LINE,
    });
  // An update changed the lock: the model is here, only the packages are behind. The setup is started here, once
  // per program run, so the phone never needs a command typed on the PC; a setup that ended without fixing it
  // gives the setup line.
  if (!forLock) {
    if (!redoStarted) {
      redoStarted = true;
      redoSetup();
      throw new ActionError("voice-setting-up", { message: SETTING_UP });
    }
    throw new ActionError("voice-not-set-up", {
      message: `voice was set up for other Python packages than this version needs, and redoing it failed (see ${path.join(appDir(), "voice-setup.log")})`,
      run: SETUP_LINE,
    });
  }
  const fake = testOverride("PHONE_PC_TRANSCRIBER");
  if (fake) return [process.execPath, [fake]];
  try {
    return [transcriberPython(uv), SERVER_ARGS];
  } catch (e) {
    throw new ActionError("voice-not-set-up", {
      message: e.message,
      run: SETUP_LINE,
    });
  }
}

// ---- the kept-running transcriber

let tr = null; // { child, ready, answer: { resolve, reject } | null, err, idle }

const lastLine = (text) =>
  text.trim().split(/\r?\n/).pop()?.slice(0, 300) || "no message";

function gone(me, why) {
  if (tr === me) tr = null;
  clearTimeout(me.idle);
  if (me.answer) me.answer.reject(new Error(why));
  me.answer = null;
  log("voice", why.slice(0, 200));
}

// Stops a transcriber that is to answer nothing more. One still there KILL_WAIT_MS later (its stop signal failed or
// was ignored) is killed hard; each failed kill is logged.
function stopTranscriber(me) {
  const { child } = me;
  if (!child.kill())
    log("voice", "the transcriber did not take the stop signal");
  const hard = setTimeout(() => {
    if (child.exitCode !== null || child.signalCode !== null) return;
    log("voice", "the transcriber still runs: killed hard");
    if (!child.kill("SIGKILL"))
      log("voice", "the transcriber could not be killed");
  }, KILL_WAIT_MS);
  hard.unref?.();
  child.once("exit", () => clearTimeout(hard));
}

function idleLater(me) {
  clearTimeout(me.idle);
  me.idle = setTimeout(() => me.child.kill(), IDLE_MS);
  me.idle.unref?.();
}

function onLine(me, line) {
  let m;
  try {
    m = JSON.parse(line);
  } catch {
    return log("voice", "the transcriber wrote a line that is not JSON");
  }
  if (m?.ready === true) {
    me.ready = true;
    return log("voice", "the transcriber is ready");
  }
  const a = me.answer;
  me.answer = null;
  if (!a) return log("voice", "an answer without a job");
  if (typeof m?.text === "string") a.resolve(m.text);
  else a.reject(new Error(String(m?.error ?? "no text and no error")));
}

function startTranscriber() {
  if (tr) return tr;
  const [cmd, args] = command();
  const child = spawn(cmd, args, {
    stdio: ["pipe", "pipe", "pipe"],
    shell: false,
    windowsHide: true,
  });
  const me = { child, ready: false, answer: null, err: "", idle: null };
  tr = me;
  let buf = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (c) => {
    buf += c;
    for (let nl = buf.indexOf("\n"); nl >= 0; nl = buf.indexOf("\n")) {
      onLine(me, buf.slice(0, nl));
      buf = buf.slice(nl + 1);
    }
  });
  child.stderr.setEncoding("utf8");
  child.stderr.on("data", (c) => {
    me.err = (me.err + c).slice(-4000);
  });
  child.stdin.on("error", () => {});
  // A start that fails finds the Python again next time: the environment may have moved since.
  child.on("error", (e) => {
    found = null;
    gone(me, `the transcriber did not start: ${e.message}`);
  });
  child.on("exit", (code) => {
    if (!me.ready) found = null;
    gone(
      me,
      `the transcriber stopped (exit code ${code}): ${lastLine(me.err)}`,
    );
  });
  idleLater(me);
  log("voice", "transcriber started");
  return me;
}

// One file to text through the transcriber; rejects with the transcriber's own error.
function transcribe(file) {
  const me = startTranscriber();
  clearTimeout(me.idle);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      // The next job starts a new transcriber: this one is stopping and answers nothing more.
      if (tr === me) tr = null;
      me.answer = null;
      stopTranscriber(me);
      reject(new Error("the transcriber took over 10 minutes: stopped"));
    }, JOB_MS);
    me.answer = {
      resolve: (t) => {
        clearTimeout(timer);
        resolve(t);
      },
      reject: (e) => {
        clearTimeout(timer);
        reject(e);
      },
    };
    me.child.stdin.write(`${JSON.stringify({ file })}\n`);
  }).finally(() => {
    if (tr === me) idleLater(me);
  });
}

// ---- jobs: one at a time, each kept 10 minutes after it ends for voice.result

const jobs = new Map(); // id -> { device, done, text, error, finished }
let line = Promise.resolve();

// Deletes the recordings a stopped program left (over LEFT_MS old); at start and before each new job. Each file is
// tried on its own: one another program holds, or one that cannot be looked at, is logged and tried again next time.
function cleanVoice(now = Date.now()) {
  const dir = voiceDir();
  if (!fs.existsSync(dir)) return;
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    try {
      const st = fs.statSync(p);
      if (st.isFile() && now - st.mtimeMs > LEFT_MS)
        fs.rmSync(p, { force: true });
    } catch (e) {
      if (e.code === "ENOENT") continue; /* its job ended meanwhile */
      log(
        "voice",
        `an old recording was not deleted: ${e.code ?? e.message.slice(0, 200)}`,
      );
    }
  }
}

function queueJob(device, bytes, ext) {
  const id = randomBytes(12).toString("base64url");
  const dir = voiceDir();
  cleanVoice();
  fs.mkdirSync(dir, { recursive: true });
  const file = checkPath(
    path.join(dir, `${randomBytes(12).toString("hex")}.${ext}`),
    {
      write: true,
    },
  );
  try {
    fs.writeFileSync(file, bytes, { mode: 0o600 });
  } catch (e) {
    // A write that failed half way leaves no part of the recording behind.
    fs.rmSync(file, { force: true });
    throw e;
  }
  const job = { device, done: false, text: null, error: null, finished: null };
  job.finished = line = line.then(async () => {
    try {
      job.text = await transcribe(file);
      log("voice", `job done: ${bytes.length} bytes`);
    } catch (e) {
      job.error = e.message;
      log("voice", `job failed: ${e.message.slice(0, 200)}`);
    } finally {
      fs.rmSync(file, { force: true });
      job.done = true;
      setTimeout(() => jobs.delete(id), KEEP_DONE_MS).unref?.();
    }
  });
  jobs.set(id, job);
  return id;
}

export function register(registry) {
  cleanVoice();
  registry.add({
    name: "voice.warm",
    run() {
      return { ready: startTranscriber().ready };
    },
  });

  registry.add({
    name: "voice.transcribe",
    input: { stream: { type: "string", min: 1, max: 64, pattern: ID } },
    run({ stream }, ctx) {
      const got = ctx.takeStream(stream);
      if (!got) throw new ActionError("no-stream");
      if (got.bytes.length > AUDIO_MAX)
        throw new ActionError("too-big", { bytes: got.bytes.length });
      const waiting = [...jobs.values()].filter(
        (j) => j.device === ctx.device && !j.done,
      ).length;
      if (waiting >= JOBS_WAITING_MAX)
        throw new ActionError("too-many-jobs", {
          message: `the PC is still writing out ${waiting} recordings of this phone; send this one when one is through`,
        });
      const ext = EXT[got.mime.split(";")[0].trim().toLowerCase()];
      if (!ext)
        throw new ActionError("unknown-audio", {
          mime: got.mime.slice(0, 100),
        });
      command(); // set up, before anything is written
      return { job: queueJob(ctx.device, got.bytes, ext) };
    },
  });

  // { done: false } while the job runs (asked again by the page), { done: true, text } when it is through.
  registry.add({
    name: "voice.result",
    input: { job: { type: "string", min: 1, max: 64, pattern: ID } },
    async run({ job }, ctx) {
      const j = jobs.get(job);
      if (!j || j.device !== ctx.device) throw new ActionError("no-job");
      if (!j.done) {
        let timer;
        await Promise.race([
          j.finished,
          new Promise((r) => {
            timer = setTimeout(r, RESULT_WAIT_MS);
          }),
        ]);
        clearTimeout(timer);
      }
      if (!j.done) return { done: false };
      if (j.error)
        throw new ActionError("transcribe-failed", { message: j.error });
      return { done: true, text: j.text };
    },
  });
}
