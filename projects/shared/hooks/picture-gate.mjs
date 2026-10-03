#!/usr/bin/env node
// picture-gate: backs the `picture` skill ("never show a generated picture that fails its checklist").
// Registered per project (ask-anything, quick-tasks), not globally. Two events:
//   PreToolUse on mcp__nimbalyst__display_to_user: denies showing an image that Codex generated
//   Stop: blocks ONCE when the reply links such an image
// unless all of this holds for the image:
//   - the job folder (the picture's folder, the one above, or the check file's "Job folder: <path>" line) has
//     facts.md (an "In use" section naming saved photos or frames, 3+ facts, every fact with a source) and
//     checklist.md (with the four standing lines [view] [sizes] [physical] [fasteners]);
//   - <name>.check.md next to it, written after the picture, the facts and the checklist: no "- FAIL" line,
//     a "- PASS [tag]" line for each standing line ([sizes] with a real size), 4 more "- PASS:" lines,
//     at most 2 "- MINOR" lines and none about a size, a position or an attachment;
//   - if there is a <name>.review.md next to it (made by `picture.mjs review`; optional, the careful run uses
//     it): it is for these exact bytes and every point in it (R1, R2, ...) is answered in the check file;
//   - Claude opened the picture with Read in this session.
// "Codex generated" = the same bytes exist under ~/.codex/generated_images (PICTURE_GATE_DIR overrides),
// so a copy under any name is still caught. Other images pass untouched.
// picture.mjs imports the rules from here, so `gen` refuses on the same grounds before a picture is made.
// Fails open. PICTURE_GATE=off disables it.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

export const GEN_DIR = process.env.PICTURE_GATE_DIR || path.join(os.homedir(), ".codex", "generated_images");
const IMAGE = /\.(png|jpe?g|webp)$/i;
const MIN_OWN_PASS = 4;
const MAX_MINOR = 2;
export const STANDING = ["view", "sizes", "physical", "fasteners"];
const SIZE = /\d+(?:[.,]\d+)?\s*(?:cm|mm|m|in|inch|inches)\b/i;
// A wrong size, position, exit point or attachment is a FAIL, never a MINOR
const NOT_MINOR = /\btoo (long|short|big|small|large|wide|narrow|tall|high|low|far|close|thick|thin)\b|\b(longer|shorter|bigger|larger|smaller|wider|narrower|taller) than\b|\bskew|\btilt|\bwrong (side|place|position|end|size|way|direction|shaft|edge)\b|\bproportion|\bfloat|\bnot (attached|touching|connected|joined)\b|\bcomes? out of\b/i;

export const sha = (f) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const walk = (dir) => {
  let out = [];
  let entries = [];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return out; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out = out.concat(walk(p));
    else if (IMAGE.test(e.name)) out.push(p);
  }
  return out;
};
export const generatedImages = () => walk(GEN_DIR);

// The generated original this file is a copy of, or null
export const generatedOriginal = (file) => {
  const size = fs.statSync(file).size;
  let hash;
  for (const g of walk(GEN_DIR)) {
    if (fs.statSync(g).size !== size) continue;
    hash ??= sha(file);
    if (sha(g) === hash) return g;
  }
  return null;
};

const sibling = (file, ext) => file.replace(/\.[^.\\/]+$/, "") + ext;
export const checkFileOf = (file) => sibling(file, ".check.md");
export const reviewFileOf = (file) => sibling(file, ".review.md");
const readLines = (f) => fs.readFileSync(f, "utf8").split(/\r?\n/);
// "- PASS ...", "- **FAIL**: ...", "* MINOR ..." followed by `rest` (a regex source)
const verdict = (word, rest = "\\b") => new RegExp(`^\\s*[-*]\\s*\\**(?:${word})\\**:?\\s*${rest}`, "i");

// The folder that holds facts.md and checklist.md for this picture, or null
export const jobDirOf = (file) => {
  const dir = path.dirname(path.resolve(file));
  const check = checkFileOf(file);
  if (fs.existsSync(check)) {
    const named = readLines(check).map((l) => l.match(/^\s*Job folder:\s*`?([^`]+?)`?\s*$/i)).find(Boolean);
    if (named) return path.resolve(dir, named[1]);
  }
  return [dir, path.dirname(dir)].find((d) => fs.existsSync(path.join(d, "facts.md"))) || null;
};

const fileNamed = (jobDir, s, re) => {
  const m = s.replace(/[`*]/g, "").match(re);
  if (!m) return null;
  const p = path.resolve(jobDir, m[0]);
  return fs.existsSync(p) ? p : null;
};
const IMAGE_NAME = /[^\s"'()<>,;]+\.(?:png|jpe?g|webp)\b/i;
const FILE_NAME = /[^\s"'()<>,;]+\.[a-z0-9]{2,5}\b/i;

// facts.md split into its "In use" bullets and its fact bullets
const readFacts = (jobDir) => {
  const use = [], facts = [];
  let inUse = false;
  for (const l of readLines(path.join(jobDir, "facts.md"))) {
    const h = l.match(/^#{1,6}\s+(.*)$/);
    if (h) { inUse = /in use/i.test(h[1]); continue; }
    const b = l.match(/^\s*[-*]\s+(.*)$/);
    if (b) (inUse ? use : facts).push(b[1].trim());
  }
  return { use, facts };
};

// The saved photos and frames of the thing in use that facts.md names
export const inUseImages = (jobDir) => {
  try { return readFacts(jobDir).use.map((b) => fileNamed(jobDir, b, IMAGE_NAME)).filter(Boolean); } catch { return []; }
};

// null when facts.md is good enough to draw from, else what is missing
export const factsProblem = (jobDir) => {
  if (!fs.existsSync(path.join(jobDir, "facts.md"))) return "there is no facts.md in the job folder";
  const { use, facts } = readFacts(jobDir);
  const short = (s) => `"${s.slice(0, 70)}"`;
  if (!use.length) return 'facts.md has no "## In use" section that lists saved photos or video frames of the thing being used (or "- none: <why there is no such footage>")';
  for (const b of use) {
    if (/^none\b\W+\S.{9,}/i.test(b)) continue;
    if (!fileNamed(jobDir, b, IMAGE_NAME)) return `facts.md, In use: ${short(b)} names no picture file that exists in the job folder`;
  }
  if (facts.length < 3) return `facts.md has ${facts.length} fact line(s); the layout needs at least 3, each with its source`;
  for (const b of facts) {
    const s = b.match(/\bsource:\s*(.+)$/i)?.[1];
    if (!s) return `facts.md: no source for ${short(b)}. A fact without a source is looked up before anything is generated; it is not a footnote`;
    if (!/https?:\/\//i.test(s) && !/^\W*user\b/i.test(s) && !fileNamed(jobDir, s, FILE_NAME)) return `facts.md: the source of ${short(b)} is not a link, "user" or a file that exists in the job folder`;
  }
  return null;
};

export const checklistProblem = (jobDir) => {
  const f = path.join(jobDir, "checklist.md");
  if (!fs.existsSync(f)) return "there is no checklist.md in the job folder";
  const text = fs.readFileSync(f, "utf8");
  const missing = STANDING.filter((t) => !text.includes(`[${t}]`));
  return missing.length ? `checklist.md lacks the standing line(s) ${missing.map((t) => `[${t}]`).join(" ")}` : null;
};

// The numbered points (R1, R2, ...) of a review file, and the picture hash it was made for
export const readReview = (reviewFile) => {
  const lines = readLines(reviewFile);
  return {
    hash: lines.map((l) => l.match(/^sha256:\s*([0-9a-f]{64})\s*$/i)).find(Boolean)?.[1].toLowerCase() || null,
    points: lines.map((l) => l.match(/^R(\d+):/)).filter(Boolean).map((m) => Number(m[1])),
  };
};

// null when a generated picture may be used as the base of an edit pass, else why not
export const editBaseProblem = (file) => {
  const name = path.basename(file);
  const check = checkFileOf(file);
  if (!fs.existsSync(check)) return `${name} is a generated picture that was never checked`;
  const lines = readLines(check);
  if (lines.some((l) => /rejected by the user/i.test(l))) return `${name} was rejected by the user`;
  if (!lines.some((l) => verdict("PASS", "\\[view\\]").test(l))) return `the view of ${name} did not pass, and an edit keeps the view`;
  return null;
};

// Was one of these file names opened with the Read tool in this transcript? null = can't tell
const wasRead = (transcriptPath, names) => {
  let text;
  try { text = fs.readFileSync(transcriptPath, "utf8"); } catch { return null; }
  for (const line of text.split("\n")) {
    if (!line.includes('"Read"') || !names.some((n) => line.includes(n))) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    const content = Array.isArray(e.message?.content) ? e.message.content : [];
    for (const b of content) {
      if (b.type !== "tool_use" || b.name !== "Read") continue;
      if (names.includes(path.basename(String(b.input?.file_path || "").replace(/\\/g, "/")))) return true;
    }
  }
  return false;
};

// null when the image may be shown, else the reason it may not
export const whyNot = (file, transcriptPath) => {
  if (!IMAGE.test(file) || !fs.existsSync(file)) return null;
  const original = generatedOriginal(file);
  if (!original) return null;
  const name = path.basename(file);
  const check = checkFileOf(file);
  const checkName = path.basename(check);
  if (!fs.existsSync(check)) return `${name} has no check file (${checkName} next to it)`;
  const checkTime = fs.statSync(check).mtimeMs;
  if (checkTime < fs.statSync(file).mtimeMs) return `${checkName} is older than ${name}, so it was not written for this picture`;

  const jobDir = jobDirOf(file);
  if (!jobDir) return `${name} has no facts.md (in its folder or the one above; a copy kept elsewhere names it with a "Job folder: <path>" line in ${checkName})`;
  const before = factsProblem(jobDir) || checklistProblem(jobDir);
  if (before) return before;
  for (const f of ["facts.md", "checklist.md"]) {
    if (fs.statSync(path.join(jobDir, f)).mtimeMs > checkTime) return `${f} changed after ${checkName} was written, so ${name} was checked against an older version`;
  }

  const lines = readLines(check);
  const count = (re) => lines.filter((l) => re.test(l)).length;
  const fails = count(verdict("FAIL"));
  if (fails) return `${name} fails ${fails} line(s) of its checklist`;
  const untagged = STANDING.filter((t) => !count(verdict("PASS", `\\[${t}\\]`)));
  if (untagged.length) return `${checkName} has no PASS line for the standing line(s) ${untagged.map((t) => `[${t}]`).join(" ")}`;
  if (!SIZE.test(lines.find((l) => verdict("PASS", "\\[sizes\\]").test(l)))) return `the [sizes] line of ${checkName} names no real size (in cm) to compare the picture with`;
  const own = count(verdict("PASS")) - count(verdict("PASS", "\\[")) - count(verdict("PASS", "\\(?R\\d"));
  if (own < MIN_OWN_PASS) return `${checkName} has ${own} PASS lines of its own besides the standing ones; the checklist needs at least ${MIN_OWN_PASS}`;
  const minors = lines.filter((l) => verdict("MINOR").test(l));
  const wrong = minors.find((l) => NOT_MINOR.test(l));
  if (wrong) return `${checkName} calls this MINOR: "${wrong.trim().slice(0, 90)}". A wrong size, position, exit point or attachment is a FAIL`;
  if (minors.length > MAX_MINOR) return `${checkName} has ${minors.length} MINOR lines; more than ${MAX_MINOR} leftover flaws is not a passing picture`;

  const review = reviewFileOf(file);
  const reviewName = path.basename(review);
  // The review is optional (the 5-minute rule skips it); when there is one, it has to be answered
  if (fs.existsSync(review)) {
    const { hash, points } = readReview(review);
    if (hash !== sha(file)) return `${reviewName} was not made for this picture (its sha256 line does not match)`;
    const open = points.filter((n) => !count(verdict("PASS|FAIL|MINOR", `\\(?R${n}\\b`)));
    if (open.length) return `${checkName} does not answer the reviewer's point(s) ${open.map((n) => `R${n}`).join(", ")}`;
  }

  if (transcriptPath && wasRead(transcriptPath, [name, path.basename(original)]) === false) return `${name} was never opened with Read in this session, so it was not looked at`;
  return null;
};

const REASON = (why) =>
  `picture-gate: ${why}. Don't show or link this picture. Follow the picture skill: facts.md with sources and real in-use frames first, ` +
  `checklist.md with the four standing lines, then for each try: open it with Read and write the check file ` +
  `(one "- PASS ..." or "- FAIL ..." line per checklist line, and per reviewer point if a review was run). If any line fails, edit or ` +
  `regenerate once and show only a picture that passes. If none passes, say so, show none and offer a careful run or a drawn diagram.`;

// Image paths linked in a reply: [text](path) and ![alt](path), absolute or relative to cwd
export const linkedImages = (text, cwd) => {
  const out = [];
  for (const m of String(text || "").matchAll(/\]\(\s*<?([^)>\n]+?)>?(?:\s+"[^"]*")?\s*\)/g)) {
    let p = m[1].trim();
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) continue;
    try { p = decodeURIComponent(p); } catch {}
    p = p.replace(/^\/(?=[A-Za-z]:[\\/])/, "");
    if (!IMAGE.test(p)) continue;
    out.push(path.isAbsolute(p) ? p : path.resolve(cwd || process.cwd(), p));
  }
  return out;
};

const lastReply = (transcriptPath) => {
  const lines = fs.readFileSync(transcriptPath, "utf8").split("\n");
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try { e = JSON.parse(lines[i]); } catch { continue; }
    if (e.type === "user") break;
    if (e.type !== "assistant" || !Array.isArray(e.message?.content)) continue;
    if (e.message.content.some((b) => b.type === "tool_use")) break;
    const t = e.message.content.filter((b) => b.type === "text").map((b) => b.text).join("\n");
    if (t) parts.unshift(t);
  }
  return parts.join("\n");
};

if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === fileURLToPath(import.meta.url).toLowerCase()) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if (process.env.PICTURE_GATE === "off") return;
      const input = JSON.parse(raw);
      const firstWhy = (files) => {
        for (const f of files) { const why = whyNot(f, input.transcript_path); if (why) return why; }
        return null;
      };
      if (input.hook_event_name === "Stop") {
        if (input.stop_hook_active) return;
        const text = typeof input.last_assistant_message === "string" && input.last_assistant_message
          ? input.last_assistant_message
          : input.transcript_path ? lastReply(input.transcript_path) : "";
        const why = firstWhy(linkedImages(text, input.cwd));
        if (why) process.stdout.write(JSON.stringify({ decision: "block", reason: REASON(why) }));
        return;
      }
      const items = Array.isArray(input.tool_input?.items) ? input.tool_input.items : [];
      const why = firstWhy(items.map((i) => i?.image?.path).filter((p) => typeof p === "string"));
      if (why) process.stdout.write(JSON.stringify({
        hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "deny", permissionDecisionReason: REASON(why) },
      }));
    } catch {
      // fail open
    }
  });
}
