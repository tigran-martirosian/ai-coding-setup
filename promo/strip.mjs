#!/usr/bin/env node
// A contact sheet of a stretch of the film, to judge the motion itself and not only where a shot ends.
//   node strip.mjs <shot id> [frames between pictures] [columns]    into out/strip/<id>.jpg
//   node strip.mjs <first frame>-<last frame> [...]
//   node strip.mjs <frame>,<frame>,<frame> 1 [columns]            chosen frames
//   node strip.mjs --composition=<id> <first frame>-<last frame>
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { bundle } from "@remotion/bundler";
import { openBrowser, renderStill, selectComposition } from "@remotion/renderer";
import { FPS, timeline } from "./src/film/script.ts";

const args = process.argv.slice(2);
const named = args.find((a) => a.startsWith("--composition="))?.split("=")[1];
const [what, every = String(Math.round(FPS / 3)), columns = "6"] = args.filter((a) => !a.startsWith("--"));
if (!what) throw new Error("Name a shot or a frame range: node strip.mjs catch");

const range = () => {
  const m = what.match(/^(\d+)-(\d+)$/);
  if (m) return [Number(m[1]), Number(m[2])];
  const item = timeline().find((t) => t.id === what);
  if (!item) throw new Error(`No shot called "${what}". Shots: ${timeline().map((t) => t.id).join(", ")}`);
  return [item.from, item.from + item.frames - 1];
};

const list = what.includes(",") ? what.split(",").map(Number) : null;
const [first, last] = list ? [list[0], list[list.length - 1]] : range();
const name = list ? "picked" : what;
const dir = path.resolve("out/strip", name);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });

const serveUrl = await bundle({ entryPoint: path.resolve("src/index.ts") });
const browser = await openBrowser("chrome");
const composition = await selectComposition({ serveUrl, id: named ?? "Promo", puppeteerInstance: browser });

let n = 0;
const wanted = list ?? Array.from({ length: Math.floor((last - first) / Number(every)) + 1 }, (_, i) => first + i * Number(every));
for (const frame of wanted) {
  await renderStill({
    composition,
    serveUrl,
    frame,
    output: path.join(dir, `${String(n++).padStart(3, "0")}.jpeg`),
    imageFormat: "jpeg",
    jpegQuality: 80,
    scale: 0.4,
    puppeteerInstance: browser,
  });
}
await browser.close({ silent: true });

const sheet = path.resolve("out/strip", `${name}.jpg`);
const tall = Math.ceil(n / Number(columns));
execFileSync("ffmpeg", ["-y", "-loglevel", "error", "-i", path.join(dir, "%03d.jpeg"), "-vf", `tile=${columns}x${tall}:padding=6:color=white`, "-frames:v", "1", "-q:v", "3", sheet]);
console.log(`${n} pictures, frames ${first} to ${last}: ${sheet}`);
