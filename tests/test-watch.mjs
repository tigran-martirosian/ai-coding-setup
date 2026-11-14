#!/usr/bin/env node
import { spawnSync } from "node:child_process";
// Test of skills/watch/watch.mjs on a 20-second video that ffmpeg draws here (no network).
// WATCH_SCRIPT points the test at another copy of the script (default: this repo's).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const script =
  process.env.WATCH_SCRIPT ||
  fileURLToPath(new URL("../skills/watch/watch.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "watch-test-"));
const home = path.join(tmp, "cache");
const video = path.join(tmp, "clip one.mp4");
const made = spawnSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc=duration=20:size=640x360:rate=10",
  "-pix_fmt",
  "yuv420p",
  video,
]);
if (made.status !== 0) {
  console.error("ffmpeg could not draw the test video");
  process.exit(1);
}

const watch = (...args) => {
  const run = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, WATCH_HOME: home },
  });
  return { code: run.status, out: run.stdout || "", err: run.stderr || "" };
};
const sheetsIn = (dir) =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .filter((f) => /^sheet_\d+\.jpg$/.test(f))
        .sort()
    : [];
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++;
  else {
    fail++;
    console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`);
  }
};

const all = path.join(tmp, "all");
let r = watch(video, "--out", all);
check("whole video: exit 0", r.code === 0, r.err);
check(
  "whole video: title and length",
  /clip one\.mp4 \| 0:20/.test(r.out),
  r.out,
);
check("whole video: a file has no words", /Words: none/.test(r.out), r.out);
check(
  "whole video: 6 sheets, one still every 0.4 s",
  /6 sheets in .* one still every 0\.4 s/.test(r.out) &&
    sheetsIn(all).length === 6,
  r.out,
);
check(
  "whole video: last sheet ends at the end",
  /sheet_06\.jpg {2}0:18 to 0:20/.test(r.out),
  r.out,
);
check(
  "info.json kept",
  fs.readdirSync(home).length === 1 &&
    fs.existsSync(path.join(home, fs.readdirSync(home)[0], "info.json")),
);

const close = path.join(tmp, "close");
r = watch(
  video,
  "--from",
  "0:05",
  "--to",
  "0:08",
  "--sheets",
  "1",
  "--out",
  close,
);
check(
  "stretch: one sheet",
  r.code === 0 && sheetsIn(close).length === 1,
  r.out + r.err,
);
check(
  "stretch: times start at --from",
  /sheet_01\.jpg {2}0:05 to 0:08/.test(r.out),
  r.out,
);

r = watch(video, "--from", "5", "--to", "9", "--every", "0.2", "--out", close);
check(
  "--every 0.2 over 4 s: 20 stills on 3 sheets, old sheets replaced",
  r.code === 0 && sheetsIn(close).length === 3,
  r.out + r.err,
);

r = watch(video, "--from", "2", "--to", "4");
const kept = r.out.match(/sheets in (.+?), one still/)?.[1];
check(
  "no --out: sheets go into the cache folder",
  r.code === 0 && kept && kept.startsWith(home) && sheetsIn(kept).length > 0,
  r.out + r.err,
);

r = watch(video, "--no-frames");
check(
  "--no-frames: no sheets",
  r.code === 0 && !/Pictures:/.test(r.out),
  r.out,
);

r = watch(video, "--from", "0:10", "--to", "0:05");
check(
  "--from after --to: refused",
  r.code === 2 && /has to be before/.test(r.err),
  r.err,
);
r = watch(video, "--from", "abc");
check(
  "a time that is no time: refused",
  r.code === 2 && /write a time as/.test(r.err),
  r.err,
);
r = watch(video, "--every", "0.01");
check(
  "too many stills: refused",
  r.code === 2 && /shorter stretch/.test(r.err),
  r.err,
);
r = watch(video, "--wat");
check(
  "unknown option: refused",
  r.code === 2 && /unknown option/.test(r.err),
  r.err,
);
r = watch();
check("no video: usage", r.code === 2 && /usage:/.test(r.err), r.err);
r = watch(path.join(tmp, "missing.mp4"));
check(
  "missing file: clear error",
  r.code === 1 && /not found/.test(r.err),
  r.err,
);

// A link whose site gives no length (Instagram): a fake yt-dlp copies the test video as the download
const fake = path.join(tmp, "fake-yt-dlp.mjs");
fs.writeFileSync(
  fake,
  `import fs from "node:fs";
const a = process.argv.slice(2);
if (a.includes("--version")) process.exit(0);
if (a.includes("-J")) { console.log(JSON.stringify({ title: "Reel", uploader: "someone" })); process.exit(0); }
const o = a[a.indexOf("-o") + 1];
if (o && o.includes("video.")) fs.copyFileSync(${JSON.stringify(video)}, o.replace("%(ext)s", "mp4"));
`,
);
const linkRun = spawnSync(
  "node",
  [script, "https://www.instagram.com/reel/TEST123/"],
  { encoding: "utf8", env: { ...process.env, WATCH_HOME: home, YT_DLP: fake } },
);
check(
  "link without a length: exit 0",
  linkRun.status === 0,
  linkRun.stdout + linkRun.stderr,
);
check(
  "link without a length: says so, then measures 0:20",
  /length not given/.test(linkRun.stdout) &&
    /Length: 0:20/.test(linkRun.stdout),
  linkRun.stdout,
);
check(
  "link without a length: 6 sheets to the end",
  /sheet_06\.jpg {2}0:18 to 0:20/.test(linkRun.stdout),
  linkRun.stdout,
);

// Listening. Nothing here is ever played: sound is made into files only (no ffplay, no audio device).
// (a) A stand-in engine (WATCH_STT) writes an srt naming the piece it got; 12 minutes of quiet sound in 3 pieces
const quiet = path.join(tmp, "quiet talk.m4a");
spawnSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "anullsrc=r=16000:cl=mono",
  "-t",
  "720",
  "-c:a",
  "aac",
  quiet,
]);
const fakeStt = path.join(tmp, "fake-stt.mjs");
fs.writeFileSync(
  fakeStt,
  `import fs from "node:fs";
import path from "node:path";
const [audio, srt, lang] = process.argv.slice(2);
fs.writeFileSync(srt, "1\\r\\n00:00:01,000 --> 00:00:02,000\\r\\npiece " + path.basename(audio) + "\\r\\nsaid in " + lang + "\\r\\n\\r\\n2\\r\\n00:00:03.500 --> 00:00:04.000\\r\\nsecond line\\r\\n\\r\\n3\\r\\n00:00:05.000 --> 00:00:06.000\\r\\n\\r\\n");
`,
);
const listenWith = (env, ...args) => {
  const ran = spawnSync("node", [script, ...args], {
    encoding: "utf8",
    env: { ...process.env, WATCH_HOME: home, ...env },
  });
  return { code: ran.status, out: ran.stdout || "", err: ran.stderr || "" };
};
r = listenWith(
  { WATCH_STT: fakeStt, WATCH_STT_JOBS: "3" },
  quiet,
  "--no-frames",
);
const quietWords = path.join(
  home,
  fs.readdirSync(home).find((d) => d.startsWith("quiet_talk")),
  "transcript.txt",
);
const heard = fs.existsSync(quietWords)
  ? fs.readFileSync(quietWords, "utf8")
  : "";
check(
  "listen: a file's sound is turned into text",
  r.code === 0 &&
    /Words: .*transcript\.txt \(6 lines, speech-to-text/.test(r.out),
  r.out + r.err,
);
check(
  "listen: 3 pieces side by side",
  /12:00 of sound in 3 pieces side by side/.test(r.out),
  r.out,
);
check(
  "listen: first line names the engine",
  heard.startsWith(
    "Speech-to-text: stand-in fake-stt.mjs (local, expect wrong names)\n",
  ),
  heard,
);
check(
  "listen: srt to lines, times moved on per piece, joined in order",
  heard.split("\n").slice(1, 7).join("|") ===
    "[0:01] piece piece-1.wav said in auto|[0:03] second line|[4:01] piece piece-2.wav said in auto|[4:03] second line|[8:01] piece piece-3.wav said in auto|[8:03] second line",
  heard,
);
check(
  "listen: the pieces are cleaned up",
  !fs.existsSync(path.join(path.dirname(quietWords), "listen")),
);
r = listenWith({ WATCH_STT: fakeStt }, quiet, "--no-frames");
check(
  "listen: a second look reads the kept transcript",
  /Words: .*\(6 lines\)$/m.test(r.out) && !/Listening/.test(r.out),
  r.out,
);

const short = path.join(tmp, "short talk.m4a");
spawnSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "anullsrc=r=16000:cl=mono",
  "-t",
  "30",
  "-c:a",
  "aac",
  short,
]);
// these run before the short clip has a transcript (a kept transcript is read, not listened to again)
r = listenWith({ WATCH_STT_JOBS: "0" }, short, "--no-frames");
check(
  "listen: WATCH_STT_JOBS 0 refused",
  r.code === 2 && /WATCH_STT_JOBS/.test(r.err),
  r.err,
);
const hasFilter = /Filter whisper/.test(
  spawnSync("ffmpeg", ["-hide_banner", "-h", "filter=whisper"], {
    encoding: "utf8",
  }).stdout || "",
);
if (hasFilter) {
  r = listenWith(
    { WATCH_WHISPER_MODEL: path.join(tmp, "models", "ggml-none.bin") },
    short,
    "--no-frames",
  );
  check(
    "listen: a missing model is named, never downloaded",
    r.code === 0 &&
      /Words: none \(speech-to-text needs the model .*ggml-none\.bin: node watch\.mjs --get-model downloads it \(size not known here from https:\/\/huggingface\.co\//.test(
        r.out,
      ) &&
      !fs.existsSync(path.join(tmp, "models")),
    r.out + r.err,
  );
} else
  console.log(
    "skipped: this ffmpeg has no whisper filter (missing-model case)",
  );
r = listenWith(
  { WATCH_STT: fakeStt, WATCH_STT_JOBS: "3" },
  short,
  "--no-frames",
  "--listen",
  "--lang",
  "ru-RU",
);
check(
  "listen: short sound stays in one piece; --lang with --listen reaches the engine",
  /0:30 of sound$/m.test(r.out) &&
    !/pieces/.test(r.out) &&
    /said in ru/.test(
      fs.readFileSync(
        path.join(
          home,
          fs.readdirSync(home).find((d) => d.startsWith("short_talk")),
          "transcript.txt",
        ),
        "utf8",
      ),
    ),
  r.out + r.err,
);
// An engine that fails leaves the words out, and the stills still come
const talking = path.join(tmp, "talking clip.mp4");
spawnSync("ffmpeg", [
  "-v",
  "error",
  "-f",
  "lavfi",
  "-i",
  "testsrc=duration=6:size=320x180:rate=10",
  "-f",
  "lavfi",
  "-i",
  "anullsrc=r=16000:cl=mono",
  "-t",
  "6",
  "-pix_fmt",
  "yuv420p",
  "-c:a",
  "aac",
  talking,
]);
const failingStt = path.join(tmp, "failing-stt.mjs");
fs.writeFileSync(
  failingStt,
  `console.error("out of graphics memory"); process.exit(3);\n`,
);
r = listenWith(
  { WATCH_STT: failingStt },
  talking,
  "--out",
  path.join(tmp, "talking"),
);
check(
  "listen: a failed engine gives no words, the stills still come",
  r.code === 0 &&
    /Words: none this time \(speech-to-text \(stand-in failing-stt\.mjs\) failed: out of graphics memory\)/.test(
      r.out,
    ) &&
    /Pictures: /.test(r.out),
  r.out + r.err,
);
// No speech heard is kept, so a second look does not listen again
const emptyStt = path.join(tmp, "empty-stt.mjs");
fs.writeFileSync(
  emptyStt,
  `import fs from "node:fs"; fs.writeFileSync(process.argv[3], ""); console.log("ran");\n`,
);
r = listenWith({ WATCH_STT: emptyStt }, talking, "--no-frames");
check(
  "listen: no speech heard",
  /Words: none \(no speech heard in/.test(r.out),
  r.out + r.err,
);
r = listenWith({ WATCH_STT: failingStt }, talking, "--no-frames");
check(
  "listen: no speech is kept, not listened to again",
  /Words: none \(no speech heard \(stand-in empty-stt\.mjs\) on an earlier look; --listen listens again\)/.test(
    r.out,
  ) && !/Listening/.test(r.out),
  r.out + r.err,
);

r = listenWith({}, "--get-model", quiet);
check(
  "--get-model with a video: refused",
  r.code === 2 && /takes no video/.test(r.err),
  r.err,
);
r = listenWith({}, quiet, "--model", "../x");
check(
  "--model with a path: refused",
  r.code === 2 && /a model name/.test(r.err),
  r.err,
);

// A link whose subtitles are refused (HTTP 429): it listens instead, from the sound alone
const fakeYt = path.join(tmp, "fake-yt-dlp-429.mjs");
fs.writeFileSync(
  fakeYt,
  `import fs from "node:fs";
const a = process.argv.slice(2);
if (a.includes("--version")) process.exit(0);
if (a.includes("-J")) { console.log(JSON.stringify({ title: "Talk", channel: "someone", duration: 30, language: "en", automatic_captions: { "en-orig": [] } })); process.exit(0); }
if (a.includes("--write-subs")) { console.error("ERROR: Unable to download video subtitles for 'en-orig': HTTP Error 429: Too Many Requests"); process.exit(1); }
const o = a[a.indexOf("-o") + 1];
if (o && o.includes("audio.")) { fs.copyFileSync(${JSON.stringify(short)}, o.replace("%(ext)s", "m4a")); process.exit(0); }
process.exit(1);
`,
);
r = listenWith(
  { YT_DLP: fakeYt, WATCH_STT: fakeStt },
  "https://www.youtube.com/watch?v=TESTTALK429",
  "--no-frames",
);
check(
  "link, subtitles refused (429): listens instead",
  r.code === 0 &&
    /Listening: stand-in .*\(yt-dlp could not download the subtitles; en-orig: .*429/.test(
      r.out,
    ) &&
    /Words: .*\(2 lines, speech-to-text/.test(r.out),
  r.out + r.err,
);
check(
  "link: the sound is kept as audio.m4a",
  fs.existsSync(path.join(home, "TESTTALK429", "audio.m4a")),
);

// (b) The real engine on a spoken clip: Windows speech writes a WAV straight to a file, it is put into a
// test video, and the transcript must hold the words. Runs only where the filter and the model exist.
const realModel =
  process.env.WATCH_WHISPER_MODEL ||
  path.join(
    os.homedir(),
    ".claude",
    "video-cache",
    "models",
    "ggml-large-v3-turbo-q5_0.bin",
  );
if (process.platform !== "win32")
  console.log("skipped: spoken clip (Windows speech only)");
else if (!hasFilter || !fs.existsSync(realModel))
  console.log("skipped: no whisper model");
else {
  const wav = path.join(tmp, "spoken.wav");
  const sentence = "The quick brown fox jumps over the lazy dog";
  spawnSync("powershell", [
    "-NoProfile",
    "-Command",
    `Add-Type -AssemblyName System.Speech; $s = New-Object System.Speech.Synthesis.SpeechSynthesizer; $s.SetOutputToWaveFile('${wav.replace(/'/g, "''")}'); $s.Speak('${sentence}.'); $s.Dispose()`,
  ]);
  const spoken = path.join(tmp, "spoken clip.mp4");
  spawnSync("ffmpeg", [
    "-v",
    "error",
    "-f",
    "lavfi",
    "-i",
    "testsrc=duration=5:size=320x180:rate=10",
    "-i",
    wav,
    "-shortest",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    spoken,
  ]);
  r = listenWith({ WATCH_WHISPER_MODEL: realModel }, spoken, "--no-frames");
  const words = path.join(
    home,
    fs.readdirSync(home).find((d) => d.startsWith("spoken_clip")),
    "transcript.txt",
  );
  const said = fs.existsSync(words) ? fs.readFileSync(words, "utf8") : "";
  check(
    "spoken clip: the transcript holds the words",
    /quick brown fox jumps over the lazy dog/i.test(said),
    r.out + r.err + said,
  );
  if (said) console.log(`spoken clip transcript:\n${said.trim()}`);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
