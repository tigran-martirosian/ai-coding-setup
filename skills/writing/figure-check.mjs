#!/usr/bin/env node
// Names the figures a rewrite changed: every number in the old text that the new one lacks, and every number the new
// one added. A reworded or reordered sentence with the same figures prints nothing. It rewrites nothing; each figure
// it names must be one the user asked to change, or it goes back.
//   node figure-check.mjs <old file> <new file>
//   node figure-check.mjs <file>        the file against its last committed copy (git HEAD)
// A figure is a run of digits with its decimal point, a leading $, €, £ or minus and a trailing %; thousands commas
// are dropped ("1,000" = "1000"). Numbers written as words are not figures here.
// Prints "went: <figure> (line N: <text>)" and "came: <figure> (line N: <text>)", then "N went, M came".
// Exits 0 when no figure moved, 1 when any did, 2 when a text can't be read.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const stop = (msg) => {
  console.error(`figure-check: ${msg}`);
  process.exit(2);
};
const args = process.argv.slice(2);
if (args.length < 1 || args.length > 2)
  stop(
    "usage: node figure-check.mjs <old file> <new file>  |  node figure-check.mjs <file>",
  );

const read = (p) => {
  try {
    return fs.readFileSync(p, "utf8");
  } catch (e) {
    stop(`can't read ${p}: ${e.code || e.message}`);
  }
};
const committed = (p) => {
  const abs = path.resolve(p);
  const r = spawnSync("git", ["show", `HEAD:./${path.basename(abs)}`], {
    cwd: path.dirname(abs),
    encoding: "utf8",
  });
  if (r.status !== 0)
    stop(
      `no committed copy of ${p} to compare with: ${(r.stderr || r.error?.message || "").trim()}`,
    );
  return r.stdout;
};
const [oldText, newText] =
  args.length === 2
    ? [read(args[0]), read(args[1])]
    : [committed(args[0]), read(args[0])];

const FIGURE = /(?<![\w.])[-−]?[$€£]?\d+(?:,\d{3})*(?:\.\d+)?%?/g;
const figures = (text) => {
  const out = [];
  text.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(FIGURE))
      out.push({
        key: m[0].replace(/,(?=\d{3}\b)/g, "").replace("−", "-"),
        shown: m[0],
        line: i + 1,
        text: line.trim().slice(0, 100),
      });
  });
  return out;
};

// Each figure counts as many times as it appears, so a "40" dropped from one of two places still shows
const minus = (a, b) => {
  const left = new Map();
  for (const f of b) left.set(f.key, (left.get(f.key) || 0) + 1);
  return a.filter((f) => {
    const n = left.get(f.key) || 0;
    if (n) left.set(f.key, n - 1);
    return !n;
  });
};
const before = figures(oldText);
const after = figures(newText);
const went = minus(before, after);
const came = minus(after, before);
for (const f of went)
  console.log(`went: ${f.shown} (line ${f.line}: ${f.text})`);
for (const f of came)
  console.log(`came: ${f.shown} (line ${f.line}: ${f.text})`);
console.log(`${went.length} went, ${came.length} came`);
process.exit(went.length || came.length ? 1 : 0);
