// Import cycles a turn added in JavaScript and TypeScript code, for verify-gate's end-of-turn check.
// newCycles(files): for each edited JS/TS file inside a git repository, the shortest loop of relative imports that
// leads from it back to itself now, when no such loop existed with the edited files as the last commit holds them
// (a new file had none). Each loop is a list of paths from the repository's top with /, starting and ending at the
// edited file; one loop is reported once even when several edited files sit on it.
// Read as imports: import ... from, export ... from, import "x", import("x") and require("x") with a ./ or ../ name;
// a type-only import (import type, export type) is left out, since it makes no loop when the code runs. A name is
// tried as written, with each JS/TS ending, a .js name as its .ts file (TypeScript's ESM style) and as a folder's
// index file. Package names, a file's import of itself and files outside a repository are skipped. A git call that
// fails for another reason than a missing file throws (verify-gate logs it and lets the turn finish).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXT = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const JS_TO_TS = {
  ".js": [".ts", ".tsx"],
  ".jsx": [".tsx"],
  ".mjs": [".mts"],
  ".cjs": [".cts"],
};
const MAX_FILES = 3000; // a loop past this many files is not looked for
const MAX_BYTES = 512 * 1024; // a bigger file (a bundle, generated code) is read as importing nothing
export const isScript = (p) =>
  EXT.includes(path.extname(String(p)).toLowerCase());

// A static import is read from each import or export word, over at most WINDOW characters; (?=(\s+))\1 takes the
// spaces at once, so a long run of them is not tried again at every length (it took seconds on 50,000 spaces)
const WORD = /\b(?:import|export)\b/g;
const STATIC =
  /^(?:import|export)(?=(\s+))\1(type\s+)?(?:[\w$*{}\s,]*?from\s*)?["']([^"'\n]+)["']/;
const WINDOW = 2000;
const CALL = /\b(?:require|import)\s*\(\s*["']([^"'\n]+)["']\s*\)/g;

// The relative names a file's text imports
export function importNames(text) {
  if (text.length > MAX_BYTES) return [];
  const code = text
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^[ \t]*\/\/.*$/gm, "");
  const out = [];
  for (const w of code.matchAll(WORD)) {
    const m = STATIC.exec(code.slice(w.index, w.index + WINDOW));
    if (m && !m[2] && m[3].startsWith(".")) out.push(m[3]);
  }
  for (const m of code.matchAll(CALL)) if (m[1].startsWith(".")) out.push(m[1]);
  return out;
}

const isFile = (p) =>
  fs.statSync(p, { throwIfNoEntry: false })?.isFile() ?? false;
function resolveName(fromFile, name) {
  const base = path.resolve(path.dirname(fromFile), name);
  const ext = path.extname(base).toLowerCase();
  const tries = [];
  if (EXT.includes(ext)) {
    tries.push(base);
    for (const t of JS_TO_TS[ext] ?? [])
      tries.push(base.slice(0, -ext.length) + t);
  }
  for (const e of EXT) tries.push(base + e);
  for (const e of EXT) tries.push(path.join(base, `index${e}`));
  return tries.find(isFile) ?? null;
}

function gitOut(cwd, args) {
  return spawnSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
}
function topOf(file) {
  const r = gitOut(path.dirname(file), ["rev-parse", "--show-toplevel"]);
  return r.status === 0 ? path.resolve(r.stdout.trim()) : null;
}
// The file as the last commit holds it; null when it is not there (a new file, a repository with no commit yet)
function committed(repo, rel) {
  const r = gitOut(repo, ["show", `HEAD:${rel}`]);
  if (r.status === 0) return r.stdout;
  if (
    /does not exist|exists on disk, but not in|invalid object name|bad revision|unknown revision/i.test(
      r.stderr,
    )
  )
    return null;
  throw new Error(`git show HEAD:${rel} in ${repo}: ${r.stderr.trim()}`);
}

const keyOf = (p) => (process.platform === "win32" ? p.toLowerCase() : p);

// The shortest loop from start back to start in the graph given by edgesOf(file) -> files; null when there is none
function loopFrom(start, edgesOf) {
  const back = new Map([[keyOf(start), null]]);
  const queue = [start];
  for (let i = 0; i < queue.length && back.size < MAX_FILES; i++) {
    const at = queue[i];
    for (const next of edgesOf(at)) {
      if (keyOf(next) === keyOf(at)) continue;
      if (keyOf(next) === keyOf(start)) {
        const way = []; // at, the file before it, ... back to start
        for (let p = at; p; p = back.get(keyOf(p))) way.push(p);
        return [...way.reverse(), start];
      }
      if (back.has(keyOf(next))) continue;
      back.set(keyOf(next), at);
      queue.push(next);
    }
  }
  return null;
}

export function newCycles(files) {
  const byRepo = new Map();
  for (const f of files) {
    const file = path.resolve(String(f));
    if (!isScript(file) || !isFile(file)) continue;
    const repo = topOf(file);
    if (!repo) continue;
    if (!byRepo.has(keyOf(repo)))
      byRepo.set(keyOf(repo), { repo, edited: new Map() });
    byRepo.get(keyOf(repo)).edited.set(keyOf(file), file);
  }
  const out = [];
  for (const { repo, edited } of byRepo.values()) {
    const rel = (p) => path.relative(repo, p).split(path.sep).join("/");
    const cache = { now: new Map(), before: new Map() };
    const edges = (when) => (file) => {
      const k = keyOf(file);
      if (cache[when].has(k)) return cache[when].get(k);
      let text;
      if (when === "before" && edited.has(k))
        text = committed(repo, rel(file)) ?? "";
      else text = isFile(file) ? fs.readFileSync(file, "utf8") : "";
      const list = importNames(text)
        .map((n) => resolveName(file, n))
        .filter((p) => p && isScript(p));
      cache[when].set(k, list);
      return list;
    };
    const seen = new Set();
    for (const file of edited.values()) {
      const loop = loopFrom(file, edges("now"));
      if (!loop || loopFrom(file, edges("before"))) continue;
      const id = [...new Set(loop.map(keyOf))].sort().join("|");
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(loop.map(rel));
    }
  }
  return out;
}
