#!/usr/bin/env node
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
// The /handoff skill's brief: writes a short brief of a Claude Code session so work can continue in
// a fresh session. Reads only the transcript: the first and last user requests, files edited, and
// Claude's last reply.
// Usage: node brief.mjs --summary <file> [--session <id or its first 8+ characters>]
//        [--transcript <file.jsonl>] [--cwd <project folder>]
//        node brief.mjs --should [<file.jsonl>] [--session <id>] [--cwd <project folder>]
// --summary: a text file with where the work stands, written by this session first (its own
// transcript must show the write). It becomes the "Where we are" part and is deleted afterwards.
// Without it no brief is written: a brief with an empty summary leaves the next session to guess.
// --should: writes no brief; prints "hand off: <reason>" when this chat has compacted at least once
// or its last reply sent 150k tokens of context or more, else "stay: <reason>". The lead runs it
// at a merged slice.
// The session is --session, else CLAUDE_CODE_SESSION_ID (Claude Code sets it for Bash commands);
// its transcript is ~/.claude/projects/<folder key>/<id>.jsonl. Two chats in one folder can hand
// off in the same minute, so "the newest transcript in this folder" is used only when the session
// is unknown and no other transcript there changed in the last 10 minutes.
import {
  contextTokens,
  entries,
  lastUsage,
  SYNTHETIC,
  userText,
} from "../../hooks/lib/transcript.mjs";

const args = process.argv.slice(2);
const opt = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const should = args.includes("--should");
const cwd = path.resolve(opt("--cwd") || process.cwd());
const projectsDir = path.join(os.homedir(), ".claude", "projects");

const fail = (msg) => {
  console.error(
    `${should ? "No answer on handing off" : "No brief written"}: ${msg}`,
  );
  process.exit(1);
};
const LIVE_MS = 10 * 60e3;
// A lead session hands off at a merged slice from this context size (the worker limit in lead/reference.md too)
const HANDOFF_TOKENS = 150000;

if (should) {
  const given = opt("--should");
  const file = given && !given.startsWith("--") ? given : findTranscript();
  if (!file)
    fail(
      `no transcript of this session in ${path.join(projectsDir, cwd.replace(/[^A-Za-z0-9]/g, "-"))}. Pass it: --should <this session's .jsonl>.`,
    );
  let list;
  try {
    list = entries(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail(`can't read the transcript ${file}: ${e.message}`);
  }
  const used = lastUsage(list);
  if (!used)
    fail(
      `${file} has no reply with token counts, so it is not a Claude Code session's transcript.`,
    );
  const compactions = list.filter(
    (e) => e.type === "system" && e.subtype === "compact_boundary",
  ).length;
  const go = compactions >= 1 || used.tokens >= HANDOFF_TOKENS;
  console.log(
    `${go ? "hand off" : "stay"}: compacted ${compactions} time${compactions === 1 ? "" : "s"}, context ${Math.round(used.tokens / 1000)}k (hand off at 1 compaction or ${HANDOFF_TOKENS / 1000}k)`,
  );
  process.exit(0);
}

const summaryFile = (opt("--summary") || "").replace(
  /^~(?=$|[\\/])/,
  os.homedir(),
);
const how =
  "Write 5 to 12 bullets on where the work stands to a file, then run this again with --summary <that file>.";
if (!summaryFile) {
  console.log(`No brief written: the summary is missing. ${how}`);
  process.exit(1);
}
if (!fs.existsSync(summaryFile)) {
  console.log(`No brief written: ${summaryFile} is not there. ${how}`);
  process.exit(1);
}
const summary = fs.readFileSync(summaryFile, "utf8").trim();
if (summary.length < 40) {
  console.log(`No brief written: ${summaryFile} is nearly empty. ${how}`);
  process.exit(1);
}

// Transcript: given; else this session's own (in this folder's key, else any project folder, as a
// session may have moved folders); else, with no session id, the newest for this folder (the folder
// name with every non-letter/digit as "-") when no other one there is live
function findTranscript() {
  if (opt("--transcript")) return opt("--transcript");
  const session = String(
    opt("--session") || process.env.CLAUDE_CODE_SESSION_ID || "",
  ).trim();
  const key = cwd.replace(/[^A-Za-z0-9]/g, "-");
  const jsonl = (dir) => {
    try {
      return fs
        .readdirSync(dir)
        .filter((f) => f.endsWith(".jsonl"))
        .map((f) => path.join(dir, f));
    } catch {
      return [];
    }
  };
  if (session) {
    if (!/^[\w-]{8,}$/.test(session))
      fail(
        `"${session}" is not a session id (give at least its first 8 characters).`,
      );
    const own = (dir) =>
      jsonl(dir).filter((f) => path.basename(f).startsWith(session));
    const found = own(path.join(projectsDir, key));
    if (!found.length)
      for (const d of fs.existsSync(projectsDir)
        ? fs.readdirSync(projectsDir)
        : [])
        found.push(...own(path.join(projectsDir, d)));
    if (found.length > 1)
      fail(
        `more than one transcript starts with ${session}: ${found.join(", ")}. Pass more of the session id.`,
      );
    if (!found.length)
      fail(
        `no transcript of session ${session} under ${projectsDir}. Pass --transcript <this session's .jsonl>.`,
      );
    return found[0];
  }
  const files = jsonl(path.join(projectsDir, key))
    .map((f) => ({ f, t: fs.statSync(f).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  const live = files.filter((x) => Date.now() - x.t < LIVE_MS);
  if (live.length > 1)
    fail(
      `this session is unknown (no --session, no CLAUDE_CODE_SESSION_ID) and ${live.length} sessions in ${cwd} changed in the last 10 minutes, so the newest may be another chat's: ${live.map((x) => path.basename(x.f, ".jsonl")).join(", ")}. Pass --session <this session's id> or --transcript <its .jsonl>.`,
    );
  return files[0]?.f ?? null;
}

const cut = (s, n) => (s.length > n ? s.slice(0, n) + " …" : s);

// The summary's "User still owes" bullet (and its indented lines) goes to the top of the brief:
// once a new session read past it, asked about other things and called the job finished.
function owedOf(text) {
  const lines = text.split("\n");
  const i = lines.findIndex((l) => /^\s*[-*]\s*\**\s*user still owes/i.test(l));
  if (i < 0) return "";
  const owed = [
    lines[i].replace(
      /^\s*[-*]\s*\**\s*user still owes\s*:?\s*\**\s*:?\s*/i,
      "",
    ),
  ];
  for (const l of lines.slice(i + 1)) {
    if (!/^\s+\S/.test(l)) break;
    owed.push(l.trim());
  }
  const t = owed.join(" ").trim();
  return /^(nothing|none|n\/a|-)?\.?$/i.test(t) ? "" : t;
}
const owed = owedOf(summary);

function readSession(file) {
  const prompts = [],
    edited = [],
    writes = new Map(); // writes: file -> content of its last Write (undefined after an Edit)
  let lastReply = "",
    context = 0,
    sessionCwd = "";
  for (const j of entries(fs.readFileSync(file, "utf8"))) {
    if (j.cwd) sessionCwd = j.cwd;
    const content = j.message?.content;
    if (j.type === "user" && !j.isMeta) {
      let text = userText(j);
      const cmd = text.match(/<command-name>([^<]*)<\/command-name>/);
      if (cmd)
        text =
          cmd[1] +
          " " +
          (text.match(/<command-args>([^<]*)<\/command-args>/)?.[1] ?? "");
      text = text.trim();
      // Only what the user typed: system and hook injections, task notifications and the child
      // reports Nimbalyst delivers as prompts ("[Child Session Update]", forwarded "[report]") are left out.
      // steer's own wake prompts (delivered from its outbox) are left out too.
      if (
        text &&
        !text.startsWith("<") &&
        !/^\[(system|child session update|report)\b/i.test(text) &&
        !/^(A child session's report was forwarded to you|A message that reached the session you took over from was forwarded to you)/.test(
          text,
        )
      )
        prompts.push(text);
    }
    if (j.type === "assistant" && Array.isArray(content)) {
      const u = j.message.usage;
      if (u && j.message.model !== SYNTHETIC) context = contextTokens(u);
      for (const c of content) {
        if (c.type === "text" && c.text.trim()) lastReply = c.text.trim();
        const f =
          c.type === "tool_use" &&
          (c.input?.file_path || c.input?.notebook_path);
        if (f && /^(Edit|Write|NotebookEdit)$/.test(c.name)) {
          const i = edited.indexOf(f);
          if (i >= 0) edited.splice(i, 1);
          edited.push(f);
          writes.set(
            f,
            c.name === "Write" ? String(c.input?.content ?? "") : undefined,
          );
        }
      }
    }
  }
  return { prompts, edited, writes, lastReply, context, sessionCwd };
}

const transcript = findTranscript();
if (!transcript || !fs.existsSync(transcript)) {
  console.error(
    `No Claude transcript found for ${cwd}. Run this from the project folder, or pass --transcript <file>.`,
  );
  process.exit(1);
}
const s = readSession(transcript);
const work = s.sessionCwd || cwd;
const first = s.prompts[0] ?? "(none)";
const recent = s.prompts.slice(1).slice(-8);
const stamp = new Date()
  .toISOString()
  .slice(0, 16)
  .replace(/[-:]/g, "")
  .replace("T", "-");
const outDir = path.join(os.homedir(), ".claude", "handoffs");
const samePath = (a, b) => {
  const norm = (p) =>
    process.platform === "win32"
      ? path.resolve(p).toLowerCase()
      : path.resolve(p);
  return norm(a) === norm(b);
};
const sessionId = path.basename(transcript, ".jsonl");
// The summary must be this session's own: its transcript writes that file, and the file still holds
// what its last Write put there (two chats once shared one summary file and swapped their work)
const mine = [...s.writes].find(([f]) => samePath(f, summaryFile));
if (!mine)
  fail(
    `${summaryFile} was not written by session ${sessionId} (its transcript ${transcript} has no Write or Edit of it). Write this session's summary to a file of its own and pass that.`,
  );
if (mine[1] !== undefined && mine[1].trim() !== summary)
  fail(
    `${summaryFile} changed after session ${sessionId} wrote it: another session wrote the same file. Write the summary again to a file of its own.`,
  );
// The brief carries the session id: two chats in one folder can hand off in the same minute. Two
// projects with the same folder name (C:\work\api, D:\old\api) are told apart by the "Project folder" line.
const out = path.join(
  outDir,
  `${path.basename(work)}-${stamp}-${sessionId.slice(0, 8)}.md`,
);

const brief = [
  `# Handoff: ${path.basename(work)}`,
  "",
  `From session \`${sessionId}\` (~${Math.round(s.context / 1000)}k tokens of context), written ${new Date().toLocaleString()}.`,
  `Project folder: \`${work}\`. Follow its CLAUDE.md (and HANDOFF.md if there is one) before changing anything.`,
  "",
  ...(owed
    ? [
        "## Ask the user first",
        "",
        "Unanswered when the last session handed off. Ask each of these before any other question, and don't call the work finished, done or complete while one is still open.",
        "",
        `- ${owed}`,
        "",
      ]
    : []),
  "## Where we are",
  "",
  summary,
  "",
  "## First request (the goal)",
  "",
  cut(first, 1500),
  "",
  "## Latest requests (oldest first)",
  "",
  // The newest 3 requests usually hold the task, so they get more room
  ...(recent.length
    ? recent.map(
        (p, i) =>
          `- ${cut(p.replace(/\s+/g, " "), i >= recent.length - 3 ? 3000 : 600)}`,
      )
    : ["- (none)"]),
  "",
  "## Files edited (most recent last)",
  "",
  ...(s.edited.length
    ? s.edited.slice(-30).map((f) => `- \`${f}\``)
    : ["- (none)"]),
  "",
  "## Claude's last reply",
  "",
  cut(s.lastReply || "(none)", 2500),
  "",
].join("\n");

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(out, brief);
fs.rmSync(summaryFile, { force: true });
console.log(out);
