#!/usr/bin/env node
// Prints the length and pace of every shot of the tour film and fails when the film runs too long.
// Lengths are set by hand in script.ts; this is a printout to read, not where they come from.
//   node check-reading.mjs
import { blocks, FPS, frames, SCRIPT, totalFrames } from "./src/film/script.ts";

const MAX_SECONDS = 95;

const words = (shot) => blocks(shot).join(" ").trim().split(/\s+/).length;
const rows = SCRIPT.map((shot) => ({ id: shot.id, words: words(shot), seconds: frames(shot) / FPS }));

for (const row of rows) {
  console.log(`${row.id.padEnd(10)} ${String(row.words).padStart(3)} words  ${row.seconds.toFixed(1).padStart(5)} s  ${(row.words / row.seconds).toFixed(2)} words a second`);
}

const total = Math.round(totalFrames() / FPS);
const allWords = rows.reduce((sum, row) => sum + row.words, 0);
console.log(`\n${SCRIPT.length} shots, ${allWords} words, ${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}, ${(allWords / total).toFixed(2)} words a second`);

if (total > MAX_SECONDS) {
  console.error(`The film is ${total} s, over the limit of ${MAX_SECONDS} s.`);
  process.exit(1);
}
