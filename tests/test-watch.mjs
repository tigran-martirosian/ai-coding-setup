#!/usr/bin/env node
// Test of skills/watch/watch.mjs on a 20-second video that ffmpeg draws here (no network).
// WATCH_SCRIPT points the test at another copy of the script (default: this repo's).
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const script = process.env.WATCH_SCRIPT || fileURLToPath(new URL("../skills/watch/watch.mjs", import.meta.url));
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "watch-test-"));
const home = path.join(tmp, "cache");
const video = path.join(tmp, "clip one.mp4");
const made = spawnSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc=duration=20:size=640x360:rate=10", "-pix_fmt", "yuv420p", video]);
if (made.status !== 0) { console.error("ffmpeg could not draw the test video"); process.exit(1); }

const watch = (...args) => {
  const run = spawnSync("node", [script, ...args], { encoding: "utf8", env: { ...process.env, WATCH_HOME: home } });
  return { code: run.status, out: run.stdout || "", err: run.stderr || "" };
};
const sheetsIn = (dir) => (fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => /^sheet_\d+\.jpg$/.test(f)).sort() : []);
let pass = 0;
let fail = 0;
const check = (name, ok, detail = "") => {
  if (ok) pass++; else { fail++; console.log(`FAIL ${name}${detail ? `\n     ${detail}` : ""}`); }
};

const all = path.join(tmp, "all");
let r = watch(video, "--out", all);
check("whole video: exit 0", r.code === 0, r.err);
check("whole video: title and length", /clip one\.mp4 \| 0:20/.test(r.out), r.out);
check("whole video: a file has no words", /Words: none/.test(r.out), r.out);
check("whole video: 6 sheets, one still every 0.4 s", /6 sheets in .* one still every 0\.4 s/.test(r.out) && sheetsIn(all).length === 6, r.out);
check("whole video: last sheet ends at the end", /sheet_06\.jpg {2}0:18 to 0:20/.test(r.out), r.out);
check("info.json kept", fs.readdirSync(home).length === 1 && fs.existsSync(path.join(home, fs.readdirSync(home)[0], "info.json")));

const close = path.join(tmp, "close");
r = watch(video, "--from", "0:05", "--to", "0:08", "--sheets", "1", "--out", close);
check("stretch: one sheet", r.code === 0 && sheetsIn(close).length === 1, r.out + r.err);
check("stretch: times start at --from", /sheet_01\.jpg {2}0:05 to 0:08/.test(r.out), r.out);

r = watch(video, "--from", "5", "--to", "9", "--every", "0.2", "--out", close);
check("--every 0.2 over 4 s: 20 stills on 3 sheets, old sheets replaced", r.code === 0 && sheetsIn(close).length === 3, r.out + r.err);

r = watch(video, "--from", "2", "--to", "4");
const kept = r.out.match(/sheets in (.+?), one still/)?.[1];
check("no --out: sheets go into the cache folder", r.code === 0 && kept && kept.startsWith(home) && sheetsIn(kept).length > 0, r.out + r.err);

r = watch(video, "--no-frames");
check("--no-frames: no sheets", r.code === 0 && !/Pictures:/.test(r.out), r.out);

r = watch(video, "--from", "0:10", "--to", "0:05");
check("--from after --to: refused", r.code === 2 && /has to be before/.test(r.err), r.err);
r = watch(video, "--from", "abc");
check("a time that is no time: refused", r.code === 2 && /write a time as/.test(r.err), r.err);
r = watch(video, "--every", "0.01");
check("too many stills: refused", r.code === 2 && /shorter stretch/.test(r.err), r.err);
r = watch(video, "--wat");
check("unknown option: refused", r.code === 2 && /unknown option/.test(r.err), r.err);
r = watch();
check("no video: usage", r.code === 2 && /usage:/.test(r.err), r.err);
r = watch(path.join(tmp, "missing.mp4"));
check("missing file: clear error", r.code === 1 && /not found/.test(r.err), r.err);

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
