#!/usr/bin/env node
// PostToolUse hook: after a commit lands in the session's own project, or after the session edits that project's
// HANDOFF.md, tells Claude of the cheap upkeep limits its records break, so Claude fixes them itself with no question
// to the user and one "Upkeep:" line in its reply. Moves, renames, deletes and tools stay with /update-project.
// The checks (hooks/lib/upkeep-checks.mjs, shared with skills/update-project/pass.mjs):
//   - HANDOFF.md over 120 lines;
//   - backticked paths in CLAUDE.md, HANDOFF.md, .claude/rules/*.md found neither from the project nor from ~;
//   - "Replaces / replaced by" lines added to DECISIONS.md by the commit that just landed (git show HEAD, commit
//     trigger only) or not yet committed (git diff HEAD). Lines already in the file are never told.
// At most once per project folder per local day; each path and each decision line told once, 5 of each per note at
// most (the rest wait for a later day). HANDOFF.md over the limit is told again the next day.
// A project in a subfolder of a bigger repository counts a commit in that repository as its own.
// Silent for helpers (agent_id), linked worktrees, the home folder, a commit in another repository, an old HEAD and
// --amend. Wired once: PostToolUse "Bash|PowerShell|mcp__nimbalyst__developer_git_commit_proposal|Edit|MultiEdit|Write".
// State: ~/.claude/hooks/state/upkeep-note/<key>.json, {root, day, paths, decisions}. Off switch: UPKEEP_NOTE=off.
// Fails open; a git failure drops only the decision part. Test: tests/test-upkeep-note.mjs.
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { crashLog } from "./lib/crash-log.mjs";
import { emit, runHook } from "./lib/hook-io.mjs";
import { fileKey, gitBashToNative, projectRoot } from "./lib/paths.mjs";
import { readJson, stateFile, sweep, writeJson } from "./lib/state.mjs";
import {
  countLines,
  deadPaths,
  HANDOFF_LIMIT,
  isReplacesLine,
  noteFiles,
} from "./lib/upkeep-checks.mjs";

const COMMIT_TOOL = "mcp__nimbalyst__developer_git_commit_proposal";
const EDIT_TOOL = /^(Edit|MultiEdit|Write)$/;
const SHELL_TOOL = /^(Bash|PowerShell)$/;
const FRESH_MS = 2 * 60e3; // a HEAD this new was made by the call that just ran
const MAX_EACH = 5; // paths, decision lines per note
const KEEP = 300; // told paths, told decision lines kept in the state

const localDay = (d = new Date()) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 6e4)
    .toISOString()
    .slice(0, 10);
const sha16 = (s) =>
  crypto.createHash("sha1").update(s).digest("hex").slice(0, 16);
// the note asks nothing: a question mark in quoted file text becomes (qm)
const noQm = (s) => String(s).replace(/\?/g, "(qm)");
const readText = (file) => {
  try {
    return fs.readFileSync(file, "utf8");
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
};

// The commit or merge git call in a Bash command (the same reading as job-done.mjs): its subcommand, where it starts,
// and the -C folders of that call
const GIT_PIECE =
  /\bgit(\s+(-C\s+("[^"]*"|'[^']*'|\S+)|-c\s+\S+|--[\w-]+))*\s+(commit|merge)(?![\w-])/;
function gitCall(command) {
  const m = command.match(GIT_PIECE);
  if (!m) return null;
  const dashC = [...m[0].matchAll(/\s-C\s+("([^"]*)"|'([^']*)'|(\S+))/g)].map(
    (c) => gitBashToNative(c[2] ?? c[3] ?? c[4]),
  );
  return { at: m.index, dashC };
}
const isCommitCall = (event) => {
  if (event.tool_name === COMMIT_TOOL) return true;
  const command = String(event.tool_input?.command ?? "");
  return (
    SHELL_TOOL.test(event.tool_name ?? "") &&
    GIT_PIECE.test(command) &&
    !/\s--amend\b/.test(command)
  );
};
// The folder a commit call works in: the Nimbalyst tool's is the session's; for a shell the -C of the commit's own git
// call, else the last `cd <dir>` before it, else the session's cwd
function commitDir(event) {
  const cwd = String(event.cwd || process.cwd());
  if (event.tool_name === COMMIT_TOOL) return cwd;
  const command = String(event.tool_input?.command ?? "");
  const call = gitCall(command);
  if (call.dashC.length) return path.resolve(cwd, ...call.dashC);
  const cd = [
    ...command
      .slice(0, call.at)
      .matchAll(/(?:^|[;&|]\s*)cd\s+("([^"]*)"|'([^']*)'|([^\s;&|]+))/g),
  ].pop();
  return cd ? path.resolve(cwd, gitBashToNative(cd[2] ?? cd[3] ?? cd[4])) : cwd;
}
// The folder holding .git (a folder, or a worktree's .git file) at or above dir, or null
function repoRoot(dir) {
  for (let d = path.resolve(dir); ; d = path.dirname(d)) {
    if (fs.existsSync(path.join(d, ".git"))) return d;
    if (path.dirname(d) === d) return null;
  }
}
// git in a repository: its output, or null when git exits non-zero (no commit yet, not a repository)
function git(root, args) {
  const r = spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  if (r.error) throw r.error;
  return r.status === 0 ? r.stdout : null;
}
const freshHead = (root) => {
  const ct = Number(git(root, ["log", "-1", "--format=%ct"]));
  return ct > 0 && Math.abs(Date.now() - ct * 1000) <= FRESH_MS;
};

// The state file of a root: fileKey with every character outside [A-Za-z0-9-] as "-", cut to 100 characters, plus
// "-" and 8 hex characters of the sha1 of fileKey, so "my app" and "my-app" get files of their own
function stateKey(root) {
  const k = fileKey(root);
  return `${k.replace(/[^A-Za-z0-9-]/g, "-").slice(0, 100)}-${sha16(k).slice(0, 8)}`;
}

// Lines added to DECISIONS.md in a diff's output ("+" lines, not the "+++" header)
const addedLines = (diff) =>
  (diff ?? "")
    .split(/\r?\n/)
    .filter((l) => l.startsWith("+") && !l.startsWith("+++"))
    .map((l) => l.slice(1));

// Added "Replaces / replaced by" lines still in DECISIONS.md: [{line, text, id}], line in the file as it is now.
// The pathspec is relative to the root, so a project in a subfolder of a repository reads its own DECISIONS.md.
function addedDecisions(root, committed) {
  const now = readText(path.join(root, "DECISIONS.md"));
  if (now === null) return [];
  const file = now.split(/\r?\n/);
  const DIFF = ["--no-color", "--no-ext-diff"];
  const added = [
    ...(committed
      ? addedLines(
          git(root, [
            "show",
            "--format=",
            ...DIFF,
            "HEAD",
            "--",
            "DECISIONS.md",
          ]),
        )
      : []),
    ...addedLines(git(root, ["diff", ...DIFF, "HEAD", "--", "DECISIONS.md"])),
  ].filter(isReplacesLine);
  const out = [];
  for (const text of new Set(added)) {
    const i = file.indexOf(text);
    if (i === -1) continue; // removed again since
    out.push({ line: i + 1, text, id: sha16(text.trim()) });
  }
  return out.sort((a, b) => a.line - b.line);
}

function note(root, today, handoffLines, paths, decisions) {
  const parts = [];
  if (handoffLines)
    parts.push(
      `HANDOFF.md: ${handoffLines} lines, over the ${HANDOFF_LIMIT}-line limit. Trim it to the current state: what is true now, every open item (unticked boxes, open problems, things waiting on someone, unfinished steps) and the next step. Cut finished work and state that later lines replaced.
- Every open item stays in HANDOFF.md, reworded at most.
- Cut text stays recoverable. When \`git status --short HANDOFF.md\` prints nothing, git already holds the full text: cut freely. When it prints a line, or the folder has no git, first append the text you cut to docs/handoff-history.md under a heading "## Cut ${today}" (create the file when missing), then cut.
- Aim for ${HANDOFF_LIMIT} lines or fewer.`,
    );
  if (paths.length)
    parts.push(
      `Paths in the project's notes that are found neither from the project folder nor from the home folder:
${paths.map((p) => `- \`${noQm(p.path)}\` (${p.file}:${p.line})`).join("\n")}
For each, look once where the note says it lives (one search for its file name). Found in one clear new place: change the path in the note to that place. The line is about finished work: drop the line. Otherwise leave the line as it is. Each path is told once.`,
    );
  if (decisions.length)
    parts.push(
      `DECISIONS.md: these lines, added by the commit that just landed or not yet committed, say they replace another entry:
${decisions.map((d) => `- DECISIONS.md:${d.line}: "${noQm(d.text.trim().slice(0, 200))}"`).join("\n")}
For each line:
1. Find the one older entry it names (by its date, title or quoted words). Older means an earlier date than the entry holding the line.
2. Exactly one clear match: move that older entry, whole (its heading or dated line and the lines under it up to the next entry) and word for word, to docs/decisions-archive.md, newest at the top (create the file with a "# Decisions archive" heading when missing). Remove it from DECISIONS.md only after it is in the archive.
3. The line holding "Replaces" or "replaced by" stays in DECISIONS.md unchanged, and so does every entry the line does not name.
4. No match, several matches, a match with no earlier date, or a line that names something other than a DECISIONS.md entry: leave both files as they are, and say "decision left as it was" in the Upkeep line.`,
    );
  return `Upkeep for this project (${noQm(path.resolve(root))}), once today: its records broke a limit. Fix the items below yourself, before a hand-off or the end of this turn, whichever comes first. First finish what the user asked for; then do this. It is routine upkeep the user already agreed to: do it without asking them anything, and keep their attention on their own work.

${parts.join("\n\n")}

When done, add exactly one line to your reply, starting with "Upkeep:" and naming what you did, for example:
Upkeep: HANDOFF.md trimmed from 240 to 95 lines; 1 path fixed; 1 replaced decision moved to docs/decisions-archive.md.
An item you left as it was goes in the same line ("1 path left as it was"). Commit exactly as you would have without this note.`;
}

// The trigger: "commit" (a fresh commit in the repository that holds the root, at or above it), "edit" (the root's
// own HANDOFF.md) or null
function triggerOf(event, root, repo) {
  if (isCommitCall(event)) {
    const at = repoRoot(commitDir(event));
    if (!repo || !at || fileKey(at) !== fileKey(repo)) return null;
    return freshHead(repo) ? "commit" : null;
  }
  if (EDIT_TOOL.test(event.tool_name ?? "") && event.tool_input?.file_path) {
    const file = path.resolve(
      String(event.cwd || process.cwd()),
      gitBashToNative(String(event.tool_input.file_path)),
    );
    return fileKey(file) === fileKey(path.join(root, "HANDOFF.md"))
      ? "edit"
      : null;
  }
  return null;
}

runHook("upkeep-note", (event) => {
  if (event.agent_id) return;
  const root = projectRoot(event);
  if (fileKey(root) === fileKey(os.homedir())) return;
  const repo = repoRoot(root);
  if (repo && fs.statSync(path.join(repo, ".git")).isFile()) return; // a linked worktree
  const trigger = triggerOf(event, root, repo);
  if (!trigger) return;
  sweep("upkeep-note", 90);
  const file = stateFile("upkeep-note", stateKey(root));
  const today = localDay();
  const stateNow = () => readJson(file, { missing: {} }) ?? {};
  const state = stateNow();
  if (state.day === today) return;

  // the checks; already told paths and decision lines dropped, at most 5 of each kept
  const handoff = readText(path.join(root, "HANDOFF.md"));
  const n = handoff === null ? 0 : countLines(handoff);
  const handoffLines = n > HANDOFF_LIMIT ? n : 0;
  const toldPaths = new Set(Array.isArray(state.paths) ? state.paths : []);
  const paths = noteFiles(root)
    .flatMap((f) =>
      deadPaths(fs.readFileSync(path.join(root, f), "utf8"), root).map((p) => ({
        ...p,
        file: f,
        id: `${f} \`${p.path}\``,
      })),
    )
    .filter((p) => !toldPaths.has(p.id))
    .slice(0, MAX_EACH);
  const toldDecisions = new Set(
    Array.isArray(state.decisions) ? state.decisions : [],
  );
  let added = [];
  if (repo)
    try {
      added = addedDecisions(root, trigger === "commit");
    } catch (err) {
      crashLog("upkeep-note", err); // git failed: the note goes out without its decision part
    }
  const decisions = added
    .filter((d) => !toldDecisions.has(d.id))
    .slice(0, MAX_EACH);
  if (!handoffLines && !paths.length && !decisions.length) return;

  // the day stamp is on disk before the note goes out; a hook beside this one that claimed the day meanwhile wins
  if (stateNow().day === today) return;
  writeJson(file, {
    root: fileKey(root),
    day: today,
    paths: [...toldPaths, ...paths.map((p) => p.id)].slice(-KEEP),
    decisions: [...toldDecisions, ...decisions.map((d) => d.id)].slice(-KEEP),
  });
  emit.context(
    "PostToolUse",
    note(root, today, handoffLines, paths, decisions),
  );
});
