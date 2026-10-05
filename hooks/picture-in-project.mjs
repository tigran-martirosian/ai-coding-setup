#!/usr/bin/env node
// picture-in-project: a PreToolUse hook for Nimbalyst's display_to_user. The chat shows a picture
// small from a copy of its data, so any file works there. But the enlarged view (a click on the
// picture) loads the file itself, and Nimbalyst only hands out files inside the open project: a
// picture from the temp folder or the home folder opens as an empty box with a broken-image mark
// (seen 2026-10-05, checked through the app's inspector). So a picture outside the project is
// blocked here, with the fix: copy it into the project and show the copy.
// It only blocks; it never moves a file. Added 2026-10-05.
// It fails open, so any error or odd input lets the call through. PICTURE_IN_PROJECT=off disables it.
import { readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";

const inside = (root, file) => {
  const rel = relative(resolve(root), resolve(file));
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
};

try {
  if ((process.env.PICTURE_IN_PROJECT || "").toLowerCase() === "off") process.exit(0);
  const event = JSON.parse(readFileSync(0, "utf8"));
  if (!/display_to_user$/.test(event.tool_name || "")) process.exit(0);
  const project = event.cwd;
  const items = (event.tool_input || {}).items;
  if (typeof project !== "string" || !project || !Array.isArray(items)) process.exit(0);
  const outside = items
    .map((item) => item && item.image && item.image.path)
    .filter((p) => typeof p === "string" && isAbsolute(p) && !inside(project, p));
  if (outside.length) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `picture-in-project: ${outside.length === 1 ? "this picture is" : "these pictures are"} outside the open project (${project}): ${outside.join(", ")}. ` +
          `The chat would show it small, but the enlarged view stays empty, because Nimbalyst only opens files inside the project. ` +
          `Copy the file into the project first (a folder for pictures or reports if it has one, otherwise a new folder such as "shown"), ` +
          `then call display_to_user again with the copy's path.`,
      },
    }));
  }
} catch {
  process.exit(0);
}
