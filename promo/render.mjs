#!/usr/bin/env node
// Renders the promo: the full video, the poster, and one short gif per README section.
//   node render.mjs            everything, into ../docs/img
//   node render.mjs stills     one late frame of every scene, into out/stills (to check the text)
//   node render.mjs clips      only the gifs
import { execFileSync } from "node:child_process";
import fs from "node:fs";

const mode = process.argv[2] ?? "all";
const img = "../docs/img";
const remotion = (...args) => execFileSync("npx", ["remotion", ...args], { stdio: "inherit", shell: true });

// The scene and clip names are read from the source, so this list can't drift from the video.
const index = fs.readFileSync("src/scenes/index.ts", "utf8");
const scenes = [...index.matchAll(/id: "(\w+)", component: \w+, durationInFrames: (\d+)/g)].map((m) => ({
  id: m[1],
  frames: Number(m[2]),
}));
const clips = [...index.matchAll(/^  (\w+): \[/gm)].map((m) => m[1]);

if (mode === "stills") {
  for (const scene of scenes) {
    remotion("still", scene.id, `out/stills/${scene.id}.png`, `--frame=${scene.frames - 25}`, "--scale=0.5");
  }
} else {
  if (mode === "all") {
    remotion("render", "Promo", `${img}/promo.mp4`, "--codec=h264", "--crf=20");
    remotion("still", "Promo", `${img}/promo-poster.png`, "--frame=60", "--scale=0.5");
  }
  for (const clip of clips) {
    remotion("render", `clip-${clip}`, `${img}/clip-${clip}.gif`, "--codec=gif", "--every-nth-frame=3", "--scale=0.5");
  }
}
