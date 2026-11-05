#!/usr/bin/env node
// map.mjs: the Systems map of a project, a dictionary of its parts ("things") and what connects to what ("links").
// The map is one file, <project>/.claude/systems-map.json:
//   { "nodes": [{ "id", "name", "what", "files": [...], "notes": [...], "group"?, "words"?: [regex, ...] }],
//     "links": [{ "from", "to", "says", "type"?, "evidence": ["path" or { "file", "token" }, ...] }] }
// type is one of uses (the default), feeds, spends, opens, boosts, limits. A token is text the evidence file must still hold; a file that
// lacks it has drifted away from the link.
// Commands, run in the project folder (or add --project <dir>):
//   --near                 list every thing
//   --near <word>...       those things: what they are, where to start, their links with the code behind them, the things one step further
//   --brief                read a helper's brief on stdin; print the lines of the things it is about: the top 3 in full, one line for each further match, at most 7,000 characters
//   --check                list files and evidence paths that no longer exist, evidence that lost its token (DRIFT), and the JSON mistakes; exit 1 when anything is wrong
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

export const BRIEF_MAX = 7000; // characters of the whole --brief output
export const BRIEF_FULL = 3; // things in it with links; every further match gets one line
export const BRIEF_LINE_FILES = 3; // "Start in" files on such a line
const BRIEF_LINES_ROOM = 1500; // characters kept free for those lines when the full entries would fill the cap
export const BRIEF_FOLDER = 8; // a written folder holding files of more things than this names none of them
export const BRIEF_LINKS = 12; // links per thing
export const BRIEF_FILES = 6; // "Start in" files per thing
export const BRIEF_FILES_CUT = 3; // when the output is over the cap, start files are cut to this many before any link is cut
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
const FOLDER_TEXT = /(?<![\w.-])[\w.-]+(?:\/[\w.-]+)+\/?/g;
const WHOLE_FILE = new RegExp("^(?:" + FILE_TEXT.source + ")$");
// Files named like their class: a brief that says "UserCard" points at UserCard.tsx
const CLASS_FILE = /\.(?:java|kt|cs|ts|tsx|jsx|vue|svelte|swift|scala|dart|php)$/;
const CLASS_EXTS = ["java", "kt", "cs", "ts", "tsx", "jsx", "vue", "svelte", "swift", "scala", "dart", "php"];

export const LINK_TYPES = ["uses", "feeds", "spends", "opens", "boosts", "limits"];
const DECIDED_MAX = 10; // DECISIONS.md lines under a thing in --near

const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === "string" ? x : "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const exists = (dir, p) => fs.existsSync(path.resolve(dir, p));
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

/** One evidence entry in its normal shape { file, token? }, or null when it is neither a path string nor an object with a file. */
export function evidenceOf(e) {
  if (typeof e === "string") return e ? { file: e } : null;
  if (e && typeof e === "object" && typeof e.file === "string" && e.file) return typeof e.token === "string" && e.token ? { file: e.file, token: e.token } : { file: e.file };
  return null;
}
const evList = (l) => arr(l?.evidence).map(evidenceOf).filter(Boolean);

/** Every path the map lists (files, notes, evidence): Map of path -> who lists it. */
export function listedPaths(map) {
  const out = new Map();
  const add = (p, who) => {
    if (typeof p !== "string" || !p) return;
    if (!out.has(p)) out.set(p, []);
    out.get(p).push(who);
  };
  for (const n of arr(map?.nodes)) for (const p of [...arr(n?.files), ...arr(n?.notes)]) add(p, `thing ${n.id}`);
  for (const l of arr(map?.links)) for (const { file: p } of evList(l)) add(p, `link ${l.from} -> ${l.to}`);
  for (const g of arr(map?.generated)) for (const p of [...arr(g?.files), g?.by]) add(p, `generated by ${str(g?.by)}`);
  return out;
}

/** The listed paths that are gone from disk: { total, gone: [[path, [who]]] }. */
export function missingPaths(map, dir) {
  const listed = listedPaths(map);
  const gone = [...listed].filter(([p]) => !exists(dir, p));
  return { total: listed.size, gone };
}

/** The generated entry that writes this project path ({ files, by, run, inputs }), or null. */
const normPath = (p) => str(p).replace(/\\/g, "/").replace(/^(?:\.\/)+/, "").toLowerCase();
export function generatorOf(map, rel) {
  return arr(map?.generated).find((g) => arr(g?.files).some((f) => normPath(f) === normPath(rel))) || null;
}

/** One line telling a session not to edit a generated file by hand. */
export const generatedLine = (rel, g) => `${rel} is written by ${g.by}: change ${g.by}${arr(g.inputs).length ? ` (or its inputs ${g.inputs.join(", ")})` : ""} and run \`${g.run}\`; a hand edit is undone by its next run`;

/**
 * Generated files changed by a commit after the last commit that touched their script or inputs, without touching those: hand edits a rerun
 * would undo. [{ file, by, commits: [ "<sha> <subject>" ] }]. Needs git; a folder that is not a repository gives [].
 */
export function handEdits(map, dir) {
  const out = [];
  const log = (paths, range = []) => {
    try {
      return execFileSync("git", ["-C", dir, "log", "--format=%H %s", ...range, "--", ...paths], { encoding: "utf8", timeout: 20000, windowsHide: true, stdio: ["ignore", "pipe", "ignore"] })
        .split("\n").filter(Boolean);
    } catch { return null; }
  };
  for (const g of arr(map?.generated)) {
    if (typeof g?.by !== "string") continue;
    const source = log([g.by, ...arr(g.inputs)]);
    if (source === null) return [];
    const last = source.length ? source[0].split(" ")[0] : null;
    if (!last) { out.push({ file: arr(g.files)[0] ?? g.by, by: g.by, commits: [`${g.by} has no commit yet, so its outputs cannot be checked`] }); continue; }
    // a commit that also changed the script or an input is a run (a lane merged after the latest script commit, too)
    const runs = new Set(source.map((c) => c.split(" ")[0]));
    for (const f of arr(g.files)) {
      const after = (log([f], [`${last}..HEAD`]) || []).filter((c) => !runs.has(c.split(" ")[0])).map((c) => c.slice(0, 7) + c.slice(40));
      if (after.length) out.push({ file: f, by: g.by, commits: after });
    }
  }
  return out;
}

/** Links whose evidence file exists but no longer holds its token: [{ file, from, to, says, token, link }]. Each file is read once. */
function driftOf(links, dir) {
  const text = new Map();
  const read = (f) => {
    if (!text.has(f)) {
      let t = null;
      try { t = fs.readFileSync(path.resolve(dir, f), "utf8"); } catch {}
      text.set(f, t);
    }
    return text.get(f);
  };
  const out = [];
  for (const l of links) for (const e of l.evidence) {
    if (!e.token) continue;
    const t = read(e.file);
    if (t !== null && !t.includes(e.token)) out.push({ file: e.file, from: l.from, to: l.to, says: l.says, token: e.token, link: l });
  }
  return out;
}

/** The tokened evidence whose file exists and no longer holds the token: [{ file, from, to, says, token }]. */
export function drift(map, dir) {
  const links = arr(map?.links).filter((l) => l && typeof l === "object").map((l) => ({ from: l.from, to: l.to, says: str(l.says), evidence: evList(l) }));
  return driftOf(links, dir).map(({ link, ...d }) => d);
}

/** Normal shape for the readers: plain strings, evidence as { file, token? }, links between known things only. dropGone removes paths that no longer exist. */
function prep(map, dir, dropGone) {
  const keep = (p) => typeof p === "string" && p && (!dropGone || exists(dir, p));
  const wordRes = (n) => arr(n.words).flatMap((w) => { try { return typeof w === "string" && w ? [new RegExp(w, "i")] : []; } catch { return []; } });
  const nodes = arr(map?.nodes)
    .filter((n) => n && typeof n.id === "string" && n.id)
    .map((n) => ({ id: n.id, name: str(n.name) || n.id, what: str(n.what), files: arr(n.files).filter(keep), notes: arr(n.notes).filter(keep), group: str(n.group), words: wordRes(n) }));
  const ids = new Set(nodes.map((n) => n.id));
  const links = arr(map?.links)
    .filter((l) => l && ids.has(l.from) && ids.has(l.to))
    .map((l) => ({ from: l.from, to: l.to, says: str(l.says), type: LINK_TYPES.includes(l.type) ? l.type : "", evidence: evList(l).filter((e) => keep(e.file)) }));
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

/** Folders a brief writes (src/billing, docs/api/): a path with a slash that is not a file. */
function writtenFolders(text) {
  const out = new Set();
  for (const m of text.replace(/\\/g, "/").match(FOLDER_TEXT) ?? []) {
    const p = m.replace(/^\/+|\/+$/g, "").replace(/\.+$/, "").replace(/^(?:\.\/)+/, "").toLowerCase();
    if (p.includes("/") && !WHOLE_FILE.test(p)) out.add(p);
  }
  return out;
}

/** [all matching ids, ranked; files named in the text that the map knows]: a named file first, then a name or id, then a written folder,
 *  and only when none of those found anything, a named file that lies in the folder of a thing's file. */
export function briefFind(text, nodes, links, dir) {
  const own = new Map(), touch = new Map();
  for (const n of nodes) for (const f of n.files) { addTo(own, f, n.id); addTo(touch, f, n.id); }
  for (const l of links) for (const { file: e } of l.evidence) { addTo(touch, e, l.from); addTo(touch, e, l.to); }
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
    if (!score.has(i)) score.set(i, [0, 0, 0, 0]);
    return score.get(i);
  };
  for (const f of got) for (const i of touch.get(f)) sc(i)[0] += (own.get(f)?.has(i) ? 2 : 1) / touch.get(f).size;
  const flat = " " + text.toLowerCase().replace(/[-_\s]+/g, " ") + " ";
  // A words hit ranks last: words are loose patterns, and a passing line of the brief ("Budget: 150k tokens") must not push out a thing
  // the brief names.
  for (const n of nodes) {
    let w = 0, x = 0;
    for (const a of aliases(n)) if (new RegExp("(?<![a-z0-9])" + escapeRe(a) + "(?![a-z0-9])").test(flat)) w += a.includes(" ") ? 2 : 1;
    for (const re of n.words) if (re.test(text)) x += 1;
    if (w) sc(n.id)[1] = w;
    if (x) sc(n.id)[3] = x;
  }
  const bare = !score.size;
  // A written folder names the things that have a file in it (the folder itself, else the folders below it), unless more things sit
  // there than a brief can sensibly carry: a broad path names none of them.
  const here = new Map();
  for (const [f, ids] of touch) {
    const d = path.posix.dirname(f).toLowerCase();
    if (!here.has(d)) here.set(d, new Set());
    for (const i of ids) here.get(d).add(i);
  }
  for (const p of writtenFolders(text)) {
    const exact = [...here.keys()].filter((d) => d === p || d.endsWith("/" + p) || p.endsWith("/" + d));
    const dirs = exact.length ? exact : [...here.keys()].filter((d) => ("/" + d + "/").includes("/" + p + "/"));
    const ids = new Set(dirs.flatMap((d) => [...here.get(d)]));
    if (ids.size > 0 && ids.size <= BRIEF_FOLDER) for (const i of ids) sc(i)[2] += 1 / ids.size;
  }
  const order = new Map(nodes.map((n, k) => [n.id, k]));
  if (bare && (named.size || camel.size)) {
    // A file no thing lists: it counts by a written path, or a class name, that points at a folder holding a file of a thing, unless
    // more things sit there than a brief can carry. A bare name (index.ts) says nothing, and the project root is no folder to go by.
    // At most BRIEF_FULL things come of it.
    const dirs = new Set([...touch.keys()].map((f) => path.posix.dirname(f)).filter((d) => d !== "."));
    const folders = new Set();
    for (const d of dirs) {
      if ([...camel].some((t) => CLASS_EXTS.some((x) => isFile(path.join(dir, d, `${t}.${x}`))))) folders.add(d.toLowerCase());
      for (const p of named) {
        if (!p.includes("/")) continue;
        const parent = p.slice(0, p.lastIndexOf("/"));
        if (d.toLowerCase() === parent || d.toLowerCase().endsWith("/" + parent)) folders.add(d.toLowerCase());
      }
      const inDir = new Set([...touch.keys()].filter((f) => path.posix.dirname(f) === d).flatMap((f) => [...touch.get(f)]));
      if (inDir.size > BRIEF_FULL) folders.delete(d.toLowerCase());
    }
    const near = new Map();
    for (const f of touch.keys()) {
      if (!folders.has(path.posix.dirname(f).toLowerCase())) continue;
      for (const i of touch.get(f)) near.set(i, (near.get(i) ?? 0) + ((own.get(f)?.has(i) ? 2 : 1) / touch.get(f).size) * 0.1);
    }
    for (const i of [...near.keys()].sort((a, b) => near.get(b) - near.get(a) || order.get(a) - order.get(b)).slice(0, BRIEF_FULL)) sc(i)[0] += near.get(i);
  }
  const ranked = [...score.keys()].sort(
    (a, b) => score.get(b)[0] - score.get(a)[0] || score.get(b)[1] - score.get(a)[1] || score.get(b)[2] - score.get(a)[2] || score.get(b)[3] - score.get(a)[3] || order.get(a) - order.get(b),
  );
  return [ranked, got];
}

/** A link seen from one end. A link with a type shows its word: `feeds -> Pricing`, `<- limits from Cart`. */
const arrow = (l, id, by) =>
  l.from === id ? `${l.type ? l.type + " ->" : "to"} ${by.get(l.to).name}` : `${l.type ? "<- " + l.type + " " : ""}from ${by.get(l.from).name}`;

/** The map lines for the things a helper's brief is about, and only those. Empty string when none. */
export function brief(text, map, dir) {
  const { nodes, links } = prep(map, dir, true);
  const [ranked, got] = briefFind(text, nodes, links, dir);
  if (!ranked.length) return "";
  const ids = ranked.slice(0, BRIEF_FULL), rest = ranked.slice(BRIEF_FULL);
  const by = new Map(nodes.map((n) => [n.id, n]));
  const blocks = ids.map((i) => {
    const n = by.get(i);
    const mine = links.filter((l) => l.from === i || l.to === i);
    mine.sort((a, b) => Number(!a.evidence.some((e) => got.has(e.file))) - Number(!b.evidence.some((e) => got.has(e.file))));
    const lines = mine.map((l) => `- ${arrow(l, i, by)}: ${l.says}`);
    const files = [...n.files].sort((a, b) => Number(!got.has(a)) - Number(!got.has(b))).slice(0, BRIEF_FILES);
    return { name: n.name, id: i, what: n.what, files, notes: n.notes, lines };
  });
  const caps = blocks.map(() => BRIEF_LINKS);
  let fileCap = BRIEF_FILES;
  const render = () =>
    blocks
      .map(({ name, id, what, files, notes, lines }, k) => {
        const head = [`## ${name} [${id}]`, what];
        if (files.length) head.push("Start in: " + files.slice(0, fileCap).join(", "));
        if (notes.length) head.push("Read: " + notes.join(", "));
        const body = lines.slice(0, caps[k]);
        if (lines.length > caps[k]) body.push(`- (${lines.length - caps[k]} more links: ${CMD} --near ${ids[k]})`);
        return [...head, lines.length ? "Links:" : "Links: none", ...body].join("\n");
      })
      .join("\n\n");
  let out = render();
  const top = BRIEF_MAX - (rest.length ? Math.min(moreLines(rest, by, got, 1e9).length, BRIEF_LINES_ROOM) : 0);
  while (out.length > top && (fileCap > BRIEF_FILES_CUT || caps.some((c) => c))) {
    if (fileCap > BRIEF_FILES_CUT) { fileCap = BRIEF_FILES_CUT; out = render(); continue; } // start files first, links after
    let k = 0;
    caps.forEach((c, j) => { if (c >= caps[k]) k = j; }); // the largest cap, the last of equals
    caps[k]--;
    out = render();
  }
  out = out.slice(0, top).trimEnd();
  return rest.length ? out + moreLines(rest, by, got, BRIEF_MAX - out.length) : out;
}

/** One line per further match (name and start files), in rank order, cut where the 7,000 characters end, and a count of those left out. */
function moreLines(rest, by, got, room) {
  const head = "\n\nAlso matched (name, where to start):";
  const lines = rest.map((i) => `- ${by.get(i).name} [${i}]: ` + [...by.get(i).files].sort((a, b) => Number(!got.has(a)) - Number(!got.has(b))).slice(0, BRIEF_LINE_FILES).join(", "));
  const left = (k) => `- (${k} more matches left out)`;
  room -= head.length;
  if (lines.reduce((t, l) => t + l.length + 1, 0) <= room) return head + lines.map((l) => "\n" + l).join("");
  const shown = [];
  let used = 0;
  for (const l of lines) {
    if (used + l.length + 1 + left(lines.length).length + 1 > room) break;
    shown.push(l);
    used += l.length + 1;
  }
  if (used + left(lines.length).length + 1 > room) return "";
  return head + shown.map((l) => "\n" + l).join("") + "\n" + left(lines.length - shown.length);
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
  for (const l of links) if (l.evidence.some((e) => e.file.toLowerCase().includes(w))) { ids.add(l.from); ids.add(l.to); }
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
  const drifted = new Set(driftOf(links, dir).map((d) => d.link));
  let decisions = null;
  try { decisions = fs.readFileSync(path.join(dir, "DECISIONS.md"), "utf8").split(/\r?\n/).filter((x) => x.startsWith("- ")); } catch {}
  const out = [];
  for (const n of hits) {
    const mine = links.filter((l) => l.from === n.id || l.to === n.id);
    out.push("", `## ${n.name} [${n.id}]`, n.what);
    if (n.files.length) out.push("Start in: " + n.files.map(mark).join(", "));
    for (const f of n.files) { const g = generatorOf(map, f); if (g) out.push("Generated: " + generatedLine(f, g)); }
    if (n.notes.length) out.push("Read: " + n.notes.map(mark).join(", "));
    out.push(mine.length ? "Links:" : "Links: none");
    for (const l of mine) {
      const lost = drifted.has(l) || l.evidence.some((e) => !exists(dir, e.file));
      out.push(`- ${arrow(l, n.id, by)}: ${l.says} (${l.evidence.map((e) => mark(e.file)).join(", ")})${lost ? " [CODE GONE]" : ""}`);
    }
    if (decisions && n.words.length) {
      const hit = decisions.filter((x) => n.words.some((re) => re.test(x)));
      if (hit.length) out.push("Decided:", ...hit.slice(0, DECIDED_MAX), ...(hit.length > DECIDED_MAX ? [`(${hit.length - DECIDED_MAX} more in DECISIONS.md)`] : []));
    }
    const seen = new Set(mine.flatMap((l) => [l.from, l.to]));
    const two = new Set(links.filter((l) => seen.has(l.from) || seen.has(l.to)).flatMap((l) => [l.from, l.to]));
    for (const i of seen) two.delete(i);
    out.push("One step further: " + ([...two].sort().join(", ") || "nothing"));
  }
  return { text: out.join("\n").trimStart() };
}

// ---- --check --------------------------------------------------------------------------------------------------------------------------

/** { bad: [mistakes in the JSON], gone: [[path, who]], drifted: [drift()], total, things, links }. */
export function checkMap(map, dir) {
  const bad = [];
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return { bad: ["the file must hold one JSON object with nodes and links"], gone: [], drifted: [], hand: [], total: 0, things: 0, links: 0 };
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
    if (n.group !== undefined && typeof n.group !== "string") bad.push(`${at}: group must be a string`);
    if (n.words !== undefined) {
      if (!Array.isArray(n.words)) bad.push(`${at}: words must be a list of regex strings`);
      else for (const w of n.words) {
        try { if (typeof w !== "string" || !w) throw new Error("not a string"); new RegExp(w, "i"); } catch (e) { bad.push(`${at}: words entry ${JSON.stringify(w)} is not a valid regex (${e.message})`); }
      }
    }
  }
  for (const [k, l] of arr(map.links).entries()) {
    const at = `link ${k + 1}${l ? ` (${l.from} -> ${l.to})` : ""}`;
    if (!l || typeof l !== "object") { bad.push(`${at}: must be an object`); continue; }
    for (const key of ["from", "to"]) if (!ids.has(l[key])) bad.push(`${at}: ${key} is not the id of a thing`);
    if (typeof l.says !== "string" || !l.says) bad.push(`${at}: no says`);
    if (l.type !== undefined && !LINK_TYPES.includes(l.type)) bad.push(`${at}: unknown type ${JSON.stringify(l.type)} (use ${LINK_TYPES.join(", ")})`);
    const badEvidence = (e) => !evidenceOf(e) || (typeof e === "object" && e.token !== undefined && (typeof e.token !== "string" || !e.token));
    if (!Array.isArray(l.evidence) || !l.evidence.length || l.evidence.some(badEvidence)) bad.push(`${at}: evidence must be a list of paths or { file, token }, at least one`);
  }
  if (map.generated !== undefined && !Array.isArray(map.generated)) bad.push('"generated" must be a list');
  for (const [k, g] of arr(map.generated).entries()) {
    const at = `generated ${k + 1}${g && typeof g.by === "string" ? ` (${g.by})` : ""}`;
    if (!g || typeof g !== "object") { bad.push(`${at}: must be an object`); continue; }
    if (!Array.isArray(g.files) || !g.files.length || g.files.some((f) => typeof f !== "string")) bad.push(`${at}: files must be a list of paths, at least one`);
    if (typeof g.by !== "string" || !g.by) bad.push(`${at}: no by (the script that writes the files)`);
    if (typeof g.run !== "string" || !g.run) bad.push(`${at}: no run (the command that reruns it)`);
    if (g.inputs !== undefined && (!Array.isArray(g.inputs) || g.inputs.some((f) => typeof f !== "string"))) bad.push(`${at}: inputs must be a list of paths`);
  }
  const { total, gone } = missingPaths(map, dir);
  return { bad, gone, drifted: drift(map, dir), hand: handEdits(map, dir), total, things: arr(map.nodes).length, links: arr(map.links).length };
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
  for (const d of r.drifted) console.log(`DRIFT ${d.file}  (link ${d.from} -> ${d.to}): no longer has: ${d.token}`);
  for (const h of r.hand) console.log(`HAND ${h.file}  (written by ${h.by}): changed by hand after its last run, a rerun undoes it: ${h.commits.slice(0, 3).join("; ")}`);
  const share = r.total ? ((100 * r.gone.length) / r.total).toFixed(1) : "0.0";
  const wrong = r.bad.length + r.gone.length + r.drifted.length + r.hand.length > 0;
  console.log(`${wrong ? "FAIL" : "ok"}: ${r.things} things, ${r.links} links, ${r.total} listed paths, ${r.gone.length} gone (${share}%), ${r.bad.length} JSON mistakes, ${r.drifted.length} drifted${Array.isArray(map.generated) ? `, ${r.hand.length} hand-edited` : ""}`);
  return wrong ? 1 : 0;
}

let isMain = false;
try { isMain = !!process.argv[1] && fs.realpathSync(process.argv[1]).toLowerCase() === fs.realpathSync(SELF).toLowerCase(); } catch {}
if (isMain) process.exitCode = main(process.argv);
