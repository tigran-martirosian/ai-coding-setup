// A project's decision record: the root DECISIONS.md (the purpose record and the index of topic files) and the files
// in docs/decisions/ that the split moved the entries into, word for word. Every hook that looks for a decision reads
// the files through here, so a decision is found wherever it now lives. The split script
// (skills/file-upkeep/decisions.mjs), the upkeep note and the update-project pass share the same rules:
// which lines the script writes itself (left out here), which sections a split moves, and a split failure that lasts.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileKey } from "./paths.mjs";
import { readJson, stateFile } from "./state.mjs";

export const DECISIONS_DIR = "docs/decisions";
export const INDEX_HEAD = "## Decision files";
export const INDEX_TEXT =
  'Entries live in docs/decisions/, moved there word for word. A new decision goes at the top of its topic file below; one that fits none goes in its job\'s file, docs/decisions/YYYY-MM-DD-<job>.md. Find any: grep -rn "<word>" DECISIONS.md docs/decisions/. Replaced entries: docs/decisions-archive.md.';
// A file name in docs/decisions/: a topic file has no date in front, a job file has one; at most 50 characters after it
export const VALID_NAME =
  /^(?:\d{4}-\d{2}-\d{2}-)?(?=[a-z0-9-]{1,50}\.md$)[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;
const RECORD_HEAD = "## What each thing is for";
const DATED = /^\d{4}-\d{2}-\d{2}/;

export const indexLine = (rel, title) => `- \`${rel}\`: ${title}`;

// Lines of a text: "\r\n" or "\n" ends a line; a final line end opens no empty last line.
const splitLines = (text) => {
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};

// The `## ` headings outside code fences: [{ heading, line }] (1-based), and the fence error or null. A column-0 line
// starting ``` or ~~~ opens a fence; the next column-0 line starting with the same three characters closes it.
function headings(lines) {
  const out = [];
  let fence = null;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const mark = l.startsWith("```")
      ? "```"
      : l.startsWith("~~~")
        ? "~~~"
        : null;
    if (fence) {
      if (mark === fence.mark) fence = null;
      continue;
    }
    if (mark) fence = { mark, line: i + 1 };
    else if (l.startsWith("## ")) out.push({ heading: l, line: i + 1 });
  }
  return {
    found: out,
    fenceError: fence ? `unclosed code fence at line ${fence.line}` : null,
  };
}
const isHead = (h, head) => h.heading.trimEnd() === head;

// The sections `--split` moves: every `## ` heading outside fences but the purpose record and the index.
export function movableSections(text) {
  const { found, fenceError } = headings(splitLines(text));
  return {
    sections: found.filter(
      (h) => !isHead(h, RECORD_HEAD) && !isHead(h, INDEX_HEAD),
    ),
    fenceError,
  };
}

// The project's decision files, relative posix paths: DECISIONS.md when it is a file, then the *.md files directly
// in docs/decisions/, topic files by name, then job files newest date first (same date: by name).
export function decisionFiles(dir) {
  const out = fs
    .statSync(path.join(dir, "DECISIONS.md"), { throwIfNoEntry: false })
    ?.isFile()
    ? ["DECISIONS.md"]
    : [];
  let entries;
  try {
    entries = fs.readdirSync(path.join(dir, DECISIONS_DIR), {
      withFileTypes: true,
    });
  } catch (e) {
    if (e.code === "ENOENT") return out;
    throw e;
  }
  const names = entries
    .filter((e) => e.isFile() && e.name.endsWith(".md"))
    .map((e) => e.name);
  const byName = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const topics = names.filter((n) => !DATED.test(n)).sort(byName);
  const jobs = names
    .filter((n) => DATED.test(n))
    .sort((a, b) => byName(b.slice(0, 10), a.slice(0, 10)) || byName(a, b));
  return [...out, ...[...topics, ...jobs].map((n) => `${DECISIONS_DIR}/${n}`)];
}

// Every line of the decision files as [{ file, line, text }] (line 1-based), minus the lines the split script writes
// itself: in DECISIONS.md's index block the index heading, the fixed paragraph and the index line of each topic file
// present; in a docs/decisions/ file its "# " title line. A hand-written line in the index block stays in.
export function decisionFileLines(dir) {
  const files = decisionFiles(dir).map((file) => ({
    file,
    lines: splitLines(fs.readFileSync(path.join(dir, file), "utf8")),
  }));
  const generated = new Set([INDEX_HEAD, INDEX_TEXT]);
  for (const { file, lines } of files) {
    const name = path.posix.basename(file);
    if (
      file !== "DECISIONS.md" &&
      VALID_NAME.test(name) &&
      !DATED.test(name) &&
      lines[0]?.startsWith("# ")
    )
      generated.add(indexLine(file, lines[0].slice(2)));
  }
  const out = [];
  for (const { file, lines } of files) {
    let from = 0,
      to = 0;
    if (file === "DECISIONS.md") {
      const { found } = headings(lines);
      const k = found.findIndex((h) => isHead(h, INDEX_HEAD));
      if (k >= 0) {
        from = found[k].line;
        to = found[k + 1]?.line ?? lines.length + 1;
      }
    } else if (lines[0]?.startsWith("# ")) [from, to] = [1, 2];
    lines.forEach((text, i) => {
      const n = i + 1;
      if (
        n >= from &&
        n < to &&
        (file !== "DECISIONS.md" || generated.has(text))
      )
        return;
      out.push({ file, line: n, text });
    });
  }
  return out;
}

// The last split failure that fails again until someone edits a file (mixed line ends, unclosed fence, no title
// line), as the script recorded it: { rootSha1, file, fileSha1, reason, at }, while DECISIONS.md and that file are
// both unchanged since; else null.
const sha1 = (file) => {
  try {
    return crypto
      .createHash("sha1")
      .update(fs.readFileSync(file))
      .digest("hex");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};
export const failureFile = (root) =>
  stateFile(
    "decisions",
    crypto.createHash("sha1").update(fileKey(root)).digest("hex").slice(0, 16),
  );
export function lastingFailure(root) {
  const rec = readJson(failureFile(root));
  if (!rec) return null;
  return sha1(path.join(root, "DECISIONS.md")) === rec.rootSha1 &&
    sha1(path.join(root, rec.file)) === rec.fileSha1
    ? rec
    : null;
}
