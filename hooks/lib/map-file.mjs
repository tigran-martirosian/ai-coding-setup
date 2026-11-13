// The Systems map file, <project>/.claude/systems-map.json: where it is, how it is read, and which map belongs to an
// edited file. Shared by the map hooks (map-brief, map-drift, map-generated, map-nudge) and skills/systems-map/map.mjs.
import fs from "node:fs";
import path from "node:path";

export const MAP_REL = ".claude/systems-map.json";

/** The parsed map of a project folder, or null when it has none. Throws on a read error or invalid JSON. */
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

/** A path as the map writes it, for comparing: forward slashes, no leading "./", lower case. "" for a non-string. */
export const normRel = (p) =>
  typeof p === "string"
    ? p
        .replace(/\\/g, "/")
        .replace(/^(?:\.\/)+/, "")
        .toLowerCase()
    : "";

/**
 * The folder whose map covers an edited file: the project, or, for a file outside it (a git worktree of it, such as a
 * helper's), the nearest folder above the file that has a map. { dir, file (absolute), rel (inside dir, forward
 * slashes, case kept) }, or null when the file is outside every map folder.
 */
export function mapFolderFor(project, edited) {
  let dir = path.resolve(project);
  const file = path.resolve(dir, edited);
  const rel = (d) => path.relative(d, file).replace(/\\/g, "/");
  const outside = (d) => {
    const r = rel(d);
    return !r || r.startsWith("../") || r === ".." || path.isAbsolute(r);
  };
  if (outside(dir)) {
    let up = path.dirname(file);
    while (!fs.existsSync(path.join(up, MAP_REL)) && path.dirname(up) !== up)
      up = path.dirname(up);
    if (!fs.existsSync(path.join(up, MAP_REL))) return null;
    dir = up;
    if (outside(dir)) return null;
  }
  return { dir, file, rel: rel(dir) };
}
