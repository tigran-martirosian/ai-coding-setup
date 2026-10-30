#!/usr/bin/env node
// Renders the tour film, its poster and the short gifs in docs/features.md.
//   node render.mjs            everything, into ../docs/img
//   node render.mjs film       the film, the poster and the checks clip
//   node render.mjs stills     the last frame of every shot, into out/stills (to check the text)
//   node render.mjs clips      only the gifs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import { CATCH, FPS, frames, SCRIPT, TICKS, timeline, toFrames } from "./src/film/script.ts";

const mode = process.argv[2] ?? "all";
const img = "../docs/img";
const remotion = (...args) => execFileSync("npx", ["remotion", ...args], { stdio: "inherit", shell: true });
// The film is drawn large, then cut down in one step: a README video can't pass 10 MB on a free GitHub plan.
const MASTER = "out/master.mp4";
const GITHUB_LIMIT_MB = 10;

// Each shot once all its text is on screen, from its own composition (in the film the next shot covers its end),
// plus the catch before it is corrected.
const shotEnds = () => SCRIPT.map((shot) => ({ id: shot.id, frame: frames(shot) - 2, composition: shot.id }));
const sentBack = () => ({ id: "catch-sent-back", frame: toFrames(CATCH.at.fixed - 8), composition: "catch" });
// The contents grid with one cell open is the poster.
const posterFrame = () => timeline().find((item) => item.id === "contents").from + toFrames(TICKS * 1.1);
// The clip names are read from the source, so this list can't drift from the scenes.
const index = fs.readFileSync("src/scenes/index.ts", "utf8");
const clips = [...index.matchAll(/^  (\w+): \[/gm)].map((m) => m[1]);
// The checks clip plays at the film's rate; the older clips run at 30.
const gif = (id) => remotion("render", `clip-${id}`, `${img}/clip-${id}.gif`, "--codec=gif", `--every-nth-frame=${id === "checks" ? FPS / 10 : 3}`, `--scale=${id === "checks" ? 0.4 : 0.5}`);

if (!["all", "film", "clips", "stills"].includes(mode)) throw new Error(`Unknown mode "${mode}": use film, clips or stills, or nothing for all.`);

if (mode === "stills") {
  for (const { id, frame, composition } of [...shotEnds(), sentBack()]) remotion("still", composition, `out/stills/${id}.png`, `--frame=${frame}`);
} else {
  if (mode === "all" || mode === "film") {
    remotion("render", "Promo", MASTER, "--codec=h264", "--crf=14");
    execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", MASTER, "-vf", "scale=1600:-2:flags=lanczos", "-c:v", "libx264", "-preset", "veryslow", "-crf", "31", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", `${img}/promo.mp4`], { stdio: "inherit" });
    const size = fs.statSync(`${img}/promo.mp4`).size / 1e6;
    if (size > GITHUB_LIMIT_MB) throw new Error(`The film is ${size.toFixed(1)} MB, over GitHub's ${GITHUB_LIMIT_MB} MB limit for a video: raise the -crf above.`);
    remotion("still", "Promo", `${img}/promo-poster.png`, `--frame=${posterFrame()}`, "--scale=0.5");
  }
  if (mode !== "stills") gif("checks");
  if (mode === "all" || mode === "clips") clips.forEach(gif);
}
