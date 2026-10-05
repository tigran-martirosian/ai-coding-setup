#!/usr/bin/env node
// handoff-brief: writes a short brief of a Claude Code session so work can continue in a fresh
// session (the /handoff skill). Reads only the transcript: the first and last user requests,
// files edited, and Claude's last reply.
// Usage: node handoff-brief.mjs --summary <file> [--transcript <file.jsonl>] [--cwd <project folder>]
// --summary: a text file with where the work stands, written by Claude first. It becomes the
// "Where we are" part and is deleted afterwards. Without it no brief is written: a brief with an
// empty summary leaves the next session to guess.
// --hook: Stop hook mode. Reads the hook JSON from stdin and silently rewrites
// ~/.claude/handoffs/<folder>-latest.md after every reply, so a brief exists even when Claude
// usage runs out (then continue in a GPT or Gemini session from that file). Fails open.
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const args = process.argv.slice(2);
const hook = args.includes("--hook");
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
let hookInput = {};
if (hook) {
  try { hookInput = JSON.parse(fs.readFileSync(0, "utf8")); } catch { process.exit(0); }
  if (process.env.HANDOFF_HOOK === "off" || !hookInput.transcript_path) process.exit(0);
}
const summaryFile = (opt("--summary") || "").replace(/^~(?=$|[\\/])/, os.homedir());
let summary = "";
if (!hook) {
  const how = "Write 5 to 12 bullets on where the work stands to a file, then run this again with --summary <that file>.";
  if (!summaryFile) { console.log(`No brief written: the summary is missing. ${how}`); process.exit(1); }
  if (!fs.existsSync(summaryFile)) { console.log(`No brief written: ${summaryFile} is not there. ${how}`); process.exit(1); }
  summary = fs.readFileSync(summaryFile, "utf8").trim();
  if (summary.length < 40) { console.log(`No brief written: ${summaryFile} is nearly empty. ${how}`); process.exit(1); }
}
const cwd = path.resolve(hookInput.cwd || opt("--cwd") || process.cwd());
const projectsDir = path.join(os.homedir(), ".claude", "projects");

// Transcript: given, else the newest one for this folder (the folder name with every non-letter/digit as "-")
function findTranscript() {
  if (hook) return hookInput.transcript_path;
  if (opt("--transcript")) return opt("--transcript");
  const dir = path.join(projectsDir, cwd.replace(/[^A-Za-z0-9]/g, "-"));
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".jsonl"))
    .map((f) => path.join(dir, f)).sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return files[0] ?? null;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) + " …" : s);

function readSession(file) {
  const prompts = [], edited = [];
  let lastReply = "", context = 0, sessionCwd = "";
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.isSidechain) continue;
    if (j.cwd) sessionCwd = j.cwd;
    const content = j.message?.content;
    if (j.type === "user" && !j.isMeta) {
      let text = typeof content === "string" ? content
        : Array.isArray(content) ? content.filter((c) => c.type === "text").map((c) => c.text).join("\n") : "";
      const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
      if (cmd) text = cmd[1] + " " + (text.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? "");
      text = text.trim();
      if (text && !text.startsWith("<") && !text.startsWith("[System")) prompts.push(text);
    }
    if (j.type === "assistant" && Array.isArray(content)) {
      const u = j.message.usage;
      if (u && j.message.model !== "<synthetic>")
        context = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
      for (const c of content) {
        if (c.type === "text" && c.text.trim()) lastReply = c.text.trim();
        const f = c.type === "tool_use" && (c.input?.file_path || c.input?.notebook_path);
        if (f && /^(Edit|Write|MultiEdit|NotebookEdit)$/.test(c.name)) {
          const i = edited.indexOf(f);
          if (i >= 0) edited.splice(i, 1);
          edited.push(f);
        }
      }
    }
  }
  return { prompts, edited, lastReply, context, sessionCwd };
}

const transcript = findTranscript();
if (!transcript || !fs.existsSync(transcript)) {
  if (hook) process.exit(0);
  console.error(`No Claude transcript found for ${cwd}. Run this from the project folder, or pass --transcript <file>.`);
  process.exit(1);
}
let s;
try { s = readSession(transcript); } catch (e) { if (hook) process.exit(0); throw e; }
const work = s.sessionCwd || cwd;
const first = s.prompts[0] ?? "(none)";
const recent = s.prompts.slice(1).slice(-8);
const stamp = new Date().toISOString().slice(0, 16).replace(/[-:]/g, "").replace("T", "-");
const outDir = path.join(os.homedir(), ".claude", "handoffs");
// Two projects can have the same folder name (C:\work\api and D:\old\api).
// The plain name stays with the project that already holds <folder>-latest.md; another project
// with that folder name gets <folder>-<6 characters from its path>, so they never overwrite
// each other. Each brief names its project in the "Project folder" line.
const samePath = (a, b) => {
  const norm = (p) => (process.platform === "win32" ? path.resolve(p).toLowerCase() : path.resolve(p));
  return norm(a) === norm(b);
};
const folderOf = (text) => text.match(/^Project folder: `(.+?)`\. /m)?.[1];
function briefName() {
  const base = path.basename(work);
  let owner;
  try { owner = folderOf(fs.readFileSync(path.join(outDir, `${base}-latest.md`), "utf8")); } catch {}
  if (!owner || samePath(owner, work)) return base;
  return `${base}-${createHash("sha1").update(path.resolve(work).toLowerCase()).digest("hex").slice(0, 6)}`;
}
const name = briefName();
// Hook mode: one brief per session (<folder>-auto-<id>.md), plus <folder>-latest.md for the newest
const autoPrefix = `${name}-auto-`;
const out = path.join(outDir, hook ? `${autoPrefix}${path.basename(transcript, ".jsonl").slice(0, 8)}.md`
  : `${name}-${stamp}.md`);

const brief = [
  `# Handoff: ${path.basename(work)}`,
  "",
  `From session \`${path.basename(transcript, ".jsonl")}\` (~${Math.round(s.context / 1000)}k tokens of context), written ${new Date().toLocaleString()}.`,
  `Project folder: \`${work}\`. Follow its CLAUDE.md (and HANDOFF.md if there is one) before changing anything.`,
  "",
  "## Where we are",
  "",
  hook ? "(Written automatically after the last reply, with no summary: work out where things stand from the latest requests and the last reply below, then check the files.)"
    : summary,
  "",
  "## First request (the goal)",
  "",
  cut(first, 1500),
  "",
  "## Latest requests (oldest first)",
  "",
  // The newest 3 requests usually hold the task, so they get more room
  ...(recent.length ? recent.map((p, i) => `- ${cut(p.replace(/\s+/g, " "), i >= recent.length - 3 ? 3000 : 600)}`) : ["- (none)"]),
  "",
  "## Files edited (most recent last)",
  "",
  ...(s.edited.length ? s.edited.slice(-30).map((f) => `- \`${f}\``) : ["- (none)"]),
  "",
  "## Claude's last reply",
  "",
  cut(s.lastReply || "(none)", 2500),
  "",
].join("\n");

try {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(out, brief);
  if (hook) writeLatest();
} catch (e) { if (hook) process.exit(0); throw e; }
if (!hook) {
  fs.rmSync(summaryFile, { force: true });
  console.log(out);
}

// <folder>-latest.md = this brief + the other sessions of the last 2 days in this folder, so a
// small side session that replied last doesn't hide the one the user means. Auto briefs older
// than 7 days are deleted.
function writeLatest() {
  const now = Date.now();
  const others = [];
  for (const f of fs.readdirSync(outDir)) {
    if (!f.startsWith(autoPrefix) || !f.endsWith(".md")) continue;
    const p = path.join(outDir, f);
    const age = now - fs.statSync(p).mtimeMs;
    if (age > 7 * 864e5) { try { fs.unlinkSync(p); } catch {} continue; }
    if (p === out || age > 2 * 864e5) continue;
    const text = fs.readFileSync(p, "utf8");
    const folder = folderOf(text);
    if (folder && !samePath(folder, work)) continue; // a same-named folder's brief from before the names were split
    const goal = text.split("## First request (the goal)\n\n")[1]?.split("\n")[0] ?? "";
    others.push({ p, t: fs.statSync(p).mtimeMs, goal });
  }
  others.sort((a, b) => b.t - a.t);
  const list = others.length
    ? ["", "## Other sessions in this folder (last 2 days, newest first)", "",
       "If the session above isn't the one the user means, read the matching brief below instead.", "",
       ...others.map((o) => `- ${new Date(o.t).toLocaleString()}: \`${o.p}\` (first request: ${cut(o.goal, 150)})`), ""]
    : [];
  fs.writeFileSync(path.join(outDir, `${name}-latest.md`), brief + list.join("\n"));
}
