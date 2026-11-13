#!/usr/bin/env node
// file-link-gate: Stop hook. Nimbalyst's chat panel opens a markdown link to a local file only when its
// target is an absolute path with forward slashes (`/C:/x/y.md`, `C:/x/y.md`, `%20` or a raw space, a
// `:10` line suffix). It does not open a relative target (`docs/y.md`), a backslash one (`C:\x\y.md`) or
// a `file:///` one (checked by clicking; about one file link in seven was broken), nor
// a Git Bash `/c/...` one. On a Mac the working form is the plain absolute path (`/Users/you/y.md`).
// This hook reads the assistant's visible text of the current turn, ignores fenced ``` blocks and inline
// code spans, and blocks the stop ONCE when a markdown link points at a local file in one of the
// broken forms, listing each with the fixed `/C:/...` (or `/Users/...`) form (a relative one resolved
// against the session cwd). Web links, mailto:, nimbalyst://, other schemes, #anchors, images and Nimbalyst embeds
// (a "width=... height=..." title) are left alone.
// Since 2026-10-29 one more kind is blocked: a link in a working form to a local file OUTSIDE the session's
// project folder (project root = the nearest ancestor of the input's cwd with a CLAUDE.md or .git, else the
// cwd), because Nimbalyst opens a link only for a file inside the open project. Its fix line suggests the
// file's path in inline code instead. A link already in a broken form keeps its /C:/ fix as before; paths
// inside the project, web links, nimbalyst:// and embeds are left alone. Without a cwd, or for a root-relative
// "/x" target under a Windows cwd (it cannot be placed), nothing is flagged.
// Silent when stop_hook_active is set (no loops). Fails open. FILE_LINK_GATE=off disables it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TAIL_BYTES = 8 * 1024 * 1024;
const MAX_LISTED = 12;
const LINE_SUFFIX = /(?::\d+(?::\d+)?|#L\d+(?:-L?\d+)?)$/;

// Text outside fenced blocks and inline code spans
export const visibleProse = (text) => {
  const out = [];
  let fence = null;
  for (const line of text.split("\n")) {
    const m = /^\s*(`{3,}|~{3,})/.exec(line);
    if (m) {
      if (!fence) fence = m[1][0];
      else if (m[1][0] === fence) fence = null;
      continue;
    }
    if (!fence) out.push(line.replace(/(`+)[^`\n]*?\1/g, " "));
  }
  return out.join("\n");
};

// Markdown links [label](target), images skipped: [{raw, target}]
export function findLinks(text) {
  const links = [];
  const open = /\[((?:[^\]\\\n]|\\.)*)\]\(/g;
  let m;
  while ((m = open.exec(text))) {
    if (m.index > 0 && text[m.index - 1] === "!") continue;
    const start = m.index + m[0].length;
    let target, end;
    if (text[start] === "<") {
      const gt = text.indexOf(">", start);
      const nl = text.indexOf("\n", start);
      if (gt === -1 || (nl !== -1 && nl < gt)) continue;
      const close = text.indexOf(")", gt);
      if (close === -1) continue;
      target = text.slice(start + 1, gt);
      end = close + 1;
    } else {
      let depth = 1, i = start;
      for (; i < text.length && text[i] !== "\n"; i++) {
        if (text[i] === "(") depth++;
        else if (text[i] === ")" && --depth === 0) break;
      }
      if (depth !== 0 || text[i] !== ")") continue;
      target = text.slice(start, i);
      end = i + 1;
    }
    const title = /\s+"([^"]*)"$/.exec(target);
    if (title) target = target.slice(0, title.index);
    // Nimbalyst's embed syntax ([Label](rel/file.ext "width=1000 height=650")) takes a relative path
    if (title && /\b(width|height)=/.test(title[1])) { open.lastIndex = end; continue; }
    links.push({ raw: text.slice(m.index, end), target: target.trim() });
    open.lastIndex = end;
  }
  return links;
}

// Which broken form a target is in, or null when it opens or is not a local file
export function brokenForm(link) {
  if (!link || link.startsWith("#")) return null;
  const target = link.replace(LINE_SUFFIX, ""); // "README.md:10" is a file and a line, not a scheme
  if (/^file:/i.test(target)) return "file:// link";
  if (/^[a-z][a-z0-9+.-]+:/i.test(target)) return null; // http(s), mailto, nimbalyst:// and other schemes
  if (target.startsWith("\\\\")) return null; // network share
  if (target.includes("\\")) return "backslashes";
  if (/^\/[A-Za-z]\//.test(target)) return "Git Bash path";
  if (/^\/?[A-Za-z]:\//.test(target) || target.startsWith("/")) return null;
  if (target.startsWith("~") || /[./]/.test(target)) return "relative path";
  return null;
}

// The working form: /C:/... with forward slashes and %20 for spaces, line suffix kept as :N
export function fixedTarget(target, cwd) {
  let t = target, suffix = "";
  const s = LINE_SUFFIX.exec(t);
  if (s) {
    t = t.slice(0, s.index);
    suffix = s[0].startsWith("#L") ? `:${/\d+/.exec(s[0])[0]}` : s[0];
  }
  try { t = decodeURIComponent(t); } catch { t = t.replace(/%20/gi, " "); }
  t = t.replace(/^file:\/\/(localhost)?/i, "").replace(/\\/g, "/");
  const gitBash = (p) => p.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:"); // /c/x -> c:/x
  if (/^\/[A-Za-z]:\//.test(t)) t = t.slice(1);
  t = gitBash(t);
  if (t === "~" || t.startsWith("~/")) t = path.join(os.homedir(), t.slice(1));
  else if (!/^[A-Za-z]:\//.test(t)) {
    if (!cwd) return null;
    const base = gitBash(cwd.replace(/\\/g, "/"));
    // A Mac or Linux cwd starts with "/"; a drive or a \\server share is Windows
    t = (base.startsWith("/") && !base.startsWith("//") ? path.posix : path.win32).resolve(base, t);
  }
  t = t.replace(/\\/g, "/");
  if (t.startsWith("/")) return `${t.replace(/ /g, "%20")}${suffix}`; // a Mac or Linux path
  return `/${t[0].toUpperCase()}${t.slice(1).replace(/ /g, "%20")}${suffix}`;
}

const gitBashPath = (p) => p.replace(/^\/([A-Za-z])(?=\/|$)/, "$1:");

// The nearest ancestor of cwd holding a CLAUDE.md or .git, else cwd itself
export function projectRoot(cwd) {
  // CLAUDE_PROJECT_DIR is the open project; the hook's cwd follows Bash `cd` and can sit elsewhere
  const envDir = process.env.CLAUDE_PROJECT_DIR;
  try { if (envDir && fs.existsSync(envDir)) return gitBashPath(envDir.replace(/\\/g, "/")); } catch {}
  try {
    for (let d = cwd; ; ) {
      if (fs.existsSync(path.join(d, "CLAUDE.md")) || fs.existsSync(path.join(d, ".git"))) return d;
      const up = path.dirname(d);
      if (up === d) return cwd;
      d = up;
    }
  } catch { return cwd; }
}

// A working-form target (/C:/..., C:/..., /Users/...) that points outside the project: its path as it
// would be written in code; null when it is inside, not a local absolute path, or cannot be placed
export function outsideCode(link, cwd) {
  if (!cwd || !link) return null;
  let t = link.replace(LINE_SUFFIX, "");
  if (!/^\/?[A-Za-z]:\//.test(t) && !(t.startsWith("/") && !t.startsWith("//"))) return null;
  try { t = decodeURIComponent(t); } catch { t = t.replace(/%20/gi, " "); }
  t = t.replace(/^\/([A-Za-z]:\/)/, "$1");
  const base = gitBashPath(cwd.replace(/\\/g, "/"));
  if (t.startsWith("/") && /^[A-Za-z]:\//.test(base)) return null; // a Mac path under a Windows cwd: unplaceable
  const norm = (p) => p.replace(/\\/g, "/").replace(/\/+$/, "").toLowerCase();
  const a = norm(t), r = norm(projectRoot(base));
  return a === r || a.startsWith(r + "/") ? null : t;
}

export function badLinks(text, cwd) {
  const out = [], seen = new Set();
  for (const l of findLinks(visibleProse(text || ""))) {
    if (seen.has(l.raw)) continue;
    const form = brokenForm(l.target);
    if (!form) {
      const code = outsideCode(l.target, cwd);
      if (!code) continue;
      seen.add(l.raw);
      out.push({ raw: l.raw, target: l.target, form: "outside the project", fixed: null, code });
      continue;
    }
    seen.add(l.raw);
    const fixed = fixedTarget(l.target, cwd);
    // A broken-form link to a file outside the project: the fix is its path in code, not a /C:/ link
    const code = fixed ? outsideCode(fixed, cwd) : null;
    out.push(code ? { raw: l.raw, target: l.target, form, fixed: null, code } : { raw: l.raw, target: l.target, form, fixed });
  }
  return out;
}

// The assistant's visible text since the user's last prompt (tool results do not end the turn)
export function turnText(transcriptPath) {
  const fd = fs.openSync(transcriptPath, "r");
  let chunk;
  try {
    const size = fs.fstatSync(fd).size;
    const len = Math.min(size, TAIL_BYTES);
    const buf = Buffer.alloc(len);
    fs.readSync(fd, buf, 0, len, size - len);
    chunk = buf.toString("utf8");
  } finally {
    fs.closeSync(fd);
  }
  const lines = chunk.split("\n");
  const parts = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line.includes('"user"') && !line.includes('"assistant"')) continue;
    let e;
    try { e = JSON.parse(line); } catch { continue; }
    if (e.isSidechain) continue;
    const c = e.message?.content;
    if (e.type === "user") {
      if (typeof c === "string" || (Array.isArray(c) && c.some((b) => b.type === "text"))) break;
      continue;
    }
    if (e.type !== "assistant" || !Array.isArray(c)) continue;
    const t = c.filter((b) => b.type === "text" && typeof b.text === "string").map((b) => b.text).join("\n");
    if (t) parts.unshift(t);
  }
  return parts.join("\n");
}

export function reason(bad) {
  const lines = [`[file-link-gate] ${bad.length} file link(s) in this reply will not open in Nimbalyst's chat panel (relative, backslash and file:/// targets don't open; an absolute path with forward slashes, /C:/... or /Users/..., does):`];
  for (const b of bad.slice(0, MAX_LISTED)) {
    lines.push(`- ${b.raw} (${b.form}) -> ${b.code ? `a link opens only for a file inside the open project; write its path in code: \`${b.code}\`` : b.fixed ? `(${b.fixed})` : "use the file's absolute path with forward slashes (/C:/... or /Users/...)"}`);
  }
  if (bad.length > MAX_LISTED) lines.push(`- and ${bad.length - MAX_LISTED} more`);
  lines.push("Send a short follow-up that gives these files again as working links (the whole reply again only if it is short). Write file links this way from now on: [name](/C:/path/to/file.md), %20 for spaces, :line at the end, for a file inside the open project; a file outside it is named as its path in inline code.");
  return lines.join("\n");
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/").split("/").pop())) {
  let raw = "";
  process.stdin.on("data", (d) => (raw += d));
  process.stdin.on("end", () => {
    try {
      if ((process.env.FILE_LINK_GATE || "").toLowerCase() === "off") return;
      const input = JSON.parse(raw);
      if (input.stop_hook_active) return;
      let text = "";
      if (input.transcript_path) {
        try { text = turnText(input.transcript_path); } catch {}
      }
      const last = typeof input.last_assistant_message === "string" ? input.last_assistant_message : "";
      if (last && !text.includes(last)) text = text ? `${text}\n${last}` : last;
      const bad = badLinks(text, input.cwd);
      if (bad.length) process.stdout.write(JSON.stringify({ decision: "block", reason: reason(bad) }));
    } catch {
      // fail open
    }
  });
}
