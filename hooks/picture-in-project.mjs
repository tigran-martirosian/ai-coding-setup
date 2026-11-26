#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readlinkSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
} from "node:path";
// picture-in-project: a PreToolUse hook for Nimbalyst's display_to_user. The chat card loads the
// picture from the path written in the call, every time it is drawn, so a file deleted or moved
// later turns into "Failed to load image: File not found" (e.g. a scratch folder cleaned up after the picture was
// shown). The enlarged view also loads the file itself, and Nimbalyst only hands out files inside the open project.
// So a picture is shown only from <project>/shown/, a folder nothing cleans up: any other path is
// denied, with the picture already copied there and the copy's path in the message, so the retry
// is one call. Rewriting the call with updatedInput does not work: the tool gets the new path but
// the card keeps the one Claude wrote. Same bytes, same copy. The folder ignores itself in git.
// It fails open, so any error or odd input lets the call through. PICTURE_IN_PROJECT=off disables it.
// Only a picture is copied: not a picture, a network path (opening one sends the user's sign-in to that host), a
// file on a network drive or one over 20 MB is refused, and the bytes read must start like a picture, so the copy
// can't carry a key or a .env past Read's deny rules. A link is followed and these checks apply to what it points at.
import { emit, runHook } from "./lib/hook-io.mjs";

const PICTURE = /^\.(png|jpe?g|gif|webp|bmp|svg|avif|ico|tiff?)$/i;
const MAX_BYTES = 20 * 1024 * 1024;

const TWO_SLASHES = /^[\\/]{2}/;
// Whether the bytes start like a picture: the signatures of PNG, JPEG, GIF, WEBP, BMP, ICO, TIFF and AVIF, and
// for an .svg file an <svg tag near the start.
const looksLikePicture = (bytes, ext) => {
  const at = (i, s) => bytes.toString("latin1", i, i + s.length) === s;
  if (/^\.svg$/i.test(ext))
    return /<svg[\s>]/i.test(bytes.toString("utf8", 0, 64 * 1024));
  return (
    at(0, "\x89PNG\r\n\x1a\n") ||
    at(0, "\xff\xd8\xff") ||
    at(0, "GIF87a") ||
    at(0, "GIF89a") ||
    (at(0, "RIFF") && at(8, "WEBP")) ||
    at(0, "BM") ||
    at(0, "\0\0\x01\0") ||
    at(0, "II*\0") ||
    at(0, "MM\0*") ||
    (bytes.length >= 12 &&
      at(4, "ftyp") &&
      /avi[fs]/.test(
        bytes.toString("latin1", 8, Math.min(bytes.readUInt32BE(0), 64)),
      ))
  );
};

// The picture's bytes, { why } when it is refused, or null when it can't be read. The file is opened once and
// checked and read through that one handle, so it can't be swapped between the checks and the read.
const load = (path, links = 0) => {
  if (TWO_SLASHES.test(path))
    return { why: "a network or device path (two slashes at the start)" };
  if (!PICTURE.test(extname(path))) return { why: "not a picture" };
  let st;
  try {
    st = lstatSync(path);
  } catch {
    return null;
  }
  if (st.isSymbolicLink()) {
    if (links >= 8) return { why: "a chain of more than 8 links" };
    let target;
    try {
      target = readlinkSync(path);
    } catch {
      return null;
    }
    // Checked before anything opens it: a link to a network path must not reach that host either
    return load(resolve(dirname(path), target), links + 1);
  }
  let real;
  try {
    real = realpathSync.native(path);
  } catch {
    return null;
  }
  // A drive letter mapped to a network share resolves to its \\server\share path
  if (TWO_SLASHES.test(real)) return { why: "on a network drive" };
  let fd;
  try {
    fd = openSync(real, "r");
  } catch {
    return null;
  }
  try {
    const fst = fstatSync(fd);
    if (!fst.isFile()) return { why: "not a file" };
    if (fst.size > MAX_BYTES) return { why: "over 20 MB" };
    const bytes = readFileSync(fd);
    if (!looksLikePicture(bytes, extname(path)))
      return { why: "not a picture: its bytes do not start like one" };
    return { bytes };
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
};

const inside = (root, file) => {
  const rel = relative(resolve(root), resolve(file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

// The copy in <project>/shown/. A failure here is the hook's own and fails open for that picture only; only an
// unreadable picture is named.
const keep = (project, file, bytes) => {
  const folder = join(project, "shown");
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 8);
  const ext = extname(file);
  const copy = join(folder, `${basename(file, ext)}-${hash}${ext}`);
  mkdirSync(folder, { recursive: true });
  const ignore = join(folder, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  if (!existsSync(copy)) writeFileSync(copy, bytes);
  return copy;
};

runHook("picture-in-project", (event) => {
  if (!/display_to_user$/.test(event.tool_name || "")) return;
  const project = event.cwd;
  const items = (event.tool_input || {}).items;
  if (typeof project !== "string" || !project || !Array.isArray(items)) return;
  const moved = [];
  const missing = [];
  const refused = [];
  for (const item of items) {
    const path = item && item.image && item.image.path;
    if (typeof path !== "string" || !isAbsolute(path)) continue;
    if (inside(join(project, "shown"), path)) continue;
    const got = load(path);
    if (got?.why) {
      refused.push(`${path} (${got.why})`);
      continue;
    }
    if (!got) {
      if (!inside(project, path)) missing.push(path); // inside the project it is the tool's own per-picture error
      continue;
    }
    try {
      moved.push(`${path} -> ${keep(project, path, got.bytes)}`);
    } catch {
      continue; // the hook's own failure: this picture goes through as it is, the others are still handled
    }
  }
  const lines = [];
  if (moved.length) {
    lines.push(
      `picture-in-project: the chat loads a picture from the path in this call every time it draws the card, so show it from the project's "shown" folder, which nothing cleans up. Already copied there:`,
      ...moved,
      `Call display_to_user again with the path after the arrow.`,
    );
  }
  if (missing.length)
    lines.push(
      `picture-in-project: could not read, so not copied: ${missing.join(", ")}. Check that the file exists.`,
    );
  if (refused.length)
    lines.push(
      `picture-in-project: not copied and not shown: ${refused.join(", ")}. Only a local picture file of up to 20 MB is shown.`,
    );
  if (lines.length) emit.deny(lines.join("\n"));
});
