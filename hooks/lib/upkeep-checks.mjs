// The cheap upkeep checks, one source for the project pass (skills/update-project/pass.mjs, P3, P4, P8) and the
// upkeep note hook: the HANDOFF.md line limit, the "Replaces / replaced by" line finder and the dead-path finder.
// Each works on text or lines it is given; reading the files is the caller's job.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// HANDOFF.md holds current state, open items and the next step; over this many lines, or this many bytes (long
// paragraphs on one line slip past a line count), it carries done work. Every session reads it at its start and
// re-sends it on each later call, so its size is paid on every call.
export const HANDOFF_LIMIT = 120;
export const HANDOFF_BYTES = 12000;

// lines in a file's text; a last line ending in a newline is not one more
export const countLines = (text) =>
  text ? text.split(/\r?\n/).length - (text.endsWith("\n") ? 1 : 0) : 0;

// HANDOFF.md text over either limit: {lines, kb, text}, text naming the size and the limits; else null
export function handoffOver(text) {
  if (!text) return null;
  const lines = countLines(text);
  const bytes = Buffer.byteLength(text, "utf8");
  if (lines <= HANDOFF_LIMIT && bytes <= HANDOFF_BYTES) return null;
  const kb = Math.round(bytes / 1000);
  return {
    lines,
    kb,
    text: `${lines} lines, ${kb} KB, over the limit of ${HANDOFF_LIMIT} lines or ${HANDOFF_BYTES / 1000} KB`,
  };
}

// a DECISIONS.md line that says it replaces another entry, or is replaced by one
export const REPLACES = /\bReplaces\b|\breplaced by\b/i;
export const isReplacesLine = (text) => REPLACES.test(text);

// the lines of a list that say so: [{line, text}], line counted from 1 in the list given
export const replacesLines = (lines) =>
  lines.flatMap((text, i) =>
    isReplacesLine(text) ? [{ line: i + 1, text }] : [],
  );

// a backticked path worth checking: has a slash (a bare file name is a name, not a path), no placeholder, wildcard,
// variable or address, and is not a slash command
export const looksLikePath = (t) =>
  /[/\\]/.test(t) &&
  !/[<>*{}$%|=()[\] ]|^-|:\/\/|^\.\.\.|…/.test(t) &&
  !/^\/[\w-]+$/.test(t);

// the notes whose paths are checked, as names relative to the root: CLAUDE.md, HANDOFF.md, .claude/rules/*.md,
// those that exist
export function noteFiles(root) {
  const rules = path.join(root, ".claude", "rules");
  const names = [
    "CLAUDE.md",
    "HANDOFF.md",
    ...(isDir(rules)
      ? fs
          .readdirSync(rules)
          .filter((n) => n.endsWith(".md"))
          .map((n) => `.claude/rules/${n}`)
      : []),
  ];
  return names.filter((n) => isFile(path.join(root, n)));
}

// backticked paths in a note's text found neither from the root nor from home: [{line, path}], line counted from 1,
// path the backticked text as written; each text once per note, at its first line
export function deadPaths(text, root, home = os.homedir()) {
  const out = [];
  const seen = new Set();
  text.split(/\r?\n/).forEach((l, i) => {
    for (const [, t] of l.matchAll(/`([^`\n]+)`/g)) {
      if (!looksLikePath(t) || seen.has(t)) continue;
      seen.add(t);
      const p = t.replace(/^~(?=[/\\]|$)/, home).replace(/[/\\:]+$/, "");
      if (
        path.isAbsolute(p)
          ? fs.existsSync(p)
          : fs.existsSync(path.join(root, p)) ||
            fs.existsSync(path.join(home, p))
      )
        continue;
      out.push({ line: i + 1, path: t });
    }
  });
  return out;
}

function isDir(p) {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}
function isFile(p) {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}
