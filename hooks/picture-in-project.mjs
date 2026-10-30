#!/usr/bin/env node
// picture-in-project: a PreToolUse hook for Nimbalyst's display_to_user. The chat card loads the
// picture from the path written in the call, every time it is drawn, so a file deleted or moved
// later turns into "Failed to load image: File not found" (seen 2026-10-30: a scratch folder was
// cleaned up after the picture was shown). The enlarged view also loads the file itself, and
// Nimbalyst only hands out files inside the open project (seen 2026-10-05).
// So a picture is shown only from <project>/shown/, a folder nothing cleans up: any other path is
// denied, with the picture already copied there and the copy's path in the message, so the retry
// is one call. Rewriting the call with updatedInput does not work: the tool gets the new path but
// the card keeps the one Claude wrote (tested 2026-10-30). Same bytes, same copy. The folder
// ignores itself in git. Added 2026-10-05, shown/ since 2026-10-30.
// It fails open, so any error or odd input lets the call through. PICTURE_IN_PROJECT=off disables it.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, extname, isAbsolute, join, relative, resolve } from "node:path";

const inside = (root, file) => {
  const rel = relative(resolve(root), resolve(file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

const keep = (project, file) => {
  const folder = join(project, "shown");
  if (inside(folder, file)) return file;
  const bytes = readFileSync(file);
  const hash = createHash("sha1").update(bytes).digest("hex").slice(0, 8);
  const ext = extname(file);
  const copy = join(folder, `${basename(file, ext)}-${hash}${ext}`);
  mkdirSync(folder, { recursive: true });
  const ignore = join(folder, ".gitignore");
  if (!existsSync(ignore)) writeFileSync(ignore, "*\n");
  if (!existsSync(copy)) writeFileSync(copy, bytes);
  return copy;
};

try {
  if ((process.env.PICTURE_IN_PROJECT || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!/display_to_user$/.test(event.tool_name || "")) process.exit(0);
  const project = event.cwd;
  const items = (event.tool_input || {}).items;
  if (typeof project !== "string" || !project || !Array.isArray(items)) process.exit(0);
  const moved = [];
  const missing = [];
  for (const item of items) {
    const path = item && item.image && item.image.path;
    if (typeof path !== "string" || !isAbsolute(path)) continue;
    try {
      const copy = keep(project, path);
      if (copy !== path) moved.push(`${path} -> ${copy}`);
    } catch {
      if (!inside(project, path)) missing.push(path); // inside the project it is the tool's own per-picture error
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
  if (missing.length) lines.push(`picture-in-project: could not read, so not copied: ${missing.join(", ")}. Check that the file exists.`);
  if (lines.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: lines.join("\n") },
    }));
  }
} catch {
  process.exit(0);
}
