#!/usr/bin/env node
// picture.mjs: the tools of the `picture` skill.
//   node picture.mjs frames <youtube id or link> [folder]        still frames of a video, as sheets (default folder: yt)
//   node picture.mjs cut <sheet.jpg> <row> <column> <out.jpg>     one frame out of a sheet, enlarged 3x (row 1, column 1 = top left)
//   node picture.mjs gen <prompt.txt> <out.png> <reference image ...>   generate one picture with Codex
//   node picture.mjs review <try.png>                             a second model lists what is wrong in the picture
// frames: saves YouTube's storyboard sheets (grids of small stills; no video or audio is downloaded) and
//   <id>-sb.json with the grid size, so `cut` knows where each frame is. Needs yt-dlp; cut needs ffmpeg.
// gen: the prompt's folder is the job folder. Refuses unless facts.md and checklist.md there pass the rules of
//   picture-gate.mjs, at least one real in-use frame named in facts.md is attached, and no attached picture is
//   an earlier generated one whose view failed or that the user rejected. The prompt is piped to Codex, the
//   references are attached with -i, and the newest picture under ~/.codex/generated_images is copied to <out.png>.
// review: gives Codex the picture, the in-use frames, facts.md and checklist.md, and writes <try>.review.md
//   with the picture's sha256 and the faults as R1, R2, ... The check file has to answer each one.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync, execFileSync } from "node:child_process";

// The gate sits two folders up, in hooks/, both in ~/.claude and in the repository this came from
const gate = await import(new URL("../../hooks/picture-gate.mjs", import.meta.url).href);
const CODEX = `codex exec --skip-git-repo-check -s read-only${process.platform === "win32" ? " -c windows.sandbox='unelevated'" : ""}`;
const FAKE = process.env.PICTURE_FAKE_CODEX; // tests only: gen stops before Codex, review reads the answer from this file
const stop = (msg, code = 2) => { console.error(msg); process.exit(code); };
const mmss = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const attach = (files) => files.map((r) => `-i "${path.resolve(r)}"`).join(" ");
const tail = (run) => `${run.stdout || ""}\n${run.stderr || ""}`.trim().split("\n").slice(-15).join("\n");

const [cmd, ...args] = process.argv.slice(2);

if (cmd === "frames") {
  const id = (args[0] || "").match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([\w-]{11})/)?.[1] || (/^[\w-]{11}$/.test(args[0] || "") ? args[0] : null);
  if (!id) stop("usage: node picture.mjs frames <youtube id or link> [folder]");
  const dir = path.resolve(args[1] || "yt");
  const ytArgs = ["-j", "--skip-download", `https://www.youtube.com/watch?v=${id}`];
  const tools = [
    [process.env.YT_DLP, []],
    ["yt-dlp", []],
    ["uvx", ["yt-dlp"]],
  ].filter(([exe]) => exe);
  let info;
  for (const [exe, pre] of tools) {
    try { info = JSON.parse(execFileSync(exe, [...pre, ...ytArgs], { maxBuffer: 200 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] })); break; } catch {}
  }
  if (!info) stop(`yt-dlp could not read video ${id} (tried: ${tools.map(([exe, pre]) => [exe, ...pre].join(" ")).join(", ")})`, 1);
  const sb = info.formats.filter((f) => String(f.format_id).startsWith("sb") && f.fragments).sort((a, b) => (b.width || 0) - (a.width || 0))[0];
  if (!sb) stop(`${id}: this video has no storyboard`, 1);
  fs.mkdirSync(dir, { recursive: true });
  const sheets = [];
  let at = 0;
  for (const frag of sb.fragments) {
    const res = await fetch(frag.url);
    const start = at;
    at += frag.duration || 0;
    if (!res.ok) continue;
    const file = `${id}-sb${sheets.length}.jpg`;
    fs.writeFileSync(path.join(dir, file), Buffer.from(await res.arrayBuffer()));
    sheets.push({ file, start, end: at });
  }
  if (!sheets.length) stop(`${id}: no storyboard sheet could be downloaded`, 1);
  const meta = { id, title: info.title, duration: info.duration, rows: sb.rows, columns: sb.columns, width: sb.width, height: sb.height, sheets };
  fs.writeFileSync(path.join(dir, `${id}-sb.json`), JSON.stringify(meta, null, 2));
  const per = (sheets[0].end - sheets[0].start) / (sb.rows * sb.columns);
  console.log(`${info.title} | ${mmss(info.duration)} | ${sheets.length} sheets in ${dir}, each ${sb.rows} rows x ${sb.columns} columns, one frame about every ${per.toFixed(1)} s`);
  for (const s of sheets) console.log(`  ${s.file}  ${mmss(s.start)} to ${mmss(s.end)}`);
  console.log("Open the sheets that matter with Read, then: node picture.mjs cut <sheet.jpg> <row> <column> <out.jpg>  (row 1, column 1 = top left)");
} else if (cmd === "cut") {
  const [sheet, row, col, out] = [args[0], Number(args[1]), Number(args[2]), args[3]];
  if (!sheet || !out || !Number.isInteger(row) || !Number.isInteger(col)) stop("usage: node picture.mjs cut <sheet.jpg> <row> <column> <out.jpg>");
  const metaFile = path.resolve(sheet).replace(/-sb\d+\.jpg$/i, "-sb.json");
  if (!fs.existsSync(sheet) || !fs.existsSync(metaFile)) stop(`not found: ${sheet} or its ${path.basename(metaFile)} (both are made by: picture.mjs frames)`);
  const m = JSON.parse(fs.readFileSync(metaFile, "utf8"));
  if (row < 1 || row > m.rows || col < 1 || col > m.columns) stop(`this sheet has rows 1 to ${m.rows} and columns 1 to ${m.columns}`);
  fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
  const vf = `crop=${m.width}:${m.height}:${(col - 1) * m.width}:${(row - 1) * m.height},scale=iw*3:ih*3:flags=lanczos`;
  const run = spawnSync("ffmpeg", ["-y", "-loglevel", "error", "-i", sheet, "-vf", vf, "-q:v", "2", out], { encoding: "utf8" });
  if (run.status !== 0 || !fs.existsSync(out)) stop(`ffmpeg could not cut the frame:\n${tail(run)}`, 1);
  const s = m.sheets.find((x) => x.file === path.basename(sheet));
  const when = s ? `, at about ${mmss(s.start + ((row - 1) * m.columns + col - 1) * (s.end - s.start) / (m.rows * m.columns))} of https://youtu.be/${m.id}` : "";
  console.log(`${path.resolve(out)}${when}`);
} else if (cmd === "gen") {
  const [promptFile, outFile, ...refs] = args;
  if (!promptFile || !outFile) stop("usage: node picture.mjs gen <prompt.txt> <out.png> <reference image ...>");
  for (const f of [promptFile, ...refs]) if (!fs.existsSync(f)) stop(`not found: ${f}`);
  if (fs.existsSync(outFile)) stop(`already exists (each try gets its own file): ${outFile}`);
  const jobDir = path.dirname(path.resolve(promptFile));
  const before = gate.factsProblem(jobDir) || gate.checklistProblem(jobDir);
  if (before) stop(`not generated: ${before}. Finish the facts and the checklist first (picture skill, steps 1 and 2).`);
  for (const r of refs) {
    const why = gate.generatedOriginal(r) && gate.editBaseProblem(r);
    if (why) stop(`not generated: ${why}. Write a new prompt for a new picture; don't start from this one.`);
  }
  const real = gate.inUseImages(jobDir);
  const given = refs.map((r) => path.resolve(r).toLowerCase());
  if (real.length && !real.some((f) => given.includes(f.toLowerCase()))) {
    stop(`not generated: attach at least one of the real in-use frames named in facts.md (${real.map((f) => path.relative(jobDir, f)).join(", ")}) and say in the prompt what each one shows.`);
  }
  if (FAKE) { console.log("would generate"); process.exit(0); }

  const prompt = "Generate one image with your image generation tool, exactly as described below. Make one image only.\n\n" +
    fs.readFileSync(promptFile, "utf8");
  const started = Date.now() - 2000;
  const run = spawnSync(`${CODEX} ${attach(refs)} -`,
    { input: prompt, encoding: "utf8", shell: true, timeout: 9 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  const made = gate.generatedImages()
    .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
    .filter((x) => x.t >= started)
    .sort((a, b) => b.t - a.t);
  if (!made.length) stop("Codex made no picture. End of its output:\n" + tail(run), 1);
  fs.mkdirSync(path.dirname(path.resolve(outFile)), { recursive: true });
  fs.copyFileSync(made[0].f, outFile);
  console.log(path.resolve(outFile));
} else if (cmd === "review") {
  const file = args[0];
  if (!file || !fs.existsSync(file)) stop("usage: node picture.mjs review <try.png>");
  const jobDir = gate.jobDirOf(file);
  if (!jobDir || !fs.existsSync(path.join(jobDir, "checklist.md"))) stop(`no facts.md and checklist.md found for ${file} (in its folder or the one above)`);
  const real = gate.inUseImages(jobDir).slice(0, 4);
  const prompt = `You are checking a generated illustration before it is shown to someone who will build or use the real thing from it. Do not run commands, do not search the web, do not write files. Answer only from the attached images and the text below.

Image 1 is the generated illustration. ${real.length ? `The other ${real.length} image(s) are real photos or video frames of the real thing in use.` : "No real photos are attached."}

List everything in image 1 that is wrong. Look for, in this order:
1. Geometry: furniture or straight edges that are skewed, bent or disagree with each other; a view that is not the one the checklist asks for.
2. Sizes: any part whose size or proportion differs from the real sizes in the facts or from the photos.
3. Physically impossible things: a part, a material or a liquid that comes out of or goes into a place it cannot; a part that floats or is attached to nothing; a part on the wrong side or the wrong end.
4. Clamps, bolts, hands and other fasteners that do not grip two real surfaces, or do not hold what they are meant to hold.
5. Anything that differs from the photos or contradicts a fact or a checklist line; wrong or misplaced labels; objects that the checklist does not name.

Be strict and concrete. Do not praise and do not suggest fixes. Report only what you can see in image 1.
Answer format, and nothing else: one line per fault, each starting with "FAULT: ", saying where in the picture it is and what is wrong. If you find no fault at all, answer with the single line "NO FAULTS".

FACTS
${fs.readFileSync(path.join(jobDir, "facts.md"), "utf8")}

CHECKLIST
${fs.readFileSync(path.join(jobDir, "checklist.md"), "utf8")}
`;
  const answerFile = path.join(os.tmpdir(), `picture-review-${process.pid}.txt`);
  const run = FAKE ? {} : spawnSync(`${CODEX} ${attach([file, ...real])} -o "${answerFile}" -`,
    { input: prompt, encoding: "utf8", shell: true, timeout: 6 * 60 * 1000, maxBuffer: 64 * 1024 * 1024 });
  let answer = "";
  try { answer = fs.readFileSync(FAKE || answerFile, "utf8"); fs.rmSync(answerFile, { force: true }); } catch {}
  const faults = answer.split(/\r?\n/).map((l) => l.match(/^\W*FAULT:\s*(.+)$/i)?.[1].trim()).filter(Boolean);
  if (!faults.length && !/NO FAULTS/i.test(answer)) stop("The reviewer gave no usable answer; run the review again. End of its output:\n" + (answer.trim() || tail(run)), 1);
  const name = path.basename(file);
  const reviewFile = gate.reviewFileOf(file);
  fs.writeFileSync(reviewFile, [
    `# Independent review of ${name}`,
    "",
    `sha256: ${gate.sha(file)}`,
    `Reviewer: Codex, given the picture, facts.md, checklist.md and ${real.length} real frame(s).`,
    "",
    ...(faults.length ? faults.map((f, i) => `R${i + 1}: ${f}`) : ["No faults found."]),
    "",
  ].join("\n"));
  console.log(fs.readFileSync(reviewFile, "utf8").trim());
  if (faults.length) console.log(`\nAnswer each point in ${path.basename(gate.checkFileOf(file))}: "- FAIL R1: ..." when it is true, "- PASS R1: <what the picture really shows>" when it is not.`);
} else {
  stop("usage: node picture.mjs frames <youtube id or link> [folder] | cut <sheet.jpg> <row> <column> <out.jpg> | gen <prompt.txt> <out.png> <reference image ...> | review <try.png>");
}
