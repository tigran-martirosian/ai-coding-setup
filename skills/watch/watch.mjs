#!/usr/bin/env node
// watch.mjs: turns a video into things a model can read cheaply.
//   node watch.mjs <link or video file>                        the words (subtitles) and an overview: 6 sheets of stills
//   node watch.mjs <link or video file> --from 2:10 --to 2:20  a close look at one stretch (about 5 stills a second)
// Options: --every <seconds> between stills, --sheets <n> (default 6), --out <folder> for the sheets,
//          --no-frames (words only, no video is downloaded), --lang <code> for the subtitles.
// A sheet is 3 x 3 stills in order, each with its time in the corner, so one picture shows a sequence.
// Everything about one video is kept in ~/.claude/video-cache/<id> (WATCH_HOME moves it): info.json,
// transcript.txt, video.mp4 (720p at most, no sound) and the sheets, so a second look downloads nothing.
// Needs ffmpeg, and for links yt-dlp (on PATH, or it is run through uvx). YT_DLP names another yt-dlp.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";

const HOME = process.env.WATCH_HOME || path.join(os.homedir(), ".claude", "video-cache");
const PER_SHEET = 9;
const stop = (msg, code = 1) => { console.error(msg); process.exit(code); };
const USAGE = "usage: node watch.mjs <link or video file> [--from m:ss] [--to m:ss] [--every seconds] [--sheets n] [--out folder] [--no-frames] [--lang code]";

const flags = {};
const rest = [];
const argv = process.argv.slice(2);
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--no-frames") flags.noFrames = true;
  else if (["--from", "--to", "--every", "--sheets", "--out", "--lang"].includes(a)) {
    if (argv[i + 1] === undefined) stop(`${a} needs a value\n${USAGE}`, 2);
    flags[a.slice(2)] = argv[++i];
  } else if (a.startsWith("--")) stop(`unknown option ${a}\n${USAGE}`, 2);
  else rest.push(a);
}
if (rest.length !== 1) stop(USAGE, 2);
const source = rest[0];

function seconds(text, name) {
  if (!/^\d+(:\d{1,2}){0,2}(\.\d+)?$/.test(text)) stop(`--${name} ${text}: write a time as 95, 1:35 or 1:02:03`, 2);
  return text.split(":").reduce((sum, part) => sum * 60 + Number(part), 0);
}
function clock(s) {
  const whole = Math.floor(s);
  const tenth = Math.round((s - whole) * 10);
  const [h, m, sec] = [Math.floor(whole / 3600), Math.floor((whole % 3600) / 60), whole % 60];
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : m}:${String(sec).padStart(2, "0")}${tenth ? `.${tenth}` : ""}`;
}

const isLink = /^https?:\/\//i.test(source);
let id;
if (isLink) {
  id = source.match(/(?:v=|youtu\.be\/|shorts\/|embed\/|live\/)([\w-]{11})/)?.[1]
    || crypto.createHash("sha1").update(source).digest("hex").slice(0, 12);
} else {
  if (!fs.existsSync(source)) stop(`not found: ${source}`);
  const stat = fs.statSync(source);
  id = `${path.parse(source).name.replace(/[^\w-]+/g, "_").slice(0, 40)}-${crypto.createHash("sha1").update(`${path.resolve(source)}|${stat.size}|${stat.mtimeMs}`).digest("hex").slice(0, 8)}`;
}
const dir = path.join(HOME, id);
fs.mkdirSync(dir, { recursive: true });

let ytCommand;
function yt(args, options = {}) {
  if (!ytCommand) {
    const tries = [process.env.YT_DLP && [process.env.YT_DLP], ["yt-dlp"], ["uvx", "--with", "deno", "yt-dlp"]].filter(Boolean);
    ytCommand = tries.find((t) => spawnSync(t[0], [...t.slice(1), "--version"], { stdio: "ignore" }).status === 0);
    if (!ytCommand) stop(`yt-dlp is not available (tried: ${tries.map((t) => t.join(" ")).join(", ")}). Install uv or yt-dlp.`);
  }
  return spawnSync(ytCommand[0], [...ytCommand.slice(1), "--no-warnings", "--no-playlist", ...args], { encoding: "utf8", maxBuffer: 300 * 1024 * 1024, ...options });
}

// 1. What the video is
const infoFile = path.join(dir, "info.json");
let info;
if (fs.existsSync(infoFile)) info = JSON.parse(fs.readFileSync(infoFile, "utf8"));
else if (isLink) {
  const run = yt(["-J", source]);
  if (run.status !== 0) stop(`yt-dlp could not read ${source}:\n${(run.stderr || "").trim().split("\n").slice(-5).join("\n")}`);
  const full = JSON.parse(run.stdout);
  info = {
    id, source, title: full.title, channel: full.channel || full.uploader, duration: full.duration, language: full.language,
    chapters: (full.chapters || []).map((c) => ({ start: c.start_time, title: c.title })),
    subtitles: Object.keys(full.subtitles || {}).filter((k) => k !== "live_chat"),
    automatic: Object.keys(full.automatic_captions || {}),
  };
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
} else {
  const probe = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", source], { encoding: "utf8" });
  info = { id, source: path.resolve(source), title: path.basename(source), duration: Number(probe.trim()), chapters: [], subtitles: [], automatic: [] };
  if (!info.duration) stop(`ffprobe could not read the length of ${source}`);
  fs.writeFileSync(infoFile, JSON.stringify(info, null, 2));
}
console.log(`${info.title}${info.channel ? ` | ${info.channel}` : ""} | ${clock(info.duration)}`);
for (const c of info.chapters) console.log(`  chapter ${clock(c.start)}  ${c.title}`);

// 2. The words: subtitles someone wrote, else the automatic ones in the language that is spoken
const wordsFile = path.join(dir, "transcript.txt");
const noWordsFile = path.join(dir, "no-transcript.txt");
if (fs.existsSync(wordsFile)) {
  console.log(`Words: ${wordsFile} (${fs.readFileSync(wordsFile, "utf8").split("\n").length - 2} lines)`);
} else if (!isLink || fs.existsSync(noWordsFile)) {
  console.log(isLink ? `Words: none (${fs.readFileSync(noWordsFile, "utf8").trim()})` : "Words: none (a file's sound is not turned into text)");
} else {
  const base = (code) => String(code || "").split("-")[0];
  const want = flags.lang ? [flags.lang] : [info.language, base(info.language), "en", "ru"].filter(Boolean);
  // Tracks to try, best first. YouTube's "-orig" track is the speech itself; its other automatic
  // tracks are translations of it and are often refused (HTTP 429), so they come last.
  const written = flags.lang ? want.filter((w) => info.subtitles.includes(w)) : [...want.filter((w) => info.subtitles.includes(w)), ...info.subtitles.slice(0, 1)];
  const automatic = flags.lang ? want.filter((w) => info.automatic.includes(w))
    : [...info.automatic.filter((k) => k.endsWith("-orig")), ...want.slice(0, 2).filter((w) => info.automatic.includes(w))];
  const tracks = [...new Set(written)].map((lang) => [lang, "written by a person"])
    .concat([...new Set(automatic)].map((lang) => [lang, "automatic, expect wrong words"]));
  let lines = [];
  let found;
  const failed = [];
  for (const [lang, kind] of tracks) {
    const run = yt(["--skip-download", "--write-subs", "--write-auto-subs", "--sub-langs", lang, "--sub-format", "json3", "-o", path.join(dir, "sub"), source]);
    const file = path.join(dir, `sub.${lang}.json3`);
    if (run.status !== 0 || !fs.existsSync(file)) { failed.push(`${lang}: ${(run.stderr || "").trim().split("\n").pop()}`); continue; }
    for (const event of JSON.parse(fs.readFileSync(file, "utf8")).events || []) {
      const text = (event.segs || []).map((s) => s.utf8 || "").join("").replace(/\s+/g, " ").trim();
      if (text) lines.push(`[${clock(Math.floor(event.tStartMs / 1000))}] ${text}`);
    }
    fs.rmSync(file);
    if (lines.length) { found = [lang, kind]; break; }
  }
  if (found) {
    fs.writeFileSync(wordsFile, `Subtitles: ${found[0]} (${found[1]})\n${lines.join("\n")}\n`);
    console.log(`Words: ${wordsFile} (${lines.length} lines, ${found[0]}, ${found[1]})`);
  } else if (failed.length) {
    console.log(`Words: none this time (yt-dlp could not download the subtitles; ${failed.join("; ")}). Run again later.`);
  } else {
    const why = flags.lang ? `no subtitles in ${flags.lang}` : "this video has no subtitles";
    if (!flags.lang) fs.writeFileSync(noWordsFile, `${why}\n`);
    console.log(`Words: none (${why})`);
  }
}
if (flags.noFrames) process.exit(0);

// 3. The pictures
const from = flags.from ? seconds(flags.from, "from") : 0;
const to = Math.min(flags.to ? seconds(flags.to, "to") : info.duration, info.duration);
if (!(to > from)) stop(`--from ${clock(from)} has to be before --to ${clock(to)} (the video is ${clock(info.duration)} long)`, 2);
const sheets = flags.sheets ? Number(flags.sheets) : 6;
if (!Number.isInteger(sheets) || sheets < 1) stop("--sheets takes a whole number, 1 or more", 2);
const every = flags.every ? Number(flags.every) : Math.max(0.2, Math.ceil(((to - from) / (sheets * PER_SHEET)) * 10) / 10);
if (!(every > 0)) stop("--every takes a number of seconds above 0", 2);
const count = Math.ceil((to - from) / every);
if (count > 30 * PER_SHEET) stop(`that is ${count} stills on ${Math.ceil(count / PER_SHEET)} sheets: take a shorter stretch or a larger --every`, 2);

let video = isLink ? path.join(dir, "video.mp4") : path.resolve(source);
if (isLink && !fs.existsSync(video)) {
  const run = yt(["-f", "bv*[height<=720][ext=mp4]/bv*[height<=720]/b[height<=720]/b", "--remux-video", "mp4", "-o", path.join(dir, "video.%(ext)s"), source], { stdio: ["ignore", "ignore", "pipe"] });
  if (run.status !== 0 || !fs.existsSync(video)) stop(`yt-dlp could not download the video:\n${(run.stderr || "").trim().split("\n").slice(-5).join("\n")}`);
}

const out = path.resolve(flags.out || path.join(dir, `${clock(from)}-${clock(to)}-every-${every}s`.replace(/:/g, "m")));
fs.mkdirSync(out, { recursive: true });
for (const old of fs.readdirSync(out)) if (/^sheet_\d+\.jpg$/.test(old)) fs.rmSync(path.join(out, old));
const stamp = `drawtext=font=Arial:text='%{pts\\:hms\\:${from}}':x=6:y=6:fontsize=22:fontcolor=white:box=1:boxcolor=black@0.65:boxborderw=4`;
// select keeps real frames with their own times, so the time drawn on a still is the time it was taken at
const filter = `select='gte(t,selected_n*${every})',scale=480:270:force_original_aspect_ratio=decrease,pad=480:270:(ow-iw)/2:(oh-ih)/2,${stamp},tile=3x3:padding=4`;
const run = spawnSync("ffmpeg", ["-v", "error", "-y", "-ss", String(from), "-to", String(to), "-i", video, "-an", "-vf", filter, "-fps_mode", "passthrough", "-q:v", "4", path.join(out, "sheet_%02d.jpg")], { encoding: "utf8" });
const made = fs.readdirSync(out).filter((f) => /^sheet_\d+\.jpg$/.test(f)).sort();
if (run.status !== 0 || !made.length) stop(`ffmpeg made no sheets:\n${(run.stderr || "").trim().split("\n").slice(-5).join("\n")}`);
console.log(`Pictures: ${made.length} sheets in ${out}, one still every ${every} s, 9 on a sheet, read left to right, top to bottom`);
made.forEach((file, i) => console.log(`  ${file}  ${clock(from + i * PER_SHEET * every)} to ${clock(Math.min(to, from + (i + 1) * PER_SHEET * every))}`));
