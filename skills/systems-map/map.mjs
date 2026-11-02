#!/usr/bin/env node
// map.mjs: the Systems map of a project, a dictionary of its parts ("things") and what connects to what ("links").
// The map is one file, <project>/.claude/systems-map.json:
//   { "nodes": [{ "id", "name", "what", "files": [...], "notes": [...] }],
//     "links": [{ "from", "to", "says", "evidence": ["path", ...] }] }
// Commands, run in the project folder (or add --project <dir>):
//   --near                 list every thing
//   --near <word>...       those things: what they are, where to start, their links with the code behind them, the things one step further
//   --brief                read a helper's brief on stdin; print the lines of the (at most 3) things it is about, at most 6,000 characters
//   --check                list files and evidence paths that no longer exist, and the JSON mistakes; exit 1 when anything is wrong
//   --scan                 what a builder needs to start a map: code files by folder, biggest files, entry points (at most about 8 KB)
// The two hooks (map-brief.mjs, map-nudge.mjs) import this file. No dependencies; Node.js only.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const SELF = fileURLToPath(import.meta.url);
export const CMD = `node "${SELF.replace(/\\/g, "/")}"`;
export const MAP_REL = ".claude/systems-map.json";

export const CODE_EXT = new Set(
  ("js mjs cjs jsx ts tsx py pyi java kt kts scala groovy go rs rb php cs fs vb c h cc cpp cxx hpp hh m mm swift dart lua pl pm r jl " +
    "ex exs erl hrl hs ml clj cljs sh bash zsh ps1 bat sql vue svelte astro").split(" "),
);
// Folders that hold other people's code or build output
export const VENDORED = new Set(
  ("node_modules vendor vendors third_party third-party thirdparty bower_components dist build out target .git .venv venv __pycache__ " +
    ".next .nuxt .svelte-kit .gradle .idea .vscode coverage Pods Carthage site-packages .tox .mypy_cache .cache obj .terraform .yarn .pnpm-store").split(" "),
);

export const BRIEF_MAX = 6000; // characters of the whole --brief output
export const BRIEF_THINGS = 3; // things in it
export const BRIEF_LINKS = 12; // links per thing
export const BRIEF_FILES = 6; // "Start in" files per thing
const SCAN_MAX = 8000;

// Single words that are ordinary English as well as a thing's id or name. A brief that says "the data file" or "the main page" must not pull
// in half the map, so these only match through a longer name ("Order data") or through a file.
export const COMMON = new Set(
  ("item items block map base data core common shared util utils helper helpers misc main app code file files test tests build config setup " +
    "system service services module modules page pages view views state store user users list type types model models event events task tasks " +
    "job jobs tool tools doc docs api high low server client web ui backend " +
    "frontend cache queue logic engine manager handler handlers controller controllers lib libs src script scripts release plugin plugins").split(" "),
);

const FILE_EXTS = [...new Set([...CODE_EXT, "md", "json", "toml", "yaml", "yml", "html", "css", "scss", "cfg", "ini", "xml", "txt", "properties"])];
const FILE_TEXT = new RegExp(String.raw`[\w./\\:-]*[\w-]\.(?:${FILE_EXTS.join("|")})(?![\w])`, "g");
const CAMEL = /\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+\b/g;
// Files named like their class: a brief that says "UserCard" points at UserCard.tsx
const CLASS_FILE = /\.(?:java|kt|cs|ts|tsx|jsx|vue|svelte|swift|scala|dart|php)$/;
const CLASS_EXTS = ["java", "kt", "cs", "ts", "tsx", "jsx", "vue", "svelte", "swift", "scala", "dart", "php"];

const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === "string" ? x : "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exists = (dir, p) => fs.existsSync(path.join(dir, p));
const isFile = (p) => {
  try { return fs.statSync(p).isFile(); } catch { return false; }
};

// ---- the file -------------------------------------------------------------------------------------------------------------------------

/** The parsed map, or null when the project has none. Throws on invalid JSON. */
export function loadMap(dir) {
  let raw;
  try {
    raw = fs.readFileSync(path.join(dir, MAP_REL), "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
  return JSON.parse(raw.replace(/^﻿/, ""));
}

/** Every path the map lists (files, notes, evidence): Map of path -> who lists it. */
export function listedPaths(map) {
  const out = new Map();
  const add = (p, who) => {
    if (typeof p !== "string" || !p) return;
    if (!out.has(p)) out.set(p, []);
    out.get(p).push(who);
  };
  for (const n of arr(map?.nodes)) for (const p of [...arr(n?.files), ...arr(n?.notes)]) add(p, `thing ${n.id}`);
  for (const l of arr(map?.links)) for (const p of arr(l?.evidence)) add(p, `link ${l.from} -> ${l.to}`);
  return out;
}

/** The listed paths that are gone from disk: { total, gone: [[path, [who]]] }. */
export function missingPaths(map, dir) {
  const listed = listedPaths(map);
  const gone = [...listed].filter(([p]) => !exists(dir, p));
  return { total: listed.size, gone };
}

/** Normal shape for the readers: plain strings, links between known things only. dropGone removes paths that no longer exist. */
function prep(map, dir, dropGone) {
  const keep = (p) => typeof p === "string" && p && (!dropGone || exists(dir, p));
  const nodes = arr(map?.nodes)
    .filter((n) => n && typeof n.id === "string" && n.id)
    .map((n) => ({ id: n.id, name: str(n.name) || n.id, what: str(n.what), files: arr(n.files).filter(keep), notes: arr(n.notes).filter(keep) }));
  const ids = new Set(nodes.map((n) => n.id));
  const links = arr(map?.links)
    .filter((l) => l && ids.has(l.from) && ids.has(l.to))
    .map((l) => ({ from: l.from, to: l.to, says: str(l.says), evidence: arr(l.evidence).filter(keep) }));
  return { nodes, links };
}

// ---- matching (the helper's brief -> the things it is about) --------------------------------------------------------------------------

/** The words a brief may call a thing by: its id, its name, the name without "The"/"Your" or a bracket, what the bracket holds. */
export function aliases(n) {
  const names = new Set([n.id, n.name]);
  const m = /^(.*?)\s*\((.*)\)$/.exec(n.name);
  if (m) { names.add(m[1]); names.add(m[2]); }
  for (const s of [...names]) names.add(s.replace(/^(the|your)\s+/i, ""));
  const out = new Set([...names].map((s) => s.toLowerCase().replace(/[-_\s]+/g, " ").trim()));
  return [...out].filter((a) => a && !COMMON.has(a));
}

const addTo = (m, k, v) => {
  if (!m.has(k)) m.set(k, new Set());
  m.get(k).add(v);
};

/** [ranked ids, files named in the text that the map knows]: a named file first, then a name or id, and only when neither found
 *  anything, a named file that lies in the folder of a thing's file. */
export function briefFind(text, nodes, links, dir) {
  const own = new Map(), touch = new Map();
  for (const n of nodes) for (const f of n.files) { addTo(own, f, n.id); addTo(touch, f, n.id); }
  for (const l of links) for (const e of l.evidence) { addTo(touch, e, l.from); addTo(touch, e, l.to); }
  const named = new Set((text.match(FILE_TEXT) ?? []).map((m) => m.replace(/\\/g, "/").toLowerCase().replace(/^(?:\.?\/)+/, "")));
  const camel = new Set(text.match(CAMEL) ?? []);
  const got = new Set();
  for (const f of touch.keys()) {
    const fl = f.toLowerCase(), stem = path.posix.parse(f).name;
    const byPath = [...named].some((p) => fl === p || fl.endsWith("/" + p) || p.endsWith("/" + fl));
    if (byPath || (CLASS_FILE.test(f) && camel.has(stem) && stem.length >= 5)) got.add(f);
  }
  const score = new Map();
  const sc = (i) => {
    if (!score.has(i)) score.set(i, [0, 0]);
    return score.get(i);
  };
  for (const f of got) for (const i of touch.get(f)) sc(i)[0] += (own.get(f)?.has(i) ? 2 : 1) / touch.get(f).size;
  const flat = " " + text.toLowerCase().replace(/[-_\s]+/g, " ") + " ";
  for (const n of nodes) {
    let w = 0;
    for (const a of aliases(n)) if (new RegExp("(?<![a-z0-9])" + escapeRe(a) + "(?![a-z0-9])").test(flat)) w += a.includes(" ") ? 2 : 1;
    if (w) sc(n.id)[1] = w;
  }
  if (!score.size && (named.size || camel.size)) {
    // A file no thing lists: it counts by a written path, or a class name, that points at a folder holding a file of a thing, unless
    // more things sit there than a brief can carry. A bare name (index.ts) says nothing, and the project root is no folder to go by.
    const dirs = new Set([...touch.keys()].map((f) => path.posix.dirname(f)).filter((d) => d !== "."));
    const folders = new Set();
    for (const d of dirs) {
      if ([...camel].some((t) => CLASS_EXTS.some((x) => isFile(path.join(dir, d, `${t}.${x}`))))) folders.add(d.toLowerCase());
      for (const p of named) {
        if (!p.includes("/")) continue;
        const parent = p.slice(0, p.lastIndexOf("/"));
        if (d.toLowerCase() === parent || d.toLowerCase().endsWith("/" + parent)) folders.add(d.toLowerCase());
      }
      const here = new Set([...touch.keys()].filter((f) => path.posix.dirname(f) === d).flatMap((f) => [...touch.get(f)]));
      if (here.size > BRIEF_THINGS) folders.delete(d.toLowerCase());
    }
    for (const f of touch.keys()) {
      if (!folders.has(path.posix.dirname(f).toLowerCase())) continue;
      for (const i of touch.get(f)) sc(i)[0] += ((own.get(f)?.has(i) ? 2 : 1) / touch.get(f).size) * 0.1;
    }
  }
  const order = new Map(nodes.map((n, k) => [n.id, k]));
  const ranked = [...score.keys()].sort((a, b) => score.get(b)[0] - score.get(a)[0] || score.get(b)[1] - score.get(a)[1] || order.get(a) - order.get(b));
  return [ranked.slice(0, BRIEF_THINGS), got];
}

const arrow = (l, id, by) => (l.from === id ? `to ${by.get(l.to).name}` : `from ${by.get(l.from).name}`);

/** The map lines for the things a helper's brief is about, and only those. Empty string when none. */
export function brief(text, map, dir) {
  const { nodes, links } = prep(map, dir, true);
  const [ids, got] = briefFind(text, nodes, links, dir);
  if (!ids.length) return "";
  const by = new Map(nodes.map((n) => [n.id, n]));
  const blocks = ids.map((i) => {
    const n = by.get(i);
    const mine = links.filter((l) => l.from === i || l.to === i);
    mine.sort((a, b) => Number(!a.evidence.some((e) => got.has(e))) - Number(!b.evidence.some((e) => got.has(e))));
    const lines = mine.map((l) => `- ${arrow(l, i, by)}: ${l.says}`);
    const files = [...n.files].sort((a, b) => Number(!got.has(a)) - Number(!got.has(b))).slice(0, BRIEF_FILES);
    const head = [`## ${n.name} [${i}]`, n.what];
    if (files.length) head.push("Start in: " + files.join(", "));
    if (n.notes.length) head.push("Read: " + n.notes.join(", "));
    return { head, lines };
  });
  const caps = blocks.map(() => BRIEF_LINKS);
  const render = () =>
    blocks
      .map(({ head, lines }, k) => {
        const body = lines.slice(0, caps[k]);
        if (lines.length > caps[k]) body.push(`- (${lines.length - caps[k]} more links: ${CMD} --near ${ids[k]})`);
        return [...head, lines.length ? "Links:" : "Links: none", ...body].join("\n");
      })
      .join("\n\n");
  let out = render();
  while (out.length > BRIEF_MAX && caps.some((c) => c)) {
    let k = 0;
    caps.forEach((c, j) => { if (c >= caps[k]) k = j; }); // the largest cap, the last of equals
    caps[k]--;
    out = render();
  }
  return out.slice(0, BRIEF_MAX).trimEnd();
}

// ---- --near ---------------------------------------------------------------------------------------------------------------------------

/** The things a word means: an exact id, else a name or id holding it, else a description, else the code file of the thing or of one of its links. */
function find(word, nodes, links) {
  const w = word.toLowerCase();
  const exact = nodes.filter((n) => n.id.toLowerCase() === w);
  const named = nodes.filter((n) => n.id.toLowerCase().includes(w) || n.name.toLowerCase().includes(w));
  const told = nodes.filter((n) => n.what.toLowerCase().includes(w));
  const ids = new Set();
  for (const n of nodes) if (n.files.some((f) => f.toLowerCase().includes(w))) ids.add(n.id);
  for (const l of links) if (l.evidence.some((e) => e.toLowerCase().includes(w))) { ids.add(l.from); ids.add(l.to); }
  return exact.length ? exact : named.length ? named : told.length ? told : nodes.filter((n) => ids.has(n.id));
}

/** { text } with the things, or { error } when a word matches nothing. */
export function near(words, map, dir) {
  const { nodes, links } = prep(map, dir, false);
  if (!words.length) return { text: nodes.map((n) => `- ${n.id}: ${n.name}. ${n.what}`).join("\n") };
  const hits = [];
  for (const w of words) {
    const found = find(w, nodes, links);
    if (!found.length) return { error: `nothing on the map matches "${w}"; ${CMD} --near lists every thing` };
    for (const n of found) if (!hits.includes(n)) hits.push(n);
  }
  const by = new Map(nodes.map((n) => [n.id, n]));
  const mark = (p) => (exists(dir, p) ? p : `${p} [GONE]`);
  const out = [];
  for (const n of hits) {
    const mine = links.filter((l) => l.from === n.id || l.to === n.id);
    out.push("", `## ${n.name} [${n.id}]`, n.what);
    if (n.files.length) out.push("Start in: " + n.files.map(mark).join(", "));
    if (n.notes.length) out.push("Read: " + n.notes.map(mark).join(", "));
    out.push(mine.length ? "Links:" : "Links: none");
    for (const l of mine) out.push(`- ${arrow(l, n.id, by)}: ${l.says} (${l.evidence.map(mark).join(", ")})`);
    const seen = new Set(mine.flatMap((l) => [l.from, l.to]));
    const two = new Set(links.filter((l) => seen.has(l.from) || seen.has(l.to)).flatMap((l) => [l.from, l.to]));
    for (const i of seen) two.delete(i);
    out.push("One step further: " + ([...two].sort().join(", ") || "nothing"));
  }
  return { text: out.join("\n").trimStart() };
}

// ---- --check --------------------------------------------------------------------------------------------------------------------------

/** { bad: [mistakes in the JSON], gone: [[path, who]], total, things, links }. */
export function checkMap(map, dir) {
  const bad = [];
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return { bad: ["the file must hold one JSON object with nodes and links"], gone: [], total: 0, things: 0, links: 0 };
  }
  if (!Array.isArray(map.nodes)) bad.push('"nodes" must be a list');
  if (!Array.isArray(map.links)) bad.push('"links" must be a list');
  const ids = new Set();
  for (const [k, n] of arr(map.nodes).entries()) {
    const at = `thing ${k + 1}${n && typeof n.id === "string" ? ` (${n.id})` : ""}`;
    if (!n || typeof n !== "object") { bad.push(`${at}: must be an object`); continue; }
    if (typeof n.id !== "string" || !n.id) bad.push(`${at}: no id`);
    else if (ids.has(n.id)) bad.push(`${at}: duplicate id ${n.id}`);
    else ids.add(n.id);
    for (const key of ["name", "what"]) if (typeof n[key] !== "string" || !n[key]) bad.push(`${at}: no ${key}`);
    if (!Array.isArray(n.files) || !n.files.length || n.files.some((f) => typeof f !== "string")) bad.push(`${at}: files must be a list of paths, at least one`);
    if (n.notes !== undefined && (!Array.isArray(n.notes) || n.notes.some((f) => typeof f !== "string"))) bad.push(`${at}: notes must be a list of paths`);
  }
  for (const [k, l] of arr(map.links).entries()) {
    const at = `link ${k + 1}${l ? ` (${l.from} -> ${l.to})` : ""}`;
    if (!l || typeof l !== "object") { bad.push(`${at}: must be an object`); continue; }
    for (const key of ["from", "to"]) if (!ids.has(l[key])) bad.push(`${at}: ${key} is not the id of a thing`);
    if (typeof l.says !== "string" || !l.says) bad.push(`${at}: no says`);
    if (!Array.isArray(l.evidence) || !l.evidence.length || l.evidence.some((e) => typeof e !== "string")) bad.push(`${at}: evidence must be a list of paths, at least one`);
  }
  const { total, gone } = missingPaths(map, dir);
  return { bad, gone, total, things: arr(map.nodes).length, links: arr(map.links).length };
}

// ---- --scan ---------------------------------------------------------------------------------------------------------------------------

/** All files git tracks in the folder. Throws when it is no git repository. */
export function trackedFiles(dir) {
  const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
    encoding: "utf8", maxBuffer: 1 << 30, timeout: 20000, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\0").filter(Boolean);
}

export function isCode(rel) {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot < 1 || !CODE_EXT.has(base.slice(dot + 1))) return false;
  if (/\.min\.[a-z]+$/.test(base) || base.endsWith(".d.ts")) return false;
  return !rel.split("/").slice(0, -1).some((s) => VENDORED.has(s));
}

export function countCodeFiles(dir) {
  return trackedFiles(dir).filter(isCode).length;
}

const ROUTEISH = new Set(
  ("routes route router routers controllers handlers endpoints api pages screens views commands cmd jobs workers tasks cron migrations " +
    "middleware resolvers consumers listeners").split(" "),
);
const MANIFESTS = new Set(
  ("pyproject.toml setup.py Cargo.toml go.mod pom.xml build.gradle build.gradle.kts Makefile Dockerfile docker-compose.yml docker-compose.yaml " +
    "composer.json Gemfile requirements.txt tsconfig.json Package.swift CMakeLists.txt").split(" "),
);
const MAIN_FILE = new RegExp(String.raw`^(?:(?:main|index|app|server|cli|__main__|manage|wsgi|asgi|program|startup)\.[a-z]+|[a-z0-9]*(?:application|main|program)\.(?:java|kt|cs))$`, "i");
const depth = (p) => p.split("/").length - 1;

export function scan(dir) {
  const all = trackedFiles(dir);
  const code = all.filter(isCode);
  const lines = [`# Scan of ${path.basename(dir)}: ${code.length} tracked code files (of ${all.length} tracked files; vendored and build folders skipped)`];
  const langs = new Map();
  for (const f of code) langs.set(f.split(".").pop().toLowerCase(), (langs.get(f.split(".").pop().toLowerCase()) ?? 0) + 1);
  lines.push("Languages: " + [...langs].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([e, c]) => `.${e} ${c}`).join(", "));

  const counts = new Map(), kids = new Map();
  let rootFiles = 0;
  for (const f of code) {
    const parts = f.split("/");
    if (parts.length === 1) rootFiles++;
    for (let i = 1; i < parts.length; i++) {
      const key = parts.slice(0, i).join("/");
      counts.set(key, (counts.get(key) ?? 0) + 1);
      addTo(kids, i === 1 ? "" : parts.slice(0, i - 1).join("/"), key);
    }
  }
  lines.push("", "## Code files by folder");
  if (rootFiles) lines.push(`(project root) ${rootFiles}`);
  const emit = (parent, level) => {
    const list = [...(kids.get(parent) ?? [])].sort((a, b) => counts.get(b) - counts.get(a)).slice(0, level === 0 ? 30 : level === 1 ? 10 : 6);
    for (const c of list) {
      lines.push(`${"  ".repeat(level)}${c}/ ${counts.get(c)}`);
      if (level < 2 && counts.get(c) >= (level === 0 ? 10 : 40)) emit(c, level + 1);
    }
  };
  emit("", 0);

  lines.push("", "## Biggest code files");
  const sized = code
    .map((f) => { try { return [f, fs.statSync(path.join(dir, f)).size]; } catch { return [f, 0]; } })
    .sort((a, b) => b[1] - a[1]).slice(0, 15);
  for (const [f, size] of sized) {
    let n = "?";
    try { n = fs.readFileSync(path.join(dir, f), "utf8").split("\n").length; } catch {}
    lines.push(`${String(Math.round(size / 1024)).padStart(5)} KB ${String(n).padStart(6)} lines  ${f}`);
  }

  lines.push("", "## Entry points");
  const pkgs = all.filter((f) => /(^|\/)package\.json$/.test(f) && depth(f) <= 3 && !f.split("/").some((s) => VENDORED.has(s))).slice(0, 8);
  for (const p of pkgs) {
    try {
      const j = JSON.parse(fs.readFileSync(path.join(dir, p), "utf8").replace(/^﻿/, ""));
      const bits = [];
      if (j.main) bits.push(`main ${j.main}`);
      if (j.bin) bits.push(`bin ${typeof j.bin === "string" ? j.bin : Object.values(j.bin).join(" ")}`);
      if (j.workspaces) bits.push(`workspaces ${JSON.stringify(j.workspaces).slice(0, 80)}`);
      const scripts = Object.entries(j.scripts ?? {}).slice(0, 10).map(([k, v]) => `${k}="${String(v).slice(0, 50)}"`);
      if (scripts.length) bits.push("scripts " + scripts.join(" "));
      lines.push(`${p}${j.name ? ` (${j.name})` : ""}: ${bits.join("; ") || "no main, bin or scripts"}`);
    } catch { lines.push(`${p}: not readable as JSON`); }
  }
  const mains = code.filter((f) => depth(f) <= 3 && MAIN_FILE.test(f.slice(f.lastIndexOf("/") + 1))).sort((a, b) => depth(a) - depth(b) || a.localeCompare(b)).slice(0, 25);
  if (mains.length) lines.push("Main-looking files: " + mains.join(", "));
  const manifests = all.filter((f) => depth(f) <= 3 && MANIFESTS.has(f.slice(f.lastIndexOf("/") + 1)) && !f.split("/").some((s) => VENDORED.has(s))).slice(0, 20);
  if (manifests.length) lines.push("Build and config files: " + manifests.join(", "));
  const flows = all.filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f)).slice(0, 5);
  if (flows.length) lines.push("CI: " + flows.join(", "));
  const routeDirs = new Map();
  for (const f of code) {
    const parts = f.split("/");
    for (let i = 1; i < parts.length; i++) {
      if (ROUTEISH.has(parts[i - 1])) {
        const key = parts.slice(0, i).join("/");
        if (!routeDirs.has(key)) routeDirs.set(key, []);
        routeDirs.get(key).push(parts.slice(i).join("/"));
        break;
      }
    }
  }
  const routes = [...routeDirs].sort((a, b) => b[1].length - a[1].length).slice(0, 20);
  if (routes.length) {
    lines.push("Folders that look like routes, handlers, jobs or screens:");
    for (const [d, fs_] of routes) lines.push(`  ${d}/ ${fs_.length} files: ${fs_.slice(0, 5).join(", ")}${fs_.length > 5 ? ", ..." : ""}`);
  }
  const out = lines.join("\n");
  return out.length > SCAN_MAX ? out.slice(0, SCAN_MAX).replace(/\n[^\n]*$/, "") + `\n(cut at ${SCAN_MAX} characters)` : out;
}

// ---- command line ---------------------------------------------------------------------------------------------------------------------

function readStdin() {
  try { return fs.readFileSync(0, "utf8"); } catch { return ""; }
}

function main(argv) {
  const args = argv.slice(2);
  let dir = process.cwd();
  const pi = args.indexOf("--project");
  if (pi >= 0) {
    if (!args[pi + 1]) { console.error("--project needs a folder"); return 1; }
    dir = path.resolve(args[pi + 1]);
    args.splice(pi, 2);
  }
  const cmd = args[0];
  if (cmd === "--scan") {
    try {
      console.log(scan(dir));
      return 0;
    } catch (e) {
      console.error(`--scan needs a git repository (git ls-files): ${String(e.stderr || e.message).trim().split("\n")[0]}`);
      return 1;
    }
  }
  if (!["--near", "--brief", "--check"].includes(cmd)) {
    console.error(`usage: ${CMD} [--project <dir>] --near [word...] | --brief (text on stdin) | --check | --scan`);
    return 1;
  }
  let map;
  try {
    map = loadMap(dir);
  } catch (e) {
    console.error(`${MAP_REL} is not valid JSON: ${e.message}`);
    return 1;
  }
  if (map === null) {
    if (cmd === "--brief") return 0;
    console.error(`no map in ${dir}: ${MAP_REL} is missing. Build one with the systems-map skill (${CMD.replace("map.mjs", "SKILL.md").replace(/^node /, "")})`);
    return 1;
  }
  if (!Array.isArray(map.nodes) && typeof map.handledBy === "string") {
    if (cmd === "--brief") return 0;
    console.log(`This project's map is kept by ${map.handledBy}.`);
    return cmd === "--check" ? 0 : 1;
  }
  if (cmd === "--brief") {
    const out = brief(readStdin(), map, dir);
    if (out) process.stdout.write(out + "\n");
    return 0;
  }
  if (cmd === "--near") {
    const r = near(args.slice(1), map, dir);
    if (r.error) { console.error(r.error); return 1; }
    console.log(r.text);
    return 0;
  }
  const r = checkMap(map, dir);
  for (const b of r.bad) console.log(`BAD  ${b}`);
  for (const [p, who] of r.gone) console.log(`GONE ${p}  (${[...new Set(who)].join("; ")})`);
  const share = r.total ? ((100 * r.gone.length) / r.total).toFixed(1) : "0.0";
  const wrong = r.bad.length + r.gone.length > 0;
  console.log(`${wrong ? "FAIL" : "ok"}: ${r.things} things, ${r.links} links, ${r.total} listed paths, ${r.gone.length} gone (${share}%), ${r.bad.length} JSON mistakes`);
  return wrong ? 1 : 0;
}

let isMain = false;
try { isMain = !!process.argv[1] && fs.realpathSync(process.argv[1]).toLowerCase() === fs.realpathSync(SELF).toLowerCase(); } catch {}
if (isMain) process.exitCode = main(process.argv);
