// Voice to text (PC program design, section 7; actions 29 and 30). A transcriber that stays running
// (voice/transcribe-server.py, the speech model loaded once) is started on voice.warm, which the page sends when
// the user taps record, so its start-up of about 26 s runs while he speaks. The recording comes as a stream of the
// sealed channel; voice.transcribe writes it to %TEMP%\phone-app-voice\<random>.<ext>, queues the job and answers
// at once with a job id, and voice.result waits up to 20 s for the text. So no request outlasts the page's 30 s
// answer time, however long the speech is, and a job survives the page going to sleep. The audio file is
// deleted after the job, also when it fails. The transcriber stops after 15 minutes without a job.
// It is one of the three programs the PC program may start: a fixed command line, no shell.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { appDir, checkPath, readText } from "../core/files.mjs";
import { log } from "../core/log.mjs";
import { testOverride } from "../core/mode.mjs";
import { ActionError } from "../core/registry.mjs";

const PC_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const SERVER = path.join(PC_DIR, "voice", "transcribe-server.py");
export const MODEL = "small";
export const MODEL_MB = 480;
// The line probe 7 timed, with the server in place of transcribe.py.
export const UV_ARGS = [
  "run",
  "--no-project",
  "--with",
  "faster-whisper",
  "--with",
  "av<16",
  "python",
  "-I",
  SERVER,
];
const SETUP_LINE = `node ${path.join(PC_DIR, "setup.mjs")} voice`;

const IDLE_MS = 15 * 60 * 1000;
const JOB_MS = 10 * 60 * 1000;
const RESULT_WAIT_MS = 20_000;
const KEEP_DONE_MS = 10 * 60 * 1000;
const JOBS_WAITING_MAX = 2; // jobs of one device not yet through: each holds up to 25 MB in %TEMP%
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
const voiceDir = () => path.join(os.tmpdir(), "phone-app-voice");

// uv on the PATH, or null.
export function findUv() {
  const names = process.platform === "win32" ? ["uv.exe"] : ["uv"];
  for (const dir of (process.env.PATH || "").split(path.delimiter))
    for (const n of names)
      if (dir && fs.existsSync(path.join(dir, n))) return path.join(dir, n);
  return null;
}

// The program and arguments of the transcriber; ActionError voice-not-set-up with the line to run when uv or the
// model is missing. In test mode PHONE_PC_TRANSCRIBER names a Node script speaking the same lines.
function command() {
  const uv = findUv();
  if (!uv)
    throw new ActionError("voice-not-set-up", {
      message: "uv is not installed",
      run: SETUP_LINE,
    });
  // No marker, or one that does not read, means the setup step has not finished.
  let marker;
  try {
    marker = JSON.parse(readText(markerPath()));
  } catch {
    marker = null;
  }
  if (marker?.model !== MODEL)
    throw new ActionError("voice-not-set-up", {
      message: "the speech model is not downloaded",
      run: SETUP_LINE,
    });
  const fake = testOverride("PHONE_PC_TRANSCRIBER");
  return fake ? [process.execPath, [fake]] : [uv, UV_ARGS];
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
  child.on("error", (e) =>
    gone(me, `the transcriber did not start: ${e.message}`),
  );
  child.on("exit", (code) =>
    gone(
      me,
      `the transcriber stopped (exit code ${code}): ${lastLine(me.err)}`,
    ),
  );
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
      me.child.kill();
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

function queueJob(device, bytes, ext) {
  const id = randomBytes(12).toString("base64url");
  const dir = voiceDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = checkPath(
    path.join(dir, `${randomBytes(12).toString("hex")}.${ext}`),
    {
      write: true,
    },
  );
  fs.writeFileSync(file, bytes, { mode: 0o600 });
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
