#!/usr/bin/env node
import { execFileSync, spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
// watch.mjs: turns a video into things a model can read cheaply.
//   node watch.mjs <link or video file>                        the words (subtitles) and an overview: 6 sheets of stills
//   node watch.mjs <link or video file> --from 2:10 --to 2:20  a close look at one stretch (about 5 stills a second)
//   node watch.mjs --get-model                                 downloads the speech-to-text model (once, 574 MB)
// Options: --every <seconds> between stills, --sheets <n> (default 6), --out <folder> for the sheets,
//          --no-frames (words only, no video is downloaded), --lang <code> for the subtitles and the speech,
//          --listen (turn the sound into text even when subtitles exist), --model <name> (another whisper model).
// A sheet is 3 x 3 stills in order, each with its time in the corner, so one picture shows a sequence.
// Everything about one video is kept in ~/.claude/video-cache/<id> (WATCH_HOME moves it): info.json,
// transcript.txt, video.mp4 (720p at most, no sound), audio.* (only when it listened) and the sheets,
// so a second look downloads nothing.
// The words: subtitles first; with none (or refused, HTTP 429) the sound is turned into text on this
// computer: ffmpeg's whisper filter with the model in ~/.claude/video-cache/models (WATCH_WHISPER_MODEL
// names another file), else faster-whisper through uv on the CPU. Audio over 10 minutes runs as pieces
// side by side when the engine gains from it (WATCH_STT_JOBS sets how many). WATCH_STT names a .mjs
// stand-in engine (the test's): node <it> <audio> <srt out> <language>.
// Needs ffmpeg, and for links yt-dlp (on PATH, or it is run through uvx). YT_DLP names another yt-dlp.
// On a Mac it needs Homebrew's ffmpeg-full: the plain ffmpeg there cannot write the time on a still.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const HOME =
  process.env.WATCH_HOME || path.join(os.homedir(), ".claude", "video-cache");
// Homebrew does not put ffmpeg-full on PATH, so it is looked up where Homebrew keeps it.
const BREW_FULL = [
  "/opt/homebrew/opt/ffmpeg-full/bin",
  "/usr/local/opt/ffmpeg-full/bin",
].find((d) => fs.existsSync(path.join(d, "ffmpeg")));
const tool = (name) => (BREW_FULL ? path.join(BREW_FULL, name) : name);
const PER_SHEET = 9;
const stop = (msg, code = 1) => {
  console.error(msg);
  process.exit(code);
};
const USAGE =
  "usage: node watch.mjs <link or video file> [--from m:ss] [--to m:ss] [--every seconds] [--sheets n] [--out folder] [--no-frames] [--lang code] [--listen] [--model name]\n       node watch.mjs --get-model [--model name]";

const flags = {};
const rest = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--no-frames") flags.noFrames = true;
  else if (a === "--listen") flags.listen = true;
  else if (a === "--get-model") flags.getModel = true;
  else if (
    [
      "--from",
      "--to",
      "--every",
      "--sheets",
      "--out",
      "--lang",
      "--model",
    ].includes(a)
  ) {
    if (argv[i + 1] === undefined) stop(`${a} needs a value\n${USAGE}`, 2);
    flags[a.slice(2)] = argv[++i];
  } else if (a.startsWith("--")) stop(`unknown option ${a}\n${USAGE}`, 2);
  else rest.push(a);
}
if (flags.model !== undefined && !/^[\w.-]+$/.test(flags.model))
  stop(
    `--model ${flags.model}: a model name such as small or large-v3-turbo-q5_0`,
    2,
  );

// The speech-to-text model for ffmpeg's whisper filter. It is downloaded only by --get-model, never on its own.
const DEFAULT_MODEL = "large-v3-turbo-q5_0";
const MODEL_SIZES = {
  "large-v3-turbo-q5_0": "574 MB",
  "large-v3-turbo": "1.6 GB",
  small: "488 MB",
  "small.en": "488 MB",
  base: "148 MB",
  tiny: "78 MB",
};
const modelName =
  flags.model ||
  (process.env.WATCH_WHISPER_MODEL
    ? path
        .basename(process.env.WATCH_WHISPER_MODEL)
        .replace(/^ggml-|\.bin$/g, "")
    : DEFAULT_MODEL);
const modelFile =
  flags.model || !process.env.WATCH_WHISPER_MODEL
    ? path.join(HOME, "models", `ggml-${modelName}.bin`)
    : process.env.WATCH_WHISPER_MODEL;
const modelUrl = `https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-${modelName}.bin`;
const modelSize = MODEL_SIZES[modelName] || "size not known here";

if (flags.getModel) {
  if (rest.length) stop("--get-model takes no video; run it on its own", 2);
  if (fs.existsSync(modelFile)) {
    console.log(
      `Model already here: ${modelFile} (${(fs.statSync(modelFile).size / 1e6).toFixed(0)} MB)`,
    );
    process.exit(0);
  }
  console.log(`Downloading ${modelUrl} (${modelSize}) to ${modelFile}`);
  fs.mkdirSync(path.dirname(modelFile), { recursive: true });
  const part = `${modelFile}.part`;
  const res = await fetch(modelUrl);
  if (!res.ok) stop(`the download failed: HTTP ${res.status} from ${modelUrl}`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(part));
  fs.renameSync(part, modelFile);
  console.log(
    `Model saved: ${modelFile} (${(fs.statSync(modelFile).size / 1e6).toFixed(0)} MB)`,
  );
  process.exit(0);
}
if (rest.length !== 1) stop(USAGE, 2);
const source = rest[0];

function seconds(text, name) {
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text))
    stop(`--${name} ${text}: write a time as 95, 1:35 or 1:02:03`, 2);
  return text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}
function clock(s) {
  const whole = Math.floor(s);
  const tenth = Math.round((s - whole) * 10);
  const [h, m, sec] = [
    Math.floor(whole / 3600),
    Math.floor((whole % 3600) / 60),
    whole % 60,
  ];
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}${tenth ? `.${tenth}` : ""}`;
}

const isLink = /^https?:\/\//i.test(source);
let id;
if (isLink) {
  id =
    source.match(
      /(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/,
    )?.[1] ||
    crypto.createHash("sha1").update(source).digest("hex").slice(0, 12);
} else {
  if (!fs.existsSync(source)) stop(`not found: ${source}`);
  const stat = fs.statSync(source);
  id = `${path
    .parse(source)
    .name.replace(/[^\w-]+/g, "_")
    .slice(0, 40)}-${crypto
    .createHash("sha1")
    .update(`${path.resolve(source)}|${stat.size}|${stat.mtimeMs}`)
    .digest("hex")
    .slice(0, 8)}`;
}
const dir = path.join(HOME, id);
fs.mkdirSync(dir, { recursive: true });

let ytCommand;
function yt(args, options = {}) {
  if (!ytCommand) {
    // YT_DLP may also name a .mjs/.js stand-in, which runs under this node (the test's fake yt-dlp)
    const own =
      process.env.YT_DLP &&
      (/\.m?js$/.test(process.env.YT_DLP)
        ? [process.execPath, process.env.YT_DLP]
        : [process.env.YT_DLP]);
    const tries = [own, ["yt-dlp"], ["uvx", "--with", "deno", "yt-dlp"]].filter(
      Boolean,
    );
    ytCommand = tries.find(
      (t) =>
        spawnSync(t[0], [...t.slice(1), "--version"], { stdio: "ignore" })
          .status === 0,
    );
    if (!ytCommand)
      stop(
        `yt-dlp is not available (tried: ${tries.map((t) => t.join(" ")).join(", ")}). Install uv or yt-dlp.`,
      );
  }
  return spawnSync(
    ytCommand[0],
    [...ytCommand.slice(1), "--no-warnings", "--no-playlist", ...args],
    { encoding: "utf8", maxBuffer: 300 * 1024 * 1024, ...options },
  );
}

// 1. What the video is
const infoFile = path.join(dir, "info.json");
let info;
if (fs.existsSync(infoFile))
  info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
else if (isLink) {
  const run = yt(["-J", source]);
  if (run.status !== 0)
    stop(
      `yt-dlp could not read ${source}:\n${(run.stderr || "").trim().split("\n").slice(-5).join("\n")}`,
    );
  const full = JSON.parse(run.stdout);
  info = {
    id,
    source,
    title: full.title,
    channel: full.channel || full.uploader,
    duration: full.duration,
    language: full.language,
    chapters: (full.chapters || []).map((c) => ({
      start: c.start_time,
      title: c.title,
    })),
    subtitles: Object.keys(full.subtitles || {}).filter(
      (k) => k !== "live_chat",
    ),
    automatic: Object.keys(full.automatic_captions || {}),
  };
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
} else {
  info = {
    id,
    source: path.resolve(source),
    title: path.basename(source),
    duration: probeLength(source),
    chapters: [],
    subtitles: [],
    automatic: [],
  };
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
}
function probeLength(file) {
  const probe = execFileSync(
    tool("ffprobe"),
    ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file],
    { encoding: "utf8" },
  );
  const length = Number(probe.trim());
  if (!(length > 0)) stop(`ffprobe could not read the length of ${file}`);
  return length;
}
// Some sites (Instagram) give no length; it is then measured from the downloaded video in step 3
const hasLength = info.duration > 0;
console.log(
  `${info.title}${info.channel ? ` | ${info.channel}` : ""} | ${hasLength ? clock(info.duration) : "length not given, measured after the download"}`,
);
for (const c of info.chapters)
  console.log(`  chapter ${clock(c.start)}  ${c.title}`);

// Listening: the sound turned into text on this computer
// A path inside a filter option: \ becomes /, and : and ' are escaped twice (once for the option, once for the graph)
const filterPath = (p) =>
  p.replace(/\\/g, "/").replace(/:/g, "\\\\:").replace(/'/g, "\\\\\\'");
const runAsync = (cmd, args) =>
  new Promise((done) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err = (err + d).slice(-4000);
    });
    child.on("error", (e) => done({ code: -1, err: String(e) }));
    child.on("exit", (code) => done({ code, err }));
  });
const FASTER_WHISPER = `import sys
from faster_whisper import WhisperModel
audio, out, name, lang, threads = sys.argv[1:6]
model = WhisperModel(name, device="cpu", compute_type="int8", cpu_threads=int(threads))
segments, _ = model.transcribe(audio, language=None if lang == "auto" else lang, vad_filter=True)
def stamp(x):
    return f"{int(x // 3600):02}:{int(x % 3600 // 60):02}:{x % 60:06.3f}"
with open(out, "w", encoding="utf-8") as f:
    for i, s in enumerate(segments, 1):
        f.write(f"{i}\\n{stamp(s.start)} --> {stamp(s.end)}\\n{s.text.strip()}\\n\\n")
`;
function engine() {
  const jobs = process.env.WATCH_STT_JOBS
    ? Number(process.env.WATCH_STT_JOBS)
    : null;
  if (jobs !== null && !(Number.isInteger(jobs) && jobs >= 1))
    stop(
      `WATCH_STT_JOBS=${process.env.WATCH_STT_JOBS}: a whole number, 1 or more`,
      2,
    );
  if (process.env.WATCH_STT) {
    return {
      label: `stand-in ${path.basename(process.env.WATCH_STT)}`,
      jobs: jobs || 1,
      transcribe: (audio, srt, lang) =>
        runAsync(process.execPath, [process.env.WATCH_STT, audio, srt, lang]),
    };
  }
  const filters = spawnSync(
    tool("ffmpeg"),
    ["-hide_banner", "-h", "filter=whisper"],
    { encoding: "utf8" },
  );
  if (/Filter whisper/.test(filters.stdout || "")) {
    if (!fs.existsSync(modelFile))
      return {
        missing: `speech-to-text needs the model ${modelFile}: node watch.mjs --get-model${flags.model ? ` --model ${flags.model}` : ""} downloads it (${modelSize} from ${modelUrl})`,
      };
    // One process: on a GPU (whisper.cpp's default) two side by side were no faster than one (measured 2026-11-12)
    return {
      label: `whisper ${modelName}`,
      jobs: jobs || 1,
      transcribe: (audio, srt, lang) =>
        runAsync(tool("ffmpeg"), [
          "-v",
          "error",
          "-y",
          "-i",
          audio,
          "-vn",
          "-af",
          `whisper=model=${filterPath(modelFile)}:language=${lang}:format=srt:destination=${filterPath(srt)}:queue=20`,
          "-f",
          "null",
          "-",
        ]),
    };
  }
  // faster-whisper 1.2.1 cannot open audio with PyAV 16 ("unexpected keyword argument 'metadata_errors'", 2026-11-12)
  if (spawnSync("uv", ["--version"], { stdio: "ignore" }).status === 0) {
    const name = (flags.model || "small").replace(/-q\d.*$/, "");
    const n =
      jobs || Math.max(1, Math.min(4, Math.floor(os.cpus().length / 4)));
    const threads = String(Math.max(1, Math.floor(os.cpus().length / n)));
    return {
      label: `faster-whisper ${name} on the CPU (it fetches the model on first use)`,
      jobs: n,
      transcribe: (audio, srt, lang) =>
        runAsync("uv", [
          "run",
          "--no-project",
          "--with",
          "faster-whisper==1.2.1",
          "--with",
          "av<16",
          "python",
          "-c",
          FASTER_WHISPER,
          audio,
          srt,
          name,
          lang,
          threads,
        ]),
    };
  }
  return {
    missing:
      "this ffmpeg has no whisper filter and uv is not installed for faster-whisper",
  };
}
function hasSound(file) {
  const probe = spawnSync(
    tool("ffprobe"),
    [
      "-v",
      "error",
      "-select_streams",
      "a",
      "-show_entries",
      "stream=index",
      "-of",
      "csv=p=0",
      file,
    ],
    { encoding: "utf8" },
  );
  return probe.status === 0 && probe.stdout.trim() !== "";
}
function downloadAudio() {
  const have = () =>
    fs.readdirSync(dir).find((f) => /^audio\.(?!part$)[\w]+$/.test(f));
  if (!have()) {
    const got = yt(
      ["-f", "ba[ext=m4a]/ba", "-o", path.join(dir, "audio.%(ext)s"), source],
      { stdio: ["ignore", "ignore", "pipe"] },
    );
    if (got.status !== 0 || !have())
      return {
        error: `yt-dlp could not download the sound: ${(got.stderr || "").trim().split("\n").pop()}`,
      };
  }
  return { file: path.join(dir, have()) };
}
// Where to cut long audio into n pieces: at each n-th of the length, moved to the middle of the nearest
// silence when one is close, so no word is cut in two
function cutPoints(audio, length, n) {
  const probe = spawnSync(
    tool("ffmpeg"),
    [
      "-hide_banner",
      "-nostats",
      "-i",
      audio,
      "-vn",
      "-af",
      "silencedetect=n=-35dB:d=0.4",
      "-f",
      "null",
      "-",
    ],
    { encoding: "utf8", maxBuffer: 50 * 1024 * 1024 },
  );
  const silences = [];
  for (const m of (probe.stderr || "").matchAll(
    /silence_(start|end): ([\d.]+)/g,
  )) {
    if (m[1] === "start") silences.push({ start: Number(m[2]), end: length });
    else if (silences.length) silences[silences.length - 1].end = Number(m[2]);
  }
  const starts = [0];
  for (let k = 1; k < n; k++) {
    const target = (length * k) / n;
    const inside = silences.find((s) => s.start <= target && target <= s.end);
    const near = silences
      .map((s) => (s.start + s.end) / 2)
      .filter(
        (mid) =>
          Math.abs(mid - target) < length / (2 * n) &&
          mid > starts[starts.length - 1] + 1,
      )
      .sort((a, b) => Math.abs(a - target) - Math.abs(b - target))[0];
    starts.push(inside ? target : (near ?? target));
  }
  return starts;
}
// An srt file to "[m:ss] text" lines, its times moved on by offset seconds
function srtLines(text, offset) {
  const lines = [];
  for (const block of text.split(/\r?\n\s*\r?\n/)) {
    const rows = block.split(/\r?\n/);
    const at = rows.findIndex((r) => r.includes("-->"));
    const t = at >= 0 && rows[at].match(/(\d+):(\d\d):(\d\d)[.,](\d+)/);
    if (!t) continue;
    const words = rows
      .slice(at + 1)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (words)
      lines.push(
        `[${clock(Math.floor(Number(t[1]) * 3600 + Number(t[2]) * 60 + Number(t[3]) + offset))}] ${words}`,
      );
  }
  return lines;
}
async function listen(subtitlesWhy) {
  const lead = subtitlesWhy ? `${subtitlesWhy}; ` : "";
  let audio;
  let stt;
  if (isLink) {
    stt = engine();
    if (stt.missing) return console.log(`Words: none (${lead}${stt.missing})`);
    const got = downloadAudio();
    if (got.error) return console.log(`Words: none (${lead}${got.error})`);
    audio = got.file;
  } else {
    if (!hasSound(source))
      return console.log(`Words: none (${lead}this file has no sound)`);
    audio = path.resolve(source);
    stt = engine();
    if (stt.missing) return console.log(`Words: none (${lead}${stt.missing})`);
  }
  const length = probeLength(audio);
  const starts =
    stt.jobs > 1 && length > 600 ? cutPoints(audio, length, stt.jobs) : [0];
  console.log(
    `Listening: ${stt.label}${subtitlesWhy ? ` (${subtitlesWhy})` : ""}, ${clock(length)} of sound${starts.length > 1 ? ` in ${starts.length} pieces side by side` : ""}`,
  );
  const work = path.join(dir, "listen");
  fs.rmSync(work, { recursive: true, force: true });
  fs.mkdirSync(work);
  // --lang names the spoken language only with --listen: a --lang that asked for a translated subtitle
  // track must not make the engine hear the speech in that language (the result is kept)
  const lang = flags.lang && flags.listen ? flags.lang.split("-")[0] : "auto";
  const began = Date.now();
  const pieces = starts.map((start, i) => ({
    start,
    end: starts[i + 1] ?? length,
    srt: path.join(work, `piece-${i + 1}.srt`),
    sound: starts.length > 1 ? path.join(work, `piece-${i + 1}.wav`) : audio,
  }));
  for (const p of pieces.filter((p) => p.sound !== audio)) {
    const cut = spawnSync(
      tool("ffmpeg"),
      [
        "-v",
        "error",
        "-y",
        "-ss",
        String(p.start),
        "-to",
        String(p.end),
        "-i",
        audio,
        "-vn",
        "-ac",
        "1",
        "-ar",
        "16000",
        p.sound,
      ],
      { encoding: "utf8" },
    );
    if (cut.status !== 0) {
      fs.rmSync(work, { recursive: true, force: true });
      return console.log(
        `Words: none this time (${lead}ffmpeg could not cut the sound at ${clock(p.start)}: ${(cut.stderr || "").trim().split("\n").pop()}). Run again later.`,
      );
    }
  }
  const results = await Promise.all(
    pieces.map((p) => stt.transcribe(p.sound, p.srt, lang)),
  );
  // A failed run (a graphics card out of memory, no network for uv) leaves the words out; the stills still come
  const bad = pieces.findIndex(
    (p, i) => results[i].code !== 0 || !fs.existsSync(p.srt),
  );
  if (bad >= 0) {
    fs.rmSync(work, { recursive: true, force: true });
    return console.log(
      `Words: none this time (${lead}speech-to-text (${stt.label}) failed${pieces.length > 1 ? ` on the piece from ${clock(pieces[bad].start)}` : ""}: ${results[bad].err.trim().split("\n").slice(-3).join(" / ")}). Run again later.`,
    );
  }
  const lines = pieces.flatMap((p) =>
    srtLines(fs.readFileSync(p.srt, "utf8"), p.start),
  );
  fs.rmSync(work, { recursive: true, force: true });
  const took = ((Date.now() - began) / 1000).toFixed(0);
  if (!lines.length) {
    // kept, so a second look does not listen to the whole sound again (--listen does)
    fs.writeFileSync(
      noSpeechFile,
      `no speech heard (${stt.label.replace(/ \(.*\)$/, "")})\n`,
    );
    return console.log(
      `Words: none (${lead}no speech heard in ${took} s of listening)`,
    );
  }
  fs.rmSync(noSpeechFile, { force: true });
  fs.writeFileSync(
    wordsFile,
    `Speech-to-text: ${stt.label.replace(/ \(.*\)$/, "")} (local, expect wrong names)\n${lines.join("\n")}\n`,
  );
  console.log(
    `Words: ${wordsFile} (${lines.length} lines, speech-to-text in ${took} s, expect wrong names)`,
  );
}

// 2. The words: subtitles someone wrote, else the automatic ones in the language that is spoken,
// else the sound turned into text on this computer
const wordsFile = path.join(dir, "transcript.txt");
const noWordsFile = path.join(dir, "no-transcript.txt");
const noSpeechFile = path.join(dir, "no-speech.txt");
const kept = fs.existsSync(wordsFile)
  ? fs.readFileSync(wordsFile, "utf8")
  : null;
if (kept !== null && !(flags.listen && kept.startsWith("Subtitles:"))) {
  console.log(`Words: ${wordsFile} (${kept.split("\n").length - 2} lines)`);
} else if (fs.existsSync(noSpeechFile) && !flags.listen) {
  console.log(
    `Words: none (${fs.readFileSync(noSpeechFile, "utf8").trim()} on an earlier look; --listen listens again)`,
  );
} else if (!isLink || flags.listen) {
  await listen(null);
} else if (fs.existsSync(noWordsFile)) {
  await listen(fs.readFileSync(noWordsFile, "utf8").trim());
} else {
  const base = (code) => String(code || "").split("-")[0];
  const want = flags.lang
    ? [flags.lang]
    : [info.language, base(info.language), "en", "ru"].filter(Boolean);
  // Tracks to try, best first. YouTube's "-orig" track is the speech itself; its other automatic
  // tracks are translations of it and are often refused (HTTP 429), so they come last.
  const written = flags.lang
    ? want.filter((w) => info.subtitles.includes(w))
    : [
        ...want.filter((w) => info.subtitles.includes(w)),
        ...info.subtitles.slice(0, 1),
      ];
  const automatic = flags.lang
    ? want.filter((w) => info.automatic.includes(w))
    : [
        ...info.automatic.filter((k) => k.endsWith("-orig")),
        ...want.slice(0, 2).filter((w) => info.automatic.includes(w)),
      ];
  const tracks = [...new Set(written)]
    .map((lang) => [lang, "written by a person"])
    .concat(
      [...new Set(automatic)].map((lang) => [
        lang,
        "automatic, expect wrong words",
      ]),
    );
  const lines = [];
  let found;
  const failed = [];
  for (const [lang, kind] of tracks) {
    const run = yt([
      "--skip-download",
      "--write-subs",
      "--write-auto-subs",
      "--sub-langs",
      lang,
      "--sub-format",
      "json3",
      "-o",
      path.join(dir, "sub"),
      source,
    ]);
    const file = path.join(dir, `sub.${lang}.json3`);
    if (run.status !== 0 || !fs.existsSync(file)) {
      failed.push(`${lang}: ${(run.stderr || "").trim().split("\n").pop()}`);
      continue;
    }
    for (const event of JSON.parse(fs.readFileSync(file, "utf8")).events ||
      []) {
      const text = (event.segs || [])
        .map((s) => s.utf8 || "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();
      if (text)
        lines.push(`[${clock(Math.floor(event.tStartMs / 1000))}] ${text}`);
    }
    fs.rmSync(file);
    if (lines.length) {
      found = [lang, kind];
      break;
    }
  }
  if (found) {
    fs.writeFileSync(
      wordsFile,
      `Subtitles: ${found[0]} (${found[1]})\n${lines.join("\n")}\n`,
    );
    console.log(
      `Words: ${wordsFile} (${lines.length} lines, ${found[0]}, ${found[1]})`,
    );
  } else if (failed.length) {
    await listen(
      `yt-dlp could not download the subtitles; ${failed.join("; ")}`,
    );
  } else {
    const none = flags.lang
      ? `no subtitles in ${flags.lang}`
      : "this video has no subtitles";
    if (!flags.lang) fs.writeFileSync(noWordsFile, `${none}\n`);
    await listen(none);
  }
}
if (flags.noFrames) process.exit(0);

// 3. The pictures
const video = isLink ? path.join(dir, "video.mp4") : path.resolve(source);
function download() {
  if (fs.existsSync(video)) return;
  const run = yt(
    [
      "-f",
      "bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]/b",
      "--remux-video",
      "mp4",
      "-o",
      path.join(dir, "video.%(ext)s"),
      source,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (run.status !== 0 || !fs.existsSync(video))
    stop(
      `yt-dlp could not download the video:\n${(run.stderr || "").trim().split("\n").slice(-5).join("\n")}`,
    );
}
if (!hasLength) {
  download();
  info.duration = probeLength(video);
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
  console.log(`Length: ${clock(info.duration)}`);
}
const from = flags.from ? seconds(flags.from, "from") : 0;
const to = Math.min(
  flags.to ? seconds(flags.to, "to") : info.duration,
  info.duration,
);
if (!(to > from))
  stop(
    `--from ${clock(from)} has to be before --to ${clock(to)} (the video is ${clock(info.duration)} long)`,
    2,
  );
const sheets = flags.sheets ? Number(flags.sheets) : 6;
if (!Number.isInteger(sheets) || sheets < 1)
  stop("--sheets takes a whole number, 1 or more", 2);
const every = flags.every
  ? Number(flags.every)
  : Math.max(0.2, Math.ceil(((to - from) / (sheets * PER_SHEET)) * 10) / 10);
if (!(every > 0)) stop("--every takes a number of seconds above 0", 2);
const count = Math.ceil((to - from) / every);
if (count > 30 * PER_SHEET)
  stop(
    `that is ${count} stills on ${Math.ceil(count / PER_SHEET)} sheets: take a shorter stretch or a larger --every`,
    2,
  );

if (isLink) download();

const out = path.resolve(
  flags.out ||
    path.join(
      dir,
      `${clock(from)}-${clock(to)}-every-${every}s`.replace(/:/g, "m"),
    ),
);
fs.mkdirSync(out, { recursive: true });
for (const old of fs.readdirSync(out))
  if (/^sheet_\d+\.jpg$/.test(old)) fs.rmSync(path.join(out, old));
const stamp = `drawtext=font=Arial:text='%{pts\\:hms\\:${from}}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4`;
// select keeps real frames with their own times, so the time drawn on a still is the time it was taken at
const filter = `select='gte(t,selected_n*${every})',scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,${stamp},tile=3x3:padding=4`;
const run = spawnSync(
  tool("ffmpeg"),
  [
    "-v",
    "error",
    "-y",
    "-ss",
    String(from),
    "-to",
    String(to),
    "-i",
    video,
    "-an",
    "-vf",
    filter,
    "-fps_mode",
    "passthrough",
    "-q:v",
    "4",
    path.join(out, "sheet_%02d.jpg"),
  ],
  { encoding: "utf8" },
);
const made = fs
  .readdirSync(out)
  .filter((f) => /^sheet_\d+\.jpg$/.test(f))
  .sort();
if (/No such filter: 'drawtext'/.test(run.stderr || ""))
  stop(
    "This ffmpeg cannot write the time on a still (it has no drawtext filter). On a Mac: brew install ffmpeg-full",
  );
if (run.status !== 0 || !made.length)
  stop(
    `ffmpeg made no sheets:\n${(run.stderr || "").trim().split("\n").slice(-5).join("\n")}`,
  );
console.log(
  `Pictures: ${made.length} sheets in ${out}, one still every ${every} s, 9 on a sheet, read left to right, top to bottom`,
);
made.forEach((file, i) =>
  console.log(
    `  ${file}  ${clock(from + i * PER_SHEET * every)} to ${clock(Math.min(to, from + (i + 1) * PER_SHEET * every))}`,
  ),
);
