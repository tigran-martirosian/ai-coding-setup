#!/usr/bin/env node
import { execFileSync } from "node:child_process";
// map.mjs: the Systems map of a project, a dictionary of its parts ("things") and what connects to what ("links").
// The map is one file, <project>/.claude/systems-map.json:
//   { "nodes": [{ "id", "name", "what", "files": [...], "notes": [...], "group"?, "words"?: [regex, ...] }],
//     "links": [{ "from", "to", "says", "type"?, "evidence": ["path" or { "file", "token" }, ...] }] }
// type is one of uses (the default), feeds, spends, opens, boosts, limits. A token is text the evidence file must still hold; a file that
// lacks it has drifted away from the link.
// Commands, run in the project folder (or add --project <dir>):
//   --near                 list every thing
//   --near <word>...       those things: what they are, where to start, their links with the code behind them, the things one step further
//   --brief                read a helper's brief on stdin; print the lines of the things it is about: the top 3 in full, one line for each further match, at most 2,000 characters
//   --check                list files and evidence paths that no longer exist, evidence that lost its token (DRIFT), words patterns that are one bare common word (WORD), and the JSON mistakes; exit 1 when anything is wrong
//   --scan                 what a builder needs to start a map: code files by folder, biggest files, entry points (at most about 8 KB)
// The two hooks (map-brief.mjs, map-nudge.mjs) import this file. Node.js only; the map file's reader is hooks/lib/map-file.mjs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MAP_CODE_EXT } from "../../hooks/lib/code-files.mjs";
import { loadMap, MAP_REL } from "../../hooks/lib/map-file.mjs";

const SELF = fileURLToPath(import.meta.url);
export const CMD = `node "${SELF.replace(/\\/g, "/")}"`;
export { loadMap, MAP_REL };

export const CODE_EXT = MAP_CODE_EXT;
// Folders that hold other people's code or build output
export const VENDORED = new Set(
  (
    "node_modules vendor vendors third_party third-party thirdparty bower_components dist build out target .git .venv venv __pycache__ " +
    ".next .nuxt .svelte-kit .gradle .idea .vscode coverage Pods Carthage site-packages .tox .mypy_cache .cache obj .terraform .yarn .pnpm-store"
  ).split(" "),
);

export const BRIEF_MAX = 2000; // characters of the whole --brief output; cut at whole lines
export const BRIEF_FULL = 3; // things in it with links; every further match gets one line
export const BRIEF_LINE_FILES = 3; // "Start in" files on such a line
export const BRIEF_WORDS = 2; // how-to things and topics matched by words alone get one line each, at most this many
const BRIEF_LINES_ROOM = 500; // characters kept free for those lines when the full entries would fill the cap
const SHARED_MIN = 30; // a folder that every file of a line starts with is written once when it is at least this long
export const BRIEF_FOLDER = 8; // a written folder holding files of more things than this names none of them
export const BRIEF_LINKS = 12; // links per thing
export const BRIEF_FILES = 6; // "Start in" files per thing
export const BRIEF_FILES_CUT = 3; // when the output is over the cap, start files are cut to this many before any link is cut
const SCAN_MAX = 8000;

// Single words that are ordinary English as well as a thing's id or name. A brief that says "the data file" or "the main page" must not pull
// in half the map, so these only match through a longer name ("Order data") or through a file.
export const COMMON = new Set(
  (
    "item items block map base data core common shared util utils helper helpers misc main app code file files test tests build config setup " +
    "system service services module modules page pages view views state store user users list type types model models event events task tasks " +
    "job jobs tool tools doc docs api high low server client web ui backend " +
    "frontend cache queue logic engine manager handler handlers controller controllers lib libs src script scripts release plugin plugins"
  ).split(" "),
);

/** A words pattern that is one bare COMMON word ("\\brelease\\b", "\\breleases?\\b", "^tests$"): it matches nearly every text, so the
 *  readers ignore it and --check flags it. */
export function bareCommon(w) {
  const s = String(w)
    .replace(/\\b/g, "")
    .replace(/^\^/, "")
    .replace(/\$$/, "")
    .toLowerCase();
  return [
    s,
    s.replace(/s\?$/, ""),
    s.replace(/es$/, ""),
    s.replace(/s$/, ""),
  ].some((c) => /^[a-z]+$/.test(c) && COMMON.has(c));
}

const FILE_EXTS = [
  ...new Set([
    ...CODE_EXT,
    "md",
    "json",
    "toml",
    "yaml",
    "yml",
    "html",
    "css",
    "scss",
    "cfg",
    "ini",
    "xml",
    "txt",
    "properties",
  ]),
];
const FILE_TEXT = new RegExp(
  String.raw`[\w./\\:-]*[\w-]\.(?:${FILE_EXTS.join("|")})(?![\w])`,
  "g",
);
const CAMEL = /\b[A-Z][a-z0-9]+(?:[A-Z][A-Za-z0-9]*)+\b/g;
const FOLDER_TEXT = /(?<![\w.-])[\w.-]+(?:\/[\w.-]+)+\/?/g;
const WHOLE_FILE = new RegExp("^(?:" + FILE_TEXT.source + ")$");
// Files named like their class: a brief that says "UserCard" points at UserCard.tsx
const CLASS_FILE =
  /\.(?:java|kt|cs|ts|tsx|jsx|vue|svelte|swift|scala|dart|php)$/;
const CLASS_EXTS = [
  "java",
  "kt",
  "cs",
  "ts",
  "tsx",
  "jsx",
  "vue",
  "svelte",
  "swift",
  "scala",
  "dart",
  "php",
];

export const LINK_TYPES = [
  "uses",
  "feeds",
  "spends",
  "opens",
  "boosts",
  "limits",
];
const DECIDED_MAX = 3; // DECISIONS.md lines under a thing in --near
const DECIDED_CHARS = 200; // characters of each such line, its line number included
// A file more things list than this names none of them in a brief, and a thing that only a link's evidence ties to a file is named by it
// only when at most this many things touch the file: a shared index file says nothing about which thing the brief is about.
export const FILE_SHARED_MAX = 3;

const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === "string" ? x : "");
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// A path is from the project root, absolute, or "~/..." for a file of the user's home (the setup's skills and agents in ~/.claude), so
// a map of any person's project can point at the setup without a user name in it.
const HOME_PATH = /^~[\\/]/;
export const placeOf = (dir, p) =>
  HOME_PATH.test(p)
    ? path.join(os.homedir(), p.slice(2))
    : path.resolve(dir, p);
// What a helper is shown: a "~/" path written out in full with forward slashes, so a Read of it works as is.
const shown = (p) =>
  HOME_PATH.test(p) ? placeOf("", p).replace(/\\/g, "/") : p;
const exists = (dir, p) => fs.existsSync(placeOf(dir, p));
const isFile = (p) => {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
};

// ---- the file -------------------------------------------------------------------------------------------------------------------------

/** One evidence entry in its normal shape { file, token? }, or null when it is neither a path string nor an object with a file. */
export function evidenceOf(e) {
  if (typeof e === "string") return e ? { file: e } : null;
  if (e && typeof e === "object" && typeof e.file === "string" && e.file)
    return typeof e.token === "string" && e.token
      ? { file: e.file, token: e.token }
      : { file: e.file };
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
  for (const n of arr(map?.nodes))
    for (const p of [...arr(n?.files), ...arr(n?.notes)])
      add(p, `thing ${n.id}`);
  for (const l of arr(map?.links))
    for (const { file: p } of evList(l)) add(p, `link ${l.from} -> ${l.to}`);
  for (const g of arr(map?.generated))
    for (const p of [...arr(g?.files), g?.by])
      add(p, `generated by ${str(g?.by)}`);
  return out;
}

/** The listed paths that are gone from disk: { total, gone: [[path, [who]]] }. */
export function missingPaths(map, dir) {
  const listed = listedPaths(map);
  const gone = [...listed].filter(([p]) => !exists(dir, p));
  return { total: listed.size, gone };
}

/** The generated entry that writes this project path ({ files, by, run, inputs }), or null. */
const normPath = (p) =>
  str(p)
    .replace(/\\/g, "/")
    .replace(/^(?:\.\/)+/, "")
    .toLowerCase();
export function generatorOf(map, rel) {
  return (
    arr(map?.generated).find((g) =>
      arr(g?.files).some((f) => normPath(f) === normPath(rel)),
    ) || null
  );
}

/** One line telling a session not to edit a generated file by hand. */
export const generatedLine = (rel, g) =>
  `${rel} is written by ${g.by}: change ${g.by}${arr(g.inputs).length ? ` (or its inputs ${g.inputs.join(", ")})` : ""} and run \`${g.run}\`; a hand edit is undone by its next run`;

/**
 * Generated files changed by a commit after the last commit that touched their script or inputs, without touching those: hand edits a rerun
 * would undo. [{ file, by, commits: [ "<sha> <subject>" ] }]. Needs git; a folder that is not a repository gives [].
 */
export function handEdits(map, dir) {
  const out = [];
  const log = (paths, range = []) => {
    try {
      return execFileSync(
        "git",
        ["-C", dir, "log", "--format=%H %s", ...range, "--", ...paths],
        {
          encoding: "utf8",
          timeout: 20000,
          windowsHide: true,
          stdio: ["ignore", "pipe", "ignore"],
        },
      )
        .split("\n")
        .filter(Boolean);
    } catch {
      return null;
    }
  };
  for (const g of arr(map?.generated)) {
    if (typeof g?.by !== "string") continue;
    const source = log([g.by, ...arr(g.inputs)]);
    if (source === null) return [];
    const last = source.length ? source[0].split(" ")[0] : null;
    if (!last) {
      out.push({
        file: arr(g.files)[0] ?? g.by,
        by: g.by,
        commits: [
          `${g.by} has no commit yet, so its outputs cannot be checked`,
        ],
      });
      continue;
    }
    // a commit that also changed the script or an input is a run (a lane merged after the latest script commit, too)
    const runs = new Set(source.map((c) => c.split(" ")[0]));
    for (const f of arr(g.files)) {
      const after = (log([f], [`${last}..HEAD`]) || [])
        .filter((c) => !runs.has(c.split(" ")[0]))
        .map((c) => c.slice(0, 7) + c.slice(40));
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
      try {
        t = fs.readFileSync(placeOf(dir, f), "utf8");
      } catch {}
      text.set(f, t);
    }
    return text.get(f);
  };
  const out = [];
  for (const l of links)
    for (const e of l.evidence) {
      if (!e.token) continue;
      const t = read(e.file);
      if (t !== null && !t.includes(e.token))
        out.push({
          file: e.file,
          from: l.from,
          to: l.to,
          says: l.says,
          token: e.token,
          link: l,
        });
    }
  return out;
}

/** The tokened evidence whose file exists and no longer holds the token: [{ file, from, to, says, token }]. */
export function drift(map, dir) {
  const links = arr(map?.links)
    .filter((l) => l && typeof l === "object")
    .map((l) => ({
      from: l.from,
      to: l.to,
      says: str(l.says),
      evidence: evList(l),
    }));
  return driftOf(links, dir).map(({ link, ...d }) => d);
}

/** Normal shape for the readers: plain strings, evidence as { file, token? }, links between known things only, no bare common word in
 *  words. dropGone removes paths that no longer exist. */
function prep(map, dir, dropGone) {
  const keep = (p) =>
    typeof p === "string" && p && (!dropGone || exists(dir, p));
  const wordRes = (n) =>
    arr(n.words).flatMap((w) => {
      try {
        return typeof w === "string" && w && !bareCommon(w)
          ? [new RegExp(w, "i")]
          : [];
      } catch {
        return [];
      }
    });
  const nodes = arr(map?.nodes)
    .filter((n) => n && typeof n.id === "string" && n.id)
    .map((n) => ({
      id: n.id,
      name: str(n.name) || n.id,
      what: str(n.what),
      files: arr(n.files).filter(keep).map(shown),
      notes: arr(n.notes).filter(keep).map(shown),
      group: str(n.group),
      words: wordRes(n),
    }));
  const ids = new Set(nodes.map((n) => n.id));
  const links = arr(map?.links)
    .filter((l) => l && ids.has(l.from) && ids.has(l.to))
    .map((l) => ({
      from: l.from,
      to: l.to,
      says: str(l.says),
      type: LINK_TYPES.includes(l.type) ? l.type : "",
      evidence: evList(l)
        .filter((e) => keep(e.file))
        .map((e) => ({ ...e, file: shown(e.file) })),
    }));
  return { nodes, links };
}

// ---- matching (the helper's brief -> the things it is about) --------------------------------------------------------------------------

/** The words a brief may call a thing by: its id, its name, the name without "The"/"Your" or a bracket, what the bracket holds. */
export function aliases(n) {
  const names = new Set([n.id, n.name]);
  const m = /^(.*?)\s*\((.*)\)$/.exec(n.name);
  if (m) {
    names.add(m[1]);
    names.add(m[2]);
  }
  for (const s of [...names]) names.add(s.replace(/^(the|your)\s+/i, ""));
  const out = new Set(
    [...names].map((s) =>
      s
        .toLowerCase()
        .replace(/[-_\s]+/g, " ")
        .trim(),
    ),
  );
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
    const p = m
      .replace(/^\/+|\/+$/g, "")
      .replace(/\.+$/, "")
      .replace(/^(?:\.\/)+/, "")
      .toLowerCase();
    if (p.includes("/") && !WHOLE_FILE.test(p)) out.add(p);
  }
  return out;
}

/** [all matching ids, ranked; files named in the text that the map knows; id -> how it matched: "file", "name", "folder" or "words"]:
 *  a named file first, then a name or id, then a written folder, then a words pattern, and only when none of the first three found
 *  anything, a named file that lies in the folder of a thing's file. */
export function briefFind(text, nodes, links, dir) {
  const own = new Map(),
    touch = new Map();
  for (const n of nodes)
    for (const f of n.files) {
      addTo(own, f, n.id);
      addTo(touch, f, n.id);
    }
  for (const l of links)
    for (const { file: e } of l.evidence) {
      addTo(touch, e, l.from);
      addTo(touch, e, l.to);
    }
  const named = new Set(
    (text.match(FILE_TEXT) ?? []).map((m) =>
      m
        .replace(/\\/g, "/")
        .toLowerCase()
        .replace(/^(?:\.?\/)+/, ""),
    ),
  );
  const camel = new Set(text.match(CAMEL) ?? []);
  // A written path names a listed file only when it can mean that one file: the whole path, an end that holds a folder
  // (systems-map/SKILL.md), or a bare name no other listed file has. A bare SKILL.md in a map of five skills names none of them; a full
  // path to a file in the project root names it.
  const base = new Map();
  for (const f of touch.keys())
    addTo(base, path.posix.basename(f).toLowerCase(), f);
  const root = dir.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const names = (fl, p) => {
    if (fl === p) return true;
    const [long, short] = fl.length > p.length ? [fl, p] : [p, fl];
    if (!long.endsWith("/" + short)) return false;
    // A longer path to a file of the project root names it only as that root's file: ~/.claude/CLAUDE.md or another project's
    // HANDOFF.md is not this project's.
    if (short === fl && !fl.includes("/")) return p === root + "/" + fl;
    return short.includes("/") || base.get(short).size === 1;
  };
  // A written path stops at a space, so a listed path with a space in it (its own, or the project root's) names its file when the brief
  // holds it whole: with a folder, also at the end of a longer path; a root file, bare or after the project root only.
  const slashed = text.replace(/\\/g, "/").toLowerCase();
  const spaced = (fl) =>
    [fl, root + "/" + fl].some(
      (q, k) =>
        q.includes(" ") &&
        new RegExp(
          (!k && fl.includes("/") ? "(?<![\\w.-])" : "(?<![\\w./-])") +
            escapeRe(q) +
            "(?![\\w])",
        ).test(slashed),
    );
  const got = new Set(),
    hit = new Set();
  for (const f of touch.keys()) {
    const fl = f.toLowerCase(),
      stem = path.posix.parse(f).name;
    const byPath = [...named].filter((p) => names(fl, p));
    for (const p of byPath) hit.add(p);
    if (
      byPath.length ||
      spaced(fl) ||
      (CLASS_FILE.test(f) && camel.has(stem) && stem.length >= 5)
    )
      got.add(f);
  }
  const score = new Map();
  const sc = (i) => {
    if (!score.has(i)) score.set(i, [0, 0, 0, 0]);
    return score.get(i);
  };
  for (const f of got) {
    const all = touch.get(f).size;
    if ((own.get(f)?.size ?? 0) > FILE_SHARED_MAX) continue;
    for (const i of touch.get(f)) {
      const mine = own.get(f)?.has(i);
      if (mine || all <= FILE_SHARED_MAX) sc(i)[0] += (mine ? 2 : 1) / all;
    }
  }
  const flat = " " + text.toLowerCase().replace(/[-_\s]+/g, " ") + " ";
  // A words hit ranks last: words are loose patterns, and a passing line of the brief ("Budget: 150k tokens") must not push out a thing
  // the brief names.
  for (const n of nodes) {
    let w = 0,
      x = 0;
    for (const a of aliases(n))
      if (new RegExp("(?<![a-z0-9])" + escapeRe(a) + "(?![a-z0-9])").test(flat))
        w += a.includes(" ") ? 2 : 1;
    for (const re of n.words) if (re.test(text)) x += 1;
    if (w) sc(n.id)[1] = w;
    if (x) sc(n.id)[3] = x;
  }
  // A written folder names the things that have a file in it (the folder itself, else the folders below it), unless more things sit
  // there than a brief can sensibly carry: a broad path names none of them.
  const here = new Map();
  for (const [f, ids] of touch) {
    const d = path.posix.dirname(f).toLowerCase();
    if (!here.has(d)) here.set(d, new Set());
    for (const i of ids) here.get(d).add(i);
  }
  for (const p of writtenFolders(text)) {
    const exact = [...here.keys()].filter(
      (d) => d === p || d.endsWith("/" + p) || p.endsWith("/" + d),
    );
    const dirs = exact.length
      ? exact
      : [...here.keys()].filter((d) => ("/" + d + "/").includes("/" + p + "/"));
    const ids = new Set(dirs.flatMap((d) => [...here.get(d)]));
    if (ids.size > 0 && ids.size <= BRIEF_FOLDER)
      for (const i of ids) sc(i)[2] += 1 / ids.size;
  }
  const order = new Map(nodes.map((n, k) => [n.id, k]));
  // A words hit alone does not count here: a loose pattern must not switch off the stronger hint of a folder.
  const bare = ![...score.values()].some((s) => s[0] || s[1] || s[2]);
  const fell = new Set();
  if (bare && (named.size || camel.size)) {
    // A file no thing lists: it counts by a written path, or a class name, that points at a folder holding a file of a thing, unless
    // more things sit there than a brief can carry. A bare name (index.ts) says nothing, a one-word folder (hooks/x.mjs) says too
    // little, and the project root is no folder to go by. At most BRIEF_FULL things come of it.
    const dirs = new Set(
      [...touch.keys()]
        .map((f) => path.posix.dirname(f))
        .filter((d) => d !== "."),
    );
    const folders = new Set();
    for (const d of dirs) {
      if (
        [...camel].some((t) =>
          CLASS_EXTS.some((x) => isFile(path.join(dir, d, `${t}.${x}`))),
        )
      )
        folders.add(d.toLowerCase());
      for (const p of named) {
        if (!p.includes("/") || hit.has(p)) continue; // a listed file was weighed above
        const parent = p.slice(0, p.lastIndexOf("/"));
        if (!parent.includes("/")) continue;
        if (
          d.toLowerCase() === parent ||
          d.toLowerCase().endsWith("/" + parent)
        )
          folders.add(d.toLowerCase());
      }
      const inDir = new Set(
        [...touch.keys()]
          .filter((f) => path.posix.dirname(f) === d)
          .flatMap((f) => [...touch.get(f)]),
      );
      if (inDir.size > BRIEF_FULL) folders.delete(d.toLowerCase());
    }
    const near = new Map();
    for (const f of touch.keys()) {
      if (!folders.has(path.posix.dirname(f).toLowerCase())) continue;
      for (const i of touch.get(f))
        near.set(
          i,
          (near.get(i) ?? 0) +
            ((own.get(f)?.has(i) ? 2 : 1) / touch.get(f).size) * 0.1,
        );
    }
    for (const i of [...near.keys()]
      .sort((a, b) => near.get(b) - near.get(a) || order.get(a) - order.get(b))
      .slice(0, BRIEF_FULL)) {
      sc(i)[0] += near.get(i);
      fell.add(i);
    }
  }
  const ranked = [...score.keys()].sort(
    (a, b) =>
      score.get(b)[0] - score.get(a)[0] ||
      score.get(b)[1] - score.get(a)[1] ||
      score.get(b)[2] - score.get(a)[2] ||
      score.get(b)[3] - score.get(a)[3] ||
      order.get(a) - order.get(b),
  );
  // The strongest way each thing matched; a thing found through the folder of an unlisted file counts as found by folder.
  const kinds = new Map(
    ranked.map((i) => {
      const [f, n, d] = score.get(i);
      return [
        i,
        fell.has(i)
          ? "folder"
          : f
            ? "file"
            : n
              ? "name"
              : d
                ? "folder"
                : "words",
      ];
    }),
  );
  return [ranked, got, kinds];
}

/** A link seen from one end. A link with a type shows its word: `feeds -> Pricing`, `<- limits from Cart`. */
const arrow = (l, id, by) =>
  l.from === id
    ? `${l.type ? l.type + " ->" : "to"} ${by.get(l.to).name}`
    : `${l.type ? "<- " + l.type + " " : ""}from ${by.get(l.from).name}`;

/** The folder every one of these files starts with, when there are two or more, it is absolute and SHARED_MIN characters or longer; else "". */
function sharedFolder(files) {
  if (files.length < 2 || !files.every((f) => /^(?:[A-Za-z]:)?\//.test(f)))
    return "";
  let parts = files[0].split("/").slice(0, -1);
  for (const f of files.slice(1)) {
    const q = f.split("/");
    let k = 0;
    while (k < parts.length && k < q.length - 1 && parts[k] === q[k]) k++;
    parts = parts.slice(0, k);
  }
  const d = parts.join("/");
  return d.length >= SHARED_MIN ? d : "";
}

/** "<head>: a, b", or with a long shared folder written once: "<head><join><folder>/: a, b". */
function startList(head, files, join) {
  if (!files.length) return head;
  const d = sharedFolder(files);
  return d
    ? `${head}${join}${d}/: ` +
        files.map((f) => f.slice(d.length + 1)).join(", ")
    : `${head}: ` + files.join(", ");
}

/** The map lines for the things a helper's brief is about, and only those. Empty string when none.
 *  The top BRIEF_FULL things matched by file, name or folder get a full entry; the rest one line each, then at most BRIEF_WORDS how-to
 *  things or topics matched by words alone, marked "(by words)". A code part matched by words alone is left out. Over BRIEF_MAX, whole
 *  lines are cut in this order: start files to BRIEF_FILES_CUT; links, one at a time from the entry with the most, until the full
 *  entries leave room for the one-line ones; one-line entries from the end; then the third and the second full entry become one line. */
export function brief(text, map, dir) {
  const { nodes, links } = prep(map, dir, true);
  const [ranked, got, kinds] = briefFind(text, nodes, links, dir);
  const by = new Map(nodes.map((n) => [n.id, n]));
  const strong = ranked.filter((i) => kinds.get(i) !== "words");
  const weak = ranked
    .filter((i) => kinds.get(i) === "words" && isGuide(by.get(i)))
    .slice(0, BRIEF_WORDS);
  if (!strong.length && !weak.length) return "";
  const firstFiles = (n) =>
    [...n.files].sort((a, b) => Number(!got.has(a)) - Number(!got.has(b)));
  const full = strong.slice(0, BRIEF_FULL).map((i) => {
    const n = by.get(i);
    const mine = links.filter((l) => l.from === i || l.to === i);
    mine.sort(
      (a, b) =>
        Number(!a.evidence.some((e) => got.has(e.file))) -
        Number(!b.evidence.some((e) => got.has(e.file))),
    );
    return {
      name: n.name,
      id: i,
      what: n.what,
      files: firstFiles(n).slice(0, BRIEF_FILES),
      notes: n.notes,
      lines: mine.map((l) => `- ${arrow(l, i, by)}: ${l.says}`),
      cap: BRIEF_LINKS,
    };
  });
  const oneLine = (i, words) =>
    startList(
      `- ${by.get(i).name} [${i}]`,
      firstFiles(by.get(i)).slice(0, BRIEF_LINE_FILES),
      " in ",
    ) + (words ? " (by words)" : "");
  const more = [
    ...strong.slice(BRIEF_FULL).map((i) => oneLine(i, false)),
    ...weak.map((i) => oneLine(i, true)),
  ];
  let keep = more.length,
    fileCap = BRIEF_FILES;
  const linksOf = (e) => Math.min(e.cap, e.lines.length);
  const entry = (e) => {
    const head = [`## ${e.name} [${e.id}]`, e.what];
    if (e.files.length)
      head.push(startList("Start in", e.files.slice(0, fileCap), " "));
    if (e.notes.length) head.push("Read: " + e.notes.join(", "));
    const k = linksOf(e),
      cut = e.lines.length - k;
    if (!e.lines.length) head.push("Links: none");
    else if (!k) head.push(`Links: ${cut} (--near ${e.id})`);
    else
      head.push(
        "Links:",
        ...e.lines.slice(0, k),
        ...(cut ? [`- (${cut} more: --near ${e.id})`] : []),
      );
    return head.join("\n");
  };
  const fullPart = () => full.map(entry).join("\n\n");
  const morePart = (n) =>
    more.length
      ? [
          "Also matched (name, where to start):",
          ...more.slice(0, n),
          ...(n < more.length
            ? [`- (${more.length - n} more matches left out)`]
            : []),
        ].join("\n")
      : "";
  const render = () =>
    [fullPart(), morePart(keep)].filter(Boolean).join("\n\n");
  let out = render();
  while (out.length > BRIEF_MAX) {
    // the entry with the most links shown, the last of equals
    const most = full.reduce(
      (m, e) => (linksOf(e) >= linksOf(m) ? e : m),
      full[0],
    );
    const shown = most ? linksOf(most) : 0;
    const room = more.length
      ? Math.min(morePart(more.length).length + 2, BRIEF_LINES_ROOM)
      : 0;
    if (fileCap > BRIEF_FILES_CUT) fileCap = BRIEF_FILES_CUT;
    else if (shown && fullPart().length > BRIEF_MAX - room)
      most.cap = shown - 1;
    else if (keep) keep--;
    else if (full.length > 1) {
      more.unshift(oneLine(full.pop().id, false));
      keep = 1;
    } else if (shown) most.cap = shown - 1;
    else break; // the top entry's name, what and start files stay whole
    out = render();
  }
  // A full entry made one line frees room: one-line entries cut before it come back while they fit.
  while (keep < more.length) {
    keep++;
    const next = render();
    if (next.length > BRIEF_MAX) {
      keep--;
      break;
    }
    out = next;
  }
  return out;
}

/** A how-to thing (id `do-`, group `how-to`) or a topic (id `topic-`, group `topic`). */
export const isGuide = (n) =>
  /^(do|topic)-/.test(n.id) || n.group === "how-to" || n.group === "topic";

/** Whether a session holds a file from its start, so a note pointing at it repeats what the session has: a SKILL.md of a skill installed
 *  in ~/.claude/skills or the project's .claude/skills (a public-repo copy too), a plugin's SKILL.md, a rules or agents file, a CLAUDE.md
 *  the session loads, the project's MEMORY.md. file is a path as prep() gives it (from the project root or absolute). */
export function heldAtStart(file, dir) {
  const key = (p) => path.resolve(p).replace(/\\/g, "/").toLowerCase();
  const homeDir = os.homedir();
  const f = key(placeOf(dir, file));
  const home = key(homeDir) + "/.claude";
  const proj = key(dir);
  const name = path.posix.basename(f);
  const parent = path.posix.dirname(f);
  if (name === "skill.md") {
    const s = path.basename(path.dirname(placeOf(dir, file)));
    if (
      [homeDir, dir].some((r) =>
        isFile(path.join(r, ".claude", "skills", s, "SKILL.md")),
      )
    )
      return true;
    if (f.startsWith(home + "/plugins/")) return true;
  }
  const inClaude = (sub) =>
    parent === `${home}/${sub}` || parent === `${proj}/.claude/${sub}`;
  if (name.endsWith(".md") && (inClaude("rules") || inClaude("agents")))
    return true;
  if (name === "claude.md") {
    if (f === `${home}/claude.md` || f === `${proj}/.claude/claude.md`)
      return true;
    if (proj === parent || proj.startsWith(parent.replace(/\/$/, "") + "/"))
      return true;
  }
  const projectKey = path
    .resolve(dir)
    .replace(/[^a-zA-Z0-9]/g, "-")
    .toLowerCase();
  return f === `${home}/projects/${projectKey}/memory/memory.md`;
}

/** The things a person's message names, best first: [{ id, name, files, score, held }] with the thing's first 3 files. A part of the code
 *  counts by its name or id only; a how-to thing or topic also by its name without "How to:" and by its words. A file the message names
 *  does not count. score counts the name and word hits; held says the thing's first file is one the session holds from its start
 *  (heldAtStart), so the map-prompt hook leaves it out. */
export function promptFind(text, map, dir) {
  const { nodes } = prep(map, dir, true);
  const flat = " " + text.toLowerCase().replace(/[-_\s]+/g, " ") + " ";
  const hits = [];
  nodes.forEach((n, k) => {
    const guide = isGuide(n);
    let s = 0;
    const names = new Set(aliases(n));
    // A how-to name reads "How to: web research"; what follows "How to:" is how people ask for it.
    const bare = n.name
      .replace(/^how to:\s*/i, "")
      .toLowerCase()
      .replace(/[-_\s]+/g, " ")
      .trim();
    if (guide && bare && !COMMON.has(bare)) names.add(bare);
    for (const a of names)
      if (new RegExp("(?<![a-z0-9])" + escapeRe(a) + "(?![a-z0-9])").test(flat))
        s += a.includes(" ") ? 2 : 1;
    if (guide) for (const re of n.words) if (re.test(text)) s += 1;
    if (s)
      hits.push({ id: n.id, name: n.name, files: n.files.slice(0, 3), s, k });
  });
  return hits
    .sort((a, b) => b.s - a.s || a.k - b.k)
    .map(({ id, name, files, s }) => ({
      id,
      name,
      files,
      score: s,
      held: files.length > 0 && heldAtStart(files[0], dir),
    }));
}

// ---- --near ---------------------------------------------------------------------------------------------------------------------------

/** The things a word means: an exact id, else a name or id holding it, else a description, else the code file of the thing or of one of its links. */
function find(word, nodes, links) {
  const w = word.toLowerCase();
  const exact = nodes.filter((n) => n.id.toLowerCase() === w);
  const named = nodes.filter(
    (n) => n.id.toLowerCase().includes(w) || n.name.toLowerCase().includes(w),
  );
  const told = nodes.filter((n) => n.what.toLowerCase().includes(w));
  const ids = new Set();
  for (const n of nodes)
    if (n.files.some((f) => f.toLowerCase().includes(w))) ids.add(n.id);
  for (const l of links)
    if (l.evidence.some((e) => e.file.toLowerCase().includes(w))) {
      ids.add(l.from);
      ids.add(l.to);
    }
  return exact.length
    ? exact
    : named.length
      ? named
      : told.length
        ? told
        : nodes.filter((n) => ids.has(n.id));
}

/** { text } with the things, or { error } when a word matches nothing. */
export function near(words, map, dir) {
  const { nodes, links } = prep(map, dir, false);
  if (!words.length)
    return {
      text: nodes.map((n) => `- ${n.id}: ${n.name}. ${n.what}`).join("\n"),
    };
  const hits = [];
  for (const w of words) {
    const found = find(w, nodes, links);
    if (!found.length)
      return {
        error: `nothing on the map matches "${w}"; ${CMD} --near lists every thing`,
      };
    for (const n of found) if (!hits.includes(n)) hits.push(n);
  }
  const by = new Map(nodes.map((n) => [n.id, n]));
  const mark = (p) => (exists(dir, p) ? p : `${p} [GONE]`);
  const drifted = new Set(driftOf(links, dir).map((d) => d.link));
  let decisions = null;
  try {
    decisions = fs
      .readFileSync(path.join(dir, "DECISIONS.md"), "utf8")
      .split(/\r?\n/)
      .map((x, k) => [k + 1, x])
      .filter(([, x]) => x.startsWith("- "));
  } catch {}
  const cut = (s) =>
    s.length > DECIDED_CHARS ? s.slice(0, DECIDED_CHARS - 1) + "…" : s;
  const out = [];
  for (const n of hits) {
    const mine = links.filter((l) => l.from === n.id || l.to === n.id);
    out.push("", `## ${n.name} [${n.id}]`, n.what);
    if (n.files.length) out.push("Start in: " + n.files.map(mark).join(", "));
    for (const f of n.files) {
      const g = generatorOf(map, f);
      if (g) out.push("Generated: " + generatedLine(f, g));
    }
    if (n.notes.length) out.push("Read: " + n.notes.map(mark).join(", "));
    out.push(mine.length ? "Links:" : "Links: none");
    for (const l of mine) {
      const lost =
        drifted.has(l) || l.evidence.some((e) => !exists(dir, e.file));
      out.push(
        `- ${arrow(l, n.id, by)}: ${l.says} (${l.evidence.map((e) => mark(e.file)).join(", ")})${lost ? " [CODE GONE]" : ""}`,
      );
    }
    if (decisions && n.words.length) {
      const hit = decisions.filter(([, x]) => n.words.some((re) => re.test(x)));
      if (hit.length)
        out.push(
          "Decided:",
          ...hit
            .slice(0, DECIDED_MAX)
            .map(([k, x]) => cut(`- line ${k}: ${x.slice(2)}`)),
          ...(hit.length > DECIDED_MAX
            ? [`(${hit.length - DECIDED_MAX} more in DECISIONS.md)`]
            : []),
        );
    }
    const seen = new Set(mine.flatMap((l) => [l.from, l.to]));
    const two = new Set(
      links
        .filter((l) => seen.has(l.from) || seen.has(l.to))
        .flatMap((l) => [l.from, l.to]),
    );
    for (const i of seen) two.delete(i);
    out.push("One step further: " + ([...two].sort().join(", ") || "nothing"));
  }
  return { text: out.join("\n").trimStart() };
}

// ---- --check --------------------------------------------------------------------------------------------------------------------------

/** { bad: [mistakes in the JSON], gone: [[path, who]], drifted: [drift()], hand, common: [[id, words pattern that is one bare common
 *  word]], total, things, links }. */
export function checkMap(map, dir) {
  const bad = [];
  const common = [];
  if (!map || typeof map !== "object" || Array.isArray(map)) {
    return {
      bad: ["the file must hold one JSON object with nodes and links"],
      gone: [],
      drifted: [],
      hand: [],
      common,
      total: 0,
      things: 0,
      links: 0,
    };
  }
  if (!Array.isArray(map.nodes)) bad.push('"nodes" must be a list');
  if (!Array.isArray(map.links)) bad.push('"links" must be a list');
  const ids = new Set();
  for (const [k, n] of arr(map.nodes).entries()) {
    const at = `thing ${k + 1}${n && typeof n.id === "string" ? ` (${n.id})` : ""}`;
    if (!n || typeof n !== "object") {
      bad.push(`${at}: must be an object`);
      continue;
    }
    if (typeof n.id !== "string" || !n.id) bad.push(`${at}: no id`);
    else if (ids.has(n.id)) bad.push(`${at}: duplicate id ${n.id}`);
    else ids.add(n.id);
    for (const key of ["name", "what"])
      if (typeof n[key] !== "string" || !n[key]) bad.push(`${at}: no ${key}`);
    if (
      !Array.isArray(n.files) ||
      !n.files.length ||
      n.files.some((f) => typeof f !== "string")
    )
      bad.push(`${at}: files must be a list of paths, at least one`);
    if (
      n.notes !== undefined &&
      (!Array.isArray(n.notes) || n.notes.some((f) => typeof f !== "string"))
    )
      bad.push(`${at}: notes must be a list of paths`);
    if (n.group !== undefined && typeof n.group !== "string")
      bad.push(`${at}: group must be a string`);
    if (n.words !== undefined) {
      if (!Array.isArray(n.words))
        bad.push(`${at}: words must be a list of regex strings`);
      else
        for (const w of n.words) {
          try {
            if (typeof w !== "string" || !w) throw new Error("not a string");
            new RegExp(w, "i");
            if (bareCommon(w)) common.push([n.id, w]);
          } catch (e) {
            bad.push(
              `${at}: words entry ${JSON.stringify(w)} is not a valid regex (${e.message})`,
            );
          }
        }
    }
  }
  for (const [k, l] of arr(map.links).entries()) {
    const at = `link ${k + 1}${l ? ` (${l.from} -> ${l.to})` : ""}`;
    if (!l || typeof l !== "object") {
      bad.push(`${at}: must be an object`);
      continue;
    }
    for (const key of ["from", "to"])
      if (!ids.has(l[key])) bad.push(`${at}: ${key} is not the id of a thing`);
    if (typeof l.says !== "string" || !l.says) bad.push(`${at}: no says`);
    if (l.type !== undefined && !LINK_TYPES.includes(l.type))
      bad.push(
        `${at}: unknown type ${JSON.stringify(l.type)} (use ${LINK_TYPES.join(", ")})`,
      );
    const badEvidence = (e) =>
      !evidenceOf(e) ||
      (typeof e === "object" &&
        e.token !== undefined &&
        (typeof e.token !== "string" || !e.token));
    if (
      !Array.isArray(l.evidence) ||
      !l.evidence.length ||
      l.evidence.some(badEvidence)
    )
      bad.push(
        `${at}: evidence must be a list of paths or { file, token }, at least one`,
      );
  }
  if (map.generated !== undefined && !Array.isArray(map.generated))
    bad.push('"generated" must be a list');
  for (const [k, g] of arr(map.generated).entries()) {
    const at = `generated ${k + 1}${g && typeof g.by === "string" ? ` (${g.by})` : ""}`;
    if (!g || typeof g !== "object") {
      bad.push(`${at}: must be an object`);
      continue;
    }
    if (
      !Array.isArray(g.files) ||
      !g.files.length ||
      g.files.some((f) => typeof f !== "string")
    )
      bad.push(`${at}: files must be a list of paths, at least one`);
    if (typeof g.by !== "string" || !g.by)
      bad.push(`${at}: no by (the script that writes the files)`);
    if (typeof g.run !== "string" || !g.run)
      bad.push(`${at}: no run (the command that reruns it)`);
    if (
      g.inputs !== undefined &&
      (!Array.isArray(g.inputs) || g.inputs.some((f) => typeof f !== "string"))
    )
      bad.push(`${at}: inputs must be a list of paths`);
  }
  const { total, gone } = missingPaths(map, dir);
  return {
    bad,
    gone,
    drifted: drift(map, dir),
    hand: handEdits(map, dir),
    common,
    total,
    things: arr(map.nodes).length,
    links: arr(map.links).length,
  };
}

// ---- --scan ---------------------------------------------------------------------------------------------------------------------------

/** All files git tracks in the folder. Throws when it is no git repository. */
export function trackedFiles(dir) {
  const out = execFileSync("git", ["-C", dir, "ls-files", "-z"], {
    encoding: "utf8",
    maxBuffer: 1 << 30,
    timeout: 20000,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  return out.split("\0").filter(Boolean);
}

export function isCode(rel) {
  const base = rel.slice(rel.lastIndexOf("/") + 1).toLowerCase();
  const dot = base.lastIndexOf(".");
  if (dot < 1 || !CODE_EXT.has(base.slice(dot + 1))) return false;
  if (/\.min\.[a-z]+$/.test(base) || base.endsWith(".d.ts")) return false;
  return !rel
    .split("/")
    .slice(0, -1)
    .some((s) => VENDORED.has(s));
}

export function countCodeFiles(dir) {
  return trackedFiles(dir).filter(isCode).length;
}

const ROUTEISH = new Set(
  (
    "routes route router routers controllers handlers endpoints api pages screens views commands cmd jobs workers tasks cron migrations " +
    "middleware resolvers consumers listeners"
  ).split(" "),
);
const MANIFESTS = new Set(
  (
    "pyproject.toml setup.py Cargo.toml go.mod pom.xml build.gradle build.gradle.kts Makefile Dockerfile docker-compose.yml docker-compose.yaml " +
    "composer.json Gemfile requirements.txt tsconfig.json Package.swift CMakeLists.txt"
  ).split(" "),
);
const MAIN_FILE =
  /^(?:(?:main|index|app|server|cli|__main__|manage|wsgi|asgi|program|startup)\.[a-z]+|[a-z0-9]*(?:application|main|program)\.(?:java|kt|cs))$/i;
const depth = (p) => p.split("/").length - 1;

export function scan(dir) {
  const all = trackedFiles(dir);
  const code = all.filter(isCode);
  const lines = [
    `# Scan of ${path.basename(dir)}: ${code.length} tracked code files (of ${all.length} tracked files; vendored and build folders skipped)`,
  ];
  const langs = new Map();
  for (const f of code)
    langs.set(
      f.split(".").pop().toLowerCase(),
      (langs.get(f.split(".").pop().toLowerCase()) ?? 0) + 1,
    );
  lines.push(
    "Languages: " +
      [...langs]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([e, c]) => `.${e} ${c}`)
        .join(", "),
  );

  const counts = new Map(),
    kids = new Map();
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
    const list = [...(kids.get(parent) ?? [])]
      .sort((a, b) => counts.get(b) - counts.get(a))
      .slice(0, level === 0 ? 30 : level === 1 ? 10 : 6);
    for (const c of list) {
      lines.push(`${"  ".repeat(level)}${c}/ ${counts.get(c)}`);
      if (level < 2 && counts.get(c) >= (level === 0 ? 10 : 40))
        emit(c, level + 1);
    }
  };
  emit("", 0);

  lines.push("", "## Biggest code files");
  const sized = code
    .map((f) => {
      try {
        return [f, fs.statSync(path.join(dir, f)).size];
      } catch {
        return [f, 0];
      }
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15);
  for (const [f, size] of sized) {
    let n = "?";
    try {
      n = fs.readFileSync(path.join(dir, f), "utf8").split("\n").length;
    } catch {}
    lines.push(
      `${String(Math.round(size / 1024)).padStart(5)} KB ${String(n).padStart(6)} lines  ${f}`,
    );
  }

  lines.push("", "## Entry points");
  const pkgs = all
    .filter(
      (f) =>
        /(^|\/)package\.json$/.test(f) &&
        depth(f) <= 3 &&
        !f.split("/").some((s) => VENDORED.has(s)),
    )
    .slice(0, 8);
  for (const p of pkgs) {
    try {
      const j = JSON.parse(
        fs.readFileSync(path.join(dir, p), "utf8").replace(/^﻿/, ""),
      );
      const bits = [];
      if (j.main) bits.push(`main ${j.main}`);
      if (j.bin)
        bits.push(
          `bin ${typeof j.bin === "string" ? j.bin : Object.values(j.bin).join(" ")}`,
        );
      if (j.workspaces)
        bits.push(`workspaces ${JSON.stringify(j.workspaces).slice(0, 80)}`);
      const scripts = Object.entries(j.scripts ?? {})
        .slice(0, 10)
        .map(([k, v]) => `${k}="${String(v).slice(0, 50)}"`);
      if (scripts.length) bits.push("scripts " + scripts.join(" "));
      lines.push(
        `${p}${j.name ? ` (${j.name})` : ""}: ${bits.join("; ") || "no main, bin or scripts"}`,
      );
    } catch {
      lines.push(`${p}: not readable as JSON`);
    }
  }
  const mains = code
    .filter(
      (f) => depth(f) <= 3 && MAIN_FILE.test(f.slice(f.lastIndexOf("/") + 1)),
    )
    .sort((a, b) => depth(a) - depth(b) || a.localeCompare(b))
    .slice(0, 25);
  if (mains.length) lines.push("Main-looking files: " + mains.join(", "));
  const manifests = all
    .filter(
      (f) =>
        depth(f) <= 3 &&
        MANIFESTS.has(f.slice(f.lastIndexOf("/") + 1)) &&
        !f.split("/").some((s) => VENDORED.has(s)),
    )
    .slice(0, 20);
  if (manifests.length)
    lines.push("Build and config files: " + manifests.join(", "));
  const flows = all
    .filter((f) => /^\.github\/workflows\/.+\.ya?ml$/.test(f))
    .slice(0, 5);
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
  const routes = [...routeDirs]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, 20);
  if (routes.length) {
    lines.push("Folders that look like routes, handlers, jobs or screens:");
    for (const [d, fs_] of routes)
      lines.push(
        `  ${d}/ ${fs_.length} files: ${fs_.slice(0, 5).join(", ")}${fs_.length > 5 ? ", ..." : ""}`,
      );
  }
  const out = lines.join("\n");
  return out.length > SCAN_MAX
    ? out.slice(0, SCAN_MAX).replace(/\n[^\n]*$/, "") +
        `\n(cut at ${SCAN_MAX} characters)`
    : out;
}

// ---- command line ---------------------------------------------------------------------------------------------------------------------

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

function main(argv) {
  const args = argv.slice(2);
  let dir = process.cwd();
  const pi = args.indexOf("--project");
  if (pi >= 0) {
    if (!args[pi + 1]) {
      console.error("--project needs a folder");
      return 1;
    }
    dir = path.resolve(args[pi + 1]);
    args.splice(pi, 2);
  }
  const cmd = args[0];
  if (cmd === "--scan") {
    try {
      console.log(scan(dir));
      return 0;
    } catch (e) {
      console.error(
        `--scan needs a git repository (git ls-files): ${
          String(e.stderr || e.message)
            .trim()
            .split("\n")[0]
        }`,
      );
      return 1;
    }
  }
  if (!["--near", "--brief", "--check"].includes(cmd)) {
    console.error(
      `usage: ${CMD} [--project <dir>] --near [word...] | --brief (text on stdin) | --check | --scan`,
    );
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
    console.error(
      `no map in ${dir}: ${MAP_REL} is missing. Build one with the systems-map skill (${CMD.replace("map.mjs", "SKILL.md").replace(/^node /, "")})`,
    );
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
    if (r.error) {
      console.error(r.error);
      return 1;
    }
    console.log(r.text);
    return 0;
  }
  const r = checkMap(map, dir);
  for (const b of r.bad) console.log(`BAD  ${b}`);
  for (const [p, who] of r.gone)
    console.log(`GONE ${p}  (${[...new Set(who)].join("; ")})`);
  for (const d of r.drifted)
    console.log(
      `DRIFT ${d.file}  (link ${d.from} -> ${d.to}): no longer has: ${d.token}`,
    );
  for (const h of r.hand)
    console.log(
      `HAND ${h.file}  (written by ${h.by}): changed by hand after its last run, a rerun undoes it: ${h.commits.slice(0, 3).join("; ")}`,
    );
  for (const [id, w] of r.common)
    console.log(
      `WORD ${id}: ${JSON.stringify(w)} is one common word, so the map ignores it; write the phrase people use (for example "release to the public repo").`,
    );
  const share = r.total ? ((100 * r.gone.length) / r.total).toFixed(1) : "0.0";
  const wrong =
    r.bad.length +
      r.gone.length +
      r.drifted.length +
      r.hand.length +
      r.common.length >
    0;
  console.log(
    `${wrong ? "FAIL" : "ok"}: ${r.things} things, ${r.links} links, ${r.total} listed paths, ${r.gone.length} gone (${share}%), ${r.bad.length} JSON mistakes, ${r.drifted.length} drifted, ${r.common.length} common words${Array.isArray(map.generated) ? `, ${r.hand.length} hand-edited` : ""}`,
  );
  return wrong ? 1 : 0;
}

let isMain = false;
try {
  isMain =
    !!process.argv[1] &&
    fs.realpathSync(process.argv[1]).toLowerCase() ===
      fs.realpathSync(SELF).toLowerCase();
} catch {}
if (isMain) process.exitCode = main(process.argv);
